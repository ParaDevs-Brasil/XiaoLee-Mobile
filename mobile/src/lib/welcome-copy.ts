/**
 * Copy da boas-vindas do 1º clique no chat (XIAOLEEACE-19).
 *
 * Função pura, sem React Native, para rodar no teste com
 * `node --experimental-strip-types`. Personaliza pelo perfil coletado no
 * onboarding (S2): primeiro nome e interesses — só os campos que o backend
 * já devolve em `GET /user/me/profile`, nenhum cálculo próprio.
 *
 * O mobile ainda não tem i18n; o idioma vem do locale do aparelho, e tudo que
 * não for português cai no inglês, que é o idioma padrão do resto do app.
 */

export type WelcomeLanguage = 'pt' | 'en';

/** O recorte de `MyProfile` que a copy usa. */
export interface WelcomeProfile {
  full_name: string | null;
  interest_profile: string[];
}

export interface WelcomeCopy {
  title: string;
  body: string;
}

/** `pt-BR`, `pt_PT`, `pt` → `pt`; o resto → `en`. */
export function welcomeLanguage(locale: string | undefined): WelcomeLanguage {
  return locale?.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

/** Primeiro nome, para a saudação não soar como formulário. */
function firstName(fullName: string | null | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? '';
}

/**
 * Um gancho por interesse do onboarding (`INTERESTS` em `onboarding.tsx`).
 * Só o primeiro interesse conhecido entra — a mensagem já é longa o bastante.
 */
const INTEREST_HOOKS: Record<WelcomeLanguage, Record<string, string>> = {
  en: {
    defi: 'Since you’re into DeFi, I can swap tokens and track your USDC for you.',
    games: 'Since you’re into games, campaigns are a great way to reward your players.',
    cards: 'Since you’re into cards, campaigns can reward your collectors.',
    trader: 'Since you trade, I can run swaps and show your recent transactions.',
    memecoins: 'Since you’re into memecoins, I can swap them and reward your community.',
  },
  pt: {
    defi: 'Como você curte DeFi, posso fazer swaps e acompanhar seu USDC por você.',
    games: 'Como você curte games, campanhas são um ótimo jeito de recompensar seus jogadores.',
    cards: 'Como você curte cards, campanhas podem recompensar seus colecionadores.',
    trader: 'Como você é trader, posso fazer swaps e mostrar suas transações recentes.',
    memecoins: 'Como você curte memecoins, posso fazer swaps e recompensar sua comunidade.',
  },
};

const COPY: Record<
  WelcomeLanguage,
  { title: (name: string) => string; intro: string; outro: string }
> = {
  en: {
    title: (name) => (name ? `Welcome, ${name}! I’m Xiaolee ✨` : 'Welcome! I’m Xiaolee ✨'),
    intro:
      'I’m your creator assistant: I create campaigns to reward your community, show your dashboard metrics, make swaps and check your balance — all by message.',
    outro: 'Tap a shortcut below or just tell me what you need.',
  },
  pt: {
    title: (name) => (name ? `Boas-vindas, ${name}! Eu sou a Xiaolee ✨` : 'Boas-vindas! Eu sou a Xiaolee ✨'),
    intro:
      'Sou sua assistente de criador: crio campanhas para recompensar sua comunidade, mostro as métricas do seu dashboard, faço swaps e consulto seu saldo — tudo por mensagem.',
    outro: 'Toque num atalho abaixo ou me diga do que você precisa.',
  },
};

export function buildWelcomeCopy(
  profile: WelcomeProfile | null,
  language: WelcomeLanguage,
): WelcomeCopy {
  const copy = COPY[language];
  const hook = profile?.interest_profile
    .map((interest) => INTEREST_HOOKS[language][interest])
    .find(Boolean);

  return {
    title: copy.title(firstName(profile?.full_name)),
    body: [copy.intro, hook, copy.outro].filter(Boolean).join(' '),
  };
}
