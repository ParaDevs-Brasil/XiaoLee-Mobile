import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

import { useReduceMotion } from '@/hooks/use-reduce-motion';

/**
 * Primitivas de movimento das telas de relatório: entrada em cascata, "pop" e
 * o brilho que pulsa. Tudo roda no driver nativo (só `opacity` e `transform`),
 * então nada disso disputa a thread de JS com a tela carregando.
 *
 * Usa o `Animated` do React Native e não o Reanimated, como o resto do app
 * (`dropdown-panel`, `animated-avatar`): molas com sobressalto leve, e com
 * "Reduzir movimento" ligado cada uma vira o estado final na hora — sem
 * deslocamento, sem laço.
 */

/** Intervalo entre um item e o próximo na cascata. */
const STEP_MS = 70;
/**
 * Teto do escalonamento: quem está lá embaixo na página não pode esperar um
 * segundo para existir, então a partir daqui todos entram juntos.
 */
const MAX_STAGGER = 9;

interface RevealOptions {
  /** Quanto o item sobe até assentar, em px. */
  rise?: number;
  /** Atraso extra além da posição na cascata, em ms. */
  delay?: number;
}

/**
 * Estilo animado de "entrar": sobe de `rise` px com mola e aparece. `index` é a
 * posição na cascata. Devolve o estilo em vez de um componente para quem
 * precisa que a raiz da própria view seja a `Animated.View` (o cartão da grade
 * tem tamanho próprio, e um wrapper quebraria a grade).
 */
export function useReveal(index = 0, { rise = 18, delay = 0 }: RevealOptions = {}) {
  const reduce = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    const run = Animated.sequence([
      Animated.delay(Math.min(index, MAX_STAGGER) * STEP_MS + delay),
      Animated.spring(progress, {
        toValue: 1,
        damping: 15,
        stiffness: 150,
        mass: 1,
        useNativeDriver: true,
      }),
    ]);
    run.start();
    return () => run.stop();
  }, [reduce, index, delay, progress]);

  return {
    // Aparece na primeira metade do movimento; o resto é a mola assentando.
    opacity: progress.interpolate({
      inputRange: [0, 0.5],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    }),
    // Sem `clamp` de propósito: passar de 1 faz o item ultrapassar o lugar e voltar.
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) },
    ],
  };
}

export function Reveal({
  index = 0,
  style,
  children,
}: {
  index?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const motion = useReveal(index);
  return <Animated.View style={[style, motion]}>{children}</Animated.View>;
}

/** Entra crescendo de 0,6 a 1 com mola — para selos e chips que "estouram" na tela. */
export function Pop({
  delay = 0,
  style,
  children,
}: {
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduce = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    const run = Animated.sequence([
      Animated.delay(delay),
      Animated.spring(progress, {
        toValue: 1,
        damping: 9,
        stiffness: 180,
        mass: 0.8,
        useNativeDriver: true,
      }),
    ]);
    run.start();
    return () => run.stop();
  }, [reduce, delay, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress.interpolate({
            inputRange: [0, 0.4],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          }),
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Pulsa e gira de leve, em laço — o brilho da IA. Devagar o bastante (≈2 s por
 * ciclo) para ser presença e não distração; com "Reduzir movimento", parado.
 */
export function Twinkle({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduce = useReduceMotion();
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduce) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, pulse]);

  return (
    <Animated.View
      style={[
        style,
        {
          transform: [
            { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) },
            { rotate: pulse.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '16deg'] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Desliza de lado para entrar — a troca de abas. `from` é o sentido de onde o conteúdo vem: `1` entra pela direita
 * (aba seguinte), `-1` pela esquerda (aba anterior). Remonte com `key` para animar a cada troca.
 */
export function SlideIn({
  from = 1,
  style,
  children,
}: {
  from?: 1 | -1;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduce = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [reduce, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress.interpolate({ inputRange: [0, 0.6], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [from * 56, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
