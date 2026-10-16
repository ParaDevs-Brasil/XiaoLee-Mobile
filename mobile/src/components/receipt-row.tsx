import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  IconArrowDownLeft,
  IconBag,
  IconExternal,
  IconGift,
  type IconProps,
} from '@/components/icons';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { ReceiptSource, WalletReceipt } from '@/lib/creator-wallet';
import { isOnChainTx, txExplorerUrl } from '@/lib/explorer';
import { formatUSDC, parseTimestamp, timeAgo } from '@/lib/format';

/**
 * Uma linha de recebimento — usada na home da carteira (os últimos) e na lista
 * completa (agrupada por dia).
 *
 * A cor de cada origem é a mesma da faixa, do donut e da legenda
 * (`chart*` em `constants/theme.ts`): quem vê rosa no gráfico acha rosa na
 * lista. Campanha é o acento da marca, o dinheiro do produto.
 */

export const SOURCE_META: Record<
  ReceiptSource,
  { label: string; plural: string; color: string; Icon: (p: IconProps) => React.ReactElement }
> = {
  campaign: { label: 'Campaign', plural: 'Campaigns', color: Colors.light.chartCampaign, Icon: IconGift },
  purchase: { label: 'Purchase', plural: 'Purchases', color: Colors.light.chartPurchase, Icon: IconBag },
  transfer: { label: 'Transfer', plural: 'Transfers', color: Colors.light.chartTransfer, Icon: IconArrowDownLeft },
};

function clockTime(iso: string): string {
  const at = parseTimestamp(iso);
  if (Number.isNaN(at)) return '';
  return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function ReceiptRow({
  receipt,
  when = 'relative',
}: {
  receipt: WalletReceipt;
  /** `time` dentro de um grupo por dia (o dia já está no rótulo); `relative` solto. */
  when?: 'relative' | 'time';
}) {
  const meta = SOURCE_META[receipt.source];
  const tx = receipt.txHash && isOnChainTx(receipt.txHash) ? receipt.txHash : null;
  const pending = receipt.status === 'pending';
  const stamp = when === 'time' ? clockTime(receipt.createdAt) : timeAgo(receipt.createdAt);
  const detail = [meta.label, receipt.payer, stamp].filter(Boolean).join(' · ');

  const amount = formatUSDC(receipt.amountUsdc);
  const a11y =
    `Received ${amount} USDC, ${meta.label.toLowerCase()}: ${receipt.title}. ` +
    (pending ? 'Pending on Arc.' : tx ? 'Opens in the Arc explorer.' : 'Confirmed.');

  return (
    <Pressable
      disabled={!tx}
      onPress={() => tx && WebBrowser.openBrowserAsync(txExplorerUrl(tx))}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole={tx ? 'link' : undefined}
      accessibilityLabel={a11y}
    >
      <View style={styles.mark}>
        <meta.Icon size={17} color={meta.color} />
      </View>

      <View style={styles.flex}>
        <Text style={styles.title} numberOfLines={1}>
          {receipt.title}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>

      <View style={styles.right}>
        <Text style={[styles.amount, pending && styles.amountPending]}>+{amount}</Text>
        {pending ? (
          <View style={styles.pendingPill}>
            <Text style={styles.pendingText}>Pending</Text>
          </View>
        ) : (
          <View style={styles.unitRow}>
            <Text style={styles.unit}>USDC</Text>
            {tx ? <IconExternal size={10} sw={2} color={Colors.light.ink3} /> : null}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    minHeight: 56,
    paddingVertical: Spacing.two,
  },
  pressed: { opacity: 0.6 },
  mark: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  title: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.light.ink },
  detail: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.light.ink3, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 3 },
  amount: {
    fontFamily: Fonts.bold,
    fontSize: 15,
    color: Colors.light.ink,
    fontVariant: ['tabular-nums'],
  },
  amountPending: { color: Colors.light.ink3 },
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  unit: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.6,
    color: Colors.light.ink3,
  },
  pendingPill: {
    paddingHorizontal: Spacing.two - 2,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.warnSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.warnBorder,
  },
  pendingText: { fontFamily: Fonts.bold, fontSize: 9, letterSpacing: 0.4, color: Colors.light.warn },
});
