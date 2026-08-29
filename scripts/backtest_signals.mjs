#!/usr/bin/env node
/* BACKTEST RETROATTIVO DEI SEGNALI (v172) — il sistema si misura sui dati che ha già.

   Perché esiste: il track record delle divergenze si popola in avanti, un run alla volta, e
   servirebbe una settimana per la prima risposta. Ma lo storico per rispondere è GIÀ sul disco:
   `metrics_history` conserva RS e MCR per titolo dall'11/07, e le serie `sparks` sono barre
   giornaliere che finiscono oggi. Si può quindi ricostruire cosa i detector AVREBBERO segnalato
   in ciascuna giornata passata e confrontarlo con quello che è poi successo davvero.

   La domanda a cui risponde: quando il sistema dice "il flusso non conferma" (RS bassa) o "la
   forza relativa accelera" (ΔRS positiva), quel titolo poi sotto/sovraperforma davvero l'indice?
   Se la risposta è no, il detector va TOLTO, non migliorato.

   METODO, coi suoi limiti dichiarati:
   - Le serie sparks non portano date: si indicizzano all'indietro dall'ultima barra. Titolo e
     indice usano lo STESSO offset, così l'eventuale disallineamento si annulla nel confronto
     relativo (che è l'unica grandezza misurata).
   - Il campione è quello che è: poche settimane. I risultati sono INDIZI, non prove. Lo script
     lo dichiara sempre e rifiuta di calcolare hit-rate sotto una soglia minima di osservazioni.

   Uso:  node scripts/backtest_signals.mjs [--orizzonte 7] [--verbose]                       */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const ORIZZONTE = arg("--orizzonte", 7);          // giorni di BORSA in avanti
const VERBOSE = process.argv.includes("--verbose");
const MIN_OSS = 8;                                 // sotto questa soglia non si pubblica un hit-rate

const data = JSON.parse(readFileSync(join(ROOT, "data", "data.json"), "utf8").replace(/\bNaN\b/g, "null"));
const universo = new Map([...(data.portfolio || []), ...(data.watchlist || [])]
  .filter(r => r && r.ticker).map(r => [r.ticker, r]));

/* serie giornaliera più lunga disponibile per un titolo (barre, dalla più vecchia alla più recente) */
/* ⚠ SEMPRE la stessa chiave per TUTTI i titoli. `all` sembrava la scelta migliore (più storia)
   ma ha granularità DIVERSA da titolo a titolo — 499 barre per MU, 33 per HG — e mescolarla col
   benchmark produceva finestre disallineate di mesi: il primo giro di questo backtest dava
   +190pp a 7 giorni, numero assurdo che ha smascherato il difetto. `m6` è giornaliera (126 barre
   ≈ 6 mesi di borsa) ed è presente e coerente su tutti: copre ampiamente lo storico dei segnali. */
const SERIE_KEY = "m6";
function serie(tk) {
  const r = universo.get(tk);
  const a = r && r.sparks && r.sparks[SERIE_KEY];
  if (!Array.isArray(a) || a.length < 40) return null;
  const s = a.map(Number).filter(x => Number.isFinite(x));
  return s.length >= 40 ? s : null;
}
/* ⚠⚠ IL BENCHMARK VA CERCATO FRA QUELLI CHE ESISTONO DAVVERO (v386). Fino a qui la lista era
   ^IXIC || QQQ e NESSUNO DEI DUE E' MAI STATO nella watchlist (23 simboli, verificato su
   config/ui_watchlist.json): il backtest usciva alla riga dopo con process.exit(0), cioe'
   ANNUNCIAVA SUCCESSO SENZA AVER MISURATO NIENTE. E' la classe "verde per assenza" per cui
   esiste self_check.mjs (v277: una suite che usciva 0 senza stampare nulla) — ma questo non e'
   un gate, quindi nessuno lo sorvegliava. L'unico strumento che risponde a "i nostri segnali
   predicono davvero qualcosa?" e' stato muto per tutto il tempo.
   I candidati ora sono in ordine di preferenza e comprendono cio' che la pipeline pubblica:
   NQ=F e' il Nasdaq 100 (il paragone naturale per un libro growth), ^SOX il comparto — che per
   un libro per tre quarti in semiconduttori e' il confronto piu' severo e piu' onesto. */
