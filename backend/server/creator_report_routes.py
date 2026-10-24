"""
creator_report_routes.py — leitura dos relatórios de 30 dias do creator (server/creator_report.py).

    GET /v1/reports/me        → relatórios do usuário da sessão, mais novo primeiro (resumo)
    GET /v1/reports/me/{id}   → um relatório completo: métricas do período e do anterior + sugestões da IA

Só leitura: quem gera é o job periódico. Relatório de outro usuário responde 404, não 403 (não confirma que existe).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db_session
from database.models import CreatorReport
from server.campaigns_routes import _resolve_user

router = APIRouter(prefix="/v1/reports", tags=["reports"])


class ReportSummary(BaseModel):
    id: int
    period_start: datetime
    period_end: datetime
    summary: str


class ReportSuggestion(BaseModel):
    title: str
    action: str
    why: str


class ReportDetail(ReportSummary):
    metrics: dict
    previous: dict
    suggestions: list[ReportSuggestion]


def _detail(r: CreatorReport) -> ReportDetail:
    metrics = json.loads(r.metrics_json)
    return ReportDetail(
        id=r.id, period_start=r.period_start, period_end=r.period_end, summary=r.summary,
        metrics=metrics.get("current", {}), previous=metrics.get("previous", {}),
        suggestions=json.loads(r.suggestions_json),
    )


@router.get("/me", response_model=list[ReportSummary])
async def list_reports(
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    user = await _resolve_user(db, authorization, strict=True)
    rows = (await db.execute(
        select(CreatorReport).where(CreatorReport.user_id == user.id).order_by(CreatorReport.period_end.desc())
    )).scalars().all()
    return [ReportSummary(id=r.id, period_start=r.period_start, period_end=r.period_end, summary=r.summary) for r in rows]


@router.get("/me/{report_id}", response_model=ReportDetail)
async def get_report(
    report_id: int,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    user = await _resolve_user(db, authorization, strict=True)
    report = await db.get(CreatorReport, report_id)
    if report is None or report.user_id != user.id:
        raise HTTPException(404, "report not found")
    return _detail(report)
