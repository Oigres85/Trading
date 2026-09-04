# CLAUDE.md — Regole d'ingaggio del progetto Trading Dashboard

> ## 🔻 v256 — IL SISTEMA È CAMBIATO ALLA RADICE. LEGGI QUESTO PRIMA DI TUTTO IL RESTO.
>
> Decisione del CEO (09/08/2026), testuale: *"elimina tutto e lascia solo una pagina con i dati
> macro e la relativa correlazione con esportazione prompt ai … lascia attivi calcolo pmc e
> calcolo vendite … portafoglio watchlist e news andranno tutti via … un box dove io andrò ad
> inserirti il ticker e tu lo analizzerai … analisi spot, non salvata"*.
>
> **Cosa esiste oggi**: UNA pagina (`index.html`, ~280 righe) con il quadro macro, la
> correlazione fra indicatori, il box per l'analisi spot di un titolo, e i due strumenti
> (Calcolatore PMC, Calcolo vendite). Niente schede, niente tabelle di titoli, niente news.
>
> **Cosa NON esiste più**: portafoglio, watchlist, news, diario, verdetto del motore, stop
> ratchet, matrice di rischio, filtri quantitativi, concentrazione di fattore, validatore degli
> ordini AI, parametri di rischio, riordino delle sezioni per pane. `app.js` è passato da
> 10.062 a ~6.700 righe; il pacchetto AI da 69.934 a ~14.000 caratteri.
>
> **⚠ GRAN PARTE DI QUESTO FILE DESCRIVE QUEL SISTEMA.** Le sezioni su Tabella A/B, SORT_FIELDS,
> colonne, verdetto, MCR, stop, diario, cap d'ingresso, budget operativo **raccontano codice che
> non c'è più**: valgono come STORIA e come lezioni di metodo (le trappole sono reali e si
> ripetono), non come descrizione dell'attuale. Non cercare di "riallineare" quel codice: non
> esiste. Le lezioni di metodo — ricevuta del taglio scritta prima, check validati per iniezione,
> registri che invecchiano da soli, gate che trovano se stessi, la sintassi che non dice niente
> sull'esecuzione — valgono TUTTE e sono costate care.
>
> **La pipeline `scripts/update_data.py` NON è stata toccata**: continua a leggere
> `config/holdings.json` e a produrre portafoglio, watchlist e news in `data/data.json`. È
> deliberato — la macro poggia su quei benchmark, e "Calcolo vendite" ha bisogno delle posizioni
> per calcolare plus/minus e tasse. Quello che è cambiato è chi LEGGE quei dati: la pagina e il
> pacchetto AI non li mostrano più.
>
> **Le due testate**: `config/prompt_header_macro.txt` è quella in uso (pacchetto macro).
> `config/prompt_header.txt` — la Costituzione del fondo, scritta dal CEO — resta sul repo,
> INTATTA e non letta: parla di ordini, stop e concentrazione del libro, e su un pacchetto senza
> posizioni sarebbe una lista di istruzioni impossibili. Se il portafoglio tornasse, si torna a
> leggerla cambiando `PROMPT_HEADER_PATH`.
>
> **I gate oggi**: `test_app.mjs` (51), `test_update_data.py` (78), `redteam.mjs` (32),
> `coherence_check.mjs` (11), `fx_check.mjs`, `audit_data.py`. La suite JS è passata da 282 a 51
> check: non è stata indebolita, è stata **potata** — i check tolti sorvegliavano funzionalità
> che il CEO ha chiuso, e quelli strutturali (wiring, elementi portanti, gate di render, chiamate
> a funzioni inesistenti) sono stati riscritti sul mondo nuovo, non zittiti.
>
> **⚠ La lezione nuova di questa versione**: il gate di render copriva la catena di `renderAll`,
> e il difetto vero stava in `refreshLivePrices` — che `renderAll` non chiama. `node --check`
> passava, 76 check passavano, e la pagina moriva al primo refresh dei prezzi. Ora c'è una
> guardia che non guarda una catena ma **tutte le invocazioni del file**, e verifica che il
> bersaglio esista. Se togli funzioni, è quella che ti salva.


> Leggi questo file PRIMA di modificare qualsiasi cosa. Riassume decisioni architetturali che
> non sono ovvie dal codice e che, se ignorate, rompono il sistema. Aggiornalo quando prendi
> una decisione strutturale nuova.

## 🚫 v396 — IL SISTEMA NON PROIETTA PIÙ NESSUNA DATA. FATTI, O "DATO NON DISPONIBILE"

Istruzione permanente del CEO (02/09/2026), testuale: *"non inserire mai proiezioni di dati che
acquisiamo (es. calendario FRED) ma solo ultimo dato ufficiale con data acquisizione e la data
del prossimo aggiornamento, se non abbiamo queste informazioni dici dato non disponibile …
**meglio non avere dati che avere dati non corretti**"*. Vale nel sistema E nel pacchetto.

**La ricevuta, scritta prima di tagliare.** Le proiezioni erano CINQUE, e nessuna si annunciava
come tale al di fuori di un'etichetta:

| dove | cosa inventava |
|---|---|
| `cadenzaDato` → `prossimo` | rilevazione + un passo + il ritardo TIPICO della fonte |
| `cadenzaDato` → `pubblicato` | la data d'uscita stimata (`pubblicato ~15/08`), **e su di essa l'età in giorni** |
| `cadenzaDato` → `scaduto`/`passata` | l'allarme *"era atteso il X e NON È ARRIVATO"*, confrontato con una data nostra |
| `nextReleaseDate()` | un calendario USA **scritto a mano** ("primo venerdì", "il 12", "il 28") |
| pipeline → `attesa_da_cadenza` | ultimo deposito SEC + cadenza mediana |
| pipeline → BoJ 2027 | quattro riunioni *"stimate sul calendario tipico"* |

**Quanto sbagliavano, misurato**: confrontate col calendario ufficiale arrivato lo stesso
giorno, le quattro uscite macro delle due settimane successive erano **tutte e quattro
sbagliate** — NFP e disoccupazione di 1 giorno, vendite al dettaglio di 1, **CPI di 2**. Un CPI
spostato di due giorni fa scrivere un'analisi *"prima del dato"* il giorno dopo che è uscito.

**E il taglio ha portato un guadagno, non solo una perdita.** Chiedendo al calendario FRED anche
la finestra ALL'INDIETRO, l'ultima uscita già avvenuta **è** la data di pubblicazione: una stima
è stata sostituita da un fatto, invece di essere semplicemente rimossa.

⚠ **L'allarme "dato non arrivato" NON è perso, si è spostato dove è misurato meglio**:
`validate_macro` confronta l'ETÀ della rilevazione con la cadenza massima ammessa per la serie —
una soglia misurata invece di una data immaginata. La vecchia versione poteva suonare su un dato
regolarissimo (è successo due volte: feste americane in v266, fine settimana in v271) e tacere su
uno davvero in ritardo.

⚠ **Gli esclusi si NOMINANO.** Tolte le date proiettate, tre indicatori restano senza prossimo
aggiornamento: il pacchetto li conta e li elenca. *Togliere righe in silenzio è peggio del
difetto che si sta correggendo* — chi legge non distingue "nessuna uscita prevista" da "il
sistema non sa quando esce". È la classe delle notizie contate e poi nascoste (v393).

⚠ **Le trimestrali restano stime, e la differenza è dichiarata**: le pubblica l'EMITTENTE come
propria attesa. Non sono una proiezione nostra — noi non ne calcoliamo più nessuna.

### 🦴 Dodici gate hanno accusato il colpo, e nessuno è stato zittito
v266 (×2), v271 (×2), v320, v350, v363 (×2), v390, v392, v393, v395 (×4). Tutti sorvegliavano
l'aritmetica della proiezione. A ciascuno è cambiato l'invariante, e quelli nati per difendere
qualcosa che non esiste più sono diventati la **ricevuta della rimozione**: verificano che ciò
che è stato tolto non rientri e che al suo posto ci sia la dichiarazione onesta.

⚠ Fra questi, **v320 è la sedicesima rottura di un check ancorato a una stringa letterale**
(`"prossimo atteso"`), e **v350 era diventato DORMIENTE**: il suo filtro non trovava più righe e
usciva verde per assenza del fenomeno. L'ha preso il meta-gate dei dormienti, non io.

