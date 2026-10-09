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
