import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getTractionStats,
  getTreasury,
  listMyCampaigns,
  type TractionSnapshot,
  type TreasuryBalance,
  type TreasuryChain,
  type UserCampaignParticipation,
} from '@/api/backend';
import { EmptyState, ErrorState, ConnectWalletButton, Skeleton } from '@/components/feedback';
import {
  IconActivity,
  IconCheck,
  IconChevronRight,
  IconGift,
  IconRocket,
  IconSpark,
  IconSwap,
  IconTarget,
  IconUser,
  IconWallet,
  IconZap,
  type IconProps,
} from '@/components/icons';
import { PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { MiniStat, StatCard } from '@/components/stat-card';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useSession } from '@/hooks/use-session';
import { formatUSDC, shortHash } from '@/lib/format';
import { getSession } from '@/lib/session';

/**
 * Tela de Dashboard — porta de `frontend/src/app/dashboard/page.tsx`.
 *
 * Substitui a muleta do menu, que apontava "Dashboard" para `/diagnostics`.
 *
 * Diverge do web em três pontos, todos declarados:
 *
 * 1. O bloco "Global Economy" do web é **número inventado** — `$1,240,500` de
 *    TVL, `12,450` usuários, `45,200 USDC` distribuídos e `1,120` campanhas
 *    estão hardcoded em `page.tsx:138`. Não portei. No lugar entra o mesmo
 *    recorte vindo de `/v1/traction/stats`, que é real e já estava ligado.
 *    Número fabricado ao lado de número real numa submissão avaliada por
 *    tração contamina os dois.
 *
 * 2. `UserStatsCard` lê o programa Anchor na Solana (`useXiaoLeeProgram`).
 *    Portar exigiria `@coral-xyz/anchor` e web3.js no React Native, para dado
 *    da era Solana que o pivô para Arc despriorizou. Fora.
 *
 * 3. O `ActivityFeed` do web mistura notificações com campanhas do usuário.
 *    No mobile as notificações têm tela própria, a um toque no sino, então
 *    aqui fica só a parte que ela não mostra: a participação em campanhas.
 */

/** Teto da lista pessoal — o resto vive na tela de Campaigns. */
const MAX_MINE = 5;

interface DashboardData {
  treasury: TreasuryBalance[];
  network: TractionSnapshot;
  /** `null` = sem sessão, ou a rota pessoal falhou — ver `fetchDashboard`. */
  mine: UserCampaignParticipation[] | null;
}

async function fetchDashboard(): Promise<DashboardData> {
  const session = await getSession();

  const [treasury, network, mine] = await Promise.all([
    getTreasury(),
    getTractionStats(),
    // O bloco pessoal não pode derrubar os públicos: a rota devolve 404 para
    // token de usuário que não está no banco, e sem o catch esse 404 apagaria
    // tesouraria e rede da tela — dois blocos que carregaram bem.
    session ? listMyCampaigns().catch(() => null) : Promise.resolve(null),
  ]);

  return { treasury, network, mine };
}

