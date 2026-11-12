// Catálogo de serviços pagos. Serviço novo = uma entrada aqui (rota, OpenAPI e proxy saem daí)
// + a rota interna correspondente no FastAPI (/internal/x402/<upstream>).
export const catalog = [
  {
    id: "clip-highlights", price: "$0.05", upstream: "clip-highlights",
    summary: "Finds the best moments of a long video from its transcript: 20-75 s clip windows with title, reason and hook, ready for Shorts, Reels and TikTok",
    schema: {
      type: "object", required: ["transcript"],
      properties: {
        transcript: {
          type: "array", minItems: 3, maxItems: 200,
          items: {
            type: "object", required: ["start", "end", "text"],
            properties: {
              start: { type: "number", minimum: 0, maximum: 86400 }, end: { type: "number", minimum: 0, maximum: 86400 },
              text: { type: "string", minLength: 1, maxLength: 200 } },
          },
        },
        language: { type: "string", maxLength: 32 }, max_clips: { type: "integer", minimum: 1, maximum: 5 } },
    },
  },
  {
    id: "campaign-plan", price: "$0.10", upstream: "campaign-plan",
    summary: "Creator campaign plan: budget split, tasks per platform and the payout rule",
    schema: {
      type: "object", required: ["goal", "budget_usdc"],
      properties: {
        goal: { type: "string", minLength: 1, maxLength: 200 }, budget_usdc: { type: "number", exclusiveMinimum: 0, maximum: 1000000 },
        platforms: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
        duration_days: { type: "integer", minimum: 1, maximum: 90 }, niche: { type: "string", maxLength: 64 } },
    },
  },
];
