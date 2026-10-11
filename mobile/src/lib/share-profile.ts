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

/**
 * O que cada interesse muda no card e na legenda. Mesmos ids de `INTERESTS`
 * em `app/onboarding.tsx` (o backend recusa qualquer outro com 422).
 *
 * `tagline` vai embaixo do nome no card (do interesse principal, o primeiro
 * marcado); `hook` entra na legenda. O ícone de cada um vive no componente,
 * que é o lado com React Native.
 */
export interface InterestTheme {
  label: string;
  tagline: string;
  hook: string;
  hashtag: string;
}

export const INTEREST_THEMES: Record<string, InterestTheme> = {
  defi: {
    label: 'DeFi',
    tagline: 'Earning yield with my AI agent',
    hook: 'my AI agent puts my USDC to work in DeFi',
    hashtag: '#DeFi',
  },
  games: {
    label: 'Games',
    tagline: 'Leveling up in Web3 games',
    hook: 'I play Web3 games and get rewarded for it',
    hashtag: '#Web3Gaming',
  },
  cards: {
    label: 'Cards',
    tagline: 'Collecting cards on-chain',
    hook: 'I collect and trade cards on-chain',
    hashtag: '#TCG',
  },
  trader: {
    label: 'Trader',
    tagline: 'Trading smarter with AI',
    hook: 'my AI agent helps me trade smarter',
    hashtag: '#Trading',
  },
  memecoins: {
    label: 'Memecoins',
    tagline: 'Hunting the next memecoin',
    hook: "I'm hunting the next memecoin",
    hashtag: '#Memecoins',
  },
};

const FALLBACK_TAGLINE = 'Earning USDC with my AI agent';

export function interestLabel(id: string): string {
  return INTEREST_THEMES[id]?.label ?? id;
}

/** Frase do card: a do interesse principal, ou a genérica. */
export function profileTagline(interests: readonly string[]): string {
  const primary = interests.find((id) => INTEREST_THEMES[id]);
  return primary ? INTEREST_THEMES[primary].tagline : FALLBACK_TAGLINE;
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

/**
 * Normaliza o que o usuário digitou no campo de rede social: aceita
 * `@handle`, `handle` ou o link do perfil colado (`https://x.com/handle`,
 * `instagram.com/handle/?igsh=...`). Devolve só o handle, sem `@`.
 */
export function cleanHandle(raw: string | null | undefined): string | null {
  let value = raw?.trim() ?? '';
  const fromUrl = value.match(/(?:x|twitter|instagram)\.com\/([^/?#\s]+)/i);
  if (fromUrl) value = fromUrl[1];
  value = value.replace(/^@+/, '').trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(value) ? value : null;
}

/** `@handle` do X: o do perfil do backend tem prioridade sobre o do Privy. */
export function xHandle(
  socialTwitter: string | undefined,
  accounts: readonly LinkedAccountLike[] | undefined,
): string | null {
  return (
    cleanHandle(socialTwitter) ??
    cleanHandle(accounts?.find((a) => a.type === 'twitter_oauth')?.username)
  );
}

/** `@handle` do Instagram — só existe no perfil do backend. */
export function instagramHandle(socialInstagram: string | undefined): string | null {
  return cleanHandle(socialInstagram);
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

/** Para onde a legenda vai — cada canal tem um tom e um limite. */
export type ShareChannel = 'whatsapp' | 'x';

/**
 * Legenda que acompanha a imagem, montada a partir dos interesses.
 *
 * - **whatsapp**: conversa com amigo — tom pessoal, até dois interesses e o
 *   link no fim (o WhatsApp gera a prévia dele).
 * - **x**: curta, com hashtags dos interesses. O X conta qualquer URL como
 *   23 caracteres; o texto fica bem abaixo dos 280.
 */
export function buildShareCaption(
  { name, interests }: ShareCaptionInput,
  channel: ShareChannel,
  url: string = SHARE_URL,
): string {
  const themes = interests.map((id) => INTEREST_THEMES[id]).filter(Boolean);
  const first = name?.trim().split(/\s+/)[0];

  if (channel === 'whatsapp') {
    const hooks = themes.slice(0, 2).map((t) => t.hook);
    const why = hooks.length ? ` — ${hooks.join(' and ')}` : ' — my AI agent that earns USDC';
    const hello = first ? `Hey! It's ${first} 👋` : 'Hey! 👋';
    return `${hello}\nI'm on Xiaolee${why}.\nJoin me: ${url}`;
  }

  const tags = ['#Xiaolee', ...themes.slice(0, 2).map((t) => t.hashtag), '#USDC'];
  const what = themes[0]?.hook ?? 'my AI agent earns USDC for me';
  return `I'm on Xiaolee — ${what} ✨\n${tags.join(' ')}\n${url}`;
}

/**
 * Intent web do X — fallback de quando o app do X não está instalado. Não
 * aceita imagem, por isso é só o caminho de reserva; o link já vem no texto.
 */
export function xIntentUrl(text: string): string {
  const params = new URLSearchParams({ text });
  return `https://x.com/intent/post?${params.toString()}`;
}
