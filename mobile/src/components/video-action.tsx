import { ActivityIndicator } from 'react-native';

import type { IconProps } from '@/components/icons';
import { PressableScale } from '@/components/touch-motion';
import { useTheme } from '@/hooks/use-theme';

/** Botão redondo de 44 pt (salvar, compartilhar) ao lado de um vídeo; o nome vai só no `accessibilityLabel`. */
export function VideoAction({
  Icon,
  label,
  busy,
  disabled,
  onPress,
}: {
  Icon: (p: IconProps) => React.ReactElement;
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.88}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        opacity: disabled && !busy ? 0.45 : 1,
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled }}
    >
      {busy ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon size={18} sw={2} color={colors.ink} />}
    </PressableScale>
  );
}
