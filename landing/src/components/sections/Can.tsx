import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { useLive, useSequence } from "@/lib/hooks";
import { Bezel, MascotVideo, Reveal } from "@/components/kit";
import { BorderBeam } from "@/components/ui/border-beam";
import { Marquee } from "@/components/ui/marquee";
import { NumberTicker } from "@/components/ui/number-ticker";
import { OrbitingCircles } from "@/components/ui/orbiting-circles";
import {
  IconCheck, IconDiamond, IconGlobe, IconPhone, IconSend, IconTelegram, IconX,
} from "@/components/icons";

const EASE = [0.32, 0.72, 0, 1] as const;

// three.js is ~500 KB: it loads only once the stage is near the viewport
const HorizonScene = lazy(() => import("@/components/ui/horizon-scene").then((m) => ({ default: m.HorizonScene })));

/** The section's opening: a night horizon that the camera flies toward as you scroll past it. */
function HorizonHead() {
  const { t } = useLang();
  const stage = useRef<HTMLDivElement | null>(null);
  const progress = useRef(0);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    const onScroll = () => {
      const r = el.getBoundingClientRect();
      progress.current = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight + r.height)));
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => { io.disconnect(); removeEventListener("scroll", onScroll); };
  }, []);

  return (
    <Reveal y={36}>
      <div ref={stage} className="relative isolate min-h-[520px] overflow-hidden rounded-[2.5rem] bg-[radial-gradient(ellipse_80%_60%_at_50%_100%,#4a1245_0%,#1a0b24_55%,#0a0610_100%)] shadow-[0_60px_120px_-50px_rgba(120,20,70,0.7)] ring-1 ring-white/10 sm:min-h-[640px] sm:rounded-[3.5rem] lg:min-h-[720px]">
        {near && <Suspense fallback={null}><HorizonScene progress={progress} /></Suspense>}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_38%,rgba(10,6,16,0.55),transparent_70%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#07040b] to-transparent" />
        <div className="relative z-10 flex min-h-[inherit] flex-col items-center justify-center px-6 py-24 text-center sm:py-32">
          <h2 className="display text-[clamp(44px,7.6vw,108px)] text-white [text-shadow:0_6px_60px_rgba(224,40,132,0.35)]">
            {t.can.h2a} <span className="serif-em block text-[#ff7fbd]">{t.can.h2b}</span>
          </h2>
          <p className="mt-7 max-w-xl text-[clamp(16px,1.5vw,19px)] leading-relaxed text-white/70">{t.can.sub}</p>
          <div aria-hidden className="mt-12 flex flex-col items-center gap-3 text-white/45">
            <span className="h-14 w-px bg-gradient-to-b from-white/60 to-transparent" />
          </div>
        </div>
      </div>
    </Reveal>
  );
}

/** `split`: on wide screens the copy sits beside the visual instead of above it (for a full-width tile). */
function Tile({
  title, body, className, children, visualClass, split,
}: { title: string; body: string; className?: string; children: ReactNode; visualClass?: string; split?: boolean }) {
  return (
    <Reveal className={cn("h-full", className)}>
      <Bezel glow radius={36} pad={7} className="group h-full" coreClassName={cn("flex h-full flex-col p-6 sm:p-7", split && "lg:flex-row lg:items-center lg:gap-10")}>
        <div className={cn(split && "lg:w-[34%] lg:shrink-0")}>
          <h3 className="text-[clamp(22px,2.2vw,28px)] font-bold leading-tight tracking-tight text-ink">{title}</h3>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-2">{body}</p>
        </div>
        <div className={cn("relative mt-6 flex-1", split && "lg:mt-0 lg:min-w-0", visualClass)}>{children}</div>
      </Bezel>
    </Reveal>
  );
}

/* ───────────────────────────── chat ───────────────────────────── */
const CHAT_DELAYS = [700, 1000, 900, 1100, 1000, 1000];

