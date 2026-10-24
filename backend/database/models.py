"""
SQLAlchemy 2.0 models for Xiao Lee AI Crypto Agent.

Modern models using Mapped[] and mapped_column() syntax with proper relationships.
All models inherit from Base which provides id, created_at, updated_at automatically.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import BigInteger, Float, String, Integer, ForeignKey, Numeric, Text, Boolean, DateTime, UniqueConstraint, func
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
    # Preenchidos quando o payout on-chain é aceito: base do teto diário e do "1 pagamento por carteira".
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    paid_wallet: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
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


class UsageCounter(Base):
    """Contador diário (UTC) de mensagens que chegam na LLM, por identidade e global (key='global')."""
    __tablename__ = 'usage_counters'
    __table_args__ = (UniqueConstraint('key', 'day', name='uq_usage_counters_key_day'),)

    key: Mapped[str] = mapped_column(String(255), index=True)
    day: Mapped[str] = mapped_column(String(10))  # YYYY-MM-DD
    count: Mapped[int] = mapped_column(Integer, default=0)


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

    status: pending (URL de upload emitida) → uploaded → transcribing → transcribed | failed;
    expired = original e cortes apagados do bucket (retenção, ver server/media_maintenance.py).
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


class MediaGlossary(Base):
    """Termos do creator que a transcrição deve acertar (marcas, projetos, jargão). Uma linha por usuário;
    `terms` é JSON (lista de strings). Fica fora de `users` para não se misturar ao perfil do onboarding."""
    __tablename__ = 'media_glossaries'

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    terms: Mapped[str] = mapped_column(Text)


class MediaClip(Base):
    """Corte vertical (9:16, legendado) de um MediaAsset — saída do Clipper (#29).

    status: pending → rendering → ready | failed | expired. `start_s`/`end_s` são na mídia original;
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
    # crop | fit com que o corte foi renderizado (a escolha do `auto` fica registrada); None = cortes antigos.
    layout: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    # JSON {palavra errada: certa}: correções de legenda do creator, aplicadas ao re-renderizar (None = nenhuma).
    caption_fixes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class CreatorReport(Base):
    """Relatório de 30 dias do creator (server/creator_report.py): métricas do período + sugestões da IA.

    Um por (usuário, início do período) — o job pode rodar de novo sem duplicar. `metrics_json` guarda o
    período e o anterior ({"current": {...}, "previous": {...}}); `suggestions_json` é [{title, action, why}].
    """
    __tablename__ = 'creator_reports'
    __table_args__ = (UniqueConstraint('user_id', 'period_start', name='uq_creator_report_period'),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    period_start: Mapped[datetime] = mapped_column(DateTime)
    period_end: Mapped[datetime] = mapped_column(DateTime)
    metrics_json: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text)
    suggestions_json: Mapped[str] = mapped_column(Text)
    lang: Mapped[str] = mapped_column(String(8), default='en')


class SocialAccount(Base):
    """Conta de rede social do creator conectada à Xiaolee (uma por plataforma por usuário).

    `credentials_enc` é JSON cifrado (EncryptionService) com o que a rede exige para postar; nunca sai da API
    nem vai a log. Desconectar apaga a linha (e o token junto). status: active | error.
    """
    __tablename__ = 'social_accounts'
    __table_args__ = (UniqueConstraint('user_id', 'platform', name='uq_social_account_platform'),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    platform: Mapped[str] = mapped_column(String(20))  # telegram | bluesky | x | tiktok
    external_id: Mapped[str] = mapped_column(String(128))
    handle: Mapped[str] = mapped_column(String(128))
    credentials_enc: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default='active')


class PostPublication(Base):
    """Um post feito (ou tentado) pela Xiaolee em nome do creator. Gravado `pending` ANTES de chamar a rede
    (intent log) e base das métricas. status: pending → published | failed."""
    __tablename__ = 'post_publications'

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    clip_id: Mapped[Optional[int]] = mapped_column(ForeignKey("media_clips.id"), nullable=True)
    platform: Mapped[str] = mapped_column(String(20), index=True)
    caption: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default='pending', index=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    external_post_id: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    metrics_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    metrics_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class SyntheticCreator(Base):
    """Persona sintética do creator: foto de referência (R2) + voz pronta do ElevenLabs. Pode ser o próprio rosto,
    um personagem ou meme (o creator aceita o termo de direitos). status: pending (URL de upload emitida) → ready."""
    __tablename__ = 'synthetic_creators'

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    voice_id: Mapped[str] = mapped_column(String(64))
    ref_image_key: Mapped[str] = mapped_column(Text, unique=True)
    ref_content_type: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(20), default='pending')
    # Quando o creator aceitou o termo de direitos de imagem (dono, paródia ou fan content; não enganar/assediar).
    rights_confirmed_at: Mapped[datetime] = mapped_column(DateTime)


