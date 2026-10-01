import { useEffect, useState } from 'react';

import { listNotifications } from '@/api/backend';
import { useSession } from '@/hooks/use-session';

/**
 * Contagem para o badge do sino no `HeaderBar` — mesmo critério de
 * "pendente" que `notifications.tsx` já usa (`status !== 'delivered'`
 * conta), sem o resto do estado da tela (filtro, ack, etc.).
 *
 * É status de **entrega**, não de leitura: o backend não tem conceito de
 * "lida" (`NotificationEvent` não tem `read`/`read_at`) — este é o proxy
 * mais rápido com o que já existe, não a contagem "correta" de não-lidas.
 */
export function useUnreadNotificationsCount(): number {
  const { hasSession } = useSession();
  const [count, setCount] = useState(0);

  useEffect(() => {
    // Sem sessão não há o que buscar (a rota resolveria 401) — a contagem
    // sai zerada pelo `return` do fim da função, sem `setState` síncrono
    // aqui (regra `react-hooks/set-state-in-effect`).
    if (!hasSession) return;
    let active = true;
    listNotifications()
      .then((items) => {
        if (active) setCount(items.filter((item) => item.status !== 'delivered').length);
      })
      .catch(() => {
        // Badge não é crítico o bastante para mostrar erro — some.
      });
    return () => {
      active = false;
    };
  }, [hasSession]);

  // `count` pode ficar com um valor de uma sessão anterior por um instante
  // entre o logout e este hook reagir — forçar 0 aqui em vez de no efeito
  // evita o `setState` síncrono e já cobre esse instante de qualquer jeito.
  return hasSession ? count : 0;
}
