import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/theme';
import { hasSeenIntro, markIntroSeen } from '@/lib/intro';

/**
 * Intro em vídeo — a primeira coisa que o usuário vê ao abrir o app, toda
 * vez. O vídeo (`assets/videos/xiaolee-intro.mp4`, 1080x1920, com voz) já
 * traz um botão "START" desenhado nele mesmo, sempre na mesma posição
 * (centralizado, perto do rodapé, do primeiro ao último frame — conferido
 * quadro a quadro). Este componente só sobrepõe uma área tocável ali, em vez
 * de recriar o botão do zero.
 *
 * Toca em toda abertura fria do app — não é uma tela de onboarding que
 * some para sempre. O que muda depois da primeira vez é só o botão de
 * pular, que aparece porque o usuário já sabe o que vem a seguir.
 */

interface IntroVideoProps {
  /** Chamado quando o usuário toca START ou pula. */
  onFinish: () => void;
}

const VIDEO_SOURCE = require('../../assets/videos/xiaolee-intro.mp4');

/** Dimensões nativas do vídeo — a base do cálculo de enquadramento abaixo. */
const VIDEO_W = 1080;
const VIDEO_H = 1920;

/**
 * Cor de fundo do próprio vídeo (amostrada num canto, longe do desenho —
 * `ffmpeg -vf fps=2` + pick de pixel). Usada como cor do container antes do
 * primeiro frame renderizar/enquanto mede o layout — e é a mesma cor do
 * `backgroundColor` do splash nativo em `app.json` (plugin
 * `expo-splash-screen`), de propósito: o splash nativo (inevitável, roda
 * antes do JS) funde direto no vídeo em vez de parecer uma tela própria. Se
 * o vídeo mudar de cor de fundo, atualizar os dois juntos.
 */
const VIDEO_BG = '#E94C91';

/**
 * `cover` (proporção original, sem distorcer) corta demais em alguns
 * aparelhos — o suficiente para tampar o balão "Hi" no canto superior
 * esquerdo e o nome "Xiaolee" perto do rodapé. `fill`/misturas mais fortes
 * já foram tentadas e descartadas: esticam o desenho, deixando a personagem
 * "magrela".
 *
 * A correção é um empurrão pequeno na direção de `fill` — só o necessário
 * pra sobrar mais dos dois lados e revelar as bordas, sem que o olho note a
 * distorção. `0` seria `cover` puro; isto está perto disso.
 */
const STRETCH_AMOUNT = 0.18;

/**
 * Área tocável do botão "START", em fração do frame original do vídeo (0 a
 * 1) — medida quadro a quadro no fonte (`ffmpeg -vf fps=2`, 16 frames): fica
 * nos mesmos ~33%-65% da largura e ~93%-97,5% da altura do primeiro ao
 * último frame, sem precisar sincronizar com o tempo de reprodução. A margem
 * aqui é só folga de toque.
 */
const START_BUTTON_FRACTION = { x0: 0.3, x1: 0.7, y0: 0.905, y1: 0.98 };

