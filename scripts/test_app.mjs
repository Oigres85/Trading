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
/* ⚠ v279 — L'INVARIANTE E' CAMBIATO, NON E' STATO ZITTITO. Il check v247 verificava due cose:
   che il VaR NON finisse nel payload, e che la pipeline continuasse comunque a calcolarlo. Da
   v272 la pipeline non ha piu' posizioni, quindi il VaR non e' calcolabile: la seconda meta'
   non ha piu' un soggetto. La prima meta' invece VALE ANCORA ed e' quella che protegge il CEO
   — nata perche' un VaR nel pacchetto veniva usato per dimensionare operazioni su un libro che
   il sistema non deve piu' leggere. Resta quella.
   ⚠ si cerca la RIGA che generavo io, non la parola: "Expected Shortfall" compare anche nella
   TESTATA (config/prompt_header.txt), che e' il file del CEO e non si tocca. */
check("v279 VaR ed Expected Shortfall restano FUORI dal pacchetto", suVeri(`
  const p = buildPrompt();
  return !/VaR 95% a 1 giorno/.test(p) && !/Expected Shortfall 95% a 1 GIORNO/.test(p)`));
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





/* ⚠ v263 — INVARIANTE ROVESCIATO, non zittito. Il check chiedeva che i future fossero SEMPRE
   etichettati "LIVE ... anticipo pre-apertura". Trovato leggendo il pacchetto come il modello
   ricevente: nel weekend quella riga contraddiceva il CONTESTO DI SESSIONE tre righe sopra, che
   dichiara "FERMI, non anticipano nulla di nuovo". I future CME chiudono il venerdi' alle 22:00
   e riaprono la domenica alle 23:00: nel mezzo non anticipano niente.
   L'invariante che conta non e' l'etichetta fissa — e' che l'etichetta NON contraddica lo stato
   dichiarato accanto. Stessa correzione fatta in v190 sull'etichetta di Seoul, e il test deve
   asserire la PROPRIETA', non il ramo, o fallisce a orologio. */
/* ⚠ v286 — TRE STATI, NON DUE. Il check asseriva "weekend → FERMI, altrimenti → anticipo", e
   quel "altrimenti" copriva due situazioni diverse: mercato chiuso ma future vivi (li' i future
   ANTICIPANO davvero) e mercato GIA' APERTO (li' non anticipano un bel niente). Con la sessione
   aperta alle 14:20 ET il pacchetto diceva "apertura USA in gap-down attesa" mentre tre righe
   sopra dichiarava fase REGULAR: due parti dello stesso pacchetto su due momenti diversi.
   E' la classe v190/v234, e la lezione gia' scritta in CLAUDE.md dice come si chiude: il test
   asserisce la PROPRIETA' — la riga non promette un'apertura quando il mercato e' aperto — non
   il ramo, altrimenti fallisce a orologio. */
check("v263 futures: l'etichetta segue lo stato del mercato e non contraddice il contesto di sessione", suVeri(`
  const NL = String.fromCharCode(10);
  const p = buildPrompt();
  const riga = p.split(NL).find(l => /^- Futures USA/.test(l));
  if (!riga) return true;                                  // niente future nello snapshot: nulla da contraddire
  if (/WEEKEND/.test(p)) return /FERMI/.test(riga) && /NON anticipano/.test(riga);
  const apertaOra = /fase: REGULAR/.test(p) || /SESSIONE USA APERTA/.test(p);
  /* la proprieta': a mercato APERTO la riga non deve parlare di apertura attesa; a mercato
     chiuso ma future vivi deve dire che anticipano. */
  return apertaOra
    ? /LIVE/.test(riga) && !/apertura USA in gap-down attesa/.test(riga) && /GIA' APERTA/.test(riga)
    : /LIVE/.test(riga) && /anticipo/.test(riga)`));

check("v263 Fear & Greed: il payload non elenca i componenti (hanno una scheda ciascuno)", suVeri(`
  /* ⚠ niente regex complicate qui: due livelli di escape dentro un template literal passato a
     vm sono gia' costati due check in questa sessione. Si cerca la riga del QUADRO MACRO per
     una sottostringa che solo lei ha, e si guarda se elenca i componenti. */
  const NL = String.fromCharCode(10);
  const riga = buildPrompt().split(NL)
    .find(l => l.indexOf("- Fear & Greed: ") === 0 && l.indexOf("settimana fa") > 0);
  return !!riga && riga.indexOf("componenti") < 0`));


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



/* ⚠ v283 — IL CHECK v145 E' USCITO CON LA SUA FUNZIONE, ma la lezione va lasciata scritta
   perche' e' costata cara e tornerebbe identica.
   `bookReturnPct` calcolava il rendimento del libro da `gain_pct` e NON dai delta di
   `eur_value`, perche' quest'ultimo include la cassa: un versamento o un prelievo lo muove
   senza che il portafoglio abbia guadagnato o perso niente. Nel caso che il check misurava,
   -30.000 € di cassa sarebbero stati letti come -10% di performance mentre il libro faceva
   +2%. La funzione e' stata rimossa in v283 perche' il brief che la usava non esiste piu' da
   v256 (nessuna chiamata nel file), e un check senza soggetto va col soggetto.
   SE IL PORTAFOGLIO TORNASSE: il rendimento si calcola da gain_pct, mai dai delta di un
   controvalore che contiene la liquidita'. */

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
    /* ⚠ v275 — LA WATCHLIST NON E' PIU' PORTANTE PERCHE' NON C'E' PIU'. Richiesta del CEO:
       "elimina La mia watchlist che vedro' con i tempi aggiornati dal mio broker" — conseguenza
       coerente di cio' che avevamo misurato: ogni fonte gratuita ritarda di ~15 minuti sulle
       azioni americane, il suo broker no.
       ⚠ NON e' una guardia indebolita per far passare il codice: e' una guardia il cui SOGGETTO
       e' stato rimosso su decisione del CEO. La differenza si vede da cosa e' successo agli
       invarianti che valevano ancora — assenza-non-zero, blocco macro, ritardo dichiarato: non
       sono spariti, sono stati SPOSTATI su fattiTitolo e sul pacchetto. */
    'id="mg-rot"', 'id="mg-stress"', 'id="mg-leva"', 'id="mg-tutti"',   // macro in grafici
    /* v262 — 'id="corr-macro"' non e' piu' un elemento portante: il CEO ha chiesto di togliere
       quella sezione dalla pagina. L'invariante NON e' stato indebolito, e' stato SPOSTATO dove
       la cosa vive adesso — il blocco del disaccordo nel pacchetto AI, che il check v256 piu'
       sotto verifica essere presente e in alto. */
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
  /* v266 — resta UN widget solo (il grafico): la watchlist e' diventata una tabella nostra.
     L'invariante che conta e' la stessa — ogni script esterno viene dal dominio ufficiale e
     degrada in modo visibile — cambia solo quanti ce ne sono. */
  check("v266 TradingView: gli script esterni vengono SOLO da s3.tradingview.com",
    srcTV.length >= 1 && srcTV.every(u => u.startsWith("https://s3.tradingview.com/external-embedding/")));
  check("v266 TradingView: ogni widget ha un onerror che degrada in modo visibile",
    (appTV.match(/sc\.onerror\s*=/g) || []).length >= srcTV.length);
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
  }

/* ── v258 — i componenti di Fear & Greed hanno una scheda propria, senza duplicare ── */
/* ⚠ v265 — INVARIANTE ROVESCIATO. In v258 avevo promosso i sette componenti di Fear & Greed a
   schede proprie. Il CEO ne ha poi chiesta la rimozione uno per uno — "Momentum S&P 500" e
   "Domanda bond high yield" perche' duplicavano altre schede, "Forza dei prezzi" e "Domanda beni
   rifugio" per scelta sua — e di VIX, Put/Call e Ampiezza non ne erano mai nate perche' gia'
   presenti. Risultato: di quella promozione non resta niente, ed e' giusto cosi'.
   Il check ora presidia il TAGLIO e la cosa che conta davvero: che nessuna grandezza compaia
   DUE volte fra le schede, che era il difetto che il CEO ha dovuto segnalarmi due volte. */
check("v265 nessuna grandezza compare due volte fra le schede", suVeri(`
  const nomi = indicatoriClassifica().map(x => x.nome.toLowerCase());
  /* ⚠ niente regex con la barra: dentro un template literal passato a vm il "/" della classe
     put/call chiude il letterale. Si contano sottostringhe. */
  const conta = (t) => nomi.filter(n => n.indexOf(t) >= 0).length;
  return conta("vix") <= 1 && conta("put") <= 1 && conta("credito") <= 1
      && conta("curva") <= 1 && conta("momentum") <= 1 && conta("ampiezza") <= 1`));

check("v265 i componenti di Fear & Greed non sono piu' schede a se' (richiesta CEO)", suVeri(`
  return indicatoriClassifica().every(x => String(x.k).indexOf("fg:") !== 0)`));

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

/* ── ⚠ v261 — LA DATA DELLA BARRA: il ramo va ESERCITATO, non solo scritto ──
   v234 lo insegna: un ramo che non puo' essere raggiunto non e' una protezione, e' un commento
   che sembra codice. Qui il ramo "la barra e' vecchia" scatta solo nei weekend e nei festivi,
   quindi sui dati di oggi non lo si vedrebbe mai. I check lo forzano in entrambe le direzioni. */
check("v261 barra vecchia: la scheda dichiara la CHIUSURA e non spaccia il run per un dato nuovo", suVeri(`
  const vecchia = "2026-08-07";
  DATA.portfolio.forEach(r => { r.price_asof = vecchia; });
  (DATA.watchlist || []).forEach(r => { r.price_asof = vecchia; });
  const r = rigaFreschezzaMercato(DATA.macro && DATA.macro.froth);
  /* ⚠ l'apostrofo di "non e' un dato nuovo" chiude la stringa quando il check viene passato a
     vm dentro un template literal: si cerca il pezzo senza apostrofi. */
  /* ⚠ la prima stesura asseriva "2 giorni fa": e' andata rossa da sola appena la data e'
     cambiata. E' la classe v233 — un check che misura i dati del giorno invece della
     PROPRIETA'. Ora verifica che l'eta' sia dichiarata, non quale sia. */
  return /CHIUSURA DEL 07.08/.test(r) && /un dato nuovo/.test(r) && /giorn[oi] fa/.test(r)`));

check("v261 barra di oggi: NESSUN falso allarme (il ramo non scatta quando non serve)", suVeri(`
  const oggi = new Date().toISOString().slice(0, 10);
  DATA.portfolio.forEach(r => { r.price_asof = oggi; });
  (DATA.watchlist || []).forEach(r => { r.price_asof = oggi; });
  const r = rigaFreschezzaMercato(DATA.macro && DATA.macro.froth);
  return !/CHIUSURA DEL/.test(r) && /si aggiorna a ogni run/.test(r)`));

check("v261 l'asof DICHIARATO dalla pipeline vince sulla data dedotta", suVeri(`
  DATA.portfolio.forEach(r => { r.price_asof = "2026-08-09"; });
  DATA.macro.vix = Object.assign({}, DATA.macro.vix, { asof: "2026-08-06" });
  const a = asofBlocco(DATA.macro.vix);
  return a && a.data === "2026-08-06" && a.dedotta === false`));

check("v261 senza asof si deduce dalle barre dei titoli, e lo DICHIARA", suVeri(`
  DATA.portfolio.forEach(r => { r.price_asof = "2026-08-07"; });
  (DATA.watchlist || []).forEach(r => { r.price_asof = "2026-08-07"; });
  if (DATA.macro.vix) delete DATA.macro.vix.asof;
  const a = asofBlocco(DATA.macro.vix);
  const r = rigaFreschezzaMercato(DATA.macro.vix);
  return a && a.data === "2026-08-07" && a.dedotta === true && /data dedotta/.test(r)`));

check("v261 il payload dichiara la data della barra, non solo l'ora del run", suVeri(`
  DATA.portfolio.forEach(r => { r.price_asof = "2026-08-07"; });
  (DATA.watchlist || []).forEach(r => { r.price_asof = "2026-08-07"; });
  const t = buildPrompt();
  return /LA BARRA GIORNALIERA SOTTO QUEI NUMERI E' DEL 2026-08-07/.test(t)
      && /non sono prezzi di adesso/.test(t)`));

