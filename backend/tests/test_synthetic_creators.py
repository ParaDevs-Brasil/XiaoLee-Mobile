"""
test_synthetic_creators.py — personas sintéticas: preço, pagamento antes da geração, reembolso marcado.

Regras que estes testes travam:
- preço = custo x2 arredondado para cima no centavo; o roteiro é cortado no teto de palavras da duração;
- o pagamento precisa ir para CREATORS_PAY_TO com o valor exato; o mesmo nonce não paga dois vídeos;
- a cobrança só acontece depois do vídeo pronto: saldo insuficiente = 402 e nada é gerado; geração falhou = nada
  cobrado; cobrança falhou no final = vídeo não entregue.
"""
from __future__ import annotations

import dataclasses
import importlib
import os
import subprocess
from datetime import datetime, timedelta
from types import SimpleNamespace

import httpx
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
    assert sc.price_usdc("standard", 5) == 0.57 and sc.price_usdc("standard", 15) == 1.69
    assert sc.price_usdc("pro", 5) == 1.4
    assert sc.price_usdc("pro_seedance", 5) == 1.6
    assert sc.price_usdc("pro_seedance", 15) == 4.8


def test_script_is_cut_to_the_paid_duration():
    assert len(sc.clip_words("palavra " * 100, 5).split()) == sc.max_words(5) == 13


@pytest.mark.asyncio
async def test_pro_plus_audio_is_padded_to_the_paid_duration_others_are_not(tmp_path):
    short = tmp_path / "short.mp3"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=d=1", "-y", str(short)], check=True)

    def dur(b):
        f = tmp_path / "o.mp3"
        f.write_bytes(b)
        return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)],
                                    capture_output=True, text=True).stdout)

    assert sc.QUALITIES["pro_seedance"]["pad_audio"] and not sc.QUALITIES["pro"].get("pad_audio")
    assert dur(await sc._trim_audio(short.read_bytes(), 5, pad=True)) >= 4.9
    assert dur(await sc._trim_audio(short.read_bytes(), 5)) < 2


def test_pro_plus_is_h3_max_lip_sync_1080p():
    assert sc.QUALITIES["pro_seedance"]["model"] == "minimax/h3-max/lip-sync/image-to-video"
    assert sc.fal_input("pro_seedance", "img", "aud", 10) == {"image_url": "img", "audio_url": "aud", "resolution": "1080P"}
    assert sc.fal_input("standard", "img", "aud", 5) == {"image_url": "img", "audio_url": "aud"}
    assert sc.fal_input("pro", "img", "aud", 5)["resolution"] == "1080p"


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


async def _noop(*args):
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


@pytest.fixture(autouse=True)
def _wallet_balance(monkeypatch):
    """Saldo da carteira do pagador na Arc (o pedido confere antes de gerar). Cada teste pode sobrescrever."""
    async def bal(address):
        return 1000.0

    monkeypatch.setattr(arc_routes, "read_arc_usdc_balance", bal)


def _relay_ok(monkeypatch, calls):
    class Arc:
        async def relay_transfer_authorization(self, **kw):
            calls.append(kw)
            return SimpleNamespace(tx_hash="0xtx" if len(calls) == 1 else f"0xtx{len(calls)}", confirmed=True, gas_used=1)

    monkeypatch.setattr(arc_routes, "_arc_native", lambda: Arc())


