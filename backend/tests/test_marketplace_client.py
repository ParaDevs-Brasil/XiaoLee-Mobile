"""Comprador do marketplace: desligado sem env (não muda o chat), liga com env; resultado marcado como dado de terceiros."""
import pytest

from server.integrations import marketplace_client as mc


def test_disabled_without_env(monkeypatch):
    monkeypatch.delenv("X402_GATEWAY_INTERNAL_URL", raising=False)
    assert mc.tools() == []


def test_enabled_with_env(monkeypatch):
    monkeypatch.setenv("X402_GATEWAY_INTERNAL_URL", "http://gw")
    monkeypatch.setenv("X402_INTERNAL_SECRET", "s")
    assert {t["function"]["name"] for t in mc.tools()} == {"search_marketplace", "buy_marketplace_service"}


@pytest.mark.asyncio
async def test_call_sends_secret_and_marks_untrusted(monkeypatch):
    monkeypatch.setenv("X402_GATEWAY_INTERNAL_URL", "http://gw")
    monkeypatch.setenv("X402_INTERNAL_SECRET", "s")
    seen = {}

    class R:
        status_code = 200
        def json(self): return {"items": []}

    class C:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def get(self, url, params=None, headers=None):
            seen.update(url=url, headers=headers); return R()

    monkeypatch.setattr(mc.httpx, "AsyncClient", C)
    out = await mc.call("search_marketplace", {"query": "clip"})
    assert seen["headers"]["x-internal-secret"] == "s" and seen["url"].endswith("/internal/market/search")
    assert "dado" in out["_note"]


@pytest.mark.asyncio
async def test_buy_sends_user_and_confirm_id_and_confirm_hits_gateway(monkeypatch):
    monkeypatch.setenv("X402_GATEWAY_INTERNAL_URL", "http://gw")
    monkeypatch.setenv("X402_INTERNAL_SECRET", "s")
    sent = []

    class R:
        status_code = 200
        content = b"{}"
        def json(self): return {"confirmed": True}

    class C:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def post(self, url, json=None, headers=None):
            sent.append((url, json)); return R()

    monkeypatch.setattr(mc.httpx, "AsyncClient", C)
    await mc.call("buy_marketplace_service", {"resource": "https://a/x", "confirm_id": "c1"}, "u1")
    assert sent[0][0].endswith("/internal/market/buy")
    assert sent[0][1]["userId"] == "u1" and sent[0][1]["confirmId"] == "c1"
    out = await mc.confirm("c1", "u1")
    assert sent[1][0].endswith("/internal/market/confirm") and sent[1][1] == {"confirmId": "c1", "userId": "u1"}
    assert out["status"] == 200