export function IntroVideo({ onFinish }: IntroVideoProps) {
  const insets = useSafeAreaInsets();
  const [canSkip, setCanSkip] = useState(false);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>();

  const player = useVideoPlayer(VIDEO_SOURCE, (p) => {
    // Sem loop: a fala dela é pra acontecer uma vez só. Sem repetir, o player
    // já para sozinho no último frame — que já tem o "START" desenhado nele
    // (ver comentário no topo do arquivo), então continua parado e tocável
    // sem precisar de nenhuma lógica extra de fim-de-vídeo.
    p.loop = false;
    p.play();
  });

  useEffect(() => {
    hasSeenIntro().then(setCanSkip);
  }, []);

  function finish() {
    void markIntroSeen();
    onFinish();
  }

  // Sem loop, o player emite isto uma vez só quando chega no fim — segue pro
  // chat sozinho, sem esperar o toque em "START". O botão continua aí (ver
  // `startHit` abaixo) pra quem quiser pular antes do vídeo terminar.
  useEffect(() => {
    const subscription = player.addListener('playToEnd', finish);
    return () => subscription.remove();
  }, [player]);

  function onLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setContainerSize({ width, height });
  }

  // Mistura `cover` (escala única, sem distorcer os dois eixos igual) com
  // `fill` (uma escala por eixo, cada um exatamente do tamanho do
  // container) — `STRETCH_AMOUNT` decide o quanto de cada. `contentFit`
  // fica em "fill" abaixo porque a caixa que passamos pro `VideoView` já é
  // o tamanho calculado aqui; pedir pra ele preencher essa caixa exata não
  // introduz nenhuma distorção além da que já decidimos.
  const videoRect = containerSize
    ? (() => {
        const coverScale = Math.max(containerSize.width / VIDEO_W, containerSize.height / VIDEO_H);
        const fillScaleX = containerSize.width / VIDEO_W;
        const fillScaleY = containerSize.height / VIDEO_H;

        const scaleX = coverScale + STRETCH_AMOUNT * (fillScaleX - coverScale);
        const scaleY = coverScale + STRETCH_AMOUNT * (fillScaleY - coverScale);

        const width = VIDEO_W * scaleX;
        const height = VIDEO_H * scaleY;
        return {
          left: (containerSize.width - width) / 2,
          top: (containerSize.height - height) / 2,
          width,
          height,
        };
      })()
    : undefined;

  return (
    <View style={styles.container} onLayout={onLayout}>
      {/* `overflow: hidden` recorta a sobra do `videoRect` — o vídeo continua
          um pouco maior que a tela num dos eixos, de propósito (é o que
          resta de "cover"). */}
      <View style={styles.clip}>
        {videoRect ? (
          <VideoView
            player={player}
            style={[styles.video, videoRect]}
            contentFit="fill"
            nativeControls={false}
            allowsPictureInPicture={false}
          />
        ) : null}
      </View>

      {/* Área tocável sobre o "START" desenhado no vídeo — sem texto ou
          fundo próprios, o botão visual já é o do vídeo. Calculada a partir
          do retângulo real exibido (`videoRect`), não de percentual da tela. */}
      {videoRect ? (
        <Pressable
          onPress={finish}
          style={[
            styles.startHit,
            {
              left: videoRect.left + START_BUTTON_FRACTION.x0 * videoRect.width,
              top: videoRect.top + START_BUTTON_FRACTION.y0 * videoRect.height,
              width: (START_BUTTON_FRACTION.x1 - START_BUTTON_FRACTION.x0) * videoRect.width,
              height: (START_BUTTON_FRACTION.y1 - START_BUTTON_FRACTION.y0) * videoRect.height,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Start"
        />
      ) : null}

      {canSkip ? (
        <Pressable
          onPress={finish}
          style={[styles.skip, { top: insets.top + Spacing.two }]}
          accessibilityRole="button"
          accessibilityLabel="Skip intro"
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    backgroundColor: VIDEO_BG,
  },
  clip: { flex: 1, overflow: 'hidden' },
  video: { position: 'absolute' },
  startHit: { position: 'absolute' },
  skip: {
    position: 'absolute',
    right: Spacing.three,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two - 2,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  // Sem `fontFamily: Fonts.bold` de propósito: este botão pode renderizar
  // antes do Quicksand terminar de carregar (`IntroVideo` não espera
  // `fontsLoaded`, ver comentário em `_layout.tsx`). Nesse caso o RN mede o
  // layout com a fonte de sistema e, quando o Quicksand troca depois, o
  // texto fica mais largo sem o box ser recalculado — cortando "Skip". Peso
  // bold nativo evita essa corrida (era a causa real do corte em produção,
  // não largura insuficiente).
  skipText: { fontWeight: '700', fontSize: 13, color: '#fff' },
});
