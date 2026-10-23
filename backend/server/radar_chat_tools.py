"""
radar_chat_tools.py — tool do chat que pesquisa o que está em alta no X (atrás de RADAR_TOOLS_ENABLED + XAI_API_KEY).

    get_trend_radar   → começa em segundo plano uma pesquisa do Grok (busca ao vivo no X) sobre o nicho do creator e
                        responde na hora com o card `radar_pending`. NÃO posta nada: virar post é com
                        suggest_post_options/prepare_social_post.
    GET /v1/radar/{id} → o app consulta até virar `ready` (tendências com motivo e gancho) ou `error`.

A pesquisa leva 40-60 s e custa dinheiro (US$ 0,07-0,3 medido), então não segura o /chat: tem teto diário por
creator e o custo vai pro log. O resultado vai direto pro card; o modelo do chat não o lê.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db_session
from server.campaigns_routes import _resolve_user
from server.settings import settings

logger = logging.getLogger(__name__)

RADAR_TOOL_NAMES = {"get_trend_radar"}

router = APIRouter(prefix="/v1/radar", tags=["radar"])

# ponytail: contador e jobs em memória por processo. Reinício do servidor perde o job (o app mostra erro e o creator
# pede de novo) e com mais de uma instância o teto vira por instância e o poll pode cair noutra; tabela se isso doer.
_runs: Dict[tuple, int] = {}
_jobs: Dict[str, dict] = {}
_tasks: set = set()  # guarda referência: o loop só mantém tarefa solta por referência fraca
JOB_TTL = 3600
TICKS_PER_USD = 1e10  # `cost_in_usd_ticks` da xAI vem em décimos de bilionésimo de dólar

RADAR_TOOLS = [
    {"type": "function", "function": {
        "name": "get_trend_radar",
        "description": (
            "Começa em segundo plano uma pesquisa no X do que está em alta agora no nicho do creator. Responde na hora: "
            "o app mostra um card 'pesquisando' que vira a lista de tendências em ~1 min, então você NÃO recebe as "
            "tendências e não deve inventar nenhuma. Chame só quando ele pedir tendências, ideias do que postar ou 'o "
            "que está bombando', e uma vez por pedido. NÃO publica nada."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "niche": {"type": "string", "description": "Nicho ou tema (ex.: 'IA e cripto', 'fitness')"},
                "hours": {"type": "integer", "minimum": 6, "maximum": 168, "description": "Janela em horas (padrão 48)"},
            },
            "required": ["niche"],
        },
    }},
]

RADAR_PROMPT = (
    "- get_trend_radar: quando o creator pedir tendências, 'o que está bombando' ou ideias do que postar sobre um "
    "tema, chame UMA vez. A pesquisa roda em segundo plano e o resultado aparece num card logo abaixo do seu texto, "
    "em cerca de 1 minuto: diga em uma frase curta que foi vasculhar o X e já mostra, e NÃO cite nenhuma tendência "
    "nem número (você não os recebe). Quando ele escolher uma tendência do card, escreva o post com "
    "suggest_post_options. Se vier erro da tool, diga em uma frase e ofereça tentar de novo.\n"
)

_INSTRUCTIONS = (
    "Use a busca no X para achar o que está em alta AGORA no nicho pedido, na janela de horas dada. Faça no máximo "
    "4 buscas. Responda SOMENTE um JSON, sem texto fora dele: "
    '{"trends":[{"topic":"...","why":"1-2 frases com o fato que fez isso subir","hook":"gancho de post em 1 frase, '
    'voz de pessoa e não de marca","example_post_url":"url de um post real ou vazio"}]}. '
    "Máximo 5 tendências. Só inclua o que você viu nos posts: nada de inventar."
)


async def _ask_grok(niche: str, hours: int) -> tuple[dict, float]:
    body = {
        "model": settings.xai_model,
        "input": f"Nicho: {niche}\nJanela: últimas {hours} horas\n\n{_INSTRUCTIONS}",
        "tools": [{"type": "x_search"}],
    }
    async with httpx.AsyncClient(timeout=150) as client:
        r = await client.post("https://api.x.ai/v1/responses", json=body,
                              headers={"Authorization": f"Bearer {settings.xai_api_key}"})
    r.raise_for_status()
    d = r.json()
    cost = (d.get("usage") or {}).get("cost_in_usd_ticks", 0) / TICKS_PER_USD
    text = "".join(c.get("text", "") for o in d.get("output", []) if o.get("type") == "message"
                   for c in o.get("content", []) if c.get("type") == "output_text")
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start:end + 1]), cost


def _purge() -> None:
    cutoff = time.time() - JOB_TTL
    for k in [k for k, j in _jobs.items() if j["created"] < cutoff]:
        del _jobs[k]


async def _work(job_id: str, user_id: int, niche: str, hours: int) -> None:
    job, t0 = _jobs[job_id], time.time()
    try:
        data, cost = await _ask_grok(niche, hours)
    except (httpx.HTTPError, ValueError, KeyError) as e:
        logger.warning("[radar] failed job=%s user=%s niche=%r: %s", job_id, user_id, niche, e)
        job.update(status="error", error="Não consegui pesquisar no X agora.")
        return
    trends = [t for t in data.get("trends", []) if isinstance(t, dict) and t.get("topic")][:5]
    logger.info("[radar] job=%s user=%s niche=%r hours=%s trends=%d cost_usd=%.4f secs=%.0f",
                job_id, user_id, niche, hours, len(trends), cost, time.time() - t0)
    job.update(status="ready", trends=trends)


async def run(tool_name: str, tool_input: Dict[str, Any], db, user_id: str) -> tuple[dict, Optional[dict]]:
    """Devolve (resultado para o modelo, `execution` para o app ou None)."""
    user = await _resolve_user(db, f"Bearer {user_id}")
    niche = str(tool_input.get("niche", "")).strip()[:120]
    if not niche:
        return {"error": "no_niche", "message": "Pergunte em qual nicho ou tema ele quer o radar."}, None
    hours = min(max(int(tool_input.get("hours") or 48), 6), 168)

    day = time.strftime("%Y-%m-%d")
    if _runs.get((user.id, day), 0) >= settings.radar_max_runs_per_day:
        return {"error": "daily_limit", "message": "Chegou no limite de radares de hoje. Amanhã libera de novo."}, None
    _runs[(user.id, day)] = _runs.get((user.id, day), 0) + 1

    _purge()
    job_id = secrets.token_urlsafe(12)
    _jobs[job_id] = {"user_id": user.id, "status": "pending", "niche": niche, "hours": hours, "created": time.time()}
    task = asyncio.create_task(_work(job_id, user.id, niche, hours))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return (
        {"started": True, "niche": niche},
        {"status": "radar_pending", "radar": {"job_id": job_id, "niche": niche, "hours": hours}},
    )


@router.get("/{job_id}")
async def radar_status(job_id: str, authorization: Optional[str] = Header(default=None),
                       db: AsyncSession = Depends(get_db_session)):
    """Estado do radar. Só o dono vê (id errado ou de outro creator dá o mesmo 404)."""
    if not (settings.radar_tools_enabled and settings.xai_api_key):
        raise HTTPException(status_code=404, detail="Not found")
    user = await _resolve_user(db, authorization, strict=True)
    job = _jobs.get(job_id)
    if not job or job["user_id"] != user.id:
        raise HTTPException(status_code=404, detail="Not found")
    out = {"status": job["status"], "niche": job["niche"], "hours": job["hours"]}
    if job["status"] == "ready":
        out["trends"] = job["trends"]
    if job["status"] == "error":
        out["message"] = job["error"]
    return out
