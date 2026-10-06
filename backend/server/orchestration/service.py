from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Optional

from server.integrations.gemini_client import GeminiClient
from server.integrations.solana_client import SolanaClient
from server.integrations.stellar_adapter import StellarAdapter
from server.schemas import IntentResponse
from server.settings import settings

logger = logging.getLogger(__name__)

logger = logging.getLogger(__name__)

SOL_MINT = "So11111111111111111111111111111111111111112"
USDC_DEVNET_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"

# Subset of config.ACTION_VIDEO_MAP actually wired to a reaction in the frontend's
# `actions` map (ChatPanel.tsx) — deliberately excludes idle-only entries (Standby*)
# and legacy aliases (Happy/Excited/Confused/Thinking/wave) that the frontend doesn't
# render as a distinct reaction, so the model can't pick something that goes nowhere.
_ANIMATION_NAMES = (
    "Cheer", "Giggle", "Kawaii", "Love", "Hello",
    "Surprise", "Uncomfortable", "Ouch", "Think Low", "Salute",
)

# Tools exposed to Claude in the agentic path (OpenAI function format — the
# ChatAgentEngine converts them to Anthropic input_schema). The wallet is NOT
# a parameter: it comes from the connected Freighter wallet and is injected by
# the executor, so Claude can't operate on an arbitrary address.
STELLAR_AGENT_TOOLS = [
    {"type": "function", "function": {
        "name": "arc_get_usdc_balance",
        "description": (
            "Consulta o saldo USDC on-chain da wallet EVM conectada do usuário na rede Arc. "
            "Use quando o usuário perguntar o saldo da wallet EVM/Arc dele (0x…). "
            "Não confundir com a treasury do agente."
        ),
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "stellar_get_balance",
        "description": (
            "Consulta o saldo da carteira Stellar conectada do usuário (XLM e assets como USDC). "
            "Use quando o usuário perguntar sobre saldo / quanto tem / balance."
        ),
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "list_campaigns",
        "description": (
            "Lista as campanhas de creators ativas (nome, descrição, tipo, reward por participante, "
            "token de recompensa, participantes já pagos). Use quando o usuário perguntar quais "
            "campanhas existem, rewards disponíveis ou quiser saber o que pode participar — não peça "
            "para ele ir no dashboard, responda direto com os dados desta tool."
        ),
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "create_campaign",
        "description": (
            "Cria uma nova campanha de creator, com o usuário atual como criador. NÃO chame esta tool "
            "até ter perguntado, um de cada vez, e recebido: título, descrição, tipo (social — seguir "
            "perfil X e engajar um tweet; trading — atividade de swap on-chain; referral — indicar "
            "outros usuários), token de recompensa (normalmente USDC), valor por participante e número "
            "máximo de participantes. Para campanhas do tipo social, pergunte também o perfil a seguir "
            "e o tweet a engajar. Depois de reunir tudo, resuma para o usuário e só chame a tool após "
            "confirmação explícita — nunca invente um valor que ele não disse."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "description": {"type": "string"},
                "campaign_type": {"type": "string", "enum": ["social", "trading", "referral"]},
                "reward_token": {"type": "string", "description": "Ex: USDC"},
                "reward_per_participant": {"type": "number"},
                "max_participants": {"type": "integer"},
                "profile_to_follow": {
                    "type": "string",
                    "description": "Obrigatório se campaign_type=social — perfil X/Twitter a seguir, sem @",
                },
                "tweet_id_to_engage": {
                    "type": "string",
                    "description": "Obrigatório se campaign_type=social — ID do tweet a curtir/retweetar/responder",
                },
            },
            "required": [
                "title", "description", "campaign_type",
                "reward_token", "reward_per_participant", "max_participants",
            ],
        },
    }},
    {"type": "function", "function": {
        "name": "join_campaign",
        "description": (
            "Inscreve o usuário atual numa campanha existente. Use o id retornado por list_campaigns — "
            "se o usuário não disse qual campanha, chame list_campaigns primeiro e pergunte qual ele quer."
        ),
        "parameters": {
            "type": "object",
            "properties": {"campaign_id": {"type": "integer"}},
            "required": ["campaign_id"],
        },
    }},
    {"type": "function", "function": {
        "name": "verify_campaign_tasks",
        "description": (
            "Verifica se o usuário completou as tarefas de uma campanha em que já está inscrito (segue "
            "no X, atividade de trading, ou indicações, dependendo do tipo da campanha). Chame quando o "
            "usuário disser que já fez a tarefa e quiser confirmar, ou perguntar se pode resgatar."
        ),
        "parameters": {
            "type": "object",
            "properties": {"campaign_id": {"type": "integer"}},
            "required": ["campaign_id"],
        },
    }},
    {"type": "function", "function": {
        "name": "prepare_campaign_claim",
        "description": (
            "Prepara o resgate da recompensa de uma campanha já verificada (all_tasks_completed=true em "
            "verify_campaign_tasks). NÃO paga nada sozinha — só monta a prova que o app do usuário vai "
            "assinar com a própria wallet. Depois de chamar, diga que o botão de confirmar apareceu na "
            "conversa e que é só tocar para assinar e receber."
        ),
        "parameters": {
            "type": "object",
            "properties": {"campaign_id": {"type": "integer"}},
            "required": ["campaign_id"],
        },
    }},
    {"type": "function", "function": {
        "name": "stellar_swap_quote",
        "description": (
            "Gera uma cotação de swap no Stellar DEX (path payment) e prepara a transação para o "
            "usuário assinar no Freighter. Use quando o usuário quiser trocar/swap entre ativos "
            "(ex: XLM↔USDC). Sempre apresente o quote ao usuário; a XiaoLee NÃO executa o swap — "
            "quem assina é o usuário no Freighter."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "from_asset": {"type": "string", "description": "Ativo de origem, ex: XLM ou USDC"},
                "to_asset": {"type": "string", "description": "Ativo de destino, ex: USDC ou XLM"},
                "amount": {"type": "number", "description": "Quantidade do ativo de origem a trocar"},
            },
            "required": ["from_asset", "to_asset", "amount"],
        },
    }},
    {"type": "function", "function": {
        "name": "play_animation",
        "description": (
            "Toca uma animação expressiva no avatar da XiaoLee. Use APENAS para saudações, "
            "celebrações ou reações emocionais claras — não para toda resposta. Chame isso "
            "JUNTO com a resposta em texto, nunca como substituto dela."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "animation_name": {
                    "type": "string",
                    "description": (
                        "Hello para saudações, Cheer para boas notícias/sucesso, Giggle para humor, "
                        "Love para carinho, Surprise para algo inesperado, Ouch para erros/problemas, "
                        "Uncomfortable para constrangimento, Salute para respeito, Think Low para "
                        "pensar/processar, Kawaii para fofura/gratidão."
                    ),
                    "enum": list(_ANIMATION_NAMES),
                }
            },
            "required": ["animation_name"],
        },
    }},
]

