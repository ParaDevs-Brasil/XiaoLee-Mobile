import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { IconBag, IconChevronLeft, IconGift, IconInbox, type IconProps } from '@/components/icons';
import { NETWORK_LABEL, NetworkMismatchCard } from '@/components/network-badge';
import { ReceiptRow } from '@/components/receipt-row';
import { WalletMockSwitcher } from '@/components/wallet-mock-switcher';
import { FAB_CLEARANCE } from '@/components/screen-shell';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import type { CreatorWallet } from '@/hooks/use-creator-wallet';
import { ARC_NETWORK } from '@/lib/arc-network';
import {
  filterReceipts,
  groupReceiptsByDay,
  hasKnownSource,
  inflowBySource,
  type ReceiptFilter,
} from '@/lib/creator-wallet';
import { formatUSDC } from '@/lib/format';

/**
 * Todos os recebimentos da carteira do creator, por dia, com filtro por origem
 * (campanha ou compra). Cada linha confirmada abre a transação no explorer da
 * Arc — o hash é a prova, e prova é o que dá para abrir.
 *
 * Só leitura, como a home da carteira, e só props — a rota
 * (`app/wallet/receipts.tsx`) junta as fontes, igual a `wallet-home-view`.
 */

const FILTERS: { key: ReceiptFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'campaign', label: 'Campaigns' },
  { key: 'purchase', label: 'Purchases' },
];

/** Vazio diferente por filtro: cada um diz de onde aquele dinheiro viria. */
const EMPTY: Record<ReceiptFilter, { Icon: (p: IconProps) => React.ReactElement; title: string; text: string }> = {
  all: {
    Icon: IconInbox,
    title: 'No payments yet',
    text: 'Campaign rewards and content sales show up here as soon as they land in your wallet.',
  },
  campaign: {
    Icon: IconGift,
    title: 'No campaign rewards yet',
    text: 'Join a campaign and complete its tasks — the agent pays you in USDC right here.',
  },
  purchase: {
    Icon: IconBag,
    title: 'No sales yet',
    text: 'When someone buys your clips or videos, the payment shows up here.',
  },
};

export function WalletReceiptsView({
  wallet,
  onBack,
  initialFilter = 'all',
}: {
  wallet: CreatorWallet;
  onBack: () => void;
  initialFilter?: ReceiptFilter;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<ReceiptFilter>(initialFilter);
  // Relógio lido uma vez: o React Compiler trata `Date.now()` no render como impuro.
  const [now] = useState(() => Date.now());

  const all = wallet.receipts ?? [];
  const showFilters = hasKnownSource(all);
  // Sem abas o filtro escolhido não pode continuar valendo escondido.
  const visible = filterReceipts(all, showFilters ? filter : 'all');
  const days = groupReceiptsByDay(visible, now);
  const total = inflowBySource(visible).total;

  return (
    <>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={wallet.refreshing}
            onRefresh={wallet.reload}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Back to wallet"
          >
            <IconChevronLeft size={20} sw={2.2} color={colors.ink} />
          </Pressable>
          <View style={styles.flex}>
            <Text style={styles.title}>Payments</Text>
            <Text style={styles.meta}>
              {wallet.status === 'ready' && visible.length > 0
                ? `+$${formatUSDC(total)} confirmed · ${visible.length} ${visible.length === 1 ? 'payment' : 'payments'}`
                : `Everything that landed on ${NETWORK_LABEL}`}
            </Text>
          </View>
        </View>

        <WalletMockSwitcher />

        {/* Abas só quando há origem para filtrar: na fonte real de hoje tudo
            chega como `transfer`, e "Campaigns" vazio diria ao creator que
            ele não recebeu de campanha nenhuma — quando só não sabemos. */}
        {showFilters ? (
          <View style={styles.filters} accessibilityRole="tablist">
            {FILTERS.map((item) => {
              const active = item.key === filter;
              const count = filterReceipts(all, item.key).length;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setFilter(item.key)}
                  style={[styles.filter, active && styles.filterActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>{item.label}</Text>
                  {wallet.status === 'ready' && count > 0 ? (
                    <Text style={[styles.filterCount, active && styles.filterCountActive]}>{count}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {wallet.status === 'loading' ? <ListSkeleton /> : null}

        {wallet.status === 'mismatch' && wallet.mismatch ? (
          <NetworkMismatchCard mismatch={wallet.mismatch} />
        ) : null}

        {wallet.status === 'error' ? (
          <ErrorState
            title="Couldn't load your payments"
            message={wallet.error ?? 'Something went wrong reaching Arc.'}
            onRetry={wallet.reload}
          />
        ) : null}

        {wallet.status === 'ready' && wallet.receipts === null ? (
          <ErrorState
            title="Couldn't load your payments"
            message="Your balance is up to date, but the payment list didn't load."
            onRetry={wallet.reload}
          />
        ) : null}

        {wallet.status === 'ready' && wallet.receipts && days.length === 0 ? (
          <View style={styles.card}>
            <EmptyState {...EMPTY[showFilters ? filter : 'all']} />
          </View>
        ) : null}

        {wallet.status === 'ready'
          ? days.map((day) => (
              <View key={day.key} style={styles.day}>
                <Text style={styles.dayLabel}>{day.label}</Text>
                <View style={styles.card}>
                  {day.items.map((item, i) => (
                    <View key={item.id} style={i > 0 && styles.divider}>
                      <ReceiptRow receipt={item} when="time" />
                    </View>
                  ))}
                </View>
              </View>
            ))
          : null}

        {wallet.status === 'ready' && days.length > 0 ? (
          <Text style={styles.note}>
            Tap a payment to open it on {ARC_NETWORK.explorerName}. Pending payments get a link once
            Arc confirms them.
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}

function ListSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.day} accessible accessibilityLabel="Loading payments">
      <Skeleton height={12} width={64} />
      <View style={styles.card}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.skeletonRow}>
            <Skeleton height={40} width={40} radius={Radius.md} />
            <View style={styles.skeletonText}>
              <Skeleton height={13} width="70%" />
              <Skeleton height={10} width="45%" />
            </View>
            <Skeleton height={14} width={48} />
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.three - 4, paddingTop: Spacing.three, gap: Spacing.three },
  pressed: { opacity: 0.7 },

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  back: {
    width: 44,
    height: 44,
    marginLeft: -Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: Fonts.bold, fontSize: 22, lineHeight: 28, color: colors.ink },
  meta: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink3, fontVariant: ['tabular-nums'] },

  filters: {
    flexDirection: 'row',
    gap: Spacing.one,
    padding: Spacing.one,
    borderRadius: Radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  filter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + 2,
    height: 36,
    borderRadius: Radius.pill,
  },
  filterActive: { backgroundColor: colors.ink },
  filterText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink2 },
  filterTextActive: { color: colors.bg },
  filterCount: {
    fontFamily: Fonts.bold,
    fontSize: 11,
    color: colors.ink3,
    fontVariant: ['tabular-nums'],
  },
  filterCountActive: { color: colors.ink3 },

  day: { gap: Spacing.two },
  dayLabel: {
    fontFamily: Fonts.bold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.ink3,
    paddingHorizontal: Spacing.one,
  },
  card: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...CardShadow,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  note: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 18,
    color: colors.ink3,
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
  },

  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, paddingVertical: Spacing.two + 2 },
  skeletonText: { flex: 1, gap: Spacing.two - 2 },
}));
