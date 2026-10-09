"""
test_media_routes.py — Media Repository + transcrição do Clipper (`/v1/media`).

Regras que estes testes travam:
- só o dono (Bearer emitido pelo backend) vê/dispara a própria mídia;
- entrada ruim (tipo, tamanho) é recusada sem gravar nada;
- /complete só avança se o objeto existe no bucket com o tamanho declarado;
- a transcrição grava segmentos e marca `transcribed`; falha vira `failed` com erro, sem vazar a URL;
- o ffmpeg real extrai áudio de um arquivo de mídia.
R2 e Whisper são simulados; o ffmpeg não.
"""
from __future__ import annotations

import contextlib
import importlib
import json
import os
import shutil
import subprocess
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.database import get_db_session
from database.models import MediaAsset, MediaClip, MediaTranscript, WebSession

app_module = importlib.import_module("server.app")
media_routes = importlib.import_module("server.media_routes")
client = TestClient(app_module.app)

BODY = {"filename": "podcast ep1.mp4", "content_type": "video/mp4", "size_bytes": 1000}
FAKE_RESULT = {"language": "portuguese", "duration": 2.0, "segments": [{"start": 0.0, "end": 2.0, "text": "ola mundo"}]}


@pytest_asyncio.fixture
async def db(db_session, monkeypatch):
    async def _override():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = _override

    @contextlib.asynccontextmanager
    async def _same_session():
        yield db_session

    monkeypatch.setattr(media_routes, "_session", _same_session)
    monkeypatch.setattr(media_routes.media_storage, "presign_put", lambda *a, **k: "https://r2.test/put?sig=1")
    monkeypatch.setattr(media_routes.media_storage, "presign_get", lambda key: "/nonexistent/source.mp4")
    yield db_session
    app_module.app.dependency_overrides.pop(get_db_session, None)


async def _login(db, name: str) -> dict[str, str]:
    now = datetime.utcnow()
    db.add(WebSession(session_id=f"privy_session_{name}", twitter_user_id=f"privy_{name}", expires_at=now + timedelta(days=30)))
    await db.commit()
    return {"Authorization": f"Bearer privy_session_{name}"}


def _object_exists(monkeypatch, size):
    async def _size(key):
        return size

    monkeypatch.setattr(media_routes.media_storage, "object_size", _size)


def _fake_extract(monkeypatch, audio_bytes=b"x" * 10):
    async def _extract(source, dest):
        open(dest, "wb").write(audio_bytes)

    monkeypatch.setattr(media_routes, "_extract_audio", _extract)


def test_requires_backend_issued_bearer():
    assert client.post("/v1/media", json=BODY).status_code in (401, 403)
    assert client.get("/v1/media").status_code in (401, 403)
    assert client.get("/v1/media", headers={"Authorization": "Bearer raw_twitter_id"}).status_code in (401, 403)


@pytest.mark.asyncio
async def test_create_returns_presigned_url_and_safe_key(db):
    h = await _login(db, "a")
    r = client.post("/v1/media", json=BODY, headers=h)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["upload_url"].startswith("https://r2.test/")
    assert out["upload_headers"] == {"Content-Type": "video/mp4"}
    assert out["asset"]["status"] == "pending"
    assert out["asset"]["filename"] == "podcast_ep1.mp4"
    row = (await db.execute(select(MediaAsset))).scalars().one()
    assert row.r2_key.startswith(f"media/{row.user_id}/") and row.r2_key.endswith("/podcast_ep1.mp4")


@pytest.mark.asyncio
async def test_path_traversal_filename_is_neutralised(db):
    h = await _login(db, "a")
    r = client.post("/v1/media", json={**BODY, "filename": "../../etc/passwd"}, headers=h)
    assert r.json()["asset"]["filename"] == "passwd"


@pytest.mark.asyncio
@pytest.mark.parametrize("patch", [
    {"content_type": "application/pdf"},
    {"size_bytes": 0},
    {"size_bytes": 10**13},
    {"filename": ""},
])
async def test_bad_input_is_refused_and_not_stored(db, patch):
    h = await _login(db, "a")
    assert client.post("/v1/media", json={**BODY, **patch}, headers=h).status_code in (413, 422)
    assert (await db.execute(select(MediaAsset))).scalars().all() == []


@pytest.mark.asyncio
async def test_storage_not_configured_is_503_without_orphan_row(db, monkeypatch):
    def _boom(*a, **k):
        raise media_routes.media_storage.StorageNotConfigured("R2 not configured")

    monkeypatch.setattr(media_routes.media_storage, "presign_put", _boom)
    h = await _login(db, "a")
    assert client.post("/v1/media", json=BODY, headers=h).status_code == 503
    assert (await db.execute(select(MediaAsset))).scalars().all() == []


