"""
test_creator_report.py — relatório de 30 dias do creator (server/creator_report.py + /v1/reports).

Regras que estes testes travam:
- as métricas vêm do banco, só do período e só do usuário (upload pendente não conta, mídia expirada conta);
- USDC recebido soma pagamentos do agente (@handle) e transferências para a wallet vinculada;
- quem é "devido": creator com 30 dias desde o último relatório (ou de conta, se nunca teve);
- o relatório só sai com resumo + pelo menos 1 sugestão da IA; falha da IA não grava nada;
- sai junto uma notificação in-app que aponta para o relatório;
- o idioma do relatório sai dos vídeos do creator (pt/en) e vale também para o texto da notificação;
- quem falha entra em espera crescente, não volta ao lote antes da hora e não segura os outros; provedor fora
  para o ciclo sem castigar ninguém;
- a rota só mostra relatório do dono.
O modelo é simulado.
"""
from __future__ import annotations

import importlib
import json
import os
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

os.environ.setdefault("JWT_SECRET", "route-test-jwt-secret-32-chars-ok")
os.environ.setdefault("ENCRYPTION_KEY", "route-test-encryption-key-xxxxxx")

from database import database as dbmod
from database.database import get_db_session
from database.models import (
    ArcTransfer, CampaignParticipant, Campaign, CreatorReport, MediaAsset, MediaClip, MediaTranscript,
    NotificationEvent, SettledPayment, User, Wallet, WebSession,
)
from server import clipper, creator_report

app_module = importlib.import_module("server.app")
client = TestClient(app_module.app)

NOW = datetime(2026, 10, 16, 12, 0, 0)
DAY = timedelta(days=1)
GOOD = {
    "summary": "You uploaded 2 videos and got 3 clips.",
    "suggestions": [{"title": "Post every week.", "action": "Upload one video per week", "why": "2 videos in 30 days"}],
}


@pytest_asyncio.fixture
async def db(db_session, test_engine, monkeypatch):
    async def _override():
        yield db_session

    app_module.app.dependency_overrides[get_db_session] = _override
    monkeypatch.setattr(dbmod, "SessionLocal", async_sessionmaker(test_engine, expire_on_commit=False))
    yield db_session
    app_module.app.dependency_overrides.pop(get_db_session, None)


async def _user(db, name: str, created=NOW - 40 * DAY, interests='["defi"]') -> User:
    u = User(twitter_handle=name, twitter_user_id=f"privy_{name}", interest_profile=interests, created_at=created)
    db.add(u)
    await db.commit()
    return u


def _asset(user_id, created, status="transcribed", duration=120.0, title=None):
    return MediaAsset(user_id=user_id, kind="video", filename=f"v{created.timestamp()}.mp4", content_type="video/mp4",
                      size_bytes=1, r2_key=f"k/{user_id}/{created.timestamp()}/{status}", status=status,
                      duration_s=duration, title=title, created_at=created)


@pytest.fixture(autouse=True)
def _clear_retry():
    creator_report._retry.clear()
    yield
    creator_report._retry.clear()


async def _transcribed(db, user_id: int, languages: list) -> None:
    """Um vídeo transcrito por idioma, do mais antigo para o mais novo."""
    for i, language in enumerate(languages):
        asset = _asset(user_id, NOW - (len(languages) - i) * DAY)
        db.add(asset)
        await db.flush()
        db.add(MediaTranscript(media_id=asset.id, segments_json="[]", language=language, model="m"))
    await db.commit()


def _ai(monkeypatch, out=GOOD, calls=None):
    async def _call_tool(system, tool, content, max_tokens):
        if calls is not None:
            calls.append((system, tool["name"], content))
        return out

    monkeypatch.setattr(clipper, "_call_tool", _call_tool)


# ── validação e prompt ───────────────────────────────────────────────────────

def test_validate_cleans_dedupes_and_limits():
    item = {"title": "Post weekly", "action": "a", "why": "w"}
    raw = {"summary": "  ok\n month ", "suggestions": [
        item, {**item, "title": "POST WEEKLY"}, {"title": "no why", "action": "a", "why": ""}, "junk",
        {"title": "T" * 100, "action": "x" * 500, "why": "y" * 500}, {**item, "title": "Third"}, {**item, "title": "Fourth"},
    ]}
    out = creator_report.validate_insights(raw)
    assert out.summary == "ok month"
    assert [s.title for s in out.suggestions] == ["Post weekly", "T" * 60, "Third"]
    assert (len(out.suggestions[1].action), len(out.suggestions[1].why)) == (200, 200)


