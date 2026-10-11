"""
Ranking de campanhas pelo perfil do onboarding (S2, XIAOLEEACE-20).

Os interesses do onboarding (`INTERESTS` em `campaigns_routes.py`) e os tipos de
campanha (`social`, `trading`, `referral`) não têm vocabulário comum — este
módulo é a ponte. Função pura: quem chama busca campanhas e perfil no banco;
aqui só se ordena, para dar para testar sem DB.
"""
from __future__ import annotations

from typing import Iterable

# Que tipo de campanha casa com cada interesse. Quem opera token (trader, defi,
# memecoins) ganha com volume on-chain → `trading`; comunidade de memecoin, games
# e cards vive no X e cresce por indicação → `social`/`referral`.
INTEREST_CAMPAIGN_TYPES: dict[str, tuple[str, ...]] = {
    "trader": ("trading",),
    "defi": ("trading",),
    "memecoins": ("trading", "social"),
    "games": ("social", "referral"),
    "cards": ("social", "referral"),
}


def _open_slots(campaign: dict) -> int:
    return max(int(campaign.get("max_participants") or 0) - int(campaign.get("completed_participants") or 0), 0)


def rank_campaigns_for_profile(
    campaigns: Iterable[dict],
    interests: Iterable[str],
    joined_ids: Iterable[int] = (),
) -> list[dict]:
    """Devolve cópias das campanhas, da mais para a menos indicada ao usuário.

    Cada item ganha `match_score` (quantos interesses casam com o tipo),
    `matched_interests` e `already_joined`. Ordem: ainda não inscrito, com vaga,
    maior score, maior reward, id — sem interesse nenhum, sobra a ordem por
    vaga/reward, que já é uma recomendação melhor que a do banco.
    """
    interests = [i for i in dict.fromkeys(interests) if i in INTEREST_CAMPAIGN_TYPES]
    joined = set(joined_ids)

    ranked = []
    for campaign in campaigns:
        matched = [i for i in interests if campaign.get("campaign_type") in INTEREST_CAMPAIGN_TYPES[i]]
        ranked.append({
            **campaign,
            "match_score": len(matched),
            "matched_interests": matched,
            "already_joined": campaign.get("id") in joined,
        })

    ranked.sort(key=lambda c: (
        c["already_joined"],
        _open_slots(c) == 0,
        -c["match_score"],
        -float(c.get("reward_per_participant") or 0),
        c.get("id") or 0,
    ))
    return ranked
