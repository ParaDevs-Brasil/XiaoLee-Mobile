import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  claimCampaignReward,
  getChatSessionMessages,
  getMyProfile,
  listSocialAccounts,
  sendChatMessage,
  type ChatSessionMessage,
} from '@/api/backend';
import { ApiError } from '@/api/client';
import {
  animationFromBackend,
  avatarAnimation,
  type AnimationKey,
} from '@/lib/avatar-animation';
import {
  draftFrom,
  insightsFrom,
  matchCards,
  optionsFrom,
  type CardDraft,
  type CardInsights,
  type CardOptions,
  type CardPost,
  type CardSwap,
  type ChatCards,
} from '@/lib/chat-cards';
import { parseSwapRequest } from '@/lib/arc-swap-request';
import { appendChatMessage, loadChatHistory, updateChatMessage } from '@/lib/chat-history';
import { refreshChatSessions, setActiveChatSessionId } from '@/lib/chat-session';
import { isOnChainTx, txExplorerUrl } from '@/lib/explorer';
import { shortHash } from '@/lib/format';
import { getSessionToken, getWallet } from '@/lib/session';
import { hasSeenWelcome, markWelcomeSeen } from '@/lib/welcome';
import { buildWelcomeCopy, prioritizeActions, type WelcomeCopy } from '@/lib/welcome-copy';
import { usePrivyWallet } from '@/lib/wallet';

