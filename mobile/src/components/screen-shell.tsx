import { usePathname, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectWalletSheet } from '@/components/connect-wallet-sheet';
import { HeaderBar } from '@/components/header-bar';
import { IconChat } from '@/components/icons';
import { NavMenu } from '@/components/nav-menu';
import { ProfileMenu } from '@/components/profile-menu';
import { CardShadow, Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useUnreadNotificationsCount } from '@/hooks/use-unread-notifications';
import { useWallet } from '@/hooks/use-wallet';

/**
 * Moldura comum a todas as telas: a barra do topo e os dois painéis que ela
 * abre.
 *
 * Isto vivia inline no chat. Com mais de uma tela cada uma repetiria o mesmo
 * estado de painel e a mesma ordem de renderização — e a ordem importa: os
 * painéis vêm **depois** do conteúdo para ficarem por cima dele, como nos
 * frames do Figma. Centralizar também garante que ligar o sino uma vez o
 * ligue em todas as telas.
 */

/** Qual painel do header está aberto — só um por vez, como no Figma. */
type OpenPanel = 'none' | 'menu' | 'profile';

export function ScreenShell({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<OpenPanel>('none');
  const [walletSheet, setWalletSheet] = useState(false);
  const router = useRouter();
  // A carteira É a identidade do app (`lib/wallet.tsx` grava a sessão
  // ao conectar) — não há mais um login separado dela para esperar aqui.
  const { address: wallet } = useWallet();
  const unreadCount = useUnreadNotificationsCount();

  const close = () => setPanel('none');
  /** Tocar no mesmo ícone fecha; nos dois painéis, abrir um fecha o outro. */
  const toggle = (next: Exclude<OpenPanel, 'none'>) =>
    setPanel((current) => (current === next ? 'none' : next));

  return (
    <View style={styles.screen}>
      <HeaderBar
        // `push` e não `navigate`: notificações é um destino lateral, e o
        // voltar do Android deve devolver o usuário à tela de onde ele tocou
        // no sino, não à raiz.
        onPressNotifications={() => {
          close();
          router.push('/notifications');
        }}
        onPressMenu={() => toggle('menu')}
        onPressProfile={() => toggle('profile')}
        // `navigate` e não `push`: o chat é a raiz da pilha, então empilhar
        // uma segunda cópia dele deixaria o voltar do Android preso num
        // vaivém entre dois chats idênticos.
        onPressLogo={() => router.navigate('/')}
        unreadCount={unreadCount}
      />

      {children}

      <NavMenu visible={panel === 'menu'} onDismiss={close} />
      <ProfileMenu
        visible={panel === 'profile'}
        onDismiss={close}
        walletAddress={wallet}
        onConnectWallet={() => {
          close();
          setWalletSheet(true);
        }}
      />
      <ConnectWalletSheet visible={walletSheet} onClose={() => setWalletSheet(false)} />

      <BackToChat />
    </View>
  );
}

/**
 * Atalho flutuante para o chat.
 *
 * O wordmark do header já leva para lá, mas ninguém descobre isso sozinho — a
 * conversa é a tela principal do produto e precisa de uma porta visível de
 * qualquer lugar.
 *
 * Vive aqui, e não em cada tela, porque o `ScreenShell` é justamente o que todas
 * compartilham: uma cópia por tela seria oito lugares para esquecer de mexer.
 */
function BackToChat() {
  const router = useRouter();
  const pathname = usePathname();
  // A barra de gestos do Android comeria o botão sem este inset.
  const insets = useSafeAreaInsets();

  // No próprio chat o atalho não faz sentido — e o `ScreenShell` também embrulha
  // a tela inicial.
  if (pathname === '/') return null;

  return (
    <Pressable
      // `navigate` e não `push`: o chat é a raiz da pilha, e empilhar uma
      // segunda cópia dele prenderia o voltar do Android num vaivém entre dois
      // chats idênticos — mesma escolha do wordmark no header.
      onPress={() => router.navigate('/')}
      style={({ pressed }) => [
        styles.backToChat,
        { bottom: Spacing.three + insets.bottom },
        pressed && styles.backToChatPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel="Voltar para o chat"
    >
      <IconChat size={17} color={Colors.light.card} />
      <Text style={styles.backToChatText}>Chat</Text>
    </Pressable>
  );
}

/**
 * Título e linha de apoio no topo do conteúdo — o bloco centralizado que o
 * web repete em Traction, Campaigns, Dashboard e Notifications.
 */
export function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.heading}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.light.bg },
  backToChat: {
    ...CardShadow,
    position: 'absolute',
    // À esquerda de propósito: o dev client da Expo põe a própria bolha no
    // canto direito, e sobrepor as duas deixa o botão inalcançável em dev.
    left: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 2,
    paddingHorizontal: Spacing.three,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accent,
  },
  backToChatPressed: { opacity: 0.85 },
  backToChatText: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.light.card },
  heading: { alignItems: 'center', gap: Spacing.two - 2 },
  title: { fontFamily: Fonts.bold, fontSize: 24, color: Colors.light.ink },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: Colors.light.ink2,
    textAlign: 'center',
  },
});
