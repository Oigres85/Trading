#!/usr/bin/env node
/* GRAFICI DEL LIBRO — RACCOLTI DALLA DASHBOARD, non ridisegnati.
 *
 * ⚠⚠ PERCHE' ESISTE, E PERCHE' SOSTITUISCE grafici.py
 * `scripts/grafici.py` disegnava a mano tre SVG in Python mentre la dashboard ha gia' il
 * proprio sistema di grafici in `assets/app.js` (graficoSerie, barreOrdinate, scala,
 * renderMacroGrafici, renderRischio, renderIndicatori, renderAllocGrafica, renderCredito).
 * Erano DUE IMPLEMENTAZIONI DELLA STESSA DOMANDA — la classe di difetto che questo progetto
 * ha gia' pagato tre volte (v161 usRegularSessionOpen, v207 ramiFedWatch, v316 consegna del
 * pacchetto): due strade divergono, e quando divergono nessuno se ne accorge finche' non
 * mostrano numeri diversi per la stessa cosa. Il CEO lo ha chiesto esplicitamente: i grafici
 * dell'artefatto devono essere QUELLI DELLA DASHBOARD.
 *
 * ⚠ NIENTE ELENCO DI ID SCRITTO A MANO. Un registro fisso di bersagli invecchia da solo e in
 * silenzio: e' la trappola di C10, del red team I6 (indici 16/17 fissi) e di
 * MACRO_CARD_BY_PANEL (v196, copriva 7 pannelli su 37). Qui le funzioni da eseguire si
 * RICAVANO dal sorgente (ogni `function renderXxx()` senza argomenti) e si tiene tutto cio'
 * che ha prodotto un <svg>. Se domani il CEO aggiunge un grafico alla dashboard, compare qui
 * senza che nessuno tocchi questo file.
 *
 * ⚠ E' UN RACCOGLITORE, NON UN DISEGNATORE: se la dashboard non disegna niente, questa pagina
 * lo dichiara e resta vuota. Inventare un grafico che la dashboard non ha e' esattamente
 * quello che si sta togliendo.
 *
 * uso:  node scripts/grafici.mjs             → scrive /tmp/grafici_libro.html
 *       node scripts/grafici.mjs PERCORSO    → lo scrive dove dici
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USCITA = process.argv[2] || "/tmp/grafici_libro.html";

/* ── DOM che CATTURA invece di scartare ────────────────────────────────────────────────
   Lo stub di test_app.mjs ritorna un elemento nuovo a ogni chiamata e butta via l'HTML:
   va bene per testare i calcoli, non per raccogliere il disegno. Qui ogni selettore ha il
   SUO nodo, memorizzato, e l'innerHTML che ci viene scritto resta leggibile. */
const nodi = new Map();

function nuovo(sel) {
  const n = {
    _sel: sel,
    innerHTML: "", textContent: "", className: "", value: "", placeholder: "",
    hidden: true, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    appendChild() {}, remove() {}, after() {}, focus() {}, click() {},
    scrollIntoView() {}, insertBefore() {}, removeChild() {}, setAttribute() {},
    /* ⚠ senza questo, renderAll e renderSellCalc morivano con "insertAdjacentHTML is not a
       function": uno stub incompleto produce un fallimento che sembra un difetto di
       produzione. Si accumula, non si sostituisce: e' quello che fa il browser. */
    insertAdjacentHTML(_pos, html) { this.innerHTML += html; },
    querySelector: (s) => el(s), querySelectorAll: () => [],
    closest: () => null, getAttribute: () => null, hasAttribute: () => false,
    contains: () => false,
    children: [], childNodes: [], parentNode: null,
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
  };
  return n;
}

function el(sel) {
  if (sel == null) return nuovo(null);          // createElement: usa e getta, non si raccoglie
  if (!nodi.has(sel)) nodi.set(sel, nuovo(sel));
  return nodi.get(sel);
}

const storage = new Map();
const ctx = vm.createContext({
  console: { log() {}, warn() {}, error() {}, info() {} },   // i render sono rumorosi: silenzio
  document: {
    querySelector: (s) => el(s), querySelectorAll: () => [],
    getElementById: (id) => el("#" + id),
    createElement: () => nuovo(null), addEventListener() {}, body: el("body"),
  },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
  window: { prompt: () => null, confirm: () => false, addEventListener() {}, matchMedia: () => ({ matches: false }) },
  navigator: { clipboard: { writeText: async () => {} } },
  fetch: () => Promise.reject(new Error("offline (raccoglitore grafici)")),
  setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  Event: class {}, MutationObserver: class { observe() {} },
});

