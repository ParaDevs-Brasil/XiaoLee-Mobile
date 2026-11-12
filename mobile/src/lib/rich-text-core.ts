/**
 * Texto da Xiaolee com formatação mínima: **negrito**, `código` e *itálico*. A IA responde em markdown e o app mostrava os
 * asteriscos e as crases como estão. Sem dependência e sem Expo, para o teste em `rich-text-core.test.ts` rodar no Node.
 */

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

// negrito | código | itálico (um asterisco colado no texto, para "2 * 3 * 4" e listas com "* " não virarem itálico)
const INLINE = /\*\*(.+?)\*\*|`([^`\n]+)`|\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*/g;

export function parseInline(src: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) spans.push({ text: src.slice(last, at) });
    if (m[1] !== undefined) spans.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) spans.push({ text: m[2], code: true });
    else spans.push({ text: m[3], italic: true });
    last = at + m[0].length;
  }
  if (last < src.length) spans.push({ text: src.slice(last) });
  return spans.length ? spans : [{ text: src }];
}
