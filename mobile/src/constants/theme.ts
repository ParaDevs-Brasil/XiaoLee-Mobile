/**
 * Design tokens do XiaoLee — porta de `docs/DESIGN_SYSTEM.md` (revisão v4).
 *
 * Os valores foram conferidos contra o arquivo Figma "Xiaolee-Mobile"
 * (file key mxLRwIEczW8zCwn3Stx6ZP) e batem exatamente com o documento.
 * O equivalente web vive como CSS custom properties em
 * `frontend/src/app/globals.css` — mesmos hex, outro mecanismo.
 *
 * Regra de ouro do sistema: **acento só em botão primário, avatar e
 * destaques — o resto neutro.** Nos componentes, referencie sempre os tokens
 * daqui, nunca hex solto.
 */

import '@/global.css';

import { Platform } from 'react-native';

/** Paleta neutra quente com acento único de marca. */
const palette = {
  // Base
  bg: '#f6f4f1',
  card: '#ffffff',
  border: '#ece9e4',
  /** Borda que precisa aparecer mais que `border` (caixa preenchida do OTP). */
  borderStrong: '#d4d0ca',
  /**
   * Painéis que flutuam sobre a tela (menu, perfil). No claro é o `card`, e a
   * sombra separa o painel do que está atrás. No escuro sombra não aparece e
   * o painel some sobre o card do chat — por isso um degrau mais claro e uma
   * borda visível.
   */
  popover: '#ffffff',
  popoverBorder: '#ece9e4',
  ink: '#1a1917',
  ink2: '#6b6862',
  /**
   * Era `#9a968f` até a revisão v4 do design system: dava 2.94:1 sobre
   * `card` e 2.68:1 sobre `bg`, ilegível nos horários, contagens e dicas que
   * usam este token. `#736f68` dá 5.0:1 / 4.55:1 (AA) e continua mais claro
   * que `ink2`. Já em `docs/DESIGN_SYSTEM.md` (v5); falta o Figma.
   */
  ink3: '#736f68',

  // Acento de marca — branco sobre accent = 4.8:1 (AA)
  accent: '#d81b78',
  accentHover: '#c0166a',
  accentSoft: '#fdf0f6',
  /**
   * Fundo de tudo que é preenchido com o acento (botão primário, avatar,
   * badge) e leva `onAccent` por cima. No claro é o próprio `accent`; existe
   * separado por causa do escuro — ver `paletteDark.accentFill`.
   */
  accentFill: '#d81b78',
  /** Texto e ícone sobre `accentFill`. Branco nos dois temas. */
  onAccent: '#ffffff',

  // Semânticas
  /**
   * Era `#1f8a5b`, que dava 4.3:1 sobre `card` e 3.9:1 sobre `bg` — abaixo de
   * AA para os textos "delivered", "online", "+12%". Mesmo hue, um tom mais
   * fechado: 5.3 / 4.9:1.
   */
  success: '#1a7a50',
  successSoft: '#ecfdf5',
  successBorder: '#d0fae5',
  danger: '#c23a3a',
  dangerSoft: '#fef2f2',
  /**
   * Fundo verde/vermelho com texto branco por cima (botão de ack, badge do
   * sino, excluir). `success` puro dá 4.3:1 com branco — por pouco abaixo de
   * AA —, então o preenchimento é um tom mais fechado (5.3:1). No escuro o
   * `success`/`danger` claros servem para texto, mas com branco em cima não
   * passam (2.1 / 3.3:1); os preenchimentos ficam iguais nos dois temas.
   */
  successFill: '#1a7a50',
  dangerFill: '#c23a3a',

  /**
   * Âmbar de "degradado" — o estado que não é sucesso nem falha.
   *
   * Nasceu no mobile antes de existir no Figma: a barra de latência da Traction
   * pintava lentidão de `danger`, e vermelho ali lê como pagamento quebrado
   * quando o pagamento liquidou, só que devagar. Conferido para AA — `warn`
   * sobre `warnSoft` dá 4.8:1 e sobre `card` 5.0:1.
   *
   * Documentado em `docs/DESIGN_SYSTEM.md` (v5, seção 3.6); falta o Figma.
   */
  warn: '#b45309',
  warnSoft: '#fffbeb',
  warnBorder: '#fde68a',

  /**
   * Fundo atrás de vídeo e thumbnail (player, linhas e cards de clip) e o
   * texto por cima dele. Escuro nos dois temas: é a moldura do vídeo, não
   * uma superfície da interface — no claro antes vinha de `ink`, que no
   * tema escuro vira quase branco.
   */
  media: '#1a1917',
  onMedia: '#ffffff',
  /**
   * Fundo escurecido atrás dos sheets (conectar carteira, renomear, receber,
   * compartilhar). No escuro precisa ser mais forte: 35% de quase-preto
   * sobre um app já escuro quase não separa o sheet do resto.
   */
  scrim: 'rgba(26,25,23,0.35)',

  /**
   * Roxo da Arc — só o "Arc." do slogan no login. Não é acento do produto, é
   * a marca da rede. O `#8b5cf6` que o login usava dava 3.9:1 sobre o fundo
   * creme; `#7c3aed` (5.2:1) é o mesmo roxo um tom acima. No escuro, um tom
   * mais claro do mesmo hue.
   */
  arc: '#7c3aed',

  /**
   * Cores por origem de dinheiro nos gráficos da carteira (faixa, donut,
   * ícones dos recebimentos) — a cor segue a origem em todo lugar.
   *
   * Campanha é o acento da marca; compra e transferência vêm da paleta
   * categórica de referência (azul, dourado). Validadas com o
   * `validate_palette.js` da skill de dataviz, todos os pares (`--pairs all`,
   * porque no donut toda fatia encosta nas outras), contra `card`: passam
   * luminosidade, croma, daltonismo (pior ΔE 15.3) e contraste ≥ 3:1. Os
   * cinzas que estavam aqui antes reprovavam no croma.
   */
  chartCampaign: '#d81b78',
  chartPurchase: '#2a78d6',
  chartTransfer: '#c98500',
} as const;

