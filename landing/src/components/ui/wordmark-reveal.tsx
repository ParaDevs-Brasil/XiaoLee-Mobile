import { type PointerEvent, useRef } from "react";
import { useInView } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Oversized wordmark that lights up under the cursor (after Aceternity "Text Hover Effect"). A faint ghost of the
 * word sits in the logo face; on a mouse, a rose-and-magenta spotlight follows the pointer and shows through the
 * letters only (two solid-colour copies of the word under radial masks, so no gradient fills). On touch, where there
 * is no hover, the same spotlight drifts across on its own while on screen.
 * The pointer writes two CSS variables, so a sweep never re-renders React. Decorative: hidden from assistive tech.
 */
export function WordmarkReveal({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const live = useInView(ref, { margin: "80px 0px" });

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--wm-x", `${e.clientX - r.left}px`);
    el.style.setProperty("--wm-y", `${e.clientY - r.top}px`);
    el.dataset.on = "";
  };
  const onLeave = () => { if (ref.current) delete ref.current.dataset.on; };

  return (
    <div
      ref={ref} aria-hidden data-live={live}
      onPointerMove={onMove} onPointerLeave={onLeave}
      className={cn("wm", className)}
    >
      <span className="wm-ghost">{text}</span>
      <span className="wm-glow loop">{text}</span>
      <span className="wm-lit loop">{text}</span>
    </div>
  );
}
