// Testes do waitlist.gs com os serviços do Google simulados.
// Rodar: node --test landing/apps-script/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('./waitlist.gs', import.meta.url), 'utf8');

/** Aba fake: `cells[r][c]` guarda o que foi escrito; o display tira o apóstrofo como o Sheets. */
function fakeSheet() {
  const cells = [];
  const display = (v) => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : String(v ?? ''));
  const lastRow = () => cells.length;
  let maxRows = 1000;
  const range = (r, c, nr = 1, nc = 1) => ({
    getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => display(cells[r - 1 + i]?.[c - 1 + j]))),
    setValues(vals) {
      vals.forEach((row, i) => { cells[r - 1 + i] ||= []; row.forEach((v, j) => { cells[r - 1 + i][c - 1 + j] = v; }); });
      return this;
    },
    setFontWeight() { return this; },
    getDisplayValue: () => display(cells[r - 1]?.[c - 1]),
    createTextFinder(text) {
      const f = { matchCase: () => f, matchEntireCell: () => f, findNext() {
        for (let i = r; i < r + nr; i++) {
          if (display(cells[i - 1]?.[c - 1]).toLowerCase() === text.toLowerCase()) return { getRow: () => i };
        }
        return null;
      } };
      return f;
    },
  });
  return {
    cells, display,
    getLastRow: lastRow,
    getMaxRows: () => maxRows,
    insertRowsAfter: (_after, n) => { maxRows += n; },
    getRange: range,
    setFrozenRows() {},
    appendRow(row) { cells.push([...row]); },
  };
}

function load({ props = {}, lockFree = true, sheetThrows = false } = {}) {
  const store = { ...props };
  const cache = new Map();
  const sheet = fakeSheet();
  const logs = [];
  const ctx = {
    console: { warn: (m) => logs.push(m), error: (m) => logs.push(m), log() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => ({ ...store }),
      getProperty: (k) => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = v; },
      deleteProperty: (k) => { delete store[k]; },
    }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => lockFree, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }),
    },
    Utilities: {
      formatDate: (d, _tz, fmt) => (fmt === 'yyyy-MM-dd' ? '2026-10-10' : '2026-10-10 14:03'),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_a, s) => [...createHash('sha256').update(s).digest()],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: () => { if (sheetThrows) throw new Error('Sheet boom: internal detail'); return sheet; },
      insertSheet: () => sheet,
    }) },
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  const post = (body) => {
    const contents = typeof body === 'string' ? body : JSON.stringify(body);
    return JSON.parse(ctx.doPost({ postData: { contents } }).body).status;
  };
  const postRaw = (e) => JSON.parse(ctx.doPost(e).body).status;
  return { post, postRaw, sheet, store, logs, rows: () => sheet.cells.slice(1).map((r) => r.map(sheet.display)) };
}

const VALID = {
  name: 'Ana  Lima', email: ' Ana@Example.com ', role: 'creator', main_platform: 'tiktok',
  handles: { x: '@ana', instagram: '', tiktok: '@ana.tt', telegram: '', youtube: '' },
  audience_size: '10k-100k', has_company: true, company_name: 'Ana Studio.io',
  target_audience: 'Gen Z', country: 'Brazil', referral_source: 'Event / hackathon', website: '', t: 8000,
};

test('inscrição válida vira linha com cabeçalho, rótulos legíveis e e-mail normalizado', () => {
  const w = load();
  assert.equal(w.post(VALID), 'ok');
  assert.deepEqual(w.sheet.cells[0].slice(0, 5), ['Signed up (BRT)', 'Last updated (BRT)', 'Name', 'Email', 'Profile']);
  assert.deepEqual(w.sheet.cells[0].slice(17), ['Contacted', 'Notes']);
  assert.deepEqual(w.rows(), [[
    '2026-10-10 14:03', '2026-10-10 14:03', 'Ana Lima', 'ana@example.com', 'Content creator', 'TikTok',
    '@ana', '—', '@ana.tt', '—', '—', '10K–100K', 'Yes', 'Ana Studio.io', 'Gen Z', 'Brazil', 'Event / hackathon',
  ]]);
});

test('todo valor é gravado como texto (apóstrofo): fórmula, número e data não são interpretados', () => {
  const w = load();
  w.post({ ...VALID, target_audience: '=IMPORTRANGE("x","y")', handles: { x: '+5511999999999' } });
  const raw = w.sheet.cells[1];
  assert.equal(raw[14], '\'=IMPORTRANGE("x","y")');
  assert.equal(raw[6], "'+5511999999999");
  assert.equal(raw[0], "'2026-10-10 14:03");
  assert.ok(raw.every((v) => v.startsWith("'")));
});