@pytest.mark.asyncio
async def test_complete_refuses_missing_or_mismatched_object(db, monkeypatch):
    h = await _login(db, "a")
    aid = client.post("/v1/media", json=BODY, headers=h).json()["asset"]["id"]

    _object_exists(monkeypatch, None)
    assert client.post(f"/v1/media/{aid}/complete", headers=h).status_code == 409
    _object_exists(monkeypatch, 999)
    assert client.post(f"/v1/media/{aid}/complete", headers=h).status_code == 409
    assert client.get(f"/v1/media/{aid}", headers=h).json()["status"] == "pending"


@pytest.mark.asyncio
async def test_full_flow_transcribes(db, monkeypatch):
    h = await _login(db, "a")
    aid = client.post("/v1/media", json=BODY, headers=h).json()["asset"]["id"]
    _object_exists(monkeypatch, 1000)
    _fake_extract(monkeypatch)

    async def _tr(path, glossary=None):
        return FAKE_RESULT

    monkeypatch.setattr(media_routes, "_transcribe", _tr)
    assert client.post(f"/v1/media/{aid}/complete", headers=h).status_code == 200  # background roda ao fim da request
    d = client.get(f"/v1/media/{aid}", headers=h).json()
    assert d["status"] == "transcribed" and d["duration_s"] == 2.0
    assert d["transcript"]["segments"][0]["text"] == "ola mundo"
    assert d["transcript"]["text"] == "ola mundo" and d["transcript"]["language"] == "portuguese"
    assert d["transcript"]["model"] == media_routes.settings.transcription_model
    assert [m["id"] for m in client.get("/v1/media", headers=h).json()] == [aid]


@pytest.mark.asyncio
async def test_failure_marks_failed_and_can_retry(db, monkeypatch):
    h = await _login(db, "a")
    aid = client.post("/v1/media", json=BODY, headers=h).json()["asset"]["id"]
    _object_exists(monkeypatch, 1000)
    _fake_extract(monkeypatch)

    async def _boom(path, glossary=None):
        raise RuntimeError("whisper down")

    monkeypatch.setattr(media_routes, "_transcribe", _boom)
    client.post(f"/v1/media/{aid}/complete", headers=h)
    d = client.get(f"/v1/media/{aid}", headers=h).json()
    assert d["status"] == "failed" and "whisper down" in d["error"]

    async def _ok(path, glossary=None):
        return FAKE_RESULT

    monkeypatch.setattr(media_routes, "_transcribe", _ok)
    client.post(f"/v1/media/{aid}/complete", headers=h)  # failed → pode refazer
    assert client.get(f"/v1/media/{aid}", headers=h).json()["status"] == "transcribed"
    assert client.post(f"/v1/media/{aid}/complete", headers=h).status_code == 409  # transcribed é final
    assert len((await db.execute(select(MediaTranscript))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_retranscribe_replaces_the_single_transcript(db, monkeypatch):
    h = await _login(db, "a")
    aid = client.post("/v1/media", json=BODY, headers=h).json()["asset"]["id"]
    _object_exists(monkeypatch, 1000)
    _fake_extract(monkeypatch)
    for text in ("primeira", "segunda"):
        async def _tr(path, glossary=None, text=text):
            return {**FAKE_RESULT, "segments": [{"start": 0.0, "end": 1.0, "text": text}]}

        monkeypatch.setattr(media_routes, "_transcribe", _tr)
        asset = await db.get(MediaAsset, aid)
        asset.status = "uploaded"  # simula reenvio do /complete após falha/restart
        await db.commit()
        client.post(f"/v1/media/{aid}/complete", headers=h)
    rows = (await db.execute(select(MediaTranscript))).scalars().all()
    assert len(rows) == 1 and "segunda" in rows[0].segments_json


@pytest.mark.asyncio
async def test_kind_and_sha256(db):
    h = await _login(db, "a")
    ok = client.post("/v1/media", json={**BODY, "sha256": "a" * 64}, headers=h).json()["asset"]
    assert ok["kind"] == "video" and ok["sha256"] == "a" * 64
    audio = client.post("/v1/media", json={**BODY, "content_type": "audio/mpeg"}, headers=h).json()["asset"]
    assert audio["kind"] == "audio" and audio["sha256"] is None
    assert client.post("/v1/media", json={**BODY, "sha256": "xyz"}, headers=h).status_code == 422


@pytest.mark.asyncio
async def test_media_over_duration_cap_fails_clearly(db, monkeypatch):
    h = await _login(db, "a")
    aid = client.post("/v1/media", json=BODY, headers=h).json()["asset"]["id"]
    _object_exists(monkeypatch, 1000)
    _fake_extract(monkeypatch, b"x" * 100)

    async def _plan(path):
        return [(0.0, media_routes.MAX_AUDIO_S + 60)]

    monkeypatch.setattr(media_routes, "_plan_chunks", _plan)
    monkeypatch.setattr(media_routes, "settings", __import__("dataclasses").replace(media_routes.settings, transcription_api_key="k"))
    client.post(f"/v1/media/{aid}/complete", headers=h)
    d = client.get(f"/v1/media/{aid}", headers=h).json()
    assert d["status"] == "failed" and "too long" in d["error"]


@pytest.mark.asyncio
async def test_other_user_cannot_see_or_trigger(db, monkeypatch):
    a, b = await _login(db, "a"), await _login(db, "b")
    aid = client.post("/v1/media", json=BODY, headers=a).json()["asset"]["id"]
    assert client.get(f"/v1/media/{aid}", headers=b).status_code == 404
    assert client.post(f"/v1/media/{aid}/complete", headers=b).status_code == 404
    assert client.get("/v1/media", headers=b).json() == []


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg ausente")
@pytest.mark.asyncio
async def test_real_ffmpeg_extracts_audio(tmp_path):
    src, dest = tmp_path / "in.mp4", tmp_path / "out.mp3"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
         "-f", "lavfi", "-i", "color=c=black:s=64x64:d=2", "-shortest", "-y", str(src)],
        check=True,
    )
    await media_routes._extract_audio(str(src), str(dest))
    assert dest.stat().st_size > 1000


