import { useEventListener } from 'expo';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Polygon, Rect, Svg } from 'react-native-svg';

import type { MediaClip } from '@/api/backend';
import { ApiError } from '@/api/client';
import type { ClipBusy } from '@/components/clip-card';
import { IconCheck, IconClose, IconDownload, IconSend } from '@/components/icons';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { freshClipUrl } from '@/lib/clip-share';
import { formatClock } from '@/lib/clips';

/**
 * Player de um corte, em tela cheia sobre a tela do vídeo.
 *
 * Um player só, aberto sob demanda: três `VideoView` na lista baixariam três
 * MP4 1080×1920 ao mesmo tempo só por a tela abrir.
 */
export function ClipPlayer({
  mediaId,
  clip,
  onClose,
  onSave,
  onShare,
  busy = null,
  saved = false,
  actionsDisabled = false,
}: {
  mediaId: number;
  /** `null` = fechado. */
  clip: MediaClip | null;
  onClose: () => void;
  /** Ausente = este build não tem o módulo nativo (ver `canSaveClips`); o botão some. */
  onSave?: () => void;
  /** Idem, `canShareClips`. */
  onShare?: () => void;
  busy?: ClipBusy;
  saved?: boolean;
  /** Outro corte está sendo baixado: um download por vez. */
  actionsDisabled?: boolean;
}) {
  return (
    <Modal
      visible={clip !== null}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      {/* `key`: trocar de corte remonta o corpo, e com ele a URL e o player. */}
      {clip ? (
        <PlayerBody
          key={clip.id}
          mediaId={mediaId}
          clip={clip}
          onClose={onClose}
          actions={{ onSave, onShare, busy, saved, disabled: actionsDisabled }}
        />
      ) : null}
    </Modal>
  );
}

type Source = { url: string } | { error: string } | null;

/** Salvar e compartilhar de dentro do player — quem está vendo decide ali, sem fechar para achar o botão. */
interface PlayerActions {
  onSave?: () => void;
  onShare?: () => void;
  busy: ClipBusy;
  saved: boolean;
  disabled: boolean;
}

function PlayerBody({
  mediaId,
  clip,
  onClose,
  actions,
}: {
  mediaId: number;
  clip: MediaClip;
  onClose: () => void;
  actions: PlayerActions;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [source, setSource] = useState<Source>(null);

  useEffect(() => {
    let alive = true;
    freshClipUrl(mediaId, clip.id).then(
      (url) => {
        if (alive) setSource(url ? { url } : { error: 'This clip is no longer available.' });
      },
      (err: unknown) => {
        if (alive) setSource({ error: err instanceof ApiError ? err.message : String(err) });
      },
    );
    return () => {
      alive = false;
    };
  }, [mediaId, clip.id]);

  // 9:16 inteiro na tela: limitado pela largura ou pela altura que sobra
  // depois do cabeçalho, o que for menor.
  const available = height - insets.top - insets.bottom - HEADER_HEIGHT - CONTROLS_HEIGHT - Spacing.three;
  const videoWidth = Math.min(width, (available * 9) / 16);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Fundo escuro: ícones claros na barra de status enquanto o player está aberto. */}
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {clip.title}
        </Text>
        <Pressable
          onPress={onClose}
          hitSlop={Spacing.two}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Close player"
        >
          <IconClose size={20} sw={2.2} color={WHITE} />
        </Pressable>
      </View>

      <View style={styles.stage}>
        {source === null ? <ActivityIndicator color={WHITE} /> : null}
        {source && 'error' in source ? <Text style={styles.error}>{source.error}</Text> : null}
        {source && 'url' in source ? (
          <Video
            url={source.url}
            width={videoWidth}
            fallbackDuration={clip.end_s - clip.start_s}
            clip={clip}
            actions={actions}
          />
        ) : null}
      </View>
    </View>
  );
}

