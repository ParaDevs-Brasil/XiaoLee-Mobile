"""
database.py — Configuração do banco de dados XiaoLee.

Suporte dual:
    - SQLite (aiosqlite)  → desenvolvimento local e testes (padrão)
    - PostgreSQL (asyncpg) → produção/staging via DATABASE_URL

Variáveis de ambiente:
    DATABASE_URL  — URL completa do banco (ex: postgresql+asyncpg://user:pass@host/db)
                    Se não definida, usa SQLite local (xiao_lee.db).

Uso em produção:
    export DATABASE_URL="postgresql+asyncpg://xiaolee:senha@localhost:5432/xiaolee_prod"

Em testes, o conftest.py usa SQLite in-memory e sobrescreve get_db_session via override —
este módulo não é chamado diretamente em testes.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import AsyncGenerator, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .base import Base

logger = logging.getLogger(__name__)

# ─── Globals ───────────────────────────────────────────────────────────────────

engine: AsyncEngine | None = None
SessionLocal: async_sessionmaker[AsyncSession] | None = None


# ─── URL Detection ─────────────────────────────────────────────────────────────

def _build_database_url() -> str:
    """
    Determina a URL de banco com base em DATABASE_URL (env).

    Regras de transformação:
        - postgresql://...     → postgresql+asyncpg://...
        - postgres://...       → postgresql+asyncpg://...  (Heroku/Render compat)
        - sqlite:///...        → sqlite+aiosqlite:///...
        - sqlite+aiosqlite://  → sem alteração
        - postgresql+asyncpg:// → sem alteração

    Se DATABASE_URL não estiver definida, usa SQLite local.
    """
    env_url = os.getenv("DATABASE_URL", "")

    if env_url:
        # Normaliza variantes sem driver explícito
        if env_url.startswith("postgresql://") or env_url.startswith("postgres://"):
            env_url = env_url.replace("postgres://", "postgresql+asyncpg://", 1)
            env_url = env_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif env_url.startswith("sqlite:///"):
            env_url = env_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
        return env_url

    # Padrão: SQLite local
    project_root = Path(__file__).resolve().parent.parent
    db_path = project_root / "xiao_lee.db"
    return f"sqlite+aiosqlite:///{db_path}"


def _engine_kwargs(url: str) -> dict:
    """Parâmetros adicionais de engine por banco."""
    if "postgresql" in url:
        return {
            "pool_size": 10,
            "max_overflow": 20,
            "pool_timeout": 30,
            "pool_recycle": 1800,
            "pool_pre_ping": True,   # detecta conexões mortas
        }
    # SQLite: sem pool (conexão em arquivo), mas com busy_timeout — sem isto o
    # driver falha na hora com "database is locked" a qualquer escrita
    # concorrente (ex: poller do Telegram gravando enquanto o chat cria uma
    # campanha) em vez de esperar a conexão anterior liberar, que é o padrão
    # esperado de um servidor com requests concorrentes.
    return {"connect_args": {"timeout": 15}}


# ─── Inicialização ─────────────────────────────────────────────────────────────

def init_db() -> Tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    """
    Inicializa o engine e o session factory globais.
    Idempotente: chamadas repetidas reutilizam o engine existente.
    """
    global engine, SessionLocal

    if engine is not None and SessionLocal is not None:
        return engine, SessionLocal

    db_url = _build_database_url()
    logger.info("Initializing database | url_prefix=%s", db_url.split("@")[-1].split("/")[-1])

    engine = create_async_engine(db_url, echo=False, **_engine_kwargs(db_url))
    SessionLocal = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )
    logger.info("Database session factory initialized | backend=%s",
                "postgresql" if "postgresql" in db_url else "sqlite")
    return engine, SessionLocal


# ─── Criação de tabelas ────────────────────────────────────────────────────────

async def create_tables() -> None:
    """
    Cria tabelas via SQLAlchemy metadata.
    Em produção, Alembic `alembic upgrade head` substitui este método.
    Mantido para compatibilidade com Devnet/desenvolvimento local.
    """
    global engine
    if engine is None:
        init_db()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if "sqlite" in str(engine.url):
            await _apply_sqlite_migrations(conn)


async def _apply_sqlite_migrations(conn) -> None:
    """
    Migrações manuais para SQLite (desenvolvimento).
    Em produção PostgreSQL, use: alembic upgrade head
    """
    result = await conn.execute(text("PRAGMA table_info(users)"))
    columns = {row[1] for row in result.fetchall()}
    if "telegram_chat_id" not in columns:
        await conn.execute(text("ALTER TABLE users ADD COLUMN telegram_chat_id TEXT"))
        logger.info("SQLite migration: added telegram_chat_id to users")


async def drop_tables() -> None:
    """Remove todas as tabelas. Apenas para testes."""
    global engine
    if engine is None:
        init_db()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


# ─── Dependency Injection ──────────────────────────────────────────────────────

async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency: fornece uma sessão de banco por request.

    Em testes, sobrescreva via app.dependency_overrides[get_db_session].
    """
    global SessionLocal
    if SessionLocal is None:
        init_db()

    async with SessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


# Alias para compatibilidade retroativa
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_session():
        yield session
