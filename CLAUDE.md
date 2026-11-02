# CLAUDE.md — regole d'ingaggio del progetto Trading (v527)

> Leggi questo file PRIMA di modificare qualsiasi cosa. Contiene solo le **regole vive**. La storia completa — perché
> esiste ogni regola, gate e trappola, versione per versione (v101 → v526) — è in **`docs/STORIA_VERSIONI.md`**: si
> consulta con `grep` (`vNNN`, nome di uno strumento, parola chiave) quando serve capire un gate o una scelta. Ogni
> versione nuova aggiunge la sua sezione in fondo a quel file; qui entra solo se cambia una regola viva, in poche righe.
> Lo spostamento l'ha deciso il CEO il 01/11/2026: questo file si carica a ogni messaggio, e 720 KB di storia
> consumavano il piano.

## 👤 Chi è il CEO, e come si lavora con lui
Sergio, 41 anni, poco tempo, lavora nel Governo e investe tutto il capitale; Salerno, due giorni a settimana a Roma.
Ama le analogie. Il piano di Claude è limitato e finisce presto: **risposte frugali, letture mirate** (sezioni e righe
che servono, mai output interi), niente giri lunghi di iniezioni senza necessità.

## 📌 Istruzioni permanenti del CEO
1. **Nessuna proiezione (02/09/2026).** Solo l'ultimo dato ufficiale con la data e il prossimo aggiornamento DICHIARATO
   dalla fonte; altrimenti «dato non disponibile». *Meglio non avere dati che avere dati non corretti.* Vale nel sistema,
   nei pacchetti e nelle risposte.
2. **Si lavora su `main`** e si pusha subito; una PR che nasce si unisce. Prima di ogni push `git pull --rebase origin
   main` (sui conflitti in `data/data.json` vince la remota). Il push È la pubblicazione: la rete è prima, negli hook.
3. **Alla fine di ogni giro di lavoro: `python3 scripts/stato_sistema.py`**, esito in 2-4 righe con ogni ⚠ per nome.
   Ciò che si sistema in sessione si sistema; ciò che chiede il CEO diventa una DOMANDA in `memoria/LIBRO.md`
   §1undecies con la sua data. *"Se ritieni fammi sempre domande."*
4. **Staccarsi da GitHub quanto più possibile**: i dati si leggono alla fonte in sessione (v511-v522); la pipeline è la
   riserva. Le dipendenze rimaste sono in `fonti_dirette.SOLO_PIPELINE`, e lo stato del sistema le data.
5. **Investimento** (regole intere in `memoria/LIBRO.md`): non si vende sui ribassi (15/10); l'unica vendita automatica
   è il salvavita a −30% (§1ter); la tenuta si decide per evidenza nei due versi (§1sexies); un CONFLITTO si decide ai
   conti con l'esame scritto prima e confermato dal CEO (§1quinquies). Le quantità sono solo l'aritmetica dell'unità di
   5.000 €, mai «la quantità giusta» (v439). Nessun punteggio composito (v200); ogni soglia è una convenzione dichiarata
   (v240). La liquidità è una RISERVA: quotazione di Anthropic o medie dopo i conti (01/11).
6. **Conflitti d'interessi, sempre dichiarati**: NVDA, GOOGL, AMZN, MSFT, BLK, GS, CRM sono investitori di Anthropic;
   CRWV, ORCL, CBRS clienti di OpenAI; SpaceX possiede xAI. **Su Anthropic stessa** (Claude è un suo prodotto): solo i
   fatti del prospetto, nessun giudizio.
7. **Privacy: il repository è PUBBLICO.** Nome, indirizzo, numeri di conto o di deposito, IBAN, codice fiscale del CEO
   non si scrivono in nessun file, test compresi (i gate usano sonde di FORMA). Nessun segreto nel repo. L'email
   dell'utente serve solo a identificarlo; a SEC va solo il contatto che la pipeline usa da sempre (`SEC_UA`).
8. **Divieti (v387)**: nessun trigger automatico; `/aggiorna` non esegue `update_data.py`, `notify_alerts.py`,
   `log_verdict.mjs`. 🛑 **Mai sovrascrivere `config/prompt_header.txt`** (lavoro del CEO).
9. **Servizi dismessi** (non reintrodurre): WhatsApp/CallMeBot, Gemini, morning brief, il documento HTML del report CIO.
   Reddit/WallStreetBets: i post non sono fatti (v451) — si contano le menzioni, come attenzione.

