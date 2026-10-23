import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconCheck, IconCopy, IconQr } from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
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
  const styles = useStyles();
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

/** Endereço curto (`0x4f3a…91c2`) que copia ao toque — o formato do cartão de saldo. Inteiro e com QR: Receive. */
export function AddressChip({ address }: { address: string }) {
  const colors = useTheme();
  const styles = useStyles();
  const { copied, copy } = useCopyAddress(address);
  return (
    <Pressable
      onPress={copy}
      style={({ pressed }) => [styles.chip, copied && styles.actionDone, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={copied ? 'Address copied' : `Copy address ${address}`}
    >
      <Text style={[styles.chipText, copied && styles.actionTextDone]}>
        {copied ? 'Copied' : `${address.slice(0, 6)}…${address.slice(-4)}`}
      </Text>
      {copied ? <IconCheck size={14} sw={2.2} color={colors.success} /> : <IconCopy size={14} color={colors.ink3} />}
    </Pressable>
  );
}

export function WalletAddressCard({ address, onShowQr }: { address: string; onShowQr: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
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
            <IconCheck size={15} sw={2.2} color={colors.success} />
          ) : (
            <IconCopy size={15} color={colors.ink} />
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
          <IconQr size={15} color={colors.ink} />
          <Text style={styles.actionText}>Show QR</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    gap: Spacing.three - 4,
    padding: Spacing.three + 4,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  head: { gap: 2 },
  eyebrow: {
    fontFamily: Fonts.bold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  hint: { fontFamily: Fonts.medium, fontSize: 12, color: colors.ink3 },

  mono: { fontFamily: Fonts.mono, fontSize: 16, lineHeight: 24, letterSpacing: 0.3 },
  centered: { textAlign: 'center' },
  strong: { color: colors.ink, fontWeight: '700' },
  dim: { color: colors.ink3 },

  actions: { flexDirection: 'row', gap: Spacing.two },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two - 2,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionDone: { backgroundColor: colors.successSoft, borderColor: colors.successBorder },
  actionText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink },
  actionTextDone: { color: colors.success },
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 2,
    height: 32,
    paddingHorizontal: Spacing.three - 2,
    borderRadius: Radius.pill,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipText: { fontFamily: Fonts.mono, fontSize: 13, color: colors.ink2 },
  pressed: { opacity: 0.7 },
}));
