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
   bloccare l'aggiornamento dei dati.
   ⚠ CASSA (v160): il vecchio `cashEur=1` NON era neutro. Dal v121 il CAP D'INGRESSO usa
   positionWeightPct, il cui denominatore è il NAV = investito + CASSA: con cassa 1 invece di
   30.000 il NAV scendeva da ~300k a ~270k e TUTTI i pesi salivano dell'~11% → MU risultava
   20,9% (sopra il cap 20) nel CI e 18,9% (sotto) nel browser del CEO. Il track record misurava
   quindi un motore DIVERSO da quello che genera i report — stessa classe del bug v152 sui
   risk_params. Ora la cassa si prende da CIO_CASH_EUR (secret/env) con default dichiarato, e
   il valore usato viene loggato nell'entry per rendere l'assunzione auditabile. */
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
  // v152: lo stub localStorage serve i PARAMETRI DI RISCHIO DEL CEO da config/risk_params.json
  // (sincronizzati dalla dashboard, v150). Prima il CI loggava il verdetto col cap di DEFAULT
  // (10%) mentre il CEO opera col suo override (es. 20%): con cap diversi cambiano i CANDIDATI
  // (AMD dentro/fuori) → il track record misurava un motore DIVERSO da quello del browser.
  const riskOv = (() => { try { return readFileSync(join(ROOT, "config", "risk_params.json"), "utf8"); } catch { return null; } })();
  const ctx = { console, document: { querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(), createElement: () => el(), addEventListener() {}, body: el() }, localStorage: { getItem: (k) => k === "risk_params_overrides" ? riskOv : null, setItem() {}, removeItem() {} }, window: { addEventListener() {}, matchMedia: () => ({ matches: false }) }, navigator: { clipboard: {} }, fetch: () => Promise.reject(new Error("offline")), setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, Event: class {}, MutationObserver: class { observe() {} } };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "app.js" });
  const d = JSON.parse(readFileSync(DATAF, "utf8").replace(/\bNaN\b/g, "null"));
  // cassa: secret/env CIO_CASH_EUR, altrimenti default dichiarato (vedi nota in testa al file)
  const CASH_DEFAULT = 30000;
  const cashEnv = parseFloat(process.env.CIO_CASH_EUR || "");
  const cashUsed = Number.isFinite(cashEnv) && cashEnv >= 0 ? cashEnv : CASH_DEFAULT;
  vm.runInContext("DATA=" + JSON.stringify(d) + "; cashEur=" + cashUsed + "; recomputeTotals();", ctx);
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

  // v160 — DIVERGENZE in forma strutturata + il prezzo del giorno: sono AFFERMAZIONI verificabili
  // ("il flusso non conferma la narrativa su X"), e fra 7-30 giorni i prezzi dicono da soli se erano
  // informative. Loggarle qui rende il sistema auto-misurante SENZA alcun input manuale del CEO.
  const divSig = JSON.parse(vm.runInContext(`(() => {
    try { marketLinkText(); return JSON.stringify(LAST_DIV_SIGNALS || []); } catch { return "[]"; }
  })()`, ctx));
  const priceNow = {};
  for (const row of [...(d.portfolio || []), ...(d.watchlist || [])]) if (row && row.price > 0) priceNow[row.ticker] = row.price;

  const today = new Date().toISOString().slice(0, 10);
  const entry = {
    date: today, label: dv.label, candidates: dv.candidates, rehab: dv.rehab, squeeze: dv.squeeze,
    ndx: d.macro?.momentum?.ndx?.price ?? null,
    sharpe: d.totals?.portfolio_sharpe_ratio ?? null,
    div: divSig.map(s => ({ ...s, price: priceNow[s.tk] ?? null })).filter(s => s.price != null),
    cash_eur: cashUsed, cash_src: Number.isFinite(cashEnv) ? "env" : "default",
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
  // ---- 3-bis) SCORING DELLE DIVERGENZE (auto-misurazione, zero input manuale) ----
  // Ogni divergenza è una previsione implicita sul comportamento RELATIVO del titolo:
  //  · theme_rs / mcr_over_weight / verdict_vs_regime / relapse = segnale di CAUTELA → "informativa"
  //    se il nome ha poi sottoperformato il NDX;
  //  · accel_into_veto = segnale AMBIGUO dichiarato tale ("rimbalzo o inversione?") → si misura solo
  //    la direzione, senza premiarne una: serve a capire se il dubbio era fondato.
  // theme_rs_blind e stop_near NON si scorano: la prima dichiara esplicitamente che il prezzo non ha
  // ancora votato, la seconda è un fatto meccanico, non una previsione.
  const SCORABLE = { theme_rs: "cautela", mcr_over_weight: "cautela", verdict_vs_regime: "cautela",
                     relapse: "cautela", accel_into_veto: "ambiguo" };
  const divScored = [];
  for (const e of entries) {
    const age = daysBetween(e.date, today);
    if (age < 7) continue;
    for (const s of e.div || []) {
      const kind = SCORABLE[s.kind];
      if (!kind || !(s.price > 0) || !(e.ndx > 0) || !(ndxNow > 0)) continue;
      const pNow = priceOf[s.tk];
      if (!(pNow > 0)) continue;
      const rel = ((pNow / s.price) - (ndxNow / e.ndx)) * 100;      // extra-rendimento vs NDX, in pp
      divScored.push({ tk: s.tk, kind: s.kind, cls: kind, date: e.date, age, rel_pp: r1(rel) });
    }
  }
  const byKind = {};
  for (const s of divScored) {
    const b = byKind[s.kind] || (byKind[s.kind] = { n: 0, sum: 0, informative: 0, cls: s.cls });
    b.n++; b.sum += s.rel_pp;
    if (s.cls === "cautela" && s.rel_pp < 0) b.informative++;        // cautela azzeccata = ha sottoperformato
  }
  const divTrack = Object.entries(byKind).map(([kind, b]) => ({
    kind, cls: b.cls, n: b.n, avg_rel_pp: r1(b.sum / b.n),
    hit_pct: b.cls === "cautela" ? Math.round(b.informative / b.n * 100) : null,
  })).sort((a, b) => b.n - a.n);

  d.verdict_track = {
    generated: new Date().toISOString(),
    since: entries[0]?.date ?? today,
    episodes: episodes.length,
    div_track: divTrack,
    div_open: (entry.div || []).length,
    mature7: bucket(7),
    mature30: bucket(30),
    last: scored.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)
      .map(({ tk, date, ret_pct, vs_ndx_pp }) => ({ tk, date, ret_pct, vs_ndx_pp })),
  };
  writeFileSync(DATAF, JSON.stringify(d, null, 1));
  console.log(`verdict log: cassa ${cashUsed}€ (${entry.cash_src}) · ${entry.candidates.length} candidati oggi (${entry.label}) · ${episodes.length} episodi storici · maturi ≥7g: ${d.verdict_track.mature7.n}`);
} catch (e) {
  console.error("!! log_verdict (best-effort, pipeline NON bloccata):", e.message);
}
process.exit(0);
