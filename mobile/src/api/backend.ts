import { ApiError, apiFetch } from '@/api/client';

/**
 * Chamadas tipadas do backend. Os tipos espelham os response models do
 * FastAPI — ver `backend/server/app.py`, `backend/server/schemas.py` e
 * `backend/server/campaigns_routes.py`.
 *
 * Só o que a tela de diagnóstico precisa está aqui; chat, agente e
 * notificações entram conforme as telas forem construídas.
 */

/** `GET /health` — `backend/server/app.py` */
export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  environment: string;
  solana_cluster: string;
  gemini_enabled: boolean;
}

/** Item do feed de traction — `backend/server/metrics.py::record_payment_settled` */
export interface PaymentEvent {
  intent_id: string;
  amount: number;
  creator: string;
  tx: string;
  ts: string;
  latency_ms: number;
}

/** `GET /v1/traction/stats` — `backend/server/schemas.py::TractionSnapshot` */
export interface TractionSnapshot {
  total_usdc: number;
  total_payments: number;
  active_creators: number;
  registered_creators: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  feed: PaymentEvent[];
}

/** `GET /campaigns` — `backend/server/campaigns_routes.py` */
export interface Campaign {
  id: number;
  name: string;
  description: string;
  campaign_type: string;
  completed_participants: number;
  created_at: string;
  creator_twitter_user_id: string;
  max_participants: number;
  profile_to_follow: string | null;
  reward_per_participant: number;
  reward_pool: number;
  reward_token: string;
  status: string;
  tweet_id_to_engage: string | null;
}

export interface CampaignsResponse {
  success: boolean;
  campaigns: Campaign[];
}

/** `POST /auth/session` — `backend/server/campaigns_routes.py::auth_session` */
export interface SessionResponse {
  session_id: string;
  twitter_user_id: string;
  username: string;
  address: string;
}

/**
 * Troca o ID token do Firebase por uma sessão do backend.
 *
 * O backend confere a assinatura do token contra o JWKS do Google antes de
 * emitir a sessão — por isso só o token vai no corpo. Mandar `address`/`email`
 * daqui não teria efeito: a rota ignora o corpo como fonte de identidade
 * (é o furo que ela substitui, ver `/auth/google/login`).
 */
export function loginWithFirebase(idToken: string): Promise<SessionResponse> {
  return apiFetch<SessionResponse>('/auth/session', {
    method: 'POST',
    json: { provider: 'firebase', id_token: idToken },
    skipAuth: true,
  });
}

/**
 * Troca o access token do Privy (`getAccessToken()`) por uma sessão do backend.
 * Mesmo contrato de `loginWithFirebase`: só o token vai no corpo.
 */
export function loginWithPrivy(accessToken: string): Promise<SessionResponse> {
  return apiFetch<SessionResponse>('/auth/session', {
    method: 'POST',
    json: { provider: 'privy', id_token: accessToken },
    skipAuth: true,
  });
}

/** `POST /chat` — `backend/server/app.py::chat_compat` */
export interface ChatResponse {
  /** O backend devolve uma lista de blocos; hoje só `type: "text"` é usado. */
  response: { type: string; content: string }[];
  intent: { action: string; confidence: number; entities: Record<string, unknown> };
  execution: Record<string, unknown>;
  code: string | null;
  /** Nome da animação a tocar — ver `animationFromBackend`. Pode vir null. */
  animations: string | null;
  /** Sessão em que a mensagem foi gravada — sempre presente na resposta. */
  session_id?: number;
}

export interface ChatRequest {
  message: string;
  /** Endereço de payout, quando há carteira conectada. */
  wallet_address?: string;
  wallet_chain?: string;
  /** Sessão de chat ativa — omitido, o backend cria uma nova na primeira mensagem. */
  session_id?: number;
}

/**
 * Manda a mensagem para o agente.
 *
 * Funciona sem sessão — o backend trata como `web_anonymous`. Com sessão, o
 * `Bearer` é injetado pelo `apiFetch` e o agente responde no contexto do
 * usuário (saldo, campanhas, histórico).
 */
