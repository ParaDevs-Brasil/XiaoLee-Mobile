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

/** Hambúrguer limpo — o `material-symbols:menu-rounded` do Figma. */
export const IconMenu = (p: IconProps) => (
  <Svg {...base(p)}>
    <Line x1="3" y1="6" x2="21" y2="6" />
    <Line x1="3" y1="12" x2="21" y2="12" />
    <Line x1="3" y1="18" x2="21" y2="18" />
  </Svg>
);

/** Lista com marcadores — não confundir com `IconMenu`. */
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
