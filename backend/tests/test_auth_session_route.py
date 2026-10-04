"""
test_auth_session_route.py — `POST /auth/session`, o login social verificado.

Contraparte de rota do `test_token_auth.py`: lá o foco é a validação do token,
aqui é o que a rota faz com a identidade já verificada — e, principalmente, o
que ela se recusa a aceitar do corpo da request.

O bug que motivou a rota: `/auth/google/login` deriva a identidade de um
`address` que o cliente manda. Aqui o corpo carrega **só o token**; qualquer
campo extra é ignorado por construção.
"""
from __future__ import annotations

import importlib
import os
import time
from typing import Any

import jwt
import pytest
import pytest_asyncio
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import select

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.database import get_db_session
from database.models import User, WebSession
from server import token_auth

app_module = importlib.import_module("server.app")
client = TestClient(app_module.app)

FIREBASE_PROJECT = "xiaolee-mobile"
PRIVY_APP_ID = "privy-test-app-id"
_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_ATTACKER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest_asyncio.fixture
async def db(db_session):
    """Banco isolado em memória para a app real — não polui backend/xiao_lee.db."""

    async def _override():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = _override
    yield db_session
    app_module.app.dependency_overrides.pop(get_db_session, None)


@pytest.fixture(autouse=True)
def _provider_config(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", FIREBASE_PROJECT)
    monkeypatch.setenv("PRIVY_APP_ID", PRIVY_APP_ID)
    monkeypatch.setattr(token_auth, "_signing_key_for", lambda token, jwks_url: _KEY.public_key())
    token_auth.reset_config_cache()
    yield
    token_auth.reset_config_cache()


def _token(key=_KEY, **overrides: Any) -> str:
    now = int(time.time())
    claims = {
        "iss": f"https://securetoken.google.com/{FIREBASE_PROJECT}",
        "aud": FIREBASE_PROJECT,
        "sub": "firebase-uid-abc",
        "iat": now,
        "exp": now + 3600,
        "email": "gustavo@example.com",
        "name": "Gustavo",
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm="RS256")


def _privy_token(key=_KEY, **overrides: Any) -> str:
    now = int(time.time())
    claims = {
        "iss": "privy.io",
        "aud": PRIVY_APP_ID,
        "sub": "did:privy:abc123",
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm="RS256")


class TestHappyPath:
    @pytest.mark.asyncio
    async def test_valid_token_issues_session(self, db):
        resp = client.post("/auth/session", json={"provider": "firebase", "id_token": _token()})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["session_id"]
        assert body["twitter_user_id"] == "firebase_firebase-uid-abc"
        assert body["username"] == "Gustavo"

    @pytest.mark.asyncio
    async def test_valid_privy_token_issues_session(self, db):
        resp = client.post("/auth/session", json={"provider": "privy", "id_token": _privy_token()})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["session_id"].startswith("privy_session_")
        assert body["twitter_user_id"] == "privy_did:privy:abc123"
        assert body["username"] == "privy_did:privy:abc123"
        assert body["address"] == ""

    @pytest.mark.asyncio
    async def test_session_is_persisted(self, db):
        resp = client.post("/auth/session", json={"provider": "firebase", "id_token": _token()})
        session_id = resp.json()["session_id"]

        stored = (
            await db.execute(select(WebSession).where(WebSession.session_id == session_id))
        ).scalars().first()
        assert stored is not None
        assert stored.expires_at > __import__("datetime").datetime.utcnow()

    @pytest.mark.asyncio
    async def test_second_login_reuses_user_and_rotates_session(self, db):
        first = client.post("/auth/session", json={"provider": "firebase", "id_token": _token()}).json()
        second = client.post("/auth/session", json={"provider": "firebase", "id_token": _token()}).json()

        assert first["twitter_user_id"] == second["twitter_user_id"]
        assert first["session_id"] != second["session_id"]

        users = (
            await db.execute(select(User).where(User.twitter_user_id == "firebase_firebase-uid-abc"))
        ).scalars().all()
        assert len(users) == 1


class TestRejections:
    @pytest.mark.asyncio
    async def test_forged_token_is_401(self, db):
        resp = client.post(
            "/auth/session", json={"provider": "firebase", "id_token": _token(key=_ATTACKER_KEY)}
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_forged_token_creates_no_user_or_session(self, db):
        client.post("/auth/session", json={"provider": "firebase", "id_token": _token(key=_ATTACKER_KEY)})
        assert (await db.execute(select(User))).scalars().all() == []
        assert (await db.execute(select(WebSession))).scalars().all() == []

    @pytest.mark.asyncio
    async def test_missing_token_is_400(self, db):
        resp = client.post("/auth/session", json={"provider": "firebase"})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_unknown_provider_is_400(self, db):
        resp = client.post("/auth/session", json={"provider": "myspace", "id_token": _token()})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_expired_token_is_401(self, db):
        now = int(time.time())
        resp = client.post(
            "/auth/session",
            json={"provider": "firebase", "id_token": _token(iat=now - 7200, exp=now - 3600)},
        )
        assert resp.status_code == 401


class TestBodyIsNotIdentity:
    """O ponto da rota: só o token decide quem é o usuário."""

    @pytest.mark.asyncio
    async def test_address_in_body_is_ignored(self, db):
        """Regressão direta do bug do /auth/google/login."""
        resp = client.post(
            "/auth/session",
            json={
                "provider": "firebase",
                "id_token": _token(),
                "address": "EnderecoDoAtacante1111111111111111111111111",
                "email": "atacante@example.com",
                "name": "Atacante",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["twitter_user_id"] == "firebase_firebase-uid-abc"
        assert body["username"] == "Gustavo"
        assert "Atacante" not in resp.text
        assert "EnderecoDoAtacante1111111111111111111111111" not in resp.text

    @pytest.mark.asyncio
    async def test_cannot_impersonate_existing_user_via_body(self, db):
        """Sessão emitida é sempre do sub do token, nunca do twitter_user_id pedido."""
        db.add(User(twitter_user_id="vitima_123", twitter_handle="vitima"))
        await db.commit()

        resp = client.post(
            "/auth/session",
            json={
                "provider": "firebase",
                "id_token": _token(),
                "twitter_user_id": "vitima_123",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["twitter_user_id"] == "firebase_firebase-uid-abc"
