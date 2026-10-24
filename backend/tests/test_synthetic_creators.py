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
from database.models import ArcTransfer, CreatorPreview, CreatorVideo, SyntheticCreator, User, WebSession
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
    s = dataclasses.replace(routes.settings, elevenlabs_api_key="el", fal_key="fal", creators_pay_to=PAY_TO,
                            creators_dev_skip_payment=False)
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
async def test_dev_skip_payment_queues_without_relay_but_only_in_dev(db, monkeypatch):
    cid, h = await _persona(db)
    calls = []
    _relay_ok(monkeypatch, calls)
    body = {"quality": "standard", "duration_s": 5, "script": "oi", "payment": _payment(800_000)}

    # produção com o interruptor esquecido: ignora e cobra como sempre
    monkeypatch.setattr(routes, "settings", dataclasses.replace(routes.settings, creators_dev_skip_payment=True, environment="production"))
    r = client.post(f"/v1/creators/{cid}/videos", headers=h, json=body)
    assert r.status_code == 200 and r.json()["payment_tx"] == "0xtx" and len(calls) == 1

    # dev: pula o relay, ainda confere valor e destino, e não registra repasse
    monkeypatch.setattr(routes, "settings", dataclasses.replace(routes.settings, creators_dev_skip_payment=True, environment="dev"))
    body["payment"] = _payment(800_000, nonce="0x" + "2" * 64)
    r = client.post(f"/v1/creators/{cid}/videos", headers=h, json=body)
    assert r.status_code == 200 and r.json()["status"] == "queued" and r.json()["payment_tx"].startswith("dev-skip-")
    assert len(calls) == 1
    assert len((await db.execute(select(ArcTransfer))).scalars().all()) == 1
    body["payment"] = _payment(700_000, nonce="0x" + "3" * 64)
    assert client.post(f"/v1/creators/{cid}/videos", headers=h, json=body).status_code == 422


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


def test_presigned_put_does_not_sign_the_size(monkeypatch):
    """O R2 real responde 403 se o corpo tiver outro tamanho que o assinado (o seletor recomprime a imagem)."""
    seen = {}

    class FakeS3:
        def generate_presigned_url(self, op, Params, ExpiresIn):
            seen.update(Params)
            return "https://r2/put"

    monkeypatch.setattr(routes.media_storage, "_client", lambda: FakeS3())
    routes.media_storage.presign_put("creators/1/x/ref.png", "image/png", 1000)
    assert seen["ContentType"] == "image/png" and "ContentLength" not in seen


@pytest.mark.asyncio
async def test_complete_rejects_and_deletes_an_image_over_the_limit(db, monkeypatch):
    cid, h = await _persona(db)
    c = await db.get(SyntheticCreator, cid)
    c.status = "pending"
    await db.commit()
    gone = []

    async def size(key):
        return routes.MAX_IMAGE_BYTES + 1

    async def delete(key):
        gone.append(key)

    monkeypatch.setattr(routes.media_storage, "object_size", size)
    monkeypatch.setattr(routes.media_storage, "delete_object", delete)
    r = client.post(f"/v1/creators/{cid}/complete", headers=h)
    assert r.status_code == 413 and gone == [c.ref_image_key]


def test_seedance_failure_points_to_the_models_that_accept_the_image():
    assert "Standard or Pro" in routes._failure_message("pro_seedance")
    assert "refunded" in routes._failure_message("standard")


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
async def test_mimic_part_must_fit_after_its_start_and_the_start_is_kept(db, monkeypatch):
    cid, h = await _persona(db)
    calls = []
    _relay_ok(monkeypatch, calls)
    _motion_ok(monkeypatch, length=12.0)
    # 5 s a partir do segundo 10 de um vídeo de 12 s: não cabe, e nada é cobrado.
    late = client.post(f"/v1/creators/{cid}/videos", headers=h, json=_mimic_body(motion_start_s=10))
    assert late.status_code == 422 and calls == []
    ok = client.post(f"/v1/creators/{cid}/videos", headers=h, json=_mimic_body(motion_start_s=6.5))
    assert ok.status_code == 200, ok.text
    v = (await db.execute(select(CreatorVideo))).scalars().one()
    assert v.motion_start_s == 6.5


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
    assert "full view" in routes._failure_message("mimic_v3") and "refunded" in routes._failure_message("mimic")


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