/* ── v261 — la pipeline scrive l'asof: il gate legge il SORGENTE, non i dati (il CI non ha ancora girato) ── */
{
  const py = readFileSync(join(ROOT, "scripts", "update_data.py"), "utf8");
  check("v261 pipeline: bar_asof esiste ed e' null-safe", /def bar_asof\(/.test(py) && /return None/.test(py));
  const blocchi = (py.match(/"asof": bar_asof\(/g) || []).length;
  check("v261 pipeline: l'asof e' scritto sui blocchi di mercato (vix, momentum, froth, rotazione)",
    blocchi >= 4);
  if (blocchi < 4) console.log(`  ⚠ solo ${blocchi} blocchi dichiarano l'asof`);
}

/* ── ⚠ v264 — DUE DIFETTI TROVATI LEGGENDO IL PACCHETTO DA ANALISTA ──
   Nessuno dei due era un errore di calcolo: erano due modi di presentare un numero che ne
   cambiavano il significato. Sono la classe piu' difficile da vedere rileggendo il codice,
   perche' il codice e' corretto — sbagliata e' la frase. */
check("v264 il tasso Fed non compare due volte con lo stesso nome e numeri diversi", suVeri(`
  const NL = String.fromCharCode(10);
  const righe = buildPrompt().split(NL).filter(l => l.indexOf("Fed Funds Rate") >= 0);
  /* una sola riga puo' chiamarsi "Fed Funds Rate": e' il TARGET. Il tasso effettivo ha un
     nome suo (EFFR) e dichiara di stare dentro quel target. */
  return righe.length === 1 && righe[0].indexOf("range ATTUALE") > 0`));

check("v264 il tasso effettivo si dichiara come tale e si riconcilia col target", suVeri(`
  const NL = String.fromCharCode(10);
  const riga = buildPrompt().split(NL).find(l => l.indexOf("Tasso EFFETTIVO") >= 0);
  return !!riga && riga.indexOf("DENTRO il target") > 0`));

check("v264 i campanelli sono un CONTEGGIO, non una probabilita' travestita", suVeri(`
  const NL = String.fromCharCode(10);
  const riga = buildPrompt().split(NL).find(l => l.indexOf("Signposts") >= 0);
  if (!riga) return true;
  return riga.indexOf("CONTEGGIO") > 0 && riga.indexOf("rischio ribassista") < 0`));

check("v264 i campanelli accesi sono NOMINATI (cinque sul credito non sono cinque sparsi)", suVeri(`
  const NL = String.fromCharCode(10);
  const riga = buildPrompt().split(NL).find(l => l.indexOf("Signposts") >= 0);
  const attesi = ((DATA.macro.signposts || {}).items || []).filter(x => x && x.status === true).length;
  return !riga || attesi === 0 || riga.indexOf("accesi:") > 0`));

/* ── ⚠ v265 — DUE CHIAVI UGUALI IN FORMA_INDICATORE: l'ultima vince IN SILENZIO ──
   Mi e' costato un giro due volte in due versioni (breadth in v262, froth in v265): scrivevo
   una forma nuova, la pagina mostrava ancora la vecchia, e sembrava che il codice nuovo non
   girasse. JavaScript non da' nessun errore su una chiave duplicata in un oggetto letterale.
   Il check lo trasforma in un fallimento rumoroso. */
{
  const appF = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const i0 = appF.indexOf("const FORMA_INDICATORE = {");
  let d = 0, j = i0, fine = i0;
  for (; j < appF.length; j++) {
    if (appF[j] === "{") d++;
    else if (appF[j] === "}") { d--; if (d === 0) { fine = j; break; } }
  }
  const corpo = appF.slice(i0, fine).replace(/\/\*[\s\S]*?\*\//g, "");
  const chiavi = [...corpo.matchAll(/^\s{2}("?[\w:.-]+"?):\s*\(m\)/gm)].map(m => m[1].replace(/"/g, ""));
  const dup = chiavi.filter((k, n) => chiavi.indexOf(k) !== n);
  check("v265 FORMA_INDICATORE non ha chiavi duplicate (l'ultima vincerebbe in silenzio)",
    chiavi.length > 5 && dup.length === 0);
  if (dup.length) console.log("  ⚠ chiavi duplicate:", [...new Set(dup)].join(", "));
}

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
    daRenderAll.length >= 5 && daRenderAll.includes("renderMacroGrafici"));

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

/* ⚠⚠ v293 — RIAGGANCIATO AL FATTO, NON AL TITOLO DELLA SEZIONE. Cercava "SCHEDA DI
   IDENTITA'", "ULTIMA TRIMESTRALE", "ENTRARE O USCIRE": stringhe letterali, rotte appena il
   CEO ha chiesto una struttura diversa pur essendoci ancora tutto il contenuto. E' la SESTA
   volta in questo progetto che un check ancorato a una parola si rompe su una riformulazione
   senza che manchi nulla. Ora verifica che il pacchetto CHIEDA quelle cose, comunque siano
   intitolate.
   ⚠ La scheda di identita' non c'e' piu' ed e' voluto: il CEO ha chiesto meno lunghezza, e
   nome/borsa/capitalizzazione stanno su qualunque pagina di quotazione — mentre prezzo, range
   a 52 settimane e settore il pacchetto li porta gia' come FATTI nel blocco del sistema. */
check("v257 analisi titolo: chiede le consegne che il CEO ha elencato", suVeri(`
  const t = buildPromptTicker("NVDA");
  return /Concorrente/.test(t) && /[Qq]uota di mercato/.test(t)
      && /[Tt]rimestral/.test(t) && /PROSSIMA/.test(t)
      && /Supporti e resistenze/.test(t) && /SENTIMENT/.test(t)
      && /[Ii]ngressi/.test(t) && /rischio-rendimento/.test(t)`));

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

/* ── v266 — la watchlist e' una TABELLA NOSTRA, ordinabile e cancellabile ──────────────────
   Il CEO: "sembra che i dati siano fermi ... con possibilita' di eliminarli o ordinarli
   cliccando sulle variabili delle colonne". Queste tre proprieta' sono il suo requisito. */
/* ⚠ v266 — "Massimo"/"Minimo" sono le colonne del broker: il massimo DI OGGI. Il ripiego sul
   massimo a 52 settimane metteva un numero vero sotto un'intestazione che ne promette un altro.
   Il ripiego non deve tornare, ne' qui ne' nella pipeline che i due campi li deve scrivere. */
check("v266 pipeline: scrive massimo e minimo del giorno", (() => {
  const py = readFileSync(join(ROOT, "scripts", "update_data.py"), "utf8");
  return /"day_high": round/.test(py) && /"day_low": round/.test(py);
})());

/* ⚠ v266 — IL DIFETTO "SEMBRA CHE I DATI SIANO FERMI", ALLA RADICE. La tabella si monta
   quando DATA e' ancora null e mostra trattini; se nessuno la ridisegna all'arrivo dei dati,
   i trattini restano. Finora la salvava per caso il caricamento della lista dal repo. Il
   render deve stare nella catena di renderAll, non dipendere da un giro accidentale. */
/* ⚠ v266 — LA LEGENDA DEL GRAFICO SPIEGA GLI INDICATORI, NON I BOTTONI DI TRADINGVIEW. Il
   CEO: "elimina info barra laterale (sinistra, alto e destra) mentre spiega meglio gli altri
   indicatori presenti perche' cosi non li capisco". Le voci sul cromo dell'interfaccia
   descrivevano dove si clicca — cosa che si scopre cliccando — e rubavano spazio a cio' che
   davvero non si indovina: cosa vuol dire un numero. */
check("v266 grafico: la legenda non descrive piu' la barra laterale, in alto e in basso a destra", (() => {
  const i = src.indexOf('<details class="tv-piu">');
  const fine = src.indexOf("</details>", i);
  const leg = src.slice(i, fine);
  return !/Barra laterale|Barra in alto|In basso a destra/.test(leg);
})());

check("v266 grafico: candele, volume, SMA, EMA e RSI restano spiegati", (() => {
  const i = src.indexOf('<details class="tv-piu">');
  const leg = src.slice(i, src.indexOf("</details>", i));
  return ["Candele", "Volume", "SMA blu", "EMA arancio", "RSI"].every(x => leg.includes(x));
})());

/* ⚠ v266 — la spiegazione deve dire cosa fare del numero, non solo cos'e'. Le trappole sono la
   parte che il CEO non poteva indovinare: l'RSI che non e' un segnale di vendita, la media a 9
   che e' corta, il volume che vale solo nel confronto. */
check("v266 grafico: la legenda porta le trappole, non solo le definizioni", (() => {
  const i = src.indexOf('<details class="tv-piu">');
  const leg = src.slice(i, src.indexOf("</details>", i));
  return /NON e' un segnale di acquisto o di vendita/.test(leg)
      && /media <b>corta<\/b>/.test(leg)
      && /CONFRONTO con le barre vicine/.test(leg);
})());

/* ⚠ v266 — chi disegna al montaggio deve ridisegnare all'arrivo dei dati: il montaggio precede
   sempre il fetch. Vale per la watchlist e vale per la striscia dei livelli, che ha ripetuto lo
   stesso difetto nella stessa versione. */
check("v266 grafico: la striscia dei livelli si ridisegna quando arrivano i dati", (() => {
  const i = src.indexOf("function renderAll()");
  return /renderOpzioniGrafico\(/.test(src.slice(i, src.indexOf("\nfunction ", i + 1)));
})());

/* ⚠ v266 — UNA FUSIONE VERSO UNA TESSERA ESCLUSA CANCELLAVA IL DATO. `in:curve` non si mostra
   (è già un termometro di stress, v265): fondere `in:curve3m` dentro di lei lo toglieva dalla
   lista e poi il filtro toglieva anche l'ospite. Il dato spariva del tutto, in silenzio.

   ⚠⚠ v294 — L'INVARIANTE CAMBIA, LA PROTEZIONE NO. In v294 `in:curve3m` esce dalla classifica
   di proposito, perche' la scheda "La curva dei tassi" lo mostra come pendenza accanto ai
   tenori da cui nasce. Il check com'era scritto pretendeva che restasse NELLA CLASSIFICA — cioe'
   sorvegliava il POSTO invece del FATTO, ed e' lo stesso errore che ha gia' rotto sei check in
   questo progetto. Riscriverlo per farlo tacere sarebbe il modo classico di perdere la
   protezione (v203); qui invece verifica cio' che conta davvero: che il 10A-3M sia ancora
   RAGGIUNGIBILE — in pagina o nel pacchetto. Se un domani sparisce da entrambi, si accende. */
check("v266/v294 fusioni: il 10A-3M resta raggiungibile, in pagina o nel pacchetto", suVeri(`
  const c3 = ((DATA.macro && DATA.macro.indicators) || []).find(x => x && x.key === "curve3m");
  if (!c3) return true;                                  // il dato non c'e' a monte: altro caso
  /* (a) il pacchetto lo porta comunque all'LLM */
  const nelPayload = buildPrompt().includes(String(c3.value));
  /* (b) e la scheda dei tassi lo disegna come pendenza */
  const box = { innerHTML: "" };
  const q = document.querySelector;
  let reso = "";
  try {
    document.querySelector = (sel) => sel === "#tassi-spread"
      ? { set innerHTML(v) { reso = v; }, get innerHTML() { return reso; } }
      : q.call(document, sel);
    renderTassi();
  } finally { document.querySelector = q; }
  const inPagina = /10 anni − 3 mesi/.test(reso) && reso.includes(String(c3.value));
  return nelPayload && inPagina`));

/* ⚠ v266 — IL FUSO ORARIO SPOSTAVA INDIETRO LA DATA ATTESA. Le date si costruiscono a
   mezzanotte locale, che a Roma è il giorno prima in UTC: toISOString() tornava indietro di un
   giorno e una serie giornaliera appena pubblicata usciva con "ERA ATTESO E NON È ARRIVATO". */
/* ⚠ si misura la PROPRIETA' (il prossimo cade dopo la rilevazione e non e' un sabato), non la
   distanza da oggi: un check ancorato al calendario diventa rosso da solo quando gira la data —
   errore gia' fatto in questo progetto e ripetuto scrivendo questo. */
check("v266 cadenza: il prossimo atteso di una serie giornaliera cade DOPO la rilevazione", run(`
  const c = cadenzaDato("t30", "2026-08-06");
  if (!c || !(c.prossimo > "2026-08-06")) return false;
  const g = new Date(c.prossimo + "T12:00:00").getDay();
  return g !== 0 && g !== 6`));

check("v266 cadenza: un giorno di festa non accende l'allarme dato mancante", run(`
  const ieri = new Date(); ieri.setDate(ieri.getDate() - 2);
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  const c = cadenzaDato("t30", iso(ieri));
  return !!c && !c.scaduto`));

check("v266 cadenza: le serie giornaliere hanno un calendario, non solo le mensili", (() => {
  const i = src.indexOf("const CADENZA_FONTE");
  const blocco = src.slice(i, src.indexOf("};", i));
  return ["curve:", "curve3m:", "t30:", "real10:", "breakeven:", "philly:"].every(k => blocco.includes(k));
})());

/* ⚠ v266 — un indicatore senza cadenza non deve poter partire: la regola del CEO ("ogni dato
   macro dice quando si aggiorna") vale anche per le serie che verranno aggiunte domani. */
check("v266 pipeline: un indicatore senza cadenza rompe il run invece di uscire muto", (() => {
  const py = readFileSync(join(ROOT, "scripts", "update_data.py"), "utf8");
  return /indicatori senza cadenza in NEXT_RELEASE/.test(py) && /raise RuntimeError/.test(py);
})());

/* ⚠ v266 — FRED rifiuta lo user-agent da browser: il ripiego csv era morto per TUTTE le serie
   e non si vedeva perché in CI si passa dall'API con la chiave. */
check("v266 pipeline: su FRED ci si identifica, altrimenti il ripiego csv non risponde", (() => {
  const py = readFileSync(join(ROOT, "scripts", "update_data.py"), "utf8");
  return /UA_ONESTO/.test(py) && /stlouisfed\.org.*in url|in url.*stlouisfed/.test(py);
})());

/* ── v266 — livelli e opzioni sotto il grafico (richieste del CEO) ────────────────────────── */
check("v266 grafico: i livelli del titolo stanno su UNA scala di prezzi, col prezzo dentro", (() => {
  const i = src.indexOf("function renderOpzioniGrafico");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 1));
  return /Prezzo ora/.test(corpo) && /tvo-tab/.test(corpo);
})());

/* v274 — l'invariante non e' cambiata, e' cambiata la CASA: la logica dei livelli vive in
   fattiTitolo, il punto unico da cui leggono sia la pagina sia il pacchetto. Si sposta
   l'ancoraggio, non si abbassa il controllo. */
check("v266 grafico: supporto e resistenza sono nei livelli insieme ai muri delle opzioni", (() => {
  const i = src.indexOf("function fattiTitolo");
  const corpo = src.slice(i, src.indexOf("\nfunction livelliTitolo", i));
  return /riga\.support/.test(corpo) && /riga\.resistance/.test(corpo)
      && /callWall/.test(corpo) && /putWall/.test(corpo);
})());

/* ⚠ il lato di un livello è un fatto misurabile su questo prezzo, non una proprietà del nome:
   il muro delle call di AMD stava SOTTO il prezzo e veniva dipinto come un tetto. */
check("v266 grafico: sopra o sotto il prezzo si misura, non si presume", (() => {
  const i = src.indexOf("function fattiTitolo");
  const corpo = src.slice(i, src.indexOf("\nfunction livelliTitolo", i))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return /x\.tipo = x\.v > prezzo/.test(corpo);
})());

check("v266 grafico: dentro l'iframe TradingView non si finge di disegnare", (() => {
  const i = src.indexOf("function statoOpzioni");
  const testa = src.slice(Math.max(0, i - 1400), i);
  return /iframe/.test(testa) && /non si puo'/.test(testa);
})());

/* ══ v268 — PREZZI DAL VIVO PER QUALSIASI SIMBOLO ════════════════════════════════════════
   Il CEO: "La mia watchlist come faccio ad aggiornare valori? e da dove prende questi dati?" e
   "se cambio ticker nel box ricerca la risposta e': per questo simbolo la pipeline non ha ne'
   livelli ne' opzioni". La pagina interrogava gia' Yahoo dal browser e buttava via tutto
   tranne l'ultimo prezzo. */

/* ⚠ IL DIFETTO PIU' PERICOLOSO DI QUESTO GIRO. `chartPreviousClose` non e' la chiusura di
   ieri: e' quella PRIMA della finestra richiesta. Misurato su WDC con range=5d: 544,84 (31
   luglio) invece di 451,52, cioe' -20,29% invece di -3,81%. Un numero valido, plausibile e
   sbagliato di cinque volte — nessun controllo di forma lo avrebbe preso. */
check("v268 quotazioni: la variazione usa la PENULTIMA barra, non chartPreviousClose", (() => {
  const i = src.indexOf("async function quotaLive");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 1))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return /chiusure\[chiusure\.length - 2\]/.test(corpo)
      && !/const prev = Number\(m\.chartPreviousClose/.test(corpo);
})());

/* ⚠ `Number(null)` fa ZERO, non NaN: il BTP usciva con "Massimo 0 · Minimo 0 · 0%". Uno zero
   come prezzo e' un valore che non puo' esistere, e accanto a 102,95 sembra un crollo. */
check("v268 tabella: un campo assente resta assente, non diventa zero", run(`
  return Number.isNaN(numero(null)) && Number.isNaN(numero(undefined))
      && Number.isNaN(numero("")) && numero("12.5") === 12.5 && numero(0) === 0`));
/* ⚠ chiavi duplicate nello stesso oggetto: la seconda vince in silenzio. In questo progetto
   e' gia' costato due giri (breadth v262, froth v265) e stava per costarne un terzo con
   `fonte` scritta due volte in datiSimbolo. */
/* ⚠ "Yahoo non conosce questo simbolo" e "la pipeline non lo segue" sono due cose diverse:
   BTP-V28 e' un ticker sintetico nostro e il Not Found e' la risposta CORRETTA. */
/* ── v268 — i livelli non dipendono piu' da cosa segue la pipeline ── */
check("v268 livelli: supporto e resistenza si calcolano dalle barre lette dal browser", (() => {
  const i = src.indexOf("function fattiTitolo");
  const corpo = src.slice(i, src.indexOf("\nfunction livelliTitolo", i));
  return /storia\.res20/.test(corpo) && /storia\.sup20/.test(corpo) && /storia\.max52/.test(corpo);
})());

check("v268 livelli: con meno di 20 sedute NON si inventa un supporto a 20 sedute", (() => {
  const i = src.indexOf("async function quotaLive");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 1));
  return /hi\.length >= 20 \? Math\.min/.test(corpo) && /hi\.length >= 200 \? Math\.max/.test(corpo);
})());

