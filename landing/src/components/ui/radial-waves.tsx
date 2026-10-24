import { useEffect, useRef } from "react";

/**
 * Splash scene on one canvas: a pink gradient sky with twinkling stars and hearts, and the silhouette of the
 * character rolling outward as radial waves until they pass the edges of the screen. The silhouette (alpha) is tinted
 * once with a violet-pink-peach gradient and cached; every frame it is stamped RINGS times, largest first, each copy
 * bigger and fainter than the one in front, so the outline of her hair and hand ripples out like a tunnel. `zoom`
 * is the camera: it dives toward her face, the rings rush past, and the stars streak by at their own depth.
 * `energy` (0 to 1) is how far the waves have reached, `burst` speeds them, `pop` fades the character in.
 * No filters in the loop, paused while the tab is hidden.
 */

const TAU = Math.PI * 2;
const RINGS = 9;
const WAVE_STOPS: [number, string][] = [[0, "#8b5cff"], [0.3, "#d84bd0"], [0.55, "#ff4fa3"], [0.78, "#ff8a6b"], [1, "#ffc46b"]];

export type WaveControl = { energy: number; burst: number; pop: number; zoom: number };

type Mote = { x: number; y: number; r: number; depth: number; ph: number; sp: number; kind: 0 | 1 | 2; front: boolean; col: string };

const MOTE_COLORS = ["#ffffff", "#fff3c4", "#ffd9ec", "#ffffff", "#ffe7a8"];

function makeMotes(): Mote[] {
  // deterministic scatter so a resize does not reshuffle the sky
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 70 }, (_, i) => ({
    x: rnd(), y: rnd(), r: 5 + rnd() * 13, depth: 0.15 + rnd() * 0.85, ph: rnd() * TAU, sp: 0.8 + rnd() * 1.6,
    kind: (i % 9 === 0 ? 2 : i % 4 === 0 ? 1 : 0) as 0 | 1 | 2, front: i % 6 === 0, col: MOTE_COLORS[i % MOTE_COLORS.length],
  }));
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const rr = i % 2 ? r * 0.2 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

function heart(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  g.moveTo(x, y + r * 0.9);
  g.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.8, y - r * 1.2, x, y - r * 0.4);
  g.bezierCurveTo(x + r * 0.8, y - r * 1.2, x + r * 1.5, y - r * 0.1, x, y + r * 0.9);
  g.fill();
}

function tint(img: HTMLImageElement, size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, size, size);
  // feather the flat crop edge at the bottom so scaled copies never show a hard horizontal line
  g.globalCompositeOperation = "destination-out";
  const fade = g.createLinearGradient(0, size * 0.78, 0, size);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  g.fillStyle = fade;
  g.fillRect(0, 0, size, size);
  const plain = document.createElement("canvas");
  plain.width = plain.height = size;
  plain.getContext("2d")!.drawImage(c, 0, 0);
  g.globalCompositeOperation = "source-in";
  const grad = g.createLinearGradient(0, 0, size, 0);
  for (const [o, col] of WAVE_STOPS) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const soft = document.createElement("canvas");
  soft.width = soft.height = size;
  const sg = soft.getContext("2d")!;
  if ("filter" in sg) sg.filter = `blur(${Math.round(size / 300)}px)`;
  sg.drawImage(c, 0, 0);
  // a thin light band along the outline: the rim of each ring, so neighbouring rings stay legible on the pink
  const rim = document.createElement("canvas");
  rim.width = rim.height = size;
  const rg = rim.getContext("2d")!;
  // dilate the silhouette (union of shifted copies), paint it white, then cut the silhouette itself out: what is left is an outer outline
  const d = size / 90;
  for (let i = 0; i < 16; i++) rg.drawImage(plain, Math.cos((i * TAU) / 16) * d, Math.sin((i * TAU) / 16) * d);
  rg.globalCompositeOperation = "source-in";
  rg.fillStyle = "#fff";
  rg.fillRect(0, 0, size, size);
  rg.globalCompositeOperation = "destination-out";
  rg.drawImage(plain, 0, 0);
  // no outline along the flat crop at the bottom
  const cut = rg.createLinearGradient(0, size * 0.6, 0, size * 0.85);
  cut.addColorStop(0, "rgba(0,0,0,0)");
  cut.addColorStop(1, "rgba(0,0,0,1)");
  rg.fillStyle = cut;
  rg.fillRect(0, 0, size, size);
  return { wave: soft, plain, rim };
}

