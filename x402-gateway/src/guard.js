// Portões de operação das rotas pagas: botão de desligar e limite de taxa. Ambos rodam ANTES
// do middleware de pagamento, então nunca geram cobrança.

// Quem é o pagador, lido do header de pagamento (EIP-3009: payload.authorization.from).
// Não é verificado aqui (a Circle verifica); serve só como chave do limite. Sem header, vale o IP.
export function payerKey(req) {
  const h = req.get("payment-signature") ?? req.get("x-payment");
  if (h) {
    try {
      const from = JSON.parse(Buffer.from(h, "base64").toString())?.payload?.authorization?.from;
      if (typeof from === "string" && /^0x[0-9a-fA-F]{40}$/.test(from)) return from.toLowerCase();
    } catch { /* cai para o IP */ }
  }
  return `ip:${req.ip}`;
}

// ponytail: janela fixa em memória por instância; Redis se o gateway passar de 1 réplica.
export function createLimiter({ max, windowMs, now = Date.now }) {
  const hits = new Map();
  return (key) => {
    const t = now(), e = hits.get(key);
    if (!e || t - e.start >= windowMs) {
      if (hits.size > 10_000) hits.clear(); // teto de memória
      hits.set(key, { start: t, n: 1 });
      return true;
    }
    return ++e.n <= max;
  };
}

// state.paused: ligado por X402_PAUSED=true ou em runtime via POST /internal/pause.
export function guardMiddleware(state, allow) {
  return (req, res, next) => {
    if (state.paused) return res.status(503).json({ error: "paused", detail: "service temporarily disabled; no charge was made" });
    if (!allow(payerKey(req))) {
      res.set("retry-after", "60");
      return res.status(429).json({ error: "rate_limited", detail: "too many requests; no charge was made" });
    }
    next();
  };
}
