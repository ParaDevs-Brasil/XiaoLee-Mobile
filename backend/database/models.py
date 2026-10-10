"""
SQLAlchemy 2.0 models for Xiao Lee AI Crypto Agent.

Modern models using Mapped[] and mapped_column() syntax with proper relationships.
All models inherit from Base which provides id, created_at, updated_at automatically.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import BigInteger, String, ForeignKey, Numeric, Text, Boolean, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.orm import DeclarativeBase

from .base import Base


class User(Base):
    __tablename__ = 'users'

    twitter_handle: Mapped[str] = mapped_column(String(255), unique=True)
    twitter_user_id: Mapped[str] = mapped_column(unique=True)
    telegram_chat_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True, unique=True)
    stellar_wallet: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    # Perfil do onboarding (S2). `social_links`/`interest_profile` guardam JSON em texto.
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    social_links: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    interest_profile: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Glossário do creator (JSON: lista de termos): nomes de projetos/marcas/jargão que o Whisper erra.
    glossary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class Wallet(Base):
    __tablename__ = 'wallets'
    
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    address: Mapped[str] = mapped_column(String(255), unique=True)
    private_key_encrypted: Mapped[str] = mapped_column(Text)


class TokenBalance(Base):
    __tablename__ = 'tokenbalances'
    
    user_id: Mapped[str] = mapped_column(String(255))  # Twitter user ID
    token_symbol: Mapped[str] = mapped_column(String(10))
    balance: Mapped[float] = mapped_column(Numeric(20, 8), default=0.0)


class TokenPrice(Base):
    __tablename__ = 'tokenprices'
    
    symbol: Mapped[str] = mapped_column(unique=True)
    name: Mapped[str] = mapped_column(String(255))
    price_usd: Mapped[float] = mapped_column(Numeric(20, 8))
    decimals: Mapped[int] = mapped_column(default=18)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class SwapHistory(Base):
    __tablename__ = 'swaphistorys'

    user_id: Mapped[str] = mapped_column(String(255))
    from_token: Mapped[str] = mapped_column(String(255))
    to_token: Mapped[str] = mapped_column(String(255))
    from_amount: Mapped[float] = mapped_column(Numeric(20, 8))
    to_amount: Mapped[float] = mapped_column(Numeric(20, 8))
    exchange_rate: Mapped[float] = mapped_column(Numeric(20, 8))
    value_usd: Mapped[Optional[float]] = mapped_column(Numeric(20, 8), nullable=True)
    status: Mapped[str] = mapped_column(default="completed")
    # ADR-006: suporte multi-chain
    chain: Mapped[str] = mapped_column(String(16), default='stellar', server_default='stellar')
    tx_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class TransactionHistory(Base):
    __tablename__ = 'transactionhistorys'
    
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    transaction_type: Mapped[str] = mapped_column(String(255))
    token_symbol: Mapped[str] = mapped_column(String(255))
    amount: Mapped[float] = mapped_column(Numeric(20, 8))
    tx_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    to_address: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(default="pending")
    confirmation_blocks: Mapped[int] = mapped_column(default=0, nullable=True)
    gas_used: Mapped[int] = mapped_column(nullable=True)
    gas_price: Mapped[float] = mapped_column(Numeric(20, 8), nullable=True)
    error_message: Mapped[str] = mapped_column(Text, nullable=True)
    sender_twitter_handle: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    recipient_twitter_handle: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)


class DMLog(Base):
    __tablename__ = 'dmlogs'

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    message_type: Mapped[str] = mapped_column(default="user")
    content: Mapped[str] = mapped_column(Text)
    platform: Mapped[str] = mapped_column(String(50), default="twitter")
    twitter_message_id: Mapped[Optional[str]] = mapped_column(nullable=True)
    conversation_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    session_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    request_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    processing_time_ms: Mapped[Optional[int]] = mapped_column(nullable=True)
    error_occurred: Mapped[bool] = mapped_column(Boolean, default=False)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class ChatSession(Base):
    """Web chat thread. Messages live in DMLog rows tagged with str(id) as session_id."""
    __tablename__ = 'chat_sessions'

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(120), default="New chat")
    # last activity — reuses Base.updated_at, bumped explicitly in touch_chat_session()


class AuthToken(Base):
    __tablename__ = 'auth_tokens'

    token: Mapped[str] = mapped_column(Text, unique=True, index=True)
    twitter_user_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    twitter_handle: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Store fetched handle
    status: Mapped[str] = mapped_column(Text, default='pending') # pending, active, expired
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class PendingTransfer(Base):
    __tablename__ = 'pending_transfers'

    from_twitter_user_id: Mapped[str] = mapped_column(Text)
    from_twitter_handle: Mapped[str] = mapped_column(Text)
    recipient_twitter_handle: Mapped[str] = mapped_column(Text, index=True)
    token_symbol: Mapped[str] = mapped_column(Text)
    amount: Mapped[float] = mapped_column(Numeric(20, 8))
    status: Mapped[str] = mapped_column(Text, default='pending') # pending, claimed
    claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Campaign(Base):
    __tablename__ = 'campaigns'

    creator_twitter_user_id: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text, unique=True, index=True)
    description: Mapped[str] = mapped_column(Text)
    campaign_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reward_token: Mapped[str] = mapped_column(Text)
    reward_per_participant: Mapped[float] = mapped_column(Numeric(20, 8))
    max_participants: Mapped[int]
    reward_pool: Mapped[float] = mapped_column(Numeric(20, 8))
    status: Mapped[str] = mapped_column(Text, default='pending') # pending, active, completed, cancelled
    creation_step: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    profile_to_follow: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tweet_id_to_engage: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class CampaignParticipant(Base):
    __tablename__ = 'campaign_participants'
    # Garante que um usuário não pode participar da mesma campanha duas vezes.
    __table_args__ = (UniqueConstraint('campaign_id', 'user_id', name='uq_participant_campaign_user'),)

    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(Text, default='enrolled') # enrolled, tasks_verified, paid
    # Usa timezone-aware para compatibilidade com Python 3.12+ e SQLAlchemy 2.0
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    has_followed: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    has_replied: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    has_retweeted: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    has_quoted: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    tasks_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    claim_receipt_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # ADR-006: suporte multi-chain
    chain: Mapped[str] = mapped_column(String(16), default='stellar', server_default='stellar')
    stellar_wallet: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    solana_wallet: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)


class WebSession(Base):
    __tablename__ = 'web_sessions'

    session_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    twitter_user_id: Mapped[str] = mapped_column(String(255))
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class ProcessedDM(Base):
    __tablename__ = 'processed_dms'

    twitter_message_id: Mapped[str] = mapped_column(String(255), unique=True) 


class UsedPayment(Base):
    __tablename__ = 'used_payments'

    tx_hash: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    amount_xlm: Mapped[Optional[float]] = mapped_column(Numeric(20, 8), nullable=True)
    network: Mapped[str] = mapped_column(String(16), default='testnet')
    verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PaymentIntent(Base):
    __tablename__ = 'payment_intents'

    intent_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"), index=True)
    creator_id: Mapped[str] = mapped_column(Text, index=True)
    amount_usdc: Mapped[float] = mapped_column(Numeric(20, 8))
    status: Mapped[str] = mapped_column(String(50), default='pending')
    arc_tx_hash:  Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    receipt_pqc:  Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    executed_at:  Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class SettledPayment(Base):
    """Feed de tração persistido (POST /v1/payments/settled) — hidrata server/metrics.py no boot
    para o dashboard sobreviver a restart do backend."""
    __tablename__ = 'settled_payments'

    intent_id:      Mapped[str] = mapped_column(Text, unique=True, index=True)
    creator_handle: Mapped[str] = mapped_column(Text, index=True)
    amount_usdc:    Mapped[float] = mapped_column(Numeric(20, 8))
    tx:             Mapped[str] = mapped_column(Text)
    latency_ms:     Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    settled_at:     Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ArcTransfer(Base):
    """Transferência USDC no Arc relayada via `POST /v1/arc/usdc/relay-authorization`
    (autorização EIP-3009 assinada pelo usuário, gas pago pela treasury). A rota é
    pública — quem autoriza é a assinatura, não uma sessão —, então o endereço da
    wallet é a chave de consulta, não um user_id."""
    __tablename__ = 'arc_transfers'

    from_address: Mapped[str] = mapped_column(String(42), index=True)
    to_address:   Mapped[str] = mapped_column(String(42), index=True)
    amount_usdc:  Mapped[float] = mapped_column(Numeric(20, 8))
    tx_hash:      Mapped[str] = mapped_column(String(66), unique=True, index=True)


class CctpTransfer(Base):
    """Transferência CCTP real (burn->attest->receive) em qualquer domain suportado pela Circle
    (EVM, Solana domain 5, Stellar domain 27). Generaliza o BridgeState/BridgeStep in-memory de
    cctp_client.py para persistência/recovery multi-chain, mesmo padrão de intent durável do
    PaymentIntent."""
    __tablename__ = 'cctp_transfers'

    intent_id:        Mapped[str] = mapped_column(String(36), unique=True, index=True)
    campaign_id:      Mapped[Optional[int]] = mapped_column(ForeignKey("campaigns.id"), nullable=True, index=True)
    direction:        Mapped[str] = mapped_column(String(16))   # 'outflow' | 'inflow'
    source_domain:    Mapped[int] = mapped_column()
    dest_domain:      Mapped[int] = mapped_column()
    counterparty:     Mapped[str] = mapped_column(Text)
    amount_usdc:      Mapped[float] = mapped_column(Numeric(20, 8))
    status:           Mapped[str] = mapped_column(String(50), default='pending')  # pending, burned, attesting, attested, received, failed
    source_tx_hash:   Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    message_hash:     Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    dest_tx_hash:     Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    receipt_pqc:      Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error_message:    Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    executed_at:      Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class OnchainEvent(Base):
    __tablename__ = 'onchain_events'

    signature: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    event_type: Mapped[str] = mapped_column(String(50), index=True)
    status: Mapped[str] = mapped_column(String(50), default='received')
    source: Mapped[str] = mapped_column(String(50), default='helius')
    raw_payload: Mapped[str] = mapped_column(Text)
    tx_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class NotificationEvent(Base):
    __tablename__ = 'notification_events'

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    channel: Mapped[str] = mapped_column(String(50), default='in_app')
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default='pending')
    related_signature: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    metadata_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    delivered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

class MediaAsset(Base):
    """Vídeo/áudio bruto do criador (bucket R2) — insumo do Clipper.

    status: pending (URL de upload emitida) → uploaded → transcribing → transcribed | failed.
    `r2_key` é o URI no storage; `sha256` é declarado pelo cliente (não verificado no servidor).
    """
    __tablename__ = 'media_assets'

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(10))  # video | audio
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    r2_key: Mapped[str] = mapped_column(Text, unique=True)
    status: Mapped[str] = mapped_column(String(20), default='pending', index=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    duration_s: Mapped[Optional[float]] = mapped_column(nullable=True)
    # Nome que o creator dá ao vídeo; `None` = vale o `filename`.
    title: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    # JPEG de um quadro do vídeo (R2), para a lista. `None` = ainda não gerado (ou áudio).
    thumb_key: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class MediaTranscript(Base):
    """Transcrição de um MediaAsset (uma por mídia; refazer substitui). `segments_json`: [{start,end,text}]."""
    __tablename__ = 'media_transcripts'

    media_id: Mapped[int] = mapped_column(ForeignKey("media_assets.id"), unique=True)
    segments_json: Mapped[str] = mapped_column(Text)
    language: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    model: Mapped[str] = mapped_column(String(100))


class MediaClip(Base):
    """Corte vertical (9:16, legendado) de um MediaAsset — saída do Clipper (#29).

    status: pending → rendering → ready | failed. `start_s`/`end_s` são na mídia original;
    `r2_key` é o mp4 renderizado (só existe quando `ready`).
    """
    __tablename__ = 'media_clips'

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    media_id: Mapped[int] = mapped_column(ForeignKey("media_assets.id"), index=True)
    rank: Mapped[int] = mapped_column()  # 1 = melhor
    start_s: Mapped[float] = mapped_column()
    end_s: Mapped[float] = mapped_column()
    title: Mapped[str] = mapped_column(String(120))
    reason: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20), default='pending', index=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    r2_key: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    size_bytes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    # JPEG de um quadro do corte já renderizado (com a legenda queimada).
    thumb_key: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
