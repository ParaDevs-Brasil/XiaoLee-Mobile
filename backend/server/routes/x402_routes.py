"""
x402_routes.py — Protocolo x402: micropagamentos HTTP nativos para AI queries.

PDR-007 do RT XiaoLee Stellar: endpoints de AI premium que exigem micropagamento
em XLM via Stellar testnet antes de processar a query.

Fluxo:
    1. POST /v1/ai/query (sem X-Payment header)
       → 402 Payment Required + detalhes do pagamento no header X-Payment-Required
    2. Cliente paga na Stellar testnet (envia XLM para a carteira do servidor)
    3. POST /v1/ai/query (com X-Payment: {"tx_hash": "...", "network": "testnet"})
       → 200 OK com resposta da AI

X-Payment-Required format (JSON):
    {
        "network": "stellar",
        "scheme": "stellar",
        "asset": "XLM",
        "amount": "0.5",
        "pay_to": "G...",
        "memo": "xiaolee-ai-query",
        "expires": <unix timestamp>
    }
"""

from __future__ import annotations

import json
import logging
import os
import time

import httpx
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db_session
from database.models import UsedPayment
from database.repository import DatabaseRepository
from server.integrations.stellar_adapter import StellarAdapter

LOG = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/ai", tags=["x402"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _x402_wallet() -> str:
    return os.getenv("STELLAR_X402_WALLET", "")


def _x402_price_xlm() -> float:
    return float(os.getenv("STELLAR_X402_PRICE_XLM", "0.5"))


def _x402_enabled() -> bool:
    return os.getenv("STELLAR_X402_ENABLED", "true").lower() == "true"


def _stellar_network() -> str:
    return os.getenv("STELLAR_NETWORK", "testnet")


# ---------------------------------------------------------------------------
# Payment info builder
# ---------------------------------------------------------------------------

def _build_payment_info(expires_in: int = 300) -> Dict[str, Any]:
    pay_to = _x402_wallet()
    if not pay_to:
        raise HTTPException(
            status_code=503,
            detail="Payment service not configured: STELLAR_X402_WALLET not set.",
        )
    return {
        "version": "x402/1",
        "network": "stellar",
        "scheme": "stellar",
        "asset": "XLM",
        "amount": str(_x402_price_xlm()),
        "pay_to": pay_to,
        "memo": "xiaolee-ai-query",
        "expires": int(time.time()) + expires_in,
        "testnet": _stellar_network() == "testnet",
    }


# ---------------------------------------------------------------------------
# Payment verification
# ---------------------------------------------------------------------------

async def _verify_payment_header(
    x_payment: str, stellar: StellarAdapter
) -> bool:  # raises HTTPException(503) if wallet unconfigured
    """
    Valida o header X-Payment enviado pelo cliente após o pagamento.
    Formato: JSON com {"tx_hash": "...", "network": "testnet"}
    """
    try:
        data = json.loads(x_payment)
    except Exception:
        return False

    tx_hash = data.get("tx_hash", "")
    if not tx_hash:
        return False

    pay_to = _x402_wallet()
    if not pay_to:
        LOG.error("[x402] STELLAR_X402_WALLET not configured — service unavailable")
        raise HTTPException(
            status_code=503,
            detail="Payment processing temporarily unavailable: server wallet not configured.",
        )

    min_amount = _x402_price_xlm()
    return await stellar.verify_payment(
        tx_hash=tx_hash,
        expected_destination=pay_to,
        min_amount_xlm=min_amount,
    )


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

class _AIQueryRequest:
    def __init__(self, message: str, context: Optional[str] = None):
        self.message = message
        self.context = context


