import { useRef, useState, type ReactNode } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Reveal, SectionHead } from "@/components/kit";
import { AppPhone } from "@/components/app/AppPhone";
import {
  ClipsScreen, CreatorScreen, GrowScreen, ReportsScreen, ShareScreen, VoiceScreen,
} from "@/components/app/screens";

/** Scroll distance given to each chapter, in viewport heights. */
const STEP_VH = 70;

const SCREEN: Record<string, () => ReactNode> = {
  clips: () => <ClipsScreen />,
  creators: () => <CreatorScreen />,
  voices: () => <VoiceScreen />,
  reports: () => <ReportsScreen />,
  share: () => <ShareScreen />,
  grow: () => <GrowScreen />,
};

/** Every screen stacked in one phone; only the active one shows. Cross-fades with CSS, so it never goes blank mid-change. */
function Screens({ active, ids }: { active: number; ids: string[] }) {
  return (
    <div className="relative h-full">
      {ids.map((id, i) => (
        <div
          key={id} aria-hidden={i !== active}
          className={cn(
            "absolute inset-0 transition-[opacity,filter,transform] duration-500 ease-spring motion-reduce:transition-none",
            i === active ? "opacity-100 blur-0" : "pointer-events-none translate-y-2 opacity-0 blur-[6px]",
          )}
        >
          {SCREEN[id]()}
        </div>
      ))}
    </div>
  );
}

/**
 * The studio tour is driven by scroll: the phone stays pinned and changes screen as the page moves, one chapter per
 * stretch of scrolling. Nobody has to click through tabs. The chapters are still buttons (they scroll to their stretch),
 * so mouse, keyboard and screen readers all reach every one. With reduced motion there is no pinning: each chapter is
 * a plain row with its own phone.
 */
export function Studio() {
  const { t } = useLang();
  const s = t.studio;
  const reduced = useReducedMotion();
  const n = s.items.length;
  const ids = s.items.map((i) => i.id);
  const track = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  const { scrollYProgress } = useScroll({ target: track, offset: ["start start", "end end"] });
  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const i = Math.max(0, Math.min(n - 1, Math.floor(p * n)));
    setActive((cur) => (cur === i ? cur : i));
  });
  const fill = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 });
  const turn = useTransform(scrollYProgress, [0, 1], [-9, 9]);

  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const range = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + ((i + 0.5) / n) * range, behavior: reduced ? "auto" : "smooth" });
  };

  const header = (
    <div className="mx-auto max-w-6xl px-5 pb-10 pt-24 sm:px-8 sm:pt-32 lg:pb-0">
      <SectionHead a={s.h2a} b={s.h2b} sub={s.sub} />
    </div>
  );

  if (reduced) {
    return (
      <section id="app" aria-label={s.eyebrow} className="relative">
        {header}
        <ol className="mx-auto max-w-6xl space-y-16 px-5 py-14 sm:px-8">
          {s.items.map((it, i) => (
            <li key={it.id} className="grid items-center gap-8 lg:grid-cols-[1fr_auto] lg:gap-20">
              <div className="max-w-md">
                <span className="font-script text-[22px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-1 text-[clamp(26px,3vw,36px)] font-bold tracking-tight">{it.title}</h3>
                <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{it.body}</p>
              </div>
              <AppPhone className="mx-auto lg:mx-0"><Screens active={0} ids={[it.id]} /></AppPhone>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section id="app" aria-label={s.eyebrow} className="relative">
      {header}

      <div ref={track} style={{ height: `calc(100dvh + ${(n - 1) * STEP_VH}dvh)` }} className="relative">
        <div className="sticky top-0 flex h-[100dvh] items-center overflow-hidden">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-5 px-5 pt-20 sm:px-8 lg:grid-cols-[1fr_auto] lg:gap-20 lg:pt-24">
            {/* chapters */}
            <div className="order-2 lg:order-1">
              <ol className="relative hidden space-y-1 lg:block">
                <span aria-hidden className="absolute bottom-5 left-[17px] top-5 w-px bg-line" />
                <motion.span aria-hidden style={{ scaleY: fill }} className="absolute bottom-5 left-[17px] top-5 w-px origin-top bg-accent" />
                {s.items.map((it, i) => {
                  const on = i === active;
                  return (
                    <li key={it.id}>
                      <button
                        type="button" onClick={() => go(i)} aria-current={on ? "step" : undefined}
                        className="group relative flex w-full items-start gap-5 rounded-2xl py-3 pr-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <span className={cn(
                          "relative z-[1] grid size-9 shrink-0 place-items-center rounded-full font-mono text-[12px] font-medium ring-1 transition-all duration-500 ease-spring",
                          on ? "scale-110 bg-accent text-white ring-accent" : i < active ? "bg-accent/15 text-accent ring-accent/40" : "bg-surface-hi text-ink-3 ring-line",
                        )}>{i + 1}</span>
                        <span className="min-w-0 pt-1.5">
                          <span className={cn("block font-bold tracking-tight transition-all duration-500 ease-spring", on ? "text-[clamp(26px,2.6vw,34px)] text-ink" : "text-[18px] text-ink-3 group-hover:text-ink-2")}>{it.title}</span>
                          <span className={cn("grid transition-all duration-500 ease-spring", on ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                            <span className="overflow-hidden"><span className="block max-w-[420px] text-[16px] leading-relaxed text-ink-2">{it.body}</span></span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              {/* small screens: only the active chapter, with a dot per chapter */}
              <div className="lg:hidden">
                <div className="flex items-center gap-1.5" role="group" aria-label={s.eyebrow}>
                  {s.items.map((it, i) => (
                    <button
                      key={it.id} type="button" onClick={() => go(i)} aria-label={it.title} aria-current={i === active ? "step" : undefined}
                      className="grid h-6 place-items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <span className={cn("block h-1.5 rounded-full transition-all duration-500 ease-spring", i === active ? "w-8 bg-accent" : "w-2.5 bg-ink/20")} />
                    </button>
                  ))}
                </div>
                <h3 className="mt-4 text-[26px] font-bold leading-tight tracking-tight">{s.items[active].title}</h3>
                <p className="mt-2 min-h-[5.2em] text-[15px] leading-relaxed text-ink-2">{s.items[active].body}</p>
              </div>
            </div>

            {/* the pinned phone */}
            <Reveal className="order-1 mx-auto w-[clamp(130px,min(46vw,calc((100dvh-24rem)*0.47)),200px)] sm:w-[clamp(130px,min(40vw,calc((100dvh-24rem)*0.47)),230px)] lg:order-2 lg:w-[clamp(180px,calc((100dvh-9.5rem)*0.47),340px)]">
              <div className="relative [perspective:1400px]">
                <div aria-hidden className="absolute -inset-10 -z-10 rounded-full bg-rose/50 blur-3xl" />
                <motion.div style={{ rotateY: turn }}>
                  <AppPhone rim className="max-w-none"><Screens active={active} ids={ids} /></AppPhone>
                </motion.div>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
