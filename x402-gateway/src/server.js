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
  upstreamTimeoutMs: Number(env.UPSTREAM_TIMEOUT_MS ?? 30000),
};

// Comprador só liga se houver chave. Rede por X402_CHAIN (arcTestnet | arc).
const buyer = env.BUYER_PRIVATE_KEY ? createBuyer(
  { maxPerCallUsdc: Number(env.BUYER_MAX_PER_CALL_USDC ?? 0.1), dailyCapUsdc: Number(env.BUYER_DAILY_CAP_USDC ?? 1) },
  { makeClient: () => new GatewayClient({ chain: env.X402_CHAIN ?? "arcTestnet", privateKey: env.BUYER_PRIVATE_KEY, rpcUrl: env.ARC_RPC }) },
) : null;

createApp(cfg, buyer).listen(Number(env.PORT ?? 3100), () => console.log("x402-gateway up"));
