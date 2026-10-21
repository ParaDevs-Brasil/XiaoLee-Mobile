"""
test_onoff.py — on/off-ramp: máquina de estados, tetos, gate de KYC, webhooks assinados e anti-replay.

Regras que estes testes travam:
- desligado por padrão; só avança por transições válidas; todo passo vira evento (auditoria);
- tetos por operação/dia/mês e por direção; falhas não consomem teto;
- saque para fiat só com KYC do provedor e fora do cooldown de depósito grande; saque entre redes valida destino;
- webhook sem assinatura válida é 401; o mesmo event_id não aplica duas vezes; transição inválida é ignorada;
- um usuário nunca vê o intent de outro.
"""
from __future__ import annotations

import dataclasses
import hashlib
import hmac
import importlib
import json
import os
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.database import get_db_session
from database.models import OnoffEvent, OnoffIntent, User, WebSession
from server import onoff, onoff_chain

app_module = importlib.import_module("server.app")
routes = importlib.import_module("server.onoff_routes")
client = TestClient(app_module.app)
SECRET = "sandbox-secret"
ADDR = "0x" + "a" * 40


class FakeIris:
    """Iris simulada: cotação fixa e mensagens por hash do burn."""
    def __init__(self):
        self.reset()

    def reset(self):
        self.messages = {}
        self.fail_fees = False

    async def __call__(self, path):
        if "/fees/" in path:
            if self.fail_fees:
                raise onoff.OnoffError(502, "iris_unreachable", "down")
            return [{"finalityThreshold": 1000, "minimumFee": 1, "forwardFee": {"low": 1, "med": 1, "high": 1}},
                    {"finalityThreshold": 2000, "minimumFee": 0, "forwardFee": {"low": 50_000, "med": 60_000, "high": 90_000}}]
        tx = path.split("transactionHash=")[1]
        return {"messages": [self.messages[tx]]} if tx in self.messages else None


iris = FakeIris()
BURN_TX = "0x" + "b" * 64


def _burn_msg(amount_minor, to=ADDR, domain="6", status="complete", forward=None):
    m = {"status": status, "forwardState": "COMPLETE" if forward else "PENDING",
         "decodedMessage": {"destinationDomain": domain,
                            "decodedMessageBody": {"mintRecipient": "0x" + "0" * 24 + to[2:], "amount": str(amount_minor)}}}
    if forward:
        m["forwardTxHash"] = forward
    return m


@pytest_asyncio.fixture
async def db(db_session, monkeypatch):
    async def _override():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = _override
    s = dataclasses.replace(routes.settings, onoff_enabled=True, onoff_sandbox_secret=SECRET, onoff_allowlist="",
                            onoff_max_tx_usdc=100, onoff_max_day_usdc=250, onoff_max_month_usdc=1000,
                            onoff_withdraw_min_kyc_level=2, onoff_cooldown_hours=24, onoff_cooldown_min_usdc=100)
    monkeypatch.setattr(routes, "settings", s)
    monkeypatch.setattr(onoff, "settings", s)
    monkeypatch.setattr(onoff, "_PROVIDERS", {})
    onoff.register(routes._Sandbox())
    iris.reset()
    monkeypatch.setattr(onoff_chain, "iris_get", iris)
    yield db_session
    app_module.app.dependency_overrides.pop(get_db_session, None)


async def _user(db, name="ana"):
    u = User(twitter_user_id=f"privy_did:{name}", twitter_handle=name)
    db.add(u)
    await db.flush()
    db.add(WebSession(session_id=f"privy_session_{name}", twitter_user_id=f"privy_did:{name}",
                      expires_at=datetime.utcnow() + timedelta(days=1)))
    await db.commit()
    return u.id, {"Authorization": f"Bearer privy_session_{name}"}


def _hook(provider="sandbox", **ev):
    body = json.dumps(ev).encode()
    sig = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    return client.post(f"/v1/onoff/webhooks/{provider}", content=body, headers={"X-Onoff-Signature": sig})


def _deposit(h, amount=50, method="card"):
    return client.post("/v1/onoff/deposit", headers=h, json={"amount_usdc": amount, "method": method})


async def _kyc(uid, level=2):
    assert _hook(event_id=f"kyc-{uid}-{level}", kind="kyc", external_user_id=str(uid), kyc_level=level,
                 kyc_status="approved").status_code == 200


# ── regras puras ────────────────────────────────────────────────────────────

def test_hmac_never_validates_without_secret_or_signature():
    body = b"{}"
    good = hmac.new(b"s", body, hashlib.sha256).hexdigest()
    assert onoff.hmac_ok("s", body, good) and onoff.hmac_ok("s", body, good.upper())
    assert not onoff.hmac_ok("", body, good) and not onoff.hmac_ok("s", body, "") and not onoff.hmac_ok("s", body, "00")


