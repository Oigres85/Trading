# IL LIBRO — memoria di lavoro

> Questo file È la fonte di verità da quando abbiamo bypassato il sistema (08/09/2026).
> Sostituisce `config/posizioni.json` + `config/portfolio_state.json` + il blocco di rischio
> di `data/data.json`. Va aggiornato a mano quando il CEO opera.

## 0. OBIETTIVO E RIFERIMENTO — deciso dal CEO il 09/10/2026

Obiettivo dichiarato dal CEO: *"sovraperformare l'indice"*. Il riferimento è **QQQ (Nasdaq 100)**:
è il confronto onesto per un libro growth e tecnologico, le cui azioni si muovono circa 2,2 volte
quell'indice. Lo misura il **registro della performance** (`memoria/registro_performance.jsonl`,
v474): una riga per seduta conclusa, scritta da `python3 scripts/numeri_libro.py --registra` (lo
fa `scripts/analisi.py` a ogni «Aggiorna analisi» fuori dalla seduta), col libro azionario in
dollari e il patrimonio intero in euro contro QQQ, a rendimento ponderato per il tempo. Parte
dalla chiusura del 09/10/2026: nessun numero prima di quella data è nel registro.
⚠ Sovraperformare con un beta di 2 vuol dire anche sottoperformare di più quando il Nasdaq scende:
il registro misura entrambi i versi, e il semaforo (§1ter) resta la regola d'uscita.

## 1. POSIZIONI — confermate dal CEO l'08/09/2026

| Ticker | Quantità | PMC | Valuta | Note |
|---|---|---|---|---|
| NVDA | 270 | **87,1667** | USD | ⚠ confermato dal CEO: `portfolio_state.json` diceva 81,167 ed era sbagliato |
| MSTR | 173 | 173,3045 | USD | |
| CRWV | 255 | 76,14 | USD | media del CEO del 23/10/2026: +50 azioni a ~54,53 $, ricavato dal carico che il broker dichiara (da 81,41 a 76,14); il 20/10/2026: +50 a ~63,86 $ (da 87,07 a 81,41); la prima il 14/10/2026: +50 a ~65,80 $ (da 97,199 a 87,07) |
| AMD | 100 | 153,916 | USD | |
| PLTR | 100 | 113,50 | USD | |
| MU | 70 | 87,63 | USD | |
| RGTI | 663 | 22,147 | USD | media del CEO del 14/10/2026: +200 azioni a ~12,06 $ (carico da 26,5048 a 22,147) |
| SKHY | 45 | 139,00 | USD | SK hynix, listata a Seoul — emittente estero, deposita 6-K/20-F |
| MRVL | 42 | 214,08 | USD | |
| BE | 40 | 214,00 | USD | |
| BTP-V28 | 40.000 nominali | 100 | EUR | BTP Valore Ott 2028 — valorizzato nominale × prezzo/100 |

⚠ **SMCI — venduta per intero il 19/10/2026**: 250 azioni a **32,81 $**, comprate il 16/10 a 31,60 con l'ordine
giornaliero (§1septies). Il CEO, testuale: *"Smci vendute 250 a 32,81 non mi fido per ora e ho fatto un minimo di
speculazione"*. Plusvalenza (32,81 − 31,60) × 250 = **+302,50 $** (+3,8% in due sedute), imposta ~79 $ al 26% — il conto
definitivo lo fa il broker in euro, col cambio di carico. Resta fra i sorvegliati (§1bis).

**Liquidità: ~47.040 €** IN TUTTO, bloccata compresa — **una stima, da confermare col saldo del broker**: i 45.000 €
dichiarati dal CEO il 17/10/2026 (testuale: *"La liquiditita è di 45k"*), più la vendita di SMCI del 19/10 (250 × 32,81 $
= 8.202,50 $ ≈ 7.317 € a EUR/USD 1,121, il cambio della pipeline quel giorno) e meno le due medie di CRWV, del 20/10
(205 × 81,41 − 155 × 87,07 = 3.193,20 $ ≈ 2.842 € a 1,1236) e del 23/10 (255 × 76,14 − 205 × 81,41 = 2.726,65 $ ≈
2.435 € a 1,1196). Imposta sulla plusvalenza di SMCI e commissioni escluse.
In §1septies non c'è nessun ordine: per quanto il sistema sa, è tutta libera. La liquidità si scrive in tutto perché un ordine non
eseguito non ha speso niente: se si esegue, qui si toglie la sua spesa e in alto entra la posizione; se scade, questo
numero non cambia. La libera la calcola `numeri_libro.py` (blocco «ORDINI APERTI») togliendo gli ordini ancora attivi (v490).
⚠⚠ **Fino al 17/10 mattina qui c'era scritto ~72.360 €: 27.360 € di troppo, ed era un conto mio.** Il 15/10 sera il CEO
aveva scritto *"Liquidità è 56.600 euro senza contare la liquidità bloccata per gli ordini non ancora eseguiti"* e io
avevo letto i 56.600 € come la sola parte libera, **sommandoci** la parte bloccata dai tre ordini di quel giorno
(25.577,50 $ ai limiti ≈ 22.800 €): ~79.400 €, meno l'acquisto di SMCI del 16/10 (250 a 31,60 $ = 7.900 $ ≈ 7.040 €).
Misurata contro la dichiarazione di oggi, quella lettura è la più lontana delle tre possibili:

| lettura | 16/10 sera | scarto da 45.000 € |
|---|---|---|
| i 56.600 € erano la sola libera, più ~22.800 € bloccati (la mia) | ~72.360 € | +27.360 € |
| i 56.600 € erano già il totale | ~49.560 € | +4.560 € |
| la stima del 14/10 (~53.870 €, un conto) meno SMCI | ~46.830 € | +1.830 € |

