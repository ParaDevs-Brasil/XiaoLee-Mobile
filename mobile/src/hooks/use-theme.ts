/**
 * Tema ativo para os componentes.
 *
 * Os estilos do app viviam em `StyleSheet.create` no escopo do módulo, lendo
 * `Colors.light.*` — calculados uma vez no import, então trocar a paleta com
 * o app aberto não mudava nada na tela. Agora:
 *
 * - `useTheme()` devolve as cores do tema ativo, para usar no JSX
 *   (`color={colors.accent}`);
 * - `makeStyles((colors) => ({...}))` troca o `StyleSheet.create` do módulo e
 *   devolve um hook `useStyles()`. As duas folhas (clara e escura) são
 *   criadas no import, no mesmo lugar em que a antiga era — o hook só escolhe
 *   qual devolver.
 *
 * Os dois re-renderizam o componente quando o tema muda, porque leem o
 * contexto de `ThemeProvider` (`lib/theme.tsx`).
 */

import { createContext, useContext } from 'react';
import { StyleSheet } from 'react-native';

import { Colors, type ColorScheme, type ThemeColors } from '@/constants/theme';
import type { ThemePreference } from '@/lib/theme-preference';

/** Ponto de origem da animação de troca, em coordenadas de janela. */
export interface ThemeTransitionOrigin {
  x: number;
  y: number;
}

export interface ThemeContextValue {
  /** Tema que está sendo desenhado agora. */
  scheme: ColorScheme;
  preference: ThemePreference;
  /** `false` até ler a preferência salva — o Stack espera por isto. */
  ready: boolean;
  setPreference: (preference: ThemePreference, origin?: ThemeTransitionOrigin) => void;
}

/**
 * Sem provider (testes, telas montadas fora da raiz) o app fica no claro e o
 * seletor não faz nada — mesmo comportamento de antes desta feature.
 */
export const ThemeContext = createContext<ThemeContextValue>({
  scheme: 'light',
  preference: 'system',
  ready: true,
  setPreference: () => {},
});

export function useColorSchemeName(): ColorScheme {
  return useContext(ThemeContext).scheme;
}

/** Preferência e setter, para o seletor de tema. */
export function useThemePreference() {
  return useContext(ThemeContext);
}

export function useTheme(): ThemeColors {
  return Colors[useColorSchemeName()];
}

export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  const sheets: Record<ColorScheme, T> = {
    light: StyleSheet.create(factory(Colors.light)),
    dark: StyleSheet.create(factory(Colors.dark)),
  };
  return function useStyles() {
    return sheets[useColorSchemeName()];
  };
}
