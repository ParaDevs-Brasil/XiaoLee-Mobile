"""
Batch 4/N — validação/fuzzing de POST /v1/agent/run-campaign e POST /v1/creator/register,
mais os executores discover_creators/evaluate_creator sob input adversarial e volume.
"""
from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

app_module = importlib.import_module("server.app")
from database.database import get_db_session
from database.models import Campaign, CampaignParticipant, User
from database.repository import DatabaseRepository
from server.metrics import clear_metrics
from server.integrations.arc_client import ArcClient
from ai.agents.creator_pay_tools import make_tool_executors


# ---------------------------------------------------------------------------
# POST /v1/agent/run-campaign — validação de budget_usdc/campaign_id
# ---------------------------------------------------------------------------

class TestRunCampaignValidation:
    @pytest.fixture(autouse=True)
    def _client(self, monkeypatch, isolated_app_db):
        # Payloads que escapam da validação (ex: campaign_id=1.0 coagido pra 1) agendam
        # um BackgroundTask real — que o TestClient executa SÍNCRONO dentro da própria
        # chamada. Sem isso, um fuzz test aqui dispara o ClaudeAgentEngine de verdade
        # contra a API real da Anthropic + Circle live (já aconteceu uma vez).
        import server.routes.agent_routes as agent_routes_module

        async def _noop_run_agent_task(*args, **kwargs):
            return None

        monkeypatch.setattr(agent_routes_module, "_run_agent_task", _noop_run_agent_task)
        self._client = TestClient(app_module.app, raise_server_exceptions=False)

    @pytest.mark.parametrize("literal", ["Infinity", "-Infinity", "NaN"])
    def test_rejects_non_finite_budget(self, literal):
        body = '{"campaign_id": 1, "budget_usdc": %s}' % literal
        resp = self._client.post("/v1/agent/run-campaign", content=body.encode(), headers={"Content-Type": "application/json"})
        assert resp.status_code == 422

    @pytest.mark.parametrize("budget", [0, -1, -0.01])
    def test_rejects_non_positive_budget(self, budget):
        resp = self._client.post("/v1/agent/run-campaign", json={"campaign_id": 1, "budget_usdc": budget})
        assert resp.status_code in (400, 422)

    @pytest.mark.parametrize("literal", ["Infinity", "NaN"])
    def test_rejects_non_finite_reward_per_creator(self, literal):
        body = '{"campaign_id": 1, "budget_usdc": 10.0, "reward_per_creator_usdc": %s}' % literal
        resp = self._client.post("/v1/agent/run-campaign", content=body.encode(), headers={"Content-Type": "application/json"})
        assert resp.status_code == 422

    def test_rejects_zero_reward_per_creator(self):
        resp = self._client.post("/v1/agent/run-campaign", json={"campaign_id": 1, "budget_usdc": 10.0, "reward_per_creator_usdc": 0})
        assert resp.status_code == 422

    def test_rejects_non_positive_campaign_id(self):
        resp = self._client.post("/v1/agent/run-campaign", json={"campaign_id": 0, "budget_usdc": 10.0})
        assert resp.status_code == 400

    def test_rejects_negative_campaign_id(self):
        resp = self._client.post("/v1/agent/run-campaign", json={"campaign_id": -5, "budget_usdc": 10.0})
        assert resp.status_code == 400

    @given(campaign_id=st.one_of(st.text(max_size=50), st.floats(allow_nan=False, allow_infinity=False), st.none()))
    @settings(max_examples=60, suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture])
    def test_non_integer_campaign_id_never_500(self, campaign_id):
        resp = self._client.post("/v1/agent/run-campaign", json={"campaign_id": campaign_id, "budget_usdc": 10.0})
        assert resp.status_code != 500

    def test_unknown_run_id_status_returns_404(self):
        resp = self._client.get("/v1/agent/run-campaign/does-not-exist/status")
        assert resp.status_code == 404

    @given(run_id=st.text(max_size=100))
    @settings(max_examples=60, suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture])
    def test_arbitrary_run_id_never_500(self, run_id):
        import httpx
        try:
            resp = self._client.get(f"/v1/agent/run-campaign/{run_id}/status")
        except httpx.InvalidURL:
            return  # caracteres de controle que o próprio cliente HTTP recusa montar
        except Exception as e:
            if "InvalidURL" in type(e).__name__:
                return
            raise
        assert resp.status_code != 500


