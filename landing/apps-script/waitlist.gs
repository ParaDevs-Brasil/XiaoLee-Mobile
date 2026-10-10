// A anotação abaixo faz a autorização pedir acesso só a ESTA planilha, não a todas as da conta.
/** @OnlyCurrentDoc */

/**
 * Xiaolee — Waitlist (Google Apps Script, vinculado à planilha).
 *
 * Recebe o formulário "Join waitlist" da landing (landing/index.html) e grava na aba
 * "Registration": uma linha por e-mail (reenviar atualiza a linha, não duplica). Campo não
 * preenchido aparece como "—". A planilha é toda em inglês (quem lê é o time e parceiros).
 *
 * `setup` (menu Waitlist → Refresh layout & summary) formata a aba Registration e monta a aba
 * Summary com números, tabelas e gráficos. Pode rodar quantas vezes quiser.
 * Passo a passo de instalação: docs/workflows/WAITLIST_SHEETS.md.
 *
 * A URL do web app é pública por natureza (o navegador de qualquer visitante chama ela),
 * então tudo que chega aqui é tratado como hostil:
 *
 *   1. Interruptor     — Propriedade WAITLIST_OPEN=false fecha a waitlist na hora, sem reimplantar.
 *   2. Tamanho         — corpo acima de MAX_BODY_BYTES é recusado antes do JSON.parse.
 *   3. Anti-bot        — honeypot (`website`) e tempo mínimo de preenchimento (`t`): bot é
 *                        descartado em silêncio (responde "ok", não ensina o bot a contornar).
 *   4. Validação       — só campos conhecidos; listas fechadas para perfil/rede/audiência/país/
 *                        origem; limite de tamanho por campo; e-mail validado; caracteres de
 *                        controle removidos; link em nome/empresa é recusado (padrão de spam).
 *   5. Limites         — por e-mail (reenvios), global por minuto e teto diário. O Apps Script
 *                        não vê o IP de quem chama, então o limite é da waitlist inteira: um
 *                        ataque no máximo enche o teto do dia, nunca a planilha.
 *   6. Concorrência    — LockService: dois envios ao mesmo tempo não duplicam nem se sobrescrevem.
 *   7. Planilha        — todo valor é gravado com apóstrofo na frente (marcador de texto do
 *                        Sheets, fica invisível): nada que o visitante digita vira fórmula,
 *                        número ou data.
 *   8. Sem vazamento   — o web app só escreve; não existe rota que leia a planilha. Erros
 *                        internos nunca voltam para o navegador (ficam em Execuções).
 */

// ── Configuração ─────────────────────────────────────────────────────────────
// Limites podem ser trocados em Configurações do projeto → Propriedades do script,
// sem mexer no código (ex.: subir GLOBAL_PER_MINUTE antes de um evento).
const DEFAULTS = {
  WAITLIST_OPEN: "true",
  GLOBAL_PER_MINUTE: "60", // cada pessoa envia até 2x (etapa 1 + perfil da etapa 2)
  DAILY_LIMIT: "1000",
  PER_EMAIL_PER_HOUR: "5",
  MIN_FILL_MS: "3000",
};

const SHEET_NAME = "Registration";
const SUMMARY_NAME = "Summary";
const TZ = "America/Sao_Paulo";
const MAX_BODY_BYTES = 6000;
const EMPTY = "—"; // campo não preenchido

// Colunas A:Q — o script escreve nelas. Não reordenar: EMAIL_COL e o Summary dependem da ordem.
const HEADER = [
  "Signed up (BRT)",
  "Last updated (BRT)",
  "Name",
  "Email",
  "Profile",
  "Main network",
  "X",
  "Instagram",
  "TikTok",
  "Telegram",
  "YouTube",
  "Audience size",
  "Has company",
  "Company",
  "Target audience",
  "Country",
  "Referral source",
];
// Colunas R:S — do time; o script nunca escreve nelas (só cria o cabeçalho no setup).
const TEAM_HEADER = ["Contacted", "Notes"];
const EMAIL_COL = 4; // D

