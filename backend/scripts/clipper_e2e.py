"""
clipper_e2e.py — prova ponta a ponta do Clipper pelas ROTAS reais, com R2/Whisper/Claude de verdade.

    POST /v1/media → PUT direto no R2 → POST /complete (extrai áudio, janelas, Whisper)
    → POST /clips (Claude escolhe, ffmpeg renderiza, sobe ao R2) → baixa os cortes e confere com ffprobe

Banco: SQLite temporário (nada toca o banco de dev). Mede tempo por etapa e pico de memória
(processo + maior ffmpeg filho). No fim apaga do bucket tudo o que criou.

Uso (variáveis R2_*, GROQ_API_KEY e ANTHROPIC_API_KEY no ambiente; NUNCA imprime segredos):
    cd backend && ../.venv/bin/python scripts/clipper_e2e.py <video> [crop|fit]
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import resource
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("JWT_SECRET", "e2e-jwt-secret-32-chars-minimum-ok")
os.environ.setdefault("ENCRYPTION_KEY", "e2e-encryption-key-xxxxxxxxxxxxx")
os.environ["TELEGRAM_POLLER_ENABLED"] = "false"  # o .env da raiz tem o token de produção: nunca ligar poller aqui

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from database.base import Base  # noqa: E402
from database.database import get_db_session  # noqa: E402
from database.models import WebSession  # noqa: E402
from server import media_routes, media_storage  # noqa: E402
from server.app import app  # noqa: E402

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'OK  ' if ok else 'FAIL'} {label}" + (f" — {detail}" if detail else ""), flush=True)
    if not ok:
        failures.append(label)


def mem_mb() -> str:
    me = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    kid = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024
    return f"processo {me:.0f} MB · maior ffmpeg {kid:.0f} MB"


def stream(path: Path, chunk: int = 8 * 1024 * 1024):
    with open(path, "rb") as f:
        while block := f.read(chunk):
            yield block


def probe(path: str) -> tuple[int, int, float]:
    d = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
         "-show_entries", "format=duration", "-of", "json", path], capture_output=True, text=True, check=True).stdout)
    return d["streams"][0]["width"], d["streams"][0]["height"], float(d["format"]["duration"])


def main(video: Path, layout: str) -> int:
    tmp = tempfile.mkdtemp(prefix="clipper_e2e_")
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp}/e2e.db")
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def setup() -> dict[str, str]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with Session() as db:
            db.add(WebSession(session_id="privy_session_e2e", twitter_user_id="privy_e2e",
                              expires_at=datetime.utcnow() + timedelta(days=1)))
            await db.commit()
        return {"Authorization": "Bearer privy_session_e2e"}

    h = asyncio.run(setup())

    async def _db():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_db_session] = _db
    media_routes._session = Session  # a tarefa em background usa o mesmo banco temporário
    keys: list[str] = []
    size = video.stat().st_size
    try:
        client = TestClient(app)
        print(f"vídeo: {video.name} ({size / 1048576:.0f} MB) · layout {layout}")
        r = client.post("/v1/media", headers=h, json={"filename": video.name, "content_type": "video/mp4", "size_bytes": size})
        check(r.status_code == 200, "POST /v1/media devolve URL pré-assinada", f"HTTP {r.status_code}")
        up = r.json()
        aid = up["asset"]["id"]
        keys.append(asyncio.run(_key_of(Session, aid)))

        t = time.time()
        with httpx.Client(timeout=None) as http:
            put = http.put(up["upload_url"], content=stream(video),
                           headers={**up["upload_headers"], "Content-Length": str(size)})
        up_s = time.time() - t
        check(put.status_code == 200, "upload direto ao R2", f"HTTP {put.status_code} · {size / 1048576 / up_s:.1f} MB/s · {up_s:.0f}s")

        print("transcrição (extrai áudio → janelas → Whisper)…", flush=True)
        t = time.time()
        r = client.post(f"/v1/media/{aid}/complete", headers=h)  # bloqueia até o background terminar
        d = client.get(f"/v1/media/{aid}", headers=h).json()
        tr_s = time.time() - t
        check(d["status"] == "transcribed", "mídia transcrita", f"status={d['status']} {d.get('error') or ''}")
        if d["status"] != "transcribed":
            return 1
        segs = d["transcript"]["segments"]
        check(bool(segs), "segmentos", f"{len(segs)} segmentos · {d['duration_s']:.0f}s de mídia · {d['transcript']['language']} · {tr_s:.0f}s ({d['duration_s'] / tr_s:.1f}× tempo real)")
        check(all(a["end"] <= b["start"] + 1.0 for a, b in zip(segs, segs[1:])), "segmentos em ordem em toda a duração (tolerância 1 s: pontas de segmentos vizinhos)")
        print("  memória:", mem_mb())

        print("cortes (Claude escolhe → ffmpeg renderiza → R2)…", flush=True)
        t = time.time()
        r = client.post(f"/v1/media/{aid}/clips?layout={layout}", headers=h)
        check(r.status_code == 200, "POST /clips", f"HTTP {r.status_code} {r.text[:120] if r.status_code != 200 else ''}")
        if r.status_code != 200:
            return 1
        clips = client.get(f"/v1/media/{aid}/clips", headers=h).json()
        cl_s = time.time() - t
        check(all(c["status"] == "ready" for c in clips), "todos os cortes prontos",
              f"{[c['status'] for c in clips]} · {cl_s:.0f}s no total")
        print("  memória:", mem_mb())
        for c in clips:
            keys.append(asyncio.run(_clip_key(Session, c["id"])))
            dest = f"{tmp}/clip{c['rank']}.mp4"
            with httpx.Client(timeout=None) as http:
                got = http.get(c["download_url"])
            open(dest, "wb").write(got.content)
            w, hh, dur = probe(dest)
            want = c["end_s"] - c["start_s"]
            check((w, hh) == (1080, 1920) and abs(dur - want) < 0.7 and got.status_code == 200,
                  f"corte #{c['rank']} baixado do R2 e conferido",
                  f"{w}x{hh} {dur:.1f}s (esperado {want:.1f}s) {len(got.content) / 1048576:.1f} MB · «{c['title'][:50]}»")
    finally:
        for k in [k for k in keys if k]:
            with contextlib.suppress(Exception):
                asyncio.run(media_storage.delete_object(k))
        print("limpeza: objetos de teste removidos do R2")
        app.dependency_overrides.pop(get_db_session, None)
        asyncio.run(engine.dispose())  # sem isso a thread do aiosqlite impede o processo de sair

    print("\n" + ("TUDO OK" if not failures else f"{len(failures)} FALHA(S): " + "; ".join(failures)))
    print("pico final:", mem_mb())
    return 1 if failures else 0


async def _key_of(Session, aid):
    from database.models import MediaAsset

    async with Session() as db:
        return (await db.get(MediaAsset, aid)).r2_key


async def _clip_key(Session, cid):
    from database.models import MediaClip

    async with Session() as db:
        return (await db.get(MediaClip, cid)).r2_key


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] not in ("crop", "fit")):
        sys.exit(__doc__)
    sys.exit(main(Path(sys.argv[1]), sys.argv[2] if len(sys.argv) == 3 else "crop"))
