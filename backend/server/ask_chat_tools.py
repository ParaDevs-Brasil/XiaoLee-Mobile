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
                "template": {"type": "string", "enum": ["campaign"],
                             "description": "'campaign' = formulário pronto de criar campanha (título, descrição, tipo, "
                                            "recompensa, máximo de pessoas); nesse caso não mande perguntas"},
                "language": {"type": "string", "enum": ["pt", "en"], "description": "Idioma do creator (para o template)"},
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
                        "optional": {"type": "boolean", "description": "Pode ficar em branco (só para campo de texto)"},
                    }, "required": ["label", "short", "options"]},
                },
            },
            "required": [],
        },
    }},
]

ASK_PROMPT = (
    "- ask_questions: quando um pedido de várias etapas precisa de detalhes que você não pode assumir, abra o cartão "
    "em vez de listar perguntas em texto, e diga em uma frase curta o que está pedindo. Caso principal: o creator "
    "quer criar uma campanha. Chame ask_questions com template='campaign' e language ('pt' ou 'en', o idioma dele): o "
    "formulário completo (título, descrição, tipo, recompensa, máximo de pessoas e, para Social, perfil do X e ID do "
    "tweet) já vem pronto, sem você mandar perguntas. Se ele já disse algum desses dados, ainda assim abra o "
    "formulário. Só se o tipo for Social e o perfil ou o tweet vierem em branco, peça em texto. Para outros pedidos, mande 1 a 4 perguntas "
    "(pergunta sem opções vira um campo de texto) e, na dúvida, NÃO abra: responda e pergunte em texto como sempre. "
    "A resposta dele vem com o título do cartão e as respostas ('Criar campanha. Título: X. Tipo: Social.'): use-as "
    "e siga em frente, sem perguntar de novo.\n"
)

CAMPAIGN_FORM = {
    "pt": {"title": "Criar campanha", "q": [
        ("Título da campanha", "Título", [], None),
        ("Descrição", "Descrição", [], None),
        ("Tipo", "Tipo", ["Social (seguir perfil e engajar tweet)", "Trading (swap on-chain)", "Referral (indicar usuários)"], False),
        ("Recompensa por pessoa", "Recompensa", ["1 USDC", "5 USDC", "10 USDC"], False),
        ("Máximo de pessoas", "Pessoas", ["50", "100", "500"], False),
        ("Perfil do X a seguir, sem @ (só para Social)", "Perfil", [], True),
        ("ID do tweet a engajar (só para Social)", "Tweet", [], True)]},
    "en": {"title": "Create a campaign", "q": [
        ("Campaign title", "Title", [], None),
        ("Description", "Description", [], None),
        ("Type", "Type", ["Social (follow a profile and engage a tweet)", "Trading (on-chain swap)", "Referral (invite users)"], False),
        ("Reward per person", "Reward", ["1 USDC", "5 USDC", "10 USDC"], False),
        ("Max people", "People", ["50", "100", "500"], False),
        ("X profile to follow, no @ (Social only)", "Profile", [], True),
        ("Tweet ID to engage (Social only)", "Tweet", [], True)]},
}


def _campaign(language: str) -> dict:
    """Formulário fixo de campanha: o conjunto de campos não pode depender do modelo lembrar de todos."""
    form = CAMPAIGN_FORM["en" if language == "en" else "pt"]
    return {"mode": "form", "title": form["title"], "questions": [
        {"id": f"q{i}", "label": label, "short": short, "options": options, "multi": False,
         "other": bool(options), "text": not options, "optional": bool(optional)}
        for i, (label, short, options, optional) in enumerate(form["q"])]}


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
            "text": not options, "optional": bool(q.get("optional")),
        })
    if not questions:
        return None
    return {
        "mode": "form" if tool_input.get("mode") == "form" else "wizard",
        "title": str(tool_input.get("title") or "A few questions").strip()[:60],
        "questions": questions[:MAX_QUESTIONS],
    }


async def run(tool_name: str, tool_input: Dict[str, Any], db=None, user_id: str = "") -> tuple[dict, Optional[dict]]:
    ask = _campaign(str(tool_input.get("language", ""))) if tool_input.get("template") == "campaign" else _clean(tool_input)
    if not ask:
        return {"error": "bad_questions", "message": "Mande de 1 a 4 perguntas com texto."}, None
    return {"asked": True}, {"status": "ask_open", "ask": ask}
