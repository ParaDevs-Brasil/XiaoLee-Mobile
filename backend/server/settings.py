from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv(usecwd=False))


def _parse_csv_env(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    items = [part.strip() for part in raw.split(",") if part.strip()]
    return items or [default]


GROQ_BASE_URL = "https://api.groq.com/openai/v1"


def _transcription_config(env) -> tuple[str, str, str]:
    """(api_key, base_url, model) da transcrição. TRANSCRIPTION_* manda; senão GROQ_API_KEY
    liga o Groq (URL + whisper-large-v3-turbo); senão OPENAI_API_KEY com whisper-1."""
    explicit = env.get("TRANSCRIPTION_API_KEY", "")
    groq = not explicit and bool(env.get("GROQ_API_KEY"))
    key = explicit or env.get("GROQ_API_KEY") or env.get("OPENAI_API_KEY", "")
    base_url = env.get("TRANSCRIPTION_BASE_URL") or (GROQ_BASE_URL if groq else "")
    model = env.get("TRANSCRIPTION_MODEL") or ("whisper-large-v3-turbo" if groq else "whisper-1")
    return key, base_url, model


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("XIAOLEE_APP_NAME", "XiaoLee Core API")
    app_version: str = os.getenv("XIAOLEE_APP_VERSION", "2.0.0-mvp")
    environment: str = os.getenv("XIAOLEE_ENV", "dev")

    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    # ── LLM provider / Claude (engine agêntica) ──────────────────────────────────
    # LLM_PROVIDER=anthropic ativa o loop agêntico Claude no OrchestrationService.
    llm_provider: str = os.getenv("LLM_PROVIDER", "gemini")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    solana_rpc_url: str = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
    solana_cluster: str = os.getenv("SOLANA_CLUSTER", "devnet")
    jupiter_quote_url: str = os.getenv(
        "JUPITER_QUOTE_URL", "https://quote-api.jup.ag/v6/quote"
    )
    jupiter_swap_url: str = os.getenv(
        "JUPITER_SWAP_URL", "https://quote-api.jup.ag/v6/swap"
    )

    telegram_bot_token: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    telegram_bot_name: str = os.getenv("TELEGRAM_BOT_NAME", "")
    telegram_webhook_secret: str = os.getenv("TELEGRAM_WEBHOOK_SECRET", "")
    # Set TELEGRAM_POLLER_ENABLED=false on Railway to disable long-polling there
    # and let only the local Docker instance own the bot session.
    telegram_poller_enabled: bool = os.getenv("TELEGRAM_POLLER_ENABLED", "true").lower() not in ("false", "0", "no")
    x_webhook_secret: str = os.getenv("X_WEBHOOK_SECRET", "")
    x_bearer_token: str = os.getenv("X_BEARER_TOKEN", "")
    x_dm_api_base_url: str = os.getenv("X_DM_API_BASE_URL", "https://api.x.com")
    inbound_rate_limit_per_minute: int = int(os.getenv("INBOUND_RATE_LIMIT_PER_MINUTE", "60"))
    cors_allowed_origins: list[str] = None
    cors_allowed_origin_regex: str = ""
    
    helius_api_key: str = os.getenv("HELIUS_API_KEY", "")
    helius_webhook_secret: str = os.getenv("HELIUS_WEBHOOK_SECRET", "")

    # Chave privada do admin do protocolo (base58) para assinar transacoes Anchor.
    solana_admin_keypair_b58: str = os.getenv("SOLANA_ADMIN_KEYPAIR_B58", "")

    # Redis para rate limiting persistente.
    # Se nao definida, o rate limiter usa in-memory (nao persiste entre restarts).
    # Producao: redis://user:pass@host:6379/0  ou  rediss:// para TLS
    redis_url: str = os.getenv("REDIS_URL", "")

    # ── Mídia do Clipper (S4): bucket Cloudflare R2 (compatível com S3) ──────────
    r2_account_id:        str = os.getenv("R2_ACCOUNT_ID",        "")
    r2_access_key_id:     str = os.getenv("R2_ACCESS_KEY_ID",     "")
    r2_secret_access_key: str = os.getenv("R2_SECRET_ACCESS_KEY", "")
    r2_bucket:            str = os.getenv("R2_BUCKET",            "")
    # Opcional: qualquer storage S3-compatível (MinIO local, Backblaze B2...) no lugar do R2.
    r2_endpoint_url:      str = os.getenv("R2_ENDPOINT_URL",      "")
    r2_region:            str = os.getenv("R2_REGION",            "auto")
    media_max_bytes:      int = int(os.getenv("MEDIA_MAX_BYTES", str(2 * 1024**3)))
    # Transcrição: endpoint OpenAI-compatível. GROQ_API_KEY sozinha já configura o Groq (ver _transcription_config).
    transcription_api_key:  str = _transcription_config(os.environ)[0]
    transcription_base_url: str = _transcription_config(os.environ)[1]
    transcription_model:    str = _transcription_config(os.environ)[2]

    # ── Arc / Circle Programmable Wallets (W3S) ──────────────────────────────────
    circle_api_key:       str  = os.getenv("CIRCLE_API_KEY",        "")
    circle_wallet_id:     str  = os.getenv("CIRCLE_WALLET_ID",      "")
    # Entity secret (32 bytes hex) — exigido por TODA transação live (transfer/criar wallet).
    # Cada request envia um entitySecretCiphertext RSA-OAEP fresco gerado a partir dele.
    circle_entity_secret: str  = os.getenv("CIRCLE_ENTITY_SECRET",  "")
    # Nome da blockchain na API Circle: "ETH-SEPOLIA" | "ARC-SEPOLIA" | "BASE-SEPOLIA"
    circle_blockchain:    str  = os.getenv("CIRCLE_BLOCKCHAIN",     "ETH-SEPOLIA")
    # Token ID do USDC na chain — resolvido automaticamente via API se vazio
    circle_usdc_token_id: str  = os.getenv("CIRCLE_USDC_TOKEN_ID",  "")
    arc_sandbox:          bool = os.getenv("ARC_SANDBOX", "true").lower() == "true"

    # ── Arc RPC (Canteen testnet / mainnet) ───────────────────────────────────────
    arc_rpc_url: str = os.getenv("ARC_RPC_URL", "")

    # ── CCTP — Cross-Chain Transfer Protocol ─────────────────────────────────────
    cctp_enabled:              bool = os.getenv("CCTP_ENABLED", "false").lower() == "true"
    cctp_source_rpc:           str  = os.getenv("CCTP_SOURCE_RPC",            "")
    cctp_signer_private_key:   str  = os.getenv("CCTP_SIGNER_PRIVATE_KEY",    "")
    # Contratos na chain fonte (defaults = Ethereum Sepolia)
    cctp_source_usdc:          str  = os.getenv("CCTP_SOURCE_USDC",           "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238")
    cctp_source_token_messenger: str = os.getenv("CCTP_SOURCE_TOKEN_MESSENGER","0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5")
    cctp_source_domain:        int  = int(os.getenv("CCTP_SOURCE_DOMAIN",     "0"))
    # Contratos no Arc (preencher quando disponíveis via docs do hackathon)
    arc_cctp_usdc:             str  = os.getenv("ARC_CCTP_USDC",              "")
    arc_cctp_token_messenger:  str  = os.getenv("ARC_CCTP_TOKEN_MESSENGER",   "")
    arc_cctp_msg_transmitter:  str  = os.getenv("ARC_CCTP_MSG_TRANSMITTER",   "")
    arc_cctp_domain:           int  = int(os.getenv("ARC_CCTP_DOMAIN",        "26"))  # Arc testnet domain = 26

    # ── Arc Native (EVM direto — sem Circle W3S) ─────────────────────────────────
    arc_agent_private_key: str = os.getenv("ARC_AGENT_PRIVATE_KEY", "")
    arc_usdc_address:      str = os.getenv("ARC_USDC_ADDRESS",      "")
    arc_chain_id:          int = int(os.getenv("ARC_CHAIN_ID",      "0"))  # 0 = auto
    # Teto de transferências gasless (EIP-3009) por endereço, por hora. O gas de
    # cada uma sai da conta do relay (~0.002 USDC), e a rota é autorizada por
    # assinatura, não por sessão — sem teto, a conta é drenável por repetição.
    arc_relay_rate_limit_per_hour: int = int(os.getenv("ARC_RELAY_RATE_LIMIT_PER_HOUR", "20"))

    # ── CCTP V2 — Solana (domain 5) ───────────────────────────────────────────────
    # Program IDs reais da Circle (devnet == mainnet, confirmado em developers.circle.com).
    # Sem SDK Python oficial — instrução construída manualmente via solders (mesmo padrão
    # hand-rolled de anchor_client.py). Chave de tesouraria SEPARADA de SOLANA_ADMIN_KEYPAIR_B58
    # (que é só admin do programa xiaolee_core, nunca custodia fundos).
    solana_cctp_enabled:              bool = os.getenv("SOLANA_CCTP_ENABLED", "false").lower() == "true"
    solana_cctp_domain:               int  = int(os.getenv("SOLANA_CCTP_DOMAIN", "5"))
    solana_cctp_token_messenger_minter: str = os.getenv(
        "SOLANA_CCTP_TOKEN_MESSENGER_MINTER", "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe"
    )
    solana_cctp_message_transmitter:  str  = os.getenv(
        "SOLANA_CCTP_MESSAGE_TRANSMITTER", "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"
    )
    solana_usdc_mint:                 str  = os.getenv("SOLANA_USDC_MINT", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")  # devnet
    solana_treasury_keypair_b58:      str  = os.getenv("SOLANA_TREASURY_KEYPAIR_B58", "")

    # ── CCTP V2 — Stellar (domain 27) ─────────────────────────────────────────────
    # Contratos Soroban reais da Circle (testnet, confirmado em
    # developers.circle.com/cctp/references/stellar-contracts). USDC em Stellar tem 7 casas
    # decimais (vs 6 nas demais chains) — CCTP escala automaticamente, mas o 7º decimal fica
    # retido na origem em burns. Inbound SEMPRE precisa apontar mintRecipient/destinationCaller
    # pro contrato CctpForwarder — nunca para a conta do usuário (fundos ficam presos sem
    # recovery se errar isso).
    stellar_cctp_enabled:            bool = os.getenv("STELLAR_CCTP_ENABLED", "false").lower() == "true"
    stellar_cctp_domain:             int  = int(os.getenv("STELLAR_CCTP_DOMAIN", "27"))
    stellar_cctp_token_messenger_minter: str = os.getenv(
        "STELLAR_CCTP_TOKEN_MESSENGER_MINTER", "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP"
    )
    stellar_cctp_message_transmitter: str  = os.getenv(
        "STELLAR_CCTP_MESSAGE_TRANSMITTER", "CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY"
    )
    stellar_cctp_forwarder:          str  = os.getenv(
        "STELLAR_CCTP_FORWARDER", "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ"
    )
    # Chave de tesouraria dedicada — NUNCA reaproveitar stellar_server_secret (SEP-10, comentário
    # explícito "nunca usado para fundos" — não violar).
    stellar_treasury_secret:         str  = os.getenv("STELLAR_TREASURY_SECRET", "")

    # ── Bridge multi-chain (flags gerais) ─────────────────────────────────────────
    bridge_sandbox: bool = os.getenv("BRIDGE_SANDBOX", "true").lower() == "true"

    # ── PQC — ML-DSA-87 (FIPS 204) Receipt Signing ───────────────────────────────
    pqc_enabled:    bool = os.getenv("PQC_ENABLED",    "true").lower() == "true"
    pqc_secret_key: str  = os.getenv("PQC_SECRET_KEY", "")   # base64 sk — NUNCA commitar
    pqc_public_key: str  = os.getenv("PQC_PUBLIC_KEY", "")   # base64 pk — público, pode commitar

    # ── Agent Engine ─────────────────────────────────────────────────────────────
    claude_model:    str = os.getenv("CLAUDE_MODEL",    "claude-sonnet-4-6")
    agent_max_steps: int = int(os.getenv("AGENT_MAX_STEPS", "50"))

    # ── Stellar ──────────────────────────────────────────────────────────────────
    stellar_network: str = os.getenv("STELLAR_NETWORK", "testnet")
    stellar_horizon_url: str = os.getenv("STELLAR_HORIZON_URL", "")
    # Keypair do servidor para challenges SEP-10 (nunca usado para fundos)
    stellar_server_secret: str = os.getenv("STELLAR_SERVER_SECRET", "")
    stellar_home_domain: str = os.getenv("STELLAR_HOME_DOMAIN", "xiaolee.io")
    # Carteira que recebe micropagamentos x402
    stellar_x402_wallet: str = os.getenv("STELLAR_X402_WALLET", "")
    stellar_x402_price_xlm: float = float(os.getenv("STELLAR_X402_PRICE_XLM", "0.5"))
    stellar_x402_enabled: bool = os.getenv("STELLAR_X402_ENABLED", "true").lower() == "true"

    # Headers CORS permitidos.
    cors_allowed_headers: list[str] = None

    # ── Traction / RFB-06 ────────────────────────────────────────────────────
    # Shared secret entre o agente Arc (f0ntz) e este backend.
    # Se vazio, o endpoint aceita sem autenticação (dev only).
    arc_payment_secret: str = os.getenv("ARC_PAYMENT_SECRET", "")

    # ── Circle Payments (traction) ────────────────────────────────────────────
    # circle_platform_wallet_id: wallet treasury da plataforma (paga creators).
    # circle_api_key já declarado no bloco "Arc / Circle Programmable Wallets" acima.
    circle_platform_wallet_id: str = os.getenv("CIRCLE_WALLET_ID", "")

    def __post_init__(self):
        object.__setattr__(
            self,
            "cors_allowed_origins",
            _parse_csv_env("CORS_ALLOWED_ORIGINS", "http://localhost:3000"),
        )
        cors_origin_regex = os.getenv("CORS_ALLOWED_ORIGIN_REGEX", "")
        if not cors_origin_regex and self.environment == "dev":
            cors_origin_regex = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
        object.__setattr__(self, "cors_allowed_origin_regex", cors_origin_regex)
        # Headers CORS: em producao, restringir a lista minima necessaria.
        # Por padrao aceita os headers padrao REST + Authorization.
        cors_headers_default = "Content-Type,Authorization,Accept,X-Requested-With,X-Payment,X-Payment-Required,X-Arc-Secret"
        object.__setattr__(
            self,
            "cors_allowed_headers",
            _parse_csv_env("CORS_ALLOWED_HEADERS", cors_headers_default),
        )


settings = Settings()
