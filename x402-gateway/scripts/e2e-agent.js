// E2E do agente comprador, com o MESMO código do servidor (src/buyer.js) e a mesma configuração:
//   busca (Discovery + catálogo próprio) -> cotação (confirmation_required) -> confirmação do usuário -> compra paga.
//   BUYER_PRIVATE_KEY=0x... X402_CHAIN=arc node scripts/e2e-agent.js <base-url> <service-id> '<json-body>' [query]
// Gasta o preço do serviço escolhido (teto 0.10). Nunca imprime a chave.
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createBuyer } from "../src/buyer.js";
import { catalog } from "../src/catalog.js";

const [base, service, rawBody, q = service] = process.argv.slice(2);
if (!base || !service || !rawBody) { console.error("uso: node scripts/e2e-agent.js <base-url> <service-id> '<json-body>' [query]"); process.exit(1); }
const chain = process.env.X402_CHAIN ?? "arc";
const own = catalog.map((svc) => ({ resource: `${base.replace(/\/$/, "")}/v1/x402/${svc.id}`, method: "POST",
  price_usdc: Number(svc.price.replace("$", "")), provider: "XiaoLee", description: svc.summary }));

const buyer = createBuyer(
  { maxPerCallUsdc: 0.1, dailyCapUsdc: 0.2, userDailyCapUsdc: 0.1, allowedPayTo: [], autoApproveUsdc: 0,
    network: chain === "arc" ? "eip155:5042" : "eip155:5042002" },
  { makeClient: () => new GatewayClient({ chain, privateKey: process.env.BUYER_PRIVATE_KEY, ...(chain === "arc" ? { rpcUrl: "https://rpc.mainnet.arc.io" } : {}) }), extra: own },
);
const userId = "e2e-user";
const step = (n, t) => console.log(`\n[${n}] ${t}`);

step(1, `busca "${q}" (Discovery da Circle + catálogo próprio)`);
const t0 = Date.now();
const found = await buyer.search({ q, limit: 5 });
console.log(`   ${found.length} resultado(s) em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const f of found) console.log(`   - ${f.price_usdc} USDC ${f.method} ${f.resource} (${f.provider})`);
const target = found.find((f) => f.resource.endsWith(`/v1/x402/${service}`));
if (!target) { console.log("   serviço não apareceu na busca"); process.exit(1); }

const body = JSON.parse(rawBody);
step(2, "pedido de compra (o agente não tem autorização própria)");
const quote = await buyer.buy({ url: target.resource, method: "POST", body, userId });
console.log("   resposta:", quote.error, quote.quote ? `| ${quote.quote.price_usdc} USDC -> ${quote.quote.pay_to}` : "");
if (quote.error !== "confirmation_required") { console.log(JSON.stringify(quote).slice(0, 300)); process.exit(1); }

step(3, "confirmação do usuário (ação fora do loop do modelo)");
const wrong = buyer.confirm({ confirmId: quote.confirm_id, userId: "outro-usuario" });
console.log("   outro usuário tenta aprovar:", wrong.error ?? "APROVOU (falha!)");
console.log("   usuário dono aprova:", JSON.stringify(buyer.confirm({ confirmId: quote.confirm_id, userId })));

step(4, "compra paga");
const r = await buyer.buy({ url: target.resource, method: "POST", body, userId, confirmId: quote.confirm_id });
if (r.error) { console.log("   erro:", r.error, r.message); process.exit(1); }
const d = r.data;
console.log(`   status ${r.status} | pago ${r.paid_usdc} USDC | settlement ${r.payment_tx}`);
const res = d.result ?? {};
if (res.clips) {
  console.log(`   source=${res.source} model=${res.model} segmentos=${res.segments_used}`);
  for (const c of res.clips) console.log(`   - ${c.start}-${c.end}s (${c.duration_s}s) ${c.title}`);
} else console.log("   resultado:", JSON.stringify(res).slice(0, 300));
if (d.receipt) console.log(`   recibo: intent=${d.receipt.intent_id} rede=${d.receipt.network} valor=${d.receipt.amount_usdc} pqc=${d.receipt.receipt_pqc ? "sim" : "NAO"}`);

step(5, "reuso da confirmação (deve falhar)");
const again = await buyer.buy({ url: target.resource, method: "POST", body, userId, confirmId: quote.confirm_id });
console.log("   segunda compra com a mesma confirmação:", again.error ?? "PAGOU DE NOVO (falha!)");
console.log(`\ngasto no dia (buyer): ${buyer.spentToday()} USDC`);
process.exit(0);
