#!/usr/bin/env node
/* REPORT CIO — engine ibrido + Structured Output (v127, STEP 4 del Master Refactoring).
   Genera in CI un REPORT DEL COMITATO DI INVESTIMENTO strutturato, senza intervento manuale.

   Perché "ibrido": riusa lo STESSO vm-harness di llm_critic/redteam per produrre il payload
   testuale reale di buildPrompt() (NAV, budget=cassa−ES95, R/R, MCR, stop ratchet, cinematica,
   track record) e lo ARRICCHISCE con "deep data" quantitativo calcolato DA data.json (nessun
   re-fetch di rete): CAGR ricavi/utili 4A dai financials già persistiti, EPS forward vs TTM,
   pendenze macro (Margin Debt, HY OAS) e %-da-ATH. Il contesto ibrido va a Gemini.

   Perché "stateless": una sola chiamata a Gemini, 2 messaggi — system = testata utente
   (config/prompt_header.txt), user = payload ibrido — temperature 0.1 e responseSchema nativo
   (Structured Output) con CIOReportSchema. Nessuna storia conversazionale: il "context carryover"
   del flusso manuale è eliminato per costruzione.

   Perché "validato": gli ordini del JSON generato passano le STESSE invarianti del red team
   (ticker esistente nel payload, 0<stop<limite≤prezzo entro il 30%, budget operativo rispettato).
   Se un ordine le viola, il report è RIFIUTATO (non scritto) e scatta l'alert WhatsApp: un LLM
   che allucina un limite folle non arriva mai al file letto dalla dashboard.

   ANTI-FRAGILE: exit 0 SEMPRE. Senza GEMINI_API_KEY fa no-op. Solo Node ≥18 (fetch globale).
   Uso: GEMINI_API_KEY=... node scripts/cio_report.mjs
        node scripts/cio_report.mjs --dry   (costruisce il contesto e stampa; non chiama/scrive/invia) */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "cio_report.json");
const DRY = process.argv.includes("--dry");
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
// La cassa non è persistita in data.json (è stato del browser): il report CI assume un default
// DICHIARATO nel meta, sovrascrivibile con CIO_CASH_EUR. È la stessa base del prompt in CI.
const CASH_EUR = Number(process.env.CIO_CASH_EUR || 28500);

/* ============================================================ 1) vm-harness → payload reale */
function el() {
  return {
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, dataset: {}, hidden: true, className: "", innerHTML: "", textContent: "", value: "",
    appendChild() {}, remove() {}, after() {}, focus() {}, click() {}, scrollIntoView() {},
    querySelector: () => el(), querySelectorAll: () => [], dispatchEvent() {}, closest: () => null, setAttribute() {},
  };
}
function buildLivePrompt() {
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  let header = null, diary = null;
  try { header = readFileSync(join(ROOT, "config", "prompt_header.txt"), "utf8"); } catch { /* fallback embedded */ }
  try { diary = readFileSync(join(ROOT, "config", "action_diary.json"), "utf8"); } catch { /* diario vuoto */ }
  const store = {}; if (header) store.prompt_header = header; if (diary) store.action_diary = diary;
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    document: { querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(), createElement: () => el(), addEventListener() {}, body: el() },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem() {}, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    navigator: { clipboard: {} }, fetch: () => Promise.reject(new Error("offline")),
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
    Event: class {}, MutationObserver: class { observe() {} },
  });
  vm.runInContext(src, ctx, { filename: "app.js" });
  const d = JSON.parse(readFileSync(join(ROOT, "data", "data.json"), "utf8").replace(/\bNaN\b/g, "null"));
  vm.runInContext(`DATA=${JSON.stringify(d)}; cashEur=${CASH_EUR}; recomputeTotals();`, ctx);
  const prompt = vm.runInContext("buildPrompt()", ctx);
  // budget operativo (cassa − ES95) come lo calcola recomputeTotals(), in EUR e USD
  const budgetEur = Number(vm.runInContext("DATA.totals && DATA.totals.budget_operativo_spendibile", ctx)) || 0;
  const eurusd = Number(d.eurusd) || 1;
  return { prompt, data: d, updated: d.updated_at, header, budgetEur, budgetUsd: budgetEur * eurusd, eurusd };
}

/* ============================================================ 2) deep data (da data.json) */
const isStock = (r) => r && r.currency === "USD" && r.price > 0 && !/^[\^]/.test(r.ticker) && !/[=]F$|-USD$/.test(r.ticker);
const pct = (x) => (x == null || !Number.isFinite(x)) ? null : Math.round(x * 1000) / 10;   // frazione → %
const cagr = (first, last, years) => (first > 0 && last > 0 && years > 0) ? Math.pow(last / first, 1 / years) - 1 : null;

