/**
 * Check do modelo da carteira do creator. Roda com:
 *   node --experimental-strip-types src/lib/creator-wallet.test.ts
 *
 * Sem framework, como os outros testes de `lib/`.
 */
import assert from 'node:assert/strict';

import {
  addressChunks,
  breakdownInflow,
  chainLabel,
  detectNetworkMismatch,
  filterReceipts,
  groupReceiptsByDay,
  hasKnownSource,
  inflowBySource,
  normalizeIso,
  monthLabel,
  oldestMonthOffset,
  periodBounds,
  sharePercents,
  shortAddress,
  sortReceipts,
  type WalletReceipt,
} from './creator-wallet.ts';
import { mockWalletSnapshot, parseWalletMockMode } from './creator-wallet-mock.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`  ok  ${name}`);
}

function receipt(overrides: Partial<WalletReceipt>): WalletReceipt {
  return {
    id: 'r',
    source: 'campaign',
    title: 'Campaign',
    payer: null,
    amountUsdc: 1,
    txHash: null,
    createdAt: '2026-10-14T12:00:00.000Z',
    status: 'confirmed',
    ...overrides,
  };
}

console.log('creator-wallet');

test('sortReceipts põe o mais recente primeiro e data inválida no fim', () => {
  const sorted = sortReceipts([
    receipt({ id: 'old', createdAt: '2026-10-01T00:00:00Z' }),
    receipt({ id: 'bad', createdAt: 'not a date' }),
    receipt({ id: 'new', createdAt: '2026-10-14T00:00:00Z' }),
  ]);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ['new', 'old', 'bad'],
  );
});

test('filterReceipts filtra por origem; all devolve tudo', () => {
  const list = [receipt({ id: 'c' }), receipt({ id: 'p', source: 'purchase' }), receipt({ id: 't', source: 'transfer' })];
  assert.equal(filterReceipts(list, 'all').length, 3);
  assert.deepEqual(
    filterReceipts(list, 'purchase').map((item) => item.id),
    ['p'],
  );
});

test('inflowBySource ignora pendente e respeita a janela', () => {
  const split = inflowBySource(
    [
      receipt({ amountUsdc: 10 }),
      receipt({ source: 'purchase', amountUsdc: 4 }),
      receipt({ source: 'purchase', amountUsdc: 99, status: 'pending' }),
      receipt({ amountUsdc: 50, createdAt: '2026-08-01T00:00:00Z' }),
    ],
    Date.parse('2026-09-14T00:00:00Z'),
  );
  assert.deepEqual(split, { campaign: 10, purchase: 4, transfer: 0, total: 14 });
});

test('groupReceiptsByDay rotula hoje, ontem e data curta', () => {
  const now = new Date(2026, 9, 14, 15, 0).getTime();
  const days = groupReceiptsByDay(
    [
      receipt({ id: 'a', createdAt: new Date(2026, 9, 14, 9, 0).toISOString() }),
      receipt({ id: 'b', createdAt: new Date(2026, 9, 14, 1, 0).toISOString() }),
      receipt({ id: 'c', createdAt: new Date(2026, 9, 13, 22, 0).toISOString() }),
      receipt({ id: 'd', createdAt: new Date(2026, 9, 2, 12, 0).toISOString() }),
    ],
    now,
  );
  assert.deepEqual(
    days.map((day) => [day.label, day.items.map((item) => item.id)]),
    [
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Oct 2', ['d']],
    ],
  );
});

test('addressChunks quebra em blocos de 4 depois do 0x', () => {
  const chunks = addressChunks('0x3a7F9c21B04e5D6a8E1f2C3b4A5d6E7f8091b04E');
  assert.equal(chunks.length, 11);
  assert.equal(chunks[0], '0x');
  assert.equal(chunks[1], '3a7F');
  assert.equal(chunks.at(-1), 'b04E');
  assert.deepEqual(addressChunks('not-an-address'), ['not-an-address']);
});

