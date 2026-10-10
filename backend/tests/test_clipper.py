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
import re
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
        _h(0, 10),            # curta demais (<20 s)
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


def test_validate_trims_over_cap_window_at_last_fitting_segment():
    segs = [{"start": i * 10.0, "end": i * 10.0 + 10.0, "text": "x"} for i in range(12)]  # 0-120 s
    out = clipper.validate_highlights([_h(0, 95)], segs)  # snap -> 0-100 s (> 75)
    assert [(h.start, h.end) for h in out] == [(0.0, 70.0)]


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
    out = asyncio.run(clipper.pick_highlights(SEGS, "Portuguese"))
    assert "Portuguese" in seen["system"] and "30-60" in seen["system"]
    assert [(h.title, h.start, h.end) for h in out] == [("Gancho", 0.0, 30.0)]  # a janela fora da mídia caiu
    assert seen["tool_choice"] == {"type": "tool", "name": "report_highlights"}
    assert "<transcript>" in seen["messages"][0]["content"]


def test_pick_highlights_without_key_fails_clearly(monkeypatch):
    monkeypatch.setattr(clipper, "settings", replace(clipper.settings, anthropic_api_key=""))
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        asyncio.run(clipper.pick_highlights(SEGS))


def _w(text, a, b):
    return {"text": text, "start": a, "end": b}


# fala real: 2 s de silêncio no começo do segmento, depois "Hello brave new world. Next one"
WORDED = [{
    "start": 0.0, "end": 10.0, "text": "Hello brave new world. Next one",
    "words": [_w("Hello", 2.0, 2.4), _w("brave", 2.4, 2.8), _w("new", 2.8, 3.0), _w("world.", 3.0, 3.5),
              _w("Next", 4.0, 4.2), _w("one", 4.2, 4.6)],
}]


def test_captions_follow_real_word_times_not_segment_edges():
    g = clipper.caption_groups(WORDED, 1.0, 6.0)
    assert g[0][0] == pytest.approx(1.0)  # 2.0 (1.ª palavra) - 1.0 (início do corte); NÃO 0 = início do segmento
    assert [w[0] for w in g[0][2]] == ["Hello", "brave", "new", "world."]
    assert g[0][1] == pytest.approx(2.5)  # fecha na última palavra (o vão até a próxima é de 0,5 s: não 'ponteia')
    assert g[1][0] == pytest.approx(3.0)


def test_groups_split_on_sentence_end_pause_and_word_cap():
    segs = [{"start": 0, "end": 30, "text": "x", "words": [
        _w("one", 0, .3), _w("two", .3, .6), _w("three.", .6, 1.0), _w("four", 1.0, 1.3),   # frase acaba → novo grupo
        _w("five", 3.0, 3.3),                                                               # pausa longa → novo grupo
        _w("a", 3.3, 3.4), _w("b", 3.4, 3.5), _w("c", 3.5, 3.6), _w("d", 3.6, 3.7), _w("e", 3.7, 3.8),  # teto de 4
    ]}]
    sizes = [len(g[2]) for g in clipper.caption_groups(segs, 0, 30)]
    assert sizes == [3, 1, 4, 2]


def test_groups_bridge_small_gaps_but_not_large_ones():
    segs = [{"start": 0, "end": 9, "text": "x", "words": [
        _w("a.", 0, 1), _w("b.", 1.3, 2), _w("c.", 4, 5)]}]
    g = clipper.caption_groups(segs, 0, 9)
    assert g[0][1] == pytest.approx(1.3)  # vão de 0,3 s: fica até a próxima
    assert g[1][1] == pytest.approx(2.0)  # vão de 2 s: some quando a fala acaba


def test_groups_are_clipped_to_the_window():
    g = clipper.caption_groups(WORDED, 2.5, 4.3)
    assert g[0][0] == 0.0 and g[-1][1] <= 1.8 + 1e-9
    assert clipper.caption_groups(WORDED, 100.0, 130.0) == []


def test_segments_without_words_fall_back_to_proportional_timing():
    g = clipper.caption_groups(SEGS, 15.0, 35.0)  # transcrição antiga, sem words
    assert g and g[0][0] == 0.0 and g[-1][1] == pytest.approx(20.0)
    assert all(len(grp) <= clipper.CAPTION_WORDS for _, _, grp in g)


def test_ass_karaoke_durations_fill_each_caption_and_highlight_is_wired():
    ass = clipper.build_ass(WORDED, 1.0, 6.0)
    first = [l for l in ass.splitlines() if l.startswith("Dialogue")][0]
    assert "0:00:01.00,0:00:02.50" in first
    ks = [int(x) for x in re.findall(r"\\k(\d+)", first)]
    assert ks == [40, 40, 20, 50] and sum(ks) == 150  # = 1,5 s = duração da legenda
    assert f"Style: Default,{clipper.CAPTION_FONT},84,{clipper.HIGHLIGHT_COLOR},&H00FFFFFF" in ass


def test_ass_strips_override_chars_and_formats_times():
    segs = [{"start": 0.0, "end": 4.0, "text": "olá {\\an8} mundo\\ncruel"}]
    ass = clipper.build_ass(segs, 0.0, 4.0)
    dialogue = [l for l in ass.splitlines() if l.startswith("Dialogue")]
    texts = [re.sub(r"\{\\k\d+\}", "", l.split(",,", 1)[1]) for l in dialogue]  # tira só as tags \k legítimas
    assert dialogue and all("{" not in t and "\\" not in t for t in texts)
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


