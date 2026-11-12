"""
test_campaign_points.py — campanhas de PONTOS: sem dinheiro, só donos criam, pontos entram sozinhos no saldo.

  * quem cria é decidido pelo id verificado no login (CAMPAIGN_POINTS_ADMINS), nunca pela carteira gravada:
    o endereço é público e `/auth/wallet` não exige assinatura;
  * criar não pede saldo nem carteira, e não passa pelo teto de pool em USDC;
  * verificar (ou o criador aprovar) credita na hora, uma vez só, sem `paid_at` (que marca payout on-chain).
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
from database.models import Campaign, CampaignParticipant, User, Wallet, WebSession

app_module = importlib.import_module("server.app")
campaigns = importlib.import_module("server.campaigns_routes")
client = TestClient(app_module.app)

BC_WALLET = "0x26F9614BD1a1c35029Ff51De6a1D18716912F7b7"


@pytest_asyncio.fixture
async def db(db_session):
    async def _override():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = _override
    yield db_session
    app_module.app.dependency_overrides.pop(get_db_session, None)


@pytest.fixture(autouse=True)
def admins(monkeypatch):
    _settings(monkeypatch, campaign_points_admins="privy_owner", arc_sandbox=True)  # "custom" é aceito de boa fé fora de produção


def _settings(monkeypatch, **over):
    monkeypatch.setattr(campaigns, "settings", dataclasses.replace(campaigns.settings, **over))


async def _login(db, name: str, *, wallet: str | None = None) -> dict[str, str]:
    user = User(twitter_user_id=f"privy_{name}", twitter_handle=name)
    db.add(user)
    await db.flush()
    if wallet:
        db.add(Wallet(user_id=user.id, address=wallet, private_key_encrypted="user_managed"))
    db.add(
        WebSession(
            session_id=f"privy_session_{name}",
            twitter_user_id=f"privy_{name}",
            expires_at=datetime.utcnow() + timedelta(days=30),
        )
    )
    await db.commit()
    return {"Authorization": f"Bearer privy_session_{name}"}


def _body(**over) -> dict:
    body = {
        "title": "Engage and earn",
        "description": "d",
        "campaign_type": "custom",
        "reward_token": "points",
        "reward_per_participant": 100,
        "max_participants": 10_000,
    }
    body.update(over)
    return body


def _act(campaign_id: int) -> dict:
    return {"campaign_identifier": str(campaign_id)}


class TestCreate:
    @pytest.mark.asyncio
    async def test_owner_creates_without_wallet_or_funds(self, db):
        headers = await _login(db, "owner")  # sem carteira, e 1.000.000 de pontos em jogo (acima do teto de USDC)
        r = client.post("/campaigns/create", json=_body(), headers=headers)
        assert r.status_code == 200, r.text
        row = (await db.execute(select(Campaign).where(Campaign.name == "Engage and earn"))).scalars().one()
        assert row.reward_token == "POINTS"  # normalizado
        assert row.reward_pool == 1_000_000

    @pytest.mark.asyncio
    async def test_a_regular_user_cannot(self, db):
        headers = await _login(db, "someone")
        r = client.post("/campaigns/create", json=_body(), headers=headers)
        assert r.status_code == 403
        assert (await db.execute(select(Campaign).where(Campaign.name == "Engage and earn"))).scalars().first() is None

    @pytest.mark.asyncio
    async def test_linking_the_owners_wallet_does_not_make_you_an_owner(self, db, monkeypatch):
        # a carteira do dono é pública e `/auth/wallet` aceita qualquer endereço: não pode valer como credencial
        _settings(monkeypatch, campaign_points_admins=f"privy_owner,{BC_WALLET}", arc_sandbox=True)
        headers = await _login(db, "impostor", wallet=BC_WALLET)
        r = client.post("/campaigns/create", json=_body(), headers=headers)
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_requires_a_token_the_backend_issued(self, db):
        await _login(db, "owner")
        assert client.post("/campaigns/create", json=_body(), headers={"Authorization": "Bearer privy_owner"}).status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.parametrize("over", [{"reward_per_participant": 0}, {"reward_per_participant": -5},
                                      {"reward_per_participant": 1_000_001},
                                      {"max_participants": 0}, {"max_participants": 10_001}])
    async def test_rejects_silly_values(self, db, over):
        headers = await _login(db, "owner")
        r = client.post("/campaigns/create", json=_body(**over), headers=headers)
        assert r.status_code == 400 and r.json()["detail"]

    def test_non_finite_points_never_pass(self):
        for bad in (float("inf"), float("nan")):
            with pytest.raises(HTTPException):
                campaigns._validate_points_campaign(campaigns.CreateCampaignRequest(**_body(reward_per_participant=bad)))

    def test_usdc_campaigns_keep_their_own_rules(self):
        assert not campaigns._is_points("USDC") and campaigns._is_points(" Points ")


class TestEarning:
    async def _campaign(self, db) -> int:
        headers = await _login(db, "owner")
        client.post("/campaigns/create", json=_body(max_participants=10, reward_per_participant=25), headers=headers)
        return (await db.execute(select(Campaign).where(Campaign.name == "Engage and earn"))).scalars().one().id

    @pytest.mark.asyncio
    async def test_verify_credits_points_once(self, db):
        cid = await self._campaign(db)
        fan = await _login(db, "fan")
        assert client.post("/campaigns/join", json=_act(cid), headers=fan).json()["success"] is True
        r = client.post("/campaigns/verify", json=_act(cid), headers=fan).json()
        assert r["success"] is True and r["points"] == 25
        again = client.post("/campaigns/verify", json=_act(cid), headers=fan).json()
        assert "already" in again["message"] and "points" not in again

        part = (await db.execute(select(CampaignParticipant))).scalars().one()
        assert part.status == "paid" and part.paid_at is None  # `paid_at` é só payout on-chain
        assert client.get("/user/me/profile", headers=fan).json()["points"] == 25

    @pytest.mark.asyncio
    @pytest.mark.parametrize("ctype", ["airdrop", "engagement", "custom"])
    async def test_production_strict_mode_credits_participation_campaigns_without_tasks(self, db, monkeypatch, ctype):
        # `arc_sandbox=False` é produção: "tipo desconhecido" deixa de valer de boa fé
        _settings(monkeypatch, campaign_points_admins="privy_owner", arc_sandbox=False)
        owner = await _login(db, "owner")
        client.post("/campaigns/create", json=_body(campaign_type=ctype, max_participants=10, reward_per_participant=25), headers=owner)
        cid = (await db.execute(select(Campaign).where(Campaign.name == "Engage and earn"))).scalars().one().id
        fan = await _login(db, "fan")
        client.post("/campaigns/join", json=_act(cid), headers=fan)
        r = client.post("/campaigns/verify", json=_act(cid), headers=fan).json()
        assert r["success"] is True and r["points"] == 25

    @pytest.mark.asyncio
    async def test_production_still_requires_the_x_tasks_when_the_campaign_has_them(self, db, monkeypatch):
        _settings(monkeypatch, campaign_points_admins="privy_owner", arc_sandbox=False)
        owner = await _login(db, "owner")
        client.post("/campaigns/create", json=_body(campaign_type="engagement", profile_to_follow="xiaolee_official",
                                                    max_participants=10, reward_per_participant=25), headers=owner)
        cid = (await db.execute(select(Campaign).where(Campaign.name == "Engage and earn"))).scalars().one().id
        fan = await _login(db, "fan")  # sem X conectado: não dá para conferir o follow
        client.post("/campaigns/join", json=_act(cid), headers=fan)
        r = client.post("/campaigns/verify", json=_act(cid), headers=fan).json()
        assert r["success"] is False and "points" not in r
        assert client.get("/user/me/profile", headers=fan).json()["points"] == 0

    @pytest.mark.asyncio
    async def test_usdc_campaigns_are_still_not_auto_verified_in_production(self, db, monkeypatch):
        # a regra nova é só para pontos: uma campanha de USDC "engagement" continua pedindo aprovação do criador
        _settings(monkeypatch, campaign_points_admins="privy_owner", arc_sandbox=False, campaign_require_funds=False)
        owner = await _login(db, "owner")
        r = client.post("/campaigns/create", json=_body(campaign_type="engagement", reward_token="USDC",
                                                        max_participants=2, reward_per_participant=1), headers=owner)
        assert r.status_code == 200, r.text
        cid = (await db.execute(select(Campaign).where(Campaign.name == "Engage and earn"))).scalars().one().id
        fan = await _login(db, "fan")
        client.post("/campaigns/join", json=_act(cid), headers=fan)
        assert client.post("/campaigns/verify", json=_act(cid), headers=fan).json()["success"] is False

    @pytest.mark.asyncio
    async def test_creator_approval_credits_points(self, db):
        cid = await self._campaign(db)
        fan = await _login(db, "fan")
        client.post("/campaigns/join", json=_act(cid), headers=fan)
        fan_id = (await db.execute(select(User).where(User.twitter_user_id == "privy_fan"))).scalars().one().id
        owner = {"Authorization": "Bearer privy_session_owner"}
        assert client.post(f"/campaigns/{cid}/participants/{fan_id}/approve", headers=owner).json()["status"] == "paid"
        assert client.get("/user/me/profile", headers=fan).json()["points"] == 25
        # aprovar de novo não credita de novo
        client.post(f"/campaigns/{cid}/participants/{fan_id}/approve", headers=owner)
        assert client.get("/user/me/profile", headers=fan).json()["points"] == 25

    @pytest.mark.asyncio
    async def test_profile_tells_the_app_who_can_create(self, db):
        owner = await _login(db, "owner")
        fan = await _login(db, "fan")
        assert client.get("/user/me/profile", headers=owner).json()["can_create_points_campaigns"] is True
        assert client.get("/user/me/profile", headers=fan).json()["can_create_points_campaigns"] is False
