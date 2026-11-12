import test from "node:test";
import assert from "node:assert/strict";
import { deliver, validate } from "../src/delivery.js";
import { memoryLedger } from "../src/ledger.js";
import { catalog } from "../src/catalog.js";

const cfg = { upstreamBase: "http://u", internalSecret: "s", upstreamTimeoutMs: 100 };
const svc = catalog[0];
const P = { payer: "0xabc", network: "eip155:5042002", amount: "50000", transaction: "tx-1" };
const noSleep = () => Promise.resolve();
const res = (status, body = { ok: 1 }) => ({ status, json: async () => body });

test("validate: obrigatórios, tipos e limites (antes de cobrar)", () => {
  const s = catalog.find((c) => c.id === "campaign-plan").schema;
  assert.equal(validate(s, { goal: "x", budget_usdc: 10 }), null);
  assert.match(validate(s, { goal: "x" }), /missing field: budget_usdc/);
  assert.match(validate(s, { goal: "x", budget_usdc: 0 }), /must be > 0/);
  assert.match(validate(s, { goal: "x", budget_usdc: "10" }), /expected number/);
  assert.match(validate(s, { goal: "x", budget_usdc: 1, platforms: [] }), /too few/);
  assert.match(validate(s, []), /object/);
});

test("deliver: falha transitória é repetida e entrega", async () => {
  let n = 0;
  const r = await deliver(cfg, svc, P, {}, { fetchFn: async () => (++n < 3 ? res(503) : res(200)), sleep: noSleep });
  assert.equal(r.status, 200); assert.equal(n, 3);
});

test("deliver: erro 4xx do upstream não é repetido", async () => {
  let n = 0;
  const r = await deliver(cfg, svc, P, {}, { fetchFn: async () => (n++, res(422, { detail: "bad" })), sleep: noSleep });
  assert.equal(r.status, 422); assert.equal(n, 1);
});

test("deliver: esgotou as tentativas -> 502 com tx e registro p/ reconciliação", async () => {
  const ledger = memoryLedger();
  const r = await deliver(cfg, svc, P, {}, { ledger, fetchFn: async () => { throw new Error("down"); }, sleep: noSleep });
  assert.equal(r.status, 502); assert.equal(r.body.payment_tx, "tx-1");
  const open = await ledger.open();
  assert.equal(open.length, 1);
  assert.equal(open[0].payment_tx, "tx-1"); assert.equal(open[0].service, "clip-highlights"); assert.equal(open[0].status, "failed");
});

test("validate: minLength, limites e itens de array (strings e objetos), antes de cobrar", () => {
  const svc = (id) => catalog.find((s) => s.id === id).schema;
  assert.match(validate(svc("campaign-plan"), { goal: "", budget_usdc: 10 }), /too short/);
  const seg = (i) => ({ start: i * 10, end: i * 10 + 9, text: `fala ${i}` });
  const t = { transcript: [seg(0), seg(1), seg(2)] };
  assert.equal(validate(svc("clip-highlights"), t), null);
  assert.match(validate(svc("clip-highlights"), { transcript: [seg(0), seg(1)] }), /too few items/);
  assert.match(validate(svc("clip-highlights"), { transcript: Array.from({ length: 201 }, (_, i) => seg(i)) }), /too many items/);
  assert.match(validate(svc("clip-highlights"), { transcript: [seg(0), seg(1), { start: 0, end: 5 }] }), /transcript\[2\]: missing field: text/);
  assert.match(validate(svc("clip-highlights"), { transcript: [seg(0), seg(1), { ...seg(2), text: "x".repeat(201) }] }), /transcript\[2\]: text: too long/);
  assert.match(validate(svc("clip-highlights"), { transcript: [seg(0), seg(1), { ...seg(2), start: -1 }] }), /below minimum/);
  assert.match(validate(svc("clip-highlights"), { ...t, max_clips: 9 }), /above maximum/);
});

test("ledger: entrega concluída sai da lista aberta; crash no meio fica como settled", async () => {
  const ledger = memoryLedger();
  await deliver(cfg, svc, P, {}, { ledger, fetchFn: async () => res(200) });
  assert.equal((await ledger.open()).length, 0);
  // crash: begin feito, finish nunca chamado
  await ledger.begin(svc, { ...P, transaction: "tx-crash" });
  const open = await ledger.open();
  assert.deepEqual(open.map((r) => [r.payment_tx, r.status]), [["tx-crash", "settled"]]);
});

test("ledger: erro de escrita não derruba a entrega paga", async () => {
  const broken = { async begin() { throw new Error("db down"); }, async finish() { throw new Error("db down"); }, async open() { return []; } };
  const r = await deliver(cfg, svc, P, {}, { ledger: broken, fetchFn: async () => res(200) });
  assert.equal(r.status, 200);
});

test("ledger: resolve fecha caso aberto, não reabre e não rebaixa", async () => {
  const ledger = memoryLedger();
  await deliver(cfg, svc, P, {}, { ledger, fetchFn: async () => res(503), sleep: noSleep, attempts: 1 });
  assert.equal((await ledger.open()).length, 1);
  assert.equal(await ledger.resolve("tx-1", { note: "refunded", refund_tx: "0xrefund" }), true);
  assert.equal((await ledger.open()).length, 0);
  assert.equal(await ledger.resolve("tx-1", { note: "again" }), false); // já fechado
  await ledger.begin(svc, P); // mesmo pagamento reapresentado não reabre
  assert.equal((await ledger.open()).length, 0);
  assert.equal(await ledger.resolve("nope", { note: "x" }), false);
});