import { AnimatedAvatar } from '@/components/animated-avatar';
import { InsightsCard } from '@/components/chat-insights-card';
import { PostDraftCard } from '@/components/chat-post-draft';
import { PostOptions } from '@/components/chat-post-options';
import { PostPreview } from '@/components/chat-post-preview';
import {
  IconActivity,
  IconChat,
  IconCheck,
  IconEdit,
  IconGift,
  IconSend,
  IconShare,
  IconSwap,
  IconWallet,
  type IconProps,
} from '@/components/icons';
import { ScreenShell } from '@/components/screen-shell';
import { SessionsPanel } from '@/components/sessions-panel';
import { CardShadow, Fonts, Radius, Spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/hooks/use-theme';
import { useChatSession } from '@/hooks/use-chat-session';
import { useKeyboard } from '@/hooks/use-keyboard';
import { useSession } from '@/hooks/use-session';

/**
 * Tela de chat — a home do app.
 *
 * Implementa o frame "Xiaolee - AI Chat" (412x915) do arquivo Figma
 * "Xiaolee-Mobile". Medidas tiradas do próprio arquivo: cards de ação 62 de
 * altura com gap 10, chips 30 com gap 8, card externo raio 16.
 *
 * O avatar é um frame estático de `xiaolee_standby.mov` — a personagem é
 * animada no produto (ver ACTION_VIDEO_MAP no backend), mas o desenho pede
 * um still e um vídeo em loop aqui custaria bateria por nada.
 */

interface Action {
  key: string;
  Icon: (p: IconProps) => React.ReactElement;
  title: string;
  subtitle: string;
  /** O que é enviado ao agente ao tocar — o card é um atalho de conversa. */
  prompt: string;
}

const ACTIONS: Action[] = [
  {
    key: 'campaign',
    Icon: IconGift,
    title: 'Create a campaign',
    subtitle: 'Reward your community',
    prompt: 'I want to create a campaign to reward my community',
  },
  {
    // Só aparece com a publicação ligada no backend (`SOCIAL_TOOLS_ENABLED`); ver `socialOn`.
    key: 'post',
    Icon: IconShare,
    title: 'Post to your networks',
    subtitle: 'Draft, preview and publish',
    prompt: 'I want to post something on my networks, can you help me?',
  },
  {
    key: 'dashboard',
    Icon: IconActivity,
    title: 'View dashboard',
    subtitle: 'Metrics and activity',
    prompt: 'Show me the dashboard metrics',
  },
  {
    key: 'swap',
    Icon: IconSwap,
    title: 'Make a swap',
    subtitle: 'Exchange tokens by chat',
    prompt: 'I want to make a swap',
  },
  {
    key: 'balance',
    Icon: IconWallet,
    title: 'Check balance',
    subtitle: 'See your wallet funds',
    prompt: 'What is my balance?',
  },
];

const SUGGESTIONS = [
  'What can you do for me?',
  'How do campaigns work?',
  'Show my recent transactions',
];

interface Message {
  id: string;
  author: 'user' | 'xiaolee';
  text: string;
  /** Mesmo formato do web: `toLocaleTimeString` com hora e minuto. */
  time: string;
  /**
   * Transferência que o backend preparou para esta mensagem
   * (`execution.transfer`), quando a intenção era enviar USDC. Vira o botão de
   * autorizar na bolha.
   *
   * Fica na mensagem, e não numa gaveta da tela, porque é dela: a conversa pode
   * seguir com outras mensagens e o botão precisa continuar preso ao resumo que
   * a Xiaolee deu. Some depois de assinado — o mesmo pedido não se assina duas
   * vezes (mesmo acordo do web, `ChatPanel.tsx:181`).
   */
  transfer?: PendingTransfer;
  /** Hash devolvido pela carteira, quando já assinou. */
  txHash?: string;
  /**
   * Resgate que o backend preparou para esta mensagem (`execution.claim`),
   * quando a intenção era resgatar recompensa de campanha (`prepare_campaign_claim`
   * — ver `OrchestrationService`). Mesmo acordo do `transfer`: some depois de
   * resgatado, preso à mensagem que o originou.
   */
  claim?: PendingClaim;
  /** Recibo devolvido pelo backend, quando já resgatou. */
  claimReceiptId?: string;
  /**
   * Swap que o backend preparou (`execution.swap`, tool `arc_swap_prepare`).
   * Mesmo acordo do `transfer`: o botão é da mensagem; quem assina é o usuário.
   */
  swap?: CardSwap;
  /** Hash do swap, quando já assinado, e o quanto o SDK diz que entrou na carteira. */
  swapTxHash?: string;
  swapAmountOut?: string;
  /** Post que o backend preparou (`execution.post`, tool `prepare_social_post`); publica no toque do creator. */
  post?: CardPost;
  /** Métricas do perfil que o backend montou (`execution.insights`, tool `get_social_insights`). */
  insights?: CardInsights;
  /** Formulário de rascunho (`execution.draft`, tool `open_post_draft`) e opções de post (`execution.options`, tool `suggest_post_options`). */
  draft?: CardDraft;
  options?: CardOptions;
  /** Link do post, quando já publicado. */
  postUrl?: string;
  /** `at` da entrada correspondente no histórico local — é por ele que o comprovante é gravado depois de assinar. */
  storedAt?: string;
}

/** O que o usuário vai autorizar: destino e valor, como o backend os preparou. */
interface PendingTransfer {
  to: string;
  amountUsdc: number;
}

/** O que o usuário vai resgatar, como o backend preparou (`prepare_campaign_claim`). */
interface PendingClaim {
  campaignId: number;
  amount: number;
  token: string;
}

/**
 * O recorte de `execution` que interessa aqui. O resto é opaco de propósito.
 *
 * Lê `transfer` e não `evm_tx`: a assinatura é de uma autorização EIP-3009, não
 * de uma transação montada. A calldata que o backend também manda serve ao web,
 * que assina `eth_sendTransaction` porque lá a extensão consegue trocar de rede.
 */
function transferFrom(execution: Record<string, unknown> | undefined): PendingTransfer | undefined {
  if (!execution || execution.status !== 'evm_tx_ready') return undefined;
  const t = execution.transfer as { to?: string; amount_usdc?: number } | undefined;
  if (!t?.to || !t.amount_usdc || t.amount_usdc <= 0) return undefined;
  return { to: t.to, amountUsdc: t.amount_usdc };
}

/**
 * Espelho de `transferFrom` para `prepare_campaign_claim`. Não usamos o
 * `proof_message` que o backend devolve aqui — o `ClaimButton` monta o dele
 * próprio na hora de assinar (mesmo texto, timestamp fresco), exatamente como
 * `campaign-card.tsx` já faz para o claim pela tela de Campaigns.
 */
function claimFrom(execution: Record<string, unknown> | undefined): PendingClaim | undefined {
  if (!execution || execution.status !== 'claim_ready') return undefined;
  const c = execution.claim as { campaign_id?: number; amount?: number; token?: string } | undefined;
  if (!c?.campaign_id || !c.amount || c.amount <= 0 || !c.token) return undefined;
  return { campaignId: c.campaign_id, amount: c.amount, token: c.token };
}

/**
 * `execution.swap` -> cartão de swap, ou `undefined` se não é um swap pronto ou o
 * pedido não passa na mesma validação que o botão usa (tokens da Arc, valor > 0).
 */
function swapFrom(execution: Record<string, unknown> | undefined): CardSwap | undefined {
  if (!execution || execution.status !== 'swap_ready') return undefined;
  const parsed = parseSwapRequest((execution.swap ?? {}) as Record<string, unknown>);
  return parsed.ok ? parsed.request : undefined;
}

/** `execution.post` -> card de publicar, ou `undefined` se não é um post pronto. */
function postFrom(execution: Record<string, unknown> | undefined): CardPost | undefined {
  if (!execution || execution.status !== 'post_ready') return undefined;
  const p = execution.post as { platform?: string; handle?: string; text?: string; clip_id?: number | null } | undefined;
  if (!p?.platform || !p.text) return undefined;
  return { platform: p.platform, handle: p.handle ?? '', text: p.text, ...(p.clip_id != null && { clipId: p.clip_id }) };
}

function now(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Uma mensagem de sessão (backend) para o formato da tela. Ao contrário do
 * web (`ChatPanel.tsx`, que agrupa um par user+bot numa única bolha), aqui
 * `Message` já é por bolha — então não há pareamento a fazer, só mapear.
 */
function messageFromChatSession(
  entry: ChatSessionMessage,
  index: number,
  cards?: ({ at: string } & ChatCards) | undefined,
): Message {
  return {
    id: `s${index}`,
    author: entry.role === 'user' ? 'user' : 'xiaolee',
    text: entry.content,
    time: new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    // O backend só guarda o texto; botões e comprovante vêm do histórico local
    // (`lib/chat-cards.ts`).
    ...(cards && { storedAt: cards.at, transfer: cards.transfer, txHash: cards.txHash, claim: cards.claim, claimReceiptId: cards.claimReceiptId, swap: cards.swap, swapTxHash: cards.swapTxHash, swapAmountOut: cards.swapAmountOut, post: cards.post, postUrl: cards.postUrl, insights: cards.insights, draft: cards.draft, options: cards.options }),
  };
}

/**
 * Reações do rodapé da bolha — no web elas não registram nada, apenas fazem a
 * personagem reagir. É personalidade, não telemetria.
 */
const REACTIONS: { emoji: string; key: AnimationKey; label: string }[] = [
  { emoji: '💕', key: 'xiaolee_love', label: 'Love it!' },
  { emoji: '👏', key: 'xiaolee_cheer', label: 'Cool!' },
  { emoji: '😊', key: 'xiaolee_giggle', label: 'Funny!' },
];

export default function ChatScreen() {
  const styles = useStyles();
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  // Barra de gestos do Android come a margem de baixo do card sem este inset.
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboard();
  const scroller = useRef<ScrollView>(null);
  const wallet = usePrivyWallet();
  const { session, loading: sessionLoading } = useSession();
  // `undefined` enquanto a sessão ainda não foi lida do storage — esperar evita
  // carregar a conversa de convidado por um instante antes de trocar para a da
  // conta, o que piscaria a tela.
  const sessionId = sessionLoading ? undefined : (session?.sessionId ?? null);
  const accountId = session?.twitterUserId;
  // Boas-vindas do 1º clique (XIAOLEEACE-19) — só existe nesta montagem e só
  // no estado inicial: não entra no histórico nem vai para o backend.
  const [welcome, setWelcome] = useState<WelcomeCopy | null>(null);
  // Interesses do onboarding — só reordenam os cards do estado inicial.
  const [interests, setInterests] = useState<string[]>([]);
  // `null` = publicação desligada no backend (404) ou sem sessão: o atalho de postar nem aparece.
  const [social, setSocial] = useState<{ connected: number } | null>(null);
  const { activeChatSessionId } = useChatSession();
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionsAnchor, setSessionsAnchor] = useState<{ top: number; right: number }>();
  const windowWidth = useWindowDimensions().width;
  const newChatRef = useRef<View>(null);
  // Guarda o id de sessão que o próprio `send()` acabou de adotar (ver linha
  // ~359) — quando o efeito abaixo vir essa mesma troca de `activeChatSessionId`,
  // sabe que não veio de uma troca de conversa pelo menu, e sim de uma
  // promoção silenciosa no meio do envio. Nesse caso as `messages` locais já
  // são a verdade (resposta + botões de transfer/claim recém-adicionados) —
  // refazer o fetch aqui sobrescreveria tudo isso com o que o backend tem
  // registrado pra sessão nova, que é só o último par de mensagens, sem os
  // botões (`messageFromChatSession` os omite de propósito). Era essa
  // sobrescrita que apagava os botões de ação reportada no relatório de
  // produto ("não permite ver o chat anterior ao que selecionei").
  const justPromotedSessionRef = useRef<number | null>(null);

  /**
   * Mede o botão na janela para o painel abrir colado nele, não no canto do
   * header global — ele vive dentro do card, não da moldura do `ScreenShell`.
   * Um toque só abre o painel de escolha (New chat vs. conversas antigas);
   * nada é criado sem a pessoa escolher explicitamente lá dentro — botão
   * pequeno demais criando sessão sem querer foi exatamente o problema do
   * desenho anterior (botão dividido, ação instantânea).
   */
  function handleOpenChatMenu() {
    if (sessionsOpen) {
      setSessionsOpen(false);
      return;
    }
    newChatRef.current?.measureInWindow((x, y, width, height) => {
      setSessionsAnchor({ top: y + height + 6, right: windowWidth - (x + width) });
      setSessionsOpen(true);
    });
  }

  /**
   * Repõe a conversa: se há uma sessão de chat ativa (`lib/chat-session.ts`),
   * o histórico daquela thread vem do backend — trocar de sessão é trocar de
   * conversa, então substitui em vez de mesclar. Sem sessão ativa (toda
   * abertura do app, ou troca de conta), o chat começa limpo, no estado
   * inicial: reabrir direto na última conversa confundia quem chegava para
   * algo novo e escondia os atalhos e a boas-vindas do 1º clique. A conversa
   * anterior não se perde — segue no painel de sessões e na tela de
   * Histórico (`lib/chat-history.ts`, que `send()` continua alimentando).
   *
   * A limpeza é feita no render, e não no efeito, ao mudar de chave — o
   * padrão do React para "resetar estado quando uma prop muda".
   */
  const freshChatKey = activeChatSessionId === null ? `fresh:${sessionId}` : null;
  const [lastFreshChatKey, setLastFreshChatKey] = useState(freshChatKey);
  if (freshChatKey !== lastFreshChatKey) {
    setLastFreshChatKey(freshChatKey);
    if (freshChatKey !== null) setMessages([]);
  }

  useEffect(() => {
    if (activeChatSessionId === null) return;
    if (justPromotedSessionRef.current === activeChatSessionId) {
      justPromotedSessionRef.current = null;
      return;
    }
    let active = true;
    Promise.all([getChatSessionMessages(activeChatSessionId), loadChatHistory()])
      .then(([history, stored]) => {
        const cards = matchCards(history, stored);
        if (active) setMessages(history.map((entry, i) => messageFromChatSession(entry, i, cards[i])));
      })
      .catch((error) => {
        // 404: a sessão não é desta conta (troca de conta, ou o token sendo
        // renovado no meio do caminho) ou não existe mais — volta para uma
        // conversa nova em vez de ficar presa nela. Falha de rede mantém a
        // tela como está: a sessão continua válida, só não deu para ler agora.
        if (active && error instanceof ApiError && error.status === 404) {
          setActiveChatSessionId(null);
        }
      });
    return () => {
      active = false;
    };
  }, [activeChatSessionId]);

  /**
   * Onboarding obrigatório no 1º acesso — relatório de produto, "ao logar,
   * seria importante ter um questionário". `onboarded` vem calculado do
   * backend (nome + ao menos um interesse, ver `_profile_dict`); sem conta
   * (`sessionId` nulo/undefined) não há perfil a checar, e convidado segue
   * reto para o chat como sempre.
   *
   * Já onboarded, o mesmo perfil alimenta a boas-vindas do 1º clique
   * (XIAOLEEACE-19): aparece em toda abertura até a conta mandar a primeira
   * mensagem (ver `send()`) — só aí conta como vista. Marcar ao exibir perdia
   * a boas-vindas de quem fechava o app antes de ler.
   */
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    getMyProfile()
      .then(async (profile) => {
        if (!active) return;
        if (!profile.onboarded) {
          router.replace('/onboarding');
          return;
        }
        setInterests(profile.interest_profile);
        if (!accountId || (await hasSeenWelcome(accountId)) || !active) return;
        setWelcome(buildWelcomeCopy(profile));
        avatarAnimation.play('xiaolee_hello');
      })
      .catch(() => {
        // Sem backend/sessão válida — não bloqueia o chat por causa disto.
      });
    return () => {
      active = false;
    };
  }, [sessionId, accountId, router]);

  // A publicação é opcional (flag no backend): se a lista de contas responde, o atalho de postar aparece.
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    listSocialAccounts()
      .then((res) => active && setSocial({ connected: res.accounts.length }))
      .catch(() => active && setSocial(null));
    return () => {
      active = false;
    };
  }, [sessionId]);

  /**
   * Troca o botão pelo hash na mensagem que foi assinada.
   *
   * `transfer` fica — quem impede assinar o mesmo pedido duas vezes é o
   * `txHash` (o `SignTxButton` já sai cedo quando ele existe). Mantém o
   * `transfer.to` vivo depois de assinado, pra continuar mostrando o
   * endereço de destino clicável no lugar do botão.
   */
  function markSigned(id: string, hash: string) {
    const storedAt = messages.find((m) => m.id === id)?.storedAt;
    if (storedAt) void updateChatMessage(storedAt, { txHash: hash });
    setMessages((current) =>
      current.map((m) => (m.id === id ? { ...m, txHash: hash } : m)),
    );
  }

  /** Mesmo acordo de `markSigned`, para o botão de claim. */
  function markClaimed(id: string, receiptId: string) {
    const storedAt = messages.find((m) => m.id === id)?.storedAt;
    if (storedAt) void updateChatMessage(storedAt, { claimReceiptId: receiptId });
    setMessages((current) =>
      current.map((m) => (m.id === id ? { ...m, claimReceiptId: receiptId } : m)),
    );
  }

  /** Mesmo acordo de `markSigned`, para o botão de publicar. */
  function markPosted(id: string, url: string) {
    avatarAnimation.play('xiaolee_cheer');
    const storedAt = messages.find((m) => m.id === id)?.storedAt;
    if (storedAt) void updateChatMessage(storedAt, { postUrl: url });
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, postUrl: url } : m)));
  }

  /** O creator escolheu uma das opções: ela vira a prévia editável (nada é postado aqui). */
  function choosePost(id: string, text: string) {
    const m = messages.find((x) => x.id === id);
    if (!m?.options) return;
    const post: CardPost = { platform: m.options.platform, handle: m.options.handle, text };
    if (m.storedAt) void updateChatMessage(m.storedAt, { post });
    setMessages((current) => current.map((x) => (x.id === id ? { ...x, post } : x)));
  }

  /** Mesmo acordo de `markSigned`, para o botão de swap. */
  function markSwapped(id: string, hash: string, amountOut?: string) {
    const storedAt = messages.find((m) => m.id === id)?.storedAt;
    if (storedAt) void updateChatMessage(storedAt, { swapTxHash: hash, swapAmountOut: amountOut });
    setMessages((current) =>
      current.map((m) => (m.id === id ? { ...m, swapTxHash: hash, swapAmountOut: amountOut } : m)),
    );
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;

    setDraft('');
    setSending(true);
    setMessages((current) => [
      ...current,
      { id: `u${Date.now()}`, author: 'user', text: message, time: now() },
    ]);
    // Fora do estado da tela, de propósito: o backend nunca grava conversa
    // (`campaigns_routes.py:557` devolve `chat_history` vazio fixo), então sem
    // isto a tela de Histórico não teria o que mostrar — mesmo acordo do web,
    // que grava no `localStorage` em vez de esperar o backend (`lib/chat-history.ts`).
    // Nunca rejeita, então não precisa de `catch` aqui.
    appendChatMessage('user', message);
    // 1ª interação de verdade: a boas-vindas cumpriu o papel e não volta.
    if (welcome && accountId) void markWelcomeSeen(accountId);
    // Enquanto pensa, a personagem pensa junto.
    avatarAnimation.play('xiaolee_thinklow');

    try {
      // Mesmo contexto que o web manda em cada mensagem: sem isso o agente
      // não sabe qual carteira consultar e responde "conecte sua carteira".
      //
      // A carteira embutida viva do Privy vem primeiro, e o SecureStore é só o
      // fallback de quando o app reabre antes de o Privy restabelecer a sessão
      // (o endereço já foi gravado da última vez).
      const stored = await getWallet();
      const activeWallet = wallet.address
        ? { address: wallet.address, chain: wallet.chain ?? 'arc' }
        : stored;
      const result = await sendChatMessage({
        message,
        ...(activeWallet && { wallet_address: activeWallet.address, wallet_chain: activeWallet.chain }),
        ...(activeChatSessionId !== null && { session_id: activeChatSessionId }),
      });
      const reply =
        result.response?.[0]?.content?.trim() || 'Não consegui formular uma resposta agora.';

      // Primeira mensagem de uma conversa nova: o backend acabou de criar a
      // sessão — adota o id devolvido para o painel passar a listá-la.
      if (activeChatSessionId === null && result.session_id) {
        justPromotedSessionRef.current = result.session_id;
        setActiveChatSessionId(result.session_id);
      }
      void refreshChatSessions();

      const transfer = transferFrom(result.execution);
      const claim = claimFrom(result.execution);
      const swap = swapFrom(result.execution);
      const post = postFrom(result.execution);
      const insights = insightsFrom(result.execution);
      const draft = draftFrom(result.execution);
      const options = optionsFrom(result.execution);
      const storedAt = new Date().toISOString();
      setMessages((current) => [
        ...current,
        { id: `x${Date.now()}`, author: 'xiaolee', text: reply, time: now(), transfer, claim, swap, post, insights, draft, options, storedAt },
      ]);
      // O texto gravado é o mesmo que foi para a bolha, fallback incluído —
      // o histórico não deve divergir do que a tela mostrou. Os cards vão junto:
      // é o que os traz de volta quando a conversa é reaberta.
      appendChatMessage('assistant', reply, { at: storedAt, cards: { transfer, claim, swap, post, insights, draft, options } });

      // O agente escolhe a emoção; nome desconhecido volta para o idle.
      const animation = animationFromBackend(result.animations);
      if (animation) avatarAnimation.play(animation);
      else avatarAnimation.expressionEnded();
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : String(error);
      setMessages((current) => [
        ...current,
        { id: `e${Date.now()}`, author: 'xiaolee', text: detail, time: now() },
      ]);
      // O web também grava o texto de erro (`ChatPanel.tsx:256`) — uma
      // conversa que travou continua sendo conversa.
      appendChatMessage('assistant', detail);
      avatarAnimation.play('xiaolee_ouch');
    } finally {
      setSending(false);
    }
  }

  const empty = messages.length === 0;
  const actions = prioritizeActions(
    ACTIONS.filter((action) => action.key !== 'post' || social).map((action) => action.key),
    interests,
  ).map((key) => ACTIONS.find((action) => action.key === key)!);

  return (
    <ScreenShell>
      <KeyboardAvoidingView
        style={styles.flex}
        /**
         * `padding` nas duas plataformas — no Android também, apesar de a doc
         * da Expo mandar passar `undefined` lá.
         *
         * Aquele conselho é anterior ao edge-to-edge. Com `undefined` o
         * componente cai no `default` do `render()` e devolve uma `View` comum
         * (`KeyboardAvoidingView.js:286`): ele calcula a altura do teclado e
         * não aplica em nada. Quem levantava o composer era o SO encolhendo a
         * janela por `adjustResize`. Desde o SDK 54 o edge-to-edge é
         * obrigatório e a janela não encolhe mais — o app desenha atrás do
         * teclado, então o rodapé ficava coberto.
         *
         * O ramo `padding` não depende disso: ele mede pelo `endCoordinates` do
         * evento `keyboardDidShow`, que o Android continua emitindo.
         *
         * Sem `keyboardVerticalOffset` de propósito: a conta do componente
         * mistura o `y` do layout com o `screenY` do teclado, o que só fecha se
         * a raiz React começar no topo da tela — e começa, porque esta tela roda
         * com `headerShown: false` (ver `_layout.tsx`) e o header é nosso.
         */
        behavior="padding"
      >
        {/* O inset de baixo só vale com o teclado fechado. Ele existe para o
            card não encostar na barra de gestos — mas o teclado cobre essa
            barra, e aí o `insets.bottom` deixa de proteger de alguma coisa e
            vira folga entre o composer e as teclas (no iOS somada à altura do
            teclado, que o `KeyboardAvoidingView` já empurrou). */}
        <View
          style={[
            styles.card,
            { marginBottom: Spacing.three - 4 + (keyboard.visible ? 0 : insets.bottom) },
          ]}
        >
          {/* Na conversa o hero some, então a personagem passa a viver aqui —
              sempre há exatamente uma avatar animada, e as reações têm onde
              acontecer. */}
          <AssistantHeader
            animated={!empty}
            onPressChatMenu={handleOpenChatMenu}
            chatMenuRef={newChatRef}
          />

          <ScrollView
            ref={scroller}
            contentContainerStyle={empty ? styles.body : styles.thread}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
          >
            {empty ? (
              <>
                {/* Animado só aqui. O avatar de 40dp do header ficaria com um
                    segundo decoder na mesma tela por ganho quase nulo. */}
                <AnimatedAvatar size={104} />

                {welcome ? (
                  <View style={[styles.bubble, styles.bubbleXiaolee, styles.welcome]}>
                    <Text style={styles.welcomeTitle}>{welcome.title}</Text>
                    <Text style={styles.bubbleText}>{welcome.body}</Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.greeting}>Hi! I&apos;m Xiaolee ✨</Text>
                    <Text style={styles.pitch}>
                      Swaps, campaigns and payments — all by message. What would you like to do?
                    </Text>
                  </>
                )}

                {social?.connected === 0 ? (
                  <Pressable
                    onPress={() => router.push('/accounts')}
                    style={({ pressed }) => [styles.startCard, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Start posting. Step 1, connect a network. Step 2, ask Xiaolee for a post."
                  >
                    <Text style={styles.startTitle}>Start posting in 2 steps</Text>
                    <Text style={styles.startStep}>1. Connect X, Telegram or Bluesky. Tap here.</Text>
                    <Text style={styles.startStep}>2. Tell me your idea. I write it, you check it, you tap to post.</Text>
                    <Text style={styles.startNote}>I never post without your tap.</Text>
                  </Pressable>
                ) : null}

                <View style={styles.actions}>
                  {actions.map((action) => (
                    <ActionCard
                      key={action.key}
                      action={action}
                      // Sem rede conectada não há o que rascunhar: leva direto a Contas.
                      onPress={() => (action.key === 'post' && social?.connected === 0 ? router.push('/accounts') : send(action.prompt))}
                    />
                  ))}
                </View>

                <View style={styles.suggestions}>
                  {(social?.connected ? [...SUGGESTIONS, 'Help me write a post'] : SUGGESTIONS).map((text) => (
                    <Suggestion key={text} text={text} onPress={() => send(text)} />
                  ))}
                </View>
              </>
            ) : (
              <>
                {messages.map((message) => (
                  <Bubble
                    key={message.id}
                    message={message}
                    onSigned={markSigned}
                    onClaimed={markClaimed}
                    onSwapped={markSwapped}
                    onPosted={markPosted}
                    onAsk={(text) => void send(text)}
                    onPick={choosePost}
                  />
                ))}
                {sending ? <Typing /> : null}
              </>
            )}
          </ScrollView>

          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => send(draft)}
            sending={sending}
          />
        </View>
      </KeyboardAvoidingView>

      {/* Fora do card (que corta overflow) para o painel poder flutuar por
          cima da lista de mensagens, como o dropdown do web. */}
      <SessionsPanel
        visible={sessionsOpen}
        onDismiss={() => setSessionsOpen(false)}
        anchor={sessionsAnchor}
      />
    </ScreenShell>
  );
}

