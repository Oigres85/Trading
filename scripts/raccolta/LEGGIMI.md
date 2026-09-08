# Raccolta dati fuori dal sistema GitHub

Nasce dalla decisione del CEO (08/09/2026): *"il sistema non è affidabile e spreco token per
aggiustarlo"*. Questi script acquisiscono gli stessi dati **senza** la pipeline `update_data.py`,
senza GitHub Actions e senza chiavi API, e li mettono in cache sotto `memoria/dati/`
(non versionata: si rigenera in ~90 secondi).

| script | cosa fa |
|---|---|
| `preleva.py` | storico OHLC giornaliero per titolo (5 anni) e serie FRED grezze |
| `fred_cache.py` | scarica le serie FRED **una alla volta**, con pausa e cache per serie |
| `tecnica.py` | indicatori e statistiche storiche dalle barre giornaliere |
| `libro.py` | rischio di libro: correlazioni, contributo al rischio, VaR/ES, scommesse effettive |
| `macro.py` | quadro macro con percentili calcolati sulla serie intera e su finestre dichiarate |
| `cambio.py` | EUR/USD dal tasso di riferimento **BCE** |
| `quadro_macro.py` | le 21 serie FRED con percentili, direzione e la loro profondità vera |
| `fondamentali.py` | bilanci depositati, target degli analisti, storico utili (Nasdaq) |
| `notizie.py` | notizie per titolo dai feed dei fornitori |
| `canali.py` | sensibilità di ogni titolo ai canali macro, con il pavimento del rumore |
| `assembla.py` | mette insieme tutto in `memoria/dati/quadro.json` |
| `rapporto_html.py` | rende il quadro in una pagina, senza grafici |

## ⚠ Il cambio viene dalla BCE, non da FRED

`DEXUSEU` esiste su FRED ed è comodo, ma viene ridistribuito con giorni di ritardo — misurato
l'08/09/2026: ultima osservazione il **28/08**, undici giorni prima. Su un moltiplicatore che
riporta VaR, ES, drawdown e contributo al rischio dal comparto azionario al **patrimonio**,
undici giorni di cambio valgono circa un punto percentuale.

Il tasso di riferimento BCE è ufficiale, gratuito, senza chiave, e porta 90 giorni di storico.
Si pubblica intorno alle 16:00 CET di ogni giorno lavorativo TARGET: prima di quell'ora la data
più recente è quella del giorno prima, ed è corretto. **La data viaggia col numero.**

⚠ E due limiti si dichiarano invece di sparire: la conversione è al cambio di **oggi**, non al
costo sostenuto (il cambio di carico è diverso posizione per posizione e il sistema non lo
conosce); il BTP è valorizzato **alla pari** perché la sua quotazione viva non c'è — e il
rapporto misura quanto pesa non saperla, ±0,2 punti sulla quota.

## ⚠⚠ L'USER-AGENT VA PER FONTE, E IL VERSO È OPPOSTO FRA LE DUE

Misurato, deterministico, in entrambi i versi:

| fonte | con UA browser | senza UA |
|---|---|---|
| stockanalysis.com | ok | ok |
| api.nasdaq.com | ok | **rc=28, nessuna risposta** |
| FRED | **rc=28 / rc=52** | ok, 268 KB in 0,4 s |

