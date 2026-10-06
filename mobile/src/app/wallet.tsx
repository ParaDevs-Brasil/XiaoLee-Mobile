import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getAddressBalance,
  listMyCampaigns,
  type UserCampaignParticipation,
} from '@/api/backend';
import { ConnectWalletSheet } from '@/components/connect-wallet-sheet';
import { EmptyState, ErrorState, ConnectWalletButton, Skeleton } from '@/components/feedback';
import {
  IconCheck,
  IconClock,
  IconGift,
  IconTarget,
  IconUser,
  IconWallet,
} from '@/components/icons';
import { PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { MiniStat, StatCard } from '@/components/stat-card';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useSession } from '@/hooks/use-session';
import { useWallet } from '@/hooks/use-wallet';
import { formatTokenAmount, formatUSDC } from '@/lib/format';
import { getSession } from '@/lib/session';
import { usePrivyWallet } from '@/lib/wallet';

/**
 * Tela de Wallet — destino da primeira linha do `ProfileMenu`, que até aqui não
 * levava a lugar nenhum.
 *
 * O número grande do topo (`WalletHero`) é o saldo USDC on-chain real da
 * carteira embutida do Privy (`GET /v1/arc/balance/{address}`) — o que o
 * usuário pode efetivamente gastar, não só o que já foi marcado como
 * resgatado em campanha. Sem carteira conectada ainda não há endereço para
 * consultar, e aí cai pro total resgatado por campanha (ver `WalletHero`).
 *
 * O resto da tela — `Rewards by token` — segue vindo de `GET /campaigns/me`:
 * token, valor por participante e estado de cada participação. `balances` do
 * dossiê de `GET /user/{id}` não é usado porque o backend devolve lista vazia
 * literal ali (`campaigns_routes.py:555`).
 *
 * O total por campanha é por token, nunca somado entre tokens. O web soma
 * `valueUSD`, um campo que o backend nunca preenche — somar USDC com um token
 * de campanha de terceiro precisaria de preço, e não há cotação para esses.
 */

/** O trilho do produto é USDC (ver `ARC_LEPTON_ARCHITECTURE.md`); o resto é token de campanha. */
const USDC = 'USDC';

/** Em que ponto da jornada está a recompensa de uma participação. */
type Stage = 'claimed' | 'claimable' | 'pending';

/**
 * `tasks_claimed` é o único estado terminal; `tasks_verified` é o que libera o
 * resgate (ver `UserCampaignParticipation` em `api/backend.ts`). Qualquer outro
 * valor de `participation_status` ainda não rendeu nada.
 */
function stageOf(item: UserCampaignParticipation): Stage {
  if (item.tasks_claimed) return 'claimed';
  if (item.participation_status === 'tasks_verified') return 'claimable';
  return 'pending';
}

interface TokenTally {
  token: string;
  claimed: number;
  claimable: number;
  pending: number;
}

/** Uma linha por token, na ordem em que os tokens aparecem nas participações. */
function tallyByToken(campaigns: UserCampaignParticipation[]): TokenTally[] {
  const byToken = new Map<string, TokenTally>();

  for (const item of campaigns) {
    // O token vem de campo livre do formulário de criação, então "usdc" e
    // "USDC" são a mesma coisa e não podem virar duas linhas.
    const token = item.reward_token.trim().toUpperCase() || '—';
    const tally = byToken.get(token) ?? { token, claimed: 0, claimable: 0, pending: 0 };
    tally[stageOf(item)] += item.reward_per_participant;
    byToken.set(token, tally);
  }

  return [...byToken.values()];
}

/**
 * Sem sessão não há o que buscar: a rota resolve o participante pelo `Bearer` e
 * responderia 401. Lista vazia deixa a tela mostrar o estado de convidado, que
 * é o correto — não ter entrado ainda não é erro.
 */
async function fetchRewards(): Promise<UserCampaignParticipation[]> {
  const session = await getSession();
  if (!session) return [];
  return listMyCampaigns();
}