@pytest.mark.asyncio
async def test_real_ffmpeg_error_does_not_leak_source(tmp_path):
    with pytest.raises(RuntimeError) as e:
        await media_routes._extract_audio("https://x.test/secret-signature-abc/v.mp4", str(tmp_path / "o.mp3"))
    assert "secret-signature-abc" not in str(e.value)


def test_transcription_config_precedence():
    from server.settings import GROQ_BASE_URL, _transcription_config as cfg

    assert cfg({}) == ("", "", "whisper-1")
    assert cfg({"OPENAI_API_KEY": "o"}) == ("o", "", "whisper-1")
    # só GROQ_API_KEY: liga o Groq inteiro
    assert cfg({"GROQ_API_KEY": "g"}) == ("g", GROQ_BASE_URL, "whisper-large-v3-turbo")
    # GROQ vence OPENAI quando ambas existem
    assert cfg({"GROQ_API_KEY": "g", "OPENAI_API_KEY": "o"})[0] == "g"
    # TRANSCRIPTION_* explícito manda e NÃO herda a URL do Groq
    assert cfg({"TRANSCRIPTION_API_KEY": "t", "GROQ_API_KEY": "g"}) == ("t", "", "whisper-1")
    # overrides individuais valem
    assert cfg({"GROQ_API_KEY": "g", "TRANSCRIPTION_MODEL": "m"}) == ("g", GROQ_BASE_URL, "m")


# ── Clipper (#29): /v1/media/{id}/clips ──────────────────────────────────────

clipper = importlib.import_module("server.clipper")
LONG_SEGS = [{"start": i * 10.0, "end": i * 10.0 + 10.0, "text": f"frase numero {i} com varias palavras"} for i in range(12)]


def _pick(*windows):
    async def _p(segments):
        return [clipper.Highlight(a, b, f"Clip {i}", "porque sim") for i, (a, b) in enumerate(windows, 1)]

    return _p


@pytest_asyncio.fixture
async def clips_env(db, monkeypatch, tmp_path):
    """Mídia de vídeo já transcrita + armazenamento simulado (upload/delete gravados) + vídeo real p/ o ffmpeg."""
    src = tmp_path / "src.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=120",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=120", "-shortest", "-pix_fmt", "yuv420p", "-y", str(src)],
        check=True,
    )
    uploaded, deleted = {}, []

    async def _upload(path, key, content_type):
        uploaded[key] = os.path.getsize(path)

    async def _delete(key):
        deleted.append(key)

    monkeypatch.setattr(media_routes.media_storage, "presign_get", lambda key, expires=3600: str(src) if key.startswith("media/") else f"https://r2.test/get/{key}")
    monkeypatch.setattr(media_routes.media_storage, "upload_file", _upload)
    monkeypatch.setattr(media_routes.media_storage, "delete_object", _delete)
    monkeypatch.setattr(clipper, "pick_highlights", _pick((0, 30), (40, 70), (80, 110)))

    h = await _login(db, "a")
    aid = client.post("/v1/media", json=BODY, headers=h).json()["asset"]["id"]
    asset = await db.get(MediaAsset, aid)
    asset.status = "transcribed"
    db.add(MediaTranscript(media_id=aid, segments_json=json.dumps(LONG_SEGS), language="pt", model="m"))
    await db.commit()
    return SimpleNamespace(h=h, aid=aid, uploaded=uploaded, deleted=deleted, db=db)


def test_clips_require_bearer():
    assert client.post("/v1/media/1/clips").status_code in (401, 403)
    assert client.get("/v1/media/1/clips").status_code in (401, 403)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg ausente")
