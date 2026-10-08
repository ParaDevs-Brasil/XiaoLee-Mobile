// OpenAPI exigido pelo "Get listed" do Agent Marketplace. Preço reflete cfg.price.
export const openapi = (cfg) => ({
  openapi: "3.0.3",
  info: { title: "XiaoLee Creator Services", version: "0.1.0",
    description: "Serviços de IA para criadores, pagos por chamada via x402 (Circle Gateway, USDC)." },
  servers: [{ url: cfg.publicUrl }],
  paths: { "/v1/x402/profile-analysis": { post: {
    summary: "Análise de prontidão de crescimento de um criador",
    description: `Preço: ${cfg.price} USDC por chamada. Responde 402 com PAYMENT-REQUIRED (x402 v2) sem pagamento.`,
    requestBody: { required: true, content: { "application/json": { schema: {
      type: "object", required: ["handle", "niche"],
      properties: {
        handle: { type: "string", maxLength: 64 }, niche: { type: "string", maxLength: 64 },
        platforms: { type: "array", items: { type: "string" }, maxItems: 8 },
        followers: { type: "integer", minimum: 0 }, posts_per_week: { type: "number", minimum: 0, maximum: 100 } } } } } },
    responses: {
      "200": { description: "Análise + recibo PQC (prova de pagamento e entrega)" },
      "402": { description: "Pagamento exigido (header PAYMENT-REQUIRED, base64)" } } } } },
});
