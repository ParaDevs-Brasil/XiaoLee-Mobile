// Os polyfills (crypto, TextEncoder, shims do ethers) vivem no topo de
// `app/_layout.tsx`, não aqui — este arquivo não é o primeiro a importar
// `@privy-io/expo`. `_layout.tsx` importa `@privy-io/expo` direto, antes de
// chegar neste arquivo, então um polyfill posto aqui roda tarde demais (foi
// exatamente o bug: `ReferenceError: Property 'crypto' doesn't exist`).

import { defineChain } from 'viem';
import { useEmbeddedEthereumWallet, usePrivy } from '@privy-io/expo';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

import {
  getArcGasFees,
  getUsdcAuthorizationDomain,
  linkWallet,
  loginWithPrivy,
  relayUsdcAuthorization,
} from '@/api/backend';
import { shortHash } from '@/lib/format';
import { clearSession, clearWallet, saveSession, saveWallet } from '@/lib/session';

/**
 * Carteira embutida (Privy) do app mobile — login social, sem app de carteira
 * externo.
 *
 * A carteira embutida **é** a sessão do app, do mesmo jeito que a conexão
 * WalletConnect era antes: não há login separado, `saveSession` grava o
 * endereço como identidade assim que a carteira embutida existe, e é essa
 * identidade que vai como `Bearer` em toda chamada autenticada
 * (`api/client.ts::apiFetch`). O backend nunca soube que a carteira vinha de
 * WalletConnect e continua sem saber — só vê endereço e assinatura.
 */

/**
 * Chain do Arc Testnet, espelho de `ARC_CHAIN_ID` no backend
 * (`server/settings.py:97`, exposto em `GET /v1/arc/chain-config`).
 *
 * Duplicado aqui de propósito, em vez de buscado: o `PrivyProvider` precisa
 * desta config no primeiro render, antes de qualquer chamada async poder
 * resolver. Se o id do testnet mudar, atualizar aqui e em
 * `components/arc-network-sheet.tsx`... — não, aquele arquivo saiu: a
 * carteira embutida nasce direto nesta chain, então o problema que ele
 * existia para resolver (nenhuma carteira externa aceita cadastrar o Arc)
 * não existe mais.
 */
export const ARC_CHAIN_ID = 5042002;

export const arcTestnetChain = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' },
  },
});

/**
 * Prop `config` do `PrivyProvider`, montado em `_layout.tsx`.
 *
 * Shape conferido contra `node_modules/@privy-io/expo/dist/index.d.ts`
 * (`PrivyConfig`) — é `config.embedded.ethereum`, não `embeddedWallets`, e
 * `supportedChains` é prop irmã de `config`, não filha dele.
 */
export const PRIVY_CONFIG = {
  embedded: {
    ethereum: { createOnLogin: 'users-without-wallets' as const },
  },
};

interface WalletContextValue {
  isConnected: boolean;
  address: string | undefined;
  /** Sempre `'arc'` uma vez conectado — a carteira embutida só existe nesta chain. */
  chain: string | undefined;
  disconnect: () => Promise<void>;
  /** Assina e envia a tx preparada pelo backend. Devolve o hash. */
  signAndSend: (tx: EvmTxRequest) => Promise<string>;
  /**
   * Transfere USDC no Arc por autorização assinada (EIP-3009). Devolve o
   * hash da tx submetida pelo backend.
   */
  signAndRelay: (to: string, amountUsdc: number) => Promise<string>;
  /**
   * Assinatura EIP-191 (`personal_sign`) sobre uma mensagem UTF-8 qualquer —
   * devolve a assinatura hex de 65 bytes. É a prova de posse da carteira que
   * o backend confere em `_verify_claim_proof` (`campaigns_routes.py`) para
   * resgates de campanha sem sessão custodial.
   */
  signMessage: (message: string) => Promise<string>;
}

/** O provider da carteira embutida fala JSON-RPC; só isto é usado daqui. */
type Requester = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

/**
 * Shape mínimo da carteira embutida que `useEmbeddedEthereumWallet()`
 * devolve — declarado localmente em vez de importado: o pacote não exporta um
 * tipo nomeado estável para o item de `wallets[]`, só a forma estrutural.
 */
type EmbeddedWallet = {
  address: string;
  getProvider: () => Promise<Requester>;
};

/** Janela de validade da autorização. Curta: é uma ordem de pagamento assinada. */
const AUTHORIZATION_TTL_S = 3600;

/** Erro de carteira vem como `{code, message}` puro, não como `Error`. */
function describeRpcError(err: unknown): string {
  if (err && typeof err === 'object') {
    const { code, message } = err as { code?: number; message?: unknown };
    return `code=${code ?? '?'} ${String(message ?? err)}`;
  }
  return String(err);
}

