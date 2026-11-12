# Xiaolee Landing Page

Official Xiaolee landing page — a **standalone service**, fully decoupled from the Next.js
frontend (`frontend/`). Vite + React 19 + TypeScript + Tailwind 4 + `motion`, built to static
files and served with `serve`.

The previous version was a single hand-written `index.html`; it's in git history
(`git show develop:landing/index.html`).

## Structure

```
landing/
├── index.html                 # Vite entry (meta/OG, fonts)
├── src/
│   ├── main.tsx · App.tsx
│   ├── index.css              # Tailwind theme: Xiaolee tokens + animation hooks
│   ├── lib/                   # copy.ts (EN/PT), lang.tsx, hooks.ts, utils.ts
│   └── components/
│       ├── kit.tsx            # Reveal, Bezel (double-bezel), CtaButton, MascotVideo…
│       ├── Waitlist.tsx       # 2-step waitlist dialog → Apps Script
│       ├── sections/          # Nav, Hero, Can, How, Trust, Finale
│       └── ui/                # vendored Magic UI + Aceternity components (see below)
├── public/                    # copied as-is to the root of dist/
│   ├── assets/                # icons (160 webp for the UI, 192/512 png), og-image.jpg, Candice font, logos
│   ├── mascot/                # muted mascot loops (.mp4) + posters (.jpg)
│   ├── terms.html · privacy.html · tiktok*.txt
│   ├── robots.txt · sitemap.xml · manifest.webmanifest · favicon.ico
│   └── serve.json             # cache + security headers read by `serve` (see "Caching")
└── apps-script/               # waitlist.gs + tests (unchanged)
```

`public/assets/*` is served at `/assets/*` (the README's APK link depends on that), so Vite's own
bundles go to `/static`.

## Develop

```bash
cd landing
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check + production build → dist/
npm run test:waitlist
```

## Deploy (Railway)

`railway.landing.toml` at the repo root points to `landing/Dockerfile` (build context =
`landing/`). The Dockerfile builds the bundle, then serves `dist/` — same service, same URL.

## SEO, sharing and caching

- **Canonical domain is `https://www.xiaolee.app/`.** It appears in `index.html` (canonical, `og:url`,
  `og:image`, JSON-LD), `public/sitemap.xml`, `public/robots.txt` and the legal pages. Change it everywhere
  or nowhere. The apex → `www` redirect has to be done in DNS/proxy; `serve` can't redirect by host.
- **Link preview image** is `public/assets/og-image.jpg` (1200×630, keep it under ~300 KB: WhatsApp drops
  larger ones). `og:image` URLs must be absolute. After a deploy, check the card in the X/LinkedIn/Facebook
  debuggers and by sending the link on WhatsApp (they cache the first scrape).
- **Icons**: `xiaolee-icon-512.png` is only the manifest/JSON-LD master. The UI uses
  `xiaolee-icon-160.webp` (6 KB vs 427 KB). Regenerate with ImageMagick:
  `magick xiaolee-icon-512.png -resize 160x160 -quality 85 xiaolee-icon-160.webp`.
- **Caching** (`public/serve.json`, verified against `serve@14.2.6`): everything is `no-cache` (ETag → 304)
  except `/static/**` (hashed bundles, 1 year, immutable) and `/assets/**`, `/mascot/**` (7 days, not hashed:
  rename the file when you replace one, or visitors keep the old copy for a week). `serve` already
  compresses with brotli/gzip. Clean URLs are on: `/terms.html` 301-redirects to `/terms`, so link to `/terms`.
- **Accessibility tokens**: `ink-2`, `ink-3`, `accent` and `success` in `src/index.css` are tuned so small
  text passes WCAG AA (4.5:1) on cream, paper and white. Lightening them breaks that.

## Notes

- **Copy lives in `src/lib/copy.ts`**, EN + PT in one typed shape (a missing key fails the build).
  Language defaults to the browser's and is remembered in `localStorage`.
- **Honest status**: the bento tiles in `Can.tsx` have no live/soon badge anymore, so the copy itself has to
  say what is real. Cross-chain deposits are roadmap, not shipped, and the tile must read that way until
  they ship. Same for "USDC": say beta/testnet while it is not on mainnet.
- **Waitlist**: same payload and Apps Script contract as before (`WAITLIST_URL` in `Waitlist.tsx`).
  Setup walkthrough: `docs/workflows/WAITLIST_SHEETS.md`.
- **Mascot videos** are re-encoded (480×650, muted, CRF 29) from `frontend/public/xiaolee_*`. They play
  only while on screen and never for `prefers-reduced-motion` users.
- **Vendored UI** (`src/components/ui/`) is copied from the Magic UI and Aceternity registries (MIT):
  shimmer-button, border-beam, number-ticker, marquee, animated-beam, orbiting-circles, dot-pattern,
  meteors, spotlight, blur-fade. Their keyframes live in `src/index.css`. Animation tokens are in
  `@theme inline` on purpose: they reference per-element vars (`--duration`, `--speed`), which must
  resolve at the use site.
- **Look**: warm cream, magenta accent, Quicksand bold with Oleo Script (closest web match to the Candice logo) on the key word,
  double-bezel cards, an aurora hero and a dark "Trust" section. The hero, the pinned four steps
  (`How.tsx`) and the final CTA use the real mascot clips; the per-mood "Meet her" section was removed
  because it did nothing for the creator pitch.
- Logos in `public/assets/logos/` are white/colored sources rendered as ink via `brightness-0`.
