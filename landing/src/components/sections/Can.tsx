import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { useLive, useSequence } from "@/lib/hooks";
import { Bezel, MascotVideo, Reveal } from "@/components/kit";
import { BorderBeam } from "@/components/ui/border-beam";
import { Marquee } from "@/components/ui/marquee";
import { NumberTicker } from "@/components/ui/number-ticker";
import {
  IconCheck, IconGlobe, IconPhone, IconTelegram, IconX,
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
    <Reveal className={cn("h-full min-w-0", className)}>
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

/* ─────────────────────────── campaign ─────────────────────────── */
const CAMPAIGN_DELAYS = [900, 800, 800, 800, 900, 1500];

/** A brand's one-sentence brief becomes chips, one by one; Xiaolee "types", then asks to publish. */
function CampaignDemo() {
  const { t } = useLang();
  const c = t.can.campaign;
  const { ref, step } = useSequence(c.chips.length + 2, CAMPAIGN_DELAYS, 3600);
  const typing = step === c.chips.length; // every chip is in: she is composing her reply
  const asked = step > c.chips.length;
  const live = step > c.chips.length + 1; // she published it
  return (
    <div ref={ref} className="rounded-3xl bg-line/45 p-4 ring-1 ring-ink/5">
      <div className="flex flex-wrap gap-2">
        {c.chips.map((x, i) => (
          <motion.span
            key={x}
            initial={false}
            animate={{ opacity: step > i ? 1 : 0.4, scale: step > i ? 1 : 0.94, y: step > i ? 0 : 6 }}
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
        {/* height reserved from the start, so the card never jumps when the status appears */}
        <p className={cn("mt-3 flex items-center gap-2 border-t border-line pt-3 font-mono text-[11.5px] font-medium uppercase tracking-[0.14em] transition-all duration-700 ease-spring", live ? "translate-y-0 text-success opacity-100" : "translate-y-1 text-ink-3 opacity-0")}>
          <span className="relative flex size-2"><span className={cn("absolute inline-flex size-full rounded-full bg-success", live && "animate-pulse-ring")} /><span className="relative inline-flex size-2 rounded-full bg-success" /></span>
          {c.live}
        </p>
        {asked && !live && <BorderBeam size={80} duration={4} colorFrom="#d81b78" colorTo="#f7c9e0" borderWidth={1.5} />}
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
      {/* the receipt: always laid out (so nothing shifts), it lights up when the payment settles */}
      <dl className={cn("mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 rounded-2xl bg-ink/[0.035] px-4 py-3 font-mono text-[11.5px] leading-snug ring-1 ring-ink/8 transition-all duration-700 ease-spring", claimed ? "opacity-100" : "opacity-40")}>
        <dt className="text-ink-3">{p.receipt.verified}</dt><dd className={cn("transition-colors duration-700", claimed ? "text-success" : "text-ink-3")}>{p.receipt.checks}</dd>
        <dt className="text-ink-3">{p.receipt.paid}</dt><dd className="text-ink">{p.receipt.amount}</dd>
        <dt className="text-ink-3">{p.receipt.receipt}</dt><dd className="truncate text-ink">{p.receipt.hash}</dd>
        <dd className="col-span-2 mt-0.5 text-[10px] uppercase tracking-[0.16em] text-ink-3">{p.receipt.example}</dd>
      </dl>
    </div>
  );
}

/* ──────────────────────────── clipper ─────────────────────────── */
// where each of the three cuts sits on the source track, in % of its length
const CUTS = [[8, 20], [41, 53], [74, 86]] as const;
// three different stills, framings and tints, so the three cuts read as three moments and not one picture three times
const CLIP_LOOKS = [
  { img: "hello", pos: "50% 38%", zoom: 1.0, flip: false, tint: "from-[#ff4fa3]/45" },
  { img: "love", pos: "50% 38%", zoom: 1.0, flip: false, tint: "from-[#7c5cff]/45" },
  { img: "cheer", pos: "50% 30%", zoom: 1.0, flip: true, tint: "from-[#18b8d0]/40" },
] as const;

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
          <div className="flex items-center gap-2"><span className="truncate text-[13px] font-bold text-ink">{c.source}</span><span className="shrink-0 rounded-full bg-ink/[0.06] px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-ink-3">{c.example}</span></div>
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
        {c.clips.map((label, i) => {
          const look = CLIP_LOOKS[i];
          return (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.5 + i * 0.12 }}
              className={cn("group/clip relative transition-[transform,translate,rotate,scale] duration-500 ease-spring hover:z-10 hover:-translate-y-2 hover:rotate-0", i === 0 && "sm:-rotate-3", i === 2 && "sm:rotate-3", i === 1 && "sm:-translate-y-2")}
            >
              <div className="clip-lift loop" style={{ "--start": CUTS[i][0] / 100 } as CSSProperties}>
                <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-[#d3cfcc] shadow-[0_18px_30px_-18px_rgba(0,0,0,0.6)] ring-1 ring-ink/10 transition-[box-shadow] duration-500 ease-spring group-hover/clip:shadow-[0_30px_40px_-18px_rgba(224,40,132,0.55)] group-hover/clip:ring-accent/40">
                  {/* a different gesture in each cut (peace, heart, cheer): the loops play only while the tile is on screen */}
                  <div className="size-full" style={look.flip ? { transform: "scaleX(-1)" } : undefined}>
                    <MascotVideo name={look.img} position={look.pos} zoom={look.zoom} />
                  </div>
                  <div className={cn("absolute inset-0 bg-gradient-to-br to-transparent mix-blend-soft-light", look.tint)} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent" />
                  <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[9.5px] font-medium tabular-nums text-white">{c.durs[i]}</span>
                  <span className="absolute right-2 top-2 rounded-md bg-accent px-1.5 py-0.5 text-[9px] font-bold leading-tight text-white">{label}</span>
                  {/* burned-in caption, the way a real short has it */}
                  <p className="clip-caption absolute inset-x-1.5 bottom-6 text-center text-[clamp(10px,1.35vw,15px)] font-extrabold uppercase leading-[1.1] tracking-tight">
                    {c.captions[i].map((w, k) => (
                      <span key={w + k} className="clip-word loop mr-[0.28em] inline-block" style={{ "--start": CUTS[i][0] / 100, "--i": k } as CSSProperties}>{w}</span>
                    ))}
                  </p>
                  <div className="absolute inset-x-2 bottom-2 h-0.5 overflow-hidden rounded-full bg-white/30">
                    <div className="clip-progress loop h-full w-full rounded-full bg-white" style={{ "--start": CUTS[i][0] / 100 } as CSSProperties} />
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-success"><IconCheck size={14} className="clip-check loop" /> {c.ready}</p>
        <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
          <span className="whitespace-nowrap">{c.sendTo}</span>
          {c.share.map((x) => <span key={x} className="rounded-full bg-ink/[0.06] px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 ring-1 ring-ink/8">{x}</span>)}
        </p>
      </div>
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

/* ───────────────────────────── channels ───────────────────────── */
/** Where she lives: one slim row instead of three tiles. */
function Channels() {
  const { t } = useLang();
  const d = t.can.tiles.doors;
  const icons = [<IconPhone key="m" size={16} />, <IconGlobe key="w" size={16} />, <IconTelegram key="t" size={16} />, <IconX key="x" size={16} />];
  return (
    <Reveal className="mt-4">
      <Bezel radius={32} pad={6} coreClassName="flex flex-col gap-5 px-6 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[18px] font-bold tracking-tight text-ink">{d.title}</p>
          <p className="mt-1 max-w-lg text-[14.5px] leading-relaxed text-ink-2">{d.body}</p>
        </div>
        <ul className="flex flex-wrap gap-2">
          {t.can.channels.map((label, i) => (
            <li key={label} className="inline-flex items-center gap-2 rounded-full bg-ink/[0.05] px-4 py-2.5 text-[14px] font-semibold text-ink ring-1 ring-ink/8">
              <span className="text-accent">{icons[i]}</span>{label}
            </li>
          ))}
        </ul>
      </Bezel>
    </Reveal>
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
          <Tile className="lg:col-span-7" title={k.clipper.title} body={k.clipper.body}><ClipperDemo /></Tile>
          <Tile className="lg:col-span-5" title={k.payout.title} body={k.payout.body} visualClass="flex flex-col justify-center"><PayoutDemo /></Tile>
          <Tile className="lg:col-span-5" title={k.campaign.title} body={k.campaign.body}><CampaignDemo /></Tile>
          <Tile className="lg:col-span-7" title={k.creators.title} body={k.creators.body}><CreatorsDemo /></Tile>
        </div>
        <Channels />
      </div>

      <div className="mt-20 space-y-4">
        <Marquee pauseOnHover className="hairline-fade [--duration:50s] [--gap:1rem]">{t.strip.row1.map((x) => <Pill key={x}>{x}</Pill>)}</Marquee>
        <Marquee reverse pauseOnHover className="hairline-fade [--duration:56s] [--gap:1rem]">{t.strip.row2.map((x) => <Pill key={x}>{x}</Pill>)}</Marquee>
      </div>
    </section>
  );
}
