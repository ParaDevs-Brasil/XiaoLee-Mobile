import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteMedia, getGlossary, listMedia, renameMedia, type MediaAsset } from '@/api/backend';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { FormatIdeasCard } from '@/components/format-ideas-card';
import { GlossaryCard } from '@/components/glossary-card';
import { IconChevronRight, IconPlay, IconScissors, IconSpark, IconUpload } from '@/components/icons';
import { ItemMenu } from '@/components/item-menu';
import { PipelineSteps } from '@/components/pipeline-steps';
import { RenameSheet } from '@/components/rename-sheet';
import { FAB_CLEARANCE, PageHeading, ScreenShell } from '@/components/screen-shell';
import { VideoRow } from '@/components/video-row';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
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
  return <ClipsView />;
}

/** O corpo da tela de Clips; `embedded` o encaixa dentro de outra tela (o Studio), sem moldura, rolagem nem título. */
export function ClipsView({ embedded = false }: { embedded?: boolean }) {
  const colors = useTheme();
  const styles = useStyles();
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

  const body = (
      <>
        {embedded ? null : (
          <PageHeading
          title="Clips"
          subtitle="Turn a long video into 3 vertical clips with captions."
        />
        )}

        <UploadCard state={upload.state} onPick={pickAndUpload} onCancel={upload.cancel} />

        {upload.state.phase === 'error' ? (
          <ErrorState title="Upload failed" message={upload.state.message} onRetry={pickAndUpload} />
        ) : null}

        <ToolTiles />

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
      </>
  );
  const sheets = (
      <>
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
      </>
  );

  if (embedded) {
    return (
      <>
        <View style={styles.embedded}>{body}</View>
        {sheets}
      </>
    );
  }

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
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {body}
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
  const colors = useTheme();
  const styles = useStyles();
  if (state.phase === 'uploading') return <UploadingCard state={state} onCancel={onCancel} />;

  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <View style={styles.flex}>
          <View style={styles.eyebrowRow}>
            <IconScissors size={14} sw={2.2} color={colors.accent} />
            <Text style={styles.eyebrow}>CLIPS</Text>
          </View>
          <Text style={styles.heroTitle}>Turn one long video into 3 vertical clips</Text>
          <Text style={styles.heroHint}>A podcast, live or talk, up to 2 GB.</Text>
        </View>
        <ClipFan />
      </View>
      <Pressable
        onPress={onPick}
        style={({ pressed }) => [styles.pick, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Choose a video to turn into clips"
      >
        <IconUpload size={20} sw={2.2} color={colors.onAccent} />
        <Text style={styles.pickText}>Choose a video</Text>
      </Pressable>
      <Text style={styles.heroSteps} accessibilityLabel="Upload, then transcribe, find moments, cut">
        Upload › Transcribe › Find moments › Cut
      </Text>
    </View>
  );
}

/** Três cortes verticais em leque: o que o creator vai receber, desenhado em vez de explicado. */
function ClipFan() {
  const colors = useTheme();
  const styles = useStyles();
  const card = (rotate: string, style: object) => (
    <View style={[styles.fanCard, { transform: [{ rotate }] }, style]}>
      <View style={styles.fanDisc}>
        <IconPlay size={9} sw={2.4} color={colors.onMedia} />
      </View>
      <View style={[styles.fanLine, { width: 26 }]} />
      <View style={[styles.fanLine, { width: 16 }]} />
    </View>
  );
  return (
    <View style={styles.fan} accessible={false} importantForAccessibility="no-hide-descendants">
      {card('-8deg', { left: 2, top: 16 })}
      {card('8deg', { left: 48, top: 6 })}
      {card('0deg', { left: 30, top: 10, zIndex: 1 })}
    </View>
  );
}

/**
 * Os dois atalhos sob o cartão principal: "Words to get right" e "Format ideas". Lado a lado não cabe abrir cada um no
 * lugar, então tocar abre o conteúdo (o mesmo cartão de antes, sem o cabeçalho) logo abaixo; tocar de novo recolhe.
 */
function ToolTiles() {
  const colors = useTheme();
  const styles = useStyles();
  const glossary = useBackendData(getGlossary);
  const [open, setOpen] = useState<'words' | 'formats' | null>(null);
  const words = glossary.data?.length ?? 0;
  const tiles = [
    {
      id: 'words' as const,
      title: 'Words to get right',
      sub: words ? `${words} ${words === 1 ? 'word' : 'words'} saved` : 'Names and slang for captions',
      Icon: IconSpark,
    },
    { id: 'formats' as const, title: 'Format ideas', sub: 'Ideas from your videos', Icon: IconScissors },
  ];
  return (
    <>
      <View style={styles.tiles}>
        {tiles.map(({ id, title, sub, Icon }) => {
          const selected = open === id;
          return (
            <Pressable
              key={id}
              onPress={() => setOpen(selected ? null : id)}
              style={({ pressed }) => [styles.tile, selected && styles.tileSelected, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ expanded: selected }}
              accessibilityLabel={title}
              accessibilityHint={selected ? 'Closes it' : 'Opens it below'}
            >
              <View style={styles.tileTop}>
                <View style={styles.tileIcon}>
                  <Icon size={20} sw={2} color={colors.accent} />
                </View>
                <View style={selected ? styles.chevronOpen : undefined}>
                  <IconChevronRight size={18} sw={2.2} color={colors.ink3} />
                </View>
              </View>
              <View>
                <Text style={styles.tileTitle}>{title}</Text>
                <Text style={styles.tileSub} numberOfLines={1}>
                  {sub}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {open === 'words' ? <GlossaryCard bare /> : null}
      {open === 'formats' ? <FormatIdeasCard bare /> : null}
    </>
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
  const colors = useTheme();
  const styles = useStyles();
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
          <IconScissors size={20} sw={2} color={colors.onMedia} />
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

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.three - 4, paddingTop: Spacing.three, gap: Spacing.three - 4 },
  embedded: { gap: Spacing.three - 4 },
  pressed: { opacity: 0.7 },
  card: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...CardShadow,
  },
  hero: {
    gap: Spacing.three,
    padding: 20,
    borderRadius: Radius.xl,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  eyebrow: { fontFamily: Fonts.bold, fontSize: 12, letterSpacing: 1, color: colors.accent },
  heroTitle: { fontFamily: Fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink },
  heroHint: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 16, color: colors.ink2, marginTop: 6 },
  heroSteps: { fontFamily: Fonts.semibold, fontSize: 12, lineHeight: 16, color: colors.ink2, textAlign: 'center' },
  fan: { width: 104, height: 92 },
  fanCard: {
    position: 'absolute',
    width: 44,
    height: 72,
    borderRadius: Radius.sm,
    backgroundColor: colors.media,
    alignItems: 'center',
    paddingTop: 16,
    gap: 4,
  },
  fanDisc: {
    width: 18,
    height: 18,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  fanLine: { height: 4, borderRadius: 2, backgroundColor: colors.onMedia, opacity: 0.85 },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: {
    flex: 1,
    gap: 12,
    padding: Spacing.three,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...CardShadow,
  },
  tileSelected: { borderColor: colors.accent },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  tileTitle: { fontFamily: Fonts.bold, fontSize: 14, lineHeight: 19, color: colors.ink },
  tileSub: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 16, color: colors.ink2 },
  cardTitle: { fontFamily: Fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink },
  hint: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 19, color: colors.ink2 },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    height: 52,
    borderRadius: Radius.lg,
    backgroundColor: colors.accentFill,
  },
  pickText: { fontFamily: Fonts.bold, fontSize: 15, color: colors.onAccent },
  uploadTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  uploadTile: {
    width: 72,
    aspectRatio: 9 / 16,
    borderRadius: Radius.lg,
    backgroundColor: colors.media,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    overflow: 'hidden',
  },
  uploadFill: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.accentFill },
  uploadPercent: { fontFamily: Fonts.bold, fontSize: 18, color: colors.onMedia },
  uploadName: { fontFamily: Fonts.semibold, fontSize: 13, lineHeight: 19, color: colors.ink2 },
  uploadMeta: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 19, color: colors.ink2 },
  uploadFooter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  cancel: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink2 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.one,
    marginTop: Spacing.three,
  },
  sectionTitle: { fontFamily: Fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink },
  sectionCount: { fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink3 },
  filters: { gap: Spacing.two, paddingHorizontal: Spacing.one },
  filter: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three - 4,
    borderRadius: Radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  filterSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  filterText: { fontFamily: Fonts.semibold, fontSize: 13, color: colors.ink2 },
  filterTextSelected: { color: colors.card },
  list: { gap: Spacing.two + 2 },
}));
