// Lado comprador: descobre serviços no marketplace da Circle e paga via GatewayClient.
// A chave do comprador só existe aqui (env), nunca no modelo. Controles de gasto, em ordem:
// teto por chamada -> teto por usuário/dia -> teto global/dia (disjuntor) -> confirmação humana
// quando o vendedor não está na allowlist `allowedPayTo` ou o preço passa de `autoApproveUsdc`.
// A confirmação (`confirm`) só é chamada pelo FastAPI numa ação autenticada do usuário; o modelo
// só enxerga search/buy, então não consegue aprovar o próprio gasto.
// ponytail: gasto e confirmações em memória (zeram ao reiniciar); persistir no Postgres se o volume crescer.
import { createHash, randomUUID } from "node:crypto";

const DISCOVERY = "https://api.circle.com/v2/x402/discovery/resources";
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, n);
const usdc = (atomic) => Number(BigInt(atomic)) / 1e6;
const atomic = (v) => BigInt(Math.round(Number(v) * 1e6));
const fingerprint = (...p) => createHash("sha256").update(JSON.stringify(p)).digest("hex");
const MAX_PENDING = 200;

export function createBuyer(cfg, { makeClient, fetchFn = fetch, now = () => new Date(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), extra = [] }) {
  const seen = new Set(); // recursos devolvidos pela busca: só esses podem ser comprados
  let day = "", spent = 0n;
  const dayKey = () => now().toISOString().slice(0, 10);
  const allowed = new Set((cfg.allowedPayTo ?? []).map((a) => String(a).toLowerCase()));
  const autoApprove = atomic(cfg.autoApproveUsdc ?? 0); // 0 = tudo pede confirmação
  const userCap = atomic(cfg.userDailyCapUsdc ?? cfg.dailyCapUsdc);
  const confirmTtlMs = cfg.confirmTtlMs ?? 300_000;
  const users = new Map(); // userId -> { day, spent }
  const pending = new Map(); // confirmId -> cotação aguardando (ou já com) aprovação do usuário
  const userRow = (id) => {
    let u = users.get(id);
    if (!u || u.day !== dayKey()) { u = { day: dayKey(), spent: 0n }; users.set(id, u); }
    return u;
  };
  const purge = () => {
    for (const [k, p] of pending) if (p.exp < now().getTime()) pending.delete(k);
    while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value);
  };

  // O Discovery tem milhares de recursos (limit máx. 100 por página) e responde 429 a rajadas:
  // varre devagar, espera no 429, guarda 5 min e, se cair no meio, usa o que já veio.
  let cache = { at: 0, items: [], complete: false };
  async function page(off) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetchFn(`${DISCOVERY}?limit=100&offset=${off}`, { signal: AbortSignal.timeout(15000) });
      if (r.status !== 429) { if (!r.ok) throw new Error(`discovery_${r.status}`); return r.json(); }
      await sleep(Math.min(Number(r.headers?.get?.("retry-after")) * 1000 || 1500 * (attempt + 1), 8000));
    }
    throw new Error("discovery_429");
  }
  async function allResources() {
    const ttl = cache.complete ? 300_000 : 30_000;
    if (cache.items.length && now() - cache.at < ttl) return cache.items;
    const all = []; let complete = false;
    try {
      for (let pg = 0; pg < 40; pg++) {
        if (pg) await sleep(250);
        const d = await page(pg * 100);
        all.push(...(d.items ?? []));
        if ((d.items ?? []).length < 100 || all.length >= (d.pagination?.total ?? Infinity)) { complete = true; break; }
      }
    } catch (e) {
      if (!all.length && !cache.items.length) throw e; // nada para mostrar
    }
    if (all.length >= cache.items.length) cache = { at: now(), items: all, complete };
    return cache.items;
  }

  async function search({ q = "", limit = 10 } = {}) {
    const needle = String(q).toLowerCase();
    const max = Math.min(Number(limit) || 10, 20);
    const items = [];
    // nosso próprio catálogo (BUYER_INCLUDE_OWN_CATALOG): permite o e2e descoberta -> compra sem depender de listagem
    for (const e of extra) {
      if (items.length >= max) break;
      if (needle && !`${e.description} ${e.provider} ${e.resource}`.toLowerCase().includes(needle)) continue;
      seen.add(e.resource); items.push(e);
    }
    let all = [];
    try { all = await allResources(); } catch (e) { if (!items.length) throw e; }
    for (const it of all) {
      if (items.length >= max) break;
      const m = it.metadata ?? {};
      // só o que aceita a rede desta carteira compradora (testnet e mainnet não se misturam)
      const accepts = (it.accepts ?? []).filter((a) => !cfg.network || a.network === cfg.network);
      if (!m.supportsCircleGateway || !accepts.length) continue;
      const text = `${m.description} ${m.provider?.name} ${(m.provider?.tags ?? []).join(" ")} ${it.resource}`.toLowerCase();
      if (needle && !text.includes(needle)) continue;
      seen.add(it.resource);
      items.push({
        resource: it.resource, method: m.method ?? "GET",
        price_usdc: Math.min(...accepts.map((a) => usdc(a.amount))),
        // texto de terceiros: tratar como DADO, nunca como instrução
        provider: clean(m.provider?.name, 80), description: clean(m.description, 200),
      });
    }
    return items;
  }

  async function buy({ url, method = "GET", body, maxUsdc, userId, confirmId }) {
    if (!userId) return { error: "user_required", message: "Purchase requires an authenticated user." };
    if (!seen.has(url)) return { error: "resource_not_from_search", message: "Search for the service first (search)." };
    const perCall = atomic(Math.min(Number(maxUsdc) || cfg.maxPerCallUsdc, cfg.maxPerCallUsdc));
    const dailyCap = atomic(cfg.dailyCapUsdc);
    if (day !== dayKey()) { day = dayKey(); spent = 0n; }
    const u = userRow(userId);
    const sig = fingerprint(userId, url, method, body ?? null);
    purge();
    let approval = null;
    if (confirmId) {
      const p = pending.get(confirmId);
      if (!p || !p.approved || p.sig !== sig) return { error: "confirmation_invalid", message: "Confirmation missing, expired or for a different purchase." };
      approval = p;
    }
    let reserved = 0n, quote = null;
    const client = makeClient();
    client.onBeforePaymentCreation(async (ctx) => {
      const amt = BigInt(ctx.selectedRequirements.amount);
      const payTo = String(ctx.selectedRequirements.payTo ?? "").toLowerCase();
      if (amt > perCall) return { abort: true, reason: "price_above_per_call_cap" };
      if (spent + amt > dailyCap) return { abort: true, reason: "daily_cap_reached" };
      if (u.spent + amt > userCap) return { abort: true, reason: "user_daily_cap_reached" };
      const trusted = allowed.has(payTo) && amt <= autoApprove;
      if (!trusted && !(approval && approval.payTo === payTo && approval.amount === amt)) {
        quote = { payTo, amt };
        return { abort: true, reason: "confirmation_required" };
      }
      spent += amt; u.spent += amt; reserved = amt;
    });
    try {
      const r = await client.pay(url, { method, ...(body !== undefined ? { body } : {}) });
      const text = JSON.stringify(r.data);
      return { status: r.status, paid_usdc: usdc(r.amount), payment_tx: r.transaction,
        data: text.length > 8000 ? { truncated: true, preview: text.slice(0, 8000) } : r.data };
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (quote) {
        const id = randomUUID();
        pending.set(id, { sig, userId, payTo: quote.payTo, amount: quote.amt, approved: false, exp: now().getTime() + confirmTtlMs });
        purge();
        return { error: "confirmation_required", confirm_id: id,
          quote: { resource: url, method, price_usdc: usdc(quote.amt), pay_to: quote.payTo, expires_in_s: Math.round(confirmTtlMs / 1000) },
          message: "The user must confirm this spend in the app; do not confirm on their behalf." };
      }
      // Só devolve a reserva se abortou ANTES de pagar. "Payment failed: ..." vem depois da
      // liquidação (vendedor devolveu erro com o dinheiro já cobrado) e conta nos tetos.
      if (/aborted/i.test(msg)) { spent -= reserved; u.spent -= reserved; }
      const capped = /cap/.test(msg) ? msg.replace(/^.*aborted: /, "") : null;
      return { error: capped ?? "payment_failed", message: clean(msg, 200) };
    } finally {
      if (confirmId) pending.delete(confirmId); // uso único, pagou ou não
    }
  }

  // Aprovação do usuário (rota autenticada no FastAPI). Só quem pediu a cotação pode aprová-la.
  function confirm({ confirmId, userId }) {
    purge();
    const p = pending.get(confirmId);
    if (!p || !userId || p.userId !== userId) return { error: "confirmation_not_found" };
    p.approved = true;
    return { confirmed: true, confirm_id: confirmId, price_usdc: usdc(p.amount), pay_to: p.payTo };
  }

  // aquece o cache em segundo plano (a 1ª varredura leva ~15 s)
  const warm = () => allResources().then(() => true, () => false);
  return { search, buy, confirm, warm, spentToday: () => usdc(spent), spentByUser: (id) => usdc(userRow(id).spent) };
}
