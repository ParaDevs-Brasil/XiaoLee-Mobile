import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  listCreatorReports,
  listCreatorVideos,
  listMedia,
  listMyCampaigns,
  type CreatorReportSummary,
  type CreatorVideo,
  type UserCampaignParticipation,
} from '@/api/backend';
import { ConnectWalletButton, EmptyState, Skeleton } from '@/components/feedback';
import {
  IconActivity,
  IconChevronRight,
  IconClipboard,
  IconDollar,
  IconRocket,
  IconScissors,
  IconUser,
  IconWallet,
  type IconProps,
} from '@/components/icons';
import { ReceiptRow } from '@/components/receipt-row';
import { FAB_CLEARANCE, PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { MiniStat, StatCard } from '@/components/stat-card';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useCreatorWallet } from '@/hooks/use-creator-wallet';
import { useSession } from '@/hooks/use-session';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useWallet } from '@/hooks/use-wallet';
import { aiSpend, earnings, nextStep } from '@/lib/creator-home-core';
import { SOURCE_ORDER, sharePercents, sortReceipts, type ReceiptSource } from '@/lib/creator-wallet';
import { formatUSDC, formatDate } from '@/lib/format';

/**
 * Dashboard do criador: o que ganhou, o que fez e o próximo passo. Antes era o painel de quem avalia o projeto (tesouraria,
 * protocolo, arquitetura); esse recorte vive agora na Traction, a um toque daqui. Cada bloco lê a sua fonte e, se ela falha,
 * só ele some: nenhum vira "0" por engano.
 */

interface HomeData {
  campaigns: UserCampaignParticipation[] | null;
  videos: CreatorVideo[] | null;
  uploads: number | null;
  report: CreatorReportSummary | null;
}

/** Cada fonte falha sozinha: uma rota fora do ar não apaga os outros blocos. */
async function fetchHome(): Promise<HomeData> {
  const [campaigns, videos, uploads, reports] = await Promise.all([
    listMyCampaigns().catch(() => null),
    listCreatorVideos().catch(() => null),
    listMedia()
      .then((items) => items.filter((m) => m.kind === 'video').length)
      .catch(() => null),
    listCreatorReports().catch(() => null),
  ]);
  return { campaigns, videos, uploads, report: reports?.[0] ?? null };
}

const SOURCE_LABEL: Record<ReceiptSource, string> = { campaign: 'Campaigns', purchase: 'Sales', transfer: 'Other deposits' };
const RECENT = 4;

