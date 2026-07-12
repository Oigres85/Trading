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
  watchlist: [
    { ticker: "TSTW", name: "Watch Corp", currency: "USD", price: 100,
      beta_ndx: 1.1, sharpe_1y: 2.5, sortino_1y: 2.8, rs_1m: 5, rs_ndx_1m: 6, w52_dist_pct: -15,
      support: 95, resistance: 120, rsi: 45, atr_14: 3, atr_pct: 3, vol_ratio: 1.0, fin_health: 80,
      signal: "ok", signal_class: "good", sector: "Technology",
      avg_corr: 0.3, max_corr: 0.5, max_corr_with: "TST1",
      stats: ${JSON.stringify({ ...baseStats, float_shares: 40e6, float_pct: 88 })}, sparks: {}, tech_by_range: {}, financials: [] },
  ],
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
check("sizing regime-aware: VIX 27 dimezza il budget d'ingresso (TSTW, watchlist)", run(`
  const q1 = (decisionVerdict().withPlan.find(p => p.r.ticker === "TSTW") || {}).qty || 0;
  DATA.macro.vix.value = 27;
  const q2 = (decisionVerdict().withPlan.find(p => p.r.ticker === "TSTW") || {}).qty || 0;
  DATA.macro.vix.value = 15;
  return q1 > 0 && q2 > 0 && q2 <= Math.ceil(q1 * 0.55)`));
check("cap sizing v110: TST1 (peso >10% NAV) NON è candidato ad accumulo, con motivazione dedicata", run(`
  const dv = decisionVerdict();
  return !dv.accumula.some(r => r.ticker === "TST1") &&
    dv.reasons.some(s => s.includes("cap sizing") && s.includes("TST1"))`));

// ---- RIABILITAZIONE GROWTH (v111): il veto Sortino è revocato SOLO con qualità+trend+RS ----
check("riabilitazione growth: Sortino negativo MA ROE>15% + sopra SMA200 + RS>0 → eleggibile, tag RIABILITATO", run(`
  const rehabRow = { ticker: "TSTR", currency: "USD", price: 100, sortino_1y: -0.8, sharpe_1y: -0.5,
    sma200_dist_pct: 4.2, rs_ndx_1m: 3.5, stats: { roe: 0.30, profit_margin: 0.20, peg: 1.2 } };
  const v = qualityVeto(rehabRow);
  return v && v.rehab === true && v.verdict.includes("RIABILITATO") && v.rehabWhy.includes("SMA200")`));
check("riabilitazione growth: RS negativa (MSFT-like) → veto Sortino CONFERMATO", run(`
  const still = { ticker: "TSTM", currency: "USD", price: 100, sortino_1y: -1.4,
    sma200_dist_pct: -8, rs_ndx_1m: -7.6, stats: { roe: 0.34, profit_margin: 0.39, peg: 1.2 } };
  const v = qualityVeto(still);
  return v && !v.rehab && v.verdict === "SCARTATO - VALUE TRAP"`));
check("riabilitazione growth: short interest ≥15% NON è riabilitabile (rischio presente)", run(`
  const shorty = { ticker: "TSTS", currency: "USD", price: 100, sortino_1y: -0.5,
    sma200_dist_pct: 4, rs_ndx_1m: 5, stats: { roe: 0.30, profit_margin: 0.20, short_float: 0.18, peg: 1.2 } };
  const v = qualityVeto(shorty);
  return v && !v.rehab && v.why.some(w => w.includes("Short Interest"))`));
check("decisionVerdict: riabilitato entra tra gli eleggibili e nei reasons come SORVEGLIATO", run(`
  DATA.watchlist.push({ ticker: "TSTR", name: "Rehab Corp", currency: "USD", price: 100,
    sortino_1y: -0.8, sharpe_1y: 2.2, rs_1m: 4, rs_ndx_1m: 3.5, sma200_dist_pct: 4.2, w52_dist_pct: -20,
    support: 95, resistance: 120, rsi: 50, atr_14: 3, atr_pct: 3, vol_ratio: 1, fin_health: 75,
    signal: "ok", signal_class: "good", sector: "Technology",
    avg_corr: 0.2, max_corr: 0.4, max_corr_with: "TST1",
    stats: { roe: 0.30, profit_margin: 0.20, revenue_growth: 0.25, peg: 1.2, market_cap: 1e9, avg_volume_30d: 1e7 },
    sparks: {}, tech_by_range: {}, financials: [] });
  const dv = decisionVerdict();
  DATA.watchlist = DATA.watchlist.filter(r => r.ticker !== "TSTR");
  return dv.rehabbed.some(x => x.r.ticker === "TSTR") &&
    !dv.excluded.some(x => x.r.ticker === "TSTR") &&
    dv.reasons.some(s => s.includes("RIABILITATI") && s.includes("TSTR"))`));

