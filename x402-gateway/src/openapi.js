import { catalog } from "./catalog.js";

// OpenAPI exigido pelo "Get listed" do Agent Marketplace, gerado do catálogo.
export const openapi = (cfg) => ({
  openapi: "3.1.0",
  info: { title: "XiaoLee Creator Services", version: "0.3.0",
    description: "Serviços de IA para criadores, pagos por chamada via x402 (Circle Gateway, USDC)." },
  servers: [{ url: cfg.publicUrl }],
  paths: Object.fromEntries(catalog.map((s) => [`/v1/x402/${s.id}`, { post: {
    summary: s.summary,
    description: `Preço: ${s.price} USDC por chamada. Responde 402 com PAYMENT-REQUIRED (x402 v2) sem pagamento.`,
    requestBody: { required: true, content: { "application/json": { schema: s.schema } } },
    responses: {
      "200": { description: "Resultado + recibo PQC (prova de pagamento e entrega)" },
      "402": { description: "Pagamento exigido (header PAYMENT-REQUIRED, base64)" } } } }])),
});
