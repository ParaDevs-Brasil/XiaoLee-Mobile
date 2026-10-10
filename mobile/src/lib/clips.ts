/**
 * Regras puras do fluxo de cortes do Clipper (sem React/Expo — testável em Node).
 *
 * A tela de um vídeo não guarda em memória "em que passo estou": deriva o
 * passo do que o backend diz (`status` da mídia + `status` de cada corte).
 * Transcrever 1 h e renderizar 3 cortes leva minutos — o usuário fecha o app
 * no meio, e ao voltar a tela tem que continuar de onde parou.
 */
import type { ClipStatus, GlossarySuggestion, MediaAsset, MediaTranscriptSegment } from '@/api/backend';

export type ClipFlow =
  /** O PUT no storage não chegou a ser confirmado (`/complete`). */
  | { step: 'upload-incomplete' }
  | { step: 'transcribing' }
  /** Transcrevendo há mais de `STALE_MS` sem mudar: o processo do backend caiu no meio. */
  | { step: 'transcription-stalled' }
  | { step: 'transcription-failed'; error: string }
  /** Áudio transcreve, mas corte 9:16 precisa de imagem. */
  | { step: 'audio-only' }
  /** Transcrito, sem cortes ainda: hora de escolher crop/fit e gerar. */
  | { step: 'choose-layout' }
  | { step: 'rendering'; ready: number; total: number }
  /** Nenhum corte em andamento mudou há mais de `STALE_MS`: só gerar de novo destrava. */
  | { step: 'rendering-stalled'; ready: number; total: number }
  | { step: 'done'; ready: number; failed: number }
  /** A retenção do backend apagou os arquivos: não toca nem gera mais, só reenviando. */
  | { step: 'expired' };

/**
 * Mesmo prazo de `STALE_TRANSCRIBING` em `media_routes.py`: a partir dele o
 * backend aceita refazer (`/complete` de novo, `regenerate=true`). Antes disso
 * recusaria com 409, então o app não oferece o botão. É longo de propósito:
 * restart do servidor já vira falha sozinho (reaper do backend); isto só cobre
 * job pendurado, e não pode disparar no meio de uma transcrição longa legítima.
 */
export const STALE_MS = 6 * 60 * 60_000;

/**
 * `updated_at` mais velho que `STALE_MS`. `null` (linha recém-escrita) nunca é
 * velho. O corte nos milissegundos é o mesmo de `parseTimestamp` em
 * `lib/format.ts`: o backend manda microssegundos, que nem toda engine aceita.
 */
export function isStale(updatedAt: string | null, now: number): boolean {
  if (!updatedAt) return false;
  const at = Date.parse(updatedAt.replace(/(\.\d{3})\d+/, '$1'));
  return !Number.isNaN(at) && now - at > STALE_MS;
}

type ClipLike = { status: ClipStatus; updated_at: string | null };

export function clipFlow(
  media: Pick<MediaAsset, 'kind' | 'status' | 'error' | 'updated_at'>,
  clips: readonly ClipLike[],
  now: number = Date.now(),
): ClipFlow {
  switch (media.status) {
    case 'pending':
    case 'uploaded':
      return { step: 'upload-incomplete' };
    case 'transcribing':
      return isStale(media.updated_at, now) ? { step: 'transcription-stalled' } : { step: 'transcribing' };
    case 'failed':
      return { step: 'transcription-failed', error: media.error ?? 'The transcription failed.' };
    case 'expired':
      return { step: 'expired' };
  }
  if (media.kind !== 'video') return { step: 'audio-only' };
  if (clips.length === 0) return { step: 'choose-layout' };

  const ready = clips.filter((c) => c.status === 'ready').length;
  const failed = clips.filter((c) => c.status === 'failed').length;
  const inFlight = clips.filter((c) => c.status === 'pending' || c.status === 'rendering');
  if (inFlight.length === 0) return { step: 'done', ready, failed };
  // Mesma regra do backend: basta UM corte em andamento ainda fresco para o
  // `regenerate` ser recusado — só está travado quando todos envelheceram.
  if (inFlight.every((c) => isStale(c.updated_at, now))) {
    return { step: 'rendering-stalled', ready, total: clips.length };
  }
  return { step: 'rendering', ready, total: clips.length };
}