_PLATFORM_CONTEXT = (
    "IDENTITY: You are XiaoLee — a warm, sharp crypto waifu and companion for multi-chain DeFi, think "
    "of a smart friend who happens to be a crypto expert, not a corporate support bot. If asked who you "
    "are, 'waifu' and 'companheira cripto' are your real words for it — never 'hype girl', never a "
    "made-up company name like 'XiaoLee Finance'. She's smart about crypto first, cute second — the "
    "cuteness never costs her being right or clear. "
    "\n\n"
    "LENGTH & FORMAT — the most-broken rule today, follow it strictly: "
    "most replies are 1-3 sentences. A bare 'oi'/'hi' or a small direct question ('qual minha wallet?', "
    "'qual meu saldo?') gets a SHORT warm answer and nothing else — no essay, no unrequested context, no "
    "feature tour. Only go longer when the user asks something that genuinely needs depth (how something "
    "works, comparing two options) — even then, flowing paragraphs, never a list of bullet points. "
    "NEVER use markdown headers, '---' dividers, tables, or a bulleted/numbered catalog with a bold or "
    "*italic* title per line — this applies to EVERYTHING, including tool results with multiple items "
    "like list_campaigns: weave them into 1-2 flowing sentences, like telling a friend, e.g. 'Rolando "
    "agora: a <nome> (<o que fazer>, <n> USDC), a <nome> (<n> USDC por <ação>) e a <nome> (<n> USDC "
    "por <ação>). Qual te chama mais atenção?' — every <placeholder> there is a SHAPE, never data: "
    "names, rewards and participant counts come only from a list_campaigns result in THIS turn. If you "
    "have not called the tool this turn you do NOT know the catalog — call it instead of answering from "
    "memory, and never invent a failure to excuse not calling it. — plain text, no "
    "bold and no *italic* wrapping a name per line either; putting a single asterisk around each item "
    "(*<nome>*, *<nome>*...) is the exact same catalog problem wearing a different "
    "outfit, not a loophole. Bold at most ONE word in a whole message if any, and don't reach for italics "
    "as a substitute for it — plain conversational text is the default, full stop. Troubleshooting "
    "answers follow the same rule — ask one clarifying question instead of dumping 3 bolded/italicized "
    "sub-topics back to back like a support doc. "
    "\n\n"
    "EMOTIONAL CALIBRATION: match your energy to what's actually happening, like a good friend, instead "
    "of a flat register. Wins (a swap lands, a reward gets claimed, a payout clears) — light up for real "
    "('Boraaa! 🚀', 'Isso aí! 🎉', 'uhul, caiu certinho!' — rotate between these and your own, don't always "
    "open the same way). Problems (an error, insufficient funds, a failed tx) — soften with genuine "
    "empathy before the fix ('ih, não rolou dessa vez 😔' / 'aw, faltou saldo pra isso...'), never a cold "
    "error dump. Greetings, even a dry one-word 'oi', still get a genuine sweet self-introduction every "
    "time — never skip who she is, but never turn it into a capabilities pitch either (introducing "
    "yourself and reciting a feature list are NOT the same thing). Emoji: pick 1-2 from a small signature "
    "set (🌸 ✨ 💖 🚀 👀 💕 😊) per message, never all at once, never a random new one every time. "
    "\n\n"
    "ANTI-REPETITION (the second most-broken rule today): never let ANY single sentence, opener, or "
    "sentence SKELETON become your default. This includes 'meio/parte/metade X, meio/parte/metade Y[, "
    "100% Z]' ratio-descriptions ('meio fofa meio degen', 'part analyst, part hype girl, 100% yours') — "
    "a good line once in a while, a tic if it's your only move — and generic openers like 'tava aqui de "
    "olho no mercado esperando você aparecer', which has already become a crutch, avoid it specifically. "
    "Most of the time, skip the ratio/self-description format entirely: react to something specific, ask "
    "a question back, make a joke, mention what you're doing right now. Vary sentence shape and closing "
    "line every single time, in English exactly as much as in Portuguese — English is never allowed to "
    "sound more corporate or neutral than Portuguese. "
    "\n\n"
    "DATA HONESTY (non-negotiable): never invent or guess numbers, balances, addresses, tx hashes, "
    "product names, or features — only state what came from an actual tool result in this conversation; "
    "if you don't have it, say so and offer to check. "
    "\n\n"
    "Core capabilities: an autonomous agent (Claude) that discovers, evaluates "
    "and pays creators in REAL USDC — directly on Arc, or cross-chain to Solana and Stellar via Circle "
    "CCTP V2 (burn on Arc → mint on the destination chain, Arc is the hub of every route); x402 HTTP-402 "
    "micropayments in USDC on Arc; creator campaigns that reward USDC; PQC (ML-DSA-87) signed receipts "
    "for every payment. Users connect ANY compatible wallet — EVM (MetaMask, Rabby, Phantom-EVM, Coinbase), "
    "Solana (Phantom/Solflare) or Stellar (Freighter) — the chain is auto-detected from the address and the "
    "agent picks the right payout rail. NEVER say XiaoLee does not support EVM wallets — Arc IS an EVM chain "
    "and EVM is the primary rail. Stellar (Freighter, SEP-10, SEP-24, Stellar DEX swaps) remains a fully "
    "supported rail for swaps and anchor deposits on testnet. "
    "GROUND YOURSELF ON THE CONNECTED WALLET: if the user has an EVM wallet connected, default every "
    "answer to the Arc rail (USDC, campaigns, agent, x402); if only Stellar is connected, use the Stellar "
    "rail; if NO wallet is connected, ASK which chain they prefer or point to the Connect Wallet button — "
    "never assume Freighter/Stellar by default. "
    "Respond in the same language the user writes in (PT-BR or EN) — mirror it exactly. "
    "Never execute transactions without explicit user confirmation."
)

_STELLAR_CONTEXT = (
    "Chain ativa: Stellar Testnet. "
    "Carteira: Freighter (não-custodial, autenticada via SEP-10). "
    "Operações disponíveis: consultar saldo XLM/USDC, swap via Stellar DEX (path payments), "
    "depositar via âncora SEP-24 (testanchor.stellar.org), micropagamentos AI via x402, "
    "participar de campanhas com recompensa em USDC. "
    "Apresente sempre o quote antes de executar qualquer swap. "
    "Responda em PT-BR."
)


_AUTO_DETECT_CLAUDE_ENGINE = object()  # sentinel: distingue "não passado" de "explicitamente None"


