import { type CSSProperties, type MouseEvent, type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import { cn } from "@/lib/utils";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** Beam position (% across) for a pointer at `u` (0 to 1). */
const beamTarget = (u: number) => 30 + 52 * clamp(u, 0, 1);
/** The beam's idle sway: two slow, unrelated sines so it never visibly loops. */
const drift = (t: number) => 58 + 9 * (0.7 * Math.sin(t * 0.21) + 0.3 * Math.sin(t * 0.077 + 1.3));
/** Frame-rate independent ease toward a target; `k` is the fraction closed per 1/60s. */
const approach = (from: number, to: number, k: number, dt: number) => to + (from - to) * Math.pow(1 - clamp(k, 0, 1), clamp(dt, 0, 0.1) * 60);

/**
 * Oversized footer wordmark (after the "Beam Wordmark Footer" from 21st.dev, restyled for the Xiaolee palette).
 * A faint ghost of the word sits in the logo face; a slow diagonal shaft of light drifts through the letters on its
 * own and leans toward the pointer, which also carries a soft glow. Letters rise in the first time the footer is seen,
 * lift on hover and hop on click. Every letter paints the same container-sized beam, shifted back by its own offset,
 * so the light reads as one shaft passing through the whole word.
 * The beam writes CSS variables from a rAF loop (only while on screen), so it never re-renders React.
 * Decorative: hidden from assistive tech.
 */
export function WordmarkReveal({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const ptr = useRef({ u: 0.5, x: 0, y: 0, inside: false });
  const live = useInView(ref, { margin: "80px 0px" });
  const [seen, setSeen] = useState(false);
  const [reduced, setReduced] = useState(false);
  const letters = Array.from(text);

  useEffect(() => { if (live) setSeen(true); }, [live]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Tell every letter where it sits inside the box so its slice of the beam lines up with its neighbours.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const place = () => {
      root.style.setProperty("--wm-rw", `${root.offsetWidth}px`);
      root.style.setProperty("--wm-rh", `${root.offsetHeight}px`);
      root.querySelectorAll<HTMLElement>(".wm-l").forEach((s) => {
        // offsetLeft/Top ignore the rise translate, so the beam is aligned while the letters are still moving.
        let x = 0, y = 0;
        let el: HTMLElement | null = s;
        while (el && el !== root) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent as HTMLElement | null; }
        s.style.setProperty("--wm-x", `${x}px`);
        s.style.setProperty("--wm-y", `${y}px`);
      });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(root);
    document.fonts?.ready.then(place);
    return () => ro.disconnect();
  }, [text]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const set = (b: number, px: number, py: number, g: number) => {
      root.style.setProperty("--wm-b", `${b.toFixed(2)}%`);
      root.style.setProperty("--wm-px", `${px.toFixed(1)}px`);
      root.style.setProperty("--wm-py", `${py.toFixed(1)}px`);
      root.style.setProperty("--wm-g", g.toFixed(3));
    };
    if (reduced) { set(58, 0, 0, 0); return; }
    if (!live) return;
    let raf = 0;
    let last = performance.now();
    let t = last / 1000;
    let b = 58, px = ptr.current.x, py = ptr.current.y, g = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;
      const p = ptr.current;
      const idle = drift(t);
      b = approach(b, p.inside ? beamTarget(p.u) * 0.75 + idle * 0.25 : idle, 0.035, dt);
      px = approach(px, p.x, 0.16, dt);
      py = approach(py, p.y, 0.16, dt);
      g = approach(g, p.inside ? 1 : 0, 0.06, dt);
      set(b, px, py, g);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, reduced]);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = ptr.current;
    p.x = e.clientX - r.left;
    p.y = e.clientY - r.top;
    p.u = r.width ? p.x / r.width : 0.5;
    p.inside = true;
  };
  const onLeave = () => { ptr.current.inside = false; };

  const hop = (e: MouseEvent<HTMLSpanElement>) => {
    if (reduced) return;
    const el = e.currentTarget;
    el.classList.remove("is-hop");
    void el.offsetWidth;
    el.classList.add("is-hop");
  };

  return (
    <div
      ref={ref} aria-hidden data-in={seen || reduced ? "true" : "false"}
      onPointerMove={onMove} onPointerLeave={onLeave}
      className={cn("wm", className)}
    >
      {letters.map((ch, i) => (
        <span key={i} className="wm-lw" style={{ "--wm-d": `${i * 75}ms` } as CSSProperties}>
          <span className="wm-l" onClick={hop} onAnimationEnd={(e) => e.currentTarget.classList.remove("is-hop")}>{ch}</span>
        </span>
      ))}
    </div>
  );
}