@router.post("/query")
async def ai_query(
    request: Request,
    x_payment: Optional[str] = Header(default=None, alias="X-Payment"),
    db: AsyncSession = Depends(get_db_session),
):
    """
    AI query premium protegida por x402.

    Sem X-Payment: retorna 402 com instruções de pagamento.
    Com X-Payment válido: processa query e retorna resposta.
    """
    stellar = StellarAdapter(network=_stellar_network())

    if _x402_enabled():
        if not x_payment:
            payment_info = _build_payment_info()
            return JSONResponse(
                status_code=402,
                content={
                    "error": "Payment Required",
                    "message": (
                        "Esta query AI requer um micropagamento de "
                        f"{_x402_price_xlm()} XLM via Stellar. "
                        "Envie o pagamento e inclua o tx_hash no header X-Payment."
                    ),
                    "payment": payment_info,
                },
                headers={"X-Payment-Required": json.dumps(payment_info)},
            )

        payment_valid = await _verify_payment_header(x_payment, stellar)
        if not payment_valid:
            raise HTTPException(
                status_code=402,
                detail="Payment verification failed. Check tx_hash and amount.",
            )

        # SEC-001: anti-replay — extract and atomically claim tx_hash BEFORE processing
        try:
            payment_data = json.loads(x_payment)
            tx_hash_used = payment_data.get("tx_hash", "")
        except Exception:
            tx_hash_used = ""

        if not tx_hash_used:
            raise HTTPException(status_code=402, detail="Payment verification failed: missing tx_hash.")

    # Pagamento validado (ou x402 desabilitado) — processa a query
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc

    message = str(body.get("message", "")).strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    raw_wallet = body.get("stellar_wallet", "")
    user_id = body.get("user_id", "stellar_web_anonymous")

    # Atomically claim payment BEFORE the expensive orchestrator call (TOCTOU fix)
    if _x402_enabled() and x_payment and tx_hash_used:
        db.add(UsedPayment(
            tx_hash=tx_hash_used,
            user_id=user_id,
            amount_xlm=_x402_price_xlm(),
            network=_stellar_network(),
        ))
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(
                status_code=402,
                detail="Payment already used. Each transaction can only be redeemed once.",
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

    # Validate wallet address format before injecting into prompt (prompt injection mitigation)
    text_with_ctx = message
    if raw_wallet and raw_wallet.startswith("G") and len(raw_wallet) == 56:
        text_with_ctx = f"[System Note: Stellar wallet {raw_wallet}] {message}"

    result = await _orchestrator.execute(text_with_ctx, user_id, history=history)
    await repo.log_dm(user.id, "web", result["reply_text"], message_type="bot")

    await db.commit()

    return {
        "reply": result["reply_text"],
        "intent": result["intent"].model_dump() if hasattr(result["intent"], "model_dump") else str(result["intent"]),
        "execution": result["execution"],
        "x402_verified": _x402_enabled() and x_payment is not None,
    }


@router.get("/query/payment-info")
async def payment_info():
    """Retorna as informações de pagamento x402 atuais."""
    return _build_payment_info()


@router.get("/query/verify-tx")
async def verify_tx(tx_hash: str = Query(...)):
    """Debug: verifica manualmente se um tx_hash passa pela validação x402."""
    stellar = StellarAdapter(network=_stellar_network())
    pay_to = _x402_wallet()
    min_amount = _x402_price_xlm()
    result = await stellar.verify_payment(tx_hash, pay_to, min_amount)
    return {
        "tx_hash": tx_hash,
        "expected_destination": pay_to,
        "min_amount_xlm": min_amount,
        "verified": result,
    }


@router.get("/query/payment-tx")
async def get_payment_tx(account: str = Query(..., description="Stellar public key G...")):
    """
    Constrói XDR de pagamento não assinado para o protocolo x402.
    O frontend assina com Freighter e submete ao Horizon.
    Retorna: { xdr, network_passphrase, pay_to, amount, memo }
    """
    if not account.startswith("G") or len(account) < 56:
        raise HTTPException(status_code=400, detail="Invalid Stellar account format")

    try:
        from stellar_sdk import Network, TransactionBuilder, Asset, Account as StellarAccount
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="stellar-sdk not installed") from exc

    pinfo = _build_payment_info()
    pay_to = pinfo["pay_to"]
    amount = pinfo["amount"]
    memo_text = pinfo["memo"]

    network = _stellar_network()
    horizon = (
        "https://horizon-testnet.stellar.org"
        if network == "testnet"
        else "https://horizon.stellar.org"
    )
    network_passphrase = (
        Network.TESTNET_NETWORK_PASSPHRASE
        if network == "testnet"
        else Network.PUBLIC_NETWORK_PASSPHRASE
    )

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{horizon}/accounts/{account}")
        if not resp.is_success:
            raise HTTPException(
                status_code=400,
                detail=f"Conta não encontrada no {network}: {account}",
            )
        acc_data = resp.json()

    sequence = int(acc_data["sequence"])
    source = StellarAccount(account, sequence)

    tx = (
        TransactionBuilder(
            source_account=source,
            network_passphrase=network_passphrase,
            base_fee=100,
        )
        .add_text_memo(memo_text)
        .append_payment_op(
            destination=pay_to,
            asset=Asset.native(),
            amount=amount,
        )
        .set_timeout(300)
        .build()
    )

    return {
        "xdr": tx.to_xdr(),
        "network_passphrase": network_passphrase,
        "pay_to": pay_to,
        "amount": amount,
        "memo": memo_text,
    }
