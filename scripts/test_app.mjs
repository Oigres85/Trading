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
/* ⚠ v256 — `run` CATTURA L'ECCEZIONE invece di far esplodere l'intero file. Con la riscrittura
   a pagina-macro decine di check asserivano su blocchi che non esistono piu': il primo che
   lanciava fermava la suite alla prima riga e nascondeva tutti gli altri. Un check che va in
   eccezione DEVE fallire — non deve impedire agli altri di essere eseguiti. */
const run = (code) => {
  try {
    return vm.runInContext(`(() => { ${code.includes("return") ? code : `return (${code})`} })()`, ctx, { filename: "assert.js" });
  } catch (e) { return `⚠ ECCEZIONE: ${e.message}`; }
};

// pesi MARK-TO-MARKET, non costo storico

// veto: guida il SORTINO, non lo Sharpe

// stop ratchet

// motore: verdetto, violazioni, esclusi, sizing regime-aware

// ---- RIABILITAZIONE GROWTH (v111): il veto Sortino è revocato SOLO con qualità+trend+RS ----

// ---- v112: staleness dichiarata, indici non operabili, earnings sul piano, diario, Sharpe 6M ----




// ---- TRIM PEG-aware (v111, let winners run): P/E ottico alto ma PEG sano → niente trim ----

// riconciliazione broker (soglia volatility-aware)

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








// v256 — guardrail della testata SOSTITUITO: vive ora nel blocco v256, che verifica che il
// fallback sia scritto per il pacchetto MACRO e non piu' per la Costituzione del fondo.




// ---- v113: turnaround squeeze, cinematica, track record, auto-timestamp broker ----
/* ⚠ v247 — INVARIANTE CAMBIATO, non zittito. Prima chiedeva che il payload PRESCRIVESSE il
   trattamento dello squeeze (sizing dimezzato, stop 1×ATR, mai media al ribasso): è esattamente
   il genere di riga che il CEO ha fatto togliere. Ora chiede due cose insieme — che il MOTORE
   continui a classificarlo (la dashboard lo usa) e che il PAYLOAD non porti più la prescrizione.
   Zittire la guardia avrebbe perso la protezione (classe v203); cambiarle invariante la conserva. */

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


/* GUARDRAIL CARD MOBILE (v109): ogni etichetta di MOBILE_KEY_COLS deve esistere DAVVERO
   tra le <th> di index.html (viste tecniche) o nella head[] di buildFundTable (viste
   fondamentali). Un'etichetta orfana = colonna che sparisce dalle card iPhone senza errori
   (già successo: "P/E TTM"/"Marg.netto"/"Cresc.ricavi" vs "P/E"/"Margine netto"/"Cresc. ricavi"). */
// v256 — REGISTRO DEI FATTI FONDAMENTALI RIMOSSO. Verificava che ogni fatto (Market Cap,
// P/E, ROE, Financial Health...) restasse raggiungibile o dal payload o dalla tabella del
// portafoglio. Non esistono piu' ne' la tabella ne' i fondamentali nel payload: la guardia
// non proteggeva un invariante violato, proteggeva un mondo che il CEO ha chiuso.

/* ---------- SAFE BY DESIGN v115 (post-incidente SNDK $40,1 / stop -$366) ---------- */






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





check("v125 futures nel prompt: NQ/ES live come leading pre-apertura", run(`
  DATA.macro.futures = { nasdaq: { price: 20000, change_pct: -2.4 }, sp500: { price: 6500, change_pct: -1.1 } };
  const p = buildPrompt();
  delete DATA.macro.futures;
  return p.includes("Futures USA LIVE") && p.includes("Nasdaq 100 (NQ)")`));


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


/* ---------- v136: tag [⚡ASIMM] (volatilità asimmetrica) + Polymarket Δ7g ---------- */
check("ASIMM: Sortino>1,7×Sharpe (entrambi>0) e RSI>55 → true; ratio basso / Sharpe≤0 / RSI≤55 → false", run(`
  return isAsimm({ sharpe_1y: 1, sortino_1y: 2, rsi: 60 }) === true
      && isAsimm({ sharpe_1y: 1, sortino_1y: 1.5, rsi: 60 }) === false
      && isAsimm({ sharpe_1y: -1, sortino_1y: -2, rsi: 60 }) === false
      && isAsimm({ sharpe_1y: 1, sortino_1y: 2, rsi: 50 }) === false`));
