#!/usr/bin/env node
/* ═══ v342 — IL PACCHETTO MACRO COME FILE, PER CHI NON PUO' APRIRE LA PAGINA ══════════════
   Il CEO: "riporti anche tutto ciò che possiamo dal sistema macro cosicché sia tu ad
   acquisire il quadro macro senza che io copi o incolli o apra il repo".
   Il repo e' PUBBLICO: se il pacchetto esiste come file, un assistente lo scarica da solo a
   ogni conversazione e resta fresco perche' la pipeline gira su cron. Niente da incollare.

   ⚠⚠ NON RISCRIVE IL PACCHETTO: lo ESEGUE. Il testo viene da buildCIOText() dentro app.js,
   caricato in una vm col medesimo harness documentato in CLAUDE.md. Una seconda
   implementazione in Node o in Python avrebbe cominciato a divergere dalla prima al primo
   ritocco — e' la classe v161/v207, pagata piu' volte in questo progetto.

   ⚠ La testata attiva e' config/prompt_header_macro.txt: si inietta in localStorage come fa
   il browser, altrimenti il pacchetto uscirebbe con il fallback e provenienzaTestata() lo
   dichiarerebbe (giustamente) come "testata locale".

   ⚠ IL FILE E' PUBBLICO: contiene SOLO il quadro macro. Dalla v341 i pacchetti di titolo,
   settore e portafoglio non esistono piu', quindi non c'e' nessuna posizione qui dentro —
   ed e' un invariante da non perdere: se un domani tornasse un pacchetto col portafoglio,
   NON va scritto in questo file. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
const testata = readFileSync(join(ROOT, "config", "prompt_header_macro.txt"), "utf8");

/* il minimo indispensabile perche' app.js si carichi fuori dal browser */
const el = () => ({
  addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  style: {}, dataset: {}, hidden: true, value: "", textContent: "", innerHTML: "",
  querySelector: () => el(), querySelectorAll: () => [], closest: () => null,
  appendChild() {}, insertAdjacentHTML() {}, remove() {}, focus() {}, getBoundingClientRect: () => ({}),
});
const ctx = {
  console,
  document: { querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(),
              createElement: () => el(), addEventListener() {}, body: el(), documentElement: el() },
  localStorage: { getItem: (k) => (k === "prompt_header" ? testata : null), setItem() {}, removeItem() {} },
  window: { addEventListener() {}, matchMedia: () => ({ matches: false }), innerWidth: 1280 },
  navigator: { clipboard: {} },
  fetch: () => Promise.reject(new Error("offline")),
  setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  Event: class {}, MutationObserver: class { observe() {} disconnect() {} },
  URL: { createObjectURL: () => "", revokeObjectURL() {} },
};
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: "app.js" });

/* ⚠ i NaN che la pipeline puo' lasciare nel JSON non sono JSON valido per JSON.parse */
const dati = readFileSync(join(ROOT, "data", "data.json"), "utf8").replace(/\bNaN\b/g, "null");
vm.runInContext(`DATA = ${dati};`, ctx);

const pacchetto = vm.runInContext("buildCIOText()", ctx);

/* ── le tre guardie: un file vuoto o mutilato e' peggio di nessun file, perche' chi lo legge
      non ha modo di accorgersene ── */
if (typeof pacchetto !== "string" || pacchetto.length < 8000) {
  console.error(`✗ pacchetto troppo corto (${(pacchetto || "").length} caratteri): non lo scrivo`);
  process.exit(1);
}
if (!/QUADRO MACRO/.test(pacchetto)) {
  console.error("✗ manca il blocco QUADRO MACRO: non lo scrivo");
  process.exit(1);
}
/* ⚠ e non deve MAI contenere posizioni: il file finisce in un repository pubblico */
for (const spia of ["SITUAZIONE PATRIMONIALE", "IL SUO LIBRO", "quote a carico", "PMC"]) {
  if (pacchetto.includes(spia)) {
    console.error(`✗ il pacchetto contiene "${spia}": e' un dato di portafoglio e questo file e' PUBBLICO`);
    process.exit(1);
  }
}

writeFileSync(join(ROOT, "data", "macro_pack.txt"), pacchetto);
console.log(`✓ data/macro_pack.txt — ${pacchetto.length.toLocaleString("it")} caratteri, ${pacchetto.split("\n").length} righe`);