/**
 * Bolha de mensagem — mesma anatomia do `ChatPanel.tsx` do web: canto da
 * "cauda" reduzido do lado de quem fala, largura máxima de 85%, e um rodapé
 * com autor e horário. Na fala da Xiaolee, avatar à esquerda e as reações.
 */
/**
 * Botão de assinar dentro da bolha — espelho do que o web mostra quando o
 * backend devolve `evm_tx` (`ChatPanel.tsx:333`).
 *
 * Fica na bolha, não num rodapé fixo: o resumo que a Xiaolee escreveu (valor,
 * destino, rede) é o contexto do que se está assinando, e separar os dois faria
 * o usuário assinar um número que não está vendo.
 */
function SignTxButton({
  message,
  onSigned,
}: {
  message: Message;
  onSigned: (id: string, hash: string) => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const { isConnected, signAndRelay } = usePrivyWallet();
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string>();

  if (message.txHash) {
    // O relay devolve o hash real da transação EVM — sempre linkável, ao
    // contrário do `related_signature` do Helius (Solana) que aparece em
    // Transactions. `isOnChainTx` é só uma segunda trava, não um caso
    // esperado de falha.
    const linkable = isOnChainTx(message.txHash);
    const badge = (
      <View style={styles.txDone}>
        <IconCheck size={14} color={colors.success} />
        <Text style={styles.txDoneText}>Sent · {shortHash(message.txHash)}</Text>
      </View>
    );

    if (!linkable) return badge;

    return (
      <Pressable
        onPress={() => WebBrowser.openBrowserAsync(txExplorerUrl(message.txHash!)).catch(() => {})}
        style={({ pressed }) => pressed && styles.pressed}
        accessibilityRole="link"
        accessibilityLabel={`Sent ${shortHash(message.txHash)} — open the transaction in the Arc explorer`}
      >
        {badge}
      </Pressable>
    );
  }

  if (!isConnected) {
    return <Text style={styles.txHint}>Connect a wallet to sign this transfer.</Text>;
  }

  async function sign() {
    if (!message.transfer) return;
    setSigning(true);
    setError(undefined);
    try {
      const { to, amountUsdc } = message.transfer;
      onSigned(message.id, await signAndRelay(to, amountUsdc));
      // A recompensa visual do "deu certo" — mesma personagem que já reage a
      // tudo no chat, não uma animação nova só pra isto.
      avatarAnimation.play('xiaolee_cheer');
    } catch (err) {
      // Erro de carteira vem como `{code, message}` puro, não Error — por isso
      // não dá para usar `instanceof` aqui.
      const detail =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setError(detail);
    } finally {
      setSigning(false);
    }
  }

  return (
    <>
      <Pressable
        onPress={sign}
        disabled={signing}
        style={({ pressed }) => [styles.signButton, pressed && styles.signButtonPressed]}
        accessibilityRole="button"
      >
        {signing ? (
          <ActivityIndicator size="small" color={colors.onAccent} />
        ) : (
          <>
            <IconWallet size={15} color={colors.onAccent} />
            <Text style={styles.signButtonText}>Sign in wallet</Text>
          </>
        )}
      </Pressable>
      {error ? <Text style={styles.txError}>{error}</Text> : null}
    </>
  );
}

/**
 * Espelho de `SignTxButton` para o resgate de campanha (`prepare_campaign_claim`
 * no backend). A prova é montada aqui, com timestamp fresco, e não a que veio
 * em `execution.claim` — mesmo texto e mesma regra que `campaign-card.tsx` já
 * usa para o claim pela tela de Campaigns; `_verify_claim_proof` só confere o
 * prefixo, então o `|ts:...` no fim não importa pra validação.
 */
function ClaimButton({
  message,
  onClaimed,
}: {
  message: Message;
  onClaimed: (id: string, receiptId: string) => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const { address, signMessage } = usePrivyWallet();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string>();

  if (message.claimReceiptId) {
    return (
      <View style={styles.txDone}>
        <IconCheck size={14} color={colors.success} />
        <Text style={styles.txDoneText}>
          Claimed{message.claim ? ` · ${message.claim.amount} ${message.claim.token}` : ''}
        </Text>
      </View>
    );
  }

  if (!address) {
    return <Text style={styles.txHint}>Connect a wallet to claim this reward.</Text>;
  }
  // Recaptura o valor já narrowed acima: TS não propaga a checagem de
  // `address` para dentro de `claim()`, uma function declaration à parte.
  const walletAddress = address;

  async function claim() {
    if (!message.claim) return;
    setClaiming(true);
    setError(undefined);
    try {
      const session = await getSessionToken();
      if (!session) throw new Error('Connect a wallet to claim.');
      const proofMessage =
        `XiaoLee claim|campaign:${message.claim.campaignId}|` +
        `session:${session}|wallet:${walletAddress}|ts:${Date.now()}`;
      const signature = await signMessage(proofMessage);
      const result = await claimCampaignReward(
        message.claim.campaignId, walletAddress, proofMessage, signature,
      );
      onClaimed(message.id, result.receiptId ?? 'claimed');
      avatarAnimation.play('xiaolee_cheer');
    } catch (err) {
      const detail =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err);
      setError(detail);
    } finally {
      setClaiming(false);
    }
  }

  return (
    <>
      <Pressable
        onPress={claim}
        disabled={claiming}
        style={({ pressed }) => [styles.signButton, pressed && styles.signButtonPressed]}
        accessibilityRole="button"
      >
        {claiming ? (
          <ActivityIndicator size="small" color={colors.onAccent} />
        ) : (
          <>
            <IconGift size={15} color={colors.onAccent} />
            <Text style={styles.signButtonText}>
              Claim {message.claim?.amount} {message.claim?.token}
            </Text>
          </>
        )}
      </Pressable>
      {error ? <Text style={styles.txError}>{error}</Text> : null}
    </>
  );
}

/** "1.259119" -> "1.259119", "1.2000000" -> "1.2": só para exibir. */
function fmtAmount(value: string | undefined): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 6 }) : String(value ?? '');
}

