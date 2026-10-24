import { useEffect, useRef, useState } from 'react';

/**
 * Interpola uma lista de números do valor mostrado até o novo alvo — é o que
 * faz o donut "se transformar" e o total "contar" quando o filtro muda.
 *
 * Por que não `Animated`: o que muda aqui são atributos de SVG
 * (`strokeDasharray`) e texto, que o driver nativo não anima; e as fatias e o
 * total precisam andar juntos, quadro a quadro, a partir do mesmo valor.
 * São poucos números por ~0,5 s — `requestAnimationFrame` dá conta.
 *
 * Parte sempre do que está **na tela**, não do alvo anterior: trocar de filtro
 * no meio de uma animação continua do ponto em que ela estava, sem salto.
 */
export function useTweenedValues(
  target: number[],
  { duration = 480, disabled = false }: { duration?: number; disabled?: boolean } = {},
): number[] {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  // O alvo entra pelo ref, e o efeito depende da *chave* dele: um array novo a
  // cada render com os mesmos números não pode reiniciar a animação.
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });
  const key = target.join('|');

  useEffect(() => {
    const to = targetRef.current;
    if (disabled) {
      shownRef.current = to;
      return;
    }
    const from = shownRef.current;
    // Já está lá (ex.: a primeira montagem) — nada a animar.
    if (to.length === from.length && to.every((value, i) => value === from[i])) return;
    let start: number | null = null;
    let frame = 0;

    const tick = (now: number) => {
      start ??= now;
      const progress = Math.min(1, (now - start) / duration);
      // Desacelera no fim (ease-out cúbico): chega firme, não freia seco.
      const eased = 1 - (1 - progress) ** 3;
      const next = to.map((value, i) => (from[i] ?? 0) + (value - (from[i] ?? 0)) * eased);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [key, disabled, duration]);

  // Com movimento reduzido, o alvo direto — sem passar por estado intermediário.
  return disabled ? target : shown;
}