function Typing() {
  return (
    <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-surface px-3.5 py-3 shadow-sm ring-1 ring-ink/5">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="size-1.5 rounded-full bg-ink-3" animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }} />
      ))}
    </div>
  );
}

function ChatDemo() {
  const { t } = useLang();
  const msgs = t.can.chat.msgs;
  const { ref, step } = useSequence(msgs.length + 1, CHAT_DELAYS, 3800);
  const shown = msgs.slice(0, step);
  const next = msgs[step];
  const typing = next?.who === "bot" && step < msgs.length;

  return (
    <div ref={ref} className="flex h-full min-h-[360px] flex-col overflow-hidden rounded-3xl bg-line/45 ring-1 ring-ink/5">
      <div className="flex items-center gap-3 border-b border-ink/5 bg-surface/60 px-4 py-3">
        <img src="/assets/xiaolee-icon-160.webp" width={36} height={36} alt="" className="size-9 rounded-full object-cover ring-2 ring-surface" />
        <div>
          <div className="text-[14px] font-bold leading-none text-ink">{t.can.chat.title}</div>
          <div className="mt-1 text-[11px] font-semibold text-success">{t.can.chat.status}</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-2.5 overflow-hidden p-4">
        <AnimatePresence initial={false}>
          {shown.map((m, i) => (
            <motion.div
              key={i} layout
              initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.55, ease: EASE }}
              className={cn("flex", m.who === "user" ? "justify-end" : "justify-start")}
            >
              {m.who === "user" ? (
                <div className="max-w-[78%] rounded-[20px] rounded-br-md bg-ink px-4 py-2.5 text-[14.5px] font-medium text-cream">{m.text}</div>
              ) : (
                <div className="max-w-[84%] rounded-[20px] rounded-bl-md bg-surface px-4 py-2.5 text-[14.5px] font-medium text-ink shadow-sm ring-1 ring-ink/5">
                  {m.text}
                  {i === 3 && (
                    <div className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-[12.5px] font-bold text-accent"><IconCheck size={14} /> Confirm</div>
                  )}
                </div>
              )}
            </motion.div>
          ))}
          {typing && (
            <motion.div key="typing" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-start"><Typing /></motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="m-3 mt-0 flex items-center gap-2 rounded-full bg-surface py-1.5 pl-4 pr-1.5 text-[13.5px] text-ink-3 ring-1 ring-ink/5">
        <span className="flex-1">{t.hero.inputHint}</span>
        <span className="grid size-8 place-items-center rounded-full bg-accent text-white"><IconSend size={15} /></span>
      </div>
    </div>
  );
}

/* ─────────────────────────── campaign ─────────────────────────── */
const CAMPAIGN_DELAYS = [900, 800, 800, 800, 900];

/** A brand's one-sentence brief becomes chips, one by one; Xiaolee "types", then asks to publish. */
function CampaignDemo() {
  const { t } = useLang();
  const c = t.can.campaign;
  const { ref, step } = useSequence(c.chips.length + 1, CAMPAIGN_DELAYS, 3600);
  const typing = step === c.chips.length; // every chip is in: she is composing her reply
  const asked = step > c.chips.length;
  return (
    <div ref={ref} className="rounded-3xl bg-line/45 p-4 ring-1 ring-ink/5">
      <div className="flex flex-wrap gap-2">
        {c.chips.map((x, i) => (
          <motion.span
            key={x}
            initial={false}
            animate={{ opacity: step > i ? 1 : 0.18, scale: step > i ? 1 : 0.92, y: step > i ? 0 : 6 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="rounded-full bg-surface px-3.5 py-2 text-[13px] font-bold text-ink shadow-sm ring-1 ring-ink/5"
          >
            {x}
          </motion.span>
        ))}
      </div>
      <motion.div
        initial={false}
        animate={{ opacity: step >= c.chips.length ? 1 : 0.35, y: step >= c.chips.length ? 0 : 10 }}
        transition={{ duration: 0.7, ease: EASE }}
        className="relative mt-4 overflow-hidden rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-ink/5"
      >
        <div className="flex min-h-[40px] items-center gap-2.5">
          <img src="/assets/xiaolee-icon-160.webp" width={32} height={32} alt="" className="size-8 shrink-0 rounded-full object-cover" />
          {typing ? (
            <div className="flex items-center gap-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="size-1.5 rounded-full bg-ink-3" animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }} />
              ))}
            </div>
          ) : (
            <motion.p
              key={asked ? "ask" : "wait"}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: asked ? 1 : 0.4, y: 0 }} transition={{ duration: 0.5, ease: EASE }}
              className="text-[13.5px] font-semibold leading-snug text-ink"
            >
              {c.askLine}
            </motion.p>
          )}
        </div>
        {asked && <BorderBeam size={80} duration={4} colorFrom="#d81b78" colorTo="#f7c9e0" borderWidth={1.5} />}
      </motion.div>
    </div>
  );
}

