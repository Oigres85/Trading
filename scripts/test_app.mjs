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
  // v200: si verifica che il FILTRO scatti e perche', non come si chiama l'etichetta.
  return v && v.verdict && /FILTRO QUALIT|VALUE TRAP/.test(v.verdict) && /Sortino/.test(v.why[0])`));
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
check("coerenza cassa↔verdetto v123: candidati PRONTI + cassa 0 → stato LIQUIDITÀ, non il falso 'nessun candidato'", run(`
  const savedCash = cashEur; cashEur = 0; recomputeTotals();
  const dv = decisionVerdict();
  cashEur = savedCash; recomputeTotals();
  return dv.accumula.length >= 1 && dv.label === "LIQUIDITÀ" &&
    dv.reasons.some(s => s.includes("PRONTI") && s.includes("liquidità esaurita")) &&
    !dv.reasons.some(s => s.includes("nessun candidato migliora abbastanza"))`));
check("coerenza cassa↔verdetto v123: con cassa sufficiente e ordini eseguibili → ACCUMULA", run(`
  const dv = decisionVerdict();   // fixture: cashEur 10000, candidati con withPlan eseguibile
  return dv.label === "ACCUMULA" && dv.withPlan.length > 0`));
check("sizing regime-aware: VIX 27 dimezza il budget d'ingresso (TSTW, watchlist)", run(`
  const q1 = (decisionVerdict().withPlan.find(p => p.r.ticker === "TSTW") || {}).qty || 0;
  DATA.macro.vix.value = 27;
  const q2 = (decisionVerdict().withPlan.find(p => p.r.ticker === "TSTW") || {}).qty || 0;
  DATA.macro.vix.value = 15;
  return q1 > 0 && q2 > 0 && q2 <= Math.ceil(q1 * 0.55)`));
check("cap d'ingresso v121: TST1 (peso ≥10% NAV) NON è candidato ad accumulo (divieto di NUOVI acquisti)", run(`
  const dv = decisionVerdict();
  return !dv.accumula.some(r => r.ticker === "TST1") &&
    dv.overCap.some(x => x.r.ticker === "TST1") &&
    dv.reasons.some(s => s.includes("cap d'ingresso") && s.includes("TST1") && s.includes("Let Winners Run"))`));
check("Let Winners Run v121: una posizione tra 10% e 25% NON genera trim né alert (cresce libera)", run(`
  // porto TST1 a un peso tra 10% e 25% (qty 28 → ~15%): overCap (no accumulo) MA nessun alert
  const r = DATA.portfolio.find(x => x.ticker === "TST1");
  const oldQty = r.qty; r.qty = 28; recomputeTotals();
  const dv = decisionVerdict();
  const w = positionWeightPct(r);
  r.qty = oldQty; recomputeTotals();
  return w > 10 && w < 25 &&
    dv.overCap.some(x => x.r.ticker === "TST1") &&
    !dv.concentrationAlert.some(x => x.r.ticker === "TST1") &&
    !dv.reasons.some(s => s.includes("ALERT CONCENTRAZIONE"))`));
check("alert concentrazione v121: SOLO sopra il 25% del NAV, come avviso (non trim)", run(`
  // gonfio TST1 oltre il 25%: deve comparire l'alert concentrazione, mai un obbligo di trim
  const r = DATA.portfolio.find(x => x.ticker === "TST1");
  const oldQty = r.qty; r.qty = 1000; recomputeTotals();
  const dv = decisionVerdict();
  r.qty = oldQty; recomputeTotals();
  return dv.concentrationAlert.some(x => x.r.ticker === "TST1") &&
    dv.reasons.some(s => s.includes("ALERT CONCENTRAZIONE") && s.includes("NON è un obbligo di trim"))`));

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
  // v200: si verifica che il FILTRO scatti e perche', non come si chiama l'etichetta.
  return v && !v.rehab && !!v.verdict && /FILTRO QUALIT|VALUE TRAP/.test(v.verdict)`));
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
check("prompt v112→v180: col diario popolato il payload dichiara quale fonte è autoritativa (nota, non istruzione)", run(`
  const saved = localStorage.getItem("action_diary");
  localStorage.setItem("action_diary", JSON.stringify([{ date: new Date().toISOString(), text: "comprato 10 TST1 a 100" }]));
  const p = buildPrompt();
  if (saved == null) localStorage.removeItem("action_diary"); else localStorage.setItem("action_diary", saved);
  // v180: niente più imperativi nel payload ("INCROCIA", "segnala", "chiedi conferma" stavano
  // nella testata e qui erano un doppione); resta il FATTO su quale fonte prevale.
  return p.includes("DIARIO DELLE AZIONI") && p.includes("la Tabella A è la fonte autoritativa")
      && !/INCROCIA il diario/.test(p) && !/chiedi conferma al CEO/.test(p)`));
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
check("prompt: colonna Sortino 1A (6M) nella tabella PORTAFOGLIO", has("| Sortino 1A (6M) |"));
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
// v184: il blocco CINEMATICA DEI SEGNALI è stato RIMOSSO perché ripeteva 21 numeri su 21.
// Il test non verifica più che il blocco esista — verifica che i FATTI che portava siano ancora
// nel payload, prodotti dai blocchi che li avevano già. È la forma giusta di questo test: se un
// domani sparisse anche una di queste, il taglio avrebbe perso informazione e lo saprei subito.
check("prompt v184: il blocco CINEMATICA DEI SEGNALI non c'è più, e la term structure resta", run(`
  const p = buildCIOText();
  // Le altre grandezze che il blocco ripeteva (ΔRS, ΔMCR, ΔSharpe, MCR Top-3) hanno bisogno di
  // sparks e storico che questo fixture non ha: la loro sopravvivenza si verifica sui dati VERI,
  // in coherence_check C12. Qui si asserisce solo ciò che il fixture può davvero produrre —
  // un test che pretende dati inesistenti fallisce per il motivo sbagliato.
  // (anche VIX/VIX3M dipende da macro.vix_term, assente in questo fixture: sta in C12)
  return !p.includes("CINEMATICA DEI SEGNALI") && !p.includes("CONTESTO ECONOMIA USA") && !p.includes("TOP 10 ETF")`));
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
  // v188: le viste "Tecnica & Prezzi" e "Fondamentale (Value)" sono diventate UNA tabella, quindi
  // buildFundTable non esiste piu' e TUTTE le etichette vivono nelle <th> di index.html. Il test
  // ne esce piu' forte: una sola fonte da confrontare invece di due che potevano divergere.
  const all = new Set([...thLabels("ptf-table"), ...thLabels("wl-table")]);
  const keys = run("[...MOBILE_KEY_COLS]");
  const orphans = keys.filter(k => !all.has(k));
  check("MOBILE_KEY_COLS: nessuna etichetta orfana (card iPhone)", all.size > 20 && keys.length > 5 && orphans.length === 0);
  /* v208 — QUESTA GUARDIA HA CAMBIATO INVARIANTE, e la ragione conta.
     Prima chiedeva "le 13 colonne fondamentali esistono nella tabella". Ma la tabella è un
     modo di MOSTRARE un fatto, non il fatto: quando in v208 le colonne che l'LLM riceve già
     dal payload sono state tolte dalla pagina, quella guardia sarebbe scattata su un taglio
     corretto — e riscriverla per farla tacere sarebbe stato il modo classico di perdere la
     protezione (v203: togliere una guardia mentre si toglie una funzionalità).
     Ora chiede la cosa che conta davvero: OGNI fatto fondamentale deve restare raggiungibile,
     o dal payload (se l'LLM lo riceve) o dalla tabella (se vive solo lì). Se un domani sparisce
     da entrambi, il fatto è uscito dal sistema e il check lo dice. */
  const payload = run("buildPrompt()");
  const FATTI = [
    ["Market Cap", /market ?cap|Mkt ?Cap|\bCap\.?\b/i], ["P/E", /\bP\/E\b/],
    ["EV/EBITDA", /EV\/EBITDA/i], ["ROE", /\bROE\b/], ["Margine netto", /margine|margin/i],
    ["P/FCF", /P\/FCF/i], ["Cresc. ricavi", /ricavi|revenue/i], ["PEG", /\bPEG\b/],
    ["Z-Score", /altman|z.?score/i], ["Target Δ", /target/i],
    ["Debt/Equity", /debt.?\/?.?equity|\bD\/E\b/i], ["Div Yield", /div\.? ?yield|dividend/i],
    ["Financial Health", /fin\.? ?health|financial ?health|salute/i],
  ];
  // ⚠ si guarda la tabella del PORTAFOGLIO, non l'unione delle due: un fatto che resta solo
  // in watchlist non è più visibile su cio' che possiedi davvero. La prima stesura univa le
  // due tabelle e infatti NON ha morso quando ho iniettato la perdita (il fatto sopravviveva
  // nella watchlist) — un check si valida iniettando il difetto, non rileggendolo.
  const inPtf = new Set(thLabels("ptf-table"));
  const sparite = FATTI.filter(([lab, re]) => !inPtf.has(lab) && !re.test(payload)).map(([l]) => l);
  check("v208 nessun fatto fondamentale è uscito dal sistema (o è nel payload, o è in tabella)",
        sparite.length === 0);
  if (sparite.length) console.log("  ⚠ fatti spariti da payload E tabella:", sparite.join(", "));
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

check("v119 stop provvisorio: posizione detenuta senza ATR (SKHYV IPO) NON resta senza protezione", run(`
  DATA.portfolio.push({ ticker: "TSTIPO", name: "IPO Fresca", currency: "USD", qty: 50, pmc: 168, price: 168,
    bval: 8400, signal: "Neutrale", signal_class: "neutral", sparks: {}, tech_by_range: {}, financials: [] });
  const s = stopOf(DATA.portfolio.find(r => r.ticker === "TSTIPO"));
  DATA.portfolio = DATA.portfolio.filter(r => r.ticker !== "TSTIPO");
  return s && Math.abs(s.stop - 168 * 0.88) < 0.5 && s.ratchet === false && s.src.includes("provvisorio")`));
check("v119 tracciabilità: la riga Livelli porta prezzo, limite e stop sulla stessa riga (R/R se presente)", run(`
  // il candidato del fixture ha risk_reward → R/R deve comparire
  DATA.watchlist.forEach(r => { if (r.ticker === "TSTW") r.risk_reward = "1:2.5"; });
  const p = buildPrompt();
  DATA.watchlist.forEach(r => { if (r.ticker === "TSTW") delete r.risk_reward; });
  const liv = p.split("\\n").find(l => l.includes("Livelli calcolati"));
  // v160: fra limite e stop può comparire la distanza dal prezzo "(-6,4% dal prezzo)" → regex tollerante
  return liv && /prezzo \\$[\\d.,]+ → limite d'ingresso \\$[\\d.,]+[^/]*\\/ stop \\$[\\d.,]+/.test(liv) && liv.includes("/ R/R 1:2.5")`));
check("v160 livelli: il target porta la sua DISTANZA dal prezzo e il limite la propria (un target al prezzo è flaggato)", run(`
  const saved = {};
  DATA.watchlist.forEach(r => { if (r.ticker === "TSTW") { saved.res = r.resistance; r.resistance = r.price * 1.005; } });
  const p = buildPrompt();
  DATA.watchlist.forEach(r => { if (r.ticker === "TSTW") r.resistance = saved.res; });
  const liv = p.split("\\n").find(l => l.includes("Livelli calcolati"));
  // resistenza a +0,5% dal prezzo → deve comparire la distanza E l'avviso che il R/R non è spazio di salita
  return liv != null && /dal prezzo,/.test(liv) && /dal limite\\)/.test(liv)
      && liv.includes("il target è di fatto AL PREZZO ATTUALE")`));
check("v121 cap d'ingresso nel prompt: ≥10% = solo divieto acquisti (Let Winners Run), niente trim forzato", run(`
  const p = buildPrompt();   // TST1 al 38% nel fixture → riga cap d'ingresso, NON riga trim
  const cap = p.split("\\n").find(l => l.includes("Cap d'ingresso") && l.includes("solo DIVIETO di nuovi acquisti"));
  return cap && cap.includes("stop ratchet 2×ATR") && !p.includes("trimming di rientro")`));
