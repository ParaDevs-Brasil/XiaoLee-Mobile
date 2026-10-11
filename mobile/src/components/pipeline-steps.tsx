import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { IconCheck } from '@/components/icons';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

/**
 * O caminho de um vídeo até virar corte, em quatro passos. Esperar minutos por
 * uma transcrição é bem mais tolerável quando se vê onde se está e o que vem
 * depois — e o mesmo desenho serve ao upload e à tela do vídeo.
 */
export const PIPELINE_STEPS = ['Upload', 'Transcribe', 'Pick moments', 'Cut & caption'] as const;

const DOT = 28;

/** `current` é o índice do passo em andamento; os anteriores estão feitos, os seguintes por vir. */
export function PipelineSteps({ current }: { current: number }) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Step ${current + 1} of ${PIPELINE_STEPS.length}: ${PIPELINE_STEPS[current]}`}
    >
      {PIPELINE_STEPS.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        return (
          <View key={label} style={styles.step}>
            <View style={styles.dotRow}>
              <View style={[styles.line, i > 0 && i <= current && styles.lineDone, i === 0 && styles.lineHidden]} />
              <Dot state={state} />
              <View
                style={[
                  styles.line,
                  i < current && styles.lineDone,
                  i === PIPELINE_STEPS.length - 1 && styles.lineHidden,
                ]}
              />
            </View>
            <Text style={[styles.label, state === 'active' && styles.labelActive]}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Dot({ state }: { state: 'done' | 'active' | 'todo' }) {
  if (state === 'done') {
    return (
      <View style={[styles.dot, styles.dotDone]}>
        <IconCheck size={14} sw={3} color={Colors.light.card} />
      </View>
    );
  }
  if (state === 'active') return <ActiveDot />;
  // Mesma caixa do ativo e do feito: sem isso a linha dos círculos teria alturas diferentes e os rótulos desalinhariam.
  return (
    <View style={styles.dot}>
      <View style={styles.dotTodo} />
    </View>
  );
}

/** O passo em andamento "respira": um anel que se expande e some, sem tirar o foco do resto da tela. */
function ActiveDot() {
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.dot}>
      <Animated.View
        style={[
          styles.ring,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
          },
        ]}
      />
      <View style={styles.activeCore}>
        <View style={styles.activePip} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  step: { flex: 1, alignItems: 'center', gap: Spacing.two - 2 },
  dotRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  line: { flex: 1, height: 2, backgroundColor: Colors.light.border },
  lineDone: { backgroundColor: Colors.light.accent },
  lineHidden: { backgroundColor: 'transparent' },
  dot: { width: DOT, height: DOT, alignItems: 'center', justifyContent: 'center' },
  dotDone: { borderRadius: Radius.pill, backgroundColor: Colors.light.accent },
  dotTodo: {
    width: DOT - 10,
    height: DOT - 10,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.card,
  },
  ring: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accent,
  },
  activeCore: {
    width: DOT,
    height: DOT,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.accentSoft,
    borderWidth: 2,
    borderColor: Colors.light.accent,
  },
  activePip: { width: 10, height: 10, borderRadius: Radius.pill, backgroundColor: Colors.light.accent },
  label: { fontFamily: Fonts.semibold, fontSize: 11, lineHeight: 14, color: Colors.light.ink2, textAlign: 'center' },
  labelActive: { fontFamily: Fonts.bold, color: Colors.light.ink },
});
