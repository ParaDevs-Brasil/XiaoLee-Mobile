import { File, UploadTask, UploadType } from 'expo-file-system';

import { completeMedia, createMedia, getMedia, type MediaAsset, type MediaDetail } from '@/api/backend';
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
  if (!contentType) throw new MediaUploadError('Escolha um arquivo de vídeo ou áudio.');
  const size = file.size;
  if (!size) throw new MediaUploadError('Não consegui ler o tamanho do arquivo.');
  if (size > MAX_MEDIA_BYTES) throw new MediaUploadError('Arquivo grande demais (máximo 2 GB).');

  const ticket = await createMedia({ filename: file.name, content_type: contentType, size_bytes: size });

  const result = await new UploadTask(file, ticket.upload_url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: ticket.upload_headers,
    signal,
    onProgress: (p) => onProgress?.(uploadPercent(p.bytesSent, p.totalBytes)),
  }).uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new MediaUploadError(`O envio falhou (HTTP ${result.status}). Tente de novo.`);
  }

  return completeMedia(ticket.asset.id);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Espera a transcrição terminar (`transcribed` ou `failed`). Falha do
 * backend NÃO lança: volta como `status: 'failed'` com `error`, para a tela
 * decidir (ex.: oferecer reenviar `/complete`).
 */
export async function waitForTranscript(
  id: number,
  { signal, intervalMs = 3000, timeoutMs = 15 * 60_000 }: { signal?: AbortSignal; intervalMs?: number; timeoutMs?: number } = {},
): Promise<MediaDetail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new MediaUploadError('Cancelado.');
    const media = await getMedia(id);
    if (media.status === 'transcribed' || media.status === 'failed') return media;
    if (Date.now() > deadline) throw new MediaUploadError('A transcrição está demorando mais que o normal.');
    await sleep(intervalMs);
  }
}