class CreatorVideo(Base):
    """Vídeo falado de uma persona. Gravado ANTES do relay do pagamento (intent log; `payment_nonce` único
    = anti-replay). status: paying → queued → voice → video → done | failed (`refund_due` se já pago)."""
    __tablename__ = 'creator_videos'

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("synthetic_creators.id"), index=True)
    quality: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(100))
    duration_s: Mapped[int] = mapped_column()
    script: Mapped[str] = mapped_column(Text)
    price_usdc: Mapped[float] = mapped_column(Numeric(12, 6))
    payment_from: Mapped[str] = mapped_column(String(64))
    payment_nonce: Mapped[str] = mapped_column(String(80), unique=True)
    payment_tx: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default='paying', index=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    refund_due: Mapped[bool] = mapped_column(Boolean, default=False)
    video_key: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Mimic: vídeo de movimento no R2 e quando o usuário declarou ter o direito de usá-lo (prova numa denúncia).
    motion_key: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    motion_rights_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Mimic: none | original (som do vídeo de referência) | voice (narração com a voz da persona).
    audio: Mapped[str] = mapped_column(String(10), default='none', server_default='none')
    # Swap: a prévia aprovada (`creator_previews.id`) cujo quadro vira a imagem do vídeo.
    preview_id: Mapped[Optional[int]] = mapped_column(nullable=True, index=True)
    # Mimic/Swap: segundo do vídeo de referência onde o trecho de `duration_s` começa (0 = do início).
    motion_start_s: Mapped[float] = mapped_column(Float, default=0.0, server_default='0')


class CreatorPreview(Base):
    """Prévia do Swap: o primeiro quadro do vídeo de referência com o personagem no lugar da pessoa. Grátis para o
    usuário (limite diário); o vídeo só é cobrado e gerado depois de aprovada. status: working → ready | failed."""
    __tablename__ = 'creator_previews'

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("synthetic_creators.id"), index=True)
    motion_key: Mapped[str] = mapped_column(Text)
    motion_start_s: Mapped[float] = mapped_column(Float, default=0.0, server_default='0')
    frame_key: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default='working')
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class OnoffIntent(Base):
    """Depósito ou saque de fiat/cripto (server/onoff.py). Gravado ANTES de qualquer chamada ao provedor
    (intent log durável). Só avança pela máquina de estados de `onoff.advance`; cada passo vira um `OnoffEvent`.
    A XiaoLee não guarda dados bancários nem documentos: quem paga/cobra o fiat é o provedor licenciado."""
    __tablename__ = 'onoff_intents'

    intent_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    direction: Mapped[str] = mapped_column(String(10))            # 'deposit' | 'withdraw'
    method: Mapped[str] = mapped_column(String(24))               # card | apple_pay | google_pay | pix | bank | chain
    provider: Mapped[str] = mapped_column(String(32))
    amount_usdc: Mapped[float] = mapped_column(Numeric(20, 8))
    fiat_currency: Mapped[Optional[str]] = mapped_column(String(3), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default='created', index=True)
    provider_ref: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    dest_network: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    dest_address: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    onchain_tx: Mapped[Optional[str]] = mapped_column(Text, nullable=True)       # saque entre redes: burn assinado pelo usuário
    forward_tx: Mapped[Optional[str]] = mapped_column(Text, nullable=True)       # saque entre redes: mint feito pelo Forwarding Service
    max_fee_usdc: Mapped[Optional[float]] = mapped_column(Numeric(20, 8), nullable=True)  # teto de taxa cotado (burn = valor + teto)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class OnoffEvent(Base):
    """Trilha de auditoria append-only das mudanças de estado de um `OnoffIntent`. Nunca se atualiza nem apaga.
    `event_id` (id do evento no provedor) é único: é o anti-replay dos webhooks."""
    __tablename__ = 'onoff_events'

    intent_id: Mapped[int] = mapped_column(ForeignKey("onoff_intents.id"), index=True)
    from_status: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    to_status: Mapped[str] = mapped_column(String(24))
    actor: Mapped[str] = mapped_column(String(16))                # system | user | webhook
    event_id: Mapped[Optional[str]] = mapped_column(String(128), unique=True, nullable=True)
    payload_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)


class OnoffKyc(Base):
    """Resultado do KYC/KYB feito pelo provedor. Só o veredito: nenhum documento é guardado aqui."""
    __tablename__ = 'onoff_kyc'
    __table_args__ = (UniqueConstraint('user_id', 'provider', name='uq_onoff_kyc_user_provider'),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    provider: Mapped[str] = mapped_column(String(32))
    level: Mapped[int] = mapped_column(default=0)                 # 0 nenhum, 1 básico, 2 completo
    status: Mapped[str] = mapped_column(String(16), default='none')   # none | pending | approved | rejected
    subject: Mapped[str] = mapped_column(String(8), default='person') # person | business
    customer_ref: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