/* ⚠ nella vista TradingView i numeri non sono nostri: non si puo' ordinare, non si puo'
   cancellare, non si possono usare. La nota deve DIRLO invece di lasciar credere il contrario. */
/* ⚠ v268 — I PROXY GRATUITI RISPONDONO 429. Misurato durante lo sviluppo: 21 simboli al
   minuto per la watchlist PIU' quelli di livePrices sugli stessi simboli hanno esaurito la
   quota di corsproxy.io. Due giri separati per lo stesso dato erano anche due verita'
   possibili sullo stesso prezzo nella stessa pagina. */
check("v268 rete: un proxy che risponde 429 va in castigo, non si richiama subito", (() => {
  const i = src.indexOf("async function barreYahoo");
  const corpo = src.slice(i, src.indexOf("\n/* la quotazione", i));
  return /status === 429/.test(corpo) && /proxyInCastigo\.set/.test(corpo)
      && /Date\.now\(\) < fino/.test(corpo);
})());

check("v268 rete: livePrices e la watchlist condividono UNA cache, non due giri", (() => {
  const i = src.indexOf("async function livePrices");
  const corpo = src.slice(i, i + 1800);
  return /quotaLive\(/.test(corpo) && !/fetchQuote\(/.test(corpo);
})());

/* ══ v270 — IL WIDGET TRADINGVIEW DELLA WATCHLIST ════════════════════════════════════════
   Il CEO: "utilizza box tradingview embedded ma credo vada ottimizzato, controlla perche' non
   si vede bene". Non si vedeva niente per due ragioni, misurate entrambe a schermo:
     1. riceveva i ticker scritti alla Yahoo, e UN SOLO simbolo che non risolve svuota
        l'INTERO riquadro (non una riga: tutte);
     2. l'altezza era fissa a 460 e il widget non scorre, taglia: con 16-21 simboli se ne
        vedevano nove.

   ⚠⚠ IL CHECK PIU' IMPORTANTE DI QUESTO BLOCCO. Su TradingView esistono ticker con lo stesso
   nome che sono STRUMENTI COMPLETAMENTE DIVERSI, e il widget li mostra con la faccia di un
   dato buono. Verificato a schermo:
       RUT  → "RUT CHAIN DATA"                     NON e' il Russell 2000
       NQ1! → "QLD EVENING PEAK LOAD ELECTRICITY"  elettricita' australiana, NON il future Nasdaq
       SPX  → "SPACE EXPLORATION TECHNOLOGIES"     SpaceX, NON l'indice S&P 500
   Se un domani qualcuno "completa" la mappa con queste tre, il CEO si ritrova il prezzo
   dell'elettricita' australiana in watchlist sotto l'etichetta "future Nasdaq". */
/* ⚠ il CEO e' passato a questa vista PER TOGLIERE IL RITARDO, e il ritardo qui c'e' lo stesso:
   TradingView lo dichiara con una "D" accanto a ogni prezzo. Se la nota non lo dice, la vista
   mente per omissione proprio sul punto per cui e' stata scelta. */
/* ══ v271 — DIFETTI TROVATI RILEGGENDO IL PACCHETTO DI UN TITOLO ═════════════════════════
   Il CEO: "controlla infine su te stesso prompt analisi ai che ora si genera sulla base un
   ticker a tua scelta". Letto quello di NVDA riga per riga, come lo leggerebbe un analista. */

/* ⚠ IL DIFETTO PIU' UTILE. La scheda TECNICA faceva cercare online supporti, resistenze, RSI,
   ATR e medie mobili — numeri che il sistema HA GIA' e mostra sulla pagina due centimetri piu'
   su. Lo spreco e' il danno minore: quello grosso e' che l'LLM torna con numeri diversi, e il
   CEO si ritrova la pagina che dice una cosa e l'analisi un'altra sullo stesso titolo. */
check("v271 pacchetto titolo: porta i livelli che il sistema gia' conosce", run(`
  const p = buildPromptTicker("NVDA");
  const r = (DATA.watchlist || []).concat(DATA.portfolio || []).find(x => x.ticker === "NVDA");
  if (!r) return true;
  return p.includes("QUELLO CHE IL SISTEMA SA GIA'")
      && p.includes(String(r.support)) && p.includes(String(r.resistance))
      && p.includes(String(r.rsi))`));

/* ⚠ si misura la funzione che il testo lo produce, non un pacchetto che in questo harness puo'
   legittimamente non avere quel titolo: un check che dipende dai dati di prova misura i dati
   di prova, non il codice. */
check("v271 pacchetto titolo: dice cosa fare se il web diverge, invece di lasciar scegliere in silenzio", (() => {
  const i = src.indexOf("function datiNostriDelTitolo");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 1));
  return /NON scegliere in silenzio/.test(corpo) && /riporta tutti e due/.test(corpo);
})());

/* ⚠ per un titolo che la pipeline NON segue il blocco non deve esistere: inventare un
   "supporto del sistema" che il sistema non ha calcolato sarebbe la bugia peggiore. */
check("v271 pacchetto titolo: nessun blocco per un titolo che la pipeline non segue", run(`
  return !buildPromptTicker("ZZZZ-INESISTENTE").includes("QUELLO CHE IL SISTEMA SA GIA'")`));

/* ⚠ IL FALSO ALLARME DEL LUNEDI'. Il Treasury 30A rilevato venerdi' usciva lunedi' mattina
   con "ERA ATTESO E NON E' ARRIVATO": i due giorni di grazia se li mangiava il fine settimana.
   Un allarme che suona ogni lunedi' su ogni serie giornaliera insegna a ignorarlo. */
/* ⚠ v287 — RISCRITTO RELATIVO A OGGI, e l'errore era mio. La prima stesura usava le date
   FISSE 2026-08-06 e 2026-08-07 per dire "un dato di giovedi'/venerdi' non e' mancante il
   lunedi'". Quattro giorni dopo quelle date sono davvero vecchie, `scaduto` e' diventato vero
   a ragione, e il check e' andato rosso DA SOLO senza che nulla fosse rotto.
   La cosa che brucia: nel commento della v271 avevo scritto testualmente "si misura la
   PROPRIETA', non la distanza da oggi: un check ancorato al calendario diventa rosso da solo
   quando gira la data — errore gia' fatto in questo progetto e ripetuto scrivendo questo".
   L'ho scritto e l'ho rifatto nella stessa riga. Ora la data si costruisce ALL'INDIETRO da
   oggi: l'ultimo giorno lavorativo, che e' il caso che la proprieta' descrive. */
check("v271 cadenza: l'ultimo dato lavorativo non risulta 'mancante'", run(`
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")
                   + "-" + String(d.getDate()).padStart(2, "0");
  const indietroLavorativi = (n) => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    while (n > 0) { d.setDate(d.getDate() - 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
    return d;
  };
  const uno = cadenzaDato("t30", iso(indietroLavorativi(1)));
  const due = cadenzaDato("t30", iso(indietroLavorativi(2)));
  /* uno e due giorni LAVORATIVI fa sono dentro la grazia; cinque no, e il check verifica
     anche quello — altrimenti passerebbe pure una grazia infinita. */
  const cinque = cadenzaDato("t30", iso(indietroLavorativi(5)));
  return uno && due && cinque && !uno.scaduto && !due.scaduto && cinque.scaduto`));

check("v271 cadenza: la grazia si conta in giorni lavorativi", (() => {
  const i = src.indexOf("function sommaGiorniLavorativi");
  return i > 0 && /getDay\(\) !== 0 && x\.getDay\(\) !== 6/.test(src.slice(i, i + 400));
})());

