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

## ⛔ Tre tagli, tre vicini portati via (v201-v204) — e la guardia che ne è nata

In un'ora, tre operazioni di rimozione hanno preso con sé un elemento **vicino** a quello che
dovevano togliere:

1. **v200 → v201**: togliendo il verdetto è sparita la **concentrazione di fattore**, che viveva
   dentro `dv.reasons`. Era il fatto di rischio più importante del book.
2. **v203**: rimuovendo memoria storica ho tolto da C12 **cinque fatti** che appartenevano al
   taglio v184 e sono ancora tutti nel payload.
3. **v204**: rimuovendo barra di stato e coda decisioni è sparita la **navigazione a schede**, che
   stava fisicamente fra i due blocchi.

**L'attenzione non basta**: tutte e tre le volte stavo attento, e tutte e tre le volte l'ho
scoperto solo verificando dopo. Da qui la guardia `v204 struttura`: un elenco di elementi portanti
di `index.html` che devono esistere, e che si rompe rumorosamente se una rimozione ne prende uno.
Validata togliendo le schede e verificando che le nomini.

**Regola operativa**: quando si toglie un CONTENITORE (un blocco di `lines.push`, una porzione di
HTML fra due marcatori, un array di configurazione), elencare PRIMA cosa ci sta dentro e cosa sta
in mezzo. La ricevuta del taglio va scritta prima di tagliare, non dopo aver visto cosa manca.

## 📊 Vista STRUTTURA (v205) — e il gate che era spento

Barra laterale con le macro-sezioni, centro con i grafici. La barra laterale **non è un elemento
nuovo**: è la stessa `#main-tabs` di v199 impaginata in verticale sopra gli 860px — stessi bottoni,
stesso `setTab`, stessa guardia anti-taglio. Sotto gli 860px torna una striscia orizzontale.

**Il vincolo che decide la vista**: i dati arrivano su cron, non tick-by-tick. Quindi **niente
grafici di prezzo** — investing.com e TradingView li fanno meglio e in tempo reale. Si disegna solo
ciò che nessuno dei due può disegnare, perché non conosce il libro: concentrazione (peso vs MCR),
mappa di correlazione, deriva della concentrazione, allocazione, distanza dagli stop.

### 🛑 Il gate che contava 174 check e ne verificava 161

`scripts/test_app.mjs` aveva il blocco `/* report */` — il ciclo che calcola `fail` e stampa
PASS/FAIL — **prima** degli ultimi tre gruppi di check (v196, v204 e ora v205). Quei check
finivano in `T` ed erano **contati nel totale**, ma `fail` era già stato calcolato: non venivano
stampati e **non facevano uscire con codice 1**. Verificato togliendo `id="conc-chart"` da
index.html: la suite annunciava *"174/174 superati"* ed exit 0.

Cioè **la guardia anti-taglio di v204 — quella nata perché "l'attenzione non basta" — era spenta**,
e con lei il registro macro di v196. Il report ora è l'ultima cosa del file. *Un test che non può
rompere la CI non è un test, è un commento.* Appena riacceso ha subito trovato un mio check verde
per la premessa sbagliata (vedi sotto).

### Le trappole di questa vista, tutte già pagate

- **DENOMINATORI DIVERSI.** Il peso sul NAV e l'MCR non stanno sullo stesso universo: la pipeline
  calcola il contributo al rischio solo su chi ha ≥60 rendimenti giornalieri, quindi **il BTP non
  è nella varianza**. Affiancare "21% del NAV" e "40% della varianza azionaria" è confrontare due
  frazioni con basi diverse — la classe che `coherence_check` chiama *denominatori non dichiarati*.
  Le due barre stanno **entrambe sul comparto azionario** (sommano a 100% tutte e due) e il peso
  sul NAV resta come numero accanto, dichiarato per quello che è.
- **`corr_matrix` pubblicata dalla pipeline** (stessa `corr` da cui escono `avg_corr`/`max_corr`):
  senza, la dashboard ne calcolerebbe una propria su una finestra diversa e mostrerebbe, per la
  stessa coppia, un numero che non coincide con la colonna della tabella. Finché il CI non l'ha
  rigenerata, `app.js` la calcola dalle spark `m6` **dichiarando la base a 6 mesi** (stessa logica
  del fallback FedWatch di v187: senza, il grafico resterebbe vuoto per ore dopo il rilascio).
- **Un buco non è uno zero.** In `derivaConcentrazione` una data in cui il titolo non era in
  portafoglio resta `null`: uno zero direbbe "rischio nullo" e la linea scenderebbe a terra
  disegnando un fatto mai accaduto.
- **La scala colori si satura a 0,7, non a 1.** Fra titoli azionari una correlazione di 1 non
  esiste: tarare il rosso sull'unità lasciava TUTTA la mappa nel verde e il grafico non diceva
  niente. Sopra 0,7 due titoli sono la stessa scommessa — lì il colore deve gridare.
- **`<span>` inline che ignora `width`.** `.abar-fill` non aveva `display:block`: le barre
  dell'allocazione sembravano **piene al 100% su ogni riga**. Nessun errore in console, nessun
  test rosso — *un grafico che dice il falso senza rompersi*. Trovato solo misurando in browser
  (`getComputedStyle` restituiva `"100%"` invece di un valore in px: è il sintomo).
  Le barre gemelle non ne soffrivano perché sono figlie di un grid, che le blockifica.