/* ⚠ v252 — INVARIANTE CAMBIATO. ⚡ASIMM viveva dentro la colonna "Segnale", che è uscita dal
   payload perché era un'etichetta calcolata da RSI e distanza dalla SMA200 — due colonne già
   presenti. ASIMM è della stessa natura: deriva da Sortino > 1,7× Sharpe con RSI>55, e tutti e
   tre sono COLONNE della tabella. Quindi l'invariante che conta non è "l'etichetta c'è", è
   "le misure che la generano ci sono": l'LLM può ricostruirla, e senza un'etichetta in mezzo. */

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
/* ⚠ v255 — INVARIANTE CAMBIATO, non zittito. Il filtro qualità era BLOCCANTE: ora è una
   segnalazione. La testata del CEO dice che il payload non impone vincoli e che le decisioni
   di dimensionamento sono sue; un filtro di qualità è un GIUDIZIO, e un giudizio che si
   presenta come impossibilità mente sulla propria natura. Restano bloccanti solo i fatti che
   l'aritmetica rende impossibili. Il check verifica che il giudizio COMPAIA — toglierlo del
   tutto sarebbe stato perdere l'informazione invece di declassarla. */
/* ⚠ v255 — INVARIANTE CAMBIATO, non zittito. Il filtro qualità era BLOCCANTE: ora è una
   segnalazione. La testata del CEO dice che il payload non impone vincoli e che quanto
   impegnare è una decisione sua; un filtro di qualità è un GIUDIZIO, e un giudizio che si
   presenta come impossibilità mente sulla propria natura. Restano bloccanti solo i fatti che
   l'aritmetica rende impossibili (vendere ciò che non hai, stop sopra il limite, un ticker
   che nel payload non esiste, un limite d'acquisto SOPRA il prezzo corrente).
   ⚠ La prima stesura usava limite 95 su un titolo che ne vale 80: restava `hard` per la
   regola del limite sopra il mercato, e il check accusava il codice invece di sé stesso.
   Un check che non isola la regola che misura sta misurando un'altra cosa. */



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

check("v138 curva: riga indicators etichettata GIORNALIERA (non più 'serie mensile')", run(`
  const saved = DATA.macro.indicators;
  DATA.macro.indicators = [{ key: "curve", label: "Curva 10A-2A", value: "+0.41 pp", date: "2026-07-16" }];
  const p = buildPrompt();
  DATA.macro.indicators = saved;
  return p.includes("serie GIORNALIERA FRED T10Y2Y") && !p.includes("Curva 10A-2A: +0.41 pp (rilevazione 2026-07-16 — serie mensile")`));

/* ---------- v139: benchmark nel brief + attribuzione ---------- */



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

/* ---------- v143.1: guardia headless dell'editor rischio (regressione log_verdict) ---------- */
/* ⚠ v253 — INVARIANTE ROVESCIATO, non zittito. initRiskEditor() e renderRiskParams() sono
   state rimosse: scrivevano su contenitori spariti quando il CEO ha tolto la scheda
   "Parametri di Rischio del Fondo". Il check ora presidia il TAGLIO — se qualcuno le
   reintroduce senza rimettere i contenitori, tornano due funzioni che girano nel vuoto. */


/* ---------- v144: screener idee di rotazione + gradazione veto ---------- */

check("v144 screener: assente/vuoto → nessun blocco (niente sezione vuota)", run(`
  const saved = DATA.screener; DATA.screener = [];
  const p = buildPrompt(); DATA.screener = saved;
  return !p.includes("IDEE DI ROTAZIONE")`));
/* ⚠ v247 — INVARIANTE CAMBIATO. La severità del veto (FORTE/DEBOLE) era un'etichetta di
   bocciatura e il CEO l'ha fatta togliere dal payload. Il motore la calcola ancora — serve alla
   dashboard — ma il payload non la pubblica. Quello che DEVE restare, e che qui si verifica, è
   la MISURA che la motivava: senza il Sortino nelle tabelle il taglio avrebbe fatto sparire un
   fatto, non un giudizio (classe v208). */


/* ---------- v145: revisione payload (parità tabelle fondamentali, brief onesto, ⚠deg, cap gate, shock) ---------- */



check("v145 rendimento book: da gain_pct (cash-neutral), IMMUNE al break/movimenti di cassa in eur_value", run(`
  const mh = [
    { date: "2026-07-01", gain_pct: 50, eur_value: 300000 },   // cassa inclusa (pre-break)
    { date: "2026-07-08", gain_pct: 53, eur_value: 270000 },   // −30k = artefatto cassa, non perdita
  ];
  const r = bookReturnPct(mh, 7);   // (1,53/1,50)−1 = +2,00%, NON il −10% dei delta di eur_value
  return r != null && Math.abs(r - 2) < 0.05`));

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



check("v146 cap display: il BTP (bond, beta 0) NON compare nella lista over-cap d'ingresso", run(`
  const saved = RISK_PARAMS.capNoAdd_pct;
  RISK_PARAMS.capNoAdd_pct = 1;                       // cap bassissimo: ogni equity è "over", il BTP no
  const p = buildPrompt();
  RISK_PARAMS.capNoAdd_pct = saved;
  const m = p.match(/SOPRA il cap d'ingresso[^\\n]*/);
  return m == null || !/BTP/.test(m[0])`));

