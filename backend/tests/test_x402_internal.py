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

URL = "/internal/x402/clip-highlights"
_SPEECH = ["Sabe qual o maior erro de quem começa? É ignorar a retenção.", "Eu testei isso por 30 dias e o resultado me surpreendeu!",
           "Primeiro, o gancho precisa aparecer nos três primeiros segundos.", "Depois você corta tudo que não ajuda a história.",
           "E aqui está o detalhe que quase ninguém conta sobre legendas."]
BODY = {"language": "pt", "max_clips": 2,
        "transcript": [{"start": i * 9.0, "end": i * 9.0 + 9.0, "text": _SPEECH[i % 5]} for i in range(14)]}
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
    monkeypatch.delenv("X402_LLM_ENABLED", raising=False)


def test_without_secret_is_forbidden(db):
    assert client.post(URL, json=BODY, headers=PAID).status_code == 403
    assert client.post(URL, json=BODY, headers={**PAID, "x-internal-secret": "wrong"}).status_code == 403


def test_fail_closed_when_secret_not_configured(db, monkeypatch):
    monkeypatch.delenv("X402_INTERNAL_SECRET")
    assert client.post(URL, json=BODY, headers={**PAID, "x-internal-secret": ""}).status_code == 403


def test_paid_call_returns_clips_and_receipt(db):
    r = client.post(URL, json=BODY, headers={**PAID, "x-internal-secret": "s3cret"})
    assert r.status_code == 200
    d = r.json()
    res = d["result"]
    assert res["source"] == "heuristic" and res["model"] is None  # LLM desligado: o serviço diz a verdade
    assert 1 <= len(res["clips"]) <= 2
    for c in res["clips"]:
        assert 20 <= c["duration_s"] <= 75 and c["hook"] and c["title"]
    assert all(a["end"] <= b["start"] for a, b in zip(res["clips"], res["clips"][1:]))
    rc = d["receipt"]
    assert rc["payer"] == "0xabc" and rc["amount_usdc"] == 0.05 and rc["payment_tx"] == "settle-1"
    assert rc["receipt_pqc"]


def test_same_tx_twice_does_not_crash(db):
    h = {**PAID, "x-internal-secret": "s3cret"}
    assert client.post(URL, json=BODY, headers=h).status_code == 200
    assert client.post(URL, json=BODY, headers=h).status_code == 200


def test_bad_input_rejected(db):
    h = {**PAID, "x-internal-secret": "s3cret"}
    seg = BODY["transcript"]
    assert client.post(URL, json={**BODY, "transcript": seg[:2]}, headers=h).status_code == 422  # < 3 segmentos
    assert client.post(URL, json={**BODY, "transcript": seg + seg * 15}, headers=h).status_code == 422  # > 200
    assert client.post(URL, json={**BODY, "transcript": seg[:2] + [{"start": 0, "end": 5}]}, headers=h).status_code == 422
    assert client.post(URL, json={**BODY, "max_clips": 9}, headers=h).status_code == 422


def test_degenerate_transcript_returns_empty_with_note(db):
    short = [{"start": i, "end": i + 1.0, "text": "oi"} for i in range(5)]  # 5 s no total
    r = client.post(URL, json={"transcript": short}, headers={**PAID, "x-internal-secret": "s3cret"}).json()
    assert r["result"]["clips"] == [] and r["result"]["note"]


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


_P = {"goal": "launch", "budget_usdc": 100}


def test_llm_off_by_default_keeps_heuristic(db, monkeypatch):
    monkeypatch.delenv("X402_LLM_ENABLED", raising=False)
    r = client.post("/internal/x402/campaign-plan", json=_P, headers=_H).json()
    assert "ai_insights" not in r["result"] and "budget_split" in r["result"]


def test_llm_adds_insights_and_charges_real_cost(db, llm):
    r = client.post("/internal/x402/campaign-plan", json=_P, headers=_H).json()
    assert r["result"]["ai_insights"]["source"] == "llm" and len(r["result"]["ai_insights"]["actions"]) == 3
    assert "budget_split" in r["result"]  # base heurística preservada
    # 1000*0.10/1M + 400*0.50/1M = 0.0003, bem abaixo do teto por chamada
    assert x402_llm.budget.spent == pytest.approx(0.0003)


