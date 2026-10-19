"""
test_social_x.py — conectar e postar no X (OAuth 2.0 PKCE) com a API do X simulada.

Trava: state/verifier PKCE ficam cifrados no servidor e valem uma vez; o callback exige o state certo; os tokens
ficam cifrados e nunca voltam pela API; token vencido é renovado e regravado; teto mensal de posts; o login em
andamento (`x_pending`) não aparece como conta conectada.
"""
from __future__ import annotations

import base64
import dataclasses
import hashlib
import importlib
import os
import time
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.database import get_db_session
from database.models import PostPublication, SocialAccount, WebSession

app_module = importlib.import_module("server.app")
social_routes = importlib.import_module("server.social_routes")
adapters = importlib.import_module("server.social_adapters")
client = TestClient(app_module.app)


class FakeX:
    """O que a API do X faz, em memória. `calls` guarda (método, caminho, corpo) para conferir."""

    def __init__(self):
        self.calls = []
        self.verifier_seen = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        form = parse_qs(request.content.decode()) if request.headers.get("content-type", "").startswith("application/x-www") else {}
        self.calls.append((request.method, path, form or request.content.decode()))
        if path == "/2/oauth2/token":
            if form["grant_type"] == ["authorization_code"]:
                if form["code"] != ["good-code"]:
                    return httpx.Response(400, json={"error": "invalid_request"})
                self.verifier_seen = form["code_verifier"][0]
                return httpx.Response(200, json={"access_token": "AT1", "refresh_token": "RT1", "expires_in": 7200})
            return httpx.Response(200, json={"access_token": "AT2", "refresh_token": "RT2", "expires_in": 7200})
        if path == "/2/users/me":
            return httpx.Response(200, json={"data": {"id": "42", "username": "ana"}})
        if path == "/2/tweets" and request.method == "POST":
            return httpx.Response(201, json={"data": {"id": "999", "text": "x"}})
        if path == "/2/tweets/999":
            return httpx.Response(200, json={"data": {"public_metrics": {
                "impression_count": 50, "like_count": 4, "retweet_count": 1, "reply_count": 2, "quote_count": 0}}})
        return httpx.Response(404, json={"title": "not found"})


@pytest_asyncio.fixture
async def db(db_session, monkeypatch):
    async def _override():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = _override
    fake = FakeX()
    real = httpx.AsyncClient
    monkeypatch.setattr(adapters.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(fake.handler), **kw))
    for mod in (social_routes, adapters):
        monkeypatch.setattr(mod, "settings", dataclasses.replace(
            mod.settings, social_tools_enabled=True, x_oauth_client_id="cid", social_x_max_posts_per_month=2))
    db_session.fake = fake
    yield db_session
    app_module.app.dependency_overrides.pop(get_db_session, None)


async def _login(db, name="a"):
    db.add(WebSession(session_id=f"privy_session_{name}", twitter_user_id=f"privy_{name}",
                      expires_at=datetime.utcnow() + timedelta(days=30)))
    await db.commit()
    return {"Authorization": f"Bearer privy_session_{name}"}


def _start(h):
    r = client.post("/v1/social/x/start", headers=h)
    assert r.status_code == 200, r.text
    return {k: v[0] for k, v in parse_qs(urlparse(r.json()["authorize_url"]).query).items()}


async def _connect(db, h):
    q = _start(h)
    r = client.post("/v1/social/x/callback", json={"code": "good-code", "state": q["state"]}, headers=h)
    assert r.status_code == 200, r.text
    return q, r


@pytest.mark.asyncio
async def test_start_builds_pkce_url_and_pending_is_not_an_account(db):
    h = await _login(db)
    q = _start(h)
    assert q["client_id"] == "cid" and q["redirect_uri"] == "xiaolee://social/x" and q["code_challenge_method"] == "S256"
    assert "tweet.write" in q["scope"] and "offline.access" in q["scope"]
    assert client.get("/v1/social/accounts", headers=h).json()["accounts"] == []  # login em andamento != conectada


