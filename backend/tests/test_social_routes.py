"""
test_social_routes.py — contas sociais e publicação (`/v1/social`).

Regras que estes testes travam:
- com SOCIAL_TOOLS_ENABLED desligado, nada responde (404): não muda o que roda hoje;
- o dono vem do Bearer; um creator não posta com a conta nem o corte de outro;
- a credencial fica cifrada no banco e nunca volta pela API;
- o post nasce `pending` e termina `published`/`failed`; falha de rede não derruba a request;
- limite diário por rede; desconectar apaga a credencial.
A rede é simulada com um adaptador falso.
"""
from __future__ import annotations

import dataclasses
import importlib
import os
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.database import get_db_session
from database.models import MediaAsset, MediaClip, PostPublication, SocialAccount, WebSession

app_module = importlib.import_module("server.app")
social_routes = importlib.import_module("server.social_routes")
adapters = importlib.import_module("server.social_adapters")
client = TestClient(app_module.app)


def _set(monkeypatch, **kw):
    monkeypatch.setattr(social_routes, "settings", dataclasses.replace(social_routes.settings, **kw))


class FakeAdapter:
    platform = "bluesky"
    fail = False
    published: list = []

    async def connect(self, inputs):
        if inputs.get("app_password") == "bad":
            raise adapters.SocialError("Bluesky rejected the handle or app password")
        return "did:plc:1", "ana.bsky.social", {"identifier": "ana", "app_password": inputs["app_password"]}

    async def publish(self, stored, text, video_url):
        if self.fail:
            raise adapters.SocialError("Bluesky refused the post")
        self.published.append((stored, text, video_url))
        return "at://did:plc:1/app.bsky.feed.post/abc", "https://bsky.app/profile/ana.bsky.social/post/abc"

    async def fetch_metrics(self, stored, post_id):
        return {"likes": 3, "reposts": 1, "replies": 0, "quotes": 0}


@pytest_asyncio.fixture
async def db(db_session, monkeypatch):
    async def _override():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = _override
    fake = FakeAdapter()
    fake.published = []
    monkeypatch.setattr(social_routes, "ADAPTERS", {"bluesky": fake})
    _set(monkeypatch, social_tools_enabled=True)
    monkeypatch.setattr(social_routes.media_storage, "presign_get", lambda key, expires=3600: "https://r2.test/get")
    db_session.fake = fake
    yield db_session
    app_module.app.dependency_overrides.pop(get_db_session, None)


async def _login(db, name):
    db.add(WebSession(session_id=f"privy_session_{name}", twitter_user_id=f"privy_{name}",
                      expires_at=datetime.utcnow() + timedelta(days=30)))
    await db.commit()
    return {"Authorization": f"Bearer privy_session_{name}"}


CRED = {"credentials": {"identifier": "ana", "app_password": "abcd-efgh"}}


async def _clip(db, user_id, status="ready"):
    a = MediaAsset(user_id=user_id, kind="video", filename="a.mp4", content_type="video/mp4", size_bytes=1, r2_key=f"k{user_id}-{status}")
    db.add(a)
    await db.flush()
    c = MediaClip(user_id=user_id, media_id=a.id, rank=1, start_s=0, end_s=5, title="t", reason="r", status=status, r2_key="clips/x.mp4")
    db.add(c)
    await db.commit()
    return c.id


@pytest.mark.asyncio
async def test_flag_off_means_404(db, monkeypatch):
    h = await _login(db, "a")
    _set(monkeypatch, social_tools_enabled=False)
    assert client.get("/v1/social/accounts", headers=h).status_code == 404
    assert client.post("/v1/social/publish", json={"platform": "bluesky", "text": "x"}, headers=h).status_code == 404


@pytest.mark.asyncio
async def test_requires_backend_issued_bearer(db):
    assert client.get("/v1/social/accounts").status_code in (401, 403)
    assert client.get("/v1/social/accounts", headers={"Authorization": "Bearer raw_id"}).status_code in (401, 403)


