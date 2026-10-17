/**
 * Check do pedido de swap na Arc. Roda com:
 *   node --experimental-strip-types src/lib/arc-swap-request.test.ts
 */
import assert from 'node:assert/strict';

import { canonicalSwapToken, parseSwapRequest } from './arc-swap-request.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

test('aceita os três tokens da Arc em qualquer caixa', () => {
  assert.equal(canonicalSwapToken('usdc'), 'USDC');
  assert.equal(canonicalSwapToken(' EURC '), 'EURC');
  assert.equal(canonicalSwapToken('CIRBTC'), 'cirBTC');
  assert.equal(canonicalSwapToken('XLM'), undefined);
  assert.equal(canonicalSwapToken(undefined), undefined);
});

test('pedido válido volta normalizado', () => {
  const r = parseSwapRequest({ tokenIn: 'usdc', tokenOut: 'eurc', amountIn: '1.5' });
  assert.deepEqual(r, { ok: true, request: { tokenIn: 'USDC', tokenOut: 'EURC', amountIn: '1.5' } });
});

test('número também é aceito como valor', () => {
  const r = parseSwapRequest({ tokenIn: 'USDC', tokenOut: 'EURC', amountIn: 2 });
  assert.equal(r.ok && r.request.amountIn, '2');
});

test('token fora da Arc é recusado com a lista dos suportados', () => {
  const r = parseSwapRequest({ tokenIn: 'USDC', tokenOut: 'XLM', amountIn: '1' });
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : '', /USDC, EURC, cirBTC/);
});

test('mesmo token nos dois lados é recusado', () => {
  assert.equal(parseSwapRequest({ tokenIn: 'USDC', tokenOut: 'usdc', amountIn: '1' }).ok, false);
});

test('valores inválidos são recusados', () => {
  for (const amountIn of ['0', '0.0', '-1', '1e3', 'abc', '', ' ', '1.', '.5', '1,5', NaN, undefined, null]) {
    assert.equal(parseSwapRequest({ tokenIn: 'USDC', tokenOut: 'EURC', amountIn }).ok, false, String(amountIn));
  }
});
