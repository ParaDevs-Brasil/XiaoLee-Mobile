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
