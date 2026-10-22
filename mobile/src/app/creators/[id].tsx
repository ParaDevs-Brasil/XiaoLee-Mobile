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
  type CreatorPreview,
  type CreatorQuality,
  type CreatorVideo,
  type SyntheticCreator,
} from '@/api/backend';
import { ApiError } from '@/api/client';
import { useCreatorStyles as useStyles } from '@/components/creator-styles';
import { CreatorFormatPicker, type CreatorFormat } from '@/components/creator-format-picker';
import { SwapPreview } from '@/components/swap-preview';
import { UploadTile } from '@/components/upload-tile';
import { EmptyState } from '@/components/feedback';
import { IconCheck, IconClose, IconPlay, IconSpark, IconUser } from '@/components/icons';
import { PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pickMotionVideo, uploadMotion, type PickedMotion } from '@/lib/creators';
import { isVideoPending, maxWords, motionDurations, videoStatusLabel, wordCount } from '@/lib/creators-core';
import { shortHash } from '@/lib/format';
import { usePrivyWallet } from '@/lib/wallet';

const POLL_MS = 5000;

const SOUNDS: { id: 'none' | 'original' | 'voice'; label: string; hint: string }[] = [
  { id: 'original', label: 'Original sound', hint: 'Keeps the sound from your video.' },
  { id: 'voice', label: 'Voice', hint: 'Your character says what you write.' },
  { id: 'none', label: 'Silent', hint: 'No sound. Add your own music when you post.' },
];
/** O botão flutuante do Chat cobre o fim da lista: a folga extra deixa o botão de pagar à vista. */
const CHAT_FAB_CLEARANCE = 72;

