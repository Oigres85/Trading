# Formato dell'analisi del libro (deciso dal CEO il 04/10/2026)

Il CEO chiede l'analisi **ogni giorno, in chat**. Nessuna Routine settimanale: sarebbe un
doppione. Il formato è quello del rapporto «da comitato d'investimento» del 02/10/2026, ridotto
alla misura di un giorno.

## Come si produce
0. **Prima dell'apertura americana (prima delle 15:30 italiane) l'analisi parte dal PRE-MARKET**
   (istruzione del CEO, 06/10/2026): `python3 scripts/numeri_libro.py --esteso` — risultato del
   libro sul prezzo esteso, livelli ricalcolati su quel prezzo, titoli che fuori sessione stanno
   già oltre resistenza o supporto. Dopo la chiusura lo stesso comando dà l'after-hours.
   ⚠ Il pre-market ha volumi sottili: è un'indicazione dell'apertura, non un prezzo su cui decidere.
1. `python3 scripts/numeri_libro.py` — l'ultima seduta (`--sedute 5` per la settimana).
   Lo script CALCOLA e basta; il giudizio lo scrive il modello.
2. `python3 scripts/brief.py` — notizie, mossi in ATR, livelli, macro.
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
   Treasury 10 anni 5,0 / 5,4), trimestrali e Fed nei prossimi giorni.
6. **Piano con soglie** — stato di ciascuna condizione già decisa (BE 295-302, AMD respinto a 645, RGTI sotto 14,41,
   MU 1.100-1.108 con la compensazione RGTI, i supporti di protezione).

7. **Watchlist e rotazione** (sempre, v468) — a) i settori IN TENDENZA con bassa correlazione
   col libro (dove il denaro va senza replicare la nostra scommessa); b) per ciascuno i titoli
   CANDIDATI di `rotazione.py`, coi livelli; c) i nomi già in watchlist: chi è nella propria
   zona d'ingresso, chi è ESTESO (si aspetta), chi è sotto la 200 (non si entra). Il semaforo
   decide cosa è ammesso: in giallo niente nuovi semiconduttori.

## Regole
- Direzione, priorità e livelli sì; le quantità solo come aritmetica dichiarata (v439).
- Ogni numero porta la sua data e il suo denominatore; ciò che manca si dichiara.
- Su Anthropic e AMZN va dichiarato il conflitto di interessi.
- Rapporto HTML solo se richiesto: costa token (decisione del CEO).
