import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { APK_URL } from "@/lib/links";

const EASE = [0.32, 0.72, 0, 1] as const;

type Ctx = { start: () => void };
const DownloadCtx = createContext<Ctx | null>(null);

export function useDownload() {
  const v = useContext(DownloadCtx);
  if (!v) throw new Error("useDownload outside DownloadProvider");
  return v;
}

/** Hands the file to the browser without leaving the page. A cross-origin link ignores `download` and would navigate the
 *  tab away; a hidden iframe pointed at an attachment response downloads it and leaves the page where it is. */
function fetchApk() {
  const f = document.createElement("iframe");
  f.hidden = true;
  f.setAttribute("aria-hidden", "true");
  f.src = APK_URL;
  document.body.appendChild(f);
  window.setTimeout(() => f.remove(), 60_000);
}

// 9:16 frames rising behind the mascot. Fixed values: the same sequence every time, nothing random at render.
const FRAMES = [
  { x: 8, d: 0.1, s: 0.8, c: "accent" }, { x: 22, d: 0.5, s: 1, c: "violet" }, { x: 36, d: 0.25, s: 0.7, c: "accent" },
  { x: 64, d: 0.4, s: 0.9, c: "violet" }, { x: 78, d: 0.15, s: 1.05, c: "accent" }, { x: 91, d: 0.6, s: 0.75, c: "violet" },
] as const;

