"""
Histórico consolidado do usuário na plataforma (S2, XIAOLEEACE-20).

É o que a opção "My metrics" do menu do chat mostra: o que a pessoa já fez —
campanhas criadas e em que participou, quanto ganhou, USDC enviado pelo Arc,
conversas e Clipper. Lê só tabelas que hoje são escritas; `SwapHistory` fica de
fora porque nada grava nela desde a era Stellar.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import (
    ArcTransfer,
    Campaign,
    CampaignParticipant,
    ChatSession,
    MediaAsset,
    MediaClip,
    User,
    Wallet,
)


async def build_user_activity_summary(db: AsyncSession, user: User) -> dict:
    created_res = await db.execute(
        select(Campaign.id, Campaign.name, Campaign.status, Campaign.reward_pool, Campaign.reward_token)
        .where(Campaign.creator_twitter_user_id == user.twitter_user_id)
        .order_by(Campaign.id.desc())
    )
    created = created_res.all()
    created_ids = [row.id for row in created]
    participants_by_campaign: dict[int, int] = {}
    if created_ids:
        counts_res = await db.execute(
            select(CampaignParticipant.campaign_id, func.count(CampaignParticipant.id))
            .where(CampaignParticipant.campaign_id.in_(created_ids))
            .group_by(CampaignParticipant.campaign_id)
        )
        participants_by_campaign = dict(counts_res.all())

    joined_res = await db.execute(
        select(CampaignParticipant.status, Campaign.reward_per_participant, Campaign.reward_token)
        .join(Campaign, Campaign.id == CampaignParticipant.campaign_id)
        .where(CampaignParticipant.user_id == user.id)
    )
    joined_by_status: dict[str, int] = defaultdict(int)
    earned: dict[str, float] = defaultdict(float)
    for status, reward, token in joined_res.all():
        joined_by_status[status] += 1
        if status == "paid":
            earned[token] += float(reward)

    # ArcTransfer é indexada por endereço (a rota de relay é pública); a ponte
    # para o usuário são as wallets vinculadas a ele.
    addresses_res = await db.execute(select(Wallet.address).where(Wallet.user_id == user.id))
    addresses = [a.lower() for a in addresses_res.scalars().all() if a]
    transfers_count, transfers_usdc = 0, 0.0
    if addresses:
        transfers_res = await db.execute(
            select(func.count(ArcTransfer.id), func.coalesce(func.sum(ArcTransfer.amount_usdc), 0))
            .where(func.lower(ArcTransfer.from_address).in_(addresses))
        )
        transfers_count, transfers_usdc = transfers_res.one()

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

    member_since = user.created_at
    if member_since and member_since.tzinfo is None:
        member_since = member_since.replace(tzinfo=timezone.utc)

    return {
        "member_since": member_since.isoformat() if member_since else None,
        "campaigns_created": {
            "total": len(created),
            "items": [
                {
                    "id": row.id,
                    "name": row.name,
                    "status": row.status,
                    "reward_pool": float(row.reward_pool),
                    "reward_token": row.reward_token,
                    "participants": participants_by_campaign.get(row.id, 0),
                }
                for row in created
            ],
        },
        "campaigns_joined": {
            "total": sum(joined_by_status.values()),
            "enrolled": joined_by_status["enrolled"],
            "tasks_verified": joined_by_status["tasks_verified"],
            "paid": joined_by_status["paid"],
            "earned": {token: round(amount, 8) for token, amount in earned.items()},
        },
        "arc_transfers": {"sent": int(transfers_count), "usdc_sent": round(float(transfers_usdc), 8)},
        "chat_sessions": int(chat_sessions),
        "clipper": {"media_uploaded": int(media_uploaded), "clips_ready": int(clips_ready)},
    }