/**
 * Nonce de 32 bytes da autorização.
 *
 * É o que impede a mesma assinatura de ser submetida duas vezes — o contrato
 * grava cada nonce gasto. Precisa ser imprevisível, então vem do
 * `crypto.getRandomValues` (polyfill nativo de `react-native-get-random-values`).
 */
function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return '0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Transfere USDC no Arc sem exigir troca de rede — a carteira embutida já
 * nasce no Arc, então isto é mais simples do que a versão WalletConnect
 * (não existe sessão multi-chain aqui para escopar).
 *
 * O usuário assina um typed data (EIP-3009 `transferWithAuthorization`) e o
 * backend submete on-chain pagando o gas.
 */
async function signAndRelayAuthorization(
  requester: Requester,
  from: string,
  to: string,
  amountUsdc: number,
): Promise<string> {
  const domain = await getUsdcAuthorizationDomain();
  const validBefore = Math.floor(Date.now() / 1000) + AUTHORIZATION_TTL_S;
  const nonce = randomNonce();
  // USDC tem 6 decimais; `Math.round` evita o 0.1+0.2 do ponto flutuante virar
  // um valor um wei menor que o pedido.
  const value = Math.round(amountUsdc * 1_000_000);

  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    domain,
    message: {
      from,
      to,
      value: String(value),
      validAfter: '0',
      validBefore: String(validBefore),
      nonce,
    },
  };

  console.log(`[3009] assinando: ${amountUsdc} USDC → ${to} | chainId ${domain.chainId}`);

  let signature: string;
  try {
    // A ordem dos parâmetros é [endereço, json] — invertida em relação a
    // `personal_sign`, e trocar devolve "invalid params" sem mais explicação.
    signature = (await requester.request({
      method: 'eth_signTypedData_v4',
      params: [from, JSON.stringify(typedData)],
    })) as string;
  } catch (err) {
    console.log('[3009] carteira recusou assinar:', describeRpcError(err));
    console.log('[3009] erro completo:', JSON.stringify(err, Object.getOwnPropertyNames(err ?? {})));
    throw err;
  }
  console.log(`[3009] assinatura recebida (${signature?.length ?? 0} chars)`);

  const relayed = await relayUsdcAuthorization({
    from_address: from,
    to_address: to,
    value,
    valid_after: 0,
    valid_before: validBefore,
    nonce,
    signature,
  });
  console.log(`[3009] relay ok: tx=${relayed.tx_hash} confirmada=${relayed.confirmed}`);
  return relayed.tx_hash;
}

/**
 * Assina uma mensagem UTF-8 via EIP-191 `personal_sign` — mesma codificação
 * hex e mesma ordem de parâmetros (`[mensagem, endereço]`) que o backend
 * espera em `eth_account.Account.recover_message(encode_defunct(text=message), ...)`.
 */
async function personalSign(requester: Requester, address: string, message: string): Promise<string> {
  const hex =
    '0x' + Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, '0')).join('');
  return (await requester.request({ method: 'personal_sign', params: [hex, address] })) as string;
}

