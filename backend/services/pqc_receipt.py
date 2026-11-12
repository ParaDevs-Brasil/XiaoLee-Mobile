"""
pqc_receipt.py — Assinatura pós-quântica de recibos de pagamento (ML-DSA-87).

ALGORITMO: ML-DSA-87 (FIPS 204) — nível de segurança equivalente a AES-256.
BIBLIOTECA: dilithium-py (implementação pure-Python, zero deps nativas).
CAMPO:      receipt_pqc no PaymentIntent — o contrato está congelado desde
            creator_pay_tools.py, agora recebe assinatura real em vez de intent_id.

PAYLOAD CANÔNICO (o que é assinado):
    {
      "v": 1,
      "algo": "ML-DSA-87",
      "intent_id": "...",
      "to": "0x...",
      "amount_usdc": "5.000000",
      "arc_tx_hash": "0x...",
      "ts": 1719000000
    }
    → JSON com chaves ordenadas, sem espaços → bytes UTF-8 → assinado com sk

FORMATO DO receipt_pqc:
    base64(signature).base64(canonical_payload)
    Os dois campos separados por '.' permitem verificação independente.

GESTÃO DE CHAVES:
    Geração: python3 -c "from services.pqc_receipt import generate_keypair; generate_keypair()"
    Private: PQC_SECRET_KEY (base64, env var — nunca commitar)
    Public:  PQC_PUBLIC_KEY (base64, env var ou docs/pqc_public_key.b64 no repo)

TAMANHOS ML-DSA-87:
    public key:  2592 bytes
    secret key:  4896 bytes
    signature:   4627 bytes
    payload:     ~160 bytes (JSON canônico)
    receipt_pqc: ~6900 bytes base64 (cabe em TEXT SQL)

VERIFICAÇÃO INDEPENDENTE (qualquer um pode rodar):
    from services.pqc_receipt import verify_receipt
    valid = verify_receipt(receipt_pqc_string)
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from functools import lru_cache
from typing import Optional

LOG = logging.getLogger(__name__)

_ALGO = "ML-DSA-87"
_V    = 1


# ──────────────────────────────────────────────────────────────────────────────
# Keypair loading (lazy, cached)
# ──────────────────────────────────────────────────────────────────────────────

def _b64d(s: str) -> bytes:
    return base64.b64decode(s)


def _b64e(b: bytes) -> str:
    return base64.b64encode(b).decode()


def require_persistent_key() -> bool:
    """Serviços que cobram dinheiro real ligam isto: sem par permanente, não sobe (fail-closed)."""
    return os.getenv("PQC_REQUIRE_PERSISTENT_KEY", "").strip().lower() in ("1", "true", "yes")


def assert_ready() -> None:
    """Chamado no boot: com PQC_REQUIRE_PERSISTENT_KEY, falha antes de aceitar qualquer pagamento."""
    if require_persistent_key():
        _load_keypair()


@lru_cache(maxsize=1)
def _load_keypair() -> tuple[bytes, bytes]:
    """
    Carrega (pk, sk) de variáveis de ambiente.
    Gera um novo keypair efêmero se PQC_SECRET_KEY não estiver configurado
    (sandbox / dev) e loga warning — nunca falha silenciosamente.
    """
    try:
        from dilithium_py.ml_dsa import ML_DSA_87
    except ImportError:
        raise RuntimeError(
            "dilithium-py não instalado. Rode: pip install dilithium-py"
        )

    sk_b64 = os.getenv("PQC_SECRET_KEY", "")
    pk_b64 = os.getenv("PQC_PUBLIC_KEY", "")

    if sk_b64 and pk_b64:
        sk = _b64d(sk_b64)
        pk = _b64d(pk_b64)
        if require_persistent_key():
            # par que não casa = recibos que ninguém consegue verificar; melhor falhar no boot
            probe = b"pqc-key-selfcheck"
            try:
                ok = ML_DSA_87.verify(pk, probe, ML_DSA_87.sign(sk, probe))
            except Exception as exc:  # chave truncada/corrompida
                raise RuntimeError(f"PQC keypair inválido: {exc}") from exc
            if not ok:
                raise RuntimeError("PQC_PUBLIC_KEY não corresponde a PQC_SECRET_KEY")
        LOG.info("[pqc] ML-DSA-87 keys loaded from env pk_len=%d sk_len=%d", len(pk), len(sk))
        return pk, sk

    if require_persistent_key():
        raise RuntimeError(
            "PQC_REQUIRE_PERSISTENT_KEY=true mas PQC_SECRET_KEY/PQC_PUBLIC_KEY não estão ambos definidos "
            "(recusando keypair efêmero: recibos não seriam verificáveis após restart)"
        )

    if sk_b64 and not pk_b64:
        # Deriva pk do sk não é diretamente suportado — regenera o par é seguro aqui
        # (sk_b64 sem pk_b64 é um misconfiguration; melhor avisar)
        LOG.warning("[pqc] PQC_SECRET_KEY definido mas PQC_PUBLIC_KEY ausente — gerando par efêmero")

    # Ephemeral keypair — dev/sandbox
    pk, sk = ML_DSA_87.keygen()
    LOG.warning(
        "[pqc] ATENÇÃO: usando keypair EFÊMERO (PQC_SECRET_KEY não configurado). "
        "Assinaturas não serão verificáveis após restart. "
        "Gere um par permanente com: python3 -c \"from services.pqc_receipt import generate_keypair; generate_keypair()\""
    )
    return pk, sk


def public_key_b64() -> str:
    """Retorna a public key em base64 — publicar no repo para verificação independente."""
    pk, _ = _load_keypair()
    return _b64e(pk)


# ──────────────────────────────────────────────────────────────────────────────
# Canonical payload
# ──────────────────────────────────────────────────────────────────────────────

def _canonical(
    intent_id:    str,
    to:           str,
    amount_usdc:  float,
    arc_tx_hash:  str,
    ts:           Optional[int] = None,
) -> bytes:
    """Serialização determinística — chaves ordenadas, sem espaços."""
    payload = {
        "algo":         _ALGO,
        "amount_usdc":  f"{amount_usdc:.6f}",
        "arc_tx_hash":  arc_tx_hash.lower(),
        "intent_id":    intent_id,
        "to":           to.lower(),
        "ts":           ts if ts is not None else int(time.time()),
        "v":            _V,
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


# ──────────────────────────────────────────────────────────────────────────────
# Sign
# ──────────────────────────────────────────────────────────────────────────────

def sign_receipt(
    intent_id:    str,
    to:           str,
    amount_usdc:  float,
    arc_tx_hash:  str,
    ts:           Optional[int] = None,
) -> str:
    """
    Assina o recibo com ML-DSA-87 e retorna o receipt_pqc.

    Formato: "<sig_b64>.<payload_b64>"
    Ambas as partes são necessárias para verificação independente.

    Nunca levanta exceção — em caso de falha retorna intent_id como fallback
    para que o pagamento nunca seja bloqueado por um erro de PQC.
    """
    try:
        from dilithium_py.ml_dsa import ML_DSA_87
        pk, sk = _load_keypair()

        payload_bytes = _canonical(intent_id, to, amount_usdc, arc_tx_hash, ts)
        sig           = ML_DSA_87.sign(sk, payload_bytes)

        receipt = f"{_b64e(sig)}.{_b64e(payload_bytes)}"
        LOG.info(
            "[pqc] receipt signed intent_id=%s to=%s amount=%.4f sig_len=%d",
            intent_id, to, amount_usdc, len(sig),
        )
        return receipt

    except Exception as exc:
        LOG.error("[pqc] sign failed for intent_id=%s — fallback to intent_id: %s", intent_id, exc)
        return intent_id   # contrato: o campo nunca fica vazio


# ──────────────────────────────────────────────────────────────────────────────
# Verify
# ──────────────────────────────────────────────────────────────────────────────

def verify_receipt(receipt_pqc: str, public_key_b64_override: str = "") -> dict:
    """
    Verifica um receipt_pqc e retorna um dict com o resultado.

    Aceita o formato "<sig_b64>.<payload_b64>" gerado por sign_receipt.
    Se public_key_b64_override for fornecido, usa essa pk em vez da do env.

    Retorna:
        {
          "valid":       bool,
          "payload":     dict | None,   # payload decodificado se válido
          "error":       str | None,    # motivo da falha se inválido
          "algo":        "ML-DSA-87",
          "verified_with": "env" | "override",
        }
    """
    try:
        from dilithium_py.ml_dsa import ML_DSA_87
    except ImportError:
        return {
            "valid": False,
            "payload": None,
            "error": "dilithium-py não instalado",
            "algo": _ALGO,
            "verified_with": None,
        }

    if "." not in receipt_pqc:
        return {
            "valid":  False,
            "payload": None,
            "error":  "formato inválido: esperado <sig_b64>.<payload_b64>",
            "algo":   _ALGO,
            "verified_with": None,
        }

    try:
        sig_b64, payload_b64 = receipt_pqc.split(".", 1)
        sig_bytes     = _b64d(sig_b64)
        payload_bytes = _b64d(payload_b64)
    except Exception as exc:
        return {
            "valid":  False,
            "payload": None,
            "error":  f"decodificação base64 falhou: {exc}",
            "algo":   _ALGO,
            "verified_with": None,
        }

    if public_key_b64_override:
        pk             = _b64d(public_key_b64_override)
        verified_with  = "override"
    else:
        pk, _ = _load_keypair()
        verified_with  = "env"

    try:
        valid = ML_DSA_87.verify(pk, payload_bytes, sig_bytes)
    except Exception as exc:
        return {
            "valid":  False,
            "payload": None,
            "error":  f"verificação ML-DSA-87 falhou: {exc}",
            "algo":   _ALGO,
            "verified_with": verified_with,
        }

    if not valid:
        return {
            "valid":  False,
            "payload": None,
            "error":  "assinatura inválida",
            "algo":   _ALGO,
            "verified_with": verified_with,
        }

    try:
        payload_dict = json.loads(payload_bytes.decode())
    except Exception:
        payload_dict = None

    return {
        "valid":         True,
        "payload":       payload_dict,
        "error":         None,
        "algo":          _ALGO,
        "verified_with": verified_with,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Keygen utilitário (CLI)
# ──────────────────────────────────────────────────────────────────────────────

def generate_keypair() -> None:
    """
    Gera e imprime um novo keypair ML-DSA-87.

    Uso (uma única vez):
        python3 -c "from services.pqc_receipt import generate_keypair; generate_keypair()"

    Copie os valores para .env e para docs/pqc_public_key.b64 (a pk pode ser pública).
    NUNCA commite a PQC_SECRET_KEY.
    """
    try:
        from dilithium_py.ml_dsa import ML_DSA_87
    except ImportError:
        print("ERRO: instale dilithium-py primeiro: pip install dilithium-py")
        return

    pk, sk = ML_DSA_87.keygen()
    pk_b64 = _b64e(pk)
    sk_b64 = _b64e(sk)

    print(f"\n{'='*60}")
    print("  ML-DSA-87 KEYPAIR — XIAOLEE RECEIPT SIGNER")
    print(f"{'='*60}")
    print(f"\nPQC_PUBLIC_KEY={pk_b64}")
    print(f"\nPQC_SECRET_KEY={sk_b64}")
    print(f"\n  PUBLIC KEY len={len(pk)} bytes  → salve em .env E em docs/pqc_public_key.b64")
    print(f"  SECRET KEY len={len(sk)} bytes  → salve SOMENTE em .env e no vault")
    print(f"\nAVISO: a secret key nunca deve aparecer em logs, git ou UI.")
    print(f"{'='*60}\n")
