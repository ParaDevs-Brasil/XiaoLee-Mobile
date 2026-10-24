import { useRef, useState, type ComponentType } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getOnoffIntent, startDeposit, type OnoffConfig, type OnoffIntent } from '@/api/backend';
import { ApiError } from '@/api/client';
import { IconAlert, IconClose, IconCreditCard, IconPix, IconPlus, IconQr, PIX_COLOR } from '@/components/icons';
import { Reveal } from '@/components/motion';
import { PipelineSteps } from '@/components/pipeline-steps';
import { SuccessBadge } from '@/components/success-badge';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';

/**
 * "Add money" — compra USDC com Pix ou cartão num provedor licenciado (que faz o KYC e cobra o fiat) e o USDC
 * cai direto na carteira da pessoa. A XiaoLee só abre a sessão, registra e acompanha: nunca toca no fiat.
 * Método sem provedor ligado aparece como "Soon". Receber USDC por endereço sempre existe (`onReceive`).
 * Monte só enquanto aberto, como o `WithdrawSheet`.
 */

type Icon = ComponentType<{ size?: number; color?: string; sw?: number }>;
const METHODS: { id: 'pix' | 'card'; label: string; detail: string; currency: string; Icon: Icon }[] = [
  { id: 'pix', label: 'Pix', detail: 'Instant · pay in BRL', currency: 'BRL', Icon: IconPix },
  { id: 'card', label: 'Card', detail: 'Apple Pay · Google Pay · USD', currency: 'USD', Icon: IconCreditCard },
];
const PRESETS = [10, 25, 50, 100];
/** Atalhos acima do teto por operação só levariam a um erro; sem nenhum que caiba, oferece o próprio teto. */
const presetsFor = (cap: number) => {
  const fit = PRESETS.filter((p) => p <= cap);
  return fit.length > 0 ? fit : [cap];
};
const PHASES = ['Pay', 'Confirm', 'Receive'] as const;
const PHASE_OF: Record<string, number> = { created: 0, pending_provider: 0, funds_received: 1, settled: 2 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FINAL = new Set(['settled', 'rejected', 'expired', 'failed', 'review']);

export function AddMoneySheet({
  config,
  onReceive,
  onClose,
}: {
  config: OnoffConfig;
  onReceive: () => void;
  onClose: () => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [method, setMethod] = useState<(typeof METHODS)[number]['id'] | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<OnoffIntent | null>(null);
  const [result, setResult] = useState<OnoffIntent | null>(null);
  const cancelled = useRef(false);

  const value = Number(amount.replace(',', '.'));
  const available = (id: string) => config.providers.some((p) => p.methods.includes(id) && p.directions.includes('deposit'));
  const chosen = METHODS.find((m) => m.id === method);
  const canBuy = !!chosen && value > 0 && !busy;

  const close = () => {
    cancelled.current = true;
    onClose();
  };

  /** Acompanha o intent até um desfecho; o provedor avisa o backend por webhook, o app só consulta. */
  const follow = async (start: OnoffIntent) => {
    let current = start;
    setIntent(current);
    for (let i = 0; i < 100 && !cancelled.current && !FINAL.has(current.status); i++) {
      await sleep(6000);
      current = await getOnoffIntent(start.intent_id);
      setIntent(current);
    }
    if (!cancelled.current) setResult(current);
  };

  const buy = async () => {
    if (!chosen || !canBuy) return;
    setError(null);
    setBusy(true);
    try {
      const started = await startDeposit(value, chosen.id, chosen.currency);
      setIntent(started);
      if (started.url) await WebBrowser.openBrowserAsync(started.url);
      await follow(started);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const phase = PHASE_OF[intent?.status ?? 'created'] ?? 0;
  const ok = result?.status === 'settled';

  return (
    <Modal transparent animationType="slide" onRequestClose={busy ? undefined : close}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <Pressable style={styles.backdrop} onPress={busy ? undefined : close}>
          <Pressable
            style={[styles.sheet, { paddingBottom: Spacing.four + insets.bottom }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.handle} />

            <View style={styles.header}>
              <View style={styles.icon}>
                <IconPlus size={20} sw={2.2} color={colors.accent} />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.title}>Add money</Text>
                <Text style={styles.subtitle}>Buy USDC straight into your wallet</Text>
              </View>
              {busy ? null : (
                <Pressable onPress={close} hitSlop={Spacing.two} accessibilityLabel="Close">
                  <IconClose size={18} color={colors.ink3} />
                </Pressable>
              )}
            </View>

            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {result ? (
                <Reveal key="result" style={styles.stage}>
                  {ok ? (
                    <>
                      <SuccessBadge />
                      <Text style={styles.bigTitle}>Money added</Text>
                      <Text style={styles.centerText}>Your USDC is in your wallet.</Text>
                    </>
                  ) : (
                    <View style={styles.warning}>
                      <IconAlert size={16} color={colors.warn} />
                      <Text style={styles.warningText}>
                        {result.status === 'review'
                          ? 'This payment needs a manual check. Your money is not lost — contact support with the id below.'
                          : 'The payment was not completed, and nothing was charged to your wallet.'}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.mono}>Id {result.intent_id}</Text>
                  <Pressable onPress={close} style={({ pressed }) => [styles.primary, pressed && styles.pressed]} accessibilityRole="button">
                    <Text style={styles.primaryText}>Done</Text>
                  </Pressable>
                </Reveal>
              ) : busy && intent ? (
                <Reveal key="waiting" style={styles.stage}>
                  <PipelineSteps current={phase} steps={PHASES} />
                  <View style={styles.progressBox}>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={styles.progressTitle}>{phase === 0 ? 'Complete the payment' : 'Confirming your payment'}</Text>
                    <Text style={styles.centerText}>
                      {phase === 0
                        ? 'Finish in the secure page from your provider. We pick it up here as soon as it clears.'
                        : 'Your provider is sending the USDC. This usually takes a minute or two.'}
                    </Text>
                  </View>
                  {intent.url && phase === 0 ? (
                    <Pressable
                      onPress={() => WebBrowser.openBrowserAsync(intent.url as string).catch(() => {})}
                      style={styles.ghost}
                      accessibilityRole="button"
                    >
                      <Text style={styles.ghostText}>Reopen payment page</Text>
                    </Pressable>
                  ) : null}
                </Reveal>
              ) : (
                <Reveal key="form" style={styles.stage}>
                  <Text style={styles.label}>Pay with</Text>
                  {METHODS.map((m) => {
                    const on = available(m.id);
                    const picked = method === m.id;
                    return (
                      <Pressable
                        key={m.id}
                        disabled={!on}
                        onPress={() => setMethod(m.id)}
                        style={({ pressed }) => [styles.method, picked && styles.methodOn, !on && styles.methodOff, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: picked, disabled: !on }}
                      >
                        {/* Pix tem a cor e a marca dele; cartão fica em tinta, como um cartão de verdade. */}
                        <View style={[styles.methodIcon, m.id === 'pix' ? styles.methodPix : styles.methodCard]}>
                          <m.Icon size={m.id === 'pix' ? 26 : 28} sw={1.7} color={m.id === 'pix' ? PIX_COLOR : colors.bg} />
                        </View>
                        <View style={styles.headerText}>
                          <Text style={styles.methodLabel}>{m.label}</Text>
                          <Text style={styles.methodDetail}>{m.detail}</Text>
                        </View>
                        {on ? null : (
                          <View style={styles.soon}>
                            <Text style={styles.soonText}>Soon</Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}

                  {chosen ? (
                    <>
                      <View style={styles.amountBox}>
                        <View style={styles.amountRow}>
                          <TextInput
                            value={amount}
                            onChangeText={setAmount}
                            keyboardType="decimal-pad"
                            placeholder="0.00"
                            placeholderTextColor={colors.ink3}
                            style={styles.amountInput}
                            accessibilityLabel="Amount in USDC"
                          />
                          <Text style={styles.amountUnit}>USDC</Text>
                        </View>
                        <View style={styles.presets}>
                          {presetsFor(config.limits_usdc.per_tx).map((p) => (
                            <Pressable
                              key={p}
                              onPress={() => setAmount(String(p))}
                              style={[styles.preset, value === p && styles.presetOn]}
                              accessibilityRole="button"
                              accessibilityLabel={`${p} USDC`}
                            >
                              <Text style={[styles.presetText, value === p && styles.presetTextOn]}>{p}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>

                      <Text style={styles.hint}>
                        A licensed provider verifies your identity and takes the payment. XiaoLee never handles your money.
                      </Text>
                      {error ? <Text style={styles.error}>{error}</Text> : null}
                      <Pressable
                        onPress={buy}
                        disabled={!canBuy}
                        style={({ pressed }) => [styles.primary, !canBuy && styles.primaryOff, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !canBuy }}
                      >
                        <Text style={styles.primaryText}>Continue</Text>
                      </Pressable>
                    </>
                  ) : null}

                  <Pressable
                    onPress={() => {
                      onClose();
                      onReceive();
                    }}
                    style={({ pressed }) => [styles.receive, pressed && styles.pressed]}
                    accessibilityRole="button"
                  >
                    <IconQr size={18} color={colors.ink2} />
                    <View style={styles.headerText}>
                      <Text style={styles.methodLabel}>Receive USDC on Arc</Text>
                      <Text style={styles.methodDetail}>Send from another wallet or exchange</Text>
                    </View>
                  </Pressable>
                </Reveal>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '94%',
    gap: Spacing.three - 4,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...CardShadow,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.pill, backgroundColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  headerText: { flex: 1 },
  title: { fontFamily: Fonts.bold, fontSize: 17, color: colors.ink },
  subtitle: { fontFamily: Fonts.sans, fontSize: 13, color: colors.ink2, marginTop: 1 },

  content: { paddingTop: Spacing.two },
  stage: { gap: Spacing.three },

  label: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink2, marginBottom: -Spacing.two },
  hint: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: colors.ink2 },
  error: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18, color: colors.danger },
  mono: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink3, textAlign: 'center' },
  centerText: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20, color: colors.ink2, textAlign: 'center' },
  bigTitle: { fontFamily: Fonts.bold, fontSize: 22, color: colors.ink, textAlign: 'center' },

  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 2,
    padding: Spacing.three - 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  methodOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  methodOff: { opacity: 0.5 },
  methodIcon: { width: 48, height: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  methodPix: { backgroundColor: `${PIX_COLOR}22`, borderWidth: 1, borderColor: `${PIX_COLOR}55` },
  methodCard: { backgroundColor: colors.ink },
  methodLabel: { fontFamily: Fonts.bold, fontSize: 15, color: colors.ink },
  methodDetail: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink2, marginTop: 1 },
  soon: { paddingHorizontal: Spacing.two + 2, height: 24, justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: colors.card },
  soonText: { fontFamily: Fonts.bold, fontSize: 11, color: colors.ink3 },

  amountBox: { alignItems: 'center', gap: Spacing.three - 2, paddingVertical: Spacing.two },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: Spacing.two },
  amountInput: { minWidth: 90, fontFamily: Fonts.bold, fontSize: 44, color: colors.ink, textAlign: 'center', padding: 0 },
  amountUnit: { fontFamily: Fonts.bold, fontSize: 16, color: colors.ink3 },
  presets: { flexDirection: 'row', gap: Spacing.two },
  preset: {
    minWidth: 56,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    height: 34,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  presetOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  presetText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink2 },
  presetTextOn: { color: colors.accent },

  warning: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
    padding: Spacing.three - 2,
    borderRadius: Radius.md,
    backgroundColor: colors.warnSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warnBorder,
  },
  warningText: { flex: 1, fontFamily: Fonts.medium, fontSize: 12, lineHeight: 18, color: colors.warn },

  progressBox: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three },
  progressTitle: { fontFamily: Fonts.bold, fontSize: 17, color: colors.ink, textAlign: 'center' },

  receive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 2,
    padding: Spacing.three - 2,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },

  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
  },
  primaryOff: { opacity: 0.45 },
  primaryText: { fontFamily: Fonts.bold, fontSize: 15, color: colors.onAccent },
  ghost: { alignItems: 'center', justifyContent: 'center', height: 44 },
  ghostText: { fontFamily: Fonts.bold, fontSize: 14, color: colors.ink2 },
  pressed: { opacity: 0.8 },
}));
