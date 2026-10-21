# On/Off-ramp da XiaoLee — desenho (rascunho 2026-10-21)

Objetivo: o usuário coloca dinheiro na carteira XiaoLee (Pix, cartão, Apple/Google Pay) e tira de volta
(Pix, conta, cartão, ou USDC em outra rede), com KYC/KYB e proteção da operação.

## 1. Postura regulatória (princípio central)

**A XiaoLee não toca em fiat nem faz custódia de fiat.** Cada ponta fiat é feita por um provedor
licenciado, que faz o KYC do usuário e liquida o dinheiro. A XiaoLee orquestra, registra e limita.

- Depósito: provedor cobra o fiat e entrega USDC direto no endereço da carteira do usuário.
- Saque para fiat: o usuário envia USDC ao provedor (ou a um endereço de depósito dele) e o provedor paga o fiat.
- Saque para outra rede: USDC sai da Arc via CCTP (ver §5).

Se algum dia a XiaoLee passar a receber fiat ou a converter por conta própria, vira atividade regulada
(Brasil: regime de prestadoras de serviços de ativos virtuais do BCB; verificar com advogado).
**Também não custodiamos USDC do usuário** (ver §5): ele assina com a própria carteira.
**Fora do escopo do código: parecer jurídico sobre enquadramento.** Este documento não é parecer.

## 2. Camadas de identidade (tiers)

| Tier | Quem | Pode | Quem verifica |
|---|---|---|---|
| 0 | Login Privy | usar o app, receber USDC | Privy |
| 1 | KYC básico do provedor | depositar com cartão/Pix até o teto do provedor | provedor (MoonPay/Transak/Circle widget) |
| 2 | KYC completo do provedor | tetos maiores, saque para Pix/conta | provedor |
| B | KYB (criadores e marcas com CNPJ) | campanhas grandes, saque PJ | provedor + dados de CNPJ guardados por nós |

Regra: **a XiaoLee não coleta documentos de identidade.** Guarda só o resultado: `kyc_status`,
`kyc_level`, `provider`, `provider_customer_id`, `verified_at`. Menos dado sensível, menos risco de vazamento (LGPD).

KYB nosso (empresa XiaoLee) é exigido pelos provedores para abrir conta de parceiro: CNPJ, contrato social,
sócios/beneficiários finais, descrição do negócio. É pré-requisito comercial, não código.

## 3. Proteções da operação

- **Gate de KYC:** saque para fiat só com `kyc_level >= 2` do provedor que vai pagar.
- **Tetos:** por transação, diário, mensal e por tier. Configuráveis por env, com padrão baixo.
- **Kill switch:** `ONOFF_ENABLED` e por direção (`ONOFF_DEPOSIT_ENABLED`, `ONOFF_WITHDRAW_ENABLED`).
- **Allowlist no início:** só carteiras/usuários listados enquanto estamos em piloto.
- **Cooldown pós-depósito:** saque de valor alto só depois de N horas do depósito (anti-lavagem/fraude de cartão com chargeback).
- **Valor conferido:** o webhook do provedor traz o valor movido; se diferir do intent (tolerância de 1% ou 1 centavo)
  ou vier sem valor, o intent vai para `review` e não anda sozinho. Continua contando no teto.
- **Teto global** da operação por dia e por direção, além dos tetos por usuário. Pedidos simultâneos do mesmo
  usuário são serializados (`SELECT ... FOR UPDATE`) para não furar o teto.
- **Expiração:** sessões e intents sem desfecho expiram (30 min por padrão); eventos tardios não os ressuscitam.
- **Idempotência:** toda operação nasce com `intent_id` (UUID) gravado antes de qualquer chamada externa.
- **Webhooks assinados:** verificar assinatura do provedor, rejeitar replay (guardar `event_id`).
- **Auditoria append-only:** toda mudança de estado vira uma linha em `onoff_events`; nunca atualizar nem apagar.
- **Sanções/PEP:** feito pelo provedor; registrar o resultado. Não manter lista própria.
- **Chargeback:** risco do provedor de cartão; nosso cooldown e tetos limitam exposição.
- **Travel rule / reporte:** a cargo do provedor licenciado; confirmar contratualmente.

## 4. Máquina de estados

```
created -> kyc_required -> pending_provider -> funds_received -> settled
                    \-> rejected / expired / failed
deposit : pending_provider -> funds_received -> settled
withdraw: pending_provider -> sent_to_provider -> paid_out     (failed -> refunded)
qualquer etapa com dinheiro andando e valor divergente -> review (análise humana)
```

