/**
 * Check da copy de boas-vindas do 1º clique no chat. Roda com:
 *   node --experimental-strip-types src/lib/welcome-copy.test.ts
 *
 * Sem framework, como os outros testes de `lib/`.
 */
import assert from 'node:assert/strict';

import { buildWelcomeCopy, welcomeLanguage } from './welcome-copy.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`  ok  ${name}`);
}

console.log('welcome-copy');

test('welcomeLanguage reconhece variantes de português', () => {
  assert.equal(welcomeLanguage('pt-BR'), 'pt');
  assert.equal(welcomeLanguage('pt_PT'), 'pt');
  assert.equal(welcomeLanguage('PT'), 'pt');
});

test('welcomeLanguage cai no inglês para o resto', () => {
  assert.equal(welcomeLanguage('en-US'), 'en');
  assert.equal(welcomeLanguage('es-ES'), 'en');
  assert.equal(welcomeLanguage(undefined), 'en');
});

test('saúda pelo primeiro nome do perfil', () => {
  const copy = buildWelcomeCopy({ full_name: '  Maria Clara Souza ', interest_profile: [] }, 'pt');
  assert.equal(copy.title, 'Boas-vindas, Maria! Eu sou a Xiaolee ✨');
});

test('sem perfil ou sem nome, saudação genérica', () => {
  assert.equal(buildWelcomeCopy(null, 'en').title, 'Welcome! I’m Xiaolee ✨');
  assert.equal(
    buildWelcomeCopy({ full_name: '', interest_profile: [] }, 'en').title,
    'Welcome! I’m Xiaolee ✨',
  );
});

test('explica as funções principais nos dois idiomas', () => {
  for (const language of ['en', 'pt'] as const) {
    const { body } = buildWelcomeCopy(null, language);
    for (const word of ['campa', 'dashboard', 'swap']) {
      assert.match(body, new RegExp(word, 'i'), `${language} deveria citar ${word}`);
    }
  }
});

test('usa só o primeiro interesse conhecido', () => {
  const { body } = buildWelcomeCopy(
    { full_name: 'Ana', interest_profile: ['unknown', 'games', 'defi'] },
    'en',
  );
  assert.match(body, /games/);
  assert.doesNotMatch(body, /DeFi/);
});

test('interesse desconhecido não deixa buraco na frase', () => {
  const { body } = buildWelcomeCopy({ full_name: 'Ana', interest_profile: ['unknown'] }, 'en');
  assert.doesNotMatch(body, /undefined|\s{2}/);
});