- **Isolamento dei test.** `DATA = REALE` assegna per riferimento: due check che mutano il
  portafoglio per provare un ramo lasciavano la mutazione addosso a `REALE` e rompevano i
  successivi. Ora ogni check parte da una copia profonda.
- **La somma a 100% non prova nulla** se si normalizza sul proprio totale. Il check
  dell'allocazione verifica che il totale sia il patrimonio vero e che la quota USD **coincida
  con `fxExposure()`**, cioè con il numero già pubblicato altrove.

Payload verificato **identico al byte** prima e dopo (a meno dei campi derivati dall'orologio), con
un check dedicato che rigenera `buildPrompt()` dopo aver chiamato tutte le funzioni della vista.
Su iPhone 375px: documento 375px, nessun taglio, la matrice scorre dentro il proprio contenitore.

## 🎨 v206 — macro in grafici, tabelle con barre, e i registri senza guardia

Tre richieste del CEO in una: **via la mappa di correlazione** ("non la capisco e non ne capisco
l'utilità"), **macro in grafici**, **meno numeri e più grafici anche nelle tabelle**.

### Il taglio della mappa: ricevuta prima, non dopo
Elencato PRIMA di tagliare cosa vive dentro i confini (`pearson`, `logReturns`,
`matriceCorrelazione`, `CORR_SAT`, `corrColor`, `renderCorrMap`) e chi sta **in mezzo e intorno**
(`concentrazioneRows`/`renderConcentrazione` prima, `derivaConcentrazione`/`renderDeriva` dopo),
con `assert` che il blocco rimosso non contenesse i vicini. Rimossa anche `corr_matrix` dalla
pipeline: **era nata per quel grafico e non aveva altri consumatori** — `git diff` contro il
commit pre-v205 su `update_data.py` è vuoto. L'informazione non è persa: `avg_pairwise_corr` e
`max_corr_with` restano nel payload e nelle colonne. Un check citava ancora la funzione rimossa e
il gate l'ha preso subito.

### La macro erano 34 riquadri identici
7 mini-card + 11 gauge + 16 tile, ognuno **un numero con sotto un termometro 0-100**. Un
termometro che sta ovunque non porta segnale. E le serie storiche che `data.json` contiene **non
erano disegnate in dashboard**: `curve_history` (501 punti), `credit.history` (260),
`vix.spark` (30 — mai disegnata *nemmeno* nei popup, esisteva solo dentro il testo del prompt),
`margin_debt.history` (13). Ora in cima ci sono tre domande, non trenta numeri:
1. **Rotazione** — 21 ETF ordinati, con **accese le barre dei settori in cui hai i soldi**. È il
   grafico che risponde alla domanda vera: oggi *Semiconduttori −12,9% a 1 mese, terzultimo su 21,
   col 75% del capitale sopra*, mentre guida Energia +12,9% dove non sei. L'aggancio libro↔ETF non
   è un elenco scritto a mano: i semi si riconoscono da `rs_bench === "sox"`, cioè dal benchmark
   che la pipeline ha già scelto, e il resto da `sector`. Se domani non ci fossero più semi, SMH
   smetterebbe di illuminarsi da solo.
2. **Termometri di stress** — curva 10A-2A, HY OAS, VIX, ciascuno **con le sue soglie disegnate**.
   Un livello senza soglia non dice niente: "HY OAS 2,84" è un numero, "2,84 contro i 4,0 della
   tensione" è un'informazione.
3. **Leva e stagionalità** — margin debt (100% del massimo storico, +49% a/a) e i 12 mesi con
   quello corrente acceso.

I 34 riquadri **restano tutti**, dentro un `<details>` chiuso: accessibili, non in primo piano
(e la guardia strutturale continua a vederli).

### Due primitive, non dodici grafici
`graficoSerie()` (serie nel tempo con soglie e bande) e `barreOrdinate()` (barre che divergono
dallo zero, con righe evidenziabili) coprono tutto. Difetti trovati provandole:
- **`tacche()` stampava l'INDICE della tacca**: un asse 0…82,5 segnava "0 1 2 3 4" perché
  arrotondavo `v/passo` invece di riagganciare `v` al passo.
- **Un punto isolato fra due buchi spariva**: un segmento ha bisogno di 2 punti, quindi il dato
  esisteva e non si vedeva. Ora si disegna come punto.
- **⚠ IL VIEWBOX NON È UNA COSTANTE.** Dentro una card da 300px un viewBox da 640 scala il testo
  al **47%**: le etichette a 9,5px diventavano 4,5px, cioè illeggibili, e il grafico sembrava
  "sbagliato" senza esserlo. Ora la tela è parametrica (`compatto`, `w`) e si verifica misurando
  `renderW / viewBox` in browser — deve stare vicino a 1.

### Tabelle: la barra sta nello SFONDO, la cifra resta
Su 38 colonne solo 3 erano davvero visive. Ora `Oggi`, `Guad. %`, `Target Δ` e `Drawdown 52S`
hanno una barra di fondo (`td.bar-cell` + `style="--v:NN"`), `RS 1M`/`RS NDX` una barra divergente
— **`rsBar` si chiamava così e non disegnava nessuna barra**, il nome mentiva — e `Financial
Health` usa `finHealthBar`, che era **scritta, con il suo CSS e il suo handler di click, e non
chiamata da nessuno**: l'handler era vivo e non poteva scattare (la classe di difetto v193
rovesciata). Idem `targetBar`.
- **Prima stesura sbagliata**: barre ad **altezza piena** al 20% di opacità. In una cella alta
  30px una fascia colorata non si legge come grafico ma come *riga evidenziata*, e due colonne
  adiacenti facevano scacchiera. Ora è una barra bassa ancorata al fondo, con la tacca dello zero.
- **La scala deve essere CONDIVISA fra le righe**, altrimenti ogni barra è relativa a se stessa e
  il confronto — l'unico motivo per cui la barra esiste — sparisce. `Guad. %` usa il massimo del
  portafoglio (MU +839%) e lo **dichiara nel tooltip**.
- Rischio-payload **zero per costruzione**: `mdRow()` legge i campi grezzi di `data.json` e non
  tocca il DOM. Verificato rigenerando `buildCIOText()` dopo aver chiamato tutte le funzioni nuove.

### 🛑 Tre registri che nessun test guardava — e uno era già rotto
`SORT_FIELDS` deve stare 1:1 con le `<th>`, i colspan delle righe speciali col numero di colonne,
e `VISTA_COMPATTA` con ciò che il suo commento dichiara. **Nessuno dei tre aveva un gate.**
E il terzo era già sbagliato: la watchlist dichiarava `// Titolo Prezzo Oggi RS RSndx Segnale
Trimestrale` ma gli indici 5 e 6 sono **Beta e Sharpe 1A** — cioè la forza relativa, il filtro
leader/laggard su 27 titoli, **non era nella vista di default**, al contrario del commento e al
contrario del portafoglio. L'accesso è per INDICE: sfasare una colonna non produce nessun errore,
solo il campo sbagliato in silenzio. Ora ci sono sei check, validati iniettando i difetti.

### Restyling: le fondamenta erano bucate
- **5 variabili CSS usate 27 volte e mai definite** (`--accent`, `--fg`, `--hover`, `--card-3`,
  `--bg2`). Dove c'era il fallback reggeva, dove non c'era la dichiarazione era **invalida e cadeva
  in silenzio**: trascinando una colonna non si vedeva dove sarebbe caduta, il focus del diario
  era grigio invece che blu, tre sfondi restavano trasparenti.
- **`.btn-ghost` usata 28 volte e mai definita** → i tre bottoni secondari della topbar pesavano
  quanto quello primario: quattro azioni gridavano insieme.
- **NAV e P&L si leggevano a 15px** mentre i titoli della vista Struttura stanno a 21px. Rapporto
  valore/etichetta 1,67× — sotto la soglia in cui l'occhio distingue un primo piano da uno sfondo.
  Ora `--fs-hero: 26px`. Insieme: `height` → `min-height` sulle card (a numeri più grandi il testo
  veniva **tagliato**) e via il `-webkit-line-clamp`.
- Lo stesso colore scritto in tre modi (bordo `#262b36` 10×, muted `#93a0b4` 5×, testo 6×, verde
  3×, quattro superfici di hover): tutta la scocca v188-v199 aveva un bordo **visibilmente più
  chiaro** del resto e la pagina sembrava due prodotti cuciti insieme. Ora tutti token.
- **38 hover contro 8 transizioni** e `prefers-reduced-motion` inesistente in 1375 righe, con 5
  animazioni in loop perpetuo. Le transizioni stanno in un `:where()` (specificità **zero**, non
  entra in nessuna guerra di specificità — vincolo v192) e il blocco reduced-motion c'è.
- `line-height` globale mancante (era `normal`, ~1,2), `color-scheme: dark` mancante (su Safari iOS
  gli spinner dei number-input erano chiari dentro un tema scuro), scrollbar non tematizzate.

## 📉 v207 — grafici che confrontavano serie senza un giorno in comune

I cinque difetti mappati in v206, sistemati. Il primo è il più grave che questa sessione abbia
trovato, e stava nel payload.

### `miniDualChart` usava l'INDICE come ascissa
`px = i / (len - 1) * w`. Due serie con finestre temporali diverse venivano **stirate sulla
stessa larghezza** e lette come se fossero allineate. Misurato sui dati veri:
- *"Fed Funds vs S&P 500 — ultimi 5 anni"*: 60 punti **mensili** (2021-07→2026-06) sopra 60 punti
  **giornalieri** (2026-05-06→07-31). Sovrapposizione reale: **26 giorni**.
- *"Disaccoppiamento"*: 36 giorni di S&P contro 12 trimestri di PIL → **zero giorni in comune**.
- *"Profitti reali"*: 3 mesi giornalieri contro 5 anni trimestrali → **zero giorni in comune**.

Tre grafici su quattro confrontavano serie che **non condividono un solo giorno**. Ora l'ascissa
è il tempo, il disegno si restringe alla finestra comune, e quando la finestra non esiste il
grafico lo **dichiara** invece di disegnare una linea che sembra una tendenza.

### La causa era in pipeline, e il commento la denunciava già
`fred_series(id, n, freq=None)` senza `freq` restituisce la frequenza **nativa**, e SP500 su FRED
è **giornaliera**. Quindi `fred_series("SP500", 36)  # ~3 anni mensili` prendeva 36 **sedute**
(7 settimane). Il parametro `freq="m"` esiste ed è usato correttamente 4 righe più in là nel
blocco `yield_recession`: era solo dimenticato qui. Conseguenza pubblicata nel payload:
`- Disaccoppiamento S&P 500 vs PIL reale: gap -3 pp (>40 pp storicamente precede correzioni)`
dove il −3 è **+3,1% di S&P su 7 settimane meno +6,3% di PIL su 3 anni**. Stessa cosa per
`corp_profit.gap` (−30,7). Il ramo NDX era invece corretto (yfinance `interval="1mo"`), e siccome
`worst_gap = max(gap, ndx_gap)` prendeva quello giusto, **il numero corretto copriva quello
sbagliato**: il difetto non si vedeva dall'esito.

Fix: `freq="m"` **e** `_finestra_comune()`, che ritaglia due serie all'intervallo condiviso e
ritorna `None` quando non esiste — perché due serie rebasate a 100 su **date di partenza diverse**
non sono confrontabili, e sottrarne i valori finali non produce un gap ma la differenza fra due
periodi. La guardia vive anche in `app.js` (`sovrapposizioneGiorni`), perché il CI rigenera su
cron e fino ad allora il payload leggerebbe i dati vecchi — stessa ragione dei rami FedWatch di
v187. Il payload ora **dichiara il limite** invece di pubblicare il numero: precedente diretto in
v199, *un numero fuori orizzonte è peggio di nessun numero*.

⚠ Verificato che il payload cambi **solo** nelle due righe volute, generandolo con `app.js`
prima e dopo **sullo stesso `data.json`**: confrontarlo con un payload salvato prima di un run
del CI misura i dati nuovi, non la modifica (già pagato in v185).

### FedWatch: il fix di v187 non era arrivato alla UI
Il popup mostrava le colonne **Taglio** e **Invariato** e basta, mentre i dati portano
`hike_prob` al 2% e al 26%: la stessa classe C14 — *una probabilità pubblicata a zero su una sola
direzione è informazione mancante travestita da informazione presente* — corretta nel payload in
v187 e sopravvissuta nella UI per due versioni. Erano **due implementazioni della stessa
derivazione**: ora c'è `ramiFedWatch()`, usata da entrambi (stessa lezione di v161 con
`usRegularSessionOpen`). L'estrazione è provata output-identica.

