import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { Line, Path, Polygon, Polyline, Svg } from 'react-native-svg';

import { IconCheck } from '@/components/icons';
import { PressableScale, useBadgePop, useToggleProgress } from '@/components/touch-motion';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { makeStyles, useTheme } from '@/hooks/use-theme';

/**
 * O que a persona vai fazer no vídeo — três formatos lado a lado, como o seletor de formato dos estúdios de
 * vídeo. Talk: fala o roteiro com a voz escolhida. Mimic: repete o movimento de um vídeo de referência.
 */

export type CreatorFormat = 'speech' | 'mimic' | 'swap';

const FORMATS: { id: CreatorFormat; title: string; text: string }[] = [
  { id: 'speech', title: 'Talk', text: 'Says what you write' },
  { id: 'mimic', title: 'Mimic', text: 'Copies the moves, in your photo’s scene' },
  { id: 'swap', title: 'Replace', text: 'Your video, with your character in it' },
];

const ICON = 20;
const SW = 2.2;
/** Lado do viewBox dos ícones (24) em relação ao tamanho desenhado. */
const K = ICON / 24;
const PLAY_MS = 560;

/**
 * Micro-animação de cada ícone, disparada quando o formato é escolhido. `t` vai de 0 a 1 uma vez: no Replace as duas
 * setas saem pelas pontas e voltam pelo lado oposto; no Talk os três pontos do balão saltam em onda; no Mimic o play
 * dá um tranco para a frente e assenta. As mesmas animações movem as duas cópias do ícone (a de destaque e a clara).
 */
function FormatIcon({ id, color, t }: { id: CreatorFormat; color: string; t: Animated.Value }) {
  if (id === 'swap') {
    // Cada seta mora num quadrado que corta o que passa da borda: sai de um lado e reentra pelo outro.
    const out = (dir: 1 | -1) => ({
      opacity: t.interpolate({ inputRange: [0, 0.4, 0.41, 0.6, 1], outputRange: [1, 0, 0, 1, 1] }),
      transform: [
        {
          translateX: t.interpolate({
            inputRange: [0, 0.4, 0.41, 1],
            outputRange: [0, dir * ICON * 0.7, dir * -ICON * 0.7, 0],
          }),
        },
      ],
    });
    return (
      <View style={styles2.box}>
        <Animated.View style={[styles2.fill, out(1)]}>
          <Svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
            <Line x1="4" y1="8" x2="20" y2="8" />
            <Polyline points="16 4 20 8 16 12" />
          </Svg>
        </Animated.View>
        <Animated.View style={[styles2.fill, out(-1)]}>
          <Svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
            <Line x1="20" y1="16" x2="4" y2="16" />
            <Polyline points="8 12 4 16 8 20" />
          </Svg>
        </Animated.View>
      </View>
    );
  }

  if (id === 'speech') {
    return (
      <View style={styles2.box}>
        <Svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M21 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </Svg>
        {[8.5, 12, 15.5].map((x, i) => (
          <Animated.View
            key={x}
            style={[
              styles2.dot,
              {
                left: x * K - 1.7,
                top: 10.5 * K - 1.7,
                backgroundColor: color,
                transform: [
                  {
                    // Cada ponto salta num trecho próprio do 0→1, escalonado, e assenta de volta.
                    translateY: t.interpolate({
                      inputRange: [0, 0.15 + i * 0.15, 0.3 + i * 0.15, 0.55 + i * 0.15, 1],
                      outputRange: [0, 0, -4, 0, 0],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              },
            ]}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles2.box}>
      <Animated.View
        style={[
          styles2.fill,
          {
            transform: [
              { translateX: t.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 5, 0] }) },
              { scale: t.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 1.12, 1] }) },
            ],
          },
        ]}
      >
        <Svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
          <Polygon points="6 4 20 12 6 20 6 4" />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** Estilos fixos do ícone (não dependem de tema). */
const styles2 = {
  box: { width: ICON, height: ICON, overflow: 'hidden' as const },
  fill: { position: 'absolute' as const, top: 0, left: 0, width: ICON, height: ICON },
  dot: { position: 'absolute' as const, width: 3.4, height: 3.4, borderRadius: 1.7 },
};

export function CreatorFormatPicker({ value, onChange }: { value: CreatorFormat; onChange: (f: CreatorFormat) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {FORMATS.map((format) => (
        <FormatCard key={format.id} format={format} on={format.id === value} onPress={() => onChange(format.id)} />
      ))}
    </View>
  );
}

/**
 * A seleção é uma camada "ligada" (fundo e borda de destaque) empilhada sobre o card, e só a opacidade dela
 * anima: a troca de formato vira um fundido suave no driver nativo, e o selo de check estoura com mola.
 */
function FormatCard({ format, on, onPress }: { format: (typeof FORMATS)[number]; on: boolean; onPress: () => void }) {
  const { id, title, text } = format;
  const colors = useTheme();
  const styles = useStyles();
  const reduce = useReduceMotion();
  const fade = useToggleProgress(on);
  const pop = useBadgePop(on);
  const [t] = useState(() => new Animated.Value(1));
  const wasOn = useRef(on);

  const play = () => {
    if (reduce) return;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: PLAY_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start();
  };

  // Escolher o formato dispara o ícone; montar já selecionado não.
  useEffect(() => {
    if (on && !wasOn.current) play();
    wasOn.current = on;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  return (
    <PressableScale
      onPress={() => {
        // Tocar de novo no formato já escolhido repete o gesto: o ícone é também um botão com resposta.
        if (on) play();
        onPress();
      }}
      scaleTo={0.96}
      style={styles.card}
      accessibilityRole="tab"
      accessibilityLabel={title}
      accessibilityState={{ selected: on }}
    >
      <Animated.View pointerEvents="none" style={[styles.cardOnLayer, { opacity: fade }]} />
      <Animated.View pointerEvents="none" style={[styles.badge, pop]}>
        <IconCheck size={12} sw={3} color={colors.onAccent} />
      </Animated.View>
      <View style={styles.mark}>
        <FormatIcon id={id} color={colors.accent} t={t} />
        <Animated.View pointerEvents="none" style={[styles.markOnLayer, { opacity: fade }]}>
          <FormatIcon id={id} color={colors.onAccent} t={t} />
        </Animated.View>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.text}>{text}</Text>
    </PressableScale>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: 'row', gap: Spacing.two },
  card: {
    flex: 1,
    gap: Spacing.one,
    padding: Spacing.three - 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  // -1 cobre a borda do card: posição absoluta começa por dentro dela.
  cardOnLayer: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  mark: {
    width: 40,
    height: 40,
    marginBottom: Spacing.one,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  markOnLayer: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentFill,
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentFill,
  },
  title: { fontFamily: Fonts.bold, fontSize: 16, color: colors.ink },
  text: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: colors.ink2 },
}));