function titleDeep(r) {
  const s = r.stats || {};
  const fin = Array.isArray(r.financials) ? r.financials.slice().sort((a, b) => a.year - b.year) : [];
  let revCagr = null, niCagr = null, span = null;
  if (fin.length >= 2) {
    const a = fin[0], b = fin[fin.length - 1];
    span = b.year - a.year;
    revCagr = cagr(a.revenue, b.revenue, span);
    niCagr = (a.net_income > 0 && b.net_income > 0) ? cagr(a.net_income, b.net_income, span) : null;   // utili: CAGR solo se entrambi positivi
  }
  const epsGrowth = (s.eps_ttm > 0 && s.eps_forward > 0) ? s.eps_forward / s.eps_ttm - 1 : null;
  const upside = (s.target_mean > 0 && r.price > 0) ? s.target_mean / r.price - 1 : null;
  return {
    ticker: r.ticker,
    rev_cagr_4y_pct: pct(revCagr), ni_cagr_4y_pct: pct(niCagr), cagr_years: span,
    rev_growth_yoy_pct: pct(s.revenue_growth), earn_growth_yoy_pct: pct(s.earnings_growth),
    eps_ttm: s.eps_ttm ?? null, eps_forward: s.eps_forward ?? null, eps_growth_impl_pct: pct(epsGrowth),
    forward_pe: s.forward_pe ?? null, peg: s.peg ?? null, target_upside_pct: pct(upside),
    profit_margin_pct: pct(s.profit_margin), roe_pct: pct(s.roe),
  };
}

function macroDeep(d) {
  const out = {};
  const md = (d.macro || {}).margin_debt || {};
  const h = Array.isArray(md.history) ? md.history : [];
  if (h.length >= 2) {
    const last = h[h.length - 1];
    out.margin_debt = {
      value_musd: last,
      slope_1m_pct: pct(last / h[h.length - 2] - 1),
      slope_6m_pct: h.length >= 7 ? pct(last / h[h.length - 7] - 1) : null,
      yoy_pct: md.yoy ?? null,
      pct_of_peak: md.pct_of_peak ?? null,
      trend: (md.qoq != null && md.qoq < 0) || (md.yoy != null && md.yoy < 0) ? "DELEVERAGING" : "espansione",
    };
  }
  const cr = (d.macro || {}).credit || {};
  const ch = Array.isArray(cr.history) ? cr.history.map(x => x.v).filter(Number.isFinite) : [];
  if (cr.spread_hy != null && ch.length) {
    const cur = cr.spread_hy;
    const ago = ch.length >= 22 ? ch[ch.length - 22] : ch[0];   // ~1 mese di sedute
    const lo = Math.min(...ch), hi = Math.max(...ch);
    out.hy_oas = {
      spread_pct: cur, slope_1m_pp: Math.round((cur - ago) * 100) / 100,
      range_1y: [lo, hi], pos_in_range_pct: hi > lo ? Math.round((cur - lo) / (hi - lo) * 100) : null,
      label: cr.label ?? null,
    };
  }
  const mh = Array.isArray(d.metrics_history) ? d.metrics_history : [];
  if (mh.length >= 2) {
    const last = mh[mh.length - 1], ago = mh.length >= 8 ? mh[mh.length - 8] : mh[0];
    out.regime = {
      vix: last.vix ?? null, vix_delta_7: (last.vix != null && ago.vix != null) ? Math.round((last.vix - ago.vix) * 10) / 10 : null,
      vix_term: last.vix_term ?? null,
      sharpe: last.sharpe ?? null, sharpe_delta_7: (last.sharpe != null && ago.sharpe != null) ? Math.round((last.sharpe - ago.sharpe) * 100) / 100 : null,
    };
  }
  return out;
}

function computeDeepData(d) {
  const rows = [...(d.portfolio || []), ...(d.watchlist || [])].filter(isStock);
  const seen = new Set();
  const titles = [];
  for (const r of rows) { if (seen.has(r.ticker)) continue; seen.add(r.ticker); titles.push(titleDeep(r)); }
  return { titles, macro: macroDeep(d) };
}

