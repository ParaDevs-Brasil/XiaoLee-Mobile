"""framing.py — reenquadramento 9:16 que segue o rosto em vez de cortar sempre o centro.

    track_faces()  → ffmpeg amostra quadros do trecho, YuNet (OpenCV) acha os rostos: [(t, cx|None)]
    camera_path()  → "câmera virtual": parada enquanto o rosto fica perto, desliza quando ele sai da zona morta
    crop_x_expr()  → a posição horizontal do corte como expressão do ffmpeg (linear por trechos, em função de t)

Tudo roda local e de graça (sem API). Qualquer falha ou ausência de rosto devolve None e o render cai no corte
central de antes — enquadrar melhor nunca pode impedir o corte de sair.
"""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
from pathlib import Path

log = logging.getLogger("xiaolee.framing")

MODEL = Path(__file__).with_name("assets") / "face_detection_yunet_2023mar.onnx"
SAMPLE_FPS = 2.0
SAMPLE_W = 480           # largura da análise: rosto de plano médio ainda tem >30 px e a detecção custa ~ms
MIN_SCORE = 0.7
DEAD_ZONE = 0.10         # fração da largura do corte: o rosto pode andar isso sem a câmera se mexer
MAX_SPEED = 0.30         # largura do corte por segundo: panorâmica suave, sem "chicotear"
MAX_TRAVEL = 0.06        # largura do corte por segundo de percurso: acima disso E indo e voltando (mais que 2x o deslocamento
                         # líquido) a cena é caótica (câmera na mão, várias pessoas): seguir "rostos" balança mais do que
                         # ajuda — vale o corte central de antes
KEY_TOL_PX = 3.0         # tolerância ao simplificar a trajetória em retas
PROBE_TIMEOUT_S = 120


def _probe_size(source: str) -> tuple[int, int]:
    j = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", source],
        capture_output=True, timeout=PROBE_TIMEOUT_S, check=True).stdout)["streams"][0]
    return int(j["width"]), int(j["height"])


def _scan(source: str, start: float, end: float) -> tuple[list[tuple[float, float | None]], int, int]:
    import cv2
    import numpy as np

    w, h = _probe_size(source)
    sw, sh = SAMPLE_W, max(2, round(SAMPLE_W * h / w / 2) * 2)
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", source,
         "-vf", f"fps={SAMPLE_FPS},scale={sw}:{sh}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
        capture_output=True, timeout=PROBE_TIMEOUT_S, check=True).stdout
    frame = sw * sh * 3
    det = cv2.FaceDetectorYN.create(str(MODEL), "", (sw, sh), MIN_SCORE, 0.3, 5000)
    out, prev = [], None
    for i in range(len(raw) // frame):
        img = np.frombuffer(raw, np.uint8, frame, i * frame).reshape(sh, sw, 3)
        faces = det.detect(img)[1]
        cx = None
        if faces is not None and len(faces):
            # o rosto principal: o maior, com preferência pelo que já vinha sendo seguido (não pula entre duas pessoas)
            def score(f):
                c = (f[0] + f[2] / 2) / sw
                return f[2] * f[3] * (1.5 if prev is not None and abs(c - prev) < 0.15 else 1.0)
            f = max(faces, key=score)
            cx = prev = float((f[0] + f[2] / 2) / sw)
        out.append((i / SAMPLE_FPS, cx))
    return out, w, h


async def track_faces(source: str, start: float, end: float):
    """(amostras, largura, altura) ou None se não achou rosto nenhum / algo falhou."""
    try:
        samples, w, h = await asyncio.to_thread(_scan, source, start, end)
    except Exception as exc:
        log.warning("framing: detecção falhou (%s), corte central", str(exc)[:200])
        return None
    if not any(c is not None for _, c in samples):
        return None
    return samples, w, h


async def follow_expr(source: str, start: float, end: float) -> str | None:
    """x do crop como expressão do ffmpeg, ou None para ficar no corte central (sem rosto, cena caótica, falha)."""
    found = await track_faces(source, start, end)
    if not found:
        return None
    samples, w, h = found
    path = camera_path(samples, w, h)
    return crop_x_expr(path) if path else None


def _fill(vals: list[float | None]) -> list[float]:
    idx = [i for i, v in enumerate(vals) if v is not None]
    out = list(vals)
    for i in range(len(vals)):
        if out[i] is None:
            a = max((j for j in idx if j < i), default=None)
            b = min((j for j in idx if j > i), default=None)
            if a is None:
                out[i] = vals[b]
            elif b is None:
                out[i] = vals[a]
            else:
                out[i] = vals[a] + (vals[b] - vals[a]) * (i - a) / (b - a)
    return out


def camera_path(samples: list[tuple[float, float | None]], src_w: int, src_h: int,
                out_w: int = 1080, out_h: int = 1920) -> list[tuple[float, float]] | None:
    """Trajetória [(t, x)] do canto esquerdo do corte, em pixels do vídeo já escalado para out_h de altura.
    None se a cena é caótica demais para seguir (ver MAX_TRAVEL)."""
    scaled_w = src_w * out_h / src_h
    room = scaled_w - out_w
    if room <= 0:  # vídeo já é mais estreito que 9:16: não há para onde mover
        return None
    targets = _fill([c for _, c in samples])
    # mediana de 3: um quadro errado do detector não vira um tranco de câmera
    targets = [sorted(targets[max(0, i - 1):i + 2])[len(targets[max(0, i - 1):i + 2]) // 2] for i in range(len(targets))]
    xs = [min(max(c * scaled_w - out_w / 2, 0.0), room) for c in targets]
    cam = sorted(xs)[len(xs) // 2]
    dt, dead, vmax = 1 / SAMPLE_FPS, DEAD_ZONE * out_w, MAX_SPEED * out_w / SAMPLE_FPS
    path = []
    for (t, _), x in zip(samples, xs):
        if abs(x - cam) > dead:
            cam += max(-vmax, min(vmax, x - cam))
        path.append((t, cam))
    travel = sum(abs(b - a) for (_, a), (_, b) in zip(path, path[1:]))
    if travel / max(samples[-1][0], 1.0) > MAX_TRAVEL * out_w and travel > 2 * abs(path[-1][1] - path[0][1]):
        return None  # vai e volta o tempo todo; quem só caminha numa direção é seguido normalmente
    return _simplify(path)


def _simplify(path: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Ramer–Douglas–Peucker: só guarda os pontos onde a trajetória realmente muda de direção."""
    if len(path) < 3:
        return path
    (t0, x0), (t1, x1) = path[0], path[-1]
    worst, wi = 0.0, 0
    for i in range(1, len(path) - 1):
        t, x = path[i]
        d = abs(x - (x0 + (x1 - x0) * (t - t0) / (t1 - t0)))
        if d > worst:
            worst, wi = d, i
    if worst <= KEY_TOL_PX:
        return [path[0], path[-1]]
    return _simplify(path[:wi + 1])[:-1] + _simplify(path[wi:])


def crop_x_expr(path: list[tuple[float, float]]) -> str:
    """Expressão do ffmpeg para o x do crop. Constante quando a câmera não se mexe."""
    if len(path) == 1 or max(x for _, x in path) - min(x for _, x in path) < 1:
        return f"{path[0][1]:.0f}"
    expr = f"{path[-1][1]:.1f}"
    for (t0, x0), (t1, x1) in reversed(list(zip(path, path[1:]))):
        expr = f"if(lt(t,{t1:.2f}),{x0:.1f}+({x1 - x0:.1f})*(t-{t0:.2f})/{t1 - t0:.2f},{expr})"
    return expr
