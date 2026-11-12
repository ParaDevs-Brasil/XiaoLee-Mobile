import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Soft cursor glow with a sparkle trail, for the hero background. Under a mouse pointer a rose-and-magenta pool of
 * light follows the cursor with a little lag, and fast movement sheds small four-point stars that drift down and
 * fade. A film-grain overlay keeps the glow from banding. The loop runs only while the pointer is near or a sparkle
 * is still alive and the canvas is on screen, so at rest it costs nothing. Touch and reduced-motion users get the
 * grain only.
 */

const MAX_SPARKLES = 20;
const SPAWN_EVERY = 30; // px of pointer travel per sparkle
const TAU = Math.PI * 2;

type RGB = [number, number, number];
type Sparkle = { x: number; y: number; vx: number; vy: number; life: number; ttl: number; size: number; rot: number; spin: number; hot: boolean };

const rgb = (token: string, fallback: RGB): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(token.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// feTurbulence noise as a tile, so the grain costs one image decode and no per-frame work
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

export function SparkleField({ reach = 230, className }: { reach?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx || reduced) return;

    // Colors follow the theme: read again whenever data-theme changes (they were cached once and stayed dark-theme
    // magenta after switching to light, which painted a muddy blob).
    let hot: RGB = [200, 24, 111];
    let rose: RGB = [247, 201, 224];
    const readColors = () => {
      const css = getComputedStyle(document.documentElement);
      hot = rgb(css.getPropertyValue("--accent"), hot);
      rose = rgb(css.getPropertyValue("--rose"), rose);
    };
    readColors();
    const themeWatch = new MutationObserver(() => { readColors(); draw(); });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    let w = 0, h = 0;
    let px = 0, py = 0, ax = 0, ay = 0, aura = 0, travelled = 0;
    let near = false, visible = false, raf = 0, last = 0;
    const sparkles: Sparkle[] = [];

    const star = (x: number, y: number, r: number, rot: number) => {
      // four-point star: concave sides pulled toward the centre
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.quadraticCurveTo(0, 0, 0, r);
      ctx.quadraticCurveTo(0, 0, -r, 0);
      ctx.quadraticCurveTo(0, 0, 0, -r);
      ctx.fill();
      ctx.restore();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      if (aura > 0.01) {
        const a = Math.min(1, aura);
        const R = reach * 1.6;
        const g = ctx.createRadialGradient(ax, ay, 0, ax, ay, R);
        g.addColorStop(0, `rgba(${hot[0]},${hot[1]},${hot[2]},${0.22 * a})`);
        g.addColorStop(0.4, `rgba(${rose[0]},${rose[1]},${rose[2]},${0.75 * a})`);
        g.addColorStop(1, `rgba(${rose[0]},${rose[1]},${rose[2]},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(ax - R, ay - R, R * 2, R * 2);
      }
      for (const s of sparkles) {
        const t = s.life / s.ttl; // 0 -> 1
        const twinkle = Math.sin(t * Math.PI); // grows in, shrinks out
        const c = s.hot ? hot : rose;
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.9 * twinkle})`;
        star(s.x, s.y, s.size * (0.4 + 0.6 * twinkle), s.rot);
      }
    };

    const frame = (now: number) => {
      raf = 0;
      const k = Math.min(now - (last || now), 50) / 16.667 || 1;
      last = now;
      aura += ((near ? 1 : 0) - aura) * Math.min(1, 0.08 * k);
      ax += (px - ax) * Math.min(1, 0.14 * k);
      ay += (py - ay) * Math.min(1, 0.14 * k);
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const s = sparkles[i];
        s.life += k;
        s.x += s.vx * k;
        s.y += s.vy * k;
        s.vy += 0.012 * k;
        s.rot += s.spin * k;
        if (s.life >= s.ttl) sparkles.splice(i, 1);
      }
      draw();
      if (visible && (near || aura > 0.01 || sparkles.length)) raf = requestAnimationFrame(frame);
      else last = 0;
    };
    const wake = () => { if (!raf && visible) raf = requestAnimationFrame(frame); };

    const resize = () => {
      const r = cv.getBoundingClientRect();
      w = r.width;
      h = r.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = cv.getBoundingClientRect();
      const nx = e.clientX - r.left;
      const ny = e.clientY - r.top;
      const wasNear = near;
      near = nx > -reach && nx < w + reach && ny > -reach && ny < h + reach;
      if (near && !wasNear) { ax = nx; ay = ny; } else if (near) {
        travelled += Math.hypot(nx - px, ny - py);
        while (travelled > SPAWN_EVERY && sparkles.length < MAX_SPARKLES) {
          travelled -= SPAWN_EVERY;
          sparkles.push({
            x: nx + (Math.random() - 0.5) * 28, y: ny + (Math.random() - 0.5) * 28,
            vx: (Math.random() - 0.5) * 0.5, vy: -0.25 - Math.random() * 0.35,
            life: 0, ttl: 55 + Math.random() * 35, size: 4 + Math.random() * 5,
            rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 0.05, hot: Math.random() < 0.55,
          });
        }
        travelled = Math.min(travelled, SPAWN_EVERY);
      }
      px = nx;
      py = ny;
      if (near) wake();
    };
    const onLeave = () => { near = false; };

    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) wake();
      else near = false;
    });
    io.observe(cv);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      themeWatch.disconnect();
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [reach, reduced]);

  return (
    <>
      <canvas ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full", className)} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.03] mix-blend-soft-light"
        style={{ backgroundImage: GRAIN }}
      />
    </>
  );
}
