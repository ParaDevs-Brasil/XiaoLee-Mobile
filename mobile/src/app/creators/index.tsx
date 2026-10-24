import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getCreatorCatalog,
  listCreators,
  type CreatorCatalog,
  type SyntheticCreator,
} from '@/api/backend';
import { ApiError } from '@/api/client';
import { ConnectWalletButton, EmptyState } from '@/components/feedback';
import { IconCheck, IconChevronLeft, IconChevronRight, IconMic, IconPlay, IconPlus, IconShield, IconUser } from '@/components/icons';
import { FAB_CLEARANCE, PageHeading, ScreenShell } from '@/components/screen-shell';
import { CreatorVideosSection } from '@/components/creator-videos-section';
import { useCreatorStyles as useStyles } from '@/components/creator-styles';
import { UploadTile } from '@/components/upload-tile';
import { VoiceSheet } from '@/components/voice-sheet';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { createPersona, pickReferenceImage, type PickedImage } from '@/lib/creators';

/**
 * Criadores sintéticos — personas originais (foto de referência + voz pronta)
 * que falam o roteiro do creator em vídeo vertical. Cada vídeo é pago em USDC
 * na tela da persona (`creators/[id]`), antes de qualquer geração.
 */
export default function CreatorsScreen() {
  return <CreatorsView />;
}

