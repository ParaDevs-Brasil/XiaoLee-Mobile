import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import {
  deleteMedia,
  listCreatorReports,
  listCreators,
  listMedia,
  listSocialAccounts,
  renameMedia,
  type MediaAsset,
} from '@/api/backend';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { IconChevronRight, IconClipboard, IconScissors, IconShare, IconUpload, IconUser } from '@/components/icons';
import { ItemMenu } from '@/components/item-menu';
import { RenameSheet } from '@/components/rename-sheet';
import { FAB_CLEARANCE, ScreenShell } from '@/components/screen-shell';
import { VideoRow } from '@/components/video-row';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useMediaUpload } from '@/hooks/use-media-upload';
import { useSession } from '@/hooks/use-session';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { mediaFilterOf } from '@/lib/clips';
import { reportPeriodLabel } from '@/lib/creator-report';
import { getSession } from '@/lib/session';

/**
 * Studio — frame "Studio / Light" do Figma (XiaoLee v2): subir um vídeo, o cartão do X e as quatro listas do que o
 * creator produz (Clips, Reports, AI Creators, Posts). Cada aba reaproveita a fonte de dados da tela que ela atalha;
 * o toque abre a tela de detalhe de sempre.
 *
 * Sem sessão as rotas respondem 401 — `signedIn` devolve lista vazia para a aba cair no estado de convidado.
 */

type Tab = 'clips' | 'reports' | 'creators' | 'posts';
const TABS: { id: Tab; label: string }[] = [
  { id: 'clips', label: 'Clips' },
  { id: 'reports', label: 'Reports' },
  { id: 'creators', label: 'AI Creators' },
  { id: 'posts', label: 'Posts' },
];

async function signedIn<T>(fetcher: () => Promise<T>, empty: T): Promise<T> {
  return (await getSession()) ? fetcher() : empty;
}

