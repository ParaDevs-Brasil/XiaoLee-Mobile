import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * A night horizon in the brand's magenta: three star layers, a slow nebula, five mountain ridges and a rim of
 * atmosphere, lit by bloom. The camera dollies toward the ridge line as the stage scrolls through the viewport and
 * drifts with the pointer. It only renders while on screen, caps pixel ratio, and draws a single still frame for
 * reduced-motion users.
 */

const MAGENTA = new THREE.Color("#e02884");
const ROSE = new THREE.Color("#f7a8d0");
const VIOLET = new THREE.Color("#5a3fd6");

/** Small deterministic noise so the skyline is the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function starLayer(count: number, radius: [number, number], size: number, depth: number, seed: number) {
  const r = rng(seed);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const siz = new Float32Array(count);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const rad = radius[0] + r() * (radius[1] - radius[0]);
    const theta = r() * Math.PI * 2;
    const phi = Math.acos(r() * 2 - 1);
    pos.set([rad * Math.sin(phi) * Math.cos(theta), Math.abs(rad * Math.sin(phi) * Math.sin(theta)) * 0.7 - 40, -Math.abs(rad * Math.cos(phi)) - 80], i * 3);
    const k = r();
    if (k < 0.72) c.setHSL(0.92, 0.25, 0.82 + r() * 0.18);
    else if (k < 0.9) c.copy(ROSE);
    else c.copy(VIOLET).lerp(new THREE.Color("#fff"), 0.5);
    col.set([c.r, c.g, c.b], i * 3);
    siz[i] = (0.5 + r() * 1.6) * size;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("size", new THREE.BufferAttribute(siz, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDepth: { value: depth }, uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float size; attribute vec3 color; varying vec3 vColor; varying float vTw;
      uniform float uTime; uniform float uDepth; uniform float uPx;
      void main() {
        vColor = color;
        vTw = 0.65 + 0.35 * sin(uTime * (0.8 + uDepth * 0.5) + position.x * 0.37 + position.y * 0.21);
        vec3 p = position;
        float a = uTime * 0.012 * (1.0 - uDepth * 0.3);
        p.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xy;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = size * uPx * (260.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vColor, pow(1.0 - d * 2.0, 1.6) * vTw);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

function ridge(color: string, z: number, y: number, amp: number, seed: number, opacity = 1) {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6, r() * 6];
  const pts: THREE.Vector2[] = [];
  const N = 90;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = (t - 0.5) * 1400;
    const h = Math.sin(t * 7 + ph[0]) * 0.55 + Math.sin(t * 17 + ph[1]) * 0.28 + Math.sin(t * 41 + ph[2]) * 0.1;
    pts.push(new THREE.Vector2(x, h * amp));
  }
  pts.push(new THREE.Vector2(700, -260), new THREE.Vector2(-700, -260));
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(new THREE.Shape(pts)),
    new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, fog: true }),
  );
  mesh.position.set(0, y, z);
  return mesh;
}

export function HorizonScene({ progress }: { progress: React.RefObject<number> }) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = innerWidth < 768;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !small, alpha: true, powerPreference: "high-performance" });
    } catch {
      return; // no WebGL: the CSS gradient behind the canvas carries the stage
    }
    const px = Math.min(devicePixelRatio, small ? 1.5 : 2);
    renderer.setPixelRatio(px);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.domElement.className = "absolute inset-0 size-full";
    renderer.domElement.setAttribute("aria-hidden", "true");
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog("#0a0610", 120, 520);
    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 2000);

    const stars = [
      starLayer(small ? 900 : 1800, [260, 700], 1.7, 0, 11),
      starLayer(small ? 700 : 1400, [200, 520], 1.3, 1, 23),
      starLayer(small ? 400 : 800, [150, 380], 1.0, 2, 37),
    ];
    stars.forEach((s) => ((s.material as THREE.ShaderMaterial).uniforms.uPx.value = px));
    scene.add(...stars);

    // nebula: two soft colour clouds that breathe behind the ridges
    const nebula = new THREE.Mesh(
      new THREE.PlaneGeometry(1500, 700, 1, 1),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, c1: { value: MAGENTA }, c2: { value: VIOLET } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv; uniform float uTime; uniform vec3 c1; uniform vec3 c2;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
          float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p=p*2.03+7.0; a*=0.5; } return v; }
          void main(){
            vec2 p = vUv * vec2(3.2, 1.6);
            float t = uTime * 0.03;
            float a = fbm(p + vec2(t, -t * 0.6));
            float b = fbm(p * 1.7 - vec2(t * 0.8, t) + a);
            vec3 col = mix(c2, c1, smoothstep(0.25, 0.8, b));
            float mask = smoothstep(0.0, 0.55, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
            mask *= 1.0 - smoothstep(0.35, 0.55, abs(vUv.x - 0.5));
            float alpha = pow(b, 2.2) * mask * 0.85;
            gl_FragColor = vec4(col * 1.15, alpha);
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }),
    );
    nebula.position.set(0, 70, -420);
    scene.add(nebula);

    // a low sun-glow right on the horizon
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(150, 64),
      new THREE.ShaderMaterial({
        uniforms: { c: { value: MAGENTA } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vUv; uniform vec3 c; void main(){ float d = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(c * 1.4, pow(1.0 - clamp(d,0.0,1.0), 2.4) * 0.8); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }),
    );
    glow.position.set(0, 14, -300);
    scene.add(glow);

    const ridges = [
      ridge("#2a1030", -200, -10, 44, 5, 1),
      ridge("#1d0d27", -150, -26, 54, 9, 1),
      ridge("#140a1d", -100, -42, 64, 14, 1),
      ridge("#0d0713", -60, -58, 70, 21, 1),
      ridge("#07040b", -26, -76, 78, 31, 1),
    ];
    scene.add(...ridges);

    // bloom is what makes the points and the glow read as light; skip it on phones
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    if (!small) composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.55, 0.2));
    composer.addPass(new OutputPass());

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      pointer.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    if (!reduced) addEventListener("pointermove", onMove, { passive: true });

    let raf = 0;
    let visible = true;
    let smooth = progress.current ?? 0;
    const clock = new THREE.Clock();

    const frame = () => {
      const t = clock.getElapsedTime();
      const target = progress.current ?? 0;
      smooth += (target - smooth) * 0.06;
      pointer.sx += (pointer.x - pointer.sx) * 0.04;
      pointer.sy += (pointer.y - pointer.sy) * 0.04;

      for (const s of stars) (s.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
      (nebula.material as THREE.ShaderMaterial).uniforms.uTime.value = t;

      // dolly toward the skyline: the ridges slide past one another as `smooth` goes 0 → 1
      camera.position.set(pointer.sx * 14, 22 + smooth * 12 - pointer.sy * 5 + Math.sin(t * 0.25) * 0.8, 150 - smooth * 120);
      camera.lookAt(pointer.sx * 6, 34 + smooth * 6, -300);
      ridges.forEach((m, i) => (m.position.x = pointer.sx * (i + 1) * -3));
      glow.scale.setScalar(1 + Math.sin(t * 0.6) * 0.03 + smooth * 0.25);

      composer.render();
      if (!reduced && visible) raf = requestAnimationFrame(frame);
    };

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) { clock.start(); raf = requestAnimationFrame(frame); }
    }, { threshold: 0 });
    io.observe(el);
    frame();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      removeEventListener("pointermove", onMove);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [progress]);

  return <div ref={host} className="absolute inset-0" />;
}
