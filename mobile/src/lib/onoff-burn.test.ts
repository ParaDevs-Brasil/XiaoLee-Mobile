/**
 * Check do saque entre redes. Roda com:
 *   node --experimental-strip-types src/lib/onoff-burn.test.ts
 */
import assert from 'node:assert/strict';

import { ARC_TOKEN_MESSENGER, buildBurnTxs, FORWARD_HOOK_DATA, type BurnParams } from './onoff-burn.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const ADDR = '0x' + 'a'.repeat(40);
const USDC = '0x' + '1'.repeat(40);
const input = { amountUsdc: 10, network: 'base' as const, address: ADDR };
const good: BurnParams = {
  token_messenger: ARC_TOKEN_MESSENGER,
  usdc: USDC,
  source_domain: 26,
  destination_domain: 6,
  mint_recipient: '0x' + '0'.repeat(24) + 'a'.repeat(40),
  destination_caller: '0x' + '0'.repeat(64),
  burn_amount: '10060000',
  max_fee: '60000',
  min_finality_threshold: 2000,
  hook_data: FORWARD_HOOK_DATA,
};

test('cotação correta vira approve do spender fixo e burn no TokenMessenger', () => {
  const { approve, burn } = buildBurnTxs(input, good);
  assert.equal(approve.to.toLowerCase(), USDC);
  assert.ok(approve.data.startsWith('0x095ea7b3'));
  assert.ok(approve.data.toLowerCase().includes(ARC_TOKEN_MESSENGER.slice(2).toLowerCase()));
  assert.equal(burn.to, '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d');
  assert.ok(burn.data.toLowerCase().includes('a'.repeat(40)));
});

for (const [name, patch] of Object.entries({
  'contrato trocado': { token_messenger: '0x' + '2'.repeat(40) },
  'rede de destino trocada': { destination_domain: 0 },
  'destinatário trocado': { mint_recipient: '0x' + '0'.repeat(24) + 'b'.repeat(40) },
  'valor maior que o pedido': { burn_amount: '20060000' },
  'taxa absurda': { max_fee: '3000000', burn_amount: '13000000' },
  'caller de destino definido': { destination_caller: '0x' + '0'.repeat(63) + '1' },
  'hook diferente': { hook_data: '0x' + '00'.repeat(32) },
  'origem trocada': { source_domain: 1 },
} as Record<string, Partial<BurnParams>>)) {
  test(`recusa: ${name}`, () => {
    assert.throws(() => buildBurnTxs(input, { ...good, ...patch }));
  });
}

test('recusa endereço inválido e valor zero', () => {
  assert.throws(() => buildBurnTxs({ ...input, address: '0x12' }, good));
  assert.throws(() => buildBurnTxs({ ...input, amountUsdc: 0 }, good));
});
