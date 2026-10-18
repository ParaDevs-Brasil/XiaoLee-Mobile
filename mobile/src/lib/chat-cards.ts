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
  return Boolean(c.transfer || c.claim || c.swap || c.post);
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
    const { transfer, txHash, claim, claimReceiptId, swap, swapTxHash, swapAmountOut, post, postUrl, at } = pool[i];
    return { at, transfer, txHash, claim, claimReceiptId, swap, swapTxHash, swapAmountOut, post, postUrl };
  });
}
