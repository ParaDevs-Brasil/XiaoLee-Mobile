import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Cursor-reactive dot matrix on a canvas (after React Bits "Dot Grid" and Magic UI "Interactive Grid Pattern").
 * Under a mouse pointer a pink pool of light follows the cursor; dots inside it swell, turn magenta with a rose halo
 * and are pushed aside, then cool off slowly so a sweep leaves a comet trail. A click sends a shock through the field.
 * The loop runs only while something is still moving and the canvas is on screen, so at rest it costs nothing and is
 * just a crisp dot grid, which is also what touch and reduced-motion users get.
 *
 * `fade` replaces a CSS mask: the grid is only drawn near that point at rest (so the page keeps its quiet look), but
 * the cursor lights dots up anywhere, which a CSS mask would have hidden.
 */

const TAU = Math.PI * 2;
const REST_ALPHA = 0.12;
const LIT_ALPHA = 0.4; // opacity of everything the cursor lights up (pool, halos, magenta dots); the resting grid is untouched
const BUCKETS = 8;
const SHOCK_REACH = 260;

type RGB = [number, number, number];
type Fade = { x: number; y: number; r: number }; // x/y as 0-1 fractions of the canvas, r in px

const rgb = (token: string, fallback: RGB): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(token.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

type Props = { gap?: number; size?: number; reach?: number; fade?: Fade; className?: string };

export function DotField({ gap = 28, size = 1, reach = 190, fade, className }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;

    const css = getComputedStyle(document.documentElement);
    const ink = rgb(css.getPropertyValue("--color-ink"), [26, 25, 23]);
    const hot = rgb(css.getPropertyValue("--color-accent"), [200, 24, 111]);
    const rose = rgb(css.getPropertyValue("--color-rose"), [247, 201, 224]);

    let w = 0, h = 0, n = 0;
    let hx = new Float32Array(0); // home
    let hy = new Float32Array(0);
    let ox = new Float32Array(0); // offset from home
    let oy = new Float32Array(0);
    let vx = new Float32Array(0); // velocity
    let vy = new Float32Array(0);
    let heat = new Float32Array(0); // 0 at rest, 1 under the cursor
    let rest = new Float32Array(0); // resting opacity of each dot (the fade)
    let bucket = new Uint8Array(0); // rest opacity, quantised so resting dots can be filled in a few batches
    let px = 0, py = 0; // pointer
    let ax = 0, ay = 0, aura = 0; // the pink pool lags the pointer a little, which is what makes it feel liquid
    let near = false, visible = false, raf = 0, last = 0;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      if (aura > 0.01) {
        const R = reach * 1.9;
        const g = ctx.createRadialGradient(ax, ay, 0, ax, ay, R);
        const a = Math.min(1, aura);
        g.addColorStop(0, `rgba(${hot[0]},${hot[1]},${hot[2]},${0.17 * a * LIT_ALPHA})`);
        g.addColorStop(0.38, `rgba(${rose[0]},${rose[1]},${rose[2]},${0.55 * a * LIT_ALPHA})`);
        g.addColorStop(1, `rgba(${rose[0]},${rose[1]},${rose[2]},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(ax - R, ay - R, R * 2, R * 2);
      }

      for (let b = 0; b < BUCKETS; b++) {
        ctx.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${(REST_ALPHA * (b + 0.5)) / BUCKETS})`;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (bucket[i] !== b || heat[i] > 0.02) continue;
          const x = hx[i] + ox[i];
          const y = hy[i] + oy[i];
          ctx.moveTo(x + size, y);
          ctx.arc(x, y, size, 0, TAU);
        }
        ctx.fill();
      }

      for (let i = 0; i < n; i++) {
        const t = heat[i];
        if (t <= 0.02) continue;
        const k = Math.min(1, t * 1.7);
        const x = hx[i] + ox[i];
        const y = hy[i] + oy[i];
        const r = size + t * 3.6;
        if (k > 0.3) {
          ctx.fillStyle = `rgba(${rose[0]},${rose[1]},${rose[2]},${0.42 * k * LIT_ALPHA})`;
          ctx.beginPath();
          ctx.arc(x, y, r * 2.5, 0, TAU);
          ctx.fill();
        }
        const cr = (ink[0] + (hot[0] - ink[0]) * k) | 0;
        const cg = (ink[1] + (hot[1] - ink[1]) * k) | 0;
        const cb = (ink[2] + (hot[2] - ink[2]) * k) | 0;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${rest[i] * (1 - k) + k * 0.95 * LIT_ALPHA})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
    };

    const build = () => {
      const r = cv.getBoundingClientRect();
      w = r.width;
      h = r.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.ceil(w / gap) + 1;
      const rows = Math.ceil(h / gap) + 1;
      n = cols * rows;
      hx = new Float32Array(n); hy = new Float32Array(n);
      ox = new Float32Array(n); oy = new Float32Array(n);
      vx = new Float32Array(n); vy = new Float32Array(n);
      heat = new Float32Array(n);
      rest = new Float32Array(n);
      bucket = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i % cols) * gap + gap / 2;
        const y = Math.floor(i / cols) * gap + gap / 2;
        hx[i] = x;
        hy[i] = y;
        const f = fade ? Math.max(0, 1 - Math.hypot(x - fade.x * w, y - fade.y * h) / fade.r) : 1;
        rest[i] = REST_ALPHA * f;
        bucket[i] = f > 0.02 ? Math.min(BUCKETS - 1, Math.floor(f * BUCKETS)) : 255; // 255: never drawn at rest
      }
      draw();
    };

    /** One physics step, scaled by elapsed frames so 60 and 120 Hz screens feel the same. Returns the field's leftover energy. */
    const step = (s: number) => {
      const damp = Math.pow(0.84, s);
      const spring = 0.075 * s;
      const attack = Math.min(1, 0.3 * s);
      const release = Math.min(1, 0.032 * s); // slow cool-off: the trail behind the cursor
      let energy = 0;
      for (let i = 0; i < n; i++) {
        let target = 0;
        if (near) {
          const dx = hx[i] - px;
          const dy = hy[i] - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < reach * reach) {
            const d = Math.sqrt(d2) || 1;
            const f = 1 - d / reach;
            target = Math.min(1, f * 1.15);
            const push = f * f * 0.95 * s;
            vx[i] += (dx / d) * push;
            vy[i] += (dy / d) * push;
          }
        }
        vx[i] = (vx[i] - ox[i] * spring) * damp;
        vy[i] = (vy[i] - oy[i] * spring) * damp;
        ox[i] += vx[i] * s;
        oy[i] += vy[i] * s;
        heat[i] += (target - heat[i]) * (target > heat[i] ? attack : release);
        energy += Math.abs(ox[i]) + Math.abs(oy[i]) + Math.abs(vx[i]) + Math.abs(vy[i]) + heat[i];
      }
      aura += ((near ? 1 : 0) - aura) * Math.min(1, 0.09 * s);
      ax += (px - ax) * Math.min(1, 0.2 * s);
      ay += (py - ay) * Math.min(1, 0.2 * s);
      return energy;
    };

    const frame = (now: number) => {
      raf = 0;
      const s = Math.min(now - (last || now), 50) / 16.667 || 1;
      last = now;
      const energy = step(s);
      draw();
      if (visible && (near || aura > 0.01 || energy > n * 0.004)) raf = requestAnimationFrame(frame);
      else last = 0;
    };
    const wake = () => { if (!raf && visible) raf = requestAnimationFrame(frame); };

    const shock = (x: number, y: number) => {
      for (let i = 0; i < n; i++) {
        const dx = hx[i] - x;
        const dy = hy[i] - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > SHOCK_REACH) continue;
        const f = 1 - d / SHOCK_REACH;
        const k = (f * f * 11) / (d || 1);
        vx[i] += dx * k;
        vy[i] += dy * k;
        heat[i] = Math.max(heat[i], f);
      }
      aura = 1.5;
    };

    const locate = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      const wasNear = near;
      px = e.clientX - r.left;
      py = e.clientY - r.top;
      near = px > -reach && px < w + reach && py > -reach && py < h + reach;
      if (near && !wasNear) { ax = px; ay = py; } // enter where the pointer is, not from wherever the pool last was
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      locate(e);
      if (near) wake();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if ((e.target as Element | null)?.closest("a, button, input, textarea, select, [role=switch]")) return;
      locate(e);
      if (!near) return;
      shock(px, py);
      wake();
    };
    const onLeave = () => { near = false; };

    const ro = new ResizeObserver(build);
    ro.observe(cv);
    if (reduced) return () => ro.disconnect();

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) wake();
      else near = false;
    });
    io.observe(cv);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
    // `fade` is read through its fields so a fresh object literal from the parent does not rebuild the field each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gap, size, reach, fade?.x, fade?.y, fade?.r, reduced]);

  return <canvas ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
}
