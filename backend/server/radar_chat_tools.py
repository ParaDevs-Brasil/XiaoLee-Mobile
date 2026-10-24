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
import re
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
_cache: Dict[tuple, tuple] = {}  # (nicho normalizado, janela) -> (quando, tendências): quem pergunta o mesmo reaproveita
_spend: Dict[str, float] = {}  # dia -> US$ estimado gasto (Grok medido + Claude estimado)
CACHE_TTL = 3 * 3600
ANGLES_USD = 0.02  # estimativa do passo do Claude; o Grok vem medido em `cost_in_usd_ticks`
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
    "Use a busca no X para achar o que de FATO aconteceu nas últimas horas no nicho pedido. Faça no máximo 4 buscas. "
    "Responda SOMENTE um JSON, sem texto fora dele: "
    '{"trends":[{"topic":"nome curto","why":"o que aconteceu em 1-2 frases, com os números, nomes e datas que aparecem '
    'nos posts","example_post_url":"url de um post real","account":"@perfil que postou",'
    '"verify":true se a fonte é só um post de conta pequena ou desconhecida, sem confirmação oficial nem de mais de um perfil}]}. '
    "Regras: só o que você viu em posts reais, nada de inventar número; IGNORE presale, whitelist, giveaway, airdrop "
    "farming, shilling de token pequeno e posts de bot; prefira anúncios de verdade, números, mudanças de regra, "
    "polêmicas e debates de gente conhecida do nicho; no máximo 4 itens, só os melhores, e se só houver 2 bons "
    "devolva 2. Escreva em português."
)

# Modelos tentados em ordem quando a xAI responde 5xx (um modelo novo fora do ar não derruba o radar).
FALLBACK_MODELS = ("grok-4.3", "grok-4.20-0309-reasoning")

ANGLE_KINDS = ("opiniao", "pergunta", "explicando")

_ANGLE_SYSTEM = (
    "Você é um creator brasileiro de cripto e tecnologia escrevendo o SEU post, na sua conta. Não é marca, não é "
    "assistente, não é jornal: é uma pessoa com opinião falando com quem te segue."
)
_ANGLE_RULES = (
    "Para CADA item abaixo escreva 3 ângulos de post, nesta ordem:\n"
    '- "opiniao": uma posição clara (pode ser cética ou discordar), que dê vontade de responder;\n'
    '- "pergunta": uma pergunta real para a audiência, que você gostaria de ver respondida (não retórica de marketing);\n'
    '- "explicando": o que mudou em linguagem de gente, com o número ou a comparação que faz a ficha cair.\n'
    "Regras: no idioma do nicho; primeira pessoa para OPINIÃO, nunca para EXPERIÊNCIA; 1-2 frases, até 220 caracteres; "
    "use o nome e o número específicos do fato; sem emoji e sem hashtag. PROIBIDO dizer que você assistiu, usou, testou, "
    "foi, conversou, 'sempre achei' ou qualquer vivência pessoal: você só leu a notícia. No 'explicando' use SÓ números "
    "que estão no fato (pode comparar com algo do dia a dia, sem número novo). Varie o molde: não comece várias "
    "opiniões com 'isso não é X, é Y', e dê ao menos uma opinião a favor quando o fato for bom. PROIBIDO slogan e clichê ('just dropped', 'game changer', 'rei', 'to the moon', "
    "'isso muda tudo', 'ninguém está falando disso', 'vamos nessa'); não afirme nada além do fato dado e não invente "
    "número. Responda SOMENTE JSON: "
    '{"items":[{"i":0,"angles":[{"kind":"opiniao","text":"..."},{"kind":"pergunta","text":"..."},'
    '{"kind":"explicando","text":"..."}]}]}\n\n'
)


async def _ask_grok(niche: str, hours: int) -> tuple[dict, float]:
    last: Exception = RuntimeError("no model")
    for model in dict.fromkeys((settings.xai_model, *FALLBACK_MODELS)):
        body = {
            "model": model,
            "input": f"Nicho: {niche}\nJanela: últimas {hours} horas\n\n{_INSTRUCTIONS}",
            "tools": [{"type": "x_search"}],
        }
        async with httpx.AsyncClient(timeout=150) as client:
            r = await client.post("https://api.x.ai/v1/responses", json=body,
                                  headers={"Authorization": f"Bearer {settings.xai_api_key}"})
        if r.status_code >= 500 or r.status_code == 429:
            logger.warning("[radar] %s answered %s, trying the next model", model, r.status_code)
            last = httpx.HTTPStatusError(f"{model} {r.status_code}", request=r.request, response=r)
            continue
        r.raise_for_status()
        d = r.json()
        cost = (d.get("usage") or {}).get("cost_in_usd_ticks", 0) / TICKS_PER_USD
        text = "".join(c.get("text", "") for o in d.get("output", []) if o.get("type") == "message"
                       for c in o.get("content", []) if c.get("type") == "output_text")
        start, end = text.find("{"), text.rfind("}")
        return json.loads(text[start:end + 1]), cost
    raise last


