import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { DropdownPanel } from '@/components/dropdown-panel';
import {
  IconBarChart,
  IconClipboard,
  IconDollar,
  IconRocket,
  IconBag,
  IconScissors,
  IconShare,
  IconUser,
} from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';

/**
 * Menu de navegação — frame "Xiaolee - menu" (grupo `Group 9`, 191x264).
 *
 * Título maior (16 w700) e sem descrição — é a diferença visual em relação
 * ao painel de perfil. O Figma tem três destinos; Clips e Reports vêm depois,
 * ainda fora do frame.
 *
 * A linha inteira é o alvo do toque, como no `PanelRow` do perfil: antes só o
 * texto respondia, e tocar no ícone ou ao lado do nome não fazia nada.
 */

interface NavMenuProps {
  visible: boolean;
  onDismiss: () => void;
}

export function NavMenu({ visible, onDismiss }: NavMenuProps) {
  const colors = useTheme();
  const styles = useStyles();
  const router = useRouter();

  const items = [
    { key: 'dashboard', Icon: IconBarChart, label: 'Dashboard', href: '/dashboard' as const },
    { key: 'traction', Icon: IconDollar, label: 'Traction', href: '/traction' as const },
    { key: 'campaigns', Icon: IconRocket, label: 'Campaigns', href: '/campaigns' as const },
    { key: 'marketplace', Icon: IconBag, label: 'Marketplace', href: '/marketplace' as const },
    { key: 'creators', Icon: IconUser, label: 'AI Creators', href: '/creators' as const },
    { key: 'clips', Icon: IconScissors, label: 'Clips', href: '/clips' as const },
    { key: 'reports', Icon: IconClipboard, label: 'Reports', href: '/reports' as const },
    { key: 'accounts', Icon: IconShare, label: 'Accounts', href: '/accounts' as const },
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
            <Icon size={20} color={colors.accent} />
          </View>
          <Text style={styles.label}>{label}</Text>
        </Pressable>
      ))}
    </DropdownPanel>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, paddingVertical: 2 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  label: { flex: 1, fontFamily: Fonts.bold, fontSize: 16, color: colors.ink },
  pressed: { opacity: 0.6 },
}));
