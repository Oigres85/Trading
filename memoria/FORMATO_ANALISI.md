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

**Il comando: `python3 scripts/analisi.py`** (v473). Esegue in parallelo tutti gli strumenti
qui sotto, sceglie da solo pre-market / seduta / after-hours dall'ora di New York, dichiara lo
strumento che fallisce e chiude con la CHECKLIST — la sezione «Cosa contiene la risposta» di
questo file, stampata parola per parola. Un gate verifica che gli strumenti del comando siano
esattamente quelli nominati qui sotto: uno strumento nuovo si aggiunge in tutti e due i posti.

## Come si produce
0. **Prima dell'apertura americana (prima delle 15:30 italiane) l'analisi parte dal PRE-MARKET**
   (istruzione del CEO, 06/10/2026): `python3 scripts/numeri_libro.py --esteso` — risultato del
   libro sul prezzo esteso, livelli ricalcolati su quel prezzo, titoli che fuori sessione stanno
   già oltre resistenza o supporto. Dopo la chiusura lo stesso comando dà l'after-hours.
   ⚠ Il pre-market ha volumi sottili: è un'indicazione dell'apertura, non un prezzo su cui decidere.
1. `python3 scripts/numeri_libro.py` — l'ultima seduta (`--sedute 5` per la settimana).
   Lo script CALCOLA e basta; il giudizio lo scrive il modello.
2. `python3 scripts/brief.py` — notizie, mossi in ATR, livelli, macro, e (v470) le aste di
   note e bond del Tesoro USA dei prossimi 7 giorni con l'ora italiana e gli esiti recenti.
3. `python3 scripts/schede_progetto.py` (v462, su richiesta del CEO del 06/10) — per ogni nome
   del libro i blocchi che la pipeline pubblica: sensibilità a mercato, comparto, tassi e
   dollaro col loro R² (anno, trimestre, giornate forti), revisioni delle stime, autonomia di
   cassa e copertura degli oneri per chi brucia cassa, short interest, ultimo deposito SEC.
   Entra SEMPRE nei punti 3-5 della risposta: un canale sotto il rumore si dice non
   misurabile, una revisione si legge dalla differenza. ⚠ Il FedWatch derivato dal future
   NON si usa come misura (v450): per la Fed mercati di previsione + verifica online.
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

## Cosa contiene la risposta, in quest'ordine
0. **Semaforo d'uscita** (decisione del CEO del 06/10): il colore di oggi in UNA riga, con i
   segnali accesi nominati — regole in `memoria/LIBRO.md` §1ter. Se il colore cambia dal giorno
   prima, va in cima alla risposta e prima di tutto il resto.
0bis. **Costo dell'attesa e scadenze** (decisione del CEO del 06/10, regole in `memoria/LIBRO.md`
   §1quater): il blocco `COSTO DELL'ATTESA` / `SCADENZE` di `numeri_libro.py`, e per ogni
   decisione aperta del piano la sua scadenza (prima trimestrale del nome) e i giorni che mancano.
   Le protezioni non ancora messe si segnalano qui, ogni giorno, finché non lo sono.
0ter. **Credito sul libro** (v467, regola in `memoria/LIBRO.md` §1ter): il blocco `CREDITO SUL
   LIBRO` di `numeri_libro.py` — chi brucia cassa, il suo peso, le tre condizioni. Se la conferma
   è accesa, gli stop su quei nomi passano in cima alle decisioni. Non cambia il colore del semaforo.
1. **Sintesi in 3-5 punti** — cosa è successo, perché, cosa cambia per il libro.
2. **Risultato contro i riferimenti** — libro contro QQQ, SMH, SPY, RSP; chi ha portato il risultato.
3. **Rischio** — peso contro quota del rischio; beta sul Nasdaq col suo R²; segnalare solo se cambia.
   Più i CANALI accesi di ciascun nome (schede_progetto): da quale fattore arriva il rischio.
4. **Tecnica** — solo i nomi vicini a resistenza o supporto (distanze in ATR), o sotto la SMA200.
5. **Macro e catalizzatori** — e per le trimestrali vicine le revisioni delle stime e, per chi
   brucia cassa, l'autonomia: sono le due cose che una trimestrale riprezza.
   Soglie macro decise prima (spread credito alto rendimento 3,5;
   Treasury 10 anni 5,0 / 5,4), trimestrali, Fed e aste del Tesoro nei prossimi giorni.
6. **Piano con soglie** — stato di ciascuna condizione già decisa (BE 295-302, AMD respinto a 645, RGTI sotto 14,41,
   MU 1.100-1.108 con la compensazione RGTI, i supporti di protezione).

7. **Watchlist e rotazione** (sempre, v468) — il semaforo decide cosa è ammesso: in giallo
   niente nuovi semiconduttori.
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

**Richieste del CEO rese strutturali — entrano TUTTE in ogni «Aggiorna analisi»**: semaforo
d'uscita (06/10) · costo dell'attesa e scadenze (06/10) · pre-market prima dell'apertura (06/10) ·
schede del progetto (06/10) · credito sul libro (07/10) · rotazione con candidati, tecnica,
volumi e notizie (07/10) · target, beta e volatilità (07/10) · volumi come percentile 0-100
(08/10) · aste del Tesoro in ora italiana (07/10) · ingressi sulla watchlist (09/10).
Una richiesta nuova si aggiunge qui, nello stesso giorno in cui diventa uno strumento.

## Regole
- Direzione, priorità e livelli sì; le quantità solo come aritmetica dichiarata (v439).
- Ogni numero porta la sua data e il suo denominatore; ciò che manca si dichiara.
- **Ogni orario di un evento si scrive in ora italiana, preso dalla fonte ufficiale nel suo
  fuso e convertito col fuso** (v470): le aste dal blocco ASTE del brief (TreasuryDirect, ora
  di New York); Fed e dati macro dal calendario dell'ente, che li dà in ora di New York. Un
  orario letto su un calendario web senza fuso dichiarato non si pubblica: il 07/10 l'analisi
  ha scritto «asta alle 17:00», che era l'ora UTC — in Italia erano le 19:00.
- Su Anthropic e AMZN va dichiarato il conflitto di interessi.
- Rapporto HTML solo se richiesto: costa token (decisione del CEO).
