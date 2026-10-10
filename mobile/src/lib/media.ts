/**
 * Helpers puros do upload de mídia do Clipper (sem React/Expo — testável em Node).
 * O backend (`media_routes.py`) só aceita `video/*` e `audio/*` e assina o
 * Content-Type no PUT, então ele precisa estar certo antes de pedir a URL.
 */

const BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

/** Mesmo limite de `MEDIA_MAX_BYTES` do backend (2 GiB). */
export const MAX_MEDIA_BYTES = 2 * 1024 ** 3;

/**
 * MIME do arquivo: usa o que o seletor informou se for de vídeo/áudio; senão
 * deduz pela extensão. Devolve `null` quando não é mídia suportada.
 */
export function mediaContentType(filename: string, pickerType?: string | null): string | null {
  if (pickerType && /^(video|audio)\//.test(pickerType)) return pickerType;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? null;
}

/** 0–100, inteiro; tolera total desconhecido (0) sem dividir por zero. */
export function uploadPercent(sent: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((sent / total) * 100)));
}
