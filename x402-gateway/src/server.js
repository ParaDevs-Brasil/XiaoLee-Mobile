import { createApp } from "./app.js";

const env = process.env;
const need = (k) => { if (!env[k]) throw new Error(`missing env ${k}`); return env[k]; };

const cfg = {
  sellerAddress: need("X402_SELLER_ADDRESS"),
  facilitatorUrl: env.X402_FACILITATOR_URL ?? "https://gateway-api.circle.com",
  networks: (env.X402_NETWORKS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  publicUrl: env.PUBLIC_URL ?? "http://localhost:3100",
  price: env.X402_PRICE ?? "$0.05",
  upstreamUrl: need("UPSTREAM_URL"),
  internalSecret: need("X402_INTERNAL_SECRET"),
  upstreamTimeoutMs: Number(env.UPSTREAM_TIMEOUT_MS ?? 30000),
};

createApp(cfg).listen(Number(env.PORT ?? 3100), () => console.log("x402-gateway up"));
