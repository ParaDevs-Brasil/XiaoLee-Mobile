"""
test_campaign_money_guards.py — criar campanha mexe em dinheiro, então:

  * só vale token que o backend emitiu (o id/endereço público como token não);
  * valores e tetos são validados (env: CAMPAIGN_MAX_*);
  * o criador precisa ter o pool na carteira Arc vinculada à sessão dele;
  * o chat só libera a tool para chamador verificado — `user_id` do corpo não prova nada.
"""
from __future__ import annotations

import dataclasses
import importlib
import os
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.database import get_db_session
from database.models import Campaign, User, Wallet, WebSession
from server.caller_trust import unverified_caller

app_module = importlib.import_module("server.app")
campaigns = importlib.import_module("server.campaigns_routes")
client = TestClient(app_module.app)

WALLET = "0x" + "ab" * 20


@pytest_asyncio.fixture
async def db(db_session):
    async def _override():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = _override
    yield db_session
    app_module.app.dependency_overrides.pop(get_db_session, None)


def _body(**over) -> dict:
    body = {
        "title": "Guard test",
        "description": "d",
        "campaign_type": "social",
        "reward_token": "USDC",
        "reward_per_participant": 1.0,
        "max_participants": 5,
    }
    body.update(over)
    return body


async def _login(db, name="creator", *, wallet: bool = True) -> dict[str, str]:
    user = User(twitter_user_id=f"privy_{name}", twitter_handle=name)
    db.add(user)
    await db.flush()
    if wallet:
        db.add(Wallet(user_id=user.id, address=WALLET, private_key_encrypted="user_managed"))
    db.add(
        WebSession(
            session_id=f"privy_session_{name}",
            twitter_user_id=f"privy_{name}",
            expires_at=datetime.utcnow() + timedelta(days=30),
        )
    )
    await db.commit()
    return {"Authorization": f"Bearer privy_session_{name}"}


def _balance(monkeypatch, value=None, *, error: Exception | None = None):
    async def fake(address: str) -> float:
        assert address == WALLET  # saldo da carteira gravada no servidor
        if error:
            raise error
        return value

    monkeypatch.setattr("server.routes.arc_routes.read_arc_usdc_balance", fake)


class TestLimits:
    def _check(self, **over):
        return campaigns._validate_campaign_limits(campaigns.CreateCampaignRequest(**_body(**over)))

    def test_valid_returns_pool(self):
        assert self._check(reward_per_participant=2.5, max_participants=4) == 10.0

    @pytest.mark.parametrize(
        "over",
        [
            {"reward_per_participant": 0},
            {"reward_per_participant": -1},
            {"reward_per_participant": float("nan")},
            {"reward_per_participant": float("inf")},
            {"max_participants": 0},
            {"reward_token": "DOGE"},
            {"reward_per_participant": 100.01},  # teto por participante
            {"max_participants": 10_001},  # teto de participantes
            {"reward_per_participant": 100, "max_participants": 11},  # pool 1100 > 1000
        ],
    )
    def test_rejected(self, over):
        with pytest.raises(HTTPException) as exc:
            self._check(**over)
        assert exc.value.status_code == 400
        assert exc.value.detail  # frase legível: o chat repassa ao usuário

    def test_token_is_case_insensitive(self):
        assert self._check(reward_token=" usdc ") == 5.0


