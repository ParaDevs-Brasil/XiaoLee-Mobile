import { forwardRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import {
  IconActivity,
  IconBlocks,
  IconCards,
  IconGamepad,
  IconInstagram,
  IconRocket,
  IconSpark,
  IconXLogo,
  type IconProps,
} from '@/components/icons';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { initials, interestLabel, profileTagline, SHARE_URL } from '@/lib/share-profile';

/**
 * O "post pronto" do compartilhar perfil (XIAOLEEACE-21).
 *
 * É uma `View` comum que o `ShareProfileSheet` mostra como preview e captura
 * com `react-native-view-shot` — o que o usuário vê é exatamente o PNG que
 * sai. Proporção 9:16 — a de Status do WhatsApp e Stories — alta o bastante
 * para os cinco interesses respirarem; X e WhatsApp mostram a imagem inteira
 * ao abrir.
 *
 * Restrições da captura que moldam o visual:
 *  - Fundo, brilhos e formas são SVG, não sombra: `elevation` é desenhada
 *    pelo RenderThread do Android e não aparece no canvas de software do
 *    view-shot. Pelo mesmo motivo os cartões internos usam borda, não sombra.
 *  - A foto usa o `Image` do core, não o `expo-image`: bitmaps de hardware
 *    (que o Glide do `expo-image` usa) saem em branco na captura.
 *  - Sem raio de borda no card: canto arredondado vira transparência no PNG,
 *    que WhatsApp/Instagram pintam de preto. O arredondado do preview é do
 *    contêiner no sheet.
 */

export interface ShareProfileCardProps {
  /** Largura em dp; a altura sai de `CARD_RATIO`. */
  width: number;
  name: string | null;
  /** Handles sem `@`; cada um aparece com o logo da rede, para não haver dúvida. */
  socials: { x: string | null; instagram: string | null };
  interests: readonly string[];
  photoUrl: string | null;
  /** Avisa quando a foto terminou (ou falhou) — só aí a captura é fiel. */
  onPhotoSettled?: () => void;
}

/** Ícone de cada interesse no chip — par de `INTEREST_THEMES` em `lib/share-profile`. */
const INTEREST_ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  defi: IconBlocks,
  games: IconGamepad,
  cards: IconCards,
  trader: IconActivity,
  memecoins: IconRocket,
};

/** Altura / largura do card — o sheet usa o mesmo valor para exportar o PNG. */
export const CARD_RATIO = 16 / 9;

const mascot = require('../../assets/images/xiaolee-avatar.png');

