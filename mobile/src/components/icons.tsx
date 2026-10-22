import { Circle, Line, Path, Polygon, Polyline, Rect, Svg } from 'react-native-svg';

/**
 * Ícones SVG inline — porta direta de `frontend/src/components/icons.tsx`.
 *
 * Os `d`/`points` são os mesmos do web para as duas plataformas desenharem o
 * mesmo traço. O design system proíbe emoji em UI e fixa o padrão em
 * `viewBox="0 0 24 24"`, stroke-based, `strokeWidth={1.8}` (seção 4).
 *
 * Só os ícones em uso estão aqui; o web tem ~50. Porte sob demanda em vez de
 * arrastar a biblioteca toda.
 */

export interface IconProps {
  /** Lado do quadrado, em px. */
  size?: number;
  /** Espessura do traço — 1.8 é o padrão do design system. */
  sw?: number;
  /** Cor do traço. Use tokens de `constants/theme`, nunca hex solto. */
  color?: string;
}

const base = ({ size = 24, sw = 1.8, color = 'currentColor' }: IconProps) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: color,
  strokeWidth: sw,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconBell = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <Path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </Svg>
);

/** Lista com marcadores — não confundir com o hambúrguer (`MenuToggleIcon`). */
export const IconList = (p: IconProps) => (
  <Svg {...base(p)}>
    <Line x1="8" y1="6" x2="21" y2="6" />
    <Line x1="8" y1="12" x2="21" y2="12" />
    <Line x1="8" y1="18" x2="21" y2="18" />
    <Line x1="3" y1="6" x2="3.01" y2="6" />
    <Line x1="3" y1="12" x2="3.01" y2="12" />
    <Line x1="3" y1="18" x2="3.01" y2="18" />
  </Svg>
);

export const IconUser = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <Circle cx="12" cy="7" r="4" />
  </Svg>
);

export const IconGift = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M20 12v9H4v-9" />
    <Path d="M2 7h20v5H2z" />
    <Path d="M12 22V7" />
    <Path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
    <Path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
  </Svg>
);

export const IconActivity = (p: IconProps) => (
  <Svg {...base(p)}>
    <Polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </Svg>
);

export const IconSwap = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M7 10l-3 3 3 3" />
    <Path d="M4 13h13a3 3 0 0 0 3-3V7" />
    <Path d="M17 14l3-3-3-3" />
    <Path d="M20 11H7a3 3 0 0 0-3 3v3" />
  </Svg>
);

export const IconWallet = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M3 7a2 2 0 0 1 2-2h13v4" />
    <Path d="M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z" />
    <Circle cx="16.5" cy="14" r="1.2" fill={p.color ?? 'currentColor'} stroke="none" />
  </Svg>
);

export const IconChat = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
  </Svg>
);

export const IconSend = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M22 2 11 13" />
    <Path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...base(p)}>
    <Line x1="18" y1="6" x2="6" y2="18" />
    <Line x1="6" y1="6" x2="18" y2="18" />
  </Svg>
);

export const IconBarChart = (p: IconProps) => (
  <Svg {...base(p)}>
    <Line x1="18" y1="20" x2="18" y2="10" />
    <Line x1="12" y1="20" x2="12" y2="4" />
    <Line x1="6" y1="20" x2="6" y2="14" />
  </Svg>
);

export const IconDollar = (p: IconProps) => (
  <Svg {...base(p)}>
    <Line x1="12" y1="1" x2="12" y2="23" />
    <Path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </Svg>
);

export const IconRocket = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <Path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 19 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <Path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <Path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </Svg>
);

export const IconClipboard = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
    <Path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2H11a2 2 0 0 1-2-2z" />
    <Path d="M9 12h6M9 16h6M9 9h.01" />
  </Svg>
);

export const IconClock = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="9" />
    <Polyline points="12 7 12 12 15.5 14" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1" />
    <Path d="M12 4v12m0 0-4-4m4 4 4-4" />
  </Svg>
);

export const IconUpload = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1" />
    <Path d="M12 16V4m0 0 4 4m-4-4-4 4" />
  </Svg>
);

export const IconPlay = (p: IconProps) => (
  <Svg {...base(p)}>
    <Polygon points="6 4 20 12 6 20 6 4" />
  </Svg>
);

/** Corte — a entrada do Clipper. */
export const IconScissors = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="6" cy="6" r="3" />
    <Circle cx="6" cy="18" r="3" />
    <Line x1="20" y1="4" x2="8.12" y2="15.88" />
    <Line x1="14.47" y1="14.48" x2="20" y2="20" />
    <Line x1="8.12" y1="8.12" x2="12" y2="12" />
  </Svg>
);

/** Duas silhuetas — `IconUser` é a de uma pessoa só. */
export const IconUsers = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <Circle cx="9" cy="7" r="4" />
    <Path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);

