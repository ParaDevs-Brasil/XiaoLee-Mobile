import type { ReactNode } from "react";
import {
  Check, ChevronDown, ChevronRight, ClipboardList, Heart, Mic, Play, Plus, Scissors, Search, Send,
  Share2, ShieldCheck, SlidersHorizontal, Sparkles, Target, Upload, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { AppScreen } from "./AppPhone";

/* Demo data only: a made-up creator ("Ana"), a made-up character and example numbers. Nothing here is a real account. */

const TX = {
  en: {
    hi: "Hi, Ana", hiSub: "Your creator studio, campaigns and wallet, all in one place.",
    setup: "Get set up", of: "2 of 4", acct: "Create your account", done: "Done", xconn: "Connect your X account",
    first: "Make your first clip", firstSub: "Cut highlights from a long video", makeClip: "Make a clip", seeAll: "See all 4 steps",
    ask: "Ask Xiaolee anything…", can: "What Xiaolee can do", clips: "Clips", clipsSub: "Cut highlights from long videos", reports: "Reports", reportsSub: "Weekly recap of your numbers",
    studio: "Studio", studioSub: "Create, publish and track your content.",
    tabs: ["Clips", "AI Creators", "Reports", "Share"],
    turn: "Turn one long video into 3 vertical clips", turnSub: "A podcast, live or talk, up to 2 GB.", choose: "Choose a video",
    flow: "Upload › Transcribe › Find moments › Cut", words: "Words to get right", wordsSub: "Names and slang for captions", fmt: "Format ideas", fmtSub: "Ideas from your videos",
    videos: "Your videos", clipNames: ["The hook", "The story", "The punchline"],
    charTitle: "Mika", charSub: "AI Creator · Brazilian voice", script: "Script", scriptText: "Hey! Today I'll show you three ways to turn one video into a week of posts…",
    gen: "Generate video", price: "You pay per video, in USDC", voice: "Voice", voiceName: "Pri · Warm & natural", format: "Format", fmts: ["Talk", "Mimic", "Replace"],
    pick: "Choose a voice", tap: "Tap play to hear it", search: "Search voices", cats: ["Brazilian", "Narrators", "Adventurers", "Villains"],
    voices: [["Guilherme", "Male · Brazilian Narrator"], ["Andre Ambrosio", "Male · Brazilian & Northeast"], ["Pri", "Female · Warm & Natural"], ["Dani", "Female · Warm Social Media"], ["Serena", "Female · Cute, Relaxed"], ["Vanessa", "Female · Confident"]],
    pickBtn: "Use Pri", example: "Example data",
    repTitle: "Your month with Xiaolee", repSub: "Report · September", earned: "Earned", clipsMade: "Clips made", posts: "Posts", camp: "Campaigns",
    next: "What to do next", n1: "Post your 3 clips this week", n2: "Join the Creator duet challenge",
    card: "Your Xiaolee card", cardSub: "Post it on WhatsApp, X and more", shareProfile: "Share profile", pub: "Publish straight from Xiaolee",
    p1: "Draft posts with Xiaolee", p2: "Preview before it goes live", p3: "See every post listed here", write: "Write a post", connected: "Connected",
    accounts: "Accounts", accountsSub: "Connect X and Telegram",
    grow: "Grow", growSub: "Campaigns, sales and your numbers.", newBtn: "New", gtabs: ["Campaigns", "Marketplace", "Insights"], sub: ["Explore", "My Campaigns", "Rewards"],
    pool: "pool", join: "Join", spots: "spots left", days: "days left", camps: ["Launch week boost", "Creator duet challenge"],
  },
  pt: {
    hi: "Oi, Ana", hiSub: "Seu estúdio, campanhas e carteira, tudo num lugar só.",
    setup: "Configure sua conta", of: "2 de 4", acct: "Criar sua conta", done: "Pronto", xconn: "Conectar sua conta do X",
    first: "Faça seu primeiro corte", firstSub: "Tire os melhores momentos de um vídeo longo", makeClip: "Fazer um corte", seeAll: "Ver os 4 passos",
    ask: "Pergunte qualquer coisa à Xiaolee…", can: "O que a Xiaolee faz", clips: "Cortes", clipsSub: "Melhores momentos de vídeos longos", reports: "Relatórios", reportsSub: "Resumo semanal dos seus números",
    studio: "Studio", studioSub: "Crie, publique e acompanhe seu conteúdo.",
    tabs: ["Cortes", "AI Creators", "Relatórios", "Share"],
    turn: "Transforme um vídeo longo em 3 cortes verticais", turnSub: "Podcast, live ou palestra, até 2 GB.", choose: "Escolher um vídeo",
    flow: "Envio › Transcrição › Momentos › Corte", words: "Palavras certas", wordsSub: "Nomes e gírias para as legendas", fmt: "Ideias de formato", fmtSub: "Ideias a partir dos seus vídeos",
    videos: "Seus vídeos", clipNames: ["O gancho", "A história", "A virada"],
    charTitle: "Mika", charSub: "AI Creator · voz brasileira", script: "Roteiro", scriptText: "Oi! Hoje eu vou mostrar três jeitos de transformar um vídeo em uma semana de posts…",
    gen: "Gerar vídeo", price: "Você paga por vídeo, em USDC", voice: "Voz", voiceName: "Pri · Calorosa e natural", format: "Formato", fmts: ["Falar", "Mimic", "Replace"],
    pick: "Escolha uma voz", tap: "Toque em play para ouvir", search: "Buscar vozes", cats: ["Brasileiras", "Narradores", "Aventureiros", "Vilões"],
    voices: [["Guilherme", "Masculina · Narrador brasileiro"], ["Andre Ambrosio", "Masculina · Brasileiro e nordestino"], ["Pri", "Feminina · Calorosa e natural"], ["Dani", "Feminina · Social media"], ["Serena", "Feminina · Fofa e relaxada"], ["Vanessa", "Feminina · Confiante"]],
    pickBtn: "Usar Pri", example: "Dados de exemplo",
    repTitle: "Seu mês com a Xiaolee", repSub: "Relatório · setembro", earned: "Ganhos", clipsMade: "Cortes feitos", posts: "Posts", camp: "Campanhas",
    next: "O que fazer agora", n1: "Poste seus 3 cortes esta semana", n2: "Entre no desafio de duetos",
    card: "Seu cartão Xiaolee", cardSub: "Poste no WhatsApp, X e mais", shareProfile: "Compartilhar perfil", pub: "Publique direto da Xiaolee",
    p1: "Rascunhe posts com a Xiaolee", p2: "Veja a prévia antes de publicar", p3: "Todos os posts listados aqui", write: "Escrever um post", connected: "Conectado",
    accounts: "Contas", accountsSub: "Conecte X e Telegram",
    grow: "Grow", growSub: "Campanhas, vendas e seus números.", newBtn: "Novo", gtabs: ["Campanhas", "Marketplace", "Insights"], sub: ["Explorar", "Minhas", "Recompensas"],
    pool: "pool", join: "Entrar", spots: "vagas", days: "dias", camps: ["Semana de lançamento", "Desafio de duetos"],
  },
};

export type Tx = (typeof TX)["en"];
export const useTx = (): Tx => TX[useLang().lang];

const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("rounded-[22px] border border-(--a-border) bg-(--a-card)", className)}>{children}</div>
);
const Pill = ({ children }: { children: ReactNode }) => (
  <div className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-(--a-fill) text-[15px] font-bold text-white">{children}</div>
);
const Title = ({ a, b }: { a: string; b: string }) => (
  <div className="mb-3">
    <div className="text-[27px] font-bold leading-tight text-(--a-ink)">{a}</div>
    <div className="text-[13px] text-(--a-ink2)">{b}</div>
  </div>
);
function SegTabs({ items, active }: { items: string[]; active: number }) {
  return (
    <div className="mb-3 flex rounded-full bg-(--a-tray) p-1">
      {items.map((s, i) => (
        <span key={s} className={cn("flex-1 rounded-full py-2 text-center text-[12.5px] font-semibold", i === active ? "bg-(--a-bg) text-(--a-accent)" : "text-(--a-ink2)")}>{s}</span>
      ))}
    </div>
  );
}
const Tile = ({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) => (
  <Card className="p-3.5">
    <span className="grid size-10 place-items-center rounded-xl bg-(--a-soft) text-(--a-accent)">{icon}</span>
    <div className="mt-3 text-[14px] font-bold text-(--a-ink)">{title}</div>
    <div className="text-[11.5px] leading-snug text-(--a-ink2)">{sub}</div>
  </Card>
);

export function HomeScreen() {
  const x = useTx();
  return (
    <AppScreen tab="home">
      <Title a={x.hi} b={x.hiSub} />
      <Card className="p-4">
        <div className="flex items-center justify-between"><span className="text-[16px] font-bold">{x.setup}</span><span className="text-[12px] text-(--a-ink2)">{x.of}</span></div>
        <div className="mt-2.5 h-1.5 rounded-full bg-(--a-tray)"><div className="h-full w-1/2 rounded-full bg-(--a-fill)" /></div>
        {[x.acct, x.xconn].map((s) => (
          <div key={s} className="mt-3 flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-full bg-(--a-success-soft) text-(--a-success)"><Check size={16} strokeWidth={2.4} /></span>
            <div><div className="text-[13.5px] font-semibold">{s}</div><div className="text-[11.5px] text-(--a-ink2)">{x.done}</div></div>
          </div>
        ))}
        <div className="mt-3 rounded-2xl bg-(--a-soft) p-3">
          <div className="flex items-center gap-3">
            <span className="size-8 rounded-full border-2 border-(--a-border)" />
            <div><div className="text-[13.5px] font-semibold">{x.first}</div><div className="text-[11px] text-(--a-ink2)">{x.firstSub}</div></div>
          </div>
          <div className="mt-3"><Pill>{x.makeClip}</Pill></div>
        </div>
        <div className="mt-3 text-center text-[12.5px] font-semibold text-(--a-accent)">{x.seeAll}</div>
      </Card>
      <Card className="mt-3 flex items-center gap-3 rounded-full p-2 pr-2">
        <img src="/mascot/kawaii.jpg" alt="" className="size-9 rounded-full object-cover" style={{ objectPosition: "50% 12%" }} />
        <span className="flex-1 text-[12.5px] text-(--a-ink3)">{x.ask}</span>
        <span className="grid size-9 place-items-center rounded-full bg-(--a-fill) text-white"><Send size={15} /></span>
      </Card>
      <div className="mb-2 mt-4 text-[15px] font-bold">{x.can}</div>
      <div className="grid grid-cols-2 gap-2.5">
        <Tile icon={<Scissors size={19} />} title={x.clips} sub={x.clipsSub} />
        <Tile icon={<ClipboardList size={19} />} title={x.reports} sub={x.reportsSub} />
      </div>
    </AppScreen>
  );
}

const CLIP_POSTERS = ["/mascot/clip-1.jpg", "/mascot/clip-2.jpg", "/mascot/clip-3.jpg"];

export function ClipsScreen() {
  const x = useTx();
  return (
    <AppScreen tab="studio">
      <Title a={x.studio} b={x.studioSub} />
      <SegTabs items={x.tabs} active={0} />
      <div className="rounded-[26px] border border-(--a-fill) bg-(--a-hero) p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-(--a-accent)"><Scissors size={14} /> {x.clips}</div>
            <div className="mt-2 text-[17px] font-bold leading-snug">{x.turn}</div>
            <div className="mt-1 text-[11.5px] text-(--a-ink2)">{x.turnSub}</div>
          </div>
          <div className="relative mt-1 h-16 w-16 shrink-0">
            {[-9, 0, 9].map((r, i) => (
              <span key={r} className="absolute left-2 top-0 h-14 w-9 rounded-lg bg-black ring-1 ring-white/10" style={{ transform: `rotate(${r}deg) translateX(${(i - 1) * 7}px)` }} />
            ))}
          </div>
        </div>
        <div className="mt-3"><Pill><Upload size={17} /> {x.choose}</Pill></div>
        <div className="mt-2.5 text-center text-[10.5px] text-(--a-ink2)">{x.flow}</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <Card className="p-3"><Sparkles size={16} className="text-(--a-accent)" /><div className="mt-2 text-[13px] font-bold">{x.words}</div><div className="text-[11px] text-(--a-ink2)">{x.wordsSub}</div></Card>
        <Card className="p-3"><Scissors size={16} className="text-(--a-accent)" /><div className="mt-2 text-[13px] font-bold">{x.fmt}</div><div className="text-[11px] text-(--a-ink2)">{x.fmtSub}</div></Card>
      </div>
      <div className="mb-2 mt-4 text-[15px] font-bold">{x.videos}</div>
      <div className="grid grid-cols-3 gap-2">
        {CLIP_POSTERS.map((p, i) => (
          <div key={p} className="relative aspect-[9/14] overflow-hidden rounded-xl bg-black">
            <img src={p} alt="" className="size-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-1.5 text-[10px] font-bold text-white">{x.clipNames[i]}</span>
            <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-(--a-fill) text-white"><Play size={9} fill="currentColor" /></span>
          </div>
        ))}
      </div>
    </AppScreen>
  );
}

export function CreatorScreen() {
  const x = useTx();
  return (
    <AppScreen tab="studio">
      <Title a={x.studio} b={x.studioSub} />
      <SegTabs items={x.tabs} active={1} />
      <Card className="p-3.5">
        <div className="flex items-center gap-3">
          <img src="/mascot/kawaii.jpg" alt="" className="size-14 rounded-2xl object-cover" style={{ objectPosition: "50% 12%" }} />
          <div className="flex-1"><div className="text-[16px] font-bold">{x.charTitle}</div><div className="text-[11.5px] text-(--a-ink2)">{x.charSub}</div></div>
          <span className="rounded-full bg-(--a-soft) px-2.5 py-1 text-[10px] font-bold text-(--a-accent)">AI Video</span>
        </div>
        <div className="mt-3 flex gap-1.5">
          {x.fmts.map((f, i) => (
            <span key={f} className={cn("flex-1 rounded-full py-1.5 text-center text-[12px] font-semibold", i === 0 ? "bg-(--a-fill) text-white" : "bg-(--a-tray) text-(--a-ink2)")}>{f}</span>
          ))}
        </div>
        <div className="mt-3 text-[12px] font-bold text-(--a-ink2)">{x.script}</div>
        <div className="mt-1 rounded-2xl bg-(--a-bg) p-3 text-[12.5px] leading-relaxed text-(--a-ink)">{x.scriptText}</div>
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-(--a-border) p-2.5">
          <span className="grid size-9 place-items-center rounded-full bg-(--a-soft) text-(--a-accent)"><Mic size={16} /></span>
          <div className="flex-1"><div className="text-[11px] text-(--a-ink2)">{x.voice}</div><div className="text-[12.5px] font-semibold">{x.voiceName}</div></div>
          <ChevronRight size={16} className="text-(--a-ink3)" />
        </div>
        <div className="mt-3"><Pill><Play size={14} fill="currentColor" /> {x.gen}</Pill></div>
        <div className="mt-2 text-center text-[11px] text-(--a-ink2)">{x.price}</div>
      </Card>
    </AppScreen>
  );
}

const VOICE_TONES = ["from-rose-400 to-red-500", "from-indigo-400 to-violet-600", "from-teal-300 to-emerald-500", "from-amber-300 to-orange-500", "from-sky-400 to-blue-600", "from-fuchsia-400 to-purple-600"];

export function VoiceScreen() {
  const x = useTx();
  return (
    <AppScreen
      tab="studio"
      sheet={
        <div className="absolute inset-x-0 bottom-0 top-16 z-20 flex flex-col rounded-t-[28px] border-t border-(--a-border) bg-(--a-card) px-4 pt-2 shadow-[0_-30px_60px_-20px_rgba(0,0,0,0.6)]">
          <span className="mx-auto h-1 w-10 rounded-full bg-(--a-border)" />
          <div className="mt-3 text-[20px] font-bold">{x.pick}</div>
          <div className="text-[12px] text-(--a-ink2)">{x.tap}</div>
          <div className="mt-3 flex gap-2">
            <div className="flex h-10 flex-1 items-center gap-2 rounded-full bg-(--a-bg) px-3 text-[12.5px] text-(--a-ink3)"><Search size={15} /> {x.search}</div>
            <span className="grid size-10 place-items-center rounded-full bg-(--a-bg) text-(--a-ink2)"><SlidersHorizontal size={16} /></span>
          </div>
          <div className="mt-2.5 flex gap-1.5 overflow-hidden">
            {x.cats.map((c, i) => (
              <span key={c} className={cn("shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-semibold", i === 0 ? "bg-(--a-fill) text-white" : "border border-(--a-border) text-(--a-ink)")}>{c}</span>
            ))}
          </div>
          <div className="mt-2.5 space-y-1.5">
            {x.voices.map(([n, d], i) => (
              <div key={n} className={cn("flex items-center gap-3 rounded-2xl border p-2", i === 2 ? "border-(--a-fill) bg-(--a-soft)" : "border-(--a-border)")}>
                <span className={cn("grid size-10 place-items-center rounded-full bg-linear-to-br", VOICE_TONES[i])}>
                  <span className="flex h-5 items-center gap-[2.5px]">{[40, 75, 100, 60, 85, 45].map((h, k) => <i key={k} className="block w-[2.5px] rounded-full bg-white" style={{ height: `${h}%` }} />)}</span>
                </span>
                <div className="min-w-0 flex-1"><div className="text-[13.5px] font-bold">{n}</div><div className="truncate text-[11px] text-(--a-ink2)">{d}</div></div>
                <Heart size={17} className={i === 2 ? "fill-(--a-accent) text-(--a-accent)" : "text-(--a-ink3)"} />
                <span className="grid size-8 place-items-center rounded-full bg-(--a-bg)"><Play size={12} fill="currentColor" /></span>
              </div>
            ))}
          </div>
          <div className="mt-auto pb-4"><Pill>{x.pickBtn}</Pill></div>
        </div>
      }
    >
      <Title a={x.studio} b={x.studioSub} />
      <SegTabs items={x.tabs} active={1} />
    </AppScreen>
  );
}

export function ReportsScreen() {
  const x = useTx();
  const bars = [32, 48, 40, 66, 58, 82, 74];
  return (
    <AppScreen tab="studio">
      <Title a={x.studio} b={x.studioSub} />
      <SegTabs items={x.tabs} active={2} />
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div><div className="text-[16px] font-bold">{x.repTitle}</div><div className="text-[11.5px] text-(--a-ink2)">{x.repSub}</div></div>
          <span className="rounded-full bg-(--a-soft) px-2.5 py-1 text-[10px] font-bold text-(--a-accent)">{x.example}</span>
        </div>
        <div className="mt-3 text-[11.5px] text-(--a-ink2)">{x.earned}</div>
        <div className="text-[34px] font-bold leading-none">42.80 <span className="text-[14px] text-(--a-ink2)">USDC</span></div>
        <div className="mt-3 flex h-20 items-end gap-1.5">
          {bars.map((h, i) => <span key={i} className={cn("flex-1 rounded-t-md", i === bars.length - 1 ? "bg-(--a-fill)" : "bg-(--a-soft)")} style={{ height: `${h}%` }} />)}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[[x.clipsMade, "12"], [x.posts, "9"], [x.camp, "3"]].map(([l, v]) => (
            <div key={l} className="rounded-2xl bg-(--a-bg) p-2.5"><div className="text-[18px] font-bold">{v}</div><div className="text-[10.5px] text-(--a-ink2)">{l}</div></div>
          ))}
        </div>
      </Card>
      <div className="mb-2 mt-3.5 text-[14px] font-bold">{x.next}</div>
      {[x.n1, x.n2].map((s) => (
        <Card key={s} className="mb-2 flex items-center gap-3 p-3">
          <span className="grid size-8 place-items-center rounded-full bg-(--a-soft) text-(--a-accent)"><Target size={15} /></span>
          <span className="flex-1 text-[12.5px] font-semibold">{s}</span>
          <ChevronRight size={15} className="text-(--a-ink3)" />
        </Card>
      ))}
    </AppScreen>
  );
}

