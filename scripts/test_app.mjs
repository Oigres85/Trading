#!/usr/bin/env node
/* Test harness per le funzioni PURE di assets/app.js (motore decisionale, risk, prompt).
   app.js è pensato per il browser: qui gira in un contesto Node (vm) con un DOM-stub
   minimale — niente rendering, si testano SOLO calcoli e generazione del prompt.
   Uso: node scripts/test_app.mjs  (exit 1 se un check fallisce) */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");

/* ---------- DOM-stub minimale: quello che il wiring top-level di app.js tocca ---------- */
function el() {
  return {
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, dataset: {}, hidden: true, className: "", innerHTML: "", textContent: "",
    value: "", placeholder: "",
    appendChild() {}, remove() {}, after() {}, focus() {}, click() {},
    scrollIntoView() {}, querySelector: () => el(), querySelectorAll: () => [],
    dispatchEvent() {}, closest: () => null, setAttribute() {},
  };
}
const storage = new Map();
const ctx = vm.createContext({
  console,
  document: {
    querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(),
    createElement: () => el(), addEventListener() {}, body: el(),
  },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
  window: { prompt: () => null, confirm: () => false, addEventListener() {}, matchMedia: () => ({ matches: false }) },
  navigator: { clipboard: { writeText: async () => {} } },
  fetch: () => Promise.reject(new Error("offline (test harness)")),
  setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  Event: class {}, MutationObserver: class { observe() {} },
});
vm.runInContext(src, ctx, { filename: "app.js" });

/* ---------- fixture: portafoglio sintetico con casi noti ---------- */
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const baseStats = { roe: 0.30, profit_margin: 0.25, revenue_growth: 0.20, short_float: 0.02, peg: 1.5, market_cap: 1e9, avg_volume_30d: 1e7, altman_z: 5 };
const fixture = `
DATA = {
  updated_at: new Date().toISOString(),
  eurusd: 1.0,
  totals: {},
  broker: { as_of: "${daysAgo(10)}" },
  macro: { vix: { value: 15, change_pct: 0 },
           margin_debt: { pct_of_peak: 100, series: "TEST", date: "2026-01-01", peak_date: "2026-01-01", yoy: 30 } },
  allocation: [], news: [], top_caps: [], top_etfs: [], predictions: [], options: {},
  metrics_history: [], sanity_filtered: 0,
  portfolio: [
    { ticker: "TST1", name: "Good Corp", currency: "USD", qty: 100, pmc: 50, price: 100, bval: 10000,
      beta_ndx: 1.2, sharpe_1y: 2.5, sortino_1y: 2.8, rs_1m: 5, rs_ndx_1m: 6, w52_dist_pct: -18,
      support: 95, resistance: 120, rsi: 45, atr_14: 3, atr_pct: 3, stop_atr: 94, stop_violated: false,
      vol_ratio: 1.0, fin_health: 80, signal: "ok", signal_class: "good", sector: "Technology",
      risk_contrib_pct: 60, avg_corr: 0.3, max_corr: 0.5, max_corr_with: "TST3",
      stats: ${JSON.stringify({ ...baseStats, float_shares: 40e6, float_pct: 88 })}, sparks: {}, tech_by_range: {}, financials: [] },
    { ticker: "TST2", name: "Trap Inc", currency: "USD", qty: 50, pmc: 100, price: 80, bval: 4000,
      sharpe_1y: -0.2, sortino_1y: -0.6, rs_1m: -10, rs_ndx_1m: -12, w52_dist_pct: -40,
      support: 70, resistance: 110, rsi: 30, atr_14: 4, atr_pct: 5, vol_ratio: 2.0,
      signal: "debole", signal_class: "bad", sector: "Technology",
      stats: ${JSON.stringify({ ...baseStats, roe: 0.05 })}, sparks: {}, tech_by_range: {}, financials: [] },
    { ticker: "TST3", name: "Violated Co", currency: "USD", qty: 10, pmc: 90, price: 100, bval: 1000,
      sharpe_1y: 1.0, sortino_1y: 1.2, atr_14: 2, atr_pct: 2, stop_atr: 110, stop_violated: true,
      support: 95, resistance: 130, rsi: 50, vol_ratio: 1.0, signal: "ok", signal_class: "good",
      sector: "Healthcare", stats: ${JSON.stringify(baseStats)}, sparks: {}, tech_by_range: {}, financials: [] },
    { ticker: "TST4", name: "HiVol SpA", currency: "USD", qty: 10, pmc: 60, price: 75, bval: 1000,
      sharpe_1y: 0.5, sortino_1y: 0.6, atr_14: 6.75, atr_pct: 9, support: 60, resistance: 90, rsi: 55,
      vol_ratio: 1.0, signal: "ok", signal_class: "good", sector: "Energy",
      stats: ${JSON.stringify(baseStats)}, sparks: {}, tech_by_range: {}, financials: [] },
    { ticker: "TST5", name: "NoSortino Ltd", currency: "USD", qty: 5, pmc: 100, price: 90, bval: 450,
      sharpe_1y: -0.5, sortino_1y: null, support: 80, resistance: 100, rsi: 40, vol_ratio: 1.0,
      signal: "debole", signal_class: "bad", sector: "Technology",
      stats: ${JSON.stringify(baseStats)}, sparks: {}, tech_by_range: {}, financials: [] },
  ],
  watchlist: [],
};
cashEur = 10000;
recomputeTotals();
Object.assign(DATA.totals, { portfolio_sharpe_ratio: 1.87, portfolio_sortino_ratio: 2.2,
  risk_free_rate: 0.0363, portfolio_beta_ndx: 1.5, avg_pairwise_corr: 0.31,
  var95_hist_pct: 2.8, var95_hist_eur: 5000, es95_hist_pct: 3.9, es95_hist_eur: 7000,
  var95_1d_pct: 2.2, var95_1d_eur: 4000, es95_1d_pct: 2.7, es95_1d_eur: 4800 });
`;
vm.runInContext(fixture, ctx, { filename: "fixture.js" });

