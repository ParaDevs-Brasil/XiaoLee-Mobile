"""
media_routes.py — Media Repository + transcrição (Clipper, S4: Plane #27/#28).

Fluxo (o arquivo nunca passa pelo backend):
    POST /v1/media                → cria o registro e devolve URL pré-assinada de PUT no R2
    (app envia o arquivo direto ao R2)
    POST /v1/media/{id}/complete  → confere o objeto no bucket e dispara a transcrição
    GET  /v1/media[/{id}]         → lista / detalhe (com transcrição quando pronta)

Transcrição: ffmpeg extrai áudio mono 16 kHz/32 kbps do vídeo (lido por URL
pré-assinada) e um endpoint Whisper OpenAI-compatível devolve segmentos com
timestamps — insumo da detecção de highlights.

O dono vem SEMPRE do Bearer emitido pelo backend (strict), nunca de URL/corpo.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import database as _dbmod
from database.database import get_db_session
from database.models import MediaAsset, MediaTranscript
from database.repository import to_utc_iso
from server import media_storage
from server.campaigns_routes import _resolve_user
from server.settings import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/media", tags=["media"])

# 24 MiB: limite do Whisper é 25 MB por arquivo. A 32 kbps isso é ~104 min de áudio.
# ponytail: sem chunking — vídeo acima de ~100 min falha com mensagem clara; dividir o áudio se precisar.
MAX_AUDIO_BYTES = 24 * 1024 * 1024
FFMPEG_TIMEOUT_S = 1800
STALE_TRANSCRIBING = timedelta(minutes=30)  # transcrição "presa" por restart do processo pode ser refeita


class MediaCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(max_length=100)
    size_bytes: int = Field(gt=0)
    sha256: Optional[str] = Field(default=None, pattern=r"^[0-9a-f]{64}$")  # declarado pelo cliente, não verificado


class MediaOut(BaseModel):
    id: int
    kind: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: Optional[str] = None
    status: str
    error: Optional[str] = None
    duration_s: Optional[float] = None
    created_at: str


class MediaDetail(MediaOut):
    transcript: Optional[dict] = None


class MediaUpload(BaseModel):
    asset: MediaOut
    upload_url: str
    upload_headers: dict[str, str]


def _out(a: MediaAsset) -> MediaOut:
    return MediaOut(
        id=a.id, kind=a.kind, filename=a.filename, content_type=a.content_type,
        size_bytes=a.size_bytes, sha256=a.sha256,
        status=a.status, error=a.error, duration_s=a.duration_s, created_at=to_utc_iso(a.created_at),
    )


async def _owned(db: AsyncSession, authorization: Optional[str], asset_id: int) -> MediaAsset:
    user = await _resolve_user(db, authorization, strict=True)
    asset = (
        await db.execute(select(MediaAsset).where(MediaAsset.id == asset_id, MediaAsset.user_id == user.id))
    ).scalars().first()
    if not asset:
        raise HTTPException(404, "media not found")
    return asset


@router.post("", response_model=MediaUpload)
async def create_media(
    body: MediaCreate,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    if not body.content_type.startswith(("video/", "audio/")):
        raise HTTPException(422, "content_type must be video/* or audio/*")
    if body.size_bytes > settings.media_max_bytes:
        raise HTTPException(413, f"file too large (max {settings.media_max_bytes} bytes)")

    user = await _resolve_user(db, authorization, strict=True)
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(body.filename))[:120] or "media"
    key = f"media/{user.id}/{uuid.uuid4().hex}/{safe_name}"
    try:
        url = media_storage.presign_put(key, body.content_type, body.size_bytes)
    except media_storage.StorageNotConfigured as exc:
        raise HTTPException(503, str(exc))

    asset = MediaAsset(
        user_id=user.id, kind=body.content_type.split("/")[0], filename=safe_name,
        content_type=body.content_type, size_bytes=body.size_bytes, sha256=body.sha256,
        r2_key=key, status="pending",
    )
    db.add(asset)
    await db.commit()
    return MediaUpload(asset=_out(asset), upload_url=url, upload_headers={"Content-Type": body.content_type})


@router.post("/{asset_id}/complete", response_model=MediaOut)
async def complete_upload(
    asset_id: int,
    background: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    asset = await _owned(db, authorization, asset_id)
    stale = asset.status == "transcribing" and datetime.utcnow() - asset.updated_at > STALE_TRANSCRIBING
    if asset.status not in ("pending", "uploaded", "failed") and not stale:
        raise HTTPException(409, f"media is {asset.status}")

    try:
        size = await media_storage.object_size(asset.r2_key)
    except media_storage.StorageNotConfigured as exc:
        raise HTTPException(503, str(exc))
    if size is None:
        raise HTTPException(409, "upload not found in storage")
    if size != asset.size_bytes:
        raise HTTPException(409, "uploaded size does not match declared size")

    asset.status, asset.error = "transcribing", None
    await db.commit()
    # ponytail: tarefa em processo (workers=1 no Railway) + status no banco; se o processo reiniciar,
    # o cliente reenvia /complete (ver STALE_TRANSCRIBING). Fila Redis quando houver >1 worker.
    background.add_task(transcribe_asset, asset.id)
    return _out(asset)


@router.get("", response_model=list[MediaOut])
async def list_media(
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    user = await _resolve_user(db, authorization, strict=True)
    rows = (
        await db.execute(select(MediaAsset).where(MediaAsset.user_id == user.id).order_by(MediaAsset.id.desc()))
    ).scalars().all()
    return [_out(a) for a in rows]


@router.get("/{asset_id}", response_model=MediaDetail)
async def get_media(
    asset_id: int,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    asset = await _owned(db, authorization, asset_id)
    row = (await db.execute(select(MediaTranscript).where(MediaTranscript.media_id == asset.id))).scalars().first()
    transcript = None
    if row:
        segments = json.loads(row.segments_json)
        transcript = {
            "text": " ".join(seg["text"] for seg in segments),
            "language": row.language, "model": row.model, "segments": segments,
        }
    return MediaDetail(**_out(asset).model_dump(), transcript=transcript)


# ── Pipeline de transcrição ──────────────────────────────────────────────────

def _session():
    return _dbmod.SessionLocal()


async def _extract_audio(source: str, dest: str) -> None:
    """`source` é caminho local ou URL (ffmpeg lê ambos). Só áudio, mono 16 kHz, 32 kbps."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-nostdin", "-v", "error", "-i", source,
        "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-y", dest,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, err = await asyncio.wait_for(proc.communicate(), FFMPEG_TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError("ffmpeg timed out")
    if proc.returncode != 0:
        # a URL pré-assinada vem na linha de erro do ffmpeg — não vazar para o banco/cliente
        raise RuntimeError("ffmpeg failed: " + err.decode(errors="replace")[-300:].replace(source, "<media>"))


async def _transcribe(audio_path: str) -> dict:
    if not settings.transcription_api_key:
        raise RuntimeError("TRANSCRIPTION_API_KEY (ou OPENAI_API_KEY) não configurada")
    import openai

    client = openai.AsyncOpenAI(
        api_key=settings.transcription_api_key, base_url=settings.transcription_base_url or None
    )
    with open(audio_path, "rb") as f:
        r = await client.audio.transcriptions.create(
            model=settings.transcription_model, file=f,
            response_format="verbose_json", timestamp_granularities=["segment"],
        )
    return {
        "language": getattr(r, "language", None),
        "duration": getattr(r, "duration", None),
        "segments": [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in (r.segments or [])],
    }


async def transcribe_asset(asset_id: int) -> None:
    async with _session() as db:
        asset = await db.get(MediaAsset, asset_id)
        if not asset:
            return
        try:
            with tempfile.TemporaryDirectory() as tmp:
                audio = os.path.join(tmp, "audio.mp3")
                await _extract_audio(media_storage.presign_get(asset.r2_key), audio)
                if os.path.getsize(audio) > MAX_AUDIO_BYTES:
                    raise RuntimeError("media too long to transcribe (max ~100 minutes)")
                result = await _transcribe(audio)
            await db.execute(delete(MediaTranscript).where(MediaTranscript.media_id == asset.id))  # refazer substitui
            db.add(MediaTranscript(
                media_id=asset.id, segments_json=json.dumps(result["segments"], ensure_ascii=False),
                language=result.get("language"), model=settings.transcription_model,
            ))
            asset.duration_s = result.get("duration")
            asset.status, asset.error = "transcribed", None
        except Exception as exc:  # o status 'failed' + erro é o canal de feedback ao app
            logger.exception("transcription failed for media %s", asset_id)
            asset.status, asset.error = "failed", str(exc)[:500]
        await db.commit()
