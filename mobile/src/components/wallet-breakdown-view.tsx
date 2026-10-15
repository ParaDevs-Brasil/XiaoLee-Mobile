import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { IconChevronLeft, IconChevronRight, IconInbox } from '@/components/icons';
import { InflowDonut } from '@/components/inflow-donut';
import { NETWORK_LABEL, NetworkMismatchCard } from '@/components/network-badge';
import { SOURCE_META } from '@/components/receipt-row';
import { SectionCard } from '@/components/section-card';
import { WalletMockSwitcher } from '@/components/wallet-mock-switcher';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { CreatorWallet } from '@/hooks/use-creator-wallet';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import {
  breakdownInflow,
  INFLOW_PERIODS,
  monthLabel,
  oldestMonthOffset,
  periodBounds,
  type InflowPeriod,
  type ReceiptFilter,
  type ReceiptSource,
  type SourceBreakdown,
} from '@/lib/creator-wallet';
import { formatUSDC } from '@/lib/format';

/**
 * Detalhamento das entradas — o "Details ›" da faixa do cartão de saldo
 * (rota em `app/wallet/breakdown.tsx`).
 *
 * Responde "de onde veio e o que mais rendeu" numa janela escolhida: donut
 * por origem, legenda com valor/%/contagem e, dentro de cada origem, cada
 * campanha ou item vendido do maior para o menor. Só o confirmado entra no
 * total; o pendente aparece à parte.
 *
 * Só props, como as outras views da carteira. A home só oferece a entrada
 * para cá quando há origem conhecida nos recebimentos (`hasKnownSource`): com
 * a fonte real de hoje, tudo é `transfer`, e um donut 100% "Transfers" não
 * detalharia nada.
 */

/** Medidas do filtro de período — a pílula deslizante é calculada a partir delas. */
const TAB_PAD = Spacing.one;
const TAB_GAP = Spacing.one;

/** Origens que têm aba na lista de Payments — as outras não têm para onde levar. */
const FILTERABLE: Partial<Record<ReceiptSource, ReceiptFilter>> = {
  campaign: 'campaign',
  purchase: 'purchase',
};

