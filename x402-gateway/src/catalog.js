// Catálogo de serviços pagos. Serviço novo = uma entrada aqui (rota, OpenAPI e proxy saem daí)
// + a rota interna correspondente no FastAPI (/internal/x402/<upstream>).
export const catalog = [
  {
    id: "profile-analysis", price: "$0.05", upstream: "profile-analysis",
    summary: "Análise de prontidão de crescimento de um criador",
    schema: {
      type: "object", required: ["handle", "niche"],
      properties: {
        handle: { type: "string", maxLength: 64 }, niche: { type: "string", maxLength: 64 },
        platforms: { type: "array", items: { type: "string" }, maxItems: 8 },
        followers: { type: "integer", minimum: 0 }, posts_per_week: { type: "number", minimum: 0, maximum: 100 } },
    },
  },
  {
    id: "campaign-plan", price: "$0.10", upstream: "campaign-plan",
    summary: "Plano de campanha para criadores: divisão de orçamento, tarefas por plataforma e regra de pagamento",
    schema: {
      type: "object", required: ["goal", "budget_usdc"],
      properties: {
        goal: { type: "string", maxLength: 200 }, budget_usdc: { type: "number", exclusiveMinimum: 0, maximum: 1000000 },
        platforms: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
        duration_days: { type: "integer", minimum: 1, maximum: 90 }, niche: { type: "string", maxLength: 64 } },
    },
  },
];
