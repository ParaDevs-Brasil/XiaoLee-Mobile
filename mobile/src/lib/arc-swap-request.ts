/**
 * Pedido de swap na Arc, validado antes de chegar ao SDK da Circle.
 *
 * Pura (sem React Native nem o SDK) para poder ser testada com `node`. A Arc só
 * troca estes três tokens no App Kit Swap; qualquer outro vira erro em português
 * claro em vez de uma falha opaca do SDK.
 */

export const ARC_SWAP_TOKENS = ['USDC', 'EURC', 'cirBTC'] as const;
export type ArcSwapToken = (typeof ARC_SWAP_TOKENS)[number];

export interface ArcSwapRequest {
  tokenIn: ArcSwapToken;
  tokenOut: ArcSwapToken;
  /** Decimal legível ("1.5"), como o SDK espera. */
  amountIn: string;
}

/** Casa o símbolo ignorando caixa ("usdc", "Cirbtc"); devolve o nome canônico. */
export function canonicalSwapToken(raw: unknown): ArcSwapToken | undefined {
  if (typeof raw !== 'string') return undefined;
  const wanted = raw.trim().toLowerCase();
  return ARC_SWAP_TOKENS.find((t) => t.toLowerCase() === wanted);
}

export type ParsedSwap = { ok: true; request: ArcSwapRequest } | { ok: false; error: string };

/** Valida o que o backend preparou (`execution.swap`). Nunca lança. */
export function parseSwapRequest(input: { tokenIn?: unknown; tokenOut?: unknown; amountIn?: unknown }): ParsedSwap {
  const tokenIn = canonicalSwapToken(input.tokenIn);
  const tokenOut = canonicalSwapToken(input.tokenOut);
  if (!tokenIn || !tokenOut) {
    return { ok: false, error: `Na Arc só dá para trocar ${ARC_SWAP_TOKENS.join(', ')}.` };
  }
  if (tokenIn === tokenOut) return { ok: false, error: 'Escolha dois tokens diferentes.' };

  const amount = typeof input.amountIn === 'number' ? String(input.amountIn) : input.amountIn;
  // Decimal positivo simples: sem notação científica, sem sinal, no máximo 18 casas.
  if (typeof amount !== 'string' || !/^\d+(\.\d{1,18})?$/.test(amount.trim()) || Number(amount) <= 0) {
    return { ok: false, error: 'Informe um valor maior que zero.' };
  }
  return { ok: true, request: { tokenIn, tokenOut, amountIn: amount.trim() } };
}
