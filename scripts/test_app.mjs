#!/usr/bin/env node
/* Test harness per le funzioni PURE di assets/app.js (motore decisionale, risk, prompt).
   app.js è pensato per il browser: qui gira in un contesto Node (vm) con un DOM-stub
   minimale — niente rendering, si testano SOLO calcoli e generazione del prompt.
   Uso: node scripts/test_app.mjs  (exit 1 se un check fallisce) */
import { readFileSync, existsSync } from "node:fs";
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
  const p = Number((d.text.match(/percentile (\\d+)°/) || [])[1]);
  return Number.isFinite(p) && p <= 5 && d.text.includes("compressione estrema")`));


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
    /* ⚠⚠ v303 — TRE CONTENITORI NON SONO PIU' PORTANTI PERCHE' LE LORO SEZIONI SONO STATE FUSE,
       su richiesta del CEO ("sposta gli indicatori da Termometri di stress / Rotazione / Leva e
       stagionalita' / La curva dei tassi in Tutti gli indicatori").
       ⚠ NON e' una guardia indebolita per far passare il codice, e la differenza si vede da cosa
       e' successo agli invarianti che valevano ancora: i tre termometri e la stagionalita' sono
       TESSERE dentro `#mg-tutti`, rotazione e tassi sono due forme in FORMA_INDICATORE, e i loro
       fatti restano nel pacchetto — tutti e tre verificati dai check piu' sotto. Quando sparisce
       un SOGGETTO si sposta l'invariante; quando sparisce l'INVARIANTE si perde la protezione,
       ed e' la lezione v203. */
    'id="mg-tutti"',                                             // la classifica, ora unica
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
  /* ⚠ v303 — il pavimento era `>= 6` e dopo le fusioni le sezioni sono cinque. Un fondo
     NUMERICO invecchia da solo: e' cio' che v208 ha gia' corretto su SORT_FIELDS ("la sanita'
     e' una PROPRIETA', non un conteggio"). L'invariante vero e' che ogni sezione abbia una
     chiave e che siano tutte distinte, non quante siano. */
  check("v256 ogni sezione ha una chiave data-sez, tutte distinte",
    sez.length >= 2 && new Set(sez).size === sez.length);
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

/* ══ v329 — "5/10 ACCESI" NON ERA UN CONTEGGIO, ERA UN PAVIMENTO ══════════════════════════
   Solo QUATTRO delle dieci voci si calcolano da una fonte, e oggi sono tutte e quattro SPENTE;
   le altre sei sono costanti di baseline, di cui cinque accese. Il numero pubblicato non poteva
   scendere sotto cinque qualunque cosa facesse il mercato, e la riga lo chiamava "CONTEGGIO" —
   cioe' dichiarava misura una cosa che per meta' e' un'assunzione. Il vecchio check pretendeva
   proprio quella parola: chiedeva al sistema di continuare a dirlo.
   ⚠ L'invariante nuovo e' piu' forte: la riga deve separare cio' che e' MISURATO da cio' che e'
   ASSUNTO, e dove la pipeline non ha ancora marcato le voci deve DICHIARARE il limite invece di
   presentare un conteggio. */
check("v329 campanelli: la riga separa le voci misurate da quelle assunte", suVeri(`
  const NL = String.fromCharCode(10);
  const riga = buildPrompt().split(NL).find(l => l.indexOf("Signposts") >= 0);
  if (!riga) return true;
  const sp = DATA.macro.signposts || {};
  if (sp.calcolabili != null) {
    /* pipeline aggiornata: si pubblica il conteggio sulle CALCOLABILI e si nominano le costanti */
    return riga.includes("su " + sp.calcolabili + " CALCOLABILI")
        && riga.includes("COSTANTI di riferimento, non misure")
        && /non e' un conteggio/i.test(riga);
  }
  /* pipeline non ancora aggiornata: il limite va DICHIARATO, non nascosto dietro la parola conteggio */
  return riga.includes("NON e' un conteggio di misure")
      && riga.includes("LIMITE SUPERIORE");`));

check("v329 campanelli: le voci accese restano NOMINATE", suVeri(`
  const NL = String.fromCharCode(10);
  const riga = buildPrompt().split(NL).find(l => l.indexOf("Signposts") >= 0);
  const attesi = ((DATA.macro.signposts || {}).items || []).filter(x => x && x.status === true).length;
  return !riga || attesi === 0 || riga.indexOf("—") > 0`));

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

/* ⚠⚠ v337 — QUESTI DUE CHECK HANNO CAMBIATO INVARIANTE, non sono stati tolti.
   Fino alla v336 sorvegliavano che il blocco "DOVE GLI INDICATORI MACRO NON SONO D'ACCORDO"
   FOSSE nel pacchetto. Il CEO l'ha tolto insieme alla scala 0-100 su cui era costruito
   ("Via da tutto, schede e prompt"), quindi il vecchio invariante e' diventato falso per
   decisione, non per difetto — e riscriverlo per farlo tacere sarebbe stato il modo classico
   di perdere la protezione (v203). Ora sorvegliano il fatto NUOVO: che il punteggio non torni.
   ⚠ Serve davvero: in v200 il verdetto del motore fu tolto e l'ORDINAMENTO per punteggio
   sopravvisse fino alla v228, cioe' 28 versioni. Un giudizio rimosso rientra dai bordi. */
check("v337 il pacchetto macro non porta piu' il blocco del disaccordo", suVeri(`
  return !/DOVE GLI INDICATORI MACRO NON SONO D'ACCORDO/.test(buildCIOText())`));


/* ── analisi spot del titolo ── */
/* ⚠ v257 — INVARIANTI RISCRITTI DOPO UN FALLIMENTO REALE. Il CEO ha incollato il pacchetto in
   Gemini e la risposta e' stata: tutti i dati su MRVL "registrati come n.d. in ottemperanza ai
   limiti imposti sull'impossibilita' di stima in assenza di accesso a feed live". Il modello ha
   usato la regola anti-invenzione come permesso per non fare niente — e la colpa e' del prompt,
   che diceva "cercali online" e subito dopo "cio' che manca si dichiara n.d.".
   I check vecchi verificavano che il pacchetto DICHIARASSE di non avere i dati. Ora verificano
   che ORDINI di cercarli, che dica DOVE, e che chiuda la scappatoia del referto tutto-n.d. */



/* ⚠⚠ v293 — RIAGGANCIATO AL FATTO, NON AL TITOLO DELLA SEZIONE. Cercava "SCHEDA DI
   IDENTITA'", "ULTIMA TRIMESTRALE", "ENTRARE O USCIRE": stringhe letterali, rotte appena il
   CEO ha chiesto una struttura diversa pur essendoci ancora tutto il contenuto. E' la SESTA
   volta in questo progetto che un check ancorato a una parola si rompe su una riformulazione
   senza che manchi nulla. Ora verifica che il pacchetto CHIEDA quelle cose, comunque siano
   intitolate.
   ⚠ La scheda di identita' non c'e' piu' ed e' voluto: il CEO ha chiesto meno lunghezza, e
   nome/borsa/capitalizzazione stanno su qualunque pagina di quotazione — mentre prezzo, range
   a 52 settimane e settore il pacchetto li porta gia' come FATTI nel blocco del sistema. */


/* v337 — il terzo requisito (il blocco del disaccordo) e' caduto col punteggio 0-100. I due
   che restano sono quelli che dicono la cosa vera: il pacchetto del titolo PORTA DENTRO il
   quadro macro, che e' la ragione per cui non esistono due bottoni separati (v259). */

/* ⚠⚠ v308 — L'INVARIANTE E' IL DIVIETO, NON LA FRASE. Il check cercava le parole "niente
   dimensionamenti", che nascevano da "non conosco la tua posizione". Dalla v307 il sistema LA
   CONOSCE, e continuare a dichiarare il contrario era la peggiore forma di incoerenza: su AMD
   significava proporre un ingresso a 514 a chi ha carico 153,92 e un +234% aperto.
   Cio' che NON deve cambiare e' il divieto di dimensionare — e la ragione ora e' piu' precisa:
   non "non so cosa possiedi" ma "non conosco liquidita' ne' situazione fiscale, e un
   dimensionamento senza quei due dati e' un numero che sembra un consiglio". */

/* ⚠ e quando il titolo E' in portafoglio il pacchetto deve dirlo, col carico: e' il fatto che
   distingue una decisione di mantenimento da una di ingresso. Quando NON lo e', non deve
   inventarselo. */



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

/* ⚠⚠ v317 — L'INVARIANTE E' CAMBIATO, NON E' STATO ZITTITO. Il CEO ha chiesto di togliere i
   blocchi che spiegavano il funzionamento del grafico (i numeri in alto a sinistra, com'e' fatta
   una candela, cos'e' il volume): erano istruzioni per l'uso, non analisi, e chi guarda il
   grafico le ha gia' davanti. Cio' che deve restare vero e' piu' forte di prima: medie, RSI e
   volume ci sono ancora, ma AGGANCIATI AI VALORI DI QUESTO TITOLO, non spiegati in astratto.
   Riscrivere una guardia per farla tacere e' il modo classico di perdere la protezione (v203):
   qui la guardia chiede di piu', non di meno. */
check("v317 analisi tecnica: medie, RSI e volume sono agganciati ai valori del titolo", (() => {
  const i = src.indexOf("v317 — DALLA LEGENDA GENERICA");
  const sez = src.slice(i, src.indexOf("tv-piede", i));
  return /Analisi tecnica( e livelli)? —/.test(sez)
      && sez.includes("tec.medie_battute") && sez.includes("o.rsi14") && sez.includes("vol_ratio")
      && sez.includes('rigaMedia("sma50"') && sez.includes('rigaMedia("sma200"')
      && !sez.includes("I numeri in alto a sinistra") && !sez.includes("<b>Candele</b>");
})());

/* ⚠ v266 — la spiegazione deve dire cosa fare del numero, non solo cos'e'. Le trappole sono la
   parte che il CEO non poteva indovinare: l'RSI che non e' un segnale di vendita, la media a 9
   che e' corta, il volume che vale solo nel confronto. */
check("v317 analisi tecnica: porta le trappole, non solo i numeri", (() => {
  const i = src.indexOf("v317 — DALLA LEGENDA GENERICA");
  const leg = src.slice(i, src.indexOf("tv-piede", i));
  return leg.includes("Non e' un segnale di vendita")
      && leg.includes("il prezzo fa un nuovo massimo e l'RSI no")
      /* e i VALORI devono restare tutti, anche dove la prosa e' stata tolta */
      && leg.includes("vol_ratio") && leg.includes("o.adx14");
})());

/* ⚠ v266 — chi disegna al montaggio deve ridisegnare all'arrivo dei dati: il montaggio precede
   sempre il fetch. Vale per la watchlist e vale per la striscia dei livelli, che ha ripetuto lo
   stesso difetto nella stessa versione. */
check("v266 grafico: la striscia dei livelli si ridisegna quando arrivano i dati", (() => {
  const i = src.indexOf("function renderAll()");
  return /renderOpzioniGrafico\(/.test(src.slice(i, src.indexOf("\nfunction ", i + 1)));
})());

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

/* ⚠ si misura la funzione che il testo lo produce, non un pacchetto che in questo harness puo'
   legittimamente non avere quel titolo: un check che dipende dai dati di prova misura i dati
   di prova, non il codice. */

/* ⚠ per un titolo che la pipeline NON segue il blocco non deve esistere: inventare un
   "supporto del sistema" che il sistema non ha calcolato sarebbe la bugia peggiore. */

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

/* ══ v274 — I DUE CERVELLI ADESSO NE SONO UNO ════════════════════════════════════════════
   Punto 1 della revisione che il CEO ha approvato. Pagina e pacchetto erano costruiti da
   funzioni separate che ricavavano gli stessi fatti ognuna per conto suo: aggiungere un campo
   voleva dire ricordarsene quattro volte, e me ne sono dimenticato tre volte di fila (i muri
   delle opzioni solo nella scheda, il pre-market solo in tabella).
   ⚠ QUESTO CHECK E' LA RAGIONE PER CUI IL DIFETTO NON TORNA: se un consumatore ricomincia a
   leggersi i dati da solo, qui si accende. Non misura uno stile: misura che esista UN posto
   dove la domanda "cosa sappiamo di questo titolo?" ha una risposta sola. */

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
  const dentro = ["petrolio", "rame", "oro"].every(k => !mat[k] || p.includes(fmtNum.format(mat[k].value)));
  /* e la scrittura dev'essere quella italiana del resto del pacchetto: un valore col punto
     decimale accanto a "30.046,14" si legge mille volte piu' grande di quello che e' */
  const senzaAmbiguita = ["petrolio", "rame", "oro"].every(k => {
    const v = mat[k] && mat[k].value;
    if (v == null || Number.isInteger(v)) return true;
    return !p.includes(" " + String(v) + " ");     // mai il numero grezzo con punto decimale
  });
  return fuori && dentro && senzaAmbiguita`));

/* ⚠ IL PUNTEGGIO E' POSIZIONALE, NON UN GIUDIZIO: un petrolio al 90% del suo intervallo e'
   inflazione (male), un rame al 90% e' domanda industriale (bene) — stesso numero, segni
   opposti. Metterli nella mediana del quadro d'insieme direbbe una cosa priva di senso: e' lo
   stesso errore che il Philly Fed a punteggio pieno ha reso visibile in v274. */
/* ⚠ `suVeri` e non `run`: sulla fixture non c'e' macro.indicators, quindi `quadro` e' null e
   il check moriva su `null.n` — misurando i dati di prova invece del codice. E' la stessa
   trappola gia' documentata in CLAUDE.md e ripetuta oggi per la terza volta. */
/* ⚠⚠ v337 — L'INVARIANTE CAMBIA PERCHE' L'OGGETTO E' SPARITO, non perche' desse fastidio.
   Il check sorvegliava che il punteggio POSIZIONALE delle materie (dove lo stesso 90 significa
   "inflazione" sul petrolio e "domanda industriale" sul rame) non entrasse nel conteggio del
   quadro d'insieme. Quel conteggio non esiste piu': il CEO ha tolto la scala 0-100 da schede e
   pacchetto, e con lei correlazioniMacro(). Un check su un aggregato inesistente e' un ramo
   irraggiungibile — la classe v234, "un commento che sembra codice".
   Al suo posto la RICEVUTA del taglio, che e' la cosa che puo' ancora rompersi: i valori delle
   materie devono continuare ad arrivare nel pacchetto. Il rischio vero non e' piu' che
   inquinino una media, e' che spariscano insieme a lei. */
check("v280 materie: i valori arrivano nel pacchetto anche senza il quadro d'insieme", suVeri(`
  const p = buildPrompt();
  const m = (DATA.macro && DATA.macro.materie) || {};
  const nomi = Object.keys(m).filter(k => m[k] && m[k].label);
  if (!nomi.length) return true;
  return nomi.every(k => p.indexOf(m[k].label) >= 0)`));

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

/* ══ v286 — TRE DIFETTI TROVATI NEL PACCHETTO CHE IL CEO MI HA INCOLLATO ═════════════════ */

/* ⚠ VOLUMI E CONTRATTI APERTI SONO DUE GRANDEZZE DIVERSE, e stavano nella stessa frase senza
   etichetta: "put 6434, call 15041" (volumi del giorno) accanto a "33024 contratti" (open
   interest). Non tornano e non devono tornare — ma chi legge prova a farli quadrare, e quando
   non ci riesce dubita di tutto il blocco. E' la classe "denominatori non dichiarati". */

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
/* ⚠ v337 — la dispersione viveva nel blocco del disaccordo, uscito con la scala 0-100.
   L'INFORMAZIONE pero' non doveva uscire con lui: "chi tira giu' e chi tiene su un composito"
   e' un fatto sul dato, e sopravvive nelle SCHEDE come barre ordinate. Il check si sposta li'.
   ⚠ E verifica anche che le barre NON stampino piu' il punteggio accanto: e' esattamente il
   posto da cui il numero poteva rientrare senza che nessuno se ne accorgesse. */
check("v287 schede: i componenti di un composito restano confrontabili, senza punteggio", (() => {
  const r = run(`
    const c = { components: [ { label: "Alfa", score: 20 }, { label: "Beta", score: 80 },
                              { label: "Gamma", score: 55 } ] };
    return barreComposito(c, "prova", "");`);
  if (!r || !r.g || !r.n) return false;
  const nomiPresenti = r.n.indexOf("Alfa") >= 0 && r.n.indexOf("Beta") >= 0;
  const senzaPunteggio = r.n.indexOf("/100") < 0 && r.g.indexOf("/100") < 0;
  return nomiPresenti && senzaPunteggio;
})());

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
  const g = fo.g || "";
  return n < 20
      && /<path d="M [\\d.]+ [\\d.]+ A 1[01]\\d /.test(g)
      && /<circle cx="150"/.test(g)
      && !/<polyline/.test(g)
      && g.includes("<title>paura estrema: da 0 a 25<" + "/title>")`));

/* ══ v293 — LA CONSEGNA CHIESTA DAL CEO, E IL SUO TETTO ══════════════════════════════════
   "mi fornisce un quadro troppo lungo": la vecchia consegna aveva sette blocchi con tabelle e
   prosa e NESSUN tetto — tremila parole per costruzione. Un budget scritto e' l'unica
   istruzione sulla lunghezza che un LLM rispetti davvero. */

/* ⚠ gli otto blocchi che il CEO ha elencato, nel suo ordine. Se un domani qualcuno ne toglie
   uno "per accorciare", qui si accende: la lunghezza si taglia col budget, non con i blocchi. */

/* ══ v293 — EMA E FIBONACCI LI CALCOLIAMO NOI ════════════════════════════════════════════
   Lezione v271: il sistema aveva i livelli e ne faceva cercare altri, l'LLM tornava con numeri
   diversi e il CEO si ritrovava pagina e analisi in disaccordo sullo stesso titolo. */

/* ⚠⚠ E SI PUBBLICA SOLO CIO' CHE I DATI PERMETTONO. `sparks.m6` sono 126 barre giornaliere:
   l'EMA 200 ne vorrebbe 200. Pubblicarla lo stesso sarebbe un numero che sembra piu' solido di
   quanto e' — la classe di difetto peggiore di questo progetto. Il pacchetto deve DICHIARARE
   perche' manca, non ometterla in silenzio. */

/* ⚠ Fibonacci e' aritmetica esatta, non una stima: il livello 50% dev'essere esattamente il
   punto medio fra massimo e minimo a 52 settimane. Se un domani qualcuno "arrotonda" o cambia
   il verso del conteggio, il numero smette di essere quello che la convenzione indica. */

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

/* ⚠⚠ I TRE VINCOLI CHE LO RENDONO UN CONTRADDITTORIO INVECE DI UN PARAGRAFO DI CORTESIA. Senza
   di questi un modello scrive "d'altra parte i rischi non mancano" e passa oltre: (a) i numeri
   devono essere QUESTI, (b) deve scegliere, (c) deve nominare un fatto osservabile e datato che
   deciderebbe la disputa. Il terzo si aggancia al calendario che il pacchetto porta da v290. */

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

/* ⚠⚠ FONDAMENTALI CHE AVEVAMO E FACEVAMO CERCARE. Il pacchetto diceva "cerca online i
   fondamentali" mentre EPS, beta e forza relativa erano gia' in data.json: e' il difetto v271
   (il sistema tiene un numero e ne fa cercare un altro) applicato ai conti invece che ai
   livelli. L'EPS in particolare — v185 lo rimise nel payload perche' col solo P/E non si
   distingue una societa' cara da una in perdita, e su AMD davamo P/E 123,4x senza il 4,17. */

/* ⚠ ma NON i punteggi compositi: `fin_health` e `health` sono giudizi 0-100 travestiti da
   dati, ed e' esattamente cio' che v200 ha tolto dal pacchetto misurando un hit-rate del 29%.
   I fatti si', i voti no — anche quando sono comodi. */

/* ⚠⚠ IL BLOCCO "COSA NON SO". Dei nove blocchi che il prompt chiede, solo due si rispondono
   coi dati del pacchetto: il resto viene dalla rete, e un modello che non trova il consenso
   analisti se lo inventa in silenzio. La dichiarazione di fallimento e' OBBLIGATORIA perche'
   un buco dichiarato si vede e un numero inventato no. */

/* ══ v303 — LE QUATTRO SEZIONI FUSE: GLI INVARIANTI SI SPOSTANO, NON SI PERDONO ══════════
   Il CEO ha chiesto di spostare Termometri di stress, Rotazione, Leva e stagionalita' e La
   curva dei tassi dentro "Tutti gli indicatori". Nove check puntavano a `renderTassi` e
   `renderRotazione`, che non esistono piu'. Cancellarli sarebbe stato il modo classico di
   perdere la protezione (v203); qui ognuno verifica che il FATTO sia sopravvissuto al
   trasloco, nella casa nuova. */

/* ⚠ i tre termometri e la stagionalita' devono essere TESSERE, non essere spariti con la loro
   sezione: erano esclusi dalla classifica proprio perche' ne avevano una propria. */
