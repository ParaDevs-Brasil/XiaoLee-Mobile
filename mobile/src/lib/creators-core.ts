/** Regras puras dos criadores sintéticos (sem Expo): testadas por `creators-core.test.ts`. */

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Mesmo teto do backend (`synthetic_creators.max_words`): o roteiro é cortado aí. */
export function maxWords(durationS: number, wordsPerS: number): number {
  return Math.floor(durationS * wordsPerS);
}

const STATUS_LABEL: Record<string, string> = {
  paying: 'Confirming your payment…',
  queued: 'Waiting to start…',
  voice: 'Recording the voice…',
  video: 'Making your video… this takes a few minutes',
  done: 'Ready',
  failed: 'Couldn’t make this video',
};

export function videoStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function isVideoPending(status: string): boolean {
  return !['done', 'failed'].includes(status);
}

/**
 * Durações que o vídeo de movimento aguenta: o backend corta o vídeo na duração paga e recusa um vídeo mais
 * curto que ela (`_check_motion`, com 0,5 s de folga). `seconds` 0 = ainda sem vídeo escolhido.
 */
export function motionDurations(durations: number[], seconds: number): number[] {
  return durations.filter((d) => d <= seconds + 0.5);
}

/**
 * Onde o trecho começa, mantido dentro do vídeo: o trecho de `windowS` segundos nunca passa do fim (o backend confere
 * `duração - início >= janela - 0,5`). Trocar a duração para uma maior empurra o início para trás sozinho.
 */
export function clampStart(startS: number, totalS: number, windowS: number): number {
  const max = Math.max(0, totalS - windowS);
  return Math.min(Math.max(0, startS), max);
}

/** Mais pessoas num vídeo: o 1º personagem + até 3 (espelha `MAX_EXTRA_CHARACTERS` do backend). */
export const MAX_CHARACTERS = 4;

/** O formato de um vídeo, a partir da faixa (`standard`/`pro…` = Talk, `mimic…`, `swap…`). */
export function videoKindLabel(quality: string): 'Talk' | 'Mimic' | 'Replace' {
  return quality.startsWith('mimic') ? 'Mimic' : quality.startsWith('swap') ? 'Replace' : 'Talk';
}

/** Etapas visíveis de um vídeo em andamento: pago → gerando → pronto. `active` = a etapa em curso (0 a 2). */
export const VIDEO_STAGES = ['Paid', 'Making', 'Ready'] as const;
export function videoStage(status: string): number {
  return status === 'done' ? 2 : status === 'voice' || status === 'video' ? 1 : 0;
}
