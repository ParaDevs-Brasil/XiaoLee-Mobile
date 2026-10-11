import { requireOptionalNativeModule } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { listClips, type MediaClip } from '@/api/backend';
import { clipFileName } from '@/lib/clips';

/**
 * Tirar um corte pronto do app para onde o creator quer guardar ou postar.
 *
 * O R2 (`backend/server/media_storage.py`) NÃO é um destino: é onde o vídeo
 * longo e os cortes ficam enquanto o servidor transcreve e renderiza (o
 * celular não processa 1 h de vídeo). O corte só é "do creator" quando sai de
 * lá por um dos destinos abaixo — é aqui que novos destinos entram.
 *
 * Hoje (os dois baixam com `downloadClip` e entregam o arquivo):
 * - Galeria do aparelho (`saveClipToDevice`): o destino principal.
 * - Tela de compartilhar do sistema (`shareClip`): entrega o MP4 ao TikTok,
 *   Instagram, YouTube, WhatsApp. Sem aprovação de API nenhuma.
 *
 * Próximos (sem passar pelo celular: o backend copia do R2 para o serviço):
 * - Nuvem do creator (Google Drive, Dropbox…): OAuth do serviço no backend e
 *   cópia direta do R2, sem passar pelo celular.
 * - TikTok direto: Content Posting API pelo backend, depende da aprovação do
 *   app (XIAOLEEACE-24) — ver `docs/workflows/TIKTOK_DIRECT_POST.md`.
 */

/** Erro já com mensagem exibível. */
export class ClipShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipShareError';
  }
}

/**
 * O `download_url` da lista expira em 1 h — a tela pode estar aberta há mais
 * tempo que isso. Busca a lista de novo na hora de usar e devolve a URL
 * recém-assinada (`null` se o corte não estiver mais pronto).
 */
export async function freshClipUrl(mediaId: number, clipId: number): Promise<string | null> {
  const clips = await listClips(mediaId);
  return clips.find((c) => c.id === clipId)?.download_url ?? null;
}

/**
 * `expo-sharing` é módulo nativo: só existe nos builds gerados depois dele
 * entrar no projeto. Num APK antigo, importar o pacote derrubaria o app —
 * daí a checagem sem importar e o `require` tardio dentro das funções.
 *
 * `require` e não `import()`: em desenvolvimento o `import()` vira um bundle
 * separado que o app baixa do Metro no momento do toque. Com o Metro fora de
 * alcance, isso recarregou o app inteiro — e o Android derrubou o app no meio
 * do recarregamento (signal 11 no Fabric). O `require` já vem no bundle
 * principal; só executa o módulo (que chama o nativo) quando a função roda.
 */
export const canShareClips = requireOptionalNativeModule('ExpoSharing') !== null;

/** Mesmo motivo de `canShareClips`, para `expo-media-library` (API nova). */
export const canSaveClips = requireOptionalNativeModule('ExpoMediaLibraryNext') !== null;

/**
 * MP4 do corte no cache do app, baixado uma vez por corte (o id muda a cada
 * geração, então nunca entrega um corte antigo). Ponto de partida de todo
 * destino que precisa do arquivo no aparelho — compartilhar hoje, galeria
 * depois.
 */
export async function downloadClip(mediaId: number, clip: Pick<MediaClip, 'id' | 'title'>): Promise<File> {
  const dir = new Directory(Paths.cache, 'clips');
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, clipFileName(clip));
  if (file.exists) return file;

  const url = await freshClipUrl(mediaId, clip.id);
  if (!url) throw new ClipShareError('This clip is no longer available.');
  // Baixa num nome temporário e só então renomeia: um download que cai no
  // meio não pode deixar um MP4 pela metade com o nome final, que seria
  // reaproveitado no próximo toque.
  const partial = new File(dir, `${clipFileName(clip)}.part`);
  if (partial.exists) partial.delete();
  try {
    await File.downloadFileAsync(url, partial);
    await partial.move(file);
  } catch {
    if (partial.exists) partial.delete();
    throw new ClipShareError("Couldn't download the clip. Check your connection and try again.");
  }
  return file;
}

/** Baixa o corte (`downloadClip`) e abre a tela de compartilhar do sistema. */
export async function shareClip(mediaId: number, clip: Pick<MediaClip, 'id' | 'title'>): Promise<void> {
  if (!canShareClips) {
    throw new ClipShareError('Update the app to share clips — this version is missing the share feature.');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- carregamento tardio, ver `canShareClips`
  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  const file = await downloadClip(mediaId, clip);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'video/mp4',
    UTI: 'public.mpeg-4',
    dialogTitle: clip.title,
  });
}

/**
 * Baixa o corte (`downloadClip`) e grava na galeria do aparelho.
 *
 * Permissões, de propósito o mínimo:
 * - Android 11+ (API 30+): nenhuma. A biblioteca grava pelo MediaStore, que
 *   deixa o app adicionar os próprios arquivos sem pedir nada.
 * - Android 10 ou anterior (API ≤ 29): escrita no armazenamento. A API nova do
 *   `expo-media-library` usa o caminho legado abaixo do API 30 e exige a
 *   permissão no `create` (o manifesto da biblioteca já declara, limitado a ≤ 32).
 *   Antes o corte era `< 29`, e o Save sempre falhava no Android 10.
 * - iOS: só "adicionar à galeria" (`writeOnly`), nunca leitura das fotos — o
 *   texto do pedido está em `ios.infoPlist` no `app.json`.
 *
 * O config plugin do `expo-media-library` fica DE FORA do `app.json`: ele
 * adicionaria READ_MEDIA_IMAGES/VIDEO/AUDIO (leitura), que o app não usa e
 * que obrigam a declaração da política de fotos e vídeos do Google Play. O
 * manifesto da própria biblioteca ainda traz READ_MEDIA_VISUAL_USER_SELECTED e
 * READ_EXTERNAL_STORAGE — bloqueados em `android.blockedPermissions` no
 * `app.json` (o app nunca lê a galeria; só WRITE_EXTERNAL_STORAGE ≤ 32 fica).
 */
export async function saveClipToDevice(mediaId: number, clip: Pick<MediaClip, 'id' | 'title'>): Promise<void> {
  if (!canSaveClips) {
    throw new ClipShareError('Update the app to save clips — this version is missing the save feature.');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- carregamento tardio, ver `canShareClips`
  const MediaLibrary = require('expo-media-library') as typeof import('expo-media-library');

  if (Platform.OS === 'ios' || (Platform.OS === 'android' && Platform.Version < 30)) {
    const { granted } = await MediaLibrary.requestPermissionsAsync(true, ['video']);
    if (!granted) {
      throw new ClipShareError('Allow XiaoLee to add videos to your gallery in Settings, then try again.');
    }
  }

  const file = await downloadClip(mediaId, clip);
  try {
    await MediaLibrary.Asset.create(file.uri);
  } catch {
    throw new ClipShareError("Couldn't save the clip to your gallery. Try again.");
  }
}
