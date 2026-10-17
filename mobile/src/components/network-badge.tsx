import { StyleSheet, Text, View } from 'react-native';

import { IconAlert } from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { ARC_NETWORK } from '@/lib/arc-network';
import { chainLabel, type NetworkMismatch } from '@/lib/creator-wallet';

/**
 * Em que rede a carteira está — escolhida no build (`lib/arc-network.ts`).
 *
 * Fica à vista no saldo e no "Receive" de propósito: mandar USDC pela rede
 * errada é o erro irreversível de quem recebe cripto, e o nome da rede ao lado
 * do endereço é a defesa mais barata contra ele.
 */
export const NETWORK_LABEL = ARC_NETWORK.isMainnet ? 'Arc mainnet' : 'Arc testnet';

export function NetworkBadge() {
  const styles = useStyles();
  return (
    <View style={styles.badge} accessibilityLabel={`Network: ${NETWORK_LABEL}`}>
      {/* Verde na mainnet, âmbar na testnet: a testnet não é dinheiro de verdade. */}
      <View style={[styles.dot, !ARC_NETWORK.isMainnet && styles.dotTestnet]} />
      <Text style={styles.text}>{NETWORK_LABEL}</Text>
    </View>
  );
}

/**
 * O app e o backend em redes diferentes — o saldo fica escondido em vez de
 * aparecer com o nome da rede errada. Âmbar, não vermelho: não é falha do
 * creator nem dinheiro perdido, é configuração do nosso lado. Sem botão de
 * tentar de novo: o polling volta a checar a rede sozinho.
 */
export function NetworkMismatchCard({ mismatch }: { mismatch: NetworkMismatch }) {
  const colors = useTheme();
  const styles = useStyles();
  const app = chainLabel(mismatch.appChainId);
  const server = chainLabel(mismatch.backendChainId);

  return (
    <View style={styles.mismatch} accessibilityRole="alert">
      <View style={styles.mismatchHead}>
        <IconAlert size={18} color={colors.warn} />
        <Text style={styles.mismatchTitle}>Wrong network</Text>
      </View>
      <Text style={styles.mismatchText}>
        This app is on {app}, but XiaoLee&apos;s server is on {server}. We&apos;re hiding your balance so it
        isn&apos;t shown for the wrong network. Your funds are safe — this fixes itself once both match.
      </Text>
      <View style={styles.mismatchRows}>
        <MismatchRow label="App" value={`${app} · ${mismatch.appChainId}`} />
        <MismatchRow label="Server" value={`${server} · ${mismatch.backendChainId}`} />
      </View>
    </View>
  );
}

function MismatchRow({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.mismatchRow}>
      <Text style={styles.mismatchLabel}>{label}</Text>
      <Text style={styles.mismatchValue}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 2,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two + 2,
    height: 26,
    borderRadius: Radius.pill,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  dot: { width: 7, height: 7, borderRadius: Radius.pill, backgroundColor: colors.success },
  dotTestnet: { backgroundColor: colors.warn },
  text: { fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 0.2, color: colors.ink2 },

  mismatch: {
    gap: Spacing.three - 4,
    padding: Spacing.four - 4,
    borderRadius: Radius.xl,
    backgroundColor: colors.warnSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warnBorder,
  },
  mismatchHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  mismatchTitle: { fontFamily: Fonts.bold, fontSize: 16, color: colors.warn },
  mismatchText: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 20, color: colors.ink2 },
  mismatchRows: {
    borderRadius: Radius.md,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  mismatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    height: 40,
  },
  mismatchLabel: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink2 },
  mismatchValue: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] },
}));
