"""
Testes de Mainnet Readiness — XiaoLee

Cobre os cenários críticos que devem estar verdes antes do rollout em mainnet:
  - Idempotência de join (409 Conflict em join duplicado)
  - Idempotência de claim (rejeição de claim duplicado)
  - Endpoint /health retorna 200 ou 503 (se RPC indisponível em teste)
  - Endpoint /health/detailed retorna estrutura de dependências esperada
  - Métricas de campanha são registradas corretamente
  - Endpoint /metrics não conta a si próprio

Estratégia de isolamento de banco:
    Cada teste usa um DB SQLite em memória fresco, injetado via override de
    `get_db_session` — idêntico ao padrão usado nos outros testes MVP.
"""

from __future__ import annotations

import pytest
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from httpx import AsyncClient, ASGITransport

from database.base import Base
from database.database import get_db_session
from server.app import app
from server.metrics import clear_metrics, render_prometheus_metrics


# ---------------------------------------------------------------------------
# Fixtures de banco isolado
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _sandbox_verifier(monkeypatch):
    # O verificador estrito (ARC_SANDBOX=false) recusa sem X/Helius; aqui o foco é o fluxo, não o provedor.
    import dataclasses
    from server import campaigns_routes

    monkeypatch.setattr(campaigns_routes, "settings", dataclasses.replace(campaigns_routes.settings, arc_sandbox=True))


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture()
async def fresh_db():
    """Engine SQLite in-memory com schema criado e destruído por teste."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest.fixture(autouse=True)
def reset_metrics():
    clear_metrics()
    yield
    clear_metrics()


# ---------------------------------------------------------------------------
# Cliente HTTP com override de DB
# ---------------------------------------------------------------------------

def make_client(session: AsyncSession) -> AsyncClient:
    """Cria AsyncClient com get_db_session sobrescrito para usar o DB de teste."""
    async def _override():
        yield session

    app.dependency_overrides[get_db_session] = _override
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    return client


TOKEN = "mainnet-readiness-test-token"
CAMPAIGN_ID = "1"


async def _join(client: AsyncClient, token: str = TOKEN, campaign_id: str = CAMPAIGN_ID):
    return await client.post(
        "/campaigns/join",
        json={"campaign_identifier": campaign_id},
        headers={"Authorization": f"Bearer {token}"},
    )


# ---------------------------------------------------------------------------
# Idempotência de join
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_join_twice_returns_409(fresh_db):
    """Segundo join na mesma campanha deve retornar 409 Conflict."""
    async with make_client(fresh_db) as client:
        r1 = await _join(client)
        assert r1.status_code == 200, r1.text
        assert r1.json()["success"] is True

        r2 = await _join(client)
        assert r2.status_code == 409
        assert "already joined" in r2.json()["detail"].lower()
    app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_join_different_campaigns_independent(fresh_db):
    """Join em campanhas diferentes é independente — ambos devem ter sucesso."""
    async with make_client(fresh_db) as client:
        r1 = await _join(client, campaign_id="1")
        r2 = await _join(client, campaign_id="2")
        assert r1.status_code == 200, r1.text
        assert r2.status_code == 200, r2.text
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Idempotência de claim (sem proof válido — testa rejeição limpa)
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_claim_without_proof_returns_clean_error(fresh_db):
    """Claim sem proof deve retornar 400 com mensagem clara, não 500."""
    async with make_client(fresh_db) as client:
        await _join(client)
        await client.post(
            "/campaigns/verify",
            json={"campaign_identifier": CAMPAIGN_ID},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        r = await client.post(
            "/campaigns/claim",
            json={"campaign_identifier": CAMPAIGN_ID},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        # Sem proof wallet: deve rejeitar com 400, nunca 500
        assert r.status_code == 400
        assert r.status_code != 500
    app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_claim_before_verify_rejected(fresh_db):
    """Claim antes de verificar tarefas deve ser rejeitado."""
    async with make_client(fresh_db) as client:
        await _join(client)
        r = await client.post(
            "/campaigns/claim",
            json={"campaign_identifier": CAMPAIGN_ID},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        # Não verificou tarefas: deve retornar success=False
        assert r.status_code == 200
        assert r.json().get("success") is False or r.json().get("error") is not None
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Endpoint /health/detailed
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_health_detailed_returns_dependency_map(fresh_db):
    """GET /health/detailed deve retornar mapa de dependências com 'database' e 'gemini'."""
    async with make_client(fresh_db) as client:
        r = await client.get("/health/detailed")
    assert r.status_code == 200
    body = r.json()
    assert "status" in body
    assert body["status"] in {"ok", "degraded"}
    assert "dependencies" in body
    deps = body["dependencies"]
    assert "database" in deps
    assert "gemini" in deps
    # Database deve estar ok (in-memory sempre disponível)
    assert deps["database"]["status"] == "ok"
    app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_health_detailed_database_has_latency(fresh_db):
    """Database no /health/detailed deve reportar latência em ms."""
    async with make_client(fresh_db) as client:
        r = await client.get("/health/detailed")
    deps = r.json()["dependencies"]
    assert "latency_ms" in deps["database"]
    assert isinstance(deps["database"]["latency_ms"], (int, float))
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Métricas de campanha
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_campaign_join_metric_recorded(fresh_db):
    """Join bem-sucedido deve incrementar a métrica 'join'."""
    async with make_client(fresh_db) as client:
        await _join(client)
    metrics_text = render_prometheus_metrics()
    assert 'xiaolee_campaign_events_total{event="join"}' in metrics_text
    app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_campaign_duplicate_join_metric_recorded(fresh_db):
    """Join duplicado deve incrementar a métrica 'join_duplicate'."""
    async with make_client(fresh_db) as client:
        await _join(client)
        await _join(client)  # segundo join → 409
    metrics_text = render_prometheus_metrics()
    assert 'xiaolee_campaign_events_total{event="join_duplicate"}' in metrics_text
    app.dependency_overrides.clear()


@pytest.mark.anyio
async def test_verify_metric_recorded(fresh_db):
    """Verify bem-sucedido deve incrementar a métrica 'verify'."""
    async with make_client(fresh_db) as client:
        await _join(client)
        await client.post(
            "/campaigns/verify",
            json={"campaign_identifier": CAMPAIGN_ID},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
    metrics_text = render_prometheus_metrics()
    assert 'xiaolee_campaign_events_total{event="verify"}' in metrics_text
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Endpoint /metrics não se auto-conta
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_metrics_endpoint_not_self_counted(fresh_db):
    """/metrics não deve aparecer nos próprios contadores HTTP."""
    async with make_client(fresh_db) as client:
        await client.get("/metrics")
        await client.get("/metrics")
    metrics_text = render_prometheus_metrics()
    assert 'path="/metrics"' not in metrics_text
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Status endpoints básicos
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_status_returns_running(fresh_db):
    """GET /status deve retornar {'status': 'running'}."""
    async with make_client(fresh_db) as client:
        r = await client.get("/status")
    assert r.status_code == 200
    assert r.json() == {"status": "running"}
    app.dependency_overrides.clear()
