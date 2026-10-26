import { useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";
import { cn } from "@/lib/utils";
import { Moon, Sun } from "lucide-react";
import { useLang } from "@/lib/lang";
import { useTheme } from "@/lib/theme";
import { useWaitlist } from "@/components/Waitlist";
import { useDownload } from "@/components/Download";
import { DOWNLOAD_ENABLED } from "@/lib/links";
import { FlowButton } from "@/components/ui/flow-button";
import { AnimatedWordmark } from "@/components/ui/animated-logo";

/** One switch: pressing it anywhere (EN or PT side) flips the language.
 *  Named by the action, in the language it switches to ("Mudar para português"): a role=switch only says on/off,
 *  never which language is active. The extra hit area (before:) brings the pill to a 44px touch target. */
function LangToggle({ dark = false }: { dark?: boolean }) {
  const { lang, setLang } = useLang();
  const id = useId();
  return (
    <button
      type="button" lang={lang === "en" ? "pt" : "en"} aria-label={lang === "en" ? "Mudar para português" : "Switch to English"}
      onClick={() => setLang(lang === "en" ? "pt" : "en")}
      className={cn("relative flex cursor-pointer items-center rounded-full p-0.5 text-[11.5px] font-bold tracking-wider outline-none before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[''] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-cream", dark ? "bg-white/10" : "bg-ink/5")}
    >
      {(["en", "pt"] as const).map((l) => (
        <span
          key={l}
          className={cn(
            "relative rounded-full px-2.5 py-1.5 uppercase transition-colors duration-500 ease-spring",
            lang === l ? (dark ? "text-ink" : "text-cream") : dark ? "text-white/60" : "text-ink-2",
          )}
        >
          {lang === l && (
            <motion.span
              layoutId={id} aria-hidden
              className={cn("absolute inset-0 rounded-full", dark ? "bg-surface" : "bg-ink")}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
            />
          )}
          <span className="relative">{l}</span>
        </span>
      ))}
    </button>
  );
}

/** Theme switch. Named by the action ("Switch to light theme"), not by the state. The 44px touch target comes from before:. */
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { lang } = useLang();
  const toLight = theme === "dark";
  const label = lang === "pt" ? (toLight ? "Mudar para o tema claro" : "Mudar para o tema escuro") : toLight ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      type="button" aria-label={label} title={label} onClick={toggle}
      className="relative grid size-9 cursor-pointer place-items-center rounded-full bg-ink/5 text-ink outline-none transition-[background-color,transform] duration-500 ease-spring before:absolute before:-inset-1 before:content-[''] hover:bg-ink/10 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
    >
      <Sun size={17} strokeWidth={1.6} aria-hidden className={cn("absolute transition-all duration-700 ease-spring", toLight ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0")} />
      <Moon size={17} strokeWidth={1.6} aria-hidden className={cn("absolute transition-all duration-700 ease-spring", toLight ? "rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100")} />
    </button>
  );
}

/** The mascot avatar wears a ring that fills as the page scrolls: a progress bar that costs no extra element in the bar. */
function ScrollRing() {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const fill = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 });
  if (reduced) return null;
  return (
    <svg aria-hidden viewBox="0 0 40 40" className="pointer-events-none absolute -inset-1 size-10 -rotate-90">
      <circle cx="20" cy="20" r="19" fill="none" strokeWidth="2" className="stroke-accent/15" />
      <motion.circle cx="20" cy="20" r="19" fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-accent" style={{ pathLength: fill }} />
    </svg>
  );
}

