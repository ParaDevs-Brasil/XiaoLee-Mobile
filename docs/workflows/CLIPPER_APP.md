# Clipper no app (XIAOLEEACE-29)

O creator envia um vídeo longo pelo app e recebe 3 cortes verticais (9:16) legendados, escolhidos por IA. Com eles,
pode **tocar**, **salvar na galeria** ou **compartilhar** (TikTok, Reels, Shorts, WhatsApp…).

Este documento cobre a parte do app e o que ela espera do backend. O backend em si (upload pré-assinado,
transcrição em janelas, escolha dos cortes, renderização com ffmpeg, retenção) veio no PR #4 e é descrito em
`backend/server/media_routes.py` e `backend/server/clipper.py`.

---

## 1. Telas

| Rota | O que mostra |
|---|---|
| `/clips` (menu ☰ → Clips) | Botão **Choose a video**, com barra de envio, % e tempo restante. Glossário "Words to get right". Lista **Your videos**, com miniatura, status e filtros (All, Processing, Ready, Needs attention). |
| `/clips/[id]` | Passos do processamento, escolha de enquadramento, **Generate 3 clips**, cards dos cortes (miniatura, trecho, citação, motivo) com **Play**, **Save** e **Share**, e ações de renomear e apagar. |
| Player | Tela cheia, com controles próprios. A URL do vídeo é pedida de novo ao tocar, porque as URLs do R2 valem 1 h. |

Arquivos principais:

| Arquivo | Responsabilidade |
|---|---|
| `mobile/src/api/backend.ts` | Chamadas `/v1/media*` e `/v1/media/glossary*` |
| `mobile/src/lib/clips.ts` | Regras puras, testadas em `clips.test.ts`: passo da tela (`clipFlow`), status da lista (`mediaListStatus`), detecção de travamento (`isStale`), nomes de arquivo, formatação |
| `mobile/src/lib/clip-share.ts` | Destinos do corte: `downloadClip`, `saveClipToDevice`, `shareClip` |
| `mobile/src/lib/media-upload.ts`, `hooks/use-media-upload.ts` | Seletor de arquivo e envio pelo `PUT` pré-assinado, até o `/complete` |
| `mobile/src/hooks/use-backend-data.ts` | Busca com recarga ao focar a tela. A consulta repetida (`pollMs`) pode depender dos dados já recebidos. |
| `mobile/src/app/clips/*`, `components/{clip-card,clip-player,video-row,glossary-card,…}.tsx` | Telas e componentes |

## 2. Como a tela sabe em que passo está

**A tela nunca guarda o passo na memória**: ela calcula o passo a partir do que o backend responde. Por isso, se o
creator fechar o app no meio, ao reabrir a tela continua de onde parou.

`clipFlow(media, clips)` (tela do vídeo) e `mediaListStatus(media)` (lista) usam as mesmas regras:

| Backend | Passo na tela | Chip na lista | Grupo do filtro |
|---|---|---|---|
| `pending` / `uploaded` | Upload incompleto → "Check again" | Upload incomplete | Needs attention |
| `transcribing` | Transcrevendo (spinner) | Transcribing | Processing |
| `transcribing` há mais de 6 h | "This is taking longer than it should" → "Transcribe again" | Transcribing | Processing |
| `failed` | Falha → "Transcribe again" | Failed | Needs attention |
| `expired` | "This video expired" (a retenção apagou os arquivos) | Expired | Needs attention |
| `transcribed`, áudio | "Clips need a video" | Audio only | Needs attention |
| `transcribed`, sem cortes | Escolher enquadramento → Generate | Generate clips | Needs attention |
| cortes `pending`/`rendering` | "Rendering clips · 1 of 3 ready" | Rendering 1/3 | Processing |
| todos os cortes em andamento há mais de 6 h | "Rendering stopped" → Generate again | Rendering 1/3 | Processing |
| cortes prontos | Cards com Play, Save e Share | 3 clips ready / 2 of 3 ready | Ready |
| todos os cortes falharam | Generate again | Render failed | Needs attention |

**`transcribed` só significa que a transcrição terminou.** Por isso a lista usa as contagens `clips_total`,
`clips_ready` e `clips_in_progress`, que vêm em `GET /v1/media`. Sem elas, um vídeo ainda renderizando aparecia como
"Ready".

**Atualização automática:** a tela consulta o backend de novo só enquanto há trabalho em andamento:
- vídeo: a cada 3 s enquanto transcreve, por `GET /v1/media/{id}?include_transcript=false` (sem baixar a transcrição);
- cortes: a cada 4 s enquanto renderizam;
- lista: a cada 5 s enquanto algum vídeo está em Processing.

**Prazo de "travado" (6 h):** é o mesmo `STALE_TRANSCRIBING` do backend e o `STALE_MS` do app. Restart do
servidor não depende desse prazo: o *reaper* (`media_maintenance.reap_interrupted`) marca como falha, no boot, o que
ficou pela metade. Os 6 h só liberam um job pendurado, e são longos para não disparar no meio de uma transcrição
longa legítima (até 4 h de áudio, mais a fila).

