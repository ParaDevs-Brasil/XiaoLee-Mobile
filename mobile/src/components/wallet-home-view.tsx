import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { UserCampaignParticipation } from '@/api/backend';
import { ConnectWalletButton, ErrorState, Skeleton } from '@/components/feedback';
import { IconChevronRight, IconUser } from '@/components/icons';
import { NetworkMismatchCard } from '@/components/network-badge';
import { ReceiptRow } from '@/components/receipt-row';
import { ReceiveSheet } from '@/components/receive-sheet';
import { PageHeading } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { WalletAddressCard } from '@/components/wallet-address-card';
import { WalletBalanceCard } from '@/components/wallet-balance-card';
import { WalletMockSwitcher } from '@/components/wallet-mock-switcher';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import type { CreatorWallet } from '@/hooks/use-creator-wallet';
import { ARC_NETWORK } from '@/lib/arc-network';
import { hasKnownSource, type WalletReceipt } from '@/lib/creator-wallet';
import { formatTokenAmount } from '@/lib/format';

/**
 * Corpo da tela de Wallet — a carteira do creator na Arc (rota em
 * `app/wallet/index.tsx`).
 *
 * A carteira é a embutida do Privy, criada no login social: o mesmo endereço
 * EVM de sempre, agora na Arc mainnet. A tela é **só leitura** — saldo,
 * endereço (copiar/QR) e o que entrou. Não há sacar nem enviar daqui; nenhum
 * toque nesta tela assina coisa alguma.
 *
 * Só props, nenhum hook de dado: a rota junta Privy, sessão e backend e passa
 * tudo pronto. Assim a tela inteira renderiza com dado de exemplo sem o
 * `PrivyProvider` em volta.
 *
 * As recompensas de campanha (`GET /campaigns/me`) são o que o XiaoLee ainda
 * deve ao creator, outra coisa do saldo — o que já foi pago está no saldo, o
 * que não foi ainda não existe on-chain. Por isso as duas nunca são somadas.
 */

export interface WalletHomeViewProps {
  wallet: CreatorWallet;
  hasSession: boolean;
  rewards: {
    data: UserCampaignParticipation[] | null;
    error: string | null;
    refreshing: boolean;
    reload: () => void;
  };
  /** Há conta Privy logada — mostra o "Sign out". */
  isConnected: boolean;
  onSignOut: () => void;
  onSeeAllReceipts: () => void;
  onOpenBreakdown: () => void;
}

/** Quantos recebimentos a home mostra antes do "See all". */
const RECENT_COUNT = 3;

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

/**
 * Uma linha por token, na ordem em que os tokens aparecem nas participações.
 * Nunca somado entre tokens — token de campanha de terceiro não tem cotação.
 */
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

