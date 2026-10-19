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

import base64
import hashlib
import json
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

from server.settings import settings

logger = logging.getLogger(__name__)

TELEGRAM_VIDEO_MAX = 50 * 1024 * 1024  # limite do upload multipart da Bot API
TELEGRAM_CAPTION_MAX = 1024
IMAGE_MAX_BYTES = 5 * 1024 * 1024  # o menor limite entre as redes (X: 5 MB por imagem)
IMAGES_MAX = 4  # X e Bluesky aceitam até 4 por post
BSKY_PDS = "https://bsky.social"
BSKY_PUBLIC = "https://public.api.bsky.app"
BSKY_TEXT_MAX = 300
X_AUTHORIZE = "https://x.com/i/oauth2/authorize"
X_API = "https://api.x.com/2"
X_SCOPES = "tweet.read tweet.write users.read offline.access media.write"
X_IMAGE_MAX = 5 * 1024 * 1024  # upload simples de imagem do X
X_TEXT_MAX = 280
# Assunto do nicho cripto: de onde saem as hashtags que estão rodando (uma busca, até 30 posts = ~US$ 0,15).
X_NICHE_QUERY = "(#bitcoin OR #crypto OR #web3 OR #stablecoin OR #defi OR #onchain) -is:retweet"


Image = tuple[bytes, str]  # (bytes, mime)


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

    async def publish(self, stored: dict, text: str, video_url: Optional[str],
                      images: Optional[list[Image]] = None) -> tuple[str, Optional[str]]:
        if images:
            if len(text) > TELEGRAM_CAPTION_MAX:
                raise SocialError(f"Telegram photo captions are limited to {TELEGRAM_CAPTION_MAX} characters")
            if len(images) == 1:
                res = await self._call("sendPhoto", data={"chat_id": str(stored["chat_id"]), "caption": text},
                                       files={"photo": ("photo", images[0][0], images[0][1])})
            else:
                media = [{"type": "photo", "media": f"attach://p{i}", **({"caption": text} if i == 0 else {})}
                         for i in range(len(images))]
                res = (await self._call("sendMediaGroup", data={"chat_id": str(stored["chat_id"]), "media": json.dumps(media)},
                                        files={f"p{i}": (f"p{i}", b, m) for i, (b, m) in enumerate(images)}))[0]
        elif video_url:
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

    async def publish(self, stored: dict, text: str, video_url: Optional[str],
                      images: Optional[list[Image]] = None) -> tuple[str, Optional[str]]:
        # ponytail: só texto. Imagem = com.atproto.repo.uploadBlob + embed; vídeo = app.bsky.video.uploadVideo.
        if images:
            raise SocialError("Photos on Bluesky are not supported yet")
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


