"""
test_arc_swap.py — o agente prepara o swap na Arc; quem assina é o usuário, no app.

Trava: só USDC/EURC/cirBTC, pedido válido, saldo conferido, e a tool certa por carteira
(Arc sem Stellar não oferece o swap do Stellar DEX nem manda "conectar a Freighter").
"""
from __future__ import annotations

import json

import pytest

from server.arc_swap import canonical_token, validate_arc_swap
from server.orchestration import service as svc

W = "0x" + "ab" * 20


class TestValidate:
    def test_valid_request_is_normalised(self):
        data, err = validate_arc_swap("usdc", " EURC ", 1.5)
        assert err is None
        assert data == {"tokenIn": "USDC", "tokenOut": "EURC", "amountIn": "1.5"}

    def test_string_amount_keeps_its_decimals(self):
        data, _ = validate_arc_swap("USDC", "cirbtc", "0.00001")
        assert data["amountIn"] == "0.00001" and data["tokenOut"] == "cirBTC"

    def test_small_float_is_not_scientific_notation(self):
        data, _ = validate_arc_swap("USDC", "EURC", 0.00001)
        assert "e" not in data["amountIn"].lower()

    @pytest.mark.parametrize("tin,tout", [("USDC", "XLM"), ("BTC", "USDC"), (None, "USDC"), ("USDC", 3)])
    def test_unsupported_token_lists_the_supported_ones(self, tin, tout):
        data, err = validate_arc_swap(tin, tout, 1)
        assert data is None and "USDC, EURC, cirBTC" in err

    def test_same_token_refused(self):
        assert validate_arc_swap("USDC", "usdc", 1)[0] is None

    @pytest.mark.parametrize("amount", [0, -1, "abc", None, float("nan"), float("inf"), ""])
    def test_bad_amount_refused(self, amount):
        data, err = validate_arc_swap("USDC", "EURC", amount)
        assert data is None and "maior que zero" in err

    def test_canonical_token(self):
        assert canonical_token("CIRBTC") == "cirBTC" and canonical_token("eth") is None


class TestToolSelection:
    def _names(self, tools):
        return {t["function"]["name"] for t in tools}

    def test_arc_wallet_only_gets_arc_swap_and_not_the_stellar_one(self):
        names = self._names(svc.OrchestrationService._tools_for(None, W))
        assert "arc_swap_prepare" in names and "stellar_swap_quote" not in names

    def test_stellar_only_keeps_the_stellar_swap(self):
        names = self._names(svc.OrchestrationService._tools_for("G" + "A" * 55, None))
        assert "stellar_swap_quote" in names and "arc_swap_prepare" not in names

    def test_both_wallets_get_both(self):
        names = self._names(svc.OrchestrationService._tools_for("G" + "A" * 55, W))
        assert {"arc_swap_prepare", "stellar_swap_quote"} <= names

    def test_no_wallet_is_unchanged(self):
        names = self._names(svc.OrchestrationService._tools_for(None, None))
        assert "stellar_swap_quote" in names and "arc_swap_prepare" not in names


class TestExecutor:
    def _executor(self, wallet=W):
        captured = {"actions": [], "execution": None, "last_swap_args": {}, "animation_name": None}
        orchestrator = svc.OrchestrationService.__new__(svc.OrchestrationService)
        return orchestrator._make_stellar_executor(None, captured, evm_wallet=wallet, user_id="u"), captured

    def _balance(self, monkeypatch, value):
        async def fake(address):
            assert address == W
            if isinstance(value, Exception):
                raise value
            return value

        monkeypatch.setattr("server.routes.arc_routes.read_arc_usdc_balance", fake)

    @pytest.mark.asyncio
    async def test_prepares_the_swap_for_the_app_to_sign(self, monkeypatch):
        self._balance(monkeypatch, 85.1)
        executor, captured = self._executor()
        out = json.loads(await executor("arc_swap_prepare", {"token_in": "usdc", "token_out": "EURC", "amount": 1}))
        assert out["ready_to_sign"] is True and out["tokenIn"] == "USDC"
        assert captured["execution"]["status"] == "swap_ready"
        assert captured["execution"]["swap"] == {"tokenIn": "USDC", "tokenOut": "EURC", "amountIn": "1"}
        assert captured["actions"] == ["arc_swap"]

    @pytest.mark.asyncio
    async def test_refuses_before_a_button_when_usdc_balance_is_short(self, monkeypatch):
        self._balance(monkeypatch, 0.5)
        executor, captured = self._executor()
        out = json.loads(await executor("arc_swap_prepare", {"token_in": "USDC", "token_out": "EURC", "amount": 2}))
        assert out["error"] == "insufficient_balance" and "0.5" in out["message"]
        assert captured["execution"] is None

    @pytest.mark.asyncio
    async def test_unsupported_token_never_reaches_the_app(self, monkeypatch):
        self._balance(monkeypatch, 100)
        executor, captured = self._executor()
        out = json.loads(await executor("arc_swap_prepare", {"token_in": "USDC", "token_out": "XLM", "amount": 1}))
        assert out["error"] == "invalid_swap" and captured["execution"] is None

    @pytest.mark.asyncio
    async def test_needs_a_wallet(self, monkeypatch):
        self._balance(monkeypatch, 100)
        executor, captured = self._executor(wallet=None)
        out = json.loads(await executor("arc_swap_prepare", {"token_in": "USDC", "token_out": "EURC", "amount": 1}))
        assert out["error"] == "no_evm_wallet" and captured["execution"] is None

    @pytest.mark.asyncio
    async def test_other_tokens_skip_the_usdc_balance_check(self, monkeypatch):
        self._balance(monkeypatch, AssertionError("não deveria ler o saldo USDC"))
        executor, captured = self._executor()
        out = json.loads(await executor("arc_swap_prepare", {"token_in": "EURC", "token_out": "USDC", "amount": 3}))
        assert out["ready_to_sign"] is True

    @pytest.mark.asyncio
    async def test_unreadable_balance_does_not_block_the_swap(self, monkeypatch):
        # a checagem é só aviso antecipado; o app/SDK recusa de qualquer forma se faltar saldo
        self._balance(monkeypatch, RuntimeError("rpc down"))
        executor, _ = self._executor()
        out = json.loads(await executor("arc_swap_prepare", {"token_in": "USDC", "token_out": "EURC", "amount": 1}))
        assert out["ready_to_sign"] is True


def test_arc_only_context_points_to_the_arc_swap_not_freighter():
    orchestrator = svc.OrchestrationService.__new__(svc.OrchestrationService)
    ctx = orchestrator._chains_ctx(W, None)
    assert "arc_swap_prepare" in ctx
