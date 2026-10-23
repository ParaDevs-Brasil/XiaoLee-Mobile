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
    calls = []

    async def ask(niche, hours):
        calls.append((niche, hours))
        return {"trends": [{"topic": f"t{i}", "why": "w", "hook": "h"} for i in range(7)] + [{"why": "sem topic"}]}, 0.28
    monkeypatch.setattr(radar, "_ask_grok", ask)
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
        assert done["status"] == "ready" and len(done["trends"]) == 5 and fake == [("ia", 168)]
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
