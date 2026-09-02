#!/usr/bin/env node
/* ═══ v277 — IL GATE CHE GUARDA IL SISTEMA, NON I DATI ═══════════════════════════════════════
   Nasce da due errori fatti nella stessa giornata, nessuno dei quali e' stato preso da un
   gate — e non per caso: tutti gli altri controllano il PRODOTTO (i numeri, il payload, la
   pagina), nessuno controlla l'OPERAZIONE che lo modifica.

   1. Rimuovendo la watchlist ho DUPLICATO quattro funzioni (fattiTitolo, livelliTitolo,
      renderOpzioniGrafico, montaGraficoTV). In JavaScript la seconda definizione vince in
      silenzio: il file girava, tutti i 120 check passavano, e c'erano due copie della stessa
      logica destinate a divergere al primo ritocco. Trovata solo confrontando a mano.

   2. Uno script che toglieva check dalla suite contava le parentesi ignorando le stringhe, e
      su una regex che conteneva virgolette — /data-wl-vista="tabella"/ — ha tagliato via META'
      FILE, blocco del report compreso. Risultato: `node scripts/test_app.mjs` usciva con
      CODICE 0 SENZA STAMPARE NIENTE. Verde per assenza di test. Se non mi fossi insospettito
      del silenzio, avrei spinto un sistema con 59 controlli spariti credendolo verificato.

   Sono lo stesso difetto in due forme: UNA MODIFICA CHE RIESCE A META' E NON LO DICE.
   Questo file e' il controllo che li avrebbe presi entrambi. Sta SEPARATO dalle suite proprio
   perche' una delle due cose che deve sorvegliare e' che le suite non vengano svuotate: un
   guardiano dentro la stanza che sorveglia non serve a niente. */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const F = [];
const ESITI = [];
const check = (nome, ok) => {
  if (typeof ok !== "boolean") { ESITI.push([nome, false]); F.push(`${nome} [check malformato]`); return; }
  ESITI.push([nome, ok]);
  if (!ok) F.push(nome);
};

/* ─────────────────────────────────────────────────────────────────────────────────────────
   1. NESSUNA DEFINIZIONE DUPLICATA
   ───────────────────────────────────────────────────────────────────────────────────────── */

/* Si guarda il SORGENTE spogliato di commenti e stringhe: dentro un commento la parola
   "function fattiTitolo" compare eccome (in questo progetto i commenti sono lunghi e citano i
   nomi), e un controllo che non lo sapesse segnalerebbe duplicati inesistenti — cioe' urlerebbe
   sempre, e un allarme che urla sempre viene spento. */
function spoglia(src) {
  let out = "", i = 0, n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "*") { const j = src.indexOf("*/", i + 2); i = j < 0 ? n : j + 2; out += " "; continue; }
    if (c === "/" && d === "/") { const j = src.indexOf("\n", i); i = j < 0 ? n : j; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < n) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
      out += '""'; continue;
    }
    out += c; i++;
  }
  return out;
}

const APP = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
const appPulito = spoglia(APP);
/* ⚠ SOLO I COMMENTI, non le stringhe. Per cercare CHIAMATE serve un testo senza commenti (in
   questo progetto sono lunghi e citano i nomi delle funzioni rimosse: `renderDeriva`,
   `annoCircolare` compaiono nelle note che spiegano perche' sono state tolte). Ma togliere
   anche le stringhe rompe tutto sugli apostrofi italiani. Questa versione tocca solo i
   commenti, e non ha modo di perdere il filo. */
const senzaCommenti = (() => {
  let out = "", i = 0;
  while (i < APP.length) {
    const c = APP[i], d = APP[i + 1];
    if (c === "/" && d === "*") { const j = APP.indexOf("*/", i + 2); i = j < 0 ? APP.length : j + 2; out += " "; continue; }
    if (c === "/" && d === "/") { const j = APP.indexOf("\n", i); i = j < 0 ? APP.length : j; continue; }
    out += c; i++;
  }
  return out;
})();

