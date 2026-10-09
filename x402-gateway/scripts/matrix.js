// Matriz de testes de um comprador. Cada pessoa roda com a PRÓPRIA carteira:
//   BUYER_PRIVATE_KEY=0x... node scripts/matrix.js <label> [base-url]
// Saída: JSON com um resultado por cenário (cole no relatório). Nunca imprime a chave.
// Rede: X402_CHAIN (arcTestnet | arc), RPC em ARC_RPC. Custo típico: ~$0.35 de testnet.
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { generatePrivateKey } from "viem/accounts";

const label = process.argv[2] ?? "wallet";
const base = process.argv[3] ?? "https://x402-gateway-production-f2fa.up.railway.app";
const chain = process.env.X402_CHAIN ?? "arcTestnet";
const rpcUrl = process.env.ARC_RPC ?? (chain === "arc" ? "https://rpc.mainnet.arc.io" : "https://rpc.testnet.arc.io");
const mk = (key = process.env.BUYER_PRIVATE_KEY) => new GatewayClient({ chain, privateKey: key, rpcUrl });
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const avail = async (c) => BigInt((await c.getBalances()).gateway.available);

const PROFILE = { handle: "@matrix", niche: "defi", platforms: ["tiktok"], followers: 1000, posts_per_week: 3 };
const PLAN = { goal: "teste matriz", budget_usdc: 100, platforms: ["x"], duration_days: 3 };
const url = (s) => `${base}/v1/x402/${s}`;
const report = { label, chain, base, at: new Date().toISOString(), results: [] };
const run = async (name, fn) => {
  try { report.results.push({ name, ...(await fn()) }); }
  catch (e) { report.results.push({ name, pass: false, error: String(e?.message ?? e).slice(0, 200) }); }
};

const buyer = mk();
report.address = buyer.address;
report.startGateway = (await avail(buyer)).toString();

await run("1 compra normal (profile-analysis + campaign-plan)", async () => {
  const before = await avail(buyer);
  const a = await buyer.pay(url("profile-analysis"), { method: "POST", body: PROFILE });
  const b = await buyer.pay(url("campaign-plan"), { method: "POST", body: PLAN });
  const spent = before - (await avail(buyer));
  return { pass: a.status === 200 && b.status === 200 && !!a.data.receipt?.receipt_pqc && spent === 150000n, spent_atomic: spent.toString() };
});

await run("2 entrada inválida não é cobrada", async () => {
  const before = await avail(buyer);
  let status = null;
  try { const r = await buyer.pay(url("campaign-plan"), { method: "POST", body: { goal: "sem orçamento" } }); status = r.status; }
  catch (e) { status = String(e?.message ?? e).slice(0, 80); }
  const spent = before - (await avail(buyer));
  return { pass: spent === 0n, observed: status, spent_atomic: spent.toString() };
});

await run("3 preço acima do teto: comprador aborta e não paga", async () => {
  const c = mk(); const before = await avail(c);
  c.onBeforePaymentCreation(async () => ({ abort: true, reason: "price_above_cap" }));
  let aborted = false;
  try { await c.pay(url("profile-analysis"), { method: "POST", body: PROFILE }); } catch (e) { aborted = /abort/i.test(String(e?.message)); }
  return { pass: aborted && before === (await avail(c)) };
});

await run("4 concorrência: 3 compras simultâneas, 3 cobranças", async () => {
  const before = await avail(buyer);
  const rs = await Promise.allSettled([1, 2, 3].map(() => buyer.pay(url("profile-analysis"), { method: "POST", body: PROFILE })));
  const ok = rs.filter((r) => r.status === "fulfilled" && r.value.status === 200).length;
  const spent = before - (await avail(buyer));
  return { pass: spent === BigInt(ok) * 50000n && ok >= 1, ok, spent_atomic: spent.toString(), note: ok < 3 ? "algumas falharam: ver detalhe" : undefined };
});

await run("5 saldo insuficiente: carteira nova sem fundos falha", async () => {
  const c = mk(generatePrivateKey()); // efêmera, sem saldo
  try { await c.pay(url("profile-analysis"), { method: "POST", body: PROFILE }); return { pass: false, note: "pagou sem saldo?!" }; }
  catch (e) { return { pass: true, error: String(e?.message ?? e).slice(0, 120) }; }
});

await run("6 replay do mesmo pagamento não é entregue de novo", async () => {
  let payload;
  const c = mk(); c.onAfterPaymentCreation(async (ctx) => { payload = ctx.paymentPayload; });
  await c.pay(url("profile-analysis"), { method: "POST", body: PROFILE });
  const header = Buffer.from(JSON.stringify(payload)).toString("base64");
  const r = await fetch(url("profile-analysis"), { method: "POST", headers: { "content-type": "application/json", "payment-signature": header }, body: JSON.stringify(PROFILE) });
  const text = (await r.text()).slice(0, 160);
  // conclusivo só se a resposta indicar nonce/uso repetido; um 400 genérico pode ser formato do header
  return { pass: r.status !== 200, replay_status: r.status, replay_body: text, conclusive: /nonce|used|already|replay/i.test(text) };
});

report.endGateway = (await avail(buyer)).toString();
report.allPass = report.results.every((r) => r.pass);
console.log(JSON.stringify(report, big, 2));
process.exit(report.allPass ? 0 : 1);