@pytest.mark.asyncio
async def test_queues_the_video_without_charging_yet(db, monkeypatch):
    cid, h = await _persona(db)
    calls = []
    _relay_ok(monkeypatch, calls)
    r = client.post(f"/v1/creators/{cid}/videos", headers=h,
                    json={"quality": "standard", "duration_s": 5, "script": "oi " * 50, "payment": _payment(570_000)})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "queued" and r.json()["payment_tx"] is None
    assert len(r.json()["script"].split()) == sc.max_words(5)
    assert calls == []  # nada cobrado até o vídeo ficar pronto
    v = (await db.execute(select(CreatorVideo))).scalars().one()
    assert v.payment_value == 570_000 and v.payment_signature == "0x" + "c" * 130
    assert (await db.execute(select(ArcTransfer))).scalars().all() == []

    again = client.post(f"/v1/creators/{cid}/videos", headers=h,
                        json={"quality": "standard", "duration_s": 5, "script": "oi", "payment": _payment(570_000)})
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_dev_skip_payment_queues_without_relay_but_only_in_dev(db, monkeypatch):
    cid, h = await _persona(db)
    calls = []
    _relay_ok(monkeypatch, calls)
    body = {"quality": "standard", "duration_s": 5, "script": "oi", "payment": _payment(570_000)}

    # produção com o interruptor esquecido: ignora e guarda a autorização para cobrar no fim
    monkeypatch.setattr(routes, "settings", dataclasses.replace(routes.settings, creators_dev_skip_payment=True, environment="production"))
    r = client.post(f"/v1/creators/{cid}/videos", headers=h, json=body)
    assert r.status_code == 200 and r.json()["payment_tx"] is None
    assert (await db.execute(select(CreatorVideo))).scalars().one().payment_signature

    # dev: pula o relay, ainda confere valor e destino, e não registra repasse
    monkeypatch.setattr(routes, "settings", dataclasses.replace(routes.settings, creators_dev_skip_payment=True, environment="dev"))
    body["payment"] = _payment(570_000, nonce="0x" + "2" * 64)
    r = client.post(f"/v1/creators/{cid}/videos", headers=h, json=body)
    assert r.status_code == 200 and r.json()["status"] == "queued" and r.json()["payment_tx"].startswith("dev-skip-")
    assert calls == []
    assert (await db.execute(select(ArcTransfer))).scalars().all() == []
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
async def test_insufficient_balance_is_402_and_nothing_runs(db, monkeypatch):
    cid, h = await _persona(db)

    async def bal(address):
        return 1.0

    monkeypatch.setattr(arc_routes, "read_arc_usdc_balance", bal)
    r = client.post(f"/v1/creators/{cid}/videos", headers=h,
                    json={"quality": "pro", "duration_s": 5, "script": "oi", "payment": _payment(1_400_000)})
    assert r.status_code == 402 and "Not enough USDC" in r.text
    assert (await db.execute(select(CreatorVideo))).scalars().all() == []


@pytest.mark.asyncio
async def test_generation_failure_charges_nothing(db, monkeypatch):
    v = await _unpaid_video(db)
    calls = []
    _relay_ok(monkeypatch, calls)

    async def boom(**kw):
        raise RuntimeError("fal down")

    monkeypatch.setattr(routes.sc, "render", boom)
    monkeypatch.setattr(routes._dbmod, "SessionLocal", lambda: _Ctx(db))
    await _real_run_video(v.id)
    await db.refresh(v)
    assert v.status == "failed" and not v.refund_due and calls == []
    assert v.payment_tx is None and v.payment_signature is None and "weren't charged" in v.error


async def _unpaid_video(db, valid_before=9999999999):
    cid, _ = await _persona(db)
    v = CreatorVideo(user_id=1, creator_id=cid, quality="standard", model="m", duration_s=5, script="oi",
                     price_usdc=0.8, payment_from=PAYER, payment_nonce="0x" + "1" * 64, status="queued",
                     payment_signature="0x" + "c" * 130, payment_to=PAY_TO, payment_value=800_000,
                     payment_valid_after=0, payment_valid_before=valid_before)
    db.add(v)
    await db.commit()
    return v


async def _run_ready(db, monkeypatch, v):
    async def ok(**kw):
        return None

    monkeypatch.setattr(routes.sc, "render", ok)
    monkeypatch.setattr(routes._dbmod, "SessionLocal", lambda: _Ctx(db))
    await _real_run_video(v.id)
    await db.refresh(v)


@pytest.mark.asyncio
async def test_video_ready_is_charged_then_delivered(db, monkeypatch):
    v = await _unpaid_video(db)
    calls = []
    _relay_ok(monkeypatch, calls)
    await _run_ready(db, monkeypatch, v)
    assert v.status == "done" and v.payment_tx == "0xtx" and v.video_key and v.payment_signature is None
    assert len(calls) == 1 and calls[0]["value"] == 800_000 and calls[0]["from_address"] == PAYER
    assert float((await db.execute(select(ArcTransfer))).scalars().one().amount_usdc) == pytest.approx(0.8)


