import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CreatorReportSuggestion } from '@/api/backend';
import { IconCheck, IconChevronDown, IconSpark } from '@/components/icons';
import { Pop, useReveal } from '@/components/motion';
import { CardShadow, Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { doneSummary } from '@/lib/report-ideas';

/**
 * Cartão de uma ideia da IA no relatório de 30 dias.
 *
 * Fechado: o número, o título e o passo concreto. Aberto: o "porquê" (o número
 * ou vídeo em que a IA se baseou) e o botão de marcar como feita. O que se mexe
 * conta o que está acontecendo:
 *  - o cartão afunda um pouco sob o dedo (mola) e a barra lateral cresce ao abrir;
 *  - o corpo abre pela altura medida, e o chevron gira junto;
 *  - ao marcar como feita, o número vira um ✓ verde com um "pop".
 *
 * Duas famílias de valor, em views diferentes (misturar drivers na mesma view
 * quebra): a abertura anima a altura e por isso roda no JS; o resto (escala,
 * entrada, ✓) roda no driver nativo.
 */

interface ReportIdeaCardProps {
  /** Posição da ideia, de 1 em diante — o número do selo. */
  index: number;
  suggestion: CreatorReportSuggestion;
  done: boolean;
  onToggleDone: () => void;
  /** Posição na cascata de entrada da tela. */
  revealIndex: number;
}

export function ReportIdeaCard({
  index,
  suggestion,
  done,
  onToggleDone,
  revealIndex,
}: ReportIdeaCardProps) {
  const reduce = useReduceMotion();
  const reveal = useReveal(revealIndex);
  const [open, setOpen] = useState(false);
  const [expand] = useState(() => new Animated.Value(0));
  const [press] = useState(() => new Animated.Value(1));
  const [doneAnim] = useState(() => new Animated.Value(done ? 1 : 0));
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    if (reduce) {
      doneAnim.setValue(done ? 1 : 0);
      return;
    }
    // Mola com sobressalto: o ✓ passa de 1 e volta, que é o "pop".
    const spring = Animated.spring(doneAnim, {
      toValue: done ? 1 : 0,
      damping: 9,
      stiffness: 220,
      mass: 0.8,
      useNativeDriver: true,
    });
    spring.start();
    return () => spring.stop();
  }, [done, reduce, doneAnim]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (reduce) {
      expand.setValue(next ? 1 : 0);
      return;
    }
    Animated.timing(expand, {
      toValue: next ? 1 : 0,
      duration: next ? 300 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  };

  const pressTo = (to: number) => {
    if (reduce) return;
    Animated.spring(press, {
      toValue: to,
      damping: 14,
      stiffness: 260,
      mass: 0.6,
      useNativeDriver: true,
    }).start();
  };

  const doneOpacity = doneAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const numberOpacity = doneAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  // Sem `clamp`: a mola ultrapassa 1 e o ✓ estoura um pouco antes de assentar.
  const checkScale = doneAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });

  return (
    <Animated.View
      style={[
        styles.card,
        { opacity: reveal.opacity, transform: [...reveal.transform, { scale: press }] },
      ]}
    >
      {/* Barra lateral: aparece crescendo do centro quando o cartão abre. Verde
          se a ideia já foi feita. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.bar,
          {
            backgroundColor: done ? Colors.light.success : Colors.light.accent,
            opacity: expand,
            transform: [{ scaleY: expand }],
          },
        ]}
      />

      <Pressable
        onPress={toggle}
        onPressIn={() => pressTo(0.98)}
        onPressOut={() => pressTo(1)}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Idea ${index}: ${suggestion.title}${done ? ', done' : ''}`}
        accessibilityHint={open ? 'Hides why this idea' : 'Shows why this idea'}
      >
        <View style={styles.badge}>
          <Animated.View style={[styles.badgeDone, { opacity: doneOpacity }]} />
          <Animated.Text style={[styles.badgeNumber, { opacity: numberOpacity }]}>
            {index}
          </Animated.Text>
          <Animated.View
            style={[
              styles.badgeCheck,
              { opacity: doneOpacity, transform: [{ scale: checkScale }] },
            ]}
          >
            <IconCheck size={18} sw={2.8} color={Colors.light.card} />
          </Animated.View>
        </View>

        <View style={styles.flex}>
          <Text style={styles.title}>{suggestion.title}</Text>
          <Text style={[styles.action, done && styles.actionDone]}>{suggestion.action}</Text>
        </View>

        <Animated.View
          style={{
            transform: [
              {
                rotate: expand.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }),
              },
            ],
          }}
        >
          <IconChevronDown size={16} color={Colors.light.ink3} />
        </Animated.View>
      </Pressable>

      {/* O corpo é medido num filho absoluto (que mantém a altura natural mesmo
          com o pai em 0) e o pai anima de 0 até essa altura. */}
      <Animated.View
        style={[
          styles.bodyClip,
          { height: expand.interpolate({ inputRange: [0, 1], outputRange: [0, contentHeight] }) },
        ]}
        pointerEvents={open ? 'auto' : 'none'}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      >
        <View
          style={styles.body}
          onLayout={(event) => {
            const height = Math.ceil(event.nativeEvent.layout.height);
            if (height !== contentHeight) setContentHeight(height);
          }}
        >
          <Animated.View style={[styles.why, { opacity: expand }]}>
            <Text style={styles.whyLabel}>Why this idea</Text>
            <Text style={styles.whyText}>{suggestion.why}</Text>
          </Animated.View>

          <Animated.View style={{ opacity: expand }}>
            <Pressable
              onPress={onToggleDone}
              style={({ pressed }) => [
                styles.doneButton,
                done && styles.doneButtonOn,
                pressed && styles.pressed,
              ]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done }}
              accessibilityLabel="Mark as done"
            >
              <IconCheck
                size={14}
                sw={2.6}
                color={done ? Colors.light.success : Colors.light.accent}
              />
              <Text style={[styles.doneText, done && styles.doneTextOn]}>
                {done ? 'Done' : 'Mark as done'}
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Progresso das ideias: um segmento por ideia que enche de verde ao marcar, e
 * o texto ao lado. Com todas feitas, o texto vira reconhecimento.
 */