const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
vm.runInContext(src, ctx, { filename: "app.js" });

/* ── i dati VERI, con la loro data ─────────────────────────────────────────────────────
   ⚠ i NaN del JSON vanno neutralizzati: sembrano numeri e non lo sono (regola gia' scritta
   in CLAUDE.md per l'harness del prompt). */
const grezzo = readFileSync(join(ROOT, "data", "data.json"), "utf8");
const DATI = JSON.parse(grezzo.replace(/\bNaN\b/g, "null"));
vm.runInContext("DATA = " + JSON.stringify(DATI) + ";", ctx, { filename: "dati.js" });
try { vm.runInContext("recomputeTotals();", ctx); } catch { /* non tutte le versioni ce l'hanno */ }

/* ── quali funzioni eseguire: RICAVATE dal sorgente, non elencate ──────────────────────── */
const RENDER = [...new Set(
  [...src.matchAll(/^function\s+(render[A-Za-z0-9_]*)\s*\(\s*\)/gm)].map((m) => m[1]),
)];

const falliti = [];
for (const f of RENDER) {
  try { vm.runInContext(`${f}();`, ctx, { filename: `${f}.js` }); }
  catch (e) { falliti.push(`${f}: ${String(e.message).slice(0, 80)}`); }
}

/* ── raccolta: si tiene cio' che ha DAVVERO prodotto un grafico ───────────────────────── */
const blocchi = [];
for (const [sel, n] of nodi) {
  const html = String(n.innerHTML || "");
  /* ⚠ SVG *E* TABELLE, non la prosa — e' la regola gia' scritta in v233 per l'estrazione dai
     pannelli. Le tabelle sono l'analisi finanziaria e di rischio (rischio-tabella,
     credito-tabella, il portafoglio): scartarle lascerebbe fuori meta' di cio' che la
     dashboard sa. La prosa resta fuori: la spiegazione la scrive l'analista, non la pagina. */
  const svg = (html.match(/<svg/g) || []).length;
  const tab = (html.match(/<table/g) || []).length;
  if (!svg && !tab) continue;
  blocchi.push({ sel, html, svg, tab });
}
blocchi.sort((a, b) => (b.svg + b.tab) - (a.svg + a.tab) || a.sel.localeCompare(b.sel));

/* ── l'eta' del dato, dichiarata come ovunque nel progetto ────────────────────────────── */
/* ⚠ SOLO GLI STRUMENTI CON IL CALENDARIO DI WALL STREET. Cripto (-USD, 7 giorni su 7) e
   cambi (=X, ~24/5) hanno legittimamente una seduta diversa dalle azioni: contarli farebbe
   scattare l'avviso "sedute diverse" OGNI fine settimana, e un avviso sempre acceso e' un
   avviso che nessuno legge — la classe di falso allarme che C14 sorveglia. Gli indici (^)
   seguono il calendario USA e restano dentro. */
const calendarioUSA = (t) => !/-USD$|=X$/.test(String(t || ""));
const sedute = [...new Set((DATI.watchlist || [])
  .filter((r) => calendarioUSA(r.ticker))
  .map((r) => r.price_asof).filter(Boolean))].sort();
const libro = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, "data", "libro.json"), "utf8")); }
  catch { return {}; }
})();
const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const capo = [
  `snapshot pipeline ${esc(DATI.updated_at || "n.d.")}`,
  sedute.length ? `seduta dei prezzi ${sedute.map(esc).join(", ")}` : "seduta n.d.",
  libro.al ? `matrice al ${esc(libro.al)} su ${esc(libro.sedute)} sedute` : null,
  libro.posizioni_al ? `posizioni al ${esc(libro.posizioni_al)}` : null,
].filter(Boolean).join(" · ");

const avvisi = [];
if (sedute.length > 1) {
  avvisi.push(`⚠ prezzi su ${sedute.length} sedute diverse (${sedute.map(esc).join(", ")}): `
    + `gli aggregati non descrivono un singolo istante`);
}
if (Object.keys(libro.sedute_scartate || {}).length) {
  avvisi.push("⚠ sedute scartate dalla matrice: "
    + Object.entries(libro.sedute_scartate).map(([g, n]) => `${esc(g)} (${esc(n)} nomi senza barra)`).join(", "));
}
if (libro.perche_esclusi && Object.keys(libro.perche_esclusi).length) {
  avvisi.push("⚠ fuori dalla matrice: "
    + Object.entries(libro.perche_esclusi).map(([t, p]) => `${esc(t)} (${esc(p)})`).join(", "));
}
if (falliti.length) avvisi.push(`⚠ ${falliti.length} render non eseguiti: ${esc(falliti.slice(0, 3).join(" · "))}`);

