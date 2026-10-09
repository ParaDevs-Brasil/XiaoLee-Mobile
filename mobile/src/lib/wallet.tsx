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
  useState,
  type ReactNode,
} from 'react';

import {
  getArcGasFees,
  getUsdcAuthorizationDomain,
  linkWallet,
  loginWithPrivy,
  relayUsdcAuthorization,
} from '@/api/backend';
import { useSession } from '@/hooks/use-session';
import { isRealSession } from '@/lib/auth-state';
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
  /**
   * Mensagem de falha ao trocar o login do Privy por uma sessão do backend, ou
   * `null`. Enquanto existir, a conta Privy está autenticada mas o app não
   * liberou o acesso — a tela de login mostra o erro e oferece `retrySession`.
   */
  sessionError: string | null;
  /** Tenta de novo a troca que falhou (`sessionError`). */
  retrySession: () => void;
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

  const { session, loading: sessionLoading } = useSession();
  const hasSession = isRealSession(session);
  const [sessionError, setSessionError] = useState<string | null>(null);
  /** Incrementa para reexecutar a troca depois de uma falha. */
  const [attempt, setAttempt] = useState(0);
  /** Há uma troca em andamento — evita duas `/auth/session` simultâneas. */
  const exchanging = useRef(false);
  /** Identificador sequencial da tentativa de troca. Evita race condition se o usuário cancelar/desconectar. */
  const exchangeSeq = useRef(0);

  // Com a carteira embutida pronta e sem sessão do backend, troca o access
  // token do Privy por uma (`/auth/session`) — é ela, e não o endereço cru, que
  // vai como `Bearer`, então histórico e campanhas seguem a pessoa. Depois
  // vincula o endereço de payout a esse usuário.
  //
  // Depender de `hasSession` (e não de "já fiz isso nesta execução") é o que
  // renova a sessão sozinha quando o `apiFetch` descarta uma expirada (401):
  // o Privy continua logado, então basta trocar o token de novo.
  //
  // Sem fallback para "endereço como Bearer": o app tem gate de login, e uma
  // sessão que o backend não reconhece só empurraria o erro para a próxima
  // tela. Falhou → `sessionError`, e o login oferece tentar de novo.
  useEffect(() => {
    // `user` na condição: depois do logout a carteira pode sobreviver por um
    // render, e uma troca disparada nessa janela falharia (sem token) e deixaria
    // um `sessionError` velho que faria o PRÓXIMO login cair direto em "couldn't
    // finish signing you in".
    if (!isReady || !user || !address || sessionLoading || hasSession) return;
    if (exchanging.current) return;
    exchanging.current = true;
    const currentSeq = ++exchangeSeq.current;

    void (async () => {
      try {
        const token = await getAccessToken();
        if (currentSeq !== exchangeSeq.current) return;
        if (!token) throw new Error('Privy sem access token');
        const res = await loginWithPrivy(token);
        if (currentSeq !== exchangeSeq.current) return;
        await Promise.all([
          saveSession({
            sessionId: res.session_id,
            twitterUserId: res.twitter_user_id,
            handle: shortHash(address),
          }),
          saveWallet({ address, chain: 'arc' }),
        ]);
        if (currentSeq !== exchangeSeq.current) return;
        setSessionError(null);
        linkWallet(address).catch((err) => console.warn('linkWallet falhou:', err));
      } catch (err) {
        if (currentSeq !== exchangeSeq.current) return;
        console.warn('loginWithPrivy falhou:', err);
        setSessionError(
          err instanceof Error && err.message
            ? err.message
            : 'Não foi possível entrar. Tente de novo.',
        );
      } finally {
        if (currentSeq === exchangeSeq.current) {
          exchanging.current = false;
        }
      }
    })();
  }, [isReady, user, address, sessionLoading, hasSession, attempt, getAccessToken]);

  const retrySession = () => {
    setSessionError(null);
    setAttempt((n) => n + 1);
  };

  const disconnect = async () => {
    // Invalida imediatamente qualquer troca de token em andamento
    exchangeSeq.current++;
    exchanging.current = false;
    setSessionError(null);
    try {
      await logout();
    } catch {
      // sessão já pode ter caído do lado do Privy — seguir e limpar mesmo assim
    }
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
      sessionError,
      retrySession,
      signAndSend,
      signAndRelay,
      signMessage,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, address, sessionError],
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
