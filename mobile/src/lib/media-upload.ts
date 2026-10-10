import { File, UploadTask, UploadType } from 'expo-file-system';

import { completeMedia, createMedia, type MediaAsset } from '@/api/backend';
import { MAX_MEDIA_BYTES, mediaContentType, uploadPercent } from '@/lib/media';

/**
 * Upload de mídia do Clipper: pede a URL pré-assinada ao backend, envia o
 * arquivo direto ao storage (nunca passa pelo backend — vídeo tem GBs) e
 * confirma com `/complete`, que dispara a transcrição.
 *
 * Sem UI: tela/botão ficam com quem desenha a interface. Só usa o
 * `expo-file-system` do SDK 57 (seletor + `UploadTask`), que já vem com o
 * `expo` — não exige dependência nativa nova.
 */

/** Erro de validação local, já com mensagem exibível. */
export class MediaUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaUploadError';
  }
}

/** Abre o seletor do sistema (vídeo/áudio). `null` se o usuário cancelar. */
export async function pickMediaFile(): Promise<File | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['video/*', 'audio/*'] });
  return picked.canceled ? null : picked.result;
}

export interface UploadOptions {
  /** 0–100, inteiro. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/** Envia o arquivo e devolve a mídia já em `transcribing`. */
export async function uploadMedia(file: File, { onProgress, signal }: UploadOptions = {}): Promise<MediaAsset> {
  const contentType = mediaContentType(file.name, file.type);
  if (!contentType) throw new MediaUploadError('Choose a video or audio file.');
  const size = file.size;
  if (!size) throw new MediaUploadError("Couldn't read the file size.");
  if (size > MAX_MEDIA_BYTES) throw new MediaUploadError('This file is over 2 GB. Trim it or export it at a lower quality, then try again.');

  const ticket = await createMedia({ filename: file.name, content_type: contentType, size_bytes: size });

  const result = await new UploadTask(file, ticket.upload_url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: ticket.upload_headers,
    signal,
    onProgress: (p) => onProgress?.(uploadPercent(p.bytesSent, p.totalBytes)),
  }).uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new MediaUploadError(`The upload failed (HTTP ${result.status}). Try again.`);
  }

  return completeMedia(ticket.asset.id);
}
