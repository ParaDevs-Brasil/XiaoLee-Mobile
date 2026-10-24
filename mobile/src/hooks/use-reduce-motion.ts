import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * "Reduzir movimento" do aparelho, ao vivo — muda se a pessoa trocar a
 * configuração com o app aberto.
 *
 * Nasce com o último valor lido (`false` na primeira vez) e só muda depois da
 * leitura assíncrona: no pior caso a primeira animação roda antes da resposta,
 * o que é aceitável; nasceria errado o contrário (travar animação de quem não
 * pediu).
 *
 * A leitura e o ouvinte do sistema são únicos para o app todo: o hook roda em
 * dezenas de componentes por tela (cada linha de voz usa uns dez), e uma chamada
 * nativa por instância pesava na abertura das folhas.
 */
let current = false;
let started = false;
const subscribers = new Set<() => void>();

function set(value: boolean) {
  if (value === current) return;
  current = value;
  subscribers.forEach((fn) => fn());
}

function subscribe(onChange: () => void) {
  if (!started) {
    started = true;
    AccessibilityInfo.isReduceMotionEnabled().then(set);
    AccessibilityInfo.addEventListener('reduceMotionChanged', set);
  }
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, () => current);
}