## 🧭 Il sistema oggi
- **L'analisi in chat** — un comando: `python3 scripts/analisi.py`. PRIMA `fonti_dirette.py` e `fonti_titoli.py`
  (letture alla fonte del giro, valide 30 minuti, in `memoria/dati/`), poi `numeri_libro`, `brief`, `schede_progetto`,
  `rotazione`, `posizionamento`, `indici`, `concorrenti`, POI `sintesi.py --registra`, DOPO `stato_sistema.py --giro`.
  La scheda completa (`memoria/dati/scheda_analisi_*.md`, fuori da git) si manda come allegato. **Forma statistica
  (v528)**: `statistica.py pagina` dice per ogni posizione cosa è successo nei casi simili contro la base; prima di
  OGNI operazione `statistica.py ingresso TICKER PREZZO --registra "intuizione"` (valore atteso in R, variante «aspetta
  la conferma», gli stop e gli ordini con limite a confronto, riga nel diario `memoria/diario_ingressi.jsonl`); `statistica.py bilancio` misura l'intuito. Esce 1 se uno
  strumento fallisce o una richiesta del registro è ASSENTE.
- **`memoria/LIBRO.md`**: posizioni (§1), sorvegliati (§1bis), semaforo e salvavita (§1ter), attesa (§1quater),
  decisioni ed esami (§1quinquies), tenuta (§1sexies), ordini (§1septies), conti dichiarati dall'emittente (§1octies),
  credito (§1novies), operazioni col cambio (§1decies), domande al CEO (§1undecies), fotografia del broker
  (§1duodecies), rendiconti (§1terdecies), soglie della sintesi (§1quattuordecies). Le soglie che il codice confronta
  stanno anche nel codice e un gate le rilegge dal libro.
- **`memoria/FORMATO_ANALISI.md`**: l'ordine della risposta in chat e il registro delle richieste con le chiavi
  (`[chiave]`): ogni richiesta nuova del CEO vi entra con la sua voce nel catalogo di `scripts/scheda.py`.
- **La pipeline** `scripts/update_data.py` gira su GitHub Actions (il cron è una coda: 99-263 minuti di ritardo,
  `memoria/OROLOGIO.md`) e scrive `data/data.json`: serve la pagina e fa da riserva all'analisi. Le funzioni condivise
  vivono in `scripts/comuni.py` e nella pipeline, e la sessione le chiama (una derivazione sola).
- **La pagina** (sito statico su GitHub Pages: `index.html`, `assets/app.js`, `assets/style.css`; NESSUN backend):
  quadro macro, pacchetti AI, calcolatori. Persistenza dal browser = GitHub Contents API col token in `localStorage`.
  **Prompt decoupling**: la testata è `config/prompt_header_macro.txt`/`config/prompt_header.txt` (del CEO), la coda la
  genera `buildPrompt()`; `DEFAULT_PROMPT_HEADER` è solo il ripiego offline e non va riallineato al file. Nella coda
  solo FATTI, gli ordini stanno nella testata (C9). **Regola suprema**: nessun commit rompe la pipeline né `buildPrompt`.

## ✅ Prima di ogni commit (gli hook lo fanno; attivarli una volta per macchina: `git config core.hooksPath .githooks`)
- `node --check assets/app.js` · `node scripts/test_app.mjs` · `python3 scripts/test_update_data.py` ·
  `python3 scripts/test_analisi_libro.py` · `node scripts/coherence_check.mjs` · `node scripts/fx_check.mjs` ·
  `node scripts/redteam.mjs` · `python3 scripts/audit_data.py data/data.json` · `node scripts/self_check.mjs` ·
  `python3 scripts/modifica_sicura.py`.
- Ogni modifica a un sorgente passa da `modifica_sicura.modifica(percorso, trasforma)`: verifica e solo allora scrive.
- `.githooks/pre-push` riesegue i gate che leggono i dati DOPO il rebase (la finestra commit → rebase → push).
- Bump di `?v=` in `index.html` e di `BUILD_VERSION` solo se cambia un file servito al browser (v440).
- I pavimenti delle suite (in `self_check.mjs`) si alzano quando la suite cresce, mai si abbassano per far passare.
- Dopo un riavvio del container: `pip install -r scripts/requirements.txt`, gli hook, e il ramo `main` riallineato.

## 🛠️ Le trappole che si ripetono (la storia di ciascuna è in `docs/STORIA_VERSIONI.md`)
**Validare un gate**
- Un gate nuovo si valida **iniettando il difetto** che deve trovare: con `modifica_sicura` anche l'iniezione, su copie
  del repo verificate per impronta (riverificate a ogni ripresa), una iniezione alla volta per copia, ripristino da
  uno snapshot preso PRIMA e verificato per hash — **mai `git checkout`** (cancella il lavoro non committato, v430).
- Un'iniezione che non morde ha tre cause: hai iniettato un'altra cosa; il gate è decorativo; **la fixture non contiene
  il fenomeno** (la più frequente, v430). Un'iniezione che fa MORIRE la suite racconta male: il check deve cadere col
  suo nome (`.get`, non `[]`; v407, v471).
- **Lo stato si costruisce, non si aspetta**: un check che dipende dai dati del giorno o dall'orologio va rosso a
  calendario (v429, v456); l'orologio si ferma dentro il check (`suVeriAlle`, `suVeriOttobre`…). Le suite spengono la
  lettura del giro (`TRADING_FONTI_TITOLI=spenta`).
