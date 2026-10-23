import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listCreatorReports, type CreatorReportSummary } from '@/api/backend';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { IconChevronRight, IconClipboard } from '@/components/icons';
import { Reveal } from '@/components/motion';
import { FAB_CLEARANCE, PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { Fonts, Radius, Spacing } from '@/constants/theme';
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

  const body = (
      <>
        {embedded ? null : (
          <PageHeading title="Reports" subtitle="Every 30 days: your numbers and AI ideas to grow." />
        )}

        {error && hasSession ? (
          <ErrorState title="Couldn't load reports" message={error} onRetry={reload} />
        ) : null}

        {loading && !data ? <Skeleton height={180} radius={Radius.lg} /> : null}

        {data ? (
          <SectionCard title="Your reports">
            {!hasSession || data.length === 0 ? (
              <EmptyState
                Icon={IconClipboard}
                title={hasSession ? 'No report yet' : 'Sign in to see your reports'}
                text="Your first report arrives 30 days after you join. You'll get a notification when it's ready."
              />
            ) : (
              data.map((r, i) => (
                <Reveal key={r.id} index={i}>
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/reports/[id]',
                        params: { id: String(r.id) },
                      })
                    }
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Report ${reportPeriodLabel(r.period_start, r.period_end)}`}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.period}>
                        {reportPeriodLabel(r.period_start, r.period_end)}
                      </Text>
                      <Text style={styles.summary} numberOfLines={2}>
                        {r.summary}
                      </Text>
                    </View>
                    <IconChevronRight size={16} color={colors.ink3} />
                  </Pressable>
                </Reveal>
              ))
            )}
          </SectionCard>
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

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three - 4,
    paddingTop: Spacing.four,
    gap: Spacing.three - 4,
  },
  embedded: { gap: Spacing.three - 4 },
  pressed: { opacity: 0.7 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
  },
  period: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink },
  summary: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: colors.ink2,
    marginTop: 2,
  },
}));
