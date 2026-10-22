/**
 * Regras da Dashboard do criador, sem React nem Expo (testadas por `creator-home-core.test.ts`): o que ganhou, o que gastou
 * e qual é o próximo passo. Cada entrada pode ser `null` = "não consegui ler isso", e a regra nunca trata isso como zero.
 */
// Só tipos: import de valor entre irmãos quebra ou o `tsc` ou o `node --experimental-strip-types` dos testes.
import type { InflowSplit, WalletReceipt } from './creator-wallet';

export interface HomeCampaign {
  participation_status: string;
  tasks_claimed: boolean;
  reward_per_participant: number;
}

export interface HomeVideo {
  status: string;
  price_usdc: number;
}

export interface HomeInputs {
  campaigns: HomeCampaign[] | null;
  /** Vídeos de IA (AI Creators). */
  videos: HomeVideo[] | null;
  /** Vídeos enviados ao Clipper. */
  uploads: number | null;
}

const DAY_MS = 86_400_000;

/** Soma o que já confirmou por origem (pendente ainda não está no saldo); `sinceMs` corta a janela. */
function split(receipts: WalletReceipt[], sinceMs?: number): InflowSplit {
  const out: InflowSplit = { campaign: 0, purchase: 0, transfer: 0, total: 0 };
  for (const item of receipts) {
    if (item.status !== 'confirmed') continue;
    if (sinceMs !== undefined && !(Date.parse(item.createdAt) >= sinceMs)) continue;
    out[item.source] += item.amountUsdc;
    out.total += item.amountUsdc;
  }
  return out;
}

/** Ganhos confirmados nos últimos 30 dias e no total, por origem. */
export function earnings(receipts: WalletReceipt[], now: number): { last30: InflowSplit; all: InflowSplit } {
  return { last30: split(receipts, now - 30 * DAY_MS), all: split(receipts) };
}

/** Gasto com vídeos de IA. Vídeo que falhou é reembolsado, então não conta. */
export function aiSpend(videos: HomeVideo[]): number {
  return videos.reduce((sum, v) => (v.status === 'failed' ? sum : sum + v.price_usdc), 0);
}

/** Recompensas que o criador já ganhou (tarefas verificadas) e ainda não resgatou. */
export function claimable(campaigns: HomeCampaign[]): { count: number; usdc: number } {
  const open = campaigns.filter((c) => c.participation_status === 'tasks_verified' && !c.tasks_claimed);
  return { count: open.length, usdc: open.reduce((sum, c) => sum + c.reward_per_participant, 0) };
}

export type NextStepId = 'claim' | 'first-video' | 'first-clips' | 'join-campaign' | 'keep-creating';

export interface NextStep {
  id: NextStepId;
  title: string;
  text: string;
  cta: string;
  route: '/campaigns' | '/creators' | '/clips';
}

/**
 * Uma sugestão só, na ordem do que mais vale: dinheiro parado primeiro, depois a primeira criação, depois ganhar. Uma
 * entrada ilegível (`null`) não gera sugestão sobre ela: dizer "faça seu primeiro vídeo" a quem só teve a rota falhando
 * seria errado.
 */
export function nextStep({ campaigns, videos, uploads }: HomeInputs): NextStep {
  const open = campaigns ? claimable(campaigns) : { count: 0, usdc: 0 };
  if (open.count > 0) {
    return {
      id: 'claim',
      title: `Claim ${open.usdc.toFixed(2)} USDC`,
      text: `You finished ${open.count === 1 ? 'a campaign' : `${open.count} campaigns`}. Your reward is waiting.`,
      cta: 'Claim now',
      route: '/campaigns',
    };
  }
  if (videos && videos.length === 0) {
    return {
      id: 'first-video',
      title: 'Make your first AI video',
      text: 'Pick a character, choose what it does and see it come to life.',
      cta: 'Start',
      route: '/creators',
    };
  }
  if (uploads === 0) {
    return {
      id: 'first-clips',
      title: 'Turn a long video into clips',
      text: 'Upload a podcast or a live and get 3 vertical clips with captions.',
      cta: 'Choose a video',
      route: '/clips',
    };
  }
  if (campaigns && campaigns.length === 0) {
    return {
      id: 'join-campaign',
      title: 'Join a campaign and earn',
      text: 'Complete a task and get paid in USDC.',
      cta: 'See campaigns',
      route: '/campaigns',
    };
  }
  return {
    id: 'keep-creating',
    title: 'Make something new',
    text: 'Your next video is a few taps away.',
    cta: 'Create',
    route: '/creators',
  };
}
