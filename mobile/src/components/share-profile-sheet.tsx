import { usePrivy } from '@privy-io/expo';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
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
import { CARD_RATIOS, ShareProfileCard, type CardFormat } from '@/components/share-profile-card';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useProfilePhoto } from '@/hooks/use-profile-photo';
import {
  buildShareCaption,
  instagramHandle,
  profilePhotoUrl,
  xHandle,
  xIntentUrl,
  type LinkedAccountLike,
  type ShareChannel,
} from '@/lib/share-profile';

/**
 * Sheet do "compartilhar perfil" (XIAOLEEACE-21), aberto pelo `ProfileMenu`.
 *
 * Mostra o `ShareProfileCard` como preview, no formato que a pessoa escolher
 * (3:4, o padrão, ou 9:16), e manda imagem **e** legenda juntas, num só
 * intent (`modules/share-intent`), direto para o app:
 *  - **WhatsApp** — formato escolhido, legenda pessoal com o link.
 *  - **X** — sempre 3:4, o máximo que a timeline do X mostra sem cortar,
 *    mesmo com 9:16 escolhido; post curto com hashtags, direto no
 *    compositor (sem o "Post ou Chat?" do X).
 *  - **More apps** — formato escolhido, seletor do sistema.
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

/**
 * Formato que cada canal recebe: o escolhido, exceto o X, que sempre leva o
 * 3:4 — um 9:16 sai cortado na timeline dele (ver `ShareProfileCard`).
 */
function channelFormat(channel: ShareChannel | 'more', chosen: CardFormat): CardFormat {
  return channel === 'x' ? 'post' : chosen;
}

/** Ordem das abas — o 3:4 primeiro, que é o padrão. */
const FORMAT_TABS: { format: CardFormat; label: string }[] = [
  { format: 'post', label: '3:4' },
  { format: 'story', label: '9:16' },
];

