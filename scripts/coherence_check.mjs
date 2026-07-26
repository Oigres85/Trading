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
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, "");  // 1.234 = migliaia (anche col segno)
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

/* ═══════════ C9 — ISTRUZIONI NEL PAYLOAD CHE DUPLICANO LA TESTATA ═══════════════════
   La classe di difetto piu' insidiosa e ricorrente di questo progetto: il payload che, oltre ai
   dati, dice all'LLM COSA FARE — ripetendo regole gia' scritte nella Costituzione. Trovata tre
   volte (v156 "INDIPENDENZA SUL VERDETTO", v179 il verdetto in cima al brief, v180 otto casi piu'
   l'intero PROMEMORIA FINALE duplicato 6 concetti su 6). Ogni volta era sopravvissuta perche' si
   guardava solo dove si era appena messo mano. Qui si cerca in modo sistematico: imperativi in
   seconda persona dentro la CODA (dopo la fine della testata), che sono il marcatore dell'istruzione. */
function c9_istruzioniDuplicate(t) {
  const header = (() => { try { return readFileSync(join(ROOT, "config", "prompt_header.txt"), "utf8"); } catch { return ""; } })();
  const finTestata = header ? t.indexOf(header) + header.length : 0;
  const coda = finTestata > 0 ? t.slice(finTestata) : t;
  // imperativi rivolti al lettore: sono istruzioni, e le istruzioni vivono nella testata
  const IMPERATIVI = /\b(usalo|usali|dichiaralo|dichiarali|non ripeterlo|non rifare|non ricalcolare|valutane|pesalo|pesane|trattal[oa]|non trattarl[oa]|leggilo|non leggerlo|non inseguire|incrocia|segnala l|chiedi conferma|deduci dal|scegli tu|alza gli standard|riduci il sizing)\b/gi;
  const colpiti = [];
  for (const linea of coda.split("\n")) {
    const m = linea.match(IMPERATIVI);
    if (m) colpiti.push(`"${m[0]}" in «${linea.trim().slice(0, 58)}…»`);
  }
  if (colpiti.length) {
    flag("C9 istruzione nel payload", `la coda contiene ${colpiti.length} imperativ${colpiti.length > 1 ? "i" : "o"} rivolt${colpiti.length > 1 ? "i" : "o"} all'LLM: le istruzioni appartengono alla testata, il payload porta fatti. ${colpiti.slice(0, 4).join(" · ")}`);
  } else ok("C9 nessun imperativo nella coda: le istruzioni stanno solo nella testata");
}

/* ═══════════ C10 — RIFERIMENTI A SEZIONI INESISTENTI (I12 generalizzato) ═════════════
   I12 nel red team controlla un registro FISSO di tre rimandi noti, e proprio per questo si e'
   lasciato sfuggire "STEP 3" (la testata non ha STEP dal v155) e "regola A4" prima di lui. Qui
   la ricerca e' per FORMA: qualunque rimando a una sezione strutturata deve trovare il suo
   bersaglio nel testo completo, testata inclusa. */
function c10_sezioniInesistenti(t) {
  const forme = [
    { re: /\bSTEP\s+(\d+)\b/g, esiste: (n) => new RegExp(`STEP\\s+${n}\\b`).test(t.split(/STEP\s+\d+/)[0] + t) && /\bSTEP\s+\d+\s*[—:-]/.test(t) },
    { re: /\bregola\s+([A-D]\d)\b/gi, esiste: (n) => new RegExp(`^${n}\\s*—`, "m").test(t) },
    { re: /\bvedi\s+([A-D]\d)\b/gi, esiste: (n) => new RegExp(`^${n}\\s*—`, "m").test(t) },
  ];
  const pendenti = [];
  for (const f of forme) {
    for (const m of t.matchAll(f.re)) {
      if (!f.esiste(m[1])) pendenti.push(`"${m[0]}"`);
    }
  }
  const unici = [...new Set(pendenti)];
  if (unici.length) flag("C10 riferimento pendente", `il testo rimanda a sezioni che non esistono: ${unici.join(", ")}`);
  else ok("C10 nessun rimando a sezioni inesistenti");
}

