/**
 * Filtros do catálogo de vozes. O backend só manda gênero, categoria e uma frase de descrição; o tom e o sotaque são
 * lidos dessa frase (palavras-chave) aqui no app. É uma aproximação: quando o backend passar a mandar `tone`/`accent`
 * de verdade, basta trocar `toneOf`/`accentOf` — o resto da tela não muda.
 */

export type GenderFilter = 'all' | 'female' | 'male';
export type Tone = 'deep' | 'soft' | 'bright';
export type Accent = 'brazilian' | 'british' | 'other';

export interface VoiceFilters {
  gender: GenderFilter;
  tone: Tone | null;
  accent: Accent | null;
}

export const NO_FILTERS: VoiceFilters = { gender: 'all', tone: null, accent: null };

export interface FilterableVoice {
  gender: 'female' | 'male';
  description: string;
  category: string;
}

const TONE_WORDS: Record<Tone, string[]> = {
  deep: ['deep', 'gruff', 'old', 'ancient', 'monster', 'villain', 'mature', 'firm', 'rich', 'cinematic', 'announcer', 'grounding', 'raspy'],
  soft: ['soft', 'calm', 'soothing', 'gentle', 'sweet', 'cute', 'relaxed', 'elegant', 'friendly'],
  bright: ['bright', 'young', 'energetic', 'sparkly', 'charming', 'playful', 'expressive', 'upbeat', 'quirky', 'fast'],
};

/** O primeiro tom (na ordem acima) cuja palavra aparece na descrição; sem pista, a voz não entra em filtro de tom. */
export function toneOf(v: FilterableVoice): Tone | null {
  const text = v.description.toLowerCase();
  for (const tone of ['deep', 'soft', 'bright'] as const) {
    if (TONE_WORDS[tone].some((w) => new RegExp(`\\b${w}`).test(text))) return tone;
  }
  return null;
}

export function accentOf(v: FilterableVoice): Accent {
  const text = `${v.category} ${v.description}`.toLowerCase();
  if (/brazil|northeast|northern/.test(text)) return 'brazilian';
  if (/british/.test(text)) return 'british';
  return 'other';
}

export function activeCount(f: VoiceFilters): number {
  return (f.gender !== 'all' ? 1 : 0) + (f.tone ? 1 : 0) + (f.accent ? 1 : 0);
}

export function matchesFilters(v: FilterableVoice, f: VoiceFilters): boolean {
  if (f.gender !== 'all' && v.gender !== f.gender) return false;
  if (f.tone && toneOf(v) !== f.tone) return false;
  if (f.accent && accentOf(v) !== f.accent) return false;
  return true;
}
