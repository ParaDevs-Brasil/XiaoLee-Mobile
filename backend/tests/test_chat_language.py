"""
test_chat_language.py — a Xiaolee responde no idioma da conversa, decidido pelo código.

Trava: o idioma sai da mensagem atual (ou da última do usuário, se a atual é ambígua), entra no prompt como uma ordem
explícita, e sem decisão o prompt mantém a regra geral de antes. Só pt e en.
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from server.chat_language import conversation_language, detect_language, language_rule
from server.orchestration.service import OrchestrationService as Orch


@pytest.mark.parametrize("text,expected", [
    ("quero postar algo no X", "pt"),
    ("me ajuda a fazer um post sobre o meu novo vídeo de IA", "pt"),
    ("posta isso pra mim: acabei de lançar um vídeo novo", "pt"),
    ("oi", "pt"),
    ("qual é o meu saldo?", "pt"),
    ("I want to post something on X", "en"),
    ("help me write a post about my new AI video", "en"),
    ("how much is in the campaign treasury?", "en"),
    ("hi", "en"),
    ("ok", None),
    ("gm", None),
    ("0xe8ECAcf9", None),
    ("", None),
])
def test_detects_portuguese_and_english(text, expected):
    assert detect_language(text) == expected


def test_current_message_wins_even_when_the_history_is_in_the_other_language():
    history = [{"role": "user", "content": "quero postar algo"}, {"role": "bot", "content": "Preenche o formulário"}]
    assert conversation_language(history, "help me write a post about my new AI video") == "en"


def test_an_ambiguous_message_follows_the_last_clear_user_message():
    history = [
        {"role": "user", "content": "[System Note: User connected wallet is 0xabc] I want to post something"},
        {"role": "bot", "content": "Fill in the form and send it over"},
        {"role": "user", "content": "me ajuda com um vídeo novo"},
        {"role": "bot", "content": "Claro! Conta mais"},
    ]
    assert conversation_language(history, "ok") == "pt"
    assert conversation_language(None, "ok") is None


def test_the_prompt_carries_an_explicit_language_order():
    prompt = object.__new__(Orch)._build_agentic_system_prompt(None, "web", evm_wallet=None, language="en")
    assert "IDIOMA DESTA CONVERSA: inglês" in prompt and "sem misturar" in prompt
    assert "Responda SEMPRE no idioma do usuário." not in prompt
    pt = object.__new__(Orch)._build_agentic_system_prompt(None, "web", evm_wallet=None, language="pt")
    assert "IDIOMA DESTA CONVERSA: português do Brasil" in pt


def test_without_a_decision_the_old_general_rule_stays():
    prompt = object.__new__(Orch)._build_agentic_system_prompt(None, "web", evm_wallet=None, language=None)
    assert "Responda SEMPRE no idioma do usuário." in prompt and "IDIOMA DESTA CONVERSA" not in prompt
    assert language_rule("fr") == "Responda SEMPRE no idioma do usuário."