export function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  return apiFetch<ChatResponse>('/chat', {
    method: 'POST',
    // `platform: "web"` de propósito, e não "mobile": o backend ramifica em
    // `platform` para montar o prompt (`_wallet_ctx`, `_build_agentic_system_prompt`),
    // e só "web", "telegram" e "x" têm caminho escrito e testado. Mandar um
    // valor novo daqui criaria um comportamento que ninguém validou — o mobile
    // é a mesma experiência do app web, então usa o mesmo contexto.
    // Trocar para "mobile" só depois que o backend tratar o valor explicitamente.
    json: { ...request, platform: 'web' },
    // Timeout maior: a resposta depende de uma chamada a LLM, e um turno com
    // tool-calling (ex: criar campanha) é vários round-trips ao Claude em
    // sequência, não um só — 60s já se mostrou curto demais numa resposta
    // mais lenta da IA.
    timeoutMs: 90_000,
  });
}

/** `GET/POST /v1/chat/sessions`, `GET /v1/chat/sessions/{id}/messages` — `backend/server/routes/chat_sessions_routes.py` */
export interface ChatSessionSummary {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionMessage {
  role: string;
  content: string;
  time: string;
}

export function listChatSessions(): Promise<ChatSessionSummary[]> {
  return apiFetch<ChatSessionSummary[]>('/v1/chat/sessions');
}

export function createChatSession(): Promise<ChatSessionSummary> {
  return apiFetch<ChatSessionSummary>('/v1/chat/sessions', { method: 'POST' });
}

export function getChatSessionMessages(id: number): Promise<ChatSessionMessage[]> {
  return apiFetch<ChatSessionMessage[]>(`/v1/chat/sessions/${id}/messages`);
}

/** `POST /auth/wallet` — `backend/server/campaigns_routes.py::link_wallet` */
export interface WalletLinkResponse {
  address: string;
  chain: string;
  twitter_user_id: string;
}

/**
 * Vincula o endereço de payout ao usuário da sessão.
 *
 * Exige sessão: o backend tira o dono do `Bearer`, nunca do corpo. A rota
 * antiga (`POST /user/{user_id}/wallet`) aceitava o alvo pela URL sem
 * autenticação, o que deixava reivindicar o payout de outro usuário.
 */
export function linkWallet(address: string, chain = 'arc'): Promise<WalletLinkResponse> {
  return apiFetch<WalletLinkResponse>('/auth/wallet', {
    method: 'POST',
    json: { address, chain },
  });
}

/** Rota pública — não exige sessão. */
export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health', { skipAuth: true });
}

/** Rota pública — é o painel que o júri abre. */
export function getTractionStats(): Promise<TractionSnapshot> {
  return apiFetch<TractionSnapshot>('/v1/traction/stats', { skipAuth: true });
}

/** Rota pública — a lista de campanhas não filtra por usuário. */
export function listCampaigns(): Promise<CampaignsResponse> {
  return apiFetch<CampaignsResponse>('/campaigns', { skipAuth: true });
}

/** `POST /campaigns/create` — `backend/server/campaigns_routes.py::create_campaign` */
export interface CreateCampaignRequest {
  title: string;
  description: string;
  /** `airdrop` | `engagement` | `referral` — os valores do select do web. */
  campaign_type: string;
  profile_to_follow?: string;
  tweet_id_to_engage?: string;
  reward_token: string;
  reward_per_participant: number;
  max_participants: number;
}

export interface CreateCampaignResponse {
  success: boolean;
  message: string;
  campaign: Campaign;
}

/**
 * Cria uma campanha. **Exige sessão**: a rota resolve o criador a partir do
 * `Bearer` (`_resolve_user`), então esta é a única chamada de campanha sem
 * `skipAuth`.
 *
 * `reward_pool` não vai no corpo de propósito — o backend o calcula como
 * `reward_per_participant * max_participants`, e mandar daqui abriria espaço
 * para os dois valores discordarem.
 */
export function createCampaign(request: CreateCampaignRequest): Promise<CreateCampaignResponse> {
  return apiFetch<CreateCampaignResponse>('/campaigns/create', {
    method: 'POST',
    json: request,
  });
}

/**
 * Item de `GET /v1/notifications/me` — `backend/server/notifications_routes.py::NotificationResponse`
 *
 * Repare que **não há timestamp**: o schema do backend não expõe `created_at`,
 * mesmo o modelo tendo a coluna. O tipo do web declara o campo, mas ele nunca
 * chega — então esta tela ordena por `id` (o backend já devolve desc) e não
 * mostra "há quanto tempo".
 */
