import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { Bezel, MascotVideo, Reveal, SectionHead } from "@/components/kit";
import { BorderBeam } from "@/components/ui/border-beam";
import { Tilt } from "@/components/ui/tilt";
import { IconCheck, IconSend, IconShield, IconTarget, IconWallet } from "@/components/icons";

const EASE = [0.32, 0.72, 0, 1] as const;

function Phone({ children }: { children: ReactNode }) {
  return (
    <Tilt max={6} lift={1.015} glare className="mx-auto w-full max-w-[330px] rounded-[48px]">
    <Bezel radius={48} pad={9} className="w-full bg-ink/90 shadow-[0_60px_100px_-40px_rgba(60,15,40,0.55)]" coreClassName="aspect-[9/17] bg-cream">
      <div aria-hidden className="absolute left-1/2 top-2.5 z-20 h-5 w-20 -translate-x-1/2 rounded-full bg-ink" />
      <div className="flex h-full flex-col px-4 pb-4 pt-12">
        {children}
        <div className="mt-auto flex items-center gap-2 rounded-full bg-white py-1.5 pl-4 pr-1.5 text-[12.5px] text-ink-3 ring-1 ring-ink/8">
          <span className="flex-1">Xiaolee…</span>
          <span className="grid size-7 place-items-center rounded-full bg-accent text-white"><IconSend size={13} /></span>
        </div>
      </div>
    </Bezel>
    </Tilt>
  );
}

function Screen({ i }: { i: number }) {
  const { t } = useLang();
  const m = t.how.mock;
  if (i === 0) {
    return (
      <Phone>
        <div className="relative mx-auto size-40 overflow-hidden rounded-full bg-[#d3cfcc] ring-4 ring-white shadow-[0_24px_40px_-16px_rgba(120,20,70,0.5)]">
          <MascotVideo name="hello" position="50% 6%" zoom={1.5} />
        </div>
        <div className="mt-6 rounded-[22px] rounded-tl-md bg-white p-4 text-[14.5px] font-semibold leading-snug text-ink shadow-sm ring-1 ring-ink/5">{m.hi}</div>
        <div className="mt-3 flex items-center gap-2 self-start rounded-full bg-emerald-50 px-3 py-2 text-[12.5px] font-bold text-success"><IconWallet size={15} /> {m.walletReady}</div>
      </Phone>
    );
  }
  if (i === 1) {
    return (
      <Phone>
        <div className="space-y-3">
          {m.campaigns.map((c, n) => (
            <div key={c} className={cn("group/cc relative cursor-pointer overflow-hidden rounded-3xl bg-white p-4 shadow-sm ring-1 transition-all duration-500 ease-spring hover:-translate-y-0.5 hover:shadow-[0_14px_24px_-14px_rgba(60,15,40,0.4)]", n === 0 ? "ring-accent/30" : "ring-ink/5")}>
              <div className="flex items-center gap-3">
                <span className={cn("grid size-10 place-items-center rounded-2xl", n === 0 ? "bg-accent text-white" : "bg-ink/5 text-ink-2")}><IconTarget size={20} /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-bold text-ink">{c}</div>
                  <div className="text-[12px] font-semibold text-ink-3">{n === 0 ? "300" : "150"} USDC {m.pool}</div>
                </div>
              </div>
              <div className={cn("mt-3 rounded-full py-2 text-center text-[13px] font-bold transition-colors duration-500", n === 0 ? "bg-accent text-white" : "bg-ink/5 text-ink-2 group-hover/cc:bg-accent group-hover/cc:text-white")}>{m.join}</div>
              {n === 0 && <BorderBeam size={70} duration={5} colorFrom="#d81b78" colorTo="#f7c9e0" borderWidth={1.5} />}
            </div>
          ))}
        </div>
      </Phone>
    );
  }
  if (i === 2) {
    return (
      <Phone>
        <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-ink/5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-ink text-white"><IconTarget size={20} /></span>
            <div className="text-[13.5px] font-bold text-ink">{m.checking}</div>
          </div>
          <div className="mt-4 space-y-2.5">
            {[0, 1, 2].map((n) => (
              <div key={n} className="flex items-center gap-3">
                <motion.span
                  initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.5 + n * 0.5, duration: 0.5, ease: EASE }}
                  className="grid size-6 place-items-center rounded-full bg-success text-white"
                ><IconCheck size={14} /></motion.span>
                <div className="h-2 flex-1 rounded-full bg-ink/8" />
              </div>
            ))}
          </div>
        </div>
        <div className="relative mt-4 aspect-square w-32 self-center overflow-hidden rounded-full bg-[#d3cfcc] ring-4 ring-white">
          <MascotVideo name="cheer" position="50% 6%" zoom={1.5} />
        </div>
        <div className="mt-3 self-center rounded-full bg-emerald-50 px-4 py-2 text-[13px] font-bold text-success">{m.verified} ✓</div>
      </Phone>
    );
  }
  return (
    <Phone>
      <div className="relative overflow-hidden rounded-3xl bg-white p-5 text-center shadow-sm ring-1 ring-ink/5">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent"><IconShield size={24} /></div>
        <div className="mt-3 text-[12.5px] font-bold uppercase tracking-wider text-ink-3">{m.sign}</div>
        <div className="mt-1 text-[40px] font-bold leading-none tracking-tight text-ink">0.30 <span className="text-[16px] text-ink-3">USDC</span></div>
        <div className="mt-4 rounded-full bg-accent py-3 text-[14px] font-bold text-white">{m.signCta}</div>
        <BorderBeam size={90} duration={4.5} colorFrom="#d81b78" colorTo="#f7c9e0" borderWidth={1.5} />
      </div>
      <div className="relative mt-4 aspect-square w-32 self-center overflow-hidden rounded-full bg-[#d3cfcc] ring-4 ring-white">
        <MascotVideo name="love" position="50% 6%" zoom={1.5} />
      </div>
      <div className="mt-3 self-center rounded-full bg-emerald-50 px-4 py-2 text-[13px] font-bold text-success">{m.received} ✓</div>
    </Phone>
  );
}