check("v121 alert concentrazione nel prompt: >25% = avviso con disciplina ordini-limite, mai a mercato", run(`
  const p = buildPrompt();
  const al = p.split("\\n").find(l => l.startsWith("· ⚠ ALERT CONCENTRAZIONE"));
  return al && al.includes("NON obbligo di trim") && al.includes("mai a mercato")`));

// ---- v125: shock alert, [LIVE], futures, stop-a-rischio orario esteso ----
check("v125→v145 shock alert: il SEGNALE DI SHOCK sta in CIMA (prima della situazione patrimoniale), NON è un ordine", run(`
  DATA.macro.shock_alert = { active: true, threshold: 2, sources: [{ src: "KOSPI (Asia)", chg: -8.9 }] };
  const p = buildPrompt();
  delete DATA.macro.shock_alert;
  const line = p.split("\\n").find(l => l.includes("[SEGNALE DI SHOCK"));
  // in cima (prima del patrimonio), col dato sorgente, MA senza l'ordine di sospensione (reframe A4)
  return line && line.includes("KOSPI (Asia)") && !line.includes("SOSPENDI gli ordini") &&
    p.indexOf("[SEGNALE DI SHOCK") < p.indexOf("SITUAZIONE PATRIMONIALE")`));
check("v125 tag [LIVE]: prezzo live-market marcato [LIVE], non [chiusura del]", run(`
  const wl = DATA.watchlist.find(r => r.ticker === "TSTW");
  wl.price_live = true; wl.price_asof = "2020-01-01";
  const p = buildPrompt();
  delete wl.price_live; delete wl.price_asof;
  const row = p.split("\\n").find(l => l.startsWith("| ") && l.includes("(TSTW)"));
  return row && row.includes("[LIVE]") && !row.includes("[chiusura del")`));
check("v125 futures nel prompt: NQ/ES live come leading pre-apertura", run(`
  DATA.macro.futures = { nasdaq: { price: 20000, change_pct: -2.4 }, sp500: { price: 6500, change_pct: -1.1 } };
  const p = buildPrompt();
  delete DATA.macro.futures;
  return p.includes("Futures USA LIVE") && p.includes("Nasdaq 100 (NQ)")`));
check("v125 stop a rischio orario esteso: prepost >1% a ridosso dello stop → flag nel nome", run(`
  const r = DATA.portfolio.find(x => x.ticker === "TST1");
  const st = stopOf(r);
  const saved = r.prepost;
  r.prepost = { label: "after", price: st.stop * 1.01, change_pct: -3.2 };   // sotto la soglia 2% dallo stop
  const p = buildPrompt();
  r.prepost = saved;
  const row = p.split("\\n").find(l => l.includes("(TST1)"));
  return row && row.includes("[STOP A RISCHIO AFTER");`));

check("v126 froth: alert schiuma speculativa nel prompt con direttiva (no acquisti tech, solo ratchet, ES95 salva)", run(`
  DATA.macro.froth = { soxl: { symbol: "SOXL", rvol: 3.1, chg_5d_pct: 12.4 }, tqqq: { symbol: "TQQQ", rvol: 1.2, chg_5d_pct: 4 },
    alert: true, note: "Volume estremo in acquisto sugli ETF a leva 3x (SOXL RVol 3.1× / +12.4% 5g)." };
  const p = buildPrompt();
  delete DATA.macro.froth;
  const l = p.split("\\n").find(x => x.includes("[SPECULATIVE FROTH ALERT]"));
  return l && l.includes("SOXL") && l.includes("NON impegnare il budget") && l.includes("Stop Ratchet") && l.includes("ES95")`));
check("v126 breadth: divergenza SPY/RSP nel prompt con direttiva prudenza; forma neutra senza alert", run(`
  DATA.macro.breadth = { spy_1m_pct: 2.6, rsp_1m_pct: -0.8, divergence_pp: 3.4, alert: true, note: "Rally retto dalle megacap." };
  const p1 = buildPrompt();
  DATA.macro.breadth = { spy_1m_pct: 2.6, rsp_1m_pct: 1.9, divergence_pp: 0.7, alert: false };
  const p2 = buildPrompt();
  delete DATA.macro.breadth;
  return p1.includes("[BREADTH DIVERGENCE]") && p1.includes("prudenza sui nuovi ingressi") &&
    !p2.includes("[BREADTH DIVERGENCE]") && p2.includes("Ampiezza di mercato")`));

/* ---------- v130: Analisi AI a bottone unico (buildCIOText + digest storici) ---------- */
check("CIO v130: buildCIOText = prompt esistente + ANALISI STORICA + FONDAMENTALE PROFONDO (ingloba il prompt AI)", run(`
  const t = buildCIOText();
  return t.includes("ANALISI STORICA") && t.includes("FONDAMENTALE PROFONDO")
      && t.indexOf("ANALISI STORICA") > t.length / 2 && t.includes(buildPrompt().slice(0, 200))`));
check("CIO v128: digest null-safe — fixture senza serie storiche → '—', mai undefined/NaN", run(`
  const t = historicalDigestText();
  return !t.includes("undefined") && !/\\bNaN\\b/.test(t) && t.includes("—")`));
check("CIO v128: digest Margin Debt calcola pendenze da history (Δ1M +10%, Δ6M +25%)", run(`
  const saved = DATA.macro.margin_debt;
  DATA.macro.margin_debt = { history: [100, 100, 100, 100, 100, 100, 104, 110, 110, 112, 115, 118, 125, 137.5], yoy: 37.5, qoq: 10, pct_of_peak: 100 };
  const d = buildHistoricalDigests().find(x => x.label.startsWith("Margin Debt"));
  DATA.macro.margin_debt = saved;
  return d.text.includes("+10") && d.text.includes("+25") && d.text.includes("espansione")`));
check("CIO v128: digest HY OAS — percentile nel range e allarme compressione", run(`
  const saved = DATA.macro.credit;
  DATA.macro.credit = { spread_hy: 2.7, history: Array.from({length: 250}, (_, i) => ({ d: "x", v: 2.7 + (i % 50) / 50 })) };
  const d = buildHistoricalDigests().find(x => x.label.startsWith("HY OAS"));
  DATA.macro.credit = saved;
  return d.text.includes("percentile 0°") && d.text.includes("compressione estrema")`));
check("CIO v130: sparkTrendRows calcola la variazione % first→last per range (serie abbastanza lunghe) e marca [ptf]", run(`
  const saved = DATA.portfolio[0].sparks;
  DATA.portfolio[0].sparks = { m1: Array.from({length: 20}, (_, i) => 100 + i * (10/19)), y1: Array.from({length: 46}, (_, i) => 200 - i * (50/45)) };
  const r = sparkTrendRows().find(x => x.tk === "TST1");
  DATA.portfolio[0].sparks = saved;
  return r && Math.round(r.m1) === 10 && Math.round(r.y1) === -25 && r.held === true && r.w1 === null && r.short === false`));
check("CIO v130: sparkTrendRows scarta gli orizzonti a storia insufficiente (titolo appena quotato) e li marca", run(`
  const saved = DATA.portfolio[0].sparks;
  DATA.portfolio[0].sparks = { w1: [100, 98, 95, 91], m1: [100, 98, 95, 91], m3: [100, 98, 95, 91], y1: [100, 98, 95, 91] };
  const r = sparkTrendRows().find(x => x.tk === "TST1");
  DATA.portfolio[0].sparks = saved;
  return r && r.w1 !== null && r.m1 === null && r.m3 === null && r.y1 === null && r.short === true`));
check("shock v141→v176: il KOSPI entra solo se Seoul è DAVVERO in sessione; 'live' fuori orario è un fantasma", run(`
  const savedW = DATA.watchlist, savedM = DATA.macro.futures;
  DATA.macro.futures = { nasdaq: { change_pct: -3 }, sp500: { change_pct: -0.5 } };
  const inSessione = seoulSessionOpen();
  DATA.watchlist = [{ ticker: "^KS11", change_pct: -8, price_live: true }];
  const sLive = shockSourcesLive();
  DATA.watchlist = [{ ticker: "^KS11", change_pct: -8, price_live: false, price_asof: "2026-07-16" }];
  const sStantia = shockSourcesLive();          // candela vecchia: sempre scartata
  DATA.watchlist = [{ ticker: "^KS11", change_pct: 0, price_live: true }];
  const sRecuperato = shockSourcesLive();       // nessun crollo: niente fonte KOSPI
  DATA.watchlist = savedW; DATA.macro.futures = savedM;
  const kospiIn = (a) => a.some(x => x.src === "KOSPI (Asia)");
  // il flag "live" vale SOLO dentro l'orario di Seoul: fuori sessione è l'ultimo scambio, non una notizia
  return kospiIn(sLive) === inSessione && !kospiIn(sStantia) && !kospiIn(sRecuperato)
      && sStantia.length === 1 && sRecuperato.length === 1`));
check("shock client v132: usRegularSessionOpen — 12:00 ET feriale aperto, 20:00 ET chiuso, sabato chiuso", run(`
  return usRegularSessionOpen(new Date("2026-07-17T16:00:00Z")) === true
      && usRegularSessionOpen(new Date("2026-07-18T00:00:00Z")) === false
      && usRegularSessionOpen(new Date("2026-07-18T16:00:00Z")) === false`));
check("CIO v128: titleDeepData — CAGR ricavi dai financials pluriennali e EPS ttm→fwd", run(`
  const d = titleDeepData({ ticker: "TSTX", price: 100,
    financials: [{ year: 2022, revenue: 100, net_income: 10 }, { year: 2025, revenue: 200, net_income: -5 }],
    stats: { eps_ttm: 5, eps_forward: 8, forward_pe: 12, peg: 1.1, revenue_growth: 0.2, target_mean: 130 } });
  return Math.round(d.revCagr) === 26 && d.niCagr === null && d.epsG === 60 && d.upside === 30 && d.span === 3`));

/* ---------- v136: tag [⚡ASIMM] (volatilità asimmetrica) + Polymarket Δ7g ---------- */
check("ASIMM: Sortino>1,7×Sharpe (entrambi>0) e RSI>55 → true; ratio basso / Sharpe≤0 / RSI≤55 → false", run(`
  return isAsimm({ sharpe_1y: 1, sortino_1y: 2, rsi: 60 }) === true
      && isAsimm({ sharpe_1y: 1, sortino_1y: 1.5, rsi: 60 }) === false
      && isAsimm({ sharpe_1y: -1, sortino_1y: -2, rsi: 60 }) === false
      && isAsimm({ sharpe_1y: 1, sortino_1y: 2, rsi: 50 }) === false`));
check("ASIMM: signalTxt appende il tag solo ai titoli qualificati", run(`
  return signalTxt({ signal: "Sopra SMA50", sharpe_1y: 1, sortino_1y: 2, rsi: 60 }).includes("[⚡ASIMM]")
      && !signalTxt({ signal: "Neutrale", sharpe_1y: 1, sortino_1y: 1.2, rsi: 60 }).includes("ASIMM")`));
check("ASIMM: compare nella Tabella A del prompt per una posizione qualificata", run(`
  const r = DATA.portfolio.find(x => x.qty);
  const s1 = r.sharpe_1y, so1 = r.sortino_1y, rsi = r.rsi;
  r.sharpe_1y = 1; r.sortino_1y = 2.5; r.rsi = 60;
  const has = buildPrompt().includes("[⚡ASIMM]");
  r.sharpe_1y = s1; r.sortino_1y = so1; r.rsi = rsi;
  return has`));
check("Polymarket Δ7g: con storico di ≥7g calcola il delta; senza storico → null", run(`
  const d8 = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);   // 8 giorni fa (≤ target 7g)
  const d0 = new Date().toISOString().slice(0, 10);                            // oggi (dopo il target)
  localStorage.setItem("polymarket_hist", JSON.stringify({ "Q1?": [[d8, 91], [d0, 95]] }));
  const withHist = pmDelta7("Q1?", 95);
  const noHist = pmDelta7("Q-inesistente?", 50);
  localStorage.removeItem("polymarket_hist");
  return withHist === 4 && noHist === null`));
