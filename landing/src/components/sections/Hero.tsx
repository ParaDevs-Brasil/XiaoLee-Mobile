import { Fragment, useRef, useState, type CSSProperties, type RefObject } from "react";
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { Scissors, ShieldCheck, Target, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { CtaButton, GhostAction, Reveal } from "@/components/kit";
import { ClipStream } from "@/components/ui/clip-stream";
import { AppPhone } from "@/components/app/AppPhone";
import { HomeScreen } from "@/components/app/screens";
import { SparkleField } from "@/components/ui/sparkle-field";
import { Marquee } from "@/components/ui/marquee";
import { useWaitlist } from "@/components/Waitlist";
import { useDownload } from "@/components/Download";
import { DOWNLOAD_ENABLED } from "@/lib/links";
import { IconCheck } from "@/components/icons";

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

/**
 * The stage: the real app on a tilted metal-rimmed phone, Xiaolee cut out behind it, a pink light on the phone's edge.
 * The phone starts turned and straightens as the page scrolls; the pointer adds a little more. All transform-only.
 */
function Stage({ section }: { section: RefObject<HTMLElement | null> }) {
  const { t } = useLang();
  const reduced = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 70, damping: 18 });
  const sy = useSpring(my, { stiffness: 70, damping: 18 });
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end start"] });
  const rotY = useTransform([scrollYProgress, sx], ([p, x]: number[]) => -17 + Math.min(1, p / 0.55) * 14 + x * 10);
  const rotX = useTransform(sy, [-0.5, 0.5], [8, 0]);
  const girlX = useTransform(sx, [-0.5, 0.5], [12, -12]);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };

  return (
    <div onPointerMove={onMove} className="relative mx-auto aspect-[1/1.04] w-full max-w-[600px] [perspective:1500px]">
      {/* light behind everything: a pool of pink and a faint floor line the figure stands on */}
      <div aria-hidden className="absolute inset-[-8%] bg-[radial-gradient(closest-side_at_62%_46%,var(--halo),transparent_72%)]" />
      <div aria-hidden className="absolute inset-x-0 bottom-[3%] h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />

      {/* a pink pool behind her so the dark jacket and hair still read on the dark page */}
      <div aria-hidden className="absolute bottom-[6%] right-[2%] aspect-square w-[62%] rounded-full bg-[radial-gradient(closest-side,rgba(224,40,132,0.5),transparent_72%)]" />
      <motion.div style={{ x: reduced ? 0 : girlX }} className="absolute bottom-0 right-[-3%] z-0 w-[64%]">
        {/* the glow sits on this wrapper, outside the image's fade mask, so it follows her outline and is never cut into a box */}
        <div className="drop-shadow-[0_0_26px_rgba(224,40,132,0.45)]">
          <img
            src="/mascot/xiaolee-hero.webp" width={900} height={1350} alt=""
            className="w-full select-none"
            style={{ WebkitMaskImage: "linear-gradient(180deg,#000 80%,transparent 100%)", maskImage: "linear-gradient(180deg,#000 80%,transparent 100%)" }}
            draggable={false}
          />
        </div>
      </motion.div>

      <motion.div
        style={reduced ? { rotateY: -12, rotateX: 4 } : { rotateY: rotY, rotateX: rotX, transformStyle: "preserve-3d" }}
        className="absolute bottom-[7%] left-[2%] z-10 w-[46%] sm:w-[40%]"
      >
        <AppPhone rim className="max-w-none"><HomeScreen /></AppPhone>
      </motion.div>

      <div aria-hidden className="absolute left-[1%] top-[0%] z-20 hidden -rotate-[6deg] font-script text-[clamp(20px,2.1vw,28px)] leading-[1.05] text-accent sm:block">
        <span className="flex gap-x-3">{t.hero.tag.map((w) => <span key={w}>{w}</span>)}</span>
        <svg viewBox="0 0 120 14" className="mt-1 w-[96px]" fill="none"><path d="M3 9c26-8 52-8 74-3 14 3 28 3 40-1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
      </div>
    </div>
  );
}

const FEATURE_ICONS = [Scissors, Target, Wallet, ShieldCheck];