Lo scarto residuo **non è spiegato dai dati qui presenti** (commissioni, cambio, altri movimenti): non si indovina, vale
la dichiarazione. ⚠ E la verifica scritta il 15/10 — il blocco ORDINI APERTI che «ritrovava da solo» i 56.600 € (v490) —
era **circolare**: il totale era costruito sommando la bloccata ai 56.600, e la libera è il totale meno la bloccata,
quindi ritrovava il proprio ingresso e non provava niente.
Ordini dal 15/10: i tre del 15/10 **scaduti senza esecuzione** alle 22:00 (il CEO, testuale: *"Nessun ordine è
passato"*); dei tre del 16/10 SMCI eseguito (qui sopra), ORCL e OKLO **scaduti senza esecuzione** — il minimo della
seduta, 127,36 e 27,59, non è mai sceso ai limiti, 122 e 24 — e tolti dalla tabella il 17/10 su conferma del CEO (§1septies).
Storia della stima precedente: ~59.000 € fino al 14/10/2026, **meno le due medie** del 14/10: RGTI 200 azioni
per ~2.412 $ (663 × 22,147 − 463 × 26,5048) e CRWV 50 azioni per ~3.290 $ (155 × 87,07 − 105 × 97,199),
~5.702 $ in tutto, ≈ 5.126 € a EUR/USD 1,1123, commissioni escluse — **da confermare** col saldo del broker. I ~59.000 € erano ~50.000 € dichiarati dal CEO il 01/10/2026 ("circa", dopo le uscite da
GOOGL e WDC) **più l'incasso di ORCL del 05/10/2026**: 70 azioni vendute a **145,55 $** = 10.188,50 $
(≈ 9.050 € a EUR/USD 1,1255; se restano in dollari sul conto, il controvalore in euro si muove col cambio).
Plusvalenza ORCL: (145,55 − 143,00) × 70 = **+178,50 $**, imposta ~46 $ al 26% — il conto definitivo lo fa
il broker in euro, col cambio di carico.
Destinazione dichiarata: acquisti su storni e IPO di Anthropic.

> ⚠ **USCITE DICHIARATE DAL CEO il 01/10/2026: GOOGL (50) e WDC (25) venduti per intero "la
> settimana scorsa", con un guadagno di circa il 2% su entrambi.** Prezzi e data esatti NON
> confermati: ~+2% sul PMC corrisponde a ~347 $ (GOOGL) e ~467 $ (WDC). Il ricavato, al netto
> dell'imposta, è **liquidità o è stato reinvestito: da confermare**. Finché non lo è, la
> liquidità qui sopra è SOTTOSTIMATA, e le misure del livello C sotto (fotografia del 07/09)
> includono ancora i due titoli: pesi e contributo al rischio vanno ricalcolati.
> Dal 15/10/2026 sera la liquidità qui sopra è quella **dichiarata dal CEO**, non più un conto: il dubbio sul
> ricavato di GOOGL e WDC non pesa più su quel numero. Resta valido per la fotografia del 07/09.

⚠ Il sistema NON conosce: altri conti, altri strumenti, posizioni corte, margine, coperture,
situazione fiscale. **Il divieto di dimensionare resta in piedi**: direzione, priorità e livelli
di prezzo sì; quantità no.

⚠ **NESSUN TETTO ALLE MEMORIE — decisione del CEO del 14/10/2026**, testuale: *"Nessuna regola di
tetto per memorie, se possono dare frutti possono superare il 26,4%"*. La proposta di un tetto
per MU + SK hynix intorno al 20% del libro (12-13/10) è **respinta**: il peso delle memorie non ha
un limite, e SK hynix resta in portafoglio senza uno stop di prezzo. Il 14/10 le memorie pesano
il 26,4% del libro e MU da sola porta il 34% del rischio: senza tetto, se salgono, quelle quote
crescono da sole, e il blocco dei pesi di `numeri_libro.py` le mostra a ogni analisi.
**Resta in vigore**, perché non è un tetto, il salvavita (§1ter): a −30% dal massimo
dell'azionario la riduzione dei semiconduttori segue il rischio di ciascuno — MU, che porta più
rischio di quanto pesa, si taglia di più di un terzo — qualunque sia il peso delle memorie
(decisione del CEO del 14/10/2026). Dal 15/10/2026 arancione e rosso non vendono più (§1ter).
**Il piano di vendita di MU nella fascia 1.100-1.108 è REVOCATO il 14/10/2026** dalla regola di
tenuta (§1sexies): era una presa di profitto a una fascia di prezzo, e il CEO ha deciso che si
vende per evidenza, non per prezzo.

## 1bis. SORVEGLIATI — non in posizione, monitorati come i titoli del libro

Il CEO li segue per una rotazione possibile. **Non sono posizioni**: non entrano nel patrimonio,
nei pesi, nel contributo al rischio ne' in nessuna misura del libro. Entrano solo nella lettura
tecnica e nelle notizie, con l'etichetta che dichiara cosa sono.

| Ticker | Nota |
|---|---|
| OKLO | Oklo — reattori nucleari modulari per datacenter. Candidato di rotazione da CRWV (CEO, 14/09/2026) |
| SMCI | Super Micro Computer — server AI, concorrente di DELL. **Venduta il 19/10/2026 a 32,81 $** (250 azioni comprate il 16/10 a 31,60): il CEO *"non mi fido per ora"*. Candidato di rotazione da CRWV dal 14/09/2026. Il 18/10: bilancio solido (Altman 6,77) e cassa dell'attività negativa (−6,8 miliardi di flusso operativo in 12 mesi, magazzino a 128 giorni) |
| AMZN | Amazon — candidato d'ingresso (CEO, 02/10/2026). Diversifica in parte dal gruppo AI e porta ~15-20% di Anthropic. Livelli: acquisto 244-246 (supporto 244,30), uscita sotto SMA200 ~240. Trimestrale 29/10 |
| STX | Seagate — candidato d'ingresso (CEO, 02/10/2026). Leader tecnologico dischi (HAMR), stesso ciclo di WDC. Livelli: ingresso vicino al supporto 758 solo se regge 2-3 sedute, o dopo la trimestrale 27-28/10; uscita sotto 758 |
| GOOGL | Alphabet — uscito dal libro a ~+2% (fine settembre); rientro valutato sul supporto 327,74 o sopra 364 |
| WDC | Western Digital — uscito dal libro a ~+2%; ciclo dischi in allentamento (Toshiba), indietro su HAMR |
| TSM | TSMC — collo di bottiglia CoWoS; trimestrale 15/10 |
| CBRS | Cerebras — quotata da maggio 2026; lock-up principale a meta' novembre, ~80% degli ordini da OpenAI |
| INTC | Intel — in watchlist del CEO |
| SPCX | SpaceX — in watchlist del CEO, quotata di recente (storia corta) |
| TSLA | Tesla — in watchlist del CEO |
| CEG | Constellation — nucleare esistente, correlazione bassa col libro (0,2-0,4); livelli 247 / ~270 |
| NFLX | Netflix — in tendenza ribassista; ingresso solo sopra la SMA50 (~75,6) |
| MSFT | Microsoft — in watchlist del CEO |
| AAPL | Apple — in watchlist del CEO |
| META | Meta — in watchlist del CEO |
| CRM | Salesforce — software applicativo, pressione da agenti AI. Zona d'ingresso 221-228 (supporto a 20 sedute 221,18), correlazione col libro 0-0,3 (CEO, 06/10/2026); uscita sotto il supporto |
| NOW | ServiceNow — software applicativo, pressione da agenti AI. Zona d'ingresso 130-136 (supporto a 20 sedute 126,75), correlazione col libro 0-0,3 (CEO, 06/10/2026); uscita sotto il supporto |
| AVGO | Broadcom — chip su misura e reti per AI |
| ASML | ASML — litografia, fornitore unico di EUV |
| NKE | Nike — conti del 01/10 deboli, sotto il minimo a 52 settimane; non entrare |
| ORCL | Oracle — **venduta il 05/10/2026 a 145,55 $** (70 azioni, carico 143). Rientro solo sopra la SMA200 (~163) o sul supporto 131,58 se regge |
| MCD | McDonald's — difensivo vicino ai minimi; aspettare la fine della discesa |
| CCJ | Cameco — uranio (CEO, 04/10/2026). Sotto SMA50 e SMA200, −37% dal massimo a 52 settimane; a 0,4 ATR dal supporto 83,80. Correlazione col libro ~0,5. Trimestrale 04/11 |
| TTWO | Take-Two — videogiochi (CEO, 04/10/2026). Unico con correlazione ~0 col libro (SMH 0,05, MU −0,02): diversifica davvero. Sotto le medie, a 0,5 ATR dal supporto 199,46. Trimestrale 05/11 |
| ANET | Arista — reti per datacenter AI (CEO, 07/10/2026). Al massimo a 52 settimane, ~3 ATR sopra la SMA50 (~195): ingresso solo su ritorno verso la SMA50, non all'inseguimento. Dentro il tema AI: non diversifica |
| CRWD | CrowdStrike — sicurezza informatica (CEO, 07/10/2026). Vicino al massimo, ~5 ATR sopra la SMA50 (~224): troppo tirato, attendere un ritorno verso la SMA50 |
| PANW | Palo Alto Networks — sicurezza informatica (CEO, 07/10/2026). Vicino al massimo, ~3 ATR sopra la SMA50 (~366): attendere un ritorno verso la SMA50 |
| NET | Cloudflare — rete e sicurezza edge (CEO, 07/10/2026). ~3 ATR sopra la SMA50 (~311): attendere un ritorno verso la SMA50 |
| DDOG | Datadog — monitoraggio cloud (CEO, 07/10/2026). ~3 ATR sopra la SMA50 (~246): attendere un ritorno verso la SMA50 |
| XOM | Exxon Mobil — energia (rotazione, CEO 07/10/2026). Settore in tendenza e correlazione negativa col libro: copre lo scenario petrolio→inflazione→tassi. Supporto 20 sedute 155,85 |
| CVX | Chevron — energia (rotazione, CEO 07/10/2026). Supporto 20 sedute 200,78 |
| COP | ConocoPhillips — energia, produzione pura (rotazione, CEO 07/10/2026). Sulla SMA50; supporto 123,46 |
| ABBV | AbbVie — salute (rotazione, CEO 07/10/2026). Sopra le medie, vicino alla resistenza 269,39: ingresso su ritorno verso la SMA50; supporto 246,77 |
| MRK | Merck — salute (rotazione, CEO 07/10/2026). Sulla SMA50; supporto 138,80 |
| GILD | Gilead — farmaceutico (rotazione, CEO 07/10/2026). Sulla SMA50, supporto 142,60 a 0,5 ATR |
| AMGN | Amgen — farmaceutico (rotazione, CEO 07/10/2026). Poco sotto la SMA50; supporto 374,46 |
| V | Visa — finanziari/pagamenti (rotazione, CEO 07/10/2026). Settore finanziario debole, Visa sopra le medie; supporto 356,75 |
| MA | Mastercard — finanziari/pagamenti (rotazione, CEO 07/10/2026). Poco sotto la SMA50; supporto 545,40. Stessa scommessa di V: uno dei due, non entrambi |
| PM | Philip Morris — consumi difensivi (rotazione, CEO 07/10/2026). Correlazione col libro la piu' negativa del gruppo; supporto 181,55 |
| DE | Deere — industriali (rotazione, CEO 07/10/2026). Settore in ribasso, DE in tendenza propria; supporto 644,06 |
| DIS | Disney — comunicazioni (rotazione, CEO 07/10/2026). Appena sopra la SMA200; supporto 101,15 |
| PFE | Pfizer — farmaceutico (CEO, 08/10/2026). Sopra la SMA50 e la SMA200, −5% dal massimo a 52 settimane; correlazione col libro ~−0,1: diversifica. Supporto 20 sedute 27,12, resistenza 28,95 |
| GS | Goldman Sachs — banca d'investimento (CEO, 14/10/2026). Trimestrale del 13/10 sopra le attese (utile per azione 17,01 $ contro 12,86), ma il titolo ha chiuso quasi fermo (891,91, −0,2%) su volumi al massimo dell'anno. Sotto la SMA200 (~960) con la SMA50 in discesa; supporto 20 sedute 868,52. Correlazione col libro ~0,64: si muove con la stessa scommessa, non diversifica |
| JPM | JPMorgan Chase — banca universale (CEO, 14/10/2026). Trimestrale del 13/10 sotto le attese (utile rettificato per azione 5,75 $ contro 5,93). Sotto la SMA50 (~349), sopra la SMA200 (~322); supporto 20 sedute 325,07. Correlazione col libro ~0,25: diversifica. Con GS ~0,6: in buona parte la stessa scommessa, uno dei due |
| BLK | BlackRock — gestione patrimoniale (CEO, 15/10/2026). Trimestrale del 14/10 sopra le attese: utile per azione rettificato 15,93 $ contro un consenso fra 14,24 e 14,40 secondo le fonti di stima (10,57 secondo i principi contabili, depresso da una rettifica non monetaria su acquisizioni passate), ricavi +19% sull'anno, 205 miliardi di afflussi netti nel trimestre, patrimonio gestito 15.500 miliardi. Il 14/10 ha aperto a +2,1%, toccato 1.106 e chiuso a 1.073,79 (+0,7%) su volumi al 90° percentile dell'anno: ha restituito gran parte del rialzo. Sotto la SMA50 (~1.107), sopra la SMA200 (~1.061); supporto 20 sedute 1.040,42. Correlazione col libro ~0,17: diversifica. Con GS ~0,5 e JPM ~0,6: in buona parte la stessa scommessa finanziaria. Fra i mandati il comunicato cita i finanziamenti agli hyperscaler: un canale verso il tema AI che la correlazione di oggi non mostra |
| LLY | Eli Lilly — farmaci per obesita' e diabete (CEO, 17/10/2026). Il 16/10 a 1.257,03: -2,8% dal massimo storico (1.292,65 del 19/08), +9,1% in un mese ma con la media dei volumi a 20 sedute al 5° percentile dell'anno, cioe' un rialzo con poca partecipazione. La spinta del 14-15/10 sono i dati di Foundayo (il GLP-1 orale) e il posizionamento prima dei conti; il 30/09 la combinazione con eloralintide aveva dato il 23% di calo del peso ma piu' abbandoni per effetti collaterali, e il titolo era sceso. Sopra la zona d'ingresso: tirato, non si insegue. Pavimenti 1.163,50 (1 tocco) e 1.131-1.134 (2 tocchi, l'ultimo l'08/10). Correlazione col libro ~-0,37 e con QQQ ~-0,30 (60 sedute), beta sull'S&P 500 0,25: diversifica davvero. Con ABBV, AMGN e PFE ~0,6, con MRK e GILD ~0,4-0,5: dentro il farmaceutico e' in buona parte la stessa scommessa |
| DELL | Dell Technologies — server e PC, concorrente diretto di SMCI (CEO, 18/10/2026). Il 14-15/10 −17% in due sedute dopo il declassamento di Barclays (da Overweight a Equal Weight, obiettivo da 603 a 574: le valutazioni dell'hardware sono salite più delle prove di spesa AI delle imprese, e i ricavi li gonfia il prezzo delle memorie); conti del 01/09 sopra le attese (EPS 6,76 contro 4,72 secondo Nasdaq), ricavi +58% sull'anno. Il 16/10 a 451,71: −24% dal massimo del 18/09 (595,51), doppio massimo 595 confermato sotto il collo 520,18, struttura rotta al ribasso, sotto il VWAP dai conti (532,79). Pavimenti 421,89–424,00 (2 tocchi, l'ultimo il 01/09; stop 390,07) e 368,14–378,66. Correlazione col libro ~0,64: stessa scommessa, non diversifica. Il CDS compensato a ICE è su Dell Inc, la controllata operativa. Trimestrale 24/11 |

⚠ **Un candidato di rotazione dentro lo stesso tema NON diversifica**: sposta la stessa scommessa
su un altro nome. SMCI e OKLO vivono entrambi sul capex AI, che e' il canale su cui il libro e'
gia' concentrato.

**Ingressi sui minimi: i PAVIMENTI** (decisione del CEO del 15/10/2026, testuale: *"Non voglio entrare
quando risalgono, ma voglio entrare sui minimi"*; poi *"Sì"* a renderli un calcolo con le stesse regole per
tutti i titoli). `rotazione.py` li calcola per ogni sorvegliato e li porta nella sezione 7 di ogni analisi.
Convenzioni scelte da Claude e dichiarate come tali (v240), rilette dal codice da un gate:
- **Finestra**: gli ultimi **2 anni** di sedute, dall'ultima operazione societaria in poi: un salto oltre il
  **3%** in un giorno del rapporto fra prezzo rettificato e grezzo (uno scorporo, un dividendo straordinario)
  rende i prezzi di prima non confrontabili — WDC il 24/02/2025, lo scorporo di Sandisk.
- **Pavimento**: un minimo di oscillazione sotto il prezzo, il più basso di **5 sedute prima e 5 dopo**;
  minimi entro **mezzo ATR** sono lo stesso pavimento. Per ciascuno: quante volte il prezzo ci è tornato,
  quando l'ultima, quanto è rimbalzato nelle 20 sedute dopo, con quali volumi. Si mostrano i tre più vicini
  e, subito sotto (entro **2 ATR** dall'ultimo mostrato), quello con più tocchi: un pavimento più forte appena
  oltre, non la base di due anni fa da cui il titolo è partito (v488: su MU compariva 118, a −87%).
- **Ordine**: con limite al bordo alto del pavimento — si esegue solo se il prezzo scende fin lì, quindi mai
  sulla risalita.
- **Stop**: una chiusura sotto il fondo del pavimento meno **1 ATR**.
- **Vuoti di prezzo**: le fasce saltate da un rialzo e mai più scambiate si scrivono a parte. Che il prezzo
  torni a riempirle è una convenzione di lettura dei grafici, non una misura di compratori: non diventano mai
  un pavimento.
- I pavimenti dicono dove il titolo si è fermato le volte scorse, non dove si fermerà: per questo ogni ordine
  ha il suo stop. Un ordine lasciato attivo durante i conti può eseguirsi all'apertura dopo, anche sotto il
  pavimento: si decide prima se tenerlo aperto.
- I livelli della zona d'ingresso (v473) restano accanto: sono la lettura di chi entra sulla risalita, che il
  CEO non vuole, e servono come segnale che la discesa è finita.

**Storno o discesa — quando alzare un limite** (15/10/2026). Con tre ordini con limite inseriti (§1septies) il
CEO ha chiesto: *"Perché entrare su qualche punto più caro quando posso acquistare bene su questo storno? … posso
alzare il prezzo limite e approfittare di questi storni"*. La risposta dipende dal titolo, non dal prezzo, e la
tendenza è quella della tenuta (§1sexies):
- **STORNO** = una pausa dentro una salita: tendenza intatta o in correzione (la chiusura non sta sotto la media a
  200 con la media a 50 sotto la 200). Alzare il limite è coerente con la regola dei minimi **se nella seduta il
  titolo scende**: si compra lo storno, non la risalita. Il 15/10 era SMCI: sopra la media a 200, media a 50 in
  salita, stime in rialzo, −4,7% nella seduta.
- **DISCESA** = tendenza rotta (chiusura sotto la media a 200 e media a 50 sotto la 200): lo sconto è il rischio,
  non l'occasione. Il limite resta sul pavimento; che la discesa smetta di scendere lo dice una chiusura sopra la
  media più vicina sopra il prezzo, che non è ancora un ingresso. Il 15/10 erano ORCL e OKLO, ed entrambi
  risalivano nella seduta.
- In tutti e due i casi **lo stop resta quello del pavimento sotto il limite**: alzare il limite allunga la
  distanza dallo stop, e il rischio in più si scrive in dollari (SMCI, 300 azioni: 1.497 $ col limite a 32,50,
  1.947 $ a 34). `numeri_libro.py` (blocco «ORDINI APERTI») lo calcola per ogni ordine a ogni analisi.

**Massimi e minimi: la STRUTTURA DELLE OSCILLAZIONI** (richiesta del CEO del 17/10/2026, testuale: *"In generale
analizza anche massimi e minimi decrescenti oltre, se possibile, tecnicamente i grafici quando si presenta la
possibilità di ingresso o si attivano i parametri di uscita fermo restando che anche le ultimissime news sono
importanti"*). `rotazione.py` la calcola per ogni sorvegliato e candidato, `numeri_libro.py` per ogni posizione e ogni
ordine attivo. Convenzioni di lettura scelte da Claude e dichiarate come tali (v240), rilette dal codice da un gate:
- **I punti** sono quelli dei pavimenti — il più basso (o il più alto) di 5 sedute prima e 5 dopo, il primo a
  toccarlo — nell'**ultimo anno** di sedute concluse; due punti entro mezzo ATR sono **alla pari**: due minimi alla
  pari sono lo stesso pavimento. Si mostrano gli **ultimi 3** massimi e gli ultimi 3 minimi.
- **Lo stato** viene dal verso degli ultimi due: **RIALZISTA** = massimi e minimi crescenti · **RIBASSISTA** =
  massimi e minimi decrescenti · **IN COMPRESSIONE** = massimi decrescenti e minimi crescenti · **IN ESPANSIONE** =
  il contrario · **LATERALE** = uno dei due alla pari. Accanto, quanti punti di fila seguono lo stesso verso.
- **Rotta**: la chiusura conclusa oltre l'ultimo punto — sotto l'ultimo minimo o sopra l'ultimo massimo — prima che
  un punto nuovo lo confermi; si scrive l'estremo toccato da allora e quante sedute mancano perché diventi un punto.
  Il 16/10 MU, CRWV, RGTI, SMCI, ORCL e OKLO avevano tutti chiuso sotto il loro ultimo minimo di oscillazione.
- **Lettura dei grafici** (convenzioni di lettura, non misure): il **doppio minimo** e il **doppio massimo** — gli
  ultimi due punti alla pari — col loro collo e da quando la chiusura sta oltre; la **divergenza dell'RSI** — un minimo
  più basso con l'RSI più alto, o un massimo più alto con l'RSI più basso — con almeno **3 punti** di RSI fra i due;
  le sedute in salita e in discesa delle ultime 20 concluse col loro volume medio.
- **Ingresso possibile** (per leggere le ultimissime notizie): un pavimento entro **1 ATR** dal prezzo, oppure un
  candidato o un prezzo dentro la zona. Una chiusura sopra l'ultimo massimo, o sopra il collo di un doppio minimo, NON
  è un ingresso possibile: è la risalita, che il CEO non compra; resta come segnale che la discesa è finita.
- **Uscita accesa**: la tenuta che non è «lasciar correre» (§1sexies), la struttura rotta al ribasso o ribassista, un
  doppio massimo sotto il collo da non più di **10 sedute**. È la famiglia del PREZZO, la stessa della tendenza della
  tenuta: un'informazione e un motivo per leggere le notizie, **non una prova in più (B3) e non una vendita** — dal
  15/10 non si vende sui ribassi (§1ter). **Decisione del CEO del 17/10/2026**, alla domanda se la struttura dovesse
  entrare come prova nel bilancio dell'evidenza (§1sexies), testuale: *"solo informazione"*. Resta accanto alla
  tenuta e non ne cambia l'esito, e un gate lo verifica.
- **Le ultimissime notizie**: per ogni nome con un ingresso possibile, un'uscita accesa o un ordine attivo, il feed
  Nasdaq del simbolo nelle ultime **72 ore** — così il lunedì mattina comprende il venerdì —, con la stessa voce nel feed
  di almeno **tre** nomi scritta una volta come cronaca di mercato; quella nel feed di due resta con ciascuno e dice dove
  altro compare (v500: con due, «CoreWeave Is Projected to Have a 6.3x Gross Leverage Ratio» finiva fra la cronaca, cioè
  sotto «è il mercato, non il nome»). Il feed è UNA fonte: la ricerca web nelle stesse ore resta obbligatoria, e la
  risposta cita fonte e data.

**Il VWAP dall'ultima trimestrale, accanto ai pavimenti** (decisione del CEO del 18/10/2026, testuale: *"2ok"* alla
proposta di *"i livelli VWAP calcolati dall'ultima trimestrale — il prezzo medio pagato da chi ha comprato dopo i conti —
accanto ai pavimenti di ogni titolo"*). `rotazione.py` lo calcola per ogni sorvegliato, `numeri_libro.py` per ogni
posizione e ogni ordine attivo. Convenzioni scelte da Claude e dichiarate come tali (v240):
- **Ancora**: la prima seduta dopo il comunicato. La **data** la dichiara Nasdaq (le trimestrali riportate, non le
  stime): l'8-K con item 2.02 da solo non basta, perché una società ne deposita anche fuori dal ciclo (il 02/10/2026
  Tesla ci ha depositato le consegne) e gli emittenti esteri non lo hanno. L'**ora** viene dal deposito su SEC EDGAR
  accettato fra le 16:00 di New York del giorno prima e la fine del giorno dopo (l'8-K, o il primo 6-K di un emittente
  estero), letta dalla pipeline. ⚠ EDGAR scrive quell'ora in **UTC** (misurato il 18/10 su Oracle: 20:16:50Z
  nell'archivio, «Accepted 16:16:50» nell'indice del deposito) e si converte col fuso di New York, mai con uno scarto
  scritto a mano (v501: la v500 la leggeva come ora di New York). **Prima delle 09:30 muove la seduta stessa, dalle
  16:00 la successiva**, in mezzo la
  seduta stessa (a seduta aperta: la sua barra mescola il prima e il dopo). Senza l'ora, la seduta più scambiata fra il
  giorno del comunicato e il successivo — dichiarato ogni volta, col perché.
- **VWAP**: dalle barre giornaliere, prezzo tipico (massimo + minimo + chiusura) / 3 pesato sui volumi, dall'ancora
  all'ultima seduta conclusa, sulla serie della società dei pavimenti. È un'**approssimazione** del VWAP dei grafici,
  che usa barre di pochi minuti: i due numeri possono differire di poco.
- **Lettura** (convenzione): sopra il VWAP chi ha comprato dopo i conti è in media in guadagno, sotto in perdita. È un
  livello accanto ai pavimenti, **non una prova della tenuta e non un ordine**.

## 1ter. SEMAFORO D'USCITA — deciso col CEO il 06/10/2026, si controlla a OGNI analisi

Domanda del CEO: *"quando capire di dover uscire, onde evitare di subire in pieno un prossimo
crollo"*, con la tesi che l'AI abbia margine di crescita fino al 2029. Il momento del crollo non
si prevede: si decidono PRIMA i segnali e la reazione, poi si esegue senza ridiscuterla.
Le soglie sono **convenzioni del mestiere scelte col CEO**, non dati del file (v240). I livelli
dei prezzi si leggono **dal giorno**, mai da questa pagina: qui stanno le regole, non i numeri,
perché un numero scritto a mano invecchia da solo (v410, v424).

| Famiglia | Segnale | Come lo legge `numeri_libro.py` (v474) |
|---|---|---|
| **Prezzo** | SMH chiude sotto la propria media a 50 giorni; secondo gradino: sotto la media a 200 | ultima chiusura CONCLUSA di SMH contro le medie calcolate sulle barre di oggi (stockanalysis) |
| **Leader** | NVDA, AMD e MU chiudono **insieme** sotto la propria media a 50 giorni, con volumi alti | ultima chiusura conclusa di ciascuno contro la media a 50; "volumi alti" = volume di quella seduta oltre il 50° percentile dell'anno per **tutti e tre** (convenzione v474, la stessa soglia della conferma d'ingresso v473) |
| **Credito** | spread **CCC** (la fascia peggiore) salito di **1,5 punti o più** sul proprio minimo delle 60 sedute precedenti — è il segnale che arriva per primo (v465); poi spread high yield (HY OAS) sopra 3,5; secondo gradino: sopra 4,0 | `data.json` → `macro.credit_ccc` e `macro.credit.spread_hy`, con la loro data |
| **Tassi** | Treasury 10 anni sopra 5,4% | `data.json` → `macro.tassi` (scadenza a 10 anni, con la sua data) |
| **Fondamentali AI** | revisioni delle stime che girano al ribasso su NVDA/MU (più tagli che rialzi a 30 giorni), oppure un hyperscaler (MSFT, GOOGL, META, AMZN) che TAGLIA la guida sugli investimenti | revisioni da `data.json` → `analisti` (acceso se su ALMENO UNO dei due i tagli superano i rialzi); la guida sugli investimenti NON è calcolabile: ricerca web e conti di fine ottobre |
| **Leva** | il margin debt FINRA comincia a scendere dal picco (variazione mensile negativa) | `data.json` → `macro.margin_debt.history`, ultimo mese contro il precedente |

**Il colore lo calcola `numeri_libro.py`** (blocco «SEMAFORO D'USCITA», v474, decisione del CEO del
09/10/2026). Della famiglia «Fondamentali AI» lo script calcola le revisioni; la guida sugli
investimenti degli hyperscaler non è una serie e resta da ricerca web: se un hyperscaler l'ha
tagliata, la famiglia è accesa anche con le revisioni spente. Una famiglia senza dati si dichiara
**non misurabile**, mai spenta, e il colore diventa un minimo. Lo script legge la reazione qui sotto
parola per parola: le regole stanno in un posto solo.

**Reazione a gradini** (la proporzione è una convenzione scelta col CEO, non un calcolo):
- 🟢 **Verde** — nessun segnale: si opera normalmente.
- 🟡 **Giallo** — un segnale: **nessun divieto d'ingresso** (decisione del CEO del 09/10/2026: *"se c'è
  possibilità di ingresso non proibirli ma segnalane le conseguenze di rischio"*). Ogni ingresso
  possibile porta accanto le sue conseguenze sul libro — volatilità, beta su QQQ, perdita allo stop
  (`rotazione.py`, blocco «PIANO PER LA LIQUIDITÀ») — e chi è nella stessa scommessa del libro lo
  dichiara. **Nessuna presa di profitto per prezzo**: si vende per evidenza (§1sexies, decisione del
  CEO del 14/10/2026); fino al 14/10 il giallo prevedeva prese di profitto sui nomi più tirati.
  Fino al 09/10 il giallo vietava i nuovi semiconduttori.
- 🟠 **Arancione** — due segnali di **famiglie diverse**: **nessuna vendita** — decisione del CEO
  del 15/10/2026, testuale: "non vendi sui ribassi ma sui massimi". Come in giallo, nessun divieto
  d'ingresso: ogni ingresso porta accanto le sue conseguenze sul libro. Il colore resta una prova
  CONTRO per ogni nome nella tenuta (§1sexies, famiglia macro), e l'unica vendita automatica del
  libro è il salvavita qui sotto. Fino al 15/10 l'arancione toglieva un terzo dei semiconduttori in
  proporzione al rischio: al suo primo arancione il CEO non l'ha eseguito e ha cambiato la regola.
- 🔴 **Rosso** — SMH sotto la media a 200 **e** (credito sopra 4,0 **oppure** taglio della guida
  sugli investimenti AI): **nessuna vendita**, come l'arancione (decisione del CEO del 15/10/2026).
  Fino al 15/10 toglieva un altro terzo dei semiconduttori.

⚠ **15/10/2026 — al primo arancione il gradino NON è stato eseguito, e la regola è cambiata.** Il
colore era passato ad arancione alla chiusura del 14/10 (SMH sotto la media a 50, spread CCC acceso)
e il piano del giorno vendeva 65.856 $ di semiconduttori (31 MU, 38 AMD, 46 NVDA, 14 MRVL, 15 SKHY)
con ~12.532 $ d'imposta. Il CEO, testuale: *"mantenere le posizioni di Mu e amd e gli altri. Non
vendi sui ribassi ma sui massimi"*; poi, alle due domande: **«Solo il salvavita»** (arancione e rosso
diventano informazione) e **«Solo col semaforo acceso»** (nessuna presa di profitto ai massimi: resta
la regola del 14/10, §1sexies — e il semaforo non vende più). La frase dell'analisi che ha aperto la
decisione metteva un costo preciso contro un beneficio vago; i numeri dati prima delle due risposte:
vendere e ricomprare le stesse azioni conveniva solo con un altro −19% circa (imposta / venduto); in
una correzione normale tenere batte vendere — le tre volte che l'arancione si è acceso in tre anni,
tre mesi dopo SMH era più in alto —; in un mercato orso come il 2022 (semiconduttori circa −46%) il
gradino avrebbe evitato circa 30.000 $ di perdite su quella parte. ⚠ Senza gradino l'esposizione è
quella del libro intero: il 14/10 un Nasdaq −10% valeva −21,9% (−59.174 $).

**I semiconduttori del libro** (il gradino del salvavita): MU, NVDA, AMD, MRVL, SKHY.
Il settore non è nei dati — la pipeline mette RGTI fra i semiconduttori e SK hynix no (v473) —
quindi l'elenco sta qui, e un nome nuovo del comparto ci entra il giorno dell'acquisto. Le posizioni
fuori dall'elenco si nominano a ogni analisi: un'omissione si vede.

**Il salvavita sul patrimonio** (decisione del CEO del 14/10/2026). Il semaforo riconosce i crolli
che conosce: un crollo dei soli titoli dell'intelligenza artificiale col credito calmo può lasciarlo
giallo finché le stime non girano. Il salvavita stacca per qualunque causa, come quello di casa.
- **Misura**: il calo dell'azionario dal suo massimo, in dollari, sul rendimento ponderato per il
  tempo del registro della performance (§0): vendite, acquisti e depositi non lo falsano. Il massimo
  si conta dalla prima riga del registro (09/10/2026).
- **Soglia: −30%** — una convenzione scelta col CEO (v240), oltre il peggior calo dell'ultimo anno
  del libro di oggi guardato all'indietro (−26%, misurato il 14/10/2026): non scatta sul rumore.
- **Reazione**: un terzo dei semiconduttori, **in proporzione al rischio** di ciascuno — chi porta
  più rischio di quanto pesa si taglia di più, chi ne porta meno di meno (decisione del CEO del
  14/10/2026) — qualunque sia il colore del semaforo. Azioni, imposta e rischio prima e dopo li
  calcola `numeri_libro.py`, blocco «PIANO DI RIDUZIONE», a ogni analisi. Si vende, non ci si copre:
  il CEO non opera con opzioni o ETF short, per ora. Dal 15/10/2026 è l'**unica vendita automatica**
  del libro (arancione e rosso non vendono): scatta una volta per discesa, senza un secondo gradino
  dopo, e si riarma quando l'azionario torna al massimo. Lo calcola `numeri_libro.py`, blocco
  «SALVAVITA».

⚠ Due segnali della **stessa** famiglia sono un segnale solo (B3): SMH sotto la 50 e NVDA sotto la
50 nello stesso giorno sono il prezzo che parla due volte, non due prove.
⚠ **Lo spread CCC: perché la salita e non il livello, e quanto vale (misurato il 06/10/2026).**
Il livello normale della fascia CCC cambia col ciclo e FRED ne pubblica solo ~3 anni, quindi una
soglia di livello non avrebbe storia (v240). La soglia di +1,5 punti è una **convenzione scelta col
CEO**. Su tre anni si è accesa in 4 episodi distinti: agosto 2024 (crollo da yen, già in corso),
marzo 2025 (circa tre settimane **prima** del crollo dei dazi di aprile), marzo 2026 (falso allarme:
Nasdaq +17% il mese dopo) e settembre 2026. **Uno su tre ha anticipato**: è un campanello, non una
sentenza — per questo vale UN segnale della famiglia credito, mai due, e da solo porta al giallo.
⚠ **Il credito arriva al libro? (v467, deciso col CEO il 07/10/2026).** Il CCC misura il MERCATO;
`numeri_libro.py` (blocco «CREDITO SUL LIBRO») misura se la stretta tocca i nostri nomi che
bruciano cassa — chi ha flusso di cassa libero negativo, letto dalla pipeline a ogni run, non da un
elenco scritto qui (C10). La **conferma sul libro** è accesa quando valgono insieme: CCC salito di
1,5 punti o più (la stessa soglia di sopra) · oltre metà del peso di quel gruppo sotto la propria
media a 50 · rendimento a 21 sedute del gruppo peggiore di chi si autofinanzia.
**È la stessa famiglia del CCC: non cambia il colore** (B3). Cambia la **priorità**: con la
conferma accesa, gli stop già decisi su quei nomi si eseguono senza aspettare la scadenza (§1quater)
e su quei nomi non si apre nulla di nuovo. Le soglie sono convenzioni scelte col CEO (v240).
⚠ Fonti esterne sul debito tecnologico in difficoltà (per esempio i rapporti di JPMorgan) si
leggono come contesto: non sono una serie pubblica, quindi non entrano nel semaforo.
⚠ Le vendite a terzi dividono anche il conto fiscale sulle plusvalenze (26%): su MU e AMD è alto.

⚠ **Posizionamento e indici restano INFORMAZIONE, e dove lo storico c'è sono stati misurati (decisione del CEO del
18/10/2026, testuale: *"1 ok tua proposta"*).** Le misure della v496-v499 — curva della volatilità, gamma dei dealer,
dark pool, put/call, grandi operatori, multipli degli indici — non entrano nel colore. Misurate il 18/10 con lo stesso
metodo del CCC (`scripts/misura_segnali_mercato.py`: un episodio è il primo giorno acceso dopo almeno 20 sedute spente;
un calo di almeno il 10% è «anticipato» se il segnale si accende entro il giorno in cui il calo tocca il −5%):
- **VIX/VIX3M ≥ 1** (curva della volatilità invertita), dal 2009: sull'S&P 500 42 episodi, un calo ulteriore di almeno
  il 10% entro 63 sedute nel **17%** dei casi contro il **12%** di un giorno qualunque (+0,9 errori standard: dentro il
  rumore), e dopo l'inversione il mercato nella mediana **sale** (+2,8% a 21 sedute contro +1,5%). Degli 8 cali di
  almeno il 10% si è accesa entro il −5% in 6, ma prima del massimo una volta sola: **è un termometro dello stress in
  corso, non un anticipatore**. Sul Nasdaq-100 la stessa forma (19% contro 16%); su SMH (5 anni) 4 cali su 8 senza
  accendersi mai.
