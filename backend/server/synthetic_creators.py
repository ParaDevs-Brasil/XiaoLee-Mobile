"""
synthetic_creators.py — vídeo falado de uma persona: roteiro → voz (ElevenLabs) → vídeo (fal.ai) → R2.

Medido em 2026-10-18 com scripts/creator_cost_probe.py (ver docs/ARQUITETURA_CRIADORES_SINTETICOS.md).
Preço = custo do provedor x2, cobrado em USDC no Arc antes de gastar na fal (ver synthetic_creator_routes.py).
Persona pode ser o próprio rosto, personagem ou meme (termo de direitos aceito no app). O Seedance 2.0 na fal\nrecusa pessoa real e IP de terceiros — regra do provedor, não contornar; Fabric/OmniHuman aceitam.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import math
import os
import subprocess
import tempfile

import httpx

from server import clipper, media_storage
from server.settings import settings

logger = logging.getLogger(__name__)

PRICE_MULTIPLIER = 2
DURATIONS_S = (5, 10, 15)
WORDS_PER_S = 2.6  # fala natural; o roteiro é cortado nesse teto para caber na duração paga

# quality -> modelo na fal, custo por segundo (US$, página do modelo em 2026-10-20) e campos extras.
QUALITIES: dict[str, dict] = {
    "standard": {"label": "Standard", "hint": "480p", "model": "veed/fabric-1.0", "usd_per_s": 0.08,
                 "extra": {"resolution": "480p"}},
    "pro": {"label": "Pro", "hint": "Higher quality", "model": "fal-ai/bytedance/omnihuman", "usd_per_s": 0.14, "extra": {}},
    "pro_seedance": {"label": "Pro+", "hint": "720p. No real people or known characters", "model": "bytedance/seedance-2.0/reference-to-video",
                     "usd_per_s": 0.3034, "extra": {"resolution": "720p", "aspect_ratio": "9:16"}},
    # Mimic (motion swap): o personagem da foto repete o movimento de um vídeo de referência. Sem voz sintética —
    # o áudio do vídeo de referência é removido antes de ir à fal. Preços da página da fal em 2026-10-22.
    "mimic": {"label": "Standard", "hint": "Lowest price", "kind": "mimic", "usd_per_s": 0.07, "extra": {},
              "model": "fal-ai/kling-video/v2.6/standard/motion-control"},
    "mimic_v3": {"label": "Plus", "hint": "Newer model", "kind": "mimic", "usd_per_s": 0.126, "extra": {},
                 "model": "fal-ai/kling-video/v3/standard/motion-control"},
    "mimic_v3_pro": {"label": "Pro", "hint": "Top quality", "kind": "mimic", "usd_per_s": 0.168, "extra": {},
                     "model": "fal-ai/kling-video/v3/pro/motion-control"},
}

AUDIO_MODES = ("none", "original", "voice")  # mimic: sem som | som do vídeo de referência | narração com a voz da persona
MOTION_TYPES = ("video/mp4", "video/quicktime", "video/webm")
MAX_MOTION_BYTES = 100 * 1024 * 1024
MIMIC_DEFAULT_PROMPT = "The character performs the same movement as the reference video."


def kind(quality: str) -> str:
    """`speech`: persona fala um roteiro (voz + vídeo). `mimic`: persona repete o movimento de um vídeo."""
    return QUALITIES[quality].get("kind", "speech")

# Vozes prontas (premade) do ElevenLabs — funcionam no plano atual; vozes da biblioteca dão 402.
# Sem clonagem de voz de propósito: evita deepfake de voz real.
VOICES: list[dict] = [
    {"id": "EXAVITQu4vr4xnSDxMaL", "name": "Sarah", "gender": "female"},
    {"id": "FGY2WhTYpPnrIDTdsKH5", "name": "Laura", "gender": "female"},
    {"id": "cgSgspJ2msm6clMCkdW9", "name": "Jessica", "gender": "female"},
    {"id": "pFZP5JQG7iQjIQuC4Bku", "name": "Lily", "gender": "female"},
    {"id": "nPczCjzI2devNBz1zQrb", "name": "Brian", "gender": "male"},
    {"id": "N2lVS1w4EtoT3dr4eOWO", "name": "Callum", "gender": "male"},
    {"id": "TX3LPaxmHKxFdv7VOQHJ", "name": "Liam", "gender": "male"},
    {"id": "JBFqnCBsd6RMkjVDRZzb", "name": "George", "gender": "male"},
]
VOICE_IDS = {v["id"] for v in VOICES}

FAL_POLL_S = 5
FAL_TIMEOUT_S = 15 * 60


def price_usdc(quality: str, duration_s: int) -> float:
    """Preço cobrado, arredondado para cima no centavo."""
    q = QUALITIES[quality]
    # round antes do ceil: 0.14*5*2*100 dá 140.00000000000003 e viraria 1.41
    return math.ceil(round(q["usd_per_s"] * duration_s * PRICE_MULTIPLIER * 100, 6)) / 100


def max_words(duration_s: int) -> int:
    return int(duration_s * WORDS_PER_S)


def pricing() -> list[dict]:
    return [
        {"quality": k, "label": q["label"], "hint": q["hint"], "kind": kind(k), "prices": {str(d): price_usdc(k, d) for d in DURATIONS_S}}
        for k, q in QUALITIES.items()
    ]


def enabled() -> bool:
    return bool(settings.elevenlabs_api_key and settings.fal_key and settings.creators_pay_to)


async def write_script(topic: str, duration_s: int, persona: str) -> str:
    """Roteiro falado curto (Claude), no idioma do tema, dentro do limite de palavras da duração."""
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=30, max_retries=1)
    resp = await client.messages.create(
        model=settings.anthropic_model,
        max_tokens=400,
        system=(
            f"You write the spoken lines for {persona}, an original social-media persona talking straight to camera. "
            f"At most {max_words(duration_s)} words, one take, no stage directions, no hashtags, no emojis, "
            "no quotes around the text. Write in the same language as the topic."
        ),
        messages=[{"role": "user", "content": topic}],
    )
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    return clip_words(text, duration_s)


def clip_words(text: str, duration_s: int) -> str:
    words = text.split()
    return " ".join(words[: max_words(duration_s)])


async def _tts(http: httpx.AsyncClient, voice_id: str, text: str) -> bytes:
    r = await http.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={"xi-api-key": settings.elevenlabs_api_key},
        json={"text": text, "model_id": "eleven_multilingual_v2",
              "voice_settings": {"stability": 0.4, "similarity_boost": 0.8, "style": 0.35, "use_speaker_boost": True}},
    )
    r.raise_for_status()
    return r.content


async def _trim_audio(audio: bytes, duration_s: int) -> bytes:
    """Corta a voz na duração paga: Fabric/OmniHuman geram vídeo do tamanho do áudio e cobram por segundo."""
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, "in.mp3"), os.path.join(tmp, "out.mp3")
        with open(src, "wb") as f:
            f.write(audio)
        await clipper.run_ffmpeg(["-i", src, "-t", str(duration_s), "-c:a", "libmp3lame", "-q:a", "3", "-y", dst],
                                 src, 60)
        with open(dst, "rb") as f:
            return f.read()


async def _fal_upload(http: httpx.AsyncClient, data: bytes, mime: str, name: str) -> str:
    """Storage da fal (URL pública); Fabric/OmniHuman recusam data: URI."""
    fal = {"Authorization": f"Key {settings.fal_key}"}
    r = await http.post("https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
                        headers=fal, json={"content_type": mime, "file_name": name})
    r.raise_for_status()
    up = r.json()
    (await http.put(up["upload_url"], content=data, headers={"Content-Type": mime})).raise_for_status()
    return up["file_url"]


def mimic_input(image_url: str, video_url: str, prompt: str) -> dict:
    # `video`: segue a orientação do vídeo de referência (até 30 s, corpo inteiro); `image` limita a 10 s.
    return {"image_url": image_url, "video_url": video_url, "character_orientation": "video",
            "prompt": prompt or MIMIC_DEFAULT_PROMPT}


async def probe_duration(url: str) -> float:
    """Duração do vídeo de referência (ffprobe lê pela URL pré-assinada, sem baixar tudo)."""
    def _run():
        return subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", url],
            stdin=subprocess.DEVNULL, capture_output=True, timeout=30,
        )

    try:
        r = await asyncio.to_thread(_run)
        return float(r.stdout.decode().strip())
    except (subprocess.TimeoutExpired, ValueError):
        raise ValueError("could not read the reference video")


def fal_input(quality: str, image_url: str, audio_url: str, duration_s: int) -> dict:
    q = QUALITIES[quality]
    if quality == "pro_seedance":
        return {
            "prompt": ("The person in @Image1 talks directly to the camera, saying the words in @Audio1 with "
                       "accurate lip-sync, natural gestures, vertical social video."),
            "image_urls": [image_url], "audio_urls": [audio_url], "duration": str(duration_s), **q["extra"],
        }
    return {"image_url": image_url, "audio_url": audio_url, **q["extra"]}


async def _fal_run(http: httpx.AsyncClient, model: str, payload: dict, timeout_s: int = FAL_TIMEOUT_S) -> dict:
    """Fila da fal: envia, espera terminar e devolve o JSON do resultado."""
    fal = {"Authorization": f"Key {settings.fal_key}"}
    r = await http.post(f"https://queue.fal.run/{model}", headers=fal, json=payload)
    r.raise_for_status()
    job = r.json()
    # ponytail: poll de 5 s no processo (workers=1); webhook da fal se houver mais de um worker
    for _ in range(timeout_s // FAL_POLL_S):
        s = (await http.get(job["status_url"], headers=fal)).json()
        if s["status"] == "COMPLETED":
            break
        if s["status"] not in ("IN_QUEUE", "IN_PROGRESS"):
            raise RuntimeError(f"fal status {s.get('status')}")
        await asyncio.sleep(FAL_POLL_S)
    else:
        raise TimeoutError("fal timeout")
    return (await http.get(job["response_url"], headers=fal)).json()


async def _fal_video(http: httpx.AsyncClient, model: str, payload: dict) -> str:
    result = await _fal_run(http, model, payload)
    url = (result.get("video") or {}).get("url")
    if not url:
        # `detail` é o motivo que a fal dá (validação, moderação); vai só para o log, nunca para o app.
        raise RuntimeError(f"fal response without video.url ({str(result.get('detail', list(result)))[:300]})")
    return url


async def render(*, quality: str, voice_id: str, script: str, duration_s: int,
                 ref_image_key: str, ref_content_type: str, video_key: str, on_step=None) -> None:
    """Gera o vídeo e grava em `video_key` no R2. `on_step(nome)` marca o progresso no banco."""
    async def step(name: str):
        if on_step:
            await on_step(name)

    async with httpx.AsyncClient(timeout=120) as http:
        await step("voice")
        audio = await _trim_audio(await _tts(http, voice_id, script), duration_s)
        await step("video")
        image = (await http.get(media_storage.presign_get(ref_image_key))).raise_for_status().content
        image_url = await _fal_upload(http, image, ref_content_type, "ref" + _ext(ref_content_type))
        audio_url = await _fal_upload(http, audio, "audio/mpeg", "voice.mp3")
        model = QUALITIES[quality]["model"]
        url = await _fal_video(http, model, fal_input(quality, image_url, audio_url, duration_s))
        video = (await http.get(url)).raise_for_status().content

    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        f.write(video)
        f.flush()
        await media_storage.upload_file(f.name, video_key, "video/mp4")


def _ext(content_type: str) -> str:
    return {"image/png": ".png", "image/webp": ".webp"}.get(content_type, ".jpg")


async def mux_audio(video: bytes, audio: bytes) -> bytes:
    """Cola a faixa de áudio no vídeo gerado (vídeo sem recodificar; o mais curto manda)."""
    with tempfile.TemporaryDirectory() as tmp:
        v, a, dst = (os.path.join(tmp, n) for n in ("v.mp4", "a.m4a", "out.mp4"))
        for path, data in ((v, video), (a, audio)):
            with open(path, "wb") as f:
                f.write(data)
        await clipper.run_ffmpeg(["-i", v, "-i", a, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",
                                  "-shortest", "-movflags", "+faststart", "-y", dst], v, 120)
        with open(dst, "rb") as f:
            return f.read()


async def _motion_and_sound(http: httpx.AsyncClient, motion: bytes, duration_s: int, audio: str, voice_id: str,
                            script: str) -> tuple[bytes, bytes | None]:
    """(movimento cortado e SEM áudio para a fal, áudio a colar no resultado ou None)."""
    with tempfile.TemporaryDirectory() as tmp:
        src, dst, track = (os.path.join(tmp, n) for n in ("motion_in", "motion.mp4", "orig.m4a"))
        with open(src, "wb") as f:
            f.write(motion)
        await clipper.run_ffmpeg(["-i", src, "-t", str(duration_s), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                                  "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", "-y", dst], src, 180)
        with open(dst, "rb") as f:
            cut = f.read()
        if audio == "voice":
            return cut, await _trim_audio(await _tts(http, voice_id, script), duration_s)
        if audio == "original":
            # Referência sem faixa de áudio: o ffmpeg falha e o vídeo segue mudo, em vez de perder o pedido já pago.
            try:
                await clipper.run_ffmpeg(["-i", src, "-t", str(duration_s), "-vn", "-c:a", "aac", "-y", track], src, 60)
                with open(track, "rb") as f:
                    return cut, f.read()
            except RuntimeError:
                pass
        return cut, None


async def render_mimic(*, quality: str, prompt: str, duration_s: int, ref_image_key: str, ref_content_type: str,
                       motion_key: str, video_key: str, audio: str = "none", voice_id: str = "", script: str = "",
                       on_step=None) -> None:
    """Persona + vídeo de movimento → vídeo. A fal recebe o movimento cortado na duração paga e SEM áudio (`-an`):
    a música ou a voz do vídeo de referência só voltam se o usuário escolheu `audio="original"`, e voltam por aqui
    (ffmpeg), não pelo modelo. `audio="voice"` narra `script` com a voz da persona."""
    if on_step:
        await on_step("video")
    async with httpx.AsyncClient(timeout=120) as http:
        image = (await http.get(media_storage.presign_get(ref_image_key))).raise_for_status().content
        motion = (await http.get(media_storage.presign_get(motion_key))).raise_for_status().content
        cut, sound = await _motion_and_sound(http, motion, duration_s, audio, voice_id, script)
        image_url = await _fal_upload(http, image, ref_content_type, "ref" + _ext(ref_content_type))
        video_url = await _fal_upload(http, cut, "video/mp4", "motion.mp4")
        url = await _fal_video(http, QUALITIES[quality]["model"], mimic_input(image_url, video_url, prompt))
        video = (await http.get(url)).raise_for_status().content
    if sound:
        video = await mux_audio(video, sound)

    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        f.write(video)
        f.flush()
        await media_storage.upload_file(f.name, video_key, "video/mp4")


# --- Swap: quadro de prévia + trava de foto real ---------------------------------------------------------------
# Como o Mimic 2 do Creathoon: um modelo de imagem compõe o personagem no lugar da pessoa do primeiro quadro do vídeo;
# o usuário aprova esse quadro e só então o vídeo é gerado (Kling) a partir dele, com o cenário já certo.

FRAME_MODEL = "fal-ai/nano-banana/edit"
FRAME_ASPECTS = {"21:9": 21 / 9, "16:9": 16 / 9, "3:2": 3 / 2, "4:3": 4 / 3, "5:4": 5 / 4, "1:1": 1.0, "4:5": 4 / 5,
                 "3:4": 3 / 4, "2:3": 2 / 3, "9:16": 9 / 16}
FRAME_PROMPT = ("Replace the person in the center of the first image with the character from the second image. Keep the "
                "background, the lighting, the camera framing, the body pose and everything else in the first image "
                "exactly as it is. The character keeps its own face, hair, clothes and style. Photorealistic result.")


def closest_aspect(width: int, height: int) -> str:
    """O aspect_ratio aceito pelo modelo de imagem mais próximo do vídeo (o quadro sai no formato do vídeo)."""
    ratio = width / height
    return min(FRAME_ASPECTS, key=lambda k: abs(FRAME_ASPECTS[k] - ratio))


async def read_object(key: str) -> bytes:
    """Bytes de um arquivo do R2 (pela URL de leitura temporária)."""
    async with httpx.AsyncClient(timeout=60) as http:
        return (await http.get(media_storage.presign_get(key))).raise_for_status().content


async def probe_size(url: str) -> tuple[int, int]:
    def _run():
        return subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", url],
            stdin=subprocess.DEVNULL, capture_output=True, timeout=30,
        )

    try:
        w, h = (await asyncio.to_thread(_run)).stdout.decode().strip().split(",")[:2]
        return int(w), int(h)
    except (subprocess.TimeoutExpired, ValueError):
        raise ValueError("could not read the reference video")


async def compose_frame(*, motion_key: str, ref_image_key: str, ref_content_type: str) -> bytes:
    """PNG do primeiro quadro do vídeo com o personagem no lugar da pessoa. O ffmpeg lê o vídeo pela URL pré-assinada
    (só o começo; nada de baixar 100 MB)."""
    video_url = media_storage.presign_get(motion_key)
    width, height = await probe_size(video_url)
    with tempfile.TemporaryDirectory() as tmp:
        frame = os.path.join(tmp, "frame.png")
        await clipper.run_ffmpeg(["-ss", "0.5", "-i", video_url, "-frames:v", "1", "-y", frame], video_url, 60)
        with open(frame, "rb") as f:
            frame_png = f.read()
    image = await read_object(ref_image_key)
    async with httpx.AsyncClient(timeout=120) as http:
        frame_url = await _fal_upload(http, frame_png, "image/png", "frame.png")
        char_url = await _fal_upload(http, image, ref_content_type, "char" + _ext(ref_content_type))
        result = await _fal_run(http, FRAME_MODEL, {
            "prompt": FRAME_PROMPT, "image_urls": [frame_url, char_url], "output_format": "png", "num_images": 1,
            "aspect_ratio": closest_aspect(width, height),
        }, timeout_s=180)
        images = result.get("images") or []
        if not images:
            raise RuntimeError(f"fal response without images ({str(result.get('detail', list(result)))[:300]})")
        return (await http.get(images[0]["url"])).raise_for_status().content


_KIND_SYSTEM = (
    "You are a content-safety filter. Look at ONE image and say what kind it is. Never try to identify who anyone is. "
    "'real_person_photo': a photograph, or a photorealistic image, of a real human being (selfie, portrait, event photo, "
    "screenshot of a real person). 'character': an illustration, cartoon, anime, mascot, or a 3D / game / film render of a "
    "fictional character. 'unsure': you cannot tell."
)
_KIND_TOOL = {
    "name": "report_kind",
    "description": "Report the kind of image.",
    "input_schema": {"type": "object", "properties": {"kind": {"type": "string", "enum": ["real_person_photo", "character", "unsure"]}},
                     "required": ["kind"]},
}


async def image_kind(image: bytes, content_type: str) -> str:
    """`real_person_photo` | `character` | `unsure`. Sem chave ou com falha devolve `unsure`: quem chama bloqueia (a trava
    falha fechada). Não identifica ninguém; só separa foto de gente de personagem."""
    import anthropic

    if not settings.anthropic_api_key:
        return "unsure"
    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=30, max_retries=1)
        msg = await client.messages.create(
            model=settings.anthropic_model, max_tokens=100, system=_KIND_SYSTEM, tools=[_KIND_TOOL],
            tool_choice={"type": "tool", "name": "report_kind"},
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": content_type, "data": base64.b64encode(image).decode()}},
                {"type": "text", "text": "What kind of image is this?"}]}],
        )
        block = next((b for b in msg.content if b.type == "tool_use"), None)
        kind_ = block.input.get("kind") if block else None
        return kind_ if kind_ in ("real_person_photo", "character", "unsure") else "unsure"
    except Exception as exc:
        logger.warning("image kind check failed: %s", type(exc).__name__)
        return "unsure"