Estados terminais: `settled` (depósito), `paid_out` (saque), `rejected`, `expired`, `refunded`.
Transições só avançam; qualquer outra é recusada e logada.

## 5. Saque para outra rede (sem custódia nossa)

O USDC do usuário **nunca passa por uma carteira da XiaoLee**. Custodiar cripto de terceiros, mesmo por minutos,
também pode ser atividade regulada; por isso o desenho anterior (usuário assina para a tesouraria, nós enviamos
por CCTP) foi descartado.

Fluxo: o app monta a transação e a **carteira do próprio usuário** (Privy) assina e envia:
- mesma rede (Arc -> endereço na Arc): transferência normal de USDC, ou o relay EIP-3009 já existente
  (o relay só paga o gás; o destino é o que o usuário assinou);
- outra rede (ex.: Arc -> Base): o usuário assina o `depositForBurn` do CCTP direto na Arc; o app acompanha a
  attestation e o mint no destino. Quem paga o gás no destino e como (Forwarding Service da Circle ou claim pelo
  usuário) **precisa ser verificado na doc oficial antes de implementar**.

O backend só **registra o intent e acompanha o status** (hash da burn, attestation, hash do mint) e aplica os tetos.
Ele não segura chave, não assina e não move fundos do usuário.

## 6. Abstração de provedor

Uma interface pequena, uma implementação por provedor, escolhida por config. Nada de if por provedor no resto do código.

```
class RampProvider(Protocol):
    name: str
    async def create_deposit_session(user, amount, currency, method) -> Session   # url do widget
    async def create_withdraw_session(user, amount, currency, method) -> Session
    def verify_webhook(headers, body) -> ProviderEvent                              # levanta se assinatura inválida
```

Implementações previstas: `circle_onramp` (cartão/carteiras na Arc), `moonpay` (Pix no depósito),
`pix_offramp` (a definir: Bridge/Conduit/SpherePay/operador BR). Todas atrás de flag até KYB.

## 7. Modelo de dados (migração nova)

- `onoff_intents`: id (uuid), user_id, direction (deposit|withdraw), method, provider, fiat_amount, fiat_currency,
  usdc_amount, status, provider_ref, onchain_tx, created_at, updated_at, expires_at.
- `onoff_events`: id, intent_id, from_status, to_status, payload_hash, actor (system|webhook|user), created_at. Append-only.
- `onoff_kyc`: user_id, provider, level, status, provider_customer_id, verified_at. Sem documentos.

## 8. API (backend)

- `GET  /v1/onoff/config`  → o que está ligado, tetos, métodos por país.
- `POST /v1/onoff/deposit` → cria intent + sessão do provedor, devolve a URL do widget.
- `POST /v1/onoff/withdraw` → valida KYC/tetos/cooldown, cria intent, devolve instruções.
- `GET  /v1/onoff/intents` e `/{id}` → histórico e status.
- `POST /v1/onoff/webhooks/{provider}` → único ponto que muda estado vindo de fora.

## 9. App (mobile)

Duas sheets na carteira: **Add money** e **Withdraw**. Widget do provedor em WebView. Estado do intent
na tela, com linguagem clara sobre prazo, taxa e limite antes de confirmar. Opções indisponíveis
aparecem como "em breve", não somem.

## 10. Fases

1. Backend base: modelos, máquina de estados, tetos, kill switches, webhooks assinados, testes. (sem provedor)
2. Saque para outra rede **assinado pela carteira do usuário** (sem tesouraria), com acompanhamento do CCTP. (sem KYB)
3. Provedor de depósito (Circle Onramp ou MoonPay) em sandbox -> produção após KYB.
4. Provedor de saque Pix/conta.
5. Revisão de segurança e jurídica antes de abrir para todos.

## 11. Em aberto (decisão do dono)

- CNPJ da XiaoLee e KYB nos provedores.
- Parecer jurídico sobre enquadramento (BCB).
- Provedor de saque Pix.
- Tetos iniciais de piloto.
- Países suportados na primeira versão.

## 12. O que NÃO está provado (atualizar a cada fase)

- Nenhum provedor real integrado; só o provedor de teste (`sandbox`) com webhook assinado.
- Testes rodam em SQLite; o `FOR UPDATE` dos tetos só tem efeito em Postgres e ainda não foi exercitado lá.
- Não há trilha de IP/dispositivo do pedido, nem alerta automático para webhook fora de ordem ou `review`.
- Parecer jurídico, KYB da XiaoLee e contratos com provedores: pendentes (fora do código).