/** The moment: rings leave the mascot, a check badge draws itself in, 9:16 frames drift up through the glow. */
function Success() {
  return (
    <div className="relative h-[190px] overflow-hidden">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(closest-side_at_50%_62%,var(--halo),transparent_75%)]" />
      <div aria-hidden className="absolute inset-0 opacity-[0.5] [background-image:linear-gradient(var(--line)_1px,transparent_1px),linear-gradient(90deg,var(--line)_1px,transparent_1px)] [background-size:36px_36px] [mask-image:radial-gradient(closest-side_at_50%_60%,#000,transparent)]" />
      {FRAMES.map((f, i) => (
        <motion.span
          key={i} aria-hidden
          initial={{ y: 230, opacity: 0 }} animate={{ y: -80, opacity: [0, 0.9, 0.9, 0] }}
          transition={{ duration: 2.6, delay: f.d, ease: "easeOut", repeat: Infinity, repeatDelay: 0.4 + i * 0.15 }}
          className={cn("absolute top-0 aspect-[9/16] rounded-[8px] border", f.c === "accent" ? "border-accent/70 bg-accent/10" : "border-violet/70 bg-violet/10")}
          style={{ left: `${f.x}%`, width: 22 * f.s }}
        />
      ))}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i} aria-hidden
            initial={{ scale: 0.6, opacity: 0.55 }} animate={{ scale: 2, opacity: 0 }}
            transition={{ duration: 2.4, delay: 0.3 + i * 0.7, ease: "easeOut", repeat: Infinity }}
            className="absolute left-1/2 top-1/2 size-[84px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/60"
          />
        ))}
        <motion.div
          initial={{ scale: 0.4, opacity: 0, rotate: -12 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ duration: 0.8, ease: EASE }} className="relative"
        >
          <img src="/assets/xiaolee-icon-160.webp" width={84} height={84} alt="" className="size-[84px] rounded-full object-cover ring-4 ring-surface shadow-[0_24px_50px_-14px_rgba(224,40,132,0.7)]" />
          <motion.span
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.55, type: "spring", stiffness: 380, damping: 16 }}
            className="absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-full bg-success text-[#04140d] ring-[3px] ring-surface"
          >
            <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <motion.path d="m5 12.5 4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.75, duration: 0.45, ease: "easeOut" }} />
            </svg>
          </motion.span>
        </motion.div>
      </div>
    </div>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  const d = t.dl;
  return (
    <>
      <button
        type="button" onClick={onClose} aria-label={d.close}
        className="absolute right-4 top-4 z-10 grid size-11 cursor-pointer place-items-center rounded-full bg-ink/8 text-ink transition-all duration-500 ease-spring hover:rotate-90 hover:bg-ink/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <X size={18} strokeWidth={1.6} aria-hidden />
      </button>
      <Success />
      <div className="px-6 pb-2 text-center sm:px-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.7, ease: EASE }}>
          <h2 id="xl-dl-title" className="display text-[clamp(30px,5vw,44px)]">{d.title}</h2>
          <p className="mx-auto mt-3 max-w-[430px] text-[15.5px] leading-relaxed text-ink-2">{d.sub}</p>
        </motion.div>
      </div>

      <div className="px-6 pb-7 pt-5 sm:px-10">
        <p className="mb-4 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-ink-3">{`{ ${d.stepsTitle} }`}</p>
        <ol className="relative space-y-1">
          <motion.span
            aria-hidden initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.7, duration: 1.4, ease: EASE }}
            className="absolute bottom-6 left-[17px] top-6 w-px origin-top bg-gradient-to-b from-accent/70 via-line to-transparent"
          />
          {d.steps.map((s, i) => (
            <motion.li
              key={s.title}
              initial={{ opacity: 0, y: 14, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 0.75 + i * 0.12, duration: 0.7, ease: EASE }}
              className="relative flex gap-4 rounded-2xl py-2 pr-2"
            >
              <span className={cn("relative z-[1] grid size-9 shrink-0 place-items-center rounded-full font-mono text-[12px] font-medium ring-1", i === 0 ? "bg-accent text-white ring-accent" : "bg-surface-hi text-ink-2 ring-line")}>
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-[16px] font-bold leading-snug tracking-tight">{s.title}</h3>
                <p className="mt-0.5 text-[14px] leading-relaxed text-ink-2">{s.body}</p>
              </div>
            </motion.li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
          <span className="font-mono text-[11.5px] uppercase tracking-[0.16em] text-ink-3">{d.note}</span>
          <span aria-hidden className="text-ink-3">·</span>
          <a href={APK_URL} download rel="noopener" className="text-[13.5px] font-semibold text-ink-2 underline decoration-ink/25 underline-offset-4 transition-colors duration-300 hover:text-accent hover:decoration-accent">
            {d.again}
          </a>
        </div>
      </div>
    </>
  );
}

export function DownloadProvider({ children }: { children: ReactNode }) {
  const dlg = useRef<HTMLDialogElement | null>(null);
  const downOnBackdrop = useRef(false);
  const [shown, setShown] = useState(false); // mounted while open so the animation replays on every download

  const start = useCallback(() => {
    fetchApk();
    setShown(true);
  }, []);
  const close = useCallback(() => dlg.current?.close(), []);

  useEffect(() => { if (shown) dlg.current?.showModal(); }, [shown]);

  const value = useMemo(() => ({ start }), [start]);
  return (
    <DownloadCtx.Provider value={value}>
      {children}
      <dialog
        ref={dlg} aria-labelledby="xl-dl-title"
        onClose={() => setShown(false)}
        onPointerDown={(e) => { downOnBackdrop.current = e.target === dlg.current; }}
        onClick={(e) => { if (e.target === dlg.current && downOnBackdrop.current) close(); downOnBackdrop.current = false; }}
        className={cn(
          "relative m-auto w-[min(560px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain rounded-[2rem] border-0 bg-cream p-0 text-ink",
          "shadow-[0_50px_120px_-30px_rgba(224,40,132,0.35)] ring-1 ring-ink/10 backdrop:bg-black/60 backdrop:backdrop-blur-md",
          "open:animate-[dl-in_0.7s_cubic-bezier(0.32,0.72,0,1)]",
        )}
      >
        <style>{`@keyframes dl-in{from{opacity:0;transform:translateY(28px) scale(.96)}to{opacity:1;transform:none}}`}</style>
        {shown && <Panel onClose={close} />}
      </dialog>
    </DownloadCtx.Provider>
  );
}
