import { useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  listArcTransfers,
  listMyCampaigns,
  listNotifications,
  type ArcTransfer,
  type NotificationItem,
  type UserCampaignParticipation,
} from '@/api/backend';
import { EmptyState, ErrorState, ConnectWalletButton, Skeleton } from '@/components/feedback';
import {
  IconChevronRight,
  IconClipboard,
  IconGift,
  IconSwap,
  IconUser,
  type IconProps,
} from '@/components/icons';
import { FAB_CLEARANCE, PageHeading, ScreenShell } from '@/components/screen-shell';
import { SectionCard } from '@/components/section-card';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useBackendData } from '@/hooks/use-backend-data';
import { useSession } from '@/hooks/use-session';
import { isOnChainTx, txExplorerUrl } from '@/lib/explorer';
import { formatTokenAmount, shortHash } from '@/lib/format';
import { getSession, getWallet } from '@/lib/session';

/**
 * Tela de Transactions — segundo destino do `ProfileMenu`.
 *
 * Porta `frontend/src/components/navbar/Transacoes.tsx` na anatomia (contadores,
 * abas, linhas de atividade), mas de novo **não na fonte de dados**, pelo mesmo
 * motivo da Wallet: o painel do web lê `swaps` e `transactions` do dossiê de
 * `GET /user/{id}`, que o backend devolve como listas vazias literais
 * (`campaigns_routes.py:558`). Portar aquilo daria uma tela vazia para sempre.
 *
 * O que existe de movimento real do usuário são duas coisas, e as duas têm
 * chave de junção:
 *
 *  1. **Resgates de campanha** — `GET /campaigns/me` marca `tasks_claimed` e
 *     guarda `claim_receipt_id`. O valor e o token vêm estruturados.
 *  2. **Eventos com assinatura** — `GET /v1/notifications/me` traz
 *     `related_signature` nas notificações originadas de pagamento, incluindo
 *     as transferências on-chain que o webhook do Helius registra.
 *
 * Duas armadilhas que este arquivo existe para desarmar:
 *
 * O resgate aparece **nas duas** fontes: ele grava a participação e uma
 * notificação com `related_signature = claim_receipt_id`
 * (`campaigns_routes.py:980`). Sem cruzar, todo resgate sairia duplicado.
 *
 * E o Helius grava **uma notificação por canal** — in_app, telegram e x, com o
 * mesmo `related_signature` (`helius_routes.py:152-245`). Sem deduplicar, uma
 * transferência sairia três vezes.
 *
 * É justamente essa dedução que separa esta tela da de Notifications, e evita
 * que ela seja a mesma lista com outro título: lá é **uma linha por entrega**,
 * com o status de cada canal e o botão de reconhecer; aqui é **uma linha por
 * movimento**, com valor e comprovante. Por isso o `status` da notificação não
 * aparece aqui: ele descreve a entrega da mensagem, não o dinheiro, e repeti-lo
 * faria a tela afirmar sobre o pagamento uma coisa que é sobre o aviso.
 *
 * Sem ordenação por tempo, e não por esquecimento: nem o schema de notificação
 * expõe `created_at` nem o resgate guarda hora. O backend devolve as
 * notificações em `id` desc, que é cronológico, e é a ordem que fica.
 */

type Tab = 'all' | 'rewards' | 'transfers';

/** Um movimento, já cruzado e deduplicado. */
interface Movement {
  key: string;
  kind: 'reward' | 'transfer';
  title: string;
  detail: string;
  /**
   * Só o resgate e as transferências do Arc trazem valor estruturado; o Helius
   * descreve em texto livre. `sign` distingue entrada de saída — resgate e
   * recebimento são sempre `+`, mas uma transferência mandada pelo próprio
   * usuário é dinheiro saindo, não entrando.
   */
  amount?: { value: number; token: string; sign: '+' | '-' };
  /** Recibo do resgate, assinatura de notificação, ou hash da transação. */
  reference?: string;
}

interface TransactionsData {
  claims: UserCampaignParticipation[];
  notifications: NotificationItem[];
  arcTransfers: ArcTransfer[];
}

/**
 * Sem sessão não há o que buscar: as duas rotas resolvem o usuário pelo
 * `Bearer` e responderiam 401. `null` deixa a tela mostrar o estado de
 * convidado, que é o correto — não ter entrado ainda não é erro.
 *
 * As duas chamadas sobem erro de propósito. Aqui não vale o `catch` que a
 * Dashboard usa: lá havia blocos públicos que precisavam sobreviver a uma rota
 * pessoal falhando; aqui as duas fontes são a tela inteira, e engolir a falha
 * mostraria "nenhuma transação" para quem tem transações.
 */
