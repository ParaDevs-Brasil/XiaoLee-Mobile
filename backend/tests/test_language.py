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


# ---------------------------------------------------------------------------
# O prompt que chega ao modelo termina com o idioma da conversa
# ---------------------------------------------------------------------------

from server.orchestration.service import OrchestrationService  # noqa: E402


class _Engine:
    def __init__(self):
        self.calls = []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        return {"text": "ok"}


@pytest.mark.asyncio
@pytest.mark.parametrize("message, expected", [
    ("What is my balance?", language_directive("en")),
    ("[System Note: User connected wallet is 0xabc on arc] qual meu saldo?", language_directive("pt")),
])
async def test_agente_recebe_o_idioma_da_mensagem(message, expected):
    engine = _Engine()
    service = OrchestrationService(gemini=None, solana=None, claude_engine=engine)
    await service.execute(message, "web_anonymous")
    assert engine.calls[0]["system_prompt"].endswith(expected)


@pytest.mark.asyncio
@pytest.mark.db
async def test_menu_recebe_o_idioma_do_card(db_session, test_engine, monkeypatch):
    import database.database as database_module
    from sqlalchemy.ext.asyncio import async_sessionmaker

    monkeypatch.setattr(database_module, "SessionLocal", async_sessionmaker(test_engine, expire_on_commit=False))
    engine = _Engine()
    service = OrchestrationService(gemini=None, solana=None, claude_engine=engine)
    await service.execute(
        "Show me the campaigns that best match my interests", "web_anonymous", menu_action="browse_campaigns",
    )
    assert engine.calls[0]["system_prompt"].endswith(language_directive("en"))
