"""
arc_x402_routes.py — Protocolo x402 adaptado para Arc/USDC.

PDR-007 Arc: endpoints AI premium com micropagamento USDC no Arc.
Coexiste com x402_routes.py (Stellar/XLM) durante a migração sem conflito
de prefixo: este router usa /v1/arc/ai; o Stellar usa /v1/ai.

Fluxo:
    1. POST /v1/arc/ai/query (sem X-Payment header)
       → 402 Payment Required + payment info em X-Payment-Required
    2. Cliente envia USDC via Circle W3S para ARC_X402_WALLET_ADDRESS
       e obtém o circle_id da transação Circle
    3. POST /v1/arc/ai/query (com X-Payment: {"circle_id": "..."})
       → 200 OK com resposta da AI

X-Payment-Required format (JSON):
    {
        "version": "x402/1",
        "network": "arc",
        "scheme": "arc",
        "asset": "USDC",
        "amount": "0.10",
        "pay_to": "<ARC_X402_WALLET_ADDRESS>",
        "blockchain": "ETH-SEPOLIA",
        "expires": <unix timestamp>
    }

Variáveis de ambiente:
    ARC_X402_WALLET_ADDRESS  — endereço EVM da wallet que recebe o pagamento (obrigatório)
    ARC_X402_PRICE_USDC      — preço em USDC por query (default: "0.10")
    ARC_X402_ENABLED         — "true"/"false", habilita/desabilita a exigência de pagamento (default: "true")

Anti-replay (SEC-001):
    circle_id é registrado atomicamente em UsedPayment.tx_hash antes de chamar o orchestrator.
    IntegrityError (UNIQUE constraint) rejeita reúso do mesmo circle_id.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db_session
from database.models import UsedPayment
from database.repository import DatabaseRepository
from server.integrations.arc_client import ArcClient
from server.settings import settings

LOG = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/arc/ai", tags=["arc-x402"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


def _arc_x402_wallet() -> str:
    return os.getenv("ARC_X402_WALLET_ADDRESS", "")


def _arc_x402_price_usdc() -> float:
    return float(os.getenv("ARC_X402_PRICE_USDC", "0.10"))


def _arc_x402_enabled() -> bool:
    return os.getenv("ARC_X402_ENABLED", "true").lower() == "true"


def _arc_client() -> ArcClient:
    return ArcClient(
        api_key=settings.circle_api_key,
        wallet_id=settings.circle_wallet_id,
        blockchain=settings.circle_blockchain,
        usdc_token_id=settings.circle_usdc_token_id,
        sandbox=settings.arc_sandbox,
    )


# ---------------------------------------------------------------------------
# Payment info builder
# ---------------------------------------------------------------------------


def _build_payment_info(expires_in: int = 300) -> Dict[str, Any]:
    pay_to = _arc_x402_wallet()
    if not pay_to:
        raise HTTPException(
            status_code=503,
            detail="Payment service not configured: ARC_X402_WALLET_ADDRESS not set.",
        )
    return {
        "version": "x402/1",
        "network": "arc",
        "scheme": "arc",
        "asset": "USDC",
        "amount": str(_arc_x402_price_usdc()),
        "pay_to": pay_to,
        "blockchain": settings.circle_blockchain or "ETH-SEPOLIA",
        "expires": int(time.time()) + expires_in,
    }


# ---------------------------------------------------------------------------
# Payment verification
# ---------------------------------------------------------------------------


async def _verify_payment_arc(x_payment: str, arc: ArcClient) -> tuple[bool, str]:
    """
    Valida o header X-Payment enviado pelo cliente apos o pagamento Arc/USDC.
    Formato: JSON com {"circle_id": "<circle_transaction_id>"}

    Em sandbox (ARC_SANDBOX=true): qualquer circle_id nao-vazio e aceito.
    Em live: verifica destination == ARC_X402_WALLET_ADDRESS e amount >= preco.

    Retorna (valido, circle_id).
    """
    try:
        data = json.loads(x_payment)
    except Exception:
        return False, ""

    circle_id = data.get("circle_id", "")
    if not circle_id:
        return False, ""

    try:
        result = await arc.get_transfer_result(circle_id)
    except RuntimeError as exc:
        LOG.error("[arc-x402] get_transfer_result error circle_id=%s: %s", circle_id, exc)
        return False, circle_id

    if not result.confirmed:
        LOG.warning(
            "[arc-x402] payment not confirmed circle_id=%s status=%s",
            circle_id, result.status,
        )
        return False, circle_id

    # Live mode: verify destination and amount
    if not arc.sandbox:
        pay_to = _arc_x402_wallet()
        min_amount = _arc_x402_price_usdc()

        if result.to and pay_to and result.to.lower() != pay_to.lower():
            LOG.warning(
                "[arc-x402] payment to wrong address: got=%s expected=%s",
                result.to, pay_to,
            )
            return False, circle_id

        if result.amount_usdc > 0 and result.amount_usdc < min_amount * 0.99:
            LOG.warning(
                "[arc-x402] insufficient payment: %.6f < %.6f USDC",
                result.amount_usdc, min_amount,
            )
            return False, circle_id

    return True, circle_id


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/query")
async def arc_ai_query(
    request: Request,
    x_payment: Optional[str] = Header(default=None, alias="X-Payment"),
    db: AsyncSession = Depends(get_db_session),
):
    """
    AI query premium protegida por x402 Arc/USDC.

    Sem X-Payment: retorna 402 com instrucoes de pagamento USDC no Arc.
    Com X-Payment valido: processa query e retorna resposta da AI.

    X-Payment format: JSON com {"circle_id": "<circle_transaction_id>"}
    """
    arc = _arc_client()

    if _arc_x402_enabled():
        if not x_payment:
            payment_info = _build_payment_info()
            return JSONResponse(
                status_code=402,
                content={
                    "error": "Payment Required",
                    "message": (
                        f"Esta query AI requer um micropagamento de "
                        f"{_arc_x402_price_usdc()} USDC no Arc. "
                        "Envie o pagamento para pay_to e inclua o circle_id "
                        "no header X-Payment."
                    ),
                    "payment": payment_info,
                },
                headers={"X-Payment-Required": json.dumps(payment_info)},
            )

        payment_valid, circle_id = await _verify_payment_arc(x_payment, arc)
        if not payment_valid:
            raise HTTPException(
                status_code=402,
                detail="Payment verification failed. Check circle_id and USDC amount.",
            )

        if not circle_id:
            raise HTTPException(
                status_code=402,
                detail="Payment verification failed: missing circle_id.",
            )

    else:
        # x402 disabled — still try to extract circle_id if present for logging
        circle_id = ""
        if x_payment:
            try:
                circle_id = json.loads(x_payment).get("circle_id", "")
            except Exception:
                pass

    # --- Pagamento validado (ou arc-x402 desabilitado) ---
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc

    message = str(body.get("message", "")).strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    raw_wallet = body.get("arc_wallet", "")  # EVM address 0x...
    user_id = body.get("user_id", "arc_web_anonymous")

    # Atomically claim payment BEFORE the expensive orchestrator call (TOCTOU fix - SEC-001)
    if _arc_x402_enabled() and x_payment and circle_id:
        db.add(UsedPayment(
            tx_hash=circle_id,                        # circle_id como idempotency key
            user_id=user_id,
            amount_xlm=_arc_x402_price_usdc(),        # campo reutilizado para USDC amount
            network="arc",
        ))
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(
                status_code=402,
                detail="Payment already used. Each circle_id can only be redeemed once.",
            )

    # Delega ao OrchestrationService existente
    from server.app import orchestrator as _orchestrator  # lazy import to avoid circular
    repo = DatabaseRepository(db)
    user = await repo.get_or_create_user("web", user_id)
    history = await repo.get_user_history(user.id, limit=10)
    await repo.log_dm(user.id, "web", message, message_type="user")
    # As tools de campanha do orchestrator abrem conexão SQLite própria — sem
    # commitar antes, a escrita pendente aqui colide com a delas ("database is
    # locked", SQLite só aceita um escritor por vez).
    await db.commit()

    # Validate EVM wallet before injecting into prompt (prompt injection mitigation)
    text_with_ctx = message
    if raw_wallet and raw_wallet.startswith("0x") and len(raw_wallet) == 42:
        text_with_ctx = f"[System Note: Arc EVM wallet {raw_wallet}] {message}"

    result = await _orchestrator.execute(text_with_ctx, user_id, history=history)
    await repo.log_dm(user.id, "web", result["reply_text"], message_type="bot")

    await db.commit()

    return {
        "reply": result["reply_text"],
        "intent": (
            result["intent"].model_dump()
            if hasattr(result["intent"], "model_dump")
            else str(result["intent"])
        ),
        "execution": result["execution"],
        "arc_x402_verified": _arc_x402_enabled() and x_payment is not None,
        "payment_network": "arc",
        "payment_asset": "USDC",
    }


@router.get("/query/payment-info")
async def arc_payment_info():
    """Retorna as informacoes de pagamento x402 Arc/USDC atuais."""
    return _build_payment_info()


@router.get("/query/verify-transfer")
async def arc_verify_transfer(circle_id: str = Query(...)):
    """
    Debug: verifica manualmente se um circle_id passa pela validacao x402 Arc.

    Util para testar o fluxo antes de chamar o endpoint principal.
    Em sandbox (ARC_SANDBOX=true) sempre retorna verified=true.
    """
    arc = _arc_client()
    pay_to = _arc_x402_wallet()
    min_amount = _arc_x402_price_usdc()

    try:
        result = await arc.get_transfer_result(circle_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    destination_ok = (
        arc.sandbox
        or not result.to
        or not pay_to
        or result.to.lower() == pay_to.lower()
    )
    amount_ok = (
        arc.sandbox
        or result.amount_usdc <= 0
        or result.amount_usdc >= min_amount * 0.99
    )

    return {
        "circle_id": circle_id,
        "status": result.status,
        "confirmed": result.confirmed,
        "arc_tx_hash": result.arc_tx_hash,
        "amount_usdc": result.amount_usdc,
        "to": result.to,
        "expected_destination": pay_to,
        "min_amount_usdc": min_amount,
        "sandbox": result.sandbox,
        "destination_ok": destination_ok,
        "amount_ok": amount_ok,
        "verified": result.confirmed and destination_ok and amount_ok,
    }
