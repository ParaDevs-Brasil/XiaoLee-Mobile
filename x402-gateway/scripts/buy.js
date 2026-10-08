// Compra de teste: node scripts/buy.js [url]. Chave do COMPRADOR em BUYER_PRIVATE_KEY (carteira com USDC de teste).
import { GatewayClient } from "@circle-fin/x402-batching/client";

const url = process.argv[2] ?? "http://localhost:3100/v1/x402/profile-analysis";
// SDK 3.5.0 usa rpc.testnet.arc.network por padrão (bloqueado em alguns IPs); domínio atual é arc.io
const client = new GatewayClient({ chain: "arcTestnet", privateKey: process.env.BUYER_PRIVATE_KEY, rpcUrl: process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.io" });
client.onBeforePaymentCreation(async (ctx) => {
  if (BigInt(ctx.selectedRequirements.amount) > 100_000n) return { abort: true, reason: "acima do limite de teste ($0.10)" };
});
console.log("saldos:", JSON.stringify(await client.getBalances(), (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const r = await client.pay(url, { method: "POST", body: { handle: "@fontz", niche: "defi", platforms: ["tiktok"], followers: 12000, posts_per_week: 2 } });
console.log(JSON.stringify(r.data, null, 2));
