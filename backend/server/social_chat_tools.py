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
import time
from typing import Any, Dict, Optional

from sqlalchemy import select

from database.models import MediaClip, PostPublication, SocialAccount
from server.campaigns_routes import _resolve_user
from server.social_adapters import ADAPTERS, BSKY_TEXT_MAX, TELEGRAM_CAPTION_MAX, X_TEXT_MAX, SocialError
from server.social_routes import _crypto

SOCIAL_TOOL_NAMES = {"get_publishing_context", "prepare_social_post", "get_social_insights"}

# Leitura de métricas custa crédito na rede (X cobra por item lido): repete a resposta por 10 min por creator+rede.
# ponytail: cache em memória do processo; com mais de uma instância vira cache por instância (só custa uma leitura a mais).
INSIGHTS_TTL = 600
_insights_cache: dict[tuple[int, str], tuple[float, dict]] = {}

# Limite de texto por rede (o que a rede aceita); Telegram só limita a legenda quando vai com vídeo.
TEXT_LIMITS = {"bluesky": BSKY_TEXT_MAX, "telegram": TELEGRAM_CAPTION_MAX, "x": X_TEXT_MAX}

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
        "name": "get_social_insights",
        "description": (
            "Desempenho do perfil do creator numa rede conectada: seguidores, impressões, engajamento, cliques no "
            "perfil e no link e os melhores posts dos últimos 29 dias. O app mostra um card com os números. Chame "
            "quando ele perguntar como está o perfil, o que funciona, ou antes de sugerir posts. Use SÓ estes números."
        ),
        "parameters": {"type": "object", "properties": {"platform": {"type": "string", "enum": ["x"]}}},
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
    "- get_social_insights: números do perfil (seguidores, impressões, engajamento, cliques, melhores posts). Chame "
    "para 'como está meu perfil', 'o que funciona' e antes de sugerir posts; mostre um resumo curto, o card já traz os "
    "números. Amostras pequenas são pista, não regra: diga isso. Sugira posts para o público do creator (cripto ou "
    "gente chegando agora em cripto): termo técnico só com uma explicação curta.\n"
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

    if tool_name == "get_social_insights":
        platform = str(tool_input.get("platform") or "x")
        acc = accounts.get(platform)
        if not acc:
            return {"error": "not_connected", "message": f"Conecte sua conta {platform} em Contas conectadas primeiro."}, None
        adapter = ADAPTERS.get(platform)
        if not hasattr(adapter, "fetch_insights"):
            return {"error": "not_supported", "message": f"Métricas do perfil ainda não existem para {platform}."}, None
        hit = _insights_cache.get((user.id, platform))
        if hit and time.time() - hit[0] < INSIGHTS_TTL:
            data = hit[1]
        else:
            creds = json.loads(_crypto.decrypt(acc.credentials_enc))
            before = dict(creds)
            try:
                data = await adapter.fetch_insights(creds, acc.external_id)
            except SocialError as e:
                return {"error": "network", "message": str(e)}, None
            if creds != before:  # o adaptador renovou o token
                acc.credentials_enc = _crypto.encrypt(json.dumps(creds))
                await db.commit()
            _insights_cache[(user.id, platform)] = (time.time(), data)
        data = {**data, "platform": platform, "handle": acc.handle}
        return data, {"status": "insights_ready", "insights": data}

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
