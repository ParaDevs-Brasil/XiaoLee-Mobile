import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconHome, IconTrendingUp, IconVideo, IconWallet, type IconProps } from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useKeyboard } from '@/hooks/use-keyboard';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
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
  { key: 'home', label: 'Home', href: '/', owns: ['/'], Icon: IconHome },
  { key: 'studio', label: 'Studio', href: '/studio', owns: ['/studio', '/clips', '/reports', '/creators', '/accounts'], Icon: IconVideo },
  { key: 'chat', label: 'Xiaolee', href: '/chat', owns: ['/chat', '/history'] },
  { key: 'grow', label: 'Grow', href: '/grow', owns: ['/grow', '/campaigns', '/marketplace'], Icon: IconTrendingUp },
  { key: 'wallet', label: 'Wallet', href: '/wallet', owns: ['/wallet'], Icon: IconWallet },
];

const owns = (path: string, prefixes: string[]) =>
  prefixes.some((p) => (p === '/' ? path === '/' : path === p || path.startsWith(`${p}/`)));

const PILL_WIDTH = 52;

/**
 * Cada tela monta a sua própria barra (via `ScreenShell`), então o estado da pílula vive aqui, fora do componente:
 * a barra nova nasce já sabendo de onde a anterior saiu e só escorrega até a aba nova. Sem isso ela surgiria
 * pronta no destino, sem movimento nenhum.
 */
const pillSlot = new Animated.Value(0);
const pillShown = new Animated.Value(0);
let pillWasShown = false;
let lastBarWidth = 0;

/** Leva a pílula até a aba `index` (ou a esconde, sem índice). Rápida de propósito: acompanha o dedo, não a tela. */
function movePill(index: number, instant: boolean) {
  if (index < 0) {
    pillWasShown = false;
    Animated.timing(pillShown, { toValue: 0, duration: instant ? 0 : 110, useNativeDriver: true }).start();
    return;
  }
  if (!pillWasShown || instant) pillSlot.setValue(index);
  else Animated.spring(pillSlot, { toValue: index, damping: 20, stiffness: 420, mass: 0.7, useNativeDriver: true }).start();
  pillWasShown = true;
  Animated.timing(pillShown, { toValue: 1, duration: instant ? 0 : 120, useNativeDriver: true }).start();
}

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

  const reduce = useReduceMotion();
  const [barWidth, setBarWidth] = useState(lastBarWidth);

  // A pílula atrás do ícone é uma só e escorrega até a aba aberta; no chat (o avatar do meio) ela some no lugar.
  const activeIndex = TABS.findIndex((t) => t.Icon && owns(pathname, t.owns));

  // Quando a rota muda por outro caminho (voltar, link), a pílula acompanha; no toque ela já saiu na frente.
  useEffect(() => {
    movePill(activeIndex, reduce);
  }, [activeIndex, reduce]);

  const slotWidth = barWidth ? (barWidth - Spacing.two * 2) / TABS.length : 0;

  // Com o teclado aberto a barra só tiraria espaço do campo de texto.
  if (keyboard.visible) return null;

  return (
    // O avatar sobe para fora do corpo da barra; no Android o toque fora dos limites do pai não chega, então o
    // contêiner já inclui essa faixa (transparente) e o fundo da barra começa abaixo dela.
    <View style={{ paddingTop: RAISE }}>
      <View
        style={[styles.bar, { height: BOTTOM_NAV_BODY + insets.bottom, paddingBottom: insets.bottom }]}
        onLayout={(e) => {
          lastBarWidth = e.nativeEvent.layout.width;
          setBarWidth(lastBarWidth);
        }}
      >
        {slotWidth ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pill,
              {
                opacity: pillShown,
                transform: [
                  {
                    translateX: pillSlot.interpolate({
                      inputRange: TABS.map((_, i) => i),
                      outputRange: TABS.map((_, i) => Spacing.two + i * slotWidth + (slotWidth - PILL_WIDTH) / 2),
                    }),
                  },
                  { scaleX: pillShown.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
                ],
              },
            ]}
          />
        ) : null}
        {TABS.map(({ key, label, href, owns: prefixes, Icon }) => {
          const active = owns(pathname, prefixes);
          const tint = active ? colors.accent : colors.ink3;
          return (
            <TabButton
              key={key}
              label={label}
              active={active}
              onPress={() => {
                // Anima já no toque, sem esperar a tela trocar.
                movePill(Icon ? TABS.findIndex((t) => t.key === key) : -1, reduce);
                router.navigate(href as never);
              }}
              style={styles.tab}
            >
              <View style={styles.indicator}>{Icon ? <Icon size={24} sw={2} color={tint} /> : null}</View>
              {key === 'chat' ? (
                // Logo da marca embaixo do avatar, igual ao do header: "Xiao" neutro + "lee" no acento.
                <Text style={styles.wordmark} accessible={false}>
                  Xiao<Text style={styles.wordmarkAccent}>lee</Text>
                </Text>
              ) : (
                <Text style={[styles.label, { color: tint }, active && styles.labelActive]}>{label}</Text>
              )}
            </TabButton>
          );
        })}
      </View>
      {/* Fora das abas, dentro do contêiner: assim a parte que sobe acima da barra também recebe o toque. */}
      <View style={styles.raised} pointerEvents="box-none">
        <XiaoleeButton
          selected={owns(pathname, TABS[2].owns)}
          onPress={() => {
            // A barra é remontada em cada tela: navega só depois do estouro, senão a animação some junto.
            if (reduce || owns(pathname, TABS[2].owns)) return router.navigate('/chat');
            setTimeout(() => router.navigate('/chat'), BURST_NAV_DELAY);
          }}
        />
      </View>
    </View>
  );
}