# --- swap: prévia do quadro + trava de foto real ---------------------------------------------------------------

def _swap_env(monkeypatch, kind="character"):
    async def read(key):
        return b"img"

    async def image_kind(image, content_type):
        return kind

    monkeypatch.setattr(routes.sc, "read_object", read)
    monkeypatch.setattr(routes.sc, "image_kind", image_kind)
    monkeypatch.setattr(routes, "run_preview", _noop)
    _motion_ok(monkeypatch)


def _preview_body(**over):
    return {"motion_key": MOTION, "motion_rights_confirmed": True, **over}


def test_closest_aspect_matches_the_video():
    assert sc.closest_aspect(720, 1280) == "9:16"
    assert sc.closest_aspect(1920, 1080) == "16:9"
    assert sc.closest_aspect(1000, 1000) == "1:1"


@pytest.mark.asyncio
async def test_preview_is_created_for_a_character_and_needs_the_rights_term(db, monkeypatch):
    cid, h = await _persona(db)
    _swap_env(monkeypatch)
    r = client.post(f"/v1/creators/{cid}/previews", headers=h, json=_preview_body())
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "working" and r.json()["frame_url"] is None
    p = (await db.execute(select(CreatorPreview))).scalars().one()
    assert p.motion_key == MOTION and p.creator_id == cid
    no_term = client.post(f"/v1/creators/{cid}/previews", headers=h, json=_preview_body(motion_rights_confirmed=False))
    assert no_term.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,msg", [("real_person_photo", "real people"), ("unsure", "couldn't check")])
async def test_preview_gate_blocks_real_people_and_fails_closed(db, monkeypatch, kind, msg):
    cid, h = await _persona(db)
    _swap_env(monkeypatch, kind=kind)
    r = client.post(f"/v1/creators/{cid}/previews", headers=h, json=_preview_body())
    assert r.status_code == 422 and msg in r.json()["detail"]
    assert (await db.execute(select(CreatorPreview))).scalars().all() == []


@pytest.mark.asyncio
async def test_preview_has_a_daily_limit(db, monkeypatch):
    cid, h = await _persona(db)
    _swap_env(monkeypatch)
    for _ in range(routes.settings.creators_daily_previews_per_user):
        db.add(CreatorPreview(user_id=1, creator_id=cid, motion_key=MOTION, status="ready", frame_key="k"))
    await db.commit()
    r = client.post(f"/v1/creators/{cid}/previews", headers=h, json=_preview_body())
    assert r.status_code == 429


@pytest.mark.asyncio
async def test_run_preview_stores_the_frame_or_marks_failure(db, monkeypatch):
    cid, _ = await _persona(db)
    p = CreatorPreview(user_id=1, creator_id=cid, motion_key=MOTION, status="working")
    db.add(p)
    await db.commit()
    uploaded = []

    async def compose(**kw):
        return b"png"

    async def upload(path, key, content_type):
        uploaded.append((key, content_type))

    monkeypatch.setattr(routes.sc, "compose_frame", compose)
    monkeypatch.setattr(routes.media_storage, "upload_file", upload)
    monkeypatch.setattr(routes._dbmod, "SessionLocal", lambda: _Ctx(db))
    await _real_run_preview(p.id)
    await db.refresh(p)
    assert p.status == "ready" and p.frame_key.startswith("creators/1/previews/") and uploaded[0][1] == "image/png"

    async def boom(**kw):
        raise RuntimeError("fal down")

    monkeypatch.setattr(routes.sc, "compose_frame", boom)
    q = CreatorPreview(user_id=1, creator_id=cid, motion_key=MOTION, status="working")
    db.add(q)
    await db.commit()
    await _real_run_preview(q.id)
    await db.refresh(q)
    assert q.status == "failed" and "couldn't make the preview" in q.error


_real_run_preview = routes.run_preview


def _swap_video_body(**over):
    return {"quality": "swap", "duration_s": 5, "payment": _payment(1_260_000), "motion_key": MOTION,
            "motion_rights_confirmed": True, **over}


def test_swap_prices_follow_the_o3_edit_rates_x2():
    assert sc.price_usdc("swap", 5) == 1.26 and sc.price_usdc("swap", 15) == 3.78
    assert sc.price_usdc("swap_pro", 5) == 1.68 and sc.price_usdc("swap_pro", 15) == 5.04
    assert {q["quality"]: q["kind"] for q in sc.pricing()}["swap_pro"] == "swap"
    assert sc.QUALITIES["swap"]["model"].endswith("o3/standard/video-to-video/edit")


