import { Fragment, useRef, type CSSProperties } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { useTypewriter } from "@/lib/hooks";
import { Bezel, CtaButton, GhostButton, MascotVideo, Reveal } from "@/components/kit";
import { SparkleField } from "@/components/ui/sparkle-field";
import { Marquee } from "@/components/ui/marquee";
import { useWaitlist } from "@/components/Waitlist";
import { IconCheck, IconSend, IconSpark } from "@/components/icons";
import { ClipCard, Depth, PayoutTicket, VerifiedStamp } from "./hero-objects";

const EASE = [0.32, 0.72, 0, 1] as const;

/*
 * One authored sequence (seconds): the headline rises (0.1-1.3), then reads itself like a clip caption, a marker
 * passing under each word and resting under the last. Around the portrait the product loop plays in order, a clip
 * is cut, the post is verified (the stamp lands and the portrait takes the hit), the payout prints as the caption
 * reaches its last word.
 */
const CAPTION = { start: 1.25, step: 0.36 };
const BEAT = { clip: 1.1, stamp: 2.15, ticket: 2.7 };

/** Each headline line rises out of its own mask; the side padding keeps the caption marker from being clipped. */
function Lines({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <span className={cn("-mx-[0.1em] block overflow-hidden px-[0.1em] pb-[0.12em] pt-[0.04em]", className)}>
      <motion.span
        className="block"
        initial={{ y: "110%", rotate: 2 }}
        animate={{ y: 0, rotate: 0 }}
        transition={{ duration: 1.1, ease: EASE, delay }}
      >
        {children}
      </motion.span>
    </span>
  );
}

/** Words of one headline line; `from` is the index of its first word in the whole headline. */
function Caption({ words, from, total }: { words: string[]; from: number; total: number }) {
  return (
    <>
      {words.map((w, i) => {
        const n = from + i;
        return (
          <Fragment key={`${w}-${n}`}>
            {i > 0 && " "}
            <span className={cn("cap", n === total - 1 && "cap-last")} style={{ "--d": `${CAPTION.start + n * CAPTION.step}s` } as CSSProperties}>
              {w}
            </span>
          </Fragment>
        );
      })}
    </>
  );
}

function PromptPill() {
  const { t } = useLang();
  const text = useTypewriter(t.hero.prompts);
  return (
    <Bezel glow radius={999} pad={5} className="group/p max-w-[520px] transition-transform duration-500 ease-spring hover:-translate-y-0.5" coreClassName="flex items-center gap-3 py-2 pl-5 pr-2">
      <IconSpark size={18} className="shrink-0 text-accent" />
      <span className="min-h-[1.4em] flex-1 truncate text-[15.5px] font-medium text-ink" aria-label={t.hero.inputHint}>
        {text}
        <span className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse bg-accent" />
      </span>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-white transition-all duration-500 ease-spring group-hover/p:rotate-12 group-hover/p:bg-accent"><IconSend size={17} /></span>
    </Bezel>
  );
}

/** Portrait stage: a gentle pointer tilt, with the loop's objects floating at their own depths in front of it. */
function Portrait() {
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement | null>(null);
  const live = useInView(box, { margin: "120px 0px" });
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 90, damping: 18 });
  const sy = useSpring(my, { stiffness: 90, damping: 18 });
  const rotY = useTransform(sx, [-0.5, 0.5], [-7, 7]);
  const rotX = useTransform(sy, [-0.5, 0.5], [6, -6]);
  const bump = useMotionValue(1);

  const onMove = (e: React.PointerEvent) => {
    if (reduced || e.pointerType !== "mouse" || !box.current) return;
    const r = box.current.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => { mx.set(0); my.set(0); };
  /** The stamp hits the portrait: it compresses for a beat and springs back. */
  const thunk = () => { animate(bump, [1, 0.982, 1.004, 1], { duration: 0.6, ease: EASE, times: [0, 0.22, 0.6, 1] }); };

  return (
    <div ref={box} data-live={live} onPointerMove={onMove} onPointerLeave={onLeave} className="relative mx-auto w-full max-w-[440px] [perspective:1200px]">
      <motion.div style={{ rotateX: rotX, rotateY: rotY, scale: bump, transformStyle: "preserve-3d" }} className="relative">
        {/* halo */}
        <div aria-hidden className="absolute -inset-10 -z-10 rounded-[60px] bg-[radial-gradient(closest-side,rgba(216,27,120,0.28),rgba(247,201,224,0.25)_55%,transparent)]" />
        <Bezel radius={48} pad={8} className="shadow-[0_60px_120px_-40px_rgba(120,20,70,0.45)]" coreClassName="aspect-[4/5] bg-[#d3cfcc]">
          <MascotVideo name="hello" position="50% 4%" zoom={1.32} />
        </Bezel>

        <Depth z={70} className="-left-[2%] top-[54%] sm:-left-[15%]"><ClipCard delay={BEAT.clip} /></Depth>
        <Depth z={125} className="right-[1%] top-[11%] sm:-right-[9%]"><VerifiedStamp delay={BEAT.stamp} onLand={thunk} /></Depth>
        <Depth z={95} className="-bottom-[6%] right-[2%] sm:-right-[4%]"><PayoutTicket delay={BEAT.ticket} /></Depth>
      </motion.div>
    </div>
  );
}

