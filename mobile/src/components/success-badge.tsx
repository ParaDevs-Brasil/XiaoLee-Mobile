import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { IconCheck } from '@/components/icons';
import { Pop } from '@/components/motion';
import { Radius } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { makeStyles, useTheme } from '@/hooks/use-theme';

/**
 * Selo de sucesso do on/off-ramp: o check "estoura" com mola, um halo se expande uma vez e um punhado de
 * confete nas cores da marca sobe e cai. Tudo no driver nativo (opacity/transform) e uma vez só; com
 * "Reduzir movimento" fica o selo parado, sem halo nem confete.
 */

const SIZE = 72;
const PIECES = 16;

/** Ângulo, alcance e giro de cada pedaço, fixos pelo índice — render sem aleatoriedade, igual a cada abertura. */
const spread = (i: number) => {
  const angle = (i / PIECES) * Math.PI * 2 + (i % 2) * 0.3;
  const reach = 62 + (i % 4) * 14;
  return { dx: Math.cos(angle) * reach, dy: Math.sin(angle) * reach, spin: (i % 2 ? 1 : -1) * (180 + (i % 3) * 90) };
};

export function SuccessBadge() {
  const colors = useTheme();
  const styles = useStyles();
  const reduce = useReduceMotion();
  const [t] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduce) return;
    Animated.timing(t, { toValue: 1, duration: 1300, delay: 120, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduce, t]);

  const palette = [colors.accent, colors.warn, colors.success, colors.accent];

  return (
    <View style={styles.wrap}>
      {reduce
        ? null
        : Array.from({ length: PIECES }, (_, i) => {
            const { dx, dy, spin } = spread(i);
            const size = 6 + (i % 3) * 2;
            return (
              <Animated.View
                key={i}
                style={{
                  position: 'absolute',
                  width: size,
                  height: i % 2 ? size : size * 1.8,
                  borderRadius: i % 2 ? Radius.pill : 2,
                  backgroundColor: palette[i % palette.length],
                  opacity: t.interpolate({ inputRange: [0, 0.08, 0.7, 1], outputRange: [0, 1, 1, 0] }),
                  transform: [
                    { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
                    // Sobe até `dy` e a gravidade puxa de volta no fim.
                    { translateY: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, dy, dy + 36] }) },
                    { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${spin}deg`] }) },
                  ],
                }}
              />
            );
          })}
      {reduce ? null : (
        <Animated.View
          style={[
            styles.halo,
            {
              opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
              transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }) }],
            },
          ]}
        />
      )}
      <Pop style={styles.badge}>
        <IconCheck size={34} sw={3} color={colors.onAccent} />
      </Pop>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { alignSelf: 'center', width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center', marginVertical: 12 },
  halo: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: Radius.pill, backgroundColor: colors.successFill },
  badge: { width: SIZE, height: SIZE, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successFill },
}));
