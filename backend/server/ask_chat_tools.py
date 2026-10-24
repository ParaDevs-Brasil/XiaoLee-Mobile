"""Perguntas estruturadas no chat (`ask_questions`): a Xiaolee abre um cartão com 1-4 perguntas de opção em vez de
mandar uma lista em texto. O app mostra o cartão (formulário ou passo a passo) e a resposta volta como uma mensagem
comum. A tool só descreve o cartão: não muda nada no backend. Desligada = o chat não ganha a tool.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

from server.settings import settings

ASK_TOOL_NAMES = {"ask_questions"}
MAX_QUESTIONS, MAX_OPTIONS = 4, 5
# O cartão já oferece "Something else"; uma opção "Outro valor" do modelo só duplicaria.
_OTHER = re.compile(r"^(outr[oa]s?\b|other\b|something else|algo mais)", re.I)

ASK_TOOLS = [
    {"type": "function", "function": {
        "name": "ask_questions",
        "description": (
            "Abre na conversa um cartão com 1 a 4 perguntas de múltipla escolha, para o creator responder tocando. "
            "Use SÓ quando faltam 2 ou 3 detalhes que mudam o resultado de um pedido de várias etapas (ex.: montar "
            "uma campanha: objetivo, redes, orçamento). NÃO use para dúvida simples, conversa, saudação, nem para "
            "detalhe que você mesmo pode assumir. Uma vez por pedido; não repita pergunta que ele já respondeu."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Título curto do cartão (ex.: 'Plan your campaign')"},
                "mode": {"type": "string", "enum": ["wizard", "form"],
                         "description": "wizard = uma pergunta por vez; form = todas juntas"},
                "questions": {
                    "type": "array", "minItems": 1, "maxItems": MAX_QUESTIONS,
                    "items": {"type": "object", "properties": {
                        "label": {"type": "string", "description": "A pergunta"},
                        "short": {"type": "string", "description": "Rótulo de 1 palavra para o resumo, no mesmo idioma da pergunta (ex.: Objetivo)"},
                        "options": {"type": "array", "maxItems": MAX_OPTIONS, "items": {"type": "string"}},
                        "multi": {"type": "boolean", "description": "Pode escolher várias"},
                    }, "required": ["label", "short", "options"]},
                },
            },
            "required": ["title", "questions"],
        },
    }},
]

ASK_PROMPT = (
    "- ask_questions: quando um pedido de várias etapas precisa de detalhes de múltipla escolha que você não pode "
    "assumir, abra o cartão em vez de listar perguntas em texto, e diga em uma frase curta o que está perguntando. "
    "Caso principal: o creator quer criar uma campanha e ainda não disse o tipo, a recompensa e o número de pessoas. "
    "Abra UM cartão (mode wizard) com essas 3 perguntas (tipo: Social, Trading, Referral; recompensa por pessoa em "
    "USDC, com 3 valores pequenos; máximo de pessoas, com 3 valores), em vez de perguntar uma por vez. Título e "
    "descrição você pede depois, em texto. Para o resto, na dúvida NÃO abra: responda e pergunte em texto como "
    "sempre. Quando o creator responder, a mensagem dele vem com o título do cartão e as respostas ('Plan your "
    "campaign. Type: Social. Reward: 5 USDC.'): use-as e siga em frente, sem perguntar de novo.\n"
)


def _clean(tool_input: Dict[str, Any]) -> Optional[dict]:
    """Só o que o app sabe desenhar: textos curtos, no máximo 4 perguntas e 5 opções cada."""
    questions = []
    for i, q in enumerate(tool_input.get("questions") or []):
        if not isinstance(q, dict) or not str(q.get("label", "")).strip():
            continue
        options = [o for o in (str(o).strip()[:60] for o in (q.get("options") or [])) if o and not _OTHER.match(o)][:MAX_OPTIONS]
        questions.append({
            "id": f"q{i}", "label": str(q["label"]).strip()[:140], "short": str(q.get("short") or q["label"]).strip()[:20],
            "options": options, "multi": bool(q.get("multi")) and len(options) > 1, "other": bool(options),
            "text": not options,
        })
    if not questions:
        return None
    return {
        "mode": "form" if tool_input.get("mode") == "form" else "wizard",
        "title": str(tool_input.get("title") or "A few questions").strip()[:60],
        "questions": questions[:MAX_QUESTIONS],
    }


async def run(tool_name: str, tool_input: Dict[str, Any], db=None, user_id: str = "") -> tuple[dict, Optional[dict]]:
    ask = _clean(tool_input)
    if not ask:
        return {"error": "bad_questions", "message": "Mande de 1 a 4 perguntas com texto."}, None
    return {"asked": True}, {"status": "ask_open", "ask": ask}
