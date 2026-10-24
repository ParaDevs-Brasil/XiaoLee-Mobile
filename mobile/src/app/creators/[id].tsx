import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Defs, LinearGradient, Rect, Stop, Svg } from 'react-native-svg';

import {
  createCreatorVideo,
  getCreatorCatalog,
  listCreatorVideos,
  listCreators,
  updateCreator,
  writeCreatorScript,
  type CreatorCatalog,
  type CreatorPreview,
  type CreatorQuality,
  type CreatorVideo,
  type SyntheticCreator,
} from '@/api/backend';
import { ApiError } from '@/api/client';
import { useCreatorStyles as useStyles } from '@/components/creator-styles';
import { CreatorEditSheet } from '@/components/creator-edit-sheet';
import { CreatorFormatPicker, type CreatorFormat } from '@/components/creator-format-picker';
import { VideoPlayerModal } from '@/components/clip-player';
import { ExpandButton, PhotoViewer } from '@/components/photo-viewer';
import { PressableScale } from '@/components/touch-motion';
import { SwapPreview } from '@/components/swap-preview';
import { VideoAction } from '@/components/video-action';
import { MotionPicker } from '@/components/motion-picker';
import { EmptyState } from '@/components/feedback';
import {
  IconArrowRight,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconEdit,
  IconFileText,
  IconLightbulb,
  IconMic,
  IconPlay,
  IconSend,
  IconSpark,
  IconUser,
} from '@/components/icons';
import { FAB_CLEARANCE, PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { useVideoActions } from '@/hooks/use-video-actions';
import { useKeyboard } from '@/hooks/use-keyboard';
import { useTheme } from '@/hooks/use-theme';
import { pickMotionVideo, uploadMotion, type PickedMotion } from '@/lib/creators';
import { clampStart, isVideoPending, maxWords, motionDurations, videoStatusLabel, wordCount } from '@/lib/creators-core';
import { canSaveClips, canShareClips } from '@/lib/clip-share';
import { shortHash } from '@/lib/format';
import { usePrivyWallet } from '@/lib/wallet';

const POLL_MS = 5000;

const SOUNDS: { id: 'none' | 'original' | 'voice'; label: string; hint: string }[] = [
  { id: 'original', label: 'Original sound', hint: 'Keeps the sound from your video.' },
  { id: 'voice', label: 'Voice', hint: 'Your character says what you write.' },
  { id: 'none', label: 'Silent', hint: 'No sound. Add your own music when you post.' },
];

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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboard();
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const [viewingPhoto, setViewingPhoto] = useState(false);
  const [editing, setEditing] = useState(false);
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
  const [playing, setPlaying] = useState<CreatorVideo | null>(null);
  const { action, savedIds, run } = useVideoActions();

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
  // O que falta para liberar o botão, na ordem em que a pessoa resolve.
  const blocker = !catalog?.enabled
    ? 'Not available right now'
    : moves && !motion
      ? 'Choose your video first'
      : moves && !motionRights
        ? 'Confirm you have the rights'
        : narrated && !scriptOk
          ? 'Add your script first'
          : swap && preview?.status !== 'ready'
            ? 'Make the free preview first'
            : 'Almost there';
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

  // Soltou a janela do corte noutro ponto: a prévia do Swap era de outro trecho, então refaz.
  function pickStart(startS: number) {
    setMotion((m) => (m ? { ...m, startS } : m));
    setPreview(null);
  }

  // No Android com edge-to-edge o teclado cobre o campo e a lista não rola sozinha: quando ele sobe, leva o campo em
  // foco para um pouco acima das teclas.
  useEffect(() => {
    if (!keyboard.visible) return;
    const timer = setTimeout(() => {
      const scroll = scrollRef.current;
      const input = TextInput.State.currentlyFocusedInput?.();
      if (!scroll || !input) return;
      input.measure((_x, _y, _w, height, _pageX, pageY) => {
        const bottom = pageY + height + 24;
        const visibleBottom = Dimensions.get('window').height - keyboard.height;
        if (bottom > visibleBottom) {
          scroll.scrollTo({ y: scrollY.current + (bottom - visibleBottom), animated: true });
        }
      });
    }, 60);
    return () => clearTimeout(timer);
  }, [keyboard.visible, keyboard.height]);

  async function writeForMe() {
    if (topic.trim().length < 3 || writing) return;
    Keyboard.dismiss();
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
        ...(key && motion
          ? {
              motion_key: key,
              motion_rights_confirmed: true,
              audio,
              motion_start_s: clampStart(motion.startS, motion.seconds, duration),
            }
          : {}),
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

  // Salvar ou compartilhar um vídeo pronto; um por vez, porque cada um baixa o MP4.
  const runVideoAction = (video: CreatorVideo, kind: 'save' | 'share') =>
    run(video, kind, `${creator?.name ?? 'Video'} · ${video.duration_s}s`);

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
      {/* O recuo do tamanho do teclado mantém o fim da lista alcançável; a barra de pagamento sai de cena enquanto se digita. */}
      <View style={{ flex: 1, paddingBottom: keyboard.height }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE + (keyboard.visible ? 0 : insets.bottom) }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {creator?.image_url ? (
          <View style={styles.heroTall}>
            <Image source={{ uri: creator.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={{ top: '12%' }} transition={200} />
            {/* Fade suave do pé da foto: o nome e a voz ficam legíveis sem uma faixa dura cortando a imagem. */}
            <Svg style={styles.heroFade} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
              <Defs>
                <LinearGradient id="heroFade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#1a1714" stopOpacity="0" />
                  <Stop offset="1" stopColor="#1a1714" stopOpacity="0.82" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroFade)" />
            </Svg>
            <View style={styles.heroActions}>
              <PressableScale onPress={() => setEditing(true)} scaleTo={0.88} style={styles.heroBtn} accessibilityRole="button" accessibilityLabel="Edit character">
                <IconEdit size={18} color={colors.ink} />
              </PressableScale>
              {/* A capa recorta a foto; este botão abre ela inteira. */}
              <ExpandButton onPress={() => setViewingPhoto(true)} />
            </View>
            {router.canGoBack() ? (
              <Pressable onPress={() => router.back()} style={styles.heroBack} accessibilityRole="button" accessibilityLabel="Back">
                <IconChevronLeft size={20} sw={2.2} color={colors.ink} />
              </Pressable>
            ) : null}
            <View style={styles.heroFoot}>
              <Text style={styles.heroName} numberOfLines={1}>
                {creator.name}
              </Text>
              {catalog?.voices.find((v) => v.id === creator.voice_id) ? (
                <View style={styles.heroVoice}>
                  <IconMic size={12} color={colors.onMedia} />
                  <Text style={styles.heroVoiceText}>Voice: {catalog.voices.find((v) => v.id === creator.voice_id)?.name}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : (
          <View>
            {router.canGoBack() ? (
              <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
                <IconChevronLeft size={20} sw={2.2} color={colors.ink} />
              </Pressable>
            ) : null}
            <PageHeading title={creator?.name ?? 'Character'} subtitle="Choose what it does, then pay to make the video." />
          </View>
        )}

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
            <MotionPicker
              motion={motion}
              windowS={moves ? duration : 0}
              onPick={pickMotion}
              onStart={pickStart}
              hint={
                swap
                  ? 'The person you want to replace should be clearly in view.'
                  : 'One person, full body, staying in place, steady camera.'
              }
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
            windowS={duration}
            rights={motionRights}
            motionKey={motionKey}
            onMotionKey={setMotionKey}
            preview={preview}
            onPreview={setPreview}
            onError={fail}
          />
        ) : null}

        {narrated ? (
          <SectionCard
            icon={<IconFileText size={20} color={colors.ink} />}
            title={moves ? 'What your character says' : 'Script'}
            action={
              <View style={styles.countPill}>
                <IconFileText size={13} color={colors.ink3} />
                <Text style={styles.countText}>
                  {words > 0 ? `${words} of ${limit}` : limit} words · {duration}s
                </Text>
              </View>
            }
          >
            <View style={styles.topicBox}>
              <IconSpark size={16} color={colors.accent} />
              <TextInput
                value={topic}
                onChangeText={setTopic}
                placeholder="Give a topic and Xiaolee writes it"
                placeholderTextColor={colors.ink3}
                maxLength={500}
                returnKeyType="send"
                submitBehavior="blurAndSubmit"
                onSubmitEditing={writeForMe}
                autoCapitalize="sentences"
                style={styles.topicInput}
              />
              <Pressable
                onPress={writeForMe}
                disabled={writing || topic.trim().length < 3}
                style={[styles.sendCircle, (writing || topic.trim().length < 3) && styles.disabled]}
                accessibilityRole="button"
                accessibilityLabel="Write the script for me"
              >
                {writing ? <ActivityIndicator color={colors.onAccent} /> : <IconArrowRight size={18} sw={2.2} color={colors.onAccent} />}
              </Pressable>
            </View>
            <View style={styles.ideaBox}>
              <IconLightbulb size={18} color={colors.ink3} />
              <TextInput
                value={script}
                onChangeText={setScript}
                placeholder="Or write what your character says"
                placeholderTextColor={colors.ink3}
                multiline
                maxLength={2000}
                style={styles.ideaInput}
              />
              {script ? null : <IconChevronRight size={16} color={colors.ink3} />}
            </View>
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

        {videos.length > 0 ? (
          <SectionCard title="Videos" subtitle={`${videos.length}`}>
            {videos.map((v) => (
              <View key={v.id} style={styles.row}>
                <Pressable
                  onPress={() => v.video_url && setPlaying(v)}
                  disabled={!v.video_url}
                  style={[styles.rowBody, styles.rowTop]}
                  accessibilityRole="button"
                  accessibilityLabel={v.video_url ? `Play video, ${v.duration_s} seconds` : videoStatusLabel(v.status)}
                >
                  <View style={styles.rowBody}>
                    <View style={styles.rowTop}>
                      {v.status === 'done' ? <IconCheck size={14} color={colors.accent} /> : null}
                      <Text style={styles.provider}>{videoStatusLabel(v.status)}</Text>
                    </View>
                    {v.status === 'failed' && v.error ? <Text style={styles.error}>{v.error}</Text> : null}
                    <Text style={styles.desc} numberOfLines={2}>
                      {v.script || { mimic: 'Mimic', swap: 'Replace' }[catalog?.qualities.find((q) => q.quality === v.quality)?.kind as string] || ''}
                    </Text>
                    <Text style={styles.desc}>
                      {v.duration_s}s · ${v.price_usdc.toFixed(2)}{v.payment_tx ? ` · ${shortHash(v.payment_tx)}` : ''}
                      {v.refund_due ? ' · refund pending' : ''}
                    </Text>
                  </View>
                  {isVideoPending(v.status) ? <ActivityIndicator color={colors.accent} /> : null}
                  {v.video_url ? <IconPlay size={20} color={colors.accent} /> : null}
                </Pressable>
                {v.video_url ? (
                  <View style={styles.rowTop}>
                    {canSaveClips ? (
                      <VideoAction
                        Icon={savedIds.has(v.id) ? IconCheck : IconDownload}
                        label={savedIds.has(v.id) ? 'Video saved to your gallery' : 'Save video to your gallery'}
                        busy={action?.id === v.id && action.kind === 'save'}
                        disabled={action !== null || savedIds.has(v.id)}
                        onPress={() => runVideoAction(v, 'save')}
                      />
                    ) : null}
                    {canShareClips ? (
                      <VideoAction
                        Icon={IconSend}
                        label="Share video"
                        busy={action?.id === v.id && action.kind === 'share'}
                        disabled={action !== null}
                        onPress={() => runVideoAction(v, 'share')}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            ))}
          </SectionCard>
        ) : null}
      </ScrollView>

      {keyboard.visible ? null : (
      <View style={styles.payBar}>
        {confirming ? (
          <>
            <View style={styles.payInfo}>
              <Text style={styles.payTitle}>Pay ${price?.toFixed(2)} in USDC?</Text>
              <Text style={styles.payHint} numberOfLines={2}>
                Paid from your wallet. We start as soon as it goes through.
              </Text>
            </View>
            <Pressable onPress={() => setConfirming(false)} disabled={paying} style={styles.payCancel} accessibilityRole="button">
              <Text style={styles.payCancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={pay} disabled={paying} style={styles.payBtn} accessibilityRole="button">
              {paying ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.payBtnText}>Confirm &amp; pay</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.payInfo}>
              <Text style={styles.payMeta}>
                {qualities.find((q) => q.quality === quality)?.label ?? 'Standard'} · {duration}s
              </Text>
              <Text style={styles.payPrice}>{price !== null ? `$${price.toFixed(2)}` : '–'}</Text>
              <Text style={styles.payHint} numberOfLines={1}>
                {canPay ? 'Paid in USDC from your wallet' : blocker}
              </Text>
            </View>
            <Pressable
              onPress={() => setConfirming(true)}
              disabled={!canPay}
              style={[styles.payBtn, !canPay && styles.payBtnOff]}
              accessibilityRole="button"
              accessibilityLabel={`Create video${price !== null ? `, ${price.toFixed(2)} USDC` : ''}`}
            >
              <IconSpark size={18} color={colors.onAccent} />
              <Text style={styles.payBtnText}>Create video</Text>
            </Pressable>
          </>
        )}
      </View>
      )}
      </View>

      {editing && creator ? (
        <CreatorEditSheet
          creator={creator}
          voices={catalog?.voices ?? []}
          onSave={async (patch) => {
            setCreator(await updateCreator(creator.id, patch));
          }}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {viewingPhoto && creator?.image_url ? <PhotoViewer uri={creator.image_url} onClose={() => setViewingPhoto(false)} /> : null}

      {/* A mesma tela de preview dos cortes do Clipper: play/pause, barra de tempo, Salvar e Compartilhar. */}
      <VideoPlayerModal
        video={playing?.video_url ? { title: creator?.name ?? 'Video', url: playing.video_url, durationS: playing.duration_s } : null}
        onClose={() => setPlaying(null)}
        onSave={playing && canSaveClips ? () => runVideoAction(playing, 'save') : undefined}
        onShare={playing && canShareClips ? () => runVideoAction(playing, 'share') : undefined}
        busy={action && action.id === playing?.id ? action.kind : null}
        saved={playing ? savedIds.has(playing.id) : false}
        actionsDisabled={action !== null}
      />
    </ScreenShell>
  );
}