test('shortAddress mantém começo e fim', () => {
  assert.equal(shortAddress('0x3a7F9c21B04e5D6a8E1f2C3b4A5d6E7f8091b04E'), '0x3a7F…b04E');
  assert.equal(shortAddress('0x1234'), '0x1234');
});

test('normalizeIso corta microssegundos e trata sem offset como UTC', () => {
  assert.equal(normalizeIso('2026-10-14T12:00:00.123456+00:00'), '2026-10-14T12:00:00.123Z');
  assert.equal(normalizeIso('2026-10-14T12:00:00.123456'), '2026-10-14T12:00:00.123Z');
  assert.equal(normalizeIso('2026-10-14T09:00:00-03:00'), '2026-10-14T12:00:00.000Z');
  assert.equal(normalizeIso('lixo'), 'lixo');
});

test('hasKnownSource só é verdade com campanha ou compra', () => {
  assert.equal(hasKnownSource([receipt({ source: 'transfer' })]), false);
  assert.equal(hasKnownSource([receipt({ source: 'transfer' }), receipt({ source: 'purchase' })]), true);
  assert.equal(hasKnownSource([]), false);
});

test('detectNetworkMismatch só acusa chains diferentes', () => {
  assert.equal(detectNetworkMismatch(5042, 5042), null);
  assert.deepEqual(detectNetworkMismatch(5042, 5042002), { appChainId: 5042, backendChainId: 5042002 });
});

test('chainLabel nomeia mainnet, testnet e o resto pelo id', () => {
  assert.equal(chainLabel(5042), 'Arc mainnet');
  assert.equal(chainLabel(5042002), 'Arc testnet');
  assert.equal(chainLabel(1), 'chain 1');
});

