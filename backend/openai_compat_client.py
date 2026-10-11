"""
openai_compat_client.py — roda o ``ChatAgentEngine`` num modelo OpenAI-compatible.

O loop agêntico do chat (``chat_agent.ChatAgentEngine``) fala o formato da
Anthropic (``client.messages.create`` → blocos ``text``/``tool_use``). Este módulo
imita essa interface por cima de ``/chat/completions``, para testar o mesmo loop,
com as mesmas tools e o mesmo system prompt, num modelo free (Groq) sem crédito
Anthropic. Ativa com ``LLM_PROVIDER=groq`` (ver ``OrchestrationService``).

O que se perde na tradução, de propósito: ``thinking`` e ``cache_control`` são
recursos da Anthropic e são ignorados. A resposta não é a do Claude — serve para
testar o fluxo (tool certa, dados certos), não para julgar a voz da Xiaolee.
"""
from __future__ import annotations

import json
import logging
from types import SimpleNamespace
from typing import Any, Dict, List

import openai

logger = logging.getLogger(__name__)

GROQ_BASE_URL = "https://api.groq.com/openai/v1"


def _field(block: Any, key: str) -> Any:
    """Blocos chegam como dict (montados pelo engine) ou objeto (devolvidos por nós)."""
    return block.get(key) if isinstance(block, dict) else getattr(block, key, None)


def _system_text(system: Any) -> str:
    if isinstance(system, list):
        return "\n".join(_field(b, "text") or "" for b in system)
    return system or ""


def anthropic_to_openai_messages(system: Any, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Mensagens no formato Anthropic → ``messages`` de ``/chat/completions``.

    - turno do assistente com ``tool_use`` vira ``tool_calls``;
    - ``tool_result`` (que na Anthropic vem num turno ``user``) vira mensagem ``tool``.
    """
    converted: List[Dict[str, Any]] = [{"role": "system", "content": _system_text(system)}]
    for message in messages:
        content = message["content"]
        if isinstance(content, str):
            converted.append({"role": message["role"], "content": content})
            continue

        if message["role"] == "assistant":
            text = "".join(_field(b, "text") or "" for b in content if _field(b, "type") == "text")
            tool_calls = [
                {
                    "id": _field(b, "id"),
                    "type": "function",
                    "function": {"name": _field(b, "name"), "arguments": json.dumps(_field(b, "input") or {})},
                }
                for b in content
                if _field(b, "type") == "tool_use"
            ]
            assistant: Dict[str, Any] = {"role": "assistant", "content": text or None}
            if tool_calls:
                assistant["tool_calls"] = tool_calls
            converted.append(assistant)
            continue

        for block in content:
            if _field(block, "type") == "tool_result":
                converted.append({
                    "role": "tool",
                    "tool_call_id": _field(block, "tool_use_id"),
                    "content": str(_field(block, "content")),
                })
            elif _field(block, "type") == "text":
                converted.append({"role": "user", "content": _field(block, "text")})
    return converted


def anthropic_to_openai_tools(tools: List[Dict[str, Any]] | None) -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool.get("description", ""),
                "parameters": tool.get("input_schema") or {"type": "object", "properties": {}},
            },
        }
        for tool in tools or []
    ]


def openai_choice_to_anthropic(message: Any) -> SimpleNamespace:
    """``choices[0].message`` → objeto com ``stop_reason``/``content`` como o do SDK Anthropic."""
    blocks: List[SimpleNamespace] = []
    if message.content:
        blocks.append(SimpleNamespace(type="text", text=message.content))
    for call in message.tool_calls or []:
        raw = call.function.arguments or ""
        try:
            tool_input = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            # Modelo menor às vezes manda JSON quebrado; a tool recebe vazio e
            # devolve erro de campo faltando, que o loop já sabe tratar.
            logger.warning("[openai-compat] invalid tool arguments for %s: %r", call.function.name, raw)
            tool_input = {}
        blocks.append(SimpleNamespace(type="tool_use", id=call.id, name=call.function.name, input=tool_input))
    stop_reason = "tool_use" if any(b.type == "tool_use" for b in blocks) else "end_turn"
    return SimpleNamespace(stop_reason=stop_reason, content=blocks, usage=None)


class _Messages:
    def __init__(self, client: openai.AsyncOpenAI):
        self._client = client

    async def create(
        self,
        *,
        model: str,
        messages: List[Dict[str, Any]],
        system: Any = None,
        tools: List[Dict[str, Any]] | None = None,
        max_tokens: int = 4096,
        **_anthropic_only: Any,  # thinking, cache_control…
    ) -> SimpleNamespace:
        kwargs: Dict[str, Any] = {
            "model": model,
            "messages": anthropic_to_openai_messages(system, messages),
            "max_tokens": max_tokens,
        }
        if tools:
            kwargs["tools"] = anthropic_to_openai_tools(tools)
        response = await self._client.chat.completions.create(**kwargs)
        return openai_choice_to_anthropic(response.choices[0].message)


class OpenAICompatAnthropicClient:
    """Substituto de ``anthropic.AsyncAnthropic`` para o ``ChatAgentEngine``.

    ``max_retries`` alto porque o free tier do Groq limita tokens por minuto e
    devolve 429 com ``retry-after`` — o SDK ``openai`` espera e repete sozinho.
    """

    def __init__(self, api_key: str, base_url: str = GROQ_BASE_URL, max_retries: int = 5):
        self.messages = _Messages(openai.AsyncOpenAI(api_key=api_key, base_url=base_url, max_retries=max_retries))