/* ⚠ v307 — la stagionalita' esce dall'elenco su richiesta del CEO, un commit dopo esserci
   rientrata. L'invariante NON era "queste quattro chiavi": era che i tre TERMOMETRI, che
   avevano una sezione propria, non sparissero fondendola. Quello resta. */
check("v307 fusione: i tre termometri sono tessere della classifica", suVeri(`
  const k = indicatoriClassifica().map(x => x.k);
  return ["in:curve", "credit", "vix"].every(x => k.includes(x))`));

/* ⚠ rotazione e tassi diventano due forme: devono esserci, disegnare qualcosa, e dichiarare
   come si leggono — la riga che il CEO ha chiesto per ogni scheda fin da v238. */
check("v303 fusione: rotazione e tassi sono due forme che disegnano e si spiegano", suVeri(`
  const k = indicatoriClassifica().map(x => x.k);
  if (!k.includes("rotazione") || !k.includes("tassi10")) return false;
  for (const n of ["rotazione", "tassi10"]) {
    const f = FORMA_INDICATORE[n](DATA.macro || {});
    if (!f || typeof f.n !== "string" || f.n.indexOf("Come si legge") < 0) return false;
    if (typeof f.g !== "string" || f.g.length < 200) return false;
  }
  return true`));

/* ⚠⚠ IL 10A-3M NON DEVE SPARIRE NEL TRASLOCO. E' passato per tre case in tre versioni: tessera
   propria (fino a v294), scheda dei tassi (v294-v302), ora tessera `tassi10`. Ogni volta il
   rischio e' che si perda nel passaggio — la classe v201-v204, tre volte gia' pagata. */
check("v303 fusione: il 10A-3M sopravvive, in tessera o nel pacchetto", suVeri(`
  const c3 = ((DATA.macro && DATA.macro.indicators) || []).find(x => x && x.key === "curve3m");
  if (!c3) return true;
  const f = FORMA_INDICATORE["tassi10"](DATA.macro || {});
  const inTessera = !!f && f.n.indexOf(String(c3.value)) >= 0;
  const nelPacchetto = buildPrompt().indexOf(String(c3.value)) >= 0;
  return inTessera && nelPacchetto`));

/* ⚠ i tassi restano OSSERVAZIONI, non stime: la serie FRED e la data di rilevazione devono
   essere scritte accanto al valore anche nella forma nuova (regola v250 + v289). */
check("v303 tassi: la tessera dichiara serie FRED e data di osservazione", suVeri(`
  const t = DATA.macro && DATA.macro.tassi;
  if (!t || !(t.scadenze || []).length) return true;
  const d = t.scadenze.find(x => x.key === "a10");
  const f = FORMA_INDICATORE["tassi10"](DATA.macro || {});
  return !!f && f.n.indexOf(d.series_id) >= 0 && f.n.indexOf(d.observation_date) >= 0`));

/* ══ v304 — NEWS MACRO: TRE FONTI, NON CINQUANTASETTE ════════════════════════════════════
   Il CEO le ha richieste nel calendario. Erano uscite in v269 e il motivo NON era che fossero
   inutili: erano ~57 richieste RSS a ogni run per un blocco che nessuno apriva. Qui sono TRE.
   ⚠⚠ IL FILTRO LO FA LA FONTE. Tre tarature provate: stretta, scartava il PPI e il deficit di
   bilancio; larga, faceva passare "Modi Maps India's Growth Push" (per "growth"). Un filtro a
   parole su un titolo non distingue la "growth" di un'economia da quella di una societa'.
   CNBC Economia e' gia' un feed di economia e si prende per intero; i generalisti passano dal
   filtro, che resta imperfetto e viene dichiarato. */
check("v304 news: entrano solo con una data, e i forum restano vietati", suVeri(`
  const nw = (DATA.macro && DATA.macro.news) || null;
  if (!nw || !(nw.voci || []).length) return true;
  const conData = nw.voci.every(v => /^\\d{4}-\\d{2}-\\d{2}/.test(String(v.quando || "")));
  const fonti = (nw.fonti || []).join(" ").toLowerCase();
  return conData && fonti.indexOf("reddit") < 0 && fonti.indexOf("forum") < 0`));

/* ⚠ e nel PACCHETTO devono arrivare come TITOLI, non come fatti: il sistema non ha letto gli
   articoli ne' controllato i numeri che contengono, e un titolo cita numeri ("annual rate at
   3.4%") che un LLM prenderebbe per buoni. */
/* ⚠⚠ v306 — DUE RAMI, ED ENTRAMBI DEVONO PARLARE. Il CEO ha chiesto solo notizie di massimo
   sei ore. Misurato mentre lo scrivevo: dentro le 6 ore c'erano ZERO notizie macro, e anche
   dentro le 12 — era sabato. Quindi il ramo "nessuna" non e' un caso limite raro: e' quello
   che si vede ogni fine settimana e molte mattine. Deve DIRE che non c'e' niente e quanto e'
   vecchia la piu' recente, perche' "non e' uscito niente di macro da mezza giornata" e' un
   fatto sul mondo, non un buco del sistema — e tacere lascerebbe l'LLM a dedurre. */
check("v306 news: il pacchetto parla in entrambi i rami, fresche o nessuna", suVeri(`
  const nw = (DATA.macro && DATA.macro.news) || null;
  if (!nw || !(nw.voci || []).length) return true;
  const p = buildPrompt();
  const i = p.indexOf("TITOLI MACRO DELLE ULTIME 6 ORE");
  if (i < 0) return false;
  const blocco = p.slice(i, i + 1200);
  const nessuna = blocco.indexOf("NESSUNO") >= 0;
  if (nessuna) {
    /* il ramo vuoto deve dichiarare l'eta' della piu' recente e che non e' un guasto */
    return blocco.indexOf("piu' recente") >= 0 && blocco.indexOf("non un buco del sistema") >= 0;
  }
  return blocco.indexOf("SONO TITOLI, NON FATTI VERIFICATI") >= 0
      && blocco.indexOf("non ha data di rilevazione") >= 0`));

/* ⚠⚠ v307 — LA SEZIONE NOTIZIE E' USCITA DALLA PAGINA su richiesta del CEO, un'ora dopo
   averla chiesta: con la finestra a sei ore che aveva fissato, misurata, dava ZERO. Il check
   che sorvegliava il riquadro non ha piu' un soggetto — ma l'invariante che conta e' l'altro,
   e vale ancora: le notizie devono restare NEL PACCHETTO. E' la regola v208 (si toglie dalla
   pagina cio' che il payload porta gia') e la classe v201-v204 (la pulizia che si porta via il
   fatto), gia' pagata quattro volte qui. */
check("v307 news: il riquadro e' uscito dalla pagina", (() => {
  /* ⚠ `src` vive nello scope del file di test, non nella sandbox: la prima stesura lo cercava
     dentro `suVeri` e il meta-check "vuole un BOOLEANO" l'ha preso. Ogni controllo va dove i
     suoi dati esistono — errore gia' fatto in v300 con FAMIGLIA_INDICATORE. */
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  return src.indexOf("cal-news-lista") < 0 && html.indexOf('id="cal-news"') < 0;
})());

check("v307 news: ma restano nel pacchetto", suVeri(`
  const nw = (DATA.macro && DATA.macro.news) || null;
  if (!nw || !(nw.voci || []).length) return true;
  return buildPrompt().indexOf("TITOLI MACRO DELLE ULTIME") >= 0`));

/* ══ v305 — ANALISI DI UN SETTORE ═══════════════════════════════════════════════════════
   Richiesta del CEO dopo un'analisi esterna che ha portato. La struttura viene da quella —
   una corsa di settore finisce quando arrivano INSIEME (a) il passaggio delle azioni da mani
   istituzionali a retail e (b) il momentum che si gira — ma i numeri vengono da noi.
   ⚠⚠ (b) SI CALCOLA, (a) NO, E VA DICHIARATO. I flussi retail negli ETF non hanno fonte
   gratuita affidabile: `sharesOutstanding` di yfinance da' 11,7M quote per un NAV di 584$,
   cioe' 6,8 miliardi contro i 68 di `totalAssets` — dieci volte di scarto. Un ingrediente
   mancante DICHIARATO e' un'analisi onesta; uno stimato in silenzio non lo e'. */

/* ⚠ e la forza relativa CONTRO il mercato: e' il confronto che rende visibile l'euforia — un
   settore a +161% mentre l'indice fa +49% dice qualcosa che il +161% da solo non dice. */

/* ⚠⚠ L'INGREDIENTE CHE NON ABBIAMO DEVE ESSERE DICHIARATO, coi numeri che lo dimostrano. Senza
   questa riga il pacchetto sembrerebbe completo, e un LLM riempirebbe il buco stimando. */

/* ⚠ un settore che non esiste non deve produrre un pacchetto vuoto che sembra valido: deve
   dire quali esistono. Un pacchetto muto e' peggio di un errore. */

/* ⚠⚠ UN'OBBLIGAZIONE NON SI MOLTIPLICA COME UN'AZIONE, e il primo disegno lo dimostrava: il
   BTP quota in PERCENTUALE del nominale, quindi 40.000 a 102,86 valgono 41.144 euro e non
   4.114.400. Moltiplicato come un titolo azionario risultava il 93% del portafoglio e
   schiacciava tutto il resto a 0-2%. Un numero che non rompe niente e dice il falso — classe
   v205, e visibile solo perche' ho guardato il risultato invece del codice. */

/* ⚠⚠ E NON SI SOMMANO VALUTE DIVERSE: il totale metteva insieme dollari ed euro come se fossero
   la stessa cosa — il difetto per cui esiste il gate valuta (v183), che pero' guarda il
   pacchetto e non la pagina. Il peso e' adimensionale e si calcola in euro; gli importi per
   riga restano nativi, dove non c'e' niente da convertire. */

/* ⚠ UNA SOLA STRADA per portare un simbolo nel grafico: la usano il clic sul portafoglio e il
   selettore dei settori. Due percorsi separati divergono sempre — lezione v225 (frecce e
   trascinamento) e v161/v207 (doppie derivazioni della stessa grandezza). */

/* ⚠ le righe si ridisegnano a ogni render: gli handler stanno sul CONTENITORE, non sulle
   righe, altrimenti restano handler morti — il difetto v193/v213 che ha gia' rotto il wiring
   piu' volte in questo progetto. */

/* ⚠ e le posizioni su titoli che la pipeline NON segue non hanno prezzo: vanno dichiarate, non
   omesse. Una posizione che sparisce dalla tabella si legge come "venduta". */

/* ══ v309 — STAGIONALITA' NDX + MIDTERM, E I CLIC CHE PORTANO AL GRAFICO ═════════════════ */

/* ══ v327 — LA STAGIONALITA' AL NETTO DELLA DERIVA ═════════════════════════════════════════
   Il CEO: "il grafico che mi dai mi da solo settembre con andamento negativo e questo non e'
   possibile!!!". Aveva ragione, e la causa era nel METODO, non nei dati: il Nasdaq sale in media
   dell'1,35% AL MESE sui 41 anni del campione, quindi sommando quella deriva a ogni mese undici
   mesi su dodici risultano positivi. Un grafico tutto verde non distingue niente.
   ⚠ RICEVUTA DEL TAGLIO: il ciclo di midterm esce dalla SCHEDA su richiesta del CEO (dieci
   osservazioni per mese non reggevano il peso che gli si dava) ma resta nel PACCHETTO per l'LLM
   — verificato: la riga c'e'. Regola v208, si toglie dalla pagina cio' che il payload porta gia'. */
check("v327 stagionalita': la barra e' l'ECCESSO sul mese medio, e la deriva e' dichiarata", suVeri(`
  const st = DATA.macro && DATA.macro.stagionalita_ndx;
  if (!st || !(st.mesi || []).length) return true;
  const f = FORMA_INDICATORE["stagionalita_ndx"](DATA.macro);
  if (!f) return false;
  const mesi = st.mesi.filter(x => x && Number.isFinite(x.media));
  const deriva = mesi.reduce((a, x) => a + x.media, 0) / mesi.length;
  /* la deriva dev'essere SCRITTA: e' l'unica cosa che spiega perche' i numeri non coincidono
     con quelli assoluti che il lettore potrebbe cercare altrove */
  return f.n.includes("mese MEDIO") && f.n.includes(signTxt(Math.round(deriva * 100) / 100))
      && f.n.includes("osservazioni per mese")
      && !/midterm/i.test(f.g + f.n)`));

check("v327 stagionalita': al netto della deriva i mesi negativi sono piu' di uno", suVeri(`
  const st = DATA.macro && DATA.macro.stagionalita_ndx;
  if (!st || !(st.mesi || []).length) return true;
  const mesi = st.mesi.filter(x => x && Number.isFinite(x.media));
  const deriva = mesi.reduce((a, x) => a + x.media, 0) / mesi.length;
  const neg = mesi.filter(x => x.media - deriva < 0).length;
  const f = FORMA_INDICATORE["stagionalita_ndx"](DATA.macro);
  const rosse = f.g.split("var(--red)").length - 1;
  /* un grafico in cui un solo mese e' negativo non e' stagionalita', e' la deriva dell'indice */
  return neg >= 3 && rosse === neg`));

/* ⚠ e il midterm dev'essere ancora nel pacchetto: esce dalla scheda, non dal sistema. */
check("v327 stagionalita': il ciclo di midterm resta nel pacchetto per l'LLM", suVeri(`
  const st = DATA.macro && DATA.macro.stagionalita_ndx;
  if (!st || !(st.mesi || []).some(x => Number.isFinite(x.media_mid))) return true;
  return /midterm/i.test(buildPrompt())`));

/* ⚠ e l'anno in corso NON entra nel campione che lo descrive: sarebbe circolare. */
check("v309 stagionalità: l'anno in corso è escluso dallo storico", suVeri(`
  const st = DATA.macro && DATA.macro.stagionalita_ndx;
  if (!st) return true;
  const anno = new Date().getUTCFullYear();
  return st.al === anno - 1 && (st.anni_midterm || []).every(a => a < anno)`));

/* ⚠⚠ "PER QUELLE CHE PUOI": il bottone del grafico compare SOLO dove un simbolo TradingView
   funziona davvero. Misurato in v290 in un browser: il widget gratuito rifiuta i rendimenti
   dei Treasury, il dollaro e TUTTI gli indici. Un bottone che apre un errore e' peggio di
   nessun bottone — e la stessa regola vale per l'indice NDX, che va sostituito con QQQ come
   ^SOX va sostituito con SOXX. */
check("v309 grafico: nessuna tessera punta a un simbolo che il widget rifiuta", (() => {
  const i = src.indexOf("const TV_PER_TESSERA");
  /* ⚠ SENZA COMMENTI: la nota che spiega perche' NON usare "NDX" contiene "NDX", e il gate
     trovava se stesso — SESTA volta in questo progetto (v213, v226, v238, v240, v300). */
  const mappa = src.slice(i, src.indexOf("};", i))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const vietati = ["TVC:US10Y", "US02Y", "US30Y", "TVC:DXY", "TVC:SPX", "TVC:NDX", "TVC:RUT",
                   '"NDX"', '"SPX"', '"RUT"', '"DXY"', "ECONOMICS:"];
  return vietati.every(v => mappa.indexOf(v) < 0)
      && mappa.indexOf('"SOXX"') >= 0 && mappa.indexOf('"QQQ"') >= 0;
})());

/* ⚠ il bottone sta dentro una tessera che al clic apre il pannello: senza stopPropagation si
   aprirebbero entrambe le cose. E gli handler stanno sul contenitore, non sugli elementi che
   si ridisegnano — difetto v193/v213. */
check("v309 grafico: il clic sul bottone non apre anche il pannello", (() => {
  const i = src.indexOf("function agganciaTessere");
  const corpo = src.slice(i, src.indexOf(String.fromCharCode(10) + "function ", i + 10));
  return corpo.includes("stopPropagation") && corpo.includes("box.addEventListener");
})());

/* ══ v310 — CIO' CHE SI DISEGNA DEVE ARRIVARE ALL'LLM: IL CANCELLO CHE CHIUDE LA CLASSE ══
   ⚠⚠ E' LA TERZA VOLTA. Il calendario (v287) e la curva dei tassi (v289) erano stati costruiti,
   disegnati e testati, e MAI messi nel pacchetto — il CEO se n'era accorto da solo ("abbiamo
   tenuto conto anche nella generazione del prompt dei suggerimenti?"). In v290 ho corretto quei
   due casi. Oggi e' successo di nuovo con la stagionalita' del Nasdaq.
   Correggere il caso e non la causa significa rivederlo una quarta volta. Questo check non
   sorveglia UNA tessera: le sorveglia TUTTE, e vale anche per quelle che non esistono ancora.
   ⚠ COME FUNZIONA: per ogni tessera in classifica prende il suo blocco in `macro`, ne estrae
   qualche valore scalare caratteristico (esclusi storici e serie, che nel payload non entrano
   per intero) e verifica che ALMENO UNO compaia nel pacchetto. Se il blocco non ha scalari, la
   tessera non e' giudicabile e viene saltata: meglio un check che tace su un caso ambiguo che
   uno che grida al lupo.
   ⚠ Chi e' escluso lo e' PER SCELTA, e la scelta va scritta qui: le tessere che disegnano una
   cosa gia' presente in altra forma (rotazione = i 21 ETF, tassi10 = la curva) troverebbero
   comunque un riscontro; quelle senza blocco proprio in `macro` non hanno niente da confrontare. */
check("v310 nessuna tessera e' cieca al pacchetto: cio' che si disegna arriva all'LLM", suVeri(`
  const m = DATA.macro || {};
  const p = buildPrompt();
  const scalari = (o, prof) => {
    if (o == null || prof > 2) return [];
    if (typeof o === "number") return [String(o)];
    if (typeof o === "string") return (o.length > 2 && o.length < 40) ? [o] : [];
    if (Array.isArray(o)) return [];
    if (typeof o === "object") {
      return Object.entries(o)
        .filter(([k]) => !/histor|spark|serie|storico|components|items|voci|mesi|scadenze/i.test(k))
        .flatMap(([, v]) => scalari(v, prof + 1)).slice(0, 8);
    }
    return [];
  };
  const cieche = [];
  for (const r of indicatoriClassifica()) {
    const chiave = String(r.k).replace(/^(in:|mk:|mat:|fg:)/, "");
    const blocco = m[chiave];
    if (!blocco || typeof blocco !== "object") continue;      // niente blocco: non giudicabile
    const vals = scalari(blocco, 0).filter(x => x && String(x).length > 1);
    if (!vals.length) continue;                               // nessuno scalare: non giudicabile
    if (!vals.some(v => p.indexOf(String(v)) >= 0)) cieche.push(r.k);
  }
  return cieche.length === 0`));

/* ══ v310 — I REPERTI DEL TERZO GIRO DEL LOOP ═══════════════════════════════════════════ */

/* ⚠⚠ IL DENOMINATORE VA DICHIARATO QUANDO CAMBIA. Provato togliendo il prezzo di AMD: il peso
   del comparto scendeva da 62% a 54% SENZA dire che una posizione era uscita dal conto. Un
   numero piu' basso che sembra una riduzione dell'esposizione e invece e' un denominatore
   diverso — la classe "denominatori non dichiarati" che `coherence_check` insegue. */

/* ⚠ e il peso del titolo nel libro dev'essere lo STESSO nei due pacchetti: un'asimmetria fra
   due artefatti dello stesso sistema sullo stesso titolo e' peggio di un dato mancante,
   perche' chi legge non sa quale credere. */

/* ⚠ il peso si calcola in `fattiTitolo`, fonte unica dei fatti di un titolo (v274): la prima
   stesura lo ricalcolava dentro chi disegna, e il gate v274 l'ha preso. */

/* ══ v311 — IL PORTAFOGLIO SI MODIFICA DALLA PAGINA ═════════════════════════════════════
   E' un percorso di SCRITTURA sui dati del CEO: i check qui sono piu' stretti del solito,
   perche' un difetto qui non produce un numero sbagliato — produce un file sbagliato. */

/* ⚠⚠ NIENTE SALVATAGGI PARZIALI. Se una riga non e' valida non si scrive NIENTE: salvare
   metà portafoglio e dire "fatto" e' peggio di non salvare, perche' il CEO non ha modo di
   sapere quale metà. */

/* ⚠⚠ UN TICKER NUOVO VA ANCHE NELLA WATCHLIST, altrimenti la pipeline non ne prende il prezzo
   e la riga resta senza valore — un dato mancante travestito da posizione. E `posizioni.json`
   NON diventa una fonte di simboli: e' la lezione v274 ("un ripiego verso un file morto e' una
   strada che riporta indietro"), quindi si scrivono DUE file e lo si dichiara. */

/* ⚠ senza token il salvataggio resta su un browser: dirlo, non lasciarlo scoprire dall'iPhone.
   E' il difetto gia' corretto sui parametri di rischio e sull'ordine delle sezioni. */

