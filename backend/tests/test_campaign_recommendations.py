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
