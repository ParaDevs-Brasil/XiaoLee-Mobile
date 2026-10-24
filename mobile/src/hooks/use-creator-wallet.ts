import { useState } from 'react';
import { create } from 'zustand';

import { getAddressBalance, getArcChainConfig, listArcTransfers, type ArcTransfer } from '@/api/backend';
import { ApiError } from '@/api/client';
import { useBackendData } from '@/hooks/use-backend-data';
import { ARC_NETWORK } from '@/lib/arc-network';
import {
  detectNetworkMismatch,
  normalizeIso,
  shortAddress,
  sortReceipts,
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  type NetworkMismatch,
  type WalletReceipt,
  type WalletSnapshot,
} from '@/lib/creator-wallet';
import {
  mockWalletSnapshot,
  parseWalletMockMode,
  type WalletMockMode,
} from '@/lib/creator-wallet-mock';

/**
 * A carteira do creator como as telas consomem: endereço, saldo USDC na Arc e
 * recebimentos — de verdade ou de exemplo, sem a tela saber qual.
 *
 * O endereço é o de `useWallet()` (a carteira embutida do Privy), lido pela
 * rota e passado aqui — ver `walletKey`. Este hook só lê: nada aqui assina nem
 * move dinheiro.
 *
 * Fonte real, hoje:
 *  - saldo — `GET /v1/arc/balance/{address}`, consultado a cada 5s em foco;
 *  - recebimentos — as transferências de entrada de
 *    `GET /v1/arc/usdc/transfers/{address}`. Elas não dizem de qual campanha
 *    ou compra vieram, então chegam como `transfer` ("USDC received"). Quando
 *    o backend expuser a origem, é só mapear aqui — as telas já sabem
 *    desenhar `campaign` e `purchase`.
 */

/**
 * Modo de exemplo, compartilhado entre a home da carteira e a lista de
 * recebimentos (por isso store e não estado local). Nasce de
 * `EXPO_PUBLIC_WALLET_MOCK`; o `WalletMockSwitcher` troca em tempo de
 * execução.
 *
 * **Só existe em `__DEV__`.** Num build de release o modo é sempre `off`, com
 * ou sem a variável: um `EXPO_PUBLIC_WALLET_MOCK` esquecido no `.env` de quem
 * gerou o APK não pode mostrar saldo de mentira para um creator de verdade.
 */
interface MockState {
  mode: WalletMockMode;
  setMode: (mode: WalletMockMode) => void;
}

export const useWalletMockMode = create<MockState>((set) => ({
  mode: __DEV__ ? parseWalletMockMode(process.env.EXPO_PUBLIC_WALLET_MOCK) : 'off',
  setMode: (mode) => set({ mode: __DEV__ ? mode : 'off' }),
}));

const MOCK_ERROR = "Can't reach the Arc network right now. Your funds are safe — check your connection and try again.";

/**
 * O que o creator lê quando o saldo não vem. O `detail` do backend é recado
 * de infra ("ARC_RPC_URL not configured") — útil para quem desenvolve, ruído
 * para quem só quer ver o próprio dinheiro. Em `__DEV__` ele vai junto, entre
 * parênteses, para o diagnóstico não sumir.
 */
function balanceError(err: unknown): ApiError {
  // Sem rede o problema é a conexão do aparelho, não a Arc. A frase do
  // `apiFetch` diz isso, mas em português — e a Wallet é em inglês.
  if (err instanceof ApiError && err.isNetworkError) {
    return new ApiError("Can't reach XiaoLee right now. Check your connection and try again.", null, true);
  }
  const detail = err instanceof Error ? err.message : String(err);
  const message = "Arc isn't answering right now. Your funds are safe — try again in a moment.";
  return new ApiError(
    __DEV__ ? `${message} (${detail})` : message,
    err instanceof ApiError ? err.status : null,
    false,
  );
}

/**
 * `mismatch` = o app e o backend estão em redes diferentes; o saldo nem é
 * buscado (ver `detectNetworkMismatch`).
 */
export type CreatorWalletStatus = 'loading' | 'error' | 'mismatch' | 'ready';

export interface CreatorWallet {
  address: string | undefined;
  /**
   * O endereço ainda está sendo lido (SecureStore/Privy). Sem isto, a tela
   * mostraria "sem carteira" por um instante a quem tem carteira.
   */
  addressLoading: boolean;
  status: CreatorWalletStatus;
  balanceUsdc: number;
  /** Mais recente primeiro. `null` = a lista falhou, mas o saldo veio. */
  receipts: WalletReceipt[] | null;
  /** Mensagem exibível quando `status === 'error'`. */
  error: string | null;
  /** As duas redes em jogo quando `status === 'mismatch'`. */
  mismatch: NetworkMismatch | null;
  /**
   * A última consulta falhou, mas há um saldo anterior na tela. Sem o aviso,
   * um saldo velho passaria por atual — a consulta roda a cada 5s.
   */
  stale: boolean;
  refreshing: boolean;
  reload: () => void;
  /** Dado de exemplo na tela — a UI marca isso para ninguém confundir com saldo real. */
  isMock: boolean;
}

function receiptFromTransfer(transfer: ArcTransfer): WalletReceipt {
  return {
    id: transfer.tx_hash,
    source: 'transfer',
    title: 'USDC received',
    payer: shortAddress(transfer.from_address),
    amountUsdc: transfer.amount_usdc,
    txHash: transfer.tx_hash,
    createdAt: normalizeIso(transfer.created_at),
    status: 'confirmed',
  };
}

type RealSnapshot = Omit<WalletSnapshot, 'receipts'> & {
  receipts: WalletReceipt[] | null;
  mismatch: NetworkMismatch | null;
};

