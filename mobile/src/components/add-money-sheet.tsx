import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Pressable, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getOnoffIntent, startDeposit, type OnoffConfig, type OnoffIntent } from '@/api/backend';
import { ApiError } from '@/api/client';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';

/**
 * "Add money" — compra USDC com Pix ou cartão num provedor licenciado (que faz o KYC e cobra o fiat) e o USDC
 * cai direto na carteira da pessoa. A XiaoLee só abre a sessão, registra e acompanha: nunca toca no fiat.
 * Método sem provedor ligado aparece como "Coming soon". Receber USDC por endereço sempre existe (`onReceive`).
 * Monte só enquanto aberto, como o `WithdrawSheet`.
 */

const METHODS = [
  { id: 'pix', label: 'Pix', currency: 'BRL' },
  { id: 'card', label: 'Card · Apple Pay · Google Pay', currency: 'USD' },
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FINAL = new Set(['settled', 'rejected', 'expired', 'failed', 'review']);

export function AddMoneySheet({ config, onReceive, onClose }: { config: OnoffConfig; onReceive: () => void; onClose: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [method, setMethod] = useState<(typeof METHODS)[number]['id'] | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnoffIntent | null>(null);
  const cancelled = useRef(false);

  const value = Number(amount.replace(',', '.'));
  const available = (id: string) => config.providers.some((p) => p.methods.includes(id) && p.directions.includes('deposit'));
  const chosen = METHODS.find((m) => m.id === method);

  const close = () => {
    cancelled.current = true;
    onClose();
  };

  const buy = async () => {
    if (!chosen || !(value > 0) || busy) return;
    setError(null);
    setBusy(true);
    try {
      const intent = await startDeposit(value, chosen.id, chosen.currency);
      if (intent.url) await WebBrowser.openBrowserAsync(intent.url);
      let current = intent;
      for (let i = 0; i < 100 && !cancelled.current && !FINAL.has(current.status); i++) {
        await sleep(6000);
        current = await getOnoffIntent(intent.intent_id);
      }
      setResult(current);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <Pressable style={styles.backdrop} onPress={busy ? undefined : close}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three }]}>
            <View style={styles.handle} />
            <Text style={styles.heading}>Add money</Text>

            {result ? (
              <>
                <Text style={styles.body}>
                  {result.status === 'settled' ? 'USDC delivered to your wallet.' : result.status === 'review' ? 'Under review. We will contact you.' : 'Not completed.'}
                </Text>
                <Pressable onPress={close} style={styles.primary} accessibilityRole="button">
                  <Text style={styles.primaryText}>Done</Text>
                </Pressable>
              </>
            ) : (
              <>
                {METHODS.map((m) => {
                  const on = available(m.id);
                  return (
                    <Pressable
                      key={m.id}
                      disabled={!on || busy}
                      onPress={() => setMethod(m.id)}
                      style={[styles.option, method === m.id && styles.optionOn, !on && styles.optionOff]}
                      accessibilityRole="button"
                    >
                      <Text style={styles.body}>{m.label}</Text>
                      {!on ? <Text style={styles.hint}>Coming soon</Text> : null}
                    </Pressable>
                  );
                })}

                {chosen ? (
                  <>
                    <Text style={styles.label}>Amount (USDC)</Text>
                    <TextInput
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={colors.ink2}
                      editable={!busy}
                      style={styles.input}
                    />
                    <Text style={styles.hint}>
                      A licensed provider verifies your identity and takes the payment. XiaoLee never handles your money.
                    </Text>
                    {error ? <Text style={styles.error}>{error}</Text> : null}
                    <Pressable onPress={buy} disabled={busy || !(value > 0)} style={[styles.primary, (busy || !(value > 0)) && styles.primaryOff]} accessibilityRole="button">
                      {busy ? <ActivityIndicator color={colors.onAccent} /> : null}
                      <Text style={styles.primaryText}>{busy ? 'Waiting for payment…' : 'Continue'}</Text>
                    </Pressable>
                  </>
                ) : null}

                <Pressable onPress={() => { onClose(); onReceive(); }} style={styles.option} accessibilityRole="button">
                  <Text style={styles.body}>Receive USDC on Arc</Text>
                  <Text style={styles.hint}>Send from another wallet or exchange to your address</Text>
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
  hint: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink2 },
  error: { fontFamily: Fonts.medium, fontSize: 13, color: colors.danger },
  option: {
    gap: 2,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionOn: { borderColor: colors.accent, backgroundColor: colors.bg },
  optionOff: { opacity: 0.5 },
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
