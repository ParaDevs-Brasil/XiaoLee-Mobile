import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { getRadar } from '@/api/backend';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { trendsFrom, type CardRadar, type CardTrend } from '@/lib/chat-cards';

const POLL_MS = 3000;
// A pesquisa leva ~1 min; passou disso, desiste em vez de girar para sempre.
const GIVE_UP_MS = 3 * 60 * 1000;

/**
 * Radar de tendências na conversa (`get_trend_radar`). Enquanto `pending`, consulta o backend a cada 3 s e entrega
 * o resultado por `onUpdate` (quem guarda no histórico é a tela). Escolher uma tendência (`onPick`) manda uma
 * mensagem comum para a Xiaolee escrever as opções de post: nada é postado aqui.
 */
export function RadarCard({
  radar,
  onUpdate,
  onPick,
}: {
  radar: CardRadar;
  onUpdate: (next: CardRadar) => void;
  onPick: (trend: CardTrend) => void;
}) {
  const colors = useTheme();
  const styles = useStyles();

  useEffect(() => {
    if (radar.status !== 'pending') return;
    const started = Date.now();
    let stopped = false;
    const id = setInterval(async () => {
      if (stopped) return;
      if (Date.now() - started > GIVE_UP_MS) {
        stopped = true;
        onUpdate({ ...radar, status: 'error', message: 'The search took too long. Ask again.' });
        return;
      }
      try {
        const r = await getRadar(radar.jobId);
        if (stopped || r.status === 'pending') return;
        stopped = true;
        onUpdate(
          r.status === 'ready'
            ? { ...radar, status: 'ready', trends: trendsFrom(r.trends) }
            : { ...radar, status: 'error', message: r.message ?? 'Could not search X right now.' },
        );
      } catch (e) {
        // 404 = o servidor reiniciou ou o radar expirou: não volta mais. Falha de rede é passageira, tenta de novo.
        if (e instanceof ApiError && e.status === 404) {
          stopped = true;
          onUpdate({ ...radar, status: 'error', message: 'This search expired. Ask again.' });
        }
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // Só reinicia se mudar o job ou o estado; `onUpdate` novo a cada render não deve reiniciar a consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radar.jobId, radar.status]);

  if (radar.status === 'pending') {
    return (
      <View style={[styles.card, styles.row]}>
        <ActivityIndicator color={colors.ink3} />
        <Text style={styles.muted}>Searching X{radar.niche ? ` for ${radar.niche}` : ''}…</Text>
      </View>
    );
  }
  if (radar.status === 'error') {
    return (
      <View style={styles.card}>
        <Text style={styles.muted}>{radar.message ?? 'Could not search X right now.'}</Text>
      </View>
    );
  }
  if (!radar.trends.length) {
    return (
      <View style={styles.card}>
        <Text style={styles.muted}>Nothing new found for this topic. Try a broader one.</Text>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <Text style={styles.head}>Trending{radar.niche ? ` · ${radar.niche}` : ''}</Text>
      {radar.trends.map((t, i) => (
        <View key={i} style={styles.trend}>
          <Text style={styles.topic}>{t.topic}</Text>
          {t.why ? <Text style={styles.why}>{t.why}</Text> : null}
          <View style={styles.foot}>
            <Pressable
              onPress={() => onPick(t)}
              style={({ pressed }) => [styles.use, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Write a post about ${t.topic}`}
            >
              <Text style={styles.useText}>Write a post</Text>
            </Pressable>
          </View>
        </View>
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
  row: { flexDirection: 'row', alignItems: 'center' },
  muted: { flexShrink: 1, fontFamily: Fonts.sans, fontSize: 13, color: colors.ink3 },
  head: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink },
  trend: { gap: 6, padding: Spacing.two + 2, borderRadius: Radius.md, backgroundColor: colors.card },
  topic: { fontFamily: Fonts.bold, fontSize: 14, lineHeight: 20, color: colors.ink },
  why: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18, color: colors.ink3 },
  foot: { flexDirection: 'row', justifyContent: 'flex-end' },
  use: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three - 2,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
  },
  useText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.onAccent },
}));
