import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ExpandButton, PhotoViewer } from '@/components/photo-viewer';
import { PressableScale } from '@/components/touch-motion';

import { IconCheck, IconEdit, IconUpload, type IconProps } from '@/components/icons';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';

const FRAME_INSET = Spacing.three;

/**
 * Área de envio (foto ou vídeo). Vazia, parece o que é: borda tracejada, um ícone grande, "Add a photo" e uma dica —
 * ninguém precisa adivinhar que dali se sobe um arquivo. Escolhida, mostra a foto (ou o que foi escolhido) e o jeito
 * de trocar.
 */
export function UploadTile({
  title,
  hint,
  onPress,
  Icon = IconUpload,
  previewUri,
  chosen,
  chosenTitle,
  changeLabel = 'Change',
  height = 180,
  accessibilityLabel,
}: {
  title: string;
  hint: string;
  onPress: () => void;
  Icon?: (p: IconProps) => React.ReactElement;
  /** Foto escolhida: aparece cobrindo a área, com o botão de trocar por cima. */
  previewUri?: string;
  /** Algo já foi escolhido (vídeo, por exemplo) e não há miniatura para mostrar. */
  chosen?: boolean;
  chosenTitle?: string;
  changeLabel?: string;
  height?: number;
  accessibilityLabel: string;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const [viewing, setViewing] = useState(false);

  if (previewUri) {
    return (
      <>
        <Pressable onPress={onPress} style={[styles.tile, styles.filled, { height }]} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
          {/* O seletor corta 9:16, então a foto é um retrato: ela ganha uma moldura 9:16 centralizada (cabe inteira,
              sem corte) sobre um fundo desfocado da própria imagem, em vez de ficar espremida numa faixa larga. */}
          <Image source={{ uri: previewUri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
          <View style={styles.dim} />
          <View style={[styles.frame, { height: height - FRAME_INSET * 2 }]}>
            <Image source={{ uri: previewUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
            <View style={styles.expand}>
              <ExpandButton onPress={() => setViewing(true)} />
            </View>
            <View style={styles.change}>
              <IconEdit size={14} color={colors.ink} />
              <Text style={styles.changeText}>{changeLabel}</Text>
            </View>
          </View>
        </Pressable>
        {viewing ? <PhotoViewer uri={previewUri} onClose={() => setViewing(false)} /> : null}
      </>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.98}
      style={[styles.tile, chosen ? styles.done : styles.empty, { height }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.badge, chosen && styles.badgeDone]}>
        {chosen ? <IconCheck size={26} sw={2.6} color={colors.onAccent} /> : <Icon size={26} sw={2.2} color={colors.onAccent} />}
      </View>
      <Text style={styles.title}>{chosen ? (chosenTitle ?? title) : title}</Text>
      <Text style={styles.hint}>{hint}</Text>
    </PressableScale>
  );
}

const useStyles = makeStyles((colors) => ({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  empty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.accent, backgroundColor: colors.accentSoft },
  done: { borderWidth: 1.5, borderColor: colors.success, backgroundColor: colors.card },
  filled: { backgroundColor: colors.media, padding: FRAME_INSET },
  frame: {
    aspectRatio: 9 / 16,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: Spacing.two,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    backgroundColor: colors.media,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(26, 23, 20, 0.28)' },
  expand: { position: 'absolute', top: Spacing.two, right: Spacing.two },
  badge: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentFill,
  },
  badgeDone: { backgroundColor: colors.successFill },
  title: { fontFamily: Fonts.bold, fontSize: 15, color: colors.ink, textAlign: 'center' },
  hint: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: colors.ink2, textAlign: 'center' },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    paddingHorizontal: Spacing.three - 4,
    height: 32,
    borderRadius: Radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  changeText: { fontFamily: Fonts.bold, fontSize: 12, color: colors.ink },
}));
