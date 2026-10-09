"""
clipper_report.py — inspetor visual do Clipper (Plane #29): roda o pipeline REAL num vídeo e gera uma
página HTML com cada etapa, a linha do tempo, a transcrição palavra a palavra e a medição de sincronia.

  vídeo → áudio (ffmpeg) → transcrição (Whisper, palavra a palavra) → highlights (Claude + validação)
        → render 9:16 legendado (ffmpeg) → medições de sincronia

Sincronia, medida de três formas independentes:
  • quadro a quadro: renderiza o corte COM e SEM legenda; a diferença no pixel diz em que quadros a
    legenda está de fato na tela, e isso é comparado com o que o código planejou
  • áudio: o áudio do corte renderizado é transcrito de novo (palavras com tempo real) e comparado com
    quando cada legenda entra — é o que o espectador ouve vs. lê
  • antes/depois: o método antigo (tempo repartido por segmento) vs. o atual (tempo por palavra),
    ambos contra a mesma referência de áudio

Uso (GROQ_API_KEY e ANTHROPIC_API_KEY no ambiente; NUNCA imprime segredos):
    cd backend && ../.venv/bin/python scripts/clipper_report.py <video> <pasta_de_saida>
    abra <pasta_de_saida>/index.html no navegador
"""

from __future__ import annotations

import asyncio
import copy
import difflib
import json
import re
import shutil
import statistics as st
import subprocess
import sys
import time
from array import array
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import clipper, media_routes  # noqa: E402
from server.settings import settings  # noqa: E402

HERE = Path(__file__).resolve().parent
PEAK_WINDOW_S = 0.5
DIVERGED_MS = 5000  # acima disso o par não é erro de sincronia: o texto das duas transcrições não bate
# Diferença média (YAVG) na faixa da legenda, render com vs. sem legenda, a partir da qual há legenda na tela.
# Medido num vídeo real: sem legenda o ruído entre as duas codificações H.264 tem p99 = 0,68; com legenda o
# p1 = 2,74. 1,0 separa os dois com folga (0,3 — meu 1º chute — ficava abaixo do piso de ruído).
VISIBLE_YAVG = 1.0


def sh(*args) -> str:
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def probe(path: Path) -> dict:
    d = json.loads(sh("ffprobe", "-v", "error", "-show_entries",
                      "stream=codec_type,codec_name,width,height,r_frame_rate:format=duration,size",
                      "-of", "json", str(path)))
    v = next(s for s in d["streams"] if s["codec_type"] == "video")
    num, den = v["r_frame_rate"].split("/")
    return {"duration": float(d["format"]["duration"]), "size": int(d["format"]["size"]), "width": v["width"],
            "height": v["height"], "fps": float(num) / float(den), "codec": v["codec_name"]}