### Tre cose rese e mai mostrate
- `#market-direction` e `#tracking-error-box` **non esistevano in index.html**: `renderMiniCards`
  li popolava a ogni render con contenuto valido ("Direzione mercato 48% · Laterale", "Tracking
  Error vs S&P 500 −1,59 pp") che nessuno vedeva, e i due `addEventListener` erano no-op grazie
  al `?.`. Aggiunti i contenitori.
- `macro.momentum`, `froth`, `breadth`, `futures` finivano **solo** nel prompt: il CEO leggeva nel
  report dell'AI conclusioni che poggiavano su numeri che la sua pagina non conteneva. Ora sono
  una card. ⚠ Le chiavi vanno lette da `data.json`, non indovinate: erano `divergence_pp` (non
  `divergence`), `futures.nasdaq` (non `futures.nq`), `momentum.sp500.dist_pct`.
- Il popup P/E prometteva *"storico 10 anni (mensile, FRED)"* con **una sola rilevazione** in
  `history` (fonte multpl, bloccata dagli IP del CI): `miniLineChart` rispondeva "Storico non
  disponibile" sotto quel titolo. Ora il titolo dice quante rilevazioni ci sono davvero, e con
  meno di due spiega perché mancano anche media a 10 anni e percentile.

## ✂️ v208 — la regola del taglio: si toglie ciò che l'LLM riceve già

Il CEO ha chiesto di ridurre la pagina, tenendo la macro. La domanda non era *quanto* tagliare
ma **come decidere cosa**. La regola applicata, che vale anche per i tagli futuri:

> **Si toglie dalla pagina ciò che il payload porta già. Si tiene ciò che vive solo lì.**

Applicata alle 14 colonne fondamentali, con la ricevuta scritta PRIMA generando il payload sui
dati veri e cercandoci dentro ogni fatto:

| in payload | esito |
|---|---|
| Market Cap, P/E, P/E fwd, EV/EBITDA, ROE, margine, P/FCF, cresc. ricavi, PEG, Z-Score, Target Δ | **tolte** (da 1 a 49 occorrenze ciascuna nel payload) |
| **Debt/Equity, Div Yield, Financial Health** | **tenute** — non erano nel payload |

Senza quella verifica il taglio avrebbe fatto sparire **tre fatti dal sistema**, non dalla pagina:
è la classe v201-v204 (un taglio che si porta via il vicino), evitata solo perché la ricevuta è
stata scritta prima. Portafoglio 38→27 colonne, watchlist 34→23, **payload identico al byte**
(provato generandolo con `app.js` prima e dopo sullo stesso `data.json`).

⚠ Le 11 colonne tolte erano le **ultime** della tabella: un blocco in coda non sposta nessun
indice precedente, quindi `VISTA_COMPATTA` (che arriva al massimo a 22) non è stata toccata. Se
un domani si tagliano colonne **in mezzo**, quelle vanno ricalcolate — l'accesso è per indice.

### Due gate riscritti, e perché non è stato un aggiramento

1. **`SORT_FIELDS` aveva un fondo fisso** (`length > 30`) come controllo di sanità. Al primo
   taglio di colonne il gate è fallito **sul numero, non sul disallineamento che deve trovare**:
   un fondo numerico invecchia da solo, esattamente come il registro fisso di C10 e degli indici
   16/17 del red team. Ora la sanità è una PROPRIETÀ (`ptfTh[0] === "Titolo"`, cioè l'estrazione
   ha davvero trovato l'intestazione), non un conteggio.
2. **La guardia v188** chiedeva *"le 13 colonne fondamentali esistono nella tabella"* e sarebbe
   scattata su un taglio corretto. Riscriverla per farla tacere sarebbe stato il modo classico di
   perdere la protezione (v203). Ha invece **cambiato invariante**: ogni fatto deve restare
   raggiungibile *o dal payload o dalla tabella del portafoglio*; se esce da entrambi, il check
   lo dice. È l'invariante che conta davvero — la tabella è un modo di mostrare un fatto, non il
   fatto.
   ⚠ La prima stesura univa le due tabelle (`ptf ∪ wl`) e **NON ha morso** quando ho iniettato la
   perdita: il fatto sopravviveva nella watchlist. Ma perderlo sul portafoglio significa non
   vederlo su ciò che possiedi. Stretta alla tabella del portafoglio, l'innesto viene catturato.
   *Un check si valida iniettando il difetto, non rileggendolo.*

## 📊 v209-v210 — la macro in colonna centrale, e la prova del prompt su me stesso

**v209 — una porta sola.** Il bottone "📖 Macro" della topbar duplicava "📖 Dettagli macro" che
vive dentro la scheda: due porte per la stessa stanza. Rimosso; la macro si raggiunge solo dalla
barra laterale e tutto il suo contenuto sta al centro. ⚠ La guardia strutturale proteggeva
`id="btn-macro-top"`: NON è stata zittita, le è cambiato l'invariante — ora protegge l'ACCESSO
(`id="macro-details"`), che è la cosa che conta.

**Le mini-card diventano grafici.** "MacroQuant 55 · Rallentamento" con sotto un termometro è la
forma meno informativa che un dato possa assumere: dice *quanto*, non dice *di chi è colpa*. I
componenti erano già in `data.json` (13 + 7 + 5 + 4) e non erano disegnati da nessuna parte —
`risk_sentiment.components` non compariva nemmeno nei popup. Ora sono barre che divergono da 50
(su una scala 0-100 il neutro è il centro), ordinate dal peggiore al migliore: oggi il ciclo è
tirato giù dalla fiducia dei consumatori (26/100) e tenuto su dal credito (96/100). Anche i 10
campanelli BofA e lo Sharpe (36 rilevazioni, mai disegnate) sono diventati grafici.

⚠ **Una regola CSS scritta per allargare le etichette ha prodotto uno scorrimento orizzontale di
44px su tutta la pagina.** `grid-template-columns: … 96px` sulla colonna del valore: la
stagionalità scrive "+0,98% · 63% mesi positivi" (179px) e `white-space: nowrap` non tronca,
**spinge**. Il sintomo è invisibile a occhio e invisibile anche a un controllo sui rect: nessun
elemento sporgeva dal viewport. Si trova solo confrontando `scrollWidth` e `clientWidth`
risalendo la catena dei contenitori. Colonna del valore ad `auto`, mai a larghezza fissa.

### 🔬 La prova del prompt su me stesso (l'esercizio ricorrente di questo file)

Payload reale: 71.786 caratteri, 390 righe, ~20k token. Eseguito come lettore, non come revisore.

**Il fix v207 è atterrato, e cambia la lettura della macro.** Il CI ha rigenerato con `freq="m"`
e `_finestra_comune`: le due serie ora partono e finiscono **alla stessa data** (2023-04-01 →
2026-04-01, 1096 giorni comuni, entrambe rebasate a 100 lì). Conseguenza sui numeri pubblicati:
| | prima (sbagliato) | ora (corretto) |
|---|---|---|
| Disaccoppiamento S&P vs PIL | −3 pp | **+61 pp** |
| S&P vs profitti reali | −30,7 pp | **+34,9 pp** |
Entrambe le righe dichiarano soglia 40 pp. Prima il payload diceva implicitamente "niente da
vedere"; ora due misuratori indipendenti sfondano la soglia. **Non è un peggioramento del
mercato: è che prima il numero era una sottrazione fra periodi diversi.**

**Difetto trovato e corretto (v210): il limite d'ingresso irraggiungibile.** Il payload avvisa da
sempre quando il *target* è illusorio (`⚠ il target è di fatto AL PREZZO ATTUALE`) ma **non**
quando l'*ingresso* è irraggiungibile. Il commento nel codice descriveva il problema dal v160
("un limite a −6% … è un ordine che si riempie solo se il trend si rompe") e **nessuno lo
controllava**: si stampava la distanza e basta. Un ordine che non si riempie mai, riportato come
azione, dà la sensazione di aver agito senza aver agito.
⚠ **La soglia va in ATR, non in percentuale**, ed è il caso reale a dimostrarlo: WDC a −22,5%
NON va segnalato (ATR 9,92% → 2,3 ATR) mentre MSFT a −16,5% sì (ATR 3,45% → 4,8 ATR). Una soglia
percentuale avrebbe segnalato esattamente il titolo sbagliato.

**Attrito segnalato alla TESTATA (non implementabile da qui).** La riga dei dati dice
*"[ATTENZIONE: snapshot di 10 ore fa — i prezzi potrebbero essere disallineati dal mercato live;
verifica online i livelli critici]"* e la riga SUCCESSIVA dice *"WEEKEND, MERCATI CHIUSI"*. A
mercati chiusi i prezzi non possono essere disallineati: non c'è un mercato vivo. Come modello
ricevente spenderei la ricerca web obbligatoria di [A]1 a verificare prezzi congelati invece che
sulle 40 notizie non ancora prezzate, che la riga dopo indica come "il segnale fresco di questo
run". È la classe v193 rovesciata: **stato del mercato e freschezza del dato sono due cose
diverse**, e qui l'avviso di freschezza ignora lo stato del mercato.

## 🩹 v225 — il `</div>` orfano, e perché nessun gate lo vedeva

Il CEO ha segnalato **due volte** "la formattazione crea problemi di sovrapposizione del testo".
Entrambe le volte ho cercato nel CSS. La causa era in `index.html`: un `</div>` di troppo,
residuo del blocco `<details>` rimosso in v215/v218.

Davanti a un `</div>` in eccesso il parser HTML chiude il primo `div` **aperto in scope** — cioè
`.shell-main`. Misurato sul sito vivo prima della correzione: **8 sezioni su 18** finivano come
figlie dirette di `.shell`, che è una griglia `178px | 1038px`. Su Portafoglio le card si
alternavano fra le due colonne: *"Peso delle posizioni" disegnato largo 178px, dentro la colonna
della barra laterale.*

**Perché serviva un gate e non l'attenzione**: l'HTML malformato **non produce nessun errore**.
Il browser ripara in silenzio, la console resta pulita, i 180 check sulle funzioni pure passano
tutti. Stessa famiglia di `.abar-fill` senza `display:block` (v205) — *un difetto che non si
rompe*. Ora `test_app.mjs` verifica il bilanciamento dei tag e che ogni `section[data-pane]` sia
figlia **diretta** di `.shell-main`.

⚠ **Lo scanner dei tag va scritto a CARATTERI, non a regex.** Il favicon di questa pagina è un
data-URI che contiene `<svg …><rect/><text>T</text></svg>` **dentro un attributo**: una regex sui
tag lo legge come markup vero e denuncia uno sbilanciamento inesistente. La prima stesura della
guardia ci è cascata. Le virgolette degli attributi vanno rispettate.

⚠ **Misurare in browser richiede di verificare il viewport nella STESSA chiamata.** Durante la
verifica il pannello si è richiuso a larghezza 0 fra due chiamate e le misure dicevano che le
sezioni erano larghe 34-38px: stavo per dichiarare una catastrofe inesistente. `innerWidth` è il
primo campo da leggere in ogni misura, e va letto **insieme** ai rect, non prima.

## 🎚️ v225 — l'ordine delle sezioni: trascinabile e uguale su ogni device

Richiesta CEO: trascinare per riordinare, e che l'ordine resti *"a prescindere se apro la pagina
da mac o iphone"*. Tre decisioni, ognuna già pagata altrove in questo progetto:

1. **La chiave è `data-sez`**, non il titolo (accoppiare per nome visibile è fragile — v196) e non
   l'indice (invecchia da solo — C10, red team I6). Una sezione nuova finisce in coda (v191).
2. **Si permutano le POSIZIONI, non si spostano gli elementi liberamente.** Le sezioni di un pane
   non sono contigue e ciò che non ha `data-pane` non deve muoversi mai: si piantano segnaposto
   (nodi commento) nelle posizioni attuali e ci si rimettono dentro le sezioni nell'ordine nuovo.
3. **Pointer events, non HTML5 drag-and-drop** (che non esiste su Safari touch — v193). Le frecce
   ▲▼ restano e passano dalla **stessa** funzione: due percorsi separati divergerebbero.

Mentre si trascina, le card si riducono alla loro intestazione (`.in-riordino`): una card alta
600px farebbe saltare il layout a ogni scambio. Persistenza su `config/ui_order.json` via Contents
API — **localStorage da solo non soddisfa la richiesta**, è per-browser, ed è esattamente il
difetto già corretto sui parametri di rischio. Senza token il salvataggio è locale **e lo dice**.

## 📐 v225 — la barra 0-100 è stata RIMOSSA, non nascosta

`misuratore()` non esiste più. Il CEO ha respinto quella forma tre volte ("vedo ancora tante
barre"): al suo posto `quadrante()`, un arco con lancetta dove la posizione dell'ago è il
messaggio e non c'è una scala da decodificare. Per la stagionalità — 12 valori, non uno — è nato
`annoCircolare()`: l'anno è un cerchio, i mesi buoni sporgono in fuori dall'anello, quelli cattivi
rientrano, il mese corrente è acceso e scritto al centro.

**Regola che ne esce**: quando un utente rifiuta una forma grafica più di una volta, non si
migliora quella forma — si cambia forma. Le prime due iterazioni avevano reso la barra più bella,
più allineata e meglio spaziata; era sempre una barra.

## 🎨 v226-v227 — tre tentativi per capire che il problema non era la forma

Il CEO ha respinto la barra 0-100 (`misuratore`), poi il quadrante ad arco (`quadrante`), poi ha
chiesto di **vedere delle alternative prima** che toccassi altro. Aveva ragione tutte e tre le
volte, e la diagnosi giusta è arrivata solo alla terza:

> **Il problema non era la FORMA del widget — era che ce n'erano TRENTA IDENTICI in fila.**
> Nessuna forma sopravvive a essere ripetuta trenta volte.

Le prime due iterazioni avevano cambiato la geometria (barra → arco) lasciando intatta la
ripetizione: due muri indistinti invece di uno. **Regola operativa: quando un utente rifiuta una
resa grafica la seconda volta, non rifinirla — cambia FAMIGLIA visiva; e chiediti se ciò che
rifiuta è il singolo elemento o la sua moltiplicazione.**

Cosa c'è ora al posto dei 30 widget: **due grafici**. La RAGNATELA (30 indicatori in 6 famiglie,
un poligono: dove rientra verso il centro il quadro è debole) e i **PUNTI SU UN ASSE** (tutti sulla
stessa scala 0-100, una riga per famiglia — mostra dove si addensano e, cosa che nessuna media
dice, **quanto sono in disaccordo fra loro**). Sotto restano SOLO gli indicatori con una serie
storica vera, come i termometri di stress. Gli altri non prendono un widget di ripiego.
Caso per caso: i **campanelli sono booleani**, non punteggi → niente grafico a punteggio, restano
ciambella (quanti accesi) ed elenco (quali).

⚠ **Prima di proporre, RENDERE.** Le quattro alternative sono state disegnate sui dati veri e
sottoposte al CEO prima di scrivere una riga di produzione. Dopo due miss, una domanda con
anteprime costa un messaggio e vale più di un terzo tentativo a indovinare.

### 🛑 Il test era VERDE su un difetto che avevo già spedito
La v226 pubblicata disegnava **sette** spicchi mentre `famiglieMacro()` ne restituiva sei: il
settimo era "Altro". Causa: in `renderIndicatori` la chiave `k` serviva a due cose diverse
(classificare la famiglia **e** aprire il pannello); la azzeravo per gli indicatori senza pannello
e poi raggruppavo su quella chiave azzerata.

**Ma il punto non è il bug, è il test.** Il check "nessun indicatore resta fuori dalle famiglie"
chiamava `famiglieMacro(indicatoriClassifica())` **direttamente** — una strada che nessuno percorre.
Era verde mentre la pagina vera disegnava lo spicchio fantasma. *Un test che non passa dal codice
reale certifica una strada immaginaria.* Il check nuovo esegue `renderIndicatori()` intercettando
`document.querySelector` e legge l'HTML **davvero prodotto**.
Trovato solo perché dopo il push ho **contato i vertici disegnati** invece di rileggere la funzione.

⚠ Due sviste di stesura del test, che si ripetono: intercettare `globalThis.$` non funziona
(`$` è un `const` di modulo — si intercetta `document.querySelector`, che è ciò che `$` usa
dentro), e un **backtick dentro un template literal** lo chiude.

### Il viewBox, ripagato due volte in una versione
Prima stesura: ragnatela e asse **affiancati** in due colonne, tela fissa a 760. Misurato in
browser: l'asse rendeva a 416px, **scala 0,55** → etichette da 10,5px all'occhio a 5,8px. Non era
"sbagliato", era illeggibile per un motivo invisibile leggendo il codice. Ora la tela si sceglie
sullo spazio reale (`larghezzaTela`) e i grafici sono impilati: **scala 1,00 misurata dopo**.
Stessa classe subito dopo: il margine per le etichette del radar era **stimato** a 86px e
"Mercato e tecnica" usciva tagliata → ora si calcola dal nome più lungo, e un controllo verifica
che nessun testo esca dai confini del suo `<svg>`.

⚠ **`display:flex` + `align-items:center` stringe un figlio al suo contenuto**: la ragnatela
rendeva a 300px su una tela da 520 (scala 0,58) finché non le ho dato `width:100%` esplicito.

## 📅 v228 — la trimestrale di OGGI spariva dalle priorità

Trovato eseguendo il payload su me stesso (l'esercizio ricorrente di questo file). **PLTR
riportava gli utili OGGI, era in portafoglio e aveva lo stop violato**: il caso più urgente del
run. La tabella lo segnalava con `[!EARNINGS RISK]`; la riga **PRIORITÀ** del brief no.

Due derivazioni della stessa grandezza, che divergono esattamente a **zero giorni**:
| dove | formula | esito su "oggi" |
|---|---|---|
| tabella | `Math.ceil((data − adesso)/86400000)` | −0,45 → `-0` → **passa** |
| brief | `(data − adesso)/86400000 >= 0` | −0,45 → **non passa** |

`new Date("2026-08-03")` è la **mezzanotte** di quel giorno: alle 10:48 è già passata, quindi la
trimestrale del giorno stesso risultava nel passato. È la classe v161/v207 — *due implementazioni
della stessa domanda, coerenti solo per fortuna* — e qui il difetto **nascondeva l'evento più
urgente proprio nella riga che si chiama PRIORITÀ**.

Ora `giorniAllaTrimestrale()` conta **giorni di calendario in ora locale** (oggi = 0) ed è
l'unica strada: le **cinque** derivazioni sparse nel file passano tutte da lì. La riga ordina per
urgenza e marca il giorno stesso (`PLTR (OGGI), AMD (1g), RGTI (3g)`).

## 🔤 v228 — l'ordine per punteggio era sopravvissuto alla rimozione della classifica

v200 ha tolto la classifica del motore perché *"ordinare è già un giudizio"*, e il blocco FILTRI
lo **dichiara**: "in ordine alfabetico … questo blocco non classifica più". Ma il brief e il
blocco dei livelli stampavano la **stessa lista** ordinata per punteggio: `GOOGL, AVGO, MSFT,
AMZN, WDC` contro `AMZN, AVGO, GOOGL, MSFT, WDC`. Stessa lista, due ordini — e uno dei due
comunicava una preferenza che il sistema dichiara di non esprimere più.

**Regola**: quando si rimuove un giudizio, cercarne i residui **nell'ORDINE**, non solo nelle
etichette. Un elenco ordinato per punteggio è un punteggio, anche senza numeri accanto.

⚠ Il check che lo sorveglia è stato **sbagliato due volte**:
1. girava sulla **fixture**, dove non c'è nessun promosso → le estrazioni tornavano `null`, il
   check usciva `true` ed era **verde col difetto iniettato**. *Verde per assenza di dati, non di
   difetti* — la trappola già pagata in v196;
2. la seconda stesura ricostruiva lo scenario del CEO dentro il vm (cap 25% da
   `config/risk_params.json`, cassa reale) ed era **più fragile del difetto che sorvegliava**.
La terza verifica una **proprietà osservabile** (ogni elenco stampato è alfabetico) più il fatto
che entrambi i punti di stampa ordinino. *Se un check richiede di ricostruire mezzo mondo per
funzionare, sta misurando la cosa sbagliata.*

## 🕸️ v228 — la terza forma respinta, e perché stavolta la ragione è diversa

Barra → quadrante → **ragnatela**. Le prime due erano lo stesso errore (un widget per ogni
indicatore, trenta di fila); la ragnatela era **un grafico solo**, ma *"i grafici non li capisco"*.
Un radar chiede di sapere **cos'è un radar** prima di poter essere letto.

> **Un grafico che va spiegato non è un grafico leggibile, per elegante che sia.**

Resta l'**asse coi pallini**, che parla la stessa lingua dei termometri di stress (una scala con
le sue soglie disegnate), spostato subito sotto di essi su richiesta del CEO. Rimosso anche il
gestore del clic sulla ragnatela: *un handler vivo su un elemento che non esiste più è il sintomo
v193, non un residuo innocuo.*

⚠ **L'ordine salvato dall'utente VINCE su quello di `index.html`.** Spostare una sezione nel
sorgente non la sposta per chi ha già trascinato qualcosa (v225, `sezioni_ordine` +
`config/ui_order.json`). Verificato misurando su un browser pulito. Quando si riordina una
sezione nel sorgente, dirlo all'utente: per lui potrebbe non cambiare nulla.

## 🧮 v229 — accorpare nel PAYLOAD, non solo in dashboard

L'accorpamento macro di v225 era rimasto **solo nella UI**: il payload continuava a pubblicare
l'inflazione su **due** righe (CPI e PCE, oggi entrambe 3.7%) e la curva 10A-2A su **tre**.
Nessuna riga era sbagliata, ma chi conta i segnali ne contava cinque dove ce n'erano due — la
stessa classe che il payload **dichiara già altrove** ("contarli come due prove raddoppia un
segnale solo"), finalmente applicata invece che solo annotata.

⚠ **Il primo tentativo perdeva il dato invece di unirlo**, ed è stato preso dal gate v138:
togliendo `curve` dall'elenco generico, uno snapshot **senza `curve_history`** faceva sparire la
curva dal payload. Ora esce dall'elenco **solo se la riga dedicata verrà davvero emessa**.
*Un accorpamento va scritto con la condizione "l'altro posto esiste", non con l'assunzione.*

⚠ **C12 si è rotta e non era un difetto**: la ricevuta del taglio v184 cercava le due ETICHETTE
`Inflazione CPI` … `Inflazione PCE` su righe separate. Riagganciata al **fatto** (entrambi i
valori presenti). È la **quinta** volta in questo progetto che un check ancorato a una stringa
letterale si rompe su una riformulazione senza che manchi nulla.

## ⏱️ v229 — l'evento più urgente contraddetto dal dato più fresco

PLTR era `[STOP VIOLATO]` sulla **chiusura** ($123,06 sotto lo stop $124,81) mentre il pre-market
era già a **$125,44, sopra lo stop** — dato che lo **stesso payload pubblica due righe più in là**
nella cella `→ agg.`. Il blocco che impone *"una raccomandazione esplicita per ciascuno"* chiedeva
quindi una decisione su un evento che il mercato aveva già disfatto.

Classe **v193** — *stato del mercato e freschezza del dato sono due cose diverse* — applicata
all'evento che il payload tratta come il più urgente di tutti. **Non si cambia la violazione**
(lo stop è ancorato alle chiusure e il ratchet vive su quelle): si **dichiara** che l'esteso la
contraddice, e di quanto.

## 🧪 v229 — tre check sbagliati per lo stesso motivo, in una sessione sola

Tutti e tre giravano sulla **fixture**, che non ha `macro.indicators` — quindi **non contenevano
il fenomeno che dovevano misurare**. Uno era verde col difetto iniettato, gli altri rossi sul
codice corretto.

> **Un check che gira su dati privi del fenomeno non è un check.** Prima di scriverlo, chiedersi:
> *questi dati contengono la cosa che sto misurando?* Se no, va agganciato a `data.json`.

Più due sviste di stesura che si ripetono e vale la pena riconoscere a vista:
- un **commento in coda all'ultima riga** si mangia il ` } finally {…}` che `suReale` appende
  sulla stessa riga (stessa famiglia dei **backtick dentro un template literal**, che lo chiudono);
- **`\n` dentro un template literal diventa un a capo vero**: per una regex o uno split serve
  `String.fromCharCode(10)` o un doppio escape.

## ✂️ v229 — la terza ricevuta che morde in quattro versioni

Rimuovendo `annoCircolare()` avevo assunto che il vicino a valle fosse `renderLevaStagione()`:
fra le due era stato inserito **l'intero modulo v226** (`FAMIGLIE_MACRO`, `puntiSuAsse`,
`agganciaMacroDinamico`). L'`assert` scritto **prima** di tagliare l'ha intercettato — come già
per `quadrante()` in v226. **La classe v201-v204 non è teorica: in quattro versioni ha morso tre
volte.** La ricevuta del taglio va scritta prima, e deve essere eseguibile, non un commento.

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
