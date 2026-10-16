/**
 * Dados de exemplo da carteira do creator — para navegar e revisar as telas
 * sem depender da mainnet nem de dinheiro de verdade.
 *
 * Ligado por `EXPO_PUBLIC_WALLET_MOCK` (build) ou pelo seletor de estados que
 * só aparece em `__DEV__` (ver `hooks/use-creator-wallet.ts`). Os hashes são
 * inventados: o link do explorer abre, mas a transação não existe lá.
 */

import type { WalletReceipt, WalletSnapshot } from './creator-wallet';

/** Estados que dá para forçar na tela. `off` = dado real. */
export type WalletMockMode = 'off' | 'funded' | 'empty' | 'loading' | 'error' | 'mismatch';

export const WALLET_MOCK_MODES: WalletMockMode[] = ['off', 'funded', 'empty', 'loading', 'error', 'mismatch'];

export function parseWalletMockMode(raw: string | undefined): WalletMockMode {
  const value = raw?.trim().toLowerCase();
  return WALLET_MOCK_MODES.includes(value as WalletMockMode) ? (value as WalletMockMode) : 'off';
}

/** Como o pagador aparece quando quem pagou foi o agente. */
const AGENT = 'XiaoLee agent';

/** Hash de 64 hex derivado do índice — estável entre renders. */
function fakeHash(seed: number): string {
  let hex = '';
  let x = seed * 2654435761;
  while (hex.length < 64) {
    x = (x * 1103515245 + 12345) >>> 0;
    hex += x.toString(16).padStart(8, '0');
  }
  return `0x${hex.slice(0, 64)}`;
}

/** [horas atrás, origem, título, pagador, valor, status] */
type Row = [number, WalletReceipt['source'], string, string | null, number, WalletReceipt['status']];

const FUNDED_ROWS: Row[] = [
  [0.4, 'purchase', 'Clip pack · "Morning routine"', '0x8b21…4c0d', 4.0, 'pending'],
  [2, 'campaign', 'Summer drop — repost', AGENT, 12.5, 'confirmed'],
  [5, 'purchase', 'Full video · "Studio tour"', '0x51fe…a913', 9.0, 'confirmed'],
  [26, 'campaign', 'Arc launch week', AGENT, 25.0, 'confirmed'],
  [30, 'transfer', 'USDC received', '0x3c90…77b2', 3.25, 'confirmed'],
  [74, 'purchase', 'Clip · "Behind the beat"', '0x8b21…4c0d', 1.5, 'confirmed'],
  [98, 'campaign', 'Creator challenge #3', AGENT, 18.0, 'confirmed'],
  [170, 'campaign', 'Follow & share — Lepton', AGENT, 6.0, 'confirmed'],
  [310, 'purchase', 'Full video · "Street session"', '0xd04a…1e58', 7.75, 'confirmed'],
  // Mais antigos, para os filtros de 60/90 dias mostrarem algo diferente do
  // de 30 — e um título repetido, para o detalhamento agrupar por campanha.
  [480, 'campaign', 'Arc launch week', AGENT, 15.0, 'confirmed'],
  [1080, 'purchase', 'Clip pack · "Morning routine"', '0x51fe…a913', 6.0, 'confirmed'],
  [1800, 'campaign', 'Creator challenge #2', AGENT, 30.0, 'confirmed'],
];

function snapshotFrom(rows: Row[], now: number): WalletReceipt[] {
  return rows.map(([hoursAgo, source, title, payer, amountUsdc, status], i) => ({
    id: `mock-${i}`,
    source,
    title,
    payer,
    amountUsdc,
    txHash: status === 'pending' ? null : fakeHash(i + 1),
    createdAt: new Date(now - hoursAgo * 3_600_000).toISOString(),
    status,
  }));
}

/**
 * Retrato da carteira para um modo com dado (`funded` | `empty`).
 * O saldo do `funded` é a soma do que confirmou — o pendente não entra.
 */
export function mockWalletSnapshot(mode: 'funded' | 'empty', now: number = Date.now()): WalletSnapshot {
  if (mode === 'empty') return { balanceUsdc: 0, receipts: [] };

  const receipts = snapshotFrom(FUNDED_ROWS, now);
  const balanceUsdc = receipts
    .filter((item) => item.status === 'confirmed')
    .reduce((sum, item) => sum + item.amountUsdc, 0);
  return { balanceUsdc, receipts };
}
