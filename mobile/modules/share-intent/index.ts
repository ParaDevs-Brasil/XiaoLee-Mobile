import { requireOptionalNativeModule } from 'expo';

/**
 * Ponte para `ShareIntentModule.kt` — ver o comentário de lá.
 *
 * Só Android. Em outra plataforma o módulo não existe e `shareImage` lança;
 * o chamador cai no fallback dele.
 */

export interface ShareImageOptions {
  /** `content://` da imagem (use `File.contentUri` do `expo-file-system`). */
  uri: string;
  text: string;
  mimeType?: string;
  /** Sem pacote abre o seletor do sistema. */
  packageName?: string;
  /** Atividade exata dentro do pacote. */
  className?: string;
  chooserTitle?: string;
}

interface ShareIntentNative {
  shareImage(options: ShareImageOptions): Promise<void>;
}

const native = requireOptionalNativeModule<ShareIntentNative>('ShareIntent');

export async function shareImage(options: ShareImageOptions): Promise<void> {
  if (!native) throw new Error('ShareIntent is only available on Android');
  await native.shareImage(options);
}

/** Código do erro quando o app destino não está instalado. */
export const APP_NOT_INSTALLED = 'ERR_APP_NOT_INSTALLED';
