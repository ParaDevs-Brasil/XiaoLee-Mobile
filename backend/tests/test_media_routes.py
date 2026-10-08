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
import os
import shutil
import subprocess
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.database import get_db_session
from database.models import MediaAsset, MediaTranscript, WebSession

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

    async def _tr(path):
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

    async def _boom(path):
        raise RuntimeError("whisper down")

    monkeypatch.setattr(media_routes, "_transcribe", _boom)
    client.post(f"/v1/media/{aid}/complete", headers=h)
    d = client.get(f"/v1/media/{aid}", headers=h).json()
    assert d["status"] == "failed" and "whisper down" in d["error"]

    async def _ok(path):
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
        async def _tr(path, text=text):
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
async def test_audio_over_whisper_limit_fails_clearly(db, monkeypatch):
    h = await _login(db, "a")
    aid = client.post("/v1/media", json=BODY, headers=h).json()["asset"]["id"]
    _object_exists(monkeypatch, 1000)
    _fake_extract(monkeypatch, b"x" * 100)
    monkeypatch.setattr(media_routes, "MAX_AUDIO_BYTES", 50)
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