/* ══ v272 — RICHIESTE DEL CEO: pre/after market, tab macro senza grafico, punti morti ═════ */

/* ⚠ LA CHIUSURA PRECEDENTE DIPENDE DAL PASSO DELLE BARRE, e sbagliarlo da' sempre un numero
   plausibile. Con barre da 5 minuti la "penultima barra" e' di cinque minuti fa: NVDA usciva
   -0,23% invece di +2,27%. Con barre giornaliere e' la chiusura di ieri, e li' va usata quella
   (v268: col range=5d chartPreviousClose era la chiusura prima dell'INTERA finestra). */
check("v272 quotazioni: intraday usa chartPreviousClose, giornaliero la penultima barra", (() => {
  const i = src.indexOf("async function quotaLive");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 1)).replace(/\/\*[\s\S]*?\*\//g, "");
  return /const prev = intraday\s*\?\s*prevMeta/.test(corpo)
      && /chiusure\[chiusure\.length - 2\]/.test(corpo);
})());

/* ⚠ con barre da 5 minuti "le ultime 20" sono un'ora e mezza: un supporto calcolato li'
   sarebbe un numero vero di un'altra grandezza. */
check("v272 livelli: non si calcolano su barre intraday", (() => {
  const i = src.indexOf("async function quotaLive");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 1));
  return /!intraday && hi\.length >= 20/.test(corpo) && /!intraday && hi\.length >= 200/.test(corpo);
})());
/* ⚠ in seduta ordinaria un "prezzo fuori orario" NON esiste: riempire la cella con l'ultimo
   prezzo normale sarebbe la solita cella che sembra un dato e non lo e'. */
/* ── v272 — le schede macro che non avevano un grafico (richiesta esplicita) ── */
check("v272 macro: le schede senza grafico hanno preso una forma", (() => {
  const i = src.indexOf("const FORMA_INDICATORE");
  const blocco = src.slice(i, src.indexOf("\n};", i));
  return ['"in:t30"', '"in:real10"', '"in:curve3m"', '"in:philly"', "fedwatch:"]
    .every(k => blocco.includes(k));
})());