// Listas fechadas — precisam bater com os <option>/<input value> do formulário da landing.
const ROLES = {
  creator: "Content creator",
  brand: "Brand / company",
  agency: "Agency",
  other: "Other",
};
const PLATFORMS = {
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  telegram: "Telegram",
  other: "Other",
};
const AUDIENCES = {
  "<1k": "< 1K",
  "1k-10k": "1K–10K",
  "10k-100k": "10K–100K",
  "100k-1m": "100K–1M",
  "1m+": "1M+",
};
const COUNTRIES = [
  "Brazil",
  "Portugal",
  "United States",
  "Mexico",
  "Argentina",
  "Colombia",
  "Chile",
  "Spain",
  "United Kingdom",
  "Canada",
  "Other",
];
const REFERRALS = [
  "X (Twitter)",
  "Instagram",
  "TikTok",
  "Telegram",
  "Friend / referral",
  "Event / hackathon",
  "Other",
];
const HANDLES = ["x", "instagram", "tiktok", "telegram", "youtube"];

const EMAIL_RE =
  /^[^@\s"'<>()[\]\\,;:]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const LINK_RE = /(https?:\/\/|www\.|\.(com|net|org|ru|xyz|io|link|click)\b)/i; // nome de pessoa não tem domínio
const URL_RE = /(https?:\/\/|www\.)/i; // empresa pode se chamar "algo.io"; link completo não

// ── Entrada ──────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    return reply_(handle_(e));
  } catch (err) {
    console.error(
      "[waitlist] erro interno: " + (err && err.stack ? err.stack : err),
    );
    return reply_("error");
  }
}

function handle_(e) {
  const cfg = config_();
  if (cfg.WAITLIST_OPEN !== "true") return "closed";

  const raw =
    e && e.postData && typeof e.postData.contents === "string"
      ? e.postData.contents
      : "";
  if (!raw || raw.length > MAX_BODY_BYTES) return reject_("tamanho do corpo");

  let body;
  try {
    body = JSON.parse(raw);
  } catch (_) {
    return reject_("json inválido");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return reject_("corpo não é objeto");

  // Bots: responde ok e descarta.
  if (clean_(body.website, 200)) {
    console.warn("[waitlist] honeypot preenchido");
    return "ok";
  }
  const t = Number(body.t);
  if (!isFinite(t) || t < cfg.MIN_FILL_MS) {
    console.warn("[waitlist] envio rápido demais: " + t);
    return "ok";
  }

  const v = validate_(body);
  if (!v) return "invalid";

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return "busy";
  try {
    const limited = takeQuota_(cfg, v.email);
    if (limited) {
      console.warn("[waitlist] limite atingido: " + limited);
      return "rate_limited";
    }
    upsert_(v);
  } finally {
    lock.releaseLock();
  }
  return "ok";
}

function reply_(status) {
  return ContentService.createTextOutput(
    JSON.stringify({ status: status }),
  ).setMimeType(ContentService.MimeType.JSON);
}

function reject_(why) {
  console.warn("[waitlist] recusado: " + why);
  return "invalid";
}

function config_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const out = {};
  Object.keys(DEFAULTS).forEach(function (k) {
    out[k] = String(props[k] || DEFAULTS[k]).trim();
  });
  // Limite numérico inválido (vazio, texto, 0, negativo) volta ao padrão em vez de desligar a proteção.
  Object.keys(DEFAULTS).forEach(function (k) {
    if (k === "WAITLIST_OPEN") return;
    const n = Number(out[k]);
    out[k] = isFinite(n) && n > 0 ? n : Number(DEFAULTS[k]);
  });
  return out;
}

function has_(map, key) {
  return (
    typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key)
  );
}

// ── Validação ────────────────────────────────────────────────────────────────

/** Texto limpo: sem caracteres de controle, espaços colapsados. null se passar de `max`. */
function clean_(v, max) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean")
    return null;
  const s = String(v)
    .replace(
      /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? null : s;
}

