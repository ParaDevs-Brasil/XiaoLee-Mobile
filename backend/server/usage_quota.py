"""
usage_quota.py — cota diária de mensagens que chegam na LLM (plano grátis) + disjuntor global.

Cada mensagem que iria para a LLM consome 1 da identidade (logado, usuário de bot ou IP anônimo)
e, se passou, 1 do contador global. Estourou: não chama a LLM, responde um aviso. Contadores
em banco (sobrevivem a restart e valem para todas as réplicas), dia em UTC.

A identidade NUNCA vem de campo do cliente: logado = Bearer resolvido; anônimo = IP da conexão.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from fastapi import Request
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import UsageCounter
from server.settings import settings

LOG = logging.getLogger(__name__)
GLOBAL_KEY = "global"


@dataclass(frozen=True)
class Subject:
    key: str
    limit: int  # 0 = sem limite
    scope: str  # "user" | "anon"


@dataclass(frozen=True)
class Decision:
    allowed: bool
    scope: str  # "user" | "anon" | "global"
    limit: int
    used: int
    reset_at: str  # próximo 00:00 UTC (ISO)

    def as_dict(self) -> Dict[str, Any]:
        return {"scope": self.scope, "limit": self.limit, "used": self.used, "reset_at": self.reset_at}


def subject_for_user(platform: str, user_id: str) -> Subject:
    return Subject(f"u:{platform}:{user_id}", settings.free_daily_messages, "user")


def subject_for_ip(ip: str) -> Subject:
    return Subject(f"ip:{ip}", settings.anon_daily_messages, "anon")


def client_ip(request: Request) -> str:
    """IP do cliente atrás de N proxies confiáveis: o N-ésimo de trás para frente em X-Forwarded-For
    (o proxy anexa o IP que o conectou; o que vem antes é dado pelo cliente e pode ser forjado)."""
    hops = settings.trusted_proxy_hops
    parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    if hops > 0 and len(parts) >= hops:
        return parts[-hops]
    return request.client.host if request.client else "unknown"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _bump(db: AsyncSession, key: str, day: str) -> int:
    """+1 atômico (upsert) e devolve o total do dia."""
    ins = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    stmt = (
        ins(UsageCounter).values(key=key, day=day, count=1)
        .on_conflict_do_update(index_elements=["key", "day"], set_={"count": UsageCounter.count + 1})
        .returning(UsageCounter.count)
    )
    n = (await db.execute(stmt)).scalar_one()
    await db.commit()
    return int(n)


async def consume(db: AsyncSession, subject: Subject) -> Decision:
    now = _now()
    day = now.strftime("%Y-%m-%d")
    reset_at = (now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)).isoformat()
    try:
        if subject.limit > 0:
            used = await _bump(db, subject.key, day)
            if used > subject.limit:
                return Decision(False, subject.scope, subject.limit, used, reset_at)
        cap = settings.llm_global_daily_messages
        if cap > 0:
            # só conta no global quem passou na cota individual: tentativa barrada não gasta o de todos
            used = await _bump(db, GLOBAL_KEY, day)
            if used > cap:
                return Decision(False, "global", cap, used, reset_at)
    except Exception:
        # ponytail: fail-open. O medidor não pode derrubar o produto (ex.: migração ainda não aplicada);
        # o erro fica no log. Trocar por fail-closed se o custo da LLM virar o risco maior.
        LOG.exception("[quota] counter failed; allowing message")
        await db.rollback()
    return Decision(True, subject.scope, subject.limit, 0, reset_at)


def exceeded_message(d: Decision) -> str:
    if d.scope == "global":
        return ("A XiaoLee está com demanda muito alta hoje e pausou novas conversas. Volte amanhã.\n"
                "XiaoLee is at capacity today and paused new chats. Please come back tomorrow.")
    if d.scope == "anon":
        return (f"Você usou as {d.limit} mensagens grátis de hoje. Entre na sua conta para continuar (renova à 00:00 UTC).\n"
                f"You've used today's {d.limit} free messages. Sign in to keep chatting (resets 00:00 UTC).")
    return (f"Você atingiu o limite de {d.limit} mensagens do plano grátis hoje. Ele renova à 00:00 UTC, ou assine para continuar agora.\n"
            f"You've reached today's free limit of {d.limit} messages. It resets at 00:00 UTC, or upgrade to continue now.")
