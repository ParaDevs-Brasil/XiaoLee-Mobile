"""
Telegram long-polling service.

Runs as a background task instead of a webhook — no public URL required.
Switch to the webhook at /v1/integrations/telegram/webhook for production.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)


class TelegramPoller:
    _API = "https://api.telegram.org/bot{token}"

    def __init__(self, bot_token: str, telegram_client, orchestrator):
        self._token = bot_token
        self._client = telegram_client
        self._orchestrator = orchestrator
        self._offset = 0
        self._base = self._API.format(token=bot_token)

    async def start(self) -> None:
        logger.info("Telegram long-polling started")
        async with httpx.AsyncClient(timeout=35) as http:
            while True:
                try:
                    await self._poll_once(http)
                except asyncio.CancelledError:
                    logger.info("Telegram poller stopped")
                    return
                except httpx.ReadTimeout:
                    pass
                except Exception as exc:
                    logger.error("Telegram polling error: %s", exc, exc_info=True)
                    await asyncio.sleep(5)

    async def _poll_once(self, http: httpx.AsyncClient) -> None:
        resp = await http.get(
            f"{self._base}/getUpdates",
            params={
                "offset": self._offset,
                "timeout": 25,
                "allowed_updates": ["message"],
            },
        )
        data = resp.json()
        if not data.get("ok"):
            logger.warning("getUpdates returned not-ok: %s", data)
            return

        for update in data.get("result", []):
            self._offset = update["update_id"] + 1
            try:
                await self._handle(update)
            except Exception as exc:
                logger.error(
                    "Error handling update %s: %s",
                    update.get("update_id"),
                    exc,
                    exc_info=True,
                )

    async def _handle(self, update: dict) -> None:
        message = update.get("message")
        if not message or not message.get("text"):
            return

        chat_id = message["chat"]["id"]
        user_id = str(message["from"]["id"])
        text = message["text"].strip()

        from database.database import SessionLocal
        from database.repository import DatabaseRepository

        async with SessionLocal() as session:
            repo = DatabaseRepository(session)
            user = await repo.get_or_create_user("telegram", user_id)
            await repo.set_telegram_chat_id(user.id, chat_id)
            history = await repo.get_user_history(user.id, limit=10)
            await repo.log_dm(user.id, "telegram", text, message_type="user")
            # As tools de campanha do orchestrator abrem conexão SQLite própria
            # — sem commitar antes, a escrita pendente aqui colide com a delas
            # ("database is locked", SQLite só aceita um escritor por vez).
            await session.commit()

            result = await self._orchestrator.execute(
                text, user_id, history=history, platform="telegram",
            )

            await repo.log_dm(
                user.id, "telegram", result["reply_text"], message_type="bot"
            )
            await session.commit()

        await self._client.send_message(chat_id, result["reply_text"])
        logger.info("Replied to Telegram user %s in chat %s", user_id, chat_id)
