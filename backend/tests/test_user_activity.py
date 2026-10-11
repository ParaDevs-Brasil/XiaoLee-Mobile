"""
test_user_activity.py — histórico consolidado que a opção "My metrics" do chat mostra.

Regras que estes testes travam:
- só conta o que é do usuário (campanhas, participações, wallets, clips de outro ficam fora);
- ganho é a soma do reward das participações pagas, por token;
- transferência Arc e CCTP casam pela wallet vinculada, sem diferenciar maiúscula do endereço;
- pagamento do agente casa pelo @ do X do onboarding (`social_links`), com ou sem `@`;
- o criador vê quanto já pagou nas campanhas dele;
- atividades recentes vêm com data, da mais nova para a mais velha;
- usuário novo recebe tudo zerado, sem erro.
"""
from __future__ import annotations

import pytest

import json

from database.models import (
    ArcTransfer,
    Campaign,
    CampaignParticipant,
    CctpTransfer,
    ChatSession,
    MediaAsset,
    MediaClip,
    SettledPayment,
    User,
    Wallet,
)
from server.user_activity import build_user_activity_summary

pytestmark = [pytest.mark.asyncio, pytest.mark.db]

ADDRESS = "0xAbC0000000000000000000000000000000000001"


async def _user(db, name: str, x_handle: str | None = None) -> User:
    user = User(
        twitter_user_id=f"privy_{name}", twitter_handle=f"privy_did:{name}",
        social_links=json.dumps({"x": x_handle}) if x_handle else None,
    )
    db.add(user)
    await db.flush()
    return user


def _campaign(name: str, creator: str, reward: float = 2.0, token: str = "USDC") -> Campaign:
    return Campaign(
        creator_twitter_user_id=creator, name=name, description="d", campaign_type="social",
        reward_token=token, reward_per_participant=reward, max_participants=10,
        reward_pool=reward * 10, status="active",
    )


async def test_usuario_novo_tem_tudo_zerado(db_session):
    user = await _user(db_session, "novo")
    summary = await build_user_activity_summary(db_session, user)

    assert summary["campaigns_created"] == {"total": 0, "paid_out": {}, "items": []}
    assert summary["campaigns_joined"]["total"] == 0
    assert summary["campaigns_joined"]["earned"] == {}
    assert summary["arc_transfers"] == {"sent": 0, "usdc_sent": 0.0}
    assert summary["chat_sessions"] == 0
    assert summary["clipper"] == {"media_uploaded": 0, "clips_ready": 0}
    assert summary["agent_payments_received"] == {"count": 0, "usdc": 0.0}
    assert summary["cctp_received"] == {"count": 0, "usdc": 0.0}
    assert summary["recent_activity"] == []
    assert summary["member_since"]