export function ShareScreen() {
  const x = useTx();
  return (
    <AppScreen tab="studio">
      <Title a={x.studio} b={x.studioSub} />
      <SegTabs items={x.tabs} active={3} />
      <Card className="p-3.5">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-(--a-fill) text-white"><User size={22} /></span>
          <div><div className="text-[15px] font-bold">{x.card}</div><div className="text-[11.5px] text-(--a-ink2)">{x.cardSub}</div></div>
        </div>
        <div className="mt-3"><Pill><Share2 size={15} /> {x.shareProfile}</Pill></div>
      </Card>
      <Card className="mt-3 p-3.5">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-[#f6f4f1] text-[18px] font-bold text-black">X</span>
          <div>
            <div className="text-[14.5px] font-bold">@ana.cria</div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-(--a-success-soft) px-2.5 py-0.5 text-[11px] font-semibold text-(--a-success)"><i className="size-1.5 rounded-full bg-(--a-success)" /> {x.connected}</span>
          </div>
        </div>
        <div className="mt-3 text-[16px] font-bold">{x.pub}</div>
        {[x.p1, x.p2, x.p3].map((s) => (
          <div key={s} className="mt-2 flex items-center gap-2.5 text-[12.5px]">
            <span className="grid size-6 place-items-center rounded-full bg-(--a-soft) text-(--a-accent)"><Check size={13} strokeWidth={2.6} /></span>{s}
          </div>
        ))}
        <div className="mt-3"><Pill>{x.write}</Pill></div>
      </Card>
      <Card className="mt-3 flex items-center gap-3 p-3">
        <Share2 size={18} className="text-(--a-accent)" />
        <div className="flex-1"><div className="text-[13.5px] font-bold">{x.accounts}</div><div className="text-[11.5px] text-(--a-ink2)">{x.accountsSub}</div></div>
      </Card>
    </AppScreen>
  );
}

export function GrowScreen() {
  const x = useTx();
  const data = [["300", "85", "5"], ["150", "40", "2"]];
  return (
    <AppScreen tab="grow">
      <div className="mb-3 flex items-start justify-between">
        <div><div className="text-[27px] font-bold leading-tight">{x.grow}</div><div className="text-[12.5px] text-(--a-ink2)">{x.growSub}</div></div>
        <span className="flex h-10 items-center gap-1.5 rounded-2xl bg-(--a-fill) px-4 text-[13.5px] font-bold text-white"><Plus size={16} /> {x.newBtn}</span>
      </div>
      <div className="mb-3 flex gap-2">
        {x.gtabs.map((t, i) => (
          <span key={t} className={cn("rounded-full px-3.5 py-2 text-[12.5px] font-semibold", i === 0 ? "bg-(--a-fill) text-white" : "border border-(--a-border) text-(--a-ink2)")}>{t}</span>
        ))}
      </div>
      <div className="mb-3 flex gap-1 rounded-2xl border border-(--a-border) bg-(--a-card) p-1.5">
        {x.sub.map((t, i) => (
          <span key={t} className={cn("rounded-xl px-3 py-1.5 text-[12px] font-semibold", i === 0 ? "bg-(--a-fill) text-white" : "text-(--a-ink2)")}>{t}</span>
        ))}
      </div>
      {x.camps.map((c, i) => (
        <Card key={c} className="mb-2.5 p-3.5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-(--a-soft) text-(--a-accent)"><Target size={19} /></span>
            <div className="flex-1"><div className="text-[14px] font-bold">{c}</div><div className="text-[11.5px] text-(--a-ink2)">{data[i][0]} USDC {x.pool}</div></div>
            <span className="rounded-full bg-(--a-success-soft) px-2 py-0.5 text-[10px] font-bold text-(--a-success)">{data[i][2]} {x.days}</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-(--a-ink2)"><span>RT + follow</span><span>{data[i][1]} {x.spots}</span></div>
          <div className="mt-2.5"><Pill>{x.join}</Pill></div>
        </Card>
      ))}
      <div className="flex items-center justify-between rounded-2xl border border-(--a-border) px-3.5 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-(--a-ink2)">
        <span className="flex items-center gap-2"><ShieldCheck size={16} className="text-(--a-accent)" /> How it works</span><ChevronDown size={16} />
      </div>
    </AppScreen>
  );
}
