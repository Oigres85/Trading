#!/usr/bin/env node
/* CONTROLLO DI COERENZA DEL PAYLOAD (v170) — le incoerenze INTERNE, una volta per tutte.

   Perché esiste: audit_data.py verifica i DATI (valori impossibili, campi rotti) e redteam.mjs
   verifica gli INVARIANTI FINANZIARI (stop<limite, righe=conteggi, riferimenti pendenti). Nessuno
   dei due vede la classe di difetto più insidiosa: il payload che CONTRADDICE SE STESSO — la stessa
   grandezza con due valori, una riga che si dichiara fresca mentre un'altra dice mercato chiuso, una
   somma che non torna coi suoi addendi, un titolo che è insieme candidato e vetato.
   Quei difetti non rendono il payload invalido: lo rendono INAFFIDABILE, ed è peggio, perché il
   lettore non ha modo di sapere quale delle due affermazioni credere.

   Ogni controllo qui nasce da un'incoerenza REALMENTE trovata (o dalla sua classe). Uso:
     node scripts/coherence_check.mjs            # sul data.json del repo
     node scripts/coherence_check.mjs --verbose  # mostra anche i confronti passati
   Exit 1 se trova incoerenze: è un gate, non un rapporto informativo. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERBOSE = process.argv.includes("--verbose");
const PROBLEMI = [];
const PASSATI = [];
const flag = (classe, msg) => PROBLEMI.push({ classe, msg });
const ok = (msg) => PASSATI.push(msg);

/* ---------- genera il payload FEDELE al browser (stesso harness dei test) ---------- */
function generaPayload() {
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const el = () => ({
    addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, dataset: {}, hidden: true, querySelector: () => el(), querySelectorAll: () => [], closest: () => null,
  });
  const leggi = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return null; } };
  const store = {
    prompt_header: leggi("config/prompt_header.txt"),
    risk_params_overrides: leggi("config/risk_params.json"),
    action_diary: leggi("config/action_diary.json"),
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    document: { querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(), createElement: () => el(), addEventListener() {}, body: el() },
    localStorage: { getItem: (k) => store[k] ?? null, setItem() {}, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    navigator: { clipboard: {} }, fetch: () => Promise.reject(new Error("offline")),
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
    Event: class {}, MutationObserver: class { observe() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "app.js" });
  const d = JSON.parse(readFileSync(join(ROOT, "data", "data.json"), "utf8").replace(/\bNaN\b/g, "null"));
  vm.runInContext("DATA=" + JSON.stringify(d) + "; cashEur=30000; recomputeTotals();", ctx);
  return { testo: vm.runInContext("buildCIOText()", ctx), ctx, data: d };
}

/* numero italiano ("1.234,5" / "-9,3") → Number */
const num = (s) => {
  if (s == null) return null;
  let x = String(s).trim();
  // il payload mescola formato italiano (1.234,5) e inglese (18.58): si distingue dalla virgola.
  // Senza questa distinzione "18.58" diventava 1858 — il primo falso positivo di questo checker.
  if (x.includes(",")) x = x.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, "");   // 1.234 = migliaia
  const v = parseFloat(x);
  return Number.isFinite(v) ? v : null;
};
const primo = (t, re) => { const m = t.match(re); return m ? num(m[1]) : null; };

/* ═══════════ C1 — STESSA GRANDEZZA, VALORI DIVERSI ═══════════════════════════════════
   La classe più pericolosa: il lettore non sa quale credere. Tolleranza sull'arrotondamento
   dichiarato (le cifre significative differiscono per blocco), non sul valore. */
