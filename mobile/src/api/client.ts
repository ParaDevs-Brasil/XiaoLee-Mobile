import { API_URL, REQUEST_TIMEOUT_MS } from '@/lib/config';
import { clearSession, getSessionToken } from '@/lib/session';

/**
 * Cliente HTTP do backend XiaoLee — mesma responsabilidade de
 * `frontend/src/api/api.tsx` (base URL + Bearer automático + erro
 * normalizado), sobre `fetch` e com SecureStore no lugar do localStorage.
 */

/** Erro de API já normalizado — `message` é sempre exibível ao usuário. */
export class ApiError extends Error {
  readonly status: number | null;
  readonly isNetworkError: boolean;

  constructor(message: string, status: number | null, isNetworkError: boolean) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.isNetworkError = isNetworkError;
  }
}

/**
 * FastAPI responde erro como `{"detail": "..."}` e falha de validação como
 * `{"detail": [{msg, loc, ...}]}` — as duas viram uma string legível.
 */
function messageFromBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;

  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;

  if (Array.isArray(detail)) {
    const msgs = detail
      .map((item) =>
        typeof item === 'object' && item !== null ? (item as { msg?: unknown }).msg : null,
      )
      .filter((msg): msg is string => typeof msg === 'string');
    if (msgs.length > 0) return msgs.join('; ');
  }

  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** Serializado como JSON. Use `method: 'POST'` junto. */
  json?: unknown;
  /** Sobrescreve o timeout padrão, em ms. */
  timeoutMs?: number;
  /** `true` pula a injeção do Bearer (rotas públicas). */
  skipAuth?: boolean;
}

/**
 * Faz a chamada e devolve o JSON já tipado, ou lança `ApiError`.
 *
 * `fetch` não tem timeout nativo — sem o AbortController abaixo, um backend
 * inacessível deixaria a tela girando indefinidamente em vez de mostrar erro.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, timeoutMs = REQUEST_TIMEOUT_MS, skipAuth = false, headers, ...init } = options;

  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  if (json !== undefined) requestHeaders.set('Content-Type', 'application/json');

  // Só o Bearer que ESTE cliente injetou conta para a regra do 401 abaixo — um
  // `Authorization` passado à mão (ex.: chamada com token de outro fluxo) não
  // diz nada sobre a sessão guardada.
  let sentStoredSession = false;
  if (!skipAuth && !requestHeaders.has('Authorization')) {
    const token = await getSessionToken();
    if (token) {
      requestHeaders.set('Authorization', `Bearer ${token}`);
      sentStoredSession = true;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: requestHeaders,
      signal: controller.signal,
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    // A URL do backend é detalhe de infra, não precisa aparecer pra quem só
    // quer saber se deu certo — um amigo do usuário viu essa mensagem crua
    // com "xiaolee-mobile-api..." depois de um /chat que estourou o timeout
    // por demorar na resposta da IA, mas cuja campanha foi criada mesmo
    // assim do lado do servidor. Log técnico fica só no console.
    console.warn(`[apiFetch] ${path} failed`, { aborted, timeoutMs, API_URL, error });
    throw new ApiError(
      aborted
        ? 'A resposta demorou demais — pode já ter acontecido do lado do servidor. Confira antes de tentar de novo.'
        : 'Não foi possível alcançar o servidor. Confira sua conexão e tenta de novo.',
      null,
      true,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const raw = await response.text();
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      // resposta não-JSON — `body` fica null e o texto cru vira a mensagem
    }
  }

  if (!response.ok) {
    // O backend não reconhece mais a sessão guardada (expirou, foi revogada, ou
    // é uma sessão legada de antes do login real). Descartar avisa o gate de
    // login (`hooks/use-auth-state.ts`): se o Privy segue logado, o
    // `WalletProvider` troca o token por uma sessão nova sozinho; senão o app
    // volta para a tela de login em vez de ficar falhando em silêncio.
    if (response.status === 401 && sentStoredSession) void clearSession();
    const detail = messageFromBody(body) ?? raw.slice(0, 200);
    throw new ApiError(detail || `HTTP ${response.status}`, response.status, false);
  }

  return body as T;
}
