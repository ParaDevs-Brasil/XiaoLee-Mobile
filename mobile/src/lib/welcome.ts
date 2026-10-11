import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Já viu a boas-vindas do 1º clique no chat (XIAOLEEACE-19)? Ela aparece uma
 * vez por conta e nunca mais — sessões seguintes abrem o chat de sempre.
 *
 * Escopado por conta (`session.twitterUserId`, hoje o endereço da carteira),
 * mesmo acordo de `lib/chat-history.ts`: outra conta no mesmo aparelho também
 * merece ser apresentada à Xiaolee. Armazenamento igual ao de `lib/intro.ts`:
 * SecureStore no nativo, localStorage no web.
 */
const BASE_KEY = 'xiaolee_seen_welcome';

const isWeb = Platform.OS === 'web';

/** SecureStore só aceita `[A-Za-z0-9._-]` na chave. */
function storageKey(accountId: string): string {
  return `${BASE_KEY}_${accountId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export async function hasSeenWelcome(accountId: string): Promise<boolean> {
  const key = storageKey(accountId);
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(key) === '1';
    } catch {
      return false;
    }
  }
  try {
    return (await SecureStore.getItemAsync(key)) === '1';
  } catch {
    // Storage ilegível — melhor não repetir a boas-vindas do que travar o chat.
    return true;
  }
}

export async function markWelcomeSeen(accountId: string): Promise<void> {
  const key = storageKey(accountId);
  if (isWeb) {
    try {
      globalThis.localStorage?.setItem(key, '1');
    } catch {
      // storage indisponível (modo privado) — a próxima abertura mostra de novo
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(key, '1');
  } catch {
    // idem — perder a gravação só faz a boas-vindas reaparecer uma vez
  }
}