const dichiarazioni = (src, re) => {
  const conta = new Map();
  let m;
  while ((m = re.exec(src))) conta.set(m[1], (conta.get(m[1]) || 0) + 1);
  return [...conta].filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`);
};

const funzDup = dichiarazioni(appPulito, /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm);
check("nessuna funzione di primo livello definita due volte in app.js", funzDup.length === 0);
if (funzDup.length) console.log("  ⚠ funzioni duplicate:", funzDup.join(", "));

const costDup = dichiarazioni(appPulito, /^(?:const|let)\s+([A-Z][A-Z0-9_]{2,})\s*=/gm);
check("nessuna costante di primo livello dichiarata due volte in app.js", costDup.length === 0);
if (costDup.length) console.log("  ⚠ costanti duplicate:", costDup.join(", "));

/* ⚠ chiavi duplicate nello stesso oggetto letterale: la seconda vince IN SILENZIO. In questo
   progetto e' gia' costato tre giri (breadth v262, froth v265, `fonte` in v268).
   ⚠⚠ QUI SI GUARDA IL SORGENTE VERO, NON QUELLO SPOGLIATO, ed e' una lezione appena presa: la
   prima stesura lavorava sul testo con le stringhe sostituite da "", e in una tabella con
   chiavi tra virgolette — "in:cpi", "in:pce" — TUTTE le chiavi diventavano "" e sembravano
   duplicate. Un controllo che grida al lupo su codice sano e' peggio di nessun controllo,
   perche' la reazione naturale e' spegnerlo.
   Si guardano solo gli oggetti PIATTI e su UNA riga: quelli annidati o multiriga
   richiederebbero un parser vero, e un controllo che sbaglia copre peggio di uno che copre
   meno. Il caso stretto e' comunque quello che ci ha morso tre volte. */
/* ⚠ UNA SOLA COPPIA DI GRAFFE PER RIGA, altrimenti si fondono due oggetti diversi in uno e i
   loro campi omonimi sembrano duplicati. Misurato su una riga vera del file:
     "ptf-table": { field: null, dir: 0 }, "wl-table": { field: null, dir: 0 },
   tagliando dalla PRIMA graffa all'ULTIMA si legge un oggetto solo con `field` e `dir` due
   volte — un duplicato che non esiste. E' il secondo falso allarme che questo controllo si e'
   procurato da solo in dieci minuti: coprire meno e dire il vero vale piu' che coprire tutto
   e gridare al lupo. */
const righeOggetto = APP.split("\n").filter(l => {
  const t = l.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
  return (t.match(/\{/g) || []).length === 1 && (t.match(/\}/g) || []).length === 1
      && t.indexOf("{") < t.lastIndexOf("}");
});
const chiaviDi = (riga) => {
  const dentro = riga.slice(riga.indexOf("{") + 1, riga.lastIndexOf("}"));
  return [...dentro.matchAll(/(?:^|[{,]\s*)(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:/g)]
    .map(m => m[1] || m[2] || m[3]);
};
const conChiaviDoppie = righeOggetto.filter(r => {
  const k = chiaviDi(r);
  return k.length > 1 && new Set(k).size !== k.length;
});
check("nessun oggetto letterale con la stessa chiave scritta due volte", conChiaviDoppie.length === 0);
if (conChiaviDoppie.length) console.log("  ⚠ oggetto con chiavi doppie:", conChiaviDoppie[0].trim().slice(0, 140));

/* ─────────────────────────────────────────────────────────────────────────────────────────
   2. LE SUITE NON POSSONO ESSERE SVUOTATE IN SILENZIO
   ───────────────────────────────────────────────────────────────────────────────────────── */

/* I minimi NON sono il numero attuale: sono un pavimento sotto il quale qualcosa e' andato
   perso. Vanno alzati quando la suite cresce davvero, mai abbassati per far passare una
   modifica — se una suite ne perde, la domanda giusta e' perche', non "come lo zittisco". */
/* ⚠ IL PAVIMENTO SI APPLICA SOLO A CHI USA `check()`. Red team, coerenza e valuta sono scritti
   con un altro idioma (scenari e invarianti, non check nominati) e contarne le chiamate dava
   zero: un allarme su codice sano, cioe' il modo piu' rapido per far spegnere il controllo.
   Per loro il pavimento e' la RIGA DI RAPPORTO: se non la stampano non hanno lavorato. */
const SUITE = [
  /* ⚠ v400 — I PAVIMENTI ERANO FERMI A META' SUITE. Misurato: test_app.mjs contiene 452
     chiamate a check() contro un pavimento di 185, test_update_data.py 161 contro 80. Un
     pavimento a meta' non e' un pavimento: meta' della suite poteva sparire restando verde,
     che e' esattamente il guasto per cui il pavimento esiste (v277, la suite mangiata a meta'
     da uno script). Alzati con margine su una crescita ordinaria, non incollati al numero
     di oggi — un pavimento uguale al conteggio va rosso al primo check tolto per una ragione
     legittima. Si alzano quando la suite cresce, mai si abbassano per far passare qualcosa. */
  { file: "test_app.mjs",        cmd: "node",    minimo: 430, firma: /\d+\/\d+ check superati/ },
  { file: "test_update_data.py", cmd: "python3", minimo: 160, firma: /CHECK OK|CHECK FALLITI/ },
  { file: "redteam.mjs",         cmd: "node",    minimo: null, firma: /RED TEAM: \d+ campagne/ },
  /* v372 — il percorso diretto ha i suoi test come tutto il resto: se lo strato che misura il
     libro non e' sorvegliato, torna a essere codice di cui fidarsi a occhio. */
  { file: "test_analisi_libro.py", cmd: "python3", minimo: 90, firma: /\d+\/\d+ CHECK OK/ },
  { file: "coherence_check.mjs", cmd: "node",    minimo: null, firma: /COERENZA PAYLOAD: \d+ controlli/ },
  { file: "fx_check.mjs",        cmd: "node",    minimo: null, firma: /GATE VALUTA:/ },
];

for (const s of SUITE) {
  const percorso = join(ROOT, "scripts", s.file);
  if (!existsSync(percorso)) { check(`${s.file}: esiste`, false); continue; }
  const testo = readFileSync(percorso, "utf8");

  /* quanti controlli contiene: se una modifica ne fa sparire un blocco, qui si vede. */
  if (s.minimo != null) {
    const n = (testo.match(/\bcheck\(/g) || []).length;
    check(`${s.file}: contiene almeno ${s.minimo} controlli (ne ha ${n})`, n >= s.minimo);
  }

  /* ⚠ IL CONTROLLO CHE AVREBBE PRESO IL DISASTRO DI OGGI: la suite deve PARLARE. Un file che
     esce 0 senza stampare niente non e' una suite verde, e' una suite che non c'e' piu'. */
  let uscita = "", codice = 0;
  try {
    uscita = execFileSync(s.cmd, [percorso], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    uscita = String((e.stdout || "") + (e.stderr || ""));
    codice = e.status == null ? 1 : e.status;
  }
  check(`${s.file}: stampa un rapporto invece di uscire in silenzio`, s.firma.test(uscita));
  /* ⚠ v285 — SI DICE PERCHE' NON PASSA. Per otto versioni la CI e' stata rossa perche' questo
     passo girava PRIMA di `pip install`: test_update_data.py non trovava numpy, e il log
     diceva solo "non passa" — vero e inservibile. Un gate che fallisce senza spiegare costringe
     chi legge a rifare da capo la diagnosi, e nel mio caso mi ha fatto ignorare il rosso per
     otto push. Se la causa e' una dipendenza assente, ora si legge nel titolo del check. */
  const manca = (uscita.match(/(?:ModuleNotFoundError|ImportError)[^\n]*/) || [])[0];
  check(`${s.file}: passa` + (manca && codice !== 0 ? ` — ${manca.slice(0, 90)}` : ""), codice === 0);
}

/* ⚠ v283 — FUNZIONI DEFINITE E MAI RICHIAMATE. Il controllo speculare a quello sopra: li'
   si cerca chi viene chiamato senza esistere, qui chi esiste senza essere chiamato. Nasce da
   sei funzioni sopravvissute ai tagli di v256 e v275 — fetchQuote sostituita da quotaLive,
   pushDiaryCloud rimasta col diario, renderCorrMacro tenuta viva da un commento che diceva una
   cosa inesatta (sosteneva servisse al pacchetto, ma quello che i due condividono e' il
   CALCOLO, non il render). Una funzione tenuta per una ragione sbagliata e' peggio di una
   dimenticata: sembra protetta.
   ⚠ Rimuoverle e' costato un errore: il taglio si e' portato via `esc`, `cur` e `clamp` perche'
   `priceTxt` e' una riga singola incastrata fra loro senza righe vuote, e risalivo all'ultima
   riga vuota per prendere i commenti. La ricevuta giusta CONTA le funzioni prima e dopo e
   pretende che siano sparite esattamente quelle volute. */
const usateDaQualcuno = (nome) => (senzaCommenti.match(new RegExp("\\b" + nome + "\\b", "g")) || []).length > 1;
const definiteQui = [...senzaCommenti.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
const maiChiamate = definiteQui.filter(n => !usateDaQualcuno(n));
check("nessuna funzione definita e mai richiamata da nessuno", maiChiamate.length === 0);
if (maiChiamate.length) console.log("  ⚠ definite e mai chiamate:", maiChiamate.join(", "));

/* ─────────────────────────────────────────────────────────────────────────────────────────
   3. COERENZA FRA I PEZZI CHE DEVONO MUOVERSI INSIEME
   ───────────────────────────────────────────────────────────────────────────────────────── */

const HTML = readFileSync(join(ROOT, "index.html"), "utf8");
const vApp = (APP.match(/const BUILD_VERSION = "(\d+)"/) || [])[1];
const vHtml = [...HTML.matchAll(/\?v=(\d+)/g)].map(m => m[1]);
/* ⚠ nato da un difetto vero: BUILD_VERSION e' rimasta a "251" per SEI versioni mentre
   index.html avanzava, e il banner "nuova versione" restava acceso per sempre. */
check("BUILD_VERSION e il ?v= di index.html dicono la stessa versione",
      !!vApp && vHtml.length > 0 && vHtml.every(v => v === vApp));
if (vApp && !vHtml.every(v => v === vApp)) console.log(`  ⚠ app.js dice ${vApp}, index.html dice ${[...new Set(vHtml)].join(", ")}`);

/* ⚠ ogni id cercato dal codice deve esistere nel markup: una rimozione a meta' lascia
   handler che interrogano nodi inesistenti — silenziosi finche' non rompono altro.
   ⚠⚠ SUL SORGENTE VERO, e questa e' la lezione piu' istruttiva di tutto il file: la prima
   stesura cercava gli id in `appPulito`, dove le stringhe sono state sostituite da "" — quindi
   `$("#wl-cols")` era diventato `$("")` e il conteggio degli id era ZERO. Il controllo passava
   sempre, per assenza di dati e non di difetti, ed era proprio quello che avrebbe dovuto
   trovare l'handler orfano rimasto dalla watchlist. Misurato: 0 id sul sorgente spogliato,
   111 su quello vero.
   E' la trappola che CLAUDE.md documenta da v196 ("verde per assenza di dati, non di
   difetti") — e me la sono procurata scrivendo il controllo che doveva impedire proprio
   questa famiglia di errori. Uno strumento nuovo va validato iniettando il difetto che deve
   trovare, sempre, anche quando lo strumento sei tu a scriverlo. */
const idCercati = [...new Set([...senzaCommenti.matchAll(/\$\("#([\w-]+)"\)/g)].map(m => m[1]))];
const idMancanti = idCercati.filter(id => !HTML.includes(`id="${id}"`));
/* i nodi creati a runtime dal codice stesso non stanno nel markup e non sono un difetto. */
const creatiARuntime = idMancanti.filter(id => APP.includes(`id="${id}"`) || APP.includes(`.id = "${id}"`));
/* ⚠ SI SEGNALA SOLO CIO' CHE LANCEREBBE. In questo progetto il pattern difensivo e' esplicito:
   `const box = $("#x"); if (!box) return;` oppure `$("#x")?.addEventListener(...)`. Un
   contenitore che non c'e' piu' li' dentro produce un no-op voluto, non un difetto — e
   segnalarlo sarebbe l'ennesimo allarme su codice sano.
   Quello che lancia davvero e' la dereferenziazione DIRETTA: `$("#x").qualcosa`, senza `?.` e
   senza guardia. E' quella la classe v213 che ha gia' ucciso il wiring due volte. */
const derefDiretta = (id) => new RegExp(`\\$\\("#${id}"\\)\\s*\\.`).test(senzaCommenti);
const davveroOrfani = idMancanti.filter(id => !creatiARuntime.includes(id) && derefDiretta(id));
if (idMancanti.length && !davveroOrfani.length) {
  console.log("  · contenitori assenti ma acceduti in sicurezza (no-op voluto):",
    idMancanti.filter(id => !creatiARuntime.includes(id)).join(", "));
}
check("nessun handler cerca un elemento che il markup non ha", davveroOrfani.length === 0);
if (davveroOrfani.length) console.log("  ⚠ id cercati e mai presenti:", davveroOrfani.join(", "));

/* ⚠ FUNZIONI CITATE E MAI DEFINITE. Trovate cosi': renderTable e renderWatchlist sono state
   rimosse col portafoglio in v256, ma quattro righe continuavano a passarle come callback —
   `ReferenceError` al primo clic. E' la classe v238, "la pagina e' andata morta con 219 test
   verdi": la sintassi valida non dice niente sull'esecuzione. Il gate di render copre la
   catena di renderAll; questi stavano in handler che quella catena non tocca. */
/* si raccolgono le definizioni A QUALSIASI PROFONDITA' (non solo di primo livello): una
   funzione dichiarata dentro un'altra e' definita a tutti gli effetti. */
/* ⚠ SUL SORGENTE VERO. `spoglia()` e' affidabile per i duplicati (validato iniettandone uno:
   lo trova) ma NON per raccogliere le definizioni: questo file e' pieno di apostrofi italiani
   dentro stringhe a doppio apice — "la soglia gia' usata" — e ogni sequenza che lo scanner
   legge male gli fa perdere il filo per migliaia di caratteri.
   Qui la direzione dell'errore decide: una definizione trovata per sbaglio dentro una stringa
   produce un falso NEGATIVO (non segnalo un problema che c'e'); una definizione PERSA produce
   un falso positivo, che e' l'errore che fa spegnere il controllo. Meglio leggere tutto. */
const definite = new Set([
  ...[...APP.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
  ...[...APP.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]),
  ...[...APP.matchAll(/([A-Za-z_$][\w$]*)\s*[:,=]\s*(?:async\s*)?(?:\(|[A-Za-z_$])/g)].map(m => m[1]),
]);
/* ⚠ SOLO CHIAMATE NUDE, non metodi. La prima stesura prendeva anche `x.getItem(` come se
   fosse una funzione nostra, e sputava settanta falsi positivi — `querySelector`,
   `toUpperCase`, `padStart`. Un controllo cosi' viene spento entro un giorno, ed e' esatto il
   destino che questo file esiste per evitare: si guarda che davanti al nome NON ci sia un
   punto. */
const nostreParole = [...new Set(
  [...senzaCommenti.matchAll(/(^|[^.\w$])([a-z][a-zA-Z0-9]*[A-Z][\w$]*)\s*\(/g)].map(m => m[2]))];
/* ⚠ i globali del BROWSER non esistono in Node, quindi `n in globalThis` non basta: getComputedStyle,
   requestAnimationFrame e simili risulterebbero "mai definiti". L'elenco e' corto e nominato —
   un registro lungo invecchierebbe da solo (classe C10), ma questi tre non cambiano. */
const GLOBALI_BROWSER = new Set(["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
                                 "getSelection", "matchMedia", "scrollTo", "scrollBy"]);
const citateNonDefinite = nostreParole.filter(
  n => !definite.has(n) && !(n in globalThis) && !GLOBALI_BROWSER.has(n));
check("nessuna funzione citata nel codice e' stata rimossa senza i suoi richiami",
      citateNonDefinite.length === 0);
if (citateNonDefinite.length) console.log("  ⚠ citate e mai definite:", citateNonDefinite.join(", "));

/* ─────────────────────────────────────────────────────────────────────────────────────────
   rapporto
   ───────────────────────────────────────────────────────────────────────────────────────── */
for (const [nome, ok] of ESITI) console.log(`${ok ? "PASS" : "FAIL"}  ${nome}`);
console.log(`\nAUTOCONTROLLO: ${ESITI.length - F.length}/${ESITI.length} superati`
  + (F.length ? ` — FALLITI: ${F.join(" · ")}` : ""));
process.exit(F.length ? 1 : 0);
