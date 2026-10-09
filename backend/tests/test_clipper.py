"""
test_clipper.py — ClipperEngine (#29): seleção validada, legendas e render real.

Regras que estes testes travam:
- o que o modelo sugere é só sugestão: janela fora da mídia, curta/longa demais ou sobreposta é descartada;
- bordas se ajustam a limites de segmento (frase nunca cortada ao meio);
- legendas ficam relativas ao início do corte e escapam o que o ASS interpreta;
- o ffmpeg REAL gera 1080x1920 com a duração pedida e a legenda de fato queimada no vídeo.
Claude é simulado; o ffmpeg não.
"""
from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from dataclasses import replace
from types import SimpleNamespace

import pytest

from server import clipper

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg ausente")

# 6 segmentos de 10 s: 0-60 s
SEGS = [{"start": i * 10.0, "end": i * 10.0 + 10.0, "text": f"frase numero {i} com varias palavras aqui"} for i in range(6)]


def _h(start, end, title="t", reason="r"):
    return {"start": start, "end": end, "title": title, "reason": reason}


def test_validate_snaps_to_segment_edges():
    out = clipper.validate_highlights([_h(3.0, 38.0)], SEGS)
    assert [(h.start, h.end) for h in out] == [(0.0, 40.0)]


def test_validate_drops_bad_windows_and_overlaps_keeps_order():
    raw = [
        _h(0, 10),            # curta demais (<15 s)
        _h(10, 200),          # termina depois da mídia
        _h(30, 20),           # invertida
        _h(0, 30, "A"),       # ok
        _h(20, 50, "B"),      # sobrepõe A
        _h(30, 60, "C"),      # ok
        {"start": "x"},       # lixo
        _h(0, 30, title=""),  # sem título
    ]
    out = clipper.validate_highlights(raw, SEGS)
    assert [(h.title, h.start, h.end) for h in out] == [("A", 0.0, 30.0), ("C", 30.0, 60.0)]


def test_validate_caps_at_three_and_handles_empty():
    segs = [{"start": i * 20.0, "end": i * 20.0 + 20.0, "text": "x"} for i in range(10)]
    raw = [_h(i * 20, i * 20 + 20) for i in range(10)]
    assert len(clipper.validate_highlights(raw, segs)) == clipper.N_CLIPS
    assert clipper.validate_highlights(raw, []) == []


def test_validate_long_segment_keeps_model_window_instead_of_snapping_past_the_cap():
    segs = [{"start": 0.0, "end": 200.0, "text": "monologo continuo"}]
    out = clipper.validate_highlights([_h(10, 40)], segs)
    assert [(h.start, h.end) for h in out] == [(10.0, 40.0)]


def test_pick_highlights_uses_forced_tool_and_validates(monkeypatch):
    seen = {}

    class _Msgs:
        async def create(self, **kw):
            seen.update(kw)
            block = SimpleNamespace(type="tool_use", input={"highlights": [_h(0, 30, "Gancho"), _h(500, 900)]})
            return SimpleNamespace(content=[SimpleNamespace(type="text", text="oi"), block])

    monkeypatch.setattr(clipper, "settings", replace(clipper.settings, anthropic_api_key="k"))
    import anthropic

    monkeypatch.setattr(anthropic, "AsyncAnthropic", lambda **kw: SimpleNamespace(messages=_Msgs()))
    out = asyncio.run(clipper.pick_highlights(SEGS))
    assert [(h.title, h.start, h.end) for h in out] == [("Gancho", 0.0, 30.0)]  # a janela fora da mídia caiu
    assert seen["tool_choice"] == {"type": "tool", "name": "report_highlights"}
    assert "<transcript>" in seen["messages"][0]["content"]


def test_pick_highlights_without_key_fails_clearly(monkeypatch):
    monkeypatch.setattr(clipper, "settings", replace(clipper.settings, anthropic_api_key=""))
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        asyncio.run(clipper.pick_highlights(SEGS))


def test_caption_events_are_relative_to_clip_and_clipped_to_window():
    ev = clipper.caption_events(SEGS, start=15.0, end=35.0)
    assert ev[0][0] == 0.0 and ev[-1][1] == pytest.approx(20.0)
    assert all(0 <= a < b <= 20.0 + 1e-6 for a, b, _ in ev)
    assert all(len(t.split()) <= clipper.CAPTION_WORDS for _, _, t in ev)
    assert clipper.caption_events(SEGS, start=100.0, end=130.0) == []


def test_ass_strips_override_chars_and_formats_times():
    segs = [{"start": 0.0, "end": 4.0, "text": "olá {\\an8} mundo\ncruel"}]
    ass = clipper.build_ass(segs, 0.0, 4.0)
    dialogue = [l for l in ass.splitlines() if l.startswith("Dialogue")]
    assert dialogue and all("{" not in l.split(",,", 1)[1] and "\\" not in l.split(",,", 1)[1] for l in dialogue)
    assert "0:00:00.00" in dialogue[0] and "PlayResY: 1920" in ass
    assert clipper._ass_time(3725.5) == "1:02:05.50"


def _probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name",
         "-show_entries", "format=duration", "-of", "json", path], capture_output=True, text=True, check=True,
    ).stdout
    d = json.loads(out)
    return d["streams"][0], float(d["format"]["duration"])


def _frame(path, t):
    return subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(t), "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True,
    ).stdout


@pytest.fixture(scope="module")
def source(tmp_path_factory):
    p = tmp_path_factory.mktemp("clip") / "src.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25:duration=30",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=30", "-shortest", "-pix_fmt", "yuv420p", "-y", str(p)],
        check=True,
    )
    return str(p)


def test_render_is_vertical_with_requested_duration_and_burned_captions(tmp_path, source):
    segs = [{"start": 5.0, "end": 25.0, "text": "esta legenda precisa aparecer queimada no video final"}]
    ass, blank = tmp_path / "s.ass", tmp_path / "blank.ass"
    ass.write_text(clipper.build_ass(segs, 5.0, 25.0), encoding="utf-8")
    blank.write_text(clipper.build_ass([], 5.0, 25.0), encoding="utf-8")
    with_c, without = str(tmp_path / "with.mp4"), str(tmp_path / "without.mp4")

    asyncio.run(clipper.render_clip(source, str(ass), 5.0, 25.0, with_c))
    asyncio.run(clipper.render_clip(source, str(blank), 5.0, 25.0, without))

    stream, duration = _probe(with_c)
    assert (stream["width"], stream["height"], stream["codec_name"]) == (1080, 1920, "h264")
    assert duration == pytest.approx(20.0, abs=0.5)
    # a legenda existe de verdade: o mesmo instante renderizado com e sem legenda difere
    assert _frame(with_c, 8) != _frame(without, 8)


def test_render_failure_does_not_leak_the_source_url(tmp_path):
    ass = tmp_path / "s.ass"
    ass.write_text(clipper.build_ass([], 0, 1))
    url = "https://r2.test/secret-bucket/key?X-Amz-Signature=deadbeef"
    with pytest.raises(RuntimeError) as exc:
        asyncio.run(clipper.render_clip(url, str(ass), 0, 5, str(tmp_path / "o.mp4")))
    assert "deadbeef" not in str(exc.value)
