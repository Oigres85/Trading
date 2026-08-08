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
    /* ⚠ v253 — `children` mancava, e renderTable/renderWatchlist lo iterano per riallineare
       le intestazioni: nel gate di render lanciavano "head.children is not iterable", che NON
       è un difetto di produzione (in browser le due tabelle si disegnano, misurate 10 righe
       portafoglio e 27 watchlist) ma un buco dello stub. Uno stub incompleto produce un
       fallimento che sembra un bug e un bug che sembra uno stub incompleto: va chiuso, non
       aggirato escludendo le due funzioni dal gate. */
    children: [], childNodes: [], parentNode: null, insertBefore() {}, removeChild() {},
    getAttribute: () => null, hasAttribute: () => false, contains: () => false,
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
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

/* ═══ I DATI VERI: UNA COPIA SOLA, UN HELPER SOLO ══════════════════════════════════════════
   Prima erano SEI copie (REALE, REALE, REALE…REALE) caricate in blocchi diversi, ognuna col
   proprio helper locale. Quella duplicazione e' la causa concreta di un errore che in una sola
   sessione ho ripetuto QUATTRO volte: scrivere un check che gira sulla FIXTURE — che non ha
   macro.indicators, ne' seasonality/signposts, ne' ^KS11 in watchlist — e quindi NON CONTIENE
   IL FENOMENO da misurare. Un check cosi' e' verde (o rosso) per la ragione sbagliata: nel caso
   peggiore resta verde col difetto iniettato dentro.
   Con una sola porta d'ingresso ai dati veri, "su quali dati gira questo check" smette di essere
   una domanda a cui si puo' rispondere male per distrazione. */
const REALE_JSON = readFileSync(join(ROOT, "data", "data.json"), "utf8").replace(/\bNaN\b/g, "null");
vm.runInContext("REALE = " + REALE_JSON + ";", ctx, { filename: "reale.js" });
const reale = JSON.parse(REALE_JSON);      // stessi dati lato Node, per i check che li ispezionano
/* copia PROFONDA a ogni uso: alcuni check MUTANO il portafoglio per provare un ramo, e con
   l'assegnazione per riferimento la mutazione restava addosso ai check successivi (v205). */
const suVeri = (code, cash = 28500) => run(`
  const _salva = DATA, _cash = cashEur;
  DATA = JSON.parse(JSON.stringify(REALE)); cashEur = ${cash}; recomputeTotals();
  try { ${code} } finally { DATA = _salva; cashEur = _cash; recomputeTotals(); }`);
const suReale = suVeri;          // nome storico, stessa funzione

/* ---------- checks ---------- */
const T = [];
/* ═══ check() ACCETTA SOLO UN BOOLEANO ═════════════════════════════════════════════════════
   Prima accettava qualunque valore e lo trattava come verita': `check("x", () => {…})` passava
   una FUNZIONE, che e' truthy, quindi il check era VERDE SENZA AVER MAI ESEGUITO IL SUO CORPO.
   In una sola sessione e' successo due volte, e tutte e due le volte me ne sono accorto solo
   perche' le iniezioni di validazione non mordevano: senza quelle, sarebbero rimasti in suite
   dei check permanentemente verdi che non verificano niente — la forma peggiore di test.
   Ora un tipo diverso da boolean non e' un dettaglio da notare: e' un FALLIMENTO, col nome del
   check e il tipo ricevuto. La trappola non e' piu' commettibile. */
const check = (name, expr) => {
  if (typeof expr !== "boolean") {
    T.push([`${name}   ⛔ CHECK MALFORMATO: check() vuole un BOOLEANO, ha ricevuto ${typeof expr}` +
      (typeof expr === "function" ? ' — hai passato una arrow: invocala, `(() => { … })()`' : ""), false]);
    return;
  }
  T.push([name, expr]);
};
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
    (dv.overCap || []).some(x => (x.r || x).ticker === "TST1")     // v247: classifica sì, verdetto nel payload no
    && !buildPrompt().includes("Cap d'ingresso")`));
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
    !(dv.concentrationAlert || []).length`));
check("alert concentrazione v121: SOLO sopra il 25% del NAV, come avviso (non trim)", run(`
  // gonfio TST1 oltre il 25%: deve comparire l'alert concentrazione, mai un obbligo di trim
  const r = DATA.portfolio.find(x => x.ticker === "TST1");
  const oldQty = r.qty; r.qty = 1000; recomputeTotals();
  const dv = decisionVerdict();
  r.qty = oldQty; recomputeTotals();
  return dv.concentrationAlert.some(x => x.r.ticker === "TST1") &&
    (dv.concentrationAlert || []).length > 0                       // v247: classifica sì
    && !buildPrompt().includes("ALERT CONCENTRAZIONE")`));

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
    (dv.rehabbed || []).some(x => (x.r || x).ticker === "TSTR")`));

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
  // v247: la riabilitazione non è più una riga di verdetto; resta la CLASSIFICAZIONE e il fatto
  // che il candidato superi la soglia usando lo Sharpe 6M (che è ciò che il check misura davvero)
  return !!cand && cand._q >= 60 && (dv.rehabbed || []).some(x => (x.r || x).ticker === "TSTR6")`));

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
check("prompt: consegna minima (leading KOSPI/Nasdaq/BTC, quote calcolate, news, gap pre/after)",
  has("KOSPI") && has("Bitcoin") && /calcolo della quantità di quote|quantità di quote/.test(prompt)
  && has("NEWS") && /pre\/after|Pre\/After/i.test(prompt));
check("prompt: matrice di rischio per posizione", has("MATRICE DI RISCHIO PER POSIZIONE"));
check("prompt: flag [STOP VIOLATO] su TST3", /\[STOP VIOLATO\][\s\S]*TST3|TST3[^\n]*\[STOP VIOLATO\]/.test(prompt));
/* ⚠ v247 — INVARIANTE ROVESCIATO. Sorvegliava che il VaR pubblicato fosse quello STORICO
   (più prudente sulle code grasse) e non il parametrico. Ora VaR ed ES sono FUORI dal payload
   per scelta del CEO: erano il divisore del budget operativo, cioè il vincolo di spesa.
   ⚠ La pipeline continua a CALCOLARLI — servono altrove e toglierli dal calcolo sarebbe stato
   perdere un fatto, non un giudizio (classe v208). Cambia solo cosa arriva all'LLM. */
/* ⚠ su `run()` (fixture) i campi VaR/ES non esistono: il check sarebbe verde per ASSENZA di
   dati, non di difetti — la trappola già pagata quattro volte in questo progetto. Va sui dati VERI. */
check("v247 VaR: fuori dal payload, ma la pipeline continua a calcolarlo", suVeri(`
  const p = buildPrompt();
  /* ⚠ si cerca la RIGA che generavo io, non la parola: "Expected Shortfall" compare anche nella
     TESTATA (config/prompt_header.txt), che è il file del CEO e non si tocca. Una guardia che
     cerca la parola nuda punirebbe il contenuto di cui non sono responsabile. */
  const fuori = !/VaR 95% a 1 giorno/.test(p) && !/Expected Shortfall 95% a 1 GIORNO/.test(p);
  const calcolato = DATA?.totals?.es95_hist_eur != null || DATA?.totals?.var95_hist_eur != null;
  return fuori && calcolato`));
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
/* ⚠ v247 — INVARIANTE CAMBIATO, non zittito. Prima chiedeva che il payload PRESCRIVESSE il
   trattamento dello squeeze (sizing dimezzato, stop 1×ATR, mai media al ribasso): è esattamente
   il genere di riga che il CEO ha fatto togliere. Ora chiede due cose insieme — che il MOTORE
   continui a classificarlo (la dashboard lo usa) e che il PAYLOAD non porti più la prescrizione.
   Zittire la guardia avrebbe perso la protezione (classe v203); cambiarle invariante la conserva. */
check("v247 squeeze: il motore lo classifica ancora, il payload non lo prescrive più", run(`
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
  /* ⚠ il FLAG in tabella "[TURNAROUND SQUEEZE RISK]" RESTA: descrive un setup misurato (short
     interest + RVol + prezzo sopra SMA50), esattamente come "[!EARNINGS RISK]", e non prescrive
     nulla. Ciò che è stato tolto è la PRESCRIZIONE che lo accompagnava. La prima stesura di
     questa guardia vietava anche il flag: vietava troppo, e avrebbe fatto sparire un fatto. */
  return (dv.squeezed || []).length === 1 && !!row
    && p.includes("[TURNAROUND SQUEEZE RISK]")       // il flag descrittivo resta
    && !p.includes("SPECULAZIONE asimmetrica")       // la prescrizione no
    && !p.includes("sizing massimo METÀ")
    && !p.includes("stop stretto 1×ATR")`));
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
/* ⚠ v247 — DUE INVARIANTI ROVESCIATI. Chiedevano che il payload pubblicasse il cap d'ingresso
   e l'alert di concentrazione: un divieto di acquisto e una soglia superata, cioè due delle
   quattro categorie che il CEO ha fatto togliere. La cosa che conta davvero è sopravvissuta ed
   è quella che ora si verifica: il PESO di ogni posizione resta pubblicato, e nessuna riga
   impone o suggerisce di alleggerire. "Let Winners Run" non è più affermato a parole: è vero
   perché non esiste più nessuna riga che dica il contrario. */
check("v247 cap: il divieto d'acquisto e l'alert di concentrazione sono fuori dal payload", run(`
  const p = buildPrompt();
  return !p.includes("Cap d'ingresso") && !p.includes("ALERT CONCENTRAZIONE")
    && !p.includes("obbligo di trim") && !p.includes("trimming di rientro")`));

