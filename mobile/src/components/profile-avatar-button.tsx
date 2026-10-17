import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Circle, Svg } from 'react-native-svg';

import { IconUser } from '@/components/icons';
import { Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { makeStyles, useTheme } from '@/hooks/use-theme';

/**
 * Bolinha do perfil no header, com duas animações que respondem a coisas
 * diferentes:
 *
 *  1. **Mola no toque:** encolhe ao apertar e, ao soltar, passa um pouco do
 *     tamanho (~1.05) antes de assentar. Responde ao dedo, abrindo ou não.
 *  2. **Anel que se desenha:** um traço no acento percorre a volta do avatar
 *     quando o painel de perfil abre, fica enquanto ele está aberto e se
 *     desfaz ao fechar. É o mesmo vocabulário do `MenuToggleIcon`, em que o
 *     traço anda e marca qual botão do header está aberto.
 *
 * O fechamento usa o mesmo tempo do `DropdownPanel` (160 ms), então anel e
 * painel somem juntos. Com "Reduzir movimento" não há mola e o anel aparece
 * pronto.
 */

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Diâmetro do avatar, o mesmo de antes. */
const SIZE = 30;
/** Folga entre a foto e o anel: sem ela o anel parece uma borda da foto. */
const GAP = 2.5;
const RING_SW = 2;
const RING_R = SIZE / 2 + GAP + RING_SW / 2;
const RING_BOX = RING_R * 2 + RING_SW;
const CIRCUMFERENCE = 2 * Math.PI * RING_R;

/** Igual ao `CLOSE_MS` do `dropdown-panel`. */
const CLOSE_MS = 160;
/** O anel leva um pouco mais que a mola do painel, para o traço ser visto andando. */
const DRAW_MS = 380;

interface ProfileAvatarButtonProps {
  open: boolean;
  onPress?: () => void;
  photo?: string | null;
}

export function ProfileAvatarButton({ open, onPress, photo }: ProfileAvatarButtonProps) {
  const colors = useTheme();
  const styles = useStyles();
  const reduce = useReduceMotion();
  const scale = useSharedValue(1);
  const ring = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    if (reduce) {
      ring.value = open ? 1 : 0;
      return;
    }
    ring.value = open
      ? withTiming(1, { duration: DRAW_MS, easing: Easing.out(Easing.cubic) })
      : withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.quad) });
  }, [open, reduce, ring]);

  const press = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const draw = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - ring.value),
    // Com o traço vazio, a ponta arredondada ainda pintaria um ponto às 12h.
    strokeOpacity: ring.value > 0.01 ? 1 : 0,
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        if (reduce) return;
        scale.set(withSpring(0.88, { damping: 15, stiffness: 420 }));
      }}
      onPressOut={() => {
        if (reduce) return;
        // Subamortecida (ζ ≈ 0.25): o overshoot é o "boing" ao soltar.
        scale.set(withSpring(1, { damping: 8, stiffness: 260 }));
      }}
      hitSlop={Spacing.two}
      accessibilityRole="button"
      accessibilityLabel={open ? 'Fechar perfil' : 'Perfil'}
      accessibilityState={{ expanded: open }}
    >
      <Animated.View style={[styles.box, press]}>
        {/* Avatar: a foto de perfil quando há (a mesma do card de share e do
            menu), senão o círculo cheio no acento — um dos poucos usos
            permitidos. */}
        <View style={styles.avatar}>
          {photo ? (
            <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} />
          ) : (
            <IconUser size={18} sw={2} color={colors.onAccent} />
          )}
        </View>

        {/* Fora do `overflow: hidden` do avatar, senão o anel seria cortado. */}
        <Svg
          width={RING_BOX}
          height={RING_BOX}
          style={styles.ring}
          pointerEvents="none"
        >
          <AnimatedCircle
            cx={RING_BOX / 2}
            cy={RING_BOX / 2}
            r={RING_R}
            fill="none"
            stroke={colors.accent}
            strokeWidth={RING_SW}
            strokeLinecap="round"
            strokeDasharray={[CIRCUMFERENCE, CIRCUMFERENCE]}
            // Começa às 12h e corre no sentido horário.
            transform={`rotate(-90 ${RING_BOX / 2} ${RING_BOX / 2})`}
            animatedProps={draw}
          />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  box: { width: SIZE, height: SIZE },
  avatar: {
    width: SIZE,
    height: SIZE,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ring: {
    position: 'absolute',
    top: (SIZE - RING_BOX) / 2,
    left: (SIZE - RING_BOX) / 2,
  },
}));
