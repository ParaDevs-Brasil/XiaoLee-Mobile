"""
onoff_routes.py — depósito e saque (fiat e cripto) da carteira XiaoLee. Regras em server/onoff.py.

    GET  /v1/onoff/config                  → o que está ligado, tetos, provedores e métodos
    POST /v1/onoff/deposit                 → cria o intent e a sessão do provedor (URL do widget)
    POST /v1/onoff/withdraw                → valida KYC/tetos/espera e cria o intent do saque
    GET  /v1/onoff/intents[/{intent_id}]   → histórico e status do usuário
    POST /v1/onoff/webhooks/{provider}     → ÚNICA porta que muda estado vindo de fora (assinatura obrigatória)

O dono vem SEMPRE do Bearer emitido pelo backend (strict), nunca do corpo. Saque para outra rede (`chain`)
só grava o intent aqui; a execução via CCTP é a fase 2.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db_session
from database.models import OnoffIntent
from database.repository import to_utc_iso
from server import onoff
from server.campaigns_routes import _resolve_user
from server.settings import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/onoff", tags=["onoff"])

CHAIN_NETWORKS = {"base", "ethereum"}
_EVM_ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
CCTP = "cctp"  # saque entre redes: executado por nós, sem provedor externo


class _Sandbox:
    """Provedor de teste: sessão fictícia, webhook assinado com ONOFF_SANDBOX_SECRET (JSON: ver ProviderEvent)."""
    name = "sandbox"
    methods = {"card", "pix", "bank"}
    directions = {onoff.DEPOSIT, onoff.WITHDRAW}

    async def create_session(self, intent):
        return onoff.ProviderSession(provider_ref=f"sbx_{intent.intent_id}", url=f"https://sandbox.invalid/{intent.intent_id}")

    def verify_webhook(self, headers, body):
        if not onoff.hmac_ok(settings.onoff_sandbox_secret, body, headers.get("x-onoff-signature", "")):
            raise onoff.OnoffError(401, "bad_signature", "invalid signature")
        try:
            d = json.loads(body)
            return onoff.ProviderEvent(**{k: d.get(k) for k in onoff.ProviderEvent.__dataclass_fields__ if k in d})
        except (ValueError, TypeError):
            raise onoff.OnoffError(422, "bad_event", "malformed event")


if settings.onoff_sandbox_secret:
    onoff.register(_Sandbox())


def _fail(e: onoff.OnoffError) -> HTTPException:
    return HTTPException(e.status, {"code": e.code, "message": e.message})


class IntentOut(BaseModel):
    intent_id: str
    direction: str
    method: str
    provider: str
    amount_usdc: float
    fiat_currency: Optional[str] = None
    status: str
    url: Optional[str] = None
    dest_network: Optional[str] = None
    onchain_tx: Optional[str] = None
    created_at: Optional[str] = None


def _out(i: OnoffIntent, url: Optional[str] = None) -> IntentOut:
    return IntentOut(intent_id=i.intent_id, direction=i.direction, method=i.method, provider=i.provider,
                     amount_usdc=float(i.amount_usdc), fiat_currency=i.fiat_currency, status=i.status, url=url,
                     dest_network=i.dest_network, onchain_tx=i.onchain_tx, created_at=to_utc_iso(i.created_at))


class DepositIn(BaseModel):
    amount_usdc: float = Field(gt=0)
    method: str
    fiat_currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    provider: Optional[str] = None


class WithdrawIn(DepositIn):
    dest_network: Optional[str] = None
    dest_address: Optional[str] = None


def _pick(direction: str, method: str, name: Optional[str]) -> onoff.RampProvider:
    if method not in onoff.FIAT_METHODS:
        raise onoff.OnoffError(422, "bad_method", "unknown method")
    if name:
        p = onoff.get_provider(name)
        if method in p.methods and direction in p.directions:
            return p
    else:
        for p in onoff.providers():
            if method in p.methods and direction in p.directions:
                return p
    raise onoff.OnoffError(503, "no_provider", f"no provider available for {method} {direction}")


@router.get("/config")
async def config():
    return {
        "enabled": settings.onoff_enabled,
        "deposit_enabled": settings.onoff_enabled and settings.onoff_deposit_enabled,
        "withdraw_enabled": settings.onoff_enabled and settings.onoff_withdraw_enabled,
        "limits_usdc": {"per_tx": settings.onoff_max_tx_usdc, "per_day": settings.onoff_max_day_usdc,
                        "per_month": settings.onoff_max_month_usdc},
        "withdraw_min_kyc_level": settings.onoff_withdraw_min_kyc_level,
        "chain_networks": sorted(CHAIN_NETWORKS),
        "providers": [{"name": p.name, "methods": sorted(p.methods), "directions": sorted(p.directions)}
                      for p in onoff.providers()],
    }


async def _start_session(db: AsyncSession, intent: OnoffIntent, provider: onoff.RampProvider) -> Optional[str]:
    try:
        session = await provider.create_session(intent)
    except Exception as exc:  # o provedor caiu: o intent fica registrado como falho, nada é cobrado
        logger.warning("onoff provider %s failed: %s", provider.name, exc)
        intent.error = str(exc)[:500]
        await onoff.advance(db, intent, "failed", actor="system")
        await db.commit()
        raise HTTPException(502, {"code": "provider_error", "message": "provider unavailable, try again"})
    intent.provider_ref, intent.expires_at = session.provider_ref, session.expires_at
    await onoff.advance(db, intent, "pending_provider", actor="system")
    await db.commit()
    return session.url


@router.post("/deposit", response_model=IntentOut)
async def deposit(body: DepositIn, authorization: Optional[str] = Header(default=None),
                  db: AsyncSession = Depends(get_db_session)):
    user = await _resolve_user(db, authorization, strict=True)
    try:
        onoff.check_open(user, onoff.DEPOSIT)
        provider = _pick(onoff.DEPOSIT, body.method, body.provider)
        await onoff.check_limits(db, user.id, onoff.DEPOSIT, body.amount_usdc)
        intent = await onoff.new_intent(db, user_id=user.id, direction=onoff.DEPOSIT, method=body.method,
                                        provider=provider.name, amount=body.amount_usdc, fiat_currency=body.fiat_currency)
        await db.commit()
    except onoff.OnoffError as e:
        raise _fail(e)
    return _out(intent, await _start_session(db, intent, provider))


@router.post("/withdraw", response_model=IntentOut)
async def withdraw(body: WithdrawIn, authorization: Optional[str] = Header(default=None),
                   db: AsyncSession = Depends(get_db_session)):
    user = await _resolve_user(db, authorization, strict=True)
    try:
        onoff.check_open(user, onoff.WITHDRAW)
        chain = body.method == "chain"
        if chain:
            if body.dest_network not in CHAIN_NETWORKS or not _EVM_ADDR_RE.match(body.dest_address or ""):
                raise onoff.OnoffError(422, "bad_destination", "destination network or address is invalid")
            provider = None
            provider_name = CCTP
        else:
            provider = _pick(onoff.WITHDRAW, body.method, body.provider)
            provider_name = provider.name
        await onoff.check_limits(db, user.id, onoff.WITHDRAW, body.amount_usdc)
        await onoff.check_withdraw_gates(db, user.id, body.method, provider_name)
        intent = await onoff.new_intent(db, user_id=user.id, direction=onoff.WITHDRAW, method=body.method,
                                        provider=provider_name, amount=body.amount_usdc, fiat_currency=body.fiat_currency,
                                        dest_network=body.dest_network if chain else None,
                                        dest_address=body.dest_address if chain else None)
        await db.commit()
    except onoff.OnoffError as e:
        raise _fail(e)
    url = None if provider is None else await _start_session(db, intent, provider)
    return _out(intent, url)


@router.get("/intents", response_model=list[IntentOut])
async def list_intents(authorization: Optional[str] = Header(default=None), db: AsyncSession = Depends(get_db_session)):
    user = await _resolve_user(db, authorization, strict=True)
    rows = (await db.execute(select(OnoffIntent).where(OnoffIntent.user_id == user.id)
                             .order_by(OnoffIntent.id.desc()).limit(50))).scalars().all()
    return [_out(i) for i in rows]


@router.get("/intents/{intent_id}", response_model=IntentOut)
async def get_intent(intent_id: str, authorization: Optional[str] = Header(default=None),
                     db: AsyncSession = Depends(get_db_session)):
    user = await _resolve_user(db, authorization, strict=True)
    i = (await db.execute(select(OnoffIntent).where(OnoffIntent.intent_id == intent_id,
                                                    OnoffIntent.user_id == user.id))).scalars().first()
    if i is None:
        raise HTTPException(404, "intent not found")
    return _out(i)


@router.post("/webhooks/{provider}")
async def webhook(provider: str, request: Request, db: AsyncSession = Depends(get_db_session)):
    body = await request.body()
    try:
        p = onoff.get_provider(provider)
        ev = p.verify_webhook({k.lower(): v for k, v in request.headers.items()}, body)
    except onoff.OnoffError as e:
        raise _fail(e)
    if await onoff.seen_event(db, ev.event_id):
        return {"duplicate": True}
    try:
        if ev.kind == "kyc":
            await onoff.apply_kyc(db, p.name, ev)
            await db.commit()
            return {"ok": True}
        i = (await db.execute(select(OnoffIntent).where(OnoffIntent.provider == p.name,
                                                        OnoffIntent.provider_ref == ev.provider_ref))).scalars().first()
        if i is None or not ev.status:
            logger.warning("onoff webhook for unknown intent: provider=%s ref=%s", p.name, ev.provider_ref)
            return {"ignored": True}
        if ev.onchain_tx:
            i.onchain_tx = ev.onchain_tx
        await onoff.advance(db, i, ev.status, actor="webhook", event_id=ev.event_id, payload=body)
        await db.commit()
    except onoff.OnoffError as e:
        await db.rollback()
        if e.status == 409:  # transição inválida/atrasada: o provedor não deve reenviar para sempre
            logger.warning("onoff webhook ignored: %s", e.message)
            return {"ignored": True}
        raise _fail(e)
    except IntegrityError:  # mesmo event_id em corrida: já tratado por outra requisição
        await db.rollback()
        return {"duplicate": True}
    return {"ok": True}
