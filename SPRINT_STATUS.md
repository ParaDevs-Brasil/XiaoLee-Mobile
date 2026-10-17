# XiaoLee — Sprint Status
> Hackathon Lepton (Arc/Circle) · Deadline: **29 jun 2026** · Branch: `feature/agent-brain-lead`
> Scoring: Agentic 30% · Traction 30% · Circle Tools 20% · Innovation 20%

---

## ✅ O que foi feito

### Loop Agêntico — Agentic 30%
- `ClaudeAgentEngine` — loop nativo Anthropic SDK (discover → evaluate → check_budget → pay)
- 4 tools em formato OpenAI: `discover_creators`, `evaluate_creator`, `check_budget`, `pay_creator_nanopayment`
- Rotas FastAPI: `POST /v1/agent/run-campaign` + `GET .../status` com polling assíncrono
- Modelo `PaymentIntent` — log durável antes do pagamento (anti-replay UUID v4)
- Migração Alembic: `20260622_add_payment_intents.py`
- E2E validado em sandbox: 3 pagamentos × $5 USDC, 2 creators filtrados por score < 50

### Frontend
- Hook `useAgentStatus` — posta campanha e faz polling a cada 2.5s até status terminal
- Painel `AgentStatus` — badge de status, USDC gasto, lista de pagamentos, steps do agente
- Painel visível apenas para o criador da campanha (`isCreator=true`)

### Integração Circle (modo sandbox)
- `ArcClient` conectado à Circle Programmable Wallets API (W3S)
- Modo sandbox (`ARC_SANDBOX=true`): pagamentos simulados localmente, sem chamar a API real
- API key validada: `TEST_API_KEY:<redacted>` funciona na Circle W3S API

### Qualidade
- **91/91 testes passando** (4 falhas pré-existentes corrigidas)
- `GEMINI_MODEL` corrigido de `gemini-3.1-pro-preview` (inexistente) → `gemini-2.5-flash`

---

## 🔴 BLOQUEANTE — Variáveis Circle não configuradas

> **Sem isso, Traction 30% + Circle Tools 20% = zero pontos.**
> O agente roda, mas todos os pagamentos são **simulados** (tx hash fake).
> O júri precisa ver USDC real fluindo na testnet Sepolia.

### Variáveis que precisam ser preenchidas no `.env`

```bash
# ── Estado atual — PAGAMENTO SIMULADO ──────────────────────────────────────
CIRCLE_API_KEY="TEST_API_KEY:<redacted>"
CIRCLE_WALLET_ID=353c8584-efb6-50e9-adf9-132bfa21569b   # ← este é o APP ID, não wallet ID
ARC_SANDBOX=true                                          # ← modo fake, precisa virar false

# ── O que precisa ficar assim — PAGAMENTO REAL ──────────────────────────────
CIRCLE_API_KEY="TEST_API_KEY:<redacted>"    # já preenchido ✅
CIRCLE_WALLET_ID=<uuid-da-wallet-real>       # ← FALTA: criar wallet na Circle W3S API
CIRCLE_ENTITY_SECRET=<redacted>       # ← FALTA: entity secret para assinar requests
ARC_SANDBOX=false                            # ← FALTA: mudar para ativar pagamentos reais
```

### Por que está bloqueado

A Circle Programmable Wallets API exige um **entity secret** — uma chave de 32 bytes que você
gera localmente e configura no console antes de criar qualquer wallet. Isso é uma medida de
segurança para que a Circle nunca tenha acesso às chaves privadas das wallets.

### Como desbloquear (passo a passo)

**Passo 1 — Configurar entity secret no console (1 vez só)**

1. Acesse **console.circle.com → Developer → Entity Secret → Set Secret**
2. Cole o ciphertext abaixo e confirme:

