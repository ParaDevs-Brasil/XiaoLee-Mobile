import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { openapi } from "./openapi.js";

// Gateway x402 (Circle) na frente do FastAPI. O pagamento é liquidado ANTES do handler;
// o upstream só é chamado com o segredo interno + dados do pagador (anti-bypass no FastAPI).
export function createApp(cfg) {
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  const gateway = createGatewayMiddleware({
    sellerAddress: cfg.sellerAddress,
    facilitatorUrl: cfg.facilitatorUrl,
    ...(cfg.networks.length ? { networks: cfg.networks } : {}),
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/openapi.json", (_req, res) => res.json(openapi(cfg)));

  app.post("/v1/x402/profile-analysis", gateway.require(cfg.price), async (req, res) => {
    const p = req.payment ?? {};
    try {
      const up = await fetch(cfg.upstreamUrl, {
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
      res.status(502).json({ error: "upstream_failed", payment_tx: p.transaction ?? null });
    }
  });

  return app;
}
