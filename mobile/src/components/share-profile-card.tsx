import { forwardRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { initials, interestLabel, SHARE_URL } from '@/lib/share-profile';

/**
 * O "post pronto" do compartilhar perfil (XIAOLEEACE-21).
 *
 * É uma `View` comum que o `ShareProfileSheet` mostra como preview e captura
 * com `react-native-view-shot` — o que o usuário vê é exatamente o PNG que
 * sai. Proporção 4:5, a que X e Instagram exibem inteira no feed sem cortar.
 *
 * A foto usa o `Image` do core, não o `expo-image`: o view-shot desenha a
 * árvore num canvas de software, e bitmaps de hardware (que o Glide do
 * `expo-image` usa no Android) saem em branco ou derrubam a captura.
 */

export interface ShareProfileCardProps {
  /** Largura em dp; a altura sai da proporção 4:5. */
  width: number;
  name: string | null;
  handle: string | null;
  bio: string | null;
  interests: readonly string[];
  photoUrl: string | null;
  /** Avisa quando a foto terminou (ou falhou) — só aí a captura é fiel. */
  onPhotoSettled?: () => void;
}

const mascot = require('../../assets/images/xiaolee-avatar.png');

export const ShareProfileCard = forwardRef<View, ShareProfileCardProps>(function ShareProfileCard(
  { width, name, handle, bio, interests, photoUrl, onPhotoSettled },
  ref,
) {
  // Tudo escala com a largura, para o preview do sheet e o PNG terem o mesmo
  // layout em qualquer tela.
  const u = width / 320;
  const avatar = 96 * u;

  return (
    <View
      ref={ref}
      // Sem isso o Android pode achatar a View na árvore nativa e o
      // view-shot não encontra o que capturar.
      collapsable={false}
      style={[styles.card, { width, height: width * 1.25, padding: Spacing.four * u }]}
    >
      <View style={styles.top}>
        <Text style={[styles.brand, { fontSize: 28 * u }]}>Xiaolee</Text>
        <Image
          source={mascot}
          style={[styles.mascot, { width: 44 * u, height: 44 * u, borderWidth: 2 * u }]}
        />
      </View>

      <View style={[styles.body, { gap: Spacing.two * u }]}>
        <View
          style={[
            styles.avatar,
            { width: avatar, height: avatar, borderWidth: 4 * u },
          ]}
        >
          {photoUrl ? (
            <Image
              source={{ uri: photoUrl }}
              style={StyleSheet.absoluteFill}
              onLoadEnd={onPhotoSettled}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Text style={[styles.initials, { fontSize: 34 * u }]}>{initials(name)}</Text>
          )}
        </View>

        <Text style={[styles.name, { fontSize: 22 * u }]} numberOfLines={1}>
          {name?.trim() || 'Xiaolee creator'}
        </Text>
        {handle ? (
          <Text style={[styles.handle, { fontSize: 13 * u }]} numberOfLines={1}>
            @{handle}
          </Text>
        ) : null}
        {bio?.trim() ? (
          <Text style={[styles.bio, { fontSize: 12 * u, lineHeight: 17 * u }]} numberOfLines={2}>
            {bio.trim()}
          </Text>
        ) : null}

        {interests.length ? (
          <View style={[styles.chips, { gap: Spacing.one * u, marginTop: Spacing.one * u }]}>
            {interests.slice(0, 4).map((id) => (
              <View
                key={id}
                style={[
                  styles.chip,
                  { paddingHorizontal: Spacing.two * u + 2, paddingVertical: 3 * u },
                ]}
              >
                <Text style={[styles.chipText, { fontSize: 11 * u }]}>{interestLabel(id)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={[styles.footer, { padding: Spacing.three * u - 4, gap: Spacing.three * u - 4 }]}>
        <View style={styles.footerText}>
          <Text style={[styles.cta, { fontSize: 14 * u }]}>Join me on Xiaolee</Text>
          <Text style={[styles.ctaSub, { fontSize: 11 * u, lineHeight: 15 * u }]}>
            Your AI agent that earns USDC for creators.
          </Text>
        </View>
        <QRCodeStyled
          data={SHARE_URL}
          size={64 * u}
          padding={0}
          color={Colors.light.ink}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // Sem raio de borda: canto arredondado vira transparência no PNG, e
  // WhatsApp/Instagram pintam transparência de preto. O arredondado do
  // preview é do contêiner no sheet.
  card: { justifyContent: 'space-between', backgroundColor: Colors.light.accent },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontFamily: Fonts.brand, color: Colors.light.card },
  mascot: { borderRadius: Radius.pill, borderColor: Colors.light.card },
  body: { alignItems: 'center' },
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
  handle: { fontFamily: Fonts.semibold, color: Colors.light.accentSoft, opacity: 0.9 },
  bio: {
    fontFamily: Fonts.medium,
    color: Colors.light.card,
    textAlign: 'center',
    opacity: 0.92,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  chip: { borderRadius: Radius.pill, backgroundColor: Colors.light.accentSoft },
  chipText: { fontFamily: Fonts.bold, color: Colors.light.accent },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.card,
  },
  footerText: { flex: 1 },
  cta: { fontFamily: Fonts.bold, color: Colors.light.ink },
  ctaSub: { fontFamily: Fonts.sans, color: Colors.light.ink2, marginTop: 2 },
});