- **Mai ancorarsi a una stringa letterale o a una forma** (oltre 40 rotture): ci si àncora alla proprietà. Un gate che
  pinna un difetto lo rende permanente. Ancoraggio aperto: `mg-card` prende `mg-card-head`, `update_data.py` è dentro
  `test_update_data.py` — si chiude l'ancora. Il gate che trova sé stesso: tolti commenti e docstring, e chi cerca
  un'assenza guarda la REGIONE dei dati, non la prosa che la spiega.
- Nei template passati al vm: **niente backtick, niente `\d \s \w \b \n \"`** (meta-gate); a capo con
  `String.fromCharCode(10)`; `check()` vuole un booleano; `no()` non esiste nel vm (`suVeriEsito`).

**Scrivere il codice**
- **Una grandezza, una derivazione** (v161): due implementazioni della stessa domanda divergono al primo ritocco. Una
  correzione si applica a TUTTI i rami e a tutte le superfici (v412). Formattatore unico, **virgola decimale**.
- **Le assenze si dichiarano** (v406): «il sistema non ha il dato» e «ce l'ha e non lo passa» si leggono uguali. Le
  fonti hanno tre esiti — con voci, senza voci, NON letta (v389). Un buco non è uno zero (v205).
- **Stato del mercato e freschezza del dato sono due cose diverse** (v193): una barra in formazione non è conclusa; le
  serie possono finire in sedute diverse (v186, v507); le date si allineano per DATA, mai per posizione (v207, v393).
- **Fusi con `zoneinfo`, mai scarti a mano** (v470): Roma e New York distano 5 o 6 ore secondo la settimana. L'ora di
  EDGAR è UTC (v501).
- **Un numero scritto a mano invecchia da solo** — conteggi, date, soglie, esempi nelle istruzioni (v410, v424).
- Un'etichetta non afferma più del suo dato (v405); un avviso che suona sempre non avvisa (v421).
- **Ricevuta del taglio prima di tagliare**: elencare cosa sta dentro e intorno, contare tutte le dichiarazioni di primo
  livello (v238: un `let` portato via ha ucciso la pagina con 219 test verdi). La sintassi valida non dice niente
  sull'esecuzione.
- Si prova il **collegamento**, non solo il controllo (v399, v443): eseguire la strada vera.
- Una conclusione «non disponibile» si rimisura quando la domanda torna (v497, v512).

**Strumenti e ambiente**
- Un harness che semplifica un ingresso produce un risultato DIVERSO (v421). Il proxy sostituisce l'header
  `Authorization`: una richiesta con un token falso deve fallire, o la misura mente (v438).
- `$?` dopo una pipe misura `tail`; un harness che modifica file non va mai in pipe (SIGPIPE, v469). La variabile di un
  percorso si assegna **su una riga sua** prima dei processi in background (v492, v509, v520, v522). Si aspetta il FILE
  che il processo scrive, mai `pgrep` sul suo nome (v512).
- C9 prende i clitici (`Contarle`, `affiancarle`) come imperativi: si riformula, non si allenta il detector.
- **Leggere l'uscita come il destinatario** trova i difetti che i gate non vedono: è l'esercizio ricorrente.

## 🗺️ Mappa rapida
- `scripts/analisi.py` comando unico · `sintesi.py` sintesi operativa · `numeri_libro.py` rischio, semaforo, tenuta,
  ordini, decisioni, cambio · `rotazione.py` watchlist, pavimenti, struttura, ingressi · `schede_progetto.py` e
  `credito.py` schede per nome · `brief.py` notizie, aste, trimestrali · `posizionamento.py` opzioni, dark pool, CFTC,
  forum · `indici.py` multipli e volatilità · `concorrenti.py` quote e salute · `fonti_dirette.py`/`fonti_titoli.py`
  letture alla fonte · `statistica.py` forma statistica e diario · `stato_sistema.py` stato · `scheda.py` scheda completa · `comuni.py` funzioni condivise.
- `memoria/` libro, formato, registri (`registro_performance.jsonl`, `registro_analisi.jsonl`, `wsb.jsonl`,
  `cds_sessione.jsonl`…: si committano dopo l'analisi, lo stato del sistema lo ricorda).
- `config/` posizioni e watchlist della pipeline (devono coincidere con il libro: gate v479/v480), `cds_entita.json`.
- `.github/workflows/` `update-data.yml` (dati) e `tests.yml` (test) · `.claude/commands/` `/aggiorna`, `/titolo`.

## 🔧 Convenzioni fisse della pagina
- `SORT_FIELDS` 1:1 con le `<th>`; aggiungendo o togliendo colonne si aggiornano i `colspan`. Handler su elementi che
  possono mancare: sempre `?.`.
- I ripieghi dei dati sono RUMOROSI (dichiarati), mai etichette silenziose. FINRA e multpl rispondono a un UA generico
  senza `Accept`, e dagli IP del CI sono spesso bloccati: catena con carry-forward dichiarato.
