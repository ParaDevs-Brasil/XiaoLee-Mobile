"""
test_radar_chat_tools.py — tool de radar de tendências do chat (Grok + busca no X).

- flag desligada ou sem XAI_API_KEY: o chat não ganha a tool;
- sem nicho, ou passou do teto diário: erro sem chamar o Grok;
- a tool responde na hora com o card `radar_pending` e a pesquisa termina em segundo plano;
- o status só aparece para o dono, e falha do Grok vira `error` (nunca estoura no /chat).
"""
import asyncio
import dataclasses
import importlib
import os
import types

import pytest

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

radar = importlib.import_module("server.radar_chat_tools")
service = importlib.import_module("server.orchestration.service")
Orch = service.OrchestrationService


def set_settings(monkeypatch, **kw):
    # Settings é dataclass congelada: troca o objeto nos dois módulos que o leem.
    new = dataclasses.replace(service.settings, **kw)
    monkeypatch.setattr(service, "settings", new)
    monkeypatch.setattr(radar, "settings", new)

NAMES = lambda tools: {t["function"]["name"] for t in tools}


def test_tool_only_with_flag_and_key(monkeypatch):
    set_settings(monkeypatch, radar_tools_enabled=False, xai_api_key="k")
    assert not NAMES(Orch._tools_for(None, "0xabc")) & radar.RADAR_TOOL_NAMES
    set_settings(monkeypatch, radar_tools_enabled=True, xai_api_key="")
    assert not NAMES(Orch._tools_for(None, "0xabc")) & radar.RADAR_TOOL_NAMES
    set_settings(monkeypatch, radar_tools_enabled=True, xai_api_key="k")
    assert radar.RADAR_TOOL_NAMES <= NAMES(Orch._tools_for(None, "0xabc"))


@pytest.fixture
def fake(monkeypatch):
    async def resolve(db, auth, strict=False):
        return types.SimpleNamespace(id=7)
    monkeypatch.setattr(radar, "_resolve_user", resolve)
    monkeypatch.setattr(radar, "_runs", {})
    monkeypatch.setattr(radar, "_jobs", {})
    monkeypatch.setattr(radar, "_cache", {})
    monkeypatch.setattr(radar, "_spend", {})
    calls = []

    async def ask(niche, hours):
        calls.append((niche, hours))
        return {"trends": [{"topic": f"t{i}", "why": "w", "hook": "h"} for i in range(7)] + [{"why": "sem topic"}]}, 0.28
    monkeypatch.setattr(radar, "_ask_grok", ask)

    async def no_angles(niche, trends):  # sem rede: o Claude real não entra nestes testes
        return trends, 0.0
    monkeypatch.setattr(radar, "_write_angles", no_angles)
    return calls


def test_no_niche_and_daily_limit(fake, monkeypatch):
    async def go():
        out, ex = await radar.run("get_trend_radar", {"niche": "  "}, None, "tok")
        assert out["error"] == "no_niche" and not fake
        set_settings(monkeypatch, radar_max_runs_per_day=1)
        await radar.run("get_trend_radar", {"niche": "ia"}, None, "tok")
        out, ex = await radar.run("get_trend_radar", {"niche": "ia"}, None, "tok")
        assert out["error"] == "daily_limit"
        await asyncio.gather(*radar._tasks)
        assert len(fake) == 1
    asyncio.run(go())


def test_returns_pending_card_then_job_becomes_ready_capped_and_owner_only(fake, monkeypatch):
    set_settings(monkeypatch, radar_tools_enabled=True, xai_api_key="k")

    async def go():
        out, ex = await radar.run("get_trend_radar", {"niche": "ia", "hours": 9999}, None, "tok")
        assert out == {"started": True, "niche": "ia"} and "trends" not in out
        assert ex["status"] == "radar_pending" and ex["radar"]["hours"] == 168
        job_id = ex["radar"]["job_id"]
        assert (await radar.radar_status(job_id, "Bearer tok", None))["status"] == "pending"
        await asyncio.gather(*radar._tasks)
        done = await radar.radar_status(job_id, "Bearer tok", None)
        assert done["status"] == "ready" and len(done["trends"]) == 4 and fake == [("ia", 168)]
        monkeypatch.setattr(radar, "_resolve_user", lambda db, auth, strict=False: _user(8))
        with pytest.raises(radar.HTTPException) as e:
            await radar.radar_status(job_id, "Bearer other", None)
        assert e.value.status_code == 404
    asyncio.run(go())


async def _user(i):
    return types.SimpleNamespace(id=i)


def test_grok_failure_becomes_error_job(fake, monkeypatch):
    set_settings(monkeypatch, radar_tools_enabled=True, xai_api_key="k")

    async def boom(niche, hours):
        raise radar.httpx.ConnectError("down")
    monkeypatch.setattr(radar, "_ask_grok", boom)

    async def go():
        out, ex = await radar.run("get_trend_radar", {"niche": "ia"}, None, "tok")
        await asyncio.gather(*radar._tasks)
        st = await radar.radar_status(ex["radar"]["job_id"], "Bearer tok", None)
        assert st["status"] == "error" and "message" in st
    asyncio.run(go())