@pytest.mark.asyncio
async def test_connect_encrypts_and_never_returns_credentials(db):
    h = await _login(db, "a")
    r = client.post("/v1/social/accounts/bluesky", json=CRED, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["handle"] == "ana.bsky.social" and "abcd-efgh" not in r.text
    row = (await db.execute(select(SocialAccount))).scalars().one()
    assert "abcd-efgh" not in row.credentials_enc
    listing = client.get("/v1/social/accounts", headers=h)
    assert "abcd-efgh" not in listing.text
    assert listing.json()["available"] == ["bluesky"] and "telegram_bot" in listing.json()["hints"]


@pytest.mark.asyncio
async def test_bad_credentials_and_unknown_platform(db):
    h = await _login(db, "a")
    bad = {"credentials": {"identifier": "ana", "app_password": "bad"}}
    assert client.post("/v1/social/accounts/bluesky", json=bad, headers=h).status_code == 400
    assert client.post("/v1/social/accounts/myspace", json=CRED, headers=h).status_code == 422
    assert (await db.execute(select(SocialAccount))).scalars().all() == []


@pytest.mark.asyncio
async def test_publish_with_clip_records_published(db):
    h = await _login(db, "a")
    client.post("/v1/social/accounts/bluesky", json=CRED, headers=h)
    uid = (await db.execute(select(SocialAccount.user_id))).scalar()
    cid = await _clip(db, uid)
    r = client.post("/v1/social/publish", json={"platform": "bluesky", "text": "oi", "clip_id": cid}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published" and r.json()["url"].startswith("https://bsky.app/")
    assert db.fake.published[0][1:] == ("oi", "https://r2.test/get")
    m = client.post(f"/v1/social/publications/{r.json()['id']}/metrics", headers=h).json()
    assert m["metrics"]["likes"] == 3


@pytest.mark.asyncio
async def test_publish_failure_is_recorded_not_raised(db):
    h = await _login(db, "a")
    client.post("/v1/social/accounts/bluesky", json=CRED, headers=h)
    db.fake.fail = True
    r = client.post("/v1/social/publish", json={"platform": "bluesky", "text": "oi"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "failed" and "refused" in r.json()["error"]
    assert (await db.execute(select(PostPublication))).scalars().one().status == "failed"


@pytest.mark.asyncio
async def test_publish_needs_connected_account_and_own_ready_clip(db):
    a, b = await _login(db, "a"), await _login(db, "b")
    assert client.post("/v1/social/publish", json={"platform": "bluesky", "text": "x"}, headers=a).status_code == 409
    client.post("/v1/social/accounts/bluesky", json=CRED, headers=a)
    client.post("/v1/social/accounts/bluesky", json=CRED, headers=b)
    uid_a = (await db.execute(select(SocialAccount.user_id).order_by(SocialAccount.id))).scalars().first()
    cid = await _clip(db, uid_a)
    # clip do A usado pelo B: 404
    assert client.post("/v1/social/publish", json={"platform": "bluesky", "text": "x", "clip_id": cid}, headers=b).status_code == 404
    pending = await _clip(db, uid_a, status="rendering")
    assert client.post("/v1/social/publish", json={"platform": "bluesky", "text": "x", "clip_id": pending}, headers=a).status_code == 409


@pytest.mark.asyncio
async def test_daily_limit(db, monkeypatch):
    h = await _login(db, "a")
    client.post("/v1/social/accounts/bluesky", json=CRED, headers=h)
    _set(monkeypatch, social_max_posts_per_day=2)
    codes = [client.post("/v1/social/publish", json={"platform": "bluesky", "text": "x"}, headers=h).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


@pytest.mark.asyncio
async def test_disconnect_deletes_credentials(db):
    h = await _login(db, "a")
    client.post("/v1/social/accounts/bluesky", json=CRED, headers=h)
    assert client.delete("/v1/social/accounts/bluesky", headers=h).json() == {"ok": True}
    assert (await db.execute(select(SocialAccount))).scalars().all() == []


@pytest.mark.asyncio
async def test_telegram_errors_never_leak_bot_token(monkeypatch):
    monkeypatch.setattr(adapters, "settings", dataclasses.replace(adapters.settings, telegram_bot_token="123:SECRET"))

    class Boom:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def post(self, url, **kw): raise RuntimeError(f"failed {url}")

    monkeypatch.setattr(adapters.httpx, "AsyncClient", Boom)
    with pytest.raises(adapters.SocialError) as e:
        await adapters.TelegramAdapter()._call("getMe")
    assert "SECRET" not in str(e.value)


PNG = b"\x89PNG\r\n\x1a\n" + b"fake-image-bytes"


def _b64(raw: bytes) -> str:
    import base64
    return base64.b64encode(raw).decode()


@pytest.mark.asyncio
async def test_publish_with_photos_passes_decoded_bytes_to_the_network(db):
    h = await _login(db, "a")
    client.post("/v1/social/accounts/bluesky", json=CRED, headers=h)
    seen = {}

    async def publish(stored, text, video_url, images=None):
        seen["images"] = images
        return "at://did:plc:1/app.bsky.feed.post/abc", "https://bsky.app/x"

    db.fake.publish = publish
    body = {"platform": "bluesky", "text": "oi", "images": [{"mime": "image/png", "data": _b64(PNG)}]}
    r = client.post("/v1/social/publish", json=body, headers=h)
    assert r.status_code == 200, r.text
    assert seen["images"] == [(PNG, "image/png")]


@pytest.mark.asyncio
async def test_publish_rejects_fake_oversized_too_many_and_mixed_media(db):
    h = await _login(db, "a")
    client.post("/v1/social/accounts/bluesky", json=CRED, headers=h)
    uid = (await db.execute(select(SocialAccount.user_id))).scalar()
    cid = await _clip(db, uid)

    def post(**kw):
        return client.post("/v1/social/publish", json={"platform": "bluesky", "text": "oi", **kw}, headers=h)

    # diz ser PNG mas o conteúdo não é: não confiamos no mime do app
    assert post(images=[{"mime": "image/png", "data": _b64(b"MZ-not-an-image")}]).status_code == 422
    assert post(images=[{"mime": "application/pdf", "data": _b64(PNG)}]).status_code == 422
    assert post(images=[{"mime": "image/png", "data": "***not base64***"}]).status_code == 422
    assert post(images=[{"mime": "image/png", "data": _b64(PNG + b"x" * (5 * 1024 * 1024))}]).status_code in (413, 422)
    assert post(images=[{"mime": "image/png", "data": _b64(PNG)}] * 5).status_code == 422
    assert post(clip_id=cid, images=[{"mime": "image/png", "data": _b64(PNG)}]).status_code == 422
    # nada disso chegou a criar post
    assert (await db.execute(select(PostPublication))).scalars().all() == []
