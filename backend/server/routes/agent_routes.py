"""
agent_routes.py — Rotas do loop agêntico de campanhas.

POST /v1/agent/run-campaign          → Dispara o agente (background task)
GET  /v1/agent/run-campaign/{run_id}/status → Consulta status do run
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db_session
from database.models import PaymentIntent
from database.repository import DatabaseRepository
from server.integrations.arc_client import ArcClient
from server.settings import settings

# Imports pesados em lazy para não quebrar testes unitários que importam este módulo
# via cadeia server/__init__ → app.py → agent_routes.py → ai/__init__ → mcp_tools → web3
def _lazy_tools():
    from ai.agents.creator_pay_tools import CREATOR_PAY_TOOLS, make_tool_executors  # noqa
    return CREATOR_PAY_TOOLS, make_tool_executors

def _lazy_engine():
    from claude_agent import ClaudeAgentEngine  # noqa
    return ClaudeAgentEngine

def _lazy_cctp_tools():
    from ai.agents.cctp_tools import CCTP_TOOLS, make_cctp_tool_executors  # noqa
    return CCTP_TOOLS, make_cctp_tool_executors

LOG = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/agent", tags=["agent"])

# ---------------------------------------------------------------------------
# In-memory run registry (keyed by run_id)
# Replaced by DB persistence in D4 when restart resilience is needed.
# ---------------------------------------------------------------------------
_RUNS: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class RunCampaignRequest(BaseModel):
    campaign_id: int
    # allow_inf_nan=False: sem isso, budget_usdc=Infinity passaria pelo guard manual
    # "<= 0" no handler (inf <= 0 é False) e o agente rodaria com orçamento efetivamente
    # ilimitado; NaN também escapa do mesmo guard (nan <= 0 é False).
    budget_usdc: float = Field(gt=0, allow_inf_nan=False)
    criteria: dict = {}
    reward_per_creator_usdc: float = Field(default=5.0, gt=0, allow_inf_nan=False)


class RunCampaignResponse(BaseModel):
    agent_run_id: str
    campaign_id: int
    budget_usdc: float
    status: str
    message: str


class AgentStatusResponse(BaseModel):
    agent_run_id: str
    campaign_id: int
    status: str
    steps_count: int
    payments_count: int
    total_paid_usdc: float
    payments: list[dict]
    steps: list[dict]
    final_message: str
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Background task
# ---------------------------------------------------------------------------


async def _run_agent_task(
    run_id: str,
    campaign_id: int,
    budget_usdc: float,
    reward_per_creator: float,
    db_session_factory,
) -> None:
    """Executa o loop agêntico em background e atualiza _RUNS."""
    _RUNS[run_id]["status"] = "running"

    try:
        async with db_session_factory() as session:
            repo = DatabaseRepository(session)

            arc = ArcClient(
                api_key=settings.circle_api_key,
                wallet_id=settings.circle_wallet_id,
                sandbox=settings.arc_sandbox,
            )

            CREATOR_PAY_TOOLS, make_tool_executors = _lazy_tools()
            ClaudeAgentEngine = _lazy_engine()

            # Orçamento compartilhado entre pay_creator_nanopayment (Arc) e
            # payout_cross_chain_nanopayment (Solana/Stellar via CCTP real) — nunca dois
            # trackers separados, ou o agente poderia gastar 2x o budget da campanha.
            spent_tracker = {"usdc": 0.0}

            executors = make_tool_executors(
                repo=repo,
                arc_client=arc,
                campaign_id=campaign_id,
                budget_usdc=budget_usdc,
                reward_per_creator=reward_per_creator,
                spent_tracker=spent_tracker,
            )

            tools = list(CREATOR_PAY_TOOLS)
            cross_chain_enabled = settings.solana_cctp_enabled or settings.stellar_cctp_enabled
            cross_chain_prompt = ""
            if cross_chain_enabled:
                from server.integrations.cctp_client import CCTPClient
                from server.integrations.solana_cctp import SolanaCCTPClient
                from server.integrations.stellar_cctp import StellarCCTPClient

                CCTP_TOOLS, make_cctp_tool_executors = _lazy_cctp_tools()

                arc_cctp = CCTPClient(
                    source_rpc=settings.arc_rpc_url,
                    signer_key=settings.arc_agent_private_key,
                    source_domain=settings.arc_cctp_domain,
                    source_usdc=settings.arc_usdc_address,
                    source_token_messenger=settings.arc_cctp_token_messenger,
                    sandbox=settings.bridge_sandbox,
                    abi_version=2,  # Arc é CCTP V2-only — a ABI V1 nem existe no contrato
                )
                solana_cctp = SolanaCCTPClient(
                    rpc_url=settings.solana_rpc_url,
                    treasury_keypair_b58=settings.solana_treasury_keypair_b58,
                    usdc_mint=settings.solana_usdc_mint,
                    sandbox=settings.bridge_sandbox,
                )
                stellar_cctp = StellarCCTPClient(
                    treasury_secret=settings.stellar_treasury_secret,
                    network=settings.stellar_network,
                    sandbox=settings.bridge_sandbox,
                )
                cctp_executors = make_cctp_tool_executors(
                    repo=repo,
                    arc_cctp_client=arc_cctp,
                    solana_cctp_client=solana_cctp,
                    stellar_cctp_client=stellar_cctp,
                    campaign_id=campaign_id,
                    budget_usdc=budget_usdc,
                    reward_per_creator=reward_per_creator,
                    spent_tracker=spent_tracker,
                )
                executors.update(cctp_executors)
                tools = tools + CCTP_TOOLS
                cross_chain_prompt = (
                    "\nCROSS-CHAIN: some creators have chain='solana' or chain='stellar' "
                    "(check the `chain` field from discover_creators/evaluate_creator). For "
                    "those, call payout_cross_chain_nanopayment instead of "
                    "pay_creator_nanopayment, passing destination_chain accordingly. Budget "
                    "is shared across both tools — check_budget still reflects the true total.\n"
                )

            engine = ClaudeAgentEngine(
                tools=tools,
                executors=executors,
                max_steps=settings.agent_max_steps,
                api_key=settings.anthropic_api_key,
                model=settings.claude_model,
            )

            system_prompt = (
                f"You are XiaoLee Agent, an autonomous marketing AI managing campaign #{campaign_id}.\n"
                f"Available budget: ${budget_usdc:.2f} USDC | Baseline reward per creator: ${reward_per_creator:.2f} USDC.\n\n"
                "Your mission:\n"
                f"1. Call discover_creators with campaign_id={campaign_id} to find enrolled participants.\n"
                "2. For each creator, call evaluate_creator to check eligibility (score >= 50).\n"
                "3. Before each payment, call check_budget to verify remaining funds.\n"
                "4. For eligible creators with sufficient budget, call pay_creator_nanopayment.\n"
                "   - Decide amount_usdc yourself, scaled to the creator's score around the baseline:\n"
                f"       score 50-69  -> ~0.7x baseline (${reward_per_creator * 0.7:.2f})\n"
                f"       score 70-89  -> ~1.0x baseline (${reward_per_creator:.2f})\n"
                f"       score 90-100 -> ~1.4x baseline (${reward_per_creator * 1.4:.2f})\n"
                "     Use judgment, not a rigid lookup — these are anchors, not exact rules.\n"
                "   - Generate a fresh UUID v4 for intent_id each time.\n"
                "5. Stop when check_budget returns can_pay=false OR no more eligible creators.\n"
                f"{cross_chain_prompt}\n"
                "RULES:\n"
                "- Never pay a creator marked as already_paid=true.\n"
                "- Always generate a new UUID v4 for each intent_id.\n"
                "- If budget_exhausted=true is returned, stop immediately.\n"
                "- If a payment amount would exceed the remaining budget, scale it down to fit rather than skipping the creator.\n"
                "- After processing all creators, summarize: how many paid, total USDC spent, and briefly explain your reward scaling decisions."
            )

            result = await engine.run(system_prompt, context={"campaign_id": campaign_id})

        _RUNS[run_id].update(
            {
                "status": result.status,
                "steps": [
                    {
                        "step": s.step,
                        "tool_name": s.tool_name,
                        "tool_input": s.tool_input,
                        "tool_result": s.tool_result,
                    }
                    for s in result.steps
                ],
                "payments": result.payments,
                "total_paid_usdc": result.total_paid_usdc,
                "final_message": result.final_message,
                "error": result.error,
            }
        )
        LOG.info(
            "[agent_routes] run_id=%s finished status=%s payments=%d total_usdc=%.4f",
            run_id,
            result.status,
            len(result.payments),
            result.total_paid_usdc,
        )

    except Exception as exc:
        LOG.exception("[agent_routes] run_id=%s crashed: %s", run_id, exc)
        _RUNS[run_id].update({"status": "failed", "error": str(exc)})


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


async def _caller_id(db: AsyncSession, authorization: Optional[str]) -> str:
    """twitter_user_id do Bearer, só se o backend o emitiu (o id público não vale)."""
    from server.campaigns_routes import resolve_twitter_identity  # lazy: evita import circular

    return (await resolve_twitter_identity(db, authorization, strict=True))[0]


async def _enforce_agent_money_guards(db: AsyncSession, campaign, budget_usdc: float) -> None:
    """Travas de dinheiro real do agente: kill switch, teto por pool e teto diário (24h).

    ponytail: o teto diário do agente soma só `payment_intents`; o dos claims soma
    `campaign_participants.paid_at`. Cada um respeita `PAYOUT_DAILY_BUDGET_USDC` sozinho,
    então o gasto total pode chegar a 2x — unificar num contador se o volume crescer.
    """
    if not settings.payouts_enabled:
        raise HTTPException(status_code=503, detail="Payouts are paused right now.")
    if budget_usdc > float(campaign.reward_pool):
        raise HTTPException(status_code=400, detail="budget_usdc exceeds the campaign reward pool.")
    spent = await db.execute(
        select(func.coalesce(func.sum(PaymentIntent.amount_usdc), 0)).where(
            PaymentIntent.status != "failed",
            PaymentIntent.created_at >= datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24),
        )
    )
    # Reserva o orçamento inteiro do run, não só o que ele já gastou: o agente pode pagar tudo.
    if float(spent.scalar() or 0) + budget_usdc > settings.payout_daily_budget_usdc:
        raise HTTPException(status_code=400, detail="The daily payout budget would be exceeded.")


@router.post("/run-campaign", response_model=RunCampaignResponse)
async def run_campaign(
    payload: RunCampaignRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db_session),
    authorization: Optional[str] = Header(default=None),
):
    """
    Dispara o agente de campanha em background.
    Retorna imediatamente com agent_run_id para polling de status.

    O agente paga da tesouraria, então só o criador da campanha (token emitido pelo
    backend) dispara — e, fora do sandbox, com as mesmas travas dos claims.
    """
    if payload.budget_usdc <= 0:
        raise HTTPException(status_code=400, detail="budget_usdc must be positive")
    if payload.campaign_id <= 0:
        raise HTTPException(status_code=400, detail="campaign_id must be positive")

    from server.campaigns_routes import _creator_campaign  # lazy: evita import circular

    user, campaign = await _creator_campaign(db, authorization, payload.campaign_id)
    if not settings.arc_sandbox:
        await _enforce_agent_money_guards(db, campaign, payload.budget_usdc)

    from database.database import SessionLocal  # lazy to avoid circular
    import uuid as _uuid

    run_id = str(_uuid.uuid4())
    _RUNS[run_id] = {
        "owner": user.twitter_user_id,
        "status": "pending",
        "campaign_id": payload.campaign_id,
        "budget_usdc": payload.budget_usdc,
        "steps": [],
        "payments": [],
        "total_paid_usdc": 0.0,
        "final_message": "",
        "error": None,
    }

    background_tasks.add_task(
        _run_agent_task,
        run_id=run_id,
        campaign_id=payload.campaign_id,
        budget_usdc=payload.budget_usdc,
        reward_per_creator=payload.reward_per_creator_usdc,
        db_session_factory=SessionLocal,
    )

    LOG.info(
        "[agent_routes] queued run_id=%s campaign=%d budget=%.2f",
        run_id,
        payload.campaign_id,
        payload.budget_usdc,
    )

    return RunCampaignResponse(
        agent_run_id=run_id,
        campaign_id=payload.campaign_id,
        budget_usdc=payload.budget_usdc,
        status="pending",
        message=f"Agent started for campaign #{payload.campaign_id}. Poll /v1/agent/run-campaign/{run_id}/status for progress.",
    )


@router.get("/run-campaign/{run_id}/status", response_model=AgentStatusResponse)
async def get_run_status(
    run_id: str,
    db: AsyncSession = Depends(get_db_session),
    authorization: Optional[str] = Header(default=None),
):
    """Consulta o status de um run do agente — só quem o disparou (traz destinatários e txs)."""
    owner = await _caller_id(db, authorization)
    run = _RUNS.get(run_id)
    if run and run.get("owner") != owner:
        run = None  # mesmo 404 de run inexistente: não confirma que o id existe
    if not run:
        raise HTTPException(
            status_code=404,
            detail=f"Agent run {run_id} not found. Runs are stored in-memory and reset on server restart.",
        )

    return AgentStatusResponse(
        agent_run_id=run_id,
        campaign_id=run.get("campaign_id", 0),
        status=run.get("status", "unknown"),
        steps_count=len(run.get("steps", [])),
        payments_count=len(run.get("payments", [])),
        total_paid_usdc=run.get("total_paid_usdc", 0.0),
        payments=run.get("payments", []),
        steps=run.get("steps", []),
        final_message=run.get("final_message", ""),
        error=run.get("error"),
    )


@router.get("/runs")
async def list_runs(
    db: AsyncSession = Depends(get_db_session),
    authorization: Optional[str] = Header(default=None),
):
    """Lista os runs ativos do chamador (debug)."""
    owner = await _caller_id(db, authorization)
    return {
        "runs": [
            {
                "run_id": run_id,
                "campaign_id": data.get("campaign_id"),
                "status": data.get("status"),
                "payments_count": len(data.get("payments", [])),
                "total_paid_usdc": data.get("total_paid_usdc", 0.0),
            }
            for run_id, data in _RUNS.items()
            if data.get("owner") == owner
        ]
    }
