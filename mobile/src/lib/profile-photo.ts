import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

/**
 * Foto de perfil escolhida pelo usuário, guardada no aparelho.
 *
 * O backend ainda não tem campo de avatar, e quem entra por Google ou e-mail
 * não traz foto no Privy — sem isto o card de compartilhar sairia sempre com
 * as iniciais. A foto fica em `Paths.document` (sobrevive a reinício, sai na
 * desinstalação), uma por carteira, para um segundo login no mesmo aparelho
 * não herdar a foto de outra pessoa.
 *
 * O nome leva um timestamp: o `Image` do RN guarda cache por URI, então
 * sobrescrever o mesmo arquivo deixaria a foto antiga na tela.
 */

function prefix(address: string): string {
  return `profile-photo-${address.toLowerCase()}-`;
}

function savedFiles(address: string): File[] {
  const dir = new Directory(Paths.document);
  if (!dir.exists) return [];
  return dir
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.startsWith(prefix(address)));
}

/** URI da foto salva para esta carteira, ou `null`. */
export function savedProfilePhoto(address: string | undefined): string | null {
  if (!address) return null;
  const [latest] = savedFiles(address).sort((a, b) => b.name.localeCompare(a.name));
  return latest?.uri ?? null;
}

/**
 * Abre a galeria com corte quadrado e guarda a escolha. Devolve a URI nova,
 * ou `null` se o usuário cancelou.
 *
 * No Android 13+ isto usa o Photo Picker do sistema, que não pede permissão
 * de armazenamento.
 */
export async function pickProfilePhoto(address: string): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.85,
  });
  if (result.canceled || !result.assets[0]) return null;

  const previous = savedFiles(address);
  const dest = new File(Paths.document, `${prefix(address)}${Date.now()}.jpg`);
  await new File(result.assets[0].uri).copy(dest);
  for (const file of previous) file.delete();
  return dest.uri;
}
