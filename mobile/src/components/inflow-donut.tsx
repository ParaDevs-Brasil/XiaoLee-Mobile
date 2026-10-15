import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { SOURCE_META } from '@/components/receipt-row';
import { Colors, Fonts } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useTweenedValues } from '@/hooks/use-tweened-values';
import { SOURCE_ORDER, type ReceiptSource, type SourceBreakdown } from '@/lib/creator-wallet';
import { formatUSDC } from '@/lib/format';

/**
 * Donut das entradas por origem — parte do todo, no máximo 3 fatias.
 *
 * Segue a skill de dataviz: as fatias são separadas por um vão da cor do
 * cartão (nunca encostam), a cor é a da origem (`SOURCE_META`, a mesma da
 * faixa e da lista) e o número nunca depende só da cor — a legenda ao lado
 * traz valor, % e contagem. Com uma origem selecionada, as outras recuam e o
 * centro passa a falar dela.
 *
 * Trocar o período **transforma** o donut em vez de trocá-lo: cada fatia
 * cresce ou encolhe até a nova proporção, e o total do centro conta junto
 * (`useTweenedValues`). Por isso as três origens existem sempre, valendo 0
 * quando ausentes — é o que deixa uma fatia nascer do nada ou sumir encolhendo.
 */

/** Vão entre fatias, em px de arco — o "spacer" de 2px da skill, mais a folga do traço. */
const GAP = 3;

export function InflowDonut({
  sources,
  selected,
  size = 176,
  stroke = 22,
}: {
  sources: SourceBreakdown[];
  selected: ReceiptSource | null;
  size?: number;
  stroke?: number;
}) {
  const reduceMotion = useReduceMotion();
  const target = SOURCE_ORDER.map((source) => sources.find((entry) => entry.source === source)?.total ?? 0);
  // Fatias e total andam do mesmo valor, no mesmo quadro: o centro é a soma
  // do que está desenhado, nunca um número à frente do anel.
  const values = useTweenedValues(target, { disabled: reduceMotion });
  const total = values.reduce((sum, value) => sum + value, 0);

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Sem reatribuir variável dentro do `map`: o React Compiler recusa mutação
  // de variável do render dentro de callback. O início de cada fatia é a soma
  // das anteriores.
  const lengths = values.map((value) => (total > 0 ? (value / total) * circumference : 0));
  // Uma fatia só é o anel inteiro — vão ali deixaria um corte sem motivo.
  const visible = lengths.filter((length) => length > 0.5).length;
  const gap = visible > 1 ? GAP : 0;
  const arcs = SOURCE_ORDER.map((source, i) => ({
    source,
    dash: Math.max(lengths[i] - gap, 0),
    offset: lengths.slice(0, i).reduce((sum, length) => sum + length, 0),
  }));

  const focusIndex = selected ? SOURCE_ORDER.indexOf(selected) : -1;
  const focus = focusIndex >= 0 ? sources.find((entry) => entry.source === selected) : undefined;
  const summary = sources.map((entry) => `${SOURCE_META[entry.source].plural} ${entry.percent}%`).join(', ');
  const finalTotal = target.reduce((sum, value) => sum + value, 0);

  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="image"
      // O leitor de tela recebe o valor final, não um número no meio da animação.
      accessibilityLabel={`Received ${formatUSDC(finalTotal)} USDC. ${summary}.`}
    >
      <Svg width={size} height={size}>
        {/* Trilho: aparece só nos vãos e quando não há nada a desenhar. */}
        <Circle cx={center} cy={center} r={radius} stroke={Colors.light.bg} strokeWidth={stroke} fill="none" />
        {/* -90° para a primeira fatia começar às 12h, como um relógio. */}
        <G rotation={-90} origin={`${center}, ${center}`}>
          {arcs.map(({ source, dash, offset }) =>
            dash > 0 ? (
              <Circle
                key={source}
                cx={center}
                cy={center}
                r={radius}
                stroke={SOURCE_META[source].color}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                fill="none"
                opacity={!selected || selected === source ? 1 : 0.25}
              />
            ) : null,
          )}
        </G>
      </Svg>

      <View style={styles.center} pointerEvents="none">
        <Text style={styles.centerValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          ${formatUSDC(focus ? values[focusIndex] : total)}
        </Text>
        <Text style={styles.centerLabel}>
          {focus ? `${SOURCE_META[focus.source].plural} · ${focus.percent}%` : 'received'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  centerValue: {
    fontFamily: Fonts.bold,
    fontSize: 24,
    color: Colors.light.ink,
    fontVariant: ['tabular-nums'],
  },
  centerLabel: { fontFamily: Fonts.semibold, fontSize: 11, color: Colors.light.ink3, marginTop: 2 },
});
