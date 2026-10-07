# IL LIBRO — memoria di lavoro

> Questo file È la fonte di verità da quando abbiamo bypassato il sistema (08/09/2026).
> Sostituisce `config/posizioni.json` + `config/portfolio_state.json` + il blocco di rischio
> di `data/data.json`. Va aggiornato a mano quando il CEO opera.

## 1. POSIZIONI — confermate dal CEO l'08/09/2026

| Ticker | Quantità | PMC | Valuta | Note |
|---|---|---|---|---|
| NVDA | 270 | **87,1667** | USD | ⚠ confermato dal CEO: `portfolio_state.json` diceva 81,167 ed era sbagliato |
| MSTR | 173 | 173,3045 | USD | |
| CRWV | 105 | 97,199 | USD | |
| AMD | 100 | 153,916 | USD | |
| PLTR | 100 | 113,50 | USD | |
| MU | 70 | 87,63 | USD | |
| RGTI | 463 | 26,5048 | USD | |
| SKHY | 45 | 139,00 | USD | SK hynix, listata a Seoul — emittente estero, deposita 6-K/20-F |
| MRVL | 42 | 214,08 | USD | |
| BE | 40 | 214,00 | USD | |
| BTP-V28 | 40.000 nominali | 100 | EUR | BTP Valore Ott 2028 — valorizzato nominale × prezzo/100 |

**Liquidità: ~59.000 €** — ~50.000 € dichiarati dal CEO il 01/10/2026 ("circa", dopo le uscite da
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

⚠ Il sistema NON conosce: altri conti, altri strumenti, posizioni corte, margine, coperture,
situazione fiscale. **Il divieto di dimensionare resta in piedi**: direzione, priorità e livelli
di prezzo sì; quantità no.

## 1bis. SORVEGLIATI — non in posizione, monitorati come i titoli del libro

Il CEO li segue per una rotazione possibile. **Non sono posizioni**: non entrano nel patrimonio,
nei pesi, nel contributo al rischio ne' in nessuna misura del libro. Entrano solo nella lettura
tecnica e nelle notizie, con l'etichetta che dichiara cosa sono.

| Ticker | Nota |
|---|---|
| SMCI | Super Micro Computer — server AI. Candidato di rotazione da CRWV (CEO, 14/09/2026) |
| OKLO | Oklo — reattori nucleari modulari per datacenter. Candidato di rotazione da CRWV (CEO, 14/09/2026) |
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

⚠ **Un candidato di rotazione dentro lo stesso tema NON diversifica**: sposta la stessa scommessa
su un altro nome. SMCI e OKLO vivono entrambi sul capex AI, che e' il canale su cui il libro e'
gia' concentrato.

## 1ter. SEMAFORO D'USCITA — deciso col CEO il 06/10/2026, si controlla a OGNI analisi

Domanda del CEO: *"quando capire di dover uscire, onde evitare di subire in pieno un prossimo
crollo"*, con la tesi che l'AI abbia margine di crescita fino al 2029. Il momento del crollo non
si prevede: si decidono PRIMA i segnali e la reazione, poi si esegue senza ridiscuterla.
Le soglie sono **convenzioni del mestiere scelte col CEO**, non dati del file (v240). I livelli
dei prezzi si leggono **dal giorno**, mai da questa pagina: qui stanno le regole, non i numeri,
perché un numero scritto a mano invecchia da solo (v410, v424).

| Famiglia | Segnale | Dove si legge |
|---|---|---|
| **Prezzo** | SMH chiude sotto la propria media a 50 giorni; secondo gradino: sotto la media a 200 | `data.json` → `macro.tilt[SMH].medie` |
| **Leader** | NVDA, AMD e MU chiudono **insieme** sotto la propria media a 50 giorni, con volumi alti | `brief.py` (distanza SMA50 in ATR) |
| **Credito** | spread **CCC** (la fascia peggiore) salito di **1,5 punti o più** sul proprio minimo delle 60 sedute precedenti — è il segnale che arriva per primo (v465); poi spread high yield (HY OAS) sopra 3,5; secondo gradino: sopra 4,0 | `brief.py` → macro (riga «Spread CCC», con la salita accanto) |
| **Tassi** | Treasury 10 anni sopra 5,4% | `brief.py` → macro |
| **Fondamentali AI** | revisioni delle stime che girano al ribasso su NVDA/MU (più tagli che rialzi a 30 giorni), oppure un hyperscaler (MSFT, GOOGL, META, AMZN) che TAGLIA la guida sugli investimenti | `schede_progetto.py` + conti di fine ottobre |
| **Leva** | il margin debt FINRA comincia a scendere dal picco (variazione mensile negativa) | `data.json` → `macro.margin_debt` |

**Reazione a gradini** (la proporzione è una convenzione scelta col CEO, non un calcolo):
- 🟢 **Verde** — nessun segnale: si opera normalmente.
- 🟡 **Giallo** — un segnale: niente nuovi acquisti di semiconduttori; prese di profitto sui nomi più
  tirati.
- 🟠 **Arancione** — due segnali di **famiglie diverse**: riduzione dei semiconduttori di circa un
  terzo, partendo da chi pesa di più nel rischio (oggi MU e AMD).
- 🔴 **Rosso** — SMH sotto la media a 200 **e** (credito sopra 4,0 **oppure** taglio della guida
  sugli investimenti AI): un altro terzo. Resta il nucleo per la tesi al 2029.

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
   gli stop sui livelli già decisi (RGTI, CRWV, SMH, Treasury 10 anni, vedi §1ter e il piano in
   `FORMATO_ANALISI.md`) non dipendono da nessuna scadenza: rimandarli è l'unico pezzo dell'attesa
   che costa senza dare niente in cambio.
4. **Oltre la scadenza, aspettare è una scommessa binaria**: la trimestrale riprezza il nome in una
   seduta, spesso di più dell'oscillazione di una settimana intera. Una decisione ancora aperta il
   giorno prima della trimestrale va presa o dichiarata rimandata **di proposito**, non lasciata
   scadere.
5. Il semaforo d'uscita (§1ter) **scavalca** le scadenze: se passa ad arancione o rosso, si agisce
   secondo il gradino senza aspettare la data.

**Fotografia del 06/10/2026, solo come riferimento — non sono le soglie**: seduta tipica ±9.500 $,
settimana ±21.200 $, VaR95 −15.800 $, ES95 −20.000 $; scadenze BE 27/10 · MSTR 29/10 · PLTR 02/11 ·
AMD 03/11 · CRWV e RGTI 09/11 · NVDA 18/11 (MU, SKHY, MRVL senza data nella finestra). Esterne:
verbali Fed 07/10, ASML 14/10, TSM 15/10, FOMC 28/10. Lettura di quel giorno: attesa ragionevole
fino a metà ottobre; BE da decidere entro il 27/10, AMD entro il 03/11.

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
