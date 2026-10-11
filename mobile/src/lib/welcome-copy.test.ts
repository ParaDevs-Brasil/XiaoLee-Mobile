/**
 * Check da copy de boas-vindas do 1º clique no chat. Roda com:
 *   node --experimental-strip-types src/lib/welcome-copy.test.ts
 *
 * Sem framework, como os outros testes de `lib/`.
 */
import assert from 'node:assert/strict';

import { buildWelcomeCopy } from './welcome-copy.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`  ok  ${name}`);
}

console.log('welcome-copy');

test('saúda pelo primeiro nome do perfil', () => {
  const copy = buildWelcomeCopy({ full_name: '  Maria Clara Souza ', interest_profile: [] });
  assert.equal(copy.title, 'Hi, Maria! 💖');
});

test('sem perfil ou sem nome, saudação genérica', () => {
  assert.equal(buildWelcomeCopy(null).title, 'Hi there! 💖');
  assert.equal(buildWelcomeCopy({ full_name: '', interest_profile: [] }).title, 'Hi there! 💖');
});

test('sem interesse, recompensa a comunidade e não fala de swap', () => {
  const { body } = buildWelcomeCopy(null);
  assert.equal(
    body,
    "I'm Xiaolee, your crypto companion. I run the campaigns that reward your community in USDC. Where should we start?",
  );
});

test('o público da campanha segue o interesse', () => {
  const { body } = buildWelcomeCopy({ full_name: 'Ana', interest_profile: ['games'] });
  assert.match(body, /reward your players in USDC\./);
});

test('DeFi ou trader ganham a menção aos swaps', () => {
  const defi = buildWelcomeCopy({ full_name: 'Ana', interest_profile: ['defi'] }).body;
  assert.match(defi, /community in USDC, and since you're into DeFi, your swaps too\./);
  const trader = buildWelcomeCopy({ full_name: 'Ana', interest_profile: ['trader'] }).body;
  assert.match(trader, /since you're into trading, your swaps too/);
});

test('mantém o tamanho da persona: no máximo 3 frases', () => {
  const { body } = buildWelcomeCopy({ full_name: 'Ana', interest_profile: ['cards', 'defi'] });
  assert.ok(body.split(/[.?!](\s|$)/).filter((s) => s.trim()).length <= 3, body);
});

test('interesse desconhecido não deixa buraco na frase', () => {
  const { body } = buildWelcomeCopy({ full_name: 'Ana', interest_profile: ['unknown'] });
  assert.doesNotMatch(body, /undefined|\s{2}/);
});