export default function DashboardScreen() {
  const colors = useTheme();
  const styles = useStyles();
  // Barra de gestos do Android come o fim da lista sem este inset.
  const insets = useSafeAreaInsets();
  const { hasSession } = useSession();
  const { data, error, loading, refreshing, reload } = useBackendData(fetchDashboard);

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}
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
        <PageHeading
          title="Dashboard"
          subtitle="Global metrics of the XiaoLee economy registered on Arc Testnet."
        />

        {error ? (
          <ErrorState title="Couldn't load the dashboard" message={error} onRetry={reload} />
        ) : null}

        {loading && !data ? <DashboardSkeleton /> : null}

        {data ? (
          <>
            <PortfolioHero balances={data.treasury} />
            <ChainsSection balances={data.treasury} />
            <NetworkLink network={data.network} />
            <MyCampaignsSection campaigns={data.mine} hasSession={hasSession} />
            <ProtocolSection />
            <ArchitectureSection />
          </>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

// ── Tesouraria ─────────────────────────────────────────────────────────────

/**
 * Marca de cada chain.
 *
 * Solana e Stellar usam o logo oficial, reduzido para 128px — largura
 * suficiente para um chip de 32pt até @4x sem inflar o bundle.
 *
 * O Arc, que é a chain da Circle, entra como marca **textual** e não como o
 * glifo `Ξ` que o web usa (`TreasuryCard.tsx:9`). Ao lado de dois logos de
 * verdade, um `Ξ` deixaria de ser lido como "símbolo genérico de EVM" e
 * passaria a ser lido como o logo do Arc — e `Ξ` é a marca do Ethereum. Texto
 * ninguém confunde com marca. Trocar por logo assim que a arte existir.
 */
const CHAIN: Record<TreasuryChain, { label: string; wordmark?: string; logo?: number }> = {
  arc: { label: 'Arc', wordmark: 'ARC' },
  solana: { label: 'Solana', logo: require('../../assets/images/chain-solana.png') },
  stellar: { label: 'Stellar', logo: require('../../assets/images/chain-stellar.png') },
};

/**
 * O número que a tela existe para mostrar.
 *
 * Ele era a última linha de um cartão, do mesmo tamanho das três que vinham
 * antes — a métrica principal sem hierarquia nenhuma, o mesmo problema que a
 * Traction tinha antes do herói.
 *
 * A linha de apoio conta **de quantas chains** o total veio, e isso não é
 * enfeite: com Solana desligada por flag e Stellar sem reportar saldo, somar
 * só o que respondeu e chamar de "total disponível" faria a tela apresentar o
 * saldo do Arc como se fosse o das três.
 */
function PortfolioHero({ balances }: { balances: TreasuryBalance[] }) {
  const reporting = balances.filter((item) => item.status === 'ok' && item.usdc != null);
  const total = reporting.reduce((sum, item) => sum + (item.usdc ?? 0), 0);

  // Com `ARC_SANDBOX=true` os clientes devolvem 1000.0 fixo sem tocar na chain
  // (`arc_client.py:141`, `solana_cctp.py:436`), então este total é stub, não
  // saldo. O backend avisa pelo campo `sandbox`; a tela precisa repetir o aviso
  // onde o número é lido, senão o maior valor da tela passa por dinheiro real.
  const sandbox = reporting.some((item) => item.sandbox);
  const coverage = `${reporting.length} of ${balances.length} chains`;

  return (
    <StatCard
      size="lg"
      Icon={IconWallet}
      label={sandbox ? 'USDC in portfolio · sandbox' : 'USDC in portfolio'}
      value={`$${formatUSDC(total)}`}
      sub={
        sandbox
          ? `Sandbox values, not real balances · ${coverage}`
          : `Across ${coverage} · Arc is the hub`
      }
    />
  );
}

function ChainsSection({ balances }: { balances: TreasuryBalance[] }) {
  return (
    <SectionCard title="Balance by chain" subtitle="CCTP bridges Solana and Stellar into Arc">
      {balances.map((item) => (
        <ChainRow key={item.chain} balance={item} />
      ))}
    </SectionCard>
  );
}

function ChainRow({ balance }: { balance: TreasuryBalance }) {
  const styles = useStyles();
  const chain = CHAIN[balance.chain];

  return (
    <View style={styles.chainRow}>
      <View style={styles.chainMark}>
        {chain.logo ? (
          // `contain` e não `cover`: as duas marcas têm proporções diferentes
          // (a da Solana é mais larga), e cortar logo de marca não se faz.
          <Image source={chain.logo} style={styles.chainLogo} contentFit="contain" />
        ) : (
          <Text style={styles.chainWordmark}>{chain.wordmark}</Text>
        )}
      </View>

      <View style={styles.flex}>
        <View style={styles.chainNameRow}>
          <Text style={styles.chainName}>{chain.label}</Text>
          {balance.chain === 'arc' ? <Text style={styles.hub}>hub</Text> : null}
        </View>
        {balance.address ? (
          <Text style={styles.chainAddress} numberOfLines={1}>
            {shortHash(balance.address)}
          </Text>
        ) : null}
      </View>

      {balance.status === 'ok' ? (
        <View style={styles.chainRight}>
          {/* Stellar responde ok e não manda saldo — o client não tem endpoint
              para isso. Um travessão aqui leria como zero ou como erro, e não
              é nenhum dos dois: é a chain não reportando. */}
          {balance.usdc != null ? (
            <Text style={styles.chainBalance}>${formatUSDC(balance.usdc)}</Text>
          ) : (
            <Text style={styles.chainUnreported}>Not reported</Text>
          )}
          {balance.sandbox ? <Text style={styles.sandbox}>sandbox</Text> : null}
        </View>
      ) : (
        <View
          style={[
            styles.chainBadge,
            balance.status === 'error' ? styles.chainBadgeError : styles.chainBadgeOff,
          ]}
        >
          <Text
            style={[
              styles.chainBadgeText,
              balance.status === 'error' ? styles.chainBadgeTextError : null,
            ]}
          >
            {balance.status === 'error' ? 'offline' : 'disabled'}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Rede ───────────────────────────────────────────────────────────────────

/**
 * Resumo da rede em uma linha, levando para a Traction.
 *
 * Aqui havia quatro `StatCard` com USDC liquidado, pagamentos e creators — que
 * é, número por número, a tela de Traction inteira, vinda do mesmo endpoint.
 * Ao substituir os valores inventados do web por dado real eu troquei uma
 * mentira por uma duplicação: quem tocasse em Dashboard e depois em Traction
 * veria os mesmos quatro números duas vezes.
 *
 * A Dashboard é a visão agregada e pessoal; a Traction é a prova pública. Uma
 * linha que resume e leva para lá guarda a informação sem repetir a tela.
 */
function NetworkLink({ network }: { network: TractionSnapshot }) {
  const colors = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const unit = network.total_payments === 1 ? 'payment' : 'payments';

  return (
    <Pressable
      onPress={() => router.push('/traction')}
      style={({ pressed }) => [styles.networkLink, pressed && styles.pressed]}
      accessibilityRole="link"
      accessibilityLabel="Network activity, open Traction"
    >
      <View style={styles.networkIcon}>
        <IconActivity size={16} color={colors.accent} />
      </View>

      <View style={styles.flex}>
        <Text style={styles.networkValue}>
          ${formatUSDC(network.total_usdc)} settled on the rail
        </Text>
        <Text style={styles.networkSub}>
          {network.total_payments} {unit} · {network.active_creators} active creators
        </Text>
      </View>

      <IconChevronRight size={16} color={colors.ink3} />
    </Pressable>
  );
}

// ── Campanhas do usuário ───────────────────────────────────────────────────

function MyCampaignsSection({
  campaigns,
  hasSession,
}: {
  campaigns: UserCampaignParticipation[] | null;
  hasSession: boolean;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const router = useRouter();

  if (!hasSession) {
    return (
      <SectionCard title="Your campaigns" subtitle="Participation tied to your connected wallet">
        <EmptyState
          Icon={IconUser}
          title="No wallet connected"
          text="Connect your wallet to see the campaigns you joined."
          action={<ConnectWalletButton />}
        />
      </SectionCard>
    );
  }

  if (campaigns === null) {
    return (
      <SectionCard title="Your campaigns" subtitle="Participation tied to your connected wallet">
        <EmptyState
          Icon={IconTarget}
          title="Couldn't read your participation"
          text="The rest of the dashboard is live — pull to refresh to try this block again."
        />
      </SectionCard>
    );
  }

  const verified = campaigns.filter(
    (item) => item.participation_status === 'tasks_verified',
  ).length;
  const claimed = campaigns.filter((item) => item.tasks_claimed).length;

  return (
    <SectionCard title="Your campaigns" subtitle="Joined, verified and rewarded">
      <View style={styles.strip}>
        <MiniStat Icon={IconTarget} label="Joined" value={String(campaigns.length)} />
        <MiniStat Icon={IconCheck} label="Verified" value={String(verified)} />
        <MiniStat Icon={IconGift} label="Rewarded" value={String(claimed)} />
      </View>

      {campaigns.length === 0 ? (
        <EmptyState
          Icon={IconRocket}
          title="You haven't joined any campaign"
          text="Explore the active campaigns and join to start earning."
        />
      ) : (
        campaigns.slice(0, MAX_MINE).map((item) => (
          <View key={item.id} style={styles.mineRow}>
            <View style={styles.flex}>
              <Text style={styles.mineName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.mineStatus}>
                {item.participation_status.replace(/_/g, ' ')}
              </Text>
            </View>
            <Text style={styles.mineReward}>
              {item.reward_per_participant} {item.reward_token}
            </Text>
          </View>
        ))
      )}

      {campaigns.length > MAX_MINE ? (
        <Text style={styles.more}>+{campaigns.length - MAX_MINE} more on the campaigns screen</Text>
      ) : null}

      <Pressable
        onPress={() => router.push('/campaigns')}
        hitSlop={Spacing.two}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        accessibilityRole="link"
      >
        <Text style={styles.linkText}>Go to campaigns</Text>
        <IconChevronRight size={13} color={colors.accent} />
      </Pressable>
    </SectionCard>
  );
}

// ── Blocos estáticos ───────────────────────────────────────────────────────

/** Valores de `locales/en.json` (`tokenomics.*`) — descrevem o trilho, não dado. */
const PROTOCOL = [
  ['Protocol', 'USDC (ERC-20)'],
  ['Network', 'Arc Testnet · Circle'],
  ['Settlement', '~$0.10 / nanopayment'],
  ['Rail', 'HTTP x402 · USDC'],
] as const;

function ProtocolSection() {
  const styles = useStyles();
  return (
    <SectionCard title="Payment protocol">
      {PROTOCOL.map(([label, value]) => (
        <View key={label} style={styles.protocolRow}>
          <Text style={styles.protocolLabel}>{label}</Text>
          <Text style={styles.protocolValue}>{value}</Text>
        </View>
      ))}
    </SectionCard>
  );
}

/**
 * Os quatro pilares do web. Ele usa ícones que o mobile não tem (cpu, shield,
 * wifi); mapeei para os mais próximos do conjunto daqui em vez de desenhar
 * quatro SVGs novos para um bloco decorativo.
 */
const PILLARS: { Icon: (p: IconProps) => React.ReactElement; label: string }[] = [
  { Icon: IconWallet, label: 'Wallet-first' },
  { Icon: IconSpark, label: 'Claude Agent' },
  { Icon: IconZap, label: 'x402' },
  { Icon: IconSwap, label: 'Circle W3S' },
];

function ArchitectureSection() {
  const colors = useTheme();
  const styles = useStyles();
  return (
    <SectionCard title="Decentralized architecture">
      <Text style={styles.archText}>
        Your Web2 identity (Twitter) is linked on-chain (Arc) securely, without centralized private
        keys.
      </Text>

      <View style={styles.pillars}>
        {PILLARS.map(({ Icon, label }) => (
          <View key={label} style={styles.pillar}>
            <Icon size={13} color={colors.ink3} />
            <Text style={styles.pillarText}>{label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.footer}>Arc Testnet · MVP 2.0 · XiaoLee Core</Text>
    </SectionCard>
  );
}

/**
 * Esqueleto da primeira carga. Alturas medidas contra o layout real — um
 * esqueleto de altura errada promete uma silhueta e entrega outra, e aí a tela
 * pula do mesmo jeito.
 */
function DashboardSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.skeleton} accessible accessibilityLabel="Loading dashboard">
      {SKELETON.map((height, index) => (
        // As alturas são posicionais e podem repetir, então o índice é a
        // identidade estável aqui.
        <Skeleton key={index} height={height} radius={Radius.lg} />
      ))}
    </View>
  );
}

/**
 * Uma altura por bloco da tela, medida contra o layout real.
 *
 * A primeira versão tinha três entradas para uma tela de seis blocos, e um
 * esqueleto curto demais é pior que nenhum: ele promete uma silhueta, entrega
 * outra, e a tela pula na hora em que o dado entra — que é justamente o que o
 * esqueleto existia para evitar. Se um bloco entrar ou sair daqui, esta lista
 * muda junto.
 */
const SKELETON = [
  152, // herói: cabeçalho + número de 48px + linha de apoio
  228, // saldo por chain: cabeçalho + três linhas
  64, // linha da rede
  232, // suas campanhas: cabeçalho + faixa de três + linhas
  132, // protocolo: cabeçalho + quatro linhas
  198, // arquitetura: texto + quatro pilares + rodapé
] as const;

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three - 4,
    paddingTop: Spacing.four,
    gap: Spacing.three - 4,
  },
  skeleton: { gap: Spacing.three - 4 },
  strip: { flexDirection: 'row', gap: Spacing.two + 2 },
  pressed: { opacity: 0.7 },

  // ── Linha da rede ──────────────────────────────────────────────────────
  networkLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.three - 4,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  networkIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  networkValue: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink },
  networkSub: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink2, marginTop: 1 },

  // ── Tesouraria ─────────────────────────────────────────────────────────
  chainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingVertical: Spacing.two - 2,
  },
  chainMark: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  // Menor que o chip: a marca precisa de respiro dentro dele, senão encosta
  // na borda e parece recortada.
  chainLogo: { width: 18, height: 18 },
  chainWordmark: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.5,
    color: colors.accent,
  },
  chainNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two - 3 },
  chainName: { fontFamily: Fonts.semibold, fontSize: 13, color: colors.ink },
  hub: {
    fontFamily: Fonts.bold,
    fontSize: 8,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.accent,
  },
  chainAddress: { fontFamily: Fonts.mono, fontSize: 10, color: colors.ink3, marginTop: 1 },
  chainRight: { alignItems: 'flex-end' },
  chainBalance: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink },
  chainUnreported: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink3 },
  sandbox: {
    fontFamily: Fonts.bold,
    fontSize: 8,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.warn,
    marginTop: 1,
  },
  chainBadge: {
    paddingHorizontal: Spacing.two - 2,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  chainBadgeOff: { backgroundColor: colors.bg },
  chainBadgeError: { backgroundColor: colors.dangerSoft },
  chainBadgeText: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  chainBadgeTextError: { color: colors.danger },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.two,
    marginTop: Spacing.two - 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalLabel: { fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink2 },
  totalValue: { fontFamily: Fonts.bold, fontSize: 15, color: colors.accent },

  // ── Campanhas do usuário ───────────────────────────────────────────────
  mineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
  },
  mineName: { fontFamily: Fonts.semibold, fontSize: 13, color: colors.ink },
  mineStatus: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink3,
    marginTop: 2,
  },
  mineReward: { fontFamily: Fonts.bold, fontSize: 12, color: colors.success },
  more: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: colors.ink3,
    textAlign: 'center',
    paddingTop: Spacing.one,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two - 3,
    paddingVertical: Spacing.two,
  },
  linkText: { fontFamily: Fonts.bold, fontSize: 12, color: colors.accent },

  // ── Protocolo ──────────────────────────────────────────────────────────
  protocolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  protocolLabel: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink3 },
  protocolValue: { fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink },

  // ── Arquitetura ────────────────────────────────────────────────────────
  archText: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, color: colors.ink2 },
  pillars: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two - 2 },
  pillar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 3,
    // Dois por linha: metade da largura menos metade do gap.
    width: '48%',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two - 2,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pillarText: { fontFamily: Fonts.semibold, fontSize: 11, color: colors.ink2 },
  footer: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.ink3,
    textAlign: 'center',
    paddingTop: Spacing.two,
    marginTop: Spacing.two - 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
}));
