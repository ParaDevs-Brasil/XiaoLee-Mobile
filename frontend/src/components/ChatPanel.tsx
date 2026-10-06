import sendChatMessage from "@/hooks/useChat";
import React, { useState, useEffect, useMemo, useRef } from "react";
import Video from "./Video";
import UserData from "./UserData";
import handleAuth, { AuthStatus } from "@/hooks/useAuth";
import { signTransactionXdr, submitToHorizon } from "@/utils/stellar";
import { sendEvmTransaction, shortEvmAddress, getErrorMessage } from "@/lib/evmWallet";
import { explorerTxUrl } from "@/lib/chains";
import { IconSend, IconCheck, IconSpark } from "@/components/icons";
import { XiaoleeBubble } from "@/components/landing/primitives";
import ChatHeader from "@/components/chat/ChatHeader";
import EmptyState from "@/components/chat/EmptyState";
import { useChatSession } from "@/contexts/ChatSessionContext";
import { getChatSessionMessages } from "@/api/api";
import { useCampaignActions } from "@/hooks/useCampaignActions";

type SwapExecution = {
  chain?: string;
  swap_xdr?: string | null;
  network_passphrase?: string;
  swap_quote?: {
    from: string;
    to: string;
    source_amount: number;
    destination_amount: number;
  };
  // Transferência USDC no Arc preparada pelo backend — assinada na wallet EVM conectada
  evm_tx?: { to: string; data: string; value?: string } | null;
  transfer?: { to: string; amount_usdc: number; token: string };
  // Resgate de campanha preparado pelo backend (`prepare_campaign_claim` no
  // OrchestrationService) — assinado pela wallet conectada via useCampaignActions.
  claim?: { campaign_id: number; amount: number; token: string };
  [key: string]: unknown;
};

type MessageType = {
  sent: string;
  response: string;
  hasCode?: boolean;
  code?: string;
  execution?: SwapExecution;
  time?: string;
};