// ---- v112: staleness dichiarata, indici non operabili, earnings sul piano, diario, Sharpe 6M ----
check("prompt v112: prezzo stale flaggato '[chiusura del …]' e indici PTS senza stop/R:R", run(`
  DATA.watchlist.push({ ticker: "TSTI", name: "Indice Test", currency: "PTS", price: 1000,
    price_asof: "2020-01-01", change_pct: 0.5, support: 950, resistance: 1100, rsi: 50, atr_14: 20, atr_pct: 2,
    vol_ratio: 1, signal: "ok", signal_class: "good", sector: "—", stats: null, sparks: {}, tech_by_range: {}, financials: [] });
  const p = buildPrompt();
  DATA.watchlist = DATA.watchlist.filter(r => r.ticker !== "TSTI");
  const line = p.split("\\n").find(l => l.includes("TSTI"));
  return line.includes("[chiusura del 01/01]") && !line.includes("teorico") && !line.includes("1:")`));
check("prompt v112: [!EARNINGS RISK] sulla riga del piano d'ingresso (Livelli)", run(`
  const fut = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const wl = DATA.watchlist.find(r => r.ticker === "TSTW"); wl.earnings_date = fut;
  const p = buildPrompt();
  delete wl.earnings_date;
  const line = p.split("\\n").find(l => l.includes("Livelli calcolati dal motore"));
  return line && line.includes("TSTW") && line.includes("[!EARNINGS RISK: trimestrale " + fut)`));
check("prompt v112: istruzione di incrocio diario ↔ Tabella A quando il diario è popolato", run(`
  localStorage.setItem("action_diary", JSON.stringify([{ date: "2026-07-10", text: "acquisto test 10 azioni" }]));
  const p = buildPrompt();
  localStorage.removeItem("action_diary");
  return p.includes("INCROCIA il diario con la Tabella A") && p.includes("acquisto test 10 azioni")`));
check("quantScore v112: il riabilitato usa lo Sharpe 6M (regime) e supera la soglia candidati", run(`
  DATA.watchlist.push({ ticker: "TSTR6", name: "Rehab Regime", currency: "USD", price: 100,
    sortino_1y: -0.8, sharpe_1y: -0.5, sharpe_6m: 2.6, rs_1m: 4, rs_ndx_1m: 3.5, sma200_dist_pct: 4.2, w52_dist_pct: -20,
    support: 95, resistance: 120, rsi: 50, atr_14: 3, atr_pct: 3, vol_ratio: 1, fin_health: 75,
    signal: "ok", signal_class: "good", sector: "Technology", avg_corr: 0.2, max_corr: 0.4, max_corr_with: "TST1",
    stats: { roe: 0.30, profit_margin: 0.20, revenue_growth: 0.25, peg: 1.2, market_cap: 1e9, avg_volume_30d: 1e7 },
    sparks: {}, tech_by_range: {}, financials: [] });
  const dv = decisionVerdict();
  DATA.watchlist = DATA.watchlist.filter(r => r.ticker !== "TSTR6");
  const cand = dv.accumula.find(r => r.ticker === "TSTR6");
  const rl = dv.reasons.find(s => s.includes("RIABILITATI"));
  return !!cand && cand._q >= 60 && rl.includes("Sharpe 6M 2,6")`));

// ---- TRIM PEG-aware (v111, let winners run): P/E ottico alto ma PEG sano → niente trim ----
check("trim growth: P/E 185 con PEG 1.2 (AMD-like) NON va in trim; PEG n.d. (CBRS-like) sì", run(`
  DATA.portfolio.push(
    { ticker: "TSTG", name: "Growth Winner", currency: "USD", qty: 10, pmc: 50, price: 100, bval: 1000,
      pe: 185, rsi: 60, sharpe_1y: 2.0, sortino_1y: 2.5, support: 90, resistance: 120, vol_ratio: 1,
      signal: "ok", signal_class: "good", sector: "Technology",
      stats: { roe: 0.3, profit_margin: 0.2, peg: 1.2, market_cap: 1e9 }, sparks: {}, tech_by_range: {}, financials: [] },
    { ticker: "TSTC", name: "Optical Multiple", currency: "USD", qty: 10, pmc: 50, price: 100, bval: 1000,
      pe: 458, rsi: 60, sharpe_1y: 2.0, sortino_1y: 2.5, support: 90, resistance: 120, vol_ratio: 1,
      signal: "ok", signal_class: "good", sector: "Technology",
      stats: { roe: 0.3, profit_margin: 0.2, market_cap: 1e9 }, sparks: {}, tech_by_range: {}, financials: [] });
  recomputeTotals();
  const dv = decisionVerdict();
  DATA.portfolio = DATA.portfolio.filter(r => !["TSTG","TSTC"].includes(r.ticker));
  recomputeTotals();
  return !dv.trim.some(r => r.ticker === "TSTG") && dv.trim.some(r => r.ticker === "TSTC")`));

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
check("marginDebtState v106: YoY 30% → Espansione ELEVATA, conferma n.d. (livello=contesto)", run(`
  const m = marginDebtState();
  return m.high === true && m.confirmed === false && /conferma P\\/E n\\.d\\./.test(m.label) && m.labelShort === "Espansione ELEVATA"`));