export interface NotificationItem {
  id: number;
  channel: string;
  title: string;
  body: string;
  /** `delivered` depois do ack; qualquer outro valor conta como pendente. */
  status: string;
  related_signature: string | null;
  metadata: Record<string, unknown>;
}

interface NotificationsResponse {
  success: boolean;
  notifications: NotificationItem[];
}

export interface AckResponse {
  success: boolean;
  notification_id: number;
  status: string;
}

/**
 * `GET /v1/notifications/me` — **exige sessão**: a rota resolve o usuário pelo
 * `Bearer` e responde 401 sem ele.
 */
export async function listNotifications(): Promise<NotificationItem[]> {
  const response = await apiFetch<NotificationsResponse>('/v1/notifications/me');

  // O corpo traz um `success` além do status HTTP. Hoje o backend sempre manda
  // `true`, mas tratar `false` como lista vazia esconderia uma falha atrás de
  // um estado vazio legítimo — melhor errar alto, como o web faz.
  if (!response.success) {
    throw new ApiError('The backend could not read your notifications', null, false);
  }

  return response.notifications ?? [];
}

/** `POST /v1/notifications/{id}/ack` — marca como `delivered`. */
export function ackNotification(id: number): Promise<AckResponse> {
  return apiFetch<AckResponse>(`/v1/notifications/${id}/ack`, { method: 'POST' });
}

/**
 * Tesouraria por chain, com o Arc como hub — `frontend/src/hooks/useTreasury.ts`.
 *
 *   GET /v1/arc/wallet/balance            (`server/routes/arc_routes.py:99`)
 *   GET /v1/cctp/treasury/{chain}/balance (`server/routes/cctp_routes.py:44`)
 */
export type TreasuryChain = 'arc' | 'solana' | 'stellar';

/** `disabled` não é falha: é a flag da chain desligada no backend. */
export type TreasuryStatus = 'ok' | 'disabled' | 'error';

export interface TreasuryBalance {
  chain: TreasuryChain;
  status: TreasuryStatus;
  /** Stellar não expõe saldo no client, então vem `null` mesmo com status ok. */
  usdc: number | null;
  address?: string;
  sandbox?: boolean;
}

interface BalancePayload {
  usdc_balance?: number;
  sandbox?: boolean;
  address?: string;
}

/**
 * `GET /v1/arc/balance/{address}` — saldo USDC on-chain de um endereço qualquer,
 * lido direto no RPC do Arc (`server/routes/arc_routes.py:336`).
 *
 * Não confundir com `/v1/arc/wallet/balance`, que é a tesouraria do agente. Este
 * é o saldo da carteira do usuário, e é leitura pública: não exige sessão, o
 * endereço já é público na chain.
 */
export async function getAddressBalance(address: string): Promise<number | null> {
  const payload = await apiFetch<BalancePayload>(`/v1/arc/balance/${address}`);
  return payload.usdc_balance ?? null;
}

/**
 * `GET /v1/arc/usdc/transfers/{address}` — transferências USDC relayadas
 * (`relay-authorization`, o "send N usdc to..." do chat) que envolvem esse
 * endereço, enviadas ou recebidas (`server/routes/arc_routes.py`).
 *
 * Mesma natureza pública de `getAddressBalance`: quem prova o envio é a
 * assinatura EIP-3009 no momento do relay, não uma sessão aqui.
 */
export interface ArcTransfer {
  tx_hash: string;
  from_address: string;
  to_address: string;
  amount_usdc: number;
  direction: 'in' | 'out';
  created_at: string;
}

export async function listArcTransfers(address: string): Promise<ArcTransfer[]> {
  return apiFetch<ArcTransfer[]>(`/v1/arc/usdc/transfers/${address}`);
}

const TREASURY_CHAINS: TreasuryChain[] = ['arc', 'solana', 'stellar'];

async function fetchChainBalance(chain: TreasuryChain): Promise<TreasuryBalance> {
  const path = chain === 'arc' ? '/v1/arc/wallet/balance' : `/v1/cctp/treasury/${chain}/balance`;

  try {
    const payload = await apiFetch<BalancePayload>(path);
    return {
      chain,
      status: 'ok',
      usdc: payload.usdc_balance ?? null,
      address: payload.address,
      sandbox: payload.sandbox,
    };
  } catch (err) {
    // 503 é a chain desligada por flag (`SOLANA_CCTP_ENABLED` etc.), não uma
    // falha — vira badge na tela em vez de derrubar o cartão inteiro.
    const disabled = err instanceof ApiError && err.status === 503;
    return { chain, status: disabled ? 'disabled' : 'error', usdc: null };
  }
}