function Video({
  url,
  width,
  fallbackDuration,
  clip,
  actions,
}: {
  url: string;
  width: number;
  fallbackDuration: number;
  clip: MediaClip;
  actions: PlayerActions;
}) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.1;
    p.play();
  });
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [status, setStatus] = useState(player.status);
  /** Posição (0–1) enquanto o dedo arrasta o scrubber; `null` = segue o vídeo. */
  const [drag, setDrag] = useState<number | null>(null);

  useEventListener(player, 'playingChange', ({ isPlaying }) => setPlaying(isPlaying));
  useEventListener(player, 'timeUpdate', ({ currentTime }) => setTime(currentTime));
  useEventListener(player, 'statusChange', ({ status: next }) => setStatus(next));

  // O arquivo diz a duração real só depois de carregar; até lá vale a do corte, que o backend já sabe.
  const duration = player.duration > 0 ? player.duration : fallbackDuration;
  const shown = drag !== null ? drag * duration : time;
  const toggle = () => (playing ? player.pause() : player.play());
  // `seekBy` e não `player.currentTime = …`: o player vem de um hook e o compilador do React o trata como imutável.
  const seekTo = (seconds: number) => {
    player.seekBy(Math.min(Math.max(seconds, 0), duration) - player.currentTime);
  };

  return (
    <View style={{ width }}>
      <View>
        {/* Sem controles nativos: eles não aceitam tema. Tocar no vídeo pausa/retoma, como nos apps de vídeo curto. */}
        <VideoView
          player={player}
          nativeControls={false}
          contentFit="contain"
          style={{ width, aspectRatio: 9 / 16, borderRadius: Radius.md }}
        />
        <Pressable
          onPress={toggle}
          style={styles.tapLayer}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Play'}
        >
          {status === 'loading' ? <ActivityIndicator color={WHITE} size="large" /> : null}
          {status === 'error' ? <Text style={styles.error}>{"Couldn't play this clip."}</Text> : null}
          {!playing && status !== 'loading' && status !== 'error' ? (
            <View style={styles.disc}>
              <PlayGlyph size={26} color={WHITE} />
            </View>
          ) : null}
        </Pressable>
      </View>

      <View style={styles.controls}>
        <Scrubber
          ratio={duration > 0 ? Math.min(shown / duration, 1) : 0}
          dragging={drag !== null}
          duration={duration}
          onDrag={setDrag}
          onCommit={(ratio) => {
            seekTo(ratio * duration);
            setDrag(null);
          }}
          onNudge={(seconds) => seekTo(time + seconds)}
        />
        <View style={styles.timeRow}>
          <Pressable
            onPress={toggle}
            style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause' : 'Play'}
          >
            {playing ? <PauseGlyph size={18} color={WHITE} /> : <PlayGlyph size={18} color={WHITE} />}
          </Pressable>
          <Text style={styles.time}>
            {formatClock(shown)}
            <Text style={styles.timeTotal}> / {formatClock(duration)}</Text>
          </Text>

          {actions.onShare ? (
            <Pressable
              onPress={actions.onShare}
              disabled={actions.disabled}
              style={({ pressed }) => [styles.shareButton, actions.disabled && actions.busy !== 'share' && styles.dimmed, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Share clip ${clip.rank}: ${clip.title}`}
              accessibilityState={{ busy: actions.busy === 'share', disabled: actions.disabled }}
            >
              {actions.busy === 'share' ? <ActivityIndicator size="small" color={WHITE} /> : <IconSend size={20} sw={2} color={WHITE} />}
            </Pressable>
          ) : null}

          {actions.onSave ? (
            <Pressable
              onPress={actions.onSave}
              disabled={actions.disabled || actions.saved}
              style={({ pressed }) => [
                styles.saveButton,
                actions.saved && styles.saveButtonDone,
                actions.disabled && actions.busy !== 'save' && !actions.saved && styles.dimmed,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                actions.saved
                  ? `Clip ${clip.rank} saved to your gallery`
                  : `Save clip ${clip.rank} to your gallery: ${clip.title}`
              }
              accessibilityState={{ busy: actions.busy === 'save', disabled: actions.disabled || actions.saved }}
            >
              {actions.busy === 'save' ? (
                <ActivityIndicator size="small" color={WHITE} />
              ) : actions.saved ? (
                <IconCheck size={18} sw={2.6} color={WHITE} />
              ) : (
                <IconDownload size={18} sw={2.2} color={WHITE} />
              )}
              <Text style={styles.saveText}>{actions.busy === 'save' ? 'Saving…' : actions.saved ? 'Saved' : 'Save'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * Barra de progresso arrastável. Sem lib de slider: os toques vêm do próprio
 * `View` (os filhos ignoram toque, então `locationX` é sempre relativo à barra) e o
 * vídeo só pula ao soltar — pular a cada movimento travaria o decoder.
 */
function Scrubber({
  ratio,
  dragging,
  duration,
  onDrag,
  onCommit,
  onNudge,
}: {
  ratio: number;
  dragging: boolean;
  duration: number;
  onDrag: (ratio: number) => void;
  onCommit: (ratio: number) => void;
  onNudge: (seconds: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const at = (event: GestureResponderEvent) =>
    trackWidth > 0 ? Math.min(Math.max(event.nativeEvent.locationX / trackWidth, 0), 1) : 0;

  return (
    <View
      style={styles.scrubHit}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => onDrag(at(e))}
      onResponderMove={(e) => onDrag(at(e))}
      onResponderRelease={(e) => onCommit(at(e))}
      onResponderTerminate={(e) => onCommit(at(e))}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Playback position"
      accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(ratio * duration) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onNudge(e.nativeEvent.actionName === 'increment' ? 5 : -5)}
    >
      <View style={styles.track} pointerEvents="none">
        <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.thumb,
          dragging && styles.thumbActive,
          { left: ratio * trackWidth - (dragging ? THUMB_ACTIVE : THUMB) / 2 },
        ]}
      />
    </View>
  );
}

function PlayGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Polygon points="7 3.5 20.5 12 7 20.5 7 3.5" />
    </Svg>
  );
}

function PauseGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Rect x="5.5" y="4" width="4.5" height="16" rx="1.2" />
      <Rect x="14" y="4" width="4.5" height="16" rx="1.2" />
    </Svg>
  );
}

/**
 * O player é sempre escuro, como o de qualquer app de vídeo, mas em vez de preto
 * puro usa o "ink" do produto — o mesmo tom quente dos tiles de miniatura.
 */
const WHITE = '#ffffff';
const HEADER_HEIGHT = 52;
/** Scrubber (44 de área de toque) + linha do play/tempo (48) + respiro. */
const CONTROLS_HEIGHT = 108;
const THUMB = 14;
const THUMB_ACTIVE = 20;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.light.ink },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  title: { flex: 1, fontFamily: Fonts.bold, fontSize: 15, color: WHITE },
  close: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  pressed: { opacity: 0.7 },
  tapLayer: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  disc: {
    width: 72,
    height: 72,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // O triângulo é mais pesado à esquerda: empurra 3 px para parecer centrado.
    paddingLeft: 3,
    backgroundColor: Colors.light.accent,
  },
  controls: { gap: Spacing.one, paddingTop: Spacing.two },
  scrubHit: { height: 44, justifyContent: 'center' },
  track: { height: 4, borderRadius: Radius.pill, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.pill, backgroundColor: Colors.light.accent },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: Radius.pill,
    backgroundColor: WHITE,
  },
  thumbActive: { width: THUMB_ACTIVE, height: THUMB_ACTIVE },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, minHeight: 48 },
  // Neutro de propósito: o rosa fica com o Salvar, que é o que o creator veio fazer aqui.
  playButton: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  time: { flex: 1, fontFamily: Fonts.bold, fontSize: 15, color: WHITE },
  shareButton: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  saveButton: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three + 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accent,
  },
  saveButtonDone: { backgroundColor: 'rgba(255,255,255,0.16)' },
  saveText: { fontFamily: Fonts.bold, fontSize: 15, color: WHITE },
  dimmed: { opacity: 0.45 },
  timeTotal: { fontFamily: Fonts.medium, color: 'rgba(255,255,255,0.6)' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: Spacing.three },
  error: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    color: WHITE,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
});
