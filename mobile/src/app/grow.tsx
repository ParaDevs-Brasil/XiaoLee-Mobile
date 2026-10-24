import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { IconPlus } from '@/components/icons';
import { FAB_CLEARANCE, ScreenShell } from '@/components/screen-shell';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { CampaignsView } from './campaigns';

/**
 * Grow — frame "Grow / Light" do Figma (XiaoLee v2): título com o botão New e os atalhos Campaigns, Marketplace e
 * Insights. O conteúdo de Campaigns é a tela completa de sempre, encaixada aqui (`CampaignsView` com `embedded`):
 * estado da carteira, Explore / Mine / Rewards, "How it works", o carrossel de campanhas e as ações de cada uma.
 *
 * Marketplace e Insights ainda não têm frame: os chips abrem as telas que já existem.
 */
export default function GrowScreen() {
  const colors = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { hasSession } = useSession();
  // Puxar para atualizar remonta a lista, que busca de novo; `refreshing` só cobre o gesto.
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    setReloadKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 600);
  };

  const chips: { label: string; selected?: boolean; onPress?: () => void }[] = [
    { label: 'Campaigns', selected: true },
    { label: 'Marketplace', onPress: () => router.push('/marketplace') },
    { label: 'Insights', onPress: () => router.push('/traction') },
  ];

  return (
    <ScreenShell deferContent>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}
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
            accessibilityLabel={hasSession ? 'New campaign' : 'Connect a wallet to create a campaign'}
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

        <CampaignsView key={reloadKey} embedded />
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
}));
