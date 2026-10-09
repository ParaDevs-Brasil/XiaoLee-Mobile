// Lado comprador: descobre serviços no marketplace da Circle e paga via GatewayClient.
// A chave do comprador só existe aqui (env), nunca no modelo. Tetos duros por chamada e por dia.
// ponytail: gasto diário em memória (zera ao reiniciar); persistir no Postgres se o volume crescer.
const DISCOVERY = "https://api.circle.com/v2/x402/discovery/resources";
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, n);
const usdc = (atomic) => Number(BigInt(atomic)) / 1e6;

export function createBuyer(cfg, { makeClient, fetchFn = fetch, now = () => new Date() }) {
  const seen = new Set(); // recursos devolvidos pela busca: só esses podem ser comprados
  let day = "", spent = 0n;
  const dayKey = () => now().toISOString().slice(0, 10);

  // O Discovery tem milhares de recursos (limit máx. 100 por página): varre as páginas e guarda 5 min.
  let cache = { at: 0, items: [] };
  async function allResources() {
    if (cache.items.length && now() - cache.at < 300_000) return cache.items;
    const all = [];
    for (let page = 0; page < 40; page++) {
      const r = await fetchFn(`${DISCOVERY}?limit=100&offset=${page * 100}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`discovery_${r.status}`);
      const d = await r.json();
      all.push(...(d.items ?? []));
      if ((d.items ?? []).length < 100 || all.length >= (d.pagination?.total ?? Infinity)) break;
    }
    cache = { at: now(), items: all };
    return all;
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

  return { search, buy, spentToday: () => usdc(spent) };
}
