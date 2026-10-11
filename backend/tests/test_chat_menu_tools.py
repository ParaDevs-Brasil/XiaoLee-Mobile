"""
test_chat_menu_tools.py — tools que as opções do menu do chat acionam (XIAOLEEACE-20).

Regras que estes testes travam:
- `list_campaigns` ranqueia pelo perfil de quem está no chat (o modelo não passa perfil);
- o executor recebe o `twitter_user_id` que o `/chat` já resolveu do Bearer — é ele
  que identifica o usuário, não o token de sessão;
- `get_my_activity` devolve o histórico de quem está logado e recusa anônimo;
- card do menu (`menu_action`) chama a tool certa SEM depender do modelo: com o
  modelo fora ou falhando, a resposta sai do fallback com os mesmos dados.
"""
from __future__ import annotations

import json

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

import database.database as database_module
from database.models import User
from server.chat_menu import fallback_reply
from server.orchestration.service import OrchestrationService

pytestmark = [pytest.mark.asyncio, pytest.mark.db]


@pytest.fixture
def executor_for(db_session, test_engine, monkeypatch):
    # As tools abrem a própria sessão via `database.database.SessionLocal`.
    monkeypatch.setattr(database_module, "SessionLocal", async_sessionmaker(test_engine, expire_on_commit=False))
    service = OrchestrationService(gemini=None, solana=None, claude_engine=None)

    def _make(user_id: str):
        captured = {"actions": []}
        return service._make_stellar_executor(None, captured, user_id=user_id), captured

    return _make


async def _user(db, name: str, interests: list[str]) -> str:
    """Cria o usuário e devolve o `user_id` que o `/chat` passaria ao executor."""
    db.add(User(twitter_user_id=f"privy_{name}", twitter_handle=name, interest_profile=json.dumps(interests)))
    await db.commit()
    return f"privy_{name}"


async def test_list_campaigns_vem_ranqueada_pelo_perfil_do_usuario(db_session, executor_for):
    user_id = await _user(db_session, "gabi", ["trader"])
    executor, captured = executor_for(user_id)

    campaigns = json.loads(await executor("list_campaigns", {}))["campaigns"]

    assert campaigns[0]["campaign_type"] == "trading"
    assert campaigns[0]["matched_interests"] == ["trader"]
    assert captured["actions"] == ["list_campaigns"]


async def test_list_campaigns_anonimo_continua_funcionando(db_session, executor_for):
    executor, _ = executor_for("web_anonymous")
    campaigns = json.loads(await executor("list_campaigns", {}))["campaigns"]
    assert campaigns and all(c["match_score"] == 0 for c in campaigns)


async def test_get_my_activity_devolve_o_resumo_de_quem_esta_logado(db_session, executor_for):
    user_id = await _user(db_session, "duda", ["games"])
    executor, captured = executor_for(user_id)

    summary = json.loads(await executor("get_my_activity", {}))

    assert summary["campaigns_joined"]["total"] == 0
    assert "member_since" in summary
    assert captured["actions"] == ["get_my_activity"]


async def test_get_my_activity_recusa_anonimo(db_session, executor_for):
    executor, captured = executor_for("web_anonymous")
    result = json.loads(await executor("get_my_activity", {}))
    assert result["error"] == "no_session"
    assert captured["actions"] == []


# ---------------------------------------------------------------------------
# menu_action — caminho determinístico dos cards
# ---------------------------------------------------------------------------

@pytest.fixture
def service_with(db_session, test_engine, monkeypatch):
    monkeypatch.setattr(database_module, "SessionLocal", async_sessionmaker(test_engine, expire_on_commit=False))
    return lambda engine=None: OrchestrationService(gemini=None, solana=None, claude_engine=engine)