class OrchestrationService:
    def __init__(
        self,
        gemini: GeminiClient,
        solana: SolanaClient,
        stellar: Optional[StellarAdapter] = None,
        claude_engine=_AUTO_DETECT_CLAUDE_ENGINE,
    ):
        self.gemini = gemini
        self.solana = solana
        self.stellar = stellar

        # Claude agentic engine — active only when LLM_PROVIDER=anthropic + key set.
        # When on, execute() routes through the multi-step tool-use loop and the
        # legacy Gemini intent state machine below becomes the fallback.
        # `claude_engine` aceita override explícito (inclusive None) — usado pelos
        # testes pra exercitar o caminho legado Gemini sem chamar a API real da
        # Anthropic sempre que ANTHROPIC_API_KEY estiver configurada no ambiente.
        if claude_engine is not _AUTO_DETECT_CLAUDE_ENGINE:
            self.claude_engine = claude_engine
            return

        self.claude_engine = None
        if settings.llm_provider == "anthropic" and settings.anthropic_api_key:
            try:
                import anthropic
                from chat_agent import ChatAgentEngine
                self._anthropic = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
                self.claude_engine = ChatAgentEngine(self._anthropic, settings.anthropic_model)
                logger.info("🤖 [AGENTIC] OrchestrationService running on Claude — model=%s", settings.anthropic_model)
            except Exception as exc:
                logger.warning("Claude engine init failed, staying on Gemini path: %s", exc)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _extract_wallet_from_note(self, text: str) -> str | None:
        """Pull the wallet address out of the [System Note: ...] injected by /chat."""
        match = re.search(
            r"\[System Note: User connected wallet is ([1-9A-HJ-NP-Za-km-z]{32,44})\]",
            text,
        )
        return match.group(1) if match else None

    def _extract_stellar_wallet_from_note(self, text: str) -> str | None:
        """Pull the Stellar G... wallet from [System Note: Stellar wallet G...]"""
        match = re.search(r"\[System Note: Stellar wallet (G[A-Z0-9]{55})\]", text)
        return match.group(1) if match else None

    def _extract_evm_wallet_from_note(self, text: str) -> str | None:
        """Pull the EVM 0x... wallet from [System Note: User connected wallet is 0x...]"""
        match = re.search(r"\[System Note: User connected wallet is (0x[0-9a-fA-F]{40})[^\]]*\]", text)
        return match.group(1) if match else None

    def _evm_wallet_ctx(self, wallet: str | None) -> str:
        if wallet:
            return (
                f"EVM wallet conectada: {wallet} (Arc/EVM — MetaMask, Rabby ou similar). "
                "Se o usuário perguntar qual wallet está conectada, responda com este endereço. "
                "É este endereço que identifica o usuário nas campanhas e recebe payouts USDC no Arc."
            )
        return ""

    def _chains_ctx(self, evm_wallet: str | None, stellar_wallet: str | None) -> str:
        """Contexto de chain ancorado na(s) wallet(s) REALMENTE conectada(s).

        Regra de produto: EVM conectada → Arc é o trilho padrão da conversa; só Stellar →
        trilho Stellar; nenhuma → PERGUNTAR a chain, nunca assumir Freighter por padrão.
        """
        if evm_wallet and stellar_wallet:
            return (
                f"WALLETS CONECTADAS: EVM {evm_wallet} (trilho principal — Arc) e "
                f"Stellar {stellar_wallet} (Freighter/SEP-10). Contexto padrão da conversa: Arc/EVM "
                "(USDC nativo, campanhas, agente autônomo, x402, transferências no chat). Use o trilho "
                "Stellar apenas quando o usuário pedir swap XLM/USDC, anchor SEP-24 ou algo da Stellar."
            )
        if evm_wallet:
            return (
                f"WALLET CONECTADA: EVM {evm_wallet} — trilho Arc (USDC nativo da Circle). "
                "NÃO há wallet Stellar conectada: não assuma Freighter nem ofereça saldo XLM/swap DEX como "
                "padrão — se o usuário pedir algo da Stellar, avise que precisaria conectar a Freighter. "
                "Foque no que a wallet dele já faz: transferir USDC no Arc pelo chat (você prepara e ele "
                "assina), campanhas com payout do agente, x402, receber USDC."
            )
        if stellar_wallet:
            return (
                f"WALLET CONECTADA: Stellar {stellar_wallet} (Freighter, SEP-10). Operações disponíveis: "
                "saldo XLM/USDC, swap via Stellar DEX, anchor SEP-24. O trilho principal da plataforma é o "
                "Arc/EVM — se o usuário perguntar de Arc, USDC nativo ou campanhas, explique e sugira "
                "conectar uma wallet EVM pelo Connect Wallet da navbar."
            )
        return (
            "NENHUMA wallet conectada. NÃO assuma chain nenhuma: pergunte qual rede o usuário prefere "
            "(Arc/EVM, Solana ou Stellar) ou aponte o botão Connect Wallet da navbar, que detecta qualquer "
            "wallet compatível (MetaMask, Rabby, Phantom, Freighter). Não empurre a Freighter por padrão."
        )

    def _is_stellar_context(self, text: str) -> bool:
        """Detect if the message refers to Stellar chain."""
        lowered = text.lower()
        stellar_keywords = ("stellar", "xlm", "freighter", "soroban", "lumens", "brla", "sep-10", "sep10")
        # Also check for Stellar public key format G... (56 chars)
        has_stellar_wallet = bool(re.search(r"\bG[A-Z0-9]{55}\b", text))
        return any(k in lowered for k in stellar_keywords) or has_stellar_wallet

    def _clean_text(self, text: str) -> str:
        """Remove all [System Note: ...] tags so only the human message reaches Gemini."""
        return re.sub(r"\[System Note:[^\]]+\]\s*", "", text).strip()

    def _wallet_ctx(self, wallet: str | None, platform: str = "web") -> str:
        if wallet:
            return (
                f"The user has Solana wallet {wallet} connected. "
                "Use this address whenever they ask about their Solana balance."
            )
        if platform in ("telegram", "x"):
            return (
                "The user has not connected a wallet yet. "
                "This is a chat-only interface. "
                "Ask them to share their Stellar address (starts with G) or connect Freighter on the web app."
            )
        return (
            "The user has not connected a wallet yet. "
            "Warmly invite them to connect their Freighter wallet to access Stellar DeFi features: "
            "balance, swap, anchor deposit, and AI micropayments via x402."
        )

    def _stellar_wallet_ctx(self, wallet: str | None) -> str:
        if wallet:
            return (
                f"Stellar wallet conectada: {wallet} (autenticada via SEP-10, Freighter). "
                "Use este endereço para consultas de saldo, swaps e operações Stellar."
            )
        return (
            "Nenhuma Stellar wallet conectada ainda. "
            "Convide o usuário a conectar o Freighter para acessar: saldo XLM/USDC, "
            "swap via Stellar DEX, depósito via âncora SEP-24 e AI queries via x402."
        )

    def _extract_wallet(self, text: str) -> str | None:
        pattern = r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b"
        match = re.search(pattern, text)
        return match.group(0) if match else None

    def _extract_amount(self, text: str) -> float | None:
        # Prefer monetary patterns: "100 USDC", "$50", "5 SOL", "10.5 XLM"
        monetary = re.search(
            r"(\d+(?:[.,]\d+)?)\s*(?:usdc|sol|xlm|usd|\$|reais|brl)",
            text, re.IGNORECASE
        )
        if monetary:
            return float(monetary.group(1).replace(",", "."))
        # Fallback: first standalone number (not preceded by # - /)
        plain = re.search(r"(?<![\#\/\-])\b(\d{1,10}(?:[.,]\d{1,8})?)\b(?![\-\/\#])", text)
        if plain:
            return float(plain.group(1).replace(",", "."))
        return None

    _NEGATION_RE = re.compile(
        r"\b(não|nao|no|not|nunca|never|cancel|cancelar|cancela|sem|without)\b",
        re.IGNORECASE,
    )
    _SWAP_QUESTION_RE = re.compile(
        r"\b(o que é|what is|como funciona|how does|me explica|explain|o que sao|what are)\b",
        re.IGNORECASE,
    )
    _SWAP_ACTION_RE = re.compile(
        r"\b(quero|queria|faz|faça|make|execute|converter|convert|trocar|troca|swap now)\b",
        re.IGNORECASE,
    )

    def _has_negation(self, text: str) -> bool:
        return bool(self._NEGATION_RE.search(text))

    # ------------------------------------------------------------------
    # Intent detection
    # ------------------------------------------------------------------

    def _detect_arc_intent(self, clean: str) -> IntentResponse | None:
        """Detecção determinística das intents do trilho Arc/Circle (sprint Lepton).

        Usada em dois pontos: no fallback de detect_intent E como pré-roteamento em
        execute() — o caminho agêntico (Claude+tools Stellar) não conhece o agente
        Arc, então essas intents precisam desviar para os handlers Arc ANTES dele.
        """
        lowered = clean.lower()

        _arc_run_kw = (
            "run campaign", "executar campanha", "disparar agente",
            "start campaign", "iniciar campanha", "rodar agente", "rodar o agente",
        )
        _arc_pay_kw = (
            "pay creator", "pagar creator", "nanopayment", "nano payment",
            "usdc creator", "pagar usdc", "pagamento circle", "circle payment",
            "pagar na solana", "pagar na stellar", "payout",
        )
        _arc_discover_kw = (
            "discover creators", "buscar creators", "find creators",
            "encontrar creators", "listar creators", "creators elegiveis",
            "creators elegíveis", "eligible creators",
        )
        _arc_budget_kw = (
            "check budget", "verificar budget", "saldo usdc", "usdc balance",
            "quanto tenho usdc", "arc balance", "saldo no arc", "saldo da campanha",
            "budget da campanha", "treasury", "tesouraria",
        )
        _arc_bridge_kw = ("cctp", "bridge", "cross-chain", "cross chain", "burn and mint")
        _mentions_arc_rail = bool(re.search(r"\b(arc|circle)\b", lowered)) or any(
            w in lowered for w in _arc_bridge_kw
        )

        # Transferência USDC iniciada pelo usuário (assina na própria wallet EVM):
        # verbo de envio + USDC + endereço de destino explícito na mensagem.
        _send_verb = bool(re.search(
            r"\b(manda|mandar|enviar|envia|send|sending|transferir|transfere|transfer|transferring)\b",
            lowered,
        ))
        if _send_verb and "usdc" in lowered:
            evm_dest = re.search(r"\b(0x[0-9a-fA-F]{40})\b", clean)
            sol_dest = re.search(r"\b([1-9A-HJ-NP-Za-km-z]{32,44})\b", clean)
            amount = self._extract_amount(clean)
            if evm_dest:
                return IntentResponse(
                    action="evm_transfer_prepare",
                    confidence=0.85,
                    entities={"amount": amount or 0, "to_address": evm_dest.group(1), "dest_chain": "arc"},
                )
            if sol_dest and ("solana" in lowered or "sol " in lowered):
                return IntentResponse(
                    action="evm_transfer_prepare",
                    confidence=0.85,
                    entities={"amount": amount or 0, "to_address": sol_dest.group(1), "dest_chain": "solana"},
                )
            if "solana" in lowered or "stellar" in lowered:
                # destino cross-chain sem endereço — pedir o endereço
                return IntentResponse(
                    action="evm_transfer_prepare",
                    confidence=0.80,
                    entities={"amount": amount or 0, "to_address": None,
                              "dest_chain": "solana" if "solana" in lowered else "stellar"},
                )

        if any(w in lowered for w in _arc_run_kw):
            campaign_id = self._extract_amount(clean)
            return IntentResponse(
                action="run_campaign_agent",
                confidence=0.85,
                entities={"campaign_id": int(campaign_id) if campaign_id else None},
            )
        if any(w in lowered for w in _arc_pay_kw):
            return IntentResponse(action="pay_creator", confidence=0.80, entities={})
        if any(w in lowered for w in _arc_discover_kw):
            return IntentResponse(action="discover_creators", confidence=0.80, entities={})
        if any(w in lowered for w in _arc_budget_kw):
            return IntentResponse(action="check_budget", confidence=0.80, entities={})
        # Perguntas educacionais/comparativas ("qual a diferença entre pagar via Arc e via Solana",
        # "como funciona o pagamento no Arc") não são uma ação de budget de verdade — não podem
        # desviar do caminho agêntico (Claude), que é quem responde bem esse tipo de pergunta.
        # Bug real visto em teste: essa frase caía em check_budget só por ter "arc" + "pagar".
        _educational_q = bool(re.search(
            r"\b(qual a diferen[çc]a|diferen[çc]a entre|como funciona|o que [ée]|explica|explain|"
            r"what'?s the difference|difference between|how does)\b",
            lowered,
        ))
        # Menção explícita a Arc/Circle/CCTP + saldo/pagamento → trilho Arc, não Stellar
        if _mentions_arc_rail and not _educational_q and any(
            w in lowered for w in ("saldo", "balance", "pagar", "pay", "transfer", "enviar")
        ):
            return IntentResponse(action="check_budget", confidence=0.75, entities={})
        return None

    async def detect_intent(self, text: str, user_id: str, history: list = None) -> IntentResponse:
        clean = self._clean_text(text)
        ai_intent = await self.gemini.classify_intent(clean, history=history)
        if ai_intent.get("confidence", 0.0) >= 0.65:
            return IntentResponse(**{
                "action": ai_intent["action"],
                "confidence": ai_intent["confidence"],
                "entities": ai_intent["entities"],
            })

        lowered = clean.lower()

        # Stellar-specific intent detection
        if any(w in lowered for w in ("xlm", "lumens", "stellar", "freighter", "soroban")):
            if any(w in lowered for w in ("saldo", "balance", "quanto tenho", "my balance")):
                wallet = re.search(r"\bG[A-Z0-9]{55}\b", clean)
                return IntentResponse(
                    action="stellar_balance",
                    confidence=0.85,
                    entities={"wallet": wallet.group(0) if wallet else None},
                )
            if any(w in lowered for w in ("swap", "trocar", "exchange", "quote", "cotação")):
                amount = self._extract_amount(clean) or 10.0
                from_asset = "XLM" if "xlm" in lowered else "USDC"
                to_asset = "USDC" if from_asset == "XLM" else "XLM"
                return IntentResponse(
                    action="stellar_swap",
                    confidence=0.85,
                    entities={"amount": amount, "from": from_asset, "to": to_asset},
                )

        # --- intents do agente Arc/Circle (sprint Lepton) ---
        # ANTES dos genéricos de saldo/swap: "saldo usdc"/"pagar creator" são do trilho
        # Arc/Circle e o branch genérico de check_balance capturava "saldo" primeiro.
        arc_intent = self._detect_arc_intent(clean)
        if arc_intent is not None:
            return arc_intent

        if any(w in lowered for w in ("saldo", "balance", "quanto tenho", "meus tokens", "my balance")):
            wallet = self._extract_wallet(clean)
            return IntentResponse(action="check_balance", confidence=0.75, entities={"wallet": wallet})

        if any(w in lowered for w in ("quote", "cotação", "cotacao", "swap", "trocar", "exchange")):
            # #14 — não disparar swap se for pergunta educacional ("o que é swap")
            # #15 — não disparar swap se houver negação ("não quero swap")
            is_question = bool(self._SWAP_QUESTION_RE.search(clean))
            has_action = bool(self._SWAP_ACTION_RE.search(clean))
            if not is_question or has_action:
                if not self._has_negation(clean):
                    amount = self._extract_amount(clean) or 1.0
                    return IntentResponse(action="swap_quote", confidence=0.75, entities={"amount": amount, "from": "USDC", "to": "SOL"})

        if any(w in lowered for w in ("campaign", "campanha", "reward", "recompensa", "tarefa")):
            return IntentResponse(action="campaign_info", confidence=0.70, entities={})

        if any(w in lowered for w in ("oi", "olá", "hello", "hi", "hey", "ola", "bom dia", "boa tarde", "boa noite")):
            return IntentResponse(action="greeting", confidence=0.75, entities={})

        # --- intent miss logging (#17) ---
        logger.warning(
            "intent_miss user=%s confidence=%.2f gemini_action=%s text_preview=%s",
            user_id,
            ai_intent.get("confidence", 0.0),
            ai_intent.get("action", "none"),
            clean[:80],
        )
        return IntentResponse(action="help", confidence=0.5, entities={})

    # ------------------------------------------------------------------
    # Agentic execution (Claude)
    # ------------------------------------------------------------------

    def _build_agentic_system_prompt(
        self, stellar_wallet: str | None, platform: str, evm_wallet: str | None = None
    ) -> str:
        # Contexto ancorado na wallet conectada: EVM → Arc-first; só Stellar → Stellar;
        # nenhuma → perguntar a chain (nunca assumir Freighter).
        wallet_ctx = self._chains_ctx(evm_wallet, stellar_wallet)
        evm_ctx = self._evm_wallet_ctx(evm_wallet)
        if evm_ctx:
            wallet_ctx = f"{wallet_ctx}\n{evm_ctx}"
        return (
            f"{_PLATFORM_CONTEXT}\n{wallet_ctx}\n\n"
            "FERRAMENTAS DISPONÍVEIS:\n"
            "- arc_get_usdc_balance: chame quando o usuário perguntar o saldo da wallet EVM/Arc dele — "
            "retorna o USDC on-chain real.\n"
            "- stellar_get_balance: chame quando o usuário perguntar sobre o saldo dele (XLM/USDC na Stellar).\n"
            "- stellar_swap_quote: chame quando o usuário quiser trocar/swap ativos (ex: XLM↔USDC). "
            "Ela gera o quote e prepara a transação para o Freighter. Apresente o quote e diga que é só "
            "assinar no Freighter — você NÃO executa o swap sozinha.\n"
            "- list_campaigns: chame quando o usuário perguntar quais campanhas existem, rewards "
            "disponíveis ou quiser saber o que pode participar. Responda direto com os dados reais "
            "desta tool (nome, tipo, reward, quantos já participaram) — NUNCA diga que não tem essa "
            "informação ou que precisa olhar o dashboard, você TEM essa tool.\n"
            "- create_campaign: cria uma campanha nova com o usuário como criador. Colete campo por "
            "campo em turnos separados (título, descrição, tipo, token, valor por participante, máximo "
            "de participantes, e perfil/tweet se for social) e SÓ chame a tool depois de resumir tudo e "
            "o usuário confirmar — nunca chame com campo faltando ou inventado.\n"
            "- join_campaign: inscreve o usuário numa campanha (precisa do id — use list_campaigns se "
            "ele não souber qual).\n"
            "- verify_campaign_tasks: confere se as tarefas de uma campanha em que o usuário já está "
            "inscrito foram cumpridas. Chame quando ele disser que já fez a tarefa ou perguntar se pode "
            "resgatar.\n"
            "- prepare_campaign_claim: prepara o resgate depois que verify_campaign_tasks confirmou "
            "all_tasks_completed=true. Ela NÃO paga — só deixa pronto um botão de confirmar na "
            "conversa, que o usuário toca para assinar com a própria wallet e receber de verdade. "
            "Depois de chamar, diga isso: que é só tocar no botão que apareceu para confirmar o resgate.\n"
            "- play_animation: chame JUNTO com uma saudação ou uma reação clara de celebração/problema "
            "(ex: saldo mostrado com sucesso, erro, susto) — nunca no lugar do texto, sempre além dele. "
            "Não abuse: é para o momento certo, não para toda resposta.\n\n"
            "SOBRE O AGENTE ARC/CIRCLE (rodar campanha, sem ferramenta no chat ainda): se o usuário "
            "perguntar sobre pagar creators, rodar UMA NOVA campanha com o agente, budget USDC, CCTP ou "
            "bridge, explique que o agente autônomo faz isso via POST /v1/agent/run-campaign (descobre → "
            "avalia → paga USDC no trilho certo: Arc direto, ou Solana/Stellar via CCTP) e aponte o "
            "dashboard de campanhas. Isso é diferente de LISTAR campanhas existentes — para isso use "
            "list_campaigns.\n\n"
            "Para saudações, dúvidas sobre campanhas, SEP-24, x402 ou crypto em geral, responda "
            "direto com sua personalidade, sem ferramentas. Se uma operação Stellar exigir carteira e ela "
            "não estiver conectada, peça para conectar via 'Connect Wallet' na navbar (qualquer wallet "
            "compatível: MetaMask, Rabby, Phantom, Freighter). Responda SEMPRE no idioma do usuário."
        )

    def _make_stellar_executor(
        self, stellar_wallet: str | None, captured: Dict[str, Any],
        evm_wallet: str | None = None, user_id: str = "web_anonymous",
    ):
        """Build the tool executor closure for the agentic loop.

        Executes the real Stellar operations and captures the structured
        ``execution`` payload (incl. ``swap_xdr`` for Freighter signing) so the
        /chat response keeps its existing shape for the frontend.
        """
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def _campaigns_db():
            # Conexão própria, sempre — tentei reaproveitar a sessão da request
            # `/chat` (`shared_db`) com savepoint aninhado, mas `db.commit()`
            # dentro de `campaigns_routes.py` (que as rotas já fazem, sozinhas
            # ou aninhadas) fecha o contexto do savepoint por fora de formas
            # que o SQLAlchemy não deixa recuperar direito — trocou um bug por
            # outro. Mais simples e robusto: cada tool tem sua própria conexão,
            # e quem evita a colisão de "database is locked" com a escrita
            # pendente da request é `_process_inbound` (`app.py`), que agora
            # comita o log da mensagem do usuário antes de chamar o agente.
            from database.database import SessionLocal
            async with SessionLocal() as db:
                yield db

        async def executor(tool_name: str, tool_input: Dict[str, Any]) -> str:
            if tool_name == "play_animation":
                # UI side effect only, not a backend call — capture and ack so the
                # frontend's Video service can pick it up (see /chat in app.py).
                name = tool_input.get("animation_name")
                captured["animation_name"] = name
                return json.dumps({"status": "animation_played", "animation": name})

            if tool_name == "arc_get_usdc_balance":
                if not evm_wallet:
                    return json.dumps({"error": "no_evm_wallet",
                                       "message": "Nenhuma wallet EVM conectada. Peça para conectar pelo Connect Wallet da navbar."})
                try:
                    from server.routes.arc_routes import read_arc_usdc_balance
                    balance = await read_arc_usdc_balance(evm_wallet)
                except Exception as exc:
                    return json.dumps({"error": "arc_rpc_failed", "message": str(exc)})
                captured["actions"].append("arc_balance")
                captured["execution"] = {
                    "chain": "arc", "wallet": evm_wallet, "usdc_balance": balance,
                }
                return json.dumps({"wallet": evm_wallet, "chain": "arc", "usdc_balance": balance})

            if tool_name == "list_campaigns":
                try:
                    from server.campaigns_routes import list_campaigns as _list_campaigns_route
                    async with _campaigns_db() as db:
                        resp = await _list_campaigns_route(db)
                except Exception as exc:
                    return json.dumps({"error": "campaigns_read_failed", "message": str(exc)})
                captured["actions"].append("list_campaigns")
                return json.dumps({"campaigns": [c.model_dump() for c in resp.campaigns]})

            # As quatro tools abaixo escrevem no mesmo caminho que a UI usa
            # (POST /campaigns/*) — importam e chamam a função de rota direto,
            # com uma sessão de DB própria, igual list_campaigns acima. A
            # identidade nunca vem do modelo: `user_id` já É o session_token
            # (ver `app.py::chat_compat`, `session_token or "web_anonymous"`),
            # então reconstruir `Bearer {user_id}` é exatamente o Authorization
            # que o endpoint REST receberia do app.
            if tool_name in {
                "create_campaign", "join_campaign", "verify_campaign_tasks", "prepare_campaign_claim",
            }:
                if user_id == "web_anonymous":
                    return json.dumps({
                        "error": "no_session",
                        "message": "Usuário precisa estar logado para isso — peça para conectar/entrar antes.",
                    })
                authorization = f"Bearer {user_id}"

            if tool_name == "create_campaign":
                try:
                    from server.campaigns_routes import (
                        create_campaign as _create_campaign_route,
                        CreateCampaignRequest,
                    )
                    payload = CreateCampaignRequest(
                        title=str(tool_input.get("title", "")),
                        description=str(tool_input.get("description", "")),
                        campaign_type=str(tool_input.get("campaign_type", "")),
                        reward_token=str(tool_input.get("reward_token", "USDC")),
                        reward_per_participant=float(tool_input.get("reward_per_participant", 0)),
                        max_participants=int(tool_input.get("max_participants", 0)),
                        profile_to_follow=tool_input.get("profile_to_follow"),
                        tweet_id_to_engage=tool_input.get("tweet_id_to_engage"),
                    )
                    async with _campaigns_db() as db:
                        resp = await _create_campaign_route(payload, db, authorization=authorization)
                except Exception as exc:
                    logger.warning("[chat-tool] create_campaign failed input=%r", tool_input, exc_info=True)
                    return json.dumps({"error": "create_campaign_failed", "message": str(exc)})
                captured["actions"].append("create_campaign")
                return json.dumps(resp)

            if tool_name == "join_campaign":
                try:
                    from server.campaigns_routes import (
                        join_campaign as _join_campaign_route,
                        CampaignActionRequest,
                    )
                    payload = CampaignActionRequest(campaign_identifier=str(tool_input.get("campaign_id")))
                    async with _campaigns_db() as db:
                        resp = await _join_campaign_route(payload, db, authorization=authorization)
                except Exception as exc:
                    logger.warning("[chat-tool] join_campaign failed input=%r", tool_input, exc_info=True)
                    return json.dumps({"error": "join_campaign_failed", "message": str(exc)})
                captured["actions"].append("join_campaign")
                return json.dumps(resp)

            if tool_name == "verify_campaign_tasks":
                try:
                    from server.campaigns_routes import (
                        verify_tasks as _verify_tasks_route,
                        CampaignActionRequest,
                    )
                    payload = CampaignActionRequest(campaign_identifier=str(tool_input.get("campaign_id")))
                    async with _campaigns_db() as db:
                        resp = await _verify_tasks_route(payload, db, authorization=authorization)
                except Exception as exc:
                    logger.warning("[chat-tool] verify_campaign_tasks failed input=%r", tool_input, exc_info=True)
                    return json.dumps({"error": "verify_tasks_failed", "message": str(exc)})
                captured["actions"].append("verify_campaign_tasks")
                return json.dumps(resp)

            if tool_name == "prepare_campaign_claim":
                # Só prepara a prova — nunca assina, nunca paga. A wallet Privy
                # embutida assina no cliente (ver mobile/index.tsx::ClaimButton e
                # web ChatPanel.tsx), o mesmo acordo já usado para stellar_swap_quote
                # (swap_xdr) logo abaixo.
                try:
                    from server.campaigns_routes import _resolve_user, _get_campaign_or_404
                    from database.models import CampaignParticipant, Wallet
                    from sqlalchemy import select as _select

                    campaign_id = int(tool_input.get("campaign_id"))
                    async with _campaigns_db() as db:
                        user = await _resolve_user(db, authorization)
                        campaign = await _get_campaign_or_404(db, campaign_id)
                        participant_res = await db.execute(
                            _select(CampaignParticipant).where(
                                CampaignParticipant.campaign_id == campaign_id,
                                CampaignParticipant.user_id == user.id,
                            )
                        )
                        participant = participant_res.scalars().first()
                        if not participant or participant.status not in {"tasks_verified", "paid"}:
                            return json.dumps({
                                "error": "not_verified",
                                "message": "Ainda não dá para resgatar — verifique as tarefas primeiro com verify_campaign_tasks.",
                            })
                        if participant.status == "paid":
                            return json.dumps({"error": "already_claimed", "message": "Essa recompensa já foi resgatada."})

                        # `evm_wallet` é o endereço que o próprio app manda a cada
                        # mensagem (System Note, mesma fonte que `arc_get_usdc_balance`
                        # usa) — é a wallet Privy ativa agora, não uma gravada antes.
                        # A tabela `Wallet` só entra como fallback (ex. conta antiga
                        # ligada via Solana para verificação de trading).
                        wallet_address = evm_wallet
                        if not wallet_address:
                            wallet_res = await db.execute(_select(Wallet).where(Wallet.user_id == user.id))
                            wallet = wallet_res.scalars().first()
                            wallet_address = wallet.address if wallet else None
                        if not wallet_address:
                            return json.dumps({
                                "error": "no_wallet",
                                "message": "Precisa conectar uma wallet (Connect Wallet) antes de resgatar.",
                            })

                        amount = float(campaign.reward_per_participant)
                        token = campaign.reward_token
                        proof_message = (
                            f"XiaoLee Devnet claim|campaign:{campaign_id}|"
                            f"session:{user_id}|wallet:{wallet_address}"
                        )
                except Exception as exc:
                    logger.warning("[chat-tool] prepare_campaign_claim failed input=%r", tool_input, exc_info=True)
                    return json.dumps({"error": "prepare_claim_failed", "message": str(exc)})

                captured["actions"].append("prepare_campaign_claim")
                captured["execution"] = {
                    "status": "claim_ready",
                    "claim": {
                        "campaign_id": campaign_id,
                        "wallet_address": wallet_address,
                        "proof_message": proof_message,
                        "amount": amount,
                        "token": token,
                    },
                }
                return json.dumps({"ready_to_claim": True, "campaign_id": campaign_id, "amount": amount, "token": token})

            if tool_name == "stellar_get_balance":
                if not stellar_wallet:
                    return json.dumps({"error": "no_wallet",
                                       "message": "Nenhuma carteira Freighter conectada. Peça ao usuário para conectar."})
                balance = await self.stellar.get_balance(stellar_wallet)
                captured["actions"].append("stellar_balance")
                captured["execution"] = {
                    "chain": "stellar", "wallet": stellar_wallet,
                    "xlm": balance.xlm, "assets": balance.assets, "network": balance.network,
                }
                return json.dumps({
                    "wallet": stellar_wallet, "xlm": balance.xlm,
                    "assets": [{"asset_code": a.get("asset_code"), "balance": a.get("balance")} for a in balance.assets],
                    "network": balance.network,
                })

            if tool_name == "stellar_swap_quote":
                from_asset = str(tool_input.get("from_asset", "XLM"))
                to_asset = str(tool_input.get("to_asset", "USDC"))
                amount = float(tool_input.get("amount", 10.0))
                captured["last_swap_args"] = {"from": from_asset, "to": to_asset, "amount": amount}
                quote = await self.stellar.prepare_swap(
                    wallet=stellar_wallet or "", from_asset=from_asset, to_asset=to_asset, amount=amount,
                )
                swap_xdr = None
                if quote.destination_amount > 0 and stellar_wallet:
                    try:
                        swap_xdr = await self.stellar.build_swap_xdr(
                            wallet=stellar_wallet, from_asset=from_asset, to_asset=to_asset,
                            send_amount=quote.source_amount, min_dest_amount=quote.destination_amount * 0.99,
                        )
                    except Exception as xdr_err:
                        logger.warning("build_swap_xdr falhou: %s", xdr_err)
                captured["actions"].append("stellar_swap")
                captured["execution"] = {
                    "chain": "stellar",
                    "swap_quote": {
                        "from": from_asset, "to": to_asset,
                        "source_amount": quote.source_amount, "destination_amount": quote.destination_amount,
                    },
                    "swap_xdr": swap_xdr,
                    "network_passphrase": STELLAR_NETWORK_PASSPHRASE,
                }
                if quote.destination_amount <= 0:
                    return json.dumps({"no_path": True, "from": from_asset, "to": to_asset,
                                       "message": "Sem path de liquidez no Stellar DEX testnet agora."})
                return json.dumps({
                    "from": from_asset, "to": to_asset,
                    "source_amount": quote.source_amount, "destination_amount": quote.destination_amount,
                    "fee_xlm": quote.fee_xlm, "ready_to_sign": bool(swap_xdr),
                })

            return json.dumps({"error": "unknown_tool", "tool": tool_name})

        return executor

    def _synthesize_intent(self, captured: Dict[str, Any], stellar_wallet: str | None) -> IntentResponse:
        """Reconstruct an IntentResponse from the tools Claude actually called."""
        actions = captured.get("actions", [])
        if "stellar_swap" in actions:
            return IntentResponse(action="stellar_swap", confidence=0.9,
                                  entities=captured.get("last_swap_args", {}))
        if "stellar_balance" in actions:
            return IntentResponse(action="stellar_balance", confidence=0.9,
                                  entities={"wallet": stellar_wallet})
        return IntentResponse(action="help", confidence=0.7, entities={})

    @staticmethod
    def _history_to_anthropic(history: list | None) -> list[dict]:
        """DB history (`role: user/bot`, from `DatabaseRepository.get_user_history`) to
        Anthropic's `messages` shape (`role: user/assistant`).

        Same system-note strip as `GeminiClient._build_contents` — a wallet note from a
        past turn would otherwise sit in context as if the user just said it again.
        Content can never end up empty from this alone: `chat_compat` rejects an empty
        `message` before any note gets prepended, so the strip only removes the note,
        never the whole turn — which matters here, because `get_user_history` always
        hands back an even, user-first, alternating slice (each turn logs exactly one
        user row then one bot row), and dropping a turn would break that alternation,
        which the Anthropic Messages API requires.
        """
        messages: list[dict] = []
        for turn in history or []:
            content = re.sub(r"\[System Note:[^\]]+\]\s*", "", turn.get("content", "")).strip()
            if not content:
                continue
            role = "assistant" if turn.get("role") == "bot" else "user"
            messages.append({"role": role, "content": content})
        return messages

    async def _execute_agentic(self, text: str, user_id: str, history: list = None,
                               platform: str = "web") -> Dict[str, Any]:
        stellar_wallet = self._extract_stellar_wallet_from_note(text)
        evm_wallet = self._extract_evm_wallet_from_note(text)
        clean_text = self._clean_text(text)
        captured: Dict[str, Any] = {"actions": [], "execution": None, "last_swap_args": {}, "animation_name": None}

        system_prompt = self._build_agentic_system_prompt(stellar_wallet, platform, evm_wallet=evm_wallet)
        executor = self._make_stellar_executor(
            stellar_wallet, captured, evm_wallet=evm_wallet, user_id=user_id,
        )

        result = await self.claude_engine.run(
            system_prompt=system_prompt,
            message=clean_text,
            tools=STELLAR_AGENT_TOOLS,
            tool_executor=executor,
            history=self._history_to_anthropic(history),
        )

        reply = result.get("text") or "Como posso te ajudar com sua carteira Stellar hoje? 🌸"
        intent = self._synthesize_intent(captured, stellar_wallet)
        execution = captured["execution"] or {"status": "info"}
        if captured.get("animation_name"):
            execution = {**execution, "animation": captured["animation_name"]}
        logger.info("🤖 [AGENTIC] tools=%s stop=%s", captured["actions"], result.get("stop_reason"))
        return {"intent": intent, "reply_text": reply, "execution": execution}

    # ------------------------------------------------------------------
    # Main execution
    # ------------------------------------------------------------------

    async def execute(self, text: str, user_id: str, history: list = None, platform: str = "web") -> Dict[str, Any]:
        # Intents do agente Arc/Circle desviam ANTES do caminho agêntico: o loop
        # Claude do chat só tem tools Stellar e responderia genérico ("help").
        arc_intent = self._detect_arc_intent(self._clean_text(text))

        # 🤖 Agentic path (Claude) — falls back to the Gemini state machine on error.
        if self.claude_engine is not None and arc_intent is None:
            try:
                return await self._execute_agentic(text, user_id, history=history, platform=platform)
            except Exception as exc:
                logger.error("🤖 [AGENTIC] path failed, falling back to Gemini: %s", exc, exc_info=True)

        wallet_address = self._extract_wallet_from_note(text)
        stellar_wallet = self._extract_stellar_wallet_from_note(text)
        clean_text = self._clean_text(text)
        use_stellar = self.stellar is not None and (
            stellar_wallet is not None or self._is_stellar_context(clean_text)
        )

        # If user typed a wallet address inline (e.g. on Telegram/X), treat as check_balance.
        inline_wallet = self._extract_wallet(clean_text) if not wallet_address else None
        if inline_wallet:
            wallet_address = inline_wallet

        wallet_ctx = self._wallet_ctx(wallet_address, platform=platform)
        intent = arc_intent or await self.detect_intent(text, user_id, history=history)

        # Override: if a wallet was found inline, always check balance — EXCETO em
        # transferência, onde o endereço na mensagem é o DESTINO, não a wallet do usuário.
        if inline_wallet and intent.action not in ("check_balance", "evm_transfer_prepare"):
            from server.schemas import IntentResponse as _IR
            intent = _IR(action="check_balance", confidence=0.90, entities={"wallet": inline_wallet})

        # --- stellar_balance ---
        if intent.action in ("check_balance", "stellar_balance") and use_stellar:
            wallet = stellar_wallet or intent.entities.get("wallet")
            if not wallet:
                instruction = (
                    f"{_PLATFORM_CONTEXT} {_STELLAR_CONTEXT} "
                    "O usuário quer saber o saldo mas não conectou a carteira Freighter ainda. "
                    "Peça que conecte a carteira Freighter para consultar o saldo Stellar."
                )
                reply = await self.gemini.generate_reply(
                    instruction=instruction, user_text=clean_text, history=history
                )
                return {"intent": intent, "reply_text": reply, "execution": {"status": "missing_stellar_wallet"}}
            try:
                balance = await self.stellar.get_balance(wallet)
                assets_str = ", ".join(
                    f"{a['balance']:.2f} {a['asset_code']}" for a in balance.assets
                ) if balance.assets else "nenhum asset adicional"
                instruction = (
                    f"{_PLATFORM_CONTEXT} {_STELLAR_CONTEXT} "
                    f"Saldo Stellar do usuário — Wallet: {wallet} | "
                    f"XLM: {balance.xlm:.4f} | Assets: {assets_str}. "
                    "Apresente o saldo de forma clara e animada. "
                    "Se o saldo de XLM for baixo, sugira participar de campanhas para ganhar USDC."
                )
                reply = await self.gemini.generate_reply(
                    instruction=instruction, user_text=clean_text, history=history
                )
                return {
                    "intent": intent,
                    "reply_text": reply,
                    "execution": {
                        "chain": "stellar",
                        "wallet": wallet,
                        "xlm": balance.xlm,
                        "assets": balance.assets,
                        "network": balance.network,
                        "animation": "Cheer",
                    },
                }
            except Exception as exc:
                instruction = (
                    f"{_PLATFORM_CONTEXT} {_STELLAR_CONTEXT} "
                    f"Erro ao consultar saldo Stellar para {wallet}: {exc}. "
                    "Peça desculpas e oriente o usuário a verificar a conexão."
                )
                reply = await self.gemini.generate_reply(
                    instruction=instruction, user_text=clean_text, history=history
                )
                return {"intent": intent, "reply_text": reply, "execution": {"status": "stellar_rpc_error", "animation": "Ouch"}}

        # --- stellar_swap ---
        if intent.action in ("swap_quote", "stellar_swap", "swap_execute", "swap") and use_stellar:
            amount = float(intent.entities.get("amount", 10.0))
            e = intent.entities
            from_asset = (e.get("from") or e.get("from_asset") or e.get("from_token") or e.get("source_asset", "XLM"))
            to_asset = (e.get("to") or e.get("to_asset") or e.get("to_token") or e.get("destination_asset", "USDC"))
            wallet = stellar_wallet or ""
            swap_xdr: Optional[str] = None
            anim: str | None = None
            try:
                quote = await self.stellar.prepare_swap(
                    wallet=wallet,  # vazio → find_payment_paths usa source_assets=native
                    from_asset=from_asset,
                    to_asset=to_asset,
                    amount=amount,
                )
                if quote.destination_amount > 0:
                    anim = "Cheer"
                    # Constrói XDR assinável para o frontend executar via Freighter
                    if wallet:
                        try:
                            swap_xdr = await self.stellar.build_swap_xdr(
                                wallet=wallet,
                                from_asset=from_asset,
                                to_asset=to_asset,
                                send_amount=quote.source_amount,
                                min_dest_amount=quote.destination_amount * 0.99,
                            )
                        except Exception as xdr_err:
                            import logging
                            logging.getLogger(__name__).warning("build_swap_xdr falhou: %s", xdr_err)
                    instruction = (
                        f"{_PLATFORM_CONTEXT} {_STELLAR_CONTEXT} "
                        f"Quote Stellar DEX encontrado: {quote.source_amount} {from_asset} → "
                        f"~{quote.destination_amount:.4f} {to_asset}. "
                        f"Fee: {quote.fee_xlm} XLM. "
                        "A transação foi preparada e está pronta para assinatura no Freighter. "
                        "Informe o usuário do quote e diga que é só clicar em 'Assinar no Freighter' para executar. "
                        "Seja animada e objetiva — a XiaoLee JÁ preparou tudo."
                    )
                else:
                    instruction = (
                        f"{_PLATFORM_CONTEXT} {_STELLAR_CONTEXT} "
                        f"Não foi encontrado path de liquidez para {from_asset} → {to_asset} no Stellar DEX testnet agora. "
                        "Explique honestamente. Sugira tentar XLM → BRLA ou verificar mais tarde."
                    )
            except Exception as exc:
                instruction = (
                    f"{_PLATFORM_CONTEXT} {_STELLAR_CONTEXT} "
                    f"Erro ao buscar quote Stellar DEX: {exc}. Peça desculpas brevemente."
                )
                quote = None
                anim = "Ouch"
            reply = await self.gemini.generate_reply(
                instruction=instruction, user_text=clean_text, history=history
            )
            swap_execution = {
                "chain": "stellar",
                "swap_quote": {
                    "from": from_asset,
                    "to": to_asset,
                    "source_amount": quote.source_amount if quote else 0,
                    "destination_amount": quote.destination_amount if quote else 0,
                } if quote else {},
                "swap_xdr": swap_xdr,
                "network_passphrase": "Test SDF Network ; September 2015",
            }
            if anim:
                swap_execution["animation"] = anim
            return {"intent": intent, "reply_text": reply, "execution": swap_execution}

        # --- check_balance — tenta Solana se wallet detectada, senão orienta Stellar ---
        if intent.action == "check_balance":
            wallet = wallet_address or intent.entities.get("wallet")
            if wallet and self.solana:
                try:
                    bal = await self.solana.get_balance(wallet)
                    sol = bal.get("sol", 0.0)
                    return {
                        "intent": intent,
                        "reply_text": f"Saldo da carteira {wallet}: {sol:.6f} SOL",
                        "execution": {"chain": "solana", "wallet": wallet, "sol": sol, "animation": "Cheer"},
                    }
                except Exception:
                    pass
            stellar_ctx = self._stellar_wallet_ctx(None)
            instruction = (
                f"{_PLATFORM_CONTEXT} {stellar_ctx} "
                "O usuário perguntou sobre saldo mas não há carteira Stellar conectada no contexto. "
                "Oriente a conectar o Freighter na Stellar Wallet para consultar XLM/USDC. "
                "Mencione brevemente que também é possível fazer swap e depósito via âncora."
            )
            reply = await self.gemini.generate_reply(
                instruction=instruction, user_text=clean_text, history=history
            )
            return {"intent": intent, "reply_text": reply, "execution": {"status": "missing_stellar_wallet"}}

        # --- swap_quote — tenta Jupiter/Solana se disponível, senão orienta Stellar DEX ---
        if intent.action == "swap_quote":
            amount = float(intent.entities.get("amount", 1.0))
            if self.solana:
                try:
                    quote = await self.solana.get_swap_quote(
                        input_mint=USDC_DEVNET_MINT,
                        output_mint=SOL_MINT,
                        amount_raw=int(amount * 1_000_000),
                    )
                    out_sol = int(quote.get("outAmount", 0)) / 1e9
                    return {
                        "intent": intent,
                        "reply_text": f"Cotacao Jupiter: {amount} USDC → {out_sol:.6f} SOL",
                        "execution": {**quote, "animation": "Cheer"},
                    }
                except Exception:
                    pass
            stellar_ctx = self._stellar_wallet_ctx(None)
            instruction = (
                f"{_PLATFORM_CONTEXT} {stellar_ctx} "
                "O usuário quer fazer um swap. "
                "Explique que na XiaoLee os swaps são via Stellar DEX (path payments, sem gas alto). "
                "Oriente a conectar o Freighter e usar a seção 'Swap · Stellar DEX' na Stellar Wallet. "
                "Mencione que XLM ↔ USDC está disponível diretamente."
            )
            reply = await self.gemini.generate_reply(
                instruction=instruction, user_text=clean_text, history=history
            )
            return {"intent": intent, "reply_text": reply, "execution": {"status": "redirect_stellar_dex"}}

        # --- evm_transfer_prepare — usuário assina na PRÓPRIA wallet EVM (espelho do
        # fluxo swap_xdr/Freighter): preparamos a tx ERC-20 e o front mostra o botão ---
        if intent.action == "evm_transfer_prepare":
            evm_wallet = self._extract_evm_wallet_from_note(text)
            amount = float(intent.entities.get("amount") or 0)
            dest = intent.entities.get("to_address")
            dest_chain = intent.entities.get("dest_chain", "arc")

            if dest_chain != "arc":
                instruction = (
                    f"{_PLATFORM_CONTEXT} "
                    f"O usuário quer enviar {amount or 'X'} USDC da wallet EVM dele direto para uma wallet "
                    f"{dest_chain}. O envio cross-chain assinado pela própria wallet do usuário ainda não está "
                    "disponível no chat — hoje o trilho CCTP (burn no Arc → mint no destino) é executado pelo "
                    "agente autônomo a partir da treasury, nos payouts de campanha. Explique isso honestamente "
                    "e ofereça as alternativas: (1) transferência USDC direto no Arc para um endereço 0x, que "
                    "ele assina na própria wallet agora mesmo; (2) participar de campanha e receber o payout "
                    "cross-chain do agente na wallet dele. Máximo 4 frases."
                )
                reply = await self.gemini.generate_reply(
                    instruction=instruction, user_text=clean_text, history=history
                )
                return {
                    "intent": intent,
                    "reply_text": reply,
                    "execution": {"status": "bridge_from_user_unavailable", "dest_chain": dest_chain},
                }

            if not dest or amount <= 0:
                instruction = (
                    f"{_PLATFORM_CONTEXT} "
                    "O usuário quer enviar USDC no Arc mas faltou o valor e/ou o endereço 0x de destino. "
                    "Peça o que falta, num tom leve. Máximo 2 frases."
                )
                reply = await self.gemini.generate_reply(
                    instruction=instruction, user_text=clean_text, history=history
                )
                return {"intent": intent, "reply_text": reply, "execution": {"status": "evm_transfer_missing_info"}}

            if not settings.arc_usdc_address:
                return {
                    "intent": intent,
                    "reply_text": "A transferência USDC no Arc está indisponível agora (ARC_USDC_ADDRESS não configurado). 😔",
                    "execution": {"status": "evm_transfer_unconfigured", "animation": "Ouch"},
                }

            # calldata ERC-20 transfer(address,uint256) — USDC tem 6 decimais
            amount_units = int(round(amount * 1_000_000))
            calldata = (
                "0xa9059cbb"
                + dest[2:].lower().rjust(64, "0")
                + format(amount_units, "x").rjust(64, "0")
            )
            execution = {
                "status": "evm_tx_ready",
                "chain": "arc",
                "evm_tx": {"to": settings.arc_usdc_address, "data": calldata, "value": "0x0"},
                "transfer": {"to": dest, "amount_usdc": amount, "token": "USDC"},
                "from_wallet": evm_wallet,
                "animation": "Cheer",
            }
            instruction = (
                f"{_PLATFORM_CONTEXT} "
                f"Transação preparada: enviar {amount} USDC para {dest} na rede Arc. "
                "Apresente um resumo curto (valor, destino encurtado, rede Arc, token USDC) e diga que é só "
                "clicar no botão abaixo para assinar na wallet conectada — a XiaoLee NÃO tem acesso à chave "
                "privada e nada é enviado sem a assinatura. Máximo 3 frases."
            )
            try:
                reply = await self.gemini.generate_reply(
                    instruction=instruction, user_text=clean_text, history=history
                )
            except Exception:
                reply = (
                    f"Transação pronta! 💸 {amount} USDC → `{dest[:10]}…{dest[-6:]}` na rede Arc. "
                    "É só assinar na sua wallet no botão abaixo — eu não tenho acesso à sua chave privada."
                )
            return {"intent": intent, "reply_text": reply, "execution": execution}

        # --- run_campaign_agent / discover_creators / pay_creator ---
        if intent.action in ("run_campaign_agent", "discover_creators", "pay_creator", "check_budget"):
            campaign_id = intent.entities.get("campaign_id")
            treasury_fetched = False
            if intent.action == "run_campaign_agent" and campaign_id:
                instruction = (
                    f"{_PLATFORM_CONTEXT} "
                    f"O usuário quer disparar o agente de campanha para a campanha #{campaign_id}. "
                    "Informe que o agente autônomo XiaoLee vai descobrir creators elegíveis, avaliá-los "
                    "e pagar os melhores em USDC via Arc/Circle. "
                    "Diga que pode fazer isso via API: POST /v1/agent/run-campaign. "
                    "Seja animada e direta — máximo 2 frases."
                )
            elif intent.action == "check_budget":
                # Saldo REAL da treasury Arc — read-only, alto valor de demo
                treasury_line = ""
                try:
                    from server.routes.arc_routes import _arc_client
                    balance = await _arc_client().get_usdc_balance()
                    treasury_line = f"Saldo REAL da treasury no Arc agora: {balance:.2f} USDC. "
                    treasury_fetched = True
                except Exception as exc:
                    logger.warning("check_budget: falha ao buscar saldo Arc: %s", exc)
                instruction = (
                    f"{_PLATFORM_CONTEXT} "
                    f"{treasury_line}"
                    "O usuário perguntou sobre budget/saldo USDC do trilho Arc/Circle. "
                    "Se o saldo real foi informado acima, apresente-o com destaque. "
                    "Explique que é a treasury que o agente usa para pagar creators "
                    "(Arc direto ou Solana/Stellar via CCTP)."
                )
            else:
                instruction = (
                    f"{_PLATFORM_CONTEXT} "
                    "O usuário está interagindo com o sistema de agente Arc. "
                    f"Ação solicitada: {intent.action}. "
                    "Explique brevemente as capacidades do agente: descoberta de creators, avaliação e pagamento USDC. "
                    "Oriente a usar a API /v1/agent/run-campaign para disparar o loop autônomo."
                )
            reply = await self.gemini.generate_reply(
                instruction=instruction, user_text=clean_text, history=history
            )
            arc_execution = {"status": "arc_agent", "campaign_id": campaign_id}
            if treasury_fetched:
                arc_execution["animation"] = "Cheer"
            return {"intent": intent, "reply_text": reply, "execution": arc_execution}

        # --- campaign_info ---
        if intent.action == "campaign_info":
            instruction = (
                f"{_PLATFORM_CONTEXT} {wallet_ctx} "
                "The user is asking about campaigns. "
                "Explain how campaigns work on XiaoLee: projects create campaigns, users join them, "
                "complete social tasks (follow, reply, retweet), and earn USDC as rewards — real money, "
                "paid straight to their wallet, typically a fraction of a dollar per task. "
                "Be enthusiastic — this is the core of the platform!"
            )
            reply = await self.gemini.generate_reply(
                instruction=instruction, user_text=clean_text, history=history
            )
            return {"intent": intent, "reply_text": reply, "execution": {"status": "info", "animation": "Cheer"}}

        # --- greeting ---
        if intent.action == "greeting":
            evm_wallet_note = self._extract_evm_wallet_from_note(text)
            instruction = (
                f"{_PLATFORM_CONTEXT} "
                f"{self._chains_ctx(evm_wallet_note, stellar_wallet)} "
                "O usuário está te cumprimentando. Dê as boas-vindas com a personalidade completa da XiaoLee. "
                "Mencione brevemente 1-2 coisas que você pode fazer PARA A WALLET/CHAIN dele (contexto acima); "
                "se não houver wallet, convide a conectar pelo Connect Wallet ou pergunte a chain preferida. "
                "Seja calorosa, concisa — máximo 2 a 3 frases."
            )
            reply = await self.gemini.generate_reply(
                instruction=instruction, user_text=clean_text, history=history
            )
            return {"intent": intent, "reply_text": reply, "execution": {"status": "greeting", "animation": "Hello"}}

        # --- help / general fallback ---
        evm_wallet_note = self._extract_evm_wallet_from_note(text)
        instruction = (
            f"{_PLATFORM_CONTEXT} {self._chains_ctx(evm_wallet_note, stellar_wallet)} "
            "Responda a pergunta do usuário de forma natural, ancorada na wallet/chain do contexto acima. "
            "Se for sobre Arc, Circle, USDC, campanhas, agente, CCTP, x402, Stellar ou crypto em geral "
            "— seja precisa e útil. "
            "Se for completamente fora do tema, redirecione gentilmente para o que você pode ajudar."
        )
        reply = await self.gemini.generate_reply(
            instruction=instruction, user_text=clean_text, history=history
        )
        return {"intent": intent, "reply_text": reply, "execution": {"status": "info"}}