check("Polymarket Δ7g: la riga del prompt riporta [Δ7g …] su ogni scommessa", run(`
  const saved = DATA.predictions;
  DATA.predictions = [{ question: "Fed no change?", yes: 95 }];
  const p = buildPrompt();
  DATA.predictions = saved;
  return p.includes("[Δ7g")`));

/* ---------- v137: VALIDATORE DEL RITORNO (report AI → invarianti) ---------- */
check("validatore: parseMoneyLoose gestisce formati it/en/semplici", run(`
  return parseMoneyLoose("1.325,03") === 1325.03 && parseMoneyLoose("1,325.03") === 1325.03
      && parseMoneyLoose("626") === 626 && parseMoneyLoose("626,5") === 626.5
      && parseMoneyLoose("$1.325") === 1325 && parseMoneyLoose("") === null`));
check("validatore: parseAIOrders estrae ticker/qty/limite/stop dal formato canonico della testata", run(`
  const o = parseAIOrders("[TST1] — COMPRA ~14 quote a limite $95,50 con stop $88 (payload: ...)");
  return o.length === 1 && o[0].tk === "TST1" && o[0].action === "BUY" && o[0].qty === 14
      && o[0].limit === 95.5 && o[0].stop === 88`));
check("validatore: ordine sano su fixture → nessuna violazione hard", run(`
  const v = validateAIOrders([{ tk: "TSTW", action: "BUY", qty: 5, limit: 95, stop: 88 }]);
  return v.rows[0].level !== "hard" && v.budget.ok`));
check("validatore: ticker allucinato → hard", run(`
  const v = validateAIOrders(parseAIOrders("ZZZQ — COMPRA ~10 quote a limite $50 con stop $45"));
  return v.rows.length === 0 || v.rows.every(r => r.level !== "ok")`));
check("validatore: stop ≥ limite → hard (ordine long impossibile)", run(`
  const v = validateAIOrders([{ tk: "TSTW", action: "BUY", qty: 5, limit: 90, stop: 95 }]);
  return v.rows[0].level === "hard" && v.rows[0].msgs.some(m => m.includes("impossibile"))`));
check("validatore: limite oltre il 30% sotto il prezzo → hard (classe SNDK)", run(`
  const r = DATA.watchlist.find(x => x.ticker === "TSTW");
  const v = validateAIOrders([{ tk: "TSTW", action: "BUY", qty: 5, limit: Math.round(r.price * 0.6), stop: Math.round(r.price * 0.5) }]);
  return v.rows[0].level === "hard" && v.rows[0].msgs.some(m => m.includes("30%"))`));
check("validatore: vendita di titolo non detenuto (watchlist) → hard", run(`
  const v = validateAIOrders([{ tk: "TSTW", action: "SELL", qty: 5, limit: null, stop: null }]);
  return v.rows[0].level === "hard" && v.rows[0].msgs.some(m => m.includes("NON detenuto"))`));
check("validatore: acquisto su titolo in VETO (TST2 value trap) → hard", run(`
  const v = validateAIOrders([{ tk: "TST2", action: "BUY", qty: 5, limit: 95, stop: 88 }]);
  return v.rows[0].level === "hard" && v.rows[0].msgs.some(m => m.includes("VETO"))`));

/* ---------- v138: pulizia payload (streghe condizionali, tagli, buyback, curva) ---------- */
check("v138 streghe: nel prompt SOLO se <30 giorni; a 62g sparisce", run(`
  DATA.macro.witching = { next: "2026-09-18", days: 62 };
  const far = buildPrompt();
  DATA.macro.witching = { next: "2026-09-18", days: 12 };
  const near = buildPrompt();
  delete DATA.macro.witching;
  return !far.includes("4 streghe") && near.includes("4 streghe") && near.includes("tra 12 gg")`));
check("v138 tagli: TOP 10 CAPITALIZZAZIONI ed EUR/JPY fuori dal payload", run(`
  DATA.top_caps = [{ ticker: "AAPL", name: "Apple", mcap_usd: 4.8e12, change_pct: 1 }];
  DATA.macro.markets = [{ label: "EUR/JPY", value: "185.76", change_pct: -0.1 }, { label: "EUR/USD", value: "1.14", change_pct: 0.1 }];
  const p = buildPrompt();
  DATA.top_caps = []; DATA.macro.markets = [];
  return !p.includes("TOP 10 CAPITALIZZAZIONI") && !p.includes("EUR/JPY") && p.includes("EUR/USD")`));
check("v138 buyback: colonna Buyback% nella tabella fondamentale, [DILUISCE] se negativo", run(`
  const r = DATA.portfolio.find(x => x.stats?.market_cap);
  const saved = r.stats.buyback_yield;
  r.stats.buyback_yield = -0.02;
  const p = buildPrompt();
  r.stats.buyback_yield = saved;
  return p.includes("| Buyback% |") && p.includes("[DILUISCE]") && p.includes("riacquisti NETTI")`));
check("v138 curva: riga indicators etichettata GIORNALIERA (non più 'serie mensile')", run(`
  const saved = DATA.macro.indicators;
  DATA.macro.indicators = [{ key: "curve", label: "Curva 10A-2A", value: "+0.41 pp", date: "2026-07-16" }];
  const p = buildPrompt();
  DATA.macro.indicators = saved;
  return p.includes("serie GIORNALIERA FRED T10Y2Y") && !p.includes("Curva 10A-2A: +0.41 pp (rilevazione 2026-07-16 — serie mensile")`));

/* ---------- v139: benchmark nel brief + attribuzione ---------- */
check("v139 benchmark: l'executive brief apre col confronto fondo vs Nasdaq (null-safe senza QQQ)", run(`
  const b = buildExecutiveDelta();
  return b.includes("BENCHMARK vs Nasdaq") && b.includes("pagella") === false && !b.includes("undefined")`));
check("v145 benchmark: UNIFICATO a Nasdaq 100 (QQQ) su tutte le finestre — niente più Composite/mix di indici", run(`
  DATA.top_etfs = (DATA.top_etfs || []).concat([{ ticker: "QQQ", change_pct: -1.5, sparks: { w1: [100, 99, 98, 97.5], m1: Array.from({length: 20}, (_, i) => 100 - i * 0.2) } }]);
  const b = buildExecutiveDelta();
  DATA.top_etfs = DATA.top_etfs.filter(r => r.ticker !== "QQQ");
  return b.includes("vs Nasdaq 100") && b.includes("vs NDX -2,5%") && !b.includes("Composite")`));

/* ---------- v143: editor parametri di rischio (override localStorage → RISK_PARAMS) ---------- */
check("v143 risk editor: override valido muta RISK_PARAMS (capNoAdd 10→15) e la frazione scala (sector 75→60%)", run(`
  const saved = { cap: RISK_PARAMS.capNoAdd_pct, sec: RISK_PARAMS.sectorAlert_frac };
  localStorage.setItem("risk_params_overrides", JSON.stringify({ capNoAdd_pct: 15, sectorAlert_frac: 0.60 }));
  applyRiskOverrides();
  const ok = RISK_PARAMS.capNoAdd_pct === 15 && Math.abs(RISK_PARAMS.sectorAlert_frac - 0.60) < 1e-9;
  localStorage.removeItem("risk_params_overrides");
  RISK_PARAMS.capNoAdd_pct = saved.cap; RISK_PARAMS.sectorAlert_frac = saved.sec;
  return ok`));
check("v143 risk editor: valori fuori banda o non numerici vengono IGNORATI (protezione capitale)", run(`
  const saved = { cap: RISK_PARAMS.capNoAdd_pct, veto: RISK_PARAMS.sortinoVeto };
  localStorage.setItem("risk_params_overrides", JSON.stringify({ capNoAdd_pct: 99, sortinoVeto: "abc" }));
  applyRiskOverrides();
  const ok = RISK_PARAMS.capNoAdd_pct === saved.cap && RISK_PARAMS.sortinoVeto === saved.veto;
  localStorage.removeItem("risk_params_overrides");
  return ok`));
check("v143 risk editor: l'override del cap cambia DAVVERO il verdetto (posizione 38% NAV con cap 45 → accumulabile)", run(`
  const saved = RISK_PARAMS.capNoAdd_pct;
  RISK_PARAMS.capNoAdd_pct = 45;                       // TST1 pesa ~38%: sotto il nuovo cap
  const v1 = decisionVerdict();
  RISK_PARAMS.capNoAdd_pct = 5;                        // cap severo: TST1 bloccata
  const v2 = decisionVerdict();
  RISK_PARAMS.capNoAdd_pct = saved;
  const in1 = (v1.accumula || []).some(r => r.ticker === "TST1");
  const in2 = (v2.accumula || []).some(r => r.ticker === "TST1");
  return in1 === true && in2 === false`));

/* ---------- v143.1: guardia headless dell'editor rischio (regressione log_verdict) ---------- */
check("v143.1 rpShownValue null-safe: def assente → '' (non crasha su d.key)", run(`
  return rpShownValue(undefined) === "" && rpShownValue(null) === ""
      && rpShownValue(RISK_PARAM_DEFS[0]) === RISK_PARAMS.capNoAdd_pct`));
check("v143.1 initRiskEditor: con select senza .value stringa (stub CI) esce senza eccezioni", run(`
  const orig = document.querySelector;
  document.querySelector = (sel) => (sel === "#rp-param" || sel === "#rp-value" || sel === "#rp-desc")
    ? { addEventListener() {}, innerHTML: "" }   // stub SENZA .value (come l'harness log_verdict)
    : orig(sel);
  let ok = true;
  try { initRiskEditor(); } catch { ok = false; }
  document.querySelector = orig;
  return ok`));

/* ---------- v144: screener idee di rotazione + gradazione veto ---------- */
check("v144 screener: il blocco IDEE DI ROTAZIONE compare nel prompt con i dati del candidato", run(`
  const saved = DATA.screener;
  DATA.screener = [{ ticker: "LLY", name: "Eli Lilly", sector_name: "Salute", sector_etf: "XLV", sector_m1: 5.8,
    price: 900, m1_pct: 4.2, rs_ndx_1m: 6.1, roe_pct: 62, rev_growth_pct: 30, forward_pe: 35, peg: 1.8, target_upside_pct: 15, rsi: 58 }];
  const p = buildPrompt();
  DATA.screener = saved;
  return p.includes("IDEE DI ROTAZIONE") && p.includes("Eli Lilly (LLY)") && p.includes("Salute") && p.includes("ESTERNI al portafoglio")`));
check("v144 screener: assente/vuoto → nessun blocco (niente sezione vuota)", run(`
  const saved = DATA.screener; DATA.screener = [];
  const p = buildPrompt(); DATA.screener = saved;
  return !p.includes("IDEE DI ROTAZIONE")`));
check("v144 veto graduato: Sortino profondo → FORTE; borderline (solo downside) → DEBOLE", run(`
  const base = { stats: { roe: 0.05, short_float: 0.02, peg: 1.5, profit_margin: 0.1 } };
  const forte = qualityVeto({ ...base, sortino_1y: -2.5 });          // profondo
  const debole = qualityVeto({ ...base, sortino_1y: -0.4, sma200_dist_pct: -5, rs_ndx_1m: -3 }); // borderline, non riabilitabile
  return forte.strength === "forte" && debole.strength === "debole"`));
check("v144 veto graduato: short interest → sempre FORTE anche con Sortino borderline", run(`
  const v = qualityVeto({ stats: { roe: 0.05, short_float: 0.20, peg: 1.5, profit_margin: 0.1 }, sortino_1y: -0.4 });
  // v200: si verifica che il FILTRO scatti e perche', non come si chiama l'etichetta.
  return !!v.verdict && /FILTRO QUALIT|VALUE TRAP/.test(v.verdict) && v.strength === "forte"`));
