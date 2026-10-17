/**
 * Check da preferência de tema. Roda com:
 *   node --experimental-strip-types src/lib/theme-preference.test.ts
 *
 * O caso que importa é o `system`: o RN devolve `'unspecified'` (e o web
 * `null` antes de hidratar) e o app precisa cair no claro, não quebrar.
 */
import assert from 'node:assert/strict';

import { parsePreference, resolveScheme, THEME_PREFERENCES } from './theme-preference.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`  ok  ${name}`);
}

console.log('theme-preference');

test('light e dark fixos ignoram o aparelho', () => {
  assert.equal(resolveScheme('light', 'dark'), 'light');
  assert.equal(resolveScheme('dark', 'light'), 'dark');
  assert.equal(resolveScheme('dark', null), 'dark');
});

test('system segue o aparelho', () => {
  assert.equal(resolveScheme('system', 'dark'), 'dark');
  assert.equal(resolveScheme('system', 'light'), 'light');
});

test('system sem tema conhecido cai no claro', () => {
  assert.equal(resolveScheme('system', 'unspecified'), 'light');
  assert.equal(resolveScheme('system', null), 'light');
  assert.equal(resolveScheme('system', undefined), 'light');
});

test('valor salvo inválido ou ausente vira system', () => {
  assert.equal(parsePreference(null), 'system');
  assert.equal(parsePreference(''), 'system');
  assert.equal(parsePreference('DARK'), 'system');
  for (const value of THEME_PREFERENCES) assert.equal(parsePreference(value), value);
});

test('seletor mostra Light, Dark, System nessa ordem', () => {
  assert.deepEqual(THEME_PREFERENCES, ['light', 'dark', 'system']);
});
