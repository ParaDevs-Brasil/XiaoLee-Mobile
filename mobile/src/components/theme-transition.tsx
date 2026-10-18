import { useLayoutEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { ThemeTransitionOrigin } from '@/hooks/use-theme';

/**
 * Troca de tema animada: um círculo na cor de fundo do tema novo cresce a
 * partir do ponto tocado até cobrir a tela, o tema troca por baixo, e o
 * círculo se dissolve revelando o app já no tema novo.
 *
 *  1. `expanding` — o círculo cresce (UI thread) e chama `onCovered`;
 *  2. `ThemeProvider` troca o tema; o app inteiro re-renderiza escondido;
 *  3. `revealing` — no commit seguinte o véu esmaece e chama `onDone`.
 *
 * A primeira versão fotografava a tela (`react-native-view-shot`) e abria um
 * furo na foto. No aparelho não serviu: a captura do Android desenha a árvore
 * num canvas de software, que não renderizava o painel de perfil aberto nem o
 * avatar em vídeo (saía um disco preto), e entre captura e decodificação a
 * foto ficava ~1s congelada num celular de entrada. O véu não depende de foto
 * nenhuma, e o re-render pesado — o app inteiro troca de estilos — acontece
 * debaixo dele, em vez de travar uma foto na tela.
 *
 * Com "reduzir movimento" o véu não cresce: só aparece e some rápido.
 */

export type ThemeTransitionPhase = 'expanding' | 'revealing';

interface ThemeTransitionProps {
  origin: ThemeTransitionOrigin;
  /** `bg` do tema que vai entrar. */
  color: string;
  phase: ThemeTransitionPhase;
  reduceMotion: boolean;
  /** Tamanho da área coberta (a View raiz do app). */
  width: number;
  height: number;
  onCovered: () => void;
  onDone: () => void;
}

const EXPAND_MS = 300;
const REVEAL_MS = 180;
const REDUCED_MS = 140;

export function ThemeTransition({
  origin,
  color,
  phase,
  reduceMotion,
  width,
  height,
  onCovered,
  onDone,
}: ThemeTransitionProps) {
  const scale = useSharedValue(reduceMotion ? 1 : 0);
  const opacity = useSharedValue(reduceMotion ? 0 : 1);

  // Distância até o canto mais longe: o círculo termina cobrindo a tela toda,
  // nem antes (sobraria canto descoberto) nem muito depois (pareceria lento).
  const radius = Math.hypot(
    Math.max(origin.x, width - origin.x),
    Math.max(origin.y, height - origin.y),
  );

  // Layout effect: no `revealing` o véu precisa começar a sumir logo após o
  // commit que trocou o tema, sem esperar os efeitos de todas as telas.
  useLayoutEffect(() => {
    const done = (callback: () => void) => (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(callback);
    };

    if (phase === 'expanding') {
      if (reduceMotion) {
        opacity.value = withTiming(1, { duration: REDUCED_MS }, done(onCovered));
      } else {
        scale.value = withTiming(
          1,
          { duration: EXPAND_MS, easing: Easing.bezier(0.65, 0, 0.35, 1) },
          done(onCovered),
        );
      }
      return;
    }

    // `revealing` chega no commit em que o app já re-renderizou no tema novo.
    // Sem esperar frame: a curva começa devagar, então se a montagem nativa
    // atrasar um frame o véu ainda está opaco por cima dela.
    opacity.value = withTiming(
      0,
      { duration: reduceMotion ? REDUCED_MS : REVEAL_MS, easing: Easing.in(Easing.quad) },
      done(onDone),
    );
    // Cada fase dispara uma vez; os callbacks mudam a cada render do provider
    // e reiniciar a animação por causa deles a faria pular.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const veil = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    // Engole os toques durante a troca — um toque agora cairia numa tela que
    // está trocando de estilos por baixo.
    <Animated.View style={styles.cover} onStartShouldSetResponder={() => true}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: origin.x - radius,
            top: origin.y - radius,
            width: radius * 2,
            height: radius * 2,
            borderRadius: radius,
            backgroundColor: color,
          },
          veil,
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    elevation: 1000,
  },
});
