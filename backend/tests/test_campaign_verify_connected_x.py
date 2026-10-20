"""
test_campaign_verify_connected_x.py — tarefas sociais conferidas com a conta X que o participante conectou.

Regras que estes testes travam:
- quem entra por carteira/Privy (twitter_user_id não é do X) consegue verificar com o X conectado em Accounts;
- engajar = repost, quote ou reply ao post da campanha na timeline da própria pessoa; o criador pode colar o link;
- seguir = o perfil está na lista de quem a pessoa segue; token antigo sem `follows.read` pede reconectar;
- sem X conectado em mainnet a resposta manda conectar (antes era um "indisponível" sem saída);
- token renovado no meio da checagem volta cifrado para o banco.
"""
from __future__ import annotations

import dataclasses
import importlib
import json
import os
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.database import get_db_session
from database.models import Campaign, CampaignParticipant, SocialAccount, User, WebSession
from server.integrations.campaign_verifier import verify_social_with_x_account
from server.social_adapters import SocialError

app_module = importlib.import_module("server.app")
campaigns = importlib.import_module("server.campaigns_routes")
social_routes = importlib.import_module("server.social_routes")
social_adapters = importlib.import_module("server.social_adapters")
client = TestClient(app_module.app)


class FakeX:
    """Responde `/users/:id/tweets` e `/users/:id/following` como o X; renova o token se vencido."""

    def __init__(self, tweets=(), following=(), following_error=None):
        self.tweets, self.following, self.following_error = list(tweets), list(following), following_error
        self.calls: list[str] = []

    async def _fresh(self, stored):
        if stored.get("expires_at", 0) == 0:
            stored["access_token"], stored["expires_at"] = "renewed", 9e12
        return stored["access_token"]

    async def _get(self, path, token, **params):
        self.calls.append(path)
        if path.endswith("/tweets"):
            return {"data": self.tweets}
        if self.following_error:
            raise self.following_error
        return {"data": [{"username": u} for u in self.following]}


def _ref(kind, tid):
    return {"id": "1", "text": "x", "referenced_tweets": [{"type": kind, "id": tid}]}


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["retweeted", "quoted", "replied_to"])
async def test_engage_accepts_repost_quote_or_reply_and_a_pasted_link(kind):
    x = FakeX(tweets=[_ref(kind, "999")])
    ok, _ = await verify_social_with_x_account(x, {"access_token": "t", "expires_at": 9e12}, "42", None,
                                               "https://x.com/ana/status/999?s=20")
    assert ok


@pytest.mark.asyncio
async def test_engage_missing_and_follow_missing_are_refused_with_the_next_step():
    ok, why = await verify_social_with_x_account(FakeX(tweets=[_ref("retweeted", "1")]),
                                                 {"access_token": "t", "expires_at": 9e12}, "42", None, "999")
    assert not ok and "Repost" in why
    ok, why = await verify_social_with_x_account(FakeX(following=["bob"]),
                                                 {"access_token": "t", "expires_at": 9e12}, "42", "https://x.com/Ana", None)
    assert not ok and "@ana" in why


@pytest.mark.asyncio
async def test_follow_found_case_insensitive_and_old_token_asks_to_reconnect():
    stored = {"access_token": "t", "expires_at": 9e12}
    assert (await verify_social_with_x_account(FakeX(following=["Ana"]), stored, "42", "@ana", None))[0]
    old = FakeX(following_error=SocialError("X refused this. Reconnect your X account in Accounts and try again"))
    ok, why = await verify_social_with_x_account(old, stored, "42", "@ana", None)
    assert not ok and "Reconnect X" in why
    down = FakeX(following_error=SocialError("Could not reach X"))
    ok, why = await verify_social_with_x_account(down, stored, "42", "@ana", None)
    assert not ok and "Try again" in why


# ── rota /campaigns/verify ──────────────────────────────────────────────────


@pytest_asyncio.fixture
async def db(db_session, monkeypatch):
    async def _override():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = _override
    monkeypatch.setattr(campaigns, "settings", dataclasses.replace(campaigns.settings, arc_sandbox=False, x_bearer_token=""))
    yield db_session
    app_module.app.dependency_overrides.pop(get_db_session, None)


async def _participant(db, *, x_connected: bool, expires_at=9e12):
    user = User(twitter_user_id="privy_did:abc", twitter_handle="ana")
    db.add(user)
    await db.flush()
    db.add(WebSession(session_id="privy_session_ana", twitter_user_id="privy_did:abc",
                      expires_at=datetime.utcnow() + timedelta(days=1)))
    camp = Campaign(creator_twitter_user_id="privy_creator", name="Verify X", description="d", campaign_type="social",
                    reward_token="USDC", reward_per_participant=0.01, max_participants=5, reward_pool=0.05,
                    status="active", tweet_id_to_engage="https://x.com/c/status/999")
    db.add(camp)
    await db.flush()
    db.add(CampaignParticipant(campaign_id=camp.id, user_id=user.id, status="enrolled"))
    if x_connected:
        creds = social_routes._crypto.encrypt(json.dumps({"access_token": "t", "refresh_token": "r", "expires_at": expires_at}))
        db.add(SocialAccount(user_id=user.id, platform="x", external_id="42", handle="@ana", credentials_enc=creds))
    await db.commit()
    return camp.id, {"Authorization": "Bearer privy_session_ana"}


def _verify(cid, h):
    return client.post("/campaigns/verify", json={"campaign_identifier": str(cid)}, headers=h).json()


@pytest.mark.asyncio
async def test_privy_user_with_connected_x_verifies_and_renewed_token_is_saved(db, monkeypatch):
    monkeypatch.setitem(social_adapters.ADAPTERS, "x", FakeX(tweets=[_ref("retweeted", "999")]))
    cid, h = await _participant(db, x_connected=True, expires_at=0)
    r = _verify(cid, h)
    assert r["success"] and r["all_tasks_completed"], r
    part = (await db.execute(select(CampaignParticipant))).scalars().one()
    await db.refresh(part)
    assert part.status == "tasks_verified"
    acc = (await db.execute(select(SocialAccount))).scalars().one()
    await db.refresh(acc)
    assert json.loads(social_routes._crypto.decrypt(acc.credentials_enc))["access_token"] == "renewed"


@pytest.mark.asyncio
async def test_without_connected_x_mainnet_points_to_accounts(db):
    cid, h = await _participant(db, x_connected=False)
    r = _verify(cid, h)
    assert not r["success"] and "Connect your X account in Accounts" in r["message"]
