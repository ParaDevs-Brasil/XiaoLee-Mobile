import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';

/**
 * Beat de transição entre o fim do vídeo de intro e o chat — mesma cara do
 * splash nativo (`app.json`: fundo `#D81B78`, `splash-icon.png`), pra não ter
 * salto visual entre os dois. Some sozinho depois de um tempo fixo; não
 * depende de nenhum carregamento real (sessão/wallet já hidratam em paralelo
 * à intro, ver `_layout.tsx`).
 */
const HOLD_MS = 1000;

interface LoadingScreenProps {
  onFinish: () => void;
}

export function LoadingScreen({ onFinish }: LoadingScreenProps) {
  useEffect(() => {
    const timer = setTimeout(onFinish, HOLD_MS);
    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/images/splash-icon.png')}
        style={styles.image}
        contentFit="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    backgroundColor: Colors.light.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: 160, height: 160 },
});
