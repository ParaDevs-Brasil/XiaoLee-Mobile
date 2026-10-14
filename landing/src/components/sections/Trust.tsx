import { useRef } from "react";
import { motion, useInView, useReducedMotion, useScroll, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { useSequence } from "@/lib/hooks";
import { Bezel, Reveal, SectionHead } from "@/components/kit";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Spotlight } from "@/components/ui/spotlight";
import { IconLock, IconReceipt, IconShield, IconSpark, IconTarget } from "@/components/icons";

const EASE = [0.32, 0.72, 0, 1] as const;

// Creator's view of the agent loop (backend/ai/agents/creator_pay_tools.py): rules -> verify -> budget -> pay.
// Text lives in copy.ts; this only fixes the tone of each line.
const TONES = ["info", "ok", "skip", "info", "pay"] as const;
const LOG_STEP_TO_NODE = [0, 1, 1, 2, 3];
const DELAYS = [900, 800, 800, 900, 1000, 1000];

function AgentLoop() {
  const { t } = useLang();
  const { ref, step } = useSequence(t.trust.log.length + 1, DELAYS, 3600);
  const node = step === 0 ? -1 : LOG_STEP_TO_NODE[Math.min(step, t.trust.log.length) - 1];
  return (
    <div ref={ref}>
      <div className="flex items-center">
        {t.trust.loop.map((l, i) => (
          <div key={l} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-2">
              <span className={cn("grid size-11 cursor-default place-items-center rounded-full ring-1 transition-all duration-700 ease-spring hover:scale-115 hover:ring-accent/70 hover:text-white", i <= node ? "bg-accent text-white ring-accent shadow-[0_0_30px_-4px_rgba(216,27,120,0.8)]" : "bg-white/5 text-white/40 ring-white/10")}>
                {[<IconTarget key="a" size={18} />, <IconSpark key="b" size={18} />, <IconReceipt key="c" size={18} />, <IconShield key="d" size={18} />][i]}
              </span>
              <span className={cn("text-[11px] font-bold uppercase tracking-[0.16em] transition-colors duration-700", i <= node ? "text-white" : "text-white/35")}>{l}</span>
            </div>
            {i < t.trust.loop.length - 1 && (
              <div className="relative mx-3 mb-6 h-px flex-1 bg-white/10">
                <motion.div className="absolute inset-0 origin-left bg-accent" initial={false} animate={{ scaleX: i < node ? 1 : 0 }} transition={{ duration: 0.9, ease: EASE }} />
              </div>
            )}
          </div>
        ))}
      </div>

      <Bezel dark glow radius={28} pad={6} className="mt-8" coreClassName="p-5">
        <div className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
          <span className="flex gap-1.5"><i className="size-2 rounded-full bg-white/15" /><i className="size-2 rounded-full bg-white/15" /><i className="size-2 rounded-full bg-white/15" /></span>
          {t.trust.logTitle}
        </div>
        <div className="min-h-[190px] space-y-2 font-mono text-[12.5px] leading-relaxed sm:text-[13px]">
          {t.trust.log.slice(0, step).map((l, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease: EASE }} className="-mx-2 flex flex-wrap gap-x-2 rounded-lg px-2 py-0.5 transition-colors duration-300 hover:bg-white/5">
              <span className="text-accent">›</span>
              <span className="text-white/85">{l.text}</span>
              <span className={cn("ml-auto", TONES[i] === "ok" || TONES[i] === "pay" ? "text-emerald-400" : TONES[i] === "skip" ? "text-amber-300" : "text-white/55")}>{l.out}</span>
            </motion.div>
          ))}
        </div>
      </Bezel>
    </div>
  );
}

export function Trust() {
  const { t } = useLang();
  const icons = [IconLock, IconShield, IconReceipt, IconTarget];
  const reduced = useReducedMotion();
  const section = useRef<HTMLElement | null>(null);
  // The dark panel arrives with the scroll (after Aceternity "Container Scroll"): it rises, levels out of a slight
  // tilt and settles to full size as it reaches the top third. The transform sits on the panel, the scroll is
  // measured on the untransformed section around it, so the two never feed back into each other.
  const { scrollYProgress } = useScroll({ target: section, offset: ["start end", "start 0.3"] });
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1]);
  const lift = useTransform(scrollYProgress, [0, 1], [64, 0]);
  const tilt = useTransform(scrollYProgress, [0, 1], [6, 0]);
  const arrived = useInView(section, { once: true, amount: 0.12 });
  return (
    <section ref={section} id="trust" className="px-3 py-3 sm:px-5 sm:py-5">
      <motion.div
        style={reduced ? undefined : { scale, y: lift, rotateX: tilt, transformPerspective: 1400, transformOrigin: "50% 0%" }}
        className="relative isolate overflow-hidden rounded-[2.5rem] bg-night py-28 text-white sm:rounded-[3.5rem] sm:py-40"
      >
        {/* mounted on arrival so its entrance plays when you get here, not at page load */}
        {arrived && <Spotlight className="-top-40 left-0 md:-top-20 md:left-60" fill="#f7a8d0" />}
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(900px_circle_at_85%_10%,rgba(216,27,120,0.22),transparent_60%),radial-gradient(700px_circle_at_5%_95%,rgba(47,93,143,0.25),transparent_60%)]" />
        <div aria-hidden className="absolute inset-0 -z-10 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />

        <div className="mx-auto max-w-[1280px] px-5 sm:px-8">
          <SectionHead dark eyebrow={t.trust.eyebrow} a={t.trust.h2a} b={t.trust.h2b} sub={t.trust.sub} />

          <div className="mt-16 grid gap-10 lg:grid-cols-[1fr_1fr] lg:gap-14">
            <Reveal><AgentLoop /></Reveal>
            <div className="grid gap-3 sm:grid-cols-2">
              {t.trust.cards.map((c, i) => {
                const Ic = icons[i];
                return (
                  <Reveal key={c.title} delay={0.08 * i}>
                    <Bezel dark glow radius={28} pad={5} className="group/c h-full" coreClassName="p-5">
                      <span className="grid size-10 place-items-center rounded-2xl bg-white/6 text-accent ring-1 ring-white/10 transition-all duration-500 ease-spring group-hover/c:-rotate-6 group-hover/c:scale-110 group-hover/c:bg-accent group-hover/c:text-white"><Ic size={20} /></span>
                      <h3 className="mt-4 text-[17px] font-bold leading-snug tracking-tight">{c.title}</h3>
                      <p className="mt-2 text-[14px] leading-relaxed text-white/55">{c.body}</p>
                    </Bezel>
                  </Reveal>
                );
              })}
            </div>
          </div>

          <div className="mt-20 grid grid-cols-2 gap-x-6 gap-y-10 border-t border-white/10 pt-12 lg:grid-cols-4">
            {t.trust.stats.map((s, i) => (
              <Reveal key={s.label} delay={0.08 * i}>
                <div className="origin-left cursor-default text-[clamp(44px,6vw,84px)] font-bold leading-none tracking-tight transition-transform duration-500 ease-spring hover:scale-[1.04]">
                  <NumberTicker value={s.to} className="text-white" />
                  <span className="serif-em text-accent">{s.suffix}</span>
                </div>
                <p className="mt-3 max-w-[200px] text-[14px] leading-snug text-white/50">{s.label}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}
