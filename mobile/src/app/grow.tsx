import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { IconBell, IconMegaphone, IconPlus, IconTarget } from '@/components/icons';
import { CampaignCard } from '@/components/campaign-card';
import { FAB_CLEARANCE, ScreenShell } from '@/components/screen-shell';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useSession } from '@/hooks/use-session';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { fetchCampaignsAndParticipation, ParticipationRow, RewardRow } from './campaigns';

/**
 * Grow — frame "Grow / Light" do Figma (XiaoLee v2): campanhas num segmentado Explore / Mine / Rewards, com os
 * mesmos cartões da tela de Campaigns (entrar, verificar e resgatar continuam lá dentro).
 *
 * Marketplace e Insights ainda não têm frame: os chips abrem as telas que já existem.
 */

type Tab = 'explore' | 'mine' | 'rewards';

export default function GrowScreen() {
  const colors = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { hasSession } = useSession();
  const [tab, setTab] = useState<Tab>('explore');
  const { data, error, loading, refreshing, reload } = useBackendData(fetchCampaignsAndParticipation);

  const campaigns = data?.campaigns ?? [];
  const mine = data?.mine ?? [];
  const claimed = mine.filter((item) => item.tasks_claimed);
  const participationById = new Map(mine.map((item) => [item.id, item]));

  const chips: { label: string; selected?: boolean; onPress?: () => void }[] = [
    { label: 'Campaigns', selected: true },
    { label: 'Marketplace', onPress: () => router.push('/marketplace') },
    { label: 'Insights', onPress: () => router.push('/traction') },
  ];
  const segments: { id: Tab; label: string; count: number }[] = [
    { id: 'explore', label: 'Explore', count: campaigns.length },
    { id: 'mine', label: 'Mine', count: mine.length },
    { id: 'rewards', label: 'Rewards', count: claimed.length },
  ];

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} colors={[colors.accent]} />
        }
      >
        <View style={styles.head}>
          <View style={styles.flex}>
            <Text style={styles.title}>Grow</Text>
            <Text style={styles.subtitle}>Campaigns, sales and your numbers.</Text>
          </View>
          <Pressable
            onPress={() => router.push(hasSession ? '/campaigns/new' : '/')}
            style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="New campaign"
          >
            <IconPlus size={16} sw={2.2} color={colors.onAccent} />
            <Text style={styles.newText}>New</Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {chips.map(({ label, selected, onPress }) => (
            <Pressable
              key={label}
              onPress={onPress}
              style={[styles.chip, selected && styles.chipSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected: !!selected }}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.segmented} accessibilityRole="tablist">
          {segments.map(({ id, label, count }) => {
            const selected = id === tab;
            return (
              <Pressable
                key={id}
                onPress={() => setTab(id)}
                style={[styles.segment, selected && styles.segmentSelected]}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                  {label} <Text style={selected && styles.count}>{count}</Text>
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error ? <ErrorState title="Error loading campaigns" message={error} onRetry={reload} /> : null}
        {loading && !data ? <Skeleton height={260} radius={Radius.lg} /> : null}

        {data && tab === 'explore' ? (
          campaigns.length ? (
            campaigns.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                hasSession={hasSession}
                participation={participationById.get(campaign.id)}
                onChanged={reload}
              />
            ))
          ) : (
            <EmptyState Icon={IconMegaphone} title="No active campaigns" text="New campaigns coming soon. Check back in a moment." />
          )
        ) : null}

        {data && tab === 'mine' ? (
          mine.length ? (
            mine.map((item) => <ParticipationRow key={item.id} item={item} />)
          ) : (
            <EmptyState Icon={IconTarget} title="You haven't joined any campaign yet" text="Explore active campaigns and join to start earning." />
          )
        ) : null}

        {data && tab === 'rewards' ? (
          claimed.length ? (
            claimed.map((item) => <RewardRow key={item.id} item={item} />)
          ) : (
            <EmptyState Icon={IconBell} title="No rewards yet" text="Complete campaign tasks to receive USDC rewards here." />
          )
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingTop: 20, gap: Spacing.three },
  pressed: { opacity: 0.85 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontFamily: Fonts.bold, fontSize: 24, lineHeight: 30, color: colors.ink },
  subtitle: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 18, color: colors.ink2 },
  newButton: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: Radius.md,
    backgroundColor: colors.accentFill,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  newText: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.onAccent },
  chips: { gap: 8 },
  chip: {
    height: 40,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  chipText: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.ink2 },
  chipTextSelected: { color: colors.onAccent },
  segmented: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: Radius.md, padding: 4 },
  segment: { flex: 1, height: 40, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  segmentSelected: { backgroundColor: colors.card },
  segmentText: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.ink2 },
  segmentTextSelected: { color: colors.ink },
  count: { color: colors.accent },
}));