/* ---------- v148: resistenza + Sortino 6M nel payload (dati calcolati ma mai stampati) ---------- */





/* ---------- v149: contesto di sessione + validatore su ordini in tabella markdown ---------- */
check("v149 sessione: fasi deterministiche (lun 08:00 ET=pre-market · mer 12:00=regular · sab=weekend · mar 22:00=notte)", run(`
  const at = (iso) => usSessionInfo(new Date(iso));
  return at("2026-07-20T12:00:00Z").phase === "pre-market"     // lunedì 08:00 ET (EDT)
      && at("2026-07-22T16:00:00Z").phase === "regular"        // mercoledì 12:00 ET
      && at("2026-07-25T15:00:00Z").phase === "weekend"        // sabato
      && at("2026-07-22T02:00:00Z").phase === "notte"          // martedì 22:00 ET (mer 02:00 UTC)
      && at("2026-07-20T12:00:00Z").minsToOpen === 90`));

check("v190 sessione: nel ramo Seoul-aperta l'etichetta del KOSPI non contraddice il testo", run(`
  // la riga si contraddiceva: "[ultima chiusura di Seoul, borsa ferma]" accanto a "Seoul sta
  // scambiando ora". Lo stato mancante era mercato APERTO + dato VECCHIO, il piu' insidioso.
  const p = buildPrompt();
  const riga = p.split("\\n").find(r => r.startsWith("CONTESTO DI SESSIONE")) || "";
  const diceAperta = riga.includes("BORSA ASIATICA APERTA");
  const diceFerma = riga.includes("borsa ferma");
  return !(diceAperta && diceFerma)`));


/* ---------- v150: sync cloud parametri di rischio + distanza res in cella ---------- */
check("v150 risk sync: la chiave _savedAt (stringa merge) NON inquina RISK_PARAMS né crasha applyRiskOverrides", run(`
  const saved = RISK_PARAMS.capNoAdd_pct;
  localStorage.setItem("risk_params_overrides", JSON.stringify({ capNoAdd_pct: 15, _savedAt: "2026-07-21T06:00:00Z" }));
  applyRiskOverrides();
  const ok = RISK_PARAMS.capNoAdd_pct === 15 && RISK_PARAMS._savedAt === undefined;
  localStorage.removeItem("risk_params_overrides");
  RISK_PARAMS.capNoAdd_pct = saved;
  return ok`));


/* ---------- v151: ri-arm candidato sugli stop violati + flag held-candidate ---------- */


/* ⚠ v247 — INVARIANTE ROVESCIATO. Chiedeva che le detenute in VETO FORTE comparissero in una
   LISTA nel payload: è esattamente l'elenco che il CEO ha citato come causa del "mi fa vendere
   tutto". Il motore continua a identificarle (la dashboard le usa), ma il payload non le elenca
   più. Si verificano entrambe le cose, perché perdere la prima sarebbe perdere un fatto. */

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

check("v174 guardie settoriali: una sola sul giudizio (varianza), il peso resta contesto", run(`
  const p = buildPrompt();
  const riga = p.split("\\n").find(l => l.includes("primo settore:"));
  if (riga == null) return true;
  // la riga sul PESO non deve più emettere un proprio ALERT concorrente
  return !/⚠ ALERT/.test(riga) && /quota di CAPITALE, non di rischio/.test(riga);`));
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



/* ═══════════════════════════════════════════════════════════════════════════════════════════
   v256 — LE GUARDIE STRUTTURALI, RIALLINEATE ALLA PAGINA MACRO
   Lo sfoltimento ha portato via decine di check scritti per portafoglio, watchlist e news.
   Quelle che seguono NON sono state riscritte per farle tacere: hanno cambiato invariante,
   perché ciò che proteggevano — che la pagina esista, che il wiring non punti nel vuoto, che
   il gate di render copra la catena vera — vale identico su una pagina diversa.
   ⚠ Ogni guardia qui sotto è stata validata iniettando il difetto che deve trovare.
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

/* ── la testata offline: era la Costituzione del fondo, ora è il pacchetto macro ── */
{
  const src4 = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const m = src4.match(/const DEFAULT_PROMPT_HEADER = `([\s\S]*?)`;/);
  const testo = m ? m[1] : "";
  check("v256 FALLBACK TESTATA: esiste, non è vuoto ed è scritto per un pacchetto MACRO",
    testo.length > 400 && /analista macro/i.test(testo)
    && !/portafoglio del fondo|ordini a limite|stop dichiarato/i.test(testo));
  if (!(testo.length > 400)) console.log("  ⚠ fallback testata mancante o degenere");

  const fileMacro = readFileSync(join(ROOT, "config", "prompt_header_macro.txt"), "utf8");
  check("v256 la testata macro sul repo esiste e non chiede operazioni su titoli",
    fileMacro.length > 400 && !/COMPRA ~|VENDI ~|quote a limite/.test(fileMacro));
}

