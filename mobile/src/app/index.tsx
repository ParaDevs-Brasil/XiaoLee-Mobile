import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import {
  getMyProfile,
  listCampaigns,
  listMedia,
  listSocialAccounts,
  type SocialAccounts,
} from '@/api/backend';
import {
  IconCheck,
  IconChevronRight,
  IconClipboard,
  IconGift,
  IconScissors,
  IconSend,
  IconShare,
  IconSwap,
  IconUser,
  type IconProps,
} from '@/components/icons';
import { FAB_CLEARANCE, ScreenShell } from '@/components/screen-shell';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useCreatorWallet } from '@/hooks/use-creator-wallet';
import { useSession } from '@/hooks/use-session';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useWallet } from '@/hooks/use-wallet';
import { formatUSDC } from '@/lib/format';
import { getSession } from '@/lib/session';

/**
 * Home — frame "Home / Light" do Figma (XiaoLee v2): saudação, "Get set up" (passos que o creator ainda não fez),
 * a caixa que leva a pergunta ao chat, o que a Xiaolee faz e dois números do dia.
 *
 * Os dados vêm das mesmas rotas das outras telas; o que falha some do cartão em vez de quebrar a Home (sem sessão, ou
 * publicação desligada no backend, o passo do X só continua pendente).
 */

interface Overview {
  name: string | null;
  onboarded: boolean;
  social: SocialAccounts | null;
  hasClip: boolean;
  ownCampaign: boolean;
  activeCampaigns: number;
}

async function fetchOverview(): Promise<Overview | null> {
  const session = await getSession();
  if (!session) return null;
  // Cada fonte falha sozinha: um 404 do social não pode esconder o saldo de campanhas.
  const [profile, social, media, campaigns] = await Promise.all([
    getMyProfile().catch(() => null),
    listSocialAccounts().catch(() => null),
    listMedia().catch(() => []),
    listCampaigns().catch(() => ({ campaigns: [] })),
  ]);
  return {
    name: profile?.full_name?.trim().split(/\s+/)[0] || null,
    // Sem perfil (backend fora) não bloqueia a Home: só um `onboarded: false` explícito manda para o questionário.
    onboarded: profile?.onboarded !== false,
    social,
    hasClip: media.some((m) => m.clips_ready > 0),
    ownCampaign: campaigns.campaigns.some((c) => c.creator_twitter_user_id === session.twitterUserId),
    activeCampaigns: campaigns.campaigns.filter((c) => c.status === 'active').length,
  };
}

type Step = { key: string; title: string; subtitle: string; cta: string; href: string; done: boolean };

function stepsOf(hasSession: boolean, o: Overview | null): Step[] {
  return [
    { key: 'account', title: 'Create your account', subtitle: 'Done', cta: 'Sign in', href: '/login', done: hasSession },
    {
      key: 'x',
      title: 'Connect your X account',
      subtitle: 'Post from Xiaolee and track your metrics',
      cta: 'Connect X',
      href: '/accounts',
      done: !!o?.social?.accounts.some((a) => a.platform === 'x'),
    },
    {
      key: 'clip',
      title: 'Make your first clip',
      subtitle: 'Cut highlights from a long video',
      cta: 'Make a clip',
      href: '/clips',
      done: !!o?.hasClip,
    },
    {
      key: 'campaign',
      title: 'Reward your community',
      subtitle: 'Launch a campaign paid in USDC',
      cta: 'Create a campaign',
      href: '/campaigns/new',
      done: !!o?.ownCampaign,
    },
  ];
}

