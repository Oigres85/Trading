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

## 🎛️ Personalizzazione dashboard (v188) — e il confine col payload

Tre richieste del CEO, con UN vincolo esplicito: **nascondere colonne NON deve togliere dati al
prompt**. Il confine regge da solo perché il payload lo costruisce `mdRow()`, che non legge nulla
della UI. Verificato in browser: 8 colonne nascoste → payload identico al byte (69.681 char).

- **Colonne nascondibili** (`⚙ Colonne` su portafoglio e watchlist). Chiave = indice ORIGINALE
  `data-col`, lo stesso del riordino per trascinamento: nascondere e spostare si compongono.
  `applyColVisibility` gira DOPO `applyColOrder` perché **accorcia i colspan** delle righe speciali
  (TOTALE, "+ Aggiungi", nota BTP) di quante colonne coperte sono nascoste — senza quello la riga
  TOTALE sborda. "Titolo" è `sticky-col` e non si può nascondere: è la porta della scheda.
- **Tabella unica**: le viste alternative "Tecnica & Prezzi" / "Fondamentale (Value)" sono fuse
  (`techCells` + `fundCells`, 37 colonne portafoglio / 33 watchlist). Rimosse `buildFundTable`,
  `renderFundTable`, `renderWlFundTable`, `setPtfView`, `setWlView` — restano come no-op perché un
  handler superstite non rompa nulla. `SORT_FIELDS` esteso e verificato 1:1 con le `<th>`.
- **Un popup per titolo** (`openStockCard`, clic sul NOME) e **uno per la macro**
  (`openMacroDetails`, 39 sezioni). Il meccanismo che li rende possibili senza riscrivere 17
  funzioni: **tutte finiscono in `openInfoModal(titolo, html)`**, quindi `collectPanels()` la
  sostituisce temporaneamente con un raccoglitore, esegue le funzioni esistenti e ne tiene l'HTML.
  Ogni pannello resta l'unica fonte di verità del suo contenuto: se cambia `openMarginDebtModal`,
  la pagina unica cambia con lei. Le chiavi macro si leggono da `MACRO_INFO`, non da un secondo
  elenco (la classe di difetto di C10/C12).
  ⚠️ Perché il popup unico è NECESSARIO, non estetico: prima RS/Sharpe/conto economico si aprivano
  cliccando la loro cella. Con le colonne nascondibili quelle celle possono non esserci — e con
  loro sparirebbe l'accesso al dato. Un solo ingresso, il nome, che non si può nascondere.

Il test `MOBILE_KEY_COLS` cercava le etichette in `buildFundTable`: riallineato alle `<th>` (unica
fonte) + guardia nuova che verifica che **nessuna colonna della vecchia vista fondamentale sia
andata persa nella fusione** — ne aveva già perse due (Financial Health, Target Δ), rimesse.

## 🌏 Il ramo "Seoul aperta" e i rami mai letti (v190)

Il payload ha rami di testo che compaiono solo in certe finestre orarie. Quello di Seoul aperta
scatta dalle 02:00 CEST del lunedì — quando a New York è ancora domenica — ed **era rimasto non
letto per tutta la sessione**. Conteneva tre difetti insieme:

1. un IMPERATIVO nella coda ("Pesalo come tale") → C9 lo ha preso appena la finestra si è aperta;
2. una **contraddizione dentro la stessa riga**: l'etichetta diceva `[ultima chiusura di Seoul,
   borsa ferma]` mentre il testo diceva "Seoul sta scambiando ora". Entrambi derivavano da v182,
   che distingueva solo due stati (live / ferma) e non il terzo, che è il più insidioso —
   **mercato APERTO, dato VECCHIO**. Ora l'etichetta ha tre stati e lo dichiara;
3. un doppio punto finale.

Lezione: **un difetto in un ramo raro non è raro, è solo invisibile.** I gate girano su un solo
istante. Quando si aggiunge un ramo temporale, va esercitato — e il test che lo copre deve
asserire la PROPRIETÀ (l'etichetta non contraddice il testo), non il ramo, altrimenti fallisce
a orologio come è successo qui.

## 🎚️ Popup maestro-dettaglio con riordino (v191)

`renderPanelPage(titolo, panels, notaVuota, ambito)`: indice a sinistra (voci trascinabili),
contenuto a destra in un riquadro ampio (modale a 1400px quando contiene `.pp-split`).

L'ordine si persiste in `panelorder_<ambito>` **per titolo di pannello**, non per indice: un
pannello aggiunto in futuro finisce in coda invece di spostare tutto a caso.

**Propagazione alla dashboard**: le voci macro che hanno una mini-card la trascinano con sé
(`MACRO_CARD_BY_PANEL` + `applicaOrdineMiniCard`, riapplicato anche all'avvio). Le sezioni della
scheda titolo **non hanno un elenco corrispondente** nella dashboard, quindi lì l'ordine vale solo
dentro il popup — è scritto nella nota sotto l'indice invece di fingere una propagazione assente.

## 📱 Il popup macro su iPhone (v192) — la causa NON era il popup

Sintomo: "Dettagli macro non si visualizza correttamente su Safari iPhone". Riprodotto a 375px,
misurato invece di indovinato. **Due difetti distinti, e il secondo non c'entrava col popup.**

1. **Specificità.** `.modal-chart:has(.pp-split) .pp-split { grid-template-columns: 270px … }` era
   globale e batteva `@media (max-width:860px) { .pp-split { … 1fr } }` — i media query **non
   aggiungono specificità**. Risultato misurato: `270px 32px`, cioè un box di contenuto largo
   **32 pixel**. Ora la regola larga vive dentro `@media (min-width: 861px)`: sotto il breakpoint
   semplicemente non esiste, e non c'è nessuna guerra di specificità da vincere.

2. **La card "Parametri di Rischio" allargava TUTTA LA PAGINA.** `grid-template-columns: 1fr 1fr`
   non basta: le celle di una griglia hanno `min-width: auto`, quindi non scendono sotto la
   larghezza del contenuto. Le chip stavano in ~298px l'una → griglia ~598px → **documento 598px
   su uno schermo da 375**. E un overlay `position: fixed` si centra sul DOCUMENTO: il popup
   finiva spostato e mezzo fuori. Il popup era innocente. Correzione: `min-width: 0` sulle celle
   e una colonna sola sotto i 560px, più una rete di sicurezza (`overflow-x: hidden` su
   html/body sotto 860px) perché nessuna card possa più allargare la pagina.

Verificato dopo: documento 375px (era 598), modale centrata e dentro lo schermo, **tutti e 39 i
pannelli** controllati uno per uno senza overflow, desktop invariato (contenuto 901px).

Lezione trasferibile: **quando un overlay è mal posizionato su mobile, misura la larghezza del
documento prima di toccare l'overlay.** Il colpevole è quasi sempre altrove nella pagina.

## 🔗 Diario → posizioni (v193) e altre correzioni della lista CEO

- **Il diario aggiorna le posizioni.** `applicaOpAlPortafoglio` scrive su `config/holdings.json`
  con la stessa API di "Modifica valori": è il repo, quindi **iPhone e computer leggono la stessa
  fonte**. ACQUISTO ricalcola il PMC come media ponderata, VENDITA lascia il PMC invariato e a
  quota zero sposta il titolo in watchlist. Non è silenzioso — mostra l'effetto esatto e chiede
  conferma, perché cambia i numeri su cui si decide. E aggiorna **subito anche in locale**
  (`aggiornaPortafoglioLocale` + `recomputeTotals` + i quattro render): senza quello si annota la
  vendita e si continua a vedere la posizione per i 2-3 minuti della pipeline.
- **I modali semplici non si chiudevano.** Il ✕ di "Calcolatore PMC" e "Calcolo vendite" non ha
  MAI funzionato: i bottoni c'erano, `hideSimpleModal` c'era, il collegamento no. In v181 avevo
  rimosso quella funzione come codice morto — era davvero non chiamata, ma la conclusione giusta
  non era "si può togliere", era "manca un collegamento". **Una funzione morta accanto a un
  bottone inerte è un sintomo, non un surplus.** Ora la chiusura è generica per tutti i
  `.modal-backdrop`: ✕, clic sul fondale, Esc.
- **Riordino su iPhone.** L'HTML5 drag-and-drop non esiste su Safari touch: il CEO trascinava e
  non succedeva nulla. Aggiunte frecce ▲▼ (`applicaNuovoOrdine` è l'unica strada per applicare
  l'ordine, condivisa con il trascinamento: due percorsi separati sarebbero divergiti).
- **P/E "sballati": non lo erano, erano incompleti.** AMD 175×, PLTR 138×, CBRS 433× sono corretti
  (prezzo/EPS combacia) ma sono GAAP trailing. Il forward degli stessi era 38×, 59×, 208× — e
  `stats.forward_pe` era già in data.json, **inutilizzato**. Aggiunta la colonna "P/E fwd" in
  dashboard e payload, più il flag `[GAAP DEPRESSO]` quando il trailing è ≥2× il forward.
- **VIX "rilevazione odierna" a dato vecchio.** La condizione guardava `usRegularSessionOpen()`,
  cioè l'orologio: il 31/07 a borsa aperta dichiarava odierno un VIX del 26/07. Ora serve anche
  che lo snapshot sia di oggi. Stessa classe dell'etichetta KOSPI: **stato del mercato e
  freschezza del dato sono due cose diverse.**
- **Curva 10A-2A**: "dis-inversione in corso" era incondizionato, con l'ultima inversione a 469
  sedute (~22 mesi). Ora la distanza decide la frase e il numero di sedute è scritto accanto.

## 🗑️ Memoria storica e ciclo semiconduttori: RIMOSSI (v203)

Erano gli unici due blocchi **mai girati con dati veri**: FRED non risponde dall'ambiente di
sviluppo, quindi logica (22 test) e rendering (dati simulati) erano provati, la **fetch** no.

E uno dei due lo dimostrava: scorte/spedizioni a **2,16** quando il rapporto di settore sta
intorno a 1,3–1,5 — quasi certamente la serie sbagliata fra i candidati provati da
`prima_che_risponde()`. **Pubblicare un percentile su una serie che non è quella che dichiari è
peggio che non pubblicarlo**: dà l'autorità di un dato storico a un numero che non lo è.

Rimossi insieme: `storia_lunga()`, `ciclo_semiconduttori()`, `scripts/historical_context.py` e i
suoi test. Non servivano ad altro.

⚠️ Nel farlo ho tolto da C12 cinque fatti (ΔRS, ΔMCR, ΔSharpe, MCR Top-3, term structure) che
**non appartenevano a questi blocchi** — erano la ricevuta del taglio v184 e sono tutti ancora nel
payload. Ripristinati. **Togliere una guardia mentre si toglie una funzionalità è il modo più
rapido di perdere la protezione senza accorgersene.**

## 🔬 Ciclo dei semiconduttori (v195) — dall'analisi video del CEO

Il book è per oltre metà in semi e per l'**86% della sua varianza**: la domanda che conta non è se
quei titoli siano cari (il P/E **forward** del settore sta sotto quello del mercato) ma se il
**ciclo** stia girando. L'anticipatore storico è il rapporto **scorte/spedizioni** dell'industria:
basso = domanda che eccede l'offerta; la **risalita** è ciò che ha preceduto l'inversione dei
ricavi di settore (fine 2021 → bust 2022). Il payload pubblica **direzione oltre al livello**,
perché è la curva a dare il segnale, più la produzione industriale di semiconduttori con YoY.

⚠️ **Gli ID delle serie FRED non erano verificabili da questo ambiente** (FRED non risponde dal
sandbox). `prima_che_risponde()` prova una LISTA di candidati e tiene il primo che risponde,
**registrando quale ha funzionato** — e il payload stampa l'ID della serie usata. Un ID indovinato
e scritto come se fosse certo sarebbe stato peggio di un tentativo dichiarato.

### Cosa il sistema NON può fare (dai due video analizzati)

Non ottenibile con dati gratuiti, e va detto invece di simularlo: **dark pool prints**, **gamma
positioning / net expirations**, **Hindenburg Omen** (serve advance-decline e new highs/lows),
**flussi retail Vanda**, **volume profile / most-traded zone**, **anchored VWAP**. Sono dati a
pagamento o derivati da feed che il progetto non ha. Il resto dell'analisi macro→settore→titolo
il payload lo copre.

## 🔑 L'ordine macro e la chiave morta (v196)

Sintomo: "l'ordine delle tab macro differisce da quello nel popup". **Due difetti distinti.**

1. **Propagazione parziale.** `MACRO_CARD_BY_PANEL` copriva 7 pannelli su 37 — ma le voci
   "Inflazione CPI", "PIL USA", "Curva 10A-2A" **hanno** un corrispondente in dashboard: sono i
   `.macro-item` della griglia. Erano 23 gli elementi riordinabili e se ne muovevano 7.
   Ora ogni pannello **dichiara** il proprio selettore (`dom:`) quando viene raccolto, e la mappa
   si costruisce da lì. Prima si cercava per TITOLO: accoppiare due cose per il loro nome
   visibile è fragile per costruzione — il nome è fatto per essere letto, non per essere chiave.
   Il riordino avviene **dentro il genitore di ciascun elemento**, senza un elenco di contenitori
   scritto a mano (era lo stesso tipo di registro fisso già pagato con C10 e col red team).
   La griglia si ricostruisce a ogni render, quindi l'ordine va **riapplicato** subito dopo.

2. **Una chiave morta, e il fallimento era MUTO.** La griglia rende `data-macro="in:umich"` ma
   `MACRO_INFO` aveva ancora `"in:pmi"` (residuo della ridenominazione già annotata qui sopra).
   `openMacroInfo` esce in silenzio quando non trova la voce: **cliccare "Fiducia consumatori"
   nella dashboard non apriva niente**, e nessuno se n'era accorto.

Le 14 voci che davvero non hanno un riquadro (Alpha, FedWatch, Fear & Greed…) sono marcate
**"solo qui"** nel popup, e un test verifica che l'etichetta non menta in nessuna delle due direzioni.

⚠️ **Il test è stato sbagliato due volte prima di funzionare**, e vale la pena ricordarlo: la
prima stesura cercava le chiavi *letterali* nel sorgente, dove non ci sono (la griglia le
costruisce da template); la seconda le leggeva da un fixture che non ha `indicators`, quindi era
verde **per assenza di dati, non di difetti** — passava con il difetto iniettato. Ora parte dal
`data.json` reale. Un test va sempre validato iniettando il difetto che deve trovare.

## 🖥️ Vista terminale (v198) — gerarchia, non densità

Il problema non era la quantità di dati, era che **38 colonne, 37 pannelli e una griglia da 16
voci stavano tutti allo stesso livello di importanza**. Un terminale professionale non è più
denso — è più gerarchico. **Nessun dato è stato rimosso**: cambia cosa è in primo piano.

- **Barra di stato** (`renderStatusBar`): NAV, P&L, **budget**, **stop violati**, **concentrazione
  di fattore**, **leva di mercato**, VIX, sessione. Il criterio di scelta è preciso: sono le voci
  che, se cambiano, **cambiano cosa puoi fare oggi**. Quattro erano invisibili senza scorrere ed
  erano i vincoli più forti del book. Le classi `sb-bad`/`sb-warn` accendono un bordo solo sui
  vincoli attivi.
- **Coda delle decisioni** (`renderDecisionQueue`): stop violati + veti FORTI su titoli detenuti,
  ordinati per gravità e controvalore, ciascuno un clic dalla scheda del titolo. La fonte è
  `decisionVerdict()`, **la stessa del payload**: una sola verità per dashboard e LLM. Se è vuota
  lo dice — "niente da decidere" è informazione, non spazio bianco.
- **Vista compatta di default**: 9 colonne su 38 (portafoglio), 7 su 34 (watchlist). Le altre
  restano a un clic (`⚙ Colonne` o l'interruttore Compatta/Completa, che mostra sempre "N/38
  colonne"). ⚠️ Il default si applica **una sola volta** (`vista_iniziale_<tid>`) e **mai** se
  l'utente ha già una preferenza: una scelta dell'utente non va sovrascritta da un default.
- **Colore come informazione**: verde/rosso solo per il segno, ambra solo per ciò che vincola.
  Prima si colorava ovunque, ed è esattamente ciò che rendeva invisibili le righe che contano.

Verificato: payload **identico** passando da compatta a completa (69.096 caratteri), 0 errori
console, la coda elenca le 6 posizioni che il payload elenca a sua volta.

## 🗂️ Schede e orizzonte FedWatch (v199)

**Schede** (`setTab`): portafoglio, watchlist, macro, rischio. Sono quattro *momenti* diversi;
impilarli in una pagina sola costringeva a scorrere per trovare ciò che serve. ⚠️ Le sezioni
**senza** `data-pane` restano SEMPRE visibili (avvisi, barra di stato, coda decisioni): un
contenitore nuovo che nessuno ha marcato non deve sparire per omissione. Le tabelle si
ridisegnano quando tornano visibili — larghezze e sticky si calcolano sul layout, e su un
contenitore nascosto verrebbero sbagliate.

**FedWatch: il contratto non prezzava quella riunione.** `ZQ=F` è il future Fed Funds a 30 giorni
sul **mese corrente**. Il 31/07 il payload ne ricavava "RIALZO 2%" per la riunione del **16/09**,
mentre Polymarket — che quota proprio settembre — dava 56%. **I 54 punti di divergenza sembravano
disaccordo fra fonti e invece erano un errore di orizzonte nostro.** Oltre i 35 giorni il payload
ora **non pubblica una probabilità che non significa nulla**: dichiara il limite e indica la fonte
che quella riunione la prezza davvero. *Un numero fuori orizzonte è peggio di nessun numero.*

C14 puniva questa correzione (nessun ramo pubblicato → "probabilità a senso unico"): ora riconosce
la dichiarazione esplicita di limite **purché indichi la fonte alternativa**. Un detector che
punisce il comportamento corretto va aggiornato, non aggirato.

## 🚫 Il motore predittivo è stato TOLTO dal payload (v200)

Decisione presa **sui numeri, non sulle opinioni**. Il track record che il payload stesso pubblica:
**7 segnali maturati, ritorno medio −10,8%, sette punti percentuali peggio del Nasdaq, hit-rate
29%**. Un punteggio con quel curriculum, stampato in cima e su scala 0-100, **àncora comunque**:
l'ancoraggio non si batte con una nota a piè di pagina, si batte togliendo il numero.

**Via**: `verdetto interno <LABEL>`, i punteggi `N/100` dei candidati, la classifica ordinata,
l'etichetta `SCARTATO - VALUE TRAP` (un verdetto travestito da dato → ora `NON SUPERA IL FILTRO
QUALITÀ`, e la misura che lo motiva resta accanto).

**Resta** — ed è la parte che in questa sessione ha intercettato i difetti arrivati fino alle
decisioni: stop violati, concentrazione di fattore, livelli d'ingresso e capienze, R/R,
minusvalenze fiscali, matrice di rischio. **Quelle non prevedono nulla: calcolano.**

I filtri restano ma tornano a essere filtri: **chi passa e chi no, in ordine alfabetico, senza
punteggio**. Ordinare è già un giudizio.

⚠️ Tre test asserivano sulla STRINGA `"SCARTATO - VALUE TRAP"` e si sono rotti. Riallineati al
**fatto** (il filtro scatta, con quale motivazione e quale forza) invece che alla parola: un test
legato al testo si rompe a ogni riformulazione e non protegge nulla — **in questa sessione è già
successo tre volte**.

Se fra un mese, con ~25 osservazioni invece di 7, la misura fosse positiva, si rimette con un
commit. La decisione è reversibile; l'ancoraggio che produceva no.

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