@pytest.mark.asyncio
async def test_charge_failure_withholds_the_video(db, monkeypatch):
    v = await _unpaid_video(db)

    class Arc:
        async def relay_transfer_authorization(self, **kw):
            raise RuntimeError("insufficient balance")

    monkeypatch.setattr(arc_routes, "_arc_native", lambda: Arc())
    await _run_ready(db, monkeypatch, v)
    assert v.status == "failed" and v.video_key is None and v.payment_tx is None and v.payment_signature is None
    assert "wasn't delivered" in v.error and "weren't charged" in v.error
    assert (await db.execute(select(ArcTransfer))).scalars().all() == []


@pytest.mark.asyncio
async def test_expired_approval_is_not_relayed(db, monkeypatch):
    v = await _unpaid_video(db, valid_before=1)
    calls = []
    _relay_ok(monkeypatch, calls)
    await _run_ready(db, monkeypatch, v)
    assert v.status == "failed" and calls == []


@pytest.mark.asyncio
async def test_approval_must_outlast_the_generation(db, monkeypatch):
    import time

    cid, h = await _persona(db)
    short = {**_payment(800_000), "valid_before": int(time.time()) + 60}
    r = client.post(f"/v1/creators/{cid}/videos", headers=h,
                    json={"quality": "standard", "duration_s": 5, "script": "oi", "payment": short})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_limits_unpaid_videos_in_flight_and_counts_them_against_the_balance(db, monkeypatch):
    cid, h = await _persona(db)
    body = lambda n: {"quality": "standard", "duration_s": 5, "script": "oi",
                      "payment": _payment(570_000, nonce="0x" + str(n) * 64)}
    assert client.post(f"/v1/creators/{cid}/videos", headers=h, json=body(1)).status_code == 200

    async def bal(address):
        return 1.0  # cobre um vídeo (0,57) mas não dois

    monkeypatch.setattr(arc_routes, "read_arc_usdc_balance", bal)
    assert client.post(f"/v1/creators/{cid}/videos", headers=h, json=body(2)).status_code == 402

    async def rich(address):
        return 100.0

    monkeypatch.setattr(arc_routes, "read_arc_usdc_balance", rich)
    assert client.post(f"/v1/creators/{cid}/videos", headers=h, json=body(3)).status_code == 200
    assert client.post(f"/v1/creators/{cid}/videos", headers=h, json=body(4)).status_code == 429


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


def test_failure_messages_say_nothing_was_charged():
    assert "weren't charged" in routes._failure_message("pro_seedance")
    assert "weren't charged" in routes._failure_message("standard")


# --- mimic (motion swap) -------------------------------------------------------------------------------------

MOTION = "creators/1/motion/abc123"


def _mimic_body(value=1_000_000, **over):
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
    # Wan 3.0: a fal cobra entrada + saída (US$0,05/s em 480p, 0,10/s em 720p), então 5 s = (5+5) x tarifa x2
    assert sc.price_usdc("mimic", 5) == 1.0 and sc.price_usdc("mimic", 15) == 3.0
    assert sc.price_usdc("mimic_v3", 5) == 2.0
    assert sc.price_usdc("mimic_v3_pro", 5) == 4.0 and sc.QUALITIES["mimic_v3_pro"]["extra"] == {"resolution": "1080p"}
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
    assert r.json()["status"] == "queued" and r.json()["script"] == "" and calls == []
    v = (await db.execute(select(CreatorVideo))).scalars().one()
    assert v.motion_key == MOTION and v.motion_rights_at is not None and v.model == sc.WAN_MODEL


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
                    json={"quality": "standard", "duration_s": 5, "payment": _payment(570_000)})
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