- **GEX dell'S&P 500 negativa** (SqueezeMetrics, dal 2011): 36 episodi, 17% contro 12%, e nel 47% dei casi il mercato
  era già oltre il −5% dal massimo dell'anno.
- **DIX** per quinto del proprio anno: più alto il DIX, più frequenti i cali di almeno il 10% nei tre mesi dopo (dal 5%
  al 16%) — l'opposto della lettura «DIX alto = acquisto», ma su giorni sovrapposti e con un DIX salito negli anni: si
  legge come un mercato già agitato, non come un segnale.
- **Put/call delle azioni** (media di 10 sedute, CBOE dal 2019): nella coda alta del proprio anno 18% contro 15%, nella
  bassa 7% contro 15% — 11 e 14 episodi, dentro il rumore.
- **Grandi operatori** (CFTC, fondi a leva su S&P 500 e Nasdaq-100, dal 2013): una prova su quattro oltre due errori
  standard (S&P 500, coda lunga: 33% contro 12%, 12 episodi, ma accesa dentro il calo in 4 casi su 6). Su 24 confronti
  in tutto il caso ne produce circa uno: **non si promuove**.
- **Multipli** (multpl, dal 1975): il CAPE in coda alta non anticipa i cali entro un anno (33% contro 31%) e l'anno dopo
  il mercato nella mediana sale del 23%; il P/E degli ultimi 12 mesi in coda alta 62% contro 31% (+1,9 errori
  standard), ma metà degli episodi scatta a mercato già sceso (2001, 2002, 2008, 2020): il P/E sale perché crollano gli
  utili, cioè dentro la crisi.
