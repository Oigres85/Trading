#!/usr/bin/env node
/* REGISTRO VERDETTI → ESITI (v113) — il motore si misura da solo.
   Gira nel CI dopo update_data.py:
   1. calcola il verdetto del motore (decisionVerdict di app.js, stesso harness vm dei test)
      e appende i candidati ACCUMULA di oggi a config/verdict_history.jsonl (1 riga/giorno);
   2. raggruppa i segnali in EPISODI (primo giorno in cui un ticker diventa candidato;
      un buco >14g tra un'apparizione e la successiva apre un episodio nuovo);
   3. valuta gli episodi maturi (≥7g e ≥30g) con l'ipotesi onesta "comprato alla chiusura
      del giorno del segnale" vs il NDX dello stesso giorno, e inietta il riepilogo in
      data/data.json → campo `verdict_track` (letto da buildPrompt: TRACK RECORD DEL MOTORE).
   BEST-EFFORT: qualsiasi errore viene loggato e lo script esce 0 — non deve MAI
   bloccare l'aggiornamento dei dati. cashEur=1 nominale: i CANDIDATI (score/limite)
   non dipendono dalla liquidità reale, che vive solo nel browser dell'utente. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HIST = join(ROOT, "config", "verdict_history.jsonl");
const DATAF = join(ROOT, "data", "data.json");
const r1 = (v) => Math.round(v * 10) / 10;
const daysBetween = (a, b) => Math.abs(new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000;

try {
  // ---- 1) verdetto di oggi via harness vm (stesso DOM-stub di test_app.mjs) ----
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const el = () => ({ addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {}, dataset: {}, hidden: true, querySelector: () => el(), querySelectorAll: () => [], closest: () => null });
  const ctx = { console, document: { querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(), createElement: () => el(), addEventListener() {}, body: el() }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, window: { addEventListener() {}, matchMedia: () => ({ matches: false }) }, navigator: { clipboard: {} }, fetch: () => Promise.reject(new Error("offline")), setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, Event: class {}, MutationObserver: class { observe() {} } };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "app.js" });
  const d = JSON.parse(readFileSync(DATAF, "utf8").replace(/\bNaN\b/g, "null"));
  vm.runInContext("DATA=" + JSON.stringify(d) + "; cashEur=1; recomputeTotals();", ctx);
  const dv = JSON.parse(vm.runInContext(`(() => {
    const dv = decisionVerdict();
    return JSON.stringify({
      label: dv.label,
      candidates: dv.accumula.map(r => ({ tk: r.ticker, q: r._q, price: r.price,
        limit: Math.round(Math.min(r.support || r.price, r.price) * 100) / 100 })),
      rehab: dv.rehabbed.map(x => x.r.ticker),
      squeeze: (dv.squeezed || []).map(x => x.r.ticker),
    });
  })()`, ctx));

  const today = new Date().toISOString().slice(0, 10);
  const entry = {
    date: today, label: dv.label, candidates: dv.candidates, rehab: dv.rehab, squeeze: dv.squeeze,
    ndx: d.macro?.momentum?.ndx?.price ?? null,
    sharpe: d.totals?.portfolio_sharpe_ratio ?? null,
  };

  // ---- 2) storico JSONL: una riga per giorno (l'ultimo run del giorno vince) ----
  let entries = [];
  if (existsSync(HIST)) {
    entries = readFileSync(HIST, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  entries = entries.filter(e => e.date !== today);
  entries.push(entry);
  entries.sort((a, b) => a.date.localeCompare(b.date));
  entries = entries.slice(-400);                       // ~13 mesi di storico giornaliero
  writeFileSync(HIST, entries.map(e => JSON.stringify(e)).join("\n") + "\n");

  // ---- 3) episodi e valutazione ----
  const open = {};             // tk -> episodio aperto
  const episodes = [];
  for (const e of entries) {
    for (const c of e.candidates || []) {
      const ep = open[c.tk];
      if (!ep || daysBetween(ep.lastDate, e.date) > 14) {
        const ne = { tk: c.tk, date: e.date, price: c.price, ndx: e.ndx, lastDate: e.date };
        episodes.push(ne); open[c.tk] = ne;
      } else ep.lastDate = e.date;
    }
  }
  const priceOf = {};
  for (const row of [...(d.portfolio || []), ...(d.watchlist || [])]) priceOf[row.ticker] = row.price;
  const ndxNow = d.macro?.momentum?.ndx?.price ?? null;
  const scored = episodes.map(ep => {
    const age = daysBetween(ep.date, today);
    const pNow = priceOf[ep.tk];
    if (age < 7 || !(pNow > 0) || !(ep.price > 0)) return null;
    const ret = (pNow / ep.price - 1) * 100;
    const vs = (ndxNow > 0 && ep.ndx > 0) ? ret - (ndxNow / ep.ndx - 1) * 100 : null;
    return { tk: ep.tk, date: ep.date, age, ret_pct: r1(ret), vs_ndx_pp: vs != null ? r1(vs) : null };
  }).filter(Boolean);
  const bucket = (minAge) => {
    const xs = scored.filter(s => s.age >= minAge);
    if (!xs.length) return { n: 0 };
    const avg = (arr) => r1(arr.reduce((s, v) => s + v, 0) / arr.length);
    const withVs = xs.filter(s => s.vs_ndx_pp != null);
    return {
      n: xs.length,
      avg_ret: avg(xs.map(s => s.ret_pct)),
      avg_vs_ndx: withVs.length ? avg(withVs.map(s => s.vs_ndx_pp)) : null,
      hit_pct: withVs.length ? Math.round(withVs.filter(s => s.vs_ndx_pp > 0).length / withVs.length * 100) : null,
    };
  };
  d.verdict_track = {
    generated: new Date().toISOString(),
    since: entries[0]?.date ?? today,
    episodes: episodes.length,
    mature7: bucket(7),
    mature30: bucket(30),
    last: scored.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
      .map(({ tk, date, ret_pct, vs_ndx_pp }) => ({ tk, date, ret_pct, vs_ndx_pp })),
  };
  writeFileSync(DATAF, JSON.stringify(d, null, 1));
  console.log(`verdict log: ${entry.candidates.length} candidati oggi (${entry.label}) · ${episodes.length} episodi storici · maturi ≥7g: ${d.verdict_track.mature7.n}`);
} catch (e) {
  console.error("!! log_verdict (best-effort, pipeline NON bloccata):", e.message);
}
process.exit(0);