export function RadialWaves({ src, control, className }: { src: string; control: React.RefObject<WaveControl>; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    let raf = 0;
    let alive = true;
    let sprites: ReturnType<typeof tint> | null = null;
    let W = 0, H = 0, dpr = 1;
    const motes = makeMotes();

    const img = new Image();
    img.decoding = "async";
    img.onload = () => { sprites = tint(img, 512); };
    img.src = src;

    const fit = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);

    let phase = 0;
    let last = performance.now();
    const t0 = last;

    const drawMotes = (front: boolean, t: number, zoom: number, fx: number, fy: number, a0: number) => {
      for (const m of motes) {
        if (m.front !== front) continue;
        // each mote sits at its own depth: nearer ones travel further when the camera dives
        const z = Math.pow(zoom, m.depth * 0.9 + 0.1);
        const x = fx + (m.x * W - fx) * z;
        const y = fy + (m.y * H - fy) * z;
        if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
        const tw = 0.55 + 0.45 * Math.sin(t * m.sp + m.ph);
        ctx.globalAlpha = a0 * tw * (front ? 0.95 : 0.8);
        ctx.fillStyle = m.col;
        const r = m.r * (0.7 + m.depth * 0.6) * Math.pow(zoom, 0.25);
        if (m.kind === 2) heart(ctx, x, y, r * 0.7);
        else if (m.kind === 1) { ctx.beginPath(); ctx.arc(x, y, r * 0.22, 0, TAU); ctx.fill(); }
        else star(ctx, x, y, r);
      }
    };

    const frame = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const { energy, burst, pop, zoom } = control.current;
      phase = (phase + dt * (0.12 + burst * 0.55)) % 1;
      const t = (now - t0) / 1000;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      const S = Math.min(H * 0.68, W * 0.9, 620);
      const cx = W / 2, top = H * 0.5 - S * 0.4;
      const ax = cx, ay = top + S * 0.7; // rings scale about a point low in the figure: they climb up and out
      const fx = cx, fy = top + S * 0.36; // the camera aims at her face

      // sky: soft light pool behind her, hot pink through the middle, deep berry in the corners
      const R = Math.hypot(W, H) * 0.62;
      const sky = ctx.createRadialGradient(cx, fy, 0, cx, fy, R);
      sky.addColorStop(0, "#ffe6f1");
      sky.addColorStop(0.28, "#ff9ccc");
      sky.addColorStop(0.62, "#e8338a");
      sky.addColorStop(1, "#6a1155");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      if (!sprites) return;

      drawMotes(false, t, zoom, fx, fy, 1);

      // camera: scale the whole scene about her face
      ctx.save();
      ctx.translate(fx, fy);
      ctx.scale(zoom, zoom);
      ctx.translate(-fx, -fy);

      // enough growth for the biggest ring to clear the farthest corner
      const smax = Math.max(1.8, (Math.max(W, H * 1.3) / S) * 1.15);
      // fills first, largest to smallest; the light rims go on top afterwards so inner bands never bury them
      for (const pass of [0, 1]) {
        for (let k = RINGS - 1; k >= 0; k--) {
          const p = (phase + k / RINGS) % 1; // 0 = just born under her, 1 = gone
          const s = 1 + 0.05 + (smax - 1) * Math.pow(p, 1.5) * energy;
          const a = Math.min(1, p * 7) * (1 - Math.pow(p, 2.2)) * energy;
          if (a < 0.004) continue;
          const size = S * s;
          const x = cx - size / 2 + Math.sin(t * 1.1 + k * 0.7) * S * 0.012 * p, y = ay + (top - ay) * s;
          if (pass === 0) {
            ctx.globalAlpha = a * 0.55 * (k % 2 ? 0.4 : 1); // alternate bands read as ripples, not a smear
            ctx.drawImage(sprites.wave, x, y, size, size);
          } else {
            ctx.globalAlpha = Math.min(1, a * 1.1);
            ctx.drawImage(sprites.rim, x, y, size, size);
          }
        }
      }

      // the character, locked to the same space so the rings hug her outline; she dissolves as the camera passes through
      const gone = Math.min(1, Math.max(0, (zoom - 2.2) / 3));
      const ca = pop * (1 - gone);
      if (ca > 0.01) {
        const sz = S * (0.94 + 0.06 * pop);
        ctx.globalAlpha = ca;
        ctx.drawImage(sprites.plain, cx - sz / 2, ay + (top - ay) * (sz / S), sz, sz);
      }
      ctx.restore();

      drawMotes(true, t, zoom, fx, fy, Math.max(0, 1 - (zoom - 1) / 6));
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    const vis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame); } };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", vis); };
  }, [src, control]);

  return <canvas ref={ref} aria-hidden className={className} />;
}
