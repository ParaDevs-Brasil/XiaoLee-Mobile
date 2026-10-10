// Ledger de liquidações: cada pagamento entra como `settled` ANTES de chamar o upstream e vira
// `delivered` ou `failed` depois. Uma linha que ficou em `settled` = pedido pago que travou/crashou.
// Duas implementações com a mesma interface: memória (dev/testnet) e Postgres (mainnet exige).

const OPEN = ["settled", "failed"];
const keyOf = (p) => String(p.transaction || `${p.payer ?? "?"}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`);

export function memoryLedger() {
  const rows = new Map();
  return {
    durable: false,
    async begin(svc, p) {
      const k = keyOf(p);
      const now = new Date().toISOString();
      const prev = rows.get(k);
      if (prev?.status === "delivered") return k;
      rows.set(k, { payment_tx: k, service: svc.id, payer: p.payer ?? null, network: p.network ?? null,
        amount: p.amount ?? null, status: "settled", reason: null, created_at: prev?.created_at ?? now, updated_at: now });
      if (rows.size > 1000) rows.delete(rows.keys().next().value);
      return k;
    },
    async finish(k, status, reason = null) {
      const r = rows.get(k);
      if (r && r.status !== "delivered") Object.assign(r, { status, reason, updated_at: new Date().toISOString() });
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
      status text NOT NULL, reason text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS x402_settlements_open ON x402_settlements (status) WHERE status <> 'delivered';
  `));
  return {
    durable: true,
    async begin(svc, p) {
      await init();
      const k = keyOf(p);
      // não rebaixa uma entrega já concluída (mesmo pagamento reapresentado)
      await pool.query(
        `INSERT INTO x402_settlements (payment_tx, service, payer, network, amount, status)
         VALUES ($1,$2,$3,$4,$5,'settled')
         ON CONFLICT (payment_tx) DO UPDATE SET status = 'settled', reason = NULL, updated_at = now()
         WHERE x402_settlements.status <> 'delivered'`,
        [k, svc.id, p.payer ?? null, p.network ?? null, p.amount == null ? null : String(p.amount)]);
      return k;
    },
    async finish(k, status, reason = null) {
      await init();
      await pool.query(
        `UPDATE x402_settlements SET status = $2, reason = $3, updated_at = now()
         WHERE payment_tx = $1 AND status <> 'delivered'`, [k, status, reason]);
    },
    async open() {
      await init();
      const { rows } = await pool.query(
        `SELECT payment_tx, service, payer, network, amount, status, reason, created_at, updated_at
         FROM x402_settlements WHERE status <> 'delivered' ORDER BY created_at DESC LIMIT 500`);
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