class TestHttpCreate:
    @pytest.mark.asyncio
    async def test_requires_a_token_the_backend_issued(self, db):
        # o próprio id do usuário usado como token (modo legado) não vale
        for headers in ({}, {"Authorization": "Bearer privy_creator"}, {"Authorization": "Bearer 0xdead"}):
            r = client.post("/campaigns/create", json=_body(), headers=headers)
            assert r.status_code == 401, headers
        assert (await db.execute(select(Campaign))).scalars().first() is None  # nem as campanhas padrão foram semeadas

    @pytest.mark.asyncio
    async def test_creates_when_wallet_covers_the_pool(self, db, monkeypatch):
        headers = await _login(db)
        _balance(monkeypatch, 85.1)
        r = client.post("/campaigns/create", json=_body(), headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["success"] is True
        row = (await db.execute(select(Campaign).where(Campaign.name == "Guard test"))).scalars().one()
        assert row.creator_twitter_user_id == "privy_creator"
        assert row.reward_pool == 5.0

    @pytest.mark.asyncio
    async def test_refuses_when_balance_is_below_the_pool(self, db, monkeypatch):
        headers = await _login(db)
        _balance(monkeypatch, 4.99)
        r = client.post("/campaigns/create", json=_body(), headers=headers)
        assert r.status_code == 400
        assert "Saldo insuficiente" in r.json()["detail"]
        assert (await db.execute(select(Campaign).where(Campaign.name == "Guard test"))).scalars().first() is None

    @pytest.mark.asyncio
    async def test_refuses_without_a_linked_wallet(self, db, monkeypatch):
        headers = await _login(db, wallet=False)
        _balance(monkeypatch, 1000)
        r = client.post("/campaigns/create", json=_body(), headers=headers)
        assert r.status_code == 400
        assert "carteira" in r.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_fails_closed_when_the_balance_cannot_be_read(self, db, monkeypatch):
        headers = await _login(db)
        _balance(monkeypatch, error=RuntimeError("rpc down"))
        r = client.post("/campaigns/create", json=_body(), headers=headers)
        assert r.status_code == 503
        assert (await db.execute(select(Campaign).where(Campaign.name == "Guard test"))).scalars().first() is None

    @pytest.mark.asyncio
    async def test_huge_pool_is_refused_before_any_balance_lookup(self, db, monkeypatch):
        headers = await _login(db)
        _balance(monkeypatch, error=AssertionError("não deveria consultar o saldo"))
        r = client.post(
            "/campaigns/create", json=_body(reward_per_participant=1000, max_participants=1000), headers=headers
        )
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_funds_check_can_be_switched_off_by_env(self, db, monkeypatch):
        headers = await _login(db, wallet=False)
        monkeypatch.setattr(campaigns, "settings", dataclasses.replace(campaigns.settings, campaign_require_funds=False))
        r = client.post("/campaigns/create", json=_body(), headers=headers)
        assert r.status_code == 200, r.text


class TestChatToolGate:
    """A tool de criação só roda para chamador verificado."""

    def _executor(self):
        orchestrator = app_module.orchestrator
        captured = {"actions": [], "execution": {}}
        return orchestrator._make_stellar_executor(None, captured, user_id="victim_user"), captured

    @pytest.mark.asyncio
    async def test_unverified_caller_cannot_create(self):
        executor, captured = self._executor()
        token = unverified_caller.set(True)
        try:
            out = await executor("create_campaign", _body(title="x", reward_per_participant=1, max_participants=1))
        finally:
            unverified_caller.reset(token)
        assert '"no_session"' in out
        assert captured["actions"] == []

    @pytest.mark.asyncio
    async def test_unverified_caller_is_blocked_on_every_campaign_write_tool(self):
        executor, _ = self._executor()
        token = unverified_caller.set(True)
        try:
            for tool in ("create_campaign", "join_campaign", "verify_campaign_tasks", "prepare_campaign_claim"):
                assert '"no_session"' in await executor(tool, {"campaign_id": 1}), tool
        finally:
            unverified_caller.reset(token)


class TestChatEndpointMarksCaller:
    @pytest.mark.asyncio
    async def test_open_inbound_endpoint_marks_the_caller_unverified(self, db, monkeypatch):
        seen = {}

        async def fake_process(**kwargs):
            seen["unverified"] = unverified_caller.get()
            from server.schemas import OrchestrationResponse

            return OrchestrationResponse(
                platform=kwargs["platform"], user_id=kwargs["user_id"],
                intent={"action": "help", "confidence": 1.0}, reply_text="ok", execution={},
            )

        monkeypatch.setattr(app_module, "_process_inbound", fake_process)
        r = client.post("/v1/messages/inbound", json={"platform": "telegram", "user_id": "victim", "text": "oi"})
        assert r.status_code == 200, r.text
        assert seen["unverified"] is True

    @pytest.mark.asyncio
    async def test_chat_with_a_forged_bearer_is_unverified_but_a_real_session_is_verified(self, db, monkeypatch):
        seen = []

        async def fake_process(**kwargs):
            seen.append(unverified_caller.get())
            from server.schemas import OrchestrationResponse

            return OrchestrationResponse(
                platform=kwargs["platform"], user_id=kwargs["user_id"],
                intent={"action": "help", "confidence": 1.0}, reply_text="ok", execution={},
            )

        monkeypatch.setattr(app_module, "_process_inbound", fake_process)
        real = await _login(db)
        for headers in ({}, {"Authorization": "Bearer privy_creator"}, real):
            r = client.post("/chat", json={"message": "oi", "user_id": "victim"}, headers=headers)
            assert r.status_code == 200, r.text
        assert seen == [True, True, False]


class TestCreatorAllowlist:
    @pytest.mark.asyncio
    async def test_blocks_creators_outside_the_list_on_real_money(self, db, monkeypatch):
        headers = await _login(db)
        _balance(monkeypatch, 100)
        monkeypatch.setattr(
            campaigns, "settings",
            dataclasses.replace(campaigns.settings, arc_sandbox=False, campaign_creator_allowlist="someone_else"),
        )
        r = client.post("/campaigns/create", json=_body(), headers=headers)
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_allows_listed_id_case_and_at_insensitive(self, db, monkeypatch):
        headers = await _login(db)
        _balance(monkeypatch, 100)
        monkeypatch.setattr(
            campaigns, "settings",
            dataclasses.replace(campaigns.settings, arc_sandbox=False, campaign_creator_allowlist=" @Privy_Creator "),
        )
        r = client.post("/campaigns/create", json=_body(), headers=headers)
        assert r.status_code == 200, r.text

    @pytest.mark.asyncio
    async def test_ignored_in_sandbox(self, db, monkeypatch):
        headers = await _login(db)
        _balance(monkeypatch, 100)
        monkeypatch.setattr(
            campaigns, "settings",
            dataclasses.replace(campaigns.settings, arc_sandbox=True, campaign_creator_allowlist="someone_else"),
        )
        r = client.post("/campaigns/create", json=_body(), headers=headers)
        assert r.status_code == 200, r.text


class TestStrictVerifier:
    """Dinheiro real (strict): nada é aceito de boa fé."""

    @pytest.mark.asyncio
    async def test_social_rejects_without_bearer_token(self):
        from server.integrations.campaign_verifier import verify_social

        assert (await verify_social("123", None, "t1", "", strict=True))[0] is False
        assert (await verify_social("123", None, "t1", ""))[0] is True  # sandbox mantém o legado

    @pytest.mark.asyncio
    async def test_social_rejects_non_x_account_and_follow_tasks(self):
        from server.integrations.campaign_verifier import verify_social

        assert (await verify_social("privy_x", None, None, "b", strict=True))[0] is False
        assert (await verify_social("123", "someone", None, "b", strict=True))[0] is False

    @pytest.mark.asyncio
    async def test_trading_rejects_without_helius_key(self):
        from server.integrations.campaign_verifier import verify_trading

        assert (await verify_trading("addr", "", strict=True))[0] is False
        assert (await verify_trading("addr", ""))[0] is True
