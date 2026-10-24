import { File, UploadTask, UploadType } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { completeCreator, createCreator, createMotionUpload, type SyntheticCreator } from '@/api/backend';

/**
 * Persona sintética: foto de referência (o próprio rosto, um personagem ou
 * meme) + voz pronta. A foto vai direto ao
 * storage por URL pré-assinada (mesmo caminho do upload do Clipper) e o
 * `/complete` só confere que ela chegou.
 */

export interface PickedImage {
  uri: string;
  contentType: string;
  size: number;
}

/** Galeria com corte 9:16 (o vídeo sai vertical). `null` se cancelar. */
export async function pickReferenceImage(): Promise<PickedImage | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [9, 16],
    quality: 0.9,
  });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  return { uri: asset.uri, contentType: asset.mimeType ?? 'image/jpeg', size: asset.fileSize ?? file.size ?? 0 };
}

export async function createPersona(name: string, voiceId: string, image: PickedImage): Promise<SyntheticCreator> {
  const ticket = await createCreator({
    name: name.trim(),
    voice_id: voiceId,
    content_type: image.contentType,
    size_bytes: image.size,
    // A tela só libera o botão com o termo marcado.
    rights_confirmed: true,
  });
  const result = await new UploadTask(new File(image.uri), ticket.upload_url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: ticket.upload_headers,
  }).uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`The photo upload failed (HTTP ${result.status}). Try again.`);
  }
  return completeCreator(ticket.creator.id);
}

export interface PickedMotion {
  uri: string;
  contentType: string;
  size: number;
  /** Segundos; o backend confere de novo com ffprobe. */
  seconds: number;
  /** Segundo do vídeo onde o trecho usado começa (o corte); 0 = do início. */
  startS: number;
}

/** Vídeo de movimento do mimic, da galeria. `null` se cancelar. */
export async function pickMotionVideo(): Promise<PickedMotion | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  return {
    uri: asset.uri,
    contentType: asset.mimeType ?? 'video/mp4',
    size: asset.fileSize ?? file.size ?? 0,
    seconds: (asset.duration ?? 0) / 1000,
    startS: 0,
  };
}

/** Sobe o vídeo de movimento ao storage e devolve a chave que o `createCreatorVideo` espera. */
export async function uploadMotion(video: PickedMotion): Promise<string> {
  const ticket = await createMotionUpload({ content_type: video.contentType, size_bytes: video.size });
  const result = await new UploadTask(new File(video.uri), ticket.upload_url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: ticket.upload_headers,
  }).uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`The video upload failed (HTTP ${result.status}). Try again.`);
  }
  return ticket.motion_key;
}
