from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import asyncio
import hashlib
import hmac
import logging
import re
from time import perf_counter
from typing import Deque, Dict

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from database import init_db
from database.database import create_tables
from database.database import get_db_session
from database.repository import DatabaseRepository
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from server.integrations.gemini_client import GeminiClient
from server.integrations.solana_client import SolanaClient
from server.integrations.stellar_adapter import StellarAdapter
from server.integrations.telegram_client import TelegramClient
from server.integrations.telegram_adapter import TelegramAdapter
from server.integrations.telegram_poller import TelegramPoller
from server.integrations.x_poller import XPoller
from server.integrations.x_adapter import XAdapter
from server.orchestration.service import OrchestrationService
from server.metrics import record_http_request, render_prometheus_metrics
from server.schemas import InboundMessage, OrchestrationResponse, SwapPrepareRequest, SwapPrepareResponse
from server.settings import settings
from server.rate_limiter import get_rate_limiter, reset_rate_limiter
from server.webhooks.helius_routes import router as helius_router
from server.campaigns_routes import resolve_optional_identity, router as campaigns_router
from server.notifications_routes import router as notifications_router
from server.routes.stellar_auth_routes import router as stellar_auth_router
from server.routes.stellar_routes import router as stellar_router
from server.routes.x402_routes import router as x402_router
from server.routes.agent_routes import router as agent_router
from server.routes.arc_routes import router as arc_router
from server.routes.arc_x402_routes import router as arc_x402_router
from server.routes.trust_routes import router as trust_router
from server.routes.cctp_routes import router as cctp_router
from server.routes.chat_sessions_routes import router as chat_sessions_router
from server import media_maintenance
from server.media_routes import router as media_router
from server.traction_routes import router as traction_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail fast on missing critical secrets before accepting any traffic
    import os as _os
    _missing = [v for v in ("JWT_SECRET", "STELLAR_SERVER_SECRET", "STELLAR_X402_WALLET") if not _os.getenv(v)]
    if _missing:
        logger.warning("[startup] Missing env vars (service may reject auth/payment): %s", ", ".join(_missing))

    init_db()
    await create_tables()
    await get_rate_limiter(redis_url=settings.redis_url or None)

    telegram_task: asyncio.Task | None = None
    if settings.telegram_bot_token and settings.telegram_poller_enabled:
        telegram_poller = TelegramPoller(
            bot_token=settings.telegram_bot_token,
            telegram_client=telegram_client,
            orchestrator=orchestrator,
        )
        telegram_task = asyncio.create_task(telegram_poller.start())
        logger.info("Telegram poller scheduled")
    elif settings.telegram_bot_token and not settings.telegram_poller_enabled:
        logger.info("Telegram poller DISABLED via TELEGRAM_POLLER_ENABLED=false")

    x_task: asyncio.Task | None = None
    x_poller = XPoller(orchestrator=orchestrator)
    x_task = asyncio.create_task(x_poller.start())
    logger.info("X poller scheduled")

    media_task = asyncio.create_task(media_maintenance.run_forever())

    # Restart resilience: mark any payment_intents that were left as 'pending'
    # (i.e. the process crashed before Arc could confirm) as 'failed' so they
    # can be retried.  Durable intent log guarantees idempotency on retry.
    try:
        import database.database as _db_mod
        from database.repository import DatabaseRepository as _Repo
        if _db_mod.SessionLocal is not None:
            async with _db_mod.SessionLocal() as _session:
                _repo = _Repo(_session)
                _stale = await _repo.list_stale_pending_intents()
                if _stale:
                    logger.warning(
                        "[startup] found %d stale pending payment_intents — marking as failed",
                        len(_stale),
                    )
                    for _intent in _stale:
                        await _repo.update_payment_intent(_intent.intent_id, status="failed")
    except Exception as _exc:
        logger.warning("[startup] could not check stale intents: %s", _exc)

    # Hidrata o feed de tração (server/metrics.py) a partir do DB — sem isso, o dashboard
    # que o júri vê zera a cada restart do backend mesmo com pagamentos reais confirmados.
    try:
        import database.database as _db_mod
        from database.repository import DatabaseRepository as _Repo
        from server.metrics import hydrate_traction as _hydrate_traction
        if _db_mod.SessionLocal is not None:
            async with _db_mod.SessionLocal() as _session:
                _repo = _Repo(_session)
                _settled = await _repo.list_settled_payments()
                _hydrate_traction([
                    {
                        "intent_id":      _p.intent_id,
                        "amount_usdc":    float(_p.amount_usdc),
                        "creator_handle": _p.creator_handle,
                        "tx":             _p.tx,
                        "latency_ms":     float(_p.latency_ms),
                        "ts":             _p.settled_at.isoformat(),
                    }
                    for _p in _settled
                ])
                if _settled:
                    logger.info("[startup] traction hydrated from DB: %d settled payments", len(_settled))
    except Exception as _exc:
        logger.warning("[startup] could not hydrate traction feed: %s", _exc)

    yield

    for task in (telegram_task, x_task, media_task):
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    reset_rate_limiter()


