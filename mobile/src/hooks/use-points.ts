import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { getMyProfile } from '@/api/backend';
import { useSession } from '@/hooks/use-session';

/** Saldo de pontos (campanhas de pontos) para o selo do `HeaderBar`. Atualiza ao ganhar foco; 0 sem sessão. */
export function usePoints(): number {
  const { hasSession } = useSession();
  const [points, setPoints] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!hasSession) return;
      let active = true;
      getMyProfile()
        .then((p) => {
          if (active) setPoints(p.points ?? 0);
        })
        .catch(() => {
          // Selo não é crítico: mantém o último valor.
        });
      return () => {
        active = false;
      };
    }, [hasSession]),
  );

  return hasSession ? points : 0;
}