def test_terminal_states_have_no_exit():
    for table in onoff.TRANSITIONS.values():
        assert not (onoff.TERMINAL & set(table))


# ── fluxo de depósito ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_disabled_by_default(db, monkeypatch):
    _, h = await _user(db)
    monkeypatch.setattr(onoff, "settings", dataclasses.replace(onoff.settings, onoff_enabled=False))
    r = _deposit(h)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "onoff_disabled"


@pytest.mark.asyncio
async def test_deposit_settles_and_audits_every_step(db):
    uid, h = await _user(db)
    r = _deposit(h)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "pending_provider" and out["url"].startswith("https://sandbox.invalid/")
    ref = f"sbx_{out['intent_id']}"
    assert _hook(event_id="e1", kind="intent", provider_ref=ref, status="funds_received", amount_usdc=50).status_code == 200
    assert _hook(event_id="e2", kind="intent", provider_ref=ref, status="settled", amount_usdc=50, onchain_tx="0xabc").status_code == 200
    got = client.get(f"/v1/onoff/intents/{out['intent_id']}", headers=h).json()
    assert got["status"] == "settled" and got["onchain_tx"] == "0xabc"
    steps = (await db.execute(select(OnoffEvent.to_status).order_by(OnoffEvent.id))).scalars().all()
    assert steps == ["created", "pending_provider", "funds_received", "settled"]


@pytest.mark.asyncio
async def test_webhook_needs_a_valid_signature_and_ignores_replay_and_bad_transitions(db):
    _, h = await _user(db)
    out = _deposit(h).json()
    ref = f"sbx_{out['intent_id']}"
    body = json.dumps({"event_id": "x", "kind": "intent", "provider_ref": ref, "status": "settled"}).encode()
    assert client.post("/v1/onoff/webhooks/sandbox", content=body, headers={"X-Onoff-Signature": "00"}).status_code == 401
    assert client.post("/v1/onoff/webhooks/sandbox", content=body).status_code == 401
    assert _hook(event_id="a", kind="intent", provider_ref=ref, status="settled", amount_usdc=50).json() == {"ignored": True}  # pula etapas
    assert _hook(event_id="b", kind="intent", provider_ref=ref, status="funds_received", amount_usdc=50).status_code == 200
    assert _hook(event_id="b", kind="intent", provider_ref=ref, status="funds_received", amount_usdc=50).json() == {"duplicate": True}
    assert _hook("nope", event_id="c", kind="intent").status_code == 404


@pytest.mark.asyncio
async def test_limits_per_tx_and_per_day_and_failures_free_the_cap(db):
    _, h = await _user(db)
    assert _deposit(h, 101).json()["detail"]["code"] == "over_tx_limit"
    assert _deposit(h, 100).status_code == 200 and _deposit(h, 100).status_code == 200
    r = _deposit(h, 100)
    assert r.status_code == 429 and r.json()["detail"]["code"] == "over_day_limit"
    # um intent que falha deixa de contar
    first = client.get("/v1/onoff/intents", headers=h).json()[-1]
    assert _hook(event_id="f", kind="intent", provider_ref=f"sbx_{first['intent_id']}", status="failed").status_code == 200
    assert _deposit(h, 100).status_code == 200


@pytest.mark.asyncio
async def test_allowlist_closes_the_pilot(db, monkeypatch):
    _, h = await _user(db)
    monkeypatch.setattr(onoff, "settings", dataclasses.replace(onoff.settings, onoff_allowlist="someone-else"))
    assert _deposit(h).json()["detail"]["code"] == "not_allowed"
    monkeypatch.setattr(onoff, "settings", dataclasses.replace(onoff.settings, onoff_allowlist="PRIVY_DID:ana"))
    assert _deposit(h).status_code == 200


# ── saque ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fiat_withdraw_needs_kyc_then_waits_after_a_big_deposit(db):
    uid, h = await _user(db)
    w = {"amount_usdc": 20, "method": "pix", "fiat_currency": "BRL"}
    assert client.post("/v1/onoff/withdraw", headers=h, json=w).json()["detail"]["code"] == "kyc_required"
    await _kyc(uid, level=1)
    assert client.post("/v1/onoff/withdraw", headers=h, json=w).json()["detail"]["code"] == "kyc_required"
    await _kyc(uid, level=2)
    d = _deposit(h, 100).json()
    ref = f"sbx_{d['intent_id']}"
    for n, st in enumerate(["funds_received", "settled"]):
        assert _hook(event_id=f"d{n}", kind="intent", provider_ref=ref, status=st, amount_usdc=100).status_code == 200
    assert client.post("/v1/onoff/withdraw", headers=h, json=w).json()["detail"]["code"] == "cooldown"
    row = (await db.execute(select(OnoffIntent).where(OnoffIntent.intent_id == d["intent_id"]))).scalars().one()
    row.updated_at = datetime.utcnow() - timedelta(hours=25)
    await db.commit()
    ok = client.post("/v1/onoff/withdraw", headers=h, json=w)
    assert ok.status_code == 200 and ok.json()["status"] == "pending_provider"