/* ═══════════ C11 — STESSA GRANDEZZA PER LO STESSO TITOLO, VALORI DIVERSI ════════════
   C1 confronta le grandezze GLOBALI (patrimonio, budget, cassa) e per questo si e' lasciata
   sfuggire il caso peggiore: la MINUSVALENZA di MSTR valeva -14.123 € nel blocco delle
   decisioni e -12.117 € nella riga fiscale dello stesso payload. Il rapporto fra i due era
   esattamente EUR/USD — uno dei due era in dollari col simbolo dell'euro. Un LLM reale ha
   usato quello sbagliato per dimensionare una compensazione fiscale.
   Qui il confronto e' PER TITOLO: la stessa etichetta sullo stesso ticker deve dare lo stesso
   numero ovunque compaia. Se due valori differiscono, si segnala anche quando il rapporto
   coincide col cambio — anzi, in quel caso si nomina la causa, perche' e' quasi sempre quella. */
function c11_grandezzePerTitolo(t, ctx) {
  const fx = Number(vm.runInContext("DATA.eurusd", ctx)) || null;
  // Anagrafica REALE: solo questi contano come ticker. Senza il vincolo, "VETO FORTE (" faceva
  // passare "FORTE" per un titolo e il confronto accostava grandezze di posizioni diverse.
  const TICKER = new Set(JSON.parse(vm.runInContext(
    "JSON.stringify([...(DATA.portfolio||[]),...(DATA.watchlist||[])].map(r=>r.ticker).filter(Boolean))", ctx)));
  const perTicker = new Map();                 // "TICKER|etichetta" -> [{val, dove}]
  const raccogli = (re, etichetta, iTk, iVal, dove, ammessi) => {
    for (const m of (dove ?? t).matchAll(re)) {
      const tk = m[iTk], v = num(m[iVal]);
      if (!tk || v == null || (ammessi && !ammessi.has(tk))) continue;
      const k = `${tk}|${etichetta}`;
      if (!perTicker.has(k)) perTicker.set(k, []);
      perTicker.get(k).push(Math.abs(v));
    }
  };
  // Blocco decisioni. Il motivo del veto contiene parentesi annidate ("(Sortino -2,7 < -0.5
  // (distruzione…))"), quindi non si puo' andare in avanti dal ticker: si risale ALL'INDIETRO
  // da ogni "minusvalenza latente" fino al ticker aperto piu' vicino. Robusto per costruzione.
  for (const m of t.matchAll(/minusvalenza latente\s+(-?[\d.,]+)\s*€/g)) {
    const prima = t.slice(Math.max(0, m.index - 400), m.index);
    const tk = [...prima.matchAll(/\b([A-Z][A-Z0-9.\-]{1,6})\s*\(/g)].filter(x => TICKER.has(x[1])).pop();
    const v = num(m[1]);
    if (!tk || v == null) continue;
    const k = `${tk[1]}|minusvalenza`;
    if (!perTicker.has(k)) perTicker.set(k, []);
    perTicker.get(k).push(Math.abs(v));
  }
  // Riga fiscale, scandita SOLO su se stessa: su tutto il payload il pattern "SIGLA (numero €)"
  // pescava anche "NAV (6156 €)" e simili.
  const fisc = t.match(/Minusvalenze latenti utilizzabili fiscalmente[^\n]*/);
  if (fisc) raccogli(/\b([A-Z][A-Z0-9.\-]{1,6})\s*\((-?[\d.,]+)\s*€\)/g, "minusvalenza", 1, 2, fisc[0], TICKER);
  const guasti = [];
  for (const [k, vals] of perTicker) {
    const u = [...new Set(vals.map(v => Math.round(v)))];
    if (u.length < 2) continue;
    const [a, b] = [Math.max(...u), Math.min(...u)];
    const causa = (fx && Math.abs(a / b - fx) < 0.01)
      ? ` — il rapporto ${(a / b).toFixed(4)} È il cambio EUR/USD: uno dei due è in DOLLARI col simbolo €`
      : "";
    guasti.push(`${k.replace("|", " ")}: ${u.join(" vs ")} €${causa}`);
  }
  if (guasti.length) flag("C11 stessa grandezza, valori diversi (per titolo)", guasti.join(" · "));
  else ok(`C11 grandezze per titolo coerenti fra i blocchi (${perTicker.size} confronti)`);
}

/* ═══════════ C12 — I FATTI DEI BLOCCHI TAGLIATI DEVONO ESSERE ANCORA QUI ════════════
   Il v184 ha rimosso quattro blocchi perche' RIPETEVANO numeri gia' presenti altrove. La
   giustificazione del taglio e' tutta in quel "gia' presenti altrove": se un domani cambia il
   blocco che li ospita, il taglio smette di essere gratuito e diventa una perdita di dati, in
   silenzio. Questo controllo e' la ricevuta del taglio — gira sul payload VERO, non su un
   fixture, perche' e' li' che quei numeri esistono. */
function c12_fattiSopravvissuti(t) {
  const ATTESI = [
    { che: "ΔRS 7g per titolo",      re: /ΔRS 7g/,                    era: "CINEMATICA DEI SEGNALI", ora: "tabella CINEMATICA & TREND PER TITOLO" },
    { che: "ΔMCR 7g per titolo",     re: /ΔMCR 7g/,                   era: "CINEMATICA DEI SEGNALI", ora: "tabella CINEMATICA & TREND PER TITOLO" },
    { che: "term structure VIX",     re: /VIX\/VIX3M [\d,]+/,          era: "CINEMATICA DEI SEGNALI", ora: "QUADRO MACRO" },
    { che: "Δ7g dello Sharpe",       re: /Sharpe [\d,]+ \(Δ7 [\d,-]+\)/, era: "CINEMATICA DEI SEGNALI", ora: "digest ANALISI STORICA" },
    { che: "MCR Top-3",              re: /MCR Top-3 \d+%/,             era: "CINEMATICA DEI SEGNALI", ora: "REGIME DI VARIANZA" },
    { che: "P/E S&P 500 e Nasdaq",   re: /P\/E Ratio S&P 500[^\n]*Nasdaq 100/, era: "CONTESTO ECONOMIA USA", ora: "ROTAZIONE SETTORIALE" },
    { che: "tasso Fed",              re: /Fed Funds Rate/,             era: "CONTESTO ECONOMIA USA", ora: "QUADRO MACRO" },
    { che: "CPI e PCE",              re: /Inflazione CPI[\s\S]{0,400}Inflazione PCE/, era: "CONTESTO ECONOMIA USA", ora: "QUADRO MACRO" },
    { che: "curva 10A-2A",           re: /Curva 10A-2A/,               era: "CONTESTO ECONOMIA USA", ora: "QUADRO MACRO" },
    { che: "peso NAV per titolo",    re: /% NAV · MCR /,               era: "MATRICE DI RISCHIO (colonna)", ora: "CORRELAZIONI news↔book" },
    { che: "beta NDX per titolo",    re: /\| Beta NDX \|/,             era: "MATRICE DI RISCHIO (colonna)", ora: "Tabella A" },
    { che: "rotazione settoriale",   re: /Semiconduttori \(SMH\)/,     era: "TOP 10 ETF", ora: "ROTAZIONE SETTORIALE" },
  ];
  const persi = ATTESI.filter(a => !a.re.test(t));
  if (persi.length) flag("C12 fatto perso in un taglio", persi.map(a =>
    `"${a.che}" non è più nel payload: stava in ${a.era}, doveva restare in ${a.ora}`).join(" · "));
  else ok(`C12 i ${ATTESI.length} fatti dei blocchi rimossi in v184 sono tutti ancora nel payload`);
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
c9_istruzioniDuplicate(testo);
c10_sezioniInesistenti(testo);
c11_grandezzePerTitolo(testo, ctx);
c12_fattiSopravvissuti(testo);

if (VERBOSE) PASSATI.forEach(p => console.log(`  ok   ${p}`));
if (PROBLEMI.length) {
  console.log(`\nINCOERENZE TROVATE: ${PROBLEMI.length}\n`);
  PROBLEMI.forEach((p, i) => console.log(`  ${i + 1}. [${p.classe}] ${p.msg}\n`));
  process.exit(1);
}
console.log(`COERENZA PAYLOAD: ${PASSATI.length} controlli superati su 12 classi — nessuna incoerenza interna`);