/** O corpo da tela de AI Creators; `embedded` o encaixa dentro de outra tela (o Studio), sem moldura, rolagem nem título. */
export function CreatorsView({ embedded = false }: { embedded?: boolean }) {
  const colors = useTheme();
  const styles = useStyles();
  const grid = useGridStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { hasSession } = useSession();

  const [catalog, setCatalog] = useState<CreatorCatalog | null>(null);
  const [creators, setCreators] = useState<SyntheticCreator[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [image, setImage] = useState<PickedImage | null>(null);
  const [rights, setRights] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const fail = (e: unknown) =>
    setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Try again.');

  useFocusEffect(
    useCallback(() => {
      if (!hasSession) return;
      Promise.all([getCreatorCatalog(), listCreators()])
        .then(([cat, list]) => {
          setCatalog(cat);
          setCreators(list);
        })
        .catch(fail);
    }, [hasSession]),
  );

  async function pick() {
    try {
      const picked = await pickReferenceImage();
      if (picked) setImage(picked);
    } catch (e) {
      fail(e);
    }
  }

  async function save() {
    if (!name.trim() || !voiceId || !image || !rights || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createPersona(name, voiceId, image);
      setCreators((list) => [created, ...(list ?? [])]);
      setCreating(false);
      setName('');
      setVoiceId(null);
      setImage(null);
      setRights(false);
      router.push({ pathname: '/creators/[id]', params: { id: String(created.id) } });
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  }

  const voiceName = (id: string) => catalog?.voices.find((v) => v.id === id)?.name ?? '';
  const canSave = Boolean(name.trim() && voiceId && image && rights) && !saving;

  const body = (
      <>
        {embedded ? null : (
          <PageHeading title="AI Creators" subtitle="Make videos with your own characters. You pay per video, in USDC." />
        )}

        {!hasSession ? (
          <EmptyState
            Icon={IconUser}
            title="Sign in to make videos"
            text="Your characters and videos are saved to your account."
            action={<ConnectWalletButton label="Connect Wallet" />}
          />
        ) : (
          <>
            {catalog && !catalog.enabled ? (
              <Text style={styles.note}>AI Creators aren’t available right now.</Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {creating || !creators?.length ? null : <CreatorVideosSection creators={creators} />}

            {creating ? (
              <>
                <View style={grid.formHead}>
                  <Pressable
                    onPress={() => setCreating(false)}
                    disabled={saving}
                    style={grid.back}
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                  >
                    <IconChevronLeft size={20} sw={2.2} color={colors.ink} />
                  </Pressable>
                  <View style={styles.rowBody}>
                    <Text style={grid.title}>New character</Text>
                    <Text style={grid.sub}>Add a photo, a name and a voice</Text>
                  </View>
                </View>

                <UploadTile
                  title="Add a photo"
                  hint="Vertical and full body works best."
                  onPress={pick}
                  previewUri={image?.uri}
                  changeLabel="Change photo"
                  height={image ? 440 : 190}
                  accessibilityLabel="Add a photo of your character"
                />

                <View style={grid.field}>
                  <Text style={grid.label}>Name</Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Character name"
                    placeholderTextColor={colors.ink3}
                    maxLength={60}
                    style={grid.input}
                  />
                </View>

                <View style={grid.field}>
                  <Text style={grid.label}>Voice for talking videos</Text>
                  <Pressable
                    onPress={() => setVoiceOpen(true)}
                    style={({ pressed }) => [grid.voiceRow, pressed && grid.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={voiceId ? `Voice: ${voiceName(voiceId)}. Change` : 'Choose a voice'}
                  >
                    <View style={grid.voiceIcon}>
                      <IconMic size={20} sw={2} color={colors.accent} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={grid.voiceTitle}>{voiceId ? voiceName(voiceId) : 'Choose a voice'}</Text>
                      <Text style={grid.voiceSub} numberOfLines={1}>
                        {voiceId
                          ? (catalog?.voices.find((v) => v.id === voiceId)?.description ?? '')
                          : 'Brazilian, narrators, villains and more'}
                      </Text>
                    </View>
                    <IconChevronRight size={18} sw={2.2} color={colors.ink3} />
                  </Pressable>
                </View>

                <View style={grid.rules}>
                  <View style={grid.ruleRow}>
                    <IconShield size={18} color={colors.ink2} />
                    <Text style={[grid.ruleText, styles.rowBody]}>No sexual content, no minors, and no pretending to be someone else.</Text>
                  </View>
                  <View style={grid.divider} />
                  <Pressable
                    onPress={() => setRights((v) => !v)}
                    style={grid.ruleRow}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: rights }}
                  >
                    <View style={[styles.checkbox, rights && styles.chipActive]}>
                      {rights ? <IconCheck size={14} sw={3} color={colors.onAccent} /> : null}
                    </View>
                    <Text style={[grid.rightsText, styles.rowBody]}>
                      This image is mine, or it&apos;s fan art or parody. I won&apos;t use it to deceive or harass anyone.
                    </Text>
                  </Pressable>
                </View>

                <Pressable
                  onPress={save}
                  disabled={!canSave}
                  style={({ pressed }) => [grid.firstBtn, !canSave && styles.disabled, pressed && grid.pressed]}
                  accessibilityRole="button"
                >
                  {saving ? <ActivityIndicator color={colors.onAccent} /> : <Text style={grid.firstBtnText}>Create character</Text>}
                </Pressable>
                <Text style={[grid.firstHint, grid.center]}>You pay per video, in USDC.</Text>
              </>
            ) : null}

            {creators === null ? (
              <ActivityIndicator color={colors.accent} />
            ) : creators.length === 0 && !creating ? (
              <View style={grid.firstCard}>
                <View style={grid.stack} accessible={false} importantForAccessibility="no-hide-descendants">
                  <View style={[grid.ghost, { transform: [{ rotate: '-6deg' }], left: 12 }]} />
                  <View style={[grid.ghost, { transform: [{ rotate: '6deg' }], right: 12 }]} />
                  <View style={grid.frontCard}>
                    <IconUser size={44} sw={1.6} color={colors.onAccent} />
                    <View style={grid.addDot}>
                      <IconPlus size={14} sw={2.6} color={colors.onMedia} />
                    </View>
                  </View>
                </View>
                <Text style={grid.firstTitle}>Create your first character</Text>
                <Text style={grid.firstText}>Add a photo, pick a voice, and turn any script into a talking video.</Text>
                <View style={grid.steps}>
                  {['Photo', 'Voice', 'Video'].map((label, i) => (
                    <View key={label} style={grid.stepRow}>
                      {i > 0 ? <IconChevronRight size={14} sw={2.2} color={colors.ink3} /> : null}
                      <View style={grid.step}>
                        <View style={grid.stepNum}>
                          <Text style={grid.stepNumText}>{i + 1}</Text>
                        </View>
                        <Text style={grid.stepText}>{label}</Text>
                      </View>
                    </View>
                  ))}
                </View>
                <Pressable
                  onPress={() => setCreating(true)}
                  disabled={!catalog?.enabled}
                  style={({ pressed }) => [grid.firstBtn, !catalog?.enabled && styles.disabled, pressed && grid.pressed]}
                  accessibilityRole="button"
                >
                  <IconPlus size={18} sw={2.4} color={colors.onAccent} />
                  <Text style={grid.firstBtnText}>New character</Text>
                </Pressable>
                <Text style={grid.firstHint}>You pay per video, in USDC.</Text>
              </View>
            ) : creators.length > 0 ? (
              <>
                <View style={grid.head}>
                  <View style={styles.rowBody}>
                    <Text style={grid.title}>Your characters</Text>
                    <Text style={grid.sub}>You pay per video, in USDC.</Text>
                  </View>
                  {creating ? null : (
                    <Pressable
                      onPress={() => setCreating(true)}
                      disabled={!catalog?.enabled}
                      style={({ pressed }) => [grid.newBtn, !catalog?.enabled && styles.disabled, pressed && grid.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="New character"
                    >
                      <IconPlus size={16} sw={2.4} color={colors.onAccent} />
                      <Text style={grid.newText}>New</Text>
                    </Pressable>
                  )}
                </View>
                <View style={grid.wrap}>
                  {creators.map((c) => {
                    const open = () => router.push({ pathname: '/creators/[id]', params: { id: String(c.id) } });
                    return (
                      <View key={c.id} style={grid.card}>
                        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={c.name}>
                          <View style={grid.photo}>
                            {c.image_url ? <Image source={{ uri: c.image_url }} style={grid.photoImg} contentFit="cover" /> : null}
                            <View style={grid.voicePill}>
                              <IconMic size={12} color={colors.onMedia} />
                              <Text style={grid.voicePillText} numberOfLines={1}>
                                {voiceName(c.voice_id) || 'Voice'}
                              </Text>
                            </View>
                          </View>
                          <Text style={grid.name} numberOfLines={1}>
                            {c.name}
                          </Text>
                          <Text style={grid.voice} numberOfLines={1}>
                            Voice: {voiceName(c.voice_id)}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={open}
                          style={({ pressed }) => [grid.make, pressed && grid.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`Make a video with ${c.name}`}
                        >
                          <IconPlay size={12} sw={2.4} color={colors.accent} />
                          <Text style={grid.makeText}>Make a video</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                  {creating ? null : (
                    <Pressable
                      onPress={() => setCreating(true)}
                      disabled={!catalog?.enabled}
                      style={({ pressed }) => [grid.empty, !catalog?.enabled && styles.disabled, pressed && grid.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="New character"
                    >
                      <View style={grid.plus}>
                        <IconPlus size={24} sw={2.2} color={colors.onAccent} />
                      </View>
                      <Text style={grid.emptyText}>New character</Text>
                    </Pressable>
                  )}
                </View>
              </>
            ) : null}
          </>
        )}
        {voiceOpen ? (
          <VoiceSheet voices={catalog?.voices ?? []} value={voiceId} onConfirm={setVoiceId} onClose={() => setVoiceOpen(false)} />
        ) : null}
      </>
  );

  if (embedded) {
    return (
      <>
        <View style={styles.embedded}>{body}</View>
        
      </>
    );
  }

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
    </ScreenShell>
  );
}

const useGridStyles = makeStyles((colors) => ({
  pressed: { opacity: 0.8 },
  center: { textAlign: 'center' },
  formHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: { gap: 8 },
  label: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink2 },
  input: {
    height: 52,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: Fonts.medium,
    fontSize: 15,
    color: colors.ink,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  voiceIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  voiceTitle: { fontFamily: Fonts.bold, fontSize: 15, lineHeight: 20, color: colors.ink },
  voiceSub: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 16, color: colors.ink2 },
  rules: {
    gap: 12,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  ruleText: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 19, color: colors.ink2 },
  rightsText: { fontFamily: Fonts.semibold, fontSize: 13, lineHeight: 19, color: colors.ink },
  divider: { height: 1, backgroundColor: colors.border },
  firstCard: {
    alignItems: 'center',
    gap: Spacing.three - 2,
    padding: 24,
    borderRadius: Radius.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stack: { width: 160, height: 140, alignItems: 'center' },
  ghost: {
    position: 'absolute',
    top: 14,
    width: 84,
    height: 112,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  frontCard: {
    width: 88,
    height: 120,
    marginTop: 4,
    borderRadius: Radius.lg,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addDot: {
    position: 'absolute',
    right: -8,
    bottom: -8,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    borderColor: colors.card,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  firstTitle: { fontFamily: Fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink, textAlign: 'center' },
  firstText: { fontFamily: Fonts.medium, fontSize: 14, lineHeight: 21, color: colors.ink2, textAlign: 'center' },
  steps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 6,
    paddingRight: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: colors.bg,
  },
  stepNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.accentFill, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontFamily: Fonts.bold, fontSize: 11, color: colors.onAccent },
  stepText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink },
  firstBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    alignSelf: 'stretch',
    height: 52,
    borderRadius: Radius.lg,
    backgroundColor: colors.accentFill,
  },
  firstBtnText: { fontFamily: Fonts.bold, fontSize: 15, color: colors.onAccent },
  firstHint: { fontFamily: Fonts.medium, fontSize: 12, color: colors.ink2 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  title: { fontFamily: Fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink },
  sub: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 16, color: colors.ink2 },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
  },
  newText: { fontFamily: Fonts.bold, fontSize: 14, color: colors.onAccent },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '47.8%',
    gap: 6,
    padding: 8,
    paddingBottom: 12,
    borderRadius: Radius.xl - 4,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photo: { aspectRatio: 0.82, borderRadius: Radius.lg, backgroundColor: colors.media, overflow: 'hidden', justifyContent: 'flex-end' },
  photoImg: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  voicePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    margin: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(26, 25, 23, 0.72)',
  },
  voicePillText: { fontFamily: Fonts.bold, fontSize: 12, color: colors.onMedia, maxWidth: 90 },
  name: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 22, color: colors.ink, marginTop: 6, paddingHorizontal: 4 },
  voice: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 16, color: colors.ink2, paddingHorizontal: 4 },
  make: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    marginTop: 4,
    borderRadius: Radius.md,
    backgroundColor: colors.accentSoft,
  },
  makeText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.accent },
  empty: {
    width: '47.8%',
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderRadius: Radius.xl - 4,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  plus: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accentFill, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: Fonts.bold, fontSize: 14, color: colors.accent },
}));