function formatDeepData(deep) {
  const nn = (v, suf = "") => (v == null ? "n.d." : `${v}${suf}`);
  const lines = ["", "=== DEEP DATA — arricchimento quantitativo per il Report CIO (calcolato dai financials/serie storiche già in data.json) ==="];
  lines.push("Crescita fondamentale per titolo (CAGR = tasso composto annuo; EPS impl. = eps_forward/eps_ttm−1):");
  lines.push("| Titolo | CAGR ricavi 4A | CAGR utili 4A | Ricavi YoY | Utili YoY | EPS ttm→fwd | Fwd P/E | PEG | Margine netto | ROE | Upside target |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const t of deep.titles) {
    lines.push(`| ${t.ticker} | ${nn(t.rev_cagr_4y_pct, "%")} | ${nn(t.ni_cagr_4y_pct, "%")} | ${nn(t.rev_growth_yoy_pct, "%")} | ${nn(t.earn_growth_yoy_pct, "%")} | ${nn(t.eps_growth_impl_pct, "%")} | ${nn(t.forward_pe)} | ${nn(t.peg)} | ${nn(t.profit_margin_pct, "%")} | ${nn(t.roe_pct, "%")} | ${nn(t.target_upside_pct, "%")} |`);
  }
  const m = deep.macro;
  if (m.margin_debt) {
    const g = m.margin_debt;
    lines.push(`\nMargin Debt (leva a credito): ${nn(g.value_musd)} M$ · pendenza 1M ${nn(g.slope_1m_pct, "%")} · 6M ${nn(g.slope_6m_pct, "%")} · YoY ${nn(g.yoy_pct, "%")} · ${nn(g.pct_of_peak, "% del picco")} · regime ${g.trend}.`);
  }
  if (m.hy_oas) {
    const g = m.hy_oas;
    lines.push(`HY OAS (spread high yield): ${nn(g.spread_pct, "%")} · variazione 1M ${nn(g.slope_1m_pp, "pp")} · range 1A [${g.range_1y ? g.range_1y.join("–") : "n.d."}] · posizione nel range ${nn(g.pos_in_range_pct, "%")} · ${nn(g.label)}.`);
  }
  if (m.regime) {
    const g = m.regime;
    lines.push(`Regime: VIX ${nn(g.vix)} (Δ7g ${nn(g.vix_delta_7)}) · term structure ${nn(g.vix_term)} · Sharpe ptf ${nn(g.sharpe)} (Δ7g ${nn(g.sharpe_delta_7)}).`);
  }
  lines.push("Uso: incrocia questi tassi con i multipli (Fwd P/E vs CAGR = PEG implicito) per giustificare o negare 'let winners run'. Pendenze macro in peggioramento (Margin Debt in DELEVERAGING o HY OAS in allargamento) = riduci sizing sui nuovi ingressi.");
  return lines.join("\n");
}

/* ============================================================ 3) contesto ibrido */
function buildHybridCIOContext() {
  const live = buildLivePrompt();
  const deep = computeDeepData(live.data);
  const user = live.prompt + "\n" + formatDeepData(deep);
  const bridge = [
    "", "=== FORMATO DI RISPOSTA (Report CIO strutturato) ===",
    "Rispondi ESCLUSIVAMENTE compilando lo schema JSON richiesto: nessun testo fuori dal JSON.",
    "Mappa la tua analisi di Comitato di Investimento nei campi dello schema. Vincoli operativi:",
    "- analisi_portafoglio: una voce per ogni posizione detenuta e per ogni candidato d'ingresso rilevante;",
    "  azione ∈ {ACCUMULA, NUOVO_INGRESSO, MANTIENI, ALLEGGERISCI, VENDI}.",
    "- Per gli ordini eseguibili (ACCUMULA/NUOVO_INGRESSO/ALLEGGERISCI/VENDI) compila qty, limite e stop",
    "  con i NUMERI del payload; per ACCUMULA/NUOVO_INGRESSO deve valere 0 < stop < limite ≤ prezzo corrente",
    "  e il limite entro il 30% dal prezzo. Per MANTIENI lascia qty/limite/stop a null.",
    "- La somma dei controvalori d'acquisto (qty×limite) NON deve superare il BUDGET OPERATIVO SPENDIBILE",
    "  dichiarato nel payload. Usa i valori già calcolati, non rifare i conti.",
    "- tracciabilita: cita la riga/sezione del payload da cui deriva l'ordine (es. 'Tabella A, riga MU').",
    "- allarmi_e_veto: elenca veto attivi, [MACRO SHOCK ALERT], stop violati, froth/breadth se presenti.",
  ].join("\n");
  const system = (live.header || "") + "\n" + bridge;
  return { system, user, live, deep };
}