/* ── v272 — punti morti del vecchio sistema nel flusso di rigenerazione ── */
check("v272 rigenera: niente passi che annunciano lavori che non si fanno piu'", (() => {
  const codice = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return !/PRICE_STAGES = \[/.test(codice) && !/Sharpe Ratio, opzioni e SMC/.test(codice)
      && !/controvalori e P&L/.test(codice);
})());

/* ⚠ v273 — il prezzo fuori orario deve stare anche NEL PACCHETTO. Metterlo in tabella e non
   qui creava una situazione peggiore di prima: il pacchetto continuava a dire all'LLM che
   "prima della campana i futures sono il dato piu' fresco", mentre la pagina aveva il prezzo
   pre-market di QUEL titolo. Il sistema sapeva una cosa e ne faceva scrivere un'altra. */
check("v273 pacchetto titolo: il prezzo pre/after entra nel pacchetto, non solo in tabella", (() => {
  /* v274 — il pre/after non si rilegge piu' da quoteLive qui dentro: arriva da fattiTitolo,
     il punto unico. La proprieta' da controllare resta che il pacchetto lo PORTI. */
  const i = src.indexOf("function datiNostriDelTitolo");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /f\.ext/.test(corpo) && /PRE-MARKET/.test(corpo) && /AFTER-HOURS/.test(corpo);
})());

/* ══ v274 — I DUE CERVELLI ADESSO NE SONO UNO ════════════════════════════════════════════
   Punto 1 della revisione che il CEO ha approvato. Pagina e pacchetto erano costruiti da
   funzioni separate che ricavavano gli stessi fatti ognuna per conto suo: aggiungere un campo
   voleva dire ricordarsene quattro volte, e me ne sono dimenticato tre volte di fila (i muri
   delle opzioni solo nella scheda, il pre-market solo in tabella).
   ⚠ QUESTO CHECK E' LA RAGIONE PER CUI IL DIFETTO NON TORNA: se un consumatore ricomincia a
   leggersi i dati da solo, qui si accende. Non misura uno stile: misura che esista UN posto
   dove la domanda "cosa sappiamo di questo titolo?" ha una risposta sola. */
check("v274 fatti: la scheda livelli e il pacchetto leggono tutti da fattiTitolo", (() => {
  const puro = (nome, finoA) => {
    const i = src.indexOf("function " + nome);
    if (i < 0) return "";
    const j = finoA ? src.indexOf(finoA, i) : src.indexOf("\nfunction ", i + 10);
    return src.slice(i, j > 0 ? j : i + 4000).replace(/\/\*[\s\S]*?\*\//g, "");
  };
  /* v275 — datiSimbolo e' uscito con la watchlist; i consumatori sono due, e la regola non
     cambia: nessuno si rifa' i conti da solo sulle fonti grezze. */
  const consumatori = ["livelliTitolo", "datiNostriDelTitolo"];
  return consumatori.every(n => {
    const c = puro(n);
    /* deve chiamare fattiTitolo e NON rifarsi i conti da solo su DATA */
    return /fattiTitolo\(/.test(c)
        && !/DATA\.portfolio/.test(c) && !/DATA\.watchlist/.test(c) && !/DATA\.options/.test(c);
  });
})());

check("v274 fatti: fattiTitolo e' l'unico che legge le fonti grezze", (() => {
  const i = src.indexOf("function fattiTitolo");
  const corpo = src.slice(i, src.indexOf("\nfunction livelliTitolo", i));
  return /DATA\.portfolio/.test(corpo) && /DATA\.watchlist/.test(corpo)
      && /quoteLive\.get/.test(corpo) && /DATA\.macro/.test(corpo);
})());

/* ⚠ v274 — PUNTO 5: un indicatore che sta al posto di un altro deve dirlo DOVE SI LEGGE.
   Il Philly Fed sostituisce l'ISM (sotto licenza) ma copre un distretto, non il paese, e
   arriva con ~40 giorni di ritardo: in classifica con lo stesso peso degli altri si legge
   come una misura nazionale, e nel pacchetto finiva in cima ai "piu' favorevoli". */
/* ⚠ v287 — la riga "i tre piu' favorevoli", dove il tag [proxy: ...] viveva nel pacchetto, e'
   uscita col verdetto aggregato. L'invariante NON cambia — il Philly Fed deve dichiararsi
   sostituto dell'ISM sia sulla scheda sia nel pacchetto — cambia DOVE lo fa: nel pacchetto ora
   lo dice la nota della serie, che e' il posto naturale e non dipende da una classifica. */
check("v274 macro: il Philly Fed si dichiara proxy sulla scheda e nel pacchetto", (() => {
  const i = src.indexOf("function indicatoriClassifica");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  const nelPacchetto = /NON è l'ISM: l'ISM è sotto licenza/.test(src);
  return /proxy: i\.key === "philly"/.test(corpo) && nelPacchetto;
})());

/* ⚠ v274 — PUNTO 3: il ritardo si dichiara dove si leggono i prezzi. Misurato: Yahoo e
   TradingView danno lo stesso numero e TradingView lo marca "D" di suo. Nessuna delle due lo
   toglie — sulle azioni USA il tempo reale costa — e questa riga esiste perche' il CEO possa
   DECIDERE, invece di cambiare fonte sperando che cambi qualcosa. */
/* v275 — la tabella e' uscita; il pacchetto resta il posto dove quel ritardo va dichiarato,
   perche' e' li' che i prezzi vengono letti da qualcuno che poi ci ragiona sopra. */
check("v275 prezzi: il ritardo e' dichiarato nel pacchetto per l'analisi", (() => {
  const j = src.indexOf("function datiNostriDelTitolo");
  const pac = src.slice(j, src.indexOf("\nfunction ", j + 10));
  return /ritardati di circa 15 minuti/.test(pac);
})());

/* ══ v275 — LA WATCHLIST E' USCITA, MA NON LE SUE LEZIONI ═══════════════════════════════
   Il CEO: "elimina La mia watchlist che vedro' con i tempi aggiornati dal mio broker".
   Venti check sono usciti col loro soggetto. Questi tre NO, perche' la proprieta' che
   proteggono vale ancora — vive solo in un altro posto, fattiTitolo. Cancellarli insieme al
   resto avrebbe buttato via difese pagate con difetti veri. */

check("v275 fatti: un simbolo che nessuno conosce lo DICHIARA invece di fingere un dato", suVeri(`
  const f = fattiTitolo("ZZZZ-INESISTENTE");
  return f.seguito === false && !Number.isFinite(f.prezzo)`));

/* ⚠ il blocco macro e' una terza stanza: VIX, future Nasdaq ed EUR/USD non stanno negli array
   dei titoli ma i loro numeri sono in `macro`. Dichiararli "non seguiti" sarebbe vero della
   struttura e falso del contenuto — e consolidando in fattiTitolo me l'ero gia' perso una
   volta, in v274: e' stato un check a riprenderlo. */
/* ⚠ `suVeri` e non `run`: questo check ha bisogno del blocco macro REALE, e con i dati stub
   fallirebbe misurando i dati di prova invece del codice — errore gia' fatto in v271. */
check("v275 fatti: VIX e future Nasdaq letti da macro, non dati per persi", suVeri(`
  const v = fattiTitolo("^VIX"), n = fattiTitolo("NQ=F");
  return v.seguito && Number.isFinite(v.prezzo) && n.seguito && Number.isFinite(n.prezzo)`));

/* ⚠ `Number(null)` fa ZERO, non NaN: il BTP usciva con "Massimo 0 · Minimo 0 · 0%". Uno zero
   come prezzo e' un valore che non puo' esistere. La tabella non c'e' piu', la trappola si'. */
check("v275 fatti: un campo assente resta assente, non diventa zero", run(`
  const saved = DATA.watchlist;
  DATA.watchlist = [{ ticker: "ZZTEST", name: "Prova", price: 100, day_high: null,
                      day_low: null, change_pct: null, volume: null }];
  const f = fattiTitolo("ZZTEST");
  DATA.watchlist = saved;
  return f.prezzo === 100 && Number.isNaN(f.giorno.alto) && Number.isNaN(f.giorno.basso)`));

/* ⚠ una rimozione A META' lascia handler che cercano nodi inesistenti e stile che pesa senza
   servire: silenziosa finche' non rompe qualcos'altro. Si controllano tutte e tre le parti. */
check("v275 watchlist: uscita da markup, codice e stile, senza residui", (() => {
  const html5 = readFileSync(join(ROOT, "index.html"), "utf8");
  const css5 = readFileSync(join(ROOT, "assets", "style.css"), "utf8");
  const codice = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const nelHtml = /wl-(tab|tv|input|salva|chips|nota|viste|aggiorna)/.test(html5);
  const nelCodice = /(leggiWatchlist|renderWatchlistTV|aggiornaQuoteWatchlist|montaWatchlistTV|applicaVistaWatchlist|agganciaWatchlist|salvaWatchlist|caricaWatchlistCloud|datiSimbolo|WL_COLONNE|TV_MAPPA|simboloWidgetTV)\s*[\(=]/.test(codice);
  const nelCss = /\.wl-(tabella|chip|viste|ext|tv|tab)\b/.test(css5);
  return !nelHtml && !nelCodice && !nelCss;
})());

/* ══ v276 — TRE DIFETTI TROVATI RILEGGENDO IL PACCHETTO DI AMD ═══════════════════════════ */

/* ⚠ I FLOAT GREZZI DI YAHOO finivano nel pacchetto: "Massimo 52 settimane: 584.72998046875",
   "Supporto: 424.0299987792969". La pagina li arrotondava disegnandoli, il pacchetto no —
   due strade e una sola che ripulisce, cioe' il difetto che v274 doveva chiudere, rimasto
   aperto un livello piu' sotto. Dodici decimali dichiarano una precisione che non esiste. */
check("v276 pacchetto: i livelli sono arrotondati alla fonte, non solo a schermo", suVeri(`
  const f = fattiTitolo("NVDA");
  const troppiDecimali = (n) => Number.isFinite(n) && String(n).split(".")[1]?.length > 4;
  return !troppiDecimali(f.prezzo) && !f.livelli.some(x => troppiDecimali(x.v))`));

/* ⚠ un prezzo senza ora non dice quanto e' fresco: se il CEO incolla alle 16:00 e l'LLM
   risponde alle 16:30, quel numero ha mezz'ora e nessuno dei due lo sa. */
check("v276 pacchetto: il prezzo di riferimento porta l'ora della lettura", (() => {
  const i = src.indexOf("function datiNostriDelTitolo");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /letto dal browser alle \$\{ora\}/.test(corpo);
})());

/* ⚠ "Fear & Greed" compariva due volte con lo stesso numero, in due blocchi. Sono
   complementari, ma la testata impone di CONTARE I SEGNALI UNA VOLTA SOLA e due righe uguali
   sono precisamente cio' che porta a contarne due. Il payload lo dichiara gia' per CPI/PCE. */
check("v276 pacchetto: il Fear & Greed doppio e' dichiarato come una misura sola", suVeri(`
  const p = buildPrompt();
  return /UNA misura guardata da due lati, non due segnali/.test(p)`));

/* ══ v280 — MATERIE PRIME E SEMICONDUTTORI COL LORO STORICO ══════════════════════════════
   Quattro richieste del CEO, una per messaggio. NON e' un ritorno indietro rispetto a v272:
   allora erano schede-NUMERO che duplicavano la watchlist, oggi la watchlist non c'e' piu' e
   quello che chiede e' la SERIE nel tempo — che il suo broker non gli mette accanto al prezzo. */
check("v280 materie: le quattro schede hanno una forma col grafico", (() => {
  const i = src.indexOf("const MATERIE = {");
  const blocco = src.slice(i, i + 2500);
  return ["sox:", "rame:", "petrolio:", "oro:"].every(k => blocco.includes(k))
      && /graficoSerie\(\[\{ nome: cfg\.titolo/.test(src);
})());

/* ⚠⚠ v302 — L'INVARIANTE CAMBIA PERCHE' IL CEO HA DECISO, NON PERCHE' IL CHECK DAVA FASTIDIO.
   Petrolio, rame e oro escono dalla PAGINA su sua richiesta. Il check pretendeva che entrassero
   in classifica: sorvegliava il POSTO. Cio' che conta e' che il FATTO non sparisca dal sistema —
   la pipeline continua a pubblicare `macro.materie` e il pacchetto continua a portarle all'LLM.
   E' la regola v208 ("si toglie dalla pagina cio' che il payload porta gia'") piu' la lezione
   v201-v204: tre volte in questo progetto una pulizia si e' portata via il fatto insieme alla
   sua ripetizione, e questo check e' cio' che lo impedisce. */
check("v302 materie: tolte dalla pagina, restano nel pacchetto", suVeri(`
  const mat = (DATA.macro && DATA.macro.materie) || {};
  const nomi = Object.keys(mat);
  if (!nomi.length) return true;
  const p = buildPrompt();
  /* nessuna delle tre ha piu' una tessera... */
  const inPagina = indicatoriClassifica().map(x => x.k);
  const fuori = ["mat:petrolio", "mat:rame", "mat:oro"].every(k => !inPagina.includes(k));
  /* ...ma i loro valori sono ancora nel pacchetto */
  const dentro = ["petrolio", "rame", "oro"].every(k => !mat[k] || p.includes(String(mat[k].value)));
  return fuori && dentro`));

/* ⚠ IL PUNTEGGIO E' POSIZIONALE, NON UN GIUDIZIO: un petrolio al 90% del suo intervallo e'
   inflazione (male), un rame al 90% e' domanda industriale (bene) — stesso numero, segni
   opposti. Metterli nella mediana del quadro d'insieme direbbe una cosa priva di senso: e' lo
   stesso errore che il Philly Fed a punteggio pieno ha reso visibile in v274. */
/* ⚠ `suVeri` e non `run`: sulla fixture non c'e' macro.indicators, quindi `quadro` e' null e
   il check moriva su `null.n` — misurando i dati di prova invece del codice. E' la stessa
   trappola gia' documentata in CLAUDE.md e ripetuta oggi per la terza volta. */
check("v280 materie: i punteggi posizionali NON votano nel quadro d'insieme", suVeri(`
  const saved = DATA.macro.materie;
  const st = (b) => Array.from({length: 40}, (_, i) => ({ d: "2026-01-01", v: b }));
  const prima = correlazioniMacro().quadro.n;
  DATA.macro.materie = { rame: { label: "Rame", value: 6.6, change_pct: 0, pct_1y: 0,
    min_1y: 4, max_1y: 7, history: st(6) } };
  const dopo = correlazioniMacro().quadro.n;
  DATA.macro.materie = saved;
  return prima === dopo`));

/* ══ v280 — IL PUT/CALL NON MOSTRA PIU' IL VECCHIO PORTAFOGLIO ═══════════════════════════
   ⚠ TERZA VOLTA che il CEO deve segnalare questa stessa cosa. In v265 avevo corretto la SCHEDA
   e dichiarato risolto guardando i DATI (`macro.putcall` e' solo SPY) invece dello SCHERMO: il
   pannello ricostruiva la tabella "PRESSIONE DI ROLLING PER TITOLO" da DATA.portfolio +
   DATA.watchlist per conto suo, e mostrava AMD, NVDA, MU, MSTR, RGTI.
   Questo check guarda l'HTML PRODOTTO, non il codice: e' l'unico modo di non ripetere l'errore
   di aver dedotto invece di guardare. */
check("v280 put/call: il pannello non costruisce piu' tabelle sui titoli del portafoglio", run(`
  const saved = DATA.portfolio;
  DATA.portfolio = [{ ticker: "ZZOLD", qty: 10, currency: "USD", price: 100, name: "Vecchio" }];
  DATA.options = Object.assign({}, DATA.options, { ZZOLD: { spot: 100, expiries: [
    { date: "2026-09-18", calls: [{ strike: 110, oi: 99, vol: 5 }], puts: [{ strike: 90, oi: 88, vol: 4 }],
      call_wall: 110, put_wall: 90, opt_volume: 9 }] } });
  const html = contenutoDalPannello("putcall", "") || "";
  DATA.portfolio = saved;
  return !/ZZOLD/.test(html) && !/PRESSIONE DI ROLLING/i.test(html)`));

/* ══ v282 — "INSERIRO' IO I DATI" DEVE ESSERE POSSIBILE ══════════════════════════════════
   Il CEO ha scelto di inserire a mano le posizioni invece di farmi ricollegare gli strumenti al
   portafoglio. Verificando che fosse fattibile ho trovato che per meta' non lo era: il
   Calcolatore PMC ha campi liberi, ma il Calcolo vendite costruiva la tabella SOLO da
   DATA.portfolio — e da v272 la pipeline non produce piu' posizioni. Stava per diventare una
   tabella vuota senza modo di metterci niente dentro: la sua frase non sarebbe stata
   eseguibile. Non e' una funzionalita' in piu', e' cio' che serve perche' la sua scelta stia
   in piedi. */
check("v282 vendite: si puo' inserire una posizione a mano, e resta salvata", run(`
  const salva = DATA.portfolio;
  DATA.portfolio = [];
  const prima = sellRows().length;
  localStorage.setItem("vendite_manuali", JSON.stringify(
    [{ ticker: "ZZAPL", name: "ZZAPL", qty: 100, pmc: 150, price: 220, currency: "USD", manuale: true }]));
  const dopo = sellRows();
  localStorage.removeItem("vendite_manuali");
  DATA.portfolio = salva;
  return prima === 0 && dopo.length === 1 && dopo[0].ticker === "ZZAPL" && dopo[0].plPerShare > 0`));

/* ⚠ la valuta decide conversione e aliquota: una riga manuale in EUR tassata al 26% invece che
   al 12,5%, o convertita quando non va convertita, falserebbe il netto. */
check("v282 vendite: la valuta di una riga manuale si deduce dal simbolo, non si presume", (() => {
  const i = src.indexOf('$("#sn-add")?.addEventListener');
  const corpo = src.slice(i, i + 1400);
  return /\.MI\$\/\.test\(tk\)/.test(corpo) && /currency: eur \? "EUR" : "USD"/.test(corpo);
})());

/* ══ v284 — I MURI SI LEGGONO DOVE STANNO I CONTRATTI ════════════════════════════════════
   Trovato rileggendo il pacchetto di AMD, come chiede il CEO di fare periodicamente.
   Il sistema usava sempre `expiries[0]`, la scadenza piu' VICINA. Su AMD quella scadeva il
   giorno dopo con 7.277 contratti aperti, mentre la successiva ne aveva 33.024 — quattro volte
   tanto. Conseguenza misurata: il muro delle call risultava a 700, cioe' +47% dal prezzo, e in
   mattinata era 460. Un livello che si sposta del 50% in poche ore senza che il mercato faccia
   niente NON e' un livello: e' rumore di una settimanale che sta morendo.
   Col muro giusto (507,5, +6,9%) l'analisi cambia di senso: prima diceva che sopra il prezzo
   non c'era resistenza dalle opzioni per quasi meta' del valore del titolo. */
check("v284 opzioni: si sceglie la scadenza con piu' contratti aperti, non la piu' vicina", run(`
  const saved = DATA.options;
  const strike = (s, oi) => ({ strike: s, oi, vol: 1 });
  DATA.options = { ZZOPT: { spot: 100, expiries: [
    { date: "2026-01-02", calls: [strike(150, 10)], puts: [strike(50, 10)], call_wall: 150, put_wall: 50 },
    { date: "2026-01-16", calls: [strike(110, 900)], puts: [strike(90, 900)], call_wall: 110, put_wall: 90 },
  ] } };
  const o = statoOpzioni("ZZOPT");
  DATA.options = saved;
  return o.scadenza === "2026-01-16" && o.callWall === 110 && o.nonLaPiuVicina === true`));

/* ⚠ e quando la scelta NON e' la piu' vicina va DETTO: "scadenza 14/08" accanto a un titolo
   che scade il 12 sembra un errore, e un numero che sembra sbagliato viene ignorato. */
check("v284 opzioni: la scheda e il pacchetto dichiarano se la scadenza non e' la piu' vicina", (() => {
  const i = src.indexOf("async function renderOpzioniGrafico");
  const scheda = src.slice(i, src.indexOf("\nfunction ", i + 10));
  const j = src.indexOf("function datiNostriDelTitolo");
  const pac = src.slice(j, src.indexOf("\nfunction ", j + 10));
  return /Non è la scadenza più vicina/.test(scheda) && /NON e' la scadenza piu' vicina/.test(pac);
})());

/* ══ v286 — TRE DIFETTI TROVATI NEL PACCHETTO CHE IL CEO MI HA INCOLLATO ═════════════════ */

/* ⚠ VOLUMI E CONTRATTI APERTI SONO DUE GRANDEZZE DIVERSE, e stavano nella stessa frase senza
   etichetta: "put 6434, call 15041" (volumi del giorno) accanto a "33024 contratti" (open
   interest). Non tornano e non devono tornare — ma chi legge prova a farli quadrare, e quando
   non ci riesce dubita di tutto il blocco. E' la classe "denominatori non dichiarati". */
check("v286 opzioni: volumi e contratti aperti sono etichettati per quello che sono", (() => {
  const i = src.indexOf("function datiNostriDelTitolo");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /volumi scambiati oggi/.test(corpo) && /CONTRATTI APERTI/.test(corpo)
      && /grandezza diversa dai volumi/.test(corpo);
})());

/* ⚠ IL CONTEGGIO NON CHIUDEVA: "26 indicatori · 10 sotto 50 e 13 sopra" lascia tre indicatori
   senza posto — quelli esattamente a 50. Un conteggio che non torna invita a dubitare del
   resto, ed e' un difetto gratuito perche' il terzo gruppo esiste ed e' calcolabile. */
check("v286 quadro d'insieme: il conteggio degli indicatori chiude", suVeri(`
  const NL = String.fromCharCode(10);
  const riga = buildPrompt().split(NL).find(l => l.indexOf("Quadro d") >= 0);
  if (!riga) return true;
  const n = riga.match(/(\d+) indicatori/);
  const giu = riga.match(/(\d+) sotto 50/);
  const su = riga.match(/(\d+) sopra/);
  const pari = riga.match(/(\d+) esattamente a 50/);
  if (!n || !giu || !su) return false;
  return +n[1] === +giu[1] + +su[1] + (pari ? +pari[1] : 0)`));

/* ══ v287 — IL SOFTWARE SMETTE DI DARE UN VERDETTO SUL QUADRO MACRO ══════════════════════
   Osservazione di ChatGPT che condivido, e che questo progetto aveva gia' applicato una volta:
   in v200 il motore di punteggio e' stato tolto perche' "ordinare e' gia' un giudizio", con un
   hit-rate del 29%. Il verdetto aggregato sul macro era la stessa cosa, sopravvissuta. */

/* ⚠ IL CHECK CHE IMPEDISCE IL RITORNO. Il pacchetto non deve piu' contare, mediare o
   classificare gli indicatori: quei punteggi 0-100 sono formule mie, e la prova che la scala
   era arbitraria e' che ho dovuto ritararla tre volte (Philly Fed v271, materie posizionali
   v280, pareggi non contati v286). Il valore, la data e la fonte di ogni indicatore restano —
   e' quello che serve all'LLM per giudicare da se'. */
check("v287 pacchetto: nessun verdetto aggregato sul quadro macro", suVeri(`
  const p = buildPrompt();
  return !/Quadro d'insieme/.test(p)
      && !/I tre piu' favorevoli/.test(p)
      && !/I tre piu' sfavorevoli/.test(p)
      && !/sotto 50 e \d+ sopra/.test(p)`));

/* ⚠ ma la DISPERSIONE dentro un composito resta, e non e' la stessa cosa: dice che una media
   nasconde componenti che vanno da 32 a 99, ed e' un fatto sul dato. Toglierla insieme al
   verdetto avrebbe buttato via l'informazione per tenere solo il rumore. */
/* ⚠ il blocco del disaccordo NON sta in buildPrompt: e' un pezzo a se' che buildPromptTicker
   e buildCIOText innestano (v156). Cercarlo nel posto sbagliato dava un rosso su codice sano. */
check("v287 pacchetto: la dispersione dentro i compositi sopravvive", suVeri(`
  const t = testoCorrelazioniMacro() || "";
  return t.indexOf("come sintesi, ma i suoi") >= 0 && t.indexOf("componenti vanno da") >= 0`));

/* ══ v287 — CALENDARIO: COSA ARRIVA, NON SOLO COSA E' USCITO ═════════════════════════════
   Il quadro macro diceva benissimo cosa e' gia' uscito e taceva su cosa sta per uscire.
   Costruito su dati che il sistema ha gia': le uscite macro dal calendario dichiarato dalle
   fonti, le trimestrali da `earnings_date`. Zero API nuove — Alpha Vantage o Finnhub avrebbero
   voluto dire una chiave in un repository PUBBLICO per dati gia' in casa. */
check("v287 calendario: unisce uscite macro e trimestrali in una finestra", suVeri(`
  const r = prossimiEventi(30);
  if (!r || !Array.isArray(r.eventi)) return false;
  const tipi = new Set(r.eventi.map(e => e.tipo));
  /* almeno un tipo dev'esserci; se ci sono entrambi, meglio — ma dipende dal mese, e un check
     che pretende entrambi diventerebbe rosso a calendario invece che a difetto. */
  return r.eventi.length > 0 && [...tipi].every(t => t === "macro" || t === "utili")`));

/* ⚠⚠ TUTTE LE DATE SONO STIME E OGNI RIGA LO DEVE DIRE. La data della prossima uscita macro e'
   una MIA proiezione dal ritardo tipico della fonte; le date delle trimestrali le cambia
   l'emittente di continuo. Presentarle come appuntamenti confermati sarebbe la classe di
   difetto peggiore di questo progetto: un dato che sembra piu' solido di quanto sia. */
check("v287 calendario: ogni evento e' marcato come stimato", suVeri(`
  const r = prossimiEventi(30);
  return r.eventi.length === 0 || r.eventi.every(e => e.stimata === true)`));

check("v287 calendario: la nota dichiara che non sono appuntamenti confermati", (() => {
  const i = src.indexOf("function renderCalendario");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /non appuntamenti confermati|stime, non appuntamenti/.test(corpo)
      && /verifica sul sito della fonte/.test(corpo);
})());

/* ⚠ nessuna chiave di API in un repository pubblico: il calendario si costruisce su dati che
   la pipeline gia' scarica. Se un domani qualcuno aggiunge Alpha Vantage o Finnhub, qui si
   accende — non perche' siano cattive fonti, ma perche' la chiave finirebbe in chiaro. */
check("v287 calendario: nessuna nuova API con chiave introdotta", (() => {
  const py = readFileSync(join(ROOT, "scripts", "update_data.py"), "utf8");
  const senza = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|#).*$/gm, "");
  const tutto = senza(src) + senza(py);
  return !/alphavantage|finnhub/i.test(tutto);
})());

/* ⚠ il primo box (grafico del titolo) non si tocca: e' lo strumento di analisi del CEO. */
/* ⚠ v298 — il "box nuovo" (contesto macro TradingView) e' stato tolto su richiesta del
   CEO. Il check non si zittisce: gli resta l'invariante che conta davvero, cioe' che il
   grafico TradingView DEL TITOLO — quello su cui si guardano i livelli — sia ancora li'. */
check("v298 TradingView: il grafico del titolo e' ancora montato", (() => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  return /id="tv-chart"|tradingview-widget-container/.test(html)
      && /function montaGraficoTV/.test(src);
})());

/* ⚠ OGNI PUNTO PORTA LA SUA DATA DI OSSERVAZIONE. Un valore senza data e' un valore di cui
   non si puo' dire quando e' vero: la settimana scorsa? stamattina? E' esattamente il modo
   in cui un dato presunto si traveste da dato. */
check("v289 tassi: ogni scadenza porta serie FRED e data di osservazione", suVeri(`
  const t = DATA.macro && DATA.macro.tassi;
  if (!t || !(t.scadenze||[]).length) return true;   // pipeline non ancora girata
  return t.scadenze.every(x => /^DGS/.test(x.series_id||"")
                            && /^\\d{4}-\\d{2}-\\d{2}$/.test(x.observation_date||""))`));

/* ⚠⚠ I BUCHI RESTANO BUCHI. Le serie giornaliere di FRED non hanno osservazioni nei giorni di
   chiusura. Riempirli con l'ultimo valore disegnerebbe un tratto piatto che nessun mercato ha
   fatto: un dato presunto travestito da dato, cioe' proprio cio' che il CEO ha escluso. */
check("v289 tassi: la pipeline non riempie i giorni senza osservazione", (() => {
  const py = readFileSync(join(ROOT, "scripts", "update_data.py"), "utf8");
  const i = py.indexOf("TASSI_FRED = [");
  if (i < 0) return false;
  /* ⚠ v298 — il confine era "if etf_lungo:", tolto con la sezione ETF: un ancoraggio
     a codice altrui invecchia appena quel codice se ne va. */
  const blocco = py.slice(i, py.indexOf("# Carry trade USA-Giappone", i));
  return !/ffill|fillna|forward.fill|interpolat|resample/i.test(blocco);
})());

/* ⚠ v298 — la curva per scadenze non c'e' piu' (il CEO ha chiesto il solo decennale), quindi
   `curvaTassi` e' uscita del tutto. L'invariante NON era "quella funzione filtra i finiti": era
   che il pannello dei tassi non stimi nulla. Ora vale sul valore in evidenza e sullo storico. */
check("v298 tassi: il pannello pubblica solo osservazioni, non stime", (() => {
  const i = src.indexOf("function renderTassi");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /Number\.isFinite/.test(corpo)
      && /Osservazioni pubblicate da/.test(corpo)
      && !/interpol|stima|previst/i.test(corpo.replace(/\/\*[\s\S]*?\*\//g, ""));
})());

/* ⚠ LA CURVA E' UNA FORMA: l'asse x sono le SCADENZE, non il tempo. La pagina aveva gia' 10A
   e 30A come due numeri separati; il fatto che aggiunge questo pannello e' come stanno FRA
   loro. Se qualcuno lo riconverte in una serie temporale, il pannello torna a dire cio' che
   la pagina diceva gia'. */
check("v289 tassi: almeno tre scadenze diverse, altrimenti non e' una curva", suVeri(`
  const t = DATA.macro && DATA.macro.tassi;
  if (!t || !(t.scadenze||[]).length) return true;
  const anni = new Set(t.scadenze.map(x => x.anni));
  return anni.size >= 3 && Math.max(...anni) >= 10 && Math.min(...anni) <= 2`));

/* ⚠ il confronto con tre mesi fa e' un'ALTRA osservazione, non una tendenza ricostruita: se
   manca, la riga deve tacere invece di stimarla. */
check("v289 tassi: il confronto a tre mesi e' un'osservazione datata, o niente", suVeri(`
  const t = DATA.macro && DATA.macro.tassi;
  if (!t || !(t.scadenze||[]).length) return true;
  return t.scadenze.every(x => x.value_3m == null
    ? x.observation_date_3m == null
    : /^\\d{4}-\\d{2}-\\d{2}$/.test(x.observation_date_3m||""))`));

/* ⚠ la pagina deve DIRE che sono osservazioni, non lasciarlo capire. E' la stessa regola per
   cui il calendario deve dire "stimata": chi legge non deve indovinare quanto e' solido un
   numero. */
check("v289 tassi: il pannello dichiara la fonte e che sono osservazioni", (() => {
  const i = src.indexOf("function renderTassi");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /Osservazioni pubblicate da/.test(corpo) && /non stime/.test(corpo);
})());

/* ⚠ LO STORICO PESA 36k CARATTERI IN data.json: se nessuno lo disegna e' peso morto spedito a
   ogni caricamento, ed e' esattamente il grasso che abbiamo tolto portando il file da 1,3M a
   647k. O si usa o si toglie dalla pipeline. */
check("v289 tassi: lo storico spedito viene davvero disegnato", (() => {
  const i = src.indexOf("function renderTassi");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /t\.storico/.test(corpo) && /graficoSerie\(/.test(corpo);
})());

/* ⚠⚠ LE SERIE VANNO ALLINEATE SULLE DATE, NON AFFIANCATE PER POSIZIONE. `graficoSerie` mappa
   l'asse x per INDICE: se il 30 anni ha un'osservazione che il 2 anni non ha, disegnarle per
   posizione sfaserebbe le curve fra loro — e il confronto fra scadenze e' tutto il punto del
   pannello. L'unione delle date con `null` dove manca il dato e' cio' che tiene onesto il
   grafico, perche' sui null la primitiva spezza la linea invece di ricucire. */
check("v289 tassi: lo storico e' allineato su un asse di date comune", (() => {
  const i = src.indexOf("function renderTassi");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /new Set\(CHI\.flatMap/.test(corpo) && /m\.has\(d\) \? m\.get\(d\) : null/.test(corpo);
})());

/* ══ v290 — CIO' CHE SI DISEGNA IN PAGINA DEVE ARRIVARE ANCHE ALL'LLM ════════════════════
   Difetto mio e ripetuto due volte: il calendario (v287) e la curva dei tassi (v289) erano
   stati costruiti, disegnati, testati — e mai messi nel pacchetto. Chi leggeva l'analisi
   generata vedeva meno di chi guardava la pagina che la genera, che e' il contrario di cio'
   che serve. Il CEO l'ha chiesto ("abbiamo tenuto conto anche nella generazione del prompt?")
   e la risposta era meta' no. Questi due cancelli fanno in modo che non si ripeta in silenzio. */
check("v290 payload: la curva dei tassi arriva all'LLM, non solo allo schermo", suVeri(`
  const p = buildPrompt();
  const t = DATA.macro && DATA.macro.tassi;
  if (!t || !(t.scadenze||[]).length) return true;
  return /CURVA DEI TASSI USA/.test(p) && /OSSERVAZIONI PUBBLICATE/.test(p)
      && t.scadenze.every(x => p.includes(x.label))`));

/* ⚠ e con la data: un tasso senza la sua rilevazione, dentro un payload, l'LLM lo legge come
   "di adesso" — e' la ragione per cui v250 ha messo la data di rilevazione su ogni statistica
   ufficiale. Qui la riga deve dire a chiare lettere che NON e' di oggi. */
check("v290 payload: la curva dichiara la data e che non e' di oggi", suVeri(`
  const p = buildPrompt();
  const t = DATA.macro && DATA.macro.tassi;
  if (!t || !(t.scadenze||[]).length) return true;
  return /quindi NON di oggi/.test(p)
      && p.includes(t.scadenze.map(x => x.observation_date).filter(Boolean).sort().pop())`));

/* ⚠⚠ PAGINA E PACCHETTO DEVONO GUARDARE LA STESSA FINESTRA. Se la pagina mostra due settimane
   e il payload una, il CEO legge un'analisi che ignora la trimestrale che vede sullo schermo —
   e non ha modo di capire perche'. Due numeri scritti in due punti diversi divergono sempre. */
check("v290 payload: il calendario usa la stessa finestra della pagina", (() => {
  const i = src.indexOf("function renderCalendario");
  const g = src.slice(i, src.indexOf("\nfunction ", i + 10)).match(/prossimiEventi\((\w+)\)/);
  const cost = src.match(/const GIORNI_CALENDARIO = (\d+)/);
  const nelPayload = src.slice(src.indexOf("function buildPrompt")).match(/prossimiEventi\((\d+)\)/);
  if (!g || !cost || !nelPayload) return false;
  return Number(nelPayload[1]) === Number(cost[1]);
})());

/* ⚠ una serie GIORNALIERA non e' un appuntamento: "Curva 10A-2A in uscita domani" e' vero e
   inutile, perche' esce ogni giorno di mercato. Tre righe cosi' annegavano l'unica utile. */
check("v290 calendario: le serie giornaliere non sono eventi", suVeri(`
  const ev = prossimiEventi(30).eventi.filter(e => e.tipo === "macro");
  return ev.every(e => e.passo !== "giornaliero")`));

/* ⚠⚠ v298 — IL METRO ERA LA TESSERA TRADINGVIEW, CHE NON C'E' PIU'. Il CEO ha tolto quel
   box, quindi il confronto non ha piu' un termine. Ma l'invariante che serviva NON era
   "uguale a loro": era che questi pannelli restino BASSI, perche' il difetto originario
   era che occupavano mezzo schermo su Safari. Si ancora al tetto in pixel veri, che e'
   la cosa che il CEO vede. E il rapporto della tela resta sorvegliato perche' un SVG con
   height:auto si scala alla larghezza: e' cosi' che in v290 ho creduto di aver ridotto
   un pannello guardando il viewBox mentre il reso era 1,8 volte piu' alto. */
check("v298 pannelli: restano bassi, e il rapporto della tela lo consente", (() => {
  const css = readFileSync(join(ROOT, "assets", "style.css"), "utf8");
  const tetto = /\.graf-tessera\s*\{[^}]*max-height:\s*(\d+)px/.exec(css);
  if (!tetto || Number(tetto[1]) > 260) return false;
  const casi = [];
  const k = src.indexOf("#tassi-serie");
  const g = src.slice(k, k + 1600).match(/graficoSerie\([^{)]*\{([^}]*)\}/);
  if (g) {
    const h = g[1].match(/h:\s*(\d+)/);
    const w = /compatto:\s*true/.test(g[1]) ? 330 : 640;
    if (h) casi.push(+h[1] / w);
  }
  /* ⚠ v298 — con la curva per scadenze rimossa resta UN solo grafico a tessera:
     pretenderne due farebbe fallire il check su una pagina corretta. */
  return casi.length >= 1 && casi.every(r => r <= 0.40);
})());

/* ⚠ e il testo deve restare leggibile DOPO lo scalamento: 9,5px su una tela da 640 dentro 595px
   rendono 8,8px; su una tela da 330 renderebbero 17px, grandi ma dentro un pannello alto il
   doppio. Il CEO ha gia' respinto tre volte una forma illeggibile: qui si misura, non si spera. */
check("v291 tessere: un tetto in pixel veri, non solo sulla tela", (() => {
  const css = readFileSync(join(ROOT, "assets", "style.css"), "utf8");
  return /\.graf-tessera\s*\{[^}]*max-height:\s*\d+px/.test(css)
      && /#mg-rot\.graf-tessera\s*\{[^}]*max-height:\s*\d+px[^}]*overflow-y:\s*auto/.test(css);
})());

/* ══ v292 — LA TRAIETTORIA DEGLI INDICATORI MACRO ════════════════════════════════════════
   Il CEO ha chiesto i dati macro "con la stessa logica del VIX" del box TradingView. Da
   TradingView non si puo': misurato in browser, i simboli ECONOMICS:* (USIRYY, USNFP, USUR,
   USGDPQQ, USCCI, USRSMM) rispondono tutti "disponibile solo su TradingView", col VIX che
   rende nella stessa pagina come controllo positivo. La forma pero' si da' con i nostri dati. */

/* ⚠⚠ L'ULTIMA PUNTA DEL GRAFICO DEVE COINCIDERE COL NUMERO IN EVIDENZA. E' l'invariante che
   conta: un grafico che finisce dove il titolo dice un'altra cosa e' peggio di nessun grafico.
   Ha gia' morso una volta — UMich veniva da FRED (49,5 di giugno) sotto un titolo di 55,2 di
   luglio preso dalla fonte primaria, perche' FRED distribuisce con 1-2 mesi di ritardo di
   LICENZA: avrebbe disegnato una DISCESA sotto un numero che dice risalita. Lo storico esce
   dalla stessa fonte del valore, sempre. */
check("v292 macro: ogni serie finisce dove il suo titolo dice", suVeri(`
  const ind = (DATA.macro && DATA.macro.indicators) || [];
  const conSerie = ind.filter(i => (i.storico || []).length > 2);
  if (!conSerie.length) return true;              // pipeline non ancora girata
  return conSerie.every(i => {
    const ultimo = i.storico[i.storico.length - 1].v;
    const titolo = parseFloat(String(i.value).replace(/[+%K]|\\s*pp/g, ""));
    if (!Number.isFinite(titolo) || !Number.isFinite(ultimo)) return true;
    const tolleranza = i.key === "nfp" ? 12 : 0.16;   // arrotondamenti di pubblicazione
    return Math.abs(ultimo - titolo) <= tolleranza;
  })`));

/* ⚠ e la serie dev'essere nella STESSA GRANDEZZA del titolo: il CPI a/a, non l'indice
   CPIAUCSL che sale da sempre per costruzione. Il controllo e' indiretto ma efficace — se
   qualcuno attaccasse l'indice grezzo, i valori sarebbero centinaia e non unita'. */
check("v292 macro: le serie sono trasformate, non indici grezzi", suVeri(`
  const ind = (DATA.macro && DATA.macro.indicators) || [];
  const perc = ind.filter(i => (i.storico || []).length > 2
                            && ["cpi","pce","retail","gdp","unemp"].includes(i.key));
  return perc.every(i => i.storico.every(p => Math.abs(p.v) < 60))`));

/* ⚠ la traiettoria vera deve avere la precedenza sulla scala convenzionale di v272: quella
   era il ripiego per le schede senza storico, e tenerla davanti vorrebbe dire preferire una
   convenzione di lettura mia a un dato osservato. */
/* ⚠⚠ v297 — LA REGOLA SI RAFFINA: la serie batte la forma SE E' DAVVERO UNA SERIE. In v292
   avevo scritto "la traiettoria vince sempre" e mancava il pavimento: una serie di QUATTRO
   punti (Fear & Greed: anno fa, mese fa, settimana fa, oggi) ha scalzato il tachimetro con le
   bande CNN, e una di 13 ha scalzato la scala del P/E. Il CEO ha chiesto il tachimetro indietro.
   Quattro punti non sono una traiettoria: sono quattro numeri con una linea in mezzo, e dicono
   meno di un quadrante che mostra in quale banda cade il valore. */
check("v297 macro: una serie batte la forma solo se e' lunga abbastanza", (() => {
  const i = src.indexOf("function renderIndicatori");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /const SERIE_MINIMA = (\d+)/.test(corpo)
      && Number(corpo.match(/const SERIE_MINIMA = (\d+)/)[1]) >= 10
      && /quanti < SERIE_MINIMA/.test(corpo);
})());

/* ⚠ e il caso concreto che il CEO ha segnalato: il Fear & Greed deve tornare un TACHIMETRO. */
check("v297 macro: Fear & Greed e' reso come tachimetro, non come linea a quattro punti", suVeri(`
  const se = serieIndicatore("fear_greed");
  const fo = (FORMA_INDICATORE["fear_greed"] || (() => null))(DATA.macro || {});
  if (!fo) return true;
  const n = se && se.punti ? se.punti.length : 0;
  /* la serie del F&G e' cortissima per costruzione: deve perdere contro la forma */
  return n < 20 && /viewBox="0 0 300 186"/.test(fo.g || "")
      && /<title>paura estrema: da 0 a 25<\\/title>/.test(fo.g || "")`));

/* ══ v293 — LA CONSEGNA CHIESTA DAL CEO, E IL SUO TETTO ══════════════════════════════════
   "mi fornisce un quadro troppo lungo": la vecchia consegna aveva sette blocchi con tabelle e
   prosa e NESSUN tetto — tremila parole per costruzione. Un budget scritto e' l'unica
   istruzione sulla lunghezza che un LLM rispetti davvero. */
check("v293 consegna: il pacchetto titolo porta un tetto di lunghezza", suVeri(`
  const p = buildPromptTicker("AMD");
  return /BUDGET: [\\d.\\-]+ parole IN TUTTO/.test(p) && /vincolo, non un'indicazione/.test(p)`));

/* ⚠ gli otto blocchi che il CEO ha elencato, nel suo ordine. Se un domani qualcuno ne toglie
   uno "per accorciare", qui si accende: la lunghezza si taglia col budget, non con i blocchi. */
check("v293 consegna: gli otto blocchi richiesti ci sono tutti e in ordine", suVeri(`
  const p = buildPromptTicker("AMD");
  const ordine = ["0) IL GIUDIZIO", "1) QUADRO MACRO", "2) L'AZIENDA", "3) TRIMESTRALI",
                  "4) I CONTI", "5) TECNICA", "6) SENTIMENT DEGLI ANALISTI", "7) LA CHIUSURA"];
  let pos = -1;
  for (const b of ordine) { const i = p.indexOf(b); if (i < 0 || i < pos) return false; pos = i; }
  return /BREVE \\(settimane\\)/.test(p) && /MEDIO \\(3-12/.test(p) && /LUNGO \\(oltre/.test(p)
      && /analista di Wall Street/.test(p)`));

/* ══ v293 — EMA E FIBONACCI LI CALCOLIAMO NOI ════════════════════════════════════════════
   Lezione v271: il sistema aveva i livelli e ne faceva cercare altri, l'LLM tornava con numeri
   diversi e il CEO si ritrovava pagina e analisi in disaccordo sullo stesso titolo. */
check("v293 tecnica: EMA e Fibonacci sono nel pacchetto, calcolati dal sistema", suVeri(`
  const p = buildPromptTicker("AMD");
  return /Medie esponenziali: EMA 20 [\\d.]+/.test(p)
      && /calcolate dal sistema su \\d+ barre giornaliere/.test(p)
      && /Ritracciamenti di Fibonacci sul range a 52 settimane/.test(p)
      && /calcolo esatto sui due estremi/.test(p)`));

/* ⚠⚠ E SI PUBBLICA SOLO CIO' CHE I DATI PERMETTONO. `sparks.m6` sono 126 barre giornaliere:
   l'EMA 200 ne vorrebbe 200. Pubblicarla lo stesso sarebbe un numero che sembra piu' solido di
   quanto e' — la classe di difetto peggiore di questo progetto. Il pacchetto deve DICHIARARE
   perche' manca, non ometterla in silenzio. */
check("v293 tecnica: l'EMA 200 non si pubblica, e si dice perche'", suVeri(`
  const p = buildPromptTicker("AMD");
  if (!/Medie esponenziali/.test(p)) return true;
  return /EMA 200 NON calcolata/.test(p) && /servirebbero 200 barre giornaliere/.test(p)
      && !/EMA 200 [\\d]/.test(p)`));

/* ⚠ Fibonacci e' aritmetica esatta, non una stima: il livello 50% dev'essere esattamente il
   punto medio fra massimo e minimo a 52 settimane. Se un domani qualcuno "arrotonda" o cambia
   il verso del conteggio, il numero smette di essere quello che la convenzione indica. */
check("v293 tecnica: i livelli di Fibonacci tornano col range dichiarato", suVeri(`
  const p = buildPromptTicker("AMD");
  const m = p.match(/Fibonacci sul range a 52 settimane \\(massimo ([\\d.]+), minimo ([\\d.]+)\\): ([^\\n]+)/);
  if (!m) return true;
  const hi = parseFloat(m[1]), lo = parseFloat(m[2]);
  const meta = m[3].match(/50% a ([\\d.]+)/);
  if (!meta) return false;
  return Math.abs(parseFloat(meta[1]) - (hi - 0.5 * (hi - lo))) < 0.02`));

/* ⚠⚠ I DOPPIONI TOLTI DALLA PAGINA DEVONO RESTARE NEL PACCHETTO. E' la regola v208 — "si toglie
   dalla pagina cio' che il payload porta gia'" — e senza questo check un domani qualcuno
   toglierebbe l'indicatore anche a monte credendo di completare la pulizia, facendo sparire il
   fatto dal sistema invece che dallo schermo. E' successo tre volte in questo progetto. */
check("v294 doppioni: cio' che esce dalla pagina resta nel pacchetto", suVeri(`
  const ind = (DATA.macro && DATA.macro.indicators) || [];
  const p = buildPrompt();
  for (const k of ["t30", "curve3m"]) {
    const x = ind.find(y => y && y.key === k);
    if (x && !p.includes(String(x.value))) return false;
  }
  return true`));

/* ══ v295 — DUE SERIE UGUALI IN DUE POSTI: IL DIFETTO CHE HO INTRODOTTO IO ═══════════════
   Trovato nella revisione che il CEO ha chiesto ("cosa c'e' da aggiustare, eliminare"). In
   v292 ho dato uno storico a tutti e 13 gli indicatori senza cercare se il file ce l'avesse
   gia': per due ce l'aveva.
   · 10A-2A → `macro.curve_history` (501 punti), che `serieIndicatore` legge da un `case`
     dedicato. Il mio storico non veniva NEMMENO DISEGNATO: peso morto puro, spedito a ogni
     caricamento.
   · 30 anni → `macro.tassi.storico.a30` (369 punti), messo li' da v289 — cioe' da me, tre
     versioni prima.
   Erano ~27KB. Ma il peso e' il danno minore: due copie della stessa serie DIVERGONO appena
   una delle due fonti cambia finestra o fornitore, e a quel punto la pagina mostra due valori
   per la stessa grandezza — la classe che `coherence_check` insegue da sempre.
   ⚠ REGOLA: prima di aggiungere una serie, cercare se il file ce l'ha gia'. */
check("v295 dati: nessun indicatore duplica una serie che il file ha gia'", suVeri(`
  const m = DATA.macro || {};
  const coda = (a, n) => (a || []).slice(-n).map(p => (p && p.v != null) ? p.v : p);
  const gia = [];
  if ((m.curve_history || []).length) gia.push(["macro.curve_history", m.curve_history]);
  for (const [k, v] of Object.entries((m.tassi && m.tassi.storico) || {})) gia.push(["macro.tassi.storico." + k, v]);
  for (const i of (m.indicators || [])) {
    const st = i && i.storico;
    if (!st || st.length < 20) continue;
    for (const [nome, altra] of gia) {
      const n = Math.min(st.length, altra.length, 60);
      if (n >= 20 && JSON.stringify(coda(st, n)) === JSON.stringify(coda(altra, n))) return false;
    }
  }
  return true`));

/* ⚠ e l'etichetta della scala non deve piu' parlare di un "libro": v256 ha tolto il
   portafoglio, e nel file resta un BTP. "100 = favorevole al libro" rivendicava un confronto
   con un portafoglio che non esiste — un'etichetta che afferma piu' di quanto il sistema
   sappia, la classe v240 (una zona nominata e' un'affermazione). */
check("v295 etichette: la scala non parla di un portafoglio che non c'e' piu'", (() => {
  const senzaCommenti = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return !/favorevole al libro|sfavorevole al libro/.test(senzaCommenti);
})());

/* ══ v296 — LA TESI CONTRARIA ════════════════════════════════════════════════════════════
   Presa da TauricResearch/TradingAgents, che il CEO mi ha chiesto di analizzare: di quel
   framework l'unica idea che vale e' il ricercatore rialzista contro quello ribassista prima
   che qualcuno decida. Presa come STRUTTURA DI PROMPT, non come sistema: zero infrastruttura,
   dentro il flusso a un incollaggio. Del resto — agenti autonomi, borsa simulata, sentiment
   dai forum — non prendo niente, e i forum sono gia' vietati da questa testata dopo che un LLM
   marco' [VERIFICATO] medie mobili con fonte Reddit. */
check("v296 contraddittorio: il pacchetto chiede la tesi opposta, e la chiede per ultima", suVeri(`
  const p = buildPromptTicker("AMD");
  const i8 = p.indexOf("8) LA TESI CONTRARIA");
  const i7 = p.indexOf("7) LA CHIUSURA");
  const i0 = p.indexOf("0) IL GIUDIZIO");
  /* dopo la conclusione, non dopo il giudizio: per attaccare una tesi bisogna averla prima
     argomentata con le prove, altrimenti e' teatro. */
  return i8 > i7 && i7 > i0 && /obbligatoria/.test(p)`));

/* ⚠⚠ I TRE VINCOLI CHE LO RENDONO UN CONTRADDITTORIO INVECE DI UN PARAGRAFO DI CORTESIA. Senza
   di questi un modello scrive "d'altra parte i rischi non mancano" e passa oltre: (a) i numeri
   devono essere QUESTI, (b) deve scegliere, (c) deve nominare un fatto osservabile e datato che
   deciderebbe la disputa. Il terzo si aggancia al calendario che il pacchetto porta da v290. */
check("v296 contraddittorio: obbliga ai numeri del pacchetto, a scegliere, e a un fatto datato", suVeri(`
  const p = buildPromptTicker("AMD");
  const i = p.indexOf("8) LA TESI CONTRARIA");
  const b = p.slice(i, p.indexOf("══ REGOLE ══", i));
  return /NUMERI DI QUESTO PACCHETTO/.test(b)
      && /non obiezioni generiche/.test(b)
      && /QUALE FATTO OSSERVABILE E DATATO/.test(b)
      && /Non ti e' consentito rispondere che entrambe le tesi hanno merito/.test(b)`));

/* ⚠ v298 — la lista NON si congela: era scritta a mano e sarebbe invecchiata alla prima
   sezione aggiunta o tolta (e ne ho tolte due in questo stesso commit). Si rilegge da
   index.html a ogni esecuzione: il registro fisso che invecchia da solo e' la classe
   C10 / red team I6, gia' pagata piu' volte qui. */
const SEZIONI_DI_INDEX = [...readFileSync(join(ROOT, "index.html"), "utf8")
  .matchAll(/<section class="card"[^>]*data-sez="([^"]+)"([^>]*)>/g)]
  .map(m => ({ sez: m[1], pane: (m[2].match(/data-pane="([^"]+)"/) || [])[1] || null,
               /* ⚠ v301 — il finto DOM deve modellare ANCHE `data-fissa`, altrimenti il check
                  conta dieci sezioni dove la funzione ne trova nove ed e' cieco al filtro nuovo.
                  Un check che non modella la realta' che sorveglia non e' un check. */
               fissa: /data-fissa/.test(m[2]) }));

/* ══ v297 — IL TRASCINAMENTO DELLE SEZIONI ERA MORTO DA QUARANTA VERSIONI ════════════════
   Segnalato dal CEO: "non riesco piu' ad ordinare i box". `sezioniDelPane` filtrava su
   `[data-pane="${pane}"]` mentre `data-pane` non esiste piu' nel markup da v256: lista vuota,
   `iniziaTrascinamento` usciva sulla guardia `length < 2`, e nessun errore da nessuna parte.
   Le maniglie erano montate, visibili e cliccabili: il guasto era invisibile a ogni controllo.
   ⚠⚠ IL CHECK DEV'ESSERE COMPORTAMENTALE. Uno che cercasse "data-pane" nel sorgente sarebbe
   passato benissimo mentre la funzione restituiva zero — la differenza fra guardare il codice
   ed ESEGUIRLO, che qui e' gia' costata la pagina morta di v238 con 219 test verdi. */
check("v297 riordino: sezioniDelPane trova davvero le sezioni di index.html", suVeri(`
  const sezioni = ${JSON.stringify(SEZIONI_DI_INDEX)};
  const finte = sezioni.map(x => ({
    dataset: { sez: x.sez, pane: x.pane || undefined },
    matches: (sel) => {
      if (sel.indexOf(":not([data-fissa])") >= 0 && x.fissa) return false;
      return sel.indexOf(":not([data-pane])") >= 0 ? !x.pane : !!x.pane;
    },
  }));
  const q = document.querySelector;
  let trovate = [];
  try {
    document.querySelector = (sel) => sel === ".shell-main" ? { children: finte } : q.call(document, sel);
    trovate = sezioniDelPane(undefined);
  } finally { document.querySelector = q; }
  /* la guardia che spegneva tutto era \`ordine.length < 2\`: qui devono esserci tutte */
  return trovate.length === sezioni.length && trovate.length >= 2`));

/* ⚠ e la chiave salvata dev'essere leggibile: senza pane finiva la stringa "undefined" dentro
   config/ui_order.json — funzionante e incomprensibile a chi apre il file. */
check("v297 riordino: la chiave dell'ordine non e' la stringa 'undefined'", (() => {
  const i = src.indexOf("function salvaOrdineSezioni");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /senzaPane\(pane\) \? PANE_UNICO : pane/.test(corpo);
})());

/* ⚠⚠ v298 — GLI SPREAD DEVONO SOPRAVVIVERE ALLA RIDUZIONE AL SOLO DECENNALE. Sembrano
   "altri tenori" e la tentazione di toglierli insieme agli altri e' forte, ma sono grandezze
   proprie pubblicate da FRED (T10Y2Y, T10Y3M) e parlano del decennale: quanto rende rispetto
   al breve. Toglierli farebbe sparire il 10A-3M dalla pagina, dove e' arrivato in v294 proprio
   togliendo la sua tessera doppia — la pulizia che si porta via il fatto, classe v201-v204,
   gia' costata tre volte qui. */
check("v298 tassi: la riduzione al decennale non porta via gli spread", (() => {
  const i = src.indexOf("function renderTassi");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /#tassi-spread/.test(corpo) && /10 anni − 2 anni/.test(corpo) && /10 anni − 3 mesi/.test(corpo);
})());

/* ══ v298 — LE PRIME CINQUE DEL COMPARTO AL PASSAGGIO DEL MOUSE ══════════════════════════
   Richiesta del CEO. Sono le PARTECIPAZIONI VERE dell'ETF col loro peso, prese dal fornitore,
   non un elenco scritto a mano: un registro di titoli compilato da me invecchierebbe alla prima
   ribilanciata del fondo — classe C10 / red team I6, gia' pagata piu' volte qui.
   ⚠⚠ NOTA DI METODO, dopo esserci ricascato quattro volte in una sessione: dentro un template
   literal `\d` collassa in "d" e `\n` diventa un a capo vero, quindi ogni regex scritta qui
   dentro va con la barra doppia. La correzione vera non e' ricordarselo — e' NON USARE REGEX
   qui dentro: `includes` e `indexOf` non hanno escape e dicono la stessa cosa. */
check("v298 rotazione: il tooltip porta le prime del comparto, coi pesi", suVeri(`
  const tilt = (DATA.macro && DATA.macro.tilt) || [];
  const conPrime = tilt.filter(t => (t.prime || []).length);
  if (!conPrime.length) return true;                  // pipeline non ancora girata
  const q = document.querySelector;
  let reso = "";
  try {
    document.querySelector = (sel) => sel === "#mg-rot"
      ? { set innerHTML(v) { reso = v; }, get innerHTML() { return reso; },
          querySelectorAll: () => [], classList: { add() {}, remove() {} } }
      : q.call(document, sel);
    renderRotazione();
  } finally { document.querySelector = q; }
  /* ogni ETF che HA le partecipazioni dev'essere coperto, col suo ticker nel testo */
  return conPrime.every(t => reso.includes('title="Prime ' + t.prime.length + " di " + t.ticker + ':'))`));

/* ⚠⚠ E DOVE IL FORNITORE NON LE DA', IL TOOLTIP TACE. Alla prova mancavano su 1 ETF su 21:
   mostrare una riga vuota, o peggio nomi vecchi presentati come attuali, sarebbe la classe di
   difetto peggiore di questo progetto — un dato che sembra piu' solido di quanto e'. */
check("v298 rotazione: senza partecipazioni il tooltip non compare", (() => {
  const i = src.indexOf("function renderRotazione");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  const j = src.indexOf("function barreOrdinate");
  const barre = src.slice(j, src.indexOf("\nfunction ", j + 10));
  /* il ramo senza partecipazioni produce stringa vuota, e la barra omette l'attributo */
  return corpo.includes(': ""') && barre.includes("x.suggerimento ?");
})());

/* ══ v299 — I QUATTRO PUNTI DELLA REVISIONE A CINQUE TESTE ═══════════════════════════════ */

/* ⚠⚠ FONDAMENTALI CHE AVEVAMO E FACEVAMO CERCARE. Il pacchetto diceva "cerca online i
   fondamentali" mentre EPS, beta e forza relativa erano gia' in data.json: e' il difetto v271
   (il sistema tiene un numero e ne fa cercare un altro) applicato ai conti invece che ai
   livelli. L'EPS in particolare — v185 lo rimise nel payload perche' col solo P/E non si
   distingue una societa' cara da una in perdita, e su AMD davamo P/E 123,4x senza il 4,17. */
check("v299 pacchetto titolo: porta i fondamentali che il sistema gia' possiede", suVeri(`
  const p = buildPromptTicker("AMD");
  const r = [...(DATA.portfolio||[]), ...(DATA.watchlist||[])].find(x => x.ticker === "AMD");
  if (!r) return true;
  const c = [];
  if (r.eps != null) c.push("Utile per azione (EPS");
  if (r.beta != null) c.push("Beta: " + r.beta);
  if (r.rs_1m != null) c.push("Forza relativa a 1 mese");
  if (r.risk_reward) c.push(r.risk_reward);
  return c.every(x => p.includes(x))`));

/* ⚠ ma NON i punteggi compositi: `fin_health` e `health` sono giudizi 0-100 travestiti da
   dati, ed e' esattamente cio' che v200 ha tolto dal pacchetto misurando un hit-rate del 29%.
   I fatti si', i voti no — anche quando sono comodi. */
check("v299 pacchetto titolo: nessun punteggio composito rientra dalla finestra", suVeri(`
  const p = buildPromptTicker("AMD");
  return !p.includes("fin_health") && !p.includes("Financial Health")
      && !p.includes("Salute finanziaria")`));

/* ⚠⚠ IL BLOCCO "COSA NON SO". Dei nove blocchi che il prompt chiede, solo due si rispondono
   coi dati del pacchetto: il resto viene dalla rete, e un modello che non trova il consenso
   analisti se lo inventa in silenzio. La dichiarazione di fallimento e' OBBLIGATORIA perche'
   un buco dichiarato si vede e un numero inventato no. */
check("v299 pacchetto titolo: elenca cosa non ha e obbliga a dichiarare i buchi", suVeri(`
  const p = buildPromptTicker("AMD");
  return p.includes("QUELLO CHE IL SISTEMA NON HA")
      && p.includes("NON VERIFICATO:")
      && p.includes("Un numero plausibile inventato e' peggio di un buco dichiarato")`));

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
