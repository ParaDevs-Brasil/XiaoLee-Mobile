"""
test_usage_quota.py — cota diária do plano grátis + disjuntor global + identidade não forjável.
"""
from __future__ import annotations

import importlib
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from server import usage_quota as uq
from server.settings import settings

app_module = importlib.import_module("server.app")


@pytest.fixture
def cfg():
    """settings é dataclass congelado: altera e restaura no fim do teste."""
    saved = {}
    def set_(**kw):
        for k, v in kw.items():
            saved.setdefault(k, getattr(settings, k))
            object.__setattr__(settings, k, v)
    yield set_
    for k, v in saved.items():
        object.__setattr__(settings, k, v)


def _req(xff: str | None, host: str = "9.9.9.9"):
    return SimpleNamespace(headers={"x-forwarded-for": xff} if xff else {}, client=SimpleNamespace(host=host))


# --- núcleo ---------------------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_bloqueia_ao_passar_do_limite_e_isola_identidades(db_session, cfg):
    cfg(llm_global_daily_messages=0)
    a = uq.Subject("u:x:a", 3, "user")
    b = uq.Subject("u:x:b", 3, "user")
    assert [(await uq.consume(db_session, a)).allowed for _ in range(4)] == [True, True, True, False]
    d = await uq.consume(db_session, a)
    assert not d.allowed and d.scope == "user" and d.limit == 3 and d.used == 5
    assert (await uq.consume(db_session, b)).allowed  # outra identidade não é afetada


@pytest.mark.asyncio
async def test_renova_no_dia_seguinte_utc(db_session, cfg, monkeypatch):
    cfg(llm_global_daily_messages=0)
    s = uq.Subject("u:x:a", 1, "user")
    monkeypatch.setattr(uq, "_now", lambda: datetime(2026, 10, 10, 23, 59, tzinfo=timezone.utc))
    assert (await uq.consume(db_session, s)).allowed
    blocked = await uq.consume(db_session, s)
    assert not blocked.allowed and blocked.reset_at.startswith("2026-10-11T00:00:00")
    monkeypatch.setattr(uq, "_now", lambda: datetime(2026, 10, 11, 0, 1, tzinfo=timezone.utc))
    assert (await uq.consume(db_session, s)).allowed


@pytest.mark.asyncio
async def test_disjuntor_global_so_conta_quem_passou_na_cota_individual(db_session, cfg):
    cfg(llm_global_daily_messages=2)
    A, B, C = (uq.Subject(f"u:x:{n}", 1, "user") for n in "abc")
    assert (await uq.consume(db_session, A)).allowed          # global 1
    assert not (await uq.consume(db_session, A)).allowed       # barrado pela cota própria: NÃO gasta o global
    assert (await uq.consume(db_session, B)).allowed          # global 2
    d = await uq.consume(db_session, C)                        # global estourou
    assert not d.allowed and d.scope == "global" and d.limit == 2


@pytest.mark.asyncio
async def test_falha_do_contador_nao_derruba_o_chat(db_session, cfg, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("tabela não existe")
    monkeypatch.setattr(uq, "_bump", boom)
    assert (await uq.consume(db_session, uq.Subject("u:x:a", 1, "user"))).allowed


def test_ip_vem_do_proxy_confiavel_nao_do_inicio_da_lista(cfg):
    cfg(trusted_proxy_hops=1)
    assert uq.client_ip(_req("6.6.6.6, 1.2.3.4")) == "1.2.3.4"   # início forjado pelo cliente é ignorado
    assert uq.client_ip(_req(None)) == "9.9.9.9"
    cfg(trusted_proxy_hops=0)
    assert uq.client_ip(_req("6.6.6.6, 1.2.3.4")) == "9.9.9.9"


# --- integração: /chat ----------------------------------------------------------------------------
AUTH = {"Authorization": "Bearer chat-sessions-test-user"}


@pytest.fixture
def chat(isolated_app_db, cfg, monkeypatch):
    app_module.request_hits.clear()
    cfg(llm_global_daily_messages=0)
    cfg(trusted_proxy_hops=1)
    ex = AsyncMock(return_value={"reply_text": "ok", "intent": {"action": "help", "confidence": 1.0, "entities": {}}, "execution": {}})
    monkeypatch.setattr(app_module.orchestrator, "execute", ex)
    return TestClient(app_module.app), ex


def _say(client, headers=None, **payload):
    return client.post("/chat", json={"message": "oi", **payload}, headers=headers or {}).json()


def test_anonimo_nao_escapa_trocando_o_user_id(chat, cfg):
    client, ex = chat
    cfg(anon_daily_messages=2)
    ip = {"x-forwarded-for": "5.5.5.5"}
    out = [_say(client, ip, user_id=f"fake-{i}") for i in range(4)]
    assert [o["intent"]["action"] == "quota_exceeded" for o in out] == [False, False, True, True]
    assert ex.await_count == 2                                   # a LLM só foi chamada 2 vezes
    assert "limite" in out[2]["response"][0]["content"].lower() or "free" in out[2]["response"][0]["content"].lower()
    # outro IP tem a própria cota
    assert _say(client, {"x-forwarded-for": "7.7.7.7"}, user_id="fake-0")["intent"]["action"] != "quota_exceeded"


def test_logado_tem_cota_propria_e_nao_gasta_a_do_ip(chat, cfg):
    client, ex = chat
    cfg(anon_daily_messages=1)
    cfg(free_daily_messages=2)
    ip = {"x-forwarded-for": "5.5.5.5"}
    ok = [_say(client, {**AUTH, **ip}) for _ in range(3)]
    assert [o["intent"]["action"] == "quota_exceeded" for o in ok] == [False, False, True]
    # o IP continua com a cota anônima intacta
    assert _say(client, ip, user_id="anon")["intent"]["action"] != "quota_exceeded"


def test_limite_zero_desliga(chat, cfg):
    client, ex = chat
    cfg(anon_daily_messages=0)
    assert all(_say(client, {"x-forwarded-for": "5.5.5.5"})["intent"]["action"] != "quota_exceeded" for _ in range(5))
