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
import { IconCheck, IconChevronRight, IconPlus, IconUser } from '@/components/icons';
import { FAB_CLEARANCE, PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { useCreatorStyles as useStyles } from '@/components/creator-styles';
import { UploadTile } from '@/components/upload-tile';
import { VoicePicker } from '@/components/voice-picker';
import { useTheme } from '@/hooks/use-theme';
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

            {!creating ? (
              <Pressable
                onPress={() => setCreating(true)}
                disabled={!catalog?.enabled}
                style={[styles.primary, !catalog?.enabled && styles.disabled]}
                accessibilityRole="button"
              >
                <View style={styles.rowTop}>
                  <IconPlus size={16} color={colors.onAccent} />
                  <Text style={styles.btnText}>New character</Text>
                </View>
              </Pressable>
            ) : (
              <SectionCard title="New character" subtitle="Use your own photo or a character. No sexual content, no minors, and no pretending to be someone else.">
                <UploadTile
                  title="Add a photo"
                  hint="Vertical and full body works best."
                  onPress={pick}
                  previewUri={image?.uri}
                  changeLabel="Change photo"
                  height={image ? 320 : 190}
                  accessibilityLabel="Add a photo of your character"
                />

                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Character name"
                  placeholderTextColor={colors.ink3}
                  maxLength={60}
                  style={styles.input}
                />

                <Text style={styles.label}>Voice for talking videos</Text>
                <VoicePicker voices={catalog?.voices ?? []} value={voiceId} onChange={setVoiceId} />

                <Pressable
                  onPress={() => setRights((v) => !v)}
                  style={styles.rowTop}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: rights }}
                >
                  <View style={[styles.checkbox, rights && styles.chipActive]}>
                    {rights ? <IconCheck size={14} color={colors.onAccent} /> : null}
                  </View>
                  <Text style={[styles.desc, { flex: 1 }]}>
                    This image is mine, or it&apos;s fan art or parody. I won&apos;t use it to deceive or harass anyone.
                  </Text>
                </Pressable>

                <Pressable
                  onPress={save}
                  disabled={!canSave}
                  style={[styles.primary, !canSave && styles.disabled]}
                  accessibilityRole="button"
                >
                  {saving ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.btnText}>Create character</Text>}
                </Pressable>
                <Pressable onPress={() => setCreating(false)} disabled={saving} accessibilityRole="button">
                  <Text style={styles.cancel}>Cancel</Text>
                </Pressable>
              </SectionCard>
            )}

            {creators === null ? (
              <ActivityIndicator color={colors.accent} />
            ) : creators.length === 0 ? (
              <EmptyState Icon={IconUser} title="No characters yet" text="Add a photo and pick a voice to make your first one." />
            ) : (
              <SectionCard title="Your characters" subtitle={`${creators.length}`}>
                {creators.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => router.push({ pathname: '/creators/[id]', params: { id: String(c.id) } })}
                    style={styles.row}
                    accessibilityRole="button"
                    accessibilityLabel={c.name}
                  >
                    {c.image_url ? (
                      <Image source={{ uri: c.image_url }} style={styles.thumb} contentFit="cover" />
                    ) : (
                      <View style={styles.thumb} />
                    )}
                    <View style={styles.rowBody}>
                      <Text style={styles.provider}>{c.name}</Text>
                      <Text style={styles.desc}>Voice: {voiceName(c.voice_id)}</Text>
                    </View>
                    <IconChevronRight size={18} color={colors.ink3} />
                  </Pressable>
                ))}
              </SectionCard>
            )}
          </>
        )}
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
