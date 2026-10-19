"""
social_routes.py — contas sociais do creator + publicar/medir pela Xiaolee.

    GET    /v1/social/accounts                → contas conectadas (sem credenciais)
    POST   /v1/social/accounts/{platform}     → conecta (valida na rede e guarda cifrado)
    DELETE /v1/social/accounts/{platform}     → desconecta e apaga o token
    POST   /v1/social/publish                 → posta texto (+ corte pronto) na rede
    GET    /v1/social/publications            → posts feitos
    POST   /v1/social/publications/{id}/metrics → atualiza e devolve as métricas

Atrás de SOCIAL_TOOLS_ENABLED (desligado = 404). O dono vem SEMPRE do Bearer (strict). A linha
`post_publications` nasce `pending` antes de chamar a rede (intent log) e termina `published` ou `failed`.
"""

from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import ENCRYPTION_KEY
from database.database import get_db_session
from database.models import MediaClip, PostPublication, SocialAccount
from database.repository import to_utc_iso
from server import media_storage
from server.campaigns_routes import _resolve_user
from server.settings import settings
from server.social_adapters import ADAPTERS, SocialError, XAdapter
from user_management.encryption_service import EncryptionService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/social", tags=["social"])
_crypto = EncryptionService(ENCRYPTION_KEY)


X_PENDING = "x_pending"  # login do X em andamento: {state, verifier} cifrados; some no callback


def _enabled() -> None:
    if not settings.social_tools_enabled:
        raise HTTPException(status_code=404, detail="Not found")


def _adapter(platform: str):
    a = ADAPTERS.get(platform)
    if not a:
        raise HTTPException(status_code=422, detail=f"Unsupported platform. Use one of: {', '.join(ADAPTERS)}")
    return a


def _account_out(a: SocialAccount) -> dict:
    return {"platform": a.platform, "handle": a.handle, "status": a.status, "connected_at": to_utc_iso(a.created_at)}


def _pub_out(p: PostPublication) -> dict:
    return {
        "id": p.id, "platform": p.platform, "clip_id": p.clip_id, "caption": p.caption, "status": p.status,
        "error": p.error, "url": p.url, "published_at": to_utc_iso(p.published_at) if p.published_at else None,
        "metrics": json.loads(p.metrics_json) if p.metrics_json else None,
        "metrics_at": to_utc_iso(p.metrics_at) if p.metrics_at else None,
    }


class ConnectBody(BaseModel):
    credentials: dict = Field(default_factory=dict)


class PublishBody(BaseModel):
    platform: str
    text: str = Field(min_length=1, max_length=4000)
    clip_id: Optional[int] = None


async def _account(db: AsyncSession, user_id: int, platform: str) -> Optional[SocialAccount]:
    return (await db.execute(
        select(SocialAccount).where(SocialAccount.user_id == user_id, SocialAccount.platform == platform)
    )).scalars().first()


@router.get("/accounts")
async def list_accounts(authorization: Optional[str] = Header(None), db: AsyncSession = Depends(get_db_session)):
    _enabled()
    user = await _resolve_user(db, authorization, strict=True)
    rows = (await db.execute(select(SocialAccount).where(
        SocialAccount.user_id == user.id, SocialAccount.platform != X_PENDING))).scalars().all()
    # `hints`: o que a tela precisa mostrar para o creator conectar (bot que ele adiciona como admin do canal).
    return {"accounts": [_account_out(a) for a in rows], "available": list(ADAPTERS),
            "hints": {"telegram_bot": settings.telegram_bot_name}}


@router.post("/accounts/{platform}")
async def connect_account(platform: str, body: ConnectBody, authorization: Optional[str] = Header(None),
                          db: AsyncSession = Depends(get_db_session)):
    _enabled()
    user = await _resolve_user(db, authorization, strict=True)
    adapter = _adapter(platform)
    try:
        external_id, handle, stored = await adapter.connect(body.credentials)
    except SocialError as e:
        raise HTTPException(status_code=400, detail=str(e))
    enc = _crypto.encrypt(json.dumps(stored))
    acc = await _account(db, user.id, platform)
    if acc:  # reconectar troca a credencial
        acc.external_id, acc.handle, acc.credentials_enc, acc.status = external_id, handle, enc, "active"
    else:
        acc = SocialAccount(user_id=user.id, platform=platform, external_id=external_id, handle=handle,
                            credentials_enc=enc, status="active")
        db.add(acc)
    await db.commit()
    await db.refresh(acc)
    return _account_out(acc)


