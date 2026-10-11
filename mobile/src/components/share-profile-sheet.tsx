import { usePrivy } from '@privy-io/expo';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { getMyProfile, type MyProfile } from '@/api/backend';
import { IconClose, IconUpload } from '@/components/icons';
import { ShareProfileCard } from '@/components/share-profile-card';
import { CardShadow, Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import {
  buildShareCaption,
  profilePhotoUrl,
  SHARE_URL,
  xHandle,
  xIntentUrl,
  type LinkedAccountLike,
} from '@/lib/share-profile';

/**
 * Sheet do "compartilhar perfil" (XIAOLEEACE-21), aberto pelo `ProfileMenu`.
 *
 * Mostra o `ShareProfileCard` como preview e oferece duas saídas:
 *  - **Share image** — captura o card em PNG e abre o share sheet nativo
 *    (X, Instagram, WhatsApp…). O Android não manda texto junto com arquivo
 *    nesse intent, então a legenda vai pro clipboard antes, pronta pra colar.
 *  - **Post on X** — intent web do X com legenda + link, para quem quer só o
 *    texto (o intent não aceita anexar imagem).
 */

interface ShareProfileSheetProps {
  visible: boolean;
  onClose: () => void;
}

/** Largura do PNG final — 1080 é o padrão de imagem de feed. */
const EXPORT_WIDTH = 1080;

const EMPTY_PROFILE: MyProfile = {
  full_name: null,
  state: null,
  city: null,
  bio: null,
  social_links: {},
  interest_profile: [],
  onboarded: false,
};

export function ShareProfileSheet({ visible, onClose }: ShareProfileSheetProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { user } = usePrivy();
  const cardRef = useRef<View>(null);

  const [profile, setProfile] = useState<MyProfile | null>(null);
  /** URL da foto que já terminou de carregar — a captura espera por ela. */
  const [settledPhoto, setSettledPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const accounts = (user?.linked_accounts ?? []) as readonly LinkedAccountLike[];
  const photoUrl = profilePhotoUrl(accounts);
  const handle = xHandle(profile?.social_links.twitter, accounts);
  const caption = buildShareCaption({
    name: profile?.full_name ?? null,
    interests: profile?.interest_profile ?? [],
  });

  // Busca o perfil a cada abertura: o usuário pode ter acabado de editar.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    getMyProfile()
      .then((p) => active && setProfile(p))
      // Sem perfil o card ainda sai com iniciais e a marca — não bloqueia.
      .catch(() => active && setProfile((current) => current ?? EMPTY_PROFILE));
    return () => {
      active = false;
    };
  }, [visible]);

  // Sem foto não há o que esperar; com foto, só depois do `onLoadEnd`.
  const photoReady = !photoUrl || settledPhoto === photoUrl;

  /** Fechar limpa o aviso, senão ele reaparece velho na próxima abertura. */
  function close() {
    setNotice(null);
    onClose();
  }

  async function shareImage() {
    setBusy(true);
    setNotice(null);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setNotice('Sharing is not available on this device.');
        return;
      }
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        // O view-shot só reescala com as duas medidas; mesma proporção 4:5.
        width: EXPORT_WIDTH,
        height: EXPORT_WIDTH * 1.25,
        result: 'tmpfile',
      });
      await Clipboard.setStringAsync(`${caption} ${SHARE_URL}`);
      setNotice('Caption copied — paste it in your post.');
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: 'Share your Xiaolee profile',
      });
    } catch {
      setNotice("Couldn't create the image. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function postOnX() {
    setNotice(null);
    try {
      await Linking.openURL(xIntentUrl(caption));
    } catch {
      setNotice("Couldn't open X.");
    }
  }

  const cardWidth = Math.min(screenWidth - Spacing.four * 2, 320);
  const ready = Boolean(profile) && photoReady && !busy;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Spacing.four + insets.bottom }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.handleBar} />

          <View style={styles.header}>
            <View style={styles.icon}>
              <IconUpload size={20} color={Colors.light.accent} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Share profile</Text>
              <Text style={styles.subtitle}>Ready-made post with your photo</Text>
            </View>
            <Pressable onPress={close} hitSlop={Spacing.two} accessibilityLabel="Close">
              <IconClose size={18} color={Colors.light.ink3} />
            </Pressable>
          </View>

          <View style={styles.preview}>
            {profile ? (
              <ShareProfileCard
                ref={cardRef}
                width={cardWidth}
                name={profile.full_name}
                handle={handle}
                bio={profile.bio}
                interests={profile.interest_profile}
                photoUrl={photoUrl}
                onPhotoSettled={() => setSettledPhoto(photoUrl)}
              />
            ) : (
              <View style={[styles.placeholder, { width: cardWidth, height: cardWidth * 1.25 }]}>
                <ActivityIndicator color={Colors.light.accent} />
              </View>
            )}
          </View>

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          <Pressable
            onPress={shareImage}
            disabled={!ready}
            style={({ pressed }) => [styles.button, (pressed || !ready) && styles.pressed]}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={Colors.light.card} />
            ) : (
              <Text style={styles.buttonLabel}>Share image</Text>
            )}
          </Pressable>

          <Pressable
            onPress={postOnX}
            disabled={!profile}
            style={({ pressed }) => [styles.secondary, (pressed || !profile) && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryLabel}>Post on X</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26,25,23,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    gap: Spacing.three - 4,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: Colors.light.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
    ...CardShadow,
  },
  handleBar: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.light.border,
    marginBottom: Spacing.one,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.accentSoft,
  },
  headerText: { flex: 1 },
  title: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.light.ink },
  subtitle: { fontFamily: Fonts.sans, fontSize: 11, color: Colors.light.ink2, marginTop: 1 },
  preview: { alignSelf: 'center', borderRadius: Radius.xl, overflow: 'hidden' },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.xl,
    backgroundColor: Colors.light.accentSoft,
  },
  notice: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    color: Colors.light.ink2,
    textAlign: 'center',
  },
  button: {
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.accent,
  },
  buttonLabel: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.light.card },
  secondary: {
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  secondaryLabel: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.light.ink },
  pressed: { opacity: 0.6 },
});
