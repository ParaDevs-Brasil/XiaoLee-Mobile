import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { openapi } from "./openapi.js";
import { catalog } from "./catalog.js";
import { timingSafeEqual } from "node:crypto";

// Gateway x402 (Circle) na frente do FastAPI. O pagamento é liquidado ANTES do handler;
// o upstream só é chamado com o segredo interno + dados do pagador (anti-bypass no FastAPI).
export function createApp(cfg, buyer = null) {
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  const gateway = createGatewayMiddleware({
    sellerAddress: cfg.sellerAddress,
    facilitatorUrl: cfg.facilitatorUrl,
    ...(cfg.networks.length ? { networks: cfg.networks } : {}),
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/openapi.json", (_req, res) => res.json(openapi(cfg)));

  // Comprador interno (só o FastAPI chama, com o segredo compartilhado)
  const internal = (req, res, next) => {
    const a = Buffer.from(String(req.get("x-internal-secret") ?? "")), b = Buffer.from(cfg.internalSecret ?? "");
    if (!buyer) return res.status(503).json({ error: "buyer_disabled" });
    if (!b.length || a.length !== b.length || !timingSafeEqual(a, b)) return res.status(403).json({ error: "forbidden" });
    next();
  };
  app.get("/internal/market/search", internal, async (req, res) => {
    try { res.json({ items: await buyer.search({ q: req.query.q, limit: req.query.limit }) }); }
    catch (e) { res.status(502).json({ error: "discovery_failed" }); }
  });
  app.post("/internal/market/buy", internal, async (req, res) => res.json(await buyer.buy(req.body ?? {})));

  for (const svc of catalog) {
    app.post(`/v1/x402/${svc.id}`, gateway.require(svc.price), async (req, res) => {
      const p = req.payment ?? {};
      try {
        const up = await fetch(`${cfg.upstreamBase}/${svc.upstream}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-secret": cfg.internalSecret,
            "x-payer": String(p.payer ?? ""),
            "x-payment-network": String(p.network ?? ""),
            "x-payment-amount": String(p.amount ?? ""),
            "x-payment-tx": String(p.transaction ?? ""),
          },
          body: JSON.stringify(req.body ?? {}),
          signal: AbortSignal.timeout(cfg.upstreamTimeoutMs),
        });
        res.status(up.status).json(await up.json());
      } catch (err) {
        // pagamento já liquidado: erro explícito p/ o comprador reconciliar pelo tx
        res.status(502).json({ error: "upstream_failed", service: svc.id, payment_tx: p.transaction ?? null });
      }
    });
  }

  return app;
}
