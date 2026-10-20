"""
synthetic_creator_routes.py — personas sintéticas e seus vídeos falados (server/synthetic_creators.py).

    GET  /v1/creators/catalog            → vozes, faixas de qualidade, preços, durações, endereço de pagamento
    POST /v1/creators                    → cria a persona e devolve URL pré-assinada para a foto de referência
    POST /v1/creators/{id}/complete      → confere a foto no bucket; persona fica `ready`
    GET  /v1/creators                    → personas do usuário
    DELETE /v1/creators/{id}
    POST /v1/creators/script             → Xiaolee escreve o roteiro a partir de um tema
    POST /v1/creators/{id}/videos        → paga (EIP-3009 assinado no app) e dispara a geração
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
from typing import Optional

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


class VideoCreate(BaseModel):
    quality: str
    duration_s: int
    script: str = Field(min_length=1, max_length=2000)
    payment: Payment


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
    created_at: Optional[str] = None


def _require_enabled() -> None:
    if not sc.enabled():
        raise HTTPException(503, "synthetic creators are not configured")


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
                    payment_tx=v.payment_tx, video_url=url, created_at=to_utc_iso(v.created_at))


async def _owned_creator(db: AsyncSession, user_id: int, creator_id: int) -> SyntheticCreator:
    c = (await db.execute(select(SyntheticCreator).where(
        SyntheticCreator.id == creator_id, SyntheticCreator.user_id == user_id))).scalars().first()
    if not c:
        raise HTTPException(404, "creator not found")
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
        raise HTTPException(422, "unknown voice")
    if body.content_type not in IMAGE_TYPES:
        raise HTTPException(422, "reference must be a JPEG, PNG or WebP image")
    if body.size_bytes > MAX_IMAGE_BYTES:
        raise HTTPException(413, "image too large (max 15 MB)")
    user = await _resolve_user(db, authorization, strict=True)
    key = f"creators/{user.id}/{uuid.uuid4().hex}/ref{sc._ext(body.content_type)}"
    try:
        url = media_storage.presign_put(key, body.content_type, body.size_bytes)
    except media_storage.StorageNotConfigured as exc:
        raise HTTPException(503, f"storage unavailable: {exc}")
    c = SyntheticCreator(user_id=user.id, name=body.name.strip(), voice_id=body.voice_id, ref_image_key=key,
                         ref_content_type=body.content_type, status="pending")
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
        raise HTTPException(503, f"storage unavailable: {exc}")
    if size is None:
        raise HTTPException(409, "reference image not uploaded")
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


@router.post("/script")
async def script(body: ScriptIn, authorization: Optional[str] = Header(default=None),
                 db: AsyncSession = Depends(get_db_session)):
    if body.duration_s not in sc.DURATIONS_S:
        raise HTTPException(422, f"duration_s must be one of {list(sc.DURATIONS_S)}")
    user = await _resolve_user(db, authorization, strict=True)
    c = await _owned_creator(db, user.id, body.creator_id)
    if not settings.anthropic_api_key:
        raise HTTPException(503, "script writer is not configured")
    try:
        text = await sc.write_script(body.topic, body.duration_s, c.name)
    except Exception as exc:
        logger.warning("creator script failed: %s", type(exc).__name__)
        raise HTTPException(503, "script writer temporarily unavailable")
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
    script_text = sc.clip_words(body.script.strip(), body.duration_s)
    if not script_text:
        raise HTTPException(422, "script is empty")

    user = await _resolve_user(db, authorization, strict=True)
    c = await _owned_creator(db, user.id, creator_id)
    if c.status != "ready":
        raise HTTPException(409, "creator is not ready")

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
        raise HTTPException(429, "daily video limit reached")

    # Intent log antes do relay: nonce único barra o mesmo pagamento duas vezes.
    v = CreatorVideo(user_id=user.id, creator_id=c.id, quality=body.quality, model=sc.QUALITIES[body.quality]["model"],
                     duration_s=body.duration_s, script=script_text, price_usdc=price,
                     payment_from=p.from_address.lower(), payment_nonce=p.nonce.lower(), status="paying")
    db.add(v)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "payment already used")

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
        raise HTTPException(402, f"payment failed: {exc}")

    v.payment_tx, v.status = result.tx_hash, "queued"
    db.add(ArcTransfer(from_address=p.from_address.lower(), to_address=p.to_address.lower(),
                       amount_usdc=price, tx_hash=result.tx_hash))
    await db.commit()
    background.add_task(run_video, v.id)
    return _video_out(v)


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
        raise HTTPException(404, "video not found")
    return _video_out(v)


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
            await sc.render(quality=v.quality, voice_id=c.voice_id, script=v.script, duration_s=v.duration_s,
                            ref_image_key=c.ref_image_key, ref_content_type=c.ref_content_type, video_key=key,
                            on_step=on_step)
        except Exception as exc:
            logger.warning("creator video %s failed: %s: %s", v.id, type(exc).__name__, exc)
            # Já pago: marca para reembolso manual em vez de sumir com o dinheiro.
            v.status, v.error, v.refund_due = "failed", "generation failed", True
            await db.commit()
            return
        v.status, v.video_key = "done", key
        await db.commit()
