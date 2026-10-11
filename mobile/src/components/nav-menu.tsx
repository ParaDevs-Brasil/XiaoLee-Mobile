import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DropdownPanel } from '@/components/dropdown-panel';
import { IconBarChart, IconDollar, IconRocket, IconScissors } from '@/components/icons';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

/**
 * Menu de navegação — frame "Xiaolee - menu" (grupo `Group 9`, 191x264).
 *
 * Título maior (16 w700) e sem descrição — é a diferença visual em relação
 * ao painel de perfil. O Figma tem três destinos; Clips é o quarto, ainda
 * fora do frame.
 *
 * A linha inteira é o alvo do toque, como no `PanelRow` do perfil: antes só o
 * texto respondia, e tocar no ícone ou ao lado do nome não fazia nada.
 */

interface NavMenuProps {
  visible: boolean;
  onDismiss: () => void;
}

export function NavMenu({ visible, onDismiss }: NavMenuProps) {
  const router = useRouter();

  const items = [
    { key: 'dashboard', Icon: IconBarChart, label: 'Dashboard', href: '/dashboard' as const },
    { key: 'traction', Icon: IconDollar, label: 'Traction', href: '/traction' as const },
    { key: 'campaigns', Icon: IconRocket, label: 'Campaigns', href: '/campaigns' as const },
    { key: 'clips', Icon: IconScissors, label: 'Clips', href: '/clips' as const },
  ];

  return (
    <DropdownPanel visible={visible} onDismiss={onDismiss}>
      {items.map(({ key, Icon, label, href }) => (
        <Pressable
          key={key}
          onPress={() => {
            onDismiss();
            router.push(href);
          }}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <View style={styles.icon}>
            <Icon size={20} color={Colors.light.accent} />
          </View>
          <Text style={styles.label}>{label}</Text>
        </Pressable>
      ))}
    </DropdownPanel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, paddingVertical: 2 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.accentSoft,
  },
  label: { flex: 1, fontFamily: Fonts.bold, fontSize: 16, color: Colors.light.ink },
  pressed: { opacity: 0.6 },
});