def test_ffmpeg_timeout_kills_the_process_and_fails_clearly(tmp_path):
    import time

    t = time.time()
    with pytest.raises(RuntimeError, match="timed out"):
        # entrada infinita: sem o timeout isso nunca termina
        asyncio.run(clipper.run_ffmpeg(
            ["-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=60", "-f", "null", "-"], "src", timeout=1.5))
    assert time.time() - t < 10


def test_fit_layout_keeps_the_whole_frame_on_a_blurred_background(tmp_path, source):
    ass = tmp_path / "s.ass"
    ass.write_text(clipper.build_ass([], 0, 10), encoding="utf-8")
    crop, fit = str(tmp_path / "crop.mp4"), str(tmp_path / "fit.mp4")
    asyncio.run(clipper.render_clip(source, str(ass), 2.0, 6.0, crop, "crop"))
    asyncio.run(clipper.render_clip(source, str(ass), 2.0, 6.0, fit, "fit"))
    stream, duration = _probe(fit)
    assert (stream["width"], stream["height"]) == (1080, 1920) and duration == pytest.approx(4.0, abs=0.5)
    assert _frame(fit, 1) != _frame(crop, 1)  # layouts de fato diferentes
    # no 'fit' o topo é fundo desfocado (não preto) e o vídeo inteiro aparece no meio: a faixa do meio tem
    # muito mais variação (conteúdo do testsrc) que o topo desfocado
    raw = _frame(fit, 1)
    top, mid = raw[: 1080 * 200], raw[1080 * 900: 1080 * 1100]
    spread = lambda b: max(b) - min(b)  # noqa: E731
    assert max(top) > 10 and spread(mid) > spread(top)


def test_unknown_layout_is_refused(tmp_path):
    with pytest.raises(ValueError):
        asyncio.run(clipper.render_clip("x", "y", 0, 1, str(tmp_path / "o.mp4"), "stretch"))


# ── mídia longa: blocos + ranking final ──────────────────────────────────────

LONG = [{"start": i * 10.0, "end": i * 10.0 + 10.0, "text": f"fala {i}"} for i in range(360)]  # 60 min


def test_split_chunks_keeps_short_media_whole_and_cuts_long_at_segment_edges():
    assert clipper.split_chunks(SEGS) == [SEGS]
    chunks = clipper.split_chunks(LONG)
    assert [len(c) for c in chunks] == [120, 120, 120]  # 3 x 20 min
    assert sum(chunks, []) == LONG


def test_long_media_asks_per_chunk_and_lets_the_model_rank(monkeypatch):
    calls = []

    async def fake_ask(segs, language=None, n=clipper.N_CLIPS):
        calls.append((segs[0]["start"], n))
        b = segs[0]["start"] + 100
        return [_h(b, b + 40, f"bloco {segs[0]['start']:.0f}")]

    async def fake_rank(cands, segments, language):
        assert language == "Portuguese"
        return [2, 0]  # o 3º bloco ganha, o 2º nem entra no ranking

    monkeypatch.setattr(clipper, "ask_claude", fake_ask)
    monkeypatch.setattr(clipper, "rank_candidates", fake_rank)
    out = asyncio.run(clipper.pick_highlights(LONG, "Portuguese"))
    assert sorted(calls) == [(0.0, 2), (1200.0, 2), (2400.0, 2)]
    # ranking manda 2 e 0; o que ele omitiu (1) entra no fim, sem perder candidatos
    assert [h.title for h in out] == ["bloco 2400", "bloco 0", "bloco 1200"]


def test_long_media_survives_a_failed_chunk_and_a_failed_ranking(monkeypatch):
    async def fake_ask(segs, language=None, n=clipper.N_CLIPS):
        if segs[0]["start"] == 1200.0:
            raise ValueError("boom")
        b = segs[0]["start"] + 100
        return [_h(b, b + 40, f"bloco {segs[0]['start']:.0f}")]

    async def bad_rank(*a):
        raise ValueError("rank boom")

    monkeypatch.setattr(clipper, "ask_claude", fake_ask)
    monkeypatch.setattr(clipper, "rank_candidates", bad_rank)
    out = asyncio.run(clipper.pick_highlights(LONG))
    assert [h.title for h in out] == ["bloco 0", "bloco 2400"]  # ordem por bloco como reserva


def test_long_media_raises_when_every_chunk_fails(monkeypatch):
    async def fake_ask(*a, **k):
        raise RuntimeError("ANTHROPIC_API_KEY não configurada")

    monkeypatch.setattr(clipper, "ask_claude", fake_ask)
    with pytest.raises(RuntimeError):
        asyncio.run(clipper.pick_highlights(LONG))


def test_rank_candidates_drops_invalid_and_repeated_ids(monkeypatch):
    async def fake_call(system, tool, content, max_tokens):
        assert tool["name"] == "rank_highlights" and "#0" in content and "#1" in content
        return {"ranking": [1, 1, 7, "x", 0]}

    monkeypatch.setattr(clipper, "_call_tool", fake_call)
    c = [clipper.Highlight(0, 30, "a", "r"), clipper.Highlight(30, 60, "b", "r")]
    assert asyncio.run(clipper.rank_candidates(c, SEGS, "Portuguese")) == [1, 0]