async def test_consolida_so_o_que_e_do_usuario(db_session):
    me = await _user(db_session, "eu", x_handle="@Criadora")
    other = await _user(db_session, "outro")

    mine = _campaign("minha", me.twitter_user_id, reward=5)
    paid_a = _campaign("paga-a", "creator_x", reward=2)
    paid_b = _campaign("paga-b", "creator_x", reward=3)
    pending = _campaign("pendente", "creator_x")
    others = _campaign("do-outro", other.twitter_user_id)
    db_session.add_all([mine, paid_a, paid_b, pending, others])
    await db_session.flush()

    db_session.add_all([
        CampaignParticipant(campaign_id=paid_a.id, user_id=me.id, status="paid"),
        CampaignParticipant(campaign_id=paid_b.id, user_id=me.id, status="paid"),
        CampaignParticipant(campaign_id=pending.id, user_id=me.id, status="enrolled"),
        CampaignParticipant(campaign_id=mine.id, user_id=other.id, status="tasks_verified"),
        CampaignParticipant(campaign_id=paid_a.id, user_id=other.id, status="paid"),
        SettledPayment(intent_id="i1", creator_handle="criadora", amount_usdc=0.25, tx="0xt1"),
        SettledPayment(intent_id="i2", creator_handle="@CRIADORA", amount_usdc=0.75, tx="0xt2"),
        SettledPayment(intent_id="i3", creator_handle="@outra", amount_usdc=9, tx="0xt3"),
        CctpTransfer(intent_id="c1", direction="outflow", source_domain=26, dest_domain=5,
                     counterparty=ADDRESS, amount_usdc=3, status="received"),
        CctpTransfer(intent_id="c2", direction="outflow", source_domain=26, dest_domain=5,
                     counterparty=ADDRESS, amount_usdc=50, status="attesting"),
        Wallet(user_id=me.id, address=ADDRESS, private_key_encrypted="user_managed"),
        ArcTransfer(from_address=ADDRESS.lower(), to_address="0x2", amount_usdc=1.5, tx_hash="0xaa"),
        ArcTransfer(from_address=ADDRESS, to_address="0x3", amount_usdc=2.5, tx_hash="0xbb"),
        ArcTransfer(from_address="0x9", to_address=ADDRESS, amount_usdc=100, tx_hash="0xcc"),
        ChatSession(user_id=me.id, title="a"),
        ChatSession(user_id=me.id, title="b"),
        ChatSession(user_id=other.id, title="c"),
    ])
    media = MediaAsset(
        user_id=me.id, kind="video", filename="v.mp4", content_type="video/mp4",
        size_bytes=1, r2_key="r2://v", status="transcribed",
    )
    db_session.add(media)
    await db_session.flush()
    db_session.add_all([
        MediaClip(user_id=me.id, media_id=media.id, rank=1, start_s=0, end_s=10, title="t", reason="r", status="ready"),
        MediaClip(user_id=me.id, media_id=media.id, rank=2, start_s=10, end_s=20, title="t", reason="r", status="failed"),
    ])
    await db_session.commit()

    summary = await build_user_activity_summary(db_session, me)

    created = summary["campaigns_created"]
    assert created["total"] == 1
    assert created["items"][0]["name"] == "minha"
    assert created["items"][0]["participants"] == 1
    assert created["items"][0]["paid_participants"] == 0

    joined = summary["campaigns_joined"]
    assert (joined["total"], joined["enrolled"], joined["tasks_verified"], joined["paid"]) == (3, 1, 0, 2)
    assert joined["earned"] == {"USDC": 5.0}

    assert summary["arc_transfers"] == {"sent": 2, "usdc_sent": 4.0}
    assert summary["chat_sessions"] == 2
    assert summary["clipper"] == {"media_uploaded": 1, "clips_ready": 1}
    assert summary["agent_payments_received"] == {"count": 2, "usdc": 1.0}
    assert summary["cctp_received"] == {"count": 1, "usdc": 3.0}

    recent = summary["recent_activity"]
    assert {e["type"] for e in recent} >= {"campaign_created", "campaign_joined", "reward_paid", "usdc_sent"}
    assert all(e["at"] for e in recent)
    assert [e["at"] for e in recent] == sorted((e["at"] for e in recent), reverse=True)


async def test_criador_ve_quanto_ja_pagou(db_session):
    me = await _user(db_session, "criador")
    fan = await _user(db_session, "fa")
    fan2 = await _user(db_session, "fa2")
    campaign = _campaign("minha-paga", me.twitter_user_id, reward=2.5)
    db_session.add(campaign)
    await db_session.flush()
    db_session.add_all([
        CampaignParticipant(campaign_id=campaign.id, user_id=fan.id, status="paid"),
        CampaignParticipant(campaign_id=campaign.id, user_id=fan2.id, status="enrolled"),
    ])
    await db_session.commit()

    created = (await build_user_activity_summary(db_session, me))["campaigns_created"]
    assert created["paid_out"] == {"USDC": 2.5}
    assert (created["items"][0]["participants"], created["items"][0]["paid_participants"]) == (2, 1)