class _Engine:
    """Engine falso: devolve `text` ou levanta `error`, e guarda a chamada."""

    def __init__(self, text: str = "", error: Exception | None = None):
        self.text, self.error, self.calls = text, error, []

    async def run(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return {"text": self.text}


async def test_menu_browse_sem_modelo_responde_com_o_ranking(db_session, service_with):
    user_id = await _user(db_session, "lia", ["trader"])
    result = await service_with().execute("Browse", user_id, menu_action="browse_campaigns")

    first = result["execution"]["data"]["campaigns"][0]
    assert first["campaign_type"] == "trading"
    assert result["intent"].action == "browse_campaigns"
    assert result["reply_text"].splitlines()[1].startswith(f"1. {first['name']}")
    assert "matches: trader" in result["reply_text"]


async def test_menu_metrics_com_modelo_falhando_usa_o_fallback(db_session, service_with):
    user_id = await _user(db_session, "rui", ["games"])
    engine = _Engine(error=RuntimeError("credit balance is too low"))
    result = await service_with(engine).execute("My metrics", user_id, menu_action="my_metrics")

    assert len(engine.calls) == 1
    assert result["reply_text"].startswith("You haven't done much here yet")
    assert result["execution"]["data"]["campaigns_joined"]["total"] == 0


async def test_menu_com_modelo_ele_so_redige_com_os_dados_prontos(db_session, service_with):
    user_id = await _user(db_session, "ivo", ["trader"])
    engine = _Engine(text="Swap Challenge é a sua cara!")
    result = await service_with(engine).execute("Browse", user_id, menu_action="browse_campaigns")

    assert result["reply_text"] == "Swap Challenge é a sua cara!"
    call = engine.calls[0]
    assert call["tools"] is None
    assert '"matched_interests": ["trader"]' in call["message"]


async def test_menu_metrics_anonimo_pede_login_sem_chamar_o_modelo(db_session, service_with):
    engine = _Engine(text="não deveria aparecer")
    result = await service_with(engine).execute("My metrics", "web_anonymous", menu_action="my_metrics")
    assert result["reply_text"] == "Log in to see your metrics."
    assert engine.calls == []


async def test_menu_action_desconhecida_segue_o_caminho_normal(db_session, service_with):
    engine = _Engine(text="resposta do agente")
    service = service_with(engine)

    async def _agentic(*_, **__):
        return {"intent": None, "reply_text": "caminho agêntico", "execution": {}}

    service._execute_agentic = _agentic
    result = await service.execute("oi", "web_anonymous", menu_action="hack_the_planet")
    assert result["reply_text"] == "caminho agêntico"


# ---------------------------------------------------------------------------
# fallback_reply — texto sem modelo
# ---------------------------------------------------------------------------

def _c(id, name, kind, reward, matched=(), joined=False):
    return {"id": id, "name": name, "campaign_type": kind, "reward_per_participant": reward,
            "reward_token": "USDC", "matched_interests": list(matched), "already_joined": joined}


@pytest.mark.parametrize("campaigns, expected", [
    ([], "There are no active campaigns right now. I'll let you know when one opens!"),
    ([_c(1, "A", "social", 1, joined=True)], "You're already in every active campaign. I'll let you know when a new one opens!"),
])
def test_fallback_browse_sem_o_que_recomendar(campaigns, expected):
    assert fallback_reply("browse_campaigns", {"campaigns": campaigns}) == expected


def test_fallback_browse_pula_ja_inscritas_e_limita_a_tres():
    campaigns = [_c(1, "Ja", "trading", 9, ["trader"], joined=True)] + [
        _c(i, f"C{i}", "social", 1) for i in range(2, 7)
    ]
    lines = fallback_reply("browse_campaigns", {"campaigns": campaigns}).splitlines()
    assert lines[0] == "Here are the best campaigns open right now:"
    assert [line.split(" — ")[0] for line in lines[1:4]] == ["1. C2", "2. C3", "3. C4"]
    assert lines[-1] == "Want to join one?"


def test_fallback_metrics_mostra_so_o_que_tem_numero():
    reply = fallback_reply("my_metrics", {
        "campaigns_created": {"total": 1, "paid_out": {"USDC": 2.5}},
        "campaigns_joined": {"total": 2, "paid": 1, "earned": {"USDC": 0.5}},
        "agent_payments_received": {"count": 0, "usdc": 0},
        "arc_transfers": {"sent": 0, "usdc_sent": 0},
        "cctp_received": {"count": 0, "usdc": 0},
        "clipper": {"media_uploaded": 0, "clips_ready": 0},
        "chat_sessions": 4,
    })
    assert reply.splitlines() == [
        "Here's everything you've done on Xiaolee so far:",
        "• Campaigns created: 1 (paid out 2.5 USDC)",
        "• Campaigns joined: 2 (1 paid), earned 0.5 USDC",
        "• Chats with me: 4",
    ]
