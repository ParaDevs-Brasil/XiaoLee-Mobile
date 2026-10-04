import { useEffect, useState } from 'react';
import { Animated, StyleSheet, type ViewStyle } from 'react-native';

const DEFAULT_FADE_MS = 400;

interface FadeOutOverlayProps {
  /** Parent flips this to `true` to start the dissolve — stays mounted until it finishes. */
  fadeOut: boolean;
  /** Fired once opacity hits 0 — safe for the parent to actually unmount now. */
  onFadedOut: () => void;
  zIndex: number;
  /** Ex.: loading → chat pede um dissolve mais longo que vídeo → loading. */
  durationMs?: number;
  children: React.ReactNode;
}

/**
 * Faz a camada se dissolver (opacity 1 → 0) em vez de sumir de uma vez —
 * usado para os cortes secos entre vídeo de intro → loading → chat. A
 * camada de baixo (a próxima) já está montada e visível o tempo todo; só
 * esta aqui anima, revelando-a por baixo aos poucos.
 */
export function FadeOutOverlay({
  fadeOut,
  onFadedOut,
  zIndex,
  durationMs = DEFAULT_FADE_MS,
  children,
}: FadeOutOverlayProps) {
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!fadeOut) return;
    Animated.timing(opacity, {
      toValue: 0,
      duration: durationMs,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onFadedOut();
    });
  }, [fadeOut, onFadedOut, opacity, durationMs]);

  const style: ViewStyle = { ...StyleSheet.absoluteFill, zIndex };

  return (
    <Animated.View pointerEvents={fadeOut ? 'none' : 'auto'} style={[style, { opacity }]}>
      {children}
    </Animated.View>
  );
}