check("v144 veto graduato: la severità compare nel prompt (FORTE/DEBOLE)", run(`
  const p = buildPrompt();
  return /veto (FORTE|DEBOLE)/.test(p) || /\\[(FORTE|DEBOLE)\\]/.test(p) || !(dv => (dv.excluded||[]).length)(decisionVerdict())`));

/* ---------- v145: revisione payload (parità tabelle fondamentali, brief onesto, ⚠deg, cap gate, shock) ---------- */
check("v145 fondamentali: la DETTAGLIATA dichiara il conteggio 'N TITOLI → N righe' e le righe combaciano (guard I4)", run(`
  const p = buildPrompt();
  const dett = (p.match(/ANALISI FONDAMENTALE DETTAGLIATA — (\\d+) TITOLI/) || [])[1];
  const start = p.indexOf("ANALISI FONDAMENTALE DETTAGLIATA");
  let rows = 0, started = false;
  for (const l of p.slice(start).split("\\n")) { if (l.startsWith("| Titolo") || l.startsWith("|---")) continue; if (l.startsWith("| ")) { rows++; started = true; continue; } if (started) break; }
  return dett != null && Number(dett) === rows`));
check("v145 fondamentali: market_cap azzerato NON fa sparire il titolo dalla DETTAGLIATA (bug AMD/MU/CRM)", run(`
  const r = DATA.portfolio.find(x => x.ticker === "TST1");
  const saved = r.stats.market_cap; r.stats.market_cap = null;
  const p = buildPrompt();
  r.stats.market_cap = saved;
  const start = p.indexOf("ANALISI FONDAMENTALE DETTAGLIATA");
  return /\\| TST1 /.test(p.slice(start, start + 3000))`));
check("v145 brief: 'Investito' = capitale MTM cassa ESCLUSA (eur_invested), non il patrimonio totale", run(`
  const b = buildExecutiveDelta();
  const inv = Math.round(DATA.totals.eur_invested), tot = Math.round(DATA.totals.eur_value);
  return b.includes("MTM, cassa esclusa") && inv !== tot && b.includes("Investito €" + fmtNum.format(inv))`));
check("v145 rendimento book: da gain_pct (cash-neutral), IMMUNE al break/movimenti di cassa in eur_value", run(`
  const mh = [
    { date: "2026-07-01", gain_pct: 50, eur_value: 300000 },   // cassa inclusa (pre-break)
    { date: "2026-07-08", gain_pct: 53, eur_value: 270000 },   // −30k = artefatto cassa, non perdita
  ];
  const r = bookReturnPct(mh, 7);   // (1,53/1,50)−1 = +2,00%, NON il −10% dei delta di eur_value
  return r != null && Math.abs(r - 2) < 0.05`));
check("v145 ⚠deg: RS che decelera sotto la soglia (−0,3pp) NON è degrado (rumore); ≥3pp con MCR↑ sì", run(`
  const iso = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const savedMH = DATA.metrics_history, savedWL = DATA.watchlist;
  const mk = (rsNew, mcrNew) => ([{ date: iso(10), titles: { TDEG: { rs: 0, mcr: 5 } } }, { date: iso(0), titles: { TDEG: { rs: rsNew, mcr: mcrNew } } }]);
  DATA.watchlist = [{ ticker: "TDEG", currency: "USD", price: 100, sparks: { w1: [100, 100, 100, 100] } }];
  DATA.metrics_history = mk(-0.3, 5.2);   // drs7 −0,3 (rumore), dmcr7 +0,2
  const noise = sparkTrendRows().find(r => r.tk === "TDEG");
  DATA.metrics_history = mk(-3.5, 5.2);   // drs7 −3,5 (rilevante), dmcr7 +0,2
  const real = sparkTrendRows().find(r => r.tk === "TDEG");
  DATA.metrics_history = savedMH; DATA.watchlist = savedWL;
  return noise && noise.degrade === false && real && real.degrade === true`));
check("v145 cap gate: positionWeightPct ricava il peso da qty×price se val_eur manca (niente fail-open del cap)", run(`
  const r = DATA.portfolio.find(x => x.ticker === "TST1");
  const saved = r.val_eur; delete r.val_eur;
  const w = positionWeightPct(r);
  r.val_eur = saved;
  return w != null && w >= RISK_PARAMS.capNoAdd_pct`));
check("v145→v156 shock: EVIDENZA con workflow di verifica INLINE + conferma futures, NON più 'DIRETTIVA: SOSPENDI' né riferimento 'A4' pendente", run(`
  const saved = DATA.macro.shock_alert, savedF = DATA.macro.futures;
  DATA.macro.shock_alert = { active: true, threshold: 2, sources: [{ src: "KOSPI", chg: -4.3 }] };
  DATA.macro.futures = { nasdaq: { label: "Fut NDX", change_pct: 0.4 }, sp500: { label: "Fut S&P", change_pct: 0.1 } };
  const p = buildPrompt();
  DATA.macro.shock_alert = saved; DATA.macro.futures = savedF;
  return p.includes("SEGNALE DI SHOCK") && p.includes("NON è un ordine") && p.includes("WORKFLOW DI VERIFICA")
      && !/\\bA4\\b/.test(p) && p.includes("ALLARME FANTASMA") && /Fut NDX \\+0,4/.test(p) && !p.includes("DIRETTIVA OPERATIVA: SOSPENDI")`));

check("v145 cap display: 'posizione più pesante' usa il cap REALE (capNoAdd_pct), non un 10% hardcoded", run(`
  const saved = RISK_PARAMS.capNoAdd_pct;
  RISK_PARAMS.capNoAdd_pct = 15;                       // TST1 pesa ~38% NAV → sopra il cap 15
  const p = buildPrompt();
  RISK_PARAMS.capNoAdd_pct = saved;
  return p.includes("cap d'ingresso del 15%") && !p.includes("SOPRA il limite del 10%")`));

check("v146 budget 0: cassa < ES95 → flag ⛔ + presidio A1, niente falsa equazione '0 = X − Y'", run(`
  const savedCash = cashEur;
  DATA.totals.es95_hist_eur = 5000;
  cashEur = 0; recomputeTotals();                    // budget = max(0, 0−5000) = 0
  const p = buildPrompt();
  const b = buildExecutiveDelta();
  delete DATA.totals.es95_hist_eur; cashEur = savedCash; recomputeTotals();
  return p.includes("⛔ BUDGET OPERATIVO SPENDIBILE: 0 €") && p.includes("regola A1")
      && !p.includes("USA QUESTO — non rifare il conto") && b.includes("⛔ BUDGET 0")`));
check("v146 cap display: il BTP (bond, beta 0) NON compare nella lista over-cap d'ingresso", run(`
  const saved = RISK_PARAMS.capNoAdd_pct;
  RISK_PARAMS.capNoAdd_pct = 1;                       // cap bassissimo: ogni equity è "over", il BTP no
  const p = buildPrompt();
  RISK_PARAMS.capNoAdd_pct = saved;
  const m = p.match(/SOPRA il cap d'ingresso[^\\n]*/);
  return m == null || !/BTP/.test(m[0])`));

/* ---------- v148: resistenza + Sortino 6M nel payload (dati calcolati ma mai stampati) ---------- */
check("v148 resistenza: la cella Supp. porta anche la resistenza ('→ res $Y') quando plausibile", run(`
  const r = DATA.watchlist.find(x => x.ticker === "TSTW");   // support 95, resistance 120, price 100
  const p = buildPrompt();
  const row = p.split("\\n").find(l => l.startsWith("| ") && l.includes("TSTW"));
  return row != null && row.includes("$95") && row.includes("→ res $120")`));
check("v148 resistenza: fuori banda (res > 2× prezzo) → NON stampata (niente target garbage)", run(`
  const r = DATA.watchlist.find(x => x.ticker === "TSTW");
  const saved = r.resistance; r.resistance = r.price * 100;
  const p = buildPrompt();
  r.resistance = saved;
  const row = p.split("\\n").find(l => l.startsWith("| ") && l.includes("TSTW"));
  return row != null && !row.includes("→ res")`));
check("v148 Sortino 6M: la finestra di regime compare accanto all'1A ('(6M …)') quando disponibile", run(`
  const r = DATA.portfolio.find(x => x.ticker === "TST1");
  const saved = r.sortino_6m; r.sortino_6m = 0.85;
  const p = buildPrompt();
  r.sortino_6m = saved;
  const row = p.split("\\n").find(l => l.startsWith("| ") && l.includes("TST1"));
  return p.includes("Sortino 1A (6M)") && row != null && row.includes("(6M 0,85)")`));
check("v148 Livelli motore: la riga dei candidati include il 'target res.' (numeratore del R/R)", run(`
  const dv = decisionVerdict();
  const p = buildPrompt();
  return (dv.withPlan || []).length === 0 || p.includes("target res. $")`));

/* ---------- v149: contesto di sessione + validatore su ordini in tabella markdown ---------- */
check("v149 sessione: fasi deterministiche (lun 08:00 ET=pre-market · mer 12:00=regular · sab=weekend · mar 22:00=notte)", run(`
  const at = (iso) => usSessionInfo(new Date(iso));
  return at("2026-07-20T12:00:00Z").phase === "pre-market"     // lunedì 08:00 ET (EDT)
      && at("2026-07-22T16:00:00Z").phase === "regular"        // mercoledì 12:00 ET
      && at("2026-07-25T15:00:00Z").phase === "weekend"        // sabato
      && at("2026-07-22T02:00:00Z").phase === "notte"          // martedì 22:00 ET (mer 02:00 UTC)
      && at("2026-07-20T12:00:00Z").minsToOpen === 90`));
check("v149→v158 sessione: la riga CONTESTO DI SESSIONE è nel prompt con fase + guida ordini-per-campana (weekend ha la sua guida)", run(`
  const p = buildPrompt();
  return p.includes("CONTESTO DI SESSIONE (ora ET ") &&
    // v190: il ramo weekend ha DUE varianti — Seoul chiusa e Seoul aperta (che scatta dalle 02:00
    // CEST del lunedi', quando a New York e' ancora domenica). Il test ne elencava una sola e
    // falliva a orologio, cioe' proprio nella finestra in cui l'Asia e' l'unica informazione nuova:
    // un test legato a un ramo invece che alla PROPRIETA' e' un generatore di falsi allarmi.
    (p.includes("PRIMA DELLA CAMPANA") || p.includes("SESSIONE USA APERTA") || p.includes("AFTER-HOURS")
     || p.includes("WEEKEND, MERCATI CHIUSI") || p.includes("BORSA ASIATICA APERTA"))`));
check("v190 sessione: nel ramo Seoul-aperta l'etichetta del KOSPI non contraddice il testo", run(`
  // la riga si contraddiceva: "[ultima chiusura di Seoul, borsa ferma]" accanto a "Seoul sta
  // scambiando ora". Lo stato mancante era mercato APERTO + dato VECCHIO, il piu' insidioso.
  const p = buildPrompt();
  const riga = p.split("\\n").find(r => r.startsWith("CONTESTO DI SESSIONE")) || "";
  const diceAperta = riga.includes("BORSA ASIATICA APERTA");
  const diceFerma = riga.includes("borsa ferma");
  return !(diceAperta && diceFerma)`));
check("v158 orologio del prezzo: le news dopo la chiusura USA sono separate da quelle già prezzate", run(`
  const savedN = DATA.news, savedP = DATA.portfolio[0].price_asof, savedC = DATA.portfolio[0].currency;
  DATA.portfolio[0].price_asof = "2026-07-24"; DATA.portfolio[0].currency = "USD";
  DATA.news = [
    { title: "Priced in already", published: "2026-07-24T14:00:00Z", tickers: [], sentiment: "neu", source: "T" },
    { title: "After the bell catalyst", published: "2026-07-25T02:00:00Z", tickers: [], sentiment: "neu", source: "T" },
    { title: "Fed poll — probabilità Sì 70%", published: "2026-07-25T03:00:00Z", tickers: [], sentiment: "neu", source: "T" },
  ];
  const s = newsSplitByClose();
  DATA.news = savedN; DATA.portfolio[0].price_asof = savedP; DATA.portfolio[0].currency = savedC;
  // il confine è 16:00 ET = 20:00Z (EDT); la voce Polymarket sintetica è esclusa dal conteggio
  return s.close != null && s.close.asof === "2026-07-24" && s.total === 2
      && s.unpriced.length === 1 && s.unpriced[0].title === "After the bell catalyst"
      && s.priced.length === 1`));