app = FastAPI(lifespan=lifespan)


def _sanitize_non_finite(obj):
    """Substitui float('nan')/inf/-inf por string antes de serializar.

    Starlette's JSONResponse usa json.dumps(..., allow_nan=False) (JSON estrito) —
    se um payload inválido (ex: amount=Infinity) chega a um erro 422 do FastAPI, o
    valor bruto rejeitado é ecoado de volta em `detail[].input` por padrão, e esse
    float não-finito faz o PRÓPRIO response de erro estourar um 500 não tratado.
    """
    if isinstance(obj, float) and (obj != obj or obj in (float("inf"), float("-inf"))):
        return "NaN" if obj != obj else ("Infinity" if obj > 0 else "-Infinity")
    if isinstance(obj, dict):
        return {k: _sanitize_non_finite(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_non_finite(v) for v in obj]
    return obj


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(request: Request, exc: RequestValidationError) -> Response:
    from fastapi.encoders import jsonable_encoder
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=422,
        content={"detail": _sanitize_non_finite(jsonable_encoder(exc.errors()))},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_origin_regex=settings.cors_allowed_origin_regex or None,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    # Headers restritos: configurados via CORS_ALLOWED_HEADERS (env).
    # Padrao: Content-Type, Authorization, Accept, X-Requested-With.
    # '*' apenas em dev local, nunca em producao.
    allow_headers=settings.cors_allowed_headers,
    expose_headers=["X-Payment-Required"],
)

app.include_router(helius_router)
app.include_router(campaigns_router)
app.include_router(notifications_router)
app.include_router(stellar_auth_router)
app.include_router(stellar_router)
app.include_router(x402_router)
app.include_router(agent_router)
app.include_router(arc_router)
app.include_router(arc_x402_router)
app.include_router(trust_router)
app.include_router(cctp_router)
app.include_router(chat_sessions_router)
app.include_router(media_router)
app.include_router(traction_router)

request_hits: Dict[str, Deque[datetime]] = defaultdict(deque)


@app.middleware("http")
async def collect_metrics(request: Request, call_next):
    started_at = perf_counter()
    response = await call_next(request)
    route_path = request.url.path
    if route_path != "/metrics":
        record_http_request(
            method=request.method,
            path=route_path,
            status_code=response.status_code,
            duration_seconds=perf_counter() - started_at,
        )
    return response


def _enforce_rate_limit(key: str):
    """
    Rate limit sincrono (legado) — usa in-memory para compatibilidade.
    Rotas novas devem usar `await _enforce_rate_limit_async(key)` diretamente.
    """
    # Usa in-memory diretamente para evitar problemas com event loop
    # O limiter Redis eh inicializado no lifespan e usado pelas rotas async
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(minutes=1)
    q = request_hits[key]
    while q and q[0] < window_start:
        q.popleft()
    if len(q) >= settings.inbound_rate_limit_per_minute:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    q.append(now)


async def _enforce_rate_limit_async(key: str) -> None:
    """Rate limit assíncrono — usa Redis (com fallback in-memory)."""
    limiter = await get_rate_limiter()
    await limiter.check(key=key, limit=settings.inbound_rate_limit_per_minute)


def _validate_x_signature(raw_body: bytes, provided_signature: str | None):
    if not settings.x_webhook_secret:
        return
    if not provided_signature:
        raise HTTPException(status_code=401, detail="Missing X signature")

    expected = hmac.new(
        settings.x_webhook_secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, provided_signature):
        raise HTTPException(status_code=401, detail="Invalid X signature")


