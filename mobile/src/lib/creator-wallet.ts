/**
 * Modelo da carteira do creator — o que a tela de Wallet e a lista de
 * recebimentos mostram, separado de onde o dado vem.
 *
 * A carteira é a embutida do Privy, criada no login social: mesmo endereço EVM
 * de sempre, agora na Arc mainnet (`lib/arc-network.ts`). Esta camada é só
 * leitura — nada aqui assina, envia ou saca.
 *
 * Funções puras e sem import de alias, para rodarem no
 * `node --experimental-strip-types` dos testes (`creator-wallet.test.ts`).
 */

/**
 * De onde veio o dinheiro.
 *
 * - `campaign` — recompensa de campanha paga pelo agente.
 * - `purchase` — compra paga via x402 (alguém pagou pelo conteúdo do creator).
 * - `transfer` — USDC que entrou na carteira sem origem conhecida. É o que a
 *   fonte real devolve hoje: `GET /v1/arc/usdc/transfers/{address}` não diz
 *   de qual campanha ou compra veio a transferência.
 */
export type ReceiptSource = 'campaign' | 'purchase' | 'transfer';

/** `pending` = enfileirado (chain fora do ar) ou ainda sem confirmação. */
export type ReceiptStatus = 'confirmed' | 'pending';

export interface WalletReceipt {
  id: string;
  source: ReceiptSource;
  /** Nome da campanha, do item comprado ou "USDC received". */
  title: string;
  /** Quem pagou, já legível (ex.: "XiaoLee agent", `0x12ab…9f0e`). */
  payer: string | null;
  amountUsdc: number;
  /** Hash da transação na Arc, ou `null` enquanto não há uma. */
  txHash: string | null;
  /** ISO 8601. */
  createdAt: string;
  status: ReceiptStatus;
}

export interface WalletSnapshot {
  balanceUsdc: number;
  receipts: WalletReceipt[];
}

export type ReceiptFilter = 'all' | 'campaign' | 'purchase';

/**
 * Instante do backend em ISO que todo engine lê igual, ou o valor cru se não
 * parsear.
 *
 * O `created_at` vem de `datetime.isoformat()` no Python: microssegundos
 * (seis casas, que o Hermes pode recusar — ver `parseTimestamp` em
 * `format.ts`) e, quando o banco devolve datetime sem fuso (SQLite em dev),
 * sem offset nenhum — e aí o JS leria como hora local, deslocando o
 * recebimento em 3h no Brasil. O backend grava em UTC, então sem offset é UTC.
 */
export function normalizeIso(raw: string): string {
  let iso = raw.trim().replace(/(\.\d{3})\d+/, '$1');
  if (/T\d{2}:\d{2}/.test(iso) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(iso)) iso += 'Z';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? raw : new Date(ms).toISOString();
}

/** Chain ids da Arc — os mesmos de `lib/arc-network.ts` e do `ARC_CHAIN_ID` do backend. */
export const ARC_MAINNET_CHAIN_ID = 5042;
export const ARC_TESTNET_CHAIN_ID = 5042002;

/** Nome legível de uma chain, para dizer ao creator qual rede está em jogo. */
export function chainLabel(chainId: number): string {
  if (chainId === ARC_MAINNET_CHAIN_ID) return 'Arc mainnet';
  if (chainId === ARC_TESTNET_CHAIN_ID) return 'Arc testnet';
  return `chain ${chainId}`;
}

/**
 * O app e o backend estão em redes diferentes?
 *
 * O selo de rede da tela vem do build do app (`EXPO_PUBLIC_ARC_NETWORK`), mas
 * o saldo vem do backend, que lê a chain dele (`ARC_CHAIN_ID`). Se um for para
 * a mainnet antes do outro, a tela mostraria o saldo de uma rede com o nome
 * da outra — é isso que esta checagem impede.
 */
export interface NetworkMismatch {
  appChainId: number;
  backendChainId: number;
}

export function detectNetworkMismatch(appChainId: number, backendChainId: number): NetworkMismatch | null {
  return appChainId === backendChainId ? null : { appChainId, backendChainId };
}

/** Há origem conhecida (campanha ou compra) em algum recebimento? */
export function hasKnownSource(receipts: WalletReceipt[]): boolean {
  return receipts.some((item) => item.source !== 'transfer');
}

/** Mais recente primeiro. Data que não parseia vai pro fim, não pro topo. */
export function sortReceipts(receipts: WalletReceipt[]): WalletReceipt[] {
  const at = (item: WalletReceipt) => {
    const ms = Date.parse(item.createdAt);
    return Number.isNaN(ms) ? -Infinity : ms;
  };
  return [...receipts].sort((a, b) => at(b) - at(a));
}

