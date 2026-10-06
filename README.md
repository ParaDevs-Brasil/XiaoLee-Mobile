<p align="center">
  <img src="landing/assets/xiaolee-icon-512.png" alt="Xiaolee" width="120" />
</p>

<h1 align="center">Xiaolee</h1>
<p align="center"><b>Talk to your money.</b></p>

<p align="center">
  Xiaolee is a conversational AI agent that manages your crypto wallet and runs your creator campaigns —
  entirely through chat. No dashboards to learn, no forms to fill. You talk, she executes.
</p>

<p align="center">
  <a href="https://xiaolee-landing-production.up.railway.app">Landing page</a> ·
  <a href="https://xiaolee-landing-production.up.railway.app/assets/xiaolee.apk">Download the app</a> ·
  <a href="https://xiaolee-frontend-production.up.railway.app">Web version</a> ·
  <a href="../../releases">Releases</a>
</p>

---

Xiaolee ships in two flavors that don't share infrastructure: **this repo** is the mobile app (Expo) and its
backend; the **web app** linked above lives in a separate repository with its own backend. Same agent, same
idea, different codebases — a fix here isn't automatically live there.

---

## What she does

Xiaolee sits between you and two things people usually need a dozen different tools for: **your wallet** and
**your creator campaigns**. Both are driven by natural conversation — she calls the right tool underneath, you
never touch a transaction hash or a form.

- **Wallet, hands-free** — check your live USDC balance, send or swap funds, just by asking. Balances update in
  real time on screen, no pull-to-refresh, no navigating away and back.
- **Non-custodial, always** — your embedded wallet is yours. Xiaolee prepares transactions; you (or your device's
  secure enclave) sign them. She never holds your keys.
- **Campaigns, created by talking** — describe a campaign in a sentence ("R$500 pool, 3 dias, RT + follow") and
  she walks you through the rest field by field, then puts it live.
- **Campaigns, joined by talking** — as a creator, tell her you want in. She checks your tasks, verifies them
  live against the platform, and prepares your claim — you just sign it.
