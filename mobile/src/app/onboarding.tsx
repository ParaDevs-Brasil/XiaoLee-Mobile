import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getMyProfile, updateMyProfile } from '@/api/backend';
import { ApiError } from '@/api/client';
import { ErrorState } from '@/components/feedback';
import {
  IconBuilding,
  IconCheck,
  IconCube,
  IconEdit,
  IconGamepad,
  IconInstagram,
  IconMapPin,
  IconSmile,
  IconTrendingUp,
  IconUser,
  IconWallet,
  IconXSocial,
  type IconProps,
} from '@/components/icons';
import { BackgroundGlow, IconArrowRight, SparkleStar } from '@/components/login-decorations';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useKeyboard } from '@/hooks/use-keyboard';

/**
 * Questionário de onboarding — relatório de produto, "ONBOARDING DO USUÁRIO
 * AO LOGAR": nome completo, estado, cidade, redes sociais, perfil de
 * interesse, bio. Ao finalizar, abre o dashboard (não o chat) — é lá que
 * campanhas/histórico/transações já existem prontos para o perfil recém
 * preenchido.
 *
 * Mesmo padrão de formulário de `campaigns/new.tsx`, sem o "Cancel": este
 * passo não é dispensável no primeiro acesso (`index.tsx` redireciona para
 * aqui enquanto `onboarded` for `false`), então não há para onde voltar.
 *
 * Também serve como tela de edição — `/onboarding?edit=1` (link do
 * `ProfileMenu`) — para quem já passou pelo onboarding e quer atualizar o
 * perfil depois. Nesse modo o botão volta pra onde a pessoa estava
 * (`router.back()`) em vez de forçar o dashboard.
 */

const INTERESTS: { id: string; label: string }[] = [
  { id: 'defi', label: 'DeFi' },
  { id: 'games', label: 'Games' },
  { id: 'cards', label: 'Cards' },
  { id: 'trader', label: 'Trader' },
  { id: 'memecoins', label: 'Memecoins' },
];

/** Só apresentação — o que vai para o backend continua sendo o `id` acima. */
const INTEREST_ICONS: Record<string, ComponentType<IconProps>> = {
  defi: IconCube,
  games: IconGamepad,
  cards: IconWallet,
  trader: IconTrendingUp,
  memecoins: IconSmile,
};

interface FormState {
  full_name: string;
  state: string;
  city: string;
  bio: string;
  twitter: string;
  instagram: string;
}

