"""
social_chat_tools.py — tools do chat para o creator postar nas redes (atrás de SOCIAL_TOOLS_ENABLED).

    get_publishing_context  → contas conectadas, cortes prontos e posts recentes (base para sugerir/rascunhar)
    prepare_social_post     → valida e deixa o post pronto; NÃO publica. O app mostra o card de confirmar e,
                              ao toque do creator, chama POST /v1/social/publish.

Sugerir e rascunhar legenda é o próprio modelo, em cima do contexto — sem tool a mais. A identidade nunca vem
do modelo: o executor passa o `user_id` do `/chat` (o `twitter_user_id` já resolvido; quem chega sem token do
backend é barrado antes, por `unverified_caller`) — o mesmo acordo das tools de campanha.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from sqlalchemy import select

from database.models import MediaClip, PostPublication, SocialAccount
from server.campaigns_routes import _resolve_user
from server.social_adapters import ADAPTERS, BSKY_TEXT_MAX, TELEGRAM_CAPTION_MAX

SOCIAL_TOOL_NAMES = {"get_publishing_context", "prepare_social_post"}

# Limite de texto por rede (o que a rede aceita); Telegram só limita a legenda quando vai com vídeo.
TEXT_LIMITS = {"bluesky": BSKY_TEXT_MAX, "telegram": TELEGRAM_CAPTION_MAX}

SOCIAL_TOOLS = [
    {"type": "function", "function": {
        "name": "get_publishing_context",
        "description": (
            "Lista o que o creator pode postar agora: redes conectadas, cortes prontos (id, título, motivo, "
            "duração) e os últimos posts com métricas. Chame antes de sugerir ou rascunhar posts, e quando "
            "ele perguntar como foram os posts. Use SÓ os números desta tool."
        ),
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "prepare_social_post",
        "description": (
            "Prepara um post numa rede conectada, com um corte pronto (clip_id) ou só texto. NÃO publica: "
            "deixa um botão de confirmar na conversa e o creator toca para postar de verdade. Chame só depois "
            "de mostrar a legenda e ele aprovar; depois diga que é só tocar no botão."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "platform": {"type": "string", "enum": list(ADAPTERS)},
                "text": {"type": "string", "description": "Legenda/texto exato que será postado"},
                "clip_id": {"type": "integer", "description": "Id de um corte pronto (de get_publishing_context)"},
            },
            "required": ["platform", "text"],
        },
    }},
]

SOCIAL_PROMPT = (
    "- get_publishing_context: veja redes conectadas, cortes prontos e posts recentes do creator. Chame antes "
    "de sugerir posts (escolha o corte, a rede e escreva a legenda no tom dele) e para responder 'como foi?'. "
    "Se não houver rede conectada, diga para conectar em Contas conectadas; se não houver corte pronto, "
    "ofereça gerar cortes do vídeo.\n"
    "- prepare_social_post: prepara o post depois que o creator aprovar a legenda. Ela NÃO publica — só deixa "
    "um botão de confirmar na conversa. Nunca diga que já postou antes do toque dele.\n"
)


async def run(tool_name: str, tool_input: Dict[str, Any], db, user_id: str) -> tuple[dict, Optional[dict]]:
    """Devolve (resultado para o modelo, `execution` para o app ou None)."""
    user = await _resolve_user(db, f"Bearer {user_id}")
    accounts = {a.platform: a for a in (await db.execute(
        select(SocialAccount).where(SocialAccount.user_id == user.id, SocialAccount.status == "active")
    )).scalars().all()}

    if tool_name == "get_publishing_context":
        clips = (await db.execute(
            select(MediaClip).where(MediaClip.user_id == user.id, MediaClip.status == "ready")
            .order_by(MediaClip.id.desc()).limit(10)
        )).scalars().all()
        pubs = (await db.execute(
            select(PostPublication).where(PostPublication.user_id == user.id).order_by(PostPublication.id.desc()).limit(10)
        )).scalars().all()
        return {
            "accounts": [{"platform": p, "handle": a.handle} for p, a in accounts.items()],
            "text_limits": TEXT_LIMITS,
            "ready_clips": [{"clip_id": c.id, "title": c.title, "reason": c.reason,
                             "seconds": round(c.end_s - c.start_s)} for c in clips],
            "recent_posts": [{"platform": p.platform, "status": p.status, "caption": p.caption[:120], "url": p.url,
                              "metrics": json.loads(p.metrics_json) if p.metrics_json else None} for p in pubs],
        }, None

    # prepare_social_post
    platform, text = str(tool_input.get("platform", "")), str(tool_input.get("text", "")).strip()
    if platform not in accounts:
        return {"error": "not_connected", "message": f"Conecte sua conta {platform} em Contas conectadas primeiro."}, None
    if not text:
        return {"error": "empty_text", "message": "Falta o texto do post."}, None
    if len(text) > TEXT_LIMITS.get(platform, 4000):
        return {"error": "too_long", "message": f"O texto passa de {TEXT_LIMITS[platform]} caracteres em {platform}."}, None
    clip_id = tool_input.get("clip_id")
    if clip_id is not None:
        clip = (await db.execute(
            select(MediaClip).where(MediaClip.id == int(clip_id), MediaClip.user_id == user.id)
        )).scalars().first()
        if not clip or clip.status != "ready":
            return {"error": "clip_not_ready", "message": "Esse corte não existe ou ainda não está pronto."}, None
    return (
        {"ready_to_post": True, "platform": platform, "handle": accounts[platform].handle},
        {"status": "post_ready", "post": {"platform": platform, "handle": accounts[platform].handle,
                                         "text": text, "clip_id": clip_id}},
    )
