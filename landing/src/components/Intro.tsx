import { useEffect, useRef, useState } from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import { RadialWaves, type WaveControl } from "@/components/ui/radial-waves";

const KEY = "xl-intro";
const HOLD = 2.3; // seconds of waves before the camera dives
const DIVE = 1.35; // seconds of the dive; the page is revealed in its last stretch

/** First visit of a session only (or `?intro` to force it); never for reduced motion. */
export function shouldPlayIntro() {
  try {
    if (/[?&]intro\b/.test(location.search)) return true;
    if (sessionStorage.getItem(KEY)) return false;
  } catch { /* storage blocked: play it */ }
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Splash on entry: Xiaolee fades in on a pink sky of stars while radial waves swell out from her silhouette to the edges of the
 * screen, then the camera dives into the middle of them and lands on the page. `onExit` fires as the dive nears its end so the hero can begin its own sequence
 * underneath; Esc, click or tap skips straight to that.
 */
export function Intro({ onExit }: { onExit: () => void }) {
  const reduced = useReducedMotion();
  const control = useRef<WaveControl>({ energy: 0, burst: 0, pop: 0, zoom: 1 });
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const left = useRef(false);

  const leave = () => {
    if (left.current) return;
    left.current = true;
    try { sessionStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setLeaving(true);
    // the camera dives into the middle of the waves; the page appears as the rings rush past
    animate(1, 11, { duration: DIVE, ease: [0.55, 0, 0.85, 0.35], onUpdate: (v) => { control.current.zoom = v; } });
    animate(0, 1, { duration: 0.8, onUpdate: (v) => { control.current.burst = v; } });
    setTimeout(onExit, (DIVE - 0.5) * 1000);
  };

  useEffect(() => {
    if (reduced) { leave(); setGone(true); return; }
    const pop = animate(0, 1, { duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.15, onUpdate: (v) => { control.current.pop = v; } });
    const swell = animate(0, 1, { duration: 1.8, ease: [0.16, 1, 0.3, 1], delay: 0.35, onUpdate: (v) => { control.current.energy = v; } });
    const hold = /[?&]intro=hold\b/.test(location.search); // dev: keep the waves on screen
    const timer = hold ? 0 : setTimeout(leave, HOLD * 1000);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") leave(); };
    window.addEventListener("keydown", key);
    document.documentElement.style.overflow = "hidden";
    return () => { pop.stop(); swell.stop(); clearTimeout(timer); window.removeEventListener("keydown", key); document.documentElement.style.overflow = ""; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (gone) document.documentElement.style.overflow = ""; }, [gone]);
  if (gone) return null;

  return (
    <motion.div
      role="presentation"
      onClick={leave}
      initial={false}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.55, ease: "easeIn", delay: leaving ? DIVE - 0.55 : 0 }}
      onAnimationComplete={() => { if (leaving) setGone(true); }}
      className="fixed inset-0 z-[200] cursor-pointer bg-cream"
    >
      <RadialWaves src="/mascot/xiaolee-cutout.webp" control={control} className="absolute inset-0 h-full w-full" />
    </motion.div>
  );
}