export default function WalletScreen() {
  // Barra de gestos do Android come o fim da lista sem este inset.
  const insets = useSafeAreaInsets();
  const { hasSession } = useSession();
  const { address } = useWallet();
  const { data, error, loading, refreshing, reload } = useBackendData(fetchRewards);

  const campaigns = data ?? [];
  const tallies = tallyByToken(campaigns);
  const usdc = tallies.find((item) => item.token === USDC);
  const otherTokens = tallies.filter((item) => item.token !== USDC);

  const counts = {
    claimed: campaigns.filter((item) => stageOf(item) === 'claimed').length,
    claimable: campaigns.filter((item) => stageOf(item) === 'claimable').length,
    pending: campaigns.filter((item) => stageOf(item) === 'pending').length,
  };

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={reload}
            tintColor={Colors.light.accent}
            colors={[Colors.light.accent]}
          />
        }
      >
        <PageHeading
          title="Wallet"
          subtitle="Rewards you have earned across XiaoLee campaigns."
        />

        {/* Aparece mesmo com dado na tela: uma recarga que falhou em silêncio
            faria saldos velhos passarem por atuais. */}
        {error && hasSession ? (
          <ErrorState title="Couldn't load your wallet" message={error} onRetry={reload} />
        ) : null}

        {loading && !data ? <WalletSkeleton /> : null}

        {data && !hasSession ? <GuestState /> : null}

        {data && hasSession ? (
          <>
            <WalletHero key={address ?? 'no-wallet'} address={address} usdc={usdc} otherTokens={otherTokens} />

            <View style={styles.strip}>
              <MiniStat Icon={IconCheck} label="Claimed" value={`$${formatUSDC(usdc?.claimed ?? 0)}`} />
              <MiniStat Icon={IconGift} label="Claimable" value={String(counts.claimable)} />
              <MiniStat Icon={IconClock} label="Pending" value={String(counts.pending)} />
            </View>

            <SectionCard
              title="Rewards by token"
              subtitle="Never summed across tokens — campaign tokens have no price"
            >
              {tallies.length === 0 ? (
                <EmptyState
                  Icon={IconTarget}
                  title="No rewards yet"
                  text="Join a campaign and complete its tasks to start earning."
                />
              ) : (
                tallies.map((tally) => <TokenRow key={tally.token} tally={tally} />)
              )}
            </SectionCard>
          </>
        ) : null}

        {/* Fora do bloco de sessão: conectar carteira não depende de login. São
            coisas distintas — a sessão diz quem você é, a carteira diz para
            onde vai o USDC — e exigir a primeira para fazer a segunda tranca o
            usuário num fluxo que não precisa existir. */}
        <WalletConnection />
      </ScrollView>
    </ScreenShell>
  );
}

/**
 * Linha de apoio do herói.
 *
 * O número grande é só o USDC resgatado, então esta linha carrega o que ele
 * deixou de fora: o que ainda dá para resgatar, e que existem outros tokens.
 * As campanhas do produto pagam em USDC, mas `reward_token` é campo livre na
 * criação — sem esta linha, quem só participou de campanha de terceiro num
 * símbolo qualquer leria "$0.00" como "não ganhei nada".
 */
