import { Path, Svg } from 'react-native-svg';

import { IconXSocial } from '@/components/icons';

/**
 * Marcas das redes nos botões de conectar. Mesma exceção do `google-logo.tsx`: o design system (seção 4)
 * pede ícones de traço e uma cor, mas logo de terceiro entra preenchido e com a cor da marca — não é
 * pictograma nosso. Paths do pacote `simple-icons` (domínio público).
 *
 * X e TikTok são pretos na marca; aqui seguem `ink` para continuarem legíveis no tema escuro.
 */

/** Azul do Telegram. */
const TELEGRAM = '#26A5E4';
/** Azul do Bluesky. */
const BLUESKY = '#1185FE';

export function TelegramLogo({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={TELEGRAM}>
      <Path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </Svg>
  );
}

export function BlueskyLogo({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={BLUESKY}>
      <Path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8Z" />
    </Svg>
  );
}

export function TikTokLogo({ size = 22, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </Svg>
  );
}

/** Logo da rede pelo id que o backend usa; `ink` é a cor do texto do tema (X e TikTok). */
export function SocialLogo({ platform, ink, size = 22 }: { platform: string; ink: string; size?: number }) {
  if (platform === 'telegram') return <TelegramLogo size={size} />;
  if (platform === 'bluesky') return <BlueskyLogo size={size} />;
  if (platform === 'tiktok') return <TikTokLogo size={size} color={ink} />;
  return <IconXSocial size={size - 2} color={ink} />;
}

/** Como cada rede se escreve (o backend manda o id em minúsculas). */
export const NETWORK_NAMES: Record<string, string> = { telegram: 'Telegram', bluesky: 'Bluesky', x: 'X', tiktok: 'TikTok' };