def test_angles_fall_back_to_the_facts_without_a_key_and_attach_hook_with_one(monkeypatch):
    trends = [{"topic": "a", "why": "w", "hook": "old"}]
    set_settings(monkeypatch, anthropic_api_key="")
    assert asyncio.run(radar._write_angles("ia", trends)) == (trends, 0.0)

    class Msg:
        content = [types.SimpleNamespace(type="text", text='{"items":[{"i":0,"angles":[{"kind":"opiniao","text":"acho X"},{"kind":"zzz","text":"descarta"}]}]}')]

    class Client:
        def __init__(self, **kw):
            self.messages = types.SimpleNamespace(create=self.create)

        async def create(self, **kw):
            return Msg()

    set_settings(monkeypatch, anthropic_api_key="k")
    monkeypatch.setitem(__import__("sys").modules, "anthropic", types.SimpleNamespace(AsyncAnthropic=Client))
    out, _ = asyncio.run(radar._write_angles("ia", trends))
    assert out[0]["hook"] == "acho X" and out[0]["angles"] == [{"kind": "opiniao", "text": "acho X"}]


def test_angle_filter_drops_invented_experience_new_numbers_and_long_text():
    fact = "Arc e Morpho: sessão com taxa de 0,1% e 3 mercados"
    assert radar._angle_ok("Taxa de 0,1% em 3 mercados muda a conta de quem manda remessa.", fact)
    assert not radar._angle_ok("Assisti a sessão e gostei da taxa de 0,1%.", fact)
    assert not radar._angle_ok("Sempre achei esquisito esse modelo.", fact)
    assert not radar._angle_ok("A taxa de 0,01% é ridícula.", fact)
    assert not radar._angle_ok("x" * 221, fact)


def test_cache_serves_same_niche_free_and_failed_or_empty_runs_keep_the_quota(fake, monkeypatch):
    set_settings(monkeypatch, radar_tools_enabled=True, xai_api_key="k", radar_max_runs_per_day=1)

    async def go():
        out, ex = await radar.run("get_trend_radar", {"niche": "IA  Cripto"}, None, "tok")
        await asyncio.gather(*radar._tasks)
        # mesmo nicho (outro creator, outra caixa): vem do cache, não chama o Grok e não esbarra no teto de 1/dia
        monkeypatch.setattr(radar, "_resolve_user", lambda db, auth, strict=False: _user(8))
        out, ex = await radar.run("get_trend_radar", {"niche": "ia cripto"}, None, "tok")
        st = await radar.radar_status(ex["radar"]["job_id"], "Bearer tok", None)
        assert st["status"] == "ready" and len(fake) == 1

        async def empty(niche, hours):
            return {"trends": []}, 0.15
        monkeypatch.setattr(radar, "_ask_grok", empty)
        out, ex = await radar.run("get_trend_radar", {"niche": "vago"}, None, "tok")
        await asyncio.gather(*radar._tasks)
        st = await radar.radar_status(ex["radar"]["job_id"], "Bearer tok", None)
        assert st["status"] == "error" and "específico" in st["message"]
        out, ex = await radar.run("get_trend_radar", {"niche": "outro"}, None, "tok")
        assert "error" not in out  # a rodada vazia devolveu a cota
        await asyncio.gather(*radar._tasks)
    asyncio.run(go())


def test_daily_usd_cap_pauses_the_radar(fake, monkeypatch):
    set_settings(monkeypatch, radar_tools_enabled=True, xai_api_key="k", radar_daily_usd_cap=0.25)

    async def go():
        await radar.run("get_trend_radar", {"niche": "a"}, None, "tok")  # fake gasta 0.28 + 0.02
        await asyncio.gather(*radar._tasks)
        out, ex = await radar.run("get_trend_radar", {"niche": "b"}, None, "tok")
        assert out["error"] == "radar_off" and ex is None and len(fake) == 1
    asyncio.run(go())


def test_ask_questions_cleans_the_card_and_the_tool_needs_its_flag(monkeypatch):
    ask_tools = importlib.import_module("server.ask_chat_tools")
    result, ex = asyncio.run(ask_tools.run("ask_questions", {
        "title": "Plan", "mode": "form",
        "questions": [{"label": "Goal?", "short": "Goal", "options": ["A", "Outro valor", "B", "C", "D", "E", "F"], "multi": True},
                      {"label": "Notes?", "short": "Notes", "options": []}, {"label": "  "}],
    }))
    assert result == {"asked": True} and ex["status"] == "ask_open"
    qs = ex["ask"]["questions"]
    assert ex["ask"]["mode"] == "form" and len(qs) == 2 and len(qs[0]["options"]) == 5 and qs[0]["multi"]
    assert qs[1]["text"] and not qs[1]["other"]
    assert asyncio.run(ask_tools.run("ask_questions", {"questions": []}))[0]["error"] == "bad_questions"

    set_settings(monkeypatch, ask_cards_enabled=False)
    assert "ask_questions" not in NAMES(Orch._tools_for(None, "0xabc"))
    set_settings(monkeypatch, ask_cards_enabled=True)
    assert "ask_questions" in NAMES(Orch._tools_for(None, "0xabc"))


def test_campaign_template_always_has_every_field(monkeypatch):
    ask_tools = importlib.import_module("server.ask_chat_tools")
    for lang, title in (("pt", "Criar campanha"), ("en", "Create a campaign"), ("", "Criar campanha")):
        _, ex = asyncio.run(ask_tools.run("ask_questions", {"template": "campaign", "language": lang}))
        qs = ex["ask"]["questions"]
        assert ex["ask"]["title"] == title and ex["ask"]["mode"] == "form" and len(qs) == 7
        assert [bool(q["text"]) for q in qs] == [True, True, False, False, False, True, True]
        assert [q["optional"] for q in qs] == [False] * 5 + [True, True]  # perfil e tweet: só para Social
        assert all(q["options"] for q in qs[2:5]) and len({q["id"] for q in qs}) == 7
