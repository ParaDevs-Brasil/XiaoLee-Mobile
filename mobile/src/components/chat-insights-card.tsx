import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NETWORK_NAMES, SocialLogo } from '@/components/social-logos';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import type { CardInsights } from '@/lib/chat-cards';

/** 1.234 -> "1.2k": só para exibir. */
function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/**
 * Card de métricas na conversa (`get_social_insights`): os números do perfil e os melhores posts da janela.
 * Os números vêm da rede; a Xiaolee só resume. Amostra pequena é pista, não regra — o texto da conversa avisa.
 */
export function InsightsCard({ insights }: { insights: CardInsights }) {
  const colors = useTheme();
  const styles = useStyles();
  const t = insights.totals;
  const stats = [
    { label: 'Followers', value: compact(insights.followers) },
    { label: 'Impressions', value: compact(t.impressions) },
    { label: 'Engagement', value: `${insights.engagementRate}%` },
    { label: 'Profile clicks', value: compact(t.profileClicks) },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <SocialLogo platform={insights.platform} ink={colors.ink} size={18} />
        <Text style={styles.who} numberOfLines={1}>
          {NETWORK_NAMES[insights.platform] ?? insights.platform}
          {insights.handle ? ` · ${insights.handle}` : ''}
        </Text>
        <Text style={styles.tag}>
          Last {insights.windowDays} days · {t.posts} {t.posts === 1 ? 'post' : 'posts'}
        </Text>
      </View>
      <View style={styles.grid}>
        {stats.map((s) => (
          <View key={s.label} style={styles.tile}>
            <Text style={styles.value}>{s.value}</Text>
            <Text style={styles.label}>{s.label}</Text>
          </View>
        ))}
      </View>
      {insights.topPosts.length ? <Text style={styles.section}>Top posts</Text> : null}
      {insights.topPosts.map((p) => (
        <Pressable
          key={p.url}
          onPress={() => void WebBrowser.openBrowserAsync(p.url)}
          style={({ pressed }) => [styles.post, pressed && styles.pressed]}
          accessibilityRole="link"
        >
          <Text style={styles.postText} numberOfLines={2}>
            {p.text}
          </Text>
          <Text style={styles.postMeta}>
            {compact(p.impressions)} views · {p.likes} {p.likes === 1 ? 'like' : 'likes'}
          </Text>
        </Pressable>
      ))}
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.card,
  },
  value: { fontFamily: Fonts.bold, fontSize: 20, color: colors.ink },
  label: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink3, marginTop: 2 },
  section: { fontFamily: Fonts.bold, fontSize: 12, color: colors.ink2, marginTop: Spacing.one },
  post: { gap: 2, padding: Spacing.two, borderRadius: Radius.md, backgroundColor: colors.card },
  postText: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18, color: colors.ink },
  postMeta: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink3 },
}));