class XCallbackBody(BaseModel):
    code: str = Field(min_length=1, max_length=2048)
    state: str = Field(min_length=1, max_length=256)


@router.post("/x/start")
async def x_start(authorization: Optional[str] = Header(None), db: AsyncSession = Depends(get_db_session)):
    """Começa o login do X: guarda state+verifier PKCE (cifrados) e devolve a URL para o app abrir."""
    _enabled()
    user = await _resolve_user(db, authorization, strict=True)
    verifier, challenge = XAdapter.new_pkce()
    state = secrets.token_urlsafe(24)
    try:
        url = XAdapter.authorize_url(state, challenge)
    except SocialError as e:
        raise HTTPException(status_code=503, detail=str(e))
    enc = _crypto.encrypt(json.dumps({"state": state, "verifier": verifier}))
    row = await _account(db, user.id, X_PENDING)
    if row:
        row.credentials_enc = enc
    else:
        db.add(SocialAccount(user_id=user.id, platform=X_PENDING, external_id="", handle="", credentials_enc=enc, status="pending"))
    await db.commit()
    return {"authorize_url": url}


@router.post("/x/callback")
async def x_callback(body: XCallbackBody, authorization: Optional[str] = Header(None),
                     db: AsyncSession = Depends(get_db_session)):
    """O app devolve o `code`/`state` do redirect; troca por tokens (PKCE) e conecta a conta."""
    _enabled()
    user = await _resolve_user(db, authorization, strict=True)
    pending = await _account(db, user.id, X_PENDING)
    pend = json.loads(_crypto.decrypt(pending.credentials_enc)) if pending else {}
    if not pend or not secrets.compare_digest(pend["state"], body.state):
        raise HTTPException(status_code=400, detail="Login expired, try connecting X again")
    await db.delete(pending)  # uso único: um code/state só vale uma vez
    try:
        external_id, handle, stored = await _adapter("x").exchange(body.code, pend["verifier"])
    except SocialError as e:
        await db.commit()
        raise HTTPException(status_code=400, detail=str(e))
    enc = _crypto.encrypt(json.dumps(stored))
    acc = await _account(db, user.id, "x")
    if acc:
        acc.external_id, acc.handle, acc.credentials_enc, acc.status = external_id, handle, enc, "active"
    else:
        acc = SocialAccount(user_id=user.id, platform="x", external_id=external_id, handle=handle, credentials_enc=enc, status="active")
        db.add(acc)
    await db.commit()
    await db.refresh(acc)
    return _account_out(acc)


@router.delete("/accounts/{platform}")
async def disconnect_account(platform: str, authorization: Optional[str] = Header(None),
                             db: AsyncSession = Depends(get_db_session)):
    _enabled()
    user = await _resolve_user(db, authorization, strict=True)
    _adapter(platform)
    await db.execute(delete(SocialAccount).where(SocialAccount.user_id == user.id, SocialAccount.platform == platform))
    await db.commit()
    return {"ok": True}