/**
 * Tela de um personagem: escolhe o formato (Talk: fala um roteiro; Mimic: copia o movimento de um vídeo; Swap: entra
 * no lugar de alguém num vídeo, com prévia grátis antes de pagar),
 * a duração e a qualidade, vê o preço e paga em USDC. A assinatura EIP-3009 vai junto do pedido; o backend
 * confere valor/destino, faz o relay e só então gera.
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
  const [format, setFormat] = useState<CreatorFormat>('speech');
  const [motion, setMotion] = useState<PickedMotion | null>(null);
  const [motionRights, setMotionRights] = useState(false);
  const [motionKey, setMotionKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<CreatorPreview | null>(null);
  const [scene, setScene] = useState('');
  const [audio, setAudio] = useState<'none' | 'original' | 'voice'>('original');
  const [chosenDuration, setDuration] = useState(5);
  const [chosenQuality, setQuality] = useState<CreatorQuality['quality']>('standard');
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

  const swap = format === 'swap';
  // Mimic e Swap partem de um vídeo de referência; o Talk parte de um roteiro.
  const moves = format !== 'speech';
  // Fala = o roteiro é dito em voz alta: o Talk sempre, Mimic/Swap só quando o usuário escolhe "Voice".
  const narrated = !moves || audio === 'voice';
  // O que vale vem do formato: as faixas e durações trocam sozinhas, sem estado a sincronizar.
  const qualities = catalog?.qualities.filter((q) => q.kind === format) ?? [];
  const quality = qualities.find((q) => q.quality === chosenQuality)?.quality ?? qualities[0]?.quality ?? chosenQuality;
  const durations = catalog ? (moves ? motionDurations(catalog.durations_s, motion?.seconds ?? 0) : catalog.durations_s) : [];
  const duration = durations.includes(chosenDuration) ? chosenDuration : (durations[0] ?? chosenDuration);
  const limit = catalog ? maxWords(duration, catalog.words_per_s) : 0;
  const words = wordCount(script);
  const price = qualities.find((q) => q.quality === quality)?.prices[String(duration)] ?? null;
  const scriptOk = words > 0 && words <= limit;
  const ready = moves
    ? Boolean(motion && motionRights && durations.includes(duration)) && (!narrated || scriptOk) && (!swap || preview?.status === 'ready')
    : scriptOk;
  const canPay = Boolean(catalog?.enabled && catalog.pay_to && price && ready) && !paying;

  async function pickMotion() {
    try {
      const picked = await pickMotionVideo();
      if (picked) {
        setMotion(picked);
        // Outro vídeo = outro arquivo no storage e outra prévia.
        setMotionKey(null);
        setPreview(null);
      }
    } catch (e) {
      fail(e);
    }
  }

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
      // Sobe o vídeo de movimento antes de assinar: a assinatura tem prazo e o upload pode demorar.
      const key = moves && motion ? (motionKey ?? (await uploadMotion(motion))) : undefined;
      const payment = await wallet.signUsdcAuthorization(catalog.pay_to, price);
      const video = await createCreatorVideo(creatorId, {
        quality,
        duration_s: duration,
        script: narrated ? script : scene,
        payment,
        ...(key ? { motion_key: key, motion_rights_confirmed: true, audio } : {}),
        ...(swap && preview ? { preview_id: preview.id } : {}),
      });
      setVideos((list) => [video, ...list]);
      setConfirming(false);
      setScript('');
      setTopic('');
      setScene('');
      setMotion(null);
      setMotionRights(false);
      setMotionKey(null);
      setPreview(null);
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
          <EmptyState Icon={IconUser} title="Character not found" text="It may have been deleted." />
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
        <PageHeading title={creator?.name ?? 'Character'} subtitle="Choose what it does, then pay to make the video." />

        {creator?.image_url ? (
          <Image
            source={{ uri: creator.image_url }}
            style={[styles.photo, { height: 260, borderRadius: 12 }]}
            contentFit="cover"
            contentPosition="top"
          />
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <CreatorFormatPicker value={format} onChange={(f) => { setFormat(f); setConfirming(false); }} />

        {moves ? (
          <SectionCard
            title={swap ? 'Video' : 'Movement'}
            subtitle={
              swap
                ? 'Your video stays as it is. Your character takes the place of the person in it.'
                : 'Your character copies the moves from a video. The scene comes from the character’s photo.'
            }
          >
            <UploadTile
              title="Choose a video"
              hint={
                swap
                  ? 'The person you want to replace should be clearly in view.'
                  : 'One person, full body, staying in place, steady camera.'
              }
              onPress={pickMotion}
              Icon={IconPlay}
              chosen={Boolean(motion)}
              chosenTitle={motion ? `Video chosen · ${Math.round(motion.seconds)}s` : undefined}
              height={150}
              accessibilityLabel="Choose a video"
            />
            <Text style={styles.label}>Sound</Text>
            <View style={styles.chips}>
              {SOUNDS.map((o) => (
                <Pressable
                  key={o.id}
                  onPress={() => setAudio(o.id)}
                  style={[styles.chip, audio === o.id && styles.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: audio === o.id }}
                >
                  <Text style={[styles.chipText, audio === o.id && styles.chipTextActive]}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.desc}>{SOUNDS.find((o) => o.id === audio)?.hint}</Text>
            {audio !== 'voice' ? (
              <TextInput
                value={scene}
                onChangeText={setScene}
                placeholder={swap ? 'Anything else to change? (optional)' : 'Describe the scene (optional)'}
                placeholderTextColor={colors.ink3}
                maxLength={300}
                style={styles.input}
              />
            ) : null}
            <Pressable
              onPress={() => setMotionRights((v) => !v)}
              style={styles.rowTop}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: motionRights }}
            >
              <View style={[styles.checkbox, motionRights && styles.chipActive]}>
                {motionRights ? <IconCheck size={14} color={colors.onAccent} /> : null}
              </View>
              <Text style={[styles.desc, { flex: 1 }]}>
                I have the right to use this video and its sound. The result is made with AI and I won&apos;t use it to deceive or harass anyone.
              </Text>
            </Pressable>
            {motion && durations.length === 0 ? (
              <Text style={styles.error}>This video is shorter than {catalog?.durations_s[0]}s. Pick a longer one.</Text>
            ) : null}
          </SectionCard>
        ) : null}

        {swap ? (
          <SwapPreview
            creatorId={creatorId}
            motion={motion}
            rights={motionRights}
            motionKey={motionKey}
            onMotionKey={setMotionKey}
            preview={preview}
            onPreview={setPreview}
            onError={fail}
          />
        ) : null}

        {narrated ? (
        <SectionCard title={moves ? 'What your character says' : 'Script'} subtitle={`${words} of ${limit} words · ${duration}s`}>
          <View style={styles.rowTop}>
            <TextInput
              value={topic}
              onChangeText={setTopic}
              placeholder="Give a topic and Xiaolee writes it"
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
            placeholder="Or write what your character says"
            placeholderTextColor={colors.ink3}
            multiline
            maxLength={2000}
            style={[styles.input, { minHeight: 110, borderRadius: 12, textAlignVertical: 'top' }]}
          />
          {words > limit ? <Text style={styles.error}>Too long for {duration} seconds. Cut it to {limit} words or pick a longer length.</Text> : null}
        </SectionCard>
        ) : null}

        <SectionCard title="Length" subtitle={moves && !motion ? 'Choose your video first.' : undefined}>
          <View style={styles.chips}>
            {durations.map((d) => (
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

        <SectionCard title="Quality">
          {qualities.map((q) => (
            <Pressable
              key={q.quality}
              onPress={() => setQuality(q.quality)}
              style={[styles.row, quality === q.quality && { borderWidth: 1, borderColor: colors.accentFill }]}
              accessibilityRole="button"
              accessibilityState={{ selected: quality === q.quality }}
            >
              <View style={styles.rowBody}>
                <Text style={styles.provider}>{q.label}</Text>
                <Text style={styles.desc}>{q.hint}</Text>
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
          <SectionCard title={`Pay $${price?.toFixed(2)} in USDC?`} subtitle="Paid from your wallet. We start as soon as the payment goes through.">
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
                  {v.status === 'failed' && v.error ? <Text style={styles.error}>{v.error}</Text> : null}
                  <Text style={styles.desc} numberOfLines={2}>
                    {v.script || { mimic: 'Mimic', swap: 'Swap' }[catalog?.qualities.find((q) => q.quality === v.quality)?.kind as string] || ''}
                  </Text>
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
