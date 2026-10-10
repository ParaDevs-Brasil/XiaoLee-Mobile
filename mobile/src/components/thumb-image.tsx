import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

/**
 * Quadro de pré-visualização que preenche o tile onde está (o pai dá a forma e
 * o fundo escuro). Sem URL não desenha nada: o tile segue como antes, com o
 * glifo por cima.
 *
 * A URL do backend é pré-assinada e muda a cada resposta (expira em 1 h), então
 * o cache do disco é chaveado por `cacheKey` estável — sem isso a imagem seria
 * baixada de novo a cada recarga da lista e piscaria.
 */
export function ThumbImage({ uri, cacheKey }: { uri: string | null; cacheKey: string }) {
  if (!uri) return null;
  return (
    <Image
      source={{ uri, cacheKey }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={180}
      cachePolicy="disk"
      accessible={false}
    />
  );
}
