"""
test_language.py — o agente responde no idioma do usuário, não no do prompt.

Regras que estes testes travam:
- mensagens claras em EN e PT são detectadas (inclusive os textos dos cards do menu);
- mensagem sem sinal ("ok", endereço) não chuta: vale a última do usuário que tiver;
- a nota de sistema com a wallet (em inglês) não conta como fala do usuário;
- o prompt do agente termina com a instrução do idioma detectado.
"""
from __future__ import annotations

import pytest

from server.language import conversation_language, detect_language, language_directive


@pytest.mark.parametrize("text", [
    "Show me the campaigns that best match my interests",
    "Show my metrics: everything I have done on the platform",
    "What is my balance?",
    "hi",
    "I want to make a swap",
])
def test_ingles(text):
    assert detect_language(text) == "en"


@pytest.mark.parametrize("text", [
    "quais campanhas combinam comigo?",
    "qual meu saldo?",
    "oi",
    "quero criar uma campanha",
    "me mostra minhas métricas",
])
def test_portugues(text):
    assert detect_language(text) == "pt"


@pytest.mark.parametrize("text", ["ok", "0x1234abcd", "👍", ""])
def test_sem_sinal_nao_chuta(text):
    assert detect_language(text) is None


def test_nota_de_sistema_nao_conta_como_fala_do_usuario():
    note = "[System Note: User connected wallet is 0xabc on arc] "
    assert detect_language(note + "qual meu saldo?") == "pt"


def test_mensagem_ambigua_herda_a_ultima_do_usuario():
    history = [
        {"role": "user", "content": "quero criar uma campanha"},
        {"role": "bot", "content": "Show! What's the title?"},
    ]
    assert conversation_language("ok", history) == "pt"
    assert conversation_language("ok", []) is None


def test_instrucao_por_idioma():
    assert "ONLY in English" in language_directive("en")
    assert "SOMENTE em português" in language_directive("pt")
    assert "latest message" in language_directive(None)
