/**
 * Regras puras da tela do relatório de 30 dias, sem React/Expo — testável em
 * Node. Os números e as sugestões vêm prontos do backend
 * (`GET /v1/reports/me/{id}`); aqui só se decide como mostrá-los.
 */
import type { CreatorReportMetrics } from '@/api/backend';

/** Notificação que abre um relatório: o job grava `{ kind, report_id }` no metadata. */
export const REPORT_NOTIFICATION_KIND = 'creator_report';

/** Id do relatório de uma notificação, ou `null` se ela não for de relatório. */
export function reportIdOf(metadata: Record<string, unknown> | null | undefined): number | null {
  if (!metadata || metadata.kind !== REPORT_NOTIFICATION_KIND) return null;
  const id = Number(metadata.report_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export type MetricKey = keyof CreatorReportMetrics;
export type DeltaTone = 'up' | 'down' | 'flat' | 'new';

export interface MetricRow {
  key: MetricKey;
  label: string;
  value: string;
  /** "+2 vs previous 30 days" — vazio quando os dois períodos são zero. */
  delta: string;
  tone: DeltaTone;
  /** Valores crus dos dois períodos — o card os usa para desenhar as barras de comparação. */
  now: number;
  before: number;
}

/** Ordem da tela: o que o creator produziu primeiro, o dinheiro por último. */
const METRICS: {
  key: MetricKey;
  label: string;
  usdc?: boolean;
  decimals?: number;
}[] = [
  { key: 'videos', label: 'Videos uploaded' },
  { key: 'video_minutes', label: 'Minutes of video', decimals: 1 },
  { key: 'clips', label: 'Clips generated' },
  { key: 'campaigns_joined', label: 'Campaigns joined' },
  { key: 'usdc_received', label: 'USDC received', usdc: true },
];

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmt(value: number, usdc?: boolean, decimals = 0): string {
  return usdc
    ? value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : value.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

/**
 * Uma linha por métrica, com a variação contra os 30 dias anteriores. Campo
 * ausente conta como zero: um backend mais velho sem a métrica não derruba a tela.
 */
export function reportMetricRows(
  current: Partial<CreatorReportMetrics>,
  previous: Partial<CreatorReportMetrics>,
): MetricRow[] {
  return METRICS.map(({ key, label, usdc, decimals }) => {
    const now = num(current[key]);
    const before = num(previous[key]);
    const diff = Math.round((now - before) * 100) / 100;
    let tone: DeltaTone = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    let delta = '';
    if (before === 0 && now > 0) {
      tone = 'new';
      delta = 'New this period';
    } else if (now !== 0 || before !== 0) {
      delta =
        diff === 0
          ? 'Same as before'
          : `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff), usdc, decimals)} vs previous 30 days`;
    }
    return { key, label, value: fmt(now, usdc, decimals), delta, tone, now, before };
  });
}

/** O número já no formato da métrica (USDC com 2 casas, minutos com 1) — a contagem da tela passa por aqui a cada quadro. */
export function formatMetricValue(key: MetricKey, value: number): string {
  const metric = METRICS.find((m) => m.key === key);
  return fmt(value, metric?.usdc, metric?.decimals);
}

/** Quantas métricas subiram (ou apareceram) e quantas caíram — os chips do resumo. */
export function reportHighlights(rows: MetricRow[]): { up: number; down: number } {
  return {
    up: rows.filter((row) => row.tone === 'up' || row.tone === 'new').length,
    down: rows.filter((row) => row.tone === 'down').length,
  };
}

/** O backend serializa datetime sem fuso (UTC ingênuo); sem o `Z` o JS leria como hora local. */
function parseUtc(iso: string): Date | null {
  const at = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(at) ? null : new Date(at);
}

const SHORT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
};

/** "Sep 16 – Oct 16, 2026". Vazio se alguma data não parsear. */
export function reportPeriodLabel(start: string, end: string): string {
  const a = parseUtc(start);
  const b = parseUtc(end);
  if (!a || !b) return '';
  return `${a.toLocaleDateString('en-US', SHORT)} – ${b.toLocaleDateString('en-US', { ...SHORT, year: 'numeric' })}`;
}

/** Período vazio: a tela troca a grade de zeros por um convite a começar. */
export function isEmptyPeriod(current: Partial<CreatorReportMetrics>): boolean {
  return METRICS.every(({ key }) => num(current[key]) === 0);
}

/** "Nov 15" — quando o próximo relatório deve sair: o job gera 30 dias depois do fim deste. Vazio se não parsear. */
export function nextReportLabel(periodEnd: string): string {
  const end = parseUtc(periodEnd);
  if (!end) return '';
  const next = new Date(end.getTime() + 30 * 24 * 3600 * 1000);
  return next.toLocaleDateString('en-US', SHORT);
}
