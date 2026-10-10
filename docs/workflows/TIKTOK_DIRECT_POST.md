# Envio direto ao TikTok (XIAOLEEACE-24)

Estado: **preparação**. Hoje o corte sai do app pela tela de compartilhar do
sistema (`mobile/src/lib/clip-share.ts`, `expo-sharing`), que já entrega o MP4
ao app do TikTok sem aprovação nenhuma. Este documento é o plano para o
próximo passo: o backend enviar o corte do R2 direto para a conta TikTok do
creator, sem o vídeo passar pelo celular.

O TikTok só revisa um app que já funciona: o pedido exige **vídeo de
demonstração do fluxo completo, gravado no sandbox**. Por isso a ordem é
portal → integração no sandbox → vídeo → pedido.

---

## 1. Portal TikTok for Developers (quem tem a conta)

Nada disto pode ser feito por agente: é conta e formulário do time.

- [ ] Criar conta em developers.tiktok.com e uma organização "ParaDevs".
- [ ] Criar o app **XiaoLee** (nome não pode citar TikTok nem outra rede).
- [ ] Plataforma: **Web**. Android/iOS exigem o app publicado na Play Store/App
      Store, e hoje só há APK interno. O app mobile abre o login do TikTok num
      navegador interno (`expo-web-browser`, já instalado) — o fluxo é web.
- [ ] Website: `https://xiaolee-landing-production.up.railway.app` — já tem
      `/terms`, `/privacy` (que já falam de TikTok) e o arquivo de verificação
      de URL (`landing/tiktok…txt`). Um domínio próprio passaria mais confiança
      na revisão; se trocar, verificar de novo.
- [ ] Produtos: **Login Kit** + **Content Posting API** (Upload).
- [ ] Scopes: `user.info.basic`, `video.upload`. (`video.publish` — postagem
      direta — fica para depois da auditoria; ver §5.)
- [ ] Redirect URI: `https://xiaolee-mobile-api-production.up.railway.app/v1/tiktok/callback`
      (e o equivalente de staging, se houver).
- [ ] Sandbox: criar e adicionar as contas TikTok de teste como *target users*.
- [ ] Colocar `TIKTOK_CLIENT_KEY` e `TIKTOK_CLIENT_SECRET` no `backend/.env` e
      no Railway. O secret nunca vai para o chat, issue ou commit.
- [ ] Depois do vídeo (§4): enviar para revisão, registrar o número da
      solicitação na XIAOLEEACE-24.

## 2. Integração (código)

### Fluxo

```
App "Connect TikTok"
  → GET  /v1/tiktok/connect            → { authorize_url }   (state amarrado à sessão)
  → navegador interno: tiktok.com/v2/auth/authorize/ (client_key, scope, redirect_uri, state, response_type=code)
  → GET  /v1/tiktok/callback?code&state → troca code em /v2/oauth/token/, grava tokens, redirect xiaolee://tiktok/connected
App mostra "Send to TikTok" no corte pronto
  → POST /v1/media/{id}/clips/{clip_id}/tiktok
       grava ClipPublication(status=pending)  ← intent log antes do rail (CLAUDE.md)
       POST /v2/post/publish/inbox/video/init/ (FILE_UPLOAD) → { publish_id, upload_url }
       PUT  upload_url com o MP4 lido do R2 (Content-Range)
       → status=uploaded
  → GET  /v1/media/{id}/clips/{clip_id}/tiktok → status (consulta /v2/post/publish/status/fetch/)
Creator abre o TikTok, acha o corte na caixa de entrada/rascunhos e posta.
  → DELETE /v1/tiktok                  → revoga (/v2/oauth/revoke/) e apaga os tokens (promessa da /privacy)
```

### Backend (a criar)

| Peça | Nota |
|---|---|
| `server/integrations/tiktok_client.py` | OAuth (token, refresh, revoke) + init/PUT/status. `httpx` async, como os outros clientes. |
| `server/tiktok_routes.py` | As rotas acima. Dono sempre pelo Bearer, nunca por parâmetro. |
| Modelo `TikTokAccount` | `user_id`, `open_id`, `access_token`/`refresh_token` **criptografados** (`user_management/encryption_service.py`), `scopes`, `expires_at`. Access token vale 24 h, refresh 365 dias: renovar antes de cada envio. |
| Modelo `ClipPublication` | `clip_id`, `platform='tiktok'`, `publish_id`, `status`, `error`. Um envio por corte+plataforma: reenviar exige pedido explícito (limite de 5 envios pendentes por 24 h no TikTok). |
| Migração Alembic | as duas tabelas. |