const LOGOS: { src: string; alt: string; cls: string }[] = [
  { src: "superteam.svg", alt: "Superteam", cls: "h-7" },
  { src: "colosseum.svg", alt: "Colosseum", cls: "h-9" },
  { src: "metapool.svg", alt: "Meta Pool", cls: "h-9" },
  { src: "parabuilders.png", alt: "ParaBuilders", cls: "h-9" },
  { src: "arc.svg", alt: "Arc", cls: "h-8" },
];

export function Hero() {
  const { t } = useLang();
  const { open } = useWaitlist();
  const reduced = useReducedMotion();

  // the aurora drifts against the cursor at three depths (transform only)
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 45, damping: 22, mass: 1.2 });
  const sy = useSpring(my, { stiffness: 45, damping: 22, mass: 1.2 });
  const a1x = useTransform(sx, [-0.5, 0.5], [-38, 38]);
  const a1y = useTransform(sy, [-0.5, 0.5], [-28, 28]);
  const a2x = useTransform(sx, [-0.5, 0.5], [30, -30]);
  const a2y = useTransform(sy, [-0.5, 0.5], [22, -22]);
  const a3x = useTransform(sx, [-0.5, 0.5], [-16, 16]);
  const a3y = useTransform(sy, [-0.5, 0.5], [-12, 12]);
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };

  const wa = t.hero.h1a.split(" ");
  const wb = t.hero.h1b.split(" ");
  const total = wa.length + wb.length;

  return (
    <section id="top" onPointerMove={onMove} className="relative isolate overflow-hidden">
      {/* aurora: layered radial gradients, no blur filters on large areas */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <motion.div style={{ x: a1x, y: a1y }} className="absolute -right-[10%] -top-[20%] h-[900px] w-[900px] rounded-full bg-[radial-gradient(closest-side,rgba(247,201,224,0.9),rgba(247,201,224,0)_70%)]" />
        <motion.div style={{ x: a2x, y: a2y }} className="absolute -left-[15%] top-[35%] h-[800px] w-[800px] rounded-full bg-[radial-gradient(closest-side,rgba(255,226,206,0.7),rgba(255,226,206,0)_70%)]" />
        <motion.div style={{ x: a3x, y: a3y }} className="absolute right-[20%] top-[55%] h-[600px] w-[600px] rounded-full bg-[radial-gradient(closest-side,rgba(47,93,143,0.10),rgba(47,93,143,0)_70%)]" />
        <SparkleField />
      </div>

      <div className="mx-auto grid min-h-[100dvh] max-w-[1280px] items-center gap-16 px-5 pb-20 pt-32 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10 lg:pt-28">
        <div>
          <h1 className="display text-[clamp(46px,6.5vw,96px)] text-ink">
            <Lines delay={0.1}><Caption words={wa} from={0} total={total} /></Lines>
            <Lines delay={0.2} className="-mt-[0.1em]"><span className="serif-em text-accent"><Caption words={wb} from={wa.length} total={total} /></span></Lines>
          </h1>

          <Reveal delay={0.5}>
            <p className="mt-8 max-w-[560px] text-[clamp(16px,1.5vw,19.5px)] leading-relaxed text-ink-2">{t.hero.sub}</p>
          </Reveal>
          <Reveal delay={0.62} className="mt-8"><PromptPill /></Reveal>
          <Reveal delay={0.74}>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <CtaButton onClick={open}>{t.hero.cta1}</CtaButton>
              <GhostButton href="#can">{t.hero.cta2}</GhostButton>
            </div>
          </Reveal>
          <Reveal delay={0.86}>
            <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] font-semibold text-ink-2">
              {t.hero.trust.map((x) => (
                <li key={x} className="group/t flex cursor-default items-center gap-1.5 transition-colors duration-500 ease-spring hover:text-ink"><IconCheck size={15} className="text-success transition-transform duration-500 ease-spring group-hover/t:scale-125" /> {x}</li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal delay={0.35} y={40}><Portrait /></Reveal>
      </div>

      <div className="border-y border-line/80 bg-white/40 py-9">
        <p className="mb-6 text-center text-[11px] font-bold uppercase tracking-[0.24em] text-ink-3">{t.partners}</p>
        <Marquee pauseOnHover className="hairline-fade [--duration:36s] [--gap:5rem]">
          {[...LOGOS, ...LOGOS].map((l, i) => (
            <img key={i} src={`/assets/logos/${l.src}`} alt={i < LOGOS.length ? l.alt : ""} loading="lazy"
              className={`${l.cls} w-auto opacity-45 brightness-0 transition-[opacity,scale] duration-500 ease-spring hover:scale-110 hover:opacity-90`} />
          ))}
        </Marquee>
      </div>
    </section>
  );
}
