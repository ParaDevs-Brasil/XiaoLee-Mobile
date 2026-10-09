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
