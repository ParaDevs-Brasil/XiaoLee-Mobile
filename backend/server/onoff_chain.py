"""
onoff_chain.py — saque entre redes (Arc -> Base/Ethereum) via CCTP V2 + Forwarding Service da Circle.

O usuário assina `approve` + `depositForBurnWithHook` com a PRÓPRIA carteira; a Circle faz o mint no destino
(sem gás para ele). A XiaoLee nunca segura USDC nem chave: aqui só se cota a taxa, confere o burn na Iris e
acompanha até o `forwardTxHash`. Doc: developers.circle.com/cctp/howtos/transfer-usdc-with-forwarding-service
"""

from __future__ import annotations

import math
from typing import Any, Optional

import httpx

from server.onoff import OnoffError
from server.settings import settings

CCTP = "cctp"  # nome do "provedor" do saque entre redes: executado pela carteira do usuário, sem provedor externo
ARC_DOMAIN = 26
DEST_DOMAINS = {"base": 6, "ethereum": 0}
# Standard Transfer: na Arc a attestation padrão já é rápida e o "fast" não se aplica a ela como origem.
FINALITY_STANDARD = 2000
# bytes de "cctp-forward" + versão 0 + tamanho 0 (hook estático do Forwarding Service, ver doc acima).
HOOK_DATA = "0x636374702d666f72776172640000000000000000000000000000000000000000"
USDC_DECIMALS = 6


def minor(amount: float) -> int:
    return int(round(amount * 10**USDC_DECIMALS))


async def iris_get(path: str) -> Any:
    """Único ponto de rede da Iris (os testes trocam esta função)."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{settings.onoff_iris_base}{path}")
    except httpx.HTTPError as exc:
        raise OnoffError(502, "iris_unreachable", f"Circle API unreachable: {exc}")
    if r.status_code == 404:
        return None
    if not r.is_success:
        raise OnoffError(502, "iris_error", f"Circle API error {r.status_code}")
    return r.json()


async def quote(network: str, amount_usdc: float) -> dict:
    """Cota o teto de taxa (protocolo + forward) e devolve o que o app precisa para montar o burn."""
    dest = DEST_DOMAINS[network]
    data = await iris_get(f"/v2/burn/USDC/fees/{ARC_DOMAIN}/{dest}?forward=true")
    entry = next((e for e in data or [] if e.get("finalityThreshold") == FINALITY_STANDARD), None) \
        or next((e for e in data or [] if "forwardFee" in e), None)
    if not entry:
        raise OnoffError(502, "iris_error", "no fee quote for this route")
    tiers = entry["forwardFee"]
    tier = settings.onoff_forward_fee_tier
    forward = tiers.get(tier) or tiers.get("medium") or tiers.get("high")
    if forward is None:
        raise OnoffError(502, "iris_error", "no forwarding fee in quote")
    amount_m = minor(amount_usdc)
    protocol = math.ceil(amount_m * float(entry.get("minimumFee", 0)) / 10_000)
    max_fee = int(forward) + protocol
    return {"amount_minor": amount_m, "max_fee_minor": max_fee, "burn_minor": amount_m + max_fee,
            "finality_threshold": entry["finalityThreshold"]}


def burn_params(intent, q: dict) -> dict:
    """Parâmetros para o app assinar. O app não decide nada: tudo vem daqui e é conferido depois na Iris."""
    addr = intent.dest_address.lower().removeprefix("0x")
    return {
        "token_messenger": settings.onoff_arc_token_messenger,
        "usdc": settings.arc_usdc_address,
        "source_domain": ARC_DOMAIN,
        "destination_domain": DEST_DOMAINS[intent.dest_network],
        "mint_recipient": "0x" + addr.rjust(64, "0"),
        "destination_caller": "0x" + "0" * 64,
        "burn_amount": str(q["burn_minor"]),
        "max_fee": str(q["max_fee_minor"]),
        "min_finality_threshold": q["finality_threshold"],
        "hook_data": HOOK_DATA,
    }


async def message_for(burn_tx: str) -> Optional[dict]:
    data = await iris_get(f"/v2/messages/{ARC_DOMAIN}?transactionHash={burn_tx}")
    msgs = (data or {}).get("messages") or []
    return msgs[0] if msgs else None


def burn_matches(intent, msg: dict) -> bool:
    """O burn que o app reporta tem que ser o do intent: destino, domínio e valor (valor + teto cotado)."""
    d = msg.get("decodedMessage") or {}
    b = d.get("decodedMessageBody") or {}
    try:
        got_to = "0x" + str(b.get("mintRecipient", "")).lower().removeprefix("0x")[-40:]
        want = minor(float(intent.amount_usdc) + float(intent.max_fee_usdc or 0))
        return (int(d.get("destinationDomain")) == DEST_DOMAINS[intent.dest_network]
                and got_to == intent.dest_address.lower() and int(b.get("amount")) == want)
    except (TypeError, ValueError, KeyError):
        return False
