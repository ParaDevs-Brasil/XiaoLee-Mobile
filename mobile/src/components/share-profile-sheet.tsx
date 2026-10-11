import { usePrivy } from '@privy-io/expo';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { APP_NOT_INSTALLED, shareImage } from '../../modules/share-intent';

import { getMyProfile, type MyProfile } from '@/api/backend';
import { IconClose, IconShare, IconUser } from '@/components/icons';
import { ShareProfileCard } from '@/components/share-profile-card';
import { CardShadow, Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useProfilePhoto } from '@/hooks/use-profile-photo';
import {
  buildShareCaption,
  profilePhotoUrl,
  xHandle,
  xIntentUrl,
  type LinkedAccountLike,
  type ShareChannel,
} from '@/lib/share-profile';

/**
 * Sheet do "compartilhar perfil" (XIAOLEEACE-21), aberto pelo `ProfileMenu`.
 *
 * Mostra o `ShareProfileCard` como preview e manda imagem **e** legenda
 * juntas, num só intent (`modules/share-intent`), direto para o app:
 *  - **WhatsApp** — legenda pessoal com o link.
 *  - **X** — post curto com hashtags dos interesses e a imagem anexada,
 *    direto no compositor (sem o "Post ou Chat?" do X).
 *  - **More apps** — o seletor do sistema, com a legenda do WhatsApp.
 *
 * Sem o app instalado, o X cai no intent web (só texto — a web não aceita
 * anexo) e o WhatsApp cai no seletor do sistema.
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

type Busy = 'none' | ShareChannel | 'more';

/**
 * Para onde vai cada canal. O X tem duas telas de compartilhar (post e DM);
 * a atividade exata do compositor manda direto para o post.
 */
const TARGETS: Record<ShareChannel, { packageName: string; className?: string }> = {
  whatsapp: { packageName: 'com.whatsapp' },
  x: { packageName: 'com.twitter.android', className: 'com.twitter.composer.ComposerActivity' },
};

