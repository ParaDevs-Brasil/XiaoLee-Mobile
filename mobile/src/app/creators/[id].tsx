import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  createCreatorVideo,
  getCreatorCatalog,
  listCreatorVideos,
  listCreators,
  writeCreatorScript,
  type CreatorCatalog,
  type CreatorQuality,
  type CreatorVideo,
  type SyntheticCreator,
} from '@/api/backend';
import { ApiError } from '@/api/client';
import { useCreatorStyles as useStyles } from '@/components/creator-styles';
import { EmptyState } from '@/components/feedback';
import { IconCheck, IconClose, IconPlay, IconSpark, IconUser } from '@/components/icons';
import { PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isVideoPending, maxWords, videoStatusLabel, wordCount } from '@/lib/creators-core';
import { shortHash } from '@/lib/format';
import { usePrivyWallet } from '@/lib/wallet';

const POLL_MS = 5000;
/** O botão flutuante do Chat cobre o fim da lista: a folga extra deixa o botão de pagar à vista. */
const CHAT_FAB_CLEARANCE = 72;

/**
 * Tela de uma persona: escreve (ou pede à Xiaolee) o roteiro, escolhe duração
 * e qualidade, vê o preço e paga em USDC. A assinatura EIP-3009 vai junto do
 * pedido; o backend confere valor/destino, faz o relay e só então gera.
 */
