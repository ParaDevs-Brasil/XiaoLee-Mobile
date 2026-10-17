import { useRouter } from 'expo-router';
import { useState } from 'react';
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

import { createCampaign } from '@/api/backend';
import { ApiError } from '@/api/client';
import { ErrorState } from '@/components/feedback';
import { IconAlert } from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useKeyboard } from '@/hooks/use-keyboard';
import { useSession } from '@/hooks/use-session';
import { formatTokenAmount } from '@/lib/format';

/**
 * Formulário de nova campanha — porta de
 * `frontend/src/components/campaigns/CreateCampaignForm.tsx`.
 *
 * Mesmos oito campos e os mesmos padrões do web. `reward_pool` não é um campo:
 * o backend o calcula como `reward_per_participant * max_participants`, e o
 * total mostrado aqui é só a prévia dessa conta.
 *
 * Entra como modal (ver `_layout.tsx`) porque no web também é um modal, e
 * porque um formulário longo precisa de uma saída sempre visível.
 */

const TYPES = [
  { id: 'airdrop', label: 'Airdrop' },
  { id: 'engagement', label: 'Engagement' },
  { id: 'referral', label: 'Referral' },
] as const;

/**
 * Todos os campos são texto enquanto se digita, inclusive os numéricos.
 * Guardar número no estado impede estados intermediários legítimos — apagar o
 * campo inteiro, ou digitar "0." antes do decimal — porque cada tecla passaria
 * por um `Number()` que os transforma em `0` ou `NaN`. A conversão acontece
 * uma vez, no envio.
 */
interface FormState {
  title: string;
  description: string;
  campaign_type: string;
  profile_to_follow: string;
  tweet_id_to_engage: string;
  reward_token: string;
  reward_per_participant: string;
  max_participants: string;
}

const INITIAL: FormState = {
  title: '',
  description: '',
  campaign_type: 'airdrop',
  profile_to_follow: '',
  tweet_id_to_engage: '',
  reward_token: 'USDC',
  reward_per_participant: '1',
  max_participants: '10',
};

