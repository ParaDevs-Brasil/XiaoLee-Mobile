/** Regras puras dos criadores sintéticos (sem Expo): testadas por `creators-core.test.ts`. */

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Mesmo teto do backend (`synthetic_creators.max_words`): o roteiro é cortado aí. */
export function maxWords(durationS: number, wordsPerS: number): number {
  return Math.floor(durationS * wordsPerS);
}

const STATUS_LABEL: Record<string, string> = {
  paying: 'Confirming payment…',
  queued: 'Queued',
  voice: 'Recording the voice…',
  video: 'Animating the video… (a few minutes)',
  done: 'Ready',
  failed: 'Failed',
};

export function videoStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function isVideoPending(status: string): boolean {
  return !['done', 'failed'].includes(status);
}
