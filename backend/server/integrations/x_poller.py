"""
X (Twitter) DM polling service.

Autenticação (em ordem de preferência):
  1. TWITTER_USERNAME + TWITTER_PASSWORD  → scraper.login() — mais confiável em cloud
  2. TWITTER_COOKIES_JSON (env var)       → setCookies() sem arquivo
  3. eliza_cookies_v2.json (arquivo)      → setCookies() local/Docker

Spawns short-lived Node.js scripts via agent-twitter-client.
Roda como background task no lifespan do FastAPI.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_NODE_MODULES = _BACKEND_DIR / "database" / "data" / "node_modules"
_COOKIES_FILE = _BACKEND_DIR / "data" / "eliza_cookies_v2.json"

_TWITTER_USERNAME: str | None = os.getenv("TWITTER_USERNAME")
_TWITTER_PASSWORD: str | None = os.getenv("TWITTER_PASSWORD")
_COOKIES_FROM_ENV: str | None = os.getenv("TWITTER_COOKIES_JSON")

_USE_LOGIN = bool(_TWITTER_USERNAME and _TWITTER_PASSWORD)


class XPoller:
    _POLL_INTERVAL = 60

    def __init__(self, orchestrator):
        self._orchestrator = orchestrator
        self._bot_user_id: str | None = None
        self._seen_ids: set[str] = set()

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def start(self) -> None:
        if not _USE_LOGIN and not _COOKIES_FROM_ENV and not _COOKIES_FILE.exists():
            logger.warning(
                "X DM polling desativado — configure TWITTER_USERNAME+TWITTER_PASSWORD "
                "ou TWITTER_COOKIES_JSON.",
            )
            return

        auth_mode = "login" if _USE_LOGIN else "cookies"
        logger.info("X poller iniciando (modo: %s)", auth_mode)

        self._bot_user_id = await self._get_bot_user_id()
        if not self._bot_user_id:
            logger.error("X poller: autenticação falhou — polling não vai iniciar.")
            return

        logger.info("X DM polling ativo (bot id: %s)", self._bot_user_id)

        while True:
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                logger.info("X poller parado.")
                return
            except Exception as exc:
                logger.error("X polling erro: %s", exc, exc_info=True)

            await asyncio.sleep(self._POLL_INTERVAL)

    # ------------------------------------------------------------------
    # Poll + handle
    # ------------------------------------------------------------------

    async def _poll_once(self) -> None:
        dms = await self._fetch_new_dms()
        for dm in dms:
            msg_id = dm.get("id")
            if not msg_id or msg_id in self._seen_ids:
                continue
            sender_id = dm.get("sender_id", "")
            if sender_id == self._bot_user_id:
                self._seen_ids.add(msg_id)
                continue
            try:
                await self._handle(dm)
            except Exception as exc:
                logger.error("X: erro ao processar DM %s: %s", msg_id, exc, exc_info=True)
            self._seen_ids.add(msg_id)

        if len(self._seen_ids) > 5_000:
            self._seen_ids = set(list(self._seen_ids)[-2_000:])

    async def _handle(self, dm: dict) -> None:
        sender_id = str(dm.get("sender_id", ""))
        text = dm.get("text", "").strip()
        conversation_id = dm.get("conversation_id", "")

        if not text or not sender_id:
            return

        from database.database import SessionLocal
        from database.repository import DatabaseRepository

        async with SessionLocal() as session:
            repo = DatabaseRepository(session)
            user = await repo.get_or_create_user("x", sender_id)
            history = await repo.get_user_history(user.id, limit=10)
            await repo.log_dm(user.id, "x", text, message_type="user")
            # As tools de campanha do orchestrator abrem conexão SQLite própria
            # — sem commitar antes, a escrita pendente aqui colide com a delas
            # ("database is locked", SQLite só aceita um escritor por vez).
            await session.commit()

            result = await self._orchestrator.execute(
                text, sender_id, history=history, platform="x",
            )

            await repo.log_dm(user.id, "x", result["reply_text"], message_type="bot")
            await session.commit()

        await self._send_reply(conversation_id, result["reply_text"])
        logger.info("X: respondeu user %s na conversa %s", sender_id, conversation_id)

    # ------------------------------------------------------------------
    # Node.js bridge
    # ------------------------------------------------------------------

    async def _run_node(self, script: str, timeout: int = 30) -> Any:
        env = {**os.environ, "NODE_PATH": str(_NODE_MODULES)}

        with tempfile.NamedTemporaryFile(
            suffix=".js", mode="w", encoding="utf-8", delete=False
        ) as f:
            f.write(script)
            script_path = f.name

        try:
            proc = await asyncio.create_subprocess_exec(
                "node", script_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                proc.kill()
                logger.error("X node script timeout após %ds", timeout)
                return None

            if proc.returncode != 0:
                logger.error("X node script erro: %s", stderr.decode().strip())
                return None

            raw = stdout.decode().strip()
            return json.loads(raw) if raw else None

        except json.JSONDecodeError as exc:
            logger.error("X node script: JSON inválido — %s", exc)
            return None
        finally:
            Path(script_path).unlink(missing_ok=True)

    def _auth_setup_js(self) -> str:
        """Gera o bloco JS que autentica o scraper."""
        if _USE_LOGIN:
            username = json.dumps(_TWITTER_USERNAME)
            password = json.dumps(_TWITTER_PASSWORD)
            return f"""
        const scraper = new Scraper();
        await scraper.login({username}, {password});