- **USDC settlement on Arc** — payouts settle in USDC on Arc (Circle's EVM network), with legacy Solana devnet
  support from where the product started.
- **Wherever you already are** — the same agent answers in the mobile app, the web app, Telegram, and X DMs.
  One brain, four front doors.
- **PT/EN, automatically** — Xiaolee mirrors whichever language you write to her in, no toggle required (there's
  one anyway, for the UI chrome).

## How to use it

1. **Download and open the app** — [grab the APK](https://xiaolee-landing-production.up.railway.app/assets/xiaolee.apk)
   or use the [web version](https://xiaolee-frontend-production.up.railway.app). First open plays her intro,
   then drops you straight into chat.
2. **Say hi** — a wallet is created for you automatically, no seed phrase to write down.
3. **Ask about your money** — "what's my balance", "send 5 USDC to @friend", "swap this for that". She asks for
   confirmation before anything moves; you sign it.
4. **Running a campaign?** Tell her the budget, the criteria, and how long it runs. She'll ask for whatever's
   missing and put it live when you confirm.
5. **Joining one?** Tell her you're in. Do the tasks the campaign asks for, tell her you're done, and she
   verifies and prepares your claim — you just sign to receive.
6. **Switch languages any time** — write to her in Portuguese or English, she replies in kind.

## How it works

Every channel talks to one FastAPI backend. A tool-calling LLM loop (`OrchestrationService`) decides what you're
asking for and calls the matching tool — wallet, swap, or campaign — with your identity injected by the backend,
never taken from the model. That's a hard rule in this codebase: **wallet and budget are never a model
parameter.**

```mermaid
graph LR
    subgraph CHANNELS["Where you talk to her"]
        MOB["Mobile app<br>(Expo · Privy embedded wallet)"]
        WEB["Web app<br>(Next.js)"]
        TG["Telegram"]
        X["X / Twitter DM"]
    end

    subgraph CORE["Backend (FastAPI)"]
        APP["/chat · inbound router"]
        ORCH["OrchestrationService<br>tool-calling agent loop"]
        TOOLS["Tools: wallet, swap/transfer,<br>create/join/verify/claim campaign"]
    end

    subgraph SETTLE["Settlement"]
        ARC["Arc (Circle EVM)<br>native USDC"]
        SOL["Solana devnet<br>(legacy)"]
    end

    DB[("PostgreSQL")]

    MOB --> APP
    WEB --> APP
    TG --> APP
    X --> APP

    APP --> ORCH
    ORCH --> TOOLS
    TOOLS --> DB
    TOOLS --> ARC
    TOOLS --> SOL
```

### Creating and claiming a campaign — entirely in chat

This is the part that used to be a form. Now it's a conversation on both ends: the brand describes what they
want, Xiaolee builds the campaign; the creator says they're in, Xiaolee checks their work and hands them a
claim to sign.

```mermaid
sequenceDiagram
    actor Brand
    actor Creator
    participant Xiaolee as Xiaolee (agent)
    participant API as Backend
    participant Chain as Arc / USDC

    Brand->>Xiaolee: "Quero criar uma campanha de R$500..."
    Xiaolee->>Brand: guides through budget, criteria, duration
    Xiaolee->>API: create_campaign(...)
    API-->>Xiaolee: campaign live

    Creator->>Xiaolee: "quero entrar na campanha X"
    Xiaolee->>API: join_campaign(...)
    Creator->>Xiaolee: "já segui, já dei RT"
    Xiaolee->>API: verify_campaign_tasks(...)
    API-->>Xiaolee: tasks verified

    Xiaolee->>API: prepare_campaign_claim(...)
    API-->>Xiaolee: unsigned proof (amount, wallet, message)
    Xiaolee->>Creator: "confirma essa assinatura pra receber"
    Creator->>Chain: signs claim (device wallet)
    Chain-->>Creator: USDC settled
```

### First open of the app

```mermaid
graph LR
    A["Intro video<br>(her voice, plays once)"] -->|dissolve| B["Loading<br>(pink, her face)"]
    B -->|slower dissolve| C["Chat"]
```

Native splash is invisible and matches the video's own background, so the video feels like the very first
thing that happens — no separate splash step, no jump cut between stages.

## Interface

| Chat | Dashboard | Campaigns | Notifications |
|---|---|---|---|
| ![Chat](chat.png) | ![Dashboard](dashboard.png) | ![Campaigns](campaings.png) | ![Notifications](notifications.png) |

## Repository layout

| Path | What's in it |
|---|---|
| [`mobile/`](mobile/) | The flagship client — Expo/React Native, Privy embedded wallet, expo-router |
| `backend/` | FastAPI — chat orchestration, campaigns, wallet tools, Telegram/X pollers |
| `landing/` | Static landing page (Railway, deployed independently of git) |
| `frontend/` | Legacy Next.js web client — superseded by the separate web repo |
| `solana-program/` | Legacy Anchor program from the project's Solana-native phase |
| `docs/` | Architecture, API reference, design system, mainnet readiness |

## Tech stack

| Layer | Choice |
|---|---|
| Mobile | Expo (SDK 57), React Native, expo-router, Privy embedded wallet |
| Web (legacy, this repo) | Next.js, React, Tailwind |
| Backend | FastAPI, SQLAlchemy 2.0 (async), Alembic |
| Database | PostgreSQL in production, SQLite in dev |
| Agent | Tool-calling LLM loop (`OrchestrationService`), shared across every channel |
| Settlement | Arc (Circle EVM, native USDC), legacy Solana devnet (Anchor/Rust) |
| Messaging channels | In-app chat, Telegram bot, X/Twitter DM |
| Infra | Railway (backend, landing), Redis (rate limiting, optional fallback to in-memory) |
| Observability | Prometheus + Grafana |

## Getting started

```bash
make init                  # Python venv + npm + .env
make dev                   # backend :8000 + web frontend :3000
```

Mobile app (needs the backend running):

```bash
make init-mobile           # first run only
make dev-mobile            # Metro — scan the QR with Expo Go, or a dev-client build
```

See [`mobile/README.md`](mobile/README.md) for the mobile-specific setup, and
[`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) for every route the agent's tools call into.

### Tests

```bash
make test-backend          # pytest
make ci-local               # lint + test + build, same as CI
```

## Security

- **Wallet and budget are never a model parameter** — the agent decides *what* to do, the backend injects *who*
  and *how much* from the authenticated session, always.
- Non-custodial by construction — every claim, swap, or transfer is prepared unsigned by the backend and signed
  client-side.
- Anti-replay on payment intents; idempotent campaign joins (unique constraint, not a race).
- HMAC-validated Telegram and X webhooks; rate limiting on inbound chat.
- `EXPO_PUBLIC_*` env vars are readable by anyone who downloads the app — build-time config only, never secrets.

## Docs

| File | Contents |
|---|---|
| [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) | Every route, payload, and error code |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Full architecture, diagrams, historical context |
| [`docs/workflows/ARC_LEPTON_ARCHITECTURE.md`](docs/workflows/ARC_LEPTON_ARCHITECTURE.md) | The Arc/Circle migration in detail |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Palette, i18n, layout conventions |
| [`docs/MAINNET_READINESS.md`](docs/MAINNET_READINESS.md) | Gates and checklist before mainnet |
| [`mobile/README.md`](mobile/README.md) | Mobile app setup, URL resolution, project structure |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup, conventions, how to contribute |
