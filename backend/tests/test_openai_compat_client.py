"""
test_openai_compat_client.py — adapter que roda o ChatAgentEngine num modelo OpenAI-compatible.

Regras que estes testes travam:
- o loop multi-step (tool_use → tool_result → resposta) atravessa a tradução sem perder ids;
- system em blocos vira uma mensagem system; recursos só da Anthropic são ignorados;
- argumento de tool com JSON quebrado não derruba o loop.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from chat_agent import ChatAgentEngine
from openai_compat_client import (
    OpenAICompatAnthropicClient,
    anthropic_to_openai_messages,
    openai_choice_to_anthropic,
)


def _tool_call(id: str, name: str, arguments: str) -> SimpleNamespace:
    return SimpleNamespace(id=id, function=SimpleNamespace(name=name, arguments=arguments))


def _completion(content=None, tool_calls=None) -> SimpleNamespace:
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=tool_calls))])


class _FakeCompletions:
    """Responde em sequência e guarda o que recebeu, no lugar do Groq."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0)


def _client_with(fake: _FakeCompletions) -> OpenAICompatAnthropicClient:
    client = OpenAICompatAnthropicClient(api_key="test")
    client.messages._client = SimpleNamespace(chat=SimpleNamespace(completions=fake))
    return client


@pytest.mark.asyncio
async def test_loop_agentico_completo_pelo_adapter():
    fake = _FakeCompletions([
        _completion(tool_calls=[_tool_call("call_1", "list_campaigns", "{}")]),
        _completion(content="Swap Challenge combina com você."),
    ])
    engine = ChatAgentEngine(_client_with(fake), "openai/gpt-oss-120b")
    executed = []

    async def executor(name, tool_input):
        executed.append((name, tool_input))
        return json.dumps({"campaigns": [{"id": 2}]})

    result = await engine.run(
        system_prompt="Você é a Xiaolee.",
        message="campanhas pra mim",
        tools=[{"type": "function", "function": {"name": "list_campaigns", "parameters": {"type": "object"}}}],
        tool_executor=executor,
    )

    assert result["text"] == "Swap Challenge combina com você."
    assert executed == [("list_campaigns", {})]

    first, second = fake.calls
    assert first["model"] == "openai/gpt-oss-120b"
    assert first["messages"][0] == {"role": "system", "content": "Você é a Xiaolee."}
    assert first["tools"][0]["function"]["name"] == "list_campaigns"
    assert "thinking" not in first and "system" not in first

    # 2ª chamada: o turno do assistente com tool_calls e o resultado casando pelo id.
    assistant, tool = second["messages"][-2:]
    assert assistant["tool_calls"][0]["id"] == "call_1"
    assert tool == {"role": "tool", "tool_call_id": "call_1", "content": json.dumps({"campaigns": [{"id": 2}]})}


def test_historico_em_texto_passa_direto():
    converted = anthropic_to_openai_messages(
        [{"type": "text", "text": "sys", "cache_control": {"type": "ephemeral"}}],
        [{"role": "user", "content": "oi"}, {"role": "assistant", "content": "olá!"}],
    )
    assert converted == [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "oi"},
        {"role": "assistant", "content": "olá!"},
    ]


def test_argumento_quebrado_vira_input_vazio():
    message = SimpleNamespace(content=None, tool_calls=[_tool_call("c", "join_campaign", '{"campaign_id": ')])
    response = openai_choice_to_anthropic(message)
    assert response.stop_reason == "tool_use"
    assert response.content[0].input == {}


def test_so_texto_encerra_o_turno():
    response = openai_choice_to_anthropic(SimpleNamespace(content="pronto", tool_calls=None))
    assert response.stop_reason == "end_turn"
    assert [b.type for b in response.content] == ["text"]
