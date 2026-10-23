import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppearancePicker } from '@/components/appearance-picker';
import { DropdownPanel, PanelRow, type PanelItem } from '@/components/dropdown-panel';
import {
  IconBarChart,
  IconCheck,
  IconDollar,
  IconClipboard,
  IconClock,
  IconDownload,
  IconLogOut,
  IconShare,
  IconUpload,
  IconUser,
  IconWallet,
} from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useProfilePhoto } from '@/hooks/use-profile-photo';
import { usePrivyWallet } from '@/lib/wallet';

/**
 * Painel de perfil — frame "Xiaolee - Profile" (grupo `menu-profile`, 191x522).
 *
 * Cabeçalho com identidade, seis ações, o seletor de tema e o CTA de
 * conectar carteira no rodapé. O app não tem tela de configurações; o tema é
 * a única preferência e mora aqui.
 * A carteira é a única identidade do app (`lib/wallet.tsx`) — não há
 * login separado dela para exibir aqui.
 */

interface ProfileMenuProps {
  visible: boolean;
  onDismiss: () => void;
  /** Endereço da carteira conectada, quando há. */
  walletAddress?: string;
  onConnectWallet: () => void;
  /** Abre o sheet de compartilhar perfil (`ShareProfileSheet`). */
  onShareProfile: () => void;
}

/** Abrevia o endereço como no web: início e fim, meio elidido. */
function short(address: string): string {
  return address.length <= 16 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`;
}

/**
 * As seis ações do frame. As três primeiras e o `connect` já têm destino;
 * `withdraw` e `deposit` continuam inertes porque ainda não têm tela.
 */
const ACTIONS: (PanelItem & { href?: '/wallet' | '/transactions' | '/history' | '/accounts' | '/dashboard' | '/traction' })[] = [
  {
    key: 'edit-profile',
    Icon: IconUser,
    title: 'Edit profile',
    subtitle: 'Name, interests, bio',
  },
  { key: 'wallet', Icon: IconWallet, title: 'wallet', subtitle: 'View token balance', href: '/wallet' },
  {
    key: 'transaction',
    Icon: IconClipboard,
    title: 'Transaction',
    subtitle: 'View swap history',
    href: '/transactions',
  },
  {
    key: 'history',
    Icon: IconClock,
    title: 'History',
    subtitle: 'View conversations and activities',
    href: '/history',
  },
  { key: 'accounts', Icon: IconShare, title: 'Accounts', subtitle: 'Connect X and Telegram', href: '/accounts' },
  { key: 'dashboard', Icon: IconBarChart, title: 'Dashboard', subtitle: 'The economy at a glance', href: '/dashboard' },
  { key: 'traction', Icon: IconDollar, title: 'Traction', subtitle: 'Live payments on Arc', href: '/traction' },
  {
    key: 'connect',
    Icon: IconClipboard,
    title: 'Connect Wallet',
    subtitle: 'ARC - Solana - Stellar - USDC',
  },
  { key: 'withdraw', Icon: IconDownload, title: 'Withdraw', subtitle: 'Withdraw funds to wallet' },
  { key: 'deposit', Icon: IconUpload, title: 'Deposit', subtitle: 'Add funds to account' },
];

export function ProfileMenu({
  visible,
  onDismiss,
  walletAddress,
  onConnectWallet,
  onShareProfile,
}: ProfileMenuProps) {
  const colors = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { disconnect } = usePrivyWallet();
  const { photo } = useProfilePhoto();

  return (
    <DropdownPanel visible={visible} onDismiss={onDismiss}>
      <View style={styles.identity}>
        <View style={styles.avatar}>
          {photo ? (
            <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} />
          ) : (
            <IconUser size={26} sw={2} color={colors.onAccent} />
          )}
        </View>
        <View style={styles.identityText}>
          <Text style={styles.handle} numberOfLines={1}>
            {walletAddress ? short(walletAddress) : 'Not connected'}
          </Text>
          <Text style={styles.userId} numberOfLines={1}>
            {walletAddress ? 'Wallet' : 'Connect a wallet to get started'}
          </Text>
        </View>
        {walletAddress ? <CopyAddressButton address={walletAddress} /> : null}
      </View>

      {ACTIONS.map(({ href, ...item }) => (
        <PanelRow
          key={item.key}
          item={{
            ...item,
            // A linha de conectar mostra o endereço vinculado quando há um.
            ...(item.key === 'connect' && walletAddress
              ? { title: 'Wallet connected', subtitle: short(walletAddress) }
              : null),
            // `push` e não `navigate`: a carteira é destino lateral, e o voltar
            // do Android deve devolver o usuário à tela de onde ele abriu o
            // painel — mesma escolha do sino no `ScreenShell`.
            onPress: href
              ? () => {
                  onDismiss();
                  router.push(href);
                }
              : item.key === 'connect'
                ? () => {
                    onDismiss();
                    onConnectWallet();
                  }
                : item.key === 'edit-profile'
                  ? () => {
                      onDismiss();
                      router.push({ pathname: '/onboarding', params: { edit: '1' } });
                    }
                  : undefined,
          }}
        />
      ))}

      {walletAddress ? (
        // Só com sessão: o card é montado do `GET /user/me/profile`.
        <PanelRow
          item={{
            key: 'share-profile',
            Icon: IconShare,
            title: 'Share profile',
            subtitle: 'Post your Xiaolee card',
            onPress: () => {
              onDismiss();
              onShareProfile();
            },
          }}
        />
      ) : null}

      {/* Preferência do app, não da conta — fica no fim, logo antes de sair,
          onde ficam as preferências na maioria dos apps. */}
      <AppearancePicker />

      {walletAddress ? (
        <PanelRow
          item={{
            key: 'disconnect',
            Icon: IconLogOut,
            title: 'Sign out',
            subtitle: 'Disconnect your account',
            onPress: () => {
              onDismiss();
              void disconnect();
            },
          }}
        />
      ) : (
        <Pressable
          onPress={onConnectWallet}
          style={({ pressed }) => [styles.connect, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <IconWallet size={16} color={colors.accent} />
          <Text style={styles.connectLabel}>Connect Wallet</Text>
        </Pressable>
      )}
    </DropdownPanel>
  );
}

/** Copia o endereço completo (não o abreviado) pro clipboard. */
function CopyAddressButton({ address }: { address: string }) {
  const colors = useTheme();
  const styles = useStyles();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(address);
    setCopied(true);
    // Volta sozinho: um "copiado" permanente mente na próxima vez que o
    // usuário abre o painel.
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Pressable
      onPress={copy}
      hitSlop={Spacing.two}
      style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Copy wallet address"
    >
      {copied ? (
        <IconCheck size={16} color={colors.success} />
      ) : (
        <IconClipboard size={16} color={colors.ink3} />
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  copyButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: colors.bg,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentFill,
  },
  identityText: { flex: 1 },
  handle: { fontFamily: Fonts.bold, fontSize: 16, color: colors.ink },
  userId: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink2, marginTop: 1 },

  connect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two - 2,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: colors.accentSoft,
    marginTop: Spacing.one,
  },
  connectLabel: { fontFamily: Fonts.bold, fontSize: 12, color: colors.ink },
  pressed: { opacity: 0.6 },
}));
