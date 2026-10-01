"""
token_auth.py — Verificação de ID token dos provedores de login social.

O login social só é confiável se o backend validar a **assinatura** do token
contra a chave pública do provedor. O endpoint legado `/auth/google/login`
aceita `address` cru do corpo da request, então qualquer um com `curl` emite
sessão em nome de qualquer usuário — este módulo é o substituto.

Regra: nenhum campo do corpo da request é fonte de identidade. Subject, email
e endereço de payout saem todos de dentro do token verificado.

A busca de chave usa `PyJWKClient`, que já resolve cache e rotação de chave do
JWKS — não vale a pena reimplementar isso à mão num caminho de segurança.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

import jwt
from jwt import PyJWKClient

# JWKS em formato padrão (o endpoint x509 do Firebase não serve para PyJWKClient).
FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
FIREBASE_ISSUER_PREFIX = "https://securetoken.google.com/"

WEB3AUTH_JWKS_URL = "https://api-auth.web3auth.io/jwks"
WEB3AUTH_ISSUER = "https://api-auth.web3auth.io"

# Só assimétricos. Deixar HS* na lista permitiria assinar com a chave pública
# como se fosse segredo compartilhado (confusão RS256->HS256).
_ALGORITHMS = ["RS256", "ES256"]


class TokenVerificationError(Exception):
    """Token ausente, malformado, expirado, ou não emitido para este projeto."""


@dataclass(frozen=True)
class VerifiedIdentity:
    provider: str
    subject: str
    email: str
    name: str
    address: str


@lru_cache(maxsize=4)
def _jwk_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url, cache_keys=True)


def _signing_key_for(token: str, jwks_url: str):
    """Chave pública que assinou o token. Isolado para os testes injetarem a sua."""
    return _jwk_client(jwks_url).get_signing_key_from_jwt(token).key


def reset_config_cache() -> None:
    """Descarta o cache de config/JWKS — usado pelos testes ao trocar env vars."""
    _jwk_client.cache_clear()


def _required_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        # Fail closed: sem saber para qual projeto o token deveria ter sido
        # emitido, "verificar" não significa nada.
        raise TokenVerificationError(f"{name} não configurado — login social desabilitado")
    return value


def _decode(token: str, *, jwks_url: str, issuer: str, audience: str) -> dict:
    if not token or not token.strip():
        raise TokenVerificationError("token ausente")
    try:
        key = _signing_key_for(token, jwks_url)
        return jwt.decode(
            token,
            key,
            algorithms=_ALGORITHMS,
            issuer=issuer,
            audience=audience,
            options={"require": ["exp", "iat", "sub"], "verify_signature": True},
        )
    except TokenVerificationError:
        raise
    except Exception as exc:  # PyJWKClientError, InvalidTokenError, e afins
        raise TokenVerificationError(f"token inválido: {exc}") from exc


def verify_firebase_token(token: str) -> VerifiedIdentity:
    """Valida um ID token do Firebase Auth (mobile) e extrai a identidade."""
    project_id = _required_env("FIREBASE_PROJECT_ID")
    claims = _decode(
        token,
        jwks_url=FIREBASE_JWKS_URL,
        issuer=f"{FIREBASE_ISSUER_PREFIX}{project_id}",
        audience=project_id,
    )
    subject = (claims.get("sub") or "").strip()
    if not subject:
        raise TokenVerificationError("token sem sub")
    return VerifiedIdentity(
        provider="firebase",
        subject=subject,
        email=(claims.get("email") or "").strip(),
        name=(claims.get("name") or "").strip(),
        address="",  # Firebase não carrega wallet; o backend deriva/associa depois.
    )


def verify_privy_token(token: str) -> VerifiedIdentity:
    """Valida o access token do Privy (`getAccessToken()` no mobile).

    O access token só carrega o DID (`sub`); email/wallet ficam vazios e o
    backend associa depois, como no Firebase.
    """
    app_id = _required_env("PRIVY_APP_ID")
    claims = _decode(
        token,
        jwks_url=f"https://auth.privy.io/api/v1/apps/{app_id}/jwks.json",
        issuer="privy.io",
        audience=app_id,
    )
    subject = (claims.get("sub") or "").strip()
    if not subject:
        raise TokenVerificationError("token sem sub")
    return VerifiedIdentity(provider="privy", subject=subject, email="", name="", address="")


def _address_from_wallets(claims: dict) -> str:
    """Endereço de payout declarado pelo Web3Auth dentro do token."""
    for wallet in claims.get("wallets") or []:
        if not isinstance(wallet, dict):
            continue
        address = (wallet.get("public_key") or wallet.get("address") or "").strip()
        if address:
            return address
    raise TokenVerificationError("token sem wallet")


def verify_web3auth_token(token: str) -> VerifiedIdentity:
    """Valida um JWT do Web3Auth (`authenticateUser()` no frontend)."""
    client_id = _required_env("WEB3AUTH_CLIENT_ID")
    claims = _decode(
        token,
        jwks_url=WEB3AUTH_JWKS_URL,
        issuer=WEB3AUTH_ISSUER,
        audience=client_id,
    )
    subject = (claims.get("sub") or "").strip()
    if not subject:
        raise TokenVerificationError("token sem sub")
    return VerifiedIdentity(
        provider="web3auth",
        subject=subject,
        email=(claims.get("email") or "").strip(),
        name=(claims.get("name") or "").strip(),
        address=_address_from_wallets(claims),
    )