/** Intervalo de consulta da mídia: só enquanto o backend está trabalhando nela. */
export function mediaPollMs(status: MediaAsset['status'] | undefined): number | undefined {
  return status === 'transcribing' ? 3_000 : undefined;
}

/** Intervalo de consulta dos cortes: só enquanto algum ainda renderiza. */
export function clipsPollMs(clips: readonly { status: ClipStatus }[] | null): number | undefined {
  return clips?.some((c) => c.status === 'pending' || c.status === 'rendering') ? 4_000 : undefined;
}

/** `75` → `1:15`; `3725` → `1:02:05`. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Onde o corte está no vídeo original e quanto dura: `12:34–13:05 · 31s`. */
export function formatClipSpan(start: number, end: number): string {
  const length = Math.max(0, Math.round(end - start));
  return `${formatClock(start)}–${formatClock(end)} · ${length}s`;
}

/**
 * O que é dito dentro do corte, para o creator reconhecer o momento sem dar
 * play. Corta na última palavra inteira antes de `maxChars`.
 */
export function clipExcerpt(
  segments: readonly MediaTranscriptSegment[],
  start: number,
  end: number,
  maxChars = 160,
): string {
  const text = segments
    .filter((seg) => seg.end > start && seg.start < end)
    .map((seg) => seg.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}

/**
 * Grupos do filtro da lista de vídeos. "Needs attention" junta o que espera
 * uma ação do creator — falha, upload que não fechou, cortes ainda não gerados.
 */
export type MediaFilter = 'all' | 'processing' | 'ready' | 'attention';

/** Cor/ícone do chip na lista (`components/video-row.tsx`). */
export type MediaTone = 'neutral' | 'muted' | 'progress' | 'success' | 'danger' | 'action';

export type MediaListItem = Pick<MediaAsset, 'kind' | 'status' | 'clips_total' | 'clips_ready' | 'clips_in_progress'>;

/**
 * Em que pé o vídeo está, para a lista: rótulo do chip, grupo do filtro e tom.
 *
 * `status` sozinho não basta: `transcribed` só quer dizer que a transcrição
 * acabou. Os cortes (contagens do backend) dizem se ainda falta gerar, se estão
 * renderizando ou se ficaram prontos — o mesmo raciocínio de `clipFlow`, que a
 * tela do vídeo usa com a lista completa de cortes.
 */
export function mediaListStatus(m: MediaListItem): { label: string; group: Exclude<MediaFilter, 'all'>; tone: MediaTone } {
  switch (m.status) {
    case 'pending':
    case 'uploaded':
      return { label: 'Upload incomplete', group: 'attention', tone: 'neutral' };
    case 'transcribing':
      return { label: 'Transcribing', group: 'processing', tone: 'progress' };
    case 'failed':
      return { label: 'Failed', group: 'attention', tone: 'danger' };
    case 'expired':
      return { label: 'Expired', group: 'attention', tone: 'muted' };
  }
  if (m.kind !== 'video') return { label: 'Audio only', group: 'attention', tone: 'muted' };
  if (m.clips_total === 0) return { label: 'Generate clips', group: 'attention', tone: 'action' };
  if (m.clips_in_progress > 0) {
    return { label: `Rendering ${m.clips_ready}/${m.clips_total}`, group: 'processing', tone: 'progress' };
  }
  if (m.clips_ready === 0) return { label: 'Render failed', group: 'attention', tone: 'danger' };
  if (m.clips_ready < m.clips_total) {
    return { label: `${m.clips_ready} of ${m.clips_total} ready`, group: 'ready', tone: 'success' };
  }
  return { label: m.clips_ready === 1 ? '1 clip ready' : `${m.clips_ready} clips ready`, group: 'ready', tone: 'success' };
}

export function mediaFilterOf(m: MediaListItem): Exclude<MediaFilter, 'all'> {
  return mediaListStatus(m).group;
}

export function mediaFilterCounts(list: readonly MediaListItem[]): Record<MediaFilter, number> {
  const counts: Record<MediaFilter, number> = { all: list.length, processing: 0, ready: 0, attention: 0 };
  for (const item of list) counts[mediaFilterOf(item)] += 1;
  return counts;
}

/** `1_288_490_188` → `1.2 GB`; abaixo de 1 MB mostra em KB. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Quanto falta de um upload, pelo ritmo até agora. `null` enquanto a conta
 * ainda não é confiável: nos primeiros segundos (ou 2–3%) a velocidade medida
 * é só o arranque da conexão, e prometer "9 h" assustaria à toa.
 */
export function uploadEtaSeconds(percent: number, elapsedMs: number): number | null {
  if (percent < 3 || percent >= 100 || elapsedMs < 4_000) return null;
  return (elapsedMs / 1000) * ((100 - percent) / percent);
}

/** `30` → "less than a minute left"; `130` → "about 2 min left"; `4000` → "about 1 h 7 min left". */
export function formatEta(seconds: number): string {
  if (seconds < 45) return 'less than a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `about ${h} h ${m} min left` : `about ${h} h left`;
}

/** Mesmos limites de `campaigns_routes.py` (`GLOSSARY_MAX_TERMS`/`GLOSSARY_MAX_TERM_LEN`). */
export const GLOSSARY_MAX_TERMS = 60;
export const GLOSSARY_MAX_TERM_LEN = 40;

/**
 * Junta o que o usuário digitou (um termo ou vários, separados por vírgula ou
 * linha) aos termos que já existem. Mesma limpeza do backend
 * (`clean_glossary`): espaço normalizado, sem vazio, sem repetido ignorando
 * maiúscula. Termo longo demais volta em `rejected` para a tela avisar — o
 * backend o descartaria em silêncio.
 */
/**
 * Sugestões que ainda valem mostrar: sem as que o creator já tem (o backend
 * filtra no momento da busca, mas a lista local muda a cada toque), sem
 * repetidas, nenhuma se o glossário já está cheio, e no máximo `limit`.
 */
export function pendingSuggestions(
  suggestions: readonly GlossarySuggestion[],
  terms: readonly string[],
  limit = 8,
): GlossarySuggestion[] {
  if (terms.length >= GLOSSARY_MAX_TERMS) return [];
  const known = new Set(terms.map((t) => t.toLowerCase()));
  const out: GlossarySuggestion[] = [];
  for (const s of suggestions) {
    const key = s.term.trim().toLowerCase();
    if (!key || known.has(key)) continue;
    known.add(key);
    out.push(s);
    if (out.length === limit) break;
  }
  return out;
}

export function addGlossaryTerms(
  current: readonly string[],
  input: string,
): { terms: string[]; rejected: string[] } {
  const terms = [...current];
  const seen = new Set(current.map((t) => t.toLowerCase()));
  const rejected: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const term = raw.split(/\s+/).filter(Boolean).join(' ');
    if (!term || seen.has(term.toLowerCase())) continue;
    if (term.length > GLOSSARY_MAX_TERM_LEN || terms.length >= GLOSSARY_MAX_TERMS) {
      rejected.push(term);
      continue;
    }
    seen.add(term.toLowerCase());
    terms.push(term);
  }
  return { terms, rejected };
}

/**
 * Nome do MP4 ao compartilhar — é o que aparece no WhatsApp, no "Salvar
 * vídeo" e no seletor do TikTok. Título sem acento/símbolo + id do corte, que
 * muda a cada geração (o cache local nunca entrega um corte antigo).
 */
export function clipFileName(clip: { id: number; title: string }): string {
  const slug = clip.title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return `xiaolee-${slug || 'clip'}-${clip.id}.mp4`;
}
