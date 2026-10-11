import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  completeMedia,
  createClips,
  deleteClip,
  deleteMedia,
  getMedia,
  getMediaStatus,
  listClips,
  renameClip,
  renameMedia,
  type ClipLayout,
  type MediaClip,
  type MediaTranscriptSegment,
} from '@/api/backend';
import { ApiError } from '@/api/client';
import { ClipCard, type ClipBusy } from '@/components/clip-card';
import { ClipPlayer } from '@/components/clip-player';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { IconChevronLeft, IconMore, IconRefresh, IconScissors, IconZap } from '@/components/icons';
import { ItemMenu } from '@/components/item-menu';
import { PipelineSteps } from '@/components/pipeline-steps';
import { RenameSheet } from '@/components/rename-sheet';
import { ScreenShell } from '@/components/screen-shell';
import { CardShadow, Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import {
  canSaveClips,
  canShareClips,
  ClipShareError,
  saveClipToDevice,
  shareClip,
} from '@/lib/clip-share';
import {
  clipExcerpt,
  clipFlow,
  clipsPollMs,
  formatBytes,
  formatClock,
  mediaPollMs,
  type ClipFlow,
} from '@/lib/clips';

/**
 * Um vídeo no Clipper: acompanha a transcrição, gera os cortes e toca.
 *
 * Nada aqui guarda "em que passo estou" em memória — o passo sai de
 * `clipFlow` sobre o que o backend responde, e a tela só consulta de novo
 * enquanto ele ainda está trabalhando. Fechar o app no meio e voltar cai no
 * mesmo lugar.
 */
export default function ClipsDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const mediaId = Number(params.id);

  // Só o status: é o que se consulta em loop e a cada foco. A transcrição de
  // 1 h vem uma vez só, abaixo.
  const media = useBackendData(() => getMediaStatus(mediaId), {
    pollMs: (data) => mediaPollMs(data?.status),
  });
  const clips = useBackendData(() => listClips(mediaId), { pollMs: clipsPollMs });

  // Transcrição só para as citações dos cards — buscada quando o vídeo fica
  // `transcribed` (de novo, se for retranscrito). Falhar aqui só esconde as
  // citações; não vale um erro na tela.
  const transcribed = media.data?.status === 'transcribed';
  const [segments, setSegments] = useState<MediaTranscriptSegment[]>([]);
  useEffect(() => {
    if (!transcribed) return;
    let alive = true;
    getMedia(mediaId).then(
      (detail) => {
        if (alive) setSegments(detail.transcript?.segments ?? []);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [mediaId, transcribed]);

  const [layout, setLayout] = useState<ClipLayout>('auto');
  const [generating, setGenerating] = useState(false);
  const [retrying, setRetrying] = useState(false);
  /** Falha da última ação do usuário (gerar, tentar de novo) — já exibível. */
  const [actionError, setActionError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<MediaClip | null>(null);
  /** O que está sendo renomeado — o vídeo (cabeçalho) ou um corte. `null` = sheet fechado. */
  /** O menu "⋯" aberto — do vídeo (cabeçalho) ou de um corte. `null` = fechado. */
  const [menu, setMenu] = useState<{ kind: 'media' } | { kind: 'clip'; clip: MediaClip } | null>(null);
  const [renaming, setRenaming] = useState<{ kind: 'media' } | { kind: 'clip'; clip: MediaClip } | null>(null);
  /** Corte sendo baixado para salvar ou compartilhar — um por vez. */
  const [clipAction, setClipAction] = useState<{ id: number; kind: Exclude<ClipBusy, null> } | null>(null);
  /** Cortes já salvos na galeria nesta visita (o botão vira "Saved"). */
  const [savedIds, setSavedIds] = useState<ReadonlySet<number>>(new Set());

  const flow = media.data && clips.data ? clipFlow(media.data, clips.data) : null;

  const generate = async (regenerate: boolean) => {
    setGenerating(true);
    setActionError(null);
    try {
      await createClips(mediaId, { layout, regenerate });
    } catch (err) {
      // 409 = os cortes já existem ou já estão renderizando (outro aparelho,
      // ou uma resposta que estourou o timeout mas chegou ao backend). O
      // reload abaixo mostra o que existe; não é erro para o usuário.
      if (!(err instanceof ApiError && err.status === 409)) {
        setActionError(err instanceof ApiError ? err.message : String(err));
      }
    } finally {
      setGenerating(false);
      clips.reload();
    }
  };

  /** Cada geração custa uma ida ao Claude e apaga os cortes atuais — confirma antes. */
  const confirmRegenerate = () =>
    Alert.alert('Generate new clips?', 'The current clips will be replaced by 3 new ones.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Generate', style: 'destructive', onPress: () => generate(true) },
    ]);

  /**
   * `/complete` de novo: serve tanto para o upload cujo PUT terminou mas a
   * confirmação não chegou (app fechado no meio) quanto para refazer uma
   * transcrição que falhou — o backend aceita os dois casos.
   */
  const retryComplete = async () => {
    setRetrying(true);
    setActionError(null);
    try {
      await completeMedia(mediaId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // 409 com o upload ainda pendente = o arquivo não está inteiro no
        // storage (o backend confere existência e tamanho). Em qualquer outro
        // passo, o status mudou por fora (já transcrevendo) e o reload mostra.
        if (flow?.step === 'upload-incomplete') {
          setActionError("The file didn't fully reach our servers. Upload the video again from the Clips screen.");
        }
      } else {
        setActionError(err instanceof ApiError ? err.message : String(err));
      }
    } finally {
      setRetrying(false);
      media.reload();
    }
  };

  const runClipAction = async (clip: MediaClip, kind: Exclude<ClipBusy, null>) => {
    if (clipAction !== null) return;
    setClipAction({ id: clip.id, kind });
    try {
      if (kind === 'save') {
        await saveClipToDevice(mediaId, clip);
        setSavedIds((prev) => new Set(prev).add(clip.id));
      } else {
        await shareClip(mediaId, clip);
      }
    } catch (err) {
      const message =
        err instanceof ClipShareError || err instanceof ApiError
          ? err.message
          : kind === 'save'
            ? "Couldn't save the clip."
            : "Couldn't open the share screen.";
      Alert.alert(kind === 'save' ? "Couldn't save the clip" : "Couldn't share the clip", message);
    } finally {
      setClipAction(null);
    }
  };

  /** Grava o novo nome e já o mostra: o backend só troca o texto, então não há o que esperar. */
  const saveTitle = async (title: string) => {
    if (renaming?.kind === 'clip') {
      const updated = await renameClip(mediaId, renaming.clip.id, title);
      if (clips.data) clips.replace(clips.data.map((c) => (c.id === updated.id ? { ...c, title: updated.title } : c)));
    } else if (renaming?.kind === 'media') {
      const updated = await renameMedia(mediaId, title);
      if (media.data) media.replace({ ...media.data, title: updated.title });
    }
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/clips'));

  /** Apaga o que o menu escolheu. Corte: a lista nova vem na resposta. Vídeo: sai da tela, que deixou de existir. */
  const deleteItem = async () => {
    if (menu?.kind === 'clip') {
      clips.replace(await deleteClip(mediaId, menu.clip.id));
    } else if (menu?.kind === 'media') {
      await deleteMedia(mediaId);
      goBack();
    }
  };

  const reloadAll = () => {
    media.reload();
    clips.reload();
  };

  const subtitle = media.data
    ? [media.data.duration_s ? formatClock(media.data.duration_s) : null, formatBytes(media.data.size_bytes)]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={media.refreshing || clips.refreshing}
            onRefresh={reloadAll}
            tintColor={Colors.light.accent}
            colors={[Colors.light.accent]}
          />
        }
      >
        <View style={styles.header}>
          <Pressable
            onPress={goBack}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Back to your videos"
          >
            <IconChevronLeft size={20} sw={2.2} color={Colors.light.ink} />
          </Pressable>
          <View style={styles.flex}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {media.data?.title ?? 'Loading your video…'}
            </Text>
            {subtitle ? <Text style={styles.headerMeta}>{subtitle}</Text> : null}
          </View>
          {media.data ? (
            <Pressable
              onPress={() => setMenu({ kind: 'media' })}
              style={({ pressed }) => [styles.headerEdit, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`More options for ${media.data.title}`}
            >
              <IconMore size={22} color={Colors.light.ink2} />
            </Pressable>
          ) : null}
        </View>

        {media.error ? (
          <ErrorState title="Couldn't load this video" message={media.error} onRetry={media.reload} />
        ) : null}
        {clips.error ? (
          <ErrorState title="Couldn't load the clips" message={clips.error} onRetry={clips.reload} />
        ) : null}

        {!flow && (media.loading || clips.loading) ? <DetailSkeleton /> : null}

        {flow ? (
          <FlowBody
            flow={flow}
            layout={layout}
            onLayoutChange={setLayout}
            generating={generating}
            retrying={retrying}
            actionError={actionError}
            onGenerate={() => generate(false)}
            onRegenerate={confirmRegenerate}
            onRetry={retryComplete}
          />
        ) : null}

        {clips.data?.map((clip) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            excerpt={clipExcerpt(segments, clip.start_s, clip.end_s)}
            onPlay={() => setPlaying(clip)}
            onMenu={() => setMenu({ kind: 'clip', clip })}
            onSave={canSaveClips ? () => runClipAction(clip, 'save') : undefined}
            onShare={canShareClips ? () => runClipAction(clip, 'share') : undefined}
            busy={clipAction?.id === clip.id ? clipAction.kind : null}
            saved={savedIds.has(clip.id)}
            // Um download por vez: os outros botões esperam.
            actionsDisabled={clipAction !== null}
          />
        ))}
      </ScrollView>

      <ClipPlayer
        mediaId={mediaId}
        clip={playing}
        onClose={() => setPlaying(null)}
        onSave={playing && canSaveClips ? () => runClipAction(playing, 'save') : undefined}
        onShare={playing && canShareClips ? () => runClipAction(playing, 'share') : undefined}
        busy={playing && clipAction?.id === playing.id ? clipAction.kind : null}
        saved={playing ? savedIds.has(playing.id) : false}
        actionsDisabled={clipAction !== null}
      />

      {menu && media.data ? (
        <ItemMenu
          heading={menu.kind === 'clip' ? menu.clip.title : media.data.title}
          kind={menu.kind === 'clip' ? 'clip' : 'video'}
          consequence={
            menu.kind === 'clip'
              ? 'The clip and its file are removed; the rest of the video stays.'
              : clips.data?.length
                ? `This removes the video file, its ${clips.data.length} ${clips.data.length === 1 ? 'clip' : 'clips'} and the transcript.`
                : 'This removes the video file and its transcript.'
          }
          onRename={() => setRenaming(menu)}
          onDelete={deleteItem}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {renaming && media.data ? (
        <RenameSheet
          heading={renaming.kind === 'clip' ? 'Rename clip' : 'Rename video'}
          initial={renaming.kind === 'clip' ? renaming.clip.title : media.data.title}
          onSave={saveTitle}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </ScreenShell>
  );
}

/** O bloco acima dos cortes: o que está acontecendo agora e o que fazer. */
function FlowBody({
  flow,
  layout,
  onLayoutChange,
  generating,
  retrying,
  actionError,
  onGenerate,
  onRegenerate,
  onRetry,
}: {
  flow: ClipFlow;
  layout: ClipLayout;
  onLayoutChange: (next: ClipLayout) => void;
  generating: boolean;
  retrying: boolean;
  actionError: string | null;
  onGenerate: () => void;
  onRegenerate: () => void;
  onRetry: () => void;
}) {
  switch (flow.step) {
    case 'upload-incomplete':
      return (
        <View style={styles.block}>
          <StatusCard
            title="The upload didn't finish"
            text="The app may have closed while sending. If the file got through, checking again starts the transcription."
          />
          {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
          <ActionButton label="Check again" busy={retrying} onPress={onRetry} />
        </View>
      );
    case 'transcribing':
      return (
        <StatusCard
          busy
          step={1}
          title="Transcribing your video"
          text="Long videos take a few minutes. You can leave this screen — we keep working and pick up here when you come back."
        />
      );
    case 'transcription-stalled':
      return (
        <View style={styles.block}>
          <StatusCard
            title="This is taking longer than it should"
            text="The transcription seems to have stopped on our side. Start it again — the uploaded file is still here."
          />
          {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
          <ActionButton label="Transcribe again" busy={retrying} onPress={onRetry} />
        </View>
      );
    case 'transcription-failed':
      return (
        <View style={styles.block}>
          <ErrorState title="Transcription failed" message={flow.error} />
          {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
          <ActionButton label="Transcribe again" busy={retrying} onPress={onRetry} />
        </View>
      );
    case 'audio-only':
      return (
        <EmptyState
          Icon={IconScissors}
          title="Clips need a video"
          text="This file is audio only. Upload a video to get vertical clips."
        />
      );
    case 'expired':
      return (
        <EmptyState
          Icon={IconScissors}
          title="This video expired"
          text="Uploads are only kept for a limited time. Send the video again to make new clips."
        />
      );
    case 'choose-layout':
      return (
        <GeneratePanel
          title="How should we frame the clips?"
          layout={layout}
          onLayoutChange={onLayoutChange}
          busy={generating}
          error={actionError}
          label="Generate 3 clips"
          onPress={onGenerate}
        />
      );
    case 'rendering':
      return (
        <StatusCard
          busy
          step={3}
          title={`Rendering clips · ${flow.ready} of ${flow.total} ready`}
          text="Each clip is cut to 9:16 with captions. They show up below as soon as they're ready."
        />
      );
    case 'rendering-stalled':
      return (
        <View style={styles.block}>
          <StatusCard
            title={`Rendering stopped · ${flow.ready} of ${flow.total} ready`}
            text="The remaining clips stopped rendering on our side. Generate them again to finish."
          />
          <RegeneratePanel
            initiallyOpen
            layout={layout}
            onLayoutChange={onLayoutChange}
            busy={generating}
            error={actionError}
            onPress={onRegenerate}
          />
        </View>
      );
    case 'done':
      return (
        <View style={styles.block}>
          <Text style={styles.summary}>
            {flow.ready} {flow.ready === 1 ? 'clip' : 'clips'} ready
            {flow.failed ? ` · ${flow.failed} failed` : ''}
          </Text>
          <RegeneratePanel
            // Corte que falhou não tem como refazer sozinho: o backend só
            // regera os três. Com falha, o painel já nasce aberto.
            initiallyOpen={flow.failed > 0}
            layout={layout}
            onLayoutChange={onLayoutChange}
            busy={generating}
            error={actionError}
            onPress={onRegenerate}
          />
        </View>
      );
  }
}

/** Layout + botão de gerar — o mesmo bloco na primeira geração e ao refazer. */
function GeneratePanel({
  title,
  layout,
  onLayoutChange,
  busy,
  error,
  label,
  onPress,
}: {
  title: string;
  layout: ClipLayout;
  onLayoutChange: (next: ClipLayout) => void;
  busy: boolean;
  error: string | null;
  label: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.generateBox}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <LayoutPicker value={layout} onChange={onLayoutChange} disabled={busy} />
      {error ? <Text style={styles.actionError}>{error}</Text> : null}
      <Pressable
        onPress={onPress}
        disabled={busy}
        style={({ pressed }) => [styles.generate, busy && styles.generateBusy, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
      >
        {busy ? (
          <ActivityIndicator size="small" color={Colors.light.card} />
        ) : (
          <IconZap size={16} sw={2.2} color={Colors.light.card} />
        )}
        <Text style={styles.generateText}>{busy ? 'Picking the best moments…' : label}</Text>
      </Pressable>
    </View>
  );
}

/** "Não gostei" fica recolhido: refazer custa uma ida ao Claude e troca os cortes. */
function RegeneratePanel({
  initiallyOpen,
  ...panel
}: {
  initiallyOpen: boolean;
  layout: ClipLayout;
  onLayoutChange: (next: ClipLayout) => void;
  busy: boolean;
  error: string | null;
  onPress: () => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  if (!open) {
    return (
      <ActionButton
        quiet
        label="Not happy with these? Generate again"
        busy={false}
        onPress={() => setOpen(true)}
      />
    );
  }
  return <GeneratePanel title="Generate new clips" label="Generate again" {...panel} />;
}

/** Ação secundária (contorno), com spinner enquanto roda. */
function ActionButton({
  label,
  busy,
  onPress,
  quiet = false,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
  /** Sem contorno nem rosa: para o que não deve competir com a ação principal da tela. */
  quiet?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [quiet ? styles.actionQuiet : styles.action, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={quiet ? Colors.light.ink2 : Colors.light.accent} />
      ) : (
        <IconRefresh size={15} sw={2.2} color={quiet ? Colors.light.ink2 : Colors.light.accent} />
      )}
      <Text style={quiet ? styles.actionQuietText : styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const LAYOUTS: { value: ClipLayout; title: string; text: string }[] = [
  {
    value: 'auto',
    title: 'Automatic',
    text: 'We look at the video and pick the framing for you. Recommended.',
  },
  {
    value: 'crop',
    title: 'Face to camera',
    text: 'Crops the center of the frame. Best when someone is talking to the camera.',
  },
  {
    value: 'fit',
    title: 'Screen recording',
    text: 'Keeps the whole frame over a blurred background. Best for slides, games and screen shares.',
  },
];

function LayoutPicker({
  value,
  onChange,
  disabled,
}: {
  value: ClipLayout;
  onChange: (next: ClipLayout) => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.layouts} accessibilityRole="radiogroup">
      {LAYOUTS.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            style={[styles.layout, selected && styles.layoutSelected]}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
          >
            <View style={[styles.radio, selected && styles.radioSelected]}>
              {selected ? <View style={styles.radioDot} /> : null}
            </View>
            <View style={styles.flex}>
              <Text style={styles.layoutTitle}>{option.title}</Text>
              <Text style={styles.layoutText}>{option.text}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function StatusCard({
  title,
  text,
  busy = false,
  step,
}: {
  title: string;
  text: string;
  busy?: boolean;
  /** Passo do `PipelineSteps` em andamento; sem ele o card não mostra o caminho. */
  step?: number;
}) {
  return (
    <View style={styles.status}>
      <View style={styles.statusTop}>
        {/* Com o passo a passo, o anel pulsante do passo atual já diz que está trabalhando. */}
        {busy && step === undefined ? <ActivityIndicator color={Colors.light.accent} /> : null}
        <View style={styles.flex}>
          <Text style={styles.statusTitle}>{title}</Text>
          <Text style={styles.statusText}>{text}</Text>
        </View>
      </View>
      {step !== undefined ? <PipelineSteps current={step} /> : null}
    </View>
  );
}

function DetailSkeleton() {
  return (
    <View style={styles.skeleton} accessible accessibilityLabel="Loading video">
      <Skeleton height={76} radius={Radius.lg} />
      <Skeleton height={150} radius={Radius.lg} />
    </View>
  );
}

/** Altura do atalho "Chat" flutuante (44) + a margem dele (16) + respiro: o último card não pode ficar debaixo dele. */
const FAB_CLEARANCE = 44 + Spacing.three + Spacing.four;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.three - 4, paddingTop: Spacing.three, gap: Spacing.three - 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  back: {
    width: 44,
    height: 44,
    marginLeft: -Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontFamily: Fonts.bold, fontSize: 18, lineHeight: 24, color: Colors.light.ink },
  headerEdit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerMeta: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.light.ink3 },
  pressed: { opacity: 0.7 },
  skeleton: { gap: Spacing.three - 4 },
  block: { gap: Spacing.three - 4 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three - 6,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.light.accent,
  },
  actionText: { fontFamily: Fonts.bold, fontSize: 13, color: Colors.light.accent },
  actionQuiet: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 36,
    paddingHorizontal: Spacing.one,
  },
  actionQuietText: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.light.ink2 },

  status: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
    ...CardShadow,
  },
  statusTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  statusTitle: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.light.ink },
  statusText: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 19, color: Colors.light.ink2, marginTop: 2 },

  generateBox: {
    gap: Spacing.three - 4,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
    ...CardShadow,
  },
  sectionTitle: { fontFamily: Fonts.bold, fontSize: 15, color: Colors.light.ink },
  layouts: { gap: Spacing.two },
  layout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two + 2,
    padding: Spacing.three - 4,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  layoutSelected: { borderColor: Colors.light.accent, backgroundColor: Colors.light.accentSoft },
  radio: {
    width: 18,
    height: 18,
    marginTop: 1,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: Colors.light.ink3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: Colors.light.accent },
  radioDot: { width: 8, height: 8, borderRadius: Radius.pill, backgroundColor: Colors.light.accent },
  layoutTitle: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.light.ink },
  layoutText: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Colors.light.ink2, marginTop: 2 },
  actionError: { fontFamily: Fonts.semibold, fontSize: 13, lineHeight: 19, color: Colors.light.danger },
  generate: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three - 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accent,
  },
  generateBusy: { opacity: 0.8 },
  generateText: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.light.card },

  summary: { fontFamily: Fonts.bold, fontSize: 18, color: Colors.light.ink, paddingHorizontal: Spacing.one },
});