/* ⚠ togliere una riga tocca il FORM, non i dati: il salvataggio e' l'unico momento in cui
   qualcosa viene scritto, e Annulla deve poter riportare tutto indietro. */

/* ⚠ i comandi nascono e muoiono a ogni ridisegno: la delega sta sul documento, non sui
   bottoni — difetto v193/v213, che ha gia' rotto il wiring piu' volte qui. */

/* ⚠ e la modifica legge le posizioni da cio' che il sistema HA, non da una copia parallela:
   due elenchi della stessa cosa divergono (C10/C12). */

check("v327 rotazione: disegna tutti i comparti, ognuno cliccabile, in una scheda normale", suVeri(`
  const f = FORMA_INDICATORE["rotazione"](DATA.macro || {});
  if (!f) return true;
  const conM1 = (DATA.macro.tilt || []).filter(t => Number.isFinite(t.m1)).length;
  const barre = f.g.split("data-rot-tk").length - 1;
  const graf = f.g.split("data-graf-tk").length - 1;
  /* v327 — il CEO: "riduci dimensioni Rotazione quasi al pari delle altre tab macro": la scheda
     non e' piu' a piena larghezza, ma deve continuare a disegnarli TUTTI. */
  return !f.larga && barre === conM1 && graf === barre && barre >= 15`));

check("v325 rotazione: gli orizzonti offerti sono SOLO quelli che esistono nei dati", suVeri(`
  const f = FORMA_INDICATORE["rotazione"](DATA.macro || {});
  if (!f) return true;
  const offerti = f.g.split('data-rot-or="').slice(1).map(x => x.split('"')[0]);
  const tilt = DATA.macro.tilt || [];
  const esiste = (k) => k === "m1" ? tilt.filter(t => Number.isFinite(t.m1)).length >= 6
    : k === "m3" ? tilt.filter(t => Number.isFinite(t.m3)).length >= 6
    : tilt.filter(t => Number.isFinite((((t.relativa || {})[k]) || {}).settore)).length >= 6;
  /* un bottone senza dati dietro e' un comando morto: peggio di un comando assente */
  return offerti.length >= 2 && offerti.every(esiste)`));

check("v325 rotazione: cambiare orizzonte cambia davvero l'ordine", suVeri(`
  const primi = (k) => {
    rotOrizzonte = k;
    const f = FORMA_INDICATORE["rotazione"](DATA.macro || {});
    return f.g.split('data-rot-tk="').slice(1).map(x => x.split('"')[0]).slice(0, 5).join(",");
  };
  const a = primi("m1"), b = primi("a2");
  rotOrizzonte = "m1";
  return a.length > 5 && b.length > 5 && a !== b`));

/* ⚠ LA RICEVUTA DEL TAGLIO, scritta PRIMA: le prime azioni di ogni comparto escono dalla SCHEDA
   ma restano nel PACCHETTO di settore — verificato sui dati veri, 5 su 5 per SKYY. E' la regola
   v208: si toglie dalla pagina cio' che il payload porta gia'. Se un domani uscissero anche da
   li', questo check lo dice subito. */

/* ⚠⚠ IL SELETTORE NON C'E' PIU', ma la funzione che serviva si': scegliere un comparto per
   l'analisi. Ora la scelta e' UN CLIC nella rotazione, che fa due cose insieme — porta il
   settore nel grafico e lo rende quello che il bottone copierebbe. Due gesti diventati uno,
   e una sola strada per scriverlo (`scegliSettore`), perche' due strade divergono. */

/* ⚠ questo invariante non cambia con la forma: cliccare un comparto deve portarlo nel grafico. */
check("v325 grafico: ogni comparto porta il proprio simbolo al grafico", suVeri(`
  const f = FORMA_INDICATORE["rotazione"](DATA.macro || {});
  if (!f) return true;
  const tk = f.g.split('data-graf-tk="').slice(1).map(x => x.split('"')[0]);
  const noti = new Set((DATA.macro.tilt || []).map(t => t.ticker));
  return tk.length >= 15 && tk.every(x => noti.has(x))`));

/* ══ v314 — DUE CONVENZIONI OPPOSTE, E UN LLM VERO CI E' CASCATO ═════════════════════════
   Il CEO ha portato il referto reale di ChatGPT su MU. Ottimo referto — ma contiene una frase
   falsa: "la SMA200 e' circa il 75,9% sotto il riferimento". Se il prezzo sta +75,9% SOPRA la
   media, la media sta il 43,1% sotto il prezzo, non il 75,9%.
   ⚠⚠ LA COLPA ERA NOSTRA. Nello stesso blocco convivevano due convenzioni opposte per la stessa
   grandezza, a due righe di distanza e senza dichiararle: le EMA scrivevano il LIVELLO rispetto
   al prezzo ("EMA 20 904.38 (-6.9% dal riferimento)"), le SMA il PREZZO rispetto al livello
   ("+75.9%"). E' la classe "denominatori non dichiarati", sfuggita a `coherence_check` perche'
   qui e' una questione di VERSO, non di valore. */

/* ⚠ e le due famiglie di medie devono usare la STESSA base: se una dice il livello e l'altra
   il prezzo, chi legge inverte — ed e' successo davvero. */

/* ══ v315 — IL PORTAFOGLIO SI MODIFICA, SI ORDINA, E SI ANALIZZA INTERO ══════════════════
   Il CEO ha segnalato DUE VOLTE di non riuscire a modificare il portafoglio. La modalita'
   funzionava: il bottone era 74x22 pixel, trasparente, in coda a 400 caratteri di prosa dentro
   una nota grigia. ⚠ "La funzione esiste" e "la funzione e' raggiungibile" sono due cose diverse,
   e la seconda e' l'unica che conta per chi usa la pagina: un comando che nessuno trova non e'
   un comando. Il check guarda DOVE sta il bottone, non se la funzione esiste. */


/* ⚠ L'ORDINAMENTO E' UNA SCELTA DEL CEO, MA IL DEFAULT E' UNA NOSTRA AFFERMAZIONE.
   Il default resta il PESO: ordinare per guadagno mette in cima i vincitori, che e' la lettura
   che fa tenere i perdenti. Se un domani qualcuno cambia il default in "gain", questo check lo
   dice — non perche' sia vietato, ma perche' dev'essere una decisione presa, non una svista. */


/* ⚠⚠ IL CONTROVALORE IN EURO E' UNA CONVERSIONE AL CAMBIO DI OGGI, NON IL COSTO SOSTENUTO.
   E' la classe del gate valuta (v183): un dollaro col simbolo dell'euro accanto a un euro vero
   ha gia' prodotto un dimensionamento sbagliato in un referto reale. Qui il check verifica che
   l'obbligazione NON sia valutata come un'azione (quote x prezzo darebbe 4,1 milioni invece di
   41 mila) e che il totale sia la somma dichiarata, non una normalizzazione su se stessa. */

/* ══ IL PACCHETTO SUL LIBRO INTERO ══════════════════════════════════════════════════════════
   Terzo pacchetto dopo titolo e settore. Porta il fatto che nessuno degli altri due puo' vedere:
   piu' posizioni nello stesso comparto sono UNA scommessa scritta piu' volte.
   ⚠ E DEVE DICHIARARE CIO' CHE NON SA. Il sistema non conosce liquidita', altri conti, situazione
   fiscale: senza quei tre, qualunque quantita' e' un numero che sembra un consiglio. Il divieto
   di dimensionare non e' prudenza formale — e' l'unica cosa che tiene il pacchetto dalla parte
   dei fatti, che e' la riga di condotta di tutto il sistema. */


/* ⚠ e il cambio dev'essere dichiarato per quello che e': quello di OGGI, non quello di carico. */

/* ⚠ un pacchetto che non trova posizioni deve DIRLO, non produrre un'analisi di un libro vuoto:
   e' la classe "verde per assenza di dati" applicata al prodotto invece che al test. */

/* ══ v316 — UNA SOLA STRADA PER CONSEGNARE UN PACCHETTO ════════════════════════════════════
   Il CEO: "pulsante relativo copia analisi del portafoglio non genera prompt". Il pacchetto si
   generava e veniva buttato: la clipboard rifiutava e la promise rifiutata non era gestita.
   ⚠⚠ Ma il difetto vero erano TRE strade diverse per la stessa operazione, e due erano rotte —
   #set-copia leggeva `#set-input`, la barra che la v313 aveva RIMOSSO, quindi con il comparto
   correttamente scelto rispondeva "Scegli prima un settore dall'elenco". Verificato in browser
   sul sito pubblicato. Il gate della v313 controllava che il bottone ESISTESSE, non che fosse
   COLLEGATO: e' la stessa classe del bottone di modifica: esistenza contro raggiungibilita'. */

check("v316 consegna: il testo finisce SEMPRE nel riquadro, anche se la clipboard rifiuta", (() => {
  const i = src.indexOf("async function consegnaPacchetto");
  const corpo = src.slice(i, src.indexOf(String.fromCharCode(10) + "async function", i + 10));
  const box = corpo.indexOf("box.value = testo");
  const cli = corpo.indexOf("await navigator.clipboard");
  return box >= 0 && cli > box;    // prima si consegna, poi si prova la clipboard
})());


/* ══ IL PERCENTILE CHE NON ESISTEVA ════════════════════════════════════════════════════════
   Trovato leggendo il pacchetto che il CEO ha incollato: "Semiconduttori (SOX) — 116° percentile
   dell'anno". Un percentile sopra 100 non esiste. Il campo `pct_1y` calcolava la VARIAZIONE a
   un anno e la pagina la stampava come percentile: l'oro a +31,3% usciva come "31° percentile",
   cioe' nel terzo BASSO del suo intervallo. La lettura si INVERTE. */
check("v316 materie: variazione e posizione nell'intervallo, mai 'percentile'", suVeri(`
  const p = buildPrompt();
  const r = (p.split(String.fromCharCode(10)).find(x => x.includes("MATERIE PRIME")) || "");
  if (!r) return true;
  return !/percentile dell'anno/.test(r)
      && /in un anno/.test(r) && /dell'intervallo annuale/.test(r)`));

check("v316 materie: la posizione nell'intervallo sta fra 0 e 100", suVeri(`
  const m = (DATA.macro && DATA.macro.materie) || {};
  return Object.values(m).every(v => {
    if (!v || v.min_1y == null || v.max_1y == null || v.value == null) return true;
    const pos = (v.value - v.min_1y) / (v.max_1y - v.min_1y) * 100;
    return pos >= -0.01 && pos <= 100.01;
  })`));

/* ══ LA COLONNA DI TRADINGVIEW, CALCOLATA DA NOI ═══════════════════════════════════════════ */
const TV_FINTO = {
  tecnica: { prezzo: 100, medie: { sma200: { liv: 50, dist_pct: 100 }, ema20: { liv: 95, dist_pct: 5.3 } },
             medie_battute: 2, medie_totali: 2,
             oscillatori: { rsi14: 56.3, macd: { linea: -4.78, segnale: -18.87, istogramma: 14.09 }, adx14: 15.6, di_su: 20, di_giu: 18 },
             _come: "formule standard" },
  performance: { s1: 10.7, m1: 7.5, a1: 717.8, a3: 1304.8 },
  stagionalita: [{ mese: 8, media: 0.41, mediana: -0.26, positivi_pct: 43, campione: 42, peggio: -31.7, meglio: 26.6 }],
  sensibilita: { settore: { strumento: "SOXX", canale: "il comparto", beta: 1.46, r2: 0.657, corr: 0.81, campione: 250, da: "2025-08-18", a: "2026-08-14" },
                 tassi: { strumento: "TLT", canale: "i tassi a lunga", beta: 0.75, r2: 0.007, corr: 0.08, campione: 250, da: "2025-08-18", a: "2026-08-14" } },
  conto_trim: [{ trim: "2026-05-31", ricavi: 41460000000, utile: 28243000000, operativo: 33318000000, margine: 68.1, margine_op: 80.4 }],
};


/* ⚠⚠ UN BETA SENZA IL SUO R² E' MEZZO NUMERO: con R² 0,007 il canale dei tassi NON esiste su
   quella finestra, e un pacchetto che pubblicasse il solo beta inviterebbe a raccontarlo. E' il
   difetto che il referto reale di ChatGPT ha commesso ("il canale negativo e' il costo del
   capitale") su un titolo il cui R² sui tassi vale 0,007. */


/* ══ IL PORTAFOGLIO SEGUE IL MERCATO ═══════════════════════════════════════════════════════
   La condizione era `r.qty`, ma le posizioni portano `qta`: il ramo non entrava mai, e scriveva
   comunque `gain_pct` mentre la tabella legge `gain_pct_pos`. Prezzo fresco, guadagno vecchio. */

check("v316 live: l'obbligazione non viene valutata come un'azione nel refresh", (() => {
  const i = src.indexOf("const upd = (r) => {");
  const corpo = src.slice(i, i + 1200);
  return corpo.includes("qta * r.price / 100") && corpo.includes("startsWith(\"BTP\")");
})());

/* ⚠ la sezione "verifica del referto" e' stata RIMOSSA su richiesta del CEO: la ricevuta del
   taglio ha verificato che dentro i confini ci fossero le tre funzioni e nient'altro. */



check("v318 stagionalita': le due grandezze stanno sullo STESSO asse, o non sono confrontabili", suVeri(`
  const st = (DATA.macro || {}).stagionalita_ndx;
  if (!st || !(st.mesi || []).length) return true;
  const f = FORMA_INDICATORE["stagionalita_ndx"](DATA.macro || {});
  const g = f.g || "";
  /* la scala si tara sul massimo delle DUE serie: se si tarasse solo sulle barre, una lineetta
     di midterm piu' estrema uscirebbe dalla tela senza che nessuno se ne accorga */
  const mesi = st.mesi.filter(x => x && Number.isFinite(x.media) && Number.isFinite(x.media_mid));
  const lim = Math.max(...mesi.flatMap(x => [Math.abs(x.media), Math.abs(x.media_mid)]));
  const ys = g.split('y1="').slice(1).map(x => Number(x.split(String.fromCharCode(34))[0])).filter(Number.isFinite);
  return lim > 0 && ys.every(y => y >= 0 && y <= 138)`));

/* ══ v319 — LA RETE: IL PUNTEGGIO NON PUO' CONTRADDIRE LA PROPRIA SCHEDA ═══════════════════
   Il CEO: "controlla se effettivamente il rating che dai ad ogni scheda hanno una logica di
   calcolo corretta". Due schede avevano il SEGNO INVERTITO e 224 check erano verdi.
   ⚠⚠ QUESTO CHECK E' PIU' IMPORTANTE DELLE DUE CORREZIONI CHE LO ACCOMPAGNANO. Rattoppare due
   segni lascia in piedi il meccanismo che li ha prodotti: due formule indipendenti per la stessa
   domanda — una per il punteggio, una per il colore — che divergono in silenzio. Questa guardia
   confronta le due e boccia da sola qualunque formula futura che rientri dalla finestra. */
const FASCIA_ATTESA = (sc) => (sc < 35 ? "sfavorevole" : sc < 45 ? "debole" : sc <= 55 ? "neutro" : "favorevole");
const COLORE_ATTESO = { "var(--red)": "sfavorevole", "var(--yellow)": "debole",
  "var(--muted)": "neutro", "var(--orange, #f59e0b)": "neutro", "var(--green)": "favorevole" };

check("v319 punteggi: il punteggio cade nella stessa fascia del colore della sua zona", (() => {
  const casi = [
    { z: "ZONE_AMPIEZZA", vs: [-6, -4, -0.5, 0, 2, 5, 6] },
    { z: "ZONE_PUTCALL", vs: [0.6, 0.75, 0.9, 1.0, 1.19, 1.3, 1.5] },
  ];
  return casi.every(c => c.vs.every(v => {
    const r = run(`
      const z = ${c.z};
      const dentro = z.find(x => ${v} >= x.da && ${v} <= x.a) || (${v} < z[0].da ? z[0] : z[z.length - 1]);
      return JSON.stringify({ sc: punteggioDaZone(${v}, z), col: dentro.colore });`);
    const o = JSON.parse(r);
    return o.sc != null && FASCIA_ATTESA(o.sc) === COLORE_ATTESO[o.col];
  }));
})());

/* ⚠ e il verso, verificato sui due estremi che hanno un significato opposto e certo: la
   partecipazione piu' larga possibile non puo' valere meno del rally piu' stretto. */
check("v319 ampiezza: la partecipazione larga vale PIU' del rally di sole megacap", (() => {
  const larga = Number(run("return punteggioDaZone(-6, ZONE_AMPIEZZA)"));
  const stretto = Number(run("return punteggioDaZone(6, ZONE_AMPIEZZA)"));
  return larga > 55 && stretto < 35 && larga > stretto + 30;
})());

check("v319 put/call: la copertura pesante vale PIU' della compiacenza (lettura contrarian)", (() => {
  const cop = Number(run("return punteggioDaZone(1.4, ZONE_PUTCALL)"));
  const comp = Number(run("return punteggioDaZone(0.6, ZONE_PUTCALL)"));
  return cop > 55 && comp < 35 && cop > comp + 30;
})());

/* ⚠ le zone sono dichiarate UNA volta e servono sia al colore sia al punteggio: un secondo
   elenco tenuto allineato a mano e' la classe C10/C12, gia' pagata. */
check("v319 punteggi: la scheda e il punteggio leggono lo STESSO elenco di zone", (() => (
  src.indexOf("zone: ZONE_PUTCALL") >= 0
  && src.indexOf("punteggioDaZone(m.putcall.ratio, ZONE_PUTCALL)") >= 0
  && src.indexOf("punteggioDaZone(m.breadth.divergence_pp, ZONE_AMPIEZZA)") >= 0
  && !/50 \+ m\.breadth\.divergence_pp \* 8/.test(src)
))());

/* ══ v320 — LA LEVA: IL FATTO, NON SOLO L'AFFERMAZIONE ═════════════════════════════════════
   Il pacchetto affermava "leva ai massimi" e non conteneva UN SOLO NUMERO sulla leva. Peggio:
   l'affermazione era falsa — 94,4% del picco ma -5,6% sul trimestre, cioe' leva in RITIRO dal
   massimo di giugno, stato che `marginDebtState()` calcolava gia' correttamente mentre il
   pacchetto usava una derivazione PARALLELA che guarda solo il livello e ignora il verso. */
check("v320 leva: il pacchetto porta i NUMERI, non solo il verdetto", suVeri(`
  const p = buildPrompt();
  const i = p.indexOf("LEVA DEGLI OPERATORI (debito a margine");
  if (i < 0) return false;
  const aCapo = String.fromCharCode(10);
  const dopo = p.indexOf(aCapo + "- ", i + 10);
  const r = p.slice(i, dopo < 0 ? p.length : dopo);
  const md = (DATA.macro || {}).margin_debt || {};
  return r.includes(fmtNum.format(Math.round(md.value / 1000)))   // il valore in miliardi
      && r.includes(fmtNum.format(md.pct_of_peak))                // la distanza dal massimo
      && r.includes("nell'ultimo mese") && r.includes("sul trimestre")
      && (() => {
        const h = (md.history || []).map(Number).filter(Number.isFinite);
        if (h.length < 4 || !h[h.length - 4]) return true;
        const trim = Math.round((h[h.length - 1] / h[h.length - 4] - 1) * 1000) / 10;
        /* i due orizzonti hanno numeri diversi e ognuno e' scritto col proprio nome */
        return r.includes(signTxt(trim) + " sul trimestre")
            && r.includes(signTxt(md.qoq) + " nell'ultimo mese")
            && Math.abs(trim - md.qoq) > 0.5;
      })()
      && (r.includes("rilevazione") || r.includes("riferito a "))
      && r.includes("prossimo atteso")`));

check("v320 leva: pubblica il parametro storico, e non è il '% del massimo'", suVeri(`
  const p = buildPrompt();
  const i = p.indexOf("LEVA DEGLI OPERATORI (debito a margine");
  const r = i < 0 ? "" : p.slice(i, i + 1400);
  const md = (DATA.macro || {}).margin_debt || {};
  if (md.pct_of_gdp == null || md.gdp_median_ref == null) return true;
  return r.includes("del PIL") && r.includes("mediana storica")
      && r.includes("la mediana") && (r.includes("SOPRA soglia") || r.includes("SOTTO soglia"))
      && r.includes(fmtNum.format(md.pct_of_gdp)) && r.includes(fmtNum.format(md.gdp_median_ref))`));

/* ⚠⚠ L'INVARIANTE CHE CONTA: il verdetto sistemico non puo' dire "leva ai massimi" mentre la
   fonte unica dice che si sta ritirando. Due derivazioni della stessa domanda sono gia' esistite
   qui, e quella sbagliata era l'unica che arrivava all'LLM. */