@pytest.mark.asyncio
async def test_chain_withdraw_validates_destination_and_stays_private(db):
    _, h = await _user(db)
    base = {"amount_usdc": 10, "method": "chain"}
    for bad in ({"dest_network": "solana", "dest_address": ADDR}, {"dest_network": "base", "dest_address": "0x12"}, {}):
        assert client.post("/v1/onoff/withdraw", headers=h, json=base | bad).json()["detail"]["code"] == "bad_destination"
    r = client.post("/v1/onoff/withdraw", headers=h, json=base | {"dest_network": "base", "dest_address": ADDR})
    assert r.status_code == 200 and r.json()["provider"] == "cctp" and r.json()["status"] == "created"
    assert r.json()["max_fee_usdc"] == 0.06 and r.json()["burn"]["burn_amount"] == "10060000"
    _, other = await _user(db, "bob")
    assert client.get(f"/v1/onoff/intents/{r.json()['intent_id']}", headers=other).status_code == 404
    assert client.get("/v1/onoff/intents", headers=other).json() == []


@pytest.mark.asyncio
async def test_requires_a_real_session_and_a_known_method(db):
    assert client.post("/v1/onoff/deposit", json={"amount_usdc": 5, "method": "card"}).status_code in (401, 403)
    _, h = await _user(db)
    assert _deposit(h, 5, "boleto").json()["detail"]["code"] == "bad_method"
    assert client.get("/v1/onoff/config").json()["providers"][0]["name"] == "sandbox"


# ── valor conferido, teto global, expiração ─────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("reported", [None, 49.0, 500.0])
async def test_amount_mismatch_or_missing_locks_the_intent_for_review(db, reported):
    _, h = await _user(db)
    out = _deposit(h, 50).json()
    ref = f"sbx_{out['intent_id']}"
    ev = dict(event_id="m1", kind="intent", provider_ref=ref, status="funds_received")
    assert _hook(**ev, **({} if reported is None else {"amount_usdc": reported})).status_code == 200
    assert client.get(f"/v1/onoff/intents/{out['intent_id']}", headers=h).json()["status"] == "review"
    # `review` não anda sozinho e continua contando no teto
    assert _hook(event_id="m2", kind="intent", provider_ref=ref, status="settled", amount_usdc=50).json() == {"ignored": True}
    assert client.get(f"/v1/onoff/intents/{out['intent_id']}", headers=h).json()["status"] == "review"


@pytest.mark.asyncio
async def test_amount_within_one_percent_is_accepted(db):
    _, h = await _user(db)
    out = _deposit(h, 50).json()
    assert _hook(event_id="t1", kind="intent", provider_ref=f"sbx_{out['intent_id']}", status="funds_received",
                 amount_usdc=50.4).status_code == 200
    assert client.get(f"/v1/onoff/intents/{out['intent_id']}", headers=h).json()["status"] == "funds_received"


@pytest.mark.asyncio
async def test_global_cap_stops_everyone_without_naming_the_reason(db, monkeypatch):
    _, a = await _user(db, "ana")
    _, b = await _user(db, "bob")
    monkeypatch.setattr(onoff, "settings", dataclasses.replace(onoff.settings, onoff_max_global_day_usdc=120))
    assert _deposit(a, 100).status_code == 200
    r = _deposit(b, 50)
    assert r.status_code == 429 and r.json()["detail"]["code"] == "capacity"


@pytest.mark.asyncio
async def test_stale_intents_expire_and_stop_counting(db):
    _, h = await _user(db)
    out = _deposit(h, 100).json()
    row = (await db.execute(select(OnoffIntent).where(OnoffIntent.intent_id == out["intent_id"]))).scalars().one()
    row.expires_at = datetime.utcnow() - timedelta(minutes=1)
    await db.commit()
    assert client.get(f"/v1/onoff/intents/{out['intent_id']}", headers=h).json()["status"] == "expired"
    assert _hook(event_id="x1", kind="intent", provider_ref=f"sbx_{out['intent_id']}", status="funds_received",
                 amount_usdc=100).json() == {"ignored": True}   # chegou tarde: não ressuscita
    assert _deposit(h, 100).status_code == 200 and _deposit(h, 100).status_code == 200


