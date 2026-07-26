# CLAUDE.md — Regole d'ingaggio del progetto Trading Dashboard

> Leggi questo file PRIMA di modificare qualsiasi cosa. Riassume decisioni architetturali che
> non sono ovvie dal codice e che, se ignorate, rompono il sistema. Aggiornalo quando prendi
> una decisione strutturale nuova.

## 🔁 Esercizio ricorrente: "check del prompt AI applicato a te stesso"

L'utente chiede periodicamente di generare il prompt reale e di ESEGUIRLO su di sé (simulare
l'LLM ricevente) per trovare attriti tra testata (istruzioni) e coda (dati). **Metodo collaudato**:

1. Genera il prompt FEDELE al browser con questo harness (nota i 3 dettagli critici:
   `localStorage.getItem("prompt_header")` deve restituire il file utente, `recomputeTotals()`
   va chiamato PRIMA di `buildPrompt()`, i NaN del JSON vanno sostituiti):
   ```bash
   node -e '
   const fs=require("fs"),vm=require("vm");const src=fs.readFileSync("assets/app.js","utf8");
   const el=()=>({addEventListener(){},classList:{add(){},remove(){},toggle(){},contains:()=>false},style:{},dataset:{},hidden:true,querySelector:()=>el(),querySelectorAll:()=>[],closest:()=>null});
   const ctx={console,document:{querySelector:()=>el(),querySelectorAll:()=>[],getElementById:()=>el(),createElement:()=>el(),addEventListener(){},body:el()},localStorage:{getItem:(k)=>k==="prompt_header"?fs.readFileSync("config/prompt_header.txt","utf8"):null,setItem(){},removeItem(){}},window:{addEventListener(){},matchMedia:()=>({matches:false})},navigator:{clipboard:{}},fetch:()=>Promise.reject(),setInterval:()=>0,clearInterval(){},setTimeout:()=>0,Event:class{},MutationObserver:class{observe(){}}};
   vm.createContext(ctx);vm.runInContext(src,ctx);
   const d=JSON.parse(fs.readFileSync("data/data.json","utf8").replace(/\bNaN\b/g,"null"));
   vm.runInContext("DATA="+JSON.stringify(d)+"; cashEur=28500; recomputeTotals();",ctx);
   fs.writeFileSync("/tmp/prompt_live.txt",vm.runInContext("buildPrompt()",ctx));'
   ```
   ⚠️ Un "NaN €" o dati piatti nel prompt così generato possono essere ARTEFATTI dell'harness
   (recomputeTotals/cash mancanti), non bug di produzione: verificare prima di allarmare.
2. Leggi /tmp/prompt_live.txt riga per riga COME L'LLM RICEVENTE: dove sbaglieresti tu?
   Confronta ogni istruzione della testata con i dati che la coda fornisce davvero.
3. I fix vanno separati: CODA/sistema = implementi tu; TESTATA = `config/prompt_header.txt`
   è dell'utente (editato dalla UI) → solo raccomandazioni, MAI modifiche dirette.

