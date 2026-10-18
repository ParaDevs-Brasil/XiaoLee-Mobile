import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getCreatorReport } from '@/api/backend';
import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import {
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconInbox,
  IconMegaphone,
  IconPlay,
  IconScissors,
  IconSpark,
  IconTrendingDown,
  IconTrendingUp,
  IconWallet,
  type IconProps,
} from '@/components/icons';
import { Pop, Reveal, Twinkle } from '@/components/motion';
import { IdeasProgress, ReportIdeaCard } from '@/components/report-idea-card';
import { ReportMetricCard } from '@/components/report-metric-card';
import { ScreenShell } from '@/components/screen-shell';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useIdeaProgress } from '@/hooks/use-idea-progress';
import {
  isEmptyPeriod,
  nextReportLabel,
  reportHighlights,
  reportMetricRows,
  reportPeriodLabel,
  type MetricKey,
} from '@/lib/creator-report';

/**
 * Relatório de 30 dias — destino da notificação "Your 30-day report is ready".
 *
 * Quem gera é o job do backend (`server/creator_report.py`); a tela só lê. Os
 * números vêm do banco, não da IA — a IA escreve o resumo e as sugestões, e a
 * tela deixa isso visível (selo "AI insight", "Written by AI") para o creator
 * saber o que é medido e o que é palpite.
 *
 * A tela entra em cascata, de cima para baixo (`Reveal`, com a posição de cada
 * bloco em `ORDER`): o resumo, os números (que contam de 0 até o valor) e as
 * ideias. Só o que é mostrado no resumo e nos cartões é dado do relatório; o
 * progresso das ideias ("1 of 3 done") é um lembrete pessoal guardado no aparelho.
 *
 * Sem botões de rodapé: nada aqui tem para onde levar além do histórico, que
 * vira um link discreto no fim.
 */

const METRIC_ICON: Record<MetricKey, (p: IconProps) => React.ReactElement> = {
  videos: IconPlay,
  video_minutes: IconClock,
  clips: IconScissors,
  campaigns_joined: IconMegaphone,
  usdc_received: IconWallet,
};

/** O botão flutuante do Chat cobre o fim da lista: a folga extra deixa o rodapé à vista. */
const CHAT_FAB_CLEARANCE = 72;

/** Posição de cada bloco na cascata de entrada (a cascata trava em 9: ver `motion.tsx`). */
const ORDER = { summary: 0, numbersHeading: 1, tiles: 2, ideasHeading: 7, ideas: 8, footer: 9 };