export function filterReceipts(receipts: WalletReceipt[], filter: ReceiptFilter): WalletReceipt[] {
  return filter === 'all' ? receipts : receipts.filter((item) => item.source === filter);
}

export interface InflowSplit {
  campaign: number;
  purchase: number;
  transfer: number;
  total: number;
}

/**
 * Quanto entrou por origem, só do que já confirmou — o pendente ainda não está
 * no saldo, e somá-lo faria a faixa prometer mais do que a carteira tem.
 *
 * `sinceMs` corta a janela (ex.: últimos 30 dias); sem ele, soma tudo.
 */
export function inflowBySource(receipts: WalletReceipt[], sinceMs?: number): InflowSplit {
  const split: InflowSplit = { campaign: 0, purchase: 0, transfer: 0, total: 0 };

  for (const item of receipts) {
    if (item.status !== 'confirmed') continue;
    if (sinceMs !== undefined && !(Date.parse(item.createdAt) >= sinceMs)) continue;
    split[item.source] += item.amountUsdc;
    split.total += item.amountUsdc;
  }

  return split;
}

export interface ReceiptDay {
  key: string;
  label: string;
  items: WalletReceipt[];
}

/** `YYYY-MM-DD` no fuso do aparelho — "hoje" é o dia de quem está olhando. */
function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Agrupa por dia, na ordem recebida (passe por `sortReceipts` antes).
 * Os rótulos são "Today", "Yesterday" ou a data curta ("Oct 12").
 */
export function groupReceiptsByDay(receipts: WalletReceipt[], now: number = Date.now()): ReceiptDay[] {
  const today = localDayKey(now);
  const yesterday = localDayKey(now - 86_400_000);
  const days: ReceiptDay[] = [];

  for (const item of receipts) {
    const ms = Date.parse(item.createdAt);
    const key = Number.isNaN(ms) ? 'unknown' : localDayKey(ms);
    let day = days.find((entry) => entry.key === key);
    if (!day) {
      const label =
        key === today
          ? 'Today'
          : key === yesterday
            ? 'Yesterday'
            : key === 'unknown'
              ? 'Earlier'
              : new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      day = { key, label, items: [] };
      days.push(day);
    }
    day.items.push(item);
  }

  return days;
}

/**
 * Endereço EVM em blocos de 4 depois do `0x` — `0x 3a7F 9c21 …`.
 *
 * Quem confere um endereço compara pedaços, não 42 caracteres corridos; os
 * blocos dão onde apoiar o olho. Qualquer coisa que não pareça um endereço
 * volta inteira num bloco só.
 */
export function addressChunks(address: string): string[] {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return [address];
  const hex = address.slice(2);
  const chunks = ['0x'];
  for (let i = 0; i < hex.length; i += 4) chunks.push(hex.slice(i, i + 4));
  return chunks;
}