```
CTronPCF8Gh8m5vCVbDA1vKikORm2Qmh22c7i1oRmm51xd0Cj0IwBvzNKN+w2cOmZNmfW+kPK4NUR1Sf
hUALTehT9vZmU9AcHZx0wD12HFlFTUJK4os0Upx2ty7r4kqHk1Xeal6nq2w0t+SxgZoDwj3v5mIbcRv
kRtMVl6wCgnFCIUPdmXOR6F6/nF7H7hlosJGqFvfS4YCR+ZfRUO5G5y/bPIHF4bs8vKRrA++wsIEbT4
2xacZuFXIeho9DNZUCJK67nyfNVi9dZrno3ZyeEorItG5E9vtIEhY0+5QAor/RJwd5HVmJQD1Vqdj
xHdf8gtwG8BMRxnDgO7qVX6T1Nv0cBR0OMBwl+yR4TgNE4YO503QAFzPNDooOJQ7mW6yc3nW3WEvgq
XY32Iu7aksNvEEJuteIox2aPIhs63LcRARoTSVPw1Nnj1lGS9lSpIIIr7SiYb3mbnpm9mHFO2ASn5q
DefxV1BAiYWtOhcgt9Sqmuw7ioA98+FzwI6+GaUaBQUFX9bavvGazXvMSlr9n8yUQ6JgDbN2RQ7sNI
M0ZhF/wwvT0UVEPYgdXMdxdf6SQ1aNrUg7866nJQBRWiod0J6OBNHZXKLXHjOOzt6Rcarnb/F0xxZB
APpwfoyjuuyrpOJ8h1vJ35Nc9c6ykVjUvWk4tjjolHLqwVNuiN4rrWIY=
```

**Passo 2 — Adicionar no `.env`**

```bash
CIRCLE_ENTITY_SECRET=<REDACTED_ROTATE_BEFORE_USE>
```

**Passo 3 — Criar a wallet do agente**

```bash
# Após configurar o entity secret no console:
python3 scripts/setup_circle_wallet.py
# Copie o CIRCLE_WALLET_ID retornado para o .env
```

**Passo 4 — Ativar modo real**

```bash
# .env
ARC_SANDBOX=false
```

**Passo 5 — Fondar a wallet na Sepolia testnet**

Acesse o Circle Faucet ou use o painel do console para transferir USDC de teste para a wallet criada.

**Passo 6 — Testar pagamento real**

```bash
curl -X POST http://localhost:8000/v1/agent/run-campaign \
  -H "Content-Type: application/json" \
  -d '{"campaign_id": 1, "budget_usdc": 25.0, "reward_per_creator": 5.0}'
# Verificar tx hash real no Sepolia Etherscan
```

---

## 🟡 O que falta além das variáveis Circle

### Traction 30% — dashboard visual
- Adicionar métricas Prometheus: `usdc_paid_total`, `payments_count`, `agent_steps_total`
- Criar dashboard Grafana mostrando USDC saindo em tempo real (o "Wow" do júri)

### Innovation 20% — PQC
- Recibo pós-quântico ML-DSA: assinar cada `PaymentIntent` confirmado com ML-DSA-87
- Escopo pequeno: 1 arquivo `backend/services/pqc_receipt.py` + campo `receipt_pqc` no modelo

### D6/D7 — Submissão
- Vídeo demo ≤ 3min: campanha → run agent → 3 pagamentos USDC → summary table
- README público com arquitetura L0–L4 e badge de testes

---

## Scorecard atual

| Critério | Peso | Status | Nota estimada |
|---|---|---|---|
| Agentic | 30% | ✅ Loop completo, E2E ok | ~25/30 |
| Traction | 30% | 🔴 Bloqueado — Circle vars | ~0/30 |
| Circle Tools | 20% | 🔴 Bloqueado — ARC_SANDBOX=true | ~5/20 |
| Innovation | 20% | ❌ PQC não implementado | ~0/20 |
| **Total** | | | **~30/100** |

**Com Circle desbloqueado + PQC + dashboard: ~80/100**

---

## Comandos rápidos

```bash
make dev              # backend :8000 + frontend :3000
make test-backend     # 91/91 testes
make run-docker       # PostgreSQL + Redis + Grafana
```