/* ---------- checks ---------- */
const T = [];
const check = (name, expr) => T.push([name, expr]);
// ogni assert in una IIFE: i const/let top-level resterebbero nel lexical env globale del vm
const run = (code) => vm.runInContext(`(() => { ${code.includes("return") ? code : `return (${code})`} })()`, ctx, { filename: "assert.js" });

// pesi MARK-TO-MARKET, non costo storico
check("val_eur = prezzo×qtà (MTM), non PMC×qtà; peso sul NAV cash incluso", run(`
  const r = DATA.portfolio[0];  // TST1: MTM 10000 (costo sarebbe 5000)
  const nav = DATA.portfolio.reduce((s, x) => s + x.val_eur, 0) + cashEur;
  const expected = 10000 / nav * 100;              // ≈38% — col costo storico sarebbe ≈24%
  return Math.abs(r.val_eur - 10000) < 1 && Math.abs(positionWeightPct(r) - expected) < 0.5`));

// veto: guida il SORTINO, non lo Sharpe
check("veto VALUE TRAP citando il Sortino (TST2: sortino -0.6, sharpe -0.2)", run(`
  const v = qualityVeto(DATA.portfolio[1]);
  return v && v.verdict === "SCARTATO - VALUE TRAP" && /Sortino/.test(v.why[0])`));
check("Sharpe -0.2 NON basta al veto se il Sortino è sano", run(`
  qualityVeto({ ...DATA.portfolio[0], sharpe_1y: -0.2, sortino_1y: 0.5 }) === null`));
check("fallback etichettato allo Sharpe quando Sortino n.d. (TST5)", run(`
  const v = qualityVeto(DATA.portfolio[4]);
  return v && /proxy/.test(v.why[0])`));

// stop ratchet
check("stopOf preferisce lo stop ratchet della pipeline", run(`
  const s = stopOf(DATA.portfolio[0]);
  return s.stop === 94 && s.ratchet === true && s.violated === false`));
check("stopOf segnala la violazione (TST3: stop 110 > prezzo 100)", run(`
  const s = stopOf(DATA.portfolio[2]);
  return s.violated === true && s.stop === 110`));
check("stopOf fallback client quando stop_atr manca (TST4)", run(`
  const s = stopOf(DATA.portfolio[3]);
  return s.ratchet === false && Math.abs(s.stop - (75 - 2 * 6.75)) < 0.01`));

// motore: verdetto, violazioni, esclusi, sizing regime-aware
check("decisionVerdict: TST2 tra gli esclusi, TST3 tra le violazioni", run(`
  const dv = decisionVerdict();
  return dv.excluded.some(x => x.r.ticker === "TST2") &&
  dv.stopViolations.some(x => x.r.ticker === "TST3") &&
  typeof dv.label === "string"`));
check("sizing regime-aware: VIX 27 dimezza il budget d'ingresso", run(`
  const q1 = (decisionVerdict().withPlan.find(p => p.r.ticker === "TST1") || {}).qty || 0;
  DATA.macro.vix.value = 27;
  const q2 = (decisionVerdict().withPlan.find(p => p.r.ticker === "TST1") || {}).qty || 0;
  DATA.macro.vix.value = 15;
  return q1 > 0 && q2 > 0 && q2 <= Math.ceil(q1 * 0.55)`));

// riconciliazione broker (soglia volatility-aware)
check("reconcile: baseline pulita (drift TST4 -25% sotto la banda 2σ con ATR 9%)", run(`
  reconcileState().needed === false`));
check("reconcile: qty dimezzata su TST1 viene catturata", run(`
  const oq = DATA.portfolio[0].qty;
  DATA.portfolio[0].qty = oq / 2; recomputeTotals();
  const rec = reconcileState();
  DATA.portfolio[0].qty = oq; recomputeTotals();
  return rec.needed === true && rec.mismatches.some(m => m.tk === "TST1")`));

