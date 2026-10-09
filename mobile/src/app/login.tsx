import { usePrivy } from '@privy-io/expo';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Circle, Path, Svg } from 'react-native-svg';
import { StatusBar } from 'expo-status-bar';

import { GoogleLogo } from '@/components/google-logo';
import {
  BackgroundGlow,
  IconAlertCircle,
  IconArrowRight,
  IconMail,
  SadBlockIllustration,
  SparkleStar,
  WalletIllustration,
} from '@/components/login-decorations';
import { OtpInput } from '@/components/otp-input';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuthState } from '@/hooks/use-auth-state';
import { usePrivyLogin } from '@/hooks/use-privy-login';
import { usePrivyWallet } from '@/lib/wallet';

/**
 * Spinner circular em arco rotativo para o estado "Setting up your account".
 */
function CircularArcSpinner({ size = 64 }: { size?: number }) {
  const [rotateAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [rotateAnim]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ rotate: spin }] }}>
      <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <Circle cx="32" cy="32" r="26" stroke="#FCE7F3" strokeWidth="4.5" />
        <Path
          d="M32 6 A26 26 0 0 1 58 32"
          stroke="#D81B78"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
      </Svg>
    </Animated.View>
  );
}

/**
 * Botão chevron voltar no topo esquerdo da tela.
 */
function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      style={styles.backButton}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
        <Path
          d="M15 19l-7-7 7-7"
          stroke="#18181B"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}

/**
 * Tela de login real do Xiaolee com alta fidelidade visual.
 *
 * Suporta os 5 estados do design:
 * 1. Formulário de login (Google + E-mail)
 * 2. Validação inline de e-mail (erro)
 * 3. Verificação de código OTP em 6 caixas individuais + timer de reenvio
 * 4. "Setting up your account" (spinner + ilustração da carteira)
 * 5. "We couldn't finish signing you in" (ilustração de erro + retry)
 */
