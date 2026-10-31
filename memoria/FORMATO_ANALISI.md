# Formato dell'analisi del libro (deciso dal CEO il 04/10/2026)

Il CEO chiede l'analisi **ogni giorno, in chat**. Nessuna Routine settimanale: sarebbe un
doppione. Il formato è quello del rapporto «da comitato d'investimento» del 02/10/2026, ridotto
alla misura di un giorno.

## Quando il CEO scrive «Analisi» o «Aggiorna analisi» (istruzione del 09/10/2026)
*"Quando ti dico aggiorna analisi devi darmi tutte le informazioni che ti ho chiesto di rendere
strutturali."* Quindi **«Analisi» e «Aggiorna analisi» = il formato COMPLETO, sezioni 0-7, ogni
volta**, anche a un'ora dall'ultima. Una sezione senza novità si scrive in una riga («invariato:
…»), **non si salta**. Solo «sintetizza» o «in poche righe» autorizzano la forma breve.
Il 09/10 alle 20:22 un aggiornamento è uscito senza la sezione 7: da qui il comando unico.

**Dal 19/10 la risposta ha DUE parti** (v505, decisione del CEO: *«B»*, dopo *"Ho la sensazione che questa analisi si
apriva di tante parti strutturali che ci diceva di inserire, ma che in realtà non ci sono vengono riportate in questo
report"* — misurato: 16 richieste su 43 portate per intero, 18 ridotte, 9 per niente):
- **in chat**: le sezioni 0-7 con le DECISIONI, ciò che è CAMBIATO e il GIUDIZIO — chi va guardato e perché, cosa
  fare o non fare, le notizie cercate in rete con fonte e data, le conseguenze dei numeri;
- **la SCHEDA COMPLETA, allegata ogni volta**: la scrive `scripts/scheda.py` (la lancia il comando unico) con le
  uscite di tutti gli strumenti, parola per parola, per sezione e per NOME, e in testa l'indice delle richieste rese
  strutturali con quanti nomi portano ciascuna. Non costa token: è lo script a scriverla, non la risposta.
La completezza non dipende più dal riassunto: la porta la scheda, e un gate verifica nei due versi che ogni richiesta
del registro qui sotto abbia la sua sezione.

**Il comando: `python3 scripts/analisi.py`** (v473). Esegue in parallelo tutti gli strumenti
qui sotto, sceglie da solo pre-market / seduta / after-hours dall'ora di New York, dichiara lo
strumento che fallisce e chiude con la CHECKLIST — la sezione «Cosa contiene la risposta» di
questo file, stampata parola per parola. Un gate verifica che gli strumenti del comando siano
esattamente quelli nominati qui sotto: uno strumento nuovo si aggiunge in tutti e due i posti.

## Come si produce
00. `python3 scripts/fonti_dirette.py` — **FRESCHEZZA DEI DATI** (v511, decisione del CEO del 25/10/2026: *"i dati in
   ritardo … Elimina le dipendenze e cercale altrove se puoi. Non voglio tornare ai vecchi problemi"*). Gira PRIMA di
   tutti gli altri: legge alla fonte, all'ora dell'analisi, le serie macro che il semaforo, il brief e gli indici usano
   — Treasury e TIPS a 10 anni, curva, HY OAS, CCC, NFCI, SLOOS, CPI, disoccupazione, posti di lavoro (FRED, il CSV
   pubblico senza chiave), l'EFFR (NY Fed), il cambio EUR/USD (riferimento BCE, datato), il Fear & Greed (CNN) — con le
   STESSE derivazioni della pipeline (la libreria `comuni.py`), e scrive la lettura che gli altri strumenti riusano. Per
   ogni serie dice chi l'ha servita (la fonte o la pipeline come ripiego), la sua rilevazione e come sta la pipeline
   rispetto alla fonte; per la pipeline l'età del run e se è precedente all'ultima chiusura USA, con l'elenco di ciò
   che porta solo lei (target e revisioni, sensibilità, CDS, short, bilanci SEC, leva, BTP): quelle righe descrivono la
   seduta prima, e la risposta lo dice.
00bis. `python3 scripts/fonti_titoli.py` — **DATI PER TITOLO** (v512, CEO del 25/10/2026: *"target degli analisti,
   FedWatch, storico dei CDS, vendite allo scoperto, bilanci SEC della pipeline se non sono aggiornati … trovali altrove
   anche attraverso news; dati non aggiornati non sono affidabili"*). Gira PRIMA degli altri, insieme alle fonti dirette:
   rilegge alla fonte, con le STESSE funzioni della pipeline, target e revisioni degli analisti (Yahoo), FedWatch (future
   per esteso e EFFR), il CDS dell'ultimo giorno (ICE: se la pipeline è indietro le misure si rifanno, e il giorno che lo
   storico non ha si conserva per lei), le vendite allo scoperto (FINRA), le date dei 10-Q e 10-K; e dove la tabella dei
   trimestri della pipeline è ferma prima di un deposito di risultati prende il trimestre da Nasdaq, solo se le due fonti
   danno gli stessi numeri sul trimestre in comune. Gli strumenti dopo di lui leggono quei dati. Stampa ogni quanto cambia
   ciascun dato e la lista **DA CERCARE IN RETE**: dove nemmeno la fonte è aggiornata.
   **Il comunicato ufficiale** (v513, scelta del CEO del 25/10/2026: *"A"*): dove Yahoo e Nasdaq non concordano sui ricavi
   (le banche) o nessuna delle due porta ancora il trimestre, DA CERCARE IN RETE chiede il comunicato della società. La
   risposta lo cerca (l'8-K con l'Exhibit 99.1 su SEC, o la pagina dei risultati), ne trascrive i numeri in
   `memoria/trimestri_ufficiali.json` **come il comunicato li stampa** — ricavi, utile, risultato operativo, ciascuno con
   la voce che lo porta, e i confronti **DEL COMUNICATO STESSO** (l'anno prima e il trimestre prima), il link, la data e
   il giorno della verifica — e rilancia l'analisi: da lì il trimestre entra nelle schede e nella tenuta. ⚠ Un trimestre
   del comunicato non si confronta MAI con la tabella di un altro fornitore: su JPM il 2° trimestre 2026 vale 57,347
   miliardi nel comunicato e 52,852 in Yahoo, e una variazione fra i due misurerebbe la definizione. ⚠ Un intervallo di
   stime o un risultato preliminare non è un numero del trimestre: va nella lista `preliminari` del registro, così lo
   strumento non lo chiede di nuovo. Un trimestre registrato non cambia: la ricerca si fa una volta per trimestre e nome.
0. **Prima dell'apertura americana (prima delle 15:30 italiane) l'analisi parte dal PRE-MARKET**
   (istruzione del CEO, 06/10/2026): `python3 scripts/numeri_libro.py --esteso` — risultato del
   libro sul prezzo esteso, livelli ricalcolati su quel prezzo, titoli che fuori sessione stanno
   già oltre resistenza o supporto. Dopo la chiusura lo stesso comando dà l'after-hours.
   ⚠ Il pre-market ha volumi sottili: è un'indicazione dell'apertura, non un prezzo su cui decidere.
1. `python3 scripts/numeri_libro.py` — l'ultima seduta (`--sedute 5` per la settimana).
   Lo script CALCOLA e basta; il giudizio lo scrive il modello. Da v474 (decisioni del CEO del
   09/10) apre col **SEMAFORO D'USCITA calcolato** (sei famiglie, la reazione letta da `LIBRO.md`
   §1ter), porta il **REGISTRO DELLA PERFORMANCE** contro QQQ (`--registra` scrive la riga della
   seduta conclusa, mai durante la seduta: lo passa il comando unico) e le **DECISIONI APERTE**
   (`LIBRO.md` §1quinquies) col costo dell'attesa dalla conferma. Da v481 (decisione del CEO del
   14/10) chiude con la **TENUTA DELLE POSIZIONI** (`LIBRO.md` §1sexies): da v482 un bilancio
   dell'evidenza — per ogni posizione le prove CONTRO e A FAVORE (tendenza, stime, revisioni,
   ricavi, bilancio, macro), l'esito, il consenso degli analisti come opinione accanto, il pareggio
   fiscale e, per chi è in perdita, l'aritmetica della media.
   Da v489 (conversazione del CEO del 15/10, *"rendi questa conversazione di oggi parte strutturale
   dell'analisi globale"*) porta anche gli **ORDINI APERTI** (`LIBRO.md` §1septies) e, per ogni
   posizione, i **pavimenti** con la **media sui pavimenti** sotto il carico. Da v500 (CEO, 18/10)
   accanto ai pavimenti di ogni posizione e di ogni ordine il **VWAP dall'ultima trimestrale**.
2. `python3 scripts/brief.py` — notizie, mossi in ATR, livelli, macro, e (v470) le aste di
   note e bond del Tesoro USA dei prossimi 7 giorni con l'ora italiana e gli esiti recenti.
3. `python3 scripts/schede_progetto.py` (v462, su richiesta del CEO del 06/10) — per ogni nome
   del libro i blocchi che la pipeline pubblica: sensibilità a mercato, comparto, tassi e
   dollaro col loro R² (anno, trimestre, giornate forti), revisioni delle stime, autonomia di
   cassa e copertura degli oneri per chi brucia cassa, short interest, ultimo deposito SEC, e da
   v492 (CEO, 16/10: *"inserisci anche il fattore P/e come metrica di analisi delle azioni"*) la riga
   **valutazione** (da v517 anche il **PEG sull'esercizio prossimo**: P/E sul consenso dell'esercizio prossimo
   diviso la crescita del consenso dall'esercizio in corso, oltre il 100% dichiarato distorto; accanto, mai al posto,
   quello dell'aggregatore): P/E degli ultimi 12 mesi e prospettico con l'utile per azione, la perdita detta
   come perdita (nessun P/E, e prezzo/ricavi al suo posto), i due utili attesi quando differiscono,
   il PEG con la sua riserva; il riferimento dell'S&P 500 una volta in testa, con fonte e data.
   Da v497 (CEO, 17/10: *"Monitora anche per le azioni in portafoglio e quelle in watchlist l'andamento dei
   Credit default swap"*) la riga **CDS 5 anni** di ogni nome: lo spread a 5 anni dal prezzo di fine giornata che
   ICE Clear Credit pubblica gratis, la variazione a 5, 21 e 63 giorni quando lo storico raccolto li copre, il
   multiplo dell'indice CDX della stessa cedola; «nessun CDS compensato» per chi il mercato non quota; in testa gli
   indici CDX e la Repubblica Italiana per il BTP. Il FATTO è il prezzo, i punti base sono una conversione.
   Da v501 (CEO, 18/10: *"Analizza e monitora la salute finanziaria delle aziende … Monitora anche Altman Z-Score"*)
   il blocco **SALUTE DEL CREDITO**: in testa i SEGNALI di tutti i nomi — eventi del CDS (rincaro improvviso in una
   settimana, allargamento in un mese, rincaro anomalo per il nome, DIVERGENZA quando il titolo negli stessi giorni
   non fa peggio di QQQ) e condizioni di bilancio (Altman in zona di pericolo, quota corrente oltre la liquidità) —
   poi per ogni nome la probabilità d'insolvenza implicita nel CDS, lo Z'' di Altman con il rating equivalente, la
   frequenza storica d'insolvenza a 1, 3, 5 e 10 anni e l'anno in cui il rischio si concentra, e il debito: totale,
   quota a 12 mesi contro la liquidità, costo approssimato, copertura degli oneri e, dai 10-Q e 10-K, scadenze per
   anno, tasso medio, valore di mercato del debito, linee di credito, derivati sui tassi (regole in `LIBRO.md`
   §1novies). Rendimenti delle obbligazioni, asset swap spread e Z-spread non sono disponibili gratis: si dice.
   Da v504 (CEO, 18/10 sera: *"tieni conto della differenza tra solidità operativa da cash flow e solidità
   patrimoniale statica. Rendila strutturale"*) in testa al blocco di ogni nome la riga **solidità**: PATRIMONIALE (il
   bilancio a una data: Altman) e OPERATIVA (la cassa dell'attività in 12 mesi, dai segni dei flussi: si autofinanzia ·
   fa cassa ma non copre gli investimenti · consuma cassa), col rischio storico e il **rendimento del prezzo** accanto,
   e quando le due dicono cose opposte lo scrive; poi la riga **cassa dell'attività** (flusso operativo dei 12 mesi e
   dell'ultimo trimestre, se l'utile diventa cassa, il ciclo di cassa contro un anno prima, il magazzino, quanto va
   agli azionisti), e nella riga di Altman da dove vengono un circolante o un patrimonio negativi.
   Da v506 (CEO, 19/10: *"Analizza anche azioni allo scoperto ovvero attività short in % sui titoli qualora tu non lo
   faccia già e rendila strutturale"*) il blocco **VENDITE ALLO SCOPERTO** in testa e la riga **short** di ogni nome:
   le posizioni corte APERTE dal consolidato di FINRA — in % del flottante, coi giorni di scambi per ricoprirle, la
   variazione sul regolamento precedente e in tre mesi col titolo negli stessi giorni, il percentile dei regolamenti
   dell'anno — con la data del regolamento e la prossima pubblicazione dal calendario UFFICIALE di FINRA. Prima la riga
   portava la quota di Yahoo senza data e il flusso giornaliero, che è il DPI del dark pool: tolti, una resa sola.
   Da v514 (CEO, 25/10: *"Inserisci anche un'analisi del flottante, se è utile"*) il blocco **FLOTTANTE E
   DILUIZIONE** in testa e la riga **flottante** di ogni nome: le azioni in circolazione a fine trimestre dallo stato
   patrimoniale, con la data, e la loro variazione sull'anno e sul trimestre trovata per data — cioè **quanta società
   in meno possiede ogni azione** —; il flottante (Yahoo, senza la data della rilevazione), sul totale del bilancio
   quando la fonte conta meno azioni (più classi: CBRS 98% per Yahoo, 48% sul bilancio); quanta parte del flottante si
   scambia a seduta, sulle sedute concluse, con la mediana del giorno; la data di quotazione. La parte che cambia la
   lettura è la diluizione: una crescita dei ricavi del 25% con il 25% di azioni in più non arriva a chi tiene
   un'azione. ⚠ I **vincoli di vendita dopo la quotazione** (lock-up) stanno nel prospetto, con scaglioni e
   condizioni, e il sistema non lo legge: per un nome quotato da meno di 540 giorni che entra in posizione o fra gli
   ingressi, la risposta cerca il calendario nel prospetto o in un deposito della società, con fonte e data — mai dalle
   ricostruzioni dei giornali, che il 25/10/2026 non concordavano fra loro né per SpaceX né per Cerebras. È
   informazione, non una prova della tenuta.
   Entra SEMPRE nei punti 3-5 della risposta: un canale sotto il rumore si dice non
   misurabile, una revisione si legge dalla differenza. ⚠ Il FedWatch si legge dal blocco DATI PER
   TITOLO: dalla v477 viene dai contratti per esteso di ciascun mese con l'EFFR del giorno (il continuo
   `ZQ=F` della v450 non si usa più), letti all'ora dell'analisi. Si affianca ai mercati di previsione
   con verifica online; se le due letture divergono oltre un movimento intero si dichiara (v450).
4. Ricerca web sulle notizie che spiegano i movimenti, con fonte e data.
5. `python3 scripts/rotazione.py` (v468, istruzione del CEO del 07/10: *"questa analisi deve
   essere strutturale e aggiunta sempre"*) — i 21 ETF settoriali e i primi cinque titoli di
   ciascuno su prezzi DI OGGI, con distanza dalle medie in ATR, supporto/resistenza e
   correlazione col libro. ⚠ Mai la tabella `macro.tilt` della pipeline per i numeri: è ferma
   al proprio run. Da lì viene solo la composizione degli ETF.
   Di default stampa SOLO i candidati per settore (v469, istruzione del CEO): medie 20/50/200
   con livelli, distanza in ATR e pendenza, andamento a 1 e 3 mesi, RSI, volumi come PERCENTILE
   dell'anno 0-100 (v472: ultima seduta conclusa e media a 20; 0 = minimo, 50 = norma, 100 = massimo), supporto/resistenza e notizie del feed
   del simbolo. Da v471 ogni titolo porta anche target degli analisti (dalla pipeline, n.d. se
   non seguito), beta sull'S&P 500 col suo R², volatilità annua; e stampa la WATCHLIST del
   libro con le stesse misure. I volumi escludono la seduta in corso. Da v473 la watchlist esce
   per gruppi (candidati · diversificano · stessa scommessa) col piano d'ingresso di ciascun nome:
   zona, livello, primo segnale, stop, base, trimestrale, revisioni, nota del CEO.
   `--tutti` dà la tabella completa. Per ogni settore con candidati la risposta
   aggiunge il CONTESTO MACRO del settore da ricerca web, con fonte e data.
   Da v481 ogni sorvegliato porta la riga **«tenuta se fosse in portafoglio»**: la stessa regola
   delle posizioni (`LIBRO.md` §1sexies), letta da chi il nome non lo possiede — da v482 con le
   prove nei due versi.
   Da v487 ogni sorvegliato porta i suoi **PAVIMENTI** (decisione del CEO del 15/10: entrare sui minimi,
   non sulla risalita), e il piano per la liquidità il gruppo **SUI PAVIMENTI**.
   Da v492 (CEO, 16/10: "Si" alla lettura a 5 anni in ogni ingresso, e il P/E come metrica) ogni
   sorvegliato e ogni candidato porta la **LETTURA A 5 ANNI** — medie a 30, 50 e 200 settimane con la
   pendenza, massimo e minimo con la data, posizione nell'intervallo, quota del rialzo restituita, sulla
   serie della società di oggi (anche il veicolo di quotazione si taglia, dal registro SEC) — e la riga
   **valutazione** col P/E. Gli ordini aperti e la media delle posizioni in perdita (`numeri_libro.py`)
   portano la stessa lettura a 5 anni: anche quelli sono ingressi.
   Da v474 chiude col **PIANO PER LA LIQUIDITÀ**: la liquidità con la sua quota del patrimonio e,
   per ogni ingresso possibile (sorvegliati e candidati di settore), cosa fa al libro un'unità di
   5.000 € — volatilità, beta su QQQ, perdita allo stop — anche per chi è nella stessa scommessa.
6. `python3 scripts/posizionamento.py` (v496, CEO, 17/10: *"Effettua anche analisi su put e call e sui grandi
   movimenti che vengono effettuati il week end … Rendi sempre tutto strutturale"*; i movimenti scelti: scadenza delle
   opzioni, posizioni dei grandi operatori, bitcoin nel weekend) — il **put/call di mercato** pubblicato da CBOE col
   suo percentile sull'anno (le sedute lette restano in `memoria/cboe_putcall.jsonl`); le **scadenze delle opzioni**
   dalle date che la borsa lista: la prossima mensile, la trimestrale («tre streghe»), la mensile appena scaduta, e
   per SPY e QQQ quanta parte dell'open interest scade; per ogni posizione le **opzioni**: put/call dei volumi e
   dell'open interest, volatilità implicita a 30 giorni, movimento implicito alla prima scadenza, alla mensile e fino
   alla scadenza che comprende i conti, il massimo open interest dentro il movimento, le più scambiate fuori dal
   denaro e la loro storia (`memoria/opzioni_titoli.jsonl`: i percentili da 20 sedute registrate); i **grandi
   operatori** dal rapporto settimanale della CFTC — fondi a leva, gestori istituzionali, dealer su Nasdaq-100, S&P
   500, VIX, bitcoin e Treasury 10 anni — col percentile su tre anni; il **bitcoin dall'ultima chiusura USA** e
   quanto vale su MSTR con la sensibilità misurata. Le due memorie si committano col registro.
   Da v499 (CEO, 17/10 sera: *"Valuta se puoi inserimento dei movimenti del darkpool"*, con un video che usa i
   livelli GEX) anche la **GAMMA DEI DEALER** stimata dalle catene complete di CBOE — gamma netta e regime
   (positiva smorza i movimenti, negativa li amplifica), cambio di regime, call wall e put wall — per le posizioni e
   per SPY, QQQ e IWM; e il **DARK POOL**: il rapporto delle vendite allo scoperto fuori borsa (FINRA, ogni sera)
   per posizioni, sorvegliati e ETF degli indici, col percentile dell'anno e la media a 10 sedute
   (`memoria/dark_pool.jsonl`), più il DIX e la GEX dell'S&P 500 di SqueezeMetrics. Due convenzioni, dichiarate:
   chi detiene le opzioni non si osserva, e leggere come acquisto un rapporto alto è il modello di SqueezeMetrics.
7. `python3 scripts/indici.py` (v499, CEO, 17/10 sera: *"Monitora anche Nasdaq e sep ed il relativo pe e altri
   parametri di analisi che ritieni utili"*) — S&P 500 e Nasdaq-100: il **P/E con la storia della sua fonte**
   (prospettico dell'S&P 500 da FactSet con le sue medie a 5 e 10 anni; ultimi 12 mesi e CAPE da multpl con le
   mediane a 5, 10 e 20 anni calcolate sulla stessa serie; Nasdaq-100 dal WSJ, la cui storia si raccoglie in
   `memoria/indici.jsonl`), il premio sul Tesoro (convenzione), la **stagione delle trimestrali** dell'S&P 500
   (FactSet: quante hanno riportato, quante battono le attese, la crescita degli utili), la **volatilità
   implicita** (VIX, VXN, VIX3M e la struttura a termine), la **concentrazione** (quanto pesano i primi dieci
   titoli, e quali sono nel libro), l'**ampiezza** (pesi uguali contro capitalizzazione) e la **tendenza** di SPY e
   QQQ con le regole dei titoli. Il valore di una fonte non si confronta mai con la media di un'altra.
8. `python3 scripts/concorrenti.py` (v503, CEO, 18/10 sera: *"Smci però ha quote di mercato molto bassa rispetto ai
   competitor che sono effettivamente più sani. Analizza anche questo per gli altri e rendilo strutturale"*) — per
   ogni posizione, e per i sorvegliati che hanno un registro, i **concorrenti e le loro quote di mercato** dal registro
   `memoria/concorrenti.json` (mercato dichiarato, misura, periodo, fonte, link, data: una quota senza il suo mercato
   non si legge; una STIMA di analisti si dice tale; dove una quota pubblica verificabile non esiste, si dice), e la
   **salute a confronto** misurata con le funzioni della pipeline, uguali per il nome e per ogni concorrente: crescita
   dei ricavi sullo stesso trimestre dell'anno prima, margine lordo, margine operativo, flusso operativo e cassa libera
   degli ultimi 4 trimestri, ciclo di cassa (v504), Altman Z'' con zona e rating equivalente, liquidità sul debito a
   breve — solo rapporti, e per ogni
   misura il posto del nome nel gruppo, senza punteggio. Le letture stanno in `memoria/concorrenti_dati.json` e si
   rifanno dopo 7 giorni, 15 per giro; una quota oltre 120 giorni dalla pubblicazione si dichiara da riverificare.
   I conti trimestrali di una società possono fermarsi prima del trimestre che la stessa fonte dichiara chiuso
   (il 18/10: Amazon, Micron, Lenovo): un trimestre di ritardo si dichiara nella riga, oltre uno la società descrive
   un altro periodo e resta fuori dai posti, nominata.
9. `python3 scripts/stato_sistema.py` (v518, CEO, 30/10/2026: *"Alla fine fai sempre un controllo generico dello stato
   del sistema cercando di eliminare quanto piu possibile le dipendenze dal progetto GitHub e lavorare più qui con te, in
   modo da rendere stabile il processo e non incappare in errori di calcolo. Se ritieni fammi sempre domande."*) — gira
   DOPO tutti gli altri, da solo: il **codice** (HEAD contro `origin/main`, i test del CI su HEAD, i file non committati
   divisi per cosa chiedono), la **pipeline su GitHub** (l'età del run e se è precedente all'ultima chiusura USA, le fonti
   non lette nell'ultimo run, i run caduti nelle ultime 24 ore, le Issue «pipeline» aperte), i **dati del giro** (se le
   letture alla fonte di questa analisi ci sono davvero), le **dipendenze da GitHub che restano** con la loro data
   (l'elenco è `fonti_dirette.SOLO_PIPELINE`), la **coerenza del libro** (posizioni, carichi, liquidità e sorvegliati
   uguali in `memoria/LIBRO.md` e in `config/`, concorrenti, operazioni) e le **domande aperte** di `LIBRO.md`
   §1undecies con la loro età. Esce sempre 0: un controllo che fallisce lo dice nella sua riga.

## Cosa contiene la risposta, in quest'ordine
00. **Freschezza dei dati** (v511) — in UNA riga dal blocco FRESCHEZZA DEI DATI: quante serie lette alla fonte, chi è
   venuto dalla pipeline (ripiego) e perché, e se la pipeline è precedente all'ultima chiusura USA. Se lo è, le righe che
   porta solo lei (target, revisioni, CDS, short, bilanci) si leggono come la seduta prima, e la risposta lo dice dove
   le usa. Una serie NON DISPONIBILE si nomina: è il dato che manca, non un valore neutro.
   Da v512 nella stessa riga il blocco DATI PER TITOLO: quale fonte ha servito analisti, FedWatch, CDS, short e trimestri,
   e ogni voce di **DA CERCARE IN RETE** si cerca nelle notizie (comunicato della società, 10-Q, calendario dell'ente)
   con fonte e data; se non si trova si scrive dato non disponibile, mai un numero ricordato o stimato.
0. **Semaforo d'uscita** (decisione del CEO del 06/10; calcolato da v474): il colore di oggi in
   UNA riga dal blocco `SEMAFORO D'USCITA` di `numeri_libro.py`, con i segnali accesi nominati —
   regole in `memoria/LIBRO.md` §1ter. La guida sugli investimenti degli hyperscaler non è calcolata:
   va verificata in rete. Se il blocco dice COLORE CAMBIATO, va in cima alla risposta e prima di tutto
   il resto; se dice MINIMO, si nomina la famiglia che non si misura.
   Da v484, subito sotto (decisioni del CEO del 14/10 sera): il **SALVAVITA** — il calo dell'azionario
   dal suo massimo sul registro della performance, soglia −30%; se il blocco dice SCATTATO va in cima
   alla risposta, come un colore cambiato — e il **PIANO DI RIDUZIONE**: il gradino del salvavita
   calcolato prima (un terzo dei semiconduttori in proporzione al rischio: azioni, imposta, rischio
   prima e dopo). Dal 15/10 (decisione del CEO: *"non vendi sui ribassi ma sui massimi"*) arancione e
   rosso NON vendono: il colore si scrive come segnale, e il piano in una riga in ogni colore — quanto
   si venderebbe e l'imposta —; per intero, nome per nome, solo col salvavita scattato. Si vende,
   non ci si copre: il CEO non opera con opzioni o ETF short, per ora.
0bis. **Costo dell'attesa e scadenze** (decisione del CEO del 06/10, regole in `memoria/LIBRO.md`
   §1quater): il blocco `COSTO DELL'ATTESA` / `SCADENZE` di `numeri_libro.py`, e per ogni
   decisione aperta del piano la sua scadenza (prima trimestrale del nome) e i giorni che mancano.
   Le protezioni non ancora messe si segnalano qui, ogni giorno, finché non lo sono.
   Da v516 il blocco **CAMBIO EURO/DOLLARO** (`LIBRO.md` §1decies, CEO del 30/10/2026): il cambio di oggi col
   suo anno, quanta parte del patrimonio è in dollari e cosa fa un 1% del cambio, e per le posizioni col cambio
   annotato il risultato in euro diviso fra prezzo e cambio, con l'imposta in euro se si vendesse oggi. Chi è
   entrato dopo la seduta del blocco si valuta al prezzo di adesso e resta fuori dal risultato del periodo.
   Da v474 il blocco `DECISIONI APERTE` (tabella in `LIBRO.md` §1quinquies): per ogni decisione
   confermata e non eseguita quanto l'attesa è costata o ha fatto guadagnare dalla chiusura della
   conferma, se la condizione vale ancora e la scadenza. Una condizione RIENTRATA si dice.
   Da v483 lo stesso blocco riporta le decisioni **RIMANDATE DI PROPOSITO** (`LIBRO.md`
   §1quinquies, una riga «- TICKER — cosa si rimanda») con la prima trimestrale del nome: si
   scrivono nella risposta finché la decisione non si prende.
   Da v489 il blocco **ORDINI APERTI** (`LIBRO.md` §1septies, gli ordini con limite che il CEO ha
   inserito): per ciascuno la distanza dal prezzo; se il minimo della seduta ha toccato il limite
   (può essere già eseguito: chiederlo al CEO); **STORNO o DISCESA** e se alzare il limite è
   coerente (`LIBRO.md` §1bis: si alza solo su uno storno, con il titolo in calo nella seduta); il
   pavimento sotto il limite, lo stop e il rischio fino allo stop col limite e col prezzo di adesso;
   la tenuta se fosse in portafoglio, la correlazione, i conti dentro la vita dell'ordine, il
   volume della seduta; e l'insieme degli ordini sul libro. La risposta dice ordine per ordine:
   lasciarlo, spostarlo (a quale prezzo) o toglierlo. Un ordine eseguito si registra in §1 e
   lascia la tabella.
   Da v490 ogni ordine porta la sua **validità** (colonna «Validità» di §1septies): un ordine **giornaliero**, dopo la
   campana della sua seduta, non è più attivo — il blocco lo mette fra gli ESEGUITI o SCADUTI col minimo della
   seduta accanto al limite, e la risposta chiede al CEO quale dei due. L'INSIEME dice la **liquidità bloccata**
   dagli ordini attivi e la **libera** (`LIBRO.md` §1 scrive la liquidità in tutto, bloccata compresa).
   Da v491 l'ultima colonna è **Attivo alle**: l'ora italiana in cui il conto mostrava l'ordine ancora attivo e non
   eseguito. Quando il CEO manda lo screenshot degli ordini, l'ora dello screenshot va lì — non è l'ora
   d'inserimento, e non si scrive come tale. Il blocco guarda solo i prezzi DOPO quell'ora, dalle barre a 5 minuti
   delle ultime cinque sedute: il minimo della seduta dice se il limite è stato raggiunto, non quando.
   Le date dei conti vengono dal calendario Nasdaq e, per chi non c'è, da quelle **dichiarate
   dall'emittente** (`LIBRO.md` §1octies, v489): il 15/10 SK hynix mancava dal calendario.
   Da v494 ogni ordine attivo porta anche la **struttura delle oscillazioni** (un ordine è un ingresso) e le sue
   ultimissime notizie stanno nel blocco NOTIZIE ULTIMISSIME di `numeri_libro.py`.
0ter. **Credito sul libro** (v467, regola in `memoria/LIBRO.md` §1ter): il blocco `CREDITO SUL
   LIBRO` di `numeri_libro.py` — chi brucia cassa, il suo peso, le tre condizioni. Se la conferma
   è accesa, gli stop su quei nomi passano in cima alle decisioni. Non cambia il colore del semaforo.
1. **Sintesi in 3-5 punti** — cosa è successo, perché, cosa cambia per il libro.
2. **Risultato contro i riferimenti** — libro contro QQQ, SMH, SPY, RSP; chi ha portato il risultato. Da v520 (CEO,
   31/10/2026, «2 si») anche il **ROI del conto** dal blocco omonimo: il guadagno sul carico delle posizioni aperte in
   euro come il broker lo dichiara, quanto viene dai prezzi e quanto dal cambio, le operazioni chiuse con le imposte; il
   ROI dall'inizio del conto si dice non calcolabile finche' mancano i versamenti netti, e la fotografia del broker si
   rinnova dopo ogni operazione (una fotografia superata il blocco la nomina).
   E il **registro della performance** (v474): libro in dollari e patrimonio in euro contro QQQ,
   il riferimento scelto dal CEO il 09/10, dalla prima riga a oggi.
3. **Rischio** — peso contro quota del rischio; beta sul Nasdaq col suo R²; segnalare solo se cambia.
   Più i CANALI accesi di ciascun nome (schede_progetto): da quale fattore arriva il rischio.
4. **Tecnica** — solo i nomi vicini a resistenza o supporto (distanze in ATR), o sotto la SMA200.
5. **Macro e catalizzatori** — e per le trimestrali vicine le revisioni delle stime e, per chi
   brucia cassa, l'autonomia: sono le due cose che una trimestrale riprezza.
   I ricavi si leggono dai TRIMESTRI (riga «ricavi» delle schede), mai dal solo esercizio chiuso,
   e l'autonomia sulla LIQUIDITÀ (cassa e titoli a breve), mai sulla sola cassa (v476): il 12/10
   l'esercizio fermo al 2025 mi ha fatto scrivere «ricavi in calo» su RGTI, che nel 2026 li ha
   quasi triplicati, e i soli contanti coprivano 5,5 mesi di perdita operativa dove la liquidità
   intera ne copre circa 78 (stesso denominatore: i due numeri si confrontano).
   Soglie macro decise prima (spread credito alto rendimento 3,5;
   Treasury 10 anni 5,0 / 5,4), trimestrali, Fed e aste del Tesoro nei prossimi giorni.
   **I CDS a 5 anni** (v497, schede): per ogni nome quotato il livello in punti base, il verso (5, 21 e 63 giorni,
   appena lo storico raccolto li copre) e quante volte vale l'indice CDX della sua cedola; un allargamento si dice
   ACCANTO alle notizie e al bilancio del nome, perché il CDS è il prezzo che il mercato chiede per assicurarsi
   contro un default che il bilancio da solo non quota. Dal 17/10 sera (v498, decisione del CEO) il suo
   allargamento OLTRE quello dell'indice in un mese è una **prova della tenuta** (§6, `LIBRO.md` §1sexies), in
   funzione quando lo storico raccolto basta; non è un colore del semaforo. Lo storico gratuito non esiste (ICE
   pubblica solo l'ultimo giorno, DTCC risponde 403 anche dai server di GitHub): lo raccoglie la pipeline dal
   16/10/2026, e finché i giorni non bastano la variazione si cerca in rete, con fonte e data.
   **La salute del credito** (v501, schede, `LIBRO.md` §1novies): i SEGNALI in testa al blocco si dicono qui per
   primi — una DIVERGENZA (il CDS peggiora e il titolo non lo sconta) è la cosa che il CEO ha chiesto di non perdere;
   per i nomi in posizione o con un ingresso possibile anche Altman con la sua finestra temporale, detto per ciò che
   è (frequenza storica delle obbligazioni con quel rating, non una previsione) e la quota del debito a 12 mesi
   contro la liquidità. È INFORMAZIONE: non una prova della tenuta (il CDS del mese lo è già), non un colore.
   **Le due solidità** (v504, CEO, 18/10 sera: *"Questo mi fa capire la % di rischio sulla base del rendimento e se
   questo rapporto ne vale la pena"*): per i nomi in posizione o con un ingresso possibile si dicono SEPARATE — la
   patrimoniale risponde «il bilancio regge un colpo?», l'operativa «l'attività fa cassa?» — con accanto il rischio
   storico (Altman) e il rendimento del prezzo, mai fusi in un giudizio numerico. Quando divergono è la prima cosa da
   dire: un bilancio forte che brucia cassa (SMCI il 18/10) sposta il rischio dall'insolvenza alla cassa per andare
   avanti — debito o azioni nuove —; un punteggio di Altman basso con l'attività che si autofinanzia (Dell, HPE) si
   legge col termine che lo tiene giù — un circolante negativo nato dal ciclo di cassa è credito dei fornitori, un
   patrimonio negativo con utili positivi viene dai riacquisti — e la frequenza storica del rating equivalente si dice
   con questa riserva. L'utile atteso sul prezzo di un ciclico (le memorie) è più alto proprio vicino al picco del
   ciclo: si dice. Se il rapporto ne valga la pena lo argomenta la risposta, con le misure accanto; la decisione resta
   del CEO. È INFORMAZIONE: non una prova della tenuta, non un colore.
   **ROIC e ROE** (v520, CEO, 31/10/2026: *"1 si … Sarebbe utile anche ROE"*): per i nomi in posizione o con un ingresso
   possibile la riga «rendimento del capitale» delle schede — il ROIC dice quanto rende ogni dollaro messo nell'attivita',
   debito compreso; il ROE quanto rende il capitale degli azionisti, e cresce con la leva: quando il patrimonio e' una
   piccola parte del capitale investito (ORCL, CRWV, le banche) si leggono insieme, e la riga lo dice. Sui ciclici il
   ROIC dei 12 mesi va letto accanto agli esercizi chiusi, che mostrano quanto del rendimento viene dal momento del
   ciclo. Il confronto col costo del capitale non e' calcolato. È INFORMAZIONE: non una prova della tenuta, non un colore.
5bis. **Posizionamento** (v496, CEO, 17/10) — dal blocco di `posizionamento.py`: il put/call di mercato col
   suo percentile (alto = domanda di protezione: convenzione del mestiere, non una misura); le scadenze delle opzioni
   — una mensile o una trimestrale («tre streghe») entro cinque giorni si dice in cima alla sezione, perché alla
   scadenza le coperture legate alle opzioni si chiudono; per ogni posizione il movimento implicito che il mercato
   paga fino ai conti, l'open interest che li accompagna e le opzioni più scambiate fuori dal denaro (il verso,
   comprate o vendute, non è nei dati); i grandi operatori della CFTC, con la data del martedì della fotografia; il
   bitcoin dall'ultima chiusura USA e quanto vale su MSTR — il lunedì, e dopo un fine settimana in cui il bitcoin si
   è mosso, è la prima cosa da dire su MSTR. La leva porta la **variazione annua col suo percentile** dal file storico
   FINRA nella riga del semaforo (sezione 0). È tutto INFORMAZIONE accanto al semaforo e alla tenuta: nessuna di
   queste misure è una prova della tenuta, un colore o una vendita — se il CEO vorrà farne un segnale, lo deciderà lui.
   Da v499 la **gamma dei dealer** (regime, cambio di regime, call wall e put wall delle posizioni e di SPY, QQQ e
   IWM: livelli dove il prezzo si è fermato più spesso, non dove si fermerà) e il **dark pool** (DPI di ogni nome
   col percentile dell'anno e la media a 10 sedute, DIX e GEX dell'S&P 500): stessa natura, informazione.
   Da v517 (CEO, 30/10: *"Osserva anche il forum WallStreetBets"*) il blocco **WALLSTREETBETS**: per ogni posizione e
   sorvegliato il rango sul forum, le menzioni delle ultime 24 ore contro quelle di 24 ore prima, le impennate
   (convenzione: almeno 3 volte e almeno 20 menzioni) e, da venti giorni raccolti, il percentile. Si contano le
   menzioni: **i post non sono una fonte di fatti** (regola v451), e un nome al centro del forum dice dove guarda la
   folla — affollamento, volatilità di breve — non dove andrà il prezzo. Stessa natura: informazione.
   Da v500 (CEO, 18/10: *"1 ok tua proposta"*) è anche **misurato** (`LIBRO.md` §1ter): nessuno di questi segnali,
   né la curva della volatilità degli indici, anticipa i cali più del caso. La risposta li legge come termometri
   dello stress in corso, non come avvisi di un calo che deve ancora venire.
   Da v506 le **vendite allo scoperto** (blocco delle schede): per i nomi con la quota alta, vicini al massimo del
   proprio anno, in posizione o con un ingresso possibile si dice la quota del flottante con la data del regolamento,
   i giorni per ricoprire e il verso in tre mesi ACCANTO al titolo negli stessi giorni — è la coppia che si legge:
   posizioni corte in aumento col titolo in salita sono ricoperture che un dato favorevole può costringere (il
   carburante di uno squeeze); in aumento col titolo in discesa, ribassisti che accompagnano la discesa; in calo col
   titolo in salita, una parte del rialzo è ricopertura e non acquisto nuovo. Il dato ha due settimane di ritardo per
   costruzione: la data del regolamento si scrive sempre, e la prossima pubblicazione dal calendario. È INFORMAZIONE:
   non una prova della tenuta, non un colore — se il CEO vorrà farne un segnale, lo deciderà lui.
5ter. **Indici** (v499, CEO, 17/10 sera) — dal blocco di `indici.py`: il P/E dell'S&P 500 prospettico contro le
   medie della STESSA FactSet, gli ultimi 12 mesi e il CAPE contro le mediane della stessa serie di multpl, il
   Nasdaq-100 dal WSJ col valore di un anno prima — mai il valore di una fonte contro la media di un'altra, perché
   fonti diverse usano utili diversi; il premio sul Tesoro (convenzione); la stagione delle trimestrali (quante
   battono le attese contro le medie di FactSet, la crescita «blended»); VIX e VXN col loro percentile e la
   struttura a termine (sopra 1 è invertita: la forma dello stress); dalla v510 (CEO, 24/10) il **Fear & Greed della
   CNN** con la data della rilevazione, i confronti e il suo anno — ⚠ due delle sue sette componenti sono il VIX e il
   put/call che l'analisi legge già: non è una seconda conferma, è la stessa lettura riassunta (B3); quanto pesano i primi dieci titoli e quali
   sono nel libro; l'ampiezza; la tendenza di SPY e QQQ. È INFORMAZIONE: nessuna prova della tenuta, nessun
   colore, nessuna vendita. Il riferimento accanto ai multipli dei titoli (schede) resta quello della pipeline.
5quater. **Concorrenti e quote di mercato** (v503, CEO, 18/10 sera) — dal blocco di `concorrenti.py`, per ogni
   posizione: il mercato, la quota del nome e dei concorrenti con la fonte e la data (e se la quota è vecchia, che va
   riverificata), poi chi è più sano su ogni misura — crescita, margini, cassa libera, Altman, liquidità sul debito a
   breve. La risposta distingue le due domande: **quanto mercato** (la quota) e **quanto è solida** (la salute), che
   possono dire cose opposte — SMCI ha la metà della quota di Dell e il bilancio più solido del gruppo. Da v504 la
   salute ha due facce anche qui: la patrimoniale (Altman, liquidità) e l'operativa (flusso operativo, cassa libera,
   ciclo di cassa) — il 18/10 SMCI era prima del gruppo per bilancio e ultima per cassa. È
   INFORMAZIONE: nessuna prova della tenuta, nessun colore, nessuna vendita. Un nome senza registro si nomina.
6. **Tenuta e piano** (decisioni del CEO del 14/10/2026, regola in `memoria/LIBRO.md` §1sexies:
   *si lascia correre, si vende per EVIDENZA, e si valuta l'insieme — non la sola tecnica*) — dal
   blocco `TENUTA DELLE POSIZIONI` di `numeri_libro.py`, per ogni posizione l'esito (VENDITA PER
   EVIDENZA · CONFLITTO — DA VALUTARE · IN OSSERVAZIONE · NON MISURABILE · LASCIAR CORRERE), le
   prove CONTRO e A FAVORE, il consenso degli analisti (un'opinione, accanto), il **pareggio
   fiscale** — di quanto deve scendere il titolo perché vendere oggi convenga, cioè l'interesse
   composto misurato — e per le posizioni in perdita **l'aritmetica della media** su un'unità di
   5.000 € (il caso di AMD: una possibilità da valutare, non una quantità).
   Da v489 (CEO, 15/10: *"valuta anche mediazione su SK hynix"*) ogni posizione porta i suoi
   **pavimenti** e la **media sui pavimenti**: l'aritmetica della media su ogni pavimento SOTTO IL
   CARICO, con lo stop. Comprare sopra il carico alza il carico: è un incremento, non una media, e
   la risposta lo chiama così.
   Da v498 (CEO, 17/10) la tenuta ha una prova in più, il **CDS**: lo spread del nome che in un mese cresce di
   oltre il 20% PIÙ dell'indice della sua cedola è CONTRO, che scende oltre la stessa soglia è A FAVORE (non è
   crescita: non apre un conflitto); la riga della regola in testa al blocco dice chi ha un CDS, chi no e se la
   prova è già in funzione, e quanti giorni di storico ha.
   Le **notizie** non sono calcolate: per ogni nome in VENDITA, CONFLITTO o OSSERVAZIONE la ricerca
   web è obbligatoria e va fatta **nei due versi** — i catalizzatori che possono farlo salire forte
   (contratti, guida alzata, ordini, clienti nuovi) e i fatti che rompono la tesi — con fonte e
   data. Su un CONFLITTO la risposta scrive la lettura dell'insieme (tendenza futura possibile,
   rialzo possibile e rischio) e la lascia decidere al CEO: tenere, mediare o uscire.
   Le decisioni già confermate stanno nel blocco DECISIONI APERTE (sezione 0bis); una VENDITA PER
   EVIDENZA senza decisione aperta si **propone** al CEO, la decisione è sua; una vendita aperta che
   la regola non sostiene da sola si ridiscute col CEO.
   Ogni CONFLITTO porta la sua **scadenza** (v484, decisione del CEO del 14/10): si decide ai conti
   successivi, con un **esame scritto prima** — cosa devono mostrare i conti per tenere, mediare o
   vendere — mandato al CEO 7 giorni prima. Quando il blocco dice «esame DA SCRIVERE ORA», o la data
   d'invio è arrivata, l'esame si scrive nella risposta; confermato dal CEO, va in `LIBRO.md`
   §1quinquies («Esami dei conflitti»), e dopo i conti si confronta coi risultati. Il rallentamento
   della crescita NON è una prova: proposta respinta dal CEO il 14/10.
   **Niente vendite a fascia di prezzo né alleggerimenti per peso**: il 14/10 sono stati tolti MU
   1.100-1.108, BE prima della trimestrale, AMD verso il 12-14% del libro e le prese di profitto del
   giallo. Gli avvisi di prezzo su Investing.com restano campanelli: un avviso non è una vendita, fa
   guardare la tenuta.
   Da v494 (CEO, 17/10: *"analizza anche massimi e minimi decrescenti … tecnicamente i grafici quando si
   presenta la possibilità di ingresso o si attivano i parametri di uscita fermo restando che anche le
   ultimissime news sono importanti"*) ogni posizione porta la **STRUTTURA DELLE OSCILLAZIONI** (regole in
   `LIBRO.md` §1bis): massimi e minimi crescenti o decrescenti, se la chiusura ha già rotto l'ultimo minimo, i
   doppi massimi e minimi, la divergenza dell'RSI. È la famiglia del prezzo, la stessa della tendenza: la
   risposta la legge accanto alla tenuta come un'informazione, non come una prova in più, e non vende — decisione
   del CEO del 17/10, testuale: *"solo informazione"*; l'esito della tenuta non cambia con lei. E il
   blocco **NOTIZIE ULTIMISSIME** di `numeri_libro.py` porta, per ogni posizione con un parametro d'uscita acceso e
   ogni ordine attivo, il perché e le voci del feed delle ultime 72 ore (la cronaca di mercato una volta sola, in
   fondo — da v500 è cronaca la voce nel feed di almeno tre nomi; quella nel feed di due resta con ciascuno e dice
   dove altro compare): la risposta le cita con data e fonte, insieme alla ricerca web delle stesse ore.
   Da v499 (CEO, 17/10 sera: *"non so se mi avresti fornito l'ultima trovata di Mask sull'auto volante tra le
   News"*) le notizie sono di **TUTTE** le posizioni: chi ha un segnale viene prima col suo perché e fino a 6 voci,
   chi non ne ha porta le 3 più recenti — un evento non aspetta un segnale. Un feed **VUOTO** o **FERMO** (l'ultima
   voce oltre 14 giorni prima) si dichiara: per quel nome la fonte non porta le notizie e la ricerca in rete è
   obbligatoria (il 17/10 il feed di SpaceX aveva tre voci, l'ultima del 01/07).

7. **Watchlist e rotazione** (sempre, v468) — in giallo, arancione e rosso NESSUN divieto
   d'ingresso (decisioni del CEO del 09/10 e del 15/10), ma ogni ingresso porta le sue conseguenze di
   rischio e chi è nella stessa scommessa del libro lo dichiara; col salvavita scattato prima il suo
   gradino. **Gli ingressi speculativi sono ammessi** (CEO, 14/10: *"se ci sono
   margini di speculazione, ben venga"*): dove la riga «tenuta se fosse in portafoglio» dice
   VENDITA PER EVIDENZA, l'ingresso è una scommessa contro l'evidenza e si dichiara tale; dove dice
   CONFLITTO, è il caso AMD visto da fuori e lo leggono le notizie, nei due versi.
   7a. i settori IN TENDENZA con bassa correlazione col libro (dove il denaro va senza replicare
       la nostra scommessa), col CONTESTO MACRO del settore da ricerca web, fonte e data;
   7b. per ciascuno i titoli CANDIDATI di `rotazione.py`, coi livelli, i volumi e le notizie;
   7c. la WATCHLIST per gruppi (blocco «WATCHLIST DEL LIBRO E INGRESSI»): candidati ·
       diversificano ma non ancora in zona · stessa scommessa del libro (correlazione da 0,5 in
       su: aggiungono concentrazione) · non misurabili;
   7d. **gli INGRESSI** (v473, istruzione del CEO del 09/10: *"rendi strutturale questa ultima
       analisi"*) — per ogni nome che il CEO segue o chiede: il livello d'ingresso secondo la
       convenzione (chiusura sopra il bordo della zona, con volume oltre la norma) o il ritorno
       nella zona per chi è tirato, il primo segnale per chi non ha zona, lo stop (supporto 20
       sedute) e il rischio dall'ingresso allo stop, la base (minimi crescenti o decrescenti,
       sedute dal minimo dell'anno), la trimestrale dichiarata dalla fonte, le revisioni, e la
       nota del CEO in `LIBRO.md` confrontata coi livelli di oggi. Chiusura: chi è operabile
       ADESSO, chi ha un livello da mettere come avviso su Investing.com, chi no e perché.
   7d-bis. **i PAVIMENTI** (v487, decisione del CEO del 15/10: *"Non voglio entrare quando risalgono, ma
       voglio entrare sui minimi"*) — per ogni nome i minimi degli ultimi due anni dove il titolo ha smesso
       di scendere, con l'ordine con limite al bordo alto, lo stop e la perdita per 5.000 € (regole in
       `LIBRO.md` §1bis), e nel piano per la liquidità il gruppo **SUI PAVIMENTI**: l'ordine sul pavimento
       più vicino di ogni nome. La chiusura della risposta dice quali ordini sui pavimenti mettere, e per chi
       ha i conti vicini se tenerli aperti durante i conti.
       Con i pavimenti, i **volumi** (CEO, 15/10: *"fornisci anche volumi"*): il percentile dell'ultima
       seduta conclusa e della media a 20, quello del giorno di ogni tocco, e a seduta aperta (v489) il
       volume **della seduta in corso** con il tempo trascorso accanto — «N azioni finora = X% di una
       seduta media, in M minuti su 390». Non è una stima della giornata: si confronta fra i nomi.
   7d-quater. **la LETTURA A 5 ANNI e il P/E** (v492, CEO, 16/10) — per ogni ingresso, accanto ai
       pavimenti: dove sta il prezzo nell'intervallo dei cinque anni, sopra o sotto le medie a 30, 50 e
       200 settimane e dove vanno, quanto del rialzo ha già restituito; e il P/E (trailing e prospettico,
       o la perdita detta come tale) contro il riferimento dell'S&P 500, dichiarato indicativo. Una media
       n.d. si dice n.d. (storia troppo corta), e un titolo con la storia della quotazione NON verificata
       lo dichiara: su un nato da un veicolo (OKLO, da AltC) medie e massimi mescolano due società. Il P/E
       è una metrica, non una prova della tenuta: un growth costa caro per costruzione.
       Da v500 (CEO, 18/10: *"2ok"*) accanto ai pavimenti il **VWAP dall'ultima trimestrale** — il prezzo medio
       pagato da chi ha comprato dopo i conti, con la seduta d'ancora e il perché (ora del deposito su SEC EDGAR,
       o la seduta più scambiata se l'ora manca), e il risultato dei conti contro le attese: un pavimento sotto il
       VWAP compra dove chi è entrato dopo i conti perde in media, uno sopra dove guadagna. È un livello, non una
       prova della tenuta né un ordine (regole in `LIBRO.md` §1bis).
   7d-quinquies. **la STRUTTURA e le ULTIMISSIME NOTIZIE** (v494, CEO, 17/10) — per ogni ingresso la riga della
       struttura delle oscillazioni: un ingresso sul pavimento con i minimi ancora DECRESCENTI, o con la chiusura
       già sotto l'ultimo minimo, compra una discesa che non ha smesso di scendere, e la risposta lo dice; un doppio
       minimo o una divergenza rialzista sul pavimento la rendono più credibile. Il blocco **NOTIZIE ULTIMISSIME —
       SORVEGLIATI CON UN INGRESSO POSSIBILE** di `rotazione.py` (pavimento entro 1 ATR, candidato, prezzo nella
       zona) porta le voci del feed delle ultime 72 ore; la risposta le cita con data e fonte, insieme alla ricerca
       web delle stesse ore, e una notizia che rompe la tesi toglie l'ingresso anche dal pavimento migliore.
       Da v499 il blocco è **NOTIZIE ULTIMISSIME — TUTTI I SORVEGLIATI**: chi ha un ingresso possibile viene prima
       col perché, gli altri con le 3 voci più recenti; un feed vuoto o fermo si dichiara e si cerca in rete.
   7d-ter. **gli ingressi in ordine d'interesse** (CEO, 15/10: *"ponili in ordine dal più interessante,
       risposta secca con prezzi e motivazioni"*) — il prezzo d'ingresso (l'ordine sul pavimento), lo stop
       con la perdita, il secondo prezzo, e una motivazione per nome. L'ordine è un GIUDIZIO dell'analisi,
       non un punteggio del sistema (v200), e si fa sempre con gli stessi criteri, in quest'ordine: 1) la
       tenuta se fosse in portafoglio (chi la regola venderebbe va in fondo); 2) cosa fa al libro (chi
       diversifica o abbassa la volatilità sale); 3) il pavimento (vicinanza, tocchi, ampiezza dello stop);
       4) gli eventi dentro la vita dell'ordine (conti entro 14 giorni, scadenze di lock-up). Chi ha i conti
       vicini si rimanda a dopo i conti, e si dice.
       Da v503 (CEO, 18/10 sera): un sorvegliato che diventa un ingresso riceve PRIMA la sua voce nel registro dei
       concorrenti (`memoria/concorrenti.json`: mercato, quote, fonte e data cercati in rete), così l'ingresso porta
       accanto la sua quota di mercato e la salute dei concorrenti come ogni posizione.
   7d-sexies. **il CALENDARIO FISCALE DI FINE ANNO** (v512, decisione del 25/10/2026, LIBRO.md §1ter) — da ottobre a
       gennaio, in una riga: quanti nomi sono in perdita sull'anno e quali sono piccoli (dove la vendita per le
       minusvalenze e il rimbalzo di gennaio sono misurati) e quali grandi (rumore). Informazione: non cambia tenuta,
       semaforo né ingressi. Fuori finestra il blocco dice che è spento, e la risposta non lo nomina.
   7e. **il PIANO PER LA LIQUIDITÀ** (v474, decisione del CEO del 09/10) — dal blocco omonimo di
       `rotazione.py`: la liquidità e la sua quota del patrimonio; per gli operabili adesso e per
       gli avvisi le conseguenze di un'unità di 5.000 € sul libro (volatilità, beta su QQQ, perdita
       allo stop) e la trimestrale vicina; la stessa scommessa sempre dichiarata. Priorità e
       livelli, mai la quantità da comprare: l'unità è un'unità di calcolo.
8. **Il secondo tempo: le DOMANDE MIRATE** (decisione del CEO del 25/10/2026, testuale: *"Preferisco ragionare con te
   qui in chat dopo l'analisi, è un sistema che funziona per me. 1 step analisi secondo step domande mirate e
   ragionamento con te."*). L'analisi (il primo tempo) chiude con **2-4 domande numerate**, ciascuna su una decisione
   aperta o su un segnale nuovo di oggi — un colore cambiato, un conflitto in scadenza, un ingresso su un pavimento, una
   serie che la pipeline non ha portato — con le opzioni e cosa comporta ciascuna, in numeri dove il sistema li ha. Le
   domande non decidono al posto del CEO e non sono un riassunto: sono il punto da cui parte il ragionamento in chat.
   Il secondo tempo è quel ragionamento, sulle sue risposte: ciò che decide entra in `memoria/LIBRO.md`, e se diventa
   una regola nel registro qui sotto e nel codice, lo stesso giorno.
   Fra le domande entrano quelle aperte del blocco STATO DEL SISTEMA (`LIBRO.md` §1undecies) che contano oggi: una
   domanda aperta da più giorni si ripropone, non si lascia invecchiare.
9. **Stato del sistema** (v518, CEO, 30/10/2026) — in chiusura, dal blocco STATO DEL SISTEMA, in **due-quattro righe**:
   l'esito (quanti punti da guardare, quante domande aperte), ogni riga con ⚠ detta per nome — `main` rossa o commit non
   online, un run caduto o precedente all'ultima chiusura USA, una fonte non letta nell'ultimo run, una lettura del giro
   che manca, una copia del libro che non coincide —, e quanta parte dell'analisi poggia ancora sulla pipeline (le
   DIPENDENZE DA GITHUB con la loro data). Se tutto è a posto si scrive in una riga, **non si salta**. Un punto che si può
   sistemare in questa sessione si sistema prima di chiudere, e la risposta lo dice; uno che chiede il CEO diventa una
   domanda della sezione 8.

Accanto alla tenuta di ogni posizione e all'ingresso di ogni sorvegliato, da v511 (domanda del CEO del 24/10, *«Ok»* del
25/10): la riga degli **oscillatori** (RSI 14, stocastico 14/3, Williams %R 14, CCI 20, sulle sedute concluse, con lo
stato IPERVENDUTO / IPERCOMPRATO / NELLA NORMA quando almeno due dei quattro passano la soglia di lettura), la riga
**supporto e accumulo** (quante delle quattro condizioni di una base sono presenti: sul pavimento entro 1 ATR,
ipervenduto, volume in salita maggiore che in discesa, divergenza rialzista o doppio minimo confermato di recente —
contate, non pesate) e la **stagionalità** del titolo nel mese in corso e nel successivo col suo campione; negli indici
la stagionalità del Nasdaq-100 negli anni dello stesso ciclo presidenziale. Tutto **informazione**: non una prova della
tenuta, non un colore, non un ingresso — un ipervenduto su un titolo in discesa può restarlo a lungo, e la risposta lo
legge insieme alla struttura e alle notizie.

**Richieste del CEO rese strutturali — entrano TUTTE in ogni «Aggiorna analisi»** (v505: ogni voce ha la sua
chiave fra parentesi quadre, e `scripts/scheda.py` la mette nella SCHEDA COMPLETA — un gate verifica nei due versi
che ogni voce di qui abbia la sua voce nel catalogo della scheda, e che il catalogo non ne abbia una che qui non c'è):
- `[freschezza]` i dati in ritardo tolti dove una fonte raggiungibile c'è: le serie macro lette alla fonte all'ora dell'analisi, la pipeline come ripiego dichiarato riga per riga, e la sua età con ciò che porta solo lei (25/10)
- `[fine_anno]` calendario fiscale di fine anno, da ottobre a gennaio: i nomi in perdita sull'anno con la capitalizzazione, e dove la regolarità è misurata (piccoli) e dove è rumore (grandi) — informazione (25/10)
- `[flottante]` l'analisi del flottante di ogni posizione e sorvegliato: le azioni in circolazione dai bilanci con la data e la diluizione sull'anno e sul trimestre, il flottante e quanto ne gira a seduta, la data di quotazione e i vincoli di vendita da verificare nel prospetto (25/10) — informazione, non una prova
- `[comunicati]` dove le fonti non concordano sui ricavi (le banche) o nessuna porta il trimestre, i conti dal comunicato ufficiale della società con fonte, link e data, confrontati solo coi trimestri del comunicato stesso (25/10)
- `[freschezza_titoli]` i dati per titolo della pipeline letti alla fonte se vecchi — analisti, FedWatch, CDS, vendite allo scoperto, depositi SEC, trimestri che la pipeline non ha ancora — con ogni quanto cambiano, e cercati nelle notizie dove nemmeno la fonte è aggiornata (25/10); dal 30/10 (opzione B scelta dal CEO) anche le **righe intere** di ogni titolo — prezzo, tecnica, multipli, conti, combustione di cassa, solidità, flottante, sensibilità ai canali — lette in sessione con la funzione della pipeline, e i campi che una lettura più povera perderebbe restano del run, dichiarati
- `[semaforo]` semaforo d'uscita (06/10), calcolato (09/10)
- `[attesa]` costo dell'attesa e scadenze (06/10)
- `[premarket]` pre-market prima dell'apertura (06/10)
- `[schede]` schede del progetto (06/10)
- `[credito_libro]` credito sul libro (07/10)
- `[rotazione]` rotazione con candidati, tecnica, volumi e notizie (07/10)
- `[target_beta]` target, beta e volatilità (07/10)
- `[volumi]` volumi come percentile 0-100 (08/10); i volumi, anche della seduta in corso col tempo trascorso (15/10)
- `[aste]` aste del Tesoro in ora italiana (07/10)
- `[ingressi]` ingressi sulla watchlist (09/10)
- `[registro]` riferimento QQQ e registro della performance (09/10)
- `[conseguenze]` in giallo nessun divieto ma conseguenze di rischio di ogni ingresso (09/10)
- `[decisioni]` costo delle decisioni aperte (09/10); le decisioni rimandate di proposito, riportate con la loro scadenza (14/10)
- `[liquidita]` piano per la liquidità (09/10)
- `[memorie]` nessun tetto alle memorie (14/10)
- `[tenuta]` tenuta delle posizioni: si lascia correre, si vende per evidenza, col pareggio fiscale, anche sui sorvegliati (14/10); bilancio dell'evidenza nei due versi, il rialzo possibile valutato (14/10)
- `[speculativi]` ingressi speculativi ammessi e dichiarati (14/10)
- `[media]` l'aritmetica della media sulle posizioni in perdita (14/10)
- `[salvavita]` la riduzione in proporzione al rischio, il salvavita a −30% dal massimo (14/10 sera); non si vende sui ribassi: arancione e rosso sono un segnale, l'unica vendita automatica è il salvavita, e nessuna presa di profitto ai massimi (15/10)
- `[conflitti]` la scadenza e l'esame di ogni conflitto (14/10 sera)
- `[pavimenti]` ingressi sui minimi: i pavimenti di ogni nome della watchlist, con ordine, stop e perdita per 5.000 € (15/10); i pavimenti delle posizioni e la media sui pavimenti sotto il carico (15/10)
- `[ordini]` gli ordini aperti seguiti a ogni analisi, con storno o discesa e il rischio di alzare il limite (15/10); gli ordini giornalieri seguiti fino alla loro campana, e la liquidità libera dopo gli ordini aperti (15/10 sera)
- `[conti_emittente]` le date dei conti dichiarate dall'emittente (15/10)
- `[ordine_interesse]` gli ingressi in ordine d'interesse, con prezzi e motivazioni (15/10)
- `[cinque_anni]` la lettura a 5 anni in ogni ingresso, sulla serie della società di oggi (16/10)
- `[pe]` il P/E come metrica di ogni azione (16/10)
- `[struttura]` la struttura delle oscillazioni — massimi e minimi crescenti o decrescenti, rotture, doppi, divergenze — in ogni ingresso e su ogni posizione (17/10), «solo informazione», non una prova nella tenuta (decisione del CEO dello stesso giorno)
- `[notizie]` le ultimissime notizie dei nomi con un ingresso possibile o un'uscita accesa (17/10); le notizie di TUTTE le posizioni e di TUTTI i sorvegliati, coi segnali davanti, e il feed vuoto o fermo dichiarato (17/10 sera)
- `[leva]` la variazione annua della leva dal file storico FINRA, col suo percentile (17/10) — informazione, non una prova
- `[opzioni]` put e call di mercato e di ogni posizione, le scadenze delle opzioni (mensile e «tre streghe») (17/10) — informazione, non prove
- `[cftc]` le posizioni dei grandi operatori (CFTC) (17/10) — informazione, non una prova
- `[bitcoin]` il bitcoin dall'ultima chiusura USA su MSTR (17/10) — informazione, non una prova
- `[cds]` i CDS a 5 anni di posizioni e sorvegliati, con gli indici CDX e l'Italia per il BTP (17/10) — e dalla sera stessa il loro allargamento oltre l'indice come prova della tenuta, in funzione quando lo storico raccolto basta (17/10)
- `[dark_pool]` il dark pool (FINRA, DIX) (17/10 sera) — informazione, non una prova
- `[short]` le vendite allo scoperto di ogni posizione e sorvegliato: le posizioni corte APERTE in % del flottante (FINRA, con la data del regolamento e la prossima pubblicazione dal calendario ufficiale), i giorni per ricoprirle, la variazione e il percentile dell'anno, il titolo negli stessi giorni (19/10) — informazione, non una prova
- `[gamma]` la gamma dei dealer (call wall, put wall, cambio di regime) (17/10 sera) — informazione, non una prova
- `[indici]` gli indici S&P 500 e Nasdaq-100 — P/E con la storia della sua fonte, stagione delle trimestrali, volatilità implicita, concentrazione, ampiezza e tendenza (17/10 sera) — informazione, non prove
- `[fear_greed]` il Fear & Greed della CNN accanto al VIX, con la data della rilevazione, i confronti che la fonte porta e il suo anno, e la sovrapposizione con VIX e put/call dichiarata (24/10) — informazione, non una prova
- `[vwap]` il VWAP dall'ultima trimestrale accanto ai pavimenti di ogni titolo (18/10)
- `[segnali_misurati]` i segnali di mercato misurati e lasciati come informazione (18/10)
- `[credito_salute]` la salute del credito di ogni nome — CDS con rincaro improvviso, allargamento e divergenza dal titolo, Altman con la frequenza storica d'insolvenza per orizzonte, il debito dai bilanci depositati (18/10)
- `[credito_brief]` gli eventi del CDS nel brief delle due letture del giorno (18/10)
- `[concorrenti]` i concorrenti e le quote di mercato di ogni posizione con fonte e data, e la salute di ciascuno misurata con le stesse formule — e per i sorvegliati che diventano un ingresso, prima dell'ingresso (18/10 sera)
- `[solidita]` le due solidità di ogni nome — patrimoniale (il bilancio a una data) e operativa (la cassa dell'attività) — col rischio storico e il rendimento del prezzo accanto, da dove vengono un circolante o un patrimonio negativi, e il ciclo di cassa anche nel confronto coi concorrenti (18/10 sera)
- `[scheda]` la SCHEDA COMPLETA di ogni analisi, scritta dallo script e mandata come allegato: tutto ciò che gli strumenti stampano, per sezione e per nome, con l'indice di queste richieste e quanti nomi portano ciascuna (19/10)
- `[ipervenduto]` ipervenduto e ipercomprato coi quattro oscillatori, e il supporto e l'accumulo contati condizione per condizione, su ogni posizione e ogni sorvegliato (25/10) — informazione, non una prova
- `[stagionalita]` la stagionalità del titolo nel mese in corso e nel successivo col campione, e del Nasdaq-100 negli anni dello stesso ciclo presidenziale (25/10) — informazione, non una previsione
- `[due_tempi]` l'analisi in due tempi: prima l'analisi, che chiude con domande mirate; poi il ragionamento col CEO in chat sulle sue risposte (25/10)
- `[wsb]` WallStreetBets: rango, menzioni delle ultime 24 ore e impennate dei nomi del libro e dei sorvegliati, con la memoria giornaliera — l'attenzione della folla, non una fonte di fatti (30/10) — informazione, non una prova
- `[peg]` il PEG sull'esercizio prossimo con la sua crescita dichiarata (il consenso dell'esercizio in corso e del prossimo, stessa tabella), accanto a quello dell'aggregatore (30/10) — una metrica, non una prova
- `[stato_sistema]` il controllo generico dello stato del sistema in chiusura di ogni analisi e di ogni giro di lavoro: codice e test, pipeline su GitHub e fonti non lette, letture del giro, dipendenze da GitHub con la loro data, coerenza delle copie del libro, domande aperte al CEO con la loro età (30/10)
- `[cambio]` il cambio euro/dollaro: quanta parte del patrimonio è in dollari e cosa fa un 1% del cambio, dove sta il cambio nel suo anno, e per ogni operazione col suo cambio (LIBRO.md §1decies) il risultato in euro scomposto in effetto del prezzo ed effetto del cambio, con l'imposta in euro (30/10)
- `[rendimento_capitale]` ROIC e ROE di ogni posizione e sorvegliato e dei concorrenti, dai bilanci con la data dei 12 mesi e degli esercizi chiusi: il ROIC sul capitale investito come la fonte lo pubblica, il ROE con la leva dichiarata quando il patrimonio e' meno di meta' del capitale, il ROE della fonte dichiarato quando differisce (31/10) — informazione, non una prova
- `[roi_conto]` il ROI del conto dalla fotografia del broker (LIBRO.md §1duodecies): il guadagno sul carico delle posizioni aperte in euro e in dollari, il carico in euro di ogni posizione come base fiscale col risultato fra prezzo e cambio, le operazioni chiuse con le imposte, e il ROI dall'inizio del conto dichiarato non calcolabile finche' mancano i versamenti (31/10)

Una richiesta nuova si aggiunge qui E nel REGISTRO di `scripts/scheda.py`, nello stesso giorno in cui diventa uno
strumento: il gate della v505 non lascia l'una senza l'altra.

## Regole
- **Quando il CEO comunica un'operazione** (broker Sella, X-Trading; CEO, 30/10/2026: *"in futuro quando effettuo
  operazioni … valuta anche il cambio euro dollaro"*): si scrive in LIBRO.md §1 e nel registro §1decies col **cambio
  della seduta** — quello applicato dal broker se il CEO lo dà, altrimenti il riferimento BCE con la sua data —, il
  controvalore in euro e la liquidità nuova; e nella risposta si dice dove sta il cambio nel suo anno, quanta parte del
  patrimonio è in dollari dopo l'operazione e cosa fa un 1% del cambio, e che la plusvalenza in euro si calcolerà col
  cambio d'acquisto e di vendita. Una seduta non dichiarata si ricava dal prezzo solo se cade in UNA seduta; se cade in
  più d'una si registra la più recente e si chiede (v396). È informazione: il cambio non si prevede.
- Direzione, priorità e livelli sì; le quantità solo come aritmetica dichiarata (v439).
- Ogni numero porta la sua data e il suo denominatore; ciò che manca si dichiara.
- **Un dato vecchio non si usa come se fosse di oggi** (CEO, 25/10/2026: *"dati non aggiornati non sono affidabili …
  non voglio avere mai errori simili"*). Un periodo in formazione — la seduta in corso, il mese non concluso, il
  trimestre non ancora depositato — non si legge come concluso; un dato che la pipeline porta da un run vecchio si
  legge dalla fonte di adesso (DATI PER TITOLO) o si cerca in rete con fonte e data; se non si trova, dato non
  disponibile.
- **Ogni orario di un evento si scrive in ora italiana, preso dalla fonte ufficiale nel suo
  fuso e convertito col fuso** (v470): le aste dal blocco ASTE del brief (TreasuryDirect, ora
  di New York); Fed e dati macro dal calendario dell'ente, che li dà in ora di New York. Un
  orario letto su un calendario web senza fuso dichiarato non si pubblica: il 07/10 l'analisi
  ha scritto «asta alle 17:00», che era l'ora UTC — in Italia erano le 19:00.
- Va dichiarato il conflitto di interessi su Anthropic, che ha creato il modello che scrive l'analisi, e
  sui suoi azionisti quando compaiono: NVIDIA e Microsoft (impegni d'investimento annunciati il
  18/11/2025), Alphabet e Amazon. OpenAI, concorrente di Anthropic, è il cliente principale di
  CoreWeave, Oracle e Cerebras. SpaceX possiede xAI (Grok), concorrente di Anthropic: fusione chiusa
  il 02/02/2026. Le notizie su Anthropic stessa si riportano come le riportano le fonti, dichiarando
  il conflitto. Fino al 15/10/2026 la regola nominava solo Amazon: NVIDIA, che pesa un quinto del
  libro, mancava; SpaceX è stata aggiunta lo stesso giorno, quando è entrata nell'analisi.
  Fra gli investitori dei round di Anthropic ci sono anche fondi affiliati di **BlackRock** e la
  divisione Growth Equity di **Goldman Sachs Alternatives** (Series F, settembre 2025) e **Salesforce
  Ventures** (Series C, maggio 2023): BLK, GS e CRM portano la stessa dichiarazione. Aggiunti il
  15/10/2026 sera, quando banche e software sono entrati nella valutazione della rotazione.
- Rapporto HTML solo se richiesto: costa token (decisione del CEO).
- **La SCHEDA COMPLETA si manda SEMPRE come allegato** (v505, decisione del CEO del 19/10/2026: «B»): il comando la
  scrive in `memoria/dati/scheda_analisi_<data>_<ora>.md` e il suo riepilogo sta sopra questa checklist. La risposta
  rimanda alla scheda per i dati nome per nome e non riscrive le righe che la scheda porta per intero; se il riepilogo
  dice RICHIESTA SENZA RIGHE OGGI, o uno strumento è fallito, la risposta lo dice in cima.
