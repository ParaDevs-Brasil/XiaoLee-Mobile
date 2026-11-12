/**
 * Formatação de valores vindos do backend.
 *
 * Vive aqui, e não na tela, por dois motivos: Campaigns, Dashboard e
 * Notifications formatam os mesmos tipos de dado, e assim as regras ficam
 * testáveis por `node --experimental-strip-types` — um arquivo de tela
 * arrastaria JSX e o runtime do React Native para dentro do teste.
 */

/**
 * O feed de traction serializa o instante com
 * `datetime.utcnow().isoformat() + "Z"`, que emite **microssegundos**
 * (ex.: `2026-07-30T19:26:09.001709Z`). O formato de data do ECMA-262 prevê
 * milissegundos — três casas —, e engines divergem no quanto toleram a mais;
 * um parse recusado viraria `NaN` e a tela mostraria "NaNs ago" no aparelho.
 * Cortar para três casas é aceito por todas.
 */
export function parseTimestamp(iso: string): number {
  return Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'));
}

/**
 * Distância até agora, na mesma escala do web (`app/traction/page.tsx`):
 * segundos, minutos, horas — e dias, que o web não tem aqui mas tem no seu
 * próprio `timeAgo` de `Historico.tsx`. Nenhum outro chamador desta função
 * precisava disso: Traction e Notifications mostram dado que nasce recente.
 * `lib/chat-history.ts` é o primeiro com timestamp que sobrevive dias de
 * verdade — persiste em `AsyncStorage` —, e sem o corte em dias uma conversa
 * de uma semana atrás leria "168h ago".
 *
 * Devolve string vazia se a data não parsear — é melhor não mostrar hora
 * nenhuma do que mostrar lixo.
 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const at = parseTimestamp(iso);
  if (Number.isNaN(at)) return '';

  // `Math.max` protege contra relógio do aparelho atrasado em relação ao
  // servidor, que renderizaria "-3s ago".
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

/** Duas casas sempre — valores de USDC não devem dançar de largura na lista. */
export function formatUSDC(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Hash no formato do explorer: começo…fim. Abaixo do limite devolve inteiro,
 * senão encurtar deixaria o texto maior do que o original.
 */
export function shortHash(value: string): string {
  return value.length > 16 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

/**
 * Quantidade de token de campanha. Hoje o trilho é USDC, mas `reward_token` é
 * campo livre na criação e o cartão precisa renderizar qualquer símbolo.
 * Diferente de `formatUSDC`: sem casas fixas. O backend devolve tanto o pool
 * (`300.0`) quanto o reward por participante (`0.3`) — forçar duas casas viraria
 * "300.00" num cartão onde o número já briga por espaço, e cortar para zero
 * apagaria o `0.3` inteiro.
 */
export function formatTokenAmount(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Campanha de pontos: o token da recompensa é POINTS (sem dinheiro, sem resgate). */
export function isPoints(token: string): boolean {
  return token.trim().toUpperCase() === 'POINTS';
}

/** Recompensa de campanha: "50 POINTS" vira "50 points"; os demais tokens ficam como estão. */
export function formatReward(value: number, token: string): string {
  return isPoints(token) ? `${formatTokenAmount(value)} points` : `${formatTokenAmount(value)} ${token}`;
}

/** Data curta no locale do aparelho. Vazio se não parsear, como `timeAgo`. */
export function formatDate(iso: string): string {
  const at = parseTimestamp(iso);
  if (Number.isNaN(at)) return '';
  return new Date(at).toLocaleDateString();
}