export default function DashboardScreen() {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { hasSession } = useSession();
  const { address, loading: addressLoading } = useWallet();
  const wallet = useCreatorWallet(address, addressLoading);
  const home = useBackendData(fetchHome);
  // Relógio lido uma vez: o React Compiler trata `Date.now()` no render como impuro.
  const now = useNow();

  const ready = wallet.status === 'ready';
  const receipts = ready && wallet.receipts ? sortReceipts(wallet.receipts) : null;
  const money = receipts ? earnings(receipts, now) : null;
  const data = home.data;
  const step = nextStep({ campaigns: data?.campaigns ?? null, videos: data?.videos ?? null, uploads: data?.uploads ?? null });
  const refreshing = home.refreshing || wallet.refreshing;
  const reload = () => {
    home.reload();
    wallet.reload();
  };

  if (!hasSession) {
    return (
      <ScreenShell>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE + insets.bottom }]}>
          <PageHeading title="Dashboard" subtitle="What you earned and what to do next." />
          <EmptyState
            Icon={IconUser}
            title="Sign in to see your dashboard"
            text="Your earnings, videos and campaigns are tied to your account."
            action={<ConnectWalletButton label="Connect Wallet" />}
          />
        </ScrollView>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} colors={[colors.accent]} />}
      >
        <PageHeading title="Dashboard" subtitle="What you earned and what to do next." />

        {/* 1 · Quanto ganhou */}
        {wallet.status === 'loading' ? (
          <Skeleton height={150} radius={Radius.lg} />
        ) : money ? (
          <StatCard
            size="lg"
            Icon={IconDollar}
            label="Earned · last 30 days"
            value={`$${formatUSDC(money.last30.total)}`}
            sub={`$${formatUSDC(money.all.total)} in total · balance $${formatUSDC(wallet.balanceUsdc)}`}
          />
        ) : (
          <StatCard
            size="lg"
            Icon={IconWallet}
            label="Balance"
            value={ready ? `$${formatUSDC(wallet.balanceUsdc)}` : '—'}
            sub={ready ? "Your payments list didn't load. Pull to refresh." : "We couldn't read your wallet right now."}
          />
        )}

        {/* 2 · Próximo passo */}
        <Pressable
          onPress={() => router.push(step.route)}
          style={({ pressed }) => [styles.next, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${step.title}. ${step.cta}`}
        >
          <View style={styles.nextMark}>
            <IconRocket size={20} sw={2.2} color={colors.onAccent} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.nextLabel}>Next step</Text>
            <Text style={styles.nextTitle}>{step.title}</Text>
            <Text style={styles.nextText}>{step.text}</Text>
          </View>
          <View style={styles.nextCta}>
            <Text style={styles.nextCtaText}>{step.cta}</Text>
          </View>
        </Pressable>

        {/* 3 · O que fez */}
        <SectionCard title="Your work" subtitle="Everything you've made so far">
          {home.loading && !data ? (
            <Skeleton height={86} radius={Radius.md} />
          ) : (
            <>
              <View style={styles.strip}>
                <Tile Icon={IconActivity} label="AI videos" value={count(data?.videos?.length)} onPress={() => router.push('/creators')} />
                <Tile Icon={IconScissors} label="Clip videos" value={count(data?.uploads)} onPress={() => router.push('/clips')} />
                <Tile Icon={IconRocket} label="Campaigns" value={count(data?.campaigns?.length)} onPress={() => router.push('/campaigns')} />
              </View>
              {data?.videos ? (
                <Text style={styles.note}>
                  {data.videos.length === 0 ? 'No AI videos yet.' : `You spent $${formatUSDC(aiSpend(data.videos))} on AI videos.`}
                </Text>
              ) : null}
            </>
          )}
        </SectionCard>

        {/* 4 · De onde veio o dinheiro */}
        {money ? <WhereFrom split={money.last30} /> : null}

        {/* 5 · Atividade recente */}
        {receipts ? (
          <SectionCard title="Recent payments" subtitle="Newest first">
            {receipts.length === 0 ? (
              <EmptyState Icon={IconWallet} title="No payments yet" text="Rewards and sales land here as soon as they arrive." />
            ) : (
              <>
                {receipts.slice(0, RECENT).map((item, i) => (
                  <View key={item.id} style={i > 0 && styles.divider}>
                    <ReceiptRow receipt={item} />
                  </View>
                ))}
                <Pressable onPress={() => router.push('/wallet/receipts')} style={styles.seeAll} accessibilityRole="button">
                  <Text style={styles.seeAllText}>See all payments</Text>
                  <IconChevronRight size={16} color={colors.accent} />
                </Pressable>
              </>
            )}
          </SectionCard>
        ) : null}

        {/* 6 · Último relatório */}
        {data?.report ? (
          <Pressable
            onPress={() => router.push({ pathname: '/reports/[id]', params: { id: String(data.report?.id) } })}
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <IconClipboard size={20} color={colors.accent} />
            <View style={styles.flex}>
              <Text style={styles.linkTitle}>Your latest report</Text>
              <Text style={styles.linkText} numberOfLines={2}>
                {formatDate(data.report.period_start)} to {formatDate(data.report.period_end)}
              </Text>
            </View>
            <IconChevronRight size={18} color={colors.ink3} />
          </Pressable>
        ) : null}

        {/* O recorte de "como a rede está" (para quem avalia o projeto) fica a um toque, na Traction. */}
        <Pressable onPress={() => router.push('/traction')} style={styles.footerLink} accessibilityRole="link">
          <Text style={styles.footerLinkText}>How the XiaoLee network is doing</Text>
          <IconChevronRight size={14} color={colors.ink3} />
        </Pressable>
      </ScrollView>
    </ScreenShell>
  );
}

function useNow(): number {
  const [now] = useState(() => Date.now());
  return now;
}

const count = (n: number | null | undefined) => (n == null ? '—' : String(n));

function Tile({ Icon, label, value, onPress }: { Icon: (p: IconProps) => React.ReactElement; label: string; value: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={styles.tile} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>
      <MiniStat Icon={Icon} label={label} value={value} />
    </Pressable>
  );
}

function WhereFrom({ split }: { split: ReturnType<typeof earnings>['last30'] }) {
  const colors = useTheme();
  const styles = useStyles();
  // Sem ganho não há o que dividir: o vazio já é dito uma vez, em "Recent payments" (dois cartões vazios seguidos diriam o mesmo).
  if (split.total <= 0) return null;
  const shown = SOURCE_ORDER.filter((s) => split[s] > 0);
  const pct = sharePercents(shown.map((s) => split[s]));
  return (
    <SectionCard title="Where it came from" subtitle="Last 30 days">
      {shown.map((source, i) => (
        <View key={source} style={styles.srcRow}>
          <View style={styles.srcTop}>
            <Text style={styles.srcLabel}>{SOURCE_LABEL[source]}</Text>
            <Text style={styles.srcValue}>
              ${formatUSDC(split[source])} · {pct[i]}%
            </Text>
          </View>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.max(pct[i], 4)}%`, backgroundColor: colors.accent }]} />
          </View>
        </View>
      ))}
    </SectionCard>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1, gap: 2 },
  content: { paddingHorizontal: Spacing.three - 4, paddingTop: Spacing.four, gap: Spacing.three - 4 },
  pressed: { opacity: 0.85 },
  next: {
    ...CardShadow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  nextMark: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentFill },
  nextLabel: { fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.accent },
  nextTitle: { fontFamily: Fonts.bold, fontSize: 16, color: colors.ink },
  nextText: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: colors.ink2 },
  nextCta: { paddingHorizontal: Spacing.three - 2, height: 36, justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: colors.accentFill },
  nextCtaText: { fontFamily: Fonts.bold, fontSize: 12, color: colors.onAccent },
  strip: { flexDirection: 'row', gap: Spacing.two },
  tile: { flex: 1 },
  note: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink2, paddingTop: Spacing.two },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  seeAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: Spacing.two + 2 },
  seeAllText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.accent },
  srcRow: { gap: Spacing.one + 2, paddingVertical: Spacing.one },
  srcTop: { flexDirection: 'row', justifyContent: 'space-between' },
  srcLabel: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.ink },
  srcValue: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink2, fontVariant: ['tabular-nums'] },
  bar: { height: 8, borderRadius: Radius.pill, backgroundColor: colors.bg, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: Radius.pill },
  linkRow: {
    ...CardShadow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  linkTitle: { fontFamily: Fonts.bold, fontSize: 14, color: colors.ink },
  linkText: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink2 },
  footerLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: Spacing.two },
  footerLinkText: { fontFamily: Fonts.medium, fontSize: 12, color: colors.ink3 },
}));
