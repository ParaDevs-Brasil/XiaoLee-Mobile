// Catálogo de serviços pagos. Serviço novo = uma entrada aqui (rota, OpenAPI e proxy saem daí)
// + a rota interna correspondente no FastAPI (/internal/x402/<upstream>).
export const catalog = [
  {
    id: "profile-analysis", price: "$0.05", upstream: "profile-analysis",
    summary: "Análise de prontidão de crescimento de um criador",
    schema: {
      type: "object", required: ["handle", "niche"],
      properties: {
        handle: { type: "string", minLength: 1, maxLength: 64 }, niche: { type: "string", minLength: 1, maxLength: 64 },
        platforms: { type: "array", items: { type: "string" }, maxItems: 8 },
        followers: { type: "integer", minimum: 0, maximum: 1000000000 }, posts_per_week: { type: "number", minimum: 0, maximum: 100 } },
    },
  },
  {
    id: "campaign-plan", price: "$0.10", upstream: "campaign-plan",
    summary: "Plano de campanha para criadores: divisão de orçamento, tarefas por plataforma e regra de pagamento",
    schema: {
      type: "object", required: ["goal", "budget_usdc"],
      properties: {
        goal: { type: "string", minLength: 1, maxLength: 200 }, budget_usdc: { type: "number", exclusiveMinimum: 0, maximum: 1000000 },
        platforms: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
        duration_days: { type: "integer", minimum: 1, maximum: 90 }, niche: { type: "string", maxLength: 64 } },
    },
  },
  {
    id: "task-verification", price: "$0.03", upstream: "task-verification",
    summary: "Verifica se um post enviado cumpre os requisitos de uma tarefa de campanha (hashtags, menções, palavras-chave, autor); devolve veredito por critério e se o pagamento ao criador deve ser liberado",
    schema: {
      type: "object", required: ["platform", "post_url", "post_text", "handle"],
      properties: {
        platform: { type: "string", enum: ["x", "tiktok", "instagram", "youtube", "telegram"] },
        post_url: { type: "string", minLength: 1, maxLength: 300 },
        post_text: { type: "string", minLength: 1, maxLength: 2000 },
        handle: { type: "string", minLength: 1, maxLength: 64 },
        required_hashtags: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 10 },
        required_mentions: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 10 },
        required_keywords: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 10 },
        min_chars: { type: "integer", minimum: 0, maximum: 2000 } },
    },
  },
];
