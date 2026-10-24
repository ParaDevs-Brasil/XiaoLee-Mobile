import { useEffect, useState, type ComponentProps } from 'react';
import { Animated, Easing, Pressable } from 'react-native';

import { useReduceMotion } from '@/hooks/use-reduce-motion';

/**
 * Movimento de toque e de seleção: o card afunda sob o dedo e volta com mola, e uma troca de estado
 * (aba, formato, opção) funde de um para o outro em vez de estalar. Só `opacity` e `transform`, no driver
 * nativo. Com "Reduzir movimento" ligado, tudo vira o estado final na hora.
 */

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<ComponentProps<typeof Pressable>, 'style'> & {
  style?: ComponentProps<typeof Animated.View>['style'];
  /** Escala enquanto o dedo está em cima. Cards grandes pedem um recuo menor que botões pequenos. */
  scaleTo?: number;
};

/** `Pressable` que afunda ao toque. Troca direta pelo `Pressable` quando o estilo não depende de `pressed`. */
export function PressableScale({
  scaleTo = 0.97,
  style,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps) {
  const reduce = useReduceMotion();
  const [scale] = useState(() => new Animated.Value(1));

  const to = (value: number) => {
    if (reduce) return;
    Animated.spring(scale, {
      toValue: value,
      damping: 16,
      stiffness: 320,
      mass: 0.6,
      useNativeDriver: true,
    }).start();
  };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        if (!disabled) to(scaleTo);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
      style={[style, { transform: [{ scale }] }]}
    />
  );
}

/**
 * Leva 0 → 1 (e de volta) conforme `on` muda. Use como `opacity` de uma camada "ligada" empilhada sobre a
 * "desligada": a troca vira um fundido (e não dá para animar cor com o driver nativo).
 */
export function useToggleProgress(on: boolean, duration = 220) {
  const reduce = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(on ? 1 : 0));

  useEffect(() => {
    if (reduce) {
      progress.setValue(on ? 1 : 0);
      return;
    }
    const run = Animated.timing(progress, {
      toValue: on ? 1 : 0,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [on, reduce, duration, progress]);

  return progress;
}

/** Selo que estoura (0,4 → 1, com mola) quando `on` vira verdadeiro e some rápido quando vira falso. */
export function useBadgePop(on: boolean) {
  const reduce = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(on ? 1 : 0));

  useEffect(() => {
    if (reduce) {
      progress.setValue(on ? 1 : 0);
      return;
    }
    const run = on
      ? Animated.spring(progress, { toValue: 1, damping: 9, stiffness: 220, mass: 0.7, useNativeDriver: true })
      : Animated.timing(progress, { toValue: 0, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [on, reduce, progress]);

  return {
    opacity: progress.interpolate({ inputRange: [0, 0.5], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
  };
}
