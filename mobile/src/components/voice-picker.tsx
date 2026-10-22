import { useVideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { CreatorVoice } from '@/api/backend';
import { IconCheck, IconClose, IconPlay } from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';

/**
 * Escolha de voz: cada voz mostra o nome, uma descrição curta e um botão para ouvir uma amostra antes de escolher.
 * Um único player (do `expo-video`, que toca áudio também) serve a lista toda: tocar outra amostra troca a fonte.
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

  useEffect(() => {
    const sub = player.addListener('playToEnd', () => setPlaying(null));
    return () => sub.remove();
  }, [player]);

  function toggle(v: CreatorVoice) {
    if (!v.preview_url) return;
    if (playing === v.id) {
      player.pause();
      setPlaying(null);
      return;
    }
    player.replace(v.preview_url);
    player.play();
    setPlaying(v.id);
  }

  return (
    <View style={styles.list}>
      {voices.map((v) => {
        const on = value === v.id;
        return (
          <Pressable
            key={v.id}
            onPress={() => onChange(v.id)}
            style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && styles.pressed]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${v.name}, ${v.description}`}
          >
            <View style={[styles.radio, on && styles.radioOn]}>{on ? <IconCheck size={12} sw={3} color={colors.onAccent} /> : null}</View>
            <View style={styles.body}>
              <Text style={styles.name}>
                {v.name} <Text style={styles.gender}>{v.gender === 'female' ? '· Female' : '· Male'}</Text>
              </Text>
              <Text style={styles.desc}>{v.description}</Text>
            </View>
            {v.preview_url ? (
              <Pressable
                onPress={() => toggle(v)}
                hitSlop={8}
                style={styles.play}
                accessibilityRole="button"
                accessibilityLabel={playing === v.id ? `Stop ${v.name}` : `Listen to ${v.name}`}
              >
                {playing === v.id ? <IconClose size={16} color={colors.accent} /> : <IconPlay size={16} color={colors.accent} />}
              </Pressable>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    padding: Spacing.three - 4,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  rowOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.8 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  body: { flex: 1, gap: 2 },
  name: { fontFamily: Fonts.bold, fontSize: 14, color: colors.ink },
  gender: { fontFamily: Fonts.medium, fontSize: 12, color: colors.ink3 },
  desc: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink2 },
  play: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
}));
