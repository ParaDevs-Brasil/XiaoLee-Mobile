"""
AI Creators: registrar vídeos que já existem (feitos fora do app) numa conta, com personagem, foto e MP4 no R2.

Duas funções. Nenhuma gera vídeo nem gasta fal; o vídeo importado aparece em "Your videos" da conta.

    # 1) achar a conta (só leitura): por nome, handle, Privy DID ou carteira (a EVM vinculada também). O `user_id` que ele
    #    mostra é o que vai em CAMPAIGN_POINTS_ADMINS
    python scripts/creators_import.py find thiago

    # 2) importar. Sem --yes só MOSTRA o que faria (alvo do banco e do R2 incluídos) e não escreve nada.
    python scripts/creators_import.py import --user-id 12 --name BC --photo char2.png --video wan3.mp4
    python scripts/creators_import.py import --user-id 12 --creator-id 7 --video outro.mp4 --yes   # personagem já existente

Roda onde estiver o ambiente: no local usa `backend/.env` (banco local e o "R2 de mentira"); em produção:
    cd backend && railway run python scripts/creators_import.py find thiago

Os vídeos importados levam `payment_nonce` começando com `0ximport` (preço 0, sem pagamento): dá para achar e
apagar depois com `... WHERE payment_nonce LIKE '0ximport%'`.
"""

from __future__ import annotations

import argparse
import asyncio
import mimetypes
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import or_, select  # noqa: E402

from database import database as db  # noqa: E402
from database.models import CreatorVideo, SyntheticCreator, User, Wallet  # noqa: E402
from server import media_storage, synthetic_creators as sc  # noqa: E402
from server.settings import settings  # noqa: E402

IMPORT_NONCE = "0ximport"


def _short(text: str | None, n: int = 18) -> str:
    return "-" if not text else (text if len(text) <= n else text[:n] + "…")


def _targets() -> str:
    """Onde isto vai escrever, sem credenciais."""
    raw = os.getenv("DATABASE_URL", "")
    dburl = urlparse(raw) if raw else None
    host = f"{dburl.scheme}://{dburl.hostname or ''}{dburl.path}" if dburl else "SQLite local (sem DATABASE_URL)"
    r2 = urlparse(settings.r2_endpoint_url or "")
    return f"banco: {host}\n  R2: {r2.hostname or r2.path or '(não configurado)'} bucket={settings.r2_bucket or '-'}"


async def find(text: str) -> None:
    engine, sessions = db.init_db()
    try:
        async with sessions() as s:
            like = f"%{text}%"
            rows = (await s.execute(select(User).where(or_(
                User.full_name.ilike(like), User.twitter_handle.ilike(like),
                User.twitter_user_id.ilike(like), User.stellar_wallet.ilike(like),
                User.id.in_(select(Wallet.user_id).where(Wallet.address.ilike(like))),  # carteira EVM vinculada
            )).order_by(User.id).limit(15))).scalars().all()
        if not rows:
            print("Nenhuma conta encontrada.")
        for u in rows:
            print(f"id={u.id}  nome={u.full_name or '-'}  handle={_short(u.twitter_handle, 28)}  user_id={u.twitter_user_id}")
    finally:
        await engine.dispose()


async def import_video(a: argparse.Namespace) -> None:
    video = Path(a.video)
    if not video.is_file():
        sys.exit(f"Vídeo não encontrado: {video}")
    photo = Path(a.photo) if a.photo else None
    if not a.creator_id and not (a.name and photo and photo.is_file()):
        sys.exit("Sem --creator-id é preciso --name e --photo (arquivo existente).")
    if a.quality not in sc.QUALITIES:
        sys.exit(f"--quality inválida. Use uma de: {', '.join(sc.QUALITIES)}")

    engine, sessions = db.init_db()
    try:
        async with sessions() as s:
            user = await s.get(User, a.user_id)
            if not user:
                sys.exit(f"Conta {a.user_id} não existe neste banco.")
            creator = None
            if a.creator_id:
                creator = await s.get(SyntheticCreator, a.creator_id)
                if not creator or creator.user_id != user.id:
                    sys.exit("Esse personagem não é dessa conta.")

            print(f"Conta: id={user.id} nome={user.full_name or '-'} handle={_short(user.twitter_handle, 28)}")
            print(f"Personagem: {creator.name + ' (já existente)' if creator else a.name + ' (novo, com ' + photo.name + ')'}")
            print(f"Vídeo: {video.name} ({video.stat().st_size / 1e6:.1f} MB), faixa={a.quality}, {a.duration}s")
            print("Vai escrever em:\n  " + _targets())
            if not a.yes:
                print("\nNada foi escrito (falta --yes).")
                return

            now = datetime.utcnow()
            tag = uuid.uuid4().hex[:8]
            base = f"creators/{user.id}/imported/{tag}"
            if not creator:
                ctype = mimetypes.guess_type(photo.name)[0] or "image/png"
                await media_storage.upload_file(str(photo), f"{base}-photo{photo.suffix.lower()}", ctype)
                creator = SyntheticCreator(user_id=user.id, name=a.name, voice_id=sc.VOICES[0]["id"],
                                           ref_image_key=f"{base}-photo{photo.suffix.lower()}", ref_content_type=ctype,
                                           status="ready", rights_confirmed_at=now)
                s.add(creator)
                await s.flush()
            key = f"{base}.mp4"
            await media_storage.upload_file(str(video), key, "video/mp4")
            v = CreatorVideo(
                user_id=user.id, creator_id=creator.id, quality=a.quality, model=sc.QUALITIES[a.quality]["model"],
                duration_s=a.duration, script="", price_usdc=0, payment_from="0x" + "0" * 40,
                payment_nonce=f"{IMPORT_NONCE}{tag}".ljust(66, "0"), payment_tx=None, status="done", video_key=key,
                audio="original", created_at=now, updated_at=now,
            )
            s.add(v)
            await s.flush()
            # Quadro do vídeo para a lista (o mesmo que o app gera ao terminar um vídeo).
            from server.synthetic_creator_routes import _make_thumb
            v.thumb_key = await _make_thumb(v)
            await s.commit()
            print(f"\nFeito: personagem id={creator.id}, vídeo id={v.id}, quadro={'ok' if v.thumb_key else 'não gerado (sai ao abrir a lista)'}")
    finally:
        await engine.dispose()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("find", help="achar uma conta (só leitura)")
    f.add_argument("text")
    i = sub.add_parser("import", help="registrar um vídeo numa conta")
    i.add_argument("--user-id", type=int, required=True)
    i.add_argument("--video", required=True)
    i.add_argument("--creator-id", type=int)
    i.add_argument("--name")
    i.add_argument("--photo")
    i.add_argument("--quality", default="swap")
    i.add_argument("--duration", type=int, default=5)
    i.add_argument("--yes", action="store_true", help="escreve de verdade (sem isso só mostra)")
    a = ap.parse_args()
    asyncio.run(find(a.text) if a.cmd == "find" else import_video(a))


if __name__ == "__main__":
    main()