async def _write_angles(niche: str, trends: list) -> tuple[list, float]:
    """Dá a cada fato 3 ângulos de post em voz de creator (Claude). Falhou ou sem chave: devolve os fatos como estão."""
    if not (trends and settings.anthropic_api_key):
        return trends, 0.0
    import anthropic

    facts = "\n".join(f"[{i}] {t['topic']} — {t.get('why', '')} (fonte: {t.get('account', '')})" for i, t in enumerate(trends))
    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=60, max_retries=1)
        msg = await client.messages.create(
            model=settings.anthropic_model, max_tokens=1500, system=_ANGLE_SYSTEM,
            messages=[{"role": "user", "content": f"Nicho: {niche}\n\n{_ANGLE_RULES}{facts}"}],
        )
        text = "".join(b.text for b in msg.content if b.type == "text")
        data = json.loads(text[text.find("{"):text.rfind("}") + 1])
    except Exception as e:  # o fato sozinho ainda vale; ângulo é o refinamento
        logger.warning("[radar] angles failed niche=%r: %s", niche, e)
        return trends, 0.0
    by_i = {a.get("i"): a.get("angles") or [] for a in data.get("items", []) if isinstance(a, dict)}
    out = []
    for i, t in enumerate(trends):
        fact = f"{t['topic']} {t.get('why', '')}"
        angles = [{"kind": a["kind"], "text": str(a["text"]).strip()} for a in by_i.get(i, [])
                  if isinstance(a, dict) and a.get("kind") in ANGLE_KINDS and str(a.get("text", "")).strip()
                  and _angle_ok(str(a["text"]).strip(), fact)]
        out.append({**t, "angles": angles, **({"hook": angles[0]["text"]} if angles else {})})
    return out, 0.0


ANGLE_MAX_CHARS = 220
# Vivência que o creator não teve: o modelo só leu a notícia, então "assisti"/"testei" viraria mentira publicada no nome dele.
_EXPERIENCE = re.compile(
    r"\b(assisti|assistindo|usei|testei|participei|estive|conversei|fui\s+(?:ao|na|no|lá)|sempre\s+achei|"
    r"vi\s+(?:ao\s+vivo|a\s+sessão|a\s+live))\b", re.I)
_NUMBER = re.compile(r"\d[\d.,]*")


def _angle_ok(text: str, fact: str) -> bool:
    """Corta o que o prompt sozinho não garante: tamanho, vivência inventada e número que não está no fato."""
    if len(text) > ANGLE_MAX_CHARS or _EXPERIENCE.search(text):
        return False
    known = {n.rstrip(".,") for n in _NUMBER.findall(fact)}
    return all(n.rstrip(".,") in known for n in _NUMBER.findall(text))


def _key(niche: str, hours: int) -> tuple:
    return (" ".join(niche.lower().split()), hours)


def _purge() -> None:
    cutoff = time.time() - JOB_TTL
    for k in [k for k, (t, _) in _cache.items() if t < time.time() - CACHE_TTL]:
        del _cache[k]
    for k in [k for k, j in _jobs.items() if j["created"] < cutoff]:
        del _jobs[k]


def _refund(user_id: int, day: str) -> None:
    """Rodada que não entregou nada (erro ou vazia) não gasta a cota do creator."""
    _runs[(user_id, day)] = max(_runs.get((user_id, day), 1) - 1, 0)


async def _work(job_id: str, user_id: int, niche: str, hours: int, day: str) -> None:
    job, t0 = _jobs[job_id], time.time()
    try:
        data, cost = await _ask_grok(niche, hours)
    except (httpx.HTTPError, ValueError, KeyError) as e:
        logger.warning("[radar] failed job=%s user=%s niche=%r: %s", job_id, user_id, niche, e)
        _refund(user_id, day)
        job.update(status="error", error="Não consegui pesquisar no X agora.")
        return
    trends = [t for t in data.get("trends", []) if isinstance(t, dict) and t.get("topic")][:4]
    _spend[day] = _spend.get(day, 0.0) + cost + (ANGLES_USD if trends else 0.0)
    if not trends:
        _refund(user_id, day)
        job.update(status="error", error="Não achei nada relevante nesse nicho agora. Tenta um tema mais específico.")
        return
    trends, _ = await _write_angles(niche, trends)
    _cache[_key(niche, hours)] = (time.time(), trends)
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
    _purge()
    job_id = secrets.token_urlsafe(12)
    job = {"user_id": user.id, "status": "pending", "niche": niche, "hours": hours, "created": time.time()}
    _jobs[job_id] = job
    card = {"status": "radar_pending", "radar": {"job_id": job_id, "niche": niche, "hours": hours}}

    hit = _cache.get(_key(niche, hours))
    if hit:  # já pesquisado há pouco: custo zero e não gasta a cota de ninguém
        job.update(status="ready", trends=hit[1])
        return {"started": True, "niche": niche}, card

    cap = settings.radar_daily_usd_cap
    if cap and _spend.get(day, 0.0) >= cap:
        del _jobs[job_id]
        logger.warning("[radar] daily usd cap reached: %.2f >= %.2f", _spend.get(day, 0.0), cap)
        return {"error": "radar_off", "message": "O radar está pausado por hoje. Volta amanhã."}, None
    if _runs.get((user.id, day), 0) >= settings.radar_max_runs_per_day:
        del _jobs[job_id]
        return {"error": "daily_limit", "message": "Chegou no limite de radares de hoje. Amanhã libera de novo."}, None
    _runs[(user.id, day)] = _runs.get((user.id, day), 0) + 1

    task = asyncio.create_task(_work(job_id, user.id, niche, hours, day))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return {"started": True, "niche": niche}, card


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