@pytest.mark.asyncio
async def test_mimic_with_more_than_one_character_keeps_the_order_and_validates_the_extras(db, monkeypatch):
    cid, h = await _persona(db)
    bob = SyntheticCreator(user_id=1, name="Bob", voice_id=sc.VOICES[0]["id"], ref_image_key="creators/1/x/bob.jpg",
                           ref_content_type="image/jpeg", status="ready", rights_confirmed_at=datetime.utcnow())
    db.add(bob)
    await db.commit()
    _relay_ok(monkeypatch, [])
    _motion_ok(monkeypatch)
    url = f"/v1/creators/{cid}/videos"
    assert client.post(url, headers=h, json=_mimic_body(extra_creator_ids=[cid])).status_code == 422      # repetido
    assert client.post(url, headers=h, json=_mimic_body(extra_creator_ids=[9999])).status_code == 404      # não é seu
    talk = {"quality": "standard", "duration_s": 5, "script": "oi", "payment": _payment(570_000), "extra_creator_ids": [bob.id]}
    assert client.post(url, headers=h, json=talk).status_code == 422                                      # Talk é 1 pessoa
    r = client.post(url, headers=h, json=_mimic_body(extra_creator_ids=[bob.id]))
    assert r.status_code == 200 and r.json()["extra_creator_ids"] == [bob.id]


def test_frame_prompt_carries_the_users_note_and_never_asks_for_photorealism():
    base = sc.frame_prompt(2)
    assert "Photorealistic" not in base and "must not appear" in base
    assert sc.frame_prompt(2, "  left man = person 1  ").endswith("Extra instructions from the user: left man = person 1")
    assert sc.frame_prompt(1) == sc.FRAME_PROMPT and "Extra instructions" not in sc.frame_prompt(1, "   ")


def test_prompts_for_several_characters_name_every_image_in_order():
    assert "Image 1 to Image 3" in sc.wan_mimic_prompt("", 3) and "Image 1 to Image 2" in sc.wan_swap_prompt("", 2)
    assert "3 reference photos" in sc.recast_prompt("", 3) and "2 characters from the following images" in sc.FRAME_PROMPT_MANY.format(n=2)
    assert sc.wan_mimic_prompt("") == sc.wan_mimic_prompt("", 1)               # um personagem: texto de sempre


def test_mimic_failure_tells_what_the_reference_needs():
    assert "full view" in routes._failure_message("mimic_v3") and "weren't charged" in routes._failure_message("mimic")


@pytest.mark.asyncio
async def test_mimic_audio_choice_is_saved_and_voice_needs_a_script(db, monkeypatch):
    cid, h = await _persona(db)
    _relay_ok(monkeypatch, [])
    _motion_ok(monkeypatch)
    r = client.post(f"/v1/creators/{cid}/videos", headers=h, json=_mimic_body(audio="original"))
    assert r.status_code == 200 and r.json()["audio"] == "original"
    no_script = client.post(f"/v1/creators/{cid}/videos", headers=h,
                            json=_mimic_body(audio="voice", payment=_payment(1_000_000, nonce="0x" + "2" * 64)))
    assert no_script.status_code == 422
    ok = client.post(f"/v1/creators/{cid}/videos", headers=h,
                     json=_mimic_body(audio="voice", script="oi " * 50, payment=_payment(1_000_000, nonce="0x" + "3" * 64)))
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


# --- swap: prévia do quadro ---------------------------------------------------------------

def _swap_env(monkeypatch):
    async def read(key):
        return b"img"

    monkeypatch.setattr(routes.sc, "read_object", read)
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
    return {"quality": "swap", "duration_s": 5, "payment": _payment(1_000_000), "motion_key": MOTION,
            "motion_rights_confirmed": True, **over}


def test_swap_prices_follow_the_wan_rates_x2():
    assert sc.price_usdc("swap", 5) == 1.0 and sc.price_usdc("swap", 15) == 3.0
    assert sc.price_usdc("swap_plus", 5) == 2.0 and sc.price_usdc("swap_plus", 15) == 6.0
    assert sc.price_usdc("swap_pro", 5) == 4.5 and sc.price_usdc("swap_pro", 15) == 13.5   # Recast 1080p: 0,45/s x2
    assert {q["quality"]: q["kind"] for q in sc.pricing()}["swap_pro"] == "swap"
    assert sc.QUALITIES["swap"]["model"] == sc.WAN_MODEL and sc.QUALITIES["swap"]["extra"] == {"resolution": "480p"}