check("v320 leva: il verdetto sistemico non contraddice marginDebtState", suVeri(`
  const st = marginDebtState();
  if (!st) return true;
  const p = buildPrompt();
  const massimi = p.includes("leva in espansione sui massimi");
  const ritiro = p.includes("la leva si sta RITIRANDO dai massimi");
  /* esattamente uno dei due, e quello giusto: se la fonte unica dice rollover, il pacchetto
     deve dire ritiro e non massimi */
  return (massimi !== ritiro) && (st.rollover ? ritiro : !ritiro)`));

check("v320 leva: la scheda esiste, disegna la serie e dichiara che le date sono ricostruite", suVeri(`
  const f = (FORMA_INDICATORE["leva"] || (() => null))(DATA.macro || {});
  if (!f) return false;
  const st = marginDebtState();
  return f.g.includes("<svg") && f.n.includes("del PIL") && f.n.includes("mediana storica")
      && f.n.includes("RICOSTRUITE")                       // una ricostruzione si dichiara
      && f.score === (st ? st.score : null)`));            // stesso punteggio della fonte unica

/* ══ v321 — LA TESSERA CHE NON NASCEVA, E LA RETE PER TUTTA LA CLASSE ══════════════════════
   `m.yield_recession?.current` — ma il campo si chiama `current_curve`. La condizione era
   sempre falsa: la tessera non veniva creata, la fusione dichiarata non scattava, e
   `was_inverted_24m` (che la curva a +0,51 pp di OGGI non contiene: una curva normalizzata da
   tempo e una che non si e' MAI invertita raccontano due storie diverse) non compariva da
   nessuna parte. Nessun errore, nessun gate rosso: un `?.` su un campo inesistente e' silenzioso. */
check("v321 curva: la tessera esiste e porta l'inversione degli ultimi 24 mesi", suVeri(`
  const yr = (DATA.macro || {}).yield_recession;
  if (!yr || yr.current_curve == null) return true;
  const lista = indicatoriClassifica();
  const t = lista.find(x => /Curva dei tassi/i.test(x.nome || ""));
  if (!t) return false;
  /* il fatto deve sopravvivere a ENTRAMBE le fusioni: la prima lo porta dentro, la seconda
     riscrive il sub da zero e lo cancellava di nuovo */
  return yr.was_inverted_24m ? (t.sub || "").includes("invertita negli ultimi 24 mesi") : true`));

/* ⚠⚠ LA RETE DELLA CLASSE: ogni campo che il codice legge da `m.<x>` deve esistere davvero nel
   data.json. Senza questa guardia un campo rinominato in pipeline fa sparire una tessera in
   silenzio, e ci si accorge solo se qualcuno va a cercarla. Validata iniettando il difetto
   originale (`current` al posto di `current_curve`): morde. */
check("v321 dati: nessuna tessera legge un campo che in data.json non esiste", (() => {
  const i = src.indexOf("function indicatoriClassifica");
  const corpo = src.slice(i, src.indexOf(String.fromCharCode(10) + "function ", i + 10));
  const letti = [...corpo.matchAll(/\bm\.([a-z_0-9]+)\?\.([a-z_0-9]+)\s*!=\s*null/gi)]
    .map(x => [x[1], x[2]]);
  if (letti.length < 5) return false;          // se l'estrazione non trova niente, e' rotta lei
  const macro = reale.macro || {};
  const mancanti = letti.filter(([a, b]) => macro[a] && !(b in macro[a]));
  if (mancanti.length) console.log("   campi letti e assenti:", mancanti.map(x => x.join(".")).join(", "));
  return mancanti.length === 0;
})());

/* ══ LE FUSIONI NON POSSONO TENERE IL PUNTEGGIO MIGLIORE ═══════════════════════════════════
   "Mercato del lavoro 76/100" — molto favorevole — nasceva dalla disoccupazione al 76 mentre i
   nuovi posti stavano a 19, con "-23K" stampato due centimetri sotto: il punteggio peggiore
   spariva dalla pagina insieme alla tessera che lo portava. Una fusione puo' unire due VISTE
   della stessa cosa, non due giudizi opposti. */
check("v321 fusioni: il punteggio fuso e' il PEGGIORE dei due, e lo scarto resta visibile", suVeri(`
  const u = (DATA.macro && DATA.macro.indicators || []).find(x => x && x.key === "unemp");
  const n = (DATA.macro && DATA.macro.indicators || []).find(x => x && x.key === "nfp");
  if (!u || !n) return true;
  const t = indicatoriClassifica().find(x => /Mercato del lavoro/i.test(x.nome || ""));
  if (!t) return true;
  return t.score <= 40 && (t.sub || "").includes("non concordano")`));

check("v321 fusioni: la regola vale per COSTRUZIONE, non per il caso di oggi", (() => {
  const i = src.indexOf("for (const f of FUSIONI)");
  const corpo = src.slice(i, i + 1600);
  return corpo.includes("Math.min(A.score, B.score)")
      && corpo.includes("non concordano")
      && !/A\.score = A\.score/.test(corpo);
})());

/* ══ v322 — TRE PACCHETTI, TRE BOTTONI, TRE STANZE DIVERSE ═════════════════════════════════
   Il CEO: "non vedo ancora i tre pulsanti prompt in alto a destra". I tre bottoni esistevano ma
   stavano in tre posti diversi della pagina — due dentro le rispettive schede, uno in topbar.
   ⚠ NON e' la classe v209/v259 ("due porte per la stessa stanza"): quelle erano DUE bottoni che
   producevano lo STESSO pacchetto. Qui le tre porte danno su tre stanze diverse — macro/titolo,
   comparto, portafoglio — e stare insieme e' cio' che rende evidente che sono tre cose diverse.
   ⚠ E si SPOSTANO, non si duplicano: due elementi con lo stesso id fanno trovare a
   `querySelector` solo il primo, e il secondo bottone sembrerebbe rotto a caso. */

/* ⚠ e ognuno deve produrre un pacchetto DIVERSO: tre bottoni che generano la stessa cosa
   sarebbero la classe v259 con un nome nuovo. */

/* ══ FIBONACCI: UN SOLO CALCOLO, DUE POSTI DOVE SI LEGGE ═══════════════════════════════════
   Il CEO li ha chiesti sul grafico. Il sistema li calcolava gia' per il pacchetto (v293) sul
   range a 52 settimane. Un SECONDO punto di calcolo darebbe due serie di livelli per lo stesso
   titolo — la contraddizione che v271 ha gia' pagato: la pagina che dice una cosa e l'analisi
   che ne dice un'altra, senza sapere a quale credere. */

check("v322 fibonacci: i livelli si dichiarano contati DAL MASSIMO, e non come previsioni", (() => {
  const i = src.indexOf("v322 — I RITRACCIAMENTI DI FIBONACCI");
  if (i < 0) return false;
  const blocco = src.slice(i, src.indexOf("})()}", i) + 5);
  return blocco.includes("dal massimo verso il basso")
      && blocco.includes("Non sono previsioni")
      && blocco.includes("w52_high");
})());

/* ══ LA TESTATA IMPONE LA RICERCA, PERCHE' UN REFERTO REALE NON L'HA FATTA ═════════════════
   Il CEO ha portato la risposta di ChatGPT al pacchetto macro: chiudeva con "FONTI DA
   CONTROLLARE: nessuna. Questa analisi utilizza esclusivamente il payload fornito". Formalmente
   in regola — la vecchia A1 chiedeva di verificare solo cio' che POGGIA su fatti esterni, e il
   modello non ne aveva usati — e sostanzialmente inutile: ha letto una fotografia con dati fino
   a 140 giorni come se fosse il presente. */
check("v322 testata: la ricerca di dati freschi e notizie e' obbligatoria e verificabile", (() => {
  const h = readFileSync(join(ROOT, "config", "prompt_header_macro.txt"), "utf8");
  return h.includes("A1bis")
      && h.includes("ULTIME 24 ORE")
      && h.includes("piu' vecchio di 30 giorni")
      && h.includes("NON E' UNA RISPOSTA ACCETTABILE")
      && h.includes("NON HO ACCESSO ALLA RETE");      // la via d'uscita onesta se non puo' navigare
})());

/* ══ v323 — IL CONTRATTO FRA LE DUE LINGUE ═════════════════════════════════════════════════
   Il punteggio del credito si calcola in DUE posti: nella pipeline Python (che scrive
   data.json) e in assets/app.js (che ricalcola finche' il CI non ha rigenerato — v187/v205).
   ⚠⚠ Scrivendo questa correzione ho ricreato il difetto che stavo chiudendo: le due
   implementazioni interpolavano in modo diverso e per HY 2,71% davano 69 contro 88. Non c'e'
   modo di eseguire Python da questa suite, quindi il contratto si fissa QUI e in
   scripts/test_update_data.py con la STESSA tabella: se una delle due deriva, una delle due
   suite si rompe. Una tabella condivisa e' l'unico modo onesto di legare due lingue. */
const CONTRATTO_CREDITO = [[0.5, 93], [2.71, 80], [3.9, 73], [4.5, 40], [6.5, 29], [8, 26], [10, 23]];

check("v323 credito: il punteggio rispetta il contratto condiviso con la pipeline", (() => (
  CONTRATTO_CREDITO.every(([v, atteso]) =>
    Number(run(`return punteggioDaZone(${v}, ZONE_CREDITO)`)) === atteso)
))());

/* ⚠ e il numero non puo' contraddire la didascalia che gli sta accanto: a 6,5% la legenda dice
   "stress", quindi il punteggio deve stare nella fascia sfavorevole. Prima valeva 56, cioe'
   "favorevole", ed era stampato sulla stessa riga della parola "stress". */
/* ══ v326 — LA RETE PER TUTTA LA CLASSE: OGNI PUNTEGGIO A ZONE DEV'ESSERE MONOTONO ═════════
   La v319 aveva chiuso l'inversione GROSSA (fra le bande) e ne aveva aperta una FINE: dentro
   ogni banda il punteggio cresceva sempre col valore, anche dove il valore alto e' la cosa
   peggiore. Misurato: HY OAS a 0,5% valeva 75 e a 3,9% valeva 95; l'ampiezza a -8 pp, la
   partecipazione piu' larga possibile, valeva 72 mentre a -1,1 pp valeva 96. Un punteggio a
   DENTI DI SEGA: giusto a grandi passi, rovesciato da vicino.
   ⚠ Questo check non guarda dei valori attesi: guarda la PROPRIETA'. Una funzione monotona non
   puo' avere un punto in cui "peggio" vale di piu', e nessuna riscrittura futura puo'
   reintrodurre il difetto senza romperlo. */
check("v326 punteggi: ogni scala a zone e' monotona sull'intero dominio", (() => {
  const SCALE = [
    { z: "ZONE_CREDITO", da: 0.2, a: 15, cresce: false },
    { z: "ZONE_AMPIEZZA", da: -8, a: 11, cresce: false },
    { z: "ZONE_PUTCALL", da: 0.5, a: 1.6, cresce: true },
  ];
  return SCALE.every(s2 => {
    const passi = 60;
    const vals = [];
    for (let i = 0; i <= passi; i++) {
      const v = s2.da + (s2.a - s2.da) * i / passi;
      vals.push(Number(run(`return punteggioDaZone(${v}, ${s2.z})`)));
    }
    if (vals.some(x => !Number.isFinite(x))) return false;
    return vals.every((x, i) => i === 0 || (s2.cresce ? x >= vals[i - 1] : x <= vals[i - 1]));
  });
})());

check("v323 credito: a spread da 'stress' il punteggio sta nel rosso, non nel favorevole", (() => {
  const stress = Number(run("return punteggioDaZone(6.5, ZONE_CREDITO)"));
  const rilassato = Number(run("return punteggioDaZone(2.71, ZONE_CREDITO)"));
  return stress < 35 && rilassato > 70;
})());

/* ⚠⚠ v337 — IL PUNTEGGIO ESCE, LA ZONA RESTA, ED E' UN MIGLIORAMENTO non un cedimento.
   Il difetto originale della v323 era che il numero CONTRADDICEVA la legenda sulla stessa riga
   (56/100 "favorevole" accanto alla parola "stress"). Tolto il numero, la contraddizione non
   puo' piu' nascere per costruzione — ma resta l'invariante che conta davvero: il NOME DELLA
   ZONA stampato dev'essere quello che le bande dichiarate implicano per quel valore.
   ⚠ Questa e' la parte SOSTENUTA (v240): le bande sono una convenzione di lettura scritta
   accanto al numero, non una formula nostra travestita da misura. */
check("v323 credito: la zona stampata e' quella che le bande dichiarate implicano", suVeri(`
  const p = buildPrompt();
  const i = p.indexOf("Rischio Credito (HY OAS");
  if (i < 0) return true;
  const r = p.slice(i, i + 420);
  const v = numero(DATA.macro.credit.spread_hy);
  const z = ZONE_CREDITO.find(x => v >= x.da && v <= x.a);
  return r.indexOf("/100") < 0
      && r.includes("bande di lettura")
      && r.includes("5-7% stress")
      && (!z || r.includes(z.nome))`));



/* ⚠ e la scheda larga deve restare riordinabile: la chiave e' `data-scheda`, non la posizione. */
check("v324 rotazione: la scheda larga conserva la chiave stabile del riordino", (() => {
  const i = src.indexOf("function tessera({");
  const corpo = src.slice(i, i + 900);
  return corpo.includes("mg-larga") && corpo.includes("data-scheda")
      && readFileSync(join(ROOT, "assets", "style.css"), "utf8").includes(".mg-card.mg-larga");
})());

/* ══ v331 — L'OBBLIGO DI RICERCA VIVEVA SOLO NEL FILE REMOTO ═══════════════════════════════
   Lo sciame ha risposto alla domanda del CEO ("i prompt fanno si che l'LLM trovi le news?") e la
   risposta era NO, per tre ragioni indipendenti che ho verificato una per una:
   1. A1bis — la regola che impone la ricerca — stava SOLO in config/prompt_header_macro.txt.
      `promptHeaderText()` ripiega su DEFAULT_PROMPT_HEADER, che non la conteneva: i 1.348
      caratteri di differenza fra fallback (2.891) e file (4.239) erano esattamente A1bis. Con
      `loadPromptHeaderCloud` che esce in silenzio, un browser nuovo o una fetch lenta
      producevano un pacchetto identico in tutto il resto e SENZA l'ordine di cercare.
   2. Gli altri tre pacchetti affettano via la testata macro, quindi A1bis non li raggiungeva
      MAI. Settore e portafoglio ordinavano di cercare senza prevedere la risposta onesta.
   3. Un modello che non cerca produceva comunque una risposta conforme: la coda pubblica dieci
      identificativi di serie FRED da cui si costruiscono URL veri senza aprire una pagina.
   ⚠ Un obbligo che dipende da una fetch non gestita non e' un obbligo, e' una speranza. */
check("v331 ricerca: la regola vive nel FALLBACK, non solo nel file remoto", (() => {
  const m = src.match(/const DEFAULT_PROMPT_HEADER = `([\s\S]*?)`;/);
  if (!m) return false;
  const fb = m[1];
  return fb.includes("A1bis") && fb.includes("NON HO ACCESSO ALLA RETE")
      && /DATA DI PUBBLICAZIONE/.test(fb);
})());


check("v331 ricerca: il pacchetto DICHIARA quale testata sta portando", suVeri(`
  const p = buildPrompt();
  const r = p.split(String.fromCharCode(10)).find(x => x.startsWith("- PROVENIENZA DELLE REGOLE"));
  if (!r) return false;
  /* o nomina il file remoto, o dichiara di essere partito col fallback: la terza possibilita' —
     non dirlo — e' quella che rendeva invisibile il fallimento */
  return /FALLBACK LOCALE/.test(r) || /prompt_header/.test(r);`));

/* ══ v333 — CINQUE SCHEDE RIFATTE, E LA RICEVUTA CHE MI HA FERMATO ════════════════════════
   Il CEO ha respinto la barra 0-100, il quadrante, la ragnatela e — sull'ampiezza — anche il
   tachimetro. Il denominatore comune di tutte e quattro: chiedono di decodificare una scala.
   Due barre affiancate no: si vede quale e' piu' lunga, e quella E' la risposta.
   ⚠⚠ IL PRIMO TENTATIVO HA PORTATO VIA I VICINI. La mia funzione di taglio cercava "la prossima
   riga che somiglia a una chiave" e si e' mangiata QUATTRO voci (in:t30, in:real10, in:curve3m,
   in:philly) piu' l'intero blocco MATERIE — e `modifica_sicura` ha accettato, perche' il JS
   restava valido. E' la classe v201-v204 per la QUINTA volta, e l'unica ragione per cui l'ho
   vista sono stati due check che sorvegliavano proprio quelle voci.
   La riscrittura conta le GRAFFE e asserisce, prima di tagliare, che dentro i confini ci sia
   UNA sola voce e nessuno dei vicini noti. */
check("v333 forme: le cinque schede rifatte disegnano barre a confronto, non scale da decodificare", suVeri(`
  const attese = ["breadth", "momentum", "froth", "fedwatch", "liquidity"];
  return attese.every(k => {
    const f = (FORMA_INDICATORE[k] || (() => null))(DATA.macro || {});
    if (!f) return true;
    return typeof f.g === "string" && f.g.includes("<svg") && !f.g.includes("tk-zona");
  })`));

/* ⚠ LA RICEVUTA DEL TAGLIO, resa eseguibile: le voci vicine a quelle riscritte devono esserci
   ancora. Senza questo check il taglio sbagliato sarebbe passato — l'ho scoperto solo perche'
   due guardie preesistenti nominavano quelle chiavi. */
check("v333 forme: la riscrittura non ha portato via le schede vicine", (() => {
  const i = src.indexOf("const FORMA_INDICATORE");
  const blocco = src.slice(i, src.indexOf(String.fromCharCode(10) + "};", i));
  return ["in:t30", "in:real10", "in:curve3m", "in:philly", "stagionalita_ndx", "rotazione"]
      .every(k => blocco.includes(k))
    && src.includes("const MATERIE = {");
})());

/* ⚠ le barre condividono la scala, o il confronto — l'unico motivo per cui la forma esiste —
   sparisce. E la soglia, dove c'e', dev'essere disegnata: un livello senza riferimento non dice
   niente (v238). */
check("v333 dueBarre: scala condivisa e soglia disegnata dove esiste", suVeri(`
  const f = FORMA_INDICATORE["froth"](DATA.macro || {});
  if (!f) return true;
  /* la schiuma ha una soglia d'allarme dichiarata a 2,5x: deve comparire nel disegno */
  return f.g.includes("stroke-dasharray") && f.g.includes("allarme")
      && (f.g.split("<rect ").length - 1) >= 2`));

check("v333 fedwatch: una barra per riunione, coi tre esiti che sommano a 100", suVeri(`
  const f = (DATA.macro || {}).fedwatch;
  if (!f || !(f.meetings || []).length) return true;
  const forma = FORMA_INDICATORE["fedwatch"](DATA.macro || {});
  const r = f.meetings[0];
  const tot = (Number(r.cut_prob) || 0) + (Number(r.hold_prob) || 0) + (Number(r.hike_prob) || 0);
  /* i tre esiti sono esaustivi: se non sommano a 100 la barra impilata mentirebbe sulla larghezza */
  const nudo = forma.n.replace(/<[^>]*>/g, "");
  return Math.abs(tot - 100) <= 2
      && nudo.includes(Math.round(Number(r.hike_prob) || 0) + "% rialzo")
      && nudo.includes(Math.round(Number(r.hold_prob) || 0) + "% fermo")
      && !/Come si legge/.test(forma.n)`));   // il CEO: "non inserire testo guida"

check("v333 liquidita': porta la data della RILEVAZIONE, non quella del payload", suVeri(`
  const l = (DATA.macro || {}).liquidity_split;
  if (!l || !l.retail_date) return true;
  const f = FORMA_INDICATORE["liquidity"](DATA.macro || {});
  const p = String(l.retail_date).split("-");
  return f.n.includes(p[2] + "/" + p[1] + "/" + p[0]) && f.n.includes("MENSILE")
      && !f.n.includes("percentile a 5 anni e'");`));   // il percentile saturo non si pubblica piu'

/* ══ v334 — LA TRATTEGGIATA NON SEGUIVA LA VIOLA, E NON ERA UN DIFETTO DI DISEGNO ══════════
   Il CEO l'ha visto: le due linee di "Borsa vs economia reale" finivano in punti diversi. La
   causa: il Nasdaq e' MENSILE e arriva a oggi, i profitti aziendali sono TRIMESTRALI e la fonte
   li pubblica con mesi di ritardo — 60 punti fino al 2026-08 contro 20 fermi al 2026-01. La
   tratteggiata si fermava prima perche' il DATO finisce prima, e il grafico sembrava rotto.
   ⚠ E' la lezione v207 in una forma nuova: li' due serie non avevano giorni in comune, qui ne
   hanno ma una finisce prima — e l'ultimo tratto, quello che si guarda per primo, confrontava
   una linea viva con una ferma. */