def test_llm_daily_cap_falls_back_without_calling(db, llm, monkeypatch):
    monkeypatch.setenv("X402_LLM_DAILY_CAP_USD", "0.005")  # < teto por chamada (0.01): nunca reserva
    r = client.post("/internal/x402/campaign-plan", json=_P, headers=_H)
    assert r.status_code == 200 and "ai_insights" not in r.json()["result"] and llm == []


def test_llm_failure_is_fail_open_and_refunds_reservation(db, llm, monkeypatch):
    async def boom(*a):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(x402_llm, "_call", boom)
    r = client.post("/internal/x402/campaign-plan", json=_P, headers=_H)
    assert r.status_code == 200 and "ai_insights" not in r.json()["result"]
    assert x402_llm.budget.spent == 0.0


def test_llm_invalid_json_falls_back(db, llm, monkeypatch):
    async def bad(*a):
        return ("not json", 100, 10)

    monkeypatch.setattr(x402_llm, "_call", bad)
    r = client.post("/internal/x402/campaign-plan", json={"goal": "launch", "budget_usdc": 100}, headers=_H)
    assert r.status_code == 200 and "ai_insights" not in r.json()["result"]


# ── clip-highlights com LLM ──────────────────────────────────────────────────
from server import x402_clips

_GOOD = ([{"start": 9, "end": 45, "title": "O maior erro", "reason": "gancho forte"},
          {"start": 63, "end": 100, "title": "O detalhe das legendas", "reason": "revelação"}], 3000, 300)


def test_clips_llm_path_validates_and_reports_source(db, llm, monkeypatch):
    async def fake(system, content):
        return _GOOD

    monkeypatch.setattr(x402_clips, "_call_tool", fake)
    r = client.post(URL, json=BODY, headers=_H).json()["result"]
    assert r["source"] == "llm" and r["model"] == x402_llm.MODEL
    assert [(c["start"], c["end"]) for c in r["clips"]] == [(9.0, 45.0), (63.0, 108.0)]  # fim 100 cai no segmento 99-108: frase inteira
    assert r["clips"][0]["title"] == "O maior erro"
    assert x402_llm.budget.spent == pytest.approx(3000 * 0.10e-6 + 300 * 0.50e-6)


def test_clips_invalid_llm_windows_fall_back_to_heuristic(db, llm, monkeypatch):
    async def bad(system, content):
        # curta demais, fora da mídia e sobreposta: nada presta
        return ([{"start": 0, "end": 5, "title": "t", "reason": "r"}, {"start": 500, "end": 560, "title": "t", "reason": "r"}], 100, 50)

    monkeypatch.setattr(x402_clips, "_call_tool", bad)
    r = client.post(URL, json=BODY, headers=_H).json()["result"]
    assert r["source"] == "heuristic" and r["clips"]


def test_clips_llm_failure_is_fail_open_and_refunds(db, llm, monkeypatch):
    async def boom(system, content):
        raise RuntimeError("down")

    monkeypatch.setattr(x402_clips, "_call_tool", boom)
    r = client.post(URL, json=BODY, headers=_H)
    assert r.status_code == 200 and r.json()["result"]["source"] == "heuristic"
    assert x402_llm.budget.spent == 0.0


def test_clips_daily_cap_serves_heuristic_without_calling(db, llm, monkeypatch):
    monkeypatch.setenv("X402_LLM_DAILY_CAP_USD", "0.005")
    called = []

    async def spy(system, content):
        called.append(1)
        return _GOOD

    monkeypatch.setattr(x402_clips, "_call_tool", spy)
    r = client.post(URL, json=BODY, headers=_H).json()["result"]
    assert r["source"] == "heuristic" and called == []


def test_validate_windows_trims_long_and_drops_overlap():
    segs = [{"start": i * 5.0, "end": i * 5.0 + 5.0, "text": f"s{i}"} for i in range(40)]  # 200 s
    raw = [{"start": 0, "end": 120, "title": "longa", "reason": "r"},       # > 75 s: apara em 75
           {"start": 50, "end": 90, "title": "sobrepõe", "reason": "r"},    # sobrepõe a 1ª
           {"start": 100, "end": 130, "title": "ok", "reason": "r"}]
    out = x402_clips.validate_windows(raw, segs, 3)
    assert [(o["start"], o["end"]) for o in out] == [(0.0, 75.0), (100.0, 130.0)]
