// Entrega após o pagamento: valida ANTES de cobrar, repete em falha transitória e registra o que
// foi liquidado mas não entregue (para reembolso/reconciliação manual).

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
    if (s.minimum !== undefined && v < s.minimum) return `${k}: below minimum`;
    if (s.maximum !== undefined && v > s.maximum) return `${k}: above maximum`;
    if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) return `${k}: must be > ${s.exclusiveMinimum}`;
    if (s.minItems !== undefined && v.length < s.minItems) return `${k}: too few items`;
    if (s.maxItems !== undefined && v.length > s.maxItems) return `${k}: too many items`;
  }
  return null;
}

// ponytail: registro em memória + log JSON (Railway retém os logs); zera ao reiniciar.
// Persistir no Postgres se o volume de falhas justificar.
export const failures = [];
const record = (f) => { failures.push(f); if (failures.length > 200) failures.shift(); console.log(JSON.stringify({ event: "delivery_failed", ...f })); };

export async function deliver(cfg, svc, p, body, { fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 3 } = {}) {
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
      if (up.status < 500) return { status: up.status, body: await up.json() };
      last = `upstream_${up.status}`;
    } catch (e) { last = String(e?.name ?? e).slice(0, 80); }
    if (i < attempts) await sleep(300 * i);
  }
  record({ at: new Date().toISOString(), service: svc.id, payment_tx: p.transaction ?? null, payer: p.payer ?? null,
    network: p.network ?? null, amount: p.amount ?? null, reason: last });
  return { status: 502, body: { error: "upstream_failed", service: svc.id, payment_tx: p.transaction ?? null } };
}
