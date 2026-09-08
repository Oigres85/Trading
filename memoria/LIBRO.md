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
| ORCL | 70 | 143,00 | USD | |
| RGTI | 463 | 26,5048 | USD | |
| GOOGL | 50 | 340,20 | USD | |
| SKHY | 45 | 139,00 | USD | SK hynix, listata a Seoul — emittente estero, deposita 6-K/20-F |
| MRVL | 42 | 214,08 | USD | |
| BE | 40 | 214,00 | USD | |
| WDC | 25 | 458,00 | USD | |
| BTP-V28 | 40.000 nominali | 100 | EUR | BTP Valore Ott 2028 — valorizzato nominale × prezzo/100 |

**Liquidità: 10.000 €** — confermata dal CEO l'08/09/2026.

⚠ Il sistema NON conosce: altri conti, altri strumenti, posizioni corte, margine, coperture,
situazione fiscale. **Il divieto di dimensionare resta in piedi**: direzione, priorità e livelli
di prezzo sì; quantità no.

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
indipendente dell'08/09 sta in `memoria/dati/quadro.json`, rigenerabile in ~90 secondi.

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
