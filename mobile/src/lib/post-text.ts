/**
 * Insere `@menção` ou `#hashtag` no fim do texto do post, com um espaço antes (e sem repetir o que já está lá).
 * Pura, para testar no Node.
 */
export function insertToken(text: string, token: string): string {
  const has = new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i');
  if (has.test(text)) return text;
  return text.length === 0 || /\s$/.test(text) ? `${text}${token}` : `${text} ${token}`;
}