È la GOTCHA già scritta in `CLAUDE.md` per FINRA e WSJ (403 all'UA "browser completo", 200 a un
UA generico), qui su due fonti nuove e **con un sintomo diverso**: FRED non rifiuta, **tace** — la
connessione muore senza codice di stato. Un rifiuto muto si legge come un guasto di rete o come
un limite di frequenza, ed è esattamente la diagnosi sbagliata che avevo dato prima di misurare
(*"ho martellato FRED con richieste parallele"*: falso, era l'header).

> **Un rifiuto muto è peggio di un 403, perché non si dichiara.**

## ⚠ `--http1.1` è obbligatorio

Attraverso il proxy, HTTP/2 chiude lo stream a metà sui trasferimenti lunghi (curl rc=92,
INTERNAL_ERROR). È un errore di **trasporto**, non della fonte: senza quel flag una serie da
268 KB risulta "non letta" mentre la fonte risponde benissimo. Si ritenta **solo** sugli errori
di trasporto (18, 55, 56, 92), mai su un rifiuto della fonte — un 429 che si ritenta è martellare
chi ti sta dicendo di rallentare (lezione v398).

## Limiti dichiarati

- **SKHY**: le fonti americane portano ~40 barre. È lo stesso buco che il vecchio sistema
  dichiarava — non è stato nascosto, è nominato dovunque la posizione compaia.
- **Spread ICE BofA** (`BAMLH0A0HYM2`, `BAMLC0A0CM`): FRED ne ridistribuisce pubblicamente solo
  **tre anni**, quindi il percentile "storico" di quelle due serie è su tre anni e la riga lo dice.
  Non è un buco della raccolta: è la licenza della fonte.
- **Chiusure**: `stockanalysis.com` porta anche la **rettificata**, che è quella giusta per medie,
  rendimenti e volatilità. Il canale di riserva (`api.nasdaq.com`) **non** la porta, e in quel
  caso il file lo dichiara nel campo `fonte`.

## Il rapporto

`assembla.py` mette insieme quello che i raccoglitori hanno letto in `memoria/dati/quadro.json`
(non calcola nulla di nuovo: chiama i moduli che già esistono — una seconda derivazione della
stessa grandezza diverge al primo ritocco). `rapporto_html.py` lo rende in una pagina.

**Niente grafici**, per decisione del CEO dell'08/09/2026: *"grafici eliminali ma tieni conto dei
dati che da essi emergono compreso storico per quelli macro"*. La lettura che un grafico darebbe
è il percentile, e quello è un numero.

Ciclo completo, ~90 secondi:

```
cd scripts/raccolta
python3 preleva.py MU NVDA AMD MSTR PLTR GOOGL WDC ORCL BE MRVL CRWV RGTI TSM SKHY SPY QQQ SMH TLT UUP
python3 fondamentali.py MU NVDA AMD MSTR PLTR GOOGL WDC ORCL BE MRVL CRWV RGTI TSM SKHY
python3 notizie.py     MU NVDA AMD MSTR PLTR GOOGL WDC ORCL BE MRVL CRWV RGTI TSM SKHY
python3 quadro_macro.py          # 21 serie FRED, in cache per serie
python3 assembla.py              # → memoria/dati/quadro.json
python3 rapporto_html.py /tmp/quadro.html
```

## Le cinque sezioni dello schema del CEO, e da dove escono

| sezione | fonte |
|---|---|
| 1 · Dati di mercato e prezzi | barre giornaliere + `api.nasdaq.com/quote/…/summary` |
| 2 · Dati finanziari e rapporti chiave | `api.nasdaq.com/company/…/financials` — conto economico, stato patrimoniale, flussi di cassa e indici, quattro trimestri e quattro esercizi |
| 3 · Analisi tecnica e indicatori | calcolati qui dalle barre: RSI, MACD, stocastico, StochRSI, CCI, ATR, ADX, SMA 5/10/20/50/100/200, EMA, pivot di Fibonacci |
| 4 · Target price e rating analisti | `api.nasdaq.com/analyst/…/targetprice` e `/ratings` |
| 5 · Storico utili e previsioni | `api.nasdaq.com/company/…/earnings-surprise` e `/analyst/…/earnings-forecast` |

⚠ **Niente è ricalcolato e niente è stimato nei bilanci**: ogni riga esce dal deposito con la
propria data di chiusura periodo accanto, e dove quel deposito ha più di cento giorni la scheda
lo dichiara. Un TTM non si compone sommando quattro trimestri presi da tabelle diverse.

⚠ **Su un indice cumulativo il percentile del livello non è un'informazione.** CPI e PCE escono
al 100° percentile della propria storia *per costruzione* — un indice che sale sta sempre al
proprio massimo — e chi legge concluderebbe «inflazione da record». Per quelle serie il
percentile si calcola sulla **variazione a dodici mesi**, e la riga lo dichiara.

⚠ **L'ADS di SK hynix e l'azione di Seoul sono due chiavi distinte**, mai una travestita
dall'altra: la seconda è la stessa società in un'altra valuta e su un'altra seduta, e misurata
dà una conclusione **opposta** sul gruppo correlato (0,20 contro 0,45). Vedi `memoria/LIBRO.md`.
