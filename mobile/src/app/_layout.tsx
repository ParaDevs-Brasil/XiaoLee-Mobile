// Precisam ser os primeiríssimos imports do arquivo — antes até de
// `@privy-io/expo` na linha seguinte. Import ES module roda na ordem em que
// aparece no arquivo que importa; `@privy-io/expo` toca `crypto` e encoding
// de texto no escopo do módulo, assim que importado. Pôr o polyfill em
// `lib/wallet.tsx` não adianta: este arquivo importa `@privy-io/expo` direto,
// antes de chegar no `@/lib/wallet` lá embaixo. Mesmo papel que
// `@walletconnect/react-native-compat` fazia antes, quando ainda existia.
import 'react-native-get-random-values';
import 'fast-text-encoding';
import '@ethersproject/shims';

import {
  Quicksand_400Regular,
  Quicksand_500Medium,
  Quicksand_600SemiBold,
  Quicksand_700Bold,
  useFonts,
} from '@expo-google-fonts/quicksand';
import { PrivyProvider } from '@privy-io/expo';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FadeOutOverlay } from '@/components/fade-out-overlay';
import { IntroVideo } from '@/components/intro-video';
import { LoadingScreen } from '@/components/loading-screen';
import { Colors, DARK_MODE } from '@/constants/theme';
import { useAuthState } from '@/hooks/use-auth-state';
import { arcTestnetChain, PRIVY_CONFIG, WalletProvider } from '@/lib/wallet';

// Necessário para fechar o navegador e completar o fluxo OAuth de volta no app (Android/Web)
WebBrowser.maybeCompleteAuthSession();

/**
 * `CHANGE_ME` deixa o app subir sem quebrar antes de o app do Privy existir —
 * mesmo acordo que `EXPO_PUBLIC_WC_PROJECT_ID` tinha. Login social não
 * funciona com o placeholder, mas o resto do app (telas, dados via sessão
 * salva) sim.
 */
const PRIVY_APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID?.trim() || 'CHANGE_ME';
const PRIVY_CLIENT_ID = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID?.trim() || 'CHANGE_ME';

SplashScreen.preventAutoHideAsync();

/**
 * Navegador raiz do aplicativo dentro dos provedores Privy e WalletProvider.
 *
 * Aplica o gate de login via `Stack.Protected`:
 * - Sem sessão (`guard={!signedIn}`): apenas a rota `/login` fica acessível;
 * - Autenticado (`guard={signedIn}`): todas as telas do app são liberadas;
 * - Enquanto carrega o SecureStore (`authState === 'loading'`), devolve `null`
 *   para evitar flash da tela de login para quem já possui sessão.
 *
 * Cuidado crítico: todas as 14 rotas do `src/app` precisam estar mapeadas
 * dentro de um dos blocos protegidos. No Expo Router, rotas não declaradas
 * são injetadas sem guarda e ficariam abertas.
 */