export default function HomeScreen() {
  const colors = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { hasSession } = useSession();
  const { address, loading: addressLoading } = useWallet();
  const wallet = useCreatorWallet(address, addressLoading);
  const { data } = useBackendData(fetchOverview);
  const [ask, setAsk] = useState('');
  const [allSteps, setAllSteps] = useState(false);

  // Onboarding obrigatório no 1º acesso (nome + um interesse); convidado e conta já onboarded seguem na Home.
  useEffect(() => {
    if (hasSession && data && !data.onboarded) router.replace('/onboarding');
  }, [hasSession, data, router]);

  const steps = stepsOf(hasSession, data);
  const doneCount = steps.filter((s) => s.done).length;
  const current = steps.find((s) => !s.done);

  const send = () => {
    const text = ask.trim();
    setAsk('');
    router.navigate(text ? { pathname: '/chat', params: { ask: text } } : '/chat');
  };

  // Cada ação do chat que a Home atalha: sem conta no X, "postar" leva a conectar primeiro.
  const tiles: { title: string; subtitle: string; Icon: (p: IconProps) => React.JSX.Element; onPress: () => void }[] = [
    { title: 'Clips', subtitle: 'Cut highlights from long videos', Icon: IconScissors, onPress: () => router.push('/clips') },
    { title: 'Reports', subtitle: 'Weekly recap of your numbers', Icon: IconClipboard, onPress: () => router.push('/reports') },
    {
      title: 'Post to X',
      subtitle: 'Draft, preview and publish',
      Icon: IconShare,
      onPress: () =>
        data?.social?.accounts.some((a) => a.platform === 'x')
          ? router.navigate({ pathname: '/chat', params: { ask: 'I want to post something on X, can you help me?' } })
          : router.push('/accounts'),
    },
    { title: 'AI Creators', subtitle: 'Create with AI characters', Icon: IconUser, onPress: () => router.push('/creators') },
    { title: 'Campaigns', subtitle: 'Reward your community', Icon: IconGift, onPress: () => router.push('/campaigns') },
    {
      title: 'Swap and pay',
      subtitle: 'Move USDC by message',
      Icon: IconSwap,
      onPress: () => router.navigate({ pathname: '/chat', params: { ask: 'I want to make a swap' } }),
    },
  ];

  const balance = wallet.status === 'ready' ? formatUSDC(wallet.balanceUsdc) : '—';

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.greeting}>
          <Text style={styles.hi}>{data?.name ? `Hi, ${data.name}` : 'Hi there'}</Text>
          <Text style={styles.hiSub}>Your creator studio, campaigns and wallet, all in one place.</Text>
        </View>

        {hasSession && current ? (
          <View style={styles.card}>
            <View style={styles.setupHead}>
              <Text style={styles.cardTitle}>Get set up</Text>
              <Text style={styles.count}>
                {doneCount} of {steps.length}
              </Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${(doneCount / steps.length) * 100}%` }]} />
            </View>

            <View style={styles.steps}>
              {steps.map((s) => {
                if (s.done) return <StepRow key={s.key} step={s} done />;
                if (s === current) {
                  return (
                    <View key={s.key} style={styles.current}>
                      <StepRow step={s} />
                      <Pressable
                        onPress={() => router.push(s.href as never)}
                        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                        accessibilityRole="button"
                      >
                        <Text style={styles.primaryText}>{s.cta}</Text>
                      </Pressable>
                    </View>
                  );
                }
                return allSteps ? (
                  <StepRow key={s.key} step={s} chevron onPress={() => router.push(s.href as never)} />
                ) : null;
              })}
            </View>

            <Pressable onPress={() => setAllSteps((v) => !v)} style={styles.seeAll} accessibilityRole="button">
              <Text style={styles.seeAllText}>{allSteps ? 'Show less' : `See all ${steps.length} steps`}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={[styles.card, styles.ask]}>
          <Image source={require('../../assets/images/xiaolee-avatar.png')} style={styles.askAvatar} />
          <TextInput
            value={ask}
            onChangeText={setAsk}
            onSubmitEditing={send}
            placeholder="Ask Xiaolee anything..."
            placeholderTextColor={colors.ink3}
            returnKeyType="send"
            style={styles.askInput}
          />
          <Pressable onPress={send} style={styles.send} accessibilityRole="button" accessibilityLabel="Send to Xiaolee">
            <IconSend size={16} sw={2} color={colors.onAccent} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.cardTitle}>What Xiaolee can do</Text>
          <View style={styles.grid}>
            {tiles.map(({ title, subtitle, Icon, onPress }) => (
              <Pressable
                key={title}
                onPress={onPress}
                style={({ pressed }) => [styles.card, styles.tile, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={title}
              >
                <View style={styles.tileIcon}>
                  <Icon size={20} sw={2} color={colors.accent} />
                </View>
                <View style={styles.tileText}>
                  <Text style={styles.tileTitle}>{title}</Text>
                  <Text style={styles.tileSub}>{subtitle}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        {hasSession ? (
          <View style={styles.section}>
            <Text style={styles.cardTitle}>At a glance</Text>
            <View style={styles.grid}>
              <View style={[styles.card, styles.stat]}>
                <Text style={styles.statLabel}>Wallet balance</Text>
                <Text style={styles.statValue}>
                  {balance}
                  {wallet.status === 'ready' ? <Text style={styles.statUnit}> USDC</Text> : null}
                </Text>
              </View>
              <View style={[styles.card, styles.stat]}>
                <Text style={styles.statLabel}>Active campaigns</Text>
                <Text style={styles.statValue}>{data ? data.activeCampaigns : '—'}</Text>
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

function StepRow({ step, done, chevron, onPress }: { step: Step; done?: boolean; chevron?: boolean; onPress?: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.step} accessibilityRole={onPress ? 'button' : undefined}>
      <View style={[styles.status, done ? styles.statusDone : styles.statusTodo]}>
        {done ? <IconCheck size={16} sw={2.4} color={colors.success} /> : null}
      </View>
      <View style={styles.stepText}>
        <Text style={[styles.stepTitle, done && { color: colors.ink2 }]}>{step.title}</Text>
        <Text style={styles.stepSub}>{done ? 'Done' : step.subtitle}</Text>
      </View>
      {chevron ? <IconChevronRight size={20} sw={1.7} color={colors.ink3} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  content: { paddingHorizontal: Spacing.three, paddingTop: 20, gap: Spacing.four },
  greeting: { gap: Spacing.one },
  hi: { fontFamily: Fonts.bold, fontSize: 24, lineHeight: 30, color: colors.ink },
  hiSub: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 18, color: colors.ink2 },
  card: {
    ...CardShadow,
    backgroundColor: colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: Spacing.three,
  },
  pressed: { opacity: 0.85 },
  cardTitle: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 20, color: colors.ink },
  setupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { fontFamily: Fonts.semibold, fontSize: 12, lineHeight: 15, color: colors.ink3 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, marginTop: Spacing.three, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accentFill },
  steps: { marginTop: Spacing.three, gap: Spacing.three },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { fontFamily: Fonts.semibold, fontSize: 14, lineHeight: 18, color: colors.ink },
  stepSub: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 15, color: colors.ink3 },
  status: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  statusDone: { backgroundColor: colors.successSoft },
  statusTodo: { borderWidth: 2, borderColor: colors.borderStrong },
  current: { backgroundColor: colors.accentSoft, borderRadius: Radius.md, padding: 12, gap: 12 },
  primary: {
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.onAccent },
  seeAll: { alignItems: 'center', justifyContent: 'center', height: 44, marginTop: Spacing.one },
  seeAllText: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.accent },
  ask: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: Radius.lg },
  askAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentSoft },
  askInput: { flex: 1, fontFamily: Fonts.sans, fontSize: 14, color: colors.ink, paddingVertical: 0, height: 36 },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47.9%', flexGrow: 1, gap: 12 },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { gap: 2 },
  tileTitle: { fontFamily: Fonts.semibold, fontSize: 14, lineHeight: 18, color: colors.ink },
  tileSub: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 15, color: colors.ink2 },
  stat: { width: '47.9%', flexGrow: 1, gap: Spacing.one },
  statLabel: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 15, color: colors.ink3 },
  statValue: { fontFamily: Fonts.bold, fontSize: 24, lineHeight: 30, color: colors.ink },
  statUnit: { fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink3 },
}));