// margin debt: stato condiviso 1:1
check("marginDebtState: 100% picco senza Forward P/E → ELEVATA con conferma n.d.", run(`
  const m = marginDebtState();
  return m.high === true && m.confirmed === false && /conferma P\\/E n\\.d\\./.test(m.label) && m.labelShort === "Leva ELEVATA"`));

// buildPrompt: smoke test completo
const prompt = run(`buildPrompt()`);
const has = (s) => prompt.includes(s);
check("prompt: advisory libero + mandato consegna minima anti-laziness", has("DELEGA PIENA SULLA FORMA") && has("MANDATO DI CONSEGNA MINIMA") && has("FAI DOMANDE"));
check("prompt: colonna Sortino 1A nella tabella PORTAFOGLIO", has("| Sortino 1A |"));
check("prompt: consegna minima (leading KOSPI/Nasdaq/BTC, quote esatte, news, gap pre/after)", has("KOSPI") && has("Bitcoin") && has("calcolo MATEMATICO ESATTO della quantità") && has("NEWS SPECIFICHE") && has("GAP PRE/AFTER-MARKET"));
check("prompt: matrice di rischio per posizione", has("MATRICE DI RISCHIO PER POSIZIONE"));
check("prompt: flag [STOP VIOLATO] su TST3", /\[STOP VIOLATO\][\s\S]*TST3|TST3[^\n]*\[STOP VIOLATO\]/.test(prompt));
check("prompt: VaR storico primario", has("STORICO, percentili empirici"));
check("prompt: igiene dati, gap overnight e verifica web obbligatoria sui flag", has("IGIENE DEI DATI") && has("ordini LIMITE") && has("double-check") && has("ricerca web"));
check("prompt: niente RICONCILIAZIONE nel baseline pulito", !has("RICONCILIAZIONE BROKER NECESSARIA"));
check("prompt: nessun 'undefined' nel payload", !has("undefined"));
check("prompt: nessun 'NaN' nel payload", !/\bNaN\b/.test(prompt));
check("prompt: chiusura standby v87 rimossa", !has("In attesa di interrogazioni tattiche"));


// data assertions: il fallback client-side deve urlare su margin debt non-FINRA
check("validateMacroData: margin debt Z.1 → UNRELIABLE (fallback client)", run(`
  const v = validateMacroData();
  return v.bad.some(b => b.key === "margin_debt") && /UNRELIABLE/.test(v.flags.margin_debt || "")`));
check("prompt: DATA QUALITY REPORT e flag inline sul margin debt", run(`
  const p2 = buildPrompt();
  return p2.includes("DATA QUALITY REPORT") && p2.includes("[!!! DATATO / UNRELIABLE !!!")`));
check("validateMacroData: pulito con data_quality ok dalla pipeline", run(`
  DATA.data_quality = { checks: [{ key: "margin_debt", status: "ok" }], alerts: [] };
  const v = validateMacroData();
  delete DATA.data_quality;
  return v.ok === true`));


check("prompt: web-search order in CIMA sui dati mancanti/inaffidabili", run(`
  const p2 = buildPrompt();
  const iOrder = p2.indexOf("PRIMO ORDINE OPERATIVO");
  const iPortafoglio = p2.indexOf("MATRICE DI RISCHIO PER POSIZIONE");
  return iOrder > 0 && iOrder < iPortafoglio`));


check("prompt: colonna Float nella tabella + valore leggibile (40M)", run(`
  const p2 = buildPrompt();
  return p2.includes("| Float |") && p2.includes("40M")`));
check("prompt: nota metodologica [LOW FLOAT RISK]", run(`
  return buildPrompt().includes("[LOW FLOAT RISK]") && buildPrompt().includes("Low Float < 50M")`));

// GUARDRAIL BLOCCANTE (decoupling v101): il fallback embedded DEFAULT_PROMPT_HEADER DEVE restare
// byte-identico a config/prompt_header.txt. Se divergono (es. un'istanza futura ha modificato la
// testata in app.js invece del file), questo test FALLISCE e blocca il CI. Vedi CLAUDE.md.
{
  const embedded = vm.runInContext("typeof DEFAULT_PROMPT_HEADER === 'string' ? DEFAULT_PROMPT_HEADER.trim() : null", ctx);
  const fileTxt = readFileSync(join(ROOT, "config", "prompt_header.txt"), "utf8").trim();
  const same = embedded === fileTxt;
  check("SYNC TESTATA: DEFAULT_PROMPT_HEADER (app.js) === config/prompt_header.txt (byte-identico)", same);
  if (!same) {
    console.log("  ⚠ La testata embedded e il file sono DIVERSI. NON modificare la testata in app.js:");
    console.log("    edita config/prompt_header.txt e riallinea DEFAULT_PROMPT_HEADER nello stesso commit.");
    if (embedded == null) console.log("    (DEFAULT_PROMPT_HEADER non trovata o non stringa in app.js)");
  }
}

/* ---------- report ---------- */
let fail = 0;
for (const [name, ok] of T) {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
console.log(`\n${T.length - fail}/${T.length} check superati`);
process.exit(fail ? 1 : 0);