@pytest.mark.asyncio
async def test_clips_end_to_end_renders_three_real_vertical_clips(clips_env):
    e = clips_env
    r = client.post(f"/v1/media/{e.aid}/clips", headers=e.h)
    assert r.status_code == 200, r.text
    first = r.json()
    assert [c["rank"] for c in first] == [1, 2, 3] and first[0]["title"] == "Clip 1"
    assert all(c["download_url"] is None for c in first)  # ainda não renderizado na resposta

    clips = client.get(f"/v1/media/{e.aid}/clips", headers=e.h).json()  # background já rodou
    assert [c["status"] for c in clips] == ["ready"] * 3, clips
    assert all(c["download_url"].startswith("https://r2.test/get/clips/") and c["size_bytes"] > 10_000 for c in clips)
    uid = (await e.db.get(MediaAsset, e.aid)).user_id
    assert len(e.uploaded) == 3 and all(k.startswith(f"clips/{uid}/{e.aid}/") for k in e.uploaded)


@pytest.mark.asyncio
async def test_clips_preconditions(clips_env, db):
    e = clips_env
    audio = client.post("/v1/media", json={**BODY, "content_type": "audio/mpeg"}, headers=e.h).json()["asset"]["id"]
    assert client.post(f"/v1/media/{audio}/clips", headers=e.h).status_code == 422
    pending = client.post("/v1/media", json=BODY, headers=e.h).json()["asset"]["id"]
    assert client.post(f"/v1/media/{pending}/clips", headers=e.h).status_code == 409
    other = await _login(db, "b")
    assert client.post(f"/v1/media/{e.aid}/clips", headers=other).status_code == 404
    assert client.get(f"/v1/media/{e.aid}/clips", headers=other).status_code == 404


@pytest.mark.asyncio
async def test_clips_selection_failures_store_nothing(clips_env, monkeypatch):
    e = clips_env
    for exc, status in ((RuntimeError("ANTHROPIC_API_KEY não configurada"), 503), (ValueError("boom"), 502)):
        async def _bad(segments, exc=exc):
            raise exc

        monkeypatch.setattr(clipper, "pick_highlights", _bad)
        r = client.post(f"/v1/media/{e.aid}/clips", headers=e.h)
        assert r.status_code == status and "boom" not in r.text
    monkeypatch.setattr(clipper, "pick_highlights", _pick())
    assert client.post(f"/v1/media/{e.aid}/clips", headers=e.h).status_code == 422
    assert (await e.db.execute(select(MediaClip))).scalars().all() == []


@pytest.mark.asyncio
async def test_empty_transcript_is_refused(clips_env):
    e = clips_env
    row = (await e.db.execute(select(MediaTranscript))).scalars().one()
    row.segments_json = "[]"
    await e.db.commit()
    assert client.post(f"/v1/media/{e.aid}/clips", headers=e.h).status_code == 422


@pytest.mark.asyncio
async def test_one_failed_render_does_not_sink_the_others(clips_env, monkeypatch):
    e = clips_env
    calls = []

    async def _render(source, ass, start, end, dest, layout="crop"):
        calls.append(start)
        if start == 40.0:
            raise RuntimeError("ffmpeg failed: <media> broke")
        open(dest, "wb").write(b"mp4")

    monkeypatch.setattr(clipper, "render_clip", _render)
    client.post(f"/v1/media/{e.aid}/clips", headers=e.h)
    got = {c["rank"]: c for c in client.get(f"/v1/media/{e.aid}/clips", headers=e.h).json()}
    assert [got[i]["status"] for i in (1, 2, 3)] == ["ready", "failed", "ready"] and calls == [0.0, 40.0, 80.0]
    assert "broke" in got[2]["error"] and got[2]["download_url"] is None


@pytest.mark.asyncio
async def test_regenerate_guard_replaces_and_cleans_old_objects(clips_env, monkeypatch):
    e = clips_env

    async def _render(source, ass, start, end, dest, layout="crop"):
        open(dest, "wb").write(b"mp4")

    monkeypatch.setattr(clipper, "render_clip", _render)
    client.post(f"/v1/media/{e.aid}/clips", headers=e.h)
    assert client.post(f"/v1/media/{e.aid}/clips", headers=e.h).status_code == 409  # custo: exige regenerate
    old = set(e.uploaded)

    monkeypatch.setattr(clipper, "pick_highlights", _pick((10, 40)))
    assert client.post(f"/v1/media/{e.aid}/clips?regenerate=true", headers=e.h).status_code == 200
    rows = (await e.db.execute(select(MediaClip))).scalars().all()
    assert len(rows) == 1 and rows[0].status == "ready"
    assert set(e.deleted) == old  # objetos antigos removidos do bucket


@pytest.mark.asyncio
async def test_inflight_render_blocks_but_stale_one_does_not(clips_env, monkeypatch):
    e = clips_env

    async def _render(source, ass, start, end, dest, layout="crop"):
        open(dest, "wb").write(b"mp4")

    monkeypatch.setattr(clipper, "render_clip", _render)
    client.post(f"/v1/media/{e.aid}/clips", headers=e.h)
    clip = (await e.db.execute(select(MediaClip))).scalars().first()
    clip.status = "rendering"
    await e.db.commit()
    assert client.post(f"/v1/media/{e.aid}/clips?regenerate=true", headers=e.h).status_code == 409
    clip.updated_at = datetime.utcnow() - timedelta(hours=1)  # processo morreu no meio
    await e.db.commit()
    assert client.post(f"/v1/media/{e.aid}/clips?regenerate=true", headers=e.h).status_code == 200