export default function ReportScreen() {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const reportId = Number(params.id);
  const { data, error, loading, refreshing, reload } = useBackendData(() =>
    getCreatorReport(reportId),
  );
  const ideas = useIdeaProgress(reportId, data?.suggestions.length ?? 0);

  const rows = data ? reportMetricRows(data.metrics, data.previous) : [];
  const tiles = rows.filter((row) => row.key !== 'usdc_received');
  const usdc = rows.find((row) => row.key === 'usdc_received');
  const { up, down } = reportHighlights(rows);

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Spacing.four + CHAT_FAB_CLEARANCE + insets.bottom },
        ]}
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
        <View style={styles.header}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/reports'))}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <IconChevronLeft size={20} sw={2.2} color={colors.ink} />
          </Pressable>
          <View style={styles.flex}>
            <Text style={styles.title} accessibilityRole="header">
              30-day report
            </Text>
            <Text style={styles.meta}>
              {data ? reportPeriodLabel(data.period_start, data.period_end) : ' '}
            </Text>
          </View>
          <View style={styles.aiPill}>
            <IconSpark size={11} color={colors.accent} />
            <Text style={styles.aiPillText}>AI insight</Text>
          </View>
        </View>

        {error ? (
          <ErrorState title="Couldn't load the report" message={error} onRetry={reload} />
        ) : null}

        {loading && !data ? (
          <View style={styles.skeleton} accessible accessibilityLabel="Loading report">
            <Skeleton height={104} radius={Radius.lg} />
            <Skeleton height={150} radius={Radius.lg} />
            <Skeleton height={150} radius={Radius.lg} />
          </View>
        ) : null}

        {data ? (
          <>
            <Reveal index={ORDER.summary}>
              <View style={styles.summary}>
                <Twinkle style={styles.summaryIcon}>
                  <IconSpark size={18} color={colors.accent} />
                </Twinkle>
                <View style={styles.flex}>
                  <Text style={styles.summaryText}>{data.summary}</Text>
                  {up + down > 0 ? (
                    <View style={styles.chips}>
                      {up > 0 ? (
                        <Pop delay={450} style={[styles.chip, styles.chipUp]}>
                          <IconTrendingUp size={13} sw={2.4} color={colors.success} />
                          <Text style={[styles.chipText, { color: colors.success }]}>
                            {up} up
                          </Text>
                        </Pop>
                      ) : null}
                      {down > 0 ? (
                        <Pop delay={560} style={[styles.chip, styles.chipDown]}>
                          <IconTrendingDown size={13} sw={2.4} color={colors.danger} />
                          <Text style={[styles.chipText, { color: colors.danger }]}>
                            {down} down
                          </Text>
                        </Pop>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </View>
            </Reveal>

            <Reveal index={ORDER.numbersHeading}>
              <SectionHeading
                title="Your numbers"
                subtitle="Activity on Xiaolee vs the 30 days before"
              />
            </Reveal>
            {isEmptyPeriod(data.metrics) ? (
              <Reveal index={ORDER.tiles} style={styles.emptyCard}>
                <EmptyState
                  Icon={IconInbox}
                  title="A quiet month"
                  text="No videos, clips or campaigns in this period. The ideas below help you get going."
                />
              </Reveal>
            ) : (
              <>
                <View style={styles.grid}>
                  {tiles.map((row, i) => (
                    <ReportMetricCard
                      key={row.key}
                      row={row}
                      Icon={METRIC_ICON[row.key]}
                      index={ORDER.tiles + i}
                    />
                  ))}
                </View>
                {usdc ? (
                  <ReportMetricCard
                    row={usdc}
                    Icon={METRIC_ICON.usdc_received}
                    index={ORDER.tiles + tiles.length}
                    wide
                  />
                ) : null}
              </>
            )}

            <Reveal index={ORDER.ideasHeading}>
              <SectionHeading
                title="Ideas for the next 30 days"
                subtitle="Written by AI from your numbers and videos — tap one to see why"
              />
              <IdeasProgress done={ideas.done.length} total={data.suggestions.length} />
            </Reveal>
            {data.suggestions.map((s, i) => (
              <ReportIdeaCard
                key={`${i}-${s.title}`}
                index={i + 1}
                suggestion={s}
                done={ideas.done.includes(i)}
                onToggleDone={() => ideas.toggle(i)}
                revealIndex={ORDER.ideas + i}
              />
            ))}

            <Reveal index={ORDER.footer} style={styles.footer}>
              <Text style={styles.footnote}>
                {nextReportLabel(data.period_end)
                  ? `Your next report arrives around ${nextReportLabel(data.period_end)}. `
                  : ''}
                Views and followers from your social networks aren&apos;t included yet — only what
                happens on Xiaolee.
              </Text>
              <Pressable
                onPress={() => router.push('/reports')}
                style={({ pressed }) => [styles.pastLink, pressed && styles.pressed]}
                accessibilityRole="link"
                accessibilityLabel="Past reports"
                hitSlop={Spacing.two}
              >
                <Text style={styles.pastLinkText}>Past reports</Text>
                <IconChevronRight size={13} sw={2.2} color={colors.accent} />
              </Pressable>
            </Reveal>
          </>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  const styles = useStyles();
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three - 4,
    paddingTop: Spacing.three,
    gap: Spacing.three - 4,
  },
  pressed: { opacity: 0.7 },
  skeleton: { gap: Spacing.three - 4 },

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  back: {
    width: 44,
    height: 44,
    marginLeft: -Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: Fonts.bold, fontSize: 22, lineHeight: 28, color: colors.ink },
  meta: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink3 },
  aiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 1,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentSoft,
  },
  aiPillText: {
    fontFamily: Fonts.bold,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.accent,
  },

  summary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two + 2,
    padding: Spacing.three - 2,
    borderRadius: Radius.lg,
    // Branco como os cartões de métrica: a cor do resumo vem do ícone e dos chips, não do fundo.
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...CardShadow,
  },
  summaryIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  summaryText: {
    fontFamily: Fonts.medium,
    fontSize: 14,
    lineHeight: 21,
    color: colors.ink,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two + 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 1,
    borderRadius: Radius.pill,
  },
  chipUp: { backgroundColor: colors.successSoft },
  chipDown: { backgroundColor: colors.dangerSoft },
  chipText: { fontFamily: Fonts.bold, fontSize: 12 },

  sectionHeading: { gap: 2, marginTop: Spacing.two },
  sectionTitle: { fontFamily: Fonts.bold, fontSize: 18, color: colors.ink },
  sectionSubtitle: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink3 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three - 4 },
  emptyCard: {
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },

  footer: { alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three },
  footnote: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    lineHeight: 16,
    color: colors.ink3,
    textAlign: 'center',
  },
  pastLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pastLinkText: { fontFamily: Fonts.bold, fontSize: 12, color: colors.accent },
}));
