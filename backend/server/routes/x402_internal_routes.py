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


class CampaignPlanIn(BaseModel):
    goal: str = Field(min_length=1, max_length=200)
    budget_usdc: float = Field(gt=0, le=1_000_000)
    platforms: list[str] = Field(default_factory=lambda: ["tiktok"], min_length=1, max_length=8)
    duration_days: int = Field(default=14, ge=1, le=90)
    niche: str = Field(default="", max_length=64)


def plan_campaign(p: CampaignPlanIn) -> dict:
    """Heurística determinística (sem LLM), mesma filosofia de analyze().
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


@router.post("/profile-analysis")
async def profile_analysis(body: ProfileAnalysisIn, request: Request, db: AsyncSession = Depends(get_db_session)):
    _require_internal(request.headers.get("x-internal-secret"))  # falha antes de qualquer trabalho
    return await _paid(request, db, analyze(body))


@router.post("/campaign-plan")
async def campaign_plan(body: CampaignPlanIn, request: Request, db: AsyncSession = Depends(get_db_session)):
    _require_internal(request.headers.get("x-internal-secret"))
    return await _paid(request, db, plan_campaign(body))
