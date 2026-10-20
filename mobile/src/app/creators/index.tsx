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
import { IconChevronRight, IconPlus, IconUser } from '@/components/icons';
import { PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { useCreatorStyles as useStyles } from '@/components/creator-styles';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import { createPersona, pickReferenceImage, type PickedImage } from '@/lib/creators';

/** O botão flutuante do Chat cobre o fim da lista: a folga extra deixa o botão de pagar à vista. */
const CHAT_FAB_CLEARANCE = 72;

/**
 * Criadores sintéticos — personas originais (foto de referência + voz pronta)
 * que falam o roteiro do creator em vídeo vertical. Cada vídeo é pago em USDC
 * na tela da persona (`creators/[id]`), antes de qualquer geração.
 */
export default function CreatorsScreen() {
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
    if (!name.trim() || !voiceId || !image || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createPersona(name, voiceId, image);
      setCreators((list) => [created, ...(list ?? [])]);
      setCreating(false);
      setName('');
      setVoiceId(null);
      setImage(null);
      router.push({ pathname: '/creators/[id]', params: { id: String(created.id) } });
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  }

  const voiceName = (id: string) => catalog?.voices.find((v) => v.id === id)?.name ?? '';
  const canSave = Boolean(name.trim() && voiceId && image) && !saving;

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + CHAT_FAB_CLEARANCE + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <PageHeading title="AI Creators" subtitle="Original personas that say your script on video. Paid in USDC, per video." />

        {!hasSession ? (
          <EmptyState
            Icon={IconUser}
            title="Sign in to create personas"
            text="Personas and videos are tied to your account."
            action={<ConnectWalletButton label="Connect Wallet" />}
          />
        ) : (
          <>
            {catalog && !catalog.enabled ? (
              <Text style={styles.note}>AI Creators are not available right now.</Text>
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
                  <Text style={styles.btnText}>New persona</Text>
                </View>
              </Pressable>
            ) : (
              <SectionCard title="New persona" subtitle="Use an original face — no real people or celebrities.">
                <Pressable onPress={pick} style={styles.photoPick} accessibilityRole="button" accessibilityLabel="Choose reference photo">
                  {image ? (
                    <Image source={{ uri: image.uri }} style={styles.photo} contentFit="cover" />
                  ) : (
                    <Text style={styles.desc}>Choose a reference photo (vertical, face visible)</Text>
                  )}
                </Pressable>

                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Persona name"
                  placeholderTextColor={colors.ink3}
                  maxLength={60}
                  style={styles.input}
                />

                <Text style={styles.label}>Voice</Text>
                <View style={styles.chips}>
                  {catalog?.voices.map((v) => (
                    <Pressable
                      key={v.id}
                      onPress={() => setVoiceId(v.id)}
                      style={[styles.chip, voiceId === v.id && styles.chipActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: voiceId === v.id }}
                    >
                      <Text style={[styles.chipText, voiceId === v.id && styles.chipTextActive]}>
                        {v.name} · {v.gender === 'female' ? 'F' : 'M'}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable
                  onPress={save}
                  disabled={!canSave}
                  style={[styles.primary, !canSave && styles.disabled]}
                  accessibilityRole="button"
                >
                  {saving ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.btnText}>Create persona</Text>}
                </Pressable>
                <Pressable onPress={() => setCreating(false)} disabled={saving} accessibilityRole="button">
                  <Text style={styles.cancel}>Cancel</Text>
                </Pressable>
              </SectionCard>
            )}

            {creators === null ? (
              <ActivityIndicator color={colors.accent} />
            ) : creators.length === 0 ? (
              <EmptyState Icon={IconUser} title="No personas yet" text="Create one with a photo and a voice." />
            ) : (
              <SectionCard title="Your personas" subtitle={`${creators.length}`}>
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
      </ScrollView>
    </ScreenShell>
  );
}
