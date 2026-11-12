"""
creator_cost_probe.py — mede o custo/latência REAIS de um vídeo de criador sintético:
roteiro (fixo) -> voz ElevenLabs -> vídeo (fal.ai, foto + áudio) -> mp4 local.
Ver docs/ARQUITETURA_CRIADORES_SINTETICOS.md.

Chaves em ~/.config/xiaolee/creators.env (nunca impressas):
    ELEVENLABS_API_KEY=...   ELEVENLABS_VOICE_ID=...
    FAL_KEY=...              FAL_VIDEO_MODEL=<id1,id2,id3 na fal.ai, foto+áudio -> vídeo; gera um mp4 por modelo>
    FAL_USD_PER_SEC=0.0      (preço do modelo escolhido, da página dele; o script só multiplica)

Uso:
    cd backend && ../.venv/bin/python scripts/creator_cost_probe.py foto.jpg "Fala do criador" [saida.mp4]
Cada execução gasta créditos de verdade; rode 1 vez antes de repetir.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
from pathlib import Path

import httpx

ENV = Path.home() / ".config/xiaolee/creators.env"


def load_env() -> dict[str, str]:
    out = {}
    for line in ENV.read_text().splitlines() if ENV.exists() else []:
        k, sep, v = line.partition("=")
        if sep and not k.startswith("#"):
            out[k.strip()] = v.strip()
    return out


async def main(photo: Path, text: str, out: Path) -> None:
    env = load_env()
    missing = [k for k in ("ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "FAL_KEY", "FAL_VIDEO_MODEL") if not env.get(k)]
    if missing:
        sys.exit(f"faltam em {ENV}: {', '.join(missing)}")

    async with httpx.AsyncClient(timeout=120) as http:
        t0 = time.monotonic()
        r = await http.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{env['ELEVENLABS_VOICE_ID']}",
            headers={"xi-api-key": env["ELEVENLABS_API_KEY"]},
            json={"text": text, "model_id": "eleven_multilingual_v2",
                  "voice_settings": {"stability": 0.4, "similarity_boost": 0.8, "style": 0.35, "use_speaker_boost": True}},
        )
        r.raise_for_status()
        audio = r.content
        print(f"voz: {len(audio)} bytes, {len(text)} chars, {time.monotonic() - t0:.1f}s")

        fal = {"Authorization": f"Key {env['FAL_KEY']}"}
        for model in env["FAL_VIDEO_MODEL"].split(","):
            model = model.strip()
            dest = out.with_name(f"{out.stem}_{model.replace('/', '_')}.mp4")
            t1 = time.monotonic()
            try:
                url = await fal_video(http, fal, model, photo, audio)
                dest.write_bytes((await http.get(url)).content)
            except Exception as e:  # um modelo ruim não derruba a comparação
                print(f"{model}: FALHOU {type(e).__name__}: {e}")
                continue
            report(dest, time.monotonic() - t1, model, env)


async def fal_upload(http, fal, b: bytes, mime: str, name: str) -> str:
    """Sobe p/ o storage da fal e devolve URL pública; Fabric/OmniHuman recusam data: URI."""
    r = await http.post("https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
                        headers=fal, json={"content_type": mime, "file_name": name})
    r.raise_for_status()
    up = r.json()
    (await http.put(up["upload_url"], content=b, headers={"Content-Type": mime})).raise_for_status()
    return up["file_url"]


async def fal_video(http, fal, model, photo: Path, audio: bytes) -> str:
    image_url = await fal_upload(http, fal, photo.read_bytes(), "image/png" if photo.suffix == ".png" else "image/jpeg", photo.name)
    audio_url = await fal_upload(http, fal, audio, "audio/mpeg", "voice.mp3")
    extra = {"resolution": os.environ.get("FAL_RESOLUTION", "720p")} if model.startswith("veed/fabric") else {}  # ponytail: campos extras por modelo; vira config no adaptador
    r = await http.post(f"https://queue.fal.run/{model}", headers=fal,
                        json={"image_url": image_url, "audio_url": audio_url, **extra})
    r.raise_for_status()
    job = r.json()
    # ponytail: poll fixo de 5s, até ~10 min; webhook quando virar worker de verdade
    for _ in range(120):
        s = (await http.get(job["status_url"], headers=fal)).json()
        if s["status"] == "COMPLETED":
            break
        if s["status"] not in ("IN_QUEUE", "IN_PROGRESS"):
            raise RuntimeError(f"status {s}")
        await asyncio.sleep(5)
    else:
        raise TimeoutError("fal: timeout")
    result = (await http.get(job["response_url"], headers=fal)).json()
    url = (result.get("video") or {}).get("url")
    if not url:
        raise RuntimeError(f"resposta sem video.url (chaves: {list(result)})")
    return url


def report(out: Path, gen_s: float, model: str, env: dict) -> None:
    # duração real do arquivo p/ calcular custo
    import subprocess
    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True, check=True).stdout)
    usd = dur * float(env.get("FAL_USD_PER_SEC", "0"))
    print(f"{model}: {out} {dur:.1f}s de vídeo, geração {gen_s:.0f}s, custo vídeo ~US${usd:.3f} (+ voz, ver painel ElevenLabs)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    asyncio.run(main(Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3] if len(sys.argv) > 3 else "creator_probe.mp4")))
