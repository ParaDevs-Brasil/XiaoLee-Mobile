"""
Campaign task verifier — real on-chain and social proof for campaign rewards.

Verification logic by campaign type:
  social   → Twitter API v2 (app-only Bearer): retweet verified; follow best-effort
              (Twitter v2 app-only Bearer cannot enumerate a user's followings)
  trading  → Helius: wallet has ≥1 successful SWAP transaction
  referral → DB: ≥3 other participants enrolled in the same campaign (proxy metric;
              proper referral codes are a future feature)
"""
from __future__ import annotations

import logging
from typing import Tuple, Optional

import aiohttp

LOG = logging.getLogger(__name__)

_TWITTER_BASE = "https://api.twitter.com/2"
_HELIUS_BASE = "https://api.helius.xyz/v0"
_HTTP_TIMEOUT = aiohttp.ClientTimeout(total=8)


async def _twitter_get(path: str, bearer: str) -> Optional[dict]:
    headers = {"Authorization": f"Bearer {bearer}"}
    try:
        async with aiohttp.ClientSession(timeout=_HTTP_TIMEOUT) as session:
            async with session.get(f"{_TWITTER_BASE}{path}", headers=headers) as resp:
                if resp.status == 200:
                    return await resp.json()
                LOG.warning("[campaign/verify] Twitter API %s → HTTP %d", path, resp.status)
                return None
    except Exception as exc:
        LOG.warning("[campaign/verify] Twitter API error: %s", exc)
        return None


async def _helius_get(path: str, api_key: str, **params) -> Optional[list]:
    params["api-key"] = api_key
    url = f"{_HELIUS_BASE}{path}"
    try:
        async with aiohttp.ClientSession(timeout=_HTTP_TIMEOUT) as session:
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    return await resp.json()
                LOG.warning("[campaign/verify] Helius API %s → HTTP %d", path, resp.status)
                return None
    except Exception as exc:
        LOG.warning("[campaign/verify] Helius API error: %s", exc)
        return None


async def verify_social(
    twitter_user_id: str,
    profile_to_follow: Optional[str],
    tweet_id_to_engage: Optional[str],
    bearer_token: str,
    strict: bool = False,
) -> Tuple[bool, str]:
    """
    Verifies social tasks via Twitter API v2 (app-only Bearer token).

    Retweet: checked against /tweets/:id/retweeted_by (supported with app-only auth).
    Follow:  not available with app-only Bearer token — accepted with audit log if
             retweet check passed (or no tweet required by the campaign).

    Non-Twitter users (Telegram/Google) skip the API check: their identity is already
    authenticated via Bearer session in _resolve_user.

    ``strict`` (dinheiro real): nada é aceito "de boa fé" — sem token, sem conta X, API fora
    do ar ou follow que a API não consegue conferir viram recusa.
    """
    if strict and not bearer_token:
        return False, "Social verification is unavailable right now; try again later."
    if not bearer_token:
        LOG.warning("[campaign/verify] X_BEARER_TOKEN not configured — accepting social task on good faith")
        return True, "Twitter API not configured; accepted"

    # Only real Twitter users have a numeric twitter_user_id
    if not twitter_user_id.isdigit():
        if strict:
            return False, "Connect your X account to complete social tasks."
        LOG.info("[campaign/verify] Non-Twitter user %s — social task accepted for custodial account", twitter_user_id)
        return True, "Social task verified for custodial account"

    # Retweet verification — available with app-only Bearer token
    if tweet_id_to_engage:
        data = await _twitter_get(
            f"/tweets/{tweet_id_to_engage}/retweeted_by?max_results=100",
            bearer_token,
        )
        if data is None and strict:
            return False, "Could not verify the retweet right now; try again in a moment."
        if data is None:
            LOG.warning("[campaign/verify] Could not reach Twitter to verify retweet — accepting")
            return True, "Retweet could not be verified (Twitter API unavailable); accepted"

        retweeter_ids = {u["id"] for u in (data.get("data") or [])}
        if twitter_user_id not in retweeter_ids:
            return False, (
                f"Your account has not retweeted the required tweet yet. "
                f"Retweet and try again."
            )

    # Follow verification — not possible with app-only Bearer token; log for audit
    if profile_to_follow and strict:
        return False, "Follow tasks cannot be verified automatically yet."
    if profile_to_follow:
        LOG.info(
            "[campaign/verify] Follow of @%s by Twitter user %s cannot be verified "
            "with app-only Bearer token — accepted after retweet check",
            profile_to_follow,
            twitter_user_id,
        )

    return True, "Social tasks verified"


async def verify_trading(
    wallet_address: Optional[str],
    helius_api_key: str,
    strict: bool = False,
) -> Tuple[bool, str]:
    """
    Verifies trading task: user's custodial wallet must have ≥1 successful SWAP
    transaction visible on Helius enhanced transaction history.
    """
    if not wallet_address:
        return False, (
            "No wallet found for your account. "
            "Create your wallet via the dashboard before attempting a trading campaign."
        )

    if strict and not helius_api_key:
        return False, "Trading verification is unavailable right now; try again later."
    if not helius_api_key:
        LOG.warning("[campaign/verify] HELIUS_API_KEY not configured — accepting trading task on good faith")
        return True, "Helius API not configured; accepted"

    txs = await _helius_get(
        f"/addresses/{wallet_address}/transactions",
        helius_api_key,
        type="SWAP",
        limit=10,
    )

    if txs is None and strict:
        return False, "Could not verify the swap right now; try again in a moment."
    if txs is None:
        LOG.warning("[campaign/verify] Helius API unavailable — accepting trading task")
        return True, "Swap could not be verified (Helius API unavailable); accepted"

    successful_swaps = [
        tx for tx in txs
        if tx.get("type") == "SWAP" and not tx.get("transactionError")
    ]

    if not successful_swaps:
        return False, (
            "No completed swaps found on your wallet. "
            "Ask XiaoLee AI to execute a swap for you first, then verify again."
        )

    return True, f"Trading task verified ({len(successful_swaps)} swap(s) confirmed on-chain)"


async def verify_referral(
    user_id: int,
    db,
    campaign_id: int,
) -> Tuple[bool, str]:
    """
    Referral task: proxy metric — ≥3 other participants must be enrolled in the
    same campaign. A proper referral code system is a future feature; this prevents
    trivial bypasses (solo user cannot self-claim a referral reward).
    """
    from sqlalchemy import select, func
    from database.models import CampaignParticipant

    result = await db.execute(
        select(func.count())
        .select_from(CampaignParticipant)
        .where(
            CampaignParticipant.campaign_id == campaign_id,
            CampaignParticipant.user_id != user_id,
        )
    )
    other_participants: int = result.scalar() or 0

    required = 3
    if other_participants < required:
        return False, (
            f"Referral task requires at least {required} friends to join this campaign. "
            f"Currently {other_participants} other participant(s) enrolled. "
            f"Share your invite link and try again."
        )

    return True, f"Referral verified ({other_participants} participants in campaign)"