function heroSubLabel(usdc: TokenTally | undefined, others: TokenTally[]): string {
  const parts: string[] = [];

  const claimable = usdc?.claimable ?? 0;
  if (claimable > 0) parts.push(`$${formatUSDC(claimable)} ready to claim`);

  if (others.length > 0) {
    parts.push(others.length === 1 ? '1 other token below' : `${others.length} other tokens below`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'Settled on Arc Testnet';
}

/**
 * O número grande do topo. Saldo on-chain real quando há carteira conectada —
 * é o que o usuário pode efetivamente gastar, não só o que as campanhas já
 * marcaram como resgatado. Sem carteira ainda não há endereço para consultar,
 * então cai pro total resgatado por campanha como antes.
 */
function WalletHero({
  address,
  usdc,
  otherTokens,
}: {
  address: string | undefined;
  usdc: TokenTally | undefined;
  otherTokens: TokenTally[];
}) {
  const { data: balance, loading } = useBackendData(
    () => (address ? getAddressBalance(address) : Promise.resolve(null)),
    { pollMs: 5000 },
  );

  const value = !address
    ? `$${formatUSDC(usdc?.claimed ?? 0)}`
    : loading
      ? '—'
      : `$${formatUSDC(balance ?? 0)}`;

  return (
    <StatCard
      size="lg"
      Icon={IconWallet}
      label="USDC balance"
      value={value}
      sub={heroSubLabel(usdc, otherTokens)}
    />
  );
}

function TokenRow({ tally }: { tally: TokenTally }) {
  const total = tally.claimed + tally.claimable + tally.pending;

  return (
    <View style={styles.tokenRow}>
      <View style={styles.tokenMark}>
        <Text style={styles.tokenMarkText}>{tally.token.slice(0, 4)}</Text>
      </View>

      <View style={styles.flex}>
        <Text style={styles.tokenName}>{tally.token}</Text>
        <Text style={styles.tokenBreakdown}>
          {formatTokenAmount(tally.claimed)} claimed
          {tally.claimable > 0 ? ` · ${formatTokenAmount(tally.claimable)} claimable` : ''}
          {tally.pending > 0 ? ` · ${formatTokenAmount(tally.pending)} pending` : ''}
        </Text>
      </View>

      {/* O valor à direita é o total prometido pelas campanhas, não o saldo —
          por isso o rótulo diz "earned" e não "balance". */}
      <View style={styles.tokenRight}>
        <Text style={styles.tokenTotal}>{formatTokenAmount(total)}</Text>
        <Text style={styles.tokenTotalLabel}>earned</Text>
      </View>
    </View>
  );
}

/**
 * A carteira de payout — o endereço para onde o agente manda USDC.
 *
 * Separada das recompensas acima de propósito: elas são do usuário pela sessão,
 * a carteira é o destino do dinheiro. A carteira embutida do Privy
 * (`lib/wallet.tsx`) nasce direto no Arc — não existe mais o estado
 * "conectado, mas na chain errada" que o WalletConnect tinha.
 */
function WalletConnection() {
  const { address } = useWallet();
  const { disconnect } = usePrivyWallet();
  const [loginSheet, setLoginSheet] = useState(false);

  return (
    <SectionCard
      title={address ? 'Wallet connected' : 'No wallet connected'}
      subtitle="Where the agent sends your USDC"
    >
      {address ? (
        <>
          <View style={styles.connected}>
            <IconWallet size={16} color={Colors.light.success} />
            <Text style={styles.connectedAddress}>{shortAddress(address)}</Text>
          </View>

          {/* `key` no endereço: `useBackendData` refaz a busca quando a sessão
              muda, não quando o endereço muda — e o saldo depende do endereço.
              Remontar é o jeito barato de refazer sem duplicar o hook. */}
          <WalletBalance key={address} address={address} />

          <FaucetButton address={address} />

          {/* Desconectar é a única saída dentro do app: sem isto uma sessão
              presa só sai limpando os dados do aplicativo. */}
          <Pressable
            onPress={disconnect}
            style={({ pressed }) => [styles.disconnect, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.disconnectText}>Disconnect</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.noteText}>
            Connect a wallet on Arc to receive the USDC your campaign rewards pay out.
          </Text>
          <Pressable
            onPress={() => setLoginSheet(true)}
            style={({ pressed }) => [styles.guestButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.guestButtonText}>Connect Wallet</Text>
          </Pressable>
        </>
      )}

      <Text style={styles.footer}>Secured by XiaoLee · USDC · x402</Text>

      <ConnectWalletSheet visible={loginSheet} onClose={() => setLoginSheet(false)} />
    </SectionCard>
  );
}

/**
 * Atalho pro faucet de testnet da Circle — a API deles
 * (`POST /v1/faucet/drips`) devolve 403 pra contas não upgradadas pra
 * mainnet, então em vez de um pedido de um toque, copiamos o endereço e
 * abrimos o faucet já pronto pro usuário colar. `Arc Testnet` já vem
 * selecionado por padrão no dropdown deles.
 */
function FaucetButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function openFaucet() {
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    await WebBrowser.openBrowserAsync('https://faucet.circle.com/');
  }

  return (
    <Pressable
      onPress={openFaucet}
      style={({ pressed }) => [styles.faucet, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <Text style={styles.faucetText}>
        {copied ? 'Address copied — paste it in the faucet' : 'Get testnet USDC'}
      </Text>
    </Pressable>
  );
}

/**
 * Saldo USDC on-chain da carteira conectada.
 *
 * É outra coisa do que o card de cima, e por isso vive aqui embaixo: lá são as
 * recompensas que o XiaoLee deve ao usuário (`GET /campaigns/me`, atreladas à
 * sessão); aqui é o que a carteira dele de fato tem no Arc, lido no RPC. Somar
 * os dois seria mentira — o que foi pago já está no saldo, o que não foi ainda
 * não existe on-chain.
 *
 * Leitura pública: não exige sessão, o endereço já é público na chain. Falha
 * fica contida numa linha; o RPC do Arc cair não pode derrubar o card da
 * carteira nem esconder o botão de desconectar.
 */
function WalletBalance({ address }: { address: string }) {
  const { data, error, loading } = useBackendData(() => getAddressBalance(address), { pollMs: 5000 });

  if (loading) return <Text style={styles.balanceLoading}>Loading balance…</Text>;
  if (error || data === null) return <Text style={styles.balanceError}>Balance unavailable</Text>;

  return (
    <Text style={styles.balance}>
      {formatUSDC(data)} <Text style={styles.balanceUnit}>USDC on Arc</Text>
    </Text>
  );
}

/** Abrevia o endereço como o painel de perfil: começo e fim, meio elidido. */
function shortAddress(address: string): string {
  return address.length <= 16 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Estado de convidado. Conectar acontece aqui mesmo — mandar "para o chat" era
 * mandar para uma tela onde o botão de conectar também não está à vista: ele
 * mora no painel de perfil, atrás do avatar do header. Mesma escolha das
 * Notifications e das Transactions.
 */
function GuestState() {
  return (
    <SectionCard title="Your rewards" subtitle="Tied to your connected wallet">
      <View style={styles.guest}>
        <View style={styles.guestIcon}>
          <IconUser size={22} color={Colors.light.ink3} />
        </View>
        <Text style={styles.guestTitle}>No wallet connected</Text>
        <Text style={styles.guestText}>
          Connect your wallet to see the rewards you have earned from campaigns.
        </Text>
        <ConnectWalletButton />
      </View>
    </SectionCard>
  );
}

/**
 * Esqueleto da primeira carga. Alturas medidas contra o layout real — um
 * esqueleto de altura errada promete uma silhueta e entrega outra, e aí a tela
 * pula do mesmo jeito.
 */
function WalletSkeleton() {
  return (
    <View style={styles.skeleton} accessible accessibilityLabel="Loading wallet">
      <Skeleton height={152} radius={Radius.lg} />
      <View style={styles.strip}>
        <Skeleton height={92} radius={Radius.lg} style={styles.flex} />
        <Skeleton height={92} radius={Radius.lg} style={styles.flex} />
        <Skeleton height={92} radius={Radius.lg} style={styles.flex} />
      </View>
      <Skeleton height={168} radius={Radius.lg} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three - 4,
    paddingTop: Spacing.four,
    gap: Spacing.three - 4,
  },
  skeleton: { gap: Spacing.three - 4 },
  strip: { flexDirection: 'row', gap: Spacing.two + 2 },
  pressed: { opacity: 0.7 },

  // ── Linha de token ─────────────────────────────────────────────────────
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.bg,
  },
  tokenMark: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  tokenMarkText: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.4,
    color: Colors.light.accent,
  },
  tokenName: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.light.ink },
  tokenBreakdown: { fontFamily: Fonts.sans, fontSize: 11, color: Colors.light.ink2, marginTop: 2 },
  tokenRight: { alignItems: 'flex-end' },
  tokenTotal: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.light.ink },
  tokenTotalLabel: {
    fontFamily: Fonts.bold,
    fontSize: 8,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.light.ink3,
    marginTop: 1,
  },

  // ── Aviso de carteira ──────────────────────────────────────────────────
  noteText: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20, color: Colors.light.ink2 },
  connected: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two - 2,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.successSoft,
  },
  connectedAddress: { fontFamily: Fonts.bold, fontSize: 13, color: Colors.light.ink },
  balance: {
    fontFamily: Fonts.bold,
    fontSize: 18,
    color: Colors.light.ink,
    textAlign: 'center',
    marginTop: Spacing.two - 2,
  },
  balanceUnit: { fontFamily: Fonts.sans, fontSize: 11, color: Colors.light.ink2 },
  balanceLoading: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: Colors.light.ink2,
    textAlign: 'center',
    marginTop: Spacing.two - 2,
  },
  balanceError: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: Colors.light.ink2,
    textAlign: 'center',
    marginTop: Spacing.two - 2,
  },
  disconnect: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 34,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
    marginTop: Spacing.two - 2,
  },
  disconnectText: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.light.ink2 },
  faucet: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 34,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.accentSoft,
    marginTop: Spacing.two - 2,
  },
  faucetText: { fontFamily: Fonts.bold, fontSize: 12, color: Colors.light.accent },
  footer: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.light.ink3,
    textAlign: 'center',
    paddingTop: Spacing.two,
    marginTop: Spacing.two - 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light.border,
  },

  // ── Convidado ──────────────────────────────────────────────────────────
  guest: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four },
  guestIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.bg,
  },
  guestTitle: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.light.ink },
  guestText: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: Colors.light.ink2,
    textAlign: 'center',
  },
  guestButton: {
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accent,
  },
  guestButtonText: { fontFamily: Fonts.bold, fontSize: 13, color: Colors.light.card },
});
