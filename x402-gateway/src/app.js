import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { openapi } from "./openapi.js";
import { catalog } from "./catalog.js";
import { timingSafeEqual } from "node:crypto";
import { deliver, validate, failures } from "./delivery.js";
import { createLimiter, guardMiddleware } from "./guard.js";

// Gateway x402 (Circle) na frente do FastAPI. O pagamento é liquidado ANTES do handler;
// o upstream só é chamado com o segredo interno + dados do pagador (anti-bypass no FastAPI).
export function createApp(cfg, buyer = null) {
  const app = express();
  app.set("trust proxy", 1); // Railway: IP real do cliente
  const state = { paused: Boolean(cfg.paused) };
  const guard = guardMiddleware(state, createLimiter({ max: cfg.rateLimitPerMin ?? 30, windowMs: 60_000 }));
  app.use(express.json({ limit: "64kb" }));

  const gateway = createGatewayMiddleware({
    sellerAddress: cfg.sellerAddress,
    facilitatorUrl: cfg.facilitatorUrl,
    ...(cfg.networks.length ? { networks: cfg.networks } : {}),
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/openapi.json", (_req, res) => res.json(openapi(cfg)));

  // Comprador interno (só o FastAPI chama, com o segredo compartilhado)
  const auth = (req, res, next) => {
    const a = Buffer.from(String(req.get("x-internal-secret") ?? "")), b = Buffer.from(cfg.internalSecret ?? "");
    if (!b.length || a.length !== b.length || !timingSafeEqual(a, b)) return res.status(403).json({ error: "forbidden" });
    next();
  };
  const internal = [(req, res, next) => (buyer ? next() : res.status(503).json({ error: "buyer_disabled" })), auth];
  // botão de desligar em runtime (rotas pagas devolvem 503 sem cobrar)
  app.post("/internal/pause", auth, (req, res) => { state.paused = req.body?.paused !== false; res.json({ paused: state.paused }); });
  // pagamentos liquidados sem entrega (reconciliação/reembolso manual)
  app.get("/internal/reconcile", auth, (_req, res) => res.json({ failures }));
  app.get("/internal/market/search", internal, async (req, res) => {
    try { res.json({ items: await buyer.search({ q: req.query.q, limit: req.query.limit }) }); }
    catch (e) { res.status(502).json({ error: "discovery_failed" }); }
  });
  app.post("/internal/market/buy", internal, async (req, res) => res.json(await buyer.buy(req.body ?? {})));

  for (const svc of catalog) {
    // valida ANTES de cobrar: entrada inválida nunca gera pagamento. Só quando já há pagamento
    // no pedido; a sonda sem pagamento (crawler/listagem) segue recebendo o 402 padrão.
    const check = (req, res, next) => {
      if (!req.get("payment-signature") && !req.get("x-payment")) return next();
      const err = validate(svc.schema, req.body);
      return err ? res.status(400).json({ error: "invalid_request", detail: err }) : next();
    };
    app.post(`/v1/x402/${svc.id}`, guard, check, gateway.require(svc.price), async (req, res) => {
      const r = await deliver(cfg, svc, req.payment ?? {}, req.body);
      res.status(r.status).json(r.body);
    });
  }

  return app;
}
