// Smoke mainnet: UMA compra real na Arc Mainnet, com teto. Chave em BUYER_PRIVATE_KEY (nunca impressa).
//   node scripts/smoke-mainnet.js <url> [GET|POST] [json-body] [teto-em-unidades-USDC=500]
// 6 casas: 100 = $0.0001, 500 = $0.0005. Aborta se o preço exigido passar do teto.
import { GatewayClient } from "@circle-fin/x402-batching/client";

const [url, method = "GET", rawBody, cap = "500"] = process.argv.slice(2);
if (!url) { console.error("uso: node scripts/smoke-mainnet.js <url> [GET|POST] [json-body] [teto]"); process.exit(1); }

// O batching debita o saldo Gateway da rede em que se paga: X402_CHAIN deve ser onde o USDC foi depositado (base | arc).
const chain = process.env.X402_CHAIN ?? "arc";
const client = new GatewayClient({ chain, privateKey: process.env.BUYER_PRIVATE_KEY, ...(chain === "arc" ? { rpcUrl: process.env.ARC_RPC ?? "https://rpc.mainnet.arc.io" } : {}) });
client.onBeforePaymentCreation(async (ctx) => {
  const { amount, network, payTo } = ctx.selectedRequirements;
  console.log(`pedido: ${amount} un. (${Number(amount) / 1e6} USDC) rede=${network} payTo=${payTo}`);
  if (BigInt(amount) > BigInt(cap)) return { abort: true, reason: `acima do teto ${cap}` };
});
const show = (b) => JSON.stringify(b, (_, v) => (typeof v === "bigint" ? v.toString() : v));
console.log("saldos antes:", show(await client.getBalances()));
const r = await client.pay(url, { method, ...(rawBody ? { body: JSON.parse(rawBody) } : {}) });
console.log("status:", r.status, "| pago:", r.formattedAmount ?? r.amount, "| tx:", r.transaction);
console.log(String(typeof r.data === "string" ? r.data : show(r.data)).slice(0, 600));
console.log("saldos depois:", show(await client.getBalances()));
