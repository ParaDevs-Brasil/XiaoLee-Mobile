"""
clipper_prod_smoke.py — mesma prova do clipper_e2e.py, mas contra um backend JÁ no ar (produção/staging).

    POST /v1/media → PUT direto no R2 → POST /complete → POST /clips → baixa os cortes → DELETE

Não importa o app nem toca banco local: só HTTP. Apaga a mídia que criou no final (os cortes saem junto).

Uso (o token é de uma conta de TESTE; nunca é impresso):
    XIAOLEE_API_URL=https://xiaolee-mobile-api-production.up.railway.app \
    XIAOLEE_TEST_BEARER=... \
    python scripts/clipper_prod_smoke.py <video-curto.mp4> [auto|crop|fit]
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import httpx

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'OK  ' if ok else 'FAIL'} {label}" + (f" — {detail}" if detail else ""), flush=True)
    if not ok:
        failures.append(label)


def poll(fetch, done, every: float = 5, timeout: float = 900):
    """Repete `fetch` até `done(resultado)` ou estourar `timeout` (devolve o último resultado)."""
    end = time.time() + timeout
    while True:
        out = fetch()
        if done(out) or time.time() > end:
            return out
        time.sleep(every)


def main(video: Path, layout: str) -> int:
    base = os.environ["XIAOLEE_API_URL"].rstrip("/")
    h = {"Authorization": f"Bearer {os.environ['XIAOLEE_TEST_BEARER']}"}
    size = video.stat().st_size
    aid = None
    with httpx.Client(base_url=base, headers=h, timeout=None) as api:
        try:
            r = api.get("/v1/media/glossary")
            check(r.status_code == 200, "rotas de media existem e o token vale", f"HTTP {r.status_code}")
            if r.status_code != 200:
                return 1

            r = api.post("/v1/media", json={"filename": video.name, "content_type": "video/mp4", "size_bytes": size})
            check(r.status_code == 200, "POST /v1/media devolve URL pré-assinada", f"HTTP {r.status_code}")
            if r.status_code != 200:
                return 1
            up = r.json()
            aid = up["asset"]["id"]

            t = time.time()
            with httpx.Client(timeout=None) as r2:  # sem o Bearer: a URL pré-assinada já carrega a assinatura
                put = r2.put(up["upload_url"], content=video.read_bytes(),
                             headers={**up["upload_headers"], "Content-Length": str(size)})
            check(put.status_code == 200, "upload direto ao R2", f"HTTP {put.status_code} · {time.time() - t:.0f}s")

            t = time.time()
            r = api.post(f"/v1/media/{aid}/complete")  # a transcrição roda em background no servidor
            d = poll(lambda: api.get(f"/v1/media/{aid}").json(), lambda d: d["status"] in ("transcribed", "failed", "expired"))
            check(d["status"] == "transcribed", "mídia transcrita", f"status={d['status']} {d.get('error') or ''} · {time.time() - t:.0f}s")
            if d["status"] != "transcribed":
                return 1

            t = time.time()
            r = api.post(f"/v1/media/{aid}/clips?layout={layout}")
            check(r.status_code == 200, "POST /clips", f"HTTP {r.status_code} {r.text[:120] if r.status_code != 200 else ''}")
            clips = poll(lambda: api.get(f"/v1/media/{aid}/clips").json(),
                         lambda cs: bool(cs) and all(c["status"] in ("ready", "failed", "expired") for c in cs)) if r.status_code == 200 else []
            check(bool(clips) and all(c["status"] == "ready" for c in clips),
                  "cortes prontos", f"{[c['status'] for c in clips]} · {time.time() - t:.0f}s")
            for c in clips:
                got = httpx.get(c["download_url"], timeout=None)
                check(got.status_code == 200 and len(got.content) > 50_000,
                      f"corte #{c['rank']} baixa do R2", f"{len(got.content) / 1048576:.1f} MB · «{c['title'][:50]}»")
        finally:
            if aid:
                r = api.delete(f"/v1/media/{aid}")
                print(f"limpeza: DELETE /v1/media/{aid} → HTTP {r.status_code}")

    print("\n" + ("TUDO OK" if not failures else f"{len(failures)} FALHA(S): " + "; ".join(failures)))
    return 1 if failures else 0


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] not in ("crop", "fit", "auto")):
        sys.exit(__doc__)
    sys.exit(main(Path(sys.argv[1]), sys.argv[2] if len(sys.argv) == 3 else "auto"))