"""
        if _COOKIES_FROM_ENV:
            cookies_json = json.dumps(_COOKIES_FROM_ENV)
            return f"""
        const scraper = new Scraper();
        const cookies = JSON.parse({cookies_json});
        await scraper.setCookies(cookies.map(c => `${{c.key || c.name}}=${{c.value}}; Domain=.twitter.com; Path=/`));
"""
        # file fallback
        cookies_path = json.dumps(str(_COOKIES_FILE))
        return f"""
        const scraper = new Scraper();
        const cookies = JSON.parse(require('fs').readFileSync({cookies_path}, 'utf8'));
        await scraper.setCookies(cookies.map(c => `${{c.key || c.name}}=${{c.value}}; Domain=.twitter.com; Path=/`));
"""

    async def _get_bot_user_id(self) -> str | None:
        script = f"""
const {{ Scraper }} = require('agent-twitter-client');

(async () => {{
    try {{
        {self._auth_setup_js()}
        const me = await scraper.me();
        if (!me) {{ process.stderr.write('me() retornou null\\n'); process.exit(1); }}
        console.log(JSON.stringify({{ userId: me.userId, screenName: me.username }}));
    }} catch (e) {{
        process.stderr.write(e.message + '\\n');
        process.exit(1);
    }}
}})();
"""
        data = await self._run_node(script, timeout=60)
        if data and data.get("userId"):
            logger.info("X autenticado como @%s (id: %s)", data.get("screenName"), data["userId"])
            return str(data["userId"])
        return None

    async def _fetch_new_dms(self) -> list[dict]:
        script = f"""
const {{ Scraper }} = require('agent-twitter-client');

(async () => {{
    try {{
        {self._auth_setup_js()}
        const result = await scraper.getDirectMessageConversations();
        const conversations = result?.conversations || [];
        const dms = [];

        for (const conv of conversations) {{
            for (const msg of (conv.messages || [])) {{
                if (msg.messageData?.text) {{
                    dms.push({{
                        id: msg.id,
                        sender_id: msg.senderId,
                        conversation_id: conv.conversationId,
                        text: msg.messageData.text,
                    }});
                }}
            }}
        }}

        console.log(JSON.stringify(dms));
    }} catch (e) {{
        process.stderr.write(e.message + '\\n');
        process.exit(1);
    }}
}})();
"""
        result = await self._run_node(script, timeout=60)
        return result if isinstance(result, list) else []

    async def _send_reply(self, conversation_id: str, text: str) -> None:
        script = f"""
const {{ Scraper }} = require('agent-twitter-client');

(async () => {{
    try {{
        {self._auth_setup_js()}
        await scraper.sendDirectMessage({json.dumps(conversation_id)}, {json.dumps(text)});
        console.log(JSON.stringify({{ ok: true }}));
    }} catch (e) {{
        process.stderr.write(e.message + '\\n');
        process.exit(1);
    }}
}})();
"""
        result = await self._run_node(script, timeout=30)
        if not result or not result.get("ok"):
            logger.warning("X: falhou ao enviar reply para conversa %s", conversation_id)
