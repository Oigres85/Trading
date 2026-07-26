#!/usr/bin/env node
/* GATE VALUTA (v183) — nessun importo in dollari può portare il simbolo €.

   Perché esiste: il payload stampava "MSTR … minusvalenza latente -14.123 €" nel blocco delle
   decisioni e "MSTR (-12.117 €)" nella riga fiscale. Il primo era il P&L GREZZO, in dollari,
   formattato con fmtEUR — nella stessa parentesi in cui il controvalore accanto era invece
   convertito. Un LLM reale ha usato il numero sbagliato per dimensionare una compensazione
   fiscale: +13,75% sull'importo, cioè esattamente il cambio.

   Il metodo non richiede di sapere DOVE guardare, ed è la ragione per cui è un gate e non una
   revisione a mano: si genera il payload due volte con EUR/USD diversi e si confrontano tutti
   gli importi in €. Un importo che NON cambia è, o un euro vero (cassa, BTP), o un dollaro
   travestito. Le eccezioni legittime sono elencate qui sotto una per una, con la loro ragione:
   ogni nuovo invariante che non sia in elenco fa fallire il gate e va giustificato.

   Uso:  node scripts/fx_check.mjs [--verbose]                                                */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERBOSE = process.argv.includes("--verbose");
const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
const header = readFileSync(join(ROOT, "config", "prompt_header.txt"), "utf8");
const base = readFileSync(join(ROOT, "data", "data.json"), "utf8").replace(/\bNaN\b/g, "null");

/* Invarianti LEGITTIMI. Non è una lista di numeri (cambiano ogni giorno): è una lista di
   SORGENTI, riconosciute dal contesto in cui l'importo compare nel testo. */
/* NB: Intl.NumberFormat("it-IT") separa cifra e simbolo con uno SPAZIO UNIFICATORE (U+00A0),
   non con lo spazio normale — per questo qui si usa sempre \s, mai " ". Il primo giro di questo
   gate non riconosceva nemmeno "cassa 30.000 €" proprio per quel carattere invisibile. */
const LEGITTIMI = [
  { re: /(?:cassa|liquidità(?: infruttifera| disponibile)?)\s*:?\s*[\d.,]+\s*€/i,
    perche: "la cassa è denominata in euro: per definizione non si muove col cambio" },
  // la nota metodologica fra l'etichetta e la cifra e' lunga ("(STORICO, percentili empirici
  // 12M — onesto sulle code grasse): 9588 €"): il contesto va allargato, non incollato.
  { re: /(?:VaR|Expected Shortfall|\bES\b)[^€]{0,140}€/,
    perche: "VaR/ES sono convertiti in euro DALLA PIPELINE (var95_hist_eur) col cambio del run: "
          + "restano al cambio della pipeline anche quando il client aggiorna i prezzi live" },
  { re: /(?:BUDGET OPERATIVO SPENDIBILE|budget op\.)[^€]*€/i,
    perche: "budget = cassa (euro) − ES95 (già in euro dalla pipeline): eredita l'invarianza di entrambi" },
];

function genera(fx) {
  const el = () => ({ addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: {}, dataset: {}, hidden: true, querySelector: () => el(), querySelectorAll: () => [], closest: () => null });
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    document: { querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(), createElement: () => el(), addEventListener() {}, body: el() },
    localStorage: { getItem: (k) => (k === "prompt_header" ? header : null), setItem() {}, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    navigator: { clipboard: {} }, fetch: () => Promise.reject(),
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0,
    Event: class {}, MutationObserver: class { observe() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "app.js" });
  const d = JSON.parse(base);
  d.eurusd = fx;
  vm.runInContext("DATA=" + JSON.stringify(d) + "; cashEur=30000; recomputeTotals();", ctx);
  return vm.runInContext("buildCIOText()", ctx);
}

/* importi in € con un po' di contesto a sinistra, per poterli attribuire a una sorgente */
function importi(t) {
  return [...t.matchAll(/(-?[\d.]+(?:,\d+)?)\s*€/g)]
    .map(m => ({ testo: m[0], ctx: t.slice(Math.max(0, m.index - 90), m.index + m[0].length) }));
}

const A = importi(genera(1.1375));          // cambio reale
const B = importi(genera(1.5000));          // cambio molto diverso: ogni importo USD deve muoversi

if (A.length !== B.length) {
  console.log(`⚠ i due payload hanno un numero diverso di importi (${A.length} vs ${B.length}): confronto non affidabile`);
  process.exit(1);
}

const sospetti = [];
for (let i = 0; i < A.length; i++) {
  if (A[i].testo !== B[i].testo) continue;                       // si muove col cambio: convertito
  const scusa = LEGITTIMI.find(l => l.re.test(A[i].ctx));
  if (scusa) { if (VERBOSE) console.log(`  ok   ${A[i].testo.padEnd(12)} invariante — ${scusa.perche}`); continue; }
  sospetti.push(A[i]);
}

if (sospetti.length) {
  console.log(`\n❌ GATE VALUTA: ${sospetti.length} importo/i in € non si muovono col cambio e non hanno una sorgente in euro dichiarata.`);
  console.log(`   Delle due l'una: o sono dollari col simbolo sbagliato, o sono euro veri e vanno aggiunti a LEGITTIMI con la loro ragione.\n`);
  for (const s of sospetti) console.log(`   ${s.testo}\n     …${s.ctx.replace(/\s+/g, " ").trim()}`);
  console.log("");
  process.exit(1);
}
console.log(`GATE VALUTA: ${A.length} importi in € nel payload — tutti convertiti, o invarianti per una ragione dichiarata.`);
