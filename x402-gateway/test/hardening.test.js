import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createBuyer } from "../src/buyer.js";
import { deliver, failures } from "../src/delivery.js";
import { openapi } from "../src/openapi.js";

const cfg = { sellerAddress: "0x08cdF8De63700A66467EaBFfc603B6A14BA89125", facilitatorUrl: "https://gateway-api-testnet.circle.com",
  networks: ["eip155:5042002"], upstreamBase: "http://127.0.0.1:1", internalSecret: "s", upstreamTimeoutMs: 500, publicUrl: "http://x" };

test("rate limit: pagador forjado em loop não escapa do limite por IP", async () => {
  const srv = createApp({ ...cfg, ipRateLimitPerMin: 3 }).listen(0);
  const url = `http://127.0.0.1:${srv.address().port}/v1/x402/profile-analysis`;
  const fake = (i) => ({ "content-type": "application/json", "payment-signature": Buffer.from(JSON.stringify({ payload: { authorization: { from: "0x" + String(i).padStart(40, "0") } } })).toString("base64") });
  try {
    const st = [];
    for (let i = 1; i <= 5; i++) st.push((await fetch(url, { method: "POST", body: "{}", headers: fake(i) })).status);
    assert.deepEqual(st.map((s) => s === 429), [false, false, false, true, true]);
  } finally { srv.close(); }
});

const item = (resource, accepts) => ({ resource, accepts, metadata: { supportsCircleGateway: true, method: "POST", description: "d", provider: { name: "P" } } });

test("busca: pagina o Discovery, filtra pela rede do comprador e usa o preço dessa rede", async () => {
  const pages = [
    Array.from({ length: 100 }, (_, i) => item(`https://m/${i}`, [{ network: "eip155:5042", amount: "100" }])),
    [item("https://t/1", [{ network: "eip155:5042002", amount: "70000" }, { network: "eip155:5042", amount: "1" }])],
  ];
  const urls = [];
  const fetchFn = async (u) => { urls.push(u); const off = Number(new URL(u).searchParams.get("offset")); return { ok: true, json: async () => ({ items: pages[off / 100] ?? [], pagination: { total: 101 } }) }; };
  const mkb = (network) => createBuyer({ maxPerCallUsdc: 1, dailyCapUsdc: 1, network }, { makeClient: () => ({}), fetchFn, sleep: async () => {} });
  const testnet = await mkb("eip155:5042002").search({ limit: 20 });
  assert.deepEqual(testnet.map((i) => [i.resource, i.price_usdc]), [["https://t/1", 0.07]]); // o item da página 2 aparece
  assert.equal(urls.length, 2);
  assert.equal((await mkb("eip155:5042").search({ limit: 3 })).length, 3);
});

test("teto diário: pagamento liquidado seguido de erro do vendedor CONTA no teto (não devolve reserva)", async () => {
  const fetchFn = async () => ({ ok: true, json: async () => ({ items: [item("https://a/x", [{ amount: "50000" }])] }) });
  const makeClient = () => { let hook; return {
    onBeforePaymentCreation(h) { hook = h; },
    async pay() {
      const r = await hook({ selectedRequirements: { amount: "50000" } });
      if (r?.abort) throw new Error(`Payment creation aborted: ${r.reason}`);
      throw new Error("Payment failed: upstream_failed"); // liquidou e o vendedor falhou
    } }; };
  const b = createBuyer({ maxPerCallUsdc: 0.1, dailyCapUsdc: 0.1 }, { makeClient, fetchFn });
  await b.search({});
  assert.equal((await b.buy({ url: "https://a/x" })).error, "payment_failed");
  assert.equal(b.spentToday(), 0.05); // antes voltava a 0 e o teto diário podia ser furado
  await b.buy({ url: "https://a/x" });
  assert.equal((await b.buy({ url: "https://a/x" })).error, "daily_cap_reached");
});

test("deliver: 4xx do upstream depois de liquidar vai para a reconciliação", async () => {
  failures.length = 0;
  const p = { payer: "0xabc", network: "eip155:5042002", amount: "50000", transaction: "tx-403" };
  const svc = { id: "profile-analysis", upstream: "profile-analysis" };
  const r = await deliver(cfg, svc, p, {}, { fetchFn: async () => ({ status: 403, json: async () => ({ detail: "forbidden" }) }) });
  assert.equal(r.status, 403);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason, "upstream_403");
  assert.equal(failures[0].payment_tx, "tx-403");
});

test("openapi 3.1 (exclusiveMinimum numérico é válido)", () => {
  assert.equal(openapi(cfg).openapi, "3.1.0");
});

test("busca: 429 do Discovery espera e tenta de novo; falha no meio devolve o parcial", async () => {
  let n = 0;
  const full = Array.from({ length: 100 }, (_, i) => item(`https://m/${i}`, [{ network: "eip155:5042", amount: "100" }]));
  // 1ª chamada: 429; depois página 1 ok; página 2 sempre 500
  const fetchFn = async (u) => {
    n++;
    if (n === 1) return { ok: false, status: 429, headers: new Headers() };
    if (new URL(u).searchParams.get("offset") === "0") return { ok: true, status: 200, json: async () => ({ items: full, pagination: { total: 250 } }) };
    return { ok: false, status: 500 };
  };
  const b = createBuyer({ maxPerCallUsdc: 1, dailyCapUsdc: 1, network: "eip155:5042" }, { makeClient: () => ({}), fetchFn, sleep: async () => {} });
  assert.equal((await b.search({ limit: 20 })).length, 20); // parcial (100 itens) em vez de erro
});