def _validate_telegram_secret(provided_secret: str | None):
    if not settings.telegram_webhook_secret:
        return
    if not provided_secret:
        raise HTTPException(status_code=401, detail="Missing Telegram webhook secret")
    if not hmac.compare_digest(settings.telegram_webhook_secret, provided_secret):
        raise HTTPException(status_code=401, detail="Invalid Telegram webhook secret")

gemini_client = GeminiClient(api_key=settings.gemini_api_key, model=settings.gemini_model)
solana_client = SolanaClient(
    rpc_url=settings.solana_rpc_url,
    jupiter_quote_url=settings.jupiter_quote_url,
    jupiter_swap_url=settings.jupiter_swap_url,
)
stellar_client = StellarAdapter(
    network=settings.stellar_network,
    horizon_url=settings.stellar_horizon_url,
)
orchestrator = OrchestrationService(gemini=gemini_client, solana=solana_client, stellar=stellar_client)
telegram_adapter = TelegramAdapter()
x_adapter = XAdapter()
telegram_client = TelegramClient(bot_token=settings.telegram_bot_token)


@app.get("/health")
async def health():
    try:
        rpc_health = await solana_client.get_health()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Solana RPC unavailable: {exc}") from exc

    return {
        "status": "ok",
        "service": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
        "solana_cluster": settings.solana_cluster,
        "rpc_health": rpc_health,
        "gemini_enabled": gemini_client.enabled,
    }


@app.get("/health/detailed")
async def health_detailed(db: AsyncSession = Depends(get_db_session)):
    """Health check granular com status de cada dependência e latência medida."""
    results: dict = {}

    # 1. Database
    try:
        from sqlalchemy import text as _text
        t0 = perf_counter()
        await db.execute(_text("SELECT 1"))
        db_latency = perf_counter() - t0
        results["database"] = {"status": "ok", "latency_ms": round(db_latency * 1000, 2)}
    except Exception as exc:
        results["database"] = {"status": "error", "detail": str(exc)}

    # 2. Solana RPC
    try:
        t0 = perf_counter()
        rpc_health = await asyncio.wait_for(solana_client.get_health(), timeout=5.0)
        results["solana_rpc"] = {
            "status": "ok",
            "latency_ms": round((perf_counter() - t0) * 1000, 2),
            "cluster": settings.solana_cluster,
            "rpc_response": rpc_health,
        }
    except asyncio.TimeoutError:
        results["solana_rpc"] = {"status": "timeout", "detail": "RPC did not respond within 5s"}
    except Exception as exc:
        results["solana_rpc"] = {"status": "error", "detail": str(exc)}

    # 3. Gemini
    results["gemini"] = {
        "status": "enabled" if gemini_client.enabled else "disabled",
        "model": settings.gemini_model,
    }

    # 4. Jupiter API (quote endpoint reachable)
    try:
        t0 = perf_counter()
        # Verifica apenas conectividade com um quote minimo
        test_quote = await asyncio.wait_for(
            solana_client.get_swap_quote(
                input_mint="4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
                output_mint="So11111111111111111111111111111111111111112",
                amount_raw=1_000_000,
            ),
            timeout=5.0,
        )
        results["jupiter"] = {
            "status": "ok",
            "latency_ms": round((perf_counter() - t0) * 1000, 2),
            "out_amount_raw": test_quote.get("outAmount"),
        }
    except asyncio.TimeoutError:
        results["jupiter"] = {"status": "timeout", "detail": "Jupiter did not respond within 5s"}
    except Exception as exc:
        results["jupiter"] = {"status": "error", "detail": str(exc)}

    # 5. Stellar Horizon
    try:
        t0 = perf_counter()
        stellar_health = await asyncio.wait_for(stellar_client.get_health(), timeout=8.0)
        results["stellar_horizon"] = {
            "status": stellar_health.get("status", "ok"),
            "latency_ms": round((perf_counter() - t0) * 1000, 2),
            "network": stellar_health.get("network"),
            "latest_ledger": stellar_health.get("history_latest_ledger"),
        }
    except asyncio.TimeoutError:
        results["stellar_horizon"] = {"status": "timeout", "detail": "Horizon did not respond within 8s"}
    except Exception as exc:
        results["stellar_horizon"] = {"status": "error", "detail": str(exc)}

    overall = "ok" if all(v.get("status") in {"ok", "enabled", "disabled"} for v in results.values()) else "degraded"
    return {
        "status": overall,
        "service": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
        "dependencies": results,
    }


