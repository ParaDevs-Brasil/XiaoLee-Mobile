"""
test_agent_routes_auth.py — o agente de campanha paga da tesouraria, então:

  * só dispara o criador da campanha, com token que o backend emitiu;
  * fora do sandbox vale o kill switch, o teto do pool e o teto diário (24h);
  * status e listagem dos runs só aparecem para quem os disparou.
"""
from __future__ import annotations

import dataclasses
import importlib
import os
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.database import get_db_session
from database.models import Campaign, PaymentIntent, User, WebSession

app_module = importlib.import_module("server.app")
agent_routes = importlib.import_module("server.routes.agent_routes")
client = TestClient(app_module.app, raise_server_exceptions=False)


@pytest_asyncio.fixture
async def db(db_session, monkeypatch):
    async def _override():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = _override

    async def _noop(*args, **kwargs):  # nunca dispara o engine/Circle de verdade
        return None

    monkeypatch.setattr(agent_routes, "_run_agent_task", _noop)
    agent_routes._RUNS.clear()
    yield db_session
    agent_routes._RUNS.clear()
    app_module.app.dependency_overrides.pop(get_db_session, None)


async def _login(db, name: str) -> dict[str, str]:
    db.add(User(twitter_user_id=f"privy_{name}", twitter_handle=name))
    db.add(
        WebSession(
            session_id=f"privy_session_{name}",
            twitter_user_id=f"privy_{name}",
            expires_at=datetime.utcnow() + timedelta(days=1),
        )
    )
    await db.commit()
    return {"Authorization": f"Bearer privy_session_{name}"}


async def _campaign(db, owner: str, pool: float = 50.0) -> int:
    camp = Campaign(
        creator_twitter_user_id=f"privy_{owner}", name="agent", description="d", campaign_type="social",
        reward_token="USDC", reward_per_participant=1.0, max_participants=50, reward_pool=pool, status="active",
    )
    db.add(camp)
    await db.commit()
    await db.refresh(camp)
    return camp.id


def _mainnet(monkeypatch, **over):
    cfg = dict(arc_sandbox=False, payouts_enabled=True, payout_daily_budget_usdc=20.0)
    cfg.update(over)
    monkeypatch.setattr(agent_routes, "settings", dataclasses.replace(agent_routes.settings, **cfg))


def _run(cid: int, headers=None, budget: float = 5.0):
    return client.post("/v1/agent/run-campaign", json={"campaign_id": cid, "budget_usdc": budget}, headers=headers or {})


@pytest.mark.asyncio
class TestRunCampaignAuth:
    async def test_requires_a_token_the_backend_issued(self, db):
        cid = await _campaign(db, "boss")
        await _login(db, "boss")
        # sem Bearer, e o id público do criador usado como token (modo legado), não valem
        for headers in ({}, {"Authorization": "Bearer privy_boss"}):
            assert _run(cid, headers).status_code == 401, headers
        assert agent_routes._RUNS == {}

    async def test_only_the_campaign_creator_can_run(self, db):
        cid = await _campaign(db, "boss")
        await _login(db, "boss")
        stranger = await _login(db, "stranger")
        assert _run(cid, stranger).status_code == 403
        assert agent_routes._RUNS == {}

    async def test_creator_can_run(self, db):
        cid = await _campaign(db, "boss")
        headers = await _login(db, "boss")
        r = _run(cid, headers)
        assert r.status_code == 200, r.text
        assert agent_routes._RUNS[r.json()["agent_run_id"]]["owner"] == "privy_boss"


@pytest.mark.asyncio
class TestMainnetMoneyGuards:
    async def test_kill_switch(self, db, monkeypatch):
        _mainnet(monkeypatch, payouts_enabled=False)
        cid = await _campaign(db, "boss")
        assert _run(cid, await _login(db, "boss")).status_code == 503

    async def test_budget_cannot_exceed_the_pool(self, db, monkeypatch):
        _mainnet(monkeypatch)
        cid = await _campaign(db, "boss", pool=3.0)
        assert _run(cid, await _login(db, "boss"), budget=3.01).status_code == 400

    async def test_daily_cap_counts_what_the_agent_already_spent(self, db, monkeypatch):
        _mainnet(monkeypatch, payout_daily_budget_usdc=20.0)
        cid = await _campaign(db, "boss")
        headers = await _login(db, "boss")
        db.add(PaymentIntent(intent_id="i-1", campaign_id=cid, creator_id="@c", amount_usdc=18.0, status="submitted"))
        db.add(PaymentIntent(intent_id="i-2", campaign_id=cid, creator_id="@c", amount_usdc=99.0, status="failed"))  # não conta
        await db.commit()
        assert _run(cid, headers, budget=3.0).status_code == 400  # 18 + 3 > 20
        assert _run(cid, headers, budget=2.0).status_code == 200  # 18 + 2 == 20

    async def test_sandbox_skips_the_money_guards(self, db, monkeypatch):
        _mainnet(monkeypatch, arc_sandbox=True, payouts_enabled=False)
        cid = await _campaign(db, "boss", pool=1.0)
        assert _run(cid, await _login(db, "boss"), budget=5.0).status_code == 200


@pytest.mark.asyncio
class TestRunVisibility:
    async def test_status_and_list_are_scoped_to_the_owner(self, db):
        cid = await _campaign(db, "boss")
        boss = await _login(db, "boss")
        other = await _login(db, "other")
        run_id = _run(cid, boss).json()["agent_run_id"]

        assert client.get(f"/v1/agent/run-campaign/{run_id}/status", headers=boss).status_code == 200
        # outro usuário recebe o mesmo 404 de um run que não existe
        assert client.get(f"/v1/agent/run-campaign/{run_id}/status", headers=other).status_code == 404
        assert client.get(f"/v1/agent/run-campaign/{run_id}/status").status_code == 401

        assert [r["run_id"] for r in client.get("/v1/agent/runs", headers=boss).json()["runs"]] == [run_id]
        assert client.get("/v1/agent/runs", headers=other).json()["runs"] == []
        assert client.get("/v1/agent/runs").status_code == 401
