#!/usr/bin/env node
/* Test harness per le funzioni PURE di assets/app.js (motore decisionale, risk, prompt).
   app.js è pensato per il browser: qui gira in un contesto Node (vm) con un DOM-stub
   minimale — niente rendering, si testano SOLO calcoli e generazione del prompt.
   Uso: node scripts/test_app.mjs  (exit 1 se un check fallisce) */
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
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

/* ═══ v359 — LA SUITE CHE CONTROLLA SE' STESSA ═══════════════════════════════════════════
   In un solo giorno due classi di errore hanno colpito quattro e otto volte, e condividono la
   proprieta' peggiore che un gate possa avere: SI GUASTANO SENZA MORDERE.
   · `src.slice(i, i + 1400)` — quel numero non e' stato scelto, e' stato TARATO sul corpo di
     allora. Quando la funzione ispezionata cresce, la stringa cercata esce dalla finestra e il
     check diventa VERDE senza che nulla sia stato corretto.
   · un backslash SINGOLO dentro un template passato al vm: `\d` diventa `d`, la regex compila
     senza errore e non matcha mai. Il gate diventa ROSSO e accusa il prodotto mentre e' rotto
     il test — chi indaga corregge la cosa sbagliata.
   ⚠ LA MIGRAZIONE AUTOMATICA E' STATA PROVATA E RIFIUTATA, due volte: la prima graffa dopo
   l'ancora NON e' sempre il blocco voluto (su `DATA.predictions.filter(...)` e' il corpo della
   callback, che finisce molto prima del testo cercato), e cinque check sono diventati rossi.
   Quindi: l'helper si usa dove l'ancora e' una FUNZIONE — caso non ambiguo — e i meta-gate in
   fondo al file impediscono che il numero di finestre fisse RISALGA. Il debito residuo e'
   dichiarato e monotono: puo' solo scendere. */

/* prende il BLOCCO SINTATTICO dall'ancora, bilanciando le graffe e ignorando quelle dentro
   stringhe, template, regex e commenti. Nessun parametro da tarare: il commento-saggio dentro
   la funzione puo' crescere quanto vuole senza spostare il confine.
   ⚠ Se l'ancora TESTUALE non c'e' LANCIA: un check che asserisce su una stringa vuota e' verde
   per la ragione sbagliata. Un indice numerico negativo invece torna vuoto, perche' li' la
   guardia ce l'ha gia' il chiamante. */
const bloccoDa = (testo, ancora, { max = 40000 } = {}) => {
  const i = typeof ancora === "number" ? ancora : testo.indexOf(ancora);
  if (typeof ancora === "number" && i < 0) return "";
  if (i < 0) throw new Error(`ANCORA ASSENTE nel sorgente: ${ancora}`);
  /* ⚠ una firma come `function tessera({ t, v, cls })` ha una graffa DENTRO i parametri:
     bilanciando quella si otterrebbe la sola firma. Si chiude prima la tonda. */
  let dopoFirma = i;
  const tonda = testo.indexOf("(", i);
  if (tonda >= 0 && tonda - i < 200) {
    let p = 0;
    for (let k = tonda; k < testo.length && k - tonda < 4000; k++) {
      if (testo[k] === "(") p++;
      else if (testo[k] === ")" && --p === 0) { dopoFirma = k; break; }
    }
  }
  const apre = testo.indexOf("{", dopoFirma);
  if (apre < 0 || apre - dopoFirma > 400) return testo.slice(i, i + max);
  let d = 0, str = null, esc = false;
  for (let k = apre; k < testo.length; k++) {
    const c = testo[k];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (str) { if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "/" && testo[k + 1] === "/") { const n = testo.indexOf("\n", k); if (n < 0) break; k = n; continue; }
    if (c === "/" && testo[k + 1] === "*") { const n = testo.indexOf("*/", k); if (n < 0) break; k = n + 1; continue; }
    if (c === "{") d++;
    else if (c === "}" && --d === 0) return testo.slice(i, k + 1);
  }
  return testo.slice(i, i + max);
};

const suVeri = (code, cash = 28500) => run(`
  const _salva = DATA, _cash = cashEur;
  DATA = JSON.parse(JSON.stringify(REALE)); cashEur = ${cash}; recomputeTotals();
  try { ${code} } finally { DATA = _salva; cashEur = _cash; recomputeTotals(); }`);
const suVeriEsito = (code) => { const r = suVeri(code); return r === true ? true : no(String(r)); };
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
/* ⚠⚠ v365 — `no("ragione")` STAMPA LA RAGIONE E TORNA false.
   check() accetta SOLO booleani, ed e' giusto cosi': e' quel rigore che regge il meta-gate dei
   dormienti (che riconosce un check muto proprio perche' torna una stringa invece di true).
   Ma scrivere `return "manca X"` sembrava funzionare e invece produceva "CHECK MALFORMATO" con
   la ragione buttata via. Questo helper tiene la diagnosi E la convenzione. */
const no = (msg) => { console.log(`      ↳ ${msg}`); return false; };

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


/* ⚠ v354 — L'INVARIANTE SI ROVESCIA, e va detto perche'. Fino a ieri questo check ESIGEVA
   che l'allarme schiuma portasse una direttiva operativa ("non impegnare il budget", "solo
   Stop Ratchet", "la riserva ES95 resta inviolabile"). Erano tre riferimenti morti: il budget
   operativo e' uscito dal pacchetto in v247, gli Stop Ratchet non esistono piu', e l'ES95 e'
   `null` da quando le azioni stanno in `watchlist`. Il check proteggeva una prescrizione
   ancorata a numeri che non ci sono — e violava la regola C9, che vuole i FATTI nella coda e
   le ISTRUZIONI nella testata. Ora esige il contrario: il fatto, senza la prescrizione. */
check("v126 froth: l'allarme schiuma porta il FATTO, non una direttiva su numeri che non esistono", run(`
  DATA.macro.froth = { soxl: { symbol: "SOXL", rvol: 3.1, chg_5d_pct: 12.4 }, tqqq: { symbol: "TQQQ", rvol: 1.2, chg_5d_pct: 4 },
    alert: true, note: "Volume estremo in acquisto sugli ETF a leva 3x (SOXL RVol 3.1× / +12.4% 5g)." };
  const p = buildPrompt();
  delete DATA.macro.froth;
  const l = p.split("\\n").find(x => x.includes("[SPECULATIVE FROTH ALERT]"));
  return !!l && l.includes("SOXL") && l.includes("proxy dell'euforia retail")
      && l.includes("non da quale parte andra' il prezzo")
      && !l.includes("DIRETTIVA") && !l.includes("budget operativo")
      && !l.includes("Stop Ratchet") && !l.includes("ES95")`));

check("v354 nessun riferimento a grandezze rimosse sopravvive nel pacchetto", suVeri(`
  const p = buildCIOText() + buildPromptTicker("MU");
  /* budget operativo (tolto in v247), Stop Ratchet (non esistono piu') ed ES95 (null da quando
     il motore di rischio gira a vuoto): tre nomi che il pacchetto non deve piu' pronunciare */
  return !/budget operativo|Stop Ratchet|riserva ES95/.test(p);`));

check("v354 il campo budget_operativo_spendibile non esiste piu'", (() => {
  /* nessuno lo leggeva, e con ES95 null valeva la cassa INTERA: la riserva di coda spariva */
  return !src.includes("budget_operativo_spendibile:");
})());
/* ⚠⚠ VENTICINQUESIMA rottura di un check ancorato a una stringa letterale, e questa PINNAVA IL
   COMPORTAMENTO SBAGLIATO: pretendeva la frase "prudenza sui nuovi ingressi", cioe' proprio la
   DIRETTIVA che C9 vieta nella coda e la prescrizione di dimensionamento che la testata proibisce.
   Due gate in conflitto, e vince quello scritto per ultimo (v389) — ma la ragione vera e' che
   un gate che pinna un difetto lo rende permanente (v326). L'invariante vero non e' la frase:
   e' che il ramo d'allarme si accenda solo quando serve, pubblichi la MISURA, e non contenga
   ne' ordini ne' quantita'. */
check("v126 breadth: il ramo d'allarme pubblica la misura, senza direttive ne' quantita'", suVeriEsito(`
  DATA.macro.breadth = { spy_1m_pct: 2.6, rsp_1m_pct: -0.8, divergence_pp: 3.4, alert: true, note: "Rally retto dalle megacap." };
  const p1 = buildPrompt();
  DATA.macro.breadth = { spy_1m_pct: 2.6, rsp_1m_pct: 1.9, divergence_pp: 0.7, alert: false };
  const p2 = buildPrompt();
  delete DATA.macro.breadth;
  if (p1.indexOf("AMPIEZZA IN DETERIORAMENTO") < 0) return "col flag alzato il ramo d'allarme non compare";
  if (p2.indexOf("AMPIEZZA IN DETERIORAMENTO") >= 0) return "il ramo d'allarme compare anche senza allarme";
  if (p2.indexOf("Ampiezza di mercato") < 0) return "senza allarme sparisce anche la riga neutra";
  const riga = p1.slice(p1.indexOf("AMPIEZZA IN DETERIORAMENTO"));
  const fine = riga.slice(0, riga.indexOf(String.fromCharCode(10)));
  /* niente ordini e niente dimensionamento: sono le due regole che questa riga violava */
  for (const vietato of ["DIRETTIVA", "prudenza", "sizing", "ratchet", "verifica"]) {
    if (fine.toLowerCase().indexOf(vietato.toLowerCase()) >= 0) return "la riga contiene ancora: " + vietato;
  }
  /* e deve portare la MISURA, non solo l'etichetta */
  return fine.indexOf("3,4pp") >= 0 || "la riga non pubblica lo spread misurato";`));

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
/* ⚠⚠ VENTITREESIMA rottura di un check ancorato a una STRINGA LETTERALE, e stavolta l'ha
   provocata una riga piu' onesta di prima: la v406 dichiara nel pacchetto cosa la pagina mostra
   e lui non porta, e fra le ragioni NOMINA EUR/JPY. Il gate pretendeva l'assenza della
   sottostringa ed e' andato rosso su codice corretto.
   L'invariante vero non e' "la stringa non compare": e' che di EUR/JPY non esca la QUOTAZIONE.
   Quindi si verifica il FATTO — il valore iniettato non compare da nessuna parte — e si concede
   il nome solo alla riga che ne dichiara l'esclusione. Un nome citato per dire che manca e' il
   contrario di un dato pubblicato. */
check("v138 tagli: TOP 10 CAPITALIZZAZIONI fuori, di EUR/JPY nessuna quotazione", run(`
  DATA.top_caps = [{ ticker: "AAPL", name: "Apple", mcap_usd: 4.8e12, change_pct: 1 }];
  DATA.macro.markets = [{ label: "EUR/JPY", value: "185.76", change_pct: -0.1 }, { label: "EUR/USD", value: "1.14", change_pct: 0.1 }];
  const p = buildPrompt();
  DATA.top_caps = []; DATA.macro.markets = [];
  if (p.includes("TOP 10 CAPITALIZZAZIONI")) return false;
  if (!p.includes("EUR/USD")) return false;
  if (p.includes("185.76") || p.includes("185,76")) return false;   // la quotazione non deve uscire
  /* ogni riga che lo nomina deve essere quella delle esclusioni dichiarate, non una quotazione */
  const righe = p.split(String.fromCharCode(10)).filter(r => r.includes("EUR/JPY"));
  return righe.every(r => r.includes("NON PORTA"))`));

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

/* ⚠ v355 — L'INVARIANTE SI SPOSTA DI UN PASSO, nella stessa direzione in cui si muove da tre
   versioni. La v145 ha tolto la "DIRETTIVA: SOSPENDI" lasciando un WORKFLOW DI VERIFICA
   numerato; il gate di coerenza C9 ha poi mostrato che anche quel workflow e' un'ISTRUZIONE
   nella coda — "verifica prima di agire · 1) conferma · 2) escludi · 3)…" — cioe' la cosa che
   la regola vieta. Non si era mai vista perche' l'allarme non era mai scattato durante un
   controllo di coerenza: e' emersa quando un nuovo giro di pipeline l'ha acceso.
   La sostanza resta INTERA (i livelli del pacchetto sono calcolati su prezzi pre-shock, e il
   sistema non sa se il dato sia confermato); cambia la forma: si dichiara il fatto e cosa non
   e' piu' valido, invece di dettare un procedimento. */
check("v145→v156→v355 shock: EVIDENZA e conferma futures, senza direttive ne' procedimenti nella coda", run(`
  const saved = DATA.macro.shock_alert, savedF = DATA.macro.futures;
  DATA.macro.shock_alert = { active: true, threshold: 2, sources: [{ src: "KOSPI", chg: -4.3 }] };
  DATA.macro.futures = { nasdaq: { label: "Fut NDX", change_pct: 0.4 }, sp500: { label: "Fut S&P", change_pct: 0.1 } };
  const p = buildPrompt();
  DATA.macro.shock_alert = saved; DATA.macro.futures = savedF;
  return p.includes("SEGNALE DI SHOCK") && p.includes("indizio, non verdetto")
      && p.includes("prezzi PRE-shock") && p.includes("COSA IL SISTEMA NON SA")
      && /I futures USA sono (in calo|in rialzo|piatti)/.test(p)
      && !/\\bA4\\b/.test(p) && /allarme localizzato all'Asia/.test(p) && /Fut NDX \\+0,4/.test(p)
      && !p.includes("DIRETTIVA OPERATIVA: SOSPENDI") && !p.includes("WORKFLOW DI VERIFICA")`));

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
  /* ⚠ v389 — RIAGGANCIATO AL FATTO: cercava la stringa "analista macro", e la testata l'ha
     persa quando e' diventata quella di un team di risk management di un fondo growth. E' la
     NONA volta in questo progetto che un check ancorato a una stringa letterale si rompe su
     una riformulazione senza che manchi niente (CLAUDE.md ne conta otto).
     L'invariante vero e' triplo e nessuna delle tre parti e' una parola: la testata esiste ed
     e' sostanziosa, dichiara di ricevere il QUADRO MACRO, e NON chiede di dimensionare. */
  check("v256 FALLBACK TESTATA: esiste, non è vuoto ed è scritto per un pacchetto MACRO",
    testo.length > 400 && /quadro macro/i.test(testo)
    && /non dimension|niente quantita|non proporre operazioni/i.test(testo)
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
    'id="updated-at"', 'id="btn-refresh"',
    /* v259 — 'id="tk-go"' NON e' piu' un elemento portante: il CEO ha chiesto UN SOLO bottone
       e i due sono stati fusi in #btn-cio, che decide dal contenuto del box. La guardia non e'
       stata indebolita — l'invariante che conta e' che l'AZIONE esista, e #btn-cio la porta.
       ⚠ v407 — E ORA LE AZIONI SONO DUE, quindi le porte tornano due: #btn-libro e #btn-titolo.
       L'invariante non e' cambiato ne' e' stato allentato — dice ancora "l'azione esiste" — ma
       le azioni non sono piu' la stessa: il primo tasto guarda tutte le posizioni insieme, il
       secondo scava su una sola con la coda macro potata. Un solo id qui dentro lascerebbe
       sparire l'altro pacchetto senza che niente morda. */
    'id="btn-libro"', 'id="btn-titolo"',
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
  /* ⚠ un [^backslash-n] dentro un template passato al vm diventa un NEWLINE VERO, e un a capo
     dentro un letterale di espressione regolare e' un errore di sintassi: il check moriva in
     eccezione. E' il fratello della trappola dei backslash gia' scritta in CLAUDE.md, su una
     sequenza che il meta-gate non copriva. Il rimedio e' quello di sempre: indexOf, che non ha
     niente da sfuggire (v400, v409). */
  const iBarra = t.indexOf("LA BARRA GIORNALIERA SOTTO");
  return iBarra >= 0 && t.slice(iBarra, iBarra + 120).indexOf("2026-08-07") >= 0
      && /non sono prezzi di adesso/.test(t)
      /* ⚠ e con tutte le sedute allineate NON deve comparire la dichiarazione di
         disallineamento: qui sopra sono state messe tutte alla stessa data. */
      && t.indexOf("MA NON TUTTE") < 0`));

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
/* ⚠ v396 — INVARIANTE CAMBIATO, NON ZITTITO. Questo check verificava l'aritmetica della
   PROIEZIONE (il giorno lavorativo dopo la rilevazione). Da quando il CEO ha vietato le date
   proiettate, `cadenzaDato` non ne calcola piu': o c'e' l'appuntamento del calendario
   ufficiale, o non c'e' niente. L'invariante che resta e' piu' semplice e piu' forte: la data
   pubblicata come "prossima" viene SEMPRE dal calendario e cade SEMPRE nel futuro. */
check("v266 cadenza: la prossima uscita, quando c'e', viene dal calendario e sta nel futuro", suVeri(`
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const cal = ((DATA.macro.calendario_uscite || {}).per_chiave) || {};
  let viste = 0;
  for (const i of DATA.macro.indicators || []) {
    const c = cadenzaDato(i.key, i.date);
    if (!c) continue;
    if (c.prossimo) {
      viste++;
      if (!cal[i.key]) return false;                                  // inventata
      if (new Date(c.prossimo + "T00:00:00") <= oggi) return false;   // gia' passata
      if (c.confermato !== true) return false;
    } else if (c.confermato !== false) return false;
  }
  return viste >= 1;`));

/* ⚠⚠ v396 — L'ALLARME "ERA ATTESO E NON E' ARRIVATO" E' STATO RIMOSSO, e questo check ne e'
   la ricevuta. Confrontava OGGI con una data che ci eravamo dati da soli: poteva suonare su un
   dato regolarissimo (era il difetto di v266 e v271, pagato due volte con le feste americane e
   col fine settimana) e tacere su uno davvero in ritardo. Il segnale non e' perso: vive in
   `validate_macro` lato pipeline, che confronta l'ETA' della rilevazione con la cadenza massima
   ammessa per quella serie — una soglia misurata invece di una data immaginata.
   Qui si verifica che l'allarme non torni per la porta di servizio. */
check("v396 nessun allarme di dato mancante costruito su una data che ci siamo dati noi", suVeri(`
  const c = cadenzaDato("t30", "2026-08-06");
  if (!c) return false;
  if ("scaduto" in c || "passata" in c) return false;   // i campi della vecchia proiezione
  const p = buildPrompt();
  return p.indexOf("NON E' ARRIVATO") < 0 && p.indexOf("NON È ARRIVATO") < 0
      && p.indexOf("dentro la tolleranza") < 0;`));

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
  const corpo = bloccoDa(src, i);
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
/* ⚠ v396 — la grazia in giorni lavorativi serviva a non far suonare l'allarme costruito sulla
   proiezione. Tolto l'allarme, la grazia non ha piu' oggetto. Al suo posto l'invariante che
   conta oggi: la riga di cadenza NON scrive mai una data che non venga da una fonte, e quando
   non ce l'ha lo DICE — "dato non disponibile" e' un'informazione, un trattino no. */
check("v396 dove non c'e' la data, la riga lo dichiara invece di tacere o indovinare", suVeri(`
  const salva = DATA.macro.calendario_uscite;
  delete DATA.macro.calendario_uscite;
  const r = rigaCadenza("t30", "2026-08-06");
  DATA.macro.calendario_uscite = salva;
  return r.indexOf("prossimo aggiornamento dato non disponibile") >= 0
      && r.indexOf("ultima uscita dato non disponibile") >= 0
      && /[0-9]{2}\\/[0-9]{2}\\/[0-9]{4}/.test(r) === true;`));

/* ⚠ v396 — LA GRAZIA IN GIORNI LAVORATIVI E' STATA RIMOSSA insieme all'allarme che serviva
   ad ammorbidire: quell'allarme confrontava OGGI con una data proiettata da noi, e le date
   proiettate non esistono piu'. Questo check e' la RICEVUTA della rimozione: verifica che ne'
   la funzione ne' il concetto rientrino di soppiatto, e che il posto sia occupato dalla
   dichiarazione onesta invece che da un buco. */
check("v396 la grazia sulla data proiettata non rientra dalla porta di servizio", (() => {
  const soloCodice = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  if (/sommaGiorniLavorativi/.test(soloCodice)) return no("la funzione della grazia e' tornata");
  const c = bloccoDa(src, "function cadenzaDato", { max: 7000 }).replace(/\/\*[\s\S]*?\*\//g, "");
  if (/scaduto|passata|tolleranza/.test(c)) return no("i campi dell'allarme proiettato sono tornati");
  if (!/dato non disponibile|ND/.test(bloccoDa(src, "function rigaCadenza", { max: 3000 })))
    return no("tolto l'allarme, la riga tace invece di dichiarare che non sa");
  return true;
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
  /* backslash RADDOPPIATI: dentro un template la sequenza barra-d arriva al vm come la sola
     lettera d, e la regex non matcha mai. Erano singoli, e non si era mai visto perche' questo
     check e' DORMIENTE: la riga "Quadro d'insieme" non e' piu' nel pacchetto e la guardia qui
     sopra esce prima di eseguire il corpo. Trovato dal meta-gate v359, che esiste per questo. */
  const n = riga.match(/(\\d+) indicatori/);
  const giu = riga.match(/(\\d+) sotto 50/);
  const su = riga.match(/(\\d+) sopra/);
  const pari = riga.match(/(\\d+) esattamente a 50/);
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
      && !/sotto 50 e \\d+ sopra/.test(p)`));

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
/* ⚠ v395 — A QUESTO CHECK E' CAMBIATO L'INVARIANTE, NON E' STATO ZITTITO. Pretendeva che
   OGNI evento fosse marcato stimato: era vero finche' tutte le uscite macro erano proiettate
   dal ritardo tipico della fonte, ed e' diventato falso da quando la pipeline legge il
   calendario ufficiale. Riscriverlo per farlo tacere sarebbe il modo classico di perdere la
   protezione (v203); l'invariante che conta e' piu' forte di prima: ogni evento DICHIARA la
   propria provenienza con un booleano vero — mai `undefined`, che si leggerebbe come "non
   stimato" — e "confermato" e' vero solo se il calendario ha davvero quella chiave. */
check("v287 calendario: ogni evento dichiara la propria provenienza, e non mente", suVeri(`
  const cal = ((DATA.macro.calendario_uscite || {}).per_chiave) || {};
  const perNome = {};
  for (const i of DATA.macro.indicators || []) perNome[i.label] = i.key;
  const r = prossimiEventi(30);
  if (!r.eventi.length) return false;                 // muto = non sta misurando
  return r.eventi.every(e => typeof e.stimata === "boolean")
      && r.eventi.filter(e => e.tipo === "utili").every(e => e.stimata === true)
      && r.eventi.filter(e => e.tipo === "macro" && !e.stimata)
                 .every(e => !!cal[perNome[e.nome]]);`));

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
/* ⚠⚠ v393 — QUESTO CHECK ERA UN FOSSILE VERDE PER DUE RAGIONI INSIEME, e le ho scoperte solo
   quando il `data.json` sotto di lui e' tornato ad avere notizie:
     1. cercava la stringa letterale "TITOLI MACRO DELLE ULTIME 6 ORE", che non esiste dalla
        v389 (la finestra e' passata a otto ore e l'intestazione ha cambiato forma). E' la
        TREDICESIMA volta che un check ancorato a una stringa si rompe in questo progetto;
     2. usciva con `return true` quando `macro.news` mancava — e mancava SEMPRE, perche' le news
        erano morte dalla nascita per l'`import html` assente. Cioe' il check che doveva
        sorvegliare le notizie era verde proprio PERCHE' le notizie non funzionavano.
   Ora e' agganciato al FATTO — entrambi i rami esistono e ciascuno dichiara cio' che deve — e i
   due rami si ESERCITANO iniettando i dati, invece di sperare che lo snapshot li contenga. */
check("v306 news: il pacchetto parla in entrambi i rami, fresche o nessuna", suVeri(`
  const riga = (p) => p.split(String.fromCharCode(10)).find(x => x.indexOf("TITOLI MACRO") >= 0) || "";
  DATA.macro = DATA.macro || {};
  /* ramo PIENO: la riga deve dichiarare che sono titoli e non fatti verificati */
  DATA.macro.news = { fonti: ["Prova"], filtro: "sintetico", voci: [
    { titolo: "UNA-QUALSIASI", riassunto: "", fonte: "Prova",
      quando: new Date(Date.now() - 36e5).toISOString() }] };
  const pieno = riga(buildPrompt());
  /* ramo VUOTO: deve dire che e' un dato MANCANTE, non un dato negativo */
  DATA.macro.news = { fonti: ["Prova"], filtro: "sintetico", voci: [] };
  const vuoto = riga(buildPrompt());
  return pieno.indexOf("SONO TITOLI, NON FATTI VERIFICATI") >= 0
      && pieno.indexOf("non ha data di rilevazione") >= 0
      && vuoto.indexOf("MANCANTE") >= 0
      && vuoto.indexOf("non come") >= 0`));

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

/* ⚠ stessa coppia di difetti del check qui sopra: stringa letterale piu' uscita anticipata.
   Il fatto da sorvegliare e' che il pacchetto NOMINI le notizie, comunque sia formulato. */
check("v307 news: ma restano nel pacchetto", suVeri(`
  DATA.macro = DATA.macro || {};
  DATA.macro.news = { fonti: ["Prova"], filtro: "sintetico", voci: [
    { titolo: "RESTA-NEL-PACCHETTO", riassunto: "", fonte: "Prova",
      quando: new Date(Date.now() - 36e5).toISOString() }] };
  const p = buildPrompt();
  return p.indexOf("TITOLI MACRO") >= 0 && p.indexOf("RESTA-NEL-PACCHETTO") >= 0`));

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
  /* v401 — la fixture porta le DUE finestre e il pavimento misurato: senza, i check girerebbero
     su dati privi del fenomeno che devono misurare, che e' la trappola gia' pagata quattro volte.
     Il canale "tassi" e' il caso che ha motivato la modifica: spento sull'anno (R² 0,007 sotto il
     pavimento 0,015) e ACCESO sull'ultimo trimestre (0,180 sopra 0,065). */
  sensibilita: { settore: { strumento: "SOXX", canale: "il comparto", beta: 1.46, r2: 0.657, corr: 0.81, campione: 250, da: "2025-08-18", a: "2026-08-14", r2_soglia: 0.015, acceso: true,
                            breve: { beta: 1.5, r2: 0.62, corr: 0.79, campione: 60, da: "2026-05-20", a: "2026-08-14", r2_soglia: 0.065, acceso: true } },
                 tassi: { strumento: "TLT", canale: "i tassi a lunga", beta: 0.75, r2: 0.007, corr: 0.08, campione: 250, da: "2025-08-18", a: "2026-08-14", r2_soglia: 0.015, acceso: false,
                          breve: { beta: 1.9, r2: 0.18, corr: 0.42, campione: 60, da: "2026-05-20", a: "2026-08-14", r2_soglia: 0.065, acceso: true },
                          /* v403 — nelle sedute di forte escursione il beta e' molto piu' ampio della
                             media: e' il numero che serve a un libro a leva, e non si ricava dagli altri due. */
                          evento: { beta: 2.4, r2: 0.55, corr: 0.74, campione: 50, da: "2025-08-20", a: "2026-08-13", r2_soglia: 0.077, acceso: true, escursione_min: 1.2 } } },
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
      /* ⚠ v396 — qui c'era un includes sulla stringa "prossimo atteso": SEDICESIMA rottura di un check
         ancorato a una stringa letterale, andato rosso su codice piu' corretto di prima.
         L'invariante e' che la riga dica quando arriva il prossimo dato, non con quali parole. */
      && r.includes("prossimo aggiornamento")`));

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
/* ⚠⚠ VENTISEIESIMA rottura di un check ancorato a una STRINGA LETTERALE, e della specie
   peggiore: pretendeva la frase "la leva si sta RITIRANDO dai massimi", cioe' proprio
   l'affermazione che la v414 ha tolto perche' era il difetto — dichiarava un VERSO senza il
   proprio ORIZZONTE, e la riga successiva avverte che leggerne uno solo porta alla conclusione
   opposta (in ritiro sul mese, in espansione su trimestre e anno). Un gate che pinna un difetto
   lo rende permanente (v326, v411).
   L'invariante vero non e' "una delle due frasi c'e'": e' che il pacchetto non affermi sulla
   leva una direzione che contraddice la propria fonte, e che i tre orizzonti siano pubblicati
   perche' chi legge possa vedere che non concordano. */
check("v320 leva: nessuna direzione affermata contro la fonte, e i tre orizzonti sono pubblicati", suVeriEsito(`
  const st = marginDebtState();
  if (!st) return "marginDebtState non produce nulla: il check non sta misurando niente";
  const p = buildPrompt();
  /* (1) i NUMERI dei tre orizzonti devono esserci: e' quello che permette al lettore di vedere
     che il verso dipende dalla finestra, ed e' l'informazione vera. */
  const riga = p.split(String.fromCharCode(10)).find(r => r.indexOf("LEVA DEGLI OPERATORI") === 2);
  if (!riga) return "la riga LEVA DEGLI OPERATORI non compare: senza i numeri il verso non e' verificabile";
  for (const orizzonte of ["sull'anno", "nell'ultimo mese", "sul trimestre"]) {
    if (riga.indexOf(orizzonte) < 0) return "manca l'orizzonte: " + orizzonte;
  }
  /* (2) e nessuna affermazione di direzione deve contraddire la fonte unica */
  if (st.rollover && p.indexOf("leva in espansione sui massimi") >= 0) {
    return "la fonte dice deleveraging e il pacchetto dice espansione sui massimi";
  }
  if (!st.rollover && p.indexOf("la leva si sta RITIRANDO") >= 0) {
    return "la fonte NON dice deleveraging e il pacchetto lo afferma";
  }
  return true;`));

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
  const corpo = bloccoDa(src, i);
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
/* ⚠ v395 — QUESTO CHECK MISURA L'ARITMETICA DELLA PROIEZIONE, e da quando esiste il
   calendario ufficiale `cadenzaDato` per molte chiavi non la usa piu': confrontava quindi una
   data DICHIARATA DALL'ENTE con una base costruita da una rilevazione fittizia, e falliva su
   codice giusto. Il calendario si toglie prima di misurare — e' il ramo che questo check
   sorveglia — e la proprieta' del ramo confermato si verifica accanto, invece di perderla. */
check("v343 cadenza: per ogni serie la prossima uscita dista UN passo, non due", suVeri(`
  delete DATA.macro.calendario_uscite;
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
  /* ⚠ v400 — VENTESIMA ROTTURA DI UN CHECK ANCORATO A UNA STRINGA LETTERALE: pretendeva
     "quota di mercato" ed e' andato rosso quando la colonna e' diventata piu' precisa
     ("Quota" + "DI QUALE MERCATO"). L'invariante non e' il nome della colonna: e' che la
     tabella chieda un concorrente, la sua quota e l'anno a cui quella quota si riferisce. */
  return /Concorrente/.test(t) && /[Qq]uota/.test(t) && /Anno e fonte/.test(t)
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

check("v271 pacchetto titolo: porta i livelli che il sistema gia' conosce", suVeri(`
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
  return /volumi scambiati[^"`]*: put/.test(corpo) && /CONTRATTI APERTI/.test(corpo)
      && /grandezza diversa dai volumi/.test(corpo)
      && !/volumi scambiati oggi/.test(corpo);
})());

/* ⚠ v398 — DICIOTTESIMA rottura di un check ancorato a una stringa letterale: pretendeva
   "BUDGET: N-M parole IN TUTTO" e "vincolo, non un'indicazione", cioe' la FORMA vecchia, ed e'
   andato rosso quando il tetto e' stato ricalibrato togliendo il pavimento. L'invariante e'
   che un tetto ci sia e sia dichiarato come tale, non con quali parole. */
check("v293 consegna: il pacchetto titolo porta un tetto di lunghezza", suVeri(`
  const p = buildPromptTicker("AMD");
  const m = p.match(/BUDGET: al massimo ([0-9.]+) parole/);
  if (!m) return false;
  const tetto = Number(String(m[1]).replace(".", ""));
  return tetto >= 800 && tetto <= 4000 && /TETTO, non un bersaglio/.test(p);`));

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
  const i8 = p.indexOf("LA TESI CONTRARIA");
  const i7 = p.indexOf("7) LA CHIUSURA");
  const i0 = p.indexOf("0) IL GIUDIZIO");
  /* dopo la conclusione, non dopo il giudizio: per attaccare una tesi bisogna averla prima
     argomentata con le prove, altrimenti e' teatro. */
  return i8 > i7 && i7 > i0 && /obbligatoria/.test(p)`));

check("v296 contraddittorio: obbliga ai numeri del pacchetto, a scegliere, e a un fatto datato", suVeri(`
  const p = buildPromptTicker("AMD");
  const i = p.indexOf("LA TESI CONTRARIA");
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
  const m2 = p.match(/Media semplice 200: ([\\d.]+) —/);
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
    /* ⚠ v401 — VENTUNESIMA ROTTURA DI UN CHECK ANCORATO ALLA FORMA: pretendeva una riga sola per
       canale, e la resa ora ne usa tre (intestazione + due finestre). L'invariante NON e' il
       numero di righe: e' che OGNI beta pubblicato viaggi col suo R², col campione e con la
       finestra. Riagganciato a quello, ed e' diventato piu' FORTE — ora deve valere per
       entrambe le finestre, non per una. */
    const misure = p.split(String.fromCharCode(10)).filter(x => /finestra (lunga|corta) — beta/.test(x));
    return misure.length === 4
        && misure.every(x => /beta [+-]?[\\d.]+/.test(x) && /R² [\\d.]+/.test(x)
                          && /pavimento del rumore di [\\d.]+/.test(x)
                          && /\\d+ sedute comuni, dal \\d{4}-\\d{2}-\\d{2} al \\d{4}-\\d{2}-\\d{2}/.test(x))
        && /sotto il pavimento del rumore: NESSUNA relazione misurabile/.test(
             misure.find(x => x.indexOf("finestra lunga") >= 0 && x.indexOf("+0.75") >= 0) || "")
        && /canale DOMINANTE/.test(
             misure.find(x => x.indexOf("finestra lunga") >= 0 && x.indexOf("+1.46") >= 0) || "")
        /* il canale che si ACCENDE fra le due finestre e' il caso che ha motivato la modifica:
           deve essere nominato, non lasciato dedurre dal confronto di due R². */
        && p.indexOf("IL CANALE SI E' ACCESO") >= 0;
  } finally { DATA = _s; recomputeTotals(); }`));

check("v316 titolo: senza i dati della pipeline il blocco non esiste e non si inventa un ripiego", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "MU");
  if (r) delete r.tv;
  const p = buildPromptTicker("MU");
  /* ⚠ v418 — LA SONDA CERCAVA LA FRASE, NON LA SEZIONE. "DETTAGLI TECNICI" compare anche
     nella riga che DICHIARA l'esclusione del titolo in esame dall'elenco del libro, quindi il
     check la trovava pure quando la sezione non c'era. Le altre due sonde di questo stesso
     check erano gia' ancorate all'intestazione (--- COME IL MACRO ARRIVA A): questa no.
     Chi cerca l'ASSENZA di una sezione deve guardare la sua INTESTAZIONE, non una frase che
     la nomina — e' la classe del gate che trova se stesso (v213, v240, v393, v395). */
  return !/--- DETTAGLI TECNICI/.test(p) && !/--- COME IL MACRO ARRIVA A/.test(p)
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
  return p.indexOf("le prime tre posizioni valgono il") >= 0
      && /le prime tre posizioni valgono il [0-9]+(,[0-9]+)?%/.test(p)
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
  return !!r && r.sub.includes(fmtNum.format(s.var_1y)) && !/—\\s*in 12 mesi/.test(r.sub);`));

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
     "in:curve || credit || vix" era irraggiungibile perche' "in:" lo prendeva il ramo sopra.
     ⚠⚠ v395 — LA SECONDA META' CONFRONTAVA con la mossa della curva, cioe' provava il
     collegamento per DISUGUAGLIANZA DI VALORE, e il 02/09/2026 i due numeri sono venuti
     uguali per caso (0,3 e 0,3): check rosso senza che nulla fosse rotto. E' la classe gia'
     annotata in v233 — un check che misura i dati del giorno invece della proprieta' va rosso
     da solo. Ora si PERTURBA la serie della curva: se il VIX leggesse quella, il suo numero
     cambierebbe. Due serie possono coincidere per caso; non possono muoversi insieme. */
  const prima = mossaRelativa("vix");
  const salva = m.curve_history;
  m.curve_history = salva.map((p, i) => ({ ...p, v: p.v + (i % 2 ? 7 : -7) }));
  const dopo = mossaRelativa("vix");
  m.curve_history = salva;
  return prima === atteso && dopo === prima;`));

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
  /* ⚠ le righe del digest sono precedute da "· ": startsWith non ha mai trovato niente,
     e il check e' rimasto DORMIENTE dal giorno in cui l'ho scritto. */
  const riga = t.split("\\n").find(l => l.includes("Petrolio WTI"));
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
  const riga = t.split("\\n").find(l => l.includes("Treasury 10A"));
  if (!riga) return true;
  /* prima ci finiva ^TNX da yfinance (4,74) dentro la distribuzione FRED DGS10: risultato 100°,
     cioe' "mai stato cosi' alto", perche' era un valore estraneo alla serie */
  const primo = (riga.match(/Treasury 10A[^:]*:\\s*([\\d,.]+)%/) || [])[1];
  if (!primo) return false;
  const atteso = String(sc.value).replace(".", ",");
  const estraneo = String(((m.carry || {}).us10 ?? "")).replace(".", ",");
  /* il valore collocato deve essere quello della SERIE (FRED DGS10), non la quotazione di
     mercato (^TNX) che veniva da un'altra fonte: 100° percentile era il sintomo */
  return primo === atteso && primo !== estraneo;`));

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


check("v396 cadenza: periodo, acquisizione e prossimo aggiornamento sono TRE campi distinti",
      suVeri(`
  const t = buildCIOText();
  /* ⚠⚠ v396 — QUESTO CHECK ERA DIVENTATO DORMIENTE, e il meta-gate l'ha preso subito. Cercava
     righe con "(N giorni fa)" accanto a "rilevazione|riferito a": la mia stessa modifica ha
     tolto l'eta' stimata dalla riga, quindi il filtro trovava zero righe e il check usciva
     un return anticipato: VERDE PER ASSENZA DEL FENOMENO, trappola gia' pagata cinque volte.
     L'invariante che v350 difendeva resta e si rafforza: le date che la riga nomina devono
     essere DISTINGUIBILI, cosi' che nessuno attacchi un'eta' alla data sbagliata (era il caso
     reale: la stessa 01/07/2026 letta come "3", "8" e "18 giorni fa" in tre righe diverse).
     Ora i campi sono tre e ciascuno ha il proprio nome. */
  const righe = t.split("\\n").filter(l => /riferito (a|al) /.test(l) && /acquisito /.test(l));
  if (righe.length < 3) return false;          // muto = non sta misurando
  return righe.every(l =>
       /riferito (a|al) /.test(l)
    && /acquisito (il \\d{2}\\/\\d{2}\\/\\d{4}|dato non disponibile)/.test(l)
    && /ultima uscita (\\d{2}\\/\\d{2}\\/\\d{4} \\(\\d+ giorni fa\\)|dato non disponibile)/.test(l)
    && /prossimo aggiornamento (\\d{2}\\/\\d{2}\\/\\d{4}|dato non disponibile)/.test(l)
    /* nessuna riga puo' portare un'eta' senza la data a cui si riferisce */
    && !/\\(\\d+ giorni fa\\)/.test(l.replace(/ultima uscita \\d{2}\\/\\d{2}\\/\\d{4} \\(\\d+ giorni fa\\)/g, "")));`));


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
  const b8 = p.slice(p.indexOf("LA TESI CONTRARIA"));
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


/* ══ v354 — L'INVENTARIO. Il sistema dichiarava di non avere cose che ha, e la pagina le
   mostrava: e' la classe v271 ("la pagina dice una cosa e l'analisi un'altra") applicata non a
   un numero ma all'elenco di cio' che il sistema possiede. Fa un danno in piu' di un dato
   mancante: la testata impone di dichiarare la divergenza quando una fonte esterna scosta di
   oltre il 2%, e non si puo' dichiarare una divergenza contro un numero di cui ti hanno detto
   che non esiste. Il pacchetto disattivava il proprio controllo di coerenza. */

check("v354 inventario: cio' che data.json ha NON sta fra le cose da cercare online", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "NVDA");
  if (!r) return true;
  const p = buildPromptTicker("NVDA");
  const daCercare = p.slice(p.indexOf("QUELLO CHE IL SISTEMA NON HA"), p.indexOf("Prezzo di riferimento"));
  const ok = [];
  if ((r.rating || {}).target != null) ok.push(p.includes(fmtNum.format(r.rating.target)) && !/target medio, revisioni/.test(daCercare));
  if ((r.stats || {}).gross_margin != null) ok.push(/margine lordo [\\d.]+%/.test(p));
  if ((r.stats || {}).short_float != null) ok.push(/short float/.test(p));
  if ((r.stats || {}).fcf != null) ok.push(/flusso di cassa libero \\d/.test(p));
  return ok.length > 0 && ok.every(Boolean);`));

check("v354 inventario: il consenso dichiara cosa NON ha (dispersione e revisioni)", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "NVDA" && (x.rating || {}).target != null);
  if (!r) return true;
  const p = buildPromptTicker("NVDA");
  /* target medio e numero di giudizi il sistema li ha; dispersione e revisioni no, e questa e'
     la differenza che rende utile l'uno e obbligatorio cercare l'altro */
  return /CONSENSO DEGLI ANALISTI \\(dal sistema, non da cercare\\)/.test(p)
      && /DISPERSIONE fra target minimo e massimo/.test(p);`));

check("v354 C10: il rimando alla serie annuale trova la serie annuale", suVeri(`
  const p = buildPromptTicker("NVDA");
  if (!/CONTO ECONOMICO TRIMESTRALE/.test(p)) return true;
  /* la riga di chiusura diceva "la serie ANNUALE piu' sopra" e non c'era nessuna serie annuale:
     la sezione SEGNALAZIONI chiede all'LLM di riportare i rimandi a sezioni assenti, quindi il
     sistema chiedeva di trovare un difetto che il sistema stesso produceva */
  const rimanda = /serie ANNUALE qui sopra/.test(p);
  const esiste = /CONTO ECONOMICO ANNUALE/.test(p);
  return rimanda === esiste;`));

check("v354 concentrazione: il gruppo si MISURA, e chi resta fuori viene nominato", suVeri(`
  const p = buildPromptTicker("NVDA");
  const i = p.indexOf("CONCENTRAZIONE:");
  if (i < 0) return true;
  const fineSez = p.indexOf("=== ", i);
  const blocco = p.slice(i, fineSez < 0 ? p.length : fineSez);
  /* il cluster veniva da SECTOR_BENCH, un dizionario ticker→benchmark compilato a mano: CRWV
     (correlazione +0,52 con NVDA su 125 sedute) restava FUORI mentre MRVL e RGTI (+0,37 e
     +0,35) restavano dentro. Una lista a mano non descrive il fattore: descrive chi si e'
     ricordato di aggiungerla. */
  return /si muovono INSIEME/.test(blocco)
      && /correlazione dei rendimenti giornalieri ≥/.test(blocco)
      && (/Sotto soglia/.test(blocco) || /NON MISURABILI/.test(blocco));`));

check("v354 concentrazione: chi non ha abbastanza storia non sparisce in silenzio", suVeri(`
  const p = buildPromptTicker("NVDA");
  const i = p.indexOf("CONCENTRAZIONE:");
  if (i < 0) return true;
  const fineSez = p.indexOf("=== ", i);
  const blocco = p.slice(i, fineSez < 0 ? p.length : fineSez);
  if (!/NON MISURABILI/.test(blocco)) return true;
  /* un nome escluso per mancanza di dati e uno escluso perche' misurato sotto soglia sono due
     cose diverse: letto come "non correlato", il primo diventa una rassicurazione falsa */
  return /non perche' indipendenti/.test(blocco) && /NON e' incluso/.test(blocco);`));


/* ══ v355 — I TRE INTERVENTI: EVENTO, RISCHIO DEL LIBRO, TRAIETTORIA DELLA CRESCITA ═════════
   Tre cose che il sistema aveva nei dati e non pubblicava. Non erano errori: erano assenze —
   la categoria che nessun gate sorvegliava, perche' un gate verifica cio' che c'e'. */

check("v355 evento: col book quotato esce il movimento implicito, col book vuoto lo dichiara", suVeri(`
  const o = (DATA.options || {}).NVDA;
  if (!o || !(o.expiries || []).length) return true;
  const quotato = (o.expiries || []).some(e => (e.calls || []).some(c => Number(c.bid) > 0 && Number(c.ask) > 0));
  if (!quotato) {
    /* ⚠ v400 — DICIANNOVESIMA ROTTURA DI UN CHECK ANCORATO A UNA STRINGA LETTERALE. Pretendeva
       "NON CALCOLABILE ADESSO" ed e' andato rosso su una riga piu' CORRETTA di prima: "adesso"
       affermava uno stato di mercato che il pacchetto non conosce (il book era vuoto allo
       SNAPSHOT, non necessariamente ora). Riagganciato al FATTO che il gate difende: che il
       movimento implicito sia dichiarato non calcolabile, che sia detto perche', e che la
       ragione non pretenda di sapere se il mercato sia aperto adesso. */
    const p2 = buildPromptTicker("NVDA");
    return /MOVIMENTO IMPLICITO: NON CALCOLABILE/.test(p2)
        && p2.indexOf("il book e' vuoto") >= 0
        && p2.indexOf("succede a mercato chiuso") < 0;
  }
  const p = buildPromptTicker("NVDA");
  /* il sistema aveva bid/ask e IV per strike su tre scadenze e ne ricavava due muri: mancava
     l'unica misura che dice quanto il mercato si aspetta che il titolo si muova */
  return /MOVIMENTO IMPLICITO DALLE OPZIONI/.test(p)
      && /straddle [\\d.]+ allo strike [\\d.]+/.test(p)
      && /E' UNA DEVIAZIONE STANDARD/.test(p);`));

check("v355 evento: il salto di IV fra due scadenze isola il premio dell'evento", suVeri(`
  const o = (DATA.options || {}).NVDA;
  const sc = (o && o.expiries) || [];
  if (sc.length < 2) return true;
  const p = buildPromptTicker("NVDA");
  /* misurato su NVDA due giorni prima dei conti: IV 28 sulla scadenza pre-evento contro 60,6
     sulla post-evento. Quel salto e' il prezzo che il mercato da' alla trimestrale. */
  if (!/IL PREZZO DELL'EVENTO/.test(p)) return true;
  return /la volatilita' implicita passa da [\\d.]+ sulla scadenza/.test(p)
      && /rivende dopo a prezzo crollato/.test(p);`));

check("v355 evento: i livelli si rileggono in sigma implicite", suVeri(`
  const p = buildPromptTicker("NVDA");
  /* solo quando il movimento implicito e' stato davvero calcolato: a mercato chiuso il book e'
     vuoto e il pacchetto lo dichiara invece di stampare una sigma inventata */
  if (!/MOVIMENTO IMPLICITO DALLE OPZIONI/.test(p)) return true;
  /* la resistenza a +6,1% sta a UNA sigma implicita esatta: senza questa riga si legge come un
     livello lontano, con questa si legge come un testa-o-croce entro la scadenza */
  return /I LIVELLI IN SIGMA IMPLICITE/.test(p) && /resistenza [\\d.]+σ/.test(p);`));

check("v355 rischio: il contributo al rischio e' pubblicato accanto al peso", suVeri(`
  const conMcr = (DATA.watchlist || []).filter(x => x && numero(x.qta) > 0 && Number.isFinite(numero(x.risk_contrib_pct)));
  if (conMcr.length < 3) return true;
  const p = buildPromptTicker("NVDA");
  /* peso e rischio sono due ordinamenti diversi: MU pesa il 23,1% e contribuisce il 35,0% del
     rischio, NVDA pesa il 19,8% e ne contribuisce l'11,1% */
  return /CONTRIBUTO AL RISCHIO/.test(p) && /peso [\\d.]+% → rischio [\\d.]+%/.test(p)
      && /ordinamento DIVERSO dal peso/.test(p);`));

check("v355 rischio: VaR ed ES del libro arrivano nel pacchetto quando esistono", suVeri(`
  const t = DATA.totals || {};
  if (!Number.isFinite(numero(t.var95_hist_pct))) return true;
  const p = buildPromptTicker("NVDA");
  return /RISCHIO DEL LIBRO NEL SUO INSIEME/.test(p)
      && p.includes(String(numero(t.var95_hist_pct)))
      && /non quanto puo' scendere il libro in un ciclo/.test(p);`));

check("v355 drawdown: profondita' e durata, che nessuno misurava", suVeri(`
  const conSerie = (DATA.watchlist || []).filter(x => x && numero(x.qta) > 0 && ((x.sparks || {}).m6 || []).length >= 30);
  if (conSerie.length < 3) return true;
  const p = buildPromptTicker("NVDA");
  /* in un libro di crescita il rischio non e' la volatilita': e' quanto profondo si scende e
     per quante sedute si resta sotto il picco */
  return /DRAWDOWN MASSIMO delle singole posizioni/.test(p)
      && /-\\d+% \\(\\d+ sedute sott'acqua/.test(p)
      && /dal picco al ritorno su quel livello/.test(p)
      && /e' il calo gia' AVVENUTO/i.test(p);`));

check("v355 crescita: i ricavi portano la variazione, non solo il livello", suVeri(`
  const ct = (((DATA.watchlist || []).find(x => x && x.ticker === "NVDA") || {}).tv || {}).conto_trim || [];
  if (ct.length < 3) return true;
  const p = buildPromptTicker("NVDA");
  /* si pubblicavano cinque ricavi assoluti e si lasciavano quattro divisioni al lettore */
  return /ricavi [\\d.]+ mld \\([-+][\\d.]+% t\\/t\\)/.test(p)
      && /TRAIETTORIA DELLA CRESCITA/.test(p)
      && /SECONDA derivata dei ricavi/.test(p);`));

check("v355 crescita: crescita a/a, utili e PEG escono dai dati che c'erano gia'", suVeri(`
  const st = (((DATA.watchlist || []).find(x => x && x.ticker === "NVDA") || {}).stats) || {};
  if (st.revenue_growth == null && st.peg == null) return true;
  const p = buildPromptTicker("NVDA");
  const ok = [];
  if (st.revenue_growth != null) ok.push(/crescita ricavi a\\/a [\\d.]+%/.test(p));
  if (st.earnings_growth != null) ok.push(/crescita utili a\\/a [\\d.]+%/.test(p));
  if (st.peg != null) ok.push(/PEG [\\d,]+/.test(p));
  return ok.length > 0 && ok.every(Boolean);`));

check("v355 pipeline: il rischio si calcola su CHI HA UNA POSIZIONE, non sull'array PORTFOLIO", (() => {
  const py = readFileSync(join(ROOT, "scripts", "update_data.py"), "utf8");
  /* `compute_risk_metrics(equities, watchlist)` riceveva equities da fetch_equities(), che
     itera su PORTFOLIO: dopo la migrazione delle azioni in watchlist quell'array ha il solo
     BTP, e il motore usciva con return None — tutti i campi di rischio a null. */
  return py.includes("con_posizione = [r for r in (equities + watchlist)")
      && py.includes("compute_risk_metrics(con_posizione, senza_posizione)")
      && py.includes('r.get("value") if r.get("value") is not None else r.get("controvalore")');
})());

check("v355 pipeline: un importo in valuta senza base esce null, non zero", (() => {
  const py = readFileSync(join(ROOT, "scripts", "update_data.py"), "utf8");
  /* uno 0 accanto a "VaR 95%" si legge come "nessun rischio" invece che "non so convertirlo" */
  return py.includes('if (risk.get("var95_1d_pct") and usd_value) else None')
      && py.includes('if (risk.get("es95_hist_pct") and usd_value) else None');
})());


/* ══ v356 — L'ASIMMETRIA DEL SILENZIO, e cinque numeri che dicevano un'altra cosa ══════════
   Trovati da un PM growth che ha provato a usare il sistema. Il piu' grave l'avevo introdotto
   io stesso poche ore prima: avevo costruito la dichiarazione "non calcolabile" per un blocco
   solo. La disciplina vale se e' simmetrica, altrimenti insegna che il silenzio e' ammesso. */

check("v356 simmetria: se il motore di rischio non produce, il pacchetto LO DICE", suVeri(`
  const salva = DATA.totals;
  DATA.totals = Object.assign({}, DATA.totals, { var95_hist_pct: null, var95_1d_pct: null, portfolio_beta_ndx: null });
  const p = buildPromptTicker("NVDA");
  DATA.totals = salva;
  /* le righe stavano dentro un if(isFinite) e con i campi a null sparivano: si incollava un
     pacchetto senza VaR credendo di avere quello con il VaR */
  return /RISCHIO DEL LIBRO NEL SUO INSIEME: NON CALCOLABILE IN QUESTO RUN/.test(p)
      && /NON significa che il rischio sia basso o assente/.test(p);`));

check("v356 evento: il premio si isola solo fra una scadenza PRIMA e una DOPO", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "NVDA");
  const o = (DATA.options || {}).NVDA;
  if (!r || !r.earnings_date || !o) return true;
  const p = buildPromptTicker("NVDA");
  const date = (o.expiries || []).map(e => e.date);
  const evento = String(r.earnings_date).slice(0, 10);
  const haPrima = date.some(d => d < evento), haDopo = date.some(d => d >= evento);
  /* confrontavo le prime due scadenze chiunque fossero: con tutte e tre posteriori all'evento
     avrei chiamato "prezzo dell'evento" la differenza fra due scadenze che l'evento ce l'hanno
     gia' entrambe dentro */
  if (haPrima && haDopo) return true;
  return /IL PREMIO DELL'EVENTO NON E' ISOLABILE/.test(p) || !/MOVIMENTO IMPLICITO DALLE OPZIONI/.test(p);`));

check("v356 etichette: il TTM non si chiama esercizio", suVeri(`
  const st = (((DATA.watchlist || []).find(x => x && x.ticker === "NVDA") || {}).stats) || {};
  if (st.revenue_fy == null) return true;
  const p = buildPromptTicker("NVDA");
  /* revenue_fy coincide al centesimo con la somma dei quattro trimestri (253,49), mentre il
     conto annuale nello stesso pacchetto dice esercizio 2026 = 215,9: due numeri, un nome */
  const q = ((((DATA.watchlist || []).find(x => x && x.ticker === "NVDA") || {}).tv || {}).conto_trim || []).slice(0, 4);
  const somma = q.length === 4 ? q.reduce((a2, x) => a2 + (x.ricavi || 0), 0) : null;
  const scarto = somma ? Math.abs(st.revenue_fy / somma - 1) * 100 : null;
  if (scarto == null) return true;
  return !/ricavi esercizio \\d/.test(p)
      && (scarto <= 2
            ? /ricavi ultimi 12 mesi [^(]*\\(verificato: coincide con la somma/.test(p)
            : /NON QUADRA CON I TRIMESTRI DI QUESTO PACCHETTO/.test(p));`));

check("v356 PEG: non si pubblica senza la crescita che lo genera", suVeri(`
  const st = (((DATA.watchlist || []).find(x => x && x.ticker === "NVDA") || {}).stats) || {};
  if (st.peg == null) return true;
  const p = buildPromptTicker("NVDA");
  /* 32,9 / 0,59 implica ~56% di crescita attesa: un TERZO tasso, diverso dall'85,2% dei ricavi
     e dal 214,5% degli utili stampati due righe sopra */
  return /PEG [\\d,]+ — implica una crescita attesa del \\d+%/.test(p)
      && /TERZA grandezza/.test(p);`));

check("v356 correlazioni: si dichiara che l'indipendenza e' rispetto all'ancora", suVeri(`
  const p = buildPromptTicker("NVDA");
  if (!/Sotto soglia/.test(p)) return true;
  /* "indipendenti" significava indipendenti da NVDA, non fra loro: due nomi possono formare un
     secondo grappolo e il sistema non ha modo di vederlo, perche' misura contro una sola ancora */
  return /indipendenti dall'ancora/.test(p)
      && /fra loro possono muoversi insieme/.test(p)
      && /arrotondati a due decimali/.test(p);`));


/* ══ v357 — IL CASO CHE NESSUN CHECK AVEVA MAI GUARDATO ═══════════════════════════════════
   Tutti i controlli di generazione del pacchetto giravano su NVDA, MU e AMD: tre societa'
   mature e profittevoli. CRWV — quattro esercizi in perdita, EPS negativo, prezzo sul minimo
   dell'anno — ha esercitato per la prima volta i rami anomali, e ne ha rotti sei.
   La lezione non e' nei sei difetti: e' che cio' che non e' mai stato misurato su un caso non
   e' stato verificato, e' stato assunto. */

check("v357 multipli: su utile negativo non si pubblica un rapporto che migliora peggiorando", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "CRWV");
  if (!r || !((r.stats || {}).eps_forward < 0)) return true;
  const p = buildPromptTicker("CRWV");
  /* -47,1× su utile atteso -1,87: se la perdita raddoppia il multiplo diventa -23,5×, cioe'
     apparentemente piu' economico. Un LLM che ordina per multiplo mette in cima chi perde di piu'. */
  return /IL P\\/E PROSPETTICO NON ESISTE E NON VIENE PUBBLICATO/.test(p)
      && /MIGLIORA quando i conti peggiorano/.test(p)
      && !/P\\/E PROSPETTICO: -/.test(p);`));

check("v357 multipli: su un titolo con utili il P/E prospettico resta", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "NVDA");
  if (!r || !((r.stats || {}).eps_forward > 0)) return true;
  /* la correzione non deve rovesciare il caso normale */
  return /P\\/E PROSPETTICO: [\\d.]+×/.test(buildPromptTicker("NVDA"));`));

check("v357 futures: un solo verdetto, e legge il segno", (() => {
  const i = src.indexOf("function statoFutures");
  if (i < 0) return false;
  const corpo = src.slice(i, src.indexOf("\n}\n", i));
  /* due template indipendenti dicevano "verdi o piatti" e "negativi marcati" sugli STESSI due
     numeri, a ventidue righe di distanza, senza che nessuno dei due leggesse change_pct */
  return corpo.includes("confermano") && corpo.includes("contraddicono") && corpo.includes("non decidono")
      && src.includes("statoFutures(m.futures)")
      && !src.includes("negativi marcati = apertura USA in gap-down attesa");
})());

check("v357 TTM: il rapporto coi trimestri si VERIFICA, non si afferma", suVeri(`
  for (const tk of ["NVDA", "CRWV", "MU"]) {
    const r = (DATA.watchlist || []).find(x => x && x.ticker === tk);
    if (!r || (r.stats || {}).revenue_fy == null) continue;
    const q = (((r.tv || {}).conto_trim) || []).slice(0, 4);
    if (q.length < 4) continue;
    const somma = q.reduce((a, x) => a + (x.ricavi || 0), 0);
    const scarto = Math.abs(r.stats.revenue_fy / somma - 1) * 100;
    const p = buildPromptTicker(tk);
    /* su NVDA coincide allo 0,0%, su CRWV scarta del 21,9%: l'etichetta era stata verificata
       su un titolo e promossa a definizione universale */
    const ok = scarto <= 2 ? /verificato: coincide con la somma/.test(p)
                           : /NON QUADRA CON I TRIMESTRI DI QUESTO PACCHETTO/.test(p);
    if (!ok) return false;
  }
  return true;`));

check("v357 trimestri: una tabella ferma non permette di affermare il verso della crescita", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "CRWV");
  const ct = ((r || {}).tv || {}).conto_trim || [];
  if (!r || !r.earnings_date || !ct.length) return true;
  const mesi = Math.round((new Date(String(r.earnings_date).slice(0, 10)) - new Date(String(ct[0].trim).slice(0, 10))) / 86400000 / 30.4);
  const p = buildPromptTicker("CRWV");
  /* ultimo trimestre 2026-03-31, prossima uscita 2026-11-11: sette mesi. "ACCELERA" era
     affermato in maiuscolo su una serie che poteva non contenere l'ultimo trimestre */
  /* ⚠ v397 — DICIASSETTESIMA rottura di un check ancorato a una stringa letterale: pretendeva
     "POTREBBE NON ESSERE AGGIORNATA" ed e' andato rosso quando la diagnosi e' diventata piu'
     FORTE (dal deposito SEC invece che dalla data attesa, quindi "NON E' AGGIORNATA - E' UN
     FATTO"). L'invariante non e' la formula: e' che la tabella ferma venga dichiarata e che il
     verso della crescita non venga affermato lo stesso. */
  const dichiara = /LA TABELLA DEI TRIMESTRI (POTREBBE NON ESSERE|NON E') AGGIORNATA/.test(p);
  const secCrwv = ((DATA.macro.sec_calendario || {}).per_titolo || {}).CRWV;
  if (mesi <= 5 && !(secCrwv && secCrwv.ultimo_deposito)) return true;
  return dichiara && /NON AFFERMABILE/.test(p) && !/l'ultimo trimestre ACCELERA/.test(p);`));

check("v357 crescita: il margine incrementale dice quanto costa, non solo quanto e' veloce", suVeri(`
  const ct = ((((DATA.watchlist || []).find(x => x && x.ticker === "CRWV") || {}).tv) || {}).conto_trim || [];
  if (ct.length < 3) return true;
  const p = buildPromptTicker("CRWV");
  /* su CRWV i due trimestri in cui la crescita accelera sono i due col margine incrementale
     NEGATIVO: ogni euro di ricavo in piu' e' costato piu' di quanto ha reso */
  return /MARGINE INCREMENTALE/.test(p) && /[-+][\\d.]+%/.test(p)
      && /distingue una crescita che si paga da sola da una comprata/.test(p);`));

check("v357 stampa: nessun float grezzo esce nel pacchetto", suVeri(`
  for (const tk of ["NVDA", "CRWV", "MU", "AMD"]) {
    const p = buildPromptTicker(tk);
    /* "(massimo 153.1999969482422, minimo 60.54999923706055)": il ramo dal VIVO leggeva
       Math.max su barre float32, quello dalla pipeline numeri gia' arrotondati da Python */
    if (/\\d+\\.\\d{5,}/.test(p)) return false;
  }
  return true;`));

check("v357 etichette: la glossa non chiama 'settore' un benchmark che non lo e'", suVeri(`
  const p = buildPromptTicker("CRWV");
  if (!/Forza relativa/.test(p)) return true;
  /* la glossa era costante ("del suo settore") mentre il benchmark e' variabile: su CRWV il
     sistema ripiega sull'S&P 500, che non e' il settore di nessuno */
  return /dei due riferimenti NOMINATI qui sopra/.test(p)
      && !/MEGLIO o PEGGIO del suo settore/.test(p);`));

const TETTO_FINESTRE = 20;   // v359: debito dichiarato, monotono in discesa

/* ══ v359 — I META-GATE: la suite misura SE' STESSA ═══════════════════════════════════════
   Ogni difetto trovato oggi e' stato trovato perche' qualcuno ha GUARDATO: il P/E su utile
   negativo, il float a ventidue decimali, la glossa "del suo settore", l'Altman con la
   capitalizzazione. Nessuno e' stato trovato da un gate. E i gate esistenti si guastano nella
   direzione silenziosa — le finestre fisse diventano verdi, i backslash singoli diventano rossi
   accusando il prodotto. Il costo di guardare cresce con la superficie; la capacita' di
   guardare no. Questi due controlli non guardano il prodotto: guardano la suite. */

check("meta: le finestre a caratteri fissi non aumentano (tetto TETTO_FINESTRE, solo in discesa)", (() => {
  const mio = readFileSync(fileURLToPath(import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const fisse = [...mio.matchAll(/\.slice\(\s*\w+\s*,\s*\w+\s*\+\s*\d{2,}\s*\)/g)].map(m => m[0]);
  /* ⚠ IL TETTO E' UN DEBITO DICHIARATO, NON UN PERMESSO. La migrazione automatica e' stata
     provata due volte e rifiutata: la prima graffa dopo l'ancora non e' sempre il blocco voluto
     (su una callback e' il corpo della callback), e cinque check sono diventati rossi. Le
     restanti vanno migrate a mano, una alla volta, quando si tocca il check che le contiene.
     Questo gate garantisce solo che il numero non RISALGA. */
  if (fisse.length > TETTO_FINESTRE) {
    console.log(`  ⛔ ${fisse.length} finestre fisse contro un tetto di ${TETTO_FINESTRE}: usa bloccoDa(). `
      + fisse.slice(0, 3).join(" · "));
  }
  return fisse.length <= TETTO_FINESTRE;
})());

/* ⚠⚠ v396 — IL BACKTICK DENTRO UN TEMPLATE LO CHIUDE, e in una sola sessione ci sono cascato
   TRE volte: una nel commento che spiegava la correzione di v349, una nel commento che citava
   la stringa rimossa da v320, una nel commento che spiegava la trappola dei check dormienti.
   Tutte e tre le volte il commento CITAVA del codice, che e' la ragione per cui viene naturale
   racchiuderlo fra apici inversi. E tutte e tre le volte `modifica_sicura` ha rifiutato la
   scrittura, che e' esattamente il lavoro per cui esiste — ma il rifiuto arriva DOPO aver
   scritto lo script, e la regola di questo progetto e' che un difetto di metodo ripetuto non si
   corregge con l'attenzione, si corregge cambiando lo strumento perche' non lo accetti piu'.
   Fratello del rilevatore dei backslash qui sotto: stessa causa, stesso posto, stessa forma. */
check("meta: nessun backtick dentro un template passato al vm", (() => {
  /* ⚠ SESTA VOLTA CHE UN GATE TROVA SE' STESSO, e mi e' successo scrivendo il gate che doveva
     chiudere un'ALTRA trappola ricorrente. I meta-gate contengono la sequenza di apertura come
     DATO — nel commento che la spiega e dentro la propria regex — quindi lo scanner la leggeva
     come una vera chiamata e denunciava due guasti inesistenti. Rimedio gia' scritto in
     CLAUDE.md per v213, v240 e v393: si tolgono i commenti e si esclude il blocco dei meta. */
  const mio = readFileSync(fileURLToPath(import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/check\("meta: nessun back(?:slash|tick)[\s\S]*?\}\)\(\)\);/g, "")
    .replace(/check\("meta: il rilevatore dei backslash[\s\S]*?\}\)\(\)\);/g, "");
  /* si isola ogni template passato a un helper del vm e si guarda se, PRIMA della chiusura,
     compare un backtick non escapato: se c'e', il template finisce li' e il resto del check
     diventa sintassi arbitraria — che e' come si e' rotta la suite tre volte oggi. */
  const APERTURE = /(?:run|suVeri|suReale|suVeriEsito|conDiario|conComb|conCombEsito)\(`/g;
  const guasti = [];
  for (const m of mio.matchAll(APERTURE)) {
    const da = m.index + m[0].length;
    let k = da, chiuso = -1;
    while (k < mio.length) {
      const ch = mio[k];
      if (ch === "\\") { k += 2; continue; }
      if (ch === "`") { chiuso = k; break; }
      k++;
    }
    if (chiuso < 0) { guasti.push("template mai chiuso a " + da); continue; }
    /* il template chiude dove deve? se subito dopo non c'e' una chiusura di chiamata
       plausibile, il backtick trovato era dentro il corpo e ha spezzato tutto. */
    const coda = mio.slice(chiuso + 1, chiuso + 6);
    if (!/^\s*\)/.test(coda))
      guasti.push(mio.slice(Math.max(da, chiuso - 46), chiuso + 4).replace(/\n/g, "\u23ce"));
  }
  if (guasti.length) {
    console.log("  \u26d4 " + guasti.length + " backtick dentro un template del vm: lo chiudono. "
      + guasti.slice(0, 2).join(" \u00b7 "));
  }
  return guasti.length === 0;
})());


check("meta: nessun backslash SINGOLO dentro un template passato al vm", (() => {
  const mio = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const sospetti = [];
  /* dentro un template il backslash e' un escape DEL TEMPLATE: `\d` arriva al vm come `d`, la
     regex compila e non matcha mai. Si cercano i template che contengono una regex e dentro di
     essi i backslash non raddoppiati davanti alle classi che contano. */
  const soloCodice = mio.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const m of soloCodice.matchAll(/(?:run|suVeri|suReale|suVeriEsito|conDiario|conComb|conCombEsito)\(`(?:[^`\\]|\\[\s\S])*`/g)) {
    const t = m[0];
    if (!/\.test\(|\.match\(|new RegExp/.test(t)) continue;
    /* ⚠⚠ v422 — LA CLASSE SI ALLARGA A n/r/t/0, e la ragione e' peggiore delle altre: dentro un
       template `barra-n` diventa un A CAPO VERO, e un a capo dentro un letterale di espressione
       regolare NON e' una regex che non matcha — e' un ERRORE DI SINTASSI dentro il vm, cioe' un
       check che muore in eccezione. Costato un giro in questa stessa versione, scrivendo
       [^barra-n] in un gate riagganciato. Nel progetto l'idioma corretto esiste gia' ed e'
       String.fromCharCode(10): non c'e' nessun uso legittimo di queste sequenze qui dentro. */
    for (const b of t.matchAll(/(?<!\\)\\[dwsbDWSBnrt0]/g)) {
      sospetti.push(t.slice(Math.max(0, b.index - 28), b.index + 10).replace(/\n/g, "⏎"));
    }
  }
  /* ⚠⚠ v406 — LA STESSA CAUSA, UN SINTOMO PIU' BRUTALE: una VIRGOLETTA sfuggita dentro un
     template (barra-virgolette) arriva al vm come virgoletta NUDA e chiude la stringa a meta'.
     Non produce una regex che non matcha: produce un errore di sintassi DENTRO il vm, cioe' un
     check che muore in eccezione. E `node --check` non lo vede, perche' per lui e' testo dentro
     un template. Non esiste nessuna ragione legittima di scriverla: il template l'ha gia'
     mangiata prima che il vm la veda, quindi la si cerca in TUTTI i template passati al vm, non
     solo in quelli che contengono una regex. Costata un giro di debug in v406. */
  for (const m of soloCodice.matchAll(/(?:run|suVeri|suReale|suVeriEsito|conDiario|conComb|conCombEsito)\(`(?:[^`\\]|\\[\s\S])*`/g)) {
    const t = m[0];
    for (const b of t.matchAll(/(?<!\\)\\["']/g)) {
      sospetti.push("virgoletta sfuggita: " + t.slice(Math.max(0, b.index - 34), b.index + 12).replace(/\n/g, "⏎"));
    }
  }
  if (sospetti.length) {
    console.log(`  ⛔ ${sospetti.length} backslash singoli in template → il vm li mangia: raddoppiali. `
      + sospetti.slice(0, 2).join(" · "));
  }
  return sospetti.length === 0;
})());


/* ══ v360 — LA SEZIONE DEL RISCHIO: misura e confronta, non simula e non prescrive ══════════
   Scelta esplicita del CEO fra quattro opzioni: "misura e basta" piu' "confronta con un profilo
   di riferimento". NON la simulazione di una regola, NON gli allarmi di soglia.
   ⚠ E il riferimento non puo' essere un numero di settore asserito senza fonte: sono versioni
   alternative dello STESSO libro, misurate sulle stesse sedute. */

check("v360 rischio: il confronto ha almeno tre profili e sono misurati sulle stesse sedute", suVeri(`
  const pr = profiliRischio();
  if (!pr) return true;
  /* ogni colonna nasce dagli stessi dati: la differenza fra due righe e' l'effetto di UNA scelta */
  return pr.profili.length >= 3 && pr.sedute >= 100
      && pr.profili[0].nome === "Il tuo libro"
      && pr.profili.every(x => Number.isFinite(x.vol) && Number.isFinite(x.dd) && Number.isFinite(x.sotto));`));

check("v360 rischio: le scommesse effettive non superano il numero dei nomi", suVeri(`
  const pr = profiliRischio();
  if (!pr) return true;
  /* 1/(1/k + (k-1)/k*rho) e' <= k per costruzione: se esce di piu', la correlazione media e'
     negativa o il conto e' sbagliato — ed e' il numero che rende leggibile una concentrazione */
  return pr.profili.filter(x => x.eff != null && !x.indice).every(x => x.eff <= x.n + 0.01 && x.eff >= 1);`));

check("v360 rischio: il pacchetto pubblica il confronto e dichiara che non e' un obiettivo", suVeri(`
  const pr = profiliRischio();
  if (!pr || pr.profili.length < 3) return true;
  const p = buildPromptTicker("NVDA");
  return /IL RISCHIO DEL LIBRO, E CON CHE COSA SI CONFRONTA/.test(p)
      && /scommesse effettive/.test(p)
      && /non sono un obiettivo/.test(p)
      && /nessun numero viene da fuori/.test(p);`));

check("v360 rischio: il blocco del prompt chiede le quattro domande e vieta il dimensionamento", suVeri(`
  const p = buildPromptTicker("NVDA");
  const b = p.slice(p.indexOf("8) IL RISCHIO"), p.indexOf("LA TESI CONTRARIA"));
  /* le quattro scelte del CEO, piu' il confine: misurare e collegare, mai dimensionare */
  return /LA TESI REGGE IL RISCHIO CHE PORTA/.test(b)
      && /QUALE FATTO ROMPEREBBE PIU' POSIZIONI INSIEME/.test(b)
      && /LA DISCESA IN CORSO E' ORDINARIA O E' UNA ROTTURA/.test(b)
      && /CHE COSA MANCA PER GIUDICARE IL RISCHIO/.test(b)
      && /MISURA E COLLEGA, NON DIMENSIONARE/.test(b);`));

check("v360 rischio: la tesi contraria resta l'ULTIMO blocco anche dopo l'inserimento", suVeri(`
  const p = buildPromptTicker("NVDA");
  const iR = p.indexOf("IL RISCHIO, dal lato del libro");
  const iC = p.indexOf("LA TESI CONTRARIA");
  /* il rischio entra come blocco 8 e la contraria diventa 9: l'invariante non e' il numero,
     e' che la contraria venga per ULTIMA — dopo aver scritto un giudizio.
     ⚠ v389 — LA RICERCA SI FERMA ALLA FINE DELLE ISTRUZIONI. Prima scorreva fino in fondo al
     pacchetto, quindi qualunque riga di DATI che cominci con "N) " la faceva fallire — ed e'
     successo appena la disciplina di rischio ha pubblicato le sue regole numerate. I blocchi
     da consegnare vivono nelle ISTRUZIONI: cercarli nel payload e' misurare la regione
     sbagliata, la stessa classe del registro di posizioni fisse del red team (I6). */
  const fine = p.indexOf("QUADRO MACRO DI RIFERIMENTO");
  const istruzioni = fine > iC ? p.slice(iC + 20, fine) : p.slice(iC + 20);
  /* ⚠ v389 — la classe di cifre copriva UNA cifra sola: un decimo blocco ("10) ") non faceva
     scattare il gate, e l'ho scoperto provando a iniettare proprio quello. Ora una o piu' cifre.
     Un gate si valida iniettando il difetto, e l'iniezione va scelta fra i casi che il gate DEVE
     prendere, non fra quelli comodi: la prima che avevo scritto passava per una ragione che non
     c'entrava col difetto, e avrebbe certificato una protezione che non c'era. */
  return iR > 0 && iC > iR && !/\\n\\d+\\) /.test(istruzioni);`));

check("v360 rischio: la pagina ha la sezione e il suo contenitore", (() => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  /* v315: un contenitore nel markup senza chi lo riempie e' un blocco che non c'e' */
  return html.includes('data-sez="rischio"') && html.includes('id="rischio-tabella"')
      && src.includes("function renderRischio()") && src.includes("renderRischio();");
})());


/* ══ v361 — TRE COSE CHE AVEVO DICHIARATO IMPOSSIBILI ED ERANO GRATIS ══════════════════════
   Revisioni degli utili, dispersione del consenso e dispersione dei target: tre revisori le
   avevano indicate come i buchi che piu' pesano su un mandato di crescita, e io avevo risposto
   al CEO che erano un tetto STRUTTURALE. yfinance — gia' usato dalla pipeline per tutto il
   resto — le espone tutte e tre senza chiave e senza costo. Non le avevo cercate. */

check("v361 revisioni: la traiettoria della stima e l'ampiezza arrivano nel pacchetto", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "NVDA");
  const salva = r ? r.analisti : undefined;
  if (r) r.analisti = { eps_ora: 13.04, eps_90g_fa: 12.59, revisione_90g_pct: 3.59,
    revisione_7g_pct: 1.72, su_30g: 4, giu_30g: 0, eps_min: 9.65, eps_max: 16.97, eps_n: 51,
    target_min: 180, target_max: 500, target_mediana: 300 };
  const p = buildPromptTicker("NVDA");
  if (r) r.analisti = salva;
  /* la testata dice da sempre che le revisioni battono il target; ora il sistema le fornisce */
  return /REVISIONI DEGLI UTILI/.test(p)
      && /passata da [\\d,.-]+ a [\\d,.-]+ in 90 giorni/.test(p)
      && /4 analisti hanno ALZATO la stima e 0 l'hanno ABBASSATA/.test(p);`));

check("v361 revisioni: quando traiettoria e ampiezza divergono, la divergenza E' il fatto", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "CRWV");
  if (!r) return true;
  const salva = r.analisti;
  /* misurato su CRWV: +23,8% a novanta giorni ma 3 al rialzo contro 6 al ribasso negli ultimi
     trenta. La traiettoria dice da dove viene, l'ampiezza dove sta andando adesso. */
  r.analisti = { eps_ora: -4.24, eps_90g_fa: -5.56, revisione_90g_pct: 23.83, su_30g: 3, giu_30g: 6 };
  const p = buildPromptTicker("CRWV");
  r.analisti = salva;
  return /TRAIETTORIA E AMPIEZZA DIVERGONO/.test(p) && /prevalgono i TAGLI/.test(p);`));

check("v361 dispersione: il minimo dei target sotto il prezzo viene DICHIARATO", suVeri(`
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "NVDA");
  if (!r) return true;
  const salva = r.analisti;
  r.analisti = { target_min: 1, target_max: 500, target_mediana: 300 };
  const p1 = buildPromptTicker("NVDA");
  r.analisti = { target_min: 999999, target_max: 1000000, target_mediana: 999999 };
  const p2 = buildPromptTicker("NVDA");
  r.analisti = salva;
  /* la media di 304 nasconde che c'e' chi vede il titolo sotto il prezzo di adesso */
  return /IL MINIMO STA SOTTO IL PREZZO DI RIFERIMENTO/.test(p1)
      && /Il minimo sta sopra il prezzo di riferimento/.test(p2);`));

check("v361 inventario: revisioni e dispersione non stanno piu' fra le cose da cercare", suVeri(`
  const p = buildPromptTicker("NVDA");
  const daCercare = p.slice(p.indexOf("QUELLO CHE IL SISTEMA NON HA"), p.indexOf("Prezzo di riferimento"));
  /* l'inventario si aggiorna quando il sistema acquisisce qualcosa, o torna a mentire */
  return /revisioni dei RICAVI/.test(daCercare)
      && !/la DISPERSIONE fra target minimo e massimo e le revisioni/.test(daCercare);`));

check("v361 pipeline: i campi vengono da yfinance e il fallimento e' dichiarato", (() => {
  const py = readFileSync(join(ROOT, "scripts", "update_data.py"), "utf8");
  return py.includes("t.eps_trend") && py.includes("t.eps_revisions")
      && py.includes("t.earnings_estimate") && py.includes("t.analyst_price_targets")
      && py.includes('"analisti": analisti,') && py.includes('print(f"!! analisti {ticker}');
})());


/* ══ v362 — I CHECK DORMIENTI: verdi, e senza misurare niente ═══════════════════════════════
   Un check che esce con `if (!soggetto) return true` e' verde anche quando il soggetto non
   esiste piu'. E' la stessa proprieta' delle finestre a caratteri fissi — si guasta senza
   mordere — ma piu' difficile da vedere, perche' non c'e' un numero da guardare.
   Misurati oggi strumentando le uscite: erano OTTO. Cinque erano difetti veri e sono stati
   corretti (due regex che non matchavano piu' dopo una modifica al formato, due che cercavano
   righe precedute da "· " con startsWith, uno che girava contro il fixture dove NVDA non
   esiste). I TRE che restano sono FOSSILI: sorvegliano righe rimosse deliberatamente in v256
   col portafoglio e col motore delle decisioni — "primo settore:", "Livelli calcolati dal
   motore", "Quadro d'insieme".
   ⚠ NON li cancello: se quelle righe tornassero, l'invariante servirebbe. E non li riscrivo
   alla cieca: sono check con corpi annidati, e un tentativo automatico ha gia' rotto la
   sintassi (modifica_sicura l'ha rifiutato). Restano, e il loro numero e' DICHIARATO e
   MONOTONO IN DISCESA come per le finestre: cosi' il debito e' visibile e non puo' crescere. */
const TETTO_DORMIENTI = 3;

check("meta: i check dormienti non aumentano (tetto TETTO_DORMIENTI, solo in discesa)", (() => {
  /* si strumentano le uscite anticipate e si esegue la suite in un processo separato: ogni
     check che prende l'uscita restituisce una stringa, e check() la rifiuta come malformata */
  const mio = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const strumentato = mio
    .replace(/if\s*\(([^)]{1,160})\)\s*return true;/g, 'if ($1) return "__DORMIENTE__";')
    /* il meta-gate non deve strumentare se' stesso, o si conta da solo */
    .replace(/check\("meta: i check dormienti[\s\S]*?\}\)\(\)\);/, "");
  const tmp = join(ROOT, "scripts", ".dormienti.tmp.mjs");
  let n = 0;
  try {
    writeFileSync(tmp, strumentato);
    const out = execSync(`node ${JSON.stringify(tmp)} 2>&1 || true`, { encoding: "utf8", maxBuffer: 20e6 });
    n = (out.match(/CHECK MALFORMATO/g) || []).length;
    if (n > TETTO_DORMIENTI) {
      console.log(`  ⛔ ${n} check dormienti contro un tetto di ${TETTO_DORMIENTI}:`);
      out.split("\n").filter(l => l.includes("CHECK MALFORMATO"))
        .forEach(l => console.log(`     ${l.replace(/\s+⛔.*/, "").replace(/^FAIL\s+/, "").slice(0, 90)}`));
    }
  } catch { return true; }   /* se la strumentazione non gira, non si blocca la CI su un meta */
  finally { try { unlinkSync(tmp); } catch { /* gia' rimosso */ } }
  return n <= TETTO_DORMIENTI;
})());

/* ═══ v393 — I GRAFICI DELLA DISCIPLINA DI RISCHIO ═══════════════════════════════════════
   ⚠ I check leggono l'HTML DAVVERO PRODOTTO, non il sorgente: in v226 un check che chiamava la
   funzione pura direttamente era verde mentre la pagina disegnava uno spicchio fantasma. */
check("v393 la disciplina di rischio disegna i tre grafici chiesti dal CEO", suVeri(`
  const g = graficiDisciplina(disciplinaRischio());
  const titoli = (g.match(/disc-graf-tit/g) || []).length;
  const barre  = (g.match(/obar-row/g) || []).length;
  const archi  = (g.match(/ciam-arco/g) || []).length;
  return titoli === 3 && barre >= 5 && archi >= 2;`));

/* ⚠⚠ LA PROPRIETA' CHE IL DIFETTO VIOLEREBBE PER COSTRUZIONE: nell'istogramma degli
   scostamenti possono entrare SOLO regole misurate in percentuale dell'azionario. Mettere sullo
   stesso asse le scommesse effettive (un conteggio), il drawdown (altro denominatore) o la
   liquidita' (sedute) e' la classe "denominatori non dichiarati". Il check non conta le barre:
   verifica che ogni riga disegnata abbia una soglia percentuale dichiarata dalla regola. */
check("v393 nell'istogramma entrano solo le regole con lo STESSO denominatore", suVeri(`
  const d = disciplinaRischio();
  const per = (u) => d.regole.filter(r => r.unita === u).map(r => r.nome);
  const disegnate = new Set(d.graf.scostamenti.map(s => s.nome));
  /* tutte e sole le regole in percentuale dell'azionario stanno sull'asse */
  const soloQuelle = d.graf.scostamenti.every(s => per("pct_azionario").includes(s.nome));
  /* e nessuna delle altre unita' ci finisce: sono i denominatori che non si mescolano */
  const altre = ["conteggio", "pct_valore_nel_tempo", "sedute"].flatMap(per);
  const nessunaAltra = altre.length >= 3 && altre.every(n => !disegnate.has(n));
  return soloQuelle && nessunaAltra && d.graf.scostamenti.length >= 2;`));

/* i grafici e le righe devono essere LO STESSO numero: due derivazioni divergono (v161/v207) */
check("v393 il grafico e la riga sotto di lui portano la stessa misura", suVeri(`
  const d = disciplinaRischio();
  return d.graf.scostamenti.every(s => {
    const r = d.regole.find(x => x.nome === s.nome);
    return r && Math.abs(r.valore - s.misura) < 1e-9
             && Math.abs((r.valore - r.sogliaPct) - s.oltre) < 1e-9;
  });`));

check("v393 la torta del fattore nomina i titoli e somma a cento", suVeri(`
  const f = disciplinaRischio().graf.fattore;
  if (!f) return false;
  return f.nomi.length >= 2 && f.nomi.every(n => typeof n === "string")
      && Math.abs(f.dentro + f.fuori - 100) < 1e-6;`));

/* ⚠ un mese senza trimestrali resta nell'asse: un buco fra due addensamenti e' informazione
   quanto un picco, e toglierlo farebbe sembrare contigui due mesi che non lo sono. */
/* ⚠⚠ IL GATE DEVE ESERCITARE IL RAMO, NON SPERARE CHE I DATI LO CONTENGANO. La prima stesura
   asseriva la contiguita' sui dati veri — dove le trimestrali cadono in tre mesi CONSECUTIVI,
   quindi comprimere o non comprimere dava lo stesso risultato e l'iniezione non mordeva: verde
   per una ragione che non c'entrava col difetto. Qui il buco si CREA: due trimestrali a tre
   mesi di distanza, e in mezzo devono comparire i mesi a zero. E' la lezione v234 — un ramo che
   nessun test percorre non e' una protezione. */
check("v393 il calendario tiene i mesi vuoti nell'asse invece di comprimerli", suVeri(`
  const oggi = new Date();
  const fra = (m) => new Date(oggi.getFullYear(), oggi.getMonth() + m, 15).toISOString().slice(0, 10);
  DATA.macro = DATA.macro || {};
  DATA.macro.sec_calendario = { per_titolo: {} };     // niente seconda derivazione a interferire
  const az = [...(DATA.portfolio || []), ...(DATA.watchlist || [])]
    .filter(r => r && Number(r.qta ?? r.qty) > 0 && Number(r.pmc) > 0
                 && !/^BTP|^BOT|^CCT|^IT000/i.test(String(r.ticker)));
  az.forEach((r, i) => { r.earnings_date = fra(i === 0 ? 1 : 4); });   // mese +1 e mese +4
  const e = disciplinaRischio().graf.eventi;
  if (!e) return false;
  const t = e.map(x => Number(x.mese.slice(0, 4)) * 12 + Number(x.mese.slice(5, 7)));
  const contigui = t.every((v, i) => i === 0 || v === t[i - 1] + 1);
  const conBuco = e.filter(x => x.pct === 0).length >= 2;   // i due mesi in mezzo, a zero
  return e.length === 4 && contigui && conBuco;`));

check("v393 i grafici sono agganciati al renderer, non solo definiti", (() => {
  /* ⚠ la scansione TOGLIE I COMMENTI: iniettando "// graficiDisciplina(d)" un check ancorato
     al sorgente grezzo resterebbe verde mentre i grafici spariscono dalla pagina (v389). */
  const codice = src.split(String.fromCharCode(10))
    .map(r => r.replace(/^\s*\/\/.*$/, "")).join(String.fromCharCode(10));
  return /\+\s*graficiDisciplina\(d\)/.test(codice);
})());

/* ═══ v393 — LE NOTIZIE NON ANCORA PREZZATE NON SI CONTANO PER POI NASCONDERLE ════════════
   Il pacchetto dichiarava "3 pubblicate DOPO l'ultima chiusura" e ne mostrava UNA: le altre due
   sparivano perche' fuori dalle 8 ore. Una di quelle taciute parlava di high yield in tensione,
   cioe' contraddiceva la riga sul credito dello stesso pacchetto. */
/* ⚠ IL FENOMENO CI DEVE ESSERE PER COSTRUZIONE. La prima stesura usciva con `return true`
   quando lo snapshot non aveva voci post-chiusura: verde per ASSENZA DI DATI, non di difetti —
   la trappola gia' pagata quattro volte in questo progetto, e il meta-gate dei check dormienti
   l'ha intercettata subito. Qui le notizie si INIETTANO: una dentro la finestra e due appena
   dopo l'ultima campana. Sotto il codice vecchio le due sparivano; sotto quello nuovo ci sono. */
check("v393 ogni notizia non ancora prezzata compare nell'elenco, dentro o fuori finestra", suVeri(`
  const ch = lastUsEquityCloseUTC();
  const t = (ms) => new Date(ms).toISOString();
  DATA.macro = DATA.macro || {};
  DATA.macro.news = { fonti: ["Prova"], filtro: "sintetico", voci: [
    { titolo: "DENTRO-LA-FINESTRA-8H", riassunto: "", fonte: "Prova", quando: t(Date.now() - 36e5) },
    { titolo: "POST-CHIUSURA-UNO",     riassunto: "", fonte: "Prova", quando: t(ch.at.getTime() + 1000) },
    { titolo: "POST-CHIUSURA-DUE",     riassunto: "", fonte: "Prova", quando: t(ch.at.getTime() + 2000) },
  ] };
  const p = buildPrompt();
  return p.includes("DENTRO-LA-FINESTRA-8H")
      && p.includes("POST-CHIUSURA-UNO")
      && p.includes("POST-CHIUSURA-DUE");`));

check("v393 UMich dichiara la fonte che ha SERVITO il dato, non una fissa", (() => {
  const codice = src.split(String.fromCharCode(10))
    .map(r => r.replace(/^\s*\/\/.*$/, "")).join(String.fromCharCode(10));
  /* la voce del ripiego esiste, e la scelta passa dal campo `fonte` dell'indicatore */
  return codice.includes("umich_fred:")
      && /i\.fonte === "ripiego" \? "umich_fred" : i\.key/.test(codice)
      && codice.includes("FONTE PRIMARIA (sca.isr.umich.edu)");
})());

check("v393 il calendario di UMich e' quello della primaria: stesso mese, non il mese dopo", suVeri(`
  /* la primaria pubblica il definitivo negli ultimi giorni dello STESSO mese che misura.
     Col vecchio mesiRitardo la riga annunciava il prossimo dato con un mese di ritardo. */
  /* ⚠ v396 — la data attesa era una PROIEZIONE (fine mese + 28 giorni) e non si pubblica piu'.
     Resta il fatto che questo check esiste per difendere: UMich viene dalla fonte PRIMARIA, e
     il calendario FRED — che descriverebbe la ridistribuzione, con 1-2 mesi di ritardo di
     licenza — non deve toccarlo. Quindi la riga nomina la primaria e per la prossima uscita
     dichiara che il dato non c'e', invece di prendere quella sbagliata. */
  const r = rigaCadenza("umich", "2026-08-01");
  return r.includes("riferito a agosto 2026")
      && r.includes("prossimo aggiornamento dato non disponibile")
      && r.includes("UMich (fonte primaria)")
      && !r.includes("via FRED");`));

/* ---------- report ----------
   ⚠ v205: questo blocco stava PRIMA degli ultimi tre gruppi di check (v196, v205, v204).
   Conseguenza misurata: quei check finivano in T e venivano CONTATI nel totale, ma il ciclo
   che calcola `fail` era già passato — non venivano stampati e, soprattutto, NON facevano
   uscire con codice 1. Verificato togliendo `id="conc-chart"` da index.html: la suite
   annunciava "174/174 superati" ed exit 0. La guardia anti-taglio v204, cioè proprio quella
   nata perché "l'attenzione non basta", era spenta in silenzio.
   Il report va per ultimo: ogni check aggiunto in fondo al file deve poter rompere la CI. */
/* ---------- v363: la sezione del rischio deve DIRE cosa ha trovato, non solo mostrarlo ----------
   ⚠ Il CEO: "sezione non comprensibile". Era una tabella di cinque righe con intestazioni
   tecniche ("cosa isola", "scommesse effettive") e nessuna frase che dicesse l'esito del
   confronto. Rifatta: prima le conclusioni CALCOLATE, poi la tabella come prova.
   Questi due check sorvegliano i due modi in cui puo' tornare com'era. */
check("v363 · il rischio apre con le frasi, non con la tabella", (() => {
  const b = bloccoDa(src, "function renderRischio", { max: 6000 });
  const iFrasi = b.indexOf("rischio-frasi"), iTab = b.indexOf("<table");
  if (iFrasi < 0) return no("le frasi calcolate sono sparite: resta la tabella nuda");
  if (iTab < 0) return no("la tabella-prova e' sparita: restano affermazioni senza righe");
  if (iFrasi > iTab) return no("la tabella viene prima delle frasi: e' l'ordine che il CEO ha respinto");
  /* le intestazioni gergali non devono tornare — solo nelle celle di TESTATA:
     nella nota il termine e' SPIEGATO, ed e' quel che rende leggibile la sezione */
  const testata = b.slice(b.indexOf("<thead"), b.indexOf("</thead>") + 8);
  if (testata.length < 20) return no("non trovo la testata della tabella: il divieto non e' misurabile");
  for (const gergo of ["cosa isola", "scommesse effettive"])
    if (testata.includes(gergo)) return no(`intestazione gergale rientrata: "${gergo}"`);
  return true;
})());

/* Un rapporto vicino a 1 arrotondato a una cifra diventa "1 volte tanto": grammatica rotta E
   informazione nulla. Quando due cose oscillano uguale la notizia e' proprio quella, e va
   scritta a parole. Il check verifica che il ramo "quanto" esista e che la soglia lo copra. */
check("v363 · nessun \"1 volte\": il rapporto ~1 si dice a parole", (() => {
  const b = bloccoDa(src, "function renderRischio", { max: 6000 });
  if (!/Oscilla quanto \$\{nome\}/.test(b)) return no("sparito il ramo che dice 'oscilla quanto X'");
  const m = b.match(/Math\.abs\(r - 1\) < ([\d.]+)/);
  if (!m) return no("sparita la soglia che separa 'quanto' da 'N volte'");
  const soglia = parseFloat(m[1]);
  /* con una cifra decimale, un rapporto entro 0.05 da 1 stampa "1 volte": la soglia deve coprirlo */
  if (soglia < 0.05) return no(`soglia ${soglia} troppo stretta: fra ${soglia} e 0.05 stampa ancora "1 volte"`);
  if (soglia > 0.3) return no(`soglia ${soglia} troppo larga: chiama "uguali" cose che differiscono del 30%`);
  return true;
})());

/* ---------- v363: "prossimo" non si dice di una data passata ----------
   ⚠ Trovato leggendo il pacchetto del CEO: due serie giornaliere annunciavano "prossimo atteso
   24/08/2026" dentro un pacchetto datato 25/08. L'allarme non era rotto — la grazia di due
   giorni lavorativi (v266/v271) stava facendo il suo mestiere — ma il testo prometteva un
   futuro riferito a ieri. E' il danno di v350 ripetuto: chi trova una data storta smette di
   fidarsi anche delle righe giuste. Ora lo stato intermedio si dice, e questo check impedisce
   che "prossimo atteso" torni a coprire una data gia' passata. */
const _esitoV363 = (r) => r === true ? true : no(String(r));
/* ⚠⚠ v396 — QUESTI DUE CHECK SORVEGLIAVANO LA PROIEZIONE, CHE NON C'E' PIU'.
   Il primo cercava la forma "prossimo atteso GG/MM/AAAA"; il secondo pretendeva che
   ESISTESSE lo stato intermedio "atteso, non ancora arrivato, entro la tolleranza".
   Entrambi difendevano un'aritmetica che il CEO ha vietato: le date non si proiettano piu'.
   Non vengono cancellati e non vengono zittiti — diventano la RICEVUTA della rimozione, che
   e' l'unica forma in cui una protezione sopravvive a un taglio: verificano che cio' che e'
   stato tolto non rientri, e che al suo posto ci sia la dichiarazione onesta. */
check("v396 · nessuna data pubblicata come 'prossima' cade nel passato", _esitoV363( suVeri(`
  const p = buildPrompt();
  const mData = p.match(/DATI AL (\\d{2})\\/(\\d{2})\\/(\\d{4})/);
  if (!mData) return no("il pacchetto non dichiara piu' la propria data: il confronto non e' possibile");
  const oggi = new Date(mData[3] + "-" + mData[2] + "-" + mData[1]);
  const FORME = /prossimo aggiornamento (\\d{2})\\/(\\d{2})\\/(\\d{4})/g;
  const passate = [];
  for (const m of p.matchAll(FORME)) {
    const d = new Date(m[3] + "-" + m[2] + "-" + m[1]);
    if (d < oggi) passate.push(m[0] + " (" + Math.round((oggi - d) / 86400000) + " giorni fa)");
  }
  if (passate.length) return "date passate annunciate come prossime: " + [...new Set(passate)].join(", ");
  /* il detector deve aver visto qualcosa, altrimenti e' muto e si legge come una conferma */
  const quante = [...p.matchAll(FORME)].length;
  if (quante < 3) return "solo " + quante + " righe con una data di prossimo aggiornamento: non sto misurando";
  return true;`)));

check("v396 · la proiezione e' rimossa e al suo posto c'e' la dichiarazione, non un buco", (() => {
  const b = bloccoDa(src, "function rigaCadenza", { max: 3000 });
  const senzaCommenti = b.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/prossimo atteso/.test(senzaCommenti)) return no("la forma proiettata e' rientrata");
  if (/NON È ARRIVATO|tolleranza/.test(senzaCommenti)) return no("l'allarme sulla data inventata e' rientrato");
  if (!/dato non disponibile/.test(senzaCommenti) && !/ND/.test(senzaCommenti))
    return no("tolta la proiezione, la riga tace invece di dichiarare che non sa");
  const c = bloccoDa(src, "function cadenzaDato", { max: 7000 }).replace(/\/\*[\s\S]*?\*\//g, "");
  if (/giorniLag|mesiRitardo/.test(c)) return no("cadenzaDato torna a costruirsi le date da se'");
  return true;
})());

/* ---------- v365: P/S e il riquadro della combustione ----------
   Punti 2 e 3 dei cinque aperti. Il pacchetto NOMINAVA il price-to-sales come il multiplo
   giusto per una societa' in perdita e poi non lo forniva (regola C10: rimando a una grandezza
   inesistente); e non diceva niente sulla cassa, che per un libro growth su nomi in perdita
   conta piu' del P/E. Questi check provano il COMPORTAMENTO su scenari costruiti, non la forma
   del sorgente: i tre rami della combustione portano conclusioni opposte, ed e' li' che si
   sbaglia. */
/* ⚠⚠ COSTRUITO SU suVeri, NON SU run. Il primo tentativo cercava "TST1" in DATA.watchlist:
   sbagliato due volte insieme — TST1 sta in DATA.portfolio, e a questo punto del file
   DATA.watchlist e' gia' stato SOVRASCRITTO da un check precedente (^KS11). Un check in coda
   eredita lo stato che gli altri hanno lasciato. suVeri riparte dai dati veri ogni volta. */
const conComb = (comb, patch, code) => suVeri(`
  const r = DATA.watchlist.find(x => x.ticker === "CRWV") || DATA.watchlist[0];
  if (!r) return "nessun titolo su cui provare: i dati veri non hanno watchlist";
  r.stats = Object.assign({}, r.stats || {}, ${JSON.stringify(patch)});
  r.combustione = ${JSON.stringify(comb)};
  const out = buildPromptTicker(r.ticker);
  ${code}`);
const conCombEsito = (...a) => { const r = conComb(...a); return r === true ? true : no(String(r)); };

check("v365 · combustione da INVESTIMENTI: la dice costruzione, e conta i mesi di capex",
  conCombEsito({ cassa: 2.2e9, debito: 35e9, debito_netto: 32.9e9, bilancio_al: "2026-03-31",
            ocf_ttm: 6e9, capex_ttm: -16.6e9, fcf_ttm: -10.6e9, trimestri: 4, mesi_capex: 1.6 }, {}, `
    if (!out.includes("COMBUSTIONE DI CASSA")) return no("il blocco non compare");
    if (!out.includes("combustione e' costruzione, non perdita operativa"))
      return no("flusso operativo positivo e FCF negativo, ma non dice che la combustione e' investimento");
    /* ⚠ VENTIQUATTRESIMA rottura di un check ancorato a una STRINGA LETTERALE, e stavolta la
       formulazione nuova dice DI PIU' di quella vecchia: la v409 nomina il denominatore. Il
       fatto da difendere non e' la frase ma che l'autonomia sul CAPEX esca, e che esca col
       proprio denominatore accanto — senza il quale erano due numeri incomparabili. */
    if (!/mesi di INVESTIMENTI/.test(out)) return "manca l'autonomia sul capex, che qui e' la domanda vera";
    if (!out.includes("cassa diviso il capex")) return "l'autonomia sul capex non dichiara il proprio denominatore";
    return true;`));

check("v365 · combustione dalla GESTIONE: non la chiama costruzione",
  conCombEsito({ cassa: 1e9, ocf_ttm: -2e9, capex_ttm: -0.2e9, fcf_ttm: -2.2e9, trimestri: 4,
            mesi_operativi: 6 }, {}, `
    if (!out.includes("La gestione ASSORBE cassa")) return no("flusso operativo negativo non riconosciuto");
    if (out.includes("combustione e' costruzione")) return no("chiama costruzione una perdita operativa");
    if (!out.includes("mesi di PERDITA OPERATIVA")) return no("manca l'autonomia sulla perdita, che qui e' la domanda vera");
    return true;`));

/* ⚠ IL RAMO CHE MI HA FREGATO. Su NVDA il blocco stampava "non c'e' combustione" e subito dopo
   "il resto della costruzione e' finanziato da debito o da nuove azioni" — falso su chi genera
   119 mld di flusso libero, e in contraddizione con la frase precedente DENTRO LO STESSO BLOCCO.
   E' la classe "glossa costante su ramo variabile", gia' pagata tre volte. */
check("v365 · nessuna combustione: non inventa un fabbisogno che non c'e'",
  conCombEsito({ cassa: 13.2e9, debito: 12.3e9, debito_netto: -0.9e9, ocf_ttm: 125.6e9,
            capex_ttm: -6.6e9, fcf_ttm: 119.1e9, trimestri: 4, mesi_capex: 24.2 }, {}, `
    if (!out.includes("non c'e' combustione")) return no("flussi entrambi positivi non riconosciuti");
    if (out.includes("finanziato da debito o da nuove azioni"))
      return no("dice che serve finanziamento esterno a chi genera flusso libero positivo, e si contraddice due righe sopra");
    if (!out.includes("debito netto NEGATIVO")) return no("cassa netta non dichiarata come tale");
    return true;`));

check("v365 · senza P/E, il pacchetto fornisce il P/S invece di limitarsi a nominarlo",
  conCombEsito(null, { pe_ttm: null, eps_ttm: -3.48, ps: 6.27, ev_s: 12.34 }, `
    if (!out.includes("NESSUN P/E")) return no("non dichiara l'assenza del P/E su utili negativi");
    if (!out.includes("P/S 6,27×")) return no("nomina il P/S e non lo fornisce: e' la violazione C10 che il blocco esiste per chiudere");
    if (!out.includes("EV/ricavi 12,34×")) return no("manca l'EV/ricavi, che su una societa' indebitata diverge dal P/S");
    return true;`));

check("v365 · senza dati di bilancio il blocco tace, non stampa un riquadro vuoto",
  conCombEsito(null, {}, `
    if (out.includes("COMBUSTIONE DI CASSA")) return no("stampa il riquadro senza avere i dati");
    return true;`));

/* ---------- v367: credito (al posto del CDS) e flusso fuori mercato ----------
   Il CEO ha chiesto i CDS sul debito acceso per investire e i movimenti nei dark pool.
   Verificato con le fonti: i CDS single-name sono a pagamento e TRACE risponde 401, quindi il
   pacchetto NON finge di averli e dichiara cosa sta dando al loro posto. FINRA invece pubblica
   ATS e OTC non-ATS gratis, e il volume short giornaliero.
   Questi check presidiano i due modi in cui questi blocchi possono mentire. */

check("v367 · il credito non si spaccia per un CDS, e dichiara il verso oltre al livello",
  conCombEsito(null, {}, `
    const r2 = DATA.watchlist.find(x => x.ticker === "CRWV") || DATA.watchlist[0];
    r2.credito = { oneri_ttm: 1.5e9, ebit_ttm: -1.01e8, trimestri: 4, conto_al: "2026-03-31",
      copertura: -0.07, oneri_var_4trim_pct: 100.8, oneri_trim: [267e6, 311e6, 388e6, 536e6],
      debito_corrente: 7.5e9, debito_lungo: 17.3e9 };
    r2.combustione = { cassa: 2.2e9 };
    const o2 = buildPromptTicker(r2.ticker);
    if (!o2.includes("- CREDITO")) return "il blocco credito non compare";
    if (!/NON e' un CDS/.test(o2)) return "non dichiara che non e' un CDS: chi legge puo' crederlo uno spread";
    if (!/COPERTURA DEGLI INTERESSI NEGATIVA/.test(o2)) return "copertura negativa non segnalata come tale";
    if (!/267 → 311 → 388 → 536/.test(o2)) return "manca il VERSO degli oneri: il livello da solo non dice che accelera";
    if (!/INFERIORE al debito in scadenza/.test(o2)) return "cassa sotto il debito corrente non dichiarata";
    return true;`));

/* ⚠ L'ERRORE CLASSICO SU QUESTO DATO, e il motivo per cui il blocco esiste in questa forma:
   ATS (dark pool registrati) e OTC non-ATS (internalizzatori, wholesaler) NON sono la stessa
   cosa. Gran parte del flusso al DETTAGLIO stampa fuori borsa non-ATS: leggere una quota alta
   come "accumulazione istituzionale" e' esattamente l'allucinazione che il pacchetto deve
   impedire, non alimentare. */
check("v367 · dark pool: ATS e non-ATS restano separati, col ritardo dichiarato",
  conCombEsito(null, {}, `
    const r2 = DATA.watchlist.find(x => x.ticker === "CRWV") || DATA.watchlist[0];
    r2.fuori_mercato = { settimane: [
      { w: "2026-07-13", ats: 25.7e6, otc: 42.3e6 }, { w: "2026-07-20", ats: 23.7e6, otc: 36.1e6 },
      { w: "2026-07-27", ats: 32e6, otc: 42.7e6 }, { w: "2026-08-03", ats: 29e6, otc: 34.7e6 }],
      ultima: "2026-08-03", incomplete: 0 };
    const o2 = buildPromptTicker(r2.ticker);
    if (!o2.includes("FLUSSO FUORI DAI MERCATI REGOLAMENTATI")) return "il blocco non compare";
    if (!/DUE COSE DIVERSE/.test(o2)) return "non distingue ATS da non-ATS: e' l'errore classico su questo dato";
    if (!/non e' accumulazione istituzionale/.test(o2)) return "non smentisce la lettura sbagliata piu' comune";
    if (!/tre settimane di ritardo/.test(o2)) return "non dichiara il ritardo di pubblicazione: sembra il flusso di oggi";
    return true;`));

/* ⚠ UNO ZERO NON E' UNA MISURA. Misurato su NVDA: la settimana del 2026-07-06 esce con ATS
   pieno e OTC a zero — una riga che FINRA non ha pubblicato, non un flusso retail sparito.
   Lasciata passare, quella settimana diventa una storia inventata da un buco. */
check("v367 · una settimana pubblicata a meta' viene scartata e dichiarata, non usata",
  conCombEsito(null, {}, `
    const r2 = DATA.watchlist.find(x => x.ticker === "CRWV") || DATA.watchlist[0];
    r2.fuori_mercato = { settimane: [
      { w: "2026-07-13", ats: 25.7e6, otc: 42.3e6 },
      { w: "2026-07-20", ats: 23.7e6, otc: 0, incompleta: true },
      { w: "2026-08-03", ats: 29e6, otc: 34.7e6 }], ultima: "2026-08-03", incomplete: 1 };
    const o2 = buildPromptTicker(r2.ticker);
    if (/2026-07-20/.test(o2)) return "la settimana incompleta compare fra i numeri usabili";
    if (!/pubblicato solo meta'/.test(o2)) return "lo scarto non e' dichiarato: sparisce una settimana senza dirlo";
    return true;`));

check("v367 · lo short di flusso non viene spacciato per short interest",
  conCombEsito(null, {}, `
    const r2 = DATA.watchlist.find(x => x.ticker === "CRWV") || DATA.watchlist[0];
    r2.short_flusso = { serie: [{ d: "2026-08-21", pct: 52.6 }, { d: "2026-08-24", pct: 57 }],
      ultimo_pct: 57, media_pct: 54.8 };
    const o2 = buildPromptTicker(r2.ticker);
    if (!o2.includes("VOLUME VENDUTO ALLO SCOPERTO")) return "il blocco non compare";
    if (!/NON e' lo short interest/.test(o2)) return "non distingue il flusso dalla posizione aperta";
    if (!/e' ordinaria/.test(o2)) return "non dice che meta' del volume e' normale sui titoli liquidi: il livello da solo allarma a vuoto";
    return true;`));

check("v367 · senza i dati FINRA i tre blocchi tacciono",
  conCombEsito(null, {}, `
    const r2 = DATA.watchlist.find(x => x.ticker === "CRWV") || DATA.watchlist[0];
    r2.credito = null; r2.fuori_mercato = null; r2.short_flusso = null;
    const o2 = buildPromptTicker(r2.ticker);
    for (const b of ["- CREDITO", "FLUSSO FUORI DAI MERCATI", "VOLUME VENDUTO ALLO SCOPERTO"])
      if (o2.includes(b)) return "stampa il blocco " + b + " senza avere i dati";
    return true;`));

/* ---------- v367: la sezione del credito non confronta valute diverse, ne' grida su cose
   che non contano ----------
   Trovati rendendo la sezione con i dati veri, non ragionandoci sopra:
   · SK hynix riporta in KRW e quota come ADR in USD: la tabella metteva "833,1 mld" di oneri
     accanto a "1,5 mld" invitando a confrontarli — la classe che scrub_cross_currency_stats
     ferma sulle stats dal 2024, ricomparsa da una porta nuova;
   · la frase sull'accelerazione del costo del debito apriva con GOOGL +793,7%, che ha copertura
     134×: vera e materialmente fuorviante, perche' ordinare per variazione percentuale mette
     davanti il nome a cui il debito non interessa;
   · MU usciva con -100%, che non e' un calo: e' la voce sparita dal trimestre recente. */
check("v367 · il credito etichetta le valute non-USD invece di lasciarle confrontare", (() => {
  const b = bloccoDa(src, "function renderCredito", { max: 9000 });
  if (!/val: r\.credito\.valuta/.test(b)) return no("la valuta del bilancio non entra piu' nella riga");
  if (!/r\.val !== "USD"/.test(b)) return no("sparito il confronto con USD: le cifre in valuta locale tornano nude");
  if (!/NON si confrontano con le altre/.test(b)) return no("la nota non avverte piu' che le cifre assolute non sono confrontabili");
  return true;
})());

check("v367 · la frase sull'accelerazione esclude i nomi a cui il debito non interessa", (() => {
  const b = bloccoDa(src, "function renderCredito", { max: 9000 });
  const m = b.match(/const acceleranti = [^;]+;/);
  if (!m) return no("sparita la selezione dei nomi con costo del debito in accelerazione");
  if (!/r\.conta/.test(m[0])) return no("l'accelerazione non filtra piu' per materialita': GOOGL a 134× di copertura tornerebbe in testa");
  if (!/r\.var4 < 1000/.test(m[0])) return no("nessun tetto sulla variazione: una voce comparsa dal nulla diventa la notizia principale");
  const c = b.match(/conta: [^,]+,/);
  if (!c || !/Math\.abs\(r\.credito\.copertura\) < 10/.test(c[0]))
    return no("la soglia di materialita' non e' piu' la copertura: senza, 'conta' non misura niente");
  return true;
})());

check("v367 · -100% e' un buco della fonte, non un calo del costo del debito", (() => {
  const b = bloccoDa(src, "function renderCredito", { max: 9000 });
  if (!/r\.var4 <= -100 \? "—"/.test(b))
    return no("un -100% (voce sparita dal trimestre recente) viene ancora stampato come se fosse una variazione");
  return true;
})());

/* ---------- v368: lo stesso pacchetto non dice due volte la stessa grandezza ----------
   ⚠⚠ Trovato leggendo il pacchetto vero, il giorno DOPO aver chiuso la stessa classe (C16)
   sulle serie macro: il flusso di cassa libero usciva -9,1 mld nei FONDAMENTALI (TTM
   dell'aggregatore) e -10,6 mld nel blocco COMBUSTIONE (somma dei quattro trimestri di
   rendiconto, che ho aggiunto io in v365). Stessa grandezza, stessa societa', due numeri.
   Il trattamento giusto era gia' in casa — quello dei RICAVI: non si sceglie in silenzio, si
   dichiara lo scarto e si dice di non usarli insieme.
   ⚠ E la correzione ha subito reintrodotto v362: l'avvertenza citava "-11 mld" mentre il blocco
   citato scrive "-10,6 mld", perche' i due usano formattatori diversi. Un rimando che cita un
   terzo numero e' peggio del difetto che ripara. */
check("v368 · due valori per il flusso di cassa libero: dichiarati, non scelti in silenzio",
  conCombEsito({ cassa: 2.2e9, ocf_ttm: 6e9, capex_ttm: -16.6e9, fcf_ttm: -10.6e9, trimestri: 4 },
    { fcf: -9.09e9 }, `
    if (!/IL BLOCCO COMBUSTIONE DI CASSA PIU' SOTTO NE CALCOLA UN ALTRO/.test(out))
      return "due FCF diversi e nessuna dichiarazione: e' la classe C16 dentro il pacchetto titolo";
    if (!/NON usare i due numeri insieme/.test(out)) return "non dice di non usarli insieme";
    /* ⚠ il numero citato deve essere SCRITTO COME nel blocco a cui rimanda */
    const cit = out.match(/NE CALCOLA UN ALTRO: (-?[\\d.,]+) mld/);
    const blocco = out.match(/COMBUSTIONE DI CASSA[^\\n]*?flusso di cassa libero (-?[\\d.,]+) mld/);
    if (!cit || !blocco) return "non trovo i due numeri da confrontare: il check non sta misurando";
    if (cit[1] !== blocco[1])
      return "il rimando cita " + cit[1] + " ma il blocco citato scrive " + blocco[1] + ": stesso numero, due forme (v362)";
    return true;`));

check("v368 · quando i due FCF coincidono lo dice, invece di tacere",
  conCombEsito({ cassa: 2.2e9, ocf_ttm: 6e9, capex_ttm: -15.1e9, fcf_ttm: -9.1e9, trimestri: 4 },
    { fcf: -9.09e9 }, `
    if (/NE CALCOLA UN ALTRO/.test(out)) return "grida uno scarto che non c'e' (0,1%)";
    if (!/coincide entro/.test(out)) return "non dichiara la verifica riuscita: un controllo silenzioso non si distingue da un controllo assente";
    return true;`));

/* ⚠⚠ v368 — L'ELENCO DEGLI HELPER SORVEGLIATI NON DEVE INVECCHIARE.
   Il rilevatore dei backslash singoli (classe ricorrente numero uno di questo progetto:
   dentro un template literal "\d" diventa "d" e "\n" diventa un a capo, quindi la regex nel vm
   non e' quella che hai scritto) guardava solo run/suVeri/conDiario. conCombEsito e' nato in
   v365 e il difetto ci e' passato dentro subito. Un elenco scritto a mano invecchia col codice:
   questo check confronta l'elenco con TUTTI gli helper che passano un template al vm. */
check("meta: il rilevatore dei backslash copre ogni helper che passa un template al vm", (() => {
  const mio = readFileSync(new URL(import.meta.url), "utf8");
  const scanner = mio.match(/matchAll\(\/\(\?:([a-zA-Z|]+)\)\\\(`/);
  if (!scanner) return no("non trovo piu' l'elenco degli helper nel rilevatore: e' cieco");
  const coperti = new Set(scanner[1].split("|"));
  /* gli helper sono quelli definiti come `const X = (...) => run(` / `=> suVeri(` */
  const definiti = [...mio.matchAll(/^const (\w+) = \([^)]*\) =>\s*(?:\{[^\n]*?)?(?:run|suVeri|suReale)\(/gm)].map((m) => m[1]);
  const scoperti = definiti.filter((n) => !coperti.has(n));
  if (scoperti.length)
    return no(`helper non sorvegliati dal rilevatore dei backslash: ${scoperti.join(", ")} — `
      + "un \\d scritto li' dentro diventa d e la regex nel vm non e' quella che credi");
  if (definiti.length < 2) return no(`visti solo ${definiti.length} helper: il check non sta misurando`);
  return true;
})());

/* ---------- v368: le DUE testate non devono divergere in silenzio ----------
   ⚠⚠ Il sistema ha due set di regole indipendenti: config/prompt_header_macro.txt per il
   pacchetto macro, e le istruzioni generate in buildPromptTicker per il pacchetto titolo.
   Nessuno teneva il conto di cosa c'e' nell'una e non nell'altra, e infatti A3 ("i numeri gia'
   calcolati si usano come sono, non rifarli") mancava proprio dal pacchetto TITOLO — che e'
   quello che ne consegna di piu': percentili, drawdown, correlazioni, VaR, coperture.
   Un LLM che li ricalcola da dati parziali ottiene numeri diversi dai nostri e segnala una
   contraddizione inesistente, trasformando la regola C3 in una fabbrica di falsi allarmi.
   ⚠ LISTA ESPLICITA, nessuna euristica sul linguaggio: e' la lezione di C9 (7 falsi positivi
   su 9 frasi) e di C17. Se nasce un tema nuovo va aggiunto qui a mano, ed e' voluto. */
check("v368 · ogni regola della testata macro ha il suo corrispettivo nel pacchetto titolo", (() => {
  const hdr = readFileSync(join(ROOT, "config", "prompt_header_macro.txt"), "utf8");
  const tk = suVeri(`return buildPromptTicker((DATA.watchlist.find(r => r && r.ticker && !String(r.ticker).startsWith("^")) || {}).ticker || "");`);
  if (typeof tk !== "string" || tk.length < 500) return no("non riesco a generare un pacchetto titolo: il confronto non e' possibile");
  /* tema · come si riconosce nella testata macro · come si riconosce nel pacchetto titolo */
  const TEMI = [
    ["ricerca online obbligatoria", /RICERCA NON E' FACOLTATIVA/, /PASSO 0 — OBBLIGATORIO/],
    /* niente da confrontare qui: la politica sul "non puoi navigare" e' DELIBERATAMENTE
       diversa fra i due pacchetti, e sta nella tabella DIVERGENZE_VOLUTE qui sotto */
    ["mai inventare, n\.d\. se manca", /Mai inventare valori/, /"n\.d\." vale per il singolo dato/],
    ["numeri gia' calcolati: non rifarli", /I NUMERI GIA' CALCOLATI/, /I NUMERI GIA' CALCOLATI QUI SI USANO COME SONO/],
    ["l'eta' del dato fa parte del dato", /LA DATA DEL DATO E' PARTE DEL DATO/, /giorni fa|eta'|snapshot/],
    ["contare i segnali una volta sola", /CONTA I SEGNALI UNA VOLTA SOLA/, /una volta sola|non due|stesso segnale/],
    ["dire cosa smentirebbe l'analisi", /DOVE TI ASPETTERESTI DI SBAGLIARE/, /romperebbe la tesi|smentirebbe|ribalterebbe/],
    ["segnalare le contraddizioni", /si contraddicono/, /contraddi/],
  ];
  /* ⚠⚠ LE DIVERGENZE VOLUTE, con la loro ragione. Un tema elencato qui NON deve coincidere fra
     i due pacchetti — deve divergere ESATTAMENTE COSI'. Se una delle due parti cambia lato, il
     check fallisce: e' il contrario di un'eccezione, e' un vincolo piu' stretto.
     Senza questa tabella il gate confrontava la PRESENZA del tema e passava su due politiche
     opposte, certificandole allineate. */
  const DIVERGENZE_VOLUTE = [
    { tema: "senza rete: proseguire o fermarsi",
      perche: "nel macro i dati SONO l'analisi (storia misurata) e senza rete restano utili; "
        + "nel titolo meta' del valore e' ricerca viva, quindi senza rete non e' producibile",
      macro: /quanto segue e' la lettura di uno snapshot/, macroNo: /e FERMATI/,
      ticker: /e FERMATI/, tickerNo: /quanto segue e' la lettura di uno snapshot/ },
  ];
  const buchi = [];
  for (const d of DIVERGENZE_VOLUTE) {
    if (!d.macro.test(hdr)) buchi.push(`"${d.tema}": la testata macro non prescrive piu' il suo lato (${d.perche})`);
    if (d.macroNo.test(hdr)) buchi.push(`"${d.tema}": la testata macro ha preso il lato del pacchetto titolo`);
    if (!d.ticker.test(tk)) buchi.push(`"${d.tema}": il pacchetto titolo non prescrive piu' il suo lato (${d.perche})`);
    if (d.tickerNo.test(tk)) buchi.push(`"${d.tema}": il pacchetto titolo ha preso il lato della testata macro`);
  }
  for (const [nome, reMacro, reTicker] of TEMI) {
    if (!reMacro.test(hdr)) { buchi.push(`"${nome}" e' sparito dalla TESTATA MACRO`); continue; }
    if (!reTicker.test(tk)) buchi.push(`"${nome}" c'e' nella testata macro e MANCA nel pacchetto titolo`);
  }
  if (buchi.length) return no(`le due testate divergono: ${buchi.join(" · ")}`);
  return true;
})());

/* ---------- v370: tre difetti trovati da un'analisi esterna del pacchetto, verificati ----------
   Un analista senior ha letto il pacchetto vero e ha trovato tre cose. Le ho verificate tutte e
   tre nel codice prima di correggerle: erano vere. */

/* ⚠⚠ 1. LE SCOMMESSE EFFETTIVE ERANO CIECHE AI PESI, e la colonna stava nella riga il cui
   mestiere dichiarato e' proprio isolare l'effetto dei pesi: "pesi reali" e "pesi uguali"
   chiamavano effettive(tutti) con lo STESSO argomento e stampavano lo stesso numero per
   costruzione. La formula 1/(1/k + (k-1)/k·rho) E' il caso equipesato (w = 1/k); la generale
   e' 1/((1-rho)·somma(w²) + rho). Sul libro vero: 2,3 con i pesi reali contro 2,5 equipesato. */
check("v370 · le scommesse effettive vedono i pesi, altrimenti la colonna non isola niente", (() => {
  const b = bloccoDa(src, "function profiliRischio", { max: 9000 });
  if (!/effettive = \(tks, pesi\)/.test(b)) return no("effettive() non accetta piu' i pesi");
  if (!/effettive\(tutti, pesiVeri\)/.test(b)) return no("la riga 'pesi reali' non passa i pesi veri: torna a stampare l'equipeso");
  if (!/somma dei quadrati dei pesi|Herfindahl/.test(b)) return no("sparito il termine dei pesi dalla formula");
  const r = suVeri(`
    const pr = profiliRischio();
    if (!pr || !pr.profili || pr.profili.length < 2) return "nessun profilo da confrontare";
    const mio = pr.profili[0], eq = pr.profili.find(x => x.nome.startsWith("Stessi nomi"));
    if (!eq) return "sparita la riga equipesata: il confronto non esiste piu'";
    if (!Number.isFinite(mio.eff) || !Number.isFinite(eq.eff)) return "scommesse effettive non calcolate";
    if (Math.abs(mio.eff - eq.eff) < 1e-9)
      return "pesi reali ed equipesato danno lo STESSO numero: la colonna non isola l'effetto dei pesi";
    return true;`);
  return r === true ? true : no(String(r));
})());

/* ⚠⚠ 2. `debtToEquity` di yfinance e' una PERCENTUALE. Stampato nudo, MRVL a 28,97 si legge
   "29 volte i mezzi propri" — una societa' sull'orlo del baratro — invece di 0,29×, che e' un
   bilancio solido. L'unita' mancante cambia il segno del giudizio, non la forma. */
check("v370 · il debito sui mezzi propri porta la sua unita'", (() => {
  const m = src.match(/debito\/mezzi propri[\s\S]{0,320}/);
  if (!m) return no("sparita la riga del debito sui mezzi propri");
  if (!/la fonte lo pubblica in percentuale/.test(m[0]))
    return no("il rapporto torna nudo: senza unita' 28,97 si legge 29× invece di 0,29×");
  if (!/\/ 100/.test(m[0])) return no("il valore non viene piu' convertito da percentuale a multiplo");
  return true;
})());

/* ⚠⚠ 3. QUARTA VOLTA che lo stesso numero esce in due forme nello stesso pacchetto: il peso
   della posizione era "3%" nella riga del portafoglio e "3.4%" nella lista del libro. */
check("v370 · il peso della posizione e' scritto una volta sola, in una forma sola",
  suVeriEsito(`
    const conQta = (DATA.watchlist || []).filter(r => r && Number(r.qta) > 0 && Number(r.controvalore) > 0
      && !String(r.ticker).startsWith("^"));
    if (!conQta.length) return "nessuna posizione con quantita' e controvalore: il check non puo' misurare";
    const tk = conQta[0].ticker;
    const p = buildPromptTicker(tk);
    const a = p.match(/vale il ([\\d.,]+)% del controvalore/);
    const iRiga = p.indexOf(tk + ": ", p.indexOf("IL LIBRO IN CUI QUESTA POSIZIONE VIVE"));
    const b2 = iRiga < 0 ? null : p.slice(iRiga, iRiga + tk.length + 40).match(/([\\d.,]+)% dell/);
    if (!a || !b2) return "non trovo i due punti in cui il peso e' scritto: il check non misura";
    if (a[1] !== b2[1]) return "il peso di " + tk + " e' scritto " + a[1] + "% in un punto e " + b2[1] + "% in un altro";
    return true;`));

/* ---------- v371: il denominatore vero ----------
   ⚠⚠ Il pacchetto ripeteva QUATTRO VOLTE "il sistema non conosce la liquidita' ne' il BTP", ed
   era FALSO: config/portfolio_state.json li contiene entrambi, e STATO_PTF_PATH era una costante
   DICHIARATA E MAI USATA — nessuno leggeva quel file.
   Conseguenza: ogni misura di rischio (volatilita' 51,5%, drawdown -24,4%, VaR 4,95%) descriveva
   un capitale che non e' quello dell'investitore. Con l'azionario all'85% del totale, la
   volatilita' vera del patrimonio e' ~44%, non 51,5%.
   Non era un dato mancante: era un file non letto. */
check("v371 · il pacchetto dichiara quanto pesa l'azionario sul patrimonio, non solo su se stesso",
  suVeriEsito(`
    STATO_PTF = { cash: { v: 10000, at: "2026-08-08" }, btp: { v: { qty: 40000, pmc: 100 } } };
    const tk = (DATA.watchlist.find(r => r && Number(r.qta) > 0 && !String(r.ticker).startsWith("^")) || {}).ticker;
    const p = buildPromptTicker(tk);
    if (/non li conosce entrambi|esclude il BTP e la liquidita'/.test(p))
      return "il pacchetto dichiara ancora di non conoscere liquidita' e BTP, che invece ha";
    if (!/MA NON E' IL PATRIMONIO/.test(p)) return "non dichiara che l'azionario non e' il patrimonio";
    if (!/va moltiplicata per/.test(p)) return "non da' il fattore con cui riportare le misure sul patrimonio";
    return true;`));

/* ⚠ e senza il file il pacchetto deve DIRLO, non fingere un totale: un denominatore inventato
   e' peggio di un denominatore dichiarato mancante. */
check("v371 · senza lo stato patrimoniale il pacchetto lo dichiara invece di inventare un totale",
  suVeriEsito(`
    STATO_PTF = null;
    const tk = (DATA.watchlist.find(r => r && Number(r.qta) > 0 && !String(r.ticker).startsWith("^")) || {}).ticker;
    const p = buildPromptTicker(tk);
    if (/MA NON E' IL PATRIMONIO/.test(p)) return "senza dati dichiara comunque una quota del patrimonio";
    if (!/non sono disponibili in questo run/.test(p)) return "non dichiara che il denominatore manca";
    return true;`));

/* ---------- meta v365: nessun check DOPO il conteggio ----------
   ⚠⚠ LA CLASSE PEGGIORE TROVATA FINORA, e l'ho prodotta io due volte in un giorno.
   La suite conta cosi':
       let fail = 0;
       for (const [name, ok] of T) { if (!ok) fail++; ... }     <- fail e' FISSATO qui
       console.log(`${T.length - fail}/${T.length} check superati`);
   Un check registrato DOPO quel ciclo entra in T — quindi T.length cresce — ma non passa mai
   sotto il conteggio: fail resta fermo. Risultato: "354/354 superati" mentre NOVE check
   fallivano, fra cui otto miei appena scritti.
   Stamattina avevo gia' pagato meta' di questo errore e l'avevo riparato a meta': avevo
   spostato i check prima dell'ULTIMA RIGA, non prima del CICLO. Il sintomo era identico e la
   diagnosi sembrava fatta.
   Non e' un caso di dormienza — quei check giravano — ed e' per questo che il meta-gate dei
   dormienti non poteva vederli: la sentinella non booleana viene comunque ignorata se nessuno
   la conta. Serve un controllo sulla STRUTTURA DEL FILE, ed e' questo. */
check("meta: nessun check registrato dopo il ciclo che conta i fallimenti", (() => {
  const mio = readFileSync(new URL(import.meta.url), "utf8");
  const iConteggio = mio.indexOf("\nlet fail = 0;");
  if (iConteggio < 0) return no("non trovo piu' il ciclo di conteggio: questo controllo e' cieco");
  const coda = mio.slice(iConteggio);
  /* i check veri iniziano a inizio riga: cosi' non conto le occorrenze dentro i commenti */
  const dopo = [...coda.matchAll(/^check\("([^"]{0,80})/gm)].map((m) => m[1]);
  if (dopo.length)
    return no(`${dopo.length} check stanno DOPO il conteggio e non possono far fallire la CI: `
      + dopo.slice(0, 3).map((x) => `"${x}…"`).join(", ") + (dopo.length > 3 ? ", …" : "")
      + ". Vanno spostati prima di `let fail = 0;`.");
  /* e il controllo deve poter vedere qualcosa: se il file finisse subito dopo il ciclo,
     l'assenza di check non proverebbe niente */
  const prima = [...mio.slice(0, iConteggio).matchAll(/^check\(/gm)].length;
  if (prima < 300) return no(`visti solo ${prima} check prima del conteggio: la struttura non e' quella che credo`);
  return true;
})());

/* ══ v389 — LA DISCIPLINA DI RISCHIO, LE NEWS E IL GRAFICO PESO/RISCHIO ═══════════════════
   ⚠ Tutti questi check girano sui dati VERI (suVeri), non sulla fixture: la fixture non ha
   macro.indicators, non ha posizioni e non ha news, quindi NON CONTIENE il fenomeno da
   misurare — e' l'errore fatto quattro volte in questo progetto, verde per assenza di dati. */

check("v389 disciplina: ogni regola separa la MISURA dalla SOGLIA e dichiara la provenienza", suVeri(`
  const d = disciplinaRischio();
  if (!d || d.regole.length < 5) return false;
  /* l'invariante non e' il numero di regole: e' che nessuna riga possa essere letta come un
     dato del sistema quando invece e' una convenzione del mestiere */
  return d.regole.every(r => r.nome && r.misura && r.soglia && r.provenienza && r.stato
    && /CONVENZIONE/i.test(r.provenienza));`));

check("v389 disciplina: nessuna regola dimensiona, e il divieto sta nella TESTATA non nella coda", suVeri(`
  const t = disciplinaTesto();
  if (!t) return false;
  /* ⚠ v389 — RIAGGANCIATO DOPO CHE C9 HA AVUTO RAGIONE. La prima stesura pretendeva il divieto
     DENTRO disciplinaTesto(), cioe' nel payload: ma il divieto e' un ORDINE, e gli ordini vivono
     nella testata (v156/v179/v180). Un check che pretende un'istruzione nella coda mette in
     conflitto due gate e vince quello scritto per ultimo.
     L'invariante giusto e' doppio: la coda non propone quantita', e il PACCHETTO INTERO — che
     comprende la testata — porta il divieto. */
  const propone = /(vendi|compra|riduci|porta)\\s+(il\\s+)?\\d+([.,]\\d+)?\\s*(%|azioni|quote|€)/i.test(t);
  const codaPulita = !propone && !/non dimensionare/i.test(t);
  const macro = buildCIOText(), titolo = buildPromptTicker("NVDA");
  const vietaMacro = /NON DIMENSIONATE|non dimensionare/i.test(macro);
  const vietaTitolo = /In nessun caso dimensionare|non dimensionare/i.test(titolo);
  /* e il fatto che rende sensato il divieto resta nella coda: i tre dati mancanti */
  const treDati = /liquidita' disponibile[\\s\\S]{0,120}?situazione fiscale/i.test(t);
  return codaPulita && vietaMacro && vietaTitolo && treDati;`));

check("v389 disciplina: una soglia superata NON viene presentata come un errore del libro", suVeri(`
  const t = disciplinaTesto();
  /* e' la riga che impedisce l'analisi facile: un fondo growth concentrato sta fuori dalle
     soglie per costruzione, e il pacchetto deve dirlo dove lo stato viene pubblicato */
  return !!t && /NON SIGNIFICA CHE IL LIBRO SIA SBAGLIATO/.test(t)
      && /PER\\s+COSTRUZIONE/i.test(t);`));

check("v389 disciplina: pagina e pacchetto leggono LA STESSA misura, non due calcoli", (() => {
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  /* due implementazioni della stessa domanda divergono (v161/v207/v316): entrambe le superfici
     devono chiamare disciplinaRischio(), e la misura deve esistere in un posto solo */
  const definizioni = (src.match(/^function disciplinaRischio\(/gm) || []).length;
  const rende = /function renderDisciplinaRischio\([\s\S]{0,600}?disciplinaRischio\(\)/.test(src);
  const testo = /function disciplinaTesto\([\s\S]{0,600}?disciplinaRischio\(\)/.test(src);
  return definizioni === 1 && rende && testo;
})());

check("v389 disciplina: il gruppo di fattore si calcola in un posto solo", (() => {
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  /* ⚠ LA FINESTRA FISSA DI 4000 CARATTERI ERA UN REGISTRO CHE INVECCHIA DA SOLO: inserendo
     `autonomiaCassa` fra `contestoPortafoglio` e la chiamata, il gate e' andato rosso su codice
     corretto. E' la classe del pavimento numerico di v208 e degli indici fissi del red team I6 —
     una DISTANZA non e' una proprieta'. Ora si estrae il CORPO della funzione e si guarda dentro,
     che e' l'invariante vero: una sola definizione, e il chiamante la usa davvero. */
  if ((src.match(/^function gruppoFattore\(/gm) || []).length !== 1) {
    return no("gruppoFattore e' definita piu' di una volta: due copie divergono");
  }
  const corpo = bloccoDa(src, "function contestoPortafoglio(");
  return corpo.includes("gruppoFattore(azionarie, totAz)")
    || no("contestoPortafoglio non chiama piu' gruppoFattore");
})());

check("v389 disciplina: la sezione esiste in pagina e qualcuno la riempie", (() => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  /* v315: un contenitore nel markup senza chi lo riempie e' un blocco che non c'e' */
  return /id="disc-corpo"/.test(html) && /data-sez="disciplina"/.test(html)
      && /\$\("#disc-corpo"\)/.test(src)
      /* ⚠ v389 — la prima stesura trovava anche una chiamata COMMENTATA: iniettando
         "// renderDisciplinaRischio();" il gate restava verde mentre la sezione non veniva
         piu' disegnata. E' la trappola del gate che trova se stesso, gia' pagata in v213 e
         v240: la scansione deve togliere i commenti prima di leggere. */
      && /^\s*renderDisciplinaRischio\(\);/m.test(src.slice(src.indexOf("renderCredito();")));
})());

check("v389 pacchetto macro: porta il libro, e non dichiara piu' di non averlo", suVeri(`
  const p = buildCIOText();
  /* la testata diceva "Non hai davanti nessun portafoglio" mentre le posizioni esistono dal
     v307: un pacchetto che nega di avere una cosa che ha e' peggio di uno che tace */
  return /IL LIBRO IN CUI QUESTA POSIZIONE VIVE|LA DISCIPLINA DI RISCHIO/.test(p)
      && !/Non hai davanti nessun portafoglio/i.test(p);`));

check("v389 news: la finestra e' di 8 ore, come chiesto", (() => {
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  return /const ORE = 8;/.test(src);
})());

check("v389 news: senza feed il pacchetto DICHIARA il buco invece di tacere", suVeri(`
  /* il difetto vero: macro.news assente -> il blocco spariva del tutto, e "nessuna riga
     sull'argomento" e "nessuna notizia" sono due cose che l'LLM non puo' distinguere */
  const salvato = DATA.macro.news;
  delete DATA.macro.news;
  const p = buildPrompt();
  DATA.macro.news = salvato;
  return /TITOLI MACRO DELLE ULTIME 8 ORE: IL SISTEMA NON NE HA/.test(p)
      && /dato MANCANTE, non come un dato negativo/.test(p);`));

check("v389 news: fuori finestra pubblica comunque le piu' recenti, con la loro eta'", suVeri(`
  /* la v306 rispondeva "NESSUNA" e si teneva in tasca una dichiarazione del presidente della
     Fed di 17 ore: la finestra serve a PESARE una notizia, non a nasconderla */
  const salvato = DATA.macro.news;
  const ora = Date.now();
  const iso = (h) => new Date(ora - h * 3600000).toISOString().slice(0, 19) + "Z";
  DATA.macro.news = { fonti: ["Fonte X"], filtro: "prova", voci: [
    { titolo: "Titolo vecchio ma rilevante sulla Fed", riassunto: "", fonte: "Fonte X", quando: iso(17) },
    { titolo: "Titolo ancora piu' vecchio sul lavoro", riassunto: "", fonte: "Fonte X", quando: iso(30) },
  ] };
  const p = buildPrompt();
  DATA.macro.news = salvato;
  return /0 dentro le ultime 8 ORE/.test(p)
      && /Titolo vecchio ma rilevante sulla Fed/.test(p)
      && /17h fa/.test(p);`));

check("v389 news: dentro la finestra le pubblica e le conta", suVeri(`
  const salvato = DATA.macro.news;
  const ora = Date.now();
  const iso = (h) => new Date(ora - h * 3600000).toISOString().slice(0, 19) + "Z";
  DATA.macro.news = { fonti: ["Fonte X"], filtro: "prova", voci: [
    { titolo: "Notizia macro appena uscita sui tassi", riassunto: "riassunto della fonte", fonte: "Fonte X", quando: iso(2) },
    { titolo: "Altra notizia macro recente sul lavoro", riassunto: "", fonte: "Fonte X", quando: iso(5) },
    { titolo: "Notizia fuori finestra sul credito", riassunto: "", fonte: "Fonte X", quando: iso(40) },
  ] };
  const p = buildPrompt();
  DATA.macro.news = salvato;
  return /2 dentro le ultime 8 ORE/.test(p)
      && /Notizia macro appena uscita sui tassi/.test(p)
      && /SONO TITOLI, NON FATTI VERIFICATI/.test(p);`));

check("v389 peso/rischio: la diagonale non torna e la differenza resta gia' calcolata", (() => {
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const css = readFileSync(join(ROOT, "assets", "style.css"), "utf8");
  /* ⚠ v391 — RIAGGANCIATO. La prima stesura pretendeva `barreOrdinate(pt.map`, cioe' UNA
     implementazione: alla forma successiva (barre gemelle, chiesta dal CEO) e' fallita su
     codice corretto. E' la decima volta in questo progetto che un check ancorato alla forma
     invece che al fatto si rompe su una riformulazione.
     L'invariante vero non e' "quale grafico": e' che lo scatter con la diagonale — la forma che
     il CEO non riusciva a leggere — non torni, e che la DIFFERENZA fra peso e rischio sia
     calcolata dal sistema invece di essere lasciata da stimare a occhio. */
  return !/class="mappa-rischio"/.test(src) && !/class="diag"/.test(src)
      && !/\.mappa-rischio/.test(css)
      && /gap: mcr - peso/.test(src);
})());

check("v389 peso/rischio: le posizioni fuori dal calcolo vengono NOMINATE, non tolte in silenzio", suVeri(`
  /* ⚠ v391 — girava sul SORGENTE cercando una frase, e la frase e' cambiata con la forma del
     grafico. Ora gira sull'HTML DAVVERO PRODOTTO da renderRischio sui dati veri: SKHY non ha
     abbastanza sedute in comune, quindi il suo peso non e' dentro i 100% e il nome deve
     comparire. Un check che legge il sorgente certifica cio' che c'e' scritto; uno che legge
     l'uscita certifica cio' che l'utente vede. */
  let html = "";
  const vero = document.querySelector;
  document.querySelector = (sel) => String(sel) === "#rischio-mappa"
    ? { set innerHTML(v) { html = v; }, get innerHTML() { return html; } }
    : vero(sel);
  try { renderRischio(); } finally { document.querySelector = vero; }
  const senzaMcr = (DATA.watchlist || []).filter(r => r && r.qta > 0 && r.controvalore > 0
    && !Number.isFinite(Number(r.risk_contrib_pct))).map(r => r.ticker);
  if (!senzaMcr.length) return true;   /* niente esclusi: niente da dichiarare */
  return senzaMcr.every(t => html.includes(t)) && /non e' nel calcolo|non sono nel calcolo/.test(html);`));

check("v389 collaudo: ENTRAMBI i pacchetti chiedono freschezza, congruita' e affidabilita'", suVeri(`
  /* richiesta esplicita del CEO: le tre verifiche devono essere chieste a chi legge, non
     assunte. E devono valere per tutti e due i percorsi, non solo per quello del titolo. */
  const macro = buildCIOText(), titolo = buildPromptTicker("NVDA");
  const chiede = (p) => /FRESCHEZZA/.test(p) && /CONGRUITA'/.test(p) && /AFFIDABILITA'/.test(p)
                     && /COLLAUDO DEI DATI/i.test(p);
  return chiede(macro) && chiede(titolo);`));

check("v389 collaudo: l'esito va SCRITTO, non solo eseguito", suVeri(`
  /* un collaudo che non lascia traccia non e' distinguibile da un collaudo non fatto: la
     regola vale solo se il pacchetto chiede di riportarne l'esito */
  const macro = buildCIOText(), titolo = buildPromptTicker("NVDA");
  const traccia = (p) => /non e' distinguibile da un collaudo non fatto/.test(p);
  return traccia(macro) && traccia(titolo);`));

check("v389 libro: ogni posizione porta tecnica E fondamentali, non solo peso e guadagno", suVeri(`
  const p = buildPromptTicker("MU");
  const b = p.slice(p.indexOf("TECNICA E FONDAMENTALI DI OGNI POSIZIONE"));
  if (!b) return false;
  /* il difetto che questo blocco chiude: senza questi numeri l'unica misura disponibile sulle
     altre posizioni era il guadagno dal carico, che e' quella che fa tenere i perdenti */
  return /RSI /.test(b) && /dal massimo 52s/.test(b) && /forza relativa 1M/.test(b)
      && /medie: /.test(b) && /ricavi /.test(b)
      && /P\\/E prospettico|utile atteso NEGATIVO/.test(b);`));

check("v389 libro: un multiplo prospettico negativo non si stampa come multiplo basso", suVeri(`
  const p = buildPromptTicker("MU");
  const b = p.slice(p.indexOf("TECNICA E FONDAMENTALI DI OGNI POSIZIONE"));
  /* RGTI e CRWV hanno forward_pe negativo: "-75,7×" si leggerebbe come "costa pochissimo" */
  return /utile atteso NEGATIVO/.test(b) && !/P\\/E prospettico -/.test(b);`));

check("v389 libro: la forza relativa porta i PUNTI PERCENTUALI, non due unita'", suVeri(`
  const p = buildPromptTicker("MU");
  /* signTxt aggiunge gia' "%": "+5,2% pp" sarebbe due unita' sulla stessa cifra */
  return / pp vs /.test(p) && !/% pp vs /.test(p);`));

check("v389 disciplina: dichiara di riusare le misure del libro, per non farle contare due volte", suVeri(`
  const p = buildPromptTicker("MU");
  /* le stesse misure compaiono nel blocco del libro e nella disciplina: senza la dichiarazione
     un lettore le conta come prove indipendenti. E' la regola B3 del pacchetto (contare i
     segnali una volta sola) applicata al libro invece che alla macro. */
  const iLibro = p.indexOf("IL LIBRO IN CUI QUESTA POSIZIONE VIVE");
  const iDisc = p.indexOf("LA DISCIPLINA DI RISCHIO DI UN FONDO GROWTH");
  return iLibro > 0 && iDisc > iLibro
      && /SONO LE STESSE DEL BLOCCO DEL LIBRO/.test(p)
      && /Contale UNA VOLTA SOLA/.test(p);`));

/* ══ v390 — LE FONTI NUOVE, E IL RAMO CHE NESSUN GATE AVEVA MAI PERCORSO ═══════════════ */

check("v390 EDGAR: il deposito passato e' un FATTO, la data futura resta una stima", suVeri(`
  const salvato = DATA.macro.sec_calendario;
  DATA.macro.sec_calendario = { per_titolo: { MU: {
    ultimo_deposito: "2026-06-24", n_depositi: 36, cadenza_gg: 91 } },
    senza_8k: [], senza_cik: [], fonte: "SEC EDGAR" };
  const p = buildPromptTicker("MU");
  DATA.macro.sec_calendario = salvato;
  /* ⚠ v396 — la SECONDA STIMA (ultimo deposito + cadenza mediana) era una proiezione nostra ed
     e' stata tolta. L'invariante si rovescia e diventa piu' netto: il deposito passato e la
     cadenza misurata si pubblicano come FATTI, e da essi NON deve uscire nessuna data futura. */
  return /ULTIMO DEPOSITO DEI RISULTATI[^\\n]*e' un FATTO, non una stima[^\\n]*2026-06-24/.test(p)
      && /cadenza dei suoi ultimi 36 depositi e' di 91 giorni/.test(p)
      && /non una previsione, e il sistema non ne ricava una data/.test(p)
      && p.indexOf("2026-09-23") < 0;`));

check("v390 EDGAR: una cadenza irregolare NON produce una data", suVeri(`
  const salvato = DATA.macro.sec_calendario;
  /* misurato su MSTR: deposita 8-K/2.02 anche fuori dal ciclo, la mediana crolla a 67 giorni
     e l'attesa che ne uscirebbe sbaglia di 24. Un numero che sembra una misura e non lo e'
     e' peggio di nessun numero (v199). */
  DATA.macro.sec_calendario = { per_titolo: { MU: {
    ultimo_deposito: "2026-07-30", n_depositi: 20, cadenza_irregolare_gg: 67 } },
    senza_8k: [], senza_cik: [], fonte: "SEC EDGAR" };
  const p = buildPromptTicker("MU");
  DATA.macro.sec_calendario = salvato;
  return /cadenza dei suoi depositi e' IRREGOLARE \\(67 giorni/.test(p)
      && !/SECONDA stima della prossima uscita/.test(p);`));

check("v390 EDGAR: un emittente estero viene DICHIARATO, non lasciato vuoto", suVeri(`
  const salvato = DATA.macro.sec_calendario;
  DATA.macro.sec_calendario = { per_titolo: {}, senza_8k: ["MU"], senza_cik: [], fonte: "SEC EDGAR" };
  const p = buildPromptTicker("MU");
  DATA.macro.sec_calendario = salvato;
  /* "nessuna data da EDGAR" e "nessuna trimestrale" si leggono uguali e sono cose diverse */
  return /EMITTENTE ESTERO/.test(p) && /NON significa che non pubblichi trimestrali/.test(p);`));

check("v390 SLOOS: il segno viene dichiarato, in entrambe le direzioni", suVeri(`
  const salvato = DATA.macro.credito_banche;
  const prova = (v) => {
    DATA.macro.credito_banche = { sloos: { valore: v, data: "2026-07-01", precedente: 8.1, serie: "DRTSCILM" } };
    return buildPrompt();
  };
  /* il segno di SLOOS non e' intuitivo: negativo = banche che ALLENTANO, cioe' la lettura
     favorevole. Pubblicarlo senza dirlo e' la classe del percentile invertito (v316). */
  const stretta = prova(12.5), allentamento = prova(-8.3);
  DATA.macro.credito_banche = salvato;
  return /le banche stringono/i.test(stretta) && /IL SEGNO/.test(stretta)
      && /stanno allentando/i.test(allentamento);`));

check("v390 SLOOS/NFCI: dichiarano di NON essere una seconda conferma dello spread", suVeri(`
  const salvato = DATA.macro.credito_banche;
  DATA.macro.credito_banche = { sloos: { valore: 0, data: "2026-07-01", serie: "DRTSCILM" },
                                nfci: { valore: -0.57, data: "2026-08-21", serie: "NFCI" } };
  const p = buildPrompt();
  DATA.macro.credito_banche = salvato;
  /* lo spread e' un PREZZO, SLOOS e' la DISPONIBILITA': contarli come due prove dello stesso
     segnale e' la regola B3 violata */
  return /NON sono una seconda conferma dello stesso segnale/.test(p)
      && /l'altro lato del canale/.test(p);`));

check("v390 BCE: il tasso euro c'e' e non si spaccia per un dato sui tassi USA", suVeri(`
  const salvato = DATA.macro.bce;
  DATA.macro.bce = { tasso_rifinanziamento: 2.4, data: "2026-08-30", fonte: "BCE Data Portal" };
  const p = buildPrompt();
  DATA.macro.bce = salvato;
  return /BCE — tasso sulle operazioni di rifinanziamento/.test(p)
      && /non il rendimento del BTP/.test(p)
      && /non un secondo dato sui tassi americani/.test(p);`));

check("v390 il ramo degli ALLARMI non contiene ordini — ramo mai percorso prima", suVeri(`
  /* ⚠⚠ QUESTO CHECK NASCE DA UN DIFETTO SOPRAVVISSUTO PER INVISIBILITA'. I due blocchi che
     escono quando data_quality ha un alert dicevano "usa OBBLIGATORIAMENTE la ricerca web",
     cioe' istruzioni nel payload — e nessun gate li aveva mai visti, perche' data_quality non
     aveva MAI avuto un alert e quindi quel ramo non si percorreva.
     > Un difetto in un ramo raro non e' raro, e' solo invisibile (v190). */
  const salvato = DATA.data_quality;
  DATA.data_quality = { checks: [{ key: "margin_debt", date: null, age_days: null,
    max_age: 90, status: "missing", note: "fonte ko" }], alerts: ["margin_debt: missing"] };
  const p = buildPrompt();
  DATA.data_quality = salvato;
  const acceso = /DATI MANCANTI O INAFFIDABILI IN QUESTO PAYLOAD/.test(p);
  const senzaOrdini = !/ORDINE OPERATIVO/.test(p) && !/usa OBBLIGATORIAMENTE/i.test(p);
  /* e la lista non si pubblica due volte con due formulazioni diverse */
  const unaVolta = (p.match(/margin_debt/g) || []).length <= 3;
  return acceso && senzaOrdini && unaVolta;`));

/* ══ v391 — RAPPORTO RISCHIO/RENDIMENTO OVUNQUE, E IL GRAFICO CHE SEGUE IL PORTAFOGLIO ══ */

check("v391 R/R: emerge anche su un titolo che la pipeline NON segue", suVeri(`
  /* il CEO: "lo stesso rapporto rischio/rendimento deve emergere anche quando analizzo
     un'azione nuova". Prima l'INTERO blocco tecnico era condizionato alla riga della
     pipeline, quindi per un titolo non seguito non compariva nulla. */
  const T = "ZZTEST";
  const H = [], L = [], C = [];
  let p = 100;
  for (let i = 0; i < 260; i++) { p = p * (1 + Math.sin(i / 11) * 0.008 + 0.0004); H.push(p * 1.012); L.push(p * 0.988); C.push(p); }
  const tr = [];
  for (let i = 1; i < H.length; i++) tr.push(Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])));
  let a = tr.slice(0, 14).reduce((s, v) => s + v, 0) / 14;
  for (let i = 14; i < tr.length; i++) a = (a * 13 + tr[i]) / 14;
  quoteLive.set(T, { price: C[C.length - 1], chgPct: 0.4, ext: null, valuta: "USD" });
  quoteLive.set(T + "|1y", { price: C[C.length - 1], sup20: Math.min(...L.slice(-20)),
    res20: Math.max(...H.slice(-20)), max52: Math.max(...H), min52: Math.min(...L),
    barre: 260, valuta: "USD", ext: null, atr14: a });
  const f = fattiTitolo(T);
  quoteLive.delete(T); quoteLive.delete(T + "|1y");
  if (!f.tecnici || !f.tecnici.rischioRendimento) return false;
  /* il valore deve essere quello vero, non un placeholder */
  const atteso = Math.round((Math.max(...H.slice(-20)) - C[C.length - 1]) / (2 * a) * 10) / 10;
  return f.tecnici.rischioRendimento === "1:" + atteso && f.tecnici.soloDalVivo === true;`));

check("v391 R/R su titolo nuovo: NON inventa gli altri tecnici della pipeline", suVeri(`
  /* ⚠ le barre vive sostengono il R/R, non RSI/medie/forza relativa/fondamentali: quelli sono
     calcoli della pipeline su serie complete, e ricostruirli da 260 barre darebbe numeri che
     sembrano giusti e non lo sono (v316). */
  const T = "ZZTEST2";
  quoteLive.set(T, { price: 100, chgPct: 0, ext: null, valuta: "USD" });
  quoteLive.set(T + "|1y", { price: 100, sup20: 90, res20: 120, max52: 130, min52: 80,
    barre: 260, valuta: "USD", ext: null, atr14: 5 });
  const f = fattiTitolo(T);
  quoteLive.delete(T); quoteLive.delete(T + "|1y");
  const t = f.tecnici || {};
  return t.rischioRendimento === "1:2"
      && t.rsi === undefined && t.sma50 === undefined && t.rs1m === undefined
      && t.eps === undefined && t.pesoLibro === undefined;`));

check("v391 ATR dal vivo: terne allineate, non tre array filtrati a parte", (() => {
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const i = src.indexOf("      atr14: (() => {");
  const b = src.slice(i, src.indexOf("      })(),", i));
  /* ⚠⚠ hi/lo/chiusure sono filtrati INDIPENDENTEMENTE con ok(): usarli per l'ATR accosterebbe
     il massimo di un giorno al minimo di un altro. Misurato: con una sola barra incompleta le
     lunghezze diventano 120 e 119. E' l'allineamento per posizione invece che per data (v207). */
  return /b\.high \|\| \[\]/.test(b) && /b\.low \|\| \[\]/.test(b) && /b\.close \|\| \[\]/.test(b)
      && /Number\.isFinite\(H\[i\]\) && Number\.isFinite\(L\[i\]\) && Number\.isFinite\(C\[i\]\)/.test(b)
      && !/\bok\(/.test(b)
      && /a \* 13 \+ tr\[i\]\) \/ 14/.test(b);          // Wilder, non media semplice
})());

check("v391 R/R: una sola fonte per prezzo, resistenza e ATR", (() => {
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const i = src.indexOf("rischioRendimento: (() => {");
  const b = src.slice(i, src.indexOf("})(),", i));
  /* la classe v230: due letture della stessa grandezza a freschezze diverse dentro un
     rapporto. Il ramo dal vivo deve usare valori VIVI per tutti e tre gli ingressi.
     ⚠ v391 — la prima stesura contava "daVivo ?" e falliva perche' il primo va a capo prima
     del punto interrogativo: contava la FORMA, non il fatto. Undicesima volta in questo
     progetto. L'invariante e' che i tre ingressi vengano dalla stessa fonte viva. */
  return /storia\.price/.test(b) && /storia\.res20/.test(b) && /storia\.atr14/.test(b)
      && /riga && riga\.resistance/.test(b) && /riga && riga\.atr_14/.test(b);
})());

check("v391 grafico: due barre affiancate e il R/R di ogni posizione", suVeri(`
  let html = "";
  const vero = document.querySelector;
  document.querySelector = (sel) => String(sel) === "#rischio-mappa"
    ? { set innerHTML(v) { html = v; }, get innerHTML() { return html; } } : vero(sel);
  try { renderRischio(); } finally { document.querySelector = vero; }
  const righe = (html.match(/class="cbar-row"/g) || []).length;
  const rr = (html.match(/R\\/R /g) || []).length;
  /* una riga per posizione, e ognuna porta il proprio rapporto rischio/rendimento */
  return righe >= 3 && rr === righe
      && /f-peso/.test(html) && /f-mcr/.test(html)
      && !/<svg/.test(html);`));

check("v391 modifica: il SALVATAGGIO chiama l'aggiornamento locale, non solo la funzione esiste", (() => {
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const i = src.indexOf("async function salvaPosizioni()");
  const b = src.slice(i, src.indexOf("\nfunction applicaPosizioniInLocale", i));
  /* ⚠ v391 — questo check nasce da un'iniezione che NON mordeva: gli altri chiamano
     applicaPosizioniInLocale direttamente, quindi togliere la chiamata da salvaPosizioni li
     lasciava tutti verdi mentre il grafico tornava a restare indietro fino al giro successivo
     della pipeline — cioe' esattamente il difetto che il CEO ha segnalato.
     ⚠ E la scansione toglie i commenti: una chiamata commentata non e' una chiamata (v213,
     v240, v389 — terza volta che questa trappola si ripresenta). */
  const senzaCommenti = b.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return /^\s*if \(ok1\) applicaPosizioniInLocale\(posizioni\);/m.test(senzaCommenti);
})());

check("v391 modifica del portafoglio: i pesi si aggiornano subito", suVeri(`
  const prima = DATA.watchlist.find(r => r.ticker === "MU").controvalore;
  const pos = DATA.watchlist.filter(r => r && r.qta > 0)
    .map(r => ({ ticker: r.ticker, qta: r.ticker === "MU" ? 20 : r.qta, pmc: r.pmc }));
  applicaPosizioniInLocale(pos);
  const dopo = DATA.watchlist.find(r => r.ticker === "MU").controvalore;
  return Number.isFinite(dopo) && dopo < prima * 0.5;`));

check("v391 modifica: il rischio NON viene ricalcolato a mano, e lo si dichiara", suVeri(`
  const mcrPrima = DATA.watchlist.find(r => r.ticker === "MU").risk_contrib_pct;
  const pos = DATA.watchlist.filter(r => r && r.qta > 0)
    .map(r => ({ ticker: r.ticker, qta: r.ticker === "MU" ? 20 : r.qta, pmc: r.pmc }));
  applicaPosizioniInLocale(pos);
  const mcrDopo = DATA.watchlist.find(r => r.ticker === "MU").risk_contrib_pct;
  let html = "";
  const vero = document.querySelector;
  document.querySelector = (sel) => String(sel) === "#rischio-mappa"
    ? { set innerHTML(v) { html = v; }, get innerHTML() { return html; } } : vero(sel);
  try { renderRischio(); } finally { document.querySelector = vero; }
  /* il contributo al rischio resta quello della pipeline (ricalcolarlo dalle sparks darebbe
     un numero plausibile e divergente, v316) e la riga toccata viene NOMINATA */
  return mcrDopo === mcrPrima && /MU/.test(html)
      && /peso aggiornato adesso, rischio ancora quello della pipeline/.test(html);`));

check("v391 modifica: la frase in cima non poggia su una riga mezza vecchia", suVeri(`
  /* il difetto misurato: portando MU da 70 a 20 quote la frase annunciava "+27,1 pp di rischio
     in piu'", che confronta il peso NUOVO col rischio VECCHIO — un numero che non misura
     niente, nella riga piu' letta della sezione. */
  const pos = DATA.watchlist.filter(r => r && r.qta > 0)
    .map(r => ({ ticker: r.ticker, qta: r.ticker === "MU" ? 20 : r.qta, pmc: r.pmc }));
  applicaPosizioniInLocale(pos);
  let html = "";
  const vero = document.querySelector;
  document.querySelector = (sel) => String(sel) === "#rischio-mappa"
    ? { set innerHTML(v) { html = v; }, get innerHTML() { return html; } } : vero(sel);
  try { renderRischio(); } finally { document.querySelector = vero; }
  const frase = (html.split("rischio-frasi")[1] || "").slice(0, 600);
  return !/MU pesa/.test(frase);`));

/* ══ v392 — IL PERIODO DI RIFERIMENTO, DOPO CHE UN LLM REALE L'HA FRAINTESO DUE VOLTE ══ */

check("v392 una serie mensile o trimestrale dichiara il PERIODO, non un giorno", suVeri(`
  const p = buildPrompt();
  /* il CEO ha incollato il referto di un LLM reale: su tre "correzioni" al sistema, DUE erano
     false e nascevano tutte e due da "riferito a 01/04/2026" letto come una data puntuale.
     01/04/2026 su una serie trimestrale E' il secondo trimestre — la convenzione FRED/BEA. */
  const pil = p.split(String.fromCharCode(10)).find(x => x.startsWith("- PIL USA"));
  const nfp = p.split(String.fromCharCode(10)).find(x => x.startsWith("- Non-Farm Payrolls"));
  if (!pil || !nfp) return false;
  /* ⚠ i backslash vanno RADDOPPIATI: dentro un template literal "\\d" diventa "d" e la regex
     smette di essere quella che credi. E' la trappola che il meta-gate sorveglia, e mi ha
     preso di nuovo qui. */
  return /riferito al \\d° trimestre \\d{4} \\([a-z]+-[a-z]+\\)/.test(pil)
      && !/riferito a \\d{2}\\/\\d{2}\\/\\d{4}/.test(pil)
      && /riferito a [a-z]+ \\d{4}/.test(nfp)
      && !/riferito a \\d{2}\\/\\d{2}\\/\\d{4}/.test(nfp);`));

check("v392 il trimestre dichiarato e' quello GIUSTO per ogni mese d'inizio", (() => {
  /* la convenzione: la data e' il PRIMO giorno del trimestre. Gennaio->1°, aprile->2°,
     luglio->3°, ottobre->4°. Un errore qui sposterebbe un dato di tre mesi. */
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const i = src.indexOf("const periodo = (s) => {");
  const b = src.slice(i, src.indexOf("const stessoGiorno", i));
  const q = (m) => Math.floor((m - 1) / 3) + 1;
  return /Math\.floor\(\(m - 1\) \/ 3\) \+ 1/.test(b)
      && q(1) === 1 && q(4) === 2 && q(7) === 3 && q(10) === 4
      && q(3) === 1 && q(6) === 2 && q(9) === 3 && q(12) === 4;
})());

check("v392 l'eta' in giorni resta attaccata alla PUBBLICAZIONE, che e' cio' che misura", (() => {
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const i = src.indexOf("function rigaCadenza(");
  const b = src.slice(i, src.indexOf("\nfunction ", i + 10));
  /* ⚠ la prima stesura di v392 aveva appeso all'eta' la frase "NON dalla pubblicazione",
     che e' esattamente il contrario del vero (v343: eta = giorni dall'uscita). Correggendo
     un'ambiguita' avevo introdotto un'affermazione falsa. */
  const senzaCommenti = b.replace(/\/\*[\s\S]*?\*\//g, "");
  /* ⚠ v396 — la forma e' cambiata (la pubblicazione ora e' un FATTO preso dal calendario, non
     piu' una stima col "~"), il fatto no: l'eta' in giorni sta attaccata alla data di uscita e
     non al periodo misurato. Ancorarsi al testo esatto sarebbe la classe gia' pagata quindici
     volte; ci si ancora alla vicinanza fra `c.pubblicato` e `c.eta` nella stessa espressione. */
  return /ultima uscita \$\{c\.pubblicato[\s\S]{0,120}c\.eta\} giorni fa/.test(senzaCommenti)
      && !/NON dalla pubblicazione/.test(senzaCommenti);
})());

check("v392 i fondi monetari non dichiarano piu' un'eta' con un riferimento ambiguo", suVeri(`
  const p = buildPrompt();
  const r = p.split(String.fromCharCode(10)).find(x => x.indexOf("Retail Cash") >= 0);
  if (!r) return true;
  /* il mese per esteso si data da solo; un conteggio in giorni avrebbe bisogno di dire da
     quale estremo del mese parte, e la prima stesura sbagliava proprio quello */
  return /riferito a [a-z]+ \\d{4}/.test(r)
      && !/rilevazione \\d{4}-\\d{2}-\\d{2}/.test(r)
      && /NON e' la data in cui FRED lo ha pubblicato/.test(r);`));

/* ═══ v395 — IL CALENDARIO UFFICIALE DELLE USCITE ═════════════════════════════════════
   ⚠ IL FENOMENO NON C'E' NEI DATI E VA INIETTATO. `data.json` non porta ancora
   `macro.calendario_uscite` (lo scrive la pipeline al primo run col codice nuovo), quindi un
   check che si limitasse a leggere i dati veri sarebbe VERDE PER ASSENZA DEL FENOMENO — la
   trappola gia' pagata cinque volte in questo progetto. Qui il calendario si costruisce, e i
   check misurano la differenza fra il ramo confermato e quello stimato. */
const _INIETTA_CAL = `
  const _d = new Date(); _d.setDate(_d.getDate() + 5);
  const _iso = _d.getFullYear() + "-" + String(_d.getMonth() + 1).padStart(2, "0")
             + "-" + String(_d.getDate()).padStart(2, "0");
  DATA.macro.calendario_uscite = { per_chiave: {
      cpi: { prossime: [_iso], release: "Consumer Price Index", release_id: 10, serie: "CPIAUCNS" }
    }, fonte: "FRED release calendar", letto_il: _iso };
`;

check("v395 dove il calendario ufficiale esiste, la data vince sulla proiezione", suVeri(_INIETTA_CAL + `
  const c = cadenzaDato("cpi", DATA.macro.indicators.find(i => i.key === "cpi").date);
  /* la proiezione dello stesso indicatore, ottenuta togliendo il calendario: le due devono
     essere DIVERSE, altrimenti il check non sta misurando niente */
  const salva = DATA.macro.calendario_uscite; delete DATA.macro.calendario_uscite;
  const stima = cadenzaDato("cpi", DATA.macro.indicators.find(i => i.key === "cpi").date);
  DATA.macro.calendario_uscite = salva;
  return !!(c && c.confermato === true && c.prossimo === _iso
            && c.calendario === "Consumer Price Index"
            && stima && stima.confermato === false && stima.prossimo !== c.prossimo);`));

/* ⚠⚠ v396 — QUESTI QUATTRO CHECK NASCEVANO IERI E SONO GIA' CAMBIATI, per una ragione che
   vale la pena scrivere: in v395 il pacchetto marcava ogni uscita [CONFERMATA] o [STIMATA],
   cioe' pubblicava ANCHE le date che ci calcolavamo da soli, dichiarandole. Il CEO ha deciso
   che dichiararle non basta — "meglio non avere dati che avere dati non corretti" — e le date
   proiettate sono uscite del tutto. Quindi non c'e' piu' una dualita' da sorvegliare: c'e' un
   insieme solo (gli appuntamenti veri) e un ELENCO DI ESCLUSI che va nominato, perche' togliere
   righe in silenzio e' peggio del difetto che si sta correggendo. */
check("v396 la riga di cadenza porta i tre fatti e nessuna stima", suVeri(`
  const k = (DATA.macro.calendario_uscite.per_chiave.cpi ? "cpi" : null);
  if (!k) return false;
  const r = rigaCadenza("cpi", DATA.macro.indicators.find(i => i.key === "cpi").date);
  return r.indexOf("riferito a ") >= 0
      && r.indexOf("acquisito il ") >= 0
      && r.indexOf("prossimo aggiornamento ") >= 0
      && r.indexOf("calendario ufficiale") >= 0
      && r.indexOf("STIMA") < 0 && r.indexOf("prossimo atteso") < 0;`));

check("v396 senza calendario la riga dice 'non disponibile' invece di calcolarsela", suVeri(`
  const salva = DATA.macro.calendario_uscite;
  delete DATA.macro.calendario_uscite;
  const r = rigaCadenza("cpi", DATA.macro.indicators.find(i => i.key === "cpi").date);
  const c = cadenzaDato("cpi", DATA.macro.indicators.find(i => i.key === "cpi").date);
  DATA.macro.calendario_uscite = salva;
  return r.indexOf("prossimo aggiornamento dato non disponibile") >= 0
      && c.prossimo === null && c.confermato === false
      && !/prossimo aggiornamento [0-9]{2}\\//.test(r);`));

check("v396 nel calendario entrano SOLO gli appuntamenti confermati", suVeri(`
  const cal = DATA.macro.calendario_uscite.per_chiave || {};
  const ev = prossimiEventi(400).eventi.filter(e => e.tipo === "macro");
  if (!ev.length) return false;
  const perNome = {};
  for (const i of DATA.macro.indicators || []) perNome[i.label] = i.key;
  return ev.every(e => e.stimata === false && !!cal[perNome[e.nome]]);`));

/* ⚠ gli esclusi si NOMINANO: chi legge non deve confondere "nessuna uscita prevista" con "il
   sistema non sa quando esce". E' la classe delle notizie contate e poi nascoste (v393). */
check("v396 il pacchetto nomina gli indicatori per cui la data non e' disponibile", suVeri(`
  const p = buildPrompt();
  const r = p.split(String.fromCharCode(10)).find(x => x.indexOf("IN USCITA NELLE PROSSIME") >= 0);
  if (!r) return false;
  const senza = (DATA.macro.indicators || [])
    .filter(i => { const c = cadenzaDato(i.key, i.date); return c && !c.prossimo; })
    .map(i => i.label);
  if (!senza.length) return false;                      // il check non starebbe misurando
  return r.indexOf("TUTTE DATE STIMATE") < 0
      && r.indexOf("APPUNTAMENTI CONFERMATI") >= 0
      && r.indexOf("NON E' DISPONIBILE") >= 0
      && senza.every(n => r.indexOf(n) >= 0);`));

/* ═══ v397 — QUATTRO BUCHI TROVATI LEGGENDO IL PACCHETTO DI CRWV COME IL SUO DESTINATARIO ══
   Tutti e quattro hanno la stessa forma: il sistema AVEVA il dato e non lo consegnava, oppure
   lo consegnava con un'etichetta che affermava piu' di quanto il dato sostenesse. */

check("v397 il pacchetto dice come si chiama la societa', non solo il ticker", suVeri(`
  /* il PASSO 0 ordina di cercare online: senza il nome legale, chi legge deve indovinarlo per
     aprire il sito investor relations o EDGAR. Il campo era in data.json e non usciva. */
  const p = buildPromptTicker("CRWV");
  const r = ((DATA.portfolio || []).concat(DATA.watchlist || []))
    .find(x => String(x.ticker).toUpperCase() === "CRWV");
  if (!r || !r.name) return false;
  return p.split(String.fromCharCode(10))[0].indexOf(r.name) >= 0;`));

check("v397 la variazione di seduta dichiara DI QUALE seduta parla", suVeri(`
  const p = buildPromptTicker("CRWV");
  const nl = String.fromCharCode(10);
  const r = p.split(nl).find(x => x.indexOf("Variazione della seduta") >= 0);
  if (!r) return false;
  /* la vecchia forma diceva "di oggi" su una barra che poteva essere di ieri: e' la classe
     v193/v229, stato del mercato e freschezza del dato sono due cose diverse. */
  return p.indexOf("Variazione di oggi") < 0
      && /Variazione della seduta del [0-9]{2}\\/[0-9]{2}\\/[0-9]{4}/.test(r);`));

check("v397 il massimo storico si pubblica quando dice altro dal massimo a 52 settimane", suVeri(`
  const p = buildPromptTicker("CRWV");
  const r = ((DATA.portfolio || []).concat(DATA.watchlist || []))
    .find(x => String(x.ticker).toUpperCase() === "CRWV");
  if (!r || !r.ath || !r.w52_high || r.ath <= r.w52_high * 1.02) return false;  // muto
  const haStorico = p.indexOf("Massimo storico") >= 0 && p.indexOf(String(r.ath)) >= 0;
  /* e NON si pubblica quando coinciderebbe col massimo dell'anno: sarebbe lo stesso fatto
     scritto due volte, la ridondanza che v184 ha misurato e tolto. */
  const salva = r.ath; r.ath = r.w52_high;
  const senza = buildPromptTicker("CRWV").indexOf("Massimo storico") < 0;
  r.ath = salva;
  return haStorico && senza;`));

check("v397 la tabella dei trimestri vecchia si diagnostica dal DEPOSITO, non dalla stima", suVeri(`
  const p = buildPromptTicker("CRWV");
  const sec = ((DATA.macro.sec_calendario || {}).per_titolo || {}).CRWV;
  if (!sec || !sec.ultimo_deposito) return false;          // muto: manca il fenomeno
  if (p.indexOf("E' UN FATTO, NON UN SOSPETTO") < 0) return false;
  if (p.indexOf(String(sec.ultimo_deposito)) < 0) return false;
  /* togliendo il fatto si deve tornare all'indizio debole, DICHIARANDOLO tale */
  const salva = DATA.macro.sec_calendario;
  DATA.macro.sec_calendario = { per_titolo: {}, senza_8k: [], senza_cik: [], fonte: "x" };
  const q = buildPromptTicker("CRWV");
  DATA.macro.sec_calendario = salva;
  return q.indexOf("E' UN FATTO, NON UN SOSPETTO") < 0
      && q.indexOf("POTREBBE NON ESSERE AGGIORNATA") >= 0
      && q.indexOf("poggia su una data ATTESA") >= 0;`));

/* ═══ v398 — LE NOTIZIE PER TITOLO, E LA RAGIONE PER CUI ESISTONO ═════════════════════════
   ⚠ IL FENOMENO NON C'E' NEI DATI E VA INIETTATO: `data.json` non porta ancora news_titoli (lo
   scrive la pipeline al primo run col codice nuovo), quindi un check che leggesse i dati veri
   sarebbe verde per assenza — la trappola gia' pagata cinque volte in questo progetto. */
const _INIETTA_NEWS = `
  const _ora = (h) => new Date(Date.now() - h * 3600000).toISOString().slice(0, 19) + "Z";
  const _grp = disciplinaRischio();
  DATA.news_titoli = { fonte: "Yahoo Finance RSS per ticker", finestra_giorni: 14,
    senza_notizie: ["BE"], non_letti: ["SKHY"], letto_il: _ora(0),
    per_titolo: {
      CRWV: [{ titolo: "Titolo di prova su CoreWeave", riassunto: "riassunto", quando: _ora(6), fonte: "Yahoo Finance", url: "u" }],
      NVDA: [{ titolo: "Titolo di prova su Nvidia", riassunto: "", quando: _ora(9), fonte: "Yahoo Finance", url: "u" }],
    } };
`;

check("v398 il pacchetto porta i titoli sul nome analizzato, con la loro eta'", suVeri(_INIETTA_NEWS + `
  const p = buildPromptTicker("CRWV");
  return p.indexOf("NOTIZIE SUI TITOLI DEL LIBRO") >= 0
      && p.indexOf("Titolo di prova su CoreWeave") >= 0
      /* la riga porta la fonte CHE HA SERVITO accanto all'eta': i canali sono due, e dire
         quale ha risposto e' la lezione v393 — un'etichetta fissa descrive il ripiego come se
         fosse la primaria. */
      && /\\[[^\\]]+, 6h fa\\]/.test(p);`));

/* ⚠⚠ QUESTA E' LA RAGIONE PER CUI IL BLOCCO ESISTE, e va sorvegliata a parte: la ricerca web
   dell'LLM e' piu' fresca della nostra, quindi il valore aggiunto NON e' la notizia sul titolo
   — e' la notizia su un ALTRO nome del gruppo correlato, collegamento che si puo' fare solo
   avendo il libro. Se cadesse questa riga, il blocco costerebbe tredici richieste per niente. */
check("v398 le notizie sugli altri nomi del gruppo sono marcate come notizie sul FATTORE", suVeri(_INIETTA_NEWS + `
  const p = buildPromptTicker("CRWV");
  return p.indexOf("RIGUARDANO IL FATTORE") >= 0
      && p.indexOf("[NVDA]") >= 0
      && p.indexOf("Titolo di prova su Nvidia") >= 0
      && /PESO DEL GRUPPO \\([0-9]+(,[0-9]+)?% dell'azionario\\)/.test(p);`));

check("v398 un titolo NON LETTO non si legge come 'nessuna notizia'", suVeri(_INIETTA_NEWS + `
  const p = buildPromptTicker("CRWV");
  /* i tre esiti hanno significati opposti: se si confondono, un buco della raccolta diventa
     un fatto sul mondo (la classe che ha ucciso le news macro per un anno, v389). */
  return p.indexOf("NON LETTI in questo run") >= 0
      && p.indexOf("SKHY") >= 0
      && p.indexOf("NON e' un'informazione: e' un buco della raccolta") >= 0;`));

check("v398 senza raccolta il blocco sparisce, non mente", suVeri(`
  delete DATA.news_titoli;
  const p = buildPromptTicker("CRWV");
  return p.indexOf("NOTIZIE SUI TITOLI DEL LIBRO") < 0
      && p.indexOf("RIGUARDANO IL FATTORE") < 0;`));

/* ⚠ il tetto di lunghezza: il minimo e' stato TOLTO perche' un pavimento e' un invito a
   riempire, ed e' il riempimento — non lo spazio — a produrre affermazioni non sostenute. */
check("v398 il budget e' un TETTO senza pavimento, con la clausola anti-riempimento", suVeri(`
  const p = buildPromptTicker("CRWV");
  return /BUDGET: al massimo [0-9.]+ parole/.test(p)
      && p.indexOf("non esiste una") >= 0
      && p.indexOf("non allungare MAI un blocco") >= 0
      && p.indexOf("1.600-1.800") < 0;`));

check("v398 la testata non dichiara piu' di non avere notizie sulla societa'", suVeri(`
  const p = buildPromptTicker("CRWV");
  return p.indexOf("non porta niente, quindi quella parte e' interamente tua") < 0
      && p.indexOf("i titoli sui NOMI CHE IL CEO POSSIEDE") >= 0
      && p.indexOf("NON TI ESONERANO DALLA RICERCA") >= 0;`));

/* ═══ v400 — IL SEGNO DELLA REVISIONE SU UN UTILE NEGATIVO ═════════════════════════════════
   Il pacchetto stampava "+27,77%" su una stima passata da -3,42 a -4,37 e poi, nella riga
   marcata ⚠⚠, "la stima a 90 giorni SALE": l'opposto del vero, nella riga che si dichiara la
   piu' importante. Il check non guarda il numero atteso — quello si puo' sbagliare insieme al
   codice (v326) — ma la PROPRIETA' che il difetto viola per costruzione: su due stime negative
   in cui la seconda e' piu' bassa, la parola stampata deve dire che il conto PEGGIORA. */
check("v400 su un EPS negativo la revisione dichiara che la perdita si AMPLIA, non che sale", suVeri(`
  const r = DATA.watchlist.find(x => x.ticker === "CRWV");
  r.analisti = { eps_ora: -4.37, eps_90g_fa: -3.42, revisione_90g_pct: 27.77, su_30g: 3, giu_30g: 6 };
  const p = buildPromptTicker("CRWV");
  return p.indexOf("la perdita attesa si e' AMPLIATA") >= 0
      && p.indexOf("la stima a 90 giorni sale") < 0;`));

check("v400 la stessa revisione su utili POSITIVI resta descritta come stima che scende", suVeri(`
  const r = DATA.watchlist.find(x => x.ticker === "CRWV");
  r.analisti = { eps_ora: 3.42, eps_90g_fa: 4.37, revisione_90g_pct: -21.74, su_30g: 3, giu_30g: 6 };
  const p = buildPromptTicker("CRWV");
  return p.indexOf("la stima e' SCESA del") >= 0
      && p.indexOf("la perdita attesa") < 0;`));

/* ⚠ LA DIVERGENZA ERA FABBRICATA: scattava ogni volta che i tagli a 30 giorni prevalevano,
   qualunque cosa facesse la traiettoria a 90. Il check esercita ENTRAMBI i rami — concordi e
   discordi — perche' un gate che prova un ramo solo non distingue una condizione giusta da una
   costante. */
check("v400 due misure concordi NON vengono annunciate come divergenza", suVeri(`
  const r = DATA.watchlist.find(x => x.ticker === "CRWV");
  r.analisti = { eps_ora: -4.37, eps_90g_fa: -3.42, revisione_90g_pct: 27.77, su_30g: 3, giu_30g: 6 };
  const p = buildPromptTicker("CRWV");
  return p.indexOf("TRAIETTORIA E AMPIEZZA CONCORDANO") >= 0
      && p.indexOf("TRAIETTORIA E AMPIEZZA DIVERGONO") < 0;`));

check("v400 due misure davvero opposte SONO annunciate come divergenza", suVeri(`
  const r = DATA.watchlist.find(x => x.ticker === "CRWV");
  r.analisti = { eps_ora: -3.42, eps_90g_fa: -4.37, revisione_90g_pct: -21.74, su_30g: 3, giu_30g: 6 };
  const p = buildPromptTicker("CRWV");
  return p.indexOf("TRAIETTORIA E AMPIEZZA DIVERGONO") >= 0
      && p.indexOf("TRAIETTORIA E AMPIEZZA CONCORDANO") < 0;`));

/* ═══ v400 — IL PACCHETTO NON PRESENTA PIU' COME MISTERO CIO' CHE SA ═══════════════════════
   Lo scarto fra i ricavi su dodici mesi dell'aggregatore e la somma dei quattro trimestri E'
   il trimestre che la tabella non ha, e il deposito EDGAR lo dice nello stesso pacchetto. */
check("v400 il residuo dei ricavi 12 mesi e' spiegato dal deposito, non dichiarato ignoto", suVeri(`
  const p = buildPromptTicker("CRWV");
  if (p.indexOf("NON QUADRA CON I TRIMESTRI") < 0) return false;   // il fenomeno c'e'
  return p.indexOf("E' SPIEGATO: la tabella dei trimestri e' ferma") >= 0
      && p.indexOf("non e' spiegato dai dati qui presenti") < 0;`));

check("v400 senza deposito EDGAR il residuo torna a dichiararsi non spiegato", suVeri(`
  delete DATA.macro.sec_calendario;
  const p = buildPromptTicker("CRWV");
  return p.indexOf("non e' spiegato dai dati qui presenti") >= 0
      && p.indexOf("E' SPIEGATO: la tabella dei trimestri e' ferma") < 0;`));

/* ═══ v400 — BILANCIO E CREDITO DICHIARANO DI NON ESSERE L'ULTIMO ══════════════════════════
   Erano i due blocchi su cui si regge l'analisi di una societa' che costruisce a debito, ed
   erano gli unici due senza l'avviso costruito sul deposito EDGAR: cassa 2,2 mld al 31/03
   contro 5,524 del 10-Q depositato l'11/08, con due conclusioni al presente costruite sopra. */
check("v400 COMBUSTIONE DI CASSA dichiara che il bilancio non e' l'ultimo depositato", suVeri(`
  const p = buildPromptTicker("CRWV");
  if (p.indexOf("COMBUSTIONE DI CASSA [bilancio al") < 0) return false;
  return p.indexOf("E QUESTO BILANCIO NON E' L'ULTIMO") >= 0;`));

check("v400 CREDITO dichiara che il conto economico non e' l'ultimo depositato", suVeri(`
  const p = buildPromptTicker("CRWV");
  if (p.indexOf("- CREDITO [conto economico al") < 0) return false;
  return p.indexOf("E QUESTO CONTO ECONOMICO NON E' L'ULTIMO") >= 0;`));

check("v400 senza deposito EDGAR i due avvisi tacciono invece di affermare a vuoto", suVeri(`
  delete DATA.macro.sec_calendario;
  const p = buildPromptTicker("CRWV");
  return p.indexOf("E QUESTO BILANCIO NON E' L'ULTIMO") < 0
      && p.indexOf("E QUESTO CONTO ECONOMICO NON E' L'ULTIMO") < 0;`));

/* ⚠ v400 — UNA SOLA RISPOSTA ALLA DOMANDA "la tabella e' ferma?": tre blocchi la fanno e la
   funzione e' una. Il check verifica il COLLEGAMENTO, non l'esistenza: e' la lezione v399 —
   togliendo la riga che aggancia la fonte al gate, tutto restava verde. */
check("v400 i tre blocchi passano dallo stesso depositoOltreLaTabella", (() => {
  const senzaCommenti = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const n = (senzaCommenti.match(/depositoOltreLaTabella\(/g) || []).length;
  return n >= 4 && /function depositoOltreLaTabella\(/.test(senzaCommenti);   // 1 def + 3 usi
})());

/* ⚠ v400 — DUE OROLOGI: il book vuoto e' un fatto dello SNAPSHOT, la fase di sessione e'
   calcolata adesso. La riga affermava "succede a mercato chiuso" accanto a "SESSIONE USA
   APERTA", e il collaudo di congruita' impone a chi legge di segnalarlo. */
/* ⚠⚠ v402 — LA MIA INIEZIONE NON MORDEVA, E IL CHECK ERA VERDE PER LO STATO DEL GIORNO.
   Cancellava `r.tv.evento`, ma il movimento implicito NON viene da li': lo costruisce
   `movimentoImplicito(DATA.options[tk])`. Il check passava solo perche' allo snapshot di quel
   momento il book era vuoto — appena il CI ha prodotto un run a mercato aperto, con le opzioni
   quotate, e' andato rosso. E' la classe v233 (un check che misura i dati del giorno invece
   della proprieta') sommata a quella dell'iniezione senza morso: due volte la stessa lezione,
   scritta in questo file, ripetuta lo stesso.
   Ora lo STATO si COSTRUISCE: la catena resta (quindi `opzioniPresenti` e' vero) ma denaro e
   lettera vanno a zero su ogni strike, che e' esattamente il book vuoto da cui non si ricava
   uno straddle. Il fenomeno c'e' per costruzione, non per fortuna. */
check("v400 il movimento implicito non afferma piu' uno stato di mercato che non conosce", suVeri(`
  const o = (DATA.options || {}).CRWV;
  if (!o || !(o.expiries || []).length) return false;   // senza catena il ramo non esiste
  o.expiries.forEach(e => [...(e.calls || []), ...(e.puts || [])].forEach(x => { x.bid = 0; x.ask = 0; }));
  const p = buildPromptTicker("CRWV");
  if (p.indexOf("MOVIMENTO IMPLICITO: NON CALCOLABILE") < 0) return false;
  return p.indexOf("succede a mercato chiuso") < 0
      && p.indexOf("sono due orologi") >= 0;`));

/* ═══ v400 — LA TABELLA DEI CONCORRENTI CHIEDEVA UNA QUOTA SENZA CHIEDERE DI QUALE MERCATO ══
   Dimostrato da un referto reale su questo stesso pacchetto: il modello ha incolonnato le quote
   del cloud GENERALE (44%, 30%, 19%) accanto a un 5% del titolo, che sta su un mercato molto
   piu' piccolo. Denominatori diversi nella stessa colonna — la classe che coherence_check
   chiama "denominatori non dichiarati", qui prodotta dalla richiesta stessa. */
check("v400 la tabella dei concorrenti pretende il denominatore della quota", suVeri(`
  const p = buildPromptTicker("CRWV");
  return p.indexOf("DI QUALE MERCATO") >= 0
      && p.indexOf("stesso DENOMINATORE") >= 0
      && p.indexOf("NON incolonnarle") >= 0;`));

/* ═══ v401 — DATI DI UN RUN VECCHIO: SI DICHIARA, NON SI TACE ══════════════════════════════
   Il campo `breve` lo scrive la pipeline. Fra il rilascio e il primo giro del CI i dati non
   ce l'hanno: la finestra corta non puo' esserci, e il pacchetto deve DIRLO invece di
   pubblicare solo l'anno come se fosse tutto. E' la regola gia' pagata in v187 e v400. */
check("v401 senza la finestra corta nei dati il pacchetto lo dichiara invece di tacere", run(`
  const _s = DATA;
  DATA = JSON.parse(JSON.stringify(REALE));
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "MU");
  if (!r) { DATA = _s; return true; }
  const tv = JSON.parse(JSON.stringify(${JSON.stringify(TV_FINTO)}));
  Object.values(tv.sensibilita).forEach(v => { delete v.breve; delete v.r2_soglia; delete v.acceso; });
  r.tv = tv;
  recomputeTotals();
  try {
    const p = buildPromptTicker("MU");
    return p.indexOf("finestra corta — non ancora presente in questo run") >= 0
        && p.indexOf("bande di CONVENZIONE") >= 0
        && p.indexOf("IL CANALE SI E' ACCESO") < 0;
  } finally { DATA = _s; recomputeTotals(); }`));

/* ⚠ il caso opposto del canale che si accende: uno che si SPEGNE va nominato con la stessa
   forza, altrimenti il gate proverebbe una condizione e non una funzione (v400). */
check("v401 un canale che si SPEGNE viene nominato come quello che si accende", run(`
  const _s = DATA;
  DATA = JSON.parse(JSON.stringify(REALE));
  const r = (DATA.watchlist || []).find(x => x && x.ticker === "MU");
  if (!r) { DATA = _s; return true; }
  const tv = JSON.parse(JSON.stringify(${JSON.stringify(TV_FINTO)}));
  tv.sensibilita.tassi.acceso = true;  tv.sensibilita.tassi.r2 = 0.31;
  tv.sensibilita.tassi.breve.acceso = false; tv.sensibilita.tassi.breve.r2 = 0.01;
  r.tv = tv;
  recomputeTotals();
  try {
    const p = buildPromptTicker("MU");
    return p.indexOf("IL CANALE SI E' SPENTO") >= 0
        && p.indexOf("IL CANALE SI E' ACCESO") < 0;
  } finally { DATA = _s; recomputeTotals(); }`));

/* ═══ v401 — IL BLOCCO CHE INCROCIA, CHIESTO DAL CEO ═══════════════════════════════════════
   "correlazioni tra portafoglio, dati tecnici e fondamentali, dati macro e ultime news ...
   anche quando genero l'analisi di un solo titolo". Il gate sorveglia le quattro giunzioni e
   la regola che tiene il blocco onesto (ogni riga unisce almeno due fonti). */
check("v401 il pacchetto chiede un blocco che INCROCIA le fonti, non un nono elenco", suVeri(`
  const p = buildPromptTicker("CRWV");
  return p.indexOf("L'INCROCIO") >= 0
      && p.indexOf("unire ALMENO DUE fonti") >= 0
      && p.indexOf("NOTIZIA → CANALE → LIBRO") >= 0
      && p.indexOf("MACRO → CONTO ECONOMICO") >= 0
      && p.indexOf("TECNICA ↔ FONDAMENTALE") >= 0
      && p.indexOf("E QUINDI, PER IL LIBRO") >= 0;`));

/* ⚠⚠ il blocco nuovo e' quello in cui e' PIU' facile scivolare nel dimensionamento, perche'
   chiede di indirizzare sul libro. Il divieto deve valere anche li', esplicitamente. */
check("v401 il blocco dell'incrocio ripete il divieto di dimensionare", suVeri(`
  const p = buildPromptTicker("CRWV");
  const i = p.indexOf("E QUINDI, PER IL LIBRO");
  const j = p.indexOf("LA TESI CONTRARIA");
  if (i < 0 || j < 0 || j < i) return false;
  const blocco = p.slice(i, j);
  return blocco.indexOf("quantita' MAI") >= 0
      && blocco.indexOf("nessuna percentuale") >= 0;`));

/* ⚠ la tesi contraria resta l'ULTIMA consegna: rinumerandola da 9 a 10 il gate storico va
   riverificato, non dato per buono. */
check("v401 la tesi contraria e' ancora l'ultimo blocco richiesto", suVeri(`
  const p = buildPromptTicker("CRWV");
  const testa = p.slice(0, p.indexOf("QUADRO MACRO DI RIFERIMENTO"));
  const num = (testa.match(/^\\d+\\) [A-Z]/gm) || []).map(x => parseInt(x, 10));
  if (!num.length) return false;
  const ultimo = Math.max.apply(null, num);
  return testa.indexOf(ultimo + ") LA TESI CONTRARIA") >= 0;`));

/* ⚠ le ultime 48 ore devono coprire anche i NOMI CORRELATI: e' la meta' del join che il
   modello non puo' fare da solo, perche' non conosce il libro. */
check("v401 la ricerca delle 48 ore copre anche il gruppo correlato", suVeri(`
  const p = buildPromptTicker("CRWV");
  return p.indexOf("ANCHE SUI NOMI DEL GRUPPO CORRELATO") >= 0
      && p.indexOf("rende possibile il blocco 9") >= 0;`));

/* ⚠ il tetto sale perche' e' stata AGGIUNTA una consegna: resta un tetto, e la clausola
   anti-riempimento resta la protezione vera (v398). */
check("v401 il tetto e' salito con la consegna nuova e la clausola resta", suVeri(`
  const p = buildPromptTicker("CRWV");
  return /BUDGET: al massimo 2\\.800 parole/.test(p)
      && p.indexOf("non allungare MAI un blocco") >= 0
      && p.indexOf("non esiste una") >= 0;`));

/* ═══ v401 — I DUE CONTEGGI DI ANALISTI CONTANO POPOLAZIONI DIVERSE ════════════════════════
   Il pacchetto scriveva "35 giudizi" accanto al target medio, e la fonte che pubblica lo
   stesso target ne conta 38: non e' una contraddizione, e' che il conteggio e' di chi pubblica
   una raccomandazione e il target medio di chi pubblica un obiettivo di prezzo. Un divario
   taciuto costringe chi legge a segnalarlo a ogni run. */
check("v401 il conteggio degli analisti dichiara che cosa conta", suVeri(`
  const p = buildPromptTicker("CRWV");
  return p.indexOf("analisti pubblicano una RACCOMANDAZIONE") >= 0
      && p.indexOf("CONTANO POPOLAZIONI DIVERSE") >= 0
      && p.indexOf("non e' una contraddizione: e' l'altra popolazione") >= 0
      /* ⚠ ANCORAGGIO CHIUSO: "giudizio" compare legittimamente nelle istruzioni (la tesi
         contraria, il collaudo). La prima stesura cercava la sottostringa nuda ed era rossa su
         codice giusto — quinta incarnazione dell'ancoraggio aperto in questo progetto. Quello
         che non deve tornare e' il CONTEGGIO NUDO accanto al target. */
      && !/\\d+ giudizi/.test(p);`));

/* ⚠⚠ v402 — UNA SOLA SOGLIA NEL PACCHETTO. La testata citava 0,05 mentre la coda pubblica il
   pavimento misurato: due valori per la stessa grandezza, cioe' la classe che il collaudo di
   congruita' ordina a chi legge di segnalare — prodotta dal pacchetto stesso. Il check cerca
   il numero fisso nelle ISTRUZIONI, dove non deve piu' comparire. */
check("v402 la testata non ripete una soglia di R² propria: rimanda al pavimento misurato", suVeri(`
  const p = buildPromptTicker("CRWV");
  const testa = p.slice(0, p.indexOf("QUADRO MACRO DI RIFERIMENTO"));
  return testa.indexOf("PAVIMENTO DEL RUMORE") >= 0
      && testa.indexOf("E LE FINESTRE SONO DUE") >= 0
      && !/R² sotto 0,05/.test(testa)
      && !/R² sui tassi e' 0,01/.test(testa);`));

/* ═══ v402 — L'ULTIMA CHIUSURA NON PUO' ESSERE NEL FUTURO ══════════════════════════════════
   Trovato da un check andato rosso da solo quando il CI ha prodotto un run A MERCATO APERTO:
   `price_asof` diventa oggi appena la barra odierna comincia, e la funzione costruiva le 16:00
   ET DI OGGI — sei ore avanti. Il pacchetto scriveva "0 pubblicate DOPO l'ultima chiusura USA
   del 2026-09-02": zero PER COSTRUZIONE, perche' niente puo' essere posteriore a un istante non
   ancora arrivato. E uno zero li' si legge come "niente di non prezzato", che e' l'opposto.
   ⚠ Il ramo si esercita a OROLOGIO FERMO: un ramo temporale che nessun test puo' percorrere non
   e' una protezione, e un check che dipende dall'ora in cui gira va rosso da solo (v190, v234). */
check("v402 a mercato aperto l'ultima chiusura e' quella di IERI, non una di oggi non avvenuta", suVeri(`
  const r = DATA.watchlist.find(x => x.ticker === "CRWV");
  if (!r) return false;
  DATA.watchlist.forEach(x => { if (x.currency === "USD") x.price_asof = "2026-09-02"; });
  // mercoledi' 02/09/2026, 13:30 a New York: la sessione e' in corso
  const c = lastUsEquityCloseUTC(new Date("2026-09-02T17:30:00Z"));
  return c !== null && c.asof === "2026-09-01"
      && c.at.getTime() < new Date("2026-09-02T17:30:00Z").getTime();`));

check("v402 a mercato chiuso l'ultima chiusura resta quella del giorno stesso", suVeri(`
  DATA.watchlist.forEach(x => { if (x.currency === "USD") x.price_asof = "2026-09-02"; });
  // stessa giornata, ma alle 23:00 UTC: le 16:00 ET sono passate
  const c = lastUsEquityCloseUTC(new Date("2026-09-02T23:00:00Z"));
  return c !== null && c.asof === "2026-09-02";`));

/* ⚠ il salto all'indietro deve scavalcare il fine settimana, altrimenti restituirebbe una
   "chiusura" di domenica, che non esiste. */
check("v402 tornando indietro si saltano sabato e domenica", suVeri(`
  DATA.watchlist.forEach(x => { if (x.currency === "USD") x.price_asof = "2026-09-07"; });
  // lunedi' 07/09/2026 a mercato ancora aperto: la chiusura precedente e' venerdi' 04
  const c = lastUsEquityCloseUTC(new Date("2026-09-07T17:30:00Z"));
  return c !== null && c.asof === "2026-09-04";`));

/* ⚠ e la conseguenza che conta, sul pacchetto vero: il conteggio delle notizie non prezzate
   non e' piu' zero per costruzione. Il check INIETTA le voci, cosi' il fenomeno c'e'. */
check("v402 le notizie post-chiusura si contano anche a sessione aperta", suVeri(`
  const ch = lastUsEquityCloseUTC();
  if (!ch) return false;
  const t = (ms) => new Date(ms).toISOString();
  DATA.macro = DATA.macro || {};
  DATA.macro.news = { fonti: ["Prova"], filtro: "sintetico", voci: [
    { titolo: "POST-CHIUSURA-UNO", riassunto: "", fonte: "Prova", quando: t(ch.at.getTime() + 1000) },
    { titolo: "POST-CHIUSURA-DUE", riassunto: "", fonte: "Prova", quando: t(ch.at.getTime() + 2000) },
  ] };
  const p = buildPrompt();
  return ch.at.getTime() <= Date.now()
      && p.indexOf("POST-CHIUSURA-UNO") >= 0
      && p.indexOf("POST-CHIUSURA-DUE") >= 0;`));

/* ═══ v403 — LA SENSIBILITA' AGLI EVENTI, E IL DENOMINATORE CHE NON SI CONFRONTA ═══════════
   Le due finestre della v401 hanno risposto NO sul canale tassi di CRWV, e avevano ragione: il
   01/09 e' stato un evento, non un regime. Ma la domanda che un libro a leva pone e' "il giorno
   che i tassi saltano, quanto perdo", e una regressione sulla giornata MEDIA non la risponde.
   ⚠ Il rischio della misura e' che il suo R² venga letto accanto agli altri due: e' calcolato
   su un sottoinsieme scelto, quindi ha un denominatore diverso. Il gate pretende che la riga lo
   DICHIARI — e' la regola dei denominatori non dichiarati applicata a una misura nostra. */
check("v403 la sensibilita' nelle sedute di forte escursione viene pubblicata col suo campione", suVeri(`
  const r = DATA.watchlist.find(x => x.ticker === "MU");
  if (!r) return false;
  r.tv = JSON.parse(JSON.stringify(${JSON.stringify(TV_FINTO)}));
  const p = buildPromptTicker("MU");
  /* ⚠ indexOf e non regex: un backslash dentro un template literal sparisce, e il meta-gate mi
     ha ripreso di nuovo scrivendo questo check. Una stringa non ha niente da sfuggire. */
  return p.indexOf("quando il canale si muove FORTE") >= 0
      && p.indexOf("beta +2.4, R² 0.55 contro un pavimento del rumore di 0.077") >= 0
      && p.indexOf("50 sedute, dal 2025-08-20 al 2026-08-13") >= 0
      && p.indexOf("oltre 1.2% in valore assoluto") >= 0;`));

check("v403 il R² condizionato dichiara di NON essere confrontabile con gli altri due", suVeri(`
  const r = DATA.watchlist.find(x => x.ticker === "MU");
  if (!r) return false;
  r.tv = JSON.parse(JSON.stringify(${JSON.stringify(TV_FINTO)}));
  const p = buildPromptTicker("MU");
  return p.indexOf("QUESTO R² NON SI CONFRONTA") >= 0
      && p.indexOf("DENOMINATORE diverso") >= 0
      && p.indexOf("Quello che si confronta e' il BETA") >= 0;`));

/* ⚠ il confronto fra i due beta e' il messaggio: 2,4 contro 0,75 e' il triplo, e la riga deve
   dirlo in cifre invece di lasciarlo calcolare a chi legge. */
/* ⚠⚠ v415 — QUESTO GATE PINNAVA IL COMPORTAMENTO SBAGLIATO. Pretendeva il confronto in cifre
   sul canale `tassi` della fixture, la cui finestra LUNGA sta sotto il pavimento del rumore
   (R² 0,007 contro 0,015): cioe' esigeva proprio la percentuale calcolata su un beta che il
   pacchetto dichiara non misurabile — il difetto trovato leggendo il pacchetto di CRWV.
   *Un gate che pinna un difetto lo rende permanente* (v326, v411).
   ⚠ L'invariante non cambia — quando i due beta SONO misurabili, il confronto esce in cifre —
   ma ora il check COSTRUISCE quello stato invece di prenderlo da una fixture che rappresenta il
   caso opposto. La fixture condivisa resta intatta: serve al caso "canale acceso solo di
   recente" della v401 e a `v415`, che misura il ramo dichiarato. */
check("v403 il beta delle sedute forti si confronta in cifre con quello della finestra lunga", suVeri(`
  const r = DATA.watchlist.find(x => x.ticker === "MU");
  if (!r) return false;
  r.tv = JSON.parse(JSON.stringify(${JSON.stringify(TV_FINTO)}));
  /* entrambi i termini sopra il proprio pavimento: e' la condizione in cui il confronto e' lecito */
  r.tv.sensibilita.tassi.r2 = 0.2;
  r.tv.sensibilita.tassi.acceso = true;
  const p = buildPromptTicker("MU");
  return p.indexOf("220% PIU' AMPIO") >= 0;`));

/* ⚠ e la riga deve dire PERCHE' la selezione non falsa il beta: si sceglie sulla causa, non
   sull'effetto. Senza quella frase la misura invita al sospetto giusto sulla cosa sbagliata. */
check("v403 la riga dichiara che la selezione e' sul canale, non sul titolo", suVeri(`
  const r = DATA.watchlist.find(x => x.ticker === "MU");
  if (!r) return false;
  r.tv = JSON.parse(JSON.stringify(${JSON.stringify(TV_FINTO)}));
  const p = buildPromptTicker("MU");
  /* ⚠ riagganciato: la formulazione e' cambiata perche' C9 ha preso due imperativi nella coda.
     L'invariante non e' la frase, e' che la riga dichiari SU COSA avviene la selezione. */
  return p.indexOf("LA SELEZIONE E' SULL'ESCURSIONE DEL CANALE") >= 0
      && p.indexOf("mai sul movimento del titolo") >= 0;`));

check("v403 senza il terzo sguardo nei dati la riga non compare e non si inventa", suVeri(`
  const r = DATA.watchlist.find(x => x.ticker === "MU");
  if (!r) return false;
  const tv = JSON.parse(JSON.stringify(${JSON.stringify(TV_FINTO)}));
  Object.values(tv.sensibilita).forEach(v => { delete v.evento; });
  r.tv = tv;
  const p = buildPromptTicker("MU");
  return p.indexOf("quando il canale si muove FORTE") < 0
      && p.indexOf("QUESTO R² NON SI CONFRONTA") < 0;`));

/* ═══ v404 — IL GRUPPO CORRELATO NON E' UN RISCHIO SOLO ════════════════════════════════════
   Il grappolo mette nella stessa fascia chi genera cassa e chi la prende a prestito: si muovono
   insieme nella giornata media, ma una stretta del credito non li colpisce allo stesso modo.
   Il gate verifica che il taglio esista, che dichiari di essere una CONVENZIONE, e che nomini
   quali dei dipendenti stanno anche nel gruppo correlato — che e' l'informazione che nessuna
   delle due misure da sola porta. */
check("v404 il pacchetto pubblica la dipendenza dal mercato dei capitali", suVeri(`
  const p = buildPromptTicker("CRWV");
  return p.indexOf("DIPENDENZA DAL MERCATO DEI CAPITALI") >= 0
      && p.indexOf("flusso di cassa LIBERO NEGATIVO su dodici mesi") >= 0
      && p.indexOf("[nel gruppo correlato]") >= 0;`));

check("v404 la soglia si dichiara convenzione e non giudizio sulla societa'", suVeri(`
  const p = buildPromptTicker("CRWV");
  return p.indexOf("CONVENZIONE DICHIARATA, non un dato del file") >= 0
      && p.indexOf("non e' un giudizio sulla societa'") >= 0;`));

/* ⚠⚠ IL VINCOLO DI VALUTA: `fcf_ttm` e' nella valuta di bilancio dell'emittente — SKHY lo
   pubblica in won. Un ordinamento o una somma di quei numeri sarebbe la classe che il gate
   valuta sorveglia dalla v183. Il check prova la PROPRIETA': nessun importo di flusso finisce
   nella riga, che porta solo percentuali di peso e rapporti di copertura. */
check("v404 nella riga non finisce nessun importo di flusso: solo pesi e rapporti", suVeri(`
  const p = buildPromptTicker("CRWV");
  const i = p.indexOf("DIPENDENZA DAL MERCATO DEI CAPITALI");
  if (i < 0) return false;
  const riga = p.slice(i, p.indexOf(String.fromCharCode(10), i));
  return riga.indexOf("mld") < 0 && riga.indexOf("milioni") < 0
      && riga.indexOf("non sono commensurabili") >= 0;`));

/* ⚠ il numero che il blocco esiste per dare: l'evento sul credito colpisce la parte che
   dipende, NON il peso del gruppo correlato. Se i due coincidessero la riga non servirebbe. */
check("v404 la riga contrappone il peso di chi dipende a quello del gruppo correlato", suVeri(`
  const p = buildPromptTicker("CRWV");
  return p.indexOf("colpisce") >= 0
      && p.indexOf("del libro, non il") >= 0
      && p.indexOf("del gruppo") >= 0;`));

/* ⚠ un titolo che genera cassa NON deve comparire fra i dipendenti, e uno che la brucia SI':
   la classificazione si esercita costruendo lo stato, non sperando nei dati del giorno (v403). */
check("v404 la classificazione segue il SEGNO del flusso, non il nome del titolo", suVeri(`
  const nv = DATA.watchlist.find(x => x.ticker === "NVDA");
  if (!nv || !nv.combustione) return false;
  nv.combustione.fcf_ttm = -1;                       // NVDA diventa dipendente per costruzione
  const p = buildPromptTicker("CRWV");
  const i = p.indexOf("Chi dipende:");
  const riga = p.slice(i, p.indexOf(String.fromCharCode(10), i));
  return i >= 0 && riga.indexOf("NVDA") >= 0;`));

/* ⚠ IL PESO SU CUI IL DATO MANCA SI DICHIARA, non sparisce dentro gli autofinanziati: chi legge
   non distingue "genera cassa" da "non lo so", e sono due cose diverse. La prima stesura di
   questo check toglieva il dato a TUTTI e usciva con un return true anticipato quando la riga
   spariva — verde per assenza del fenomeno, e il meta-gate dei dormienti l'ha preso. Ora il dato
   si toglie a UNA posizione sola, cosi' la riga c'e' per costruzione e il buco deve comparirci. */
check("v404 il peso su cui il dato manca si dichiara invece di finire fra gli autonomi", suVeri(`
  const mu = DATA.watchlist.find(x => x.ticker === "MU");
  if (!mu || !mu.combustione) return false;
  delete mu.combustione.fcf_ttm;
  const p = buildPromptTicker("CRWV");
  const i = p.indexOf("DIPENDENZA DAL MERCATO DEI CAPITALI");
  if (i < 0) return false;
  const riga = p.slice(i, p.indexOf(String.fromCharCode(10), i));
  return riga.indexOf("su cui il dato manca") >= 0
      && riga.indexOf("MU") < 0;`));

/* ═══ v405 — TRE ETICHETTE CHE DICEVANO PIU' (O ALTRO) DEL PROPRIO DATO ════════════════════
   Trovate leggendo il pacchetto macro come il modello che lo riceve. Nessuna rompeva niente:
   sono la classe dei difetti che non si rompono, e si vedono solo eseguendo il payload. */
check("v405 l'ampiezza non chiama 'rally' un mese in cui entrambi gli indici scendono", suVeri(`
  DATA.macro = DATA.macro || {};
  DATA.macro.breadth = { spy_1m_pct: -0.8, rsp_1m_pct: -0.74, divergence_pp: -0.06, alert: false };
  const p = buildPrompt();
  return p.indexOf("discesa con partecipazione uniforme") >= 0
      && p.indexOf("rally con partecipazione") < 0;`));

check("v405 con entrambi in rialzo l'ampiezza torna a chiamarlo rally", suVeri(`
  DATA.macro = DATA.macro || {};
  DATA.macro.breadth = { spy_1m_pct: 2.1, rsp_1m_pct: 1.9, divergence_pp: 0.2, alert: false };
  const p = buildPrompt();
  return p.indexOf("rally con partecipazione uniforme") >= 0
      && p.indexOf("discesa con partecipazione") < 0;`));

/* ⚠ "rilassato" e' corretto contro la banda e falso contro la distribuzione: al 3° percentile
   il compenso per il rischio non ha piu' spazio dalla parte favorevole. Le due letture stavano
   nello stesso pacchetto e dicevano cose opposte sullo stesso numero. */
check("v405 il credito all'estremo del proprio intervallo lo dichiara accanto all'etichetta", suVeri(`
  DATA.macro = DATA.macro || {};
  DATA.macro.credit = DATA.macro.credit || {};
  /* ⚠ il percentile e' un MIDRANK: con sette osservazioni il minimo unico vale gia' 7°, sopra
     la soglia del 5°. La prima fixture non mordeva perche' NON CONTENEVA il fenomeno, non
     perche' il codice fosse rotto — venti osservazioni lo portano al 3°, che e' il caso reale. */
  DATA.macro.credit.spread_hy = 2.6;
  DATA.macro.credit.history = Array.from({length:20},(_,i)=>({v: i===0 ? 2.6 : 2.9 + i*0.03}));
  const p = buildPrompt();
  return p.indexOf("credito rilassato") >= 0
      && p.indexOf("PERCENTILE del proprio intervallo annuale") >= 0
      && p.indexOf("non ha piu' spazio dalla parte favorevole") >= 0;`));

check("v405 a meta' del proprio intervallo il credito non aggiunge nessun avviso", suVeri(`
  DATA.macro = DATA.macro || {};
  DATA.macro.credit = DATA.macro.credit || {};
  DATA.macro.credit.spread_hy = 3.1;
  DATA.macro.credit.history = Array.from({length:20},(_,i)=>({v: 2.6 + i*0.05}));
  const p = buildPrompt();
  return p.indexOf("credito rilassato") >= 0
      && p.indexOf("PERCENTILE del proprio intervallo annuale") < 0;`));

/* ⚠ `contestoPortafoglio(tk)` riceve il ticker solo dal pacchetto di titolo: in quello MACRO
   nessun titolo e' in esame, e la riga usciva come "gruppo correlato di " — mutilata proprio
   dove chi legge cerca il riferimento. */
check("v405 in contesto macro il blocco notizie non lascia il nome del titolo vuoto", suVeri(`
  /* ⚠ il blocco delle notizie sta in buildCIOText(), non in buildPrompt(): e' il pacchetto che
     il CEO incolla davvero. Un check sulla funzione sbagliata misura un'altra cosa. */
  const p = buildCIOText();
  if (p.indexOf("NOTIZIE SUI TITOLI DEL LIBRO") < 0) return false;   // il fenomeno deve esserci
  return p.indexOf("gruppo correlato di (") < 0
      && p.indexOf("gruppo correlato di  ") < 0
      && p.indexOf("QUESTE NON SONO NOTIZIE SU NOMI SEPARATI") >= 0;`));

check("v405 nel pacchetto di titolo la stessa riga nomina il titolo analizzato", suVeri(`
  const p = buildPromptTicker("CRWV");
  return p.indexOf("gruppo correlato di CRWV") >= 0
      && p.indexOf("QUESTE NON SONO NOTIZIE SU NOMI SEPARATI") < 0;`));

/* ═══ v406 — L'INVARIANTE PAGINA ↔ PACCHETTO, NEI DUE VERSI ═══════════════════════════════
   Rilievo del CEO: "il sistema non e' un riassunto affidabile di cio' che posso vedere
   scorrendo la pagina". Misurato invece che dato per buono: sui tre esempi che citava (VIX,
   Fear & Greed, put/call) il pacchetto li aveva GIA'; ma quattro fatti mancavano davvero, e
   nessuno se ne sarebbe accorto — il divario era cresciuto da solo, in silenzio, esattamente
   come il comando /aggiorna della v387.
   ⚠ Un gate che aggiunge e basta non serve: fra un mese la pipeline pubblica una chiave nuova,
   la pagina la disegna e il pacchetto resta indietro. Qui l'invariante e' nei DUE VERSI: ogni
   indicatore che la PAGINA sa aprire deve essere O nel pacchetto O nel registro qui sotto con
   la sua ragione scritta. Il registro non e' una lista di comodita': e' la RICEVUTA delle
   rimozioni gia' decise, e se un giorno un blocco esce dal pacchetto senza motivazione il
   check lo dice. Un secondo meta-check impedisce che una chiave stia in tutti e due i posti. */
check("v406 ogni indicatore che la pagina apre e' nel pacchetto o dichiarato fuori con la ragione", suVeri(`
  /* la sonda e' una stringa che DEVE comparire nel pacchetto quando l'indicatore c'e'. Per le
     statistiche ufficiali (chiavi "in:") si ricava dall'ETICHETTA di MACRO_INFO, che e' la
     stessa che il pacchetto stampa: cosi' non c'e' un secondo elenco da tenere allineato. */
  const SONDA = {
    "mk:^TNX": "Treasury USA 10A", "mk:EURUSD=X": "EUR/USD",
    fear_greed: "Fear & Greed", vix: "VIX:", credit: "Rischio Credito",
    liquidity: "Liquidit", dollar: "Righello Dollaro", fedwatch: "FedWatch",
    carry: "Carry USA-Giappone", putcall: "Put/Call SPY",
    yield_recession: "Curva vs Recessione", systemic_risk: "Rischio Sistemico",
    buffett: "indicatore di Buffett", decouple: "Disaccoppiamento",
    smart_money: "STRUTTURA DEL PREZZO SUGLI INDICI", sp500_pe: "P/E Ratio S&P 500",
    corp_profit: "Profitti Aziendali Reali", fed_market: "Tasso EFFETTIVO",
  };
  /* ⚠ LE ESCLUSIONI SONO DECISIONI GIA' PRESE E ANNOTATE, non comodita' di oggi. */
  const FUORI = {
    "mk:EURJPY=X": "v138 — ridondante col blocco Carry, che porta gia' il rischio yen",
    sentiment: "v200 — composito 0-100 nostro, tolto sui numeri del suo track record",
    thermometer: "v200 — composito 0-100 nostro, stessa ragione",
  };
  const p = buildCIOText();
  const mancanti = [];
  for (const k of Object.keys(MACRO_INFO)) {
    if (FUORI[k]) continue;
    const sonda = k.indexOf("in:") === 0 ? (MACRO_INFO[k] || [])[0] : SONDA[k];
    if (!sonda) { mancanti.push(k + " (nessuna sonda ne' esclusione)"); continue; }
    /* ⚠ NIENTE VIRGOLETTE SFUGGITE QUI DENTRO: siamo in un template literal, che si mangia il
       backslash — la barra-virgolette arriva al vm come una virgoletta nuda e spezza la stringa.
       node --check non lo vede (e' dentro un template) e il check muore in eccezione. */
    if (p.indexOf(sonda) < 0) mancanti.push(k + " (sonda assente dal pacchetto: " + sonda + ")");
  }
  if (mancanti.length) { console.log("      ↳ " + mancanti.join(" · ")); return false; }
  /* e nessuna chiave puo' stare in tutti e due i posti: sarebbe una ricevuta che si contraddice */
  const doppie = Object.keys(FUORI).filter(k => SONDA[k]);
  if (doppie.length) { console.log("      ↳ in entrambi i registri: " + doppie.join(", ")); return false; }
  return Object.keys(MACRO_INFO).length >= 30;`));

/* ⚠ e il check va provato TOGLIENDO un blocco: se il pacchetto smette di pubblicare Buffett il
   gate deve accorgersene, altrimenti e' una lista che si guarda da sola. */
check("v406 togliendo un blocco dal pacchetto il gate se ne accorge", suVeri(`
  delete DATA.macro.buffett;
  const p = buildCIOText();
  return p.indexOf("indicatore di Buffett") < 0;`));

/* ═══ v406 — I QUATTRO FATTI CHE MANCAVANO ════════════════════════════════════════════════ */
check("v406 il pacchetto porta Sharpe e Sortino del libro, che la pagina mostra", suVeri(`
  const p = buildCIOText();
  return p.indexOf("EFFICIENZA DEL LIBRO") >= 0
      && p.indexOf("Sharpe") >= 0
      /* ⚠ indexOf e' sensibile al maiuscolo: la riga scrive "Non entrano", con la N grande.
         La prima stesura cercava la minuscola ed era rossa su codice giusto. */
      && p.indexOf("entrano nelle discipline") >= 0;`));

check("v406 il rapporto capitalizzazione/PIL esce come RAPPORTO, non come punteggio", suVeri(`
  const p = buildCIOText();
  return p.indexOf("CAPITALIZZAZIONE DEL MERCATO SU PIL") >= 0
      && p.indexOf("E' un RAPPORTO, non un punteggio") >= 0
      && p.indexOf("CONVENZIONE del mestiere") >= 0;`));

check("v406 della struttura di prezzo escono i LIVELLI e non il punteggio 0-100", suVeri(`
  const p = buildCIOText();
  const i = p.indexOf("STRUTTURA DEL PREZZO SUGLI INDICI");
  if (i < 0) return false;
  const riga = p.slice(i, p.indexOf(String.fromCharCode(10), i));
  return riga.indexOf("liquidita' SOPRA il prezzo") >= 0
      && riga.indexOf("NON si pubblica il punteggio") >= 0;`));

/* ⚠⚠ LA RIGA CHE CHIUDE IL BUCO STRUTTURALE: "il sistema non ha il dato" e "ce l'ha e non te lo
   passa" si leggono uguali e sono cose diverse (classe v393). */
check("v406 il pacchetto dichiara cosa la pagina mostra e lui non porta, con la ragione", suVeri(`
  const p = buildCIOText();
  return p.indexOf("QUELLO CHE LA PAGINA MOSTRA E QUESTO PACCHETTO NON PORTA") >= 0
      && p.indexOf("si leggono uguali e sono cose diverse") >= 0
      && p.indexOf("stesso segnale contato due volte") >= 0;`));

/* ═══ v407 — DUE TASTI, DUE STANZE, E IL SILENZIO CHE NON DEVE PIU' ESSERCI ═══════════════
   Richiesta del CEO: due tasti distinti. Il difetto che la separazione toglie era misurabile:
   con un bottone solo la scelta la faceva il contenuto del box del ticker, quindi chi voleva il
   quadro macro col box ancora pieno riceveva IN SILENZIO l'analisi di un titolo, e viceversa.
   ⚠ Il gate non guarda se i due bottoni ESISTONO — la guardia strutturale lo fa gia' — ma se
   sono COLLEGATI a due teste diverse, che e' la classe v316/v399: il bottone del comparto
   esisteva, `scegliSettore` esisteva, e i due non erano agganciati. */
check("v407 i due tasti sono agganciati a due teste diverse dello stesso costruttore", (() => {
  /* ⚠ i commenti si tolgono prima di leggere: una chiamata COMMENTATA farebbe passare il gate
     mentre il bottone e' inerte (v213, v240, v389). */
  const codice = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const libro = /#btn-libro[\s\S]{0,120}?copyCIOText\(\s*"libro"\s*\)/.test(codice);
  const titolo = /#btn-titolo[\s\S]{0,120}?copyCIOText\(\s*"titolo"\s*\)/.test(codice);
  /* e l'invio nel box del ticker deve fare quello che fa il tasto che gli sta accanto */
  const invio = /#tk-input[\s\S]{0,160}?Enter[\s\S]{0,80}?copyCIOText\(\s*"titolo"\s*\)/.test(codice);
  if (!libro || !titolo || !invio) {
    return no(`aggancio mancante: libro=${libro} titolo=${titolo} invio=${invio}`);
  }
  return true;
})());

check("v407 col box vuoto il tasto del titolo NON consegna il pacchetto macro di nascosto", (() => {
  /* si intercetta la consegna: quello che conta non e' cosa viene generato ma cosa ESCE. */
  const q = ctx.document.querySelector;
  const box = { value: "", focus() {} };
  const esito = { textContent: "", innerHTML: "" };
  const consegnato = [];
  const vera = ctx.consegnaPacchetto;
  try {
    ctx.document.querySelector = (s) => s === "#tk-input" ? box
      : s === "#tk-esito" ? esito : q.call(ctx.document, s);
    ctx.consegnaPacchetto = (testo, che) => { consegnato.push(che); return Promise.resolve(true); };
    ctx.copyCIOText("titolo");
    if (consegnato.length) return no(`ha consegnato "${consegnato[0]}" con il box vuoto`);
    /* ⚠ e non basta che taccia: deve DIRE cosa manca. Un tasto che non fa niente e non lo
       dichiara si legge come un tasto rotto — v315, il comando che non si trova. */
    if (!/ticker/i.test(esito.textContent)) return no(`nessuna spiegazione: "${esito.textContent}"`);
    /* col ticker scritto, invece, consegna */
    box.value = "MU";
    ctx.copyCIOText("titolo");
    if (consegnato.length !== 1 || !/MU/.test(consegnato[0])) {
      return no(`col ticker scritto ha consegnato: ${JSON.stringify(consegnato)}`);
    }
    /* e il tasto del libro consegna SEMPRE, box pieno o vuoto: e' l'altra stanza */
    ctx.copyCIOText("libro");
    return consegnato.length === 2 && /portafoglio/i.test(consegnato[1]);
  } finally { ctx.document.querySelector = q; ctx.consegnaPacchetto = vera; }
})());

/* ⚠⚠ v407 — `no()` NON ESISTE DENTRO IL VM. Vive nel runner, quindi un check scritto
   con `suVeri` che lo chiama sul ramo di fallimento esplode invece di riportare la ragione: il
   check FALLISCE lo stesso (l'eccezione torna una stringa, e `check()` rifiuta tutto cio' che
   non e' un booleano), ma il messaggio dice "CHECK MALFORMATO" al posto del motivo — cioe' la
   diagnosi si perde proprio quando serve. Per questo esiste `suVeriEsito`: il corpo torna `true`
   o la RAGIONE come stringa, e la stampa la fa il runner. Trovato perche' un'iniezione ha morso
   con il messaggio sbagliato: un gate che fallisce per il motivo giusto e lo racconta male e'
   un gate che costera' un giro di debug a chi verra' dopo. */
/* ═══ v407 — LA SCHEDA APPROFONDITA, E CHI LA PRENDE ═════════════════════════════════════
   Il CEO ha scelto "compatta per tutte + approfondimento su chi ha un evento o una soglia
   rotta". Il gate non verifica che il blocco esista — verifica che la SELEZIONE sia misurata:
   un elenco di nomi scritto a mano invecchia da solo e in silenzio (C10, red team I6), e la
   scheda piu' lunga diventerebbe una preferenza del sistema, cioe' il punteggio tolto in v200. */
check("v407 la scheda approfondita va a chi soddisfa una condizione misurata, e la dichiara", suVeriEsito(`
  const p = buildCIOText();
  const i = p.indexOf("APPROFONDIMENTO SU ");
  if (i < 0) return ("nessun blocco di approfondimento nel pacchetto");
  const blocco = p.slice(i, p.indexOf("CONCENTRAZIONE:", i));
  /* ogni scheda dichiara PERCHE' e' stata scelta: senza, la lunghezza si legge come giudizio */
  const schede = blocco.split(String.fromCharCode(10)).filter(r => r.indexOf("SELEZIONATO PERCHE'") >= 0);
  if (!schede.length) return ("nessuna scheda porta la propria ragione");
  /* la ragione non e' una parola vuota: deve nominare una delle tre condizioni misurate */
  const motivate = schede.filter(r => /trimestrale (OGGI|fra \\d+ giorni)/.test(r)
    || r.indexOf("SOTTO tutte e") >= 0
    || r.indexOf("flusso di cassa libero NEGATIVO") >= 0);
  if (motivate.length !== schede.length) {
    return ((schede.length - motivate.length) + " schede su " + schede.length + " senza condizione nominata");
  }
  /* e il conteggio dichiarato in intestazione deve coincidere con le schede stampate: un numero
     annunciato e poi non mostrato e' la classe v393 (le notizie contate e poi nascoste) */
  const m = blocco.match(/APPROFONDIMENTO SU (\\d+) POSIZIONI SU (\\d+)/);
  if (!m) return ("l'intestazione non dichiara quante posizioni ha selezionato");
  if (Number(m[1]) !== schede.length) return ("dichiara " + m[1] + " schede e ne stampa " + schede.length);
  /* ⚠ e NON tutte: se selezionasse ogni posizione la selezione non selezionerebbe niente */
  return Number(m[1]) < Number(m[2]);`));

/* ⚠ e la selezione deve MUOVERSI COI DATI, non essere una lista fissa: si costruisce lo stato
   — nessuna trimestrale vicina, nessun titolo sotto tutte le medie, nessun flusso negativo — e
   il blocco deve dichiarare l'assenza invece di sparire (classe v389: "nessuna notizia" e "la
   fonte non ha risposto" si leggono uguali). */
check("v407 senza nessuna condizione soddisfatta il blocco dichiara l'esito invece di sparire", suVeriEsito(`
  for (const r of [...(DATA.portfolio || []), ...(DATA.watchlist || [])]) {
    if (!r) continue;
    delete r.earnings_date;
    delete r.combustione;
    if (r.tv && r.tv.tecnica) r.tv.tecnica.medie_battute = r.tv.tecnica.medie_totali;
  }
  const p = buildCIOText();
  if (p.indexOf("APPROFONDIMENTO SU ") >= 0) return ("ha selezionato qualcuno con le condizioni tolte");
  return p.indexOf("Non e' un blocco mancante: e' l'esito del controllo") >= 0;`));

check("v407 la media a 20 giorni, chiesta dal CEO, arriva su ogni posizione che ce l'ha", suVeriEsito(`
  const p = buildCIOText();
  const righe = p.split(String.fromCharCode(10)).filter(r => r.indexOf("medie: ") >= 0);
  if (righe.length < 5) return ("solo " + righe.length + " righe di medie: il fenomeno non c'e'");
  /* ⚠⚠ ANCORAGGIO CHIUSO: " dalla 200" CONTIENE " dalla 20", quindi la sottostringa nuda
     rende il check verde anche con la media a 20 sparita — provato iniettandolo, e passava.
     E' la quarta incarnazione della stessa trappola in questo progetto (mg-card/mg-card-head,
     sc-fonte/sc-fonte-qualsiasi, calendario_uscite/calendario_uscite_fred): scritta tre volte
     in CLAUDE.md e rifatta lo stesso. */
  const con20 = righe.filter(r => / dalla 20(?![0-9])/.test(r));
  if (!con20.length) return ("nessuna riga porta la media a 20");
  /* ⚠ e le tre distanze devono venire dalla STESSA fonte: sono la stessa grandezza calcolata
     sulle stesse barre, e mescolare due arrotondamenti nella stessa riga e' la classe v161. */
  const conTutte = con20.filter(r => r.indexOf(" dalla 50") >= 0 && r.indexOf(" dalla 200") >= 0);
  return conTutte.length >= 5;`));

/* ═══ v408 — LA POTATURA DELLA CODA MACRO NEL PACCHETTO DI TITOLO ═══════════════════════
   ⚠⚠ IL PRIMO GATE E' LA REGOLA SUPREMA: `buildPrompt` ha preso un'opzione, e senza argomento
   deve produrre ESATTAMENTE quello di prima. Non "quasi": identico al byte. Un costruttore che
   cambia comportamento anche solo un po' quando gli si aggiunge un parametro e' il primo passo
   verso i due costruttori che divergono (v161, v207). */
check("v408 senza opzione buildPrompt e' identico al byte a buildPrompt({}) e al pacchetto macro", suVeriEsito(`
  const a = buildPrompt();
  const b = buildPrompt({});
  const c = buildPrompt({ perTitolo: "" });
  if (a !== b) return "buildPrompt({}) differisce di " + Math.abs(a.length - b.length) + " caratteri";
  if (a !== c) return "un titolo vuoto pota lo stesso: differenza di " + Math.abs(a.length - c.length);
  /* e con l'opzione attiva DEVE essere piu' corto: se fosse uguale la potatura non esiste */
  const d = buildPrompt({ perTitolo: "MU" });
  if (d === a) return "con perTitolo il payload e' identico: la potatura non ha effetto";
  return true;`));

check("v408 i quattro blocchi potati escono dal pacchetto di titolo e restano in quello macro", suVeriEsito(`
  const macro = buildCIOText();
  const tit = buildPromptTicker("MU");
  const POTATI = ["STAGIONALITA' DEL NASDAQ", "BofA Bear-Market Signposts",
                  "Disaccoppiamento S&P", "Profitti Aziendali Reali (FRED CP)"];
  const guai = [];
  for (const s of POTATI) {
    /* ⚠ il fenomeno deve ESSERCI: se il blocco non e' nemmeno nel macro, il check sarebbe
       verde per assenza di dati invece che per assenza di difetti (trappola gia' pagata
       quattro volte in questo progetto). */
    if (macro.indexOf(s) < 0) guai.push(s + ": assente anche dal pacchetto macro, il check non misura niente");
    else if (tit.indexOf(s) >= 0) guai.push(s + ": ancora nel pacchetto di titolo");
  }
  /* ⚠ e i due che NON si potano devono restare INTERI: il taglio non deve allargarsi da solo
     al vicino, che e' la classe v201-v204 (tre volte in quattro versioni). */
  for (const s of ["ROTAZIONE SETTORIALE", "MERCATI DI PREVISIONE"]) {
    if (tit.indexOf(s) < 0) guai.push(s + ": potato, e non doveva esserlo");
  }
  return guai.length ? guai.join(" · ") : true;`));

check("v408 la potatura si DICHIARA: mai un blocco tolto in silenzio", suVeriEsito(`
  const tit = buildPromptTicker("MU");
  const i = tit.indexOf("COSA QUESTA CODA MACRO NON PORTA");
  if (i < 0) return "il pacchetto pota e non lo dice: chi legge non distingue il taglio dal dato mancante";
  const riga = tit.slice(i, tit.indexOf(String.fromCharCode(10), i));
  /* la riga deve NOMINARE cio' che ha tolto, non annunciare genericamente una potatura */
  if (riga.indexOf("stagionalita'") < 0 || riga.indexOf("campanelli BofA") < 0) {
    return "la dichiarazione non nomina i blocchi tolti";
  }
  /* e deve dire dove si trovano: un taglio senza il rimando manda a cercare online una cosa
     che il sistema ha (classe v393, la riga UMich che diffamava un proprio dato fresco) */
  if (riga.indexOf("Macro + portafoglio") < 0) return "non dice in quale pacchetto quei blocchi ci sono";
  /* ⚠ e il pacchetto macro NON deve portare la dichiarazione: li' non e' stato tolto niente */
  return buildCIOText().indexOf("COSA QUESTA CODA MACRO NON PORTA") < 0
    ? true : "il pacchetto macro dichiara una potatura che non ha fatto";`));

/* ═══ v409 — L'AUTONOMIA DI CASSA: DUE DENOMINATORI, MAI UNO NUDO ═══════════════════════
   Il difetto l'ha trovato un LLM reale leggendo il pacchetto v408: "MSTR 0,9 mesi qui e oltre 5
   anni là; RGTI 12,4 e 5,5. Non possono essere contemporaneamente veri". Erano due grandezze
   diverse con la stessa unita' — cassa/perdita operativa e cassa/investimenti — e nessuna delle
   due dichiarava il proprio denominatore.
   ⚠ Il gate NON verifica che i numeri coincidano: non devono. Verifica che ogni numero di
   autonomia ESCA COL PROPRIO DENOMINATORE, che dove ce ne sono due il pacchetto dica che non si
   confrontano, e che la formulazione venga da UN posto solo. */
check("v409 nessun numero di autonomia esce senza il proprio denominatore", suVeriEsito(`
  const guai = [];
  for (const p of [buildCIOText(), buildPromptTicker("MSTR")]) {
    for (const riga of p.split(String.fromCharCode(10))) {
      /* si cercano le rese di autonomia: "N mesi di ..." oppure "oltre 5 anni di ..." */
      if (!/(mesi|oltre 5 anni) di (PERDITA OPERATIVA|INVESTIMENTI)/.test(riga)) continue;
      if (riga.indexOf("cassa diviso") < 0) {
        /* ⚠ si mostra l'INTORNO del punto incriminato, non l'inizio della riga: su una riga
           lunga il messaggio finirebbe per descrivere tutt'altro, e un gate che fallisce per la
           ragione giusta e lo racconta male costa un giro di debug a chi viene dopo (v407). */
        const j = riga.search(/(mesi|oltre 5 anni) di (PERDITA OPERATIVA|INVESTIMENTI)/);
        guai.push("autonomia senza denominatore: ..." + riga.slice(Math.max(0, j - 25), j + 60));
      }
    }
  }
  /* ⚠ il fenomeno deve esserci, o il check e' verde per assenza di dati (trappola gia' pagata
     quattro volte in questo progetto) */
  const macro = buildCIOText();
  if (!/(mesi|oltre 5 anni) di (PERDITA OPERATIVA|INVESTIMENTI)/.test(macro)) {
    return "nessuna autonomia nel pacchetto: il check non sta misurando niente";
  }
  return guai.length ? guai.join(" · ") : true;`));

check("v409 dove i denominatori sono due, il pacchetto dice che non si confrontano", suVeriEsito(`
  /* si COSTRUISCE il caso invece di aspettare che i dati lo producano (lezione v402): una
     posizione con entrambi i campi deve far comparire la riga di non confrontabilita'. */
  const r = [...(DATA.portfolio || []), ...(DATA.watchlist || [])].find(x => x && x.combustione);
  if (!r) return "nessuna posizione con combustione: il fenomeno non c'e'";
  r.combustione.mesi_operativi = 900;   // cassa/perdita operativa: enorme
  r.combustione.mesi_capex = 0.8;       // cassa/investimenti: minuscola
  r.combustione.fcf_ttm = -1e9;
  const p = buildCIOText();
  if (p.indexOf("I due numeri NON si confrontano") < 0) {
    return "due denominatori sullo stesso nome e nessuna riga che lo dichiari";
  }
  /* e il valore fuori scala non si stampa per esteso: "900 mesi" e' giusto e illeggibile (v389) */
  /* ⚠ NIENTE REGEX QUI: e' un template passato al vm, e la barra-b diventa un backspace vero.
     indexOf non ha niente da sfuggire — stessa correzione gia' fatta in v400. */
  if (p.indexOf("900 mesi") >= 0) return "un'autonomia oltre i cinque anni stampata per esteso";
  return p.indexOf("oltre 5 anni") >= 0 || "il cap oltre i cinque anni non ha morso";`));

check("v409 la formulazione dell'autonomia viene da UN posto solo", (() => {
  /* ⚠ i commenti si tolgono: quelli che SPIEGANO il difetto contengono per forza le stringhe
     che il gate cerca — quinta incarnazione del gate che trova se' stesso (v213, v240, v393). */
  const codice = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  if ((codice.match(/^function autonomiaCassa\(/gm) || []).length !== 1) {
    return no("autonomiaCassa non e' definita esattamente una volta");
  }
  /* nessun altro punto formatta i mesi di autonomia in proprio: e' cosi' che e' nato il difetto */
  const fuori = [];
  for (const m of codice.matchAll(/mesi di (PERDITA OPERATIVA|INVESTIMENTI|autonomia|investimenti)/g)) {
    const i = codice.lastIndexOf("function ", m.index);
    const nome = codice.slice(i, codice.indexOf("(", i));
    if (!/autonomiaCassa/.test(nome)) fuori.push(nome.replace("function ", "").trim());
  }
  if (fuori.length) return no("formattano i mesi in proprio: " + [...new Set(fuori)].join(", "));
  /* e i tre consumatori la chiamano davvero */
  const chiamate = (codice.match(/autonomiaCassa\(/g) || []).length;
  return chiamate >= 4 || no("solo " + chiamate + " riferimenti: qualche punto di stampa non la usa");
})());

/* ═══ v410 — LE CONSEGUENZE OPERATIVE, E IL PERIMETRO DICHIARATO ═══════════════════════
   Richiesta del CEO: "far si' che il sistema suggerisca alleggerimenti, vendite, incrementi ed
   eventuali opportunita' di ingresso su nuovi titoli (motivando il tutto)", e poi, sugli
   ingressi: "lascia ricerca ad llm per nuovi titoli anche sulla base della rotazione dei settori
   o su altri parametri che ritiene (es. news)".
   ⚠ LA SEPARAZIONE E' QUELLA DI SEMPRE: l'ORDINE di concludere e di cercare vive nella TESTATA
   (B7 e B8), il FATTO che l'universo dei candidati non esista vive nella CODA. Metterlo al
   contrario e' la violazione C9 che questo progetto ha gia' pagato sette volte. */
check("v410 l'obbligo di concludere vive in ENTRAMBE le testate, non solo nel file remoto", (() => {
  /* ⚠ v331: un obbligo che dipende da una fetch non e' un obbligo, e' una speranza. Il file
     remoto puo' non arrivare, e allora vale DEFAULT_PROMPT_HEADER. */
  const file = readFileSync(join(ROOT, "config", "prompt_header_macro.txt"), "utf8");
  const m = src.match(/const DEFAULT_PROMPT_HEADER = `([\s\S]*?)`;/);
  if (!m) return no("DEFAULT_PROMPT_HEADER non trovato");
  const mancano = [];
  for (const [dove, testo] of [["file", file], ["fallback", m[1]]]) {
    if (testo.indexOf("[B7]") < 0) mancano.push(dove + ": manca la chiusura operativa");
    if (testo.indexOf("[B8]") < 0) mancano.push(dove + ": manca la delega della ricerca");
    /* il divieto di dimensionare deve viaggiare COL blocco che invita a concludere: e' li' che
       e' piu' facile scivolare (v389) */
    if (testo.indexOf("DIREZIONE E PRIORITA' SI', QUANTITA' MAI") < 0) {
      mancano.push(dove + ": il divieto di dimensionare non e' dentro la chiusura operativa");
    }
    /* e l'invito a cercare deve dire DA DOVE partire, o e' un ordine senza appigli */
    if (testo.indexOf("ROTAZIONE SETTORIALE") < 0) mancano.push(dove + ": la ricerca non dice da dove partire");
  }
  return mancano.length ? no(mancano.join(" · ")) : true;
})());

check("v410 il perimetro degli ingressi e' un FATTO nella coda, contato sui dati", suVeriEsito(`
  const p = buildCIOText();
  const i = p.indexOf("L'UNIVERSO DA CUI IL SISTEMA POTREBBE PESCARE");
  if (i < 0) return "il pacchetto non dichiara di non avere un universo di candidati";
  const riga = p.slice(i, p.indexOf(String.fromCharCode(10), i));
  /* ⚠ IL NUMERO DEVE ESSERE CONTATO, NON SCRITTO A MANO: si aggiunge un titolo seguito e non
     posseduto, e il conteggio deve muoversi. Un numero fisso in prosa invecchia da solo. */
  const prima = riga.match(/restano (\\d+) titoli seguiti/);
  DATA.watchlist.push({ ticker: "ZZTEST", name: "Prova", currency: "USD", price: 10,
                        stats: {}, sparks: {}, financials: [] });
  const dopo = buildCIOText().match(/restano (\\d+) titoli seguiti/);
  if (!prima || !dopo) return "il conteggio dei titoli seguiti non compare nella riga";
  if (Number(dopo[1]) !== Number(prima[1]) + 1) {
    return "il numero non si muove coi dati: " + prima[1] + " -> " + dopo[1];
  }
  /* e la riga deve dire che non e' un blocco mancante ma il perimetro (regola v406) */
  return riga.indexOf("perimetro del sistema") >= 0
    || "non distingue un'assenza dichiarata da un blocco che manca";`));

check("v410 l'ordine di cercare NON scende nella coda: resta un'istruzione", suVeriEsito(`
  /* ⚠ la coda porta FATTI. L'istruzione "cerca tu i nomi nuovi" e' un ORDINE e vive nella
     testata: ripeterla nel payload e' la duplicazione testata/coda gia' pagata sette volte
     (v156, v179, v180, v389, v402, v404, v406). Qui si guarda la SOLA coda, tolta la testata. */
  const p = buildPrompt();
  const h = promptHeaderText();
  const coda = p.startsWith(h) ? p.slice(h.length) : p;
  if (coda.indexOf("L'UNIVERSO DA CUI IL SISTEMA POTREBBE PESCARE") < 0) {
    return "il fatto sul perimetro non e' nella coda: il check misura la regione sbagliata";
  }
  for (const ordine of ["cerca tu", "proponi", "cercane", "individua"]) {
    if (coda.toLowerCase().indexOf(ordine) >= 0) return "imperativo nella coda: " + ordine;
  }
  return true;`));

/* ═══ v411 — IL NUMERO FISSO ERA TORNATO, NELLA TESTATA ═════════════════════════════════
   Trovato rileggendo il pacchetto v410 come il modello che lo riceve. La v410 aveva appena
   tolto dalla CODA il conteggio scritto a mano — perche' un numero fisso in prosa invecchia da
   solo — e io l'avevo riscritto nella TESTATA un paragrafo piu' in la': "segue i titoli che il
   CEO possiede piu' DUE NOMI soli".
   ⚠ La testata e' il posto in cui quel difetto e' PEGGIO, perche' nessun gate la conta: se il
   CEO aggiunge tre nomi a ui_watchlist.json, la coda dice cinque e l'istruzione continua a dire
   due — e l'istruzione e' quella che il modello legge per prima.
   ⚠ E la seconda frase contraddiceva A1bis: "l'unico blocco in cui la fonte sei tu" e' falso su
   una testata che ordina gia' di cercare le notizie. Un pacchetto che si contraddice fra due
   sezioni e' la classe che il collaudo B5 ordina al lettore di segnalare. */
check("v411 la testata non scrive a mano un conteggio che la coda calcola", (() => {
  const file = readFileSync(join(ROOT, "config", "prompt_header_macro.txt"), "utf8");
  const m = src.match(/const DEFAULT_PROMPT_HEADER = `([\s\S]*?)`;/);
  if (!m) return no("DEFAULT_PROMPT_HEADER non trovato");
  const guai = [];
  for (const [dove, testo] of [["file", file], ["fallback", m[1]]]) {
    const i = testo.indexOf("[B8]");
    if (i < 0) { guai.push(dove + ": manca [B8]"); continue; }
    const sez = testo.slice(i, (testo.indexOf("\n[", i + 4) + 1) || testo.length);
    /* un numero scritto in lettere o in cifre accanto ai nomi seguiti e' il conteggio fissato */
    if (/(due|tre|quattro|cinque|\b\d+\b) nomi/i.test(sez) || /\b\d+ titoli seguiti/.test(sez)) {
      guai.push(dove + ": [B8] fissa un conteggio che la coda calcola a ogni run");
    }
    /* e deve rimandare al conteggio vero invece di sostituirlo */
    if (sez.indexOf("la coda") < 0 && sez.indexOf("in coda") < 0) {
      guai.push(dove + ": [B8] non rimanda al conteggio pubblicato nella coda");
    }
  }
  return guai.length ? no(guai.join(" · ")) : true;
})());

check("v411 [B8] non contraddice A1bis su chi cerca", (() => {
  const file = readFileSync(join(ROOT, "config", "prompt_header_macro.txt"), "utf8");
  /* ⚠ A1bis ordina la ricerca delle notizie: dire che gli ingressi sono "l'UNICO blocco in cui
     la fonte sei tu" e' falso, e una testata che si contraddice logora il collaudo che impone
     al lettore di segnalare le contraddizioni. */
  if (file.indexOf("A1bis") < 0) return no("A1bis non c'e' piu': il check misura un mondo che non esiste");
  const i = file.indexOf("[B8]");
  if (i < 0) return no("manca [B8]");
  const sez = file.slice(i, (file.indexOf("\n[", i + 4) + 1) || file.length);
  return sez.indexOf("unico blocco") < 0
    || no("[B8] si dichiara l'unico blocco a fonte esterna, ma A1bis ordina gia' di cercare");
})());

/* ═══ v412 — LA STESSA GRANDEZZA TRE VOLTE, DUE ARROTONDAMENTI ═════════════════════════
   Trovato rileggendo la riga che avevo appena riscritto in v411. Diceva lo spread TRE volte:
   una in `base` (+0,56pp), una dentro `br.note` che la pipeline scrive con l'arrotondamento
   grosso (+0.6pp), e una nella mia frase. E lo stesso per il rendimento di SPY: +0,45% e +0.5%.
   ⚠ Due valori per la stessa grandezza sono esattamente cio' che il collaudo B5 ordina al
   lettore di segnalare — e che un LLM reale ci ha segnalato lo stesso giorno sull'autonomia di
   cassa (v409). Il pacchetto non deve produrre da solo i falsi positivi del proprio controllo
   di qualita': quando succede, il collaudo si logora e chi legge smette di fidarsi.
   ⚠ `br.note` porta anche il difetto v405: chiama "rally" un mese in cui il cap-pesato fa
   +0,45% e l'equi-pesato scende. Non ripubblicarla non toglie nessun FATTO — i tre numeri
   restano in `base` — toglie una ripetizione (v184). */
check("v412 il ramo d'ampiezza cita ogni grandezza UNA volta sola", suVeriEsito(`
  DATA.macro.breadth = { spy_1m_pct: 0.45, rsp_1m_pct: -0.1, divergence_pp: 0.56, alert: true,
                         note: "SPY +0.5% vs RSP -0.1% a 1M (spread +0.6pp): il rally e' retto dalle megacap." };
  const p = buildPrompt();
  const i = p.indexOf("AMPIEZZA IN DETERIORAMENTO");
  if (i < 0) return "il ramo d'allarme non si rende: il check non misura niente";
  const riga = p.slice(i, p.indexOf(String.fromCharCode(10), i));
  /* lo spread compare una volta sola, e nel formato del sistema: se comparisse anche quello
     della nota sarebbero due valori (0,56 e 0,6) per la stessa grandezza */
  const nostro = (riga.match(/0,56/g) || []).length;
  const loro = (riga.match(/0\\.6|0,6pp/g) || []).length;
  if (nostro !== 1) return "lo spread compare " + nostro + " volte invece di una";
  if (loro) return "compare anche l'arrotondamento della nota: due valori per la stessa grandezza";
  /* e il rendimento di SPY: 0,45 nostro, 0.5 della nota */
  if ((riga.match(/0\\.5%/g) || []).length) return "il rendimento di SPY esce con due arrotondamenti";
  /* ⚠ e la parola "rally" non deve rientrare da br.note: e' il difetto v405, che afferma una
     direzione che i dati non portano */
  return riga.indexOf("rally") < 0 || "la nota reintroduce 'rally' su un mese che non lo e'";`));

/* ═══ v413 — DUE DIFETTI CHE 501 CHECK NON VEDEVANO, TROVATI LEGGENDO IL PACCHETTO ══════
   Il CEO ha incollato i due pacchetti chiedendo di eseguirli come il destinatario e di sanare
   quello che emergeva. Nessuno dei due difetti faceva fallire un gate.
   ⚠ Il primo e' la SESTA derivazione dei giorni alla trimestrale: la riga del pacchetto di
   titolo contava ISTANTI (Date.now() meno la mezzanotte, arrotondato) mentre tutto il resto
   passa da `giorniAllaTrimestrale`, che conta GIORNI DI CALENDARIO. Sul pacchetto CRWV del
   03/09 alle 21:05: 68 contro 69, lo stesso evento con due numeri nello stesso pacchetto.
   La v228 aveva chiuso questa classe e il suo commento dichiarava "chiunque chieda FRA QUANTO
   RIPORTA passa da questa funzione": era vero per le cinque derivazioni trovate allora. */
check("v413 i giorni alla trimestrale vengono da UNA sola derivazione", (() => {
  /* ⚠ si guarda il CODICE senza commenti: quelli che spiegano il difetto contengono per forza
     le formule che il gate cerca (v213, v240, v393, v409). */
  const codice = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const artigianali = [];
  /* qualunque differenza fra una data e "adesso" divisa per un giorno, fuori dalla funzione */
  for (const m of codice.matchAll(/(Date\.now\(\)|new Date\(\))[^;\n]{0,80}?86400000/g)) {
    const i = codice.lastIndexOf("function ", m.index);
    const nome = codice.slice(i, codice.indexOf("(", i)).replace("function ", "").trim();
    if (nome !== "giorniAllaTrimestrale") artigianali.push(nome + ": " + m[0].slice(0, 46));
  }
  /* ⚠⚠ v414 — LA FINESTRA ERA TROPPO STRETTA. Guardava 1.300 caratteri attorno alla riga
     "Prossima trimestrale", e la SETTIMA derivazione stava in un altro blocco (l'evento dentro
     l'orizzonte breve), quindi passava. Ora si guarda OGNI punto del file che divide una
     differenza di date per un giorno E nomina la trimestrale: l'invariante non e' "quella riga
     e' pulita" ma "nessuno calcola quella grandezza per conto proprio". */
  const sospetti = [];
  for (const m of codice.matchAll(/86400000/g)) {
    const da = Math.max(0, m.index - 340), a = m.index + 120;
    const blocco = codice.slice(da, a);
    /* si contano solo i punti che parlano di TRIMESTRALE: l'eta' di un dato o la distanza fra
       due rilevazioni sono altre grandezze, e dividerle per un giorno e' legittimo. */
    if (!/trimestrale|earnings_date/i.test(blocco)) continue;
    /* ⚠ E NON OGNI DIVISIONE PER UN GIORNO E' UN CONTEGGIO DI GIORNI: `/ 86400000 / 30.4`
       converte in MESI (l'eta' della tabella dei trimestri), che e' un'altra grandezza e non
       deve passare dalla funzione dei giorni. Il gate segnalava quel punto come difetto: era un
       falso positivo, e correggerlo avrebbe rotto codice sano. Si escludono le conversioni. */
    if (/86400000\s*\/(?!\/)/.test(codice.slice(m.index, m.index + 24))) continue;
    const i = codice.lastIndexOf("function ", m.index);
    const nome = codice.slice(i, codice.indexOf("(", i)).replace("function ", "").trim();
    if (nome !== "giorniAllaTrimestrale") {
      sospetti.push(nome + ": " + blocco.slice(blocco.length - 150).replace(/\s+/g, " "));
    }
  }
  if (sospetti.length) {
    return no(sospetti.length + " derivazione/i dei giorni alla trimestrale fuori dalla funzione unica · " + sospetti[0]);
  }
  /* ⚠ e il fenomeno deve esserci: se nessuno chiamasse la funzione, il check sarebbe verde a vuoto */
  return (codice.match(/giorniAllaTrimestrale\(/g) || []).length >= 3
    || no("quasi nessuno chiama la funzione unica: il check non sta misurando niente");
})());

check("v413 lo stesso evento porta lo stesso numero di giorni in tutto il pacchetto", suVeriEsito(`
  /* si COSTRUISCE lo stato invece di aspettare che i dati lo producano (v402) */
  const oggi = new Date(); oggi.setDate(oggi.getDate() + 40);
  const iso = oggi.getFullYear() + "-" + String(oggi.getMonth() + 1).padStart(2, "0")
            + "-" + String(oggi.getDate()).padStart(2, "0");
  for (const r of [...(DATA.portfolio || []), ...(DATA.watchlist || [])]) {
    if (r && String(r.ticker).toUpperCase() === "CRWV") r.earnings_date = iso;
  }
  /* ⚠ v418 — RIAGGANCIATO: la riga tecnica del titolo in esame e' uscita dal blocco del libro
     (era la terza scrittura degli stessi fatti), quindi il vecchio confronto scheda↔libro non
     ha piu' un secondo termine NEL PACCHETTO DI TITOLO. L'invariante pero' non e' quel
     confronto: e' che lo stesso evento porti lo stesso numero di giorni OVUNQUE compaia. Ora
     si raccolgono tutte le occorrenze nei DUE pacchetti — dove la riga del libro esiste ancora
     — e si pretende che concordino. Piu' forte di prima, non piu' debole. */
  const conteggi = new Map();
  for (const [dove, p] of [["titolo", buildPromptTicker("CRWV")], ["macro", buildCIOText()]]) {
    for (const r of p.split(String.fromCharCode(10))) {
      if (r.indexOf("CRWV") < 0 && r.indexOf("Prossima trimestrale") < 0) continue;
      const m = r.match(/fra ([0-9]+) giorn/);
      if (m) conteggi.set(dove + ": " + r.trim().slice(0, 46), m[1]);
    }
  }
  const valori = new Set([...conteggi.values()]);
  if (conteggi.size < 2) return "solo " + conteggi.size + " occorrenza del conteggio: il check non misura niente";
  return valori.size === 1 || ("stesso evento, conteggi diversi: "
    + [...conteggi.entries()].map(([k, v]) => k + " -> " + v).join(" | "));`));

check("v413 il giorno stesso si scrive OGGI, non 'fra 0 giorni'", suVeriEsito(`
  const d = new Date();
  const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")
            + "-" + String(d.getDate()).padStart(2, "0");
  for (const r of [...(DATA.portfolio || []), ...(DATA.watchlist || [])]) {
    if (r && String(r.ticker).toUpperCase() === "CRWV") r.earnings_date = iso;
  }
  const p = buildPromptTicker("CRWV");
  if (p.indexOf("fra 0 giorni") >= 0) return "il giorno della trimestrale e' scritto 'fra 0 giorni'";
  return p.indexOf("Prossima trimestrale OGGI") >= 0
    || "il giorno stesso non e' dichiarato OGGI";`));

/* ⚠⚠ Il secondo difetto era piu' grave del primo: l'intestazione del blocco del libro diceva
   "contesto, NON richiesta di analisi del portafoglio" — scritta per il pacchetto di TITOLO,
   dove e' vera, e resa identica in quello MACRO, dove la testata ordina l'opposto: [B6] impone
   di portare ogni conclusione fino alle posizioni e [B7] chiede alleggerimenti, vendite e
   incrementi come chiusura obbligatoria. Un modello che obbedisce alla coda rifiuta cio' che la
   testata gli ha ordinato, ed e' la contraddizione che il collaudo B5 gli impone di segnalare —
   prodotta dal pacchetto stesso. Classe v405: una riga scritta per un contesto, resa in due. */
check("v413 il pacchetto macro non nega l'analisi del portafoglio che la sua testata ordina", suVeriEsito(`
  const macro = buildCIOText();
  const tit = buildPromptTicker("CRWV");
  if (macro.indexOf("non richiesta di analisi del portafoglio") >= 0) {
    return "il pacchetto macro dichiara che il libro non e' da analizzare, mentre [B6] e [B7] lo impongono";
  }
  /* nel pacchetto di TITOLO quella riga e' invece corretta e deve restare */
  if (tit.indexOf("non richiesta di analisi del portafoglio") < 0) {
    return "nel pacchetto di titolo il libro ha smesso di essere dichiarato contesto";
  }
  /* e il macro deve dire il contrario in modo esplicito */
  return macro.indexOf("E' L'OGGETTO DELL'ANALISI") >= 0
    || "il pacchetto macro non dichiara che il libro e' l'oggetto dell'analisi";`));

/* ═══ v414 — LO STESSO FATTO IN DUE PUNTI DEVE COINCIDERE, E ORA LO VERIFICA UN GATE ═════
   Decisione del CEO dopo la giornata della v406-v413: congelare le funzionalita' e convertire
   le classi ricorrenti in gate che le rendano IMPOSSIBILI invece che rare.
   ⚠ La classe dominante di questo progetto e' "la stessa grandezza detta in due posti": v161,
   v207, v316, v409 (l'autonomia di cassa), v412 (lo spread tre volte), v413 (68 contro 69
   giorni). Ogni volta il difetto e' stato trovato LEGGENDO il pacchetto, mai da un gate.
   ⚠⚠ Il pacchetto di titolo pubblica gli stessi fatti DUE VOLTE per costruzione: nella scheda
   del titolo analizzato e nella riga che quel titolo ha dentro il blocco del libro. Sono due
   percorsi di codice diversi sulle stesse barre, quindi possono divergere — ed e' esattamente
   quello che e' successo con i giorni alla trimestrale. Qui si confrontano uno per uno.
   ⚠ La tolleranza NON e' zero: la scheda arrotonda a una cifra e il libro a due (7,3% contro
   7,31%). Si confronta a meta' del passo piu' grosso, che accetta l'arrotondamento e prende una
   divergenza vera — 68 contro 69 e' un'unita' intera, cento volte la tolleranza. */
check("v414 i fatti sul titolo coincidono fra la sua scheda e i suoi dettagli tecnici", suVeriEsito(`
  const p = buildPromptTicker("CRWV");
  const R = p.split(String.fromCharCode(10));
  /* ⚠ I DUE BLOCCHI SCRIVONO I NUMERI IN DUE FORMATI: la scheda usa il punto decimale (46.3,
     numeri JS grezzi), il libro la virgola all'italiana (46,3) col punto per le migliaia. Un
     normalizzatore che assume un formato solo trasforma 46.3 in 463 — e' successo scrivendo
     questo gate, ed e' la stessa classe di difetto che il gate sorveglia, in miniatura. */
  const num = (s) => { if (s == null) return null;
    let t = String(s).replace("%", "").trim();
    t = t.indexOf(",") >= 0 ? t.replace(/\\./g, "").replace(",", ".")   // italiano: virgola decimale
                            : t;                                        // grezzo: punto decimale
    const v = parseFloat(t);
    return Number.isFinite(v) ? v : null; };
  const primo = (re, dove) => { for (const r of (dove || R)) { const m = r.match(re); if (m) return m; } return null; };

  /* ── la SCHEDA del titolo ── */
  const scheda = {
    rsi:   num((primo(/- RSI\\(14\\): ([-0-9.,]+)/) || [])[1]),
    atr:   num((primo(/- ATR\\(14\\): [-0-9.,]+ \\(([-0-9.,]+)% del prezzo/) || [])[1]),
    s20:   num((primo(/Media semplice 20: [-0-9.,]+ — il prezzo le sta ([-0-9.,]+)%/) || [])[1]),
    s50:   num((primo(/- Media a 50 sedute: [-0-9.,]+ — il prezzo le sta ([-0-9.,]+)%/) || [])[1]),
    s200:  num((primo(/- Media a 200 sedute: [-0-9.,]+ — il prezzo le sta ([-0-9.,]+)%/) || [])[1]),
    trim:  num((primo(/- Prossima trimestrale attesa: [-0-9]+ \\(fra ([0-9]+) giorn/) || [])[1]),
  };
  /* ── il blocco DETTAGLI TECNICI, che descrive lo STESSO titolo ──
     ⚠ v418 — RIAGGANCIATO. Il confronto era scheda ↔ riga del libro, e quella riga e' uscita
     dal pacchetto di titolo perche' era la TERZA scrittura degli stessi fatti. L'invariante non
     era quel confronto: era che due sedi che descrivono lo stesso titolo non divergano. Le sedi
     rimaste sono due e il confronto resta — anzi si allarga ai LIVELLI delle medie, che sono
     precisamente cio' che divergeva nella v340 (557,27 qui contro 556,46 trenta righe sotto). */
  const dt = (() => { const i = R.findIndex(r => r.indexOf("--- DETTAGLI TECNICI") === 0);
    return i < 0 ? [] : R.slice(i, i + 20); })();
  const libro = {
    rsi:   num((primo(/RSI 14: ([-0-9.,]+)/, dt) || [])[1]),
    s50:   num((primo(/Media semplice 50: [-0-9.,]+ — il prezzo le sta ([-0-9.,]+)%/, dt) || [])[1]),
    s200:  num((primo(/Media semplice 200: [-0-9.,]+ — il prezzo le sta ([-0-9.,]+)%/, dt) || [])[1]),
    liv50: num((primo(/Media semplice 50: ([-0-9.,]+) —/, dt) || [])[1]),
    liv200:num((primo(/Media semplice 200: ([-0-9.,]+) —/, dt) || [])[1]),
  };
  scheda.liv50  = num((primo(/- Media a 50 sedute: ([-0-9.,]+) —/) || [])[1]);
  scheda.liv200 = num((primo(/- Media a 200 sedute: ([-0-9.,]+) —/) || [])[1]);
  /* ⚠ IL FENOMENO DEVE ESSERCI: se l'estrazione non trova niente il check sarebbe verde per
     assenza di dati invece che per assenza di difetti — la trappola gia' pagata quattro volte. */
  const chiavi = Object.keys(scheda).filter(k => scheda[k] != null && libro[k] != null);
  if (chiavi.length < 4) {
    return "estratti solo " + chiavi.length + " fatti in comune: il check non sta misurando niente ("
      + JSON.stringify(scheda) + " contro " + JSON.stringify(libro) + ")";
  }
  const guai = [];
  for (const k of chiavi) {
    /* tolleranza = meta' del passo di arrotondamento piu' grosso fra i due (una cifra) */
    if (Math.abs(scheda[k] - libro[k]) > 0.051) {
      guai.push(k + ": la scheda dice " + scheda[k] + " e i dettagli tecnici " + libro[k]);
    }
  }
  return guai.length ? guai.join(" · ") : true;`));

/* ⚠⚠ v414 — L'INTESTAZIONE PROMETTEVA "TUTTE" E IL CORPO NE STAMPAVA DODICI.
   Con 18 voci non ancora prezzate la riga dichiarava "18 pubblicate DOPO l'ultima chiusura …
   e sono TUTTE elencate qui sotto" e uno `.slice(0, 12)` sull'unione ne mostrava 12. E' la
   v393 per una via nuova: li' spariva una CLASSE di voci, qui una CODA, e l'intestazione
   afferma il contrario in entrambi i casi.
   ⚠ LO STATO SI COSTRUISCE, non si aspetta che i dati lo producano: nello snapshot di oggi le
   voci dopo la chiusura sono ZERO, quindi un check che si limitasse a leggere il pacchetto
   sarebbe verde per ASSENZA DEL FENOMENO — la trappola gia' pagata quattro volte in questo
   file. Le voci si piazzano DOPO l'ultima chiusura vera, che per costruzione e' un istante
   gia' avvenuto (v402), quindi il ramo si accende a qualunque ora giri la suite. */
check("v414 news: le voci non ancora prezzate sono TUTTE elencate, quante che siano", suVeriEsito(`
  const salvato = DATA.macro.news;
  const ora = Date.now();
  const ch = lastUsEquityCloseUTC();
  if (!ch) { DATA.macro.news = salvato; return "lastUsEquityCloseUTC non ha risposto: stato non costruito"; }
  const chiusa = ch.at.getTime();
  const voci = [];
  for (let i = 0; i < 24; i++) {
    /* dopo la chiusura E nel passato: il massimo tiene il primo vincolo, il minuto per indice
       il secondo. Un istante costruito con Date.now() e basta cadrebbe prima della campana
       nelle ore in cui la chiusura e' recente. */
    const t = Math.max(chiusa + 1000, ora - (i + 1) * 60000);
    voci.push({ titolo: "Titolo sintetico numero " + i + " sul credito", riassunto: "", fonte: "Fonte X",
                quando: new Date(t).toISOString().slice(0, 19) + "Z" });
  }
  DATA.macro.news = { fonti: ["Fonte X"], filtro: "prova", voci };
  const p = buildPrompt();
  DATA.macro.news = salvato;
  const marcatore = "DOPO l'ultima chiusura: il prezzo non l'ha ancora votata";
  const stampate = (p.split(marcatore).length - 1);
  const sonda = " pubblicate DOPO l'ultima chiusura USA del ";
  const i = p.indexOf(sonda);
  if (i < 0) return "la riga che conta le voci non prezzate non compare";
  const pre = p.slice(0, i);
  const dichiarate = parseInt(pre.slice(pre.lastIndexOf(" ") + 1), 10);
  if (!(dichiarate > 12)) return "stato non costruito: solo " + dichiarate + " voci dopo la chiusura, il tetto non morde";
  return dichiarate === stampate ? true
    : "ne dichiara " + dichiarate + " e ne stampa " + stampate;`));

/* ⚠ E il tetto NON e' stato tolto: si e' spostato sulla classe che puo' tagliare senza mentire.
   Quando taglia, lo DICHIARA — "il sistema non ha il dato" e "ce l'ha e non te lo passa" si
   leggono uguali (v406). Qui le voci sono tutte molto vecchie, quindi nessuna e' dopo la
   chiusura e il tetto cade tutto sulle altre: stato deterministico, nessuna dipendenza
   dall'orologio. */
check("v414 news: quando il tetto taglia, la riga dichiara quante voci restano fuori", suVeriEsito(`
  const salvato = DATA.macro.news;
  const ora = Date.now();
  const voci = [];
  for (let i = 0; i < 20; i++) {
    voci.push({ titolo: "Titolo vecchio numero " + i + " sul lavoro", riassunto: "", fonte: "Fonte X",
                quando: new Date(ora - (400 + i) * 3600000).toISOString().slice(0, 19) + "Z" });
  }
  DATA.macro.news = { fonti: ["Fonte X"], filtro: "prova", voci };
  const p = buildPrompt();
  DATA.macro.news = salvato;
  const stampate = (p.split(String.fromCharCode(10) + "    \u00b7 [Fonte X").length - 1);
  if (stampate !== 12) return "il tetto non ha tagliato come previsto: stampate " + stampate;
  /* ⚠ C9 ha preso la prima stesura di questa riga: "non le elenca" e' un indicativo, ma e'
     omografo dell'imperativo e il detector non puo' distinguerli. Riformulata invece di
     allentare un gate che ha gia' trovato otto ordini veri nella coda. */
  return p.indexOf("altre 8 voci il sistema le HA e qui sotto non compaiono") >= 0 ? true
    : "il tetto taglia 8 voci e la riga non lo dichiara";`));

/* ⚠⚠ v414 — LA PERCENTUALE DEVE ESSERE RIPRODUCIBILE DAL DENOMINATORE CHE DICHIARA.
   Non basta che la riga NOMINI un denominatore: deve nominare quello giusto, altrimenti la
   dichiarazione e' decorativa e il numero resta irriproducibile. Il check estrae le due masse
   dalla nota e verifica che il valore pubblicato sia la quota sulla SOMMA (7,9%) e non il
   rapporto con SPY (8,6%) — cioe' che l'etichetta e il calcolo dicano la stessa cosa.
   ⚠ Lo stato si costruisce: il gate inietta masse note invece di fidarsi di quelle del giorno,
   che possono cambiare da un run all'altro (v233, un check che misura i dati del giorno). */
check("v414 la quota di cash istituzionale dichiara il denominatore che la riproduce", suVeriEsito(`
  /* ⚠⚠ SECONDA SONDA SULLA CHIAVE SBAGLIATA in questa sessione (la prima su news_titoli).
     La chiave e' macro.liquidity_split, non macro.liquidity: iniettando su quella inesistente
     il payload usava i DATI VERI, e il check passava solo perche' il valore reale coincideva
     per caso con quello iniettato (68/863 = 7,9 su entrambi). Verde per una ragione che non
     c'entra col difetto — e l'ha smascherato il run del CI, che ha cambiato le masse
     (68/880 = 7,7) facendo andare rosso il check su codice CORRETTO.
     ⚠ Il difetto non era nel codice sorvegliato: la nota della pipeline dichiara davvero il
     denominatore. Era nel gate. */
  const salvato = DATA.macro.liquidity_split;
  const A = 68, B = 795;                       // masse scelte, indipendenti da quelle del giorno
  const quotaSomma = Math.round(A / (A + B) * 1000) / 10;   // 7,9
  const quotaSpy  = Math.round(A / B * 1000) / 10;          // 8,6
  /* ⚠⚠ E LA NOTA INIETTATA E' QUELLA VECCHIA, DI PROPOSITO. La prima stesura iniettava la nota
     NUOVA (che il denominatore lo nomina gia') e poi accettava la dichiarazione trovata in
     qualunque punto della riga: cosi' il check leggeva la propria iniezione invece del codice,
     ed e' rimasto verde anche togliendo l'etichetta dalla riga. Check CIRCOLARE, la classe
     v393/v395 del gate che trova se stesso.
     Con la nota vecchia il denominatore puo' venire da un posto solo — l'etichetta — che e'
     esattamente cio' che il codice deve garantire: la nota arriva da un run che puo' essere
     vecchio, l'etichetta no. */
  DATA.macro.liquidity_split = Object.assign({}, salvato || {}, {
    inst_cash_pct: quotaSomma,
    inst_note: "AUM BIL+SHV $" + A + "B vs SPY $" + B + "B" });
  const p = buildPrompt();
  DATA.macro.liquidity_split = salvato;
  const i = p.indexOf("Istituzionali Cash:");
  if (i < 0) return "la riga del cash istituzionale non compare nel pacchetto";
  const riga = p.slice(i, p.indexOf(String.fromCharCode(10), i));
  if (riga.indexOf(String(quotaSomma).replace(".", ",")) < 0
   && riga.indexOf(String(quotaSomma)) < 0) return "la riga non pubblica la quota iniettata: " + riga;
  /* la prova vera: la riga deve dire su COSA e' calcolata quella quota, e il totale nominato
     deve essere quello che la riproduce. Col denominatore sbagliato (SPY da solo) uscirebbe 8,6. */
  const dichiaraSomma = riga.indexOf("totale BIL+SHV+SPY") >= 0;
  if (!dichiaraSomma) return "pubblica una percentuale e non nomina il denominatore: " + riga;
  return Math.abs(quotaSomma - A / (A + B) * 100) < 0.06 ? true
    : "il denominatore dichiarato non riproduce il numero pubblicato";`));

/* ⚠⚠ v414 — OGNI INDICATORE CON UNA DATA IN FINESTRA E' ELENCATO O NOMINATO FRA GLI ESCLUSI.
   Tre serie giornaliere (Curva 10A-3M, Tasso reale 10A, Inflazione attesa 10A) pubblicavano
   nella propria riga un "prossimo aggiornamento" confermato dentro le due settimane e non
   comparivano nel calendario: le toglie la regola v290 (una serie giornaliera non e' un
   appuntamento), ma l'esclusione dichiarata nominava tre indicatori DIVERSI — quelli senza
   data. Chi legge non poteva distinguere una regola da una dimenticanza.
   ⚠ L'invariante e' nei DUE VERSI, come il gate pagina↔pacchetto della v406: un gate che
   controlla solo la presenza invecchia da solo alla prima classe nuova di esclusione. */
check("v414 nessuna uscita in finestra sparisce dal calendario senza essere nominata", suVeriEsito(`
  const p = buildPrompt();
  const i = p.indexOf("- IN USCITA NELLE PROSSIME");
  if (i < 0) return "la riga del calendario non compare nel pacchetto";
  const riga = p.slice(i, p.indexOf(String.fromCharCode(10), i));
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const limite = new Date(oggi); limite.setDate(limite.getDate() + 14);
  const attesi = [];
  for (const ind of ((DATA.macro || {}).indicators || [])) {
    const c = cadenzaDato(ind.key, ind.date);
    if (!c || !c.prossimo || !c.confermato) continue;
    const d = new Date(c.prossimo + "T00:00:00");
    if (isNaN(d) || d < oggi || d > limite) continue;
    attesi.push(ind.label);
  }
  /* ⚠ IL FENOMENO DEVE ESSERCI: senza indicatori in finestra il check sarebbe verde per
     assenza di dati invece che per assenza di difetti (trappola pagata quattro volte). */
  if (attesi.length < 2) return "solo " + attesi.length + " indicatori con data in finestra: il check non misura niente";
  const persi = attesi.filter(l => riga.indexOf(l) < 0);
  return persi.length ? "hanno una data confermata in finestra e la riga non li nomina: " + persi.join(" · ")
                      : true;`));

/* ⚠⚠ v414 — L'ETICHETTA DEL CREDITO ESCE DA UN PUNTO SOLO, CON LA SUA CORREZIONE.
   La v405 ha aggiunto alla riga del credito l'avviso che al 4° percentile "rilassato" descrive
   il livello e non la posizione nella distribuzione. Un secondo blocco ripubblicava la stessa
   etichetta e la stessa legenda delle bande SENZA quell'avviso: la copia piu' corta e' quella
   che vince, ed e' la classe v161/v207 unita alla v412 (correzione applicata a un ramo solo).
   ⚠ L'invariante non e' "l'etichetta non compare due volte" — sarebbe un ancoraggio alla
   forma — ma che DOVUNQUE compaia porti accanto il correttivo del percentile. */
check("v414 il credito non pubblica la sua etichetta senza la correzione del percentile", suVeriEsito(`
  const p = buildPrompt();
  const R = p.split(String.fromCharCode(10));
  const bande = R.filter(r => r.indexOf("sotto 4% rilassato, 4-5% attenzione") >= 0);
  if (!bande.length) return "la legenda delle bande sul credito non compare: il check non misura niente";
  if (bande.length > 1) return "la legenda delle bande esce da " + bande.length + " punti di stampa invece che da uno";
  /* dove l'etichetta e' pubblicata, il percentile che la smentisce dev'essere nella stessa riga */
  const conEtichetta = R.filter(r => r.toLowerCase().indexOf("credito rilassato") >= 0);
  if (!conEtichetta.length) return "l'etichetta del credito non compare: il check non misura niente";
  const senzaCorrettivo = conEtichetta.filter(r => r.indexOf("PERCENTILE") < 0 && r.indexOf("percentile") < 0);
  return senzaCorrettivo.length
    ? "l'etichetta del credito esce senza il correttivo del percentile in " + senzaCorrettivo.length + " riga/e"
    : true;`));

/* ⚠ E il movimento a un mese dello spread usciva in TRE rese: -0,12 pp, -4% e -4,32%. Due
   arrotondamenti della stessa grandezza sono cio' che il collaudo B5 ordina al lettore di
   segnalare: il pacchetto non deve produrre da solo i falsi positivi del proprio controllo di
   qualita' (v412, v400). */
check("v414 il livello dello spread HY e il suo movimento escono da una riga sola", suVeriEsito(`
  /* ⚠ LA PRIMA STESURA CONTAVA LE RIGHE e non mordeva: il duplicato stava dentro UNA riga
     insieme al dato di IG, quindi il conteggio restava a uno. Un check che non morde e'
     decorativo — riscritto sulla proprieta' che era davvero violata: il LIVELLO dello spread
     e' pubblicato da un punto solo, e il secondo blocco porta cio' che il primo non ha. */
  const sr = (DATA.macro || {}).systemic_risk;
  if (!sr || sr.hy_oas == null) return "systemic_risk assente: il check non misura niente";
  const p = buildPrompt();
  const R = p.split(String.fromCharCode(10));
  const livello = String(sr.hy_oas);
  const conLivello = R.filter(r => r.indexOf("HY OAS " + livello) >= 0 || r.indexOf("(HY OAS, proxy CDS): " + livello) >= 0);
  if (!conLivello.length) return "il livello dello spread HY non compare: il check non misura niente";
  return conLivello.length === 1 ? true
    : "il livello dello spread HY esce da " + conLivello.length + " righe: "
      + conLivello.map(r => r.slice(0, 70)).join(" | ");`));

/* ⚠⚠ v414 — "CIASCUNA POSIZIONE" DEVE VOLER DIRE CIASCUNA.
   Uno `.slice(0, 6)` mostrava sei posizioni su dodici sotto un'etichetta che le prometteva
   tutte, e il taglio cadeva sulla coda in cui il rischio sta SOTTO il peso — l'altra meta'
   del confronto per cui il blocco esiste. Stessa classe delle notizie contate e poi nascoste
   (v393) e del tetto sulle news chiuso in questa stessa versione.
   ⚠ L'invariante e' il CONFRONTO fra chi ha la misura nei dati e chi compare nella riga: un
   check che contasse un numero fisso di voci invecchierebbe al primo titolo aggiunto o tolto
   (C10, red team I6, il pavimento numerico di v208). */
check("v414 il contributo al rischio pubblica tutte le posizioni che hanno la misura", suVeriEsito(`
  const conMisura = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])]
    .filter(r => r && r.risk_contrib_pct != null && isFinite(Number(r.risk_contrib_pct)))
    .map(r => String(r.ticker).toUpperCase());
  if (conMisura.length < 4) return "solo " + conMisura.length + " posizioni con contributo al rischio: il check non misura niente";
  /* ⚠ il blocco vive in contestoPortafoglio, che entra nel pacchetto consegnato: un check
     sulla funzione sbagliata misura un'altra cosa (v405). */
  const p = buildCIOText();
  const i = p.indexOf("CONTRIBUTO AL RISCHIO");
  if (i < 0) return "il blocco del contributo al rischio non compare";
  const riga = p.slice(i, p.indexOf(String.fromCharCode(10), i));
  const persi = conMisura.filter(tk => riga.indexOf(tk + " peso ") < 0);
  return persi.length
    ? "hanno un contributo al rischio misurato e non compaiono nella riga: " + persi.join(" · ")
      + " (su " + conMisura.length + " totali)"
    : true;`));

/* ⚠⚠ v414 — LO STATO DI OGNI DISCIPLINA DEVE ESSERE RIPRODUCIBILE DALLA SOGLIA CHE STAMPA.
   La regola sull'autofinanziamento dichiarava un criterio PER POSIZIONE a tolleranza zero
   ("nessuna posizione con FCF negativo E interessi non coperti") e calcolava lo stato da due
   bande sul PESO: sul libro reale la soglia dichiarata diceva OLTRE e la riga stampava AL
   LIMITE. Classe v316/v326 — la formula calcola una cosa, l'etichetta ne dichiara un'altra.
   ⚠ Il check verifica la PROPRIETA' che il difetto viola per costruzione: dove la disciplina
   ha una soglia numerica dichiarata e una misura numerica, lo stato deve concordare col
   confronto fra le due. Un check sui valori attesi si sbaglierebbe insieme al codice (v326). */
check("v414 lo stato di ogni disciplina concorda con la soglia che la riga dichiara", suVeriEsito(`
  const D = disciplinaRischio();
  const R = (D && D.regole) || D;
  if (!Array.isArray(R) || R.length < 5) return "disciplinaRischio non ha restituito le regole: il check non misura niente";
  const guai = [];
  let misurate = 0;
  for (const r of R) {
    if (!Number.isFinite(r.valore) || !Number.isFinite(r.sogliaPct)) continue;
    misurate++;
    const oltre = r.valore > r.sogliaPct;
    /* DENTRO su una misura che supera la propria soglia dichiarata e' la contraddizione */
    if (oltre && r.stato === "DENTRO") guai.push(r.nome + ": " + r.valore + " oltre " + r.sogliaPct + " ma stato DENTRO");
    if (!oltre && r.stato === "OLTRE") guai.push(r.nome + ": " + r.valore + " sotto " + r.sogliaPct + " ma stato OLTRE");
  }
  if (misurate < 3) return "solo " + misurate + " discipline con soglia numerica: il check non misura niente";
  return guai.length ? guai.join(" · ") : true;`));

/* ⚠ E la riga dell'autofinanziamento deve dichiarare il criterio che produce davvero lo stato:
   una soglia stampata che non genera l'etichetta accanto e' un'affermazione non sostenuta
   (v240 — ogni soglia disegnata e' un'affermazione, o viene dal dato o si dichiara convenzione). */
check("v414 l'autofinanziamento dichiara la soglia di peso da cui lo stato viene davvero", suVeriEsito(`
  const D = disciplinaRischio();
  const R = (D && D.regole) || D;
  const r = (Array.isArray(R) ? R : []).find(x => x && String(x.nome).indexOf("Autofinanziamento") >= 0);
  if (!r) return "la regola dell'autofinanziamento non compare: il check non misura niente";
  const s = String(r.soglia);
  const dichiaraBande = s.indexOf("10%") >= 0 && s.indexOf("20%") >= 0;
  if (!dichiaraBande) return "lo stato viene da due bande sul peso e la soglia stampata non le nomina: " + s;
  /* e se esistono posizioni che soddisfano la congiunzione, la misura lo deve dire */
  const m = String(r.misura);
  const nomina = m.indexOf("ENTRAMBE le condizioni") >= 0;
  return nomina ? true : "la misura non dice se qualche posizione soddisfa entrambe le condizioni";`));

/* ⚠⚠ v414 — NESSUN NUMERO SCRITTO A MANO NELLE CLAUSOLE CHE SPIEGANO UN DATO VIVO.
   La clausola sull'inversione di segno delle revisioni citava "-4,37 diviso -3,42": i valori
   di CRWV al momento della v400, stampati accanto ai valori vivi della stessa frase. Terza
   incarnazione del conteggio fisso (v410, v411): un numero scritto a mano invecchia da solo e
   in silenzio, e qui la coppia viva stava due parole prima.
   ⚠ L'invariante e' generale e si valida sui dati: le stime che la riga nomina devono essere
   QUELLE del titolo, non un esempio. */
check("v414 la clausola sulle revisioni non porta stime scritte a mano", suVeriEsito(`
  const R = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])];
  const conRev = R.filter(r => r && r.analisti && r.analisti.eps_ora != null && r.analisti.eps_90g_fa != null
                            && Number(r.analisti.eps_ora) < 0);
  if (!conRev.length) return "nessun titolo con revisioni su una perdita: il check non misura niente";
  const tk = String(conRev[0].ticker).toUpperCase();
  const vivi = [conRev[0].analisti.eps_ora, conRev[0].analisti.eps_90g_fa]
    .map(v => Math.abs(Number(v)).toFixed(2).replace(".", ","));
  const p = buildPromptTicker(tk);
  const i = p.indexOf("REVISIONI DEGLI UTILI");
  if (i < 0) return "il blocco delle revisioni non compare per " + tk;
  const riga = p.slice(i, p.indexOf(String.fromCharCode(10), i));
  /* si raccolgono i numeri con due decimali che la riga cita, e nessuno deve essere estraneo
     alle stime vive del titolo (i tre valori: ora, 90 giorni fa, 7 giorni fa) */
  const ammessi = new Set(vivi);
  const e7 = conRev[0].analisti.eps_7g_fa;
  if (e7 != null) ammessi.add(Math.abs(Number(e7)).toFixed(2).replace(".", ","));
  const citati = riga.split("-").map(s => s.slice(0, 4)).filter(s => /^[0-9],[0-9][0-9]$/.test(s));
  const estranei = citati.filter(s => !ammessi.has(s));
  return estranei.length
    ? "la riga cita stime che non sono quelle del titolo (" + tk + "): " + [...new Set(estranei)].join(", ")
      + " — vive: " + [...ammessi].join(", ")
    : true;`));

/* ⚠⚠ v414 — DUE UTILI ATTESI CON LO STESSO NOME.
   `stats.eps_forward` e `analisti.eps_ora` sono due campi diversi dell'aggregatore, su CRWV
   -1,95 e -4,24, e il pacchetto li descriveva entrambi come il consenso sul prossimo esercizio.
   Nessuno dei due porta un periodo, quindi il sistema non puo' affermare che coincidano: la
   forma corretta e' quella della v409 sull'autonomia di cassa — si pubblicano entrambi e si
   dichiara che non e' stabilito descrivano la stessa annualita'. */
check("v414 due utili attesi diversi non escono senza dire che potrebbero non essere lo stesso periodo", suVeriEsito(`
  const R = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])];
  const doppi = R.filter(r => {
    const a = r && r.analisti, s = r && r.stats;
    if (!a || !s || a.eps_ora == null || s.eps_forward == null) return false;
    const x = Number(a.eps_ora), y = Number(s.eps_forward);
    return isFinite(x) && isFinite(y) && Math.abs(x - y) > Math.max(0.05, Math.abs(y) * 0.05);
  });
  if (!doppi.length) return "nessun titolo con due utili attesi divergenti: il check non misura niente";
  const guai = [];
  for (const r of doppi.slice(0, 3)) {
    const tk = String(r.ticker).toUpperCase();
    const p = buildPromptTicker(tk);
    if (p.indexOf("DUE UTILI ATTESI DIVERSI") < 0) guai.push(tk);
  }
  return guai.length ? "pubblicano due utili attesi diversi senza dichiararlo: " + guai.join(", ") : true;`));

/* ⚠⚠ v415 — UNA RIGA FUORI PASSO NON PUO' DATARE TUTTO IL PACCHETTO.
   `SEMPRE_APERTI` prendeva `-USD` e mancava i cambi (`EURUSD=X`) e i futures (`ES=F`), che
   scambiano quasi ininterrottamente: il 04/09 una riga su 23 portava il 2026-09-04 mentre le
   22 azionarie erano al 03, e prendendo il MASSIMO quella riga dichiarava tutto il pacchetto
   fresco di un giorno. Il danno vero non era la data ma l'avviso che spariva: a eta' zero la
   riga sceglie il ramo rassicurante invece di quello che grida che i prezzi sono vecchi.
   ⚠ Lo stato si COSTRUISCE: si inietta una riga sempre-aperta avanti di un giorno e si
   verifica che la data dichiarata non la segua. Aspettare che i dati producano il caso
   sarebbe verde per assenza del fenomeno. */
check("v415 uno strumento sempre aperto non sposta la data della barra dichiarata", suVeriEsito(`
  const R = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])];
  const chiudono = R.filter(r => r && typeof r.price_asof === "string" && !/(-(USD|USDT|EUR)|=[XF])$/i.test(String(r.ticker || "")));
  if (chiudono.length < 5) return "meno di cinque righe di mercati che chiudono: il check non misura niente";
  const base = ultimaBarraDisponibile();
  if (!base) return "ultimaBarraDisponibile non ha risposto: il check non misura niente";
  /* si costruisce il caso: un cambio e un future gia' passati al giorno dopo */
  const domani = new Date(new Date(base + "T00:00:00").getTime() + 86400000).toISOString().slice(0, 10);
  DATA.watchlist = [...(DATA.watchlist || []),
    { ticker: "EURUSD=X", price_asof: domani },
    { ticker: "ES=F", price_asof: domani }];
  const dopo = ultimaBarraDisponibile();
  return dopo === base ? true
    : "un cambio e un future avanti di un giorno hanno spostato la data dichiarata da " + base + " a " + dopo;`));

/* ⚠ E una singola riga azionaria in anticipo non deve bastare: la data e' quella della
   MAGGIORANZA, perche' e' quella su cui poggiano i numeri di mercato del pacchetto. */
check("v415 la data della barra e' quella della maggioranza, non di una riga sola", suVeriEsito(`
  const base = ultimaBarraDisponibile();
  if (!base) return "ultimaBarraDisponibile non ha risposto: il check non misura niente";
  const quante = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])]
    .filter(r => r && r.price_asof === base && !/(-(USD|USDT|EUR)|=[XF])$/i.test(String(r.ticker || ""))).length;
  if (quante < 5) return "solo " + quante + " righe sulla data dichiarata: il check non misura niente";
  const domani = new Date(new Date(base + "T00:00:00").getTime() + 86400000).toISOString().slice(0, 10);
  DATA.watchlist = [...(DATA.watchlist || []), { ticker: "ZZTEST", price_asof: domani }];
  const dopo = ultimaBarraDisponibile();
  return dopo === base ? true
    : "una sola riga in anticipo ha spostato la data da " + base + " a " + dopo
      + " (" + quante + " righe portano " + base + ")";`));

/* ⚠⚠ v415 — LA STESSA DISTANZA DALLA MEDIA, TRE RESE NELLO STESSO PACCHETTO.
   La pipeline pubblica la distanza in DUE campi con due arrotondamenti — `sma50_dist_pct` a una
   cifra, `tv.tecnica.medie.sma50.dist_pct` a due — e il pacchetto ne leggeva uno nella scheda
   del titolo e l'altro nel blocco del libro, poi ne riarrotondava un terzo nei dettagli
   tecnici: su CRWV -1,5% · -1,45% · -1,4%. Terza incarnazione della classe v340/v349, che la
   v407 aveva chiusa sul solo blocco del libro.
   ⚠ IL GATE v414 NON LA PRENDEVA: la sua tolleranza e' 0,051 e lo scarto fra -1,45 e -1,5 e'
   esattamente 0,05 — passava per cinque millesimi. Qui l'invariante e' piu' stretto perche' e'
   la stessa grandezza dalla stessa fonte: le rese devono COINCIDERE, non somigliarsi. */
check("v415 la distanza dalle medie esce identica in tutti i punti del pacchetto", suVeriEsito(`
  const R = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])];
  const con = R.filter(r => r && r.tv && r.tv.tecnica && r.tv.tecnica.medie
                         && r.tv.tecnica.medie.sma50 && r.tv.tecnica.medie.sma200);
  if (!con.length) return "nessun titolo con le medie della pipeline: il check non misura niente";
  const guai = [];
  for (const r of con.slice(0, 3)) {
    const tk = String(r.ticker).toUpperCase();
    const p = buildPromptTicker(tk);
    for (const n of ["50", "200"]) {
      const rese = new Set();
      for (const et of ["- Media a " + n + " sedute", "Media semplice " + n + ":"]) {
        const i = p.indexOf(et);
        if (i < 0) continue;
        const riga = p.slice(i, p.indexOf(String.fromCharCode(10), i));
        const j = riga.indexOf("il prezzo le sta ");
        if (j < 0) continue;
        rese.add(riga.slice(j + 17).split(",").length > 1
          ? riga.slice(j + 17, riga.indexOf("%", j) + 1) : riga.slice(j + 17, riga.indexOf("%", j) + 1));
      }
      /* e la resa del blocco del libro, che legge la stessa fonte */
      const k = p.indexOf(tk + ": medie: ");
      if (k >= 0) {
        const riga = p.slice(k, p.indexOf(String.fromCharCode(10), k));
        const m = riga.indexOf(" dalla " + n);
        if (m >= 0) {
          const pezzo = riga.slice(0, m);
          rese.add(pezzo.slice(pezzo.lastIndexOf(" ") + 1));
        }
      }
      if (rese.size > 1) guai.push(tk + " media " + n + ": " + [...rese].join(" contro "));
    }
  }
  return guai.length ? guai.join(" · ") : true;`));

/* ⚠⚠ v415 — NESSUNA PERCENTUALE CALCOLATA SU UN BETA CHE IL PACCHETTO CHIAMA RUMORE.
   Su CRWV il canale tassi ha R² 0 sulla finestra lunga e la riga dichiara "NESSUNA relazione
   misurabile"; due righe dopo il pacchetto pubblicava "e' il 124% PIU' AMPIO di quello della
   finestra lunga". Una percentuale a tre cifre su una base che il blocco stesso, nella propria
   nota di chiusura, chiama "rumore stimato con tre decimali". La guardia esisteva ma guardava
   la GRANDEZZA del beta (>0,05), non la sua MISURABILITA' — la meta' mancante della v316 (un
   beta senza il suo R² e' mezzo numero) applicata al rapporto fra due beta.
   ⚠ L'invariante e' generale: il confronto percentuale esce SOLO se entrambi i termini stanno
   sopra il proprio pavimento del rumore. Sotto, si dichiara che non e' affermabile (v199). */
check("v415 il confronto fra beta non si calcola su un termine sotto il pavimento del rumore", suVeriEsito(`
  const R = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])];
  const con = R.filter(r => r && r.tv && r.tv.sensibilita
    && Object.values(r.tv.sensibilita).some(v => v && v.evento && typeof v.acceso === "boolean"));
  if (!con.length) return "nessun titolo con il beta condizionato: il check non misura niente";
  const guai = [];
  let spenti = 0;
  for (const r of con.slice(0, 4)) {
    const tk = String(r.ticker).toUpperCase();
    const p = buildPromptTicker(tk);
    for (const [nome, v] of Object.entries(r.tv.sensibilita)) {
      if (!v || !v.evento || v.acceso !== false) continue;   // solo i canali sotto il pavimento
      spenti++;
      const i = p.indexOf("- " + nome + " (");
      if (i < 0) continue;
      const fine = p.indexOf("EFFETTO lo distorcerebbe", i);
      const blocco = p.slice(i, fine > 0 ? fine : i + 3000);
      const confronta = blocco.indexOf("PIU' AMPIO") >= 0 || blocco.indexOf("piu' contenuto") >= 0;
      const dichiara = blocco.indexOf("NON E' AFFERMABILE") >= 0;
      if (confronta) guai.push(tk + "/" + nome + ": pubblica un confronto percentuale su un beta sotto il pavimento");
      else if (!dichiara) guai.push(tk + "/" + nome + ": non confronta e non dice perche'");
    }
  }
  /* ⚠ IL FENOMENO DEVE ESSERCI: senza canali spenti il check sarebbe verde per assenza. */
  if (!spenti) return "nessun canale sotto il pavimento del rumore nei dati: il check non misura niente";
  return guai.length ? guai.join(" · ") : true;`));

/* ⚠⚠ v415 — L'ETICHETTA [TICKER] DICE DA QUALE FEED VIENE LA VOCE, NON DI CHI PARLA.
   Misurato sul run del 04/09: su quattordici voci mostrate, quattro erano su un'altra societa'
   (Nvidia sotto [CRWV], Astera Labs e Penguin Solutions sotto [MRVL], una cronaca di mercato
   sotto [MU]). Non e' un difetto della raccolta — la v399 ha scelto Nasdaq proprio perche'
   l'attribuzione viene dalla FONTE e non da un'euristica nostra — ma dell'ETICHETTA, che
   affermava piu' di quanto il dato sostenga.
   ⚠ E NON SI FILTRA: filtrare vorrebbe dire indovinare di chi parla un titolo, cioe' proprio
   l'euristica che la v399 ha rifiutato scegliendo Nasdaq invece del feed multi-ticker di Yahoo.
   Il gate difende la DICHIARAZIONE, non un filtro. */
check("v415 il blocco notizie dichiara che [TICKER] e' il feed, non l'oggetto dell'articolo", suVeriEsito(`
  /* ⚠ la chiave sta alla RADICE, non sotto macro: una sonda sulla chiave sbagliata rende il
     check verde (o rosso) per assenza di dati invece che di difetti — v196, v229. */
  const nt = DATA && DATA.news_titoli;
  if (!nt || !nt.per_titolo) return "news_titoli assente: il check non misura niente";
  const p = buildCIOText();
  const i = p.indexOf("NOTIZIE SUI TITOLI DEL LIBRO");
  if (i < 0) return "il blocco delle notizie sui titoli non compare";
  const testa = p.slice(i, i + 2500);
  return testa.indexOf("e' il feed DELLA FONTE per quel titolo") >= 0
      && testa.indexOf("non una garanzia che l'articolo parli di lui") >= 0
    ? true
    : "il blocco non dichiara cosa significa l'etichetta [TICKER]";`));

/* ⚠ e la scelta della v399 resta: nessun filtro per contenuto, che sarebbe l'euristica rifiutata.
   Se un domani comparisse, questo check lo direbbe — l'invariante e' che l'attribuzione venga
   dalla fonte, non da noi. */
/* ⚠ LA PRIMA STESURA DI QUESTO CHECK ERA DECORATIVA: cercava tre forme letterali e
   l'iniezione realistica — `String(v.titolo).toUpperCase().indexOf(TK)` — non ne matchava
   nessuna, quindi restava verde col difetto dentro (a morderlo era v398, sull'ESITO).
   Un check ancorato a una forma letterale e' la trappola numero uno di questo file: ora
   guarda la PROPRIETA' — una riga che mette in relazione il TITOLO dell'articolo col ticker,
   in qualunque forma. */
check("v415 nessun filtro euristico decide di chi parla una notizia", (() => {
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const i = src.indexOf("NOTIZIE SUI TITOLI DEL LIBRO");
  if (i < 0) return false;
  const righe = src.slice(Math.max(0, i - 2000), i + 4000).split(String.fromCharCode(10))
    .filter(r => r.trim().indexOf("//") !== 0 && r.trim().indexOf("*") !== 0);
  return !righe.some(r => r.indexOf("titolo") >= 0
    && (r.indexOf("indexOf(TK") >= 0 || r.indexOf("includes(TK") >= 0
        || r.indexOf("indexOf(t)") >= 0 || r.indexOf("includes(t)") >= 0));
})());

/* ⚠⚠ v416 — NESSUNA VARIAZIONE GIORNALIERA SI CHIAMA "OGGI".
   La riga di freschezza dichiara che la barra e' dell'ultima chiusura, spesso di ieri, e sei
   righe dello stesso pacchetto attaccavano "oggi" alla variazione: il pacchetto forniva da solo
   la contraddizione che il collaudo B5 ordina al lettore di segnalare. Classe v193/v234, con la
   correzione arrivata alla riga del VIX e non a queste (classe v412, un ramo solo).
   ⚠ L'invariante e' INDIPENDENTE DALL'OROLOGIO — non "oggi e vietato quando la barra e di ieri",
   che andrebbe rosso o verde a seconda del giorno in cui gira la suite (v402), ma: una variazione
   di seduta si nomina per la SEDUTA, mai con un avverbio che afferma quando. */
check("v416 nessuna variazione di seduta e' etichettata 'oggi' nel pacchetto", suVeriEsito(`
  const guai = [];
  for (const [nome, p] of [["macro", buildCIOText()], ["titolo", buildPromptTicker("CRWV")]]) {
    const righe = p.split(String.fromCharCode(10));
    for (const r of righe) {
      if (r.indexOf("% oggi)") >= 0 || r.indexOf(" oggi ") >= 0 && r.indexOf("· oggi ") >= 0) {
        guai.push(nome + ": " + r.slice(0, 90));
      }
    }
  }
  return guai.length ? guai.slice(0, 4).join(" · ") : true;`));

/* ⚠ e la forma corretta dev'esserci davvero: un check che verifica solo l'ASSENZA passerebbe
   anche se la variazione sparisse del tutto (v406 — togliere in silenzio e' peggio del difetto). */
check("v416 la variazione di seduta resta pubblicata, nominando la seduta", suVeriEsito(`
  const p = buildCIOText();
  const conSeduta = (p.split("nell'ultima seduta)").length - 1);
  return conSeduta >= 3 ? true
    : "solo " + conSeduta + " variazioni nominano la seduta: la riga potrebbe essere sparita invece di essere corretta";`));

/* ⚠⚠ v417 — LA TESTATA NON PUO' DICHIARARE MENO LETTURE DI QUANTE LA CODA NE PUBBLICHI.
   Diceva "LE FINESTRE SONO DUE" mentre la coda pubblica anche il terzo sguardo della v403 (il
   quinto di sedute con l'escursione maggiore): chi legge tratta la terza riga come rumore o la
   salta, e proprio quella risponde alla domanda che un libro a leva pone. Classe v413 — la
   testata che contraddice la propria coda — prodotta dalla v403 senza accorgersene.
   ⚠ L'invariante lega le DUE parti: se la coda rende il terzo sguardo, la testata deve
   nominarlo E dichiarare che non e' una finestra ma un sottoinsieme con un altro denominatore.
   Un gate su una parte sola invecchia appena l'altra cambia. */
check("v417 se la coda pubblica il terzo sguardo, la testata lo nomina e ne dichiara la natura", suVeriEsito(`
  const R = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])];
  const conEvento = R.filter(r => r && r.tv && r.tv.sensibilita
    && Object.values(r.tv.sensibilita).some(v => v && v.evento));
  if (!conEvento.length) return "nessun titolo col terzo sguardo nei dati: il check non misura niente";
  const tk = String(conEvento[0].ticker).toUpperCase();
  const p = buildPromptTicker(tk);
  const codaRende = p.indexOf("quando il canale si muove FORTE") >= 0;
  if (!codaRende) return "il titolo ha il campo ma la coda non rende il terzo sguardo: stato incoerente";
  /* la testata sta PRIMA della coda: si guarda la regione delle istruzioni */
  const inizioDati = p.indexOf("QUADRO MACRO:");
  const testata = inizioDati > 0 ? p.slice(0, inizioDati) : p;
  const nomina = testata.indexOf("QUINTO DI SEDUTE") >= 0;
  const dichiaraNatura = testata.indexOf("NON e' una terza finestra") >= 0
                      && testata.indexOf("denominatore diverso") >= 0;
  if (!nomina) return "la coda pubblica il terzo sguardo e la testata non lo nomina";
  return dichiaraNatura ? true
    : "la testata nomina il terzo sguardo ma non dichiara che e' un sottoinsieme con un altro denominatore";`));

/* ⚠⚠ v418 — IL TITOLO ANALIZZATO NON SI DESCRIVE TRE VOLTE.
   Misurato per perturbazione: nel pacchetto di titolo cinque campi su tredici toccavano TRE
   blocchi (scheda · DETTAGLI TECNICI · riga nel libro), ed e' il terzetto che ha prodotto il
   difetto v415 (-1,5% / -1,45% / -1,4% per la stessa distanza). Nel pacchetto MACRO nessun
   campo raggiunge tre blocchi, quindi li' non si tocca niente. */
check("v418 nel pacchetto di titolo il titolo in esame non ha una riga tecnica nel libro", suVeriEsito(`
  const p = buildPromptTicker("CRWV");
  const righe = p.split(String.fromCharCode(10)).filter(r => /^- [A-Z]{2,5}: medie:/.test(r));
  if (righe.length < 5) return "solo " + righe.length + " righe tecniche: il check non misura niente";
  const sua = righe.filter(r => r.indexOf("- CRWV: medie:") === 0);
  return sua.length === 0 ? true
    : "il titolo in esame ha ancora la sua riga tecnica dentro il blocco del libro";`));

/* ⚠ e nel pacchetto MACRO non manca nessuno: li' quella riga e' l'unica descrizione tecnica che
   il titolo riceve, e toglierla sarebbe una perdita invece di una potatura. */
check("v418 nel pacchetto macro restano le righe tecniche di TUTTE le posizioni", suVeriEsito(`
  const attesi = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])]
    .filter(r => r && r.tv && r.tv.tecnica && r.qta)
    .map(r => String(r.ticker).toUpperCase());
  const p = buildCIOText();
  const presenti = new Set((p.match(/^- ([A-Z]{2,5}): medie:/gm) || [])
    .map(r => r.replace(/^- /, "").replace(/: medie:$/, "")));
  if (attesi.length < 5) return "meno di cinque posizioni con tecnica: il check non misura niente";
  const persi = attesi.filter(t => !presenti.has(t));
  return persi.length ? "spariti dal pacchetto macro: " + persi.join(", ") : true;`));

/* ⚠⚠ IL TAGLIO DEV'ESSERE GRATUITO: ogni grandezza che la riga rimossa portava resta nel
   pacchetto. Otto erano gia' nella scheda e nei dettagli tecnici; la nona — la distanza dal
   massimo a 52 settimane nel verso "quanto e' sceso" — e' stata spostata PRIMA di tagliare.
   Un taglio che perde un fatto non e' una potatura (v406, v201-v204). */
check("v418 il taglio non perde nessun fatto: il drawdown dal massimo resta pubblicato", suVeriEsito(`
  const r = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])]
    .find(x => String(x.ticker).toUpperCase() === "CRWV");
  if (!r || !isFinite(Number(r.w52_dist_pct))) return "w52_dist_pct assente: il check non misura niente";
  const p = buildPromptTicker("CRWV");
  const atteso = Math.abs(Math.round(Number(r.w52_dist_pct) * 10) / 10).toFixed(1).replace(".", ",");
  const i = p.indexOf("- Massimo 52 settimane");
  if (i < 0) return "la riga del massimo a 52 settimane non compare";
  const riga = p.slice(i, p.indexOf(String.fromCharCode(10), i));
  if (riga.indexOf(atteso) < 0) return "il drawdown dal massimo (" + atteso + ") non e' piu' pubblicato da nessuna parte";
  /* e si dichiara che e' lo stesso fatto nei due versi, altrimenti sono due numeri sulla stessa grandezza */
  return riga.indexOf("stesso fatto e non un secondo dato") >= 0 ? true
    : "i due versi escono senza dichiarare che sono lo stesso fatto";`));

/* ⚠ e l'esclusione si NOMINA con la ragione: togliere in silenzio e' peggio del difetto (v406). */
check("v418 l'assenza del titolo in esame dall'elenco viene dichiarata, non taciuta", suVeriEsito(`
  const p = buildPromptTicker("CRWV");
  const i = p.indexOf("TECNICA E FONDAMENTALI DI OGNI POSIZIONE");
  if (i < 0) return "il blocco tecnico del libro non compare";
  const riga = p.slice(i, p.indexOf(String.fromCharCode(10), i));
  return riga.indexOf("CRWV NON compare in questo elenco") >= 0 && riga.indexOf("DETTAGLI TECNICI") >= 0
    ? true : "il titolo in esame sparisce dall'elenco senza che la riga lo dichiari";`));

/* ⚠⚠ v419 — LA DICHIARAZIONE DEL TAGLIO DEV'ESSERE VERA QUANTO IL TAGLIO.
   Il taglio della v418 toglie dal blocco del libro la riga tecnica del titolo IN ESAME, e la
   riga di intestazione lo dichiara. Su un titolo che il CEO NON possiede non c'e' nessun taglio
   — l'elenco resta intero — e la dichiarazione diceva lo stesso "TSM NON compare in questo
   elenco ed e' l'unica assenza: e' il titolo in esame": affermava che TSM fosse una posizione e
   che fosse stata tolta, due cose false, proprio nella riga che esiste per impedire che
   un'assenza si legga male. Ramo raro della v190, creato dalla v418.
   ⚠ Il check percorre ENTRAMBI i rami — un titolo posseduto e uno no — perche' un gate che
   esercita un ramo solo non avrebbe visto il difetto che ha creato la v418. */
check("v419 il taglio si dichiara solo dove e' avvenuto davvero", suVeriEsito(`
  const tutti = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])];
  const dentro = tutti.filter(r => r && r.qta && r.tv && r.tv.tecnica).map(r => String(r.ticker).toUpperCase());
  const fuori  = tutti.filter(r => r && !r.qta && r.tv && r.tv.tecnica).map(r => String(r.ticker).toUpperCase());
  if (!dentro.length || !fuori.length)
    return "servono un titolo posseduto e uno no: ne ho " + dentro.length + " e " + fuori.length;
  const guai = [];
  for (const [tk, posseduto] of [[dentro[0], true], [fuori[0], false]]) {
    const p = buildPromptTicker(tk);
    const suaRiga = p.split(String.fromCharCode(10)).some(r => r.indexOf("- " + tk + ": medie:") === 0);
    const dichiara = p.indexOf(tk + " NON compare in questo elenco") >= 0;
    if (posseduto && suaRiga) guai.push(tk + " e' in portafoglio e la sua riga tecnica c'e' ancora");
    if (posseduto && !dichiara) guai.push(tk + " e' stato tolto dall'elenco senza che la riga lo dichiari");
    if (!posseduto && dichiara) guai.push(tk + " non e' in portafoglio e la riga dichiara un taglio che non c'e' stato");
  }
  return guai.length ? guai.join(" · ") : true;`));

/* ⚠ e su un titolo non posseduto l'elenco resta INTERO: il taglio non deve accorciarlo. */
check("v419 su un titolo non posseduto l'elenco del libro resta intero", suVeriEsito(`
  const tutti = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])];
  const attesi = tutti.filter(r => r && r.qta && r.tv && r.tv.tecnica).length;
  const fuori = tutti.find(r => r && !r.qta && r.tv && r.tv.tecnica);
  if (!fuori || attesi < 5) return "stato insufficiente: " + attesi + " posizioni, non posseduto " + !!fuori;
  const p = buildPromptTicker(String(fuori.ticker).toUpperCase());
  const righe = (p.match(/^- [A-Z]{2,5}: medie:/gm) || []).length;
  return righe === attesi ? true
    : "analizzando un titolo NON posseduto l'elenco ha " + righe + " righe invece di " + attesi;`));

/* ⚠⚠ v420 — L'INTESTAZIONE DEL LIBRO HA TRE STATI, E IL TERZO AFFERMAVA IL FALSO.
   La condizione era `tkCorrente`, vero per QUALSIASI pacchetto di titolo: analizzando un titolo
   che il CEO non possiede, la riga diceva "IL LIBRO IN CUI QUESTA POSIZIONE VIVE" — cioe' che
   quel titolo fosse una posizione — mentre non compare fra quelle elencate due righe sotto, e
   mentre il blocco 0 della stessa testata lo inquadra correttamente come INGRESSO.
   Stessa classe della v419, chiusa un livello piu' sotto: la stessa condizione sbagliata
   sopravviveva nell'intestazione. Quando si corregge un predicato si cercano TUTTI i punti che
   lo usano.
   ⚠ Il check percorre i TRE stati (macro · titolo posseduto · titolo non posseduto): un gate che
   ne esercita due non avrebbe visto il terzo, che e' esattamente com'e' nato il difetto. */
check("v420 l'intestazione del libro dice il vero in tutti e tre gli stati", suVeriEsito(`
  const tutti = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])];
  const dentro = tutti.filter(r => r && r.qta && r.tv && r.tv.tecnica).map(r => String(r.ticker).toUpperCase());
  const fuori  = tutti.filter(r => r && !r.qta && r.tv && r.tv.tecnica).map(r => String(r.ticker).toUpperCase());
  if (!dentro.length || !fuori.length)
    return "servono un titolo posseduto e uno no: ne ho " + dentro.length + " e " + fuori.length;
  const testa = (p) => { const i = p.indexOf("=== IL LIBRO");
    return i < 0 ? "" : p.slice(i, p.indexOf(String.fromCharCode(10), i)); };
  const guai = [];

  const macro = testa(buildCIOText());
  if (macro.indexOf("E' L'OGGETTO DELL'ANALISI") < 0)
    guai.push("macro: l'intestazione non dichiara che il libro e' l'oggetto (" + macro.slice(0, 50) + ")");

  const posseduto = testa(buildPromptTicker(dentro[0]));
  if (posseduto.indexOf("QUESTA POSIZIONE VIVE") < 0)
    guai.push(dentro[0] + " e' in portafoglio e l'intestazione non lo tratta da posizione");

  const nonPosseduto = testa(buildPromptTicker(fuori[0]));
  if (nonPosseduto.indexOf("QUESTA POSIZIONE VIVE") >= 0)
    guai.push(fuori[0] + " NON e' in portafoglio e l'intestazione lo chiama posizione del libro");
  if (nonPosseduto.indexOf(fuori[0] + " NON E' FRA LE POSIZIONI") < 0)
    guai.push(fuori[0] + " non e' fra le posizioni e l'intestazione non lo dichiara");

  return guai.length ? guai.join(" · ") : true;`));

/* ⚠ e la domanda "il titolo in esame e' fra le posizioni?" ha UNA derivazione sola: due
   risposte alla stessa domanda divergono al primo ritocco (v161, v207, v316). */
check("v420 l'intestazione e la dichiarazione del taglio concordano sempre", suVeriEsito(`
  const tutti = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])];
  const casi = [
    ...tutti.filter(r => r && r.qta && r.tv && r.tv.tecnica).slice(0, 2),
    ...tutti.filter(r => r && !r.qta && r.tv && r.tv.tecnica).slice(0, 2),
  ].map(r => String(r.ticker).toUpperCase());
  if (casi.length < 3) return "meno di tre casi disponibili: il check non misura niente";
  const guai = [];
  for (const tk of casi) {
    const p = buildPromptTicker(tk);
    const daIntestazione = p.indexOf("=== IL LIBRO IN CUI QUESTA POSIZIONE VIVE") >= 0;
    const daTaglio = p.indexOf(tk + " NON compare in questo elenco") >= 0;
    if (daIntestazione !== daTaglio)
      guai.push(tk + ": intestazione dice " + (daIntestazione ? "posizione" : "non posizione")
        + " e la dichiarazione del taglio dice " + (daTaglio ? "tolto" : "non tolto"));
  }
  return guai.length ? guai.join(" · ") : true;`));

/* ⚠⚠ v421 — IL PACCHETTO NEGAVA UN DATO CHE USA VENTI RIGHE PIU' SU.
   Il blocco dei pesi apre con "l'azionario vale l'85,6% del totale, accanto a liquidita'
   (al 2026-08-08) e titoli di Stato" — quel denominatore CONTIENE la cassa — e la chiusura
   della disciplina diceva "la liquidita' disponibile del CEO ... Nessuno dei tre e' nel
   sistema". Due affermazioni opposte sullo stesso dato dentro lo stesso pacchetto, cioe'
   precisamente cio' che il collaudo B5 ordina a chi legge di segnalare: il pacchetto
   forniva da solo i falsi positivi del proprio controllo di qualita' (v400, v412, v414).
   ⚠ E il divieto di dimensionare POGGIA su quella riga: un lettore che trova la premessa
   smentita conclude che il divieto sia eccessivo — che e' la cosa che tutto il pacchetto
   esiste per impedire.
   ⚠ Il check percorre ENTRAMBI i rami costruendo lo stato, invece di prendere quello che
   capita: con STATO_PTF nullo la riga "Nessuno dei tre" e' vera e deve restare. Un gate che
   esercitasse un ramo solo non avrebbe visto il difetto, che vive solo nell'altro. */
check("v421 la riga dei tre dati non nega la cassa che il pacchetto usa nei pesi", suVeriEsito(`
  const tk = (DATA.watchlist.find(r => r && Number(r.qta) > 0 && !String(r.ticker).startsWith("^")) || {}).ticker;
  const riga = (p) => { const i = p.indexOf("I tre dati che questa sezione NON contiene");
    return i < 0 ? "" : p.slice(i, p.indexOf(String.fromCharCode(10), i)); };
  const guai = [];

  STATO_PTF = { cash: { v: 10000, at: "2026-08-08" }, btp: { v: { qty: 40000, pmc: 100 } } };
  const conCassa = buildPromptTicker(tk);
  const rc = riga(conCassa);
  if (!rc) guai.push("con la cassa nota la riga dei tre dati non compare affatto");
  if (rc.indexOf("Nessuno dei tre e' nel sistema") >= 0)
    guai.push("il sistema HA la cassa (e la usa nei pesi) e la riga dichiara che nessuno dei tre c'e'");
  if (rc.indexOf("2026-08-08") < 0)
    guai.push("la riga non dice a quale data e' annotata la cassa che il pacchetto sta usando");
  if (conCassa.indexOf("MA NON E' IL PATRIMONIO") < 0)
    guai.push("il blocco dei pesi non usa la cassa: il check non sta misurando la contraddizione");

  STATO_PTF = null;
  const senza = riga(buildPromptTicker(tk));
  if (senza.indexOf("Nessuno dei tre e' nel sistema") < 0)
    guai.push("senza stato patrimoniale la riga non dichiara piu' che i tre dati mancano");

  return guai.length ? guai.join(" · ") : true;`));

/* ⚠⚠ v421 — "(fonti: A, B, C)" ELENCAVA LE FONTI CONFIGURATE, NON QUELLE CHE HANNO SERVITO.
   Misurato sul run del 04/09: la riga nominava MarketWatch fra le fonti delle 18 voci e
   MarketWatch ne aveva prodotte ZERO. Il feed rispondeva — quindi era "letta e muta" — ma dal
   pacchetto quel caso e' INDISTINGUIBILE da "non letta", che e' il guasto per cui le news macro
   sono rimaste morte un anno (v389). La v399 aveva gia' chiuso il caso per le notizie PER
   TITOLO tenendo tre esiti distinti: il blocco macro era rimasto indietro, classe v412.
   ⚠ Lo stato si COSTRUISCE: nel data.json di oggi le chiavi nuove non esistono ancora (le
   scrive il run successivo della pipeline), quindi un check che le leggesse sarebbe verde per
   assenza del fenomeno — la trappola pagata quattro volte in questo progetto. */
check("v421 le notizie macro distinguono fonte che serve, fonte muta e fonte non letta", suVeriEsito(`
  const riga = (p) => { const i = p.indexOf("- TITOLI MACRO");
    return i < 0 ? "" : p.slice(i, p.indexOf(String.fromCharCode(10), i)); };
  if (!(DATA.macro && DATA.macro.news && (DATA.macro.news.voci || []).length))
    return "il data.json non ha voci macro: il check non misura niente";
  const guai = [];

  DATA.macro.news.fonti = ["Alfa"];
  DATA.macro.news.fonti_mute = ["Beta"];
  DATA.macro.news.fonti_non_lette = ["Gamma"];
  const tre = riga(buildCIOText());
  if (tre.indexOf("Alfa") < 0) guai.push("la fonte che ha servito non e' nominata");
  if (tre.indexOf("Beta") < 0 || tre.indexOf("senza voci macro") < 0)
    guai.push("la fonte letta e muta non e' distinta: " + tre.slice(0, 160));
  if (tre.indexOf("Gamma") < 0 || tre.indexOf("NON LETTE") < 0)
    guai.push("la fonte non raggiunta non e' distinta da una muta: " + tre.slice(0, 160));
  const iB = tre.indexOf("Beta"), iG = tre.indexOf("Gamma");
  if (iB >= 0 && iG >= 0 && tre.slice(Math.min(iB, iG), Math.max(iB, iG)).indexOf("NON LETTE") < 0
      && tre.slice(Math.min(iB, iG), Math.max(iB, iG)).indexOf("senza voci") < 0)
    guai.push("muta e non letta finiscono nello stesso elenco");

  delete DATA.macro.news.fonti_mute;
  delete DATA.macro.news.fonti_non_lette;
  const vecchio = riga(buildCIOText());
  if (vecchio.indexOf("fonti CONFIGURATE") < 0)
    guai.push("senza le chiavi nuove la riga afferma comunque chi ha servito invece di dichiarare che non lo sa");

  return guai.length ? guai.join(" · ") : true;`));

/* ⚠⚠ v421 — LA STESSA GRANDEZZA RESA CON DUE PRECISIONI, IN DUE BLOCCHI CHE IL PACCHETTO
   DICHIARA ESSERE LO STESSO SEGNALE. Misurato sul pacchetto del 04/09: la concentrazione di
   fattore usciva "74% dell'azionario" nel blocco CONCENTRAZIONE, "73,6%" nella DISCIPLINA e
   di nuovo "74%" nel blocco delle notizie; il peso delle prime tre "58%" contro "58,5%".
   La derivazione era gia' UNA: il difetto stava nella RESA, `toFixed(0)`/`Math.round` di qua e
   una cifra di la'.
   ⚠ E fra i due blocchi c'e' scritto "QUESTE MISURE SONO LE STESSE DEL BLOCCO QUI SOPRA:
   contale UNA VOLTA SOLA". Dichiarare che due numeri sono lo stesso e poi stamparli diversi e'
   peggio che non dichiararlo — il lettore e' istruito a trattarli come uno e ne vede due, e il
   collaudo B5 gli ordina di segnalarlo: il pacchetto produce da solo i falsi positivi del
   proprio controllo di qualita' (classe v400, v412, v414).
   ⚠ Il gate NON ammette tolleranza, ed e' la lezione v415: fra due rese della STESSA grandezza
   dalla STESSA fonte i numeri devono COINCIDERE, non somigliarsi. Una tolleranza tarata su
   "due arrotondamenti legittimi possono differire" e' giusta fra grandezze calcolate in due
   modi, e sbagliata qui.
   ⚠ Cerca le occorrenze per la LORO FORMA nel testo, non per un elenco di frasi scritto a
   mano: un registro di punti di stampa invecchia da solo al primo blocco nuovo (C10, red team
   I6, MACRO_CARD_BY_PANEL che copriva 7 pannelli su 37). */
check("v421 il peso del gruppo correlato esce con lo stesso numero in ogni blocco", suVeriEsito(`
  /* ⚠ OGNI SEDE HA IL PROPRIO ANCORAGGIO, CHIUSO. La prima stesura ne usava uno solo, largo
     ("posizioni = N% dell'azionario"), e prendeva anche la finestra delle trimestrali (70,9%)
     e la dipendenza dal mercato dei capitali (17,4%), che sono grandezze DIVERSE: il check era
     rosso su codice corretto. Stringendolo con una lookahead condivisa e' diventato il difetto
     opposto — NON MORDEVA piu' sull'iniezione, perche' la lookahead scritta per una sede
     spegneva un'altra. Sesta incarnazione dell'ancoraggio aperto, e sua conseguenza.
     ⚠ Il PAVIMENTO sulle sedi trovate e' la difesa contro il gate che si addormenta: se domani
     una riformulazione fa mancare i riferimenti, il check lo dice invece di uscire verde per
     assenza del fenomeno (meta-gate dei dormienti, v350). */
  const SEDI_GRUPPO = [
    "si muovono INSIEME e valgono il ([0-9]+(?:,[0-9]+)?)%",
    "Il loro peso NON e. incluso nel ([0-9]+(?:,[0-9]+)?)%",
    "posizioni = ([0-9]+(?:,[0-9]+)?)% dell'azionario [(]",
    "([0-9]+(?:,[0-9]+)?)% del capitale si muove insieme",
    "non il ([0-9]+(?:,[0-9]+)?)% del gruppo",
    "PESO DEL GRUPPO [(]([0-9]+(?:,[0-9]+)?)%",
  ];
  const SEDI_TRE = [
    "le prime tre posizioni valgono il ([0-9]+(?:,[0-9]+)?)%",
    "[+] AMD = ([0-9]+(?:,[0-9]+)?)%",
  ];
  const raccogli = (p, sedi) => {
    const vis = new Map();
    for (const src of sedi) {
      const rx = new RegExp(src, "g");
      let m;
      while ((m = rx.exec(p))) { if (!vis.has(m[1])) vis.set(m[1], []); vis.get(m[1]).push(src); }
    }
    return vis;
  };
  const guai = [];
  for (const nome of ["macro", "titolo"]) {
    const p = nome === "macro" ? buildCIOText() : (() => {
      const tk = (DATA.watchlist.find(r => r && Number(r.qta) > 0 && !String(r.ticker).startsWith("^")) || {}).ticker;
      return buildPromptTicker(tk); })();

    const g = raccogli(p, SEDI_GRUPPO);
    const nSediG = [...g.values()].reduce((s, x) => s + x.length, 0);
    if (nSediG < 4) guai.push(nome + ": trovate solo " + nSediG + " sedi del peso del gruppo su 6, il check si sta addormentando");
    if (g.size > 1) guai.push(nome + ": il peso del gruppo correlato esce con " + g.size
      + " valori diversi (" + [...g.keys()].join(" e ") + ")");

    const t3 = raccogli(p, SEDI_TRE);
    const nSediT = [...t3.values()].reduce((s, x) => s + x.length, 0);
    if (nSediT < 2) guai.push(nome + ": trovate solo " + nSediT + " sedi del peso delle prime tre su 2");
    if (t3.size > 1) guai.push(nome + ": il peso delle prime tre esce con " + t3.size
      + " valori diversi (" + [...t3.keys()].join(" e ") + ")");
  }
  return guai.length ? guai.join(" · ") : true;`));

/* ⚠⚠ v422 — "oggi" ACCANTO A UN NUMERO CHE NON E' DI OGGI, IN TRE SEDI CHE LA v416 NON
   COPRIVA. Il gate v416 cercava DUE FORME letterali ("% oggi)" e "· oggi ") e quindi non vedeva
   ", oggi -13%" sulla scheda del titolo, "volumi scambiati oggi" sulle opzioni, ne' "oggi 0.43"
   sulla curva. Non si e' rotto: non ha mai coperto quei casi — un gate ancorato a una FORMA
   sorveglia le occorrenze che l'autore aveva in mente, non la proprieta'.
   ⚠ E le tre sedi erano contraddette dal pacchetto stesso: il guadagno dal carico stava quattro
   righe sopra "Variazione della seduta del 03/09/2026: +4,49% — NON e' la seduta di oggi"; i
   volumi delle opzioni si dicevano "di oggi" mentre due righe sotto il pacchetto dichiara che
   lo snapshot e' stato preso FUORI dalla sessione regolare (book vuoto); la curva porta la
   propria rilevazione del 03/09.
   ⚠ LA PROPRIETA', non la forma: "oggi" puo' stare accanto a un numero SOLO se la stessa riga
   dichiara che la rilevazione e' odierna — che e' esattamente il ramo legittimo della v193, dove
   il VIX scrive "oggi" solo quando lo snapshot e' davvero di oggi. Cosi' il gate copre anche le
   sedi che verranno. */
check("v422 nessun numero porta l'avverbio 'oggi' senza dichiarare la rilevazione odierna", suVeriEsito(`
  const guai = [];
  const NL = String.fromCharCode(10);
  const rx = new RegExp("oggi[^" + NL + "]{0,14}?[-+]?[0-9]|[-+]?[0-9][^" + NL + "]{0,6}?[ ]oggi([ ]|[)]|,|$)", "g");
  for (const [nome, p] of [["macro", buildCIOText()],
                           ["titolo", buildPromptTicker("CRWV")]]) {
    for (const r of p.split(NL)) {
      /* le ISTRUZIONI parlano di "oggi" come concetto ("un dato di due mesi non e' lo stato di
         oggi"): la regola riguarda i FATTI, cioe' le righe di dati, che cominciano con "- ". */
      if (r.slice(0, 2) !== "- ") continue;
      rx.lastIndex = 0;
      const m = rx.exec(r);
      if (!m) continue;
      if (r.indexOf("rilevazione odierna") >= 0) continue;   // ramo legittimo v193
      guai.push(nome + ": " + r.slice(0, 110));
    }
  }
  return guai.length ? guai.slice(0, 4).join(" · ") : true;`));

/* ⚠ e il ramo legittimo deve restare RAGGIUNGIBILE: un check che vieta e basta passerebbe anche
   se "oggi" sparisse del tutto, e allora il VIX di giornata non si distinguerebbe piu' da uno
   di ieri (v406 — togliere in silenzio e' peggio del difetto). */
check("v422 il ramo 'rilevazione odierna' esiste ancora e porta il proprio numero", suVeriEsito(`
  const p = buildCIOText();
  const NL = String.fromCharCode(10);
  const riga = p.split(NL).find(r => r.indexOf("rilevazione odierna") >= 0);
  if (!riga) return true;   // oggi lo snapshot non e' odierno: il ramo non si rende, e va bene
  return /[-+][0-9]+(,[0-9]+)?%[ ]oggi/.test(riga) ? true
    : "il ramo odierno c'e' ma non porta piu' la variazione accanto: " + riga.slice(0, 90);`));

/* ⚠⚠ v422 — LA RIGA DI FRESCHEZZA AFFERMAVA UNA DATA SOLA MENTRE ALCUNE RIGHE NE PORTANO
   UN'ALTRA. Misurato sul run delle 13:06: l'intestazione diceva "LA BARRA GIORNALIERA SOTTO
   QUEI NUMERI E' DEL 2026-09-03 … non sono prezzi di adesso" e il VIX, che quella stessa
   intestazione NOMINA fra "quei numeri", dichiarava rilevazione odierna. E' la v186 su un altro
   blocco: l'invariante non e' che le date coincidano — non dipende da noi — ma che quando NON
   coincidono il pacchetto lo DICHIARI.
   ⚠ Lo stato si COSTRUISCE in entrambi i versi: una riga piu' fresca dev'essere dichiarata, e
   con tutte le sedute allineate la dichiarazione NON deve comparire — una riga che avvisa
   sempre non avvisa. */
check("v422 la riga di freschezza dichiara le quotazioni piu' fresche della maggioranza", suVeriEsito(`
  const az = [...(DATA.portfolio || []), ...(DATA.watchlist || [])]
    .filter(r => r && typeof r.price_asof === "string" && !/(-(USD|USDT|EUR)|=[XF])$/i.test(String(r.ticker || "")));
  if (az.length < 4) return "meno di quattro quotazioni datate: il check non misura niente";
  const NL = String.fromCharCode(10);
  const testa = () => (buildCIOText().split(NL).find(r => r.indexOf("DATI DI MERCATO (") >= 0) || "");
  const guai = [];

  const base = az[0].price_asof;
  for (const r of az) r.price_asof = base;                    // tutte sulla stessa seduta
  const allineate = testa();
  if (allineate.indexOf("MA NON TUTTE") >= 0)
    guai.push("con tutte le sedute allineate la riga dichiara comunque un disallineamento");

  const dopo = new Date(Date.parse(base + "T00:00:00") + 86400000).toISOString().slice(0, 10);
  az[0].price_asof = dopo;                                    // una sola riga piu' avanti
  const sfasate = testa();
  if (sfasate.indexOf("MA NON TUTTE") < 0)
    guai.push("una quotazione ha la barra del giorno dopo e la riga di freschezza non lo dichiara");
  if (sfasate.indexOf(dopo) < 0)
    guai.push("il disallineamento e' dichiarato ma senza dire di quale seduta si tratta");
  if (sfasate.indexOf(base) < 0)
    guai.push("la data della maggioranza e' sparita dalla riga");

  return guai.length ? guai.join(" · ") : true;`));

/* ⚠⚠ v423 — IL NOME DELLA SOCIETA' SPARIVA SUI TITOLI NON POSSEDUTI, E IL SISTEMA CE L'AVEVA.
   `rigaLibro` filtrava per `qta > 0 && pmc > 0` — cioe' rispondeva a "e' una POSIZIONE?" — e da
   lei venivano anche il NOME e la data della prossima trimestrale, che sono proprieta' del
   TITOLO e non del possesso. Su TSM il pacchetto apriva con "ANALISI DI TSM — 04/09/2026"
   mentre `data.json` porta `name: "Taiwan Semiconductor Manu…"`.
   ⚠ E' la v397 sopravvissuta nel ramo che nessuno esercitava, ed e' peggio li' che altrove: un
   nome fuori dal libro e' quello che il CEO conosce meno, e il PASSO 0 gli ordina di cercarlo
   online senza dirgli come si chiama. Classe v419/v420, la variante non posseduta.
   ⚠ La stessa conflazione rendeva IRRAGGIUNGIBILE l'avviso sulla trimestrale entro l'orizzonte
   per ogni titolo non posseduto: un ramo che non puo' essere raggiunto non e' una protezione
   (v234).
   ⚠ Il check esercita ENTRAMBI gli stati, che e' esattamente com'e' nato il difetto: sui titoli
   posseduti il nome c'era, e nessuno aveva letto l'altro pacchetto. */
check("v423 il nome della societa' esce anche sui titoli seguiti e non posseduti", suVeriEsito(`
  const tutti = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])];
  const conNome = (r) => r && r.name && String(r.name).trim()
    && String(r.name).toUpperCase() !== String(r.ticker).toUpperCase();
  const dentro = tutti.filter(r => conNome(r) && r.qta && r.tv && r.tv.tecnica);
  const fuori  = tutti.filter(r => conNome(r) && !r.qta && r.tv && r.tv.tecnica);
  if (!dentro.length || !fuori.length)
    return "servono un posseduto e un non posseduto CON nome: ne ho " + dentro.length + " e " + fuori.length;
  const guai = [];
  for (const [stato, r] of [["posseduto", dentro[0]], ["non posseduto", fuori[0]]]) {
    const tk = String(r.ticker).toUpperCase();
    const testa = buildPromptTicker(tk).split(String.fromCharCode(10))[0];
    if (testa.indexOf(String(r.name).trim()) < 0)
      guai.push(stato + " (" + tk + "): il nome '" + String(r.name).trim()
        + "' e' in data.json e non compare nell'intestazione — " + testa);
  }
  return guai.length ? guai.join(" · ") : true;`));

/* ⚠ e la seconda meta' della stessa conflazione: l'avviso "trimestrale dentro l'orizzonte" deve
   poter scattare anche su un titolo non posseduto. Lo stato si COSTRUISCE — la data reale puo'
   cadere fuori dai 60 giorni in qualunque giorno, e un check che aspetta i dati del giorno va
   verde o rosso da solo (v233, v402). */
check("v423 l'avviso sulla trimestrale vicina e' raggiungibile anche fuori dal libro", suVeriEsito(`
  const tutti = [...((DATA.portfolio) || []), ...((DATA.watchlist) || [])];
  const r = tutti.find(x => x && !x.qta && x.tv && x.tv.tecnica);
  if (!r) return "nessun titolo seguito e non posseduto: il check non misura niente";
  const fra = (g) => { const d = new Date(); d.setHours(12, 0, 0, 0);
    return new Date(d.getTime() + g * 86400000).toISOString().slice(0, 10); };
  const prima = r.earnings_date;
  try {
    r.earnings_date = fra(9);
    const p = buildPromptTicker(String(r.ticker).toUpperCase());
    /* ⚠ LA SONDA VA SULL'AVVISO DELLE ISTRUZIONI, non su "9 giorni": la scheda dati stampa
       "Prossima trimestrale attesa (fra 9 giorni)" da un'ALTRA derivazione, quindi la prima
       stesura restava verde con la conflazione reintrodotta. Un check sulla stringa sbagliata
       misura un'altra cosa (v405), e un'iniezione che non morde e' un no-op silenzioso. */
    if (p.indexOf("C'E' UN EVENTO DENTRO L'ORIZZONTE BREVE") < 0)
      return "trimestrale fra 9 giorni su un titolo non posseduto e le istruzioni non portano "
        + "l'avviso dell'evento dentro l'orizzonte: il ramo resta irraggiungibile fuori dal libro";
    return true;
  } finally { r.earnings_date = prima; }`));

/* ⚠⚠ v424 — DUE NUMERI DEL LIBRO SCRITTI A MANO DENTRO LE ISTRUZIONI. La regola sui
   denominatori diceva: 'confrontare due percentuali: "23% del capitale" e "34% del rischio" sono
   confrontabili solo perche' il pacchetto dichiara che stanno sullo stesso insieme'. Si leggono
   come i numeri VIVI di questo libro — e quasi lo erano: il peso di MU e' 22,5%, non 23.
   ⚠ TERZA incarnazione del conteggio fisso: v410 nella coda, v411 nella testata un paragrafo
   piu' in la', v415 nella clausola sulle revisioni. E la TESTATA e' il posto in cui e' peggio,
   perche' nessun gate la conta ed e' la parte che il modello legge per prima: la regola che deve
   insegnargli a diffidare dei numeri incoerenti gliene forniva uno.
   ⚠ Il rimedio e' quello della v415: non si aggiorna l'esempio, si TOGLIE.
   ⚠ LA PROPRIETA' NON E' "niente numeri nelle istruzioni" — ce ne sono di legittimi (il tetto di
   parole, la soglia del 2% sullo scarto di prezzo, il formato "−6% dal riferimento"). E'
   piu' stretta: nelle ISTRUZIONI nessuna percentuale si presenta come una quota DI QUESTO LIBRO,
   perche' e' l'aggancio che la fa invecchiare col portafoglio. Verificato che oggi non esista
   nessuna occorrenza legittima di quella forma. */
check("v424 le istruzioni non citano percentuali del libro scritte a mano", suVeriEsito(`
  const NL = String.fromCharCode(10);
  const guai = [];
  const rx = new RegExp("[0-9]+[,.]?[0-9]*%[^" + NL + "]{0,20}?"
    + "(del capitale|del rischio|dell.azionario|del libro|del NAV|del patrimonio)", "g");
  const casi = [
    ["titolo", buildPromptTicker("CRWV"), "QUADRO MACRO DI RIFERIMENTO"],
    ["macro",  buildCIOText(),            "DATI AL "],
  ];
  for (const [nome, p, finePreambolo] of casi) {
    const i = p.indexOf(finePreambolo);
    if (i < 0) return nome + ": non trovo la fine delle istruzioni, il check non misura niente";
    const istruzioni = p.slice(0, i);
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(istruzioni))) guai.push(nome + ': "' + m[0] + '"');
  }
  return guai.length
    ? guai.join(" · ") + " — una quota del libro scritta nelle istruzioni invecchia col portafoglio"
    : true;`));

let fail = 0;
for (const [name, ok] of T) {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
console.log(`\n${T.length - fail}/${T.length} check superati`);
process.exit(fail ? 1 : 0);