def waveform(audio: Path) -> list[float]:
    """Pico (0-1) por janela de PEAK_WINDOW_S, do áudio já extraído."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(audio), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    samples = array("h")
    samples.frombytes(raw)
    n = int(8000 * PEAK_WINDOW_S)
    return [round(max(abs(x) for x in samples[i:i + n]) / 32768, 3) for i in range(0, len(samples), n) if samples[i:i + n]]


def norm(w: str) -> str:
    return re.sub(r"[^\w]", "", w.lower())


def onset_errors(groups, truth_words):
    """Início de cada legenda vs. a mesma palavra no áudio re-transcrito (alinhado por texto, trechos de 3+
    palavras; diferença > DIVERGED_MS = texto divergente, contado à parte). Frase que aparece 2+ vezes no corte tem alinhamento ambíguo: fica de fora das estatísticas
    (não dá para saber qual ocorrência é qual) e é contada à parte. Devolve (erros_ms, detalhes, ambíguas, divergentes)."""
    ours = [(norm(t), w0, gi, k == 0, t) for gi, (_, _, ws) in enumerate(groups) for k, (t, w0, _) in enumerate(ws)]
    truth = [(norm(w["text"]), w["start"]) for w in truth_words]
    tri = [tuple(t[0] for t in truth[i:i + 3]) for i in range(len(truth))]
    sm = difflib.SequenceMatcher(None, [o[0] for o in ours], [t[0] for t in truth], autojunk=False)
    errs, detail, ambiguous = [], [], 0
    diverged = 0
    for a, b, size in sm.get_matching_blocks():
        if size < 3:  # palavra solta casa com a ocorrência errada ("the", "and"…)
            continue
        for k in range(size):
            if not ours[a + k][3]:  # só a 1.ª palavra do grupo = quando a legenda entra
                continue
            if tri.count(tri[b + k]) > 1:
                ambiguous += 1
                continue
            e = (ours[a + k][1] - truth[b + k][1]) * 1000
            if abs(e) > DIVERGED_MS:  # as duas transcrições discordam do TEXTO (frase repetida/omitida), não do tempo
                diverged += 1
                continue
            errs.append(e)
            detail.append({"err_ms": round(e), "text": " ".join(o[4] for o in ours[a + k:a + k + 4]),
                           "ours": round(ours[a + k][1], 2), "heard": round(truth[b + k][1], 2)})
    return errs, sorted(detail, key=lambda d: -abs(d["err_ms"]))[:3], ambiguous, diverged


def bucketize(res) -> dict:
    errs, worst, ambiguous, diverged = res
    a = [abs(e) for e in errs] or [0]
    n = len(a)
    return {"n": len(errs), "ambiguous": ambiguous, "diverged": diverged, "median_ms": round(st.median(a)),
            "p90_ms": round(sorted(a)[int(0.9 * (n - 1))]), "max_ms": round(max(a)), "worst": worst,
            "bins": [round(100 * sum(1 for x in a if lo <= x < hi) / n, 1)
                     for lo, hi in ((0, 100), (100, 250), (250, 500), (500, 1000), (1000, 1e9))]}


def caption_visibility(with_c: Path, without: Path, fps: float) -> list[tuple[float, float]]:
    """(tempo, YAVG) por quadro da faixa de legenda: diferença entre o render com e sem legenda."""
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", str(with_c), "-i", str(without), "-filter_complex",
         "[0:v][1:v]blend=all_mode=difference,crop=iw:ih*0.3:0:ih*0.55,signalstats,"
         "metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"],
        capture_output=True, text=True, check=True).stdout
    series, t = [], 0.0
    for line in out.splitlines():
        if "pts_time:" in line:
            t = float(line.split("pts_time:")[1].split()[0])
        elif "YAVG=" in line:
            series.append((t, float(line.split("YAVG=")[1])))
    return series


def frame_sync(series, groups, fps: float) -> dict:
    frame = 1 / fps
    expect = lambda t: any(t0 <= t + frame / 2 < t1 for t0, t1, _ in groups)  # noqa: E731
    agree = sum(1 for t, y in series if (y > VISIBLE_YAVG) == expect(t))
    onsets = []
    for t0, _, _ in groups:
        near = [t for t, y in series if y > VISIBLE_YAVG and abs(t - t0) <= 0.4]
        if near:
            onsets.append((min(near, key=lambda t: abs(t - t0)) - t0) * 1000)
    return {"frames": len(series), "agree_pct": round(100 * agree / max(len(series), 1), 2),
            "onset_mean_ms": round(st.mean(abs(o) for o in onsets)) if onsets else None,
            "onset_max_ms": round(max(abs(o) for o in onsets)) if onsets else None,
            "frame_ms": round(frame * 1000, 1), "groups_checked": len(onsets)}


async def main(src: Path, out: Path) -> int:
    if not (settings.transcription_api_key and settings.anthropic_api_key):
        print("FAIL: precisa de GROQ_API_KEY (ou TRANSCRIPTION_API_KEY) e ANTHROPIC_API_KEY no ambiente")
        return 2
    out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, out / "source.mp4")
    stages: dict = {}

    def stage(name, secs, **info):
        stages[name] = {"seconds": round(secs, 2), **info}
        print(f"  {name:<14} {secs:6.1f}s  " + " ".join(f"{k}={v}" for k, v in info.items()))

    print(f"fonte: {src.name}")
    meta = probe(src)
    audio = out / "audio.mp3"

    t = time.time()
    await media_routes._extract_audio(str(src), str(audio))
    peaks = waveform(audio)
    stage("audio", time.time() - t, mp3_bytes=audio.stat().st_size, rate="16 kHz mono 32 kbps")

    loose: list = []
    real_attach = media_routes._attach_words

    def spy(segments, words):  # guarda os segmentos como o Whisper os devolveu (antes de apertar)
        loose.extend(copy.deepcopy(segments))
        return real_attach(segments, words)

    media_routes._attach_words = spy
    t = time.time()
    tr = await media_routes._transcribe(str(audio))
    media_routes._attach_words = real_attach
    segs = tr["segments"]
    n_words = sum(len(s.get("words", [])) for s in segs)
    stage("transcription", time.time() - t, model=settings.transcription_model, language=tr["language"],
          segments=len(segs), words=n_words)

    t = time.time()
    raw = await clipper.ask_claude(segs)
    rejected: list = []
    picks = clipper.validate_highlights(raw, segs, rejected)
    stage("highlights", time.time() - t, model=settings.anthropic_model, proposed=len(raw), accepted=len(picks))

    clips, render_total = [], 0.0
    for i, h in enumerate(picks, 1):
        tmp = out / f"_clip{i}"
        tmp.mkdir(exist_ok=True)
        ass, blank = tmp / "s.ass", tmp / "blank.ass"
        ass.write_text(clipper.build_ass(segs, h.start, h.end), encoding="utf-8")
        blank.write_text(clipper.build_ass([], h.start, h.end), encoding="utf-8")
        dest, dest_blank = out / f"clip{i}.mp4", tmp / "blank.mp4"
        print(f"  clip{i}: render ({h.end - h.start:.0f}s)…")
        t = time.time()
        await clipper.render_clip(str(src), str(ass), h.start, h.end, str(dest))
        render_s = time.time() - t
        render_total += render_s
        print(f"  clip{i}: render sem legenda (referência para os quadros)…")
        await clipper.render_clip(str(src), str(blank), h.start, h.end, str(dest_blank))

        cmeta = probe(dest)
        first = clipper.caption_groups(segs, h.start, h.end)
        at = min(first[0][0] + 0.6, cmeta["duration"] - 0.2) if first else 1.0  # um quadro com legenda na tela
        await clipper.run_ffmpeg(["-ss", f"{at:.2f}", "-i", str(dest), "-frames:v", "1", "-q:v", "3", "-y",
                                  str(out / f"clip{i}.jpg")], str(dest), 60)
        groups = clipper.caption_groups(segs, h.start, h.end)
        loose_plain = [{"start": s["start"], "end": s["end"], "text": s["text"]} for s in loose]
        old_groups = clipper.caption_groups(loose_plain, h.start, h.end)  # método antigo: sem palavras

        print(f"  clip{i}: re-transcrevendo o áudio do corte (referência independente)…")
        clip_audio = tmp / "a.mp3"
        await media_routes._extract_audio(str(dest), str(clip_audio))
        ref = await media_routes._transcribe(str(clip_audio))  # referência independente: o que se ouve no corte
        ref_words = [w for s in ref["segments"] for w in s.get("words", [])]

        print(f"  clip{i}: comparando quadro a quadro…")
        series = await asyncio.to_thread(caption_visibility, dest, dest_blank, cmeta["fps"])
        clips.append({
            "rank": i, "title": h.title, "reason": h.reason, "start": h.start, "end": h.end, "file": f"clip{i}.mp4", "poster": f"clip{i}.jpg",
            "render_s": round(render_s, 1), "size": dest.stat().st_size, "w": cmeta["width"], "h": cmeta["height"],
            "duration": round(cmeta["duration"], 2),
            "groups": [{"t0": a, "t1": b, "words": [[w, x, y] for w, x, y in ws]} for a, b, ws in groups],
            "sync": {"frame": frame_sync(series, groups, cmeta["fps"]),
                     "audio_new": bucketize(onset_errors(groups, ref_words)),
                     "audio_old": bucketize(onset_errors(old_groups, ref_words))},
        })
        shutil.rmtree(tmp)
        s = clips[-1]["sync"]
        print(f"  clip{i} {h.end - h.start:.0f}s render {render_s:.1f}s · quadros {s['frame']['agree_pct']}% · "
              f"áudio mediana novo {s['audio_new']['median_ms']} ms vs antigo {s['audio_old']['median_ms']} ms")
    stage("render", render_total, clips=len(clips), size="1080x1920 H.264/AAC")

    data = {
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M"), "source": {"name": src.name, **meta},
        "stages": stages, "peaks": peaks, "peak_window": PEAK_WINDOW_S, "lang": tr["language"],
        "segments": segs, "loose": [{"start": s["start"], "end": s["end"]} for s in loose],
        "claude": {"model": settings.anthropic_model,
                   "raw": [{"start": r.get("start"), "end": r.get("end"), "title": r.get("title"), "reason": r.get("reason")} for r in raw],
                   "accepted": [{"start": h.start, "end": h.end, "title": h.title} for h in picks],
                   "rejected": [{"start": r.get("start"), "end": r.get("end"), "title": r.get("title"), "why": why} for r, why in rejected]},
        "clips": clips, "params": {"min_len": clipper.MIN_LEN_S, "max_len": clipper.MAX_LEN_S,
                                    "words_per_caption": clipper.CAPTION_WORDS, "pause": clipper.CAPTION_PAUSE_S},
    }
    html = (HERE / "clipper_report_template.html").read_text(encoding="utf-8")
    (out / "data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")  # transcrição com "</script>" não pode quebrar a página
    (out / "index.html").write_text(html.replace("/*__DATA__*/null", blob), encoding="utf-8")
    print(f"\nrelatório: {out / 'index.html'}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sys.exit(asyncio.run(main(Path(sys.argv[1]), Path(sys.argv[2]))))
