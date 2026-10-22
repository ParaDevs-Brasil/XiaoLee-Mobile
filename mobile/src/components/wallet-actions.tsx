import { useState, type ComponentType } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconArrowDownLeft, IconList, IconPlus, IconUpload } from '@/components/icons';
import { useReveal } from '@/components/motion';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';

/**
 * Fileira de ações da carteira — Add money, Withdraw, Receive, Activity. Ícone em quadrado arredondado com o
 * rótulo embaixo (padrão de app de carteira), entrando em cascata e afundando um pouco ao toque.
 * Ação indisponível fica apagada e sem toque, no mesmo lugar: a fileira nunca muda de forma.
 */

type Icon = ComponentType<{ size?: number; color?: string; sw?: number }>;

export interface WalletActionsProps {
  canAdd: boolean;
  canWithdraw: boolean;
  onAdd: () => void;
  onWithdraw: () => void;
  onReceive: () => void;
  onActivity: () => void;
}

export function WalletActions({ canAdd, canWithdraw, onAdd, onWithdraw, onReceive, onActivity }: WalletActionsProps) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Action index={0} label="Add money" Icon={IconPlus} primary enabled={canAdd} onPress={onAdd} />
      <Action index={1} label="Withdraw" Icon={IconUpload} enabled={canWithdraw} onPress={onWithdraw} />
      <Action index={2} label="Receive" Icon={IconArrowDownLeft} enabled onPress={onReceive} />
      <Action index={3} label="Activity" Icon={IconList} enabled onPress={onActivity} />
    </View>
  );
}

function Action({
  index,
  label,
  Icon,
  enabled,
  primary = false,
  onPress,
}: {
  index: number;
  label: string;
  Icon: Icon;
  enabled: boolean;
  primary?: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const reveal = useReveal(index, { rise: 12, delay: 120 });
  const [scale] = useState(() => new Animated.Value(1));
  const press = (to: number) =>
    Animated.spring(scale, { toValue: to, damping: 14, stiffness: 260, mass: 0.6, useNativeDriver: true }).start();

  return (
    <Animated.View style={[styles.cell, reveal]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => press(0.92)}
        onPressOut={() => press(1)}
        disabled={!enabled}
        style={[styles.press, !enabled && styles.off]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !enabled }}
      >
        <Animated.View style={[styles.tile, primary && styles.tilePrimary, { transform: [{ scale }] }]}>
          <Icon size={22} sw={2.2} color={primary ? colors.onAccent : colors.accent} />
        </Animated.View>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: 'row', gap: Spacing.two },
  cell: { flex: 1 },
  press: { alignItems: 'center', gap: Spacing.two - 2 },
  off: { opacity: 0.4 },
  tile: {
    width: 58,
    height: 58,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tilePrimary: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  label: { fontFamily: Fonts.bold, fontSize: 12, color: colors.ink2 },
}));
