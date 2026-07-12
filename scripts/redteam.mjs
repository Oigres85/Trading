#!/usr/bin/env node
/* RED TEAM del motore (v116, post-incidente SNDK limite $40,1 / stop -$366).
   La lezione dell'incidente: i test unitari validano le funzioni, non lo SPAZIO DEGLI
   STATI — il bug viveva solo con range grafico "1A" selezionato nella UI, uno stato che
   nessun test esplorava. Questo harness genera il prompt e il verdetto del motore su
   TUTTE le combinazioni di stato UI e su scenari di dati AVVELENATI, e verifica gli
   INVARIANTI FINANZIARI su ogni numero operativo:
     I1  piano d'ingresso: 0 < stop < limite ≤ prezzo, limite entro il 30% dal prezzo
     I2  stop trailing:    0 < stop ≤ 3× prezzo
     I3  prompt: mai "undefined", NaN, Infinity o importi negativi ($-…)
     I4  righe tabelle = conteggi dichiarati ("N POSIZIONI/TITOLI → N righe")
     I5  R/R "1:X" con X ≤ 60 (rapporti oltre = resistenza/ATR garbage)
     I6  coerenza di riga: stop teorico watchlist < supporto d'ingresso della stessa riga
     I7  ogni posizione DETENUTA (Qtà valorizzata, no BTP) ha uno stop (SKHYV senza stop)
     I8  Div% in [0,20] su ogni riga fondamentale (bug GOOGL "25%": errore di unità)
     I9  ROE in [-150,400]% (fuori = unità sbagliate)
     I10 Prezzo/Supp. mai ≤ 0 nelle tabelle titoli (backstop lato prompt del gate pipeline)
     I11 nessun leak di placeholder (null nudo, [object Object], undefined%)
   Ogni invariante nasce da un bug REALE già visto → il red team lo rende una guardia
   permanente: la classe non può ripresentarsi senza far fallire la CI. NON prova l'assenza
   di OGNI bug (impossibile), ma chiude le classi ricorrenti che finora trovava l'LLM a mano.
   Exit 1 con report dettagliato alla prima campagna con violazioni.
   In CI: gate HARD in tests.yml (il codice rotto non si pusha), best-effort + allarme
   WhatsApp in update-data.yml (i dati freschi che rompono gli invarianti non passano
   inosservati). Uso: node scripts/redteam.mjs [path/app.js] (default assets/app.js —
   il path alternativo serve a validare il detector su codice vecchio). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = process.argv[2] ? process.argv[2] : join(ROOT, "assets", "app.js");
const src = readFileSync(APP, "utf8");
const baseData = JSON.parse(readFileSync(join(ROOT, "data", "data.json"), "utf8").replace(/\bNaN\b/g, "null"));
let promptHeader = null;
try { promptHeader = readFileSync(join(ROOT, "config", "prompt_header.txt"), "utf8"); } catch { /* fallback embedded */ }

/* ---------- DOM-stub minimale (stesso pattern di test_app.mjs) ---------- */
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
function makeCtx(store) {
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    document: {
      querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(),
      createElement: () => el(), addEventListener() {}, body: el(),
    },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    window: { prompt: () => null, confirm: () => false, addEventListener() {}, matchMedia: () => ({ matches: false }) },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: () => Promise.reject(new Error("offline (redteam)")),
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
    Event: class {}, MutationObserver: class { observe() {} },
  });
  vm.runInContext(src, ctx, { filename: "app.js" });
  return ctx;
}

/* ---------- scenari di DATI (il baseline + gli avvelenamenti) ---------- */
const clone = (o) => JSON.parse(JSON.stringify(o));
const equities = (d) => [...(d.portfolio || []), ...(d.watchlist || [])].filter(r => r.currency === "USD" && r.price > 0);

