"""
chat_sessions_routes.py — Threads do chat web da XiaoLee.

Antes disso o chat era uma única conversa infinita por usuário (tudo em
DMLog, sem agrupamento). Estas rotas dão nome e fronteira a cada conversa
("New chat" no navbar cria uma; a mensagem em si continua indo por POST
/chat, que aceita um session_id opcional — ver chat_compat em app.py).

Resolução de identidade é a mesma do POST /chat: o token Bearer que o
frontend já manda em toda chamada (ver api.tsx) vira o user_id.

Rotas:
    GET  /v1/chat/sessions               → lista as sessões do usuário
    POST /v1/chat/sessions               → cria uma sessão vazia
    GET  /v1/chat/sessions/{id}/messages → mensagens de uma sessão
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database.database import get_db_session
from database.repository import DatabaseRepository, to_utc_iso
from server.campaigns_routes import resolve_optional_identity

router = APIRouter(prefix="/v1/chat", tags=["chat"])


class ChatSessionOut(BaseModel):
    id: int
    title: str
    created_at: str
    updated_at: str


class ChatMessageOut(BaseModel):
    role: str
    content: str
    time: str


async def _resolve_user_id(db: AsyncSession, authorization: str | None) -> str:
    return await resolve_optional_identity(db, authorization) or "web_anonymous"


def _serialize_session(chat_session) -> ChatSessionOut:
    return ChatSessionOut(
        id=chat_session.id,
        title=chat_session.title,
        created_at=to_utc_iso(chat_session.created_at),
        updated_at=to_utc_iso(chat_session.updated_at),
    )


@router.get("/sessions", response_model=list[ChatSessionOut])
async def list_sessions(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    repo = DatabaseRepository(db)
    user = await repo.get_or_create_user("web", await _resolve_user_id(db, authorization))
    sessions = await repo.list_chat_sessions(user.id)
    return [_serialize_session(s) for s in sessions]


@router.post("/sessions", response_model=ChatSessionOut)
async def create_session(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    repo = DatabaseRepository(db)
    user = await repo.get_or_create_user("web", await _resolve_user_id(db, authorization))
    chat_session = await repo.create_chat_session(user.id)
    await db.commit()
    return _serialize_session(chat_session)


@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageOut])
async def get_session_messages(
    session_id: int,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
):
    repo = DatabaseRepository(db)
    user = await repo.get_or_create_user("web", await _resolve_user_id(db, authorization))
    chat_session = await repo.get_chat_session(session_id, user.id)
    if not chat_session:
        raise HTTPException(status_code=404, detail="chat session not found")
    messages = await repo.get_session_messages(session_id)
    return [ChatMessageOut(**m) for m in messages]
