// Compra de teste: node scripts/buy.js [clip-highlights|campaign-plan] [base-url]. Chave do COMPRADOR em BUYER_PRIVATE_KEY (carteira com USDC de teste).
import { GatewayClient } from "@circle-fin/x402-batching/client";

const svc = process.argv[2] ?? "clip-highlights";
const base = process.argv[3] ?? "http://localhost:3100";
const url = `${base}/v1/x402/${svc}`;
const bodies = {
  "clip-highlights": { language: "pt", max_clips: 2, transcript: Array.from({ length: 14 }, (_, i) => ({ start: i * 9, end: i * 9 + 9, text: i % 5 === 0 ? "Sabe qual o maior erro de quem começa? É ignorar a retenção." : `Parte ${i}: explicando como testar um gancho nos primeiros segundos do vídeo.` })) },
  "campaign-plan": { goal: "lançar token X", budget_usdc: 500, platforms: ["tiktok", "x"], duration_days: 7 },
};
// SDK 3.5.0 usa rpc.testnet.arc.network por padrão (bloqueado em alguns IPs); domínio atual é arc.io
const client = new GatewayClient({ chain: "arcTestnet", privateKey: process.env.BUYER_PRIVATE_KEY, rpcUrl: process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.io" });
client.onBeforePaymentCreation(async (ctx) => {
  if (BigInt(ctx.selectedRequirements.amount) > 100_000n) return { abort: true, reason: "acima do limite de teste ($0.10)" };
});
console.log("saldos:", JSON.stringify(await client.getBalances(), (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const r = await client.pay(url, { method: "POST", body: bodies[svc] });
console.log(JSON.stringify(r.data, null, 2));