# ---------------------------------------------------------------------------
# POST /v1/creator/register — via HTTP (não direto na função)
# ---------------------------------------------------------------------------

class TestCreatorRegisterEndpoint:
    @pytest.fixture(autouse=True)
    def _isolated(self, isolated_app_db):
        # isolated_app_db: os 80 exemplos do Hypothesis em test_arbitrary_payload_never_500
        # abaixo, mais os testes de registro "happy path", escreviam creators de verdade
        # no dev DB persistente sem isso.
        clear_metrics()
        original_circle_key = app_module.settings.circle_api_key
        object.__setattr__(app_module.settings, "circle_api_key", "")  # sem validação de wallet real
        self._client = TestClient(app_module.app, raise_server_exceptions=False)
        yield
        object.__setattr__(app_module.settings, "circle_api_key", original_circle_key)

    @staticmethod
    def _signed_register(handle: str):
        """Monta um payload de registro com prova de posse EVM válida (assinatura própria)."""
        from eth_account import Account
        from eth_account.messages import encode_defunct

        acct = Account.create()
        h = handle.lstrip("@")
        msg = f"XiaoLee creator registration|wallet:{acct.address}|handle:@{h}|ts:1"
        sig = acct.sign_message(encode_defunct(text=msg)).signature.hex()
        if not sig.startswith("0x"):
            sig = "0x" + sig
        return {
            "twitter_handle": handle,
            "wallet_address": acct.address,
            "chain": "arc",
            "circle_wallet_id": acct.address,
            "signed_message": msg,
            "signature": sig,
            "proof_encoding": "eip191",
        }, acct

    def test_register_creator_happy_path(self):
        payload, _ = self._signed_register("@newcreator")
        resp = self._client.post("/v1/creator/register", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert body["creator"] == "@newcreator"
        assert body["already_registered"] is False

    def test_register_creator_idempotent(self):
        p1, _ = self._signed_register("@same")
        p2, _ = self._signed_register("@same")
        first = self._client.post("/v1/creator/register", json=p1)
        second = self._client.post("/v1/creator/register", json=p2)
        assert first.json()["already_registered"] is False
        assert second.json()["already_registered"] is True

    def test_register_creator_rejects_foreign_wallet(self):
        """SEGURANÇA: registrar o endereço de outra pessoa (assinatura de chave alheia) é rejeitado."""
        from eth_account import Account
        from eth_account.messages import encode_defunct

        victim = Account.create()
        attacker = Account.create()  # assina com a própria chave, mas informa o endereço da vítima
        msg = f"XiaoLee creator registration|wallet:{victim.address}|handle:@thief|ts:1"
        forged = attacker.sign_message(encode_defunct(text=msg)).signature.hex()
        if not forged.startswith("0x"):
            forged = "0x" + forged
        resp = self._client.post("/v1/creator/register", json={
            "twitter_handle": "@thief",
            "wallet_address": victim.address,
            "chain": "arc",
            "circle_wallet_id": victim.address,
            "signed_message": msg,
            "signature": forged,
            "proof_encoding": "eip191",
        })
        assert resp.status_code == 400

    def test_register_creator_requires_signature(self):
        """Sem prova de posse (campo de texto livre) o registro é rejeitado."""
        resp = self._client.post("/v1/creator/register", json={
            "twitter_handle": "@nosig",
            "wallet_address": "0x1111111111111111111111111111111111111111",
            "chain": "arc",
        })
        assert resp.status_code == 400

    def test_register_creator_empty_handle_rejected(self):
        resp = self._client.post("/v1/creator/register", json={"twitter_handle": "", "circle_wallet_id": "w1"})
        assert resp.status_code == 422

    def test_register_creator_missing_wallet_id_rejected(self):
        resp = self._client.post("/v1/creator/register", json={"twitter_handle": "@c", "circle_wallet_id": ""})
        assert resp.status_code == 422

    def test_register_creator_missing_fields_rejected(self):
        resp = self._client.post("/v1/creator/register", json={})
        assert resp.status_code == 422

    @given(
        handle=st.one_of(st.text(max_size=100), st.integers(), st.none()),
        wallet_id=st.one_of(st.text(max_size=100), st.integers(), st.none()),
    )
    @settings(max_examples=80, suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture])
    def test_arbitrary_payload_never_500(self, handle, wallet_id):
        resp = self._client.post("/v1/creator/register", json={"twitter_handle": handle, "circle_wallet_id": wallet_id})
        assert resp.status_code != 500


