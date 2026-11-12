"""
chat_language.py — em que idioma a Xiaolee responde, decidido pelo código e não deixado para o modelo.

O prompt do chat é escrito em português e as ferramentas devolvem texto em português; sem uma ordem explícita o modelo
escorrega (mensagem em inglês respondida em português, ou as duas línguas na mesma resposta). Aqui o idioma sai da conversa
e entra no prompt como uma linha só. Só português e inglês: qualquer outro idioma fica sem decisão (`None`) e o prompt
mantém a regra geral "responda no idioma do usuário".
"""

from __future__ import annotations

import re
from typing import Iterable, Optional

# Palavras que só existem em um dos idiomas (nada de "post", "video", "ok", "gm": iguais nos dois ou ambíguas).
_PT = frozenset("""
que não nao para pra com uma um uns umas é são sou está esta estou você voce vc vcs meu minha meus minhas seu sua quero
quer queria fazer faz faça faca como quanto qual quais onde quando porque pq por mas também tambem já ja ainda muito
obrigado obrigada oi olá ola bom boa dia tarde noite sim isso esse essa este esta aqui aí ai então entao tem ter tenho
posso pode podemos preciso me mim nos eu ele ela dele dela do da dos das no na nos nas ao aos num numa de em
ajuda ajudar mostra mostrar manda mandar posta postar criar crie cria novo nova novos novas meu vídeo
""".split())
_EN = frozenset("""
the and to is are am was were be been i you he she it we they my your his her our their me him them this that these those
want wants like make makes how what which where when why who can could would should will do does did have has had not no
yes please thanks thank hello hi hey about with for from into on in at of an a help show tell give create new post my
""".split())
# `no`/`a`/`post`/`my`/`in` existem nos dois idiomas ou quase: não pontuam.
_SHARED = frozenset({"no", "a", "post", "in", "me", "my", "on"})
_PT_MARKS = re.compile(r"[ãõçâêôáéíóúà]")


def detect_language(text: str) -> Optional[str]:
    """'pt', 'en' ou `None` quando não dá para dizer (mensagem curta como 'ok', ou outro idioma)."""
    words = re.findall(r"[a-zà-úç]+", text.lower())
    if not words:
        return None
    pt = sum(1 for w in words if w in _PT and w not in _SHARED) + len(_PT_MARKS.findall(text.lower()))
    en = sum(1 for w in words if w in _EN and w not in _SHARED)
    if pt == en:
        return None
    return "pt" if pt > en else "en"


def conversation_language(history: Iterable[dict] | None, text: str) -> Optional[str]:
    """A mensagem atual manda; se ela é ambígua ('ok', 'sim?'), vale a última do usuário que dá para identificar."""
    current = detect_language(text)
    if current:
        return current
    for turn in reversed(list(history or [])):
        if turn.get("role") == "bot":
            continue
        found = detect_language(re.sub(r"\[System Note:[^\]]+\]\s*", "", str(turn.get("content", ""))))
        if found:
            return found
    return None


_NAME = {"pt": "português do Brasil", "en": "inglês"}


def language_rule(language: Optional[str]) -> str:
    """Linha do prompt. Sem decisão, a regra geral de sempre."""
    if language not in _NAME:
        return "Responda SEMPRE no idioma do usuário."
    return (
        f"IDIOMA DESTA CONVERSA: {_NAME[language]}. Responda inteira em {_NAME[language]}, do começo ao fim, sem misturar "
        "idiomas na mesma resposta. O texto que as ferramentas devolvem e as instruções acima podem estar em outro idioma "
        "(muitas estão em português): traduza o que for usar. Nomes de telas e botões do app ficam como são no app (ex.: "
        "Accounts, Clips, AI Creators)."
    )
