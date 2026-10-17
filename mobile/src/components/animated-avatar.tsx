import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, View, type ViewStyle } from 'react-native';

import { makeStyles } from '@/hooks/use-theme';
import { avatarAnimation, type AnimationKey, type AnimationState } from '@/lib/avatar-animation';

/**
 * Avatar animado da Xiaolee — equivalente de `frontend/src/components/Pfp.tsx`.
 *
 * Mesma técnica do web: dois players sobrepostos, um visível e um preparando o
 * próximo clipe, com crossfade na troca. Trocar a fonte de um único player
 * pisca um frame vazio no meio.
 *
 * Os assets são os mesmos vídeos do web reescalados para 320x320 (o dobro do
 * maior tamanho de exibição) — 1,4 MB para as 13 animações contra 26 MB dos
 * originais, sem perda visível.
 */

/**
 * `require` estático por chave: o Metro resolve assets em build time, então não
 * dá para montar o caminho por concatenação. Fica aqui, e não no módulo da
 * máquina de estados, para que aquele continue puro e testável em Node.
 */
const ANIMATIONS: Record<AnimationKey, number> = {
  xiaolee_standby: require('../../assets/animations/xiaolee_standby.mp4'),
  xiaolee_standby2: require('../../assets/animations/xiaolee_standby2.mp4'),
  xiaolee_standby3: require('../../assets/animations/xiaolee_standby3.mp4'),
  xiaolee_cheer: require('../../assets/animations/xiaolee_cheer.mp4'),
  xiaolee_kawaii: require('../../assets/animations/xiaolee_kawaii.mp4'),
  xiaolee_giggle: require('../../assets/animations/xiaolee_giggle.mp4'),
  xiaolee_love: require('../../assets/animations/xiaolee_love.mp4'),
  xiaolee_surprise: require('../../assets/animations/xiaolee_surprise.mp4'),
  xiaolee_uncomfortable: require('../../assets/animations/xiaolee_uncomfortable.mp4'),
  xiaolee_hello: require('../../assets/animations/xiaolee_hello.mp4'),
  xiaolee_salute: require('../../assets/animations/xiaolee_salute.mp4'),
  xiaolee_ouch: require('../../assets/animations/xiaolee_ouch.mp4'),
  xiaolee_thinklow: require('../../assets/animations/xiaolee_thinklow.mp4'),
};

/** Duração do crossfade, igual ao web. */
const FADE_MS = 250;

interface AnimatedAvatarProps {
  size: number;
  style?: ViewStyle;
}

export function AnimatedAvatar({ size, style }: AnimatedAvatarProps) {
  const styles = useStyles();
  // Instância compartilhada: o chat também dispara animações, reagindo ao
  // campo `animations` da resposta do agente.
  const controller = avatarAnimation;
  const [fade] = useState(() => new Animated.Value(0));

  const [clipA, setClipA] = useState<AnimationState | null>(controller.state);
  const [clipB, setClipB] = useState<AnimationState | null>(null);
  /** Qual camada está à frente. Ref porque só callbacks leem e escrevem. */
  const showingB = useRef(false);

  const playerA = usePlayer(clipA);
  const playerB = usePlayer(clipB);

  // Deps estáveis de propósito: se `showingB` fosse state, cada troca
  // re-assinaria o controlador e poderia perder um evento no meio do fade.
  useEffect(() => {
    const unsubscribe = controller.subscribe((next) => {
      // Carrega o próximo clipe na camada escondida e revela por fade.
      if (showingB.current) setClipA(next);
      else setClipB(next);

      Animated.timing(fade, {
        toValue: showingB.current ? 0 : 1,
        duration: FADE_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) showingB.current = !showingB.current;
      });
    });

    controller.start();
    return () => {
      unsubscribe();
      controller.stop();
    };
  }, [controller, fade]);

  // Vídeo em loop com o app em background é bateria jogada fora — o web não
  // precisa se preocupar com isso, o celular sim.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      const active = status === 'active';
      for (const player of [playerA, playerB]) {
        if (active) player.play();
        else player.pause();
      }
      if (active) controller.start();
      else controller.stop();
    });
    return () => subscription.remove();
  }, [controller, playerA, playerB]);

  // Fim de expressão → o controlador sorteia o próximo idle. Assina os dois
  // players porque daqui não se sabe qual está à frente; `expressionEnded` é
  // no-op quando nenhuma expressão está tocando.
  useEffect(() => {
    const subscriptions = [playerA, playerB].map((player) =>
      player.addListener('playToEnd', () => controller.expressionEnded()),
    );
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [controller, playerA, playerB]);

  const circle = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={[styles.container, circle, style]}>
      <Animated.View
        style={[styles.layer, { opacity: Animated.subtract(1, fade) }]}
        pointerEvents="none"
      >
        <Surface player={playerA} />
      </Animated.View>
      <Animated.View style={[styles.layer, { opacity: fade }]} pointerEvents="none">
        <Surface player={playerB} />
      </Animated.View>
    </View>
  );
}

/** Player de um clipe. Sem fonte no boot da segunda camada — fica em branco. */
function usePlayer(clip: AnimationState | null) {
  return useVideoPlayer(clip ? ANIMATIONS[clip.key] : null, (player) => {
    player.loop = clip?.loop ?? true;
    // Os clipes não têm áudio; silenciar evita disputar o foco de áudio.
    player.muted = true;
    player.play();
  });
}

function Surface({ player }: { player: VideoPlayer }) {
  const styles = useStyles();
  return (
    <VideoView
      player={player}
      style={styles.video}
      contentFit="cover"
      nativeControls={false}
      // Sem isto o Android pode promover o vídeo a picture-in-picture.
      allowsPictureInPicture={false}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  container: { overflow: 'hidden', backgroundColor: colors.bg },
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  video: { width: '100%', height: '100%' },
}));
