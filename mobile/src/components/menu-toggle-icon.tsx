import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Path, Svg } from 'react-native-svg';

import { useReduceMotion } from '@/hooks/use-reduce-motion';

/**
 * Hambúrguer que vira X: um traço só e não três linhas trocadas por outras.
 *
 * O desenho vem do `menu-toggle-icon` do shadcn (web). As linhas de cima e de
 * baixo são as duas pontas do **mesmo** path, que faz um laço e desce na
 * vertical pelo meio. Fechado, o tracejado mostra só as pontas. Aberto, ele
 * desliza até mostrar só a vertical, e o ícone gira -45°: a vertical e a linha
 * do meio formam o X. Não há troca de ícone, e o traço visivelmente "anda".
 *
 * Por que as linhas são de tamanhos diferentes (12 / 20 / 14, desalinhadas):
 * é o desenho original e é o que dá cara ao ícone. O ícone antigo, de três
 * linhas iguais, era o hambúrguer genérico do Material.
 *
 * Movimento igual ao do `DropdownPanel` que o ícone abre: mola ao abrir (a
 * rotação passa um pouco de -45° e volta) e curva rápida ao fechar, no mesmo
 * tempo do painel. Os dois saem juntos. Roda no Reanimated (UI thread)
 * porque o `Animated` do RN não interpola `strokeDasharray`.
 */

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Igual ao `CLOSE_MS` do `dropdown-panel`. */
const CLOSE_MS = 160;

/**
 * Pontas do path: primeiro o laço de cima, a vertical do meio, depois o laço de
 * baixo. Coordenadas do original, num viewBox de 32.
 */
const LOOP_PATH =
  'M27 10 13 10C10.8 10 9 8.2 9 6 9 3.5 10.8 2 13 2 15.2 2 17 3.8 17 6L17 26C17 28.2 18.8 30 21 30 23.2 30 25 28.2 25 26 25 23.8 23.2 22 21 22L7 22';

interface MenuToggleIconProps {
  open: boolean;
  /** Lado do quadrado, em px. */
  size?: number;
  /** Espessura do traço, em unidades do viewBox (32). */
  sw?: number;
  color: string;
  /** Pílula que aparece atrás do ícone aberto. Sem ela, nada é desenhado. */
  activeFill?: string;
}

export function MenuToggleIcon({ open, size = 30, sw = 2.5, color, activeFill }: MenuToggleIconProps) {
  const reduce = useReduceMotion();
  const progress = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    if (reduce) {
      progress.value = open ? 1 : 0;
      return;
    }
    progress.value = open
      ? // Mesma mola do painel (ζ ≈ 0.6): ~8% de overshoot e assenta.
        withSpring(1, { damping: 17, stiffness: 210, mass: 0.9 })
      : withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.quad) });
  }, [open, reduce, progress]);

  // Só a rotação aproveita o overshoot. O tracejado fica preso em [0, 1], porque
  // passar do fim da vertical mostraria o começo do laço.
  const spin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(progress.value, [0, 1], [0, -45])}deg` }],
  }));

  const dash = useAnimatedProps(() => {
    const t = Math.min(Math.max(progress.value, 0), 1);
    return {
      strokeDasharray: [interpolate(t, [0, 1], [12, 20]), interpolate(t, [0, 1], [63, 300])],
      strokeDashoffset: interpolate(t, [0, 1], [0, -32.42]),
    };
  });

  const pill = useAnimatedStyle(() => ({
    opacity: Math.min(Math.max(progress.value, 0), 1),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.6, 1]) }],
  }));

  return (
    <View style={{ width: size, height: size }}>
      {activeFill ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.pill, { backgroundColor: activeFill, inset: -size * 0.2 }, pill]}
        />
      ) : null}
      <Animated.View style={spin}>
        <Svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <AnimatedPath d={LOOP_PATH} animatedProps={dash} />
          <Path d="M7 16 27 16" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { position: 'absolute', borderRadius: 999 },
});