check("marginDebtState v106: YoY 54% → ESTREMA; MoM -3 dai massimi → DELEVERAGING", run(`
  const md = DATA.macro.margin_debt;
  md.yoy = 54; const ex = marginDebtState().labelShort;
  md.qoq = -3; const roll = marginDebtState().labelShort;
  md.yoy = 30; delete md.qoq;
  return ex === "Espansione ESTREMA" && roll === "DELEVERAGING"`));

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

// GUARDRAIL FALLBACK TESTATA (decoupling v101, corretto v104): DEFAULT_PROMPT_HEADER è SOLO il
// fallback offline. NON deve essere byte-identico a config/prompt_header.txt — quel file è
// editato dall'utente dalla UI ed è la fonte di verità (promptHeaderText lo carica via cloud).
// Il test verifica solo che il FALLBACK esista e sia sensato (un'istanza futura non deve
// svuotarlo/romperlo), NON che coincida col file. Vedi CLAUDE.md.
{
  const embedded = vm.runInContext("typeof DEFAULT_PROMPT_HEADER === 'string' ? DEFAULT_PROMPT_HEADER.trim() : null", ctx);
  const ok = typeof embedded === "string" && embedded.length > 500 && embedded.startsWith("RUOLO");
  check("FALLBACK TESTATA: DEFAULT_PROMPT_HEADER esiste, non vuoto, inizia con RUOLO", ok);
  if (!ok) console.log("  ⚠ Il fallback DEFAULT_PROMPT_HEADER manca o è degenere. Deve restare un header valido (fallback offline).");
}


check("prompt: R/R teorico pre-calcolato in tabella (TST1 supp95/res120/atr3 → 1:4.2)", run(`
  const p2 = buildPrompt();
  return p2.includes("| R/R teorico |") && p2.includes("1:4.2")`));

// ---- v113: turnaround squeeze, cinematica, track record, auto-timestamp broker ----
check("squeezeSetup: short≥20% + RVol>2 + sopra SMA50 → setup; posizione detenuta MAI", run(`
  const base = { vol_ratio: 2.6, sma50_dist_pct: 2.0, stats: { short_float: 0.25 } };
  return squeezeSetup({ ...base }) === true &&
    squeezeSetup({ ...base, qty: 10 }) === false &&
    squeezeSetup({ ...base, vol_ratio: 1.2 }) === false &&
    squeezeSetup({ ...base, sma50_dist_pct: -1 }) === false`));
check("decisionVerdict: escluso con setup squeeze → dv.squeezed + reason ⚡ + flag in tabella prompt", run(`
  DATA.watchlist.push({ ticker: "TSTQ", name: "Squeeze Co", currency: "USD", price: 50,
    sortino_1y: -0.9, sharpe_1y: -0.6, vol_ratio: 2.6, sma50_dist_pct: 2.0, w52_dist_pct: -60,
    support: 45, resistance: 70, rsi: 55, atr_14: 2, atr_pct: 4,
    signal: "debole", signal_class: "bad", sector: "Technology",
    avg_corr: 0.2, max_corr: 0.3, max_corr_with: "TST1",
    stats: { short_float: 0.25, roe: 0.05, profit_margin: 0.05, market_cap: 1e9, avg_volume_30d: 1e7 },
    sparks: {}, tech_by_range: {}, financials: [] });
  const dv = decisionVerdict();
  const p = buildPrompt();
  DATA.watchlist = DATA.watchlist.filter(r => r.ticker !== "TSTQ");
  const row = p.split("\\n").find(l => l.includes("Squeeze Co"));
  return dv.squeezed.some(x => x.r.ticker === "TSTQ") &&
    dv.reasons.some(s => s.includes("TURNAROUND SQUEEZE") && s.includes("TSTQ")) &&
    p.includes("[TURNAROUND SQUEEZE RISK] (contesto") && row.includes("[TURNAROUND SQUEEZE RISK]")`));
