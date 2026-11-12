import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconBell, IconSpark } from '@/components/icons';
import { ProfileAvatarButton } from '@/components/profile-avatar-button';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { formatTokenAmount } from '@/lib/format';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useProfilePhoto } from '@/hooks/use-profile-photo';

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
  onPressProfile?: () => void;
  /** Volta para o chat. Sem handler o wordmark fica inerte, como era antes. */
  onPressLogo?: () => void;
  /** Perfil aberto: o anel se desenha em volta do avatar. */
  profileOpen?: boolean;
  /** Contagem para o badge sobre o sino — 0/undefined não desenha nada. */
  unreadCount?: number;
  /** Saldo de pontos: selo ao lado do sino. 0/undefined não desenha nada. */
  points?: number;
}

export function HeaderBar({
  onPressNotifications,
  onPressProfile,
  onPressLogo,
  profileOpen = false,
  unreadCount,
  points,
}: HeaderBarProps) {
  const colors = useTheme();
  const styles = useStyles();
  // O frame do Figma começa em y=0 porque não desenha a status bar. No
  // aparelho, sem este inset o wordmark fica embaixo do relógio e da bateria.
  const insets = useSafeAreaInsets();
  const { photo } = useProfilePhoto();

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
          <IconSpark size={13} color={colors.accent} />
        </View>
      </Pressable>

      <View style={styles.actions}>
        {points ? (
          <View style={styles.points} accessible accessibilityLabel={`Seus pontos: ${formatTokenAmount(points)}`}>
            {/* O desenho da faísca ocupa a metade de cima do quadro 24x24: desce para alinhar ao número. */}
            <View style={styles.pointsSpark}>
              <IconSpark size={14} color={colors.accent} />
            </View>
            <Text style={styles.pointsText} numberOfLines={1}>
              {formatTokenAmount(points)}
            </Text>
          </View>
        ) : null}
        <Pressable
          onPress={onPressNotifications}
          hitSlop={Spacing.two}
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount ? `Notificações, ${unreadCount} pendentes` : 'Notificações'
          }
        >
          <IconBell size={24} color={colors.ink2} />
          {unreadCount ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <ProfileAvatarButton open={profileOpen} onPress={onPressProfile} photo={photo} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    paddingHorizontal: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  logo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  wordmark: {
    // Candice é a fonte da marca, só do logo — o resto do app é Quicksand.
    fontFamily: Fonts.brand,
    fontSize: 26,
    color: colors.ink,
    // Candice tem ascendentes altos; sem isto o Android corta o topo das letras.
    lineHeight: 34,
  },
  wordmarkAccent: {
    color: colors.accent,
  },
  spark: { marginTop: -6 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  points: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    height: 26,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentSoft,
  },
  pointsSpark: { marginTop: 3 },
  pointsText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.accent },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
    borderWidth: 1.5,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: Fonts.bold,
    fontSize: 10,
    lineHeight: 12,
    color: colors.onAccent,
  },
}));