/* ⚠ il titolo dice cosa c'e' DAVVERO: "tre grafici" era vero quando i grafici erano tre e
   li disegnava questo script. Ora sono quelli della dashboard, e sono molti di piu'. Un
   titolo che mente e' un dato sbagliato come un altro. */
const pagina = `<title>Il libro dalla dashboard</title>
<style>
 :root { --bg:#fff; --fg:#111; --m:#666; --a:#2563eb; --b:#f59e0b; --w:#dc2626;
         --li:#e5e7eb; --green:#16a34a; --red:#dc2626; --blue:#2563eb; --card:#fff; }
 @media (prefers-color-scheme: dark) { :root:not([data-theme=light]) {
   --bg:#0f1115; --fg:#e8eaed; --m:#9aa0a6; --a:#60a5fa; --b:#fbbf24; --w:#f87171;
   --li:#2a2f3a; --green:#4ade80; --red:#f87171; --blue:#60a5fa; --card:#161a21; } }
 :root[data-theme=dark] { --bg:#0f1115; --fg:#e8eaed; --m:#9aa0a6; --a:#60a5fa; --b:#fbbf24;
   --w:#f87171; --li:#2a2f3a; --green:#4ade80; --red:#f87171; --blue:#60a5fa; --card:#161a21; }
 body { background:var(--bg); color:var(--fg); margin:0; padding:22px; max-width:900px;
        font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
 h1 { font-size:21px; margin:0 0 4px; }
 h2 { font-size:15px; margin:0 0 10px; color:var(--m); font-weight:600;
      text-transform:uppercase; letter-spacing:.04em; }
 h3, h4 { font-size:16px; margin:20px 0 2px; }
 .capo { color:var(--m); font-size:13px; border-bottom:1px solid var(--li); padding-bottom:12px; }
 .av { color:var(--w); font-size:13px; margin-top:6px; }
 .blocco { margin:26px 0; padding:16px; border:1px solid var(--li); border-radius:8px;
           background:var(--card); overflow-x:auto; }
 svg { width:100%; height:auto; overflow:visible; max-width:100%; }
 text { fill:var(--fg); font:12px -apple-system,sans-serif; }
 table { border-collapse:collapse; font-size:13px; }
 td, th { padding:3px 8px; border-bottom:1px solid var(--li); text-align:right; }
 td:first-child, th:first-child { text-align:left; }
 p, .n { color:var(--m); font-size:13.5px; }
 .vuoto { color:var(--w); padding:20px; border:1px dashed var(--w); border-radius:8px; }
</style>
<h1>Il libro dalla dashboard</h1>
<div class="capo">${capo}${avvisi.map((a) => `<div class="av">${a}</div>`).join("")}</div>
${blocchi.length
    ? blocchi.map((b) => `<div class="blocco" data-da="${esc(b.sel)}">${b.html}</div>`).join("\n")
    : `<div class="vuoto">La dashboard non ha prodotto nessun grafico in questo run.
       Non ne viene disegnato uno di ripiego: un grafico che la dashboard non ha sarebbe
       un'invenzione, non una misura.</div>`}
<p class="n" style="margin-top:26px">Grafici RACCOLTI dalla dashboard (<code>assets/app.js</code>),
non ridisegnati: sono gli stessi che vedi nella pagina. Misure su una finestra passata, non
previsioni. Raccolti ${blocchi.length} blocchi (${blocchi.reduce((a, b) => a + b.svg, 0)} grafici,
${blocchi.reduce((a, b) => a + b.tab, 0)} tabelle) da ${RENDER.length} funzioni di render.
Generato ${new Date().toLocaleString("it-IT", { timeZone: "Europe/Rome" })}.</p>
`;

writeFileSync(USCITA, pagina, "utf8");
console.log(`scritto ${USCITA} (${pagina.length.toLocaleString("it-IT")} byte) — `
  + `${blocchi.length} blocchi raccolti da ${RENDER.length} render`
  + (falliti.length ? `, ${falliti.length} render falliti` : ""));
if (!blocchi.length) process.exit(1);   // ⚠ una pagina senza grafici non e' un successo
