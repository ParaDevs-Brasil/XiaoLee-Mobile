import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { listSocialAccounts } from '@/api/backend';
import { IconCheck, IconSend, IconShare, IconUser } from '@/components/icons';
import { ShareProfileSheet } from '@/components/share-profile-sheet';
import { Reveal, SlideIn } from '@/components/motion';
import { FAB_CLEARANCE, ScreenShell } from '@/components/screen-shell';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useWallet } from '@/hooks/use-wallet';
import { getSession } from '@/lib/session';
import { ClipsView } from './clips';
import { CreatorsView } from './creators';
import { ReportsView } from './reports';

/**
 * Studio — o que o creator produz, com um botão por seção logo no topo (Clips, AI Creators, Reports e Share).
 *
 * Cada seção é a tela completa de sempre, encaixada aqui (`ClipsView`, `ReportsView`, `CreatorsView` com `embedded`):
 * mesmos campos, mesmas ações e mesmos estados da rota própria, que continua existindo. Só Share é daqui: compartilhar o perfil
 * (antes no menu do perfil), as contas conectadas e o caminho para escrever um post no chat.
 */

type Tab = 'clips' | 'creators' | 'reports' | 'share';
const TABS: { id: Tab; label: string }[] = [
  { id: 'clips', label: 'Clips' },
  { id: 'creators', label: 'AI Creators' },
  { id: 'reports', label: 'Reports' },
  { id: 'share', label: 'Share' },
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
  // Sentido do deslize: a aba nova entra pela direita se vem depois da atual, pela esquerda se vem antes.
  const [dir, setDir] = useState<1 | -1>(1);
  // A pílula da aba aberta é uma só e escorrega até a aba tocada, em vez de cada aba pintar a sua.
  const [trackWidth, setTrackWidth] = useState(0);
  const [slide] = useState(() => new Animated.Value(0));
  const index = TABS.findIndex((t) => t.id === tab);
  const pillWidth = trackWidth ? (trackWidth - 8) / TABS.length : 0;
  useEffect(() => {
    Animated.spring(slide, { toValue: index * pillWidth, damping: 18, stiffness: 220, mass: 0.8, useNativeDriver: true }).start();
  }, [index, pillWidth, slide]);
  // Puxar para atualizar remonta a seção aberta, que busca de novo; `refreshing` só cobre o gesto.
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const { address: wallet } = useWallet();
  const [shareSheet, setShareSheet] = useState(false);
  const social = useBackendData(fetchSocial);
  const x = social.data?.accounts.find((a) => a.platform === 'x');

  const refresh = () => {
    setRefreshing(true);
    setReloadKey((k) => k + 1);
    social.reload();
    setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <ScreenShell deferContent>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}
      >
        <Reveal index={0}>
          <Text style={styles.title}>Studio</Text>
          <Text style={styles.subtitle}>Create, publish and track your content.</Text>
        </Reveal>

        <Reveal index={1}>
        <View style={styles.tabs} accessibilityRole="tablist" onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
          {pillWidth ? <Animated.View pointerEvents="none" style={[styles.pill, { width: pillWidth, transform: [{ translateX: slide }] }]} /> : null}
          {TABS.map(({ id, label }) => {
            const selected = id === tab;
            return (
              <Pressable
                key={id}
                onPress={() => {
                  setDir(TABS.findIndex((t) => t.id === id) > TABS.findIndex((t) => t.id === tab) ? 1 : -1);
                  setTab(id);
                }}
                style={styles.tab}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.tabText, selected && styles.tabTextSelected]} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        </Reveal>

        {/* `key={tab}` remonta o Reveal a cada troca de aba: o conteúdo novo desliza de lado (respeita "Reduzir movimento"). */}
        <SlideIn key={tab} from={dir} style={styles.panel}>
          {tab === 'clips' ? <ClipsView key={reloadKey} embedded /> : null}
          {tab === 'reports' ? <ReportsView key={reloadKey} embedded /> : null}
          {tab === 'creators' ? <CreatorsView key={reloadKey} embedded /> : null}

          {tab === 'share' ? (
            <>
              <View style={styles.xHero}>
                <View style={styles.xTop}>
                  <View style={styles.shareIcon}>
                    <IconUser size={24} color={colors.onAccent} />
                  </View>
                  <View style={styles.xInfo}>
                    <Text style={styles.xName}>Your Xiaolee card</Text>
                    <Text style={styles.hint}>Post it on WhatsApp, X and more</Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => (wallet ? setShareSheet(true) : router.push('/accounts'))}
                  style={({ pressed }) => [styles.xBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.xBtnText}>{wallet ? 'Share profile' : 'Connect to share'}</Text>
                </Pressable>
              </View>


              <View style={styles.xHero}>
                <View style={styles.xTop}>
                  <View style={styles.xLogoBig}>
                    <Text style={styles.xMarkBig}>X</Text>
                  </View>
                  <View style={styles.xInfo}>
                    <Text style={styles.xName}>{x ? x.handle : 'X'}</Text>
                    <View style={[styles.statusChip, x && styles.statusChipOn]}>
                      <View style={[styles.statusDot, x && styles.statusDotOn]} />
                      <Text style={[styles.statusText, x && styles.statusTextOn]}>{x ? 'Connected' : 'Not connected'}</Text>
                    </View>
                  </View>
                </View>
                <Text style={styles.xTitle}>Publish straight from Xiaolee</Text>
                <View style={styles.perks}>
                  {['Draft posts with Xiaolee', 'Preview before it goes live', 'See every post listed here'].map((perk) => (
                    <View key={perk} style={styles.perk}>
                      <View style={styles.perkTick}>
                        <IconCheck size={12} sw={3} color={colors.accent} />
                      </View>
                      <Text style={styles.perkText}>{perk}</Text>
                    </View>
                  ))}
                </View>
                <Pressable
                  onPress={() =>
                    x
                      ? router.navigate({ pathname: '/chat', params: { ask: 'I want to post something on X, can you help me?' } })
                      : router.push('/accounts')
                  }
                  style={({ pressed }) => [styles.xBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.xBtnText}>{x ? 'Write a post' : 'Connect X'}</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() => router.push('/accounts')}
                style={({ pressed }) => [styles.card, styles.accountsRow, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <IconShare size={20} color={colors.accent} />
                <View style={styles.xInfo}>
                  <Text style={styles.cardTitle}>Accounts</Text>
                  <Text style={styles.hint}>Connect X and Telegram</Text>
                </View>
              </Pressable>

              <Text style={styles.sectionTitle}>Your posts</Text>
              {/* Não há rota que liste os posts já publicados; até existir, a aba leva a escrever um. */}
              <View style={styles.noPosts}>
                <View style={styles.noPostsIcon}>
                  <IconSend size={22} color={colors.ink2} />
                </View>
                <Text style={styles.noPostsTitle}>No posts yet</Text>
                <Text style={styles.noPostsText}>Draft, preview and publish with Xiaolee. Your posts will be listed here.</Text>
              </View>
            </>
          ) : null}
        </SlideIn>
      </ScrollView>
      <ShareProfileSheet visible={shareSheet} onClose={() => setShareSheet(false)} />
    </ScreenShell>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingTop: 20, gap: Spacing.three },
  pressed: { opacity: 0.85 },
  panel: { gap: Spacing.three },
  title: { fontFamily: Fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.4, color: colors.ink },
  subtitle: { fontFamily: Fonts.medium, fontSize: 14, lineHeight: 19, color: colors.ink2 },
  // Controle segmentado: trilho `border`, e a aba aberta é uma pílula `card` com o texto em rosa.
  tabs: { flexDirection: 'row', height: 44, padding: 4, borderRadius: Radius.pill, backgroundColor: colors.border },
  tab: { flex: 1, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: Radius.pill, backgroundColor: colors.card, ...CardShadow },
  tabText: { fontFamily: Fonts.semibold, fontSize: 13, color: colors.ink2 },
  tabTextSelected: { fontFamily: Fonts.bold, color: colors.accent },
  card: {
    ...CardShadow,
    backgroundColor: colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  xHero: {
    gap: Spacing.three,
    padding: 20,
    borderRadius: Radius.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...CardShadow,
  },
  xTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Pastilha em `ink` e letra em `bg`: escura no claro, clara no escuro, como no Figma.
  xLogoBig: { width: 52, height: 52, borderRadius: Radius.lg, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  xMarkBig: { fontFamily: Fonts.bold, fontSize: 24, color: colors.bg },
  xInfo: { flex: 1, gap: 4, alignItems: 'flex-start' },
  xName: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 20, color: colors.ink },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.pill, backgroundColor: colors.bg },
  statusChipOn: { backgroundColor: colors.successSoft },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ink3 },
  statusDotOn: { backgroundColor: colors.success },
  statusText: { fontFamily: Fonts.bold, fontSize: 12, color: colors.ink2 },
  statusTextOn: { color: colors.success },
  xTitle: { fontFamily: Fonts.bold, fontSize: 20, lineHeight: 26, color: colors.ink },
  shareIcon: { width: 52, height: 52, borderRadius: Radius.lg, backgroundColor: colors.accentFill, alignItems: 'center', justifyContent: 'center' },
  accountsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  perks: { gap: 12 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  perkTick: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  perkText: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.ink },
  xBtn: { height: 52, borderRadius: Radius.lg, backgroundColor: colors.accentFill, alignItems: 'center', justifyContent: 'center' },
  xBtnText: { fontFamily: Fonts.bold, fontSize: 15, color: colors.onAccent },
  sectionTitle: { fontFamily: Fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink },
  noPosts: {
    alignItems: 'center',
    gap: 8,
    padding: 24,
    borderRadius: Radius.xl,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  noPostsIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  noPostsTitle: { fontFamily: Fonts.bold, fontSize: 16, color: colors.ink },
  noPostsText: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 19, color: colors.ink2, textAlign: 'center' },
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