class XAdapter:
    """Conta X do creator via OAuth 2.0 PKCE (cliente público). `stored` = {access_token, refresh_token, expires_at}.

    Diferente das outras redes, não conecta por formulário: `authorize_url` + `exchange` (rotas /x/start e /x/callback).
    `publish`/`fetch_metrics` renovam o token quando vence e o gravam em `stored` — a rota re-cifra se mudou.
    """

    platform = "x"

    @staticmethod
    def new_pkce() -> tuple[str, str]:
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        return verifier, challenge

    @staticmethod
    def authorize_url(state: str, challenge: str) -> str:
        if not settings.x_oauth_client_id:
            raise SocialError("X is not configured")
        return X_AUTHORIZE + "?" + urlencode({
            "response_type": "code", "client_id": settings.x_oauth_client_id, "redirect_uri": settings.x_oauth_redirect,
            "scope": X_SCOPES, "state": state, "code_challenge": challenge, "code_challenge_method": "S256"})

    async def _token(self, **form: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.post(f"{X_API}/oauth2/token", data={"client_id": settings.x_oauth_client_id, **form})
            body = r.json()
        except Exception:
            raise SocialError("Could not reach X")
        if not r.is_success or "access_token" not in body:
            raise SocialError("X rejected the login, connect again")
        return {"access_token": body["access_token"], "refresh_token": body.get("refresh_token", form.get("refresh_token", "")),
                "expires_at": int(time.time()) + int(body.get("expires_in", 7200)) - 60}

    async def _get(self, path: str, token: str, **params: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.get(f"{X_API}{path}", params=params, headers={"Authorization": f"Bearer {token}"})
            body = r.json()
        except Exception:
            raise SocialError("Could not reach X")
        if not r.is_success:
            raise SocialError(f"X: {str(body.get('detail') or body.get('title') or 'error')[:200]}")
        return body

    async def exchange(self, code: str, verifier: str) -> tuple[str, str, dict]:
        stored = await self._token(grant_type="authorization_code", code=code, redirect_uri=settings.x_oauth_redirect,
                                   code_verifier=verifier)
        me = (await self._get("/users/me", stored["access_token"]))["data"]
        return me["id"], f"@{me['username']}", stored

    async def connect(self, inputs: dict) -> tuple[str, str, dict]:
        raise SocialError("Connect X with the login button")

    async def _fresh(self, stored: dict) -> str:
        if stored.get("expires_at", 0) <= time.time():
            stored.update(await self._token(grant_type="refresh_token", refresh_token=stored.get("refresh_token", "")))
        return stored["access_token"]

    async def _upload_image(self, token: str, image: bytes, mime: str) -> str:
        if len(image) > X_IMAGE_MAX:
            raise SocialError("Image is larger than X's 5 MB limit")
        try:
            async with httpx.AsyncClient(timeout=60) as c:
                r = await c.post(f"{X_API}/media/upload", headers={"Authorization": f"Bearer {token}"},
                                 data={"media_category": "tweet_image"}, files={"media": ("image", image, mime)})
            body = r.json()
        except Exception:
            raise SocialError("Could not reach X")
        if not r.is_success:
            raise SocialError(f"X: {str(body.get('detail') or body.get('title') or 'refused the image')[:200]}")
        return str(body["data"]["id"])

    async def publish(self, stored: dict, text: str, video_url: Optional[str],
                      images: Optional[list[Image]] = None) -> tuple[str, Optional[str]]:
        # ponytail: texto (+ link) e até 4 imagens. Vídeo nativo = upload em partes; o corte vai por link (/c/{id}).
        if video_url:
            raise SocialError("Clips on X go as a link, not as an upload")
        if len(text) > X_TEXT_MAX:
            raise SocialError(f"X text is limited to {X_TEXT_MAX} characters")
        token = await self._fresh(stored)
        payload: dict = {"text": text}
        if images:
            payload["media"] = {"media_ids": [await self._upload_image(token, *img) for img in images[:IMAGES_MAX]]}
        try:
            async with httpx.AsyncClient(timeout=30) as c:
                r = await c.post(f"{X_API}/tweets", json=payload, headers={"Authorization": f"Bearer {token}"})
            body = r.json()
        except Exception:
            raise SocialError("Could not reach X")
        if not r.is_success:
            raise SocialError(f"X: {str(body.get('detail') or body.get('title') or 'refused the post')[:200]}")
        tid = body["data"]["id"]
        return tid, f"https://x.com/i/status/{tid}"

    async def fetch_insights(self, stored: dict, external_id: str, days: int = 29, limit: int = 20) -> dict:
        """Perfil + desempenho dos posts próprios dos últimos `days` dias (o X só entrega cliques/impressões privadas
        de posts com até 30 dias). Custo: 1 leitura de perfil + até `limit` posts."""
        token = await self._fresh(stored)
        me = (await self._get("/users/me", token, **{"user.fields": "public_metrics"}))["data"]
        since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        body = await self._get(f"/users/{external_id}/tweets", token, max_results=str(limit), exclude="retweets,replies",
                               start_time=since, **{"tweet.fields": "organic_metrics,non_public_metrics,public_metrics,created_at"})
        posts = []
        for t in body.get("data", []):
            pub, org, priv = t.get("public_metrics", {}), t.get("organic_metrics", {}), t.get("non_public_metrics", {})
            likes = org.get("like_count", pub.get("like_count", 0))
            posts.append({
                "text": t["text"][:140], "posted_at": t["created_at"], "url": f"https://x.com/i/status/{t['id']}",
                "impressions": priv.get("impression_count", org.get("impression_count", pub.get("impression_count", 0))),
                "likes": likes,
                "engagements": priv.get("engagements", likes + org.get("reply_count", 0) + org.get("retweet_count", 0)),
                "profile_clicks": priv.get("user_profile_clicks", 0), "link_clicks": priv.get("url_link_clicks", 0),
            })
        pm = me.get("public_metrics", {})
        imp = sum(p["impressions"] for p in posts)
        eng = sum(p["engagements"] for p in posts)
        return {
            "followers": pm.get("followers_count", 0), "following": pm.get("following_count", 0), "posts_total": pm.get("tweet_count", 0),
            "window_days": days,
            "totals": {"posts": len(posts), "impressions": imp, "engagements": eng,
                       "profile_clicks": sum(p["profile_clicks"] for p in posts), "link_clicks": sum(p["link_clicks"] for p in posts)},
            "engagement_rate": round(eng / imp * 100, 1) if imp else 0.0,
            "top_posts": sorted(posts, key=lambda p: -p["impressions"])[:3],
        }

    async def fetch_suggestions(self, stored: dict, external_id: str) -> dict:
        """Menções e hashtags para o creator tocar e inserir no post. Só dado real da conta/rede:
        menções = quem já falou com ele + quem ele já marcou; hashtags = as dele e as do nicho cripto agora.
        Custo por chamada: 3 leituras pequenas (~US$ 0,25), por isso a rota guarda em cache."""
        token = await self._fresh(stored)
        mine = await self._get(f"/users/{external_id}/tweets", token, max_results="20", exclude="retweets",
                               **{"tweet.fields": "entities"})
        inbox = await self._get(f"/users/{external_id}/mentions", token, max_results="15",
                                expansions="author_id", **{"user.fields": "username,name"})
        niche = await self._get("/tweets/search/recent", token, query=X_NICHE_QUERY, max_results="30",
                                **{"tweet.fields": "entities"})
        me = {u["username"].lower() for u in [(await self._get("/users/me", token))["data"]]}

        mentions: dict[str, dict] = {}
        for t in mine.get("data", []):
            for m in t.get("entities", {}).get("mentions", []):
                h = m["username"]
                if h.lower() not in me:
                    mentions.setdefault(h.lower(), {"handle": h, "name": "", "why": "you tagged", "n": 0})["n"] += 1
        for u in inbox.get("includes", {}).get("users", []):
            if u["username"].lower() not in me:
                e = mentions.setdefault(u["username"].lower(), {"handle": u["username"], "name": u.get("name", ""), "why": "", "n": 0})
                e["name"] = e["name"] or u.get("name", "")
                e["why"] = "replied" if not e["why"] else "tagged + replied"
                e["n"] += 2

        def tags(posts) -> dict[str, int]:
            # #Crypto e #crypto são a mesma hashtag no X: junta e guarda a grafia mais usada
            count: dict[str, int] = {}
            spelling: dict[str, dict[str, int]] = {}
            for t in posts:
                for h in t.get("entities", {}).get("hashtags", []):
                    k = h["tag"].lower()
                    count[k] = count.get(k, 0) + 1
                    spelling.setdefault(k, {})[h["tag"]] = spelling.get(k, {}).get(h["tag"], 0) + 1
            return {max(spelling[k], key=spelling[k].get): n for k, n in count.items()}

        own, trending = tags(mine.get("data", [])), tags(niche.get("data", []))
        hashtags = [{"tag": k, "why": "you use it", "n": v} for k, v in own.items()]
        own_lower = {k.lower() for k in own}
        hashtags += [{"tag": k, "why": "trending", "n": v} for k, v in trending.items() if k.lower() not in own_lower]
        top = lambda items, n: sorted(items, key=lambda x: -x["n"])[:n]  # noqa: E731
        return {"mentions": top(list(mentions.values()), 5), "hashtags": top(hashtags, 6)}

    async def fetch_metrics(self, stored: dict, post_id: str) -> dict:
        m = (await self._get(f"/tweets/{post_id}", await self._fresh(stored), **{"tweet.fields": "public_metrics"}))["data"]["public_metrics"]
        return {"views": m.get("impression_count", 0), "likes": m.get("like_count", 0), "reposts": m.get("retweet_count", 0),
                "replies": m.get("reply_count", 0), "quotes": m.get("quote_count", 0)}


ADAPTERS = {a.platform: a for a in (TelegramAdapter(), BlueskyAdapter(), XAdapter())}