const scenarios = {
  "S1-baseline": (d) => d,
  // l'INCIDENTE, ovunque: minimi preistorici iniettati nel range y1 di ogni titolo
  "S2-preistoria": (d) => {
    equities(d).forEach(r => {
      r.tech_by_range = r.tech_by_range || {};
      r.tech_by_range.y1 = { support: Math.round(r.price / 50 * 100) / 100, resistance: r.price * 1.2 };
    });
    return d;
  },
  // API mute: metriche chiave azzerate su metà universo (beta, sharpe, supporti, ATR, stats)
  "S3-null-storm": (d) => {
    equities(d).forEach((r, i) => {
      if (i % 2) return;
      for (const k of ["sharpe_1y", "sortino_1y", "sharpe_6m", "sortino_6m", "beta_ndx", "support",
                       "resistance", "atr_14", "atr_pct", "rsi", "vol_ratio", "rs_1m", "rs_ndx_1m",
                       "risk_contrib_pct", "avg_corr", "max_corr", "signal", "risk_reward",
                       "sma200_dist_pct", "sma50_dist_pct", "w52_dist_pct"]) r[k] = null;
      r.stats = null;
    });
    return d;
  },
  // run avvelenato: valori impossibili che le cinture client devono neutralizzare
  "S4-avvelenato": (d) => {
    const rows = equities(d);
    if (rows[0]) { rows[0].stop_atr = -50; rows[0].stop_violated = true; }
    if (rows[1]) { rows[1].support = 0.01; rows[1].risk_reward = null; }
    if (rows[2]) { rows[2].atr_14 = rows[2].price; rows[2].atr_pct = 100; }
    if (rows[3]) { rows[3].resistance = rows[3].price * 100; rows[3].risk_reward = null; }
    return d;
  },
};

/* ---------- matrice di stato UI ---------- */
const RANGES = ["d1", "w1", "m1", "m3", "y1"];
const CASH = [0, 28500, 1e9];
const DIARY = JSON.stringify([{ date: "2026-07-10", text: "acquisto di prova 10 azioni" }]);

/* ---------- invarianti ---------- */
const violations = [];
function fail(where, what) { violations.push(`[${where}] ${what}`); }

