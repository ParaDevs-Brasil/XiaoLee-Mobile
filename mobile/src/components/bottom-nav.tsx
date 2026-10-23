import { usePathname, useRouter } from 'expo-router';
import { Image, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconHome, IconTrendingUp, IconVideo, IconWallet, type IconProps } from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useKeyboard } from '@/hooks/use-keyboard';
import { makeStyles, useTheme } from '@/hooks/use-theme';

/**
 * Barra inferior — componente "TabBar" do Figma (XiaoLee v2): quatro abas e, no meio, o avatar da Xiaolee levantado,
 * que é o chat. 84 de altura com a barra de gestos; o avatar (56, anel de 4) sobe 19 acima do topo.
 *
 * Cada aba é uma rota da pilha (`navigate`, não `push`), então trocar de aba não empilha telas. A aba ativa é a que
 * "dona" do caminho atual: Studio cobre Clips, Reports e AI Creators; Grow cobre Campaigns e Marketplace.
 */

type TabKey = 'home' | 'studio' | 'chat' | 'grow' | 'wallet';

const TABS: { key: TabKey; label: string; href: string; owns: string[]; Icon?: (p: IconProps) => React.JSX.Element }[] = [
  { key: 'home', label: 'Home', href: '/home', owns: ['/home'], Icon: IconHome },
  { key: 'studio', label: 'Studio', href: '/studio', owns: ['/studio', '/clips', '/reports', '/creators', '/accounts'], Icon: IconVideo },
  { key: 'chat', label: 'Xiaolee', href: '/', owns: ['/', '/history'] },
  { key: 'grow', label: 'Grow', href: '/grow', owns: ['/grow', '/campaigns', '/marketplace'], Icon: IconTrendingUp },
  { key: 'wallet', label: 'Wallet', href: '/wallet', owns: ['/wallet'], Icon: IconWallet },
];

const owns = (path: string, prefixes: string[]) =>
  prefixes.some((p) => (p === '/' ? path === '/' : path === p || path.startsWith(`${p}/`)));

/** Altura do corpo da barra, sem a área da barra de gestos. */
export const BOTTOM_NAV_BODY = 58;
/** Quanto o avatar do meio sobe acima do topo da barra. */
const RAISE = 19;

export function BottomNav() {
  const colors = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboard();

  // Com o teclado aberto a barra só tiraria espaço do campo de texto.
  if (keyboard.visible) return null;

  return (
    // O avatar sobe para fora do corpo da barra; no Android o toque fora dos limites do pai não chega, então o
    // contêiner já inclui essa faixa (transparente) e o fundo da barra começa abaixo dela.
    <View style={{ paddingTop: RAISE }}>
      <View style={[styles.bar, { height: BOTTOM_NAV_BODY + insets.bottom, paddingBottom: insets.bottom }]}>
        {TABS.map(({ key, label, href, owns: prefixes, Icon }) => {
          const active = owns(pathname, prefixes);
          const tint = active ? colors.accent : colors.ink3;
          return (
            <Pressable
              key={key}
              onPress={() => router.navigate(href as never)}
              style={styles.tab}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: active }}
            >
              {Icon ? (
                <View style={[styles.indicator, active && styles.indicatorActive]}>
                  <Icon size={24} sw={2} color={tint} />
                </View>
              ) : (
                <View style={styles.indicator} />
              )}
              <Text style={[styles.label, { color: key === 'chat' ? (active ? colors.accent : colors.ink2) : tint }, active && styles.labelActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* Fora das abas, dentro do contêiner: assim a parte que sobe acima da barra também recebe o toque. */}
      <View style={styles.raised} pointerEvents="box-none">
        <Pressable
          onPress={() => router.navigate('/')}
          accessibilityRole="button"
          accessibilityLabel="Xiaolee"
          accessibilityState={{ selected: owns(pathname, TABS[2].owns) }}
        >
          <Image source={require('../../assets/images/xiaolee-avatar.png')} style={styles.avatar} />
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.two,
    paddingTop: 11,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    // sombra do Figma: 0 -4 16 rgba(26,25,23,.06)
    shadowColor: '#1a1917',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  tab: { flex: 1, alignItems: 'center', gap: Spacing.one },
  indicator: { width: 52, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  indicatorActive: { backgroundColor: colors.accentSoft },
  label: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 15 },
  labelActive: { fontFamily: Fonts.semibold },
  // Topo do avatar a -19 do topo da barra = topo do contêiner.
  raised: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    borderWidth: 4,
    borderColor: colors.card,
    backgroundColor: colors.accentSoft,
    shadowColor: '#d81b78',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
}));