/**
 * Swap na Arc (`arc_swap_prepare`): mostra a cotação do App Kit e só então libera
 * o botão — o usuário sempre vê o que vai receber (e o piso do slippage) antes de
 * assinar. Quem executa é a carteira dele, aqui; o backend só preparou o pedido.
 */
function SwapButton({
  message,
  onSwapped,
}: {
  message: Message;
  onSwapped: (id: string, hash: string, amountOut?: string) => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const { isConnected, estimateSwap, swap: runSwap } = usePrivyWallet();
  // Um estado só, indexado pela cotação pedida: a "atual" é derivada (só vale se a chave bate),
  // então trocar de pedido ou tentar de novo volta a "carregando" sem setState dentro do efeito.
  const [result, setResult] = useState<{
    key: string;
    quote?: { estimatedOut: string; minimumOut: string };
    error?: string;
  }>();
  const [attempt, setAttempt] = useState(0);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string>();
  // Revalida mesmo vindo do histórico local: o que assina nunca é um valor cru do armazenamento.
  const parsed = message.swap ? parseSwapRequest(message.swap) : undefined;
  const request = parsed?.ok ? parsed.request : undefined;
  const done = Boolean(message.swapTxHash);
  const key = request ? `${request.tokenIn}|${request.tokenOut}|${request.amountIn}|${attempt}` : '';
  const current = result?.key === key ? result : undefined;
  const quote = current?.quote;
  const quoteError = current?.error;

  useEffect(() => {
    if (!request || done || !isConnected) return;
    let active = true;
    estimateSwap(request)
      .then((q) => active && setResult({ key, quote: q }))
      .catch((err) => active && setResult({ key, error: errorText(err) }));
    return () => {
      active = false;
    };
    // `estimateSwap` muda a cada render do provider; re-cotar por isso seria um loop.
    // Só reage ao pedido (via `key`), a estar conectado/pendente e a "tentar de novo".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, done, isConnected]);

  if (!request) return null;

  if (message.swapTxHash) {
    const linkable = isOnChainTx(message.swapTxHash);
    const badge = (
      <View style={styles.txDone}>
        <IconCheck size={14} color={colors.success} />
        <Text style={styles.txDoneText}>
          Swapped · {shortHash(message.swapTxHash)}
          {message.swapAmountOut ? ` · +${fmtAmount(message.swapAmountOut)} ${request.tokenOut}` : ''}
        </Text>
      </View>
    );
    if (!linkable) return badge;
    return (
      <Pressable
        onPress={() => WebBrowser.openBrowserAsync(txExplorerUrl(message.swapTxHash!)).catch(() => {})}
        style={({ pressed }) => pressed && styles.pressed}
        accessibilityRole="link"
        accessibilityLabel={`Swapped ${shortHash(message.swapTxHash)} — open the transaction in the Arc explorer`}
      >
        {badge}
      </Pressable>
    );
  }

  if (!isConnected) return <Text style={styles.txHint}>Connect a wallet to swap.</Text>;

  async function run() {
    if (!request) return;
    setSwapping(true);
    setError(undefined);
    try {
      const receipt = await runSwap(request);
      onSwapped(message.id, receipt.txHash, receipt.amountOut);
      avatarAnimation.play('xiaolee_cheer');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSwapping(false);
    }
  }

  return (
    <>
      <Text style={styles.txHint}>
        {fmtAmount(request.amountIn)} {request.tokenIn} →{' '}
        {quote
          ? `≈ ${fmtAmount(quote.estimatedOut)} ${request.tokenOut} (min ${fmtAmount(quote.minimumOut)})`
          : quoteError
            ? request.tokenOut
            : `${request.tokenOut} · getting quote…`}
      </Text>
      {quoteError ? (
        <Pressable onPress={() => setAttempt((n) => n + 1)} accessibilityRole="button">
          <Text style={styles.txError}>{quoteError} — tap to retry</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={run}
        disabled={swapping || !quote}
        style={({ pressed }) => [styles.signButton, (!quote || swapping) && styles.signButtonDisabled, pressed && styles.signButtonPressed]}
        accessibilityRole="button"
      >
        {swapping ? (
          <ActivityIndicator size="small" color={colors.onAccent} />
        ) : (
          <>
            <IconWallet size={15} color={colors.onAccent} />
            <Text style={styles.signButtonText}>
              Swap {request.tokenIn} → {request.tokenOut}
            </Text>
          </>
        )}
      </Pressable>
      {error ? <Text style={styles.txError}>{error}</Text> : null}
    </>
  );
}

/** Erro de carteira vem como `{code, message}` puro, não Error — por isso não dá para usar `instanceof`. */
function errorText(err: unknown): string {
  return err && typeof err === 'object' && 'message' in err
    ? String((err as { message: unknown }).message)
    : String(err);
}

function Bubble({
  message,
  onSigned,
  onClaimed,
  onSwapped,
  onPosted,
  onAsk,
  onPick,
}: {
  message: Message;
  onSigned: (id: string, hash: string) => void;
  onClaimed: (id: string, receiptId: string) => void;
  onSwapped: (id: string, hash: string, amountOut?: string) => void;
  onPosted: (id: string, url: string) => void;
  onAsk: (text: string) => void;
  onPick: (id: string, text: string) => void;
}) {
  const styles = useStyles();
  const mine = message.author === 'user';

  if (mine) {
    return (
      <View style={styles.rowUser}>
        <View style={styles.bubbleWrap}>
          <View style={[styles.bubble, styles.bubbleUser]}>
            <Text style={styles.bubbleTextUser}>{message.text}</Text>
          </View>
          {/* Separador só quando há hora, como no web — sem isso sobra um
              "You ·" pendurado se a mensagem vier sem timestamp. */}
          <Text style={styles.metaRight}>You{message.time ? ` · ${message.time}` : ''}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.rowXiaolee}>
      <Image
        source={require('../../assets/images/xiaolee-avatar.png')}
        style={styles.msgAvatar}
        contentFit="cover"
      />
      <View style={styles.bubbleWrap}>
        <View style={[styles.bubble, styles.bubbleXiaolee]}>
          <Text style={styles.bubbleText}>{message.text}</Text>
          {message.transfer || message.txHash ? (
            <SignTxButton message={message} onSigned={onSigned} />
          ) : null}
          {message.claim || message.claimReceiptId ? (
            <ClaimButton message={message} onClaimed={onClaimed} />
          ) : null}
          {message.swap ? <SwapButton message={message} onSwapped={onSwapped} /> : null}
          {message.post ? (
            <PostPreview post={message.post} postedUrl={message.postUrl} onPosted={(url) => onPosted(message.id, url)} />
          ) : null}
          {message.insights ? <InsightsCard insights={message.insights} /> : null}
          {message.draft ? <PostDraftCard draft={message.draft} onAsk={onAsk} /> : null}
          {message.options && !message.post ? (
            <PostOptions options={message.options} onPick={(text) => onPick(message.id, text)} />
          ) : null}
        </View>
        <View style={styles.meta}>
          <Text style={styles.metaText}>Xiaolee{message.time ? ` · ${message.time}` : ''}</Text>
          <View style={styles.reactions}>
            {REACTIONS.map(({ emoji, key, label }) => (
              <Pressable
                key={emoji}
                onPress={() => avatarAnimation.play(key)}
                accessibilityRole="button"
                accessibilityLabel={label}
                hitSlop={Spacing.two}
              >
                <Text style={styles.reaction}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

/** Três pontos enquanto o agente responde, como no web (sem rodapé). */
function Typing() {
  const styles = useStyles();
  return (
    <View style={styles.rowXiaolee}>
      {/* Sem o deslocamento das mensagens normais: aqui não há rodapé de
          horário para compensar, e o offset deixaria o avatar solto acima. */}
      <Image
        source={require('../../assets/images/xiaolee-avatar.png')}
        style={[styles.msgAvatar, styles.msgAvatarTyping]}
        contentFit="cover"
      />
      <View style={[styles.bubble, styles.bubbleXiaolee, styles.typing]}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.dot} />
        ))}
      </View>
    </View>
  );
}

/** Faixa de identidade do assistente, fixa no topo do card. */
function AssistantHeader({
  animated,
  onPressChatMenu,
  chatMenuRef,
}: {
  animated: boolean;
  onPressChatMenu: () => void;
  chatMenuRef: RefObject<View | null>;
}) {
  const colors = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.assistant}>
      <View>
        {animated ? (
          <AnimatedAvatar size={40} />
        ) : (
          <Image
            source={require('../../assets/images/xiaolee-avatar.png')}
            style={styles.assistantAvatar}
            contentFit="cover"
          />
        )}
        <View style={styles.onlineDot} />
      </View>

      <View style={styles.flex}>
        <View style={styles.assistantNameRow}>
          <Text style={styles.assistantName}>Xiaolee</Text>
          <View style={styles.onlineDotSmall} />
          <Text style={styles.onlineLabel}>ONLINE</Text>
        </View>
        <Text style={styles.assistantRole}>Your intelligent DeFi assistant</Text>
      </View>

      {/* Um botão só, com rótulo por extenso — a versão dividida (ação
          instantânea + chevron minúsculo) criava sessão à toa quando o toque
          errava o alvo pequeno. Este abre um painel onde a escolha entre
          "New chat" e uma conversa antiga é sempre explícita. */}
      <Pressable
        ref={chatMenuRef}
        onPress={onPressChatMenu}
        hitSlop={Spacing.two}
        style={({ pressed }) => [styles.newChat, pressed && styles.newChatPressed]}
        accessibilityRole="button"
        accessibilityLabel="New chat"
      >
        <IconEdit size={13} sw={2.2} color={colors.ink} />
        <Text style={styles.newChatText}>New chat</Text>
      </Pressable>
    </View>
  );
}

function ActionCard({
  action: { Icon, title, subtitle },
  onPress,
}: {
  action: Action;
  onPress: () => void;
}) {
  const colors = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View style={styles.actionIcon}>
        <Icon size={20} color={colors.accent} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSubtitle}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

function Suggestion({ text, onPress }: { text: string; onPress: () => void }) {
  const colors = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <IconChat size={12} color={colors.ink2} />
      <Text style={styles.chipText}>{text}</Text>
    </Pressable>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  sending,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  /** O agente está respondendo — diferente de "não há o que enviar". */
  sending: boolean;
}) {
  const colors = useTheme();
  const styles = useStyles();
  const canSend = value.trim().length > 0 && !sending;

  return (
    <View style={styles.composer}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Ask Xiaolee anything…"
        placeholderTextColor={colors.ink3}
        style={styles.input}
        multiline
        maxLength={2000}
        editable={!sending}
        /**
         * Sem isto o `onSubmitEditing` abaixo é prop morta: num campo
         * `multiline` o RN resolve `submitBehavior` para `'newline'`
         * (`TextInput.js:567`), então a tecla de retorno insere quebra de linha
         * e o handler nunca dispara — era o caso aqui.
         *
         * `'submit'` e não `'blurAndSubmit'`: envia **sem** tirar o foco, então
         * dá para emendar a próxima mensagem sem reabrir o teclado. O texto
         * ainda quebra sozinho e o campo cresce até `maxHeight`; o que se perde
         * é a quebra manual, que num chat com o agente quase não aparece.
         */
        submitBehavior="submit"
        // A tecla passa a se chamar "send" — ela envia, então deve dizer isso.
        returnKeyType="send"
        onSubmitEditing={onSend}
      />
      <Pressable
        onPress={onSend}
        disabled={!canSend}
        style={({ pressed }) => [
          styles.sendButton,
          // Esmaece só quando não há o que enviar. Enquanto o agente responde o
          // botão fica cheio com o spinner: esmaecido ele leria como desligado,
          // e não é isso — está trabalhando.
          !canSend && !sending && styles.sendButtonIdle,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={sending ? 'Sending' : 'Send'}
        accessibilityState={{ disabled: !canSend, busy: sending }}
      >
        {/* A resposta depende de uma chamada a LLM, com timeout de 60s
            (`api/backend.ts`). Um botão parado nesse intervalo não distingue
            "mandei" de "não pegou". */}
        {sending ? (
          <ActivityIndicator size="small" color={colors.onAccent} />
        ) : (
          <IconSend size={18} color={colors.onAccent} />
        )}
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },

  card: {
    flex: 1,
    margin: Spacing.three - 4,
    borderRadius: Radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    ...CardShadow,
  },

  // ── Faixa do assistente ────────────────────────────────────────────────
  assistant: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingHorizontal: Spacing.three - 3,
    paddingVertical: Spacing.two + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  assistantAvatar: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: colors.bg,
  },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: Radius.pill,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.card,
  },
  assistantNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  assistantName: { fontFamily: Fonts.bold, fontSize: 14, color: colors.ink },
  onlineDotSmall: {
    width: 6,
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: colors.success,
  },
  onlineLabel: {
    fontFamily: Fonts.bold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.success,
  },
  assistantRole: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink2, marginTop: 1 },
  // Alvo visual menor que o primeiro rascunho, mas o `hitSlop` no Pressable
  // (ver abaixo) mantém a área de toque real confortável — o desenho anterior
  // (chevron de 20dp isolado, sem hitSlop) era pequeno demais e criava sessão
  // sem querer quando o toque errava o alvo.
  //
  // Fundo branco + borda, não accent sólido: a regra do design system é
  // "acento só em botão primário/destaque, resto neutro" (`theme.ts`) — rosa
  // chapado numa faixa de identidade (que já não é um CTA) chamava atenção
  // demais.
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    paddingHorizontal: 11,
    borderRadius: Radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  newChatPressed: { opacity: 0.6 },
  newChatText: { fontFamily: Fonts.bold, fontSize: 12, color: colors.ink },

  // ── Corpo ──────────────────────────────────────────────────────────────
  body: {
    paddingHorizontal: Spacing.four + 3,
    paddingTop: Spacing.four + 6,
    paddingBottom: Spacing.four,
    alignItems: 'center',
  },
  hero: {
    width: 104,
    height: 104,
    borderRadius: Radius.pill,
    backgroundColor: colors.bg,
  },
  greeting: {
    fontFamily: Fonts.bold,
    fontSize: 16,
    color: colors.ink,
    marginTop: Spacing.three,
  },
  pitch: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 23,
    color: colors.ink2,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  // Sem cauda: a avatar fica acima e centralizada, não ao lado da bolha.
  welcome: {
    alignSelf: 'stretch',
    marginTop: Spacing.three,
    gap: Spacing.one,
    borderBottomLeftRadius: Radius.lg,
  },
  welcomeTitle: { fontFamily: Fonts.bold, fontSize: 15, color: colors.ink },

  // ── Conversa ───────────────────────────────────────────────────────────
  thread: {
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: Spacing.three,
    gap: Spacing.three - 4,
  },
  rowUser: { flexDirection: 'row', justifyContent: 'flex-end' },
  rowXiaolee: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  bubbleWrap: { maxWidth: '85%' },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    backgroundColor: colors.bg,
    // Sobe o avatar a altura do rodapé (10px + marginTop 4) para o alinhamento
    // ser com a base da bolha, não com a base da linha inteira.
    marginBottom: 18,
  },
  /** Linha de digitando não tem rodapé, então nada a compensar. */
  msgAvatarTyping: { marginBottom: 0 },
  bubble: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    borderRadius: Radius.lg,
    ...CardShadow,
  },
  // Canto da "cauda" reduzido do lado de quem fala, como no web.
  bubbleUser: {
    backgroundColor: colors.accentFill,
    borderBottomRightRadius: Radius.sm - 2,
  },
  bubbleXiaolee: {
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderBottomLeftRadius: Radius.sm - 2,
  },
  bubbleText: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 21, color: colors.ink2 },

  // Assinatura de transação dentro da bolha.
  signButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two - 2,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: colors.accentFill,
    marginTop: Spacing.two,
  },
  signButtonPressed: { opacity: 0.7 },
  signButtonDisabled: { opacity: 0.5 },
  signButtonText: { fontFamily: Fonts.bold, fontSize: 13, color: colors.onAccent },
  txDone: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two - 2,
    borderRadius: Radius.md,
    backgroundColor: colors.successSoft,
    marginTop: Spacing.two,
  },
  txDoneText: { fontFamily: Fonts.medium, fontSize: 12, color: colors.ink },
  txHint: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: colors.ink3,
    marginTop: Spacing.two - 2,
  },
  txError: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: colors.danger,
    marginTop: Spacing.one,
  },
  bubbleTextUser: {
    fontFamily: Fonts.medium,
    fontSize: 14,
    lineHeight: 21,
    color: colors.onAccent,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.one,
  },
  metaText: { fontFamily: Fonts.sans, fontSize: 10, color: colors.ink3 },
  metaRight: {
    fontFamily: Fonts.sans,
    fontSize: 10,
    color: colors.ink3,
    textAlign: 'right',
    marginTop: Spacing.one,
    paddingRight: Spacing.one,
  },
  reactions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  // Meia opacidade como no web — presentes, mas sem competir com o texto.
  reaction: { fontSize: 12, opacity: 0.5 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 1 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: colors.accentFill,
    opacity: 0.6,
  },

  // ── Cards de ação ──────────────────────────────────────────────────────
  startCard: {
    alignSelf: 'stretch',
    gap: 4,
    marginTop: Spacing.four,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  startTitle: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.ink },
  startStep: { fontFamily: Fonts.sans, fontSize: 13, color: colors.ink2 },
  startNote: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink3, marginTop: 2 },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: Spacing.four + 2 },
  action: {
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  actionTitle: { fontFamily: Fonts.semibold, fontSize: 14, color: colors.ink },
  actionSubtitle: { fontFamily: Fonts.sans, fontSize: 12, color: colors.ink2, marginTop: 1 },

  // ── Chips de sugestão ──────────────────────────────────────────────────
  suggestions: { gap: Spacing.two, marginTop: Spacing.four, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 2,
    height: 30,
    paddingHorizontal: Spacing.three - 2,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipText: { fontFamily: Fonts.medium, fontSize: 12, color: colors.ink2 },

  // ── Composer ───────────────────────────────────────────────────────────
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two + 2,
    paddingHorizontal: Spacing.three - 3,
    paddingVertical: Spacing.two + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    paddingHorizontal: Spacing.three,
    paddingTop: 13,
    paddingBottom: 13,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    fontFamily: Fonts.medium,
    fontSize: 14,
    color: colors.ink,
    // Android centraliza o texto de um campo multiline na altura disponível, e
    // aí a segunda linha empurra a primeira para cima em vez de o texto crescer
    // para baixo. Mesmo ajuste do formulário de campanha (`campaigns/new.tsx`).
    textAlignVertical: 'top',
  },
  sendButton: {
    width: 50,
    height: 42,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentFill,
  },
  sendButtonIdle: { opacity: 0.45 },
  pressed: { opacity: 0.65 },
}));