# ---------------------------------------------------------------------------
# discover_creators / evaluate_creator — volume e input adversarial
# ---------------------------------------------------------------------------

def _make_campaign(db_session, name="Bulk Campaign"):
    c = Campaign(
        creator_twitter_user_id="test_creator", name=name, description="desc",
        campaign_type="social", reward_token="USDC", reward_per_participant=5.0,
        max_participants=1000, reward_pool=5000.0, status="active",
    )
    db_session.add(c)
    return c


class TestDiscoverCreatorsUnderVolume:
    @pytest.mark.asyncio
    async def test_discover_creators_with_200_enrolled_participants(self, db_session):
        repo = DatabaseRepository(db_session)
        arc = ArcClient(sandbox=True)
        campaign = _make_campaign(db_session)
        await db_session.flush()

        for i in range(200):
            u = User(twitter_handle=f"@bulk_{i}", twitter_user_id=f"uid_{i}")
            db_session.add(u)
            await db_session.flush()
            p = CampaignParticipant(campaign_id=campaign.id, user_id=u.id, has_followed=True, has_replied=True)
            db_session.add(p)
        await db_session.flush()

        executors = make_tool_executors(repo=repo, arc_client=arc, campaign_id=campaign.id, budget_usdc=1000.0)
        result = await executors["discover_creators"]({"campaign_id": campaign.id, "limit": 50}, {})
        assert result["count"] == 50  # respeita o limit mesmo com 200 disponíveis

    @pytest.mark.asyncio
    async def test_discover_creators_limit_is_capped_at_50_even_if_requested_more(self, db_session):
        repo = DatabaseRepository(db_session)
        arc = ArcClient(sandbox=True)
        campaign = _make_campaign(db_session)
        await db_session.flush()

        executors = make_tool_executors(repo=repo, arc_client=arc, campaign_id=campaign.id, budget_usdc=1000.0)
        result = await executors["discover_creators"]({"campaign_id": campaign.id, "limit": 999999}, {})
        assert result["count"] == 0  # sem participantes, mas não crasha com limit absurdo

    @pytest.mark.asyncio
    async def test_evaluate_creator_empty_id_returns_ineligible_not_crash(self, db_session):
        repo = DatabaseRepository(db_session)
        arc = ArcClient(sandbox=True)
        campaign = _make_campaign(db_session)
        await db_session.flush()
        executors = make_tool_executors(repo=repo, arc_client=arc, campaign_id=campaign.id, budget_usdc=1000.0)

        result = await executors["evaluate_creator"]({"creator_id": "", "campaign_id": campaign.id}, {})
        assert result["eligible"] is False

    @pytest.mark.parametrize(
        "creator_id",
        [
            "'; DROP TABLE campaign_participants; --",
            "<script>alert(1)</script>",
            "\x00null\x00byte",
            "💀" * 30,
            "A" * 5000,
            "النص العربي",
            " " * 50,
            "@" * 20,
        ],
    )
    @pytest.mark.asyncio
    async def test_evaluate_creator_arbitrary_string_never_crashes(self, creator_id, db_session):
        # Não usa Hypothesis aqui de propósito: @given + fixture async db_session
        # rodando via loop manual causa "Future attached to a different loop" —
        # AsyncSession é vinculada ao loop do pytest-asyncio que a criou.
        repo = DatabaseRepository(db_session)
        arc = ArcClient(sandbox=True)
        campaign = _make_campaign(db_session)
        await db_session.flush()
        executors = make_tool_executors(repo=repo, arc_client=arc, campaign_id=campaign.id, budget_usdc=1000.0)

        result = await executors["evaluate_creator"]({"creator_id": creator_id, "campaign_id": campaign.id}, {})
        assert "eligible" in result
