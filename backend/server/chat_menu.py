"""
Ações do menu do chat (S2, XIAOLEEACE-20).

Os cards do menu no app mandam, além do texto, uma `menu_action` fixa. Com ela o
backend chama a tool certa direto, sem depender do modelo decidir — o critério
da task ("o menu direciona por perfil e métricas") não pode falhar porque o LLM
caiu ou escolheu outra coisa. O modelo só redige a resposta com os dados já
consultados; sem modelo, `fallback_reply` monta um texto com os mesmos dados.

Funções puras: o texto de fallback é testado sem DB nem LLM.
"""
from __future__ import annotations

from typing import Any

# menu_action (o que o app manda) → tool do executor do chat que a atende.
MENU_ACTIONS: dict[str, str] = {
    "browse_campaigns": "list_campaigns",
    "my_metrics": "get_my_activity",
}

BROWSE_LIMIT = 3


def _money(amount: float, token: str = "USDC") -> str:
    return f"{amount:g} {token}"


def _browse_reply(data: dict) -> str:
    campaigns = data.get("campaigns") or []
    picks = [c for c in campaigns if not c.get("already_joined")][:BROWSE_LIMIT]
    if not picks:
        if campaigns:
            return "You're already in every active campaign. I'll let you know when a new one opens!"
        return "There are no active campaigns right now. I'll let you know when one opens!"

    personalized = any(c.get("matched_interests") for c in picks)
    lines = ["Here are the campaigns that best match your interests:" if personalized
             else "Here are the best campaigns open right now:"]
    for i, c in enumerate(picks, 1):
        line = (
            f"{i}. {c['name']} — {c.get('campaign_type', 'custom')}, "
            f"{_money(float(c.get('reward_per_participant') or 0), c.get('reward_token') or 'USDC')} per participant"
        )
        if c.get("matched_interests"):
            line += f" (matches: {', '.join(c['matched_interests'])})"
        lines.append(line)
    lines.append("Want to join one?")
    return "\n".join(lines)


def _amounts(by_token: dict[str, float]) -> str:
    return ", ".join(_money(amount, token) for token, amount in by_token.items())


def _metrics_reply(data: dict) -> str:
    if data.get("error") == "no_session":
        return "Log in to see your metrics."

    created = data.get("campaigns_created") or {}
    joined = data.get("campaigns_joined") or {}
    agent = data.get("agent_payments_received") or {}
    arc = data.get("arc_transfers") or {}
    cctp = data.get("cctp_received") or {}
    clipper = data.get("clipper") or {}

    lines = []
    if created.get("total"):
        line = f"• Campaigns created: {created['total']}"
        if created.get("paid_out"):
            line += f" (paid out {_amounts(created['paid_out'])})"
        lines.append(line)
    if joined.get("total"):
        line = f"• Campaigns joined: {joined['total']} ({joined.get('paid', 0)} paid)"
        if joined.get("earned"):
            line += f", earned {_amounts(joined['earned'])}"
        lines.append(line)
    if agent.get("count"):
        lines.append(f"• Payments from the agent: {agent['count']} ({_money(agent['usdc'])})")
    if arc.get("sent"):
        lines.append(f"• USDC sent on Arc: {arc['sent']} transfers ({_money(arc['usdc_sent'])})")
    if cctp.get("count"):
        lines.append(f"• USDC received cross-chain: {cctp['count']} ({_money(cctp['usdc'])})")
    if clipper.get("media_uploaded"):
        lines.append(f"• Clipper: {clipper['media_uploaded']} videos, {clipper.get('clips_ready', 0)} clips ready")
    if data.get("chat_sessions"):
        lines.append(f"• Chats with me: {data['chat_sessions']}")

    if not lines or lines == [f"• Chats with me: {data.get('chat_sessions')}"]:
        return (
            "You haven't done much here yet — no campaigns or payments so far. "
            "A good first step: browse the campaigns picked for your interests!"
        )
    return "Here's everything you've done on Xiaolee so far:\n" + "\n".join(lines)


def fallback_reply(menu_action: str, data: dict[str, Any]) -> str:
    """Resposta com os dados da tool, para quando não há modelo para redigir."""
    if menu_action == "browse_campaigns":
        return _browse_reply(data)
    if menu_action == "my_metrics":
        return _metrics_reply(data)
    raise ValueError(f"unknown menu_action: {menu_action}")