/** Devolve a inscrição pronta para a planilha, ou null se algo for inválido. */
function validate_(b) {
  const name = clean_(b.name, 120);
  const email = clean_(b.email, 254);
  if (!name || !email) return null;
  const emailLc = email.toLowerCase();
  if (!EMAIL_RE.test(emailLc)) return null;
  if (LINK_RE.test(name)) return null;

  if (!has_(ROLES, b.role)) return null;
  const role = ROLES[b.role];

  const pick = function (map, key) {
    if (key === undefined || key === null || key === "") return "";
    return has_(map, key) ? map[key] : null;
  };
  const oneOf = function (list, value) {
    if (value === undefined || value === null || value === "") return "";
    return list.indexOf(value) >= 0 ? value : null;
  };

  const platform = pick(PLATFORMS, b.main_platform);
  const audience = pick(AUDIENCES, b.audience_size);
  const country = oneOf(COUNTRIES, b.country);
  const referral = oneOf(REFERRALS, b.referral_source);
  if (
    platform === null ||
    audience === null ||
    country === null ||
    referral === null
  )
    return null;

  // true/false, ou sem resposta (a etapa 1 do formulário não pergunta)
  if (
    typeof b.has_company !== "boolean" &&
    b.has_company !== undefined &&
    b.has_company !== null
  )
    return null;
  const hasCompany = b.has_company === true;
  const company = hasCompany ? clean_(b.company_name, 120) : "";
  if (company === null || URL_RE.test(company)) return null;

  const audienceText = clean_(b.target_audience, 1000);
  if (audienceText === null) return null;

  const h =
    b.handles && typeof b.handles === "object" && !Array.isArray(b.handles)
      ? b.handles
      : {};
  const handles = [];
  for (let i = 0; i < HANDLES.length; i++) {
    const value = clean_(h[HANDLES[i]], 100);
    if (value === null) return null;
    handles.push(value);
  }

  return {
    email: emailLc,
    fields: [name, emailLc, role, platform].concat(handles, [
      audience,
      hasCompany ? "Yes" : b.has_company === false ? "No" : "",
      company,
      audienceText,
      country,
      referral,
    ]),
  };
}

// ── Limites ──────────────────────────────────────────────────────────────────

/** Consome uma unidade de cada limite. Devolve o nome do limite estourado, ou '' se passou. */
function takeQuota_(cfg, email) {
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();
  const now = new Date();

  const minuteKey = "rl:min:" + Math.floor(now.getTime() / 60000);
  const hourKey =
    "rl:mail:" + Math.floor(now.getTime() / 3600000) + ":" + digest_(email);
  const dayKey = "count:" + Utilities.formatDate(now, TZ, "yyyy-MM-dd");

  const perMinute = Number(cache.get(minuteKey) || 0);
  const perEmail = Number(cache.get(hourKey) || 0);
  const perDay = Number(props.getProperty(dayKey) || 0);

  if (perMinute >= cfg.GLOBAL_PER_MINUTE) return "global/minuto";
  if (perEmail >= cfg.PER_EMAIL_PER_HOUR) return "e-mail/hora";
  if (perDay >= cfg.DAILY_LIMIT) return "diário";

  cache.put(minuteKey, String(perMinute + 1), 120);
  cache.put(hourKey, String(perEmail + 1), 3700);
  props.setProperty(dayKey, String(perDay + 1));
  if (perDay === 0) cleanupDayCounters_(props, dayKey);
  return "";
}

function cleanupDayCounters_(props, keep) {
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k.indexOf("count:") === 0 && k !== keep) props.deleteProperty(k);
  });
}

function digest_(s) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s),
  );
}

// ── Planilha: gravação ───────────────────────────────────────────────────────

/** Apóstrofo = "isto é texto" para o Sheets (não aparece na célula): "=…" não vira fórmula,
 *  "+55…" não vira número, "2026-10-10" não vira data. Vazio vira "—". */
function asText_(v) {
  return "'" + (v === "" ? EMPTY : v);
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME, 0);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADER.length + TEAM_HEADER.length)
      .setValues([HEADER.concat(TEAM_HEADER)])
      .setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Última linha com e-mail (coluna D). Não usa getLastRow(): checkbox/nota do time numa linha
 *  lá embaixo empurraria a próxima inscrição para depois dela. */
function lastDataRow_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return 1;
  const col = sh.getRange(1, EMAIL_COL, last, 1).getDisplayValues();
  for (let i = col.length - 1; i >= 1; i--) if (col[i][0] !== "") return i + 1;
  return 1;
}

