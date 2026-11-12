import { type ReactNode, useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Bezel } from "@/components/kit";
import { NumberTicker } from "@/components/ui/number-ticker";
import { IconCheck } from "@/components/icons";

/*
 * The three objects that float around the hero portrait. They are the product loop in the order it happens:
 * a clip is cut -> the post is verified (a stamp lands) -> the payout is printed. Every string comes from the
 * copy the page already uses for its demos, so nothing here makes a claim the rest of the page does not.
 */

const EASE = [0.32, 0.72, 0, 1] as const;
const SLAM = [0.5, 0, 0.9, 0.55] as const; // a stamp accelerates into the page and stops dead

/**
 * Places an object at its own depth inside the tilting portrait, so pointer tilt parallaxes it for real.
 * The objects are illustration (the same text the demos below say in full), so they are hidden from assistive tech.
 */
export function Depth({ z, className, children }: { z: number; className?: string; children: ReactNode }) {
  return (
    <div aria-hidden className={cn("absolute", className)} style={{ transform: `translateZ(${z}px)` }}>
      {children}
    </div>
  );
}

/* ───────────────────────────── clip card ───────────────────────────── */
export function ClipCard({ delay }: { delay: number }) {
  const { t } = useLang();
  const reduced = useReducedMotion();
  const c = t.can.clipper;
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, x: -38, rotate: -11 }}
      animate={{ opacity: 1, x: 0, rotate: -4 }}
      transition={{ duration: 1.05, ease: EASE, delay }}
      className="w-[104px] sm:w-[124px]"
    >
      <div className="loop animate-float-slow">
        <Bezel radius={22} pad={4} className="shadow-[0_30px_36px_-20px_rgba(60,15,40,0.6)] transition-[scale,rotate] duration-500 ease-spring hover:scale-110 hover:rotate-3">
          <div className="relative aspect-[9/13] overflow-hidden bg-[#d3cfcc]">
            <img
              src="/mascot/clip-1.jpg" alt="" loading="eager"
              className="absolute inset-0 size-full object-cover object-top" style={{ transform: "scale(1.12)", transformOrigin: "50% 10%" }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <span className="absolute inset-x-2 bottom-2 rounded-md bg-accent px-1.5 py-0.5 text-center text-[10px] font-bold leading-tight text-white">{c.clips[0]}</span>
          </div>
          <div className="px-2.5 pb-2.5 pt-2.5">
            <div className="relative h-1 rounded-full bg-ink/10">
              <span className="absolute inset-y-0 left-[18%] w-[34%] rounded-full bg-accent" />
              <span aria-hidden className="playhead loop absolute inset-x-0 -inset-y-1">
                <i className="absolute right-0 top-0 h-3 w-[2px] rounded-full bg-ink" />
              </span>
            </div>
          </div>
        </Bezel>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────── verified stamp ────────────────────────── */
/** Rubber stamp: it slams in, a ring ripples out of the impact, then the check draws itself. */
export function VerifiedStamp({ delay, onLand }: { delay: number; onLand?: () => void }) {
  const { t } = useLang();
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const [hits, setHits] = useState(0); // each pointer entry re-strikes the stamp: a new ring ripples out
  const word = t.how.mock.verified.toUpperCase();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, scale: 2.1, rotate: 28 }}
      animate={{ opacity: 1, scale: 1, rotate: 10 }}
      transition={{ delay, duration: 0.3, ease: SLAM, opacity: { delay, duration: 0.1 } }}
      onAnimationComplete={reduced ? undefined : onLand}
      onHoverStart={reduced ? undefined : () => setHits((n) => n + 1)}
      className="relative size-[92px] sm:size-[110px]"
    >
      <span key={hits} aria-hidden className="stamp-ring absolute inset-0 rounded-full" style={{ animationDelay: hits ? "0s" : `${delay + 0.28}s` }} />
      <svg viewBox="0 0 120 120" aria-hidden className="relative size-full text-success" style={{ filter: `url(#${uid}-ink)` }}>
        <defs>
          <path id={`${uid}-ring`} d="M60 60m-39.5 0a39.5 39.5 0 1 1 79 0a39.5 39.5 0 1 1-79 0" />
          {/* rough edges and a few ink gaps, so it reads as a pressed stamp and not a vector badge */}
          <filter id={`${uid}-ink`} x="-4%" y="-4%" width="108%" height="108%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="warp" />
            <feDisplacementMap in="SourceGraphic" in2="warp" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="rough" />
            <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="9" result="speck" />
            <feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -7 4.7" result="holes" />
            <feComposite in="rough" in2="holes" operator="in" />
          </filter>
        </defs>
        <circle cx="60" cy="60" r="56" fill="none" stroke="currentColor" strokeWidth="3.4" />
        <circle cx="60" cy="60" r="31" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text fontSize="11" fontWeight="700" fill="currentColor" fontFamily="inherit">
          <textPath href={`#${uid}-ring`} textLength="243" lengthAdjust="spacing">{`${word} · XIAOLEE · `}</textPath>
        </text>
        <motion.path
          d="M42 62.5l13.5 13.5L79 47"
          fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"
          initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ delay: delay + 0.2, duration: 0.4, ease: EASE }}
        />
      </svg>
    </motion.div>
  );
}