@pytest.mark.parametrize("raw", [{}, {"summary": "ok", "suggestions": []}, {"summary": "", "suggestions": GOOD["suggestions"]}, None])
def test_validate_requires_summary_and_one_suggestion(raw):
    with pytest.raises(creator_report.NoInsights):
        creator_report.validate_insights(raw)


def test_prompt_carries_both_periods_profile_and_titles():
    p = creator_report.build_prompt({"videos": 3, "usdc_received": 12.5}, {"videos": 1}, {"interest_profile": ["defi"], "bio": "DeFi fácil"},
                                    ["Pool de liquidez"])
    assert "videos uploaded: 3 | 1" in p and "USDC received: 12.5 | 0" in p
    assert "DeFi / decentralized finance" in p and "DeFi fácil" in p and "Pool de liquidez" in p
    system = creator_report._system("pt")
    assert "Brazilian Portuguese" in system and "untrusted data" in system
    assert "never invent views" in system and "Never promise returns" in system


# ── métricas ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_metrics_only_count_the_period_and_the_user(db):
    ana, bob = await _user(db, "ana"), await _user(db, "bob")
    db.add_all([
        _asset(ana.id, NOW - 5 * DAY, duration=90),
        _asset(ana.id, NOW - 10 * DAY, status="expired", duration=30),
        _asset(ana.id, NOW - 3 * DAY, status="pending"),       # upload nunca concluído
        _asset(ana.id, NOW - 45 * DAY),                         # período anterior
        _asset(bob.id, NOW - 2 * DAY),                          # outro creator
    ])
    await db.flush()
    media_id = (await db.execute(select(MediaAsset.id).where(MediaAsset.user_id == ana.id))).scalars().first()
    for status in ("ready", "expired", "failed"):
        db.add(MediaClip(user_id=ana.id, media_id=media_id, rank=1, start_s=0, end_s=10, title="c", reason="r",
                         status=status, created_at=NOW - 4 * DAY))
    camp = Campaign(creator_twitter_user_id="x", name="c1", description="d", reward_token="USDC",
                    reward_per_participant=1, max_participants=10, reward_pool=10)
    db.add(camp)
    await db.flush()
    db.add(CampaignParticipant(campaign_id=camp.id, user_id=ana.id, joined_at=NOW - 6 * DAY))
    db.add(Wallet(user_id=ana.id, address="0xAbC0000000000000000000000000000000000001", private_key_encrypted="user_managed"))
    db.add_all([
        SettledPayment(intent_id="i1", creator_handle="@Ana", amount_usdc=5, tx="t1", settled_at=NOW - DAY),
        SettledPayment(intent_id="i2", creator_handle="ana", amount_usdc=7, tx="t2", settled_at=NOW - 50 * DAY),
        ArcTransfer(from_address="0x1", to_address="0xabc0000000000000000000000000000000000001", amount_usdc=2.5,
                    tx_hash="0xh1", created_at=NOW - 2 * DAY),
    ])
    await db.commit()

    cur = await creator_report.collect_metrics(db, ana, NOW - creator_report.PERIOD, NOW)
    assert cur == {"videos": 2, "video_minutes": 2.0, "clips": 2, "campaigns_joined": 1, "usdc_received": 7.5}
    prev = await creator_report.collect_metrics(db, ana, NOW - 2 * creator_report.PERIOD, NOW - creator_report.PERIOD)
    assert prev["videos"] == 1 and prev["usdc_received"] == 7.0


@pytest.mark.asyncio
async def test_usdc_counts_a_payment_once_when_it_is_in_both_tables(db):
    ana = await _user(db, "ana")
    db.add(Wallet(user_id=ana.id, address="0xAbC0000000000000000000000000000000000001", private_key_encrypted="user_managed"))
    db.add_all([
        # o mesmo pagamento (mesmo hash, caixa diferente) nas duas tabelas
        SettledPayment(intent_id="i1", creator_handle="@ana", amount_usdc=4, tx="0xDUP", settled_at=NOW - DAY),
        ArcTransfer(from_address="0x1", to_address="0xabc0000000000000000000000000000000000001", amount_usdc=4,
                    tx_hash="0xdup", created_at=NOW - DAY),
        SettledPayment(intent_id="i2", creator_handle="ana", amount_usdc=1, tx="0xonly-settled", settled_at=NOW - DAY),
    ])
    await db.commit()
    metrics = await creator_report.collect_metrics(db, ana, NOW - creator_report.PERIOD, NOW)
    assert metrics["usdc_received"] == 5.0          # 4 (uma vez) + 1


