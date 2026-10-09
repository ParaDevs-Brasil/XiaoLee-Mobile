import { createApp } from "./app.js";
import { createBuyer } from "./buyer.js";
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
const buyer = env.BUYER_PRIVATE_KEY ? createBuyer(
  { maxPerCallUsdc: Number(env.BUYER_MAX_PER_CALL_USDC ?? 0.1), dailyCapUsdc: Number(env.BUYER_DAILY_CAP_USDC ?? 1),
    network: (env.X402_CHAIN ?? "arcTestnet") === "arc" ? "eip155:5042" : "eip155:5042002" },
  { makeClient: () => new GatewayClient({ chain: env.X402_CHAIN ?? "arcTestnet", privateKey: env.BUYER_PRIVATE_KEY, rpcUrl: env.ARC_RPC }) },
) : null;

buyer?.warm();
const srv = createApp(cfg, buyer).listen(Number(env.PORT ?? 3100), () => console.log("x402-gateway up"));
// Deploy envia SIGTERM: termina os pedidos em andamento (já pagos) antes de sair.
process.on("SIGTERM", () => {
  srv.close(() => process.exit(0));
  setTimeout(() => process.exit(0), Number(env.SHUTDOWN_GRACE_MS ?? 25000)).unref();
});
