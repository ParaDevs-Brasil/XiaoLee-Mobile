"""
onoff.py — núcleo do on/off-ramp: máquina de estados, tetos, gates de KYC e interface de provedor.

A XiaoLee não toca em fiat: o provedor licenciado cobra/paga e faz o KYC. Aqui só ficam as regras que nos
protegem (quem pode, quanto, quando) e a trilha de auditoria. Ver docs/ONOFF_RAMP_DESIGN.md.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional, Protocol

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import OnoffEvent, OnoffIntent, OnoffKyc, User
from server.settings import settings

DEPOSIT, WITHDRAW = "deposit", "withdraw"
FIAT_METHODS = {"card", "apple_pay", "google_pay", "pix", "bank"}
METHODS = FIAT_METHODS | {"chain"}

# Só avançam; qualquer outra transição é recusada. Estados sem saída são terminais.
TRANSITIONS: dict[str, dict[str, set[str]]] = {
    DEPOSIT: {
        "created": {"pending_provider", "failed", "expired"},
        "pending_provider": {"funds_received", "rejected", "failed", "expired", "review"},
        "funds_received": {"settled", "failed", "review"},
    },
    WITHDRAW: {
        "created": {"pending_provider", "failed", "expired"},
        "pending_provider": {"sent_to_provider", "rejected", "failed", "expired", "review"},
        "sent_to_provider": {"paid_out", "failed", "review"},
        "failed": {"refunded"},
    },
}
TERMINAL = {"settled", "paid_out", "rejected", "expired", "refunded"}
# `review` = o provedor reportou valor diferente do pedido (ou sem valor): trava para análise humana, sem saída automática.
# Contam para os tetos: tudo que ainda pode virar dinheiro movido (falhas e rejeições não consomem teto).
COUNTED = {"created", "pending_provider", "funds_received", "sent_to_provider", "settled", "paid_out", "review"}
# Estados em que o provedor afirma que dinheiro andou: o valor dele precisa bater com o do intent.
MONEY_MOVED = {"funds_received", "sent_to_provider", "settled", "paid_out"}
SESSION_TTL = timedelta(minutes=30)


class OnoffError(Exception):
    """Regra de negócio recusou. `status` vira o HTTP status; `code` é estável para o app."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


# ── Provedor ────────────────────────────────────────────────────────────────

@dataclass
class ProviderSession:
    provider_ref: str
    url: Optional[str] = None          # widget/checkout hospedado pelo provedor
    expires_at: Optional[datetime] = None


@dataclass
class ProviderEvent:
    event_id: str                      # único no provedor: anti-replay
    kind: str                          # 'intent' | 'kyc'
    provider_ref: Optional[str] = None
    status: Optional[str] = None       # novo estado do intent (nosso vocabulário)
    onchain_tx: Optional[str] = None
    amount_usdc: Optional[float] = None      # o que o provedor diz que cobrou/pagou; conferido contra o intent
    external_user_id: Optional[str] = None   # nosso user_id, devolvido pelo provedor
    customer_ref: Optional[str] = None
    kyc_level: Optional[int] = None
    kyc_status: Optional[str] = None
    kyc_subject: Optional[str] = None


class RampProvider(Protocol):
    name: str
    methods: set[str]
    directions: set[str]

    async def create_session(self, intent: OnoffIntent) -> ProviderSession: ...

    def verify_webhook(self, headers: dict[str, str], body: bytes) -> ProviderEvent:
        """Levanta `OnoffError(401)` se a assinatura não bate."""


def hmac_ok(secret: str, body: bytes, signature: str) -> bool:
    """HMAC-SHA256 hex em tempo constante. Segredo vazio nunca valida (não existe 'sem assinatura')."""
    if not secret or not signature:
        return False
    mac = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, signature.strip().lower())


_PROVIDERS: dict[str, RampProvider] = {}


def register(provider: RampProvider) -> None:
    _PROVIDERS[provider.name] = provider


def get_provider(name: str) -> RampProvider:
    p = _PROVIDERS.get(name)
    if p is None:
        raise OnoffError(404, "unknown_provider", f"provider {name!r} is not available")
    return p


def providers() -> list[RampProvider]:
    return list(_PROVIDERS.values())


