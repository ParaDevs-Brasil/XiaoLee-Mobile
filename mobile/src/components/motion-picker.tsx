import { useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoThumbnail } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { type GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconCheck, IconPlay, IconRefresh, IconScissors } from '@/components/icons';
import { UploadTile } from '@/components/upload-tile';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import type { PickedMotion } from '@/lib/creators';
import { clampStart } from '@/lib/creators-core';
import { formatClock } from '@/lib/clips';

const FRAMES = 8;
const STRIP_HEIGHT = 64;
const HANDLE = 14;

/**
 * Vídeo de referência do Mimic/Swap. Vazio, é a área de envio. Escolhido, mostra a miniatura com o check, deixa
 * claro que dá para trocar por outro vídeo (botão "Replace video") e abre o corte estilo editor: uma tira de quadros
 * do vídeo inteiro com uma janela do tamanho da duração escolhida — arrasta a janela para escolher o trecho (ex.: 5 s
 * de um vídeo de 50 s). O backend corta exatamente esse trecho.
 */
export function MotionPicker({
  motion,
  windowS,
  onPick,
  onStart,
  hint,
}: {
  motion: PickedMotion | null;
  /** Duração escolhida (a janela do corte). 0 = ainda sem duração possível. */
  windowS: number;
  onPick: () => void;
  /** Soltou a janela num novo início (segundos). */
  onStart: (startS: number) => void;
  hint: string;
}) {
  const colors = useTheme();
  const styles = useStyles();

  if (!motion) {
    return (
      <UploadTile
        title="Choose a video"
        hint={hint}
        onPress={onPick}
        Icon={IconPlay}
        height={150}
        accessibilityLabel="Choose a video"
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <Chosen key={motion.uri} motion={motion} windowS={windowS} onPick={onPick} onStart={onStart} />
      <Text style={[styles.hintText, { color: colors.ink3 }]}>{hint}</Text>
    </View>
  );
}

function Chosen({
  motion,
  windowS,
  onPick,
  onStart,
}: {
  motion: PickedMotion;
  windowS: number;
  onPick: () => void;
  onStart: (startS: number) => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const total = Math.max(motion.seconds, 0);
  const windowLen = Math.min(windowS || total, total);
  const start = clampStart(motion.startS, total, windowLen);
  const canTrim = total > 0 && windowLen > 0 && total - windowLen > 0.5;

  const player = useVideoPlayer(motion.uri, (p) => {
    p.timeUpdateEventInterval = 0.1;
  });
  const [frames, setFrames] = useState<VideoThumbnail[]>([]);
  const [cover, setCover] = useState<VideoThumbnail | null>(null);
  const [playing, setPlaying] = useState(false);
  const end = start + windowLen;

  // Prévia do trecho: toca só de `start` a `end`, em loop, sem passar para o resto do vídeo.
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (playing && (currentTime >= end || currentTime < start - 0.5)) player.seekBy(start - currentTime);
  });

  function togglePreview() {
    if (playing) {
      player.pause();
      setPlaying(false);
      return;
    }
    player.seekBy(start - player.currentTime);
    player.play();
    setPlaying(true);
  }

  // Mexer na janela durante a prévia: volta a prévia para o novo início.
  useEffect(() => {
    if (!playing) return;
    player.seekBy(start - player.currentTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, windowLen]);

  // Quadros espalhados pelo vídeo inteiro (a tira do corte). Se o aparelho não gerar, a tira fica só com a janela.
  useEffect(() => {
    if (total <= 0) return;
    let live = true;
    const times = Array.from({ length: FRAMES }, (_, i) => ((i + 0.5) / FRAMES) * total);
    player
      .generateThumbnailsAsync(times, { maxHeight: STRIP_HEIGHT * 2 })
      .then((list) => live && setFrames(list))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [player, total]);

  // A capa grande acompanha o início do trecho, para a pessoa ver onde o vídeo vai começar.
  useEffect(() => {
    let live = true;
    player
      .generateThumbnailsAsync(start, { maxHeight: 480 })
      .then((list) => live && setCover(list[0] ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [player, start]);

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Pressable
          style={styles.cover}
          onPress={togglePreview}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause preview' : 'Play preview of the selected part'}
        >
          {cover ? <Image source={cover} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} /> : null}
          {playing ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} /> : null}
          {!playing ? (
            <View style={styles.playDisc}>
              <IconPlay size={18} color="#ffffff" />
            </View>
          ) : null}
          <View style={styles.checkBadge}>
            <IconCheck size={14} sw={3} color={colors.onAccent} />
          </View>
        </Pressable>
        <View style={styles.info}>
          <Text style={styles.title}>Video chosen</Text>
          <Text style={styles.sub}>{Math.round(total)}s long · tap the picture to preview</Text>
          <Pressable
            onPress={onPick}
            style={({ pressed }) => [styles.replace, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityLabel="Replace video with another one"
          >
            <IconRefresh size={14} sw={2.2} color={colors.accent} />
            <Text style={styles.replaceText}>Replace video</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.trimHead}>
        <View style={styles.trimTitle}>
          <IconScissors size={14} sw={2.2} color={colors.ink} />
          <Text style={styles.label}>{canTrim ? 'Pick the part to use' : 'Part to use'}</Text>
        </View>
        <Text style={styles.range}>
          {formatClock(start)} – {formatClock(start + windowLen)} · {Math.round(windowLen)}s
        </Text>
      </View>

      <Trimmer frames={frames} total={total} windowLen={windowLen} start={start} enabled={canTrim} onStart={onStart} />

      <Text style={styles.note}>
        {canTrim
          ? 'Drag the pink box over the part of the video you want. The length comes from the Length option below.'
          : 'The whole video is used. Pick a shorter length below to choose just a part of it.'}
      </Text>
    </View>
  );
}

/** Tira de quadros com a janela arrastável. Arrastar mostra o trecho ao vivo; o novo início só sobe ao soltar. */
function Trimmer({
  frames,
  total,
  windowLen,
  start,
  enabled,
  onStart,
}: {
  frames: VideoThumbnail[];
  total: number;
  windowLen: number;
  start: number;
  enabled: boolean;
  onStart: (startS: number) => void;
}) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? start;

  // Onde o dedo pegou a janela (em segundos dentro dela); fora dela, pega pelo meio e a janela pula para o dedo.
  const grab = useRef(0);
  const secondsAt = (e: GestureResponderEvent) => (width > 0 ? (e.nativeEvent.locationX / width) * total : 0);
  const startAt = (e: GestureResponderEvent) => clampStart(secondsAt(e) - grab.current, total, windowLen);

  const left = total > 0 && width > 0 ? (shown / total) * width : 0;
  const boxW = total > 0 && width > 0 ? Math.max((windowLen / total) * width, HANDLE * 2) : 0;

  return (
    <View
      style={styles.strip}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel={`Part of the video, starting at ${Math.round(shown)} seconds`}
      accessibilityValue={{ min: 0, max: Math.round(Math.max(total - windowLen, 0)), now: Math.round(shown) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const step = e.nativeEvent.actionName === 'increment' ? 1 : -1;
        onStart(clampStart(start + step, total, windowLen));
      }}
      onStartShouldSetResponder={() => enabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        const at = secondsAt(e);
        grab.current = at >= start && at <= start + windowLen ? at - start : windowLen / 2;
        setLive(startAt(e));
      }}
      onResponderMove={(e) => setLive(startAt(e))}
      onResponderRelease={(e) => {
        onStart(Math.round(startAt(e) * 10) / 10);
        setLive(null);
      }}
      onResponderTerminate={() => setLive(null)}
    >
      <View style={styles.frames} pointerEvents="none">
        {Array.from({ length: FRAMES }, (_, i) => (
          <View key={i} style={styles.frame}>
            {frames[i] ? <Image source={frames[i]} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          </View>
        ))}
      </View>
      {width > 0 ? (
        <>
          {/* Fora do trecho escolhido, os quadros escurecem — igual aos editores de vídeo. */}
          <View pointerEvents="none" style={[styles.shade, { left: 0, width: left }]} />
          <View pointerEvents="none" style={[styles.shade, { left: left + boxW, right: 0 }]} />
          <View pointerEvents="none" style={[styles.box, { left, width: boxW }, !enabled && styles.boxFull]}>
            <View style={[styles.grip, styles.gripLeft]}>
              <View style={styles.gripBar} />
            </View>
            <View style={[styles.grip, styles.gripRight]}>
              <View style={styles.gripBar} />
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { gap: Spacing.two },
  card: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: colors.success,
    backgroundColor: colors.card,
  },
  top: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  cover: {
    width: 96,
    aspectRatio: 9 / 16,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: colors.media,
  },
  playDisc: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  checkBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successFill,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  info: { flex: 1, gap: 2, alignItems: 'flex-start' },
  title: { fontFamily: Fonts.bold, fontSize: 15, color: colors.ink },
  sub: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink2, marginBottom: Spacing.two },
  replace: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    height: 34,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  replaceText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.accent },
  trimHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  trimTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  label: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink },
  range: { fontFamily: Fonts.bold, fontSize: 12, color: colors.accent },
  strip: {
    height: STRIP_HEIGHT,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: colors.media,
  },
  frames: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  frame: { flex: 1, backgroundColor: colors.media, borderRightWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.4)' },
  shade: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.62)' },
  box: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderWidth: 3,
    borderColor: colors.accentFill,
    borderRadius: Radius.md,
  },
  boxFull: { opacity: 0.9 },
  grip: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    width: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentFill,
  },
  gripLeft: { left: -3, borderTopLeftRadius: Radius.md, borderBottomLeftRadius: Radius.md },
  gripRight: { right: -3, borderTopRightRadius: Radius.md, borderBottomRightRadius: Radius.md },
  gripBar: { width: 3, height: 20, borderRadius: 2, backgroundColor: colors.onAccent },
  note: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: colors.ink2 },
  hintText: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17 },
}));
