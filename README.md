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
| Quotazioni, storico, P/E, volumi, rating analisti, trimestrali, opzioni put/call, VIX, Treasury 10A, FX, BTC, WTI, KOSPI, Nasdaq, futures Fed Funds | Yahoo Finance (yfinance) |
| Fear & Greed Index | CNN |
| CPI, PCE, PIL, vendite al dettaglio, NFP, disoccupazione, fiducia consumatori, tassi Fed | FRED (csv pubblico), con fallback BLS API / DBnomics (BEA) / NY Fed |
| Rendimento JGB 10 anni (carry USA-Giappone) | MOF Giappone (csv ufficiale) |
| Prezzo BTP Valore Ott 2028 (IT0005565400) | Borsa Italiana |
| News (solo titoli in portafoglio) | RSS: CNBC, Bloomberg, Yahoo Finance, Investing.com, Google News |

Sezioni: KPI, *Macro & Mercati* (gauge sentiment risk-on/off, Fear & Greed, VIX, FedWatch, carry USA-Giappone, put/call BSX, termometro tecnico del portafoglio + indicatori macro e mercati), portafoglio con dati tecnici, rating analisti, target price, prossime trimestrali e mini-grafici commutabili 1G/1M/1A, watchlist (OKLO, SPCX, CBRS), news.

## Funzioni della pagina

- **⟳ Aggiorna** — rigenera TUTTI i dati in tempo reale: lancia il workflow GitHub e ricarica la pagina appena i nuovi dati sono pubblicati (~2-3 min). Alla prima pressione chiede un token GitHub (fine-grained, solo questo repo, permesso *Actions: read & write* — si crea su https://github.com/settings/personal-access-tokens), salvato solo nel browser. Senza token, ricarica gli ultimi dati pubblicati.
- **🤖 Prompt AI** — genera e copia un prompt con il riepilogo completo dei dati da incollare in Claude per l'analisi
- **🧮 Calc. PMC** — link al [calcolatore prezzo medio](https://fical.net/it/calcolatore-prezzo-medio)

Le news mostrano solo le notizie correlate ai titoli in portafoglio. La sezione *Macro & Mercati* include anche Bitcoin, petrolio WTI, KOSPI e Nasdaq.

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