- **Dark pool per titolo** (la memoria del sistema, un anno, 56 titoli): per quinto del proprio anno il rendimento in
  eccesso su SPY a un mese non cambia in ordine (da −0,8% a +0,9%) e i cali di almeno il 10% stanno fra il 15% e il 18%
  in ogni quinto: nessun segnale.
- **Da misurare quando la storia raccolta lo permette** (almeno un anno): la nostra gamma sulle catene (raccolta dalla
  v500), put/call e volatilità implicita per titolo, il P/E del Nasdaq-100. Con la stessa misura: se non anticipano,
  restano informazione.

**Fotografia del 06/10/2026, solo come riferimento — non sono le soglie**: SMH 638 (media 50 ≈ 573,
200 ≈ 502) · **spread CCC 12,11%, +2,4 punti sul minimo di 60 sedute (9,69) — SEGNALE ACCESO** · HY OAS 3,1 · Treasury 10 anni 5,28% · margin debt 96,8% del massimo, +2,6% sul mese ·
revisioni NVDA 46 su / 0 giù. **Stato: 🟡 giallo dal 06/10 (era verde prima di aggiungere lo spread CCC)**: un segnale, famiglia credito. Prima ancora, fragilità dichiarate (leva record, rialzo
stretto: SPY +1,6% contro RSP −2,6% a un mese).

## 1quater. COSTO DELL'ATTESA E SCADENZE — deciso col CEO il 06/10/2026, si riporta a OGNI analisi

Domanda del CEO: *"se attendo ancora un po' per queste operazioni è un forte azzardo?"*. Risposta
diventata regola: **aspettare non è un azzardo se le protezioni sono già in piedi e ogni decisione
ha una scadenza**. Diventa una scommessa binaria solo quando si lascia passare la trimestrale di un
nome su cui la decisione era ancora aperta.

**Le regole** (i numeri si leggono dal giorno, mai da qui — v410, v424):
1. **Il costo dell'attesa è il rischio del libro in dollari**, calcolato da
   `python3 scripts/numeri_libro.py` (blocco `COSTO DELL'ATTESA`): oscillazione tipica di una
   seduta e di una settimana, seduta cattiva (VaR95), media delle sedute peggiori (ES95). È quanto
   il libro può muoversi **mentre** si decide: va confrontato con il beneficio atteso dell'operazione.
2. **La scadenza di ogni decisione aperta è la PRIMA trimestrale del nome coinvolto**, come la
   dichiara la fonte (blocco `SCADENZE` dello stesso script). Nessuna data proiettata (v396): un
   nome senza data nella finestra si nomina, e "la fonte non la dichiara" non è "nessuna uscita".
   Gli eventi macro (verbali Fed, FOMC) e le trimestrali dei fornitori di settore (ASML, TSM) si
   aggiungono dalla ricerca web, con fonte e data.
3. **Le protezioni si mettono SUBITO, le operazioni condizionate possono aspettare.** Gli avvisi e
   gli stop sui livelli già decisi (SMH, Treasury 10 anni, vedi §1ter e il piano in
   `FORMATO_ANALISI.md`) non dipendono da nessuna scadenza: rimandarli è l'unico pezzo dell'attesa
   che costa senza dare niente in cambio. ⚠ Dal 14/10/2026 un livello di prezzo su una posizione è
   un campanello che fa guardare la tenuta, non un'uscita (§1sexies): lo stop di RGTI è stato
   revocato quel giorno dal CEO, e su CRWV il CEO ha mediato il 14/10 invece di aspettare i conti (§1quinquies).
4. **Oltre la scadenza, aspettare è una scommessa binaria**: la trimestrale riprezza il nome in una
   seduta, spesso di più dell'oscillazione di una settimana intera. Una decisione ancora aperta il
   giorno prima della trimestrale va presa o dichiarata rimandata **di proposito**, non lasciata
   scadere.
5. Il salvavita (§1ter) **scavalca** le scadenze: se scatta, si agisce secondo il suo gradino senza
   aspettare la data. Dal 15/10/2026 arancione e rosso non portano vendite (decisione del CEO):
   restano un segnale, non un'azione.

**Fotografia del 06/10/2026, solo come riferimento — non sono le soglie**: seduta tipica ±9.500 $,
settimana ±21.200 $, VaR95 −15.800 $, ES95 −20.000 $; scadenze BE 27/10 · MSTR 29/10 · PLTR 02/11 ·
AMD 03/11 · CRWV e RGTI 09/11 · NVDA 18/11 (MU, SKHY, MRVL senza data nella finestra). Esterne:
verbali Fed 07/10, ASML 14/10, TSM 15/10, FOMC 28/10. Lettura di quel giorno: attesa ragionevole
fino a metà ottobre; BE da decidere entro il 27/10, AMD entro il 03/11.
⚠ v479 — su BE quella fotografia è superata: la fonte ha poi dichiarato la trimestrale **cinque
giorni prima** del 27/10. La fotografia resta com'era, come documento di quel giorno; la scadenza
vera si legge SEMPRE dal blocco `SCADENZE`, ed è la ragione per cui le regole qui sopra non
portano date.

## 1quinquies. DECISIONI APERTE — confermate dal CEO e non ancora eseguite (v474)

Una decisione entra qui quando la sua condizione è **confermata in chiusura** e il CEO l'ha presa;
esce quando è **eseguita** (si aggiornano posizioni e liquidità in §1) o **revocata di proposito**
(Stato: «revocata il …», con la ragione). Le condizioni non ancora scattate restano nel piano di
`FORMATO_ANALISI.md` §6.