/* ── ⚠ v257 — IL NUMERO DI VERSIONE VIVE IN DUE POSTI E DEVONO COINCIDERE ──
   BUILD_VERSION in app.js e il ?v= di index.html. Sono rimasti disallineati per SEI versioni
   (251 contro 256) e hanno prodotto due bugie: il banner "stai vedendo una versione vecchia"
   acceso per sempre — nessun ricaricamento poteva farlo coincidere — e il timbro del pacchetto
   AI che dichiarava v251 su codice v256. Il CEO l'ha scoperto incollandomi un prompt.
   Un registro copiato a mano invecchia da solo: e' la classe C10, e ora ha il suo gate. */
{
  const appSrc7 = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const html7 = readFileSync(join(ROOT, "index.html"), "utf8");
  const inCodice = (appSrc7.match(/const BUILD_VERSION = "(\d+)"/) || [])[1];
  const inPagina = (html7.match(/app\.js\?v=(\d+)/) || [])[1];
  check("v257 BUILD_VERSION coincide col ?v= di index.html (o il banner versione mente per sempre)",
    !!inCodice && inCodice === inPagina);
  if (inCodice !== inPagina) console.log(`  ⚠ app.js dice v${inCodice}, index.html serve v${inPagina}`);

  const cssV = (html7.match(/style\.css\?v=(\d+)/) || [])[1];
  check("v257 anche il CSS e' bustato con la stessa versione", cssV === inPagina);
}

/* ── gli elementi portanti della pagina nuova ── */
{
  const html4 = readFileSync(join(ROOT, "index.html"), "utf8");
  const PORTANTI = [
    'id="updated-at"', 'id="btn-cio"', 'id="btn-refresh"',
    /* v259 — 'id="tk-go"' NON e' piu' un elemento portante: il CEO ha chiesto UN SOLO bottone
       e i due sono stati fusi in #btn-cio, che decide dal contenuto del box. La guardia non e'
       stata indebolita — l'invariante che conta e' che l'AZIONE esista, e #btn-cio la porta. */
    'id="tk-input"', 'id="tk-esito"',                           // analisi spot del titolo
    'id="tv-chart"', 'id="tv-tf"', 'id="tv-nota"',              // v257 grafico TradingView
    'id="wl-input"', 'id="wl-salva"', 'id="wl-chips"', 'id="wl-tv"',   // v257 watchlist propria
    'id="mg-rot"', 'id="mg-stress"', 'id="mg-leva"', 'id="mg-tutti"',   // macro in grafici
    'id="corr-macro"',                                          // correlazione fra indicatori
    'id="open-pmc"', 'id="open-sell"',                          // gli strumenti che il CEO tiene
    'id="pmc-modal"', 'id="sell-modal"', 'id="modal"', 'id="chart-modal"',
    'id="dataquality-alert"', 'id="version-alert"', 'id="shock-alert"',
  ];
  const mancanti = PORTANTI.filter(p => !html4.includes(p));
  check("v256 struttura: nessun elemento portante è sparito da index.html", mancanti.length === 0);
  if (mancanti.length) console.log("  ⚠ elementi portanti mancanti:", mancanti.join(", "));

  const sez = [...html4.matchAll(/data-sez="([a-z0-9-]+)"/g)].map(m => m[1]);
  check("v256 ogni sezione ha una chiave data-sez, tutte distinte",
    sez.length >= 6 && new Set(sez).size === sez.length);
}

