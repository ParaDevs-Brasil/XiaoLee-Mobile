/**
 * Check do template de compartilhar perfil. Roda com:
 *   node --experimental-strip-types src/lib/share-profile.test.ts
 *
 * Sem framework, como os outros testes de `lib/`.
 */
import assert from 'node:assert/strict';

import {
  buildShareCaption,
  initials,
  profilePhotoUrl,
  SHARE_URL,
  xHandle,
  xIntentUrl,
} from './share-profile.ts';

function test(name: string, fn: () => void) {
  fn();
  console.log(`  ok  ${name}`);
}

console.log('share-profile');

test('profilePhotoUrl pega a primeira foto https vinculada', () => {
  const url = profilePhotoUrl([
    { type: 'email' },
    { type: 'google_oauth' },
    { type: 'twitter_oauth', profile_picture_url: 'https://pbs.twimg.com/a.jpg' },
  ]);
  assert.equal(url, 'https://pbs.twimg.com/a.jpg');
});

test('profilePhotoUrl sem foto (Google/e-mail) devolve null', () => {
  assert.equal(profilePhotoUrl([{ type: 'google_oauth' }, { type: 'email' }]), null);
  assert.equal(profilePhotoUrl(undefined), null);
  assert.equal(profilePhotoUrl([{ type: 'x', profile_picture_url: '  ' }]), null);
});

test('profilePhotoUrl recusa URL que não é https', () => {
  assert.equal(profilePhotoUrl([{ type: 'x', profile_picture_url: 'http://a/b.png' }]), null);
});

test('xHandle prefere o perfil do backend e tira o @', () => {
  assert.equal(xHandle('@josue', [{ type: 'twitter_oauth', username: 'other' }]), 'josue');
  assert.equal(xHandle(undefined, [{ type: 'twitter_oauth', username: 'other' }]), 'other');
  assert.equal(xHandle('', []), null);
});

test('initials usa primeiro e último nome', () => {
  assert.equal(initials('Josué Kla Silva'), 'JS');
  assert.equal(initials('ana'), 'A');
  assert.equal(initials('  '), 'XL');
  assert.equal(initials(null), 'XL');
});

test('buildShareCaption monta o texto com nome e até 3 interesses', () => {
  const caption = buildShareCaption({
    name: 'Ana',
    interests: ['defi', 'games', 'cards', 'trader'],
  });
  assert.match(caption, /^I'm Ana and I'm on Xiaolee/);
  assert.match(caption, /Into DeFi, Games, Cards\./);
  assert.doesNotMatch(caption, /Trader/);
});

test('buildShareCaption sem nome nem interesses continua legível', () => {
  assert.equal(
    buildShareCaption({ name: null, interests: [] }),
    "I'm on Xiaolee — earning USDC with my AI agent. Join me:",
  );
});

test('xIntentUrl codifica texto e link', () => {
  const url = new URL(xIntentUrl('a & b'));
  assert.equal(url.origin + url.pathname, 'https://x.com/intent/post');
  assert.equal(url.searchParams.get('text'), 'a & b');
  assert.equal(url.searchParams.get('url'), SHARE_URL);
});
