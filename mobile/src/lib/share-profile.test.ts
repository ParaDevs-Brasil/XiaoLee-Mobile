/**
 * Check do template de compartilhar perfil. Roda com:
 *   node --experimental-strip-types src/lib/share-profile.test.ts
 *
 * Sem framework, como os outros testes de `lib/`.
 */
import assert from 'node:assert/strict';

import {
  buildShareCaption,
  cleanHandle,
  initials,
  instagramHandle,
  profilePhotoUrl,
  profileTagline,
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

test('cleanHandle aceita @, handle puro e link colado', () => {
  assert.equal(cleanHandle('@josuekla'), 'josuekla');
  assert.equal(cleanHandle('  josue.kla_ '), 'josue.kla_');
  assert.equal(cleanHandle('https://x.com/josuekla'), 'josuekla');
  assert.equal(cleanHandle('https://www.instagram.com/josue.kla/?igsh=abc'), 'josue.kla');
  assert.equal(cleanHandle('twitter.com/josuekla'), 'josuekla');
});

test('cleanHandle recusa vazio e texto que não é handle', () => {
  assert.equal(cleanHandle(''), null);
  assert.equal(cleanHandle(undefined), null);
  assert.equal(cleanHandle('@'), null);
  assert.equal(cleanHandle('meu insta é josue'), null);
});

test('instagramHandle normaliza o campo do perfil', () => {
  assert.equal(instagramHandle('@josue.kla'), 'josue.kla');
  assert.equal(instagramHandle(undefined), null);
});

test('initials usa primeiro e último nome', () => {
  assert.equal(initials('Josué Kla Silva'), 'JS');
  assert.equal(initials('ana'), 'A');
  assert.equal(initials('  '), 'XL');
  assert.equal(initials(null), 'XL');
});

test('profileTagline usa o interesse principal', () => {
  assert.equal(profileTagline(['games', 'defi']), 'Leveling up in Web3 games');
  assert.equal(profileTagline(['unknown', 'cards']), 'Collecting cards on-chain');
  assert.equal(profileTagline([]), 'Earning USDC with my AI agent');
});

test('legenda do WhatsApp é pessoal, com até dois interesses e o link', () => {
  const caption = buildShareCaption(
    { name: 'Ana Souza', interests: ['defi', 'games', 'cards'] },
    'whatsapp',
  );
  assert.match(caption, /^Hey! It's Ana 👋/);
  assert.match(caption, /DeFi and I play Web3 games/);
  assert.doesNotMatch(caption, /cards/);
  assert.ok(caption.endsWith(`Join me: ${SHARE_URL}`));
});

test('legenda do X traz hashtags dos interesses e cabe no limite', () => {
  const caption = buildShareCaption(
    { name: 'Ana', interests: ['memecoins', 'trader', 'defi'] },
    'x',
  );
  assert.match(caption, /hunting the next memecoin/);
  assert.match(caption, /#Xiaolee #Memecoins #Trading #USDC/);
  assert.doesNotMatch(caption, /#DeFi/);
  // O X conta a URL como 23 caracteres.
  assert.ok(caption.replace(SHARE_URL, 'x'.repeat(23)).length <= 280);
});

test('legendas sem nome nem interesses continuam legíveis', () => {
  assert.equal(
    buildShareCaption({ name: null, interests: [] }, 'whatsapp'),
    `Hey! 👋\nI'm on Xiaolee — my AI agent that earns USDC.\nJoin me: ${SHARE_URL}`,
  );
  assert.match(buildShareCaption({ name: null, interests: [] }, 'x'), /#Xiaolee #USDC/);
});

test('xIntentUrl codifica o texto', () => {
  const url = new URL(xIntentUrl('a & b'));
  assert.equal(url.origin + url.pathname, 'https://x.com/intent/post');
  assert.equal(url.searchParams.get('text'), 'a & b');
});