const BURST_NAV_DELAY = 160;
const BURST_DURATION = 520;

/**
 * Avatar do meio: afunda sob o dedo e, no toque, dá um leve pulso e solta um anel rosa que se abre e some.
 * Tudo em `transform`/`opacity` no driver nativo; com "Reduzir movimento" é só o toque.
 */
function XiaoleeButton({ selected, onPress }: { selected: boolean; onPress: () => void }) {
  const styles = useStyles();
  const reduce = useReduceMotion();
  const [press] = useState(() => new Animated.Value(1));
  const [burst] = useState(() => new Animated.Value(0));

  const sink = (to: number) => {
    if (reduce) return;
    Animated.spring(press, { toValue: to, damping: 14, stiffness: 380, mass: 0.6, useNativeDriver: true }).start();
  };

  const fire = () => {
    if (!reduce) {
      burst.setValue(0);
      Animated.timing(burst, { toValue: 1, duration: BURST_DURATION, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
    onPress();
  };

  const ring = () => ({
    opacity: burst.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.3, 0], extrapolate: 'clamp' }),
    transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] }) }],
  });

  return (
    <Pressable
      onPress={fire}
      onPressIn={() => sink(0.88)}
      onPressOut={() => sink(1)}
      accessibilityRole="button"
      accessibilityLabel="Xiaolee"
      accessibilityState={{ selected }}
    >
      <View style={styles.avatarBox} pointerEvents="none">
        <Animated.View style={[styles.ring, ring()]} />
        <Animated.Image
          source={require('../../assets/images/xiaolee-avatar.png')}
          style={[
            styles.avatar,
            {
              transform: [
                { scale: Animated.multiply(press, burst.interpolate({ inputRange: [0, 0.15, 0.4, 1], outputRange: [1, 1.06, 0.99, 1] })) },
              ],
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

/** Aba com retorno ao toque (afunda um pouco) e uma pequena "pulada" quando passa a ser a aberta. */
function TabButton({
  label,
  active,
  onPress,
  style,
  children,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  style: object;
  children: React.ReactNode;
}) {
  const reduce = useReduceMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const wasActive = useRef(false);

  useEffect(() => {
    if (active && !wasActive.current && !reduce) {
      scale.setValue(0.86);
      Animated.spring(scale, { toValue: 1, damping: 10, stiffness: 380, mass: 0.6, useNativeDriver: true }).start();
    }
    wasActive.current = active;
  }, [active, reduce, scale]);

  const press = (to: number) => {
    if (reduce) return;
    Animated.timing(scale, { toValue: to, duration: 70, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => press(0.9)}
      onPressOut={() => press(1)}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <Animated.View style={{ alignItems: 'center', gap: Spacing.one, transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
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
  pill: { position: 'absolute', top: 11, left: 0, width: PILL_WIDTH, height: 28, borderRadius: 14, backgroundColor: colors.accentSoft },
  wordmark: {
    // Candice é a fonte da marca, só do logo. Tem ascendentes altos: o lineHeight evita o corte no Android.
    fontFamily: Fonts.brand,
    fontSize: 16,
    lineHeight: 19,
    marginTop: -2,
    color: colors.ink,
  },
  wordmarkAccent: { color: colors.accent },
  avatarBox: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 56, height: 56, borderRadius: Radius.pill, borderWidth: 2, borderColor: colors.accent },
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