export function WalletHomeView({
  wallet,
  hasSession,
  rewards,
  isConnected,
  onSignOut,
  onSeeAllReceipts,
  onOpenBreakdown,
}: WalletHomeViewProps) {
  const colors = useTheme();
  const styles = useStyles();
  // Barra de gestos do Android come o fim da lista sem este inset.
  const insets = useSafeAreaInsets();
  const [receiveOpen, setReceiveOpen] = useState(false);

  const showGuest = !hasSession && !wallet.isMock;
  // Saldo e recompensas vêm do mesmo backend: quando um cai, o outro quase
  // sempre caiu junto. Um botão refaz os dois.
  const retryAll = () => {
    wallet.reload();
    rewards.reload();
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.six + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={wallet.refreshing || rewards.refreshing}
            onRefresh={() => {
              wallet.reload();
              rewards.reload();
            }}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <PageHeading title="Wallet" subtitle="Your USDC on Arc, and where it came from." />

        <WalletMockSwitcher />

        {showGuest ? <GuestState /> : null}

        {!showGuest && !wallet.address ? wallet.addressLoading ? <BalanceSkeleton /> : <NoWallet /> : null}

        {!showGuest && wallet.address ? (
          <>
            {wallet.status === 'loading' ? <BalanceSkeleton /> : null}

            {/* O endereço continua embaixo do erro: ele é local, não depende
                da rede, e é justamente o que alguém pode precisar para receber. */}
            {wallet.status === 'error' ? (
              <ErrorState
                title="Couldn't load your balance"
                message={wallet.error ?? 'Something went wrong reaching Arc.'}
                onRetry={retryAll}
              />
            ) : null}

            {/* Saldo escondido, endereço não: ele é o mesmo em qualquer rede EVM
                e é o que a pessoa precisa para receber. */}
            {wallet.status === 'mismatch' && wallet.mismatch ? (
              <NetworkMismatchCard mismatch={wallet.mismatch} />
            ) : null}

            {wallet.stale ? (
              <Text style={styles.stale}>Couldn&apos;t refresh — showing your last known balance.</Text>
            ) : null}

            {wallet.status === 'ready' ? (
              <WalletBalanceCard
                balanceUsdc={wallet.balanceUsdc}
                receipts={wallet.receipts}
                isMock={wallet.isMock}
                onReceive={() => setReceiveOpen(true)}
                // Sem origem conhecida não há o que detalhar — ver `wallet-breakdown-view`.
                onDetails={wallet.receipts && hasKnownSource(wallet.receipts) ? onOpenBreakdown : undefined}
              />
            ) : null}

            <WalletAddressCard address={wallet.address} onShowQr={() => setReceiveOpen(true)} />

            {!ARC_NETWORK.isMainnet && !wallet.isMock ? <FaucetButton address={wallet.address} /> : null}

            {/* Sem nenhum recebimento o cartão de saldo já faz o convite —
                uma lista vazia embaixo dele só repetiria a mesma frase. */}
            {wallet.status === 'ready' && wallet.receipts?.length !== 0 ? (
              <RecentReceipts receipts={wallet.receipts} onSeeAll={onSeeAllReceipts} />
            ) : null}

            {wallet.status === 'loading' ? <Skeleton height={232} radius={Radius.lg} /> : null}
          </>
        ) : null}

        {/* Com o saldo já em erro, um segundo cartão vermelho para o mesmo
            backend fora do ar só duplicaria o aviso — o "Try again" de cima
            já refaz as recompensas também. */}
        {hasSession ? (
          <CampaignRewards
            campaigns={rewards.data}
            error={wallet.status === 'error' ? null : rewards.error}
            onRetry={rewards.reload}
          />
        ) : null}

        <WalletFooter isConnected={isConnected} onSignOut={onSignOut} />
      </ScrollView>

      {wallet.address ? (
        <ReceiveSheet visible={receiveOpen} address={wallet.address} onClose={() => setReceiveOpen(false)} />
      ) : null}
    </>
  );
}

