"""
synthetic_creator_routes.py — personas sintéticas e seus vídeos falados (server/synthetic_creators.py).

    GET  /v1/creators/catalog            → vozes, faixas de qualidade, preços, durações, endereço de pagamento
    POST /v1/creators                    → cria a persona e devolve URL pré-assinada para a foto de referência
    POST /v1/creators/{id}/complete      → confere a foto no bucket; persona fica `ready`
    GET  /v1/creators                    → personas do usuário
    DELETE /v1/creators/{id}
    POST /v1/creators/script             → Xiaolee escreve o roteiro a partir de um tema
    POST /v1/creators/{id}/videos        → paga (EIP-3009 assinado no app) e dispara a geração
    POST /v1/creators/motion             → URL pré-assinada para o vídeo de movimento do mimic
    GET  /v1/creators/videos[/{id}]      → vídeos com status e URL quando prontos

Pagamento: o app assina `transferWithAuthorization` do preço exato para CREATORS_PAY_TO; a rota confere
destino e valor, grava o vídeo (`paying`, nonce único) e só depois faz o relay. Só então gasta na fal.
O dono vem SEMPRE do Bearer emitido pelo backend (strict), nunca de URL/corpo.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database import database as _dbmod
from database.database import get_db_session
from database.models import ArcTransfer, CreatorVideo, SyntheticCreator
from database.repository import to_utc_iso
from server import media_storage, synthetic_creators as sc
from server.campaigns_routes import _resolve_user
from server.settings import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/creators", tags=["creators"])

IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp")
MAX_IMAGE_BYTES = 15 * 1024 * 1024
_EVM_ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_NONCE_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")


class CreatorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    voice_id: str
    content_type: str
    size_bytes: int = Field(gt=0)
    # Termo aceito no app: a imagem é do creator, ou é paródia/fan content, e não será usada para enganar ou assediar.
    rights_confirmed: bool = False


class CreatorOut(BaseModel):
    id: int
    name: str
    voice_id: str
    status: str
    image_url: Optional[str] = None
    created_at: Optional[str] = None


class CreatorUpload(BaseModel):
    creator: CreatorOut
    upload_url: str
    upload_headers: dict[str, str]


class ScriptIn(BaseModel):
    topic: str = Field(min_length=3, max_length=500)
    duration_s: int
    creator_id: int


class Payment(BaseModel):
    from_address: str
    to_address: str
    value: int
    valid_after: int
    valid_before: int
    nonce: str
    signature: str


class MotionCreate(BaseModel):
    content_type: str
    size_bytes: int = Field(gt=0)


class MotionUpload(BaseModel):
    motion_key: str
    upload_url: str
    upload_headers: dict[str, str]


class VideoCreate(BaseModel):
    quality: str
    duration_s: int
    # speech: o roteiro falado (obrigatório). mimic: descrição opcional da cena.
    script: str = Field(default="", max_length=2000)
    payment: Payment
    # mimic: vídeo de movimento (de POST /motion) e o termo de que o usuário tem o direito de usá-lo.
    motion_key: Optional[str] = None
    motion_rights_confirmed: bool = False
    # mimic: sem som, som do vídeo de referência ou narração (`script`) com a voz da persona.
    audio: Literal["none", "original", "voice"] = "none"


class VideoOut(BaseModel):
    id: int
    creator_id: int
    quality: str
    duration_s: int
    script: str
    price_usdc: float
    status: str
    error: Optional[str] = None
    refund_due: bool = False
    payment_tx: Optional[str] = None
    video_url: Optional[str] = None
    audio: str = "none"
    created_at: Optional[str] = None


def _require_enabled() -> None:
    if not sc.enabled():
        raise HTTPException(503, "AI Creators aren't available right now.")


def _creator_out(c: SyntheticCreator) -> CreatorOut:
    url = None
    if c.status == "ready":
        try:
            url = media_storage.presign_get(c.ref_image_key)
        except media_storage.StorageNotConfigured:
            pass
    return CreatorOut(id=c.id, name=c.name, voice_id=c.voice_id, status=c.status, image_url=url,
                      created_at=to_utc_iso(c.created_at))


def _video_out(v: CreatorVideo) -> VideoOut:
    url = None
    if v.status == "done" and v.video_key:
        try:
            url = media_storage.presign_get(v.video_key)
        except media_storage.StorageNotConfigured:
            pass
    return VideoOut(id=v.id, creator_id=v.creator_id, quality=v.quality, duration_s=v.duration_s, script=v.script,
                    price_usdc=float(v.price_usdc), status=v.status, error=v.error, refund_due=v.refund_due,
                    payment_tx=v.payment_tx, video_url=url, audio=v.audio,
                    created_at=to_utc_iso(v.created_at))


async def _owned_creator(db: AsyncSession, user_id: int, creator_id: int) -> SyntheticCreator:
    c = (await db.execute(select(SyntheticCreator).where(
        SyntheticCreator.id == creator_id, SyntheticCreator.user_id == user_id))).scalars().first()
    if not c:
        raise HTTPException(404, "Character not found.")
    return c


@router.get("/catalog")
async def catalog():
    return {
        "enabled": sc.enabled(),
        "voices": sc.VOICES,
        "qualities": sc.pricing(),
        "durations_s": list(sc.DURATIONS_S),
        "words_per_s": sc.WORDS_PER_S,
        "pay_to": settings.creators_pay_to or None,
    }


@router.post("", response_model=CreatorUpload)
async def create_creator(body: CreatorCreate, authorization: Optional[str] = Header(default=None),
                         db: AsyncSession = Depends(get_db_session)):
    _require_enabled()
    if body.voice_id not in sc.VOICE_IDS:
        raise HTTPException(422, "Pick a voice from the list.")
    if body.content_type not in IMAGE_TYPES:
        raise HTTPException(422, "Use a JPEG, PNG or WebP image.")
    if body.size_bytes > MAX_IMAGE_BYTES:
        raise HTTPException(413, "That image is too large. The limit is 15 MB.")
    if not body.rights_confirmed:
        raise HTTPException(422, "Confirm you have the right to use this image.")
    user = await _resolve_user(db, authorization, strict=True)
    key = f"creators/{user.id}/{uuid.uuid4().hex}/ref{sc._ext(body.content_type)}"
    try:
        url = media_storage.presign_put(key, body.content_type, body.size_bytes)
    except media_storage.StorageNotConfigured as exc:
        raise HTTPException(503, "Uploads are unavailable right now. Try again later.")
    c = SyntheticCreator(user_id=user.id, name=body.name.strip(), voice_id=body.voice_id, ref_image_key=key,
                         ref_content_type=body.content_type, status="pending", rights_confirmed_at=datetime.utcnow())
    db.add(c)
    await db.commit()
    return CreatorUpload(creator=_creator_out(c), upload_url=url, upload_headers={"Content-Type": body.content_type})


@router.post("/{creator_id}/complete", response_model=CreatorOut)
async def complete_creator(creator_id: int, authorization: Optional[str] = Header(default=None),
                           db: AsyncSession = Depends(get_db_session)):
    user = await _resolve_user(db, authorization, strict=True)
    c = await _owned_creator(db, user.id, creator_id)
    try:
        size = await media_storage.object_size(c.ref_image_key)
    except media_storage.StorageNotConfigured as exc:
        raise HTTPException(503, "Uploads are unavailable right now. Try again later.")
    if size is None:
        raise HTTPException(409, "The photo didn't finish uploading. Try again.")
    c.status = "ready"
    await db.commit()
    return _creator_out(c)


@router.get("", response_model=list[CreatorOut])
async def list_creators(authorization: Optional[str] = Header(default=None),
                        db: AsyncSession = Depends(get_db_session)):
    user = await _resolve_user(db, authorization, strict=True)
    rows = (await db.execute(select(SyntheticCreator).where(
        SyntheticCreator.user_id == user.id, SyntheticCreator.status == "ready",
    ).order_by(SyntheticCreator.id.desc()))).scalars().all()
    return [_creator_out(c) for c in rows]


@router.delete("/{creator_id}", status_code=204)
async def delete_creator(creator_id: int, authorization: Optional[str] = Header(default=None),
                         db: AsyncSession = Depends(get_db_session)):
    user = await _resolve_user(db, authorization, strict=True)
    c = await _owned_creator(db, user.id, creator_id)
    # Persona some da lista; vídeos e foto ficam (vídeos pagos continuam acessíveis).
    c.status = "deleted"
    await db.commit()


@router.post("/motion", response_model=MotionUpload)
async def create_motion_upload(body: MotionCreate, authorization: Optional[str] = Header(default=None),
                               db: AsyncSession = Depends(get_db_session)):
    _require_enabled()
    if body.content_type not in sc.MOTION_TYPES:
        raise HTTPException(422, "Use an MP4, MOV or WebM video.")
    if body.size_bytes > sc.MAX_MOTION_BYTES:
        raise HTTPException(413, "That video is too large. The limit is 100 MB.")
    user = await _resolve_user(db, authorization, strict=True)
    key = f"creators/{user.id}/motion/{uuid.uuid4().hex}"
    try:
        url = media_storage.presign_put(key, body.content_type, body.size_bytes)
    except media_storage.StorageNotConfigured as exc:
        raise HTTPException(503, "Uploads are unavailable right now. Try again later.")
    return MotionUpload(motion_key=key, upload_url=url, upload_headers={"Content-Type": body.content_type})


@router.post("/script")
async def script(body: ScriptIn, authorization: Optional[str] = Header(default=None),
                 db: AsyncSession = Depends(get_db_session)):
    if body.duration_s not in sc.DURATIONS_S:
        raise HTTPException(422, f"duration_s must be one of {list(sc.DURATIONS_S)}")
    user = await _resolve_user(db, authorization, strict=True)
    c = await _owned_creator(db, user.id, body.creator_id)
    if not settings.anthropic_api_key:
        raise HTTPException(503, "Xiaolee can't write scripts right now. Write it yourself.")
    try:
        text = await sc.write_script(body.topic, body.duration_s, c.name)
    except Exception as exc:
        logger.warning("creator script failed: %s", type(exc).__name__)
        raise HTTPException(503, "Xiaolee couldn't write the script right now. Try again, or write it yourself.")
    return {"script": text, "max_words": sc.max_words(body.duration_s)}


@router.post("/{creator_id}/videos", response_model=VideoOut)
async def create_video(creator_id: int, body: VideoCreate, background: BackgroundTasks,
                       authorization: Optional[str] = Header(default=None),
                       db: AsyncSession = Depends(get_db_session)):
    _require_enabled()
    if body.quality not in sc.QUALITIES:
        raise HTTPException(422, "unknown quality")
    if body.duration_s not in sc.DURATIONS_S:
        raise HTTPException(422, f"duration_s must be one of {list(sc.DURATIONS_S)}")
    mimic = sc.kind(body.quality) == "mimic"
    # Fala (speech, ou mimic com voz): o roteiro cabe nas palavras da duração paga. Mimic sem voz: `script` é só
    # a descrição da cena, um texto curto.
    narrated = not mimic or body.audio == "voice"
    script_text = sc.clip_words(body.script.strip(), body.duration_s) if narrated else body.script.strip()[:300]
    if not script_text and narrated:
        raise HTTPException(422, "Write what your character says first.")

    user = await _resolve_user(db, authorization, strict=True)
    c = await _owned_creator(db, user.id, creator_id)
    if c.status != "ready":
        raise HTTPException(409, "This character isn't ready yet.")
    if mimic:
        await _check_motion(user.id, body)

    p = body.payment
    price = sc.price_usdc(body.quality, body.duration_s)
    if not (_EVM_ADDR_RE.match(p.from_address) and _EVM_ADDR_RE.match(p.to_address) and _NONCE_RE.match(p.nonce)):
        raise HTTPException(422, "malformed payment")
    if p.to_address.lower() != settings.creators_pay_to.lower():
        raise HTTPException(422, "payment must go to the creators pay-to address")
    if p.value != round(price * 1_000_000):
        raise HTTPException(422, f"payment value must be exactly {price} USDC")

    since = datetime.utcnow() - timedelta(days=1)
    today = (await db.execute(select(func.count()).select_from(CreatorVideo).where(
        CreatorVideo.user_id == user.id, CreatorVideo.created_at >= since,
        CreatorVideo.status != "failed"))).scalar_one()
    if today >= settings.creators_daily_videos_per_user:
        raise HTTPException(429, "You've reached today's video limit. Try again tomorrow.")

    # Intent log antes do relay: nonce único barra o mesmo pagamento duas vezes.
    v = CreatorVideo(user_id=user.id, creator_id=c.id, quality=body.quality, model=sc.QUALITIES[body.quality]["model"],
                     duration_s=body.duration_s, script=script_text, price_usdc=price,
                     payment_from=p.from_address.lower(), payment_nonce=p.nonce.lower(), status="paying",
                     motion_key=body.motion_key if mimic else None, audio=body.audio if mimic else "none",
                     motion_rights_at=datetime.utcnow() if mimic else None)
    db.add(v)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "That payment was already used. Try again.")

    from server.routes.arc_routes import _arc_native
    try:
        result = await _arc_native().relay_transfer_authorization(
            from_address=p.from_address, to_address=p.to_address, value=p.value,
            valid_after=p.valid_after, valid_before=p.valid_before, nonce=p.nonce, signature=p.signature,
        )
    except Exception as exc:
        logger.warning("creator video payment relay failed: %s", exc)
        v.status, v.error = "failed", "payment failed"
        await db.commit()
        raise HTTPException(402, "The payment didn't go through. Check your USDC balance and try again.")

    v.payment_tx, v.status = result.tx_hash, "queued"
    db.add(ArcTransfer(from_address=p.from_address.lower(), to_address=p.to_address.lower(),
                       amount_usdc=price, tx_hash=result.tx_hash))
    await db.commit()
    background.add_task(run_video, v.id)
    return _video_out(v)


async def _check_motion(user_id: int, body: VideoCreate) -> None:
    """Tudo que dá para conferir do vídeo de movimento ANTES de cobrar: termo, dono, existência e duração."""
    if not body.motion_rights_confirmed:
        raise HTTPException(422, "Confirm you have the right to use this video.")
    key = body.motion_key or ""
    if not key.startswith(f"creators/{user_id}/motion/") or ".." in key:
        raise HTTPException(422, "We couldn't find that video. Choose it again.")
    try:
        if await media_storage.object_size(key) is None:
            raise HTTPException(409, "The video didn't finish uploading. Try again.")
        length = await sc.probe_duration(media_storage.presign_get(key))
    except media_storage.StorageNotConfigured as exc:
        raise HTTPException(503, "Uploads are unavailable right now. Try again later.")
    except ValueError:
        raise HTTPException(422, "We couldn't read that video. Try another file.")
    if length < body.duration_s - 0.5:
        raise HTTPException(422, f"Your video is {length:.0f}s long, shorter than the {body.duration_s}s you chose. Pick a longer video or a shorter length.")


@router.get("/videos", response_model=list[VideoOut])
async def list_videos(creator_id: Optional[int] = None, authorization: Optional[str] = Header(default=None),
                      db: AsyncSession = Depends(get_db_session)):
    user = await _resolve_user(db, authorization, strict=True)
    q = select(CreatorVideo).where(CreatorVideo.user_id == user.id)
    if creator_id is not None:
        q = q.where(CreatorVideo.creator_id == creator_id)
    rows = (await db.execute(q.order_by(CreatorVideo.id.desc()).limit(50))).scalars().all()
    return [_video_out(v) for v in rows]


@router.get("/videos/{video_id}", response_model=VideoOut)
async def get_video(video_id: int, authorization: Optional[str] = Header(default=None),
                    db: AsyncSession = Depends(get_db_session)):
    user = await _resolve_user(db, authorization, strict=True)
    v = (await db.execute(select(CreatorVideo).where(
        CreatorVideo.id == video_id, CreatorVideo.user_id == user.id))).scalars().first()
    if not v:
        raise HTTPException(404, "Video not found.")
    return _video_out(v)


def _failure_message(quality: str) -> str:
    if quality == "pro_seedance":
        # A fal recusa no Seedance pessoa real e personagem com direitos; regra do provedor, não contornamos.
        return "Pro+ doesn't accept real people or known characters. Try Standard or Pro. Your payment will be refunded."
    if sc.kind(quality) == "mimic":
        return ("We couldn't make this video. It works best with one person in full view in the video, and a clear "
                "full-body character photo. Your payment will be refunded.")
    return "We couldn't make this video. Your payment will be refunded."


async def run_video(video_id: int) -> None:
    # ponytail: tarefa em processo (workers=1 no Railway); restart no meio deixa o vídeo parado em
    # voice/video com refund_due para reembolso manual. Fila Redis quando houver >1 worker.
    async with _dbmod.SessionLocal() as db:
        v = await db.get(CreatorVideo, video_id)
        c = await db.get(SyntheticCreator, v.creator_id)

        async def on_step(name: str) -> None:
            v.status = name
            await db.commit()

        key = f"creators/{v.user_id}/videos/{v.id}-{uuid.uuid4().hex[:8]}.mp4"
        try:
            if sc.kind(v.quality) == "mimic":
                await sc.render_mimic(quality=v.quality, prompt="" if v.audio == "voice" else v.script, duration_s=v.duration_s,
                                      ref_image_key=c.ref_image_key, ref_content_type=c.ref_content_type,
                                      motion_key=v.motion_key, video_key=key, audio=v.audio, voice_id=c.voice_id,
                                      script=v.script, on_step=on_step)
            else:
                await sc.render(quality=v.quality, voice_id=c.voice_id, script=v.script, duration_s=v.duration_s,
                                ref_image_key=c.ref_image_key, ref_content_type=c.ref_content_type, video_key=key,
                                on_step=on_step)
        except Exception as exc:
            logger.warning("creator video %s failed: %s: %s", v.id, type(exc).__name__, exc)
            # Já pago: marca para reembolso manual em vez de sumir com o dinheiro.
            v.status, v.error, v.refund_due = "failed", _failure_message(v.quality), True
            await db.commit()
            return
        v.status, v.video_key = "done", key
        await db.commit()
