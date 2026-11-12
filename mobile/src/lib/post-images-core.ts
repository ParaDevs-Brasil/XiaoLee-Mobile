// Parte pura de `post-images.ts` (sem Expo), para testar no Node.

/** Foto escolhida para um post: `uri` para mostrar, `base64`+`mime` para enviar ao backend. */
export interface PostImage {
  uri: string;
  mime: string;
  base64: string;
}

/** O menor limite entre as redes (X: 5 MB por imagem) e o máximo por post (X e Bluesky: 4). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 4;

/** Tamanho em bytes do arquivo que um base64 representa. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/**
 * Junta as fotos já escolhidas com as novas: sem repetir a mesma, até `MAX_IMAGES`, e separa as que passam de 5 MB
 * (a rede recusa) para o app avisar o creator em vez de falhar na hora de postar.
 */
export function mergeImages(
  current: PostImage[],
  picked: PostImage[],
): { images: PostImage[]; tooBig: number; overLimit: number } {
  let tooBig = 0;
  const images = [...current];
  let overLimit = 0;
  for (const img of picked) {
    if (images.some((i) => i.uri === img.uri)) continue;
    if (base64Bytes(img.base64) > MAX_IMAGE_BYTES) {
      tooBig += 1;
      continue;
    }
    if (images.length >= MAX_IMAGES) {
      overLimit += 1;
      continue;
    }
    images.push(img);
  }
  return { images, tooBig, overLimit };
}

/** Move a foto `from` para a posição `to` (a primeira é a capa do post). */
export function moveImage<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