function checkCampaign(name, ctx) {
  // verdetto (piano + trailing) — solo i campi che servono, mai gli oggetti riga interi
  const dv = JSON.parse(vm.runInContext(`(() => { const v = decisionVerdict(); return JSON.stringify({
    plan: v.withPlan.map(p => ({ tk: p.r.ticker, price: p.r.price, limit: p.limit, stop: p.stop })),
    trail: v.trailing.map(x => ({ tk: x.r.ticker, price: x.r.price, stop: x.stop })) }) })()`, ctx));
  for (const p of dv.plan) {
    if (!(p.stop > 0)) fail(name, `I1 ${p.tk}: stop ${p.stop} ≤ 0 nel piano`);
    if (!(p.limit > 0)) fail(name, `I1 ${p.tk}: limite ${p.limit} ≤ 0 nel piano`);
    if (!(p.stop < p.limit)) fail(name, `I1 ${p.tk}: stop ${p.stop} ≥ limite ${p.limit}`);
    if (!(p.limit <= p.price * 1.001)) fail(name, `I1 ${p.tk}: limite ${p.limit} sopra il prezzo ${p.price}`);
    if ((p.price - p.limit) / p.price > 0.30) fail(name, `I1 ${p.tk}: limite ${p.limit} oltre il 30% dal prezzo ${p.price} (incidente SNDK)`);
  }
  for (const t of dv.trail) {
    if (!(t.stop > 0)) fail(name, `I2 ${t.tk}: stop trailing ${t.stop} ≤ 0`);
    if (t.price > 0 && t.stop > t.price * 3) fail(name, `I2 ${t.tk}: stop trailing ${t.stop} oltre 3× il prezzo ${t.price}`);
  }
  const p = vm.runInContext("buildPrompt()", ctx);
  if (p.includes("undefined")) fail(name, `I3 'undefined' nel prompt: …${p.slice(Math.max(0, p.indexOf("undefined") - 60), p.indexOf("undefined") + 30)}…`);
  if (/\bNaN\b/.test(p)) fail(name, "I3 'NaN' nel prompt");
  if (/Infinity/.test(p)) fail(name, "I3 'Infinity' nel prompt");
  const negMoney = p.match(/[$€]\s?-\s?\d[\d.,]*/);
  if (negMoney) fail(name, `I3 importo negativo nel prompt: "${negMoney[0]}"`);
  for (const m of p.matchAll(/— (\d+) (POSIZIONI|TITOLI)[^\n]*\n/g)) {
    const declared = parseInt(m[1], 10);
    const start = p.indexOf(m[0]) + m[0].length;
    const seg = p.slice(start);
    let rows = 0;
    for (const line of seg.split("\n")) {
      if (line.startsWith("|---") || line.startsWith("| Titolo")) continue;
      if (line.startsWith("| ")) { rows++; continue; }
      if (rows > 0) break;                       // fine tabella
    }
    if (rows !== declared) fail(name, `I4 tabella ${m[2]}: dichiarate ${declared} righe, trovate ${rows}`);
  }
  for (const m of p.matchAll(/1:(\d+(?:\.\d+)?)/g)) {
    if (parseFloat(m[1]) > 60) fail(name, `I5 R/R implausibile "${m[0]}" (resistenza/ATR garbage)`);
  }
  // I6 COERENZA SEMANTICA DI RIGA (v118, incidente SNDK $1509>$1485): uno stop long
  // "(teorico)" — ingresso al supporto — deve stare SOTTO il supporto d'ingresso della
  // stessa riga. Il red team numerico non lo vedeva (lo stop era >0, tecnicamente valido):
  // era una relazione FRA due celle. Colonne mdRow: 16=Supp. · 17=Stop 2×ATR.
  const euro = (s) => { const m = (s || "").match(/[\d.]+,\d+|\d[\d.]*/); if (!m) return null;
    return parseFloat(m[0].replace(/\./g, "").replace(",", ".")); };
  for (const line of p.split("\n")) {
    if (!line.startsWith("| ") || !line.includes("(teorico)")) continue;
    const cols = line.split("|").map(s => s.trim());
    const supp = euro(cols[16]), stop = euro(cols[17]);
    if (supp != null && stop != null && stop >= supp) {
      fail(name, `I6 ${cols[1]}: stop teorico ${stop} ≥ supporto d'ingresso ${supp} (stop long impossibile — incidente SNDK)`);
    }
  }
  auditTables(name, p);   // I7–I11: audit semantico delle tabelle (ogni bug passato → guardia)
}

/* AUDITOR SEMANTICO DELLE TABELLE (v120) — la risposta al "ogni report scopre nuovi bug":
   invece di aspettare che l'LLM li trovi, ogni CLASSE di bug già vista diventa una guardia
   deterministica che gira su TUTTE le campagne. Parsa le tabelle per NOME di colonna (robusto
   al riordino), non per posizione fissa. Non prova l'assenza di OGNI bug (impossibile), ma
   chiude le classi ricorrenti: valore impossibile, posizione senza stop, cella ≤0, leak. */
