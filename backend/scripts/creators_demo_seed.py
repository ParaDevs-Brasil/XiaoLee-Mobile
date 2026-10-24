"""
Dados de exemplo do AI Creators (Studio) para ver/desenvolver a UI do app SEM gastar nada.

Cria, para o usuário logado no backend local, dois personagens e vídeos em cada estado que o app sabe mostrar
(pronto, gerando, falhou com reembolso, Mimic e Replace prontos) e uma prévia do Replace pronta. Usa o mesmo
"R2 de mentira" do Clipper (`clipper_demo_seed.py --serve`, porta 9000): imagens e MP4s de exemplo, e Play/Save
funcionam de verdade. Gerar um vídeo novo NÃO funciona aqui (precisa de pagamento e da fal): ver
docs/STUDIO_DEV_SETUP.md para validar essa parte.

Uso (backend com o bloco "demo" do docs/STUDIO_DEV_SETUP.md, e o backend reiniciado):
    cd backend && ../.venv/bin/python scripts/creators_demo_seed.py            # os dados
    cd backend && ../.venv/bin/python scripts/clipper_demo_seed.py --serve     # o "R2", porta 9000
    adb reverse tcp:9000 tcp:9000                                              # celular no USB

Rodar de novo recria tudo (apaga só os personagens "Demo ..." daquele usuário e o que depende deles).
"""

from __future__ import annotations

import argparse
import asyncio
import shutil
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, select  # noqa: E402

from clipper_demo_seed import BUCKET, STORAGE, _ffmpeg_clip, _owner  # noqa: E402
from database import database as db  # noqa: E402
from database.models import CreatorPreview, CreatorVideo, SyntheticCreator  # noqa: E402
from server import synthetic_creators as sc  # noqa: E402


def _image(dest: Path, color: str, label: str) -> None:
    """PNG vertical simples (cor + texto) no lugar da foto do personagem."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    src = f"color=c={color}:s=720x1280:d=1"
    text = f"drawtext=text='{label}':fontcolor=white:fontsize=96:x=(w-text_w)/2:y=(h-text_h)/2"
    base = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", src, "-frames:v", "1"]
    if subprocess.run([*base, "-vf", text, str(dest)]).returncode != 0:
        subprocess.run([*base, str(dest)], check=True)  # ffmpeg sem freetype: sem o texto


async def seed(user_id: int | None) -> None:
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg não encontrado.")
    engine, sessions = db.init_db()
    try:
        async with sessions() as session:
            user = await _owner(session, user_id)

            old = (await session.execute(
                select(SyntheticCreator.id).where(SyntheticCreator.user_id == user.id, SyntheticCreator.name.like("Demo %"))
            )).scalars().all()
            if old:
                await session.execute(delete(CreatorVideo).where(CreatorVideo.creator_id.in_(old)))
                await session.execute(delete(CreatorPreview).where(CreatorPreview.creator_id.in_(old)))
                await session.execute(delete(SyntheticCreator).where(SyntheticCreator.id.in_(old)))

            now = datetime.utcnow()
            voice = sc.VOICES[0]["id"]
            chars = []
            for name, color in (("Demo Luna", "0xd81b78"), ("Demo Bolt", "0x3b5bdb")):
                key = f"creators/{user.id}/demo/{name.split()[1].lower()}.png"
                _image(STORAGE / BUCKET / key, color, name.split()[1])
                chars.append(SyntheticCreator(
                    user_id=user.id, name=name, voice_id=voice, ref_image_key=key, ref_content_type="image/png",
                    status="ready", rights_confirmed_at=now,
                ))
            session.add_all(chars)
            await session.flush()
            luna, bolt = chars

            def video(creator: SyntheticCreator, n: int, *, quality: str, status: str, age_min: int, script: str = "",
                      error: str | None = None, refund: bool = False, done_key: str | None = None,
                      motion: str | None = None, audio: str = "none") -> CreatorVideo:
                q = sc.QUALITIES[quality]
                return CreatorVideo(
                    user_id=user.id, creator_id=creator.id, quality=quality, model=q["model"], duration_s=5,
                    script=script, price_usdc=sc.price_usdc(quality, 5), payment_from="0x" + "d" * 40,
                    payment_nonce=f"0xdemo{user.id:04d}{creator.id:04d}{n:04d}".ljust(66, "0"),
                    payment_tx="0x" + f"{n:064x}", status=status, error=error, refund_due=refund, video_key=done_key,
                    motion_key=motion, audio=audio, created_at=now - timedelta(minutes=age_min),
                    updated_at=now - timedelta(minutes=age_min),
                )

            def mp4(name: str, color: str, label: str) -> str:
                key = f"creators/{user.id}/demo/{name}.mp4"
                _ffmpeg_clip(STORAGE / BUCKET / key, color, label)
                return key

            session.add_all([
                video(luna, 1, quality="standard", status="done", age_min=240, script="Oi, eu sou a Luna e hoje eu vou te mostrar como pagar em USDC.",
                      done_key=mp4("luna-talk", "0xd81b78", "Talk")),
                video(luna, 2, quality="standard", status="video", age_min=1, script="Esse vídeo ainda está sendo gerado."),
                video(luna, 3, quality="standard", status="failed", age_min=90, script="Esse vídeo falhou.", refund=True,
                      error="We couldn't make this video. Your payment will be refunded."),
                video(bolt, 4, quality="mimic", status="done", age_min=60, done_key=mp4("bolt-mimic", "0x1f8a5b", "Mimic"),
                      motion=f"creators/{user.id}/demo/motion.mp4", audio="original"),
                video(bolt, 5, quality="swap", status="done", age_min=30, done_key=mp4("bolt-replace", "0x3b5bdb", "Replace"),
                      motion=f"creators/{user.id}/demo/motion.mp4"),
                video(bolt, 6, quality="swap", status="queued", age_min=2, motion=f"creators/{user.id}/demo/motion.mp4"),
            ])
            frame = f"creators/{user.id}/demo/preview-frame.png"
            _image(STORAGE / BUCKET / frame, "0x3b5bdb", "Preview")
            session.add(CreatorPreview(
                user_id=user.id, creator_id=bolt.id, motion_key=f"creators/{user.id}/demo/motion.mp4",
                frame_key=frame, status="ready",
            ))
            await session.commit()
        print(f"Pronto: 2 personagens, 6 vídeos e 1 prévia de exemplo para o usuário {user.id} ({user.twitter_handle}).")
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--user-id", type=int, default=None, help="padrão: quem fez login por último no app")
    args = parser.parse_args()
    asyncio.run(seed(args.user_id))


if __name__ == "__main__":
    main()
