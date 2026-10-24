"""
test_format_advisor.py — sugestões de formato para o creator (XIAOLEEACE-32).

Regras que estes testes travam:
- o prompt leva os interesses do onboarding (explicados), a bio e os vídeos; sem vídeos, diz isso;
- o que o modelo sugere é só sugestão: item incompleto/repetido cai, textos e duração são limitados;
- menos de 2 válidas é erro (NoSuggestions), não uma lista pela metade;
- usa o worker do Clipper (`clipper._call_tool`) e o mesmo contexto não chama o modelo de novo.
O modelo é simulado.
"""
from __future__ import annotations

import pytest

from server import clipper, format_advisor

PROFILE = {"interest_profile": ["defi", "memecoins"], "bio": "Explico DeFi sem jargão", "social_links": {"x": "@ana"}}
SAMPLES = [{"title": "Como funciona um pool", "excerpt": "hoje eu vou mostrar como funciona um pool de liquidez",
            "clips": ["O erro que todo mundo comete"]}]


def _s(fmt, platform="tiktok", duration=45):
    return {"format": fmt, "why": "combina com você", "hook": "Você sabia que...", "platform": platform, "duration_s": duration}


@pytest.fixture(autouse=True)
def _clear_cache():
    format_advisor._cache.clear()
    yield
    format_advisor._cache.clear()


def test_prompt_carries_interests_bio_and_videos():
    p = format_advisor.build_prompt(PROFILE, SAMPLES)
    assert "DeFi / decentralized finance" in p and "memecoins and crypto culture" in p
    assert "Explico DeFi sem jargão" in p and "x" in p
    assert "Como funciona um pool" in p and "O erro que todo mundo comete" in p and "pool de liquidez" in p


def test_prompt_without_videos_falls_back_to_profile():
    p = format_advisor.build_prompt({"interest_profile": ["games"]}, [])
    assert "No videos yet" in p and "web3 and crypto games" in p
    assert "Bio: not informed" in p


def test_validate_drops_incomplete_and_duplicates_and_clamps():
    raw = [
        _s("Mito ou verdade", duration=999),
        {"format": "Sem gancho", "why": "x", "hook": "", "platform": "tiktok", "duration_s": 30},
        _s("MITO OU VERDADE"),
        _s("Glossário em 30s", platform="facebook", duration="abc"),
        "lixo",
        _s("Reagindo ao mercado", platform="x", duration=3),
        _s("Um a mais"),
    ]
    out = format_advisor.validate_suggestions(raw)
    assert [s.format for s in out] == ["Mito ou verdade", "Glossário em 30s", "Reagindo ao mercado"]
    assert [s.duration_s for s in out] == [180, 30, 10]
    assert [s.platform for s in out] == ["tiktok", "tiktok", "x"]


def test_validate_cuts_long_texts():
    out = format_advisor.validate_suggestions([{**_s("F" * 100), "why": "w" * 500, "hook": "h" * 500}])
    assert (len(out[0].format), len(out[0].why), len(out[0].hook)) == (60, 200, 140)


@pytest.mark.asyncio
async def test_uses_the_clipper_worker_in_the_app_language_and_caches(monkeypatch):
    calls = []

    async def _call_tool(system, tool, content, max_tokens):
        calls.append((system, tool["name"], content))
        return {"suggestions": [_s("Série DeFi do zero"), _s("Memecoin da semana", "reels", 30)]}

    monkeypatch.setattr(clipper, "_call_tool", _call_tool)
    out = await format_advisor.suggest_formats(PROFILE, SAMPLES, "pt")
    assert [s.format for s in out] == ["Série DeFi do zero", "Memecoin da semana"]
    assert calls[0][1] == "suggest_formats" and "Brazilian Portuguese" in calls[0][0]
    assert "untrusted data" in calls[0][0] and "Never promise returns" in calls[0][0]

    await format_advisor.suggest_formats(PROFILE, SAMPLES, "pt")
    assert len(calls) == 1  # mesmo contexto: cache
    await format_advisor.suggest_formats(PROFILE, SAMPLES, "en")
    await format_advisor.suggest_formats({**PROFILE, "bio": "outra"}, SAMPLES, "pt")
    assert len(calls) == 3  # idioma ou perfil mudou: nova chamada


@pytest.mark.asyncio
async def test_too_few_usable_suggestions_is_an_error_and_not_cached(monkeypatch):
    replies = [{"suggestions": [_s("Só uma")]}, {}]

    async def _call_tool(*a):
        return replies.pop(0)

    monkeypatch.setattr(clipper, "_call_tool", _call_tool)
    for _ in range(2):
        with pytest.raises(format_advisor.NoSuggestions):
            await format_advisor.suggest_formats(PROFILE, [], "en")
    assert not format_advisor._cache


@pytest.mark.asyncio
async def test_provider_errors_pass_through(monkeypatch):
    async def _call_tool(*a):
        raise clipper.ProviderUnavailable("anthropic: sem crédito")

    monkeypatch.setattr(clipper, "_call_tool", _call_tool)
    with pytest.raises(clipper.ProviderUnavailable):
        await format_advisor.suggest_formats(PROFILE, [], "en")
