"""
test_chat_menu_tools.py — tools que as opções do menu do chat acionam (XIAOLEEACE-20).

Regras que estes testes travam:
- `list_campaigns` ranqueia pelo perfil da sessão do chat (o modelo não passa perfil);
- `get_my_activity` devolve o histórico de quem está logado e recusa anônimo.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

import database.database as database_module
from database.models import User, WebSession
from server.orchestration.service import OrchestrationService

pytestmark = [pytest.mark.asyncio, pytest.mark.db]


@pytest.fixture
def executor_for(db_session, test_engine, monkeypatch):
    # As tools abrem a própria sessão via `database.database.SessionLocal`.
    monkeypatch.setattr(database_module, "SessionLocal", async_sessionmaker(test_engine, expire_on_commit=False))
    service = OrchestrationService(gemini=None, solana=None, claude_engine=None)

    def _make(user_id: str):
        captured = {"actions": []}
        return service._make_stellar_executor(None, captured, user_id=user_id), captured

    return _make


async def _login(db, name: str, interests: list[str]) -> str:
    db.add(WebSession(
        session_id=f"privy_session_{name}",
        twitter_user_id=f"privy_{name}",
        expires_at=datetime.utcnow() + timedelta(days=30),
    ))
    db.add(User(twitter_user_id=f"privy_{name}", twitter_handle=name, interest_profile=json.dumps(interests)))
    await db.commit()
    return f"privy_session_{name}"


async def test_list_campaigns_vem_ranqueada_pelo_perfil_da_sessao(db_session, executor_for):
    session_token = await _login(db_session, "gabi", ["trader"])
    executor, captured = executor_for(session_token)

    campaigns = json.loads(await executor("list_campaigns", {}))["campaigns"]

    assert campaigns[0]["campaign_type"] == "trading"
    assert campaigns[0]["matched_interests"] == ["trader"]
    assert captured["actions"] == ["list_campaigns"]


async def test_list_campaigns_anonimo_continua_funcionando(db_session, executor_for):
    executor, _ = executor_for("web_anonymous")
    campaigns = json.loads(await executor("list_campaigns", {}))["campaigns"]
    assert campaigns and all(c["match_score"] == 0 for c in campaigns)


async def test_get_my_activity_devolve_o_resumo_de_quem_esta_logado(db_session, executor_for):
    session_token = await _login(db_session, "duda", ["games"])
    executor, captured = executor_for(session_token)

    summary = json.loads(await executor("get_my_activity", {}))

    assert summary["campaigns_joined"]["total"] == 0
    assert "member_since" in summary
    assert captured["actions"] == ["get_my_activity"]


async def test_get_my_activity_recusa_anonimo(db_session, executor_for):
    executor, captured = executor_for("web_anonymous")
    result = json.loads(await executor("get_my_activity", {}))
    assert result["error"] == "no_session"
    assert captured["actions"] == []