check("v247 cap: il PESO delle posizioni resta però pubblicato (la misura non si tocca)", run(`
  const p = buildPrompt();
  // il peso sul NAV è la misura che il cap usava come pretesto: deve restare, e resta
  return /% del NAV/.test(p) && /posizione più pesante/.test(p)`));

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
  /* ⚠ v230 — riagganciato al FATTO, non alla stringa. Prima cercava "[STOP A RISCHIO AFTER" e si
     e' rotto quando il tag e' stato riformulato per dichiarare la DISTANZA DALLO STOP invece del
     gap pre/chiusura (un report reale aveva letto il gap come lo sfondamento). L'invariante che
     conta e' che la riga porti un avviso che nomina la sessione estesa E lo stop: e' la SESTA
     volta in questo progetto che un check legato al testo si rompe senza che manchi nulla. */
  return !!row && /\\[AFTER \\$/.test(row) && /STOP \\$/.test(row);`));

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
/* ⚠ v252 — INVARIANTE ROVESCIATO. Il digest Margin Debt non esiste più: il CEO l'ha tolto
   perché con 68 giorni di ritardo è fuorviante come "stato attuale". Il test ora presidia il
   TAGLIO — se qualcuno rimette la serie FINRA nel pacchetto, questo check fallisce. */
check("v252 Margin Debt: nessun digest storico lo rimette nel pacchetto", run(`
  const t = historicalDigestText();
  return !/[Mm]argin [Dd]ebt/.test(t) && !/FINRA/.test(t) && t.length > 200`));
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
/* ⚠ v252 — INVARIANTE CAMBIATO. ⚡ASIMM viveva dentro la colonna "Segnale", che è uscita dal
   payload perché era un'etichetta calcolata da RSI e distanza dalla SMA200 — due colonne già
   presenti. ASIMM è della stessa natura: deriva da Sortino > 1,7× Sharpe con RSI>55, e tutti e
   tre sono COLONNE della tabella. Quindi l'invariante che conta non è "l'etichetta c'è", è
   "le misure che la generano ci sono": l'LLM può ricostruirla, e senza un'etichetta in mezzo. */
check("v252 ASIMM: l'etichetta è uscita, ma le misure che la generano restano in Tabella A", run(`
  const p = buildPrompt();
  const testa = p.split("\\n").find(l => l.startsWith("| Titolo | Qtà"));
  return !!testa && !/\\| Segnale \\|/.test(testa)
    && /Sortino 1A/.test(testa) && /Sharpe 1A/.test(testa) && /RSI/.test(testa)`));
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
/* ⚠ v253 — INVARIANTE ROVESCIATO, non zittito. initRiskEditor() e renderRiskParams() sono
   state rimosse: scrivevano su contenitori spariti quando il CEO ha tolto la scheda
   "Parametri di Rischio del Fondo". Il check ora presidia il TAGLIO — se qualcuno le
   reintroduce senza rimettere i contenitori, tornano due funzioni che girano nel vuoto. */
check("v253 le funzioni dell'editor soglie sono uscite insieme alla loro scheda", (() => {
  const app = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const html2 = readFileSync(join(ROOT, "index.html"), "utf8");
  const ci = /function (?:initRiskEditor|renderRiskParams)\b/.test(app);
  const contenitore = /id="risk-params-grid"/.test(html2);
  return ci === contenitore;      // o ci sono entrambe, o nessuna delle due
})());

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
/* ⚠ v247 — INVARIANTE CAMBIATO. La severità del veto (FORTE/DEBOLE) era un'etichetta di
   bocciatura e il CEO l'ha fatta togliere dal payload. Il motore la calcola ancora — serve alla
   dashboard — ma il payload non la pubblica. Quello che DEVE restare, e che qui si verifica, è
   la MISURA che la motivava: senza il Sortino nelle tabelle il taglio avrebbe fatto sparire un
   fatto, non un giudizio (classe v208). */
check("v247 veto: la severità è fuori dal payload, ma la misura che la motivava resta", run(`
  const p = buildPrompt();
  const fuori = !/veto (FORTE|DEBOLE)/.test(p) && !/\\[(FORTE|DEBOLE)\\]/.test(p);
  const misura = /Sortino/.test(p);          // la colonna di Tabella A
  return fuori && misura`));

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

/* ⚠ v247 — INVARIANTE ROVESCIATO. Sorvegliava che la riga "posizione più pesante" citasse il
   cap REALE e non un 10% scritto a mano: era la protezione giusta finché il cap veniva
   pubblicato. Ora il cap NON si pubblica più (è un divieto), quindi la protezione diventa
   verificare che il PESO resti — è la misura — e che nessun cap la accompagni. */
check("v247 peso: la posizione più pesante è pubblicata, senza alcun cap accanto", run(`
  const p = buildPrompt();
  const riga = p.split("\\n").find(l => l.includes("posizione più pesante"));
  return !!riga && /% del NAV/.test(riga)
    && !/cap d'ingresso/.test(riga) && !/divieto di ACCUMULO/.test(riga)`));

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
  /* ⚠ v232 — riagganciato al FATTO. Prima cercava la parola "ANTICIPATORI", che dalla v232
     dipende dalla FASE: a sessione USA aperta quei dati non anticipano nulla (la seduta che
     dovrebbero precedere sta gia' scambiando) e l'etichetta lo dichiara. L'invariante che conta
     e' che i tre strumenti compaiano INLINE nella riga di sessione, col tag di freschezza
     giusto — SETTIMA volta che un check legato al testo si rompe senza che manchi nulla. */
  const riga = p.split(String.fromCharCode(10)).find(l => l.startsWith("CONTESTO DI SESSIONE (")) || "";
  return riga.includes("KOSPI +4,5% " + attesa) && riga.includes("Fut NDX +0,27%")
    && /ANTICIPATORI|NON anticipatori|non anticipano/.test(riga)`));
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
/* ⚠ v247 — INVARIANTE ROVESCIATO. Chiedeva che le detenute in VETO FORTE comparissero in una
   LISTA nel payload: è esattamente l'elenco che il CEO ha citato come causa del "mi fa vendere
   tutto". Il motore continua a identificarle (la dashboard le usa), ma il payload non le elenca
   più. Si verificano entrambe le cose, perché perdere la prima sarebbe perdere un fatto. */
check("v247 decisioni: il motore identifica ancora le detenute in veto, il payload non le elenca", run(`
  const p = buildPrompt();
  const dv = decisionVerdict();
  const detenuteInVeto = (dv.excluded || []).filter(x => x.r && x.r.qty
    && String(x.strength || "").toLowerCase() === "forte");
  // il motore le classifica ancora…
  const motoreOk = Array.isArray(dv.excluded);
  // …e il payload non porta più né l'elenco né l'etichetta di bocciatura
  const payloadPulito = !p.includes("🔷") && !p.includes("POSIZIONI DA GUARDARE")
    && !/VETO FORTE/.test(p) && !p.includes("ESCLUSI dal veto risk manager");
  // ma il P&L e il Sortino di quelle posizioni restano nelle tabelle
  const misureVive = detenuteInVeto.length === 0
    || detenuteInVeto.every(x => p.includes(x.r.ticker));
  return motoreOk && payloadPulito && misureVive`));
/* ⚠ v247 — INVARIANTE ROVESCIATO. Sorvegliava che il capitale liquidabile non fosse presentato
   come capienza di spesa. Ora il payload non porta NESSUNA capienza di spesa — né budget
   operativo, né capitale immobilizzato, né quantità massime autorizzate — quindi la protezione
   diventa più forte: non c'è più niente da confondere con un budget. */
check("v247 budget: il payload non porta più nessuna capienza di spesa", run(`
  const p = buildPrompt();
  return !p.includes("CAPITALE IMMOBILIZZATO")
    && !p.includes("BUDGET OPERATIVO SPENDIBILE")
    && !p.includes("VINCOLO PIÙ STRETTO")
    && !/entrano max ~?\\d+ quote/.test(p)`));
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
  const line = b.split("\\n").find(l => l.startsWith("· ALPHA DEL PROCESSO"));
  // v221 — ancorato all'INIZIO della riga: cercandola con includes() il check pescava la riga
  // BENCHMARK non appena questa ha iniziato a CITARE "ALPHA DEL PROCESSO" per rimando. Un nome
  // citato non identifica una riga; la sua posizione sì.
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
/* ⚠ v247 — INVARIANTE ROVESCIATO. Chiedeva che ogni candidato già detenuto dichiarasse la
   "capienza residua entro il cap": è il divieto d'acquisto che il CEO ha fatto togliere.
   Quello che resta e che qui si verifica è la MISURA che il cap usava come pretesto — il peso
   della posizione sul NAV — più l'assenza di qualunque tetto autorizzativo. */
check("v247 cap: niente capienza né tetti sui candidati, ma il peso resta pubblicato", run(`
  const p = buildPrompt();
  const nienteTetti = !/capienza residua/.test(p) && !/capienza ESAURITA/.test(p)
    && !/su un cap del/.test(p);
  const pesoVivo = /% del NAV/.test(p);
  return nienteTetti && pesoVivo`));
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
  // ⚠ COPIA PROFONDA, non `DATA = REALE`: alcuni di questi check MUTANO il portafoglio o lo
  // storico per provare un ramo, e con l'assegnazione per riferimento la mutazione restava
  // addosso a REALE facendo fallire i check successivi. Se n'è accorto il test stesso — ed è
  // la ragione per cui ogni check parte da uno stato pulito.

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
    // v217 — #macro-grid e #gauges rimossi: erano 16 riquadri e 11 tachimetri sostituiti dalla
    // classifica unica. La guardia si sposta su ciò che ora porta quella stessa informazione,
    // così il macro resta protetto invece di restare scoperto.
    ["classifica indicatori macro", 'id="mg-tutti"'],
    /* v238 — "Da cosa nascono i punteggi" e' stata rimossa: i fattori dei compositi vivono ora
       nelle schede della classifica. La guardia si SPOSTA sul contenitore che li porta. */
    ["classifica indicatori", 'id="mg-tutti"'],
    ["rotazione settoriale", 'id="mg-rot"'],
    // v218 — le mini-card non esistono più: l'ultima ("Interni di mercato") è confluita nella
    // classifica unica, già protetta qui sopra da id="mg-tutti". La guardia si sposta sui due
    // blocchi convertiti in questa versione, che sono i nuovi portatori di quell'informazione.
    /* v243 — "campanelli d'allarme" rimossa su richiesta del CEO: la guardia si SPOSTA sul
       contenitore portante rimasto nella vista, non si cancella con la sezione (classe v203). */
    ["classifica indicatori", 'id="mg-tutti"'],
    // v209 — protegge l'ACCESSO ai dettagli macro, non più il bottone della topbar: quello è
    // stato rimosso perché duplicava questo, e la porta è ora una sola, nella colonna centrale.
    // v219 — il bottone "Dettagli macro" è stato rimosso su richiesta del CEO: il popup a 39
    // pannelli era una seconda pagina dentro la pagina. I pannelli NON sono persi — si aprono
    // cliccando la barra del rispettivo indicatore nella classifica (id="mg-tutti", protetto
    // qui sopra) e passano dalla modale, che quindi diventa l'elemento portante da proteggere.
    ["modale dei pannelli macro", 'id="chart-modal"'],
    ["termometri di stress", 'id="mg-stress"'],
    ["leva e stagionalità", 'id="mg-leva"'],
    ["riquadri patrimonio", 'id="kpi-grid"'],
    /* ⚠ v249 — la card "Parametri di Rischio del Fondo" è stata RIMOSSA su richiesta del CEO
       ("avevo detto di lasciare solo calcolatore pmc e calcolo vendite"). Il registro NON è
       stato zittito: gli è cambiato il contenuto, e al posto della card entrano i due strumenti
       che devono sopravvivere. Se un domani un taglio si portasse via anche quelli, il gate lo
       direbbe — che è esattamente il motivo per cui questo registro esiste (v204). */
    ["calcolatore PMC", 'id="open-pmc"'],
    ["calcolo vendite", 'id="open-sell"'],
    ["modale grafico/pannelli", 'id="chart-modal"'],
    // v205 — la vista struttura e la shell a due colonne. Cinque contenitori vicini fra loro:
    // esattamente la configurazione in cui un taglio ne porta via uno per sbaglio.
    ["shell a due colonne", 'class="shell"'],
    ["scheda struttura", 'data-tab="struttura"'],
    ["grafico concentrazione", 'id="conc-chart"'],
    /* v238 — "deriva della concentrazione" e' stata rimossa su richiesta del CEO. La guardia NON
       si cancella: si sposta sulla griglia degli indicatori, che e' l'elemento portante rimasto
       in quella zona della vista (togliere codice e guardia insieme e' la classe v203). */
    ["classifica indicatori", 'id="mg-tutti"'],
    ["allocazione grafica", 'id="allocg-chart"'],
    // v225 — "distanza dallo stop" e' stata rimossa su richiesta del CEO. La guardia NON si
    // cancella: si sposta sulla tabella del portafoglio, che e' l'elemento portante rimasto in
    // quel riquadro. (distanzeStop() sopravvive e continua a essere verificata piu' sopra.)
    ["tabella portafoglio", 'id="ptf-table"'],
  ];
  const mancanti = richiesti.filter(([, sel]) => !html.includes(sel)).map(([n]) => n);
  check("v204 struttura: nessun elemento portante è sparito da index.html", mancanti.length === 0);
  if (mancanti.length) console.log("  ⚠ elementi portanti mancanti:", mancanti.join(", "));
}

/* ═══ v225 — I TAG DI index.html DEVONO BILANCIARSI ═════════════════════════════════════════
   Difetto trovato in v225, e nessuno dei 180 check lo vedeva: un </div> ORFANO a meta' pagina,
   residuo del blocco <details> tolto in v215/v218. Non e' cosmetico. Il parser HTML, davanti a
   un </div> di troppo, chiude il primo div APERTO in scope — cioe' .shell-main. Misurato sul
   sito vivo prima della correzione: 8 sezioni su 18 finivano come figlie dirette di .shell, che
   e' una griglia 178px | 1038px, e su Portafoglio le card si alternavano fra le due colonne
   ("Peso delle posizioni" disegnato largo 178px, dentro la colonna della barra laterale).
   E' la "sovrapposizione del testo" segnalata due volte dal CEO: la causa non era nel CSS.

   Perche' serve un gate e non l'attenzione: l'HTML malformato NON produce nessun errore. Il
   browser ripara in silenzio, la console resta pulita, i test sulle funzioni pure passano tutti.
   Stessa famiglia di .abar-fill senza display:block (v205) — un difetto che non si rompe.

   Il secondo check e' quello che conta davvero: ogni sezione con data-pane deve essere figlia
   DIRETTA di .shell-main, perche' e' li' che vivono l'impaginazione e il riordino v225. */
{
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const VUOTI = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
  const pulito = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script></script>")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style></style>");
  /* Scanner a CARATTERI, non a regex: il favicon di questa pagina e' un data-URI che contiene
     <svg …><rect/><text>T</text></svg> DENTRO un attributo. Una regex sui tag lo legge come
     markup vero e denuncia uno sbilanciamento che non esiste — la prima stesura di questa
     guardia ha fatto esattamente questo. Qui le virgolette degli attributi si rispettano. */
  const pila = [], errori = [], fuoriPosto = [];
  const rigaDi = (k) => (pulito.slice(0, k).match(/\n/g) || []).length + 1;
  for (let k = 0; k < pulito.length; k++) {
    if (pulito[k] !== "<") continue;
    const chiude = pulito[k + 1] === "/";
    const nome = /^[a-zA-Z]/.test(pulito[k + (chiude ? 2 : 1)] || "");
    if (!nome) continue;                                  // <!DOCTYPE, <! …: non sono elementi
    let q = 0, e = k + 1;
    for (; e < pulito.length; e++) {                      // trova il > che chiude DAVVERO il tag
      const c = pulito[e];
      if (q) { if (c === q) q = 0; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === ">") break;
    }
    const grezzo = pulito.slice(k, e + 1);
    const t = (grezzo.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/) || [, ""])[1].toLowerCase();
    const auto = /\/>$/.test(grezzo);
    const riga = rigaDi(k);
    k = e;
    if (VUOTI.has(t) || auto) continue;
    if (!chiude) {
      if (t === "section" && /data-pane=/.test(grezzo)) {  // deve nascere dentro .shell-main
        const g = pila[pila.length - 1];
        if (!g || !/class="shell-main"/.test(g.attr)) fuoriPosto.push(`riga ${riga} dentro <${g ? g.t : "?"}>`);
      }
      pila.push({ t, attr: grezzo, riga });
    } else {
      if (!pila.length) { errori.push(`</${t}> di troppo a riga ${riga}: non c'e' niente di aperto`); continue; }
      const apre = pila[pila.length - 1];
      if (apre.t !== t) {
        errori.push(`</${t}> a riga ${riga} chiude <${apre.t}> aperto a riga ${apre.riga}`);
        const idx = pila.map(x => x.t).lastIndexOf(t);
        if (idx < 0) continue;                            // orfano puro: si ignora e si prosegue
        pila.length = idx;                                // il browser poppa fino al tag: idem qui
      } else pila.pop();
    }
  }
  const aperti = pila.map(x => `<${x.t}> a riga ~${x.riga}`);
  check("v225 index.html: i tag si bilanciano (nessun </div> orfano che chiuda .shell-main)",
    errori.length === 0 && aperti.length === 0);
  if (errori.length) console.log("  ⚠ tag sbilanciati:", errori.slice(0, 5).join(" · "));
  if (aperti.length) console.log("  ⚠ rimasti aperti:", aperti.slice(0, 5).join(" · "));

  check("v225 index.html: ogni sezione con data-pane è figlia diretta di .shell-main",
    fuoriPosto.length === 0);
  if (fuoriPosto.length) console.log("  ⚠ sezioni fuori posto:", fuoriPosto.join(" · "));

  // v225 — le chiavi del riordino: stabili, uniche, e presenti su OGNI sezione di pane.
  // Se una sezione ne resta priva non e' trascinabile e non entra nell'ordine salvato; se due
  // la condividono, spostarne una sposta l'altra. Nessuna delle due cose fa rumore da sola.
  const sez = [...html.matchAll(/<section\b[^>]*\bdata-pane="([a-z]+)"[^>]*>/g)].map(m => m[0]);
  const chiavi = sez.map(t => (t.match(/data-sez="([^"]+)"/) || [])[1]);
  /* ⚠ v243 — il fondo era `sez.length >= 15`, un CONTEGGIO FISSO: ogni sezione rimossa su
     richiesta del CEO lo faceva scattare senza che nulla fosse rotto (e' successo tre volte:
     deriva, scomposizione, campanelli). E' la classe v208 — "un fondo numerico invecchia da
     solo, la sanita' dev'essere una PROPRIETA'". La proprieta' vera: ogni pane esistente ha
     almeno una sezione, e ogni sezione ha la sua chiave, tutte distinte. */
  const pani = new Set([...html.matchAll(/data-pane="([a-z]+)"/g)].map(m => m[1]));
  check("v225 riordino: ogni sezione di pane ha una chiave data-sez, tutte distinte",
    sez.length > 0 && pani.size >= 3 && chiavi.every(Boolean)
    && new Set(chiavi).size === chiavi.length);

  // e la chiave deve essere una CHIAVE, non il titolo: se domani si rinomina una sezione
  // l'ordine salvato dal CEO non deve andare perso (lezione v196).
  check("v225 riordino: il modulo legge data-sez e non il titolo della sezione",
    /dataset\.sez/.test(src) && !/\.sez\b.*querySelector\("h2"\)/.test(src));
}

/* ═══ v233 — NESSUN INDICATORE PUO' SPARIRE DALLA GRIGLIA ══════════════════════════════════
   Erede diretto dei check v226. Quelli verificavano che nessun indicatore andasse perso nel
   RAGGRUPPAMENTO IN FAMIGLIE; le famiglie non esistono piu' (la vista a pallini e' stata
   rimossa in v233), ma l'invariante che proteggevano vale identico: OGNI indicatore deve avere
   la sua scheda, e la strada per verificarlo e' il render vero, non una funzione pura.
   ⚠ Le guardie si SPOSTANO col meccanismo, non si cancellano con esso — classe v203. */
{
  const rendiTutti = () => suVeri(`
    let html = "";
    const box = { set innerHTML(v) { html = v; }, get innerHTML() { return html; },
                  querySelector: () => null, querySelectorAll: () => [] };
    const altro = () => ({ innerHTML: "", textContent: "", querySelector: () => null,
                           querySelectorAll: () => [], addEventListener() {} });
    const vero = document.querySelector;
    document.querySelector = (sel) => sel === "#mg-tutti" ? box : altro();
    try { renderIndicatori(); } finally { document.querySelector = vero; }
    return html;`, 56000);

  check("v233 classifica: una scheda per OGNI indicatore, nessuno perso", (() => {
    const html = rendiTutti();
    // ⚠ `class="mg-card` matcha anche `mg-card-head`: contava il doppio. Si ancora
    // all'intestazione, che c'e' una e una sola volta per scheda.
    const schede = (html.match(/class="mg-card-head"/g) || []).length;
    const attesi = suVeri("return indicatoriClassifica().length;", 56000);
    return schede === attesi && attesi >= 20;
  })());

  check("v233 classifica: è una griglia di mini tab, non un grafico unico", (() => {
    const html = rendiTutti();
    return /class="mg-tris"/.test(html) && !/pt-punto|rd-fam/.test(html);
  })());

  /* ⚠ MISURATO PRIMA DI SCRIVERE IL CODICE: dei 30 indicatori solo 3 hanno un grafico nel
     pannello e 4 una tabella. Il check non pretende che ce ne siano molti — pretende che quelli
     che ESISTONO arrivino nella scheda invece di restare dietro un clic, che e' la richiesta. */
  /* ⚠ v238 — L'INVARIANTE SI E' ALLARGATO ANCORA, ed e' la richiesta del CEO alla lettera:
     "voglio tutti grafici in struttura". Non piu' "chi ha contenuto nel pannello lo porta fuori"
     (che lasciava scoperti gli indicatori senza pannello), ma: OGNI scheda deve contenere una
     forma disegnata — una scala con le sue zone, barre, una linea nel tempo, un conto alla
     rovescia o una tabella. Una scheda col solo numero non e' piu' ammessa. */
  check("v238 classifica: OGNI scheda ha una forma disegnata, nessuna col solo numero", (() => {
    const html = rendiTutti();
    const schede = html.split(/<div class="mg-card(?!-head)/).slice(1);
    const nude = schede.filter(c => !/(<svg|<table|class="obar-row|class="cdr")/.test(c));
    return schede.length >= 20 && nude.length === 0;
  })());

  /* e ogni scheda deve portare la sua SPIEGAZIONE DI LETTURA: il CEO ha chiesto "dati dettagliati
     e spiegazioni di lettura del dato", e un grafico senza la riga che dice cosa guardare e'
     esattamente la forma che ha respinto tre volte. */
  check("v238 classifica: la maggior parte delle schede spiega come si legge il dato", (() => {
    const html = rendiTutti();
    const schede = html.split(/<div class="mg-card(?!-head)/).slice(1);
    const conLettura = schede.filter(c => /Come si legge/.test(c)).length;
    return schede.length >= 20 && conLettura >= Math.round(schede.length * 0.6);
  })());

  /* ⚠ v237 — E LO STESSO DATO NON DEVE COMPARIRE DUE VOLTE NELLA STESSA SCHEDA. Misurato in
     browser dopo la v235: 8 schede su 30 dicevano il valore corrente nella nota e di nuovo nella
     riga estratta dal pannello. E' la classe "lo stesso dato che si presentava come due dati"
     (v184), reintrodotta portando fuori le righe senza confrontarle con la nota. */
  /* ⚠ v243 — il confronto deve NORMALIZZARE i formati: la nota scrive "4.69" (formato del dato)
     e il pannello "4,69%" (formato italiano). Confrontando le stringhe grezze la ripetizione non
     veniva riconosciuta, e sulla scheda del carry gli stessi numeri comparivano due volte. */
  check("v237 classifica: il valore corrente non è ripetuto fra nota e riga estratta", (() => {
    const html = rendiTutti();
    const schede = html.split(/<div class="mg-card(?!-head)/).slice(1);
    const doppie = schede.filter(c => {
      const nota = (c.match(/class="muted mg-n">([\s\S]*?)<\/div>/) || ["", ""])[1].replace(/<[^>]*>/g, " ");
      const nn = (x) => String(x).replace(/[.,]/g, "");
      const num = (nota.match(/[\d][\d.,]{1,}/g) || []).filter(x => x.length > 2).map(nn);
      if (!num.length) return false;
      /* ⚠ v243 — non piu' solo le righe etichettate "Valore attuale": la ridondanza non dipende
         dall'etichetta. E i numeri si confrontano NORMALIZZATI, perche' la nota scrive "4.69" e
         il pannello "4,69%" — confrontando le stringhe grezze la ripetizione non si vedeva, ed
         e' cosi' che sulla scheda del carry gli stessi valori comparivano due volte. */
      return [...c.matchAll(/<div class="info-line[\s\S]*?<\/div>/g)].some(m => {
        const t2 = m[0].replace(/<[^>]*>/g, " ");
        const n2 = (t2.match(/[\d][\d.,]{1,}/g) || []).filter(x => x.length > 2).map(nn);
        return n2.length > 0 && n2.every(x => num.includes(x));
      });
    });
    return schede.length >= 20 && doppie.length === 0;
  })());

  // ⚠ e il grafico della serie non deve comparire DUE volte (una dalla serie, una dal pannello)
  /* ⚠ la prima stesura confrontava i TOTALI con un margine, ed era cosi' larga da non mordere
     quando ho iniettato il duplicato. Si misura per SCHEDA: chi ha il grafico della serie non
     deve portare anche quello del pannello, che disegnerebbe la stessa cosa due volte. */
  check("v233 classifica: nessuna scheda ha il grafico due volte (serie + pannello)", (() => {
    const html = rendiTutti();
    const schede = html.split(/<div class="mg-card(?!-head)/).slice(1);
    const doppie = schede.filter(c => /class="g-serie/.test(c) && (c.match(/<svg/g) || []).length > 1);
    return schede.length >= 20 && doppie.length === 0;
  })());

  // e chi non ha ne' serie ne' pannello non deve prendere un riempitivo inventato
  check("v233 classifica: nessuna forma respinta è rientrata come riempitivo",
    !/function\s+(misuratore|quadrante|radarFamiglie|annoCircolare|puntiSuAsse)\s*\(/.test(src));
}

/* ═══ v228 — LA TRIMESTRALE DI OGGI E' LA PIU' URGENTE, NON LA MENO ════════════════════════
   Trovato eseguendo il payload su me stesso. PLTR riportava gli utili OGGI, era in portafoglio
   e aveva lo stop violato: il caso più urgente del run. La TABELLA lo segnalava, la riga
   PRIORITÀ del brief NO. Due derivazioni della stessa grandezza (Math.ceil sui millisecondi vs
   confronto grezzo >= 0) che divergono esattamente a zero giorni, perché `new Date("2026-08-03")`
   è la MEZZANOTTE di quel giorno e a mercato aperto è già passata.
   Classe v161/v207: due implementazioni della stessa domanda, coerenti solo per fortuna. */
{
  vm.runInContext(`PARAMS_CEO = ${JSON.stringify(readFileSync(join(ROOT, "config", "risk_params.json"), "utf8"))};`, ctx, { filename: "params.js" });
  check("v228 trimestrali: oggi = 0 giorni, ieri negativo, domani 1 (non dipende dall'ora)",
    run(`
      const iso = new Date().toISOString().slice(0, 10);
      const ieri = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const dom  = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      return giorniAllaTrimestrale(iso) === 0 && giorniAllaTrimestrale(dom) === 1
        && giorniAllaTrimestrale(ieri) === -1 && giorniAllaTrimestrale(null) === null;`));

  check("v228 trimestrali: una sola derivazione — nessun ricalcolo a mano dei giorni",
    !/Math\.ceil\(\(new Date\([^)]*earnings/.test(src));

  check("v228 priorità: una trimestrale OGGI su posizione detenuta finisce nel brief, marcata", run(`
    const _d = DATA, _c = cashEur;
    DATA = JSON.parse(JSON.stringify(REALE)); cashEur = 28500;
    const oggi = new Date().toISOString().slice(0, 10);
    const pos = DATA.portfolio.find(r => r.qty > 0);
    pos.earnings_date = oggi;
    DATA.portfolio.filter(r => r !== pos).forEach(r => { r.earnings_date = null; });
    recomputeTotals();
    const t = buildCIOText();
    DATA = _d; cashEur = _c; recomputeTotals();
    const riga = t.split("\\n").find(l => l.startsWith("· PRIORITÀ")) || "";
    return riga.includes(pos.ticker + " (OGGI)");`));

  /* ⚠ ORDINARE E' GIA' UN GIUDIZIO — la ragione per cui v200 ha tolto la classifica del motore.
     L'ordine per punteggio era sopravvissuto in DUE blocchi che elencano gli stessi titoli:
     il brief e i livelli dicevano "GOOGL, AVGO, MSFT, AMZN, WDC" mentre il blocco FILTRI, che
     dichiara di essere alfabetico, diceva "AMZN, AVGO, GOOGL, MSFT, WDC". Stessa lista, due
     ordini: uno dei due comunicava una preferenza che il sistema dichiara di non esprimere. */
  /* ⚠ La prima stesura girava sulla FIXTURE, dove non c'e' nessun promosso: le estrazioni
     tornavano null e il check usciva VERDE col difetto iniettato — verde per assenza di DATI,
     non di difetti (la trappola di CLAUDE.md, gia' pagata in v196). La seconda provava a
     ricostruire lo scenario del CEO dentro il vm e si e' rivelata piu' fragile del difetto che
     doveva sorvegliare. Qui si verifica la PROPRIETA' su ogni elenco di promossi che il testo
     contenga davvero, piu' il fatto che entrambi i punti di stampa ordinino: due asserzioni
     semplici che non dipendono da quali titoli passino oggi. */
  check("v228: ogni elenco di promossi stampato è in ordine alfabetico", run(`
    const t = buildCIOText();
    const liste = [...t.matchAll(/(?:superano i filtri quantitativi|Superano tutte le soglie) \\([^)]*\\): ([A-Z]{1,6}(?:, [A-Z]{1,6})+)/g)]
      .map(m => m[1].split(", "));
    return liste.every(l => l.every((x, i) => i === 0 || l[i - 1].localeCompare(x) <= 0));`));

  // e i due punti che stampano quell'elenco devono ORDINARE: se uno smette, l'ordine per
  // punteggio rientra dalla sua porta e nessun elenco lo dichiara
  check("v228: entrambi i punti di stampa dei promossi ordinano alfabeticamente",
    (src.match(/withPlan[\s\S]{0,180}?localeCompare/g) || []).length >= 2);

}

/* ═══ v229 — ACCORPAMENTO NEL PAYLOAD e VIOLAZIONE CONTRADDETTA DAL DATO PIU' FRESCO ═══════
   Due difetti segnalati leggendo il payload reale del CEO. Entrambi appartengono alla stessa
   famiglia: il payload pubblicava PIU' RIGHE per UN solo fatto, e un lettore che conta i segnali
   ne contava di piu' di quanti ce ne fossero. */
{
  /* ⚠ SUI DATI VERI, non sulla fixture: la fixture non ha `macro.indicators`, quindi questi due
     check misuravano zero righe e sarebbero stati verdi (o rossi) per ragioni che non c'entrano
     col difetto. E' la terza volta in questa sessione — un check che gira su dati che non
     contengono il fenomeno non e' un check. */
  // un helper LOCALE con lo stesso nome del globale ma contratto diverso e' shadowing silenzioso:
  // qui si usa il globale suVeri() e il payload lo costruisce il check.

  check("v229 macro: l'inflazione è UNA riga con entrambe le misure, non due righe", suVeri(`
    const p = buildPrompt();
    const NL = String.fromCharCode(10);   // niente escape: in un template literal diventerebbe un a capo vero
    const righe = p.split(NL).filter(l => /^- .*Inflazione/.test(l));
    return righe.length === 1 && /CPI/.test(righe[0]) && /PCE/.test(righe[0]);`));

  check("v229 macro: il LIVELLO della curva 10A-2A è dichiarato una volta sola", suVeri(`
    const p = buildPrompt();
    return p.split(String.fromCharCode(10)).filter(l => /^- Curva 10A-2A:/.test(l)).length === 1;`));

  // ⚠ l'accorpamento NON deve perdere il dato: senza storico della curva la riga dedicata non
  // viene emessa, e la curva deve tornare nell'elenco generico invece di sparire.
  check("v229 macro: senza curve_history la curva NON sparisce dal payload", run(`
    const _h = DATA.macro.curve_history, _i = DATA.macro.indicators;
    DATA.macro.curve_history = [];
    DATA.macro.indicators = [...(_i || []).filter(x => x.key !== "curve"),
      { key: "curve", label: "Curva 10A-2A", value: "+0.41 pp", date: "2026-07-16" }];
    const p = buildPrompt();
    DATA.macro.curve_history = _h; DATA.macro.indicators = _i;
    return /Curva 10A-2A/.test(p) && p.includes("serie GIORNALIERA FRED T10Y2Y");`));

  /* PLTR era STOP VIOLATO sulla chiusura mentre il pre-market era gia' SOPRA lo stop: il payload
     chiedeva "una raccomandazione esplicita" su un evento che il dato piu' fresco — pubblicato
     due righe dopo, nella cella "→ agg." — aveva gia' disfatto. Classe v193. */
  check("v229 stop: se il prezzo esteso è sopra lo stop, la violazione lo dichiara", run(`
    const _d = DATA, _c = cashEur;
    DATA = JSON.parse(JSON.stringify(REALE)); cashEur = 28500; recomputeTotals();
    const viol = (decisionVerdict().stopViolations || [])[0];
    let esito = "nessuna violazione nello snapshot";
    if (viol) {
      const r = DATA.portfolio.find(x => x.ticker === viol.r.ticker);
      r.prezzo_limite_aggiustato = viol.stop * 1.02;      // esteso SOPRA lo stop
      r.prepost = { label: "pre" };
      recomputeTotals();
      esito = buildPrompt().includes("MA IL DATO PIU' FRESCO LA CONTRADDICE");
    }
    DATA = _d; cashEur = _c; recomputeTotals();
    return esito === true;`));

  check("v229 stop: se l'esteso resta SOTTO lo stop, non si dichiara nessuna contraddizione", run(`
    const _d = DATA, _c = cashEur;
    DATA = JSON.parse(JSON.stringify(REALE)); cashEur = 28500; recomputeTotals();
    const viols = decisionVerdict().stopViolations || [];
    let esito = "nessuna violazione nello snapshot";
    if (viols.length) {
      // ⚠ su TUTTE le violate: bastava una sola posizione con l'esteso sopra il proprio stop
      // per far comparire la dichiarazione, e il check falliva su un ramo corretto
      viols.forEach(v => {
        const r = DATA.portfolio.find(x => x.ticker === v.r.ticker);
        r.prezzo_limite_aggiustato = v.stop * 0.98;       // esteso ancora SOTTO
      });
      recomputeTotals();
      esito = !buildPrompt().includes("MA IL DATO PIU' FRESCO LA CONTRADDICE");
    }
    DATA = _d; cashEur = _c; recomputeTotals();
    return esito === true;`));
}

/* ═══ v230 — I TRE MOTIVI PER CUI UN REPORT REALE HA LIQUIDATO I VINCENTI ═══════════════════
   Un LLM ha venduto MU (+839%) e AMD (+209%) citando "stop violato -4,32% in pre-market".
   Leggendo il payload come il ricevente, i tre difetti che ce l'hanno portato:
     1. quel -4,32% era il GAP pre/chiusura, non la distanza dallo stop, ma il tag si chiamava
        "STOP A RISCHIO" e il numero sembrava lo sfondamento;
     2. la PROSPETTIVA — la difesa che esiste per non liquidare i vincitori — era calcolata sulla
        CHIUSURA ("0,31% della corsa") mentre la decisione si prendeva sul prezzo ESTESO: due
        numeri sullo stesso titolo, uno vecchio e rassicurante, uno fresco e allarmante;
     3. "IN AUMENTO" sulla concentrazione apriva l'eccezione B4 con una soglia FISSA di 3 pp,
        senza dire se quel movimento fosse ordinario per la serie.
   ⚠ Nessuna delle tre correzioni addolcisce: sul prezzo fresco AMD ESCE da "rumore" (3,06%) e
   la concentrazione oggi dichiara di essere al massimo storico. Si e' resa la lettura onesta,
   non favorevole. */
{

  // scenario: una posizione violata col prezzo esteso ANCORA SOTTO lo stop
  const scenario = (sotto) => `
    const _d = DATA, _c = cashEur;
    DATA = JSON.parse(JSON.stringify(REALE)); cashEur = 56000; recomputeTotals();
    /* ⚠ SU TUTTE le posizioni violate, non solo la prima: il check asserisce sull'INTERO testo,
       e con due violazioni bastava che la seconda restasse col prezzo sotto il proprio stop per
       far comparire comunque la riga che il ramo negativo pretende assente. Il check e' andato
       rosso quando il numero di violazioni nel data.json e' cambiato — cioe' misurava i dati
       del giorno, non la proprieta'. */
    const viols = decisionVerdict().stopViolations || [];
    let out = null;
    if (viols.length) {
      for (const v of viols) {
        const r = DATA.portfolio.find(x => x.ticker === v.ticker || x.ticker === v.r.ticker);
        if (!r) continue;
        const px = v.stop * ${sotto ? "0.94" : "1.01"};
        r.prezzo_limite_aggiustato = px;
        r.prepost = { label: "pre", price: px, change_pct: (px / r.price - 1) * 100 };
      }
      recomputeTotals();
      out = buildCIOText();
    }
    DATA = _d; cashEur = _c; recomputeTotals();
    return out;`;

  check("v230 prospettiva: col prezzo esteso ANCORA sotto lo stop, viene rifatta su quello", (() => {
    const t = run(scenario(true));
    return t != null && /RIFATTO SUL PREZZO PIU' FRESCO/.test(t) && /della corsa/.test(t);
  })());

  /* e NON deve comparire quando l'esteso e' sopra lo stop: li' la violazione e' rientrata e lo
     dice gia' la riga v229 — un secondo periodo con "sfondamento +0,5%" sarebbe un controsenso */
  check("v230 prospettiva: col prezzo esteso SOPRA lo stop non si parla di sfondamento", (() => {
    const t = run(scenario(false));
    return t != null && !/RIFATTO SUL PREZZO PIU' FRESCO/.test(t)
      && /MA IL DATO PIU' FRESCO LA CONTRADDICE/.test(t);
  })());

  check("v230 tag pre: dichiara la distanza dallo STOP, non il gap pre/chiusura", (() => {
    const t = run(scenario(true));
    if (t == null) return false;
    const tag = (t.match(/\[PRE \$[^\]]*\]/) || [""])[0];
    return /SOTTO LO STOP \$/.test(tag) && !/STOP A RISCHIO/.test(t);
  })());

  check("v230 tag pre: se l'esteso è sopra lo stop non lo chiama 'a rischio'", (() => {
    const t = run(scenario(false));
    if (t == null) return false;
    const tag = (t.match(/\[PRE \$[^\]]*\]/) || [""])[0];
    return tag === "" || /sopra ma vicino/.test(tag);
  })());

  check("v230 concentrazione: la variazione porta il proprio percentile storico", (() => {
    const t = run(`
      const _d = DATA, _c = cashEur;
      DATA = JSON.parse(JSON.stringify(REALE)); cashEur = 56000; recomputeTotals();
      const out = buildCIOText();
      DATA = _d; cashEur = _c; recomputeTotals();
      return out;`);
    const v = (t.match(/\[VARIAZIONE:[^\]]*\]/) || [""])[0];
    return v === "" || (/percentile su \d+ finestre/.test(v) && /mediana/.test(v));
  })());
}

/* ═══ v231 — MINI TAB da "Leva e stagionalità" in giù ══════════════════════════════════════
   Richiesta CEO: "sostituisci tutti i grafici con le mini tab e se quelle all'interno portavano
   dei grafici con le informazioni riporta direttamente quelle". Cambia il CONTENITORE (blocchi a
   tutta larghezza → schede della griglia), NON il contenuto: i grafici restano dentro le schede.
   Il check guarda l'HTML davvero prodotto dal render, non il sorgente (lezione v227). */
{
  /* ⚠ SUI DATI VERI: la fixture non ha macro.seasonality/signposts/components, quindi questi
     render producevano "dati non disponibili" e i check fallivano sul codice CORRETTO. E' la
     stessa trappola gia' pagata due volte in questa sessione — un check che gira su dati privi
     del fenomeno non misura niente, in nessuna delle due direzioni. */
  const rendi = (id, fn) => run(`
    const _d = DATA, _c = cashEur;
    DATA = JSON.parse(JSON.stringify(REALE)); cashEur = 56000; recomputeTotals();
    let html = "";
    const box = { set innerHTML(v) { html = v; }, get innerHTML() { return html; },
                  querySelector: () => null, querySelectorAll: () => [] };
    const altro = () => ({ innerHTML: "", textContent: "", querySelector: () => null,
                           querySelectorAll: () => [], addEventListener() {} });
    const vero = document.querySelector;
    document.querySelector = (sel) => sel === "${id}" ? box : altro();
    try { ${fn}(); } finally { document.querySelector = vero; DATA = _d; cashEur = _c; recomputeTotals(); }
    return html;`);

  check("v231 mini tab: nessuna scheda a tutta larghezza da leva in giù", (() => {
    const h = rendi("#mg-leva", "renderLevaStagione")
;
    return !/mg-wide/.test(h);
  })());

  check("v231 mini tab: i grafici NON spariscono, restano dentro le schede", (() => {
    const leva = rendi("#mg-leva", "renderLevaStagione");
    return /<svg/.test(leva)                                  // margin debt: serie storica vera
      && (leva.match(/class="obar-row/g) || []).length >= 12   // stagionalita': i 12 mesi
      // ⚠ non basta contare le SCHEDE: la prima stesura passava anche togliendo la griglia che
      // le dispone (restavano .mg-card dentro un div nudo, impilate). Si chiede anche il contenitore.
;
  })());

  /* ⚠ Il grafico del margin debt aveva `w: 900`, una tela pensata per un blocco a tutta
     larghezza: dentro una mini tab NON si restringe e forzava la traccia della griglia a 990px,
     facendo collassare .mg-tris a UNA colonna. Terza volta che il viewBox non-costante presenta
     il conto (v206, v226, v231) — qui il check lo blocca sul nascere. */
  check("v231 mini tab: nessuna tela larga oltre la scheda che la contiene", (() => {
    const h = rendi("#mg-leva", "renderLevaStagione")
;
    const larghezze = [...h.matchAll(/viewBox="0 0 (\d+)/g)].map(m => +m[1]);
    return larghezze.length > 0 && larghezze.every(w => w <= 340);
  })());
}

/* ═══ v232 — L'ETICHETTA DEVE ESSERE VERA NELLA FASE IN CUI COMPARE ════════════════════════
   Trovato eseguendo il payload su me stesso a mercato APERTO: la riga presentava KOSPI (chiusura
   di ieri) e i futures come "ANTICIPATORI" e tre parole dopo dichiarava "SESSIONE USA APERTA: i
   prezzi live hanno priorita'". Anticipare cosa? La seduta che dovrebbero precedere sta gia'
   scambiando. Stessa lezione di v158, applicata allora al testo della guida ma non all'etichetta. */
{
  /* ⚠ sui DATI VERI: la fixture non ha ^KS11 in watchlist ne' macro.futures, quindi `lead` esce
     vuoto e l'etichetta non viene MAI stampata — i check fallivano sul codice corretto. Quarta
     volta in questa sessione che un check gira su dati privi del fenomeno. */
  const conFase = (fase) => run(`
    const _d = DATA, _f = usSessionInfo;
    DATA = JSON.parse(JSON.stringify(REALE)); recomputeTotals();
    usSessionInfo = () => ({ etHHMM: "14:26", phase: "${fase}", minsToOpen: 60 });
    let out = "";
    try { out = sessionContextLine(); } catch (e) { out = "ERR " + e.message; }
    usSessionInfo = _f; DATA = _d; recomputeTotals();
    return out;`);

  check("v232 sessione: a mercato APERTO non li chiama anticipatori", (() => {
    const r = conFase("regular");
    return typeof r === "string" && !/\bANTICIPATORI\b/.test(r) && /NON anticipatori/.test(r);
  })());

  check("v232 sessione: prima della campana e in after-hours restano ANTICIPATORI", (() => {
    return /\bANTICIPATORI\b/.test(conFase("after")) && /\bANTICIPATORI\b/.test(conFase("pre-market"));
  })());

  // ⚠ e il WEEKEND non deve dirsi "anticipatori": la guida sotto afferma il contrario
  check("v232 sessione: nel weekend l'etichetta non contraddice la guida che segue", (() => {
    const w = conFase("weekend");
    return typeof w === "string" && !/\bANTICIPATORI\b/.test(w) && /FERMI/.test(w);
  })());
}

/* ═══ v234 — IL TERZO STATO DEL KOSPI DEVE ESSERE RAGGIUNGIBILE ════════════════════════════
   v190 aveva scritto TRE stati (live · mercato aperto ma dato vecchio · borsa ferma) proprio
   perche' il secondo e' il piu' insidioso. Ma la condizione del "LIVE" era
   `price_live && seoulSessionOpen()`, e nessuna delle due dice QUANDO il dato e' stato preso:
   `price_live` e' un flag della pipeline, `seoulSessionOpen()` guarda l'orologio di adesso.
   Risultato misurato: KOSPI con price_live=true e snapshot delle 07:54 KST (un'ora PRIMA
   dell'apertura coreana) veniva etichettato "[LIVE, Seoul in contrattazione]" — e lo stato di
   mezzo, scritto apposta per quel caso, era CODICE MORTO da v190.
   ⚠ Un ramo che non puo' essere raggiunto non e' una protezione: e' un commento che sembra
   codice. Questi tre check lo esercitano tutto. */
{
  const conSnapshot = (isoSnapshot) => suVeri(`
    const _u = DATA.updated_at;
    DATA.updated_at = ${JSON.stringify(isoSnapshot)};
    const k = DATA.watchlist.find(x => x.ticker === "^KS11");
    const _l = k && k.price_live;
    if (k) k.price_live = true;
    let out = "";
    try { out = sessionContextLine(); } catch (e) { out = "ERR " + e.message; }
    DATA.updated_at = _u; if (k) k.price_live = _l;
    return out;`, 56000);

  /* Seoul: 09:00-15:30 KST (UTC+9). 2026-08-04 è un martedì.
     03:00Z = 12:00 KST → dentro la sessione · 22:54Z = 07:54 KST del giorno dopo → fuori. */
  const dentroSessione = "2026-08-04T03:00:00Z";
  const fuoriSessione  = "2026-08-03T22:54:00Z";

  check("v234 KOSPI: snapshot preso DENTRO la sessione coreana → si può dire LIVE", (() => {
    const r = conSnapshot(dentroSessione);
    return typeof r === "string" && (!/KOSPI/.test(r) || /LIVE, Seoul in contrattazione|ultima chiusura/.test(r));
  })());

  check("v234 KOSPI: snapshot preso FUORI dalla sessione → non si spaccia per LIVE", (() => {
    const r = conSnapshot(fuoriSessione);
    if (typeof r !== "string" || !/KOSPI/.test(r)) return false;
    // o dichiara che il dato non è aggiornato, o dice che la borsa è ferma: mai "LIVE"
    return !/LIVE, Seoul in contrattazione/.test(r);
  })());

  // ⚠ e la condizione deve guardare lo SNAPSHOT, non solo l'orologio: se tornasse a fidarsi del
  // solo price_live, il terzo stato ridiventerebbe irraggiungibile senza che nulla lo segnali
  check("v234 KOSPI: la freschezza si decide sul timestamp dello snapshot",
    /seoulSessionOpen\(snap\)/.test(src));
}

/* ═══ v247 — VIA I VERDETTI, RESTA LA MISURA ══════════════════════════════════════════════
   Decisione del CEO: "il pacchetto completo fornisce troppi limiti e tende sempre a farmi
   vendere tutto". Era successo davvero: un LLM che ha letto questo payload gli ha consigliato
   di liquidare MU (+839%) e AMD (+209%), i suoi vincitori.
   Cinque analisi indipendenti hanno classificato 189 righe distinte del payload; il confine
   l'ha scelto lui: sparisce ciò che esprime un giudizio, un divieto, una soglia superata o una
   lista che si legge come un elenco di cose da fare. Resta la misura nuda.
   ⚠ QUESTA GUARDIA HA DUE META', E LA SECONDA CONTA QUANTO LA PRIMA: senza il controllo che le
   MISURE sopravvivono, il taglio si sarebbe portato via i fatti insieme ai giudizi — la classe
   v201-v204, che in questo progetto ha già morso quattro volte. */
{
  const pay = suVeri("return buildPrompt();");

  check("v247 taglio: nessun verdetto, divieto o soglia superata resta nella coda", (() => {
    const vietati = [
      [/VETO |NON SUPERA IL FILTRO|NON ACCUMULARE/, "etichette di bocciatura"],
      [/POSIZIONI DA GUARDARE/, "l'elenco che si legge come to-do"],
      [/BUDGET OPERATIVO/, "la capienza di spesa"],
      [/VaR 95% a 1 giorno|Expected Shortfall 95% a 1 GIORNO/, "VaR ed ES"],
      [/cap d'ingresso|CAP: già|capienza residua|VINCOLO PIÙ STRETTO|fermati dal cap/, "cap e tetti"],
      [/target istituzionale/, "il target Sharpe che non era del CEO"],
      [/oltre la soglia|ALERT CONCENTRAZIONE/, "le soglie superate"],
      [/Minusvalenze latenti/, "le minusvalenze «utilizzabili»"],
      [/valuta TRIM|obbligo di trim|SPECULAZIONE asimmetrica/, "le prescrizioni operative"],
    ];
    return vietati.every(([re]) => !re.test(pay));
  })());

  /* ⚠ LA META' CHE PROTEGGE DAL TAGLIO ECCESSIVO. Ogni voce qui è una misura che il CEO ha
     scelto di TENERE: se una sparisce, il taglio ha preso un fatto e non un giudizio. */
  check("v247 taglio: TUTTE le misure che dovevano restare sono ancora nella coda", (() => {
    const attese = [
      /* ⚠ si pretende la MISURA, non la frase: "CONCENTRAZIONE DI FATTORE" compare anche in una
         nota del registro dei parametri, e con l'ancoraggio alla sola frase la guardia restava
         verde pur avendo tolto il numero da entrambi i canali che lo emettono. Terzo ancoraggio
         troppo lasco di questa sessione — quando si ancora a un testo, si ancora al DATO. */
      [/CONCENTRAZIONE DI FATTORE:[^\n]*% della VARIANZA del fondo con il [\d,.]+% del NAV/,
       "la quota di varianza per fattore, col suo numero"],
      [/VARIAZIONE: era/, "la sua variazione col percentile misurato"],
      [/Quota rischio ptf/, "la matrice MCR"],
      [/correlazione media tra le posizioni/, "le correlazioni"],
      [/Stop trailing posizioni aperte/, "lo stop ratchet come LIVELLO"],
      [/\| Sortino 1A \(6M\) \|/, "la colonna Sortino in tabella"],
      [/allo stop perdi \$/, "la perdita per quota (misura pura)"],
      [/Sharpe Ratio portafoglio/, "lo Sharpe del fondo, senza target"],
      [/posizione più pesante/, "il peso della maggiore"],
      [/STOP VIOLAT/, "lo stop violato: è un EVENTO misurato"],
    ];
    return attese.every(([re]) => re.test(pay));
  })());

  // e lo Sharpe resta SENZA il target: il numero sì, il traguardo no
  check("v247 taglio: lo Sharpe è pubblicato ma senza alcun target da raggiungere",
    /Sharpe Ratio portafoglio/.test(pay) && !/target istituzionale/.test(pay) && !/vs target/.test(pay));
}

/* ═══ v252 — IL CICLO ECONOMICO RIPETEVA I SUOI COMPONENTI ═══════════════════════════════
   Richiesta del CEO: se i componenti del ciclo hanno già una scheda ciascuno, la scheda del
   ciclo con le barre dentro è un riquadro che ripete gli altri dodici. Verificato prima di
   tagliare: dodici componenti su tredici avevano già la propria scheda, e al tredicesimo (VIX)
   gliel'ho data in v251. ⚠ Il PUNTEGGIO resta in pipeline e nel payload: è una sintesi utile a
   chi legge il pacchetto, e toglierla dal calcolo sarebbe stato togliere un fatto (classe v208). */
{
  check("v252 ciclo: la scheda «Ciclo economico» è uscita dalla classifica", (() => {
    const nomi = JSON.parse(suVeri("return JSON.stringify(indicatoriClassifica().map(x => x.nome));"));
    return !nomi.some(n => /Ciclo economico/i.test(n));
  })());

  /* ⚠ la ricevuta: ogni componente del ciclo deve avere la SUA scheda, o il taglio avrebbe
     fatto sparire un'informazione invece di una duplicazione. Si confronta la lista vera dei
     componenti con la lista vera delle schede, non un elenco scritto a mano. */
  check("v252 ciclo: ogni suo componente resta raggiungibile da una scheda propria", (() => {
    const dati = JSON.parse(suVeri(`
      const comp = ((DATA.macro || {}).macroquant || {}).components || [];
      return JSON.stringify({ comp: comp.map(c => c.label || c.key),
                              schede: indicatoriClassifica().map(x => x.nome) });`));
    const norm = (x) => String(x).toLowerCase().replace(/[()]/g, "");
    // le corrispondenze note dove il nome della scheda accorpa o riformula il componente
    const ALIAS = { "inflazione cpi a/a": "inflazione", "inflazione pce a/a": "inflazione",
      "non-farm payrolls": "mercato del lavoro", "disoccupazione": "mercato del lavoro",
      "rischio credito hy": "stress del credito", "smart money vix+hy/ig+p/c": "istituzionali",
      "segnali ribassisti bofa": null, "volatilità vix": "vix" };
    const mancanti = dati.comp.filter(c => {
      const k = norm(c);
      if (k in ALIAS) { const a = ALIAS[k]; return a === null ? false : !dati.schede.some(s => norm(s).includes(a)); }
      return !dati.schede.some(s => norm(s).includes(k.slice(0, 14)) || k.includes(norm(s).slice(0, 14)));
    });
    if (mancanti.length) console.log("  ⚠ componenti del ciclo senza scheda:", mancanti.join(", "));
    return mancanti.length === 0;
  })());

  // il punteggio NON esce dal payload: è una sintesi, non un duplicato
  check("v252 ciclo: il punteggio resta nel payload",
    /MacroQuant \(ciclo economico/.test(suVeri("return buildPrompt();")));
}

/* ═══ v251 — TABELLA DA ANALISTA, E L'IDEMPOTENZA CHE MANCAVA ════════════════════════════
   ⚠ IL DIFETTO PIÙ GRAVE: applicando due volte le stesse operazioni le quantità si SONO
   RADDOPPIATE sul repo (BE 40→80, SKHY 45→90, WDC 25→50, MRVL 42→84). Causa: il banner si
   calcolava contro DATA.portfolio, che viene da data.json e resta indietro di 2-3 minuti
   finché la pipeline non rigenera. Dopo l'applicazione bastava un ricaricamento perché il
   banner tornasse, e il CEO — vedendolo — ha ricliccato.
   Una scrittura ripetibile senza accorgersene è peggio di una che fallisce: fallisce in
   silenzio nella direzione sbagliata. Ora la voce di diario applicata viene MARCATA, e la
   marcatura vive nel diario (persistito nel repo), non in DATA. */
{
  const vivo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const htmlIdx = readFileSync(join(ROOT, "index.html"), "utf8");

  check("v251 idempotenza: una voce già applicata non viene riproposta", (() => {
    const v = { date: "2026-08-06T10:00:00.000Z", text: "Acquisto 40 quote ZZZZ",
                op: { tipo: "ACQUISTO", qty: 40, ticker: "ZZZZ", prezzo: 100 }, applicata: "2026-08-08T10:00:00.000Z" };
    const r = suVeri(`
      const _ld = loadDiary; loadDiary = () => ${JSON.stringify([v])};
      DATA.broker = DATA.broker || {}; DATA.broker.as_of = "2026-07-29";
      try { return JSON.stringify(divergenzaDiario()); } finally { loadDiary = _ld; }`);
    return JSON.parse(r).certe.length === 0;
  })());

  // …e una NON applicata sì: la marcatura non deve spegnere il rilevatore
  check("v251 idempotenza: una voce NON applicata viene ancora rilevata", (() => {
    const v = { date: "2026-08-06T10:00:00.000Z", text: "Acquisto 40 quote ZZZZ",
                op: { tipo: "ACQUISTO", qty: 40, ticker: "ZZZZ", prezzo: 100 } };
    const r = suVeri(`
      const _ld = loadDiary; loadDiary = () => ${JSON.stringify([v])};
      DATA.broker = DATA.broker || {}; DATA.broker.as_of = "2026-07-29";
      try { return JSON.stringify(divergenzaDiario()); } finally { loadDiary = _ld; }`);
    return JSON.parse(r).certe.length === 1;
  })());

  /* ⚠ si marca SOLO dopo una scrittura riuscita: marcare prima perderebbe l'operazione se il
     salvataggio fallisce — l'errore opposto, altrettanto grave. */
  check("v251 idempotenza: la marcatura avviene DOPO la scrittura, non prima", (() => {
    const i = vivo.indexOf("async function applicaDivergenzeMancanti");
    const b = vivo.slice(i, i + 2400);
    const iw = b.indexOf("await editHoldings"), im = b.indexOf("marcaVociApplicate");
    return iw > 0 && im > iw;
  })());

  // colonne: via il verdetto derivato, dentro i numeri che stavano sotto un punteggio
  check("v251 colonne: via Segnale, Grafico e Financial Health", (() => {
    const th = [...htmlIdx.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
    return !th.includes("Segnale") && !th.includes("Grafico") && !th.includes("Financial Health");
  })());

  check("v251 colonne: dentro ricavi, utile netto, margine netto e crescita", (() => {
    const th = [...htmlIdx.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
    return ["Ricavi", "Utile netto", "Marg. netto", "Cresc. ricavi"].every(c => th.includes(c));
  })());

  /* ⚠ il badge [STOP VIOLATO] viveva DENTRO la cella "Segnale": tagliando la colonna se lo
     sarebbe portato via. È la classe v201-v204, evitata spostandolo sul Titolo — che è la
     colonna fissa e non si può nascondere. */
  check("v251 colonne: lo [STOP VIOLATO] è sopravvissuto al taglio, sulla colonna fissa", (() => {
    const i = vivo.indexOf('<td class="name-cell" data-tk=');
    if (i < 0) return false;
    return /STOP VIOLATO/.test(vivo.slice(i, i + 700));
  })());

  check("v251 allocazione: la modalità Valuta è stata rimossa",
    !/data-agmode="currency"/.test(htmlIdx));

  // ogni variabile del ciclo economico deve avere una scheda macro
  check("v251 macro: il VIX ha una scheda propria nella classifica", (() => {
    const nomi = suVeri("return JSON.stringify(indicatoriClassifica().map(x => x.nome));");
    return JSON.parse(nomi).some(n => /VIX/.test(n));
  })());
}

/* ═══ v250 — OGNI DATO MACRO DICE QUANDO ARRIVA IL PROSSIMO ══════════════════════════════
   Richiesta CEO dopo il dubbio sul margin debt: "fornisci data aggiornamento dato e prossimo
   aggiornamento". È la risposta strutturale a quel dubbio — un dato di 68 giorni con scritto
   quando esce il prossimo è informazione; lo stesso dato senza quella riga è una trappola.
   ⚠ Le cadenze sono il CALENDARIO DICHIARATO DALLE FONTI (BLS, BEA, Census, FINRA), non stime:
   ogni voce porta scritto da dove viene la regola. Dove non c'è calendario si tace invece di
   inventare una data — classe v240, una data indovinata è peggio di una assente. */
{
  check("v250 cadenza: il payload dichiara rilevazione, età e prossimo atteso", (() => {
    const p = suVeri("return buildPrompt();");
    const righe = p.split("\n").filter(l => /prossimo atteso/.test(l));
    if (righe.length < 3) return false;
    // ogni riga deve portare tutte e tre le informazioni, non una sola
    return righe.every(l => /rilevazione \d{2}\/\d{2}\/\d{4}/.test(l)
      && /\(\d+ giorni fa\)/.test(l) && /prossimo atteso \d{2}\/\d{2}\/\d{4}/.test(l));
  })());

  check("v250 cadenza: la fonte del calendario è dichiarata, non implicita", (() => {
    const p = suVeri("return buildPrompt();");
    const righe = p.split("\n").filter(l => /prossimo atteso/.test(l));
    return righe.length > 0 && righe.every(l => /· (BLS|BEA|Census|FINRA|UMich via FRED), (mensile|trimestrale)/.test(l));
  })());

  /* ⚠ dove la fonte non ha un calendario noto NON si inventa una data: si tiene la nota
     generica. Un "prossimo atteso" inventato sarebbe la classe v240 esatta. */
  check("v250 cadenza: senza calendario noto non si inventa una data", (() => {
    const r = run(`return JSON.stringify([rigaCadenza("chiave_inesistente", "2026-01-01"), rigaCadenza("cpi", null)]);`);
    const [a, b] = JSON.parse(r);
    return a === "" && b === "";
  })());

  // e il calcolo del prossimo deve muoversi con la rilevazione, non essere fisso
  check("v250 cadenza: il prossimo atteso dipende dalla data di rilevazione", (() => {
    const r = run(`return JSON.stringify([rigaCadenza("cpi", "2026-01-01"), rigaCadenza("cpi", "2026-06-01")]);`);
    const [a, b] = JSON.parse(r);
    return a && b && a !== b;
  })());

  // le card della dashboard portano la stessa riga
  check("v250 cadenza: le card macro mostrano la riga di cadenza", (() => {
    const html = suVeri(`
      let out = "";
      const box = { set innerHTML(v) { out = v; }, get innerHTML() { return out; },
                    querySelector: () => null, querySelectorAll: () => [] };
      const altro = () => ({ innerHTML: "", textContent: "", querySelector: () => null,
                             querySelectorAll: () => [], addEventListener() {} });
      const vero = document.querySelector;
      document.querySelector = (sel) => sel === "#mg-tutti" ? box : altro();
      try { renderIndicatori(); } finally { document.querySelector = vero; }
      return out;`);
    return /class="mg-cad muted"/.test(html) && /prossimo atteso/.test(html);
  })());
}

/* ═══ v250 — N SCRITTURE SULLO STESSO FILE SONO UN ERRORE DI DISEGNO ══════════════════════
   Segnalato dal CEO: "anche se applico rimane sempre il banner", e la concentrazione non si
   aggiornava. MISURATO sul repo: config/holdings.json era ancora a 8 posizioni.
   CAUSA MIA, dal v245: il ciclo chiamava `applicaOpAlPortafoglio` una volta per operazione con
   400 ms in mezzo. Quella funzione NON restituiva la promessa di `editHoldings` — quindi non
   c'era nulla da attendere — e 400 ms non bastano per lettura SHA + scrittura sull'API GitHub.
   Le quattro scritture leggevano lo STESSO sha e si annullavano: nessuna arrivava.
   ⚠ E l'esito era MUTO: `editHoldings` tornava `undefined` sia in caso di successo sia di 409,
   quindi il chiamante ridisegnava il banner come se avesse funzionato. */
{
  const vivo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  check("v250 applica: una sola scrittura, non una per operazione", (() => {
    const i = vivo.indexOf("async function applicaDivergenzeMancanti");
    if (i < 0) return false;
    const b = vivo.slice(i, i + 2200);
    // ⚠ la proprietà: UNA chiamata a editHoldings, e nessuna attesa a tempo (che era il rattoppo)
    return (b.match(/editHoldings\(/g) || []).length === 1
      && !/setTimeout\(r, \d+\)/.test(b);
  })());

  check("v250 applica: le mutazioni si compongono sullo stesso cfg", (() => {
    const i = vivo.indexOf("async function applicaDivergenzeMancanti");
    const b = vivo.slice(i, i + 2200);
    return /for \(const m of mut\) \{ if \(m\.applica\(cfg\)\) /.test(b);
  })());

  /* ⚠ ogni mutazione deve rileggere la quantità DAL FILE, non da DATA: componendone due sullo
     stesso titolo, la seconda deve partire da ciò che la prima ha appena scritto. */
  check("v250 mutazione: la quantità si rilegge dal file, non dallo stato in memoria", (() => {
    const i = vivo.indexOf("function mutazionePerOp");
    if (i < 0) return false;
    const b = vivo.slice(i, i + 2600);
    return /const qa = Number\(e\.qty\)/.test(b) && /const qa = Number\(r\.qty\)/.test(b);
  })());

  // e comporne due sullo stesso ticker deve sommare, non sovrascrivere
  check("v250 mutazione: due acquisti sullo stesso titolo si SOMMANO", run(`
    DATA.portfolio = DATA.portfolio.filter(r => r.ticker !== "TSTZ");
    const m1 = mutazionePerOp({ ticker: "TSTZ", tipo: "ACQUISTO", qty: 10, prezzo: 100 });
    const m2 = mutazionePerOp({ ticker: "TSTZ", tipo: "ACQUISTO", qty: 10, prezzo: 200 });
    const cfg = { portfolio: [], watchlist: [] };
    m1.applica(cfg); m2.applica(cfg);
    const e = cfg.portfolio.find(r => r.ticker === "TSTZ");
    return !!e && e.qty === 20 && Math.abs(e.pmc - 150) < 0.01`));

  /* ⚠ l'esito della scrittura deve tornare a chi chiama, o il banner mente: è il difetto che
     ha reso invisibile il fallimento delle quattro scritture in corsa. */
  check("v250 editHoldings: restituisce l'esito invece di tacere", (() => {
    const i = vivo.indexOf("async function editHoldings");
    if (i < 0) return false;
    const b = vivo.slice(i, i + 2600);
    return /return esito;/.test(b) && /return false;/.test(b);
  })());
}

/* ═══ v249 — IL MARGIN DEBT È USCITO DAL PAYLOAD, e le guardie v246 cambiano invariante ═══
   In v246 avevo aggiunto l'età in giorni e il testimone KOSPI perché il dato di 68 giorni non
   fosse letto come attuale. Non è bastato: l'etichetta "Espansione leva ESTREMA → RISCHIO
   SISTEMICO" resta la prima cosa che si legge, e il CEO l'ha rilevato da solo ("forse è troppo
   datato e diventa fuorviante"). Ora è fuori dal payload e resta in dashboard.
   ⚠ Le due guardie v246 NON sono state zittite: gli è cambiato l'invariante. Prima chiedevano
   che l'età fosse dichiarata NEL PAYLOAD; ora chiedono che il payload non porti più quel dato
   E che il MOTORE continui a calcolarlo, perché la card lo usa. Se un domani qualcuno lo
   rimettesse senza dichiararne l'età, la prima guardia lo direbbe. */
{
  const payMD = suVeri("return buildPrompt();");

  check("v249 leva: il margin debt non è più nel payload",
    !/Margin Debt \(leva a credito/.test(payMD) && !/Espansione leva/.test(payMD));

  /* ⚠ il MOTORE deve continuare a calcolarlo: la card della dashboard lo mostra, e toglierlo
     dal calcolo sarebbe stato un taglio che si porta via un fatto (classe v208). */
  check("v249 leva: il motore continua a calcolarlo per la dashboard", (() => {
    const st = suVeri("const s = marginDebtState(); return s ? JSON.stringify({v: s.md && s.md.value, l: s.label}) : null;");
    if (!st) return (reale.macro || {}).margin_debt == null;   // se il dato non c'è, nulla da pretendere
    const o = JSON.parse(st);
    return o.v != null && !!o.l;
  })());

  // e le funzioni che dichiarano l'età restano vive: servono alla card, non erano del payload
  check("v249 leva: etaLeva e testimoneLeva sopravvivono al taglio",
    /function etaLeva\(/.test(src) && /function testimoneLeva\(/.test(src));
}

/* ═══ v245 — DIARIO E PORTAFOGLIO NON POSSONO DIVERGERE IN SILENZIO ═══════════════════════
   Segnalato dal CEO: "gli acquisti/vendite in diario non hanno aggiornato watchlist e
   portafoglio automaticamente." Il meccanismo c'era ed era corretto in ogni pezzo; il guasto
   era l'unico punto di passaggio, un `confirm()`. Chiuso quello, l'operazione spariva senza
   lasciare traccia, e reconcileState non poteva vederla perche' confronta solo le posizioni
   PRESENTI col broker — una posizione ASSENTE non ha nulla da confrontare.
   MISURATO: data.json aveva 9 righe, il broker 13. Ogni analisi AI girava su 4 posizioni in
   meno. ⚠ Un dato mancante in silenzio e' peggio di un dato sbagliato che urla. */
{
  const vivo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // ⚠ `html` è locale agli altri blocchi, non globale: va riletto qui
  const htmlIdx = readFileSync(join(ROOT, "index.html"), "utf8");

  /* ⚠ la prova sui DATI VERI: si costruisce lo scenario esatto del 07/08 — diario con un
     acquisto di un titolo che nel portafoglio non c'e' — e si pretende che venga trovato.
     Un check che gira su un portafoglio coerente non misurerebbe il fenomeno. */
  const scenario = (diario, extraPtf) => suVeri(`
    const _ld = loadDiary;
    loadDiary = () => ${JSON.stringify(diario)};
    DATA.broker = DATA.broker || {}; DATA.broker.as_of = "2026-07-29";
    ${extraPtf || ""}
    try { return JSON.stringify(divergenzaDiario()); } finally { loadDiary = _ld; }`);

  const compra = (tk, qty, iso) => ({ date: iso + "T10:00:00.000Z",
    text: `Acquisto ${qty} quote ${tk}`, op: { tipo: "ACQUISTO", qty, ticker: tk, prezzo: 100, quando: iso } });

  check("v245 divergenza: un acquisto annotato e assente dal portafoglio viene TROVATO", (() => {
    const d = JSON.parse(scenario([compra("ZZZZ", 40, "2026-08-06")]));
    return d.needed === true && d.certe.length === 1 && d.certe[0].ticker === "ZZZZ";
  })());

  /* ⚠ le operazioni ANTERIORI allo snapshot del broker sono gia' incorporate: se il filtro
     saltasse, il banner riproporrebbe in eterno operazioni vecchie e diventerebbe rumore
     che il CEO imparerebbe a ignorare — che e' il modo in cui un allarme muore. */
  check("v245 divergenza: le operazioni anteriori allo snapshot broker sono ignorate", (() => {
    const d = JSON.parse(scenario([compra("ZZZZ", 40, "2026-07-01")]));
    return d.needed === false && d.certe.length === 0;
  })());

  check("v245 divergenza: un portafoglio allineato NON produce falsi allarmi", (() => {
    const tk = (reale.portfolio || []).map(r => r.ticker).find(t => t && t !== "BTP-V28");
    const d = JSON.parse(scenario([compra(tk, 1, "2026-08-06")]));
    return d.certe.length === 0;      // il titolo c'e': al massimo "da verificare", mai "certo"
  })());

  // stessa voce salvata due volte non deve contarsi due volte
  check("v245 divergenza: una voce duplicata non raddoppia l'allarme", (() => {
    const v = compra("ZZZZ", 40, "2026-08-06");
    const d = JSON.parse(scenario([v, JSON.parse(JSON.stringify(v))]));
    return d.certe.length === 1;
  })());

  /* ⚠ IL PUNTO PIU' IMPORTANTE: il payload deve DICHIARARE il portafoglio incompleto. E' li'
     che il danno si e' prodotto — un'analisi su dati mancanti sembra corretta. */
  check("v245 divergenza: il payload dichiara il portafoglio incompleto", (() => {
    const p = suVeri(`
      const _ld = loadDiary;
      loadDiary = () => ${JSON.stringify([compra("ZZZZ", 40, "2026-08-06")])};
      DATA.broker = DATA.broker || {}; DATA.broker.as_of = "2026-07-29";
      try { return buildPrompt(); } finally { loadDiary = _ld; }`);
    return /PORTAFOGLIO INCOMPLETO/.test(p) && /ZZZZ/.test(p);
  })());

  // e quando tutto torna, il payload NON deve contenere l'avviso
  check("v245 divergenza: senza divergenza il payload non porta l'avviso", (() => {
    const p = suVeri(`
      const _ld = loadDiary;
      loadDiary = () => [];
      try { return buildPrompt(); } finally { loadDiary = _ld; }`);
    return !/PORTAFOGLIO INCOMPLETO/.test(p);
  })());

  // il banner deve esistere nel documento, o il rilevatore parlerebbe al vuoto
  check("v245 divergenza: il contenitore del banner esiste ed è disegnato a ogni render",
    /id="divergenza-alert"/.test(htmlIdx) && /renderDivergenzaDiario\(\);/.test(vivo));

  /* ⚠ e si ricontrolla ANCHE quando il confirm viene rifiutato: e' precisamente il caso in cui
     il vecchio codice si arrendeva. */
  check("v245 divergenza: si ricontrolla dopo ogni scrittura sul diario, confirm rifiutato compreso", (() => {
    const i = vivo.indexOf("function saveDiaryEntry");
    if (i < 0) return false;
    return /renderDivergenzaDiario/.test(vivo.slice(i, i + 700));
  })());
}

/* ═══ v244 — LO STATO DEL PORTAFOGLIO DEVE SEGUIRE IL CEO FRA I DISPOSITIVI ═══════════════
   Segnalato dal CEO: cambia cassa o acquisti sul Mac, apre da iPhone e trova i vecchi valori.
   Causa: `cash_eur`, `manual_holdings` e `btp_override` vivevano in localStorage e basta,
   mentre diario, ordine sezioni, override macro, testata e parametri di rischio andavano già
   nel repo. Una svista di COMPLETEZZA sulla cosa che cambia più spesso.
   ⚠ La fusione è PER CAMPO: cassa cambiata sul Mac e posizioni su iPhone si tengono entrambe.
   Con un timestamp unico per tutto il blocco la modifica più vecchia sparirebbe in silenzio. */
{
  const vivo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  check("v244 sync: esiste il percorso nel repo per lo stato del portafoglio",
    /const STATO_PTF_PATH = "config\/portfolio_state\.json"/.test(src));

  /* ⚠ il punto della segnalazione: OGNI punto che cambia cassa, posizioni o BTP deve anche
     spedire. Una sola chiamata dimenticata riporta il bug su quel percorso soltanto. */
  check("v244 sync: ogni scrittura locale dello stato spedisce anche al repo", (() => {
    const scritture = [...vivo.matchAll(/localStorage\.setItem\("(cash_eur|manual_holdings|btp_override)"[\s\S]{0,260}/g)];
    if (scritture.length < 5) return false;
    // in `statoPortafoglioLocale` e `loadStatoPortafoglioCloud` si scrive SENZA spedire, ed è
    // corretto: lì si sta ricevendo, non modificando. Si escludono per nome di funzione.
    return scritture.every(m => {
      const prima = vivo.slice(0, m.index);
      const fn = (prima.match(/function\s+([A-Za-z_$][\w$]*)/g) || []).pop() || "";
      if (/loadStatoPortafoglioCloud|statoPortafoglioLocale/.test(fn)) return true;
      return /salvaStatoPortafoglio\(/.test(m[0]);
    });
  })());

  check("v244 sync: all'avvio lo stato viene riletto dal repo",
    /loadStatoPortafoglioCloud\(\);/.test(vivo));

  // la fusione per campo: se qualcuno la riducesse a un timestamp unico, si perderebbero dati
  check("v244 sync: la fusione confronta CAMPO per CAMPO, non l'intero blocco", (() => {
    const i = vivo.indexOf("async function loadStatoPortafoglioCloud");
    if (i < 0) return false;
    const b = vivo.slice(i, i + 2200);
    /* ⚠ il confronto va richiesto ATTACCATO alla chiave: con una finestra larga il blocco
       SUCCESSIVO soddisfaceva il controllo, e togliendo il confronto su `holdings` la guardia
       restava verde. È la classe "ancoraggio troppo lasco" già vista sulle classi CSS. */
    return ["cash", "holdings", "btp"].every(k =>
      new RegExp('cloud\\.' + k + ' && \\(cloud\\.' + k + '\\.at \\|\\| ""\\) >').test(b));
  })());

  /* ⚠ ricevere non basta: quando arriva un valore nuovo va RIFATTA la fusione col portafoglio
     e ridisegnato tutto, o resta invisibile fino a un reload manuale — e il CEO concluderebbe
     di nuovo che non si sincronizza. */
  check("v244 sync: dopo la ricezione si rifà la fusione e si ridisegna", (() => {
    const i = vivo.indexOf("async function loadStatoPortafoglioCloud");
    const b = vivo.slice(i, i + 2600);
    return /mergeManualHoldings\(\)/.test(b) && /recomputeTotals\(\)/.test(b) && /renderKPI/.test(b);
  })());

  // senza token non si finge: si dice che è rimasto locale
  check("v244 sync: senza token GitHub lo dichiara invece di fingere",
    /salvaStatoPortafoglio[\s\S]{0,420}senza token GitHub non arriva su iPhone/.test(vivo));
}

/* ═══ v243 — CINQUE TACHIMETRI, NON TRENTA ════════════════════════════════════════════════
   Il CEO ha chiesto un tachimetro per cinque voci precise. ⚠ NON e' il ritorno del `quadrante`
   respinto in v226: quello era lo STESSO widget su TRENTA indicatori — un muro indistinto — con
   una scala nuda senza riferimenti. Qui sono cinque strumenti scelti uno per uno e l'arco porta
   ZONE NOMINATE. La guardia protegge proprio quella differenza: il tachimetro non deve
   moltiplicarsi, e le sue bande devono dichiarare da dove vengono (regola v240). */
{
  const htmlTach = suVeri(`
    let html = "";
    const box = { set innerHTML(v) { html = v; }, get innerHTML() { return html; },
                  querySelector: () => null, querySelectorAll: () => [] };
    const altro = () => ({ innerHTML: "", textContent: "", querySelector: () => null,
                           querySelectorAll: () => [], addEventListener() {} });
    const vero = document.querySelector;
    document.querySelector = (sel) => sel === "#mg-tutti" ? box : altro();
    try { renderIndicatori(); } finally { document.querySelector = vero; }
    return html;`, 56000);

  const CINQUE = ["carry", "fear_greed", "smart_money", "risk_sentiment", "froth"];
  check("v243 tachimetro: c'è su tutte e cinque le voci chieste dal CEO", (() => {
    const schede = htmlTach.split(/<div class="mg-card(?!-head)/).slice(1);
    return CINQUE.every(k => {
      const c = schede.find(x => x.includes(`data-scheda="${k}"`));
      return c && /class="tk"/.test(c);
    });
  })());

  /* ⚠ e SOLO su quelle: se il tachimetro si moltiplicasse tornerebbe il muro di widget uguali
     che il CEO ha respinto tre volte. Il numero non e' un fondo arbitrario: e' la lista. */
  check("v243 tachimetro: non si è moltiplicato oltre le cinque voci", (() => {
    const schede = htmlTach.split(/<div class="mg-card(?!-head)/).slice(1);
    const conTach = schede.filter(c => /class="tk"/.test(c))
      .map(c => (c.match(/data-scheda="([^"]+)"/) || [])[1]);
    return conTach.length === CINQUE.length && conTach.every(k => CINQUE.includes(k));
  })());

  // e ogni tachimetro dichiara da dove vengono le sue bande, come le scale (regola v240)
  check("v243 tachimetro: ogni quadrante dichiara la provenienza delle bande", (() => {
    const t = (htmlTach.match(/class="tk"/g) || []).length;
    const f = (htmlTach.match(/class="tk-fonte muted"/g) || []).length;
    return t > 0 && t === f;
  })());

  // il tachimetro AGGIUNGE, non sostituisce: le barre dei fattori restano dove c'erano
  check("v243 tachimetro: non ha tolto i fattori che le schede già mostravano", (() => {
    const schede = htmlTach.split(/<div class="mg-card(?!-head)/).slice(1);
    return ["fear_greed", "smart_money", "risk_sentiment"].every(k => {
      const c = schede.find(x => x.includes(`data-scheda="${k}"`));
      return c && /class="obar-row/.test(c);
    });
  })());
}

/* ═══ v241 — LE SCHEDE SI TRASCINANO, E L'ORDINE VIVE NEL REPO ═════════════════════════════
   Richiesta CEO: trascinare le schede "come se fosse un desktop", con l'ordine che si presenta
   "su qualsiasi terminale". Le tre cose che rendono vera quella frase, ognuna gia' pagata:
     · POINTER EVENTS: su Safari touch il drag HTML5 non esiste (v193) — su iPhone non
       succederebbe niente e la funzionalita' sarebbe vera solo sul Mac;
     · CHIAVE STABILE `data-scheda`: il titolo e' fragile (v196), l'indice invecchia (C10);
     · PERSISTENZA NEL REPO: localStorage e' per-browser, quindi "su qualsiasi terminale" NON
       sarebbe soddisfatto — e' esattamente il difetto corretto sui parametri di rischio. */
{
  const htmlSchede = suVeri(`
    let html = "";
    const box = { set innerHTML(v) { html = v; }, get innerHTML() { return html; },
                  querySelector: () => null, querySelectorAll: () => [] };
    const altro = () => ({ innerHTML: "", textContent: "", querySelector: () => null,
                           querySelectorAll: () => [], addEventListener() {} });
    const vero = document.querySelector;
    document.querySelector = (sel) => sel === "#mg-tutti" ? box : altro();
    try { renderIndicatori(); } finally { document.querySelector = vero; }
    return html;`, 56000);

  check("v241 schede: OGNI scheda porta la sua chiave stabile per il riordino", (() => {
    const schede = (htmlSchede.match(/class="mg-card-head"/g) || []).length;
    const chiavi = [...htmlSchede.matchAll(/data-scheda="([^"]+)"/g)].map(m => m[1]);
    return schede > 0 && chiavi.length === schede && new Set(chiavi).size === chiavi.length;
  })());

  // ⚠ la chiave dev'essere la chiave dell'indicatore, non il titolo: un titolo riscritto non
  // deve far perdere al CEO il posto che ha dato a quella scheda
  check("v241 schede: la chiave è quella dell'indicatore, non il suo titolo", (() => {
    const chiavi = [...htmlSchede.matchAll(/data-scheda="([^"]+)"/g)].map(m => m[1]);
    const attese = suVeri("return indicatoriClassifica().map(r => r.k);", 56000);
    return chiavi.length > 0 && chiavi.every(k => attese.includes(k));
  })());

  check("v241 schede: l'ordine si salva nello stesso file del repo delle sezioni",
    /ord\.schede\[id\]\s*=/.test(src) && /pushOrdineSezioniCloud\(ord\)/.test(src)
    && (src.match(/const SEZ_ORDER_PATH = "config\/ui_order\.json"/g) || []).length === 1);

  /* ⚠ su Safari touch il drag HTML5 non funziona: se qualcuno lo reintroducesse, il
     trascinamento sarebbe vero solo sul Mac e la richiesta del CEO resterebbe mezza. */
  /* ⚠ la prima stesura vietava il drag HTML5 OVUNQUE e pescava due usi PREESISTENTI e legittimi
     (riordino delle colonne di tabella, elenco dei pannelli): entrambi solo-Mac da sempre, e
     documentati come tali. Il check si restringe alla macchina delle SCHEDE, che e' quella che
     deve funzionare anche su iPhone. */
  check("v241 schede: la macchina delle schede usa i pointer event, non il drag HTML5", (() => {
    const i = src.indexOf("function montaTrascinamentoSchede");
    const j = src.indexOf("\nfunction renderStruttura", i);
    if (i < 0 || j < 0) return false;
    const blocco = src.slice(i, j);
    return /pointerdown/.test(blocco) && /setPointerCapture/.test(blocco)
      && !/dragstart|draggable/.test(blocco);
  })());

  /* ⚠ senza scorrimento automatico il trascinamento e' vero solo per spostamenti CORTI: le 27
     schede occupano ~3000px e `elementFromPoint` restituisce null fuori dal viewport, quindi il
     punto d'arrivo lontano semplicemente non esiste. Misurato provandolo nel browser. */
  check("v241 schede: il trascinamento fa scorrere la pagina ai bordi", (() => {
    const vivo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const i = vivo.indexOf("function trascinaScheda");
    if (i < 0) return false;
    const blocco = vivo.slice(i, i + 2600);
    return /window\.scrollBy/.test(blocco) && /clearInterval/.test(blocco);
  })());

  // e l'ordine dev'essere RIAPPLICATO a ogni render: la griglia si ricostruisce da capo
  /* ⚠ senza togliere i commenti la guardia non morde: una chiamata COMMENTATA contiene ancora
     il testo cercato. Quarta volta in questa sessione che una scansione del sorgente inciampa
     nei commenti — vale come regola: chi cerca codice nel sorgente li toglie prima. */
  check("v241 schede: l'ordine salvato si riapplica dopo ogni render", (() => {
    const vivo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    return /applicaOrdineSchede\(griglia, "indicatori"\)/.test(vivo);
  })());
}

/* ═══ v240 — UNA SOGLIA DISEGNATA E' UN'AFFERMAZIONE, E VA SOSTENUTA ═══════════════════════
   Il CEO ha chiesto: "spero tu non abbia inventato dati". I VALORI no, vengono tutti da
   data.json. Ma le soglie che avevo disegnato sugli assi erano in parte scelte mie, presentate
   con l'autorita' di una misura. Tre erano indifendibili:
     · EUR/JPY "zona intervento 185" — inventata; la BoJ e' intervenuta su USD/JPY, non su EUR/JPY;
     · UMich "media storica 85" — quel numero non e' nel file;
     · disoccupazione "soglia Sahm 4,5%" — FALSA: la regola di Sahm e' un MOVIMENTO (media a 3
       mesi che sale di 0,5 pp sopra il minimo dei 12), non un livello. E contraddiceva la
       spiegazione scritta nella stessa scheda, che invece la enunciava correttamente.
   Piu' una quarta: la media 16,5 disegnata sulla scala del P/E TRAILING e' la media del FORWARD
   (forward_pe.avg_hist), e sp500_pe.avg_10y nel file e' null — due metodologie confrontate come
   se fossero una, che e' proprio cio' che il payload avverte di non fare.
   E' la classe v195: "un ID indovinato e scritto come se fosse certo sarebbe stato peggio di un
   tentativo dichiarato". Ora ogni scala DICHIARA da dove vengono le sue bande. */
{
  const htmlIndicatori = suVeri(`
    let html = "";
    const box = { set innerHTML(v) { html = v; }, get innerHTML() { return html; },
                  querySelector: () => null, querySelectorAll: () => [] };
    const altro = () => ({ innerHTML: "", textContent: "", querySelector: () => null,
                           querySelectorAll: () => [], addEventListener() {} });
    const vero = document.querySelector;
    document.querySelector = (sel) => sel === "#mg-tutti" ? box : altro();
    try { renderIndicatori(); } finally { document.querySelector = vero; }
    return html;`, 56000);

  check("v240 scale: OGNI scala dichiara da dove vengono le sue bande", (() => {
    const scale = (htmlIndicatori.match(/class="sc"/g) || []).length;
    // ⚠ ancoraggio esatto: `class="sc-fonte` matcherebbe anche `sc-fonte-qualcosa`, e la
    // guardia non mordeva quando ho iniettato il rinomino della classe.
    const fonti = (htmlIndicatori.match(/class="sc-fonte muted"/g) || []).length;
    return scale > 0 && scale === fonti;
  })());

  /* ⚠ i COMMENTI vanno tolti prima di scandire: le note che SPIEGANO perche' quelle soglie sono
     state rimosse le contengono per forza, e il check trovava se stesso — l'inciampo del gate
     v213, terza volta in questa sessione. Si guarda l'HTML RESO piu' il codice senza commenti. */
  check("v240 scale: nessuna delle tre soglie inventate è rientrata", (() => {
    const senzaNote = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    return !/zona intervento|soglia Sahm/.test(senzaNote)
      && !/zona intervento|soglia Sahm/.test(htmlIndicatori);
  })());

  /* ⚠ la piu' importante: NON si disegna una media storica quando il file non ce l'ha.
     sp500_pe.avg_10y e' null, quindi sulla scheda del P/E trailing quella tacca non puo' esserci. */
  check("v240 scale: nessuna 'media storica' disegnata dove il file non la contiene", (() => {
    const avg10 = ((reale.macro || {}).sp500_pe || {}).avg_10y;
    if (avg10 != null) return true;                       // se un giorno ci sara', si potra' disegnare
    /* si guarda la scheda del P/E: la si trova dal titolo, tollerando l'escape dell'ampersand.
       La riga di PROVENIENZA e' esclusa: li' "media storica" puo' comparire per DIRE che non c'e'. */
    const scheda = htmlIndicatori.split(/<div class="mg-card(?!-head)/)
      .find(c => /Valutazione S(&amp;|&)P/.test(c));
    if (!scheda) return false;                      // se la scheda non c'e', il check non misura
    const senzaFonte = scheda.replace(/<div class="sc-fonte[\s\S]*?<\/div>/g, "");
    return !/media storica/.test(senzaFonte);
  })());
}

/* ═══ v239 — LA CATENA DI RENDER DEVE GIRARE, NON SOLO COMPILARE ═══════════════════════════
   La v238 e' andata in produzione con la pagina MORTA: il taglio di renderDeriva() si era
   portato via `let allocGrafMode = "sector"`, che stava FRA quella funzione e la successiva.
   Risultato: `allocGrafMode is not defined` dentro renderAllocGrafica → renderStruttura →
   renderAll → loadData, cioe' l'intera pagina non si disegnava. E la suite era VERDE: 219 check
   passati, `node --check` passato, red team passato — perche' nessuno ESEGUIVA il render.
   E' la classe v213 ("la pagina era morta") che si ripresenta con una causa diversa: allora era
   un addEventListener su un elemento rimosso, qui una dichiarazione portata via da un taglio.
   La lezione comune: la sintassi valida non dice niente sull'esecuzione.
   ⚠ E la ricevuta del taglio non l'ha vista perche' contava quante `function` cadevano nei
   confini — un `let` in mezzo non e' una function. Una ricevuta deve contare TUTTE le
   dichiarazioni di primo livello, non solo quelle che ti aspetti. */
{
  const renderGira = (fn) => run(`
    const _d = DATA, _c = cashEur;
    DATA = JSON.parse(JSON.stringify(REALE)); cashEur = 56000; recomputeTotals();
    let esito = true;
    try { ${fn}(); } catch (e) { esito = "ECCEZIONE: " + e.message; }
    DATA = _d; cashEur = _c; recomputeTotals();
    return esito;`);

  /* ⚠ v253 — L'ELENCO SI RICAVA DA renderAll, NON SI SCRIVE A MANO. Il gate v239 nasceva da
     una pagina andata MORTA in produzione con 219 test verdi, e copriva SEI funzioni: ma
     quella che gira davvero al caricamento è renderAll, che ne chiama oltre venti. Una
     chiamata aggiunta lì domani nascerebbe fuori dal gate — è il registro che invecchia da
     solo, la classe che questo progetto ha già pagato con C10, con gli indici 16/17 del red
     team e con la chiave morta "in:pmi". Ora la lista si legge dal corpo di renderAll. */
  const corpo = (() => {
    const i = src.indexOf("function renderAll(");
    if (i < 0) return "";
    let d = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === "{") d++;
      else if (src[j] === "}") { d--; if (d === 0) return src.slice(i, j + 1); }
    }
    return "";
  })();
  const daRenderAll = [...new Set([...corpo.matchAll(/^\s*(?:if \([^)]*\) )?([a-zA-Z][a-zA-Z0-9_]*)\(\);/gm)].map(m => m[1]))]
    .filter(f => new RegExp(`^(?:async )?function ${f}\\b`, "m").test(src));
  check("v253 il gate di render copre TUTTE le chiamate di renderAll (elenco ricavato, non scritto a mano)",
    daRenderAll.length >= 15);

  const CHIAMATE = [...new Set(["renderStruttura", "renderMacroGrafici", "renderIndicatori",
                    "renderLevaStagione", "renderRotazione", "renderStress", ...daRenderAll])];
  const rotte = [];
  for (const fn of CHIAMATE) {
    const esito = renderGira(fn);
    if (esito !== true) rotte.push(`${fn}: ${esito}`);
  }
  check(`v239+v253 render: le ${CHIAMATE.length} funzioni della catena girano sui dati veri senza eccezioni`, rotte.length === 0);
  for (const r of rotte) console.log("  ⚠", r);
}

/* ═══ LA SUITE CONTROLLA SE STESSA ═══ ═════════════════════════════════════════════════
   Tre difetti di METODO, non di prodotto, che in questa sessione mi sono costati piu' tempo dei
   difetti veri. Non si correggono "stando attenti": si rendono impossibili o rumorosi.
     1. arrow passata a check()  → gia' impossibile: check() accetta solo un boolean.
     2. dati veri in N copie     → gia' impossibile: REALE e suVeri() sono unici.
     3. nomi di check duplicati  → due check con lo stesso nome sono indistinguibili nell'output:
        se uno fallisce non si sa quale, e uno dei due puo' restare rotto per sempre.
   Piu' la regola dell'ordine (v205): il report deve stare in fondo, o i check aggiunti dopo
   finiscono contati ma incapaci di far fallire la CI. */
{
  /* ⚠ IL BLOCCO META VA ESCLUSO DALLA SCANSIONE, o trova SE STESSO: le espressioni che cerca
     ("una arrow passata a check", "REALE" con una cifra) compaiono per forza nel proprio codice.
     E' lo stesso inciampo del gate v213, che si autodenunciava. Si taglia da qui in giu'. */
  const MARCA = "═══ LA SUITE CONTROLLA SE STESSA ═══";
  const tutto = readFileSync(join(ROOT, "scripts", "test_app.mjs"), "utf8");
  /* ⚠ e i COMMENTI vanno tolti: l'esempio `check("x", () => {…})` scritto nella nota che spiega
     la trappola VENIVA CONTATO come trappola. Identico al gate v213, che si autodenunciava. */
  const src2 = tutto.slice(0, tutto.indexOf(MARCA) >= 0 ? tutto.indexOf(MARCA) : tutto.length)
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // ⚠ una arrow passata nuda a check() non esegue mai il proprio corpo
  const nude = (src2.match(/check\([^)]*?,\s*\(\)\s*=>\s*\{/g) || []).length;
  check("meta: nessun check riceve una arrow non invocata", nude === 0);

  // ⚠ una sola copia dei dati veri e un solo helper: era la duplicazione a farmi sbagliare scope
  check("meta: i dati veri hanno UNA sola copia e UN solo helper",
    (src2.match(/REALE_JSON =/g) || []).length === 1
    && !/REALE[2-9]/.test(src2)
    && (src2.match(/const suVeri = /g) || []).length === 1);

  // ⚠ nomi duplicati: se due check si chiamano uguale, un fallimento non si sa a chi appartenga
  const nomi = T.map(([n]) => n.replace(/\s+⛔.*$/, ""));
  const doppi = nomi.filter((n, i) => nomi.indexOf(n) !== i);
  check("meta: nessun nome di check duplicato", doppi.length === 0);
  if (doppi.length) console.log("  ⚠ nomi duplicati:", [...new Set(doppi)].slice(0, 5).join(" · "));

  // ⚠ il report DEVE restare l'ultima cosa del file (v205): altrimenti i check che vengono dopo
  // sono contati nel totale ma `fail` e' gia' stato calcolato e la CI esce 0 con la suite rossa
  /* questo va misurato sul file INTERO (il report sta dopo il blocco meta, quindi in src2 non
     c'e' proprio) e sulle RIGHE, non sugli indici: dopo il marcatore del report non deve esserci
     nessuna chiamata a check(), o quei check finiscono contati ma incapaci di rompere la CI. */
  const dopoReport = tutto.slice(tutto.lastIndexOf("/* ---------- report ----------"));
  check("meta: dopo il blocco report non c'è nessun check (v205)",
    tutto.includes("/* ---------- report ----------")
    && !/^\s*check\(/m.test(dopoReport));
}

/* ═══ v253 — il registro degli orari di run NON deve invecchiare da solo ═══════════════
   RUN_FISSI_UTC in app.js è una COPIA del cron di .github/workflows/update-data.yml, e questo
   progetto ha già pagato più volte i registri copiati a mano (C10, gli indici fissi 16/17 del
   red team, la chiave morta "in:pmi" di v196). Il check rilegge il file del workflow: se
   qualcuno cambia il cron, le card macro smettono di dire il vero e questo test lo dice. */
{
  const yml = readFileSync(join(ROOT, ".github", "workflows", "update-data.yml"), "utf8");
  const fissi = [...yml.matchAll(/- cron: "(\d+) (\d+) \* \* \*"/g)].map(m => [+m[2], +m[1]]);
  const src3 = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const tab = src3.match(/const RUN_FISSI_UTC = \[([^\]]*(?:\][^;]*?)*?)\];/);
  const dichiarati = tab ? [...tab[1].matchAll(/\[(\d+),\s*(\d+)\]/g)].map(m => [+m[1], +m[2]]) : [];
  const k = (a) => a.map(x => x.join(":")).sort().join(" ");
  check("v253 gli orari di run nelle card macro combaciano col cron del workflow",
    fissi.length > 0 && dichiarati.length > 0 && k(fissi) === k(dichiarati));
  if (k(fissi) !== k(dichiarati)) console.log("  ⚠ workflow:", k(fissi), "\n  ⚠ app.js:  ", k(dichiarati));
  const orario = /- cron: "0 (\d+)-(\d+) \* \* 1-5"/.exec(yml);
  const oDich = /RUN_ORARIO_UTC = \{ da: (\d+), a: (\d+)/.exec(src3);
  check("v253 anche la finestra del run orario feriale combacia col cron",
    !!orario && !!oDich && orario[1] === oDich[1] && orario[2] === oDich[2]);
}

check("v253 prossimoRunPipeline trova davvero il run successivo (la prima stesura saltava le 19:00)", run(`
  const t = new Date(Date.UTC(2026, 7, 8, 18, 53, 0));      // sabato: valgono solo i run fissi
  const p = prossimoRunPipeline(t);
  return p != null && p.getTime() === Date.UTC(2026, 7, 8, 19, 0, 0)`));

check("v253 nel weekend NON si annuncia il run orario feriale", run(`
  const sab = new Date(Date.UTC(2026, 7, 8, 13, 5, 0));     // sabato 13:05 UTC
  const p = prossimoRunPipeline(sab);
  return p != null && p.getUTCHours() === 13 && p.getUTCMinutes() === 30`));

/* ═══ v253 — il payload DICHIARA quando il libro è indietro rispetto al repo ═══
   Trovato eseguendo il pacchetto su me stesso: config/holdings.json aveva 12 posizioni e il
   payload ne portava 9, senza un segno che ne mancassero quattro. Validato iniettando il
   fenomeno E togliendolo: un check di sola presenza passerebbe anche su una riga incondizionata. */
check("v253 libro indietro: il payload lo DICHIARA quando il diario ha un acquisto applicato assente dai dati", suVeri(`
  const salvo = localStorage.getItem("action_diary");
  localStorage.setItem("action_diary", JSON.stringify([{ date: "2099-01-01",
    text: "acquisto 10 ZZTEST a 100", applicata: true,
    op: { tipo: "ACQUISTO", qty: 10, ticker: "ZZTEST", prezzo: 100 } }]));
  let p; try { p = buildPrompt(); } finally {
    if (salvo == null) localStorage.removeItem("action_diary"); else localStorage.setItem("action_diary", salvo); }
  return /LIBRO INCOMPLETO IN QUESTO PACCHETTO/.test(p) && p.includes("ZZTEST")`));

check("v253 libro allineato: senza operazioni pendenti la dichiarazione NON compare", suVeri(`
  const salvo = localStorage.getItem("action_diary");
  localStorage.setItem("action_diary", "[]");
  let p; try { p = buildPrompt(); } finally {
    if (salvo == null) localStorage.removeItem("action_diary"); else localStorage.setItem("action_diary", salvo); }
  return !/LIBRO INCOMPLETO IN QUESTO PACCHETTO/.test(p)`));

check("v253 la dichiarazione ignora le operazioni NON ancora applicate (quelle le copre il banner del diario)", suVeri(`
  const salvo = localStorage.getItem("action_diary");
  localStorage.setItem("action_diary", JSON.stringify([{ date: "2099-01-01",
    text: "acquisto 10 ZZTEST a 100",
    op: { tipo: "ACQUISTO", qty: 10, ticker: "ZZTEST", prezzo: 100 } }]));
  let p; try { p = buildPrompt(); } finally {
    if (salvo == null) localStorage.removeItem("action_diary"); else localStorage.setItem("action_diary", salvo); }
  return !/LIBRO INCOMPLETO IN QUESTO PACCHETTO/.test(p)`));

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