**Por que `FILE_UPLOAD` e não `PULL_FROM_URL`:** no modo URL o TikTok baixa o
vídeo sozinho, mas só de domínio/prefixo verificado. Os cortes moram no R2
(`*.r2.cloudflarestorage.com`, URL pré-assinada), domínio que não temos como
verificar. Com `FILE_UPLOAD` o backend lê do R2 e faz o PUT; um corte de
30–60 s 1080×1920 tem dezenas de MB, cabe em um ou poucos chunks (conferir
os limites de chunk na doc antes de implementar). Alternativa futura: domínio
próprio no bucket R2 + verificação de prefixo → `PULL_FROM_URL`, sem o MP4
passar pelo backend.

### App (a criar)

- `lib/clip-share.ts` já concentra "tirar o corte do app"; o envio ao TikTok
  entra como outra função ali (`sendClipToTikTok`), que só chama o backend.
- `ClipCard` já tem a fileira de ações (Play, Share); "Send to TikTok" entra ao
  lado do Share quando a conta estiver conectada.
- "Connect TikTok": `WebBrowser.openAuthSessionAsync(authorize_url, 'xiaolee://tiktok/connected')`
  (o scheme `xiaolee` já existe no `app.json`). Status da conexão e
  "Disconnect" no painel de perfil.

## 3. Textos para o formulário de revisão (inglês)

**App description**

> XiaoLee helps content creators turn long videos (podcasts, lives, talks)
> into short vertical clips. The creator uploads a video in the XiaoLee app,
> we transcribe it, pick the three strongest moments and render 9:16 clips with
> captions. The creator reviews each clip and, if they choose, sends it to
> their own TikTok account to finish and publish it there.

**Login Kit — `user.info.basic`**

> Used only to identify which TikTok account the creator connected. We show the
> account's display name and avatar in XiaoLee so the creator knows where their
> clips will be sent, and we store the open_id to link the access token to that
> creator. The creator can disconnect at any time, which revokes and deletes
> the token.

**Content Posting API — `video.upload`**

> When the creator taps "Send to TikTok" on a clip they approved, XiaoLee
> uploads that single MP4 to the creator's TikTok inbox. Nothing is uploaded
> without that explicit tap. The creator then opens TikTok, edits the caption,
> chooses privacy settings and publishes it themselves. We never post on their
> behalf automatically.

## 4. Roteiro do vídeo de demonstração (sandbox)

Gravar a tela do celular com o app de desenvolvimento, conta de teste do sandbox:

1. Abrir o XiaoLee (a doc pede que o vídeo comece abrindo o app).
2. Clips → vídeo já processado → mostrar os 3 cortes e tocar um.
3. "Connect TikTok" → tela de autorização do TikTok com os scopes → autorizar
   → volta ao app mostrando a conta conectada.
4. "Send to TikTok" num corte → status "Sent".
5. Abrir o TikTok → caixa de entrada/rascunhos → o corte está lá.
6. Voltar ao XiaoLee → perfil → "Disconnect TikTok".

Até 5 vídeos de 50 MB; a interface e cada interação precisam estar visíveis.

## 5. Depois da aprovação

- App aprovado: o envio funciona para qualquer creator, mas **cliente não
  auditado tem restrições** (conteúdo de postagem direta fica privado; limite
  de envios pendentes). Conferir na doc o que vale para o fluxo de inbox.
- `video.publish` (postagem direta, o creator não precisa abrir o TikTok) exige
  a **auditoria** de conteúdo — leva semanas. Pedir só depois de o fluxo de
  inbox rodar com creators reais.
- Fallback exigido pela task se a aprovação atrasar: a tela de compartilhar do
  sistema (já no app) cobre TikTok, Reels e Shorts manualmente; YouTube Shorts
  pela API do YouTube é a alternativa automatizada.

Referências: [Content Posting API — Get started](https://developers.tiktok.com/doc/content-posting-api-get-started) ·
[Upload video (inbox)](https://developers.tiktok.com/doc/content-posting-api-reference-upload-video) ·
[OAuth token management](https://developers.tiktok.com/doc/oauth-user-access-token-management) ·
[App review guidelines](https://developers.tiktok.com/doc/app-review-guidelines)
