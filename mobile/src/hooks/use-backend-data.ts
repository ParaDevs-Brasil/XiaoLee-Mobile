import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/api/client';
import { useSession } from '@/hooks/use-session';

/**
 * Busca dado do backend com o ciclo que toda tela de lista precisa: primeira
 * carga, erro exibível e recarga manual.
 *
 * Generaliza o que `app/diagnostics.tsx` já fazia à mão. O cuidado que vale
 * preservar dali: `loading` nasce `true` e o resultado só é aplicado dentro do
 * `then`, nunca de forma síncrona no corpo do efeito — o React Compiler (ligado
 * em `app.json`) trata isso como render em cascata (`react-hooks/set-state-in-effect`).
 */

export interface BackendData<T> {
  data: T | null;
  /** Já exibível ao usuário — `ApiError` normaliza a mensagem. */
  error: string | null;
  /** Primeira carga: ainda não há nada na tela para mostrar. */
  loading: boolean;
  /** Recarga com dado já na tela — é o que alimenta o `RefreshControl`. */
  refreshing: boolean;
  reload: () => void;
}

export function useBackendData<T>(
  fetcher: () => Promise<T>,
  options?: { pollMs?: number },
): BackendData<T> {
  // Quem busca é dono do dado de *uma* sessão. Entrar ou sair troca de quem é
  // esse dado, e sem refazer a busca a tela fica com o resultado do usuário
  // anterior: o `[]` que o convidado recebeu seguia na tela depois do login, e
  // a Wallet mostrava zeros onde já havia recompensa.
  const { session, loading: sessionLoading } = useSession();
  // `undefined` = storage ainda não lido. Buscar antes disso mandaria a
  // requisição sem o Bearer e a resposta vazia seria a que ficaria na tela.
  const sessionId = sessionLoading ? undefined : (session?.sessionId ?? null);

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // As telas tendem a passar uma arrow inline. Se `fetcher` entrasse nas
  // dependências do efeito de carga, cada render dispararia uma requisição
  // nova; o ref guarda sempre a última versão sem participar das deps.
  const latest = useRef(fetcher);
  useEffect(() => {
    latest.current = fetcher;
  });

  // Uma resposta que chega depois da tela sair não deve virar setState — além
  // do aviso, sobrescreveria o estado de quem entrou no lugar.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    try {
      const next = await latest.current();
      if (!mounted.current) return;
      setData(next);
      // Sucesso limpa o erro anterior: senão a tela mostraria dado novo com um
      // aviso velho de falha em cima.
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (sessionId === undefined) return;
    run().then(() => {
      if (mounted.current) setLoading(false);
    });
  }, [run, sessionId]);

  // Expo Router usa uma pilha nativa: voltar para uma tela já visitada (ex.
  // Wallet, depois de resgatar uma recompensa em Campaigns) reexibe a mesma
  // instância sem remontar — o efeito acima não roda de novo, e a tela ficava
  // presa no dado de antes do resgate até um pull-to-refresh manual. Refaz a
  // busca a cada vez que a tela ganha foco, silenciosamente (sem `loading`/
  // `refreshing`, que piscariam esqueleto numa tela que já tem conteúdo).
  //
  // Pula o primeiro foco: ele coincide com a montagem, que o efeito de cima já
  // cobre — sem a marca, toda tela buscaria os dados duas vezes ao abrir.
  const skipNextFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (skipNextFocus.current) {
        skipNextFocus.current = false;
        return;
      }
      if (sessionId === undefined) return;
      run();
    }, [run, sessionId]),
  );

  // Saldo on-chain muda por fora do app (claim, transferência recebida) —
  // sem isto só atualizava trocando de tela e voltando (o foco acima). Roda
  // só enquanto a tela está em foco, silenciosa como o refetch por foco, e
  // para sozinha ao sair da tela — sem isso a Wallet continuaria batendo o
  // RPC em segundo plano com a tela invisível.
  const pollMs = options?.pollMs;
  useFocusEffect(
    useCallback(() => {
      if (!pollMs) return;
      const id = setInterval(() => {
        if (sessionId === undefined) return;
        run();
      }, pollMs);
      return () => clearInterval(id);
    }, [run, sessionId, pollMs]),
  );

  const reload = useCallback(() => {
    setRefreshing(true);
    run().then(() => {
      if (mounted.current) setRefreshing(false);
    });
  }, [run]);

  return { data, error, loading, refreshing, reload };
}