function RootNavigator() {
  const authState = useAuthState();
  const signedIn = authState === 'signedIn';

  if (authState === 'loading') {
    return null;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.light.card },
        headerTitleStyle: { fontFamily: 'Quicksand_700Bold', color: Colors.light.ink },
        contentStyle: { backgroundColor: Colors.light.bg },
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={signedIn}>
        {/* Estas telas trazem o próprio HeaderBar (o wordmark do Figma) via
            `ScreenShell`, então a barra nativa sairia duplicada. A volta
            fica com o gesto do sistema e com o wordmark, que leva ao chat. */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
        {/* Sem ScreenShell/header nativo de propósito: é o único passo
            obrigatório antes do chat/dashboard, não um destino para
            navegar de volta a partir de outra tela. */}
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="traction" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="dashboard" options={{ headerShown: false }} />
        <Stack.Screen name="campaigns/index" options={{ headerShown: false }} />
        <Stack.Screen name="wallet" options={{ headerShown: false }} />
        <Stack.Screen name="transactions" options={{ headerShown: false }} />
        <Stack.Screen name="history" options={{ headerShown: false }} />
        <Stack.Screen name="clips/index" options={{ headerShown: false }} />
        <Stack.Screen name="clips/[id]" options={{ headerShown: false }} />
        {/* O formulário é a exceção: entra como modal e mantém a barra
            nativa. Num formulário longo o usuário precisa de uma saída
            sempre visível, e o wordmark do ScreenShell não é uma. */}
        <Stack.Screen
          name="campaigns/new"
          options={{ presentation: 'modal', title: 'New Campaign' }}
        />
        <Stack.Screen name="diagnostics" options={{ title: 'Diagnóstico' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  // A intro toca em toda abertura fria do app — este estado nasce `'video'` a
  // cada montagem de `RootLayout`, então não precisa de storage pra saber
  // "deve mostrar agora": a existência do vídeo/loading por cima do Stack é a
  // resposta. O storage (`lib/intro.ts`) só decide se o botão de pular
  // aparece dentro do `IntroVideo`. Ordem: vídeo (com voz) → loading (mesma
  // cara do splash nativo) → chat — pedido explícito, o loading sozinho não
  // é mais a primeira coisa que o usuário vê.
  const [stage, setStage] = useState<'video' | 'loading' | 'ready'>('video');
  // Cada camada some com um dissolve (`FadeOutOverlay`) em vez de sumir de
  // uma vez — a próxima já está montada por baixo quando a de cima começa a
  // desaparecer, então `stage` avançar não basta pra desmontar a anterior:
  // só quando o próprio fade termina (`onFadedOut`) é que ela some de fato.
  const [videoGone, setVideoGone] = useState(false);
  const [loadingGone, setLoadingGone] = useState(false);

  // Quicksand é a fonte do produto (ver constants/theme.ts). Sem esperar por
  // ela, o app pisca na fonte de sistema antes de trocar.
  const [fontsLoaded, fontError] = useFonts({
    Quicksand_400Regular,
    Quicksand_500Medium,
    Quicksand_600SemiBold,
    Quicksand_700Bold,
    // Candice: fonte da marca, só o logo usa (ver Fonts.brand).
    Candice: require('../../assets/fonts/candice-web.ttf'),
  });

  // Esconde o splash nativo assim que o primeiro frame JS existe — não espera
  // fonte nenhuma. O vídeo de intro (a próxima coisa a aparecer) não usa texto
  // nenhum além do botão "Skip", que só pode aparecer depois de uma checagem
  // assíncrona (`hasSeenIntro`) — folga de sobra pra Quicksand carregar sem
  // piscar. O `<Stack>` (chat, cheio de texto) é que segue esperando fonte,
  // mais abaixo — e essa espera já é coberta pelos vários segundos de vídeo +
  // loading antes dele montar.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {
      // splash já escondido — não há o que tratar
    });
  }, []);

  return (
    // Tema fixo, escolhido por `DARK_MODE` em `constants/theme.ts` (claro por
    // padrão; a paleta escura está pronta atrás desse interruptor). Sem
    // toggle e sem seguir o tema do aparelho.
    // SafeAreaProvider é obrigatório para `useSafeAreaInsets` devolver algo
    // diferente de zero — sem ele o header fica sob a status bar.
    <SafeAreaProvider>
      {/* Relógio, wifi e bateria contrastando com a faixa da status bar.
          O padrão de `style` é `auto`, que segue o tema **do aparelho**: num
          celular em modo escuro os ícones sairiam brancos sobre o
          `HeaderBar`, que pinta a faixa com `Colors.light.card` — branco no
          claro, e o usuário perderia o relógio e as notificações. O app não
          acompanha o aparelho, então a barra também não: ícones escuros no
          tema claro, claros no escuro. */}
      <StatusBar style={DARK_MODE ? 'light' : 'dark'} />

      {/*
        `supportedChains` é prop irmã de `config`, não filha — e não existe
        `defaultChain`: a wallet embutida nasce no primeiro item de
        `supportedChains` automaticamente (conferido contra
        `PrivyProviderProps`/`PrivyConfig` em
        `node_modules/@privy-io/expo/dist/index.d.ts`).
      */}
      <PrivyProvider
        appId={PRIVY_APP_ID}
        clientId={PRIVY_CLIENT_ID}
        supportedChains={[arcTestnetChain]}
        config={PRIVY_CONFIG}
      >
        <WalletProvider>
          <ThemeProvider value={DARK_MODE ? DarkTheme : DefaultTheme}>
            {/*
              Só monta o Stack depois que a intro termina — não por
              performance, é correção. `AnimatedAvatar` (cabeçalho do chat) é
              outro `VideoView`, e dois `VideoView` simultâneos no Android
              competem no compositor nativo (SurfaceView) por fora da ordem
              normal de camadas: um vazava por cima do outro, aparecendo como
              o "rostinho" da Xiaolee dentro do balão "Hi" do vídeo de intro.
              `PrivyProvider`/`WalletProvider` continuam montados o tempo
              todo — só eles não usam vídeo, então hidratam a sessão em
              paralelo à intro, sem esse conflito.
            */}
            {stage === 'ready' && (fontsLoaded || fontError) ? <RootNavigator /> : null}
          </ThemeProvider>
        </WalletProvider>
      </PrivyProvider>

      {/* Ordem de baixo pra cima: loading, depois vídeo — cada uma dissolve
          revelando a de baixo, que já está montada e visível antes do fade
          começar (ver `FadeOutOverlay`). O Stack (chat) já monta assim que
          `stage` chega em 'ready', junto com o loading começar a sumir, pra
          já estar pronto por baixo quando o fade dele terminar. */}
      {!loadingGone && (stage === 'loading' || stage === 'ready') ? (
        <FadeOutOverlay
          zIndex={100}
          fadeOut={stage === 'ready'}
          onFadedOut={() => setLoadingGone(true)}
          durationMs={700}
        >
          <LoadingScreen onFinish={() => setStage('ready')} />
        </FadeOutOverlay>
      ) : null}
      {!videoGone ? (
        <FadeOutOverlay zIndex={101} fadeOut={stage !== 'video'} onFadedOut={() => setVideoGone(true)}>
          <IntroVideo onFinish={() => setStage('loading')} />
        </FadeOutOverlay>
      ) : null}
    </SafeAreaProvider>
  );
}
