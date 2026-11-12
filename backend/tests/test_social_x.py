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
import json
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
        self.calls.append((request.method, path, form or request.content.decode(errors="replace")))
        if path == "/2/oauth2/token":
            if form["grant_type"] == ["authorization_code"]:
                if form["code"] != ["good-code"]:
                    return httpx.Response(400, json={"error": "invalid_request"})
                self.verifier_seen = form["code_verifier"][0]
                return httpx.Response(200, json={"access_token": "AT1", "refresh_token": "RT1", "expires_in": 7200})
            return httpx.Response(200, json={"access_token": "AT2", "refresh_token": "RT2", "expires_in": 7200})
        if path == "/2/users/me":
            return httpx.Response(200, json={"data": {"id": "42", "username": "ana", "public_metrics": {
                "followers_count": 91, "following_count": 156, "tweet_count": 169}}})
        if path == "/2/users/42/tweets":
            ts = "2026-10-15T21:10:57.000Z"
            if "entities" in str(request.url) and "organic_metrics" not in str(request.url):
                return httpx.Response(200, json={"data": [
                    {"id": "1", "entities": {"mentions": [{"username": "Carlos"}, {"username": "ana"}], "hashtags": [{"tag": "Arc"}]}},
                    {"id": "2", "entities": {"mentions": [{"username": "Carlos"}], "hashtags": []}}]})
            return httpx.Response(200, json={"data": [
                {"id": "1", "text": "a", "created_at": ts, "public_metrics": {"impression_count": 10, "like_count": 1},
                 "organic_metrics": {"like_count": 1, "reply_count": 0, "retweet_count": 0},
                 "non_public_metrics": {"impression_count": 10, "engagements": 2, "user_profile_clicks": 1, "url_link_clicks": 0}},
                {"id": "2", "text": "b", "created_at": ts, "public_metrics": {"impression_count": 40, "like_count": 3},
                 "organic_metrics": {"like_count": 3, "reply_count": 1, "retweet_count": 0},
                 "non_public_metrics": {"impression_count": 40, "engagements": 6, "user_profile_clicks": 2, "url_link_clicks": 1}}]})
        if path == "/2/media/upload":
            self.uploaded = request.content
            return httpx.Response(200, json={"data": {"id": "m77", "media_key": "3_m77"}})
        if path == "/2/users/42/mentions":
            return httpx.Response(200, json={"data": [{"id": "9", "author_id": "7"}], "includes": {"users": [
                {"id": "7", "username": "Bia", "name": "Bia Cripto"}, {"id": "42", "username": "ana", "name": "Ana"}]}})
        if path == "/2/tweets/search/recent":
            return httpx.Response(200, json={"data": [
                {"id": "5", "entities": {"hashtags": [{"tag": "Bitcoin"}, {"tag": "bitcoin"}, {"tag": "Bitcoin"}, {"tag": "Arc"}]}},
                {"id": "6", "entities": {"hashtags": [{"tag": "Arc"}, {"tag": "USDC"}]}}]})
        if path == "/2/tweets" and request.method == "POST":
            self.tweet_body = request.content.decode()
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
async def test_publish_with_image_uploads_then_attaches_media_id(db):
    stored = {"access_token": "AT", "refresh_token": "RT", "expires_at": int(time.time()) + 3600}
    pid, url = await adapters.XAdapter().publish(stored, "oi", None, images=[(b"\x89PNG-bytes", "image/png")])
    assert pid == "999" and b"PNG-bytes" in db.fake.uploaded and b"tweet_image" in db.fake.uploaded
    assert json.loads(db.fake.tweet_body)["media"] == {"media_ids": ["m77"]}
    with pytest.raises(adapters.SocialError, match="5 MB"):
        await adapters.XAdapter().publish(stored, "oi", None, images=[(b"x" * (5 * 1024 * 1024 + 1), "image/png")])


@pytest.mark.asyncio
async def test_insights_sum_profile_and_posts_and_rank_the_best(db):
    stored = {"access_token": "AT", "refresh_token": "RT", "expires_at": int(time.time()) + 3600}
    out = await adapters.XAdapter().fetch_insights(stored, "42")
    assert out["followers"] == 91 and out["posts_total"] == 169
    assert out["totals"] == {"posts": 2, "impressions": 50, "engagements": 8, "profile_clicks": 3, "link_clicks": 1}
    assert out["engagement_rate"] == 16.0
    assert [p["impressions"] for p in out["top_posts"]] == [40, 10]
    assert out["top_posts"][0]["url"] == "https://x.com/i/status/2"


@pytest.mark.asyncio
async def test_login_asks_for_the_media_write_scope(db):
    h = await _login(db)
    assert "media.write" in _start(h)["scope"]