check("v149 sessione: con KOSPI/futures/BTC nel fixture gli ANTICIPATORI compaiono inline", run(`
  DATA.watchlist.push({ ticker: "^KS11", currency: "PTS", price: 6800, change_pct: 4.5, price_live: true });
  DATA.macro.futures = { nasdaq: { change_pct: 0.27 }, sp500: { change_pct: 0.14 } };
  const p = buildPrompt();
  DATA.watchlist.pop(); delete DATA.macro.futures;
  // v182: il tag dipende dall'orario di Seoul — "live" fuori contrattazione e' l'ultimo scambio,
  // non una notizia. Il test non puo' quindi fissare l'etichetta: verifica che sia quella GIUSTA
  // per il momento in cui gira (un test che dipende dall'orologio e' un generatore di falsi allarmi).
  const attesa = seoulSessionOpen() ? "[LIVE, Seoul in contrattazione]" : "[ultima chiusura di Seoul, borsa ferma]";
  return p.includes("ANTICIPATORI: KOSPI +4,5% " + attesa) && p.includes("Fut NDX +0,27%")`));
check("v149 validatore: ordine in RIGA TABELLA markdown (stile Gemini) → ticker/verso/qty/limite estratti", run(`
  const o = parseAIOrders("| **TSTW** | VENDI | ~595 | **$14,31** (agg. after) | — | Violazione stop. (Prezzo $14,25 · Supp. $13,41 · Stop $14,79) | 95/100 |");
  return o.length === 1 && o[0].tk === "TSTW" && o[0].action === "SELL" && o[0].qty === 595 && o[0].limit === 14.31`));
check("v149 validatore: il formato canonico A2 resta parsato identico (regressione)", run(`
  const o = parseAIOrders("[TST1] — COMPRA ~14 quote a limite $95,50 con stop $88 (payload: ...)");
  return o.length === 1 && o[0].qty === 14 && o[0].limit === 95.5 && o[0].stop === 88`));

/* ---------- v150: sync cloud parametri di rischio + distanza res in cella ---------- */
check("v150 risk sync: la chiave _savedAt (stringa merge) NON inquina RISK_PARAMS né crasha applyRiskOverrides", run(`
  const saved = RISK_PARAMS.capNoAdd_pct;
  localStorage.setItem("risk_params_overrides", JSON.stringify({ capNoAdd_pct: 15, _savedAt: "2026-07-21T06:00:00Z" }));
  applyRiskOverrides();
  const ok = RISK_PARAMS.capNoAdd_pct === 15 && RISK_PARAMS._savedAt === undefined;
  localStorage.removeItem("risk_params_overrides");
  RISK_PARAMS.capNoAdd_pct = saved;
  return ok`));
check("v150 res distance: la cella Supp. mostra il distacco % della resistenza dal prezzo", run(`
  const p = buildPrompt();
  const row = p.split("\\n").find(l => l.startsWith("| ") && l.includes("TSTW"));
  return row != null && row.includes("→ res $120 (+20%)")`));

/* ---------- v151: ri-arm candidato sugli stop violati + flag held-candidate ---------- */
check("v151→v156 ri-arm: livello CALCOLATO (2×ATR sotto il supporto) + rischio dal PREZZO CORRENTE, non dallo stop violato", run(`
  const p = buildPrompt();
  const line = p.split("\\n").find(l => l.includes("STOP VIOLATI (il prezzo"));
  // fixture TST3: stop_atr 110 violato (prezzo 100), support 95, atr 2 → ri-arm 95−4=91 < prezzo.
  // v156: rischio = qty×(PREZZO−ri-arm) = 10×(100−91)=€90, NON qty×(stop violato−ri-arm)=10×19=€190.
  return line != null && line.includes("TST3") && line.includes("ri-arm CANDIDATO se tieni: $91")
      && line.includes("~€90 = 10 quote × $9 dal prezzo") && !line.includes("€190") && !line.includes("$19 ")`));
check("v156→v180 reorder: CORRELAZIONI CALCOLATE hoisted PRIMA dei dati grezzi (il PROMEMORIA non esiste più)", run(`
  const savedNews = DATA.news;
  DATA.news = [{ title: "AI boom lifts data center chips", tickers: [], sentiment: "neu", source: "Test", published: "2026-07-25T02:00:00Z" }];
  const t = typeof buildCIOText === "function" ? buildCIOText() : "";
  DATA.news = savedNews;
  const iCorr = t.indexOf("=== CORRELAZIONI CALCOLATE");
  const iData = t.indexOf("\\nDATI AL ");
  // v180: il PROMEMORIA FINALE è stato rimosso perché duplicava per intero testata [A2] e [D]
  return iCorr > 0 && iData > iCorr && !t.includes("PROMEMORIA FINALE")`));
check("v169 decisioni: le detenute in VETO FORTE entrano nella lista anche SENZA stop violato", run(`
  const p = buildPrompt();
  const dv = decisionVerdict();
  // v211 — ancorato al MARCATORE, non al testo: la riga è stata riformulata (da "CHIEDONO UNA
  // DECISIONE OGGI" a "DA GUARDARE", separando eventi e condizioni permanenti) e un check legato
  // alla frase si rompe a ogni riscrittura senza proteggere nulla. È già successo tre volte.
  const line = p.split("\\n").find(l => l.includes("🔷"));
  const attesi = new Set();
  (dv.stopViolations || []).forEach(x => attesi.add(x.r.ticker));
  (dv.excluded || []).forEach(x => { if (x.r && x.r.qty && String(x.strength||"").toLowerCase() === "forte") attesi.add(x.r.ticker); });
  if (!attesi.size) return line == null;                 // niente da decidere: la riga non deve esserci
  if (line == null) return false;
  if (![...attesi].every(tk => line.includes(tk))) return false;
  // v211 — e la riga deve DISTINGUERE l'evento dalla condizione permanente: metterle sotto la
  // stessa etichetta "OGGI" su 6 posizioni di 8 costruisce un'urgenza che i dati non hanno, ed è
  // ciò che ha prodotto il report "vendi tutto".
  return /EVENTO/.test(line) && /CONDIZIONE PERMANENTE/.test(line);`));
check("v170 budget: il capitale liquidabile è CONTESTO, mai capienza di spesa di oggi", run(`
  const p = buildPrompt();
  const line = p.split("\\n").find(l => l.includes("CAPITALE IMMOBILIZZATO"));
  const dv = decisionVerdict();
  const cene = (dv.stopViolations || []).length || (dv.excluded || []).some(x => x.r && x.r.qty && String(x.strength||"").toLowerCase() === "forte");
  if (!cene) return line == null;
  // il capitale liquidabile è CONTESTO: non deve mai essere presentato come budget spendibile oggi
  return line != null && /NON budget/.test(line) && /non possono superarlo/.test(line)
      && /T\\+2/.test(line) && !/dimensiona gli acquisti sul budget POST/.test(line);`));
check("v167 cap sulla perdita: la quantità massima scende al crescere della distanza dallo stop", run(`
  const p = buildPrompt();
  const line = p.split("\\n").find(l => l.includes("Livelli calcolati dal motore"));
  if (line == null || !line.includes("RISCHIO/OPERAZIONE")) return true;
  // il tetto cita il parametro REALE e dichiara sempre il vincolo più stretto
  return line.includes(fmtNum.format(RISK_PARAMS.maxLossPerPos_pct) + "% del NAV")
      && line.includes("VINCOLO PIÙ STRETTO")`));
check("v167 cap sulla perdita: a parità di rischio un titolo volatile entra con MENO quote", run(`
  const dv = decisionVerdict();
  const navTot = (DATA?.totals?.eur_invested || 0) + cashEur;
  const eur = DATA.eurusd || 1.08;
  const qtyMax = (x) => Math.floor(RISK_PARAMS.maxLossPerPos_pct / 100 * navTot * eur / (x.limit - x.stop));
  const validi = (dv.withPlan || []).filter(x => x.limit > x.stop && x.stop > 0);
  if (validi.length < 2) return true;
  // ordinati per distanza dallo stop crescente, le quantità devono essere DECRESCENTI
  const ord = validi.slice().sort((a, b) => (a.limit - a.stop) - (b.limit - b.stop)).map(qtyMax);
  return ord.every((v, i) => i === 0 || v <= ord[i - 1])`));
check("v174 alpha comparabile: il processo si misura su base OMOGENEA (equity USD vs indice)", run(`
  const b = buildExecutiveDelta();
  const line = b.split("\\n").find(l => l.includes("ALPHA DEL PROCESSO"));
  if (line == null) return true;                          // serie insufficienti in questo scenario
  // deve dichiarare la base e l'assunzione sui pesi, e distinguersi dalla riga patrimoniale
  return /solo comparto AZIONARIO in USD/.test(line) && /niente BTP, niente cambio/.test(line)
      && /controvalori CORRENTI/.test(line) && /alpha/.test(line)`));
check("v174 guardie settoriali: una sola sul giudizio (varianza), il peso resta contesto", run(`
  const p = buildPrompt();
  const riga = p.split("\\n").find(l => l.includes("primo settore:"));
  if (riga == null) return true;
  // la riga sul PESO non deve più emettere un proprio ALERT concorrente
  return !/⚠ ALERT/.test(riga) && /quota di CAPITALE, non di rischio/.test(riga);`));
check("v167 concentrazione di fattore: soglia sulla VARIANZA cumulata per settore, non sul peso", run(`
  const dv = decisionVerdict();
  const f = dv.factorRisk;
  if (!f) return true;
  const testo = dv.reasons.join(" ");
  const sopra = f.mcr > RISK_PARAMS.factorRiskAlert_pct;
  // l'alert compare se e solo se la soglia è superata, e cita varianza E peso (grandezze diverse)
  return sopra === /CONCENTRAZIONE DI FATTORE/.test(testo)
      && (!sopra || (/della VARIANZA/.test(testo) && /del NAV/.test(testo)))`));
check("v164 stato CAP: se i candidati esistono ma sono TUTTI oltre il cap, il verdetto NON dice 'nessun candidato'", run(`
  const savedCap = RISK_PARAMS.capNoAdd_pct, savedWl = DATA.watchlist;
  DATA.watchlist = [];                                   // solo detenuti → il cap è l'unico collo di bottiglia
  RISK_PARAMS.capNoAdd_pct = 5;                          // ogni posizione del fixture supera il 5% del NAV
  const dv = decisionVerdict();
  RISK_PARAMS.capNoAdd_pct = savedCap; DATA.watchlist = savedWl;
  const testo = dv.reasons.join(" ");
  if (!(dv.overCap || []).length) return true;           // scenario non riproducibile: vacuo
  // se il cap ha svuotato i candidati, il verdetto deve DIRLO e non affermare il falso
  if (!(dv.accumula || []).length) {
    return dv.label === "CAP" && /CAP D'INGRESSO/.test(testo)
        && !/nessun candidato migliora abbastanza/.test(testo);
  }
  return /cap d'ingresso/i.test(testo)`));
check("v164 de-ratchet: un candidato già detenuto dichiara che accumulare azzera il trailing sulle quote esistenti", run(`
  const p = buildPrompt();
  const line = p.split("\\n").find(l => l.includes("Livelli calcolati dal motore"));
  if (line == null) return true;
  const dv = decisionVerdict();
  // per ogni candidato detenuto il cui ratchet sta SOPRA lo stop d'ingresso, il tag è obbligatorio
  const attesi = (dv.withPlan || []).filter(x => {
    if (!(x.r.qty > 0)) return false;
    const hs = stopOf(x.r);
    return hs && hs.stop > x.stop && x.stop > 0;
  });
  if (!attesi.length) return true;
  return attesi.every(x => new RegExp("DE-RATCHET[^\\\\]]*" + x.r.ticker).test(line)
                        || line.includes("DE-RATCHET"))`));
