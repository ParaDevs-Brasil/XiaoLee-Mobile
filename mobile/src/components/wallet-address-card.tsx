import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconCheck, IconCopy, IconQr } from '@/components/icons';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { addressChunks } from '@/lib/creator-wallet';

/**
 * Copia o endereço e devolve `copied` por um instante — o botão vira "Copied"
 * e volta sozinho. O timer morre com o componente.
 */
export function useCopyAddress(address: string) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await Clipboard.setStringAsync(address);
    } catch {
      // Sem área de transferência não há o que confirmar — "Copied" seria mentira.
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return { copied, copy };
}

/**
 * Endereço em blocos de 4, com começo e fim em destaque e o meio recuado.
 *
 * É assim que as pessoas conferem endereço — os primeiros e os últimos
 * caracteres —, então são esses que ganham tinta cheia. `compact` mostra só
 * as pontas (home); sem ele, o endereço inteiro (sheet de receber).
 */
export function ChunkedAddress({
  address,
  compact = false,
  centered = false,
}: {
  address: string;
  compact?: boolean;
  centered?: boolean;
}) {
  const chunks = addressChunks(address);
  const style = [styles.mono, centered && styles.centered];
  if (chunks.length === 1) return <Text style={style}>{address}</Text>;

  const [prefix, ...hex] = chunks;
  const head = hex.slice(0, 2);
  const tail = hex.slice(-2);
  const middle = hex.slice(2, -2);

  return (
    <Text style={style} accessibilityLabel={`Address ${address}`}>
      <Text style={styles.dim}>{prefix} </Text>
      <Text style={styles.strong}>{head.join(' ')}</Text>
      <Text style={styles.dim}>{compact ? ' ··· ' : ` ${middle.join(' ')} `}</Text>
      <Text style={styles.strong}>{tail.join(' ')}</Text>
    </Text>
  );
}

export function WalletAddressCard({ address, onShowQr }: { address: string; onShowQr: () => void }) {
  const { copied, copy } = useCopyAddress(address);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>Your address</Text>
        <Text style={styles.hint}>Created at sign-in · only you control it</Text>
      </View>

      <ChunkedAddress address={address} compact />

      <View style={styles.actions}>
        <Pressable
          onPress={copy}
          style={({ pressed }) => [styles.action, copied && styles.actionDone, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Address copied' : 'Copy address'}
        >
          {copied ? (
            <IconCheck size={15} sw={2.2} color={Colors.light.success} />
          ) : (
            <IconCopy size={15} color={Colors.light.ink} />
          )}
          <Text style={[styles.actionText, copied && styles.actionTextDone]}>
            {copied ? 'Copied' : 'Copy'}
          </Text>
        </Pressable>

        <Pressable
          onPress={onShowQr}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <IconQr size={15} color={Colors.light.ink} />
          <Text style={styles.actionText}>Show QR</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three - 4,
    padding: Spacing.three + 4,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  head: { gap: 2 },
  eyebrow: {
    fontFamily: Fonts.bold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.light.ink3,
  },
  hint: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.light.ink3 },

  mono: { fontFamily: Fonts.mono, fontSize: 16, lineHeight: 24, letterSpacing: 0.3 },
  centered: { textAlign: 'center' },
  strong: { color: Colors.light.ink, fontWeight: '700' },
  dim: { color: Colors.light.ink3 },

  actions: { flexDirection: 'row', gap: Spacing.two },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two - 2,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  actionDone: { backgroundColor: Colors.light.successSoft, borderColor: Colors.light.successBorder },
  actionText: { fontFamily: Fonts.bold, fontSize: 13, color: Colors.light.ink },
  actionTextDone: { color: Colors.light.success },
  pressed: { opacity: 0.7 },
});