## 3. Contrato com o backend

| Endpoint | Uso no app |
|---|---|
| `POST /v1/media` | Recebe a URL pré-assinada; o app faz o `PUT` direto no R2 |
| `POST /v1/media/{id}/complete` | Confirma o envio e inicia a transcrição. Toque duplo → 409 no segundo. |
| `GET /v1/media` | Lista, com `title`, `thumbnail_url`, `updated_at` e as contagens de cortes |
| `GET /v1/media/{id}` | Detalhe; `?include_transcript=false` para consultar só o status |
| `PATCH` / `DELETE /v1/media/{id}` | Renomear e apagar o vídeo (apaga também os objetos no bucket) |
| `POST /v1/media/{id}/clips?layout=auto\|crop\|fit[&regenerate=true]` | Escolhe os cortes na hora (5–20 s) e renderiza em background. Toque duplo → 409. |
| `GET /v1/media/{id}/clips` | Cortes, com `download_url` e `thumbnail_url` (válidas por 1 h) |
| `PATCH` / `DELETE /v1/media/{id}/clips/{clip_id}` | Renomear e apagar um corte |
| `GET` / `PUT /v1/media/glossary`, `GET /v1/media/glossary/suggestions` | Glossário do creator. O `PUT` substitui a lista inteira. |

Enquadramento: **Automatic** é o padrão (o Claude olha quadros do vídeo e escolhe). Se falhar, o backend usa
"Screen recording", que nunca corta conteúdo.

### Erros que o app mostra

| Situação | Resposta | O que o creator vê |
|---|---|---|
| Provedor de IA indisponível: sem chave, **sem crédito**, chave inválida, limite de uso, fora do ar | 503 "Clip service is temporarily unavailable. Try again later." | A mensagem genérica. O motivo real (ex.: `credit balance is too low`) fica **só no log**. |
| Storage não configurado | 503 com a mesma mensagem | Idem |
| Falha inesperada na escolha dos cortes | 502 "highlight detection failed, try again" | Tentar de novo faz sentido |
| Nenhum trecho aproveitável | 422 "no usable highlights found in this video" | — |
| Render de um corte falhou | corte `failed`, com "render failed, generate the clips again" | O stderr do ffmpeg fica no log |
| Arquivo ilegível na transcrição | `failed`, com "could not read this file as video or audio…" | — |

Antes desta mudança, um provedor sem crédito voltava como 502 "try again", e o creator insistia num erro que só a
equipe resolve. Agora `clipper._is_provider_side` classifica o erro pelo status HTTP (401, 402, 403, 429, 5xx, ou 400
com "credit balance"), o que vale tanto para o SDK da Anthropic quanto para o da Groq.

## 4. Salvar e compartilhar

Os dois baixam o MP4 uma vez por corte para o cache do app (`downloadClip`). O download vai para um arquivo `.part`
e só é renomeado no fim, para que uma queda de conexão nunca deixe um vídeo pela metade com o nome final.

- **Save** (`expo-media-library`, API nova `Asset.create`): grava na galeria, na pasta DCIM no Android.
  - Android 11+ (API 30+): não pede permissão (MediaStore).
  - Android ≤ 10: pede permissão de escrita, porque a biblioteca usa o caminho legado e a exige.
  - iOS: só "adicionar à galeria" (`writeOnly`). O texto do pedido está em `ios.infoPlist` no `app.json`.
  - O **config plugin da biblioteca fica de fora** do `app.json`: ele adicionaria permissões de leitura
    (`READ_MEDIA_*`) que exigem declaração na Play Store. As duas permissões de leitura que o manifesto da
    biblioteca traz estão bloqueadas em `android.blockedPermissions`.
- **Share** (`expo-sharing`): abre a tela de compartilhar do sistema.
- **Módulos nativos:** os dois só funcionam em builds gerados depois que entraram no projeto. O app verifica com
  `requireOptionalNativeModule` e esconde os botões em builds antigos, sem quebrar. O pacote é carregado com
  `require` dentro da função, e não com `import()`: em desenvolvimento, o `import()` baixava um pedaço extra de código
  do Metro na hora do toque e, com o Metro fora de alcance, recarregava o app, que travava no Android.
- **Próximos destinos** (comentados em `clip-share.ts`): nuvem do creator (Drive, Dropbox) e TikTok direto
  (ver `TIKTOK_DIRECT_POST.md`). Nesses casos o backend copia do R2, sem passar pelo celular.

## 5. Rodar localmente no celular (Android, USB)

### Backend
1. Crie o `backend/.env`, que já está no `.gitignore`. **Não** coloque `DATABASE_URL`: sem ele, o backend usa SQLite local.
   ```
   PRIVY_APP_ID=…            # público
   R2_ENDPOINT_URL=…  R2_ACCESS_KEY_ID=…  R2_SECRET_ACCESS_KEY=…  R2_BUCKET=…
   GROQ_API_KEY=…            # transcrição
   ANTHROPIC_API_KEY=…       # escolha dos cortes e enquadramento automático
   ```