def test_attach_words_tightens_segments_to_real_speech():
    segs = [{"start": 0.0, "end": 13.0, "text": "a b"}, {"start": 13.0, "end": 20.0, "text": "c"}]
    words = [{"text": "a", "start": 8.4, "end": 9.0}, {"text": "b", "start": 9.0, "end": 12.5},
             {"text": "c", "start": 14.0, "end": 15.0}]
    out = media_routes._attach_words(segs, words)
    assert (out[0]["start"], out[0]["end"]) == (8.4, 12.5)  # sem o silêncio do começo
    assert [w["text"] for w in out[0]["words"]] == ["a", "b"] and [w["text"] for w in out[1]["words"]] == ["c"]
    assert media_routes._attach_words([], words) == [] and media_routes._attach_words(segs[:1], []) == segs[:1]


@pytest.mark.asyncio
async def test_transcribe_requests_word_timestamps_and_get_hides_them(db, monkeypatch, tmp_path):
    mp3 = tmp_path / "a.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=3", "-y", str(mp3)], check=True)
    seen = {}

    class _T:
        async def create(self, **kw):
            seen.update(kw)
            seg = SimpleNamespace(start=0.0, end=5.0, text=" ola mundo ")
            w = [SimpleNamespace(word=" ola", start=1.0, end=1.4), SimpleNamespace(word=" mundo", start=1.4, end=2.0)]
            return SimpleNamespace(language="pt", duration=5.0, segments=[seg], words=w)

    import openai

    monkeypatch.setattr(openai, "AsyncOpenAI", lambda **kw: SimpleNamespace(audio=SimpleNamespace(transcriptions=_T())))
    monkeypatch.setattr(media_routes, "settings", __import__("dataclasses").replace(media_routes.settings, transcription_api_key="k"))
    res = await media_routes._transcribe(str(mp3))
    assert seen["timestamp_granularities"] == ["segment", "word"]
    assert res["segments"][0]["start"] == 1.0 and [w["text"] for w in res["segments"][0]["words"]] == ["ola", "mundo"]

    h = await _login(db, "a")
    aid = client.post("/v1/media", json=BODY, headers=h).json()["asset"]["id"]
    db.add(MediaTranscript(media_id=aid, segments_json=json.dumps(res["segments"]), language="pt", model="m"))
    await db.commit()
    seg = client.get(f"/v1/media/{aid}", headers=h).json()["transcript"]["segments"][0]
    assert "words" not in seg and seg["text"] == "ola mundo"


# ── Transcrição em janelas ───────────────────────────────────────────────────

def test_chunk_bounds_snap_to_silence_and_always_progress():
    cb = media_routes._chunk_bounds
    assert cb(50, []) == [(0.0, 50)] and cb(64, []) == [(0.0, 64)]            # curto: uma janela só
    b = cb(200, [57.0, 118.5, 300.0])                                         # silêncios perto de 60 e 120
    assert [round(x, 1) for x, _ in b] == [0.0, 57.0, 118.5, 178.5] and b[-1][1] == 200
    assert all(x < y for x, y in b) and b[0][1] == b[1][0]                    # contíguo, sem buraco nem sobreposição
    b = cb(200, [])                                                           # sem silêncio: corta no ponto ideal
    assert [x for x, _ in b] == [0.0, 60.0, 120.0, 180.0] and b[-1][1] == 200
    assert all(y - x >= 5 for x, y in b)                                      # nunca uma janela minúscula


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg ausente")
@pytest.mark.asyncio
async def test_plan_chunks_cuts_inside_real_silence(tmp_path):
    # 150 s: tom de 55 s, silêncio 55-58, tom até 115, silêncio 115-118, tom até 150
    f = tmp_path / "a.mp3"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
         "sine=frequency=300:duration=150,volume='if(between(t,55,58)+between(t,115,118),0,1)':eval=frame",
         "-ac", "1", "-ar", "16000", "-b:a", "32k", "-y", str(f)], check=True)
    plan = await media_routes._plan_chunks(str(f))
    cuts = [a for a, _ in plan][1:]
    assert len(plan) == 3 and plan[-1][1] == pytest.approx(150, abs=0.5)
    assert 55 <= cuts[0] <= 58.2 and 115 <= cuts[1] <= 118.2                  # cada corte caiu dentro do silêncio


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg ausente")
@pytest.mark.asyncio
async def test_transcribe_in_chunks_offsets_times_and_fixes_language_by_majority(tmp_path, monkeypatch):
    f = tmp_path / "a.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=150",
                    "-ac", "1", "-ar", "16000", "-b:a", "32k", "-y", str(f)], check=True)

    async def _plan(path):
        return [(0.0, 50.0), (50.0, 100.0), (100.0, 150.0)]

    calls = []

    async def _whisper(client, path, language, prompt=None):
        calls.append(language)
        i = len(calls)
        # janela do meio "detectou" espanhol (errado) e só na 1.ª passada; com idioma forçado vem certo
        lang = "Spanish" if (language is None and i == 2) else "Portuguese"
        seg = {"start": 1.0, "end": 3.0, "text": f"fala {i}"}
        return [seg], [{"text": "fala", "start": 1.0, "end": 1.5}, {"text": str(i), "start": 1.5, "end": 3.0}], lang

    monkeypatch.setattr(media_routes, "_plan_chunks", _plan)
    monkeypatch.setattr(media_routes, "_whisper", _whisper)
    monkeypatch.setattr(media_routes, "settings", __import__("dataclasses").replace(media_routes.settings, transcription_api_key="k"))
    import openai

    monkeypatch.setattr(openai, "AsyncOpenAI", lambda **kw: object())
    res = await media_routes._transcribe(str(f))
    assert res["language"] == "Portuguese" and res["duration"] == 150.0
    starts = [s["start"] for s in res["segments"]]
    assert starts == [1.0, 51.0, 101.0] and starts == sorted(starts)           # tempos somados ao início da janela
    assert [w["start"] for s in res["segments"] for w in s["words"]][:2] == [1.0, 1.5]
    assert res["segments"][1]["words"][0]["start"] == 51.0
    assert calls.count("pt") == 1 and calls.count(None) == 3                   # só a janela divergente foi refeita, com 'pt'