const CANDIDATI = ["^IXIC", "QQQ", "NQ=F", "^SOX", "^RUT"];
/* ⚠ IL BENCHMARK E' UN'ASSUNZIONE, NON UN DATO: cambia l'asticella contro cui ogni detector
   viene giudicato. Un libro per tre quarti in semiconduttori confrontato col Nasdaq sembra
   piu' bravo di quanto sia; confrontato col SOX, meno. Poterlo cambiare da riga di comando
   serve a vedere se una conclusione REGGE al cambio di riferimento o dipende da esso —
   `--bench ^SOX`. Una conclusione che si ribalta cambiando benchmark non e' una conclusione. */
const _iB = process.argv.indexOf("--bench");
const SCELTO = _iB > 0 ? process.argv[_iB + 1] : null;
const BENCH_TK = SCELTO ? (serie(SCELTO) ? SCELTO : null) : CANDIDATI.find((t) => serie(t));
const BENCH = BENCH_TK ? serie(BENCH_TK) : null;
if (!BENCH) {
  /* ⚠ esce 1, non 0: un backtest che non puo' misurare NON e' andato bene. E dice cosa ha
     cercato e cosa c'era, perche' il difetto sopra e' sopravvissuto proprio non dicendolo. */
  console.error("BACKTEST IMPOSSIBILE: nessun benchmark utilizzabile.");
  console.error(`  cercati (in ordine): ${CANDIDATI.join(", ")}`);
  console.error(`  presenti nell'universo: ${[...universo.keys()].join(", ")}`);
  console.error(`  serve una serie sparks.${SERIE_KEY} di almeno 40 barre.`);
  process.exit(1);
}

/* giorni di BORSA fra due date (approssimazione: esclude sabati e domeniche, ignora le festività —
   su finestre di 2-4 settimane lo scarto è al massimo di una barra ed è identico per titolo e indice) */
function borsaTra(da, a) {
  let n = 0;
  const d = new Date(da + "T00:00:00Z"), fine = new Date(a + "T00:00:00Z");
  while (d < fine) { d.setUTCDate(d.getUTCDate() + 1); const g = d.getUTCDay(); if (g !== 0 && g !== 6) n++; }
  return n;
}
const OGGI = String(data.updated_at || new Date().toISOString()).slice(0, 10);

/* valore della serie N barre PRIMA dell'ultima */
const indietro = (arr, n) => { const i = arr.length - 1 - n; return i >= 0 && i < arr.length ? arr[i] : null; };

/* rendimento RELATIVO del titolo vs benchmark fra il giorno del segnale e ORIZZONTE barre dopo */
function relativoAvanti(tk, dataSegnale) {
  const s = serie(tk);
  if (!s) return null;
  const k = borsaTra(dataSegnale, OGGI);            // barre fa in cui cade il segnale
  const kFine = k - ORIZZONTE;                      // barre fa in cui cade la fine finestra
  if (kFine < 0 || k >= s.length || k >= BENCH.length) return null;   // finestra non ancora matura
  const p0 = indietro(s, k), p1 = indietro(s, kFine);
  const b0 = indietro(BENCH, k), b1 = indietro(BENCH, kFine);
  if (!(p0 > 0 && p1 > 0 && b0 > 0 && b1 > 0)) return null;
  return ((p1 / p0) - (b1 / b0)) * 100;             // punti percentuali di extra-rendimento
}

/* ---------- ricostruzione dei segnali storici da metrics_history ---------- */
const storia = (data.metrics_history || []).filter(x => x && x.date && x.titles && Object.keys(x.titles).length);
const perTicker = new Map();                        // tk -> [{date, rs, mcr}]
for (const s of storia) {
  for (const [tk, v] of Object.entries(s.titles)) {
    if (!perTicker.has(tk)) perTicker.set(tk, []);
    perTicker.get(tk).push({ date: s.date, rs: Number(v.rs), mcr: Number(v.mcr) });
  }
}
for (const arr of perTicker.values()) arr.sort((a, b) => a.date.localeCompare(b.date));

/* i segnali da testare: sono le REGOLE vere dei detector, non approssimazioni */
const SEGNALI = [
  { id: "RS debole (≤ -3pp) — base di «il flusso non conferma la narrativa»",
    attesa: "sottoperformance", test: (o) => o.rs <= -3 },
  { id: "RS molto debole (≤ -15pp)",
    attesa: "sottoperformance", test: (o) => o.rs <= -15 },
  { id: "ΔRS 7g ≥ +5pp — base di «la forza relativa ACCELERA»",
    attesa: "sovraperformance", test: (o) => o.drs7 != null && o.drs7 >= 5 },
  { id: "RS forte (≥ +5pp)",
    attesa: "sovraperformance", test: (o) => o.rs >= 5 },
  { id: "MCR ≥ 25% — base di «è qui che si decide la volatilità»",
    attesa: "nessuna direzione attesa (misura rischio, non rendimento)", test: (o) => o.mcr >= 25 },
];