/* ──────────────────────────── payout ──────────────────────────── */
const PAYOUT_DELAYS = [1000, 900, 900, 1000];

/** Tasks are checked live one after another (the ring spins while she looks), then the claim settles and the amount counts in. */
function PayoutDemo() {
  const { t } = useLang();
  const p = t.can.payout;
  const { ref, step } = useSequence(p.tasks.length + 1, PAYOUT_DELAYS, 3800);
  const claimed = step > p.tasks.length - 1;
  return (
    <div ref={ref} className="rounded-3xl bg-line/45 p-4 ring-1 ring-ink/5">
      <ul className="space-y-2">
        {p.tasks.map((x, i) => {
          const done = step > i;
          const checking = step === i;
          return (
            <li key={x} className="flex items-center gap-3 rounded-2xl bg-surface px-3.5 py-2.5 shadow-sm ring-1 ring-ink/5">
              <span className="relative grid size-5 shrink-0 place-items-center">
                <span className={cn("absolute inset-0 grid place-items-center rounded-full ring-1 transition-all duration-500 ease-spring", done ? "scale-100 bg-success text-white ring-success" : "scale-90 bg-transparent text-transparent ring-ink/20")}>
                  <IconCheck size={12} />
                </span>
                {checking && <span aria-hidden className="absolute -inset-px animate-spin rounded-full border-2 border-transparent border-t-accent" />}
              </span>
              <span className={cn("text-[13.5px] font-semibold transition-colors duration-500", done ? "text-ink-3 line-through decoration-ink/20" : "text-ink")}>{x}</span>
            </li>
          );
        })}
      </ul>
      <div className={cn("relative mt-3 flex items-center justify-between overflow-hidden rounded-2xl px-4 py-3 transition-colors duration-700 ease-spring", claimed ? "bg-accent text-white" : "bg-surface text-ink ring-1 ring-ink/5")}>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[26px] font-bold leading-none tracking-tight tabular-nums">
            +{claimed ? <NumberTicker key="claimed" value={0.3} decimalPlaces={2} className="text-inherit" /> : <span className="tracking-wider">0.00</span>}
          </span>
          <span className={cn("text-[12px] font-bold", claimed ? "text-white/80" : "text-ink-3")}>{p.unit}</span>
        </div>
        <span className="text-[13px] font-bold">{claimed ? <span className="flex items-center gap-1.5"><IconCheck size={15} /> {p.via}</span> : p.claim}</span>
        <AnimatePresence>
          {claimed && (
            <motion.span
              key="sheen" aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-[18deg] bg-surface/25"
              initial={{ x: "-120%" }} animate={{ x: "480%" }} transition={{ duration: 1.1, ease: EASE }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ──────────────────────────── clipper ─────────────────────────── */
// where each of the three cuts sits on the source track, in % of its length
const CUTS = [[8, 20], [41, 53], [74, 86]] as const;
const CLIP_POSTERS = ["clip-1", "clip-2", "clip-3"];

const seconds = (clock: string) => {
  const [m, s] = clock.split(":").map(Number);
  return (m || 0) * 60 + (s || 0);
};

/**
 * One editing session on a loop: the playhead sweeps the source, and each cut lifts and plays its own progress bar as
 * the playhead passes under it. The clock reads the playhead animation's own progress, so it can never drift from it
 * and it pauses with it when the tile scrolls away (the CSS lives under .clip-stage in index.css).
 */
function ClipperDemo() {
  const { t } = useLang();
  const reduced = useReducedMotion();
  const c = t.can.clipper;
  const { ref, live } = useLive<HTMLDivElement>();
  const clock = useRef<HTMLSpanElement | null>(null);
  const head = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const out = clock.current;
    const playhead = head.current;
    if (!live || reduced || !out || !playhead) return;
    const total = seconds(c.len);
    let raf = 0;
    let shown = "";
    const tick = () => {
      const progress = playhead.getAnimations()[0]?.effect?.getComputedTiming().progress ?? 0;
      const s = Math.floor(Number(progress) * total);
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (text !== shown) { out.textContent = text; shown = text; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, reduced, c.len]);

  return (
    <div ref={ref} data-live={live} className="clip-stage flex h-full flex-col rounded-3xl bg-line/45 p-4 ring-1 ring-ink/5 sm:p-5">
      <div className="flex items-center gap-3 rounded-2xl bg-surface px-3.5 py-2.5 shadow-sm ring-1 ring-ink/5">
        <span className="grid size-9 place-items-center rounded-xl bg-ink text-cream">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-ink">{c.source}</div>
          {/* scrubber: three cuts, and a playhead that passes under them */}
          <div className="relative mt-2 h-1.5 rounded-full bg-ink/8">
            {CUTS.map(([l, r]) => (
              <motion.span
                key={l} className="absolute inset-y-0 rounded-full" style={{ left: `${l}%`, width: `${r - l}%`, originX: 0 }}
                initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.8, ease: EASE, delay: 0.3 + l / 120 }}
              >
                <i className="clip-seg loop absolute inset-0 rounded-full bg-accent" style={{ "--start": l / 100 } as CSSProperties} />
              </motion.span>
            ))}
            <span ref={head} aria-hidden className="playhead loop absolute inset-x-0 -inset-y-1.5">
              <i className="absolute right-0 top-0 h-[18px] w-[2px] rounded-full bg-ink" />
              <i className="absolute -right-[3px] -top-[3px] size-2 rounded-full bg-ink" />
            </span>
          </div>
        </div>
        <span className="min-w-[88px] text-right text-[12px] font-bold tabular-nums text-ink-3">
          {reduced ? c.len : <><span ref={clock} className="text-ink">0:00</span> / {c.len}</>}
        </span>
      </div>
      <div className="mt-4 grid flex-1 grid-cols-3 content-center gap-2.5 sm:gap-4">
        {c.clips.map((label, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.5 + i * 0.12 }}
            className={cn("group/clip relative transition-[transform,translate,rotate,scale] duration-500 ease-spring hover:z-10 hover:-translate-y-2 hover:rotate-0", i === 0 && "sm:-rotate-3", i === 2 && "sm:rotate-3", i === 1 && "sm:-translate-y-2")}
          >
            <div className="clip-lift loop" style={{ "--start": CUTS[i][0] / 100 } as CSSProperties}>
              <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-[#d3cfcc] shadow-[0_18px_30px_-18px_rgba(60,15,40,0.5)] ring-1 ring-ink/10 transition-[box-shadow] duration-500 ease-spring group-hover/clip:shadow-[0_30px_40px_-18px_rgba(120,20,70,0.55)] group-hover/clip:ring-accent/40">
                <img src={`/mascot/${CLIP_POSTERS[i]}.jpg`} alt="" loading="lazy" className="size-full object-cover object-top transition-transform duration-700 ease-spring group-hover/clip:scale-[1.06]" style={{ transform: "scale(1.12)", transformOrigin: "50% 10%" }} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                <div className="absolute inset-x-2 bottom-2">
                  <span className="inline-block rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold leading-tight text-white">{label}</span>
                  <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-surface/30">
                    <div className="clip-progress loop h-full w-full rounded-full bg-surface" style={{ "--start": CUTS[i][0] / 100 } as CSSProperties} />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[12.5px] font-bold text-success"><IconCheck size={14} className="clip-check loop" /> {c.ready}</p>
    </div>
  );
}

/* ───────────────────────────── doors ──────────────────────────── */
function DoorsDemo() {
  const doors = [<IconPhone key="m" size={18} />, <IconGlobe key="w" size={18} />, <IconTelegram key="t" size={18} />, <IconX key="x" size={18} />];
  return (
    <div className="relative mx-auto flex size-[280px] items-center justify-center sm:size-[320px]">
      <div aria-hidden className="absolute inset-4 rounded-full bg-[radial-gradient(closest-side,var(--halo),transparent)]" />
      <div className="relative z-10 size-20 overflow-hidden rounded-full ring-4 ring-surface shadow-[0_20px_40px_-12px_rgba(120,20,70,0.5)]">
        <MascotVideo name="kawaii" position="50% 6%" zoom={1.5} />
      </div>
      <OrbitingCircles radius={92} iconSize={44} duration={22} className="border-0 bg-transparent">
        {doors.slice(0, 2).map((d, i) => <span key={i} className="grid size-11 cursor-pointer place-items-center rounded-full bg-surface text-ink shadow-md ring-1 ring-ink/8 transition-all duration-500 ease-spring hover:scale-125 hover:bg-accent hover:text-white hover:ring-accent">{d}</span>)}
      </OrbitingCircles>
      <OrbitingCircles radius={140} iconSize={44} duration={30} reverse path className="border-0 bg-transparent">
        {doors.slice(2).map((d, i) => <span key={i} className="grid size-11 cursor-pointer place-items-center rounded-full bg-ink text-cream shadow-md transition-all duration-500 ease-spring hover:scale-125 hover:bg-accent">{d}</span>)}
      </OrbitingCircles>
    </div>
  );
}

/* ───────────────────────────── chains ─────────────────────────── */
const TUCK = 14; // rails tuck this far under their card and under the hub, so coins slide out of one and sink into the other
const SOURCES = [
  { label: "Solana", icon: <img src="/assets/chain-solana.png" alt="" className="h-[18px] w-auto" /> },
  { label: "EVM", icon: <IconDiamond size={22} className="text-bow" /> },
  { label: "Stellar", icon: <img src="/assets/chain-stellar.png" alt="" className="h-[18px] w-auto" /> },
];
const STAGE_DOTS = {
  backgroundImage: "radial-gradient(color-mix(in srgb, var(--color-ink) 16%, transparent) 1px, transparent 1.3px)",
  backgroundSize: "18px 18px",
  maskImage: "radial-gradient(ellipse 85% 100% at 88% 50%, #000, transparent 78%)",
  WebkitMaskImage: "radial-gradient(ellipse 85% 100% at 88% 50%, #000, transparent 78%)",
} satisfies CSSProperties;

type Rails = { w: number; h: number; paths: string[] };

/**
 * Rail paths in stage pixels, measured from the real card and hub boxes: one S-curve per source, fanned across the
 * hub's left arc so they never pile onto one point. Re-measured whenever any of those boxes resizes (fonts, breakpoints).
 */
function useRails(stage: React.RefObject<HTMLDivElement | null>, cards: React.RefObject<(HTMLDivElement | null)[]>, hub: React.RefObject<HTMLDivElement | null>) {
  const [rails, setRails] = useState<Rails | null>(null);
  useEffect(() => {
    const root = stage.current;
    const hubEl = hub.current;
    const els = cards.current.filter((c): c is HTMLDivElement => !!c);
    if (!root || !hubEl || !els.length) return;
    const measure = () => {
      const o = root.getBoundingClientRect();
      const hb = hubEl.getBoundingClientRect();
      const r = hb.width / 2;
      const cx = hb.left - o.left + r;
      const cy = hb.top - o.top + r;
      const paths = els.map((el, i) => {
        const b = el.getBoundingClientRect();
        const sx = b.right - o.left - TUCK;
        const sy = b.top - o.top + b.height / 2;
        const dy = (i - (els.length - 1) / 2) * r * 0.46;
        const ex = cx - Math.sqrt(r * r - dy * dy) + TUCK;
        const ey = cy + dy;
        const mx = sx + (ex - sx) * 0.55;
        return `M${sx.toFixed(1)},${sy.toFixed(1)} C${mx.toFixed(1)},${sy.toFixed(1)} ${mx.toFixed(1)},${ey.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
      });
      setRails({ w: o.width, h: o.height, paths });
    };
    const ro = new ResizeObserver(measure);
    [root, hubEl, ...els].forEach((el) => ro.observe(el));
    measure();
    return () => ro.disconnect();
  }, [stage, cards, hub]);
  return rails;
}

function Coin({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden style={style} className={cn("grid place-items-center rounded-full bg-accent font-bold leading-none text-white", className)}>$</span>;
}

function Source({ label, icon, cardRef }: { label: string; icon: ReactNode; cardRef: (el: HTMLDivElement | null) => void }) {
  return (
    <div ref={cardRef} className="relative z-10 flex w-28 items-center gap-2.5 rounded-2xl bg-surface p-2 pr-3 shadow-[0_14px_28px_-16px_rgba(60,15,40,0.45)] ring-1 ring-ink/6 transition-all duration-500 ease-spring hover:-translate-y-0.5 hover:shadow-[0_22px_34px_-16px_rgba(200,24,111,0.5)] hover:ring-accent/30 sm:w-40 sm:gap-3 sm:p-2.5 sm:pr-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cream ring-1 ring-ink/5 sm:size-10">{icon}</span>
      <span className="text-[13px] font-bold text-ink sm:text-[14.5px]">{label}</span>
    </div>
  );
}

/**
 * Three transfers on one 6s loop, 2s apart (the CSS lives under .rail-stage in index.css): a USDC coin slides out from
 * under its chain's card along a dotted rail, a magenta trail lights the rail behind it, and each arrival makes the hub ring once.
 */
function ChainsDemo() {
  const { t } = useLang();
  const { ref, live } = useLive<HTMLDivElement>();
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const hub = useRef<HTMLDivElement | null>(null);
  const rails = useRails(ref, cards, hub);
  return (
    <div ref={ref} data-live={live} className="rail-stage relative flex min-h-[290px] items-center justify-between overflow-hidden rounded-3xl bg-ink/[0.035] px-4 py-7 ring-1 ring-ink/8 sm:min-h-[320px] sm:px-8">
      <div aria-hidden className="absolute inset-0" style={STAGE_DOTS} />
      <div className="flex flex-col gap-3.5">
        {SOURCES.map((s, i) => <Source key={s.label} label={s.label} icon={s.icon} cardRef={(el) => { cards.current[i] = el; }} />)}
      </div>
      <div className="relative">
        <div aria-hidden className="absolute left-1/2 top-1/2 size-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--halo),transparent)] sm:size-[440px]" />
        <span aria-hidden className="rail-ring loop absolute inset-0 rounded-full ring-2 ring-accent" />
        <div ref={hub} className="relative z-10 grid size-20 place-items-center rounded-full bg-night shadow-[0_26px_44px_-14px_rgba(224,40,132,0.55)] ring-[5px] ring-surface sm:size-28">
          <img src="/assets/logos/arc.svg" alt={t.can.chains.arc} className="h-5 w-auto brightness-0 invert sm:h-7" />
        </div>
        {/* out of flow, so the hub itself sits on the stage's centre line, level with the middle card */}
        <span className="absolute left-1/2 top-full z-10 mt-4 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface py-1 pl-1.5 pr-3 text-[11px] font-bold text-ink-2 ring-1 ring-ink/8">
          <Coin className="size-4 text-[9px]" />{t.can.chains.note}
        </span>
      </div>
      {rails && (
        <>
          <svg aria-hidden width={rails.w} height={rails.h} className="pointer-events-none absolute left-0 top-0 overflow-visible" fill="none">
            {rails.paths.map((d, i) => (
              <g key={i}>
                <path d={d} style={{ stroke: "color-mix(in srgb, var(--color-ink) 34%, transparent)" }} strokeWidth={2.5} strokeLinecap="round" strokeDasharray="0 7" />
                <path d={d} pathLength={1} className="rail-trail loop" stroke="var(--color-accent)" strokeWidth={2.5} strokeLinecap="round" style={{ "--i": i } as CSSProperties} />
              </g>
            ))}
          </svg>
          {rails.paths.map((d, i) => (
            <Coin key={i} className="rail-coin loop" style={{ offsetPath: `path("${d}")`, "--i": i } as CSSProperties} />
          ))}
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── AI Creators ───────────────────────────── */
/** Photo → voice → video, left to right: a light travels the connectors, the waveform breathes, the video "plays". */
function CreatorsDemo() {
  const { t } = useLang();
  const c = t.can.creators;
  const reduced = useReducedMotion();
  const { ref, live } = useLive<HTMLDivElement>();
  const Link = ({ i }: { i: number }) => (
    <div aria-hidden className="relative hidden h-px w-10 shrink-0 self-center bg-[repeating-linear-gradient(90deg,var(--color-ink-3)_0_2px,transparent_2px_7px)] opacity-60 sm:block lg:w-14">
      {!reduced && live && (
        <motion.span
          className="absolute -top-[3px] left-0 size-[7px] rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]"
          animate={{ x: [0, 40, 40], opacity: [0, 1, 0] }} transition={{ duration: 2.4, repeat: Infinity, delay: i * 1.1, ease: EASE }}
        />
      )}
    </div>
  );
  const Step = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="flex flex-col items-center gap-2.5">
      <div className="relative">{children}</div>
      <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-ink-3">{label}</span>
    </div>
  );
  return (
    <div ref={ref} data-live={live} className="relative flex min-h-[300px] flex-col items-center justify-center gap-6 overflow-hidden rounded-3xl bg-ink/[0.035] px-4 py-8 ring-1 ring-ink/8 sm:flex-row sm:gap-3 sm:px-8">
      <div aria-hidden className="absolute left-1/2 top-1/2 size-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--halo),transparent)]" />
      <Step label={c.photo}>
        <div className="w-[104px] -rotate-[4deg] overflow-hidden rounded-2xl bg-[#d3cfcc] shadow-[0_18px_30px_-16px_rgba(0,0,0,0.6)] ring-1 ring-ink/10 aspect-[3/4] sm:w-[120px]">
          <img src="/mascot/kawaii.jpg" alt="" className="size-full object-cover object-top" loading="lazy" />
        </div>
      </Step>
      <Link i={0} />
      <Step label={c.voice}>
        <div className="grid h-[132px] w-[150px] place-items-center rounded-2xl bg-surface p-3 shadow-[0_18px_30px_-16px_rgba(0,0,0,0.5)] ring-1 ring-ink/10 sm:w-[168px]">
          <div className="flex h-12 items-center gap-[3px]">
            {Array.from({ length: 17 }, (_, i) => {
              const h = 22 + Math.abs(Math.sin(i * 1.3)) * 78;
              return (
                <motion.i
                  key={i} className="block w-[3px] rounded-full bg-accent" style={{ height: `${h}%`, transformOrigin: "center" }}
                  animate={reduced || !live ? undefined : { scaleY: [1, 0.35 + (i % 4) * 0.18, 1] }}
                  transition={{ duration: 1.1 + (i % 5) * 0.12, repeat: Infinity, ease: "easeInOut", delay: i * 0.04 }}
                />
              );
            })}
          </div>
          <span className="text-[12px] font-bold text-ink">{c.voiceName}</span>
        </div>
      </Step>
      <Link i={1} />
      <Step label={c.video}>
        <div className="relative w-[104px] overflow-hidden rounded-2xl bg-[#d3cfcc] shadow-[0_22px_36px_-16px_rgba(224,40,132,0.55)] ring-1 ring-ink/10 aspect-[9/16] sm:w-[118px]">
          <img src="/mascot/hello.jpg" alt="" className="size-full object-cover object-top" loading="lazy" />
          <span className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/30">
            <motion.i className="block h-full origin-left rounded-full bg-accent" animate={reduced || !live ? { scaleX: 0.6 } : { scaleX: [0, 1] }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }} />
          </span>
          <span className="absolute right-2 top-2 rounded-full bg-success px-2 py-0.5 text-[9.5px] font-bold text-[#04140d]">{c.ready}</span>
        </div>
      </Step>
    </div>
  );
}

/* ───────────────────────────── section ────────────────────────── */
function Pill({ children }: { children: ReactNode }) {
  return <span className="cursor-default whitespace-nowrap rounded-full bg-surface/80 px-5 py-3 text-[14.5px] font-semibold text-ink ring-1 ring-ink/8 transition-all duration-500 ease-spring hover:-translate-y-0.5 hover:bg-accent hover:text-white hover:ring-accent">{children}</span>;
}

export function Can() {
  const { t } = useLang();
  const k = t.can.tiles;
  return (
    <section id="can" className="relative py-28 sm:py-40">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-full bg-[linear-gradient(180deg,transparent,var(--wash)_35%,var(--wash)_75%,transparent)]" />
      <div className="mx-auto max-w-[1280px] px-5 sm:px-8">
        <HorizonHead />

        <div className="mt-6 grid gap-4 lg:grid-cols-12">
          <Tile className="lg:col-span-7 lg:row-span-2" title={k.clipper.title} body={k.clipper.body}><ClipperDemo /></Tile>
          <Tile className="lg:col-span-5" title={k.payout.title} body={k.payout.body}><PayoutDemo /></Tile>
          <Tile className="lg:col-span-5" title={k.campaign.title} body={k.campaign.body}><CampaignDemo /></Tile>
          <Tile className="lg:col-span-7" title={k.chat.title} body={k.chat.body}><ChatDemo /></Tile>
          <Tile className="lg:col-span-5" title={k.doors.title} body={k.doors.body} visualClass="flex items-center justify-center"><DoorsDemo /></Tile>
          <Tile className="lg:col-span-12" split title={k.creators.title} body={k.creators.body}><CreatorsDemo /></Tile>
          <Tile className="lg:col-span-12" split title={k.chains.title} body={k.chains.body}><ChainsDemo /></Tile>
        </div>
      </div>

      <div className="mt-20 space-y-4">
        <Marquee pauseOnHover className="hairline-fade [--duration:50s] [--gap:1rem]">{t.strip.row1.map((x) => <Pill key={x}>{x}</Pill>)}</Marquee>
        <Marquee reverse pauseOnHover className="hairline-fade [--duration:56s] [--gap:1rem]">{t.strip.row2.map((x) => <Pill key={x}>{x}</Pill>)}</Marquee>
      </div>
    </section>
  );
}
