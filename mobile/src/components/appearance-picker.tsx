import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconMoon, IconPhone, IconSun, type IconProps } from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme, useThemePreference } from '@/hooks/use-theme';
import { THEME_PREFERENCES, type ThemePreference } from '@/lib/theme-preference';

/**
 * Seletor de tema do painel de perfil (XIAOLEEACE-13): Light · Dark · System.
 *
 * Três opções lado a lado e não um interruptor: um interruptor só tem dois
 * estados, e "seguir o aparelho" é o terceiro. É o mesmo controle dos
 * editores de código.
 *
 * O painel tem 191 de largura, então cada opção é ícone com legenda curta
 * embaixo. A marcação da opção ativa desliza até a nova — e a troca de tema
 * em si anima a partir do ponto tocado (`ThemeProvider`).
 */

const OPTIONS: Record<ThemePreference, { label: string; Icon: (p: IconProps) => React.ReactElement }> =
  {
    light: { label: 'Light', Icon: IconSun },
    dark: { label: 'Dark', Icon: IconMoon },
    system: { label: 'System', Icon: IconPhone },
  };

const TRACK_PAD = 3;

export function AppearancePicker() {
  const colors = useTheme();
  const styles = useStyles();
  const { preference, setPreference } = useThemePreference();
  const [trackWidth, setTrackWidth] = useState(0);
  const index = THEME_PREFERENCES.indexOf(preference);
  const [slide] = useState(() => new Animated.Value(index));

  useEffect(() => {
    const animation = Animated.spring(slide, {
      toValue: index,
      damping: 18,
      stiffness: 220,
      mass: 0.8,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [index, slide]);

  const segment = trackWidth > 0 ? (trackWidth - TRACK_PAD * 2) / THEME_PREFERENCES.length : 0;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Appearance</Text>
      <View
        style={styles.track}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        accessibilityRole="radiogroup"
        accessibilityLabel="Appearance"
      >
        {segment > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                width: segment,
                transform: [
                  { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, segment] }) },
                ],
              },
            ]}
          />
        ) : null}

        {THEME_PREFERENCES.map((option) => {
          const { label, Icon } = OPTIONS[option];
          const active = option === preference;
          return (
            <Pressable
              key={option}
              // O ponto do toque, em coordenadas de janela, é de onde o tema
              // novo se abre.
              onPress={(e) => setPreference(option, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={option === 'system' ? 'System, follows your phone' : label}
            >
              <Icon size={16} sw={2} color={active ? colors.accent : colors.ink2} />
              <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    gap: Spacing.two - 2,
    paddingTop: Spacing.two + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  title: { fontFamily: Fonts.bold, fontSize: 11, color: colors.ink2 },
  track: {
    flexDirection: 'row',
    padding: TRACK_PAD,
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
  },
  thumb: {
    position: 'absolute',
    top: TRACK_PAD,
    bottom: TRACK_PAD,
    left: TRACK_PAD,
    borderRadius: Radius.sm + 1,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.two - 2,
  },
  label: { fontFamily: Fonts.bold, fontSize: 11, color: colors.ink2 },
  labelActive: { color: colors.accent },
  pressed: { opacity: 0.6 },
}));