/* ============================================================ 4) Structured Output schema */
const CIOReportSchema = {
  type: "object",
  properties: {
    briefing_e_sanity_check: { type: "string" },
    macro_e_regime: { type: "string" },
    analisi_portafoglio: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          azione: { type: "string", enum: ["ACCUMULA", "NUOVO_INGRESSO", "MANTIENI", "ALLEGGERISCI", "VENDI"] },
          qty: { type: "integer", nullable: true },
          limite: { type: "number", nullable: true },
          stop: { type: "number", nullable: true },
          motivazione: { type: "string" },
          tracciabilita: { type: "string" },
        },
        required: ["ticker", "azione", "motivazione", "tracciabilita"],
        propertyOrdering: ["ticker", "azione", "qty", "limite", "stop", "motivazione", "tracciabilita"],
      },
    },
    allocazione_liquidita: { type: "string" },
    rotazione_strategica: { type: "string" },
    allarmi_e_veto: { type: "array", items: { type: "string" } },
  },
  required: ["briefing_e_sanity_check", "macro_e_regime", "analisi_portafoglio", "allocazione_liquidita", "rotazione_strategica", "allarmi_e_veto"],
  propertyOrdering: ["briefing_e_sanity_check", "macro_e_regime", "analisi_portafoglio", "allocazione_liquidita", "rotazione_strategica", "allarmi_e_veto"],
};

async function askGeminiStructured(system, user) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(KEY)}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: CIOReportSchema, maxOutputTokens: 4096 },
  };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const out = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
  if (!out) throw new Error("Gemini: risposta vuota");
  return JSON.parse(out);
}

/* ============================================================ 5) POST-validazione invarianti */
const BUY = new Set(["ACCUMULA", "NUOVO_INGRESSO"]);
const SELL = new Set(["ALLEGGERISCI", "VENDI"]);
const num = (x) => { const v = typeof x === "string" ? parseFloat(x.replace(/[^\d.,-]/g, "").replace(",", ".")) : x; return Number.isFinite(v) ? v : null; };

function validateReport(report, live) {
  const hard = [], warn = [];
  const priceOf = {};
  for (const r of [...(live.data.portfolio || []), ...(live.data.watchlist || [])]) if (r.ticker) priceOf[r.ticker] = r.price;
  const orders = Array.isArray(report.analisi_portafoglio) ? report.analisi_portafoglio : [];
  let buyNotionalUsd = 0;
  for (const o of orders) {
    const tk = (o.ticker || "").trim();
    if (!(tk in priceOf)) { hard.push(`ticker '${tk}' inesistente nel payload (allucinazione)`); continue; }
    if (/BTP/.test(tk)) continue;                     // titoli di stato: nessun ordine tattico da validare
    const price = priceOf[tk], lim = num(o.limite), stop = num(o.stop), qty = num(o.qty);
    if (BUY.has(o.azione)) {
      if (lim == null || stop == null) { hard.push(`${tk}: ordine ${o.azione} senza limite/stop numerici`); continue; }
      if (!(stop > 0)) hard.push(`${tk}: stop ${stop} ≤ 0`);
      if (!(lim > 0)) hard.push(`${tk}: limite ${lim} ≤ 0`);
      if (!(stop < lim)) hard.push(`${tk}: stop ${stop} ≥ limite ${lim} (ordine long impossibile — incidente SNDK)`);
      if (!(lim <= price * 1.02)) hard.push(`${tk}: limite ${lim} sopra il prezzo ${price}`);
      if (price > 0 && (price - lim) / price > 0.30) hard.push(`${tk}: limite ${lim} oltre il 30% dal prezzo ${price}`);
      if (qty != null && lim != null) buyNotionalUsd += qty * lim;
    } else if (SELL.has(o.azione)) {
      if (lim != null && !(lim > 0)) hard.push(`${tk}: limite di vendita ${lim} ≤ 0`);
      if (lim != null && price > 0 && lim < price * 0.95) warn.push(`${tk}: limite di vendita ${lim} sotto il mercato ${price} (svendita?)`);
      if (stop != null && !(stop > 0)) hard.push(`${tk}: stop ${stop} ≤ 0`);
    }
    // MANTIENI: nessun ordine da validare
  }
  // budget operativo: la spesa d'acquisto totale non può sforare cassa−ES95 (5% di tolleranza)
  if (buyNotionalUsd > live.budgetUsd * 1.05 && live.budgetUsd > 0) {
    hard.push(`budget sforato: acquisti ${Math.round(buyNotionalUsd)} USD > budget operativo ${Math.round(live.budgetUsd)} USD (cassa−ES95)`);
  }
  return { hard, warn, buyNotionalUsd };
}

