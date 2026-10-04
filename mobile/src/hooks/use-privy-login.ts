import { useLoginWithEmail, useLoginWithOAuth } from '@privy-io/expo';
import { useState } from 'react';
import { Keyboard } from 'react-native';

import { isValidCode, isValidEmail } from '@/lib/auth-state';

/**
 * Fluxo de login do Privy (e-mail por código + Google), usado pela tela de
 * login e pelo sheet de carteira — a mesma lógica nos dois lugares, para eles
 * não divergirem em validação nem em mensagem de erro.
 *
 * Não há senha: o Privy autentica o e-mail com um código de 6 dígitos enviado
 * à caixa de entrada, e esse é o cadastro — a conta nasce no primeiro código
 * aceito, e a carteira embutida nasce junto (`createOnLogin`, `lib/wallet.tsx`).
 * Quem completa o login não é este hook: o `WalletProvider` percebe a conta e
 * troca o token por uma sessão do backend.
 */
export function usePrivyLogin() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // Erro de validação local — só aparece depois de a pessoa tentar enviar,
  // para não gritar "e-mail inválido" enquanto ela ainda está digitando.
  const [fieldError, setFieldError] = useState<string | null>(null);
  // "Usar outro e-mail": o Privy segue em `awaiting-code-input` até o código
  // ser aceito, e não há como pedir a ele para voltar ao início. Esta flag
  // local devolve o campo de e-mail sem esperar por ele; o próximo
  // `sendCode` bem-sucedido a desliga.
  const [editingEmail, setEditingEmail] = useState(false);
  // Garante que o app permaneça na etapa de código mesmo quando o Privy
  // reporta status 'error' após um código incorreto.
  const [codeSent, setCodeSent] = useState(false);

  const { state: emailState, sendCode, loginWithCode } = useLoginWithEmail();
  const { login: loginWithGoogle, state: oauthState } = useLoginWithOAuth();

  const awaitingCode =
    emailState.status === 'awaiting-code-input' || emailState.status === 'submitting-code';
  const showCodeStep = (codeSent || awaitingCode) && !editingEmail;
  const isEmailLoading =
    emailState.status === 'sending-code' || emailState.status === 'submitting-code';
  const isGoogleLoading = oauthState.status === 'loading';
  const busy = isEmailLoading || isGoogleLoading;

  // Ignora cancelamento pelo próprio usuário para não exibir mensagem de erro desnecessária
  const isOAuthCancelled =
    oauthState.status === 'error' &&
    ((oauthState.error as { code?: string } | null)?.code ===
      'login_with_oauth_was_cancelled_by_user' ||
      oauthState.error?.message?.toLowerCase().includes('cancelled') ||
      oauthState.error?.message?.toLowerCase().includes('canceled'));

  let emailError = fieldError;
  if (!emailError && emailState.status === 'error') {
    emailError = showCodeStep
      ? "That code didn't work. Check it and try again."
      : "We couldn't send the code. Check the email and try again.";
  }

  const oauthError =
    oauthState.status === 'error' && !isOAuthCancelled
      ? "Google sign-in didn't complete. Try again."
      : null;

  // Erro geral mantido para compatibilidade
  const error = emailError || oauthError;

  function onChangeEmail(value: string) {
    setEmail(value);
    setFieldError(null);
  }

  function onChangeCode(value: string) {
    // Só dígitos: colar "123 456" ou "123-456" do e-mail tem que funcionar.
    setCode(value.replace(/\D/g, '').slice(0, 6));
    setFieldError(null);
  }

  // Os `.catch` vazios são de propósito: o Privy já guarda a falha em
  // `emailState`/`oauthState`, que é o que vira `error` acima. Sem eles, a
  // rejeição escapa como unhandled promise rejection.
  async function sendEmailCode(emailOverride?: string): Promise<boolean> {
    const targetEmail = (typeof emailOverride === 'string' ? emailOverride : email).trim();
    let success = false;
    await sendCode({ email: targetEmail })
      .then(() => {
        setCodeSent(true);
        setEditingEmail(false);
        success = true;
      })
      .catch((err) => {
        console.warn('[Privy Email] Falha ao enviar código:', err);
      });
    return success;
  }

  async function submitEmail(emailOverride?: unknown): Promise<boolean> {
    if (busy) return false;
    const targetEmail = (typeof emailOverride === 'string' ? emailOverride : email).trim();
    if (!isValidEmail(targetEmail)) {
      setFieldError('Enter a valid email, like you@example.com.');
      return false;
    }
    setFieldError(null);
    return sendEmailCode(targetEmail);
  }

  async function submitCode(codeOverride?: unknown): Promise<void> {
    if (busy) return;
    const targetCode = (typeof codeOverride === 'string' ? codeOverride : code).trim();
    if (!isValidCode(targetCode)) {
      setFieldError('Enter the 6-digit code we sent you.');
      return;
    }
    setFieldError(null);
    await loginWithCode({ code: targetCode, email: email.trim() }).catch((err) => {
      console.warn('[Privy Email] Falha ao verificar código:', err);
    });
  }

  /** Reenvia o código para o mesmo e-mail. */
  async function resendCode(): Promise<boolean> {
    if (busy) return false;
    setCode('');
    setFieldError(null);
    return sendEmailCode();
  }

  /** Volta para digitar outro e-mail. */
  function changeEmail() {
    setCode('');
    setFieldError(null);
    setEditingEmail(true);
    setCodeSent(false);
  }

  async function signInWithGoogle() {
    if (busy) return;
    Keyboard.dismiss();
    setFieldError(null);
    try {
      console.log('[Privy OAuth] Iniciando fluxo de login com Google...');
      await loginWithGoogle({ provider: 'google' });
      console.log('[Privy OAuth] Fluxo de login com Google concluído com sucesso.');
    } catch (err) {
      console.warn('[Privy OAuth] Erro ou cancelamento no login Google:', err);
    }
  }

  function reset() {
    setEmail('');
    setCode('');
    setFieldError(null);
    setEditingEmail(false);
    setCodeSent(false);
  }

  return {
    email,
    code,
    onChangeEmail,
    onChangeCode,
    showCodeStep,
    busy,
    isEmailLoading,
    isGoogleLoading,
    error,
    emailError,
    oauthError,
    submitEmail,
    submitCode,
    resendCode,
    changeEmail,
    signInWithGoogle,
    reset,
  };
}