async function fetchTransactions(): Promise<TransactionsData | null> {
  const session = await getSession();
  if (!session) return null;

  // A sessão prova quem é o usuário; a wallet é uma leitura à parte — a
  // conexão viva do WalletConnect primeiro, o SecureStore como fallback de
  // reabertura, o mesmo acordo que `app/index.tsx` usa para mandar contexto
  // ao chat. Sem endereço não há o que perguntar ao `arc_transfers`, mas isso
  // não é erro: as outras duas fontes seguem valendo.
  const wallet = await getWallet();

  const [claims, notifications, arcTransfers] = await Promise.all([
    listMyCampaigns(),
    listNotifications(),
    wallet ? listArcTransfers(wallet.address).catch(() => []) : Promise.resolve([]),
  ]);
  return { claims, notifications, arcTransfers };
}

/**
 * Cruza as duas fontes numa lista de movimentos.
 *
 * Os resgates vêm primeiro porque são a fonte estruturada — deles sai valor e
 * token. O conjunto de recibos que eles produzem é o que filtra as notificações
 * espelho.
 */
function toMovements({ claims, notifications, arcTransfers }: TransactionsData): Movement[] {
  const claimed = claims.filter((item) => item.tasks_claimed);
  const receipts = new Set(
    claimed.map((item) => item.claim_receipt_id).filter((id): id is string => Boolean(id)),
  );

  const rewards: Movement[] = claimed.map((item) => ({
    key: `claim-${item.id}`,
    kind: 'reward',
    title: item.name,
    detail: 'Campaign reward claimed',
    amount: { value: item.reward_per_participant, token: item.reward_token, sign: '+' },
    reference: item.claim_receipt_id ?? undefined,
  }));

  const seen = new Set<string>();
  const transfers: Movement[] = [];

  for (const item of notifications) {
    const signature = item.related_signature;
    // Sem assinatura não é movimento, é recado — o lugar dele é a tela de
    // Notifications.
    if (!signature) continue;
    // O espelho do resgate, que já entrou acima com valor e token.
    if (receipts.has(signature)) continue;
    // Os irmãos de canal do mesmo evento.
    if (seen.has(signature)) continue;

    seen.add(signature);
    transfers.push({
      key: `tx-${item.id}`,
      kind: 'transfer',
      title: item.title,
      detail: item.body,
      reference: signature,
    });
  }

  // As transferências que o próprio usuário mandou pelo chat ("send N usdc
  // to...") — `related_signature` nunca cobre estas: o relay é EVM/Arc, o
  // Helius fala Solana. `seen` aqui é só para o caso de a mesma tx aparecer
  // duas vezes na paginação, não para cruzar com as outras fontes.
  for (const transfer of arcTransfers) {
    if (seen.has(transfer.tx_hash)) continue;
    seen.add(transfer.tx_hash);

    const counterpart = shortHash(transfer.direction === 'out' ? transfer.to_address : transfer.from_address);
    transfers.push({
      key: `arc-${transfer.tx_hash}`,
      kind: 'transfer',
      title: transfer.direction === 'out' ? 'USDC sent' : 'USDC received',
      detail: transfer.direction === 'out' ? `To ${counterpart}` : `From ${counterpart}`,
      amount: { value: transfer.amount_usdc, token: 'USDC', sign: transfer.direction === 'out' ? '-' : '+' },
      reference: transfer.tx_hash,
    });
  }

  return [...rewards, ...transfers];
}