/** O chainId numérico da carteira, ou `undefined` se ela não responder. */
async function currentChainId(requester: Requester): Promise<number | undefined> {
  try {
    const hex = (await requester.request({ method: 'eth_chainId' })) as string;
    const id = Number.parseInt(hex, 16);
    return Number.isFinite(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

/** A transação que o backend prepara em `execution.evm_tx`. */
export interface EvmTxRequest {
  to: string;
  data: string;
  value?: string;
}

/**
 * Assina e envia a transação preparada pelo backend, na carteira embutida.
 *
 * As duas defesas contra testnet custom que o web e o WalletConnect
 * descobriram continuam valendo mesmo com carteira embutida — o RPC do Arc é
 * o mesmo, então o mesmo comportamento de estimativa se aplica.
 */
async function sendTransaction(requester: Requester, from: string, tx: EvmTxRequest): Promise<string> {
  // Trava dura, e não só defensiva: o `to` é o contrato USDC do Arc e o
  // `data` é uma chamada ERC-20 — assinar isso fora do Arc seria perigoso,
  // não só inútil. A carteira embutida só existe nesta chain (`defaultChain`
  // do `PrivyProvider`), então isto não deveria disparar nunca — é a mesma
  // checagem que o WalletConnect precisava, mantida por segurança.
  const chainId = await currentChainId(requester);
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error(`Sua carteira está na chain ${chainId ?? 'desconhecida'}, não no Arc (${ARC_CHAIN_ID}).`);
  }

  const params: Record<string, string> = {
    from,
    to: tx.to,
    data: tx.data,
    value: tx.value ?? '0x0',
  };

  try {
    const estimate = (await requester.request({
      method: 'eth_estimateGas',
      params: [{ from, to: tx.to, data: tx.data, value: params.value }],
    })) as string;
    params.gas = '0x' + Math.ceil(Number.parseInt(estimate, 16) * 1.3).toString(16); // +30% de folga
  } catch {
    // estimativa falhou — segue sem gas explícito, a carteira estima do jeito dela
  }

  let triedEip1559 = false;
  try {
    const fees = await getArcGasFees();
    params.maxFeePerGas = fees.maxFeePerGasHex;
    params.maxPriorityFeePerGas = fees.maxPriorityFeePerGasHex;
    triedEip1559 = true;
  } catch {
    // sem fee explícito — a carteira tenta sozinha
  }

  try {
    return (await requester.request({ method: 'eth_sendTransaction', params: [params] })) as string;
  } catch (err) {
    // Algumas carteiras recusam o tipo EIP-1559 mesmo a chain suportando
    // (-32602). Refaz como transação legada em vez de propagar o erro.
    const code = (err as { code?: number } | null)?.code;
    const message = (err as { message?: string } | null)?.message ?? '';
    if (!triedEip1559 || code !== -32602 || !/EIP-1559/i.test(message)) throw err;

    delete params.maxFeePerGas;
    delete params.maxPriorityFeePerGas;
    try {
      params.gasPrice = (await requester.request({ method: 'eth_gasPrice' })) as string;
    } catch {
      // a carteira estima
    }
    return (await requester.request({ method: 'eth_sendTransaction', params: [params] })) as string;
  }
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { user, isReady, logout, getAccessToken } = usePrivy();
  const { wallets } = useEmbeddedEthereumWallet();
  const wallet = wallets[0] as EmbeddedWallet | undefined;
  const address = wallet?.address;

  /** Endereço já gravado como sessão nesta execução — evita regravar a cada render. */
  const established = useRef<string>(undefined);

  // Quando a carteira embutida existe, troca o access token do Privy por uma
  // sessão do backend (`/auth/session`) — é ela, e não mais o endereço cru, que
  // vai como `Bearer`, então o histórico/campanhas seguem a pessoa e não o
  // endereço. Depois vincula o endereço de payout a esse usuário.
  useEffect(() => {
    if (!isReady || !address) return;
    if (established.current === address.toLowerCase()) return;
    established.current = address.toLowerCase();

    const id = address.toLowerCase();
    void (async () => {
      let sessionId = id;
      let twitterUserId = id;
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('Privy sem access token');
        const res = await loginWithPrivy(token);
        sessionId = res.session_id;
        twitterUserId = res.twitter_user_id;
      } catch (err) {
        // ponytail: sem backend/Privy configurado cai na sessão legada (endereço
        // como Bearer) para o app não quebrar; remover quando o gate for obrigatório.
        console.warn('loginWithPrivy falhou, usando sessão legada:', err);
      }
      await Promise.all([
        saveSession({ sessionId, twitterUserId, handle: shortHash(address) }),
        saveWallet({ address, chain: 'arc' }),
      ]);
      if (sessionId !== id) {
        linkWallet(address).catch((err) => console.warn('linkWallet falhou:', err));
      }
    })();
  }, [isReady, address, getAccessToken]);

  const disconnect = async () => {
    try {
      await logout();
    } catch {
      // sessão já pode ter caído do lado do Privy — seguir e limpar mesmo assim
    }
    established.current = undefined;
    await Promise.all([clearWallet(), clearSession()]);
  };

  async function requester(): Promise<Requester> {
    if (!wallet) throw new Error('Nenhuma carteira conectada.');
    return (await wallet.getProvider()) as Requester;
  }

  async function signAndSend(tx: EvmTxRequest): Promise<string> {
    if (!address) throw new Error('Nenhuma carteira conectada.');
    return sendTransaction(await requester(), address, tx);
  }

  async function signAndRelay(to: string, amountUsdc: number): Promise<string> {
    if (!address) throw new Error('Nenhuma carteira conectada.');
    return signAndRelayAuthorization(await requester(), address, to, amountUsdc);
  }

  async function signMessage(message: string): Promise<string> {
    if (!address) throw new Error('Nenhuma carteira conectada.');
    return personalSign(await requester(), address, message);
  }

  const value = useMemo(
    () => ({
      isConnected: Boolean(user && address),
      address,
      chain: address ? 'arc' : undefined,
      disconnect,
      signAndSend,
      signAndRelay,
      signMessage,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, address],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function usePrivyWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('usePrivyWallet deve ser usado dentro de WalletProvider');
  }
  return ctx;
}
