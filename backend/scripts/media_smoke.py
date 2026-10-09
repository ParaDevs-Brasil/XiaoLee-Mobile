"""
media_smoke.py — prova REAL do Media Repository + transcrição (Plane #27/#28).

Roda o mesmo código de produção contra o storage e o Whisper configurados:
  1. URL pré-assinada de PUT com o tamanho certo  → 200
  2. PUT com tamanho errado                       → recusado (a assinatura trava o tamanho)
  3. objeto confere no bucket (head_object)
  4. ffmpeg lê o vídeo pela URL de leitura e extrai o áudio
  5. Whisper transcreve e devolve segmentos com timestamps
  6. limpa o objeto de teste

Uso (com as variáveis R2_*/GROQ_API_KEY no ambiente ou no .env; NUNCA imprime segredos):
    cd backend && ../.venv/bin/python scripts/media_smoke.py [caminho/de/um/video-ou-audio-com-fala]

Sem argumento, gera 20 s de tom puro: valida o encanamento, mas a transcrição
sai vazia (não há fala). Para provar o #28 de verdade, passe um vídeo com fala
(idealmente de ~1 h, que é o critério de aceite).
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from server import media_routes, media_storage  # noqa: E402
from server.settings import settings  # noqa: E402

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'OK  ' if ok else 'FAIL'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(label)


async def main(path_arg: str | None) -> int:
    print("config")
    storage_ok = True
    try:
        media_storage._client()
    except media_storage.StorageNotConfigured as exc:
        storage_ok = False
        print(f"  FAIL storage: {exc}")
    asr_ok = bool(settings.transcription_api_key)
    print(f"  storage: {'configurado' if storage_ok else 'AUSENTE'} · transcrição: "
          f"{'configurada (' + settings.transcription_model + ')' if asr_ok else 'AUSENTE (GROQ_API_KEY/TRANSCRIPTION_API_KEY)'}")
    if not storage_ok:
        return 2

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(path_arg) if path_arg else Path(tmp) / "tone.mp4"
        if not path_arg:
            subprocess.run(
                ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=20",
                 "-f", "lavfi", "-i", "color=c=black:s=320x180:d=20", "-shortest", "-y", str(src)],
                check=True,
            )
        data = src.read_bytes()
        content_type = "video/mp4" if src.suffix.lower() in (".mp4", ".m4v") else "application/octet-stream"
        key = f"smoke/{uuid.uuid4().hex}/{src.name}"
        print(f"arquivo: {src.name} ({len(data)} bytes)")

        try:
            print("upload")
            url = media_storage.presign_put(key, content_type, len(data))
            async with httpx.AsyncClient(timeout=600) as http:
                bad = await http.put(url, content=data + b"x", headers={"Content-Type": content_type})
                check(bad.status_code in (400, 403), "PUT com tamanho errado é recusado", f"HTTP {bad.status_code}")
                good = await http.put(url, content=data, headers={"Content-Type": content_type})
                check(good.status_code == 200, "PUT com o tamanho certo", f"HTTP {good.status_code}")
            size = await media_storage.object_size(key)
            check(size == len(data), "objeto confere no bucket", f"{size} bytes")

            print("áudio")
            audio = Path(tmp) / "audio.mp3"
            t0 = time.monotonic()
            await media_routes._extract_audio(media_storage.presign_get(key), str(audio))
            check(audio.exists() and audio.stat().st_size > 0, "ffmpeg extrai áudio pela URL do bucket",
                  f"{audio.stat().st_size} bytes em {time.monotonic() - t0:.1f}s")
            plan = await media_routes._plan_chunks(str(audio))
            check(plan[-1][1] <= media_routes.MAX_AUDIO_S, f"duração dentro do teto ({media_routes.MAX_AUDIO_S // 3600} h)",
                  f"{plan[-1][1]:.0f}s em {len(plan)} janela(s) de ~{media_routes.CHUNK_S:.0f}s")

            print("transcrição")
            if not asr_ok:
                print("  PULADO — sem chave de transcrição")
            else:
                t0 = time.monotonic()
                result = await media_routes._transcribe(str(audio))
                segs = result["segments"]
                check(bool(segs) or not path_arg, "Whisper devolve segmentos",
                      f"{len(segs)} segmentos, língua={result.get('language')}, duração={result.get('duration')}s, {time.monotonic() - t0:.1f}s")
                if segs:
                    check(all(s["end"] >= s["start"] for s in segs), "timestamps coerentes")
                    check(all(a["end"] <= b["start"] + 0.5 for a, b in zip(segs, segs[1:])), "segmentos em ordem entre as janelas")
                    check(any(s.get("words") for s in segs), "palavras com timestamp",
                          f"{sum(len(s.get('words', [])) for s in segs)} palavras")
                    print(f"  amostra: [{segs[0]['start']:.1f}s] {segs[0]['text'][:80]!r}")
                elif not path_arg:
                    print("  (tom puro: sem fala, segmentos vazios é esperado — passe um vídeo com fala)")
        finally:
            await asyncio.to_thread(media_storage._client().delete_object, Bucket=settings.r2_bucket, Key=key)
            print("limpeza: objeto de teste removido")

    print("\n" + ("TUDO OK" if not failures else f"{len(failures)} FALHA(S): " + "; ".join(failures)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else None)))