export default function CreatorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const creatorId = Number(id);
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const wallet = usePrivyWallet();

  const [catalog, setCatalog] = useState<CreatorCatalog | null>(null);
  const [creator, setCreator] = useState<SyntheticCreator | null | undefined>(undefined);
  const [videos, setVideos] = useState<CreatorVideo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [topic, setTopic] = useState('');
  const [script, setScript] = useState('');
  const [writing, setWriting] = useState(false);
  const [duration, setDuration] = useState(5);
  const [quality, setQuality] = useState<CreatorQuality['quality']>('standard');
  const [confirming, setConfirming] = useState(false);
  const [paying, setPaying] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);

  const fail = (e: unknown) =>
    setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Try again.');

  useFocusEffect(
    useCallback(() => {
      Promise.all([getCreatorCatalog(), listCreators(), listCreatorVideos(creatorId)])
        .then(([cat, list, vids]) => {
          setCatalog(cat);
          setCreator(list.find((c) => c.id === creatorId) ?? null);
          setVideos(vids);
        })
        .catch(fail);
    }, [creatorId]),
  );

  // Atualiza enquanto algum vídeo está sendo gerado.
  const pending = videos.some((v) => isVideoPending(v.status));
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      listCreatorVideos(creatorId).then(setVideos).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [pending, creatorId]);

  const limit = catalog ? maxWords(duration, catalog.words_per_s) : 0;
  const words = wordCount(script);
  const price = catalog?.qualities.find((q) => q.quality === quality)?.prices[String(duration)] ?? null;
  const canPay = Boolean(catalog?.enabled && catalog.pay_to && price && words > 0 && words <= limit) && !paying;

  async function writeForMe() {
    if (topic.trim().length < 3 || writing) return;
    setWriting(true);
    setError(null);
    try {
      const out = await writeCreatorScript({ creator_id: creatorId, topic: topic.trim(), duration_s: duration });
      setScript(out.script);
    } catch (e) {
      fail(e);
    } finally {
      setWriting(false);
    }
  }

  async function pay() {
    if (!canPay || !catalog?.pay_to || price === null) return;
    setPaying(true);
    setError(null);
    try {
      const payment = await wallet.signUsdcAuthorization(catalog.pay_to, price);
      const video = await createCreatorVideo(creatorId, { quality, duration_s: duration, script, payment });
      setVideos((list) => [video, ...list]);
      setConfirming(false);
      setScript('');
      setTopic('');
    } catch (e) {
      fail(e);
    } finally {
      setPaying(false);
    }
  }

  if (creator === null) {
    return (
      <ScreenShell>
        <View style={styles.content}>
          <EmptyState Icon={IconUser} title="Persona not found" text="It may have been deleted." />
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + CHAT_FAB_CLEARANCE + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <PageHeading title={creator?.name ?? 'Persona'} subtitle="Write what they say, pick length and quality, pay in USDC." />

        {creator?.image_url ? (
          <Image source={{ uri: creator.image_url }} style={[styles.photo, { height: 260, borderRadius: 12 }]} contentFit="cover" />
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <SectionCard title="Script" subtitle={`${words}/${limit} words for ${duration}s`}>
          <View style={styles.rowTop}>
            <TextInput
              value={topic}
              onChangeText={setTopic}
              placeholder="Topic — Xiaolee writes it for you"
              placeholderTextColor={colors.ink3}
              maxLength={500}
              style={[styles.input, { flex: 1 }]}
            />
            <Pressable
              onPress={writeForMe}
              disabled={writing || topic.trim().length < 3}
              style={[styles.primary, { paddingHorizontal: Spacing.three }, (writing || topic.trim().length < 3) && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel="Write the script for me"
            >
              {writing ? <ActivityIndicator color={colors.onAccent} /> : <IconSpark size={16} color={colors.onAccent} />}
            </Pressable>
          </View>
          <TextInput
            value={script}
            onChangeText={setScript}
            placeholder="Or type exactly what the persona says"
            placeholderTextColor={colors.ink3}
            multiline
            maxLength={2000}
            style={[styles.input, { minHeight: 110, borderRadius: 12, textAlignVertical: 'top' }]}
          />
          {words > limit ? <Text style={styles.error}>Too long for {duration}s — cut to {limit} words or pick a longer video.</Text> : null}
        </SectionCard>

        <SectionCard title="Length">
          <View style={styles.chips}>
            {catalog?.durations_s.map((d) => (
              <Pressable
                key={d}
                onPress={() => setDuration(d)}
                style={[styles.chip, duration === d && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: duration === d }}
              >
                <Text style={[styles.chipText, duration === d && styles.chipTextActive]}>{d}s</Text>
              </Pressable>
            ))}
          </View>
        </SectionCard>

        <SectionCard title="Quality" subtitle="Seedance 2.0 only works with original faces.">
          {catalog?.qualities.map((q) => (
            <Pressable
              key={q.quality}
              onPress={() => setQuality(q.quality)}
              style={[styles.row, quality === q.quality && { borderWidth: 1, borderColor: colors.accentFill }]}
              accessibilityRole="button"
              accessibilityState={{ selected: quality === q.quality }}
            >
              <View style={styles.rowBody}>
                <Text style={styles.provider}>{q.label}</Text>
              </View>
              <Text style={[styles.provider, { color: colors.accent }]}>${q.prices[String(duration)]?.toFixed(2)}</Text>
            </Pressable>
          ))}
        </SectionCard>

        {!confirming ? (
          <Pressable
            onPress={() => setConfirming(true)}
            disabled={!canPay}
            style={[styles.primary, !canPay && styles.disabled]}
            accessibilityRole="button"
          >
            <Text style={styles.btnText}>Create video{price !== null ? ` · $${price.toFixed(2)}` : ''}</Text>
          </Pressable>
        ) : (
          <SectionCard title={`Pay $${price?.toFixed(2)} USDC?`} subtitle="From your wallet on Arc. Generation starts after the payment confirms.">
            <Pressable onPress={pay} disabled={paying} style={styles.primary} accessibilityRole="button">
              {paying ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.btnText}>Confirm &amp; pay</Text>}
            </Pressable>
            <Pressable onPress={() => setConfirming(false)} disabled={paying} accessibilityRole="button">
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </SectionCard>
        )}

        {videos.length > 0 ? (
          <SectionCard title="Videos" subtitle={`${videos.length}`}>
            {videos.map((v) => (
              <Pressable
                key={v.id}
                onPress={() => v.video_url && setPlaying(v.video_url)}
                disabled={!v.video_url}
                style={styles.row}
                accessibilityRole="button"
              >
                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    {v.status === 'done' ? <IconCheck size={14} color={colors.accent} /> : null}
                    <Text style={styles.provider}>{videoStatusLabel(v.status)}</Text>
                  </View>
                  <Text style={styles.desc} numberOfLines={2}>{v.script}</Text>
                  <Text style={styles.desc}>
                    {v.duration_s}s · ${v.price_usdc.toFixed(2)}{v.payment_tx ? ` · ${shortHash(v.payment_tx)}` : ''}
                    {v.refund_due ? ' · refund pending' : ''}
                  </Text>
                </View>
                {isVideoPending(v.status) ? <ActivityIndicator color={colors.accent} /> : null}
                {v.video_url ? <IconPlay size={20} color={colors.accent} /> : null}
              </Pressable>
            ))}
          </SectionCard>
        ) : null}
      </ScrollView>

      <Modal visible={playing !== null} animationType="slide" onRequestClose={() => setPlaying(null)}>
        {playing ? <Player url={playing} onClose={() => setPlaying(null)} /> : null}
      </Modal>
    </ScreenShell>
  );
}

function Player({ url, onClose }: { url: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.play();
  });
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <VideoView player={player} nativeControls contentFit="contain" style={{ flex: 1 }} />
      <Pressable
        onPress={onClose}
        style={{ position: 'absolute', top: insets.top + 12, right: 16, padding: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <IconClose size={24} color="#fff" />
      </Pressable>
    </View>
  );
}