export function WalletBreakdownView({
  wallet,
  onBack,
  onOpenPayments,
}: {
  wallet: CreatorWallet;
  onBack: () => void;
  onOpenPayments: (filter: ReceiptFilter) => void;
}) {
  const insets = useSafeAreaInsets();
  // 30 dias por padrão: é a janela da faixa da home, de onde a pessoa veio.
  const [period, setPeriod] = useState<InflowPeriod>('30d');
  /** No modo `month`: 0 = mês corrente, 1 = o anterior… */
  const [monthOffset, setMonthOffset] = useState(0);
  const [selected, setSelected] = useState<ReceiptSource | null>(null);
  // Relógio lido uma vez: o React Compiler trata `Date.now()` no render como impuro.
  const [now] = useState(() => Date.now());

  const receipts = wallet.receipts ?? [];
  const maxOffset = oldestMonthOffset(receipts, now);
  // Trocar de modo com um mês antigo aberto, ou os dados encolherem, não pode
  // deixar o seletor num mês fora do alcance.
  const offset = Math.min(monthOffset, maxOffset);
  const month = monthLabel(offset, now);
  const meta = INFLOW_PERIODS.find((item) => item.key === period) ?? INFLOW_PERIODS[1];
  const windowLabel = period === 'month' ? month : meta.long;
  const breakdown = breakdownInflow(receipts, periodBounds(period, now, offset));
  /** Muda a cada troca de período ou de mês — é a chave da entrada animada. */
  const windowKey = `${period}:${offset}`;
  // A seleção só vale se a origem ainda existe na janela escolhida.
  const focus = breakdown.sources.some((entry) => entry.source === selected) ? selected : null;
  const visibleSources = focus ? breakdown.sources.filter((entry) => entry.source === focus) : breakdown.sources;

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: Spacing.six + insets.bottom }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={wallet.refreshing}
          onRefresh={wallet.reload}
          tintColor={Colors.light.accent}
          colors={[Colors.light.accent]}
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
          <IconChevronLeft size={20} sw={2.2} color={Colors.light.ink} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title}>Received</Text>
          <Text style={styles.meta}>Where your USDC came from · {windowLabel}</Text>
        </View>
      </View>

      <WalletMockSwitcher />

      <PeriodTabs
        period={period}
        onChange={(next) => {
          // Entrar em "Month" sempre começa no mês corrente — reabrir no mês
          // antigo que se viu antes faz parecer que o filtro errou.
          if (next === 'month' && period !== 'month') setMonthOffset(0);
          setPeriod(next);
        }}
      />

      {period === 'month' ? (
        <MonthStepper
          label={month}
          canGoBack={offset < maxOffset}
          canGoForward={offset > 0}
          onBack={() => setMonthOffset(offset + 1)}
          onForward={() => setMonthOffset(offset - 1)}
        />
      ) : null}

      {wallet.status === 'loading' ? <BreakdownSkeleton /> : null}

      {wallet.status === 'mismatch' && wallet.mismatch ? <NetworkMismatchCard mismatch={wallet.mismatch} /> : null}

      {wallet.status === 'error' ? (
        <ErrorState
          title="Couldn't load your payments"
          message={wallet.error ?? 'Something went wrong reaching Arc.'}
          onRetry={wallet.reload}
        />
      ) : null}

      {wallet.status === 'ready' && breakdown.sources.length === 0 ? (
        <FadeIn key={windowKey} style={styles.card}>
          <EmptyState
            Icon={IconInbox}
            title={emptyTitle(period, windowLabel)}
            text={
              breakdown.pending.count > 0
                ? pendingText(breakdown.pending)
                : period === 'all'
                  ? 'Campaign rewards and content sales show up here once they land.'
                  : period === 'month'
                    ? 'Try another month, or a longer period.'
                    : 'Try a longer period.'
            }
          />
        </FadeIn>
      ) : null}

      {wallet.status === 'ready' && breakdown.sources.length > 0 ? (
        <>
          <View style={styles.card}>
            <View style={styles.donutWrap}>
              <InflowDonut sources={breakdown.sources} selected={focus} />
            </View>

            {/* O donut fica fora do fade: ele mesmo se transforma. */}
            <FadeIn key={windowKey} style={styles.legend}>
              {breakdown.sources.map((entry) => (
                <LegendRow
                  key={entry.source}
                  entry={entry}
                  active={focus === entry.source}
                  dimmed={focus !== null && focus !== entry.source}
                  onPress={() => setSelected(focus === entry.source ? null : entry.source)}
                />
              ))}
            </FadeIn>

            <Text style={styles.hint}>
              {focus ? 'Tap again to see every source.' : 'Tap a source to focus on it.'}
            </Text>
          </View>

          <FadeIn key={windowKey} delay={80} style={styles.sections}>
            {breakdown.pending.count > 0 ? <Text style={styles.pending}>{pendingText(breakdown.pending)}</Text> : null}

            {visibleSources.map((entry) => {
              const filter = FILTERABLE[entry.source];
              return (
                <SourceSection
                  key={entry.source}
                  entry={entry}
                  onOpenPayments={filter ? () => onOpenPayments(filter) : undefined}
                />
              );
            })}
          </FadeIn>

          <Text style={styles.note}>
            Only confirmed payments count toward the total. Amounts in USDC on {NETWORK_LABEL}.
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
}

/**
 * Filtro de período com a pílula escura deslizando até a opção escolhida —
 * mesmo gesto do seletor 3:4/9:16 do compartilhar perfil. A pílula anda no
 * driver nativo; com "reduzir movimento", ela só aparece no lugar.
 */
function PeriodTabs({ period, onChange }: { period: InflowPeriod; onChange: (next: InflowPeriod) => void }) {
  const reduceMotion = useReduceMotion();
  const index = INFLOW_PERIODS.findIndex((item) => item.key === period);
  const [trackWidth, setTrackWidth] = useState(0);
  const [slide] = useState(() => new Animated.Value(index));

  useEffect(() => {
    if (reduceMotion) {
      slide.setValue(index);
      return;
    }
    Animated.timing(slide, {
      toValue: index,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [index, reduceMotion, slide]);

  const count = INFLOW_PERIODS.length;
  // Largura útil = trilho − padding dos dois lados − vãos entre as opções.
  const pillWidth = trackWidth > 0 ? (trackWidth - TAB_PAD * 2 - TAB_GAP * (count - 1)) / count : 0;
  const translateX = slide.interpolate({
    inputRange: [0, count - 1],
    outputRange: [0, (count - 1) * (pillWidth + TAB_GAP)],
  });

  return (
    <View
      style={styles.periods}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      accessibilityRole="tablist"
    >
      {pillWidth > 0 ? (
        <Animated.View style={[styles.pill, { width: pillWidth, transform: [{ translateX }] }]} />
      ) : null}
      {INFLOW_PERIODS.map((item) => {
        const active = item.key === period;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={styles.period}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.long}
          >
            <Text style={[styles.periodText, active && styles.periodTextActive]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Entrada do conteúdo de uma janela: sobe 8px e aparece. Remonta pela `key`
 * (período + mês), então anima a cada troca — nunca nas recargas do polling,
 * que não mudam a chave.
 */
function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: object }) {
  const reduceMotion = useReduceMotion();
  const [enter] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduceMotion) {
      enter.setValue(1);
      return;
    }
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [delay, enter, reduceMotion]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return <Animated.View style={[style, { opacity: enter, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

function emptyTitle(period: InflowPeriod, windowLabel: string): string {
  if (period === 'all') return 'Nothing received yet';
  if (period === 'month') return `Nothing received in ${windowLabel}`;
  return `Nothing received in the ${windowLabel}`;
}

/**
 * ‹ mês › — só no modo `month`. Volta até o mês do primeiro recebimento e
 * não avança além do mês corrente: dos dois lados só haveria vazio.
 */
function MonthStepper({
  label,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: {
  label: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={onBack}
        disabled={!canGoBack}
        style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Previous month"
        accessibilityState={{ disabled: !canGoBack }}
      >
        <IconChevronLeft size={18} sw={2.2} color={canGoBack ? Colors.light.ink : Colors.light.border} />
      </Pressable>
      <Text style={styles.stepperLabel} accessibilityRole="header">
        {label}
      </Text>
      <Pressable
        onPress={onForward}
        disabled={!canGoForward}
        style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Next month"
        accessibilityState={{ disabled: !canGoForward }}
      >
        <IconChevronRight size={18} sw={2.2} color={canGoForward ? Colors.light.ink : Colors.light.border} />
      </Pressable>
    </View>
  );
}

function pendingText(pending: { total: number; count: number }): string {
  const what = pending.count === 1 ? '1 payment' : `${pending.count} payments`;
  return `+$${formatUSDC(pending.total)} pending (${what}) — it joins the total once Arc confirms it.`;
}

/** Uma linha da legenda — é também o controle de foco do donut. */
function LegendRow({
  entry,
  active,
  dimmed,
  onPress,
}: {
  entry: SourceBreakdown;
  active: boolean;
  dimmed: boolean;
  onPress: () => void;
}) {
  const { plural, color } = SOURCE_META[entry.source];
  const count = entry.count === 1 ? '1 payment' : `${entry.count} payments`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.legendRow, active && styles.legendRowActive, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${plural}: ${formatUSDC(entry.total)} USDC, ${entry.percent}%, ${count}`}
    >
      <View style={[styles.legendDot, { backgroundColor: color }, dimmed && styles.dimmed]} />
      <View style={styles.flex}>
        <Text style={[styles.legendName, dimmed && styles.dimmedText]}>{plural}</Text>
        <Text style={styles.legendCount}>{count}</Text>
      </View>
      <Text style={[styles.legendValue, dimmed && styles.dimmedText]}>${formatUSDC(entry.total)}</Text>
      <Text style={[styles.legendPercent, dimmed && styles.dimmedText]}>{entry.percent}%</Text>
    </Pressable>
  );
}

/**
 * O que rendeu dentro de uma origem — cada campanha ou item vendido, do maior
 * para o menor, com uma barrinha da fatia dele dentro da origem.
 */
function SourceSection({ entry, onOpenPayments }: { entry: SourceBreakdown; onOpenPayments?: () => void }) {
  const { plural, color } = SOURCE_META[entry.source];
  const count = entry.count === 1 ? '1 payment' : `${entry.count} payments`;

  return (
    <SectionCard
      title={plural}
      subtitle={`$${formatUSDC(entry.total)} · ${count} · ${entry.percent}% of the total`}
      action={
        onOpenPayments ? (
          <Pressable
            onPress={onOpenPayments}
            hitSlop={Spacing.two}
            style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`See ${plural.toLowerCase()} payments`}
          >
            <Text style={styles.seeAllText}>Payments</Text>
            <IconChevronRight size={14} sw={2.2} color={Colors.light.ink2} />
          </Pressable>
        ) : undefined
      }
    >
      {entry.items.map((item) => {
        const share = entry.total > 0 ? item.total / entry.total : 0;
        return (
          <View key={item.title} style={styles.itemRow}>
            <View style={styles.itemTop}>
              <Text style={styles.itemTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.itemValue}>${formatUSDC(item.total)}</Text>
            </View>
            <View style={styles.itemBottom}>
              <View style={styles.itemTrack}>
                <View style={[styles.itemFill, { width: `${Math.max(share * 100, 2)}%`, backgroundColor: color }]} />
              </View>
              <Text style={styles.itemCount}>{item.count === 1 ? '1 payment' : `${item.count} payments`}</Text>
            </View>
          </View>
        );
      })}
    </SectionCard>
  );
}

function BreakdownSkeleton() {
  return (
    <View style={[styles.card, styles.skeleton]} accessible accessibilityLabel="Loading breakdown">
      <Skeleton height={176} width={176} radius={Radius.pill} style={styles.skeletonDonut} />
      <Skeleton height={44} />
      <Skeleton height={44} />
    </View>
  );
}

const styles = StyleSheet.create({
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
  title: { fontFamily: Fonts.bold, fontSize: 22, lineHeight: 28, color: Colors.light.ink },
  meta: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.light.ink3 },

  periods: {
    flexDirection: 'row',
    gap: TAB_GAP,
    padding: TAB_PAD,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  period: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 36,
    borderRadius: Radius.pill,
  },
  pill: {
    position: 'absolute',
    top: TAB_PAD,
    bottom: TAB_PAD,
    left: TAB_PAD,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.ink,
  },
  periodText: { fontFamily: Fonts.bold, fontSize: 13, color: Colors.light.ink2 },
  periodTextActive: { color: Colors.light.bg },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -Spacing.two,
  },
  stepperButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepperLabel: { fontFamily: Fonts.bold, fontSize: 15, color: Colors.light.ink },

  card: {
    gap: Spacing.three,
    padding: Spacing.three + 4,
    borderRadius: Radius.xl,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  donutWrap: { alignItems: 'center', paddingVertical: Spacing.two },

  legend: { gap: Spacing.one },
  sections: { gap: Spacing.three },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    minHeight: 52,
    paddingHorizontal: Spacing.three - 4,
    borderRadius: Radius.md,
  },
  legendRowActive: { backgroundColor: Colors.light.bg },
  legendDot: { width: 12, height: 12, borderRadius: Radius.pill },
  legendName: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.light.ink },
  legendCount: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.light.ink3, marginTop: 1 },
  legendValue: {
    fontFamily: Fonts.bold,
    fontSize: 15,
    color: Colors.light.ink,
    fontVariant: ['tabular-nums'],
  },
  legendPercent: {
    width: 44,
    textAlign: 'right',
    fontFamily: Fonts.semibold,
    fontSize: 13,
    color: Colors.light.ink2,
    fontVariant: ['tabular-nums'],
  },
  dimmed: { opacity: 0.3 },
  dimmedText: { color: Colors.light.ink3 },
  hint: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.light.ink3, textAlign: 'center' },

  pending: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.light.warn,
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
  },

  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  seeAllText: { fontFamily: Fonts.bold, fontSize: 13, color: Colors.light.ink2 },

  itemRow: { gap: Spacing.one + 2, paddingVertical: Spacing.one + 2 },
  itemTop: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  itemTitle: { flex: 1, fontFamily: Fonts.semibold, fontSize: 14, color: Colors.light.ink },
  itemValue: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: Colors.light.ink,
    fontVariant: ['tabular-nums'],
  },
  itemBottom: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  itemTrack: {
    flex: 1,
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.bg,
    overflow: 'hidden',
  },
  itemFill: { height: '100%', borderRadius: Radius.pill },
  itemCount: { fontFamily: Fonts.medium, fontSize: 11, color: Colors.light.ink3, minWidth: 68, textAlign: 'right' },

  note: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.light.ink3,
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
  },

  skeleton: { alignItems: 'stretch' },
  skeletonDonut: { alignSelf: 'center' },
});
