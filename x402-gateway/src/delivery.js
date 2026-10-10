import { memoryLedger } from "./ledger.js";

// Entrega após o pagamento: valida ANTES de cobrar, repete em falha transitória e registra o que
// foi liquidado mas não entregue (ledger persistente; reembolso manual a partir dele).

// Validação mínima do schema do catálogo (required/type/limites). Sem dependência extra.
export function validate(schema, body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return "body must be an object";
  for (const k of schema.required ?? []) if (body[k] === undefined) return `missing field: ${k}`;
  for (const [k, s] of Object.entries(schema.properties ?? {})) {
    const v = body[k];
    if (v === undefined) continue;
    const ok = { string: typeof v === "string", number: typeof v === "number" && Number.isFinite(v),
      integer: Number.isInteger(v), array: Array.isArray(v), object: v && typeof v === "object" && !Array.isArray(v) }[s.type] ?? true;
    if (!ok) return `${k}: expected ${s.type}`;
    if (s.maxLength !== undefined && v.length > s.maxLength) return `${k}: too long`;
    if (s.minLength !== undefined && v.length < s.minLength) return `${k}: too short`;
    if (s.enum && !s.enum.includes(v)) return `${k}: not one of ${s.enum.join(", ")}`;
    if (s.minimum !== undefined && v < s.minimum) return `${k}: below minimum`;
    if (s.maximum !== undefined && v > s.maximum) return `${k}: above maximum`;
    if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) return `${k}: must be > ${s.exclusiveMinimum}`;
    if (s.minItems !== undefined && v.length < s.minItems) return `${k}: too few items`;
    if (s.maxItems !== undefined && v.length > s.maxItems) return `${k}: too many items`;
    if (s.type === "array" && s.items?.type === "string" && v.some((x) => typeof x !== "string" || x.length > (s.items.maxLength ?? Infinity))) return `${k}: invalid item`;
  }
  return null;
}

// Ledger padrão em memória (testes/dev); o servidor injeta o Postgres. Erro de ledger nunca
// derruba a entrega: o pagamento já foi liquidado, então só registramos no log.
export const defaultLedger = memoryLedger();
const safe = async (what, fn) => { try { return await fn(); } catch (e) { console.log(JSON.stringify({ event: "ledger_error", what, error: String(e?.message ?? e).slice(0, 200) })); } };
const logFail = (f) => console.log(JSON.stringify({ event: "delivery_failed", ...f }));

export async function deliver(cfg, svc, p, body, { fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 3, ledger = defaultLedger } = {}) {
  const key = await safe("begin", () => ledger.begin(svc, p));
  const fail = async (reason) => {
    logFail({ at: new Date().toISOString(), service: svc.id, payment_tx: p.transaction ?? null, payer: p.payer ?? null,
      network: p.network ?? null, amount: p.amount ?? null, reason });
    if (key) await safe("finish", () => ledger.finish(key, "failed", reason));
  };
  let last = "unknown";
  for (let i = 1; i <= attempts; i++) {
    try {
      const up = await fetchFn(`${cfg.upstreamBase}/${svc.upstream}`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "x-internal-secret": cfg.internalSecret,
          "x-payer": String(p.payer ?? ""), "x-payment-network": String(p.network ?? ""),
          "x-payment-amount": String(p.amount ?? ""), "x-payment-tx": String(p.transaction ?? ""),
        },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(cfg.upstreamTimeoutMs),
      });
      if (up.status < 500) {
        const out = await up.json().catch(() => null);
        if (out !== null) {
          // já liquidado: 4xx (segredo errado, 422...) também precisa de rastro para reembolso
          if (up.status >= 400) await fail(`upstream_${up.status}`);
          else if (key) await safe("finish", () => ledger.finish(key, "delivered"));
          return { status: up.status, body: out };
        }
        last = "upstream_bad_json";
      } else last = `upstream_${up.status}`;
    } catch (e) { last = String(e?.name ?? e).slice(0, 80); }
    if (i < attempts) await sleep(300 * i);
  }
  await fail(last);
  return { status: 502, body: { error: "upstream_failed", service: svc.id, payment_tx: p.transaction ?? null } };
}
