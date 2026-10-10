import { useCallback, useEffect, useRef, useState } from 'react';

import type { MediaAsset } from '@/api/backend';
import { ApiError } from '@/api/client';
import { uploadEtaSeconds } from '@/lib/clips';
import { MediaUploadError, pickMediaFile, uploadMedia } from '@/lib/media-upload';

export type MediaUploadState =
  | { phase: 'idle' }
  | {
      phase: 'uploading';
      percent: number;
      filename: string;
      totalBytes: number;
      /** Quanto falta, pelo ritmo até agora; `null` enquanto a estimativa não é confiável. */
      etaSeconds: number | null;
    }
  | { phase: 'done'; asset: MediaAsset }
  | { phase: 'error'; message: string };

/**
 * Máquina de estados do fluxo "escolher arquivo → enviar".
 * Só lógica (sem UI): a tela chama `start()` e renderiza `state`.
 * `cancel()` aborta o envio; sair da tela também.
 *
 * Termina no `/complete` (mídia já em `transcribing`) e não espera a
 * transcrição: quem acompanha é a tela do vídeo, pelo status no backend —
 * transcrever 1 h leva minutos, e esse estado não pode morrer com esta tela.
 */
export function useMediaUpload() {
  const [state, setState] = useState<MediaUploadState>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = useCallback(async (): Promise<MediaAsset | null> => {
    cancel();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const file = await pickMediaFile();
      if (!file) return null; // usuário cancelou o seletor
      const base = { phase: 'uploading' as const, filename: file.name, totalBytes: file.size };
      const startedAt = Date.now();
      setState({ ...base, percent: 0, etaSeconds: null });
      // O nativo avisa progresso muito mais vezes que o percentual inteiro
      // muda; sem o filtro, um upload de GBs re-renderiza a tela a cada aviso.
      let shown = 0;
      const asset = await uploadMedia(file, {
        signal: controller.signal,
        onProgress: (percent) => {
          if (percent === shown) return;
          shown = percent;
          setState({ ...base, percent, etaSeconds: uploadEtaSeconds(percent, Date.now() - startedAt) });
        },
      });
      setState({ phase: 'done', asset });
      return asset;
    } catch (error) {
      if (controller.signal.aborted) {
        setState({ phase: 'idle' });
        return null;
      }
      const message =
        error instanceof MediaUploadError || error instanceof ApiError
          ? error.message
          : "Couldn't upload the file.";
      setState({ phase: 'error', message });
      return null;
    }
  }, [cancel]);

  const reset = useCallback(() => setState({ phase: 'idle' }), []);

  return { state, start, cancel, reset };
}
