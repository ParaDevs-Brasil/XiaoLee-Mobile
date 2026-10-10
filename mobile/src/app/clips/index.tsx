import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteMedia, listMedia, renameMedia, type MediaAsset } from '@/api/backend';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { GlossaryCard } from '@/components/glossary-card';
import { IconScissors, IconUpload } from '@/components/icons';
import { ItemMenu } from '@/components/item-menu';
import { PipelineSteps } from '@/components/pipeline-steps';
import { RenameSheet } from '@/components/rename-sheet';
import { PageHeading, ScreenShell } from '@/components/screen-shell';
import { VideoRow } from '@/components/video-row';
import { CardShadow, Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useKeyboard } from '@/hooks/use-keyboard';
import { useMediaUpload } from '@/hooks/use-media-upload';
import {
  formatBytes,
  formatEta,
  mediaFilterCounts,
  mediaFilterOf,
  type MediaFilter,
} from '@/lib/clips';

/** Só vale oferecer filtro quando a lista já é longa o bastante para precisar dele. */
const FILTER_MIN_VIDEOS = 4;

const FILTERS: { value: MediaFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'processing', label: 'Processing' },
  { value: 'ready', label: 'Ready' },
  { value: 'attention', label: 'Needs attention' },
];

/**
 * Entrada do Clipper: envia um vídeo longo e leva para a tela dele
 * (`clips/[id]`), que acompanha transcrição e cortes pelo backend. Abaixo,
 * os vídeos já enviados — é por aqui que se volta a um processamento que
 * continuou com o app fechado.
 */