check("v164 Sharpe n.d.: la componente 40% è ESCLUSA e dichiarata, non sostituita da una baseline inventata", run(`
  const t = DATA.totals, saved = t.portfolio_sharpe_ratio;
  t.portfolio_sharpe_ratio = null;
  const dv = decisionVerdict();
  const p = buildPrompt();
  t.portfolio_sharpe_ratio = saved;
  const testo = dv.reasons.join(" ");
  // niente "vs 1 attuale" inventato; se il ramo criteri è emesso deve dichiarare l'esclusione
  const mente = /impatto marginale sullo Sharpe \\(vs 1 attuale/.test(testo) || /vs 1 attuale/.test(p);
  const dichiara = !/criteri:/.test(testo) || /componente Sharpe \\(40% dello score\\) è ESCLUSA/.test(testo);
  return !mente && dichiara`));
check("v163-v177 accelerazione RS: la riga porta RS, prezzo della stessa finestra e veto; il giudizio lo da l LLM", run(`
  const r = DATA.portfolio.find(x => x.ticker === "TST2");
  const saved = { s: r.sortino_1y, sp: r.sparks, mh: DATA.metrics_history, news: DATA.news };
  r.sortino_1y = -2.0;                                   // veto FORTE (downside profondo)
  DATA.news = [{ title: "AI chips", tickers: [], sentiment: "neu", source: "T", published: "2026-07-24T14:00:00Z" }];
  // storico RS: +12pp in 7 giorni (drs7 >= 5) → il detector scatta
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  DATA.metrics_history = [
    { date: day(8), titles: { TST2: { rs: -20, mcr: 10 } } },
    { date: day(0), titles: { TST2: { rs: -8, mcr: 10 } } },
  ];
  // caso A: prezzo SCESO nella stessa finestra → deve dichiarare la falsa accelerazione
  r.sparks = { w1: [100, 99, 98, 97, 94] };
  const giu = marketLinkText();
  // caso B: prezzo SALITO → accelerazione vera, framing del momentum
  r.sparks = { w1: [100, 102, 104, 106, 110] };
  const su = marketLinkText();
  Object.assign(r, { sortino_1y: saved.s, sparks: saved.sp });
  DATA.metrics_history = saved.mh; DATA.news = saved.news;
  // v177: la riga non emette piu un VERDETTO ("falsa accelerazione") ma i FATTI che permettono
  // di darlo — RS, prezzo della stessa finestra, benchmark, veto — piu la nota sul roll-off
  // quando il prezzo scende. Il giudizio e dell LLM: qui si verifica che abbia gli elementi.
  const haFatti = (t) => /RS 1M /.test(t) && /prezzo /.test(t) && /veto FORTE in essere/.test(t);
  return haFatti(giu) && haFatti(su)
      && giu.includes("uscita del crollo precedente dalla finestra")
      && !su.includes("uscita del crollo precedente dalla finestra")`));
check("v163 troncamento a 8: le detenute non elencate sono DICHIARATE e restano visibili ai detector", run(`
  const txt = marketLinkText();
  for (const line of txt.split("\\n")) {
    const m = line.match(/^  \\[[^\\]]+\\].*→ (.*?)(?: \\(\\+(\\d+) detenute non elencate: ([\\d,]+)% del NAV\\))? — esposizione in PTF ([\\d,]+)% del NAV/);
    if (!m) continue;
    const mostrati = m[1].split(" · ").length;
    // se sono stati troncati (8 mostrati) DEVE esserci la dichiarazione del resto
    if (mostrati >= 8 && m[2] == null) return false;
  }
  return true`));
check("v162 rischio: il confronto parametrico distingue VaR ed ES (prima una cifra di VaR seguiva l'ES e si leggeva come suo)", run(`
  const t = DATA.totals, saved = { v: t.var95_1d_eur, e: t.es95_1d_eur, vh: t.var95_hist_eur, eh: t.es95_hist_eur };
  Object.assign(t, { var95_1d_eur: 9802, es95_1d_eur: 12298, var95_hist_eur: 9184, es95_hist_eur: 12986 });
  const p = buildPrompt();
  Object.assign(t, { var95_1d_eur: saved.v, es95_1d_eur: saved.e, var95_hist_eur: saved.vh, es95_hist_eur: saved.eh });
  const line = p.split("\\n").find(l => l.includes("VaR 95% a 1 giorno"));
  if (line == null) return true;                          // riga assente in questo scenario: vacuo
  // entrambe le cifre parametriche presenti E ciascuna col suo nome (niente numero orfano)
  return /VaR 9802/.test(line) && /ES 12\\.298/.test(line) && line.includes("PARAMETRICO")
      && !/\\[parametrico: [\\d.]+ €\\]/.test(line)`));
check("v162 falsi negativi tematici: 'federal reserve' per esteso, 'trade practices' e 'clean energy' vengono catturati", run(`
  // si testano i MATCHER direttamente: un tema entra nel payload solo se ha titoli BERSAGLIO nel
  // book, e la fixture non ha semi né utility — passare da marketLinkText misurerebbe la fixture,
  // non la regex che è ciò che è stato corretto.
  const m = (id) => NEWS_THEMES.find(t => t.id === id).m;
  const tassi = m("TASSI/FED/INFLAZIONE"), dazi = m("DAZI/EXPORT-CONTROL"), nuc = m("NUCLEARE/UTILITY");
  return tassi("Economy bringing mixed messages ahead of next federal reserve meeting", "")
      && tassi("", "L'economia prima della riunione della Fed")
      && dazi("Trump says the US will investigate EU trade practices", "")
      && dazi("", "indagine sulle pratiche commerciali UE")
      && nuc("Trump administration admits grants for clean energy were canceled", "")
      && nuc("", "sovvenzioni per l'energia pulita cancellate")
      // e NON devono allargarsi a qualunque cosa: controllo anti-falso-positivo
      && !tassi("Trump mixes jokes at press dinner", "")
      && !dazi("Bitcoin slips on Iran tensions", "")
      && !nuc("Nvidia unveils new GPU", "")`));
check("v161 Polymarket: le voci sintetiche di probabilità non contano come news né fanno da esempio del tema", run(`
  const savedNews = DATA.news;
  DATA.news = [
    { title: "Will the Fed cut rates in July? — probabilità Sì 73%", tickers: [], sentiment: "neu", source: "PM", published: "2026-07-25T05:02:00Z" },
    { title: "Fed holds as inflation cools", title_it: "La Fed tiene i tassi mentre l'inflazione rallenta", tickers: [], sentiment: "neu", source: "R", published: "2026-07-25T04:00:00Z" },
  ];
  const txt = marketLinkText();
  const split = newsSplitByClose();
  DATA.news = savedNews;
  // il tema TASSI deve contare 1 news (non 2) e non citare la riga Polymarket
  const m = txt.match(/\\[TASSI\\/FED\\/INFLAZIONE\\] (\\d+) news/);
  return split.total === 1 && (m == null || m[1] === "1") && !txt.includes("probabilità Sì")`));
check("v161 coda editoriale: la sigla della FONTE non classifica il tema (Kavout | AI ≠ notizia AI)", run(`
  const savedNews = DATA.news;
  // titolo macro con la sigla "AI" solo nella coda della fonte: NON deve entrare in AI/DATACENTER
  DATA.news = [{ title: "What Does the February Jobs Report Really Tell Us - Kavout | AI",
                 title_it: "Cosa ci dice il rapporto sull'occupazione - Kavout | AI",
                 tickers: [], sentiment: "neu", source: "K", published: "2026-07-25T02:00:00Z" }];
  const soloFonte = marketLinkText();
  DATA.news = [{ title: "Nvidia unveils AI data centers initiative", title_it: "Nvidia lancia data center IA",
                 tickers: [], sentiment: "neu", source: "K", published: "2026-07-25T02:00:00Z" }];
  const veraAI = marketLinkText();
  DATA.news = savedNews;
  return !soloFonte.includes("[AI/DATACENTER]") && veraAI.includes("[AI/DATACENTER]")`));
check("v171 Asia aperta mentre NY è nel weekend: il KOSPI non va dichiarato fermo a venerdì", run(`
  const at = (iso) => new Date(iso);
  // lunedì 02:00 CEST = 09:00 KST (KOSPI apre) ma a New York è ancora domenica sera
  const apre = at("2026-07-27T00:00:00Z");
  return seoulSessionOpen(apre) === true
      && usSessionInfo(apre).phase === "weekend"          // NY: ancora weekend
      && seoulSessionOpen(at("2026-07-27T07:00:00Z")) === false   // 09:00 CEST: KOSPI chiuso
      && seoulSessionOpen(at("2026-07-25T02:00:00Z")) === false   // sabato: chiuso
      && seoulSessionOpen(at("2026-07-26T21:00:00Z")) === false`)); // domenica sera: non ancora
check("v161 nessun riferimento pendente: senza news post-chiusura il payload NON rimanda ai CATALIZZATORI", run(`
  const savedNews = DATA.news;
  DATA.news = [];                                        // nessuna news → il blocco non si genera
  const vuoto = buildCIOText();
  DATA.news = savedNews;
  const pieno = buildCIOText();
  const hasBlock = (t) => t.includes("· ⏰ CATALIZZATORI NON ANCORA PREZZATI");
  const hasRef   = (t) => t.includes("vedi CATALIZZATORI NON ANCORA PREZZATI");
  // invariante: rimando ⇒ sezione presente (in ENTRAMBI gli scenari)
  return (!hasRef(vuoto) || hasBlock(vuoto)) && (!hasRef(pieno) || hasBlock(pieno)) && !hasRef(vuoto)`));
check("v161 fase di seduta: usRegularSessionOpen è DERIVATA da usSessionInfo (fonte di verità unica)", run(`
  const at = (iso) => new Date(iso);
  return usRegularSessionOpen(at("2026-07-22T16:00:00Z")) === true    // mer 12:00 ET = regular
      && usRegularSessionOpen(at("2026-07-25T15:00:00Z")) === false   // sabato
      && usRegularSessionOpen(at("2026-07-20T12:00:00Z")) === false   // lun 08:00 ET = pre-market
      && usRegularSessionOpen(at("2026-07-22T02:00:00Z")) === false   // notte
      // coerenza strutturale: vero ⟺ fase "regular", su tutta la griglia oraria
      && [...Array(24).keys()].every(h => {
           const d = at("2026-07-22T" + String(h).padStart(2,"0") + ":30:00Z");
           return usRegularSessionOpen(d) === (usSessionInfo(d).phase === "regular");
         })`));
check("v159 track record: segnali tutti dello STESSO giorno → dichiarato il limite statistico (n=1, non 4 osservazioni)", run(`
  const saved = DATA.verdict_track;
  DATA.verdict_track = { mature7: { n: 4, avg_ret: -13.4, avg_vs_ndx: -7.7, hit_pct: 0 },
    last: [{ tk: "AAA", date: "2026-07-11", ret_pct: -25, vs_ndx_pp: -19.3 },
           { tk: "BBB", date: "2026-07-11", ret_pct: -10.5, vs_ndx_pp: -4.8 }] };
  const p1 = buildPrompt();
  DATA.verdict_track.last[1].date = "2026-07-18";        // date distinte → avviso diverso
  const p2 = buildPrompt();
  DATA.verdict_track = saved;
  return p1.includes("LIMITE STATISTICO DEL CAMPIONE") && p1.includes("NON osservazioni indipendenti")
      && !p2.includes("LIMITE STATISTICO DEL CAMPIONE") && p2.includes("CAMPIONE PICCOLO")`));
