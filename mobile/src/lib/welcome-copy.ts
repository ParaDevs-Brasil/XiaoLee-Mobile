/**
 * Copy da boas-vindas do 1º clique no chat (XIAOLEEACE-19).
 *
 * Função pura, sem React Native, para rodar no teste com
 * `node --experimental-strip-types`. Personaliza pelo perfil coletado no
 * onboarding (S2): primeiro nome e interesses — só os campos que o backend
 * já devolve em `GET /user/me/profile`, nenhum cálculo próprio.
 *
 * Curta de propósito: a persona de produção (`OrchestrationService`) responde
 * em 1-3 frases e nunca faz "feature tour" — a lista de funções já está nos
 * cards logo abaixo da bolha, repeti-la aqui seria ler a mesma coisa duas
 * vezes. Só em inglês, como o resto do app, até o mobile ter i18n.
 */

/** O recorte de `MyProfile` que a copy usa. */
export interface WelcomeProfile {
  full_name: string | null;
  interest_profile: string[];
}

export interface WelcomeCopy {
  title: string;
  body: string;
}

/** Primeiro nome, para a saudação não soar como formulário. */
function firstName(fullName: string | null | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? '';
}

/**
 * Quem a campanha recompensa, pelo interesse do onboarding (`INTERESTS` em
 * `onboarding.tsx`) — vale o primeiro interesse que tiver público próprio.
 */
const AUDIENCE: Record<string, string> = {
  games: 'players',
  cards: 'collectors',
  memecoins: 'holders',
};

/** Interesses de quem opera token — ganham a menção aos swaps. */
const SWAP_INTERESTS = new Set(['defi', 'trader']);

export function buildWelcomeCopy(profile: WelcomeProfile | null): WelcomeCopy {
  const name = firstName(profile?.full_name);
  const interests = profile?.interest_profile ?? [];

  const audience =
    interests.map((interest) => AUDIENCE[interest]).find(Boolean) ?? 'community';
  const swapper = interests.find((interest) => SWAP_INTERESTS.has(interest));
  const swaps = swapper
    ? `, and since you're into ${swapper === 'defi' ? 'DeFi' : 'trading'}, your swaps too`
    : '';

  return {
    title: name ? `Hi, ${name}! 💖` : 'Hi there! 💖',
    body:
      `I'm Xiaolee, your crypto companion. I run the campaigns that reward your ` +
      `${audience} in USDC${swaps}. Where should we start?`,
  };
}

/**
 * Ordem dos cards de ação do estado inicial (XIAOLEEACE-20): quem já tem
 * interesses no perfil vê primeiro "Browse campaigns", que o backend ranqueia
 * por esses interesses; sem perfil, a lista não seria personalizada e fica a
 * ordem original. A personalização mora aqui, no que a pessoa toca, e não numa
 * frase a mais na bolha.
 *
 * Recebe e devolve chaves (`ACTIONS[].key` em `index.tsx`) para continuar
 * pura e testável — a tela só reordena os próprios objetos por elas.
 */
export function prioritizeActions(keys: string[], interests: string[]): string[] {
  const first = 'browse';
  if (interests.length === 0 || !keys.includes(first)) return keys;
  return [first, ...keys.filter((key) => key !== first)];
}
