"""
Pedido de swap na Arc, validado antes de ir ao app.

O swap é assinado no app, com a carteira do usuário, pelo App Kit da Circle
(`@circle-fin/swap-kit`); o backend só confere o pedido e devolve os parâmetros
(`execution.swap`). Na Arc o App Kit Swap troca apenas USDC, EURC e cirBTC.
"""
from __future__ import annotations

import math
from decimal import Decimal

ARC_SWAP_TOKENS = ("USDC", "EURC", "cirBTC")
_BY_LOWER = {t.lower(): t for t in ARC_SWAP_TOKENS}


def canonical_token(raw: object) -> str | None:
    """Nome canônico do token ("usdc" -> "USDC", "CIRBTC" -> "cirBTC") ou None."""
    return _BY_LOWER.get(str(raw).strip().lower()) if isinstance(raw, str) else None


def validate_arc_swap(token_in: object, token_out: object, amount: object) -> tuple[dict | None, str | None]:
    """``({"tokenIn", "tokenOut", "amountIn"}, None)`` ou ``(None, mensagem em português)``."""
    t_in, t_out = canonical_token(token_in), canonical_token(token_out)
    if not t_in or not t_out:
        return None, f"Na Arc só dá para trocar {', '.join(ARC_SWAP_TOKENS)}."
    if t_in == t_out:
        return None, "Escolha dois tokens diferentes."
    try:
        value = float(amount)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None, "Informe um valor maior que zero."
    if not math.isfinite(value) or value <= 0:
        return None, "Informe um valor maior que zero."
    # decimal "puro" (sem notação científica), como o SDK espera
    raw = Decimal(amount.strip()) if isinstance(amount, str) else Decimal(repr(amount if isinstance(amount, int) else value))
    text = format(raw.normalize(), "f")
    return {"tokenIn": t_in, "tokenOut": t_out, "amountIn": text}, None
