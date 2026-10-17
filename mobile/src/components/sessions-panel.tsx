import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { createChatSession } from '@/api/backend';
import { DropdownPanel, PanelRow } from '@/components/dropdown-panel';
import { IconClock, IconEdit } from '@/components/icons';
import { Fonts, Spacing } from '@/constants/theme';
import { makeStyles } from '@/hooks/use-theme';
import { useChatSession } from '@/hooks/use-chat-session';
import { refreshChatSessions, setActiveChatSessionId } from '@/lib/chat-session';
import { timeAgo } from '@/lib/format';

/**
 * Painel de escolha aberto pelo botão "New chat" do `AssistantHeader` — a
 * pessoa decide explicitamente entre começar uma conversa nova (primeira
 * linha) ou reabrir uma das existentes. Nenhuma sessão é criada só de tocar
 * no botão: era o que acontecia no desenho anterior (botão dividido) e
 * poluía a lista quando o toque errava o alvo pequeno do chevron.
 *
 * Mesmo molde de `nav-menu.tsx`/`profile-menu.tsx` sobre `DropdownPanel`,
 * ancorado no botão em vez do canto do header global (ver `anchor`).
 */

interface SessionsPanelProps {
  visible: boolean;
  onDismiss: () => void;
  anchor?: { top: number; right: number };
}

export function SessionsPanel({ visible, onDismiss, anchor }: SessionsPanelProps) {
  const styles = useStyles();
  const { sessions } = useChatSession();
  const [creating, setCreating] = useState(false);

  // Busca a lista ao abrir — não há um lugar melhor de disparar isto uma vez
  // por processo (a tela de chat não sabe quando o painel abre).
  useEffect(() => {
    if (visible) void refreshChatSessions();
  }, [visible]);

  async function handleNewChat() {
    if (creating) return;
    onDismiss();
    setCreating(true);
    try {
      const session = await createChatSession();
      setActiveChatSessionId(session.id);
      void refreshChatSessions();
    } finally {
      setCreating(false);
    }
  }

  return (
    <DropdownPanel visible={visible} onDismiss={onDismiss} anchor={anchor}>
      <PanelRow
        item={{ key: 'new-chat', Icon: IconEdit, title: 'New chat', onPress: handleNewChat }}
      />
      {sessions.length === 0 ? (
        <Text style={styles.empty}>No conversations yet</Text>
      ) : (
        sessions.map((session) => (
          <PanelRow
            key={session.id}
            item={{
              key: String(session.id),
              Icon: IconClock,
              title: session.title,
              subtitle: timeAgo(session.updated_at),
              onPress: () => {
                setActiveChatSessionId(session.id);
                onDismiss();
              },
            }}
          />
        ))
      )}
    </DropdownPanel>
  );
}

const useStyles = makeStyles((colors) => ({
  empty: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: colors.ink2,
    paddingVertical: Spacing.one,
  },
}));