export default function StudioScreen() {
  const colors = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { hasSession } = useSession();
  const upload = useMediaUpload();
  const [tab, setTab] = useState<Tab>('clips');
  const [menuFor, setMenuFor] = useState<MediaAsset | null>(null);
  const [renaming, setRenaming] = useState<MediaAsset | null>(null);

  const media = useBackendData(() => signedIn(listMedia, []), {
    pollMs: (list) => (list?.some((m) => mediaFilterOf(m) === 'processing') ? 5_000 : undefined),
  });
  const reports = useBackendData(() => signedIn(listCreatorReports, []));
  const creators = useBackendData(() => signedIn(listCreators, []));
  // Publicação desligada no backend responde 404: o cartão cai em "Not connected".
  const social = useBackendData(() => signedIn(() => listSocialAccounts().catch(() => null), null));
  const x = social.data?.accounts.find((a) => a.platform === 'x');

  const active = { clips: media, reports, creators, posts: null }[tab];
  const videos = media.data ?? [];

  const pick = async () => {
    const asset = await upload.start();
    if (!asset) return;
    upload.reset();
    media.reload();
    router.push({ pathname: '/clips/[id]', params: { id: String(asset.id) } });
  };

  const reloadAll = () => {
    media.reload();
    reports.reload();
    creators.reload();
    social.reload();
  };

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={media.refreshing} onRefresh={reloadAll} tintColor={colors.accent} colors={[colors.accent]} />
        }
      >
        <View>
          <Text style={styles.title}>Studio</Text>
          <Text style={styles.subtitle}>Create, publish and track your content.</Text>
        </View>

        {/* No topo, antes dos cartões: é o que diz ao creator o que dá para fazer no Studio. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
          {TABS.map(({ id, label }) => {
            const selected = id === tab;
            return (
              <Pressable
                key={id}
                onPress={() => setTab(id)}
                style={[styles.tab, selected && styles.tabSelected]}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.iconTile}>
              <IconScissors size={22} sw={2} color={colors.accent} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Make a clip</Text>
              <Text style={styles.hint}>Pick a video and Xiaolee finds the best moments.</Text>
            </View>
          </View>
          {upload.state.phase === 'uploading' ? (
            <Pressable onPress={upload.cancel} style={styles.primary} accessibilityRole="button" accessibilityLabel="Cancel upload">
              <ActivityIndicator color={colors.onAccent} />
              <Text style={styles.primaryText}>Uploading {upload.state.percent}% · Cancel</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={pick}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Choose a video to turn into clips"
            >
              <IconUpload size={18} sw={2.2} color={colors.onAccent} />
              <Text style={styles.primaryText}>Choose a video</Text>
            </Pressable>
          )}
          {upload.state.phase === 'error' ? <Text style={styles.error}>{upload.state.message}</Text> : null}
        </View>

        <View style={[styles.card, styles.xCard]}>
          <View style={styles.xLogo}>
            <Text style={styles.xMark}>X</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>X</Text>
            <Text style={styles.hint}>{x ? x.handle : 'Not connected'}</Text>
          </View>
          {x ? null : (
            <Pressable
              onPress={() => router.push('/accounts')}
              style={({ pressed }) => [styles.outline, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Connect your X account"
            >
              <Text style={styles.outlineText}>Connect</Text>
            </Pressable>
          )}
        </View>

        {active?.error && hasSession ? (
          <ErrorState title="Couldn't load this list" message={active.error} onRetry={active.reload} />
        ) : null}
        {active?.loading && !active.data ? <Skeleton height={84} radius={Radius.lg} /> : null}

        {tab === 'clips' && media.data ? (
          videos.length ? (
            <View style={styles.list}>
              {videos.map((item) => (
                <VideoRow
                  key={item.id}
                  item={item}
                  onPress={() => router.push({ pathname: '/clips/[id]', params: { id: String(item.id) } })}
                  onMenu={() => setMenuFor(item)}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              Icon={IconScissors}
              title={hasSession ? 'No clips yet' : 'Sign in to make clips'}
              text="Your uploads show up here, with their clips."
            />
          )
        ) : null}

        {tab === 'reports' && reports.data ? (
          reports.data.length ? (
            <View style={styles.list}>
              {reports.data.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => router.push({ pathname: '/reports/[id]', params: { id: String(r.id) } })}
                  style={({ pressed }) => [styles.card, styles.row, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>{reportPeriodLabel(r.period_start, r.period_end)}</Text>
                    <Text style={styles.hint} numberOfLines={2}>
                      {r.summary}
                    </Text>
                  </View>
                  <IconChevronRight size={16} color={colors.ink3} />
                </Pressable>
              ))}
            </View>
          ) : (
            <EmptyState
              Icon={IconClipboard}
              title={hasSession ? 'No report yet' : 'Sign in to see your reports'}
              text="Your first report arrives 30 days after you join."
            />
          )
        ) : null}

        {tab === 'creators' && creators.data ? (
          creators.data.length ? (
            <View style={styles.list}>
              {creators.data.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => router.push({ pathname: '/creators/[id]', params: { id: String(c.id) } })}
                  style={({ pressed }) => [styles.card, styles.row, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  {c.image_url ? <Image source={{ uri: c.image_url }} style={styles.avatar} /> : <View style={styles.avatar} />}
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>{c.name}</Text>
                    <Text style={styles.hint}>{c.status}</Text>
                  </View>
                  <IconChevronRight size={16} color={colors.ink3} />
                </Pressable>
              ))}
            </View>
          ) : (
            <EmptyState
              Icon={IconUser}
              title={hasSession ? 'No characters yet' : 'Sign in to create characters'}
              text="Create an AI character and make videos with it."
              action={hasSession ? <LinkButton label="Create a character" onPress={() => router.push('/creators')} /> : undefined}
            />
          )
        ) : null}

        {/* Não há rota que liste os posts já publicados; até existir, a aba leva a quem escreve um. */}
        {tab === 'posts' ? (
          <EmptyState
            Icon={IconShare}
            title="No posts yet"
            text="Draft, preview and publish with Xiaolee. Your posts will be listed here."
            action={
              <LinkButton
                label={x ? 'Write a post' : 'Connect X first'}
                onPress={() =>
                  x
                    ? router.navigate({ pathname: '/chat', params: { ask: 'I want to post something on X, can you help me?' } })
                    : router.push('/accounts')
                }
              />
            }
          />
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

function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.outline, pressed && styles.pressed]} accessibilityRole="button">
      <Text style={styles.outlineText}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingTop: 20, gap: Spacing.three },
  pressed: { opacity: 0.85 },
  card: {
    ...CardShadow,
    backgroundColor: colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 20, color: colors.ink },
  hint: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 16, color: colors.ink2 },
  error: { fontFamily: Fonts.sans, fontSize: 12, color: colors.danger },
  primary: {
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: colors.accentFill,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.onAccent },
  xCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Pastilha em `ink` e letra em `bg`: escura no claro, clara no escuro, como no Figma.
  xLogo: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  xMark: { fontFamily: Fonts.bold, fontSize: 20, color: colors.bg },
  outline: {
    height: 44,
    paddingHorizontal: 20,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineText: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.accent },
  title: { fontFamily: Fonts.bold, fontSize: 24, lineHeight: 30, color: colors.ink },
  subtitle: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 18, color: colors.ink2 },
  tabs: { gap: 6 },
  tab: {
    height: 40,
    paddingHorizontal: 13,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSelected: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  tabText: { fontFamily: Fonts.semibold, fontSize: 13, color: colors.ink2 },
  tabTextSelected: { color: colors.onAccent },
  list: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTitle: { fontFamily: Fonts.bold, fontSize: 14, lineHeight: 20, color: colors.ink },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accentSoft },
}));