export function How() {
  const { t } = useLang();
  const steps = t.how.steps;
  const wrap = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: wrap, offset: ["start start", "end end"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 });
  const fill = useTransform(smooth, [0.04, 0.96], [0, 1]);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const n = Math.min(steps.length - 1, Math.max(0, Math.floor(p * steps.length * 0.999)));
    setActive((a) => (a === n ? a : n));
  });

  return (
    <section id="how" className="relative">
      <div className="mx-auto max-w-[1280px] px-5 pt-12 sm:px-8 lg:pt-24">
        <SectionHead a={t.how.h2a} b={t.how.h2b} />
      </div>

      {/* desktop: pinned stage driven by scroll; mobile: plain stacked steps */}
      <div ref={wrap} className="relative mt-14 lg:h-[330vh]">
        <div className="lg:sticky lg:top-0 lg:flex lg:h-screen lg:items-center">
          <div className="mx-auto grid w-full max-w-[1280px] gap-14 px-5 sm:px-8 lg:grid-cols-[1fr_0.8fr] lg:items-center lg:gap-24">
            <div className="relative">
              <div aria-hidden className="absolute bottom-2 left-[19px] top-2 hidden w-px bg-ink/10 lg:block">
                <motion.div className="h-full w-px origin-top bg-accent" style={{ scaleY: fill }} />
              </div>
              <ol className="space-y-12 lg:space-y-10">
                {steps.map((s, i) => (
                  <li key={s.title}>
                    <Reveal>
                      <div className={cn("flex gap-5 transition-opacity duration-700 ease-spring lg:gap-8", i === active ? "lg:opacity-100" : "lg:opacity-35 lg:hover:opacity-70")}>
                        <span className={cn("relative z-10 grid size-10 shrink-0 place-items-center rounded-full text-[13px] font-bold tabular-nums ring-1 transition-all duration-700 ease-spring hover:scale-110", i <= active ? "bg-accent text-white ring-accent" : "bg-cream text-ink-3 ring-ink/15")}>
                          0{i + 1}
                        </span>
                        <div>
                          <h3 className="text-[clamp(26px,3.2vw,44px)] font-bold leading-tight tracking-tight text-ink">{s.title}</h3>
                          <p className="mt-2 max-w-md text-[16px] leading-relaxed text-ink-2">{s.body}</p>
                        </div>
                      </div>
                    </Reveal>
                    <div className="mt-8 lg:hidden"><Screen i={i} /></div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="relative hidden lg:block">
              <div aria-hidden className="absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(247,201,224,0.7),transparent_75%)]" />
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial={{ opacity: 0, y: 30, scale: 0.97, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -24, scale: 0.98, filter: "blur(6px)" }}
                  transition={{ duration: 0.6, ease: EASE }}
                >
                  <Screen i={active} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