/* ── ⚠ v257 — IL WIDGET TRADINGVIEW E' L'UNICA DIPENDENZA ESTERNA: che resti tale ──
   Uno script di terze parti dentro una pagina che finora non ne aveva nessuno merita un gate.
   Tre invarianti: si carica SOLO dal dominio ufficiale, ha un onerror che degrada invece di
   lasciare un buco muto, e NON riceve mai credenziali (il CEO le ha offerte, sono state
   rifiutate: il widget e' pubblico e con le credenziali non ci si farebbe nulla). */
{
  const appTV = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const srcTV = [...appTV.matchAll(/sc\.src\s*=\s*"([^"]+)"/g)].map(m => m[1]);
  check("v257 TradingView: gli script esterni vengono SOLO da s3.tradingview.com",
    srcTV.length >= 2 && srcTV.every(u => u.startsWith("https://s3.tradingview.com/external-embedding/")));
  check("v257 TradingView: ogni widget ha un onerror che degrada in modo visibile",
    (appTV.match(/sc\.onerror\s*=/g) || []).length >= 2);
  /* ⚠ QUARTA VOLTA che un gate trova SE STESSO. La prima stesura cercava la parola
     "credenzial" vicino a "tradingview" — e la trovava nella nota che RASSICURA il CEO
     ("nessun account e nessuna credenziale"). Cercare una parola non e' cercare un
     comportamento: ora si guarda se una credenziale viene LETTA o SPEDITA. */
  const codiceTV = appTV.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const leggeCredenziali = /localStorage\.getItem\(\s*["'`][^"'`]*(pass|cred|tradingview|investing)/i.test(codiceTV);
  const campoPassword = /type\s*=\s*["']password["']/i.test(readFileSync(join(ROOT, "index.html"), "utf8"));
  const nelConfig = /symbol[\s\S]{0,300}?(password|user(name)?|auth|token)\s*:/i.test(codiceTV);
  check("v257 TradingView: nessuna credenziale viene letta o spedita al widget",
    !leggeCredenziali && !campoPassword && !nelConfig);

  const htmlTV = readFileSync(join(ROOT, "index.html"), "utf8");
  check("v257 la watchlist e' dichiarata per quello che e': simboli scelti dal CEO, non quella di Investing",
    /simboli tuoi, salvati/.test(htmlTV));
}

/* ── v257 — la watchlist segue il CEO su ogni device, o lo dice ── */
check("v257 watchlist: senza token il salvataggio e' locale E LO DICHIARA", (() => {
  const appW = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  return /SU QUESTO BROWSER/.test(appW) && /config\/ui_watchlist\.json/.test(appW);
})());

/* ── v258 — i componenti di Fear & Greed hanno una scheda propria, senza duplicare ── */
check("v258 F&G: i componenti diventano schede a se', e quelli gia' presenti NON si duplicano", suVeri(`
  const tutti = indicatoriClassifica();
  const nuovi = tutti.filter(x => String(x.k).startsWith("fg:"));
  if (!nuovi.length) return false;                       // i dati veri hanno 7 componenti
  const nomi = tutti.map(x => x.nome.toLowerCase());
  const dupVix = nomi.filter(n => /\\bvix\\b/.test(n)).length;
  const dupPC  = nomi.filter(n => /put\\/call/.test(n)).length;
  return dupVix === 1 && dupPC === 1 && nuovi.every(x => Number.isFinite(x.score) && x.cadenza)`));

check("v258 F&G: ogni scheda nuova dichiara di essere un componente, non un indicatore autonomo", suVeri(`
  const nuovi = indicatoriClassifica().filter(x => String(x.k).startsWith("fg:"));
  return nuovi.length > 0 && nuovi.every(x => /componente di Fear & Greed/.test(x.sub || ""))`));

/* ── v258 — la spiegazione del popup vive anche nella scheda ── */
check("v258 il contenuto del popup esce nella scheda, prosa compresa", (() => {
  const appP = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const fn = appP.slice(appP.indexOf("function contenutoDalPannello"));
  const corpo = fn.slice(0, fn.indexOf("\nfunction ", 10));
  return /<p\[\\\\s\\\\S\]\*\?<\\\/p>/.test(corpo.replace(/\\\\/g, "\\\\")) || /<p\[/.test(corpo);
})());

/* ── ⚠ v259 — I TRE DIFETTI DIAGNOSTICATI SU UNA RISPOSTA REALE ──
   Il CEO ha incollato l'output di ChatGPT sul pacchetto di AMD. Il prompt ha funzionato — la
   struttura c'era tutta — ma tre cose sono andate storte, e sono difetti del prompt, non del
   modello: (1) sei numeri decisivi marcati [VERIFICATO] con fonte "Reddit", fra cui medie
   mobili, supporti, target degli analisti e short interest; (2) tre prezzi diversi nello stesso
   documento (476, 482, "chiusura del 31/07") senza un riferimento unico; (3) una
   capitalizzazione RICAVATA da un dato di due settimane prima e presentata come [VERIFICATO]. */
check("v259 analisi titolo: la gerarchia delle fonti c'e' e i forum sono esclusi per nome", suVeri(`
  const t = buildPromptTicker("NVDA");
  return /GERARCHIA DELLE FONTI/.test(t)
      && /FONTE PRIMARIA/.test(t)
      && /NON SONO FONTI/.test(t) && /Reddit/.test(t) && /StockTwits/.test(t)`));

check("v259 analisi titolo: impone UN prezzo di riferimento con data e ora", suVeri(`
  const t = buildPromptTicker("NVDA");
  return /IL PREZZO DI RIFERIMENTO E' UNO SOLO/.test(t)
      && /valore, data e ora/.test(t)
      && /tre giorni diversi/.test(t)`));

check("v259 analisi titolo: vieta il [VERIFICATO] su un numero ricavato", suVeri(`
  const t = buildPromptTicker("NVDA");
  /* ⚠ le parentesi quadre vanno escapate DUE volte: una per la regex, una perche' il check
     vive dentro un template literal che passa per vm.runInContext. La prima stesura ne aveva
     una sola e la regex cercava una classe di caratteri invece del letterale. */
  return /NIENTE .VERIFICATO. DERIVATO/.test(t) && /.STIMA./.test(t) && /si scrive/.test(t)`));

/* ── v259 — la freschezza dei dati e' dichiarata nel payload, non solo nelle schede ── */
check("v259 payload: dichiara le tre classi di freschezza prima del quadro macro", suVeri(`
  const t = buildPrompt();
  const i = t.indexOf("FRESCHEZZA DEI DATI DI QUESTO PACCHETTO");
  const j = t.indexOf("QUADRO MACRO:");
  return i > 0 && j > i && /DATI DI MERCATO/.test(t) && /STATISTICHE UFFICIALI/.test(t)
      && /SERIE STORICHE E PERCENTILI/.test(t)`));

/* ── v259 — i due compositi che il CEO ha chiesto di togliere non rientrano da nessuna porta ── */
check("v259 nessun aggregato duplicato: ne' fra le schede ne' nel payload ne' nel disaccordo", suVeri(`
  const schede = indicatoriClassifica().map(x => x.nome.toLowerCase()).join(" | ");
  const t = buildCIOText();
  const testata = promptHeaderText();
  const dati = t.slice(t.indexOf(testata) + testata.length);
  return !/sentiment globale/.test(schede) && !/istituzionali vs retail/.test(schede)
      && !/Sentiment globale/.test(dati) && !/Istituzionali [Vv][Ss] [Rr]etail/.test(dati)`));

/* ── il wiring: nessun accesso non protetto a un elemento che non esiste ── */
{
  /* ⚠ v256 — SI TOLGONO I COMMENTI PRIMA DI LEGGERE. Alla prima stesura la guardia ha trovato
     SE STESSA: la nota che spiega il difetto v212 contiene la stringa `$("#signposts-box")`
     dentro un commento, e il gate l'ha denunciata come accesso vivo. E' la terza volta che
     succede in questo progetto (v213, v240) — un gate che legge il sorgente deve leggere il
     CODICE, non la prosa che lo racconta. */
  const src5 = readFileSync(join(ROOT, "assets", "app.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const html5 = readFileSync(join(ROOT, "index.html"), "utf8");
  const ids = new Set([...html5.matchAll(/id="([a-z0-9-]+)"/g)].map(m => m[1]));
  const nudi = [];
  for (const m of src5.matchAll(/\$\("#([a-z0-9-]+)"\)\s*\./g)) {
    const dopo = src5.slice(m.index + m[0].length - 1, m.index + m[0].length + 1);
    if (dopo.startsWith("?")) continue;                 // protetto con ?.
    if (!ids.has(m[1])) nudi.push(m[1]);
  }
  check("v256 wiring: nessun $(\"#id\") senza ?. punta a un elemento che non esiste",
    nudi.length === 0);
  if (nudi.length) console.log("  ⚠ accessi non protetti su id inesistenti:", [...new Set(nudi)].join(", "));
}

/* ── il gate di render, con la lista RICAVATA da renderAll (v253) ── */
{
  const src6 = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const corpo = (() => {
    const i = src6.indexOf("function renderAll(");
    if (i < 0) return "";
    let d = 0;
    for (let j = i; j < src6.length; j++) {
      if (src6[j] === "{") d++;
      else if (src6[j] === "}") { d--; if (d === 0) return src6.slice(i, j + 1); }
    }
    return "";
  })();
  const daRenderAll = [...new Set([...corpo.matchAll(/^\s*(?:if \([^)]*\) )?([a-zA-Z][a-zA-Z0-9_]*)\(\);/gm)].map(m => m[1]))]
    .filter(f => new RegExp(`^(?:async )?function ${f}\\b`, "m").test(src6));
  check("v256 il gate di render ricava la lista da renderAll e trova la catena vera",
    daRenderAll.length >= 5 && daRenderAll.includes("renderMacroGrafici") && daRenderAll.includes("renderCorrMacro"));

  const renderGira = (fn) => run(`
    const _d = DATA;
    DATA = JSON.parse(JSON.stringify(REALE)); recomputeTotals();
    let esito = true;
    try { ${fn}(); } catch (e) { esito = "ECCEZIONE: " + e.message; }
    DATA = _d; recomputeTotals();
    return esito;`);
  const CHIAMATE = [...new Set([...daRenderAll, "renderIndicatori", "renderCorrMacro",
                                "renderLevaStagione", "renderRotazione", "renderStress"])]
    .filter(f => new RegExp(`^(?:async )?function ${f}\\b`, "m").test(src6));
  const rotte = [];
  for (const fn of CHIAMATE) { const e = renderGira(fn); if (e !== true) rotte.push(`${fn}: ${e}`); }
  check(`v256 render: le ${CHIAMATE.length} funzioni della catena girano sui dati veri senza eccezioni`,
    rotte.length === 0);
  for (const r of rotte) console.log("  ⚠", r);
}

/* ── ⚠ v256 — NESSUNA CHIAMATA PUNTA A UNA FUNZIONE CHE NON ESISTE, IN TUTTO IL FILE ──
   Il gate di render copre la catena di renderAll. Ma il difetto vero, trovato aprendo la
   pagina, stava in `refreshLivePrices`: chiamava renderKPI/renderTable/renderWatchlist/
   renderAllocation, tolte col portafoglio — e renderAll non la chiama, quindi il gate non
   poteva vederla. `node --check` passava, i 76 check passavano, e la pagina moriva al primo
   refresh dei prezzi. E' la classe v238 per la quinta volta.
   Questa guardia non guarda una catena: guarda TUTTE le invocazioni di primo livello del file
   e verifica che il bersaglio esista. Non serve sapere quale funzione chiama quale. */
{
  const raw = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const codice = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const definite = new Set([...codice.matchAll(/^(?:async )?function ([A-Za-z0-9_$]+)/gm)].map(m => m[1]));
  for (const m of codice.matchAll(/^\s*(?:const|let|var) ([A-Za-z0-9_$]+)\s*=/gm)) definite.add(m[1]);
  /* ⚠ anche le IIFE con nome — `(function applyPrefs() { … })()` — sono definizioni: la prima
     stesura le ignorava e denunciava applyPrefs come chiamata a una funzione inesistente. */
  for (const m of codice.matchAll(/\(\s*(?:async )?function ([A-Za-z0-9_$]+)\s*\(/g)) definite.add(m[1]);
  const GLOBALI = new Set(["if","for","while","switch","catch","return","typeof","function","await",
    "new","do","else","try","Math","Number","String","Object","Array","JSON","Date","Set","Map",
    "parseInt","parseFloat","isNaN","console","fetch","setTimeout","setInterval","clearInterval",
    "clearTimeout","alert","confirm","prompt","encodeURIComponent","decodeURIComponent","Promise",
    "RegExp","Error","Boolean","Symbol","BigInt","structuredClone","queueMicrotask","requestAnimationFrame"]);
  const mancanti = new Set();
  /* ⚠ v259 — SI TOLGONO ANCHE LE STRINGHE, non solo i commenti. La guardia ha denunciato
     "copiato" come funzione inesistente: veniva da un template literal (`${che} copiato ✓`),
     dove "copiato (" e' testo per l'utente, non una chiamata. E' la quinta volta che un gate
     legge la prosa come codice. */
  const soloCodice = codice
    .replace(/`(?:[^`\\]|\\.)*`/g, "``").replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  for (const m of soloCodice.matchAll(/(?<![.\w$'"`])([a-z][A-Za-z0-9_$]{2,})\s*\(/g)) {
    const nome = m[1];
    if (GLOBALI.has(nome) || definite.has(nome)) continue;
    // solo i nomi in camelCase tipici delle funzioni di questo file, per non inseguire le API
    /* ⚠ il nome deve essere PIU' LUNGO del prefisso: "render" nudo compare solo in prosa
       ("il gate di render (v253)…") ed e' un falso positivo — la stessa classe del gate che
       trova se stesso, gia' pagata tre volte in questo progetto. */
    const PREFISSI = ["render", "build", "open", "load", "save", "push", "apply", "copia",
                      "copy", "refresh", "calc", "fetch", "testo", "correlazioni"];
    if (PREFISSI.some(pre => nome.startsWith(pre) && nome.length > pre.length)) {
      mancanti.add(nome);
    }
  }
  check("v256 nessuna chiamata nel file punta a una funzione che non esiste piu'", mancanti.size === 0);
  if (mancanti.size) console.log("  ⚠ chiamate a funzioni inesistenti:", [...mancanti].join(", "));
}

/* ── il pacchetto macro: cosa deve esserci e cosa non deve rientrare ── */
check("v256 pacchetto macro: porta il quadro macro e la rotazione", suVeri(`
  const t = buildCIOText();
  return /QUADRO MACRO/.test(t) && /ROTAZIONE SETTORIALE/.test(t) && t.length > 8000`));

check("v256 pacchetto macro: NESSUNA traccia di portafoglio, posizioni o watchlist nei DATI", suVeri(`
  const t = buildCIOText();
  const header = promptHeaderText();
  const dati = t.slice(t.indexOf(header) + header.length);   // la testata parla di se stessa
  return !/PORTAFOGLIO —|SITUAZIONE PATRIMONIALE|WATCHLIST —|MATRICE DI RISCHIO|DIARIO DELLE AZIONI|ULTIME NEWS/.test(dati)`));

check("v256 pacchetto macro: il blocco del disaccordo c'è ed è SUBITO dopo la testata", suVeri(`
  const t = buildCIOText();
  const i = t.indexOf("DOVE GLI INDICATORI MACRO NON SONO D'ACCORDO");
  return i > 0 && i < t.length * 0.45`));

check("v256 correlazione macro: misura la dispersione DENTRO i compositi, non una correlazione inventata", suVeri(`
  const c = correlazioniMacro();
  if (!c.compositi.length) return false;
  const ok = c.compositi.every(x => x.spread === x.max - x.min && x.n >= 3
                                    && x.peggiore.score <= x.migliore.score);
  const testo = testoCorrelazioniMacro();
  return ok && /Nessuna correlazione storica/.test(testo)`));

/* ── analisi spot del titolo ── */
/* ⚠ v257 — INVARIANTI RISCRITTI DOPO UN FALLIMENTO REALE. Il CEO ha incollato il pacchetto in
   Gemini e la risposta e' stata: tutti i dati su MRVL "registrati come n.d. in ottemperanza ai
   limiti imposti sull'impossibilita' di stima in assenza di accesso a feed live". Il modello ha
   usato la regola anti-invenzione come permesso per non fare niente — e la colpa e' del prompt,
   che diceva "cercali online" e subito dopo "cio' che manca si dichiara n.d.".
   I check vecchi verificavano che il pacchetto DICHIARASSE di non avere i dati. Ora verificano
   che ORDINI di cercarli, che dica DOVE, e che chiuda la scappatoia del referto tutto-n.d. */
check("v257 analisi titolo: la ricerca online e' il PASSO 0, obbligatorio e prima di tutto", suVeri(`
  const t = buildPromptTicker("nvda");
  return /PASSO 0/.test(t) && /OBBLIGATORIO/.test(t)
      && /CERCA ONLINE/.test(t) && /Non e' un'opzione/.test(t)`));

check("v257 analisi titolo: chiude la scappatoia del referto tutto-n.d.", suVeri(`
  const t = buildPromptTicker("NVDA");
  return /SE NON PUOI NAVIGARE/.test(t)
      && /FERMATI/.test(t)
      && /mai come politica generale/.test(t)`));

check("v257 analisi titolo: dice DOVE cercare, con fonti nominate e il ticker nell'URL", suVeri(`
  const t = buildPromptTicker("NVDA");
  return /DOVE CERCARE/.test(t) && /finance\\.yahoo\\.com\\/quote\\/NVDA/.test(t)
      && /stockanalysis\\.com/.test(t) && /sec\\.gov/.test(t)`));

check("v257 analisi titolo: chiede le sei consegne che il CEO ha elencato", suVeri(`
  const t = buildPromptTicker("NVDA");
  return /SCHEDA DI IDENTITA/.test(t) && /Concorrente/.test(t) && /[Qq]uota di mercato/.test(t)
      && /ULTIMA TRIMESTRALE/.test(t) && /Supporti e resistenze/.test(t)
      && /SENTIMENT/.test(t) && /ENTRARE O USCIRE/.test(t)`));

check("v257 analisi titolo: dichiara data del dato macro e prossimo aggiornamento", suVeri(`
  const t = buildPromptTicker("NVDA");
  return /Snapshot del /.test(t) && /prossimo aggiornamento atteso/.test(t)
      && /prossimo run del sistema/.test(t)`));

check("v257 analisi titolo: porta il quadro macro e il blocco del disaccordo", suVeri(`
  const t = buildPromptTicker("NVDA");
  return /ANALISI DI NVDA/.test(t) && /QUADRO MACRO/.test(t)
      && /DOVE GLI INDICATORI MACRO NON SONO D'ACCORDO/.test(t)`));

check("v256 analisi titolo: niente dimensionamenti, perché il sistema non conosce il capitale", suVeri(`
  const t = buildPromptTicker("NVDA");
  return /niente dimensionamenti/.test(t) && !/quote a limite/.test(t)`));

check("v256 analisi titolo: ticker vuoto non produce nessun pacchetto", suVeri(`
  return buildPromptTicker("") === "" && buildPromptTicker("   ") === ""`));

check("v256 analisi titolo: una sola testata nel pacchetto (quella spot), non due", suVeri(`
  const t = buildPromptTicker("NVDA");
  const h = promptHeaderText();
  return !t.includes(h)`));

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
