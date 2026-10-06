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
3. Ricerca web sulle notizie che spiegano i movimenti, con fonte e data.

## Cosa contiene la risposta, in quest'ordine
1. **Sintesi in 3-5 punti** — cosa è successo, perché, cosa cambia per il libro.
2. **Risultato contro i riferimenti** — libro contro QQQ, SMH, SPY, RSP; chi ha portato il risultato.
3. **Rischio** — peso contro quota del rischio; beta sul Nasdaq col suo R²; segnalare solo se cambia.
4. **Tecnica** — solo i nomi vicini a resistenza o supporto (distanze in ATR), o sotto la SMA200.
5. **Macro e catalizzatori** — soglie decise prima (spread credito alto rendimento 3,5;
   Treasury 10 anni 5,0 / 5,4), trimestrali e Fed nei prossimi giorni.
6. **Piano con soglie** — stato di ciascuna condizione già decisa (ordine ORCL 143, BE 295-302,
   MU 1.100-1.108 con la compensazione RGTI, i supporti di protezione).

## Regole
- Direzione, priorità e livelli sì; le quantità solo come aritmetica dichiarata (v439).
- Ogni numero porta la sua data e il suo denominatore; ciò che manca si dichiara.
- Su Anthropic e AMZN va dichiarato il conflitto di interessi.
- Rapporto HTML solo se richiesto: costa token (decisione del CEO).