/** Os últimos recebimentos, com saída para a lista completa. */
function RecentReceipts({ receipts, onSeeAll }: { receipts: WalletReceipt[] | null; onSeeAll: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const recent = receipts?.slice(0, RECENT_COUNT) ?? [];

  return (
    <SectionCard
      title="Recent payments"
      action={
        receipts && receipts.length > 0 ? (
          <Pressable
            onPress={onSeeAll}
            hitSlop={Spacing.two}
            style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="See all payments"
          >
            <Text style={styles.seeAllText}>See all</Text>
            <IconChevronRight size={14} sw={2.2} color={colors.ink2} />
          </Pressable>
        ) : undefined
      }
    >
      {receipts === null ? (
        <Text style={styles.quiet}>Couldn&apos;t load your payments. Pull down to try again.</Text>
      ) : (
        <View>
          {recent.map((item, i) => (
            <View key={item.id} style={i > 0 && styles.divider}>
              <ReceiptRow receipt={item} />
            </View>
          ))}
        </View>
      )}
    </SectionCard>
  );
}

/**
 * O que as campanhas devem ao creator, por token — o que ainda não virou
 * saldo. Some quando não há participação nenhuma: num creator novo, um cartão
 * de zeros só empurraria o que importa para baixo.
 */
function CampaignRewards({
  campaigns,
  error,
  onRetry,
}: {
  campaigns: UserCampaignParticipation[] | null;
  error: string | null;
  onRetry: () => void;
}) {
  // A mensagem do `apiFetch` sai em português; a Wallet é em inglês.
  if (error) {
    return (
      <ErrorState
        title="Couldn't load campaign rewards"
        message="The list of what campaigns owe you didn't load. Try again in a moment."
        onRetry={onRetry}
      />
    );
  }
  if (!campaigns || campaigns.length === 0) return null;

  const tallies = tallyByToken(campaigns);
  const claimable = campaigns.filter((item) => stageOf(item) === 'claimable').length;
  const pending = campaigns.filter((item) => stageOf(item) === 'pending').length;
  const status = [
    claimable > 0 ? `${claimable} ready to claim` : null,
    pending > 0 ? `${pending} in progress` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SectionCard title="Campaign rewards" subtitle={status || 'Everything claimed'}>
      {tallies.map((tally) => (
        <TokenRow key={tally.token} tally={tally} />
      ))}
    </SectionCard>
  );
}

function TokenRow({ tally }: { tally: TokenTally }) {
  const styles = useStyles();
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
 * Atalho pro faucet de testnet da Circle — só na testnet. A API deles
 * (`POST /v1/faucet/drips`) devolve 403 pra contas não upgradadas pra
 * mainnet, então em vez de um pedido de um toque, copiamos o endereço e
 * abrimos o faucet já pronto pro usuário colar.
 */
function FaucetButton({ address }: { address: string }) {
  const styles = useStyles();
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
 * Rodapé: sair da conta e o selo. Desconectar é a única saída dentro do app —
 * sem isto uma sessão presa só sai limpando os dados do aplicativo.
 */
function WalletFooter({ isConnected, onSignOut }: { isConnected: boolean; onSignOut: () => void }) {
  const styles = useStyles();
  return (
    <View style={styles.footer}>
      {isConnected ? (
        <Pressable
          onPress={onSignOut}
          style={({ pressed }) => [styles.disconnect, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.disconnectText}>Sign out</Text>
        </Pressable>
      ) : null}
      <Text style={styles.footerText}>View only · USDC on Arc · Secured by XiaoLee</Text>
    </View>
  );
}

/** Mesma silhueta do cartão de saldo, para a tela não pular quando o dado chega. */
function BalanceSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.skeletonCard} accessible accessibilityLabel="Loading wallet">
      <Skeleton height={26} width={120} radius={Radius.pill} />
      <Skeleton height={12} width={96} />
      <Skeleton height={56} width="62%" />
      <Skeleton height={10} radius={Radius.pill} />
      <Skeleton height={12} width="70%" />
    </View>
  );
}

/** Sessão sem carteira — raro com o gate de login, mas não pode virar tela branca. */
function NoWallet() {
  const styles = useStyles();
  return (
    <SectionCard title="No wallet yet" subtitle="Where your USDC lands">
      <View style={styles.guest}>
        <Text style={styles.guestText}>
          Your wallet is created when you sign in. Sign in again to finish setting it up.
        </Text>
        <ConnectWalletButton label="Sign in" />
      </View>
    </SectionCard>
  );
}

/**
 * Estado de convidado. Conectar acontece aqui mesmo — mandar "para o chat" era
 * mandar para uma tela onde o botão de conectar também não está à vista.
 */
function GuestState() {
  const colors = useTheme();
  const styles = useStyles();
  return (
    <SectionCard title="Your wallet" subtitle="Created when you sign in">
      <View style={styles.guest}>
        <View style={styles.guestIcon}>
          <IconUser size={22} color={colors.ink3} />
        </View>
        <Text style={styles.guestTitle}>You&apos;re not signed in</Text>
        <Text style={styles.guestText}>
          Sign in to see your USDC balance, your address and the payments you received.
        </Text>
        <ConnectWalletButton label="Sign in" />
      </View>
    </SectionCard>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three - 4,
    paddingTop: Spacing.four,
    gap: Spacing.three - 4,
  },
  pressed: { opacity: 0.7 },
  quiet: { fontFamily: Fonts.medium, fontSize: 13, color: colors.ink3, paddingVertical: Spacing.two },
  stale: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    color: colors.warn,
    textAlign: 'center',
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },

  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  seeAllText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink2 },

  skeletonCard: {
    gap: Spacing.three - 2,
    padding: Spacing.four - 4,
    borderRadius: Radius.xl,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },

  // ── Linha de token ─────────────────────────────────────────────────────
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
  },
  tokenMark: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tokenMarkText: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.4,
    color: colors.accent,
  },
  tokenName: { fontFamily: Fonts.semibold, fontSize: 13, color: colors.ink },
  tokenBreakdown: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink2, marginTop: 2 },
  tokenRight: { alignItems: 'flex-end' },
  tokenTotal: { fontFamily: Fonts.bold, fontSize: 14, color: colors.ink },
  tokenTotalLabel: {
    fontFamily: Fonts.bold,
    fontSize: 8,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.ink3,
    marginTop: 1,
  },

  faucet: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentSoft,
  },
  faucetText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.accent },

  // ── Rodapé ─────────────────────────────────────────────────────────────
  footer: { alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.three },
  disconnect: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    paddingHorizontal: Spacing.five,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  disconnectText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink2 },
  footerText: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.ink3,
    textAlign: 'center',
  },

  // ── Convidado ──────────────────────────────────────────────────────────
  guest: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four },
  guestIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  guestTitle: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.ink },
  guestText: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: colors.ink2,
    textAlign: 'center',
  },
}));
