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
                         ref_content_type="image/jpeg", status="ready", rights_confirmed_at=datetime.utcnow())
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
            return SimpleNamespace(tx_hash="0xtx" if len(calls) == 1 else f"0xtx{len(calls)}", confirmed=True, gas_used=1)

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


@pytest.mark.asyncio
async def test_persona_needs_the_image_rights_term(db, monkeypatch):
    _, h = await _persona(db)
    monkeypatch.setattr(routes.media_storage, "presign_put", lambda key, ct, size, expires=3600: "https://r2/put")
    body = {"name": "Meme", "voice_id": sc.VOICES[0]["id"], "content_type": "image/png", "size_bytes": 1000}
    assert client.post("/v1/creators", headers=h, json=body).status_code == 422
    r = client.post("/v1/creators", headers=h, json={**body, "rights_confirmed": True})
    assert r.status_code == 200, r.text
    c = (await db.execute(select(SyntheticCreator).where(SyntheticCreator.name == "Meme"))).scalars().one()
    assert c.rights_confirmed_at is not None


def test_seedance_failure_points_to_the_models_that_accept_the_image():
    assert "OmniHuman" in routes._failure_message("pro_seedance")
    assert "Refund pending" in routes._failure_message("standard")


# --- mimic (motion swap) -------------------------------------------------------------------------------------

MOTION = "creators/1/motion/abc123"


def _mimic_body(value=700_000, **over):
    return {"quality": "mimic", "duration_s": 5, "payment": _payment(value), "motion_key": MOTION,
            "motion_rights_confirmed": True, **over}


def _motion_ok(monkeypatch, length=12.0):
    async def size(key):
        return 1000

    async def probe(url):
        return length

    monkeypatch.setattr(routes.media_storage, "object_size", size)
    monkeypatch.setattr(routes.sc, "probe_duration", probe)


def test_mimic_prices_follow_the_fal_page_x2():
    assert sc.price_usdc("mimic", 5) == 0.7 and sc.price_usdc("mimic", 15) == 2.1
    assert sc.price_usdc("mimic_v3", 5) == 1.26
    assert sc.price_usdc("mimic_v3_pro", 5) == 1.68
    assert {q["quality"]: q["kind"] for q in sc.pricing()}["mimic_v3"] == "mimic"
    assert sc.kind("standard") == "speech"


def test_mimic_input_follows_the_video_orientation():
    body = sc.mimic_input("img", "vid", "")
    assert body["image_url"] == "img" and body["video_url"] == "vid" and body["character_orientation"] == "video"
    assert body["prompt"] == sc.MIMIC_DEFAULT_PROMPT


@pytest.mark.asyncio
async def test_mimic_pays_and_keeps_the_motion_and_the_rights_timestamp(db, monkeypatch):
    cid, h = await _persona(db)
    calls = []
    _relay_ok(monkeypatch, calls)
    _motion_ok(monkeypatch)
    r = client.post(f"/v1/creators/{cid}/videos", headers=h, json=_mimic_body())
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "queued" and r.json()["script"] == "" and calls[0]["value"] == 700_000
    v = (await db.execute(select(CreatorVideo))).scalars().one()
    assert v.motion_key == MOTION and v.motion_rights_at is not None and v.model.endswith("v2.6/standard/motion-control")


@pytest.mark.asyncio
@pytest.mark.parametrize("over,code", [
    ({"motion_rights_confirmed": False}, 422),
    ({"motion_key": "creators/2/motion/abc"}, 422),          # vídeo de outro usuário
    ({"motion_key": "creators/1/motion/../../2/x"}, 422),
    ({"motion_key": None}, 422),
])
async def test_mimic_rejects_before_charging(db, monkeypatch, over, code):
    cid, h = await _persona(db)
    calls = []
    _relay_ok(monkeypatch, calls)
    _motion_ok(monkeypatch)
    r = client.post(f"/v1/creators/{cid}/videos", headers=h, json=_mimic_body(**over))
    assert r.status_code == code and calls == []
    assert (await db.execute(select(CreatorVideo))).scalars().all() == []


