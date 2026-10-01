"""
test_chat_identity.py — o chat resolve o Bearer pela sessão (`resolve_optional_identity`).

Regra que estes testes travam: uma sessão de login e o twitter_user_id dela são
a MESMA pessoa no chat — antes o histórico ficava preso ao id da sessão.
"""
from __future__ import annotations

import importlib
import os
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.database import get_db_session
from database.models import User, WebSession

app_module = importlib.import_module("server.app")
client = TestClient(app_module.app)


@pytest_asyncio.fixture
async def db(db_session):
    async def _override():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = _override
    yield db_session
    app_module.app.dependency_overrides.pop(get_db_session, None)


async def _login(db, name: str, *, expired: bool = False) -> dict[str, str]:
    """Cria WebSession para `privy_<name>` e devolve o header Bearer."""
    now = datetime.utcnow()
    db.add(
        WebSession(
            session_id=f"privy_session_{name}",
            twitter_user_id=f"privy_{name}",
            expires_at=now - timedelta(days=1) if expired else now + timedelta(days=30),
        )
    )
    await db.commit()
    return {"Authorization": f"Bearer privy_session_{name}"}


async def _user(db, name: str) -> User | None:
    return (await db.execute(select(User).where(User.twitter_user_id == f"privy_{name}"))).scalars().first()


class TestChatIdentityFromSession:
    """`/v1/chat/sessions` — a sessão de login e o twitter_user_id são a mesma pessoa."""

    @pytest.mark.asyncio
    async def test_session_bearer_and_user_id_bearer_share_history(self, db):
        h = await _login(db, "a")
        created = client.post("/v1/chat/sessions", headers=h).json()
        by_user_id = client.get("/v1/chat/sessions", headers={"Authorization": "Bearer privy_a"}).json()
        by_session = client.get("/v1/chat/sessions", headers=h).json()
        assert [s["id"] for s in by_user_id] == [s["id"] for s in by_session] == [created["id"]]
        users = (await db.execute(select(User))).scalars().all()
        assert [u.twitter_user_id for u in users] == ["privy_a"]  # sem usuário-fantasma "privy_session_a"

    @pytest.mark.asyncio
    async def test_other_user_does_not_see_the_chat(self, db):
        a, b = await _login(db, "a"), await _login(db, "b")
        sid = client.post("/v1/chat/sessions", headers=a).json()["id"]
        assert client.get("/v1/chat/sessions", headers=b).json() == []
        assert client.get(f"/v1/chat/sessions/{sid}/messages", headers=b).status_code == 404

    @pytest.mark.asyncio
    async def test_expired_session_is_401(self, db):
        h = await _login(db, "old", expired=True)
        assert client.get("/v1/chat/sessions", headers=h).status_code == 401

    @pytest.mark.asyncio
    async def test_guest_without_bearer_still_works(self, db):
        r = client.get("/v1/chat/sessions")
        assert r.status_code == 200 and r.json() == []
