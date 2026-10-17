import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import { type ReactNode, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemeTransition, type ThemeTransitionPhase } from '@/components/theme-transition';
import { Colors } from '@/constants/theme';
// A versão `.web` espera a hidratação antes de ler o tema (saída estática).
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ThemeContext, type ThemeTransitionOrigin } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { parsePreference, resolveScheme, type ThemePreference } from '@/lib/theme-preference';

/**
 * Tema do app: preferência salva + tema do aparelho → tema desenhado.
 *
 * Fica na raiz, por fora do Stack, porque a animação de troca cobre a tela
 * inteira enquanto o tema muda por baixo — ver
 * `components/theme-transition.tsx`.
 *
 * Além das cores do app, o tema escolhido vai para a cor de fundo da janela
 * (`expo-system-ui`), que aparece na transição entre telas e atrás do
 * teclado — sem isso pisca o fundo do outro tema.
 *
 * Não chama `Appearance.setColorScheme`: com ele forçando claro/escuro, o
 * `useColorScheme` passa a devolver o tema forçado no lugar do aparelho, e ao
 * voltar para "System" o app não sabe mais o tema real do celular. O custo é
 * que teclado e alertas nativos seguem o aparelho, não o app.
 */

interface PendingTransition {
  origin: ThemeTransitionOrigin;
  next: ThemePreference;
  phase: ThemeTransitionPhase;
}

/** Não é dado sensível: AsyncStorage, como o histórico de chat, não SecureStore. */
const STORAGE_KEY = 'xiaolee_theme_preference';

async function loadThemePreference(): Promise<ThemePreference> {
  try {
    return parsePreference(await AsyncStorage.getItem(STORAGE_KEY));
  } catch {
    // storage indisponível — segue o aparelho, que é o padrão
    return 'system';
  }
}

async function saveThemePreference(preference: ThemePreference): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // sem storage a escolha vale só até fechar o app
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const reduceMotion = useReduceMotion();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [ready, setReady] = useState(false);
  const [transition, setTransition] = useState<PendingTransition | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const scheme = resolveScheme(preference, system);
  const colors = Colors[scheme];

  useEffect(() => {
    let cancelled = false;
    loadThemePreference().then((saved) => {
      if (cancelled) return;
      setPreferenceState(saved);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {
      // só cosmético — sem módulo nativo (Expo Go antigo) segue sem
    });
  }, [colors.bg]);

  function commit(next: ThemePreference) {
    setPreferenceState(next);
    void saveThemePreference(next);
  }

  function setPreference(next: ThemePreference, origin?: ThemeTransitionOrigin) {
    // Toque no meio da animação é ignorado: ela dura menos de um segundo, e
    // encadear duas trocas deixaria o véu de uma por cima da outra.
    if (transition || next === preference) return;

    // Sem mudança visível (ex.: "System" com o aparelho no mesmo tema) ou
    // antes de medir a tela: troca direto, sem animação.
    if (resolveScheme(next, system) === scheme || size.width === 0) {
      commit(next);
      return;
    }

    setTransition({ next, phase: 'expanding', origin: origin ?? { x: size.width / 2, y: 0 } });
  }

  return (
    <ThemeContext.Provider value={{ scheme, preference, ready, setPreference }}>
      <View
        style={[styles.root, { backgroundColor: colors.bg }]}
        onLayout={(e) => setSize(e.nativeEvent.layout)}
      >
        {children}
      </View>
      {transition ? (
        <ThemeTransition
          origin={transition.origin}
          color={Colors[resolveScheme(transition.next, system)].bg}
          phase={transition.phase}
          reduceMotion={reduceMotion}
          width={size.width}
          height={size.height}
          onCovered={() => {
            // Mesmo lote: o commit que troca o tema é o mesmo que passa o véu
            // para `revealing`, então ele só esmaece com o app já trocado.
            commit(transition.next);
            setTransition({ ...transition, phase: 'revealing' });
          }}
          onDone={() => setTransition(null)}
        />
      ) : null}
    </ThemeContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
