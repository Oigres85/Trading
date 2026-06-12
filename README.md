# Trading Dashboard

Dashboard del portafoglio con dati tecnici, indicatori macro e news, pubblicata su GitHub Pages.

**Live:** https://oigres85.github.io/Trading/

## Come funziona

- `index.html` + `assets/` — pagina statica (tema dark) che legge `data/data.json`
- `scripts/update_data.py` — pipeline Python che raccoglie i dati e genera `data/data.json`
- `.github/workflows/update-data.yml` — GitHub Actions: rigenera i dati ogni ~20 min in orario di mercato (e a ogni `workflow_dispatch`), li committa e GitHub Pages si aggiorna da solo

## Fonti dati (tutte gratuite)

| Dato | Fonte |
|---|---|
| Quotazioni, storico, P/E, volumi, VIX, EUR/USD, futures Fed Funds | Yahoo Finance (yfinance) |
| Fear & Greed Index | CNN |
| CPI, PCE, PIL, vendite al dettaglio, NFP, disoccupazione, fiducia consumatori, tassi Fed | FRED (csv pubblico), con fallback BLS API / DBnomics (BEA) |
| Prezzo BTP Valore Ott 2028 (IT0005565400) | Borsa Italiana |
| News | RSS: CNBC, Bloomberg, Yahoo Finance, Investing.com, Google News |

## Funzioni della pagina

- **⟳ Aggiorna** — ricarica `data.json` (i dati si rigenerano comunque da soli via Actions)
- **🤖 Prompt AI** — genera e copia un prompt con il riepilogo completo dei dati da incollare in Claude per l'analisi
- **🧮 Calc. PMC** — link al [calcolatore prezzo medio](https://fical.net/it/calcolatore-prezzo-medio)

## FRED API key (consigliato)

Il csv pubblico di FRED a volte blocca le richieste. Con una chiave gratuita (https://fred.stlouisfed.org/docs/api/api_key.html) salvata come secret `FRED_API_KEY` del repo (Settings → Secrets and variables → Actions), la pipeline usa l'API ufficiale e tutti gli indicatori (incluse vendite al dettaglio e fiducia consumatori) diventano affidabili.

## Modificare il portafoglio

Le posizioni sono in `scripts/update_data.py` (lista `PORTFOLIO` e dict `BTP`). Dopo la modifica, lanciare il workflow *Aggiorna dati dashboard* da Actions o attendere il prossimo run.

## Esecuzione locale

```bash
pip install -r scripts/requirements.txt
python scripts/update_data.py
python -m http.server 8000   # poi aprire http://localhost:8000
```

*Solo a scopo informativo — non è consulenza finanziaria.*
