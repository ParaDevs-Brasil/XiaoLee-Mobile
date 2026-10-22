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

/**
 * `GET/PATCH /user/me/profile` — `backend/server/campaigns_routes.py`.
 *
 * `interest_profile` só aceita os valores de `INTERESTS` no backend
 * (`defi`, `games`, `cards`, `trader`, `memecoins`) — mandar qualquer outro
 * valor devolve 422. `onboarded` é calculado pelo backend (nome + ao menos
 * um interesse); o app usa esse campo, nunca um cálculo próprio, para
 * decidir se mostra o questionário.
 */
export interface MyProfile {
  full_name: string | null;
  state: string | null;
  city: string | null;
  bio: string | null;
  social_links: Record<string, string>;
  interest_profile: string[];
  onboarded: boolean;
}

export interface ProfileUpdateRequest {
  full_name?: string;
  state?: string;
  city?: string;
  bio?: string;
  social_links?: Record<string, string>;
  interest_profile?: string[];
}

/** Exige sessão: o backend resolve o dono pelo `Bearer`, nunca por parâmetro. */
export function getMyProfile(): Promise<MyProfile> {
  return apiFetch<MyProfile>('/user/me/profile');
}

export function updateMyProfile(payload: ProfileUpdateRequest): Promise<MyProfile> {
  return apiFetch<MyProfile>('/user/me/profile', {
    method: 'PATCH',
    json: payload,
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

/** Mídia bruta do Clipper — `backend/server/media_routes.py`. */
/** `expired`: a retenção do backend (`media_maintenance.purge_expired`) apagou os arquivos; só dá para reenviar. */
export type MediaStatus = 'pending' | 'uploaded' | 'transcribing' | 'transcribed' | 'failed' | 'expired';

export interface MediaAsset {
  id: number;
  kind: 'video' | 'audio';
  filename: string;
  /** Nome exibido: o que o creator escolheu ou, sem isso, o `filename`. */
  title: string;
  /** Quadro do vídeo para a lista. URL temporária (1 h); `null` = ainda não gerado, ou áudio. */
  thumbnail_url: string | null;
  content_type: string;
  size_bytes: number;
  sha256: string | null;
  status: MediaStatus;
  error: string | null;
  duration_s: number | null;
  created_at: string;
  /** Última mudança de status (`null` logo depois de uma escrita). Ver `isStale` em `lib/clips.ts`. */
  updated_at: string | null;
  /**
   * Cortes deste vídeo. `status: 'transcribed'` só diz que a TRANSCRIÇÃO
   * acabou — sem isto a lista chamava de "Ready" um vídeo ainda renderizando.
   * Falhos = total − prontos − em andamento. Ver `mediaListStatus`.
   */
  clips_total: number;
  clips_ready: number;
  /** `pending` + `rendering`. */
  clips_in_progress: number;
}

export interface MediaTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface MediaDetail extends MediaAsset {
  transcript: {
    text: string;
    language: string | null;
    model: string;
    segments: MediaTranscriptSegment[];
  } | null;
}

export interface MediaUploadTicket {
  asset: MediaAsset;
  /** PUT direto no storage: o arquivo NÃO passa pelo backend. */
  upload_url: string;
  /** Headers assinados que o PUT tem que mandar exatamente assim. */
  upload_headers: Record<string, string>;
}

export function createMedia(request: {
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256?: string;
}): Promise<MediaUploadTicket> {
  return apiFetch<MediaUploadTicket>('/v1/media', { method: 'POST', json: request });
}

/** Confere o objeto no storage e dispara a transcrição. */
export function completeMedia(id: number): Promise<MediaAsset> {
  return apiFetch<MediaAsset>(`/v1/media/${id}/complete`, { method: 'POST' });
}

export function getMedia(id: number): Promise<MediaDetail> {
  return apiFetch<MediaDetail>(`/v1/media/${id}`);
}

/** Só o status, sem a transcrição — o que se consulta em loop enquanto o backend trabalha. */
export function getMediaStatus(id: number): Promise<MediaAsset> {
  return apiFetch<MediaAsset>(`/v1/media/${id}?include_transcript=false`);
}

export function listMedia(): Promise<MediaAsset[]> {
  return apiFetch<MediaAsset[]>('/v1/media');
}

/** Cortes 9:16 de uma mídia — `media_routes.py::ClipOut`. */
export type ClipStatus = 'pending' | 'rendering' | 'ready' | 'failed';

/** `crop` = quem fala para a câmera; `fit` = gravação de tela (vídeo inteiro sobre fundo desfocado). */
/** `auto` (padrão do backend): o Claude olha quadros do vídeo e escolhe entre `crop` e `fit`. */
export type ClipLayout = 'auto' | 'crop' | 'fit';

export interface MediaClip {
  id: number;
  /** 1 = o melhor momento, segundo o Claude. */
  rank: number;
  start_s: number;
  end_s: number;
  title: string;
  /** Por que o trecho foi escolhido — texto do Claude. */
  reason: string;
  status: ClipStatus;
  error: string | null;
  size_bytes: number | null;
  /** Só quando `ready`. URL temporária (1 h): buscar de novo antes de tocar, nunca guardar. */
  download_url: string | null;
  /** Quadro do corte renderizado (com a legenda). URL temporária (1 h); `null` até existir. */
  thumbnail_url: string | null;
  /** Última mudança de status (`null` logo depois de uma escrita). Ver `isStale` em `lib/clips.ts`. */
  updated_at: string | null;
}

/** Máximo do backend (`TITLE_MAX` em `media_routes.py`). */
export const TITLE_MAX_LENGTH = 120;

/** Renomeia o vídeo — só o nome exibido, o arquivo e o `filename` ficam. */
export function renameMedia(id: number, title: string): Promise<MediaAsset> {
  return apiFetch<MediaAsset>(`/v1/media/${id}`, { method: 'PATCH', json: { title } });
}

/** Renomeia um corte. Não re-renderiza: o título não vai queimado no vídeo. */
export function renameClip(mediaId: number, clipId: number, title: string): Promise<MediaClip> {
  return apiFetch<MediaClip>(`/v1/media/${mediaId}/clips/${clipId}`, { method: 'PATCH', json: { title } });
}

/** Apaga o vídeo com os cortes, a transcrição e os arquivos. Vale em qualquer estado, inclusive transcrevendo. */
export function deleteMedia(id: number): Promise<void> {
  return apiFetch<void>(`/v1/media/${id}`, { method: 'DELETE' });
}

/** Apaga um corte e devolve os que sobraram, já renumerados. */
export function deleteClip(mediaId: number, clipId: number): Promise<MediaClip[]> {
  return apiFetch<MediaClip[]>(`/v1/media/${mediaId}/clips/${clipId}`, { method: 'DELETE' });
}

export function listClips(mediaId: number): Promise<MediaClip[]> {
  return apiFetch<MediaClip[]>(`/v1/media/${mediaId}/clips`);
}

/**
 * Escolhe os momentos e enfileira a renderização. A escolha acontece DENTRO
 * da requisição (o Claude lê a transcrição inteira, ~5–20 s), daí o timeout
 * maior que o padrão. Cada chamada custa uma ida ao Claude: com cortes já
 * existentes o backend devolve 409, a não ser que venha `regenerate`.
 */
export function createClips(
  mediaId: number,
  { layout, regenerate = false }: { layout: ClipLayout; regenerate?: boolean },
): Promise<MediaClip[]> {
  const query = `layout=${layout}${regenerate ? '&regenerate=true' : ''}`;
  return apiFetch<MediaClip[]>(`/v1/media/${mediaId}/clips?${query}`, {
    method: 'POST',
    timeoutMs: 90_000,
  });
}

/**
 * Glossário do creator: termos que a transcrição precisa acertar (marcas,
 * projetos, jargão) — `GET/PUT /v1/media/glossary` (`media_routes.py`, tabela
 * própria, fora do perfil). O backend limpa repetidos/vazios e corta em 60
 * termos de até 40 caracteres; vale para as próximas transcrições.
 */
export async function getGlossary(): Promise<string[]> {
  const res = await apiFetch<{ terms?: string[] }>('/v1/media/glossary');
  return res.terms ?? [];
}

/** Substitui a lista inteira e devolve a lista salva (já limpa pelo backend). */
export async function updateGlossary(terms: string[]): Promise<string[]> {
  const res = await apiFetch<{ terms?: string[] }>('/v1/media/glossary', {
    method: 'PUT',
    json: { terms },
  });
  return res.terms ?? [];
}

/** Termo que o creator repete nas últimas transcrições e que parece nome próprio/marca. */
export interface GlossarySuggestion {
  term: string;
  /** Quantas vezes apareceu. */
  count: number;
}

/** Sugestões para o glossário (já sem os termos que ele tem) — `GET /v1/media/glossary/suggestions`. */
export async function getGlossarySuggestions(): Promise<GlossarySuggestion[]> {
  const res = await apiFetch<{ suggestions?: GlossarySuggestion[] }>('/v1/media/glossary/suggestions');
  return res.suggestions ?? [];
}

export type FormatPlatform = 'tiktok' | 'reels' | 'shorts' | 'x';

/** Formato de conteúdo sugerido pela IA (XIAOLEEACE-32). */
export interface FormatSuggestion {
  /** Nome curto do formato, ex.: "Mito ou verdade". */
  format: string;
  /** Por que combina com este creator. */
  why: string;
  /** Exemplo de frase para os primeiros segundos. */
  hook: string;
  platform: FormatPlatform;
  /** Duração ideal, em segundos (10-180). */
  duration_s: number;
}

export interface FormatSuggestions {
  suggestions: FormatSuggestion[];
  /** Quantos vídeos do creator entraram no contexto; 0 = só o perfil do onboarding. */
  based_on_videos: number;
}

/**
 * 2-3 formatos para publicar, do perfil do onboarding + vídeos do creator —
 * `GET /v1/media/format-suggestions` (`format_advisor.py`, mesmo worker de IA
 * dos cortes). O backend guarda a resposta por contexto: pedir de novo sem
 * vídeo novo nem perfil editado não chama o modelo. `lang` fica em `en`, como
 * o resto do app, até o mobile ter i18n.
 */
export async function getFormatSuggestions(lang: 'en' | 'pt' = 'en'): Promise<FormatSuggestions> {
  const res = await apiFetch<Partial<FormatSuggestions>>(`/v1/media/format-suggestions?lang=${lang}`, {
    timeoutMs: 60_000,
  });
  return { suggestions: res.suggestions ?? [], based_on_videos: res.based_on_videos ?? 0 };
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
 * Números de um período do relatório de 30 dias — `backend/server/creator_report.py::collect_metrics`.
 * Só atividade na Xiaolee: views e seguidores das redes ainda não existem no backend.
 */
export interface CreatorReportMetrics {
  videos: number;
  video_minutes: number;
  clips: number;
  campaigns_joined: number;
  usdc_received: number;
}

export interface CreatorReportSuggestion {
  title: string;
  /** O passo concreto para os próximos 30 dias. */
  action: string;
  /** O número ou vídeo em que a IA se baseou. */
  why: string;
}

/** Item de `GET /v1/reports/me` — `backend/server/creator_report_routes.py::ReportSummary`. */
export interface CreatorReportSummary {
  id: number;
  period_start: string;
  period_end: string;
  summary: string;
}

export interface CreatorReport extends CreatorReportSummary {
  metrics: Partial<CreatorReportMetrics>;
  /** Os 30 dias antes do período, para comparar. */
  previous: Partial<CreatorReportMetrics>;
  suggestions: CreatorReportSuggestion[];
}

/** `GET /v1/reports/me` — relatórios de 30 dias do usuário da sessão, mais novo primeiro. Exige sessão. */
export function listCreatorReports(): Promise<CreatorReportSummary[]> {
  return apiFetch<CreatorReportSummary[]>('/v1/reports/me');
}

/** `GET /v1/reports/me/{id}` — relatório completo; de outro usuário responde 404. */
export function getCreatorReport(id: number): Promise<CreatorReport> {
  return apiFetch<CreatorReport>(`/v1/reports/me/${id}`);
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

/** Quem entrou numa campanha — só o criador vê (`GET /campaigns/{id}/participants`). */
export interface CampaignParticipant {
  user_id: number;
  handle: string | null;
  /** enrolled | tasks_verified | paid */
  status: string;
}

export async function listCampaignParticipants(campaignId: number): Promise<CampaignParticipant[]> {
  const result = await apiFetch<{ participants: CampaignParticipant[] }>(
    `/campaigns/${campaignId}/participants`,
  );
  return result.participants;
}

/** O criador confirma que o participante cumpriu as tarefas; libera o resgate. */
export async function approveCampaignParticipant(campaignId: number, userId: number): Promise<void> {
  await apiFetch(`/campaigns/${campaignId}/participants/${userId}/approve`, { method: 'POST' });
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

// ── Marketplace (x402) ─────────────────────────────────────────────────────
// `backend/server/app.py::marketplace_*`. A compra é em dois tempos: sem
// `confirm_id` o backend só cota (nada é pago); o usuário aprova em
// `/marketplace/confirm` e a compra repetida com o `confirm_id` paga.

export interface MarketplaceItem {
  resource: string;
  method: 'GET' | 'POST';
  price_usdc: number;
  provider: string;
  description: string;
}

export interface MarketplaceQuote {
  resource: string;
  method: string;
  price_usdc: number;
  pay_to: string;
  expires_in_s: number;
}

/** Cotação (`error: 'confirmation_required'`) ou compra feita (`paid_usdc`). */
export interface MarketplaceBuyResult {
  error?: string;
  message?: string;
  confirm_id?: string;
  quote?: MarketplaceQuote;
  status?: number;
  paid_usdc?: number;
  payment_tx?: string;
  data?: unknown;
}

export async function searchMarketplace(query: string): Promise<MarketplaceItem[]> {
  // O primeiro varrimento do Discovery da Circle pode levar dezenas de segundos.
  const out = await apiFetch<{ items?: MarketplaceItem[]; error?: string }>(
    `/marketplace/search?q=${encodeURIComponent(query.trim())}`,
    { timeoutMs: 60_000 },
  );
  if (out.error) throw new ApiError('Marketplace is unavailable right now. Try again soon.', null, false);
  return out.items ?? [];
}

export function buyMarketplaceService(request: {
  resource: string;
  method: string;
  body?: unknown;
  maxUsdc: number;
  confirmId?: string;
}): Promise<MarketplaceBuyResult> {
  return apiFetch<MarketplaceBuyResult>('/marketplace/buy', {
    method: 'POST',
    timeoutMs: 90_000,
    json: {
      resource: request.resource,
      method: request.method,
      body: request.body,
      max_usdc: request.maxUsdc,
      confirm_id: request.confirmId,
    },
  });
}

export async function confirmMarketplaceSpend(confirmId: string): Promise<void> {
  await apiFetch('/marketplace/confirm', { method: 'POST', json: { confirm_id: confirmId } });
}

/** Post feito pela Xiaolee numa rede do creator — `POST /v1/social/publish` (`social_routes.py`). */
export interface SocialPublication {
  id: number;
  platform: string;
  status: 'pending' | 'published' | 'failed';
  error: string | null;
  url: string | null;
}

/**
 * Publica o post que o chat preparou (`prepare_social_post`). O backend registra a tentativa
 * antes de chamar a rede; falha da rede volta como `status: "failed"` com o motivo, não como erro HTTP.
 */
export async function publishSocialPost(
  platform: string,
  text: string,
  clipId?: number,
  /** Até 4 fotos (base64 + mime); não vai junto com `clipId`. */
  images?: { mime: string; base64: string }[],
): Promise<SocialPublication> {
  return apiFetch<SocialPublication>('/v1/social/publish', {
    method: 'POST',
    json: {
      platform,
      text,
      ...(clipId != null && { clip_id: clipId }),
      ...(images?.length && { images: images.map((i) => ({ mime: i.mime, data: i.base64 })) }),
    },
    timeoutMs: 120_000,
  });
}


/** Conta de rede social conectada — `GET /v1/social/accounts` (`social_routes.py`). Sem credenciais. */
export interface SocialAccount {
  platform: string;
  handle: string;
  status: string;
  connected_at: string;
}

export interface SocialAccounts {
  accounts: SocialAccount[];
  /** Redes que o backend sabe publicar hoje. */
  available: string[];
  /** Nome do bot da Xiaolee, que o creator adiciona como admin do canal do Telegram. */
  hints: { telegram_bot: string };
}

/** Com `SOCIAL_TOOLS_ENABLED` desligado o backend responde 404 (`ApiError.status === 404`). */
export async function listSocialAccounts(): Promise<SocialAccounts> {
  const res = await apiFetch<Partial<SocialAccounts>>('/v1/social/accounts');
  return {
    accounts: res.accounts ?? [],
    available: res.available ?? [],
    hints: { telegram_bot: res.hints?.telegram_bot ?? '' },
  };
}

/** Conecta e valida na própria rede (canal com o bot admin, app password do Bluesky); erro vem com o motivo. */
export async function connectSocialAccount(
  platform: string,
  credentials: Record<string, string>,
): Promise<SocialAccount> {
  return apiFetch<SocialAccount>(`/v1/social/accounts/${platform}`, {
    method: 'POST',
    json: { credentials },
    timeoutMs: 30_000,
  });
}

/** Menções e hashtags reais (da conta do creator e do nicho cripto) para inserir no post. */
export interface SocialSuggestions {
  mentions: { handle: string; name: string; why: string }[];
  hashtags: { tag: string; why: string }[];
}

export async function getSocialSuggestions(platform: string): Promise<SocialSuggestions> {
  const res = await apiFetch<Partial<SocialSuggestions>>(`/v1/social/suggestions/${platform}`, { timeoutMs: 60_000 });
  return { mentions: res.mentions ?? [], hashtags: res.hashtags ?? [] };
}

/** Redirect do login do X; o mesmo valor está cadastrado no app do X e em `X_OAUTH_REDIRECT` no backend. */
export const X_REDIRECT = 'xiaolee://social/x';

/** Começa o login do X (PKCE fica no backend) e devolve a URL que o app abre. */
export async function startXLogin(): Promise<string> {
  const res = await apiFetch<{ authorize_url: string }>('/v1/social/x/start', { method: 'POST' });
  return res.authorize_url;
}

/** Entrega o `code`/`state` que o X devolveu no redirect; o backend troca por tokens e conecta a conta. */
export async function finishXLogin(code: string, state: string): Promise<SocialAccount> {
  return apiFetch<SocialAccount>('/v1/social/x/callback', {
    method: 'POST',
    json: { code, state },
    timeoutMs: 30_000,
  });
}

/** Desconecta e apaga a credencial guardada. */
export async function disconnectSocialAccount(platform: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/v1/social/accounts/${platform}`, { method: 'DELETE' });
}

// ── Criadores sintéticos (`server/synthetic_creator_routes.py`) ─────────────

export interface CreatorVoice {
  id: string;
  name: string;
  gender: 'female' | 'male';
  /** Uma frase sobre o jeito da voz. */
  description: string;
  /** Grupo da voz (Narrators, Villains, Brazilian…), na ordem em que o backend as manda. */
  category: string;
  /** Caminho (no backend) do áudio de amostra; o app junta com `API_URL`. */
  sample_path: string;
}

export interface CreatorQuality {
  quality: 'standard' | 'pro' | 'pro_seedance' | 'mimic' | 'mimic_v3' | 'mimic_v3_pro' | 'swap' | 'swap_pro';
  label: string;
  /** Uma linha curta que ajuda a escolher entre as faixas. */
  hint: string;
  /** `speech`: a persona fala um roteiro. `mimic`: a persona repete o movimento de um vídeo de referência. */
  kind: 'speech' | 'mimic' | 'swap';
  /** duração em segundos (string) → preço em USDC */
  prices: Record<string, number>;
}

export interface CreatorCatalog {
  enabled: boolean;
  voices: CreatorVoice[];
  qualities: CreatorQuality[];
  durations_s: number[];
  words_per_s: number;
  pay_to: string | null;
}

export interface SyntheticCreator {
  id: number;
  name: string;
  voice_id: string;
  status: string;
  image_url: string | null;
  created_at: string | null;
}

export interface CreatorVideo {
  id: number;
  creator_id: number;
  quality: CreatorQuality['quality'];
  duration_s: number;
  script: string;
  price_usdc: number;
  /** paying → queued → voice → video → done | failed */
  status: string;
  error: string | null;
  refund_due: boolean;
  payment_tx: string | null;
  audio: 'none' | 'original' | 'voice';
  video_url: string | null;
  created_at: string | null;
}

export function getCreatorCatalog(): Promise<CreatorCatalog> {
  return apiFetch<CreatorCatalog>('/v1/creators/catalog');
}

export function listCreators(): Promise<SyntheticCreator[]> {
  return apiFetch<SyntheticCreator[]>('/v1/creators');
}

export function createCreator(request: {
  name: string;
  voice_id: string;
  content_type: string;
  size_bytes: number;
  rights_confirmed: boolean;
}): Promise<{ creator: SyntheticCreator; upload_url: string; upload_headers: Record<string, string> }> {
  return apiFetch('/v1/creators', { method: 'POST', json: request });
}

export function completeCreator(id: number): Promise<SyntheticCreator> {
  return apiFetch<SyntheticCreator>(`/v1/creators/${id}/complete`, { method: 'POST' });
}

export function deleteCreator(id: number): Promise<void> {
  return apiFetch<void>(`/v1/creators/${id}`, { method: 'DELETE' });
}

export function writeCreatorScript(request: {
  creator_id: number;
  topic: string;
  duration_s: number;
}): Promise<{ script: string; max_words: number }> {
  return apiFetch('/v1/creators/script', { method: 'POST', json: request });
}

export function createCreatorVideo(
  creatorId: number,
  request: {
    quality: CreatorQuality['quality'];
    duration_s: number;
    /** `speech`: o roteiro falado. `mimic`: descrição opcional da cena. */
    script?: string;
    payment: RelayAuthorizationRequest;
    /** Só no `mimic`: o vídeo de `createMotionUpload` e o termo de direito de uso. */
    motion_key?: string;
    motion_rights_confirmed?: boolean;
    /** Só no `mimic`: sem som, o som do vídeo de referência, ou a narração do `script` com a voz da persona. */
    audio?: 'none' | 'original' | 'voice';
    /** Só no Swap: a prévia aprovada; o vídeo sai do quadro dela. */
    preview_id?: number;
  },
): Promise<CreatorVideo> {
  return apiFetch<CreatorVideo>(`/v1/creators/${creatorId}/videos`, { method: 'POST', json: request });
}

export interface CreatorPreview {
  id: number;
  /** working → ready | failed */
  status: 'working' | 'ready' | 'failed';
  frame_url: string | null;
  error: string | null;
}

/** Swap: quadro de prévia (personagem no lugar da pessoa do vídeo). Grátis, com limite diário. */
export function createSwapPreview(
  creatorId: number,
  request: { motion_key: string; motion_rights_confirmed: boolean },
): Promise<CreatorPreview> {
  return apiFetch<CreatorPreview>(`/v1/creators/${creatorId}/previews`, { method: 'POST', json: request });
}

export function getSwapPreview(previewId: number): Promise<CreatorPreview> {
  return apiFetch<CreatorPreview>(`/v1/creators/previews/${previewId}`);
}

export function createMotionUpload(request: {
  content_type: string;
  size_bytes: number;
}): Promise<{ motion_key: string; upload_url: string; upload_headers: Record<string, string> }> {
  return apiFetch('/v1/creators/motion', { method: 'POST', json: request });
}

export function listCreatorVideos(creatorId?: number): Promise<CreatorVideo[]> {
  return apiFetch<CreatorVideo[]>(`/v1/creators/videos${creatorId ? `?creator_id=${creatorId}` : ''}`);
}

/**
 * On/off-ramp — `server/onoff_routes.py`. O saque entre redes é assinado pela carteira do usuário
 * (`lib/onoff-burn.ts`); o backend cota a taxa, confere o burn na Circle e acompanha até o mint.
 *
 *   GET  /v1/onoff/config
 *   POST /v1/onoff/withdraw                 (method=chain)
 *   POST /v1/onoff/intents/{id}/burn        (202 enquanto a Circle ainda não viu a tx)
 *   GET  /v1/onoff/intents/{id}
 */
export interface OnoffConfig {
  enabled: boolean;
  deposit_enabled: boolean;
  withdraw_enabled: boolean;
  limits_usdc: { per_tx: number; per_day: number; per_month: number };
  chain_networks: string[];
  providers: { name: string; methods: string[]; directions: string[] }[];
}

export type OnoffStatus =
  | 'created' | 'pending_provider' | 'funds_received' | 'sent_to_provider'
  | 'settled' | 'paid_out' | 'rejected' | 'expired' | 'failed' | 'refunded' | 'review';

export interface OnoffIntent {
  intent_id: string;
  direction: 'deposit' | 'withdraw';
  method: string;
  amount_usdc: number;
  status: OnoffStatus;
  dest_network: string | null;
  onchain_tx: string | null;
  forward_tx: string | null;
  max_fee_usdc: number | null;
  url: string | null;
  burn: import('@/lib/onoff-burn').BurnParams | null;
  created_at: string | null;
}

export function startDeposit(amountUsdc: number, method: string, fiatCurrency: string): Promise<OnoffIntent> {
  return apiFetch<OnoffIntent>('/v1/onoff/deposit', {
    method: 'POST',
    json: { amount_usdc: amountUsdc, method, fiat_currency: fiatCurrency },
  });
}

export function getOnoffConfig(): Promise<OnoffConfig> {
  return apiFetch<OnoffConfig>('/v1/onoff/config');
}

export function startChainWithdraw(amountUsdc: number, network: string, address: string): Promise<OnoffIntent> {
  return apiFetch<OnoffIntent>('/v1/onoff/withdraw', {
    method: 'POST',
    json: { amount_usdc: amountUsdc, method: 'chain', dest_network: network, dest_address: address },
  });
}

/**
 * Resolve `null` quando a Circle ainda não indexou a tx: o backend responde 202 com `detail` no lugar do
 * intent (2xx não vira `ApiError`), e quem chama tenta de novo.
 */
export async function registerBurn(intentId: string, txHash: string): Promise<OnoffIntent | null> {
  const res = await apiFetch<OnoffIntent | { detail: unknown }>(`/v1/onoff/intents/${intentId}/burn`, {
    method: 'POST',
    json: { tx_hash: txHash },
  });
  return 'intent_id' in res ? res : null;
}

export function listOnoffIntents(): Promise<OnoffIntent[]> {
  return apiFetch<OnoffIntent[]>('/v1/onoff/intents');
}

export function getOnoffIntent(intentId: string): Promise<OnoffIntent> {
  return apiFetch<OnoffIntent>(`/v1/onoff/intents/${intentId}`);
}
