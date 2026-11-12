import { useRef, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";

interface MagneticProps {
  children: ReactNode;
  className?: string;
  /** Fraction of the pointer offset the element follows (0.2 is subtle, 0.5 is clingy). */
  strength?: number;
}

/**
 * Pulls its child a little toward the cursor while the pointer is over it, then springs back.
 * Transform only. Mouse only, and a plain wrapper for reduced-motion users.
 */
export function Magnetic({ children, className, strength = 0.3 }: MagneticProps) {
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 20, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 260, damping: 20, mass: 0.4 });

  if (reduced) return <div className={className}>{children}</div>;

  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !box.current) return;
    const r = box.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const onLeave = () => { x.set(0); y.set(0); };

  return (
    <motion.div ref={box} onPointerMove={onMove} onPointerLeave={onLeave} style={{ x: sx, y: sy }} className={className}>
      {children}
    </motion.div>
  );
}
