"""Reenquadramento por rosto: trajetória da câmera (puro) + detecção e render de verdade num rosto fora do centro."""

import asyncio
import subprocess
from pathlib import Path

import pytest

from server import clipper, framing

FIXTURE = str(Path(__file__).parent / "fixtures" / "face_off_center.mp4")  # 6 s, rosto a ~21% da largura


def _samples(cxs, fps=framing.SAMPLE_FPS):
    return [(i / fps, c) for i, c in enumerate(cxs)]


def test_still_speaker_gets_a_fixed_crop_even_with_detector_noise():
    cxs = [0.50, 0.51, 0.49, 0.50, 0.52, 0.50, 0.49, 0.51] * 4
    path = framing.camera_path(_samples(cxs), 1920, 1080)
    assert framing.crop_x_expr(path).replace(".", "").isdigit()  # constante: câmera parada


def test_off_center_speaker_is_centered_and_clamped_to_the_frame():
    path = framing.camera_path(_samples([0.1] * 10), 1920, 1080)  # rosto colado na borda esquerda
    assert path[0][1] == 0  # não passa do vídeo
    path = framing.camera_path(_samples([0.25] * 10), 1920, 1080)
    scaled_w = 1920 * 1920 / 1080
    assert path[0][1] == pytest.approx(0.25 * scaled_w - 540, abs=1)  # rosto no meio do corte


def test_moving_speaker_is_followed_without_whipping():
    cxs = [0.3 + 0.4 * i / 40 for i in range(41)]  # anda devagar de 30% a 70% em 20 s
    path = framing.camera_path(_samples(cxs), 1920, 1080)
    assert path[-1][1] > path[0][1] + 500  # acompanhou
    for (t0, x0), (t1, x1) in zip(path, path[1:]):
        assert abs(x1 - x0) / (t1 - t0) <= framing.MAX_SPEED * 1080 + 1  # nunca mais rápido que o teto


def test_missing_detections_are_bridged_and_a_chaotic_scene_falls_back():
    gap = framing.camera_path(_samples([0.5, None, None, 0.5, None, 0.5] * 3), 1920, 1080)
    assert gap and len(gap) <= 2
    chaos = [0.1, 0.9, 0.2, 0.8, 0.15, 0.85] * 6  # várias pessoas / câmera na mão
    assert framing.camera_path(_samples(chaos), 1920, 1080) is None
    assert framing.camera_path(_samples([0.5] * 8), 720, 1920) is None  # já é mais estreito que 9:16


def test_expr_is_piecewise_linear_in_t():
    expr = framing.crop_x_expr([(0.0, 100.0), (2.0, 100.0), (4.0, 300.0)])
    assert expr.count("if(") == 2 and "t" in expr
    assert clipper.video_filter("crop", "x.ass", expr).startswith("scale=-2:1920,crop=1080:1920:x='if(")
    assert clipper.video_filter("crop", "x.ass").startswith("scale=1080:1920:force_original_aspect_ratio=increase")


def test_no_face_means_plain_center_crop(tmp_path):
    blank = str(tmp_path / "t.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=4",
                    "-pix_fmt", "yuv420p", "-y", blank], check=True)
    assert asyncio.run(framing.follow_expr(blank, 0, 4)) is None
    assert asyncio.run(framing.follow_expr(str(tmp_path / "missing.mp4"), 0, 4)) is None  # falha vira None, não exceção


def test_render_keeps_an_off_center_face_in_frame(tmp_path):
    """O vídeo tem o rosto a ~21% da largura: o corte central o decepa; o novo o traz para o meio."""
    ass = tmp_path / "s.ass"
    ass.write_text(clipper.build_ass([], 0, 5), encoding="utf-8")
    new = str(tmp_path / "new.mp4")
    asyncio.run(clipper.render_clip(FIXTURE, str(ass), 0, 5, new, "crop"))
    samples, _, _ = framing._scan(new, 0, 5)
    got = [c for _, c in samples if c is not None]
    assert len(got) >= 0.8 * len(samples)
    assert all(abs(c - 0.5) < 0.12 for c in got)

    old = str(tmp_path / "old.mp4")  # controle: sem seguir o rosto ele some do quadro
    subprocess.run(["ffmpeg", "-v", "error", "-i", FIXTURE, "-t", "5", "-vf", clipper.video_filter("crop", str(ass)),
                    "-y", old], check=True)
    seen = [c for _, c in framing._scan(old, 0, 5)[0] if c is not None]
    assert len(seen) < 0.5 * len(samples)