/**
 * Chain do backend, buscada uma vez por sessão do app: ela não muda com o app
 * aberto, e o saldo é consultado a cada 5s. Uma falha não fica em cache — a
 * próxima consulta tenta de novo.
 */
let backendChainId: Promise<number> | null = null;

function getBackendChainId(): Promise<number> {
  backendChainId ??= getArcChainConfig()
    .then((config) => config.chainId)
    .catch((err: unknown) => {
      backendChainId = null;
      throw err;
    });
  return backendChainId;
}

/**
 * Saldo é o que decide se a tela tem dado: sem ele, erro. A lista é
 * acessória — se só ela falhar, o saldo segue na tela e a lista avisa sozinha.
 */
async function fetchRealSnapshot(address: string): Promise<RealSnapshot> {
  // Rede primeiro: com o backend em outra chain, o saldo que ele devolveria é
  // de outra rede — nem vale buscar. Sem conseguir confirmar a rede, também
  // não mostramos saldo: vira o erro comum, com "Try again".
  const chainId = await getBackendChainId().catch((err: unknown) => {
    throw balanceError(err);
  });
  const mismatch = detectNetworkMismatch(ARC_NETWORK.chainId, chainId);
  if (mismatch) {
    // Fora do cache: quando o backend for corrigido, o próximo ciclo do
    // polling já enxerga a rede certa, sem precisar reabrir o app.
    backendChainId = null;
    return { balanceUsdc: 0, receipts: [], mismatch };
  }

  const [balance, transfers] = await Promise.all([
    getAddressBalance(address).catch((err: unknown) => {
      throw balanceError(err);
    }),
    listArcTransfers(address).catch(() => null),
  ]);
  // `ApiError` e não `Error`: `useBackendData` só repassa a mensagem limpa do
  // primeiro — de um `Error` qualquer a tela mostraria "Error: …".
  if (balance === null) throw balanceError(new Error('balance endpoint returned no usdc_balance'));

  return {
    mismatch: null,
    balanceUsdc: balance,
    receipts: transfers
      ? transfers.filter((item) => item.direction === 'in').map(receiptFromTransfer)
      : null,
  };
}

/**
 * `useBackendData` refaz a busca quando a sessão muda, não quando o endereço
 * ou o modo mudam — monte quem chama este hook com
 * `key={walletKey(address, mode)}` para remontar e buscar de novo.
 *
 * O endereço vem de **fora** do componente remontado, por prop: um
 * `useWallet()` chamado lá dentro nasceria vazio a cada remontagem (o
 * SecureStore é lido de novo), a primeira busca sairia sem endereço e o saldo
 * só chegaria no próximo ciclo do polling.
 */
export function walletKey(address: string | undefined, mode: WalletMockMode): string {
  return `${address ?? 'no-wallet'}:${mode}`;
}

export function useCreatorWallet(realAddress: string | undefined, addressLoading: boolean): CreatorWallet {
  const mode = useWalletMockMode((state) => state.mode);
  const isMock = mode !== 'off';
  // No modo de exemplo não há busca, mas o pull-to-refresh precisa ver
  // `refreshing` ligar e desligar — no iOS, sem isso, o spinner fica preso.
  const [mockRefreshing, setMockRefreshing] = useState(false);

  // Sempre chamado (regra dos hooks); no modo de exemplo resolve `null` e não
  // consulta nada.
  const real = useBackendData<RealSnapshot | null>(
    () => (!isMock && realAddress ? fetchRealSnapshot(realAddress) : Promise.resolve(null)),
    { pollMs: isMock ? undefined : 5000 },
  );

  if (isMock) {
    // O endereço é sempre o real, nunca um inventado: o QR desta tela é
    // escaneável, e USDC mandado para um endereço de exemplo se perderia.
    const base = {
      address: realAddress,
      addressLoading,
      stale: false,
      mismatch: null,
      refreshing: mockRefreshing,
      reload: () => {
        setMockRefreshing(true);
        setTimeout(() => setMockRefreshing(false), 600);
      },
      isMock,
      balanceUsdc: 0,
      receipts: [],
    };
    if (mode === 'loading') return { ...base, status: 'loading', error: null };
    if (mode === 'error') return { ...base, status: 'error', error: MOCK_ERROR };
    if (mode === 'mismatch') {
      // A rede "do outro lado" é qualquer uma diferente da do build.
      const other = ARC_NETWORK.chainId === ARC_TESTNET_CHAIN_ID ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID;
      return { ...base, status: 'mismatch', error: null, mismatch: { appChainId: ARC_NETWORK.chainId, backendChainId: other } };
    }

    const snap = mockWalletSnapshot(mode);
    return { ...base, status: 'ready', error: null, ...snap, receipts: sortReceipts(snap.receipts) };
  }

  // Sem dado e sem erro é carga: inclusive o instante antes do endereço
  // existir, em que o fetcher resolveu `null`.
  const status: CreatorWalletStatus = real.data
    ? real.data.mismatch
      ? 'mismatch'
      : 'ready'
    : real.error
      ? 'error'
      : 'loading';
  const receipts = real.data?.receipts;

  return {
    address: realAddress,
    addressLoading,
    status,
    balanceUsdc: real.data?.balanceUsdc ?? 0,
    receipts: receipts === undefined ? [] : receipts && sortReceipts(receipts),
    error: real.error,
    mismatch: real.data?.mismatch ?? null,
    stale: Boolean(real.data && real.error),
    refreshing: real.refreshing,
    reload: real.reload,
    isMock,
  };
}