export default function TransactionsScreen() {
  const colors = useTheme();
  const styles = useStyles();
  // Barra de gestos do Android come o fim da lista sem este inset.
  const insets = useSafeAreaInsets();
  const { hasSession } = useSession();
  const { data, error, loading, refreshing, reload } = useBackendData(fetchTransactions);
  const [tab, setTab] = useState<Tab>('all');

  const movements = data ? toMovements(data) : [];
  const counts = {
    all: movements.length,
    rewards: movements.filter((item) => item.kind === 'reward').length,
    transfers: movements.filter((item) => item.kind === 'transfer').length,
  };

  const visible =
    tab === 'all'
      ? movements
      : movements.filter((item) => (tab === 'rewards' ? item.kind === 'reward' : item.kind === 'transfer'));

  return (
    <ScreenShell>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE + insets.bottom }]}
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
        {/* A linha de apoio diz o que o usuário tem, não como a tela funciona.
            A primeira versão dizia "one row per event", que descreve a
            deduplicação daqui — informação minha, não dele. */}
        <PageHeading
          title="Transactions"
          subtitle="Rewards you claimed and on-chain activity for your account."
        />

        {/* Aparece mesmo com lista na tela: uma recarga que falhou em silêncio
            faria um extrato incompleto passar por completo. */}
        {error && hasSession ? (
          <ErrorState title="Couldn't load your transactions" message={error} onRetry={reload} />
        ) : null}

        {loading && !data ? <TransactionsSkeleton /> : null}

        {data === null && !loading ? <GuestState /> : null}

        {data ? (
          <>
            {/* As abas carregam a contagem, então não há faixa de métricas
                acima delas. O web tem as duas coisas — uma linha de três
                contadores e abas que repetem os mesmos três números —, mas ele
                é um modal largo; num celular viram duas fileiras iguais,
                empilhadas, comendo a altura de uma tela que é uma lista. */}
            <TabBar current={tab} counts={counts} onChange={setTab} />

            <SectionCard title="Activity" subtitle="Newest first">
              {visible.length === 0 ? (
                <EmptyState Icon={emptyIcon(tab)} title={emptyTitle(tab)} text={emptyText(tab)} />
              ) : (
                visible.map((movement) => <MovementRow key={movement.key} movement={movement} />)
              )}
            </SectionCard>
          </>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

function TabBar({
  current,
  counts,
  onChange,
}: {
  current: Tab;
  counts: Record<Tab, number>;
  onChange: (next: Tab) => void;
}) {
  const styles = useStyles();
  // "On-chain" e não "Transfers": o webhook registra o `event_type` que vier
  // (`helius_routes.py:161`), então nem todo evento é transferência. O rótulo
  // precisa cobrir o que a aba realmente contém.
  const tabs: { id: Tab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'rewards', label: 'Rewards' },
    { id: 'transfers', label: 'On-chain' },
  ];

  return (
    <View style={styles.tabBar}>
      {tabs.map(({ id, label }) => {
        const active = current === id;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            style={[styles.tab, active && styles.tabActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${label}, ${counts[id]}`}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
            {counts[id] > 0 ? (
              <View style={[styles.tabBadge, active && styles.tabBadgeActive]}>
                <Text style={[styles.tabBadgeText, active && styles.tabBadgeTextActive]}>
                  {counts[id]}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Abre a transação no explorer da Arc — mesmo padrão de `app/traction.tsx`. */
function openTx(tx: string) {
  WebBrowser.openBrowserAsync(txExplorerUrl(tx)).catch(() => {});
}

function MovementRow({ movement }: { movement: Movement }) {
  const colors = useTheme();
  const styles = useStyles();
  const reward = movement.kind === 'reward';
  // Recibo de resgate e assinatura Solana do Helius não são hash de transação
  // EVM — só um `tx_hash` do relay do Arc bate no formato e vira link.
  const linkable = Boolean(movement.reference && isOnChainTx(movement.reference));

  const reference = movement.reference ? (
    <View style={styles.reference}>
      <View style={styles.referenceText}>
        <Text style={styles.referenceLabel}>{reward ? 'Receipt' : linkable ? 'Transaction' : 'Signature'}</Text>
        <Text style={styles.referenceValue} numberOfLines={1}>
          {movement.reference}
        </Text>
      </View>
      {linkable ? <IconChevronRight size={12} color={colors.ink3} /> : null}
    </View>
  ) : null;

  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, reward ? styles.rowIconReward : styles.rowIconTransfer]}>
        {reward ? (
          <IconGift size={16} color={colors.accent} />
        ) : (
          <IconSwap size={16} color={colors.ink2} />
        )}
      </View>

      <View style={styles.flex}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {movement.title}
        </Text>
        <Text style={styles.rowDetail} numberOfLines={2}>
          {movement.detail}
        </Text>

        {linkable ? (
          <Pressable
            onPress={() => openTx(movement.reference!)}
            style={({ pressed }) => pressed && styles.pressed}
            accessibilityRole="link"
            accessibilityLabel={`${movement.title} — open the transaction in the Arc explorer`}
          >
            {reference}
          </Pressable>
        ) : (
          reference
        )}
      </View>

      {movement.amount ? (
        <View style={styles.amountBox}>
          <Text style={[styles.amount, movement.amount.sign === '-' && styles.amountOut]}>
            {movement.amount.sign}
            {formatTokenAmount(movement.amount.value)}
          </Text>
          <Text style={styles.amountToken}>{movement.amount.token}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Vazio por aba — três textos e não um genérico, porque cada aba pede uma ação
 * diferente de quem está lendo. Onde há o que fazer, o texto diz o que fazer;
 * na aba on-chain não há, então ele explica o que vai aparecer ali em vez de
 * inventar uma ação que o usuário não controla.
 */
function emptyIcon(tab: Tab): (p: IconProps) => React.ReactElement {
  if (tab === 'rewards') return IconGift;
  if (tab === 'transfers') return IconSwap;
  return IconClipboard;
}

function emptyTitle(tab: Tab): string {
  if (tab === 'rewards') return 'No rewards claimed yet';
  if (tab === 'transfers') return 'No on-chain activity yet';
  return 'Nothing here yet';
}

function emptyText(tab: Tab): string {
  if (tab === 'rewards') {
    return 'Finish a campaign’s tasks, claim the reward, and the receipt lands here.';
  }
  if (tab === 'transfers') {
    return 'Transactions involving your account appear here.';
  }
  return 'Claim a campaign reward to start your history.';
}

/**
 * Estado de convidado. Conectar acontece aqui mesmo — mandar para o chat era
 * mandar para uma tela onde o botão de conectar também não está à vista.
 */
function GuestState() {
  const colors = useTheme();
  const styles = useStyles();
  return (
    <SectionCard title="Your activity" subtitle="Tied to your connected wallet">
      <View style={styles.guest}>
        <View style={styles.guestIcon}>
          <IconUser size={22} color={colors.ink3} />
        </View>
        <Text style={styles.guestTitle}>No wallet connected</Text>
        <Text style={styles.guestText}>
          Connect your wallet to see the rewards you claimed and the events signed for you.
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
function TransactionsSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.skeleton} accessible accessibilityLabel="Loading transactions">
      {/* Barra de abas, depois o cartão da lista — a silhueta exata da tela
          pronta. Se um bloco entrar ou sair acima, estas alturas mudam junto. */}
      <Skeleton height={46} radius={Radius.lg} />
      <Skeleton height={232} radius={Radius.lg} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three - 4,
    paddingTop: Spacing.four,
    gap: Spacing.three - 4,
  },
  skeleton: { gap: Spacing.three - 4 },
  pressed: { opacity: 0.7 },

  // ── Abas ───────────────────────────────────────────────────────────────
  // Três rótulos curtos cabem na largura, então não há scroller aqui — ao
  // contrário da Campaigns, onde as abas dividem a linha com o botão de criar.
  tabBar: {
    flexDirection: 'row',
    gap: Spacing.one,
    padding: Spacing.one + 2,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two - 3,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
  },
  tabActive: { backgroundColor: colors.accentFill },
  tabText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.ink3 },
  tabTextActive: { color: colors.onAccent },
  tabBadge: {
    paddingHorizontal: Spacing.two - 3,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentSoft,
  },
  // Translúcido sobre o acento, como o `bg-white/25` do web.
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.28)' },
  tabBadgeText: { fontFamily: Fonts.bold, fontSize: 10, color: colors.accent },
  tabBadgeTextActive: { color: colors.onAccent },

  // ── Linha de movimento ─────────────────────────────────────────────────
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two + 2,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowIconReward: { backgroundColor: colors.accentSoft },
  rowIconTransfer: { backgroundColor: colors.card },
  rowTitle: { fontFamily: Fonts.semibold, fontSize: 13, color: colors.ink },
  rowDetail: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: colors.ink2, marginTop: 1 },

  reference: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.two - 2,
    padding: Spacing.two - 2,
    borderRadius: Radius.sm,
    backgroundColor: colors.card,
  },
  referenceText: { flex: 1, gap: 1 },
  referenceLabel: {
    fontFamily: Fonts.bold,
    fontSize: 8,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  referenceValue: { fontFamily: Fonts.mono, fontSize: 10, color: colors.ink2 },

  amountBox: { alignItems: 'flex-end' },
  amount: { fontFamily: Fonts.bold, fontSize: 14, color: colors.success },
  amountOut: { color: colors.ink },
  amountToken: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.5,
    color: colors.ink3,
    marginTop: 1,
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