2. Suba o backend:
   ```bash
   cd backend && ../.venv/bin/alembic upgrade head
   ```
   ```bash
   cd backend && ../.venv/bin/uvicorn server.app:app --reload --host 0.0.0.0 --port 8000
   ```
   O `--reload` não relê o `.env`. Depois de mudar o arquivo, reinicie o processo.

### App
1. Libere as portas pelo cabo. Repita se o celular for desconectado ou se o `adb` reiniciar.
   ```bash
   adb reverse tcp:8081 tcp:8081
   ```
   ```bash
   adb reverse tcp:8000 tcp:8000
   ```
2. Build de desenvolvimento, necessário na primeira vez e sempre que entrar um módulo nativo. O Gradle 9.3 não roda
   com o JDK 27, então use o 21:
   ```bash
   cd mobile && JAVA_HOME=/usr/lib/jvm/java-21-openjdk EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo run:android
   ```
3. Depois disso, basta o Metro:
   ```bash
   cd mobile && EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start --dev-client --localhost
   ```
   O `EXPO_PUBLIC_API_URL` na linha de comando tem prioridade sobre o `mobile/.env`, que aponta para produção. Se o
   app abrir tentando o IP da Wi-Fi e não conectar, abra pelo cabo:
   ```bash
   adb shell am start -a android.intent.action.VIEW -d "exp+xiaolee://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" XiaoLee.app
   ```

### Sem chaves: modo demo
Para trabalhar só na interface. Em `backend/.env`, troque o bloco R2 por:
```
R2_ENDPOINT_URL=http://localhost:9000
R2_ACCESS_KEY_ID=demo
R2_SECRET_ACCESS_KEY=demo
R2_BUCKET=demo
```
```bash
cd backend && ../.venv/bin/python scripts/clipper_demo_seed.py --serve
```
```bash
adb reverse tcp:9000 tcp:9000
```
```bash
cd backend && ../.venv/bin/python scripts/clipper_demo_seed.py
```
- O comando `--serve` sobe um "R2" falso local, que aceita envio e entrega dos arquivos (com o upload em partes que o
  boto3 usa). O último comando cria um vídeo de exemplo em cada estado para o último usuário que fez login, com MP4s
  verticais de exemplo. Play, Save e Share funcionam.
- O script recusa qualquer banco que não seja SQLite local (`--force` para insistir).
- O backend só aceita R2 sem TLS em `localhost` e com `XIAOLEE_ENV=dev`.

### Sem crédito na Anthropic: Groq para escolher os cortes
`HIGHLIGHTS_PROVIDER=groq` no `backend/.env` faz a escolha dos cortes (inclusive a divisão de vídeos longos e a
ordenação dos candidatos) passar pela Groq, de graça, com o mesmo prompt, a mesma ferramenta e a mesma validação.
**Só para teste local:**
- a qualidade é menor que a do Claude;
- o plano grátis tem limite de tokens por minuto, que não comporta a transcrição de 1 h;
- o enquadramento automático continua usando o Claude e, sem crédito, cai em "Screen recording".

O padrão continua sendo o Claude.

## 6. Segurança

A revisão pré-PR corrigiu:
- **Credenciais em mensagens de erro:** o stderr do ffmpeg era cortado antes de esconder a URL pré-assinada, e o
  fim dela (Access Key ID e assinatura) chegava ao log e ao app. Agora `clipper.redact_media_urls` esconde a URL antes
  do corte.
- **Jobs duplicados:** `/complete` usa um UPDATE condicional e `POST /clips` tem uma trava por vídeo (o backend roda
  com um worker).
- **Mensagens de erro:** os 503 são genéricos, sem nomes de variáveis de configuração.
- **Entradas e casos-limite:**
  - nomes de arquivo só com pontos;
  - renomear não reinicia mais o prazo de "travado";
  - preenchimento de miniaturas tratado item a item;
  - permissões de leitura de mídia bloqueadas no app;
  - Save no Android 10.

**Pendente (backend, outro PR):**
- **A1:** restringir formatos e protocolos do ffmpeg ao abrir o arquivo do usuário (`-protocol_whitelist`,
  `-format_whitelist`, lista fechada de content-types). Hoje um HLS (`.m3u8`) enviado como mídia permite SSRF.
- **A2:** limite de uso por usuário em `POST /v1/media`, `/complete` e `POST /clips`, mais um teto de jobs de ffmpeg
  simultâneos.
- **B4:** validar o formato a cada leitura, e não só no `/complete`.

## 7. Pendências da task

- Testar com 1 h de fala real (qualidade da escolha e meta de menos de 10 min) e ao vivo com 1 creator.
- Limite de 2 GB: uma gravação de 1 h no celular passa disso. Precisa de upload em partes no backend.
- Novo build no EAS para `expo-sharing` e `expo-media-library`.
- Confirmar o Save num iPhone (`writeOnly`).
- TikTok direto: `TIKTOK_DIRECT_POST.md` (XIAOLEEACE-24).
