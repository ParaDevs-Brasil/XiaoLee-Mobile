import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { ConnectWalletSheet } from '@/components/connect-wallet-sheet';
import { HeaderBar } from '@/components/header-bar';
import { BottomNav } from '@/components/bottom-nav';
import { ProfileMenu } from '@/components/profile-menu';
import { ShareProfileSheet } from '@/components/share-profile-sheet';
import { Fonts, Spacing } from '@/constants/theme';
import { makeStyles } from '@/hooks/use-theme';
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

/**
 * Folga no fim das listas. A barra inferior fica no fluxo (o conteúdo já termina acima dela), então sobra só um respiro;
 * o nome vem do atalho flutuante que a barra substituiu e as telas seguem somando isto ao `paddingBottom`.
 */
export const FAB_CLEARANCE = Spacing.four;

/** Qual painel do header está aberto — só um por vez, como no Figma. */
type OpenPanel = 'none' | 'profile';

export function ScreenShell({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const [panel, setPanel] = useState<OpenPanel>('none');
  const [walletSheet, setWalletSheet] = useState(false);
  const [shareSheet, setShareSheet] = useState(false);
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
        profileOpen={panel === 'profile'}
        onPressProfile={() => toggle('profile')}
        // `navigate` e não `push`: o chat é a raiz da pilha, então empilhar
        // uma segunda cópia dele deixaria o voltar do Android preso num
        // vaivém entre dois chats idênticos.
        onPressLogo={() => router.navigate('/')}
        unreadCount={unreadCount}
      />

      {children}

      <BottomNav />

      <ProfileMenu
        visible={panel === 'profile'}
        onDismiss={close}
        walletAddress={wallet}
        onConnectWallet={() => {
          close();
          setWalletSheet(true);
        }}
        onShareProfile={() => {
          close();
          setShareSheet(true);
        }}
      />
      <ConnectWalletSheet visible={walletSheet} onClose={() => setWalletSheet(false)} />
      <ShareProfileSheet visible={shareSheet} onClose={() => setShareSheet(false)} />
    </View>
  );
}

/**
 * Título e linha de apoio no topo do conteúdo — o bloco centralizado que o
 * web repete em Traction, Campaigns, Dashboard e Notifications.
 */
export function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  const styles = useStyles();
  return (
    <View style={styles.heading}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  heading: { alignItems: 'center', gap: Spacing.two - 2 },
  title: { fontFamily: Fonts.bold, fontSize: 24, color: colors.ink },
  subtitle: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: colors.ink2,
    textAlign: 'center',
  },
}));
