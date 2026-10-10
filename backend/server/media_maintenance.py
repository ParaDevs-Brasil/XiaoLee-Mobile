"""
media_maintenance.py — faxina do Clipper (Plane #27/#29).

1. reap_interrupted: o processamento roda em tarefa de processo (workers=1); se o processo reinicia, o que
   estava em `transcribing`/`pending`/`rendering` nunca termina. No startup nada está de fato em andamento,
   então essas linhas viram `failed` na hora (o app reenvia /complete ou regenera os cortes), sem esperar os 30 min.
2. purge_expired: apaga do bucket o original e os cortes depois de MEDIA_RETENTION_DAYS (uploads nunca
   concluídos: 2 dias) e marca `expired` no banco, para o app não apontar para objeto inexistente.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, select, update

from database import database as _dbmod
from database.models import MediaAsset, MediaClip, MediaTranscript
from server import media_storage
from server.settings import settings

logger = logging.getLogger(__name__)

ABANDONED_UPLOAD = timedelta(days=2)
PURGE_EVERY_S = 6 * 3600


async def reap_interrupted(db) -> tuple[int, int]:
    a = await db.execute(
        update(MediaAsset).where(MediaAsset.status == "transcribing")
        .values(status="failed", error="interrupted by a server restart, send /complete again")
    )
    c = await db.execute(
        update(MediaClip).where(MediaClip.status.in_(("pending", "rendering")))
        .values(status="failed", error="interrupted by a server restart, regenerate the clips")
    )
    await db.commit()
    return a.rowcount or 0, c.rowcount or 0


async def purge_expired(db, now: datetime | None = None) -> int:
    """Devolve quantas mídias expiraram. Se o bucket falhar num objeto, a linha fica e tenta de novo no próximo ciclo."""
    now = now or datetime.utcnow()
    abandoned = (MediaAsset.status == "pending") & (MediaAsset.created_at < now - ABANDONED_UPLOAD)
    due = abandoned
    if settings.media_retention_days > 0:
        due = abandoned | (MediaAsset.created_at < now - timedelta(days=settings.media_retention_days))
    q = select(MediaAsset).where(MediaAsset.status != "expired", due)
    done = 0
    for asset in (await db.execute(q)).scalars().all():
        clips = (await db.execute(select(MediaClip).where(MediaClip.media_id == asset.id))).scalars().all()
        try:
            for key in [asset.r2_key, *(c.r2_key for c in clips if c.r2_key)]:
                await media_storage.delete_object(key)
        except Exception:
            logger.warning("media %s: could not delete objects, will retry", asset.id)
            continue
        for c in clips:
            c.status, c.r2_key, c.size_bytes = "expired", None, None
        await db.execute(delete(MediaTranscript).where(MediaTranscript.media_id == asset.id))
        asset.status, asset.error = "expired", None
        await db.commit()
        done += 1
    return done


async def run_forever() -> None:
    """Tarefa de lifespan: reaper uma vez, depois purge a cada 6 h. Nunca derruba o app."""
    if _dbmod.SessionLocal is None:
        return
    try:
        async with _dbmod.SessionLocal() as db:
            a, c = await reap_interrupted(db)
        if a or c:
            logger.warning("[startup] media interrupted by restart: %d transcriptions, %d clips marked failed", a, c)
    except Exception as exc:
        logger.warning("[startup] media reaper failed: %s", exc)
    while True:
        try:
            async with _dbmod.SessionLocal() as db:
                n = await purge_expired(db)
            if n:
                logger.info("media retention: %d media expired", n)
        except media_storage.StorageNotConfigured:
            pass
        except Exception as exc:
            logger.warning("media retention failed: %s", exc)
        await asyncio.sleep(PURGE_EVERY_S)
