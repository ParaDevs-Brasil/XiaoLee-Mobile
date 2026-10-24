import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Line, Polyline, Svg } from 'react-native-svg';

import { IconClose } from '@/components/icons';
import { PressableScale } from '@/components/touch-motion';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { makeStyles, useTheme } from '@/hooks/use-theme';

/**
 * A foto inteira, sem corte: a prévia dos cartões recorta (`cover`) para caber na moldura, e quem escolhe um
 * personagem precisa ver como a imagem realmente ficou. Toque em qualquer ponto ou no × para voltar.
 *
 * Monte só enquanto aberto (`{uri ? <PhotoViewer .../> : null}`): a entrada anima a cada abertura.
 */
export function PhotoViewer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: 320,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [reduce, progress]);

  function dismiss() {
    if (reduce) {
      onClose();
      return;
    }
    Animated.timing(progress, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(
      () => onClose(),
    );
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <Animated.View style={[styles.scrim, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close photo" accessibilityRole="button" />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.stage,
            {
              paddingTop: insets.top + 56,
              paddingBottom: insets.bottom + 24,
              transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
            },
          ]}
        >
          <Image source={{ uri }} style={styles.image} contentFit="contain" transition={160} />
        </Animated.View>
        <PressableScale
          onPress={dismiss}
          scaleTo={0.88}
          style={[styles.close, { top: insets.top + 12 }]}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
        >
          <IconClose size={20} sw={2.2} color={colors.ink} />
        </PressableScale>
      </Animated.View>
    </Modal>
  );
}

/** Botão redondo de "ver inteira" para pôr no canto de uma foto recortada. */
export function ExpandButton({ onPress, label = 'View full photo' }: { onPress: () => void; label?: string }) {
  const colors = useTheme();
  const styles = useStyles();
  return (
    <PressableScale onPress={onPress} scaleTo={0.88} hitSlop={8} style={styles.expand} accessibilityRole="button" accessibilityLabel={label}>
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <Polyline points="15 3 21 3 21 9" />
        <Polyline points="9 21 3 21 3 15" />
        <Line x1="21" y1="3" x2="14" y2="10" />
        <Line x1="3" y1="21" x2="10" y2="14" />
      </Svg>
    </PressableScale>
  );
}

const useStyles = makeStyles((colors) => ({
  scrim: { flex: 1, backgroundColor: 'rgba(12, 10, 9, 0.94)' },
  stage: { flex: 1, paddingHorizontal: 16 },
  image: { flex: 1, width: '100%' },
  close: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expand: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
