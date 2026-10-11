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

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db_session
from database.models import UsedPayment
from server import x402_clips, x402_llm
from services.pqc_receipt import sign_receipt

router = APIRouter(prefix="/internal/x402", tags=["x402-internal"])

USDC_DECIMALS = Decimal(10) ** 6


def _require_internal(secret: Optional[str]) -> None:
    expected = os.getenv("X402_INTERNAL_SECRET", "")
    # sem segredo configurado a rota fica fechada (fail-closed)
    if not expected or not secret or not hmac.compare_digest(secret, expected):
        raise HTTPException(status_code=403, detail="forbidden")


class Segment(BaseModel):
    start: float = Field(ge=0, le=86_400)
    end: float = Field(ge=0, le=86_400)
    text: str = Field(min_length=1, max_length=200)


class ClipHighlightsIn(BaseModel):
    # mesmos limites do catálogo do gateway (que valida ANTES de cobrar): custo do LLM fica limitado
    transcript: list[Segment] = Field(min_length=3, max_length=200)
    language: str = Field(default="", max_length=32)
    max_clips: int = Field(default=3, ge=1, le=5)


class CampaignPlanIn(BaseModel):
    goal: str = Field(min_length=1, max_length=200)
    budget_usdc: float = Field(gt=0, le=1_000_000)
    platforms: list[str] = Field(default_factory=lambda: ["tiktok"], min_length=1, max_length=8)
    duration_days: int = Field(default=14, ge=1, le=90)
    niche: str = Field(default="", max_length=64)


def plan_campaign(p: CampaignPlanIn) -> dict:
    """Heurística determinística (sem LLM): rápida, reproduzível, testável.
    # ponytail: regras fixas de divisão de orçamento; trocar por LLM/dados reais depois."""
    reward_pool = round(p.budget_usdc * 0.85, 2)  # 15% reservado a verificação e taxas
    per_platform = round(reward_pool / len(p.platforms), 2)
    return {
        "goal": p.goal,
        "duration_days": p.duration_days,
        "budget_split": {"rewards_usdc": reward_pool, "ops_reserve_usdc": round(p.budget_usdc - reward_pool, 2)},
        "platforms": [
            {"platform": pl, "reward_budget_usdc": per_platform,
             "suggested_tasks": ["publicar 1 vídeo com a mensagem da campanha", "marcar o perfil da marca", "manter o post no ar até o fim"]}
            for pl in p.platforms
        ],
        "creator_payout_rule": "pagamento em USDC após verificação das tarefas (cada tarefa verificada libera sua parcela)",
        "success_metrics": ["tarefas verificadas / participantes", "custo por tarefa verificada", "alcance reportado"],
    }


async def _paid(request: Request, db: AsyncSession, result: dict) -> dict:
    """Parte comum dos serviços pagos: trilha de auditoria e recibo PQC (o segredo é checado antes, na rota)."""
    h = request.headers
    payer, network, tx = h.get("x-payer", ""), h.get("x-payment-network", ""), h.get("x-payment-tx", "")
    try:
        amount_usdc = float(Decimal(h.get("x-payment-amount") or "0") / USDC_DECIMALS)
    except Exception:
        amount_usdc = 0.0

    # Trilha de auditoria. O anti-replay do pagamento em si é feito pelo Gateway (nonce da
    # autorização EIP-3009); aqui o UNIQUE só evita registrar duas vezes o mesmo tx.
    if tx:
        db.add(UsedPayment(
            tx_hash=f"{network}:{tx}"[:255],
            user_id=payer or None,
            amount_xlm=amount_usdc,  # coluna legada reutilizada para USDC (igual ao arc_x402)
            network=(network or "x402")[:16],
        ))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()

    intent_id = str(uuid.uuid4())
    return {
        "result": result,
        "receipt": {
            "intent_id": intent_id,
            "payer": payer,
            "amount_usdc": amount_usdc,
            "network": network,
            "payment_tx": tx,
            "receipt_pqc": sign_receipt(intent_id, payer, amount_usdc, tx),
        },
    }


async def _enriched(service: str, payload: dict, result: dict) -> dict:
    """Heurística é a base; o LLM só acrescenta `ai_insights` (flag + orçamento em x402_llm)."""
    insights = await x402_llm.enrich(service, payload, result)
    if insights:
        result["ai_insights"] = insights
    return result


@router.post("/clip-highlights")
async def clip_highlights(body: ClipHighlightsIn, request: Request, db: AsyncSession = Depends(get_db_session)):
    _require_internal(request.headers.get("x-internal-secret"))  # falha antes de qualquer trabalho
    result = await x402_clips.pick_clips([s.model_dump() for s in body.transcript], body.language, body.max_clips)
    return await _paid(request, db, result)


@router.post("/campaign-plan")
async def campaign_plan(body: CampaignPlanIn, request: Request, db: AsyncSession = Depends(get_db_session)):
    _require_internal(request.headers.get("x-internal-secret"))
    return await _paid(request, db, await _enriched("campaign-plan", body.model_dump(), plan_campaign(body)))
