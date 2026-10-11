"""
Chat da web ganha sessões — thread própria por conversa em vez de um log
único infinito por usuário. Cobre o caminho feliz: criar sessão, listar,
mandar mensagem via /chat com session_id, e reler o histórico daquela sessão.
"""
from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock

app_module = importlib.import_module("server.app")
from server.schemas import IntentResponse, OrchestrationResponse


AUTH = {"Authorization": "Bearer chat-sessions-test-user"}


@pytest.fixture(autouse=True)
def _client(isolated_app_db):
    app_module.request_hits.clear()
    global client
    client = TestClient(app_module.app)


def _mock_process_inbound(reply_text: str):
    async def _fake(*args, **kwargs):
        # chat_sessions_routes/chat_compat call _process_inbound with session_id kwarg —
        # mirror the DMLog writes it would normally do, scoped to this test's session.
        from database.database import get_db_session
        from database.repository import DatabaseRepository

        db_gen = app_module.app.dependency_overrides[get_db_session]()
        db = await db_gen.__anext__()
        repo = DatabaseRepository(db)
        user = await repo.get_or_create_user(kwargs.get("platform", "web"), kwargs["user_id"])
        session_id = kwargs.get("session_id")
        await repo.log_dm(user.id, "web", kwargs["text"], message_type="user", session_id=session_id)
        await repo.log_dm(user.id, "web", reply_text, message_type="bot", session_id=session_id)
        await db.commit()
        return OrchestrationResponse(
            platform="web",
            user_id=kwargs["user_id"],
            intent=IntentResponse(action="help", confidence=1.0, entities={}),
            reply_text=reply_text,
            execution={"status": "ok"},
        )

    return _fake


def test_create_list_and_message_roundtrip(monkeypatch):
    monkeypatch.setattr(app_module, "_process_inbound", _mock_process_inbound("oi de volta"))

    created = client.post("/v1/chat/sessions", headers=AUTH)
    assert created.status_code == 200
    session_id = created.json()["id"]
    assert created.json()["title"] == "New chat"

    listed = client.get("/v1/chat/sessions", headers=AUTH)
    assert listed.status_code == 200
    assert any(s["id"] == session_id for s in listed.json())

    sent = client.post(
        "/chat",
        json={"message": "oi xiaolee", "session_id": session_id},
        headers=AUTH,
    )
    assert sent.status_code == 200
    assert sent.json()["session_id"] == session_id

    messages = client.get(f"/v1/chat/sessions/{session_id}/messages", headers=AUTH)
    assert messages.status_code == 200
    body = messages.json()
    contents = [m["content"] for m in body]
    assert contents == ["oi xiaolee", "oi de volta"]
    # Timestamp precisa vir com offset (UTC) — sem isso `new Date(iso)` no
    # cliente interpreta como hora local e "há quanto tempo" some para "now".
    assert body[0]["time"].endswith("+00:00")

    # A sessão nasceu vazia (título padrão "New chat") pelo POST acima — a
    # primeira mensagem precisa titulá-la, senão toda sessão aberta pelo botão
    # "New chat" fica "New chat" para sempre.
    listed_after = client.get("/v1/chat/sessions", headers=AUTH)
    renamed = next(s for s in listed_after.json() if s["id"] == session_id)
    assert renamed["title"] == "oi xiaolee"
    assert renamed["updated_at"].endswith("+00:00")


def test_wallet_prefix_does_not_leak_into_title(monkeypatch):
    monkeypatch.setattr(app_module, "_process_inbound", _mock_process_inbound("ok"))

    sent = client.post(
        "/chat",
        json={"message": "qual meu saldo?", "wallet_address": "0x1234567890abcdef"},
        headers=AUTH,
    )
    assert sent.status_code == 200
    session_id = sent.json()["session_id"]

    listed = client.get("/v1/chat/sessions", headers=AUTH)
    title = next(s["title"] for s in listed.json() if s["id"] == session_id)
    assert title == "qual meu saldo?"


def test_chat_without_session_id_autocreates_one(monkeypatch):
    monkeypatch.setattr(app_module, "_process_inbound", _mock_process_inbound("ok"))

    sent = client.post("/chat", json={"message": "primeira mensagem sem sessao"}, headers=AUTH)
    assert sent.status_code == 200
    session_id = sent.json()["session_id"]
    assert session_id is not None

    listed = client.get("/v1/chat/sessions", headers=AUTH)
    titles = [s["title"] for s in listed.json()]
    assert "primeira mensagem sem sessao" in titles


def test_messages_404_for_other_users_session():
    created = client.post("/v1/chat/sessions", headers=AUTH)
    session_id = created.json()["id"]

    resp = client.get(
        f"/v1/chat/sessions/{session_id}/messages",
        headers={"Authorization": "Bearer someone-else"},
    )
    assert resp.status_code == 404


@pytest.mark.parametrize("sent_action, expected", [
    ("my_metrics", "my_metrics"),   # card do menu → chega ao orchestrator
    (None, None),                   # cliente antigo, sem o campo
    (["my_metrics"], None),         # tipo errado é ignorado, não 500
])
def test_chat_forwards_menu_action_to_the_orchestrator(monkeypatch, sent_action, expected):
    execute = AsyncMock(return_value={
        "intent": IntentResponse(action="my_metrics", confidence=1.0, entities={}),
        "reply_text": "ok",
        "execution": {"status": "info"},
    })
    monkeypatch.setattr(app_module.orchestrator, "execute", execute)

    payload = {"message": "My metrics"}
    if sent_action is not None:
        payload["menu_action"] = sent_action
    sent = client.post("/chat", json=payload, headers=AUTH)

    assert sent.status_code == 200
    assert execute.await_args.kwargs["menu_action"] == expected