@pytest.mark.asyncio
async def test_mimic_needs_an_uploaded_video_at_least_as_long_as_the_paid_duration(db, monkeypatch):
    cid, h = await _persona(db)
    calls = []
    _relay_ok(monkeypatch, calls)

    async def missing(key):
        return None

    monkeypatch.setattr(routes.media_storage, "object_size", missing)
    assert client.post(f"/v1/creators/{cid}/videos", headers=h, json=_mimic_body()).status_code == 409

    _motion_ok(monkeypatch, length=3.0)
    short = client.post(f"/v1/creators/{cid}/videos", headers=h, json=_mimic_body())
    assert short.status_code == 422 and "shorter" in short.json()["detail"] and calls == []


@pytest.mark.asyncio
async def test_speech_still_needs_a_script(db, monkeypatch):
    cid, h = await _persona(db)
    r = client.post(f"/v1/creators/{cid}/videos", headers=h,
                    json={"quality": "standard", "duration_s": 5, "payment": _payment(800_000)})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_motion_upload_takes_only_videos_under_the_cap(db, monkeypatch):
    _, h = await _persona(db)
    monkeypatch.setattr(routes.media_storage, "presign_put", lambda key, ct, size, expires=3600: "https://r2/put")
    ok = client.post("/v1/creators/motion", headers=h, json={"content_type": "video/mp4", "size_bytes": 5000})
    assert ok.status_code == 200 and ok.json()["motion_key"].startswith("creators/1/motion/")
    assert client.post("/v1/creators/motion", headers=h, json={"content_type": "image/png", "size_bytes": 5}).status_code == 422
    assert client.post("/v1/creators/motion", headers=h,
                       json={"content_type": "video/mp4", "size_bytes": sc.MAX_MOTION_BYTES + 1}).status_code == 413


def test_mimic_failure_tells_what_the_reference_needs():
    assert "head and body" in routes._failure_message("mimic_v3") and "Refund pending" in routes._failure_message("mimic")


@pytest.mark.asyncio
async def test_mimic_audio_choice_is_saved_and_voice_needs_a_script(db, monkeypatch):
    cid, h = await _persona(db)
    _relay_ok(monkeypatch, [])
    _motion_ok(monkeypatch)
    r = client.post(f"/v1/creators/{cid}/videos", headers=h, json=_mimic_body(audio="original"))
    assert r.status_code == 200 and r.json()["audio"] == "original"
    no_script = client.post(f"/v1/creators/{cid}/videos", headers=h,
                            json=_mimic_body(audio="voice", payment=_payment(700_000, nonce="0x" + "2" * 64)))
    assert no_script.status_code == 422
    ok = client.post(f"/v1/creators/{cid}/videos", headers=h,
                     json=_mimic_body(audio="voice", script="oi " * 50, payment=_payment(700_000, nonce="0x" + "3" * 64)))
    assert ok.status_code == 200 and ok.json()["audio"] == "voice"
    assert len(ok.json()["script"].split()) == sc.max_words(5)        # a narração cabe na duração paga
    bad = client.post(f"/v1/creators/{cid}/videos", headers=h, json=_mimic_body(audio="loud"))
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_mux_puts_the_audio_track_on_a_silent_video(tmp_path):
    import shutil
    import subprocess

    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")
    v, a = tmp_path / "v.mp4", tmp_path / "a.m4a"
    for args in (["-f", "lavfi", "-i", "color=c=gray:s=64x64:d=1", "-pix_fmt", "yuv420p", str(v)],
                 ["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", str(a)]):
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", *args, "-y"], check=True)
    out = await sc.mux_audio(v.read_bytes(), a.read_bytes())
    res = tmp_path / "out.mp4"
    res.write_bytes(out)
    kinds = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(res)],
                           capture_output=True, text=True).stdout.split()
    assert sorted(kinds) == ["audio", "video"]
