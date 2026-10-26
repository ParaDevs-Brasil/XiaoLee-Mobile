import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { COPY, type Copy, type Lang } from "./copy";

type LangCtx = { lang: Lang; setLang: (l: Lang) => void; t: Copy };
const Ctx = createContext<LangCtx | null>(null);

const KEY = "xl-lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "pt") return saved;
  } catch { /* storage can be blocked — fall through */ }
  return navigator.language?.toLowerCase().startsWith("pt") ? "pt" : "en";
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    // Crossfade the whole page through a blur (see ::view-transition rules in index.css).
    // flushSync makes React commit inside the callback so the browser snapshots the new copy.
    const swap = () => flushSync(() => setLangState(l));
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!calm && typeof document.startViewTransition === "function") document.startViewTransition(swap);
    else swap();
    try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang === "pt" ? "pt-BR" : "en"; }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t: COPY[lang] }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLang outside LangProvider");
  return v;
}