export const IconZap = (p: IconProps) => (
  <Svg {...base(p)}>
    <Polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </Svg>
);

/** Alvo concêntrico — o marcador de "como funciona" e de campanha. */
export const IconTarget = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="9" />
    <Circle cx="12" cy="12" r="5" />
    <Circle cx="12" cy="12" r="1.4" fill={p.color ?? 'currentColor'} stroke="none" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...base(p)}>
    <Polyline points="6 9 12 15 18 9" />
  </Svg>
);

export const IconChevronLeft = (p: IconProps) => (
  <Svg {...base(p)}>
    <Polyline points="15 18 9 12 15 6" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...base(p)}>
    <Polyline points="9 18 15 12 9 6" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...base(p)}>
    <Line x1="12" y1="5" x2="12" y2="19" />
    <Line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);

/** Caneta escrevendo — gatilho de "New chat", ao lado do rótulo por extenso. */
export const IconEdit = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M12 20h9" />
    <Path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </Svg>
);

export const IconMegaphone = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M3 11l19-9-9 19-2-8-8-2z" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...base(p)}>
    <Polyline points="23 4 23 10 17 10" />
    <Path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="10" />
    <Line x1="12" y1="8" x2="12" y2="12" />
    <Line x1="12" y1="16" x2="12.01" y2="16" />
  </Svg>
);

export const IconInbox = (p: IconProps) => (
  <Svg {...base(p)}>
    <Polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <Path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </Svg>
);

/** Faísca do logo. Preenchida, sem traço — é a exceção ao padrão stroke-based. */
export const IconSpark = ({ size = 24, color = 'currentColor' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M12 2l1.6 5.6L19 9.2l-5.4 1.6L12 16l-1.6-5.2L5 9.2l5.4-1.6L12 2z" />
  </Svg>
);

export const IconLogOut = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <Polyline points="16 17 21 12 16 7" />
    <Line x1="21" y1="12" x2="9" y2="12" />
  </Svg>
);


/** `share-2` do Feather — três nós ligados, o "compartilhar" universal. */
export const IconShare = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="18" cy="5" r="3" />
    <Circle cx="6" cy="12" r="3" />
    <Circle cx="18" cy="19" r="3" />
    <Line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <Line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </Svg>
);

/** Blocos empilhados — DeFi como "lego de dinheiro", o chip do card de share. */
export const IconBlocks = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="8.5" y="2.5" width="7" height="7" rx="1.5" />
    <Rect x="3" y="14" width="7" height="7" rx="1.5" />
    <Rect x="14" y="14" width="7" height="7" rx="1.5" />
    <Path d="M12 9.5v2.5M6.5 14v-2h11v2" />
  </Svg>
);

/** Duas cartas em leque — interesse "Cards". */
export const IconCards = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="8" y="3" width="12" height="16" rx="2" />
    <Path d="M8 6.5 4.6 7.6a2 2 0 0 0-1.3 2.5l3.4 10.5a2 2 0 0 0 2.5 1.3l4.3-1.4" />
    <Path d="m14 8 1.2 2.4 2.3.4-1.7 1.6.4 2.3L14 13.6l-2.2 1.1.4-2.3-1.7-1.6 2.3-.4z" />
  </Svg>
);

/** Verde do Pix — cor da marca do arranjo, não do tema: é o que o usuário reconhece no banco dele. */
export const PIX_COLOR = '#32BCAD';

/** Marca do Pix (Banco Central): preenchida, não de traço — `color` é o preenchimento. Path do Simple Icons (CC0). */
export const IconPix = ({ size = 24, color = PIX_COLOR }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M5.283 18.36a3.505 3.505 0 0 0 2.493-1.032l3.6-3.6a.684.684 0 0 1 .946 0l3.613 3.613a3.504 3.504 0 0 0 2.493 1.032h.71l-4.56 4.56a3.647 3.647 0 0 1-5.156 0L4.85 18.36ZM18.428 5.627a3.505 3.505 0 0 0-2.493 1.032l-3.613 3.614a.67.67 0 0 1-.946 0l-3.6-3.6A3.505 3.505 0 0 0 5.283 5.64h-.434l4.573-4.572a3.646 3.646 0 0 1 5.156 0l4.559 4.559ZM1.068 9.422 3.79 6.699h1.492a2.483 2.483 0 0 1 1.744.722l3.6 3.6a1.73 1.73 0 0 0 2.443 0l3.614-3.613a2.482 2.482 0 0 1 1.744-.723h1.767l2.737 2.737a3.646 3.646 0 0 1 0 5.156l-2.736 2.736h-1.768a2.482 2.482 0 0 1-1.744-.722l-3.613-3.613a1.77 1.77 0 0 0-2.444 0l-3.6 3.6a2.483 2.483 0 0 1-1.744.722H3.791l-2.723-2.723a3.646 3.646 0 0 1 0-5.156" />
  </Svg>
);

