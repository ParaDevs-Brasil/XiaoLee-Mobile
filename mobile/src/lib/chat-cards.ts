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
  return Boolean(c.transfer || c.claim || c.swap || c.post || c.insights);
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
    const { transfer, txHash, claim, claimReceiptId, swap, swapTxHash, swapAmountOut, post, postUrl, insights, at } = pool[i];
    return { at, transfer, txHash, claim, claimReceiptId, swap, swapTxHash, swapAmountOut, post, postUrl, insights };
  });
}
