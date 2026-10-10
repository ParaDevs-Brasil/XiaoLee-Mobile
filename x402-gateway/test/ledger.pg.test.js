// Integração com Postgres real. Só roda com TEST_DATABASE_URL (ex.: um container descartável).
import test from "node:test";
import assert from "node:assert/strict";
import { createLedger } from "../src/ledger.js";

const url = process.env.TEST_DATABASE_URL;
const svc = { id: "profile-analysis" };
const P = (tx) => ({ payer: "0xabc", network: "eip155:5042", amount: 50000, transaction: tx });

test("pg ledger: begin/finish/open, idempotência e sobrevivência a novo pool", { skip: !url }, async () => {
  const l = await createLedger(url);
  const tx = `t-${Date.now()}`;
  await l.begin(svc, P(tx));
  await l.begin(svc, P(tx)); // mesmo pagamento reapresentado: uma linha só
  let open = (await l.open()).filter((r) => r.payment_tx === tx);
  assert.equal(open.length, 1); assert.equal(open[0].status, "settled");

  await l.finish(tx, "failed", "upstream_502");
  await l.close();

  // "restart": pool novo enxerga o registro
  const l2 = await createLedger(url);
  open = (await l2.open()).filter((r) => r.payment_tx === tx);
  assert.equal(open[0].status, "failed"); assert.equal(open[0].reason, "upstream_502");

  await l2.finish(tx, "delivered");
  assert.equal((await l2.open()).filter((r) => r.payment_tx === tx).length, 0);
  await l2.begin(svc, P(tx)); // entregue não é rebaixado
  assert.equal((await l2.open()).filter((r) => r.payment_tx === tx).length, 0);
  await l2.close();
});
