"""
test_campaign_recommendations.py — ranking de campanhas pelo perfil do onboarding.

Regras que estes testes travam:
- campanha do tipo que casa com o interesse vem antes;
- já inscrito e campanha lotada descem para o fim, mesmo casando;
- interesse desconhecido é ignorado, e sem perfil a ordem é vaga/reward.
"""
from __future__ import annotations

from server.campaign_recommendations import rank_campaigns_for_profile


def _campaign(id: int, campaign_type: str, reward: float = 1.0, max_p: int = 10, done: int = 0) -> dict:
    return {
        "id": id,
        "campaign_type": campaign_type,
        "reward_per_participant": reward,
        "max_participants": max_p,
        "completed_participants": done,
    }


CAMPAIGNS = [_campaign(1, "social"), _campaign(2, "trading"), _campaign(3, "referral")]


def _ids(ranked: list[dict]) -> list[int]:
    return [c["id"] for c in ranked]


def test_trader_ve_trading_primeiro():
    ranked = rank_campaigns_for_profile(CAMPAIGNS, ["trader"])
    assert _ids(ranked) == [2, 1, 3]
    assert ranked[0]["match_score"] == 1
    assert ranked[0]["matched_interests"] == ["trader"]


def test_games_ve_social_e_referral_antes_de_trading():
    assert _ids(rank_campaigns_for_profile(CAMPAIGNS, ["games"])) == [1, 3, 2]


def test_mais_interesses_casando_sobe_mais():
    # memecoins casa trading e social; defi só trading → trading tem score 2.
    ranked = rank_campaigns_for_profile(CAMPAIGNS, ["memecoins", "defi"])
    assert _ids(ranked) == [2, 1, 3]
    assert ranked[0]["match_score"] == 2


def test_ja_inscrito_vai_para_o_fim():
    ranked = rank_campaigns_for_profile(CAMPAIGNS, ["trader"], joined_ids=[2])
    assert _ids(ranked) == [1, 3, 2]
    assert ranked[-1]["already_joined"] is True


def test_lotada_desce_mesmo_casando():
    campaigns = [_campaign(1, "trading", max_p=5, done=5), _campaign(2, "social")]
    assert _ids(rank_campaigns_for_profile(campaigns, ["trader"])) == [2, 1]


def test_sem_perfil_ordena_por_reward():
    campaigns = [_campaign(1, "social", reward=1), _campaign(2, "trading", reward=5)]
    ranked = rank_campaigns_for_profile(campaigns, [])
    assert _ids(ranked) == [2, 1]
    assert all(c["match_score"] == 0 for c in ranked)


def test_interesse_desconhecido_e_ignorado():
    ranked = rank_campaigns_for_profile(CAMPAIGNS, ["xadrez"])
    assert all(c["matched_interests"] == [] for c in ranked)


def test_nao_altera_a_lista_original():
    original = [dict(c) for c in CAMPAIGNS]
    rank_campaigns_for_profile(CAMPAIGNS, ["trader"])
    assert CAMPAIGNS == original


# ---------------------------------------------------------------------------
# list_recommended_campaigns — perfil vem da sessão, nunca do chamador
# ---------------------------------------------------------------------------

import json  # noqa: E402
from datetime import datetime, timedelta  # noqa: E402

from sqlalchemy import func, select  # noqa: E402

import pytest  # noqa: E402

from database.models import CampaignParticipant, User, WebSession  # noqa: E402
from server.campaigns_routes import list_recommended_campaigns  # noqa: E402


async def _login(db, name: str, interests: list[str]) -> str:
    db.add(WebSession(
        session_id=f"privy_session_{name}",
        twitter_user_id=f"privy_{name}",
        expires_at=datetime.utcnow() + timedelta(days=30),
    ))
    user = User(twitter_user_id=f"privy_{name}", twitter_handle=name, interest_profile=json.dumps(interests))
    db.add(user)
    await db.commit()
    return f"Bearer privy_session_{name}"


@pytest.mark.asyncio
@pytest.mark.db
async def test_recomendadas_seguem_o_perfil_da_sessao(db_session):
    auth = await _login(db_session, "ana", ["trader"])
    ranked = await list_recommended_campaigns(db_session, auth)
    assert ranked[0]["campaign_type"] == "trading"
    assert ranked[0]["matched_interests"] == ["trader"]


@pytest.mark.asyncio
@pytest.mark.db
async def test_recomendadas_marcam_campanha_ja_inscrita(db_session):
    auth = await _login(db_session, "bia", ["trader"])
    first = (await list_recommended_campaigns(db_session, auth))[0]
    user = (await db_session.execute(select(User).where(User.twitter_user_id == "privy_bia"))).scalars().one()
    db_session.add(CampaignParticipant(campaign_id=first["id"], user_id=user.id))
    await db_session.commit()

    ranked = await list_recommended_campaigns(db_session, auth)
    assert ranked[-1]["id"] == first["id"]
    assert ranked[-1]["already_joined"] is True


@pytest.mark.asyncio
@pytest.mark.db
async def test_sem_sessao_nao_personaliza_nem_cria_usuario(db_session):
    for auth in (None, "Bearer token_que_nao_existe"):
        ranked = await list_recommended_campaigns(db_session, auth)
        assert ranked and all(c["match_score"] == 0 for c in ranked)
    assert (await db_session.execute(select(func.count()).select_from(User))).scalar() == 0
