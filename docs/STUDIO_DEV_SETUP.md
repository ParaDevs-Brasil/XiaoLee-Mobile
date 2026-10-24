# Studio / AI Creators: rodar e validar sem gastar

Guia para quem mexe nas telas do Studio (AI Creators: personagens, Talk, Mimic, Replace) e precisa rodar o app e o
backend sem as chaves pagas da casa. Escrito em 2026-10-24.

**Resumo:** quase tudo se vê de graça, com chaves falsas e dados de exemplo. Só **gerar um vídeo de verdade** custa
dinheiro (fal + ElevenLabs + pagamento em USDC na Arc) e tem um passo à parte, na seção 5.

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

- **Gerar vídeo novo**: o app assina o pagamento em USDC e o backend tenta o relay on-chain; sem a chave de relay
  da casa cai no erro "The payment didn't go through". Esse erro também é um estado de tela para revisar.
- **Prévia do Replace nova** e **amostra de voz**: chamam a fal e a ElevenLabs.
- Qualquer coisa que dependa do Privy real: use uma conta de teste sua.

## 5. Validar a geração de verdade (paga)

Isso gasta dinheiro de verdade em duas pontas e **o sistema de pagamento não tem modo de teste**: o app assina uma
transferência de USDC na Arc **mainnet** (EIP-3009) para `CREATORS_PAY_TO`, e a casa paga o gás do relay. Por isso:

- **Quem faz:** o Gustavo (dono das chaves e da carteira). O Josh valida a UI com o seed (seção 3) e, quando
  precisar ver um vídeo real, pede para o Gustavo rodar o roteiro abaixo e mandar o resultado/gravação de tela.
- Se for **inevitável** o Josh rodar a geração paga: ele precisa de chaves **dedicadas, com teto de gasto**
  (ex.: US$ 5 no painel da fal e da ElevenLabs), criadas pelo Gustavo e **revogadas depois**. Nunca as da casa.
  A carteira do Josh precisa de USDC na Arc mainnet, e o relay precisa da chave de gás da casa, que não sai do
  Gustavo. Na prática, só o Gustavo fecha esse ciclo.

**Custo por vídeo** (o app cobra o dobro do custo na fal; preço cobrado em USDC por duração de 5 / 10 / 15 s):

| Tipo | Qualidade | Custo fal por s (US$) | Preço cobrado 5 / 10 / 15 s |
|---|---|---|---|
| Talk | Standard | 0,080 | 0,80 / 1,60 / 2,40 |
| Talk | Pro | 0,140 | 1,40 / 2,80 / 4,20 |
| Talk | Pro+ | 0,303 | 3,04 / 6,07 / 9,11 |
| Mimic | Standard | 0,070 | 0,70 / 1,40 / 2,10 |
| Mimic | Plus | 0,126 | 1,26 / 2,52 / 3,78 |
| Mimic | Pro | 0,168 | 1,68 / 3,36 / 5,04 |
| Replace | Plus | 0,126 | 1,26 / 2,52 / 3,78 |
| Replace | Pro | 0,168 | 1,68 / 3,36 / 5,04 |

**Roteiro mínimo de validação paga** (menos de US$ 3 de custo real, tudo com 5 s):

1. Talk Standard (US$ 0,40 de fal): confirma pagamento, estados `queued → voice → video → done` e o vídeo pronto.
2. Mimic Standard (US$ 0,35): confirma o upload do vídeo de movimento e o estado final.
3. Replace Plus (US$ 0,63 + prévia grátis): confirma prévia, aprovação e vídeo final.
4. Um caso de falha (ex.: foto de pessoa real no Replace): confirma a mensagem e o reembolso.

O pagamento volta para `CREATORS_PAY_TO` (a própria carteira da casa), então o custo líquido é fal + ElevenLabs + gás.

## 6. Pegadinhas

- Mexeu de worktree ou de branch: `npx expo start --clear`, senão o Metro resolve o `src/app` do outro.
- Aparelho Xiaomi/MIUI bloqueia `adb input` de teclado; use o toque e a digitação no próprio aparelho.
- Expo SDK 57: leia a versão certa da doc antes de usar API de arquivo (`expo-file-system` `File`) ou de áudio.
- O seed grava arquivos em `backend/.demo-storage` (já ignorado pelo git).
- Rodou o seed antes de logar no app? Ele falha com "Nenhum usuário": faça login e rode de novo.