/* ============================================================ 6) WhatsApp (con validazione body, come STEP 3) */
const CB_ERR = ["invalid", "not valid", "not registered", "not activated", "you need to", "blocked", "not found"];
async function whatsapp(msg) {
  const apikey = process.env.CALLMEBOT_APIKEY, phone = process.env.CALLMEBOT_PHONE;
  if (!apikey || !phone) { console.log("!! CIO report: CALLMEBOT non configurato, alert non inviato"); return false; }
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&apikey=${encodeURIComponent(apikey)}&text=${encodeURIComponent(msg)}`;
  const r = await fetch(url, { method: "GET" });
  const body = (await r.text()) || "";
  const errored = CB_ERR.some(e => body.toLowerCase().includes(e));
  const ok = r.status === 200 && !errored;
  console.log(`CIO report: WhatsApp ${ok ? "inviato" : "FALLITO"} (HTTP ${r.status}) body=${body.slice(0, 160)}`);
  return ok;
}

/* ============================================================ main */
async function main() {
  const { system, user, live, deep } = buildHybridCIOContext();
  console.log(`CIO report: contesto ibrido pronto — system ${system.length} char, user ${user.length} char, ` +
    `${deep.titles.length} titoli deep-data, budget operativo ${Math.round(live.budgetEur)} € / ${Math.round(live.budgetUsd)} $ (cassa assunta ${CASH_EUR} €).`);

  if (!KEY) { console.log("CIO report: GEMINI_API_KEY assente → no-op (aggiungi il secret per attivare)."); return; }
  if (DRY && process.argv.includes("--no-call")) { console.log("[--dry --no-call] contesto costruito, nessuna chiamata."); return; }

  const report = await askGeminiStructured(system, user);
  const val = validateReport(report, live);

  const meta = {
    generated_at: new Date().toISOString(),
    data_updated_at: live.updated,
    model: MODEL,
    assumed_cash_eur: CASH_EUR,
    budget_operativo_eur: Math.round(live.budgetEur),
    budget_operativo_usd: Math.round(live.budgetUsd),
    deep_titles: deep.titles.length,
    validation: { passed: val.hard.length === 0, hard: val.hard, warn: val.warn, buy_notional_usd: Math.round(val.buyNotionalUsd) },
  };

  if (val.hard.length) {
    console.error(`!! CIO report RIFIUTATO — ${val.hard.length} violazioni invarianti:\n  ✗ ${val.hard.join("\n  ✗ ")}`);
    if (!DRY) {
      const msg = "🛑 REPORT CIO RIFIUTATO — il modello ha prodotto ordini che violano gli invarianti:\n" +
        val.hard.slice(0, 6).join("\n") + "\nNessun report scritto. Controlla la tab Actions.";
      await whatsapp(msg).catch(() => {});
    }
    return;   // NON scrivere un report con ordini non validi
  }

  if (DRY) {
    console.log("[--dry] validazione superata. Report che verrebbe scritto:\n" + JSON.stringify({ meta, report }, null, 2).slice(0, 2500));
    return;
  }
  writeFileSync(OUT, JSON.stringify({ meta, report }, null, 2));
  console.log(`CIO report: scritto ${OUT} (${val.warn.length} warning). Ordini: ${report.analisi_portafoglio.length}.`);
  const n = report.analisi_portafoglio.filter(o => BUY.has(o.azione) || SELL.has(o.azione)).length;
  const msg = `📄 REPORT CIO pronto (${(live.updated || "").slice(0, 16).replace("T", " ")}): ${n} ordini operativi, ` +
    `budget ${Math.round(live.budgetEur)} €.\n${(report.briefing_e_sanity_check || "").slice(0, 300)}\nhttps://oigres85.github.io/Trading/`;
  await whatsapp(msg).catch(() => {});
}

/* funzioni pure esportate per i test (import senza eseguire main) */
export { validateReport, computeDeepData, formatDeepData, buildHybridCIOContext, CIOReportSchema };

// esegui la pipeline SOLO se invocato direttamente (l'import nei test non deve far girare main)
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch(e => console.error("!! CIO report (best-effort, pipeline NON bloccata):", e.message))
    .finally(() => process.exit(0));
}
