import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DropdownPanel, PanelRow, type PanelItem } from '@/components/dropdown-panel';
import {
  IconCheck,
  IconClipboard,
  IconClock,
  IconDownload,
  IconLogOut,
  IconUpload,
  IconUser,
  IconWallet,
} from '@/components/icons';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { usePrivyWallet } from '@/lib/wallet';

/**
 * Painel de perfil — frame "Xiaolee - Profile" (grupo `menu-profile`, 191x522).
 *
 * Cabeçalho com identidade, seis ações e o CTA de conectar carteira no rodapé.
 * A carteira é a única identidade do app (`lib/wallet.tsx`) — não há
 * login separado dela para exibir aqui.
 */

interface ProfileMenuProps {
  visible: boolean;
  onDismiss: () => void;
  /** Endereço da carteira conectada, quando há. */
  walletAddress?: string;
  onConnectWallet: () => void;
}

/** Abrevia o endereço como no web: início e fim, meio elidido. */
function short(address: string): string {
  return address.length <= 16 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`;
}

/**
 * As seis ações do frame. As três primeiras e o `connect` já têm destino;
 * `withdraw` e `deposit` continuam inertes porque ainda não têm tela.
 */
const ACTIONS: (PanelItem & { href?: '/wallet' | '/transactions' | '/history' })[] = [
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
  {
    key: 'connect',
    Icon: IconClipboard,
    title: 'Connect Wallet',
    subtitle: 'ARC - Solana - Stellar - USDC',
  },
  { key: 'withdraw', Icon: IconDownload, title: 'Withdraw', subtitle: 'Withdraw funds to wallet' },
  { key: 'deposit', Icon: IconUpload, title: 'Deposit', subtitle: 'Add funds to account' },
];

export function ProfileMenu({ visible, onDismiss, walletAddress, onConnectWallet }: ProfileMenuProps) {
  const router = useRouter();
  const { disconnect } = usePrivyWallet();

  return (
    <DropdownPanel visible={visible} onDismiss={onDismiss}>
      <View style={styles.identity}>
        <View style={styles.avatar}>
          <IconUser size={26} sw={2} color={Colors.light.card} />
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
          <IconWallet size={16} color={Colors.light.accent} />
          <Text style={styles.connectLabel}>Connect Wallet</Text>
        </Pressable>
      )}
    </DropdownPanel>
  );
}

/** Copia o endereço completo (não o abreviado) pro clipboard. */
function CopyAddressButton({ address }: { address: string }) {
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
        <IconCheck size={16} color={Colors.light.success} />
      ) : (
        <IconClipboard size={16} color={Colors.light.ink3} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  copyButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: Colors.light.bg,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.accent,
  },
  identityText: { flex: 1 },
  handle: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.light.ink },
  userId: { fontFamily: Fonts.sans, fontSize: 11, color: Colors.light.ink2, marginTop: 1 },

  connect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two - 2,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.accentSoft,
    marginTop: Spacing.one,
  },
  connectLabel: { fontFamily: Fonts.bold, fontSize: 12, color: Colors.light.ink },
  pressed: { opacity: 0.6 },
});
