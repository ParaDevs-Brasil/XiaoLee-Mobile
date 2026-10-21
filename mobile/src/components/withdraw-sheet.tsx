import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createPublicClient, http, isAddress as isEvmAddress } from 'viem';

import { getOnoffIntent, registerBurn, startChainWithdraw, type OnoffIntent } from '@/api/backend';
import { ApiError } from '@/api/client';
import { IconAlert, IconCheck, IconClose, IconSend } from '@/components/icons';
import { Pop, Reveal } from '@/components/motion';
import { PipelineSteps } from '@/components/pipeline-steps';
import { ChunkedAddress } from '@/components/wallet-address-card';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { buildBurnTxs, type BurnParams, type ChainNetwork } from '@/lib/onoff-burn';
import { arcChain, usePrivyWallet } from '@/lib/wallet';

/**
 * "Withdraw" — manda USDC da carteira para um endereço em outra rede (Base/Ethereum).
 *
 * Quem assina é a carteira da pessoa (approve + burn do CCTP, `lib/onoff-burn.ts`); a Circle faz o mint no
 * destino e cobra a taxa. A XiaoLee não toca no dinheiro: o backend só cota, confere e acompanha.
 *
 * Quatro momentos: preencher → revisar (valor, taxa e total à vista, antes de qualquer assinatura) →
 * acompanhar (passos vivos) → resultado. Monte só enquanto aberto (`{open ? <WithdrawSheet … /> : null}`).
 */

const NETWORKS: { id: ChainNetwork; label: string }[] = [
  { id: 'base', label: 'Base' },
  { id: 'ethereum', label: 'Ethereum' },
];
const label = (n: ChainNetwork) => NETWORKS.find((x) => x.id === n)?.label ?? n;

type Step = 'form' | 'quoting' | 'review' | 'approve' | 'burn' | 'confirming' | 'registering' | 'waiting' | 'done' | 'manual';

const PHASES = ['Approve', 'Send', 'Confirm', 'Deliver'] as const;
/** A cotação da Circle envelhece; passado isso, o app pede uma nova em vez de assinar com taxa velha. */
const QUOTE_TTL_MS = 120_000;
/** Pede o mínimo de dígitos úteis: 0.054 aparece inteiro, 0.5 vira 0.50. */
const fmt = (n: number) => n.toFixed(3).replace(/0$/, '');
/** Igual ao backend: endereço em caixa mista precisa ter o checksum (EIP-55) certo. */
const isAddress = (a: string) => isEvmAddress(a);

const now = () => Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arcClient = createPublicClient({ chain: arcChain, transport: http() });

interface Quote {
  intent: OnoffIntent;
  burn: BurnParams;
  total: number;
  fee: number;
  at: number;
}