def test_wan_input_sends_refs_silent_and_the_closest_aspect():
    body = sc.wan_input("mimic_v3", "p", ["img"], "vid", 10, sc.wan_aspect(1080, 1920))
    assert body["reference_image_urls"] == ["img"] and body["reference_video_urls"] == ["vid"]
    assert body["resolution"] == "720p" and body["aspect_ratio"] == "9:16" and body["duration"] == 10 and body["audio"] is False
    assert sc.wan_aspect(1920, 1080) == "16:9" and sc.wan_aspect(1000, 1000) == "1:1"


def test_wan_prompts_name_the_inputs_and_take_the_users_request():
    assert "Image 1" in sc.wan_mimic_prompt() and "setting shown in Image 1" in sc.wan_mimic_prompt()
    assert "Scene: a beach." in sc.wan_mimic_prompt("a beach")
    assert "Video 1" in sc.wan_swap_prompt() and sc.wan_swap_prompt("make it snow").endswith("Also: make it snow")


@pytest.mark.asyncio
async def test_render_mimic_and_swap_call_wan_with_the_character_and_a_silent_clip(monkeypatch):
    sent, uploads = [], []

    async def get(self, url, **kw):
        return httpx.Response(200, content=b"x", request=httpx.Request("GET", url))

    async def upload(http, data, mime, name):
        uploads.append(name)
        return f"https://fal/{name}"

    async def video(http, model, payload):
        sent.append((model, payload))
        return "https://fal/out.mp4"

    async def noop(*a, **k):
        return b"a"

    async def size(url):
        return 1080, 1920

    async def store(*a, **k):
        return None

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    monkeypatch.setattr(sc, "_fal_upload", upload)
    monkeypatch.setattr(sc, "_fal_video", video)
    monkeypatch.setattr(sc, "probe_size", size)
    monkeypatch.setattr(sc, "_motion_and_sound", lambda *a, **k: _async((b"cut", None)))
    monkeypatch.setattr(sc, "read_object", noop)
    monkeypatch.setattr(sc, "_trim_with_audio", noop)
    monkeypatch.setattr(sc, "_strip_audio", noop)
    monkeypatch.setattr(sc, "_has_audio", lambda v: _async(True))
    def fal_run(http, model, payload, timeout_s=0):
        sent.append((model, payload))
        return _async({"video": {"url": "https://fal/o.mp4"}})

    monkeypatch.setattr(sc, "_fal_run", fal_run)
    monkeypatch.setattr(sc.media_storage, "presign_get", lambda k: "https://r2/" + k)
    monkeypatch.setattr(sc.media_storage, "upload_file", store)

    common = dict(duration_s=5, ref_image_key="i", ref_content_type="image/png", motion_key="m", video_key="v")
    await sc.render_mimic(quality="mimic", prompt="", **common)
    model, body = sent[0]
    assert model == sc.WAN_MODEL and body["reference_image_urls"] == ["https://fal/ref.png"] and body["resolution"] == "480p"
    await sc.render_swap(quality="swap_plus", instructions="", frame_key="f", **common)
    model, body = sent[1]
    assert model == sc.WAN_MODEL and body["resolution"] == "720p" and body["reference_video_urls"] == ["https://fal/scene.mp4"]
    assert body["prompt"] == sc.wan_swap_prompt() and "frame.png" not in uploads
    await sc.render_swap(quality="swap_pro", instructions="make it snow", frame_key="f", **common)
    model, body = sent[2]
    assert model == "minimax/h3-max/recast" and body["resolution"] == "1080P" and body["enhance_realism"] is True
    assert body["reference_image_urls"] == ["https://fal/char.png"] and body["prompt"].endswith("Also: make it snow")


async def _async(value):
    return value


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
    assert v.preview_id == ready.id and v.quality == "swap" and v.model == sc.WAN_MODEL


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