export function Nav() {
  const { t } = useLang();
  const { open } = useWaitlist();
  const { start: startDownload } = useDownload();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const navId = useId();
  const menuId = useId();
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const firstLink = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    // one sentinel instead of a scroll listener
    const s = document.getElementById("nav-sentinel");
    if (!s) return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { threshold: 0 });
    io.observe(s);
    return () => io.disconnect();
  }, []);

  // Open menu: the page behind it goes inert (no tabbing into it), focus lands on the first link and Esc closes it
  // and hands focus back to the button. Scroll lock isn't here: it's CSS (data-scroll-lock in index.css), so the
  // waitlist dialog and this menu can't undo each other's lock.
  useEffect(() => {
    if (!menu) return;
    const behind = document.querySelectorAll("main, footer");
    behind.forEach((el) => el.setAttribute("inert", ""));
    firstLink.current?.focus(); // the overlay is already `visible` here (see its transition below), so this takes
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); menuBtn.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); behind.forEach((el) => el.removeAttribute("inert")); };
  }, [menu]);

  const links = [
    { href: "#can", label: t.nav.can },
    { href: "#how", label: t.nav.how },
    { href: "#trust", label: t.nav.trust },
  ];

  return (
    <>
      <div id="nav-sentinel" aria-hidden className="absolute left-0 top-0 h-24 w-px" />
      <header className="fixed inset-x-0 top-4 z-40 flex justify-center px-3 sm:top-6">
        <nav
          aria-label={t.nav.main}
          className={cn(
            "flex w-full max-w-[860px] items-center justify-between rounded-full py-2 pl-5 pr-2 transition-all duration-700 ease-spring",
            scrolled || menu
              ? "bg-surface/90 shadow-[0_20px_50px_-24px_rgba(60,15,40,0.35)] ring-1 ring-ink/8 backdrop-blur-xl"
              : "bg-transparent ring-1 ring-transparent",
          )}
        >
          <a href="#top" aria-label="Xiaolee" className="group/logo flex items-center gap-2.5">
            <span className="relative grid size-8 place-items-center">
              <ScrollRing />
              <img src="/assets/xiaolee-icon-160.webp" width={32} height={32} alt="" className="size-8 rounded-full object-cover ring-2 ring-surface transition-all duration-500 ease-spring group-hover/logo:rotate-[14deg] group-hover/logo:scale-110 group-hover/logo:ring-accent/70" />
            </span>
            <AnimatedWordmark className="text-[23px]" />
          </a>

          <ul className="hidden items-center gap-1 md:flex" onPointerLeave={() => setHover(null)}>
            {links.map((l) => (
              <li key={l.href} onPointerEnter={() => setHover(l.href)}>
                <a href={l.href} onFocus={() => setHover(l.href)} onBlur={() => setHover(null)} className={cn("relative block rounded-full px-3.5 py-2 text-[14px] font-semibold transition-colors duration-500 ease-spring", hover === l.href ? "text-ink" : "text-ink-2")}>
                  {hover === l.href && (
                    <motion.span layoutId={`${navId}-hover`} aria-hidden className="absolute inset-0 rounded-full bg-ink/6" transition={{ type: "spring", stiffness: 420, damping: 34 }} />
                  )}
                  <span className="relative">{l.label}</span>
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LangToggle />
            <FlowButton onClick={DOWNLOAD_ENABLED ? startDownload : open} size="sm" className="hidden sm:inline-flex">
              {DOWNLOAD_ENABLED ? t.nav.cta : t.nav.wl}
            </FlowButton>
            <button
              ref={menuBtn} type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-controls={menuId} aria-label={t.nav.menu}
              className="relative grid size-11 place-items-center rounded-full bg-ink/5 outline-none transition-colors duration-300 hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-cream md:hidden"
            >
              <span className={cn("absolute h-px w-4 bg-ink transition-transform duration-500 ease-spring", menu ? "rotate-45" : "-translate-y-[3px]")} />
              <span className={cn("absolute h-px w-4 bg-ink transition-transform duration-500 ease-spring", menu ? "-rotate-45" : "translate-y-[3px]")} />
            </button>
          </div>
        </nav>
      </header>

      {/* mobile overlay: heavy glass, links rise out of a mask one by one */}
      <nav
        id={menuId} aria-label={t.nav.menu} data-scroll-lock={menu}
        className={cn(
          // `visibility` flips instantly on open (so the first link can take focus right away) and only after the
          // fade-out on close: that's the 0s/700ms pair on [opacity, visibility]
          "fixed inset-0 z-30 flex flex-col justify-center overflow-y-auto bg-cream/85 px-8 backdrop-blur-3xl transition-[opacity,visibility] duration-[700ms,0s] ease-spring md:hidden",
          menu ? "visible opacity-100" : "invisible opacity-0 delay-[0s,700ms]",
        )}
      >
        <ul className="flex flex-col gap-2">
          {links.map((l, i) => (
            <li key={l.href} className="overflow-hidden">
              <a
                ref={i === 0 ? firstLink : undefined} href={l.href} onClick={() => setMenu(false)}
                className={cn("display block py-2 text-[44px] transition-[transform,opacity] duration-700 ease-spring", menu ? "translate-y-0 opacity-100" : "translate-y-full opacity-0")}
                style={{ transitionDelay: menu ? `${120 + i * 70}ms` : "0ms" }}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <FlowButton
          // focus goes back to the menu button first: the dialog returns focus to whatever had it when it opened,
          // and this button is about to turn invisible
          onClick={() => { setMenu(false); menuBtn.current?.focus(); (DOWNLOAD_ENABLED ? startDownload : open)(); }}
          className={cn("mt-10 text-[16px] transition-all duration-700", menu ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0")}
          style={{ transitionDelay: menu ? "440ms" : "0ms" }}
        >
          {DOWNLOAD_ENABLED ? t.nav.cta : t.nav.wl}
        </FlowButton>
      </nav>
    </>
  );
}
