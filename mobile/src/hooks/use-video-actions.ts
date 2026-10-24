import { useState } from 'react';
import { Alert } from 'react-native';

import type { CreatorVideo } from '@/api/backend';
import { ApiError } from '@/api/client';
import { ClipShareError } from '@/lib/clip-share';
import { saveCreatorVideoToDevice, shareCreatorVideo } from '@/lib/creator-video-share';

export type VideoActionKind = 'save' | 'share';

/**
 * Salvar na galeria e compartilhar vídeos de personagens, um por vez (cada um baixa o MP4). Quem usa mostra o
 * `action` no botão e o `savedIds` como "salvo"; o erro já sai num alerta.
 */
export function useVideoActions() {
  const [action, setAction] = useState<{ id: number; kind: VideoActionKind } | null>(null);
  const [savedIds, setSavedIds] = useState<Set<number>>(() => new Set());

  async function run(video: CreatorVideo, kind: VideoActionKind, title: string) {
    if (action !== null) return;
    setAction({ id: video.id, kind });
    try {
      if (kind === 'save') {
        await saveCreatorVideoToDevice(video);
        setSavedIds((prev) => new Set(prev).add(video.id));
      } else {
        await shareCreatorVideo(video, title);
      }
    } catch (e) {
      const message =
        e instanceof ClipShareError || e instanceof ApiError
          ? e.message
          : kind === 'save'
            ? "Couldn't save the video."
            : "Couldn't open the share screen.";
      Alert.alert(kind === 'save' ? "Couldn't save the video" : "Couldn't share the video", message);
    } finally {
      setAction(null);
    }
  }

  return { action, savedIds, run };
}