export function WithdrawSheet({ maxUsdc, onClose }: { maxUsdc: number | null; onClose: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { signAndSend } = usePrivyWallet();
  const [amount, setAmount] = useState('');
  const [network, setNetwork] = useState<ChainNetwork>('base');
  const [address, setAddress] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [result, setResult] = useState<OnoffIntent | null>(null);
  const cancelled = useRef(false);

  const value = Number(amount.replace(',', '.'));
  const to = address.trim();
  const addressBad = to.length > 0 && !isAddress(to);
  const canReview = value > 0 && isAddress(to) && step === 'form';
  const inFlight = step === 'quoting' || step === 'approve' || step === 'burn' || step === 'confirming' || step === 'registering';

  const close = () => {
    cancelled.current = true;
    onClose();
  };

  const paste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) setAddress(text.trim());
    } catch {
      // Sem área de transferência não há o que colar.
    }
  };

  /** Pede a cotação ao backend e mostra o resumo. Ainda não assina nada. */
  const review = async () => {
    if (!canReview) return;
    setError(null);
    setStep('quoting');
    try {
      const intent = await startChainWithdraw(value, network, to);
      if (!intent.burn) throw new Error('No quote received. Try again.');
      buildBurnTxs({ amountUsdc: value, network, address: to }, intent.burn); // confere a cotação antes de mostrar
      const total = Number(intent.burn.burn_amount) / 1e6;
      const fee = total - value;

      // Valor + taxa da Circle precisam caber no saldo, senão a burn reverte depois do approve.
      if (maxUsdc != null && total > maxUsdc) {
        const fit = Math.floor((maxUsdc - fee) * 100) / 100;
        if (fit > 0) {
          setAmount(String(fit));
          setError(`Circle's fee is about ${fmt(fee)} USDC, so the most you can send is ${fit.toFixed(2)}. We filled it in.`);
        } else {
          setError(`Your balance (${fmt(maxUsdc)}) doesn't cover Circle's fee of about ${fmt(fee)} USDC.`);
        }
        setStep('form');
        return;
      }
      setQuote({ intent, burn: intent.burn, total, fee, at: now() });
      setStep('review');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong.');
      setStep('form');
    }
  };

  /** Assina approve + burn com a carteira da pessoa e acompanha até a entrega. */
  const confirm = async () => {
    if (!quote) return;
    if (now() - quote.at > QUOTE_TTL_MS) {
      setError('That quote expired. Review it again to get a fresh fee.');
      setStep('form');
      return;
    }
    setError(null);
    try {
      const { approve, burn } = buildBurnTxs({ amountUsdc: value, network, address: to }, quote.burn);
      const intentId = quote.intent.intent_id;

      setPhase(0);
      setStep('approve');
      const approveHash = await signAndSend(approve);
      setStep('confirming');
      await arcClient.waitForTransactionReceipt({ hash: approveHash as `0x${string}` });

      setPhase(1);
      setStep('burn');
      const burnHash = await signAndSend(burn);
      setPhase(2);
      setStep('confirming');
      await arcClient.waitForTransactionReceipt({ hash: burnHash as `0x${string}` });

      // A Circle leva alguns segundos para ver o burn; só então o backend aceita o hash.
      setStep('registering');
      let registered: OnoffIntent | null = null;
      for (let i = 0; i < 24 && !registered && !cancelled.current; i++) {
        registered = await registerBurn(intentId, burnHash);
        if (!registered) await sleep(5000);
      }
      if (!registered) throw new Error('Withdrawal sent, but Circle has not confirmed it yet. Check Transactions in a minute.');

      setPhase(3);
      setStep('waiting');
      let current = registered;
      for (let i = 0; i < 120 && !cancelled.current; i++) {
        if (current.status === 'paid_out' || current.status === 'review' || current.status === 'failed') break;
        await sleep(6000);
        current = await getOnoffIntent(intentId);
      }
      if (cancelled.current) return;
      setResult(current);
      setStep(current.status === 'paid_out' ? 'done' : current.status === 'review' || current.status === 'failed' ? 'manual' : 'waiting');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong.');
      setStep('form');
    }
  };

  const progress = progressText(step, phase, label(network));

  return (
    <Modal visible transparent animationType="slide" onRequestClose={inFlight ? undefined : close}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <Pressable style={styles.backdrop} onPress={inFlight ? undefined : close}>
          <Pressable
            style={[styles.sheet, { paddingBottom: Spacing.four + insets.bottom }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.handle} />

            <View style={styles.header}>
              <View style={styles.icon}>
                <IconSend size={20} color={colors.accent} />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.title}>Withdraw USDC</Text>
                <Text style={styles.subtitle}>Send to your wallet on another network</Text>
              </View>
              {inFlight ? null : (
                <Pressable onPress={close} hitSlop={Spacing.two} accessibilityLabel="Close">
                  <IconClose size={18} color={colors.ink3} />
                </Pressable>
              )}
            </View>

            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {step === 'done' ? (
                <Reveal key="done" style={styles.stage}>
                  <SuccessBadge />
                  <Text style={styles.bigTitle}>Delivered</Text>
                  <Text style={styles.centerText}>
                    {fmt(result?.amount_usdc ?? value)} USDC arrived on {label(network)}.
                  </Text>
                  <View style={styles.facts}>
                    <Fact label="Network" value={label(network)} />
                    <View style={styles.addressRow}>
                      <ChunkedAddress address={to} centered />
                    </View>
                  </View>
                  {result?.forward_tx ? <Text style={styles.mono}>Delivery tx {result.forward_tx}</Text> : null}
                  <Pressable onPress={close} style={({ pressed }) => [styles.primary, pressed && styles.pressed]} accessibilityRole="button">
                    <Text style={styles.primaryText}>Done</Text>
                  </Pressable>
                </Reveal>
              ) : step === 'manual' ? (
                <Reveal key="manual" style={styles.stage}>
                  <View style={styles.warning}>
                    <IconAlert size={16} color={colors.warn} />
                    <Text style={styles.warningText}>
                      This withdrawal needs a manual check. Your USDC is not lost — contact support with the id below.
                    </Text>
                  </View>
                  <Text style={styles.mono}>Id {result?.intent_id}</Text>
                  <Pressable onPress={close} style={({ pressed }) => [styles.primary, pressed && styles.pressed]} accessibilityRole="button">
                    <Text style={styles.primaryText}>Done</Text>
                  </Pressable>
                </Reveal>
              ) : step === 'review' && quote ? (
                <Reveal key="review" style={styles.stage}>
                  <Pop style={styles.hero}>
                    <Text style={styles.heroLabel}>You send</Text>
                    <Text style={styles.heroValue}>
                      {fmt(value)} <Text style={styles.heroUnit}>USDC</Text>
                    </Text>
                    <Text style={styles.heroLabel}>to {label(network)}</Text>
                  </Pop>

                  <View style={styles.facts}>
                    <Fact label="Amount" value={`${fmt(value)} USDC`} />
                    <Fact label="Circle fee (up to)" value={`${fmt(quote.fee)} USDC`} />
                    <Fact label="Leaves your wallet" value={`${fmt(quote.total)} USDC`} strong last />
                  </View>

                  <View style={styles.facts}>
                    <Text style={styles.factsHead}>Destination · {label(network)}</Text>
                    <View style={styles.addressRow}>
                      <ChunkedAddress address={to} centered />
                    </View>
                  </View>

                  <Text style={styles.hint}>
                    You&apos;ll approve twice in your wallet: first to allow the transfer, then to send it. Check the
                    address — transfers can&apos;t be undone.
                  </Text>
                  {error ? <Text style={styles.error}>{error}</Text> : null}

                  <Pressable onPress={confirm} style={({ pressed }) => [styles.primary, pressed && styles.pressed]} accessibilityRole="button">
                    <Text style={styles.primaryText}>Confirm withdrawal</Text>
                  </Pressable>
                  <Pressable onPress={() => setStep('form')} style={styles.ghost} accessibilityRole="button">
                    <Text style={styles.ghostText}>Edit details</Text>
                  </Pressable>
                </Reveal>
              ) : step === 'approve' || step === 'burn' || step === 'confirming' || step === 'registering' || step === 'waiting' ? (
                <Reveal key="progress" style={styles.stage}>
                  <PipelineSteps current={phase} steps={PHASES} />
                  <View style={styles.progressBox}>
                    {step === 'waiting' ? null : <ActivityIndicator size="small" color={colors.accent} />}
                    <Text style={styles.progressTitle}>{progress.title}</Text>
                    <Text style={styles.centerText}>{progress.sub}</Text>
                  </View>
                  <View style={styles.facts}>
                    <Fact label="Sending" value={`${fmt(value)} USDC`} />
                    <Fact label="To" value={label(network)} last />
                  </View>
                  {step === 'waiting' ? (
                    <Pressable onPress={close} style={styles.ghost} accessibilityRole="button">
                      <Text style={styles.ghostText}>Close — delivery keeps going</Text>
                    </Pressable>
                  ) : null}
                </Reveal>
              ) : (
                <Reveal key="form" style={styles.stage}>
                  <View style={styles.amountBox}>
                    <View style={styles.amountRow}>
                      <TextInput
                        value={amount}
                        onChangeText={setAmount}
                        editable={step === 'form'}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={colors.ink3}
                        style={styles.amountInput}
                        accessibilityLabel="Amount in USDC"
                      />
                      <Text style={styles.amountUnit}>USDC</Text>
                    </View>
                    {maxUsdc != null ? (
                      <Pressable onPress={() => setAmount(String(maxUsdc))} style={styles.maxChip} accessibilityRole="button" accessibilityLabel="Use full balance">
                        <Text style={styles.maxText}>Balance {fmt(maxUsdc)} · Max</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  <Text style={styles.label}>Network</Text>
                  <View style={styles.row}>
                    {NETWORKS.map((n) => (
                      <Pressable
                        key={n.id}
                        onPress={() => setNetwork(n.id)}
                        style={[styles.chip, network === n.id && styles.chipOn]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: network === n.id }}
                      >
                        <Text style={[styles.chipText, network === n.id && styles.chipTextOn]}>{n.label}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.label}>Destination address</Text>
                  <View style={[styles.addressInputRow, addressBad && styles.inputBad]}>
                    <TextInput
                      value={address}
                      onChangeText={setAddress}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="0x…"
                      placeholderTextColor={colors.ink3}
                      style={styles.addressInput}
                      accessibilityLabel="Destination address"
                    />
                    {isAddress(to) ? (
                      <IconCheck size={16} sw={2.4} color={colors.success} />
                    ) : (
                      <Pressable onPress={paste} hitSlop={Spacing.two} style={styles.pasteChip} accessibilityRole="button">
                        <Text style={styles.pasteText}>Paste</Text>
                      </Pressable>
                    )}
                  </View>
                  {addressBad ? <Text style={styles.error}>That doesn&apos;t look like a wallet address.</Text> : null}

                  <View style={styles.warning}>
                    <IconAlert size={16} color={colors.warn} />
                    <Text style={styles.warningText}>
                      Use an address you control on {label(network)}. You sign with your own wallet; Circle delivers and
                      charges a small fee you&apos;ll see before confirming.
                    </Text>
                  </View>

                  {error ? <Text style={styles.error}>{error}</Text> : null}

                  <Pressable
                    onPress={review}
                    disabled={!canReview}
                    style={({ pressed }) => [styles.primary, !canReview && styles.primaryOff, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canReview }}
                  >
                    {step === 'quoting' ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
                    <Text style={styles.primaryText}>{step === 'quoting' ? 'Getting the fee…' : 'Review'}</Text>
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

function progressText(step: Step, phase: number, net: string): { title: string; sub: string } {
  switch (step) {
    case 'approve':
      return { title: 'Approve in your wallet', sub: 'Step 1 of 2 · lets the transfer use your USDC.' };
    case 'burn':
      return { title: 'Confirm the transfer', sub: 'Step 2 of 2 · this is the one that sends it.' };
    case 'confirming':
      return { title: 'Confirming on Arc…', sub: phase === 0 ? 'Approval is being recorded.' : 'Your transfer is being recorded.' };
    case 'registering':
      return { title: 'Waiting for Circle…', sub: 'Circle is picking up your transfer.' };
    case 'waiting':
      return { title: `Delivering to ${net}`, sub: 'Usually a few minutes. You can close this — it keeps going.' };
    default:
      return { title: '', sub: '' };
  }
}

/** Selo de sucesso: o check "estoura" com mola e um halo se expande uma vez. */
function SuccessBadge() {
  const colors = useTheme();
  const styles = useStyles();
  const reduce = useReduceMotion();
  const [halo] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduce) return;
    Animated.timing(halo, { toValue: 1, duration: 900, delay: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduce, halo]);

  return (
    <View style={styles.badgeWrap}>
      <Animated.View
        style={[
          styles.halo,
          {
            opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }) }],
          },
        ]}
      />
      <Pop style={styles.badge}>
        <IconCheck size={34} sw={3} color={colors.onAccent} />
      </Pop>
    </View>
  );
}

function Fact({ label: name, value, last = false, strong = false }: { label: string; value: string; last?: boolean; strong?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.fact, !last && styles.factDivider]}>
      <Text style={styles.factLabel}>{name}</Text>
      <Text style={[styles.factValue, strong && styles.factStrong]}>{value}</Text>
    </View>
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

  amountBox: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: Spacing.two },
  amountInput: { minWidth: 90, fontFamily: Fonts.bold, fontSize: 44, color: colors.ink, textAlign: 'center', padding: 0 },
  amountUnit: { fontFamily: Fonts.bold, fontSize: 16, color: colors.ink3 },
  maxChip: {
    paddingHorizontal: Spacing.three,
    height: 30,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: colors.accentSoft,
  },
  maxText: { fontFamily: Fonts.bold, fontSize: 12, color: colors.accent },

  row: { flexDirection: 'row', gap: Spacing.two },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.three - 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { fontFamily: Fonts.bold, fontSize: 14, color: colors.ink2 },
  chipTextOn: { color: colors.accent },

  addressInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two + 2,
    height: 50,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  inputBad: { borderColor: colors.danger },
  addressInput: { flex: 1, fontFamily: Fonts.sans, fontSize: 14, color: colors.ink, padding: 0 },
  pasteChip: { paddingHorizontal: Spacing.three - 2, height: 30, justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  pasteText: { fontFamily: Fonts.bold, fontSize: 12, color: colors.ink },

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

  hero: { alignItems: 'center', gap: 2, paddingVertical: Spacing.three },
  heroLabel: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink2 },
  heroValue: { fontFamily: Fonts.bold, fontSize: 40, color: colors.ink },
  heroUnit: { fontFamily: Fonts.bold, fontSize: 16, color: colors.ink3 },

  facts: {
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  factsHead: { fontFamily: Fonts.medium, fontSize: 12, color: colors.ink2, paddingHorizontal: Spacing.three, paddingTop: Spacing.three - 2 },
  addressRow: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three - 2 },
  fact: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three, height: 44 },
  factDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  factLabel: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink2 },
  factValue: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] },
  factStrong: { fontSize: 14 },

  progressBox: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three },
  progressTitle: { fontFamily: Fonts.bold, fontSize: 17, color: colors.ink, textAlign: 'center' },

  badgeWrap: { alignSelf: 'center', width: 72, height: 72, alignItems: 'center', justifyContent: 'center', marginVertical: Spacing.two },
  halo: { position: 'absolute', width: 72, height: 72, borderRadius: Radius.pill, backgroundColor: colors.successFill },
  badge: { width: 72, height: 72, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successFill },
  bigTitle: { fontFamily: Fonts.bold, fontSize: 22, color: colors.ink, textAlign: 'center' },

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
