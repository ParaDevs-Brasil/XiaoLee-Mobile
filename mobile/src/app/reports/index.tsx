import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getCreatorReport, listCreatorReports, type CreatorReportSummary } from '@/api/backend';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { IconChevronRight, IconClipboard, IconFileText, IconSpark } from '@/components/icons';
import { Reveal } from '@/components/motion';
import { FAB_CLEARANCE, PageHeading, ScreenShell } from '@/components/screen-shell';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useSession } from '@/hooks/use-session';
import { reportPeriodLabel } from '@/lib/creator-report';
import { getSession } from '@/lib/session';

/** Sem sessão a rota responde 401 — lista vazia deixa a tela no estado de convidado. */
async function fetchReports(): Promise<CreatorReportSummary[]> {
  const session = await getSession();
  if (!session) return [];
  return listCreatorReports();
}

/** Histórico dos relatórios de 30 dias, mais novo primeiro. Cada um abre em `/reports/[id]`. */
export default function ReportsScreen() {
  return <ReportsView />;
}

/** O corpo da tela de Reports; `embedded` o encaixa dentro de outra tela (o Studio), sem moldura, rolagem nem título. */
export function ReportsView({ embedded = false }: { embedded?: boolean }) {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { hasSession } = useSession();
  const { data, error, loading, refreshing, reload } = useBackendData(fetchReports);
  const open = (id: number) => router.push({ pathname: '/reports/[id]', params: { id: String(id) } });

  const body = (
      <>
        {embedded ? null : (
          <PageHeading title="Reports" subtitle="Every 30 days: your numbers and AI ideas to grow." />
        )}

        {error && hasSession ? (
          <ErrorState title="Couldn't load reports" message={error} onRetry={reload} />
        ) : null}

        {loading && !data ? <Skeleton height={180} radius={Radius.lg} /> : null}

        {data && (!hasSession || data.length === 0) ? (
          <EmptyState
            Icon={IconClipboard}
            title={hasSession ? 'No report yet' : 'Sign in to see your reports'}
            text="Your first report arrives 30 days after you join. You'll get a notification when it's ready."
          />
        ) : null}

        {data && hasSession && data.length > 0 ? (
          <>
            <LatestReport key={data[0].id} summary={data[0]} onOpen={() => open(data[0].id)} />
            <NextReport periodEnd={data[0].period_end} />

            {data.length > 1 ? (
              <>
                <Text style={styles.sectionTitle}>Earlier reports</Text>
                {data.slice(1).map((r, i) => (
                  <Reveal key={r.id} index={i}>
                    <Pressable
                      onPress={() => open(r.id)}
                      style={({ pressed }) => [styles.earlier, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Report ${reportPeriodLabel(r.period_start, r.period_end)}`}
                    >
                      <View style={styles.earlierIcon}>
                        <IconClipboard size={20} color={colors.accent} />
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.period}>{reportPeriodLabel(r.period_start, r.period_end)}</Text>
                        <Text style={styles.summary} numberOfLines={1}>
                          {r.summary}
                        </Text>
                      </View>
                      <IconChevronRight size={18} color={colors.ink3} />
                    </Pressable>
                  </Reveal>
                ))}
              </>
            ) : null}
          </>
        ) : null}
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
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={reload}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {body}
      </ScrollView>
    </ScreenShell>
  );
}

/** O relatório mais novo em destaque: o período, três números e a leitura da IA. Os números vêm do relatório completo. */
function LatestReport({ summary, onOpen }: { summary: CreatorReportSummary; onOpen: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const full = useBackendData(() => getCreatorReport(summary.id));
  const stats = [
    { label: 'Clips made', value: full.data?.metrics.clips, accent: false },
    { label: 'Campaigns joined', value: full.data?.metrics.campaigns_joined, accent: false },
    { label: 'AI ideas', value: full.data?.suggestions.length, accent: true },
  ];
  return (
    <View style={styles.latest}>
      <View style={styles.latestTop}>
        <View style={styles.badge}>
          <IconSpark size={14} sw={2.2} color={colors.accent} />
          <Text style={styles.badgeText}>Latest report</Text>
        </View>
        <Text style={styles.days}>30 days</Text>
      </View>
      <Text style={styles.latestPeriod}>{reportPeriodLabel(summary.period_start, summary.period_end)}</Text>

      <View style={styles.stats}>
        {stats.map(({ label, value, accent }) => (
          <View key={label} style={[styles.stat, accent && styles.statAccent]}>
            <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value ?? '–'}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {summary.summary ? (
        <View style={styles.insight}>
          <IconSpark size={18} sw={2} color={colors.accent} />
          <Text style={styles.insightText}>{summary.summary}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [styles.readBtn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Read full report"
      >
        <IconFileText size={18} color={colors.onAccent} />
        <Text style={styles.readText}>Read full report</Text>
      </Pressable>
    </View>
  );
}

const DAY_MS = 24 * 3600 * 1000;

/** Quanto falta para o próximo relatório: o job gera 30 dias depois do fim do último. */
function NextReport({ periodEnd }: { periodEnd: string }) {
  const styles = useStyles();
  const [now] = useState(() => Date.now());
  const end = Date.parse(periodEnd);
  if (Number.isNaN(end)) return null;
  const day = Math.min(30, Math.max(0, Math.floor((now - end) / DAY_MS)));
  const left = 30 - day;
  return (
    <View style={styles.next}>
      <View style={styles.nextTop}>
        <Text style={styles.nextTitle}>{left > 0 ? `Next report in ${left} ${left === 1 ? 'day' : 'days'}` : 'Next report is due'}</Text>
        <Text style={styles.nextDay}>Day {day} of 30</Text>
      </View>
      <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 30, now: day }}>
        <View style={[styles.fill, { width: `${(day / 30) * 100}%` }]} />
      </View>
      <Text style={styles.nextHint}>We&apos;ll notify you when it&apos;s ready.</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three - 4,
    paddingTop: Spacing.four,
    gap: Spacing.three - 4,
  },
  embedded: { gap: Spacing.three - 4 },
  pressed: { opacity: 0.7 },
  sectionTitle: { fontFamily: Fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink, marginTop: Spacing.one },
  latest: {
    gap: Spacing.three,
    padding: 20,
    borderRadius: Radius.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...CardShadow,
  },
  latestTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentSoft,
  },
  badgeText: { fontFamily: Fonts.bold, fontSize: 12, color: colors.accent },
  days: { fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink3 },
  latestPeriod: { fontFamily: Fonts.bold, fontSize: 20, lineHeight: 26, color: colors.ink },
  stats: { flexDirection: 'row', gap: Spacing.two },
  stat: { flex: 1, gap: 2, padding: 12, borderRadius: Radius.md, backgroundColor: colors.bg },
  statAccent: { backgroundColor: colors.accentSoft },
  statValue: { fontFamily: Fonts.bold, fontSize: 24, lineHeight: 30, color: colors.ink },
  statValueAccent: { color: colors.accent },
  statLabel: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 16, color: colors.ink2 },
  insight: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + 2 },
  insightText: { flex: 1, fontFamily: Fonts.medium, fontSize: 14, lineHeight: 20, color: colors.ink2 },
  readBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    height: 52,
    borderRadius: Radius.lg,
    backgroundColor: colors.accentFill,
  },
  readText: { fontFamily: Fonts.bold, fontSize: 15, color: colors.onAccent },
  next: {
    gap: Spacing.two + 2,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...CardShadow,
  },
  nextTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  nextTitle: { fontFamily: Fonts.bold, fontSize: 14, color: colors.ink },
  nextDay: { fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink3 },
  track: { height: 8, borderRadius: Radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.pill, backgroundColor: colors.accentFill },
  nextHint: { fontFamily: Fonts.medium, fontSize: 12, color: colors.ink2 },
  earlier: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    padding: Spacing.three,
    borderRadius: Radius.xl - 4,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...CardShadow,
  },
  earlierIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  period: { fontFamily: Fonts.bold, fontSize: 14, color: colors.ink },
  summary: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: colors.ink2,
    marginTop: 2,
  },
}));
