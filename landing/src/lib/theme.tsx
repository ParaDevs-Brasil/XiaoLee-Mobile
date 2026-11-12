import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

export type Theme = "dark" | "light";
type ThemeCtx = { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void };
const Ctx = createContext<ThemeCtx | null>(null);

export const THEME_KEY = "xl-theme";
const COLORS: Record<Theme, string> = { dark: "#09080b", light: "#f6f4f1" };

/** The inline script in index.html sets data-theme before first paint; this reads it back so React starts in sync. */
function initialTheme(): Theme {
  const v = document.documentElement.dataset.theme;
  return v === "light" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  const setTheme = useCallback((next: Theme) => {
    const apply = () => {
      document.documentElement.dataset.theme = next;
      flushSync(() => setThemeState(next));
    };
    // Same wipe as the language switch (see ::view-transition rules in index.css); skipped for reduced motion.
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!calm && typeof document.startViewTransition === "function") document.startViewTransition(apply);
    else apply();
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage can be blocked: the choice just won't persist */ }
  }, []);

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COLORS[theme]);
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") }), [theme, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme outside ThemeProvider");
  return v;
}