test('reenvio do mesmo e-mail atualiza a linha e preserva "Inscrito em"', () => {
  const w = load();
  w.post(VALID);
  w.sheet.cells[1][0] = "'2026-10-01 09:00";
  assert.equal(w.post({ ...VALID, email: 'ANA@example.com', role: 'brand', has_company: false }), 'ok');
  const rows = w.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], '2026-10-01 09:00');
  assert.equal(rows[0][4], 'Brand / company');
  assert.equal(rows[0][12], 'No');
  assert.equal(rows[0][13], '—'); // sem empresa, nome da empresa some
});

test('bots (honeypot ou rápido demais) recebem "ok" mas nada é gravado', () => {
  const w = load();
  assert.equal(w.post({ ...VALID, website: 'http://spam' }), 'ok');
  assert.equal(w.post({ ...VALID, t: 500 }), 'ok');
  assert.equal(w.post({ ...VALID, t: 'abc' }), 'ok');
  assert.equal(w.post({ ...VALID, t: undefined }), 'ok');
  assert.equal(w.sheet.cells.length, 0);
});

const BAD = {
  'e-mail inválido': { email: 'nope' },
  'e-mail com espaço': { email: 'a b@x.com' },
  'perfil desconhecido': { role: 'admin' },
  'perfil __proto__': { role: '__proto__' },
  'perfil constructor': { role: 'constructor' },
  'rede fora da lista': { main_platform: 'myspace' },
  'país fora da lista': { country: 'Atlantis' },
  'origem fora da lista': { referral_source: '<script>' },
  'audiência fora da lista': { audience_size: 'toString' },
  'link no nome': { name: 'Promo www.spam.ru' },
  'URL na empresa': { company_name: 'https://spam.example' },
  'nome vazio': { name: '   ' },
  'nome gigante': { name: 'x'.repeat(121) },
  'público-alvo gigante': { target_audience: 'x'.repeat(1001) },
  'handle como objeto': { handles: { x: { evil: 1 } } },
  'has_company como texto': { has_company: 'yes' },
  'nome como objeto': { name: { toString: 'x' } },
};
for (const [label, patch] of Object.entries(BAD)) {
  test(`recusa: ${label}`, () => {
    const w = load();
    assert.equal(w.post({ ...VALID, ...patch }), 'invalid');
    assert.equal(w.sheet.cells.length, 0);
  });
}

test('recusa corpo malformado, array e corpo gigante sem quebrar', () => {
  const w = load();
  assert.equal(w.post('{not json'), 'invalid');
  assert.equal(w.post('[1,2]'), 'invalid');
  assert.equal(w.post('null'), 'invalid');
  assert.equal(w.post(JSON.stringify({ ...VALID, pad: 'x'.repeat(7000) })), 'invalid');
});

test('sem postData (ou sem evento) não quebra', () => {
  const w = load();
  assert.equal(w.postRaw(undefined), 'invalid');
  assert.equal(w.postRaw({}), 'invalid');
  assert.equal(w.postRaw({ postData: { contents: 42 } }), 'invalid');
  assert.equal(w.post(''), 'invalid');
});

test('caracteres de controle e de inversão de texto são removidos', () => {
  const w = load();
  w.post({ ...VALID, name: 'Ana\u0000‮ Lima\n\t' });
  assert.equal(w.rows()[0][2], 'Ana Lima');
});

test('limite global por minuto', () => {
  const w = load({ props: { GLOBAL_PER_MINUTE: '2' } });
  assert.equal(w.post({ ...VALID, email: 'a@x.io' }), 'ok');
  assert.equal(w.post({ ...VALID, email: 'b@x.io' }), 'ok');
  assert.equal(w.post({ ...VALID, email: 'c@x.io' }), 'rate_limited');
  assert.equal(w.rows().length, 2);
});

test('limite por e-mail não afeta outros e-mails', () => {
  const w = load({ props: { PER_EMAIL_PER_HOUR: '2' } });
  w.post(VALID); w.post(VALID);
  assert.equal(w.post(VALID), 'rate_limited');
  assert.equal(w.post({ ...VALID, email: 'outra@x.io' }), 'ok');
});

