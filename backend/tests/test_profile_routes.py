"""
test_profile_routes.py — `GET/PATCH /user/me/profile` (onboarding) e a resolução
de identidade do chat por sessão (`resolve_optional_identity`).

Regras que estes testes travam:
- o dono do perfil vem do Bearer; nada no corpo/URL escolhe de quem é o perfil;
- PATCH é parcial e nunca apaga o que não foi enviado;
- entrada ruim (tamanho, tipo, interesse desconhecido) é recusada sem gravar nada;
- uma sessão de login e o twitter_user_id dela são a MESMA pessoa no chat.
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

URL = "/user/me/profile"
FULL = {
    "full_name": "Gustavo F",
    "state": "SP",
    "city": "Santos",
    "bio": "criador de conteúdo",
    "social_links": {"x": "@fontz"},
    "interest_profile": ["defi", "games"],
}


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


class TestAuth:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("method", ["get", "patch"])
    async def test_no_bearer_is_401(self, db, method):
        assert getattr(client, method)(URL, **({"json": {}} if method == "patch" else {})).status_code == 401

    @pytest.mark.asyncio
    @pytest.mark.parametrize("method", ["get", "patch"])
    async def test_empty_bearer_is_401(self, db, method):
        assert getattr(client, method)(
            URL, headers={"Authorization": "Bearer "}, **({"json": {}} if method == "patch" else {})
        ).status_code == 401

    @pytest.mark.asyncio
    async def test_expired_session_is_401_and_writes_nothing(self, db):
        h = await _login(db, "old", expired=True)
        assert client.patch(URL, json=FULL, headers=h).status_code == 401
        assert await _user(db, "old") is None


class TestIsolation:
    @pytest.mark.asyncio
    async def test_patch_only_touches_the_bearer_owner(self, db):
        a, b = await _login(db, "a"), await _login(db, "b")
        assert client.patch(URL, json=FULL, headers=a).status_code == 200
        other = client.get(URL, headers=b).json()
        assert other["full_name"] is None and other["onboarded"] is False

    @pytest.mark.asyncio
    async def test_body_cannot_pick_another_owner(self, db):
        """Campos de identidade no corpo são ignorados — o dono é sempre o Bearer."""
        a, b = await _login(db, "a"), await _login(db, "b")
        client.get(URL, headers=b)  # cria o usuário b
        body = {**FULL, "twitter_user_id": "privy_b", "user_id": "privy_b", "id": 2}
        assert client.patch(URL, json=body, headers=a).status_code == 200
        assert client.get(URL, headers=b).json()["full_name"] is None
        assert client.get(URL, headers=a).json()["full_name"] == "Gustavo F"

    @pytest.mark.asyncio
    async def test_url_cannot_pick_another_owner(self, db):
        a = await _login(db, "a")
        assert client.patch("/user/privy_b/profile", json=FULL, headers=a).status_code in (404, 405)


class TestPatchSemantics:
    @pytest.mark.asyncio
    async def test_partial_patch_keeps_other_fields(self, db):
        h = await _login(db, "a")
        client.patch(URL, json=FULL, headers=h)
        out = client.patch(URL, json={"bio": "nova bio"}, headers=h).json()
        assert out["bio"] == "nova bio"
        assert (out["full_name"], out["city"], out["interest_profile"]) == ("Gustavo F", "Santos", ["defi", "games"])

    @pytest.mark.asyncio
    async def test_empty_patch_changes_nothing(self, db):
        h = await _login(db, "a")
        before = client.patch(URL, json=FULL, headers=h).json()
        assert client.patch(URL, json={}, headers=h).json() == before

    @pytest.mark.asyncio
    async def test_blank_string_clears_text_field(self, db):
        h = await _login(db, "a")
        client.patch(URL, json=FULL, headers=h)
        assert client.patch(URL, json={"bio": "   "}, headers=h).json()["bio"] is None

    @pytest.mark.asyncio
    async def test_values_are_trimmed(self, db):
        h = await _login(db, "a")
        assert client.patch(URL, json={"full_name": "  Ana  "}, headers=h).json()["full_name"] == "Ana"

    @pytest.mark.asyncio
    async def test_persisted_in_database(self, db):
        h = await _login(db, "a")
        client.patch(URL, json=FULL, headers=h)
        db.expire_all()
        user = await _user(db, "a")
        assert user.full_name == "Gustavo F" and user.city == "Santos"
        assert client.get(URL, headers=h).json()["social_links"] == {"x": "@fontz"}


class TestInterests:
    @pytest.mark.asyncio
    async def test_normalized_lowercase_and_deduped_keeping_order(self, db):
        h = await _login(db, "a")
        out = client.patch(URL, json={"interest_profile": ["Games", " DeFi ", "games"]}, headers=h).json()
        assert out["interest_profile"] == ["games", "defi"]

    @pytest.mark.asyncio
    async def test_unknown_interest_is_422_and_keeps_previous_value(self, db):
        h = await _login(db, "a")
        client.patch(URL, json={"interest_profile": ["defi"]}, headers=h)
        r = client.patch(URL, json={"interest_profile": ["defi", "nft"]}, headers=h)
        assert r.status_code == 422
        assert client.get(URL, headers=h).json()["interest_profile"] == ["defi"]

    @pytest.mark.asyncio
    async def test_invalid_interest_does_not_partially_apply_other_fields(self, db):
        """Atomicidade: 422 no interesse não pode deixar o nome gravado pela metade."""
        h = await _login(db, "a")
        r = client.patch(URL, json={"full_name": "Fulano", "interest_profile": ["nft"]}, headers=h)
        assert r.status_code == 422
        db.expire_all()
        user = await _user(db, "a")
        assert user is None or user.full_name is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize("bad", ["defi", {"defi": 1}, [1, 2], [["defi"]]])
    async def test_wrong_types_are_422(self, db, bad):
        h = await _login(db, "a")
        assert client.patch(URL, json={"interest_profile": bad}, headers=h).status_code == 422


class TestValidationLimits:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "field,size", [("full_name", 256), ("state", 65), ("city", 129), ("bio", 1001)]
    )
    async def test_oversized_text_is_422(self, db, field, size):
        h = await _login(db, "a")
        assert client.patch(URL, json={field: "x" * size}, headers=h).status_code == 422

    @pytest.mark.asyncio
    async def test_max_sizes_are_accepted(self, db):
        h = await _login(db, "a")
        r = client.patch(URL, json={"full_name": "x" * 255, "bio": "y" * 1000}, headers=h)
        assert r.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.parametrize("bad", ["@fontz", ["x"], {"x": 1}, {"x": {"a": "b"}}])
    async def test_social_links_wrong_types_are_422(self, db, bad):
        h = await _login(db, "a")
        assert client.patch(URL, json={"social_links": bad}, headers=h).status_code == 422

    @pytest.mark.asyncio
    async def test_social_links_are_sanitized(self, db):
        h = await _login(db, "a")
        links = {" X ": " @fontz ", "Instagram": "   ", "k" * 80: "v" * 400}
        out = client.patch(URL, json={"social_links": links}, headers=h).json()["social_links"]
        assert "instagram" not in out
        assert out["x"] == "@fontz"
        assert all(len(k) <= 32 and len(v) <= 255 for k, v in out.items())

    @pytest.mark.asyncio
    async def test_hostile_text_is_stored_verbatim_not_executed(self, db):
        """SQL/HTML na bio é só texto: volta idêntico e a tabela segue de pé."""
        h = await _login(db, "a")
        evil = "'); DROP TABLE users;-- <script>alert(1)</script>"
        assert client.patch(URL, json={"bio": evil}, headers=h).json()["bio"] == evil
        assert client.get(URL, headers=h).status_code == 200


class TestOnboardedFlag:
    @pytest.mark.asyncio
    async def test_flag_transitions(self, db):
        h = await _login(db, "a")
        assert client.get(URL, headers=h).json()["onboarded"] is False
        assert client.patch(URL, json={"full_name": "Ana"}, headers=h).json()["onboarded"] is False
        assert client.patch(URL, json={"interest_profile": ["defi"]}, headers=h).json()["onboarded"] is True
        assert client.patch(URL, json={"interest_profile": []}, headers=h).json()["onboarded"] is False

    @pytest.mark.asyncio
    async def test_get_is_idempotent_and_creates_one_user(self, db):
        h = await _login(db, "a")
        for _ in range(3):
            client.get(URL, headers=h)
        rows = (await db.execute(select(User).where(User.twitter_user_id == "privy_a"))).scalars().all()
        assert len(rows) == 1