check("prompt v113: CINEMATICA — RS velocity con ↓DECELERA, MCR top-3 e term structure", run(`
  const old = DATA.metrics_history;
  const d8 = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  const d0 = new Date().toISOString().slice(0, 10);
  DATA.metrics_history = [
    { date: d8, sharpe: 1.5, vix: 18, vix_term: 0.9, titles: { TST1: { rs: 10, mcr: 40 } } },
    { date: d0, sharpe: 1.8, vix: 15, vix_term: 0.8, titles: { TST1: { rs: 3, mcr: 42 } } }];
  const p = buildPrompt();
  DATA.metrics_history = old;
  return p.includes("CINEMATICA DEI SEGNALI") && p.includes("RS Velocity") &&
    /TST1 RS \\+3pp \\(Δ -7pp ↓DECELERA\\)/.test(p) &&
    p.includes("Derivata di concentrazione") && p.includes("term structure in distensione")`));
check("prompt v113: TRACK RECORD renderizzato quando maturo, 'in costruzione' quando vuoto", run(`
  const p0 = buildPrompt();
  DATA.verdict_track = { mature7: { n: 3, avg_ret: 4.2, avg_vs_ndx: 1.1, hit_pct: 67 }, mature30: { n: 0 },
    last: [{ tk: "TST1", date: "2026-06-01", ret_pct: 5, vs_ndx_pp: 2 }] };
  const p1 = buildPrompt();
  delete DATA.verdict_track;
  return p0.includes("TRACK RECORD DEL MOTORE: storico in costruzione") &&
    p1.includes("maturazione ≥7g: 3 segnali") && p1.includes("hit-rate vs NDX 67%") &&
    p1.includes("Ultimi segnali maturati: TST1 +5%")`));
check("stampBrokerDate v113: salvataggio PORTAFOGLIO aggiorna as_of a oggi e rimuove i bval stale, watchlist no", run(`
  const today = new Date().toISOString().slice(0, 10);
  const mk = () => ({ broker: { as_of: "2026-06-22" }, portfolio: [{ ticker: "X", qty: 1, pmc: 2, bval: 100, bgain: 5 }] });
  const a = stampBrokerDate(mk(), "portfolio");
  const b = stampBrokerDate(mk(), "watchlist");
  const c = stampBrokerDate({}, "portfolio");   // senza blocco broker: nessun crash
  return a.broker.as_of === today && !("bval" in a.portfolio[0]) && !("bgain" in a.portfolio[0]) &&
    b.broker.as_of === "2026-06-22" && b.portfolio[0].bval === 100 && !!c`));

/* GUARDRAIL CARD MOBILE (v109): ogni etichetta di MOBILE_KEY_COLS deve esistere DAVVERO
   tra le <th> di index.html (viste tecniche) o nella head[] di buildFundTable (viste
   fondamentali). Un'etichetta orfana = colonna che sparisce dalle card iPhone senza errori
   (già successo: "P/E TTM"/"Marg.netto"/"Cresc.ricavi" vs "P/E"/"Margine netto"/"Cresc. ricavi"). */
{
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const thLabels = (id) => {
    const m = html.match(new RegExp(`<table id="${id}"[\\s\\S]*?<thead>([\\s\\S]*?)</thead>`));
    return m ? [...m[1].matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(x => x[1].replace(/&amp;/g, "&").trim()) : [];
  };
  const headStmt = src.match(/const head = \(withQtyPmc[\s\S]*?\]\);/);
  const fundLabels = headStmt ? [...headStmt[0].matchAll(/"([^"]+)"/g)].map(x => x[1]) : [];
  const all = new Set([...thLabels("ptf-table"), ...thLabels("wl-table"), ...fundLabels]);
  const keys = run("[...MOBILE_KEY_COLS]");
  const orphans = keys.filter(k => !all.has(k));
  check("MOBILE_KEY_COLS: nessuna etichetta orfana (card iPhone)", fundLabels.length > 5 && keys.length > 5 && orphans.length === 0);
  if (orphans.length) console.log("  ⚠ etichette senza colonna reale:", orphans.join(", "));
  // le card watchlist devono mostrare gli stessi campi del portafoglio (meno Guadagno/Guad. %,
  // che la watchlist non ha per natura) — richiesta esplicita utente (STEP1 mobile)
  const wl = new Set(thLabels("wl-table"));
  const missingWl = thLabels("ptf-table").filter(l => keys.includes(l) && !["Guad. %", "Guadagno"].includes(l) && !wl.has(l));
  check("card mobile watchlist ≡ portafoglio (vista tecnica)", missingWl.length === 0);
  if (missingWl.length) console.log("  ⚠ colonne chiave del portafoglio assenti dalla watchlist:", missingWl.join(", "));
}

