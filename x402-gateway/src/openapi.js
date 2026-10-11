import { catalog } from "./catalog.js";

// OpenAPI exigido pelo "Get listed" do Agent Marketplace, gerado do catálogo (em inglês: o revisor é da Circle).
const receipt = { type: "object", description: "Payment-and-delivery proof, signed with ML-DSA-87", properties: {
  intent_id: { type: "string" }, payer: { type: "string" }, amount_usdc: { type: "number" },
  network: { type: "string", examples: ["eip155:5042"] }, payment_tx: { type: "string", description: "Circle Gateway settlement id" },
  receipt_pqc: { type: "string", description: "base64(signature).base64(canonical payload)" } } };
const out = (result) => ({ type: "object", properties: { result, receipt } });
const results = {
  "clip-highlights": out({ type: "object", properties: {
    clips: { type: "array", items: { type: "object", properties: {
      start: { type: "number" }, end: { type: "number" }, duration_s: { type: "number" },
      title: { type: "string" }, reason: { type: "string" }, hook: { type: "string" } } } },
    source: { type: "string", enum: ["llm", "heuristic"] }, model: { type: ["string", "null"] },
    language: { type: ["string", "null"] }, segments_used: { type: "integer" }, note: { type: ["string", "null"] } } }),
  "campaign-plan": out({ type: "object", properties: {
    goal: { type: "string" }, duration_days: { type: "integer" },
    budget_split: { type: "object", properties: { rewards_usdc: { type: "number" }, ops_reserve_usdc: { type: "number" } } },
    platforms: { type: "array", items: { type: "object" } }, creator_payout_rule: { type: "string" },
    success_metrics: { type: "array", items: { type: "string" } }, ai_insights: { type: "object" } } }),
};
export const openapi = (cfg) => ({
  openapi: "3.1.0",
  info: { title: "XiaoLee Creator Services", version: "0.3.0",
    description: "AI services for content creators, paid per call in USDC with x402 v2 on Arc through Circle Gateway (Nanopayments). " +
      "Every call returns the result plus a receipt (ML-DSA-87) binding payer, amount and settlement id." },
  servers: [{ url: cfg.publicUrl }],
  paths: Object.fromEntries(catalog.map((s) => [`/v1/x402/${s.id}`, { post: {
    operationId: s.id.replace(/-/g, "_"),
    summary: s.summary,
    description: `Price: ${s.price} USDC per call. Without payment the endpoint answers 402 with a base64 PAYMENT-REQUIRED header (x402 v2, scheme exact, GatewayWalletBatched). ` +
      "Invalid input is rejected with 400 before any charge.",
    "x-x402": { price_usdc: Number(s.price.replace("$", "")), networks: cfg.networks, payTo: cfg.sellerAddress, facilitator: cfg.facilitatorUrl },
    requestBody: { required: true, content: { "application/json": { schema: s.schema } } },
    responses: {
      "200": { description: "Result and payment-and-delivery receipt", content: { "application/json": { schema: results[s.id] ?? out({ type: "object" }) } } },
      "400": { description: "Invalid input; nothing was charged" },
      "402": { description: "Payment required (PAYMENT-REQUIRED header, base64 JSON)" } } } }])),
});
