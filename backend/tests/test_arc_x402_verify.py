"""
test_arc_x402_verify.py — verificação de pagamento da rota legada /v1/arc/ai/query.

Trava o fail-closed: em modo live, sem ARC_X402_WALLET_ADDRESS nenhum pagamento é aceito
(antes a checagem de destinatário era pulada e qualquer transação confirmada da conta servia).
"""
from __future__ import annotations

import json
import os
from types import SimpleNamespace

import pytest

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from server.routes.arc_x402_routes import _verify_payment_arc

WALLET = "0x" + "a" * 40
HEADER = json.dumps({"circle_id": "tx-1"})


class FakeArc:
    def __init__(self, *, sandbox: bool, to: str = WALLET, amount: float = 0.10):
        self.sandbox = sandbox
        self._r = SimpleNamespace(confirmed=True, status="CONFIRMED", to=to, amount_usdc=amount)

    async def get_transfer_result(self, _circle_id):
        return self._r


@pytest.mark.asyncio
async def test_live_sem_carteira_configurada_recusa(monkeypatch):
    monkeypatch.delenv("ARC_X402_WALLET_ADDRESS", raising=False)
    ok, _ = await _verify_payment_arc(HEADER, FakeArc(sandbox=False))
    assert ok is False


@pytest.mark.asyncio
async def test_live_com_carteira_aceita_so_destino_e_valor_corretos(monkeypatch):
    monkeypatch.setenv("ARC_X402_WALLET_ADDRESS", WALLET)
    assert (await _verify_payment_arc(HEADER, FakeArc(sandbox=False)))[0] is True
    assert (await _verify_payment_arc(HEADER, FakeArc(sandbox=False, to="0x" + "b" * 40)))[0] is False
    assert (await _verify_payment_arc(HEADER, FakeArc(sandbox=False, amount=0.01)))[0] is False


@pytest.mark.asyncio
async def test_sandbox_continua_aceitando_sem_carteira(monkeypatch):
    monkeypatch.delenv("ARC_X402_WALLET_ADDRESS", raising=False)
    ok, _ = await _verify_payment_arc(HEADER, FakeArc(sandbox=True))
    assert ok is True
