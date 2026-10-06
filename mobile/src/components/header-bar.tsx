import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconBell, IconMenu, IconSpark, IconUser } from '@/components/icons';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

/**
 * Barra superior presente nas quatro telas do Figma ("Xiaolee - AI Chat",
 * Dashboard, Profile e menu) — sempre a mesma: wordmark à esquerda, sino,
 * hambúrguer e avatar à direita.
 *
 * Profile e menu não são telas separadas no desenho: são painéis ancorados
 * neste avatar e neste hambúrguer. Daí os callbacks em vez de navegação.
 */

interface HeaderBarProps {
  onPressNotifications?: () => void;
  onPressMenu?: () => void;
  onPressProfile?: () => void;
  /** Volta para o chat. Sem handler o wordmark fica inerte, como era antes. */
  onPressLogo?: () => void;
  /** Contagem para o badge sobre o sino — 0/undefined não desenha nada. */
  unreadCount?: number;
}

export function HeaderBar({
  onPressNotifications,
  onPressMenu,
  onPressProfile,
  onPressLogo,
  unreadCount,
}: HeaderBarProps) {
  // O frame do Figma começa em y=0 porque não desenha a status bar. No
  // aparelho, sem este inset o wordmark fica embaixo do relógio e da bateria.
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingTop: insets.top, height: 53 + insets.top }]}>
      {/* Logo idêntico ao da navbar web: "Xiao" neutro + "lee" no acento em
          Candice, seguido da faísca como SVG (não como caractere). Também
          leva ao chat como lá, onde é um `<Link href="/">` — nas telas
          internas é a única volta visível, já que o desenho do header não
          tem seta e o menu não lista o chat. */}
      <Pressable
        onPress={onPressLogo}
        disabled={!onPressLogo}
        style={styles.logo}
        accessibilityRole={onPressLogo ? 'link' : undefined}
        accessibilityLabel={onPressLogo ? 'Xiaolee — ir para o chat' : undefined}
        hitSlop={Spacing.two}
      >
        <Text style={styles.wordmark}>
          Xiao<Text style={styles.wordmarkAccent}>lee</Text>
        </Text>
        {/* A faísca sobe um pouco, como o `-translate-y-1.5` do web. */}
        <View style={styles.spark}>
          <IconSpark size={13} color={Colors.light.accent} />
        </View>
      </Pressable>

      <View style={styles.actions}>
        <Pressable
          onPress={onPressNotifications}
          hitSlop={Spacing.two}
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount ? `Notificações, ${unreadCount} pendentes` : 'Notificações'
          }
        >
          <IconBell size={24} color={Colors.light.accent} />
          {unreadCount ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          onPress={onPressMenu}
          hitSlop={Spacing.two}
          accessibilityRole="button"
          accessibilityLabel="Menu"
        >
          <IconMenu size={26} sw={2.2} color={Colors.light.accent} />
        </Pressable>

        {/* Avatar: círculo cheio no acento — um dos poucos usos permitidos */}
        <Pressable
          onPress={onPressProfile}
          hitSlop={Spacing.two}
          accessibilityRole="button"
          accessibilityLabel="Perfil"
          style={styles.avatar}
        >
          <IconUser size={18} sw={2} color={Colors.light.card} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.light.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  logo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  wordmark: {
    // Candice é a fonte da marca, só do logo — o resto do app é Quicksand.
    fontFamily: Fonts.brand,
    fontSize: 26,
    color: Colors.light.ink,
    // Candice tem ascendentes altos; sem isto o Android corta o topo das letras.
    lineHeight: 34,
  },
  wordmarkAccent: {
    color: Colors.light.accent,
  },
  spark: { marginTop: -6 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.danger,
    borderWidth: 1.5,
    borderColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: Fonts.bold,
    fontSize: 10,
    lineHeight: 12,
    color: Colors.light.card,
  },
});