check("v334 borsa vs economia: le due linee coprono la stessa finestra", suVeri(`
  for (const k of ["corp_profit", "decouple"]) {
    const se = serieIndicatore(k);
    if (!se || !se.doppia) continue;
    const [a, b] = se.doppia;
    if (!a.punti.length || !b.punti.length) return false;
    /* devono FINIRE insieme: e' l'ultimo tratto quello che si guarda */
    if (a.punti[a.punti.length - 1].d !== b.punti[b.punti.length - 1].d) return false;
    if (!se.finestra || !se.finestra.inizio || !se.finestra.fine) return false;
  }
  return true`));

check("v334 valutazione: trailing e forward hanno ciascuno il proprio riferimento", suVeri(`
  const f = FORMA_INDICATORE["sp500_pe"](DATA.macro || {});
  if (!f) return true;
  let nudo = f.n.split("<").map((p, i) => i ? p.slice(p.indexOf(">") + 1) : p).join("")
    .split(String.fromCharCode(10)).join(" ").toLowerCase();
  while (nudo.indexOf("  ") >= 0) nudo = nudo.split("  ").join(" ");
  /* la trappola da impedire: leggere la differenza fra i due come un tasso di crescita */
  return nudo.includes("metodologie diverse") && nudo.includes("non e' un tasso di crescita")
      && nudo.includes("proprio riferimento")`));

/* ⚠ le probabilita' per riunione della BoJ NON esistono in forma gratuita affidabile: il CEO
   aveva posto la condizione "solo se trovi fonte attendibile", e la risposta e' che non c'e'.
   Il pacchetto lo DICHIARA invece di stimarle — un numero stimato qui sarebbe indistinguibile
   da uno di mercato. */
check("v334 carry: dichiara che le probabilita' BoJ non ci sono, invece di stimarle", suVeri(`
  const f = FORMA_INDICATORE["carry"](DATA.macro || {});
  if (!f) return true;
  let nudo = f.n.split("<").map((p, i) => i ? p.slice(p.indexOf(">") + 1) : p).join("")
    .split(String.fromCharCode(10)).join(" ").toLowerCase();
  while (nudo.indexOf("  ") >= 0) nudo = nudo.split("  ").join(" ");
  return nudo.includes("non esiste una fonte gratuita affidabile")
      && nudo.includes("stimarle sarebbe inventarle")`));

/* ══ v336 — IL PACCHETTO IN PDF, COL GRAFICO DISEGNATO DA NOI ═════════════════════════════
   Il CEO voleva lo screenshot del grafico TradingView. Non e' possibile, e l'ho VERIFICATO
   invece di dedurlo: il widget vive su tradingview-widget.com, `contentDocument` e' bloccato e
   `drawImage` lancia TypeError — una cattura fatta dalla pagina darebbe un rettangolo VUOTO
   1151x520. Scelta l'alternativa: il grafico lo disegniamo noi sulle barre giornaliere che la
   pipeline pubblica, cosi' l'immagine e' vera e coerente al byte coi numeri del pacchetto.
   ⚠ Niente librerie (il CSP le vieta): il PDF si scrive a mano, con gli operatori nativi. */

/* ⚠ v337 — I CARATTERI CHE WinAnsi NON HA VANNO TRADOTTI, NON BUTTATI. Visto sul PDF vero:
   "trimestrale ? comunicato IR" e "concorrenti e quote ? ultimo 10-K" — la freccia porta il
   senso della riga (dove cercare, in che ordine) e diventava un punto interrogativo, cioe'
   l'opposto di un'indicazione. Il testo era li' e non significava piu' niente. */

/* ⚠ IL GRAFICO NON SI DISEGNA SU DATI CHE NON LO PERMETTONO. Le `sparks` sono chiusure
   sotto-campionate e senza date: con quelle si otterrebbe una linea che SOMIGLIA al prezzo
   senza esserlo, ed e' peggio di nessun grafico — un modello che la legge non ha modo di
   sapere che sta guardando un'approssimazione. */


/* ══ v337 — LE TRE COSE NUOVE, CIASCUNA CON LA SUA GUARDIA ════════════════════════════════
   Costruire un comportamento e non sorvegliarlo e' il modo documentato di perderlo alla
   modifica successiva (v203, v238). Queste tre nascono insieme al codice che descrivono. */

/* ⚠ IL CONFINE GIA' STABILITO IN v188: nascondere qualcosa nella pagina non deve togliere un
   dato al pacchetto. Allora erano le colonne, oggi e' la sezione intera. Il confine regge da
   solo perche' buildPromptPortafoglio() legge DATA e non tocca il DOM — ma "regge per
   costruzione" e' esattamente cio' che smette di essere vero senza che nessuno se ne accorga. */

/* ⚠ LA LEZIONE v315, APPLICATA ALLA CONTRAZIONE: il CEO ha segnalato DUE VOLTE di non riuscire
   a modificare il portafoglio, e la causa era un bottone che c'era e non si trovava. Ora la
   sezione parte CHIUSA e l'unico motivo per cui gli serve e' modificarla: se ✎ Modifica
   finisse dentro il corpo contraibile, avrei ricostruito lo stesso difetto in forma peggiore.
   Il check guarda DOVE STA il bottone nel markup, non se la funzione esiste. */

/* ⚠ E l'esito dei pacchetti non puo' finire dentro cio' che e' nascosto: #pf-nota vive dentro
   #pf-corpo, quindi il bottone del portafoglio deve scrivere altrove. Un messaggio consegnato
   in un elemento invisibile e' la classe v316 (pacchetto generato e non consegnato). */

/* ⚠ IL PDF SENZA GRAFICO. Due pacchetti su tre non parlano di un titolo solo: il costruttore
   deve reggere barre assenti, e soprattutto NON deve stampare la riga che dichiara un grafico
   che non c'e' — un'affermazione che il documento non sostiene e' la classe v240. */

/* ⚠ E la consegna dev'essere il PDF, non la modale: e' la direttiva del CEO ("Il bottone genera
   direttamente il PDF"). Il check guarda che il ripiego esista comunque — se il download non
   parte, la casella si apre. Una strada sola che fallisce in silenzio e' il difetto v316. */

/* ══ v338 — LA RICEVUTA DEL TAGLIO DELLA WATCHLIST ═══════════════════════════════════════
   Il CEO: "la watchlist di tradingview non va bene, torna come prima". Un taglio in questo
   progetto si porta via il vicino tre volte su quattro (CLAUDE.md, v201-v204 e v238), quindi
   il check dice DUE cose insieme: cosa doveva sparire e cosa doveva restare in piedi.
   ⚠ La seconda meta' e' quella che conta davvero: `extended_hours` e i bottoni Nasdaq/S&P
   sono richieste del CEO della stessa versione (v332) che NON ha ritirato, e stavano a poche
   righe dal codice rimosso. */
check("v338 il widget non riceve piu' una watchlist, e la stella e' sparita con lei", (() => {
  const i = src.indexOf('sc.src = "https://s3.tradingview.com/external-embedding');
  const cfg = src.slice(i, src.indexOf("});", i));
  const pagina = readFileSync(join(ROOT, "index.html"), "utf8");
  return i > 0
      && cfg.indexOf("watchlist") < 0
      && src.indexOf("preferitiTradingView") < 0     // nessun residuo, nemmeno nei commenti
      && src.indexOf("aggiornaStellaPreferiti") < 0
      && pagina.indexOf('id="tv-pref"') < 0
      /* ⚠ e la chiave duplicata che la v332 aveva lasciato: `details` due volte nello stesso
         oggetto. Innocua col medesimo valore, ma e' la classe che self_check sorveglia. */
      && (cfg.split("details:").length - 1) === 1;
})());

check("v338 sopravvivono l'overnight e i bottoni degli indici, che il CEO non ha ritirato", (() => {
  const i = src.indexOf('sc.src = "https://s3.tradingview.com/external-embedding');
  const cfg = src.slice(i, src.indexOf("});", i));
  const pagina = readFileSync(join(ROOT, "index.html"), "utf8");
  return cfg.includes("extended_hours: true")
      && src.includes('$("#tv-idx")?.addEventListener')
      && src.includes("function simboloTradingView")   // il montaggio del widget la usa
      && pagina.includes('id="tv-idx"');
})());

/* ⚠ v339 — IL COLORE E' INFORMAZIONE, ANCHE QUANDO DICE "NEUTRO". Il CEO: "Attese sui tassi
   (prossimo FOMC) la percentuale di neutro non si evidenzia". Il segmento "fermo" era dipinto
   con var(--muted), cioe' lo STESSO colore delle etichette dell'asse: il numero c'era ma il
   blocco si leggeva come scocca, non come dato — e "fermo" e' l'esito DOMINANTE quasi sempre.
   Il check guarda una proprieta' verificabile nel sorgente: i tre esiti hanno tre colori
   distinti, e nessuno dei tre e' il colore del testo secondario. */
check("v339 FOMC: i tre esiti hanno colori distinti e nessuno e' quello dell'interfaccia", (() => {
  const i = src.indexOf('const seg = [["taglio"');
  if (i < 0) return false;
  const riga = src.slice(i, src.indexOf(String.fromCharCode(10), i));
  const col = [...riga.matchAll(/var\(--([a-z]+)\)/g)].map(m => m[1]);
  return col.length === 3
      && new Set(col).size === 3          // tre esiti, tre colori
      && col.indexOf("muted") < 0;        // nessuno e' il grigio del testo secondario
})());

/* ⚠ e una probabilita' piccola ma NON nulla non deve sparire perche' il segmento e' stretto:
   e' informazione mancante travestita da informazione presente, la classe C14 gia' pagata. */
check("v339 FOMC: sotto la soglia la percentuale esce di lato invece di sparire", (() => {
  const i = src.indexOf('const seg = [["taglio"');
  const blocco = src.slice(i, i + 1800);
  return blocco.includes("text-anchor=\"start\"") && blocco.includes("v[1] > 0");
})());

/* ⚠⚠ v340 — IL CHECK DELL'ENCODING GIRA SUI PACCHETTI VERI, NON SU CINQUE CARATTERI SCELTI
   A MANO. La stesura di v337 provava una manciata di caratteri decisi da me: e' il "registro
   fisso che invecchia da solo" gia' pagato con C10 e con gli indici 16/17 del red team, e
   infatti mancava proprio i due che contavano — l'EURO (spariva da ogni importo del PDF del
   portafoglio) e il MENO tipografico U+2212 (spariva il segno da "(-6% dal riferimento)").
   Ora si applica pdfTesto ai QUATTRO pacchetti reali e si conta se compaiono "?" che nel
   testo di partenza non c'erano. Nessun elenco da tenere aggiornato: se un domani il payload
   comincia a usare un carattere nuovo, il check lo trova da solo. */

/* ⚠ e l'euro in particolare: WinAnsiEncoding — che il PDF dichiara — lo ha a 0x80, quindi
   NON deve degradare a "EUR" ne' sparire. Un importo senza valuta non e' un importo. */

/* ══ v340 — IL DIVIETO SUI PUNTEGGI VALE ANCHE PER LE SCHEDE, E NESSUN GATE LO GUARDAVA ═══
   ⚠⚠ Il check v337 e C12bis sorvegliano i quattro PACCHETTI. Le SCHEDE no — e infatti la
   scheda MacroQuant ha continuato a stampare DICIANNOVE punteggi 0-100 sotto una colonna
   intitolata "Score" per tre versioni dopo il taglio, cioe' esattamente nel posto che il CEO
   aveva indicato per nome. Peggio: `mq.score` sceglieva ancora la prosa, e produceva una
   contraddizione con l'etichetta nel titolo della stessa card.
   ⚠ Il check ESEGUE la funzione vera e legge l'HTML che produce davvero — non rilegge il
   sorgente. E' la lezione v226: un test che non passa dal codice reale certifica una strada
   immaginaria, e li' mi era gia' costato uno spicchio fantasma spedito in produzione. */
check("v340 schede: la scheda MacroQuant non stampa piu' punteggi, e non li usa per la prosa", suVeri(`
  /* ⚠ SU DATI VERI, non sulla fixture: la fixture non ha macro.macroquant, quindi la scheda
     uscirebbe subito e il check sarebbe verde (o rosso) per ASSENZA DEL FENOMENO, non per
     assenza di difetti. E' la trappola che questo file documenta quattro volte — e scrivendo
     questo stesso check ci sono cascato una quinta, prima di agganciarlo a suVeri. */
  const mq = (DATA.macro || {}).macroquant;
  if (!mq) return true;
  let html = "", titolo = "";
  const vero = openInfoModal;
  openInfoModal = (t, b) => { titolo = t; html = b; };
  try { openMacroQuantModal(); } finally { openInfoModal = vero; }
  if (!html) return false;
  const nudo = html.split("<").map((p, i) => i ? p.slice(p.indexOf(">") + 1) : p).join(" ").toLowerCase();
  /* (a) nessuna colonna intitolata "Score" */
  if (html.indexOf(">Score<") >= 0) return false;
  /* (b) il punteggio composito non compare nel corpo */
  if (mq.score != null && nudo.indexOf(String(mq.score) + "/100") >= 0) return false;
  /* ⚠⚠ (b-bis) E NEMMENO I PUNTEGGI DEI COMPONENTI, IN NESSUNA FORMA. La prima stesura di
     questo check cercava solo ">Score<" e "56/100" e NON MORDEVA: il difetto stampa i numeri
     NUDI ("55", "26", "19") come etichetta della barra. Verificato iniettandolo — passava.
     Ora si contano i punteggi che compaiono come token isolato nel testo: uno puo' coincidere
     per caso con un altro numero della scheda, due no. */
  const numeri = nudo.split(/[^0-9]+/).filter(Boolean);
  const punteggi = (mq.components || []).map(c => c.score).filter(x => x != null).map(String);
  const trovati = punteggi.filter(x => numeri.indexOf(x) >= 0).length;
  if (trovati >= 2) return false;
  /* (c) e la prosa dev'essere coerente con l'ETICHETTA del titolo: prima il corpo diceva
         "Ciclo neutro" (da score 56) mentre il titolo diceva "Rallentamento" (da label) */
  if (mq.label && nudo.indexOf(String(mq.label).toLowerCase()) < 0) return false;
  return titolo.indexOf(String(mq.label)) >= 0`));

/* ══ v341 — I DUE INVARIANTI CHE SOPRAVVIVONO AL TAGLIO ═══════════════════════════════════
   Con tre pacchetti su quattro rimossi, 86 check sono usciti: sorvegliavano funzionalita' che
   il CEO ha chiuso, e tenerli sarebbe stato tenere in vita il ricordo di un sistema che non
   c'e'. Ma DUE di quegli 86 non parlavano dei pacchetti — parlavano di DECISIONI, e le
   decisioni valgono ancora sull'unico pacchetto rimasto. Sono stati riscritti, non persi.
   ⚠ E' la regola di v203 letta al contrario: togliere una guardia mentre si toglie una
   funzionalita' e' il modo piu' rapido di perdere la protezione senza accorgersene. Qui la
   funzionalita' se n'e' andata davvero; l'invariante no. */

/* (1) IL PUNTEGGIO 0-100 NON DEVE TORNARE. Il CEO l'ha tolto in v337 da schede e pacchetto
   ("il dato deve essere asettico da quel parametro"). Fear & Greed e Financial Health restano
   perche' sono indici PUBBLICATI da terzi, nativamente su 0-100: quelli sono il dato. */
check("v341 il pacchetto macro non porta punteggi 0-100 calcolati da noi", suVeri(`
  const t = buildCIOText();
  if (!t || t.length < 5000) return false;          // non e' il pacchetto: check a vuoto
  const ESTERNI = /Fear (&|&amp;) Greed|Financial Health|CNN|F&G/i;
  for (const riga of t.split(String.fromCharCode(10))) {
    /* ⚠ niente regex con escape qui dentro: in un template literal passato a vm si mangiano
       un livello, ed e' gia' costato sei volte in questo progetto. Si conta a mano. */
    const j = riga.indexOf("/100");
    if (j < 1 || !"0123456789".includes(riga[j - 1])) continue;
    if (ESTERNI.test(riga)) continue;
    return false;
  }
  return true`));

/* (2) LA VIA D'USCITA ONESTA (A1bis). Nata da un difetto vero: "cercali online" accanto a "un
   dato che manca si dichiara n.d." rendeva l'INAZIONE la risposta conforme, e un LLM reale ha
   consegnato un referto tutto n.d. La regola impone di dichiarare in una riga di non avere
   rete e fermarsi — che e' una risposta accettabile — invece di riempire il vuoto. */
check("v341 il pacchetto macro prevede la risposta onesta di chi non puo' navigare", suVeri(`
  const t = buildCIOText();
  return t.indexOf("NON HO ACCESSO ALLA RETE") > 0
      && t.indexOf("non produrre") > 0`));

/* ══ v342 — IL PACCHETTO MACRO PUBBLICATO COME FILE ══════════════════════════════════════
   Il CEO lavora con un assistente che non puo' aprire la dashboard: il quadro macro viene
   scritto in data/macro_pack.txt dalla pipeline, e siccome il repo e' PUBBLICO l'assistente
   se lo scarica da solo. Nessun copia-incolla, e il file si rinfresca da se'.
   ⚠⚠ L'INVARIANTE CHE CONTA E' DI RISERVATEZZA, NON DI FORMA: quel file finisce su internet.
   Se un domani tornasse un pacchetto che contiene il portafoglio e qualcuno lo scrivesse
   li' dentro, le posizioni del CEO sarebbero pubbliche. Il check lo impedisce sul file vero,
   non sull'intenzione. */
check("v342 il pacchetto macro pubblico non contiene NESSUN dato di portafoglio", (() => {
  const p = join(ROOT, "data", "macro_pack.txt");
  if (!existsSync(p)) return true;                 // non ancora generato dalla CI
  const t = readFileSync(p, "utf8");
  if (t.length < 8000) return false;               // troncato = peggio che assente
  const SPIE = ["SITUAZIONE PATRIMONIALE", "IL SUO LIBRO", "quote a carico", "PMC ",
                "Prz Medio", "controvalore della posizione"];
  return !SPIE.some(s => t.includes(s));
})());

/* ⚠ e l'emettitore non deve RISCRIVERE il pacchetto: deve ESEGUIRE buildCIOText() dentro una
   vm. Una seconda implementazione diverge dalla prima al primo ritocco — classe v161/v207. */
check("v342 l'emettitore esegue il codice vero, non una copia della logica", (() => {
  const p = join(ROOT, "scripts", "emit_macro_pack.mjs");
  if (!existsSync(p)) return false;
  const s = readFileSync(p, "utf8");
  const ci = readFileSync(join(ROOT, ".github", "workflows", "update-data.yml"), "utf8");
  return s.includes("buildCIOText()")
      && s.includes("vm.runInContext")
      && s.includes("prompt_header_macro.txt")     // la testata vera, non il fallback
      && ci.includes("emit_macro_pack.mjs");       // ed e' davvero cablato nella pipeline
})());

/* ══ v343 — LA DISTANZA FRA DUE USCITE DEVE VALERE UN PASSO, NON DUE ═══════════════════════
   Il difetto trovato: la logica mensile sommava SEMPRE due mesi alla data di rilevazione (un
   passo per il periodo successivo, uno per il ritardo di pubblicazione). Vero per CPI, PCE,
   NFP e vendite al dettaglio, che escono in M+1. Falso per il Philly Fed, che pubblica
   l'indagine del mese DENTRO quel mese: il pacchetto annunciava "prossimo atteso 18/10" su un
   dato uscito il 20/08, cioe' due mesi di silenzio su una serie che parla ogni tre settimane.
   Un LLM che legge quella riga smette di aspettarsi il dato di settembre.
   ⚠ Il check NON verifica le date attese una per una — sarebbe un registro fisso che invecchia
   da solo, la classe C10. Verifica la PROPRIETA': per una serie mensile la prossima uscita
   dista dall'ultima circa un mese, mai due. Vale per qualunque serie si aggiunga domani. */
check("v343 cadenza: per ogni serie la prossima uscita dista UN passo, non due", suVeri(`
  const GIORNO = 86400000;
  const LIMITI = { giornaliero: [1, 4], mensile: [24, 40], trimestrale: [80, 100] };
  for (const k of Object.keys(CADENZA_FONTE)) {
    const c = CADENZA_FONTE[k];
    /* si parte da una rilevazione fittizia ma realistica: il primo del mese scorso */
    const oggi = new Date();
    const rif = new Date(oggi.getFullYear(), oggi.getMonth() - 1, 1);
    const iso = rif.getFullYear() + "-" + String(rif.getMonth() + 1).padStart(2, "0") + "-01";
    const r = cadenzaDato(k, iso);
    if (!r || !r.prossimo) continue;
    /* ⚠ la base del confronto cambia col passo, e confonderle da' un risultato senza senso:
       per una serie GIORNALIERA il passo si misura dall'osservazione (il giorno lavorativo
       dopo); per mensili e trimestrali dalla PUBBLICAZIONE stimata, perche' e' quella la
       cadenza con cui il dato arriva a chi legge. */
    let base = new Date(iso + "T00:00:00");
    if (c.passo === "mensile") { base.setMonth(base.getMonth() + (c.mesiRitardo == null ? 1 : c.mesiRitardo)); base.setDate(Math.min(c.giorniLag || 15, 28)); }
    else if (c.passo === "trimestrale") { base.setMonth(base.getMonth() + 3); base.setDate(Math.min(c.giorniLag || 15, 28)); }
    const d = Math.round((new Date(r.prossimo + "T00:00:00") - base) / GIORNO);
    const lim = LIMITI[c.passo];
    if (!lim) continue;
    if (d < lim[0] || d > lim[1]) return false;
  }
  return true`));

