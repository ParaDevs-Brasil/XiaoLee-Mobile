import base64
import importlib

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient
from sqlalchemy import select
from solders.pubkey import Pubkey

from database.database import get_db_session
from database.models import CampaignParticipant, NotificationEvent, User

app_module = importlib.import_module("server.app")
campaigns_module = importlib.import_module("server.campaigns_routes")

client = TestClient(app_module.app)


@pytest.fixture(autouse=True)
def _sandbox(monkeypatch):
    # Seed das campanhas de demo só existe em sandbox; o .env da raiz pode ter ARC_SANDBOX=false.
    import dataclasses

    monkeypatch.setattr(campaigns_module, "settings", dataclasses.replace(campaigns_module.settings, arc_sandbox=True))


def _build_claim_payload(
    private_key: Ed25519PrivateKey, campaign_id: int, session_token: str, label: str = "XiaoLee Devnet claim"
):
    public_key_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    wallet_public_key = str(Pubkey.from_bytes(public_key_bytes))
    proof_message = (
        f"{label}|campaign:{campaign_id}|session:{session_token}|"
        f"wallet:{wallet_public_key}|ts:1710000000000"
    )
    signature = private_key.sign(proof_message.encode("utf-8"))

    return {
        "campaign_identifier": str(campaign_id),
        "wallet_public_key": wallet_public_key,
        "wallet_signature": base64.b64encode(signature).decode("ascii"),
        "proof_message": proof_message,
        "proof_encoding": "base64",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("label", ["XiaoLee claim", "XiaoLee Devnet claim"])
async def test_claim_reward_accepts_valid_wallet_signature(db_session, label):
    session_token = "devnet_wallet_4NQYv4S8oQ5R6mD8k3mJ7b4q2x9Y1p6L2T7w8A9B"
    private_key = Ed25519PrivateKey.generate()

    await campaigns_module._seed_default_campaigns(db_session)
    user = User(twitter_handle="@claim-user", twitter_user_id=session_token)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    participant = CampaignParticipant(campaign_id=1, user_id=user.id, status="tasks_verified")
    db_session.add(participant)
    await db_session.commit()

    async def override_db_session():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = override_db_session
    try:
        response = client.post(
            "/campaigns/claim",
            json=_build_claim_payload(private_key, 1, session_token, label),
            headers={"Authorization": f"Bearer {session_token}"},
        )
    finally:
        app_module.app.dependency_overrides.pop(get_db_session, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["proof_submitted"] is True
    assert payload["claim_receipt_id"]
    assert payload["wallet_public_key"]

    async def override_db_session_for_user_campaigns():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = override_db_session_for_user_campaigns
    try:
        user_campaigns_response = client.get(
            "/campaigns/user",
            headers={"Authorization": f"Bearer {session_token}"},
        )
    finally:
        app_module.app.dependency_overrides.pop(get_db_session, None)

    assert user_campaigns_response.status_code == 200
    user_campaigns = user_campaigns_response.json()
    assert user_campaigns["success"] is True
    assert user_campaigns["campaigns"][0]["claim_receipt_id"] == payload["claim_receipt_id"]

    notification = (
        await db_session.execute(
            select(NotificationEvent).where(NotificationEvent.related_signature == payload["claim_receipt_id"])
        )
    ).scalar_one()
    assert notification.title == "Campaign reward claimed: XiaoLee Genesis Campaign"
    assert notification.status == "pending"


@pytest.mark.asyncio
async def test_claim_reward_rejects_invalid_wallet_signature(db_session):
    session_token = "devnet_wallet_2J4h8uZ6pQ5bV3nM9cL1rT7xY4wE8aF2gH6kP0s"
    private_key = Ed25519PrivateKey.generate()

    await campaigns_module._seed_default_campaigns(db_session)
    user = User(twitter_handle="@claim-user-2", twitter_user_id=session_token)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    participant = CampaignParticipant(campaign_id=1, user_id=user.id, status="tasks_verified")
    db_session.add(participant)
    await db_session.commit()

    payload = _build_claim_payload(private_key, 1, session_token)
    payload["proof_message"] = f"{payload['proof_message']}|tampered"

    async def override_db_session():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = override_db_session
    try:
        response = client.post(
            "/campaigns/claim",
            json=payload,
            headers={"Authorization": f"Bearer {session_token}"},
        )
    finally:
        app_module.app.dependency_overrides.pop(get_db_session, None)

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid wallet signature for this claim"


@pytest.mark.asyncio
async def test_campaigns_me_returns_user_campaigns(db_session):
    session_token = "devnet_wallet_7WQm1K4pB6sT9xV2nR8cL5yH3jD0fM4aZ6uE1qR"

    await campaigns_module._seed_default_campaigns(db_session)
    user = User(twitter_handle="@campaign-user", twitter_user_id=session_token)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    participant = CampaignParticipant(campaign_id=1, user_id=user.id, status="tasks_verified", claim_receipt_id="receipt-123")
    db_session.add(participant)
    await db_session.commit()

    async def override_db_session():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = override_db_session
    try:
        response = client.get(
            "/campaigns/me",
            headers={"Authorization": f"Bearer {session_token}"},
        )
    finally:
        app_module.app.dependency_overrides.pop(get_db_session, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["campaigns"][0]["claim_receipt_id"] == "receipt-123"