"""
media_routes.py — Media Repository + transcrição (Clipper, S4: Plane #27/#28).

Fluxo (o arquivo nunca passa pelo backend):
    POST /v1/media                → cria o registro e devolve URL pré-assinada de PUT no R2
    (app envia o arquivo direto ao R2)
    POST /v1/media/{id}/complete  → confere o objeto no bucket e dispara a transcrição
    GET  /v1/media[/{id}]         → lista / detalhe (com transcrição quando pronta)

    POST /v1/media/{id}/clips     → Claude escolhe 3 highlights; renderiza em background (9:16 legendado; ?layout=crop|fit)
    GET  /v1/media/{id}/clips     → cortes + URL de download dos prontos

Transcrição: ffmpeg extrai áudio mono 16 kHz/32 kbps do vídeo (lido por URL
pré-assinada), corta em janelas de ~60 s nos silêncios e um endpoint Whisper
OpenAI-compatível devolve segmentos e palavras com timestamps — insumo da detecção de highlights.

O dono vem SEMPRE do Bearer emitido pelo backend (strict), nunca de URL/corpo.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import case, delete, func, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from database import database as _dbmod
from database.database import get_db_session
from database.models import MediaAsset, MediaClip, MediaTranscript, User
from database.repository import to_utc_iso
from server import clipper, media_storage
from server.campaigns_routes import _resolve_user
from server.settings import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/media", tags=["media"])

# O áudio vai ao Whisper em janelas de ~60 s (cortadas em silêncios): numa chamada só, vídeos de vários
# minutos degradam o texto (palavras cortadas: "edi", "crian") e o limite de 25 MB por arquivo travava em ~100 min.
CHUNK_S = 60.0
CHUNK_SNAP_S = 8.0        # procura silêncio até 8 s antes/depois do ponto de corte ideal
CHUNK_CONCURRENCY = 4
MAX_AUDIO_S = 4 * 3600    # teto de custo por mídia
GLOSSARY_PROMPT_CHARS = 500  # o Whisper só lê as últimas ~224 palavras-token do prompt
# nome que o Whisper devolve → código ISO que o parâmetro `language` aceita
ISO_LANG = {"portuguese": "pt", "english": "en", "spanish": "es", "french": "fr", "german": "de", "italian": "it",
            "japanese": "ja", "korean": "ko", "chinese": "zh", "russian": "ru", "arabic": "ar", "hindi": "hi",
            "turkish": "tr", "dutch": "nl", "polish": "pl", "indonesian": "id", "ukrainian": "uk"}
FFMPEG_TIMEOUT_S = 1800
TITLE_MAX = 120
THUMB_MEDIA_W, THUMB_CLIP_W = 480, 270  # largura em px: 2x o que a lista/poster mostram na tela
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
    # Nome exibido: o que o creator escolheu (PATCH) ou, sem isso, o `filename`.
    title: str
    # Miniatura (JPEG) para a lista; URL temporária (1 h). `None` = ainda não gerada, ou áudio.
    thumbnail_url: Optional[str] = None
    created_at: str
    # Última mudança de status: o app usa para notar transcrição "presa" (STALE_TRANSCRIBING) e oferecer refazer.
    updated_at: Optional[str] = None
    # Cortes deste vídeo. `status=transcribed` só diz que a TRANSCRIÇÃO acabou: sem estas contagens a lista
    # mostrava "Ready" com os cortes ainda renderizando (ou nem gerados). Falhos = total - prontos - em andamento.
    clips_total: int = 0
    clips_ready: int = 0
    clips_in_progress: int = 0  # pending + rendering


class MediaDetail(MediaOut):
    transcript: Optional[dict] = None


class ClipOut(BaseModel):
    id: int
    rank: int
    start_s: float
    end_s: float
    title: str
    reason: str
    status: str
    error: Optional[str] = None
    size_bytes: Optional[int] = None
    download_url: Optional[str] = None  # só quando ready; URL temporária (1 h)
    thumbnail_url: Optional[str] = None  # quadro do corte renderizado; URL temporária (1 h)
    updated_at: Optional[str] = None  # idem MediaOut: corte preso em pending/rendering vira "gerar de novo" no app


class TitleUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=TITLE_MAX)


class MediaUpload(BaseModel):
    asset: MediaOut
    upload_url: str
    upload_headers: dict[str, str]


def _updated_at(obj) -> Optional[str]:
    """`updated_at` só se já estiver carregado. Logo depois de um UPDATE ele está expirado (`onupdate=func.now()`
    é calculado no banco) e ler o atributo dispararia um lazy load síncrono na sessão async. Nesse caso a linha
    acabou de mudar — `None` (o app trata como recente) é a resposta certa."""
    value = inspect(obj).dict.get("updated_at")
    return to_utc_iso(value) if value else None


def _thumb_url(key: Optional[str]) -> Optional[str]:
    """URL da miniatura. Sem storage configurado ou sem miniatura a lista segue funcionando, só sem imagem."""
    if not key:
        return None
    try:
        return media_storage.presign_get(key)
    except media_storage.StorageNotConfigured:
        return None


def _out(a: MediaAsset, clip_counts: tuple[int, int, int] = (0, 0, 0)) -> MediaOut:
    total, ready, in_progress = clip_counts
    return MediaOut(
        id=a.id, kind=a.kind, filename=a.filename, content_type=a.content_type,
        size_bytes=a.size_bytes, sha256=a.sha256,
        status=a.status, error=a.error, duration_s=a.duration_s, created_at=to_utc_iso(a.created_at),
        updated_at=_updated_at(a), title=a.title or a.filename, thumbnail_url=_thumb_url(a.thumb_key),
        clips_total=total, clips_ready=ready, clips_in_progress=in_progress,
    )


async def _clip_counts(db: AsyncSession, media_ids: list[int]) -> dict[int, tuple[int, int, int]]:
    """(total, prontos, em andamento) por vídeo, numa query só — a lista não carrega os cortes."""
    if not media_ids:
        return {}
    rows = await db.execute(
        select(
            MediaClip.media_id,
            func.count(),
            func.sum(case((MediaClip.status == "ready", 1), else_=0)),
            func.sum(case((MediaClip.status.in_(("pending", "rendering")), 1), else_=0)),
        ).where(MediaClip.media_id.in_(media_ids)).group_by(MediaClip.media_id)
    )
    return {mid: (int(total), int(ready or 0), int(busy or 0)) for mid, total, ready, busy in rows.all()}


def _clean_title(raw: str) -> str:
    """Espaço normalizado; o que sobra vazio é recusado (o campo é obrigatório no corte e opcional na mídia)."""
    title = re.sub(r"\s+", " ", raw).strip()
    if not title:
        raise HTTPException(422, "title must not be empty")
    return title


async def _exists(db: AsyncSession, model, row_id: int) -> bool:
    """A linha ainda existe? Consulta o banco de verdade (não o cache da sessão): serve às tarefas de fundo
    para perceber que o creator apagou o vídeo/corte enquanto elas trabalhavam."""
    return (await db.execute(select(model.id).where(model.id == row_id))).first() is not None


async def _delete_objects(keys: list[str]) -> None:
    """Apaga objetos do bucket, sem derrubar ninguém: com a linha do banco já removida, um objeto que sobra
    é só espaço ocupado, e a falha fica no log."""
    for key in keys:
        try:
            await media_storage.delete_object(key)
        except Exception:
            logger.warning("could not delete object %s", key)


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
    background: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    user = await _resolve_user(db, authorization, strict=True)
    rows = (
        await db.execute(select(MediaAsset).where(MediaAsset.user_id == user.id).order_by(MediaAsset.id.desc()))
    ).scalars().all()
    # Vídeos de antes das miniaturas existirem: gera em background; aparecem na próxima abertura da lista.
    missing = [a.id for a in rows if a.kind == "video" and a.status == "transcribed" and not a.thumb_key]
    if missing:
        background.add_task(backfill_thumbnails, media_ids=missing)
    counts = await _clip_counts(db, [a.id for a in rows])
    return [_out(a, counts.get(a.id, (0, 0, 0))) for a in rows]


@router.patch("/{asset_id}", response_model=MediaOut)
async def rename_media(
    asset_id: int,
    body: TitleUpdate,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    """Só muda o nome exibido; o `filename` original (e a chave no bucket) ficam como estão."""
    asset = await _owned(db, authorization, asset_id)
    asset.title = _clean_title(body.title)
    await db.commit()
    return _out(asset)


@router.delete("/{asset_id}", status_code=204)
async def delete_media(
    asset_id: int,
    background: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    """Apaga o vídeo com tudo que saiu dele: cortes, transcrição e os objetos do bucket (arquivo original,
    cortes e miniaturas). Vale em qualquer estado — apagar um vídeo transcrevendo é como o creator cancela
    um envio errado; as tarefas de fundo percebem que a linha sumiu e param (`_exists`)."""
    asset = await _owned(db, authorization, asset_id)
    clips = await _clips_of(db, asset.id)
    keys = [k for k in (asset.r2_key, asset.thumb_key, *(k for c in clips for k in (c.r2_key, c.thumb_key))) if k]
    await db.execute(delete(MediaClip).where(MediaClip.media_id == asset.id))
    await db.execute(delete(MediaTranscript).where(MediaTranscript.media_id == asset.id))
    await db.delete(asset)
    await db.commit()
    background.add_task(_delete_objects, keys)
    return Response(status_code=204)


@router.get("/{asset_id}", response_model=MediaDetail)
async def get_media(
    asset_id: int,
    include_transcript: bool = True,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    """`include_transcript=false`: só o status — o que o app consulta em loop enquanto transcreve, sem
    baixar de novo a transcrição de 1 h a cada consulta."""
    asset = await _owned(db, authorization, asset_id)
    out = _out(asset, (await _clip_counts(db, [asset.id])).get(asset.id, (0, 0, 0)))
    if not include_transcript:
        return MediaDetail(**out.model_dump())
    row = (await db.execute(select(MediaTranscript).where(MediaTranscript.media_id == asset.id))).scalars().first()
    transcript = None
    if row:
        segments = [{k: v for k, v in seg.items() if k != "words"} for seg in json.loads(row.segments_json)]
        transcript = {
            "text": " ".join(seg["text"] for seg in segments),
            "language": row.language, "model": row.model, "segments": segments,
        }
    return MediaDetail(**out.model_dump(), transcript=transcript)


# ── Pipeline de transcrição ──────────────────────────────────────────────────

def _session():
    return _dbmod.SessionLocal()


async def _extract_audio(source: str, dest: str) -> None:
    """`source` é caminho local ou URL (ffmpeg lê ambos). Só áudio, mono 16 kHz, 32 kbps."""
    await clipper.run_ffmpeg(
        ["-i", source, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-y", dest], source, FFMPEG_TIMEOUT_S
    )


def _attach_words(segments: list[dict], words: list[dict]) -> list[dict]:
    """Pendura cada palavra (timestamp real do Whisper) no segmento que contém o seu ponto médio e
    aperta o segmento para a fala de fato. Sem isso o Whisper devolve segmentos que começam no silêncio
    anterior (ex.: segmento em 0 s, primeira palavra em 8 s) e corte/legenda nascem dessincronizados."""
    if not segments or not words:
        return segments
    ptr = 0
    for w in words:
        mid = (w["start"] + w["end"]) / 2
        while ptr + 1 < len(segments) and mid >= segments[ptr + 1]["start"]:
            ptr += 1
        segments[ptr].setdefault("words", []).append(w)
    for seg in segments:
        if seg.get("words"):
            seg["start"], seg["end"] = seg["words"][0]["start"], seg["words"][-1]["end"]
    return segments


def _chunk_bounds(duration: float, silences: list[float]) -> list[tuple[float, float]]:
    """Janelas de ~CHUNK_S. Cada corte vai para o silêncio mais próximo do ponto ideal (±CHUNK_SNAP_S),
    para não partir uma palavra no meio; sem silêncio por perto, corta no ponto ideal."""
    if duration <= CHUNK_S + 5:
        return [(0.0, duration)]
    cuts, t = [0.0], CHUNK_S
    while t < duration - 5:  # sobra de menos de 5 s fica na última janela
        near = [x for x in silences if abs(x - t) <= CHUNK_SNAP_S]
        c = max(min(near, key=lambda x: abs(x - t)) if near else t, cuts[-1] + 10)
        cuts.append(c)
        t = c + CHUNK_S
    cuts.append(duration)
    return list(zip(cuts, cuts[1:]))


async def _plan_chunks(audio_path: str) -> list[tuple[float, float]]:
    """Duração (ffprobe) + silêncios (ffmpeg silencedetect) → janelas."""
    probe = await asyncio.to_thread(
        subprocess.run, ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio_path],
        capture_output=True, text=True, check=True, timeout=60,
    )
    duration = float(probe.stdout.strip())
    if duration <= CHUNK_S + 5:
        return [(0.0, duration)]
    log = await clipper.run_ffmpeg(
        ["-v", "info", "-i", audio_path, "-af", "silencedetect=noise=-35dB:d=0.3", "-f", "null", "-"],
        audio_path, FFMPEG_TIMEOUT_S,
    )
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
    return _chunk_bounds(duration, [(a + b) / 2 for a, b in zip(starts, ends)])


def whisper_prompt(glossary: list[str] | None) -> str | None:
    """Termos do creator como texto prévio: o Whisper tende a grafar esses nomes do jeito dado.
    Medido num vídeo real (PT-BR): lista simples, SEM ponto final e sem rótulo, preserva o jeito de falar
    ("pra", "né", "tá"); com ponto final o Whisper formaliza o texto todo, e um rótulo em português
    poderia enviesar a detecção de idioma de um vídeo em inglês."""
    terms, used = [], 0
    for t in glossary or []:
        if used + len(t) + 2 > GLOSSARY_PROMPT_CHARS:
            break
        terms.append(t)
        used += len(t) + 2
    return ", ".join(terms) if terms else None


async def _whisper(client, path: str, language: str | None, prompt: str | None = None) -> tuple[list[dict], list[dict], str | None]:
    kw = {"language": language} if language else {}
    if prompt:
        kw["prompt"] = prompt
    with open(path, "rb") as f:
        r = await client.audio.transcriptions.create(
            model=settings.transcription_model, file=f,
            response_format="verbose_json", timestamp_granularities=["segment", "word"], **kw,
        )
    segments = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in (r.segments or [])]
    words = [{"text": w.word.strip(), "start": w.start, "end": w.end} for w in (getattr(r, "words", None) or []) if w.word.strip()]
    return segments, words, getattr(r, "language", None)


async def _transcribe(audio_path: str, glossary: list[str] | None = None) -> dict:
    if not settings.transcription_api_key:
        raise RuntimeError("TRANSCRIPTION_API_KEY (ou OPENAI_API_KEY) não configurada")
    import openai

    plan = await _plan_chunks(audio_path)
    duration = plan[-1][1]
    if duration > MAX_AUDIO_S:
        raise RuntimeError(f"media too long to transcribe (max {MAX_AUDIO_S // 3600} hours)")
    # max_retries alto: o plano gratuito do Groq limita a 20 requisições/min e uma hora de vídeo são ~60 janelas;
    # o cliente espera o tempo que a própria API manda (Retry-After) em vez de falhar no primeiro 429.
    client = openai.AsyncOpenAI(
        api_key=settings.transcription_api_key, base_url=settings.transcription_base_url or None, max_retries=8
    )
    sem = asyncio.Semaphore(CHUNK_CONCURRENCY)
    prompt = whisper_prompt(glossary)

    with tempfile.TemporaryDirectory() as tmp:
        async def one(i: int, a: float, b: float, language: str | None):
            part = os.path.join(tmp, f"part{i}.mp3")
            async with sem:
                if len(plan) == 1:
                    part = audio_path
                else:
                    await clipper.run_ffmpeg(
                        ["-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", audio_path, "-ac", "1", "-ar", "16000",
                         "-b:a", "32k", "-y", part], audio_path, FFMPEG_TIMEOUT_S)
                return await _whisper(client, part, language, prompt)

        results = await asyncio.gather(*(one(i, a, b, None) for i, (a, b) in enumerate(plan)))
        # idioma: cada janela detecta sozinha, e uma janela só de música/silêncio erra. Vale a maioria
        # (por palavras); janelas que discordaram são refeitas com o idioma forçado.
        votes: dict[str, int] = {}
        for _, words, lang in results:
            if lang:
                votes[lang.lower()] = votes.get(lang.lower(), 0) + len(words)
        language = max(votes, key=votes.get) if votes else None
        iso = ISO_LANG.get(language or "")
        if iso:
            redo = [i for i, (_, words, lang) in enumerate(results) if words and (lang or "").lower() != language]
            for i, res in zip(redo, await asyncio.gather(*(one(i, *plan[i], iso) for i in redo))):
                results[i] = res

    segments: list[dict] = []
    for (a, _), (segs, words, _) in zip(plan, results):
        for x in segs + words:
            x["start"] += a
            x["end"] += a
        segments += _attach_words(segs, words)
    return {"language": language.capitalize() if language else None, "duration": duration, "segments": segments}


def _public_error(exc: Exception) -> str:
    """Mensagem de erro que o app pode ver: sem ID de organização/chave do provedor, e legível no 429."""
    import openai

    if isinstance(exc, openai.RateLimitError):
        return "transcription provider is busy (rate limit), try again in a few minutes"
    return re.sub(r"org_[A-Za-z0-9]+", "<org>", str(exc))[:500]


async def transcribe_asset(asset_id: int) -> None:
    async with _session() as db:
        asset = await db.get(MediaAsset, asset_id)
        if not asset:
            return
        try:
            with tempfile.TemporaryDirectory() as tmp:
                audio = os.path.join(tmp, "audio.mp3")
                await _extract_audio(media_storage.presign_get(asset.r2_key), audio)
                owner = await db.get(User, asset.user_id)
                result = await _transcribe(audio, json.loads(owner.glossary) if owner and owner.glossary else None)
            if not await _exists(db, MediaAsset, asset_id):
                return  # o creator apagou o vídeo enquanto ele transcrevia: nada a gravar
            await db.execute(delete(MediaTranscript).where(MediaTranscript.media_id == asset.id))  # refazer substitui
            db.add(MediaTranscript(
                media_id=asset.id, segments_json=json.dumps(result["segments"], ensure_ascii=False),
                language=result.get("language"), model=settings.transcription_model,
            ))
            asset.duration_s = result.get("duration")
            if asset.kind == "video":
                asset.thumb_key = await _store_thumbnail(
                    media_storage.presign_get(asset.r2_key), _thumb_key_for(asset), _frame_at(asset.duration_s),
                    THUMB_MEDIA_W,
                )
            asset.status, asset.error = "transcribed", None
        except Exception as exc:  # o status 'failed' + erro é o canal de feedback ao app
            logger.exception("transcription failed for media %s", asset_id)
            asset.status, asset.error = "failed", _public_error(exc)
        try:
            await db.commit()
        except (StaleDataError, IntegrityError):  # apagado entre a checagem e o commit
            await db.rollback()
            logger.info("media %s was deleted while transcribing", asset_id)


# ── Miniaturas ───────────────────────────────────────────────────────────────

def _frame_at(duration: Optional[float]) -> float:
    """Quadro a ~10% do vídeo: o início costuma ser tela preta, vinheta ou o creator ajeitando a câmera."""
    return min(max((duration or 0) * 0.1, 1.0), 60.0)


def _thumb_key_for(asset: MediaAsset) -> str:
    return f"thumbs/{asset.user_id}/{asset.id}/{uuid.uuid4().hex}.jpg"


async def _store_thumbnail(source: str, key: str, at_s: float, width: int) -> Optional[str]:
    """Extrai um quadro e sobe ao bucket. Miniatura é enfeite: qualquer falha vira `None` (a lista mostra o
    tile sem imagem) e nunca derruba a transcrição nem o render do corte."""
    try:
        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, "thumb.jpg")
            await clipper.extract_thumbnail(source, dest, at_s, width)
            await media_storage.upload_file(dest, key, "image/jpeg")
        return key
    except Exception:
        logger.warning("thumbnail failed for %s", key, exc_info=True)
        return None


# Já tentados neste processo: um vídeo cujo quadro não sai (arquivo corrompido) não pode reprocessar a cada
# abertura da lista. Reiniciar o processo zera — é uma tentativa nova, e é o que se quer.
_THUMB_TRIED: set[tuple[str, int]] = set()


async def backfill_thumbnails(media_ids: list[int] | None = None, clip_ids: list[int] | None = None) -> None:
    """Gera miniatura do que foi criado antes de elas existirem."""
    async with _session() as db:
        for mid in media_ids or []:
            if ("media", mid) in _THUMB_TRIED:
                continue
            _THUMB_TRIED.add(("media", mid))
            asset = await db.get(MediaAsset, mid)
            if asset and asset.kind == "video" and not asset.thumb_key:
                asset.thumb_key = await _store_thumbnail(
                    media_storage.presign_get(asset.r2_key), _thumb_key_for(asset), _frame_at(asset.duration_s),
                    THUMB_MEDIA_W,
                )
                await db.commit()
        for cid in clip_ids or []:
            if ("clip", cid) in _THUMB_TRIED:
                continue
            _THUMB_TRIED.add(("clip", cid))
            clip = await db.get(MediaClip, cid)
            if clip and clip.r2_key and not clip.thumb_key:
                clip.thumb_key = await _store_thumbnail(
                    media_storage.presign_get(clip.r2_key), f"clips/{clip.user_id}/{clip.media_id}/{uuid.uuid4().hex}.jpg",
                    min(1.0, (clip.end_s - clip.start_s) / 2), THUMB_CLIP_W,
                )
                await db.commit()


# ── Clipper: highlights + render (#29) ───────────────────────────────────────

def _clip_out(c: MediaClip) -> ClipOut:
    url = media_storage.presign_get(c.r2_key) if c.status == "ready" and c.r2_key else None
    return ClipOut(
        id=c.id, rank=c.rank, start_s=c.start_s, end_s=c.end_s, title=c.title, reason=c.reason,
        status=c.status, error=c.error, size_bytes=c.size_bytes, download_url=url, updated_at=_updated_at(c),
        thumbnail_url=_thumb_url(c.thumb_key),
    )


async def _clips_of(db: AsyncSession, asset_id: int) -> list[MediaClip]:
    return list((await db.execute(
        select(MediaClip).where(MediaClip.media_id == asset_id).order_by(MediaClip.rank)
    )).scalars().all())


@router.get("/{asset_id}/clips", response_model=list[ClipOut])
async def list_clips(
    asset_id: int,
    background: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    asset = await _owned(db, authorization, asset_id)
    clips = await _clips_of(db, asset.id)
    missing = [c.id for c in clips if c.status == "ready" and c.r2_key and not c.thumb_key]
    if missing:
        background.add_task(backfill_thumbnails, clip_ids=missing)
    try:
        return [_clip_out(c) for c in clips]
    except media_storage.StorageNotConfigured as exc:
        raise HTTPException(503, str(exc))


@router.patch("/{asset_id}/clips/{clip_id}", response_model=ClipOut)
async def rename_clip(
    asset_id: int,
    clip_id: int,
    body: TitleUpdate,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    """O título é só texto (o vídeo renderizado não o traz queimado), então renomear não re-renderiza nada."""
    asset = await _owned(db, authorization, asset_id)
    clip = (await db.execute(
        select(MediaClip).where(MediaClip.id == clip_id, MediaClip.media_id == asset.id)
    )).scalars().first()
    if not clip:
        raise HTTPException(404, "clip not found")
    clip.title = _clean_title(body.title)
    await db.commit()
    try:
        return _clip_out(clip)
    except media_storage.StorageNotConfigured as exc:
        raise HTTPException(503, str(exc))


@router.delete("/{asset_id}/clips/{clip_id}", response_model=list[ClipOut])
async def delete_clip(
    asset_id: int,
    clip_id: int,
    background: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    """Apaga um corte (banco e bucket) e devolve os que sobraram, já renumerados: sem isso a lista mostraria
    "#1 e #3". Os outros cortes continuam, e se era o último o app volta à escolha de layout para gerar de novo."""
    asset = await _owned(db, authorization, asset_id)
    clip = (await db.execute(
        select(MediaClip).where(MediaClip.id == clip_id, MediaClip.media_id == asset.id)
    )).scalars().first()
    if not clip:
        raise HTTPException(404, "clip not found")
    keys = [k for k in (clip.r2_key, clip.thumb_key) if k]
    await db.delete(clip)
    await db.flush()
    remaining = await _clips_of(db, asset.id)
    for rank, c in enumerate(remaining, 1):
        c.rank = rank
    await db.commit()
    background.add_task(_delete_objects, keys)
    try:
        return [_clip_out(c) for c in remaining]
    except media_storage.StorageNotConfigured as exc:
        raise HTTPException(503, str(exc))


@router.post("/{asset_id}/clips", response_model=list[ClipOut])
async def create_clips(
    asset_id: int,
    background: BackgroundTasks,
    regenerate: bool = False,
    layout: str = "crop",
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    """Escolhe os highlights na hora (a lista volta já com títulos) e renderiza em background.
    Cada chamada custa uma ida ao Claude: se já há cortes, exige `regenerate=true`.
    `layout=crop` (padrão, quem fala para a câmera) | `fit` (gravação de tela/gráficos: vídeo inteiro sobre fundo desfocado)."""
    if layout not in clipper.LAYOUTS:
        raise HTTPException(422, f"layout must be one of {', '.join(clipper.LAYOUTS)}")
    asset = await _owned(db, authorization, asset_id)
    if asset.kind != "video":
        raise HTTPException(422, "clips need a video, not audio")
    if asset.status != "transcribed":
        raise HTTPException(409, f"media is {asset.status}; transcribe it first")

    existing = await _clips_of(db, asset.id)
    now = datetime.utcnow()
    if any(c.status in ("pending", "rendering") and now - c.updated_at <= STALE_TRANSCRIBING for c in existing):
        raise HTTPException(409, "clips are still rendering")
    if existing and not regenerate:
        raise HTTPException(409, "clips already exist; pass regenerate=true to redo them")

    row = (await db.execute(select(MediaTranscript).where(MediaTranscript.media_id == asset.id))).scalars().first()
    segments = json.loads(row.segments_json) if row else []
    if not segments:
        raise HTTPException(422, "transcript is empty (no speech detected)")

    try:
        # ponytail: seleção síncrona (~5-20 s) para a resposta já trazer os títulos; se o app
        # passar a estourar timeout, mover para background com um status em MediaAsset.
        picks = await clipper.pick_highlights(segments)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    except Exception:
        logger.exception("highlight selection failed for media %s", asset_id)
        raise HTTPException(502, "highlight detection failed, try again")
    if not picks:
        raise HTTPException(422, "no usable highlights found in this video")

    old_keys = [k for c in existing for k in (c.r2_key, c.thumb_key) if k]
    await db.execute(delete(MediaClip).where(MediaClip.media_id == asset.id))
    clips = [
        MediaClip(user_id=asset.user_id, media_id=asset.id, rank=i, start_s=h.start, end_s=h.end,
                  title=h.title, reason=h.reason, status="pending")
        for i, h in enumerate(picks, 1)
    ]
    db.add_all(clips)
    await db.commit()
    background.add_task(render_clips, asset.id, old_keys, layout)
    try:
        return [_clip_out(c) for c in clips]
    except media_storage.StorageNotConfigured as exc:
        raise HTTPException(503, str(exc))


async def render_clips(asset_id: int, old_keys: list[str] | None = None, layout: str = "crop") -> None:
    """Um corte por vez (ffmpeg 1080x1920 é pesado); cada corte tem o próprio status."""
    for key in old_keys or []:
        try:
            await media_storage.delete_object(key)
        except Exception:
            logger.warning("could not delete old clip object %s", key)
    async with _session() as db:
        asset = await db.get(MediaAsset, asset_id)
        if not asset:
            return
        segments = json.loads(
            (await db.execute(select(MediaTranscript).where(MediaTranscript.media_id == asset_id))).scalars().one().segments_json
        )
        for clip in await _clips_of(db, asset_id):
            if not await _exists(db, MediaClip, clip.id):
                continue  # corte (ou o vídeo todo) apagado enquanto os outros renderizavam
            clip.status = "rendering"
            try:
                await db.commit()
            except StaleDataError:
                await db.rollback()
                continue
            uploaded: list[str] = []  # o que este corte subiu ao bucket: se ele sumiu no meio, é lixo a apagar
            try:
                with tempfile.TemporaryDirectory() as tmp:
                    ass, out = os.path.join(tmp, "subs.ass"), os.path.join(tmp, "clip.mp4")
                    with open(ass, "w", encoding="utf-8") as f:
                        f.write(clipper.build_ass(segments, clip.start_s, clip.end_s))
                    await clipper.render_clip(media_storage.presign_get(asset.r2_key), ass, clip.start_s, clip.end_s, out, layout)
                    key = f"clips/{asset.user_id}/{asset.id}/{uuid.uuid4().hex}.mp4"
                    await media_storage.upload_file(out, key, "video/mp4")
                    uploaded.append(key)
                    clip.r2_key, clip.size_bytes = key, os.path.getsize(out)
                    clip.thumb_key = await _store_thumbnail(
                        out, f"clips/{asset.user_id}/{asset.id}/{uuid.uuid4().hex}.jpg",
                        min(1.0, (clip.end_s - clip.start_s) / 2), THUMB_CLIP_W,
                    )
                    if clip.thumb_key:
                        uploaded.append(clip.thumb_key)
                clip.status, clip.error = "ready", None
            except Exception as exc:
                logger.exception("clip render failed for clip %s", clip.id)
                clip.status, clip.error = "failed", str(exc)[:500]
            if not await _exists(db, MediaClip, clip.id):
                # apagado durante o render: o que ele subiu ao bucket não tem mais dono
                await _delete_objects(uploaded)
                continue
            try:
                await db.commit()
            except (StaleDataError, IntegrityError):  # sumiu entre a checagem e o commit
                await db.rollback()
                await _delete_objects(uploaded)