/* ⚠ e l'ETA' non si conta dal periodo MISURATO ma dall'uscita: FRED data i mensili al primo
   del mese di riferimento, quindi contare da li' gonfia l'eta' di tutto il ritardo di
   pubblicazione. Sul Philly Fed un dato di due giorni usciva come "21 giorni fa". */
check("v343 cadenza: l'eta' di una serie non supera mai il suo intervallo di pubblicazione", suVeri(`
  const oggi = new Date();
  for (const k of Object.keys(CADENZA_FONTE)) {
    const c = CADENZA_FONTE[k];
    if (c.passo !== "mensile") continue;
    /* rilevazione del mese scorso: appena pubblicata o quasi, l'eta' non puo' essere di mesi */
    const rif = new Date(oggi.getFullYear(), oggi.getMonth() - 1, 1);
    const iso = rif.getFullYear() + "-" + String(rif.getMonth() + 1).padStart(2, "0") + "-01";
    const r = cadenzaDato(k, iso);
    if (!r) continue;
    /* tolleranza larga per le serie con ritardo di licenza dichiarato (UMich via FRED) */
    const tetto = 40 + (c.giorniLag || 0);
    if (r.eta > tetto) return false;
    if (r.eta < 0) return false;
  }
  return true`));

/* ══ v344 — IL PACCHETTO DICHIARA IL PROPRIO PERIMETRO ════════════════════════════════════
   Un LLM che legge 22.000 caratteri intitolati "quadro macro" lo tratta come completo. Il
   22/08 e' costato caro: il pacchetto NON sapeva che dal 22/05/2026 la Fed ha un presidente
   nuovo (zero occorrenze in tutto il file) ne' che Jackson Hole cadeva quella settimana. Il
   modello se n'e' accorto solo perche' ha cercato di sua iniziativa.
   ⚠ La correzione NON e' mettere quei fatti nel pacchetto: cambiano di rado e in modo
   imprevedibile, quindi invecchierebbero in silenzio — che e' precisamente il difetto che si
   vuole evitare. La correzione e' che il pacchetto dica DOVE FINISCE e mandi a cercare il
   resto. Un perimetro dichiarato non invecchia; un fatto sul presidente della Fed si'. */
check("v344 il pacchetto dichiara cosa NON sa, prima dei numeri", suVeri(`
  const t = buildCIOText();
  const i = t.indexOf("PERIMETRO DI QUESTO PACCHETTO");
  const q = t.indexOf("QUADRO MACRO:");
  if (i < 0 || q < 0) return false;
  if (i > q) return false;                          // deve stare PRIMA dei numeri
  const blocco = t.slice(i, q);
  /* le quattro cecita' che il caso reale ha esposto, piu' l'istruzione di andare a cercare */
  return blocco.indexOf("presidenza della Fed") > 0
      && blocco.indexOf("EVENTI NON STATISTICI") > 0
      && blocco.indexOf("NOTIZIE SOCIETARIE") > 0
      && blocco.indexOf("cerca online") > 0`));

/* ══ v345 — DUE COSE CHE IL SISTEMA AVEVA E NON PUBBLICAVA ════════════════════════════════
   Misurato: la parte del pacchetto irreperibile online pesava 775 caratteri su 22.832 — il
   3,4%. Tutto il resto si trova cercando. Allargare quel 3,4% e' l'unico modo di rendere il
   pacchetto piu' utile senza allungarlo inutilmente, e le serie c'erano gia' in data.json:
   369 punti sul Treasury 10A e 30A, 126 su rame e petrolio, mai interrogati.
   ⚠ Un livello non dice niente da solo: "10 anni al 4,74%" e' un numero, "al 99° percentile
   del suo intervallo di 18 mesi" e' un'informazione — e su un libro lungo di duration per tre
   quarti e' LA notizia. */
check("v345 il digest storico misura anche tassi e input industriali, non solo credito e VIX", suVeri(`
  const d = buildHistoricalDigests();
  const et = d.map(x => x.label).join(" | ");
  const conPercentile = d.filter(x => /percentile/.test(x.text || "")).length;
  return /Treasury 10A/.test(et) && /Treasury 30A/.test(et)
      && /Rame/.test(et) && /Petrolio/.test(et)
      && conPercentile >= 5`));

/* ⚠ E LA CURVA DELLE ATTESE FED, non solo il primo punto. `fedwatch.meetings` portava TRE
   riunioni con le loro probabilita' e il pacchetto ne pubblicava una: sulla piu' vicina la Fed
   sembra ferma, tre riunioni piu' in la' il rialzo e' quotato molto di piu'. E' la PENDENZA a
   dire cosa prezza il mercato — pubblicare solo il primo punto fa sembrare fermo un mercato
   che sta dicendo "ferma per ora". Classe v199 rovesciata: li' il contratto non prezzava quella
   riunione, qui prezzava anche le successive e non lo dicevamo. */
check("v345 il pacchetto pubblica la struttura a termine delle attese Fed, non solo la prossima", suVeri(`
  const riunioni = ((DATA.macro || {}).fedwatch || {}).meetings || [];
  if (riunioni.length < 2) return true;          // con una sola riunione non c'e' curva da dire
  const p = buildPrompt();
  if (p.indexOf("STRUTTURA A TERMINE DELLE ATTESE FED") < 0) return false;
  /* la seconda riunione dev'essere nominata: e' il punto che il pacchetto prima taceva */
  const d2 = String(riunioni[1].date || "");
  return d2.length >= 10 && p.indexOf(d2.slice(8, 10) + "/" + d2.slice(5, 7)) > 0`));

/* ══ v346 — "CORREZIONE O ROTTURA?" ERA INDECIDIBILE COL PACCHETTO ════════════════════════
   La rotazione dava 1 mese e 3 mesi. Con quei due soli numeri un comparto a -3,4% e'
   indistinguibile fra "correzione dentro un rialzo intatto" e "tendenza che si e' girata" —
   che e' la differenza fra tenere e non tenere, cioe' la domanda piu' importante che si possa
   fare su una posizione lunga.
   La risposta era gia' nei dati: ogni ETF porta `medie` con la DISTANZA del prezzo da
   ma20/50/100/200 e la PENDENZA di ciascuna. Sui semiconduttori oggi: brevi in calo, lunghe in
   salita, prezzo il 20% sopra la 200 — correzione, non rottura.
   ⚠ NON si pubblicano tutti e 21 (sarebbero settanta righe di rumore) e NON si sceglie con un
   elenco di ticker scritto a mano, che invecchierebbe da solo (classe C10). Si pubblicano solo
   quelli in cui la lettura e' AMBIGUA — pendenza breve e lunga di segno opposto — che e'
   esattamente l'insieme dei casi in cui la domanda e' viva. Il criterio si auto-seleziona. */
check("v346 la struttura delle medie esce solo dove breve e lungo NON concordano", suVeri(`
  const t = (DATA.macro || {}).tilt || [];
  if (!t.length) return true;
  const pend = (s, k) => (((s.medie || {})[k] || {}).pendenza_pct);
  const attesi = t.filter(s => {
    const b = pend(s, "ma20"), l = pend(s, "ma200");
    return Number.isFinite(b) && Number.isFinite(l) && (b < 0) !== (l < 0);
  });
  const p = buildPrompt();
  if (!attesi.length) return p.indexOf("STRUTTURA DELLE MEDIE") < 0;
  if (p.indexOf("STRUTTURA DELLE MEDIE") < 0) return false;
  const blocco = p.slice(p.indexOf("STRUTTURA DELLE MEDIE"));
  const fine = blocco.indexOf(String.fromCharCode(10) + "- P/E");
  const testo = fine > 0 ? blocco.slice(0, fine) : blocco;
  /* nessun settore CONCORDE deve comparire: sarebbe rumore travestito da segnale */
  for (const s of t) {
    const b = pend(s, "ma20"), l = pend(s, "ma200");
    const concorde = Number.isFinite(b) && Number.isFinite(l) && (b < 0) === (l < 0);
    if (concorde && testo.indexOf("(" + s.ticker + ")") >= 0) return false;
  }
  return true`));

/* ⚠ e l'ORDINE e' un giudizio (v200): qui e' dichiarato — per divergenza fra la pendenza a 20
   giorni e quella a 200, cioe' per quanto la domanda e' aperta. Prima era l'ordine per
   performance a un mese, ereditato dalla lista sopra, e col tetto di sei righe tagliava a caso
   proprio il comparto su cui la domanda contava di piu'. */
check("v346 i settori ambigui sono ordinati per divergenza, e l'ordine e' dichiarato", suVeri(`
  const t = (DATA.macro || {}).tilt || [];
  const pend = (s, k) => (((s.medie || {})[k] || {}).pendenza_pct);
  const amb = t.filter(s => {
    const b = pend(s, "ma20"), l = pend(s, "ma200");
    return Number.isFinite(b) && Number.isFinite(l) && (b < 0) !== (l < 0);
  }).sort((x, y) => Math.abs(pend(y,"ma20") - pend(y,"ma200")) - Math.abs(pend(x,"ma20") - pend(x,"ma200")));
  if (amb.length < 2) return true;
  const p = buildPrompt();
  if (p.indexOf("In ordine di DIVERGENZA") < 0) return false;   // l'ordine va dichiarato
  /* ⚠ SI CERCA DENTRO IL BLOCCO, non in tutto il pacchetto: l'elenco della rotazione qui sopra
     contiene gli stessi ticker in ordine di performance, e cercare li' misura l'ordine di
     un'altra lista. La prima stesura di questa sonda ci e' cascata. */
  const inizio = p.indexOf("STRUTTURA DELLE MEDIE");
  if (inizio < 0) return false;
  const resto = p.slice(inizio);
  const fine = resto.indexOf(String.fromCharCode(10) + "- P/E");
  const blocco = fine > 0 ? resto.slice(0, fine) : resto;
  const i0 = blocco.indexOf("(" + amb[0].ticker + ")"), i1 = blocco.indexOf("(" + amb[1].ticker + ")");
  return i0 > 0 && i1 > 0 && i0 < i1`));

/* ══ v347 — I CHECK TORNANO CON IL CODICE CHE SORVEGLIAVANO ══════════════════════════════
   La v341 ne aveva tolti 86 perche' il pacchetto del titolo e quello del portafoglio non
   esistevano piu': un check su codice assente e' un ramo irraggiungibile (classe v234).
   Ora il codice torna e con lui i suoi invarianti. Ne rientrano 53 e non 86: gli altri
   sorvegliavano il pacchetto di SETTORE, quello di PORTAFOGLIO e il PDF, che restano fuori
   perche' il CEO non li ha chiesti. Ripristinare anche quelli sarebbe la classe v201-v204 nel
   verso opposto: riportare indietro il vicino di cio' che serviva.
   ⚠⚠ L'ESTRAZIONE E' STATA SBAGLIATA TRE VOLTE, e ogni volta il guardiano ha rifiutato la
   scrittura invece di lasciare il file rotto: (1) risalendo il commento sopra un check si
   catturava la CODA di un commento senza la sua apertura; (2) la coda del segmento portava con
   se' il commento del check successivo; (3) portava anche una DICHIARAZIONE CONDIVISA del file
   (SEZIONI_DI_INDEX), che reinserita si duplicava. Un blocco estratto da una versione vecchia
   non e' "il testo fra due righe": e' un'unita' sintattica, e va verificata come tale. */

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

check("v257 analisi titolo: chiede le consegne che il CEO ha elencato", suVeri(`
  const t = buildPromptTicker("NVDA");
  return /Concorrente/.test(t) && /[Qq]uota di mercato/.test(t)
      && /[Tt]rimestral/.test(t) && /PROSSIMA/.test(t)
      && /Supporti e resistenze/.test(t) && /SENTIMENT/.test(t)
      && /[Ii]ngressi|DECISIONI SULLA POSIZIONE APERTA/.test(t)
      && /rischio-rendimento/.test(t)`));

check("v257 analisi titolo: dichiara data del dato macro e prossimo aggiornamento", suVeri(`
  const t = buildPromptTicker("NVDA");
  return /Snapshot del /.test(t) && /prossimo aggiornamento atteso/.test(t)
      && /prossimo run del sistema/.test(t)`));

check("v257 analisi titolo: porta dentro di se' il quadro macro", suVeri(`
  const t = buildPromptTicker("NVDA");
  return /ANALISI DI NVDA/.test(t) && /QUADRO MACRO/.test(t)`));

check("v308 analisi titolo: il divieto di dimensionare resta, con la ragione giusta", suVeri(`
  const t = buildPromptTicker("NVDA");
  return t.indexOf("In nessun caso dimensionare") >= 0
      && t.indexOf("niente stop in euro") >= 0
      && t.indexOf("non conosce liquidita'") >= 0
      && t.indexOf("Non conosco la tua posizione") < 0`));

check("v308 analisi titolo: dichiara la posizione se c'e', tace se non c'e'", suVeri(`
  const dentro = ((DATA.watchlist || []).find(r => r && r.qta > 0 && r.pmc > 0) || {}).ticker;
  if (!dentro) return true;
  const conPos = buildPromptTicker(dentro);
  const senzaPos = buildPromptTicker("TSLA");
  return conPos.indexOf("GIA' IN PORTAFOGLIO") >= 0
      && senzaPos.indexOf("GIA' IN PORTAFOGLIO") < 0`));

check("v256 analisi titolo: ticker vuoto non produce nessun pacchetto", suVeri(`
  return buildPromptTicker("") === "" && buildPromptTicker("   ") === ""`));

check("v256 analisi titolo: una sola testata nel pacchetto (quella spot), non due", suVeri(`
  const t = buildPromptTicker("NVDA");
  const h = promptHeaderText();
  return !t.includes(h)`));

check("v271 pacchetto titolo: porta i livelli che il sistema gia' conosce", run(`
  const p = buildPromptTicker("NVDA");
  const r = (DATA.watchlist || []).concat(DATA.portfolio || []).find(x => x.ticker === "NVDA");
  if (!r) return true;
  return p.includes("QUELLO CHE IL SISTEMA SA GIA'")
      && p.includes(String(r.support)) && p.includes(String(r.resistance))
      && p.includes(String(r.rsi))`));

check("v271 pacchetto titolo: dice cosa fare se il web diverge, invece di lasciar scegliere in silenzio", (() => {
  const i = src.indexOf("function datiNostriDelTitolo");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 1));
  return corpo.includes("2%")                       // la soglia di materialita' e' dichiarata
      && /entrambi i valori|tutti e due/.test(corpo)  // si scrivono tutti e due, non uno solo
      && /silenzio/.test(corpo);                      // e la scelta silenziosa e' nominata come tale
})());

check("v271 pacchetto titolo: nessun blocco per un titolo che la pipeline non segue", run(`
  return !buildPromptTicker("ZZZZ-INESISTENTE").includes("QUELLO CHE IL SISTEMA SA GIA'")`));

check("v273 pacchetto titolo: il prezzo pre/after entra nel pacchetto, non solo in tabella", (() => {
  /* v274 — il pre/after non si rilegge piu' da quoteLive qui dentro: arriva da fattiTitolo,
     il punto unico. La proprieta' da controllare resta che il pacchetto lo PORTI. */
  const i = src.indexOf("function datiNostriDelTitolo");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /f\.ext/.test(corpo) && /PRE-MARKET/.test(corpo) && /AFTER-HOURS/.test(corpo);
})());

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

check("v275 prezzi: il ritardo e' dichiarato nel pacchetto per l'analisi", (() => {
  const j = src.indexOf("function datiNostriDelTitolo");
  const pac = src.slice(j, src.indexOf("\nfunction ", j + 10));
  return /ritardati di circa 15 minuti/.test(pac);
})());

check("v276 pacchetto: il prezzo di riferimento porta l'ora della lettura", (() => {
  const i = src.indexOf("function datiNostriDelTitolo");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /letto dal browser alle \$\{ora\}/.test(corpo);
})());

check("v284 opzioni: la scheda e il pacchetto dichiarano se la scadenza non e' la piu' vicina", (() => {
  const i = src.indexOf("async function renderOpzioniGrafico");
  const scheda = src.slice(i, src.indexOf("\nfunction ", i + 10));
  const j = src.indexOf("function datiNostriDelTitolo");
  const pac = src.slice(j, src.indexOf("\nfunction ", j + 10));
  return /Non è la scadenza più vicina/.test(scheda) && /NON e' la scadenza piu' vicina/.test(pac);
})());

check("v286 opzioni: volumi e contratti aperti sono etichettati per quello che sono", (() => {
  const i = src.indexOf("function datiNostriDelTitolo");
  const corpo = src.slice(i, src.indexOf("\nfunction ", i + 10));
  return /volumi scambiati oggi/.test(corpo) && /CONTRATTI APERTI/.test(corpo)
      && /grandezza diversa dai volumi/.test(corpo);
})());

check("v293 consegna: il pacchetto titolo porta un tetto di lunghezza", suVeri(`
  const p = buildPromptTicker("AMD");
  return /BUDGET: [\\d.\\-]+ parole IN TUTTO/.test(p) && /vincolo, non un'indicazione/.test(p)`));

check("v293 consegna: gli otto blocchi richiesti ci sono tutti e in ordine", suVeri(`
  const p = buildPromptTicker("AMD");
  const ordine = ["0) IL GIUDIZIO", "1) QUADRO MACRO", "2) L'AZIENDA", "3) TRIMESTRALI",
                  "4) I CONTI", "5) TECNICA", "6) SENTIMENT", "7) LA CHIUSURA"];
  let pos = -1;
  for (const b of ordine) { const i = p.indexOf(b); if (i < 0 || i < pos) return false; pos = i; }
  return /BREVE \\(settimane\\)/.test(p) && /MEDIO \\(3-12/.test(p) && /LUNGO \\(oltre/.test(p)
      && /analista di Wall Street/.test(p)`));

check("v293 tecnica: EMA e Fibonacci sono nel pacchetto, calcolati dal sistema", suVeri(`
  const p = buildPromptTicker("AMD");
  const daPagina = /Medie esponenziali: EMA 20 [\\d.]+/.test(p);
  const daPipeline = /Media esponenziale 50: [\\d.]+/.test(p);
  return (daPagina || daPipeline)
      && (daPagina ? /calcolate dal sistema su \\d+ barre giornaliere/.test(p) : true)
      && /Ritracciamenti di Fibonacci sul range a 52 settimane/.test(p)
      && /calcolo esatto sui due estremi/.test(p)`));

check("v349 tecnica: la stessa media non esce due volte con due valori", suVeri(`
  for (const tk of ["MU", "AMD", "NVDA"]) {
    const p = buildPromptTicker(tk);
    /* misurato su MU: "EMA 50 906.65" lato pagina e "Media esponenziale 50: 907.06" lato
       pipeline, nello stesso pacchetto, a trentotto righe di distanza */
    if (/Medie esponenziali: EMA/.test(p) && /Media esponenziale 50:/.test(p)) return false;
    /* e il pacchetto non puo' dichiarare impossibile un calcolo che poi pubblica */
    if (/EMA 200 NON calcolata/.test(p) && /Media esponenziale 200: [\\d.]+/.test(p)) return false;
  }
  return true;`));

check("v293 tecnica: l'EMA 200 non si pubblica, e si dice perche'", suVeri(`
  const p = buildPromptTicker("AMD");
  if (!/Medie esponenziali/.test(p)) return true;
  return /EMA 200 NON calcolata/.test(p) && /servirebbero 200 barre giornaliere/.test(p)
      && !/EMA 200 [\\d]/.test(p)`));

check("v293 tecnica: i livelli di Fibonacci tornano col range dichiarato", suVeri(`
  const p = buildPromptTicker("AMD");
  const m = p.match(/Fibonacci sul range a 52 settimane \\(massimo ([\\d.]+), minimo ([\\d.]+)\\): ([^\\n]+)/);
  if (!m) return true;
  const hi = parseFloat(m[1]), lo = parseFloat(m[2]);
  const meta = m[3].match(/50% a ([\\d.]+)/);
  if (!meta) return false;
  return Math.abs(parseFloat(meta[1]) - (hi - 0.5 * (hi - lo))) < 0.02`));

check("v296 contraddittorio: il pacchetto chiede la tesi opposta, e la chiede per ultima", suVeri(`
  const p = buildPromptTicker("AMD");
  const i8 = p.indexOf("8) LA TESI CONTRARIA");
  const i7 = p.indexOf("7) LA CHIUSURA");
  const i0 = p.indexOf("0) IL GIUDIZIO");
  /* dopo la conclusione, non dopo il giudizio: per attaccare una tesi bisogna averla prima
     argomentata con le prove, altrimenti e' teatro. */
  return i8 > i7 && i7 > i0 && /obbligatoria/.test(p)`));

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

