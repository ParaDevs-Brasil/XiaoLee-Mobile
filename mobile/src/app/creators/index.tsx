import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getCreatorCatalog,
  listCreators,
  type CreatorCatalog,
  type SyntheticCreator,
} from '@/api/backend';
import { ApiError } from '@/api/client';
import { ConnectWalletButton, EmptyState } from '@/components/feedback';
import { IconMessageDots, IconMic, IconPlay, IconPlus, IconSwap, IconUser } from '@/components/icons';
import { FAB_CLEARANCE, PageHeading, ScreenShell } from '@/components/screen-shell';
import { CreatorVideosSection } from '@/components/creator-videos-section';
import { useCreatorStyles as useStyles } from '@/components/creator-styles';
import { useGridStyles } from '@/components/creator-grid-styles';
import { NewCharacterForm } from '@/components/new-character-form';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';

/**
 * Criadores sintéticos. A porta de entrada é o que a pessoa quer fazer (falar, imitar, trocar) e não "criar um
 * personagem": os três cards abrem "quem aparece no vídeo", onde se escolhe ou cria quem entra. Os personagens ficam
 * numa biblioteca logo abaixo. Cada vídeo é pago em USDC na tela do vídeo (`creators/[id]`), antes de qualquer geração.
 */
export default function CreatorsScreen() {
  return <CreatorsView />;
}

const MAKE: { format: 'speech' | 'mimic' | 'swap'; title: string; text: string; Icon: typeof IconPlay }[] = [
  { format: 'speech', title: 'Talk', text: 'Your character says what you write', Icon: IconMessageDots },
  { format: 'mimic', title: 'Mimic', text: 'Your character copies the video’s moves', Icon: IconPlay },
  { format: 'swap', title: 'Replace', text: 'Same video, but with your characters', Icon: IconSwap },
];

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

  const voiceName = (id: string) => catalog?.voices.find((v) => v.id === id)?.name ?? '';

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

            {creating || !catalog?.enabled ? null : (
              <View style={grid.makeRow}>
                {MAKE.map(({ format, title, text, Icon }) => (
                  <Pressable
                    key={format}
                    onPress={() => router.push({ pathname: '/creators/new-video', params: { format } })}
                    style={({ pressed }) => [grid.makeCard, pressed && grid.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`${title}: ${text}`}
                  >
                    <View style={grid.makeIcon}>
                      <Icon size={20} sw={2.2} color={colors.onAccent} />
                    </View>
                    <Text style={grid.makeTitle}>{title}</Text>
                    <Text style={grid.makeText2} numberOfLines={3}>{text}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {creating || !creators?.length ? null : <CreatorVideosSection creators={creators} />}

            {creating ? (
              <NewCharacterForm
                catalog={catalog}
                onCancel={() => setCreating(false)}
                onError={fail}
                onCreated={(created) => {
                  setCreators((list) => [created, ...(list ?? [])]);
                  setCreating(false);
                  router.push({ pathname: '/creators/[id]', params: { id: String(created.id) } });
                }}
              />
            ) : null}

            {creators === null ? (
              <ActivityIndicator color={colors.accent} />
            ) : !creating ? (
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
