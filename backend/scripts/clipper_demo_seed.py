"""
Dados de exemplo do Clipper para ver/desenvolver a UI do app SEM chaves de R2, Groq ou Anthropic.

Cria, para o usuário logado no backend local, um vídeo em cada estado que o app sabe mostrar
(cortes prontos, renderizando, transcrevendo, transcrição parada, falha, esperando gerar) e
MP4s verticais de exemplo num "R2 de mentira" — uma pasta servida por HTTP local. Play, Save e
Share funcionam de verdade; enviar vídeo novo e "Generate" chamam os serviços reais e falham.

Uso (backend/.env com o bloco "demo" — ver --help — e o backend reiniciado):
    cd backend && ../.venv/bin/python scripts/clipper_demo_seed.py            # os dados
    cd backend && ../.venv/bin/python scripts/clipper_demo_seed.py --serve    # o "R2", porta 9000
    adb reverse tcp:9000 tcp:9000                                             # celular no USB

O "R2" do --serve aceita PUT, então o upload do app também funciona: o vídeo chega, entra em
"Transcribing" e falha na transcrição (sem GROQ_API_KEY) — dá para ver as três telas.

Rodar de novo recria tudo (apaga só a mídia `demo-*` daquele usuário).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import subprocess
import sys
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, select  # noqa: E402

from database import database as db  # noqa: E402
from database.models import MediaAsset, MediaClip, MediaTranscript, User, WebSession  # noqa: E402

STORAGE = Path(__file__).resolve().parent.parent / ".demo-storage"
BUCKET = "demo"
ENV_BLOCK = f"""\
R2_ENDPOINT_URL=http://localhost:9000
R2_ACCESS_KEY_ID=demo
R2_SECRET_ACCESS_KEY=demo
R2_BUCKET={BUCKET}"""

SEGMENTS = [
    (0, 9, "Bom dia, pessoal, hoje eu quero falar de uma coisa que quase ninguém explica direito."),
    (9, 21, "Quando você paga em USDC na Arc, a transação confirma em menos de um segundo."),
    (21, 34, "E a taxa? Centavos. Isso muda completamente o jogo para quem é criador de conteúdo."),
    (34, 48, "Eu testei com trinta pagamentos seguidos e nenhum falhou, olha que loucura."),
    (48, 61, "O segredo é que o agente decide sozinho quanto pagar para cada criador."),
    (61, 75, "Mas atenção: se você não define um orçamento, ele pode gastar mais do que devia."),
    (75, 90, "Por isso a gente trava o orçamento antes do loop começar, sempre."),
    (90, 104, "Comenta aqui embaixo se você quer que eu mostre isso funcionando ao vivo."),
]

CLIPS = [
    (1, 9, 34, "USDC na Arc confirma em menos de 1 segundo", "Gancho forte com número concreto e benefício claro para criadores."),
    (2, 34, 61, "30 pagamentos seguidos, zero falhas", "Prova prática que gera curiosidade sobre o agente."),
    (3, 61, 90, "O erro que faz o agente gastar demais", "Alerta com tensão e solução no mesmo trecho."),
]


def _ffmpeg_clip(dest: Path, color: str, label: str) -> None:
    """MP4 1080x1920 de 6 s com cor sólida, texto e um tom — o bastante para Play/Save/Share."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    video = f"color=c={color}:s=1080x1920:d=6"
    text = f"drawtext=text='{label}':fontcolor=white:fontsize=120:x=(w-text_w)/2:y=(h-text_h)/2"
    base = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", video,
            "-f", "lavfi", "-i", "sine=frequency=440:duration=6"]
    tail = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", str(dest)]
    if subprocess.run([*base, "-vf", text, *tail]).returncode != 0:
        # ffmpeg sem freetype: sem o texto, mas ainda um vídeo vertical válido.
        subprocess.run([*base, *tail], check=True)


async def _owner(session, user_id: int | None) -> User:
    if user_id is not None:
        user = await session.get(User, user_id)
    else:
        # Quem fez login por último no app: a sessão emitida mais recente.
        last = (await session.execute(select(WebSession).order_by(WebSession.id.desc()))).scalars().first()
        user = (
            (await session.execute(select(User).where(User.twitter_user_id == last.twitter_user_id))).scalars().first()
            if last else None
        )
    if not user:
        sys.exit("Nenhum usuário: faça login no app com o backend local rodando, ou passe --user-id.")
    return user


