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
console.log(`RED TEAM: ${campaigns} campagne (4 scenari dati × stati UI), 5 invarianti — nessuna violazione`);
