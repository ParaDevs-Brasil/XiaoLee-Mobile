import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { listCreatorVideos, type CreatorVideo, type SyntheticCreator } from '@/api/backend';
import { VideoPlayerModal } from '@/components/clip-player';
import { IconCheck, IconDownload, IconPlay, IconSend, IconUser } from '@/components/icons';
import { VideoAction } from '@/components/video-action';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useVideoActions } from '@/hooks/use-video-actions';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { canSaveClips, canShareClips } from '@/lib/clip-share';
import { isVideoPending, videoStatusLabel } from '@/lib/creators-core';
import { timeAgo } from '@/lib/format';

const POLL_MS = 5000;
const PREVIEW_COUNT = 4;

type Item = { video: CreatorVideo; creator: SyntheticCreator };

/**
 * Todos os vídeos de todos os personagens num lugar só, do mais novo ao mais antigo, no topo da aba AI Creators.
 * Não há rota que liste tudo: busca a lista de cada personagem e junta aqui. Vídeos que falharam ficam só na tela do
 * personagem, onde está o motivo e o reembolso.
 */
export function CreatorVideosSection({ creators }: { creators: SyntheticCreator[] }) {
  const colors = useTheme();
  const styles = useStyles();
  const [items, setItems] = useState<Item[] | null>(null);
  const [all, setAll] = useState(false);
  const [playing, setPlaying] = useState<Item | null>(null);
  const actions = useVideoActions();

  const load = useCallback(async () => {
    const lists = await Promise.all(
      creators.map((creator) =>
        listCreatorVideos(creator.id)
          .then((videos) => videos.map((video) => ({ video, creator })))
          .catch(() => [] as Item[]),
      ),
    );
    setItems(
      lists
        .flat()
        .filter((i) => i.video.status !== 'failed')
        .sort((a, b) => (b.video.created_at ?? '').localeCompare(a.video.created_at ?? '')),
    );
  }, [creators]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const pending = items?.some((i) => isVideoPending(i.video.status)) ?? false;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [pending, load]);

  if (items === null || items.length === 0) return null;
  const shown = all ? items : items.slice(0, PREVIEW_COUNT);
  const titleOf = (i: Item) => `${i.creator.name} · ${i.video.duration_s}s`;

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={styles.title}>Your videos</Text>
        <Text style={styles.count}>{items.length}</Text>
      </View>
      {shown.map((item) => {
        const { video, creator } = item;
        const ready = Boolean(video.video_url);
        const saved = actions.savedIds.has(video.id);
        const busyKind = actions.action?.id === video.id ? actions.action.kind : null;
        return (
          <View key={video.id} style={styles.card}>
            <Pressable
              onPress={() => ready && setPlaying(item)}
              disabled={!ready}
              style={styles.main}
              accessibilityRole="button"
              accessibilityLabel={ready ? `Play video with ${creator.name}, ${video.duration_s} seconds` : `${creator.name}, ${videoStatusLabel(video.status)}`}
            >
              <View style={styles.avatar}>
                {creator.image_url ? (
                  <Image source={{ uri: creator.image_url }} style={styles.avatarImg} contentFit="cover" contentPosition={{ top: '12%' }} />
                ) : (
                  <IconUser size={20} color={colors.onMedia} />
                )}
                {ready ? (
                  <View style={styles.disc}>
                    <IconPlay size={12} sw={2.2} color={colors.ink} />
                  </View>
                ) : null}
              </View>
              <View style={styles.text}>
                <Text style={styles.name} numberOfLines={1}>
                  {creator.name}
                </Text>
                <Text style={styles.script} numberOfLines={1}>
                  {video.script || 'Video'}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {ready ? `${video.duration_s}s` : videoStatusLabel(video.status)}
                  {video.created_at ? ` · ${timeAgo(video.created_at)}` : ''}
                </Text>
              </View>
              {isVideoPending(video.status) ? <ActivityIndicator color={colors.accent} /> : null}
            </Pressable>
            {ready ? (
              <View style={styles.actions}>
                {canSaveClips ? (
                  <VideoAction
                    Icon={saved ? IconCheck : IconDownload}
                    label={saved ? 'Video saved to your gallery' : `Save video with ${creator.name} to your gallery`}
                    busy={busyKind === 'save'}
                    disabled={actions.action !== null || saved}
                    onPress={() => actions.run(video, 'save', titleOf(item))}
                  />
                ) : null}
                {canShareClips ? (
                  <VideoAction
                    Icon={IconSend}
                    label={`Share video with ${creator.name}`}
                    busy={busyKind === 'share'}
                    disabled={actions.action !== null}
                    onPress={() => actions.run(video, 'share', titleOf(item))}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
      {items.length > PREVIEW_COUNT ? (
        <Pressable onPress={() => setAll((v) => !v)} style={styles.more} accessibilityRole="button">
          <Text style={styles.moreText}>{all ? 'Show fewer' : `Show all ${items.length}`}</Text>
        </Pressable>
      ) : null}

      <VideoPlayerModal
        video={playing?.video.video_url ? { title: titleOf(playing), url: playing.video.video_url, durationS: playing.video.duration_s } : null}
        onClose={() => setPlaying(null)}
        onSave={playing && canSaveClips ? () => actions.run(playing.video, 'save', titleOf(playing)) : undefined}
        onShare={playing && canShareClips ? () => actions.run(playing.video, 'share', titleOf(playing)) : undefined}
        busy={actions.action && actions.action.id === playing?.video.id ? actions.action.kind : null}
        saved={playing ? actions.savedIds.has(playing.video.id) : false}
        actionsDisabled={actions.action !== null}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  section: { gap: Spacing.two + 4 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  title: { fontFamily: Fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink },
  count: { fontFamily: Fonts.semibold, fontSize: 13, color: colors.ink3 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two + 4,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  avatar: {
    width: 52,
    height: 68,
    borderRadius: 12,
    backgroundColor: colors.media,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  disc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    paddingLeft: 1,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: Fonts.bold, fontSize: 14, lineHeight: 20, color: colors.ink },
  script: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18, color: colors.ink2 },
  meta: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 16, color: colors.ink3 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  more: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, minHeight: 44, justifyContent: 'center' },
  moreText: { fontFamily: Fonts.bold, fontSize: 14, color: colors.accent },
}));