# ── Regras de entrada ───────────────────────────────────────────────────────

def _allowed(user) -> bool:
    raw = [x.strip().lower() for x in settings.onoff_allowlist.split(",") if x.strip()]
    if not raw:
        return True
    return {str(user.twitter_user_id).lower(), str(user.twitter_handle or "").lower()} & set(raw) != set()


def check_open(user, direction: str) -> None:
    if not settings.onoff_enabled:
        raise OnoffError(503, "onoff_disabled", "on/off-ramp is not enabled")
    if direction == DEPOSIT and not settings.onoff_deposit_enabled:
        raise OnoffError(503, "deposit_disabled", "deposits are paused")
    if direction == WITHDRAW and not settings.onoff_withdraw_enabled:
        raise OnoffError(503, "withdraw_disabled", "withdrawals are paused")
    if not _allowed(user):
        raise OnoffError(403, "not_allowed", "on/off-ramp is in a closed pilot")


async def _sum_since(db: AsyncSession, user_id: int, direction: str, since: datetime) -> float:
    res = await db.execute(
        select(func.coalesce(func.sum(OnoffIntent.amount_usdc), 0)).where(
            OnoffIntent.user_id == user_id, OnoffIntent.direction == direction,
            OnoffIntent.status.in_(COUNTED), OnoffIntent.created_at >= since))
    return float(res.scalar() or 0)


async def _sum_all_since(db: AsyncSession, direction: str, since: datetime) -> float:
    res = await db.execute(
        select(func.coalesce(func.sum(OnoffIntent.amount_usdc), 0)).where(
            OnoffIntent.direction == direction, OnoffIntent.status.in_(COUNTED), OnoffIntent.created_at >= since))
    return float(res.scalar() or 0)


async def check_limits(db: AsyncSession, user_id: int, direction: str, amount: float) -> None:
    """Chame e grave o intent NA MESMA transação: o FOR UPDATE na linha do usuário serializa pedidos
    simultâneos dele (Postgres; no SQLite dos testes é no-op), senão dois pedidos passam do teto juntos."""
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())
    if amount <= 0:
        raise OnoffError(422, "bad_amount", "amount must be positive")
    if amount > settings.onoff_max_tx_usdc:
        raise OnoffError(422, "over_tx_limit", f"max per operation is {settings.onoff_max_tx_usdc:g} USDC")
    now = datetime.utcnow()
    if await _sum_since(db, user_id, direction, now - timedelta(days=1)) + amount > settings.onoff_max_day_usdc:
        raise OnoffError(429, "over_day_limit", f"daily limit is {settings.onoff_max_day_usdc:g} USDC")
    if await _sum_since(db, user_id, direction, now - timedelta(days=30)) + amount > settings.onoff_max_month_usdc:
        raise OnoffError(429, "over_month_limit", f"monthly limit is {settings.onoff_max_month_usdc:g} USDC")
    # Teto global da operação (todos os usuários): freio contra abuso em massa, sem revelar o motivo exato.
    if await _sum_all_since(db, direction, now - timedelta(days=1)) + amount > settings.onoff_max_global_day_usdc:
        raise OnoffError(429, "capacity", "temporarily at capacity, try again later")


async def kyc_level(db: AsyncSession, user_id: int, provider: str) -> int:
    row = (await db.execute(select(OnoffKyc).where(OnoffKyc.user_id == user_id, OnoffKyc.provider == provider))).scalars().first()
    return row.level if row and row.status == "approved" else 0


async def check_withdraw_gates(db: AsyncSession, user_id: int, method: str, provider: str) -> None:
    """Saque para fiat: KYC do provedor que paga + espera depois de depósito grande (risco de chargeback)."""
    if method not in FIAT_METHODS:
        return
    if await kyc_level(db, user_id, provider) < settings.onoff_withdraw_min_kyc_level:
        raise OnoffError(403, "kyc_required", "complete identity verification with the provider to withdraw to fiat")
    since = datetime.utcnow() - timedelta(hours=settings.onoff_cooldown_hours)
    recent = await db.execute(
        select(func.count()).select_from(OnoffIntent).where(
            OnoffIntent.user_id == user_id, OnoffIntent.direction == DEPOSIT, OnoffIntent.status == "settled",
            OnoffIntent.amount_usdc >= settings.onoff_cooldown_min_usdc, OnoffIntent.updated_at >= since))
    if (recent.scalar() or 0) > 0:
        raise OnoffError(403, "cooldown", f"large deposits unlock fiat withdrawals after {settings.onoff_cooldown_hours}h")


