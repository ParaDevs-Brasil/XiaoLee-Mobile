import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useWalletMockMode } from '@/hooks/use-creator-wallet';
import { WALLET_MOCK_MODES, type WalletMockMode } from '@/lib/creator-wallet-mock';

const LABEL: Record<WalletMockMode, string> = {
  off: 'Live',
  funded: 'Funded',
  empty: 'Empty',
  loading: 'Loading',
  error: 'Network error',
  mismatch: 'Wrong network',
};

/**
 * Seletor dos estados da carteira — só em `__DEV__`, para o time revisar
 * carregando / vazio / com saldo / erro / rede errada sem gerar outro build
 * nem mexer na chain. Em build de produção não renderiza nada.
 */
export function WalletMockSwitcher() {
  const mode = useWalletMockMode((state) => state.mode);
  const setMode = useWalletMockMode((state) => state.setMode);

  if (!__DEV__) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Preview state · dev only</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {WALLET_MOCK_MODES.map((item) => {
          const active = item === mode;
          return (
            <Pressable
              key={item}
              onPress={() => setMode(item)}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{LABEL[item]}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two - 2,
    padding: Spacing.two + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.light.border,
  },
  label: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.light.ink3,
  },
  row: { gap: Spacing.two - 2 },
  chip: {
    paddingHorizontal: Spacing.three - 4,
    height: 30,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  chipActive: { backgroundColor: Colors.light.ink, borderColor: Colors.light.ink },
  chipText: { fontFamily: Fonts.bold, fontSize: 12, color: Colors.light.ink2 },
  chipTextActive: { color: Colors.light.bg },
});