/** Cartão de pagamento: tarja, chip e número — não confundir com `IconCards` (baralho). */
export const IconCreditCard = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="2" y="5" width="20" height="14" rx="3" />
    <Path d="M2 9.5h20" />
    <Rect x="5" y="12.5" width="4" height="3" rx="0.8" />
    <Path d="M12 14h1M15 14h1M18 14h1" />
  </Svg>
);

/** Três pontos na horizontal — o "mais opções" de um item. Preenchido: é traço de ponto, não de linha. */
export const IconMore = ({ size = 24, color = 'currentColor' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Circle cx="5" cy="12" r="1.9" />
    <Circle cx="12" cy="12" r="1.9" />
    <Circle cx="19" cy="12" r="1.9" />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...base(p)}>
    <Polyline points="3 6 5 6 21 6" />
    <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <Path d="M10 11v6M14 11v6" />
    <Path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </Svg>
);

// ── Onboarding (campos de perfil e perfil de interesse) ────────────────────

export const IconMapPin = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
    <Circle cx="12" cy="10" r="3" />
  </Svg>
);

export const IconBuilding = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18z" />
    <Path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    <Path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
    <Path d="M10 6h4M10 10h4M10 14h4M10 18h4" />
  </Svg>
);

export const IconCube = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <Path d="M3.3 7 12 12l8.7-5" />
    <Path d="M12 22V12" />
  </Svg>
);

export const IconGamepad = (p: IconProps) => (
  <Svg {...base(p)}>
    <Line x1="6" y1="11" x2="10" y2="11" />
    <Line x1="8" y1="9" x2="8" y2="13" />
    <Line x1="15" y1="12" x2="15.01" y2="12" />
    <Line x1="18" y1="10" x2="18.01" y2="10" />
    <Path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59C2.6 9.42 2 14.46 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.41-1.41A2 2 0 0 1 9.83 16h4.34a2 2 0 0 1 1.41.59L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.55-.6-6.58-.69-7.26A4 4 0 0 0 17.32 5z" />
  </Svg>
);

export const IconTrendingUp = (p: IconProps) => (
  <Svg {...base(p)}>
    <Polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <Polyline points="16 7 22 7 22 13" />
  </Svg>
);

export const IconTrendingDown = (p: IconProps) => (
  <Svg {...base(p)}>
    <Polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
    <Polyline points="16 17 22 17 22 11" />
  </Svg>
);

export const IconSmile = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="10" />
    <Path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <Line x1="9" y1="9" x2="9.01" y2="9" />
    <Line x1="15" y1="9" x2="15.01" y2="9" />
  </Svg>
);

/** Logo do X (ex-Twitter). Preenchido, sem traço — é marca, não pictograma. */
export const IconXSocial = ({ size = 24, color = 'currentColor' }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </Svg>
);

export const IconInstagram = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <Path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <Line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </Svg>
);

// ── Carteira do creator ─────────────────────────────────────────────────────

export const IconCopy = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="9" y="9" width="12" height="12" rx="2" />
    <Path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </Svg>
);

/** QR estilizado — três marcadores de canto e um ponto de dado. */
export const IconQr = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="3" y="3" width="7" height="7" rx="1" />
    <Rect x="14" y="3" width="7" height="7" rx="1" />
    <Rect x="3" y="14" width="7" height="7" rx="1" />
    <Path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
  </Svg>
);

/** Abre fora do app (explorer). */
export const IconExternal = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M14 4h6v6" />
    <Path d="M20 4l-9 9" />
    <Path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Svg>
);

/** Dinheiro que entrou. */
export const IconArrowDownLeft = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M17 7 7 17" />
    <Path d="M17 17H7V7" />
  </Svg>
);

/** Compra de conteúdo (x402). */
export const IconBag = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M5 8h14l-1 12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 8z" />
    <Path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </Svg>
);

/** Tema claro, no seletor de aparência do perfil. */
export const IconSun = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="4.5" />
    <Line x1="12" y1="2" x2="12" y2="4" />
    <Line x1="12" y1="20" x2="12" y2="22" />
    <Line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
    <Line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
    <Line x1="2" y1="12" x2="4" y2="12" />
    <Line x1="20" y1="12" x2="22" y2="12" />
    <Line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
    <Line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
  </Svg>
);

/** Tema escuro. */
export const IconMoon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </Svg>
);

/** Tema do aparelho ("System"). */
export const IconPhone = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="6" y="2" width="12" height="20" rx="2.5" />
    <Line x1="11" y1="18" x2="13" y2="18" />
  </Svg>
);
