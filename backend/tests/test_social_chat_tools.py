"""
test_social_chat_tools.py — tools do chat para postar nas redes.

Regras que estes testes travam:
- flag desligada (padrão) ou conversa Stellar: tools e prompt ficam exatamente como eram;
- `prepare_social_post` NUNCA publica: só devolve o card `post_ready` (a publicação é o toque do creator);
- valida rede conectada, tamanho do texto e corte próprio e pronto;
- `get_publishing_context` só mostra o que é do próprio creator.
"""
from __future__ import annotations

import dataclasses
import importlib
import os
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.models import MediaAsset, MediaClip, PostPublication, SocialAccount, User, WebSession

service = importlib.import_module("server.orchestration.service")
tools = importlib.import_module("server.social_chat_tools")
Orch = service.OrchestrationService
NAMES = lambda lst: {t["function"]["name"] for t in lst}  # noqa: E731


def _flag(monkeypatch, on: bool):
    monkeypatch.setattr(service, "settings", dataclasses.replace(service.settings, social_tools_enabled=on))


def test_flag_off_keeps_tools_and_prompt_unchanged(monkeypatch):
    _flag(monkeypatch, False)
    assert not NAMES(Orch._tools_for(None, "0xabc")) & tools.SOCIAL_TOOL_NAMES
    assert not NAMES(Orch._tools_for(None, None)) & tools.SOCIAL_TOOL_NAMES
    assert "PUBLICAR NAS REDES" not in object.__new__(Orch)._build_agentic_system_prompt(None, "app", evm_wallet="0xabc")


def test_flag_on_adds_tools_but_not_in_stellar_context(monkeypatch):
    _flag(monkeypatch, True)
    assert tools.SOCIAL_TOOL_NAMES <= NAMES(Orch._tools_for(None, "0xabc"))
    assert tools.SOCIAL_TOOL_NAMES <= NAMES(Orch._tools_for(None, None))
    assert not NAMES(Orch._tools_for("G" + "A" * 55, None)) & tools.SOCIAL_TOOL_NAMES
    assert "PUBLICAR NAS REDES" in object.__new__(Orch)._build_agentic_system_prompt(None, "app", evm_wallet="0xabc")


async def _user(db, name):
    db.add(WebSession(session_id=f"privy_session_{name}", twitter_user_id=f"privy_{name}",
                      expires_at=datetime.utcnow() + timedelta(days=30)))
    u = User(twitter_user_id=f"privy_{name}", twitter_handle=name)
    db.add(u)
    await db.commit()
    # O `/chat` entrega ao orquestrador o `twitter_user_id` já resolvido (não o token de sessão).
    return f"privy_{name}", u.id


async def _connect(db, uid, platform="bluesky"):
    db.add(SocialAccount(user_id=uid, platform=platform, external_id="x", handle="@ana", credentials_enc="enc"))
    await db.commit()


async def _clip(db, uid, status="ready"):
    a = MediaAsset(user_id=uid, kind="video", filename="a.mp4", content_type="video/mp4", size_bytes=1, r2_key=f"k{uid}-{status}")
    db.add(a)
    await db.flush()
    c = MediaClip(user_id=uid, media_id=a.id, rank=1, start_s=0, end_s=30, title="Hook", reason="forte", status=status, r2_key="c.mp4")
    db.add(c)
    await db.commit()
    return c.id


@pytest.mark.asyncio
async def test_context_is_scoped_to_the_caller(db_session):
    a, uid_a = await _user(db_session, "a")
    b, uid_b = await _user(db_session, "b")
    await _connect(db_session, uid_a)
    await _clip(db_session, uid_a)
    res, execution = await tools.run("get_publishing_context", {}, db_session, b)
    assert execution is None and res["accounts"] == [] and res["ready_clips"] == []
    res, _ = await tools.run("get_publishing_context", {}, db_session, a)
    assert res["accounts"][0]["platform"] == "bluesky" and res["ready_clips"][0]["seconds"] == 30


