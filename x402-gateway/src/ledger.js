// Ledger de liquidações: cada pagamento entra como `settled` ANTES de chamar o upstream e vira
// `delivered` ou `failed` depois. Uma linha que ficou em `settled` = pedido pago que travou/crashou.
// Duas implementações com a mesma interface: memória (dev/testnet) e Postgres (mainnet exige).

const OPEN = ["settled", "failed"];
const CLOSED = ["delivered", "resolved"]; // resolved = reembolsado/tratado manualmente (nota + hash)
const keyOf = (p) => String(p.transaction || `${p.payer ?? "?"}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`);

export function memoryLedger() {
  const rows = new Map();
  return {
    durable: false,
    async begin(svc, p) {
      const k = keyOf(p);
      const now = new Date().toISOString();
      const prev = rows.get(k);
      if (prev && CLOSED.includes(prev.status)) return k;
      rows.set(k, { payment_tx: k, service: svc.id, payer: p.payer ?? null, network: p.network ?? null,
        amount: p.amount ?? null, status: "settled", reason: null, created_at: prev?.created_at ?? now, updated_at: now });
      if (rows.size > 1000) rows.delete(rows.keys().next().value);
      return k;
    },
    async finish(k, status, reason = null) {
      const r = rows.get(k);
      if (r && !CLOSED.includes(r.status)) Object.assign(r, { status, reason, updated_at: new Date().toISOString() });
    },
    async resolve(k, { note, refund_tx = null }) {
      const r = rows.get(k);
      if (!r || !OPEN.includes(r.status)) return false;
      Object.assign(r, { status: "resolved", resolution_note: note, refund_tx, updated_at: new Date().toISOString() });
      return true;
    },
    async open() { return [...rows.values()].filter((r) => OPEN.includes(r.status)); },
    async close() {},
  };
}

export function pgLedger(pool) {
  let ready;
  const init = () => (ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS x402_settlements (
      payment_tx text PRIMARY KEY, service text NOT NULL, payer text, network text, amount text,
      status text NOT NULL, reason text, resolution_note text, refund_tx text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE x402_settlements ADD COLUMN IF NOT EXISTS resolution_note text;
    ALTER TABLE x402_settlements ADD COLUMN IF NOT EXISTS refund_tx text;
    DROP INDEX IF EXISTS x402_settlements_open;
    CREATE INDEX IF NOT EXISTS x402_settlements_open2 ON x402_settlements (status) WHERE status IN ('settled','failed');
  `).catch((e) => { ready = undefined; throw e; }));
  return {
    durable: true,
    async begin(svc, p) {
      await init();
      const k = keyOf(p);
      // não rebaixa entrega concluída nem caso resolvido (mesmo pagamento reapresentado)
      await pool.query(
        `INSERT INTO x402_settlements (payment_tx, service, payer, network, amount, status)
         VALUES ($1,$2,$3,$4,$5,'settled')
         ON CONFLICT (payment_tx) DO UPDATE SET status = 'settled', reason = NULL, updated_at = now()
         WHERE x402_settlements.status IN ('settled','failed')`,
        [k, svc.id, p.payer ?? null, p.network ?? null, p.amount == null ? null : String(p.amount)]);
      return k;
    },
    async finish(k, status, reason = null) {
      await init();
      await pool.query(
        `UPDATE x402_settlements SET status = $2, reason = $3, updated_at = now()
         WHERE payment_tx = $1 AND status IN ('settled','failed')`, [k, status, reason]);
    },
    async resolve(k, { note, refund_tx = null }) {
      await init();
      const r = await pool.query(
        `UPDATE x402_settlements SET status = 'resolved', resolution_note = $2, refund_tx = $3, updated_at = now()
         WHERE payment_tx = $1 AND status IN ('settled','failed')`, [k, note, refund_tx]);
      return r.rowCount === 1;
    },
    async open() {
      await init();
      const { rows } = await pool.query(
        `SELECT payment_tx, service, payer, network, amount, status, reason, created_at, updated_at
         FROM x402_settlements WHERE status IN ('settled','failed') ORDER BY created_at DESC LIMIT 500`);
      return rows;
    },
    async close() { await pool.end(); },
  };
}

// DATABASE_URL presente -> Postgres; senão memória. O chamador decide se memória é aceitável.
export async function createLedger(databaseUrl) {
  if (!databaseUrl) return memoryLedger();
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 });
  const l = pgLedger(pool);
  await l.open(); // falha no boot se o banco/credencial estiver errado, em vez de no primeiro pagamento
  return l;
}
