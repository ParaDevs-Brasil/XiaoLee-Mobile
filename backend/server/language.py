"""
Idioma da resposta do agente: o da mensagem do usuário, nunca o do prompt.

O system prompt do chat é quase todo em português (e tem exemplos de resposta
em PT), então "responda no idioma do usuário" no meio dele perdia: o modelo
respondia em português a quem escreveu em inglês. Aqui o idioma é detectado de
forma determinística e vira uma instrução explícita no fim do prompt.

Heurística de palavras-marcador, sem dependência nova: o app só fala PT-BR e EN,
e o que importa é não errar mensagens claras ("Show my metrics", "quais
campanhas tem?"). Mensagem sem marcador ("ok", "0x1234…") devolve None e quem
chama decide (ex.: olhar a mensagem anterior).
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

Language = str  # "en" | "pt"

# Palavras que existem nas duas línguas ("me", "do", "no", "um", "meta") ficam de fora.
_PT_WORDS = frozenset({
    "oi", "olá", "ola", "tudo", "bem", "você", "voce", "vc", "eu", "meu", "minha", "meus", "minhas",
    "quero", "queria", "quais", "qual", "quanto", "quantos", "como", "onde", "quando", "porque", "por",
    "que", "não", "nao", "sim", "obrigado", "obrigada", "valeu", "mostre", "mostra", "mim",
    "campanha", "campanhas", "saldo", "carteira", "criar", "ver", "tenho", "tem", "fazer", "faça",
    "uma", "para", "pra", "com", "das", "dos", "na", "nas", "nos", "isso", "esse", "essa",
    "ajuda", "trocar", "enviar", "mandar", "agora", "também", "tambem", "métricas", "metricas",
})
_EN_WORDS = frozenset({
    "hi", "hello", "hey", "the", "my", "show", "what", "which", "how", "where", "when", "why", "is",
    "are", "does", "can", "want", "would", "like", "please", "thanks", "thank", "you", "your",
    "i", "i'm", "im", "campaign", "campaigns", "balance", "wallet", "create", "see", "have", "make",
    "swap", "send", "to", "for", "with", "and", "of", "it", "this", "that", "everything", "done",
    "best", "match", "interests", "metrics", "recent", "transactions", "help", "now", "too", "join",
})
_PT_CHARS = re.compile(r"[ãõçáéíóúâêôà]")
_WORD = re.compile(r"[\w']+", re.UNICODE)
_SYSTEM_NOTE = re.compile(r"\[System Note:[^\]]+\]\s*")


def detect_language(text: str) -> Optional[Language]:
    """"en", "pt" ou None quando a mensagem não dá sinal claro."""
    clean = _SYSTEM_NOTE.sub("", text or "").lower()
    words = _WORD.findall(clean)
    pt = sum(1 for w in words if w in _PT_WORDS) + len(_PT_CHARS.findall(clean))
    en = sum(1 for w in words if w in _EN_WORDS)
    if pt > en:
        return "pt"
    if en > pt:
        return "en"
    return None


def conversation_language(message: str, history: Iterable[dict] | None = None) -> Optional[Language]:
    """Idioma da mensagem atual; se ela for ambígua, o da última mensagem do usuário que tiver sinal."""
    lang = detect_language(message)
    if lang:
        return lang
    for turn in reversed(list(history or [])):
        if turn.get("role") != "bot":
            lang = detect_language(turn.get("content", ""))
            if lang:
                return lang
    return None


_DIRECTIVES = {
    "en": (
        "LANGUAGE — this overrides every other instruction: the user is writing in English, so reply "
        "ONLY in English. The instructions and examples above are partly in Portuguese and tool data "
        "may be too; that never changes the reply language — translate whatever you use."
    ),
    "pt": (
        "IDIOMA — vale acima de qualquer outra instrução: o usuário está escrevendo em português, então "
        "responda SOMENTE em português (PT-BR). Instruções, exemplos ou dados de tools em inglês não "
        "mudam o idioma da resposta — traduza o que usar."
    ),
}
_DEFAULT_DIRECTIVE = (
    "LANGUAGE: reply in the language of the user's latest message (PT-BR or EN), never in the language "
    "of these instructions."
)


def language_directive(lang: Optional[Language]) -> str:
    return _DIRECTIVES.get(lang or "", _DEFAULT_DIRECTIVE)
