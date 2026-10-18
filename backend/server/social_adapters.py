"""
social_adapters.py — uma classe por rede, sem framework (Plane: publicar/métricas pela Xiaolee).

Contrato de cada adaptador:
    connect(inputs)                     → (external_id, handle, stored)  valida e devolve o que fica cifrado
    publish(stored, text, video_url)    → (external_post_id, url)
    fetch_metrics(stored, post_id)      → dict (vazio quando a rede não expõe)

Erros viram `SocialError` com mensagem segura: nunca carrega token/URL de API (a URL do Telegram contém o
token do bot, então não usamos `raise_for_status`, cujo texto a inclui).
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from server.settings import settings

logger = logging.getLogger(__name__)

TELEGRAM_VIDEO_MAX = 50 * 1024 * 1024  # limite do upload multipart da Bot API
TELEGRAM_CAPTION_MAX = 1024
BSKY_PDS = "https://bsky.social"
BSKY_PUBLIC = "https://public.api.bsky.app"
BSKY_TEXT_MAX = 300


class SocialError(Exception):
    """Falha esperada de uma rede; `str(e)` é seguro para mostrar ao creator."""


class TelegramAdapter:
    """Canal do creator; o bot da Xiaolee precisa ser admin com permissão de postar."""

    platform = "telegram"

    def _url(self, method: str) -> str:
        if not settings.telegram_bot_token:
            raise SocialError("Telegram bot is not configured")
        return f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}"

    async def _call(self, method: str, **kw: Any) -> Any:
        try:
            async with httpx.AsyncClient(timeout=60) as c:
                r = await c.post(self._url(method), **kw)
            body = r.json()
        except SocialError:
            raise
        except Exception:
            raise SocialError("Could not reach Telegram")
        if not body.get("ok"):
            raise SocialError(f"Telegram: {str(body.get('description', 'error'))[:200]}")
        return body["result"]

    async def connect(self, inputs: dict) -> tuple[str, str, dict]:
        channel = str(inputs.get("channel", "")).strip()
        if not channel:
            raise SocialError("Informe o canal (ex.: @meucanal)")
        if not channel.startswith("@") and not channel.lstrip("-").isdigit():
            channel = "@" + channel
        chat = await self._call("getChat", json={"chat_id": channel})
        me = await self._call("getMe")
        member = await self._call("getChatMember", json={"chat_id": chat["id"], "user_id": me["id"]})
        if member.get("status") != "administrator" or not member.get("can_post_messages", False):
            raise SocialError(f"Adicione @{me.get('username', 'o bot')} como administrador do canal com permissão de postar")
        handle = f"@{chat['username']}" if chat.get("username") else chat.get("title", str(chat["id"]))
        return str(chat["id"]), handle, {"chat_id": chat["id"], "username": chat.get("username")}

    async def publish(self, stored: dict, text: str, video_url: Optional[str]) -> tuple[str, Optional[str]]:
        if video_url:
            try:
                async with httpx.AsyncClient(timeout=120) as c:
                    v = await c.get(video_url)
                v.raise_for_status()
            except Exception:
                raise SocialError("Could not read the clip video")
            if len(v.content) > TELEGRAM_VIDEO_MAX:
                raise SocialError("Clip is larger than Telegram's 50 MB upload limit")
            res = await self._call(
                "sendVideo",
                data={"chat_id": str(stored["chat_id"]), "caption": text[:TELEGRAM_CAPTION_MAX], "supports_streaming": "true"},
                files={"video": ("clip.mp4", v.content, "video/mp4")},
            )
        else:
            res = await self._call("sendMessage", json={"chat_id": stored["chat_id"], "text": text[:4096]})
        mid = res["message_id"]
        user = stored.get("username")
        return str(mid), (f"https://t.me/{user}/{mid}" if user else None)

    async def fetch_metrics(self, stored: dict, post_id: str) -> dict:
        return {}  # a Bot API não expõe views/reações de posts de canal


class BlueskyAdapter:
    """Conta Bluesky com app password do próprio creator (revogável por ele no Bluesky)."""

    platform = "bluesky"

    async def _session(self, c: httpx.AsyncClient, stored: dict) -> dict:
        r = await c.post(f"{BSKY_PDS}/xrpc/com.atproto.server.createSession",
                         json={"identifier": stored["identifier"], "password": stored["app_password"]})
        if r.status_code in (400, 401):
            raise SocialError("Bluesky rejected the handle or app password")
        if not r.is_success:
            raise SocialError("Could not reach Bluesky")
        return r.json()

    async def connect(self, inputs: dict) -> tuple[str, str, dict]:
        ident = str(inputs.get("identifier", "")).strip().lstrip("@")
        pw = str(inputs.get("app_password", "")).strip()
        if not ident or not pw:
            raise SocialError("Informe o handle e uma app password do Bluesky")
        stored = {"identifier": ident, "app_password": pw}
        try:
            async with httpx.AsyncClient(timeout=20) as c:
                s = await self._session(c, stored)
        except SocialError:
            raise
        except Exception:
            raise SocialError("Could not reach Bluesky")
        return s["did"], s["handle"], stored

    async def publish(self, stored: dict, text: str, video_url: Optional[str]) -> tuple[str, Optional[str]]:
        # ponytail: só texto. Vídeo = app.bsky.video.uploadVideo (limites de tamanho/duração a confirmar no D2).
        if len(text) > BSKY_TEXT_MAX:
            raise SocialError(f"Bluesky text is limited to {BSKY_TEXT_MAX} characters")
        from datetime import datetime, timezone
        try:
            async with httpx.AsyncClient(timeout=30) as c:
                s = await self._session(c, stored)
                r = await c.post(
                    f"{BSKY_PDS}/xrpc/com.atproto.repo.createRecord",
                    headers={"Authorization": f"Bearer {s['accessJwt']}"},
                    json={"repo": s["did"], "collection": "app.bsky.feed.post", "record": {
                        "$type": "app.bsky.feed.post", "text": text,
                        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}},
                )
        except SocialError:
            raise
        except Exception:
            raise SocialError("Could not reach Bluesky")
        if not r.is_success:
            raise SocialError("Bluesky refused the post")
        uri = r.json()["uri"]  # at://did/app.bsky.feed.post/rkey
        return uri, f"https://bsky.app/profile/{s['handle']}/post/{uri.rsplit('/', 1)[-1]}"

    async def fetch_metrics(self, stored: dict, post_id: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.get(f"{BSKY_PUBLIC}/xrpc/app.bsky.feed.getPosts", params={"uris": post_id})
            p = r.json()["posts"][0]
        except Exception:
            raise SocialError("Could not read Bluesky metrics")
        return {"likes": p.get("likeCount", 0), "reposts": p.get("repostCount", 0),
                "replies": p.get("replyCount", 0), "quotes": p.get("quoteCount", 0)}


ADAPTERS = {a.platform: a for a in (TelegramAdapter(), BlueskyAdapter())}
