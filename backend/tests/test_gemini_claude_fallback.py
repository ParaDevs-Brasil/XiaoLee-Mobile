import httpx
import pytest

from server.integrations import gemini_client as gc


class _Block:
    type = "text"
    text = "oi do claude"


class _FakeMessages:
    def __init__(self, sink):
        self.sink = sink

    async def create(self, **kw):
        self.sink.update(kw)
        return type("R", (), {"content": [_Block()]})()


class _FakeAnthropic:
    sink: dict = {}

    def __init__(self, **kw):
        self.messages = _FakeMessages(_FakeAnthropic.sink)


async def _gemini_402(self, payload, model, timeout=25):
    req = httpx.Request("POST", self._api_url(model))
    raise httpx.HTTPStatusError("402", request=req, response=httpx.Response(402, request=req))


@pytest.fixture
def fake_anthropic(monkeypatch):
    import anthropic

    _FakeAnthropic.sink = {}
    monkeypatch.setattr(anthropic, "AsyncAnthropic", _FakeAnthropic)
    monkeypatch.setattr(gc.GeminiClient, "_call", _gemini_402)
    return _FakeAnthropic.sink


@pytest.mark.asyncio
async def test_gemini_402_falls_back_to_claude(fake_anthropic):
    c = gc.GeminiClient("g-key", "gemini-2.5-flash", anthropic_api_key="a-key", anthropic_model="claude-x")
    history = [{"role": "bot", "content": "oi"}, {"role": "user", "content": "a"}, {"role": "user", "content": "b"}]
    reply = await c.generate_reply("instr", "post this", history=history)
    assert reply == "oi do claude"
    assert fake_anthropic["model"] == "claude-x"
    msgs = fake_anthropic["messages"]
    # leading assistant turn dropped, consecutive user turns merged, ends on the user message
    assert [m["role"] for m in msgs] == ["user"]
    assert msgs[0]["content"].endswith("post this")


@pytest.mark.asyncio
async def test_no_anthropic_key_keeps_error_phrase(fake_anthropic):
    c = gc.GeminiClient("g-key", "gemini-2.5-flash")
    reply = await c.generate_reply("instr", "hi")
    assert reply.startswith("Não consegui responder agora")
    assert fake_anthropic == {}


def test_api_key_not_in_url():
    assert "key" not in gc.GeminiClient("secret-k", "m")._api_url("m")