@app.get("/status")
async def status():
    return {"status": "running"}


@app.get("/metrics")
async def metrics():
    return Response(render_prometheus_metrics(), media_type="text/plain; version=0.0.4; charset=utf-8")


_SYSTEM_NOTE_RE = re.compile(r"\[System Note:[^\]]+\]\s*")


async def _process_inbound(
    platform: str,
    user_id: str,
    text: str,
    db: AsyncSession,
    metadata: dict | None = None,
    session_id: str | None = None,
) -> OrchestrationResponse:
    repo = DatabaseRepository(db)
    user = await repo.get_or_create_user(platform, user_id)
    if platform == "telegram" and metadata and metadata.get("chat_id"):
        await repo.set_telegram_chat_id(user.id, metadata["chat_id"])
    # 30, não 10: um fluxo guiado (ex. criar campanha por chat) leva ~8-9
    # idas e vindas — campo por campo — antes de confirmar. Com janela de 10
    # mensagens, as primeiras respostas (título, tipo) saíam do histórico
    # antes da hora de criar, e o modelo perguntava tudo de novo.
    history = await repo.get_user_history(user.id, limit=30, session_id=session_id)
    # `text` pode trazer um `[System Note: ...]` de contexto (wallet conectada,
    # etc.) prefixado por /chat — o orchestrator precisa dele, mas a mensagem
    # gravada é o que a pessoa releria depois (histórico salvo, troca de tela),
    # e ninguém digitou aquele prefixo.
    await repo.log_dm(
        user.id, platform, _SYSTEM_NOTE_RE.sub("", text).strip(), message_type="user", session_id=session_id
    )
    # Commita antes de chamar o agente: as tools de campanha (`create_campaign`
    # etc., em `OrchestrationService`) abrem uma conexão SQLite própria — se
    # essa escrita do log ficasse pendente aqui, as duas conexões do mesmo
    # processo colidiam com "database is locked" (SQLite só aceita um escritor
    # por vez, mesmo entre conexões diferentes). Sem custo real: é só a mesma
    # transação cortada em duas, a resposta do bot commita normalmente no fim.
    await db.commit()

    result = await orchestrator.execute(text, user_id, history=history, platform=platform)

    await repo.log_dm(user.id, platform, result["reply_text"], message_type="bot", session_id=session_id)
    if session_id:
        await repo.touch_chat_session(int(session_id))
    await db.commit()

    return OrchestrationResponse(
        platform=platform,
        user_id=user_id,
        intent=result["intent"],
        reply_text=result["reply_text"],
        execution=result["execution"],
    )


@app.post("/v1/messages/inbound", response_model=OrchestrationResponse)
async def inbound_message(payload: InboundMessage, db: AsyncSession = Depends(get_db_session)):
    _enforce_rate_limit(f"inbound:{payload.platform}:{payload.user_id}")

    return await _process_inbound(
        platform=payload.platform,
        user_id=payload.user_id,
        text=payload.text,
        db=db,
        metadata=payload.metadata,
    )


