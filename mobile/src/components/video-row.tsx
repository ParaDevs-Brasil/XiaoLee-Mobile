import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MediaAsset } from '@/api/backend';
import type { IconProps } from '@/components/icons';
import { IconActivity, IconAlert, IconCheck, IconClock, IconMore, IconPlay, IconUpload } from '@/components/icons';
import { ThumbImage } from '@/components/thumb-image';
import { CardShadow, Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { formatBytes, formatClock, mediaListStatus, type MediaTone } from '@/lib/clips';
import { timeAgo } from '@/lib/format';

/**
 * Uma linha da lista "Your videos": o que é, quanto pesa, quando subiu e em que
 * pé está. O estado é a informação que o creator veio procurar, então ele vai
 * no chip colorido — o resto da linha fica neutro.
 *
 * O backend não gera miniatura, então a esquerda é um tile escuro com o
 * tempo do arquivo em cima: vídeo e áudio se distinguem pelo glifo, e a
 * coluna vira uma âncora visual para varrer a lista.
 */

const TONE: Record<MediaTone, { bg: string; fg: string; Icon: (p: IconProps) => React.ReactElement }> = {
  neutral: { bg: Colors.light.bg, fg: Colors.light.ink2, Icon: IconUpload },
  muted: { bg: Colors.light.bg, fg: Colors.light.ink2, Icon: IconActivity },
  progress: { bg: Colors.light.warnSoft, fg: Colors.light.warn, Icon: IconClock },
  success: { bg: Colors.light.successSoft, fg: Colors.light.success, Icon: IconCheck },
  danger: { bg: Colors.light.dangerSoft, fg: Colors.light.danger, Icon: IconAlert },
  action: { bg: Colors.light.accentSoft, fg: Colors.light.accent, Icon: IconPlay },
};

export function VideoRow({ item, onPress, onMenu }: { item: MediaAsset; onPress: () => void; onMenu: () => void }) {
  // Pelo vídeo inteiro, não só `status`: "transcribed" com cortes renderizando
  // não é "pronto" (ver `mediaListStatus`).
  const status = mediaListStatus(item);
  const tone = TONE[status.tone];
  const label = status.label;
  const meta = [formatBytes(item.size_bytes), timeAgo(item.created_at)].join(' · ');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${label}`}
    >
      <Thumb id={item.id} kind={item.kind} duration={item.duration_s} uri={item.thumbnail_url} />

      <View style={styles.main}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>

        <View style={[styles.chip, { backgroundColor: tone.bg }]}>
          {tone.Icon ? <tone.Icon size={12} sw={2.6} color={tone.fg} /> : null}
          <Text style={[styles.chipText, { color: tone.fg }]}>{label}</Text>
        </View>

        {status.tone === 'progress' ? <IndeterminateBar color={tone.fg} /> : null}
      </View>

      {/* O toque na linha abre o vídeo; os três pontos abrem renomear/apagar. */}
      <Pressable
        onPress={onMenu}
        hitSlop={Spacing.two}
        style={({ pressed }) => [styles.menu, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`More options for ${item.title}`}
      >
        <IconMore size={20} color={Colors.light.ink2} />
      </Pressable>
    </Pressable>
  );
}

function Thumb({
  id,
  kind,
  duration,
  uri,
}: {
  id: number;
  kind: MediaAsset['kind'];
  duration: number | null;
  uri: string | null;
}) {
  const Glyph = kind === 'audio' ? IconActivity : IconPlay;
  return (
    <View style={styles.thumb} accessible={false}>
      <ThumbImage uri={uri} cacheKey={`media-thumb-${id}`} />
      {/* Sobre uma foto, o disco e a duração precisam de um véu para não sumir em quadros claros. */}
      {uri ? <View style={styles.scrim} /> : null}
      <View style={styles.thumbDisc}>
        <Glyph size={kind === 'audio' ? 18 : 14} sw={kind === 'audio' ? 2 : 2.2} color={Colors.light.card} />
      </View>
      {duration ? (
        <View style={styles.duration}>
          <Text style={styles.durationText}>{formatClock(duration)}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A transcrição não informa percentual (só `transcribing`), então a barra não
 * finge um: um trecho que corre indefinidamente diz "está trabalhando" sem
 * prometer um número que o backend não tem.
 */
function IndeterminateBar({ color }: { color: string }) {
  const [phase] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(phase, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.cubic),
        // `left` em % não roda no driver nativo; é uma barra de 3 px, custa nada.
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [phase]);

  return (
    <View style={styles.track} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={[
          styles.segment,
          { backgroundColor: color, left: phase.interpolate({ inputRange: [0, 1], outputRange: ['-40%', '100%'] }) },
        ]}
      />
    </View>
  );
}

const THUMB_W = 84;
const THUMB_H = 60;

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    padding: Spacing.two + 4,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
    ...CardShadow,
  },
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.ink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(26, 25, 23, 0.22)' },
  thumbDisc: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(26, 25, 23, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  duration: {
    position: 'absolute',
    right: Spacing.one + 2,
    bottom: Spacing.one + 2,
    paddingHorizontal: Spacing.one + 1,
    paddingVertical: 1,
    borderRadius: Radius.sm / 2,
    backgroundColor: 'rgba(26, 25, 23, 0.72)',
  },
  durationText: { fontFamily: Fonts.bold, fontSize: 10, color: Colors.light.card },
  main: { flex: 1, gap: 2 },
  menu: { width: 36, height: 44, marginRight: -Spacing.one, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: Fonts.bold, fontSize: 14, lineHeight: 20, color: Colors.light.ink },
  meta: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 16, color: Colors.light.ink2 },
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 1,
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  chipText: { fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 0.2 },
  track: {
    height: 3,
    marginTop: Spacing.one + 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.warnBorder,
    overflow: 'hidden',
  },
  segment: { position: 'absolute', top: 0, bottom: 0, width: '40%', borderRadius: Radius.pill },
});
