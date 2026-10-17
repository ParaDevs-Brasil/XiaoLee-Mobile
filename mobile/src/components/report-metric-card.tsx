import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconTrendingDown, IconTrendingUp, type IconProps } from '@/components/icons';
import { useReveal } from '@/components/motion';
import { CardShadow, Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useTweenedValues } from '@/hooks/use-tweened-values';
import { formatMetricValue, type DeltaTone, type MetricRow } from '@/lib/creator-report';

/**
 * Cartão de métrica do relatório de 30 dias: chip de ícone, rótulo, o número e
 * a variação contra os 30 dias anteriores.
 *
 * A variação é a parte que a tela existe para mostrar, então ela fala duas
 * vezes: em texto (seta verde subindo, vermelha descendo — é onde o dado
 * realmente mora) e em duas barras (anterior em cinza, atual no acento). As
 * barras são só atalho visual para o olho; escondidas do leitor de tela, que
 * lê o texto.
 *
 * Só temos dois pontos por métrica, então são duas barras, não uma curva: uma
 * linha suave entre dois pontos inventaria uma trajetória que não foi medida.
 *
 * Entrada (em cascata pela posição `index`): o cartão sobe com mola, o número
 * conta de 0 até o valor, as barras crescem uma depois da outra e a variação
 * aparece por último — assim o olho lê o número antes da comparação.
 */

const DELTA_COLOR: Record<DeltaTone, string> = {
  up: Colors.light.success,
  new: Colors.light.success,
  down: Colors.light.danger,
  flat: Colors.light.ink3,
};

/** Seta verde subindo quando cresceu (ou apareceu), vermelha descendo quando caiu; igual não leva seta. */
const DELTA_ICON: Record<DeltaTone, ((p: IconProps) => React.ReactElement) | null> = {
  up: IconTrendingUp,
  new: IconTrendingUp,
  down: IconTrendingDown,
  flat: null,
};

const BAR_MAX_HEIGHT = 30;
/** O número só começa a contar depois que o cartão já subiu. */
const COUNT_DELAY_MS = 260;
const COUNT_MS = 850;
const STEP_MS = 70;

interface ReportMetricCardProps {
  row: MetricRow;
  Icon: (p: IconProps) => React.ReactElement;
  /** Linha larga (rótulo e número lado a lado), para a métrica que não precisa de barras — o USDC. */
  wide?: boolean;
  /** Posição na cascata de entrada da tela. */
  index?: number;
}

export function ReportMetricCard({ row, Icon, wide = false, index = 0 }: ReportMetricCardProps) {
  const reveal = useReveal(index);
  const shown = useCountUp(row.now, index * STEP_MS + COUNT_DELAY_MS);
  const value = formatMetricValue(row.key, shown);
  const label = `${row.label}: ${row.value}. ${row.delta}`;

  const chip = (
    <View style={styles.chip}>
      <Icon size={18} color={Colors.light.accent} />
    </View>
  );

  if (wide) {
    return (
      <Animated.View
        style={[styles.card, styles.wide, reveal]}
        accessible
        accessibilityLabel={label}
      >
        {chip}
        <View style={styles.flex}>
          <Text style={styles.label}>{row.label}</Text>
          <Delta row={row} index={index} />
        </View>
        <Text style={styles.valueWide}>{value}</Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.card, styles.tile, reveal]} accessible accessibilityLabel={label}>
      <View style={styles.head}>
        {chip}
        <Text style={[styles.label, styles.flex]} numberOfLines={2}>
          {row.label}
        </Text>
      </View>
      <View style={styles.valueRow}>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {value}
        </Text>
        <PeriodBars before={row.before} now={row.now} index={index} />
      </View>
      <Delta row={row} index={index} />
    </Animated.View>
  );
}

/**
 * Do 0 até `target`, depois de `delay` ms. Com "Reduzir movimento" devolve o
 * valor final na hora. O atraso arma o alvo só depois do tempo da cascata — sem
 * isso o número já estaria contando enquanto o cartão ainda nem apareceu.
 */