function c1_valoriRipetuti(t) {
  const gruppi = [
    { nome: "Sharpe di portafoglio", toll: 0.06, fonti: [
      ["brief", /· Investito[^\n]*Sharpe ([\d,]+)/],
      ["METRICHE DI RISCHIO", /Sharpe Ratio portafoglio ([\d,]+)/],
      ["CINEMATICA", /- Sharpe di portafoglio ([\d,]+)/],
      ["REGIME DI VARIANZA", /Sharpe ptf ([\d,]+)/],
    ] },
    { nome: "VIX", toll: 0.06, fonti: [
      ["brief", /· Investito[^\n]*VIX ([\d,]+)/],
      ["QUADRO MACRO", /- VIX: ([\d.]+)/],
      ["CINEMATICA", /- VIX ([\d,]+) \(Δ7g/],
    ] },
    { nome: "budget operativo spendibile", toll: 1, fonti: [
      ["brief", /budget op\. ([\d.]+)/],
      ["METRICHE DI RISCHIO", /BUDGET OPERATIVO SPENDIBILE[^:]*: ([\d.]+) €/],
    ] },
    { nome: "controvalore investito", toll: 12, fonti: [
      ["brief", /· Investito €([\d.]+)/],
      ["ROTAZIONE", /controvalore investito \(mark-to-market\): ([\d.]+) €/],
    ] },
    { nome: "liquidità", toll: 1, fonti: [
      ["brief", /· cassa ([\d.]+) €/],
      ["SITUAZIONE PATRIMONIALE", /liquidità ([\d.]+) €/],
      ["ROTAZIONE", /Liquidità disponibile: ([\d.]+) €/],
    ] },
  ];
  for (const g of gruppi) {
    const letti = g.fonti.map(([dove, re]) => [dove, primo(t, re)]).filter(x => x[1] != null);
    if (letti.length < 2) continue;
    const vals = letti.map(x => x[1]);
    const spread = Math.max(...vals) - Math.min(...vals);
    if (spread > g.toll) {
      flag("C1 valore contraddittorio",
        `"${g.nome}" compare con valori diversi: ${letti.map(x => `${x[0]}=${x[1]}`).join(" · ")} (scarto ${spread.toFixed(2)} > tolleranza ${g.toll})`);
    } else ok(`C1 ${g.nome}: ${letti.length} occorrenze coerenti (${vals.join("/")})`);
  }
}

/* ═══════════ C2 — FRESCHEZZA CONTRADDITTORIA ═════════════════════════════════════════
   Se il payload dichiara mercato CHIUSO, nessuna riga può dirsi "rilevazione odierna":
   è il difetto trovato sul VIX, che era l'unico dato a contraddire il contesto di sessione. */
function c2_freschezza(t) {
  const chiuso = /MERCATI CHIUSI|fase: (WEEKEND|NOTTE|PRE-MARKET|AFTER-HOURS)/i.test(t);
  if (!chiuso) { ok("C2 sessione aperta: nessun vincolo di freschezza da verificare"); return; }
  const colpevoli = t.split("\n").filter(l => /rilevazione odierna|\boggi\b —/i.test(l) && !/ultima seduta|chiusura del/i.test(l));
  if (colpevoli.length) {
    flag("C2 freschezza contraddittoria",
      `mercato dichiarato CHIUSO ma ${colpevoli.length} riga/e si dichiarano di oggi: ${colpevoli.map(l => l.trim().slice(0, 72)).join(" | ")}`);
  } else ok("C2 mercato chiuso: nessuna riga si dichiara 'rilevazione odierna'");
}

/* ═══════════ C3 — SOMME CHE NON TORNANO ══════════════════════════════════════════════
   Una % dichiarata deve corrispondere ai suoi addendi, o dichiarare cosa manca (fu il caso
   del troncamento a 8 dei target di tema, corretto in v163). */
function c3_somme(t) {
  const mcr = [...t.matchAll(/^\| (\w[\w.\-=^]*) \| [\d,]+% \| [\d,\-]+ \| ([\d,]+)% \|/gm)].map(m => num(m[2])).filter(x => x != null);
  if (mcr.length) {
    const s = mcr.reduce((a, b) => a + b, 0);
    if (Math.abs(s - 100) > 1.5) flag("C3 somma incoerente", `la matrice di rischio dichiara MCR che sommano a ${s.toFixed(1)}% invece di 100%`);
    else ok(`C3 matrice MCR: somma ${s.toFixed(1)}% ≈ 100%`);
  }
  // l'esposizione DICHIARATA da ogni tema deve tornare con la somma dei pesi di TUTTE le sue
  // posizioni detenute (non solo di quelle stampate): è l'invariante che il troncamento a 8
  // rischiava di rompere. Si verifica sui dati del motore, non contando i separatori nel testo.
  for (const m of t.matchAll(/^  \[([^\]]+)\][^\n]*— esposizione in PTF ([\d,]+)% del NAV/gm)) {
    const dichiarata = num(m[2]);
    const nascoste = /\(\+(\d+) detenute non elencate: ([\d,]+)% del NAV\)/.exec(m[0]);
    if (dichiarata == null) continue;
    if (nascoste) {
      const q = num(nascoste[2]);
      if (q != null && q > dichiarata) {
        flag("C3 somma incoerente", `il tema [${m[1]}]: la quota non elencata (${q}%) supera l'esposizione totale dichiarata (${dichiarata}%)`);
      }
    }
  }
  ok("C3 temi: esposizioni dichiarate coerenti con le quote non elencate");
}

/* ═══════════ C4 — VERDETTI CONTRADDITTORI SULLO STESSO TITOLO ════════════════════════
   Un titolo non può essere insieme candidato all'ACQUISTO e vietato dal veto. */
function c4_verdetti(t, ctx) {
  let dv;
  try { dv = JSON.parse(vm.runInContext(`JSON.stringify({acc:decisionVerdict().accumula.map(r=>r.ticker),veto:decisionVerdict().excluded.map(x=>x.r.ticker)})`, ctx)); }
  catch { return; }
  const doppi = dv.acc.filter(tk => dv.veto.includes(tk));
  if (doppi.length) flag("C4 verdetto contraddittorio", `${doppi.join(", ")}: candidati all'accumulo E in veto nello stesso payload`);
  else ok(`C4 nessun titolo è insieme candidato e vetato (${dv.acc.length} candidati, ${dv.veto.length} vetati)`);
}

