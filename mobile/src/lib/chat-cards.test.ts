/**
 * Check do casamento de cards com as mensagens restauradas. Roda com:
 *   node --experimental-strip-types src/lib/chat-cards.test.ts
 *
 * O caso que motiva o arquivo: reabrir uma conversa trazia só o texto e o
 * botão de assinar / o comprovante da transação se perdia.
 */
import assert from 'node:assert/strict';

import { matchCards, type StoredWithCards } from './chat-cards.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const transfer = { to: '0xdead', amountUsdc: 0.01 };
const stored: StoredWithCards[] = [
  { role: 'user', content: 'envia 0.01', at: '1' },
  { role: 'assistant', content: 'Pronto para enviar', at: '2', transfer, txHash: '0xabc' },
  { role: 'assistant', content: 'Pronto para enviar', at: '3', transfer },
  { role: 'assistant', content: 'só texto', at: '4' },
];

test('devolve o card e o comprovante da mensagem de mesmo texto', () => {
  const [, m] = matchCards(
    [{ role: 'user', content: 'envia 0.01' }, { role: 'assistant', content: 'Pronto para enviar' }],
    stored,
  );
  assert.equal(m?.txHash, '0xabc');
  assert.deepEqual(m?.transfer, transfer);
  assert.equal(m?.at, '2');
});

test('dois pedidos idênticos casam cada um com o seu, na ordem', () => {
  const r = matchCards(
    [{ role: 'assistant', content: 'Pronto para enviar' }, { role: 'assistant', content: 'Pronto para enviar' }],
    stored,
  );
  assert.equal(r[0]?.txHash, '0xabc');
  assert.equal(r[1]?.txHash, undefined);
  assert.equal(r[1]?.at, '3');
});

test('mensagem do usuário e texto sem card não ganham nada', () => {
  const r = matchCards(
    [{ role: 'user', content: 'Pronto para enviar' }, { role: 'assistant', content: 'só texto' }],
    stored,
  );
  assert.equal(r[0], undefined);
  assert.equal(r[1], undefined);
});

test('ignora espaços nas pontas na comparação', () => {
  const [m] = matchCards([{ role: 'assistant', content: '  Pronto para enviar\n' }], stored);
  assert.equal(m?.at, '2');
});
