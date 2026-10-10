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


# --- task-verification ---------------------------------------------------------------------------
TASK_URL = "/internal/x402/task-verification"
TASK = {
    "platform": "x", "post_url": "https://x.com/fontz/status/123", "handle": "@fontz",
    "post_text": "Testando o #XiaoLee com @arc_network, Gateway nanopayments na veia",
    "required_hashtags": ["XiaoLee"], "required_mentions": ["arc_network"], "required_keywords": ["nanopayments"],
}


@pytest.mark.asyncio
async def test_task_verification_approved_releases_payout(db):
    h = {**PAID, "x-internal-secret": "s3cret"}
    r = client.post(TASK_URL, json=TASK, headers=h)
    assert r.status_code == 200
    out = r.json()["result"]
    assert out["verdict"] == "approved" and out["payout_recommendation"] == "release" and out["score"] == 100
    assert out["evidence_source"] == "submitted_text"
    assert r.json()["receipt"]["receipt_pqc"]


@pytest.mark.asyncio
async def test_task_verification_rejects_missing_criteria_and_wrong_domain(db):
    h = {**PAID, "x-internal-secret": "s3cret"}
    r = client.post(TASK_URL, json={**TASK, "post_text": "sem nada", "post_url": "https://evil.example/fontz"}, headers=h)
    out = r.json()["result"]
    failed = {c["id"] for c in out["checks"] if not c["passed"]}
    assert out["verdict"] == "rejected" and out["payout_recommendation"] == "hold"
    assert {"url_platform", "hashtag:xiaolee", "mention:arc_network", "keyword:nanopayments"} <= failed


@pytest.mark.asyncio
async def test_task_verification_hashtag_needs_word_boundary(db):
    h = {**PAID, "x-internal-secret": "s3cret"}
    r = client.post(TASK_URL, json={**TASK, "post_text": "#XiaoLeeFake @arc_networks nanopayments @fontz"}, headers=h)
    failed = {c["id"] for c in r.json()["result"]["checks"] if not c["passed"]}
    assert {"hashtag:xiaolee", "mention:arc_network"} <= failed


@pytest.mark.asyncio
async def test_task_verification_requires_secret_and_valid_platform(db):
    assert client.post(TASK_URL, json=TASK).status_code == 403
    h = {**PAID, "x-internal-secret": "s3cret"}
    assert client.post(TASK_URL, json={**TASK, "platform": "myspace"}, headers=h).status_code == 422


# ── LLM opcional (X402_LLM_*) ────────────────────────────────────────────────
from server import x402_llm

_OK = ('{"summary": "Post 3 clips a week and measure retention.", "actions": ["a", "b", "c"]}', 1000, 400)
_H = {**PAID, "x-internal-secret": "s3cret"}


@pytest.fixture
def llm(monkeypatch):
    monkeypatch.setenv("X402_LLM_ENABLED", "true")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.delenv("X402_LLM_DAILY_CAP_USD", raising=False)
    x402_llm.budget.day, x402_llm.budget.spent = "", 0.0
    calls = []

    async def fake(service, payload, baseline):
        calls.append(service)
        return _OK

    monkeypatch.setattr(x402_llm, "_call", fake)
    return calls


def test_llm_off_by_default_keeps_heuristic(db, monkeypatch):
    monkeypatch.delenv("X402_LLM_ENABLED", raising=False)
    r = client.post(URL, json=BODY, headers=_H).json()
    assert "ai_insights" not in r["result"] and "growth_readiness_score" in r["result"]


def test_llm_adds_insights_and_charges_real_cost(db, llm):
    r = client.post(URL, json=BODY, headers=_H).json()
    assert r["result"]["ai_insights"]["source"] == "llm" and len(r["result"]["ai_insights"]["actions"]) == 3
    assert "growth_readiness_score" in r["result"]  # base heurística preservada
    # 1000*0.10/1M + 400*0.50/1M = 0.0003, bem abaixo do teto por chamada
    assert x402_llm.budget.spent == pytest.approx(0.0003)


def test_llm_daily_cap_falls_back_without_calling(db, llm, monkeypatch):
    monkeypatch.setenv("X402_LLM_DAILY_CAP_USD", "0.005")  # < teto por chamada (0.01): nunca reserva
    r = client.post(URL, json=BODY, headers=_H)
    assert r.status_code == 200 and "ai_insights" not in r.json()["result"] and llm == []


def test_llm_failure_is_fail_open_and_refunds_reservation(db, llm, monkeypatch):
    async def boom(*a):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(x402_llm, "_call", boom)
    r = client.post(URL, json=BODY, headers=_H)
    assert r.status_code == 200 and "ai_insights" not in r.json()["result"]
    assert x402_llm.budget.spent == 0.0


def test_llm_invalid_json_falls_back(db, llm, monkeypatch):
    async def bad(*a):
        return ("not json", 100, 10)

    monkeypatch.setattr(x402_llm, "_call", bad)
    r = client.post("/internal/x402/campaign-plan", json={"goal": "launch", "budget_usdc": 100}, headers=_H)
    assert r.status_code == 200 and "ai_insights" not in r.json()["result"]


def test_task_verification_never_uses_llm(db, llm):
    body = {"platform": "x", "post_url": "https://x.com/a/status/1", "post_text": "hi @a", "handle": "a"}
    r = client.post("/internal/x402/task-verification", json=body, headers=_H)
    assert r.status_code == 200 and "ai_insights" not in r.json()["result"] and llm == []