const TAB_WIDTH = 76;
/** Duração do crossfade entre formatos — curta, para a troca parecer imediata. */
const SWITCH_MS = 260;

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
  const colors = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { user } = usePrivy();
  const { photo: localPhoto, busy: pickingPhoto, pick, canPick } = useProfilePhoto();
  const storyRef = useRef<View>(null);
  const postRef = useRef<View>(null);
  const cardRefs: Record<CardFormat, typeof storyRef> = { story: storyRef, post: postRef };

  const [profile, setProfile] = useState<MyProfile | null>(null);
  /** Formato escolhido — vale para o preview, o WhatsApp e o "More apps". */
  const [format, setFormat] = useState<CardFormat>('post');
  /**
   * 0 = 3:4, 1 = 9:16. Anima o crossfade, a altura do preview e o seletor.
   * Mesmo idioma do `DropdownPanel`: nasce uma vez e sobrevive aos re-renders.
   */
  const [progress] = useState(() => new Animated.Value(0));
  /** URL da foto que já carregou em cada card — a captura espera pelos dois. */
  const [settledPhoto, setSettledPhoto] = useState<Record<CardFormat, string | null>>({
    story: null,
    post: null,
  });
  const [busy, setBusy] = useState<Busy>('none');
  const [notice, setNotice] = useState<string | null>(null);

  const accounts = (user?.linked_accounts ?? []) as readonly LinkedAccountLike[];
  // Ordem: a que o usuário escolheu aqui > a da conta social no Privy > iniciais.
  const photoUrl = localPhoto ?? profilePhotoUrl(accounts);
  const socials = {
    x: xHandle(profile?.social_links.twitter, accounts),
    instagram: instagramHandle(profile?.social_links.instagram),
  };
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
  const photoReady =
    !photoUrl || (settledPhoto.story === photoUrl && settledPhoto.post === photoUrl);
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
   * Captura o card no formato pedido (1080x1920 ou 1080x1440) e devolve a URI
   * `content://` que outro app consegue ler (o FileProvider do
   * `expo-file-system` cobre o cache).
   */
  async function captureCard(format: CardFormat): Promise<string> {
    const path = await captureRef(cardRefs[format], {
      format: 'png',
      quality: 1,
      // O view-shot só reescala com as duas medidas; mesma proporção do card.
      width: EXPORT_WIDTH,
      height: EXPORT_WIDTH * CARD_RATIOS[format],
      result: 'tmpfile',
    });
    return new File(path.startsWith('file://') ? path : `file://${path}`).contentUri;
  }

  async function shareTo(channel: ShareChannel | 'more') {
    setBusy(channel);
    setNotice(null);
    const text = buildShareCaption(captionInput, channel === 'x' ? 'x' : 'whatsapp');
    try {
      const uri = await captureCard(channelFormat(channel, format));
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

  function chooseFormat(next: CardFormat) {
    if (next === format) return;
    setFormat(next);
    // Sem driver nativo: a altura do preview não é animável por ele, e um só
    // valor mantém crossfade, altura e seletor em sincronia.
    Animated.timing(progress, {
      toValue: next === 'story' ? 1 : 0,
      duration: SWITCH_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }

  // Limite de altura do preview: o card 9:16 é alto, e os botões precisam
  // continuar à vista sem rolar na maioria dos aparelhos.
  const size = (f: CardFormat) => {
    const width = Math.min(
      screenWidth - Spacing.four * 2,
      320,
      (screenHeight * 0.5) / CARD_RATIOS[f],
    );
    return { width, height: width * CARD_RATIOS[f] };
  };
  const post = size('post');
  const story = size('story');
  const stageWidth = Math.max(post.width, story.width);

  /**
   * Os dois cards ficam sempre montados, empilhados no mesmo lugar: trocar o
   * formato só cruza a opacidade. Remontar a cada troca recarregava foto, QR
   * e SVG — era o que deixava a troca lenta. O card escondido continua
   * capturável: o view-shot desenha a própria View, sem a opacidade do pai.
   */
  const renderCard = (f: CardFormat) => {
    const { width, height } = f === 'post' ? post : story;
    const shown = f === 'story' ? progress : Animated.subtract(1, progress);
    return (
      <Animated.View
        key={f}
        pointerEvents={f === format ? 'auto' : 'none'}
        accessibilityElementsHidden={f !== format}
        importantForAccessibility={f === format ? 'auto' : 'no-hide-descendants'}
        style={[
          styles.stageCard,
          {
            width,
            height,
            left: (stageWidth - width) / 2,
            opacity: shown,
            transform: [
              { scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
            ],
          },
        ]}
      >
        <ShareProfileCard
          ref={cardRefs[f]}
          format={f}
          width={width}
          name={profile?.full_name ?? null}
          socials={socials}
          interests={profile?.interest_profile ?? []}
          photoUrl={photoUrl}
          onPhotoSettled={() => setSettledPhoto((s) => ({ ...s, [f]: photoUrl }))}
        />
      </Animated.View>
    );
  };

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
              <IconShare size={20} color={colors.accent} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Share profile</Text>
              <Text style={styles.subtitle}>Ready-made post with your photo</Text>
            </View>
            <Pressable onPress={close} hitSlop={Spacing.two} accessibilityLabel="Close">
              <IconClose size={18} color={colors.ink3} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.formats} accessibilityRole="tablist">
              {/* Pílula que desliza até a aba ativa. */}
              <Animated.View
                style={[
                  styles.formatIndicator,
                  {
                    transform: [
                      {
                        translateX: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, TAB_WIDTH],
                        }),
                      },
                    ],
                  },
                ]}
              />
              {FORMAT_TABS.map(({ format: f, label }) => {
                const active = format === f;
                return (
                  <Pressable
                    key={f}
                    onPress={() => chooseFormat(f)}
                    style={styles.formatTab}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Format ${label}`}
                  >
                    <AspectGlyph format={f} active={active} />
                    <Text style={[styles.formatLabel, active && styles.formatLabelActive]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {profile ? (
              <Animated.View
                style={[
                  styles.stage,
                  {
                    width: stageWidth,
                    height: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [post.height, story.height],
                    }),
                  },
                ]}
              >
                {renderCard('post')}
                {renderCard('story')}
              </Animated.View>
            ) : (
              <View style={[styles.placeholder, post]}>
                <ActivityIndicator color={colors.accent} />
              </View>
            )}

            {format === 'story' ? (
              <Text style={styles.formatHint}>
                X always gets the 3:4 version, so it isn&apos;t cropped in the timeline.
              </Text>
            ) : null}

            {canPick ? (
              <Pressable
                onPress={changePhoto}
                disabled={busy !== 'none' || pickingPhoto}
                style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                {pickingPhoto ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <IconUser size={15} color={colors.accent} />
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

/** Retângulo na proporção do formato, ao lado do rótulo da aba. */
function AspectGlyph({ format, active }: { format: CardFormat; active: boolean }) {
  const styles = useStyles();
  const height = 14;
  return (
    <View
      style={[
        styles.glyph,
        { height, width: height / CARD_RATIOS[format] },
        active && styles.glyphActive,
      ]}
    />
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
  const colors = useTheme();
  const styles = useStyles();
  // `ink` é o botão do X: preto no claro, e no escuro inverte (claro com
  // texto escuro), que é como o próprio X se desenha no tema escuro.
  const color =
    variant === 'secondary' ? colors.ink : variant === 'primary' ? colors.onAccent : colors.card;
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

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '94%',
    gap: Spacing.three - 4,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...CardShadow,
  },
  handleBar: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: Spacing.one,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  headerText: { flex: 1 },
  title: { fontFamily: Fonts.bold, fontSize: 16, color: colors.ink },
  subtitle: { fontFamily: Fonts.sans, fontSize: 11, color: colors.ink2, marginTop: 1 },
  content: { gap: Spacing.three - 4 },
  formats: {
    alignSelf: 'center',
    flexDirection: 'row',
    padding: 3,
    borderRadius: Radius.pill,
    backgroundColor: colors.bg,
  },
  formatIndicator: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: TAB_WIDTH,
    height: 30,
    borderRadius: Radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  formatTab: {
    width: TAB_WIDTH,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  formatLabel: { fontFamily: Fonts.semibold, fontSize: 12, color: colors.ink3 },
  formatLabelActive: { color: colors.ink },
  glyph: { borderRadius: 2, borderWidth: 1.5, borderColor: colors.ink3 },
  glyphActive: { borderColor: colors.accent },
  formatHint: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: colors.ink3,
    textAlign: 'center',
    marginTop: -Spacing.one,
  },
  stage: { alignSelf: 'center' },
  stageCard: {
    position: 'absolute',
    top: 0,
    borderRadius: Radius.xl,
    overflow: 'hidden',
  },
  placeholder: {
    alignSelf: 'center',
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  photoButton: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 2,
    paddingHorizontal: Spacing.three,
    height: 34,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentSoft,
  },
  photoLabel: { fontFamily: Fonts.bold, fontSize: 12, color: colors.accent },
  notice: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    color: colors.ink2,
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
  primary: { backgroundColor: colors.accentFill },
  ink: { backgroundColor: colors.ink },
  secondary: {
    flex: 0,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  buttonLabel: { fontFamily: Fonts.bold, fontSize: 14 },
  pressed: { opacity: 0.6 },
}));