function useCountUp(target: number, delay: number): number {
  const reduce = useReduceMotion();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (reduce) return;
    const timer = setTimeout(() => setArmed(true), delay);
    return () => clearTimeout(timer);
  }, [reduce, delay]);

  const [shown] = useTweenedValues([armed ? target : 0], { duration: COUNT_MS, disabled: reduce });
  return reduce ? target : shown;
}

function Delta({ row, index }: { row: MetricRow; index: number }) {
  // A variação entra por último e sobe só um pouco: é leitura de apoio, não manchete.
  const reveal = useReveal(index, { rise: 6, delay: COUNT_DELAY_MS + 500 });

  // Sem variação a mostrar (os dois períodos em zero) o traço segura a altura do
  // cartão, para a grade não ficar com uma linha mais baixa que a vizinha.
  if (!row.delta) {
    return <Text style={styles.deltaEmpty}>—</Text>;
  }
  const Arrow = DELTA_ICON[row.tone];
  const color = DELTA_COLOR[row.tone];
  return (
    <Animated.View style={[styles.delta, reveal]}>
      {Arrow ? <Arrow size={14} sw={2.2} color={color} /> : null}
      <Text style={[styles.deltaText, { color }]} numberOfLines={2}>
        {row.delta}
      </Text>
    </Animated.View>
  );
}

function PeriodBars({ before, now, index }: { before: number; now: number; index: number }) {
  const max = Math.max(before, now);
  if (max <= 0) return null;
  // Valor zero ainda deixa um traço fino, senão o período "vazio" some e a
  // comparação perde a referência.
  const height = (value: number) => Math.max(value > 0 ? 5 : 2, (value / max) * BAR_MAX_HEIGHT);
  const start = index * STEP_MS + COUNT_DELAY_MS;

  return (
    <View
      style={styles.bars}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Bar style={styles.barBefore} height={height(before)} delay={start} />
      {/* O período atual cresce depois do anterior: primeiro a referência, depois a resposta. */}
      <Bar style={styles.barNow} height={height(now)} delay={start + 160} />
    </View>
  );
}

function Bar({
  style,
  height,
  delay,
}: {
  style: StyleProp<ViewStyle>;
  height: number;
  delay: number;
}) {
  const reduce = useReduceMotion();
  const [grow] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduce) {
      grow.setValue(1);
      return;
    }
    const run = Animated.sequence([
      Animated.delay(delay),
      Animated.spring(grow, {
        toValue: 1,
        damping: 12,
        stiffness: 140,
        mass: 0.9,
        useNativeDriver: true,
      }),
    ]);
    run.start();
    return () => run.stop();
  }, [reduce, delay, grow]);

  // Cresce a partir da base: a base é a linha zero.
  return <Animated.View style={[styles.bar, style, { height, transform: [{ scaleY: grow }] }]} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    padding: Spacing.three - 2,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
    ...CardShadow,
  },
  // Dois por linha numa grade com `flexWrap`: a base de 47% + o gap cabem duas, e `flexGrow` reparte a sobra.
  tile: { flexGrow: 1, flexBasis: '47%', gap: Spacing.two },
  wide: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  chip: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.accentSoft,
  },
  label: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 17, color: Colors.light.ink2 },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  value: {
    flexShrink: 1,
    fontFamily: Fonts.bold,
    fontSize: 30,
    lineHeight: 36,
    color: Colors.light.ink,
  },
  valueWide: { fontFamily: Fonts.bold, fontSize: 24, color: Colors.light.ink },

  delta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  deltaText: { flexShrink: 1, fontFamily: Fonts.medium, fontSize: 12 },
  deltaEmpty: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.light.ink3 },

  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: BAR_MAX_HEIGHT,
    paddingBottom: 4,
  },
  bar: {
    width: 9,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    transformOrigin: 'bottom',
  },
  barBefore: { backgroundColor: Colors.light.ink3, opacity: 0.35 },
  barNow: { backgroundColor: Colors.light.accent },
});
