"""
test_x402_internal.py — rota interna atrás do x402-gateway (Circle Gateway).

Trava: sem segredo interno a rota é fechada (anti-bypass do pagamento); com ele, entrega
resultado + recibo PQC com pagador/valor/tx; entrada ruim é recusada.
"""
from __future__ import annotations

import importlib
import os

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.database import get_db_session

app_module = importlib.import_module("server.app")
client = TestClient(app_module.app)

URL = "/internal/x402/profile-analysis"
BODY = {"handle": "@fontz", "niche": "defi", "platforms": ["tiktok", "x"], "followers": 12000, "posts_per_week": 2}
PAID = {"x-payer": "0xabc", "x-payment-network": "eip155:5042002", "x-payment-amount": "50000", "x-payment-tx": "settle-1"}


@pytest_asyncio.fixture
async def db(db_session):
    async def _override():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = _override
    yield db_session
    app_module.app.dependency_overrides.pop(get_db_session, None)


@pytest.fixture(autouse=True)
def secret(monkeypatch):
    monkeypatch.setenv("X402_INTERNAL_SECRET", "s3cret")


def test_without_secret_is_forbidden(db):
    assert client.post(URL, json=BODY, headers=PAID).status_code == 403
    assert client.post(URL, json=BODY, headers={**PAID, "x-internal-secret": "wrong"}).status_code == 403


def test_fail_closed_when_secret_not_configured(db, monkeypatch):
    monkeypatch.delenv("X402_INTERNAL_SECRET")
    assert client.post(URL, json=BODY, headers={**PAID, "x-internal-secret": ""}).status_code == 403


def test_paid_call_returns_result_and_receipt(db):
    r = client.post(URL, json=BODY, headers={**PAID, "x-internal-secret": "s3cret"})
    assert r.status_code == 200
    d = r.json()
    assert d["result"]["handle"] == "@fontz"
    assert {f["id"] for f in d["result"]["recommended_formats"]} >= {"short_video", "live_recap", "newsletter"}
    rc = d["receipt"]
    assert rc["payer"] == "0xabc" and rc["amount_usdc"] == 0.05 and rc["payment_tx"] == "settle-1"
    assert rc["receipt_pqc"]


def test_same_tx_twice_does_not_crash(db):
    h = {**PAID, "x-internal-secret": "s3cret"}
    assert client.post(URL, json=BODY, headers=h).status_code == 200
    assert client.post(URL, json=BODY, headers=h).status_code == 200


def test_bad_input_rejected(db):
    r = client.post(URL, json={**BODY, "followers": -1}, headers={**PAID, "x-internal-secret": "s3cret"})
    assert r.status_code == 422


PLAN_URL = "/internal/x402/campaign-plan"
PLAN = {"goal": "lançar token X", "budget_usdc": 1000, "platforms": ["tiktok", "x"], "duration_days": 7}


def test_campaign_plan_requires_secret(db):
    assert client.post(PLAN_URL, json=PLAN, headers=PAID).status_code == 403


def test_campaign_plan_splits_budget_and_returns_receipt(db):
    r = client.post(PLAN_URL, json=PLAN, headers={**PAID, "x-internal-secret": "s3cret", "x-payment-tx": "settle-plan"})
    assert r.status_code == 200
    d = r.json()
    split = d["result"]["budget_split"]
    assert split["rewards_usdc"] + split["ops_reserve_usdc"] == pytest.approx(1000)
    assert sum(p["reward_budget_usdc"] for p in d["result"]["platforms"]) == pytest.approx(split["rewards_usdc"])
    assert d["receipt"]["payment_tx"] == "settle-plan" and d["receipt"]["receipt_pqc"]


def test_campaign_plan_rejects_bad_input(db):
    h = {**PAID, "x-internal-secret": "s3cret"}
    assert client.post(PLAN_URL, json={**PLAN, "budget_usdc": 0}, headers=h).status_code == 422
    assert client.post(PLAN_URL, json={**PLAN, "platforms": []}, headers=h).status_code == 422


@pytest.mark.asyncio
async def test_same_payment_tx_twice_is_idempotent(db):
    """Retry do gateway reenvia o mesmo tx: ambos respondem 200 e a auditoria registra uma vez só."""
    from sqlalchemy import func, select
    from database.models import UsedPayment

    h = {**PAID, "x-internal-secret": "s3cret", "x-payment-tx": "settle-dup"}
    assert client.post(URL, json=BODY, headers=h).status_code == 200
    assert client.post(URL, json=BODY, headers=h).status_code == 200
    n = (await db.execute(select(func.count()).select_from(UsedPayment).where(UsedPayment.tx_hash.like("%settle-dup")))).scalar()
    assert n == 1
