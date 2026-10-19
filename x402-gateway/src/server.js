import { createApp } from "./app.js";
import { createBuyer } from "./buyer.js";
import { createLedger } from "./ledger.js";
import { catalog } from "./catalog.js";
import { GatewayClient } from "@circle-fin/x402-batching/client";

const env = process.env;
const need = (k) => { if (!env[k]) throw new Error(`missing env ${k}`); return env[k]; };

const cfg = {
  sellerAddress: need("X402_SELLER_ADDRESS"),
  facilitatorUrl: env.X402_FACILITATOR_URL ?? "https://gateway-api.circle.com",
  networks: (env.X402_NETWORKS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  publicUrl: env.PUBLIC_URL ?? "http://localhost:3100",
  // compat: UPSTREAM_URL antigo (aponta p/ uma rota) vira a base
  upstreamBase: (env.UPSTREAM_BASE_URL ?? need("UPSTREAM_URL").replace(/\/[^/]+$/, "")).replace(/\/$/, ""),
  internalSecret: need("X402_INTERNAL_SECRET"),
  paused: env.X402_PAUSED === "true",
  rateLimitPerMin: Number(env.X402_RATE_LIMIT_PER_MIN ?? 30),
  upstreamTimeoutMs: Number(env.UPSTREAM_TIMEOUT_MS ?? 30000),
};

// Comprador só liga se houver chave. Rede por X402_CHAIN (arcTestnet | arc).
const list = (v) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const ownCatalog = env.BUYER_INCLUDE_OWN_CATALOG === "true";
const buyer = env.BUYER_PRIVATE_KEY ? createBuyer(
  { maxPerCallUsdc: Number(env.BUYER_MAX_PER_CALL_USDC ?? 0.1), dailyCapUsdc: Number(env.BUYER_DAILY_CAP_USDC ?? 1),
    userDailyCapUsdc: Number(env.BUYER_USER_DAILY_CAP_USDC ?? 0.25),
    // vazio = todo gasto pede confirmação do usuário; só vendedor da allowlist e preço <= autoApprove compra direto
    allowedPayTo: [...list(env.BUYER_ALLOWED_PAYTO), ...(ownCatalog ? [cfg.sellerAddress] : [])],
    autoApproveUsdc: Number(env.BUYER_AUTO_APPROVE_USDC ?? 0),
    network: (env.X402_CHAIN ?? "arcTestnet") === "arc" ? "eip155:5042" : "eip155:5042002" },
  { makeClient: () => new GatewayClient({ chain: env.X402_CHAIN ?? "arcTestnet", privateKey: env.BUYER_PRIVATE_KEY, rpcUrl: env.ARC_RPC }),
    extra: ownCatalog ? catalog.map((svc) => ({
      resource: `${cfg.publicUrl.replace(/\/$/, "")}/v1/x402/${svc.id}`, method: "POST",
      price_usdc: Number(svc.price.replace("$", "")), provider: "XiaoLee", description: svc.summary })) : [] },
) : null;

// Mainnet (facilitador sem "testnet") exige ledger durável: dinheiro real não pode depender de memória.
const mainnet = !/testnet/i.test(cfg.facilitatorUrl);
if (mainnet && !env.DATABASE_URL && env.X402_ALLOW_MEMORY_LEDGER !== "true") {
  throw new Error("mainnet requires DATABASE_URL for the settlement ledger (or X402_ALLOW_MEMORY_LEDGER=true to override)");
}
const ledger = await createLedger(env.DATABASE_URL);

buyer?.warm();
const srv = createApp(cfg, buyer, ledger).listen(Number(env.PORT ?? 3100), () => console.log("x402-gateway up"));
// Deploy envia SIGTERM: termina os pedidos em andamento (já pagos) antes de sair.
process.on("SIGTERM", () => {
  srv.close(() => ledger.close().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), Number(env.SHUTDOWN_GRACE_MS ?? 25000)).unref();
});
