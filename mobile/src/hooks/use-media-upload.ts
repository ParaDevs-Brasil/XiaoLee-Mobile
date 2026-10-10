import { useCallback, useEffect, useRef, useState } from 'react';

import type { MediaDetail } from '@/api/backend';
import { ApiError } from '@/api/client';
import { MediaUploadError, pickMediaFile, uploadMedia, waitForTranscript } from '@/lib/media-upload';

export type MediaUploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; percent: number }
  | { phase: 'transcribing' }
  | { phase: 'done'; media: MediaDetail }
  | { phase: 'error'; message: string };

/**
 * Máquina de estados do fluxo "escolher arquivo → enviar → transcrever".
 * Só lógica (sem UI): a tela chama `start()` e renderiza `state`.
 * `cancel()` aborta o envio e a espera; sair da tela também.
 */
export function useMediaUpload() {
  const [state, setState] = useState<MediaUploadState>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = useCallback(async () => {
    cancel();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const file = await pickMediaFile();
      if (!file) return; // usuário cancelou o seletor
      setState({ phase: 'uploading', percent: 0 });
      const asset = await uploadMedia(file, {
        signal: controller.signal,
        onProgress: (percent) => setState({ phase: 'uploading', percent }),
      });
      setState({ phase: 'transcribing' });
      const media = await waitForTranscript(asset.id, { signal: controller.signal });
      setState(
        media.status === 'failed'
          ? { phase: 'error', message: media.error ?? 'A transcrição falhou.' }
          : { phase: 'done', media },
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setState({ phase: 'idle' });
        return;
      }
      const message =
        error instanceof MediaUploadError || error instanceof ApiError
          ? error.message
          : 'Não foi possível enviar o arquivo.';
      setState({ phase: 'error', message });
    }
  }, [cancel]);

  const reset = useCallback(() => setState({ phase: 'idle' }), []);

  return { state, start, cancel, reset };
}
