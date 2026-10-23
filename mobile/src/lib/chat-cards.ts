/**
 * Cards de ação do chat (transferência a assinar, resgate, comprovante) que
 * sobrevivem a reabrir a conversa.
 *
 * O backend só guarda `role/content/time` por sessão — nada de `execution` —,
 * então ao restaurar uma sessão os botões e o comprovante sumiam. Quem guarda o
 * estado dos cards é o histórico local (`lib/chat-history.ts`); aqui fica só a
 * regra pura de recolocá-los nas mensagens que vieram do backend, sem
 * dependência de React Native para poder ser testada com `node`.
 */

export interface CardTransfer {
  to: string;
  amountUsdc: number;
}

export interface CardClaim {
  campaignId: number;
  amount: number;
  token: string;
}

export interface CardSwap {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
}

/** Post preparado pela Xiaolee (`prepare_social_post`); quem publica é o toque do creator. */
export interface CardPost {
  platform: string;
  handle: string;
  text: string;
  clipId?: number;
}

/** Formulário de rascunho (`open_post_draft`): as redes conectadas onde o creator pode postar. */
export interface CardDraft {
  networks: { platform: string; handle: string }[];
}

/** Uma pergunta da Xiaolee (`CardAsk`). `short` é o rótulo do resumo; `text` vira um campo livre opcional. */
export interface AskQuestion {
  id: string;
  label: string;
  short: string;
  options: string[];
  multi?: boolean;
  /** Mostra "Other" (formulário) ou "Something else" (passo a passo). */
  other?: boolean;
  optional?: boolean;
  text?: boolean;
}

/** Perguntas estruturadas na conversa: todas num formulário (`form`) ou uma por vez (`wizard`). */
export interface CardAsk {
  mode: 'form' | 'wizard';
  title: string;
  subtitle?: string;
  submit?: string;
  /** Título do resumo do passo a passo, depois de responder. */
  doneTitle?: string;
  questions: AskQuestion[];
  /** Só na prévia de desenvolvimento: a resposta não vai para o backend. */
  demo?: boolean;
}

/** Opções de post que a Xiaolee escreveu (`suggest_post_options`); o creator escolhe uma e ela vira a prévia. */
export interface CardOptions {
  platform: string;
  handle: string;
  texts: string[];
}

/** `execution.draft` -> formulário de rascunho, ou `undefined` se não for um (ou sem rede). */
export function draftFrom(execution: Record<string, unknown> | undefined): CardDraft | undefined {
  if (!execution || execution.status !== 'draft_open') return undefined;
  const list = (execution.draft as { networks?: { platform?: string; handle?: string }[] } | undefined)?.networks;
  const networks = (Array.isArray(list) ? list : [])
    .filter((n) => n?.platform)
    .map((n) => ({ platform: String(n.platform), handle: String(n.handle ?? '') }));
  return networks.length ? { networks } : undefined;
}

/** `execution.options` -> card de opções, ou `undefined` se não for um (ou com menos de 2 textos). */
export function optionsFrom(execution: Record<string, unknown> | undefined): CardOptions | undefined {
  if (!execution || execution.status !== 'post_options') return undefined;
  const o = execution.options as { platform?: string; handle?: string; texts?: unknown[] } | undefined;
  const texts = (Array.isArray(o?.texts) ? o.texts : []).map((t) => String(t).trim()).filter(Boolean);
  if (!o?.platform || texts.length < 2) return undefined;
  return { platform: o.platform, handle: o.handle ?? '', texts };
}

/** Desempenho do perfil numa rede (`get_social_insights`): o card de métricas do chat. */
export interface CardInsights {
  platform: string;
  handle: string;
  followers: number;
  postsTotal: number;
  windowDays: number;
  totals: { posts: number; impressions: number; engagements: number; profileClicks: number; linkClicks: number };
  /** Engajamentos / impressões, em %. */
  engagementRate: number;
  topPosts: { text: string; url: string; impressions: number; likes: number }[];
}

/** `execution.insights` (snake_case do backend) -> card de métricas, ou `undefined` se não for um. */
export function insightsFrom(execution: Record<string, unknown> | undefined): CardInsights | undefined {
  if (!execution || execution.status !== 'insights_ready') return undefined;
  const i = execution.insights as Record<string, any> | undefined;
  if (!i?.platform) return undefined;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const t = i.totals ?? {};
  return {
    platform: String(i.platform),
    handle: String(i.handle ?? ''),
    followers: n(i.followers),
    postsTotal: n(i.posts_total),
    windowDays: n(i.window_days),
    totals: {
      posts: n(t.posts), impressions: n(t.impressions), engagements: n(t.engagements),
      profileClicks: n(t.profile_clicks), linkClicks: n(t.link_clicks),
    },
    engagementRate: n(i.engagement_rate),
    topPosts: (Array.isArray(i.top_posts) ? i.top_posts : []).map((p: Record<string, unknown>) => ({
      text: String(p.text ?? ''), url: String(p.url ?? ''), impressions: n(p.impressions), likes: n(p.likes),
    })),
  };
}

