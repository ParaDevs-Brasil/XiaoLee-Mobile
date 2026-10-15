import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconChevronRight, IconQr } from '@/components/icons';
import { NetworkBadge } from '@/components/network-badge';
import { SOURCE_META } from '@/components/receipt-row';
import { CardShadow, Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { inflowBySource, type ReceiptSource, type WalletReceipt } from '@/lib/creator-wallet';
import { formatUSDC } from '@/lib/format';

/**
 * O topo da carteira: quanto o creator tem em USDC na Arc e de onde veio.
 *
 * O número é o saldo on-chain — o que está na carteira, não o que as campanhas
 * prometeram. Embaixo dele, a faixa de entradas dos últimos 30 dias, dividida
 * por origem: é a resposta à pergunta que vem logo depois de "quanto tenho?",
 * que é "isso veio de onde?". As cores batem com os ícones da lista.
 *
 * Sem nada recebido, a faixa dá lugar ao convite para receber — estado vazio é
 * o momento de dizer o que fazer, não de mostrar um zero triste.
 */

const WINDOW_DAYS = 30;
const SOURCES: ReceiptSource[] = ['campaign', 'purchase', 'transfer'];

export function WalletBalanceCard({
  balanceUsdc,
  receipts,
  isMock,
  onReceive,
  onDetails,
}: {
  balanceUsdc: number;
  /** `null` = a lista falhou; a faixa some, o saldo fica. */
  receipts: WalletReceipt[] | null;
  isMock: boolean;
  onReceive: () => void;
  /** Abre o detalhamento; sem ele, a faixa fica sem o "Details ›". */
  onDetails?: () => void;
}) {
  const [whole, cents] = formatUSDC(balanceUsdc).split('.');
  const empty = balanceUsdc === 0 && (receipts?.length ?? 0) === 0;

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <NetworkBadge />
        {isMock ? (
          <View style={styles.mockPill}>
            <Text style={styles.mockText}>Sample data</Text>
          </View>
        ) : null}
      </View>

      <View accessible accessibilityLabel={`USDC balance: ${formatUSDC(balanceUsdc)} dollars`}>
        <Text style={styles.eyebrow}>USDC balance</Text>
        <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          <Text style={styles.currency}>$</Text>
          {whole}
          <Text style={styles.cents}>.{cents}</Text>
        </Text>
      </View>

      {empty ? (
        <EmptyInvite onReceive={onReceive} />
      ) : receipts ? (
        <InflowRibbon receipts={receipts} onDetails={onDetails} />
      ) : null}
    </View>
  );
}

function EmptyInvite({ onReceive }: { onReceive: () => void }) {
  return (
    <View style={styles.invite}>
      <Text style={styles.inviteText}>
        No USDC yet. Share your address — campaign rewards and content sales are paid straight to it.
      </Text>
      <Pressable
        onPress={onReceive}
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <IconQr size={16} color={Colors.light.card} />
        <Text style={styles.primaryText}>Receive USDC</Text>
      </Pressable>
    </View>
  );
}

/**
 * A faixa cresce da esquerda uma vez, ao montar — o único movimento da tela.
 * Com "reduzir movimento" ligado no aparelho ela já nasce cheia.
 */
function InflowRibbon({ receipts, onDetails }: { receipts: WalletReceipt[]; onDetails?: () => void }) {
  // `Date.now()` no inicializador e não no corpo: o React Compiler trata
  // leitura de relógio no render como impura.
  const [since] = useState(() => Date.now() - WINDOW_DAYS * 86_400_000);
  const split = inflowBySource(receipts, since);
  const parts = SOURCES.filter((source) => split[source] > 0);

  // 0.001 e não 0: escala zero é matriz singular, que o RN avisa e que falha
  // na decomposição de transform em algumas versões do Android.
  const [grow] = useState(() => new Animated.Value(0.001));
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    if (reduceMotion) {
      grow.setValue(1);
      return;
    }
    Animated.timing(grow, {
      toValue: 1,
      duration: 700,
      delay: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [grow, reduceMotion]);

  // Nada na janela: sem faixa e sem frase. "Nenhum pagamento" seria afirmar o
  // que não sabemos — a fonte real de hoje não vê os pagamentos do agente.
  if (split.total === 0) return null;

  return (
    <View style={styles.inflow}>
      <View style={styles.inflowHead}>
        <Text style={styles.inflowLabel}>Received · last {WINDOW_DAYS} days</Text>
        <Text style={styles.inflowTotal}>+${formatUSDC(split.total)}</Text>
      </View>

      <Animated.View
        style={[styles.ribbon, { transform: [{ scaleX: grow }], transformOrigin: 'left' }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {parts.map((source) => (
          <View
            key={source}
            style={[styles.segment, { flex: split[source], backgroundColor: SOURCE_META[source].color }]}
          />
        ))}
      </Animated.View>

      <View style={styles.legend}>
        {parts.map((source) => (
          <View key={source} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: SOURCE_META[source].color }]} />
            <Text style={styles.legendName}>{SOURCE_META[source].plural}</Text>
            <Text style={styles.legendValue}>${formatUSDC(split[source])}</Text>
          </View>
        ))}
      </View>

      {onDetails ? (
        <Pressable
          onPress={onDetails}
          style={({ pressed }) => [styles.details, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="See the full breakdown of what you received"
        >
          <Text style={styles.detailsText}>See full breakdown</Text>
          <IconChevronRight size={16} sw={2.2} color={Colors.light.ink2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three,
    padding: Spacing.four - 4,
    borderRadius: Radius.xl,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
    ...CardShadow,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mockPill: {
    paddingHorizontal: Spacing.two,
    height: 22,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.warnSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.warnBorder,
  },
  mockText: { fontFamily: Fonts.bold, fontSize: 10, letterSpacing: 0.3, color: Colors.light.warn },

  eyebrow: {
    fontFamily: Fonts.bold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.light.ink3,
  },
  // O número lidera; o "$" e os centavos recuam para o cinza — quem olha lê
  // "74", não "$74.50" como um bloco só.
  amount: {
    fontFamily: Fonts.bold,
    fontSize: 56,
    lineHeight: 64,
    letterSpacing: -1.5,
    color: Colors.light.ink,
    fontVariant: ['tabular-nums'],
    marginTop: Spacing.one,
  },
  currency: { fontSize: 30, letterSpacing: 0, color: Colors.light.ink3 },
  cents: { fontSize: 30, letterSpacing: -0.5, color: Colors.light.ink3 },

  inflow: { gap: Spacing.two + 2 },
  inflowHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  inflowLabel: { fontFamily: Fonts.semibold, fontSize: 12, color: Colors.light.ink2 },
  inflowTotal: {
    fontFamily: Fonts.bold,
    fontSize: 13,
    color: Colors.light.ink,
    fontVariant: ['tabular-nums'],
  },
  ribbon: {
    flexDirection: 'row',
    gap: 3,
    height: 10,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  segment: { height: '100%', borderRadius: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  legendDot: { width: 8, height: 8, borderRadius: Radius.pill },
  legendName: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.light.ink2 },
  legendValue: {
    fontFamily: Fonts.bold,
    fontSize: 12,
    color: Colors.light.ink,
    fontVariant: ['tabular-nums'],
  },

  details: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.three - 2,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.bg,
  },
  detailsText: { fontFamily: Fonts.bold, fontSize: 13, color: Colors.light.ink },

  invite: { gap: Spacing.three },
  inviteText: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 21, color: Colors.light.ink2 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accent,
  },
  primaryText: { fontFamily: Fonts.bold, fontSize: 15, color: Colors.light.card },
  pressed: { opacity: 0.8 },
});