check("v159-v177 candidati vs concentrazione: i due numeri affiancati, senza verdetto pre-scritto", run(`
  const savedCap = RISK_PARAMS.capNoAdd_pct, savedNews = DATA.news;
  RISK_PARAMS.capNoAdd_pct = 60;                          // sblocca i detenuti come candidati
  DATA.news = [{ title: "AI chips rally", tickers: [], sentiment: "neu", source: "T", published: "2026-07-24T14:00:00Z" }];
  const dv = decisionVerdict();
  const txt = marketLinkText();
  RISK_PARAMS.capNoAdd_pct = savedCap; DATA.news = savedNews;
  const cands = dv.accumula || [];
  if (cands.length < 2) return true;                      // scenario non riproducibile nel fixture: vacuo
  // stesso criterio del detector: settore dominante ≥50% dei candidati
  const secOf = (r) => (r.sector || "n.d.");
  const by = {}; cands.forEach(r => { const s = secOf(r); (by[s] = by[s] || []).push(r.ticker); });
  const top = Object.values(by).sort((a, b) => b.length - a.length)[0];
  const dominante = top.length >= 2 && top.length / cands.length >= 0.5;
  const expo = (DATA.portfolio || []).filter(r => secOf(r) === Object.keys(by).find(k => by[k] === top))
    .reduce((s, r) => s + (positionWeightPct(r) ?? 0), 0);
  return (dominante && expo >= 25) ? txt.includes("CANDIDATI vs CONCENTRAZIONE") : true`));
check("v158 cap headroom: OGNI candidato GIÀ detenuto dichiara la capienza residua entro il cap (quote + €)", run(`
  // cap alzato per far entrare fra i candidati un nome DETENUTO (nel fixture i pesi sono alti):
  // senza, withPlan contiene solo watchlist (peso nullo) e l'invariante sarebbe vuoto.
  const savedCap = RISK_PARAMS.capNoAdd_pct;
  RISK_PARAMS.capNoAdd_pct = 60;
  const dv = decisionVerdict();
  const p = buildPrompt();
  RISK_PARAMS.capNoAdd_pct = savedCap;
  const line = p.split("\\n").find(l => l.includes("Livelli calcolati dal motore"));
  const heldCands = (dv.withPlan || []).filter(x => x.r && x.r.qty > 0).map(x => x.r.ticker);
  if (!heldCands.length) return true;                    // nessun candidato detenuto: invariante vacua
  if (line == null) return false;
  // per ogni candidato detenuto deve comparire un tag CAP con capienza in quote o esaurita
  const seg = line.split(" · ");
  return heldCands.every(tk => {
    const s = seg.find(x => x.startsWith(tk + ":") || x.includes(tk + ": prezzo"));
    return s != null && s.includes("[CAP:") &&
      (/capienza residua ~\\d/.test(s) || s.includes("capienza ESAURITA"));
  })`));
check("v151 held-candidate: candidato già detenuto con ratchet sopra il limite → NB esplicito nella riga Livelli", run(`
  const r = DATA.portfolio.find(x => x.ticker === "TST1");   // TST1: qty 100, stop_atr 94
  const saved = { pe: r.pe, sh: r.sharpe_1y };
  const p = buildPrompt();
  const line = p.split("\\n").find(l => l.includes("Livelli calcolati dal motore"));
  // se TST1 è candidato (dipende dal cap del fixture) il flag deve esserci quando stop>limite;
  // in ogni caso la stringa NB non deve MAI comparire per candidati non detenuti
  const nbCount = (p.match(/posizione GIÀ detenuta con stop ratchet/g) || []).length;
  const wlNb = line && /TSTW[^·]*posizione GIÀ detenuta/.test(line);
  return !wlNb && nbCount >= 0`));

/* ---------- v152: coerenza UI col cap configurabile ---------- */
check("v152 registry: il chip Cap d'ingresso segue capNoAdd_pct in soglia/stato/razionale (niente 10% hardcoded)", run(`
  const saved = RISK_PARAMS.capNoAdd_pct;
  RISK_PARAMS.capNoAdd_pct = 20;
  const rules = riskRulesRegistry();
  RISK_PARAMS.capNoAdd_pct = saved;
  const cap = rules.find(r => r.label === "Cap d'ingresso");
  return !!cap && cap.th === "20% NAV" && cap.state.includes("≥20% NAV") && cap.why.includes("20%") && !cap.state.includes("10%")`));

/* ---------- v196: registro dei popup macro allineato alla griglia ---------- */
// La griglia rende data-macro="in:umich" ma MACRO_INFO aveva ancora "in:pmi": openMacroInfo
// usciva in silenzio (`if (!info) return;`) e cliccare "Fiducia consumatori" nella dashboard
// NON APRIVA NULLA. Un fallimento MUTO puo' restare invisibile per mesi.
// NB: la prima stesura di questo test cercava le chiavi LETTERALI nel sorgente e non trovava
// nulla, perche' la griglia le costruisce da template (`data-macro="in:${i.key}"`). Un test che
// guarda dove la chiave non c'e' e' verde su qualunque cosa. Ora si parte dai DATI, che sono
// la fonte vera delle chiavi.
{
  const chiavi = run("Object.keys(MACRO_INFO || {})");
  // il fixture non ha `indicators`: si leggono dal data.json REALE, che e' la fonte delle chiavi
  // rese in pagina. Un test che interroga un fixture vuoto e' verde per assenza di dati, non per
  // assenza di difetti — ed e' esattamente cosi' che questo test e' passato mentre il difetto
  // era iniettato.
  const reale = JSON.parse(readFileSync(join(ROOT, "data", "data.json"), "utf8").replace(/\bNaN\b/g, "null"));
  const indicatori = ((reale.macro || {}).indicators || []).map(x => x.key);
  const orfane = indicatori.map(k => "in:" + k).filter(k => !chiavi.includes(k));
  check("v196 registro macro: ogni indicatore della griglia ha la sua voce in MACRO_INFO (niente popup muti)",
        indicatori.length > 0 && orfane.length === 0);
  if (orfane.length) console.log("  ⚠ indicatori senza voce nel registro:", orfane.join(", "));
}


/* ═══════════════════════════════════════════════════════════════════════════════════════
   v205 — VISTA STRUTTURA. I cinque grafici leggono i DATI VERI: qui si prova su data.json,
   non sul fixture, perché il fixture non ha né sparks né metrics_history e un test che
   interroga dati assenti è verde per assenza di dati, non di difetti (lezione v196).
   ═══════════════════════════════════════════════════════════════════════════════════════ */
{
  const reale = JSON.parse(readFileSync(join(ROOT, "data", "data.json"), "utf8").replace(/\bNaN\b/g, "null"));
  vm.runInContext(`REALE = ${JSON.stringify(reale)};`, ctx, { filename: "reale.js" });
  // ⚠ COPIA PROFONDA, non `DATA = REALE`: alcuni di questi check MUTANO il portafoglio o lo
  // storico per provare un ramo, e con l'assegnazione per riferimento la mutazione restava
  // addosso a REALE facendo fallire i check successivi. Se n'è accorto il test stesso — ed è
  // la ragione per cui ogni check parte da uno stato pulito.
  const suReale = (code) => run(`
    const _salva = DATA, _cash = cashEur;
    DATA = JSON.parse(JSON.stringify(REALE)); cashEur = 28500; recomputeTotals();
    try { ${code} } finally { DATA = _salva; cashEur = _cash; recomputeTotals(); }`);

  // IL DIFETTO CHE QUESTA VISTA POTEVA INTRODURRE: confrontare due frazioni con basi diverse.
  check("v205 concentrazione: peso e MCR stanno sullo STESSO universo (sommano entrambi a 100%)", suReale(`
    const rows = concentrazioneRows();
    const sp = rows.reduce((s, r) => s + r.peso, 0), sm = rows.reduce((s, r) => s + r.mcr, 0);
    return rows.length >= 2 && Math.abs(sp - 100) < 0.6 && Math.abs(sm - 100) < 0.6;`));

  check("v205 concentrazione: chi non ha contributo al rischio (BTP) resta fuori da ENTRAMBE le barre", suReale(`
    const rows = concentrazioneRows();
    const senzaMcr = DATA.portfolio.filter(r => r.qty > 0 && r.risk_contrib_pct == null).map(r => r.ticker);
    return senzaMcr.length > 0 && senzaMcr.every(t => !rows.some(r => r.ticker === t));`));

  check("v205 concentrazione: lo scarto è rischio − peso, e ordina la classifica", suReale(`
    const rows = concentrazioneRows();
    const gapOk = rows.every(r => Math.abs(r.gap - (r.mcr - r.peso)) < 0.15);
    const ordinato = rows.every((r, i) => i === 0 || rows[i - 1].mcr >= r.mcr);
    return gapOk && ordinato;`));

  // NB: si toglie IL TITOLO da una data che resta popolata — non si svuota la data. Una data
  // senza `titles` viene proprio scartata da derivaConcentrazione, quindi non produrrebbe un
  // buco ma una serie più corta: era la prima stesura di questo check, e passava per il motivo
  // sbagliato finché il report non è stato spostato in fondo e il FAIL è diventato visibile.
  check("v205 deriva: una data in cui il titolo non c'era resta null, non zero", suReale(`
    const d = derivaConcentrazione();
    if (!d || !d.serie.length) return false;
    const tk = d.serie[0].ticker;
    const ultima = DATA.metrics_history[DATA.metrics_history.length - 1];
    if (!(tk in ultima.titles)) return false;     // il caso da provare deve esistere davvero
    delete ultima.titles[tk];                     // quel giorno la posizione non era in libro
    const d2 = derivaConcentrazione();
    const s = (d2.serie || []).find(x => x.ticker === tk);
    return !!s && s.punti[s.punti.length - 1] === null && s.punti.some(v => v != null);`));

  check("v205 deriva: il Top-3 è la somma dei tre MCR maggiori del giorno", suReale(`
    const d = derivaConcentrazione();
    const ultimo = DATA.metrics_history[DATA.metrics_history.length - 1];
    const v = Object.values(ultimo.titles).map(t => t.mcr).filter(x => typeof x === "number")
      .sort((a, b) => b - a).slice(0, 3).reduce((s, x) => s + x, 0);
    return Math.abs(d.top3[d.top3.length - 1] - v) < 0.11;`));

  // il segno È l'informazione: negativo = stop già superato. Deve concordare con stopOf().
  check("v205 stop: distanza negativa ⟺ stopOf dichiara la violazione", suReale(`
    const rows = distanzeStop();
    return rows.length >= 3 && rows.every(r => (r.dist < 0) === !!r.violated);`));

  check("v205 stop: distanza = (prezzo − stop)/prezzo, ordinata dal più esposto", suReale(`
    const rows = distanzeStop();
    return rows.every(r => {
      const p = DATA.portfolio.find(x => x.ticker === r.ticker);
      return Math.abs(r.dist - (p.price - r.stop) / p.price * 100) < 0.11;
    }) && rows.every((r, i) => i === 0 || rows[i - 1].dist <= r.dist);`));

  // la somma a 100 è vera per costruzione (si normalizza sul proprio totale) e non prova nulla:
  // si verifica che il totale sia il PATRIMONIO vero e che la quota USD coincida con fxExposure,
  // che è il numero già pubblicato altrove. Due letture della stessa grandezza devono combaciare.
  check("v205 allocazione: il totale è il patrimonio e la quota USD coincide con fxExposure", suReale(`
    const inv = DATA.portfolio.filter(r => r.qty > 0).reduce((s, r) => s + r.val_eur, 0);
    const patrimonio = inv + cashEur;
    const set = allocazionePer("sector"), val = allocazionePer("currency");
    const tS = set.reduce((a, x) => a + x.val, 0), tV = val.reduce((a, x) => a + x.val, 0);
    const usd = val.find(x => x.nome === "USD");
    const fx = fxExposure();
    return Math.abs(tS - patrimonio) < 1 && Math.abs(tV - patrimonio) < 1
      && Math.abs(set.reduce((a, x) => a + x.pct, 0) - 100) < 0.6
      && !!usd && !!fx && Math.abs(usd.pct - fx.pct) < 0.15;`));

  check("v205 allocazione: la liquidità entra come voce propria quando c'è", suReale(`
    const senza = allocazionePer("sector").find(x => x.nome === "Liquidità");
    cashEur = 50000; recomputeTotals();
    const con = allocazionePer("sector").find(x => x.nome === "Liquidità");
    return !!senza === (28500 > 0) && !!con && Math.abs(con.val - 50000) < 1;`));

  // ⚠ REGOLA SUPREMA: la vista struttura LEGGE, non scrive. Se una sua funzione mutasse una
  // riga del portafoglio, il payload cambierebbe senza che nessuno lo veda.
  check("v205 la vista struttura NON tocca il payload (buildPrompt identico prima e dopo)", suReale(`
    const prima = buildPrompt();
    concentrazioneRows(); derivaConcentrazione();
    distanzeStop(); allocazionePer("sector"); allocazionePer("currency"); seduteDelBook();
    return buildPrompt() === prima;`));
}