/** Começo e fim, meio elidido — a mesma forma do painel de perfil. */
export function shortAddress(address: string): string {
  return address.length <= 16 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// ── Detalhamento das entradas ───────────────────────────────────────────────

/**
 * Janelas do detalhamento — cada uma responde uma pergunta diferente, sem
 * sobreposição:
 *
 *  - `7d` / `30d` / `90d` — "como estou indo agora?", em semana, mês e
 *    trimestre móveis (as unidades em que se pensa dinheiro);
 *  - `all` — "quanto já ganhei no total?";
 *  - `month` — "quanto ganhei em setembro?": mês do calendário, navegável
 *    (`monthOffset`). É a unidade de extrato e de imposto (MEI, carnê-leão), e
 *    nenhuma janela móvel responde isso. "Este mês" sozinho era redundante com
 *    os 30 dias; poder voltar meses é o que justifica a opção.
 */
export type InflowPeriod = '7d' | '30d' | '90d' | 'all' | 'month';

export const INFLOW_PERIODS: { key: InflowPeriod; label: string; long: string }[] = [
  { key: '7d', label: '7D', long: 'last 7 days' },
  { key: '30d', label: '30D', long: 'last 30 days' },
  { key: '90d', label: '90D', long: 'last 90 days' },
  { key: 'all', label: 'All', long: 'all time' },
  // `long` do mês vem de `monthLabel` — depende de qual mês está aberto.
  { key: 'month', label: 'Month', long: 'by month' },
];

/** Janela `[since, until)` em ms — `until` exclusivo, para meses não se sobreporem. */
export interface PeriodBounds {
  since: number;
  until: number;
}

/**
 * Limites da janela. `monthOffset` só vale para `month`: 0 = mês corrente,
 * 1 = o anterior, e assim por diante — meia-noite do dia 1 no fuso do
 * aparelho, até a meia-noite do dia 1 do mês seguinte.
 */
export function periodBounds(period: InflowPeriod, now: number = Date.now(), monthOffset = 0): PeriodBounds {
  if (period === 'all') return { since: -Infinity, until: Infinity };
  if (period === 'month') {
    const d = new Date(now);
    return {
      since: new Date(d.getFullYear(), d.getMonth() - monthOffset, 1).getTime(),
      until: new Date(d.getFullYear(), d.getMonth() - monthOffset + 1, 1).getTime(),
    };
  }
  const days = Number.parseInt(period, 10);
  return { since: now - days * 86_400_000, until: Infinity };
}

/** "October 2026" para o mês `monthOffset` meses atrás. */
export function monthLabel(monthOffset: number, now: number = Date.now()): string {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() - monthOffset, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Quantos meses dá para voltar: até o mês do recebimento mais antigo. Sem
 * recebimento nenhum, 0 — só o mês corrente. Voltar a um mês antes do
 * primeiro pagamento só mostraria vazio.
 */
export function oldestMonthOffset(receipts: WalletReceipt[], now: number = Date.now()): number {
  const times = receipts.map((item) => Date.parse(item.createdAt)).filter((ms) => !Number.isNaN(ms));
  if (times.length === 0) return 0;
  const oldest = new Date(Math.min(...times));
  const current = new Date(now);
  const months =
    (current.getFullYear() - oldest.getFullYear()) * 12 + (current.getMonth() - oldest.getMonth());
  return Math.max(0, months);
}

/**
 * Porcentagens inteiras que somam exatamente 100 (maior resto). Arredondar
 * cada uma sozinha dá 99% ou 101% no total — e o creator soma de cabeça.
 */
export function sharePercents(values: number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((sum, v) => sum + v, 0);
  const order = raw.map((v, i) => ({ i, rest: v - floors[i] })).sort((a, b) => b.rest - a.rest);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/** Uma campanha, um item vendido ou um pagador — o "o que rendeu" dentro da origem. */
export interface BreakdownItem {
  title: string;
  total: number;
  count: number;
}

export interface SourceBreakdown {
  source: ReceiptSource;
  total: number;
  count: number;
  /** Fatia do total do período, em % inteiro (soma 100 entre as origens). */
  percent: number;
  /** Maior primeiro. */
  items: BreakdownItem[];
}

export interface InflowBreakdown {
  total: number;
  count: number;
  /** Só origens com valor, na ordem fixa campanha → compra → transferência (a cor segue a origem). */
  sources: SourceBreakdown[];
  /** O que entrou na janela mas ainda não confirmou — fora do total. */
  pending: { total: number; count: number };
}

/** Ordem fixa das origens em todo gráfico — a cor segue a origem, nunca a posição. */
export const SOURCE_ORDER: ReceiptSource[] = ['campaign', 'purchase', 'transfer'];

/**
 * O detalhamento do período: total, divisão por origem e, dentro de cada uma,
 * o que mais rendeu. Mesma regra da faixa (`inflowBySource`): só o confirmado
 * entra no total; o pendente aparece à parte.
 */
export function breakdownInflow(receipts: WalletReceipt[], bounds: PeriodBounds): InflowBreakdown {
  const inWindow = receipts.filter((item) => {
    const at = Date.parse(item.createdAt);
    return at >= bounds.since && at < bounds.until;
  });
  const confirmed = inWindow.filter((item) => item.status === 'confirmed');
  const pendingItems = inWindow.filter((item) => item.status === 'pending');

  const present = SOURCE_ORDER.map((source) => {
    const ofSource = confirmed.filter((item) => item.source === source);
    const byTitle = new Map<string, BreakdownItem>();
    for (const item of ofSource) {
      const entry = byTitle.get(item.title) ?? { title: item.title, total: 0, count: 0 };
      entry.total += item.amountUsdc;
      entry.count += 1;
      byTitle.set(item.title, entry);
    }
    return {
      source,
      total: ofSource.reduce((sum, item) => sum + item.amountUsdc, 0),
      count: ofSource.length,
      percent: 0,
      items: [...byTitle.values()].sort((a, b) => b.total - a.total),
    };
  }).filter((entry) => entry.total > 0);

  const percents = sharePercents(present.map((entry) => entry.total));
  present.forEach((entry, i) => {
    entry.percent = percents[i];
  });

  return {
    total: present.reduce((sum, entry) => sum + entry.total, 0),
    count: confirmed.length,
    sources: present,
    pending: {
      total: pendingItems.reduce((sum, item) => sum + item.amountUsdc, 0),
      count: pendingItems.length,
    },
  };
}
