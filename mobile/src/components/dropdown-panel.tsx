import type { ReactNode } from 'react';
import { Children, useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IconProps } from '@/components/icons';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';

/**
 * Painel ancorado no header — a base dos frames "Xiaolee - menu" e
 * "Xiaolee - Profile" do Figma.
 *
 * Nos dois desenhos o painel não é uma tela: aparece por cima do chat, colado
 * no topo direito, com o conteúdo do chat visível atrás. Largura 191 vem do
 * arquivo (grupos `Group 9` e `menu-profile`).
 *
 * A abertura é animada em três camadas, porque só mover o painel inteiro ainda
 * o faz chegar como um bloco pronto:
 *
 *  1. `transformOrigin: 'top right'` — ele cresce a partir do canto onde estão
 *     o hambúrguer e o avatar, e não a partir do próprio centro.
 *  2. entrada com mola — o overshoot vem da física, então o movimento tem
 *     inércia e sobrevive a ser interrompido no meio.
 *  3. as linhas entram em cascata, cada uma num pedaço diferente da mesma
 *     progressão, então o painel se monta em vez de aparecer inteiro.
 *
 * Usa o `Animated` do React Native e não o Reanimated: é o que o resto do app
 * usa (ver `animated-avatar.tsx`). No web o módulo nativo não existe e o
 * próprio RNW cai para animação em JS, então `useNativeDriver` é seguro nos
 * dois lados.
 */

/** Largura dos dois painéis no Figma. */
const PANEL_WIDTH = 191;

/** Só o fechamento tem duração fixa; a abertura é mola e assenta sozinha. */
const CLOSE_MS = 160;

/**
 * Quanto da progressão é gasto escalonando o início das linhas. O resto de
 * cada janela é a transição da linha em si — a última começa em `SPREAD` e
 * termina junto com o painel.
 */
const STAGGER_SPREAD = 0.45;

interface DropdownPanelProps {
  visible: boolean;
  onDismiss: () => void;
  children: ReactNode;
  /**
   * Ancoragem customizada, em coordenadas de janela (`measureInWindow`).
   * Sem isto, cai no canto do header global (hambúrguer/avatar) — o caso de
   * `NavMenu`/`ProfileMenu`. Painéis abertos de um botão fora do header (ex.:
   * o "New chat" dentro do card do chat) passam a posição medida do botão.
   */
  anchor?: { top: number; right: number };
}

export function DropdownPanel({ visible, onDismiss, children, anchor }: DropdownPanelProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  // Mesmo idioma do avatar: a `Animated.Value` nasce uma vez e sobrevive aos
  // renders. Começa no estado atual para o primeiro frame não piscar aberto.
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0));

  useEffect(() => {
    // Abre com mola e fecha com curva. A mola tem inércia própria: o
    // overshoot nasce da física em vez de vir de uma forma fixa, e o
    // movimento continua de onde estava se o usuário tocar no ícone de novo
    // no meio da animação — era isso que deixava a abertura mecânica.
    // Fechar com mola, ao contrário, faz o painel demorar a sair do caminho.
    const animation = visible
      ? Animated.spring(progress, {
          toValue: 1,
          // Subamortecida de propósito (ζ ≈ 0.6): passa ~8% do destino e
          // assenta. Acima disso vira gelatina.
          damping: 17,
          stiffness: 210,
          mass: 0.9,
          useNativeDriver: true,
        })
      : Animated.timing(progress, {
          toValue: 0,
          duration: CLOSE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        });

    animation.start();
    // Sem isto, abrir e fechar rápido deixa duas animações disputando o mesmo
    // valor e o painel treme.
    return () => animation.stop();
  }, [visible, progress]);

  // `back` faz a progressão passar de 1 antes de assentar. Escala e
  // deslocamento aproveitam isso (é o overshoot), mas a opacidade precisa ser
  // travada — acima de 1 não significa nada e o RN avisa.
  const rows = Children.toArray(children);
  const lastRow = Math.max(rows.length - 1, 1);

  // O painel fica montado mesmo fechado: desmontar no `visible: false` cortaria
  // a animação de saída no primeiro frame. Em troca, fechado ele precisa parar
  // de capturar toque e sair da árvore de acessibilidade — senão o backdrop
  // invisível engoliria os toques da tela inteira.
  return (
    <View
      style={styles.backdropWrap}
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      {/* Cobre a tela inteira para capturar o toque de fechar; sem ele o único
          jeito de sair seria tocando de novo no ícone que abriu. */}
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Fechar menu" />

      <Animated.View
        style={[
          styles.panel,
          anchor
            ? { top: anchor.top, right: anchor.right }
            : { top: 53 + insets.top + Spacing.three - 4 },
          {
            opacity: progress.interpolate({
              inputRange: [0, 0.5],
              outputRange: [0, 1],
              extrapolate: 'clamp',
            }),
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-14, 0],
                }),
              },
              {
                scale: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.82, 1],
                }),
              },
            ],
          },
        ]}
        // Toque dentro do painel não deve fechá-lo. O sistema de responder
        // pergunta aos filhos primeiro, então as linhas continuam clicáveis e
        // só o toque no vazio do painel é absorvido aqui.
        onStartShouldSetResponder={() => true}
      >
        {rows.map((row, index) => {
          // Cada linha ocupa uma janela deslocada da mesma progressão: a
          // primeira abre no início, a última fecha junto com o painel. Sai
          // um cascata sem precisar de um `Animated.Value` por linha — o que
          // seria hook dentro de laço, ilegal quando a contagem muda.
          const start = (index / lastRow) * STAGGER_SPREAD;
          const window = { inputRange: [start, start + (1 - STAGGER_SPREAD)] };

          return (
            <Animated.View
              key={index}
              style={{
                opacity: progress.interpolate({
                  ...window,
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
                transform: [
                  {
                    translateY: progress.interpolate({
                      ...window,
                      outputRange: [-8, 0],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              }}
            >
              {row}
            </Animated.View>
          );
        })}
      </Animated.View>
    </View>
  );
}

export interface PanelItem {
  key: string;
  Icon: (p: IconProps) => React.ReactElement;
  title: string;
  subtitle?: string;
  onPress?: () => void;
}

/** Linha do painel: ícone em quadrado suave + título e descrição opcional. */
export function PanelRow({ item: { Icon, title, subtitle, onPress } }: { item: PanelItem }) {
  const colors = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
    >
      <View style={styles.rowIcon}>
        <Icon size={18} color={colors.accent} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  backdropWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 10 },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  panel: {
    position: 'absolute',
    right: Spacing.three - 4,
    width: PANEL_WIDTH,
    // O painel nasce no canto onde estão o hambúrguer e o avatar. Sem isto o
    // RN escala a partir do centro e o efeito vira "inflar", não "brotar".
    transformOrigin: 'top right',
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: Radius.lg,
    backgroundColor: colors.popover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.popoverBorder,
    gap: Spacing.two + 2,
    ...CardShadow,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: Fonts.bold, fontSize: 14, color: colors.ink },
  rowSubtitle: {
    fontFamily: Fonts.sans,
    fontSize: 9,
    lineHeight: 12,
    color: colors.ink2,
    marginTop: 1,
  },
  pressed: { opacity: 0.6 },
}));