export default function NewCampaignScreen() {
  const colors = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboard();
  const { hasSession } = useSession();

  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const reward = Number(form.reward_per_participant);
  const participants = Number(form.max_participants);
  // `Number('')` é 0 e `Number('abc')` é NaN — os dois reprovam aqui.
  const rewardOk = Number.isFinite(reward) && reward > 0;
  const participantsOk = Number.isFinite(participants) && participants > 0;

  const valid =
    form.title.trim().length > 0 &&
    form.description.trim().length > 0 &&
    form.reward_token.trim().length > 0 &&
    rewardOk &&
    participantsOk;

  const total = rewardOk && participantsOk ? reward * participants : 0;

  async function submit() {
    if (!valid || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      await createCampaign({
        title: form.title.trim(),
        description: form.description.trim(),
        campaign_type: form.campaign_type,
        // Campos opcionais: mandar string vazia gravaria "" no banco em vez de
        // deixar nulo, e aí o cartão renderizaria uma tarefa em branco.
        profile_to_follow: form.profile_to_follow.trim() || undefined,
        tweet_id_to_engage: form.tweet_id_to_engage.trim() || undefined,
        reward_token: form.reward_token.trim(),
        reward_per_participant: reward,
        max_participants: participants,
      });

      // `back` e não `push`: a lista já está na pilha, e empilhar outra cópia
      // deixaria o voltar passando por duas listas iguais.
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    /**
     * A altura do teclado sai direto do evento do sistema, em vez de sair de um
     * `KeyboardAvoidingView` como no chat.
     *
     * O KAV calcula o quanto recuar somando o `y` do próprio layout — que é
     * relativo ao **pai** — com o `screenY` do teclado, que é absoluto. Isso só
     * fecha quando a raiz React começa no topo da tela. O chat começa; esta
     * tela não: ela entra como modal com header nativo (ver `_layout.tsx`), e
     * no iOS `presentation: 'modal'` ainda é um sheet recuado do topo. Seriam
     * dois deslocamentos para adivinhar, e o KAV recuaria de menos pela soma
     * dos dois — deixando justamente os últimos campos embaixo do teclado.
     *
     * `endCoordinates.height` não tem esse problema: é o sistema dizendo quanto
     * da tela o teclado ocupa, contado da base. Como o sheet vai até a base da
     * tela nas duas plataformas, encolher este contêiner por esse tanto põe o
     * fim do formulário exatamente na borda do teclado.
     */
    <View style={[styles.screen, { paddingBottom: keyboard.height }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          // Com o teclado aberto o `insets.bottom` não protege de nada: a barra
          // de gestos está coberta por ele, e o contêiner já recuou.
          { paddingBottom: Spacing.five + (keyboard.visible ? 0 : insets.bottom) },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!hasSession ? (
          <View style={styles.notice}>
            <IconAlert size={14} color={colors.ink2} />
            <Text style={styles.noticeText}>
              Connect a wallet first — the campaign is created under your account.
            </Text>
          </View>
        ) : null}

        {error ? <ErrorState title="Couldn't create campaign" message={error} /> : null}

        <Field
          label="Title"
          required
          value={form.title}
          onChange={(v) => set('title', v)}
          placeholder="Ex: Launch Campaign"
        />

        <Field
          label="Description"
          required
          value={form.description}
          onChange={(v) => set('description', v)}
          placeholder="Describe the campaign objectives…"
          multiline
        />

        <View style={styles.field}>
          <Text style={styles.label}>
            Campaign type<Text style={styles.required}> *</Text>
          </Text>
          {/* Segmentado em vez de select: um picker nativo para três opções
              curtas custa um toque a mais e esconde as alternativas. */}
          <View style={styles.segmented}>
            {TYPES.map(({ id, label }) => {
              const active = form.campaign_type === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => set('campaign_type', id)}
                  style={[styles.segment, active && styles.segmentActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Field
          label="Profile to follow"
          value={form.profile_to_follow}
          onChange={(v) => set('profile_to_follow', v)}
          placeholder="Ex: @xiaolee_official"
          autoCapitalize="none"
        />

        <Field
          label="Tweet to engage"
          value={form.tweet_id_to_engage}
          onChange={(v) => set('tweet_id_to_engage', v)}
          placeholder="1234567890123456789"
          autoCapitalize="none"
        />

        <Field
          label="Reward token"
          required
          value={form.reward_token}
          onChange={(v) => set('reward_token', v)}
          placeholder="Ex: USDC, ETH, BTC"
          autoCapitalize="characters"
        />

        <View style={styles.row}>
          <Field
            label="Reward each"
            required
            value={form.reward_per_participant}
            onChange={(v) => set('reward_per_participant', v)}
            keyboardType="decimal-pad"
            style={styles.flex}
          />
          <Field
            label="Max participants"
            required
            value={form.max_participants}
            onChange={(v) => set('max_participants', v)}
            keyboardType="number-pad"
            style={styles.flex}
          />
        </View>

        {/* Prévia do `reward_pool` que o backend vai gravar. */}
        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Total pool</Text>
          <Text style={styles.totalValue}>
            {formatTokenAmount(total)} {form.reward_token.trim() || '—'}
          </Text>
        </View>

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
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.submitText}>Create campaign</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>Cancel</Text>
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
  keyboardType,
  autoCapitalize,
  style,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  keyboardType?: 'decimal-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'characters';
  style?: object;
}) {
  const colors = useTheme();
  const styles = useStyles();
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
        placeholderTextColor={colors.ink3}
        style={[styles.input, multiline && styles.inputMultiline]}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: {
    padding: Spacing.three - 4,
    paddingTop: Spacing.three,
    gap: Spacing.three - 4,
  },
  pressed: { opacity: 0.7 },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 2,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  noticeText: { flex: 1, fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink2 },

  // ── Campos ─────────────────────────────────────────────────────────────
  field: { gap: Spacing.two - 2 },
  row: { flexDirection: 'row', gap: Spacing.three - 4 },
  label: { fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink2 },
  required: { color: colors.accent },
  input: {
    minHeight: 44,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    fontFamily: Fonts.medium,
    fontSize: 14,
    color: colors.ink,
  },
  inputMultiline: { minHeight: 92, textAlignVertical: 'top' },

  // ── Segmentado ─────────────────────────────────────────────────────────
  segmented: {
    flexDirection: 'row',
    gap: Spacing.one,
    padding: Spacing.one,
    borderRadius: Radius.md,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
  },
  segmentActive: { backgroundColor: colors.accentFill },
  segmentText: { fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink2 },
  segmentTextActive: { color: colors.onAccent },

  // ── Total ──────────────────────────────────────────────────────────────
  totalBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  totalLabel: { fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink2 },
  totalValue: { fontFamily: Fonts.bold, fontSize: 16, color: colors.accent },

  // ── Ações ──────────────────────────────────────────────────────────────
  submit: {
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: colors.accentFill,
    marginTop: Spacing.two,
  },
  submitIdle: { opacity: 0.45 },
  submitText: { fontFamily: Fonts.bold, fontSize: 14, color: colors.onAccent },
  cancel: { height: 42, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: Fonts.semibold, fontSize: 13, color: colors.ink2 },
}));