@pytest.mark.asyncio
async def test_clips_layout_is_validated_and_reaches_the_renderer(clips_env, monkeypatch):
    e = clips_env
    seen = []

    async def _render(source, ass, start, end, dest, layout="crop"):
        seen.append(layout)
        open(dest, "wb").write(b"mp4")

    monkeypatch.setattr(clipper, "render_clip", _render)
    assert client.post(f"/v1/media/{e.aid}/clips?layout=stretch", headers=e.h).status_code == 422
    assert (await e.db.execute(select(MediaClip))).scalars().all() == []     # recusado antes de gastar o Claude
    assert client.post(f"/v1/media/{e.aid}/clips?layout=fit", headers=e.h).status_code == 200
    assert seen == ["fit"] * 3
    seen.clear()
    assert client.post(f"/v1/media/{e.aid}/clips?regenerate=true&layout=crop", headers=e.h).status_code == 200
    assert seen == ["crop"] * 3


def test_public_error_hides_provider_org_and_explains_rate_limit():
    import httpx
    import openai

    req = httpx.Request("POST", "https://api.groq.com/x")
    rl = openai.RateLimitError("429", response=httpx.Response(429, request=req), body=None)
    assert "rate limit" in media_routes._public_error(rl) and "429" not in media_routes._public_error(rl)
    leaked = RuntimeError("Rate limit reached for model x in organization org_01m4dzgd5be1h8d33v897abc service tier")
    assert "org_01" not in media_routes._public_error(leaked) and "<org>" in media_routes._public_error(leaked)


def test_whisper_prompt_is_a_plain_list_capped_in_order():
    wp = media_routes.whisper_prompt
    assert wp(None) is None and wp([]) is None
    assert wp(["Vetto", "Arc Network"]) == "Vetto, Arc Network"               # sem rótulo e sem ponto final
    many = [f"termo{i:03d}" for i in range(200)]
    p = wp(many)
    assert len(p) <= media_routes.GLOSSARY_PROMPT_CHARS and p.startswith("termo000, termo001")  # os primeiros mandam


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg ausente")
@pytest.mark.asyncio
async def test_transcribe_sends_glossary_prompt_to_every_window(tmp_path, monkeypatch):
    f = tmp_path / "a.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=100",
                    "-ac", "1", "-ar", "16000", "-b:a", "32k", "-y", str(f)], check=True)

    async def _plan(path):
        return [(0.0, 50.0), (50.0, 100.0)]

    seen = []

    async def _whisper(client, path, language, prompt=None):
        seen.append(prompt)
        return [{"start": 1.0, "end": 2.0, "text": "oi"}], [{"text": "oi", "start": 1.0, "end": 2.0}], "Portuguese"

    monkeypatch.setattr(media_routes, "_plan_chunks", _plan)
    monkeypatch.setattr(media_routes, "_whisper", _whisper)
    monkeypatch.setattr(media_routes, "settings", __import__("dataclasses").replace(media_routes.settings, transcription_api_key="k"))
    import openai

    monkeypatch.setattr(openai, "AsyncOpenAI", lambda **kw: object())
    await media_routes._transcribe(str(f), ["Vetto", "Hubstaff"])
    assert seen == ["Vetto, Hubstaff"] * 2
    seen.clear()
    await media_routes._transcribe(str(f))
    assert seen == [None, None]


