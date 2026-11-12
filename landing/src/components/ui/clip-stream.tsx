import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The hero's scene: vertical 9:16 frames, the shape of a clip, fly out of a vanishing point and grow past the viewer.
 * One long video becoming many clips, drawn as a tunnel. Canvas 2D, one draw per frame, no per-frame allocation.
 *
 * - Colors come from the page's own tokens (read again whenever the theme changes), so the scene follows dark/light:
 *   dark adds light ("lighter"), light lays translucent ink over the cream.
 * - It only runs while on screen and while the tab is visible; reduced motion gets one still frame.
 * - The pointer nudges the vanishing point a few percent. Touch devices skip that.
 */

type Rgb = [number, number, number];
type Frame = { a: number; d: number; z: number; v: number; w: number; tint: 0 | 1 | 2 };

const ASPECT = 16 / 9;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function parse(color: string): Rgb {
  const el = document.createElement("canvas").getContext("2d");
  if (!el) return [255, 255, 255];
  el.fillStyle = "#000";
  el.fillStyle = color.trim();
  const v = el.fillStyle; // normalised to #rrggbb or rgba()
  if (v.startsWith("#")) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
  const m = v.match(/[\d.]+/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [255, 255, 255];
}

function palette(): { tints: Rgb[]; dark: boolean } {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const dark = root.dataset.theme !== "light";
  return {
    dark,
    tints: [parse(cs.getPropertyValue("--accent")), parse(cs.getPropertyValue("--violet")), parse(cs.getPropertyValue("--ink"))],
  };
}

export function ClipStream({
  className, cx = 0.5, cy = 0.5, count = 64,
}: { className?: string; cx?: number; cy?: number; count?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = window.matchMedia("(max-width: 767px)").matches;
    const n = small ? Math.round(count * 0.55) : count;

    let w = 0, h = 0, dpr = 1, reach = 1;
    let colors = palette();
    const frames: Frame[] = Array.from({ length: n }, () => ({ a: 0, d: 0, z: 0, v: 0, w: 0, tint: 0 }));
    const seed = (f: Frame, fresh: boolean) => {
      f.a = rand(0, Math.PI * 2);
      f.z = fresh ? rand(0, 1) : 0; // progress 0 (at the vanishing point) to 1 (past the viewer)
      f.v = rand(0.06, 0.13); // progress per second
      f.w = rand(20, 46); // frame width at full scale, px
      const r = Math.random();
      f.tint = r < 0.62 ? 0 : r < 0.9 ? 1 : 2;
    };
    frames.forEach((f) => seed(f, true));

    // pointer offset of the vanishing point, eased
    let px = 0, py = 0, tx = 0, ty = 0;
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      tx = e.clientX / innerWidth - 0.5;
      ty = e.clientY / innerHeight - 0.5;
    };

    const fit = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      reach = Math.hypot(Math.max(cx, 1 - cx) * w, Math.max(cy, 1 - cy) * h);
    };

    const draw = (dt: number) => {
      px += (tx - px) * Math.min(1, dt * 3);
      py += (ty - py) * Math.min(1, dt * 3);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = colors.dark ? "lighter" : "source-over";
      const ox = cx * w + px * w * 0.04;
      const oy = cy * h + py * h * 0.04;

      for (const f of frames) {
        f.z += f.v * dt;
        if (f.z >= 1) seed(f, false);
        const p = f.z;
        const e = p * p * (1.1 + p); // ease-in: slow near the vanishing point, fast past it
        const dist = e * reach * 1.05;
        const s = 0.04 + e * 6.5; // scale of the frame
        const fw = f.w * s, fh = fw * ASPECT;
        // fade in over the first 12% (born at the point), out over the last 14%
        const alpha = Math.min(1, p / 0.12) * Math.min(1, (1 - p) / 0.14);
        if (alpha <= 0.01 || fw < 0.8) continue;
        const [r, g, b] = colors.tints[f.tint];
        const k = colors.dark ? 1 : 0.55;
        ctx.save();
        ctx.translate(ox + Math.cos(f.a) * dist, oy + Math.sin(f.a) * dist);
        ctx.rotate(f.a + Math.PI / 2); // long edge points along the flight path
        const rad = Math.min(fw * 0.16, 14);
        ctx.beginPath();
        ctx.roundRect(-fw / 2, -fh / 2, fw, fh, rad);
        const g1 = ctx.createLinearGradient(0, -fh / 2, 0, fh / 2);
        g1.addColorStop(0, `rgba(${r},${g},${b},${0.0})`);
        g1.addColorStop(1, `rgba(${r},${g},${b},${0.3 * alpha * k})`);
        ctx.fillStyle = g1;
        ctx.fill();
        ctx.lineWidth = Math.max(0.6, fw * 0.035);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.85 * alpha * k})`;
        ctx.stroke();
        ctx.restore();
      }
    };

    fit();
    const ro = new ResizeObserver(() => { fit(); if (reduced) draw(0); });
    ro.observe(canvas);

    const themeWatch = new MutationObserver(() => { colors = palette(); if (reduced) draw(0); });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    if (reduced) {
      draw(0);
      return () => { ro.disconnect(); themeWatch.disconnect(); };
    }

    let raf = 0, last = 0, onScreen = true;
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
      last = t;
      draw(dt);
      raf = requestAnimationFrame(loop);
    };
    const start = () => { if (!raf && onScreen && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const io = new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; onScreen ? start() : stop(); }, { threshold: 0 });
    io.observe(canvas);
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pointermove", onPointer, { passive: true });
    start();

    return () => {
      stop(); io.disconnect(); ro.disconnect(); themeWatch.disconnect();
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pointermove", onPointer);
    };
  }, [cx, cy, count]);

  return <canvas ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
}
