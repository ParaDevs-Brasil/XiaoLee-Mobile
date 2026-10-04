/**
 * Regras puras do gate de login — sem React, sem Privy, sem storage, para
 * poderem ser testadas com `node --experimental-strip-types` (mesmo acordo de
 * `format.ts`/`sse.ts`). Quem junta as fontes reais é `hooks/use-auth-state.ts`.
 */

/**
 * - `loading`: o storage ainda não foi lido — decidir agora faria a tela de
 *   login piscar para quem já está logado.
 * - `signedOut`: sem sessão e sem conta Privy; mostra o login.
 * - `signingIn`: o Privy já autenticou, mas a carteira/sessão do backend ainda
 *   estão sendo criadas; segue no login, com indicação de progresso.
 * - `error`: o Privy autenticou, mas o backend não emitiu sessão (rede fora,
 *   token recusado); segue no login, com retry.
 * - `signedIn`: há sessão do backend — libera o app.
 */
export type AuthState = 'loading' | 'signedOut' | 'signingIn' | 'error' | 'signedIn';

export interface AuthInputs {
  /** `false` enquanto `lib/session` não leu o SecureStore. */
  sessionLoaded: boolean;
  /** Há sessão do backend guardada. */
  hasSession: boolean;
  /** `usePrivy().isReady`. */
  privyReady: boolean;
  /** `usePrivy().user` existe. */
  hasPrivyUser: boolean;
  /** Falha ao trocar o token do Privy por sessão do backend, se houve. */
  sessionError: string | null;
}

/**
 * Sessão emitida pelo backend de verdade, e não a "legada" que versões
 * anteriores gravavam quando a troca de token falhava: nela o endereço da
 * carteira fazia de `sessionId` E de `twitterUserId` (os dois iguais). O
 * backend aceita um Bearer desconhecido sem dar 401, então sem esta checagem
 * quem atualizasse o app passaria pelo gate com uma sessão que não é de
 * ninguém. Numa sessão real o `twitter_user_id` tem prefixo do provedor
 * (`privy_…`) e nunca coincide com o `session_id`.
 */
export function isRealSession(
  session: { sessionId: string; twitterUserId: string } | null | undefined,
): boolean {
  if (!session) return false;
  return session.sessionId.trim() !== '' && session.sessionId !== session.twitterUserId;
}

export function deriveAuthState(input: AuthInputs): AuthState {
  if (!input.sessionLoaded) return 'loading';
  // A sessão do backend é a fonte da verdade, não o Privy: é ela que persiste
  // entre aberturas (SecureStore, 30 dias) e que as chamadas de API usam. Quem
  // reabre o app entra direto, sem esperar o Privy restaurar a dele.
  if (input.hasSession) return 'signedIn';
  if (input.hasPrivyUser && input.sessionError) return 'error';
  if (input.privyReady && input.hasPrivyUser) return 'signingIn';
  return 'signedOut';
}

/**
 * Validação básica de e-mail: algo@dominio.tld, sem espaços. De propósito não
 * tenta ser a RFC inteira — quem decide se o endereço existe é o envio do
 * código; aqui só se barra o erro de digitação óbvio antes de gastar uma
 * chamada ao Privy.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** O código do Privy é sempre de 6 dígitos. */
export function isValidCode(value: string): boolean {
  return /^\d{6}$/.test(value.trim());
}