def test_swap_prompt_keeps_the_scene_and_appends_the_users_request():
    base = sc.swap_prompt()
    assert "@Video1" in base and "@Element1" in base and "exactly the same" in base
    assert sc.swap_prompt("make it snow").endswith("Also: make it snow")
    assert sc.swap_prompt("   ") == base


@pytest.mark.asyncio
async def test_swap_video_needs_a_ready_preview_of_the_same_character_and_video(db, monkeypatch):
    cid, h = await _persona(db)
    _relay_ok(monkeypatch, [])
    _motion_ok(monkeypatch)
    ready = CreatorPreview(user_id=1, creator_id=cid, motion_key=MOTION, status="ready", frame_key="creators/1/previews/1-a.png")
    working = CreatorPreview(user_id=1, creator_id=cid, motion_key=MOTION, status="working")
    other_video = CreatorPreview(user_id=1, creator_id=cid, motion_key="creators/1/motion/other", status="ready", frame_key="k")
    db.add_all([ready, working, other_video])
    await db.commit()

    assert client.post(f"/v1/creators/{cid}/videos", headers=h, json=_swap_video_body()).status_code == 422   # sem prévia
    r = client.post(f"/v1/creators/{cid}/videos", headers=h, json=_swap_video_body(preview_id=working.id))
    assert r.status_code == 409
    r = client.post(f"/v1/creators/{cid}/videos", headers=h, json=_swap_video_body(preview_id=other_video.id))
    assert r.status_code == 422
    r = client.post(f"/v1/creators/{cid}/videos", headers=h, json=_swap_video_body(preview_id=999))
    assert r.status_code == 422
    ok = client.post(f"/v1/creators/{cid}/videos", headers=h, json=_swap_video_body(preview_id=ready.id))
    assert ok.status_code == 200, ok.text
    v = (await db.execute(select(CreatorVideo))).scalars().one()
    assert v.preview_id == ready.id and v.quality == "swap" and v.model.endswith("o3/standard/video-to-video/edit")


@pytest.mark.asyncio
async def test_a_plain_mimic_does_not_take_a_preview(db, monkeypatch):
    cid, h = await _persona(db)
    _relay_ok(monkeypatch, [])
    _motion_ok(monkeypatch)
    pv = CreatorPreview(user_id=1, creator_id=cid, motion_key=MOTION, status="ready", frame_key="k")
    db.add(pv)
    await db.commit()
    r = client.post(f"/v1/creators/{cid}/videos", headers=h, json=_mimic_body(preview_id=pv.id))
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_swap_video_renders_with_the_edit_engine_and_the_approved_frame(db, monkeypatch):
    cid, _ = await _persona(db)
    pv = CreatorPreview(user_id=1, creator_id=cid, motion_key=MOTION, status="ready", frame_key="creators/1/previews/1-a.png")
    db.add(pv)
    await db.flush()
    v = CreatorVideo(user_id=1, creator_id=cid, quality="swap_pro", model="m", duration_s=5, script="make it snow",
                     price_usdc=1.68, payment_from=PAYER, payment_nonce="n9", payment_tx="0xtx", status="queued",
                     motion_key=MOTION, preview_id=pv.id, audio="original")
    db.add(v)
    await db.commit()
    seen = {}

    async def render_swap(**kw):
        seen.update(kw)

    monkeypatch.setattr(routes.sc, "render_swap", render_swap)
    monkeypatch.setattr(routes._dbmod, "SessionLocal", lambda: _Ctx(db))
    await _real_run_video(v.id)
    assert seen["frame_key"] == "creators/1/previews/1-a.png" and seen["quality"] == "swap_pro"
    assert seen["ref_image_key"] == "creators/1/x/ref.jpg" and seen["instructions"] == "make it snow"


def test_catalog_voices_have_a_description_and_a_sample_path():
    voices = client.get("/v1/creators/catalog").json()["voices"]
    assert len(voices) == len(sc.VOICES) and all(v["description"] for v in voices)
    assert voices[0]["sample_path"] == f"/v1/creators/voices/{sc.VOICES[0]['id']}/sample"


