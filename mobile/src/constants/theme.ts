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
  ink: '#1a1917',
  ink2: '#6b6862',
  ink3: '#9a968f',

  // Acento de marca — branco sobre accent = 4.8:1 (AA)
  accent: '#d81b78',
  accentHover: '#c0166a',
  accentSoft: '#fdf0f6',

  // Semânticas
  success: '#1f8a5b',
  successSoft: '#ecfdf5',
  successBorder: '#d0fae5',
  danger: '#c23a3a',
  dangerSoft: '#fef2f2',

  /**
   * Âmbar de "degradado" — o estado que não é sucesso nem falha.
   *
   * Nasceu no mobile antes de existir no Figma: a barra de latência da Traction
   * pintava lentidão de `danger`, e vermelho ali lê como pagamento quebrado
   * quando o pagamento liquidou, só que devagar. Conferido para AA — `warn`
   * sobre `warnSoft` dá 4.8:1 e sobre `card` 5.0:1.
   *
   * Pendência: levar de volta para `docs/DESIGN_SYSTEM.md` e para o arquivo
   * Figma, senão o web e o mobile divergem na próxima revisão da paleta.
   */
  warn: '#b45309',
  warnSoft: '#fffbeb',
  warnBorder: '#fde68a',
} as const;

/**
 * Paleta escura — pedido do relatório de produto (28/set): "coloque apenas a
 * opção DARK, que é algo que todos gostam". `docs/DESIGN_SYSTEM.md` não
 * define uma variante escura ainda, então os valores abaixo foram derivados
 * a mão a partir de `palette` (mesmo hue de cada token, luminância
 * invertida), não portados de um Figma existente.
 *
 * ponytail: contraste conferido só de olho (acento mais claro que o da
 * paleta clara, pra continuar legível sobre fundo escuro), não validado com
 * ferramenta de AA como os comentários da paleta clara documentam para ela.
 * Upgrade: rodar um checker de contraste (ex.: WebAIM) token a token e levar
 * os valores de volta para `docs/DESIGN_SYSTEM.md`, igual já é pedido no
 * comentário do token `warn` acima.
 */
const paletteDark = {
  bg: '#141316',
  card: '#1f1c20',
  border: '#332f34',
  ink: '#f5f2f0',
  ink2: '#b7b2ac',
  ink3: '#847f79',

  accent: '#f0509a',
  accentHover: '#d63d85',
  accentSoft: '#3a1428',

  success: '#34c98a',
  successSoft: '#0f2b20',
  successBorder: '#1d4633',
  danger: '#e2665f',
  dangerSoft: '#301414',

  warn: '#e0a840',
  warnSoft: '#2e2210',
  warnBorder: '#4a3a16',
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

const schemeLight = buildScheme(palette);
const schemeDark = buildScheme(paletteDark);

/**
 * Interruptor do tema: o app sobe no claro até a paleta escura ter design
 * definido. A paleta escura fica pronta aqui — para ativá-la, troque para
 * `true`; `_layout.tsx` ajusta a status bar e o tema do navegador a partir
 * deste mesmo valor.
 */
export const DARK_MODE = false;

/**
 * O app não tem toggle de tema nem acompanha o do aparelho. `light` e `dark`
 * apontam para a mesma paleta (a ativa) de propósito — assim nenhum dos
 * componentes que já leem `Colors.light.*` direto (a maioria do app, ver
 * `header-bar.tsx`/`screen-shell.tsx`/etc.) precisa mudar uma linha, e o
 * `useTheme()` devolve a mesma coisa com o aparelho em modo escuro.
 */
const activeScheme = DARK_MODE ? schemeDark : schemeLight;

export const Colors = {
  light: activeScheme,
  dark: activeScheme,
} as const;

export type ThemeColor = keyof typeof schemeDark;

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