function upsert_(v) {
  const sh = sheet_();
  const when = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm");
  const values = v.fields.map(asText_);
  const stamp = asText_(when);

  const last = lastDataRow_(sh);
  let row = 0;
  if (last >= 2) {
    const found = sh
      .getRange(2, EMAIL_COL, last - 1, 1)
      .createTextFinder(v.email)
      .matchCase(false)
      .matchEntireCell(true)
      .findNext();
    if (found) row = found.getRow();
  }

  if (row) {
    const createdAt = asText_(sh.getRange(row, 1).getDisplayValue() || when);
    sh.getRange(row, 1, 1, HEADER.length).setValues([
      [createdAt, stamp].concat(values),
    ]);
  } else {
    row = last + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
    sh.getRange(row, 1, 1, HEADER.length).setValues([
      [stamp, stamp].concat(values),
    ]);
  }
}

// ── Planilha: layout e Summary (rodar pelo menu ou pelo editor) ──────────────

const PINK = "#d81b78";
const PINK_SOFT = "#fdf2f7";
const INK = "#1a1917";
const MUTED = "#9a968f";
const ROLE_COLORS = {
  "Content creator": "#fde3ef",
  "Brand / company": "#e9e4fb",
  Agency: "#e0f0fb",
  Other: "#efedea",
};
// Linhas antigas (antes da planilha ir para inglês).
const LEGACY = {
  "Criador de conteúdo": "Content creator",
  "Marca / empresa": "Brand / company",
  Agência: "Agency",
  Outro: "Other",
  Outra: "Other",
  Sim: "Yes",
  Não: "No",
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Waitlist")
    .addItem("Refresh layout & summary", "setup")
    .addToUi();
}

function setup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000); // não formata no meio de uma gravação
  try {
    const sh = sheet_();
    migrateRows_(sh);
    formatRegistration_(sh);
    buildSummary_(SpreadsheetApp.getActiveSpreadsheet());
  } finally {
    lock.releaseLock();
  }
}

/** Cabeçalho em inglês, rótulos antigos traduzidos, células vazias de A:Q viram "—". */
function migrateRows_(sh) {
  sh.getRange(1, 1, 1, HEADER.length + TEAM_HEADER.length).setValues([
    HEADER.concat(TEAM_HEADER),
  ]);
  const last = lastDataRow_(sh);
  if (last < 2) return;
  const range = sh.getRange(2, 1, last - 1, HEADER.length);
  const rows = range.getDisplayValues().map(function (r) {
    // linha sem e-mail não é inscrição: fica como está
    if (r[EMAIL_COL - 1] === "") return r.map(function (cell) { return cell === "" ? "" : "'" + cell; });
    return r.map(function (cell) {
      return asText_(Object.prototype.hasOwnProperty.call(LEGACY, cell) ? LEGACY[cell] : cell);
    });
  });
  range.setValues(rows);
}

function formatRegistration_(sh) {
  const cols = HEADER.length + TEAM_HEADER.length;
  const rows = sh.getMaxRows();
  const all = sh.getRange(1, 1, rows, cols);
  const body = sh.getRange(2, 1, rows - 1, cols);

  sh.setFrozenRows(1);
  sh.setFrozenColumns(0);
  sh.setRowHeight(1, 36);

  sh.getBandings().forEach(function (b) { b.remove(); });
  all
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(PINK)
    .setFirstRowColor("#ffffff")
    .setSecondRowColor("#faf8f5");

  sh.getRange(1, 1, 1, cols)
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setVerticalAlignment("middle")
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sh.getRange(1, HEADER.length + 1, 1, TEAM_HEADER.length).setBackground(INK);

  body
    .setFontFamily("Arial")
    .setFontSize(10)
    .setFontColor(INK)
    .setVerticalAlignment("middle")
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  [1, 2, 12, 13, 18].forEach(function (c) {
    sh.getRange(1, c, rows, 1).setHorizontalAlignment("center");
  });
  [15, 19].forEach(function (c) {
    sh.getRange(2, c, rows - 1, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  });

  const widths = [160, 160, 160, 230, 140, 115, 120, 120, 120, 120, 120, 110, 100, 160, 280, 120, 150, 95, 260];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  // Coluna "Contacted": checkbox para o time marcar quem já foi contatado.
  sh.getRange(2, HEADER.length + 1, rows - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build(),
  );

  const filter = sh.getFilter();
  if (filter) filter.remove();
  all.createFilter();

  const dataRange = sh.getRange(2, 1, rows - 1, HEADER.length);
  const rules = [
    // linha inteira esmaecida quando o time marca "Contacted"
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied("=$R2=TRUE")
      .setBackground("#eaf6ec")
      .setRanges([body])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(EMPTY)
      .setFontColor("#c9c5be")
      .setRanges([dataRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("Yes")
      .setFontColor("#1e7b3a")
      .setBold(true)
      .setRanges([sh.getRange(2, 13, rows - 1, 1)])
      .build(),
  ];
  Object.keys(ROLE_COLORS).forEach(function (label) {
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(label)
        .setBackground(ROLE_COLORS[label])
        .setRanges([sh.getRange(2, 5, rows - 1, 1)])
        .build(),
    );
  });
  sh.setConditionalFormatRules(rules);

  // Aviso (não bloqueio) para quem tentar editar à mão as colunas que o formulário preenche.
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (p.getDescription() === "waitlist-form") p.remove();
  });
  sh.getRange(1, 1, rows, HEADER.length)
    .protect()
    .setDescription("waitlist-form")
    .setWarningOnly(true);
}