async def seed(user_id: int | None) -> None:
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg não encontrado.")
    engine, sessions = db.init_db()
    try:
        await _seed(sessions, user_id)
    finally:
        # Sem o dispose, a thread do aiosqlite segura o processo aberto no fim.
        await engine.dispose()


async def _seed(sessions, user_id: int | None) -> None:
    async with sessions() as session:
        user = await _owner(session, user_id)

        old = (await session.execute(
            select(MediaAsset.id).where(MediaAsset.user_id == user.id, MediaAsset.filename.like("demo-%"))
        )).scalars().all()
        if old:
            await session.execute(delete(MediaClip).where(MediaClip.media_id.in_(old)))
            await session.execute(delete(MediaTranscript).where(MediaTranscript.media_id.in_(old)))
            await session.execute(delete(MediaAsset).where(MediaAsset.id.in_(old)))

        now = datetime.utcnow()
        segments = json.dumps([{"start": a, "end": b, "text": t} for a, b, t in SEGMENTS], ensure_ascii=False)

        def asset(name: str, status: str, *, age_min: int, error: str | None = None,
                  kind: str = "video", stuck: bool = False) -> MediaAsset:
            created = now - timedelta(minutes=age_min)
            return MediaAsset(
                user_id=user.id, kind=kind, filename=name, content_type=f"{kind}/mp4", size_bytes=48_000_000,
                r2_key=f"media/{user.id}/demo/{name}", status=status, error=error,
                duration_s=104.0 if status == "transcribed" else None, created_at=created,
                # "parada": mais velho que STALE_TRANSCRIBING (30 min) → o app oferece refazer.
                updated_at=now - timedelta(hours=1) if stuck else created,
            )

        ready = asset("demo-podcast-ep12.mp4", "transcribed", age_min=90)
        rendering = asset("demo-live-arc.mp4", "transcribed", age_min=20)
        choose = asset("demo-aula-x402.mp4", "transcribed", age_min=15)
        transcribing = asset("demo-palestra.mp4", "transcribing", age_min=2)
        stalled = asset("demo-entrevista.mp4", "transcribing", age_min=120, stuck=True)
        failed = asset("demo-react.mp4", "failed", age_min=200,
                       error="Transcription service is busy (rate limit). Try again in a minute.")
        audio = asset("demo-podcast-audio.mp3", "transcribed", age_min=300, kind="audio")
        session.add_all([ready, rendering, choose, transcribing, stalled, failed, audio])
        await session.flush()

        for m in (ready, rendering, choose, audio):
            session.add(MediaTranscript(media_id=m.id, segments_json=segments, language="portuguese", model="demo"))

        colors = ["0xd81b78", "0x1f8a5b", "0x3b5bdb"]
        for rank, start, end, title, reason in CLIPS:
            key = f"clips/{user.id}/demo/clip-{rank}.mp4"
            _ffmpeg_clip(STORAGE / BUCKET / key, colors[rank - 1], f"Clip {rank}")
            session.add(MediaClip(
                user_id=user.id, media_id=ready.id, rank=rank, start_s=start, end_s=end, title=title,
                reason=reason, status="ready", r2_key=key, size_bytes=(STORAGE / BUCKET / key).stat().st_size,
            ))
            # Mesmo trio "em andamento": 1 pronto, 1 renderizando, 1 na fila.
            status = {1: "ready", 2: "rendering", 3: "pending"}[rank]
            session.add(MediaClip(
                user_id=user.id, media_id=rendering.id, rank=rank, start_s=start, end_s=end, title=title,
                reason=reason, status=status, r2_key=key if status == "ready" else None,
            ))
        await session.commit()

    print(f"Pronto: 7 vídeos de exemplo para o usuário {user.id} ({user.twitter_handle}).")
    print(f"\nbackend/.env precisa de (e reiniciar o backend):\n{ENV_BLOCK}")
    print("\nE, em terminais separados:")
    print("  ../.venv/bin/python scripts/clipper_demo_seed.py --serve")
    print("  adb reverse tcp:9000 tcp:9000")