/* ──────────────────────────── payout ticket ────────────────────────── */
// a fixed, irregular bar pattern: a receipt barcode, drawn once
const BARS = (() => {
  const widths = [2, 1, 3, 1, 1, 2, 3, 1, 2, 1, 1, 3, 2, 1, 3, 1, 2, 2, 1, 1, 3, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2];
  let x = 0;
  const bars = widths.map((w, i) => {
    const bar = { x, w };
    x += w + (i % 3 === 0 ? 2.2 : 1.3);
    return bar;
  });
  return { bars, width: x };
})();

function Barcode() {
  return (
    <svg viewBox={`0 0 ${BARS.width} 20`} preserveAspectRatio="none" aria-hidden className="h-[18px] w-full text-ink/75">
      {BARS.bars.map((b) => <rect key={b.x} x={b.x} y="0" width={b.w} height="20" fill="currentColor" />)}
    </svg>
  );
}

/** The payout prints out of a slot: the paper is revealed top to bottom while the amount counts up. */
export function PayoutTicket({ delay }: { delay: number }) {
  const { t } = useLang();
  const reduced = useReducedMotion();
  const p = t.can.payout;
  return (
    <div className="loop animate-float w-[176px] drop-shadow-[0_24px_22px_rgba(60,15,40,0.26)] sm:w-[206px]" style={{ animationDelay: "-3.4s" }}>
      <motion.div
        initial={reduced ? false : { clipPath: "inset(0 0 100% 0)", y: -16 }}
        animate={{ clipPath: "inset(0 0 0% 0)", y: 0 }}
        transition={{ duration: 1.05, ease: EASE, delay }}
      >
        <div className="ticket-edge bg-paper px-4 pb-7 pt-3.5 shadow-[inset_0_0_0_1px_rgba(26,25,23,0.06)] transition-[translate] duration-500 ease-spring hover:-translate-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-ink-3">
            <span>{p.unit}</span>
            <span className="grid size-[18px] place-items-center rounded-full bg-success text-white"><IconCheck size={11} /></span>
          </div>
          <div className="mt-1.5 text-[38px] font-bold leading-none tracking-tight text-ink tabular-nums sm:text-[44px]">
            +<NumberTicker value={0.3} decimalPlaces={2} delay={delay + 0.2} className="text-inherit" />
          </div>
          <div className="mt-1.5 text-[11.5px] font-semibold text-ink-3">{p.via}</div>
          <div className="mt-3 border-t border-dashed border-ink/15 pt-3"><Barcode /></div>
        </div>
      </motion.div>
    </div>
  );
}
