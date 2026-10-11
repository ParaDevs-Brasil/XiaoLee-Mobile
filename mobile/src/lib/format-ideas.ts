/**
 * Regras puras do card "Format ideas" da tela de Clips (XIAOLEEACE-32), sem
 * React/Expo — testável em Node. As sugestões vêm prontas do backend
 * (`GET /v1/media/format-suggestions`); aqui só se decide como mostrá-las.
 */
import type { FormatPlatform, FormatSuggestion } from '@/api/backend';

const PLATFORM_LABEL: Record<FormatPlatform, string> = {
  tiktok: 'TikTok',
  reels: 'Reels',
  shorts: 'Shorts',
  x: 'X',
};

/** Nome da rede como o creator conhece; valor desconhecido aparece como veio. */
export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform as FormatPlatform] ?? platform;
}

/** "TikTok · 45 s" / "Reels · 1 min 30 s" — a linha de meta embaixo do nome do formato. */
export function formatIdeaMeta(s: Pick<FormatSuggestion, 'platform' | 'duration_s'>): string {
  const total = Math.max(0, Math.round(s.duration_s));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  const length = min === 0 ? `${sec} s` : sec === 0 ? `${min} min` : `${min} min ${sec} s`;
  return `${platformLabel(s.platform)} · ${length}`;
}

/** De onde a sugestão saiu — o creator confia mais quando vê que a IA olhou os vídeos dele. */
export function formatIdeasSource(basedOnVideos: number): string {
  if (basedOnVideos <= 0) return 'Based on your interests. Upload a video for sharper ideas.';
  return `Based on your interests and your last ${basedOnVideos === 1 ? 'video' : `${basedOnVideos} videos`}.`;
}

/**
 * Mensagem de falha pelo status HTTP: 503 é do nosso lado (crédito, provedor
 * fora) e não adianta insistir agora; o resto (502, rede) vale tentar de novo.
 */
export function formatIdeasError(status: number | null | undefined): { message: string; retry: boolean } {
  if (status === 503) return { message: 'Format ideas are unavailable right now. Try again later.', retry: false };
  if (status === 401) return { message: 'Sign in again to get format ideas.', retry: false };
  return { message: 'Couldn’t get format ideas.', retry: true };
}
