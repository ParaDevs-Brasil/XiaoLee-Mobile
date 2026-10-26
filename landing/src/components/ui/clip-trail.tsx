import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Image cursor trail (after Skiper UI "Image Cursor Trail"), made of Xiaolee's own clips and mascot stills.
 * A mouse sweep over the parent stamps die-cut stickers along the path: each one tilts into the direction of travel,
 * is thrown a little further along it, and fades. A fixed pool of image nodes is recycled through the Web Animations
 * API, so a sweep never re-renders React or allocates DOM. Mouse only; touch and reduced-motion get nothing.
 *
 * Mount it inside a `relative` parent: it listens on that parent and paints under whatever is stacked above it.
 */

type Props = { images: string[]; width?: number; step?: number; className?: string };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function ClipTrail({ images, width = 84, step = 118, className }: Props) {
  const layer = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const host = layer.current?.parentElement;
    if (!layer.current || !host || reduced) return;
    const cards = Array.from(layer.current.children) as HTMLElement[];
    const height = (width * 4) / 3;
    let i = 0, lx = 0, ly = 0, armed = false;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = host.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (!armed) { lx = x; ly = y; armed = true; return; }
      if (Math.hypot(x - lx, y - ly) < step) return;

      const dx = x - lx;
      const dy = y - ly;
      lx = x; ly = y;
      const el = cards[i++ % cards.length];
      el.getAnimations().forEach((a) => a.cancel());
      el.style.translate = `${x - width / 2}px ${y - height / 2}px`;

      const tilt = clamp(dx * 0.07, -14, 14);
      const tx = dx * 0.2;
      const ty = dy * 0.2;
      el.animate(
        [
          { opacity: 0, transform: `translate(${-tx}px, ${-ty}px) scale(0.7) rotate(${tilt - 7}deg)`, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
          { opacity: 1, transform: `translate(0px, 0px) scale(1) rotate(${tilt}deg)`, offset: 0.16, easing: "linear" },
          { opacity: 1, transform: `translate(${tx * 0.5}px, ${ty * 0.5}px) scale(1) rotate(${tilt}deg)`, offset: 0.7, easing: "ease-in" },
          { opacity: 0, transform: `translate(${tx}px, ${ty}px) scale(0.92) rotate(${tilt + 4}deg)` },
        ],
        { duration: 1250 },
      );
    };
    const onLeave = () => { armed = false; };

    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);
    return () => {
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      cards.forEach((c) => c.getAnimations().forEach((a) => a.cancel()));
    };
  }, [images, width, step, reduced]);

  return (
    <div ref={layer} aria-hidden className={cn("pointer-events-none absolute inset-0 z-0 overflow-hidden", className)}>
      {images.map((src, k) => (
        <img
          key={`${src}-${k}`} src={src} alt="" loading="lazy" draggable={false}
          className="absolute left-0 top-0 aspect-[3/4] rounded-[16px] bg-[#d3cfcc] object-cover object-top opacity-0 shadow-[0_18px_26px_-12px_rgba(60,15,40,0.5)] ring-[3px] ring-surface will-change-[transform,opacity]"
          style={{ width }}
        />
      ))}
    </div>
  );
}