**Già trovato e SISTEMATO nelle iterazioni passate (v104→v108) — non ri-scoprire/ri-fixare**:
float_pct>100 nullato (GOOGL/TSM multi-classe/ADR) · put/call su SPY (era BSX spazzatura) ·
RVol full-day (era sempre <1 col bar intraday parziale) · wall opzioni sanity (0DTE skip,
banda 0,5–2× spot, CW==PW lontano = artefatto → nulli; guard anche in mdRow) · chiave
`umich` (ex "pmi": è FRED UMCSENT, NON l'ISM PMI) · DATA QUALITY REPORT prima del QUADRO
MACRO · header tabelle con conteggi espliciti ("N POSIZIONI → N righe", ancora anti-omissione)
· P/E etichettati [TRAILING/FORWARD, fonte] · margin debt label da YoY (pct_of_peak saturo
13/13 mesi) · offloading algebrico completo: budget_operativo_spendibile (cash−ES95),
prezzo_limite_aggiustato (gap pre/after), risk_reward "1:X.X" (_risk_reward_str, reward=res−supp,
risk=2×ATR) — l'LLM non deve fare NESSUN conto, solo giudizio.

**Punti aperti noti**: WSJ/multpl bloccati dagli IP CI (carry-forward ≤45g copre); prompt
~10,4k token (se cresce ancora, tagliare prima le news per-ticker); i CW sotto lo spot ma
in banda plausibile possono essere legittimi (non stringere oltre la banda senza evidenza).

## 🏗️ Architettura (JAMstack statico — NON c'è un backend)

- Il sito è **statico su GitHub Pages**: solo `index.html` + `assets/app.js` + `assets/style.css`,
  serviti come file. **NON esiste un backend Node.js/Express.** Non aggiungere endpoint
  `app.get`/`app.post`, non proporre un server: non c'è dove girerebbe.
- I **dati** (`data/data.json`) sono generati da una **pipeline Python** (`scripts/update_data.py`)
  eseguita da **GitHub Actions** (`.github/workflows/update-data.yml`) su cron. La UI legge
  `data/data.json` via `raw.githubusercontent` (fallback Pages URL).
- La **persistenza "server-side" dal browser** (diario azioni, override macro, testata prompt)
  usa la **GitHub Contents API** col `gh_token` salvato in `localStorage`: si scrivono file nel
  repo. Questo È il "backend" del progetto. Il pattern GET = `raw.githubusercontent`, POST =
  `PUT /repos/{REPO}/contents/{path}` (vedi `pushDiaryCloud`, `pushOverridesCloud`,
  `pushPromptHeaderCloud`).

## 🛑 Prompt Decoupling (v101) — la regola che si dimentica più facilmente

Il "megaprompt" che l'utente copia (`buildPrompt()` in `app.js`) ha due parti:

1. **TESTATA** (le istruzioni all'AI) → vive in **`config/prompt_header.txt`**, ed è la **fonte
   di verità**. L'utente la edita dalla dashboard ("⚙ Impostazioni Prompt AI"), che scrive il
   file via GitHub Contents API (commit "Aggiorna testata prompt AI (da dashboard)").
   - `loadPromptHeaderCloud()` scarica il file all'avvio → `localStorage.prompt_header` →
     `promptHeaderText()` lo usa nel prompt. `DEFAULT_PROMPT_HEADER` in `app.js` è **SOLO il
     fallback offline** (primo caricamento / senza rete).
   - ⚠️ **Il fallback NON deve coincidere col file** e NON va "riallineato": il file è pieno di
     personalizzazioni del CEO che il fallback non ha. Il test verifica solo che il fallback
     esista e sia sensato, NON l'uguaglianza (v104 — la vecchia regola "byte-identico" era
     sbagliata: falliva la CI a ogni edit dell'utente).
   - 🛑 **NON sovrascrivere MAI `config/prompt_header.txt`** (cancelleresti il lavoro del CEO).
     Per cambiare le istruzioni: dillo all'utente di editarle dalla UI, oppure — se richiesto
     esplicitamente — modifica il file sapendo che sostituisci la sua versione.

2. **CODA** (payload dati: tabelle portafoglio/watchlist, matrice di rischio, macro, news,
   fondamentali, ecc.) → generata dalle funzioni JS in `buildPrompt()`.
   - **NON toccare, NON semplificare, NON "ottimizzare" la logica di estrazione/iniezione dati.**
   - Concatenazione finale: `promptHeaderText()` + payload dati generato live.

## ⚖️ Regola Suprema

**Nessun commit deve rompere la pipeline di estrazione dati** (`scripts/update_data.py`) né il
builder della coda (`buildPrompt`). Se un cambiamento tocca l'estrazione/iniezione dati o le
tabelle del prompt, è ad alto rischio: fallo solo se richiesto esplicitamente e con test.

## ✅ Prima di ogni commit (obbligatorio)

- `node --check assets/app.js`
- `node scripts/test_app.mjs` — test funzioni pure JS (motore, risk, buildPrompt)
- `python3 scripts/test_update_data.py` — test pipeline (ratchet, risk metrics)
- `python3 scripts/audit_data.py data/data.json` — gate qualità dati (P/E con EPS<0, MCR, ecc.)
- `node scripts/backtest_diary.mjs` — NON è un gate: misura le operazioni REALI del CEO annotate
  nel diario (prezzo di esecuzione vero) contro il prezzo di oggi e contro l'indice, e accanto
  mostra cosa diceva il sistema quel giorno. Risponde alla domanda che conta — se il sistema stava
  aiutando o se il CEO faceva meglio da solo — senza chiedergli di inserire nulla di nuovo.
- `node scripts/backtest_signals.mjs` — NON è un gate: misura retroattivamente se i segnali su cui
  poggiano i detector (RS, ΔRS, MCR) hanno davvero contenuto predittivo sullo storico già a disco.
  Dichiara sempre il campione REALE (titoli e date distinte, non le osservazioni sovrapposte) e si
  rifiuta di generalizzare sotto 5 titoli. Da rieseguire quando lo storico cresce: oggi il campione
  è troppo piccolo per promuovere o togliere qualunque detector.
- `node scripts/coherence_check.mjs` — gate COERENZA INTERNA del payload. ⚠ REGOLA CHE SI DIMENTICA
  DI CONTINUO: **le istruzioni vivono SOLO nella testata, il payload porta FATTI**. Ogni volta che si
  aggiunge una riga al payload la tentazione è spiegare all'LLM cosa farne ("usalo per…", "non
  ripeterlo", "dichiaralo") — ed è successo tre volte (v156, v179, v180: otto casi più l'intero
  PROMEMORIA FINALE che duplicava 6 concetti su 6 della testata). C9 lo rileva cercando imperativi
  in seconda persona nella CODA; C10 rileva i rimandi a sezioni inesistenti per FORMA (STEP n,
  regola X1), classe che ha già prodotto "A4" e "STEP 3". Prima di aggiungere prosa al payload,
  chiediti: è un FATTO o è un ORDINE? Se è un ordine, va in config/prompt_header.txt.
- `node scripts/coherence_check.mjs` — gate COERENZA INTERNA del payload: stessa grandezza con
  valori diversi, freschezza contraddittoria, somme che non tornano, verdetti opposti sullo stesso
  titolo, terminologia divergente, denominatori non dichiarati. È la classe che audit e red team
  non vedono: un payload che si contraddice non è invalido, è INAFFIDABILE. Ogni detector è stato
  validato iniettando l'incoerenza che deve trovare (`--verbose` mostra anche i controlli passati).
- `node scripts/fx_check.mjs` — gate VALUTA. Genera il payload DUE VOLTE con EUR/USD diversi: ogni
  importo in € che non si muove col cambio o è un euro vero (cassa, VaR/ES già convertiti dalla
  pipeline) o è un DOLLARO col simbolo sbagliato. Nato dal v183: la minusvalenza latente nel blocco
  decisioni era il P&L grezzo in USD stampato con fmtEUR, accanto a un controvalore correttamente
  convertito — due valori per la stessa grandezza, e un LLM reale ha usato quello sbagliato per
  dimensionare una compensazione fiscale. Gli invarianti legittimi stanno in `LEGITTIMI` con la
  loro ragione scritta: aggiungerne uno senza motivazione è come disattivare il gate.
- Bump `?v=NN` in `index.html` (cache-busting su style.css e app.js) a ogni release.
- `git pull --rebase origin main && git push` (il CI committa `data.json`; conflitti su quel
  file → tenere la versione remota fresca, i tuoi calcoli si ricomputano al run successivo).

## ✂️ Blocchi RIMOSSI dal payload (non reintrodurre senza misurare)

Precedente: TOP 10 CAPITALIZZAZIONI (v138). Poi, in v184, dopo aver MISURATO invece di stimare:

- **CINEMATICA DEI SEGNALI** — 21 numeri su 21 già altrove (Sharpe e Δ7g in SITUAZIONE PATRIMONIALE
  e nel digest, VIX/VIX3M in QUADRO MACRO, ΔRS e ΔMCR sono COLONNE della tabella per-titolo).
- **CONTESTO ECONOMIA USA** — tutto in QUADRO MACRO e ROTAZIONE; il PIL YoY compariva due volte con
  formati diversi ("+2,68%" e "2.68%"), cioè lo stesso dato che si presentava come due dati.
- **TOP 10 ETF** — mai citato in tre report reali di LLM diversi; la rotazione utile è già nei 21 ETF.
- **Tabella B, 5 colonne** — Qtà/PMC/Guad.% sono SEMPRE vuote su un universo senza posizioni
  (verificato: 0 righe su 25), P/E ed EPS sono in ANALISI FONDAMENTALE per tutti e 25 i titoli
  (verificato: 0 titoli perderebbero il dato). Proiezione DOPO mdRow: Tabella A intatta.
- **MATRICE DI RISCHIO, 2 colonne** — peso NAV e beta già nelle CORRELAZIONI e in Tabella A. MCR
  resta: è l'unica classifica completa del rischio, ordinata e a somma 100%.

- **EPS RIMESSO in v185** dopo aver provato il payload su me stesso: Bloom Energy mostrava
  "P/E —" con ROE +1,3% e margine +0,3%, tutto in apparenza sano, e senza EPS non c'era modo di
  sapere che l'utile per azione è negativo (−0,04). Per gli altri cinque titoli senza P/E il segno
  lo davano ROE o margine; per BE no. La convenzione "P/E = '—' quando EPS<0" rendeva quel
  trattino ambiguo fra dato mancante e società in perdita. **P/E resta tolto**: quello è davvero
  duplicato. Lezione: due colonne che sembrano la stessa cosa non lo sono — una era ridondante,
  l'altra disambiguava una convenzione della tabella stessa.

Effetto misurato a dati COSTANTI (v183→v185, stesso data.json): −3,9% caratteri, −5,1% cifre
derivate. **Modesto, e va detto**: la leva grossa sarebbe ridurre le RIGHE della watchlist, non le
colonne. Attenzione a misurare il taglio contro un payload rigenerato DOPO un run del CI: i dati
cambiano e il confronto si sporca (la prima misura diceva −6,1%, era per metà il data.json nuovo). Il guadagno vero
non è la dimensione ma un allineamento in meno da mantenere — la classe C11/C1.

**C12 è la ricevuta del taglio**: verifica sui dati VERI che i 12 fatti dei blocchi rimossi siano
ancora nel payload. Se un domani cambia il blocco che li ospita, il taglio smette di essere gratuito
e C12 lo dice subito. Prima di rimettere un blocco: misura se i suoi numeri esistono già altrove.

⚠️ Un taglio di colonne rompe chi legge per INDICE: il red team I6 usava 16/17 fissi e ha sparato
500 falsi allarmi. Ora trova Supp./Stop 2×ATR **per nome** rileggendo l'intestazione. Stessa lezione
di C10: un registro fisso di posizioni invecchia da solo e in silenzio.

## 📅 Il book può essere prezzato su SEDUTE DIVERSE (v186)

Yahoo pubblica la barra giornaliera in tempi diversi per titoli diversi (stesso gotcha della
"barra odierna voidata"). Nei run successivi di un weekend il portafoglio si popola **a pezzi**:
il 26/07 quattro posizioni erano ancora alla chiusura del 23 e sei erano già passate al 24.

Ogni RIGA lo dichiarava onestamente (`[chiusura del 23/07]`), ma **gli aggregati no**: patrimonio,
pesi NAV, Sharpe, VaR/ES, MCR e alpha descrivevano un book mai esistito a un solo istante. E la
conseguenza non era teorica — **RGTI è entrato fra gli stop violati fra due run domenicali solo
perché la sua barra del 24 era arrivata**, non perché il prezzo si fosse mosso.

L'invariante NON è "le date devono coincidere" (non dipende da noi): è che quando non coincidono
il payload **lo dichiari**. Lo fa `⚠ PREZZI DA SEDUTE DIVERSE` sopra SITUAZIONE PATRIMONIALE, e
**C13** verifica che la dichiarazione ci sia quando serve e non ci sia quando non serve.

Corretta anche la riga `Δ ultimo run`: la guardia "mercati chiusi" scattava solo se il delta era
già ~0, cioè proprio quando non serviva. A borse chiuse un delta NON nullo è l'anomalia da
spiegare — non è un movimento di prezzo, è l'arrivo progressivo delle barre.

## 🏦 FedWatch: il SEGNO conta (v187)

`cut_prob = max(0, (mid - implied)/0.25*100)`. Quel `max(0, …)` **cancellava il ramo del rialzo**:
quando i futures prezzano un tasso più ALTO del punto medio, il valore grezzo è negativo e
significa "rialzo atteso". Il 26/07/2026 valeva **−38,0**, cioè il 38% di probabilità di rialzo
pubblicato da CME FedWatch quel giorno — verificato su fonte esterna. Il payload stampava
`prob. taglio 0%` a tre giorni dal FOMC: vero, e inutile, perché il rischio era dall'altra parte.

Ora la pipeline calcola `cut_prob` e `hike_prob` (mutuamente esclusivi per costruzione, 4 test) e
il payload mostra i **rami attivi** più il confronto con Polymarket sullo stesso evento: il 26/07
CME 38% contro Polymarket 17%, **21 punti di divergenza fra due fonti sulla stessa riunione**, che
è informazione a sua volta. `app.js` ricava i rami dal tasso implicito anche quando `data.json` non
li ha ancora (il CI rigenera su cron: senza fallback il payload resterebbe a metà per ore).

**C14** generalizza la lezione: se il payload quota una probabilità a ZERO su una direzione, deve
dire cosa prezza l'altra. Una riga che ne pubblica una sola a zero è **informazione mancante
travestita da informazione presente** — la forma di errore più difficile da notare leggendo.

## 🧭 Convenzioni fisse (violarle = bug già vissuti)

- `SORT_FIELDS` allineato 1:1 alle `<th>`; aggiungendo/togliendo una colonna aggiornare anche i
  `colspan` (total-row, add-row, "Nessun dato") e la head/sep delle tabelle del prompt.
- Handler su elementi che possono non esistere → sempre `?.` (un `addEventListener` su elemento
  rimosso ha già rotto l'intero wiring più volte).
- **Termometri** `thermoLine`: gradiente verde-sx/rosso-dx, `pos = 100 - score`. Regola:
  `ends[0]` = etichetta FAVOREVOLE (verde/sx), `ends[1]` = sfavorevole (rosso/dx). F&G usa
  `direct:true` + gradiente invertito (eccezione, non toccare). Verifica sempre marker-colore vs
  etichetta via preview, non a ragionamento.
- **Fallback dati devono essere RUMOROSI** (banner/flag), mai etichette silenziose. Ogni report
  di push dichiara le date reali di Margin Debt/PIL/Inflazione (sezione "AUDIT INTEGRITÀ DATI
  REALI") — vedi la memoria feedback-data-integrity-audit.
- **GOTCHA scraping**: FINRA e WSJ/multpl rispondono 403 all'UA "browser completo" (Chrome +
  Accept) e 200 a un UA generico senza `Accept`, e sono spesso bloccati dagli IP datacenter del
  CI → catena con carry-forward dal run precedente. Non "sistemare" gli header a caso.

## 🗺️ Mappa rapida

- `assets/app.js` — tutta la UI + `buildPrompt()` (testata via file, coda generata).
- `config/prompt_header.txt` — **testata del prompt (editabile)**.
- `config/holdings.json` — portafoglio/watchlist/broker (l'utente li aggiorna a mano).
- `scripts/update_data.py` — pipeline dati (Yahoo/FRED/FINRA/scraping) → `data/data.json`.
- `scripts/test_app.mjs` / `test_update_data.py` / `audit_data.py` — test e gate qualità.
- `.github/workflows/` — `update-data.yml` (dati) e `tests.yml` (CI test).

## 📋 Copia Analisi AI (v130) — l'UNICO flusso di analisi, UN SOLO bottone

Bottone "📋 Copia Analisi AI" in topbar → `copyCIOText()`: genera CLIENT-SIDE il pacchetto
completo (`buildCIOText()` = `buildPrompt()` + `historicalDigestText()`), lo copia negli
appunti e apre la modal `#modal` per revisione/modifica. Si incolla in Claude per l'analisi
senior con verifica web. Il lettore del report È Claude: il testo è il report.
- Il documento HTML/PDF istituzionale (`renderCIOReport`, overlay `#cio-report`, stili
  `.cio-*`, `@media print`) è stato RIMOSSO per decisione del CEO (v130) — non reintrodurlo:
  era un artefatto intermedio senza lettore.
- `buildPrompt()` resta INTATTO (Regola Suprema): `buildCIOText` APPENDE i digest.
- I DIGEST STORICI (`buildHistoricalDigests`/`sparkTrendRows`/`titleDeepData`) sono la
  "lettura quantitativa dei grafici" dei popup: pendenze, percentili nel range, inversioni
  — calcolati da serie GIÀ in data.json (margin_debt.history, credit.history, curve_history,
  vix.spark, metrics_history, sparks, financials). Null-safe: serie assente → "—".
- Il red team audita `buildCIOText()` (payload + digest) su tutte le campagne.

## 🛑 Servizi DISMESSI (decisione CEO, lug 2026 — NON reintrodurre)

- **WhatsApp/CallMeBot**: rimosso ovunque (canali notifiche = email SMTP → GitHub Issue).
- **Gemini** (sia il generatore di report `cio_report.mjs` sia l'LLM-critic `llm_critic.mjs`):
  eliminati. L'analisi la fa l'utente incollando l'export del Report CIO in Claude.
- **Morning brief** (`morning_brief.py` + workflow): eliminato (era solo-WhatsApp).
