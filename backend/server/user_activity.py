"""
Histórico consolidado do usuário na plataforma (S2, XIAOLEEACE-20).

É o que a opção "My metrics" do menu do chat mostra: o que a pessoa já fez —
campanhas criadas (e quanto já pagou nelas), campanhas em que participou e
quanto ganhou, USDC que o agente pagou a ela, transferências, conversas e
Clipper — mais uma lista das atividades recentes com data. Lê só tabelas que
hoje são escritas; `SwapHistory` fica de fora porque nada grava nela desde a era
Stellar.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

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

RECENT_LIMIT = 10


def _iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _x_handles(user: User) -> set[str]:
    """Handles do X do usuário, normalizados sem `@` e em minúsculas.

    O agente paga criadores pelo @ do X (`SettledPayment.creator_handle`). Quem
    entra pelo app tem `twitter_handle` interno (`privy_did:…`); o @ real fica em
    `social_links`, preenchido no onboarding.
    """
    handles = {user.twitter_handle} if user.twitter_handle else set()
    if user.social_links:
        try:
            links = json.loads(user.social_links)
        except ValueError:
            links = {}
        handles |= {links[k] for k in ("x", "twitter") if links.get(k)}
    return {h.strip().lstrip("@").lower() for h in handles if h and h.strip().lstrip("@")}


async def build_user_activity_summary(db: AsyncSession, user: User) -> dict:
    recent: list[dict] = []

    # ── Campanhas criadas, com quantos participantes e quanto já pagou ────────
    created_res = await db.execute(
        select(Campaign).where(Campaign.creator_twitter_user_id == user.twitter_user_id).order_by(Campaign.id.desc())
    )
    created = created_res.scalars().all()
    created_ids = [c.id for c in created]
    participants: dict[int, int] = defaultdict(int)
    paid_participants: dict[int, int] = defaultdict(int)
    if created_ids:
        counts_res = await db.execute(
            select(CampaignParticipant.campaign_id, CampaignParticipant.status, func.count(CampaignParticipant.id))
            .where(CampaignParticipant.campaign_id.in_(created_ids))
            .group_by(CampaignParticipant.campaign_id, CampaignParticipant.status)
        )
        for campaign_id, status, count in counts_res.all():
            participants[campaign_id] += count
            if status == "paid":
                paid_participants[campaign_id] += count

    paid_out: dict[str, float] = defaultdict(float)
    for campaign in created:
        paid_out[campaign.reward_token] += paid_participants[campaign.id] * float(campaign.reward_per_participant)
        recent.append({"type": "campaign_created", "at": _iso(campaign.created_at), "campaign": campaign.name})

    # ── Participações e ganhos ────────────────────────────────────────────────
    joined_res = await db.execute(
        select(CampaignParticipant, Campaign)
        .join(Campaign, Campaign.id == CampaignParticipant.campaign_id)
        .where(CampaignParticipant.user_id == user.id)
    )
    joined_by_status: dict[str, int] = defaultdict(int)
    earned: dict[str, float] = defaultdict(float)
    for participant, campaign in joined_res.all():
        joined_by_status[participant.status] += 1
        recent.append({
            "type": "campaign_joined", "at": _iso(participant.joined_at),
            "campaign": campaign.name, "status": participant.status,
        })
        if participant.status == "paid":
            earned[campaign.reward_token] += float(campaign.reward_per_participant)
            recent.append({
                "type": "reward_paid", "at": _iso(participant.updated_at), "campaign": campaign.name,
                "amount": float(campaign.reward_per_participant), "token": campaign.reward_token,
            })

    # ── Pagamentos que o agente fez a este criador (x402 / nanopayment) ───────
    agent_paid_count, agent_paid_usdc = 0, 0.0
    handles = _x_handles(user)
    if handles:
        settled_res = await db.execute(
            select(SettledPayment).where(
                func.lower(func.ltrim(SettledPayment.creator_handle, "@")).in_(handles)
            )
        )
        for payment in settled_res.scalars().all():
            agent_paid_count += 1
            agent_paid_usdc += float(payment.amount_usdc)
            recent.append({"type": "agent_payment_received", "at": _iso(payment.settled_at), "amount": float(payment.amount_usdc)})

    # ── Transferências: Arc enviadas e CCTP recebidas, pelas wallets vinculadas ─
    # ArcTransfer/CctpTransfer são indexadas por endereço (as rotas são públicas
    # ou do agente); a ponte para o usuário são as wallets vinculadas a ele.
    addresses_res = await db.execute(select(Wallet.address).where(Wallet.user_id == user.id))
    addresses = [a.lower() for a in addresses_res.scalars().all() if a]
    transfers_count, transfers_usdc = 0, 0.0
    cctp_count, cctp_usdc = 0, 0.0
    if addresses:
        arc_res = await db.execute(select(ArcTransfer).where(func.lower(ArcTransfer.from_address).in_(addresses)))
        for transfer in arc_res.scalars().all():
            transfers_count += 1
            transfers_usdc += float(transfer.amount_usdc)
            recent.append({"type": "usdc_sent", "at": _iso(transfer.created_at), "amount": float(transfer.amount_usdc)})

        cctp_res = await db.execute(
            select(CctpTransfer).where(
                func.lower(CctpTransfer.counterparty).in_(addresses), CctpTransfer.status == "received",
            )
        )
        for transfer in cctp_res.scalars().all():
            cctp_count += 1
            cctp_usdc += float(transfer.amount_usdc)
            recent.append({
                "type": "cctp_received", "at": _iso(transfer.executed_at or transfer.created_at),
                "amount": float(transfer.amount_usdc),
            })

    # ── Chat e Clipper ────────────────────────────────────────────────────────
    chat_sessions = (
        await db.execute(select(func.count(ChatSession.id)).where(ChatSession.user_id == user.id))
    ).scalar() or 0
    media_uploaded = (
        await db.execute(select(func.count(MediaAsset.id)).where(MediaAsset.user_id == user.id))
    ).scalar() or 0
    clips_ready = (
        await db.execute(
            select(func.count(MediaClip.id)).where(MediaClip.user_id == user.id, MediaClip.status == "ready")
        )
    ).scalar() or 0

    recent.sort(key=lambda event: event["at"] or "", reverse=True)

    return {
        "member_since": _iso(user.created_at),
        "campaigns_created": {
            "total": len(created),
            "paid_out": {token: round(amount, 8) for token, amount in paid_out.items() if amount},
            "items": [
                {
                    "id": c.id,
                    "name": c.name,
                    "status": c.status,
                    "reward_pool": float(c.reward_pool),
                    "reward_token": c.reward_token,
                    "participants": participants[c.id],
                    "paid_participants": paid_participants[c.id],
                }
                for c in created
            ],
        },
        "campaigns_joined": {
            "total": sum(joined_by_status.values()),
            "enrolled": joined_by_status["enrolled"],
            "tasks_verified": joined_by_status["tasks_verified"],
            "paid": joined_by_status["paid"],
            "earned": {token: round(amount, 8) for token, amount in earned.items()},
        },
        "agent_payments_received": {"count": agent_paid_count, "usdc": round(agent_paid_usdc, 8)},
        "arc_transfers": {"sent": transfers_count, "usdc_sent": round(transfers_usdc, 8)},
        "cctp_received": {"count": cctp_count, "usdc": round(cctp_usdc, 8)},
        "chat_sessions": int(chat_sessions),
        "clipper": {"media_uploaded": int(media_uploaded), "clips_ready": int(clips_ready)},
        "recent_activity": recent[:RECENT_LIMIT],
    }