# ── saque entre redes: a carteira do usuário assina, a Circle faz o mint ────

async def _chain_withdraw(h, amount=10):
    r = client.post("/v1/onoff/withdraw", headers=h, json={"amount_usdc": amount, "method": "chain",
                                                           "dest_network": "base", "dest_address": ADDR})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_chain_withdraw_quotes_the_burn_the_app_must_sign(db):
    _, h = await _user(db)
    w = await _chain_withdraw(h)
    b = w["burn"]
    assert b["destination_domain"] == 6 and b["source_domain"] == 26 and b["min_finality_threshold"] == 2000
    assert b["mint_recipient"] == "0x" + "0" * 24 + "a" * 40 and b["destination_caller"] == "0x" + "0" * 64
    assert b["max_fee"] == "60000" and b["burn_amount"] == "10060000" and b["hook_data"].startswith("0x636374702d666f72776172640")
    assert client.get(f"/v1/onoff/intents/{w['intent_id']}", headers=h).json()["burn"] is None   # só na criação


@pytest.mark.asyncio
async def test_chain_withdraw_without_a_quote_fails_and_frees_the_cap(db):
    _, h = await _user(db)
    iris.fail_fees = True
    r = client.post("/v1/onoff/withdraw", headers=h, json={"amount_usdc": 100, "method": "chain",
                                                           "dest_network": "base", "dest_address": ADDR})
    assert r.status_code == 502
    iris.fail_fees = False
    assert client.get("/v1/onoff/intents", headers=h).json()[0]["status"] == "failed"
    assert (await _chain_withdraw(h, 100))["status"] == "created"


@pytest.mark.asyncio
async def test_burn_is_verified_on_the_iris_then_tracked_to_the_forward_mint(db):
    _, h = await _user(db)
    w = await _chain_withdraw(h)
    url = f"/v1/onoff/intents/{w['intent_id']}/burn"
    assert client.post(url, headers=h, json={"tx_hash": BURN_TX}).status_code == 202   # Iris ainda não viu
    iris.messages[BURN_TX] = _burn_msg(10_060_000, status="pending_confirmations")
    r = client.post(url, headers=h, json={"tx_hash": BURN_TX})
    assert r.status_code == 200 and r.json()["status"] == "pending_provider" and r.json()["onchain_tx"] == BURN_TX
    iris.messages[BURN_TX] = _burn_msg(10_060_000)
    assert client.get(f"/v1/onoff/intents/{w['intent_id']}", headers=h).json()["status"] == "sent_to_provider"
    iris.messages[BURN_TX] = _burn_msg(10_060_000, forward="0xmint")
    done = client.get(f"/v1/onoff/intents/{w['intent_id']}", headers=h).json()
    assert done["status"] == "paid_out" and done["forward_tx"] == "0xmint"


@pytest.mark.asyncio
@pytest.mark.parametrize("msg", [_burn_msg(9_000_000), _burn_msg(10_060_000, to="0x" + "c" * 40), _burn_msg(10_060_000, domain="0")])
async def test_a_burn_that_does_not_match_the_intent_is_refused(db, msg):
    _, h = await _user(db)
    w = await _chain_withdraw(h)
    iris.messages[BURN_TX] = msg
    r = client.post(f"/v1/onoff/intents/{w['intent_id']}/burn", headers=h, json={"tx_hash": BURN_TX})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "burn_mismatch"
    assert client.get(f"/v1/onoff/intents/{w['intent_id']}", headers=h).json()["status"] == "created"


@pytest.mark.asyncio
async def test_one_burn_cannot_settle_two_withdrawals_nor_someone_elses(db):
    _, a = await _user(db, "ana")
    _, b = await _user(db, "bob")
    w1, w2 = await _chain_withdraw(a), await _chain_withdraw(a)
    iris.messages[BURN_TX] = _burn_msg(10_060_000)
    assert client.post(f"/v1/onoff/intents/{w1['intent_id']}/burn", headers=a, json={"tx_hash": BURN_TX}).status_code == 200
    again = client.post(f"/v1/onoff/intents/{w2['intent_id']}/burn", headers=a, json={"tx_hash": BURN_TX})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "tx_already_used"
    assert client.post(f"/v1/onoff/intents/{w2['intent_id']}/burn", headers=b, json={"tx_hash": BURN_TX}).status_code == 404
    assert client.post(f"/v1/onoff/intents/{w2['intent_id']}/burn", headers=a, json={"tx_hash": "0x12"}).status_code == 422
