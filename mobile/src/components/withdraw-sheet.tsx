import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createPublicClient, http } from 'viem';

import { getOnoffIntent, registerBurn, startChainWithdraw, type OnoffIntent } from '@/api/backend';
import { ApiError } from '@/api/client';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { buildBurnTxs, type ChainNetwork } from '@/lib/onoff-burn';
import { arcChain, usePrivyWallet } from '@/lib/wallet';

/**
 * "Withdraw" — manda USDC da carteira para um endereço em outra rede (Base/Ethereum).
 *
 * Quem assina é a carteira da pessoa (approve + burn do CCTP, `lib/onoff-burn.ts`); a Circle faz o mint no
 * destino e cobra a taxa. A XiaoLee não toca no dinheiro: o backend só cota, confere e acompanha.
 * Monte só enquanto aberto (`{open ? <WithdrawSheet … /> : null}`), como o `RenameSheet`.
 */

const NETWORKS: { id: ChainNetwork; label: string }[] = [
  { id: 'base', label: 'Base' },
  { id: 'ethereum', label: 'Ethereum' },
];

type Step = 'form' | 'quote' | 'approve' | 'burn' | 'confirming' | 'waiting' | 'done' | 'review';
const STEP_TEXT: Record<Step, string> = {
  form: '',
  quote: 'Getting the fee…',
  approve: 'Approve USDC in your wallet…',
  burn: 'Confirm the withdrawal in your wallet…',
  confirming: 'Confirming on Arc…',
  waiting: 'Circle is delivering your USDC…',
  done: 'Delivered',
  review: 'Under review',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arcClient = createPublicClient({ chain: arcChain, transport: http() });

export function WithdrawSheet({ maxUsdc, onClose }: { maxUsdc: number | null; onClose: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { signAndSend } = usePrivyWallet();
  const [amount, setAmount] = useState('');
  const [network, setNetwork] = useState<ChainNetwork>('base');
  const [address, setAddress] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnoffIntent | null>(null);
  const cancelled = useRef(false);

  const value = Number(amount.replace(',', '.'));
  const busy = step !== 'form' && step !== 'done' && step !== 'review';
  const canSend = value > 0 && /^0x[0-9a-fA-F]{40}$/.test(address.trim()) && !busy;

  const close = () => {
    cancelled.current = true;
    onClose();
  };

  const send = async () => {
    if (!canSend) return;
    setError(null);
    try {
      setStep('quote');
      const to = address.trim();
      const intent = await startChainWithdraw(value, network, to);
      if (!intent.burn) throw new Error('No quote received. Try again.');
      const { approve, burn } = buildBurnTxs({ amountUsdc: value, network, address: to }, intent.burn);

      // Valor + taxa da Circle precisam caber no saldo, senão a burn reverte depois do approve.
      const total = Number(intent.burn.burn_amount) / 1e6;
      if (maxUsdc != null && total > maxUsdc) {
        throw new Error(`Amount plus Circle's fee is ${total.toFixed(2)} USDC, more than your balance (${maxUsdc}).`);
      }

      setStep('approve');
      const approveHash = await signAndSend(approve);
      setStep('confirming');
      await arcClient.waitForTransactionReceipt({ hash: approveHash as `0x${string}` });

      setStep('burn');
      const burnHash = await signAndSend(burn);
      setStep('confirming');
      await arcClient.waitForTransactionReceipt({ hash: burnHash as `0x${string}` });

      // A Circle leva alguns segundos para ver o burn; só então o backend aceita o hash.
      let registered: OnoffIntent | null = null;
      for (let i = 0; i < 24 && !registered && !cancelled.current; i++) {
        registered = await registerBurn(intent.intent_id, burnHash);
        if (!registered) await sleep(5000);
      }
      if (!registered) throw new Error('Withdrawal sent, but Circle has not confirmed it yet. Check Transactions in a minute.');

      setStep('waiting');
      let current = registered;
      for (let i = 0; i < 120 && !cancelled.current; i++) {
        if (current.status === 'paid_out' || current.status === 'review' || current.status === 'failed') break;
        await sleep(6000);
        current = await getOnoffIntent(intent.intent_id);
      }
      setResult(current);
      setStep(current.status === 'paid_out' ? 'done' : current.status === 'review' ? 'review' : 'waiting');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong.');
      setStep('form');
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={busy ? undefined : close}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <Pressable style={styles.backdrop} onPress={busy ? undefined : close}>
          <Pressable
            style={[styles.sheet, { paddingBottom: Spacing.three + insets.bottom }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.handle} />
            <Text style={styles.heading}>Withdraw USDC</Text>

            {step === 'done' || step === 'review' ? (
              <>
                <Text style={styles.body}>
                  {step === 'done'
                    ? `${result?.amount_usdc} USDC is on its way to ${network === 'base' ? 'Base' : 'Ethereum'}. Circle's fee was taken from the transfer.`
                    : 'This withdrawal needs a manual check. Your funds are not lost — contact support with the id below.'}
                </Text>
                {result?.forward_tx ? <Text style={styles.mono}>Delivery tx: {result.forward_tx}</Text> : null}
                <Text style={styles.mono}>Id: {result?.intent_id}</Text>
                <Pressable onPress={close} style={styles.primary} accessibilityRole="button">
                  <Text style={styles.primaryText}>Done</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.label}>Network</Text>
                <View style={styles.row}>
                  {NETWORKS.map((n) => (
                    <Pressable
                      key={n.id}
                      disabled={busy}
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
                <TextInput
                  value={address}
                  onChangeText={setAddress}
                  editable={!busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="0x…"
                  placeholderTextColor={colors.ink3}
                  style={styles.input}
                  accessibilityLabel="Destination address"
                />

                <Text style={styles.label}>Amount (USDC){maxUsdc != null ? ` · balance ${maxUsdc}` : ''}</Text>
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  editable={!busy}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.ink3}
                  style={styles.input}
                  accessibilityLabel="Amount in USDC"
                />
                <Text style={styles.hint}>
                  You sign with your own wallet. Circle delivers on {network === 'base' ? 'Base' : 'Ethereum'} and charges a
                  small fee. Double-check the address: transfers can&apos;t be undone.
                </Text>

                {error ? <Text style={styles.error}>{error}</Text> : null}
                {busy ? <Text style={styles.progress}>{STEP_TEXT[step]}</Text> : null}

                <Pressable
                  onPress={send}
                  disabled={!canSend}
                  style={[styles.primary, !canSend && styles.primaryOff]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canSend, busy }}
                >
                  {busy ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
                  <Text style={styles.primaryText}>Withdraw</Text>
                </Pressable>
              </>
            )}
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
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: colors.card,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: Radius.pill, backgroundColor: colors.border },
  heading: { fontFamily: Fonts.bold, fontSize: 18, color: colors.ink },
  label: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink2 },
  body: { fontFamily: Fonts.sans, fontSize: 15, color: colors.ink },
  mono: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink2 },
  hint: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink2 },
  progress: { fontFamily: Fonts.medium, fontSize: 13, color: colors.accent },
  error: { fontFamily: Fonts.medium, fontSize: 13, color: colors.danger },
  row: { flexDirection: 'row', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.bg },
  chipText: { fontFamily: Fonts.medium, fontSize: 14, color: colors.ink2 },
  chipTextOn: { color: colors.accent },
  input: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    fontFamily: Fonts.sans,
    fontSize: 15,
    color: colors.ink,
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Radius.md,
    backgroundColor: colors.accent,
  },
  primaryOff: { opacity: 0.45 },
  primaryText: { fontFamily: Fonts.bold, fontSize: 15, color: colors.onAccent },
}));
