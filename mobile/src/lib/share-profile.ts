/**
 * Template do "compartilhar perfil" (XIAOLEEACE-21) — a parte pura, sem
 * React Native, para rodar no teste com `node --experimental-strip-types`.
 *
 * A imagem em si é o `ShareProfileCard` capturado pelo `react-native-view-shot`;
 * aqui fica o que o card e a legenda precisam decidir: qual foto usar, quais
 * iniciais mostrar quando não há foto, o texto do post e o link do X.
 */

/**
 * Para onde o post aponta. A landing é a porta de entrada pública (waitlist +
 * APK); o app ainda não tem deep link web por perfil.
 */
export const SHARE_URL = 'https://xiaolee-landing-production.up.railway.app';

/** Rótulos dos interesses — mesmos ids de `INTERESTS` em `app/onboarding.tsx`. */
const INTEREST_LABELS: Record<string, string> = {
  defi: 'DeFi',
  games: 'Games',
  cards: 'Cards',
  trader: 'Trader',
  memecoins: 'Memecoins',
};

export function interestLabel(id: string): string {
  return INTEREST_LABELS[id] ?? id;
}

/**
 * O pedaço do `usePrivy().user` que importa aqui. Tipado por formato, e não
 * importando o tipo do Privy, para o teste rodar sem `node_modules` nativo.
 */
export interface LinkedAccountLike {
  type: string;
  profile_picture_url?: string | null;
  username?: string | null;
}

/**
 * Foto de perfil a partir das contas vinculadas no Privy.
 *
 * O backend não guarda foto. Quem vem de X/Discord/etc. traz
 * `profile_picture_url` na conta vinculada; login por Google ou e-mail não
 * traz nada — aí o card cai nas iniciais.
 */
export function profilePhotoUrl(accounts: readonly LinkedAccountLike[] | undefined): string | null {
  for (const account of accounts ?? []) {
    const url = account.profile_picture_url?.trim();
    if (url && /^https:\/\//.test(url)) return url;
  }
  return null;
}

/** `@handle` do X: o do perfil do backend tem prioridade sobre o do Privy. */
export function xHandle(
  socialTwitter: string | undefined,
  accounts: readonly LinkedAccountLike[] | undefined,
): string | null {
  const fromProfile = socialTwitter?.trim().replace(/^@/, '');
  if (fromProfile) return fromProfile;
  const linked = accounts?.find((a) => a.type === 'twitter_oauth')?.username?.trim();
  return linked || null;
}

/** Até duas iniciais do nome; sem nome, a marca. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'XL';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export interface ShareCaptionInput {
  name: string | null;
  interests: readonly string[];
}

/**
 * Texto que acompanha a imagem. Curto o bastante para caber no X com o link
 * (o X conta qualquer URL como 23 caracteres).
 */
export function buildShareCaption({ name, interests }: ShareCaptionInput): string {
  const who = name?.trim() ? `I'm ${name.trim()} and I'm` : "I'm";
  const tags = interests.slice(0, 3).map(interestLabel);
  const into = tags.length ? ` Into ${tags.join(', ')}.` : '';
  return `${who} on Xiaolee — earning USDC with my AI agent.${into} Join me:`;
}

/** Intent web do X: abre o app do X se instalado, senão o navegador. */
export function xIntentUrl(text: string, url: string = SHARE_URL): string {
  const params = new URLSearchParams({ text, url });
  return `https://x.com/intent/post?${params.toString()}`;
}
