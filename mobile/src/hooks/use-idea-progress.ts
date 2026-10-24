import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ideasStorageKey, parseDone, toggleDone } from '@/lib/report-ideas';

/**
 * Quais ideias do relatório o creator já marcou como feitas, guardado no
 * aparelho (`AsyncStorage`) — ver `lib/report-ideas.ts`.
 *
 * Nunca derruba a tela: se ler ou gravar falhar, a marcação vale só até fechar
 * o relatório. É um lembrete pessoal, não um dado que valha um erro na tela.
 */
export function useIdeaProgress(reportId: number, total: number) {
  const [done, setDone] = useState<number[]>([]);
  // Espelho do estado para o `toggle` calcular o próximo valor fora do render —
  // gravar no storage dentro de um updater de `setState` rodaria duas vezes no
  // modo estrito.
  const latest = useRef<number[]>([]);

  useEffect(() => {
    if (total <= 0) return;
    let cancelled = false;
    AsyncStorage.getItem(ideasStorageKey(reportId))
      .then((raw) => {
        if (cancelled) return;
        const saved = parseDone(raw, total);
        latest.current = saved;
        setDone(saved);
      })
      .catch(() => {
        // Sem leitura, começa sem nada marcado.
      });
    return () => {
      cancelled = true;
    };
  }, [reportId, total]);

  const toggle = useCallback(
    (index: number) => {
      const next = toggleDone(latest.current, index);
      latest.current = next;
      setDone(next);
      AsyncStorage.setItem(ideasStorageKey(reportId), JSON.stringify(next)).catch(() => {
        // Sem gravação, a marcação dura só enquanto o relatório está aberto.
      });
    },
    [reportId],
  );

  return { done, toggle };
}
