// Lado comprador: descobre serviços no marketplace da Circle e paga via GatewayClient.
// A chave do comprador só existe aqui (env), nunca no modelo. Tetos duros por chamada e por dia.
// ponytail: gasto diário em memória (zera ao reiniciar); persistir no Postgres se o volume crescer.
const DISCOVERY = "https://api.circle.com/v2/x402/discovery/resources";
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, n);
const usdc = (atomic) => Number(BigInt(atomic)) / 1e6;

export function createBuyer(cfg, { makeClient, fetchFn = fetch, now = () => new Date(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const seen = new Set(); // recursos devolvidos pela busca: só esses podem ser comprados
  let day = "", spent = 0n;
  const dayKey = () => now().toISOString().slice(0, 10);

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
    const items = [];
    for (const it of await allResources()) {
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
      if (items.length >= Math.min(Number(limit) || 10, 20)) break;
    }
    return items;
  }

  async function buy({ url, method = "GET", body, maxUsdc }) {
    if (!seen.has(url)) return { error: "resource_not_from_search", message: "Busque o serviço primeiro (search)." };
    const perCall = BigInt(Math.round(Math.min(Number(maxUsdc) || cfg.maxPerCallUsdc, cfg.maxPerCallUsdc) * 1e6));
    const dailyCap = BigInt(Math.round(cfg.dailyCapUsdc * 1e6));
    if (day !== dayKey()) { day = dayKey(); spent = 0n; }
    let reserved = 0n;
    const client = makeClient();
    client.onBeforePaymentCreation(async (ctx) => {
      const amt = BigInt(ctx.selectedRequirements.amount);
      if (amt > perCall) return { abort: true, reason: "price_above_per_call_cap" };
      if (spent + amt > dailyCap) return { abort: true, reason: "daily_cap_reached" };
      spent += amt; reserved = amt;
    });
    try {
      const r = await client.pay(url, { method, ...(body !== undefined ? { body } : {}) });
      const text = JSON.stringify(r.data);
      return { status: r.status, paid_usdc: usdc(r.amount), payment_tx: r.transaction,
        data: text.length > 8000 ? { truncated: true, preview: text.slice(0, 8000) } : r.data };
    } catch (e) {
      const msg = String(e?.message ?? e);
      // Só devolve a reserva se abortou ANTES de pagar. "Payment failed: ..." vem depois da
      // liquidação (vendedor devolveu erro com o dinheiro já cobrado) e conta no teto diário.
      if (/aborted/i.test(msg)) spent -= reserved;
      const capped = /cap/.test(msg) ? msg.replace(/^.*aborted: /, "") : null;
      return { error: capped ?? "payment_failed", message: clean(msg, 200) };
    }
  }

  // aquece o cache em segundo plano (a 1ª varredura leva ~15 s)
  const warm = () => allResources().then(() => true, () => false);
  return { search, buy, warm, spentToday: () => usdc(spent) };
}