def test_voice_sample_is_generated_once_per_voice_and_served_as_audio(monkeypatch):
    sc._SAMPLE_CACHE.clear()
    calls = []

    async def tts(http, voice_id, text):
        calls.append((voice_id, text))
        return b"mp3-bytes"

    monkeypatch.setattr(sc, "_tts", tts)
    vid = sc.VOICES[4]["id"]
    for _ in range(2):
        r = client.get(f"/v1/creators/voices/{vid}/sample")
        assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"mp3-bytes"
    assert len(calls) == 1 and sc.VOICES[4]["name"] in calls[0][1]
    assert client.get("/v1/creators/voices/not-a-voice/sample").status_code == 404
    sc._SAMPLE_CACHE.clear()


def test_voice_sample_fails_politely_when_the_provider_is_down(monkeypatch):
    sc._SAMPLE_CACHE.clear()

    async def tts(http, voice_id, text):
        raise RuntimeError("elevenlabs down")

    monkeypatch.setattr(sc, "_tts", tts)
    r = client.get(f"/v1/creators/voices/{sc.VOICES[0]['id']}/sample")
    assert r.status_code == 503 and "isn't available" in r.json()["detail"]
    sc._SAMPLE_CACHE.clear()


def test_curated_voices_are_valid_unique_and_grouped():
    ids = [v["id"] for v in sc.VOICES]
    assert len(ids) == len(set(ids)) and set(ids) == sc.VOICE_IDS
    assert len(sc.VOICES) >= 30                                            # 8 clássicas + a lista curada
    assert all(v["category"] and v["name"] and v["description"] and v["gender"] in ("male", "female") for v in sc.VOICES)
    cats = [v["category"] for v in sc.VOICES]
    assert cats == sorted(cats, key=lambda c: sc.CATEGORY_ORDER.index(c))   # agrupadas na ordem do app
    assert {v["id"] for v in sc.PREMADE_VOICES} <= sc.VOICE_IDS             # personagens antigos continuam válidos


def test_brazilian_voices_get_a_portuguese_sample_phrase(monkeypatch):
    sc._SAMPLE_CACHE.clear()
    said = {}

    async def tts(http, voice_id, text):
        said[voice_id] = text
        return b"mp3"

    monkeypatch.setattr(sc, "_tts", tts)
    pt = next(v for v in sc.VOICES if str(v.get("language") or "").startswith("pt"))
    en = next(v for v in sc.VOICES if v["category"] == "Classic")
    for v in (pt, en):
        assert client.get(f"/v1/creators/voices/{v['id']}/sample").status_code == 200
    assert said[pt["id"]].startswith("Olá, eu sou") and said[en["id"]].startswith("Hi, I'm")
    sc._SAMPLE_CACHE.clear()


@pytest.mark.asyncio
async def test_preview_start_must_fall_inside_the_reference_video(db, monkeypatch):
    cid, h = await _persona(db)
    _swap_env(monkeypatch)
    _motion_ok(monkeypatch, length=12.0)
    late = client.post(f"/v1/creators/{cid}/previews", headers=h, json=_preview_body(motion_start_s=30))
    assert late.status_code == 422 and (await db.execute(select(CreatorPreview))).scalars().all() == []
    ok = client.post(f"/v1/creators/{cid}/previews", headers=h, json=_preview_body(motion_start_s=4))
    assert ok.status_code == 200, ok.text
    assert (await db.execute(select(CreatorPreview))).scalars().one().motion_start_s == 4


@pytest.mark.asyncio
async def test_character_can_be_renamed_and_change_voice(db):
    cid, h = await _persona(db)
    voice = sc.VOICES[1]["id"]
    r = client.patch(f"/v1/creators/{cid}", headers=h, json={"name": "  Luna ", "voice_id": voice})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Luna" and r.json()["voice_id"] == voice
    only_name = client.patch(f"/v1/creators/{cid}", headers=h, json={"name": "Nova"})
    assert only_name.json()["name"] == "Nova" and only_name.json()["voice_id"] == voice
    assert client.patch(f"/v1/creators/{cid}", headers=h, json={"name": "   "}).status_code == 422
    assert client.patch(f"/v1/creators/{cid}", headers=h, json={"voice_id": "nope"}).status_code == 422
    assert client.patch(f"/v1/creators/{cid + 99}", headers=h, json={"name": "x"}).status_code == 404
    assert client.patch(f"/v1/creators/{cid}", json={"name": "x"}).status_code in (401, 403)
