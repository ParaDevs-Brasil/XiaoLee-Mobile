/**
 * Check dos formatadores do feed. Roda com:
 *   node --experimental-strip-types src/lib/format.test.ts
 *
 * Sem framework, como o teste do avatar. O caso que motiva o arquivo é o
 * timestamp com microssegundos que o backend emite: se o parse voltar a
 * recusá-lo, a tela mostra "NaNs ago" e ninguém percebe até rodar no aparelho.
 */
import assert from 'node:assert/strict';

import {
  formatDate,
  formatReward,
  isPoints,
  formatTokenAmount,
  formatUSDC,
  parseTimestamp,
  shortHash,
  timeAgo,
} from './format.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`  ok  ${name}`);
}

console.log('format');

// Instante fixo para o "agora" — senão os checks de timeAgo dependeriam do
// relógio de quem roda.
const NOW = Date.parse('2026-07-30T19:30:00.000Z');

test('parseTimestamp aceita os microssegundos que o backend emite', () => {
  // Formato real de `record_payment_settled` (server/metrics.py).
  const at = parseTimestamp('2026-07-30T19:26:09.001709Z');
  assert.equal(Number.isNaN(at), false, 'não deveria virar NaN');
  assert.equal(at, Date.parse('2026-07-30T19:26:09.001Z'));
});

test('parseTimestamp continua aceitando o formato de três casas', () => {
  assert.equal(
    parseTimestamp('2026-07-30T19:26:09.001Z'),
    Date.parse('2026-07-30T19:26:09.001Z'),
  );
});

test('timeAgo cobre as quatro escalas', () => {
  assert.equal(timeAgo('2026-07-30T19:29:30.000Z', NOW), '30s ago');
  assert.equal(timeAgo('2026-07-30T19:05:00.000Z', NOW), '25min ago');
  assert.equal(timeAgo('2026-07-30T16:30:00.000Z', NOW), '3h ago');
  assert.equal(timeAgo('2026-07-28T19:30:00.000Z', NOW), '2d ago');
});

test('timeAgo não mostra tempo negativo com relógio adiantado', () => {
  assert.equal(timeAgo('2026-07-30T19:31:00.000Z', NOW), '0s ago');
});

test('timeAgo devolve vazio em data inválida', () => {
  assert.equal(timeAgo('não é uma data', NOW), '');
});

test('formatUSDC fixa duas casas', () => {
  assert.equal(formatUSDC(15.75), '15.75');
  assert.equal(formatUSDC(5), '5.00');
  assert.equal(formatUSDC(0), '0.00');
});

test('shortHash encurta só o que vale a pena encurtar', () => {
  assert.equal(
    shortHash('0xabc123def456789012345678901234567890abcdef1234567890abcdef123456'),
    '0xabc1…123456',
  );
  assert.equal(shortHash('0xabc123'), '0xabc123');
});

test('formatTokenAmount não força casas em valor inteiro', () => {
  // Valores reais de `GET /campaigns`: pool 50000.0, por participante 50.0.
  assert.equal(formatTokenAmount(50000), '50,000');
  assert.equal(formatTokenAmount(50), '50');
  assert.equal(formatTokenAmount(12.5), '12.5');
});

test('formatDate aceita o offset que o campo created_at usa', () => {
  // `GET /campaigns` devolve "+00:00", não o "Z" do feed de traction.
  assert.notEqual(formatDate('2026-07-28T00:34:56+00:00'), '');
  assert.equal(formatDate('não é uma data'), '');
});

test('isPoints reconhece o token de pontos sem depender de caixa ou espaços', () => {
  assert.equal(isPoints('POINTS'), true);
  assert.equal(isPoints(' points '), true);
  assert.equal(isPoints('USDC'), false);
});

test('formatReward escreve "points" para pontos e mantém o token dos demais', () => {
  assert.equal(formatReward(50, 'POINTS'), '50 points');
  assert.equal(formatReward(1000, ' points '), '1,000 points');
  assert.equal(formatReward(2.5, 'USDC'), '2.5 USDC');
});

console.log('todos os checks passaram');