@pytest.mark.asyncio
async def test_prepare_returns_card_and_never_publishes(db_session):
    s, uid = await _user(db_session, "a")
    await _connect(db_session, uid)
    cid = await _clip(db_session, uid)
    res, execution = await tools.run("prepare_social_post", {"platform": "bluesky", "text": "oi", "clip_id": cid}, db_session, s)
    assert res["ready_to_post"] is True
    assert execution == {"status": "post_ready", "post": {"platform": "bluesky", "handle": "@ana", "text": "oi", "clip_id": cid}}
    assert (await db_session.execute(select(PostPublication))).scalars().all() == []


@pytest.mark.asyncio
async def test_prepare_refuses_bad_requests(db_session):
    s, uid = await _user(db_session, "a")
    _, other = await _user(db_session, "b")
    run = lambda **kw: tools.run("prepare_social_post", kw, db_session, s)  # noqa: E731
    assert (await run(platform="bluesky", text="oi"))[0]["error"] == "not_connected"
    await _connect(db_session, uid)
    assert (await run(platform="bluesky", text="  "))[0]["error"] == "empty_text"
    assert (await run(platform="bluesky", text="x" * 301))[0]["error"] == "too_long"
    assert (await run(platform="bluesky", text="oi", clip_id=await _clip(db_session, other)))[0]["error"] == "clip_not_ready"
    assert (await run(platform="bluesky", text="oi", clip_id=await _clip(db_session, uid, "rendering")))[0]["error"] == "clip_not_ready"
    res, execution = await run(platform="bluesky", text="oi", clip_id=999)
    assert res["error"] == "clip_not_ready" and execution is None


class _FakeInsightsAdapter:
    calls = 0

    async def fetch_insights(self, stored, external_id):
        type(self).calls += 1
        return {"followers": 91, "totals": {"posts": 1, "impressions": 40}, "engagement_rate": 15.0, "top_posts": []}


@pytest.mark.asyncio
async def test_insights_returns_card_scopes_to_caller_and_caches(db_session, monkeypatch):
    social_routes = importlib.import_module("server.social_routes")
    monkeypatch.setitem(tools.ADAPTERS, "x", _FakeInsightsAdapter())
    tools._insights_cache.clear()
    _FakeInsightsAdapter.calls = 0
    me, uid = await _user(db_session, "ana")
    other, _ = await _user(db_session, "bia")
    db_session.add(SocialAccount(user_id=uid, platform="x", external_id="42", handle="@ana",
                                 credentials_enc=social_routes._crypto.encrypt('{"access_token": "AT"}')))
    await db_session.commit()

    result, execution = await tools.run("get_social_insights", {}, db_session, me)
    assert result["followers"] == 91 and result["handle"] == "@ana" and execution["status"] == "insights_ready"
    again, _ = await tools.run("get_social_insights", {}, db_session, me)
    assert again["followers"] == 91 and _FakeInsightsAdapter.calls == 1  # segunda chamada vem do cache
    # outro creator não tem conta conectada: não enxerga nem gasta leitura
    refused, no_card = await tools.run("get_social_insights", {}, db_session, other)
    assert refused["error"] == "not_connected" and no_card is None and _FakeInsightsAdapter.calls == 1


def test_insights_prompt_forbids_numbers_that_did_not_come_from_the_account():
    # o modelo já inventou "benchmark de 1 a 3%": a regra tem de estar no prompt e na descrição da tool
    assert "NUNCA cite benchmark" in tools.SOCIAL_PROMPT
    assert "Com menos de 5 posts" in tools.SOCIAL_PROMPT  # amostra pequena: descrever, não concluir
    desc = next(t["function"]["description"] for t in tools.SOCIAL_TOOLS if t["function"]["name"] == "get_social_insights")
    assert "nunca cite média de mercado" in desc