export const ShareProfileCard = forwardRef<View, ShareProfileCardProps>(function ShareProfileCard(
  { width, name, socials, interests, photoUrl, onPhotoSettled },
  ref,
) {
  // Tudo escala com a largura, para o preview do sheet e o PNG terem o mesmo
  // layout em qualquer tela.
  const u = width / 320;
  const height = width * CARD_RATIO;
  // Orçamento vertical (em unidades de 320x569): topo 48 + corpo ~345 (com
  // os cinco chips em duas linhas e as duas redes) + rodapé ~95 deixa ~30
  // de folga, que o
  // corpo centralizado divide entre cima e baixo. Mexer em tamanho aqui
  // exige refazer a conta, senão o rodapé sai cortado no PNG.
  const avatar = 116 * u;
  const halo = avatar + 36 * u;
  // A frase sob o nome vem do interesse principal — é o que personaliza o card.
  const tagline = profileTagline(interests);

  return (
    <View
      ref={ref}
      // Sem isso o Android pode achatar a View na árvore nativa e o
      // view-shot não encontra o que capturar.
      collapsable={false}
      style={[styles.card, { width, height, padding: 24 * u }]}
    >
      <CardBackground width={width} height={height} />

      <View style={styles.top}>
        <View style={styles.brandRow}>
          <Text style={[styles.brand, { fontSize: 30 * u }]}>Xiaolee</Text>
          <View style={{ marginTop: -10 * u, marginLeft: 2 * u }}>
            <IconSpark size={14 * u} color={Colors.light.card} />
          </View>
        </View>
        <Image
          source={mascot}
          style={[styles.mascot, { width: 46 * u, height: 46 * u, borderWidth: 2 * u }]}
        />
      </View>

      <View style={styles.body}>
        <View style={[styles.halo, { width: halo, height: halo, borderWidth: 1.5 * u }]}>
          <View style={[styles.avatar, { width: avatar, height: avatar, borderWidth: 4 * u }]}>
            {photoUrl ? (
              <Image
                source={{ uri: photoUrl }}
                style={StyleSheet.absoluteFill}
                onLoadEnd={onPhotoSettled}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <Text style={[styles.initials, { fontSize: 46 * u }]}>{initials(name)}</Text>
            )}
          </View>
        </View>

        <Text
          style={[styles.name, { fontSize: 28 * u, marginTop: 18 * u }]}
          numberOfLines={1}
        >
          {name?.trim() || 'Xiaolee creator'}
        </Text>
        {socials.x || socials.instagram ? (
          <View style={[styles.socials, { gap: 6 * u, marginTop: 6 * u }]}>
            {socials.x ? <SocialPill Icon={IconXLogo} handle={socials.x} u={u} /> : null}
            {socials.instagram ? (
              <SocialPill Icon={IconInstagram} handle={socials.instagram} u={u} />
            ) : null}
          </View>
        ) : null}
        <Text
          style={[styles.tagline, { fontSize: 12 * u, lineHeight: 16 * u, marginTop: 8 * u }]}
          numberOfLines={2}
        >
          {tagline}
        </Text>

        {interests.length ? (
          <View
            style={[
              styles.chips,
              { columnGap: Spacing.two * u, rowGap: 10 * u, marginTop: 24 * u },
            ]}
          >
            {/* Todos os interesses — com os cinco, a quebra sai 3 + 2. */}
            {interests.map((id) => {
              const Icon = INTEREST_ICONS[id] ?? IconSpark;
              return (
                <View
                  key={id}
                  style={[
                    styles.chip,
                    {
                      gap: 5 * u,
                      paddingHorizontal: 10 * u,
                      paddingVertical: 6 * u,
                    },
                  ]}
                >
                  <Icon size={14 * u} sw={2} color={Colors.light.accent} />
                  <Text style={[styles.chipText, { fontSize: 11.5 * u }]}>{interestLabel(id)}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.footer,
          { padding: 12 * u, gap: 10 * u, borderRadius: Radius.lg * u },
        ]}
      >
        <View style={styles.footerText}>
          <View style={[styles.accentRow, { gap: 6 * u, marginBottom: 6 * u }]}>
            <IconSpark size={13 * u} color={Colors.light.accent} />
            <AccentLine width={44 * u} height={3 * u} />
          </View>
          <Text style={[styles.cta, { fontSize: 16 * u }]}>Join me on Xiaolee</Text>
          <Text style={[styles.ctaSub, { fontSize: 11 * u, lineHeight: 15 * u }]}>
            Your AI agent that earns USDC for creators.
          </Text>
        </View>
        <View style={[styles.qrBox, { padding: 5 * u, borderRadius: Radius.md * u }]}>
          <QRCodeStyled data={SHARE_URL} size={58 * u} padding={0} color={Colors.light.ink} />
        </View>
      </View>
    </View>
  );
});

/** `@handle` com o logo da rede na frente — X ou Instagram. */
function SocialPill({
  Icon,
  handle,
  u,
}: {
  Icon: (p: IconProps) => React.ReactElement;
  handle: string;
  u: number;
}) {
  return (
    <View
      style={[styles.socialPill, { gap: 5 * u, paddingHorizontal: 9 * u, paddingVertical: 4 * u }]}
    >
      <Icon size={12 * u} sw={2} color={Colors.light.card} />
      <Text style={[styles.socialText, { fontSize: 11.5 * u }]} numberOfLines={1}>
        @{handle}
      </Text>
    </View>
  );
}

/**
 * Gradiente diagonal do acento com luzes e ondas brancas translúcidas por
 * cima — o mesmo efeito do mock sem sair dos tokens do tema.
 */
function CardBackground({ width: w, height: h }: { width: number; height: number }) {
  const white = Colors.light.card;
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={Colors.light.accentHover} />
          <Stop offset="0.55" stopColor={Colors.light.accent} />
          <Stop offset="1" stopColor={Colors.light.accentHover} />
        </LinearGradient>
        <RadialGradient id="glowLeft" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor={white} stopOpacity="0.22" />
          <Stop offset="1" stopColor={white} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="glowAvatar" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor={white} stopOpacity="0.16" />
          <Stop offset="1" stopColor={white} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect width={w} height={h} fill="url(#bg)" />
      {/* Arco grande no canto superior esquerdo. */}
      <Circle cx={w * 0.05} cy={-h * 0.08} r={w * 0.62} fill={white} fillOpacity={0.07} />
      {/* Luz difusa à esquerda, na altura do nome. */}
      <Circle cx={0} cy={h * 0.55} r={w * 0.5} fill="url(#glowLeft)" />
      {/* Brilho atrás do avatar. */}
      <Circle cx={w / 2} cy={h * 0.32} r={w * 0.42} fill="url(#glowAvatar)" />
      {/* Onda que sobe pela direita até o rodapé. */}
      <Path
        d={`M ${w} ${h * 0.36} C ${w * 0.78} ${h * 0.42}, ${w * 0.74} ${h * 0.62}, ${w * 0.5} ${h * 0.7} L ${w} ${h * 0.7} Z`}
        fill={white}
        fillOpacity={0.06}
      />
      <Path
        d={`M 0 ${h} L 0 ${h * 0.86} C ${w * 0.3} ${h * 0.92}, ${w * 0.7} ${h * 0.84}, ${w} ${h * 0.9} L ${w} ${h} Z`}
        fill={white}
        fillOpacity={0.05}
      />
    </Svg>
  );
}

/** Traço do rodapé que esmaece do acento para transparente. */
function AccentLine({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="line" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={Colors.light.accent} />
          <Stop offset="1" stopColor={Colors.light.accent} stopOpacity="0.1" />
        </LinearGradient>
      </Defs>
      <Rect width={width} height={height} rx={height / 2} fill="url(#line)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  card: {
    justifyContent: 'space-between',
    overflow: 'hidden',
    backgroundColor: Colors.light.accent,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  brand: { fontFamily: Fonts.brand, color: Colors.light.card },
  mascot: { borderRadius: Radius.pill, borderColor: 'rgba(255,255,255,0.7)' },
  // O corpo ocupa o meio e centraliza: a folga vertical que sobra fica
  // dividida igualmente entre o topo e o rodapé, em vez de colar no rodapé.
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  halo: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  avatar: {
    borderRadius: Radius.pill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: Colors.light.card,
    backgroundColor: Colors.light.accentHover,
  },
  initials: { fontFamily: Fonts.bold, color: Colors.light.card },
  name: { fontFamily: Fonts.bold, color: Colors.light.card, textAlign: 'center' },
  socials: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  socialPill: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  socialText: { fontFamily: Fonts.semibold, color: Colors.light.card, flexShrink: 1 },
  tagline: {
    fontFamily: Fonts.medium,
    color: Colors.light.card,
    textAlign: 'center',
    opacity: 0.9,
    paddingHorizontal: Spacing.three,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accentSoft,
  },
  chipText: { fontFamily: Fonts.bold, color: Colors.light.accent },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.card,
  },
  footerText: { flex: 1 },
  accentRow: { flexDirection: 'row', alignItems: 'center' },
  cta: { fontFamily: Fonts.bold, color: Colors.light.ink },
  ctaSub: { fontFamily: Fonts.sans, color: Colors.light.ink2, marginTop: 3 },
  qrBox: {
    backgroundColor: Colors.light.card,
    borderWidth: 1.5,
    borderColor: Colors.light.accentSoft,
  },
});
