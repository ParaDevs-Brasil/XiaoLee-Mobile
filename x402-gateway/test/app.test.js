import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

const cfg = {
  sellerAddress: "0x08cdF8De63700A66467EaBFfc603B6A14BA89125",
  facilitatorUrl: "https://gateway-api-testnet.circle.com",
  networks: ["eip155:5042002"],
  upstreamBase: "http://127.0.0.1:1", internalSecret: "s", upstreamTimeoutMs: 500,
};

test("catálogo: cada serviço responde 402 com o seu preço", async () => {
  const srv = createApp(cfg).listen(0);
  try {
    for (const [id, amount] of [["profile-analysis", "50000"], ["campaign-plan", "100000"]]) {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/v1/x402/${id}`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
      assert.equal(r.status, 402, id);
      const pr = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString());
      assert.equal(pr.accepts[0].amount, amount, id);
    }
  } finally { srv.close(); }
});

test("sem pagamento: 402 padrão x402 v2 com accepts[] em Arc Testnet", async () => {
  const srv = createApp(cfg).listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/v1/x402/profile-analysis`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    assert.equal(r.status, 402);
    const pr = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString());
    assert.equal(pr.x402Version, 2);
    const a = pr.accepts[0];
    assert.equal(a.network, "eip155:5042002");
    assert.equal(a.amount, "50000");
    assert.equal(a.payTo.toLowerCase(), cfg.sellerAddress.toLowerCase());
  } finally { srv.close(); }
});

test("/openapi.json expõe a rota paga", async () => {
  const srv = createApp({ ...cfg, publicUrl: "http://x" }).listen(0);
  try {
    const d = await (await fetch(`http://127.0.0.1:${srv.address().port}/openapi.json`)).json();
    assert.ok(d.paths["/v1/x402/profile-analysis"].post);
    assert.ok(d.paths["/v1/x402/campaign-plan"].post);
  } finally { srv.close(); }
});

test("comprador interno: 503 sem chave, 403 sem segredo, 200 com segredo", async () => {
  const mkSrv = (buyer) => createApp({ ...cfg, internalSecret: "s" }, buyer).listen(0);
  let srv = mkSrv(null);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${srv.address().port}/internal/market/search`, { headers: { "x-internal-secret": "s" } })).status, 503);
  } finally { srv.close(); }
  srv = mkSrv({ search: async () => [{ resource: "r" }], buy: async () => ({ ok: true }) });
  try {
    const u = `http://127.0.0.1:${srv.address().port}/internal/market/search`;
    assert.equal((await fetch(u)).status, 403);
    assert.equal((await fetch(u, { headers: { "x-internal-secret": "bad" } })).status, 403);
    assert.equal((await (await fetch(u, { headers: { "x-internal-secret": "s" } })).json()).items[0].resource, "r");
  } finally { srv.close(); }
});

test("entrada inválida COM pagamento no pedido: 400 antes de cobrar; sonda sem pagamento segue 402", async () => {
  const srv = createApp(cfg).listen(0);
  try {
    const u = `http://127.0.0.1:${srv.address().port}/v1/x402/campaign-plan`;
    const h = { "content-type": "application/json" };
    const r = await fetch(u, { method: "POST", body: JSON.stringify({ goal: "x" }), headers: { ...h, "payment-signature": "e30=" } });
    assert.equal(r.status, 400);
    assert.equal(r.headers.get("payment-required"), null);
    assert.equal((await fetch(u, { method: "POST", body: "{}", headers: h })).status, 402);
  } finally { srv.close(); }
});

test("/internal/reconcile exige o segredo mesmo sem comprador", async () => {
  const srv = createApp({ ...cfg, internalSecret: "s" }).listen(0);
  try {
    const u = `http://127.0.0.1:${srv.address().port}/internal/reconcile`;
    assert.equal((await fetch(u)).status, 403);
    assert.ok(Array.isArray((await (await fetch(u, { headers: { "x-internal-secret": "s" } })).json()).failures));
  } finally { srv.close(); }
});

test("pausa: 503 sem cobrar, liga/desliga em runtime com o segredo", async () => {
  const srv = createApp({ ...cfg, internalSecret: "s" }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (path, headers = {}, body = "{}") => fetch(base + path, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
  try {
    assert.equal((await post("/v1/x402/profile-analysis")).status, 402);
    assert.equal((await post("/internal/pause", {}, '{"paused":true}')).status, 403);
    assert.equal((await post("/internal/pause", { "x-internal-secret": "s" }, '{"paused":true}')).status, 200);
    const r = await post("/v1/x402/profile-analysis");
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("payment-required"), null); // nem oferece pagamento
    assert.equal((await fetch(base + "/health")).status, 200);
    await post("/internal/pause", { "x-internal-secret": "s" }, '{"paused":false}');
    assert.equal((await post("/v1/x402/profile-analysis")).status, 402);
  } finally { srv.close(); }
});

test("limite de taxa: excedeu -> 429 antes de cobrar; pagadores distintos têm cotas separadas", async () => {
  const srv = createApp({ ...cfg, rateLimitPerMin: 2 }).listen(0);
  const url = `http://127.0.0.1:${srv.address().port}/v1/x402/profile-analysis`;
  const hdr = (addr) => ({ "content-type": "application/json", "payment-signature": Buffer.from(JSON.stringify({ payload: { authorization: { from: addr } } })).toString("base64") });
  const A = "0x" + "a".repeat(40), B = "0x" + "b".repeat(40);
  try {
    const st = async (h) => (await fetch(url, { method: "POST", body: "{}", headers: h })).status;
    // com header de pagamento inválido o pedido ainda passa pelo guard; o status final não importa, só 429 ou não
    assert.notEqual(await st(hdr(A)), 429);
    assert.notEqual(await st(hdr(A)), 429);
    assert.equal(await st(hdr(A)), 429);
    assert.notEqual(await st(hdr(B)), 429);
  } finally { srv.close(); }
});
