import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { FlowButton } from "@/components/ui/flow-button";
import { Magnetic } from "@/components/ui/magnetic";

/** Reveal on scroll: heavy fade-up resolving out of a blur. */
export function Reveal({ children, delay = 0, className, y = 22 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  return (
    <BlurFade inView direction="up" offset={y} duration={0.9} delay={delay} blur="10px" className={className}>
      {children}
    </BlurFade>
  );
}

/**
 * Double-bezel: an outer tray with hairline ring, an inner core with concentric radius.
 * `glow` lights the tray edge and tints the core under a mouse pointer (see .glow in index.css); the pointer only
 * writes two CSS variables, so hovering never re-renders.
 */
export function Bezel({
  children, className, coreClassName, dark = false, radius = 32, pad = 6, glow = false,
}: { children: ReactNode; className?: string; coreClassName?: string; dark?: boolean; radius?: number; pad?: number; glow?: boolean }) {
  const tray = useRef<HTMLDivElement | null>(null);
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = tray.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <div
      ref={tray}
      onPointerMove={glow ? onMove : undefined}
      className={cn(dark ? "bezel-dark" : "bezel", glow && "glow", className)}
      style={{ borderRadius: radius, padding: pad }}
    >
      <div
        className={cn("relative h-full overflow-hidden", glow && "isolate", dark ? "core-dark bg-[#1b171b]" : "core bg-paper", coreClassName)}
        style={{ borderRadius: radius - pad }}
      >
        {glow && <span aria-hidden className="glow-wash" />}
        {children}
      </div>
    </div>
  );
}

/** Primary pill CTA: morphs to a rounded square on hover, a circle floods it and the arrows swap sides. */
export function CtaButton({
  children, onClick, variant = "accent", className, href, download,
}: { children: ReactNode; onClick?: () => void; variant?: "accent" | "ink"; className?: string; href?: string; download?: boolean | string }) {
  return (
    <Magnetic className="inline-block" strength={0.22}>
      <FlowButton onClick={onClick} variant={variant} className={className} href={href} download={download}>
        {children}
      </FlowButton>
    </Magnetic>
  );
}

export function GhostButton({ children, href }: { children: ReactNode; href: string }) {
  return (
    <a
      href={href}
      className="group/g inline-flex items-center gap-3 rounded-full py-2 pl-6 pr-2 text-[15px] font-semibold tracking-tight text-ink ring-1 ring-ink/12 transition-all duration-500 ease-spring hover:bg-white/80 hover:ring-ink/20 hover:shadow-[0_14px_30px_-16px_rgba(60,15,40,0.35)] active:scale-[0.98]"
    >
      {children}
      <span className="grid size-9 place-items-center rounded-full bg-ink/5 transition-all duration-500 ease-spring group-hover/g:translate-y-0.5 group-hover/g:bg-accent group-hover/g:text-white">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
      </span>
    </a>
  );
}

/** Secondary action with the ghost look, as a real button (opens the waitlist). */
export function GhostAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className="group/g inline-flex cursor-pointer items-center gap-3 rounded-full py-2 pl-6 pr-2 text-[15px] font-semibold tracking-tight text-ink ring-1 ring-ink/15 transition-all duration-500 ease-spring hover:bg-ink/5 hover:ring-ink/25 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {children}
      <span className="grid size-9 place-items-center rounded-full bg-ink/8 transition-all duration-500 ease-spring group-hover/g:translate-x-0.5 group-hover/g:bg-accent group-hover/g:text-white">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </span>
    </button>
  );
}

export function Wordmark({ className, dark = false }: { className?: string; dark?: boolean }) {
  return (
    <span className={cn("font-brand text-[26px] leading-none tracking-tight", dark ? "text-white" : "text-ink", className)}>
      Xiao<span className="text-accent">lee</span>
    </span>
  );
}

/** Mascot clip. Poster first, plays only while on screen, never for reduced-motion users. */
export function MascotVideo({
  name, className, position = "50% 10%", active = true, zoom = 1,
}: { name: string; className?: string; position?: string; active?: boolean; zoom?: number }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    if (visible && active) el.play().catch(() => {});
    else el.pause();
  }, [visible, active, reduced, name]);

  return (
    <video
      ref={ref}
      key={name}
      className={cn("size-full object-cover", className)}
      style={{ objectPosition: position, transform: zoom !== 1 ? `scale(${zoom})` : undefined, transformOrigin: "50% 8%" }}
      src={`/mascot/${name}.mp4`}
      poster={`/mascot/${name}.jpg`}
      muted loop playsInline preload="metadata"
      aria-hidden
    />
  );
}

export function SectionHead({
  a, b, sub, dark = false, center = false,
}: { a: string; b: string; sub?: string; dark?: boolean; center?: boolean }) {
  return (
    <div className={cn("max-w-3xl", center && "mx-auto text-center")}>
      <Reveal>
        <h2 className={cn("display text-[clamp(40px,6.2vw,84px)]", dark ? "text-white" : "text-ink")}>
          {a} <span className="serif-em block text-accent">{b}</span>
        </h2>
      </Reveal>
      {sub && (
        <Reveal delay={0.16}>
          <p className={cn("mt-6 max-w-2xl text-[clamp(16px,1.5vw,19px)] leading-relaxed", dark ? "text-white/55" : "text-ink-2", center && "mx-auto")}>{sub}</p>
        </Reveal>
      )}
    </div>
  );
}
