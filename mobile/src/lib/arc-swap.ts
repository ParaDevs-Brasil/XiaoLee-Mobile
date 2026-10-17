/**
 * Swap na Arc pelo App Kit da Circle (`@circle-fin/swap-kit`), assinado na
 * carteira embutida do Privy.
 *
 * O agente só prepara o pedido (`execution.swap`, ver `parseSwapRequest`); quem
 * assina é o usuário, no app — mesma regra do envio de USDC. O backend nunca
 * vê chave nem executa a troca.
 *
 * A rede (Arc mainnet ou testnet) vem do build (`EXPO_PUBLIC_ARC_NETWORK`), como
 * no resto do app. Na Arc o SDK só troca USDC, EURC e cirBTC.
 */
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2';
import { SwapKit } from '@circle-fin/swap-kit';
import { createPublicClient, http, type Chain } from 'viem';

import { ARC_NETWORK } from '@/lib/arc-network';
import type { ArcSwapRequest } from '@/lib/arc-swap-request';

/** O que o `getProvider()` da carteira embutida do Privy entrega (EIP-1193). */
export interface Eip1193Like {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

export interface ArcSwapQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  /** Quanto se espera receber. */
  estimatedOut: string;
  /** Piso garantido pelo limite de slippage. */
  minimumOut: string;
}

export interface ArcSwapReceipt {
  txHash: string;
  amountOut?: string;
  explorerUrl?: string;
}

const CHAIN = ARC_NETWORK.isMainnet ? 'Arc' : 'Arc_Testnet';

let kit: SwapKit | undefined;

/**
 * Telemetria do SDK desligada: o padrão dele envia eventos de uso e erro
 * (com endereços) à Circle, e isso é decisão de privacidade/negócio do produto,
 * não um efeito colateral de importar o pacote.
 */
function getKit(): SwapKit {
  return (kit ??= new SwapKit({ disableAnalytics: true, disableErrorReporting: true }));
}

async function context(provider: Eip1193Like, request: ArcSwapRequest) {
  const adapter = await createViemAdapterFromProvider({
    provider: provider as unknown as Parameters<typeof createViemAdapterFromProvider>[0]['provider'],
    // O adaptador traz o RPC da Arc embutido (e já houve host desativado); o app
    // manda o próprio (`ARC_NETWORK.rpcUrl`, o mesmo do resto do app).
    getPublicClient: ({ chain }: { chain: Chain }) =>
      createPublicClient({
        chain: { ...chain, rpcUrls: { default: { http: [ARC_NETWORK.rpcUrl] } } },
        transport: http(ARC_NETWORK.rpcUrl),
      }),
  });
  return { from: { adapter, chain: CHAIN }, ...request } as const;
}

/** Cotação sem executar nada. */
export async function estimateArcSwap(provider: Eip1193Like, request: ArcSwapRequest): Promise<ArcSwapQuote> {
  const estimate = await getKit().estimate((await context(provider, request)) as never);
  return {
    tokenIn: estimate.tokenIn,
    tokenOut: estimate.tokenOut,
    amountIn: estimate.amountIn,
    estimatedOut: estimate.estimatedOutput.amount,
    minimumOut: estimate.stopLimit.amount,
  };
}

/** Executa o swap na carteira do usuário (ele assina). */
export async function executeArcSwap(provider: Eip1193Like, request: ArcSwapRequest): Promise<ArcSwapReceipt> {
  const result = await getKit().swap((await context(provider, request)) as never);
  return { txHash: result.txHash, amountOut: result.amountOut, explorerUrl: result.explorerUrl };
}
