"""
x402_internal_routes.py — serviços pagos via Circle Gateway (x402 v2).

O pagamento é cobrado e liquidado pelo serviço Node `x402-gateway` (SDK oficial
@circle-fin/x402-batching) ANTES de chamar estas rotas. Elas são internas: só aceitam
chamadas com o segredo compartilhado (X402_INTERNAL_SECRET); sem ele, 403. Isso impede
que alguém chame direto o FastAPI e pule o pagamento.

Entrega = resultado + recibo PQC (ML-DSA) ligando pagador, valor e tx de liquidação:
é a prova de pagamento+entrega pedida pelo Arc.
"""

from __future__ import annotations

import hmac
import os
import uuid
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db_session
from database.models import UsedPayment
from services.pqc_receipt import sign_receipt

router = APIRouter(prefix="/internal/x402", tags=["x402-internal"])

USDC_DECIMALS = Decimal(10) ** 6


def _require_internal(secret: Optional[str]) -> None:
    expected = os.getenv("X402_INTERNAL_SECRET", "")
    # sem segredo configurado a rota fica fechada (fail-closed)
    if not expected or not secret or not hmac.compare_digest(secret, expected):
        raise HTTPException(status_code=403, detail="forbidden")


class ProfileAnalysisIn(BaseModel):
    handle: str = Field(min_length=1, max_length=64)
    niche: str = Field(min_length=1, max_length=64)
    platforms: list[str] = Field(default_factory=list, max_length=8)
    followers: int = Field(default=0, ge=0, le=10**9)
    posts_per_week: float = Field(default=0, ge=0, le=100)


_FORMATS = {
    "short_video": "Clipes verticais 9:16 de 20-45s com legenda embutida",
    "thread": "Threads com tese + prova + chamada para ação",
    "live_recap": "Cortes dos melhores momentos de lives/podcasts",
    "newsletter": "Resumo semanal curado para audiência fiel",
}


def analyze(p: ProfileAnalysisIn) -> dict:
    """Heurística determinística (sem LLM): rápida, reproduzível, testável.
    # ponytail: heurística simples; trocar por LLM quando o serviço for vendido no catálogo."""
    plats = {s.lower() for s in p.platforms}
    cadence = min(p.posts_per_week / 7, 1.0)
    reach = min(p.followers / 100_000, 1.0)
    score = round(100 * (0.5 * cadence + 0.3 * reach + 0.2 * min(len(plats) / 3, 1.0)))
    formats = ["short_video"] if plats & {"tiktok", "instagram", "youtube"} else ["thread"]
    if p.posts_per_week < 3:
        formats.append("live_recap")
    if p.followers >= 5_000:
        formats.append("newsletter")
    return {
        "handle": p.handle,
        "niche": p.niche,
        "growth_readiness_score": score,
        "recommended_formats": [{"id": f, "why": _FORMATS[f]} for f in formats],
        "next_step": "Publicar 3 clipes/semana por 4 semanas e medir retenção"
        if score < 70 else "Escalar com agendador e 2º canal",
    }


@router.post("/profile-analysis")
async def profile_analysis(
    body: ProfileAnalysisIn,
    x_internal_secret: Optional[str] = Header(default=None),
    x_payer: str = Header(default=""),
    x_payment_network: str = Header(default=""),
    x_payment_amount: str = Header(default="0"),
    x_payment_tx: str = Header(default=""),
    db: AsyncSession = Depends(get_db_session),
):
    _require_internal(x_internal_secret)

    try:
        amount_usdc = float(Decimal(x_payment_amount or "0") / USDC_DECIMALS)
    except Exception:
        amount_usdc = 0.0

    # Trilha de auditoria. O anti-replay do pagamento em si é feito pelo Gateway (nonce da
    # autorização EIP-3009); aqui o UNIQUE só evita registrar duas vezes o mesmo tx.
    if x_payment_tx:
        db.add(UsedPayment(
            tx_hash=f"{x_payment_network}:{x_payment_tx}"[:255],
            user_id=x_payer or None,
            amount_xlm=amount_usdc,  # coluna legada reutilizada para USDC (igual ao arc_x402)
            network=(x_payment_network or "x402")[:16],
        ))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()

    result = analyze(body)
    intent_id = str(uuid.uuid4())
    receipt = sign_receipt(intent_id, x_payer, amount_usdc, x_payment_tx)
    return {
        "result": result,
        "receipt": {
            "intent_id": intent_id,
            "payer": x_payer,
            "amount_usdc": amount_usdc,
            "network": x_payment_network,
            "payment_tx": x_payment_tx,
            "receipt_pqc": receipt,
        },
    }
