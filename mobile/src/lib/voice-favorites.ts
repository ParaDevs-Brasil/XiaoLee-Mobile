import AsyncStorage from '@react-native-async-storage/async-storage';

/** Vozes favoritas, guardadas no aparelho (ids do catálogo). Um id que saiu do catálogo simplesmente não aparece. */
const KEY = 'xiaolee_voice_favorites';

export async function loadVoiceFavorites(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveVoiceFavorites(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // sem armazenamento: o favorito vale só até fechar a folha
  }
}

/** Liga/desliga um id, sem repetir. */
export function toggleFavorite(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
