import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * "Reduzir movimento" do aparelho, ao vivo — muda se a pessoa trocar a
 * configuração com o app aberto.
 *
 * Nasce `false` e só vira `true` depois da leitura assíncrona: no pior caso a
 * primeira animação roda antes da resposta, o que é aceitável; nasceria
 * errado o contrário (travar animação de quem não pediu).
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Aplicado dentro do `then`, não no corpo do efeito — mesmo acordo do
    // `use-wallet` com o React Compiler.
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!cancelled) setReduce(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return reduce;
}