/* v210 — LIMITE D'INGRESSO IRRAGGIUNGIBILE. Trovato eseguendo il prompt su me stesso: il
   payload avvisava quando il TARGET era illusorio ma non quando l'INGRESSO era irraggiungibile,
   e un ordine che non si riempie mai — riportato come azione — dà la sensazione di aver agito.
   La distanza si misura in ATR, non in percentuale secca: il caso reale è WDC a −22,5% che NON
   va segnalato (ATR 9,92% → 2,3 ATR) mentre MSFT a −16,5% sì (ATR 3,45% → 4,8 ATR). Una soglia
   in percentuale avrebbe segnalato esattamente il titolo sbagliato. */
{
  const p = run("buildPrompt()");
  const riga = p.split("\n").find(l => /Livelli calcolati dal motore/.test(l)) || "";
  const conAtr = (riga.match(/×ATR/g) || []).length;
  const conAvviso = (riga.match(/ATR sotto il prezzo: questo ordine si riempie solo se il trend si rompe/g) || []).length;
  check("v210 ogni limite d'ingresso dichiara la distanza anche in ATR", conAtr >= 3);
  // l'avviso deve scattare SOLO oltre le 3 ATR: si verifica che ogni riga segnalata lo superi
  const segmenti = riga.split(" · ").filter(x => /limite d'ingresso/.test(x));
  const sbagliati = segmenti.filter(x => {
    const m = x.match(/=\s*([\d,]+)×ATR/); if (!m) return false;
    const atr = parseFloat(m[1].replace(",", "."));
    const flag = /si riempie solo se il trend si rompe/.test(x);
    return flag !== (atr >= 3);
  });
  check("v210 l'avviso scatta esattamente sopra le 3 ATR, né prima né dopo", segmenti.length > 0 && sbagliati.length === 0);
  if (sbagliati.length) console.log("  ⚠ righe con avviso incoerente:", sbagliati.map(x => x.slice(0, 60)).join(" | "));
  console.log(`  · limiti con distanza in ATR: ${conAtr} · segnalati come irraggiungibili: ${conAvviso}`);
}


/* ═══════════════════════════════════════════════════════════════════════════════════════
   v206 — REGISTRI DELLE TABELLE. Tre allineamenti che il codice dà per scontati e che
   NESSUN test verificava: SORT_FIELDS 1:1 con le <th>, i colspan delle righe speciali, e la
   vista compatta contro il proprio commento. Il terzo era già rotto — la watchlist dichiarava
   di mostrare la forza relativa e mostrava Beta e Sharpe — e nessuno se n'era accorto perché
   l'accesso è per INDICE: sfasare una colonna non produce nessun errore, solo il campo
   sbagliato. È la stessa classe del registro fisso già pagata con C10 e col red team I6.
   ═══════════════════════════════════════════════════════════════════════════════════════ */
{
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const thDi = (id) => {
    const tab = html.slice(html.indexOf(`id="${id}"`));
    const head = tab.slice(tab.indexOf("<thead>"), tab.indexOf("</thead>"));
    return [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)]
      .map(m => m[1].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim());
  };
  const ptfTh = thDi("ptf-table"), wlTh = thDi("wl-table");
  const sf = run("JSON.stringify(SORT_FIELDS)");
  const SF = JSON.parse(sf);

  // NB: il controllo di sanità è "l'estrazione ha trovato l'intestazione vera", non "ci sono
  // almeno N colonne". Un fondo numerico fisso invecchia da solo al primo taglio di colonne —
  // ed è successo in v208: il gate falliva sul numero, non sul disallineamento che deve trovare.
  check("v206 SORT_FIELDS allineato 1:1 alle <th> del portafoglio",
        ptfTh[0] === "Titolo" && SF["ptf-table"].length === ptfTh.length);
  check("v206 SORT_FIELDS allineato 1:1 alle <th> della watchlist",
        wlTh[0] === "Titolo" && SF["wl-table"].length === wlTh.length);
  if (SF["ptf-table"].length !== ptfTh.length)
    console.log(`  ⚠ ptf: ${ptfTh.length} <th> ma ${SF["ptf-table"].length} campi di ordinamento`);

  // i colspan della riga TOTALE devono coprire ESATTAMENTE il numero di colonne, altrimenti
  // la riga sborda (difetto già vissuto in v188 con le colonne nascondibili)
  // NB: `run` avvolge il codice in una arrow che ritorna l'espressione — se il frammento
  // contiene già `return` viene inserito com'è e la arrow esterna torna undefined. Qui serve
  // quindi una ESPRESSIONE sola, non un blocco.
  const cs = JSON.parse(run(
    'JSON.stringify((renderTable.toString().match(/colspan="\\d+"/g) || []).map(x => +x.match(/\\d+/)[0]))'));
  check("v206 colspan della riga TOTALE = numero di colonne del portafoglio",
        cs.length > 0 && cs.every(c => c <= ptfTh.length) && cs.includes(ptfTh.length));
  if (!cs.includes(ptfTh.length)) console.log(`  ⚠ colspan trovati: ${cs.join(", ")} · colonne: ${ptfTh.length}`);

  // la vista compatta deve mostrare ciò che il suo commento dichiara
  const vc = JSON.parse(run("JSON.stringify(VISTA_COMPATTA)"));
  const nomiPtf = vc["ptf-table"].map(i => ptfTh[i]);
  const nomiWl = vc["wl-table"].map(i => wlTh[i]);
  check("v206 vista compatta: il portafoglio mostra la forza relativa",
        nomiPtf.some(n => /^RS 1M$/.test(n)) && nomiPtf.some(n => /RS NDX/.test(n)));
  check("v206 vista compatta: la watchlist mostra la forza relativa (il commento lo dichiarava, gli indici no)",
        nomiWl.some(n => /^RS 1M$/.test(n)) && nomiWl.some(n => /RS NDX/.test(n)));
  check("v206 vista compatta: nessun indice fuori dalle colonne esistenti",
        vc["ptf-table"].every(i => ptfTh[i] != null) && vc["wl-table"].every(i => wlTh[i] != null));
  console.log(`  · compatta ptf: ${nomiPtf.join(" · ")}`);
  console.log(`  · compatta wl:  ${nomiWl.join(" · ")}`);
}


/* ═══════════════════════════════════════════════════════════════════════════════════════
   v213 — IL GATE CHE MANCAVA: nessun accesso NON protetto a un elemento inesistente.
   CLAUDE.md lo dichiara come convenzione fissa da versioni ("un addEventListener su elemento
   rimosso ha già rotto l'intero wiring più volte") e non c'era nessun controllo. In v212 ho
   rimosso quattro mini-card e lasciato i loro handler: lo script è morto alla prima riga di
   wiring e TUTTO ciò che veniva dopo — incluso il caricamento dei dati — non è mai partito.
   La pagina restava vuota e l'ho perfino attribuito alla rete.
   Il controllo è statico: ogni `$("#id")` senza `?.` deve riferirsi a un id presente in
   index.html, oppure a un elemento creato dinamicamente (riconosciuto perché quell'id compare
   anche in un template di app.js). ═══════════════════════════════════════════════════════ */
{
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const js = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const idsPagina = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  // id generati da app.js dentro una stringa di template (es. il centro della ciambella)
  const idsDinamici = new Set([...js.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map(m => m[1]));
  // ⚠ i commenti vanno tolti PRIMA di cercare: questo stesso file, e app.js, contengono dentro
  // un commento il frammento di codice che DESCRIVE il difetto — e il gate lo segnalava come
  // difetto vero. Un controllo statico che legge anche la prosa trova se stesso.
  const codice = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const righe = codice.split("\n");
  const nudi = [];
  righe.forEach((l, i) => {
    for (const m of l.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)(\??)[.[]/g)) {
      const [, id, sicuro] = m;
      if (sicuro === "?") continue;
      if (idsPagina.has(id) || idsDinamici.has(id)) continue;
      nudi.push(`#${id} (riga ${i + 1})`);
    }
  });
  check("v213 wiring: nessun $(\"#id\") senza ?. punta a un elemento che non esiste", nudi.length === 0);
  if (nudi.length) console.log("  ⚠ rompono il caricamento:", nudi.join(", "));
}


/* ---------- v204: STRUTTURA MINIMA DELLA PAGINA (guardia anti-taglio) ----------
   Tre volte in un'ora un taglio ha portato via un elemento VICINO a quello che doveva togliere:
   la concentrazione di fattore (viveva dentro i motivi del verdetto), cinque fatti di C12
   (stavano nello stesso array), la barra delle schede (stava fra i due blocchi rimossi).
   L'attenzione non basta: serve un elenco di elementi che devono ESISTERE, e che si rompe
   rumorosamente se un'operazione di rimozione ne prende uno per sbaglio. */
{
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const richiesti = [
    ["navigazione a schede", 'id="main-tabs"'],
    ["tabella portafoglio", 'id="ptf-table"'],
    ["tabella watchlist", 'id="wl-table"'],
    ["griglia macro", 'id="macro-grid"'],
    ["mini-card macro", 'class="mini-cards"'],
    // v209 — protegge l'ACCESSO ai dettagli macro, non più il bottone della topbar: quello è
    // stato rimosso perché duplicava questo, e la porta è ora una sola, nella colonna centrale.
    ["accesso ai dettagli macro", 'id="macro-details"'],
    ["scomposizione dei punteggi", 'id="mg-scomposizione"'],
    ["campanelli d'allarme", 'id="mg-signposts"'],
    ["riquadri patrimonio", 'id="kpi-grid"'],
    ["parametri di rischio", 'id="risk-params-card"'],
    ["modale grafico/pannelli", 'id="chart-modal"'],
    // v205 — la vista struttura e la shell a due colonne. Cinque contenitori vicini fra loro:
    // esattamente la configurazione in cui un taglio ne porta via uno per sbaglio.
    ["shell a due colonne", 'class="shell"'],
    ["scheda struttura", 'data-tab="struttura"'],
    ["grafico concentrazione", 'id="conc-chart"'],
    ["deriva della concentrazione", 'id="drift-chart"'],
    ["allocazione grafica", 'id="allocg-chart"'],
    ["distanza dallo stop", 'id="stopdist-chart"'],
  ];
  const mancanti = richiesti.filter(([, sel]) => !html.includes(sel)).map(([n]) => n);
  check("v204 struttura: nessun elemento portante è sparito da index.html", mancanti.length === 0);
  if (mancanti.length) console.log("  ⚠ elementi portanti mancanti:", mancanti.join(", "));
}

/* ---------- report ----------
   ⚠ v205: questo blocco stava PRIMA degli ultimi tre gruppi di check (v196, v205, v204).
   Conseguenza misurata: quei check finivano in T e venivano CONTATI nel totale, ma il ciclo
   che calcola `fail` era già passato — non venivano stampati e, soprattutto, NON facevano
   uscire con codice 1. Verificato togliendo `id="conc-chart"` da index.html: la suite
   annunciava "174/174 superati" ed exit 0. La guardia anti-taglio v204, cioè proprio quella
   nata perché "l'attenzione non basta", era spenta in silenzio.
   Il report va per ultimo: ogni check aggiunto in fondo al file deve poter rompere la CI. */
let fail = 0;
for (const [name, ok] of T) {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

console.log(`\n${T.length - fail}/${T.length} check superati`);
process.exit(fail ? 1 : 0);