/** Uma tendência que o Radar achou no X. */
export interface CardTrend {
  topic: string;
  why: string;
  hook: string;
  /** 3 ângulos de post (opinião, pergunta, explicando) escritos em voz de creator; vazio se o backend não os gerou. */
  angles: { kind: string; text: string }[];
  /** Post de origem no X, para o creator conferir o fato antes de postar. */
  source?: string;
  /** O Grok viu isso só num post de conta pequena: o creator confere antes de postar. */
  verify?: boolean;
}

/** Radar de tendências (`get_trend_radar`): nasce `pending` (a pesquisa roda no backend) e o app consulta até virar `ready` ou `error`. */
export interface CardRadar {
  jobId: string;
  niche: string;
  status: 'pending' | 'ready' | 'error';
  trends: CardTrend[];
  message?: string;
}

/** `trends` cru do backend -> lista limpa (descarta o que não tem tópico). */
export function trendsFrom(raw: unknown): CardTrend[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object' && Boolean((t as { topic?: unknown }).topic))
    .map((t) => ({
      topic: String(t.topic).trim(),
      why: String(t.why ?? '').trim(),
      hook: String(t.hook ?? '').trim(),
      angles: (Array.isArray(t.angles) ? t.angles : [])
        .filter((a): a is { kind: string; text: string } => Boolean(a) && typeof (a as { text?: unknown }).text === 'string')
        .map((a) => ({ kind: String(a.kind), text: a.text.trim() }))
        .filter((a) => a.text),
      ...(typeof t.example_post_url === 'string' && t.example_post_url ? { source: t.example_post_url } : {}),
      ...(t.verify === true ? { verify: true } : {}),
    }))
    .slice(0, 5);
}

/** `execution.radar` -> card pendente do radar, ou `undefined` se não for um. */
export function radarFrom(execution: Record<string, unknown> | undefined): CardRadar | undefined {
  if (!execution || execution.status !== 'radar_pending') return undefined;
  const r = execution.radar as { job_id?: string; niche?: string } | undefined;
  if (!r?.job_id) return undefined;
  return { jobId: String(r.job_id), niche: String(r.niche ?? ''), status: 'pending', trends: [] };
}

/** Estado de card que acompanha uma mensagem da Xiaolee. */
export interface ChatCards {
  transfer?: CardTransfer;
  txHash?: string;
  claim?: CardClaim;
  claimReceiptId?: string;
  swap?: CardSwap;
  /** Hash do swap, quando já assinado; `swapAmountOut` é o que o SDK diz que entrou na carteira. */
  swapTxHash?: string;
  swapAmountOut?: string;
  post?: CardPost;
  insights?: CardInsights;
  draft?: CardDraft;
  options?: CardOptions;
  radar?: CardRadar;
  /** Link do post, quando já publicado (some o botão, fica o link). */
  postUrl?: string;
}

export interface SessionEntry {
  role: string;
  content: string;
}

export interface StoredWithCards extends ChatCards {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

export function hasCards(c: ChatCards): boolean {
  return Boolean(c.transfer || c.claim || c.swap || c.post || c.insights || c.draft || c.options || c.radar);
}

/**
 * Para cada mensagem da Xiaolee vinda do backend, devolve os cards da entrada
 * local de mesmo texto — a mesma entrada não casa duas vezes, então dois
 * pedidos idênticos na mesma conversa ficam cada um com o seu card, na ordem.
 *
 * Casa por texto (`trim`) e não por horário: o backend carimba a hora no
 * servidor e o app no aparelho, e os dois relógios não batem.
 */
export function matchCards(
  entries: SessionEntry[],
  stored: StoredWithCards[],
): ({ at: string } & ChatCards | undefined)[] {
  const pool = stored.filter((s) => s.role === 'assistant' && hasCards(s));
  const used = new Set<number>();
  return entries.map((entry) => {
    if (entry.role === 'user') return undefined;
    const text = entry.content.trim();
    const i = pool.findIndex((s, idx) => !used.has(idx) && s.content.trim() === text);
    if (i === -1) return undefined;
    used.add(i);
    const { transfer, txHash, claim, claimReceiptId, swap, swapTxHash, swapAmountOut, post, postUrl, insights, draft, options, radar, at } = pool[i];
    return { at, transfer, txHash, claim, claimReceiptId, swap, swapTxHash, swapAmountOut, post, postUrl, insights, draft, options, radar };
  });
}