export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const authState = useAuthState();
  const { isReady } = usePrivy();
  const { disconnect, retrySession } = usePrivyWallet();
  const login = usePrivyLogin();

  const [countdown, setCountdown] = useState(45);

  const settingUp = authState === 'signingIn';
  const failed = authState === 'error';
  const disabled = login.busy || !isReady;

  // Gerenciamento do cronômetro de reenvio do código: só roda enquanto countdown > 0 e na etapa de código
  useEffect(() => {
    if (!login.showCodeStep || countdown <= 0) return;
    const interval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [login.showCodeStep, countdown]);

  const handleBack = useCallback(() => {
    Keyboard.dismiss();
    if (login.showCodeStep) {
      setCountdown(45);
      login.changeEmail();
    } else if (settingUp || failed) {
      login.reset();
      void disconnect();
    }
  }, [login, settingUp, failed, disconnect]);

  const canGoBack = login.showCodeStep || settingUp || failed;

  // Intercepta o botão de voltar físico/gestual do Android para navegação consistente
  useEffect(() => {
    if (!canGoBack) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack, handleBack]);

  const handleSendEmail = async () => {
    Keyboard.dismiss();
    const success = await login.submitEmail();
    if (success) {
      setCountdown(45);
    }
  };

  const handleVerifyCode = useCallback(
    async (codeOverride?: string) => {
      Keyboard.dismiss();
      await login.submitCode(typeof codeOverride === 'string' ? codeOverride : undefined);
    },
    [login],
  );

  const handleResend = async () => {
    if (countdown > 0 || login.busy) return;
    Keyboard.dismiss();
    const success = await login.resendCode();
    if (success) {
      setCountdown(45);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <BackgroundGlow />

      {/* Brilhos decorativos no topo */}
      <SparkleStar size={16} color="#F472B6" style={styles.sparkleTopRight} />
      <SparkleStar size={12} color="#FBCFE8" style={styles.sparkleMidRight} />

      {/* `padding` nas duas plataformas, como o composer do chat e o sheet de
          carteira: desde o edge-to-edge obrigatório (SDK 54) a janela do
          Android não encolhe mais sozinha, e sem isto o teclado cobre o campo
          de e-mail e o do código. */}
      <KeyboardAvoidingView style={styles.keyboardView} behavior="padding">
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: insets.top + Spacing.two,
              paddingBottom: insets.bottom + Spacing.four,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Barra de topo com botão voltar */}
          <View style={styles.topNav}>
            {canGoBack ? <BackButton onPress={handleBack} /> : <View style={styles.backPlaceholder} />}
          </View>

          {/* Cabeçalho da Marca */}
          <View style={styles.brandHeader}>
            <View style={styles.logoRow}>
              <Text style={styles.wordmark}>
                Xiao<Text style={styles.wordmarkAccent}>lee</Text>
              </Text>
              <SparkleStar size={18} color="#D81B78" style={styles.sparkleLogo} />
            </View>
            <Text style={styles.tagline}>
              Your AI agent for creator payments,{'\n'}on{' '}
              <Text style={styles.arcAccent}>Arc.</Text>
            </Text>
          </View>

          {/* Conteúdo Dinâmico por Estado */}
          {settingUp ? (
            /* Estado 4: Setting up your account */
            <View style={styles.fullFlowContainer}>
              <View style={styles.spinnerWrapper}>
                <CircularArcSpinner size={68} />
              </View>

              <Text style={styles.flowTitle}>Setting up your account</Text>
              <Text style={styles.flowSubtitle}>
                We&apos;re creating your wallet and{'\n'}session. This will only take a moment...
              </Text>

              <WalletIllustration />
            </View>
          ) : failed ? (
            /* Estado 5: We couldn't finish signing you in */
            <View style={styles.fullFlowContainer}>
              <SadBlockIllustration />

              <Text style={styles.flowTitle}>We couldn&apos;t finish{'\n'}signing you in.</Text>
              <Text style={styles.flowSubtitle}>
                Something went wrong. Please try again{'\n'}or use another account.
              </Text>

              <Pressable
                onPress={retrySession}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>Try again</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  login.reset();
                  void disconnect();
                }}
                hitSlop={Spacing.two}
                style={styles.anotherAccountButton}
                accessibilityRole="button"
              >
                <Text style={styles.linkAccent}>Use another account</Text>
              </Pressable>
            </View>
          ) : (
            /* Estados 1, 2 e 3: Card de Login / Verificação de Código */
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {login.showCodeStep ? 'Check your email' : 'Sign in or create\nyour account'}
              </Text>

              {login.showCodeStep ? (
                <Text style={styles.cardSubtitle}>
                  We sent a 6-digit code to{'\n'}
                  <Text style={styles.emailHighlighted}>{login.email.trim()}</Text>.
                </Text>
              ) : null}

              {!login.showCodeStep ? (
                /* Etapa 1 & 2: Google e E-mail */
                <>
                  <Pressable
                    onPress={login.signInWithGoogle}
                    disabled={disabled}
                    style={({ pressed }) => [
                      styles.googleButton,
                      (pressed || disabled) && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={
                      login.isGoogleLoading ? 'Connecting to Google' : 'Continue with Google'
                    }
                    accessibilityState={{ disabled, busy: login.isGoogleLoading }}
                  >
                    {login.isGoogleLoading ? (
                      <View style={styles.buttonContentRow}>
                        <ActivityIndicator color="#18181B" size="small" />
                        <Text style={styles.googleButtonText}>Connecting to Google...</Text>
                      </View>
                    ) : (
                      <>
                        <GoogleLogo size={18} />
                        <Text style={styles.googleButtonText}>Continue with Google</Text>
                      </>
                    )}
                  </Pressable>

                  {login.oauthError ? (
                    <Text style={styles.googleError} accessibilityLiveRegion="polite">
                      {login.oauthError}
                    </Text>
                  ) : null}

                  <View style={styles.divider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>or</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  <View>
                    <View
                      style={[
                        styles.inputWrapper,
                        login.emailError ? styles.inputWrapperError : null,
                      ]}
                    >
                      <View style={styles.inputIconLeft}>
                        <IconMail size={18} color={login.emailError ? '#F43F5E' : '#9CA3AF'} />
                      </View>
                      <TextInput
                        value={login.email}
                        onChangeText={login.onChangeEmail}
                        onSubmitEditing={handleSendEmail}
                        placeholder="Email address"
                        placeholderTextColor="#A1A1AA"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="email"
                        textContentType="emailAddress"
                        returnKeyType="go"
                        editable={!login.busy}
                        accessibilityLabel="Email address"
                        style={styles.textInput}
                      />
                      {login.emailError ? (
                        <View style={styles.inputIconRight}>
                          <IconAlertCircle size={18} color="#F43F5E" />
                        </View>
                      ) : null}
                    </View>

                    {login.emailError ? (
                      <Text style={styles.inlineError} accessibilityLiveRegion="polite">
                        {login.emailError}
                      </Text>
                    ) : null}
                  </View>

                  <Pressable
                    onPress={handleSendEmail}
                    disabled={disabled}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      (pressed || disabled) && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Continue with email"
                    accessibilityState={{ disabled, busy: login.isEmailLoading }}
                  >
                    {login.isEmailLoading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <View style={styles.buttonContentRow}>
                        <Text style={styles.primaryButtonText}>Continue with email</Text>
                        <IconArrowRight size={18} color="#FFFFFF" />
                      </View>
                    )}
                  </Pressable>

                  <Text style={styles.termsNotice}>
                    By continuing, you agree to our{'\n'}
                    <Text style={styles.termsLink}>Terms of Service</Text> and{' '}
                    <Text style={styles.termsLink}>Privacy Policy</Text>.
                  </Text>
                </>
              ) : (
                /* Etapa 3: Caixas OTP de 6 dígitos */
                <>
                  <OtpInput
                    value={login.code}
                    onChangeText={login.onChangeCode}
                    onSubmitEditing={handleVerifyCode}
                    disabled={login.busy}
                    hasError={Boolean(login.emailError)}
                  />

                  {login.emailError ? (
                    <Text style={styles.inlineError} accessibilityLiveRegion="polite">
                      {login.emailError}
                    </Text>
                  ) : null}

                  <Pressable
                    onPress={() => void handleVerifyCode()}
                    disabled={disabled}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      (pressed || disabled) && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Verify and continue"
                    accessibilityState={{ disabled, busy: login.isEmailLoading }}
                  >
                    {login.isEmailLoading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <View style={styles.buttonContentRow}>
                        <Text style={styles.primaryButtonText}>Verify and continue</Text>
                        <IconArrowRight size={18} color="#FFFFFF" />
                      </View>
                    )}
                  </Pressable>

                  <View style={styles.codeLinksContainer}>
                    <Pressable
                      onPress={handleResend}
                      disabled={login.busy || countdown > 0}
                      hitSlop={Spacing.two}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.resendCodeLink, countdown > 0 && styles.resendDisabled]}>
                        Resend code {countdown > 0 ? `(00:${countdown.toString().padStart(2, '0')})` : ''}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={login.changeEmail}
                      disabled={login.busy}
                      hitSlop={Spacing.two}
                      accessibilityRole="button"
                    >
                      <Text style={styles.useAnotherEmailLink}>Use another email</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FAF8F7',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
    justifyContent: 'center',
  },
  topNav: {
    height: 40,
    justifyContent: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -Spacing.two,
  },
  backPlaceholder: {
    height: 40,
  },
  sparkleTopRight: {
    position: 'absolute',
    top: 50,
    right: 28,
  },
  sparkleMidRight: {
    position: 'absolute',
    top: 150,
    right: 36,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: Spacing.four,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  wordmark: {
    fontFamily: Fonts.brand,
    fontSize: 44,
    lineHeight: 54,
    color: '#18181B',
  },
  wordmarkAccent: {
    color: '#D81B78',
  },
  sparkleLogo: {
    marginLeft: 4,
    marginTop: 6,
  },
  tagline: {
    fontFamily: Fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    color: '#6B6862',
    marginTop: 2,
  },
  arcAccent: {
    color: '#8B5CF6',
    fontFamily: Fonts.bold,
  },

  /* Card Principal */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: Spacing.four + 4,
    borderWidth: 1,
    borderColor: '#F0EDEA',
    gap: Spacing.three + 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 2,
  },
  cardTitle: {
    fontFamily: Fonts.bold,
    fontSize: 22,
    lineHeight: 28,
    color: '#18181B',
    textAlign: 'left',
  },
  cardSubtitle: {
    fontFamily: Fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: '#71717A',
    marginTop: -Spacing.one,
  },
  emailHighlighted: {
    fontFamily: Fonts.bold,
    color: '#18181B',
  },

  /* Botão Google */
  googleButton: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: '#E4E4E7',
    backgroundColor: '#FFFFFF',
  },
  googleButtonText: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    color: '#18181B',
  },
  googleError: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: '#F43F5E',
    textAlign: 'center',
    marginTop: -4,
    marginBottom: 4,
  },

  /* Divisor "or" */
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginVertical: 2,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ECEAE7',
  },
  dividerText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: '#A1A1AA',
  },

  /* Input de E-mail */
  inputWrapper: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#E4E4E7',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: Spacing.three,
  },
  inputWrapperError: {
    borderColor: '#F43F5E',
    backgroundColor: '#FFF5F6',
  },
  inputIconLeft: {
    marginRight: Spacing.two,
  },
  inputIconRight: {
    marginLeft: Spacing.two,
  },
  textInput: {
    flex: 1,
    fontFamily: Fonts.medium,
    fontSize: 15,
    color: '#18181B',
    paddingVertical: 0,
  },
  inlineError: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: '#F43F5E',
    marginTop: 6,
    paddingHorizontal: Spacing.one,
  },

  /* Botão Primário (Rosa) */
  primaryButton: {
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: '#D81B78',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  buttonContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  primaryButtonText: {
    fontFamily: Fonts.bold,
    fontSize: 15,
    color: '#FFFFFF',
  },

  /* Termos e Política */
  termsNotice: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    lineHeight: 16,
    color: '#71717A',
    textAlign: 'center',
    marginTop: Spacing.one,
  },
  termsLink: {
    textDecorationLine: 'underline',
    color: '#71717A',
  },

  /* Links na tela de Código OTP */
  codeLinksContainer: {
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  resendCodeLink: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    color: '#D81B78',
    textDecorationLine: 'underline',
  },
  resendDisabled: {
    opacity: 0.9,
  },
  useAnotherEmailLink: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: '#71717A',
    textDecorationLine: 'underline',
  },

  /* Telas de Fluxo Aberto (Setting Up & Error) */
  fullFlowContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  spinnerWrapper: {
    marginVertical: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowTitle: {
    fontFamily: Fonts.bold,
    fontSize: 20,
    lineHeight: 26,
    color: '#18181B',
    textAlign: 'center',
  },
  flowSubtitle: {
    fontFamily: Fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: '#71717A',
    textAlign: 'center',
    maxWidth: 290,
  },
  anotherAccountButton: {
    marginTop: Spacing.two,
    padding: Spacing.one,
  },
  linkAccent: {
    fontFamily: Fonts.semibold,
    fontSize: 14,
    color: '#D81B78',
    textDecorationLine: 'underline',
  },

  pressed: {
    opacity: 0.75,
  },
});
