import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, House, TrendingUp, User, Video, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

/** Design size of the phone screen. Everything inside is laid out at this size, then scaled to fit the container. */
export const APP_W = 360;
export const APP_H = 760;

export type AppTab = "home" | "studio" | "grow" | "wallet";

const TABS: { id: AppTab; label: string; icon: typeof House }[] = [
  { id: "home", label: "Home", icon: House },
  { id: "studio", label: "Studio", icon: Video },
  { id: "grow", label: "Grow", icon: TrendingUp },
  { id: "wallet", label: "Wallet", icon: Wallet },
];

function TabBar({ active }: { active: AppTab }) {
  const item = (t: (typeof TABS)[number]) => {
    const on = t.id === active;
    const Icon = t.icon;
    return (
      <div key={t.id} className="flex flex-1 flex-col items-center gap-0.5">
        <span className={cn("grid h-8 w-14 place-items-center rounded-full", on ? "bg-(--a-soft) text-(--a-accent)" : "text-(--a-ink3)")}>
          <Icon size={20} strokeWidth={1.8} />
        </span>
        <span className={cn("text-[10.5px] font-semibold", on ? "text-(--a-accent)" : "text-(--a-ink3)")}>{t.label}</span>
      </div>
    );
  };
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex h-[74px] items-end border-t border-(--a-border) bg-(--a-bg) px-1 pb-3">
      {item(TABS[0])}
      {item(TABS[1])}
      <div className="flex flex-1 flex-col items-center">
        <span className="-mt-7 size-[54px] overflow-hidden rounded-full bg-(--a-card) ring-[3px] ring-(--a-bg) shadow-[0_0_0_2px_var(--a-fill),0_8px_20px_-6px_var(--a-fill)]">
          <img src="/mascot/kawaii.jpg" alt="" className="size-full object-cover" style={{ objectPosition: "50% 12%" }} />
        </span>
        <span className="mt-0.5 font-brand text-[11px] leading-none text-(--a-ink)">Xiaolee</span>
      </div>
      {item(TABS[2])}
      {item(TABS[3])}
    </div>
  );
}

function Header() {
  return (
    <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-(--a-border) px-4">
      <span className="font-brand text-[24px] leading-none text-(--a-ink)">
        Xiaolee<span className="ml-0.5 align-top text-[11px] text-(--a-accent)">✦</span>
      </span>
      <div className="flex items-center gap-3">
        <Bell size={22} strokeWidth={1.6} className="text-(--a-ink)" />
        <span className="grid size-9 place-items-center rounded-full bg-(--a-fill) text-white"><User size={18} strokeWidth={2} /></span>
      </div>
    </div>
  );
}

/** One app screen: status bar, header, scrolling body, tab bar. `sheet` slides a bottom sheet over it. */
export function AppScreen({
  tab, children, sheet, className,
}: { tab: AppTab; children: ReactNode; sheet?: ReactNode; className?: string }) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-(--a-bg)">
      <div className="flex h-7 shrink-0 items-center justify-between px-6 pt-1 text-[12px] font-bold text-(--a-ink)">
        <span>9:41</span>
        <span className="flex items-center gap-1.5 text-[10px]">
          <span className="inline-block h-2.5 w-4 rounded-[3px] border border-(--a-ink) p-[1px]"><span className="block h-full w-3/4 rounded-[1px] bg-(--a-ink)" /></span>
        </span>
      </div>
      <Header />
      <div className={cn("app-scroll min-h-0 flex-1 overflow-hidden px-4 pb-24 pt-4", className)}>{children}</div>
      <TabBar active={tab} />
      {sheet}
    </div>
  );
}

/**
 * Phone shell. Lays the screen out at APP_W × APP_H and scales it to the container's width, so the
 * mock keeps the app's real proportions at any size. Decorative: hidden from assistive tech.
 */
export function AppPhone({
  children, light = false, className,
}: { children: ReactNode; light?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.8);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1.2, e.contentRect.width / APP_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={cn("w-full max-w-[340px]", className)} aria-hidden>
      <div className="rounded-[44px] bg-[#0b090d] p-[9px] shadow-[0_60px_100px_-40px_rgba(120,20,80,0.6)] ring-1 ring-white/12">
        <div
          ref={box}
          className={cn("app-ui relative overflow-hidden rounded-[35px]", light && "light")}
          style={{ height: APP_H * scale }}
        >
          <div className="pointer-events-none absolute left-1/2 top-2 z-30 h-[18px] w-[18px] -translate-x-1/2 rounded-full bg-black" />
          <div style={{ width: APP_W, height: APP_H, transform: `scale(${scale})`, transformOrigin: "0 0" }}>{children}</div>
        </div>
      </div>
    </div>
  );
}