@pytest.mark.asyncio
async def test_callback_connects_with_matching_verifier_and_encrypts_tokens(db):
    h = await _login(db)
    q, r = await _connect(db, h)
    assert r.json()["handle"] == "@ana" and "AT1" not in r.text
    # o X recebeu o verifier cujo hash é o challenge do start
    digest = base64.urlsafe_b64encode(hashlib.sha256(db.fake.verifier_seen.encode()).digest()).rstrip(b"=").decode()
    assert digest == q["code_challenge"]
    row = (await db.execute(select(SocialAccount).where(SocialAccount.platform == "x"))).scalars().one()
    assert "AT1" not in row.credentials_enc and "RT1" not in row.credentials_enc
    assert (await db.execute(select(SocialAccount).where(SocialAccount.platform == "x_pending"))).scalars().all() == []


@pytest.mark.asyncio
async def test_callback_rejects_wrong_state_and_replay(db):
    h = await _login(db)
    q = _start(h)
    assert client.post("/v1/social/x/callback", json={"code": "good-code", "state": "forged"}, headers=h).status_code == 400
    ok = client.post("/v1/social/x/callback", json={"code": "good-code", "state": q["state"]}, headers=h)
    assert ok.status_code == 200
    assert client.post("/v1/social/x/callback", json={"code": "good-code", "state": q["state"]}, headers=h).status_code == 400


@pytest.mark.asyncio
async def test_callback_with_bad_code_connects_nothing(db):
    h = await _login(db)
    q = _start(h)
    r = client.post("/v1/social/x/callback", json={"code": "bad", "state": q["state"]}, headers=h)
    assert r.status_code == 400 and "AT" not in r.text
    assert (await db.execute(select(SocialAccount).where(SocialAccount.platform == "x"))).scalars().all() == []


@pytest.mark.asyncio
async def test_publish_posts_tweet_and_refreshes_expired_token(db):
    h = await _login(db)
    await _connect(db, h)
    # vence o token guardado: o adaptador tem de renovar e regravar
    row = (await db.execute(select(SocialAccount).where(SocialAccount.platform == "x"))).scalars().one()
    creds = social_routes.json.loads(social_routes._crypto.decrypt(row.credentials_enc))
    creds["expires_at"] = int(time.time()) - 10
    row.credentials_enc = social_routes._crypto.encrypt(social_routes.json.dumps(creds))
    await db.commit()
    r = client.post("/v1/social/publish", json={"platform": "x", "text": "oi mundo"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published" and r.json()["url"] == "https://x.com/i/status/999"
    await db.refresh(row)
    assert social_routes.json.loads(social_routes._crypto.decrypt(row.credentials_enc))["access_token"] == "AT2"
    m = client.post(f"/v1/social/publications/{r.json()['id']}/metrics", headers=h)
    assert m.json()["metrics"] == {"views": 50, "likes": 4, "reposts": 1, "replies": 2, "quotes": 0}


@pytest.mark.asyncio
async def test_x_rejects_long_text_and_enforces_monthly_cap(db):
    h = await _login(db)
    await _connect(db, h)
    long = client.post("/v1/social/publish", json={"platform": "x", "text": "a" * 281}, headers=h)
    assert long.json()["status"] == "failed" and "280" in long.json()["error"]
    for _ in range(2):
        assert client.post("/v1/social/publish", json={"platform": "x", "text": "ok"}, headers=h).json()["status"] == "published"
    assert client.post("/v1/social/publish", json={"platform": "x", "text": "ok"}, headers=h).status_code == 429


@pytest.mark.asyncio
async def test_generic_connect_is_not_a_way_into_x(db):
    h = await _login(db)
    assert client.post("/v1/social/accounts/x", json={"credentials": {}}, headers=h).status_code == 400
