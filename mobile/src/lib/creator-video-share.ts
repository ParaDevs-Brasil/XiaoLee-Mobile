import { Directory, File, Paths } from 'expo-file-system';

import { listCreatorVideos, type CreatorVideo } from '@/api/backend';
import { ClipShareError, saveVideoFileToGallery, shareVideoFile } from '@/lib/clip-share';

/**
 * Tirar um vídeo de personagem do app: baixar para a galeria ou abrir a tela de compartilhar do sistema (TikTok,
 * Instagram, WhatsApp…). Mesmo caminho dos cortes (`clip-share`): o MP4 vem do storage e passa pelo cache do app.
 */

/** O `video_url` da lista é assinado e expira; busca de novo na hora de usar. */
async function freshVideoUrl(video: Pick<CreatorVideo, 'id' | 'creator_id'>): Promise<string | null> {
  const list = await listCreatorVideos(video.creator_id);
  return list.find((v) => v.id === video.id)?.video_url ?? null;
}

async function downloadCreatorVideo(video: Pick<CreatorVideo, 'id' | 'creator_id'>): Promise<File> {
  const dir = new Directory(Paths.cache, 'creator-videos');
  dir.create({ intermediates: true, idempotent: true });
  const name = `xiaolee-video-${video.id}.mp4`;
  const file = new File(dir, name);
  if (file.exists) return file;

  const url = await freshVideoUrl(video);
  if (!url) throw new ClipShareError('This video is no longer available.');
  // Nome temporário + rename: um download que cai no meio não deixa um MP4 pela metade com o nome final.
  const partial = new File(dir, `${name}.part`);
  if (partial.exists) partial.delete();
  try {
    await File.downloadFileAsync(url, partial);
    await partial.move(file);
  } catch {
    if (partial.exists) partial.delete();
    throw new ClipShareError("Couldn't download the video. Check your connection and try again.");
  }
  return file;
}

export async function shareCreatorVideo(video: Pick<CreatorVideo, 'id' | 'creator_id'>, title: string): Promise<void> {
  await shareVideoFile(await downloadCreatorVideo(video), title);
}

export async function saveCreatorVideoToDevice(video: Pick<CreatorVideo, 'id' | 'creator_id'>): Promise<void> {
  await saveVideoFileToGallery(await downloadCreatorVideo(video));
}