# ── quem recebe ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_due_users(db):
    old = await _user(db, "old")                                   # 40 dias, nunca teve relatório
    await _user(db, "new", created=NOW - 10 * DAY)                 # conta nova
    await _user(db, "lurker", interests=None)                      # sem onboarding nem vídeo
    uploader = await _user(db, "uploader", interests=None)
    db.add(_asset(uploader.id, NOW - 39 * DAY))
    recent = await _user(db, "recent")
    stale = await _user(db, "stale")
    for u, end in ((recent, NOW - 5 * DAY), (stale, NOW - 31 * DAY)):
        db.add(CreatorReport(user_id=u.id, period_start=end - creator_report.PERIOD, period_end=end,
                             metrics_json="{}", summary="s", suggestions_json="[]"))
    await db.commit()
    due = await creator_report.due_users(db, NOW)
    assert [u.twitter_handle for u in due] == ["old", "uploader", "stale"]


# ── geração ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_generate_report_saves_report_and_in_app_notification(db, monkeypatch):
    ana = await _user(db, "ana")
    db.add(_asset(ana.id, NOW - 5 * DAY, title="Pool de liquidez"))
    await db.commit()
    calls = []
    _ai(monkeypatch, calls=calls)
    report = await creator_report.generate_report(db, ana, NOW)

    assert calls[0][1] == "report_insights" and "Pool de liquidez" in calls[0][2]
    assert report.period_end == NOW and report.period_start == NOW - creator_report.PERIOD
    assert json.loads(report.metrics_json)["current"]["videos"] == 1
    assert json.loads(report.suggestions_json)[0]["title"] == "Post every week."
    n = (await db.execute(select(NotificationEvent))).scalars().one()
    assert n.user_id == ana.id and n.channel == "in_app" and n.status == "pending"
    assert n.body.endswith("Tip: Post every week.")
    assert json.loads(n.metadata_json) == {"kind": "creator_report", "report_id": report.id}
    assert await creator_report.due_users(db, NOW) == []


@pytest.mark.asyncio
async def test_bad_ai_answer_saves_nothing(db, monkeypatch):
    ana = await _user(db, "ana")
    _ai(monkeypatch, out={"summary": "ok", "suggestions": []})
    with pytest.raises(creator_report.NoInsights):
        await creator_report.generate_report(db, ana, NOW)
    await db.rollback()
    assert (await db.execute(select(CreatorReport))).first() is None
    assert (await db.execute(select(NotificationEvent))).first() is None


@pytest.mark.asyncio
async def test_run_once_generates_for_due_and_stops_when_provider_is_down(db, monkeypatch):
    await _user(db, "a")
    await _user(db, "b")
    _ai(monkeypatch)
    assert await creator_report.run_once(NOW) == 2
    assert await creator_report.run_once(NOW + DAY) == 0           # já têm relatório recente

    await _user(db, "c")
    await _user(db, "d")
    seen = []

    async def _down(*a):
        seen.append(1)
        raise clipper.ProviderUnavailable("no credit")

    monkeypatch.setattr(clipper, "_call_tool", _down)
    assert await creator_report.run_once(NOW + DAY) == 0
    assert len(seen) == 1                                          # não insiste no resto do lote


# ── rotas ────────────────────────────────────────────────────────────────────

async def _login(db, name: str) -> dict[str, str]:
    db.add(WebSession(session_id=f"privy_session_{name}", twitter_user_id=f"privy_{name}", expires_at=NOW + 3650 * DAY))
    await db.commit()
    return {"Authorization": f"Bearer privy_session_{name}"}


@pytest.mark.asyncio
async def test_routes_only_show_the_owners_reports(db, monkeypatch):
    ana = await _user(db, "ana")
    h, other = await _login(db, "ana"), await _login(db, "bob")
    _ai(monkeypatch)
    report = await creator_report.generate_report(db, ana, NOW)

    assert client.get("/v1/reports/me").status_code == 401
    listed = client.get("/v1/reports/me", headers=h).json()
    assert [r["id"] for r in listed] == [report.id] and listed[0]["summary"] == GOOD["summary"]

    r = client.get(f"/v1/reports/me/{report.id}", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["metrics"]["videos"] == 0 and "videos" in body["previous"]
    assert body["suggestions"] == GOOD["suggestions"]

    assert client.get(f"/v1/reports/me/{report.id}", headers=other).status_code == 404
    assert client.get("/v1/reports/me", headers=other).json() == []


# ── idioma ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("languages,expected", [
    ([], "en"),
    (["Portuguese", "Portuguese", "English"], "pt"),
    (["English", "English", "Portuguese"], "en"),
    (["Portuguese", "English"], "pt"),          # empate: o público é brasileiro
    (["pt", None], "pt"),
    (["Spanish", "English"], "en"),
])
async def test_detect_language_from_the_creators_videos(db, languages, expected):
    user = await _user(db, "lang")
    await _transcribed(db, user.id, languages)
    assert await creator_report.detect_language(db, user.id) == expected


