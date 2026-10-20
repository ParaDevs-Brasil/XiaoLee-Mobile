"""
test_synthetic_creators.py — personas sintéticas: preço, pagamento antes da geração, reembolso marcado.

Regras que estes testes travam:
- preço = custo x2 arredondado para cima no centavo; o roteiro é cortado no teto de palavras da duração;
- o pagamento precisa ir para CREATORS_PAY_TO com o valor exato; o mesmo nonce não paga dois vídeos;
- relay falhou = 402 e nada é gerado; geração falhou depois de pago = `refund_due`.
"""
from __future__ import annotations

import dataclasses
import importlib
import os
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.database import get_db_session
from database.models import ArcTransfer, CreatorVideo, SyntheticCreator, User, WebSession
from server import synthetic_creators as sc

app_module = importlib.import_module("server.app")
routes = importlib.import_module("server.synthetic_creator_routes")
arc_routes = importlib.import_module("server.routes.arc_routes")
client = TestClient(app_module.app)

PAY_TO = "0x" + "b" * 40
PAYER = "0x" + "a" * 40


def test_price_is_cost_x2_rounded_up_to_the_cent():
    assert sc.price_usdc("standard", 5) == 0.8
    assert sc.price_usdc("pro", 5) == 1.4
    assert sc.price_usdc("pro_seedance", 5) == 3.04
    assert sc.price_usdc("pro_seedance", 15) == 9.11


def test_script_is_cut_to_the_paid_duration():
    assert len(sc.clip_words("palavra " * 100, 5).split()) == sc.max_words(5) == 13


def test_seedance_gets_reference_lists_and_duration():
    body = sc.fal_input("pro_seedance", "img", "aud", 10)
    assert body["image_urls"] == ["img"] and body["audio_urls"] == ["aud"] and body["duration"] == "10"
    assert sc.fal_input("standard", "img", "aud", 5) == {"image_url": "img", "audio_url": "aud", "resolution": "480p"}


@pytest_asyncio.fixture
async def db(db_session, monkeypatch):
    async def _override():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = _override
    s = dataclasses.replace(routes.settings, elevenlabs_api_key="el", fal_key="fal", creators_pay_to=PAY_TO)
    monkeypatch.setattr(routes, "settings", s)
    monkeypatch.setattr(sc, "settings", s)
    monkeypatch.setattr(routes.media_storage, "presign_get", lambda key, expires=3600: f"https://r2/{key}")
    monkeypatch.setattr(routes, "run_video", _noop)
    yield db_session
    app_module.app.dependency_overrides.pop(get_db_session, None)


async def _noop(video_id):
    return None


async def _persona(db):
    user = User(twitter_user_id="privy_did:ana", twitter_handle="ana")
    db.add(user)
    await db.flush()
    db.add(WebSession(session_id="privy_session_ana", twitter_user_id="privy_did:ana",
                      expires_at=datetime.utcnow() + timedelta(days=1)))
    c = SyntheticCreator(user_id=user.id, name="Mia", voice_id=sc.VOICES[0]["id"], ref_image_key="creators/1/x/ref.jpg",
                         ref_content_type="image/jpeg", status="ready")
    db.add(c)
    await db.commit()
    return c.id, {"Authorization": "Bearer privy_session_ana"}


def _payment(value, to=PAY_TO, nonce="0x" + "1" * 64):
    return {"from_address": PAYER, "to_address": to, "value": value, "valid_after": 0,
            "valid_before": 9999999999, "nonce": nonce, "signature": "0x" + "c" * 130}


def _relay_ok(monkeypatch, calls):
    class Arc:
        async def relay_transfer_authorization(self, **kw):
            calls.append(kw)
            return SimpleNamespace(tx_hash="0xtx", confirmed=True, gas_used=1)

    monkeypatch.setattr(arc_routes, "_arc_native", lambda: Arc())


@pytest.mark.asyncio
async def test_pays_then_queues_the_video(db, monkeypatch):
    cid, h = await _persona(db)
    calls = []
    _relay_ok(monkeypatch, calls)
    r = client.post(f"/v1/creators/{cid}/videos", headers=h,
                    json={"quality": "standard", "duration_s": 5, "script": "oi " * 50, "payment": _payment(800_000)})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "queued" and r.json()["payment_tx"] == "0xtx"
    assert len(r.json()["script"].split()) == sc.max_words(5)
    assert calls[0]["value"] == 800_000
    assert float((await db.execute(select(ArcTransfer))).scalars().one().amount_usdc) == pytest.approx(0.8)

    again = client.post(f"/v1/creators/{cid}/videos", headers=h,
                        json={"quality": "standard", "duration_s": 5, "script": "oi", "payment": _payment(800_000)})
    assert again.status_code == 409


@pytest.mark.asyncio
@pytest.mark.parametrize("value,to", [(700_000, PAY_TO), (800_000, "0x" + "d" * 40)])
async def test_rejects_wrong_amount_or_destination(db, monkeypatch, value, to):
    cid, h = await _persona(db)
    calls = []
    _relay_ok(monkeypatch, calls)
    r = client.post(f"/v1/creators/{cid}/videos", headers=h,
                    json={"quality": "standard", "duration_s": 5, "script": "oi", "payment": _payment(value, to)})
    assert r.status_code == 422 and calls == []


@pytest.mark.asyncio
async def test_failed_relay_is_402_and_nothing_runs(db, monkeypatch):
    cid, h = await _persona(db)

    class Arc:
        async def relay_transfer_authorization(self, **kw):
            raise RuntimeError("insufficient balance")

    monkeypatch.setattr(arc_routes, "_arc_native", lambda: Arc())
    r = client.post(f"/v1/creators/{cid}/videos", headers=h,
                    json={"quality": "pro", "duration_s": 5, "script": "oi", "payment": _payment(1_400_000)})
    assert r.status_code == 402
    assert (await db.execute(select(CreatorVideo))).scalars().one().status == "failed"


@pytest.mark.asyncio
async def test_generation_failure_after_payment_marks_refund(db, monkeypatch):
    cid, _ = await _persona(db)
    v = CreatorVideo(user_id=1, creator_id=cid, quality="standard", model="m", duration_s=5, script="oi",
                     price_usdc=0.8, payment_from=PAYER, payment_nonce="n1", payment_tx="0xtx", status="queued")
    db.add(v)
    await db.commit()

    async def boom(**kw):
        raise RuntimeError("fal down")

    monkeypatch.setattr(routes.sc, "render", boom)
    monkeypatch.setattr(routes._dbmod, "SessionLocal", lambda: _Ctx(db))
    await _real_run_video(v.id)
    await db.refresh(v)
    assert v.status == "failed" and v.refund_due


class _Ctx:
    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        return self.db

    async def __aexit__(self, *a):
        return False


_real_run_video = routes.run_video
