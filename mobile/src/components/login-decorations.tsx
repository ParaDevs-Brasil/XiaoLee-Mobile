import { StyleSheet, View } from 'react-native';
import { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Svg } from 'react-native-svg';

/**
 * Estrela brilhante de 4 pontas com concavidade suave.
 */
export function SparkleStar({
  size = 20,
  color = '#D81B78',
  style,
}: {
  size?: number;
  color?: string;
  style?: object;
}) {
  return (
    <View style={style} pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d="M12 0 C12 6.627 6.627 12 0 12 C6.627 12 12 17.373 12 24 C12 17.373 17.373 12 24 12 C17.373 12 12 6.627 12 0 Z"
          fill={color}
        />
      </Svg>
    </View>
  );
}

/**
 * Manchas orgânicas suaves em degradê no fundo da tela (canto superior e cantos inferiores).
 */
export function BackgroundGlow() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Glow topo esquerdo */}
      <Svg
        width="260"
        height="260"
        viewBox="0 0 260 260"
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <Defs>
          <LinearGradient id="topGlow" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FDE2EE" stopOpacity="0.85" />
            <Stop offset="0.6" stopColor="#FDF2F7" stopOpacity="0.4" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d="M0 0 L220 0 C160 80 120 180 0 220 Z" fill="url(#topGlow)" />
      </Svg>

      {/* Glow inferior esquerdo */}
      <Svg
        width="220"
        height="220"
        viewBox="0 0 220 220"
        style={{ position: 'absolute', bottom: 0, left: 0 }}
      >
        <Defs>
          <LinearGradient id="botLeftGlow" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#FCE7F3" stopOpacity="0.75" />
            <Stop offset="0.7" stopColor="#FDF2F7" stopOpacity="0.3" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d="M0 220 L0 50 C60 110 120 160 200 220 Z" fill="url(#botLeftGlow)" />
      </Svg>

      {/* Glow inferior direito */}
      <Svg
        width="200"
        height="200"
        viewBox="0 0 200 200"
        style={{ position: 'absolute', bottom: 0, right: 0 }}
      >
        <Defs>
          <LinearGradient id="botRightGlow" x1="1" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#FCE7F3" stopOpacity="0.7" />
            <Stop offset="0.7" stopColor="#FDF2F7" stopOpacity="0.25" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d="M200 200 L60 200 C100 140 140 100 200 60 Z" fill="url(#botRightGlow)" />
      </Svg>
    </View>
  );
}