export function IdeasProgress({ done, total }: { done: number; total: number }) {
  if (total <= 0) return null;
  const complete = done >= total;

  return (
    <View
      style={styles.progress}
      accessible
      accessibilityLabel={doneSummary(done, total)}
      accessibilityRole="progressbar"
    >
      <View style={styles.segments}>
        {Array.from({ length: total }, (_, i) => (
          <Segment key={i} filled={i < done} order={i} />
        ))}
      </View>
      {/* A chave remonta o texto quando passa a "tudo feito", e o Pop faz a
          comemoração aparecer em vez de só trocar a frase. */}
      <Pop key={complete ? 'all' : 'some'} style={styles.progressLabelWrap}>
        {complete ? <IconSpark size={12} color={Colors.light.success} /> : null}
        <Text style={[styles.progressLabel, complete && styles.progressLabelAll]}>
          {doneSummary(done, total)}
        </Text>
      </Pop>
    </View>
  );
}

function Segment({ filled, order }: { filled: boolean; order: number }) {
  const reduce = useReduceMotion();
  const [fill] = useState(() => new Animated.Value(filled ? 1 : 0));

  useEffect(() => {
    if (reduce) {
      fill.setValue(filled ? 1 : 0);
      return;
    }
    const run = Animated.sequence([
      Animated.delay(order * 90),
      Animated.timing(fill, {
        toValue: filled ? 1 : 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    run.start();
    return () => run.stop();
  }, [filled, order, reduce, fill]);

  return (
    <View style={styles.segment}>
      <Animated.View style={[styles.segmentFill, { transform: [{ scaleX: fill }] }]} />
    </View>
  );
}

const BADGE = 36;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  card: {
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
    ...CardShadow,
  },
  bar: {
    position: 'absolute',
    left: 0,
    top: Spacing.three,
    bottom: Spacing.three,
    width: 3,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.three - 2,
  },

  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.accentSoft,
  },
  badgeDone: {
    ...StyleSheet.absoluteFill,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.success,
  },
  badgeNumber: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.light.accent },
  badgeCheck: { position: 'absolute' },

  title: { fontFamily: Fonts.bold, fontSize: 15, color: Colors.light.ink },
  action: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.light.ink2,
    marginTop: 2,
  },
  actionDone: { color: Colors.light.ink3 },

  bodyClip: { overflow: 'hidden' },
  body: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    gap: Spacing.two,
    paddingHorizontal: Spacing.three - 2,
    paddingBottom: Spacing.three - 2,
  },
  why: {
    gap: 2,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    // Rosa suave, o mesmo do selo numerado: o "porquê" lê como parte da ideia.
    backgroundColor: Colors.light.accentSoft,
  },
  whyLabel: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.light.accent,
  },
  whyText: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: Colors.light.ink },

  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.one + 1,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.two - 1,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.light.accent,
  },
  doneButtonOn: { borderColor: Colors.light.success, backgroundColor: Colors.light.successSoft },
  doneText: { fontFamily: Fonts.bold, fontSize: 12, color: Colors.light.accent },
  doneTextOn: { color: Colors.light.success },

  progress: { gap: Spacing.one + 2, marginTop: Spacing.one },
  segments: { flexDirection: 'row', gap: Spacing.one + 2 },
  segment: {
    flex: 1,
    maxWidth: 64,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: Colors.light.border,
  },
  segmentFill: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.light.success,
    transformOrigin: 'left',
  },
  progressLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 1 },
  progressLabel: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.light.ink3 },
  progressLabelAll: { fontFamily: Fonts.bold, color: Colors.light.success },
});