@router.post("/publish")
async def publish(body: PublishBody, authorization: Optional[str] = Header(None),
                  db: AsyncSession = Depends(get_db_session)):
    _enabled()
    user = await _resolve_user(db, authorization, strict=True)
    adapter = _adapter(body.platform)
    acc = await _account(db, user.id, body.platform)
    if not acc or acc.status != "active":
        raise HTTPException(status_code=409, detail=f"Connect your {body.platform} account first")

    since = datetime.utcnow() - timedelta(days=1)
    today = (await db.execute(
        select(func.count()).select_from(PostPublication).where(
            PostPublication.user_id == user.id, PostPublication.platform == body.platform,
            PostPublication.status != "failed", PostPublication.created_at >= since)
    )).scalar() or 0
    if today >= settings.social_max_posts_per_day:
        raise HTTPException(status_code=429, detail="Daily post limit reached for this network")

    if body.platform == "x":
        month = (await db.execute(
            select(func.count()).select_from(PostPublication).where(
                PostPublication.user_id == user.id, PostPublication.platform == "x",
                PostPublication.status != "failed", PostPublication.created_at >= datetime.utcnow() - timedelta(days=30))
        )).scalar() or 0
        if month >= settings.social_x_max_posts_per_month:
            raise HTTPException(status_code=429, detail="Monthly post limit reached for X")

    video_url = None
    if body.clip_id is not None:
        clip = (await db.execute(
            select(MediaClip).where(MediaClip.id == body.clip_id, MediaClip.user_id == user.id)
        )).scalars().first()
        if not clip:
            raise HTTPException(status_code=404, detail="Clip not found")
        if clip.status != "ready" or not clip.r2_key:
            raise HTTPException(status_code=409, detail="Clip is not ready yet")
        try:
            video_url = media_storage.presign_get(clip.r2_key, expires=600)
        except media_storage.StorageNotConfigured:
            raise HTTPException(status_code=503, detail="Storage not configured")

    pub = PostPublication(user_id=user.id, clip_id=body.clip_id, platform=body.platform, caption=body.text, status="pending")
    db.add(pub)
    await db.commit()  # intent log antes de tocar a rede
    await db.refresh(pub)
    creds = json.loads(_crypto.decrypt(acc.credentials_enc))
    before = dict(creds)
    try:
        post_id, url = await adapter.publish(creds, body.text, video_url)
    except SocialError as e:
        pub.status, pub.error = "failed", str(e)[:300]
    except Exception:
        logger.exception("[social] publish crashed | platform=%s pub=%s", body.platform, pub.id)
        pub.status, pub.error = "failed", "Unexpected error while posting"
    else:
        pub.status, pub.external_post_id, pub.url, pub.published_at = "published", post_id, url, datetime.utcnow()
    if creds != before:  # o adaptador renovou o token
        acc.credentials_enc = _crypto.encrypt(json.dumps(creds))
    await db.commit()
    await db.refresh(pub)
    return _pub_out(pub)


@router.get("/publications")
async def list_publications(authorization: Optional[str] = Header(None), db: AsyncSession = Depends(get_db_session)):
    _enabled()
    user = await _resolve_user(db, authorization, strict=True)
    rows = (await db.execute(
        select(PostPublication).where(PostPublication.user_id == user.id).order_by(PostPublication.id.desc()).limit(50)
    )).scalars().all()
    return {"publications": [_pub_out(p) for p in rows]}


@router.post("/publications/{pub_id}/metrics")
async def refresh_metrics(pub_id: int, authorization: Optional[str] = Header(None),
                          db: AsyncSession = Depends(get_db_session)):
    _enabled()
    user = await _resolve_user(db, authorization, strict=True)
    pub = (await db.execute(
        select(PostPublication).where(PostPublication.id == pub_id, PostPublication.user_id == user.id)
    )).scalars().first()
    if not pub:
        raise HTTPException(status_code=404, detail="Post not found")
    if pub.status != "published" or not pub.external_post_id:
        raise HTTPException(status_code=409, detail="Post was not published")
    acc = await _account(db, user.id, pub.platform)
    if not acc:
        raise HTTPException(status_code=409, detail=f"Connect your {pub.platform} account first")
    creds = json.loads(_crypto.decrypt(acc.credentials_enc))
    before = dict(creds)
    try:
        m = await _adapter(pub.platform).fetch_metrics(creds, pub.external_post_id)
    except SocialError as e:
        raise HTTPException(status_code=502, detail=str(e))
    if creds != before:
        acc.credentials_enc = _crypto.encrypt(json.dumps(creds))
    pub.metrics_json, pub.metrics_at = json.dumps(m), datetime.utcnow()
    await db.commit()
    await db.refresh(pub)
    return _pub_out(pub)