const esiti = SEGNALI.map(s => ({ ...s, oss: [] }));
const tutti = [];
for (const [tk, arr] of perTicker) {
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    const prec = arr.filter(x => borsaTra(x.date, o.date) >= 5 && borsaTra(x.date, o.date) <= 9).pop();
    o.drs7 = prec ? Math.round((o.rs - prec.rs) * 10) / 10 : null;
    const rel = relativoAvanti(tk, o.date);
    if (rel == null) continue;
    tutti.push({ tk, ...o, rel });
    for (const e of esiti) if (e.test(o)) e.oss.push({ tk, date: o.date, rel, rs: o.rs, drs7: o.drs7, mcr: o.mcr });
  }
}

/* ---------------------------------- rapporto ---------------------------------- */
const med = (a) => a.reduce((s, v) => s + v, 0) / a.length;
console.log(`\nBACKTEST DEI SEGNALI — orizzonte ${ORIZZONTE} giorni di borsa, extra-rendimento vs ${BENCH_TK}`);
console.log(`Storico per-titolo: ${storia.length} giornate (${storia[0]?.date} → ${storia[storia.length - 1]?.date}) · osservazioni mature: ${tutti.length}`);
if (tutti.length) {
  console.log(`Riferimento — TUTTE le osservazioni: media ${med(tutti.map(x => x.rel)).toFixed(2)}pp · quota positive ${Math.round(tutti.filter(x => x.rel > 0).length / tutti.length * 100)}%`);
  console.log("(un segnale è informativo solo se BATTE questo riferimento, non se «va spesso bene»)\n");
}

for (const e of esiti) {
  const n = e.oss.length;
  if (!n) { console.log(`  ${e.id}\n     nessuna osservazione matura nel campione\n`); continue; }
  const rels = e.oss.map(x => x.rel);
  const m = med(rels);
  const quotaNeg = Math.round(rels.filter(r => r < 0).length / n * 100);
  const base = tutti.length ? med(tutti.map(x => x.rel)) : 0;
  const delta = m - base;
  const verdetto = n < MIN_OSS
    ? `campione troppo piccolo (${n} < ${MIN_OSS}): nessun giudizio`
    : e.attesa.startsWith("sotto")
      ? (delta < -0.5 ? `INFORMATIVO: ${delta.toFixed(2)}pp peggio del riferimento` : `NON informativo: ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}pp vs riferimento`)
      : e.attesa.startsWith("sovra")
        ? (delta > 0.5 ? `INFORMATIVO: +${delta.toFixed(2)}pp meglio del riferimento` : `NON informativo: ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}pp vs riferimento`)
        : `dispersione ${(Math.sqrt(med(rels.map(r => (r - m) ** 2)))).toFixed(2)}pp (atteso: più alta della media)`;
  // INDIPENDENZA: osservazioni giornaliere sugli stessi titoli NON sono indipendenti (è la
  // stessa scommessa contata più volte). Si dichiara sempre quanti titoli e quante date
  // distinte ci sono dietro il numero: è il vero campione, e di solito è molto più piccolo.
  const tks = new Set(e.oss.map(x => x.tk)), dates = new Set(e.oss.map(x => x.date));
  console.log(`  ${e.id}`);
  console.log(`     ${n} osservazioni · media ${m.toFixed(2)}pp · negative ${quotaNeg}% · atteso: ${e.attesa}`);
  console.log(`     campione REALE: ${tks.size} titoli distinti su ${dates.size} date — le rilevazioni giornaliere dello stesso titolo si sovrappongono e NON sono indipendenti`);
  console.log(`     → ${verdetto}${tks.size < 5 ? " ⚠ meno di 5 titoli distinti: nessuna generalizzazione possibile" : ""}`);
  if (VERBOSE) e.oss.slice(0, 6).forEach(x => console.log(`        ${x.date} ${x.tk.padEnd(7)} rs=${x.rs} drs7=${x.drs7 ?? "—"} → ${x.rel.toFixed(2)}pp`));
  console.log("");
}
console.log(`NB: campione di poche settimane. Questi sono INDIZI sulla direzione, non prove statistiche:\n    servono osservazioni su più regimi di mercato prima di togliere o promuovere un detector.\n`);
