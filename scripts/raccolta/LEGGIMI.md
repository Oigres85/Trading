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