test('sharePercents arredonda pelo maior resto e soma 100', () => {
  assert.deepEqual(sharePercents([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(sharePercents([61.5, 18.25, 3.25]), [74, 22, 4]);
  assert.deepEqual(sharePercents([0, 0]), [0, 0]);
  assert.equal(sharePercents([2, 3, 5, 7]).reduce((a, b) => a + b, 0), 100);
});

test('periodBounds: janelas móveis, tudo e mês do calendário sem sobreposição', () => {
  const now = new Date(2026, 9, 15, 12, 0).getTime();
  assert.deepEqual(periodBounds('7d', now), { since: now - 7 * 86_400_000, until: Infinity });
  assert.deepEqual(periodBounds('90d', now), { since: now - 90 * 86_400_000, until: Infinity });
  assert.deepEqual(periodBounds('all', now), { since: -Infinity, until: Infinity });
  assert.deepEqual(periodBounds('month', now), {
    since: new Date(2026, 9, 1).getTime(),
    until: new Date(2026, 10, 1).getTime(),
  });
  // Setembro termina exatamente onde outubro começa.
  assert.equal(periodBounds('month', now, 1).until, periodBounds('month', now, 0).since);
  // Virada de ano: 10 meses antes de outubro/2026 é dezembro/2025.
  assert.equal(periodBounds('month', now, 10).since, new Date(2025, 11, 1).getTime());
});

test('monthLabel nomeia o mês com o ano', () => {
  const now = new Date(2026, 9, 15).getTime();
  assert.equal(monthLabel(0, now), 'October 2026');
  assert.equal(monthLabel(10, now), 'December 2025');
});

test('oldestMonthOffset vai até o mês do recebimento mais antigo', () => {
  const now = new Date(2026, 9, 15).getTime();
  assert.equal(oldestMonthOffset([], now), 0);
  assert.equal(oldestMonthOffset([receipt({ createdAt: new Date(2026, 9, 2).toISOString() })], now), 0);
  assert.equal(
    oldestMonthOffset(
      [
        receipt({ createdAt: new Date(2026, 8, 30).toISOString() }),
        receipt({ createdAt: new Date(2026, 6, 1).toISOString() }),
        receipt({ createdAt: 'lixo' }),
      ],
      now,
    ),
    3,
  );
});

test('breakdownInflow: total confirmado, origens na ordem fixa, itens do maior pro menor', () => {
  const since = Date.parse('2026-10-01T00:00:00Z');
  const result = breakdownInflow(
    [
      receipt({ source: 'purchase', title: 'Clip A', amountUsdc: 2, createdAt: '2026-10-10T00:00:00Z' }),
      receipt({ source: 'campaign', title: 'Drop', amountUsdc: 5, createdAt: '2026-10-11T00:00:00Z' }),
      receipt({ source: 'campaign', title: 'Launch', amountUsdc: 10, createdAt: '2026-10-12T00:00:00Z' }),
      receipt({ source: 'campaign', title: 'Drop', amountUsdc: 5, createdAt: '2026-10-13T00:00:00Z' }),
      receipt({ source: 'purchase', title: 'Clip B', amountUsdc: 9, status: 'pending', createdAt: '2026-10-14T00:00:00Z' }),
      receipt({ source: 'campaign', title: 'Velha', amountUsdc: 99, createdAt: '2026-09-01T00:00:00Z' }),
    ],
    { since, until: Infinity },
  );
  assert.equal(result.total, 22);
  assert.equal(result.count, 4);
  assert.deepEqual(result.pending, { total: 9, count: 1 });
  assert.deepEqual(
    result.sources.map((s) => [s.source, s.total, s.count, s.percent]),
    [
      ['campaign', 20, 3, 91],
      ['purchase', 2, 1, 9],
    ],
  );
  // "Drop" aparece duas vezes e vira uma linha só. Empate em 10 com "Launch":
  // o sort é estável, então fica a ordem em que cada título apareceu.
  assert.deepEqual(
    result.sources[0].items.map((i) => [i.title, i.total, i.count]),
    [
      ['Drop', 10, 2],
      ['Launch', 10, 1],
    ],
  );
});

test('breakdownInflow respeita o fim da janela (mês fechado)', () => {
  const result = breakdownInflow(
    [
      receipt({ amountUsdc: 3, createdAt: '2026-09-30T23:00:00Z' }),
      receipt({ amountUsdc: 7, createdAt: '2026-10-01T00:00:00Z' }),
    ],
    { since: Date.parse('2026-09-01T00:00:00Z'), until: Date.parse('2026-10-01T00:00:00Z') },
  );
  assert.equal(result.total, 3);
});

test('breakdownInflow sem nada na janela', () => {
  const result = breakdownInflow([receipt({ createdAt: '2026-01-01T00:00:00Z' })], {
    since: Date.parse('2026-10-01T00:00:00Z'),
    until: Infinity,
  });
  assert.deepEqual(result, { total: 0, count: 0, sources: [], pending: { total: 0, count: 0 } });
});

test('mock funded: saldo é a soma do confirmado, pendente sem hash', () => {
  const snap = mockWalletSnapshot('funded', Date.parse('2026-10-14T12:00:00Z'));
  const confirmed = snap.receipts.filter((item) => item.status === 'confirmed');
  assert.equal(
    snap.balanceUsdc,
    confirmed.reduce((sum, item) => sum + item.amountUsdc, 0),
  );
  for (const item of snap.receipts) {
    if (item.status === 'pending') assert.equal(item.txHash, null);
    else assert.match(item.txHash ?? '', /^0x[0-9a-f]{64}$/);
  }
});

test('mock empty não tem saldo nem recebimento', () => {
  assert.deepEqual(mockWalletSnapshot('empty'), { balanceUsdc: 0, receipts: [] });
});

test('parseWalletMockMode aceita só os modos conhecidos', () => {
  assert.equal(parseWalletMockMode(' Funded '), 'funded');
  assert.equal(parseWalletMockMode('error'), 'error');
  assert.equal(parseWalletMockMode('mismatch'), 'mismatch');
  assert.equal(parseWalletMockMode('yes'), 'off');
  assert.equal(parseWalletMockMode(undefined), 'off');
});