@app.post("/chat")
async def chat_compat(
    payload: dict,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    """Compatibility endpoint used by the current frontend chat hook."""
    text = str(payload.get("message", "")).strip()
    if not text:
        raise HTTPException(status_code=400, detail="message is required")
    # Título da sessão vem do que a pessoa digitou — antes de qualquer prefixo
    # de contexto (wallet/stellar) entrar em `text` abaixo, senão o título vira
    # "[System Note: User connected wallet is 0x..." em vez da mensagem.
    title = text[:40] + ("…" if len(text) > 40 else "")

    wallet_address = payload.get("wallet_address")
    if wallet_address:
        wallet_chain = payload.get("wallet_chain")
        chain_suffix = f" on {wallet_chain}" if wallet_chain else ""
        text = f"[System Note: User connected wallet is {wallet_address}{chain_suffix}] {text}"

    stellar_wallet = payload.get("stellar_wallet")
    if stellar_wallet:
        text = f"[System Note: Stellar wallet {stellar_wallet}] {text}"

    user_id = await resolve_optional_identity(db, authorization) or str(payload.get("user_id", "web_anonymous"))
    platform = str(payload.get("platform", "web"))

    _enforce_rate_limit(f"chat:{platform}:{user_id}")

    repo = DatabaseRepository(db)
    chat_session_id = payload.get("session_id")
    if not chat_session_id:
        user = await repo.get_or_create_user(platform, user_id)
        chat_session = await repo.create_chat_session(user.id, title=title)
        await db.commit()
        chat_session_id = chat_session.id
    else:
        # Sessão pode ter sido criada vazia pelo botão "New chat" (sem texto
        # ainda para titular) — se esta é a primeira mensagem dela, titula
        # agora. Sem isto toda sessão aberta pelo botão fica "New chat" para
        # sempre, porque o ramo acima (que titula) só roda quando o cliente
        # NÃO manda session_id — e o botão sempre manda.
        existing_messages = await repo.get_session_messages(int(chat_session_id))
        if not existing_messages:
            await repo.rename_chat_session(int(chat_session_id), title)
            await db.commit()

    result = await _process_inbound(
        platform=platform, user_id=user_id, text=text, db=db, session_id=str(chat_session_id)
    )

    # Keep legacy response shape consumed by frontend ChatPanel.
    return {
        "response": [{"type": "text", "content": result.reply_text}],
        "intent": result.intent.model_dump(),
        "execution": result.execution,
        "code": None,
        "animations": result.execution.get("animation"),
        "session_id": chat_session_id,
    }


@app.post("/v1/integrations/telegram/webhook", response_model=OrchestrationResponse)
async def telegram_webhook(
    update: dict,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db_session)
):
    _validate_telegram_secret(x_telegram_bot_api_secret_token)
    normalized = telegram_adapter.normalize_update(update)
    if not normalized.get("text"):
        raise HTTPException(status_code=400, detail="No text message in Telegram update")

    _enforce_rate_limit(f"telegram:{normalized['user_id']}")

    result = await _process_inbound(
        platform="telegram",
        user_id=normalized["user_id"],
        text=normalized["text"],
        db=db,
        metadata=normalized.get("metadata", {}),
    )

    chat_id = normalized.get("metadata", {}).get("chat_id")
    if chat_id and result.reply_text:
        try:
            await telegram_client.send_message(chat_id, result.reply_text)
        except Exception as exc:
            logger.error("Failed to send Telegram reply to chat %s: %s", chat_id, exc)

    return result


@app.post("/v1/integrations/x/webhook", response_model=OrchestrationResponse)
async def x_webhook(
    request: Request,
    x_xiaolee_signature: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db_session)
):
    raw_body = await request.body()
    _validate_x_signature(raw_body, x_xiaolee_signature)

    try:
        event = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    normalized = x_adapter.normalize_event(event)
    if not normalized.get("text"):
        raise HTTPException(status_code=400, detail="No DM text found in X event")

    _enforce_rate_limit(f"x:{normalized['user_id']}")

    return await _process_inbound(
        platform="x",
        user_id=normalized["user_id"],
        text=normalized["text"],
        db=db,
    )


@app.post("/v1/solana/swap/prepare", response_model=SwapPrepareResponse)
async def prepare_swap(payload: SwapPrepareRequest):
    quote = await solana_client.get_swap_quote(
        input_mint=payload.input_mint,
        output_mint=payload.output_mint,
        amount_raw=payload.amount_raw,
        slippage_bps=payload.slippage_bps,
    )
    swap_data = await solana_client.prepare_swap_transaction(
        quote_response=quote,
        user_public_key=payload.user_public_key,
    )

    swap_tx = swap_data.get("swapTransaction")
    if not swap_tx:
        raise HTTPException(status_code=502, detail="Jupiter did not return swap transaction")

    return SwapPrepareResponse(
        cluster=settings.solana_cluster,
        quote=quote,
        swap_transaction_base64=swap_tx,
        last_valid_block_height=swap_data.get("lastValidBlockHeight"),
        disclaimer="Transacao somente preparada. Assine na wallet e confirme antes do envio.",
    )
