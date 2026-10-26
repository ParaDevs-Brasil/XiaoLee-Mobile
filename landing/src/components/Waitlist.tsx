import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { FlowButton } from "@/components/ui/flow-button";
import { COPY } from "@/lib/copy";
import { useLang } from "@/lib/lang";

// Google Apps Script web app that writes to the sheet (apps-script/waitlist.gs).
// Setup walkthrough: docs/workflows/WAITLIST_SHEETS.md.
const OUTBOX = "xl-wl-outbox";
const SPARKS: [number, number, string][] = [[0, 0, "#d81b78"], [60, 0.04, "#f6c453"], [120, 0.02, "#d81b78"], [180, 0.06, "#f7c9e0"], [240, 0.03, "#f6c453"], [300, 0.05, "#f7c9e0"]];
const WAITLIST_URL =
  "https://script.google.com/macros/s/AKfycbzcA4YF2AJRy82PbvPmkrknLT8T2mkTh9vD9JSbY2RU6tITXmMikTlve_sfqP_hsmmg/exec";

const HANDLES = ["x", "instagram", "tiktok", "telegram", "youtube"] as const;
type Handle = (typeof HANDLES)[number];
const HANDLE_LABEL: Record<Handle, string> = { x: "X", instagram: "Instagram", tiktok: "TikTok", telegram: "Telegram", youtube: "YouTube" };
const PLATFORM_OPTIONS = ["x", "instagram", "tiktok", "youtube", "telegram", "other"] as const;
const PLATFORM_LABEL: Record<string, string> = { x: "X (Twitter)", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", telegram: "Telegram", other: "Other" };
const AUDIENCE: [string, string][] = [["<1k", "< 1K"], ["1k-10k", "1K–10K"], ["10k-100k", "10K–100K"], ["100k-1m", "100K–1M"], ["1m+", "1M+"]];

type Result = { ok: true } | { ok: false; msg: string; hard: boolean };

type Values = {
  name: string; email: string; role: string; main_platform: string;
  h_x: string; h_instagram: string; h_tiktok: string; h_telegram: string; h_youtube: string;
  audience_size: string; has_company: string; company_name: string; target_audience: string;
  country: string; referral_source: string; website: string;
};
const EMPTY: Values = {
  name: "", email: "", role: "", main_platform: "", h_x: "", h_instagram: "", h_tiktok: "", h_telegram: "", h_youtube: "",
  audience_size: "", has_company: "", company_name: "", target_audience: "", country: "", referral_source: "", website: "",
};

const WaitlistCtx = createContext<{ open: () => void } | null>(null);
export const useWaitlist = () => {
  const c = useContext(WaitlistCtx);
  if (!c) throw new Error("useWaitlist outside WaitlistProvider");
  return c;
};

// 16px: below that iOS Safari zooms the page when a field gets focus. The 1px ring is the field boundary
// (WCAG 1.4.11 asks for 3:1 against the surface), and the focus ring is solid accent.
const field =
  "w-full rounded-2xl bg-surface px-4 py-3 text-base text-ink outline-none ring-1 ring-ink/50 transition-shadow duration-300 ease-spring hover:shadow-[0_8px_18px_-12px_rgba(60,15,40,0.35)] placeholder:text-ink-3 focus:ring-2 focus:ring-accent aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-[#c23a3a]";

const ERR_ID = "xl-wl-err";
type ErrField = "name" | "email" | "role";

function Chip({ name, value, label, checked, onChange, invalid }: { name: string; value: string; label: string; checked: boolean; onChange: (v: string) => void; invalid?: boolean }) {
  return (
    <label className="cursor-pointer">
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="peer sr-only" />
      <span data-invalid={invalid || undefined} className="inline-block rounded-full bg-surface px-4 py-2.5 text-[14px] font-semibold text-ink-2 ring-1 ring-ink/10 data-[invalid=true]:ring-[#c23a3a] transition-all duration-300 ease-spring hover:-translate-y-0.5 hover:shadow-[0_8px_16px_-10px_rgba(60,15,40,0.4)] hover:ring-ink/25 active:scale-95 peer-checked:bg-accent peer-checked:text-white peer-checked:ring-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-cream">
        {label}
      </span>
    </label>
  );
}

export function WaitlistProvider({ children }: { children: ReactNode }) {
  const { lang } = useLang();
  const w = COPY[lang].wl;
  const dlg = useRef<HTMLDialogElement | null>(null);
  const bodyRef = useRef<HTMLFormElement | null>(null);
  const handleInputs = useRef<Partial<Record<Handle, HTMLInputElement | null>>>({});

  const [v, setV] = useState<Values>(EMPTY);
  const [step, setStep] = useState<1 | 2>(1);
  const [done, setDone] = useState<null | "all" | "list">(null);
  const [err, setErr] = useState("");
  const [errField, setErrField] = useState<ErrField | null>(null); // which control the message in `err` is about
  const [nudge, setNudge] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const roleRef = useRef<HTMLFieldSetElement | null>(null);
  const boostRef = useRef<HTMLHeadingElement | null>(null);
  const doneRef = useRef<HTMLHeadingElement | null>(null);
  const nudgeAddRef = useRef<HTMLButtonElement | null>(null);
  const nudged = useRef(false);
  const pending = useRef<Promise<Result> | null>(null); // background step-1 save
  const step1Failed = useRef(false);
  const openedAt = useRef(0);
  const downOnBackdrop = useRef(false);

  const set = (k: keyof Values) => (val: string) => {
    setV((s) => ({ ...s, [k]: val }));
    if (errField === k) { setErr(""); setErrField(null); } // the person is fixing the field the message is about
  };
  const input = (k: keyof Values) => ({ value: v[k], onChange: (e: { target: { value: string } }) => set(k)(e.target.value) });

  const open = useCallback(() => {
    if (!openedAt.current) openedAt.current = Date.now();
    setDone(null); setErr(""); setErrField(null);
    dlg.current?.showModal(); // the page's scroll lock follows `dialog[open]` in index.css
    // Start on the first field instead of the close button. Fine pointers only: on a phone the keyboard would
    // pop up and cover the form. Next frame, because after a finished signup the form isn't mounted yet.
    if (window.matchMedia("(pointer: fine)").matches) requestAnimationFrame(() => nameRef.current?.focus());
  }, []);
  const close = useCallback(() => dlg.current?.close(), []);

  // The form unmounts or swaps its content on step change / confirmation, which drops the focused button
  // to <body>. Move focus to the new heading so keyboard and screen-reader users land on what changed.
  useEffect(() => {
    if (!dlg.current?.open) return;
    if (done) doneRef.current?.focus();
    else if (step === 2) boostRef.current?.focus();
  }, [done, step]);
  useEffect(() => { if (nudge) nudgeAddRef.current?.focus(); }, [nudge]);

  const hasHandle = HANDLES.some((h) => v[`h_${h}`].trim());
  const extras = [v.main_platform, hasHandle, v.audience_size, v.has_company, v.target_audience, v.country, v.referral_source].filter(Boolean).length;
  const pct = Math.round(((3 + extras) / 10) * 100); // name, email and role already count

  const payload = () => ({
    name: v.name.trim(), email: v.email.trim(), role: v.role,
    main_platform: v.main_platform || null,
    handles: { x: v.h_x.trim(), instagram: v.h_instagram.trim(), tiktok: v.h_tiktok.trim(), telegram: v.h_telegram.trim(), youtube: v.h_youtube.trim() },
    audience_size: v.audience_size || null,
    // no answer = field omitted (JSON.stringify drops undefined): every Apps Script version accepts it
    has_company: v.has_company ? v.has_company === "yes" : undefined,
    company_name: v.has_company === "yes" ? v.company_name.trim() || null : null,
    target_audience: v.target_audience.trim() || null,
    country: v.country || null,
    referral_source: v.referral_source || null,
    website: v.website || null, // honeypot
    t: Date.now() - openedAt.current, // fill time: a bot that submits in milliseconds is discarded
  });

  // One POST to the sheet. Never rejects. `hard` = the server answered and refused (invalid, closed,
  // rate limited): retrying the same data is pointless. Otherwise it was a network/server hiccup.
  const post = (body: ReturnType<typeof payload> = payload()): Promise<Result> => {
    if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(WAITLIST_URL)) return Promise.resolve({ ok: false, msg: w.errUnavailable, hard: true });
    const refusals: Record<string, string> = { rate_limited: w.errBusy, busy: w.errBusy, closed: w.errClosed, invalid: w.errInvalid };
    // No Content-Type header (goes as text/plain): a "simple" request with no CORS preflight —
    // Apps Script doesn't answer OPTIONS. keepalive: the request survives the tab closing.
    return fetch(WAITLIST_URL, { method: "POST", body: JSON.stringify(body), keepalive: true })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((res): Result => {
        if (res?.status === "ok") return { ok: true };
        const known = !!refusals[res?.status];
        return { ok: false, msg: refusals[res?.status] || w.errGeneric, hard: known };
      })
      .catch((): Result => ({ ok: false, msg: w.errNetwork, hard: false }));
  };

  // Network failure on the final save: retry (1.5s / 3s / 6s), then park it in the browser and
  // resend on the next visit or when the connection is back. Name, email and role are already
  // saved by step 1, so only the extra fields are at stake.
  const stash = (body: object) => { try { localStorage.setItem(OUTBOX, JSON.stringify(body)); } catch { /* storage blocked */ } };
  const retry = (body: ReturnType<typeof payload>, n: number) => {
    post(body).then((r) => {
      if (r.ok || r.hard) return;
      if (n < 3) setTimeout(() => retry(body, n + 1), 1500 * 2 ** n);
      else stash(body);
    });
  };
  useEffect(() => {
    const flush = () => {
      let body = null;
      try { body = JSON.parse(localStorage.getItem(OUTBOX) || "null"); } catch { return; }
      if (!body) return;
      post(body).then((r) => { if (r.ok || r.hard) { try { localStorage.removeItem(OUTBOX); } catch { /* storage blocked */ } } });
    };
    const t = setTimeout(flush, 4000);
    window.addEventListener("online", flush);
    return () => { clearTimeout(t); window.removeEventListener("online", flush); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The server refused step 1 after the person already saw the confirmation: back to step 1
  // with the reason and the fields filled in again.
  const bounce = (body: ReturnType<typeof payload>, msg: string) => {
    setV({ ...EMPTY, name: body.name, email: body.email, role: body.role });
    setDone(null); setStep(1); setErr(msg);
  };

  const deliver = (prior: Promise<Result> | null, body: ReturnType<typeof payload>, needPost: boolean) => {
    (prior ?? Promise.resolve<Result>({ ok: true })).then((pr) => {
      if (!pr.ok && pr.hard) return bounce(body, pr.msg);
      if (pr.ok && !needPost) return;
      retry(body, 0);
    });
  };

  // Optimistic finish: reads the form BEFORE resetting it, shows the confirmation right away and
  // saves in the background (after the in-flight step-1 save, so it can't be overwritten by it).
  const finish = (complete: boolean, needPost: boolean) => {
    const body = payload(), prior = pending.current;
    needPost = needPost || step1Failed.current;
    pending.current = null; step1Failed.current = false;
    setDone(complete ? "all" : "list");
    setV(EMPTY); setStep(1); setNudge(false);
    openedAt.current = 0; nudged.current = false;
    if (prior || needPost) deliver(prior, body, needPost);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(""); setErrField(null);
    if (step === 1) {
      const fail = (msg: string, f: ErrField, el: HTMLElement | null) => { setErr(msg); setErrField(f); el?.focus(); };
      if (!v.name.trim()) return fail(w.errName, "name", nameRef.current);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) return fail(w.errEmail, "email", emailRef.current);
      if (!v.role) return fail(w.errRole, "role", roleRef.current);
      // Optimistic: go to step 2 right now and save in the background. If the server refuses the
      // data we bounce back to step 1 with the reason; a plain network failure is retried by the
      // final save (which carries everything).
      const p = post();
      pending.current = p;
      step1Failed.current = false;
      setStep(2);
      bodyRef.current?.scrollTo({ top: 0 });
      p.then((r) => {
        if (pending.current !== p) return; // already finished: deliver() handles the result
        pending.current = null;
        if (r.ok) return;
        if (r.hard) { setStep(1); setErr(r.msg); } else step1Failed.current = true;
      });
      return;
    }
    if (!hasHandle && !nudged.current) { nudged.current = true; setNudge(true); return; }
    finish(true, true);
  };

  const skip = () => {
    setErr("");
    finish(false, extras > 0);
  };

  const focusHandle = () => {
    const key = (HANDLES as readonly string[]).includes(v.main_platform) ? (v.main_platform as Handle) : "x";
    handleInputs.current[key]?.focus();
  };

  const ctx = useMemo(() => ({ open }), [open]);

  return (
    <WaitlistCtx.Provider value={ctx}>
      {children}
      <dialog
        ref={dlg}
        aria-labelledby="xl-wl-title"
        onPointerDown={(e) => { downOnBackdrop.current = e.target === dlg.current; }}
        onClick={(e) => { if (e.target === dlg.current && downOnBackdrop.current) close(); downOnBackdrop.current = false; }}
        className={cn(
          "m-auto w-[min(640px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] overflow-hidden rounded-[2rem] border-0 bg-cream p-0 text-ink",
          "shadow-[0_50px_100px_-30px_rgba(60,15,40,0.5)] backdrop:bg-ink/50 backdrop:backdrop-blur-md",
          "open:flex open:flex-col open:animate-[wl-in_0.6s_cubic-bezier(0.32,0.72,0,1)]",
        )}
      >
        <style>{`@keyframes wl-in{from{opacity:0;transform:translateY(24px) scale(.97)}to{opacity:1;transform:none}}`}</style>
        <div className="flex items-center gap-4 border-b border-line px-6 pb-4 pt-5">
          <img src="/assets/xiaolee-icon-160.webp" width={48} height={48} alt="" className="size-12 rounded-full object-cover ring-[3px] ring-surface" />
          <div className="min-w-0">
            <h2 id="xl-wl-title" className="text-[21px] font-bold tracking-tight">{w.title}</h2>
            {!done && <p className="text-[14px] text-ink-2">{step === 1 ? w.sub1 : w.sub2}</p>}
          </div>
          <button type="button" onClick={close} aria-label={w.close} className="ml-auto grid size-11 shrink-0 place-items-center self-start rounded-full bg-line text-xl text-ink transition-all duration-500 ease-spring hover:rotate-90 hover:bg-[#e2ded8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">×</button>
        </div>

        {done ? (
          <div className="grid place-items-center gap-3 px-8 py-14 text-center">
            <div className="wl-hero relative" aria-hidden="true">
              <img src="/assets/xiaolee-icon-160.webp" width={80} height={80} alt="" className="size-20 rounded-full object-cover ring-4 ring-surface" />
              <svg className="wl-check" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17.5" /><path d="M12 20.5l5.5 5.5L28.5 14.5" /></svg>
              {SPARKS.map(([a, d, c]) => <i key={a} className="wl-spark" style={{ "--a": `${a}deg`, "--d": `${d}s`, "--c": c } as CSSProperties} />)}
            </div>
            <div role="status" className="grid gap-3">
              <h3 ref={doneRef} tabIndex={-1} className="wl-up text-2xl font-bold tracking-tight outline-none" style={{ animationDelay: ".35s" }}>{done === "all" ? w.doneTitleAll : w.doneTitle}</h3>
            <p className="wl-up max-w-sm text-[15px] leading-relaxed text-ink-2" style={{ animationDelay: ".45s" }}>{done === "all" ? w.doneAll : w.doneBody}</p>
            </div>
            <InteractiveHoverButton onClick={close} style={{ animationDelay: ".55s" }} className="wl-up mt-3">{w.done}</InteractiveHoverButton>
          </div>
        ) : (
          <form ref={bodyRef} onSubmit={submit} noValidate className="relative overflow-y-auto px-6 pb-6 pt-5">
            {step === 1 && (
              <div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-[13px] font-bold">{w.name}<span aria-hidden="true" className="text-accent"> *</span></span>
                    <input ref={nameRef} type="text" required maxLength={120} autoComplete="name" placeholder={w.namePh} className={field}
                      aria-invalid={errField === "name" || undefined} aria-describedby={errField === "name" ? ERR_ID : undefined} {...input("name")} />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[13px] font-bold">{w.email}<span aria-hidden="true" className="text-accent"> *</span></span>
                    <input ref={emailRef} type="email" required maxLength={254} autoComplete="email" placeholder={lang === "pt" ? "voce@email.com" : "you@email.com"} className={field}
                      aria-invalid={errField === "email" || undefined} aria-describedby={errField === "email" ? ERR_ID : undefined} {...input("email")} />
                  </label>
                </div>
                <fieldset ref={roleRef} tabIndex={-1} className="mt-5 outline-none" aria-describedby={errField === "role" ? ERR_ID : undefined}>
                  <legend className="mb-2 text-[13px] font-bold">{w.iam}<span aria-hidden="true" className="text-accent"> *</span></legend>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(w.roles) as (keyof typeof w.roles)[]).map((r) => (
                      <Chip key={r} name="role" value={r} label={w.roles[r]} checked={v.role === r} onChange={set("role")} invalid={errField === "role"} />
                    ))}
                  </div>
                </fieldset>
                {err && <p id={ERR_ID} role="alert" className="mt-4 rounded-2xl bg-red-500/10 px-4 py-3 text-[14px] font-semibold text-[#b03030] in-data-[theme=dark]:text-red-300">{err}</p>}
                <SubmitBtn>{w.submit}</SubmitBtn>
                <p className="mt-4 text-center text-[12.5px] text-ink-3">
                  {w.fine1} <a className="underline underline-offset-2 transition-colors hover:text-accent" href="/terms" target="_blank" rel="noopener">{lang === "pt" ? "Termos" : "Terms"}</a> {w.fine2} <a className="underline underline-offset-2 transition-colors hover:text-accent" href="/privacy" target="_blank" rel="noopener">{lang === "pt" ? "Política de Privacidade" : "Privacy Policy"}</a>. {w.fine3}
                </p>
              </div>
            )}

            {step === 2 && (
              <div>
                <div className="rounded-3xl bg-accent-soft p-5 ring-1 ring-accent/15">
                  <h3 ref={boostRef} tabIndex={-1} className="text-[17px] font-bold tracking-tight outline-none">{w.boostTitle}</h3>
                  <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{w.boostBody}</p>
                  <div className="mt-4 flex items-center gap-3 text-[12.5px] font-bold text-ink-2">
                    <span id="xl-wl-profile">{w.profile}</span>
                    <div role="progressbar" aria-labelledby="xl-wl-profile" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                      <div className="h-full origin-left rounded-full bg-accent transition-transform duration-700 ease-spring" style={{ transform: `scaleX(${pct / 100})` }} />
                    </div>
                    <span className="tabular-nums" aria-hidden="true">{pct}%</span>
                  </div>
                </div>

                <label className="mt-5 block">
                  <span className="mb-2 block text-[13px] font-bold">{w.main}</span>
                  <select className={field} {...input("main_platform")}>
                    <option value="">{w.select}</option>
                    {PLATFORM_OPTIONS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p] === "Other" ? (lang === "pt" ? "Outro" : "Other") : PLATFORM_LABEL[p]}</option>)}
                  </select>
                </label>

                <fieldset className="mt-5">
                  <legend className="mb-2 text-[13px] font-bold">{w.socials} <small className="font-medium text-ink-3">{w.socialsHint}</small></legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {HANDLES.map((h) => (
                      <label key={h} className={cn("flex items-center gap-2 rounded-2xl bg-surface px-3 ring-1 transition-shadow duration-300 ease-spring hover:shadow-[0_8px_18px_-12px_rgba(60,15,40,0.35)] focus-within:ring-2 focus-within:ring-accent", v.main_platform === h ? "ring-accent" : "ring-ink/50")}>
                        <span className="w-[68px] shrink-0 text-[12.5px] font-bold text-ink-2">{HANDLE_LABEL[h]}</span>
                        <input
                          ref={(el) => { handleInputs.current[h] = el; }}
                          type="text" maxLength={100} placeholder={h === "youtube" ? "@channel" : "@handle"} aria-label={HANDLE_LABEL[h]}
                          autoCapitalize="none" autoCorrect="off" spellCheck={false}
                          className="w-full bg-transparent py-3 text-base outline-none placeholder:text-ink-3"
                          value={v[`h_${h}`]} onChange={(e) => set(`h_${h}`)(e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="mt-5">
                  <legend className="mb-2 text-[13px] font-bold">{w.audience} <small className="font-medium text-ink-3">{w.audienceHint}</small></legend>
                  <div className="flex flex-wrap gap-2">
                    {AUDIENCE.map(([val, label]) => <Chip key={val} name="audience_size" value={val} label={label} checked={v.audience_size === val} onChange={set("audience_size")} />)}
                  </div>
                </fieldset>

                <fieldset className="mt-5">
                  <legend className="mb-2 text-[13px] font-bold">{w.hasCompany}</legend>
                  <div className="flex gap-2">
                    <Chip name="has_company" value="yes" label={w.yes} checked={v.has_company === "yes"} onChange={set("has_company")} />
                    <Chip name="has_company" value="no" label={w.no} checked={v.has_company === "no"} onChange={set("has_company")} />
                  </div>
                </fieldset>
                {v.has_company === "yes" && (
                  <label className="mt-3 block">
                    <span className="mb-2 block text-[13px] font-bold">{w.company}</span>
                    <input type="text" maxLength={120} autoComplete="organization" placeholder={w.companyPh} className={field} {...input("company_name")} />
                  </label>
                )}

                <label className="mt-5 block">
                  <span className="mb-2 block text-[13px] font-bold">{w.target}</span>
                  <textarea maxLength={1000} rows={3} placeholder={w.targetPh} className={cn(field, "resize-y")} {...input("target_audience")} />
                </label>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-[13px] font-bold">{w.country}</span>
                    <select className={field} {...input("country")}>
                      <option value="">{w.select}</option>
                      {COPY.en.wl.countries.map((c, i) => <option key={c} value={c}>{w.countries[i]}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[13px] font-bold">{w.heard}</span>
                    <select className={field} {...input("referral_source")}>
                      <option value="">{w.select}</option>
                      {COPY.en.wl.sources.map((c, i) => <option key={c} value={c}>{w.sources[i]}</option>)}
                    </select>
                  </label>
                </div>

                {nudge && (
                  <div role="group" aria-labelledby="xl-wl-nudge" className="mt-5 rounded-3xl bg-amber-500/10 p-4 text-[14px] leading-relaxed text-amber-900 in-data-[theme=dark]:text-amber-200 ring-1 ring-amber-500/30">
                    <strong id="xl-wl-nudge" className="block">{w.nudgeTitle}</strong>
                    {w.nudgeBody}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button ref={nudgeAddRef} type="button" onClick={() => { setNudge(false); focusHandle(); }} className="rounded-full bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white transition-all duration-300 ease-spring hover:-translate-y-0.5 hover:bg-accent-hover active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{w.nudgeAdd}</button>
                      <button type="button" onClick={() => { setNudge(false); bodyRef.current?.requestSubmit(); }} className="rounded-full bg-surface px-4 py-2.5 text-[13.5px] font-bold text-ink ring-1 ring-ink/10 transition-all duration-300 ease-spring hover:-translate-y-0.5 hover:ring-ink/25 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{w.nudgeSkip}</button>
                    </div>
                  </div>
                )}

                {err && <p id={ERR_ID} role="alert" className="mt-4 rounded-2xl bg-red-500/10 px-4 py-3 text-[14px] font-semibold text-[#b03030] in-data-[theme=dark]:text-red-300">{err}</p>}
                <SubmitBtn>{w.save}</SubmitBtn>
                <button type="button" onClick={skip} className="mt-2 w-full rounded-full py-3 text-[14px] font-semibold text-ink-2 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50">{w.skip}</button>
              </div>
            )}

            {/* honeypot — real people never see or fill it */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>Website <input type="text" tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => set("website")(e.target.value)} /></label>
            </div>
          </form>
        )}
      </dialog>
    </WaitlistCtx.Provider>
  );
}

function SubmitBtn({ children }: { children: ReactNode }) {
  return <FlowButton type="submit" className="mt-6 w-full">{children}</FlowButton>;
}