/** Separadores de fórmula dependem do idioma da planilha: em inglês `,` entre argumentos e
 *  `,` entre colunas de {matriz}; em pt-BR (e outros com vírgula decimal) `;` e `\`. O Apps Script
 *  não traduz isso no setFormula, então testamos uma fórmula numa célula e vemos se ela calcula. */
function separators_(sheet) {
  const probe = sheet.getRange(1, sheet.getMaxColumns());
  probe.setFormula("=IF(TRUE(),1,0)");
  SpreadsheetApp.flush();
  const comma = probe.getDisplayValue() === "1";
  probe.clearContent();
  return comma ? { arg: ",", col: "," } : { arg: ";", col: "\\" };
}

/** Fórmula escrita com § (entre argumentos) e ¦ (entre colunas de matriz) → idioma da planilha.
 *  Vírgulas dentro do texto do QUERY ("select E, count(D)") não mudam: são da linguagem do QUERY. */
function formula_(tpl, sep) {
  return tpl.replace(/§/g, sep.arg).replace(/¦/g, sep.col);
}

function buildSummary_(ss) {
  let sum = ss.getSheetByName(SUMMARY_NAME);
  if (!sum) sum = ss.insertSheet(SUMMARY_NAME, 1);
  sum.getCharts().forEach(function (c) { sum.removeChart(c); });
  sum.getRange(1, 1, sum.getMaxRows(), sum.getMaxColumns()).breakApart();
  sum.clear();
  sum.clearConditionalFormatRules();
  sum.setHiddenGridlines(true);
  sum.setFrozenRows(0);

  const R = "'" + SHEET_NAME + "'!";
  const sep = separators_(sum);
  [180, 70, 28, 180, 70, 28, 180, 70, 28, 110, 70].forEach(function (w, i) {
    sum.setColumnWidth(i + 1, w);
  });
  sum.getRange("A:K").setFontFamily("Arial").setFontColor(INK).setVerticalAlignment("middle");

  sum.getRange("A1").setValue("Xiaolee waitlist").setFontSize(20).setFontWeight("bold");
  sum.getRange("A2")
    .setValue("Updates live as people sign up · times in Brasília (BRT) · “—” = left blank · refresh via menu Waitlist")
    .setFontColor(MUTED);
  sum.setRowHeight(1, 40);

  // ── Números (2 linhas × 3 cartões)
  const kpis = [
    ["A", 4, "Total sign-ups", "=COUNTA(" + R + "D2:D)"],
    ["D", 4, "Today", "=COUNTIF(" + R + 'A2:A§TEXT(TODAY()§"yyyy-mm-dd")&"*")'],
    ["G", 4, "Last 7 days", "=SUMPRODUCT(LEFT(" + R + 'A2:A§10)>=TEXT(TODAY()-6§"yyyy-mm-dd"))'],
    ["A", 7, "Content creators", "=COUNTIF(" + R + 'E2:E§"Content creator")'],
    ["D", 7, "With a company", "=COUNTIF(" + R + 'M2:M§"Yes")'],
    ["G", 7, "Contacted", "=COUNTIF(" + R + "R2:R§TRUE())"],
  ];
  kpis.forEach(function (k) {
    const col = k[0];
    const next = String.fromCharCode(col.charCodeAt(0) + 1);
    const card = sum.getRange(col + k[1] + ":" + next + (k[1] + 1));
    card.setBackground(PINK_SOFT);
    sum.getRange(col + k[1]).setValue(k[2]).setFontColor(MUTED).setFontSize(9).setFontWeight("bold");
    sum.getRange(col + (k[1] + 1) + ":" + next + (k[1] + 1)).merge();
    sum.getRange(col + (k[1] + 1)).setFormula(formula_(k[3], sep)).setFontSize(22).setFontWeight("bold").setFontColor(PINK).setHorizontalAlignment("left");
  });
  [5, 8].forEach(function (r) { sum.setRowHeight(r, 40); });

  // ── Tabelas
  const by = function (col, label) {
    return (
      "=IFERROR(QUERY(" + R + "A:Q§" +
      '"select ' + col + ", count(D) where D <> '' group by " + col +
      " order by count(D) desc label " + col + " '" + label + "', count(D) 'Sign-ups'\"§1)§" +
      '"No data yet")'
    );
  };
  const tables = [
    ["A10", "By profile", by("E", "Profile")],
    ["D10", "By main network", by("F", "Main network")],
    ["G10", "By audience size", by("L", "Audience size")],
    ["A21", "By country", by("P", "Country")],
    ["D21", "By referral source", by("Q", "Referral source")],
    ["G21", "With a company", by("M", "Has company")],
    [
      "J10",
      "Sign-ups per day",
      "=IFERROR(QUERY({ARRAYFORMULA(LEFT(" + R + "A2:A§10))¦" + R + "D2:D}§" +
        "\"select Col1, count(Col2) where Col2 <> '' group by Col1 order by Col1 desc label Col1 'Day', count(Col2) 'Sign-ups'\"§0)§" +
        '"No data yet")',
    ],
    [
      "A36",
      "Creators with 10K+ audience (newest first)",
      "=IFERROR(QUERY(" + R + "A:Q§" +
        "\"select C, D, F, L, I, H, G where E = 'Content creator' and (L = '10K–100K' or L = '100K–1M' or L = '1M+') order by A desc\"§1)§" +
        '"No creators with 10K+ yet")',
    ],
  ];
  tables.forEach(function (t) {
    const title = sum.getRange(t[0]);
    title.setValue(t[1]).setFontWeight("bold").setFontSize(11);
    const head = title.offset(1, 0, 1, t[0] === "A36" ? 7 : 2);
    head.setFontWeight("bold").setFontColor(MUTED).setFontSize(9)
      .setBorder(false, false, true, false, false, false, "#e2ded8", SpreadsheetApp.BorderStyle.SOLID);
    title.offset(1, 0).setFormula(formula_(t[2], sep));
  });
  sum.getRange("B11:B33").setHorizontalAlignment("right");
  sum.getRange("E11:E33").setHorizontalAlignment("right");
  sum.getRange("H11:H33").setHorizontalAlignment("right");
  sum.getRange("K11:K200").setHorizontalAlignment("right");

  // ── Gráficos (à direita das tabelas; se atualizam sozinhos)
  const chart = function (type, range, title, row, opts) {
    let b = sum.newChart().setChartType(type).addRange(sum.getRange(range)).setNumHeaders(1)
      .setPosition(row, 13, 0, 0)
      .setOption("title", title)
      .setOption("width", 480)
      .setOption("height", 280)
      .setOption("legend", { position: "right" })
      .setOption("colors", [PINK, "#7c5cd6", "#2f8fd6", "#e8a33d", "#3aa76d", "#9a968f"]);
    Object.keys(opts || {}).forEach(function (k) { b = b.setOption(k, opts[k]); });
    sum.insertChart(b.build());
  };
  chart(Charts.ChartType.PIE, "A11:B16", "Sign-ups by profile", 1, { pieHole: 0.45 });
  chart(Charts.ChartType.BAR, "D11:E18", "Main network", 16, { legend: { position: "none" } });
  chart(Charts.ChartType.COLUMN, "G11:H17", "Audience size", 31, { legend: { position: "none" } });
  chart(Charts.ChartType.BAR, "D22:E30", "Referral source", 46, { legend: { position: "none" } });
}
