"""
Router de Campanhas e Usuarios — endpoints consumidos pelo frontend Next.js.

O schema de Campaign retornado aqui espelha exatamente a interface TypeScript
Campaign definida em frontend/src/interfaces/campaign.ts.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac as _hmac
import json
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from database.database import get_db_session
from server import token_auth
import logging
from database.models import AuthToken, Campaign as CampaignModel, CampaignParticipant, NotificationEvent, User, Wallet, WebSession
from server.integrations.arc_client import ArcClient
from server.settings import settings

logger = logging.getLogger(__name__)
from fastapi import Depends
from server.metrics import record_campaign_event

from database.repository import DatabaseRepository  # noqa: E402

router = APIRouter(tags=["campaigns"])

_B58_ALPHABET = b'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'


def _b58decode_pubkey(s: str) -> bytes:
    """Decode a base58-encoded Solana public key to 32 raw bytes."""
    n = 0
    for char in s.encode():
        digit = _B58_ALPHABET.find(char)
        if digit < 0:
            raise ValueError(f"Invalid base58 character: {chr(char)}")
        n = n * 58 + digit
    try:
        return n.to_bytes(32, 'big')
    except OverflowError:
        raise ValueError("Base58 value too large to be a 32-byte Solana public key")

# Recompensa é USDC — o mesmo trilho do resto do produto (ver
# `docs/workflows/ARC_LEPTON_ARCHITECTURE.md`). Não existe mais token $XLEE.
# Valores são nanopagamentos de verdade (fração de dólar), não números de
# tokenomics: o `reward_pool` sai de `reward_per_participant * max_participants`,
# a mesma conta de `create_campaign` — antes os três pools eram 50000 fixo, o que
# não fechava com nenhum dos rewards.
DEFAULT_CAMPAIGNS = [
    {
        "id": 1,
        "name": "XiaoLee Genesis Campaign",
        "description": "Be among the first to interact with XiaoLee and earn USDC! Follow our account, retweet our launch post and send a message to our bot.",
        "campaign_type": "social",
        "completed_participants": 0,
        "created_at": "2026-04-21T00:00:00Z",
        "creator_twitter_user_id": "XiaoLeeProtocol",
        "max_participants": 1000,
        "profile_to_follow": "XiaoLeeProtocol",
        "reward_per_participant": 0.3,
        "reward_pool": 300,
        "reward_token": "USDC",
        "status": "active",
        "tweet_id_to_engage": None,
    },
    {
        "id": 2,
        "name": "Swap Challenge",
        "description": "Execute your first swap via XiaoLee AI assistant and earn bonus USDC. Just ask XiaoLee to help you swap any token!",
        "campaign_type": "trading",
        "completed_participants": 0,
        "created_at": "2026-04-21T00:00:00Z",
        "creator_twitter_user_id": "XiaoLeeProtocol",
        "max_participants": 500,
        "profile_to_follow": None,
        "reward_per_participant": 0.5,
        "reward_pool": 250,
        "reward_token": "USDC",
        "status": "active",
        "tweet_id_to_engage": None,
    },
    {
        "id": 3,
        "name": "Community Builder",
        "description": "Invite 3 friends to join XiaoLee and earn community rewards in USDC. Share your referral link and help grow the XiaoLee ecosystem.",
        "campaign_type": "referral",
        "completed_participants": 0,
        "created_at": "2026-04-21T00:00:00Z",
        "creator_twitter_user_id": "XiaoLeeProtocol",
        "max_participants": 200,
        "profile_to_follow": "XiaoLeeProtocol",
        "reward_per_participant": 1,
        "reward_pool": 200,
        "reward_token": "USDC",
        "status": "active",
        "tweet_id_to_engage": None,
    },
]


# ---------------------------------------------------------------------------
# Schemas (espelham exatamente as interfaces TypeScript do frontend)
# ---------------------------------------------------------------------------

class Campaign(BaseModel):
    id: int
    name: str
    description: str
    campaign_type: str
    completed_participants: int
    created_at: str
    creator_twitter_user_id: str
    max_participants: int
    profile_to_follow: Optional[str] = None
    reward_per_participant: float
    reward_pool: float
    reward_token: str
    status: str
    tweet_id_to_engage: Optional[str] = None


class CampaignsResponse(BaseModel):
    success: bool
    campaigns: List[Campaign]


class UserCampaignParticipation(BaseModel):
    id: int
    name: str
    description: str
    reward_token: str
    reward_per_participant: float
    campaign_type: str
    participation_status: str
    tasks_verified_at: Optional[str] = None
    tasks_claimed: bool = False
    claim_receipt_id: Optional[str] = None
    status: Optional[str] = None


class UserCampaignsResponse(BaseModel):
    success: bool
    campaigns: List[UserCampaignParticipation]


class UserResponse(BaseModel):
    id: str
    username: Optional[str] = None
    platform: Optional[str] = None
    swap_count: int = 0
    total_volume: float = 0.0
    campaigns_joined: List[int] = []
    dossier: Optional[dict] = None


class CampaignActionRequest(BaseModel):
    campaign_identifier: str
    wallet_public_key: Optional[str] = None
    wallet_signature: Optional[str] = None
    proof_message: Optional[str] = None
    proof_encoding: Optional[str] = None


class CreateCampaignRequest(BaseModel):
    title: str
    description: str
    campaign_type: str
    profile_to_follow: Optional[str] = None
    tweet_id_to_engage: Optional[str] = None
    reward_token: str
    reward_per_participant: float
    max_participants: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_user_id_from_token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header required")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Token is empty")
    return token


def _campaign_to_dict(campaign: CampaignModel, completed_participants: int = 0) -> dict:
    created_at = campaign.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    return {
        "id": campaign.id,
        "name": campaign.name,
        "description": campaign.description,
        # NULL no DB (ex: campanha criada por script sem o campo) não pode 500ar a listagem
        "campaign_type": campaign.campaign_type or "custom",
        "completed_participants": completed_participants,
        "created_at": created_at.isoformat(),
        "creator_twitter_user_id": campaign.creator_twitter_user_id,
        "max_participants": campaign.max_participants,
        "profile_to_follow": campaign.profile_to_follow,
        "reward_per_participant": float(campaign.reward_per_participant),
        "reward_pool": float(campaign.reward_pool),
        "reward_token": campaign.reward_token,
        "status": campaign.status,
        "tweet_id_to_engage": campaign.tweet_id_to_engage,
    }


def _participant_status(participant: CampaignParticipant) -> str:
    if participant.status == "paid":
        return "paid"
    if participant.status == "tasks_verified":
        return "tasks_verified"
    return "enrolled"


def _verify_claim_proof(payload: CampaignActionRequest, campaign_id: int, session_token: str) -> None:
    public_key = (payload.wallet_public_key or "").strip()
    signature = (payload.wallet_signature or "").strip()
    message = (payload.proof_message or "").strip()
    proof_encoding = (payload.proof_encoding or "").strip().lower()

    is_custodial = session_token.startswith(_CUSTODIAL_PREFIXES)

    if not public_key or not message:
        raise HTTPException(status_code=400, detail="Wallet public key and proof message are required")

    if not is_custodial and not signature:
        raise HTTPException(status_code=400, detail="Wallet signature proof is required to claim campaign rewards")

    expected_prefix = f"XiaoLee Devnet claim|campaign:{campaign_id}|session:{session_token}|wallet:{public_key}"
    if not message.startswith(expected_prefix):
        raise HTTPException(status_code=400, detail="Claim proof does not match the current campaign session")

    if proof_encoding not in {"base64", "none", "eip191"}:
        raise HTTPException(status_code=400, detail="Unsupported claim proof encoding")

    # Custodial users: identity verified via Bearer session — skip signature check
    if is_custodial:
        return

    # EVM wallet (Connect Wallet universal): assinatura EIP-191 personal_sign —
    # recupera o endereço via secp256k1 e compara com o wallet_public_key 0x…
    if public_key.startswith("0x"):
        from eth_account import Account
        from eth_account.messages import encode_defunct

        try:
            recovered = Account.recover_message(encode_defunct(text=message), signature=signature)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid claim proof payload") from exc
        if recovered.lower() != public_key.lower():
            raise HTTPException(status_code=400, detail="Invalid wallet signature for this claim")
        return

    # Solana (Phantom legado): assinatura Ed25519 sobre pubkey base58
    try:
        public_key_bytes = _b58decode_pubkey(public_key)
        signature_bytes = base64.b64decode(signature)
        message_bytes = message.encode("utf-8")
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail="Invalid claim proof payload") from exc

    try:
        Ed25519PublicKey.from_public_bytes(public_key_bytes).verify(signature_bytes, message_bytes)
    except InvalidSignature as exc:
        raise HTTPException(status_code=400, detail="Invalid wallet signature for this claim") from exc


async def resolve_twitter_identity(
    db: AsyncSession, authorization: Optional[str], *, strict: bool = False
) -> tuple[str, str]:
    """Resolve o Bearer para ``(twitter_user_id, twitter_handle)``.

    O token pode ser um ``AuthToken`` de bot (Telegram/X), um ``WebSession`` de
    login social (Google/Web3Auth via `/auth/session`) ou, no caso legado, o
    próprio twitter_user_id usado direto como token. Com ``strict=True`` o caso
    legado dá 401: só vale um token que o backend emitiu. Rotas com dados
    pessoais (perfil) usam strict; as demais seguem aceitando o legado enquanto
    houver build antigo do app em campo. Compartilhado com
    `notifications_routes.py`: resolver a sessão sem passar por aqui foi
    exatamente o bug que deixava `/v1/notifications/me` em 404 pra quem
    logou via Google — o `session_id` (`firebase_session_<uuid>`) não é o
    twitter_user_id (`firebase_<sub>`), só o `WebSession` abaixo faz essa ponte.
    """
    token = _get_user_id_from_token(authorization)
    now = datetime.now(timezone.utc)
    twitter_user_id = token
    twitter_handle = token

    auth_stmt = select(AuthToken).where(AuthToken.token == token)
    auth_res = await db.execute(auth_stmt)
    auth_token = auth_res.scalars().first()
    if auth_token:
        if auth_token.expires_at.tzinfo is None:
            auth_expires = auth_token.expires_at.replace(tzinfo=timezone.utc)
        else:
            auth_expires = auth_token.expires_at

        if auth_expires < now:
            raise HTTPException(status_code=401, detail="Authorization expired")
        twitter_user_id = auth_token.twitter_user_id or token
        twitter_handle = auth_token.twitter_handle or twitter_user_id

    web_stmt = select(WebSession).where(WebSession.session_id == token)
    web_res = await db.execute(web_stmt)
    web_session = web_res.scalars().first()
    if web_session:
        if web_session.expires_at.tzinfo is None:
            session_expires = web_session.expires_at.replace(tzinfo=timezone.utc)
        else:
            session_expires = web_session.expires_at

        if session_expires < now:
            raise HTTPException(status_code=401, detail="Authorization expired")
        twitter_user_id = web_session.twitter_user_id
        twitter_handle = web_session.twitter_user_id

    if strict and not auth_token and not web_session:
        # O twitter_user_id (ex.: o endereço da carteira, que é público) não é
        # credencial: aceitá-lo deixaria qualquer um ler/editar o perfil alheio.
        raise HTTPException(status_code=401, detail="Invalid session")

    return twitter_user_id, twitter_handle


async def resolve_optional_identity(db: AsyncSession, authorization: Optional[str]) -> Optional[str]:
    """``twitter_user_id`` do Bearer, ou None se não há Bearer (chat guest, intencional).

    Bearer presente é sempre resolvido (sessão vira o usuário real, expirada dá 401);
    antes `/chat` usava a string crua como user_id e o histórico ficava preso ao
    `session_id`, não à pessoa.
    """
    if not authorization or not authorization.removeprefix("Bearer ").strip():
        return None
    return (await resolve_twitter_identity(db, authorization))[0]


async def _resolve_user(db: AsyncSession, authorization: Optional[str], *, strict: bool = False) -> User:
    twitter_user_id, twitter_handle = await resolve_twitter_identity(db, authorization, strict=strict)

    user_stmt = select(User).where(User.twitter_user_id == twitter_user_id)
    user_res = await db.execute(user_stmt)
    user = user_res.scalars().first()
    if user:
        if twitter_handle and user.twitter_handle != twitter_handle:
            user.twitter_handle = twitter_handle
        return user

    user = User(twitter_user_id=twitter_user_id, twitter_handle=twitter_handle)
    db.add(user)
    await db.flush()
    return user


async def _seed_default_campaigns(db: AsyncSession) -> None:
    count_res = await db.execute(select(func.count()).select_from(CampaignModel))
    existing_count = count_res.scalar() or 0
    if existing_count > 0:
        return

    for campaign_data in DEFAULT_CAMPAIGNS:
        db.add(
            CampaignModel(
                id=campaign_data["id"],
                creator_twitter_user_id=campaign_data["creator_twitter_user_id"],
                name=campaign_data["name"],
                description=campaign_data["description"],
                campaign_type=campaign_data["campaign_type"],
                reward_token=campaign_data["reward_token"],
                reward_per_participant=campaign_data["reward_per_participant"],
                max_participants=campaign_data["max_participants"],
                reward_pool=campaign_data["reward_pool"],
                status=campaign_data["status"],
                profile_to_follow=campaign_data["profile_to_follow"],
                tweet_id_to_engage=campaign_data["tweet_id_to_engage"],
            )
        )

    await db.commit()


async def _get_campaign_or_404(db: AsyncSession, campaign_id: int) -> CampaignModel:
    stmt = select(CampaignModel).where(CampaignModel.id == campaign_id)
    result = await db.execute(stmt)
    campaign = result.scalars().first()
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign {campaign_id} not found")
    return campaign


def _campaign_arc_client() -> ArcClient:
    """Mesma construção de `arc_routes.py::_arc_client` — sem import cruzado
    entre módulos de rota por uma factory de 6 linhas. `sandbox=True`
    (padrão de `ARC_SANDBOX`) devolve um `sandbox_tx_...` determinístico sem
    tocar rede, então isto é seguro para rodar sem credencial Circle."""
    return ArcClient(
        api_key=settings.circle_api_key,
        wallet_id=settings.circle_wallet_id,
        blockchain=settings.circle_blockchain,
        usdc_token_id=settings.circle_usdc_token_id,
        sandbox=settings.arc_sandbox,
    )


# ---------------------------------------------------------------------------
# Auth status stub (evita 404 no useAuth)
# ---------------------------------------------------------------------------

@router.get("/auth/status/{token}")
async def auth_status(token: str, db: AsyncSession = Depends(get_db_session)):
    """Auth status endpoint backed by persisted token/session records."""
    if not token or token.strip() == "":
        return {"status": "expired"}

    now = datetime.now(timezone.utc)
    raw_token = token.strip()

    try:
        auth_stmt = select(AuthToken).where(AuthToken.token == raw_token)
        auth_res = await db.execute(auth_stmt)
        auth_token = auth_res.scalars().first()

        if auth_token:
            expires_at = auth_token.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)

            if auth_token.status == "active" and expires_at > now:
                return {
                    "status": "active",
                    "session_id": raw_token,
                    "twitter_user_id": auth_token.twitter_user_id,
                }

            if auth_token.status == "pending" and expires_at > now:
                return {"status": "pending", "session_id": raw_token}

            return {"status": "expired"}

        web_stmt = select(WebSession).where(WebSession.session_id == raw_token)
        web_res = await db.execute(web_stmt)
        web_session = web_res.scalars().first()

        if web_session:
            expires_at = web_session.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)

            if expires_at > now:
                return {
                    "status": "active",
                    "session_id": raw_token,
                    "twitter_user_id": web_session.twitter_user_id,
                }
            return {"status": "expired"}

        # Unknown token keeps the same UX flow while avoiding false "active" states.
        return {"status": "pending", "session_id": raw_token}
    except Exception:
        # Safe fallback to avoid breaking login UX in environments with partial DB state.
        return {"status": "pending", "session_id": raw_token}


# ---------------------------------------------------------------------------
# Telegram Login Widget auth
# ---------------------------------------------------------------------------

@router.post("/auth/telegram/login")
async def telegram_widget_login(payload: dict, db: AsyncSession = Depends(get_db_session)):
    """Validate Telegram Login Widget data and issue a web session."""
    from server.settings import settings

    if not settings.telegram_bot_token:
        raise HTTPException(status_code=503, detail="Telegram bot not configured")

    data = dict(payload)
    provided_hash = data.pop("hash", None)
    if not provided_hash:
        raise HTTPException(status_code=400, detail="Missing hash")

    auth_date = data.get("auth_date")
    if not auth_date:
        raise HTTPException(status_code=400, detail="Missing auth_date")
    if time.time() - int(auth_date) > 86400:
        raise HTTPException(status_code=401, detail="Auth data expired")

    # Validate hash: HMAC-SHA256(data_check_string, SHA256(bot_token))
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret_key = hashlib.sha256(settings.telegram_bot_token.encode()).digest()
    expected = _hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not _hmac.compare_digest(expected, provided_hash):
        raise HTTPException(status_code=401, detail="Invalid Telegram auth hash")

    tg_id = str(data["id"])
    username = data.get("username") or data.get("first_name") or f"tg_{tg_id}"
    twitter_user_id = f"tg_{tg_id}"

    # Try by canonical twitter_user_id first
    user_stmt = select(User).where(User.twitter_user_id == twitter_user_id)
    user_res = await db.execute(user_stmt)
    user = user_res.scalars().first()

    if not user:
        # Fall back to existing user created by the Telegram bot (twitter_user_id = raw tg_id)
        tg_stmt = select(User).where(User.telegram_chat_id == tg_id)
        tg_res = await db.execute(tg_stmt)
        user = tg_res.scalars().first()

    if not user:
        user = User(
            twitter_user_id=twitter_user_id,
            twitter_handle=username,
            telegram_chat_id=tg_id,
        )
        db.add(user)
        await db.flush()
    else:
        # Normalize the user to our canonical format
        if user.twitter_user_id != twitter_user_id:
            user.twitter_user_id = twitter_user_id
        if not user.telegram_chat_id:
            user.telegram_chat_id = tg_id
        if not user.twitter_handle or user.twitter_handle.startswith("telegram_"):
            user.twitter_handle = username
        await db.flush()

    session_id = f"tg_session_{uuid.uuid4().hex}"
    expires_at = datetime.utcnow() + timedelta(days=30)
    db.add(WebSession(session_id=session_id, twitter_user_id=twitter_user_id, expires_at=expires_at))
    await db.commit()

    return {
        "session_id": session_id,
        "twitter_user_id": twitter_user_id,
        "username": username,
        "first_name": data.get("first_name", ""),
    }


# ---------------------------------------------------------------------------
# User endpoints
# ---------------------------------------------------------------------------

@router.get("/user/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    if not user_id or user_id.strip() == "":
        raise HTTPException(status_code=400, detail="user_id is required")

    # SEC-003: require auth and enforce that caller can only access their own profile
    authed_user = await _resolve_user(db, authorization)
    if authed_user.twitter_user_id != user_id:
        raise HTTPException(status_code=403, detail="Access to this user profile is not allowed")

    await _seed_default_campaigns(db)

    user_stmt = select(User).where(User.twitter_user_id == user_id)
    user_res = await db.execute(user_stmt)
    user = user_res.scalars().first()

    if not user:
        user = User(twitter_user_id=user_id, twitter_handle=f"user_{user_id[:8]}")
        db.add(user)
        await db.commit()

    participant_stmt = select(CampaignParticipant.campaign_id).where(CampaignParticipant.user_id == user.id)
    participant_res = await db.execute(participant_stmt)
    joined = list(participant_res.scalars().all())

    wallet_stmt = select(Wallet).where(Wallet.user_id == user.id)
    wallet_res = await db.execute(wallet_stmt)
    custodial_wallet = wallet_res.scalars().first()

    created_at = user.created_at if user.created_at else datetime.utcnow()
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    return UserResponse(
        id=user_id,
        username=user.twitter_handle,
        swap_count=0,
        total_volume=0.0,
        campaigns_joined=joined,
        dossier={
            "user_info": {
                "twitter_user_id": user.twitter_user_id,
                "twitter_handle": user.twitter_handle,
                "created_at": created_at.isoformat(),
                "custodial_wallet_address": custodial_wallet.address if custodial_wallet else None,
            },
            "balances": [],
            "history": {
                "chat_history": [],
                "swaps": [],
                "transactions": [],
            },
            "campaigns": [],
        },
    )


# ---------------------------------------------------------------------------
# Non-custodial wallet save
# ---------------------------------------------------------------------------

@router.post("/user/{user_id}/wallet")
async def save_user_wallet(user_id: str, payload: dict, db: AsyncSession = Depends(get_db_session)):
    """Save a user-generated non-custodial wallet address. Private key never touches the server."""
    address = (payload.get("address") or "").strip()
    if not address:
        raise HTTPException(status_code=400, detail="address is required")

    user_stmt = select(User).where(User.twitter_user_id == user_id)
    user_res = await db.execute(user_stmt)
    user = user_res.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    wallet_stmt = select(Wallet).where(Wallet.user_id == user.id)
    wallet_res = await db.execute(wallet_stmt)
    existing = wallet_res.scalars().first()
    if existing:
        return {"address": existing.address, "created": False}

    db.add(Wallet(user_id=user.id, address=address, private_key_encrypted="user_managed"))
    await db.commit()
    return {"address": address, "created": True}


# ---------------------------------------------------------------------------
# Perfil do onboarding
# ---------------------------------------------------------------------------

INTERESTS = {"defi", "games", "cards", "trader", "memecoins"}
GLOSSARY_MAX_TERMS = 60
GLOSSARY_MAX_TERM_LEN = 40


class ProfileUpdate(BaseModel):
    """PATCH parcial: só os campos enviados mudam. Dono vem do Bearer, nunca da URL."""

    full_name: Optional[str] = Field(default=None, max_length=255)
    state: Optional[str] = Field(default=None, max_length=64)
    city: Optional[str] = Field(default=None, max_length=128)
    bio: Optional[str] = Field(default=None, max_length=1000)
    social_links: Optional[dict[str, str]] = None
    interest_profile: Optional[list[str]] = None
    # Termos que a transcrição deve acertar (marcas, projetos, jargão). Limpeza em `clean_glossary`.
    glossary: Optional[list[str]] = Field(default=None, max_length=GLOSSARY_MAX_TERMS)


def clean_glossary(terms: list[str]) -> list[str]:
    """Tira espaço/quebra de linha, descarta vazio, repetido (sem diferenciar maiúscula) e o que passa de
    GLOSSARY_MAX_TERM_LEN. Ordem preservada: o que vem primeiro tem prioridade quando o prompt é cortado."""
    seen, out = set(), []
    for t in terms:
        t = " ".join(str(t).split())
        if t and len(t) <= GLOSSARY_MAX_TERM_LEN and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out


def _profile_dict(user: User) -> dict:
    interests = json.loads(user.interest_profile) if user.interest_profile else []
    return {
        "full_name": user.full_name,
        "state": user.state,
        "city": user.city,
        "bio": user.bio,
        "social_links": json.loads(user.social_links) if user.social_links else {},
        "interest_profile": interests,
        "glossary": json.loads(user.glossary) if user.glossary else [],
        # Onboarding completo = nome e ao menos um interesse; o app usa para decidir se mostra o questionário.
        "onboarded": bool(user.full_name and interests),
    }


@router.get("/user/me/profile")
async def get_my_profile(
    authorization: Optional[str] = Header(default=None), db: AsyncSession = Depends(get_db_session)
):
    user = await _resolve_user(db, authorization, strict=True)
    await db.commit()
    return _profile_dict(user)


@router.patch("/user/me/profile")
async def update_my_profile(
    payload: ProfileUpdate,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    user = await _resolve_user(db, authorization, strict=True)
    data = payload.model_dump(exclude_unset=True)
    for key in ("full_name", "state", "city", "bio"):
        if key in data:
            setattr(user, key, (data[key] or "").strip() or None)
    if data.get("social_links") is not None:
        links = {k.strip().lower()[:32]: v.strip()[:255] for k, v in data["social_links"].items() if v.strip()}
        user.social_links = json.dumps(links)
    if data.get("interest_profile") is not None:
        interests = [i.strip().lower() for i in data["interest_profile"]]
        invalid = [i for i in interests if i not in INTERESTS]
        if invalid:
            raise HTTPException(status_code=422, detail=f"interesses inválidos: {invalid}; use {sorted(INTERESTS)}")
        user.interest_profile = json.dumps(list(dict.fromkeys(interests)))
    if data.get("glossary") is not None:
        user.glossary = json.dumps(clean_glossary(data["glossary"]), ensure_ascii=False)
    await db.commit()
    return _profile_dict(user)


# ---------------------------------------------------------------------------
# Google / Web3Auth login
# ---------------------------------------------------------------------------

@router.post("/auth/google/login")
async def google_web3auth_login(payload: dict, db: AsyncSession = Depends(get_db_session)):
    """Register/login a user authenticated via Web3Auth (Google). Receives Solana public address only."""
    address = (payload.get("address") or "").strip()
    email = (payload.get("email") or "").strip()
    name = (payload.get("name") or "").strip()
    if not address:
        raise HTTPException(status_code=400, detail="address is required")

    twitter_user_id = f"google_{address[:20]}"
    handle = name or (email.split("@")[0] if email else f"google_{address[:8]}")

    user_stmt = select(User).where(User.twitter_user_id == twitter_user_id)
    user_res = await db.execute(user_stmt)
    user = user_res.scalars().first()

    if not user:
        # Check if wallet already registered under a different user_id
        wallet_stmt = select(Wallet).where(Wallet.address == address)
        wallet_res = await db.execute(wallet_stmt)
        existing_wallet = wallet_res.scalars().first()
        if existing_wallet:
            user_stmt2 = select(User).where(User.id == existing_wallet.user_id)
            user = (await db.execute(user_stmt2)).scalars().first()

    if not user:
        user = User(twitter_user_id=twitter_user_id, twitter_handle=handle)
        db.add(user)
        await db.flush()

    # Save wallet if not yet saved
    wallet_check = (await db.execute(select(Wallet).where(Wallet.user_id == user.id))).scalars().first()
    if not wallet_check:
        db.add(Wallet(user_id=user.id, address=address, private_key_encrypted="web3auth_managed"))

    session_id = f"google_session_{uuid.uuid4().hex}"
    expires_at = datetime.utcnow() + timedelta(days=30)
    db.add(WebSession(session_id=session_id, twitter_user_id=user.twitter_user_id, expires_at=expires_at))
    await db.commit()

    return {
        "session_id": session_id,
        "twitter_user_id": user.twitter_user_id,
        "username": handle,
        "address": address,
    }


# ---------------------------------------------------------------------------
# Login social verificado (substitui /auth/google/login)
# ---------------------------------------------------------------------------

class SessionLoginRequest(BaseModel):
    """Só o token entra. Campos extras no corpo são ignorados de propósito —
    é exatamente daí que vinha o furo do /auth/google/login."""

    provider: str = ""
    id_token: str = ""


_TOKEN_VERIFIERS = {
    "firebase": token_auth.verify_firebase_token,
    "web3auth": token_auth.verify_web3auth_token,
    "privy": token_auth.verify_privy_token,
}


# Logins sociais: a identidade já veio provada no `Bearer` (`_resolve_user`
# resolve a sessão, e `/auth/session` só a emite depois de conferir o ID token
# contra o JWKS do provedor), então exigir assinatura de carteira em cima disso
# é redundante — o usuário nem tem chave privada para assinar.
#
# Derivado de `_TOKEN_VERIFIERS` e não escrito à mão porque já quebrou uma vez:
# a lista era fixa em ("google_", "tg_") e `/auth/session` passou a emitir
# `firebase_session_*` e `web3auth_session_*`. Resultado — o login novo, mais
# seguro que o antigo `/auth/google/login`, era o único que NÃO conseguia
# resgatar. Cada prefixo cobre as duas formas que `getSessionId()` devolve: o
# id de sessão (`<provedor>_session_*`) e o twitter_user_id (`<provedor>_*`).
#
# `google_` e `tg_` continuam na lista à mão: são de rotas legadas
# (`/auth/google/login`, `/auth/telegram/login`) que não passam por
# `_TOKEN_VERIFIERS` e cujas sessões de 30 dias ainda estão vivas em produção.
_CUSTODIAL_PREFIXES: tuple[str, ...] = tuple(
    f"{provider}_" for provider in (*_TOKEN_VERIFIERS, "google", "tg")
)


@router.post("/auth/session")
async def auth_session(payload: SessionLoginRequest, db: AsyncSession = Depends(get_db_session)):
    """Emite sessão a partir de um ID token verificado do provedor social.

    A identidade sai inteira de dentro do token (assinatura conferida contra o
    JWKS do provedor); nada do corpo da request é confiável.
    """
    verifier = _TOKEN_VERIFIERS.get(payload.provider.strip().lower())
    if verifier is None:
        raise HTTPException(status_code=400, detail="provider inválido")
    if not payload.id_token.strip():
        raise HTTPException(status_code=400, detail="id_token é obrigatório")

    try:
        identity = verifier(payload.id_token)
    except token_auth.TokenVerificationError as exc:
        logger.warning("login social recusado (%s): %s", payload.provider, exc)
        raise HTTPException(status_code=401, detail="token inválido") from exc

    twitter_user_id = f"{identity.provider}_{identity.subject}"
    handle = identity.name or (identity.email.split("@")[0] if identity.email else twitter_user_id)

    user = await DatabaseRepository(db).get_or_create_user(identity.provider, twitter_user_id, handle=handle)

    # Endereço de payout só existe se o provedor o assinou dentro do token.
    if identity.address:
        wallet = (await db.execute(select(Wallet).where(Wallet.user_id == user.id))).scalars().first()
        if not wallet:
            db.add(
                Wallet(
                    user_id=user.id,
                    address=identity.address,
                    private_key_encrypted=f"{identity.provider}_managed",
                )
            )

    session_id = f"{identity.provider}_session_{uuid.uuid4().hex}"
    db.add(
        WebSession(
            session_id=session_id,
            twitter_user_id=user.twitter_user_id,
            expires_at=datetime.utcnow() + timedelta(days=30),
        )
    )
    await db.commit()

    return {
        "session_id": session_id,
        "twitter_user_id": user.twitter_user_id,
        "username": handle,
        "address": identity.address,
    }


# ---------------------------------------------------------------------------
# Vínculo autenticado de carteira (substitui POST /user/{user_id}/wallet)
# ---------------------------------------------------------------------------

# EVM: 0x + 40 hex. Não valida checksum EIP-55 de propósito — muitas carteiras
# exibem tudo minúsculo, e recusar isso viraria suporte, não segurança.
_EVM_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


class WalletLinkRequest(BaseModel):
    """Só o endereço entra. O dono vem da sessão — ver `link_wallet`."""

    address: str = ""
    chain: str = "arc"


async def _user_from_session(token: str | None, db: AsyncSession) -> User:
    """Resolve o `Bearer` em usuário, ou 401. Sessão expirada não vale."""
    if not token or not token.startswith("Bearer "):
        # Em inglês porque o `detail` chega ao usuário: o mobile exibe a mensagem
        # crua do erro no card de carteira, e o app é todo em inglês.
        raise HTTPException(status_code=401, detail="Sign in required")

    session_id = token.removeprefix("Bearer ").strip()
    session = (
        await db.execute(select(WebSession).where(WebSession.session_id == session_id))
    ).scalars().first()
    if not session:
        raise HTTPException(status_code=401, detail="sessão inválida")

    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="sessão expirada")

    user = (
        await db.execute(select(User).where(User.twitter_user_id == session.twitter_user_id))
    ).scalars().first()
    if not user:
        raise HTTPException(status_code=401, detail="sessão sem usuário")
    return user


@router.post("/auth/wallet")
async def link_wallet(
    payload: WalletLinkRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    """Vincula o endereço de payout ao usuário **da sessão**.

    O endereço é para onde o agente manda USDC, então quem consegue gravá-lo
    redireciona dinheiro. `POST /user/{user_id}/wallet` aceita o alvo pela URL
    sem autenticação; aqui o dono sai do token e nada do corpo o altera.
    """
    user = await _user_from_session(authorization, db)

    address = payload.address.strip()
    if not address:
        raise HTTPException(status_code=400, detail="address is required")
    if not _EVM_ADDRESS_RE.match(address):
        raise HTTPException(status_code=400, detail="invalid EVM address")

    wallet = (
        await db.execute(select(Wallet).where(Wallet.user_id == user.id))
    ).scalars().first()

    if wallet:
        # Trocar de carteira é operação legítima do dono.
        wallet.address = address
    else:
        # Chave privada nunca chega ao servidor — a carteira é do usuário.
        db.add(Wallet(user_id=user.id, address=address, private_key_encrypted="user_managed"))

    await db.commit()
    return {"address": address, "chain": payload.chain, "twitter_user_id": user.twitter_user_id}


# ---------------------------------------------------------------------------
# Campaign endpoints
# ---------------------------------------------------------------------------

@router.get("/campaigns", response_model=CampaignsResponse)
async def list_campaigns(db: AsyncSession = Depends(get_db_session)):
    await _seed_default_campaigns(db)

    campaigns_res = await db.execute(select(CampaignModel).where(CampaignModel.status == "active").order_by(CampaignModel.id.asc()))
    campaigns = campaigns_res.scalars().all()

    participant_counts_res = await db.execute(
        select(CampaignParticipant.campaign_id, func.count(CampaignParticipant.id))
        .group_by(CampaignParticipant.campaign_id)
    )
    participant_counts = {campaign_id: count for campaign_id, count in participant_counts_res.all()}

    return CampaignsResponse(
        success=True,
        campaigns=[Campaign(**_campaign_to_dict(c, participant_counts.get(c.id, 0))) for c in campaigns],
    )


async def _list_user_campaigns(db: AsyncSession, authorization: Optional[str]) -> UserCampaignsResponse:
    await _seed_default_campaigns(db)

    try:
        user = await _resolve_user(db, authorization)
    except HTTPException:
        return UserCampaignsResponse(success=True, campaigns=[])

    participant_stmt = (
        select(CampaignParticipant, CampaignModel)
        .join(CampaignModel, CampaignModel.id == CampaignParticipant.campaign_id)
        .where(CampaignParticipant.user_id == user.id)
        .order_by(CampaignParticipant.joined_at.asc())
    )
    participant_res = await db.execute(participant_stmt)

    result = []
    for participant, campaign in participant_res.all():
        participation_status = _participant_status(participant)
        verified_at = participant.tasks_verified_at
        if verified_at and verified_at.tzinfo is None:
            verified_at = verified_at.replace(tzinfo=timezone.utc)

        result.append(
            UserCampaignParticipation(
                id=campaign.id,
                name=campaign.name,
                description=campaign.description,
                reward_token=campaign.reward_token,
                reward_per_participant=float(campaign.reward_per_participant),
                campaign_type=campaign.campaign_type,
                participation_status=participation_status,
                status=participation_status,
                tasks_verified_at=verified_at.isoformat() if verified_at else None,
                tasks_claimed=participant.status == "paid",
                claim_receipt_id=participant.claim_receipt_id,
            )
        )
    return UserCampaignsResponse(success=True, campaigns=result)


@router.get("/campaigns/me", response_model=UserCampaignsResponse)
async def get_current_user_campaigns(
    db: AsyncSession = Depends(get_db_session),
    authorization: Optional[str] = Header(default=None),
):
    """Retorna as campanhas em que o usuario atual participa."""
    return await _list_user_campaigns(db, authorization)


@router.get("/campaigns/user", response_model=UserCampaignsResponse)
async def get_user_campaigns(
    db: AsyncSession = Depends(get_db_session),
    authorization: Optional[str] = Header(default=None),
):
    """Compatibilidade legada para retornar as campanhas do usuario."""
    return await _list_user_campaigns(db, authorization)


@router.post("/campaigns/create")
async def create_campaign(
    payload: CreateCampaignRequest,
    db: AsyncSession = Depends(get_db_session),
    authorization: Optional[str] = Header(default=None),
):
    await _seed_default_campaigns(db)
    user = await _resolve_user(db, authorization)

    new_campaign = CampaignModel(
        creator_twitter_user_id=user.twitter_user_id,
        name=payload.title,
        description=payload.description,
        campaign_type=payload.campaign_type,
        reward_token=payload.reward_token,
        reward_per_participant=payload.reward_per_participant,
        max_participants=payload.max_participants,
        reward_pool=payload.reward_per_participant * payload.max_participants,
        status="active",
        profile_to_follow=payload.profile_to_follow,
        tweet_id_to_engage=payload.tweet_id_to_engage,
    )
    db.add(new_campaign)
    try:
        await db.commit()
    except IntegrityError:
        # `Campaign.name` é unique — sem isto o form (ou o chat) mandava um
        # 500 cru pro usuário em vez de "esse nome já existe".
        await db.rollback()
        return {"success": False, "error": f"A campaign named '{payload.title}' already exists — pick a different title."}
    await db.refresh(new_campaign)

    return {"success": True, "message": "Campaign created successfully!", "campaign": _campaign_to_dict(new_campaign)}


@router.post("/campaigns/join")
async def join_campaign(
    payload: CampaignActionRequest,
    db: AsyncSession = Depends(get_db_session),
    authorization: Optional[str] = Header(default=None),
):
    await _seed_default_campaigns(db)
    user = await _resolve_user(db, authorization)
    campaign_id = int(payload.campaign_identifier)
    campaign = await _get_campaign_or_404(db, campaign_id)

    existing_stmt = select(CampaignParticipant).where(
        CampaignParticipant.campaign_id == campaign_id,
        CampaignParticipant.user_id == user.id,
    )
    existing_res = await db.execute(existing_stmt)
    existing = existing_res.scalars().first()
    if existing:
        # 409 Conflict é a resposta semanticamente correta para recursos já existentes.
        record_campaign_event("join_duplicate")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already joined this campaign",
        )

    participant_count_stmt = select(func.count()).select_from(CampaignParticipant).where(CampaignParticipant.campaign_id == campaign_id)
    participant_count_res = await db.execute(participant_count_stmt)
    participant_count = participant_count_res.scalar() or 0
    if participant_count >= campaign.max_participants:
        record_campaign_event("join_full")
        return {"success": False, "error": "This campaign is full"}

    db.add(
        CampaignParticipant(
            campaign_id=campaign.id,
            user_id=user.id,
            status="enrolled",
        )
    )
    await db.commit()
    record_campaign_event("join")
    return {
        "success": True,
        "message": f"Successfully joined '{campaign.name}'! Complete the tasks to earn {float(campaign.reward_per_participant)} {campaign.reward_token}.",
    }


@router.post("/campaigns/verify")
async def verify_tasks(
    payload: CampaignActionRequest,
    db: AsyncSession = Depends(get_db_session),
    authorization: Optional[str] = Header(default=None),
):
    await _seed_default_campaigns(db)
    user = await _resolve_user(db, authorization)
    campaign_id = int(payload.campaign_identifier)
    campaign = await _get_campaign_or_404(db, campaign_id)

    participant_stmt = select(CampaignParticipant).where(
        CampaignParticipant.campaign_id == campaign_id,
        CampaignParticipant.user_id == user.id,
    )
    participant_res = await db.execute(participant_stmt)
    participant = participant_res.scalars().first()
    if not participant:
        return {"success": False, "message": "You need to join this campaign first"}

    if participant.status in {"tasks_verified", "paid"}:
        return {"success": True, "message": "Tasks already verified! You can now claim your reward.", "all_tasks_completed": True}

    # SEC-006: real task verification per campaign type
    from server.integrations.campaign_verifier import verify_social, verify_trading, verify_referral
    from server.settings import settings

    campaign_type = campaign.campaign_type

    if campaign_type == "social":
        ok, reason = await verify_social(
            twitter_user_id=user.twitter_user_id,
            profile_to_follow=campaign.profile_to_follow,
            tweet_id_to_engage=campaign.tweet_id_to_engage,
            bearer_token=settings.x_bearer_token,
        )
    elif campaign_type == "trading":
        wallet_res = await db.execute(select(Wallet).where(Wallet.user_id == user.id))
        wallet = wallet_res.scalars().first()
        ok, reason = await verify_trading(
            wallet_address=wallet.address if wallet else None,
            helius_api_key=settings.helius_api_key,
        )
    elif campaign_type == "referral":
        ok, reason = await verify_referral(user.id, db, campaign_id)
    else:
        logger.warning("[campaigns/verify] Unknown campaign type %r for campaign %d — accepting", campaign_type, campaign_id)
        ok, reason = True, f"Campaign type accepted"

    if not ok:
        return {"success": False, "message": reason, "all_tasks_completed": False}

    participant.status = "tasks_verified"
    participant.tasks_verified_at = datetime.now(timezone.utc)
    await db.commit()
    record_campaign_event("verify")
    return {
        "success": True,
        "message": "All tasks verified successfully! You are eligible to claim your reward.",
        "all_tasks_completed": True,
    }


@router.post("/campaigns/claim")
async def claim_reward(
    payload: CampaignActionRequest,
    db: AsyncSession = Depends(get_db_session),
    authorization: Optional[str] = Header(default=None),
):
    await _seed_default_campaigns(db)
    user = await _resolve_user(db, authorization)
    campaign_id = int(payload.campaign_identifier)
    campaign = await _get_campaign_or_404(db, campaign_id)

    participant_stmt = select(CampaignParticipant).where(
        CampaignParticipant.campaign_id == campaign_id,
        CampaignParticipant.user_id == user.id,
    )
    participant_res = await db.execute(participant_stmt)
    participant = participant_res.scalars().first()
    if not participant or participant.status not in {"tasks_verified", "paid"}:
        return {"success": False, "error": "Complete and verify all tasks before claiming"}

    if participant.status == "paid":
        return {"success": False, "error": "Reward already claimed for this campaign"}

    _verify_claim_proof(payload, campaign_id, _get_user_id_from_token(authorization))

    receipt_id = str(uuid.uuid4())[:16]
    wallet_address = (payload.wallet_public_key or "").strip()
    reward_amount = float(campaign.reward_per_participant)
    # Sobrescrito por `arc.send_usdc` quando o payout roda de verdade — até lá
    # é só o identificador do registro, igual ao comportamento anterior.
    tx_id = str(uuid.uuid4())[:16]
    paid_onchain = False

    # Só existe rail de pagamento real para EVM + USDC (Circle W3S no Arc). Uma
    # campanha em outro token, ou resgatada por uma wallet Solana/Stellar
    # (`_verify_claim_proof` ainda aceita as duas), continua só registrando o
    # resgate — pagar "USDC" para um endereço que não existe nessa rede seria
    # pior que não pagar.
    if wallet_address.startswith("0x") and campaign.reward_token.upper() == "USDC":
        # Determinístico por (campanha, usuário) — não por chamada: um retry de
        # rede antes do `commit` abaixo não deve virar um segundo pagamento.
        idempotency_key = str(
            uuid.uuid5(uuid.NAMESPACE_OID, f"xiaolee-campaign-claim:{campaign_id}:{user.id}")
        )
        arc = _campaign_arc_client()
        try:
            # `wait_confirmed=False`: a confirmação on-chain pode levar até
            # `_POLL_TIMEOUT_S` (120s) — tempo demais para o app esperar um
            # botão de claim. A iniciação aceita pela Circle é o suficiente
            # para marcar como pago; falha depois disso é rara e vira caso de
            # suporte, não uma segunda tentativa do usuário.
            tx_id = await arc.send_usdc(
                to_address=wallet_address,
                amount_usdc=reward_amount,
                idempotency_key=idempotency_key,
                wait_confirmed=False,
            )
            paid_onchain = True
        except Exception as exc:
            logger.error(
                "[campaigns/claim] Arc payout failed campaign=%d user=%d: %s",
                campaign_id, user.id, exc, exc_info=True,
            )
            # Nada é gravado — nem `status`, nem recibo — para que o usuário
            # possa tocar em Claim de novo depois que a tesouraria for corrigida.
            return {
                "success": False,
                "error": "Payout failed — nothing was charged. Try claiming again in a moment.",
            }
    else:
        logger.warning(
            "[campaigns/claim] no on-chain payout rail for wallet=%r token=%s (campaign %d) — recording claim without transfer",
            wallet_address, campaign.reward_token, campaign_id,
        )

    participant.status = "paid"
    participant.claim_receipt_id = receipt_id
    db.add(
        NotificationEvent(
            user_id=user.id,
            channel="in_app",
            title=f"Campaign reward claimed: {campaign.name}",
            body=f"You claimed {reward_amount} {campaign.reward_token} and received receipt {receipt_id}.",
            status="pending",
            related_signature=receipt_id,
            metadata_json=json.dumps(
                {
                    "campaign_id": campaign_id,
                    "reward_amount": reward_amount,
                    "reward_token": campaign.reward_token,
                    "wallet_public_key": wallet_address,
                    "claim_receipt_id": receipt_id,
                    "tx_id": tx_id,
                    "paid_onchain": paid_onchain,
                }
            ),
        )
    )
    await db.commit()
    record_campaign_event("claim")
    return {
        "success": True,
        "message": f"{reward_amount} {campaign.reward_token} claimed successfully!",
        "transaction_id": tx_id,
        "claim_receipt_id": receipt_id,
        "reward_amount": reward_amount,
        "reward_token": campaign.reward_token,
        "wallet_public_key": payload.wallet_public_key,
        "proof_submitted": bool(payload.wallet_signature or payload.proof_message),
        "paid_onchain": paid_onchain,
    }
