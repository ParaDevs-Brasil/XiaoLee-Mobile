import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { listSocialAccounts } from '@/api/backend';
import { EmptyState } from '@/components/feedback';
import { IconSend } from '@/components/icons';
import { FAB_CLEARANCE, ScreenShell } from '@/components/screen-shell';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { getSession } from '@/lib/session';
import { ClipsView } from './clips';
import { CreatorsView } from './creators';
import { ReportsView } from './reports';

/**
 * Studio — o que o creator produz, com um botão por seção logo no topo (Clips, Reports, AI Creators e Posts).
 *
 * Cada seção é a tela completa de sempre, encaixada aqui (`ClipsView`, `ReportsView`, `CreatorsView` com `embedded`):
 * mesmos campos, mesmas ações e mesmos estados da rota própria, que continua existindo. Só Posts é daqui, porque não
 * há uma tela de posts: o cartão do X, e o caminho para escrever um post no chat.
 */

type Tab = 'clips' | 'reports' | 'creators' | 'posts';
const TABS: { id: Tab; label: string }[] = [
  { id: 'clips', label: 'Clips' },
  { id: 'reports', label: 'Reports' },
  { id: 'creators', label: 'AI Creators' },
  { id: 'posts', label: 'Posts' },
];

/** Sem sessão a rota responde 401; publicação desligada no backend responde 404. Nos dois casos: sem conta. */
async function fetchSocial() {
  if (!(await getSession())) return null;
  return listSocialAccounts().catch(() => null);
}

export default function StudioScreen() {
  const colors = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('clips');
  // Puxar para atualizar remonta a seção aberta, que busca de novo; `refreshing` só cobre o gesto.
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const social = useBackendData(fetchSocial);
  const x = social.data?.accounts.find((a) => a.platform === 'x');

  const refresh = () => {
    setRefreshing(true);
    setReloadKey((k) => k + 1);
    social.reload();
    setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}
      >
        <View>
          <Text style={styles.title}>Studio</Text>
          <Text style={styles.subtitle}>Create, publish and track your content.</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
          {TABS.map(({ id, label }) => {
            const selected = id === tab;
            return (
              <Pressable
                key={id}
                onPress={() => setTab(id)}
                style={[styles.tab, selected && styles.tabSelected]}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {tab === 'clips' ? <ClipsView key={reloadKey} embedded /> : null}
        {tab === 'reports' ? <ReportsView key={reloadKey} embedded /> : null}
        {tab === 'creators' ? <CreatorsView key={reloadKey} embedded /> : null}

        {tab === 'posts' ? (
          <>
            <View style={[styles.card, styles.xCard]}>
              <View style={styles.xLogo}>
                <Text style={styles.xMark}>X</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>X</Text>
                <Text style={styles.hint}>{x ? x.handle : 'Not connected'}</Text>
              </View>
              {x ? null : (
                <Pressable
                  onPress={() => router.push('/accounts')}
                  style={({ pressed }) => [styles.outline, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Connect your X account"
                >
                  <Text style={styles.outlineText}>Connect</Text>
                </Pressable>
              )}
            </View>

            {/* Não há rota que liste os posts já publicados; até existir, a aba leva a escrever um. */}
            <EmptyState
              Icon={IconSend}
              title="No posts yet"
              text="Draft, preview and publish with Xiaolee. Your posts will be listed here."
              action={
                <Pressable
                  onPress={() =>
                    x
                      ? router.navigate({ pathname: '/chat', params: { ask: 'I want to post something on X, can you help me?' } })
                      : router.push('/accounts')
                  }
                  style={({ pressed }) => [styles.outline, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.outlineText}>{x ? 'Write a post' : 'Connect X first'}</Text>
                </Pressable>
              }
            />
          </>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingTop: 20, gap: Spacing.three },
  pressed: { opacity: 0.85 },
  title: { fontFamily: Fonts.bold, fontSize: 24, lineHeight: 30, color: colors.ink },
  subtitle: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 18, color: colors.ink2 },
  tabs: { gap: 6 },
  tab: {
    height: 40,
    paddingHorizontal: 13,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSelected: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  tabText: { fontFamily: Fonts.semibold, fontSize: 13, color: colors.ink2 },
  tabTextSelected: { color: colors.onAccent },
  card: {
    ...CardShadow,
    backgroundColor: colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  xCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Pastilha em `ink` e letra em `bg`: escura no claro, clara no escuro, como no Figma.
  xLogo: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  xMark: { fontFamily: Fonts.bold, fontSize: 20, color: colors.bg },
  cardTitle: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 20, color: colors.ink },
  hint: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 16, color: colors.ink2 },
  outline: {
    height: 44,
    paddingHorizontal: 20,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineText: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.accent },
}));
