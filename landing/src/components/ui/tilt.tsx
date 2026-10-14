import { useRef, type ReactNode } from "react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { cn } from "@/lib/utils";

interface TiltProps {
  children: ReactNode;
  className?: string;
  /** Max rotation in degrees at the edge of the element. */
  max?: number;
  /** Scale while the pointer is over it. */
  lift?: number;
  /** A soft light that follows the pointer across the surface. */
  glare?: boolean;
}

/**
 * Pointer tilt: the element leans toward the cursor on a spring and eases flat when it leaves.
 * Mouse only, and never for reduced-motion users, so touch screens and keyboards see a plain element.
 */
export function Tilt({ children, className, max = 8, lift = 1.02, glare = false }: TiltProps) {
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const s = useMotionValue(1);
  const sx = useSpring(x, { stiffness: 220, damping: 22, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 220, damping: 22, mass: 0.5 });
  const ss = useSpring(s, { stiffness: 260, damping: 24 });
  const rotY = useTransform(sx, [-0.5, 0.5], [-max, max]);
  const rotX = useTransform(sy, [-0.5, 0.5], [max, -max]);
  const gx = useTransform(sx, [-0.5, 0.5], [0, 100]);
  const gy = useTransform(sy, [-0.5, 0.5], [0, 100]);
  const sheen = useMotionTemplate`radial-gradient(circle at ${gx}% ${gy}%, rgba(255,255,255,0.35), transparent 55%)`;
  const sheenOpacity = useTransform(ss, [1, lift], [0, 1]);

  if (reduced) return <div className={className}>{children}</div>;

  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !box.current) return;
    const r = box.current.getBoundingClientRect();
    x.set((e.clientX - r.left) / r.width - 0.5);
    y.set((e.clientY - r.top) / r.height - 0.5);
    s.set(lift);
  };
  const onLeave = () => { x.set(0); y.set(0); s.set(1); };

  return (
    <div className={cn("[perspective:900px]", className)} onPointerMove={onMove} onPointerLeave={onLeave}>
      <motion.div ref={box} style={{ rotateX: rotX, rotateY: rotY, scale: ss, transformStyle: "preserve-3d" }} className="relative size-full will-change-transform">
        {children}
        {glare && (
          <motion.span
            aria-hidden
            style={{ backgroundImage: sheen, opacity: sheenOpacity }}
            className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-soft-light"
          />
        )}
      </motion.div>
    </div>
  );
}