/**
 * Paleta escura. `docs/DESIGN_SYSTEM.md` ainda não define uma variante
 * escura, então os valores foram derivados de `palette` (mesmo hue de cada
 * token, luminância invertida), não portados de um Figma.
 *
 * Contraste conferido com a fórmula WCAG, token a token, contra `card` e
 * `bg` escuros: `ink` 15.1:1, `ink2` 8.0:1, `ink3` 4.7:1,
 * `accent` 5.1:1, `success`/`danger`/`warn` sobre o próprio `*Soft`
 * 7.1 / 5.1 / 7.3:1. Documentada em `docs/DESIGN_SYSTEM.md` (v5, seção 3.6).
 */
const paletteDark = {
  bg: '#141316',
  card: '#1f1c20',
  border: '#332f34',
  borderStrong: '#4d474e',
  popover: '#2a262c',
  popoverBorder: '#45404a',
  ink: '#f5f2f0',
  ink2: '#b7b2ac',
  ink3: '#8c8781',

  accent: '#f0509a',
  accentHover: '#d63d85',
  accentSoft: '#3a1428',
  /**
   * O rosa da marca, igual ao claro. O `accent` escuro é mais claro para
   * ser legível como texto sobre fundo escuro, mas branco em cima dele dá só
   * 3.3:1; sobre `#d81b78` dá 4.8:1 (AA). Por isso preenchimento e texto
   * têm tokens separados.
   */
  accentFill: '#d81b78',
  onAccent: '#ffffff',

  success: '#34c98a',
  successSoft: '#0f2b20',
  successBorder: '#1d4633',
  danger: '#e2665f',
  dangerSoft: '#301414',
  successFill: '#1a7a50',
  dangerFill: '#c23a3a',

  warn: '#e0a840',
  warnSoft: '#2e2210',
  warnBorder: '#4a3a16',

  media: '#000000',
  onMedia: '#ffffff',
  scrim: 'rgba(0,0,0,0.6)',
  arc: '#a78bfa',

  // Mesmos papéis da paleta clara, re-escalonados para o fundo escuro e
  // validados contra o `card` escuro (pior ΔE de daltonismo 11.6). O rosa é
  // mais escuro que o `accent` daqui: o `accent` escuro sai da faixa de
  // luminosidade de fatia e se confunde com o dourado.
  chartCampaign: '#e5418d',
  chartPurchase: '#3987e5',
  chartTransfer: '#c98500',
} as const;

/**
 * As cinco primeiras chaves são as que `themed-text`/`themed-view` consomem
 * via `useTheme()`; o resto é o vocabulário completo do design system.
 */
function buildScheme(p: Record<keyof typeof palette, string>) {
  return {
    text: p.ink,
    background: p.bg,
    backgroundElement: p.card,
    backgroundSelected: p.accentSoft,
    textSecondary: p.ink2,
    ...p,
  } as const;
}

export type ColorScheme = 'light' | 'dark';

/**
 * As duas paletas resolvidas. Componentes não leem daqui direto: pegam a do
 * tema ativo com `useTheme()` ou `makeStyles()` (`hooks/use-theme.ts`), que
 * re-renderizam quando a pessoa troca o tema. Ler `Colors.light` direto só
 * faz sentido no que é claro de propósito em qualquer tema — o cartão de
 * compartilhar perfil, que vira PNG, e a tela de loading da marca.
 */
export const Colors: Record<ColorScheme, ReturnType<typeof buildScheme>> = {
  light: buildScheme(palette),
  dark: buildScheme(paletteDark),
};

export type ThemeColors = (typeof Colors)[ColorScheme];
export type ThemeColor = keyof ThemeColors;

/**
 * Quicksand é a família do produto — o doc citava Inter, que nunca foi
 * implementada. Os nomes seguem os do pacote `@expo-google-fonts/quicksand`;
 * até `useFonts` resolver, o RN cai na fonte de sistema.
 */
export const Fonts = {
  sans: 'Quicksand_400Regular',
  medium: 'Quicksand_500Medium',
  semibold: 'Quicksand_600SemiBold',
  bold: 'Quicksand_700Bold',
  /**
   * Candice — fonte da marca, usada **só no logo**, igual à navbar web
   * (`--font-candice`). O arquivo é o `candice-web.ttf`, subset latino
   * re-serializado: o TTF original tem tabelas glyf/hmtx malformadas que os
   * sanitizadores de fonte rejeitam.
   */
  brand: 'Candice',
  mono: Platform.select({ ios: 'ui-monospace', default: 'monospace' }) as string,
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Raios medidos nos frames do Figma; `pill` para chips e botões redondos. */
export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** Sombra sutil dos cards — equivalente ao `shadow-sm` do web. */
export const CardShadow = Platform.select({
  ios: {
    shadowColor: palette.ink,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  android: { elevation: 1 },
  default: {},
});

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