class _FakeR2(BaseHTTPRequestHandler):
    """O mínimo de S3 que o Clipper usa, sem checar assinatura: PUT (upload do app), HEAD (o
    `/complete` confere o tamanho), GET com Range (o ffmpeg lê o vídeo pulando trechos; o player
    também), upload multipart (o boto3 sobe o corte renderizado em partes acima de 8 MB) e DELETE
    (corte substituído ao gerar de novo). Caminho = `/<bucket>/<key>`, guardado em
    `.demo-storage/<bucket>/<key>`; partes do multipart em `.demo-storage/.parts/<uploadId>/`."""

    def _path(self) -> Path | None:
        target = (STORAGE / unquote(urlsplit(self.path).path).lstrip("/")).resolve()
        return target if target.is_relative_to(STORAGE.resolve()) else None

    def _query(self) -> dict[str, str]:
        return {k: v[0] for k, v in parse_qs(urlsplit(self.path).query, keep_blank_values=True).items()}

    def _parts_dir(self, upload_id: str) -> Path:
        return STORAGE / ".parts" / "".join(c for c in upload_id if c.isalnum())

    def _read_body_into(self, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        remaining = int(self.headers.get("Content-Length", 0))
        with dest.open("wb") as out:
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 1 << 20))
                if not chunk:
                    break
                out.write(chunk)
                remaining -= len(chunk)

    def _reply(self, status: int, xml: str = "", headers: dict[str, str] | None = None) -> None:
        body = xml.encode()
        self.send_response(status)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Type", "application/xml")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_PUT(self) -> None:
        target, q = self._path(), self._query()
        if target is None:
            return self.send_error(403)
        if "partNumber" in q and "uploadId" in q:  # uma parte do multipart
            self._read_body_into(self._parts_dir(q["uploadId"]) / f"{int(q['partNumber']):05d}")
            return self._reply(200, headers={"ETag": f'"part-{q["partNumber"]}"'})
        self._read_body_into(target)
        self._reply(200, headers={"ETag": '"demo"'})

    def do_POST(self) -> None:
        target, q = self._path(), self._query()
        if target is None:
            return self.send_error(403)
        self.rfile.read(int(self.headers.get("Content-Length", 0)))  # corpo XML do complete: ignorado
        if "uploads" in q:  # início do multipart
            upload_id = uuid4().hex
            self._parts_dir(upload_id).mkdir(parents=True, exist_ok=True)
            return self._reply(200, f"<InitiateMultipartUploadResult><UploadId>{upload_id}</UploadId>"
                                    "</InitiateMultipartUploadResult>")
        if "uploadId" in q:  # fim do multipart: junta as partes em ordem
            parts = self._parts_dir(q["uploadId"])
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("wb") as out:
                for part in sorted(parts.iterdir()):
                    out.write(part.read_bytes())
            shutil.rmtree(parts, ignore_errors=True)
            return self._reply(200, '<CompleteMultipartUploadResult><ETag>"demo"</ETag>'
                                    "</CompleteMultipartUploadResult>")
        self.send_error(400)

    def do_DELETE(self) -> None:
        target, q = self._path(), self._query()
        if "uploadId" in q:  # abort do multipart
            shutil.rmtree(self._parts_dir(q["uploadId"]), ignore_errors=True)
        elif target is not None and target.is_file():
            target.unlink()
        self.send_response(204)
        self.end_headers()

    def do_HEAD(self) -> None:
        self._serve(body=False)

    def do_GET(self) -> None:
        self._serve(body=True)

    def _serve(self, body: bool) -> None:
        target = self._path()
        if target is None or not target.is_file():
            return self.send_error(404)
        size = target.stat().st_size
        start, end = 0, size - 1
        ranged = self.headers.get("Range", "").startswith("bytes=")
        if ranged:
            first, _, last = self.headers["Range"][6:].partition("-")
            start = int(first) if first else max(0, size - int(last))
            end = min(int(last), size - 1) if first and last else end
        self.send_response(206 if ranged else 200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if ranged:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if body:
            with target.open("rb") as f:
                f.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = f.read(min(remaining, 1 << 20))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)


def serve(port: int) -> None:
    STORAGE.mkdir(exist_ok=True)
    print(f"\"R2\" de demo em http://localhost:{port} → {STORAGE}  (Ctrl+C para parar)")
    ThreadingHTTPServer(("127.0.0.1", port), _FakeR2).serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--user-id", type=int, help="dono dos vídeos (padrão: quem fez login por último)")
    parser.add_argument("--serve", action="store_true", help='sobe o "R2" de demo (porta 9000) em vez de semear')
    args = parser.parse_args()
    if args.serve:
        serve(9000)
    else:
        asyncio.run(seed(args.user_id))


if __name__ == "__main__":
    main()