@pytest.mark.asyncio
async def test_generic_connect_is_not_a_way_into_x(db):
    h = await _login(db)
    assert client.post("/v1/social/accounts/x", json={"credentials": {}}, headers=h).status_code == 400


@pytest.mark.asyncio
async def test_x_attaches_every_uploaded_photo(db):
    stored = {"access_token": "AT", "refresh_token": "RT", "expires_at": int(time.time()) + 3600}
    await adapters.XAdapter().publish(stored, "oi", None, images=[(b"\x89PNG-a", "image/png"), (b"\xff\xd8\xff-b", "image/jpeg")])
    uploads = [c for c in db.fake.calls if c[1] == "/2/media/upload"]
    assert len(uploads) == 2
    assert json.loads(db.fake.tweet_body)["media"] == {"media_ids": ["m77", "m77"]}


@pytest.mark.asyncio
async def test_telegram_sends_one_photo_or_an_album_and_guards_the_caption(db, monkeypatch):
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        method = request.url.path.rsplit("/", 1)[-1]
        sent.append((method, request.content))
        result = [{"message_id": 7}, {"message_id": 8}] if method == "sendMediaGroup" else {"message_id": 7}
        return httpx.Response(200, json={"ok": True, "result": result})

    real = httpx._client.AsyncClient  # o fixture `db` já trocou `httpx.AsyncClient` pelo falso do X
    monkeypatch.setattr(adapters.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(adapters, "settings", dataclasses.replace(adapters.settings, telegram_bot_token="123:tok"))
    tg, stored = adapters.TelegramAdapter(), {"chat_id": -100, "username": "ch"}

    pid, url = await tg.publish(stored, "legenda", None, images=[(b"\x89PNG-a", "image/png")])
    assert sent[-1][0] == "sendPhoto" and b"legenda" in sent[-1][1] and (pid, url) == ("7", "https://t.me/ch/7")
    pid, url = await tg.publish(stored, "legenda", None, images=[(b"\x89PNG-a", "image/png"), (b"\xff\xd8\xff-b", "image/jpeg")])
    assert sent[-1][0] == "sendMediaGroup" and b"attach://p1" in sent[-1][1] and pid == "7"
    with pytest.raises(adapters.SocialError, match="1024"):
        await tg.publish(stored, "x" * 1025, None, images=[(b"\x89PNG-a", "image/png")])


@pytest.mark.asyncio
async def test_suggestions_come_only_from_real_account_and_niche_data(db):
    stored = {"access_token": "AT", "refresh_token": "RT", "expires_at": int(time.time()) + 3600}
    out = await adapters.XAdapter().fetch_suggestions(stored, "42")
    handles = [m["handle"] for m in out["mentions"]]
    assert handles == ["Bia", "Carlos"] or handles == ["Carlos", "Bia"]  # nunca ele mesmo (ana)
    assert "ana" not in [h.lower() for h in handles]
    bia = next(m for m in out["mentions"] if m["handle"] == "Bia")
    assert bia["why"] == "replied" and bia["name"] == "Bia Cripto"
    tags = {h["tag"]: h for h in out["hashtags"]}
    assert tags["Arc"]["why"] == "you use it"  # a que ele já usa não aparece como "trend"
    assert tags["Bitcoin"]["why"] == "trending" and "USDC" in tags
    assert [t for t in tags if t.lower() == "bitcoin"] == ["Bitcoin"]  # maiúscula e minúscula viram uma só


@pytest.mark.asyncio
async def test_suggestions_route_is_scoped_cached_and_needs_a_connected_account(db):
    social_routes._suggest_cache.clear()
    h = await _login(db)
    assert client.get("/v1/social/suggestions/x", headers=h).status_code == 409  # ainda sem X conectado
    await _connect(db, h)
    first = client.get("/v1/social/suggestions/x", headers=h)
    assert first.status_code == 200 and first.json()["hashtags"]
    n = len([c for c in db.fake.calls if c[1] == "/2/tweets/search/recent"])
    client.get("/v1/social/suggestions/x", headers=h)
    assert len([c for c in db.fake.calls if c[1] == "/2/tweets/search/recent"]) == n  # segunda vem do cache
    assert client.get("/v1/social/suggestions/telegram", headers=h).status_code == 422


def test_x_error_is_plain_language():
    import httpx
    from server.social_adapters import _x_error

    def err(status, body):
        return _x_error(httpx.Response(status, json=body), body, "x")

    assert "try again later" in err(402, {"title": "CreditsDepleted"})
    assert "too many" in err(429, {})
    assert "Reconnect" in err(403, {"detail": "forbidden"})
    assert "repeated" in err(403, {"detail": "You are not allowed to create a Tweet with duplicate content."})
    assert err(400, {"detail": "bad"}) == "X: bad"
