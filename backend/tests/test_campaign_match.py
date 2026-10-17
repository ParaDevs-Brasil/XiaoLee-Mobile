"""test_campaign_match.py — campanhas recomendadas pelo perfil (pedido da Deb)."""
from __future__ import annotations

import json
import os

import pytest

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database.models import User
from server.caller_trust import unverified_caller
from server.campaign_match import interest_matches, rank_for_interests
from server.orchestration import service as svc

GENESIS = {"name": "XiaoLee Genesis Campaign", "description": "Follow our account, retweet our launch post.", "campaign_type": "social"}
SWAP = {"name": "Swap Challenge", "description": "Execute your first swap via XiaoLee and earn bonus USDC.", "campaign_type": "trading"}
BUILDER = {"name": "Community Builder", "description": "Invite 3 friends to join XiaoLee.", "campaign_type": "referral"}
GAME = {"name": "Play & Earn", "description": "Jogue o game e ganhe USDC", "campaign_type": "social"}
MEME = {"name": "Meme Week", "description": "Post your best memecoin meme", "campaign_type": "social"}
ALL = [GENESIS, SWAP, BUILDER, GAME, MEME]


class TestMatching:
    def test_trading_type_and_swap_text_match_defi_and_trader(self):
        assert interest_matches(SWAP, ["defi", "trader", "games"]) == ["defi", "trader"]

    def test_text_matches_in_portuguese_and_english(self):
        assert interest_matches(GAME, ["games"]) == ["games"]
        assert interest_matches(MEME, ["memecoins", "cards"]) == ["memecoins"]

    def test_unrelated_campaign_matches_nothing(self):
        assert interest_matches(GENESIS, ["defi", "games", "cards", "trader", "memecoins"]) == []

    def test_unknown_or_empty_interests_are_ignored(self):
        assert interest_matches(SWAP, ["astrologia"]) == []
        assert interest_matches(SWAP, []) == []

    def test_whole_words_only(self):
        # "game" não casa dentro de "endgame"; "swap" não casa em "swapped"
        assert interest_matches({"name": "Endgame", "description": "swapped", "campaign_type": "social"}, ["games", "defi"]) == []

    def test_generic_words_do_not_recommend(self):
        # "Mega Pool" era recomendada a quem gosta de DeFi só por ter "pool" na descrição
        meme = {"name": "Mega Pool", "description": "Follow the profile and play along for a long time", "campaign_type": "social"}
        assert interest_matches(meme, ["defi", "games", "trader"]) == []


class TestRanking:
    def test_matching_first_and_stable(self):
        names = [c["name"] for c in rank_for_interests(ALL, ["games"])]
        assert names[0] == "Play & Earn"
        assert names[1:] == ["XiaoLee Genesis Campaign", "Swap Challenge", "Community Builder", "Meme Week"]

    def test_more_matches_rank_higher(self):
        names = [c["name"] for c in rank_for_interests(ALL, ["trader", "defi", "games"])]
        assert names[:2] == ["Swap Challenge", "Play & Earn"]

    def test_different_interests_give_different_order(self):
        defi = [c["name"] for c in rank_for_interests(ALL, ["defi"])]
        games = [c["name"] for c in rank_for_interests(ALL, ["games"])]
        assert defi != games and defi[0] == "Swap Challenge" and games[0] == "Play & Earn"

    def test_does_not_mutate_the_input(self):
        rank_for_interests(ALL, ["games"])
        assert "matches_your_interests" not in ALL[0]


class _Ctx:
    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        return self.db

    async def __aexit__(self, *exc):
        return False


class TestListCampaignsTool:
    @pytest.mark.asyncio
    async def test_verified_user_gets_their_interests_and_a_ranked_list(self, db_session, monkeypatch):
        db_session.add(User(twitter_user_id="privy_deb", twitter_handle="deb", interest_profile=json.dumps(["games"])))
        await db_session.commit()
        monkeypatch.setattr("database.database.SessionLocal", lambda: _Ctx(db_session))
        out = json.loads(await self._run("privy_deb"))
        assert out["your_interests"] == ["games"]
        assert "matches_your_interests" in out["campaigns"][0]

    @pytest.mark.asyncio
    async def test_unverified_caller_never_sees_someones_profile(self, db_session, monkeypatch):
        db_session.add(User(twitter_user_id="privy_deb", twitter_handle="deb", interest_profile=json.dumps(["games"])))
        await db_session.commit()
        monkeypatch.setattr("database.database.SessionLocal", lambda: _Ctx(db_session))
        token = unverified_caller.set(True)
        try:
            out = json.loads(await self._run("privy_deb"))  # user_id do corpo, sem token verificado
        finally:
            unverified_caller.reset(token)
        assert "your_interests" not in out

    @pytest.mark.asyncio
    async def test_user_without_interests_gets_the_plain_list(self, db_session, monkeypatch):
        db_session.add(User(twitter_user_id="privy_new", twitter_handle="new"))
        await db_session.commit()
        monkeypatch.setattr("database.database.SessionLocal", lambda: _Ctx(db_session))
        out = json.loads(await self._run("privy_new"))
        assert "your_interests" not in out and out["campaigns"]

    async def _run(self, user_id):
        orch = svc.OrchestrationService.__new__(svc.OrchestrationService)
        captured = {"actions": [], "execution": None, "last_swap_args": {}, "animation_name": None}
        executor = orch._make_stellar_executor(None, captured, user_id=user_id)
        return await executor("list_campaigns", {})