/** Ícone de envelope suave */
export function IconMail({ size = 18, color = '#9CA3AF' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x="2"
        y="4"
        width="20"
        height="16"
        rx="3"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Path
        d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Ícone de erro circular com exclamação */
export function IconAlertCircle({
  size = 20,
  color = '#F43F5E',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" fill={color} />
      <Line x1="12" y1="8" x2="12" y2="12" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
      <Circle cx="12" cy="16" r="1" fill="#FFFFFF" />
    </Svg>
  );
}

/** Seta para direita */
export function IconArrowRight({
  size = 18,
  color = '#FFFFFF',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12h14M12 5l7 7-7 7"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Ilustração 3D isométrica da carteira rosa com cartões e brilhos,
 * sobre blob orgânico suave (Tela "Setting up your account").
 */
export function WalletIllustration() {
  return (
    <View style={illustrationStyles.container}>
      <Svg width="220" height="170" viewBox="0 0 220 170" fill="none">
        <Defs>
          <LinearGradient id="blobGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FCE7F3" stopOpacity="0.8" />
            <Stop offset="1" stopColor="#FDF2F7" stopOpacity="0.4" />
          </LinearGradient>
          <LinearGradient id="walletMain" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#F472B6" />
            <Stop offset="0.7" stopColor="#EC4899" />
            <Stop offset="1" stopColor="#DB2777" />
          </LinearGradient>
          <LinearGradient id="walletFront" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FBCFE8" />
            <Stop offset="1" stopColor="#F472B6" />
          </LinearGradient>
          <LinearGradient id="cardGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="1" stopColor="#FDF2F8" />
          </LinearGradient>
          <LinearGradient id="claspGrad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#EC4899" />
            <Stop offset="1" stopColor="#DB2777" />
          </LinearGradient>
        </Defs>

        {/* Fundo orgânico (Blob) */}
        <Path
          d="M30 85 C20 40, 65 15, 115 20 C165 25, 195 50, 195 95 C195 140, 150 160, 105 155 C55 150, 40 130, 30 85 Z"
          fill="url(#blobGrad)"
        />

        {/* Brilhos ao redor */}
        <G transform="translate(165, 30)">
          <Path
            d="M6 0 C6 3.3 3.3 6 0 6 C3.3 6 6 8.7 6 12 C6 8.7 8.7 6 12 6 C8.7 6 6 3.3 6 0 Z"
            fill="#D81B78"
          />
        </G>
        <G transform="translate(45, 95)">
          <Path
            d="M5 0 C5 2.8 2.8 5 0 5 C2.8 5 5 7.2 5 10 C5 7.2 7.2 5 10 5 C7.2 5 5 2.8 5 0 Z"
            fill="#EC4899"
          />
        </G>
        <G transform="translate(70, 85)">
          <Path
            d="M3 0 C3 1.7 1.7 3 0 3 C1.7 3 3 4.3 3 6 C3 4.3 4.3 3 6 3 C4.3 3 3 1.7 3 0 Z"
            fill="#F472B6"
          />
        </G>
        <G transform="translate(160, 135)">
          <Path
            d="M4 0 C4 2.2 2.2 4 0 4 C2.2 4 4 5.8 4 8 C4 5.8 5.8 4 8 4 C5.8 4 4 2.2 4 0 Z"
            fill="#EC4899"
          />
        </G>

        {/* Cartão saindo de trás */}
        <G transform="translate(80, 52) rotate(-8)">
          <Rect x="0" y="0" width="60" height="38" rx="6" fill="url(#cardGrad)" stroke="#FBCFE8" strokeWidth="1.5" />
          <Line x1="10" y1="12" x2="35" y2="12" stroke="#F472B6" strokeWidth="2.5" strokeLinecap="round" />
          <Circle cx="48" cy="26" r="4" fill="#F472B6" opacity="0.6" />
        </G>

        {/* Corpo principal da carteira */}
        <G transform="translate(72, 70)">
          {/* Sombra suave inferior */}
          <Path d="M8 68 Q40 76 72 68 Q40 62 8 68 Z" fill="#DB2777" opacity="0.25" />

          {/* Fundo da carteira dobrada */}
          <Rect x="0" y="4" width="76" height="54" rx="12" fill="url(#walletMain)" />

          {/* Frente da carteira */}
          <Path
            d="M0 16 C0 9 6 4 14 4 L62 4 C70 4 76 9 76 16 L76 46 C76 53 70 58 62 58 L14 58 C6 58 0 53 0 46 Z"
            fill="url(#walletFront)"
            stroke="#F472B6"
            strokeWidth="1.5"
          />

          {/* Fecho da carteira (Clasp) */}
          <Path
            d="M52 23 C52 18 56 16 62 16 L74 16 C76 16 78 18 78 20 L78 38 C78 40 76 42 74 42 L62 42 C56 42 52 40 52 35 Z"
            fill="url(#claspGrad)"
          />
          {/* Botão de pressão do fecho */}
          <Circle cx="64" cy="29" r="4.5" fill="#FFFFFF" opacity="0.9" />
          <Circle cx="64" cy="29" r="2" fill="#D81B78" />
        </G>
      </Svg>
    </View>
  );
}

/**
 * Ilustração do bloquinho rosa com carinha triste e botão de 'X'
 * sobre blob orgânico (Tela "We couldn't finish signing you in").
 */
export function SadBlockIllustration() {
  return (
    <View style={illustrationStyles.container}>
      <Svg width="200" height="170" viewBox="0 0 200 170" fill="none">
        <Defs>
          <LinearGradient id="sadBlob" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FCE7F3" stopOpacity="0.8" />
            <Stop offset="1" stopColor="#FDF2F7" stopOpacity="0.35" />
          </LinearGradient>
          <LinearGradient id="blockGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FDF2F8" />
            <Stop offset="0.5" stopColor="#FCE7F3" />
            <Stop offset="1" stopColor="#FBCFE8" />
          </LinearGradient>
          <LinearGradient id="badgeGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#E11D48" />
            <Stop offset="1" stopColor="#BE123C" />
          </LinearGradient>
        </Defs>

        {/* Blob orgânico de fundo */}
        <Path
          d="M30 80 C20 40, 60 20, 105 20 C150 20, 175 45, 175 90 C175 135, 145 155, 100 150 C55 145, 40 120, 30 80 Z"
          fill="url(#sadBlob)"
        />

        {/* Brilhos ao redor */}
        <G transform="translate(150, 35)">
          <Path
            d="M5 0 C5 2.8 2.8 5 0 5 C2.8 5 5 7.2 5 10 C5 7.2 7.2 5 10 5 C7.2 5 5 2.8 5 0 Z"
            fill="#EC4899"
          />
        </G>
        <G transform="translate(35, 75)">
          <Path
            d="M4 0 C4 2.2 2.2 4 0 4 C2.2 4 4 5.8 4 8 C4 5.8 5.8 4 8 4 C5.8 4 4 2.2 4 0 Z"
            fill="#F472B6"
          />
        </G>

        {/* Bloquinho rosa arredondado */}
        <G transform="translate(62, 42)">
          {/* Sombra */}
          <Path d="M6 72 Q38 80 70 72 Q38 66 6 72 Z" fill="#DB2777" opacity="0.2" />

          {/* Cubo/card arredondado */}
          <Rect
            x="0"
            y="0"
            width="76"
            height="74"
            rx="18"
            fill="url(#blockGrad)"
            stroke="#F472B6"
            strokeWidth="2.5"
          />

          {/* Olhinhos tristes */}
          <Circle cx="24" cy="30" r="3.5" fill="#D81B78" />
          <Circle cx="52" cy="30" r="3.5" fill="#D81B78" />

          {/* Boquinha triste (arco para baixo) */}
          <Path
            d="M32 45 Q38 39 44 45"
            stroke="#D81B78"
            strokeWidth="2.8"
            strokeLinecap="round"
            fill="none"
          />

          {/* Bochechinhas rosadas sutis */}
          <Circle cx="18" cy="36" r="3" fill="#F472B6" opacity="0.4" />
          <Circle cx="58" cy="36" r="3" fill="#F472B6" opacity="0.4" />
        </G>

        {/* Badge vermelho com 'X' no canto inferior direito */}
        <G transform="translate(118, 92)">
          <Circle cx="16" cy="16" r="15" fill="url(#badgeGrad)" stroke="#FFFFFF" strokeWidth="2.5" />
          <Path
            d="M11 11 L21 21 M21 11 L11 21"
            stroke="#FFFFFF"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </G>
      </Svg>
    </View>
  );
}

const illustrationStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
});