/* ---------- SAFE BY DESIGN v115 (post-incidente SNDK $40,1 / stop -$366) ---------- */
check("paracadute: supporto recente in banda → usato tal quale, nessun fallback", run(`
  const p = saneEntryLimit({ price: 100, support: 95, tech_by_range: { m1: { support: 92 } } });
  return p.limit === 95 && p.fallback === false`));
check("paracadute: supporti fuori banda ±25% → fallback SMA50, dichiarato", run(`
  const p = saneEntryLimit({ price: 100, support: 40, tech_by_range: { m1: { support: 35 } }, sma50_dist_pct: 5 });
  return Math.abs(p.limit - 95.24) < 0.01 && p.fallback === true && p.src === "SMA50"`));
check("paracadute: nessun dato utilizzabile → -5% dal prezzo, dichiarato", run(`
  const p = saneEntryLimit({ price: 100, support: 2 });
  return p.limit === 95 && p.fallback === true && p.src.includes("-5%")`));
check("INCIDENTE SNDK: il piano d'ingresso IGNORA il range del grafico (sparkRange='y1')", run(`
  const wl = DATA.watchlist.find(r => r.ticker === "TSTW");
  wl.tech_by_range = { y1: { support: 2, resistance: 200 } };   // minimo preistorico alla SNDK
  const oldRange = sparkRange; sparkRange = "y1";
  const dv = decisionVerdict();
  sparkRange = oldRange; delete wl.tech_by_range.y1;
  const p = dv.withPlan.find(x => x.r.ticker === "TSTW");
  return p && p.limit === 95 && p.stop > 0 && p.stop < p.limit`));
check("scudo sotto-zero: 2×ATR ≥ prezzo → stop al pavimento 50%, flaggato", run(`
  const st = atrStop(100, { atr_14: 60, price: 100 });
  return st && st.stop === 50 && st.src.includes("PAVIMENTO")`));
check("null-storm: riga con SOLE quotazioni (tutte le metriche assenti) → niente crash, niente undefined", run(`
  DATA.watchlist.push({ ticker: "TSTN", name: "Null Storm", currency: "USD", price: 10,
    sparks: {}, tech_by_range: {}, financials: [] });
  let ok = true, p = "";
  try { decisionVerdict(); p = buildPrompt(); } catch (e) { ok = false; }
  DATA.watchlist = DATA.watchlist.filter(r => r.ticker !== "TSTN");
  return ok && p.includes("TSTN") && !p.includes("undefined") && !/\\bNaN\\b/.test(p)`));

check("v118 coerenza riga: stop teorico watchlist ancorato al LIMITE d'ingresso, MAI sopra (incidente SNDK)", run(`
  // SNDK-like: ATR alto, supporto profondo — lo stop-da-prezzo uscirebbe SOPRA il limite
  DATA.watchlist.push({ ticker: "TSTK", name: "HiATR", currency: "USD", price: 1916,
    support: 1485, resistance: 2354, atr_14: 203, atr_pct: 10.6, rsi: 52, vol_ratio: 0.9,
    sharpe_1y: 3.5, sortino_1y: 5.9, signal: "Trend rialzista", signal_class: "good",
    sma50_dist_pct: 5, stats: { roe: 0.39, profit_margin: 0.34, peg: 1.3, market_cap: 5e10 },
    sparks: {}, tech_by_range: {}, financials: [] });
  const p = buildPrompt();
  DATA.watchlist = DATA.watchlist.filter(r => r.ticker !== "TSTK");
  const row = p.split("\\n").find(l => l.startsWith("| HiATR"));
  const m = row.match(/\\$(\\d+(?:[.,]\\d+)?) \\(teorico\\)/);
  const stop = m ? parseFloat(m[1].replace(",", ".")) : null;
  const limit = 1485, entryStop = 1485 - 2 * 203;   // ancorato al supporto d'ingresso
  return stop != null && stop < limit && Math.abs(stop - entryStop) < 1`));

/* ---------- report ---------- */
let fail = 0;
for (const [name, ok] of T) {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
console.log(`\n${T.length - fail}/${T.length} check superati`);
process.exit(fail ? 1 : 0);