/* ═══════════ C5 — SOGLIE vs VALORI DICHIARATI ════════════════════════════════════════
   Se una riga dice "oltre la soglia X" il valore citato deve davvero superarla. */
function c5_soglie(t) {
  for (const m of t.matchAll(/([\d,]+)% della VARIANZA[^—]*— oltre la soglia del ([\d,]+)%/g)) {
    const v = num(m[1]), s = num(m[2]);
    if (v != null && s != null && v <= s) flag("C5 soglia incoerente", `dichiarato "oltre la soglia" ma ${v}% ≤ ${s}%`);
  }
  for (const m of t.matchAll(/oltre il ([\d,]+)% \(soglia CEO[^)]*\)/g)) { /* forma alternativa */ }
  ok("C5 soglie citate coerenti coi valori");
}

/* ═══════════ C6 — TERMINOLOGIA DIVERGENTE ════════════════════════════════════════════
   Lo stesso dato non deve avere due NOMI (fu il caso di ROE stampato come ROIC, e di
   Altman etichettato [RISCHIO DEFAULT] in una tabella e [DISTRESS] nell'altra). */
function c6_terminologia(t) {
  const coppie = [
    { a: /\[ROIC>15%\]/, b: /\[ROE>15%\]/, msg: "il tag di qualità del capitale compare sia come ROIC sia come ROE: sono grandezze diverse" },
    { a: /\[RISCHIO DEFAULT\]/, b: /\[DISTRESS\]/, msg: "l'Altman Z'' è etichettato in due modi diversi nello stesso payload" },
  ];
  for (const c of coppie) {
    if (c.a.test(t) && c.b.test(t)) flag("C6 terminologia divergente", c.msg);
  }
  ok("C6 nessuna grandezza con due nomi diversi");
}

/* ═══════════ C7 — BUDGET E VINCOLI DI SPESA ══════════════════════════════════════════
   Il capitale liquidabile è CONTESTO: non deve mai essere presentato come spendibile oggi
   (correzione del CEO: finché non hai venduto, il budget è quello attuale). */
function c7_budget(t) {
  const riga = t.split("\n").find(l => l.includes("CAPITALE IMMOBILIZZATO"));
  if (!riga) { ok("C7 nessuna riga di capitale liquidabile in questo payload"); return; }
  if (!/NON budget/.test(riga) || !/non possono superarlo/.test(riga)) {
    flag("C7 budget ambiguo", "il capitale liquidabile non è dichiarato esplicitamente come contesto e non come capienza di spesa");
  } else ok("C7 capitale liquidabile dichiarato come contesto, budget di oggi invariato");
}

/* ═══════════ C8 — DENOMINATORI DICHIARATI ════════════════════════════════════════════
   Percentuali della stessa famiglia con basi diverse devono dichiarare la base (il caso
   degli alpha del BENCHMARK: giorno su equity USD, 1S/1M su book intero in EUR). */
function c8_denominatori(t) {
  const bm = t.split("\n").find(l => l.includes("BENCHMARK vs Nasdaq"));
  if (bm && !/BASI DIVERSE|stessa base/i.test(bm)) {
    flag("C8 denominatore non dichiarato", "la riga BENCHMARK accosta finestre senza dichiarare che hanno basi di calcolo diverse");
  } else if (bm) ok("C8 BENCHMARK: basi di calcolo dichiarate");
  const conc = t.split("\n").find(l => l.includes("Concentrazione per settore"));
  if (conc && !/denominatore diverso|% del PATRIMONIO TOTALE/.test(conc)) {
    flag("C8 denominatore non dichiarato", "la concentrazione settoriale non dichiara il proprio denominatore");
  } else if (conc) ok("C8 concentrazione settoriale: denominatore dichiarato");
}

/* ---------------------------------- esecuzione ---------------------------------- */
const { testo, ctx } = generaPayload();
c1_valoriRipetuti(testo);
c2_freschezza(testo);
c3_somme(testo);
c4_verdetti(testo, ctx);
c5_soglie(testo);
c6_terminologia(testo);
c7_budget(testo);
c8_denominatori(testo);

if (VERBOSE) PASSATI.forEach(p => console.log(`  ok   ${p}`));
if (PROBLEMI.length) {
  console.log(`\nINCOERENZE TROVATE: ${PROBLEMI.length}\n`);
  PROBLEMI.forEach((p, i) => console.log(`  ${i + 1}. [${p.classe}] ${p.msg}\n`));
  process.exit(1);
}
console.log(`COERENZA PAYLOAD: ${PASSATI.length} controlli superati su 8 classi — nessuna incoerenza interna`);
