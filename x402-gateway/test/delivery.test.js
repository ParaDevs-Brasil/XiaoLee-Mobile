import test from "node:test";
import assert from "node:assert/strict";
import { deliver, validate, failures } from "../src/delivery.js";
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
  failures.length = 0;
  const r = await deliver(cfg, svc, P, {}, { fetchFn: async () => { throw new Error("down"); }, sleep: noSleep });
  assert.equal(r.status, 502); assert.equal(r.body.payment_tx, "tx-1");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].payment_tx, "tx-1"); assert.equal(failures[0].service, "profile-analysis");
});