export default function ClipsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const upload = useMediaUpload();
  const keyboard = useKeyboard();
  // Consulta só enquanto algum vídeo transcreve OU renderiza cortes — é o que
  // muda sozinho do lado do backend (ver `mediaListStatus`).
  const media = useBackendData(listMedia, {
    pollMs: (list) => (list?.some((m) => mediaFilterOf(m) === 'processing') ? 5_000 : undefined),
  });

  const [filter, setFilter] = useState<MediaFilter>('all');
  /** Vídeo com o menu "⋯" aberto, e o que está sendo renomeado — `null` = fechado. */
  const [menuFor, setMenuFor] = useState<MediaAsset | null>(null);
  const [renaming, setRenaming] = useState<MediaAsset | null>(null);
  const videos = media.data ?? [];
  const counts = mediaFilterCounts(videos);
  const showFilters = videos.length >= FILTER_MIN_VIDEOS;
  // O filtro some quando a lista encolhe (ex.: o último "Processing" terminou
  // enquanto ele estava ativo): sem isso a tela ficaria vazia e sem saída.
  const activeFilter = showFilters && counts[filter] > 0 ? filter : 'all';
  const visible = activeFilter === 'all' ? videos : videos.filter((m) => mediaFilterOf(m) === activeFilter);

  const openMedia = (id: number) =>
    router.push({ pathname: '/clips/[id]', params: { id: String(id) } });

  const pickAndUpload = async () => {
    const asset = await upload.start();
    if (!asset) return;
    upload.reset();
    media.reload();
    openMedia(asset.id);
  };

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE + (keyboard.visible ? keyboard.height : insets.bottom) }]}
        showsVerticalScrollIndicator={false}
        // Com o teclado aberto no "Words to get right", tocar num chip ou no Undo precisa valer no primeiro toque.
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={media.refreshing}
            onRefresh={media.reload}
            tintColor={Colors.light.accent}
            colors={[Colors.light.accent]}
          />
        }
      >
        <PageHeading
          title="Clips"
          subtitle="Turn a long video into 3 vertical clips with captions."
        />

        <UploadCard state={upload.state} onPick={pickAndUpload} onCancel={upload.cancel} />

        {upload.state.phase === 'error' ? (
          <ErrorState title="Upload failed" message={upload.state.message} onRetry={pickAndUpload} />
        ) : null}

        <GlossaryCard />

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Your videos</Text>
          {videos.length ? (
            <Text style={styles.sectionCount}>
              {videos.length} {videos.length === 1 ? 'video' : 'videos'}
            </Text>
          ) : null}
        </View>

        {showFilters ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
            accessibilityRole="tablist"
          >
            {FILTERS.filter((f) => f.value === 'all' || counts[f.value] > 0).map((f) => {
              const selected = f.value === activeFilter;
              return (
                <Pressable
                  key={f.value}
                  onPress={() => setFilter(f.value)}
                  style={({ pressed }) => [styles.filter, selected && styles.filterSelected, pressed && styles.pressed]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${f.label}, ${counts[f.value]}`}
                >
                  <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                    {f.label} · {counts[f.value]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {media.error ? (
          <ErrorState title="Couldn't load your videos" message={media.error} onRetry={media.reload} />
        ) : null}

        {media.loading && !media.data ? (
          <View style={styles.list}>
            <Skeleton height={84} radius={Radius.lg} />
            <Skeleton height={84} radius={Radius.lg} />
            <Skeleton height={84} radius={Radius.lg} />
          </View>
        ) : null}

        {media.data && media.data.length === 0 && upload.state.phase !== 'uploading' ? (
          <EmptyState
            Icon={IconScissors}
            title="No videos yet"
            text="Your uploads show up here, with their clips."
          />
        ) : null}

        {visible.length ? (
          <View style={styles.list}>
            {visible.map((item) => (
              <VideoRow key={item.id} item={item} onPress={() => openMedia(item.id)} onMenu={() => setMenuFor(item)} />
            ))}
          </View>
        ) : null}
      </ScrollView>

      {menuFor ? (
        <ItemMenu
          heading={menuFor.title}
          kind="video"
          consequence={
            menuFor.clips_total
              ? `This removes the video file, its ${menuFor.clips_total} ${menuFor.clips_total === 1 ? 'clip' : 'clips'} and the transcript.`
              : 'This removes the video file and its transcript.'
          }
          onRename={() => setRenaming(menuFor)}
          onDelete={async () => {
            await deleteMedia(menuFor.id);
            media.reload();
          }}
          onClose={() => setMenuFor(null)}
        />
      ) : null}

      {renaming ? (
        <RenameSheet
          heading="Rename video"
          initial={renaming.title}
          onSave={async (title) => {
            const updated = await renameMedia(renaming.id, title);
            media.replace(videos.map((m) => (m.id === updated.id ? { ...m, title: updated.title } : m)));
          }}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </ScreenShell>
  );
}

function UploadCard({
  state,
  onPick,
  onCancel,
}: {
  state: ReturnType<typeof useMediaUpload>['state'];
  onPick: () => void;
  onCancel: () => void;
}) {
  if (state.phase === 'uploading') return <UploadingCard state={state} onCancel={onCancel} />;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.iconTile}>
          <IconScissors size={24} sw={2} color={Colors.light.accent} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Create clips</Text>
          <Text style={styles.hint}>A podcast, live or talk, up to 2 GB.</Text>
        </View>
      </View>
      <Pressable
        onPress={onPick}
        style={({ pressed }) => [styles.pick, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Choose a video to turn into clips"
      >
        <IconUpload size={18} sw={2.2} color={Colors.light.card} />
        <Text style={styles.pickText}>Choose a video</Text>
      </Pressable>
    </View>
  );
}

/**
 * O upload em andamento. O tile 9:16 escuro é o mesmo das miniaturas: aqui ele é
 * o "futuro corte" e vai sendo preenchido de rosa conforme o arquivo sobe. Abaixo,
 * o caminho inteiro (upload → transcrição → momentos → corte) para a espera ter
 * um destino, e o que dá para saber de verdade: bytes enviados e quanto falta.
 */
function UploadingCard({
  state,
  onCancel,
}: {
  state: Extract<ReturnType<typeof useMediaUpload>['state'], { phase: 'uploading' }>;
  onCancel: () => void;
}) {
  const [fill] = useState(() => new Animated.Value(state.percent));
  useEffect(() => {
    // O nativo avisa em saltos de 1%; a animação suaviza o enchimento entre eles.
    Animated.timing(fill, {
      toValue: state.percent,
      duration: 600,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [fill, state.percent]);

  const sent = (state.totalBytes * state.percent) / 100;

  return (
    <View style={styles.card}>
      <View style={styles.uploadTop}>
        <View
          style={styles.uploadTile}
          accessibilityRole="progressbar"
          accessibilityLabel="Upload progress"
          accessibilityValue={{ min: 0, max: 100, now: state.percent }}
        >
          <Animated.View
            style={[styles.uploadFill, { height: fill.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]}
          />
          <IconScissors size={20} sw={2} color={Colors.light.card} />
          <Text style={styles.uploadPercent}>{state.percent}%</Text>
        </View>

        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Uploading your video</Text>
          <Text style={styles.uploadName} numberOfLines={1}>
            {state.filename}
          </Text>
          <Text style={styles.uploadMeta}>
            {formatBytes(sent)} of {formatBytes(state.totalBytes)}
          </Text>
          <Text style={styles.uploadMeta}>{state.etaSeconds !== null ? formatEta(state.etaSeconds) : 'Estimating time left…'}</Text>
        </View>
      </View>

      <PipelineSteps current={0} />

      <View style={styles.uploadFooter}>
        <Text style={[styles.hint, styles.flex]}>Keep the app open until it finishes.</Text>
        <Pressable
          onPress={onCancel}
          hitSlop={Spacing.two}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Cancel upload"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Altura do atalho "Chat" flutuante (44) + a margem dele (16) + respiro: a última linha não pode ficar debaixo dele. */
const FAB_CLEARANCE = 44 + Spacing.three + Spacing.four;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.three - 4, paddingTop: Spacing.three, gap: Spacing.three - 4 },
  pressed: { opacity: 0.7 },
  card: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
    ...CardShadow,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  iconTile: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontFamily: Fonts.bold, fontSize: 18, lineHeight: 24, color: Colors.light.ink },
  hint: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 19, color: Colors.light.ink2 },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 52,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accent,
  },
  pickText: { fontFamily: Fonts.bold, fontSize: 15, color: Colors.light.card },
  uploadTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  uploadTile: {
    width: 72,
    aspectRatio: 9 / 16,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.ink,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    overflow: 'hidden',
  },
  uploadFill: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: Colors.light.accent },
  uploadPercent: { fontFamily: Fonts.bold, fontSize: 18, color: Colors.light.card },
  uploadName: { fontFamily: Fonts.semibold, fontSize: 13, lineHeight: 19, color: Colors.light.ink2 },
  uploadMeta: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 19, color: Colors.light.ink2 },
  uploadFooter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  cancel: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  cancelText: { fontFamily: Fonts.bold, fontSize: 13, color: Colors.light.ink2 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.one,
    marginTop: Spacing.three,
  },
  sectionTitle: { fontFamily: Fonts.bold, fontSize: 18, color: Colors.light.ink },
  sectionCount: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.light.ink3 },
  filters: { gap: Spacing.two, paddingHorizontal: Spacing.one },
  filter: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three - 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  filterSelected: { backgroundColor: Colors.light.ink, borderColor: Colors.light.ink },
  filterText: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.light.ink2 },
  filterTextSelected: { color: Colors.light.card },
  list: { gap: Spacing.two + 2 },
});
