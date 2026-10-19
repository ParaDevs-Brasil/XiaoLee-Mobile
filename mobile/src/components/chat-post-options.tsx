import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NETWORK_NAMES, SocialLogo } from '@/components/social-logos';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import type { CardOptions } from '@/lib/chat-cards';

/**
 * Opções de post que a Xiaolee escreveu (`suggest_post_options`). Escolher uma só a leva para a prévia editável
 * (`onPick`): nada é postado aqui, quem publica é o toque do creator na prévia.
 */
export function PostOptions({ options, onPick }: { options: CardOptions; onPick: (text: string) => void }) {
  const colors = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <SocialLogo platform={options.platform} ink={colors.ink} size={18} />
        <Text style={styles.who} numberOfLines={1}>
          {NETWORK_NAMES[options.platform] ?? options.platform}
          {options.handle ? ` · ${options.handle}` : ''}
        </Text>
        <Text style={styles.tag}>Pick one</Text>
      </View>
      {options.texts.map((text, i) => (
        <View key={i} style={styles.option}>
          <Text style={styles.optionLabel}>Option {i + 1}</Text>
          <Text style={styles.optionText}>{text}</Text>
          <View style={styles.optionFoot}>
            <Text style={styles.count}>{text.length} chars</Text>
            <Pressable
              onPress={() => onPick(text)}
              style={({ pressed }) => [styles.use, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Use option ${i + 1}`}
            >
              <Text style={styles.useText}>Use this</Text>
            </Pressable>
          </View>
        </View>
      ))}
      <Text style={styles.hint}>You can edit it before posting.</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  pressed: { opacity: 0.7 },
  card: {
    gap: Spacing.two,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  who: { flex: 1, fontFamily: Fonts.bold, fontSize: 13, color: colors.ink },
  tag: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink3 },
  option: { gap: 6, padding: Spacing.two + 2, borderRadius: Radius.md, backgroundColor: colors.card },
  optionLabel: { fontFamily: Fonts.bold, fontSize: 11, color: colors.ink3 },
  optionText: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20, color: colors.ink },
  optionFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink3 },
  use: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three - 2,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
  },
  useText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.onAccent },
  hint: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink3 },
}));