/** Four plain statements under the hero: icon tile, name, one sentence. Hairlines between, a pink glint on top. */
function Features() {
  const { t } = useLang();
  return (
    <div className="relative mx-auto max-w-[1280px] px-5 sm:px-8">
      <div aria-hidden className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent sm:inset-x-8" />
      <ul className="grid gap-x-0 gap-y-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        {t.hero.features.map((f, i) => {
          const Icon = FEATURE_ICONS[i];
          return (
            <Reveal key={f.title} delay={0.05 * i}>
              <li className={cn("flex h-full flex-col gap-4 sm:px-6 lg:px-8", i === 0 && "lg:pl-0", i > 0 && "lg:border-l lg:border-line")}>
                <span className="grid size-[52px] place-items-center rounded-2xl bg-accent-soft text-accent ring-1 ring-accent/20"><Icon size={22} strokeWidth={1.6} aria-hidden /></span>
                <div>
                  <h3 className="text-[18px] font-bold tracking-tight text-ink">{f.title}</h3>
                  <p className="mt-1.5 max-w-[260px] text-[14.5px] leading-relaxed text-ink-2">{f.body}</p>
                </div>
              </li>
            </Reveal>
          );
        })}
      </ul>
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
  const { start: startDownload } = useDownload();
  const reduced = useReducedMotion();
  const section = useRef<HTMLElement | null>(null);
  const [wide] = useState(() => window.matchMedia("(min-width: 1024px)").matches);

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
    <section ref={section} id="top" onPointerMove={onMove} className="relative isolate overflow-hidden">
      {/* aurora: layered radial gradients, no blur filters on large areas */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <motion.div style={{ x: a1x, y: a1y }} className="absolute -right-[10%] -top-[20%] h-[900px] w-[900px] rounded-full bg-[radial-gradient(closest-side,var(--aurora-1),transparent_70%)]" />
        <motion.div style={{ x: a2x, y: a2y }} className="absolute -left-[15%] top-[35%] h-[800px] w-[800px] rounded-full bg-[radial-gradient(closest-side,var(--aurora-2),transparent_70%)]" />
        <motion.div style={{ x: a3x, y: a3y }} className="absolute right-[20%] top-[55%] h-[600px] w-[600px] rounded-full bg-[radial-gradient(closest-side,var(--aurora-3),transparent_70%)]" />
        <div className="absolute inset-0 [mask-image:linear-gradient(90deg,transparent_0%,transparent_30%,rgba(0,0,0,0.45)_50%,#000_72%)] max-lg:[mask-image:linear-gradient(180deg,transparent_0%,rgba(0,0,0,0.3)_35%,#000_70%)]">
          <ClipStream className="opacity-55" cx={wide ? 0.72 : 0.5} cy={wide ? 0.48 : 0.7} count={46} />
        </div>
        <SparkleField />
      </div>

      <div className="mx-auto grid min-h-[min(100dvh,860px)] max-w-[1280px] items-center gap-12 px-5 pb-10 pt-32 sm:px-8 lg:min-h-[min(100dvh,700px)] lg:grid-cols-[0.92fr_1.08fr] lg:gap-6 lg:pb-6 lg:pt-24">
        <div>
          <Reveal>
            <p className="mb-7 flex items-center gap-3 font-mono lg:mb-4 text-[11.5px] font-medium uppercase tracking-[0.22em] text-ink-2">
              {t.hero.eyebrow[0]}<span aria-hidden className="size-1.5 rounded-full bg-accent" />{t.hero.eyebrow[1]}
            </p>
          </Reveal>
          <h1 className="display text-[clamp(46px,6.4vw,92px)] text-ink">
            <Lines delay={0.1}><Caption words={wa} from={0} total={total} /></Lines>
            <Lines delay={0.2} className="-mt-[0.1em] lg:-mt-[0.26em]"><span className="serif-em text-accent"><Caption words={wb} from={wa.length} total={total} /></span></Lines>
          </h1>

          <Reveal delay={0.5}>
            <p className="mt-8 max-w-[520px] lg:mt-4 text-[clamp(16px,1.45vw,19px)] leading-relaxed text-ink-2">{t.hero.sub}</p>
          </Reveal>
          <Reveal delay={0.66}>
            <div className="mt-9 flex flex-wrap items-center gap-3 lg:mt-6">
              {DOWNLOAD_ENABLED ? (
                <>
                  <CtaButton onClick={startDownload}>{t.hero.cta1}</CtaButton>
                  <GhostAction onClick={open}>{t.hero.cta2}</GhostAction>
                </>
              ) : (
                <>
                  <CtaButton onClick={open}>{t.hero.cta2}</CtaButton>
                  <GhostAction onClick={() => document.getElementById("app")?.scrollIntoView({ behavior: "smooth" })}>{t.hero.meet}</GhostAction>
                </>
              )}
            </div>
          </Reveal>
          <Reveal delay={0.8}>
            <ul className="mt-9 flex flex-wrap gap-x-7 gap-y-3 text-[14px] lg:mt-5 font-semibold text-ink-2">
              {t.hero.trust.map((x) => (
                <li key={x} className="flex items-center gap-2.5">
                  <span className="grid size-6 place-items-center rounded-full bg-accent/15 text-accent ring-1 ring-accent/30"><IconCheck size={13} /></span>{x}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal delay={0.35} y={40}><Stage section={section} /></Reveal>
      </div>

      <Features />

      <div className="border-y border-line/80 bg-surface/40 py-9">
        <p className="mb-6 text-center text-[11px] font-bold uppercase tracking-[0.24em] text-ink-3">{t.partners}</p>
        <Marquee pauseOnHover className="hairline-fade [--duration:36s] [--gap:5rem]">
          {[...LOGOS, ...LOGOS].map((l, i) => (
            <img key={i} src={`/assets/logos/${l.src}`} alt={i < LOGOS.length ? l.alt : ""} loading="lazy"
              className={`${l.cls} w-auto opacity-45 brightness-0 in-data-[theme=dark]:invert transition-[opacity,scale] duration-500 ease-spring hover:scale-110 hover:opacity-90`} />
          ))}
        </Marquee>
      </div>
    </section>
  );
}
