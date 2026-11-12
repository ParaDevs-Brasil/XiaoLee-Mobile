import * as ImagePicker from 'expo-image-picker';

import { MAX_IMAGES, type PostImage } from './post-images-core';

export { MAX_IMAGES, MAX_IMAGE_BYTES, base64Bytes, mergeImages, moveImage, type PostImage } from './post-images-core';

const MIME_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/**
 * Abre a galeria (no Android 13+ é o Photo Picker do sistema, sem pedir permissão de armazenamento) e devolve as
 * fotos escolhidas, ou lista vazia se cancelou. `quality` 0.8 mantém a foto bem abaixo dos 5 MB.
 */
export async function pickPostImages(max: number): Promise<PostImage[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, Math.min(max, MAX_IMAGES)),
    base64: true,
    quality: 0.8,
  });
  if (result.canceled) return [];
  return result.assets
    .filter((a) => a.base64)
    .map((a) => {
      const ext = (a.uri.split('.').pop() ?? '').toLowerCase();
      return { uri: a.uri, base64: a.base64 as string, mime: a.mimeType ?? MIME_BY_EXT[ext] ?? 'image/jpeg' };
    });
}
