import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Reveal, SectionHead } from "@/components/kit";
import { AppPhone } from "@/components/app/AppPhone";
import {
  ClipsScreen, CreatorScreen, GrowScreen, ReportsScreen, ShareScreen, VoiceScreen,
} from "@/components/app/screens";

const EASE = [0.32, 0.72, 0, 1] as const;
const ROTATE_MS = 6500;

const SCREEN: Record<string, () => ReactNode> = {
  clips: () => <ClipsScreen />,
  creators: () => <CreatorScreen />,
  voices: () => <VoiceScreen />,
  reports: () => <ReportsScreen />,
  share: () => <ShareScreen />,
  grow: () => <GrowScreen />,
};

export function Studio() {
  const { t } = useLang();
  const s = t.studio;
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  const [hover, setHover] = useState(false);

  // Rotates through the screens until the visitor picks one; never for reduced-motion users.
  useEffect(() => {
    if (touched || hover || reduced) return;
    const id = window.setInterval(() => setActive((i) => (i + 1) % s.items.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [touched, hover, reduced, s.items.length]);

  const pick = (i: number) => { setTouched(true); setActive(i); };
  const item = s.items[active];

  return (
    <section id="app" className="relative px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="grid items-start gap-12 lg:grid-cols-[1fr_auto] lg:gap-20">
          <div className="order-2 lg:order-1">
            <SectionHead eyebrow={s.eyebrow} a={s.h2a} b={s.h2b} sub={s.sub} />
          <Reveal delay={0.1} className="mt-12">
            <ul role="tablist" aria-label={s.eyebrow} className="space-y-2">
              {s.items.map((it, i) => {
                const on = i === active;
                return (
                  <li key={it.id}>
                    <button
                      role="tab" aria-selected={on} aria-controls="studio-panel" type="button"
                      onClick={() => pick(i)}
                      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
                      onPointerLeave={() => setHover(false)}
                      className={cn(
                        "group relative w-full rounded-3xl px-6 py-5 text-left transition-all duration-500 ease-spring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        on ? "bg-surface shadow-[0_24px_50px_-28px_rgba(80,30,60,0.35)] ring-1 ring-ink/6" : "hover:bg-surface/60",
                      )}
                    >
                      <span className="flex items-center gap-3">
                        <span className={cn("font-script text-[22px] leading-none transition-colors", on ? "text-accent" : "text-ink-3")}>{String(i + 1).padStart(2, "0")}</span>
                        <span className={cn("text-[clamp(20px,2vw,26px)] font-bold tracking-tight transition-colors", on ? "text-ink" : "text-ink-2")}>{it.title}</span>
                      </span>
                      <AnimatePresence initial={false}>
                        {on && (
                          <motion.p
                            initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduced ? undefined : { height: 0, opacity: 0 }}
                            transition={{ duration: 0.5, ease: EASE }}
                            className="max-w-md overflow-hidden pl-[42px] text-[15px] leading-relaxed text-ink-2"
                          >
                            <span className="block pt-2">{it.body}</span>
                          </motion.p>
                        )}
                      </AnimatePresence>
                      {on && !touched && !reduced && !hover && (
                        <motion.span
                          key={`bar-${active}`} aria-hidden
                          initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: ROTATE_MS / 1000, ease: "linear" }}
                          className="absolute inset-x-6 bottom-2 h-0.5 origin-left rounded-full bg-accent/40"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Reveal>
          </div>

          <Reveal delay={0.05} className="order-1 mx-auto w-full max-w-[340px] lg:sticky lg:top-28 lg:order-2 lg:mt-16">
            <div id="studio-panel" role="tabpanel" aria-label={item.title} className="relative">
              <div aria-hidden className="absolute -inset-10 -z-10 rounded-full bg-rose/50 blur-3xl" />
              <AppPhone>
                <div className="relative h-full">
                  {s.items.map((it, i) => (
                    <div
                      key={it.id}
                      aria-hidden={i !== active}
                      className={cn(
                        "absolute inset-0 transition-[opacity,filter,transform] duration-500 ease-spring motion-reduce:transition-none",
                        i === active ? "opacity-100 blur-0" : "pointer-events-none translate-y-2 opacity-0 blur-[6px]",
                      )}
                    >
                      {SCREEN[it.id]()}
                    </div>
                  ))}
                </div>
              </AppPhone>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