export function ShareProfileSheet({ visible, onClose }: ShareProfileSheetProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { user } = usePrivy();
  const { photo: localPhoto, busy: pickingPhoto, pick, canPick } = useProfilePhoto();
  const cardRef = useRef<View>(null);

  const [profile, setProfile] = useState<MyProfile | null>(null);
  /** URL da foto que já terminou de carregar — a captura espera por ela. */
  const [settledPhoto, setSettledPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>('none');
  const [notice, setNotice] = useState<string | null>(null);

  const accounts = (user?.linked_accounts ?? []) as readonly LinkedAccountLike[];
  // Ordem: a que o usuário escolheu aqui > a da conta social no Privy > iniciais.
  const photoUrl = localPhoto ?? profilePhotoUrl(accounts);
  const handle = xHandle(profile?.social_links.twitter, accounts);
  const captionInput = {
    name: profile?.full_name ?? null,
    interests: profile?.interest_profile ?? [],
  };

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
  const ready = Boolean(profile) && photoReady && busy === 'none' && !pickingPhoto;

  /** Fechar limpa o aviso, senão ele reaparece velho na próxima abertura. */
  function close() {
    setNotice(null);
    onClose();
  }

  async function changePhoto() {
    setNotice(null);
    try {
      await pick();
    } catch {
      setNotice("Couldn't load that photo. Try another one.");
    }
  }

  /**
   * Captura o card como PNG 1080x1350 e devolve a URI `content://` que outro
   * app consegue ler (o FileProvider do `expo-file-system` cobre o cache).
   */
  async function captureCard(): Promise<string> {
    const path = await captureRef(cardRef, {
      format: 'png',
      quality: 1,
      // O view-shot só reescala com as duas medidas; mesma proporção 4:5.
      width: EXPORT_WIDTH,
      height: EXPORT_WIDTH * 1.25,
      result: 'tmpfile',
    });
    return new File(path.startsWith('file://') ? path : `file://${path}`).contentUri;
  }

  async function shareTo(channel: ShareChannel | 'more') {
    setBusy(channel);
    setNotice(null);
    const text = buildShareCaption(captionInput, channel === 'x' ? 'x' : 'whatsapp');
    try {
      const uri = await captureCard();
      if (channel === 'more') {
        await shareImage({ uri, text, chooserTitle: 'Share your Xiaolee profile' });
        return;
      }
      try {
        await shareImage({ uri, text, ...TARGETS[channel] });
      } catch (error) {
        if ((error as { code?: string }).code !== APP_NOT_INSTALLED) throw error;
        // Sem o app: o X vai pra web (só texto — a web não aceita anexo);
        // o WhatsApp vira o seletor do sistema.
        if (channel === 'x') {
          setNotice("X app not found — opening the web, where the image can't be attached.");
          await Linking.openURL(xIntentUrl(text));
        } else {
          await shareImage({ uri, text, chooserTitle: 'Share your Xiaolee profile' });
        }
      }
    } catch {
      setNotice("Couldn't share the image. Try again.");
    } finally {
      setBusy('none');
    }
  }

  const cardWidth = Math.min(screenWidth - Spacing.four * 2, 320);

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
              <IconShare size={20} color={Colors.light.accent} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Share profile</Text>
              <Text style={styles.subtitle}>Ready-made post with your photo</Text>
            </View>
            <Pressable onPress={close} hitSlop={Spacing.two} accessibilityLabel="Close">
              <IconClose size={18} color={Colors.light.ink3} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.preview}>
              {profile ? (
                <ShareProfileCard
                  ref={cardRef}
                  width={cardWidth}
                  name={profile.full_name}
                  handle={handle}
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

            {canPick ? (
              <Pressable
                onPress={changePhoto}
                disabled={busy !== 'none' || pickingPhoto}
                style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                {pickingPhoto ? (
                  <ActivityIndicator size="small" color={Colors.light.accent} />
                ) : (
                  <IconUser size={15} color={Colors.light.accent} />
                )}
                <Text style={styles.photoLabel}>{photoUrl ? 'Change photo' : 'Add your photo'}</Text>
              </Pressable>
            ) : null}

            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <View style={styles.row}>
              <ShareButton
                label="WhatsApp"
                variant="primary"
                loading={busy === 'whatsapp'}
                disabled={!ready}
                onPress={() => shareTo('whatsapp')}
              />
              <ShareButton
                label="Post on X"
                variant="ink"
                loading={busy === 'x'}
                disabled={!ready}
                onPress={() => shareTo('x')}
              />
            </View>
            <ShareButton
              label="More apps"
              variant="secondary"
              loading={busy === 'more'}
              disabled={!ready}
              onPress={() => shareTo('more')}
            />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ShareButton({
  label,
  variant,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  variant: 'primary' | 'ink' | 'secondary';
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const color = variant === 'secondary' ? Colors.light.ink : Colors.light.card;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        (pressed || disabled) && styles.pressed,
      ]}
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.buttonLabel, { color }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26,25,23,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '94%',
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
  content: { gap: Spacing.three - 4 },
  preview: { alignSelf: 'center', borderRadius: Radius.xl, overflow: 'hidden' },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.accentSoft,
  },
  photoButton: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 2,
    paddingHorizontal: Spacing.three,
    height: 34,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.accentSoft,
  },
  photoLabel: { fontFamily: Fonts.bold, fontSize: 12, color: Colors.light.accent },
  notice: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    color: Colors.light.ink2,
    textAlign: 'center',
  },
  row: { flexDirection: 'row', gap: Spacing.two },
  button: {
    flex: 1,
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: Colors.light.accent },
  ink: { backgroundColor: Colors.light.ink },
  secondary: {
    flex: 0,
    backgroundColor: Colors.light.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  buttonLabel: { fontFamily: Fonts.bold, fontSize: 14 },
  pressed: { opacity: 0.6 },
});