function formatTime(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  if (isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
const actions = {
  Cheer: "xiaolee_cheer.mov",
  Giggle: "xiaolee_giggle.mp4",
  Kawaii: "xiaolee_kawaii.mov",
  Love: "xiaolee_love.mp4",
  Hello: "xiaolee_hello.mov",
  Surprise: "xiaolee_surprise.mov",
  Uncomfortable: "xiaolee_uncomfortable.mov",
  Ouch: "xiaolee_ouch.mov",
  "Think Low": "xiaolee_thinklow.mov",
  Salute: "xiaolee_salute.mov",
};


export default function ChatPanel() {
  const { activeSessionId, setActiveSessionId, refreshSessions } = useChatSession();
  const [message, setMessage] = useState("");
  const [msgs, setMsgs] = useState<MessageType[]>([]);
  const [loading, setLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState<{[key: number]: boolean}>({});
  const [swapSigning, setSwapSigning] = useState<{[key: number]: boolean}>({});
  const [swapTxHash, setSwapTxHash] = useState<{[key: number]: string}>({});
  const [evmTxSigning, setEvmTxSigning] = useState<{[key: number]: boolean}>({});
  const [evmTxHash, setEvmTxHash] = useState<{[key: number]: string}>({});
  const [claimReceiptId, setClaimReceiptId] = useState<{[key: number]: string}>({});
  const [claimError, setClaimError] = useState<{[key: number]: string}>({});
  const { claimReward, isClaimLoading } = useCampaignActions();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // Track whether user is near the bottom
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 80;
  };

  // Only auto-scroll if already near bottom (and never on the empty state)
  useEffect(() => {
    if (msgs.length > 0 && isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [msgs]);

  // Check initial authentication status and load existing chat history
  useEffect(() => {
    const checkInitialAuthStatus = () => {
      const userData = UserData.getUserData();
      if (userData?.user_info?.twitter_user_id) {
        setAuthStatus({ status: "active" });
      }
    };

    const loadExistingChatHistory = () => {
      // Sessão ativa: o histórico daquela thread vem do backend (efeito abaixo,
      // keyed em activeSessionId) — o log plano legado em localStorage não deve
      // sobrescrever por cima, senão "New chat"/troca de sessão nunca limpa a tela.
      if (activeSessionId !== null) return;
      const chatHistory = UserData.getChatHistory();
      if (chatHistory.length === 0) return;
      setMsgs(prev => {
        // Não sobrescrever conversa viva: o histórico não carrega `execution`
        // (swap_xdr/evm_tx), então recarregá-lo por cima apagaria os botões de
        // assinatura recém-preparados. Só hidrata quando há mais no histórico
        // do que em memória (carga inicial pós-auth ou sync de outra sessão).
        if (prev.length >= chatHistory.length) return prev;
        return chatHistory.map(chat => ({
          sent: chat.user_message.content,
          response: chat.assistant_response.content,
          hasCode: false,
          code: "",
          time: formatTime(chat.user_message.timestamp),
        }));
      });
    };

    checkInitialAuthStatus();
    loadExistingChatHistory();

    const handleUserDataLoaded = () => {
      loadExistingChatHistory();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('userDataLoaded', handleUserDataLoaded);
      return () => window.removeEventListener('userDataLoaded', handleUserDataLoaded);
    }
  }, [activeSessionId]);

  // Trocar de sessão troca de thread — carrega o histórico daquela conversa
  // do backend (não mescla com o que estava em memória, ao contrário do
  // localStorage acima, que é o de sempre/legado).
  useEffect(() => {
    if (activeSessionId === null) {
      setMsgs([]);
      return;
    }
    let cancelled = false;
    getChatSessionMessages(activeSessionId).then((history) => {
      if (cancelled) return;
      const paired: MessageType[] = [];
      let pending: { sent: string; time: string } | null = null;
      for (const m of history) {
        if (m.role === "user") {
          pending = { sent: m.content, time: formatTime(m.time) };
        } else if (pending) {
          paired.push({ sent: pending.sent, response: m.content, hasCode: false, code: "", time: pending.time });
          pending = null;
        }
      }
      setMsgs(paired);
    }).catch((err) => console.error("Error loading chat session messages:", err));
    return () => { cancelled = true; };
  }, [activeSessionId]);

  async function fetchData() {
    if (UserData.getUserData() !== null) {
      await UserData.fetchData();
    }
  }


  const handleVerifyAuth = async (messageIndex: number, token: string) => {
    setAuthLoading(prev => ({ ...prev, [messageIndex]: true }));

    try {
      const authResult = await handleAuth(token);
      setAuthStatus(authResult);

      if (authResult.status === "active") {
        await fetchData();
      }

    } catch (error) {
      console.error("Error verifying auth:", error);
      setAuthStatus({ status: "expired" });
    } finally {
      setAuthLoading(prev => ({ ...prev, [messageIndex]: false }));
    }
  };

  const handleSignSwap = async (messageIndex: number, xdr: string, networkPassphrase?: string) => {
    setSwapSigning(prev => ({ ...prev, [messageIndex]: true }));
    try {
      const signedXdr = await signTransactionXdr(xdr, networkPassphrase ?? "Test SDF Network ; September 2015");
      const hash = await submitToHorizon(signedXdr, "testnet");
      setSwapTxHash(prev => ({ ...prev, [messageIndex]: hash }));
      setMsgs(prev => {
        const updated = [...prev];
        updated[messageIndex] = { ...updated[messageIndex], execution: { ...updated[messageIndex].execution, swap_xdr: null } };
        return updated;
      });
    } catch (err) {
      alert(`Erro ao assinar swap: ${getErrorMessage(err)}`);
    } finally {
      setSwapSigning(prev => ({ ...prev, [messageIndex]: false }));
    }
  };

  // Espelho do handleSignSwap para o trilho Arc/EVM: assina a tx preparada pelo
  // backend na wallet EVM conectada (mesmo provider EIP-6963 da conexão).
  const handleSignEvmTx = async (messageIndex: number, tx: { to: string; data: string; value?: string }) => {
    setEvmTxSigning(prev => ({ ...prev, [messageIndex]: true }));
    try {
      const hash = await sendEvmTransaction(tx);
      setEvmTxHash(prev => ({ ...prev, [messageIndex]: hash }));
      setMsgs(prev => {
        const updated = [...prev];
        updated[messageIndex] = { ...updated[messageIndex], execution: { ...updated[messageIndex].execution, evm_tx: null } };
        return updated;
      });
    } catch (err) {
      alert(`Erro ao assinar transação: ${getErrorMessage(err)}`);
    } finally {
      setEvmTxSigning(prev => ({ ...prev, [messageIndex]: false }));
    }
  };

  // Espelho de handleSignEvmTx para o resgate de campanha preparado pelo
  // backend (`prepare_campaign_claim`) — `claimReward` já monta a prova,
  // assina na wallet conectada e chama /campaigns/claim (useCampaignActions.tsx),
  // mesmo caminho que a tela de Campaigns já usa. Nunca lança: erro vira
  // `success: false`.
  const handleClaim = async (messageIndex: number, campaignId: number) => {
    setClaimError(prev => ({ ...prev, [messageIndex]: "" }));
    const result = await claimReward(campaignId);
    if (!result.success) {
      setClaimError(prev => ({ ...prev, [messageIndex]: result.error || result.message || "Erro ao resgatar recompensa" }));
      return;
    }
    setClaimReceiptId(prev => ({ ...prev, [messageIndex]: result.claim_receipt_id || "claimed" }));
    setMsgs(prev => {
      const updated = [...prev];
      updated[messageIndex] = { ...updated[messageIndex], execution: { ...updated[messageIndex].execution, claim: undefined } };
      return updated;
    });
  };

  useEffect(() => {
    fetchData();

    const userData = UserData.getUserData();
    if (userData?.user_info?.twitter_user_id && (!authStatus || authStatus.status !== "active")) {
      setAuthStatus({ status: "active" });
    }
  }, [msgs, authStatus]);

  const messagesWithCodes = useMemo(() => {
    return msgs.map(msg => ({
      ...msg
    }));
  }, [msgs]);

  const TYPING_SENTINEL = "__typing__";

  const handleSendMessage = async (message: string) => {
    setLoading(true);
    setMessage("");
    isNearBottomRef.current = true; // always scroll on send

    const sentAt = formatTime();

    // Show user message + typing indicator immediately
    setMsgs(prev => [...prev, { sent: message, response: TYPING_SENTINEL, hasCode: false, code: "", time: sentAt }]);

    try {
      const response = await sendChatMessage(message, activeSessionId ?? undefined);

      if (activeSessionId === null && response.session_id) {
        setActiveSessionId(response.session_id);
      }
      refreshSessions();

      let messageHasCode = false;
      let messageCode = "";

      if (response.code !== null && response.code !== undefined) {
        messageCode = response.code;
        messageHasCode = true;
      }

      if (response.animations !== null && response.animations !== undefined) {
        Video.setPfp(actions[response.animations as keyof typeof actions]);
      }

      if (response && response.response[0].content) {
        const content = response.response[0].content;
        const execution = response.execution as SwapExecution | undefined;
        setMsgs(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { sent: message, response: content, hasCode: messageHasCode, code: messageCode, execution, time: sentAt };
          return updated;
        });
        UserData.addLocalChatMessage(message, content);
      }

      if (UserData.getUserData() !== null) {
        await fetchData();
      }

    } catch (error) {
      console.error("Error sending message:", error);
      const errText = "Sorry, there was an error sending your message. Please try again.";
      setMsgs(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { sent: message, response: errText, hasCode: false, code: "", time: sentAt };
        return updated;
      });
      UserData.addLocalChatMessage(message, errText);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full lg:col-span-7 h-full min-h-0 rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-e2 flex flex-col overflow-hidden">

      {/* Header */}
      <ChatHeader />

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-2.5 sm:px-3 md:px-5 py-3 md:py-4 space-y-4 custom-scrollbar min-h-0 overscroll-contain"
      >
        {messagesWithCodes.length === 0 && (
          <EmptyState onSuggestion={(text) => !loading && handleSendMessage(text)} />
        )}

        {messagesWithCodes.map((msg, index) => (
          <div key={index} className="space-y-3 msg-in">

            {/* User Message */}
            <div className="flex justify-end">
              <div className="max-w-[85%] md:max-w-[70%]">
                <div className="btn-primary text-white rounded-2xl rounded-br-md px-4 py-2.5 shadow-e1">
                  <p className="font-medium leading-relaxed break-words text-sm">
                    {msg.sent}
                  </p>
                </div>
                <p className="text-[10px] text-gray-500 text-right mt-1 pr-1">
                  You{msg.time ? ` · ${msg.time}` : ""}
                </p>
              </div>
            </div>

            {/* Xiaolee Response */}
            <div className="flex justify-start items-end gap-2">
              <div className="hidden sm:block shrink-0 mb-5">
                <XiaoleeBubble size={28} />
              </div>
              <div className="max-w-[85%] md:max-w-[70%]">
                <div className="bg-white border border-[var(--border)] rounded-2xl rounded-bl-md px-4 py-2.5 shadow-e1">
                  {msg.response === TYPING_SENTINEL ? (
                    <div className="flex items-center gap-2 py-1 text-[var(--accent)]">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  ) : (
                    <p className="text-gray-700 leading-relaxed break-words text-sm">
                      {msg.response}
                    </p>
                  )}

                  {/* Swap signing button — appears when AI returned a swap_xdr */}
                  {msg.execution?.swap_xdr && msg.response !== TYPING_SENTINEL && (
                    <div className="mt-3 space-y-2">
                      {msg.execution.swap_quote && (
                        <p className="text-xs text-sky-600 font-mono">
                          {msg.execution.swap_quote.source_amount} {msg.execution.swap_quote.from} → ~{msg.execution.swap_quote.destination_amount.toFixed(4)} {msg.execution.swap_quote.to}
                        </p>
                      )}
                      <button
                        onClick={() => handleSignSwap(index, msg.execution!.swap_xdr as string, msg.execution?.network_passphrase)}
                        disabled={swapSigning[index]}
                        className="px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white hover:opacity-90 disabled:opacity-50 transition-all"
                      >
                        {swapSigning[index] ? "Signing…" : "Sign with Freighter"}
                      </button>
                    </div>
                  )}

                  {/* EVM tx signing button — appears when AI prepared an Arc/USDC transfer */}
                  {msg.execution?.evm_tx && msg.response !== TYPING_SENTINEL && (
                    <div className="mt-3 space-y-2">
                      {msg.execution.transfer && (
                        <p className="text-xs text-fuchsia-600 font-mono">
                          {msg.execution.transfer.amount_usdc} {msg.execution.transfer.token} → {shortEvmAddress(msg.execution.transfer.to, 8, 6)} · Arc
                        </p>
                      )}
                      <button
                        onClick={() => handleSignEvmTx(index, msg.execution!.evm_tx!)}
                        disabled={evmTxSigning[index]}
                        className="px-4 py-2 text-xs font-bold rounded-xl btn-primary text-white hover:opacity-90 disabled:opacity-50 transition-all"
                      >
                        {evmTxSigning[index] ? "Signing…" : "Sign with your wallet"}
                      </button>
                    </div>
                  )}

                  {/* Claim button — appears when AI prepared a campaign reward claim */}
                  {msg.execution?.claim && msg.response !== TYPING_SENTINEL && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-fuchsia-600 font-mono">
                        {msg.execution.claim.amount} {msg.execution.claim.token} ready to claim
                      </p>
                      <button
                        onClick={() => handleClaim(index, msg.execution!.claim!.campaign_id)}
                        disabled={isClaimLoading(msg.execution.claim.campaign_id)}
                        className="px-4 py-2 text-xs font-bold rounded-xl btn-primary text-white hover:opacity-90 disabled:opacity-50 transition-all"
                      >
                        {isClaimLoading(msg.execution.claim.campaign_id) ? "Claiming…" : "Claim reward"}
                      </button>
                      {claimError[index] && (
                        <p className="text-xs text-red-600">{claimError[index]}</p>
                      )}
                    </div>
                  )}

                  {/* Receipt after successful campaign claim */}
                  {claimReceiptId[index] && (
                    <div className="mt-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs space-y-1">
                      <p className="font-bold text-emerald-700 flex items-center gap-1">
                        <IconCheck size={12} sw={3} />
                        Reward claimed
                      </p>
                      <p className="font-mono text-emerald-600 break-all">Receipt {claimReceiptId[index]}</p>
                    </div>
                  )}

                  {/* Tx hash after successful EVM transfer */}
                  {evmTxHash[index] && (
                    <div className="mt-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs space-y-1">
                      <p className="font-bold text-emerald-700 flex items-center gap-1">
                        <IconCheck size={12} sw={3} />
                        USDC transfer sent on Arc
                      </p>
                      <p className="font-mono text-emerald-600 break-all">{evmTxHash[index]}</p>
                      {explorerTxUrl(evmTxHash[index], "arc") && (
                        <a
                          href={explorerTxUrl(evmTxHash[index], "arc")!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block mt-1 text-blue-600 hover:underline font-semibold"
                        >
                          View on Arc explorer ↗
                        </a>
                      )}
                    </div>
                  )}

                  {/* Tx hash after successful swap */}
                  {swapTxHash[index] && (
                    <div className="mt-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs space-y-1">
                      <p className="font-bold text-emerald-700 flex items-center gap-1">
                        <IconCheck size={12} sw={3} />
                        Swap executed on Stellar Testnet
                      </p>
                      <p className="font-mono text-emerald-600 break-all">{swapTxHash[index]}</p>
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${swapTxHash[index]}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block mt-1 text-blue-600 hover:underline font-semibold"
                      >
                        View on Stellar Expert ↗
                      </a>
                    </div>
                  )}

                  {/* Verify + DM buttons — only if THIS message has code AND user is not authenticated */}
                  {msg.hasCode && msg.code && authStatus?.status !== "active" && (
                    <div className="mt-3 flex items-center flex-wrap gap-2">
                      <button
                        onClick={() => {
                          if (msg.code) {
                            handleVerifyAuth(index, msg.code);
                          }
                        }}
                        disabled={authLoading[index] || false}
                        className={`px-3 py-1.5 text-xs rounded-xl font-bold transition-all duration-200 ${
                          authLoading[index]
                            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                            : "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                        }`}
                      >
                        {authLoading[index] ? "Verifying…" : "Verify"}
                      </button>

                      <button
                        onClick={() => window.open('https://x.com/XiaoLeeDefai', '_blank')}
                        className="px-3 py-1.5 text-xs font-bold text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--border)] hover:bg-[#fbe3ef] rounded-xl transition-all duration-200"
                      >
                        DM @Xiaolee
                      </button>

                      {authStatus && (
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${
                          authStatus.status === "expired"
                            ? "bg-red-50 text-red-600 border border-red-100"
                            : "bg-amber-50 text-amber-600 border border-amber-100"
                        }`}>
                          {authStatus.status}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Meta row: name + reactions */}
                <div className={`flex items-center justify-between mt-1 px-1 ${msg.response === TYPING_SENTINEL ? 'hidden' : ''}`}>
                  <span className="text-[10px] text-gray-500">
                    Xiaolee{msg.time ? ` · ${msg.time}` : ""}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => Video.setPfp("xiaolee_love.mp4")}
                      className="text-xs opacity-50 hover:opacity-100 transition-all hover:scale-110"
                      title="Love it!"
                    >
                      💕
                    </button>
                    <button
                      onClick={() => Video.setPfp("xiaolee_cheer.mov")}
                      className="text-xs opacity-50 hover:opacity-100 transition-all hover:scale-110"
                      title="Cool!"
                    >
                      👏
                    </button>
                    <button
                      onClick={() => Video.setPfp("xiaolee_giggle.mp4")}
                      className="text-xs opacity-50 hover:opacity-100 transition-all hover:scale-110"
                      title="Funny!"
                    >
                      😊
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="flex items-center gap-2 px-2.5 sm:px-3 md:px-5 pt-2.5 md:pt-4 pb-[calc(0.625rem+env(safe-area-inset-bottom))] md:pb-4 border-t border-[var(--border)] shrink-0 bg-white/50">
        <div className="relative flex-1">
          <span className="absolute left-3.5 md:left-4 top-1/2 -translate-y-1/2 text-[var(--accent)] pointer-events-none">
            <IconSpark size={16} />
          </span>
          <input
            type="text"
            inputMode="text"
            enterKeyHint="send"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onFocus={(e) => {
              setTimeout(() => {
                e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 300);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && message.trim() && !loading) {
                e.preventDefault();
                handleSendMessage(message);
              }
            }}
            placeholder="Ask Xiaolee anything…"
            className="w-full pl-10 md:pl-11 pr-3 md:pr-4 py-3 md:py-3.5 rounded-2xl border border-[var(--border)] bg-white text-sm font-medium text-gray-800 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[rgba(216,27,120,0.35)] focus:border-[rgba(216,27,120,0.45)] focus:shadow-[0_14px_34px_-14px_rgba(216,27,120,0.25)] disabled:opacity-60 transition-all duration-200"
            disabled={loading}
          />
        </div>
        <button
          onClick={(e) => {
            e.preventDefault();
            if (message.trim() && !loading) {
              handleSendMessage(message);
            }
          }}
          disabled={!message.trim() || loading}
          className="btn-primary flex items-center justify-center gap-2 px-4 md:px-6 py-3 md:py-3.5 rounded-2xl text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.96] shrink-0"
        >
          {loading ? (
            <span className="w-[18px] h-[18px] border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <IconSend size={18} />
          )}
          <span className="hidden md:inline">{loading ? "Sending…" : "Send"}</span>
        </button>
      </div>
    </div>
  );
}
