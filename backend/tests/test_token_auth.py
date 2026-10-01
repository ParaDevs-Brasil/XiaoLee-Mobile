"""
test_token_auth.py — Verificação de ID token nos logins social (Firebase / Web3Auth).

O endpoint legado `POST /auth/google/login` aceita um `address` cru do corpo da
request e emite sessão de 30 dias sem validar nada — qualquer um com `curl`
assume a identidade de payout de qualquer usuário. Estes testes fixam o
comportamento do substituto verificado.

A regra que amarra tudo: a sessão só é emitida se a assinatura do token bater
com a chave pública do provedor, e se issuer/audience/expiração forem os
esperados. Nenhum campo vindo do corpo da request é fonte de identidade.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from server import token_auth


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

FIREBASE_PROJECT = "xiaolee-mobile"
WEB3AUTH_CLIENT_ID = "web3auth-test-client-id"
PRIVY_APP_ID = "privy-test-app-id"

# Chave de assinatura do "provedor" — só existe no teste; o código sob teste a
# recebe via _signing_key_for, que é o ponto de injeção do JWKS real.
_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_ATTACKER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def _provider_config(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", FIREBASE_PROJECT)
    monkeypatch.setenv("WEB3AUTH_CLIENT_ID", WEB3AUTH_CLIENT_ID)
    monkeypatch.setenv("PRIVY_APP_ID", PRIVY_APP_ID)
    monkeypatch.setattr(token_auth, "_signing_key_for", lambda token, jwks_url: _KEY.public_key())
    token_auth.reset_config_cache()
    yield
    token_auth.reset_config_cache()


def _firebase_token(key=_KEY, **overrides: Any) -> str:
    now = int(time.time())
    claims = {
        "iss": f"https://securetoken.google.com/{FIREBASE_PROJECT}",
        "aud": FIREBASE_PROJECT,
        "sub": "firebase-uid-123",
        "iat": now,
        "exp": now + 3600,
        "email": "gustavo@example.com",
        "name": "Gustavo",
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm="RS256")


def _web3auth_token(key=_KEY, **overrides: Any) -> str:
    now = int(time.time())
    claims = {
        "iss": token_auth.WEB3AUTH_ISSUER,
        "aud": WEB3AUTH_CLIENT_ID,
        "sub": "web3auth-uid-456",
        "iat": now,
        "exp": now + 3600,
        "email": "gustavo@example.com",
        "name": "Gustavo",
        "wallets": [{"type": "solana", "public_key": "SoLaNaAddr111111111111111111111111111111111"}],
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm="RS256")


# ---------------------------------------------------------------------------
# Firebase — caminho feliz
# ---------------------------------------------------------------------------

class TestFirebaseHappyPath:
    def test_valid_token_yields_identity(self):
        ident = token_auth.verify_firebase_token(_firebase_token())
        assert ident.provider == "firebase"
        assert ident.subject == "firebase-uid-123"
        assert ident.email == "gustavo@example.com"
        assert ident.name == "Gustavo"

    def test_identity_survives_missing_optional_claims(self):
        """email/name são opcionais no Firebase (login anônimo, telefone)."""
        ident = token_auth.verify_firebase_token(_firebase_token(email=None, name=None))
        assert ident.subject == "firebase-uid-123"
        assert ident.email == ""
        assert ident.name == ""


# ---------------------------------------------------------------------------
# Firebase — o que precisa ser rejeitado
# ---------------------------------------------------------------------------

class TestFirebaseRejections:
    def test_signature_from_another_key_is_rejected(self):
        """O ataque real: atacante forja o payload e assina com a chave dele."""
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_firebase_token(_firebase_token(key=_ATTACKER_KEY))

    def test_token_from_another_firebase_project_is_rejected(self):
        """Qualquer um cria um projeto Firebase; o aud é o que amarra ao nosso."""
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_firebase_token(
                _firebase_token(aud="projeto-do-atacante", iss="https://securetoken.google.com/projeto-do-atacante")
            )

    def test_wrong_issuer_is_rejected(self):
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_firebase_token(_firebase_token(iss="https://evil.example.com"))

    def test_expired_token_is_rejected(self):
        now = int(time.time())
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_firebase_token(_firebase_token(iat=now - 7200, exp=now - 3600))

    def test_alg_none_is_rejected(self):
        """Confusão de algoritmo: token sem assinatura passando por válido."""
        unsigned = jwt.encode(
            {
                "iss": f"https://securetoken.google.com/{FIREBASE_PROJECT}",
                "aud": FIREBASE_PROJECT,
                "sub": "firebase-uid-123",
                "exp": int(time.time()) + 3600,
            },
            key=None,
            algorithm="none",
        )
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_firebase_token(unsigned)

    def test_hmac_signed_with_public_key_is_rejected(self):
        """Confusão RS256->HS256: assina com a chave *pública* usada como segredo.

        Montado byte a byte de propósito: o PyJWT se recusa a *gerar* esse token
        (InvalidKeyError), mas o atacante não usa PyJWT — ele monta o JWT na mão.
        O que precisa valer é que a nossa verificação recuse.
        """
        pub_pem = _KEY.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        payload = _b64url(
            json.dumps(
                {
                    "iss": f"https://securetoken.google.com/{FIREBASE_PROJECT}",
                    "aud": FIREBASE_PROJECT,
                    "sub": "firebase-uid-123",
                    "iat": int(time.time()),
                    "exp": int(time.time()) + 3600,
                }
            ).encode()
        )
        signing_input = f"{header}.{payload}".encode()
        signature = _b64url(hmac.new(pub_pem, signing_input, hashlib.sha256).digest())
        forged = f"{header}.{payload}.{signature}"

        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_firebase_token(forged)

    @pytest.mark.parametrize("bad", ["", "   ", "not-a-jwt", "a.b.c"])
    def test_malformed_token_is_rejected(self, bad):
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_firebase_token(bad)

    def test_token_without_subject_is_rejected(self):
        """Sem sub não há identidade — não inventar uma a partir do email."""
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_firebase_token(_firebase_token(sub=None))


# ---------------------------------------------------------------------------
# Web3Auth — o address precisa vir do token, não do corpo da request
# ---------------------------------------------------------------------------

class TestWeb3Auth:
    def test_valid_token_yields_address_from_wallets_claim(self):
        ident = token_auth.verify_web3auth_token(_web3auth_token())
        assert ident.provider == "web3auth"
        assert ident.subject == "web3auth-uid-456"
        assert ident.address == "SoLaNaAddr111111111111111111111111111111111"

    def test_forged_signature_is_rejected(self):
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_web3auth_token(_web3auth_token(key=_ATTACKER_KEY))

    def test_wrong_audience_is_rejected(self):
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_web3auth_token(_web3auth_token(aud="outro-client-id"))

    def test_token_without_wallets_is_rejected(self):
        """Sem wallet no token não dá para saber o endereço de payout."""
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_web3auth_token(_web3auth_token(wallets=[]))

    def test_expired_token_is_rejected(self):
        now = int(time.time())
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_web3auth_token(_web3auth_token(iat=now - 7200, exp=now - 3600))


# ---------------------------------------------------------------------------
# Configuração ausente — fail closed, nunca fail open
# ---------------------------------------------------------------------------

class TestFailClosed:
    def test_missing_firebase_project_id_refuses_to_verify(self, monkeypatch):
        monkeypatch.delenv("FIREBASE_PROJECT_ID", raising=False)
        token_auth.reset_config_cache()
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_firebase_token(_firebase_token())

    def test_missing_web3auth_client_id_refuses_to_verify(self, monkeypatch):
        monkeypatch.delenv("WEB3AUTH_CLIENT_ID", raising=False)
        token_auth.reset_config_cache()
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_web3auth_token(_web3auth_token())


# ---------------------------------------------------------------------------
# Privy — access token (só DID em `sub`; sem email/wallet)
# ---------------------------------------------------------------------------

def _privy_token(key=_KEY, **overrides: Any) -> str:
    now = int(time.time())
    claims = {"iss": "privy.io", "aud": PRIVY_APP_ID, "sub": "did:privy:abc123", "iat": now, "exp": now + 3600}
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm="RS256")


class TestPrivy:
    def test_valid_token_yields_identity(self):
        ident = token_auth.verify_privy_token(_privy_token())
        assert (ident.provider, ident.subject, ident.address) == ("privy", "did:privy:abc123", "")

    @pytest.mark.parametrize("bad", [
        {"key": _ATTACKER_KEY},
        {"aud": "outro-app"},
        {"iss": "evil.example.com"},
        {"iat": int(time.time()) - 7200, "exp": int(time.time()) - 3600},
    ])
    def test_invalid_tokens_are_rejected(self, bad):
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_privy_token(_privy_token(**bad))

    def test_missing_app_id_fails_closed(self, monkeypatch):
        monkeypatch.delenv("PRIVY_APP_ID", raising=False)
        with pytest.raises(token_auth.TokenVerificationError):
            token_auth.verify_privy_token(_privy_token())
