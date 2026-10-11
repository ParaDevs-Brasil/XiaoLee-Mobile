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
  interestPhrase,
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

test('interestPhrase muda pelo número de interesses', () => {
  assert.equal(interestPhrase(['defi']), 'exploring DeFi with my AI agent');
  assert.equal(interestPhrase(['defi', 'games']), 'into DeFi & Web3 games');
  // Três ou mais: a geral — os chips já listam cada um.
  assert.equal(interestPhrase(['defi', 'games', 'cards']), 'exploring Web3 with my AI agent');
  assert.equal(interestPhrase([]), 'exploring Web3 with my AI agent');
});

test('interestPhrase ignora ids desconhecidos ao contar', () => {
  assert.equal(interestPhrase(['unknown', 'cards']), 'collecting cards on-chain');
});

test('profileTagline é a frase com maiúscula inicial', () => {
  assert.equal(profileTagline(['games', 'memecoins']), 'Into Web3 games & memecoins');
  assert.equal(profileTagline([]), 'Exploring Web3 with my AI agent');
});

test('nenhuma frase ou legenda promete ganho', () => {
  const sets = [[], ['defi'], ['trader'], ['defi', 'trader'], ['defi', 'games', 'cards']];
  for (const interests of sets) {
    for (const text of [
      profileTagline(interests),
      buildShareCaption({ name: 'Ana', interests }, 'whatsapp'),
      buildShareCaption({ name: 'Ana', interests }, 'x'),
    ]) {
      assert.doesNotMatch(text, /earn|yield|USDC|profit/i, text);
    }
  }
});

test('legenda do WhatsApp é pessoal, usa a frase do card e termina no link', () => {
  const caption = buildShareCaption(
    { name: 'Ana Souza', interests: ['defi', 'games'] },
    'whatsapp',
  );
  assert.equal(
    caption,
    `Hey! It's Ana 👋\nI'm on Xiaolee — into DeFi & Web3 games.\nJoin me: ${SHARE_URL}`,
  );
});

test('legenda do X traz até três hashtags e cabe no limite', () => {
  const caption = buildShareCaption(
    { name: 'Ana', interests: ['memecoins', 'trader', 'defi', 'games'] },
    'x',
  );
  assert.match(caption, /exploring Web3 with my AI agent/);
  assert.match(caption, /#Xiaolee #Memecoins #Trading #DeFi\n/);
  assert.doesNotMatch(caption, /#Web3Gaming/);
  // O X conta a URL como 23 caracteres.
  assert.ok(caption.replace(SHARE_URL, 'x'.repeat(23)).length <= 280);
});

test('legendas sem nome nem interesses continuam legíveis', () => {
  assert.equal(
    buildShareCaption({ name: null, interests: [] }, 'whatsapp'),
    `Hey! 👋\nI'm on Xiaolee — exploring Web3 with my AI agent.\nJoin me: ${SHARE_URL}`,
  );
  assert.match(buildShareCaption({ name: null, interests: [] }, 'x'), /#Xiaolee #Web3\n/);
});

test('xIntentUrl codifica o texto', () => {
  const url = new URL(xIntentUrl('a & b'));
  assert.equal(url.origin + url.pathname, 'https://x.com/intent/post');
  assert.equal(url.searchParams.get('text'), 'a & b');
});
