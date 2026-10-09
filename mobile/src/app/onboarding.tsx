import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getMyProfile, updateMyProfile } from '@/api/backend';
import { ApiError } from '@/api/client';
import { ErrorState } from '@/components/feedback';
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
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Spacing.five + (keyboard.visible ? 0 : insets.bottom) },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>
          {isEditing ? 'Edit your profile' : 'Welcome to Xiaolee'}
        </Text>
        <Text style={styles.subtitle}>
          {isEditing
            ? 'Update your info — Xiaolee uses it to point you to the right campaigns and content ideas.'
            : 'Tell us a bit about yourself so Xiaolee can point you to the right campaigns and content ideas.'}
        </Text>

        {error ? <ErrorState title="Couldn't save your profile" message={error} /> : null}

        <Field
          label="Full name"
          required
          value={form.full_name}
          onChange={(v) => set('full_name', v)}
          placeholder="Your full name"
          maxLength={255}
        />

        <View style={styles.row}>
          <Field
            label="State"
            value={form.state}
            onChange={(v) => set('state', v)}
            placeholder="Ex: SP"
            style={styles.flex}
            maxLength={64}
          />
          <Field
            label="City"
            value={form.city}
            onChange={(v) => set('city', v)}
            placeholder="Ex: São Paulo"
            style={styles.flex}
            maxLength={128}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>
            Interest profile<Text style={styles.required}> *</Text>
          </Text>
          <View style={styles.chips}>
            {INTERESTS.map(({ id, label }) => {
              const active = interests.includes(id);
              return (
                <Pressable
                  key={id}
                  onPress={() => toggleInterest(id)}
                  style={[styles.chip, active && styles.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.row}>
          <Field
            label="X / Twitter"
            value={form.twitter}
            onChange={(v) => set('twitter', v)}
            placeholder="@handle"
            autoCapitalize="none"
            style={styles.flex}
          />
          <Field
            label="Instagram"
            value={form.instagram}
            onChange={(v) => set('instagram', v)}
            placeholder="@handle"
            autoCapitalize="none"
            style={styles.flex}
          />
        </View>

        <Field
          label="Bio"
          value={form.bio}
          onChange={(v) => set('bio', v)}
          placeholder="A short description about you…"
          multiline
          maxLength={1000}
        />

        <Pressable
          onPress={submit}
          disabled={!valid || submitting}
          style={({ pressed }) => [
            styles.submit,
            (!valid || submitting) && styles.submitIdle,
            pressed && valid && !submitting && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !valid || submitting }}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.light.card} />
          ) : (
            <Text style={styles.submitText}>{isEditing ? 'Save changes' : 'Continue'}</Text>
          )}
        </Pressable>
      </ScrollView>
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
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Colors.light.ink3}
        style={[styles.input, multiline && styles.inputMultiline]}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.light.bg },
  flex: { flex: 1 },
  content: {
    padding: Spacing.three - 4,
    paddingTop: Spacing.four,
    gap: Spacing.three - 4,
  },
  pressed: { opacity: 0.7 },

  title: { fontFamily: Fonts.bold, fontSize: 22, color: Colors.light.ink },
  subtitle: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: Colors.light.ink2,
    marginBottom: Spacing.two,
  },

  // ── Campos ─────────────────────────────────────────────────────────────
  field: { gap: Spacing.two - 2 },
  row: { flexDirection: 'row', gap: Spacing.three - 4 },
  label: { fontFamily: Fonts.semibold, fontSize: 12, color: Colors.light.ink2 },
  required: { color: Colors.light.accent },
  input: {
    minHeight: 44,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
    fontFamily: Fonts.medium,
    fontSize: 14,
    color: Colors.light.ink,
  },
  inputMultiline: { minHeight: 92, textAlignVertical: 'top' },

  // ── Chips (perfil de interesse) ──────────────────────────────────────────
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two - 2 },
  chip: {
    height: 30,
    paddingHorizontal: Spacing.three - 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  chipActive: { backgroundColor: Colors.light.accent, borderColor: Colors.light.accent },
  chipText: { fontFamily: Fonts.semibold, fontSize: 12, color: Colors.light.ink2 },
  chipTextActive: { color: Colors.light.card },

  // ── Ações ──────────────────────────────────────────────────────────────
  submit: {
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: Colors.light.accent,
    marginTop: Spacing.two,
  },
  submitIdle: { opacity: 0.45 },
  submitText: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.light.card },
});
