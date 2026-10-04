import assert from 'node:assert/strict';

import {
  deriveAuthState,
  isRealSession,
  isValidCode,
  isValidEmail,
  type AuthInputs,
} from './auth-state.ts';

const base: AuthInputs = {
  sessionLoaded: true,
  hasSession: false,
  privyReady: true,
  hasPrivyUser: false,
  sessionError: null,
};

// Storage ainda não lido: nunca decide, senão o login pisca para quem já entrou.
assert.equal(deriveAuthState({ ...base, sessionLoaded: false }), 'loading');
assert.equal(
  deriveAuthState({ ...base, sessionLoaded: false, hasSession: true, hasPrivyUser: true }),
  'loading',
);

// Instalação limpa → login.
assert.equal(deriveAuthState(base), 'signedOut');
assert.equal(deriveAuthState({ ...base, privyReady: false }), 'signedOut');

// Reabertura com sessão guardada → entra direto, mesmo com o Privy ainda subindo.
assert.equal(deriveAuthState({ ...base, hasSession: true, privyReady: false }), 'signedIn');

// Privy autenticou, sessão do backend ainda não saiu.
assert.equal(deriveAuthState({ ...base, hasPrivyUser: true }), 'signingIn');
// ...e o Privy ainda não terminou de subir: segue no login, não em "signingIn".
assert.equal(deriveAuthState({ ...base, hasPrivyUser: true, privyReady: false }), 'signedOut');

// Backend recusou/inacessível → erro com retry, não spinner eterno.
assert.equal(deriveAuthState({ ...base, hasPrivyUser: true, sessionError: 'x' }), 'error');
// Erro velho sem conta Privy (logout depois da falha) não vale.
assert.equal(deriveAuthState({ ...base, sessionError: 'x' }), 'signedOut');
// Sessão válida vence erro antigo.
assert.equal(
  deriveAuthState({ ...base, hasSession: true, hasPrivyUser: true, sessionError: 'x' }),
  'signedIn',
);

// Sessão legada (endereço como token e como id) não conta como login.
assert.equal(isRealSession(null), false);
assert.equal(isRealSession(undefined), false);
assert.equal(isRealSession({ sessionId: '0xabc', twitterUserId: '0xabc' }), false);
assert.equal(isRealSession({ sessionId: '', twitterUserId: 'privy_1' }), false);
assert.equal(isRealSession({ sessionId: '   ', twitterUserId: 'privy_1' }), false);
assert.equal(
  isRealSession({ sessionId: 'privy_session_deadbeef', twitterUserId: 'privy_did:privy:x' }),
  true,
);

assert.equal(isValidEmail('ana@example.com'), true);
assert.equal(isValidEmail('  ana@example.com  '), true);
assert.equal(isValidEmail('ana+xl@mail.example.com.br'), true);
assert.equal(isValidEmail(''), false);
assert.equal(isValidEmail('   '), false);
assert.equal(isValidEmail('ana'), false);
assert.equal(isValidEmail('ana@'), false);
assert.equal(isValidEmail('ana@example'), false);
assert.equal(isValidEmail('ana@example.c'), false);
assert.equal(isValidEmail('a na@example.com'), false);
assert.equal(isValidEmail('@example.com'), false);
assert.equal(isValidEmail('ana@@example.com'), false);

assert.equal(isValidCode('123456'), true);
assert.equal(isValidCode(' 123456 '), true);
assert.equal(isValidCode('12345'), false);
assert.equal(isValidCode('1234567'), false);
assert.equal(isValidCode('12a456'), false);
assert.equal(isValidCode('12 456'), false);
assert.equal(isValidCode(''), false);
assert.equal(isValidCode('   '), false);

console.log('auth-state: ok');
