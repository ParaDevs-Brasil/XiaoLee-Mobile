/**
 * Testes de `post-text.ts`. Rodar: node --experimental-strip-types src/lib/post-text.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { insertToken } from './post-text.ts';

test('acrescenta com um espaço antes e sem duplicar espaço', () => {
  assert.equal(insertToken('oi', '@ana'), 'oi @ana');
  assert.equal(insertToken('oi ', '@ana'), 'oi @ana');
  assert.equal(insertToken('', '#Arc'), '#Arc');
});

test('não repete o que já está no texto (sem diferenciar maiúscula)', () => {
  assert.equal(insertToken('fala @Ana, tudo bem', '@ana'), 'fala @Ana, tudo bem');
  assert.equal(insertToken('oi #Arc', '#arc'), 'oi #Arc');
});

test('não confunde com um nome parecido', () => {
  assert.equal(insertToken('oi @anabel', '@ana'), 'oi @anabel @ana');
});
