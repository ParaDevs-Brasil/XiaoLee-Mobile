"""
Campanhas × interesses do onboarding (defi, games, cards, trader, memecoins).

As campanhas não têm tags: o casamento é por palavras-chave no nome, na descrição e no tipo
(PT e EN). É transparente e funciona também para campanhas criadas por usuários.
# ponytail: palavras-chave; quando houver volume de campanhas, trocar por uma coluna `tags` (migração + o criador/agente a preenche).
"""
from __future__ import annotations

import re

INTEREST_KEYWORDS: dict[str, tuple[str, ...]] = {
    "defi": ("defi", "swap", "liquidity", "liquidez", "yield", "stake", "staking", "lending", "amm", "dex"),
    "games": ("game", "games", "gaming", "jogo", "jogos", "gamer", "nft", "esports", "guild"),
    "cards": ("card", "cards", "cartao", "cartão", "cartoes", "cartões", "debit", "debito", "débito", "credit", "visa", "mastercard"),
    "trader": ("trade", "trader", "trading", "swap", "perp", "futures", "futuros", "candle", "candles"),
    "memecoins": ("meme", "memes", "memecoin", "memecoins", "doge", "pepe", "shib", "bonk", "degen"),
}

# Palavras genéricas ficam de fora de propósito (pool, play, long, chart...): geravam recomendação errada.
# O tipo sozinho já diz algo: uma campanha de trading é para quem opera.
TYPE_INTERESTS: dict[str, tuple[str, ...]] = {"trading": ("trader", "defi")}


def _words(text: str) -> set[str]:
    return set(re.findall(r"[\wãáâàéêíóôõúç]+", text.lower()))


def interest_matches(campaign: dict, interests: list[str]) -> list[str]:
    """Interesses do usuário (na ordem em que ele os escolheu) que esta campanha atende."""
    words = _words(f"{campaign.get('name', '')} {campaign.get('description', '')}")
    from_type = TYPE_INTERESTS.get(str(campaign.get("campaign_type", "")).lower(), ())
    out: list[str] = []
    for interest in interests:
        keys = INTEREST_KEYWORDS.get(interest)
        if keys is None:
            continue  # interesse que a lista conhece mas sem palavras (ou desconhecido): ignora
        if interest in from_type or any(k in words for k in keys if " " not in k):
            out.append(interest)
    return out


def rank_for_interests(campaigns: list[dict], interests: list[str]) -> list[dict]:
    """Cópia das campanhas com ``matches_your_interests``, as que combinam primeiro (estável: mantém a ordem original)."""
    ranked = [{**c, "matches_your_interests": interest_matches(c, interests)} for c in campaigns]
    return sorted(ranked, key=lambda c: -len(c["matches_your_interests"]))
