import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { listNotifications } from '@/api/backend';
import { useSession } from '@/hooks/use-session';

/** Intervalo entre buscas enquanto a tela está em foco. */
const POLL_MS = 30_000;

/**
 * Contagem para o badge do sino no `HeaderBar` — mesmo critério de
 * "pendente" que `notifications.tsx` já usa (`status !== 'delivered'`
 * conta), sem o resto do estado da tela (filtro, ack, etc.).
 *
 * Busca ao ganhar foco (voltar da lista de notificações já mostra o número
 * novo, depois de um ack) e repete a cada `POLL_MS` enquanto a tela está
 * visível, então uma notificação nova aparece sem reabrir o app. Ao perder o
 * foco o intervalo para.
 *
 * É status de **entrega**, não de leitura: o backend não tem conceito de
 * "lida" (`NotificationEvent` não tem `read`/`read_at`) — este é o proxy
 * mais rápido com o que já existe, não a contagem "correta" de não-lidas.
 * "Zerar" significa dar *Acknowledge* na lista.
 */
export function useUnreadNotificationsCount(): number {
  const { hasSession } = useSession();
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      // Sem sessão não há o que buscar (a rota resolveria 401) — a contagem
      // sai zerada pelo `return` do fim da função, sem `setState` síncrono
      // aqui (regra `react-hooks/set-state-in-effect`).
      if (!hasSession) return;
      let active = true;
      const load = () => {
        listNotifications()
          .then((items) => {
            if (active) setCount(items.filter((item) => item.status !== 'delivered').length);
          })
          .catch(() => {
            // Badge não é crítico o bastante para mostrar erro — mantém o último valor.
          });
      };
      load();
      const timer = setInterval(load, POLL_MS);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [hasSession]),
  );

  // `count` pode ficar com um valor de uma sessão anterior por um instante
  // entre o logout e este hook reagir — forçar 0 aqui em vez de no efeito
  // evita o `setState` síncrono e já cobre esse instante de qualquer jeito.
  return hasSession ? count : 0;
}
