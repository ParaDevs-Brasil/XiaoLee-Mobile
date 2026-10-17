import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ChatCards } from '@/lib/chat-cards';
import { getSession } from '@/lib/session';

/**
 * Histórico de chat, persistido no aparelho.
 *
 * O backend nunca preenche `chat_history` no dossiê do usuário — devolve lista
 * vazia fixa (`campaigns_routes.py:557`), e não é bug: nada nessa rota grava
 * conversa em lugar nenhum (o `/chat` em si já persiste e devolve memória por
 * conta via `history=` no orchestrator — outra rota, outro contrato). O web
 * resolve o dossiê do lado do cliente, gravando cada troca no `localStorage`
 * assim que ela acontece (`UserData.addLocalChatMessage`, chamada em
 * `ChatPanel.tsx` tanto na resposta quanto no erro) — é dali, e não do
 * backend, que a tela de Histórico do web lê. Este módulo é o mesmo acordo,
 * com `AsyncStorage` no lugar do `localStorage`.
 *
 * Escopado por conta (`session.twitterUserId`, que hoje é o endereço da
 * carteira conectada) — é a mesma conta que deve reencontrar a própria
 * conversa, inclusive depois de desconectar e reconectar a mesma carteira.
 * Sem carteira conectada, cai em `guest`: convidado tem uma única conversa
 * compartilhada, como sempre foi.
 */

const BASE_KEY = 'xiaolee_chat_history';

async function storageKey(): Promise<string> {
  const session = await getSession();
  return `${BASE_KEY}:${session?.twitterUserId || 'guest'}`;
}

/**
 * ~200 trocas, o mesmo teto do web (`UserData.tsx:342`) — só que contado em
 * mensagens, porque aqui não existe o objeto de par que o web usa para cortar
 * a lista.
 */
const MAX_MESSAGES = 400;

export interface StoredMessage extends ChatCards {
  role: 'user' | 'assistant';
  content: string;
  /** ISO 8601, capturado no instante do envio ou da resposta — não é a hora de exibição. */
  at: string;
}

/**
 * Lê o histórico salvo, do mais antigo para o mais novo — a mesma ordem em
 * que `appendChatMessage` grava, então quem lê não precisa ordenar de novo.
 *
 * Nunca lança: armazenamento corrompido ou indisponível vira lista vazia, que
 * é o estado "nada aqui ainda" — mais seguro que derrubar a tela por um JSON
 * que não devia ter sobrevivido a uma atualização do app.
 */
export async function loadChatHistory(): Promise<StoredMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(await storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Grava uma mensagem no fim do histórico.
 *
 * Chamada duas vezes por troca — uma para a mensagem do usuário, outra para a
 * resposta —, e não uma vez com o par pronto: no chat as duas nascem em
 * momentos diferentes (a resposta depende de uma chamada de rede), e carimbar
 * as duas com o mesmo instante perderia o tempo real de cada uma.
 *
 * Nunca lança: se o `AsyncStorage` falhar (sem espaço, indisponível), a
 * mensagem já está na tela — perder só a gravação não deve travar o chat.
 */
export async function appendChatMessage(
  role: StoredMessage['role'],
  content: string,
  /** `at` fixado por quem chama, para achar a mensagem de novo em `updateChatMessage`; `cards` é o que a bolha carrega além do texto. */
  extra: { at?: string; cards?: ChatCards } = {},
): Promise<void> {
  const current = await loadChatHistory();
  const entry: StoredMessage = { role, content, at: extra.at ?? new Date().toISOString(), ...extra.cards };
  await save([...current, entry].slice(-MAX_MESSAGES));
}

/**
 * Atualiza uma mensagem já gravada (achada pelo `at`) — é como o comprovante de
 * uma transação assinada depois da resposta chega ao histórico. Sem
 * correspondência (mensagem já cortada pelo teto), não faz nada.
 */
export async function updateChatMessage(at: string, patch: ChatCards): Promise<void> {
  const current = await loadChatHistory();
  if (!current.some((m) => m.at === at)) return;
  await save(current.map((m) => (m.at === at ? { ...m, ...patch } : m)));
}

async function save(messages: StoredMessage[]): Promise<void> {
  try {
    await AsyncStorage.setItem(await storageKey(), JSON.stringify(messages));
  } catch {
    // sem espaço ou storage indisponível — nada a fazer daqui
  }
}
