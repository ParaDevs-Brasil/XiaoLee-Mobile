import { Pressable, Text, View } from 'react-native';

import { IconPlay, IconSpark } from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';

/**
 * O que a persona vai fazer no vídeo — dois formatos lado a lado, como o seletor de formato dos estúdios de
 * vídeo. Talk: fala o roteiro com a voz escolhida. Mimic: repete o movimento de um vídeo de referência.
 */

export type CreatorFormat = 'speech' | 'mimic';

const FORMATS: { id: CreatorFormat; title: string; text: string; Icon: typeof IconSpark }[] = [
  { id: 'speech', title: 'Talk', text: 'Your character says what you write', Icon: IconSpark },
  { id: 'mimic', title: 'Mimic', text: 'Your character copies the moves from a video', Icon: IconPlay },
];

export function CreatorFormatPicker({ value, onChange }: { value: CreatorFormat; onChange: (f: CreatorFormat) => void }) {
  const colors = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {FORMATS.map(({ id, title, text, Icon }) => {
        const on = id === value;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            style={({ pressed }) => [styles.card, on && styles.cardOn, pressed && styles.pressed]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <View style={[styles.mark, on && styles.markOn]}>
              <Icon size={20} sw={2.2} color={on ? colors.onAccent : colors.accent} />
            </View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.text}>{text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: 'row', gap: Spacing.two },
  card: {
    flex: 1,
    gap: Spacing.one,
    padding: Spacing.three - 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  cardOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.8 },
  mark: {
    width: 40,
    height: 40,
    marginBottom: Spacing.one,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  markOn: { backgroundColor: colors.accentFill },
  title: { fontFamily: Fonts.bold, fontSize: 16, color: colors.ink },
  text: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: colors.ink2 },
}));
