import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { MediaClip } from '@/api/backend';
import type { IconProps } from '@/components/icons';
import { IconAlert, IconCheck, IconDownload, IconMore, IconPlay, IconSend } from '@/components/icons';
import { ThumbImage } from '@/components/thumb-image';
import { CardShadow, Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { formatClipSpan } from '@/lib/clips';

/**
 * Um corte sugerido pelo Clipper: o que é, de onde saiu no vídeo e por que
 * foi escolhido. Título e trecho existem desde o `POST /clips` — só o arquivo
 * renderiza depois —, então o card aparece inteiro desde o início e só a
 * linha de status muda.
 */
/** Ação em andamento neste corte (baixando o MP4 para salvar ou compartilhar). */
export type ClipBusy = 'save' | 'share' | null;

export function ClipCard({
  clip,
  excerpt,
  onPlay,
  onSave,
  onShare,
  onMenu,
  busy = null,
  saved = false,
  actionsDisabled = false,
}: {
  clip: MediaClip;
  /** O que é falado no corte (`clipExcerpt`); vazio esconde a citação. */
  excerpt: string;
  onPlay: () => void;
  /** Ausente = este build não tem o módulo nativo (ver `canSaveClips`); o botão some. */
  onSave?: () => void;
  /** Idem, `canShareClips`. */
  onShare?: () => void;
  /** Abre o menu do corte (renomear, apagar). */
  onMenu?: () => void;
  busy?: ClipBusy;
  /** Já foi para a galeria nesta tela — evita salvar duas vezes. */
  saved?: boolean;
  /** Outro corte está sendo baixado: um download por vez. */
  actionsDisabled?: boolean;
}) {
  const ready = clip.status === 'ready';
  return (
    <View style={styles.card}>
      <View style={styles.summary}>
        <Poster clip={clip} onPlay={ready ? onPlay : undefined} />

        <View style={styles.text}>
          <View style={styles.spanRow}>
            <Text style={styles.span}>{formatClipSpan(clip.start_s, clip.end_s)}</Text>
            {onMenu ? (
              <Pressable
                onPress={onMenu}
                hitSlop={Spacing.two}
                style={({ pressed }) => [styles.menu, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`More options for clip ${clip.rank}: ${clip.title}`}
              >
                <IconMore size={20} color={Colors.light.ink2} />
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.title} numberOfLines={3}>
            {clip.title}
          </Text>
          {excerpt ? (
            <Text style={styles.excerpt} numberOfLines={2}>
              “{excerpt}”
            </Text>
          ) : null}
          {clip.reason ? (
            <Text style={styles.reason} numberOfLines={3}>
              {clip.reason}
            </Text>
          ) : null}
        </View>
      </View>

      <ClipStatusRow
        clip={clip}
        onPlay={onPlay}
        onSave={onSave}
        onShare={onShare}
        busy={busy}
        saved={saved}
        actionsDisabled={actionsDisabled}
      />
    </View>
  );
}

/**
 * Miniatura 9:16 do corte. Ainda não há quadro renderizado para mostrar, então
 * é um tile escuro com o glifo do estado — o formato vertical já avisa o que o
 * creator vai receber, e o #rank diz qual é o melhor momento.
 */
function Poster({ clip, onPlay }: { clip: MediaClip; onPlay?: () => void }) {
  const content = (
    <>
      <ThumbImage uri={clip.thumbnail_url} cacheKey={`clip-thumb-${clip.id}`} />
      {clip.thumbnail_url ? <View style={styles.scrim} /> : null}
      <View style={styles.rank}>
        <Text style={styles.rankText}>#{clip.rank}</Text>
      </View>
      {clip.status === 'ready' ? (
        <View style={styles.playDisc}>
          <IconPlay size={16} sw={2} color={Colors.light.ink} />
        </View>
      ) : clip.status === 'failed' ? (
        <IconAlert size={22} color={Colors.light.card} />
      ) : (
        <ActivityIndicator size="small" color={Colors.light.card} />
      )}
    </>
  );

  if (!onPlay) {
    return (
      <View style={styles.poster} accessible={false}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPlay}
      style={({ pressed }) => [styles.poster, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Play clip ${clip.rank}: ${clip.title}`}
    >
      {content}
    </Pressable>
  );
}

function ClipStatusRow({
  clip,
  onPlay,
  onSave,
  onShare,
  busy,
  saved,
  actionsDisabled,
}: {
  clip: MediaClip;
  onPlay: () => void;
  onSave?: () => void;
  onShare?: () => void;
  busy: ClipBusy;
  saved: boolean;
  actionsDisabled: boolean;
}) {
  switch (clip.status) {
    case 'pending':
      return <Text style={styles.statusText}>Waiting to render…</Text>;
    case 'rendering':
      return <Text style={styles.statusText}>Rendering the vertical clip…</Text>;
    case 'failed':
      return (
        <Text style={[styles.statusText, styles.failed]}>
          Render failed{clip.error ? `: ${clip.error}` : '.'}
        </Text>
      );
    case 'ready':
      return (
        <View style={styles.actions}>
          <Pressable
            onPress={onPlay}
            style={({ pressed }) => [styles.play, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Play clip ${clip.rank}: ${clip.title}`}
          >
            <IconPlay size={14} sw={2.2} color={Colors.light.card} />
            <Text style={styles.playText}>Play</Text>
          </Pressable>
          {onSave ? (
            <IconAction
              Icon={saved ? IconCheck : IconDownload}
              a11yLabel={
                saved ? `Clip ${clip.rank} saved to your gallery` : `Save clip ${clip.rank} to your gallery: ${clip.title}`
              }
              busy={busy === 'save'}
              done={saved}
              disabled={actionsDisabled || saved}
              onPress={onSave}
            />
          ) : null}
          {onShare ? (
            <IconAction
              Icon={IconSend}
              a11yLabel={`Share clip ${clip.rank}: ${clip.title}`}
              busy={busy === 'share'}
              disabled={actionsDisabled}
              onPress={onShare}
            />
          ) : null}
        </View>
      );
  }
}

/**
 * Salvar e compartilhar são ações de apoio ao "Play": ficam como botões
 * redondos de 44 pt, sem rótulo, para o Play ser o único com texto. O nome
 * vai no `accessibilityLabel`; salvo vira um check verde.
 */
function IconAction({
  Icon,
  a11yLabel,
  busy,
  done = false,
  disabled,
  onPress,
}: {
  Icon: (p: IconProps) => React.ReactElement;
  a11yLabel: string;
  busy: boolean;
  done?: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const color = done ? Colors.light.success : Colors.light.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.iconAction,
        done && styles.iconActionDone,
        disabled && !busy && !done && styles.disabled,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ busy, disabled }}
    >
      {busy ? <ActivityIndicator size="small" color={Colors.light.accent} /> : <Icon size={18} sw={2} color={color} />}
    </Pressable>
  );
}

const POSTER_W = 72;

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three - 4,
    padding: Spacing.three - 4,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
    ...CardShadow,
  },
  summary: { flexDirection: 'row', gap: Spacing.three - 4 },
  poster: {
    width: POSTER_W,
    aspectRatio: 9 / 16,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.ink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(26, 25, 23, 0.18)' },
  rank: {
    position: 'absolute',
    top: Spacing.two - 2,
    left: Spacing.two - 2,
    paddingHorizontal: Spacing.two - 2,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.card,
  },
  rankText: { fontFamily: Fonts.bold, fontSize: 10, color: Colors.light.ink },
  playDisc: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
    // O triângulo é simétrico à esquerda: empurra 1 px para parecer centrado.
    paddingLeft: 2,
  },
  text: { flex: 1, gap: Spacing.one + 1 },
  spanRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 },
  span: { fontFamily: Fonts.semibold, fontSize: 12, color: Colors.light.ink3 },
  // Os pontos alinham à borda direita do card; a área de toque (32 + hitSlop) chega a 48.
  menu: { width: 32, height: 28, marginRight: -Spacing.one, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: Fonts.bold, fontSize: 15, lineHeight: 21, color: Colors.light.ink },
  excerpt: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    fontStyle: 'italic',
    color: Colors.light.ink2,
  },
  reason: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Colors.light.ink3, marginTop: Spacing.one },
  statusText: { fontFamily: Fonts.semibold, fontSize: 12, color: Colors.light.ink2 },
  failed: { color: Colors.light.danger },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  play: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accent,
  },
  playText: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.light.card },
  iconAction: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.card,
  },
  iconActionDone: { backgroundColor: Colors.light.successSoft, borderColor: Colors.light.successBorder },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