test('teto diário', () => {
  const w = load({ props: { DAILY_LIMIT: '1', 'count:2026-10-09': '999' } });
  assert.equal(w.post(VALID), 'ok');
  assert.equal(w.post({ ...VALID, email: 'b@x.io' }), 'rate_limited');
  assert.ok(!('count:2026-10-09' in w.store), 'contador de dias antigos é limpo');
});

test('limite configurado com valor inválido usa o padrão (não desliga a proteção)', () => {
  const w = load({ props: { GLOBAL_PER_MINUTE: 'abc', DAILY_LIMIT: '0', PER_EMAIL_PER_HOUR: '-5' } });
  for (let i = 0; i < 5; i++) assert.equal(w.post({ ...VALID, email: `u${i}@x.io` }), 'ok');
  assert.equal(w.post({ ...VALID, email: 'u0@x.io' }), 'ok');
});

test('WAITLIST_OPEN=false fecha a waitlist', () => {
  const w = load({ props: { WAITLIST_OPEN: 'false' } });
  assert.equal(w.post(VALID), 'closed');
  assert.equal(w.sheet.cells.length, 0);
});

test('lock ocupado responde "busy" sem gravar', () => {
  const w = load({ lockFree: false });
  assert.equal(w.post(VALID), 'busy');
  assert.equal(w.sheet.cells.length, 0);
});

test('erro interno não vaza detalhes para o navegador', () => {
  const w = load({ sheetThrows: true });
  assert.equal(w.post(VALID), 'error');
  assert.ok(w.logs.some((l) => l.includes('Sheet boom')));
});

test('aceita o payload mínimo exatamente como a landing envia (campos vazios como null)', () => {
  const w = load();
  const fromLanding = {
    name: 'Bia', email: 'bia@x.io', role: 'other', main_platform: null,
    handles: { x: '', instagram: '', tiktok: '', telegram: '', youtube: '' },
    audience_size: null, has_company: false, company_name: null, target_audience: null,
    country: null, referral_source: null, website: null, t: 5000,
  };
  assert.equal(w.post(fromLanding), 'ok');
  assert.deepEqual(w.rows()[0].slice(2, 6), ['Bia', 'bia@x.io', 'Other', '—']);
  assert.equal(w.rows()[0][12], 'No');
  assert.ok(w.rows()[0].slice(6, 12).every((v) => v === '—'));
});

test('nova inscrição entra logo após o último e-mail, mesmo com checkbox/nota do time mais abaixo', () => {
  const w = load();
  w.post({ ...VALID, email: 'a@x.io' });
  w.sheet.cells[9] = Array(17).fill('').concat(['FALSE', "'note far below"]); // linha 10: só colunas do time
  w.post({ ...VALID, email: 'b@x.io' });
  assert.equal(w.sheet.display(w.sheet.cells[2][3]), 'b@x.io'); // linha 3, não linha 11
});

test('aba cheia ganha linhas novas antes de gravar', () => {
  const w = load();
  w.post({ ...VALID, email: 'a@x.io' });
  const before = w.sheet.getMaxRows();
  for (let i = 0; i < before; i++) w.sheet.cells.push(Array(17).fill("'x").map((v, j) => (j === 3 ? `'u${i}@x.io` : v)));
  assert.equal(w.post({ ...VALID, email: 'last@x.io' }), 'ok');
  assert.ok(w.sheet.getMaxRows() > before);
});

test('etapa 1 (sem resposta de empresa) grava "—"; etapa 2 completa a mesma linha', () => {
  const w = load();
  const step1 = {
    name: 'Cris', email: 'cris@x.io', role: 'creator', main_platform: null,
    handles: { x: '', instagram: '', tiktok: '', telegram: '', youtube: '' },
    audience_size: null, has_company: null, company_name: null, target_audience: null,
    country: null, referral_source: null, website: null, t: 4000,
  };
  assert.equal(w.post(step1), 'ok');
  assert.equal(w.rows()[0][12], '—');
  assert.equal(w.post({ ...step1, main_platform: 'instagram', handles: { ...step1.handles, instagram: '@cris' }, has_company: false, t: 20000 }), 'ok');
  const rows = w.rows();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0][5], rows[0][7], rows[0][12]], ['Instagram', '@cris', 'No']);
});

test('empresa omitida (formulário sem resposta) grava "—"', () => {
  const w = load();
  const { has_company, company_name, ...noCompany } = VALID;
  assert.equal(w.post(noCompany), 'ok');
  assert.deepEqual(w.rows()[0].slice(12, 14), ['—', '—']);
});
