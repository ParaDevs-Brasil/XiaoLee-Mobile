/**
 * Regras puras de "ideias feitas" do relatório de 30 dias, sem React/Expo —
 * testável em Node. O creator marca no aparelho o que já colocou em prática;
 * o backend não sabe disso (é um lembrete pessoal, não um dado do relatório).
 *
 * As ideias são identificadas pela posição: o relatório é imutável depois de
 * gerado, então a ordem das sugestões não muda.
 */

export function ideasStorageKey(reportId: number): string {
  return `xiaolee_report_ideas_done:${reportId}`;
}

/**
 * Lê o que foi salvo. Nunca lança: JSON quebrado, formato inesperado ou índice
 * fora das ideias que existem hoje viram "nada marcado" naquele item.
 */
export function parseDone(raw: string | null | undefined, total: number): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(
      (value): value is number => Number.isInteger(value) && value >= 0 && value < total,
    );
    return [...new Set(valid)].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Marca ou desmarca uma ideia, mantendo a lista ordenada e sem repetição. */
export function toggleDone(done: number[], index: number): number[] {
  return done.includes(index)
    ? done.filter((value) => value !== index)
    : [...done, index].sort((a, b) => a - b);
}

/** "1 of 3 done" — e, com todas marcadas, o reconhecimento. Vazio sem ideias. */
export function doneSummary(done: number, total: number): string {
  if (total <= 0) return '';
  if (done >= total) return `All ${total} done — nice work`;
  return `${done} of ${total} done`;
}
