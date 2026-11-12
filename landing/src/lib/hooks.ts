import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";

/** Types each phrase, holds, erases, moves on. Static first phrase for reduced motion. */
export function useTypewriter(phrases: string[], { type = 48, erase = 24, hold = 1700 } = {}) {
  const reduced = useReducedMotion();
  const [text, setText] = useState(reduced ? phrases[0] : "");
  const idx = useRef(0);

  useEffect(() => {
    if (reduced) { setText(phrases[0]); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    idx.current = 0;
    const run = (phase: "type" | "erase", n: number) => {
      if (cancelled) return;
      const full = phrases[idx.current % phrases.length];
      if (phase === "type") {
        setText(full.slice(0, n));
        if (n < full.length) timer = setTimeout(() => run("type", n + 1), type + Math.random() * 40);
        else timer = setTimeout(() => run("erase", full.length), hold);
      } else {
        setText(full.slice(0, n));
        if (n > 0) timer = setTimeout(() => run("erase", n - 1), erase);
        else { idx.current += 1; timer = setTimeout(() => run("type", 1), 280); }
      }
    };
    run("type", 1);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [phrases, reduced, type, erase, hold]);

  return text;
}

/** True while the element is near the viewport. Loops hang their play state off it (see [data-live] in index.css) so nothing animates unseen. */
export function useLive<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const live = useInView(ref, { margin: "120px 0px" });
  return { ref, live };
}

/**
 * Steps 0..count through a scripted sequence while the element is on screen, then
 * pauses at the end and restarts. `delays[i]` is the wait before step i+1 appears.
 *
 * `delays` is read through a ref on purpose: callers pass array literals, and a new array each render used to
 * restart the effect on every step, so the demo snapped back to step 0 and looked frozen.
 */
export function useSequence(count: number, delays: number[], restartAfter = 3600) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { margin: "-10% 0px" });
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const waits = useRef(delays);
  useEffect(() => { waits.current = delays; });

  useEffect(() => {
    if (reduced) { setStep(count); return; }
    if (!inView) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const go = (i: number) => {
      if (cancelled) return;
      setStep(i);
      if (i < count) timer = setTimeout(() => go(i + 1), waits.current[i] ?? 900);
      else timer = setTimeout(() => go(0), restartAfter);
    };
    go(0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [inView, reduced, count, restartAfter]);

  return { ref, step };
}
