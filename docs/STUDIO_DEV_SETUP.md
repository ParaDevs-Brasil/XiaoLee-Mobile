# Studio / AI Creators: rodar e validar sem gastar

Guia para quem mexe nas telas do Studio (AI Creators: personagens, Talk, Mimic, Replace) e precisa rodar o app e o
backend sem as chaves pagas da casa. Escrito em 2026-10-24.

**Resumo:** quase tudo se vê de graça, com chaves falsas e dados de exemplo. **Gerar um vídeo de verdade** custa
dinheiro (fal + ElevenLabs): para isso o Gustavo manda chaves dedicadas com teto de gasto e você liga um interruptor de
desenvolvimento que dispensa o pagamento em USDC (seção 5).

## 1. O que NÃO pedir nem receber

- Nenhuma chave real vai para o git, para o chat ou para o `.env.example`.
- Você **não precisa** de: `FAL_KEY`, `ELEVENLABS_API_KEY`, `CIRCLE_*`, `ARC_AGENT_PRIVATE_KEY` (relay de gás),
  tokens do Telegram, `X_*` reais. Os de prod nunca saem do Railway.
- O backend local **não pode** subir com o token do bot de Telegram de produção: deixe o poller desligado
  (`TELEGRAM_POLLER_ENABLED=false`) e os tokens vazios.

## 2. Subir o ambiente (de graça)

Pré-requisitos: `make init` já rodado (cria `.venv` e instala o backend), `ffmpeg` instalado, celular Android no USB
com depuração ligada, dev client do app instalado.

**`backend/.env`** (os valores abaixo são de mentira de propósito; `enabled()` só confere se não estão vazios):

```bash
DATABASE_URL=sqlite+aiosqlite:///./dev.db
TELEGRAM_POLLER_ENABLED=false
PRIVY_APP_ID=cmslvjr0w005r0cjx2d8fncv3          # público, o mesmo de mobile/eas.json

# AI Creators ligado, mas sem gastar: chaves falsas
FAL_KEY=demo
ELEVENLABS_API_KEY=demo
CREATORS_PAY_TO=0x000000000000000000000000000000000000dEaD

# "R2" de mentira (pasta local servida na porta 9000)
R2_ENDPOINT_URL=http://localhost:9000
R2_ACCESS_KEY_ID=demo
R2_SECRET_ACCESS_KEY=demo
R2_BUCKET=demo

# Opcional: só se quiser que a Xiaolee escreva o roteiro (custa centavos). Sem isso, o botão de roteiro falha.
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=
```

**`mobile/.env`** (copie de `mobile/.env.example`; os IDs do Privy são públicos, estão em `mobile/eas.json`):

```bash
EXPO_PUBLIC_PRIVY_APP_ID=cmslvjr0w005r0cjx2d8fncv3
EXPO_PUBLIC_PRIVY_CLIENT_ID=<o de mobile/eas.json>
EXPO_PUBLIC_API_URL=http://localhost:8000
```

**Comandos** (cada um num terminal):

```bash
# 1) backend
cd backend && ../.venv/bin/uvicorn server.app:app --port 8000

# 2) o "R2" de mentira (imagens e MP4s de exemplo; aceita upload)
cd backend && ../.venv/bin/python scripts/clipper_demo_seed.py --serve

# 3) Metro (uma vez; troque --clear se alternar de worktree/branch)
cd mobile && npx expo start --dev-client --port 8081

# 4) celular no USB
adb reverse tcp:8000 tcp:8000; adb reverse tcp:8081 tcp:8081; adb reverse tcp:9000 tcp:9000
```

Abra o app, **faça login** (o seed usa quem logou por último) e então rode:

```bash
cd backend && ../.venv/bin/python scripts/creators_demo_seed.py     # pode repetir: recria sem duplicar
```

## 3. O que o seed cria e o que você consegue ver

Dois personagens (**Demo Luna**, **Demo Bolt**), seis vídeos e uma prévia do Replace:

| Estado na tela | Como aparece no seed |
|---|---|
| Talk pronto (Play / Save / Share) | Demo Luna, `standard`, `done` |
| Gerando (em andamento) | Demo Luna, `standard`, `video` |
| Falhou com reembolso | Demo Luna, `standard`, `failed` (mensagem "Your payment will be refunded.") |
| Mimic pronto | Demo Bolt, `mimic`, `done` (áudio original) |
| Replace pronto | Demo Bolt, `swap`, `done` |
| Replace na fila | Demo Bolt, `swap`, `queued` |
| Prévia do Replace pronta | Demo Bolt (quadro de exemplo) |

Funciona de graça: catálogo, preços, vozes, lista de personagens, abrir/tocar/salvar vídeos, estados vazios e de
erro, criar personagem e subir foto (vai para o R2 de mentira).

## 4. O que NÃO funciona com chaves falsas (esperado)

- **Gerar vídeo novo**: chama a fal de verdade; com chave falsa o vídeo falha. Para gerar de verdade, siga a seção 5.
- **Prévia do Replace nova** e **amostra de voz**: chamam a fal e a ElevenLabs.
- Qualquer coisa que dependa do Privy real: use uma conta de teste sua.

