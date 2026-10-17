"""
test_transfer_balance_check.py — "envia X USDC" não mostra o botão de assinar se faltar saldo.

Antes, 5.000 USDC com saldo de 85 gerava o botão normalmente e a falha só vinha na assinatura.
A checagem é um aviso antecipado: se o saldo não puder ser lido, a transferência segue (a rede recusa
de qualquer forma), e sem carteira conectada não há o que conferir.
"""
from __future__ import annotations

import importlib
import os

import pytest

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

app_module = importlib.import_module("server.app")
WALLET = "0x" + "ab" * 20
DEST = "0x000000000000000000000000000000000000dEaD"


@pytest.fixture
def orchestrator(monkeypatch):
    orch = app_module.orchestrator
    # o caminho do intent Arc não usa o loop do Claude; o Gemini só redige a frase
    async def fake_reply(**kwargs):
        return "ok"

    monkeypatch.setattr(orch.gemini, "generate_reply", fake_reply)
    monkeypatch.setattr(orch, "claude_engine", None)
    monkeypatch.setattr("server.orchestration.service.settings", _with_usdc(orch))
    return orch


def _with_usdc(orch):
    import dataclasses

    from server.orchestration import service

    return dataclasses.replace(service.settings, arc_usdc_address="0x" + "cd" * 20)


def _balance(monkeypatch, value):
    async def fake(address):
        assert address == WALLET
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr("server.routes.arc_routes.read_arc_usdc_balance", fake)


def _msg(amount, wallet=True):
    note = f"[System Note: User connected wallet is {WALLET} on arc] " if wallet else ""
    return f"{note}envia {amount} USDC para {DEST}"


@pytest.mark.asyncio
async def test_amount_above_balance_gets_no_button(orchestrator, monkeypatch):
    _balance(monkeypatch, 85.1)
    out = await orchestrator.execute(_msg(5000), "u", platform="web")
    assert out["execution"]["status"] == "evm_transfer_insufficient_balance"
    assert "evm_tx" not in out["execution"] and "transfer" not in out["execution"]
    assert out["execution"]["balance_usdc"] == 85.1


@pytest.mark.asyncio
async def test_amount_within_balance_keeps_the_button(orchestrator, monkeypatch):
    _balance(monkeypatch, 85.1)
    out = await orchestrator.execute(_msg(0.01), "u", platform="web")
    assert out["execution"]["status"] == "evm_tx_ready"
    assert out["execution"]["transfer"]["amount_usdc"] == 0.01


@pytest.mark.asyncio
async def test_exact_balance_is_allowed(orchestrator, monkeypatch):
    _balance(monkeypatch, 5.0)
    out = await orchestrator.execute(_msg(5), "u", platform="web")
    assert out["execution"]["status"] == "evm_tx_ready"


@pytest.mark.asyncio
async def test_unreadable_balance_does_not_block(orchestrator, monkeypatch):
    _balance(monkeypatch, RuntimeError("rpc down"))
    out = await orchestrator.execute(_msg(5000), "u", platform="web")
    assert out["execution"]["status"] == "evm_tx_ready"


@pytest.mark.asyncio
async def test_without_a_wallet_there_is_nothing_to_check(orchestrator, monkeypatch):
    _balance(monkeypatch, AssertionError("não deveria consultar o saldo"))
    out = await orchestrator.execute(_msg(5000, wallet=False), "u", platform="web")
    assert out["execution"]["status"] == "evm_tx_ready"