check("v299 pacchetto titolo: porta i fondamentali che il sistema gia' possiede", suVeri(`
  const p = buildPromptTicker("AMD");
  const r = [...(DATA.portfolio||[]), ...(DATA.watchlist||[])].find(x => x.ticker === "AMD");
  if (!r) return true;
  const c = [];
  if (r.eps != null) c.push("Utile per azione (EPS");
  if (r.beta != null) c.push("Beta: " + r.beta);
  if (r.rs_1m != null) c.push("Forza relativa a 1 mese");
  return c.every(x => p.includes(x)) && (() => {
    const px = numero(r.prezzo_limite_aggiustato ?? r.price);
    const res = numero(r.resistance), atr = numero(r.atr_14);
    if (![px, res, atr].every(Number.isFinite) || atr <= 0 || res <= px) return true;
    const atteso = "1:" + (Math.round((res - px) / (2 * atr) * 10) / 10);
    return p.includes("Rapporto rischio/rendimento: " + atteso)
        && p.includes("LA BASE E' IL PREZZO CHE PAGHERESTI");
  })()`));

check("v299 pacchetto titolo: nessun punteggio composito rientra dalla finestra", suVeri(`
  const p = buildPromptTicker("AMD");
  return !p.includes("fin_health") && !p.includes("Financial Health")
      && !p.includes("Salute finanziaria")`));

check("v299 pacchetto titolo: elenca cosa non ha e obbliga a dichiarare i buchi", suVeri(`
  const p = buildPromptTicker("AMD");
  return p.includes("QUELLO CHE IL SISTEMA NON HA")
      && p.includes("NON VERIFICATO:")
      && p.includes("Un numero plausibile inventato e' peggio di un buco dichiarato")`));

check("v307 portafoglio: il bond vale nominale x prezzo/100, non quote x prezzo", (() => {
  const i = src.indexOf("function renderPortafoglio");
  const corpo = src.slice(i, src.indexOf(String.fromCharCode(10) + "function ", i + 10));
  return corpo.includes("q * p / 100") && corpo.includes("startsWith(\"BTP\")");
})());

check("v307 portafoglio: il peso converte in euro, e lo dichiara", (() => {
  const i = src.indexOf("function renderPortafoglio");
  const corpo = src.slice(i, src.indexOf(String.fromCharCode(10) + "function ", i + 10));
  return corpo.includes("valEur") && corpo.includes("DATA.eurusd")
      && corpo.includes("sommare dollari ed euro");
})());

check("v307 portafoglio: gli handler stanno sul contenitore, non sulle righe", (() => {
  const i = src.indexOf("function renderPortafoglio");
  const corpo = src.slice(i, src.indexOf(String.fromCharCode(10) + "function ", i + 10));
  return corpo.includes("box.addEventListener");
})());

check("v307 portafoglio: le posizioni non seguite vengono dichiarate", (() => {
  const i = src.indexOf("function renderPortafoglio");
  const corpo = src.slice(i, src.indexOf(String.fromCharCode(10) + "function ", i + 10));
  return corpo.includes("non_seguite");
})());

check("v310 fatti: il peso nel libro nasce in fattiTitolo, non in chi lo stampa", (() => {
  const i = src.indexOf("function fattiTitolo");
  const corpo = src.slice(i, src.indexOf(String.fromCharCode(10) + "function ", i + 10));
  const j = src.indexOf("function datiNostriDelTitolo");
  const disegna = src.slice(j, src.indexOf(String.fromCharCode(10) + "function ", j + 10));
  return corpo.includes("pesoLibro") && disegna.includes("tec.pesoLibro")
      && !disegna.includes("DATA.eurusd");
})());

check("v311 portafoglio: input non valido = nessuna scrittura, e lo dice", (() => {
  const i = src.indexOf("async function salvaPosizioni");
  const corpo = src.slice(i, src.indexOf("async function", i + 10) > 0
    ? src.indexOf("async function", i + 10) : src.length);
  return corpo.includes("Non ho salvato niente")
      && corpo.includes("un salvataggio parziale sarebbe peggio")
      && /if \(errori\.length\)[\s\S]{0,200}return;/.test(corpo);
})());

check("v311 portafoglio: un titolo nuovo entra anche nella watchlist, dichiarandolo", (() => {
  const i = src.indexOf("async function salvaPosizioni");
  const corpo = src.slice(i, src.indexOf("\n}\n", i) + 3);
  return corpo.includes("WATCHLIST_PATH")
      && corpo.includes("Ho aggiunto anche alla watchlist")
      && corpo.includes("la pipeline non ne prenderebbe il prezzo");
})());

check("v311 portafoglio: senza token dichiara che il salvataggio e' locale", (() => {
  const i = src.indexOf("async function salvaPosizioni");
  const corpo = src.slice(i, src.indexOf("\n}\n", i) + 3);
  return corpo.includes("solo su questo browser") && corpo.includes("la pipeline non lo legge");
})());

check("v311 portafoglio: togliere una riga non scrive niente finche' non si salva", (() => {
  const i = src.indexOf('const togli = t.closest(".pf-togli")');
  const corpo = src.slice(i, i + 500);
  return corpo.includes("removeChild") && !corpo.includes("salvaPosizioni")
      && src.includes('t.closest("#pf-annulla")');
})());

check("v311 portafoglio: la forma parte dai dati veri, non da un elenco separato", (() => {
  const i = src.indexOf("function posizioniCorrenti");
  const corpo = src.slice(i, src.indexOf(String.fromCharCode(10) + "function ", i + 10));
  return corpo.includes("DATA.portfolio") && corpo.includes("DATA.watchlist");
})());

check("v314 medie: il verso e' scritto in parole, non lasciato dedurre", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "MU" && x.sma200_dist_pct != null);
  if (!r) return true;
  const p = buildPromptTicker("MU");
  const m = p.match(/Media a 200 sedute: ([\\d.]+) — il prezzo le sta ([+-][\\d,]+%), cioe' (SOPRA|SOTTO)/);
  if (!m) return false;
  /* ⚠⚠ v340 — L'INVARIANTE E' L'IDENTITA', NON LA VICINANZA. La vecchia stesura confrontava
     il livello stampato con la sua stessa ri-derivazione: confermava l'assunzione invece di
     misurare una proprieta' (la lezione comune dei tre difetti di v326). E la tolleranza a
     0,5 era un pavimento numerico che invecchiava col prezzo — su MU a 552 lo scarto ci
     stava sotto, a 1027 vale 0,76 e il check e' esploso da solo, per il motivo giusto e per
     caso. Ora: la stessa media stampata due volte nello stesso pacchetto deve portare lo
     STESSO numero, e quel numero dev'essere quello che la pipeline pubblica. Nessuna soglia. */
  const liv = Number(m[1]);
  const med = ((((r.tv || {}).tecnica || {}).medie || {}).sma200 || {});
  if (Number.isFinite(med.liv) && liv !== med.liv) return false;
  const m2 = p.match(/Media semplice 200: ([\d.]+) —/);
  if (m2 && Number(m2[1]) !== liv) return false;
  return m[3] === (r.sma200_dist_pct >= 0 ? "SOPRA" : "SOTTO")`));

check("v314 medie: SMA ed EMA dichiarano entrambe il livello", suVeri(`
  const p = buildPromptTicker("MU");
  const sma = /Media a \\d+ sedute: [\\d.]+ —/.test(p);
  const ema = /EMA \\d+ [\\d.]+ \\([+-]/.test(p);
  if (!/Medie esponenziali/.test(p)) return sma;
  return sma && ema`));

check("v315 portafoglio: il bottone e' un interruttore e lo dichiara", (() => (
  src.indexOf("pfInModifica = !pfInModifica") >= 0
  && src.indexOf('pfInModifica ? "✕ Chiudi modifica" : "✎ Modifica"') >= 0
))());

check("v315 portafoglio: si ordina di default per peso, non per guadagno", (() => (
  /let pfOrdine = \{ campo: "peso"/.test(src)
))());

check("v315 portafoglio: ogni colonna ordina davvero, e il verso si inverte", suVeri(`
  const q = document.querySelector, presi = {};
  const finto = (s) => presi[s] || (presi[s] = { innerHTML: "", textContent: "", hidden: false, classList: { add(){}, remove(){}, toggle(){}, contains: () => false }, style: {}, dataset: {}, querySelectorAll: () => [], addEventListener(){}, setAttribute(){}, getAttribute: () => null });
  document.querySelector = (s) => finto(s);
  const leggi = (campo, verso) => {
    pfOrdine = { campo, verso }; renderPortafoglio();
    const t = finto("#pf-righe").innerHTML;
    return (t.match(/data-pf-tk="([^"]+)"/g) || []).map(x => x.slice(12, -1));
  };
  try {
    const peso = leggi("peso", "giu"), pesoSu = leggi("peso", "su"), gain = leggi("gain", "giu");
    /* invertire il verso deve rovesciare l'elenco, e un campo diverso deve dare un ordine diverso:
       due proprieta' osservabili, non un elenco atteso che invecchia col portafoglio */
    return peso.length >= 5
      && JSON.stringify(pesoSu) === JSON.stringify([...peso].reverse())
      && JSON.stringify(gain) !== JSON.stringify(peso);
  } finally { document.querySelector = q; }`));

check("v315 portafoglio: la colonna in euro converte e il BTP resta nominale x prezzo", suVeri(`
  const q = document.querySelector, presi = {};
  const finto = (s) => presi[s] || (presi[s] = { innerHTML: "", textContent: "", hidden: false, classList: { add(){}, remove(){}, toggle(){}, contains: () => false }, style: {}, dataset: {}, querySelectorAll: () => [], addEventListener(){}, setAttribute(){}, getAttribute: () => null });
  document.querySelector = (s) => finto(s);
  try {
    renderPortafoglio();
    const t = finto("#pf-righe").innerHTML;
    if (!/In euro/.test(t)) return false;
    const btp = (DATA.portfolio || []).concat(DATA.watchlist || []).find(r => r && String(r.ticker).startsWith("BTP"));
    if (!btp) return true;
    const atteso = Math.round(btp.qta * btp.price / 100);
    return t.indexOf("€" + fmtNum.format(atteso)) >= 0;
  } finally { document.querySelector = q; }`));

check("v316 titolo: la colonna di TradingView e' nel pacchetto, calcolata da noi", run(`
  const _s = DATA;
  DATA = JSON.parse(JSON.stringify(REALE));
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "MU");
  if (!r) { DATA = _s; return true; }
  r.tv = ${JSON.stringify(TV_FINTO)};
  recomputeTotals();
  try {
    const p = buildPromptTicker("MU");
    return /PERFORMANCE PER ORIZZONTE/.test(p)
        && /DETTAGLI TECNICI \\(calcolati dal sistema, non letti da terzi\\)/.test(p)
        && /CONTO ECONOMICO TRIMESTRALE/.test(p)
        && /STAGIONALITA' DEL TITOLO/.test(p)
        && /SENSIBILITA' MISURATE/.test(p);
  } finally { DATA = _s; recomputeTotals(); }`));

check("v316 sensibilita': ogni beta viaggia col suo R², col campione e con la finestra", run(`
  const _s = DATA;
  DATA = JSON.parse(JSON.stringify(REALE));
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "MU");
  if (!r) { DATA = _s; return true; }
  r.tv = ${JSON.stringify(TV_FINTO)};
  recomputeTotals();
  try {
    const p = buildPromptTicker("MU");
    const righe = p.split(String.fromCharCode(10)).filter(x => /^- (settore|tassi) \\(/.test(x));
    return righe.length === 2
        && righe.every(x => /beta [+-]?[\\d.]+/.test(x) && /R² [\\d.]+/.test(x) && /Campione \\d+ sedute comuni/.test(x))
        && /NESSUNA relazione misurabile/.test(righe.find(x => x.startsWith("- tassi")))
        && /canale DOMINANTE/.test(righe.find(x => x.startsWith("- settore")));
  } finally { DATA = _s; recomputeTotals(); }`));

check("v316 titolo: senza i dati della pipeline il blocco non esiste e non si inventa un ripiego", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "MU");
  if (r) delete r.tv;
  const p = buildPromptTicker("MU");
  return !/DETTAGLI TECNICI/.test(p) && !/--- COME IL MACRO ARRIVA A/.test(p)
      && !/PERFORMANCE PER ORIZZONTE/.test(p) && p.length > 5000`));

check("v316 live: il refresh ricalcola il guadagno che la tabella legge davvero", (() => {
  const i = src.indexOf("const upd = (r) => {");
  const corpo = src.slice(i, i + 1200);
  return corpo.includes("r.qta ?? r.qty")
      && corpo.includes("gain_pct_pos")
      && src.slice(src.indexOf("renderShockAlert();"), src.indexOf("renderShockAlert();") + 400).includes("renderPortafoglio()");
})());

check("v322 fibonacci: la pagina e il pacchetto mostrano gli STESSI livelli", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "MU" && x.w52_high && x.w52_low);
  if (!r) return true;
  const R = r.w52_high - r.w52_low;
  const attesi = [0.236, 0.382, 0.5, 0.618, 0.786].map(q => Math.round((r.w52_high - q * R) * 100) / 100);
  const p = buildPromptTicker("MU");
  /* nel pacchetto ci sono tutti, e sono quelli calcolati dagli estremi a 52 settimane */
  return attesi.every(v => p.includes(String(v)));`));


/* ══ v348 — IL DIARIO NEL PACCHETTO ═════════════════════════════════════════════════════════
   Il diario e' l'unica parte del pacchetto che dice cosa il CEO ha GIA' fatto. Sbagliarlo non
   produce un buco ma una bugia: un'operazione attribuita al titolo sbagliato e' peggio di
   nessuna operazione. Questi check nascono tutti da errori veri fatti scrivendolo. */
const DIARIO_FIXTURE = JSON.stringify([
  { date: "2026-08-07", text: "Acquisto 40 quote BE a 214 il 07/08/2026",
    op: { tipo: "ACQUISTO", qty: 40, ticker: "BE", prezzo: 214, quando: "07/08/2026" } },
  { date: "2026-07-15", text: "vendita Cerebras quantita' 30 prezzo 190,10 il 15 luglio 2026" },
  { date: "2026-06-29", text: "Alleggerito micron 20 azioni e amd  25 e venduto Intel e tesla tutto il 24 giugno 2026" },
]);
const conDiario = (code) => suVeri(`
  const _d = DIARIO_VOCI;
  DIARIO_VOCI = ${DIARIO_FIXTURE};
  try { ${code} } finally { DIARIO_VOCI = _d; }`);

check("v348 diario: le operazioni del CEO arrivano nel pacchetto del titolo", conDiario(`
  const p = buildPromptTicker("MU");
  return /IL DIARIO DELLE OPERAZIONI DEL CEO/.test(p) && /ACQUISTO 40 BE a 214/.test(p)`));

check("v348 diario: una voce che cita il titolo esce in testa, anche se e' prosa", conDiario(`
  const p = buildPromptTicker("AMD");
  const i = p.indexOf("SU QUESTO TITOLO (AMD)");
  if (i < 0) return false;
  /* la riga del 29/06 nomina micron PRIMA di amd: se il filtro guardasse solo il ticker
     strutturato, nel pacchetto di AMD quella vendita non esisterebbe */
  return p.slice(i, i + 400).includes("Alleggerito micron 20 azioni e amd");`));

check("v348 diario: una riga con piu' operazioni si pubblica INTEGRA, non riassunta", conDiario(`
  const p = buildPromptTicker("MU");
  /* strutturarla darebbe "VENDITA 20 MU" e le altre tre (AMD, Intel, Tesla) sparirebbero */
  return /Alleggerito micron 20 azioni e amd 25 e venduto Intel e tesla tutto/.test(p)
      && !/VENDITA 20 MU/.test(p)`));

check("v348 diario: nessun alias inventato — Cerebras NON diventa SK hynix", conDiario(`
  const p = buildPromptTicker("SKHY");
  /* il primo giro aveva cerebras:"SKHY" in tabella: il pacchetto pubblicava una vendita di
     SK hynix mai avvenuta. Un nome fuori dal libro resta prosa. */
  return !/VENDITA 30 SKHY/.test(p) && /vendita Cerebras/.test(p)`));

check("v348 diario: quantita' o prezzo mancanti non diventano 'null'", conDiario(`
  DIARIO_VOCI = [{ date: "2026-05-02", text: "Alleggerito micron 20 azioni" }];
  const p = buildPromptTicker("MU");
  return /prezzo non annotato/.test(p) && !/ a null/.test(p)`));

check("v348 diario: senza voci il blocco non esiste e non si inventa un ripiego", conDiario(`
  DIARIO_VOCI = [];
  return !/IL DIARIO DELLE OPERAZIONI/.test(buildPromptTicker("MU"))`));

check("v348 diario: il pacchetto macro PUBBLICO non porta il diario", conDiario(`
  return !/IL DIARIO DELLE OPERAZIONI/.test(buildCIOText())`));

check("v348 diario: il bottone in pagina apre davvero il diario", (() => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  /* v315: un bottone che esiste nel markup ma non ha handler e' un bottone che non c'e'. */
  return html.includes('id="btn-diary"') && src.includes('$("#btn-diary")?.addEventListener("click", apriDiario)');
})());

/* ══ v348 — IL PORTAFOGLIO DENTRO IL PACCHETTO DEL TITOLO ═══════════════════════════════════ */
check("v348 contesto: il pacchetto del titolo porta i PESI, mai gli importi", suVeri(`
  const p = buildPromptTicker("MU");
  const i = p.indexOf("CONCENTRAZIONE");
  if (i < 0) return false;
  const blocco = p.slice(Math.max(0, i - 1500), i + 400);
  /* i pesi si pubblicano, il patrimonio no: nessun importo in euro o dollari nel blocco */
  return /%/.test(blocco) && !/€|EUR |\\$[\\d]/.test(blocco);`));

check("v348 contesto: la concentrazione per fattore e' una somma dichiarata, non un giudizio", suVeri(`
  const p = buildPromptTicker("MU");
  return /le prime tre posizioni valgono il \\d+%/.test(p)
      && /l'esposizione del libro a quel fattore e' la loro somma/.test(p)`));

/* ══ v348 — IL P/E FORWARD, CHE IL SISTEMA AVEVA E NON PUBBLICAVA ══════════════════════════ */
check("v348 valutazione: se c'e' il P/E forward si pubblica, etichettato", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "MU" && (x.stats || {}).forward_pe);
  if (!r) return true;
  const p = buildPromptTicker("MU");
  return /P\\/E PROSPETTICO: [\\d.]+×/.test(p) && /trailing/i.test(p);`));

/* ══ v348 — LE SEGNALAZIONI AL SISTEMA ═════════════════════════════════════════════════════
   Il CEO: "una conferma, tramite ricerca online, dei dati che possono sembrare incongrui e
   segnalameli". Senza una sezione OBBLIGATORIA in uscita, la verifica resta un auspicio: chi
   legge la fa e poi non ha dove scriverla. */
check("v348 segnalazioni: il pacchetto chiede una sezione di ritorno sui dati incongrui", suVeri(`
  const p = buildPromptTicker("MU");
  return /SEGNALAZIONI AL SISTEMA/.test(p) && /VERIFICALO ONLINE su una fonte primaria/.test(p)
      && /nessuna incongruenza rilevata/.test(p)`));

check("v348 sentiment: Reddit e' ammesso come posizionamento retail, dichiarato tale", suVeri(`
  const p = buildPromptTicker("MU");
  return /Reddit/.test(p) && /SENTIMENT RETAIL, non verificato/.test(p)`));


/* ══ v349 — TRE DIFETTI TROVATI CONTROLLANDO "TUTTI GLI INDICATORI, UNA CLASSIFICA SOLA" ═════
   Nessuno dei tre rompeva niente: uno stampava "—", uno un colore neutro, uno uno zero. Sono
   la classe piu' costosa — il sistema che mente restando in piedi — e i gate qui sotto la
   sorvegliano al punto in cui e' misurabile. */

check("v349 schede: una serie di PUNTEGGI non batte mai la forma che mostra il dato", (() => {
  /* La scheda "Valutazione S&P" aveva l'asse a 50·51·52 — il punteggio accumulato in
     metrics_history — mentre i due multipli veri (29,6× e 21×) non comparivano. Il pavimento
     v297 contava i PUNTI e non guardava la NATURA della serie. */
  const riga = src.split("\n").find(l => l.includes("const se = (forma &&"));
  return !!riga && riga.includes("seGrezza.accumulata") && riga.includes("quanti < SERIE_MINIMA");
})());

