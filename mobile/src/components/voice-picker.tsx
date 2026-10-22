import { useVideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { CreatorVoice } from '@/api/backend';
import { IconClose, IconPlay } from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { API_URL } from '@/lib/config';

/**
 * Escolha de voz, simples: uma fileira de nomes. Tocar num nome escolhe a voz E já toca uma amostra, para a pessoa
 * decidir com o ouvido; embaixo, uma linha com a descrição e o botão de ouvir de novo. Um único player (do
 * `expo-video`, que toca áudio também) serve todas as vozes.
 */
export function VoicePicker({
  voices,
  value,
  onChange,
}: {
  voices: CreatorVoice[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const player = useVideoPlayer(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const selected = voices.find((v) => v.id === value) ?? null;

  useEffect(() => {
    const sub = player.addListener('playToEnd', () => setPlaying(null));
    return () => sub.remove();
  }, [player]);

  function play(v: CreatorVoice) {
    player.replace(`${API_URL}${v.sample_path}`);
    player.play();
    setPlaying(v.id);
  }

  function choose(v: CreatorVoice) {
    onChange(v.id);
    play(v);
  }

  function toggle(v: CreatorVoice) {
    if (playing === v.id) {
      player.pause();
      setPlaying(null);
    } else {
      play(v);
    }
  }

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        {voices.map((v) => {
          const on = v.id === value;
          return (
            <Pressable
              key={v.id}
              onPress={() => choose(v)}
              style={({ pressed }) => [styles.pill, on && styles.pillOn, pressed && styles.pressed]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${v.name}, ${v.description}`}
            >
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{v.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.detail}>
        {selected ? (
          <>
            <Pressable
              onPress={() => toggle(selected)}
              style={styles.play}
              accessibilityRole="button"
              accessibilityLabel={playing === selected.id ? `Stop ${selected.name}` : `Listen to ${selected.name}`}
            >
              {playing === selected.id ? <IconClose size={18} color={colors.onAccent} /> : <IconPlay size={18} color={colors.onAccent} />}
            </Pressable>
            <View style={styles.text}>
              <Text style={styles.name}>
                {selected.name} <Text style={styles.gender}>· {selected.gender === 'female' ? 'Female' : 'Male'}</Text>
              </Text>
              <Text style={styles.desc}>{selected.description}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.desc}>Tap a name to hear the voice.</Text>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { gap: Spacing.three - 4 },
  pills: { gap: Spacing.two, paddingRight: Spacing.three },
  pill: {
    paddingHorizontal: Spacing.three,
    height: 38,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  pillOn: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  pressed: { opacity: 0.8 },
  pillText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink },
  pillTextOn: { color: colors.onAccent },
  detail: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4, minHeight: 48 },
  play: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentFill,
  },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: Fonts.bold, fontSize: 14, color: colors.ink },
  gender: { fontFamily: Fonts.medium, fontSize: 12, color: colors.ink3 },
  desc: { fontFamily: Fonts.sans, fontSize: 13, color: colors.ink2 },
}));