@pytest.mark.asyncio
async def test_owner_glossary_reaches_the_transcription(db, monkeypatch):
    h = await _login(db, "a")
    aid = client.post("/v1/media", json=BODY, headers=h).json()["asset"]["id"]
    asset = await db.get(MediaAsset, aid)
    owner = await db.get(media_routes.User, asset.user_id)
    owner.glossary = json.dumps(["Vetto", "Arc"])
    await db.commit()
    _object_exists(monkeypatch, 1000)
    _fake_extract(monkeypatch)
    got = []

    async def _tr(path, glossary=None):
        got.append(glossary)
        return FAKE_RESULT

    monkeypatch.setattr(media_routes, "_transcribe", _tr)
    client.post(f"/v1/media/{aid}/complete", headers=h)
    assert got == [["Vetto", "Arc"]]


# ── Faxina, fila, layout automático, glossário ───────────────────────────────

@pytest.mark.asyncio
async def test_reaper_fails_orphans_but_leaves_finished_work(db):
    from server import media_maintenance as mm

    h = await _login(db, "a")
    uid = None
    for st in ("transcribing", "transcribed", "pending"):
        aid = client.post("/v1/media", json=BODY, headers=h).json()["asset"]["id"]
        a = await db.get(MediaAsset, aid)
        a.status, uid = st, a.user_id
    for i, st in enumerate(("rendering", "pending", "ready"), 1):
        db.add(MediaClip(user_id=uid, media_id=aid, rank=i, start_s=0, end_s=20, title="t", reason="r", status=st))
    await db.commit()

    assert await mm.reap_interrupted(db) == (1, 2)
    assert [a.status for a in (await db.execute(select(MediaAsset).order_by(MediaAsset.id))).scalars()] == [
        "failed", "transcribed", "pending"]
    assert [c.status for c in (await db.execute(select(MediaClip).order_by(MediaClip.rank))).scalars()] == [
        "failed", "failed", "ready"]


@pytest.mark.asyncio
async def test_purge_expires_old_media_and_abandoned_uploads_only(db, monkeypatch):
    import dataclasses

    from server import media_maintenance as mm

    deleted = []

    async def _del(key):
        deleted.append(key)

    monkeypatch.setattr(mm.media_storage, "delete_object", _del)
    monkeypatch.setattr(mm, "settings", dataclasses.replace(mm.settings, media_retention_days=30))
    h = await _login(db, "a")
    now = datetime.utcnow()
    ids = {}
    for name, age, status in (("old", 40, "transcribed"), ("fresh", 5, "transcribed"),
                              ("abandoned", 3, "pending"), ("waiting", 1, "pending")):
        aid = client.post("/v1/media", json=BODY, headers=h).json()["asset"]["id"]
        a = await db.get(MediaAsset, aid)
        a.status, a.created_at = status, now - timedelta(days=age)
        ids[name] = aid
    old = await db.get(MediaAsset, ids["old"])
    db.add(MediaClip(user_id=old.user_id, media_id=old.id, rank=1, start_s=0, end_s=20, title="t", reason="r",
                     status="ready", r2_key="clips/x.mp4", size_bytes=9))
    db.add(MediaTranscript(media_id=old.id, segments_json="[]", language="pt", model="m"))
    await db.commit()

    assert await mm.purge_expired(db, now) == 2
    st = {n: (await db.get(MediaAsset, i)).status for n, i in ids.items()}
    assert st == {"old": "expired", "fresh": "transcribed", "abandoned": "expired", "waiting": "pending"}
    assert "clips/x.mp4" in deleted and old.r2_key in deleted and len(deleted) == 3
    clip = (await db.execute(select(MediaClip))).scalars().one()
    assert (clip.status, clip.r2_key) == ("expired", None)
    assert (await db.execute(select(MediaTranscript))).scalars().all() == []
    assert await mm.purge_expired(db, now) == 0  # idempotente


@pytest.mark.asyncio
async def test_purge_keeps_the_row_when_the_bucket_fails(db, monkeypatch):
    from server import media_maintenance as mm

    async def _boom(key):
        raise RuntimeError("r2 down")

    monkeypatch.setattr(mm.media_storage, "delete_object", _boom)
    h = await _login(db, "a")
    aid = client.post("/v1/media", json=BODY, headers=h).json()["asset"]["id"]
    a = await db.get(MediaAsset, aid)
    a.created_at = datetime.utcnow() - timedelta(days=5)
    await db.commit()
    assert await mm.purge_expired(db) == 0
    assert (await db.get(MediaAsset, aid)).status == "pending"  # tenta de novo no próximo ciclo


@pytest.mark.asyncio
async def test_expired_media_cannot_be_clipped(clips_env, monkeypatch):
    e = clips_env
    (await e.db.get(MediaAsset, e.aid)).status = "expired"
    await e.db.commit()
    assert client.post(f"/v1/media/{e.aid}/clips", headers=e.h).status_code == 409