check("v349 materie: la variazione a 12 mesi si legge dal campo che la pipeline scrive", suVeri(`
  const m = DATA.macro || {};
  const s = (m.materie || {}).sox;
  if (!s || s.var_1y == null) return true;
  const r = indicatoriClassifica().find(x => x.k === "mat:sox");
  /* il SOX faceva +104% e la scheda stampava "—": app.js leggeva pct_1y, rinominato in v316 */
  return !!r && r.sub.includes(String(s.var_1y)) && !/—\\s*in 12 mesi/.test(r.sub);`));

check("v349 materie: nessun lettore usa pct_1y senza il ripiego su var_1y", (() => {
  /* un campo rinominato senza seguire i suoi lettori non rompe: mente in silenzio */
  const codice = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const nude = codice.split("\n").filter(l => l.includes(".pct_1y") && !l.includes("var_1y"));
  return nude.length === 0;
})());

check("v349 mossa: ogni indicatore misura il MOVIMENTO DELLA PROPRIA serie", suVeri(`
  const m = DATA.macro || {};
  if (!((m.vix || {}).spark || []).length || !(m.curve_history || []).length) return true;
  const calc = (p) => {
    const d = []; for (let i = 1; i < p.length; i++) d.push(p[i].v - p[i - 1].v);
    const me = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - me) ** 2, 0) / d.length);
    return sd ? Math.round(Math.abs(d[d.length - 1] - me) / sd * 10) / 10 : null;
  };
  const atteso = calc(m.vix.spark.map(v => ({ v })));
  /* prima il VIX riceveva la mossa della CURVA DEI TASSI: una catena if/else in cui il ramo
     "in:curve || credit || vix" era irraggiungibile perche' "in:" lo prendeva il ramo sopra */
  return mossaRelativa("vix") === atteso && mossaRelativa("vix") !== calc(m.curve_history);`));

check("v349 mossa: la curva riceve la sua serie vera, non un ramo morto", suVeri(`
  const m = DATA.macro || {};
  if ((m.curve_history || []).length < 12) return true;
  /* indicators["curve"].storico e' vuoto: la serie sta in m.curve_history, 369 punti */
  return mossaRelativa("in:curve") !== null;`));


/* ══ v349 — QUATTRO DIFETTI DEI DIGEST STORICI, TUTTI DELLA STESSA FAMIGLIA ═══════════════
   Un numero che dichiara una cosa e ne misura un'altra. Nessuno di questi rompeva niente. */

check("v349 digest: Δ1M si misura sul CALENDARIO e dichiara le due date", suVeri(`
  const t = historicalDigestText();
  /* "Δ1M" contava 21 PUNTI: sulle materie prime, diradate dalla pipeline, erano 58 giorni.
     Il petrolio usciva a +23,77% "in un mese" quando il mese vero faceva +2,53%. */
  const righe = t.split("\\n").filter(l => /Δ1M/.test(l));
  if (!righe.length) return true;
  return righe.every(l => /Δ1M [^·]*\\(\\d{4}-\\d{2}-\\d{2}→\\d{4}-\\d{2}-\\d{2}\\)/.test(l)
                       || /la serie non porta le date/.test(l));`));

check("v349 digest: la finestra dichiarata e' quella davvero coperta", suVeri(`
  const m = DATA.macro || {};
  const h = ((m.materie || {}).petrolio || {}).history || [];
  if (h.length < 30) return true;
  const gg = Math.round((new Date(h[h.length - 1].d) - new Date(h[0].d)) / 86400000);
  const t = historicalDigestText();
  const riga = t.split("\\n").find(l => l.startsWith("Petrolio WTI"));
  if (!riga) return true;
  /* 361 giorni etichettati "serie ~6M": l'etichetta era scritta a mano e non seguiva i dati */
  const dichiarati = Number((riga.match(/serie ~(\\d+)([MA])/) || [])[1]);
  const unita = (riga.match(/serie ~\\d+([MA])/) || [])[1];
  const gDich = unita === "A" ? dichiarati * 365 : dichiarati * 30;
  return Math.abs(gDich - gg) <= Math.max(45, gg * 0.2);`));

check("v349 digest: 'percentile' e' un rango vero, non la posizione nel range", (() => {
  /* min-max e rango sono due misure diverse: sull'HY OAS il primo diceva 14° e il secondo 23°,
     e la soglia <=20 accendeva un allarme che al rango vero non si accende. */
  const i = src.indexOf("const dgPercentile");
  const corpo = src.slice(i, src.indexOf("};", i));
  return corpo.includes("filter(y => y < x)") && !corpo.includes("(x - lo) / (hi - lo)");
})());

check("v349 digest: il valore collocato viene dalla stessa fonte della serie", suVeri(`
  const m = DATA.macro || {};
  const sc = ((m.tassi || {}).scadenze || []).find(x => x && x.key === "a10");
  if (!sc) return true;
  const t = historicalDigestText();
  const riga = t.split("\\n").find(l => l.startsWith("Treasury 10A"));
  if (!riga) return true;
  /* prima ci finiva ^TNX da yfinance (4,74) dentro la distribuzione FRED DGS10: risultato 100°,
     cioe' "mai stato cosi' alto", perche' era un valore estraneo alla serie */
  return riga.includes(String(sc.value).replace(".", ","))
      && !riga.includes(String(((m.carry || {}).us10 ?? "")).replace(".", ","));`));

check("v349 liquidita': il dato mensile porta la sua data anche nel pacchetto", suVeri(`
  const L = (DATA.macro || {}).liquidity_split || {};
  if (L.retail_mmf_bln == null || !L.retail_date) return true;
  const t = buildCIOText();
  /* la scheda in pagina lo dichiarava "non e' il dato di oggi", il pacchetto no: 84 giorni
     presentati come scaricati al run di stamattina */
  return t.includes("rilevazione " + L.retail_date) && /NON e' il dato di oggi/.test(t);`));

check("v349 opzioni: nessuna frase mutilata arriva all'LLM", suVeri(`
  const p = buildPromptTicker("MU");
  /* "grandezza diversa dai volumi qui sopra,  a farli tornare" — verbo perso in una modifica,
     doppio spazio a fare da cicatrice, consegnato cosi' */
  return !/,\\s\\sa farli tornare/.test(p) && !/\\s\\s+[a-z]+ tornare/.test(p);`));


check("v349 premessa: l'elenco delle serie storiche coincide con quelle consegnate", suVeri(`
  const t = buildCIOText();
  const riga = (t.match(/· SERIE STORICHE E PERCENTILI \\(([^)]*)\\)/) || [])[1];
  if (!riga) return false;
  const promesse = riga.split(",").map(x => x.trim()).filter(Boolean);
  const consegnate = buildHistoricalDigests().map(x => String(x.label).replace(/\\s*\\(.*$/, ""));
  /* la premessa ne elencava tre e il blocco ne consegnava sette: chi legge conta e non torna */
  return promesse.length === consegnate.length && promesse.every((p, i) => p === consegnate[i]);`));


/* ══ v350 — DUE MODI DI SPARIRE IN SILENZIO, TROVATI SU CoreWeave ═════════════════════════
   Il CEO ha salvato la posizione scrivendo "CRVW" invece di "CRWV". La dashboard ha aggiunto
   CRVW alla watchlist, quindi il titolo risultava SEGUITO; Yahoo non quota quel simbolo,
   quindi la riga restava senza prezzo; senza prezzo niente controvalore, e la posizione
   spariva da pagina e pacchetto. Il sistema intanto dichiarava "13 attaccate, 0 non seguite".
   E il diario, alla stessa ora, scriveva in locale e falliva la push senza dirlo. */

check("v350 posizioni: una posizione senza prezzo viene DICHIARATA, non contata come a posto", (() => {
  const py = readFileSync(join(ROOT, "scripts", "update_data.py"), "utf8");
  const i = py.indexOf('p = per_tk.pop(');
  const corpo = py.slice(i, i + 1200);
  /* non basta che il campo esista: l'incremento non deve avvenire senza prezzo */
  return corpo.includes("senza_prezzo.append") && corpo.includes("if not prezzo:")
      && py.includes('"senza_prezzo": sorted(senza_prezzo)');
})());

check("v350 posizioni: la pagina nomina le posizioni che non riesce a mostrare", (() => {
  const i = src.indexOf("p.senza_prezzo");
  if (i < 0) return false;
  const corpo = src.slice(i, i + 700);
  return corpo.includes("POSIZIONI CHE NON COMPAIONO QUI SOPRA") && corpo.includes("CRWV");
})());

check("v350 pacchetto: i pesi dichiarano se il denominatore e' incompleto", suVeri(`
  const salva = ((DATA.macro || {}).posizioni || {}).senza_prezzo;
  DATA.macro = DATA.macro || {}; DATA.macro.posizioni = DATA.macro.posizioni || {};
  DATA.macro.posizioni.senza_prezzo = ["XXXX"];
  const p = buildPromptTicker("MU");
  DATA.macro.posizioni.senza_prezzo = salva;
  return /FUORI DA QUESTO ELENCO, E QUINDI DAI PESI: XXXX/.test(p)
      && /percentuali di un azionario che NON comprende/.test(p);`));

check("v350 diario: la scrittura riporta l'esito invece di fallire in silenzio", (() => {
  const i = src.indexOf("async function pushDiarioCloud");
  const corpo = src.slice(i, src.indexOf("\n}\n", i));
  /* prima: `if (!token) return;` e un catch vuoto. Una scrittura che fallisce senza dirlo e'
     peggio di una che rifiuta: la seconda la vedi, la prima la scopri quando ti serve il dato. */
  return corpo.includes("return { ok: true }") && corpo.includes("perche:")
      && corpo.includes("r.status === 409")
      && src.includes('riga.innerHTML = `⚠ <b>Salvata solo su questo browser</b>');
})());

check("v350 diario: setDiary restituisce l'esito a chi lo chiama", (() => {
  const i = src.indexOf("function setDiary");
  const corpo = src.slice(i, src.indexOf("\n}\n", i));
  return corpo.includes("return pushDiarioCloud");
})());


check("v350 grafico: le due linee partono davvero dalla soglia 'partenza'", suVeri(`
  const se = serieIndicatore("corp_profit");
  if (!se || !se.doppia) return true;
  const primi = se.doppia.map(x => x.punti[0]);
  /* la soglia era a 100 mentre dentro la finestra le linee partivano da 107,9 e 98,9: l'occhio
     misurava una distanza iniziale che non esisteva */
  return primi.every(p => p.v === 100) && primi[0].d === primi[1].d
      && (se.soglie || []).some(s => s.v === 100 && String(s.testo).includes(primi[0].d));`));


check("v350 fibonacci: i livelli usano lo STESSO range stampato sopra di loro", suVeri(`
  const p = buildPromptTicker("NVDA");
  const hi = (p.match(/Massimo 52 settimane: ([\\d.]+)/) || [])[1];
  const lo = (p.match(/Minimo 52 settimane: ([\\d.]+)/) || [])[1];
  const fib = p.match(/Fibonacci sul range a 52 settimane \\(massimo ([\\d.]+), minimo ([\\d.]+)\\)/);
  if (!hi || !lo || !fib) return true;
  /* misurato su NVDA: 236.54/164.07 nell'elenco, 236.26/163.85 nei Fibonacci — due range nello
     stesso blocco, e i cinque livelli erano quelli del range vecchio */
  return fib[1] === hi && fib[2] === lo;`));


check("v350 cadenza: il periodo rilevato e la data di pubblicazione sono NOMINATI", suVeri(`
  const t = buildCIOText();
  /* la stessa data 01/07/2026 usciva come "3 giorni fa", "8 giorni fa" e "18 giorni fa" in tre
     righe diverse: ciascuna corretta (i ritardi delle fonti differiscono) ma la forma accostava
     il periodo RILEVATO all'eta' della PUBBLICAZIONE senza dire quale fosse quale */
  const righe = t.split("\\n").filter(l => /giorni fa\\)/.test(l) && /rilevazione |riferito a /.test(l));
  if (!righe.length) return true;
  return righe.every(l => /riferito a \\d{2}\\/\\d{2}\\/\\d{4} · pubblicato ~\\d{2}\\/\\d{2}\\/\\d{4} \\(\\d+ giorni fa\\)/.test(l)
                       || /rilevazione \\d{2}\\/\\d{2}\\/\\d{4} \\(\\d+ giorni fa\\)/.test(l));`));


check("v350 pre/after: un prezzo di ieri non si chiama 'adesso'", (() => {
  /* nel pacchetto di NVDA di domenica sera: "Prezzo AFTER-HOURS adesso: 215.38 — rilevato alle
     01:59", che era l'ultima barra di venerdi'. E la riga successiva diceva di pesarlo PIU' dei
     futures: un prezzo vecchio due giorni con quell'istruzione accanto e' peggio di nessuno. */
  const i = src.indexOf('f.ext && Number.isFinite(f.ext.prezzo)');
  const corpo = src.slice(i, i + 2000);
  return corpo.includes("stessoGiorno")
      && corpo.includes("toLocaleDateString")
      && corpo.includes("NON e' un prezzo di adesso")
      && corpo.includes('${stessoGiorno ? " adesso" : ""}');
})());


check("v351 tassi: i due decennali si dichiarano come due fonti, non si contraddicono", suVeri(`
  const m = DATA.macro || {};
  const tnx = (m.markets || []).find(x => String(x.key || "").toUpperCase() === "^TNX");
  const dgs = ((m.tassi || {}).scadenze || []).find(x => x && x.key === "a10");
  if (!tnx || !dgs) return true;
  const t = buildCIOText();
  const i = t.indexOf("Treasury USA 10A:");
  if (i < 0) return false;
  const riga = t.slice(i, i + 700);
  /* 4,74% da yfinance e 4,69% da FRED convivevano senza etichetta: la sezione SEGNALAZIONI
     chiede all'LLM di riportare i numeri calcolati in due punti con due valori diversi, e
     gliene stavamo dando uno da correggere a ogni analisi */
  return riga.includes("^TNX") && riga.includes("FRED DGS10")
      && riga.includes("NON e' una contraddizione");`));


/* ══ v351 — DUE COSE TROVATE ESEGUENDO IL PACCHETTO SU DI ME, con la ricerca online che la
   testata impone al PASSO 0. Nessuna delle due e' un errore di calcolo: sono due convenzioni
   taciute, e una taciuta vale come un numero sbagliato per chi la confronta con una fonte. */

check("v351 valutazione: il forward P/E dichiara la convenzione e come confrontarlo", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "NVDA" && (x.stats || {}).forward_pe);
  if (!r) return true;
  const p = buildPromptTicker("NVDA");
  /* misurato: qui 16,5× (yfinance forwardEps = PROSSIMO esercizio fiscale), su
     stockanalysis.com 21,4× sullo stesso prezzo — due anni diversi, 30% di scarto sul numero
     con cui si decide se un titolo e' caro */
  return /PROSSIMO ESERCIZIO FISCALE/.test(p) && /a che esercizio si riferisce/i.test(p)
      && /pubblicali entrambi/.test(p);`));

check("v351 livelli: il range a 52 settimane dichiara chiusure e rettifica", suVeri(`
  const p = buildPromptTicker("NVDA");
  if (!/Massimo 52 settimane/.test(p)) return true;
  /* 163,85–236,26 qui contro 164,07–236,54 su Yahoo: 0,12% su entrambi gli estremi, che e'
     esattamente il dividendo di NVIDIA. Su questi due numeri si calcolano i Fibonacci. */
  return /CHIUSURE giornaliere RETTIFICATE/.test(p) && /INTRADAY e NON rettificato/.test(p);`));


/* ══ v352 — LE ISTRUZIONI CHIEDEVANO UN INGRESSO SU UNA POSIZIONE GIA' APERTA ═══════════════
   La coda del pacchetto dichiara "⚠ QUESTO TITOLO E' GIA' IN PORTAFOGLIO ... Non e' una
   decisione di ingresso ma di mantenimento", e i blocchi 0, 7 e 8 chiedevano lo stesso "a quale
   prezzo diventa interessante", "gli INGRESSI" e "se sei arrivato a comprare". Un prezzo
   d'ingresso su 270 quote gia' in carico non e' una risposta sbagliata: e' la risposta a
   un'ALTRA domanda, e occupa il posto di quella che serve. Regola C10 applicata alle
   istruzioni invece che ai dati. */

check("v352 istruzioni: su una posizione aperta si chiede cosa farne, non a che prezzo entrare", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "NVDA" && numero(x.qta) > 0);
  if (!r) return true;
  const p = buildPromptTicker("NVDA");
  const b0 = p.slice(p.indexOf("0) IL GIUDIZIO"), p.indexOf("1) QUADRO MACRO"));
  const b7 = p.slice(p.indexOf("7) LA CHIUSURA"), p.indexOf("8) LA TESI"));
  return /LA POSIZIONE E' GIA' APERTA/.test(b0)
      && !/a quale prezzo diventa interessante/.test(b0)
      && /DECISIONI SULLA POSIZIONE APERTA/.test(b7)
      && /tenere, alleggerire o aggiungere/.test(b7)
      && !/Poi gli INGRESSI/.test(b7);`));

check("v352 istruzioni: su un titolo NON in portafoglio restano gli ingressi", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "TSM");
  if (!r || numero(r.qta) > 0) return true;
  const p = buildPromptTicker("TSM");
  /* la correzione non deve rovesciare il caso opposto: su un titolo mai comprato la domanda
     giusta e' proprio "a che prezzo entrare" */
  return /a quale prezzo diventa interessante/.test(p) && /Poi gli INGRESSI/.test(p)
      && !/LA POSIZIONE E' GIA' APERTA/.test(p);`));

check("v352 istruzioni: la contraria si oppone alla conclusione vera, non a un voto", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "NVDA" && numero(x.qta) > 0);
  if (!r) return true;
  const p = buildPromptTicker("NVDA");
  const b8 = p.slice(p.indexOf("8) LA TESI CONTRARIA"));
  /* il blocco 7 vieta il voto ("Non un voto") e il blocco 8 presupponeva "se sei arrivato a
     comprare": su una posizione aperta l'alternativa non e' comprare/stare fuori */
  return /se sei arrivato a "tenere" o "aggiungere"/.test(b8)
      && !/se sei arrivato a "comprare"/.test(b8);`));

check("v352 orizzonti: un evento datato dentro il breve viene dichiarato dove serve", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "NVDA");
  if (!r || !r.earnings_date) return true;
  const g = Math.round((new Date(r.earnings_date) - Date.now()) / 86400000);
  const p = buildPromptTicker("NVDA");
  const b7 = p.slice(p.indexOf("7) LA CHIUSURA"), p.indexOf("8) LA TESI"));
  /* il pacchetto lo diceva nel calendario macro, a trenta righe da chi deve usarlo: un prezzo
     "a settimane" scritto due giorni prima di una trimestrale e' un altro oggetto */
  if (g < 0 || g > 60) return !/EVENTO DENTRO L'ORIZZONTE BREVE/.test(b7);
  return /EVENTO DENTRO L'ORIZZONTE BREVE/.test(b7) && b7.includes(String(r.earnings_date).slice(0, 10));`));


/* ══ v353 — DUE NUMERI CHE NON PORTAVANO INFORMAZIONE E OCCUPAVANO IL POSTO DI QUELLI CHE SI ══ */

check("v353 previsioni: un mercato gia' risolto non si pubblica come attesa", suVeri(`
  const salva = DATA.predictions;
  DATA.predictions = [
    { question: "Fed ferma a settembre?", yes: 68 },
    { question: "BTC sopra 68k domani?", yes: 100 },
    { question: "ETH sotto 800?", yes: 1 },
  ];
  const t = buildCIOText();
  DATA.predictions = salva;
  /* "Will the price of Bitcoin be above $68,000 on August 24?: 100%" usciva in mezzo alle
     attese sulla Fed: una probabilita' a 100 non e' un'attesa, e' un esito gia' noto */
  return /Fed ferma a settembre/.test(t)
      && !/BTC sopra 68k domani/.test(t) && !/ETH sotto 800/.test(t)
      && /2 mercati esclusi/.test(t);`));

check("v353 previsioni: il taglio si dichiara, non si fa in silenzio", (() => {
  const i = src.indexOf("const informativi = DATA.predictions.filter");
  const corpo = src.slice(i, i + 900);
  /* un taglio silenzioso si legge come "questo e' tutto" */
  return corpo.includes("scartati") && corpo.includes("esito gia' noto");
})());

check("v353 opzioni: un muro troppo lontano dichiara di non essere un livello", suVeri(`
  const p = buildPromptTicker("NVDA");
  const m = p.match(/Muro delle PUT: ([\\d.]+) \\(([-+][\\d.]+)%/);
  if (!m) return true;
  const lontano = Math.abs(parseFloat(m[2])) > 25;
  /* su NVDA: put wall a 115, cioe' -46% dallo spot, spiegato come "tende a fare da pavimento".
     La banda di plausibilita' esisteva (0,5-2x lo spot) e 115/214,72 = 0,536: passava per
     mezzo punto percentuale. */
  return lontano ? /Muro delle PUT[^\\n]*NON E' UN LIVELLO/.test(p)
                 : !/Muro delle PUT[^\\n]*NON E' UN LIVELLO/.test(p);`));

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