| Nome | Decisione | Quantità | Condizione | Livello | Confermata | Stato |
|---|---|---|---|---|---|---|
| RGTI | uscita | 463 | chiusura sotto | 14,41 | 2026-10-08 | revocata il 14/10/2026 — decisione del CEO («tengo per ora»): con il bilancio dell'evidenza (§1sexies) RGTI è in CONFLITTO, e lo stop a 14,41 era una regola di prezzo |
| AMD | alleggerimento | da decidere | respinto sotto | 645 | 2026-10-08 | revocata il 14/10/2026 — regola di tenuta §1sexies (decisione del CEO del 14/10): l'alleggerimento era per peso (verso il 12-14% del libro), e la tenuta non trova evidenza di vendita (tendenza intatta, stime in salita) |

⚠ **RGTI — la ragione dell'uscita, corretta il 13/10/2026.** La decisione poggia sullo **stop**
(chiusura sotto 14,41, scattato l'08/10) e sulla tendenza, **non sui ricavi**. Il 12/10 l'avevo
motivata con «ricavi −46% in tre anni»: era la serie ANNUALE ferma al 2025, mentre i trimestri del
2026 dicono il contrario (2° trimestre 2026: 5,1 milioni $, +185% sull'anno prima). E la liquidità
non è un problema: 393,7 milioni fra cassa e titoli a breve al 30/06, circa quattro anni al consumo
di quel semestre — il sistema contava i soli contanti (27,8 milioni), corretto in v476. Restano veri:
perdita operativa in aumento (+41% sull'anno), valutazione circa 330 volte i ricavi, tendenza al
ribasso. Le schede portano ora i ricavi per trimestre accanto all'esercizio chiuso (v476).
⚠ **14/10/2026 — decisione REVOCATA dal CEO: «tengo per ora».** Con il bilancio dell'evidenza
(§1sexies, v482) RGTI è in **CONFLITTO — DA VALUTARE**. Contro: tendenza rotta (chiusura sotto la
media a 200, media a 50 sotto la 200), e RGTI brucia cassa con la famiglia credito accesa. A favore:
ricavi del secondo trimestre quasi triplicati sull'anno prima, più rialzi che tagli delle stime a 30
giorni, liquidità per oltre cinque anni di perdita operativa. Lo stop a 14,41 era una regola di
prezzo, e la regola del 14/10 dice che per il prezzo non si vende. RGTI resta in portafoglio. La
proposta del 14/10 sconsigliava la media, perché è il nome dove una media sposta meno il carico:
**il CEO ha mediato lo stesso giorno** — +200 azioni a ~12,06 $, 663 in tutto, carico da 26,50 a
22,147 (§1). La decisione è sua, e la scadenza resta quella del conflitto: i conti successivi.
La mattina del 14/10 avevo scritto qui che la decisione reggeva anche con la regola: valeva per la
prima versione (v481), che guardava solo le prove contro.
⚠ **CRWV — 14/10/2026: il CEO ha mediato prima dei conti.** +50 azioni a ~65,80 $, 155 in tutto,
carico da 97,20 a 87,07 (§1). La proposta del 14/10 era di aspettare i conti del 09/11: quel giorno le
obbligazioni di CoreWeave rendevano intorno al 15% e il titolo perdeva il 16%, e il programma di
vendita di 35 milioni di azioni annunciato a settembre può partire da metà ottobre. La decisione è
sua: la rimandata è chiusa, e resta la scadenza del conflitto — i conti, con l'esame scritto prima.
⚠ **CRWV — 20/10/2026: il CEO ha mediato di nuovo**, sempre prima dei conti: +50 azioni a ~63,86 $ (ricavato dal carico
che il broker dichiara), 205 in tutto, carico da 87,07 a **81,41** (§1). La regola del 18/10 si sposta col carico: si
esce solo almeno in pari, cioè non sotto il carico di §1.
⚠ **CRWV — 23/10/2026: la terza media**, sempre prima dei conti. Il CEO, testuale: *"Corewave pmc 76.14 255 azioni
aggiorna"*: +50 azioni a ~54,53 $ (ricavato dal carico che il broker dichiara; quel giorno il titolo ha scambiato fra
54,07 e 56,10 $), 255 in tutto, carico da 81,41 a **76,14** (§1). Il pareggio scende col carico: a 54,80 $ (pipeline,
23/10 in seduta) servivano +38,9% per tornare in pari, contro +48,6% sul carico di prima.
⚠ **CRWV — 24/10/2026: la regola d'uscita cambia, su proposta dell'analisi.** Il CEO, testuale: *"Si per regola
proposta"*. «Si esce solo almeno in pari» (18/10) legava l'uscita al prezzo di carico, che il mercato non conosce: il
24/10 (chiusura del 23/10, 54,23 $) servivano +40,4% per tornare a 76,14, circa il doppio del movimento che le opzioni
prezzavano fino ai conti (±21,5% al 13/11). Ora la decisione si prende ai conti del 09/11 sul fatto che per CoreWeave
conta, il **finanziamento**: si tiene se è coperto, si esce se non lo è, a prescindere dal carico. L'esame scritto
(§1sexies) si manda al CEO dal 02/11 e porta le condizioni: (1) il debito in scadenza entro 12 mesi (7,5 miliardi di $
contro 5,5 di liquidità al 30/06) e gli investimenti già contrattati coperti da finanziamenti chiusi, e a quale costo;
(2) la guida sugli investimenti; (3) gli ordini firmati e la tenuta degli impegni dei clienti, OpenAI per primo; (4) il
risultato operativo contro gli interessi; (5) la diluizione. ⚠ Un'uscita in perdita realizza una minusvalenza: se e
quanto valga dipende dal regime fiscale e dalle plusvalenze, che il sistema non conosce.
⚠ **15/10/2026 — il gradino dell'arancione del 14/10 NON è stato eseguito**, per decisione del CEO
(«mantenere le posizioni di Mu e amd e gli altri»), e la regola è cambiata lo stesso giorno:
arancione e rosso non vendono più, resta il salvavita a −30% (§1ter).

**Rimandate di proposito** (§1quater, regola 4: una decisione che aspetta un evento si dichiara,
non si lascia scadere). Una riga per decisione nella forma «- TICKER — cosa si rimanda»;
`numeri_libro.py` la riporta a ogni analisi con la prima trimestrale del nome dichiarata dalla
fonte (v483). La riga esce quando la decisione si prende.

- CRWV — l'uscita si decide ai conti sul FINANZIAMENTO, non sul carico: si tiene se i conti mostrano coperti il debito in scadenza entro 12 mesi e gli investimenti già contrattati, si esce se non lo sono, a prescindere da dove sta il prezzo rispetto al carico di §1; fino ai conti si aspetta (24/10/2026: sostituisce «esce solo almeno in pari» del 18/10)
- ORCL — l'ingresso sui pavimenti (il 17/10: 121,23 e 114,50): per ora il CEO attende, e gli ordini, quando li inserirà, saranno giornalieri (18/10/2026)

⚠ **18/10/2026 — le tre risposte del CEO al piano del 17/10**, testuali: *"1 no · 2 esco solo almeno in pari · 3 per
ora attendo"*, poi *"1no · 2 in attesa · 3giornalieri"*.
1. **SMCI — nessuno stop che sale col prezzo.** La proposta del 17/10 — spostare lo stop sotto ogni nuovo minimo più
   alto, come regola speciale contro quella del 15/10 («non si vende sui ribassi») — è **respinta**: SMCI segue le regole
   di tutti, la tenuta per evidenza (§1sexies), e lo stop del pavimento su cui è entrata resta un campanello (§1quater,
   regola 3), non un'uscita. ⚠ SMCI non è fra i semiconduttori del salvavita (§1ter): è un produttore di server, e il
   gradino del −30% non la tocca. ⚠ **Il 19/10/2026 il CEO ha venduto SMCI per intero** (§1): la regola resta scritta per
   il giorno in cui rientrasse.
2. **CRWV — si esce solo almeno in pari, e si aspetta** (sostituita il 24/10/2026: ora l'uscita si decide ai conti sul
   finanziamento, non sul carico — vedi sopra). Nessun alleggerimento sui rimbalzi sotto il carico; il
   conflitto (§1sexies) si decide ai conti, con l'esame scritto prima. Il 16/10 (chiusura 61,39) servivano +41,8% per
   tornare al carico. ⚠ Se ai conti la tenuta dicesse VENDITA PER EVIDENZA, questa regola direbbe di non uscire sotto il
   carico: le due cose si portano al CEO insieme, non si risolvono da sole — come una decisione aperta che la tenuta
   contraddice (§1sexies).
3. **ORCL — per ora nessun ordine.** Quando il CEO li inserirà saranno **giornalieri**. Un ordine entra in §1septies solo
   quando è sul conto: uno non inserito non blocca liquidità.
La media di CRWV, rimandata ai conti il 14/10, il CEO l'ha fatta lo stesso giorno (vedi sopra).

**Esami dei conflitti** (§1sexies, decisione del CEO del 14/10/2026). Una riga per nome in
CONFLITTO nella forma «- TICKER — conti del AAAA-MM-GG · tenere se … · mediare se … · vendere se …»,
scritta prima dei conti, mandata al CEO 7 giorni prima e confermata da lui. `numeri_libro.py` la
riporta accanto al conflitto, e dopo i conti la si confronta coi risultati. La riga esce quando la
decisione si prende.

(nessun esame ancora)

`numeri_libro.py` (blocco «DECISIONI APERTE») calcola per ciascuna, a ogni analisi:
- il **prezzo di conferma**, cioè la chiusura del giorno della conferma letta dalle barre — non
  scritta qui, perché un prezzo copiato a mano è un secondo dato che può divergere (v410);
- il prezzo di adesso e **quanto l'attesa è costata o ha fatto guadagnare finora**: per una vendita
  quantità × (prezzo di adesso − prezzo di conferma). Quando la quantità è da decidere il conto si
  fa **per 10 azioni**: unità di calcolo, non una quantità consigliata;
- le sedute trascorse, la **scadenza** (prima trimestrale del nome, §1quater) e se la condizione
  vale ancora oggi. Una condizione rientrata non annulla la decisione: la rimette in discussione,
  e lo si dice.
⚠ È un conto a posteriori: misura il costo dell'attesa, non dice se aspettare fosse sbagliato.

## 1sexies. TENUTA DELLE POSIZIONI — si lascia correre, si vende per EVIDENZA, e si valuta l'insieme (decisioni del CEO del 14/10/2026)

Istruzione del CEO, testuale: *"Se ci sono parametri tali, per cui in ottica di lungo periodo,
lasciar correre mu può portare a ottimi rendimenti, tenendo conto anche dell'interesse composto
non si vende se invece ci sono ed emergono parametri tra analisi tecnica, macro e notizie che
portano effettivamente alla necessità di una vendita. Procediamo quest'ottica deve valere per
tutte le azioni in portafoglio e oggetto di analisi il fondo ricordiamocelo è privato e growth e
se ci sono margini di speculazione, ben venga"*.

E lo stesso giorno, dopo il primo giro della regola, testuale: *"Anche per crwv vale la stessa
logica; bisogna valutare l'insieme dei fattori macro news bilanci etc e non solo analisi tecnica
per capire effettivamente la tendenza futura possibile. Questo vale per tutti: se crwv si ha la
possibilità che esploda a rialzo per x fattori allora valutalo. Vedi caso amd che avevo in
perdita a 170 l'anno scorso ed oggi dove si trova. Media perché le avevo a 240."*

**La regola.** Una posizione **non si vende** per il prezzo raggiunto, per la plusvalenza
accumulata o per il peso nel libro: si vende quando **l'evidenza** lo chiede. E l'evidenza si
legge **nei due versi**: le prove CONTRO la tenuta e le prove A FAVORE, con la stessa soglia. La
prima versione (v481) cercava solo prove contro — una tendenza rotta più una conferma bastavano a
proporre una vendita, e la crescita del bilancio non poteva opporsi: su CRWV proponeva di vendere
una società con i ricavi raddoppiati. Tolte il 14/10 le vendite a fascia di prezzo e gli
alleggerimenti per peso del piano precedente: MU nella fascia 1.100-1.108, BE nella fascia 295-302
prima della trimestrale, AMD verso il 12-14% del libro (§1quinquies).

**Il bilancio dell'evidenza**, per ogni nome. Lo calcola `numeri_libro.py` (blocco «TENUTA DELLE
POSIZIONI», v481-v482). Le soglie sono **convenzioni scelte il 14/10/2026**, non dati del file
(v240), e un gate verifica che quelle del codice siano quelle scritte qui.

| Prova | CONTRO la tenuta | A FAVORE | Da dove |
|---|---|---|---|
| **Tendenza** (tecnica) | **ROTTA**: ultima chiusura conclusa sotto la media a **200** sedute **e** media a **50** sotto quella a 200 (l'«incrocio della morte» col prezzo sotto) | **intatta**: chiusura sopra entrambe le medie | barre di oggi (stockanalysis), chiusure concluse |
| **Stime** | stima dell'EPS a 90 giorni mossa di oltre il **5%** del proprio valore verso il basso (il verso dalla differenza, v400: su una perdita, la perdita che si allarga) | mossa di oltre il 5% verso l'alto | `data.json` → `analisti` |
| **Revisioni** | più tagli che rialzi delle stime a 30 giorni (la convenzione del semaforo) | più rialzi che tagli | `data.json` → `analisti` |
| **Ricavi** | ultimo trimestre in calo sullo stesso trimestre dell'anno prima | da **+25%** sull'anno prima: crescita | `data.json` → `tv.conto_trim`, trimestre trovato per data |
| **Bilancio** | **corto**: brucia cassa e la liquidità copre meno di **12** mesi del denominatore che vincola (perdita operativa, perdita più dividendi sulle privilegiate, investimenti — sui soli impianti se gli investimenti sono acquisti di attività immateriali) | **solido**: si autofinanzia (flusso di cassa libero positivo), oppure brucia cassa con un'autonomia da **24** mesi in su | `data.json` → `combustione`, solo rapporti |
| **Macro** | semaforo arancione o rosso · OPPURE il nome brucia cassa e la famiglia credito è accesa (v404, v467) | — (un quadro calmo è l'assenza di un rischio, non una prova di crescita) | semaforo, segno del flusso di cassa |
| **CDS** (il mercato del credito sul nome, v498) | lo spread del CDS a 5 anni cresce in **21** giorni di compensazione di oltre il **20%** PIÙ di quello dell'indice CDX della stessa cedola (investment grade sulla cedola 100, high yield sulla 500) | scende di oltre il 20% più dell'indice — ma non è crescita: non apre un conflitto | `data.json` → `cds.finestra`: prezzi di ICE Clear Credit, storico raccolto dalla pipeline |

In mezzo restano la tendenza **in correzione** (chiusura sotto una sola delle due medie: non è
una rottura), le stime mosse meno del 5%, i ricavi fra 0 e +25%, un'autonomia fra 12 e 24 mesi, il
CDS che si muove entro il 20% da quello dell'indice.
Due prove dello stesso canale si dichiarano tali: macro e bilancio su chi brucia cassa sono il
mercato dei capitali visto da due lati (B3), e così CDS e bilancio quando sono contro insieme — il
CDS è il prezzo che il mercato dà al rischio che il bilancio misura; stime e revisioni sono la
stessa famiglia su due orizzonti, e quando si contraddicono il disaccordo è un fatto.

**Il CDS** (v498) — risposta del CEO del 17/10/2026 alla domanda se un allargamento del CDS dovesse
diventare una prova della tenuta, testuale: *"Si, se poi riesci già a trovare dati storici per
iniziarlo già a misurare adesso meglio"*.
- **Conta la parte del nome.** Lo spread si confronta con quello dell'indice CDX della stessa cedola
  negli stessi due giorni: se si allarga tutto il credito lo dice il semaforo (famiglia credito), e
  contarlo anche qui sarebbe lo stesso segnale due volte (B3).
- **Nei due versi, con la stessa soglia** (v482): il restringimento oltre il 20% sta a favore, ma
  non è crescita e non apre un conflitto, come un bilancio solido.
- **Chi non ha un CDS compensato a ICE non ha questa prova**: non è un dato che manca, è un mercato
  che non c'è, e l'esito non diventa provvisorio. Quali nomi lo hanno lo dice a ogni analisi la riga
  della regola in testa al blocco, non un elenco scritto qui (invecchierebbe da solo, v410).
- **Non è ancora in funzione.** Servono 22 giorni di compensazione raccolti, e uno storico gratuito
  non esiste — misurato il 17/10/2026: ICE pubblica solo l'ultimo giorno e ignora le date chieste;
  la diffusione pubblica SEC delle operazioni sui CDS (DTCC) risponde 403 sia da questo ambiente sia
  dai server di GitHub da cui gira la pipeline; l'archivio web ha due sole fotografie dell'elenco di
  ICE, di maggio e luglio 2024. Lo storico lo raccoglie la pipeline dal 16/10/2026, e la riga della
  regola dice a ogni analisi quanti giorni ha: fino ad allora la prova non c'è, e non rende
  provvisorio nessun esito.
- **Due volte l'anno non si misura per un mese**: il 20 marzo e il 20 settembre la scadenza standard
  a 5 anni rotola e l'indice cambia serie, ICE pubblica solo la scadenza nuova, e una variazione a
  cavallo mescolerebbe due scadenze. In quelle settimane la prova manca, e l'esito dei nomi con un
  CDS diventa provvisorio.
- La soglia del **20%** in un mese è una **convenzione scelta il 17/10/2026**, non una misura (v240):
  lo storico per misurarla non esiste ancora. Si rimisura sullo storico raccolto dopo sei mesi.

**Fuori dal bilancio, accanto** — perché non si calcolano o non sono prove:
- **le notizie** — NON calcolate: per ogni nome in vendita, in conflitto o in osservazione si
  cercano in rete **nei due versi**, con fonte e data: i catalizzatori che possono farlo salire
  forte (contratti, guida alzata, ordini, clienti nuovi) e i fatti che rompono la tesi (guida
  tagliata, cliente perso, diluizione pesante, indagine). Un fatto che rompe la tesi porta un
  conflitto o un'osservazione verso la vendita; un catalizzatore verificato porta un conflitto
  verso il tenere, o il mediare;
- **il consenso degli analisti** — il target come distanza dalla chiusura, con la sua forchetta:
  è un'opinione, non una prova, e su un titolo che scende arriva tardi. Si legge accanto perché
  il CEO chiede di valutare anche il rialzo possibile;
- **la struttura delle oscillazioni** (§1bis, v494) — massimi e minimi crescenti o decrescenti,
  rottura, doppi, divergenze: è la famiglia del prezzo, la stessa della tendenza, e contarla
  accanto alla tendenza sarebbe il prezzo che parla due volte (B3). Decisione del CEO del
  17/10/2026, testuale: *"solo informazione"*.

**Gli esiti**, in ordine di urgenza. Conta **quali** prove ci sono, non quante: nessun punteggio
(v200).
- **VENDITA PER EVIDENZA** — tendenza ROTTA **e** almeno un'altra prova contro **e nessuna prova
  di crescita a favore** (stime, revisioni, ricavi). L'evidenza va tutta da una parte.
- **CONFLITTO — DA VALUTARE** — tendenza ROTTA, ma la crescita è a favore: il prezzo e il bilancio
  dicono cose opposte. È il caso di AMD a 170 nel 2025. Lo script non decide: decidono le notizie,
  cercate nei due versi, e il CEO. Per una posizione in perdita il blocco stampa l'aritmetica
  della media (sotto).
- **IN OSSERVAZIONE** — la tendenza rotta da sola, oppure una prova contro con la tendenza non
  rotta. Non si vende: si guarda.
- **NON MISURABILE** — nessuna prova si misura.
- **LASCIAR CORRERE** — nessuna prova contro.

Una prova senza dati si dichiara **non misurata**, mai neutra, e l'esito diventa **provvisorio**
quando il dato mancante potrebbe cambiarlo: la riga nomina gli esiti possibili (era il «minimo»
della v481, che guardava un verso solo).
⚠ L'esito è la regola applicata, non un ordine: una VENDITA PER EVIDENZA su un nome senza
decisione aperta si **propone** al CEO, e diventa una decisione (§1quinquies) solo quando lui la
prende. Una vendita aperta su un nome che la regola non sostiene da sola si ridiscute col CEO.

**La media — il caso di AMD.** Il CEO aveva AMD a 240, l'ha vista in perdita a 170 e ha mediato:
il carico di §1 è il risultato di quella media, e il prezzo di oggi sta nel blocco. Mediare abbassa il
carico e accorcia il rialzo che serve per tornare in pari, ma aggiunge rischio a un nome che sta
scendendo: ha senso **se la tesi regge**, e la tesi la dicono le prove a favore e le notizie, non
il prezzo. Per ogni posizione in perdita il blocco stampa cosa fa **un'unità di calcolo da
5.000 €** (la stessa degli ingressi, `rotazione.py`): azioni intere, carico nuovo, rialzo per
tornare al carico prima e dopo, peso, volatilità e beta del libro. **Non è una quantità**: dice
cosa comporta, non se farlo. Su una VENDITA PER EVIDENZA mediare è comprare contro l'evidenza:
speculativo, ammesso e dichiarato. Con una vendita aperta sullo stesso nome, mediare e vendere
non stanno insieme: la decisione va presa prima.

**L'interesse composto, misurato.** Vendere un vincitore paga **subito** l'imposta del **26%**
sulla plusvalenza, che tenendo resta investita e continua a comporre. Per ogni posizione in
guadagno il blocco stampa il **pareggio fiscale**: di quanto deve scendere il titolo perché
vendere oggi e ricomprare dopo ridia le stesse azioni — 26% × (prezzo − carico) / prezzo. È il
calo che un'evidenza di vendita deve giustificare. ⚠ In dollari al prezzo di oggi: il conto vero
lo fa il broker in euro col cambio di carico, e regime fiscale e minusvalenze pregresse non sono
nel sistema. Per una posizione in perdita la minusvalenza vale solo se ci sono plusvalenze da
compensare.

**Il semaforo resta un segnale del libro; la sua sola vendita automatica è il salvavita**
(decisione del CEO del 15/10/2026: «non vendi sui ribassi ma sui massimi»). In arancione e in rosso
il colore entra qui come prova CONTRO per ogni nome (famiglia macro), non come vendita. L'unico
gradino automatico è il **salvavita** a −30% dal massimo dell'azionario (§1ter), qualunque sia il
colore: un terzo dei semiconduttori **in proporzione al rischio** di ciascun nome, una via di mezzo
fra il togliere solo MU e AMD e il togliere un terzo di ciascuno (decisione del CEO del 14/10/2026).
Nessuna presa di profitto ai massimi (risposta del CEO del 15/10: «solo col semaforo acceso», e il
semaforo non vende più): si lascia correre e si vende per evidenza.

**La scadenza di ogni conflitto** (decisione del CEO del 14/10/2026). Un «per ora» senza data
diventa «per sempre»: ogni nome in CONFLITTO — DA VALUTARE si decide ai **conti trimestrali
successivi**, con un **esame scritto prima** — cosa devono mostrare i conti per tenere, mediare o
vendere — mandato al CEO **7 giorni prima** e confermato da lui. Così dopo i conti non si cercano
ragioni. Se il conflitto nasce a meno di 7 giorni dai conti, l'esame si scrive subito. La data è
quella dichiarata dalla fonte (calendario Nasdaq), mai proiettata (v396): se cambia, la scadenza si
sposta con lei. Gli esami stanno in §1quinquies («Esami dei conflitti») e `numeri_libro.py` li
riporta accanto al conflitto; dopo i conti l'esame si confronta coi risultati, e la decisione resta
del CEO.

**Il rallentamento della crescita non è una prova** — proposta del 14/10/2026, **respinta dal CEO**
lo stesso giorno. Avrebbe distinto AMD a 170 da Zoom nel 2021 (ricavi passati da +191% a +54%
sull'anno in un trimestre, col titolo già in tendenza rotta), ma la regola resta com'è: i ricavi
contano a favore da +25% sull'anno, qualunque fosse la crescita del trimestre prima.

**I nomi oggetto di analisi e la speculazione** (*"se ci sono margini di speculazione, ben
venga"*). Lo stesso bilancio si calcola sui sorvegliati (`rotazione.py`, una riga per nome): dice
cosa direbbe la regola se il nome fosse in portafoglio. Un ingresso dove direbbe VENDITA PER
EVIDENZA è una scommessa **contro** l'evidenza: ammessa, dichiarata come speculativa, con lo stop
del piano e le conseguenze sul libro. Un ingresso su un CONFLITTO è il caso AMD visto da fuori:
può essere un'occasione o una trappola, e lo dicono le notizie. Dopo l'ingresso vale la stessa
tenuta di tutte le posizioni.

## 1septies. ORDINI APERTI — con limite, inseriti dal CEO e non ancora eseguiti (v489)

Un ordine entra qui quando il CEO lo inserisce sul conto e lo dice; esce quando è **eseguito** (si aggiornano
posizioni e liquidità in §1) o **revocato**. Stato «attivo» = in attesa sul conto. La **validità** sta nella colonna
«Validità» — `giornaliero` o `fino a revoca` (CEO, 15/10/2026 sera: *"Ordini giornalieri per ora"*): un ordine
giornaliero, dopo la campana della sua seduta (16:00 di New York, 22:00 italiane di solito), non è più attivo anche se
la tabella dice «attivo» — `numeri_libro.py` lo sposta fra gli ordini **ESEGUITI o SCADUTI** da verificare sul conto,
col minimo di quella seduta accanto al limite, e non conta più la sua spesa come liquidità bloccata (v490). Senza
validità dichiarata l'ordine resta attivo, e la resa lo dice invece di indovinarla.
La colonna **Attivo alle** (ora italiana: `HH:MM` per il giorno d'inserimento, oppure `AAAA-MM-GG HH:MM`) è l'ultimo
momento in cui il conto mostrava l'ordine **attivo e non eseguito** — uno screenshot o la parola del CEO; l'ora
d'inserimento vale lo stesso. Prima di quell'ora nessuna esecuzione è possibile, quindi il calcolo guarda solo i prezzi
DOPO, dalle barre a 5 minuti delle ultime cinque sedute (v491): il minimo della seduta dice SE il limite è stato
raggiunto, non QUANDO. Senza quest'ora la resa lo dichiara, e il dubbio resta al conto.

| Nome | Verso | Quantità | Limite | Inserito | Stato | Validità | Attivo alle |
|---|---|---|---|---|---|---|---|

`numeri_libro.py` (blocco «ORDINI APERTI») calcola per ciascuno, a ogni analisi: la distanza dal prezzo; se il
minimo della seduta di oggi ha toccato il limite DOPO l'ultima ora annotata in «Attivo alle» — allora l'ordine può
essere già eseguito, e si verifica sul conto —;
STORNO o DISCESA e se alzare il limite è coerente (§1bis); il pavimento sotto il limite con lo stop e il rischio
fino allo stop, col limite e col prezzo di adesso; dove sta il limite rispetto al pavimento più vicino (sopra =
non è un ingresso sui minimi); la tenuta se fosse in portafoglio; la correlazione col libro; i conti dentro la
vita dell'ordine; il volume della seduta; e l'effetto dell'insieme degli ordini sul libro, col rischio totale
fino agli stop.
Storico. Il 15/10/2026 il CEO ha inserito tre ordini d'acquisto giornalieri: ORCL 65 a 129,50, OKLO 260 a 28,50,
SMCI 300 a 32,50. Alle 18:02 il conto titoli in euro li mostrava attivi e non eseguiti, con «Disp. 1.127,33»; la sera il
CEO ha dichiarato la liquidità: **56.600 € liberi**, esclusa quella bloccata da questi ordini (circa 22.800 € ai
limiti). §1 la scrive in tutto, ~79.400 €. Alle 22:00 sono **scaduti senza esecuzione** (CEO: *"Nessun ordine è
passato"*): i minimi della seduta — ORCL 127,60, OKLO 27,52, SMCI 32,38 — erano arrivati fra le 15:30 e le 15:54
italiane, prima delle 18:02, e dopo le 18:02 nessuno è più sceso al limite (minimi dopo, dalle barre a 5 minuti: ORCL
132,54, OKLO 28,94, SMCI 33,87). È il caso da cui nasce la colonna «Attivo alle» (v491).
Il 16/10/2026 il CEO ha inserito tre nuovi ordini giornalieri — OKLO 300 a 26, SMCI 250 a 31, ORCL 65 a 127 — e
dopo l'analisi delle 18:00 li ha modificati: **OKLO a 24 e ORCL a 122**, poco sopra i bordi alti dei pavimenti che
l'analisi indicava (23,26 e 121,23), e **SMCI alzato a 31,50**, mezzo dollaro sopra il pavimento 29,90–31,03. ⚠ Alle
18:21 li avevo registrati a 23,26 e 121,23 dando per scontato che fossero i numeri dell'analisi: i limiti veri li ha
detti il CEO alle 19:02 (*"Oklo 24 … Smci inserito a 31.5 … Oracle 122"*), e alle 19:02 erano tutti e tre attivi e non
eseguiti; i minimi della seduta fino ad allora stavano sopra tutti i limiti. Alle 19:57 il CEO ha alzato SMCI a 31,60
(*"Modifico solo Smci a 31.6 il resto lascio tutto invariato"*): ORCL e OKLO restano com'erano, con l'ultima conferma
delle 19:02. Alle 20:03 il CEO ha confermato l'esecuzione: *"Smci 250 azioni entrato ad 31.6"* — la riga è uscita dalla
tabella ed è entrata fra le posizioni (§1), e la spesa (7.900 $) è stata tolta dalla liquidità. Alle 22:00 ORCL e OKLO
sono **scaduti senza esecuzione**: il minimo della seduta del 16/10, 127,36 e 27,59, non è mai sceso ai limiti, 122 e 24 —
qui l'ora non serviva, il limite non è stato toccato in nessun momento. Il 17/10 il CEO ha confermato di toglierli
(*"1 si"*), e la tabella è rimasta vuota.

## 1octies. CONTI DICHIARATI DALL'EMITTENTE — date che il calendario Nasdaq non porta (v489)

Il calendario delle trimestrali viene da Nasdaq, che non porta tutti gli emittenti esteri: il 15/10/2026 SK
hynix aveva dichiarato i conti del 28/10 con un 6-K del 14/10, e l'analisi non li vedeva — la posizione restava
senza scadenza e senza l'avviso dei 14 giorni. Qui va **solo una data scritta dalla società**, col documento che
la contiene: non una stima (v396). `brief.calendario_trimestrali` la aggiunge nella sua finestra, e se Nasdaq
dice un'altra data vince l'emittente, con quella di Nasdaq scritta accanto. Una data passata esce da sé.

**Ora** (v510, facoltativa, in coda perché le altre colonne non si spostano): l'ora dichiarata dall'emittente nel
SUO fuso, scritta `HH:MM Zona/IANA` (es. `09:00 Asia/Seoul`). La conversione in ora italiana e di New York la fa
`brief.ora_dichiarata` col fuso, mai con uno scarto a mano (v470); senza l'ora la riga dice «orario non dichiarato».
Il 24/10/2026 la riga di SK hynix diceva proprio quello accanto alla propria fonte, che l'ora la dichiarava.

| Nome | Conti | Fonte | Depositato | Ora |
|---|---|---|---|---|
| SKHY | 2026-10-28 | 6-K su SEC EDGAR: teleconferenza alle 9:00 di Seul, la sera del 27/10 a New York | 2026-10-14 | 09:00 Asia/Seoul |

## 1novies. SALUTE DEL CREDITO — monitor deciso dal CEO il 18/10/2026 (v501)

Richieste del CEO, testuali: *"Analizza e monitora la salute finanziaria delle aziende presenti nel mio portafoglio e
nella mia watchlist … per anticipare eventuali impatti negativi sulle azioni"* — rendimenti e spread delle obbligazioni,
CDS a 5 anni con un avviso sui *"rincari anomali o improvvisi"*, il debito dai 10-Q e 10-K — *"e rendilo strutturale per
individuare ogni volta che rilevi una divergenza in cui il mercato obbligazionario o dei CDS prezza un rischio di
liquidità, rifinanziamento o fallimento che non si è ancora riflesso nel prezzo delle azioni"*; e *"Monitora anche
Altman Z-Score fornendo la % di rischio del parametro ed il range temporale entro il quale può avvenire il potenziale
default"*.

**È INFORMAZIONE**: nessuna di queste letture è un colore del semaforo o una vendita. Il CDS del mese era già una
prova della tenuta (§1sexies) e resta tale, con la stessa soglia. Se una divergenza debba diventare una prova lo
decide il CEO.

Le soglie sono **convenzioni del 18/10/2026** (v240), stanno in `scripts/credito.py` e un gate le rilegge da qui:

| Lettura | Regola | Misura |
|---|---|---|
| **Rincaro improvviso** | lo spread del CDS cresce in **5** giorni di compensazione raccolti di oltre il **15%** PIÙ dell'indice CDX della stessa cedola | `cds.finestra5` (pipeline) |
| **Allargamento** | in **21** giorni oltre il **20%** — la stessa soglia della prova di tenuta, una soglia, un posto | `cds.finestra` |
| **Rincaro anomalo** | sotto la soglia, ma dal **95°** percentile delle settimane già raccolte del nome stesso — da quando ne bastano 60 | `cds.rango5` |
| **Divergenza** | un rincaro (o un allargamento) mentre il titolo, negli STESSI giorni, non fa peggio di QQQ: il credito prezza un rischio che l'azione non sconta ancora | `cds.azione` |
| **Altman** | Z'' della pipeline sul bilancio più recente (trimestrale, con l'EBIT degli ultimi 4 trimestri), **+3,25** = punteggio per i mercati emergenti; zona di pericolo sotto **1,1**, di sicurezza sopra **2,6** | `stats.altman_*` |
| **Scadenze oltre la liquidità** | la quota corrente dei finanziamenti supera la liquidità: quel debito va rinnovato o rimborsato col flusso di cassa | `credito`, `combustione` |

- **La % di rischio e il range temporale di Altman** vengono dalle tabelle pubblicate da Altman (presentazione del
  6/2/2019, CFA Society India): il punteggio si confronta con le **mediane per rating** (colonna più recente: la riga
  CC/D sui 94 fallimenti del 2010-2013), e la riga di quel rating nei **tassi di mortalità per rating all'emissione**
  (S&P, 1971-2018, 3.454 emissioni) dà la frequenza storica d'insolvenza a 1, 3, 5 e 10 anni, l'anno col rischio annuo
  più alto e l'anno entro cui cade metà delle insolvenze dei primi dieci. **Non è una previsione sul nome**: è cosa è
  successo alle obbligazioni con quel rating. AAA/AA+ si legge sulla riga AA (scelta prudente); CC/D non ha una riga.
- **Altman non si applica** agli intermediari finanziari (settore della pipeline "Financial Services": banche,
  gestori, e — perché il campo è il settore intero — anche Visa e Mastercard, che banche non sono). Penalizza chi ha
  utili non distribuiti negativi con un EBIT positivo — perdite accumulate in passato o riacquisti di azioni, la fonte
  non dice quale: la riga lo dice quando la penalità cade fuori dalla zona di sicurezza (v503; la v501 attribuiva
  tutto ai riacquisti, anche su chi non ne fa).
- **Le probabilità implicite nel CDS** sono neutrali al rischio (recupero 40%, intensità costante): più alte della
  frequenza storica, si leggono nel tempo e non contro Altman.
- **Obbligazioni sul secondario, asset swap spread e Z-spread: non disponibili gratis in forma automatizzabile.**
  TRACE di FINRA li ha, ma l'API vuole credenziali e il dato di fine giornata un contratto; il sito di FINRA li mostra
  per la consultazione. Al loro posto il CDS dove esiste, e il **valore di mercato del debito** che la società
  dichiara nei 10-Q e 10-K (fatti XBRL, `data/debito_sec.json`): sotto 100 il mercato chiede più delle cedole, e il dato
  non separa i tassi saliti dal credito peggiorato.
- **Il debito dai bilanci SEC** (fatti XBRL non dimensionali): scadenze del capitale anno per anno, il tasso dichiarato
  col nome della sua voce (una media ponderata del debito, o il tasso effettivo di UNO strumento senza dire quale),
  valore di mercato contro carico, linee di credito non utilizzate, carta commerciale, derivati sui tassi. Si legge solo
  dopo un 10-Q o un 10-K nuovo, al massimo 10 per run; gli emittenti esteri (20-F, 6-K) non sono letti, e si dice.
  ⚠ **Una voce conta solo se la società l'ha depositata nell'ultimo anno di bilanci** (400 giorni prima del suo ultimo
  10-Q/10-K, la stessa finestra dei derivati): una voce ferma a prima NON si pubblica e si nomina con la data del suo
  ultimo deposito (v502 — il primo giro vero aveva trovato il valore di mercato del debito di SMCI al 2013 e il tasso di
  NVDA da un 10-K del 2018). Le cedole per obbligazione e i nozionali degli swap per tipo sono dichiarati per strumento:
  qui non si vedono, e la loro assenza non dice che non ci siano.
- **Dove esce**: il blocco SALUTE DEL CREDITO di `schede_progetto.py` (segnali in testa, poi nome per nome) e gli
  EVENTI del CDS nel brief delle due letture del giorno; le condizioni di bilancio restano nell'analisi, perché
  cambiano coi trimestri e un avviso che suona tutte le mattine non avvisa.

**Le due solidità — patrimoniale e operativa** (decisione del CEO del 18/10/2026 sera, v504), testuale: *"Per i titoli
tieni conto della differenza tra solidità operativa da cash flow e solidità patrimoniale statica. Rendila strutturale.
Questo mi fa capire la % di rischio sulla base del rendimento e se questo rapporto ne vale la pena"*. Due domande
diverse, che possono dire cose opposte:
- **PATRIMONIALE** (statica: il bilancio a una data regge un colpo?) — la zona di Altman qui sopra: **FORTE** in zona
  di sicurezza, **INTERMEDIA** in zona grigia, **DEBOLE** in zona di pericolo; accanto la liquidità contro il debito a
  breve.
- **OPERATIVA** (dinamica: l'attività produce cassa?) — dai **segni** dei flussi dei 12 mesi, senza soglie:
  **SI AUTOFINANZIA** (flusso operativo e cassa libera positivi) · **FA CASSA MA NON COPRE GLI INVESTIMENTI** (flusso
  operativo positivo, cassa libera negativa: per crescere dipende dal mercato dei capitali, §1ter) · **CONSUMA CASSA**
  (flusso operativo negativo). Accanto: il flusso dell'ultimo trimestre (il verso di oggi), se l'utile diventa cassa, il
  **ciclo di cassa** contro un anno prima, quanto ha assorbito il magazzino, quanto è andato agli azionisti.
- **Il ciclo di cassa** = giorni di crediti + giorni di magazzino − giorni di fornitori, sulle voci di FINE trimestre
  divise per il conto dello stesso trimestre (ricavi per i crediti, costo del venduto per magazzino e fornitori) ×
  **91,25** giorni — convenzione: i libri di testo usano le medie di inizio e fine periodo. Si calcola solo con un
  magazzino di almeno **5** giorni del costo del venduto: per chi vende servizi i debiti verso fornitori sono in gran
  parte per gli investimenti (CRWV: 377 «giorni»). **Negativo** = i clienti pagano prima che si paghino i fornitori: è
  credito dei fornitori, potere contrattuale finché i volumi tengono — se le vendite calano si restituisce.
- **Altman legge come debolezza anche scelte di finanza**, e la sua riga dice da dove vengono: un **capitale
  circolante negativo** nato dal ciclo di cassa (Dell il 18/10: −25 giorni) o da altre passività a breve (Lenovo, sui
  conti della fonte al 30/09/2025: +15 giorni); un **patrimonio netto negativo** con utili non distribuiti positivi non
  viene da perdite (Dell: −1,4 mld di patrimonio, +10,1 mld di utili, 20,0 mld di azioni proprie riacquistate).
- **Rischio contro rendimento, accanto e mai fusi** (v200): la frequenza storica d'insolvenza del rating equivalente e
  il **rendimento del prezzo di oggi** — la cassa libera dei 12 mesi sulla capitalizzazione (solo se bilancio e prezzo
  sono nella stessa valuta) e l'utile atteso sul prezzo (l'inverso del P/E prospettico). Non è quanto renderà
  l'azione: un titolo growth rende poco oggi per costruzione, perché il prezzo paga la crescita, e l'utile atteso di un
  ciclico è più alto proprio vicino al picco del ciclo. Se il rapporto ne valga la pena lo giudica chi legge.
- **Misurato il 18/10/2026 prima di scriverlo** (yfinance): SMCI — patrimoniale FORTE (Altman 6,77) e operativa che
  CONSUMA CASSA (−6,8 mld in 12 mesi, −17,4% dei ricavi; +0,7 mld nell'ultimo trimestre), ciclo da 95 a 156 giorni,
  magazzino +8,9 mld; Dell — patrimoniale DEBOLE (0,89) e operativa che SI AUTOFINANZIA (+12,2 mld, 1,07 volte
  l'utile), e agli azionisti il 125% della cassa libera; HPE — DEBOLE (0,99) e SI AUTOFINANZIA, ciclo +20 giorni: il
  suo punteggio basso non viene dal circolante.
- È **INFORMAZIONE**: non una prova della tenuta, non un colore, non una vendita. Lo stato operativo sta già, in altra
  forma, nella famiglia del bilancio della tenuta (§1sexies): non si conta due volte.

## 2. LIVELLO C — RICALCOLABILE, e la mia affermazione contraria era sbagliata

> ⚠⚠ **CORREZIONE (08/09/2026).** Questo file diceva che queste misure «non si ricalcolano da
> dati parziali». È falso: i dati non sono parziali. Con lo storico completo delle posizioni
> — 1.255 barre giornaliere per titolo, raccolte da `scripts/raccolta/` senza chiave e senza la
> pipeline — `scripts/raccolta/libro.py` ricostruisce la matrice di covarianza e ne esce con i
> **numeri della pipeline**: pesi identici, correlazione media **0,357** contro 0,35, scommesse
> effettive **2,2** contro 2,3, gli stessi otto nomi nel gruppo correlato. Gli scarti residui
> sono la finestra dichiarata, non il metodo.
>
> L'avevo scritto due volte al CEO e una volta qui. Resta vera la ragione per cui la frase era
> stata scritta — *un numero plausibile e diverso al posto di quello vero è il difetto peggiore
> che questo progetto produca* — ma la conclusione che ne avevo tratto no.

**Fotografia del 07/09/2026** (run pipeline 21:51 UTC, ultima barra 04/09/2026). Il ricalcolo
indipendente si rigenera in ~90 secondi con `scripts/raccolta/`.
> ⚠ v436: `quadro.json` non esiste piu'. La fonte PUBBLICATA e' `data/data.json` (la pipeline); la
> raccolta e' lo strumento che la verifica — `python3 scripts/riconciliazione.py`.

### Contributo al rischio — quota della varianza del libro, somma 100%

| Titolo | Peso azionario | Contributo al rischio | Divergenza |
|---|---|---|---|
| MU | 23,2% | **35,0%** | +11,8 pp |
| AMD | 15,6% | **18,9%** | +3,3 pp |
| NVDA | 20,3% | **11,7%** | −8,6 pp |
| MSTR | 8,1% | 7,1% | −1,0 pp |
| BE | 3,3% | 5,5% | +2,2 pp |
| WDC | 3,8% | 4,7% | +0,9 pp |
| CRWV | 3,1% | 4,2% | +1,1 pp |
| MRVL | 3,1% | 3,3% | +0,2 pp |
| PLTR | 5,7% | 2,9% | −2,8 pp |
| RGTI | 2,3% | 2,9% | +0,6 pp |
| ORCL | 3,6% | 2,6% | −1,0 pp |
| GOOGL | 5,5% | 1,2% | −4,3 pp |

⚠ **SKHY è FUORI dal conto** — meno di 60 sedute in comune con l'ancora. Il 100% è calcolato
senza il suo peso: non è "non contribuisce", è "non misurabile".

> ⚠⚠ **E ORA È MISURATA (08/09/2026), su una finestra corta e DICHIARATA.** L'ADS `SKHY` è
> quotata dal 13/07/2026: quaranta sedute è tutta la sua vita, non un buco della raccolta.
> Su quelle quaranta: correlazione con NVDA **0,45** — cioè **dentro** il gruppo correlato — e
> con **MU 0,83**, il legame più forte del libro. Volatilità annua 117,6%.
> **SKHY non diversifica rispetto a MU: aggiunge alla stessa scommessa.**
>
> ⚠ La tentazione era sostituire la serie di Seoul (KRX-000660, 1.222 barre). Misurato e
> **rifiutato**: in won e su una seduta che chiude prima di New York la correlazione con NVDA
> scende a **0,20** (0,22 sfasando di una seduta), cioè sotto la soglia del gruppo correlato.
> Una serie lunga che inverte la conclusione è peggio di una serie corta dichiarata. Le due
> quotazioni vivono sotto due chiavi distinte e nessuna si traveste dall'altra.
>
> ⚠ E una serie corta non deve accorciare il libro: intersecando tutto, le 124 sedute della
> matrice diventavano 39 per tutti e ogni numero cambiava in silenzio — il segno che la misura
> aveva smesso di misurare era **ES95 identico al VaR95**, perché con 39 rendimenti la coda al
> 5% ha due osservazioni. Ora chi non copre la finestra viene escluso e dichiarato.

### Gruppo correlato — correlazione dei rendimenti giornalieri ≥ 0,35 con NVDA

**Dentro (8 nomi = 74,3% dell'azionario)**: NVDA 1,00 · CRWV 0,48 · AMD 0,46 · MU 0,41 ·
ORCL 0,41 · MRVL 0,41 · RGTI 0,37 · BE 0,36

**Fuori, misurati e indipendenti dall'ancora**: MSTR 0,33 · WDC 0,32 · GOOGL 0,23 · PLTR 0,20
⚠ "Indipendenti" vale RISPETTO A NVDA: fra loro possono muoversi insieme.

**Non misurabile**: SKHY.

### Correlazione media e massima per posizione

| Titolo | Corr. media | Corr. massima | con | Beta vs NDX | Sharpe 1A | Sortino 1A |
|---|---|---|---|---|---|---|
| MU | 0,40 | 0,71 | WDC | 2,87 | 2,51 | 4,06 |
| WDC | 0,38 | 0,71 | MU | 2,44 | 2,01 | 3,08 |
| CRWV | 0,41 | 0,59 | ORCL | 2,41 | −0,03 | −0,05 |
| ORCL | 0,33 | 0,59 | CRWV | 1,43 | −0,63 | −0,98 |
| AMD | 0,40 | 0,60 | MU | 2,52 | 1,59 | 2,58 |
| BE | 0,39 | 0,55 | WDC | 3,12 | 1,29 | 1,96 |
| MRVL | 0,36 | 0,53 | MU | 2,48 | 1,60 | 2,55 |
| NVDA | 0,38 | 0,52 | CRWV | 1,32 | 0,76 | 1,12 |
| MSTR | 0,30 | 0,45 | RGTI | 1,88 | −1,14 | −1,60 |
| RGTI | 0,36 | 0,45 | MSTR | 2,70 | −0,03 | −0,04 |
| PLTR | 0,25 | 0,42 | MSTR | 1,30 | 0,16 | 0,24 |
| GOOGL | 0,21 | 0,27 | WDC | 0,77 | 1,07 | 1,69 |

### Rischio del libro nel suo insieme

- **Beta vs Nasdaq 100: 2,11** · correlazione media fra le posizioni **0,35**
- **VaR 95% a 1 giorno**: 4,84% (parametrico) · **5,0%** (storico)
- **Expected Shortfall 95%**: 6,07% (parametrico) · **6,19%** (storico)
- **Sharpe 1,72** · **Sortino 2,53** (tasso privo di rischio 3,63%)
- **Scommesse effettive: 2,3 su 12 nomi** — formula `1/((1−ρ)·H + ρ)` con ρ correlazione media
  e H l'indice di Herfindahl dei pesi VERI (non 1/k: a pesi uguali darebbe 2,5)

### Confronti su 125 sedute — stessa finestra, stessi dati

| Portafoglio | Volatilità annua | Drawdown max | Scommesse eff. | Cosa isola |
|---|---|---|---|---|
| **Il libro (pesi reali)** | **51,0%** | **−24,5%** (66 sedute sott'acqua) | 2,3 su 12 | — |
| Stessi nomi, pesi uguali | 52,0% | −31,2% (66) | 2,5 su 12 | l'effetto delle scelte di peso |
| Senza le prime tre | 49,1% | −31,0% (66) | 2,4 su 9 | l'effetto della concentrazione |
| Solo Nasdaq 100 | 21,8% | −11,0% (67) | — | l'effetto della selezione dei nomi |
| Solo semiconduttori (SOX) | 52,7% | −28,6% (53) | — | idem |

### Drawdown massimo per posizione (125 sedute)

MSTR −58% (81 sedute sott'acqua, non recuperato) · CRWV −56% (84) · ORCL −53% (67) ·
BE −53% (53) · RGTI −51% (69) · MRVL −48% (64) · MU −39% (49) · **il meno profondo: NVDA −19%**

## 3. QUANTO INVECCHIANO — e cosa fare

| Misura | Velocità | Come si aggiorna |
|---|---|---|
| **Pesi sull'azionario** | ogni giorno | li ricalcolo io: quantità × prezzo corrente. NON servono da qui |
| **Correlazioni, gruppo correlato, correlazione media, beta di libro** | lente (finestra 125-250 sedute) | reggono settimane; da rinfrescare ~mensilmente |
| **Contributo al rischio (MCR)** | media — dipende da correlazioni (lente) E pesi (veloci) | da rinfrescare dopo ogni operazione o dopo un movimento >15% su una prima posizione |
| **VaR / ES / volatilità / drawdown** | media | ~mensile |
| **Scommesse effettive** | media | con l'MCR |

⚠⚠ **Il sistema NON va mantenuto per essere letto.** Resta online e continua a girare da solo:
quando questi numeri invecchiano, il CEO apre la pagina, copia il pacchetto e incolla SOLO il
blocco di rischio. Zero manutenzione, sei numeri.

## 4. COSA SI PERDE BYPASSANDO, dichiarato

Ogni analisi che poggia su una di queste misure deve **dichiarare la data della fotografia**
(07/09/2026) e quanto è vecchia. Una misura di rischio spacciata per corrente è precisamente
il difetto che il sistema ha passato mesi a togliere.

Se una misura non c'è e non è in questo file, la risposta è **"non disponibile"**, mai una stima.