/**
 * As três chains em paralelo. Cada uma resolve o próprio status, então uma
 * chain fora do ar não apaga o saldo das outras.
 */
export function getTreasury(): Promise<TreasuryBalance[]> {
  return Promise.all(TREASURY_CHAINS.map(fetchChainBalance));
}

/**
 * `GET /v1/arc/chain-config` — parâmetros do Arc no formato que a carteira
 * espera em `wallet_switchEthereumChain` / `wallet_addEthereumChain`.
 *
 * O `rpcUrls` aponta para o proxy do backend (`/v1/arc/rpc`), não para o RPC
 * autenticado do Canteen: a carteira fala com o RPC direto, e a URL com token
 * não é utilizável fora do servidor (ver a docstring da rota).
 */
export interface ArcChainConfig {
  chainIdHex: string;
  chainId: number;
  chainName: string;
  rpcUrls: string[];
  blockExplorerUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

export function getArcChainConfig(): Promise<ArcChainConfig> {
  return apiFetch<ArcChainConfig>('/v1/arc/chain-config');
}

/**
 * `GET /v1/arc/gas-fees` — fee EIP-1559 lido do RPC do Arc.
 *
 * Existe porque a carteira não consegue estimar fee sozinha num testnet custom:
 * sem estes valores explícitos a MetaMask mostra "Network fee: Unavailable" e
 * não libera a assinatura.
 */
export interface ArcGasFees {
  maxFeePerGasHex: string;
  maxPriorityFeePerGasHex: string;
}

export function getArcGasFees(): Promise<ArcGasFees> {
  return apiFetch<ArcGasFees>('/v1/arc/gas-fees');
}

/**
 * `GET /v1/arc/usdc/authorization-domain` — domínio EIP-712 do USDC do Arc.
 *
 * Vem do backend, que lê `name()`/`version()` on-chain: qualquer campo errado
 * aqui produz uma assinatura que o contrato rejeita sem dizer o motivo.
 */
export interface UsdcAuthorizationDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export function getUsdcAuthorizationDomain(): Promise<UsdcAuthorizationDomain> {
  return apiFetch<UsdcAuthorizationDomain>('/v1/arc/usdc/authorization-domain');
}

/**
 * `POST /v1/arc/usdc/relay-authorization` — o backend submete no Arc a
 * transferência que o usuário autorizou por assinatura, pagando o gas.
 *
 * É o que dispensa a carteira de estar na rede Arc: assinar typed data funciona
 * em qualquer chain, ao contrário de `eth_sendTransaction`.
 */
export interface RelayAuthorizationRequest {
  from_address: string;
  to_address: string;
  value: number;
  valid_after: number;
  valid_before: number;
  nonce: string;
  signature: string;
}

export interface RelayAuthorizationResponse {
  tx_hash: string;
  confirmed: boolean;
  gas_used: number;
  sandbox: boolean;
}

export function relayUsdcAuthorization(
  request: RelayAuthorizationRequest,
): Promise<RelayAuthorizationResponse> {
  return apiFetch<RelayAuthorizationResponse>('/v1/arc/usdc/relay-authorization', {
    method: 'POST',
    json: request,
    skipAuth: true,
  });
}

/** `GET /campaigns/me` — `campaigns_routes.py::UserCampaignParticipation` */
export interface UserCampaignParticipation {
  id: number;
  name: string;
  description: string;
  reward_token: string;
  reward_per_participant: number;
  campaign_type: string;
  /** `tasks_verified` é o estado que libera o resgate. */
  participation_status: string;
  tasks_verified_at: string | null;
  tasks_claimed: boolean;
  claim_receipt_id: string | null;
}

interface UserCampaignsResponse {
  success: boolean;
  campaigns: UserCampaignParticipation[];
}

/** **Exige sessão**: a rota resolve o participante pelo `Bearer`. */
export async function listMyCampaigns(): Promise<UserCampaignParticipation[]> {
  const response = await apiFetch<UserCampaignsResponse>('/campaigns/me');

  if (!response.success) {
    throw new ApiError('The backend could not read your campaigns', null, false);
  }

  return response.campaigns ?? [];
}

/**
 * Join → verify → claim, os três passos que o `StepRail` do cartão desenha.
 *
 * Todas exigem sessão: `_resolve_user` tira o participante do `Bearer`, e é por
 * isso que nenhuma leva `skipAuth`. O corpo é o `CampaignActionRequest` do
 * backend, cujo `campaign_identifier` é string mesmo sendo um id numérico — a
 * rota faz `int(...)` do outro lado.
 *
 * As três devolvem `success: false` com mensagem em vez de status HTTP de erro
 * nos casos de regra de negócio ("já resgatou", "verifique as tarefas antes").
 * Quem chama precisa olhar o corpo, não só o status — daí `CampaignActionResult`
 * carregar os dois campos.
 */
interface CampaignActionResult {
  success: boolean;
  /** Presente no caminho feliz. */
  message?: string;
  /** Presente quando a regra de negócio recusa. */
  error?: string;
}

/** Texto para a UI, venha ele de `message` ou de `error`. */
function actionText(result: CampaignActionResult, fallback: string): string {
  return result.message ?? result.error ?? fallback;
}

export async function joinCampaign(campaignId: number): Promise<string> {
  const result = await apiFetch<CampaignActionResult>('/campaigns/join', {
    method: 'POST',
    json: { campaign_identifier: String(campaignId) },
  });

  if (!result.success) {
    throw new ApiError(actionText(result, 'Could not join this campaign'), null, false);
  }

  return actionText(result, 'Joined');
}

export interface VerifyResult {
  message: string;
  allTasksCompleted: boolean;
}

/**
 * Diferente de join e claim, uma verificação reprovada é resultado normal, não
 * erro: o backend checa a tarefa de verdade (API do X, Helius, ou contagem de
 * indicados) e "você ainda não seguiu o perfil" é uma resposta legítima que a
 * tela precisa mostrar sem virar estado de falha.
 */
export async function verifyCampaignTasks(campaignId: number): Promise<VerifyResult> {
  const result = await apiFetch<CampaignActionResult & { all_tasks_completed?: boolean }>(
    '/campaigns/verify',
    { method: 'POST', json: { campaign_identifier: String(campaignId) } },
  );

  return {
    message: actionText(result, 'Could not verify your tasks'),
    allTasksCompleted: Boolean(result.all_tasks_completed),
  };
}

export interface ClaimResult {
  message: string;
  receiptId: string | null;
  rewardAmount: number | null;
  rewardToken: string | null;
  /**
   * `true` só quando o backend de fato mandou USDC on-chain via Circle W3S
   * (`campaigns_routes.py::claim_reward`) — hoje isso exige carteira EVM e
   * recompensa em USDC. Fora desses dois casos (ex.: wallet Solana legada) o
   * resgate ainda é só registrado, sem transferência real.
   */
  paidOnchain: boolean;
}

/**
 * A conta é sempre a carteira agora (não há mais sessão custodial do Google) —
 * então todo resgate é não-custodial e precisa da assinatura EIP-191 que
 * `_verify_claim_proof` confere (`campaigns_routes.py`): recupera o endereço
 * de `wallet_signature` sobre `proofMessage` e compara com `walletAddress`.
 * `proofMessage` é montada por quem chama (`campaign-card.tsx`, que tem a
 * `signMessage` do WalletConnect) — aqui só empacota o que já foi assinado.
 */
export async function claimCampaignReward(
  campaignId: number,
  walletAddress: string,
  proofMessage: string,
  signature: string,
): Promise<ClaimResult> {
  const result = await apiFetch<
    CampaignActionResult & {
      claim_receipt_id?: string;
      reward_amount?: number;
      reward_token?: string;
      paid_onchain?: boolean;
    }
  >('/campaigns/claim', {
    method: 'POST',
    json: {
      campaign_identifier: String(campaignId),
      wallet_public_key: walletAddress,
      proof_message: proofMessage,
      proof_encoding: 'eip191',
      wallet_signature: signature,
    },
  });

  if (!result.success) {
    throw new ApiError(actionText(result, 'Could not claim this reward'), null, false);
  }

  return {
    message: actionText(result, 'Reward claimed'),
    receiptId: result.claim_receipt_id ?? null,
    rewardAmount: result.reward_amount ?? null,
    rewardToken: result.reward_token ?? null,
    paidOnchain: result.paid_onchain ?? false,
  };
}