@pytest.mark.asyncio
async def test_detect_language_only_looks_at_the_latest_videos_and_the_users_own(db):
    ana, bob = await _user(db, "ana"), await _user(db, "bob")
    # 2 em português antigos e 5 em inglês novos: só os 5 mais novos votam
    await _transcribed(db, ana.id, ["Portuguese", "Portuguese"] + ["English"] * creator_report.LANG_SCAN)
    await _transcribed(db, bob.id, ["Portuguese"] * 3)
    assert await creator_report.detect_language(db, ana.id) == "en"
    assert await creator_report.detect_language(db, bob.id) == "pt"


@pytest.mark.asyncio
async def test_report_and_notification_come_out_in_portuguese(db, monkeypatch):
    ana = await _user(db, "ana")
    await _transcribed(db, ana.id, ["Portuguese", "Portuguese"])
    calls = []
    _ai(monkeypatch, calls=calls)
    report = await creator_report.generate_report(db, ana, NOW)

    assert report.lang == "pt" and "Brazilian Portuguese" in calls[0][0]
    n = (await db.execute(select(NotificationEvent))).scalars().one()
    assert n.title == "Seu relatório de 30 dias está pronto"
    assert n.body.endswith("Dica: Post every week.")


@pytest.mark.asyncio
async def test_explicit_language_wins_and_unknown_falls_back_to_detection(db, monkeypatch):
    ana, bob = await _user(db, "ana"), await _user(db, "bob")
    await _transcribed(db, ana.id, ["Portuguese"])
    _ai(monkeypatch)
    assert (await creator_report.generate_report(db, ana, NOW, lang="en")).lang == "en"
    assert (await creator_report.generate_report(db, bob, NOW, lang="fr")).lang == "en"   # sem vídeo: en


# ── espera depois de falha ───────────────────────────────────────────────────

def _ai_failing_for_bad_bio(monkeypatch, bad_calls: list):
    async def _call_tool(system, tool, content, max_tokens):
        if "Bio: BAD" in content:
            bad_calls.append(1)
            return {}                                  # a IA respondeu, mas sem nada aproveitável
        return GOOD

    monkeypatch.setattr(clipper, "_call_tool", _call_tool)


@pytest.mark.asyncio
async def test_a_failing_user_waits_longer_each_time_and_does_not_hold_up_the_others(db, monkeypatch):
    bad, good = await _user(db, "bad"), await _user(db, "good")
    bad.bio = "BAD"
    await db.commit()
    monkeypatch.setattr(creator_report, "BATCH", 1)    # lote de 1: sem a exclusão, o "bad" seguraria o "good"
    bad_calls: list = []
    _ai_failing_for_bad_bio(monkeypatch, bad_calls)

    assert await creator_report.run_once(NOW) == 0                      # pega o "bad" (id menor) e ele falha
    assert creator_report._retry[bad.id] == (1, NOW + timedelta(days=1))

    assert await creator_report.run_once(NOW + timedelta(hours=1)) == 1  # o "bad" está de fora: o lote vai para o "good"
    assert len(bad_calls) == 1

    assert await creator_report.run_once(NOW + timedelta(hours=25)) == 0  # passou a espera: tenta o "bad" de novo
    assert len(bad_calls) == 2
    assert creator_report._retry[bad.id] == (2, NOW + timedelta(hours=25 + 48))   # e a espera dobra

    _ai(monkeypatch)                                                    # a IA volta a responder bem
    assert await creator_report.run_once(NOW + timedelta(hours=73, minutes=1)) == 1
    assert creator_report._retry == {}


def test_backoff_doubles_and_is_capped():
    creator_report._note_failure(7, NOW)
    assert creator_report._retry[7] == (1, NOW + timedelta(days=1))
    for _ in range(10):
        creator_report._note_failure(7, NOW)
    failures, retry_at = creator_report._retry[7]
    assert failures == 11 and retry_at == NOW + creator_report.MAX_BACKOFF


@pytest.mark.asyncio
async def test_provider_down_stops_the_cycle_without_punishing_anyone(db, monkeypatch):
    await _user(db, "a")

    async def _down(*a):
        raise clipper.ProviderUnavailable("no credit")

    monkeypatch.setattr(clipper, "_call_tool", _down)
    assert await creator_report.run_once(NOW) == 0
    assert creator_report._retry == {}