# ── Estado + auditoria ──────────────────────────────────────────────────────

async def new_intent(db: AsyncSession, *, user_id: int, direction: str, method: str, provider: str, amount: float,
                     fiat_currency: Optional[str] = None, dest_network: Optional[str] = None,
                     dest_address: Optional[str] = None) -> OnoffIntent:
    """Grava o intent (e o evento de criação) antes de qualquer chamada externa."""
    intent = OnoffIntent(intent_id=str(uuid.uuid4()), user_id=user_id, direction=direction, method=method,
                         provider=provider, amount_usdc=amount, fiat_currency=fiat_currency, status="created",
                         dest_network=dest_network, dest_address=dest_address)
    db.add(intent)
    await db.flush()
    db.add(OnoffEvent(intent_id=intent.id, from_status=None, to_status="created", actor="system"))
    await db.flush()
    return intent


async def advance(db: AsyncSession, intent: OnoffIntent, to: str, *, actor: str,
                  event_id: Optional[str] = None, payload: Optional[bytes] = None) -> None:
    """Muda o estado se a transição é válida; sempre acrescenta um evento. Nunca altera eventos antigos."""
    if to not in TRANSITIONS.get(intent.direction, {}).get(intent.status, set()):
        raise OnoffError(409, "bad_transition", f"{intent.direction}: {intent.status} -> {to} is not allowed")
    db.add(OnoffEvent(intent_id=intent.id, from_status=intent.status, to_status=to, actor=actor, event_id=event_id,
                      payload_hash=hashlib.sha256(payload).hexdigest() if payload else None))
    intent.status = to


async def seen_event(db: AsyncSession, event_id: str) -> bool:
    return (await db.execute(select(OnoffEvent.id).where(OnoffEvent.event_id == event_id))).first() is not None


async def apply_kyc(db: AsyncSession, provider: str, ev: ProviderEvent) -> None:
    if not ev.external_user_id or not str(ev.external_user_id).isdigit():
        raise OnoffError(422, "bad_event", "kyc event without a user")
    uid = int(ev.external_user_id)
    row = (await db.execute(select(OnoffKyc).where(OnoffKyc.user_id == uid, OnoffKyc.provider == provider))).scalars().first()
    if row is None:
        row = OnoffKyc(user_id=uid, provider=provider)
        db.add(row)
    row.level = max(0, min(int(ev.kyc_level or 0), 2))
    row.status = ev.kyc_status if ev.kyc_status in {"none", "pending", "approved", "rejected"} else "pending"
    row.subject = "business" if ev.kyc_subject == "business" else "person"
    row.customer_ref = ev.customer_ref or row.customer_ref
    row.verified_at = datetime.now(timezone.utc) if row.status == "approved" else None


def amount_matches(intent: OnoffIntent, reported: Optional[float]) -> bool:
    """Valor do provedor x valor do intent. Sem valor = não bate. Tolerância: o maior entre 1 centavo e 1%."""
    if reported is None:
        return False
    want = float(intent.amount_usdc)
    return abs(float(reported) - want) <= max(0.01, want * 0.01)


def naive_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


async def expire_stale(db: AsyncSession, user_id: int) -> None:
    """Intents sem desfecho depois do prazo viram `expired` (sem agendador: roda ao consultar/criar)."""
    now = datetime.utcnow()
    rows = (await db.execute(select(OnoffIntent).where(
        OnoffIntent.user_id == user_id, OnoffIntent.status.in_(("created", "pending_provider"))))).scalars().all()
    for i in rows:
        limit = naive_utc(i.expires_at) or naive_utc(i.created_at) + SESSION_TTL
        if limit < now and not (i.status == "created" and i.dest_network):  # saque entre redes não tem sessão de provedor
            await advance(db, i, "expired", actor="system")
