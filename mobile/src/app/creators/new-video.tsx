import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getCreatorCatalog, listCreators, type CreatorCatalog, type SyntheticCreator } from '@/api/backend';
import { ApiError } from '@/api/client';
import { useGridStyles } from '@/components/creator-grid-styles';
import { useCreatorStyles as useStyles } from '@/components/creator-styles';
import { NewCharacterForm } from '@/components/new-character-form';
import { IconChevronLeft, IconMic, IconPlus, IconSpark } from '@/components/icons';
import { FAB_CLEARANCE, PageHeading, ScreenShell } from '@/components/screen-shell';
import { useTheme } from '@/hooks/use-theme';
import { MAX_CHARACTERS } from '@/lib/creators-core';

type Format = 'speech' | 'mimic' | 'swap';

const COPY: Record<Format, { title: string; subtitle: string }> = {
  speech: { title: 'Who is talking?', subtitle: 'Pick the character that says your script.' },
  mimic: {
    title: 'Who is in your video?',
    subtitle: 'Pick who copies the moves. For a video with more people, pick one character per person, in the order they appear from left to right.',
  },
  swap: {
    title: 'Who goes into your video?',
    subtitle: 'Pick one character for each person you want to replace, in the order they appear from left to right.',
  },
};

/**
 * Primeiro passo de um vídeo: quem aparece. Escolhe personagens que já existem ou cria um aqui mesmo, sem sair do
 * fluxo. A ordem dos toques é a ordem das pessoas no vídeo (o número no canto). O resto (vídeo de referência, prévia,
 * faixa, pagamento) é a tela do vídeo, `creators/[id]`, que recebe o 1º personagem e os outros em `with`.
 */
export default function NewVideoScreen() {
  const params = useLocalSearchParams<{ format?: string; pick?: string }>();
  const format: Format = params.format === 'mimic' || params.format === 'swap' ? params.format : 'speech';
  const max = format === 'speech' ? 1 : MAX_CHARACTERS;
  const colors = useTheme();
  const styles = useStyles();
  const grid = useGridStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [catalog, setCatalog] = useState<CreatorCatalog | null>(null);
  const [creators, setCreators] = useState<SyntheticCreator[] | null>(null);
  // `pick`: voltando da tela do vídeo para trocar quem aparece — começa com a escolha de antes.
  const [selected, setSelected] = useState<number[]>(() => (params.pick ?? '').split(',').filter(Boolean).map(Number).slice(0, max));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) =>
    setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Try again.');

  useFocusEffect(
    useCallback(() => {
      Promise.all([getCreatorCatalog(), listCreators()])
        .then(([cat, list]) => {
          setCatalog(cat);
          setCreators(list);
        })
        .catch(fail);
    }, []),
  );

  const toggle = (id: number) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : max === 1 ? [id] : cur.length < max ? [...cur, id] : cur,
    );

  const voiceName = (id: string) => catalog?.voices.find((v) => v.id === id)?.name ?? '';
  const showForm = creating || creators?.length === 0;
  const canContinue = selected.length > 0;
  const copy = COPY[format];

  function next() {
    const [first, ...rest] = selected;
    router.push({ pathname: '/creators/[id]', params: { id: String(first), format, with: rest.join(',') } });
  }

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE + 80 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={grid.formHead}>
          <Pressable onPress={() => router.back()} style={grid.back} accessibilityRole="button" accessibilityLabel="Back">
            <IconChevronLeft size={20} sw={2.2} color={colors.ink} />
          </Pressable>
        </View>
        <PageHeading title={copy.title} subtitle={copy.subtitle} />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {creators === null ? (
          <ActivityIndicator color={colors.accent} />
        ) : showForm ? (
          <>
            <NewCharacterForm
              catalog={catalog}
              person={format !== 'speech'}
              defaultName={`Person ${(creators?.length ?? 0) + 1}`}
              // Sem nenhum personagem não há para onde voltar: a seta só aparece quando a lista existe.
              onCancel={creators.length > 0 ? () => setCreating(false) : undefined}
              onError={fail}
              onCreated={(created) => {
                setCreators((list) => [created, ...(list ?? [])]);
                setSelected((cur) => (max === 1 ? [created.id] : cur.length < max ? [...cur, created.id] : cur));
                setCreating(false);
              }}
            />
          </>
        ) : (
          <View style={grid.wrap}>
            {creators.map((c) => {
              const order = selected.indexOf(c.id) + 1;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => toggle(c.id)}
                  style={[grid.card, order > 0 && grid.tileOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: order > 0 }}
                  accessibilityLabel={order > 0 ? `${c.name}, person ${order}. Tap to remove` : `Add ${c.name}`}
                >
                  <View style={grid.photo}>
                    {c.image_url ? <Image source={{ uri: c.image_url }} style={grid.photoImg} contentFit="cover" /> : null}
                    {order > 0 ? (
                      <View style={grid.badge}>
                        <Text style={grid.badgeText}>{max === 1 ? '✓' : order}</Text>
                      </View>
                    ) : null}
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
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setCreating(true)}
              disabled={!catalog?.enabled}
              style={({ pressed }) => [grid.empty, pressed && grid.pressed]}
              accessibilityRole="button"
              accessibilityLabel={format === 'speech' ? 'New character' : 'Add a person'}
            >
              <View style={grid.plus}>
                <IconPlus size={24} sw={2.2} color={colors.onAccent} />
              </View>
              <Text style={grid.emptyText}>{format === 'speech' ? 'New character' : 'Add a person'}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {showForm ? null : (
        <View style={styles.payBar}>
          <View style={styles.payInfo}>
            <Text style={styles.payMeta}>{selected.length === 0 ? 'Nobody picked yet' : `${selected.length} of ${max} picked`}</Text>
            <Text style={styles.payHint} numberOfLines={1}>
              {format === 'speech' ? 'Next: your script' : 'Next: your video'}
            </Text>
          </View>
          <Pressable
            onPress={next}
            disabled={!canContinue}
            style={[styles.payBtn, !canContinue && styles.payBtnOff]}
            accessibilityRole="button"
          >
            <IconSpark size={18} color={colors.onAccent} />
            <Text style={styles.payBtnText}>Continue</Text>
          </Pressable>
        </View>
      )}
    </ScreenShell>
  );
}