### 🛠️ Il backtick dentro un template: tre volte in una sessione, chiuso con uno strumento
`` ` `` dentro un template literal **lo chiude**. È scritto in questo file da versioni e oggi ci
sono cascato **tre volte** — sempre in un commento che CITAVA del codice, che è precisamente
quando viene naturale usare gli apici inversi. Ogni volta `modifica_sicura` ha rifiutato la
scrittura, ma il rifiuto arriva dopo aver scritto lo script.

> **Un difetto di metodo ripetuto non si corregge con l'attenzione: si corregge cambiando lo
> strumento perché non lo accetti più.**

Ora c'è `meta: nessun backtick dentro un template passato al vm`, fratello del rilevatore dei
backslash. **Validato sul caso che `node --check` NON vede**: un template spezzato che resta
sintatticamente valido (`` suVeri(`x` + `…`) ``) — lì il compilatore tace e il check muore a
metà.
⚠ E scrivendolo ho fatto per la **sesta volta** il gate che trova sé stesso: i meta-gate
contengono la sequenza di apertura come DATO. Si tolgono i commenti e si esclude il proprio
blocco (v213, v240, v393).

## 🔬 v397 — QUATTRO BUCHI TROVATI LEGGENDO IL PACCHETTO COME IL SUO DESTINATARIO

Esercizio del CEO su CRWV. Tutti e quattro hanno la stessa forma: **il sistema AVEVA il dato e
non lo consegnava**, oppure lo consegnava con un'etichetta che affermava più del dato.

| difetto | misura |
|---|---|
| il **nome della società** non compare mai | il PASSO 0 ordina di cercare online e non dice come si chiama l'azienda: `name` era in `data.json` da sempre |
| *"Variazione di **oggi**: −3,58%"* | la barra era del **giorno prima** — classe v193/v229, nella riga che si legge per prima |
| il **massimo storico** non usciva | MSTR sta **49%** sopra il proprio massimo a 52 settimane, CRWV **22%**: "massimo dell'anno" e "massimo di sempre" descrivono due mondi |
| l'avviso "tabella trimestri ferma" | poggiava sulla data **attesa** (stima dell'emittente) **avendo nello stesso pacchetto** il deposito 8-K dell'11/08: arrivava alla conclusione giusta dal segnale più debole |

⚠ Il massimo storico si pubblica **solo se dice altro** dal massimo a 52 settimane (oltre il 2%
sopra): altrimenti è lo stesso fatto scritto due volte, la ridondanza che v184 ha misurato e tolto.

⚠ **La gerarchia introdotta da v396 vale anche per le DIAGNOSI, non solo per i dati**: prima il
fatto, la stima solo se il fatto non c'è. Col deposito la diagnosi passa da *"manca forse un
trimestre"* a *"ne è stato depositato uno che qui non compare"*, e il pacchetto lo dice.

⚠ **Diciassettesima rottura di un check ancorato a una stringa letterale**: v357 pretendeva
`POTREBBE NON ESSERE AGGIORNATA` ed è andato rosso perché la diagnosi era diventata più FORTE.

### 🎲 E un mio check poteva cadere per caso
Il gate v395 sul raggruppamento per comunicato costruiva gli id finti con `abs(hash(sid))`, e
`hash()` in Python è **randomizzato per processo**: un'altra serie poteva collidere con l'id 50 e
far fallire il check senza che nulla fosse rotto. Terza incarnazione della classe v233/v349 —
*un check che dipende dal caso invece che dalla proprietà va rosso da solo*. Ora è deterministico.

## 📰 v398 — LE NOTIZIE PER TITOLO TORNANO, E IL COSTO È STATO MISURATO PRIMA

Decisione del CEO dopo l'analisi del pacchetto CRWV. Erano state tolte in v269 per una ragione
**misurata, non estetica**: ~57 richieste RSS a ogni run (venti feed fissi più uno per ogni
titolo seguito) per riempire un blocco che nessuno apriva.

Quel costo non si ripresenta, ed è stato **misurato prima di scrivere il codice**: una richiesta
per ciascun titolo IN POSIZIONE — tredici — che rispondono in **6,8 secondi** su un run che ne
dura novanta. E il blocco non è più "un blocco che nessuno apre": finisce nel pacchetto del
titolo, che è quello che il CEO incolla.

> ⚠⚠ **PERCHÉ NON BASTA LA RICERCA WEB DELL'LLM**, che il pacchetto già ordina e che è più
> fresca della nostra: l'LLM cerca sul titolo che analizza e **non conosce il libro**. Una
> notizia su un altro nome del gruppo correlato riguarda anche la posizione in esame, e quel
> collegamento lo può fare solo chi ha il libro. È l'unica ragione per cui il blocco vale il suo
> costo, e per questo ha un gate tutto suo: se cadesse quella riga, resterebbero tredici
> richieste per niente.

⚠ **L'attribuzione viene dalla FONTE, non da noi.** Yahoo espone anche un feed multi-ticker che
costerebbe UNA richiesta sola, ma restituisce le voci senza dire a quale ticker appartengono:
per attribuirle dovremmo cercare il nome nel titolo, cioè indovinare. Sei secondi in più tolgono
di mezzo un'euristica.

⚠⚠ **E IL LIMITE DI FREQUENZA È REALE, quindi si dichiara invece di tacere.** Misurato: dopo una
quindicina di richieste Yahoo mette l'IP in castigo e risponde **429 anche a 1,5 secondi di
distanza** — non è una frequenza massima, è una quota. In CI la pipeline la consuma già coi
prezzi. Quindi `news_titoli` **non usa `http_get`** (che ritenta tre volte, cioè martella proprio
quando la fonte dice di rallentare), tiene **tre esiti distinti** — con voci, senza voci, NON
letto — e il blocco sta **in fondo al run, dopo i prezzi**, perché un blocco accessorio non deve
poter danneggiare quello portante.

> *"Nessuna notizia" e "la fonte non ha risposto" si leggono uguali e significano l'opposto.* È
> la lezione della v389 applicata prima del guasto invece che dopo.

### 🔁 v399 — LA FONTE ERA SBAGLIATA, E L'HA DETTO IL CI
Il primo run col codice nuovo ha risposto **429 su tutti e tredici i titoli**: Yahoo assegna una
quota per IP e quella dei runner di GitHub è già consumata dai prezzi. Il sistema lo ha
**dichiarato** ("13 su 13 NON letti") invece di mostrare un silenzio che si legge come "non è
successo niente" — la rete ha retto — ma una funzionalità che dichiara sempre di non aver potuto
leggere non serve a nessuno.

> È la trappola **v203 presa in tempo**: la fetch non era esercitabile dall'ambiente di sviluppo,
> l'ho scritto prima di pubblicare, e la verifica in CI ha detto che la fonte era sbagliata. Il
> costo è stato un run; il costo di non farla sarebbe stato un blocco vuoto per sempre.

Misurate quattro alternative **da un IP di datacenter**, che è la condizione del CI:

| fonte | esito |
|---|---|
| **Nasdaq** `feed/rssoutbound?symbol=TK` | 200, 15 voci, tutte datate, **specifiche del ticker** |
| Seeking Alpha | 200, 30 voci, ma sono analisi e opinioni più che notizie |
| Google News | 200 e molte voci, ma si interroga con una **stringa di ricerca**: l'attribuzione al titolo la dovremmo indovinare noi |
| Yahoo | **429, sempre** |

Vince Nasdaq: l'attribuzione viene dalla FONTE, non da un'euristica nostra. Yahoo resta come
**riserva**, e `fonti` registra chi ha servito ciascun titolo — la lezione v393, dove la riga di
UMich affermava tre cose false perché descriveva il ripiego.

⚠ **Nasdaq è lento**: 3,1 s a titolo misurati, cioè 40 secondi in fila su un run che ne dura
novanta — **+32 minuti di CI al giorno** su 48 run. Quattro richieste in parallelo li portano a
**10 secondi** con lo stesso esito (13/13). Il parallelismo è basso di proposito: la fonte è
gratuita e non va martellata, che è la stessa ragione per cui un 429 non si ritenta.

⚠ E i miei due check sono andati rossi **avendo ragione**: col secondo canale un 429 sul
primario non è un fallimento ma il segnale di passare alla riserva, quindi le chiamate diventano
due. L'invariante non è "una chiamata" ma **"nessun canale ritentato"**, ed è stato riscritto
così invece di essere allentato.

### 📏 Il tetto di lunghezza: il minimo è SPARITO
Misurato sul pacchetto vero: i quattro blocchi con tetto esplicito valgono già ~520 parole, e ne
restavano ~1.200 per gli altri sei più la tabella dei concorrenti, il collaudo, le segnalazioni
e le fonti. A pagare la compressione erano gli **ultimi** blocchi — rischio di libro e tesi
contraria — cioè proprio quelli in cui un modello a corto di spazio sostituisce le prove con
affermazioni.

> **Il rischio di allucinazione non nasce dall'avere più spazio: nasce dall'essere COSTRETTI a
> riempirlo.** Per questo il pavimento è sparito — un intervallo con un minimo è un invito a
> riempire — e al suo posto c'è la clausola che chiude il varco vero: *non allungare mai un
> blocco con affermazioni che non puoi sostenere*, e *"su questo non ho abbastanza per
> concludere" conta come contenuto*.

⚠ **Diciottesima rottura di un check ancorato a una stringa letterale**: v293 pretendeva
`BUDGET: N-M parole IN TUTTO`. Riagganciato al fatto — un tetto c'è ed è dichiarato tale.

### 🔌 Il check provava il CONTROLLO, non il COLLEGAMENTO
I gate sul nuovo `validate_macro` chiamavano la funzione con un dizionario costruito a mano:
togliendo la riga che aggancia la fonte al gate **restavano tutti verdi**. La fonte poteva
smettere di essere sorvegliata senza che nulla mordesse — letteralmente il guasto per cui le
news macro sono morte un anno. Trovato **iniettando**, non rileggendo.
⚠ E il check nuovo era rosso sul codice giusto perché `validate_macro(macro)` compare **due
volte** nel file e `find()` prendeva la prima: un indice preso dal posto sbagliato è un check
che misura un'altra cosa.

## 🚦 FLUSSO DI CONSEGNA — si lavora su `main`, e la PR si unisce sempre

Istruzione permanente del CEO (02/09/2026), testuale: *"Unisci sempre la pr e lavora
direttamente sul ramo principale affinché le modifiche siano sempre committate e subito
online"*. Nasce da un guasto concreto: il lavoro dalla v375 alla v379 era committato su un ramo
di lavoro e **la pagina viva restava indietro**, perché GitHub Pages serve `main` e nessun altro
ramo. *Un commit che non è su `main` non è online, per quanti gate abbia passato.*

Quindi: si sviluppa e si committa **su `main`**, si pusha subito, e se per qualunque ragione
nasce una PR **la si unisce** invece di lasciarla aperta.

> ⚠⚠ **E QUINDI NON C'È PIÙ UN PUNTO DI CONTROLLO DOPO LA SCRITTURA.** Con la PR, la CI girava
> *fra* il push e la pubblicazione. Su `main` il push **è** la pubblicazione: la CI trova gli
> errori quando il CEO può già aver aperto la pagina. La rete che è caduta va ricostruita
> **prima** del push, ed è tutta la lista di "✅ Prima di ogni commit" più il gate di render —
> non un sottoinsieme scelto a occhio, perché la classe di difetto che uccide la pagina
> (`allocGrafMode is not defined`, v238) passa `node --check` e 219 check su 220.
>
> È la stessa lezione del `.githooks/pre-commit`, che esiste proprio per chiudere la finestra
> fra la modifica e il push: ora quella finestra dà **direttamente sulla produzione**.
> Attivarlo, una volta per macchina: `git config core.hooksPath .githooks`

⚠ `main` riceve anche i commit del CI (`Aggiornamento dati …`, ~ogni 30 minuti): **prima di
ogni push** serve `git pull --rebase origin main`. Sui conflitti in `data/data.json` vince la
versione remota fresca — i calcoli si rifanno al run successivo.


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
- `python3 scripts/modifica_sicura.py` — **VERIFICA DEI SORGENTI (v278)**, e soprattutto la
  libreria che ogni script di modifica deve usare: `modifica(percorso, trasforma)` legge,
  trasforma, **VERIFICA e solo allora scrive**. Se il risultato non regge, il file originale
  non viene toccato.
  ⚠ Nasce da **quattro tagli lasciati a metà su `assets/app.js` in una sola sessione**. Ogni
  volta uno script ad hoc trovava i confini di una funzione con un'euristica ("la prossima riga
  a colonna zero", "conta le parentesi"), sbagliava su un caso non previsto — una regex che
  contiene virgolette, una chiusura non seguita da una riga a colonna zero — **e scriveva
  comunque**. Una volta ha prodotto un DUPLICATO di quattro funzioni, che in JS non rompe
  niente e passa tutti i gate.
  Rifiuta anche il **cambiamento nullo**: un `replace` che non trova la stringa è un no-op
  silenzioso, la classe "iniezione senza assert" già documentata qui sopra.
  Validato per iniezione su cinque difetti (JS rotto, funzione troncata, replace a vuoto,
  Python rotto, HTML sbilanciato): tutti rifiutati, file intatti.
- **`.githooks/pre-commit`** — chiude la finestra fra la modifica e il push: verifica i sorgenti
  ed esegue l'autocontrollo prima di lasciar committare. La CI li prendeva comunque, ma *dopo*
  il push e dopo che il CEO poteva già aver aperto la pagina.
  Attivazione, una volta per macchina: `git config core.hooksPath .githooks`
- `node scripts/self_check.mjs` — **AUTOCONTROLLO (v277)**: l'unico gate che guarda il SISTEMA
  invece dei dati. Nasce da due errori fatti nello stesso giorno che nessun altro gate ha preso,
  perché tutti gli altri controllano il PRODOTTO e nessuno l'OPERAZIONE che lo modifica:
  (a) una rimozione che ha **duplicato quattro funzioni** — in JS la seconda definizione vince in
  silenzio, il file girava e 120 check passavano; (b) uno script che, togliendo check, si è
  mangiato **metà suite compreso il blocco report**: `node scripts/test_app.mjs` usciva con
  **codice 0 senza stampare niente**, cioè verde per assenza di test.
  Controlla: nessuna funzione/costante duplicata, nessuna chiave scritta due volte in un
  oggetto, ogni suite **esegue e parla** (firma del rapporto + pavimento sul numero di check),
  BUILD_VERSION allineata al `?v=`, nessuna funzione citata dopo essere stata rimossa, nessun
  `$("#x").` senza guardia su un id che il markup non ha.
  ⚠ **I pavimenti si alzano quando la suite cresce, mai si abbassano per far passare una
  modifica.** Se una suite perde check, la domanda è perché — non come zittirlo.
  ⚠ **Scrivendolo mi sono procurato la trappola che doveva impedire**: cercava gli id nel
  sorgente con le stringhe rimosse, quindi ne trovava ZERO ed era verde a vuoto (0 contro 111
  sul sorgente vero). Un controllo nuovo va **validato iniettando il difetto** — vale anche
  quando lo scrivi tu, e specialmente allora.
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

## 🐎 v230 — perché un report reale ha liquidato MU (+839%) e AMD (+209%)

Il CEO ha incollato l'output di un LLM sul payload v229: ha venduto entrambi i vincitori citando
*"stop violato -4,32% in pre-market"*. Tre difetti concorrenti, tutti trovati leggendo il payload
come il ricevente. **Nessuna delle correzioni addolcisce la lettura: due su tre la rendono più
severa.** Si è resa onesta, non favorevole.

1. **Il numero nel tag non era quello che sembrava.** `[STOP A RISCHIO PRE -4,32%]` stampava il
   **gap pre/chiusura**, e il report l'ha letto come lo sfondamento dello stop. Peggio: su PLTR il
   tag diceva *"STOP A RISCHIO … +2,63%"* mentre quel movimento portava il prezzo **sopra** lo
   stop, cioè fuori dalla violazione — l'etichetta affermava il contrario del numero. Ora il tag
   dichiara la **distanza dallo stop**, che è la grandezza di cui parla.
2. **La PROSPETTIVA parlava di un prezzo che non è più quello.** La difesa v223 era calcolata
   sulla **chiusura** (*"MU: 0,31% della corsa"*) mentre la decisione si prende sul prezzo
   **esteso**: due numeri sullo stesso titolo, uno vecchio e rassicurante, uno fresco e
   allarmante. L'LLM ha creduto al più fresco, **ed era ragionevole**. Ora si rifà su quel prezzo
   quando è ancora sotto lo stop — misurato: MU resta rumore (0,85%), **AMD ne esce** (3,06% da
   1,79%). *La difesa ricalcola, non protegge a prescindere.*
3. **"IN AUMENTO" apriva l'eccezione B4 con una soglia fissa di 3 pp.** Una soglia fissa non sa se
   il movimento sia ordinario per quella serie — il registro che invecchia da solo (C10, red team
   I6). Ora il numero porta il proprio **percentile**: +4,2 pp è il movimento più ampio dello
   storico (94° su 17 finestre, mediana 2,1), e la riga lo dichiara. Oggi B4 è scattata a ragione,
   e ora il payload lo **dimostra** invece di lasciarlo dedurre da una soglia arbitraria.

**Regola che ne esce**: quando esistono due letture della stessa grandezza a freschezze diverse,
la difesa va agganciata a **quella su cui si decide**, non a quella su cui è comodo calcolarla.

### 🧪 Tre errori di metodo nella stessa sessione — riconoscerli a vista
- **`check()` vuole un BOOLEANO.** Avevo passato cinque *arrow function*: una funzione è truthy,
  quindi erano **verdi a vuoto** e le iniezioni non mordevano. Se un check nuovo passa anche col
  difetto dentro, la prima cosa da guardare è **cosa gli hai passato**, non il codice.
- **Un'iniezione di validazione senza `assert` è un no-op silenzioso.** Il `replace` non trovava
  la stringa, il file restava intatto e il test "passava". Ogni iniezione deve **asserire di aver
  modificato il file** prima di eseguire la suite.
- **Sesta rottura di un check ancorato a una stringa letterale** (v125, `[STOP A RISCHIO AFTER`).
  Riagganciato al fatto: la riga nomina la sessione estesa e lo stop.

## 🛡️ La suite controlla se stessa — tre errori di metodo chiusi alla radice

In una sola sessione ho ripetuto **sei volte** gli stessi tre sbagli, correggendoli ogni volta uno
per uno. Corretti a mano tornano: qui sono resi **impossibili o rumorosi**.

1. **`check()` accetta SOLO un boolean.** Prima accettava qualunque valore truthy, quindi
   `check("x", () => { … })` passava una **funzione**: verde **senza aver mai eseguito il proprio
   corpo**. Me ne sono accorto solo perché le iniezioni di validazione non mordevano — senza
   quelle, sarebbero rimasti in suite check permanentemente verdi che non verificano nulla.
   *La forma peggiore di test non è quello che fallisce a torto: è quello che passa a vuoto.*
2. **I dati veri hanno UNA copia sola.** Erano sei (`REALE`×2, `REALE2`…`REALE6`) con altrettanti
   helper locali, uno dei quali con lo **stesso nome del globale ma contratto diverso**. Quella
   duplicazione è la causa concreta dell'errore fatto **quattro volte**: scrivere un check che
   gira sulla **fixture**, che non ha `macro.indicators`, `seasonality`, `signposts` né `^KS11` —
   e quindi **non contiene il fenomeno da misurare**. Ora c'è un solo `REALE` e un solo
   `suVeri()`. *Un check che gira su dati privi del fenomeno non è un check.*
3. **Quattro meta-check sorvegliano la suite**: nessuna arrow nuda passata a `check()`; una sola
   copia dei dati e un solo helper; **nessun nome di check duplicato** (due nomi uguali rendono un
   fallimento non attribuibile); **nessun check dopo il blocco report** (regola v205).

⚠ **I meta-check hanno trovato SE STESSI, due volte**: l'esempio `check("x", () => {…})` scritto
nella nota che *spiega* la trappola veniva contato **come** trappola, e il pattern `REALE` con una
cifra compare per forza nel codice che lo cerca. È l'inciampo del gate v213, che si autodenunciava.
La scansione ora esclude il proprio blocco e **toglie i commenti** prima di leggere.

### La regola generale
> **Un difetto di metodo ripetuto non si corregge con l'attenzione: si corregge cambiando lo
> strumento perché non lo accetti più.** Se ti accorgi di correggere due volte lo stesso sbaglio
> di scrittura, la terza correzione va fatta all'attrezzo, non al caso.

Corollario già pagato altrove in questo file: **una validazione per iniezione senza `assert` è un
no-op silenzioso** — se il `replace` non trova la stringa, il file resta intatto e il test "passa".
Ogni iniezione deve asserire di aver modificato il file prima di eseguire la suite.

## 🇰🇷 v234 — un ramo irraggiungibile non è una protezione

Dal controllo del payload su me stesso. La riga diceva `KOSPI -5,12% [LIVE, Seoul in
contrattazione]` mentre quel valore veniva dallo **snapshot delle 07:54 KST**, un'ora prima
dell'apertura coreana.

La condizione era `price_live && seoulSessionOpen()`, e **nessuna delle due dice quando il dato è
stato preso**: `price_live` è un flag della pipeline, `seoulSessionOpen()` guarda l'orologio di
**adesso**. Mancava il timestamp dello snapshot.

> **Il punto vero**: v190 aveva già scritto **tre** stati (live · mercato APERTO ma dato VECCHIO ·
> borsa ferma) proprio perché il secondo è il più insidioso — ma con quella condizione lo stato di
> mezzo **non poteva mai scattare**. Era codice morto da v190, ed è per questo che il difetto è
> sopravvissuto a tre correzioni della stessa riga.
> **Un ramo che non può essere raggiunto non è una protezione: è un commento che sembra codice.**
> Quando si aggiunge uno stato, va scritto un check che lo ESERCITA, o non si saprà mai se esiste.

## 🧩 v233 — quello che il pop-up aveva dentro, portato fuori

Richiesta CEO: mini tab, e *"se il rispettivo pop up forniva dei grafici o tabelle, riporta
direttamente quelli in struttura"*. L'estrazione riusa `collectPanels` (v188): ogni pannello resta
l'**unica fonte di verità** del proprio contenuto, quindi non nasce un secondo elenco da tenere
allineato (classe C10/C12). Si estraggono solo `<svg>` e `<table>`, non la prosa.

⚠ **Misurato prima di scrivere il codice**: dei 30 indicatori solo **3** hanno un grafico nel
pannello e **4** una tabella. Gli altri 23 **non prendono un riempitivo** — inventare una forma per
far sembrare pieni i riquadri vuoti è l'errore delle barre e dei quadranti, respinto tre volte.

Due trappole di impaginazione dentro una scheda stretta: `white-space: nowrap` **taglia** le
tabelle, e `table-layout: fixed` le **comprime invece di farle scorrere** (28px persi per cella).
Con `width: max-content` la tabella larga scorre dentro il proprio contenitore e non perde nulla.

⚠ **Un check che misura i dati del giorno invece della proprietà va rosso da solo**: il check v230
modificava UNA sola posizione violata ma asseriva sull'intero payload — appena il numero di
violazioni nel `data.json` è cambiato è diventato rosso senza che nulla fosse rotto.

## 💀 v238-v239 — la pagina è andata MORTA in produzione con 219 test verdi

Il taglio di `renderDeriva()` si è portato via `let allocGrafMode = "sector"`, che stava **fra**
quella funzione e la successiva. Conseguenza: `allocGrafMode is not defined` dentro
`renderAllocGrafica` → `renderStruttura` → `renderAll` → `loadData`, cioè **l'intera pagina non
si disegnava**.

**Due lezioni, e la seconda è più grave della prima.**

1. **La ricevuta del taglio controllava la cosa sbagliata.** L'`assert` contava quante `function`
   cadevano dentro i confini — e un `let` non è una function. È la classe v201-v204 per la
   **quarta** volta, passata proprio perché la protezione guardava altrove.
   > Una ricevuta di taglio deve contare **tutte le dichiarazioni di primo livello** dentro i
   > confini, non solo quelle che ti aspetti di trovare.
2. **La suite era VERDE**: 219 check, `node --check`, red team, coerenza — tutti passati, perché
   **nessuno eseguiva il render**. È la classe v213 ("la pagina era morta") che torna con una
   causa diversa: allora un `addEventListener` su un elemento rimosso, qui una dichiarazione
   portata via da un taglio.
   > **La sintassi valida non dice niente sull'esecuzione.**

**Gate nuovo**: la catena di render (`renderStruttura`, `renderMacroGrafici`, `renderIndicatori`,
`renderSignposts`, `renderLevaStagione`, `renderRotazione`, `renderStress`) gira sui dati veri e
**qualunque eccezione è un fallimento**. Validato ritogliendo la dichiarazione: `node --check`
continua a passare, il gate no.

## 📏 v238 — la scala con le zone nominate

Sedici indicatori hanno **un valore e nessuno storico**. La barra 0-100 è stata respinta tre
volte perché chiedeva di stimare una lunghezza contro un asse implicito e **senza riferimenti**.
La scala porta le **zone nominate** — dove comincia la recessione, dov'è il target della Fed, dove
i multipli si comprimono — e sotto c'è scritto il nome della zona in cui il valore cade.

> **Il numero non è il messaggio: lo è la zona.** "3,7%" non dice niente; "3,7% · sopra il target
> ma gestibile", col 2% segnato sull'asse, sì.

E ogni scheda porta il suo **"come si legge"**: cosa guardare e *attraverso quale canale* quel dato
arriva a questo portafoglio. Un grafico senza quella riga è la forma già respinta.

⚠ Ricorrente e da riconoscere a vista: **`class="mg-card` matcha anche `mg-card-head`** — lo split
delle schede contava il doppio dei blocchi, e metà erano intestazioni senza grafico. Mi è costato
due volte; il selettore giusto è `/<div class="mg-card(?!-head)/`.
⚠ E un filtro va messo **dove vede tutto**: quello che toglieva le voci dalla classifica stava a
metà funzione, e `futures` veniva aggiunto dopo — sopravviveva.

## 🎚️ v240 — una soglia disegnata è un'AFFERMAZIONE, e va sostenuta

Il CEO ha chiesto: *"spero tu non abbia inventato dati"*. Audit riga per riga: **i valori no**
(vengono tutti da `data.json`), **le soglie in parte sì**. Quattro erano indifendibili:

| soglia | difetto |
|---|---|
| EUR/JPY "zona intervento 185" | **inventata** — nel file non c'è nulla sugli interventi, e la BoJ è intervenuta su USD/JPY |
| UMich "media storica 85" | **non è nel file** |
| disoccupazione "soglia Sahm 4,5%" | **falsa** — Sahm è un MOVIMENTO (+0,5 pp della media a 3 mesi sul minimo dei 12), non un livello; e la spiegazione nella stessa scheda la enunciava correttamente, quindi l'asse **contraddiceva il testo sotto di sé** |
| P/E "media storica 16,5" | è `forward_pe.avg_hist`, la media del **forward**, disegnata su una scala del **trailing** — e `sp500_pe.avg_10y` è `null`, quindi quella media **non esiste** |

Classe **v195**: *un ID indovinato e scritto come se fosse certo sarebbe stato peggio di un
tentativo dichiarato.*

> **Regola**: ogni tacca e ogni NOME DI ZONA disegnati su un asse sono affermazioni. O vengono dal
> dato (e si dice da quale campo), o sono una convenzione di lettura — e allora va **scritto** che
> lo sono. Anche il nome di una fascia è un'affermazione: "sopra la media storica" rivendica un
> confronto che il file non permette.

Ora ogni `scala()` porta la propria **provenienza**, e la differenza si legge:
*"il 2% è il target dichiarato della Federal Reserve"* contro *"bande di sola lettura: nel file
non c'è un intervallo storico di EUR/JPY"*.

⚠ **Terza volta in una sessione** che un gate trova sé stesso: le note che *spiegano* la soglia
rimossa la contengono per forza. La scansione toglie i commenti (come v213).
⚠ E una guardia non mordeva perché `class="sc-fonte` matcha anche `sc-fonte-qualsiasi`: quando si
ancora a una classe CSS, l'ancoraggio va chiuso.

## 🚪 v315 — "la funzione esiste" e "la funzione è raggiungibile" sono due cose diverse

Il CEO ha segnalato **due volte** di non riuscire a modificare il portafoglio. Verificato sulla
pagina viva: la modalità **funzionava** — il clic produceva 14 righe modificabili, `pfInModifica`
passava a `true`. Il bottone era **74×22 pixel, sfondo trasparente, 11px, in coda a ~400 caratteri
di prosa** dentro una nota grigia.

> **Un comando che nessuno trova non è un comando.** Nessun gate lo vedeva perché tutti
> guardavano se la funzione *esiste*: è la stessa famiglia di `.abar-fill` senza `display:block`
> (v205) e del `</div>` orfano (v225) — **difetti che non si rompono**. Il gate nuovo guarda
> **dove sta** il bottone (dentro `.card-head`, non dentro `nota.innerHTML`), non se la funzione
> è definita.

Corollario: quando l'utente segnala due volte la stessa cosa e il codice sembra corretto, la
domanda non è "funziona?" ma **"si trova?"**. Misurare il rettangolo, non rileggere l'handler.

## 💶 v315 — il controvalore in euro, e il default che è un'affermazione

- **La conversione è al cambio di OGGI, non il costo sostenuto.** Il cambio di carico è diverso
  posizione per posizione e il sistema non lo conosce: sommare euro convertiti oggi con euro
  spesi allora darebbe un patrimonio mai esistito. È la classe del gate valuta (v183), e la nota
  lo dichiara invece di lasciarlo dedurre. Il BTP resta **nominale × prezzo/100** (valutarlo come
  un'azione dava 4,1 milioni invece di 41 mila).
- **Ordinare è già un giudizio** (v200), quindi anche il DEFAULT lo è. Resta il **peso**:
  ordinare per guadagno mette in cima i vincitori, che è la lettura che fa tenere i perdenti.
  Un gate sorveglia il default — non perché cambiarlo sia vietato, ma perché dev'essere una
  decisione presa, non una svista.

## 📚 v315 — il terzo pacchetto: il libro intero

`buildPromptPortafoglio()` (~20k caratteri) sta accanto a `buildPromptTicker` e
`buildPromptSettore` e porta **il fatto che nessuno dei due può vedere**: sui dati veri,
Technology **78%** del libro e le prime tre posizioni al **54%**. Più posizioni nello stesso
comparto sono **una** scommessa scritta più volte, e si vede solo guardando il libro insieme.

⚠ **Dichiara in cima ciò che il sistema NON sa** — liquidità, altri conti, situazione fiscale —
e **vieta di dimensionare**: senza quei tre dati qualunque quantità è un numero che sembra un
consiglio. *I livelli di prezzo sì, le quantità no.* È l'unica cosa che tiene il pacchetto dalla
parte dei fatti, che è la riga di condotta di tutto il sistema.

⚠ Ripetute due sviste già scritte in questo file: **una regex dentro un template literal**
(`\d` diventa `d`) e — **settima volta** — un check ancorato a una **stringa letterale**, qui
una frase che nel testo **va a capo**. Riagganciato al fatto.

## 📡 v316 — la colonna di TradingView si CALCOLA, non si legge

Richiesta del CEO: stagionalità, conto economico, performance e dettagli tecnici della colonna
laterale del widget. **Non si raschia l'iframe di terzi**: le formule sono pubbliche e l'OHLCV lo
scarichiamo già. `batteria_tecnica`, `performance_orizzonti`, `stagionalita_titolo`,
`conto_trimestrale` in `scripts/update_data.py`.

⚠ **E non si calcolano lato pagina.** Le `sparks` in `data.json` sono **sotto-campionate e senza
date** — 51 punti per un anno intero. Un MACD o un ADX calcolati lì darebbero numeri che
*sembrano* giusti e non lo sono, e senza date non esiste finestra comune con nessuna serie macro
(v207). Quando un calcolo ha bisogno della barra vera, si fa dove la barra vera c'è.

⚠ **Un test sintetico ha trovato un difetto che i dati reali non contengono**: su una serie senza
sedute negative la perdita media è zero, la divisione dava `NaN` e l'RSI **spariva** proprio nel
caso più estremo. Per definizione lì vale 100. Su MU il valore è invariato (56,3) — ed è
esattamente perché i test sintetici servono.

## 🌉 v316 — il ponte macro→titolo: misurato, non raccontato

Il CEO ha chiesto una sezione su come i dati macro incidano sul titolo. L'unica forma che non sia
un oroscopo è la **regressione dei rendimenti giornalieri** del titolo su quelli di uno strumento
**quotato** che rappresenta il canale (QQQ mercato, SOXX comparto, TLT tassi, UUP dollaro).
Quotato perché ha la stessa barra giornaliera: la finestra comune esiste per costruzione, e le
serie si allineano **per data, mai per posizione**.

> ⚠⚠ **UN BETA SENZA IL SUO R² È MEZZO NUMERO.** Su MU il comparto spiega il 66% della varianza
> (R² 0,657) e i tassi lo **0,7%**. Il referto reale di ChatGPT che il CEO ha allegato scrive *"il
> canale negativo è il costo del capitale"* — su un titolo dove quel canale non è misurabile. Un
> beta pubblicato da solo INVITA a quel racconto. Beta, R², campione e finestra viaggiano insieme,
> e la testata vieta di sostenere un canale sotto R² 0,05 senza dichiarare che si va CONTRO la misura.

## 🔢 v316 — il percentile che non esisteva

Trovato leggendo il payload che il CEO ha incollato: *"Semiconduttori (SOX) — 116° percentile
dell'anno"*. **Un percentile sopra 100 non esiste.** `pct_1y` calcolava la **variazione** a un anno
e la pagina la stampava come **percentile**: l'oro a +31,3% usciva come "31° percentile", cioè nel
terzo BASSO del suo intervallo. **La lettura si inverte.** Il rame era "47° percentile" e sta al
**96%** del suo intervallo annuale.

Il commento nella pipeline diceva *"posizione nel range dell'anno"* e la formula faceva un'altra
cosa: **il commento dichiarava l'intenzione, il codice eseguiva altro, e nessuno dei due mentiva da
solo.** Ora sono due campi con due nomi veri, `var_1y` e `pos_range_1y`.

## 🚪 v316 — tre strade per consegnare un pacchetto, due rotte

Il CEO: *"pulsante relativo copia analisi del portafoglio non genera prompt"*. Il pacchetto si
generava (20.013 caratteri) e veniva buttato: `clipboard.writeText` **viene rifiutata** dal browser
e la promise rifiutata non era gestita — nessun testo, nessun messaggio, nessun errore in console.

⚠⚠ Ma il difetto vero erano **tre implementazioni della stessa operazione**: `copyCIOText` apriva
la modale (e quindi reggeva anche senza clipboard), `#set-copia` scriveva solo negli appunti e in
caso di rifiuto **perdeva il pacchetto**, `#pf-copia` non gestiva nemmeno il rifiuto. E `#set-copia`
era **rotto dalla v313**: leggeva `#set-input`, la barra rimossa, quindi con il comparto scelto
rispondeva *"Scegli prima un settore dall'elenco"*.

> Il gate della v313 verificava che il bottone **esistesse** e che `scegliSettore` **esistesse** —
> non che i due fossero **collegati**. È la stessa classe del bottone di modifica di v315: ho
> controllato l'esistenza, non la raggiungibilità. **Un pacchetto generato e non consegnato è un
> pacchetto non generato.** Ora la strada è una (`consegnaPacchetto`): il testo finisce SEMPRE nel
> riquadro, la clipboard è un di più che riesce o dichiara di non essere riuscito.

## 💹 v316 — il portafoglio segue il mercato, non lo snapshot

`refreshLivePrices` ricalcolava il guadagno solo `if (r.qty)`, ma le posizioni arrivano da
`config/posizioni.json` e portano **`qta`**: il ramo non entrava mai. E anche fosse entrato avrebbe
scritto `gain_pct`, mentre la tabella legge **`gain_pct_pos`** — *il campo aggiornato non era quello
letto*. Prezzo fresco accanto a guadagno vecchio, e la tabella nemmeno ridisegnata.

## 🪤 v326 — tre difetti MIEI, trovati da uno sciame di agenti dopo che li avevo "corretti"

Le prime quattro ondate della revisione hanno prodotto 39 reperti grezzi. Tre riguardavano
codice scritto **in questa stessa sessione**, e tutti e tre erano nati da una correzione.

### 1. Il beta diviso per cento
`sensibilita_macro` riceveva log-rendimenti in **frazione** e convertiva il benchmark in
**percentuale**: beta /100. MU contro il proprio settore dava **0,01 con correlazione 0,82**,
impossibile. E il test di v316 non l'ha preso perché **passava le percentuali a mano**: provava
una strada che la produzione non percorre.
> **La classe v238 applicata alle unità di misura.** Ora la funzione prende le CHIUSURE e decide
> lei l'unità, e il gate verifica l'INVARIANTE STATISTICO — beta = corr × (σ/σ), quindi con
> correlazione alta il beta non può essere microscopico. Nessuna scelta di unità lo soddisfa per caso.

### 2. Il punteggio a denti di sega
v319 aveva chiuso l'inversione **grossa** (fra le bande) e ne aveva aperta una **fine**: dentro
ogni banda il punteggio cresceva col valore, anche dove il valore alto è la cosa peggiore.
HY OAS a 0,5% valeva **75**, a 3,9% valeva **95**; l'ampiezza a −8 pp (partecipazione massima)
valeva 72 mentre a −1,1 pp valeva 96. E due bande rosse adiacenti facevano **ripartire** il
numero: una crisi valeva più di uno stress grave.
> **Un gate che pinna il comportamento sbagliato lo rende permanente**: la tabella del contratto
> conteneva l'inversione (2,71→88 contro 3,9→95). Ora il verso si RICAVA dall'ordine delle zone,
> le bande dello stesso colore si fondono, e il check nuovo non guarda valori attesi ma la
> **proprietà**: la scala è monotona su 60 punti del dominio. Una funzione monotona non può avere
> un punto in cui "peggio" vale di più.

### 3. "sul trimestre" era il mese
Il campo `margin_debt.qoq` contiene la variazione **mensile** — e il commento della pipeline lo
dichiara testualmente. In v320 l'ho stampata come "sul trimestre" e ci ho fondato il verdetto
"leva in ritiro". Il trimestre vero, ricalcolato dallo storico, è **+8,7%: segno opposto**.
> **Il commento diceva la verità e non l'ho letto.** E il gate cercava la stringa "sul trimestre"
> — confermava l'etichetta, non l'orizzonte. Ora i tre orizzonti hanno ciascuno il proprio nome,
> il trimestre si calcola dallo storico, e il gate verifica che i due numeri siano DIVERSI e che
> il trimestre coincida col ricalcolo. **Un'etichetta si controlla contro il calcolo, non contro
> sé stessa.**

### La lezione comune
Tutte e tre le volte la correzione era giusta nella direzione e sbagliata nel dettaglio, e tutte
e tre le volte **il mio test confermava la mia stessa assunzione** invece di misurare la proprietà.
> Quando correggi un difetto di misura, il check non deve verificare il numero che ti aspetti:
> deve verificare una **proprietà che il difetto viola per costruzione** — monotonia, invarianza
> di scala, coerenza fra due lingue. I valori attesi si possono sbagliare insieme al codice.


## 🧾 v387 — un comando resta indietro in silenzio, ed è così che smette di servire

Il CEO ha chiesto di aggiungere a `/aggiorna` "altro che il sistema offre e tu non fornisci
ancora". L'inventario ha dato la risposta e non era gradevole: **il comando citava 5 script su
22**. `backtest_signals.mjs`, `backtest_diary.mjs` ed `emit_macro_pack.mjs` esistevano, giravano,
e nessuno li eseguiva mai — fra questi il **quadro macro della dashboard** (rotazione sui 21 ETF,
struttura delle medie, mercati di previsione), cioè proprio quello che il CEO aveva chiesto due
messaggi prima.

> **Un comando non si rompe: resta indietro.** Nessun test falliva, nessun errore compariva, e la
> differenza fra ciò che il sistema sa e ciò che il comando consegna cresceva da sola.

Ora un gate verifica l'invariante nei DUE versi: ogni script del repo è **o eseguito da
`/aggiorna` o dichiarato fuori con la sua ragione**, e nessuno script citato è un fantasma.
Validato per iniezione tre volte (uno strumento nuovo non censito, uno script citato e
inesistente, `update_data.py` rimesso fra i passi): morde tutte e tre.

⚠ **Il divieto del CEO è ora strutturale, non una buona intenzione**: niente aggiornamenti
automatici, niente trigger, niente `update_data.py`, `notify_alerts.py` o `log_verdict.mjs` —
questi tre scrivono (dati, Issue, `data.json`). Il gate verifica che compaiano **solo** nella
sezione dei divieti. `test_update_data.py` resta invece fra i passi: è l'unico modo di sapere
OGGI che la pipeline di domani è rotta, invece di scoprirlo dall'età il giorno dopo (v369).

### Il muro di yfinance seppelliva l'unica riga che contava
`rapporto.py` dichiarava correttamente il ripiego sui valori pubblicati — in fondo a **~200
righe** che yfinance scrive su stderr, e quelle righe dicono `possibly delisted` di tredici
società vive. È la classe **v315** (una dichiarazione che c'è e non si trova non è una
dichiarazione) applicata all'output di un comando.

Ora le proteste si **raccolgono e si riassumono per CAUSA**: 200 righe → 7, stdout **identico al
byte**, e si legge *"40 messaggi: il proxy di rete rifiuta la connessione a Yahoo (CONNECT 403)"*
seguito da *"40 messaggi: nessuna barra restituita (conseguenza del blocco, non un delisting)"*.
Non è un silenziatore: la regola "i fallback devono essere RUMOROSI" viene **rafforzata**, perché
la nostra riga sale in cima e porta la causa invece di stare sotto il muro.

⚠⚠ **E il check è andato rosso avendo ragione.** `scripts/update_data.py:41` alza lo stesso
logger a `CRITICAL` quando viene importato: la mia cattura funzionava solo perché `rapporto.py`
non importa la pipeline — **per l'ordine degli import, non per costruzione**. Ora
`zittisci_yfinance()` imposta il livello da sé e il check **riproduce apposta la condizione
ostile** invece di aggirarla.
> Quando due moduli configurano lo stesso logger globale, chi importa prima decide cosa l'altro
> riesce a vedere. Un test che gira su un solo ordine di import non lo scopre mai.

**E poi è stato fatto** (stessa sessione): quel `setLevel(CRITICAL)` faceva sì che la
**pipeline** buttasse via le proteste di Yahoo **senza contarle**. Quando il CI veniva bloccato,
`update_data.py` non lasciava traccia del perché — un run degradato che si presenta come riuscito,
la stessa classe della seduta persa (v383/v384). Ora la pipeline usa la stessa raccolta e stampa
il riassunto **in fondo al run**, dove il log del CI lo mostra, **anche quando il run riesce**:
un run che scrive `data.json` dopo 200 rifiuti di Yahoo è riuscito a metà.

⚠ Il cambiamento è di sola diagnostica: non tocca il flusso, e la trappola v203 ("logica provata,
fetch mai provata") non si applica perché ciò che si prova qui è il **logging**, non la fetch — il
check emette sul logger vero e guarda dove finisce il messaggio. Ciò che resta non osservabile da
qui è il run in CI, e infatti non se ne afferma nulla.

⚠⚠ **La raccolta vive in `scripts/rumore_yf.py`, e una copia sola.** Serve al rapporto E alla
pipeline: duplicarla sarebbe stata la classe v161/v207 al primo ritocco. Un check in ENTRAMBE le
suite verifica che nessuno dei due la reimplementi in casa — validato iniettando la copia, e
morde in tutte e due.

⚠ **La ricevuta del taglio ha morso mentre spostavo la raccolta fuori da `rapporto.py`**: la
prima stesura contava solo `^class|^def` a colonna zero e falliva sui metodi annidati. Riscritta
per contare **tutte** le dichiarazioni di primo livello, che è la lezione v238-v239 — la pagina
è andata morta in produzione proprio perché un `assert` contava le `function` e a essere portato
via era stato un `let`.

### I grafici raccolti non dicevano come si chiamano
Cinque riquadri, 23 grafici e 3 tabelle, e **nessuna intestazione**: il CEO non poteva sapere
quale fosse quale. Il titolo però esisteva già — è l'`<h2>` che in `index.html` precede ciascun
elemento — quindi si **ricava dal markup**, non da una mappa selettore→titolo scritta dentro
`grafici.mjs`: quella invecchierebbe da sola al primo rinomino (C10, red team I6,
`MACRO_CARD_BY_PANEL` che copriva 7 pannelli su 37). Il check lo prova **rinominando davvero**
una sezione in `index.html` e verificando che la pagina la segua; iniettando la mappa a mano,
morde.

⚠ **La trappola dell'ancoraggio aperto, ripetuta appena scritta**: il check "update_data.py solo
fra i divieti" andava rosso perché `test_update_data.py` **contiene** `update_data.py` come
sottostringa. È già scritta due volte in questo file (`mg-card` che matcha `mg-card-head`,
`sc-fonte` che matcha `sc-fonte-qualsiasi`) e l'ho rifatta lo stesso. L'ancoraggio va chiuso.

### L'unica forma di previsione che questo sistema ammette
`/aggiorna` esegue ora i due backtest e ne riporta l'esito **anche quando è scomodo** — e oggi lo
è: due detector su quattro hanno il **segno opposto** a quello che dichiarano (RS debole e RS
molto debole sovraperformano invece di sottoperformare), e le operazioni annotate nel diario sono
a valore positivo su **2 su 8**. Non è una profezia: è il curriculum misurato di chi la
pronuncerebbe. **Un track record negativo taciuto è la peggiore forma di ancoraggio**, perché
lascia intatta la fiducia togliendo le prove che la sosterrebbero.
## 📰 v389 — LE NEWS ERANO MORTE DALLA NASCITA, E NESSUNO POTEVA ACCORGERSENE

`import html` **non c'era** in `scripts/update_data.py`. Tutte e tre le fonti RSS morivano con
`NameError: name 'html' is not defined` dentro il loro `try/except` per-fonte, `macro["news"]`
non veniva **mai** scritto, e il blocco del pacchetto che pubblica i titoli — condizionato
all'esistenza di quella chiave — **spariva in silenzio**.

Il CI lo stampava a **ogni run**, tre righe identiche, dal giorno in cui la funzionalità è nata
(v304). Nessuno le leggeva, perché la pipeline **usciva 0**: un `except` per-fonte trasforma un
import mancante in un avviso su `stderr`, e un avviso su stderr in un job verde è invisibile.

> **Un `try/except` per-fonte non protegge la funzionalità: la spegne in silenzio.** E i dodici
> check di `validate_macro` guardavano tutti altrove — dodici sorveglianti e una fonte scoperta.

Tre correzioni, e la terza è quella che conta:
1. l'import (una riga);
2. la finestra passa da 6 a **8 ore**, come chiesto dal CEO;
3. **il ramo `else` che non esisteva**: senza `macro.news` il pacchetto non nominava affatto le
   notizie. *"Nessuna riga sull'argomento" e "nessuna notizia" sono due cose diverse, e l'LLM non
   può distinguerle.* Ora dichiara il buco e lo chiama **dato MANCANTE, non dato negativo**.
4. `news_macro` entra in `validate_macro` → alert → warning nel CI. ⚠ La soglia è a **48 ore**,
   non alle 8 della finestra: zero notizie in 8 ore di domenica è un fatto sul mondo, zero in due
   giorni è quasi sempre la fonte. Provato su quattro scenari (feed caduto, vivo, fermo da 5
   giorni, date illeggibili).

**Fuori finestra non si tace, si dichiara l'età.** La v306 rispondeva "NESSUNA" e si teneva in
tasca una dichiarazione del presidente della Fed sull'inflazione di 17 ore. La finestra serve a
**pesare** una notizia, non a nasconderla.

## 📊 v389 — LA DIAGONALE È USCITA: la quarta forma respinta, e stavolta si sapeva già

Il CEO: *"Peso contro contributo al rischio — sopra la diagonale la posizione porta più varianza
del suo peso · cambia grafico così non lo capisco"*. Per leggere quello scatter bisognava sapere
che i due assi hanno la stessa unità, che la bisettrice è il luogo peso==rischio, e che la
distanza da quella retta è il messaggio: **tre nozioni prima di poter guardare**.

Barra → quadrante → ragnatela → **scatter con diagonale**. La regola era già scritta in questo
file e l'ho pagata lo stesso: *un grafico che va spiegato non è un grafico leggibile*.

La forma nuova non è uno scatter rifinito: la grandezza disegnata **è già la differenza**
(`rischio% − peso%`), in punti percentuali, in barre che divergono da zero — la stessa famiglia
della rotazione settoriale, che il CEO legge senza istruzioni. Non c'è niente da decodificare
perché **il numero È la risposta**.

⚠ E il taglio ha **dichiarato un denominatore che prima spariva**: SKHY non ha abbastanza sedute
in comune, quindi il suo peso non è dentro quei 100%. Prima veniva escluso in silenzio.
⚠ Il gate nuovo ha trovato **8 righe di CSS morto** (`.mappa-rischio`) che avevo lasciato dietro.

## 🏦 v389 — LA DISCIPLINA DI RISCHIO: nove regole, e ognuna dichiara di essere una convenzione

Richiesta del CEO: *"ampia sezione in chiusura di risk management con regole di hedge fund privato
growth"*. Vive in `disciplinaRischio()`, **una funzione sola** che alimenta sia la sezione di
pagina sia il blocco del pacchetto: due implementazioni della stessa domanda divergono, ed è già
costato tre volte (v161, v207, v316).

> ⚠⚠ **OGNI SOGLIA È UN'AFFERMAZIONE, NON UN DATO.** Nel file non esiste nessun limite di
> concentrazione, nessun tetto di drawdown, nessuna soglia di liquidità. È la lezione v240 — le
> tacche inventate su un asse — applicata a un intero framework. Ogni riga separa in modo
> esplicito la **MISURA** (dal libro), la **SOGLIA** (dal mestiere, con la provenienza scritta) e
> lo **STATO** (solo il confronto fra le due).

⚠ **"OLTRE" non vuol dire "sbagliato"**, e il pacchetto lo dice dove pubblica lo stato: un fondo
growth concentrato sta fuori da quasi tutte queste soglie **per costruzione**. Senza quella riga
l'LLM scrive l'analisi facile — "il libro è troppo concentrato, riduci" — che è un ordine
costruito su tre dati che il sistema non ha.

**La regola che NON morde vale quanto le altre.** La liquidità di uscita: la posizione meno
liquida si chiude in meno di un decimo di seduta. Dirlo — e dire che è stata *misurata*, non
assunta — vale più che applicare a forza una disciplina che qui non vincola.

⚠ **Un'autonomia di "1022,6 mesi" è aritmeticamente giusta e comunicativamente falsa**: oltre i
cinque anni il numero non porta più informazione e fa dubitare di tutto il blocco.

### Il gate di coerenza ha avuto ragione due volte, e la seconda era architetturale
C9 ha trovato **6 imperativi** che avevo scritto nella coda. Quattro erano prosa da riscrivere.
Il quinto era il **divieto di dimensionare**, ed è il caso interessante: è un *ordine*, e gli
ordini vivono nella testata — ripeterlo nel payload è la duplicazione testata/coda già pagata in
v156, v179, v180. Nella coda resta il **fatto** che rende sensato il divieto: i tre dati che il
sistema non ha. E il mio check che *pretendeva* il divieto nella coda è stato riagganciato: un
check che chiede un'istruzione nel payload mette in conflitto due gate e vince quello scritto per
ultimo.

## 🧪 v389 — TRE GATE RIAGGANCIATI, E UNO AVEVA UN BUCO CHE NON SAPEVO

- **`/analista macro/`** — nona volta che un check ancorato a una **stringa letterale** si rompe
  su una riformulazione senza che manchi niente. Riagganciato a tre proprietà.
- **La tesi contraria "ultima"** — il check scorreva fino in fondo al pacchetto, quindi qualunque
  riga di *dati* che cominci con `N) ` lo faceva fallire. I blocchi da consegnare vivono nelle
  **istruzioni**: cercarli nel payload è misurare la regione sbagliata.
- ⚠⚠ **E lì ho trovato un buco vero**: la classe `\d` copriva **una cifra sola**, quindi un
  decimo blocco (`10) `) non faceva scattare il gate. L'ho scoperto perché la mia prima iniezione
  usava proprio `10)` ed era **verde per una ragione che non c'entrava col difetto**.
  > **L'iniezione va scelta fra i casi che il gate DEVE prendere, non fra quelli comodi.** Una
  > validazione che passa per il motivo sbagliato certifica una protezione che non esiste.
- **E un gate trovava una chiamata COMMENTATA**: iniettando `// renderDisciplinaRischio();`
  restava verde mentre la sezione non veniva più disegnata. La scansione deve togliere i commenti
  (v213, v240) — terza incarnazione della stessa trappola.

⚠ Ripetuta anche la svista dei **backtick dentro un template literal**: `modifica_sicura` ha
rifiutato la scrittura e il file è rimasto intatto. Lo strumento ha fatto esattamente il lavoro
per cui esiste.

## 📦 v389 — IL PACCHETTO MACRO NEGAVA DI AVERE IL LIBRO

La testata diceva testualmente *"Non hai davanti nessun portafoglio"*. Era vero nella v256, quando
le posizioni non esistevano nel sistema; è diventato **falso nella v307** e nessuno ha riallineato
il testo per ottantadue versioni.

> **Un pacchetto che dichiara di non avere una cosa che ha è peggio di uno che tace**: manda l'LLM
> a rifiutare *esplicitamente* il collegamento fra macro e libro, che è l'unico collegamento per
> cui quel pacchetto viene letto.

Ora entrambi i percorsi portano il libro. E il blocco del libro pubblica **tecnica e fondamentali
di ogni posizione**, non solo peso e guadagno: senza medie, RSI, distanza dal massimo e forza
relativa, l'unica misura disponibile sulle altre dodici posizioni era il **guadagno dal carico**,
cioè la misura che fa tenere i perdenti e vendere i vincitori.

⚠ **Un multiplo prospettico negativo non è un multiplo basso**: `-75,7×` si legge come "costa
pochissimo". RGTI e CRWV ora dichiarano *utile atteso NEGATIVO*.
⚠ E `signTxt` aggiunge già `%`: la forza relativa usciva `+5,2% pp`, due unità sulla stessa cifra.

## 🔬 v389 — IL COLLAUDO DEI DATI, CHIESTO A CHI LEGGE

Il CEO ha chiesto che congruità, affidabilità e **freschezza** siano verificate dall'LLM. Non è
diffidenza verso il sistema: è che il pacchetto contiene dati **da uno a centoquaranta giorni** e
usarli come se fossero tutti di oggi è il modo più comune di produrre un'analisi sbagliata con
numeri giusti. Le tre verifiche hanno **protocolli diversi per classe di dato**, e l'esito va
scritto in tre righe — *un collaudo che non lascia traccia non è distinguibile da un collaudo non
fatto*.

⚠⚠ **E DEVE STARE ANCHE NEL FALLBACK.** Precedente diretto in v331: `loadPromptHeaderCloud()` può
fallire in silenzio, e allora vale `DEFAULT_PROMPT_HEADER`. *Un obbligo che dipende da una fetch
non gestita non è un obbligo, è una speranza.* Il check l'ha preso subito.

## ♻️ v389 — LA STESSA MISURA IN DUE BLOCCHI: dichiararla, non tagliarla

Il libro e la disciplina pubblicano gli stessi numeri (peso del primo nome, gruppo correlato,
scommesse effettive, drawdown): là sono il **fatto**, qui sono il **confronto con una soglia**.
Tagliare avrebbe reso illeggibili le righe della disciplina, che senza la misura accanto alla
soglia non dicono nulla.

Si applica invece la regola che il pacchetto usa già per CPI/PCE e per il disaccoppiamento contro
i profitti reali: **dichiarare che è lo stesso segnale**. Senza quella riga un lettore conclude
che il libro è concentrato "per sei misure indipendenti", mentre sono le stesse guardate due volte.

## 🎨 v389 — `--amber` era usato e mai definito

`.diary-multi` rendeva **grigia** invece che ambra, per il fallback `var(--amber, var(--muted))`.
Stessa classe delle cinque variabili della v206, rimasta aperta su un alias. Il giallo di avviso
del progetto è già `--yellow`: l'alias ci punta, non introduce un secondo tono.

## 🏛️ v390 — TRE FONTI NUOVE, E OGNUNA NASCE SORVEGLIATA

La lezione della v389 è costata la vita intera di una funzionalità: **una fonte che nessun check
guarda può morire il giorno in cui nasce**. Le tre nuove entrano nel gate di qualità *insieme* al
codice che le scarica, non dopo il primo guasto.

### SEC EDGAR — la data della trimestrale smette di essere solo una stima
La regola più operativa della disciplina di rischio — *quanta parte del libro riprezza nella
stessa finestra di tre settimane* — poggiava interamente su `earnings_date` di yfinance, che il
pacchetto stesso dichiara una STIMA. **Una regola costruita su date stimate si sposta da sola.**

L'8-K con **item 2.02** ("Results of Operations") è il deposito con cui la società comunica i
risultati, e ha una data vera. Gratis, senza chiave. Ora ci sono **due derivazioni indipendenti**
della prossima uscita — la stima di yfinance e la cadenza dei depositi veri — e dove esistono
entrambe si prende **la più vicina**: una finestra di eventi si sottostima allontanando le date,
mai avvicinandole. Dove divergono di più di una settimana, il pacchetto lo scrive.

Misurato sul libro: **MRVL non aveva alcuna data** e EDGAR la fornisce; su GOOGL e NVDA le due
derivazioni divergono di 8 giorni, e la finestra di rischio d'evento passa da 70,9% a 64,9%
proprio perché una data si è spostata.

> ⚠⚠ **LA CADENZA SI PUBBLICA SOLO SE È PLAUSIBILMENTE TRIMESTRALE (80-100 giorni).** Misurato su
> MSTR: deposita 8-K/2.02 anche **fuori** dal ciclo (2025-10-06, 2025-07-07), la mediana crolla a
> 67 giorni e l'attesa che ne uscirebbe sbaglia di **24 giorni**. Fuori banda si pubblica il
> deposito e si tace sull'attesa — *un numero che sembra una misura e non lo è è peggio di nessun
> numero* (v199).

⚠ **Gli emittenti esteri non hanno l'8-K**: SK hynix e TSMC depositano 6-K e 20-F. Per loro EDGAR
non risponde alla domanda, e va **dichiarato**: "nessuna data da EDGAR" e "nessuna trimestrale" si
leggono uguali e sono cose diverse.

### SLOOS e NFCI — chi presta, non solo quanto costa
Il canale credito è quello che colpisce **prima** le partecipate che non si autofinanziano, e il
sistema lo misurava con il solo spread high yield. **Uno spread è un PREZZO**: dice quanto il
mercato chiede per prestare, non se le banche stiano prestando. Sono due domande diverse che
possono rispondere in tempi diversi, e il pacchetto dichiara che **non sono una seconda conferma
dello stesso segnale** ma l'altro lato del canale.

> ⚠ **IL SEGNO DI SLOOS NON È INTUITIVO e va scritto ogni volta**: un valore NEGATIVO significa
> che le banche stanno ALLENTANDO, cioè è la lettura favorevole. Pubblicare "-8,3" senza dirlo è
> la classe del percentile invertito (v316), dove la lettura si ribaltava in silenzio.

### BCE — il quadro macro era interamente americano
Il CEO tiene un BTP da 40.000 euro nominali e vive in euro: il costo del denaro della sua valuta
non era nel sistema. ⚠ È il tasso di **politica monetaria**, non il rendimento del BTP e non un
secondo dato sui tassi americani — serve a leggere il differenziale con la Fed, che è il motore
del cambio con cui ogni utile in dollari torna a casa.

## 🕳️ v390 — UN RAMO CHE NESSUN GATE AVEVA MAI PERCORSO

Aggiungendo il check sulle news, `data_quality` ha prodotto **il primo alert della storia del
file**. E con quell'alert è comparso un blocco del payload che nessuno aveva mai visto: diceva
*"PRIMO ORDINE OPERATIVO: usa OBBLIGATORIAMENTE la ricerca web…"* — cioè **istruzioni nella coda**,
la violazione C9 che questo progetto ha già pagato tre volte. Il gate di coerenza non l'aveva mai
trovata perché gira sul payload di un `data.json` **senza allarmi**.

> **Un difetto in un ramo raro non è raro, è solo invisibile** (v190), e qui il ramo era
> irraggiungibile *per i dati*, non per l'orologio.

E i due blocchi erano anche **duplicati fra loro**: pubblicavano la stessa lista di chiavi
mancanti con due formulazioni diverse. Ora la lista è una, e c'è un check che percorre il ramo
degli allarmi apposta.

## ⚰️ v390 — `log_verdict.mjs` FALLIVA A OGNI RUN DA v200, DIETRO UN `continue-on-error`

Chiamava `decisionVerdict()` e `marketLinkText()`, rimosse col motore predittivo — tolto **sui
numeri**: hit-rate 29%, sette punti peggio del Nasdaq. Da allora il passo del CI moriva a ogni
esecuzione con `decisionVerdict is not defined`, e `continue-on-error: true` rendeva quel
fallimento invisibile: **un job verde con un passo morto dentro**.

> **Un errore coperto da una rete di sicurezza sopravvive quanto la rete.** È la stessa classe
> dell'`import html` mancante, dove a coprire era un `try/except` per-fonte.

Il campo che produceva (`verdict_track`) **non lo legge nessuno** — verificato con grep su tutto
il repository. Il passo è stato ritirato; lo script resta dormiente con la sua lapide in testa.

⚠ **`config/verdict_history.jsonl` NON è stato toccato**: 30 giorni di storia vera, che
`backtest_diary.mjs` legge per affiancare a ogni operazione del CEO ciò che il sistema diceva quel
giorno. Cancellarlo distruggerebbe delle prove — ed è la ricevuta del taglio scritta *prima*.

## 📊 v391 — QUINTA FORMA, E IL RAPPORTO RISCHIO/RENDIMENTO OVUNQUE

Barra 0-100 → quadrante → ragnatela → scatter con diagonale → barre divergenti → **due barre
affiancate**. Il CEO ha chiesto di cambiare ancora, e questa è l'unica famiglia che il progetto
ha già misurato come leggibile senza istruzioni (v333): *due barre affiancate non chiedono di
decodificare una scala — si vede quale è più lunga, e quella È la risposta*.

⚠ Il CSS delle barre gemelle (`.cbars`, `.f-peso`, `.f-mcr`) era **rimasto orfano** da quando
entrò lo scatter: la forma buona era già in casa, dismessa.

⚠ Il **rapporto rischio/rendimento** sta in fondo a ogni riga e NON è un terzo asse: misura
un'altra cosa, e disegnarlo accanto a peso e rischio suggerirebbe che siano commensurabili.

## 🔄 v391 — IL GRAFICO SEGUIVA IL PORTAFOGLIO SOLO A METÀ

`salvaPosizioni()` scriveva su GitHub e diceva *"si aggiornano al prossimo giro della
pipeline"*: per due-quattro ore la sezione del rischio mostrava il portafoglio **vecchio**
mentre il CEO ne guardava uno nuovo.

Ora i pesi si ricalcolano subito. Ma il pezzo che conta è quello che **non** si può ricalcolare:

> ⚠⚠ Il **contributo al rischio** richiede la matrice di covarianza sulle serie complete.
> Ricalcolarlo dalle `sparks` darebbe un numero **plausibile e divergente** da quello pubblicato
> (v316). Meglio un dato dichiarato in ritardo che uno inventato in tempo.

Quindi dopo una modifica le due barre descrivono due libri leggermente diversi, e la sezione **lo
dichiara** invece di lasciarlo dedurre.

⚠⚠ **E LA FRASE IN CIMA NON PUÒ POGGIARE SU UNA RIGA MEZZA VECCHIA.** Misurato: portando MU da
70 a 20 quote, il peso scende dal 23% al 6,9% mentre il rischio resta il 34% della pipeline, e
la frase annunciava *"+27,1 pp di rischio in più di quanto il suo peso lasci pensare"* — un
numero che non misura niente, **nella riga più letta della sezione**. La nota sotto lo
dichiarava, ma la nota non è la frase che si legge. Ora gli estremi si scelgono fra le righe
coerenti, e se non ne restano abbastanza la frase dice che non c'è niente da dire.

## 📐 v391 — IL R/R NON ESISTEVA SU UN TITOLO NUOVO, E MESCOLAVA DUE FONTI SU UNO SEGUITO

L'**intero blocco tecnico** era condizionato alla riga della pipeline: per un titolo non seguito
spariva tutto, rapporto rischio/rendimento compreso — ed è proprio ciò che il CEO chiede di
vedere quando analizza un'azione nuova. E su un titolo seguito era peggio che assente:
resistenza e supporto venivano **dal vivo**, prezzo e ATR **dallo snapshot** — due basi dentro
lo stesso rapporto (classe v230).

Ora `daVivo` decide per tutti e tre gli ingressi, e l'ATR si calcola dalle barre vive.

> ⚠⚠ **NON si usano `hi`, `lo` e `chiusure`**: sono filtrati **indipendentemente** con `ok()`,
> quindi una barra a cui manca il solo minimo accorcia `lo` e disallinea tutti gli indici — il
> massimo di martedì finirebbe accanto al minimo di mercoledì. Misurato: 120 contro 119. È
> l'allineamento per POSIZIONE invece che per data, la classe della v207. Si costruiscono terne
> allineate e si scartano le barre incomplete.

⚠ Si pubblica **solo ciò che le barre vive sostengono**: RSI, medie, forza relativa e
fondamentali restano assenti su un titolo nuovo. Ricostruirli da 260 barre darebbe numeri che
sembrano giusti e non lo sono (v316).

## 🧪 v391 — TRE GATE MIEI ANCORATI ALLA FORMA, E UN'INIEZIONE CHE NON MORDEVA

Le guardie della v389 pretendevano `barreOrdinate(pt.map` e una frase letterale: alla forma
successiva sono fallite **su codice corretto** (decima e undicesima volta). Riagganciate al
fatto: che lo scatter non torni, e che le posizioni escluse siano nominate — quest'ultima ora
legge **l'HTML davvero prodotto**, non il sorgente.

⚠⚠ E un'iniezione **non mordeva**: togliendo la chiamata da `salvaPosizioni` tutti i check
restavano verdi, perché la invocavano *direttamente*. Il grafico sarebbe tornato a restare
indietro — cioè il difetto segnalato dal CEO — con la suite verde. Aggiunto il check sul
collegamento, che toglie i commenti prima di leggere.

⚠ Un errore di render dentro `applicaPosizioniInLocale` risaliva fino al `catch` di
`salvaPosizioni`, che avrebbe annunciato *"non sono riuscito a scrivere su GitHub"* su un
salvataggio **riuscito**. Un messaggio che descrive il fallimento sbagliato manda a rifare
un'operazione già fatta.

## 📅 v392 — DUE FALSE CORREZIONI SU TRE, E VENIVANO DALLA STESSA RIGA

Il CEO ha incollato il referto di un LLM reale sul pacchetto v375. Quel modello dichiarava **tre
correzioni al sistema**: due erano **false**, e nascevano tutte e due dalla stessa forma.

1. **PIL.** Leggeva `riferito a 01/04/2026` e annunciava: *"non è più un dato riferito al 1°
   aprile: il BEA ha pubblicato la seconda stima del Q2 2026"*. Ma 01/04/2026 **è** il Q2 2026 —
   è la convenzione FRED/BEA per cui una serie trimestrale porta la data del **primo giorno del
   trimestre**. Ha corretto una cosa giusta, e ci ha speso una ricerca web.
2. **Fondi monetari.** Leggeva `rilevazione 2026-07-01 — 61 giorni fa` e obiettava che *"il dato
   è stato pubblicato il 25 agosto, quindi l'età dichiarata è sbagliata"*. Confondeva il
   **periodo descritto** con la **data di pubblicazione** — che il pacchetto riporta già,
   separatamente, in un altro campo.

> **Un dato mensile o trimestrale non descrive un giorno: descrive un mese o un trimestre.**
> Scriverlo come "01/04/2026" è formalmente esatto e **comunicativamente falso** — invita a
> leggere una data puntuale dove c'è un periodo. È la famiglia del percentile scambiato per
> variazione (v316): la forma del numero suggerisce la grandezza sbagliata.

Ora il periodo si scrive per esteso: *"riferito al 2° trimestre 2026 (aprile-giugno)"*,
*"riferito a luglio 2026"*. Il giorno resta solo dove il giorno **è** il periodo (serie
giornaliere).

### ⚠⚠ E correggendo l'ambiguità ho introdotto due volte una falsità precisa

Vale più della correzione stessa, perché è la stessa classe che stavo chiudendo:

- **Prima stesura**: ho appeso all'età la parentesi *"N giorni fa dalla fine del periodo
  descritto, NON dalla pubblicazione"*. È **esattamente il contrario del vero**: `eta` conta i
  giorni dall'USCITA, ed è una scelta deliberata annotata in v343. Trovata solo andando a
  **leggere da dove `eta` è calcolata**, invece di assumerlo.
- **Seconda stesura**, sui fondi monetari: *"il periodo descritto è finito 61 giorni fa"*. Falso:
  quei 61 giorni partono dal **1° luglio**, cioè dall'INIZIO del mese. Luglio era finito da 30.

Il rimedio non è stato scrivere una didascalia migliore: è stato **togliere il numero**. Il nome
del mese si data da sé, e non ha un estremo da scegliere.

> **Un numero che ha bisogno di una didascalia per non essere frainteso vale meno della parola
> che lo rende inutile.**

⚠ Il gate v350 pretendeva `riferito a GG/MM/AAAA` — una FORMA — ed è fallito su codice **più
chiaro di prima** (dodicesima volta). Riagganciato all'invariante scritto nel suo stesso
commento: le due date devono essere nominate e distinguibili, non avere un formato preciso.
⚠ E il meta-gate dei backslash mi ha ripreso: `\d` dentro un template literal diventa `d`.

### Cosa il referto ha CONFERMATO, oltre a quello che ha sbagliato
Il modello ha dovuto cercarsi da solo la notizia macro dominante (il discorso del presidente
della Fed sull'inflazione) — cioè esattamente uno dei titoli che il feed riparato in v389
consegna già in coda. E ha sostituito le date stimate delle uscite con quelle confermate dalla
fonte: è il lavoro che la v390 fa con SEC EDGAR. Due conferme indipendenti che quelle due
correzioni servivano.

## 🧮 v393 — L'INFLAZIONE PUBBLICATA ERA UN 13 MESI CHIAMATO "a/a"

Il difetto più grave trovato in questa sessione, e stava nel numero che apre il quadro macro.

`yoy(series)` faceva `series[-1] / series[-13]`: conta **tredici POSIZIONI** indietro e dà per
scontato che siano dodici mesi. Lo sono solo se la serie non ha buchi — e **CPIAUCSL ha un buco a
ottobre 2025**, il mese che il BLS non ha pubblicato.

| | base usata | risultato |
|---|---|---|
| per POSIZIONE (il codice) | giugno 2025 | 332,813 / 321,435 = **3,54% → "CPI 3,5%"** |
| per DATA (l'anno su anno vero) | luglio 2025 | 332,813 / 322,169 = **3,30%** |

Non un punto solo: **nove punti consecutivi** dello storico, tutti gonfiati, da novembre 2025 in
poi. E `UNRATE` ha lo stesso buco (lì il valore è `diretta`, quindi non ne soffre — ma ne
soffrirebbe al primo calcolo di variazione).

> **È la classe v207 — l'allineamento per POSIZIONE invece che per data — già pagata sui grafici
> macro e di nuovo in v391 sulle barre OHLC filtrate indipendentemente. Qui stava nell'inflazione.**

⚠ **Un LLM reale l'ha intercettato dall'ESITO e non dalla causa**: obiettava «il BLS titola 3,4%,
voi 3,5%». Aveva ragione sul numero e non poteva vedere il perché.

**Seconda causa, indipendente dalla prima**: il BLS titola l'anno su anno *on an unadjusted basis*,
cioè sulla serie **grezza**. Noi usavamo la destagionalizzata. `CPIAUCNS` dà 3,36% → **3,4%**,
esattamente il numero pubblicato. Le due correzioni insieme: 3,5% → **3,4%**.

⚠ **Quando la base esatta manca non si tace e non si finge**: si prende la precedente più vicina e
si restituisce la **distanza vera**, così chi stampa può scrivere "su 13 mesi" invece di "a/a".
Far sparire l'inflazione per un mese sarebbe peggio del difetto. Nello **storico** invece il punto
non si disegna: un buco non è uno zero, e nemmeno un valore approssimato (v205).

## 📰 v393 — IL PACCHETTO CONTAVA LE NOTIZIE POST-CHIUSURA E POI LE NASCONDEVA

La v389 aveva chiuso il caso "zero dentro la finestra" e lasciato aperto quello opposto: con anche
UNA voce dentro le 8 ore, `mostra` conteneva solo quelle. Misurato sul run del 30/08: intestazione
**«3 pubblicate DOPO l'ultima chiusura USA»**, corpo con **una voce sola**.

Delle due taciute, una era *«Guggenheim Ties Weigh on Acrisure Debt, **Dragging High-Yield Credit
Markets**»* — su un pacchetto la cui riga sul credito dice "HY OAS 2,63%, rilassato, percentile 0".
**Il pacchetto teneva in tasca il titolo che contraddiceva la propria lettura del credito.**

> **Dichiarare un numero e non mostrarne gli elementi è peggio che tacere entrambi**: chi legge sa
> che esistono, non può vederli, e non ha modo di chiederli.

⚠ Correggendolo ho dichiarato una seconda `nonPrezzate` — un ARRAY con lo stesso nome di un
CONTEGGIO — dentro il ramo `else`. La riga di intestazione avrebbe interpolato degli oggetti. **Due
variabili omonime con tipi diversi sono la classe v161/v207 in versione locale**: ora l'elenco è
uno solo e il conteggio si ricava da lui.

## 🇺🇸 v393 — UMICH: LA RIGA AFFERMAVA TRE COSE E DUE ERANO FALSE

La pipeline legge UMich dalla **fonte primaria** (`sca.isr.umich.edu`) e ripiega su FRED solo se
quella cade. Ma `CADENZA_FONTE` descriveva **sempre** il ripiego:

- «rilevazione 01/08/2026 (29 giorni fa)» → il definitivo di agosto era uscito il **28**, due
  giorni prima. E per di più nella forma a GIORNO che v392 aveva tolto altrove — perché il ramo
  `stessoGiorno` di `rigaCadenza` **salta la resa a periodo**, ed è il buco della mia v392;
- «prossimo atteso 28/10/2026» → su una serie **mensile**, un mese di troppo (`mesiRitardo`
  mancante, come già per il Philly Fed);
- «questo valore non è l'ultimo pubblicato» → **l'esatto contrario del vero**.

> **Un pacchetto che diffama un proprio dato fresco è peggio di uno che lo tace**: manda chi legge
> a cercare online una cosa che ha già in mano, e a diffidare del resto.

`series_fallback` ora **registra chi ha servito**, l'indicatore lo porta, e la cadenza si sceglie
da lì. È la regola già applicata allo storico ("lo storico esce dalla stessa fonte del valore")
estesa all'etichetta e al calendario, che dalla fonte dipendono entrambi.

## 📊 v393 — I TRE GRAFICI DELLA DISCIPLINA DI RISCHIO

Richiesta del CEO: istogrammi e torte anche nella sezione di chiusura. **Nessuna primitiva nuova**:
si riusano `barreOrdinate` e `ciambella`, le due famiglie che il progetto ha già misurato come
leggibili senza istruzioni dopo cinque forme respinte.

1. **Scostamento dalle soglie** — risponde alla domanda che la sezione stessa dichiara essere la
   sua ("conta di QUANTO"), in punti percentuali;
2. **Torta del fattore** — due fette, e la grande È la risposta (73,7% si muove insieme);
3. **Calendario per mese** — l'unica regola con un asse temporale naturale.

⚠⚠ **NON TUTTE LE REGOLE SONO DISEGNABILI INSIEME.** `valore` cambia unità da riga a riga:
percentuali dell'azionario, un CONTEGGIO (2,3 scommesse), delle SEDUTE (liquidità), una percentuale
con **un altro denominatore** (il drawdown è sul valore nel tempo). Nel grafico entrano solo le
cinque che parlano la stessa lingua, e il renderer **dichiara quali sono rimaste fuori e perché**.
Le altre non prendono un riempitivo (v233).

⚠⚠ **E IL MIO PRIMO GATE ERA CIRCOLARE**: verificava che nel grafico ci fosse ciò che porta una
`sogliaPct` — vero per costruzione. Iniettando una soglia sul drawdown il grafico se lo prendeva e
**nessun check mordeva**. Ora ogni regola **dichiara la propria `unita`** e il filtro guarda quella:
mescolare due denominatori diventa una bugia visibile invece di un effetto collaterale.
> Quando un check non morde, la prima cosa da guardare non è il codice: è se la proprietà che
> stai verificando può essere falsa.

⚠ **Il grafico e la regola non danno lo stesso numero, e va DICHIARATO**: qui il raggruppamento è
il mese di calendario, lì la finestra mobile di tre settimane più densa, che può stare a cavallo di
due mesi. Affiancarli senza dirlo è "stessa grandezza con valori diversi".

### `obar-prime` mandava il valore a capo, e nessuno l'aveva mai visto
`.obar-prime` è `grid-column: 1 / -1`, cioè una riga intera: stando nel DOM **prima** di
`obar-val`, l'auto-placement spingeva il valore in colonna uno della riga dopo. Il parametro
`suggerimento` esisteva **dalla v302 e nessun chiamante lo passava**: la resa non era mai stata
vista. È la classe v193 — codice vivo che non può manifestarsi — e si trova **guardando la pagina**,
non rileggendo la funzione.

## 🧪 v393 — TRE ERRORI DI METODO, TUTTI PRESI DAI META-GATE

1. **`return true` anticipati** nel check delle notizie ("se lo snapshot non ha voci, passa"):
   **verde per assenza di dati**, la trappola già pagata quattro volte. Il meta-gate dei check
   dormienti l'ha presa subito. Ora le notizie si **iniettano**: il fenomeno c'è per costruzione.
2. **Un'iniezione che non mordeva perché il caso non esisteva nei dati**: il check sui mesi vuoti
   asseriva la contiguità, ma le trimestrali vere cadono in tre mesi consecutivi — comprimere o no
   dava lo stesso risultato. Ora il gate **crea il buco** che deve rilevare (v234).
3. **Quarta volta che un gate trova sé stesso**: il check "nessun accesso posizionale" falliva sul
   commento che *spiega* l'accesso posizionale rimosso. Ora esiste `_SRC_UD_CODICE`, senza commenti:
   **chi cerca l'ASSENZA di una costruzione guarda il codice, chi ne cerca la PRESENZA la prosa
   va bene**.

## 🔍 v393 — COSA HA TROVATO IL CONTROLLO DELLA PIPELINE, E COSA NO

Verificata leggendo il log del run vero di "Rigenera" (`workflow_dispatch`), non simulandolo.

**Funziona**: 17 fonti su 17 arrivano, `data_quality` le sorveglia tutte e 17 con **zero allarmi**,
audit 0 violazioni, 36→18 voci di news da 3 fonti, SEC EDGAR 13 titoli, SLOOS/NFCI/BCE presenti.

**Falsi allarmi da riconoscere a vista, per non riaprirli**:
- `storico indicatori: 11/13 con serie` — **è voluto**: `curve` e `t30` prendono la serie da
  `curve_history` e `tassi.storico.a30`, e duplicarla sarebbe la classe v295 (due copie della
  stessa serie che divergono). Il messaggio invita a una diagnosi sbagliata: è un conteggio, non
  un esito.
- `audit: 0 ptf / 24 wl` — le posizioni vivono in `config/posizioni.json`, non nell'array
  `portfolio` di `data.json`, che contiene solo il BTP.

**Buco vero e chiuso**: `!! tasso BoJ scartato: osservazione del 2023-12-01` — lo scarto è giusto
(mille giorni), ma la riga chiudeva con "rischio unwind se BoJ alza" **senza dire da quale
livello**. Un rischio senza la sua ancora. Ora il buco si dichiara.

## ✂️ v394 — IL NOME TRONCATO È IL MESSAGGIO PERSO

I tre grafici della v393 erano verdi su tutti i gate e **quattro etichette su cinque uscivano
tagliate a 1440px**: `Autofinanziamento delle partecipate` chiede 219px in una colonna da 132.
A 375px era tagliato anche il nome della fetta grande della torta, che è *la risposta* del
grafico. Nessun errore in console, nessun check rosso.

`.obar-lab` e `.ciam-nome` troncano con l'ellissi perché altrove vivono in colonne strette e
molto ripetute, dove troncare è giusto. Qui i nomi **sono le regole**: un grafico che dice *di
quanto* e non fa leggere *di che cosa* ha perso metà della propria risposta. È la famiglia di
`.abar-fill` senza `display:block` (v205) e del `</div>` orfano (v225) — **difetti che non si
rompono**, e si trovano solo misurando `scrollWidth` contro `clientWidth` in un browser vero.

⚠ **Si va a capo, non si allarga la colonna.** Una larghezza fissa nuova è la classe già pagata
due volte: v192 (chip da 298px → documento a 598 su uno schermo da 375) e v209 (96px sulla
colonna del valore → 44px di scorrimento orizzontale su tutta la pagina). Col ritorno a capo la
cella non scende comunque sotto la parola più lunga, che nella colonna esistente ci sta.

## 📅 v395 — LE USCITE MACRO NON SONO PIÙ STIME: IL CALENDARIO UFFICIALE

Il CEO ha proposto di far passare l'acquisizione dati da **investpy** o **investing-com-api-v2**.
Verificato invece che ricordato: investpy è fermo al **2 ottobre 2022** e il suo README dice che
non funziona; **investiny**, il sostituto che investpy stesso indica, è fermo al **18 ottobre
2022** — è morto sedici giorni dopo essere nato; il terzo dichiara *"This version is no longer
supported"* e userebbe Puppeteer. E i quattro ingressi di investing.com rispondono **403 in meno
di mezzo secondo** da un IP di datacenter, che è la condizione in cui gira il CI.

> **Convogliare tutto su una fonte sola è la forma sbagliata anche se funzionasse.** La pipeline
> attinge a **25 domini indipendenti**: quando Yahoo blocca, il resto arriva lo stesso.
> Investing.com è un sito dietro una policy Cloudflare: il giorno che la stringono non si degrada
> un canale, si spegne tutto insieme. È letteralmente ciò che è successo a investpy.

**La domanda utile non era "quale libreria" ma "cosa ci leggi che il sistema non ha".** Prezzi,
sommario tecnico (calcolato in casa dalla v316), notizie, date delle trimestrali (EDGAR, v390) e
target ci sono già. Il buco vero **il pacchetto lo confessava da solo**: *"IN USCITA NELLE
PROSSIME 2 SETTIMANE — TUTTE DATE STIMATE"*, proiettate dal ritardo tipico della fonte.

Ora `calendario_uscite_fred()` legge il calendario **ufficiale** da FRED — nessuna fonte nuova,
la chiave era già nei secret — e dove c'è una data dichiarata **quella vince**. Non sono due
derivazioni fra cui scegliere (v390, EDGAR contro yfinance): è un appuntamento dell'ente contro
una nostra congettura.

⚠⚠ **LE SERIE `PRIMARIA:` SONO SALTATE, e non è un dettaglio**: UMich lo leggiamo dalla fonte
primaria e FRED lo ridistribuisce con 1-2 mesi di ritardo di licenza. Pubblicare il calendario
FRED sotto quel dato sarebbe **esattamente il difetto della v393**, dove la riga UMich affermava
tre cose e due erano false perché descriveva il ripiego.

⚠ **Quando la data è confermata e futura, `scaduto`/`passata` sono falsi per costruzione** — un
appuntamento di domani non può essere in ritardo. L'allarme "era atteso e NON È ARRIVATO" non è
perso: vive in `validate_macro`, che confronta l'**età della rilevazione** con la cadenza attesa.
Farli convivere sulle stesse chiavi farebbe rispondere **due basi diverse alla stessa domanda**,
che qui è già costato tre volte (v161, v207, v230).

⚠ **Il segno si porta PER RIGA, non nell'intestazione**: dentro lo stesso elenco convivono una
macro confermata e una stimata. E `stimata: true` era **scritto a mano come costante** su ogni
evento, quindi restava vero anche con la data confermata: *un campo che non può essere smentito
dai fatti non è un'informazione.*

### Cosa si può provare da qui e cosa no — detto prima, non dopo
La **fetch** verso FRED vuole la chiave API, che vive nei secret di Actions: da qui non è
esercitabile, ed è la trappola **v203** che è costata la rimozione di due blocchi interi. Quindi
la logica si prova **tutta** con una `http_get` finta (raggruppamento per comunicato, scarto
delle date passate, salto delle serie non-FRED, rifiuto senza chiave) e la fetch vera si esercita
**nel run del CI**, leggendone il log e il `data.json` prodotto.

**E il test ha ripagato subito**: `STORICO_IND` ha righe da **quattro** campi e la funzione ne
spacchettava due — `ValueError` a ogni run, cioè il blocco sarebbe morto in CI. Trovato dalla
`http_get` finta, non rileggendo il codice.

### 🦴 Quattro gate FOSSILI si sono svegliati quando il fenomeno è arrivato nei dati
Il primo run col codice nuovo ha portato le date confermate, e **quattro check scritti quando
tutto era stimato sono andati rossi**. Nessuno è stato zittito; a tre è cambiato l'invariante e
uno era un difetto latente che non c'entrava col calendario:

- **v287** pretendeva che *ogni* evento fosse marcato stimato. Ora l'invariante è **più forte**:
  ogni evento dichiara la provenienza con un booleano vero — mai `undefined`, che si leggerebbe
  come "non stimato" — e "confermato" è vero **solo se il calendario ha davvero quella chiave**.
- **v343** misura l'aritmetica della **proiezione**, che per molte chiavi non viene più usata:
  confrontava una data dichiarata dall'ente con una base costruita da una rilevazione fittizia.
  Ora toglie il calendario prima di misurare — è il ramo che sorveglia — e verifica accanto che
  le date confermate siano future.
- **v363** guardava una forma sola (`prossimo atteso`) e il suo pavimento di tre occorrenze ha
  smesso di essere raggiunto: **si è dichiarato muto, correttamente**. L'invariante non riguarda
  la parola ma la **pretesa**: nessuna riga annuncia come futura una data già passata, stima o
  appuntamento che sia. Ora copre entrambe le forme.
- ⚠⚠ **v349 non c'entrava col calendario**: provava che il VIX legge la propria serie
  confrontandola **per disuguaglianza di valore** con quella della curva, e il 02/09/2026 i due
  numeri sono venuti **uguali per caso** (0,3 e 0,3). È la classe già annotata in v233 — *un
  check che misura i dati del giorno invece della proprietà va rosso da solo*. Ora **perturba**
  la serie della curva: due serie possono coincidere per caso, non possono muoversi insieme.

> **Un gate che si sveglia quando il mondo cambia sta facendo il suo lavoro.** La domanda giusta
> davanti a un check rosso non è come farlo tacere ma quale invariante volesse davvero difendere.

⚠ E ho rifatto la trappola **numero uno** di questo file, scritta qui da versioni: un **backtick
dentro un template literal lo chiude**. Il commento che spiegava la correzione di v349 citava il
codice vecchio fra backtick e ha ucciso la suite — che infatti è morta **rumorosamente**, senza
stampare nulla, invece di passare a vuoto.

### 🛑 Il gate positivo era CIRCOLARE, e me l'ha detto quello negativo
Cercavo `[CONFERMATA]` dentro tutta la riga — ma **la legenda che spiega il marcatore lo contiene
per forza**. Quindi il check positivo era verde anche con **zero** date confermate, e quello
negativo rosso su codice giusto. **Quinta incarnazione del gate che trova sé stesso** (v213,
v240, v393): chi cerca la presenza o l'assenza di un marcatore deve guardare la **regione dei
dati**, non la prosa che lo definisce. Ora si legge il contatore che la riga stessa pubblica
("N su M confermati") e i marcatori si cercano solo dopo `dati macro (`.

⚠ E un'ottava iniezione **non mordeva**: il check chiedeva *"esiste un allarme?"* invece di
*"l'assenza produce l'allarme giusto?"*, così scattava il ramo `stale` dell'`else` e si
accontentava. Stretto sullo **stato** (`missing`), morde.

⚠ **Quindicesima rottura di un check ancorato a una stringa letterale**: il gate v363 pretendeva
`passata: p < oggi` alla lettera ed è andato rosso su codice più corretto. Ora **esercita** il
ramo invece di leggerlo.

⚠ E ho rifatto l'**ancoraggio aperto** già scritto tre volte in questo file: la guardia
`"calendario_uscite" not in s` matcha anche `calendario_uscite_fred`.

## 🔢 v400 — LA REVISIONE DICEVA CHE LA STIMA SALE MENTRE LA PERDITA SI AMPLIAVA

Trovato eseguendo il pacchetto CRWV su me stesso, come il modello che lo riceve. È il difetto
più grave di questa sessione, e stava nella riga che il pacchetto stesso dichiara **più
importante del target**.

`revisione_90g_pct` è un RAPPORTO: `(ora / prima − 1) × 100`. Su una società in perdita quel
rapporto **inverte il senso**. CRWV è passata da **−3,42 a −4,37**, cioè la perdita attesa si è
ampliata, e il pacchetto stampava **`+27,77%`** e poi, nella riga marcata ⚠⚠:

> *"TRAIETTORIA E AMPIEZZA DIVERGONO: la stima a 90 giorni **sale** ma negli ultimi 30
> prevalgono i TAGLI"*

**Due affermazioni, entrambe false.** La stima non sale: scende. E non c'è nessuna divergenza —
a 90 giorni le stime peggiorano e negli ultimi 30 prevalgono i tagli, cioè le due misure
**concordano**. Il pacchetto fabbricava un disaccordo dal proprio errore di segno, e poi
istruiva chi legge che *"il fatto è la divergenza"*.

> È la classe **v316** (il percentile che era una variazione) e **v389** (il multiplo
> prospettico negativo che si legge come basso): **la formula calcola una cosa, l'etichetta ne
> dichiara un'altra, e nessuna delle due mente da sola.**

⚠ La direzione ora si prende dalla **differenza**, che non ha segni da interpretare; la
percentuale resta solo dove non è ambigua. Su una perdita si scrive *"la perdita attesa si è
AMPLIATA del 27,8%"*. E la condizione della divergenza confronta i **versi**, non l'esistenza di
un dato: quando concordano lo dice, perché due misure che puntano nella stessa direzione sono un
fatto — ma **un segnale solo, non due prove**.

⚠ La pipeline pubblica ora anche `eps_7g_fa`: il FATTO accanto al rapporto. Finché il CI non ha
rigenerato, `app.js` lo ricava dal rapporto invece di far sparire la riga — ripiego della classe
v187, *togliere in silenzio una riga che il pacchetto pubblicava è peggio del difetto*.

## 🧾 v400 — IL BILANCIO VECCHIO NON DICHIARAVA DI ESSERLO, E LE CONCLUSIONI SÌ

La v397 ha dato alla **tabella dei trimestri** un avviso costruito sul deposito EDGAR. I due
blocchi che poggiano sullo **stesso trimestre** non l'hanno mai avuto — e sono esattamente i due
su cui si regge l'analisi di una società che costruisce a debito.

| il pacchetto pubblicava | il 10-Q depositato l'11/08 |
|---|---|
| cassa **2,2 mld** (al 31/03) | **5,524 mld** — 2,5 volte tanto |
| *"la cassa copre 1,6 mesi di investimenti"* | calcolata su quella cassa |
| *"la cassa è INFERIORE al debito in scadenza entro l'anno"* | non più vero con 5,5 mld |
| oneri finanziari 1,5 mld su 4 trimestri, copertura −0,07× | **640 mln nel solo Q2** |

**La data c'era. Le frasi DERIVATE da quella data no** — e sono quelle che si leggono. Ora
COMBUSTIONE DI CASSA e CREDITO portano lo stesso avviso della tabella dei trimestri, e dichiarano
che le conclusioni sull'autonomia **non sono affermabili** senza il deposito più recente.

⚠ **La domanda "la tabella è ferma?" ha ora UNA risposta sola** (`depositoOltreLaTabella`), usata
da tre blocchi. Riscriverla nei tre punti era la classe v161/v207, e un check verifica il
**collegamento**, non l'esistenza — lezione v399, dove togliendo la riga che agganciava la fonte
al gate restava tutto verde.

## 🧩 v400 — IL PACCHETTO PRESENTAVA COME MISTERO UNA COSA CHE SAPEVA

*"ricavi su dodici mesi 8 mld — NON QUADRA: i quattro trimestri sommano 6 mld. **Il residuo di 1
mld non è spiegato dai dati qui presenti**"* — e quaranta righe più sotto lo stesso pacchetto
dichiara, **dal deposito 8-K su SEC EDGAR**, che la tabella si ferma a un trimestre già superato.
Il residuo **È** quel trimestre.

> Mandare chi legge a cercare un difetto che non c'è costa quanto tacere un difetto che c'è. È la
> gerarchia della **v396 applicata alle diagnosi**: prima il fatto, la congettura solo se il
> fatto non c'è.

## 🕐 v400 — DUE OROLOGI, E LA RIGA NE AFFERMAVA UNO PER L'ALTRO

*"il book è vuoto: **succede a mercato chiuso**"* accanto a *"CONTESTO DI SESSIONE … fase:
REGULAR · SESSIONE USA APERTA"*. Non era una contraddizione — il book era vuoto allo **snapshot**,
che la pipeline prende su cron, mentre la fase di sessione è calcolata **adesso** — ma il
pacchetto non lo diceva, e il collaudo di congruità **impone a chi legge di segnalarla**. Un
pacchetto che genera falsi positivi nel proprio controllo di qualità lo logora.

Classe **v193/v234**: *stato del mercato e freschezza del dato sono due cose diverse*, qui dentro
la stessa riga.

### 🦴 Il pavimento delle suite era fermo a metà
Misurato: `test_app.mjs` contiene **452** chiamate a `check()` contro un pavimento di **185**;
`test_update_data.py` 161 contro 80; `test_analisi_libro.py` 97 contro 50. **Un pavimento a metà
non è un pavimento**: metà suite poteva sparire restando verde, che è precisamente il guasto per
cui il pavimento esiste (v277, la suite mangiata a metà da uno script). Alzati a 420/150/90 — con
margine, perché un pavimento incollato al conteggio di oggi va rosso al primo check tolto per una
ragione legittima.

⚠ **Diciannovesima rottura di un check ancorato a una stringa letterale**: v355 pretendeva
`NON CALCOLABILE ADESSO` ed è andato rosso su una riga **più corretta di prima**. Riagganciato al
fatto: il movimento implicito è dichiarato non calcolabile, si dice perché, e la ragione non
pretende di sapere se il mercato sia aperto adesso.

⚠ E il **meta-gate dei backslash** mi ha ripreso di nuovo: `\s` dentro un template literal
diventa `s`, quindi la regex del check nuovo non poteva funzionare. Sostituita con un `indexOf`,
che non ha niente da sfuggire.

## 📊 v400 — LA TABELLA CHIEDEVA UNA QUOTA SENZA CHIEDERE DI QUALE MERCATO

Dimostrato da un **referto reale** su questo stesso pacchetto: il modello ha incolonnato le quote
del **cloud generale** (AWS 44%, Azure 30%, GCP 19%) accanto a un **5%** del titolo analizzato,
che sta su un mercato di due ordini di grandezza più piccolo. Sommate fanno un mondo che non
esiste, e la riga del titolo sembra dieci volte più grande di quello che è.

Non è un errore del modello: è la **richiesta** che lo produce. La colonna si chiamava "Quota di
mercato" e nessuna riga chiedeva **quale** mercato. È la classe che `coherence_check` chiama
*denominatori non dichiarati* — sorvegliata dentro il payload da anni e **assente dalle
istruzioni che il payload stesso impartisce**.

⚠ Aggiunta anche la clausola sul costo: *"la capitalizzazione dei concorrenti serve a dare la
scala, non a decidere: se verificarla ti costa più di quanto renda, scrivi n.d."*. Ogni cella di
quella tabella è una ricerca web, e il budget di ricerca è finito quanto quello di parole.

⚠ **Ventesima rottura di un check ancorato a una stringa letterale**: v257 pretendeva
`quota di mercato` ed è andato rosso quando la colonna è diventata più precisa.

## 🔭 v401 — IL CANALE CHE IL SISTEMA DICHIARAVA SPENTO ERA QUELLO CHE MUOVEVA IL TITOLO

Su CRWV il pacchetto misurava i tassi con **TLT su 251 sedute: R² 0,00 → "nessuna relazione
misurabile"**. Nello stesso pacchetto, due righe più in là: ORCL **−5,4% il 01/09 per il selloff
obbligazionario**, e la stampa che chiama CoreWeave *"the most leveraged AI landlord"*.
**Due analisti su due — io e il modello del CEO — hanno dovuto scrivere che andavano CONTRO la
misura.** Quando succede, la finestra è sbagliata, non il lettore.

E la riga in fondo a quel blocco lo diceva **da versioni**: *"un canale può accendersi (una
società che si indebita diventa sensibile ai tassi in un trimestre)"*. Il commento descriveva il
fenomeno e **nessuna riga di codice lo cercava** — la classe v326, dove il commento della
pipeline diceva il vero e non l'avevo letto.

Ora ogni canale porta **due finestre**: quella lunga (~251 sedute) e quella corta (60, un
trimestre di borsa), e la transizione si chiama per nome — *IL CANALE SI È ACCESO* / *SI È
SPENTO*. La finestra corta non è un beta più vero: serve a vedere un cambio di regime.

### ⚠⚠ E LA SOGLIA NON POTEVA RESTARE UNA CONVENZIONE
Il sistema diceva "canale presente" sopra **R² 0,05**, scelto. Con una finestra sola era innocuo
perché prudente; con due diventa **falso in direzioni opposte**:

| campione | R² che il puro caso supera nel 5% dei campioni | lo 0,05 fisso |
|---|---|---|
| 251 sedute | **0,015** | prudente |
| 60 sedute | **0,065** | **permissivo: accenderebbe canali dal NULLA** |

Cioè la finestra corta, con la vecchia soglia, avrebbe **fabbricato proprio il segnale che deve
rilevare**. Ora `r2_rumore(n)` calcola il pavimento dal campione — `t²/(t²+df)`, con `t`
quantile 97,5% di Student — ed è verificato **contro i valori tabulati**, non contro sé stesso
(v326: un check che conferma la propria formula non è un check).

⚠ **Costruire il caso di prova ha insegnato un limite della modifica, e va scritto**: con 259
osservazioni il pavimento è 0,015, cioè bassissimo — una relazione recente e *forte* si vede
quasi sempre anche sull'anno. La finestra corta serve quando l'anno **diluisce**: titolo con
storia propria molto rumorosa che solo di recente passa a muoversi col canale. La prima stesura
del check costruiva un accoppiamento troppo forte e l'anno lo vedeva lo stesso: **il check era
rosso e aveva ragione.**

⚠ **HYG NON è stato aggiunto**, ed è una scelta motivata: è una serie di prezzo guidata in larga
parte dalla propensione al rischio azionaria, quindi il suo beta ri-esprimerebbe il canale QQQ —
lo stesso segnale scritto due volte, che questo progetto tratta come difetto. Il canale credito
c'è già nel quadro macro come **livello** (HY OAS, SLOOS, NFCI), che è la domanda giusta: non
"co-varia col credito" ma "la finestra di finanziamento è aperta".

⚠ **La fetch non è esercitabile da qui** (Yahoo risponde vuoto dall'ambiente di sviluppo): la
logica è provata su serie sintetiche costruite perché il fenomeno ci sia, i numeri veri arrivano
col run del CI. È la trappola v203, dichiarata prima invece che dopo.

## 🔗 v402 — IL BLOCCO CHE INCROCIA, CHIESTO DAL CEO

Istruzione: *"Voglio una presenza maggiore di analisi e di correlazioni tra portafoglio, dati
tecnici/fondamentali, dati macro e soprattutto ultime news … e questo deve essere presente anche
quando genero l'analisi di un solo titolo … l'LLM deve analizzare tutto ciò che c'è nel sistema e
indirizzarmi su come muovermi per il portafoglio, in ottica di ottimizzazione di un fondo growth
privato e analisi di risk management."*

⚠ **Il pacchetto aveva GIÀ tutti i pezzi** — macro, libro, tecnica, fondamentali, notizie sul
nome e sul gruppo correlato, disciplina di rischio — e li chiedeva **uno per uno in nove blocchi
separati**. Quello che mancava non erano dati: era la richiesta di **giungerli**. *Nove elenchi
accanto non fanno un'analisi*, e un modello che risponde per blocchi non incrocia mai di propria
iniziativa.

Il blocco 9 chiede quattro giunzioni, ognuna impossibile con una fonte sola:
**NOTIZIA → CANALE → LIBRO** (attraverso quale sensibilità misurata arriva, e quali posizioni del
gruppo colpisce — vale per il peso del GRUPPO) · **MACRO → CONTO ECONOMICO** (quale riga di questo
bilancio, non "i tassi sono alti") · **TECNICA ↔ FONDAMENTALE** (il caso che conta è il
disaccordo) · **E QUINDI, PER IL LIBRO** (priorità e livelli).

> ⚠⚠ **La regola che tiene il blocco onesto: ogni riga deve unire ALMENO DUE fonti.** Una riga che
> ne usa una sola è un blocco precedente riscritto — la duplicazione che questo progetto misura e
> taglia dalla v184. Senza quel vincolo un blocco "di sintesi" diventa il riassunto che la testata
> vieta.

⚠ **Il divieto di dimensionare è ripetuto DENTRO il blocco**, perché è quello in cui è più facile
scivolare: direzione e priorità sì, quantità mai. Un fondo growth privato non si ottimizza
riducendo il rischio — si ottimizza sapendo *quale* rischio sta correndo.

⚠ **Il tetto sale da 2.300 a 2.800 parole** perché è stata aggiunta una consegna. Un tetto fermo
mentre cresce il lavoro costringe a comprimere gli **ultimi** blocchi, che è dove un modello a
corto di spazio sostituisce le prove con affermazioni (misurato in v398). La clausola
anti-riempimento resta ed è la protezione vera.

### 🧪 Quattro inciampi di metodo, tutti già scritti in questo file
- **Ventunesima rottura di un check ancorato alla FORMA**: v316 pretendeva una riga per canale e
  la resa ora ne usa tre. Riagganciato all'invariante (*ogni beta viaggia col suo R², campione e
  finestra*) ed è diventato **più forte**: ora vale per entrambe le finestre.
- **Un taglio lasciato a metà**: sostituendo il corpo di quel check è rimasta la coda che citava
  `righe`, variabile non più esistente. `node --check` passa — è dentro un template — e l'ha preso
  il runtime, che ha marcato il check **MALFORMATO** invece di lasciarlo passare a vuoto.
- **Quinta incarnazione dell'ancoraggio aperto**: il gate nuovo cercava la sottostringa `giudizi`,
  che compare legittimamente altrove (`giudizio` nella tesi contraria). Chiuso su `\d+ giudizi`.
- **C9 ha preso un mio imperativo nella coda** (*"e leggerli come uno solo è l'errore facile"*) —
  quarta volta (v156, v179, v180, v389). Riscritto come fatto.

## 🕰️ v402 — L'ULTIMA CHIUSURA ERA NEL FUTURO, E IL CONTEGGIO ERA ZERO PER COSTRUZIONE

Trovato da **un check andato rosso da solo** quando il CI ha prodotto il primo run *a mercato
aperto*. `price_asof` diventa OGGI appena la barra odierna comincia, e `lastUsEquityCloseUTC()`
costruiva le **16:00 ET di quel giorno** — sei ore avanti. Conseguenza misurata il 02/09/2026
alle 13:31 ET, nel pacchetto vero:

> *"0 pubblicate DOPO l'ultima chiusura USA del **2026-09-02**"*

**Zero per costruzione**: niente può essere posteriore a un istante che non è arrivato. E uno
zero lì si legge come *"niente di non prezzato"*, cioè l'opposto — il blocco che esiste per dire
*"questo il prezzo non l'ha ancora votato"* **taceva esattamente durante la sessione**.

Classe **v193/v234**: stato del mercato e freschezza del dato sono due cose diverse. Il rimedio
non è spostare la soglia ma tornare all'ultima chiusura **davvero avvenuta** — a sessione aperta
è quella di ieri, ed è la risposta giusta: una notizia uscita stanotte non è nel prezzo di
chiusura di ieri, che è precisamente ciò che il blocco vuole segnalare.

⚠ `now` è ora un **parametro**: un ramo temporale che nessun test può esercitare non è una
protezione (v190, v234), e un check che dipende dall'ora in cui gira va rosso da solo. I tre
gate lo percorrono a orologio fermo — sessione aperta, sessione chiusa, e il salto che scavalca
il fine settimana.

### ⚠⚠ E la mia iniezione della v400 NON MORDEVA
Il check sul movimento implicito cancellava `r.tv.evento`, ma quel dato **non viene da lì**: lo
costruisce `movimentoImplicito(DATA.options[tk])`. Passava solo perché allo snapshot di quel
momento il book era vuoto — appena è arrivato un run con le opzioni quotate è andato rosso.
Due lezioni già scritte in questo file, sommate: *un check che misura i dati del giorno invece
della proprietà* (v233) e *un'iniezione senza morso è un no-op silenzioso*. Ora lo stato si
**costruisce**: la catena resta e denaro/lettera vanno a zero su ogni strike.

### 🔢 La testata citava una soglia che i dati non usano più
Rigenerando il pacchetto dopo la v401 e leggendolo: la coda pubblica il **pavimento del rumore**
calcolato sul campione (0,015 su 251 sedute, 0,065 su 60) e l'istruzione diceva ancora *"sotto
0,05 non è un canale"*. **Due valori per la stessa grandezza** — esattamente ciò che il collaudo
di congruità ordina a chi legge di segnalare, prodotto dal pacchetto stesso. L'istruzione ora
rimanda al numero che ogni riga porta con sé, invece di ripeterne uno proprio.

## 🎯 v403 — LA CO-MOVIMENTAZIONE NON È LA SENSIBILITÀ AGLI EVENTI

Le due finestre della v401 hanno risposto, e **hanno risposto NO**: sul canale tassi di CRWV il
beta è salito da **+0,18 a +1,35** fra l'anno e il trimestre, ma l'R² è rimasto **0,016 contro un
pavimento di 0,065**. La misura non mi ha dato ragione, ed è la risposta giusta — il 01/09 è
stato un **evento**, non un regime: una giornata violenta non produce R² su sessanta sedute.

> **Un gate che rifiuta di confermare chi l'ha scritto sta facendo il suo lavoro.** Se avessi
> tarato la finestra finché diceva quello che volevo, avrei costruito il check che conferma la
> propria assunzione — l'errore v326.

Ma la domanda che un libro a leva pone non è "quanto si muovono insieme in una giornata
qualunque": è **"il giorno che i tassi saltano, quanto perdo"**. Ora ogni canale porta un terzo
sguardo — la regressione sul **quinto di sedute in cui il canale ha l'escursione maggiore**.

⚠⚠ **E L'AFFERMAZIONE VA TENUTA ONESTA.** Costruendo il caso di prova ho scoperto che una
relazione di coda **non è invisibile** alla regressione piena: quelle sedute portano gran parte
della varianza, quindi si vede anche lì. Quello che il terzo sguardo aggiunge non è "un canale
nascosto" ma il **beta delle giornate che contano**, che la media sottostima — misurato sui dati
sintetici: **+2,48 contro +1,63**, cioè la regressione piena sottostima del 35% la sensibilità
del giorno peggiore.

⚠⚠ **IL SUO R² NON SI CONFRONTA CON GLI ALTRI DUE**: è calcolato su un sottoinsieme scelto,
quindi ha un **denominatore diverso**. La riga lo dichiara invece di lasciarlo dedurre — è la
regola dei denominatori non dichiarati applicata a una misura nostra. Quello che si confronta è
il **beta**, e la riga stampa di quanto è più ampio.

⚠ **Selezionare sulla |escursione| del CANALE non distorce il beta** — si sceglie sulla causa,
non sull'effetto, ed è l'equivalente di un esperimento con più escursione. Selezionare sul
movimento del TITOLO lo distorcerebbe, e la riga dice esplicitamente che non è ciò che il sistema
fa: senza quella frase la misura invita al sospetto giusto sulla cosa sbagliata.

⚠ **Il quinto e non il decimo**: su ~251 osservazioni il decile ne lascia ~25, cioè df 23 —
sotto la soglia in cui `r2_rumore` restituisce un pavimento affidabile. Sotto le 32 osservazioni
selezionate il blocco **tace**, invece di pubblicare un pavimento inventato.

### 🔴 E main è stato ROSSO per quattro ore e mezza senza che nessuno lo vedesse
Il merge della v401-402 (17:26) è andato **rosso in CI**; la v402 (21:58) l'ha riportato verde.
La causa non è il codice: i due check caduti erano **dipendenti dai dati**, e il run del CI usa
un `data.json` **più fresco di quello locale**. La corsa dei gate prima del push era verde sul
mio, rossa sul loro.

> **Con la regola "si unisce sempre", la CI gira DOPO la pubblicazione: la corsa locale dei gate
> è l'unica protezione, e non gira sugli stessi dati.** Quindi un check che dipende dai dati del
> giorno non è solo fragile — è un buco nella sola rete rimasta. Entrambi sono stati riscritti
> perché **costruiscono lo stato** che misurano invece di trovarlo.

## 🏦 v404 — IL GRUPPO CORRELATO NON È UN RISCHIO SOLO

Il grappolo del libro si costruisce sulla correlazione dei rendimenti con l'ancora, e mette nella
stessa fascia chi **genera** cassa (MU, NVDA, AMD) e chi la **prende a prestito** (ORCL, CRWV,
MSTR, RGTI). Si muovono insieme nella giornata media — la correlazione lo misura ed è vera — ma
**l'evento che colpisce i secondi non è quello che colpisce i primi**: un salto dei tassi
riprezza il costo del piano di chi deve finanziarlo, e sugli altri agisce solo come fattore di
sconto.

Misurato sul libro: **16,2% dell'azionario** ha flusso di cassa libero negativo su dodici mesi
(MSTR 7,4% · ORCL 3,5% · CRWV 2,9% · RGTI 2,4%), contro **83,8%** che si autofinanzia. Di quel
16,2%, **8,8% sta dentro il gruppo correlato al 74%**. Un pacchetto che pubblica solo il 74% fa
concludere che una stretta creditizia colpisca tre quarti del libro; la misura dice un'altra cosa.

> È un taglio **trasversale** al grappolo, non un secondo raggruppamento dello stesso tipo: le
> due misure rispondono a domande diverse e vanno lette insieme.

⚠⚠ **SOLO SEGNI E RAPPORTI, MAI GRANDEZZE FRA TITOLI.** `fcf_ttm` è nella valuta di bilancio
dell'emittente: **SKHY lo pubblica in won** (40.689 miliardi), ORCL in dollari. Ordinarli o
sommarli sarebbe la classe che il gate valuta sorveglia dalla v183. Il **segno** del flusso e il
**rapporto** di copertura non hanno valuta, ed è esattamente ciò che serve — un check verifica che
nella riga non finisca nessun importo.

⚠ **La soglia è una convenzione dichiarata** (v240), non un dato del file, e **non è un giudizio
sulla società**: costruire a debito può essere la scommessa giusta — cambia il canale da cui il
rischio arriva, non il merito della scommessa. Senza quella riga il blocco produce l'analisi
facile ("il libro è troppo indebitato, riduci"), che è un ordine costruito su dati che il sistema
non ha.

⚠ **Il peso su cui il dato manca si dichiara** invece di finire fra gli autofinanziati: "genera
cassa" e "non lo so" si leggono uguali e sono cose diverse.

### 🕳️ E C9 ha preso un difetto della v403 che era invisibile fino al run successivo
La riga del beta condizionato diceva *"Selezionare… selezionarle…"* — due imperativi dentro la
coda, **quinta volta** in questo progetto (v156, v179, v180, v389, v402). Non era stato visto
prima perché il blocco **non si rendeva**: `evento` lo scrive la pipeline, e al momento del merge
il `data.json` non lo aveva ancora. **Ramo irraggiungibile per i DATI, non per l'orologio** — la
classe v390, che torna con una causa nuova.

> Quando si aggiunge un blocco che dipende da un campo che la pipeline deve ancora produrre, i
> gate di coerenza non lo vedono al momento del merge: vanno rieseguiti dopo il primo run che
> quel campo lo porta.

## 🏷️ v405 — TRE ETICHETTE CHE DICEVANO PIÙ (O ALTRO) DEL PROPRIO DATO

Trovate leggendo il pacchetto macro come il modello che lo riceve. Nessuna rompeva niente: sono
la classe dei difetti che non si rompono, e si vedono solo eseguendo il payload.

**"Rally con partecipazione ampia" su un mese in cui ENTRAMBI gli indici scendono.** Il
03/09/2026 SPY −0,8% e RSP −0,74%, e il pacchetto parlava di un rally che non c'era. Il detector
misura correttamente lo *spread* — quello è il suo mestiere — ma il nome dello stato presupponeva
un **segno** che i dati non portano. Ora il verso lo dà il cap-pesato e l'ampiezza resta la
distanza fra i due: con entrambi in calo si legge *"discesa con partecipazione uniforme"*, che è
un'informazione diversa e altrettanto utile (il calo non è concentrato su pochi nomi).

**"Credito rilassato" al 3° percentile.** La banda è corretta e dichiarata (2,65% sta sotto il
4%), ma poche righe più sotto lo stesso pacchetto pubblica che quel valore è al **terzo
percentile** del proprio anno con la nota *"compressione estrema: il credito non prezza rischio"*.
Due frasi opposte sullo stesso numero. **Il livello e la posizione nella propria distribuzione
sono due grandezze diverse** — la stessa distinzione che il pacchetto fa già sulle materie prime.
Ora sotto il 5° percentile l'etichetta porta l'avviso accanto: un compenso per il rischio
all'estremo basso non ha più spazio dalla parte favorevole.

⚠ Il percentile si legge dalla **stessa** `dgPercentile` che lo pubblica nei digest storici:
ricalcolarlo sarebbe la classe v161/v207.

**Il nome del titolo vuoto nel blocco notizie.** `contestoPortafoglio(tk)` riceve il ticker solo
dal pacchetto di titolo: in quello macro nessun titolo è in esame, e la riga usciva come
*"stanno nel gruppo correlato di "* — mutilata proprio dove chi legge cerca il riferimento. Non
era un dato mancante: era **una riga scritta per un contesto e resa in due**.

### 🧪 Due fixture che non contenevano il fenomeno
Il check sul credito iniettava sette osservazioni con 2,6 come minimo: `dgPercentile` usa la
convenzione **midrank**, quindi il minimo unico su sette vale già **7°**, sopra la soglia del 5°.
Il check era rosso perché la fixture non conteneva il caso, non perché il codice fosse rotto —
venti osservazioni lo portano al 3°, che è il valore reale. E il check sulle notizie guardava
`buildPrompt()`: **il blocco vive in `buildCIOText()`**, che è il pacchetto che il CEO incolla
davvero. *Un check sulla funzione sbagliata misura un'altra cosa.*

### 📋 E il rilievo del CEO sul pacchetto che non riassume la pagina, misurato
*"Molte informazioni del sistema non ci sono nel prompt … il sistema non è un riassunto
affidabile di ciò che posso vedere scorrendo la pagina."* Sui tre esempi citati (VIX, Fear &
Greed, put/call) il pacchetto **li ha**. Ma la conclusione generale è corretta e ora ha una
misura: `data.json` porta **42 blocchi macro**, la pagina ne apre **34**, e sette non arrivano
mai al pacchetto — le **componenti** di Fear & Greed, **Buffett**, **risk_sentiment**,
**smart_money**, **macroquant**, **Sharpe** e **alpha** del libro. EUR/JPY è invece
un'esclusione decisa (v138, ridondante col blocco Carry).

> Il difetto peggiore non è l'assenza: è che **il pacchetto non dichiara di non averli**. Chi
> legge non distingue "il sistema non ha questo dato" da "ce l'ha e non te lo passa" — la classe
> delle notizie contate e poi nascoste (v393). La correzione strutturale è un **gate nei due
> versi**, come quello che la v387 ha fatto per `/aggiorna`: ogni indicatore che la pagina rende
> deve essere o nel pacchetto o dichiarato fuori con la sua ragione scritta.

## 🪞 v406 — «IL SISTEMA NON È UN RIASSUNTO AFFIDABILE DI CIÒ CHE VEDO SCORRENDO LA PAGINA»

Rilievo del CEO, testuale, con tre esempi: *"non mi dà informazioni per esempio sul vix sul fear
and greed sulle put sulle call"*. **Misurato invece che dato per buono, e sui tre esempi il CEO
aveva torto**: VIX, Fear & Greed e put/call erano già nel pacchetto — si leggono nel testo che lui
stesso aveva incollato. Ma la sua conclusione era giusta lo stesso, perché **quattro fatti
mancavano davvero** e nessuno se ne sarebbe accorto: il divario pagina↔pacchetto era cresciuto da
solo, in silenzio, esattamente come il comando `/aggiorna` della v387.

| fatto | la pagina lo mostra | il pacchetto |
|---|---|---|
| **Sharpe e Sortino del libro** | sì, in cima | assenti |
| **Capitalizzazione/PIL (Buffett)** | scheda propria | assente |
| **Struttura del prezzo sugli indici** (liquidità sopra/sotto, order block) | scheda propria | assente |
| VIX · Fear & Greed · put/call | sì | **già presenti** — l'accusa era sbagliata |

⚠ **E TRE DEI SETTE BUCHI ERANO RIMOZIONI DELIBERATE**, non dimenticanze: i compositi 0-100
(sentiment, quadro macro sintetico) sono stati tolti in v200 **sui numeri del loro track record**,
le componenti di Fear & Greed in v263, EUR/JPY in v138. Verificarne una per una la provenienza ha
trasformato "sette buchi" in **quattro fatti mancanti e tre ricevute** — la differenza fra un
sistema che dimentica e uno che ha deciso.

> ⚠⚠ **Perciò il pacchetto ora DICHIARA cosa la pagina mostra e lui non porta, con la ragione.**
> *"Il sistema non ha il dato"* e *"il sistema ce l'ha e non te lo passa"* si leggono uguali e sono
> cose diverse (classe v393, le notizie contate e poi nascoste). Senza quella riga il CEO non aveva
> modo di distinguerle, ed è precisamente per questo che ha scritto la frase da cui parte la v406.

⚠ **I livelli sì, il punteggio no.** Della struttura di prezzo escono liquidità sopra, liquidità
sotto e l'ultimo order block — **non** il punteggio 0-100 che la stessa chiave porta: quello è un
composito nostro e cade sotto la v200 come gli altri. La stessa chiave può contenere un fatto
pubblicabile e un giudizio da lasciare fuori.

⚠ Il rapporto capitalizzazione/PIL esce **come RAPPORTO e non come punteggio**, e la sua lettura
convenzionale (sotto 100% economico, 100-140% equo, oltre 140% caro) è dichiarata **convenzione
del mestiere, non dato del file** — la regola v240 sulle tacche disegnate, applicata a una soglia
di testo.

### 🔁 Il gate è nei DUE VERSI, perché un gate che aggiunge e basta invecchia da solo
Fra un mese la pipeline pubblica una chiave nuova, la pagina la disegna e il pacchetto resta
indietro: sarebbe lo stesso guasto, un anno dopo. Quindi l'invariante è che **ogni indicatore che
la PAGINA sa aprire sia O nel pacchetto O nel registro delle esclusioni con la sua ragione
scritta**, e un meta-check impedisce che una chiave stia in tutti e due i registri — una ricevuta
che si contraddice non è una ricevuta. Per le statistiche ufficiali la sonda si **ricava
dall'etichetta di `MACRO_INFO`**, che è la stessa che il pacchetto stampa: niente secondo elenco
da tenere allineato (C10, `MACRO_CARD_BY_PANEL` che copriva 7 pannelli su 37).

### 🧨 Tre inciampi di metodo, tutti già scritti in questo file, tutti ripetuti
- ⚠⚠ **Una VIRGOLETTA SFUGGITA dentro un template passato al vm.** `\"` arriva al vm come
  virgoletta **nuda** e chiude la stringa a metà: errore di sintassi **dentro** il vm, cioè un
  check morto in eccezione. `node --check` non lo vede — per lui è testo dentro un template — e il
  rilevatore dei backslash guardava **solo** `\d \w \s \b` dentro template che contengono una
  regex. Ora copre **tutti** i template passati al vm e anche le virgolette: non esiste nessuna
  ragione legittima di scriverle lì dentro, quindi l'invariante non ha eccezioni. Validato per
  iniezione. *È lo strumento a cambiare, non l'attenzione.*
- ⚠ **Ventitreesima rottura di un check ancorato a una stringa letterale**: il gate v138
  pretendeva che `EUR/JPY` **non comparisse** nel payload, ed è andato rosso perché la riga nuova
  lo **nomina fra le esclusioni dichiarate**. Un nome citato per dire che manca è il contrario di
  un dato pubblicato. Riagganciato al fatto: la **quotazione** non esce (valore iniettato assente)
  e ogni riga che lo nomina è quella delle esclusioni. Validato riportando la quotazione nel
  payload: morde.
- ⚠ **C9 ha preso un mio imperativo nella coda** (`ripubblicarle`) — **settima** volta (v156,
  v179, v180, v389, v402, v404). I clitici sono la forma in cui un ordine si traveste da fatto.

⚠ E `indexOf` è **sensibile al maiuscolo**: una sonda scritta in minuscolo su una riga che
comincia con la maiuscola è un check rosso su codice giusto.

## 🔀 v407 — DUE TASTI, DUE STANZE, E LA SCHEDA CHE VA A CHI HA UN EVENTO

Istruzione del CEO, testuale: *"crea due tasti differenti che generano prompt: 1 macro piu
inserimento di analisi di tutti i titoli in portafoglio. 2 analisi singolo titolo con maggiore
presenza analisi tecnica, fondamentali e news. Entrambe devono sempre avere correlazione con
analisi tecnica, fondamentali, macro e news"*.

⚠⚠ **NON È IL RITORNO DEI DUE BOTTONI DELLA v259.** Quelli producevano lo **stesso** quadro
macro, una volta da solo e una volta dentro un'analisi: due porte per la stessa stanza, ed è per
questo che erano stati fusi. Qui le stanze sono due davvero — il primo guarda **tutte** le
posizioni insieme, il secondo scava su **una** — e il difetto che la separazione toglie era
misurabile: con un bottone solo la scelta la faceva il contenuto del box del ticker, quindi chi
voleva il macro col box ancora pieno riceveva **in silenzio** il pacchetto sbagliato.

> Il gate non guarda se i due bottoni esistono — la guardia strutturale lo fa già — ma se sono
> **collegati a due teste diverse**: è la classe v315/v316/v399, dove il bottone esisteva, la
> funzione esisteva, e i due non erano agganciati.

⚠ **Il payload resta UNO SOLO** (`buildPrompt`): i due tasti sono due modi di comporlo, non due
costruttori. Due implementazioni della stessa domanda divergono al primo ritocco (v161, v207,
v316). E l'**invio** dentro il box del ticker fa quello che fa il tasto che gli sta accanto: due
comandi vicini che producono pacchetti diversi sono la sorpresa che questa versione toglie.

### 📏 La media a 20 giorni: il sistema ce l'aveva e non la passava
Rilievo del CEO: *"pochi passaggi su fondamentali e analisi tecnica (es. media mobile 20 giorni
dei titoli sarebbe utile)"*. Aveva ragione, ed è la **v406 che si ripete su un altro dato**: la
batteria tecnica completa (12 medie, MACD, ADX, stocastico) esiste dalla v316 **per ogni titolo
seguito** e usciva solo nel pacchetto del singolo titolo. Il blocco del libro portava la 50 e la
200 — il medio e il lungo periodo — e non il breve, che è l'orizzonte su cui si decide se una
discesa è in corso adesso. Misurato: `MACD`, `ADX`, `stocastico`, `SMA20` comparivano **zero
volte** nel pacchetto macro e due volte in quello di titolo.

⚠ **Le tre distanze escono dalla stessa fonte**: `tv.tecnica` le calcola insieme sulle stesse
barre, mentre `sma50_dist_pct` è la stessa grandezza arrotondata a una cifra invece che a due.
Mescolarle darebbe due derivazioni nella stessa riga. Il ripiego sui campi di riga resta solo per
le posizioni che la pipeline non ha mai visto.

### 🎯 L'approfondimento, e su chi
Forma scelta dal CEO: *compatta per tutte, approfondimento su chi ha un evento o una soglia
rotta*. La scheda estesa costa spazio, e darla a tutti significa non darla a nessuno — con
tredici schede lunghe la parte che conta finisce in fondo, dove un modello a corto di spazio
sostituisce le prove con affermazioni (misurato in v398).

**Il criterio è misurato e si muove col libro** — un registro fisso di nomi invecchia da solo e
in silenzio (C10, red team I6). Tre condizioni, tutte grandezze che il sistema già calcola:

| condizione | perché | quante oggi |
|---|---|---|
| trimestrale entro 30 giorni | riprezza la tesi | MU (27g), ORCL (7g) |
| prezzo **sotto tutte** le proprie medie | ⚠ soglia misurata SUL TITOLO, non una percentuale: una percentuale segnalerebbe il nome sbagliato perché ogni titolo ha la propria ampiezza (lezione v210) | RGTI, CRWV |
| flusso di cassa libero negativo | la dipendenza dal mercato dei capitali misurata in v404: è il nome su cui una stretta creditizia arriva prima | ORCL, RGTI, MSTR, CRWV |

Unione: **5 posizioni su 13**. Non una, non tredici.

⚠ **E LA RAGIONE SI SCRIVE ACCANTO.** Una scheda più lunga senza il perché si legge come una
preferenza del sistema, cioè come il punteggio tolto in v200. Qui non c'è nessun giudizio: c'è una
condizione dichiarata che il titolo soddisfa.

⚠ **Quando nessuno la soddisfa, il blocco lo dichiara** invece di sparire: "nessuna notizia" e
"la fonte non ha risposto" si leggono uguali (v389). Un gate percorre quel ramo costruendo lo
stato, non aspettando che i dati lo producano.

⚠ **Solo rapporti, mai importi**: `cassa`, `debito` e `fcf_ttm` sono nella valuta di bilancio
dell'emittente — SKHY li pubblica in won. I mesi di investimento che la cassa copre e la
percentuale di emissione netta non hanno valuta (v183, v404). E **la data del bilancio viaggia col
numero**: è la lezione v400, dove *"la cassa copre 1,6 mesi"* stava su un bilancio già superato da
un deposito più recente.

⚠ **La convenzione dell'ADX si dichiara UNA VOLTA**, nell'intestazione. La prima stesura la
ripeteva su ogni scheda: cinquecento caratteri che dicono cinque volte la stessa cosa, la
ridondanza che questo progetto misura e taglia dalla v184.

### 🧨 Due trappole rifatte, entrambe già scritte in questo file
- ⚠⚠ **Quarta incarnazione dell'ANCORAGGIO APERTO**: il gate cercava `" dalla 20"`, che
  `" dalla 200"` **contiene**. Iniettando la sparizione della media a 20 il check restava
  **verde**. È scritta tre volte qui (`mg-card`/`mg-card-head`, `sc-fonte`/`sc-fonte-qualsiasi`,
  `calendario_uscite`/`calendario_uscite_fred`) e l'ho rifatta lo stesso. Chiuso su
  `/ dalla 20(?![0-9])/`.
- ⚠⚠ **`no()` NON ESISTE DENTRO IL VM.** Vive nel runner, quindi un check scritto con `suVeri`
  che lo chiama sul ramo di fallimento **esplode** invece di riportare la ragione: il check
  fallisce lo stesso (l'eccezione torna una stringa e `check()` rifiuta tutto ciò che non è un
  booleano), ma il messaggio dice *"CHECK MALFORMATO"* al posto del motivo — la diagnosi si perde
  proprio quando serve. Per questo esiste `suVeriEsito`. Trovato perché un'iniezione ha morso
  **con il messaggio sbagliato**: *un gate che fallisce per il motivo giusto e lo racconta male
  costerà un giro di debug a chi verrà dopo.*

**Costo misurato**: pacchetto macro 66.903 → 70.533 caratteri (+5,4%), pacchetto di titolo
107.329 → 110.959. La riga compatta cresce di un elemento su tutte e tredici; le cinque schede
estese valgono ~2.900 caratteri in tutto.

## ✂️ v408 — LA POTATURA CHIESTA VALEVA IL 3,6%, E LA MISURA HA CAMBIATO IL TAGLIO

Ultimo pezzo della decisione del CEO: nel pacchetto del singolo titolo la macro resta *"potata ai
canali che toccano quel titolo"*. Elenco concordato: via stagionalità NDX, i 21 ETF, i mercati di
previsione non-Fed, i campanelli BofA, il disaccoppiamento pluriennale.

**Misurato PRIMA di scrivere il codice, e la misura ha cambiato la forma del taglio:**

| blocco candidato | caratteri | quota del pacchetto |
|---|---|---|
| 21 ETF (rotazione) | 884 | 0,82% |
| stagionalità NDX | 788 | 0,73% |
| mercati di previsione | 682 | 0,64% |
| campanelli BofA | 559 | 0,52% |
| profitti reali | 507 | 0,47% |
| disaccoppiamento PIL | 468 | 0,44% |
| **tutti insieme** | **3.888** | **3,6%** |

> **Tagliarli non alleggerisce il pacchetto in modo percepibile.** La ragione del taglio quindi
> non è lo spazio ma la **PERTINENZA**: un modello che ha davanti l'analisi di UNA società e legge
> la valutazione pluriennale dell'indice spende su quella una parte della risposta che il CEO ha
> chiesto sui fondamentali e sulla tecnica del titolo. È la v398 rovesciata — lì il rischio
> nasceva dall'essere costretti a riempire, qui dall'avere davanti materiale che invita altrove.

### ⚠⚠ Due dei sei tagli NON sono stati fatti, e la ragione è scritta nel pacchetto
- **I 21 ETF della rotazione.** Per tenere "solo il comparto di questo titolo" servirebbe una
  mappa settore→ETF **scritta a mano** — il registro fisso che invecchia da solo e che questo
  progetto ha già pagato più volte (C10, red team I6, `MACRO_CARD_BY_PANEL` che copriva 7 pannelli
  su 37). E `rs_bench` risolve **un comparto solo** (`sox`) su tre valori possibili: per diciotto
  posizioni su ventuno il sistema non sa a quale ETF agganciarle. 884 caratteri non valgono una
  mappa che si disallinea in silenzio — e la lettura che conta della rotazione è **"dove NON sei"**
  (v206), che potando si perde.
- **I mercati di previsione non-Fed.** Separarli richiederebbe di classificare il **testo** della
  domanda, cioè di indovinare l'attribuzione: è precisamente l'euristica che la v399 ha rifiutato
  scegliendo Nasdaq invece del feed multi-ticker di Yahoo. 682 caratteri.

> **Una selezione indovinata è peggio di una selezione non fatta**, ed è il pacchetto stesso a
> dirlo a chi legge, invece di lasciare che sembri una dimenticanza.

Restano fuori solo i **quattro blocchi che si riconoscono per COSA SONO**, senza nessuna mappa:
letture sulla valutazione pluriennale dell'INDICE, che non arrivano ai numeri di una singola
società attraverso nessun canale misurabile.

⚠⚠ **E IL PACCHETTO DICHIARA COSA HA TOLTO, dove quei blocchi si trovano, e cosa NON ha potato.**
Regola v406: *"il sistema non ha il dato"* e *"il sistema ce l'ha e non te lo passa"* si leggono
uguali. La dichiarazione costa ~820 caratteri sui 2.322 tagliati — il risparmio netto è **1.502
caratteri, l'1,4%** — e vale il suo prezzo proprio perché il taglio non è per lo spazio.

### 🔒 Il primo gate è la Regola Suprema
`buildPrompt` ha preso un'opzione, e **senza argomento deve produrre esattamente quello di prima:
identico al byte**, verificato su `buildPrompt()`, `buildPrompt({})` e `buildPrompt({perTitolo:""})`.
Un costruttore che cambia comportamento anche solo un po' quando gli si aggiunge un parametro è il
primo passo verso i due costruttori che divergono (v161, v207). Misurato: pacchetto macro 70.533
caratteri prima e dopo.

⚠ Il gate verifica anche che il taglio **non si allarghi al vicino** — rotazione e mercati di
previsione devono restare INTERI — che è la classe v201-v204, tre volte in quattro versioni.

⚠ **E l'invariante nei due versi della v406 ha morso da solo**: iniettando `perTitolo = true`
sempre, il gate pagina↔pacchetto è andato rosso prima ancora di quelli nuovi, perché due
indicatori che la pagina apre sparivano dal pacchetto macro. *Un gate scritto ieri che prende un
difetto di oggi che non aveva in mente sta facendo il suo lavoro.*

⚠ Un `assert` ha intercettato un'ancora **ambigua**: `if (m.stagionalita_ndx …` compare **due
volte** nel file — una per la pagina, una per il pacchetto — e una sostituzione globale avrebbe
potato anche il riquadro della dashboard. La ricevuta scritta prima di tagliare, per la quinta
volta in questo progetto.

## 💧 v409 — L'AUTONOMIA DI CASSA AVEVA DUE DENOMINATORI, E NESSUNO DEI DUE ERA DETTO

Trovato da un **LLM reale** che leggeva il pacchetto v408, testuale: *"MSTR ha cassa pari a 0,9
mesi nel blocco tecnico e 'oltre 5 anni' nella disciplina; RGTI 12,4 e 5,5. Questi numeri non
possono essere contemporaneamente veri … non userei nessuna delle stime di autonomia discordanti
per governare il rischio."* Aveva ragione, e **il difetto era mio, introdotto nella v407**.

**Sono due grandezze diverse con la stessa unità**, e la pipeline le calcola entrambe:

| campo | formula | risponde a |
|---|---|---|
| `mesi_operativi` | cassa / perdita operativa | quanto dura la cassa se l'azienda **brucia** |
| `mesi_capex` | cassa / investimenti | quanto dura se continua a **costruire** |

Su MSTR il flusso operativo è negativo di pochissimo (denominatore quasi nullo → **1022,6 mesi**)
mentre il capex vale 21,7 miliardi (→ **0,9 mesi**). Entrambi veri per il proprio denominatore;
affiancati senza dirlo, si leggono come una contraddizione — ed è la classe che questo progetto
chiama **denominatori non dichiarati**, sorvegliata da `coherence_check` DENTRO un blocco ma non
**fra due blocchi che usano parole diverse per la stessa unità**.

> ⚠⚠ **La correzione non è scegliere: sono due domande utili.** È che il numero non esce mai senza
> il proprio denominatore, che dove ci sono entrambi il pacchetto **dichiara che non si
> confrontano**, e che tutto passa da UNA funzione — `autonomiaCassa()`. Tre punti di stampa con
> tre formulazioni è precisamente come è nato il difetto (v161, v207, v316).

⚠ **E la data del bilancio viaggia col numero, ovunque** (v400): l'LLM ha chiesto esattamente
quella (*"finché il sistema non chiarisce la provenienza temporale dei bilanci"*) e il blocco
della disciplina la ometteva.

### 🔥 Il fix ne ha esposto uno peggiore, nello stesso blocco
`COMBUSTIONE DI CASSA` diceva *"La gestione ASSORBE cassa (-0 mld): la combustione viene dal
**MESTIERE**, non dagli investimenti"* — su MSTR, che ha capex per **21,7 miliardi** stampati due
parole prima. La condizione guardava il **segno** dell'OCF e dichiarava una **grandezza**: un
segno non basta a stabilire da dove viene la combustione, serve il **confronto** fra le due. È la
stessa classe del beta pubblicato senza il suo R² (v316) — mezza misura presentata come
conclusione. Ora la riga confronta gli ordini di grandezza e nomina entrambi.

⚠ E il terzo punto di stampa aveva **due difetti in più**: nessun cap (avrebbe scritto
*"1.022,6 mesi"*, il numero aritmeticamente giusto e comunicativamente falso che la v389 aveva
già tolto **altrove** — la correzione era rimasta locale invece di diventare la regola) e un
`else if` che pubblicava **un denominatore solo**, facendo sparire il secondo proprio sul nome in
cui i due divergono di più.

### 🦴 Due gate rossi, entrambi avendo ragione a modo loro
- ⚠ **Ventiquattresima rottura di un check ancorato a una stringa letterale**: v365 pretendeva
  `mesi di investimenti al ritmo attuale` ed è andato rosso perché la formulazione nuova dice **di
  più** — nomina il denominatore. Riagganciato al fatto.
- ⚠⚠ **v389 era ancorato a una FINESTRA FISSA di 4000 caratteri** fra `contestoPortafoglio` e la
  chiamata a `gruppoFattore`: inserendo `autonomiaCassa` fra le due, il gate è andato rosso su
  codice corretto. **Una distanza non è una proprietà** — è la classe del pavimento numerico di
  v208 e degli indici fissi del red team I6. Ora estrae il **corpo** della funzione e guarda
  dentro.

### 🧨 Tre trappole rifatte
- ⚠ **`n1` è un helper LOCALE di `disciplinaRischio`**, non una funzione globale: usarlo dentro
  `autonomiaCassa` faceva **morire il render** al primo titolo con combustione. L'harness l'ha
  preso al primo giro — è la classe v238, dove la pagina è andata morta in produzione con 219 test
  verdi.
- ⚠ **Il meta-gate dei backslash mi ha ripreso**: `\b` dentro un template passato al vm diventa
  un backspace vero. Sostituito con `indexOf`, che non ha niente da sfuggire (stessa correzione
  della v400). *Lo strumento ha fatto il lavoro per cui esiste.*
- ⚠ **Quinta incarnazione del gate che trova sé stesso**: il check "la formulazione viene da un
  posto solo" cerca stringhe che i commenti che *spiegano* il difetto contengono per forza. Toglie
  i commenti prima di leggere (v213, v240, v393).

### 📋 Cosa il referto ha CONFERMATO, oltre a quello che ha trovato
Il collaudo obbligatorio della v389 ha funzionato come progettato: il modello ha scritto le tre
righe di esito, ha **usato la ricerca web** per aggiornare le parti macro vecchie, e ha
correttamente rifiutato di sommare CPI/PCE, curva 10A-2A e 10A-3M, VIX e Fear & Greed come segnali
indipendenti — cioè ha applicato B3 senza che glielo si ricordasse. *Un collaudo che trova un
difetto vero è la prova che il collaudo serve.*

## 🎯 v410 — LE CONSEGUENZE OPERATIVE, E IL PERIMETRO DICHIARATO COL NUMERO

Richiesta del CEO: *"far sì che il sistema suggerisca alleggerimenti, vendite, incrementi ed
eventuali opportunità di ingresso su nuovi titoli (motivando il tutto)"*, e poi, sugli ingressi:
*"lascia ricerca ad llm per nuovi titoli anche sulla base della rotazione dei settori o su altri
parametri che ritiene (es. news)"*.

**La separazione è quella di sempre**: l'ORDINE di concludere e di cercare vive nella TESTATA
(`[B7]` e `[B8]`), il FATTO che l'universo dei candidati non esista vive nella CODA. Metterlo al
contrario è la violazione C9 già pagata sette volte.

### [B7] — la chiusura operativa
Non cambia la natura del sistema, che resta di fatti: cambia che l'analisi deve **arrivare** a una
conseguenza, altrimenti la ricava il CEO dai numeri — cioè fa il lavoro che ha chiesto all'LLM.
Quattro vincoli, tutti già regole di questo progetto:
- ogni indicazione **si ancora a una misura dichiarata** — le nove regole della disciplina portano
  misura, soglia e provenienza della soglia — e la riga **nomina quale**;
- ⚠⚠ **direzione e priorità sì, quantità mai**: il divieto di dimensionare viaggia DENTRO il blocco
  che invita a concludere, che è dove è più facile scivolare (v389). I livelli di prezzo sì,
  perché vengono dai dati;
- ⚠ **"oltre la soglia" non significa "vendi"**: un fondo growth concentrato ci sta fuori per
  costruzione. La domanda utile è se quella deviazione sia stata **decisa** o sia **successa da
  sola** mentre i prezzi si muovevano;
- ordinare per **urgenza**, non per dimensione.

### [B8] — la ricerca è dell'LLM, e il sistema lo dice
⚠⚠ **PERCHÉ LA DELEGA SIA ONESTA, CHI LEGGE DEVE SAPERE PERCHÉ.** Non è che il sistema abbia uno
screening e non lo passi: non ce l'ha. La coda lo dichiara **col numero, contato a ogni run**:

> *dei 25 simboli che la pipeline segue, 14 sono le posizioni del libro, 9 sono indici, cambi o
> materie prime, e restano 2 titoli seguiti e non posseduti (TSM, AVGO). 2 nomi non sono uno
> screening.*

⚠ **Il numero si conta, non si scrive.** Un conteggio fisso in prosa invecchia da solo e in
silenzio (C10, red team I6) — e infatti la mia prima stima a voce era sbagliata: avevo detto
"11 benchmark e zero candidati", i benchmark sono **9** e i candidati **2**. Il gate lo valida
aggiungendo un titolo e verificando che il numero si muova.

⚠ Gli strumenti si riconoscono dalla **FORMA del simbolo** (`^`, `=`, `-USD`), non da un elenco di
nomi da tenere allineato.

⚠ E il blocco dice **da dove partire**: la rotazione sui 21 ETF — in particolare i comparti in cui
il libro NON è presente, che è la lettura per cui quel blocco esiste (v206) — le notizie, e i
canali macro misurati. Un ordine di cercare senza appigli è un ordine che produce nomi a caso.
⚠ Ogni nome proposto è un'affermazione dell'LLM, non un dato del sistema, e vale la regola A1.
⚠ E un nome nuovo dentro il gruppo correlato già misurato **non diversifica**: aggiunge alla
stessa scommessa.

### 🔒 I gate, e il primo è la v331
`[B7]` e `[B8]` devono stare in **entrambe le testate** — il file remoto E `DEFAULT_PROMPT_HEADER`.
*Un obbligo che dipende da una fetch non è un obbligo, è una speranza*, ed è già costata la vita
di una funzionalità. Validato togliendo il blocco dal solo fallback: morde.

**Costo misurato**: pacchetto macro 71.209 → 74.840 caratteri (+5,1%), di cui ~2.900 sono le due
sezioni di testata e ~700 la riga del perimetro.

## 🪞 v411 — IL NUMERO FISSO ERA TORNATO, NELLA TESTATA, UN PARAGRAFO PIÙ IN LÀ

Trovato **eseguendo il pacchetto v410 su me stesso**, l'esercizio ricorrente di questo file — ed è
il modo in cui i difetti di questa sessione sono stati trovati tutti.

La v410 aveva appena tolto dalla CODA il conteggio scritto a mano, con tanto di gate che lo valida
aggiungendo un titolo e verificando che il numero si muova. E nella TESTATA, scritta nella stessa
mezz'ora, avevo messo: *"segue i titoli che il CEO possiede **più due nomi soli**"*.

> ⚠⚠ **La testata è il posto in cui quel difetto è PEGGIO**, perché nessun gate la conta: se il
> CEO aggiunge tre nomi a `ui_watchlist.json`, la coda dice cinque e l'istruzione continua a dire
> due — e l'istruzione è quella che il modello legge **per prima**.

*Scrivere la regola e non applicarla a sé stessi è la classe già annotata in v313* (il confine
`\nfunction` usato dopo aver documentato che era sbagliato). Ora `[B8]` **rimanda** al conteggio
invece di sostituirlo, e un gate verifica che nessun numero rientri — in entrambe le copie della
testata.

### E una seconda frase contraddiceva A1bis
`[B8]` diceva *"questo è l'unico blocco della tua risposta in cui la fonte sei tu"*. È **falso** su
una testata che con A1bis ordina già di cercare le notizie macro. Una testata che si contraddice
fra due sezioni logora il collaudo B5, che impone al lettore di segnalare esattamente quelle
contraddizioni: **un pacchetto che genera falsi positivi nel proprio controllo di qualità lo
svuota** (classe v400). Ora la riga si aggancia ad A1bis invece di negarla.

⚠ Entrambi i gate sono validati per iniezione, e guardano **file e fallback** — un obbligo che
vive in una copia sola è la trappola v331.

### 🦴 E il rebase ha acceso un fossile che nessuno aveva mai visto
Rientrando dal conflitto con i dati freschi del CI, C9 ha trovato un imperativo in un ramo che
**non si era mai reso**: `[BREADTH DIVERGENCE]`, che compare solo quando `br.alert` è vero — e i
dati che lo accendono sono arrivati proprio con quel run. È il **ramo irraggiungibile per i DATI**
di v390/v404, che i gate di coerenza non vedono al momento del merge.

Quando si è acceso, dentro c'erano **tre difetti insieme**:

| difetto | classe |
|---|---|
| una **DIRETTIVA** nella coda | C9, **ottava volta** (v156, v179, v180, v389, v402, v404, v406) |
| una prescrizione di **dimensionamento** (*"sizing ridotto"*) | ciò che la testata vieta e che la v410 ha appena rimesso al centro con `[B7]` |
| un rimando allo **"stop ratchet"**, rimosso nella v256 | rimando a un blocco che non esiste più (C10) |

Restano i **fatti**, che sono quelli utili: di quanto i due indici divergono, cosa significa
meccanicamente (il movimento è retto da pochi nomi grandi), e perché riguarda **questo** libro —
le posizioni più pesanti sono proprio le megacap che stanno reggendo l'indice da sole. La
conseguenza la trae chi legge, che è precisamente ciò che `[B7]` gli chiede.

⚠⚠ **E il gate v126 PINNAVA IL COMPORTAMENTO SBAGLIATO**: pretendeva la stringa *"prudenza sui
nuovi ingressi"*, cioè proprio la direttiva che C9 vieta. Venticinquesima rottura di un check
ancorato a una stringa letterale, e la peggiore specie — *un gate che pinna un difetto lo rende
permanente* (v326). Riagganciato all'invariante: il ramo si accende solo quando serve, pubblica la
**misura**, e non contiene né ordini né quantità. Validato reintroducendo la direttiva: morde.

> **La lezione operativa, già scritta in questo file e ripagata oggi**: dopo un rebase che porta
> dati nuovi, i gate di coerenza vanno **rieseguiti**, perché i rami che dipendono dai dati
> possono essersi accesi per la prima volta.

## 🔁 v412 — LA STESSA GRANDEZZA TRE VOLTE, DUE ARROTONDAMENTI

Trovato rileggendo la riga che avevo appena riscritto **un'ora prima** in v411. Diceva lo spread
**tre volte**: in `base` (`+0,56pp`), dentro `br.note` che la pipeline scrive con l'arrotondamento
grosso (`+0.6pp`), e nella mia frase. Idem il rendimento di SPY: `+0,45%` e `+0.5%`.

| | in `base` (nostro) | in `br.note` (pipeline) |
|---|---|---|
| rendimento SPY | +0,45% | **+0.5%** |
| spread | +0,56pp | **+0.6pp** |

> ⚠⚠ **Due valori per la stessa grandezza sono esattamente ciò che il collaudo B5 ordina al
> lettore di segnalare** — e che un LLM reale ci ha segnalato **lo stesso giorno** sull'autonomia
> di cassa (v409). Il pacchetto non deve produrre da solo i falsi positivi del proprio controllo
> di qualità: quando succede, il collaudo si logora e chi legge smette di fidarsi anche del resto.

⚠ E `br.note` porta anche il **difetto v405**: chiama *"rally"* un mese in cui il cap-pesato fa
+0,45% e l'equi-pesato **scende**. La correzione della v405 era stata applicata al ramo neutro e
non a questo, perché questo ramo **non si rendeva** — è la stessa cecità che ha lasciato il
fossile della v411 in vita per versioni.

⚠ **Non ripubblicare la nota non toglie nessun FATTO**: i tre numeri restano in `base`, e
l'interpretazione la fa la frase nostra, che dice il meccanismo senza affermare una direzione che
i dati non portano. È un taglio di ridondanza (v184), non di informazione — quindi non richiede
la dichiarazione che la v406 impone alle assenze.

⚠ Il gate verifica che ogni grandezza compaia **una volta sola** e che "rally" non rientri.
Validato reintroducendo `br.note`: morde.

> **La lezione di giornata, ripetuta tre volte in poche ore**: i difetti peggiori di oggi li ho
> introdotti io, e li ha trovati tutti e tre **leggere il pacchetto come chi lo riceve** — non
> rileggere il codice, non i gate. Prima l'autonomia di cassa (un LLM reale), poi il conteggio
> fisso nella testata, poi questo. L'esercizio ricorrente vale più della suite.

## 🪞 v413 — DUE DIFETTI CHE 501 CHECK NON VEDEVANO, E LI HA TROVATI CHI LEGGE

Il CEO ha incollato i due pacchetti chiedendo di eseguirli come il destinatario e di sanare
quello che emergeva. **Nessuno dei due faceva fallire un gate**, e sono entrambi visibili a
chiunque legga il testo.

### 1. La SESTA derivazione dei giorni alla trimestrale
La riga del pacchetto di titolo contava **istanti** — `Math.round((Date.now() − mezzanotte)/86400000)`
— mentre tutto il resto passa da `giorniAllaTrimestrale`, che conta **giorni di calendario**.
Sul pacchetto CRWV del 03/09 alle 21:05:

| dove | numero |
|---|---|
| `- Prossima trimestrale attesa: 2026-11-11` | **fra 68 giorni** |
| `- CRWV: … trimestrale fra …` (blocco del libro) | **69 giorni** |

Lo stesso evento con due numeri, nello stesso pacchetto. È la classe che la **v228** aveva
chiuso, e il suo commento dichiarava testualmente *"chiunque chieda FRA QUANTO RIPORTA passa da
questa funzione"*: era vero per le **cinque** derivazioni trovate allora, e questa era la sesta.

> **Una dichiarazione di unicità vale solo per le occorrenze che sono state cercate.** Ora c'è un
> gate che le cerca da sé: nessun calcolo di giorni-alla-trimestrale fuori dalla funzione.

⚠ **E un terzo difetto è uscito esercitando i rami**: il giorno stesso la riga scriveva *"fra 0
giorni"* mentre il blocco del libro dice *"trimestrale OGGI"* — due formulazioni per lo stesso
evento, e la più debole cadeva **sul giorno più urgente**, che è precisamente il caso per cui la
v228 esiste.

### 2. ⚠⚠ Il pacchetto macro NEGAVA l'analisi che la sua stessa testata ordina
L'intestazione del blocco del libro diceva:

> *"IL LIBRO IN CUI QUESTA POSIZIONE VIVE (contesto, **non richiesta di analisi del
> portafoglio**)"*

Scritta per il pacchetto di **titolo**, dove è vera, e resa identica in quello **macro**, dove
`[B6]` impone di portare ogni conclusione fino alle posizioni e `[B7]` chiede alleggerimenti,
vendite e incrementi come **chiusura obbligatoria**. E in un pacchetto senza titolo in esame,
*"QUESTA POSIZIONE"* non ha nemmeno un referente.

> **Un modello che obbedisce alla coda rifiuta ciò che la testata gli ha ordinato due schermate
> prima** — ed è la contraddizione che il collaudo B5 gli impone di segnalare, prodotta dal
> pacchetto stesso. È la classe v405 (una riga scritta per un contesto e resa in due), e la v410
> l'ha resa peggiore senza accorgersene: `[B7]` è arrivato ieri, la negazione era lì da prima.

### 🧭 La lezione, che a questo punto è una misura
La suite è a 505 check e ha visto **zero** di questi tre difetti. Sorveglia il prodotto; questi
erano difetti di **lettura** — un numero detto due volte, una riga che nega l'istruzione, una
formulazione debole sul caso urgente. In due sessioni consecutive tutti i difetti materiali sono
stati trovati eseguendo il pacchetto come il destinatario, e nessuno dai gate.

## 🧊 v414 — CONGELAMENTO E BONIFICA: la decisione del CEO, e le tre bugie che ha prodotto

Istruzione del CEO, testuale: *"È possibile avviare attività anche agentica per sanare
definitivamente tutti i problemi che emergono o arrivare al massimo punto di tolleranza per
arrivare ad utilizzare il sistema senza lavorare sempre sulla rettifica anche se questo porta ad
eliminare una parte delle funzioni. **Meglio un sistema stabile ridotto che ampio ma da cui
emergono costantemente bug.**"*

**Strategia scelta: congelamento + bonifica.** Nessuna funzionalità nuova; si bonificano i
difetti accumulati; le classi ricorrenti diventano gate che le rendono **impossibili** invece
che rare; **non si taglia niente finché il sistema non è stabile** — tagliare mentre si bonifica
è la classe v201-v204, che in questo progetto ha morso tre volte in quattro versioni.

**Tolleranza scelta: zero difetti materiali su DUE giri consecutivi.** Un difetto è *materiale*
se cambia una conclusione; i difetti **cosmetici si annotano e NON si correggono** — ed è una
scelta misurata, non pigrizia: dei sette difetti trovati ieri, **tre li avevo introdotti io
poche ore prima correggendone altri**. La velocità di modifica è metà della sorgente di bug,
quanto l'ampiezza.

⚠⚠ **E QUESTO CONTRADDICE IN PARTE LA PREMESSA DEL CEO.** Misurato sulla provenienza: ~3 difetti
su 7 nascevano da una modifica fatta la stessa sessione, ~4 preesistevano. Ridurre le funzioni
non tocca la prima metà: quella si chiude solo **rallentando**. Ridurre le funzioni tocca invece
la seconda, perché la classe "stessa grandezza scritta in due posti" cresce col quadrato del
numero di blocchi. Per questo il congelamento viene **prima** del taglio, non dopo.

### I tre difetti materiali di questo giro — tutti trovati leggendo il pacchetto, nessuno dai gate

| difetto | cosa affermava | cosa era vero |
|---|---|---|
| **le notizie contate e poi troncate** | *"18 pubblicate DOPO l'ultima chiusura … e sono **TUTTE** elencate qui sotto"* | uno `.slice(0, 12)` sull'unione ne stampava **12** |
| **la quota di cash istituzionale** | *"7,9% (proxy AUM BIL+SHV $68B vs SPY $795B)"* | 68/795 fa **8,6%**: il denominatore vero è la SOMMA (863), e non era dichiarato |
| **il calendario delle uscite** | tre serie dichiaravano *"prossimo aggiornamento"* confermato in finestra e non comparivano; l'esclusione dichiarata nominava **tre indicatori diversi** | l'esclusione è corretta (regola v290) ma copriva **una classe su due** |

⚠ **Il primo è la v393 per una via nuova**: là spariva una CLASSE di voci, qui una CODA, e
l'intestazione afferma il contrario in entrambi i casi. Il tetto **non è stato tolto**: si è
spostato sulla classe che può tagliare senza mentire — le voci non ancora prezzate entrano
sempre, tutte, perché sono l'unica classe che cambia una decisione (v158) — e quando taglia, lo
**dichiara**.

⚠ **Il secondo è un falso positivo che il pacchetto produceva contro sé stesso**: il collaudo B5
ordina al lettore di segnalare due valori per la stessa grandezza, e qui glieli forniva il
pacchetto. *Un pacchetto che genera i falsi positivi del proprio controllo di qualità lo logora*
(classe v400, v412). Il denominatore ora si nomina **nella riga**, non nella nota della
pipeline: la nota arriva da un run che può essere vecchio, l'etichetta no.

⚠ **Il terzo è la v406 su un registro nuovo**: *"il sistema non ha il dato"* e *"ce l'ha e non te
lo passa"* si leggono uguali. Il gate è nei **due versi**, come quello pagina↔pacchetto: ogni
indicatore con una data confermata in finestra è o elencato o **nominato fra gli esclusi con la
sua ragione**. Un gate che controlla solo la presenza invecchia da solo alla prima classe nuova.

### 🧪 Lo stato si COSTRUISCE, tre volte su quattro
Nessuno dei tre fenomeni esiste nello snapshot di oggi: le voci dopo la chiusura sono **zero**,
le masse cambiano a ogni run, e un check che li leggesse sarebbe **verde per assenza del
fenomeno** — la trappola pagata quattro volte in questo file. I gate piazzano le voci **dopo
l'ultima chiusura vera**, che per costruzione è un istante già avvenuto (v402), quindi il ramo si
accende a qualunque ora giri la suite. Tutti e quattro validati per iniezione: morde ciascuno.

### 🧨 Tre trappole rifatte nella stessa mezz'ora, tutte già scritte in questo file
- ⚠⚠ **Un backtick dentro un template passato al vm**, per la QUARTA volta, e di nuovo in un
  commento che CITAVA del codice — che è precisamente quando viene naturale usare gli apici
  inversi. `modifica_sicura` **non l'ha rifiutato** perché il risultato resta sintatticamente
  valido (`` ` `` + variabile + `` ` `` concatena), ed è il caso che `node --check` non vede. La
  suite è morta **rumorosamente** all'import invece di passare a vuoto — che è il comportamento
  progettato — ma il meta-gate dei backtick vive DENTRO il file che sorveglia: quando la rottura
  è a livello di modulo, non arriva mai a girare. È `self_check` a coprirlo, perché verifica che
  ogni suite **esegua e parli**.
- ⚠ **C9 ha preso un mio imperativo nella coda** — **nona** volta (v156, v179, v180, v389, v402,
  v404, v406). Qui era un falso positivo di forma: *"il sistema … non le **elenca**"* è un
  indicativo, omografo dell'imperativo. Riformulato invece di allentare un detector che ha già
  trovato otto ordini veri: *un gate che punisce il comportamento corretto va aggiornato*
  (v199), ma non quando la correzione costerebbe di indebolirlo su otto casi per un omografo.
- ⚠ **Un pavimento alzato troppo**: `test_analisi_libro.py` **riporta** 106 check e ne contiene
  **97** come chiamate, perché alcuni girano in ciclo. Il pavimento conta i punti di chiamata,
  non i check riportati. Rimesso a 90; quello di `test_app.mjs` sale a 490 su 510.

## 🔎 v415 — PRIMO GIRO DI RICOGNIZIONE: cinque difetti, e tre erano la stessa forma

Primo dei due giri che la tolleranza scelta dal CEO richiede (*"zero difetti materiali su due
giri consecutivi"*). Cinque difetti materiali, **nessuno trovato dai gate** — tutti leggendo i
due pacchetti come il modello che li riceve, che a questo punto è una misura: in tre sessioni
consecutive la suite non ne ha trovato uno.

| difetto | cosa affermava | cosa era vero |
|---|---|---|
| **l'etichetta del credito** | *"— Mercato del Credito Rilassato"*, con la legenda delle bande | quattro righe sopra, la stessa lettura porta *"⚠⚠ MA STA AL 4° PERCENTILE … l'etichetta e il percentile dicono cose opposte"*: la copia **senza** il correttivo è quella che vince, perché è la più corta |
| **il contributo al rischio** | *"quota della varianza attribuibile a **ciascuna** posizione"* | uno `.slice(0, 6)` su **dodici**, e il taglio prendeva la coda in cui il rischio sta SOTTO il peso — GOOGL 5,7%→1,3%, PLTR 6,1%→3,3%, cioè l'altra metà del confronto per cui il blocco esiste |
| **l'autofinanziamento** | soglia dichiarata *"nessuna posizione con FCF negativo **E** interessi non coperti"* | lo stato veniva da due bande sul **peso**: due posizioni soddisfano la congiunzione, quindi la soglia stampata diceva OLTRE e la riga stampava AL LIMITE |
| **la clausola sulle revisioni** | *"(-4,37 diviso -3,42 dà +28%)"* | i valori di CRWV **al momento della v400**, stampati accanto ai valori vivi della stessa frase (-3,48 → -4,24): due coppie di stime per la stessa grandezza, in una riga |
| **due utili attesi** | entrambi *"il consenso sul prossimo esercizio fiscale"* | `stats.eps_forward` −1,95 e `analisti.eps_ora` −4,24 — **più del doppio** — e nessuno dei due campi dichiara a quale esercizio si riferisce |

### La forma comune: il pacchetto forniva da solo i falsi positivi del proprio collaudo
Tre dei cinque (credito, revisioni, utili attesi) sono **due valori per la stessa grandezza**, che
è esattamente ciò che B5 ordina al lettore di segnalare. È la classe che un LLM reale ci ha
segnalato in v409 sull'autonomia di cassa, e che la v412 aveva chiuso su una riga sola.
*Un pacchetto che genera i falsi positivi del proprio controllo di qualità lo logora*, e il costo
non è la riga sbagliata: è che chi legge smette di fidarsi anche del resto.

⚠ **Su due di questi la correzione NON è scegliere un numero.** Sull'utile atteso il sistema non
sa quale esercizio copra ciascun campo: si pubblicano entrambi, ciascuno col proprio riferimento,
e si dichiara che non è stabilito descrivano la stessa annualità — la forma della v409. *Meglio
non avere dati che averli non corretti* (v396); qui i dati c'erano entrambi, ed era l'etichetta a
affermare più di quanto potesse.

⚠ **E la clausola con i numeri scritti a mano è la TERZA incarnazione del conteggio fisso**
(v410 nella coda, v411 nella testata, ora dentro una clausola esplicativa). Un numero scritto a
mano invecchia da solo e in silenzio — e qui la coppia viva stava **due parole prima**. Non si
aggiorna l'esempio: si toglie, perché la regola non ha bisogno di numeri propri quando quelli a
cui si applica sono nella stessa frase.

### 🎯 Un gate ha trovato un difetto che non aveva in mente
Il check sui due utili attesi è andato rosso su **MSTR**, che non era il caso da cui era nato: la
dichiarazione viveva solo nel ramo della PERDITA, e MSTR ha lo stesso scarto con l'utile atteso
positivo. È la classe v412 — *una correzione applicata a un ramo e non all'altro* — presa dal
check invece che da una rilettura, che è il motivo per cui i gate si scrivono sulla PROPRIETÀ e
non sul caso che li ha originati.

⚠ **E il gate sul contributo al rischio ha nominato i sei nomi nascosti** invece di dire "manca
qualcosa": un check che riporta *quali* posizioni sono sparite costa una riga in più e vale un
giro di indagine a chi verrà dopo.

### 🧨 Due inciampi di metodo
- ⚠ **Un check che non morde è decorativo.** La prima stesura del gate sullo spread contava le
  RIGHE: il duplicato stava dentro una riga sola insieme al dato di IG, quindi il conteggio
  restava a uno e l'iniezione passava. Riscritto sulla proprietà davvero violata — il livello
  esce da un punto solo. *Quando un check non morde, la prima cosa da guardare non è il codice:
  è se la proprietà che stai verificando può essere falsa.*
- ⚠⚠ **C9 NON HA VISTO tre miei imperativi** (*"Non sommarli, non farne una media, prendilo dalla
  fonte"*): il detector riconosce certe forme e non l'imperativo negativo con clitico. Riscritti
  come fatti lo stesso — **la regola non dipende dal fatto che il gate la sorvegli**, ed è
  annotato qui che quel buco esiste invece di essere scoperto la prossima volta.
- ⚠ Un check partito su `buildPrompt()` mentre il blocco vive in `contestoPortafoglio`, cioè
  dentro `buildCIOText`: *un check sulla funzione sbagliata misura un'altra cosa* (v405).

### 📋 Annotati e NON corretti, per la regola scelta dal CEO
Difetti **cosmetici**, che non cambiano nessuna conclusione, elencati qui perché la decisione sia
sua e non una dimenticanza:
- un refuso: *"la ricerca che **il questo** pacchetto ti impone"* nel blocco notizie;
- Put/Call ed etichetta *"(Elevato)"* sul Forward P/E escono senza la propria banda di lettura;
- la riga delle scommesse effettive dice *"2,3 su 12 nomi"* mentre il libro ne elenca 13: il
  dodicesimo denominatore è dichiarato altrove (SKHY non ha abbastanza sedute in comune) ma non
  in quella riga.

> **La ragione della regola, misurata:** dei sette difetti del giro precedente, **tre li avevo
> introdotti io poche ore prima correggendone altri**. Correggere un cosmetico costa un'occasione
> di introdurre un difetto materiale, e il prezzo non vale il guadagno.

## 🕰️ v415 — UNA RIGA SU VENTITRÉ DATAVA TUTTO IL PACCHETTO, E SPEGNEVA L'AVVISO

Trovato nel secondo giro, leggendo la riga di FRESCHEZZA — quella che esiste apposta per dire
quanto sono vecchi i dati di mercato. Diceva:

> *"La barra giornaliera sotto quei numeri è del **2026-09-04**"*

mentre **22 righe azionarie su 23** portavano il **2026-09-03**, e il blocco delle notizie nello
stesso pacchetto diceva correttamente *"l'ultima chiusura USA del 2026-09-03"*.

`SEMPRE_APERTI` era `/-(USD|USDT|EUR)$/i`: prende `BTC-USD` e **manca i cambi** (`EURUSD=X`) e i
futures (`ES=F`), che Yahoo scrive col suffisso `=X` e `=F`. Un cambio scambia quasi
ininterrottamente, quindi la sua barra passa al giorno dopo molte ore prima di quella azionaria —
e prendendo il **massimo**, quella singola riga dettava la data dell'intero pacchetto.

> ⚠⚠ **IL DANNO NON ERA LA DATA: ERA L'AVVISO CHE SPARIVA.** Con età zero la riga sceglie il ramo
> rassicurante (*"la barra è del …"*) invece di quello che grida *"⚠ non sono prezzi di adesso,
> sono l'ultima chiusura, N giorni fa"*. Cioè proprio la riga scritta per misurare la vecchiaia
> dei dati li dichiarava freschi di un giorno — classe **v193/v234** (*stato del mercato e
> freschezza del dato sono due cose diverse*) dentro la riga di freschezza.

Due correzioni, entrambe già regole di questo progetto:
- **la forma del simbolo, non un elenco di nomi** (v410): `/(-(USD|USDT|EUR)|=[XF])$/i`. Un elenco
  invecchia da solo al primo strumento nuovo;
- **la data della MAGGIORANZA, non il massimo**: è quella su cui poggiano i numeri di mercato, e
  una singola riga fuori passo — un mercato estero già passato al giorno dopo, una barra arrivata
  in anticipo — non può più spostarla.

⚠ **I due gate costruiscono lo stato** invece di aspettare che i dati lo producano: iniettano un
cambio e un future avanti di un giorno, e una riga azionaria in anticipo. Sotto iniezione della
vecchia logica la data base tornava **2026-09-04**, che è la prova diretta del difetto sui dati
veri.

## 📏 v415 — LA STESSA DISTANZA DALLA MEDIA, TRE RESE NELLO STESSO PACCHETTO

Su CRWV, la distanza del prezzo dalla media a 50 sedute usciva **tre volte con tre valori**:

| dove | valore |
|---|---|
| scheda del titolo — *"Media a 50 sedute: 85.81"* | **−1,5%** |
| dettagli tecnici — *"Media semplice 50: 85.81"* | **−1,4%** |
| blocco del libro — *"medie: … dalla 50"* | **−1,45%** |

**Due cause indipendenti, e vanno chiuse entrambe:**
1. la pipeline pubblica la distanza in **due campi** con due arrotondamenti — `sma50_dist_pct`
   a una cifra, `tv.tecnica.medie.sma50.dist_pct` a due — e il pacchetto ne leggeva uno di qua e
   uno di là. **La v340 aveva già spostato il LIVELLO sulla fonte unica e lasciato indietro la
   DISTANZA**, e la v407 aveva chiuso il caso sul solo blocco del libro: terza incarnazione;
2. l'helper dei dettagli tecnici **ri-arrotondava** a una cifra un valore che la fonte pubblica
   a due — e `Math.round(-14.5)` in JS dà `-14`, quindi −1,45 usciva −1,4 e non −1,5.

> ⚠⚠ **E IL GATE v414 NON LA PRENDEVA, per cinque millesimi.** La sua tolleranza è 0,051 e lo
> scarto fra −1,45 e −1,5 è esattamente 0,05. Una tolleranza tarata su "due arrotondamenti
> legittimi possono differire" è giusta fra grandezze calcolate in due modi, ed è **sbagliata**
> fra due rese della STESSA grandezza dalla STESSA fonte: lì devono coincidere, non somigliarsi.
> Il gate nuovo pretende l'identità e ha morso su entrambe le cause, iniettate una alla volta.

⚠ Il ripiego sul campo di riga resta per le posizioni che la pipeline non ha mai visto: lì
`tv.tecnica` non esiste, e una riga in meno sarebbe peggio di una cifra in meno.

## 📐 v415 — UNA PERCENTUALE A TRE CIFRE CALCOLATA SU UN NUMERO CHE IL PACCHETTO CHIAMA RUMORE

Sul canale tassi di CRWV il pacchetto diceva, a quattro righe di distanza:

> · finestra lunga — beta +0.21, R² 0 … → **NESSUNA relazione misurabile su questa finestra**
> · quando il canale si muove FORTE — beta +0.47 … ed è il **124% PIÙ AMPIO** di quello della
>   finestra lunga

Cioè una percentuale calcolata su una base che il blocco stesso, nella propria nota di chiusura,
definisce *"rumore stimato con tre decimali"*. La guardia c'era — `Math.abs(beta) > 0.05` — e
guardava la **GRANDEZZA** del beta, non la sua **MISURABILITÀ**.

> ⚠⚠ È la metà mancante della **v316**: *un beta senza il suo R² è mezzo numero*, applicata al
> **rapporto fra due beta**. Un rapporto di cui un termine non è misurabile non è un numero
> imperfetto: non è un numero. E qui il difetto era peggiore che altrove, perché il canale tassi
> su un titolo che costruisce a debito è esattamente quello su cui un lettore cerca una cifra.

Ora il confronto esce **solo se entrambi i termini stanno sopra il proprio pavimento del rumore**;
sotto, la riga dichiara che non è affermabile e dice quale dei due manca — *un numero fuori
orizzonte è peggio di nessun numero* (v199).

### 🦴 E il gate della v403 PINNAVA il difetto — ventiseiesima rottura, la specie peggiore
Pretendeva `220% PIU' AMPIO` sul canale `tassi` della fixture, **la cui finestra lunga sta sotto
il pavimento** (R² 0,007 contro 0,015): esigeva letteralmente la percentuale calcolata su un beta
non misurabile. *Un gate che pinna un difetto lo rende permanente* (v326, v411).

L'invariante non è cambiato — quando i due beta SONO misurabili il confronto esce in cifre — ma
ora il check **costruisce** quello stato invece di prenderlo da una fixture che rappresenta il
caso opposto. La fixture condivisa resta intatta: serve al caso *"canale acceso solo di recente"*
della v401 e al gate nuovo, che misura il ramo dichiarato.

⚠ Il gate nuovo, iniettando la rimozione della guardia, morde su **quattro canali** dei dati veri
(MU/tassi, AMD/tassi, NVDA/tassi, NVDA/dollaro) e li nomina uno per uno.

## 🏷️ v415 — `[MRVL]` SIGNIFICA "TROVATA NEL FEED DI MRVL", NON "NOTIZIA SU MRVL"

Misurato sul run del 04/09: delle quattordici voci mostrate nel blocco delle notizie sui titoli
del libro, **quattro erano su un'altra società** — un pezzo su Nvidia sotto `[CRWV]`, uno su
Astera Labs e uno su Penguin Solutions sotto `[MRVL]`, una cronaca di mercato con Tesla e Goldman
sotto `[MU]`.

**Non è un difetto della raccolta.** La v399 ha scelto Nasdaq proprio perché *l'attribuzione viene
dalla FONTE invece che da un'euristica nostra*, e i feed dei fornitori includono regolarmente
pezzi su concorrenti e sul comparto. Il difetto era l'**ETICHETTA**, che affermava più di quanto
il dato sostenga: `[MRVL]` si legge *"notizia su MRVL"* e significa *"voce trovata nel feed di
MRVL"*.

> ⚠ **E non si filtra.** Filtrare vorrebbe dire indovinare di chi parla un titolo, che è
> esattamente l'euristica che la v399 ha rifiutato scegliendo Nasdaq invece del feed multi-ticker
> di Yahoo. Si dichiara cosa l'etichetta è, e chi legge ha il titolo dell'articolo davanti.

⚠ Una voce su un'altra società **resta informativa per il canale** — è la ragione per cui il
blocco esiste (v398: l'LLM non conosce il libro) — ma non è attribuibile al nome sotto cui compare.

### 🧪 E il mio primo gate era DECORATIVO
Cercava tre forme letterali (`titolo.indexOf(TK`, …) e l'iniezione realistica —
`String(v.titolo).toUpperCase().indexOf(TK)` — non ne matchava nessuna: restava **verde col
difetto dentro**, e a morderlo era il gate v398 sull'ESITO. È la trappola numero uno di questo
file, l'ancoraggio a una stringa letterale, commessa **dentro un gate scritto per impedirne
un'altra**. Ora guarda la proprietà: una riga che mette in relazione il TITOLO dell'articolo col
ticker, in qualunque forma.

> **Quando un'iniezione non morde e un ALTRO gate sì, il proprio gate non è ridondante: è rotto.**

⚠ E una sonda sulla chiave sbagliata: `DATA.macro.news_titoli` non esiste — la chiave sta alla
radice ed è `per_titolo`, non `per_ticker`. Un check su una chiave che non c'è è verde (o rosso)
per assenza di dati invece che di difetti, ed è già costato in v196 e v229.

## 🕐 v416 — SEI RIGHE DICEVANO "OGGI" SU UNA BARRA CHE IL PACCHETTO DICHIARA DI IERI

Trovato nel giro successivo, sui dati freschi del CI. Il pacchetto diceva, a poche righe di
distanza:

> ⚠ LA BARRA GIORNALIERA SOTTO QUEI NUMERI E' DEL **2026-09-03** — 1 giorno fa … **non sono
> prezzi di adesso**
>
> Semiconduttori (SOX) 11.352 (+0,11% **oggi**) · Rame 6,67 $/lb (+1,47% **oggi**) · Petrolio
> WTI 90,69 $ (−0,67% **oggi**) · Oro 4524 $/oz (+0,72% **oggi**) · EUR/USD 1.1627 (+0,36%
> **oggi**) · VIX … · **oggi** −0,84%

È la classe **v193/v234** — *stato del mercato e freschezza del dato sono due cose diverse* — e
la correzione della v193 era arrivata alla riga del VIX **del quadro macro** e non a queste tre
sedi: la classe v412, una correzione applicata a un ramo e non agli altri. Il collaudo B5 ordina
a chi legge di segnalare le contraddizioni interne, e qui gliele forniva il pacchetto.

⚠⚠ **E NON SI SCRIVE UNA DATA.** Gli strumenti hanno barre di sedute diverse — un cambio passa
al giorno dopo molte ore prima di un'azione, ed è precisamente il fatto misurato in v415 — quindi
affermare UNA data per tutti sarebbe lo stesso difetto appena chiuso. *"Nell'ultima seduta"* è
vero per ciascuno, e **quale** sia quella seduta lo dice la riga di freschezza.

⚠ Il gate è **indipendente dall'orologio**: non "oggi è vietato quando la barra è di ieri", che
andrebbe rosso o verde a seconda del giorno in cui gira la suite (v402), ma *una variazione di
seduta si nomina per la seduta, mai con un avverbio che afferma quando*. E un secondo gate
verifica che la variazione **resti pubblicata**: un check sulla sola assenza passerebbe anche se
la riga sparisse (v406).

### 🕳️ E il difetto vero di questo giro era NEL GATE, non nel sistema
Il check v414 sulla quota di cash istituzionale è andato **rosso sui dati nuovi, su codice
corretto**. Causa: iniettava su `macro.liquidity`, mentre la chiave è **`macro.liquidity_split`**
— quindi il payload usava i dati veri e il check passava solo perché il valore reale coincideva
per caso con quello iniettato (68/863 = 7,9 su entrambi). Il run del CI ha cambiato le masse
(68/880 = **7,7**) e ha smascherato il finto verde.

> **Seconda sonda sulla chiave sbagliata in una sessione** (la prima su `news_titoli`, alla
> radice invece che sotto `macro`), e **l'ho annotata la prima volta senza che questo bastasse a
> impedire la seconda**.

⚠⚠ **E riscrivendolo l'ho trovato CIRCOLARE**: iniettava la nota *nuova* — quella che il
denominatore lo nomina già — e poi accettava la dichiarazione trovata in qualunque punto della
riga, quindi leggeva la **propria iniezione** invece del codice e restava verde anche togliendo
l'etichetta. Ora inietta la nota **vecchia**, così il denominatore può venire da un posto solo:
l'etichetta, che è esattamente ciò che il codice deve garantire.

⚠ Quinta volta con un **backtick dentro un template passato al vm**, di nuovo in un commento che
citava una chiave fra apici inversi. `modifica_sicura` ha rifiutato **entrambe** le scritture e
il file è rimasto intatto — lo strumento ha fatto il lavoro per cui esiste.

## 🔭 v417 — LA TESTATA DICEVA "LE FINESTRE SONO DUE" E LA CODA NE PUBBLICAVA TRE

Ottavo giro di ricognizione. La v403 ha aggiunto il **terzo sguardo** — la regressione sul quinto
di sedute in cui il canale ha l'escursione maggiore — e la testata non l'ha **mai nominato**:
continuava a dire *"⚠⚠ E LE FINESTRE SONO DUE"*. Chi legge viene istruito che le letture sono due
e ne trova tre su tutti e quattro i canali, quindi tratta la terza come rumore o la salta — ed è
proprio il blocco aggiunto per la domanda che un libro a leva pone (*"il giorno che i tassi
saltano, quanto perdo"*), cioè quello che serve di più.

È la classe **v413** — la testata che contraddice la propria coda — e **la v403 l'ha prodotta
senza accorgersene**, aggiungendo alla coda senza toccare le istruzioni che la descrivono.

⚠ Si dice anche **cosa è**, perché non è una terza finestra ma un **sottoinsieme**: il suo R² ha
un altro denominatore e la coda lo dichiara riga per riga. Chiamarlo "finestra" inviterebbe a
confrontarlo con gli altri due, che è precisamente l'errore che quella dichiarazione esiste per
impedire.

⚠ **Il gate lega le DUE parti**: se la coda rende il terzo sguardo, la testata deve nominarlo E
dichiararne la natura. Un gate su una parte sola invecchia appena l'altra cambia — validato
iniettando entrambe le metà.

### 🔬 Il resto del giro è stato meccanico, e non ha trovato niente
Invece di un'altra lettura lineare ho attaccato la classe dominante con degli scanner:
- **coppie di campi che la pipeline pubblica per la stessa grandezza**: 39 divergenze
  (`sma50_dist_pct` a una cifra contro `tv.tecnica…dist_pct` a due) — reali, ma dopo la v415 il
  payload ne legge **una sola**, quindi non arrivano a chi legge;
- **conteggi dichiarati contro elementi elencati**: 4=4 sull'autofinanziamento, 5=5 sullo stato
  complessivo, 8=8 sul gruppo correlato, 5=5 sull'approfondimento, 12 voci di contributo al
  rischio che sommano a 100,1% col peso escluso dichiarato.

⚠⚠ **E tre "difetti" segnalati dai miei scanner erano artefatti delle mie regex** — si fermavano
al primo `)` o `.` interno alla riga. *Un allarme va verificato contro il testo vero prima di
diventare una correzione*: è il rovescio della regola sulle iniezioni che non mordono, e qui mi
avrebbe fatto "correggere" tre righe corrette.

### 🦴 Un ramo morto, annotato e NON rimosso
Il ripiego sul campo di riga per la distanza dalle medie è **strutturalmente irraggiungibile**:
`sma50_dist_pct` richiede ≥50 barre e `batteria_tecnica` ne richiede ≥30, quindi chi ha il primo
ha sempre il secondo (misurato: 23 righe su 23). È la classe **v234** — *un ramo che non può
essere raggiunto non è una protezione* — ma rimuoverlo è un **taglio**, e il congelamento lo
vieta finché il sistema non è stabile. Annotato qui per la fase di potatura.

## ✂️ v418 — LA PRIMA POTATURA, E L'HA DECISA UNA MISURA

Decisione del CEO dopo la misura: *"A se non è gratis non possiamo consentirlo"*. Quindi non un
taglio con perdita — **il taglio è stato reso gratuito prima di essere fatto**.

### La misura che l'ha deciso: perturbazione, non impressione
Si cambia un campo nei dati e si conta in quanti **BLOCCHI distinti** del pacchetto cambia
qualcosa. Un campo che tocca tre blocchi è un fatto scritto in tre posti, cioè tre occasioni di
divergere.

| | 1 blocco | 2 blocchi | **3 blocchi** |
|---|---|---|---|
| pacchetto **macro** | 7/13 | 4 | **0** |
| pacchetto **titolo**, prima | 5/13 | 3 | **5** |
| pacchetto **titolo**, dopo | 6/13 | 5 | **2** |

⚠⚠ **E QUESTO HA CORRETTO UNA MIA RACCOMANDAZIONE.** Avevo scritto due volte al CEO che "ridurre
i blocchi rende impossibile la classe", come se valesse ovunque. **Nel pacchetto macro la
duplicazione era già sparita** — nessun campo raggiunge tre blocchi — e lì non c'era niente da
potare. La leva vera era piccola e stava tutta nel pacchetto di titolo.

### Il taglio: il titolo analizzato era descritto TRE volte
La sua scheda, il blocco DETTAGLI TECNICI, **e la sua riga dentro l'elenco del libro**. È
esattamente il terzetto che ha prodotto il difetto v415, dove la stessa distanza dalla media
usciva `-1,5% / -1,45% / -1,4%`.

Delle nove grandezze che quella riga portava, **otto erano già nei due blocchi sopra** e una no:
la distanza dal massimo a 52 settimane nel verso *"quanto è già sceso"*. Quella è stata
**spostata prima** — la scheda ora pubblica anche il verso opposto, dichiarando che è lo stesso
fatto e non un secondo dato — e solo dopo la riga è stata tolta.

⚠ **Nel pacchetto MACRO non si tocca niente**: lì quella riga è l'unica descrizione tecnica che
il titolo riceve, e toglierla sarebbe una perdita invece di una potatura. Il taglio vale SOLO
dove la duplicazione esiste.

⚠ **E l'escluso si NOMINA** (v406): la riga dichiara chi manca, perché, e dove stanno gli stessi
numeri in forma più estesa. *"Il sistema non ha il dato"* e *"ce l'ha e non te lo passa"* si
leggono uguali.

### 🦴 Tre gate sono andati rossi, e nessuno è stato zittito
Confrontavano la scheda con la riga del libro, che non esiste più nel pacchetto di titolo. A
ciascuno è stato **riagganciato l'invariante**, non allentato:

- **v414** — l'invariante non era "scheda contro libro" ma *due sedi che descrivono lo stesso
  titolo non divergono*. Le sedi rimaste sono due e il confronto resta, **allargato ai LIVELLI**
  delle medie, che sono precisamente ciò che divergeva nella v340. Validato per iniezione.
- **v413** — ora raccoglie tutte le occorrenze del conteggio dei giorni **nei DUE pacchetti** e
  pretende che concordino: più forte di prima, non più debole.
- ⚠⚠ **v316 era rotto DAL MIO TESTO**: cercava la frase `DETTAGLI TECNICI`, che compare anche
  nella riga che DICHIARA l'esclusione — quindi la trovava pure quando la sezione non c'era. Le
  altre due sonde dello stesso check erano già ancorate all'intestazione (`--- COME IL MACRO
  ARRIVA A`); questa no. **Chi cerca l'ASSENZA di una sezione guarda la sua INTESTAZIONE**, non
  una frase che la nomina: sesta incarnazione del gate che trova sé stesso (v213, v240, v393, v395).

⚠ **Decima volta che C9 prende un mio costrutto nella coda**: `Ripeterli` è un infinito con
clitico, non un imperativo, ma il detector non li distingue. Riformulato invece di allentare un
gate che ha già trovato nove ordini veri.

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