def test_ffmpeg_failure_is_explained_without_the_raw_stderr():
    msg = media_routes._public_error(RuntimeError("ffmpeg failed: <media> Invalid data found when processing input"))
    assert "corrupt or unsupported" in msg and "Invalid data" not in msg


@pytest.mark.asyncio
async def test_default_layout_is_auto_and_resolved_once_per_media(clips_env, monkeypatch):
    e = clips_env
    seen, asked = [], []

    async def _render(source, ass, start, end, dest, layout="crop"):
        seen.append(layout)
        open(dest, "wb").write(b"mp4")

    async def _detect(source, start, end):
        asked.append((start, end))
        return "fit"

    monkeypatch.setattr(clipper, "render_clip", _render)
    monkeypatch.setattr(clipper, "detect_layout", _detect)
    assert client.post(f"/v1/media/{e.aid}/clips", headers=e.h).status_code == 200
    assert seen == ["fit"] * 3 and asked == [(0.0, 30.0)]                      # uma decisão, no 1.º corte
    seen.clear()
    assert client.post(f"/v1/media/{e.aid}/clips?regenerate=true&layout=crop", headers=e.h).status_code == 200
    assert seen == ["crop"] * 3 and len(asked) == 1                            # explícito não gasta o Claude


@pytest.mark.asyncio
async def test_detect_layout_falls_back_to_fit_and_reads_the_models_answer(monkeypatch, tmp_path):
    import dataclasses

    # sem chave: fit, sem tentar nada
    monkeypatch.setattr(clipper, "settings", dataclasses.replace(clipper.settings, anthropic_api_key=""))
    assert await clipper.detect_layout("x.mp4", 0, 30) == "fit"

    monkeypatch.setattr(clipper, "settings", dataclasses.replace(clipper.settings, anthropic_api_key="k"))

    async def _frames(source, start, end, n=3):
        return [b"\xff\xd8jpeg"] * n

    monkeypatch.setattr(clipper, "grab_frames", _frames)
    import anthropic

    answers = iter(["crop", "banana"])

    class _M:
        async def create(self, **kw):
            assert sum(1 for b in kw["messages"][0]["content"] if b["type"] == "image") == 3
            assert kw["tool_choice"] == {"type": "tool", "name": "report_layout"}
            return SimpleNamespace(content=[SimpleNamespace(type="tool_use", input={"layout": next(answers)})])

    monkeypatch.setattr(anthropic, "AsyncAnthropic", lambda **kw: SimpleNamespace(messages=_M()))
    assert await clipper.detect_layout("x.mp4", 0, 30) == "crop"
    assert await clipper.detect_layout("x.mp4", 0, 30) == "fit"                # resposta inválida → fit

    async def _broken(source, start, end, n=3):
        raise RuntimeError("ffmpeg failed")

    monkeypatch.setattr(clipper, "grab_frames", _broken)
    assert await clipper.detect_layout("x.mp4", 0, 30) == "fit"


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg ausente")
@pytest.mark.asyncio
async def test_grab_frames_returns_real_jpegs(tmp_path):
    v = tmp_path / "v.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=10:duration=10",
                    "-pix_fmt", "yuv420p", "-y", str(v)], check=True)
    frames = await clipper.grab_frames(str(v), 0, 10)
    assert len(frames) == 3 and all(f[:2] == b"\xff\xd8" for f in frames)


def test_suggest_glossary_picks_repeated_proper_nouns_only():
    segs = [[
        {"text": "Hoje eu falo da Vetto e do projeto Arc."},
        {"text": "Ontem a Vetto lançou. A API do Arc mudou, mas Vetto segue."},
        {"text": "Depois conversei com Maria uma vez."},
    ]]
    out = media_routes.suggest_glossary(segs, known=["arc"])
    assert [(s["term"], s["count"]) for s in out] == [("Vetto", 3)]          # API só 1x; Arc já conhecido
    # início de segmento/frase e termo único não entram
    assert all(s["term"] not in ("Hoje", "Ontem", "Depois", "Maria") for s in out)


@pytest.mark.asyncio
async def test_glossary_suggestions_endpoint_is_scoped_to_the_owner(db):
    h, other = await _login(db, "a"), await _login(db, "b")
    aid = client.post("/v1/media", json=BODY, headers=h).json()["asset"]["id"]
    segs = [{"start": 0, "end": 5, "text": "falo da Vetto agora"}, {"start": 5, "end": 9, "text": "ver a Vetto de novo"}]
    db.add(MediaTranscript(media_id=aid, segments_json=json.dumps(segs), language="pt", model="m"))
    await db.commit()
    assert client.get("/v1/media/glossary/suggestions", headers=h).json() == {"suggestions": [{"term": "Vetto", "count": 2}]}
    assert client.get("/v1/media/glossary/suggestions", headers=other).json() == {"suggestions": []}