function parseIt(s) {
  if (!s) return null;
  const m = s.match(/-?\d[\d.]*,\d+|-?\d[\d.]*/);   // numero italiano o semplice
  if (!m) return null;
  let t = m[0];
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");   // "." = migliaia, "," = decimali
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}
function tablesOf(p) {
  const lines = p.split("\n"), tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("| Titolo")) continue;
    const cols = lines[i].split("|").map(s => s.trim());
    const idx = {}; cols.forEach((c, j) => { if (c) idx[c] = j; });
    const rows = [];
    let k = i + 1;
    if (lines[k] && lines[k].startsWith("|---")) k++;
    for (; k < lines.length && lines[k].startsWith("| "); k++) {
      if (lines[k].startsWith("| Titolo") || lines[k].startsWith("|---")) continue;
      rows.push(lines[k].split("|").map(s => s.trim()));
    }
    tables.push({ idx, rows });
  }
  return tables;
}
function auditTables(name, p) {
  // I11 leak di placeholder oltre a undefined/NaN/Infinity (già I3): null nudo, [object Object]
  if (/\|\s*null\s*\||\[object Object\]|\$\s*null|undefined%/.test(p)) fail(name, "I11 leak placeholder (null/[object Object]) nel prompt");
  for (const t of tablesOf(p)) {
    const ti = t.idx["Titolo"];
    const stopKey = Object.keys(t.idx).find(k => k.startsWith("Stop"));
    // I7 — ogni posizione DETENUTA (Qtà valorizzata) deve avere uno stop (SKHYV senza stop)
    if (t.idx["Qtà"] != null && stopKey) {
      for (const r of t.rows) {
        const tk = r[ti] || "", qty = r[t.idx["Qtà"]] || "", stop = r[t.idx[stopKey]] || "";
        if (/BTP/.test(tk) || !/\d/.test(qty) || qty === "—") continue;   // BTP e non-detenuti esclusi
        if (stop === "—" || stop === "" || !/\d/.test(stop)) fail(name, `I7 ${tk}: posizione detenuta (Qtà ${qty}) SENZA stop di protezione`);
      }
    }
    // I8 — Div% plausibile: >20% su questo universo growth = quasi sempre errore di unità (bug GOOGL 25%)
    if (t.idx["Div%"] != null) {
      for (const r of t.rows) { const v = parseIt(r[t.idx["Div%"]]); if (v != null && (v < 0 || v > 20)) fail(name, `I8 ${r[ti]}: Div% ${r[t.idx["Div%"]]} fuori range [0,20] (errore di unità)`); }
    }
    // I9 — ROE entro una banda larga ma finita: fuori = unità sbagliate
    if (t.idx["ROE"] != null) {
      for (const r of t.rows) { const v = parseIt(r[t.idx["ROE"]]); if (v != null && (v < -150 || v > 400)) fail(name, `I9 ${r[ti]}: ROE ${r[t.idx["ROE"]]} fuori range [-150,400]%`); }
    }
    // I10 — prezzi/supporti mai ≤ 0 nelle tabelle titoli (backstop del gate pipeline lato prompt)
    for (const nm of ["Prezzo", "Supp."]) {
      if (t.idx[nm] != null) { for (const r of t.rows) { const v = parseIt(r[t.idx[nm]]); if (v != null && v <= 0) fail(name, `I10 ${r[ti]}: ${nm} ${r[t.idx[nm]]} ≤ 0`); } }
    }
  }
}

/* ---------- campagne ---------- */
let campaigns = 0;
for (const [scen, mutate] of Object.entries(scenarios)) {
  const data = mutate(clone(baseData));
  const json = JSON.stringify(data);
  // assi UI: tutti i range; cash multipli e diario/testata SOLO sul baseline (S1) per tenere
  // il runtime CI sotto controllo — gli scenari avvelenati testano i dati, non le preferenze
  const cashes = scen === "S1-baseline" ? CASH : [28500];
  for (const range of RANGES) {
    for (const cash of cashes) {
      const variants = scen === "S1-baseline" && range === "m1" && cash === 28500
        ? [{ d: null, h: promptHeader }, { d: DIARY, h: promptHeader }, { d: DIARY, h: null }]
        : [{ d: DIARY, h: promptHeader }];
      for (const v of variants) {
        const store = { pref_range: range };
        if (v.d) store.action_diary = v.d;
        if (v.h) store.prompt_header = v.h;
        const ctx = makeCtx(store);
        vm.runInContext(`DATA=${json}; cashEur=${cash}; recomputeTotals();`, ctx);
        const name = `${scen} range=${range} cash=${cash}${v.d ? "" : " diario=vuoto"}${v.h ? "" : " testata=fallback"}`;
        try {
          checkCampaign(name, ctx);
        } catch (e) {
          fail(name, `CRASH: ${e.message}`);
        }
        campaigns++;
      }
    }
  }
}

/* ---------- verdetto ---------- */
if (violations.length) {
  console.error(`\nRED TEAM: ${violations.length} violazioni su ${campaigns} campagne\n`);
  violations.slice(0, 40).forEach(v => console.error("  ✗ " + v));
  if (violations.length > 40) console.error(`  … e altre ${violations.length - 40}`);
  process.exit(1);
}
console.log(`RED TEAM: ${campaigns} campagne (4 scenari dati × stati UI), 11 invarianti — nessuna violazione`);