## 5. Gerar vídeo de verdade (paga)

Em produção o app assina uma transferência de USDC na Arc mainnet (EIP-3009) e o backend faz o relay on-chain com
a chave de gás da casa. Essa chave **não sai do Gustavo**. Para você testar a geração no seu backend, existe um
interruptor **só de desenvolvimento** que pula o relay e vai direto para a fal e a ElevenLabs. O app continua
assinando, e o backend ainda confere valor, destino e nonce; só o pagamento on-chain é pulado.

**O que você precisa** (o Gustavo manda por canal seguro, nunca por chat nem git; são chaves **dedicadas, com teto de
gasto** e serão revogadas depois):

- `FAL_KEY` (vídeo) e `ELEVENLABS_API_KEY` (voz do Talk e amostras)
- opcional: `ANTHROPIC_API_KEY`, só para a Xiaolee escrever o roteiro

**No `backend/.env`**, troque as chaves falsas da seção 2 pelas reais e ligue o interruptor:

```bash
FAL_KEY=<a que o Gustavo mandou>
ELEVENLABS_API_KEY=<a que o Gustavo mandou>
CREATORS_PAY_TO=0x000000000000000000000000000000000000dEaD   # qualquer endereço; o app paga para ele
CREATORS_DEV_SKIP_PAYMENT=true
# XIAOLEE_ENV não definido = "dev" (o padrão). Se estiver como "production", o interruptor é IGNORADO e o log avisa.
```

Reinicie o backend. No app, gere normalmente: o vídeo entra na fila (`payment_tx` aparece como `dev-skip-...`), passa
por `voice` e `video` e fica `done` com o vídeo real. O limite por usuário (`CREATORS_DAILY_VIDEOS_PER_USER`, 10 por
dia) continua valendo e ajuda a segurar o gasto.

**Regras**

- Nunca coloque `CREATORS_DEV_SKIP_PAYMENT` em nenhum ambiente que não seja o seu local. No Railway ele não existe e
  não deve existir.
- Nunca faça commit de `.env`. Eles estão no `.gitignore`; confira com `git status` antes de cada commit.
- Teto de gasto: se a chave acabar, a geração falha com "We couldn't make this video." Peça outra ao Gustavo.

**Custo por vídeo** (custo real na fal por segundo; o app mostra ao usuário o dobro disso). Com o interruptor ligado
você paga só o custo da fal e da ElevenLabs:

| Tipo | Qualidade | Custo fal por s (US$) | Custo em 5 / 10 / 15 s | Preço ao usuário 5 / 10 / 15 s |
|---|---|---|---|---|
| Talk | Standard | 0,080 | 0,40 / 0,80 / 1,20 | 0,80 / 1,60 / 2,40 |
| Talk | Pro | 0,140 | 0,70 / 1,40 / 2,10 | 1,40 / 2,80 / 4,20 |
| Talk | Pro+ | 0,303 | 1,52 / 3,03 / 4,55 | 3,04 / 6,07 / 9,11 |
| Mimic | Standard | 0,070 | 0,35 / 0,70 / 1,05 | 0,70 / 1,40 / 2,10 |
| Mimic | Plus | 0,126 | 0,63 / 1,26 / 1,89 | 1,26 / 2,52 / 3,78 |
| Mimic | Pro | 0,168 | 0,84 / 1,68 / 2,52 | 1,68 / 3,36 / 5,04 |
| Replace | Plus | 0,126 | 0,63 / 1,26 / 1,89 | 1,26 / 2,52 / 3,78 |
| Replace | Pro | 0,168 | 0,84 / 1,68 / 2,52 | 1,68 / 3,36 / 5,04 |

**Roteiro mínimo de validação** (tudo com 5 s, menos de US$ 3 no total):

1. Talk Standard (US$ 0,40): estados `queued → voice → video → done` e o vídeo pronto.
2. Mimic Standard (US$ 0,35): upload do vídeo de movimento e estado final.
3. Replace Plus (US$ 0,63; a prévia é grátis e limitada): prévia, aprovação e vídeo final.
4. Um caso de falha (ex.: foto de pessoa real no Replace): mensagem e reembolso.

O fluxo de pagamento de verdade (assinatura, saldo, relay) **não** é exercitado com o interruptor ligado. Quem valida
isso é o Gustavo, uma vez, antes do deploy.

## 6. Pegadinhas

- Mexeu de worktree ou de branch: `npx expo start --clear`, senão o Metro resolve o `src/app` do outro.
- Aparelho Xiaomi/MIUI bloqueia `adb input` de teclado; use o toque e a digitação no próprio aparelho.
- Expo SDK 57: leia a versão certa da doc antes de usar API de arquivo (`expo-file-system` `File`) ou de áudio.
- O seed grava arquivos em `backend/.demo-storage` (já ignorado pelo git).
- Rodou o seed antes de logar no app? Ele falha com "Nenhum usuário": faça login e rode de novo.