const INITIAL: FormState = {
  full_name: '',
  state: '',
  city: '',
  bio: '',
  twitter: '',
  instagram: '',
};

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboard();
  // Telas estreitas (< 340dp): os pares State/City e X/Instagram empilham.
  const { width } = useWindowDimensions();
  const rowStyle = width < 340 ? styles.stack : styles.row;
  // `/onboarding?edit=1` — link do `ProfileMenu` para quem já passou pelo
  // questionário e quer atualizar o perfil depois.
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const isEditing = edit === '1';

  const [form, setForm] = useState<FormState>(INITIAL);
  const [interests, setInterests] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Repõe o que já foi respondido se o usuário saiu no meio do questionário
  // (fechou o app antes de terminar) — sem isto, reabrir perderia o que já
  // tinha sido salvo num PATCH anterior e a pessoa preencheria tudo de novo.
  useEffect(() => {
    let active = true;
    getMyProfile()
      .then((profile) => {
        if (!active) return;
        setForm((current) => ({
          ...current,
          full_name: profile.full_name ?? current.full_name,
          state: profile.state ?? current.state,
          city: profile.city ?? current.city,
          bio: profile.bio ?? current.bio,
          twitter: profile.social_links.twitter ?? current.twitter,
          instagram: profile.social_links.instagram ?? current.instagram,
        }));
        setInterests(profile.interest_profile);
      })
      .catch(() => {
        // Sem perfil ainda (ou chamada falhou) — segue com o formulário vazio.
      });
    return () => {
      active = false;
    };
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  function toggleInterest(id: string) {
    setInterests((current) =>
      current.includes(id) ? current.filter((i) => i !== id) : [...current, id],
    );
  }

  // Mesmo critério do backend para `onboarded` (`_profile_dict`): nome
  // preenchido e ao menos um interesse. Validar aqui evita um PATCH que o
  // backend aceitaria, mas que deixaria o questionário reaparecendo no
  // próximo login (`onboarded` continuaria `false`).
  const valid = form.full_name.trim().length > 0 && interests.length > 0;

  async function submit() {
    if (!valid || submitting) return;

    setSubmitting(true);
    setError(null);

    const social_links: Record<string, string> = {};
    if (form.twitter.trim()) social_links.twitter = form.twitter.trim();
    if (form.instagram.trim()) social_links.instagram = form.instagram.trim();

    try {
      await updateMyProfile({
        full_name: form.full_name.trim(),
        // String vazia, não `undefined`: o PATCH é parcial
        // (`exclude_unset=True` no backend) — omitir a chave deixaria um
        // valor salvo antes impossível de limpar. `""` chega, e o backend
        // converte pra `None` (`(data[key] or "").strip() or None`).
        state: form.state.trim(),
        city: form.city.trim(),
        bio: form.bio.trim(),
        social_links,
        interest_profile: interests,
      });
      if (isEditing) {
        // Veio do menu de perfil — volta pra onde a pessoa estava.
        router.back();
      } else {
        // `replace`, não `push`: o onboarding não deve ficar na pilha — o
        // voltar do Android não pode trazer o usuário de volta ao
        // questionário já respondido.
        router.replace('/dashboard');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: keyboard.height }]}>
      {/* Mesmo fundo suave da tela de login: manchas rosadas discretas atrás do
          formulário, sem competir com os campos. */}
      <BackgroundGlow />
      <SparkleStar
        size={14}
        color={Colors.light.accent}
        style={[styles.sparkle, { top: insets.top + 64 }]}
      />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.column}>
          <View style={styles.header}>
            <View
              style={styles.logoRow}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text style={styles.wordmark}>
                Xiao<Text style={styles.wordmarkAccent}>lee</Text>
              </Text>
              <SparkleStar size={14} color={Colors.light.accent} style={styles.wordmarkSpark} />
            </View>
            <Text style={styles.title} accessibilityRole="header">
              {isEditing ? 'Edit your profile' : 'Welcome to Xiaolee'}
            </Text>
            <Text style={styles.subtitle}>
              {isEditing
                ? 'Update your info — Xiaolee uses it to point you to the right campaigns and content ideas.'
                : 'Tell us a bit about yourself so Xiaolee can point you to the right campaigns and content ideas.'}
            </Text>
          </View>

          <Field
            label="Full name"
            required
            value={form.full_name}
            onChange={(v) => set('full_name', v)}
            placeholder="Your full name"
            maxLength={255}
            disabled={submitting}
            icon={(color) => <IconUser size={18} color={color} />}
          />

          <View style={rowStyle}>
            <Field
              label="State"
              value={form.state}
              onChange={(v) => set('state', v)}
              placeholder="Ex: SP"
              style={styles.flex}
              maxLength={64}
              disabled={submitting}
              icon={(color) => <IconMapPin size={18} color={color} />}
            />
            <Field
              label="City"
              value={form.city}
              onChange={(v) => set('city', v)}
              placeholder="Ex: São Paulo"
              style={styles.flex}
              maxLength={128}
              disabled={submitting}
              icon={(color) => <IconBuilding size={18} color={color} />}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              Interest profile<Text style={styles.required}> *</Text>
            </Text>
            <View style={styles.chips}>
              {INTERESTS.map(({ id, label }) => {
                const active = interests.includes(id);
                const Icon = INTEREST_ICONS[id];
                return (
                  <Pressable
                    key={id}
                    onPress={() => toggleInterest(id)}
                    disabled={submitting}
                    hitSlop={Spacing.one}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && styles.chipPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    {Icon ? (
                      <Icon
                        size={16}
                        color={active ? Colors.light.accent : Colors.light.ink3}
                      />
                    ) : null}
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                    {active ? (
                      <View style={styles.chipCheck}>
                        <IconCheck size={11} sw={3.2} color={Colors.light.card} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={rowStyle}>
            <Field
              label="X / Twitter"
              value={form.twitter}
              onChange={(v) => set('twitter', v)}
              placeholder="@handle"
              autoCapitalize="none"
              style={styles.flex}
              disabled={submitting}
              icon={(color) => <IconXSocial size={16} color={color} />}
            />
            <Field
              label="Instagram"
              value={form.instagram}
              onChange={(v) => set('instagram', v)}
              placeholder="@handle"
              autoCapitalize="none"
              style={styles.flex}
              disabled={submitting}
              icon={(color) => <IconInstagram size={18} color={color} />}
            />
          </View>

          <Field
            label="Bio"
            value={form.bio}
            onChange={(v) => set('bio', v)}
            placeholder="A short description about you…"
            multiline
            maxLength={1000}
            disabled={submitting}
            icon={(color) => <IconEdit size={17} color={color} />}
          />
        </View>
      </ScrollView>

      {/* Rodapé fixo: o botão fica sempre ao alcance do polegar e acima do
          teclado (o `paddingBottom` da tela já empurra tudo pela altura dele). */}
      <View
        style={[
          styles.footer,
          { paddingBottom: Spacing.three - 4 + (keyboard.visible ? 0 : insets.bottom) },
        ]}
      >
        <View style={styles.footerInner}>
          {error ? <ErrorState title="Couldn't save your profile" message={error} /> : null}
          <Pressable
            onPress={submit}
            disabled={!valid || submitting}
            style={({ pressed }) => [
              styles.submit,
              valid || submitting ? styles.submitEnabled : styles.submitIdle,
              pressed && valid && !submitting && styles.submitPressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !valid || submitting, busy: submitting }}
          >
            {submitting ? (
              <ActivityIndicator color={Colors.light.card} />
            ) : (
              <View style={styles.submitContent}>
                <Text style={styles.submitText}>{isEditing ? 'Save changes' : 'Continue'}</Text>
                <IconArrowRight size={18} color={Colors.light.card} />
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  multiline,
  autoCapitalize,
  maxLength,
  style,
  icon,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'characters';
  /** Mesmos limites do `ProfileUpdate` no backend — evita o 422 de campo longo demais. */
  maxLength?: number;
  style?: object;
  /** Ícone à esquerda; recebe a cor do estado atual (neutro, foco/preenchido, inválido). */
  icon: (color: string) => ReactNode;
  disabled?: boolean;
}) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);

  // Só acusa erro depois que a pessoa passou pelo campo e saiu dele vazio —
  // nunca no primeiro render, para o formulário não nascer "vermelho".
  const invalid = !!required && touched && !focused && value.trim().length === 0;
  const iconColor = invalid
    ? Colors.light.danger
    : focused || value.length > 0
      ? Colors.light.accent
      : Colors.light.ink3;

  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {/* O contêiner inteiro foca o campo (ícone e margens incluídos): alvo de
          toque maior do que só a linha de texto. */}
      <Pressable
        accessible={false}
        onPress={() => inputRef.current?.focus()}
        disabled={disabled}
        style={[
          styles.inputBox,
          multiline && styles.inputBoxMultiline,
          focused && styles.inputBoxFocused,
          invalid && styles.inputBoxInvalid,
          disabled && styles.inputBoxDisabled,
        ]}
      >
        <View style={[styles.inputIcon, multiline && styles.inputIconMultiline]}>
          {icon(iconColor)}
        </View>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setTouched(true);
          }}
          placeholder={placeholder}
          placeholderTextColor={Colors.light.ink3}
          selectionColor={Colors.light.accent}
          cursorColor={Colors.light.accent}
          style={[styles.input, multiline && styles.inputMultiline]}
          multiline={multiline}
          autoCapitalize={autoCapitalize}
          maxLength={maxLength}
          editable={!disabled}
          accessibilityLabel={required ? `${label}, required` : label}
        />
      </Pressable>
    </View>
  );
}

const INPUT_HEIGHT = 52;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.light.bg },
  flex: { flex: 1, minWidth: 0 },
  sparkle: { position: 'absolute', right: 28 },

  content: {
    paddingHorizontal: Spacing.three + 4,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
  },
  // Largura máxima para tablets/web: o formulário não estica indefinidamente.
  column: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: Spacing.three + 4 },

  // ── Cabeçalho ──────────────────────────────────────────────────────────
  header: { gap: Spacing.two, marginBottom: Spacing.one },
  logoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.three - 4 },
  wordmark: {
    fontFamily: Fonts.brand,
    fontSize: 30,
    lineHeight: 36,
    color: Colors.light.ink,
  },
  wordmarkAccent: { color: Colors.light.accent },
  wordmarkSpark: { marginLeft: 2, marginTop: 2 },
  title: {
    fontFamily: Fonts.bold,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.5,
    color: Colors.light.ink,
  },
  subtitle: {
    fontFamily: Fonts.medium,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.light.ink2,
  },

  // ── Campos ─────────────────────────────────────────────────────────────
  field: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.three - 4 },
  // Telas muito estreitas: empilha em vez de espremer placeholder e ícone.
  stack: { flexDirection: 'column', gap: Spacing.three + 4 },
  label: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.light.ink },
  required: { color: Colors.light.accent },

  inputBox: {
    minHeight: INPUT_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three - 2,
    gap: Spacing.two + 2,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.card,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
  },
  inputBoxMultiline: { minHeight: 120, alignItems: 'flex-start' },
  inputBoxFocused: {
    borderColor: Colors.light.accent,
    ...Platform.select({
      ios: {
        shadowColor: Colors.light.accent,
        shadowOpacity: 0.16,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      default: {},
    }),
  },
  inputBoxInvalid: { borderColor: Colors.light.danger },
  inputBoxDisabled: { backgroundColor: Colors.light.bg, opacity: 0.7 },
  inputIcon: { width: 20, alignItems: 'center', justifyContent: 'center' },
  inputIconMultiline: { height: INPUT_HEIGHT - 3, justifyContent: 'center' },
  input: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    paddingVertical: 0,
    fontFamily: Fonts.medium,
    fontSize: 15,
    color: Colors.light.ink,
  },
  inputMultiline: {
    minHeight: 96,
    paddingTop: Spacing.three - 1,
    paddingBottom: Spacing.three - 4,
    textAlignVertical: 'top',
  },

  // ── Chips (perfil de interesse) ──────────────────────────────────────────
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two + 2 },
  chip: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 1,
    paddingHorizontal: Spacing.three - 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.card,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
  },
  chipActive: { backgroundColor: Colors.light.accentSoft, borderColor: Colors.light.accent },
  chipPressed: { opacity: 0.75 },
  chipText: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.light.ink2 },
  chipTextActive: { color: Colors.light.accentHover },
  chipCheck: {
    width: 18,
    height: 18,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.accent,
  },

  // ── Rodapé / ação ────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: Spacing.three + 4,
    paddingTop: Spacing.three - 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light.border,
  },
  footerInner: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: Spacing.three - 4 },
  submit: {
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accent,
  },
  submitEnabled: {
    ...Platform.select({
      ios: {
        shadowColor: Colors.light.accent,
        shadowOpacity: 0.3,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 4, shadowColor: Colors.light.accent },
      default: {},
    }),
  },
  submitIdle: { opacity: 0.4 },
  submitPressed: { backgroundColor: Colors.light.accentHover, transform: [{ scale: 0.985 }] },
  submitContent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  submitText: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.light.card },
});
