#!/usr/bin/env python3
"""Aggiorna data/data.json con quotazioni, dati tecnici, macro e news.

Fonti (tutte gratuite):
- Yahoo Finance (yfinance): quotazioni, storico, fondamentali, rating analisti,
  trimestrali, opzioni (put/call), VIX, futures Fed Funds, Treasury 10A, EURUSD,
  EURJPY, USDJPY, Bitcoin, petrolio WTI, KOSPI, Nasdaq
- CNN: Fear & Greed Index
- FRED (csv pubblico o API con FRED_API_KEY): CPI, PCE, PIL, vendite al dettaglio, NFP,
  disoccupazione, fiducia consumatori, tassi Fed, JGB 10A — fallback BLS API e DBnomics
- NY Fed: range obiettivo Fed quando FRED non risponde
- Borsa Italiana (scrape): prezzo BTP Valore Ott 2028
- RSS (solo news sui titoli in portafoglio): CNBC, Bloomberg, Yahoo Finance,
  Investing.com, Google News
"""
import csv
# ⚠ v389 — `html` MANCAVA, e le news erano morte da quando sono nate (v304).
# Ogni run del CI stampava tre righe identiche — `!! news CNBC Economia: name 'html' is not
# defined` — e nessuno le leggeva, perche' la pipeline usciva 0: l'except le trasformava in
# un avviso su stderr. Conseguenza: `macro["news"]` non veniva MAI scritto, e il blocco del
# pacchetto che pubblica i titoli e' condizionato alla sua esistenza, quindi il pacchetto
# TACEVA. Non "nessuna notizia": proprio nessuna riga sull'argomento.
# E' la classe gia' scritta in CLAUDE.md — i fallback devono essere RUMOROSI — applicata alla
# fonte invece che al dato: un import mancante dentro un try/except per-fonte non rompe niente
# e spegne una funzionalita' intera.
import html
import io
import json
import logging
import math
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    from zoneinfo import ZoneInfo            # py3.9+: gestisce la DST correttamente
except Exception:                            # noqa: BLE001 — ambiente minimale senza modulo
    ZoneInfo = None

import numpy as np
import pandas as pd
import requests
import yfinance as yf

from rumore_yf import zittisci_yfinance   # fonte UNICA, condivisa col rapporto

# yfinance logga internamente ("$TICKER: possibly delisted", 404 quoteSummary) su indici/ticker
# flaky: catturiamo già le eccezioni a valle, quindi il muro per titolo non deve inquinare stderr.
# ⚠⚠ MA NON SI BUTTANO: prima qui c'era setLevel(CRITICAL), che le SCARTAVA. Conseguenza vera,
#    non teorica: quando Yahoo blocca il CI la pipeline non lasciava NESSUNA traccia del perché —
#    la stessa classe della seduta persa (v383/v384), una degradazione che non si vede. Ora si
#    raccolgono e si riassumono per causa alla fine del run: 200 righe diventano 3, e quelle 3
#    dicono se a fermarci è stata la rete, il rate limit o davvero un titolo.
_RUMORE_YF, _ = zittisci_yfinance()

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "data.json"
PREV_DATA: dict = {}   # snapshot del run precedente (settato da main; usato da carry-forward/ratchet)

UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "*/*",
}

DEFAULT_WATCHLIST = [
    {"ticker": "OKLO", "name": None, "currency": "USD"},
    {"ticker": "SPCX", "name": None, "currency": "USD"},
    {"ticker": "CBRS", "name": None, "currency": "USD"},
    {"ticker": "^KS11", "name": "KOSPI", "currency": "PTS"},
    {"ticker": "^IXIC", "name": "Nasdaq Composite", "currency": "PTS"},
    {"ticker": "BTC-USD", "name": "Bitcoin", "currency": "USD"},
    {"ticker": "CL=F", "name": "Petrolio WTI", "currency": "USD"},
]


# ═══ v272 — LA PIPELINE SEGUE LA WATCHLIST DEL CEO, E BASTA ══════════════════════════════
# Domanda del CEO: "quando premo rigenera ci sono punti morti del precedente sistema che
# aggiorna e che in effetti andrebbero tolti perche' rallentano il workflow?". Si', ed erano
# la maggioranza. Misurato: la pipeline scaricava 37 simboli (12 portafoglio + 25 watchlist)
# e VENTUNO non erano nella watchlist che lui guarda — OKLO, SPCX, INTC, AMZN, SMCI, PATH,
# SNDK, CRCL, TSMC, LUMN, US2000, CEG, CRM, CBRS, NOW, IBM, MSFT, AVGO, META e altri: resti
# del sistema di prima, scaricati a ogni run e letti da nessuno. Ogni simbolo costa un giro
# di fetch_symbol (prezzi, storico, fondamentali, tecnici) piu' la catena opzioni.
# Da qui la lista e' UNA SOLA: config/ui_watchlist.json, quella che il CEO scrive dalla
# pagina. Quello che aggiunge in watchlist la pipeline lo segue al giro dopo; quello che
# toglie smette di costare. Spariscono anche le due liste scollegate che erano la causa dei
# buchi ("^SOX non seguito") di cui si era lamentato.
# ⚠ IL PORTAFOGLIO NON SI CALCOLA PIU'. Era gia' uscito dal prodotto in v256 per sua
# decisione ("portafoglio watchlist e news andranno tutti via"), ma la pipeline continuava a
# calcolarne quantita', prezzo medio di carico, plusvalenze, contributo al rischio, Sharpe,
# Sortino e correlazioni: 86.197 caratteri per run che nessuna riga della pagina leggeva.
UI_WATCHLIST = ROOT / "config" / "ui_watchlist.json"


def load_holdings():
    """La lista dei simboli da seguire: config/ui_watchlist.json (scritta dalla UI).
    Ripiego su config/holdings.json e poi sui default, cosi' un file rotto non lascia la
    pipeline senza niente da fare."""
    try:
        simboli = json.loads(UI_WATCHLIST.read_text())
        if isinstance(simboli, list) and simboli:
            wl = []
            for t in simboli:
                t = str(t).strip().upper()
                if not t:
                    continue
                # ⚠ il BTP ha la sua funzione (fetch_btp): non e' su Yahoo, e chiederglielo
                # sarebbe una chiamata sprecata che finisce in errore a ogni run.
                if t == "BTP-V28":
                    continue
                # gli indici e i future non hanno una valuta di quotazione utile: "PTS" e' la
                # convenzione gia' usata qui per dire "punti, non dollari".
                cur = "PTS" if t.startswith("^") or t.endswith("=F") else "USD"
                if t.endswith("=X"):
                    cur = "PTS"
                wl.append({"ticker": t, "name": None, "currency": cur})
            print(f"lista simboli da config/ui_watchlist.json: {len(wl)} titoli", file=sys.stderr)
            return [], wl, None
    except Exception as e:  # noqa: BLE001
        print(f"!! ui_watchlist non leggibile ({e}), uso i default", file=sys.stderr)
    # ⚠ v274 — NIENTE PIU' RIPIEGO SU holdings.json. Il file e' stato cancellato: finche'
    # esisteva, qualcuno (io, fra un mese) poteva ricollegarlo per sbaglio e riportarsi dentro
    # 37 simboli e un portafoglio che il CEO ha chiuso in v256. Un ripiego verso un file morto
    # non e' una rete di sicurezza: e' una strada che riporta indietro.
    return [], DEFAULT_WATCHLIST, None


PORTFOLIO, WATCHLIST, BROKER = load_holdings()

# benchmark settoriale per il calcolo RS 1M: sox=semiconduttori, ndx=tech, sp500=default
SECTOR_BENCH = {
    "NVDA": "sox", "AMD": "sox", "MU": "sox", "INTC": "sox", "RGTI": "sox",
    "QCOM": "sox", "AVGO": "sox", "TXN": "sox", "MRVL": "sox", "ON": "sox",
    "MSTR": "ndx", "TSLA": "ndx", "PLTR": "ndx", "GOOGL": "ndx",
    "META": "ndx", "AMZN": "ndx", "MSFT": "ndx", "AAPL": "ndx",
    "OKLO": "ndx", "SPCX": "ndx", "CBRS": "ndx",
}

BTP = {
    "ticker": "BTP-V28", "name": "BTP Valore Ott 2028", "isin": "IT0005565400",
    "nominal": 40000, "pmc": 100.0, "fallback_price": 103.25,
}

TOP_ETF_LIST = [
    ("SPY",  "S&P 500"),
    ("QQQ",  "Nasdaq 100"),
    ("IWM",  "Russell 2000"),
    ("GLD",  "Oro"),
    ("TLT",  "T-Bond 20Y+"),
    ("VGT",  "Tecnologia"),
    ("XLF",  "Finanza"),
    ("XLE",  "Energia"),
    ("XLV",  "Salute"),
    ("VNQ",  "Real Estate"),
]

# Put/Call ratio come proxy del SENTIMENT DI MERCATO: SPY (ETF S&P 500, opzioni liquidissime,
# ratio ~1.0 rappresentativo). NON usare un singolo titolo (era "BSX"=Boston Scientific: ratio
# ~12 = spazzatura che inquinava marketDirectionScore e smart money).
PUTCALL_SYMBOL = ("SPY", "S&P 500 ETF")

# aliquote per la stima del guadagno netto
TAX_STOCK = 0.26   # capital gain azioni
TAX_BTP = 0.125    # titoli di Stato (aliquota agevolata 12,5%)

# Tasso privo di rischio annuo per lo Sharpe Ratio (parametro di configurazione).
# Default: 3.63% (rendimento T-Bill USA di riferimento). Modificabile via env RISK_FREE_RATE.
RISK_FREE_RATE = float(os.environ.get("RISK_FREE_RATE", "0.0363"))
TRADING_DAYS = 252   # giorni di borsa per l'annualizzazione

# ---- Sanity check anti "Garbage In, Garbage Out" ----
# Conta i valori palesemente errati (glitch API) scartati; il totale finisce in data.json
# come "sanity_filtered" così il prompt AI può dichiararlo.
SANITY_FILTERED = 0


def sane_val(v, lo, hi, what=""):
    """Se il valore è fuori da un range fisicamente plausibile, lo scarta (→ None) e lo conta."""
    global SANITY_FILTERED
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    if not (lo <= v <= hi):
        SANITY_FILTERED += 1
        print(f"!! sanity check: scartato {what}={v} (range plausibile {lo}..{hi})", file=sys.stderr)
        return None
    return v


# Calendario FOMC 2026 (fonte: federalreserve.gov, pubblicato in anticipo) — serve a rendere
# esplicita nel prompt la data della prossima riunione accanto al tasso attuale.
# ⚠ UNICA fonte di verità: giorno della DECISIONE (2° giorno della riunione), quello che conta
# per i mercati. Prima convivevano due liste hardcoded (qui i giorni-1, in fetch_fedwatch i
# giorni-2) e il prompt stampava due date diverse per la stessa riunione (28/07 vs 29/07).
FOMC_2026 = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
             "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"]


def next_fomc_date():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return next((d for d in FOMC_2026 if d >= today), None)

# candidati per la classifica delle maggiori capitalizzazioni mondiali
TOP_CAP_CANDIDATES = {
    "NVDA": "NVIDIA", "MSFT": "Microsoft", "AAPL": "Apple", "GOOGL": "Alphabet",
    "AMZN": "Amazon", "META": "Meta", "AVGO": "Broadcom", "TSLA": "Tesla",
    "TSM": "TSMC", "BRK-B": "Berkshire", "LLY": "Eli Lilly", "WMT": "Walmart",
    "JPM": "JPMorgan", "V": "Visa", "XOM": "Exxon", "ORCL": "Oracle",
    "MA": "Mastercard", "COST": "Costco", "ASML": "ASML", "2222.SR": "Saudi Aramco",
}








# ⚠ v266 — FRED RIFIUTA LO USER-AGENT DA BROWSER. Misurato: la stessa URL csv risponde 200 a
# `curl` e a un UA che si dichiara, e va in timeout con lo UA finto-Chrome che usiamo altrove —
# la protezione anti-bot vede un browser che non si comporta da browser. Conseguenza: il ripiego
# csv di FRED era MORTO per tutte le serie (CPI, PCE, PIL, vendite, NFP, disoccupazione, curva),
# non solo per quelle nuove. Non si vedeva perche' in CI c'e' FRED_API_KEY e si passa dall'API
# ufficiale: il ripiego non veniva mai esercitato, quindi il guasto stava li' in silenzio ad
# aspettare il giorno in cui l'API avrebbe fallito. Su FRED ci si identifica per quello che
# siamo, che oltre a funzionare e' anche la cosa onesta.
UA_ONESTO = {"User-Agent": "Trading-dashboard/1.0 (+https://github.com/Oigres85/Trading)",
             "Accept": "*/*"}


def http_get(url, tries=3, timeout=25):
    last = None
    intestazioni = UA_ONESTO if "stlouisfed.org" in url else UA
    for i in range(tries):
        try:
            r = requests.get(url, headers=intestazioni, timeout=timeout)
            if r.status_code == 200:
                return r
            last = Exception(f"HTTP {r.status_code}")
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(2 * (i + 1))
    raise last


def clamp(v, lo=0, hi=100):
    return max(lo, min(hi, v))


def rsi14(closes: pd.Series) -> float | None:
    if len(closes) < 20:
        return None
    delta = closes.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    rs = gain / loss.replace(0, float("nan"))
    val = 100 - 100 / (1 + rs.iloc[-1])
    return None if math.isnan(val) else round(float(val), 1)


def smc_analysis(hist, lookback=90):
    """Smart Money Concepts da OHLC (gratis): struttura/BOS, FVG, liquidità, order block, bias 0-100.
    Heuristica trasparente sui prezzi giornalieri (non un feed proprietario)."""
    try:
        h = hist.tail(lookback)
        if len(h) < 25:
            return None
        H = [float(x) for x in h["High"]]; L = [float(x) for x in h["Low"]]
        C = [float(x) for x in h["Close"]]; O = [float(x) for x in h["Open"]]
        n = len(C); price = C[-1]; k = 2
        sh_idx = [i for i in range(k, n - k) if H[i] == max(H[i - k:i + k + 1])]
        sl_idx = [i for i in range(k, n - k) if L[i] == min(L[i - k:i + k + 1])]
        last_sh = H[sh_idx[-1]] if sh_idx else max(H)
        last_sl = L[sl_idx[-1]] if sl_idx else min(L)
        prev_sh = H[sh_idx[-2]] if len(sh_idx) >= 2 else None
        prev_sl = L[sl_idx[-2]] if len(sl_idx) >= 2 else None
        structure = "laterale"
        if prev_sh is not None and prev_sl is not None:
            if last_sh > prev_sh and last_sl > prev_sl:
                structure = "rialzista"
            elif last_sh < prev_sh and last_sl < prev_sl:
                structure = "ribassista"
        bos = "rialzista" if price > last_sh else "ribassista" if price < last_sl else None
        # FVG aperti (gap a 3 candele non ancora riempiti) nelle ultime ~30 candele
        bull_fvg = bear_fvg = 0; last_fvg = None
        for i in range(max(2, n - 30), n):
            if L[i] > H[i - 2] and not any(L[j] <= H[i - 2] for j in range(i + 1, n)):
                bull_fvg += 1; last_fvg = {"dir": "rialzista", "lo": round(H[i - 2], 2), "hi": round(L[i], 2)}
            if H[i] < L[i - 2] and not any(H[j] >= L[i - 2] for j in range(i + 1, n)):
                bear_fvg += 1; last_fvg = {"dir": "ribassista", "lo": round(H[i], 2), "hi": round(L[i - 2], 2)}
        liq_above = min([H[i] for i in sh_idx if H[i] > price], default=None)
        liq_below = max([L[i] for i in sl_idx if L[i] < price], default=None)
        # order block: ultima candela contraria prima di un impulso (bull: candela giù poi su forte)
        ob = None
        for i in range(n - 2, max(1, n - 20), -1):
            if C[i] > O[i] and C[i - 1] < O[i - 1] and (C[i] - O[i]) > 1.3 * abs(O[i - 1] - C[i - 1]):
                ob = {"dir": "rialzista", "lo": round(min(O[i - 1], C[i - 1]), 2), "hi": round(max(O[i - 1], C[i - 1]), 2)}; break
        score = 50
        score += 18 if structure == "rialzista" else -18 if structure == "ribassista" else 0
        score += 14 if bos == "rialzista" else -14 if bos == "ribassista" else 0
        score += min(12, bull_fvg * 4) - min(12, bear_fvg * 4)
        score = int(clamp(score))
        label = ("Accumulazione" if score >= 65 else "Lieve rialzo" if score >= 55
                 else "Distribuzione" if score <= 35 else "Lieve ribasso" if score <= 45 else "Neutro")
        return {"bias": score, "label": label, "structure": structure, "bos": bos,
                "bull_fvg": bull_fvg, "bear_fvg": bear_fvg, "last_fvg": last_fvg,
                "liq_above": round(liq_above, 2) if liq_above else None,
                "liq_below": round(liq_below, 2) if liq_below else None,
                "order_block": ob}
    except Exception:  # noqa: BLE001
        return None


def signal_label(price, sma50, sma200, rsi):
    if rsi is not None and rsi >= 70:
        return "Ipercomprato", "warn"
    if rsi is not None and rsi <= 30:
        return "Ipervenduto", "info"
    if sma50 and sma200 and price > sma50 > sma200:
        return "Trend rialzista", "good"
    if sma50 and price > sma50:
        return "Sopra SMA50", "good"
    if sma200 and price < sma200:
        return "Trend debole", "bad"
    return "Neutrale", "neutral"


# nomi comuni → ticker corretti (per chi inserisce "APPLE" invece di "AAPL")
TICKER_ALIAS = {
    "APPLE": "AAPL", "GOOGLE": "GOOGL", "ALPHABET": "GOOGL", "AMAZON": "AMZN",
    "MICROSOFT": "MSFT", "FACEBOOK": "META", "NVIDIA": "NVDA", "TESLA": "TSLA",
    "NETFLIX": "NFLX", "MICRON": "MU", "INTEL": "INTC", "BITCOIN": "BTC-USD",
    "TSMC": "TSM",   # l'ADR USA di Taiwan Semiconductor è TSM: "TSMC" su Yahoo non esiste
}

# Settori noti che Yahoo non popola (ADR neo-quotati: info.sector assente per settimane).
# Senza override finivano nel bucket fantasma "EQUITY" (il quoteType usato come settore!)
# e la CONCENTRAZIONE Technology risultava SOTTOSTIMATA nel prompt — v112.
SECTOR_OVERRIDES = {"SKHYV": "Technology"}


def _finite_pos(v):
    """True solo per numeri FINITI e positivi. NaN è truthy e sopravvive ai check
    booleani ingenui (`if atr:`): questo è il pavimento matematico di sistema (v115)
    per stop, prezzi, ATR — le grandezze che in borsa non possono essere ≤ 0."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and math.isfinite(v) and v > 0


def _risk_reward_str(limite, target, atr):
    """R/R teorico "1:X.X" con risk = 2×ATR sotto il limite e reward = target − limite.
    None (→ n.d.) se dati mancanti, risk non positivo o target sotto il limite."""
    try:
        # _finite_pos anche qui (v115): NaN passerebbe i check booleani e produrrebbe "1:nan"
        if not (_finite_pos(limite) and _finite_pos(target) and _finite_pos(atr)):
            return None
        risk = 2.0 * float(atr)
        reward = float(target) - float(limite)
        if risk <= 0 or reward <= 0:
            return None
        return f"1:{reward / risk:.1f}"
    except Exception:  # noqa: BLE001
        return None


def backup_daily(ticker):
    """Piano B per i PREZZI (OHLCV daily) quando Yahoo non dà lo storico — tutto il lato
    titoli dipende da un'API non ufficiale e rate-limited, serve ridondanza. Catena:
    1) Stooq (gratis, senza chiave) — NB: da alcune reti risponde con un challenge
       anti-bot JS (verificato); il tentativo costa poco e da altri IP può passare;
    2) Tiingo (JSON ufficiale, gratuito con registrazione) SOLO se è impostata la env
       TIINGO_API_KEY (secret GitHub Actions, come FRED_API_KEY) — zero chiamate finché
       Yahoo è sano, quindi il free tier non si consuma.
    Fondamentali/info restano n.d. (fonte diversa = niente stime incrociate)."""
    try:  # --- 1) Stooq CSV ---
        txt = http_get(f"https://stooq.com/q/d/l/?s={ticker.lower()}.us&i=d", tries=1, timeout=15).text
        if txt and not txt.lstrip().startswith("<") and "No data" not in txt:
            df = pd.read_csv(io.StringIO(txt), parse_dates=["Date"], index_col="Date")
            if not df.empty and {"Open", "High", "Low", "Close", "Volume"}.issubset(df.columns):
                return df.tail(260)[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"]), "stooq"
    except Exception as e:  # noqa: BLE001
        print(f"!! stooq {ticker}: {e}", file=sys.stderr)
    key = os.environ.get("TIINGO_API_KEY")
    if key:
        try:  # --- 2) Tiingo JSON (campi adj* = coerenti con auto_adjust di Yahoo) ---
            start = (datetime.now(timezone.utc) - timedelta(days=380)).strftime("%Y-%m-%d")
            js = http_get(f"https://api.tiingo.com/tiingo/daily/{ticker.lower()}/prices?startDate={start}&token={key}",
                          tries=2, timeout=20).json()
            if isinstance(js, list) and len(js) >= 30:
                df = pd.DataFrame(js)
                df["Date"] = pd.to_datetime(df["date"]).dt.tz_localize(None)
                df = df.set_index("Date").rename(columns={
                    "adjOpen": "Open", "adjHigh": "High", "adjLow": "Low",
                    "adjClose": "Close", "adjVolume": "Volume"})
                need = {"Open", "High", "Low", "Close", "Volume"}
                if need.issubset(df.columns):
                    return df.tail(260)[list(need)].dropna(subset=["Close"]), "tiingo"
        except Exception as e:  # noqa: BLE001
            print(f"!! tiingo {ticker}: {e}", file=sys.stderr)
    return None


# Asset SENZA bilanci (indici, cripto, commodity, ETF): il quoteSummary Yahoo risponde 404.
# Saltarli pulisce i log e velocizza la build. ETF noti = TOP_ETF_LIST + SECTOR_ETF + benchmark.
NO_FUNDAMENTALS_ETF = {"SPY", "QQQ", "IWM", "GLD", "TLT", "VGT", "VNQ", "SOXX", "SMH",
                       "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLU", "XLB", "XLRE", "XLC"}

def has_fundamentals(ticker, currency):
    """True per le AZIONI USA con bilanci reali, INCLUSE le multi-classe (BRK-B, BF-B). Esclude
    solo ciò che su Yahoo non ha quoteSummary: indici (^), futures/commodity/fx (=), cripto e
    coppie valutarie (suffisso tipo -USD/-USDT, 3+ lettere) ed ETF noti."""
    tk = ticker.upper()
    if currency != "USD" or tk in NO_FUNDAMENTALS_ETF:
        return False
    if re.search(r"[\^=]", tk):          # indici (^GSPC), futures/fx (CL=F, EURUSD=X)
        return False
    if re.search(r"-[A-Z]{3,}$", tk):    # cripto/coppie: BTC-USD, ETH-USDT — NON tocca BRK-B/BF-B (-B)
        return False
    return True


def bench_close(sym, fallback=None, period="2mo"):
    """Chiusure giornaliere di un benchmark, con FALLBACK (es. ^SOX index → SOXX ETF, molto più
    stabile da IP datacenter). L'RS usa la % di variazione: index ed ETF equivalgono. None se ko."""
    for s in (sym, fallback):
        if not s:
            continue
        try:
            h = yf.Ticker(s).history(period=period, interval="1d", auto_adjust=True)["Close"].dropna()   # Adj Close: split/dividendi non gonfiano la RS
            if len(h) >= 2:
                return h
        except Exception:  # noqa: BLE001
            pass
    return None


def norm_div_yield(v):
    """Normalizza il campo dividendYield di Yahoo a FRAZIONE. FALLBACK euristico (usare
    div_yield_frac quando c'è dividendRate+prezzo): yfinance dà il campo in PERCENTO
    (ORCL 1.39=1,39%, TLT 4.53=4,53%) → /100. ⚠ la soglia 0.25 sbagliava sui titoli a
    yield BASSO (GOOGL 0.25→"25%", MU 0.05→"5%", bug v118): sotto 0.25 non si può
    distinguere "0,25%" (percento) da "25%" (frazione) senza il tasso assoluto."""
    if v is None:
        return None
    return v / 100 if v > 0.25 else v


def div_yield_frac(rate, price, yfield):
    """Dividend yield come FRAZIONE, fonte NON AMBIGUA: dividendo annuo $/azione ÷ prezzo.
    dividendRate è un valore assoluto (GOOGL $0,84, MU $0,46) → yield = rate/price esatto,
    nessuna euristica. Fallback al campo % di Yahoo (norm_div_yield) se il tasso manca.
    Cap di sicurezza: un yield >30% nel nostro universo è un errore di unità → None (il
    payload lo mostra '—', mai un '25%' assurdo su una large-cap tech)."""
    y = None
    if _finite_pos(rate) and _finite_pos(price):
        y = rate / price
    else:
        y = norm_div_yield(yfield)
    if y is not None and y > 0.30:
        return None
    return y


def scrub_cross_currency_stats(stats, financial_currency, quote_currency):
    """GOTCHA ADR/valuta (stessa famiglia di float_pct>100): se i bilanci sono in valuta
    locale (financialCurrency ≠ currency — es. TSM: TWD vs prezzo ADR in USD) i campi di
    Yahoo che mischiano prezzo e bilancio escono con UNITÀ INCOMPATIBILI → spazzatura
    (visto sul campo: TSM P/B 99,2× invece di ~12×, P/FCF 3,2× invece di ~25×).
    Nullifica i campi cross-currency e marca lo stat (fallback rumoroso, non silenzioso)."""
    if stats and financial_currency and quote_currency and financial_currency != quote_currency:
        for k in ("price_to_book", "ev_ebitda", "fcf", "enterprise_value",
                  "revenue_fy", "net_income_fy"):
            stats[k] = None
        stats["cross_currency"] = True
    return stats


def risk_ratios(daily_ret):
    """Sharpe e Sortino ANNUALIZZATI da una serie di LOG-rendimenti giornalieri (≥60 oss.,
    altrimenti (None, None)). Estratto in helper (v112) per calcolare la stessa identica
    metrica su finestre diverse: 12M (veto value trap) e 6M (score dei riabilitati growth).
    Sortino: stesso numeratore dello Sharpe, al denominatore la sola downside deviation
    (radice della media dei quadrati dei rendimenti sotto il Rf giornaliero)."""
    if len(daily_ret) < 60:
        return None, None
    sharpe = sortino = None
    std_d = float(daily_ret.std(ddof=1))
    rf_log = math.log1p(RISK_FREE_RATE)                          # Rf coerente in spazio log
    rp = float(daily_ret.mean()) * TRADING_DAYS                  # log-rendimento annualizzato
    if std_d > 0:
        sharpe = round((rp - rf_log) / (std_d * (TRADING_DAYS ** 0.5)), 2)
    downside = np.minimum(daily_ret.values - rf_log / TRADING_DAYS, 0.0)
    dd_ann = float(np.sqrt(np.mean(downside ** 2)) * (TRADING_DAYS ** 0.5))
    if dd_ann > 0:
        sortino = round((rp - rf_log) / dd_ann, 2)
    return sharpe, sortino


def bar_asof(serie_o_df):
    """Data della BARRA da cui nasce un dato di mercato, in ISO (YYYY-MM-DD).

    ⚠ v261 — PERCHE' SERVE, e perche' non basta `updated_at`.
    La pipeline gira ~20 volte al giorno e ogni run timbra `updated_at`. Ma la barra
    giornaliera sotto quel run puo' essere di ieri, di venerdi', o di tre giorni fa: nei weekend,
    nei festivi, nelle mezze sedute e quando Yahoo pubblica la barra in ritardo. Il portafoglio
    lo dichiarava gia' per ogni titolo (`price_asof`); i blocchi MACRO no — ereditavano solo
    `updated_at`, quindi in un run di domenica il VIX di venerdi' arrivava all'LLM come se fosse
    di adesso. Trovato da un audit indipendente delle fonti e confermato dal CEO, che ha chiesto
    che ogni dato dichiari quando e' stato rilevato "affinche' anche il prompt LLM capisca la
    qualita' temporale del dato e non lo interpreti come assoluto".
    Null-safe per costruzione: se l'indice non e' temporale o la serie e' vuota, torna None e
    chi legge ricade sul comportamento precedente — meglio nessuna data di una data inventata."""
    try:
        idx = getattr(serie_o_df, "index", None)
        if idx is None or len(idx) == 0:
            return None
        ultimo = idx[-1]
        d = getattr(ultimo, "date", None)
        return d().isoformat() if callable(d) else str(ultimo)[:10]
    except Exception:  # noqa: BLE001
        return None


# ═══ v316 — LA COLONNA DI TRADINGVIEW, CALCOLATA DA NOI ═══════════════════════════════════
# Il CEO: "nel box tradingview a fianco c'e' una colonna con dati di tradingview per esempio
# stagionalita', conto economico, performance e dettagli tecnici... possiamo farli tutti nostri
# affinche' siano parte delle informazioni generate nell'analisi di un titolo?".
# ⚠⚠ NON SI RAGLIA IL WIDGET, SI CALCOLA. Quei numeri stanno dentro un iframe di terzi: leggerli
# sarebbe fragile, vietato dai loro termini, e soprattutto INUTILE — le formule sono pubbliche e
# l'OHLCV ce l'abbiamo gia' scaricato qui. Quello che pubblichiamo lo calcoliamo, con la formula
# dichiarata: cosi' il numero e' nostro e sappiamo cosa significa.
# ⚠ E NON SI CALCOLA LATO PAGINA. Le `sparks` in data.json sono SOTTO-CAMPIONATE e SENZA DATE
# (51 punti per un anno intero): un MACD o un ADX calcolati li' sopra darebbero numeri che
# sembrano giusti e non lo sono. Qui c'e' la barra giornaliera vera, ed e' l'unico posto dove
# questi conti si possono fare senza mentire.
def _ema_serie(s, n):
    return s.ewm(span=n, adjust=False).mean()


def _rsi(c, n=14):
    d = c.diff()
    su = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    giu = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = su / giu.replace(0, float("nan"))
    out = 100 - 100 / (1 + rs)
    return out.mask(giu.eq(0) & su.gt(0), 100.0).mask(su.eq(0) & giu.gt(0), 0.0)


def _adx(h, n=14):
    """Average Directional Index (Wilder). Misura la FORZA del trend, non la direzione."""
    import pandas as pd
    alto, basso, chiu = h["High"], h["Low"], h["Close"]
    su, giu = alto.diff(), -basso.diff()
    dm_su = ((su > giu) & (su > 0)) * su
    dm_giu = ((giu > su) & (giu > 0)) * giu
    tr = pd.concat([alto - basso, (alto - chiu.shift()).abs(), (basso - chiu.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / n, adjust=False).mean()
    di_su = 100 * dm_su.ewm(alpha=1 / n, adjust=False).mean() / atr.replace(0, float("nan"))
    di_giu = 100 * dm_giu.ewm(alpha=1 / n, adjust=False).mean() / atr.replace(0, float("nan"))
    dx = 100 * (di_su - di_giu).abs() / (di_su + di_giu).replace(0, float("nan"))
    return dx.ewm(alpha=1 / n, adjust=False).mean(), di_su, di_giu


def conto_trimestrale(t, quanti=6):
    """Il CONTO ECONOMICO trimestrale: ricavi, utile netto, margine. La pipeline pubblicava solo
    l'annuale (4 righe), e su una societa' ciclica l'anno nasconde esattamente cio' che conta —
    il trimestre in cui la curva gira. ⚠ Yahoo cambia i nomi delle voci: si cercano per
    ALIAS e se non si trova la voce si lascia il campo vuoto, non si stima."""
    try:
        q = t.quarterly_financials
        if q is None or q.empty:
            return None
    except Exception:  # noqa: BLE001
        return None

    def voce(*nomi):
        for n in nomi:
            if n in q.index:
                return q.loc[n]
        return None

    ric = voce("Total Revenue", "Operating Revenue", "Revenue")
    uti = voce("Net Income", "Net Income Common Stockholders", "Net Income From Continuing Operation Net Minority Interest")
    ope = voce("Operating Income", "Total Operating Income As Reported", "EBIT")
    if ric is None:
        return None
    fuori = []
    for col in list(q.columns)[:quanti]:
        try:
            r = float(ric.get(col)) if ric is not None and ric.get(col) == ric.get(col) else None
        except Exception:  # noqa: BLE001
            r = None
        if r is None:
            continue
        def num(s):
            try:
                v = float(s.get(col)) if s is not None else None
                return v if v == v else None
            except Exception:  # noqa: BLE001
                return None
        u, o = num(uti), num(ope)
        fuori.append({"trim": col.strftime("%Y-%m-%d"), "ricavi": round(r),
                      "utile": round(u) if u is not None else None,
                      "operativo": round(o) if o is not None else None,
                      "margine": round(u / r * 100, 1) if u is not None and r else None,
                      "margine_op": round(o / r * 100, 1) if o is not None and r else None})
    return fuori or None


def barre_ohlc(hist, quante=70):
    """Le ultime barre giornaliere, per disegnare le candele nel PDF.
    ⚠⚠ SENZA QUESTE IL PDF NON PUO' ESISTERE. Le `sparks` in data.json sono chiusure
    SOTTO-CAMPIONATE e SENZA DATE: con quelle si disegnerebbe una linea che somiglia al prezzo,
    non le candele — e una candela senza apertura, massimo e minimo non e' una candela.
    ⚠ Settanta barre e non trecento: il peso in data.json cresce per ogni titolo seguito, e
    settanta sedute sono il trimestre che si guarda su un grafico giornaliero. Chi vuole
    l'orizzonte lungo ha le medie e la performance, che sono gia' pubblicate."""
    if hist is None or hist.empty:
        return None
    h = hist.tail(quante)
    fuori = []
    for d, r in h.iterrows():
        try:
            o, hi, lo, c = float(r["Open"]), float(r["High"]), float(r["Low"]), float(r["Close"])
        except Exception:  # noqa: BLE001
            continue
        if not all(x == x for x in (o, hi, lo, c)):
            continue
        fuori.append({"d": d.strftime("%Y-%m-%d"), "o": round(o, 2), "h": round(hi, 2),
                      "l": round(lo, 2), "c": round(c, 2)})
    return fuori or None


def batteria_tecnica(hist):
    """I 'dettagli tecnici': medie mobili e oscillatori, ognuno con la propria formula standard.
    ⚠ Il CONTEGGIO delle medie battute e' la sintesi che TradingView chiama 'Moving Averages':
    non e' un giudizio nostro, e' quante medie il prezzo sta sopra su quante ne esistono. Lo
    pubblichiamo come conteggio proprio per questo — un'etichetta 'compra/vendi' sarebbe un
    verdetto, e i verdetti sono stati tolti dal sistema in v200."""
    if hist is None or len(hist) < 30:
        return None
    c, alto, basso = hist["Close"], hist["High"], hist["Low"]
    p = float(c.iloc[-1])
    medie = {}
    for n in (10, 20, 30, 50, 100, 200):
        if len(c) >= n:
            sma = float(c.rolling(n).mean().iloc[-1])
            ema = float(_ema_serie(c, n).iloc[-1])
            medie[f"sma{n}"] = {"liv": round(sma, 2), "dist_pct": round((p / sma - 1) * 100, 2)}
            medie[f"ema{n}"] = {"liv": round(ema, 2), "dist_pct": round((p / ema - 1) * 100, 2)}
    sopra = sum(1 for v in medie.values() if v["dist_pct"] > 0)

    osc = {}
    rsi = _rsi(c)
    if rsi.notna().any():
        osc["rsi14"] = round(float(rsi.iloc[-1]), 1)
    ml, ms = _ema_serie(c, 12), _ema_serie(c, 26)
    macd = ml - ms
    segnale = _ema_serie(macd, 9)
    osc["macd"] = {"linea": round(float(macd.iloc[-1]), 2), "segnale": round(float(segnale.iloc[-1]), 2),
                   "istogramma": round(float(macd.iloc[-1] - segnale.iloc[-1]), 2)}
    if len(c) >= 14:
        bb, aa = basso.rolling(14).min(), alto.rolling(14).max()
        k = 100 * (c - bb) / (aa - bb).replace(0, float("nan"))
        osc["stoch_k"] = round(float(k.iloc[-1]), 1) if k.notna().iloc[-1] else None
        osc["stoch_d"] = round(float(k.rolling(3).mean().iloc[-1]), 1) if len(k.dropna()) >= 3 else None
        osc["williams_r"] = round(float(-100 * (aa.iloc[-1] - p) / (aa.iloc[-1] - bb.iloc[-1])), 1) if aa.iloc[-1] != bb.iloc[-1] else None
    if len(c) >= 20:
        tp = (alto + basso + c) / 3
        md = (tp - tp.rolling(20).mean()).abs().rolling(20).mean()
        cci = (tp - tp.rolling(20).mean()) / (0.015 * md.replace(0, float("nan")))
        osc["cci20"] = round(float(cci.iloc[-1]), 1) if cci.notna().iloc[-1] else None
    if len(c) >= 30:
        adx, dsu, dgiu = _adx(hist)
        if adx.notna().iloc[-1]:
            osc["adx14"] = round(float(adx.iloc[-1]), 1)
            osc["di_su"] = round(float(dsu.iloc[-1]), 1)
            osc["di_giu"] = round(float(dgiu.iloc[-1]), 1)
    if len(c) >= 11:
        osc["momentum10"] = round(float(p - c.iloc[-11]), 2)

    return {"prezzo": round(p, 2), "medie": medie, "medie_battute": sopra, "medie_totali": len(medie),
            "oscillatori": osc,
            "_come": "medie e oscillatori calcolati da noi sulla barra giornaliera Yahoo "
                     "(auto_adjust=True) con le formule standard: RSI e ADX di Wilder, MACD 12/26/9, "
                     "stocastico 14/3, CCI 20, Williams %R 14"}


def performance_orizzonti(hist, monthly=None):
    """I ritorni per orizzonte. ⚠ Da qui in avanti l'orizzonte oltre l'anno esce dalla serie
    MENSILE: chiedere 3 anni a una serie giornaliera di 252 barre darebbe il ritorno di un anno
    con l'etichetta di tre — un numero fuori orizzonte, peggio di nessun numero (v199)."""
    if hist is None or hist.empty:
        return None
    c = hist["Close"]
    p = float(c.iloc[-1])
    out, dispon = {}, len(c)
    for k, n in (("s1", 5), ("m1", 22), ("m3", 66), ("m6", 126), ("a1", 252)):
        if dispon > n:
            out[k] = round((p / float(c.iloc[-(n + 1)]) - 1) * 100, 2)
    try:  # da inizio anno: la prima seduta dell'anno solare, non 252 sedute fa
        anno = c[c.index.year == c.index[-1].year]
        if len(anno) >= 2:
            out["ytd"] = round((p / float(anno.iloc[0]) - 1) * 100, 2)
    except Exception:  # noqa: BLE001
        pass
    if monthly is not None and len(monthly) > 12:
        for k, m in (("a1", 12), ("a3", 36), ("a5", 60), ("a10", 120)):
            if k == "a1" and "a1" in out:
                continue
            if len(monthly) > m:
                out[k] = round((p / float(monthly.iloc[-(m + 1)]) - 1) * 100, 2)
    return out or None


def stagionalita_titolo(monthly, min_anni=8):
    """Stagionalita' del TITOLO, mese per mese, sul suo storico mensile.
    ⚠ Sotto `min_anni` osservazioni per mese non si pubblica niente: una 'media' su tre anni fra
    esiti opposti non e' una stagionalita', e' rumore con un'etichetta. Stessa disciplina gia'
    applicata alla stagionalita' del Nasdaq."""
    if monthly is None or len(monthly) < min_anni * 12:
        return None
    r = monthly.pct_change().dropna() * 100
    fuori = []
    for m in range(1, 13):
        v = r[r.index.month == m]
        if len(v) < min_anni:
            continue
        fuori.append({"mese": m, "media": round(float(v.mean()), 2), "mediana": round(float(v.median()), 2),
                      "positivi_pct": round(float((v > 0).mean() * 100)), "campione": int(len(v)),
                      "peggio": round(float(v.min()), 1), "meglio": round(float(v.max()), 1)})
    return fuori or None


def sensibilita_macro(closes, serie_bench):
    """IL PONTE MACRO -> TITOLO, MISURATO. Il CEO ha chiesto una sezione su come i dati macro
    incidono sul titolo. L'unica forma che non sia un oroscopo e' questa: la REGRESSIONE dei
    rendimenti giornalieri del titolo su quelli di uno strumento che rappresenta il canale.
    ⚠⚠ IL BETA SENZA R² E SENZA CAMPIONE E' UN NUMERO INVENTATO A META'. Un beta di 1,8 sui tassi
    con R² 0,02 significa 'nessuna relazione misurabile', e senza l'R² accanto verrebbe letto come
    'il titolo e' molto sensibile ai tassi'. Qui viaggiano sempre insieme, e la finestra e' comune
    per costruzione (si allineano le DATE, non le posizioni — lezione v207)."""
    import pandas as pd
    # ⚠⚠ v325 — QUESTA FUNZIONE PRENDEVA I RENDIMENTI E LI PRENDEVA NELL'UNITA' SBAGLIATA.
    # La pipeline le passava `daily_ret`, che sono log-rendimenti in FRAZIONE, mentre qui dentro
    # il benchmark veniva convertito in PERCENTUALE: il beta usciva diviso per cento. Su MU
    # contro il proprio settore dava 0,01 con correlazione 0,82 — un valore impossibile, perche'
    # con quella correlazione e volatilita' simili il beta deve stare intorno a 1.
    # ⚠ E l'ho scoperto solo dall'inventario di un agente: quando in v316 provai la funzione, le
    # passai io le percentuali e ottenni 1,46, cioe' il valore giusto. AVEVO PROVATO UNA STRADA
    # CHE LA PRODUZIONE NON PERCORRE — la stessa classe di v238 ("la sintassi valida non dice
    # niente sull'esecuzione") applicata alle unita' di misura.
    # Ora la funzione prende le CHIUSURE e si calcola i rendimenti da se': una convenzione sola,
    # dentro, dove il chiamante non puo' sbagliarla.
    if closes is None or len(closes) < 61:
        return None
    ret = closes.pct_change().dropna() * 100
    if len(ret) < 60:
        return None
    fuori = {}
    for nome, (sym, canale, s) in serie_bench.items():
        if s is None or len(s) < 60:
            continue
        rb = s.pct_change().dropna() * 100
        a, b = ret.align(rb, join="inner")     # finestra COMUNE per date, mai per posizione
        if len(a) < 60:
            continue
        var = float(b.var())
        if not var:
            continue
        beta = float(a.cov(b) / var)
        corr = float(a.corr(b))
        fuori[nome] = {"strumento": sym, "canale": canale, "beta": round(beta, 2),
                       "r2": round(corr * corr, 3), "corr": round(corr, 2),
                       "campione": int(len(a)), "da": str(a.index[0].date()), "a": str(a.index[-1].date())}
    return fuori or None


# I canali si scaricano UNA VOLTA per run, non una volta per titolo: 23 titoli x 4 canali
# sarebbero 92 chiamate per un dato che e' lo stesso per tutti.
_CANALI = {}


def canali_macro():
    """Gli strumenti che rappresentano i canali di trasmissione. Sono ETF QUOTATI, non serie
    statistiche: hanno la stessa barra giornaliera dei titoli, quindi la finestra comune esiste
    per costruzione. Un canale 'tassi' preso da FRED avrebbe frequenza e calendario diversi — e
    confrontare due serie senza giorni in comune e' il difetto che v207 ha gia' pagato."""
    if _CANALI:
        return _CANALI
    for nome, sym, canale in (
        ("mercato", "QQQ", "il mercato: quanta parte del movimento e' semplicemente indice"),
        ("settore", "SOXX", "il comparto: quanto e' scommessa sul settore invece che sulla societa'"),
        ("tassi", "TLT", "i tassi a lunga (TLT sale quando il rendimento scende): il costo del capitale"),
        ("dollaro", "UUP", "il dollaro: ricavi esteri e costi in valuta"),
    ):
        _CANALI[nome] = (sym, canale, bench_close(sym, period="1y"))
    return _CANALI


def drop_void_bars(hist):
    """Barre senza Close via. Yahoo può appendere la barra ODIERNA con Close=NaN e volume
    valorizzato (visto sul campo, lug 2026: ^KS11 dopo la chiusura coreana) → il prezzo
    diventava null in dashboard e prompt, accecando la lettura leading del KOSPI richiesta
    dalla testata. Una barra senza chiusura non è una barra: il prezzo resta l'ultima
    chiusura valida (semantica documentata: "price = ULTIMA CHIUSURA REGOLARE").
    v115 — via anche le BARRE-GLITCH (protezione supporti/ATR/minimi fantasma):
    Close/Low ≤ 0, High < Low, o Low sotto il 50% del corpo (min(Open, Close)) — la firma
    del bad tick: una scrollata VERA chiude vicino al minimo e NON viene toccata, un
    minimo fantasma a -70% intrabar con chiusura regolare sì. Prezzi/volumi negativi
    non esistono in borsa: qui c'è il blocco fisico a monte di tutti i calcoli."""
    if hist.empty:
        return hist
    m = hist["Close"].notna() & (hist["Close"] > 0)
    if all(c in hist.columns for c in ("Open", "High", "Low")):
        body_min = hist[["Open", "Close"]].min(axis=1)
        m &= hist["Low"].notna() & (hist["Low"] > 0) & (hist["High"] >= hist["Low"]) \
             & (hist["Low"] >= body_min * 0.5)
    return hist[m]


# Strumenti che CONTRATTANO quando Wall Street dorme: la loro ultima candela GIORNALIERA è
# stantia mentre il mercato è vivo (v125). Per questi il prezzo mostrato = ULTIMO SCAMBIO LIVE
# (fast_info.last_price), non la chiusura: KOSPI in crollo asiatico, BTC 24/7, futures 24/5.
LIVE_FOREIGN_INDICES = {"^KS11", "^KS200", "^N225", "^HSI", "^HSCE", "^TWII", "^STOXX50E",
                        "^FTSE", "^GDAXI", "^FCHI", "^AXJO", "^BSESN", "000001.SS"}
def is_live_market(ticker):
    """True per cripto (-USD), futures (=F) e indici esteri che scambiano fuori dall'orario USA."""
    tk = (ticker or "").upper()
    return tk.endswith("-USD") or tk.endswith("=F") or tk in LIVE_FOREIGN_INDICES


def live_last_price(t):
    """Ultimo prezzo di scambio LIVE via fast_info (real-time, non l'ultima candela chiusa).
    None se non disponibile/degenere — il chiamante ricade sulla chiusura."""
    try:
        lp = float(t.fast_info.last_price)
        return lp if _finite_pos(lp) else None
    except Exception:  # noqa: BLE001
        return None


def buyback_yield_frac(repurchase, issuance, mcap):
    """Buyback yield NETTO delle emissioni = (riacquisti − emissioni) / market cap, frazione.
    Nel cashflow yfinance 'Repurchase Of Capital Stock' è NEGATIVO (uscita di cassa) e
    l'issuance è positiva (entrata): net = (−repurchase − issuance). Metrica discriminante
    growth: >0 restituisce capitale riducendo le azioni, <0 DILUISCE (tipico SBC-heavy).
    Cap plausibilità ±25% (oltre = unità sporche → None). None se mcap assente."""
    if not mcap or mcap <= 0:
        return None
    rep = -float(repurchase) if repurchase is not None else 0.0    # riacquisti come positivo
    iss = float(issuance) if issuance is not None else 0.0
    if repurchase is None and issuance is None:
        return None
    y = (rep - iss) / float(mcap)
    return round(y, 4) if abs(y) <= 0.25 else None


def _live_is_informative(lp, last_close):
    """FIX FALSO-LIVE (v137, visto sul KOSPI): a mercato ESTERO CHIUSO fast_info resta congelato
    sull'ultimo scambio = la chiusura stessa. Attivare l'override in quel caso non aggiunge
    informazione ma ARRETRA il riferimento (prev = chiusura precedente) → il prompt mostrava
    la variazione della seduta GIÀ CHIUSA con l'etichetta [LIVE], come fosse in corso adesso
    (KOSPI -6,37% ripetuto identico su 3 run serali). Live "informativo" = scambio DIVERSO
    dalla chiusura più recente; identico → si resta sulla candela con [chiusura del DD/MM]."""
    return lp is not None and last_close and abs(lp / last_close - 1) >= 1e-6


# ═══ v367 — CREDITO E FLUSSO FUORI MERCATO ═══════════════════════════════════════════════
# Il CEO ha chiesto i CDS sul debito che le societa' accendono per investire, e i movimenti nei
# dark pool. Verificato con le fonti in mano, non a opinione:
#   · CDS single-name: Markit/ICE, A PAGAMENTO. TRACE (obbligazioni societarie) risponde 401
#     senza credenziali. Non c'e' modo gratuito di avere uno spread CDS, e inventarne un proxy
#     travestito da quotazione sarebbe peggio di non averlo.
#     Quello che si puo' avere sono i FATTI CHE IL CDS PREZZA, e sono tutti in bilancio.
#   · Dark pool: FINRA pubblica ATS e OTC non-ATS per simbolo, settimanali, GRATIS e senza
#     autenticazione. Piu' il volume short giornaliero, sempre gratis.

_SHORT_CACHE = {}          # {data: {ticker: (short, totale)}} — scaricato una volta per run


def _finra_short_giorno(giorno):
    """Volume short di TUTTI i titoli per una giornata. Il file FINRA e' unico per data:
    scaricarlo una volta e filtrarlo costa una richiesta invece di una per titolo."""
    if giorno in _SHORT_CACHE:
        return _SHORT_CACHE[giorno]
    url = f"https://cdn.finra.org/equity/regsho/daily/CNMSshvol{giorno}.txt"
    fuori = {}
    try:
        r = requests.get(url, timeout=20)
        if r.status_code == 200 and "Symbol" in r.text[:200]:
            for riga in r.text.splitlines()[1:]:
                p = riga.split("|")
                if len(p) < 5:
                    continue
                try:
                    fuori[p[1]] = (float(p[2]), float(p[4]))
                except ValueError:
                    continue
    except Exception:
        pass
    _SHORT_CACHE[giorno] = fuori
    return fuori


def short_volume(ticker, giorni=8):
    """Quota di volume venduta allo scoperto negli ultimi giorni di contrattazione.
    ⚠ NON e' lo short interest: quello e' la posizione aperta, questo e' il FLUSSO di una
    giornata, e comprende il market making. Una quota alta non vuol dire "molti ribassisti"."""
    oggi = datetime.now(timezone.utc).date()
    serie = []
    for d in range(1, giorni + 3):
        g = oggi - timedelta(days=d)
        if g.weekday() >= 5:
            continue
        dati = _finra_short_giorno(g.strftime("%Y%m%d")).get(ticker)
        if dati and dati[1] > 0:
            serie.append({"d": g.isoformat(), "pct": round(dati[0] / dati[1] * 100, 1)})
        if len(serie) >= giorni:
            break
    if not serie:
        return None
    serie.reverse()
    return {"serie": serie, "ultimo_pct": serie[-1]["pct"],
            "media_pct": round(sum(x["pct"] for x in serie) / len(serie), 1)}


def fuori_mercato(ticker, settimane=6):
    """Azioni scambiate FUORI dai mercati regolamentati, da FINRA, per settimana.
    ⚠⚠ DUE COSE DIVERSE, e confonderle e' l'errore classico su questo dato:
      · ATS = i dark pool veri (sedi alternative registrate);
      · OTC non-ATS = internalizzatori e wholesaler, cioe' dove finisce gran parte del flusso
        AL DETTAGLIO. Una quota alta qui NON e' accumulazione istituzionale: spesso e' il
        contrario. Vanno tenute separate, e il pacchetto lo dice."""
    fine = datetime.now(timezone.utc).date()
    inizio = fine - timedelta(weeks=settimane + 4)   # la pubblicazione ha ~3 settimane di ritardo
    corpo = {"limit": 400,
             "compareFilters": [{"fieldName": "issueSymbolIdentifier", "fieldValue": ticker, "compareType": "equal"}],
             "dateRangeFilters": [{"fieldName": "weekStartDate",
                                   "startDate": inizio.isoformat(), "endDate": fine.isoformat()}]}
    try:
        r = requests.post("https://api.finra.org/data/group/otcMarket/name/weeklySummary",
                          json=corpo, timeout=25)
        if r.status_code != 200 or not r.text.strip():
            return None
        righe = list(csv.DictReader(io.StringIO(r.text)))
    except Exception:
        return None
    # i totali per simbolo sono le righe _SMBL; le _SMBL_FIRM sono lo stesso totale spezzato per sede
    agg = {}
    for x in righe:
        tipo = x.get("summaryTypeCode") or ""
        if not tipo.endswith("_SMBL"):
            continue
        sett = x.get("weekStartDate")
        try:
            q = float(x.get("totalWeeklyShareQuantity") or 0)
        except ValueError:
            continue
        d = agg.setdefault(sett, {"ats": 0.0, "otc": 0.0})
        if tipo.startswith("ATS"):
            d["ats"] += q
        elif tipo.startswith("OTC"):
            d["otc"] += q
    if not agg:
        return None
    sett = sorted(agg)[-settimane:]
    fuori = []
    for w in sett:
        ats, otc = round(agg[w]["ats"]), round(agg[w]["otc"])
        riga = {"w": w, "ats": ats, "otc": otc}
        if (ats > 0) != (otc > 0):
            riga["incompleta"] = True     # una delle due meta' non e' stata pubblicata
        fuori.append(riga)
    piene = [x for x in fuori if not x.get("incompleta")]
    return {"settimane": fuori, "ultima": (piene[-1]["w"] if piene else sett[-1]),
            "incomplete": sum(1 for x in fuori if x.get("incompleta"))}


def credito(t):
    """⚠⚠ AL POSTO DEL CDS, I FATTI CHE IL CDS PREZZA.
    Su CoreWeave questi numeri dicono piu' di qualunque spread: oneri finanziari per trimestre
    267 -> 311 -> 388 -> 536 milioni, cioe' RADDOPPIATI in un anno e 1,5 miliardi su dodici mesi,
    contro un EBIT di -101 milioni. La gestione operativa non copre NESSUNA parte degli interessi,
    e il costo del debito accelera mentre il debito serve a costruire.
    Nessun modello: sono righe di conto economico e di stato patrimoniale."""
    out = {}
    try:
        inc = t.quarterly_income_stmt
    except Exception:
        inc = None
    try:
        bs = t.quarterly_balance_sheet
    except Exception:
        bs = None
    oneri, n_on, data_ce = _somma_trimestri(inc, "Interest Expense")
    ebit, n_eb, _ = _somma_trimestri(inc, "EBIT")
    if ebit is None:
        ebit, n_eb, _ = _somma_trimestri(inc, "Operating Income")
    if oneri is None and ebit is None:
        return None
    out["oneri_ttm"] = oneri
    out["ebit_ttm"] = ebit
    out["trimestri"] = min(n_on, n_eb) if (n_on and n_eb) else (n_on or n_eb)
    out["conto_al"] = data_ce
    if oneri and oneri > 0 and ebit is not None:
        out["copertura"] = round(ebit / oneri, 2)     # <1 = non copre, <0 = non copre nulla
    # il VERSO degli oneri: un costo del debito che accelera e' un fatto diverso dal suo livello
    if inc is not None and getattr(inc, "empty", True) is False and "Interest Expense" in inc.index:
        try:
            s = inc.loc["Interest Expense"].dropna()
            if len(s) >= 4:
                rec, vec = float(s.iloc[0]), float(s.iloc[3])
                if vec > 0:
                    out["oneri_var_4trim_pct"] = round((rec / vec - 1) * 100, 1)
                out["oneri_trim"] = [round(float(x)) for x in s.iloc[:4]][::-1]
        except Exception:
            pass
    corr, _ = _riga_bilancio(bs, "Current Debt")
    lungo, _ = _riga_bilancio(bs, "Long Term Debt")
    if corr is not None:
        out["debito_corrente"] = corr
    if lungo is not None:
        out["debito_lungo"] = lungo
    return {k: v for k, v in out.items() if v is not None}


def _riga_bilancio(df, *voci):
    """Prima voce presente nel DataFrame, colonna piu' recente. None se manca o e' NaN."""
    if df is None or getattr(df, "empty", True):
        return None, None
    for v in voci:
        if v in df.index:
            try:
                x = df.loc[v].iloc[0]
            except Exception:
                continue
            if x is None or x != x:      # NaN
                continue
            return float(x), str(df.columns[0])[:10]
    return None, None


def _somma_trimestri(df, voce, n=4):
    """Somma degli ultimi n trimestri di una voce. Torna anche QUANTI ne ha davvero sommati:
    un TTM costruito su tre trimestri non e' un TTM, e chi legge deve saperlo."""
    if df is None or getattr(df, "empty", True) or voce not in df.index:
        return None, 0, None
    try:
        serie = df.loc[voce].dropna()
    except Exception:
        return None, 0, None
    if len(serie) == 0:
        return None, 0, None
    usati = serie.iloc[:n]
    return float(usati.sum()), len(usati), str(df.columns[0])[:10]


def combustione(t, mcap, buyback):
    """⚠⚠ IL RIQUADRO DELLA COMBUSTIONE — chiesto per un libro growth con nomi in perdita, dove
    conta piu' del P/E. Cassa, debito, flusso operativo, capex: da yfinance, GRATIS.

    ⚠ E' nato perche' stavo per derivare la cassa da una catena di rapporti — enterprise_value
    meno market_cap, debito da debtToEquity x patrimonio, patrimonio da market_cap/priceToBook.
    Su CRWV quella catena dava cassa 5,6 mld e debito 51,7 mld. Il bilancio vero dice 2,24 e
    35,1: sbagliata di 2,5 volte sulla cassa. Tre rapporti moltiplicati moltiplicano l'errore,
    e il bilancio diretto costa una chiamata in piu'. Non si deriva cio' che si puo' leggere.

    ⚠ E ribalta la lettura: su CRWV il flusso OPERATIVO e' positivo (~6 mld TTM) e l'FCF
    negativo e' TUTTO capex. "Quanto sopravvive" e' la domanda sbagliata per chi costruisce:
    quella giusta e' come finanzia la costruzione e cosa succede se il mercato dei capitali
    chiude. Per questo il blocco porta i pezzi separati, e non un solo numero di "autonomia"."""
    out = {}
    try:
        bs = t.quarterly_balance_sheet
    except Exception:
        bs = None
    try:
        cf = t.quarterly_cashflow
    except Exception:
        cf = None

    cassa, d1 = _riga_bilancio(bs, "Cash And Cash Equivalents",
                               "Cash Cash Equivalents And Short Term Investments")
    debito, _ = _riga_bilancio(bs, "Total Debt")
    patrim, _ = _riga_bilancio(bs, "Stockholders Equity")
    ocf, n_ocf, d2 = _somma_trimestri(cf, "Operating Cash Flow")
    capex, n_cap, _ = _somma_trimestri(cf, "Capital Expenditure")

    if cassa is None and ocf is None:
        return None                      # niente da dire: meglio assente che vuoto

    out["cassa"] = cassa
    out["debito"] = debito
    out["patrimonio"] = patrim
    out["bilancio_al"] = d1
    out["ocf_ttm"] = ocf
    out["capex_ttm"] = capex
    out["trimestri"] = min(n_ocf, n_cap) if (n_ocf and n_cap) else (n_ocf or n_cap)
    out["cashflow_al"] = d2
    if ocf is not None and capex is not None:
        out["fcf_ttm"] = ocf + capex     # capex e' gia' negativo in yfinance
    # quanti mesi di COSTRUZIONE copre la cassa da sola, al ritmo attuale
    if cassa is not None and capex is not None and capex < 0:
        out["mesi_capex"] = round(cassa / (abs(capex) / 12.0), 1)
    # quanti mesi di PERDITA di cassa copre, se il flusso operativo e' negativo
    if cassa is not None and ocf is not None and ocf < 0:
        out["mesi_operativi"] = round(cassa / (abs(ocf) / 12.0), 1)
    # emissione netta di azioni: buyback_yield negativo = diluizione
    if buyback is not None and buyback < 0:
        out["emissione_netta_pct"] = round(abs(buyback) * 100, 2)
    if debito is not None and cassa is not None:
        out["debito_netto"] = debito - cassa
    return {k: v for k, v in out.items() if v is not None}


def riga_precedente(ticker):
    """La riga dello STESSO titolo nello snapshot del run precedente, ovunque stia.
    Cerca in entrambe le liste perche' un titolo puo' passare da watchlist a portafoglio fra
    due run: agganciarsi alla lista invece che al ticker perderebbe il confronto proprio
    quando la posizione viene aperta."""
    for lista in ("portfolio", "watchlist"):
        for r in (PREV_DATA.get(lista) or []):
            if r.get("ticker") == ticker:
                return r
    return None


MIN_STORIA_RISERVA = 200   # sotto questo, la riserva costerebbe SMA200 e i massimi a 52 settimane


def ultima_seduta(hist):
    """La data dell'ultima barra di uno storico, o None se l'indice non e' di date."""
    try:
        return str(hist.index[-1].date())
    except Exception:  # noqa: BLE001
        return None


def seduta_gia_pubblicata(ticker):
    """La seduta piu' RECENTE gia' pubblicata per questo titolo dai run precedenti.

    ⚠ Tiene memoria anche del flag di arretramento: guardando solo `price_asof` del run
    precedente, al secondo run arretrato di fila il riferimento sarebbe gia' la data vecchia e
    il confronto tornerebbe muto proprio mentre il sistema e' ancora indietro. Il 29/08/2026 la
    regressione e' durata almeno quattro run."""
    prec = riga_precedente(ticker) or {}
    viste = [str(x) for x in (prec.get("price_asof"), prec.get("price_asof_arretrata_da")) if x]
    return max(viste) if viste else None


def recupera_seduta_persa(ticker, hist, price_src):
    """Yahoo ha lo storico ma NON l'ultima seduta gia' pubblicata: prova la fonte di riserva.

    ⚠⚠ NASCE DAL 29/08/2026, ed e' il seguito di v383. Yahoo ha servito la barra di venerdi'
    senza Close, drop_void_bars l'ha scartata (correttamente) e il prezzo e' ricaduto su
    giovedi': 22 strumenti su 24 tornati indietro di una seduta, per almeno quattro run.
    La ridondanza sui prezzi ESISTEVA GIA' — backup_daily, catena Stooq → Tiingo — ma era
    agganciata al solo caso `hist.empty`, cioe' Yahoo che non risponde affatto. Il caso reale
    non e' quello: Yahoo risponde, con un anno di barre, e ne manca UNA — l'ultima, che e'
    l'unica che conta per il prezzo. Il piano B c'era e non poteva scattare.

    ⚠ SI SOSTITUISCE TUTTO LO STORICO, non il solo prezzo. Innestare la chiusura di venerdi' su
    tecnica, ATR, medie e sparkline calcolate SENZA quella barra darebbe una riga a DUE ETA':
    la classe di incoerenza per cui esiste coherence_check, e la ragione per cui v383 aveva
    scelto di dichiarare invece di rattoppare. O la riga viene da una fonte sola, o non si tocca.

    ⚠ E NON SI BARATTA LA STORIA PER UNA SEDUTA: sotto MIN_STORIA_RISERVA barre si terrebbe un
    giorno in piu' perdendo SMA200, massimo a 52 settimane e drawdown. In quel caso si tiene
    Yahoo e la regressione resta DICHIARATA da v383 — che e' il comportamento peggiore
    accettabile, non un fallimento silenzioso."""
    attesa = seduta_gia_pubblicata(ticker)
    adesso = ultima_seduta(hist)
    if not (attesa and adesso and attesa > adesso):
        return hist, price_src                       # niente da recuperare: la strada normale
    bk = backup_daily(ticker)
    if bk is None:
        print(f"·· {ticker}: seduta {attesa} persa da Yahoo, la fonte di riserva non risponde",
              file=sys.stderr)
        return hist, price_src
    alt = drop_void_bars(bk[0])
    alt_seduta = ultima_seduta(alt)
    if len(alt) < MIN_STORIA_RISERVA:
        print(f"·· {ticker}: {bk[1]} avrebbe la seduta ma solo {len(alt)} barre "
              f"(<{MIN_STORIA_RISERVA}): tengo Yahoo, non baratto SMA200 per un giorno",
              file=sys.stderr)
        return hist, price_src
    if not (alt_seduta and alt_seduta > adesso):
        print(f"·· {ticker}: anche {bk[1]} si ferma a {alt_seduta}: la seduta {attesa} non e' "
              f"recuperabile in questo run", file=sys.stderr)
        return hist, price_src
    print(f"·· {ticker}: Yahoo fermo a {adesso} contro {attesa} gia' pubblicata → SEDUTA "
          f"RECUPERATA da {bk[1]} ({alt_seduta}, {len(alt)} barre)", file=sys.stderr)
    return alt, bk[1]


def seduta_arretrata(ticker, price_asof):
    """La seduta pubblicata ORA e' PIU' VECCHIA di quella gia' a disco? Ritorna quella vecchia.

    ⚠⚠ SUCCESSO DAVVERO, ED E' PASSATO INOSSERVATO PER ORE. Il 29/08/2026 i run delle 10:51 e
    11:24 hanno ripubblicato la seduta del 27 dopo che quattro run consecutivi avevano il 28:
    Yahoo ha servito la barra di venerdi' senza Close e `drop_void_bars` l'ha scartata — cioe'
    la pipeline ha fatto la cosa GIUSTA, ma il risultato e' che 22 strumenti su 24 sono tornati
    indietro di una seduta. MRVL da 216,62 (-10,3% sulla trimestrale) e' risalito a 241,45, il
    SOX ha recuperato il 3,6% mai avvenuto, e `macro.momentum.sp500.asof` e' passato da
    2026-08-28 a 2026-08-27. Dashboard e rapporto mostravano giovedi' credendolo l'ultimo dato.

    ⚠ QUI NON SI RATTOPPA IL PREZZO, e la scelta e' deliberata. Riportare avanti la chiusura di
    venerdi' su una riga la cui tecnica (ATR, medie, RSI, sparkline) e' calcolata SENZA quella
    barra produrrebbe una riga a due eta': esattamente la classe di incoerenza per cui esiste
    coherence_check, e il difetto che il gate valuta ha gia' pagato in v183. Il dato fetchato e'
    internamente coerente — e' solo VECCHIO. Si dichiara, e chi legge decide.

    ⚠ L'ALLARME DEVE RESTARE ACCESO, non suonare una volta sola. Se guardasse solo il
    `price_asof` del run precedente, al secondo run consecutivo arretrato quel campo porterebbe
    gia' la data vecchia e il confronto tornerebbe silenzioso — proprio mentre il sistema e'
    ancora indietro. Il 29/08/2026 la regressione e' durata almeno QUATTRO run (10:51, 11:24,
    13:40, 14:06): un allarme che suona sulla sola transizione non l'avrebbe raccontata.
    Percio' si guarda la seduta piu' RECENTE mai pubblicata per questo titolo, tenendo memoria
    anche del flag precedente."""
    massima = seduta_gia_pubblicata(ticker)
    return massima if (price_asof and massima and massima > str(price_asof)) else None


def fetch_symbol(ticker, name=None, currency="USD"):
    """Quote + dati tecnici + rating + trimestrale + sparkline per un titolo."""
    ticker = TICKER_ALIAS.get(ticker.strip().upper(), ticker.strip())
    t = yf.Ticker(ticker)
    price_src = "yahoo"
    hist = drop_void_bars(t.history(period="1y", interval="1d", auto_adjust=True))
    # ⚠ la riserva vale solo per le azioni USD: indici, futures e cripto hanno una simbologia
    #   diversa su Stooq e chiederli li' produrrebbe il titolo sbagliato, non un buco.
    riserva_possibile = currency == "USD" and not re.search(r"[\^=]|-", ticker)
    if hist.empty and riserva_possibile:
        bk = backup_daily(ticker)
        if bk is not None and len(bk[0]) >= 30:
            hist, price_src = drop_void_bars(bk[0]), bk[1]
            print(f"·· prezzi {ticker} da {price_src} (fallback: Yahoo senza storico)", file=sys.stderr)
    elif riserva_possibile:
        # ⚠⚠ IL CASO CHE MANCAVA (v384): Yahoo risponde, con un anno di barre, e ne manca UNA —
        #    l'ultima. Per un anno il piano B e' esistito senza poter scattare proprio qui.
        hist, price_src = recupera_seduta_persa(ticker, hist, price_src)
    if hist.empty:
        print(f"!! nessuno storico per {ticker}", file=sys.stderr)
        return None
    closes = hist["Close"]
    # ISOLAMENTO SESSIONI: price = ULTIMA CHIUSURA REGOLARE (Adj Close, auto_adjust=True).
    # I prezzi extended-hours (preMarketPrice/postMarketPrice) vivono SOLO in "prepost" e in
    # prezzo_limite_aggiustato: MAI dentro metriche statiche (returns, ATR, mcap, covarianze).
    price = float(closes.iloc[-1])
    prev = float(closes.iloc[-2]) if len(closes) > 1 else price
    # DATA dell'ultima chiusura valida: se Yahoo ha voidato la barra odierna (drop_void_bars,
    # visto su ^KS11) il prezzo è quello del giorno PRIMA — il prompt lo deve dichiarare
    # ("[chiusura del DD/MM]") o l'LLM legge un movimento vecchio come se fosse di oggi.
    try:
        price_asof = str(closes.index[-1].date())
    except Exception:  # noqa: BLE001 — indice non-datetime (backup esotici): meglio niente che sbagliato
        price_asof = None

    # LIVE OVERRIDE v125 (punto cieco 72h): per gli strumenti che scambiano mentre Wall Street
    # è chiusa (KOSPI, BTC, futures) il prezzo mostrato è l'ULTIMO SCAMBIO LIVE, non la candela
    # giornaliera stantia. La chiusura più recente diventa il RIFERIMENTO per la variazione
    # (così il crollo asiatico -8,9% appare come tale). Le metriche statiche (ATR/returns/SMA)
    # restano sulla serie giornaliera: solo il prezzo/variazione mostrati diventano live.
    price_live = False
    if is_live_market(ticker):
        lp = live_last_price(t)
        # guardia anti-glitch (<50% dalla chiusura) + guardia anti-FALSO-LIVE (v137): un last_price
        # IDENTICO alla chiusura = mercato chiuso/feed congelato → niente override, resta la candela
        if lp is not None and abs(lp / price - 1) < 0.5 and _live_is_informative(lp, price):
            prev = price       # la chiusura più recente è il riferimento della variazione live
            price = lp
            price_asof = None   # non è una chiusura: è live
            price_live = True

    # ⚠⚠ Guardia di REGRESSIONE DI SEDUTA (v383) — vedi seduta_arretrata(). Sta QUI, dopo il
    #   live override: prima, price_asof puo' ancora essere azzerato e il confronto sarebbe
    #   fatto su una data che poi non viene pubblicata.
    arretrata_da = seduta_arretrata(ticker, price_asof)
    if arretrata_da:
        print(f"·· {ticker}: SEDUTA ARRETRATA — pubblico {price_asof}, il run precedente aveva "
              f"{arretrata_da} (barra piu' recente assente o senza chiusura)", file=sys.stderr)

    monthly = None
    try:
        mh = t.history(period="max", interval="1mo")
        ath = float(mh["High"].max())
        monthly = mh["Close"].dropna()
    except Exception:  # noqa: BLE001
        ath = float(hist["High"].max())

    # t.info fa una chiamata quoteSummary che dà 404 (rumoroso) su indici/cripto/commodity/ETF:
    # per questi NON serve (prezzo/tecnica vengono dallo storico, il nome dal config) → skip.
    info = {}
    if has_fundamentals(ticker, currency):
        try:
            info = t.info or {}
        except Exception:  # noqa: BLE001
            info = {}
    pe = sane_val(info.get("trailingPE") or info.get("forwardPE"), 0.1, 3000, f"{ticker} P/E")

    sma50 = float(closes.rolling(50).mean().iloc[-1]) if len(closes) >= 50 else None
    sma200 = float(closes.rolling(200).mean().iloc[-1]) if len(closes) >= 200 else None
    rsi = rsi14(closes)
    sig, sig_class = signal_label(price, sma50, sma200, rsi)

    # Rendimenti LOGARITMICI giornalieri (12 mesi): base unica di Sharpe, volatilità, beta
    # e correlazioni. I log-return sono additivi nel tempo e non sovrastimano il rendimento
    # composto come la media aritmetica dei rendimenti semplici (bias ~ +sigma^2/2 sui titoli volatili).
    daily_ret = np.log(closes / closes.shift(1)).replace([np.inf, -np.inf], np.nan).dropna()
    sharpe_1y, sortino_1y = risk_ratios(daily_ret)
    # Finestra 6M (~126 sedute): metrica di REGIME per lo score dei RIABILITATI growth —
    # dopo un crash la finestra 12M resta contaminata dal drawdown per mesi e schiaccia
    # lo score di titoli già in recupero; il 6M misura il regime corrente. Il VETO resta sul 12M.
    sharpe_6m, sortino_6m = risk_ratios(daily_ret.tail(126))

    vol = float(hist["Volume"].iloc[-1])
    # RVol (volume relativo) su base FULL-DAY: se l'ultimo bar è di OGGI e la sessione USA è ancora
    # in corso (prima delle ~21 UTC) è PARZIALE → confrontarlo con la media giornaliera darebbe
    # sempre <1 e il flag [Volumi Anomali] non scatterebbe MAI. Uso allora l'ultima seduta COMPLETA.
    # vol==0 (tipico degli indici ^ senza volume) → RVol n.d., non 0.
    _vols = hist["Volume"].dropna()
    _now = datetime.now(timezone.utc)
    _partial = len(_vols) > 0 and _vols.index[-1].date() == _now.date() and _now.hour < 21
    _ri = -2 if (_partial and len(_vols) >= 32) else -1
    _vol_rv = float(_vols.iloc[_ri]) if len(_vols) >= abs(_ri) else 0.0
    _win = _vols.iloc[_ri - 30:_ri] if len(_vols) >= abs(_ri) + 30 else _vols.tail(30)
    vol_avg30 = float(_win.mean()) if len(_win) else 0.0
    vol_ratio = round(_vol_rv / vol_avg30, 2) if (vol_avg30 and _vol_rv > 0) else None

    # ATR(14) — Average True Range con smoothing di Wilder (EWMA alpha=1/14).
    # È la base degli stop loss dinamici del motore (2×ATR): assorbe la volatilità
    # fisiologica del titolo invece di usare percentuali fisse.
    atr_14 = None
    try:
        tr = pd.concat([
            hist["High"] - hist["Low"],
            (hist["High"] - hist["Close"].shift(1)).abs(),
            (hist["Low"] - hist["Close"].shift(1)).abs(),
        ], axis=1).max(axis=1).dropna()
        if len(tr) >= 15:
            atr_14 = float(tr.ewm(alpha=1 / 14, adjust=False).mean().iloc[-1])
    except Exception as e:  # noqa: BLE001
        print(f"!! ATR {ticker}: {e}", file=sys.stderr)

    # sparkline su più orizzonti: 1g (5m), 1 settimana, 1 mese, 3 mesi, 6 mesi, 1 anno, all
    sparks = {
        "w1": [round(float(c), 2) for c in closes.tail(5)],
        "m6": [round(float(c), 2) for c in closes.tail(126)],
        "all": [round(float(c), 2) for c in monthly] if monthly is not None and len(monthly) > 2 else [round(float(c), 2) for c in closes[::5]],
        "m1": [round(float(c), 2) for c in closes.tail(22)],
        "m3": [round(float(c), 2) for c in closes.tail(66)],
        "y1": [round(float(c), 2) for c in closes[::5]],
        "d1": [],
    }
    try:
        h1 = t.history(period="1d", interval="5m")["Close"].dropna()
        if len(h1) >= 2:
            sparks["d1"] = [round(float(c), 2) for c in h1[::2]]
    except Exception:  # noqa: BLE001
        pass

    # supporto/resistenza/performance per orizzonte (cambiano col range scelto)
    def tech_window(n):
        h = hist.tail(n)
        if h.empty:
            return None
        c0 = float(h["Close"].iloc[0]); c1 = float(h["Close"].iloc[-1])
        return {"support": round(float(h["Low"].min()), 2),
                "resistance": round(float(h["High"].max()), 2),
                "change_pct": round((c1 / c0 - 1) * 100, 2) if c0 else None}
    tech_by_range = {k: tech_window(n) for k, n in
                     (("w1", 5), ("m1", 22), ("m3", 66), ("y1", 252))}

    # prossima trimestrale (t.calendar = altra chiamata quoteSummary → skip su indici/cripto/ETF)
    earnings_date = None
    if has_fundamentals(ticker, currency):
        try:
            dates = (t.calendar or {}).get("Earnings Date") or []
            today = datetime.now(timezone.utc).date()
            future = [d for d in dates if d >= today]
            if future:
                earnings_date = min(future).isoformat()
        except Exception:  # noqa: BLE001
            pass

    # rating analisti e target price
    rating = None
    key = info.get("recommendationKey")
    tgt = info.get("targetMeanPrice")
    if key and key != "none":
        rating = {
            "key": key,
            "n": info.get("numberOfAnalystOpinions"),
            "target": round(float(tgt), 2) if tgt else None,
            "upside_pct": round((float(tgt) / price - 1) * 100, 1) if tgt else None,
        }

    # ⚠⚠ v361 — TRE COSE DICHIARATE "TETTO STRUTTURALE" CHE ERANO GRATIS.
    # Tre revisori indipendenti hanno indicato revisioni degli utili, dispersione del consenso e
    # dispersione dei target come i buchi che piu' pesano su un mandato di crescita, e io avevo
    # risposto al CEO che erano un tetto strutturale: "richiedono una fonte dati che il sistema
    # non ha". Era falso. yfinance 1.3.0 — la libreria che questa pipeline usa gia' per tutto il
    # resto — le espone tutte e tre, dallo stesso endpoint, senza chiave e senza costo.
    # Non le ho cercate: le ho dichiarate impossibili.
    # ⚠ LA LEZIONE E' QUELLA DI TUTTA LA GIORNATA: "il sistema non ce l'ha" e' un'affermazione
    # che va VERIFICATA come qualsiasi numero. L'inventario dichiarato falso costa quanto un
    # dato sbagliato — e stavolta l'ho scritto io.
    # PERCHE' CONTANO, in ordine:
    # · le REVISIONI battono il target: il target e' vecchio quanto il suo ultimo aggiornamento,
    #   la revisione dice cosa sta cambiando adesso. Su NVDA la stima FY+1 e' passata da 12,59 a
    #   13,04 in novanta giorni, con 4 analisti al rialzo e 0 al ribasso.
    # · la DISPERSIONE dice se stanno valutando la stessa azienda: consenso 13,04 con forbice
    #   9,65-16,97 non e' un consenso, e' una media fra due tesi opposte.
    # · il MINIMO dei target su NVDA e' 180 contro un prezzo di 209: la media di 304 lo nasconde,
    #   ed e' il numero che dice quanto e' distante chi la pensa peggio.
    analisti = None
    try:
        def _riga(df, per):
            if df is None or getattr(df, "empty", True) or per not in df.index:
                return None
            return df.loc[per]

        def _n(x):
            try:
                v = float(x)
                return None if v != v else v
            except (TypeError, ValueError):
                return None

        tr = _riga(t.eps_trend, "+1y")
        rv = _riga(t.eps_revisions, "+1y")
        es = _riga(t.earnings_estimate, "+1y")
        pt = t.analyst_price_targets or {}
        ora = _n(tr["current"]) if tr is not None else None
        g90 = _n(tr["90daysAgo"]) if tr is not None else None
        g7 = _n(tr["7daysAgo"]) if tr is not None else None
        analisti = {
            # la TRAIETTORIA della stima sull'esercizio prossimo: e' la revisione
            "eps_ora": round(ora, 4) if ora else None,
            "eps_90g_fa": round(g90, 4) if g90 else None,
            "revisione_90g_pct": round((ora / g90 - 1) * 100, 2) if (ora and g90) else None,
            "revisione_7g_pct": round((ora / g7 - 1) * 100, 2) if (ora and g7) else None,
            # AMPIEZZA: quanti hanno alzato e quanti abbassato. Il verso conta piu' del numero.
            "su_30g": int(rv["upLast30days"]) if (rv is not None and _n(rv["upLast30days"]) is not None) else None,
            "giu_30g": int(rv["downLast30days"]) if (rv is not None and _n(rv["downLast30days"]) is not None) else None,
            # DISPERSIONE degli utili attesi: forbice larga su consenso unanime = non stanno
            # valutando la stessa azienda
            "eps_min": round(_n(es["low"]), 4) if (es is not None and _n(es["low"])) else None,
            "eps_max": round(_n(es["high"]), 4) if (es is not None and _n(es["high"])) else None,
            "eps_n": int(es["numberOfAnalysts"]) if (es is not None and _n(es["numberOfAnalysts"]) is not None) else None,
            # DISPERSIONE dei target: il minimo puo' stare SOTTO il prezzo, e la media lo nasconde
            "target_min": round(_n(pt.get("low")), 2) if _n(pt.get("low")) else None,
            "target_max": round(_n(pt.get("high")), 2) if _n(pt.get("high")) else None,
            "target_mediana": round(_n(pt.get("median")), 2) if _n(pt.get("median")) else None,
        }
        if not any(v is not None for v in analisti.values()):
            analisti = None
    except Exception as e:  # noqa: BLE001
        print(f"!! analisti {ticker}: {e}", file=sys.stderr)

    # quotazione pre/after market (se la sessione la espone)
    prepost = None
    for pk, lab in (("preMarketPrice", "pre"), ("postMarketPrice", "after")):
        p = info.get(pk)
        if p:
            prepost = {"label": lab, "price": round(float(p), 2),
                       "change_pct": round((float(p) / price - 1) * 100, 2)}
            break

    eps = info.get("trailingEps")
    beta = info.get("beta")
    # IGIENE P/E: con EPS TTM negativo (azienda in perdita) un P/E positivo è privo di senso —
    # il fallback su forwardPE (riga sopra) mascherava la perdita. Obbligatoriamente n.d.
    if eps is not None and float(eps) < 0:
        pe = None

    # conto economico annuale (ricavi, utile netto, margine) + Financial Health Score
    financials, fin_health = [], None
    if has_fundamentals(ticker, currency):
        try:
            inc = t.income_stmt
            rev_row = inc.loc["Total Revenue"] if "Total Revenue" in inc.index else None
            ni_row = inc.loc["Net Income"] if "Net Income" in inc.index else None
            if rev_row is not None and ni_row is not None:
                for col in list(inc.columns)[:5]:
                    rev, ni = rev_row.get(col), ni_row.get(col)
                    if rev and not pd.isna(rev) and ni is not None and not pd.isna(ni):
                        financials.append({"year": int(pd.Timestamp(col).year),
                                           "revenue": round(float(rev)),
                                           "net_income": round(float(ni)),
                                           "margin": round(float(ni) / float(rev) * 100, 1)})
                financials.sort(key=lambda x: x["year"])
            if len(financials) >= 2:
                revs = [f["revenue"] for f in financials]
                margins = [f["margin"] for f in financials]
                growth = (revs[-1] / revs[0]) ** (1 / max(1, len(revs) - 1)) - 1 if revs[0] > 0 else 0
                pos_years = sum(1 for f in financials if f["net_income"] > 0) / len(financials)
                margin_avg = sum(margins) / len(margins)
                margin_std = (sum((mm - margin_avg) ** 2 for mm in margins) / len(margins)) ** 0.5
                fin_health = round(clamp(
                    clamp(50 + growth * 250) * 0.4 +       # crescita ricavi
                    pos_years * 100 * 0.3 +                 # costanza utili
                    clamp(100 - margin_std * 4) * 0.3))     # stabilità margine
        except Exception as e:  # noqa: BLE001
            print(f"!! financials {ticker}: {e}", file=sys.stderr)

    # BUYBACK YIELD (v138) — dal cashflow annuale già scaricabile da yfinance: riacquisti
    # netti delle emissioni / market cap. Il market cap arriva dopo (stats): qui salvo solo
    # i flussi; il rapporto si calcola nel blocco stats. Best-effort: righe assenti → None.
    _bb_repurchase, _bb_issuance = None, None
    if has_fundamentals(ticker, currency):
        try:
            cf = t.cashflow
            for _row, _dst in (("Repurchase Of Capital Stock", "rep"), ("Issuance Of Capital Stock", "iss"),
                               ("Common Stock Issuance", "iss")):
                if _row in cf.index:
                    _ser = cf.loc[_row].dropna()
                    if len(_ser):
                        _val = float(_ser.iloc[0])            # colonna più recente
                        if _dst == "rep":
                            _bb_repurchase = _val
                        elif _bb_issuance is None:
                            _bb_issuance = _val
        except Exception as e:  # noqa: BLE001
            print(f"!! cashflow {ticker}: {e}", file=sys.stderr)

    # statistiche chiave (come scheda "Più dati finanziari") + stime
    # ⚠ TUTTE INIZIALIZZATE QUI, PRIMA DEL RAMO: sono usate nel record finale, che viene
    # costruito anche per i simboli senza fondamentali (indici, futures, ETF). Vedi il gate
    # "v369 nessuna variabile del record assegnata solo dentro un ramo" in test_update_data.py.
    stats = None
    _comb = _cred = _fuori = _short = None
    if has_fundamentals(ticker, currency):
        g = info.get
        def num(*keys):
            for k in keys:
                v = g(k)
                if v is not None and not (isinstance(v, float) and math.isnan(v)):
                    return float(v)
            return None
        shares_out = num("sharesOutstanding", "impliedSharesOutstanding")
        float_sh = num("floatShares")
        stats = {
            "market_cap": num("marketCap"),
            "shares": shares_out,
            "float_shares": float_sh,
            # float_pct nullificato se >100%: impossibile (il float non può superare le azioni
            # in circolazione). Succede su multi-classe (GOOGL) e ADR (TSM) dove Yahoo restituisce
            # floatShares e sharesOutstanding in UNITÀ INCOMPATIBILI → % senza senso per l'AI.
            "float_pct": (lambda p: p if (p is not None and p <= 100) else None)(
                round(float_sh / shares_out * 100, 1) if float_sh and shares_out else None),
            "avg_volume_30d": num("averageVolume", "averageDailyVolume10Day"),
            "pe_ttm": num("trailingPE"),
            "forward_pe": num("forwardPE"),
            "eps_ttm": num("trailingEps"),
            "eps_forward": num("forwardEps"),
            "revenue_fy": num("totalRevenue"),
            "net_income_fy": num("netIncomeToCommon"),
            "revenue_growth": num("revenueGrowth"),
            "earnings_growth": num("earningsGrowth", "earningsQuarterlyGrowth"),
            "profit_margin": num("profitMargins"),
            "roe": num("returnOnEquity"),
            "debt_to_equity": num("debtToEquity"),
            "dividend_yield": div_yield_frac(num("dividendRate", "trailingAnnualDividendRate"), price, num("dividendYield")),
            "price_to_book": num("priceToBook"),
            "target_mean": num("targetMeanPrice"),
            "fcf": num("freeCashflow"),
            "gross_margin": num("grossMargins"),
            "enterprise_value": num("enterpriseValue"),
            "ev_ebitda": num("enterpriseToEbitda"),
            "peg": num("pegRatio", "trailingPegRatio"),
            "roa": num("returnOnAssets"),
            "short_float": num("shortPercentOfFloat"),
            "buyback_yield": buyback_yield_frac(_bb_repurchase, _bb_issuance, num("marketCap")),
        }
        stats = {k: (round(v, 4) if v is not None else None) for k, v in stats.items()}
        # ⚠ v365 — P/S ed EV/S. Il pacchetto diceva all'LLM che per una societa' in perdita
        # il multiplo giusto e' il price-to-sales, e poi non glielo forniva: un rimando a una
        # grandezza che non esiste, cioe' la classe che la regola C10 vieta. Il P/E su chi perde
        # non e' solo inutile, e' monotono nella direzione sbagliata (misurato: -47 -> -22 -> -11
        # mentre le perdite peggiorano), quindi il sostituto non e' un lusso.
        # ⚠ v365 — il riquadro della combustione (vedi combustione() piu' sopra)
        try:
            _comb = combustione(t, stats.get("market_cap"), stats.get("buyback_yield"))
            if _comb:
                _comb["valuta"] = g("financialCurrency") or g("currency")
        except Exception as _e:
            print(f"!! combustione {ticker}: {type(_e).__name__} {_e}", file=sys.stderr)
            _comb = None

        # ⚠ v367 — credito (al posto del CDS) e flusso fuori mercato. Ogni fonte in un try
        # suo: FINRA e' un servizio esterno, e un suo disservizio non deve far cadere il run.
        try:
            _cred = credito(t)
            if _cred:
                _cred["valuta"] = g("financialCurrency") or g("currency")
        except Exception as _e:
            print(f"!! credito {ticker}: {type(_e).__name__} {_e}", file=sys.stderr)
            _cred = None
        if not (ticker.startswith("^") or ticker.endswith("=F")):
            try:
                _fuori = fuori_mercato(ticker)
            except Exception as _e:
                print(f"!! fuori mercato {ticker}: {type(_e).__name__} {_e}", file=sys.stderr)
            try:
                _short = short_volume(ticker)
            except Exception as _e:
                print(f"!! short volume {ticker}: {type(_e).__name__} {_e}", file=sys.stderr)

        # ADR con bilanci in valuta locale → via i rapporti prezzo-vs-bilancio (unità miste)
        stats = scrub_cross_currency_stats(stats, g("financialCurrency"), g("currency"))
        # ⚠ v367 — P/S ed EV/S DOPO la ripulitura cross-currency: se i bilanci sono in valuta
        # locale e il prezzo in un'altra, revenue_fy e' gia' None e questi restano n.d. da soli.
        _mc, _rev = stats.get("market_cap"), stats.get("revenue_fy")
        _ev = stats.get("enterprise_value")
        stats["ps"] = round(_mc / _rev, 2) if (_mc and _rev and _rev > 0) else None
        stats["ev_s"] = round(_ev / _rev, 2) if (_ev and _rev and _rev > 0) else None

        # sanity: un PEG negativo (utili o crescita attesa negativi) non è usabile nei modelli → n.d.
        if stats.get("peg") is not None and stats["peg"] <= 0:
            stats["peg"] = None
        # IGIENE P/E anche nelle stats: EPS TTM < 0 → pe_ttm obbligatoriamente n.d.
        if stats.get("eps_ttm") is not None and stats["eps_ttm"] < 0:
            stats["pe_ttm"] = None
        # MULTIPLI DI VALUTAZIONE NEGATIVI = privi di senso (patrimonio netto negativo → P/B<0;
        # EBITDA negativo → EV/EBITDA<0): un "P/B -55,7×" o "EV/EBITDA -513×" (visto su CBRS) non è
        # un multiplo, è rumore. Nullati: la distress la dicono già ROE<0, margini<0 e Altman.
        for _k in ("price_to_book", "ev_ebitda"):
            if stats.get(_k) is not None and stats[_k] <= 0:
                stats[_k] = None

        # Altman Z''-Score (variante NON-MANIFATTURIERI/servizi, Altman 1993 — corretta per
        # tech/software asset-light): Z'' = 6.56·WC/TA + 3.26·RE/TA + 6.72·EBIT/TA + 1.05·MVE/TL.
        # NIENTE termine Sales/TA: la formula classica penalizzava a sproposito i business
        # con pochi asset e alto multiplo. Proxy fedele: tollera al massimo 1 componente
        # mancante (pesata 0, conteggiata in altman_missing); se mancano di più → n.d.
        # Flag di distress del mandato: < 1.81 → [RISCHIO DEFAULT] (nota: i cutoff canonici
        # dello Z'' sono 1.1/2.6, quindi 1.81 è un flag PRUDENZIALE dentro la zona grigia).
        try:
            bs = t.balance_sheet
            def bs_row(*names):
                for nm in names:
                    if nm in bs.index:
                        v = bs.loc[nm].iloc[0]   # colonna più recente
                        if v is not None and not pd.isna(v):
                            return float(v)
                return None
            ta_ = bs_row("Total Assets")
            tl_ = bs_row("Total Liabilities Net Minority Interest", "Total Liab")
            ca_ = bs_row("Current Assets", "Total Current Assets")
            cl_ = bs_row("Current Liabilities", "Total Current Liabilities")
            re_ = bs_row("Retained Earnings")
            ebit = None
            try:
                inc_z = t.income_stmt
                for nm in ("EBIT", "Operating Income", "Pretax Income"):
                    if nm in inc_z.index:
                        v = inc_z.loc[nm].iloc[0]
                        if v is not None and not pd.isna(v):
                            ebit = float(v)
                            break
            except Exception:  # noqa: BLE001
                pass
            if ta_ and ta_ > 0 and tl_ and tl_ > 0:
                wc = (ca_ - cl_) if (ca_ is not None and cl_ is not None) else None
                # ⚠ X4 dello Z'' e' PATRIMONIO NETTO CONTABILE / passivita' totali (coeff. 1,05).
                # Con `market_cap` al numeratore — che appartiene allo Z-score ORIGINALE, dove
                # pero' il coefficiente e' 0,6 — il quarto termine domina e il punteggio misura
                # quanto il mercato ama il titolo invece della solidita' del bilancio:
                # misurato PLTR 326,52 · NVDA 120,18 contro uno Z'' plausibile fra -5 e +10.
                book = ta_ - tl_
                comp = [
                    (6.56, wc / ta_ if wc is not None else None),
                    (3.26, re_ / ta_ if re_ is not None else None),
                    (6.72, ebit / ta_ if ebit is not None else None),
                    (1.05, book / tl_),
                ]
                missing = sum(1 for _, x in comp if x is None)
                if missing <= 1:
                    z_ = round(sum(w_ * (x or 0.0) for w_, x in comp), 2)
                    # lo Z'' vive fra circa -10 e +15: i cutoff sono 1,1 e 2,6. Fuori da questa
                    # banda il numero non e' "molto solido", e' un calcolo sbagliato — e non
                    # deve arrivare in pagina con un flag di rischio attaccato.
                    if -15 <= z_ <= 20:
                        stats["altman_z"] = z_
                        stats["altman_missing"] = missing
                        stats["altman_model"] = "Z''"
                    else:
                        stats["altman_fuori_scala"] = z_
                        print(f"!! altman {ticker}: Z''={z_} fuori dalla banda plausibile, non pubblicato",
                              file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"!! altman {ticker}: {e}", file=sys.stderr)

    # salute tecnica 0-100 (per il termometro di portafoglio)
    parts = []
    if rsi is not None:
        parts.append(rsi)
    parts.append(100 if (sma50 and sma200 and price > sma50 > sma200) else
                 70 if (sma50 and price > sma50) else
                 50 if (sma200 and price > sma200) else 20)
    m1 = sparks["m1"]
    if len(m1) > 1 and m1[0]:
        parts.append(clamp(50 + (m1[-1] / m1[0] - 1) * 100 * 5))
    health = round(sum(parts) / len(parts)) if parts else None

    auto_name = (info.get("shortName") or ticker).strip()
    if len(auto_name) > 26:
        auto_name = auto_name[:25].rstrip() + "…"
    # sanity: una variazione intraday >+150% / <-80% su una large cap (>$5 mld) è un glitch API.
    # Con UNA sola barra di storico (IPO del giorno prima: visto su SKHYV) prev==price darebbe
    # uno 0% FINTO — meglio n.d. che un numero inventato (il day-2 reale era +13%).
    chg = round((price / prev - 1) * 100, 2) if len(closes) > 1 else None
    mcap = info.get("marketCap") or 0
    if chg is not None and mcap > 5e9 and not (-80 <= chg <= 150):
        global SANITY_FILTERED
        SANITY_FILTERED += 1
        print(f"!! sanity check: change_pct {chg}% scartato per {ticker} (mcap ${mcap/1e9:.0f}B)", file=sys.stderr)
        chg = None
    return {
        "ticker": ticker,
        "name": name or auto_name,
        "currency": currency,
        "price_src": price_src,          # "yahoo" | "stooq" (fallback prezzi etichettato)
        "price": round(price, 2),
        "price_asof": price_asof,        # data dell'ultima chiusura valida (staleness dichiarabile)
        "price_asof_arretrata_da": arretrata_da,   # v383: seduta PIU' RECENTE che un run precedente aveva gia' pubblicato
        "price_live": price_live,        # True = ultimo scambio LIVE (KOSPI/BTC/futures fuori orario USA)
        "change_pct": chg,
        "pe": round(float(pe), 1) if pe and pe > 0 else None,
        "ath": round(ath, 2),
        "ath_dist_pct": round((price / ath - 1) * 100, 1),
        "sma200_dist_pct": round((price / sma200 - 1) * 100, 1) if sma200 else None,   # distanza % da SMA200 (price action pura)
        "sma50_dist_pct": round((price / sma50 - 1) * 100, 1) if sma50 else None,      # distanza % da SMA50 (setup TURNAROUND SQUEEZE)
        "w52_high": round(float(hist["High"].max()), 2),
        "w52_low": round(float(hist["Low"].min()), 2),
        "w52_dist_pct": round((price / float(hist["High"].max()) - 1) * 100, 1),
        # ⚠ v266 — MASSIMO E MINIMO DELLA GIORNATA, dall'ULTIMA BARRA di `hist`, non da un
        # download in piu': la tabella watchlist ha le colonne del broker del CEO, dove
        # "Massimo" vuol dire massimo di oggi. Prima quelle celle ripiegavano sul massimo a
        # 52 settimane, cioe' mostravano 207,52 accanto a un prezzo di 172,01 sotto
        # un'intestazione che dice un'altra cosa: un numero vero al posto sbagliato, che e'
        # il modo piu' silenzioso di mentire (la classe "grafico che segna una linea retta").
        "day_high": round(float(hist["High"].iloc[-1]), 2) if len(hist) else None,
        "day_low": round(float(hist["Low"].iloc[-1]), 2) if len(hist) else None,
        "support": round(float(hist["Low"].tail(20).min()), 2),
        "resistance": round(float(hist["High"].tail(20).max()), 2),
        "rsi": rsi,
        "volume": int(vol),
        "vol_ratio": vol_ratio,   # RVol full-day robusto (vedi sopra): n.d. se volume 0/assente
        "atr_14": round(atr_14, 2) if atr_14 else None,
        "atr_pct": round(atr_14 / price * 100, 2) if atr_14 and price else None,
        "signal": sig,
        "signal_class": sig_class,
        "sparks": sparks,
        "earnings_date": earnings_date,
        "rating": rating,
        "analisti": analisti,   # v361 — revisioni, dispersione degli utili e dei target
        "health": health,
        "eps": round(float(eps), 2) if eps is not None else None,
        "beta": round(float(beta), 2) if beta is not None else None,
        "sharpe_1y": sharpe_1y,
        "sortino_1y": sortino_1y,
        "sharpe_6m": sharpe_6m,          # finestra di REGIME per lo score dei riabilitati growth
        "sortino_6m": sortino_6m,
        "prepost": prepost,
        # OFFLOADING per l'LLM: prezzo di riferimento REALE per ordini limite. Se c'è un gap
        # pre/after (sessione estesa) usa QUEL prezzo; altrimenti l'ultima chiusura regolare.
        # Evita che l'AI calcoli male "chiusura + gap%" a mano.
        "prezzo_limite_aggiustato": round(float(prepost["price"]), 2) if prepost else round(price, 2),
        # ⚠⚠ v328 — IL REWARD SI MISURA DAL PREZZO CHE PAGHERESTI, NON DAL SUPPORTO.
        # Il limite era il MINIMO DELLE ULTIME 20 SEDUTE: il rapporto descriveva quindi
        # l'operazione di chi ha comprato sul minimo, non di chi compra oggi — e la differenza
        # non e' piccola. Misurato sui dati veri: MU usciva 1:1.9 mentre dal prezzo di
        # riferimento vale 0,28 (sette volte), NVDA 1:2.7 contro 0,17 (sedici volte), e su 23
        # righe su 23 lo scarto andava NELLA STESSA DIREZIONE: ottimista.
        # Non era un errore di stima, era una definizione che lusinga. Ora il denominatore e' il
        # prezzo che si pagherebbe davvero, e il campo accanto dichiara quale base e' stata usata
        # — cosi' nessuna riga puo' piu' affermare una base diversa dalla propria.
        "risk_reward": _risk_reward_str(
            round(float(prepost["price"]), 2) if prepost else round(price, 2),   # il prezzo che pagheresti
            float(hist["High"].tail(20).max()),           # target = resistenza a 20 sedute
            atr_14),
        "risk_reward_base": "prezzo esteso" if prepost else "ultima chiusura",
        # MAI il quoteType come settore ("EQUITY" non è un settore: falsava la concentrazione)
        "sector": SECTOR_OVERRIDES.get(ticker) or info.get("sector") or "Altro",
        "stats": stats,
        "combustione": _comb,   # v365 — cassa, debito, flusso operativo, capex. None se la fonte non li da'.
        "credito": _cred,       # v367 — al posto del CDS: oneri finanziari, copertura, scadenze.
        "fuori_mercato": _fuori,# v367 — ATS (dark pool) e OTC non-ATS per settimana, FINRA.
        "short_flusso": _short, # v367 — quota di volume venduta allo scoperto, FINRA, giornaliera.
        "tech_by_range": tech_by_range,
        "financials": financials,
        "fin_health": fin_health,
        "smc": smc_analysis(hist),
        # v316 — la colonna di TradingView, calcolata da noi (richiesta del CEO)
        "tv": {k: v for k, v in (
            ("tecnica", batteria_tecnica(hist)),
            ("ohlc", barre_ohlc(hist)),
            ("performance", performance_orizzonti(hist, monthly)),
            ("stagionalita", stagionalita_titolo(monthly)),
            # ⚠ si passano le CHIUSURE, non i rendimenti: l'unita' la decide la funzione (v325)
            ("sensibilita", sensibilita_macro(closes, canali_macro()) if has_fundamentals(ticker, currency) else None),
            ("conto_trim", conto_trimestrale(t) if has_fundamentals(ticker, currency) else None),
        ) if v},
        # serie rendimenti giornalieri (uso interno per lo Sharpe di portafoglio; rimossa prima del dump)
        "_ret_series": [round(float(x), 6) for x in daily_ret.tail(252)],
        "_ret_dates": [d.strftime("%Y-%m-%d") for d in daily_ret.index[-252:]],
    }


def fetch_equities():
    # benchmark 1 mese per RS relativa (SP500, SOX, NDX)
    bench_m1 = {}
    for sym, key, fb in (("^GSPC", "sp500", None), ("^SOX", "sox", "SOXX"), ("^NDX", "ndx", None)):
        h = bench_close(sym, fb)   # ^SOX flaky da IP datacenter → fallback SOXX (stessa % RS)
        bench_m1[key] = (float(h.iloc[-1]) / float(h.iloc[-22]) - 1) * 100 if (h is not None and len(h) >= 22) else None

    rows = []
    for pos in PORTFOLIO:
        # ⚠ v254 — UN NOME MANCANTE NON PUÒ FERMARE L'INTERA ACQUISIZIONE.
        # `pos["name"]` ha sollevato KeyError su BE/SKHY/WDC/MRVL, scritte in holdings.json
        # dal diario senza il campo `name`: ogni run del CI moriva QUI, prima di scaricare un
        # solo prezzo, e data.json e' rimasto fermo a 9 posizioni per un giorno intero mentre
        # il portafoglio vero ne aveva 13. La causa e' stata corretta a monte (in app.js), ma
        # il nome e' un'ETICHETTA DA MOSTRARE: che la sua assenza abbatta la pipeline dei
        # prezzi e' una fragilita' a se' stante. Senza nome si usa il ticker.
        row = fetch_symbol(pos["ticker"], pos.get("name") or pos["ticker"])
        if not row:
            continue
        value = row["price"] * pos["qty"]
        cost = pos["pmc"] * pos["qty"]
        # RS 1M vs benchmark settoriale + RS 1M vs NDX (metro diretto del mandato)
        bkey = SECTOR_BENCH.get(pos["ticker"], "sp500")
        bm1 = bench_m1.get(bkey) or bench_m1.get("sp500")
        m1 = row.get("sparks", {}).get("m1", [])
        rs_1m, rs_ndx_1m = None, None
        if len(m1) >= 2 and m1[0]:
            stk_m1 = (m1[-1] / m1[0] - 1) * 100
            if bm1 is not None:
                rs_1m = round(stk_m1 - bm1, 1)
            if bench_m1.get("ndx") is not None:
                rs_ndx_1m = round(stk_m1 - bench_m1["ndx"], 1)
        row.update({
            "qty": pos["qty"], "pmc": pos["pmc"],
            # snapshot reale broker in EUR (controvalore/profitto) se fornito in config
            "bval": pos.get("bval"), "bgain": pos.get("bgain"),
            "value": round(value, 2),
            "gain": round(value - cost, 2),
            "gain_pct": round((value / cost - 1) * 100, 2),
            "rs_1m": rs_1m,
            "rs_bench": bkey,
            "rs_ndx_1m": rs_ndx_1m,
        })
        rows.append(row)
    return rows


def fetch_watchlist():
    bench_m1 = {}
    for sym, key, fb in (("^GSPC", "sp500", None), ("^SOX", "sox", "SOXX"), ("^NDX", "ndx", None)):
        h = bench_close(sym, fb)   # ^SOX flaky da IP datacenter → fallback SOXX (stessa % RS)
        bench_m1[key] = (float(h.iloc[-1]) / float(h.iloc[-22]) - 1) * 100 if (h is not None and len(h) >= 22) else None

    rows = []
    for w in WATCHLIST:
        row = fetch_symbol(w["ticker"], w.get("name"), w.get("currency", "USD"))
        if not row:
            continue
        bkey = SECTOR_BENCH.get(w["ticker"], "sp500")
        bm1 = bench_m1.get(bkey) or bench_m1.get("sp500")
        m1 = row.get("sparks", {}).get("m1", [])
        rs_1m, rs_ndx_1m = None, None
        if len(m1) >= 2 and m1[0]:
            stk_m1 = (m1[-1] / m1[0] - 1) * 100
            if bm1 is not None:
                rs_1m = round(stk_m1 - bm1, 1)
            if bench_m1.get("ndx") is not None:
                rs_ndx_1m = round(stk_m1 - bench_m1["ndx"], 1)
        row["rs_1m"] = rs_1m
        row["rs_bench"] = bkey
        row["rs_ndx_1m"] = rs_ndx_1m
        rows.append(row)
    return rows


def fetch_btp():
    price = BTP["fallback_price"]
    try:
        url = f"https://www.borsaitaliana.it/borsa/obbligazioni/mot/btp/scheda/{BTP['isin']}.html"
        html = http_get(url).text
        m = re.search(r'Prezzo ufficiale[^0-9]{0,200}?([0-9]{2,3}[.,][0-9]{1,4})', html) or \
            re.search(r'"lastPrice"\s*:\s*([0-9.]+)', html) or \
            re.search(r'Ultimo prezzo[^0-9]{0,200}?([0-9]{2,3}[.,][0-9]{1,4})', html) or \
            re.search(r'-\s*Prezzo[^0-9]{0,80}?([0-9]{2,3},[0-9]{1,4})', html)
        if m:
            price = float(m.group(1).replace(",", "."))
    except Exception as e:  # noqa: BLE001
        print(f"!! prezzo BTP non disponibile, uso fallback: {e}", file=sys.stderr)
    value = BTP["nominal"] * price / 100
    cost = BTP["nominal"] * BTP["pmc"] / 100
    return {
        "ticker": BTP["ticker"], "name": BTP["name"], "isin": BTP["isin"],
        "qty": BTP["nominal"], "pmc": BTP["pmc"], "currency": "EUR",
        "bval": (BROKER or {}).get("controvalore_btp"), "bgain": (BROKER or {}).get("btp_bgain"),
        "price": round(price, 2), "change_pct": None,
        "value": round(value, 2), "gain": round(value - cost, 2),
        "gain_pct": round((value / cost - 1) * 100, 2),
        "pe": None, "ath": None, "ath_dist_pct": None, "w52_high": None, "w52_low": None,
        "day_high": None, "day_low": None, "w52_dist_pct": None,
        "support": None, "resistance": None, "rsi": None,
        "volume": None, "vol_ratio": None,
        "signal": "Cedola 4,10/4,50%", "signal_class": "info",
        "sparks": {}, "earnings_date": None, "rating": None, "health": None,
        "eps": None, "beta": None, "prepost": None,
        "sector": "Obbligazioni", "tech_by_range": {}, "stats": None,
        "financials": [], "fin_health": None,
    }


def _finestra_comune(a, b):
    """Ritaglia due serie [(data_iso, valore)] alla FINESTRA TEMPORALE COMUNE.

    v207 — nasce da un difetto misurato: due serie normalizzate a 100 su date di partenza
    DIVERSE non sono confrontabili, e sottrarne i valori finali non produce un "gap" ma la
    differenza fra due periodi diversi. Il caso reale era S&P su 7 settimane contro PIL su
    3 anni, pubblicato nel payload come "disaccoppiamento -3 pp".

    Ritorna (a_tagliata, b_tagliata) oppure None se non c'è sovrapposizione utilizzabile —
    e in quel caso il chiamante NON deve pubblicare il confronto. Le date FRED sono ISO,
    quindi l'ordinamento lessicografico coincide con quello cronologico.
    """
    if not a or not b:
        return None
    da, fino = max(a[0][0], b[0][0]), min(a[-1][0], b[-1][0])
    if da >= fino:
        return None
    ta = [(d, v) for d, v in a if da <= d <= fino]
    tb = [(d, v) for d, v in b if da <= d <= fino]
    if len(ta) < 2 or len(tb) < 2:
        return None
    # ⚠⚠ v349 — LO STESSO INTERVALLO NON E' LA STESSA PARTENZA, e il docstring qui sopra
    # descrive esattamente il difetto che restava vivo. Ritagliare su [da, fino] allinea la
    # FINESTRA; con due frequenze diverse le due serie hanno pero' la loro PRIMA osservazione
    # dentro quella finestra in due date diverse, e il chiamante ribasa ciascuna sul proprio
    # primo punto — cioe' di nuovo su due partenze diverse.
    # Misurato sui dati veri del 23/08/2026, ramo NDX di corp_profit:
    #   ndx_al partiva da 2021-09-01, cp_al da 2021-10-01 (l'NDX e' mensile, i profitti
    #   trimestrali) — un mese di Nasdaq in piu' che i profitti non avevano.
    #   ndx_gap pubblicato 40,1 pp · ricalcolato su base comune 27,3 pp.
    # Non era un decimale: 40,1 supera la soglia dichiarata di 40 pp, quindi worst_gap
    # prendeva l'NDX invece dell'S&P e il sistema pubblicava "Asset Inflation (driver: NDX)"
    # dove il dato allineato dice "Tensione moderata". Il numero sbagliato era quello stampato
    # in cima, con la sua etichetta.
    # Si avanza `da` alla prima data in cui ENTRAMBE hanno un'osservazione e si ritaglia di
    # nuovo: cosi' il ribasamento del chiamante parte dallo stesso mese per tutte e due.
    da2 = max(ta[0][0], tb[0][0])
    if da2 != da:
        ta = [(d, v) for d, v in ta if d >= da2]
        tb = [(d, v) for d, v in tb if d >= da2]
        if len(ta) < 2 or len(tb) < 2:
            return None
    return ta, tb


def fred_series(series_id, n=14, freq=None):
    # con FRED_API_KEY (gratuita, https://fred.stlouisfed.org/docs/api/api_key.html)
    # usa l'API ufficiale, molto più affidabile del csv pubblico
    # freq: None (nativa) | "m" mensile | "q" trimestrale (aggregazione media)
    key = os.environ.get("FRED_API_KEY")
    if key:
        fq = f"&frequency={freq}&aggregation_method=avg" if freq else ""
        r = http_get("https://api.stlouisfed.org/fred/series/observations"
                     f"?series_id={series_id}&api_key={key}&file_type=json{fq}"
                     f"&sort_order=desc&limit={n + 4}")
        obs = r.json()["observations"]
        out = []
        for o in reversed(obs):
            try:
                out.append((o["date"], float(o["value"])))
            except ValueError:
                continue
        return out[-n:]
    r = http_get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}")
    out = []
    for line in r.text.strip().splitlines()[1:]:
        date, _, val = line.partition(",")
        try:
            out.append((date, float(val)))
        except ValueError:
            continue
    return out[-n:]


def bls_series(series_id, n=14):
    """Fallback per le serie BLS (CPI, NFP, disoccupazione) — API pubblica v1, senza chiave."""
    r = http_get(f"https://api.bls.gov/publicAPI/v1/timeseries/data/{series_id}")
    rows = r.json()["Results"]["series"][0]["data"]
    out = []
    for x in rows:
        if not x["period"].startswith("M") or x["period"] == "M13":  # M13 = media annuale
            continue
        try:
            out.append((f"{x['year']}-{x['period'][1:]}-01", float(x["value"].replace(",", ""))))
        except ValueError:
            continue
    out.reverse()
    return out[-n:]


def dbnomics_series(code, n=14):
    """Fallback via DBnomics (BEA, OECD...)."""
    r = http_get(f"https://api.db.nomics.world/v22/series/{code}?observations=1&format=json")
    doc = r.json()["series"]["docs"][0]
    pairs = [(p, v) for p, v in zip(doc["period"], doc["value"]) if isinstance(v, (int, float))]
    return pairs[-n:]


def jgb10_yield():
    """Rendimento JGB 10 anni dal csv ufficiale del MOF giapponese (mese corrente)."""
    text = http_get("https://www.mof.go.jp/jgbs/reference/interest_rate/jgbcm.csv").content.decode("shift_jis", errors="ignore")
    last = None
    for line in text.splitlines():
        cols = line.split(",")
        # righe dati: data in era Reiwa (es. R8.6.12), 10 anni = 11ª colonna
        if len(cols) > 10 and re.match(r"^[A-Z]\d+\.\d+\.\d+$", cols[0].strip()):
            try:
                last = float(cols[10])
            except ValueError:
                continue
    if last is None:
        raise ValueError("csv MOF senza dati 10 anni")
    return last


UMICH_MONTHS = {m: i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June",
     "July", "August", "September", "October", "November", "December"])}


def umich_series(n=2):
    """Fiducia consumatori dalla fonte PRIMARIA (sca.isr.umich.edu).

    Perché esiste: FRED distribuisce UMCSENT con 1-2 mesi di ritardo di LICENZA, quindi il
    payload mostrava al CIO una rilevazione vecchia come fosse l'ultima disponibile — e non
    è solo questione di data: nel run del 26/07/2026 FRED dava 44,8 (maggio, minimi storici)
    mentre la fonte primaria dava già 49,5 (giugno), cioè un RECUPERO del 10,5%. Un dato
    stantio che punta nella direzione opposta è peggio di un dato dichiarato mancante.
    Ritorna la stessa forma di fred_series: [(data ISO, valore), ...] in ordine cronologico.
    """
    ua = {"User-Agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36"}
    txt = requests.get("https://www.sca.isr.umich.edu/files/tbmics.csv", headers=ua, timeout=20).text
    out = []
    for row in csv.DictReader(io.StringIO(txt)):
        raw = (row.get("ICS_ALL") or "").strip()
        mese = (row.get("Month") or "").strip()
        anno = (row.get("YYYY") or "").strip()
        if not raw or mese not in UMICH_MONTHS or not anno.isdigit():
            continue
        try:
            out.append((f"{int(anno):04d}-{UMICH_MONTHS[mese]:02d}-01", float(raw)))
        except ValueError:
            continue
    if not out:
        raise ValueError("CSV UMich senza righe valide")
    out.sort(key=lambda x: x[0])
    return out[-n:] if n else out


def _distanza_mesi(a: str, b: str) -> int:
    """quanti mesi separano due osservazioni ISO (b - a)."""
    return (int(b[:4]) - int(a[:4])) * 12 + (int(b[5:7]) - int(a[5:7]))


def _mese_meno(iso: str, n: int) -> str:
    """la data ISO di n mesi prima. Le osservazioni mensili FRED stanno sempre al giorno 01."""
    tot = int(iso[:4]) * 12 + (int(iso[5:7]) - 1) - n
    return f"{tot // 12:04d}-{tot % 12 + 1:02d}-{iso[8:10]}"


def _var_per_data(serie, mesi: int):
    """Variazione percentuale su `mesi`, agganciata alla DATA e non alla POSIZIONE.

    ═══ v393 — L'INFLAZIONE PUBBLICATA ERA UN 13 MESI CHIAMATO "a/a" ═══════════════════════
    `yoy` faceva `series[-1] / series[-13]`: conta tredici POSIZIONI indietro e da' per
    scontato che siano dodici mesi. Lo sono solo se la serie non ha buchi.

    ⚠⚠ CPIAUCSL HA UN BUCO A OTTOBRE 2025 (il BLS non ha pubblicato quel mese), e UNRATE lo
    ha con lui. Misurato sui dati veri il 30/08/2026: la posizione -13 cadeva su GIUGNO 2025
    invece che su luglio, quindi il pacchetto pubblicava 332,813/321,435 = 3,54% -> "CPI 3,5%"
    dove l'anno su anno vero e' 332,813/322,169 = 3,30%. Sovrastima di 0,24 pp sul numero
    macro piu' letto del pacchetto, e NON su un punto solo: nove punti consecutivi dello
    storico, tutti gonfiati, da novembre 2025 in poi.
    Un LLM reale l'ha intercettato dall'esito (obiettava 3,4% del BLS contro il nostro 3,5%)
    senza poter vedere la causa, e la causa non era ne' la fonte ne' l'arrotondamento.

    E' la classe v207 — *l'allineamento per POSIZIONE invece che per data* — gia' pagata sui
    grafici macro e di nuovo in v391 sulle barre OHLC filtrate indipendentemente. Qui stava
    nel numero che apre il quadro macro.

    ⚠ QUANDO LA BASE ESATTA NON C'E' non si tace e non si finge: si prende l'osservazione
    precedente piu' vicina e si RESTITUISCE LA DISTANZA VERA, cosi' chi stampa puo' dichiarare
    "su 13 mesi" invece di scrivere "a/a" su una cosa che non lo e'. Far sparire l'inflazione
    per un mese intero sarebbe peggio del difetto (v199: un numero fuori orizzonte e' peggio
    di nessun numero, ma un buco dichiarato non e' un numero fuori orizzonte).

    Ritorna (valore, data_ultima_osservazione, mesi_effettivi).
    """
    if not serie or len(serie) < 2:
        raise ValueError("serie troppo corta per una variazione")
    ultima, valore = serie[-1]
    atteso = _mese_meno(ultima, mesi)
    per_data = {d: v for d, v in serie}
    base = per_data.get(atteso)
    effettivi = mesi
    if base is None:
        precedenti = [(d, v) for d, v in serie if d < atteso]
        if not precedenti:
            raise ValueError(f"nessuna osservazione a {mesi} mesi da {ultima}")
        d0, base = precedenti[-1]
        effettivi = _distanza_mesi(d0, ultima)
        print(f"!! {atteso} assente nella serie: base a {d0}, distanza reale {effettivi} mesi",
              file=sys.stderr)
    if not base:
        raise ValueError(f"base nulla a {atteso}")
    return round((valore / base - 1) * 100, 1), ultima, effettivi


# ⚠⚠ v393 — CHI HA SERVITO IL DATO E' PARTE DEL DATO, e finora non usciva dalla funzione.
# UMich ha una fonte primaria (sca.isr.umich.edu, che pubblica il definitivo a FINE mese) e un
# ripiego su FRED UMCSENT, che sconta 1-2 mesi di ritardo di LICENZA. Il pacchetto scriveva
# SEMPRE la seconda versione — "via FRED ... questo valore non e' l'ultimo pubblicato" — anche
# quando a servire era stata la primaria, cioe' DIFFAMAVA UN DATO FRESCO dicendo che era vecchio.
# Misurato il 30/08/2026: valore 51,7 di agosto dalla primaria, dichiarato come lettura di FRED
# vecchia di 29 giorni e non aggiornata. Un LLM reale l'ha corretto, giustamente.
# E' la stessa regola gia' applicata allo STORICO ("lo storico esce dalla stessa fonte del
# valore"): qui vale per l'etichetta e per il calendario, che dalla fonte dipendono entrambi.
FONTE_SERVITA: dict = {}


def series_fallback(label, primary, fallback=None):
    try:
        s = primary()
        FONTE_SERVITA[label] = "primaria"
        return s
    except Exception as e:  # noqa: BLE001
        print(f"!! {label}: fonte primaria ko ({e}), provo fallback", file=sys.stderr)
        if fallback is None:
            raise
        s = fallback()
        FONTE_SERVITA[label] = "ripiego"
        return s


def fetch_macro():
    macro = {}

    # CNN Fear & Greed (con i 7 componenti, come su cnn.com/markets/fear-and-greed)
    try:
        data = http_get("https://production.dataviz.cnn.io/index/fearandgreed/graphdata").json()
        fg = data["fear_and_greed"]
        comp_labels = {
            "market_momentum_sp500": "Momentum S&P 500",
            "stock_price_strength": "Forza dei prezzi",
            "stock_price_breadth": "Ampiezza del mercato",
            "put_call_options": "Opzioni Put/Call",
            "market_volatility_vix": "Volatilità (VIX)",
            "safe_haven_demand": "Domanda beni rifugio",
            "junk_bond_demand": "Domanda bond high yield",
        }
        comps = []
        for key, lab in comp_labels.items():
            c = data.get(key)
            if isinstance(c, dict) and c.get("rating"):
                comps.append({"label": lab, "rating": c["rating"],
                              "score": round(c["score"]) if c.get("score") is not None else None})
        # FOMO derivato: avidità + momentum recente S&P 500 (più sale forte, più FOMO)
        fomo = None
        try:
            sp = yf.Ticker("^GSPC").history(period="1mo")["Close"].dropna()
            mom = (float(sp.iloc[-1]) / float(sp.iloc[0]) - 1) * 100
            fomo = round(max(0, min(100, 0.6 * fg["score"] + 0.4 * (50 + mom * 6))))
        except Exception:  # noqa: BLE001
            fomo = round(fg["score"])
        fomo_label = "FOMO elevata" if fomo >= 70 else "FOMO moderata" if fomo >= 50 else "Nessuna FOMO"
        macro["fear_greed"] = {
            "score": round(fg["score"]), "rating": fg["rating"],
            "prev_close": round(fg.get("previous_close", 0)),
            "week_ago": round(fg.get("previous_1_week", 0)),
            "month_ago": round(fg.get("previous_1_month", 0)),
            "year_ago": round(fg.get("previous_1_year", 0)),
            "components": comps,
            "fomo": fomo, "fomo_label": fomo_label,
        }
    except Exception as e:  # noqa: BLE001
        print(f"!! fear&greed: {e}", file=sys.stderr)

    # VIX
    try:
        h = yf.Ticker("^VIX").history(period="3mo")["Close"]
        macro["vix"] = {
            "value": round(float(h.iloc[-1]), 2),
            "change_pct": round((float(h.iloc[-1]) / float(h.iloc[-2]) - 1) * 100, 2),
            "spark": [round(float(c), 2) for c in h.tail(30)],
            "asof": bar_asof(h),          # v261: la barra da cui viene, non il run
        }
    except Exception as e:  # noqa: BLE001
        print(f"!! vix: {e}", file=sys.stderr)

    # FedWatch (tassi impliciti dai futures Fed Funds 30-day)
    try:
        zq = yf.Ticker("ZQ=F").fast_info.last_price
        implied = round(100 - float(zq), 2)
        target = target_low = None
        try:                                        # 1) FRED
            target = fred_series("DFEDTARU", 1)[-1][1]
            target_low = fred_series("DFEDTARL", 1)[-1][1]
        except Exception:  # noqa: BLE001
            try:                                    # 2) NY Fed
                rr = http_get("https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json").json()["refRates"][0]
                target, target_low = float(rr["targetRateTo"]), float(rr["targetRateFrom"])
            except Exception:  # noqa: BLE001        # 3) fascia ricavata dal tasso implicito
                target_low = math.floor(implied / 0.25) * 0.25
                target = target_low + 0.25
        mid = (target + target_low) / 2
        # prossime riunioni FOMC 2026 con probabilità taglio implicita dai futures
        # (stesso calendario FOMC_2026: mai più due liste divergenti nel prompt)
        fomc = [d for d in FOMC_2026
                if d >= datetime.now(timezone.utc).strftime("%Y-%m-%d")]
        # v186 — IL SEGNO CONTA, ED ERA BUTTATO VIA.
        # (mid - implied)/0.25 e' la distanza dal punto medio del range in "quarti di punto":
        # POSITIVA quando i futures prezzano un tasso PIU BASSO (taglio atteso), NEGATIVA quando
        # ne prezzano uno PIU ALTO (rialzo atteso). Il max(0, ...) schiacciava a zero tutto il
        # ramo del rialzo, e il payload stampava "prob. taglio 0%" — vero e inutile, perche' il
        # rischio stava dall'altra parte. Il 26/07/2026 il valore grezzo era -38,0: cioe' 38% di
        # probabilita' di RIALZO, esattamente il numero pubblicato da CME FedWatch quel giorno.
        # Il sistema aveva la cifra giusta e la cestinava a tre giorni dal FOMC.
        quarti = (mid - implied) / 0.25 * 100
        cut_prob = round(max(0, min(100, quarti)))
        hike_prob = round(max(0, min(100, -quarti)))
        meetings = []
        for i, d in enumerate(fomc[:4]):
            # la cumulata cresce nel tempo sul ramo ATTIVO: se il mercato prezza rialzi, e' la
            # probabilita' di rialzo a salire con l'orizzonte, non quella di taglio.
            pc = min(100, cut_prob + i * 12) if cut_prob else 0
            ph = min(100, hike_prob + i * 12) if hike_prob else 0
            meetings.append({"date": d, "cut_prob": pc, "hike_prob": ph,
                             "hold_prob": max(0, 100 - pc - ph)})
        macro["fedwatch"] = {
            "target_range": f"{target_low:.2f}–{target:.2f}%",
            "implied_rate": implied,
            "delta_bp": round((implied - mid) * 100),
            "next_cut_prob": cut_prob,
            "next_hike_prob": hike_prob,
            "next_fomc": next_fomc_date(),   # data esplicita della prossima riunione FOMC
            "meetings": meetings,
            # Dot Plot: mediana SEP (Summary of Economic Projections) — da aggiornare a ogni SEP
            "dot_plot": [
                {"year": "2026", "median": 3.6},
                {"year": "2027", "median": 3.4},
                {"year": "2028", "median": 3.1},
                {"year": "Lungo periodo", "median": 3.0},
            ],
            "dot_plot_note": "Mediana proiezioni FOMC (SEP). Fonte: federalreserve.gov",
        }
    except Exception as e:  # noqa: BLE001
        print(f"!! fedwatch: {e}", file=sys.stderr)

    # Serie FRED
    def yoy(series):
        return _var_per_data(series, 12)

    def mom(series):
        return _var_per_data(series, 1)

    # impact: 0 = molto negativo per i mercati, 100 = molto positivo
    indicators = []
    try:
        # ⚠ v393 — L'ANNO SU ANNO DEL CPI SI CALCOLA SULLA SERIE GREZZA, NON SU QUELLA
        # DESTAGIONALIZZATA. Il BLS titola "prices rose X percent over the last 12 months"
        # esplicitamente *on an unadjusted basis*, ed e' il numero che stampa la stampa e che
        # un LLM trova cercando online. Misurato su luglio 2026: CPIAUCNS da' 3,36% -> "3,4%",
        # CPIAUCSL 3,30% -> "3,3%". La destagionalizzazione serve al mese su mese, dove toglie
        # il rumore stagionale; sull'anno su anno quel rumore si cancella da solo e resta solo
        # la revisione annuale dei fattori, che fa divergere il nostro numero da quello
        # pubblicato senza che nessuno dei due sia sbagliato. Ma "CPI a/a" ha UN significato
        # solo per chi legge, e va prodotto quello.
        v, d, mesi = yoy(series_fallback("cpi", lambda: fred_series("CPIAUCNS"),
                                         lambda: bls_series("CUUR0000SA0")))
        ind = {"key": "cpi", "label": "Inflazione CPI (a/a)", "value": f"{v}%", "date": d,
               "impact": round(clamp(100 - abs(v - 2) * 30))}
        if mesi != 12:
            ind["span_mesi"] = mesi
        indicators.append(ind)
    except Exception as e:  # noqa: BLE001
        print(f"!! cpi: {e}", file=sys.stderr)
    try:
        v, d, mesi = yoy(series_fallback("pce", lambda: fred_series("PCEPI"),
                                         lambda: dbnomics_series("BEA/NIPA-T20804/DPCERG-M")))
        ind = {"key": "pce", "label": "Inflazione PCE (a/a)", "value": f"{v}%", "date": d,
               "impact": round(clamp(100 - abs(v - 2) * 30))}
        if mesi != 12:
            ind["span_mesi"] = mesi
        indicators.append(ind)
    except Exception as e:  # noqa: BLE001
        print(f"!! pce: {e}", file=sys.stderr)
    try:
        s = series_fallback("gdp", lambda: fred_series("A191RL1Q225SBEA", 2),
                            lambda: dbnomics_series("BEA/NIPA-T10101/A191RL-Q", 2))
        v = s[-1][1]
        indicators.append({"key": "gdp", "label": "PIL USA (t/t ann.)", "value": f"{v}%", "date": s[-1][0],
                           "impact": round(clamp(50 + (v - 1.5) * 25))})
    except Exception as e:  # noqa: BLE001
        print(f"!! gdp: {e}", file=sys.stderr)
    try:
        v, d, mesi = mom(fred_series("RSAFS"))
        ind = {"key": "retail", "label": "Vendite al dettaglio (m/m)", "value": f"{v}%", "date": d,
               "impact": round(clamp(50 + v * 40))}
        if mesi != 1:
            ind["span_mesi"] = mesi
        indicators.append(ind)
    except Exception as e:  # noqa: BLE001
        print(f"!! retail: {e}", file=sys.stderr)
    try:
        s = series_fallback("nfp", lambda: fred_series("PAYEMS", 3),
                            lambda: bls_series("CES0000000001", 3))
        delta = round((s[-1][1] - s[-2][1]))
        indicators.append({"key": "nfp", "label": "Non-Farm Payrolls", "value": f"{delta:+d}K", "date": s[-1][0],
                           "impact": round(clamp(50 + (delta - 100) / 4))})
    except Exception as e:  # noqa: BLE001
        print(f"!! nfp: {e}", file=sys.stderr)
    try:
        s = series_fallback("unemp", lambda: fred_series("UNRATE", 2),
                            lambda: bls_series("LNS14000000", 2))
        v = s[-1][1]
        indicators.append({"key": "unemp", "label": "Disoccupazione", "value": f"{v}%", "date": s[-1][0],
                           "impact": round(clamp(100 - (v - 3.5) * 40))})
    except Exception as e:  # noqa: BLE001
        print(f"!! unrate: {e}", file=sys.stderr)
    try:
        s = series_fallback("umich", lambda: umich_series(2), lambda: fred_series("UMCSENT", 2))
        v = s[-1][1]
        indicators.append({"key": "umich", "label": "Fiducia consumatori (UMich)",
                           "value": f"{v}", "date": s[-1][0],
                           # v393 — chi ha servito decide etichetta E calendario lato pagina
                           "fonte": FONTE_SERVITA.get("umich", "primaria"),
                           "impact": round(clamp((v - 40) * 1.7))})
    except Exception as e:  # noqa: BLE001
        print(f"!! umcsent: {e}", file=sys.stderr)
    try:
        s = fred_series("T10Y2Y", 1)            # spread curva 10A-2A (segnale recessione)
        v = s[-1][1]
        indicators.append({"key": "curve", "label": "Curva 10A-2A", "value": f"{v:+.2f} pp",
                           "date": s[-1][0], "impact": round(clamp(50 + v * 40))})
    except Exception as e:  # noqa: BLE001
        print(f"!! curve: {e}", file=sys.stderr)
    # ── v266 — LE SERIE CHE MANCAVANO (richiesta del CEO: 3 mesi, 30 anni, tassi reali e
    # inflazione attesa, attivita' manifatturiera). Tutte da FRED, tutte con la loro data:
    # un numero senza rilevazione qui non entra.
    try:
        s3 = fred_series("T10Y3M", 1)            # 10A-3M: la curva che la Fed guarda per la recessione
        v = s3[-1][1]
        indicators.append({"key": "curve3m", "label": "Curva 10A-3M", "value": f"{v:+.2f} pp",
                           "date": s3[-1][0], "impact": round(clamp(50 + v * 40))})
    except Exception as e:  # noqa: BLE001
        print(f"!! curve3m: {e}", file=sys.stderr)
    try:
        s30 = fred_series("DGS30", 1)
        v = s30[-1][1]
        # ⚠ IMPACT AL CONTRARIO degli altri: il 30 anni alto SCONTA i titoli a lunga duration.
        # Il neutro sta al 4%, e ogni punto in piu' toglie 25 punti d'impatto.
        indicators.append({"key": "t30", "label": "Treasury USA 30A", "value": f"{v:.2f}%",
                           "date": s30[-1][0], "impact": round(clamp(50 - (v - 4.0) * 25))})
    except Exception as e:  # noqa: BLE001
        print(f"!! t30: {e}", file=sys.stderr)
    try:
        sr = fred_series("DFII10", 1)            # TIPS 10A = tasso REALE, il costo del denaro al netto dell'inflazione
        v = sr[-1][1]
        indicators.append({"key": "real10", "label": "Tasso reale 10A (TIPS)", "value": f"{v:.2f}%",
                           "date": sr[-1][0], "impact": round(clamp(50 - (v - 1.0) * 25))})
    except Exception as e:  # noqa: BLE001
        print(f"!! real10: {e}", file=sys.stderr)
    try:
        sb = fred_series("T10YIE", 1)            # breakeven 10A = inflazione che il mercato SI ASPETTA
        v = sb[-1][1]
        indicators.append({"key": "breakeven", "label": "Inflazione attesa 10A (breakeven)",
                           "value": f"{v:.2f}%", "date": sb[-1][0],
                           "impact": round(clamp(100 - abs(v - 2) * 30))})
    except Exception as e:  # noqa: BLE001
        print(f"!! breakeven: {e}", file=sys.stderr)
    try:
        # ⚠ NON E' L'ISM, ED E' DETTO. L'ISM e' sotto licenza e non e' ridistribuibile: FRED lo
        # ha tolto nel 2016 e non esiste una fonte gratuita legittima. Il Philly Fed e' la stessa
        # specie di misura — indagine mensile sulla manifattura, diffusion index, pubblicata
        # PRIMA dell'ISM — e viene etichettata per quello che e'. Meglio un sostituto dichiarato
        # che un ISM inventato: e' la regola che vale per ogni altro dato di questo sistema.
        sp = fred_series("GACDFSA066MSFRBPHI", 1)
        v = sp[-1][1]
        indicators.append({"key": "philly", "label": "Manifattura Philly Fed (al posto dell'ISM)",
                           "value": f"{v:+.1f}", "date": sp[-1][0],
                           # ⚠ v271 — PENDENZA ABBASSATA, PERCHE' SATURAVA. Con 1.2 un +41,4
                           # dava 99,7 → 100, e il pacchetto lo presentava come l'indicatore
                           # PIU' FAVOREVOLE di trenta, a punteggio pieno: un'indagine di un
                           # solo distretto, vecchia di quaranta giorni, messa in cima a tutto.
                           # Un punteggio che tocca il tetto non distingue piu' "molto forte"
                           # da "fortissimo", ed e' li' che una scala smette di informare.
                           "impact": round(clamp(50 + v * 0.9))})
    except Exception as e:  # noqa: BLE001
        print(f"!! philly: {e}", file=sys.stderr)
    try:
        ch = fred_series("T10Y2Y", 520)          # ~2 anni giornalieri per il grafico storico
        macro["curve_history"] = [{"d": d, "v": v} for d, v in ch if v is not None]
    except Exception as e:  # noqa: BLE001
        print(f"!! curve_history: {e}", file=sys.stderr)

    # Analisi macro: curva dei rendimenti vs recessioni (dati storici FRED, ~35 anni)
    try:
        curve_m = fred_series("T10Y2Y", 360, freq="m")          # 10A-2A mensile
        gdp_q = fred_series("GDPC1", 150, freq="q")             # PIL reale trimestrale
        usrec_m = fred_series("USREC", 360, freq="m")           # indicatore recessione NBER (0/1)
        claims_m = fred_series("ICSA", 360, freq="m")           # sussidi disoccupazione (media mensile)
        # crescita PIL reale YoY (%)
        gdp_growth = []
        for i in range(4, len(gdp_q)):
            prev = gdp_q[i - 4][1]
            if prev:
                gdp_growth.append({"d": gdp_q[i][0], "v": round((gdp_q[i][1] / prev - 1) * 100, 2)})
        # periodi di recessione da USREC (mesi consecutivi con valore >= 0.5)
        recessions, start = [], None
        for d, v in usrec_m:
            if v >= 0.5 and start is None:
                start = d
            elif v < 0.5 and start is not None:
                recessions.append({"start": start, "end": d})
                start = None
        if start is not None:
            recessions.append({"start": start, "end": usrec_m[-1][0]})
        # UNIFICAZIONE LETTURA CURVA (v138): current_curve = ultimo valore GIORNALIERO T10Y2Y
        # (stesso numero di indicators/curve_history — prima qui c'era la MEDIA MENSILE e il
        # payload mostrava due valori diversi per la stessa grandezza, es. +0,41 vs +0,36).
        # La serie mensile resta SOLO per il modello storico shiftato (steepening/12m fa).
        try:
            cur_v = fred_series("T10Y2Y", 1)[-1][1]
        except Exception:  # noqa: BLE001 — fallback alla media mensile se il daily fallisce
            cur_v = curve_m[-1][1] if curve_m else None
        cur_m = curve_m[-1][1] if curve_m else None
        v12 = curve_m[-13][1] if len(curve_m) > 13 else None       # 12 mesi fa (media mensile)
        steepening = (cur_m is not None and v12 is not None and cur_m - v12 > 0.2)
        was_inverted = any(v < 0 for _, v in curve_m[-24:])         # invertita negli ultimi 2 anni
        # ⚠⚠ v306 — TRE SERIE LUNGHE TOLTE: NESSUNO LE DISEGNAVA. Misurato nella revisione:
        # `curve` (360 punti), `gdp_growth` (146) e `claims` (360) pesavano ~25KB in data.json
        # e non venivano rese da nessuna parte — `serieIndicatore("yield_recession")` legge
        # `macro.curve_history`, non queste. Peso spedito a ogni caricamento per niente, la
        # stessa classe del difetto trovato in v295 (due serie duplicate).
        # ⚠ GLI SCALARI RESTANO e sono nel pacchetto (curva attuale, PIL, richieste di
        # sussidio, l'etichetta): quelli servono, e toglierli sarebbe la pulizia che si porta
        # via il fatto — classe v201-v204, gia' pagata quattro volte qui.
        # ⚠ `claims` era l'unica serie di richieste di sussidio che avessimo: se un domani si
        # vuole disegnarla, si rimette QUESTA riga — non si reinventa la fonte.
        macro["yield_recession"] = {
            "recessions": recessions,
            "current_curve": round(cur_v, 2) if cur_v is not None else None,
            "curve_12m_ago": round(v12, 2) if v12 is not None else None,
            "steepening": steepening,
            "was_inverted_24m": was_inverted,
            "label": ("Irripidimento post-inversione — segnale storico di recessione entro 12 mesi"
                      if steepening and was_inverted else
                      "Curva in irripidimento" if steepening else
                      "Curva invertita — rischio recessione" if (cur_v is not None and cur_v < 0) else
                      "Curva normale"),
            "gdp_last": gdp_growth[-1]["v"] if gdp_growth else None,
            "claims_last": round(claims_m[-1][1]) if claims_m else None,
        }
    except Exception as e:  # noqa: BLE001
        print(f"!! yield_recession: {e}", file=sys.stderr)

    # Benchmarks Day % (per modulo Alpha & Benchmarking): S&P 500, Nasdaq 100, SOX
    try:
        bdays = {}
        for sym, key, fb in (("^GSPC", "sp500", None), ("^NDX", "ndx", None), ("^SOX", "sox", "SOXX")):
            hb = bench_close(sym, fb, period="5d")   # ^SOX flaky → fallback SOXX
            if hb is not None and len(hb) >= 2:
                bdays[key] = round((float(hb.iloc[-1]) / float(hb.iloc[-2]) - 1) * 100, 2)
        if bdays:
            macro["benchmarks"] = bdays
    except Exception as e:  # noqa: BLE001
        print(f"!! benchmarks: {e}", file=sys.stderr)

    # prossime pubblicazioni (cadenza tipica) + sentiment per i popup macro
    NEXT_RELEASE = {
        "cpi": "Mensile, ~metà mese (BLS) · l'inflazione bassa è positiva per i mercati",
        "pce": "Mensile, fine mese (BEA) · indicatore preferito dalla Fed",
        "gdp": "Trimestrale (BEA) · crescita >2% positiva",
        "retail": "Mensile, ~metà mese (Census) · consumi forti = economia solida",
        "nfp": "Primo venerdì del mese (BLS) · creazione posti di lavoro",
        "unemp": "Primo venerdì del mese (BLS) · disoccupazione bassa positiva",
        "umich": "Fine mese (UMich) · fiducia dei consumatori",
        "curve": "Giornaliero (FRED) · curva invertita = rischio recessione",
        "curve3m": "Giornaliero (FRED) · il tratto 10A-3M è quello che la Fed guarda per la recessione",
        "t30": "Giornaliero (FRED) · il 30 anni alto pesa sui titoli a lunga duration",
        "real10": "Giornaliero (FRED) · rendimento al netto dell'inflazione: è il vero costo del denaro",
        "breakeven": "Giornaliero (FRED) · l'inflazione che il mercato si aspetta a 10 anni",
        "philly": "Mensile, ~terza settimana (Philadelphia Fed) · sostituto dichiarato dell'ISM, che è sotto licenza",
    }
    # ⚠ v266 — UN INDICATORE SENZA CADENZA NON PARTE. Il CEO ha chiesto che ogni dato macro
    # porti quando è stato rilevato e quando si aggiorna, "affinché anche il prompt LLM capisca
    # la qualità temporale del dato e non lo interpreti come assoluto". Col .get(key, "") un
    # indicatore nuovo usciva con la cadenza VUOTA e nessuno se ne accorgeva: la regola valeva
    # solo per le serie già scritte. Ora la dimenticanza rompe il run invece di passare.
    orfani = [i["key"] for i in indicators if not NEXT_RELEASE.get(i["key"])]
    if orfani:
        raise RuntimeError(f"indicatori senza cadenza in NEXT_RELEASE: {orfani} — "
                           "ogni dato macro deve dire quando si aggiorna")
    for ind in indicators:
        ind["next_release"] = NEXT_RELEASE[ind["key"]]
    macro["indicators"] = indicators

    # Mercati di riferimento (BTC, WTI, KOSPI e Nasdaq sono in watchlist)
    markets = []
    for sym, label, fmt, decimals, suffix in [
        ("^TNX", "Treasury USA 10A", "{v:.2f}%", 2, " pp"),
        ("EURUSD=X", "EUR/USD", "{v:.4f}", 2, "%"),
        ("EURJPY=X", "EUR/JPY", "{v:.2f}", 2, "%"),
        # ⚠ v272 — RAME, PETROLIO, ORO E SOX SONO USCITI DA QUI. Il CEO: "elimina in macro
        # rame, petrolio, oro, sox perche' devono essere presenti in watchlist". Aveva
        # ragione due volte: adesso la pipeline segue la sua watchlist, quindi quei simboli
        # li scarica gia' di la' — tenerli anche qui significava scaricarli DUE VOLTE e
        # mostrarli in due posti, che e' il doppione che mi ha gia' fatto notare per il VIX.
    ]:
        try:
            h = yf.Ticker(sym).history(period="5d")["Close"].dropna()
            last, prev = float(h.iloc[-1]), float(h.iloc[-2])
            change = round(last - prev, 2) if suffix == " pp" else round((last / prev - 1) * 100, decimals)
            markets.append({"key": sym, "label": label,
                            "value": fmt.format(v=last),
                            "change_pct": change, "suffix": suffix})
        except Exception as e:  # noqa: BLE001
            print(f"!! mercato {sym}: {e}", file=sys.stderr)
    macro["markets"] = markets

    # ═══ v280 — MATERIE PRIME E SEMICONDUTTORI, COL LORO STORICO ═══════════════════════════
    # Richiesta del CEO, una per messaggio: "Semiconduttori (SOX) / rame / petrolio / oro
    # inserisci grafico storico nella tab macro".
    # ⚠ NON E' UN RITORNO INDIETRO rispetto a v272, dove li aveva fatti togliere. Allora erano
    # schede-NUMERO che duplicavano la sua watchlist ("devono essere presenti in watchlist");
    # oggi la watchlist non c'e' piu' (v275) e quello che chiede e' un'altra cosa: la SERIE nel
    # tempo. Un livello dice dov'e' il rame adesso, la curva dice se il ciclo industriale sta
    # girando — ed e' l'unica delle due che il suo broker non gli mostra accanto al prezzo.
    # ⚠ BLOCCO AUTOSUFFICIENTE, non agganciato alla watchlist: tre di questi simboli sono anche
    # in config/ui_watchlist.json e sarebbe stato piu' economico riusare quelle barre, ma allora
    # le schede macro sparirebbero il giorno in cui il CEO toglie un simbolo dalla sua lista.
    # Il quadro macro non deve dipendere da una preferenza di visualizzazione.
    materie = {}
    for chiave, sym, label, dec, unita in [
        ("sox", "^SOX", "Semiconduttori (SOX)", 0, ""),
        ("rame", "HG=F", "Rame", 3, "$/lb"),
        ("petrolio", "CL=F", "Petrolio WTI", 2, "$"),
        ("oro", "GC=F", "Oro", 0, "$/oz"),
    ]:
        try:
            h = yf.Ticker(sym).history(period="1y")["Close"].dropna()
            if len(h) < 30:
                print(f"!! materie {sym}: solo {len(h)} barre, salto", file=sys.stderr)
                continue
            # ⚠ si DIRADA a ~120 punti invece di spedirne 250: su una card larga 300px due punti
            # per pixel non si vedono, e pesano nel file che il browser scarica ogni volta.
            passo = max(1, len(h) // 120)
            storia = [{"d": d.strftime("%Y-%m-%d"), "v": round(float(v), dec if dec else 2)}
                      for d, v in list(h.items())[::passo]]
            if storia and storia[-1]["d"] != h.index[-1].strftime("%Y-%m-%d"):
                storia.append({"d": h.index[-1].strftime("%Y-%m-%d"), "v": round(float(h.iloc[-1]), dec if dec else 2)})
            ultimo, prec = float(h.iloc[-1]), float(h.iloc[-2])
            anno_min, anno_max = float(h.min()), float(h.max())
            materie[chiave] = {
                "symbol": sym, "label": label, "unita": unita,
                "value": round(ultimo, dec) if dec else round(ultimo),
                "change_pct": round((ultimo / prec - 1) * 100, 2),
                # ⚠⚠ v316 — QUESTO CAMPO SI CHIAMAVA "pct_1y" E IL COMMENTO DICEVA "posizione nel
                # range dell'anno", ma la formula calcola la VARIAZIONE a 1 anno. app.js la
                # stampava come "N° percentile dell'anno": l'oro a +31,3% in un anno veniva
                # pubblicato come "31° percentile", cioe' nel terzo BASSO del suo intervallo.
                # La lettura si INVERTE — e il semiconduttori usciva a "116° percentile", che non
                # esiste. Ora sono DUE campi con due nomi veri: la variazione e la posizione.
                "var_1y": round((ultimo / float(h.iloc[0]) - 1) * 100, 1),
                "pos_range_1y": (round((ultimo - anno_min) / (anno_max - anno_min) * 100, 1)
                                 if anno_max > anno_min else None),
                "min_1y": round(anno_min, dec) if dec else round(anno_min),
                "max_1y": round(anno_max, dec) if dec else round(anno_max),
                "history": storia,
            }
        except Exception as e:  # noqa: BLE001
            print(f"!! materie {sym}: {e}", file=sys.stderr)
    if materie:
        macro["materie"] = materie

    # v298 — ETF a dieci anni RIMOSSO su richiesta del CEO ("elimina: ETF a dieci anni").
    # Tolto anche da qui e non solo dalla pagina: 38KB in data.json che nessuno disegna
    # sono esattamente il peso morto trovato nella revisione v295. Se tornasse la scheda,
    # torna anche questo blocco — il codice sta nella storia di git, non in un commento.

    # ═══ v289 — LA CURVA DEI TASSI, DA OSSERVAZIONI PUBBLICATE ════════════════════════════
    # Il CEO: "ok ma non con dati presunti ma dati effettivi". Vincolo giusto e questo blocco lo
    # rispetta alla lettera: ogni punto e' un'OSSERVAZIONE pubblicata da FRED, con la sua data
    # vera. Niente interpolazioni, niente proiezioni, niente valori riempiti.
    # ⚠ E' l'opposto del calendario di v287, dove le date sono STIME e ogni riga lo dichiara.
    # Qui non c'e' niente da stimare: il rendimento del decennale del 12 agosto e' un numero
    # pubblicato il 12 agosto.
    #
    # ⚠ GLI ID SONO STATI VERIFICATI UNO PER UNO, non indovinati: `DGS02` — la forma che veniva
    # spontanea — restituisce HTTP 404, quello giusto e' `DGS2`. In questo progetto c'e' gia'
    # una regola su questo (v195: "un ID indovinato e scritto come se fosse certo sarebbe stato
    # peggio di un tentativo dichiarato"), e stavolta e' bastato provarli prima.
    #
    # ⚠ I BUCHI RESTANO BUCHI. Le serie giornaliere di FRED non hanno osservazioni nei giorni di
    # chiusura, e riempirli con l'ultimo valore disegnerebbe un tratto piatto che nessun mercato
    # ha fatto — cioe' un dato presunto travestito da dato. Si pubblica solo cio' che esiste.
    # ═══ v304 — NEWS MACRO: TRE FONTI, NON CINQUANTASETTE ═══════════════════════════════
    # Il CEO: "in Prossime due settimane aggiungi news inerenti tutti i dati macro (questa
    # finestra deve essere espandibile)". Le news c'erano e sono uscite in v269, ma il motivo
    # NON era che fossero inutili: erano ~57 richieste RSS a ogni run — una ventina di feed
    # fissi piu' uno per ogni titolo seguito — per riempire un blocco che nessuno apriva.
    # Qui sono TRE richieste e solo macro. Il costo che aveva fatto togliere la funzione non
    # si ripresenta.
    #
    # ⚠ SCELTE DI FONTE, MISURATE E NON PRESE DALL'ELENCO VECCHIO:
    #   · i due feed "economia/indicatori" di Investing NON espongono <pubDate>, e servono
    #     articoli vecchi (uno dava Bitcoin a 63.000). Una notizia senza data non si puo'
    #     pesare: esclusi.
    #   · Reddit e i forum restano VIETATI — la testata lo impone da quando un LLM marco'
    #     [VERIFICATO] medie mobili e target con fonte Reddit.
    #   · misurata la freschezza: Bloomberg 2h dall'ultima, CNBC finanza 5h, CNBC economia 19h
    #     (la macro esce meno spesso, non e' un difetto del feed), MarketWatch 12h.
    #
    # ⚠⚠ IL FILTRO E' UN REGISTRO DI PAROLE, quindi e' fallibile e va DICHIARATO: ogni voce
    # porta la fonte e l'ora, e la pagina scrive che sono titoli filtrati per parola chiave,
    # non una selezione redazionale. Un elenco che sembra curato quando e' automatico e' la
    # classe di difetto peggiore di questo progetto.
    # ⚠⚠ IL FILTRO LO FA LA FONTE, NON L'ELENCO DI PAROLE. Provate tre tarature: stretta,
    # scartava il PPI ("Wholesale prices were flat in July") e il deficit di bilancio; larga,
    # faceva passare "Modi Maps India's Growth Push" (per "growth") e un pezzo sulle detrazioni
    # fiscali (per "tax"). Un filtro a parole su un titolo di giornale non distingue la
    # "growth" di un'economia da quella di una societa': e' il limite dello strumento, non
    # della taratura. La strada giusta: CNBC Economia E' GIA' un feed di economia — la
    # selezione l'ha fatta una redazione, e si prende tutto. Bloomberg e MarketWatch sono
    # generalisti e passano dal filtro, che resta imperfetto e viene DICHIARATO in pagina.
    NEWS_FONTI = [
        ("CNBC Economia",  "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", False),
        ("Bloomberg",      "https://feeds.bloomberg.com/markets/news.rss", True),
        ("MarketWatch",    "https://feeds.content.dowjones.io/public/rss/mw_topstories", True),
    ]
    # ⚠⚠ TERMINI INTERI, NON SOTTOSTRINGHE, E NIENTE `split()` SU FRASI. La prima stesura
    # spezzava "bank of japan" in tre parole: "of" diventava un termine e, cercato come
    # sottostringa, faceva passare "Hollywood Box OFfices Are Back" come notizia macro.
    # Un filtro che accetta tutto non e' un filtro — ed e' peggio di nessun filtro, perche'
    # l'elenco SEMBRA curato. Ora i termini sono frasi intere e si cercano con i confini di
    # parola: "rate" non matcha "corporate", "fed" non matcha "federated".
    NEWS_TERMINI = [
        "inflation", "cpi", "pce", "ppi", "fed", "federal reserve", "rate", "rates", "yield",
        "yields", "treasury", "treasuries", "bond", "bonds", "jobs", "payroll", "payrolls",
        "unemployment", "gdp", "economy", "economic", "recession", "tariff", "tariffs",
        "trade deficit", "ecb", "boj", "bank of japan", "powell", "fomc", "rate cut",
        "rate hike", "consumer sentiment", "retail sales", "manufacturing", "ism", "pmi",
        "housing", "dollar", "jobless", "labor market", "central bank", "monetary policy",
        # ⚠ aggiunti dopo aver guardato COSA VENIVA SCARTATO: il filtro stretto buttava via
        # "Wholesale prices were flat in July" (che e' il PPI) e "U.S. budget deficit surged"
        # (che e' politica fiscale). Un filtro si tara sui falsi negativi, non solo sui falsi
        # positivi — e i falsi negativi si vedono solo se si stampa cio' che si e' scartato.
        "wholesale prices", "producer prices", "consumer prices", "budget deficit", "deficit",
        "wages", "wage growth", "spending", "stimulus", "tax", "tariffs on", "growth",
        "slowdown", "soft landing", "hard landing", "yield curve", "credit",
        "inflazione", "tassi", "disoccupazione", "recessione", "dazi", "bce",
    ]
    NEWS_RE = re.compile(r"\b(" + "|".join(re.escape(x) for x in NEWS_TERMINI) + r")\b", re.I)
    try:
        import email.utils as _eu
        news = []
        for fonte, url, filtra in NEWS_FONTI:
            try:
                r = http_get(url, timeout=15)
                testo = r.text
                for pezzo in re.findall(r"<item>(.*?)</item>", testo, re.S)[:30]:
                    tm = re.search(r"<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", pezzo, re.S)
                    # ⚠ v306 — il RIASSUNTO: il CEO lo ha chiesto ("inserisci qualche riga
                    # riassuntiva"). Sta nella <description> del feed e c'e' quasi sempre
                    # (misurato: 92-329 caratteri). Dove manca, la riga resta il solo titolo:
                    # meglio un titolo nudo che un riassunto inventato.
                    de = re.search(r"<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</description>", pezzo, re.S)
                    lm = re.search(r"<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</link>", pezzo, re.S)
                    dm = re.search(r"<pubDate>(.*?)</pubDate>", pezzo, re.S)
                    if not tm or not dm:
                        continue                      # senza data non entra: non si puo' pesare
                    titolo = re.sub(r"<[^>]+>", "", html.unescape(tm.group(1))).strip()
                    if not titolo or len(titolo) < 12:
                        continue
                    if filtra and not NEWS_RE.search(titolo):
                        continue                      # filtro per parola: dichiarato in pagina
                    try:
                        quando = _eu.parsedate_to_datetime(dm.group(1)).astimezone(timezone.utc)
                    except Exception:  # noqa: BLE001
                        continue
                    rias = ""
                    if de:
                        rias = re.sub(r"<[^>]+>", "", html.unescape(de.group(1))).strip()[:320]
                        if rias.lower() == titolo.lower():
                            rias = ""          # ripetere il titolo non e' un riassunto
                    news.append({"titolo": titolo[:180], "riassunto": rias, "fonte": fonte,
                                 "quando": quando.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                 "url": (lm.group(1).strip() if lm else "")[:400]})
            except Exception as e:  # noqa: BLE001
                print(f"!! news {fonte}: {e}", file=sys.stderr)
        # piu' recenti in cima, senza doppioni di titolo
        visti, puliti = set(), []
        for n in sorted(news, key=lambda x: x["quando"], reverse=True):
            k = n["titolo"].lower()[:60]
            if k in visti:
                continue
            visti.add(k)
            puliti.append(n)
        if puliti:
            macro["news"] = {
                "voci": puliti[:18],
                "fonti": [f for f, _, _ in NEWS_FONTI],
                "filtro": ("CNBC Economia entra per intero (e' gia' un feed di economia); "
                           "Bloomberg e MarketWatch passano da un filtro per termine macro, "
                           "imperfetto per costruzione"),
            }
            print(f"   news macro: {len(puliti[:18])} voci da {len(NEWS_FONTI)} fonti")
    except Exception as e:  # noqa: BLE001
        print(f"!! news macro: {e}", file=sys.stderr)

    # ═══ v390 — LE DATE DELLE TRIMESTRALI, DAL DEPOSITO E NON DA UNA STIMA ═══════════════
    # Il pacchetto pubblica `earnings_date` di yfinance dichiarandolo — correttamente — una
    # STIMA. Ma su quella stima si regge la regola piu' operativa della disciplina di rischio:
    # "quanta parte del libro riprezza nella stessa finestra di tre settimane". Una regola
    # costruita su date stimate e' una regola che si sposta da sola.
    #
    # SEC EDGAR pubblica il FATTO: l'8-K con item 2.02 ("Results of Operations and Financial
    # Condition") e' il deposito con cui la societa' comunica i risultati, e ha una data vera.
    # Gratis, senza chiave, con il solo obbligo di dichiarare uno User-Agent identificabile.
    #
    # ⚠ COSA SI PUBBLICA E COSA NO. Il deposito passato e' un fatto e si pubblica sempre. La
    # data FUTURA non esiste in EDGAR: si ricava dalla cadenza dei depositi precedenti, ed e'
    # una SECONDA STIMA, indipendente da quella di yfinance. Averne due che concordano vale
    # piu' di una sola; averne due che divergono e' informazione a sua volta.
    # ⚠⚠ E LA CADENZA SI PUBBLICA SOLO SE E' PLAUSIBILMENTE TRIMESTRALE (80-100 giorni).
    # Misurato su MSTR: deposita 8-K con item 2.02 anche FUORI dal ciclo trimestrale
    # (2025-10-06, 2025-07-07), e la mediana degli scarti crolla a 67 giorni producendo
    # un'attesa sbagliata di 24 giorni. Un numero che sembra una misura e non lo e' e' peggio
    # di nessun numero (v199): fuori banda si pubblica il deposito e si tace sull'attesa.
    # ⚠ GLI EMITTENTI ESTERI NON HANNO 8-K: SK hynix e TSMC depositano 6-K e 20-F, che non
    # hanno gli "items". Per loro EDGAR non risponde alla domanda, e va DICHIARATO invece di
    # lasciare una riga vuota che si legge come "nessuna trimestrale".
    try:
        import statistics as _st
        SEC_UA = {"User-Agent": "Trading-Dashboard/1.0 (biagio.garofalo@siigep.tech)"}
        _r = requests.get("https://www.sec.gov/files/company_tickers.json",
                          headers=SEC_UA, timeout=25)
        _r.raise_for_status()
        _mappa = {v["ticker"].upper(): v["cik_str"] for v in _r.json().values()}
        sec_cal, senza_cik, esteri = {}, [], []
        # la lista viene dalla stessa fonte della pipeline (config/ui_watchlist.json), non
        # da un elenco scritto a mano che invecchierebbe da solo: un titolo nuovo entra qui
        # senza che nessuno se ne ricordi. Indici, cambi e future non sono societa' e finiscono
        # in `senza_cik`, che e' un esito dichiarato e non un buco.
        _, _wl_sec, _ = load_holdings()
        _seguiti = {str(x.get("ticker", "")).upper() for x in _wl_sec}
        _seguiti = {t for t in _seguiti
                    if t and not t.startswith("^") and not t.endswith(("=F", "=X", "-USD"))}
        for _tk in sorted(_seguiti):
            _cik = _mappa.get(_tk)
            if not _cik:
                senza_cik.append(_tk)
                continue
            try:
                _s = requests.get(f"https://data.sec.gov/submissions/CIK{_cik:010d}.json",
                                  headers=SEC_UA, timeout=25)
                _s.raise_for_status()
                _rec = _s.json().get("filings", {}).get("recent", {})
                _forme = _rec.get("form", [])
                _items = _rec.get("items", [""] * len(_forme))
                _dep = [d for f, d, it in zip(_forme, _rec.get("filingDate", []), _items)
                        if f == "8-K" and "2.02" in (it or "")]
                if not _dep:
                    esteri.append(_tk)
                    continue
                voce = {"ultimo_deposito": _dep[0], "n_depositi": len(_dep)}
                if len(_dep) >= 4:
                    _ds = [datetime.strptime(x, "%Y-%m-%d").date() for x in _dep[:8]]
                    _gap = [(_ds[i] - _ds[i + 1]).days for i in range(len(_ds) - 1)]
                    _cad = int(_st.median(_gap))
                    # solo una cadenza plausibilmente trimestrale autorizza una previsione
                    if 80 <= _cad <= 100:
                        voce["cadenza_gg"] = _cad
                        voce["attesa_da_cadenza"] = (_ds[0] + timedelta(days=_cad)).isoformat()
                    else:
                        voce["cadenza_irregolare_gg"] = _cad
                sec_cal[_tk] = voce
            except Exception as e:  # noqa: BLE001
                print(f"!! SEC EDGAR {_tk}: {e}", file=sys.stderr)
            time.sleep(0.12)          # SEC chiede meno di 10 richieste al secondo
        if sec_cal or esteri:
            macro["sec_calendario"] = {
                "per_titolo": sec_cal,
                "senza_8k": esteri,          # emittenti esteri: 6-K/20-F, nessun item 2.02
                "senza_cik": senza_cik,      # indici, cambi, materie prime: non sono societa'
                "fonte": "SEC EDGAR, 8-K con item 2.02 (Results of Operations)",
            }
            print(f"   SEC EDGAR: {len(sec_cal)} titoli con deposito trimestrale, "
                  f"{len(esteri)} emittenti senza 8-K")
    except Exception as e:  # noqa: BLE001
        print(f"!! SEC EDGAR: {e}", file=sys.stderr)

    # ═══ v309 — STAGIONALITA' DEL NASDAQ 100 E CICLO ELETTORALE ═════════════════════════
    # Il CEO: "reinserisci scheda macro per stagionalita' mensile nasdaq100 e se puoi aggiungi
    # anche variabile in concomitanza di elezioni midterm (valuta tu come strutturarlo)".
    # STRUTTURA SCELTA: due serie sullo stesso asse dei dodici mesi — la media di TUTTI gli
    # anni e quella dei soli anni di MIDTERM — piu' la dispersione (peggiore e migliore) e la
    # percentuale di mesi positivi. Il confronto e' il punto: da solo "ottobre +1,7%" non dice
    # niente, "ottobre +1,7% su tutti gli anni ma +3,9% negli anni di midterm, 80% positivi"
    # dice qualcosa di specifico su QUESTO anno.
    #
    # ⚠⚠ IL CAMPIONE E' DIECI ANNI E VA GRIDATO, NON SCRITTO IN NOTA. Dieci osservazioni per
    # mese sono pochissime: la dispersione di ottobre va da -8,7% a +18,9%, cioe' la media
    # +3,9% e' una media fra esiti opposti. Questo progetto ha gia' tolto un motore predittivo
    # con SETTE segnali maturati (v200, hit-rate 29%): una statistica su dieci casi si pubblica
    # con la sua incertezza accanto o non si pubblica.
    # ⚠ L'ANNO IN CORSO E' ESCLUSO dal campione storico: usare il 2026 per descrivere il 2026
    # sarebbe circolare. Il ciclo si conta cosi': anno 1 = post-elezione, anno 2 = MIDTERM,
    # anno 3 = pre-elezione, anno 4 = elezione presidenziale. Il 2026 e' un anno 2.
    try:
        ndx = yf.Ticker("^NDX").history(period="max", interval="1mo", auto_adjust=True)["Close"].dropna()
        if len(ndx) > 120:
            rend = ndx.pct_change().dropna() * 100
            anno_ora = datetime.now(timezone.utc).year
            per_mese = {m: {"tutti": [], "midterm": []} for m in range(1, 13)}
            for ts, v in rend.items():
                if ts.year >= anno_ora:
                    continue                      # l'anno in corso non descrive se stesso
                per_mese[ts.month]["tutti"].append(float(v))
                if ((ts.year - 1) % 4) + 1 == 2:  # anno di midterm
                    per_mese[ts.month]["midterm"].append(float(v))
            mesi = []
            for m in range(1, 13):
                t, mid = per_mese[m]["tutti"], per_mese[m]["midterm"]
                if not t:
                    continue
                voce = {"mese": m, "media": round(sum(t) / len(t), 2), "n": len(t)}
                if len(mid) >= 5:                 # sotto cinque osservazioni non si pubblica una media
                    voce.update({
                        "media_mid": round(sum(mid) / len(mid), 2),
                        "n_mid": len(mid),
                        "pos_mid": round(sum(1 for x in mid if x > 0) / len(mid) * 100),
                        "peggio_mid": round(min(mid), 1),
                        "meglio_mid": round(max(mid), 1),
                    })
                mesi.append(voce)
            anni_mid = sorted({ts.year for ts in rend.index
                               if ts.year < anno_ora and ((ts.year - 1) % 4) + 1 == 2})
            macro["stagionalita_ndx"] = {
                "mesi": mesi,
                "dal": int(rend.index[0].year), "al": anno_ora - 1,
                "anni_midterm": anni_mid,
                "ciclo_ora": ((anno_ora - 1) % 4) + 1,
                "mese_ora": datetime.now(timezone.utc).month,
                "fonte": "^NDX, barre mensili (yfinance, auto_adjust)",
            }
            print(f"   stagionalita' NDX: {len(mesi)} mesi, {len(anni_mid)} anni di midterm nel campione")
    except Exception as e:  # noqa: BLE001
        print(f"!! stagionalita' NDX: {e}", file=sys.stderr)

    # ═══ v292 — LO STORICO DEI 13 INDICATORI: LA TRAIETTORIA, NON SOLO IL PUNTO ═══════════
    # Il CEO: "possiamo ottenere i dati macro con la stessa logica del VIX nel box TradingView?".
    # Da TradingView no — misurato: i simboli ECONOMICS:* (USIRYY, USNFP, USUR, USGDPQQ, USCCI,
    # USRSMM) rispondono tutti "disponibile solo su TradingView", col VIX che rende nella stessa
    # pagina come controllo. Ma la FORMA si puo' dare lo stesso, con i nostri dati, e questa e'
    # la parte che mancava: le schede macro cadevano sulla "scala con le zone" di v272 non per
    # scelta grafica, ma perche' NON C'ERA UNA SERIE — un solo valore non fa una linea.
    #
    # ⚠⚠ IL GRAFICO DEVE MOSTRARE LA STESSA GRANDEZZA DEL TITOLO. Se la scheda dice "CPI 3,5%
    # a/a", la linea dev'essere l'a/a: disegnare l'indice CPIAUCSL (che sale da sempre, per
    # costruzione) sotto un titolo che parla di variazione annua e' un grafico che dice il falso
    # senza rompersi — la classe di difetto v205, gia' costata una volta. Percio' ogni serie
    # porta la SUA trasformazione, la stessa che produce il numero in evidenza.
    #
    # ⚠ I punti sono OSSERVAZIONI pubblicate, come per la curva dei tassi: niente riempimenti,
    # niente interpolazioni. Dove la fonte non ha pubblicato, non c'e' punto.
    STORICO_IND = [
        # chiave     serie FRED               trasformazione  quanti punti
        ("cpi",      "CPIAUCNS",              "yoy",          60),   # grezza: lo storico segue il valore
        ("pce",      "PCEPI",                 "yoy",          60),
        ("gdp",      "A191RL1Q225SBEA",       "diretta",      24),
        ("retail",   "RSAFS",                 "mom",          60),
        ("nfp",      "PAYEMS",                "delta_k",      60),
        ("unemp",    "UNRATE",                "diretta",      60),
        ("umich",    "PRIMARIA:umich",        "diretta",      60),   # v292 — vedi nota sotto
        ("philly",   "GACDFSA066MSFRBPHI",    "diretta",      60),
        # ⚠ v295 — `curve` e `t30` NON prendono lo storico qui, ed e' un difetto che ho
        # introdotto io in v292: quelle due serie il file le aveva GIA'.
        #   · 10A-2A → `macro.curve_history` (501 punti), che `serieIndicatore` legge da un
        #     `case` dedicato: il mio storico non veniva nemmeno disegnato, era peso morto puro.
        #   · 30 anni → `macro.tassi.storico.a30` (369 punti), messo li' da v289.
        # Erano ~14KB spediti a ogni caricamento per niente, e — peggio del peso — due copie
        # della stessa serie che possono divergere quando una delle due fonti cambia finestra.
        # Prima di aggiungere una serie: cercare se il file ce l'ha gia'.
        ("curve3m",  "T10Y3M",                "diretta",     250),
        ("real10",   "DFII10",                "diretta",     250),
        ("breakeven","T10YIE",                "diretta",     250),
    ]
    per_chiave = {i.get("key"): i for i in indicators}
    for chiave, sid, modo, quanti in STORICO_IND:
        ind = per_chiave.get(chiave)
        if not ind:
            continue
        try:
            # yoy serve 12 osservazioni in piu', mom e delta ne servono 1: si chiede il margine
            extra = 13 if modo == "yoy" else (2 if modo in ("mom", "delta_k") else 1)
            # ⚠⚠ UMICH VIENE DALLA FONTE PRIMARIA, NON DA FRED, E LO STORICO DEVE SEGUIRLO.
            # FRED distribuisce UMCSENT con 1-2 mesi di RITARDO DI LICENZA — cosa che questa
            # pipeline sapeva gia' (vedi `umich_series`) ma solo per il valore in evidenza.
            # Misurato oggi: la pagina mostra 55,2 di luglio dalla fonte primaria, FRED e' fermo
            # a 49,5 di giugno. Attaccare lo storico FRED sotto quel titolo avrebbe disegnato una
            # DISCESA sotto un numero che dice risalita: non un ritardo, una contraddizione — ed
            # e' testualmente il caso che il commento di `umich_series` chiama "peggio di un dato
            # dichiarato mancante". La regola generale: lo storico esce dalla STESSA fonte del
            # valore, altrimenti la punta del grafico smentisce il titolo.
            if sid.startswith("PRIMARIA:"):
                s = umich_series(quanti + extra)
            else:
                s = fred_series(sid, quanti + extra)
            if not s or len(s) < 3:
                continue
            punti = []
            if modo == "diretta":
                punti = [{"d": d, "v": round(float(v), 2)} for d, v in s]
            # ⚠⚠ v393 — ANCHE QUI L'AGGANCIO E' PER DATA, NON PER POSIZIONE. Lo storico
            # soffriva dello stesso difetto del valore in evidenza (vedi `_var_per_data`): con
            # ottobre 2025 assente da CPIAUCSL, `s[i - 12]` cadeva un mese troppo indietro e
            # NOVE punti consecutivi da novembre 2025 uscivano gonfiati — il grafico sotto la
            # scheda dell'inflazione raccontava una storia che i dati non contengono.
            # ⚠ Dove la base esatta manca il punto NON si disegna: un buco non e' uno zero e
            # non e' nemmeno un valore approssimato (v205). Meglio una linea interrotta di una
            # linea continua che passa per un punto mai osservato.
            elif modo in ("yoy", "mom", "delta_k"):
                indietro = 12 if modo == "yoy" else 1
                per_data = {d: float(v) for d, v in s}
                for d, v in s:
                    prima = per_data.get(_mese_meno(d, indietro))
                    if prima is None:
                        continue
                    if modo == "delta_k":
                        # PAYEMS e' in migliaia di occupati: la variazione mensile E' il dato citato
                        punti.append({"d": d, "v": round(float(v) - prima)})
                    elif prima:
                        punti.append({"d": d, "v": round((float(v) / prima - 1) * 100, 2)})
            if len(punti) >= 3:
                ind["storico"] = punti[-quanti:]
                ind["storico_serie"] = ("sca.isr.umich.edu (fonte primaria)"
                                        if sid.startswith("PRIMARIA:") else sid)
        except Exception as e:  # noqa: BLE001
            print(f"!! storico {chiave} ({sid}): {e}", file=sys.stderr)
    quanti_ok = sum(1 for i in indicators if i.get("storico"))
    print(f"   storico indicatori: {quanti_ok}/{len(indicators)} con serie")

    TASSI_FRED = [
        ("m3",  "DGS3MO", "3 mesi",   0.25),
        ("a2",  "DGS2",   "2 anni",   2),
        ("a5",  "DGS5",   "5 anni",   5),
        ("a10", "DGS10",  "10 anni",  10),
        ("a30", "DGS30",  "30 anni",  30),
    ]
    tassi = {"scadenze": [], "storico": {}, "fonte": "FRED (Federal Reserve Bank of St. Louis)"}
    for chiave, sid, etichetta, anni in TASSI_FRED:
        try:
            s = fred_series(sid, 380)
            if not s:
                continue
            # la CURVA DI OGGI e quella di tre mesi fa: due fotografie vere, non una tendenza
            # ricostruita. Il confronto dice se la curva si e' irripidita o appiattita, ed e'
            # la lettura che un livello da solo non da'.
            ultimo_d, ultimo_v = s[-1]
            prima = next((x for x in reversed(s[:-1])
                          if (datetime.strptime(ultimo_d, "%Y-%m-%d")
                              - datetime.strptime(x[0], "%Y-%m-%d")).days >= 90), None)
            tassi["scadenze"].append({
                "key": chiave, "series_id": sid, "label": etichetta, "anni": anni,
                "value": round(float(ultimo_v), 2),
                "observation_date": ultimo_d,
                "value_3m": round(float(prima[1]), 2) if prima else None,
                "observation_date_3m": prima[0] if prima else None,
            })
            # storico solo per i tre tenori che la pagina gia' cita: 380 punti × 5 serie
            # peserebbero senza aggiungere lettura.
            if chiave in ("a2", "a10", "a30"):
                tassi["storico"][chiave] = [{"d": d, "v": round(float(v), 2)} for d, v in s]
        except Exception as e:  # noqa: BLE001
            print(f"!! tassi {sid}: {e}", file=sys.stderr)
    if tassi["scadenze"]:
        macro["tassi"] = tassi

    # Carry trade USA-Giappone (differenziale rendimenti 10 anni + trend USD/JPY)
    try:
        us10 = float(yf.Ticker("^TNX").fast_info.last_price)
        jp10 = jgb10_yield()
        hj = yf.Ticker("JPY=X").history(period="1mo")["Close"].dropna()
        usdjpy = float(hj.iloc[-1])
        usdjpy_chg_1m = round((usdjpy / float(hj.iloc[0]) - 1) * 100, 2)
        spread = round(us10 - float(jp10), 2)
        # prossime riunioni Bank of Japan (calendario ufficiale 2026; date = 2° giorno = annuncio decisione)
        boj = [d for d in ("2026-01-23", "2026-03-19", "2026-04-28", "2026-06-16",
                           "2026-07-31", "2026-09-18", "2026-10-29", "2026-12-18",
                           # 2027 (stimate sul calendario tipico BoJ, da confermare)
                           "2027-01-22", "2027-03-18", "2027-04-28", "2027-06-17")
               if d >= datetime.now(timezone.utc).strftime("%Y-%m-%d")][:4]
        # tasso BoJ (overnight call rate) via FRED
        boj_rate_val = None
        boj_rate_date = None
        try:
            # ⚠⚠ v329 — IL VALORE VENIVA PUBBLICATO SENZA LA SUA DATA, e `fred_series` la
            # restituisce: `boj_r[-1][0]`. Senza quella, una serie che la fonte ha smesso di
            # aggiornare continua a produrre un numero che sembra di oggi — e questa e' l'unica
            # riga del pacchetto che parla di unwind del carry. Ora la data viaggia col valore,
            # e oltre i 120 giorni il valore NON si pubblica: un tasso di politica monetaria
            # vecchio di mesi non e' un dato vecchio, e' un dato sbagliato.
            boj_r = fred_series("IRSTCB01JPM156N", 1)
            if boj_r:
                boj_rate_date = boj_r[-1][0]
                eta_g = (datetime.now(timezone.utc).date()
                         - datetime.strptime(boj_rate_date, "%Y-%m-%d").date()).days
                if eta_g <= 120:
                    boj_rate_val = round(boj_r[-1][1], 2)
                else:
                    print(f"!! tasso BoJ scartato: osservazione del {boj_rate_date}, {eta_g} giorni fa",
                          file=sys.stderr)
        except Exception:
            pass
        macro["carry"] = {
            "us10": round(us10, 2), "jp10": round(float(jp10), 2), "spread": spread,
            "usdjpy": round(usdjpy, 2), "usdjpy_chg_1m": usdjpy_chg_1m,
            "boj_rate": boj_rate_val, "boj_rate_date": boj_rate_date,
            "boj_meetings": boj,
            "note": ("Spread ampio e yen debole: carry trade USD/JPY favorevole (capitali verso il dollaro). "
                     "Un rialzo dei tassi BoJ o un rafforzamento dello yen può innescare l'unwind del carry, "
                     "con vendite sui mercati azionari globali." if spread >= 2.5 else
                     "Spread in compressione: il carry trade USD/JPY è meno conveniente; "
                     "attenzione a possibili rientri di capitali verso lo yen."),
        }
    except Exception as e:  # noqa: BLE001
        print(f"!! carry: {e}", file=sys.stderr)

    # Put/Call ratio (volumi sulle prime due scadenze)
    try:
        sym, pc_name = PUTCALL_SYMBOL
        b = yf.Ticker(sym)
        puts = calls = 0
        for exp in b.options[:2]:
            ch = b.option_chain(exp)
            puts += int(ch.puts["volume"].fillna(0).sum())
            calls += int(ch.calls["volume"].fillna(0).sum())
        if puts + calls > 0:
            macro["putcall"] = {
                "symbol": sym, "name": pc_name,
                "ratio": round(puts / max(calls, 1), 2),
                "puts": puts, "calls": calls,
            }
    except Exception as e:  # noqa: BLE001
        print(f"!! putcall: {e}", file=sys.stderr)

    # Sentiment globale risk-on / risk-off (composito 0-100, 100 = risk-on)
    comps = []
    fg_score = macro.get("fear_greed", {}).get("score")
    if fg_score is not None:
        comps.append(("Fear & Greed", fg_score, .35))
    vix_v = macro.get("vix", {}).get("value")
    if vix_v:
        comps.append(("VIX", clamp((35 - vix_v) / 23 * 100), .25))
    pc_r = macro.get("putcall", {}).get("ratio")
    if pc_r:
        comps.append(("Put/Call", clamp((1.3 - pc_r) / 0.6 * 100), .15))
    try:
        hb = yf.Ticker("BTC-USD").history(period="5d")["Close"].dropna()
        btc_chg = (float(hb.iloc[-1]) / float(hb.iloc[-2]) - 1) * 100
        comps.append(("Bitcoin", clamp(50 + btc_chg * 10), .10))
    except Exception as e:  # noqa: BLE001
        print(f"!! risk btc: {e}", file=sys.stderr)
    tnx = next((m for m in markets if m["key"] == "^TNX"), None)
    if tnx:
        comps.append(("Treasury 10A", clamp(50 - tnx["change_pct"] * 300), .15))
    if comps:
        tot_w = sum(w for _, _, w in comps)
        score = round(sum(s * w for _, s, w in comps) / tot_w)
        macro["risk_sentiment"] = {
            "score": score,
            "label": "Risk-On" if score >= 60 else "Risk-Off" if score <= 40 else "Neutrale",
            "components": [{"label": l, "score": round(s)} for l, s, _ in comps],
        }

    # Buffett Indicator (capitalizzazione totale USA / PIL)
    try:
        w5000 = float(yf.Ticker("^W5000").history(period="5d")["Close"].dropna().iloc[-1])  # ~ market cap in $B
        gdp = fred_series("GDP", 1)[-1][1]                                                   # PIL annualizzato $B
        ratio = round(w5000 / gdp * 100, 1)
        macro["buffett"] = {
            "ratio": ratio,
            "score": round(clamp(100 - (ratio - 75) / 1.5)),   # alto = sopravvalutato = rosso
            "label": "Sopravvalutato" if ratio >= 150 else "Sottovalutato" if ratio <= 90 else "Equo",
        }
    except Exception as e:  # noqa: BLE001
        print(f"!! buffett: {e}", file=sys.stderr)

    macro["signposts"] = fetch_signposts()
    macro["tilt"] = fetch_sector_tilt()
    macro["witching"] = quadruple_witching()

    # Rischio Credito: ICE BofA US High Yield OAS (BAMLH0A0HYM2) — proxy CDS gratuito
    try:
        hy = fred_series("BAMLH0A0HYM2", 260)   # ~1 anno giornaliero
        hy_val = hy[-1][1]
        # OAS HY: <4% = normale, 4-5% = attenzione, 5-7% = stress, >9% = crisi
        # ⚠⚠ v323 — L'ANCORA ERA INVENTATA: 2,5-11,5% e' la scala di una crisi conclamata, e a
        # HY 6,5% — che la legenda stampata accanto chiama "stress" — dava 56/100, cioe'
        # "favorevole" nella scala dei punteggi. Il numero contraddiceva la sua didascalia.
        # Ora si usano le BANDE DICHIARATE, le stesse che il payload stampa sulla riga.
        hy_score = round(_punteggio_da_bande(hy_val, BANDE_HY_OAS))
        macro["credit"] = {
            "spread_hy": round(hy_val, 2),
            "score": hy_score,
            "label": "Crisi" if hy_val > 9 else "Stress elevato" if hy_val > 7 else
                     "Attenzione" if hy_val > 5 else "Normale",
            "date": hy[-1][0],
            "history": [{"d": d, "v": round(v, 2)} for d, v in hy if v is not None],
        }
    except Exception as e:  # noqa: BLE001
        print(f"!! credit: {e}", file=sys.stderr)

    # ═══ v390 — CHI PRESTA, NON SOLO QUANTO COSTA ══════════════════════════════════════
    # Il canale credito e' quello che colpisce PRIMA le partecipate che non si autofinanziano,
    # e fino a qui il sistema lo misurava con il solo spread high yield. Uno spread e' un
    # PREZZO: dice quanto il mercato chiede per prestare, non se le banche stiano prestando.
    # Sono due domande diverse, e nel 2008 e nel 2023 hanno risposto in tempi diversi.
    #
    # DRTSCILM (SLOOS, Senior Loan Officer Opinion Survey): la percentuale NETTA di banche che
    # ha IRRIGIDITO gli standard sui prestiti alle grandi imprese. Trimestrale, dalla Fed.
    # Sopra zero = piu' banche stringono che allentano.
    # NFCI (Chicago Fed National Financial Conditions Index): condizioni finanziarie
    # complessive, settimanale. Zero = media storica; sopra zero = piu' rigide della media.
    #
    # ⚠ Sono INDAGINI e INDICI COMPOSITI, non prezzi: escono con ritardo (SLOOS anche di due
    # mesi) e la riga porta la propria data, come tutte le statistiche ufficiali.
    # ⚠ Il segno di SLOOS non e' intuitivo e va scritto: un valore NEGATIVO significa che le
    # banche stanno ALLENTANDO, cioe' e' la lettura favorevole. Pubblicare "-8,3" senza dirlo
    # e' la classe di difetto del percentile invertito (v316).
    try:
        _sl = fred_series("DRTSCILM", 20)
        _nf = fred_series("NFCI", 60)
        if _sl or _nf:
            macro["credito_banche"] = {}
            if _sl:
                macro["credito_banche"]["sloos"] = {
                    "valore": round(_sl[-1][1], 1), "data": _sl[-1][0],
                    "precedente": round(_sl[-2][1], 1) if len(_sl) > 1 else None,
                    "serie": "DRTSCILM",
                    "storia": [{"d": d, "v": round(v, 1)} for d, v in _sl],
                }
            if _nf:
                macro["credito_banche"]["nfci"] = {
                    "valore": round(_nf[-1][1], 2), "data": _nf[-1][0],
                    "mese_fa": round(_nf[-5][1], 2) if len(_nf) > 5 else None,
                    "serie": "NFCI",
                    "storia": [{"d": d, "v": round(v, 2)} for d, v in _nf],
                }
            print(f"   credito banche: SLOOS {'ok' if _sl else 'ko'}, NFCI {'ok' if _nf else 'ko'}")
    except Exception as e:  # noqa: BLE001
        print(f"!! credito banche (SLOOS/NFCI): {e}", file=sys.stderr)

    # ═══ v390 — I TASSI IN EURO, CHE IL SISTEMA NON HA MAI AVUTO ═══════════════════════
    # Il quadro macro e' interamente americano, ma il CEO tiene un BTP da 40.000 euro nominali
    # e vive in euro: il costo del denaro che lo riguarda per quella posizione — e il cambio con
    # cui ogni utile in dollari torna a casa — non erano nel sistema.
    # Fonte: BCE Data Portal (data-api.ecb.europa.eu), pubblica e senza chiave.
    # ⚠ Il tasso sulle operazioni di rifinanziamento principali (MRR_FR) e' il tasso di
    # POLITICA, non il rendimento del BTP: sono due cose diverse e la riga lo dice. Il
    # rendimento del BTP il sistema lo ha gia' dal prezzo di Borsa Italiana.
    try:
        _r = http_get("https://data-api.ecb.europa.eu/service/data/FM/"
                      "D.U2.EUR.4F.KR.MRR_FR.LEV?lastNObservations=1&format=csvdata")
        _righe = [l for l in _r.text.strip().splitlines() if l]
        _intest = _righe[0].split(",")
        _iT, _iV = _intest.index("TIME_PERIOD"), _intest.index("OBS_VALUE")
        _c = _righe[-1].split(",")
        macro["bce"] = {"tasso_rifinanziamento": float(_c[_iV]), "data": _c[_iT],
                        "fonte": "BCE Data Portal, serie FM.D.U2.EUR.4F.KR.MRR_FR.LEV"}
        print(f"   BCE: tasso rifinanziamento {macro['bce']['tasso_rifinanziamento']}% "
              f"al {macro['bce']['data']}")
    except Exception as e:  # noqa: BLE001
        print(f"!! BCE: {e}", file=sys.stderr)

    # Rischio Sistemico & Stress del Credito (CDS proxy): HY OAS + IG OAS + variazione 1 mese +
    # indice di stress finanziario St. Louis Fed. Il credito anticipa l'azionario → allarme preventivo.
    try:
        hy_h = fred_series("BAMLH0A0HYM2", 30)        # HY OAS ~1 mese
        ig_h = fred_series("BAMLC0A0CM", 30)          # IG OAS (corporate investment grade) ~1 mese
        hy_now = hy_h[-1][1] if hy_h else None
        hy_1m = hy_h[0][1] if hy_h else None
        ig_now = ig_h[-1][1] if ig_h else None
        ig_1m = ig_h[0][1] if ig_h else None
        hy_chg = round((hy_now / hy_1m - 1) * 100, 1) if hy_now and hy_1m else None   # % MoM
        ig_chg = round((ig_now / ig_1m - 1) * 100, 1) if ig_now and ig_1m else None
        stl = None
        try:
            stl_d = fred_series("STLFSI4", 5)
            stl = round(stl_d[-1][1], 2) if stl_d else None
        except Exception:  # noqa: BLE001
            pass
        rising = hy_chg is not None and hy_chg > 8        # +8% MoM = brusco allargamento
        easing = hy_chg is not None and hy_chg < -8
        status = ("Credit Stress in Aumento — Rischio Risk-Off" if rising else
                  "Credit Stress elevato" if (hy_now and hy_now > 6) else
                  "Mercato del Credito Rilassato" if (easing or (hy_now and hy_now < 4)) else
                  "Mercato del Credito Stabile")
        # score 0-100 (100 = favorevole: spread bassi e in calo). Penalizza l'allargamento.
        sc = _punteggio_da_bande(hy_now, BANDE_HY_OAS) if hy_now else 50
        if hy_chg:
            sc -= max(0, hy_chg) * 0.8
        if stl is not None:
            sc -= max(0, stl) * 12
        macro["systemic_risk"] = {
            "hy_oas": round(hy_now, 2) if hy_now else None, "hy_chg_1m": hy_chg,
            "ig_oas": round(ig_now, 2) if ig_now else None, "ig_chg_1m": ig_chg,
            "hy_ig": round(hy_now / ig_now, 2) if hy_now and ig_now else None,
            "stlfsi": stl,
            "score": round(clamp(sc)), "status": status, "rising": rising,
        }
    except Exception as e:  # noqa: BLE001
        print(f"!! systemic_risk: {e}", file=sys.stderr)

    # Disaccoppiamento Macro: S&P 500 vs PIL reale USA (normalizzati a 100)
    try:
        # ⚠ v207 — `freq="m"` NON C'ERA, e il commento diceva già "mensili": fred_series senza
        # `freq` restituisce la frequenza NATIVA, e SP500 su FRED è GIORNALIERA. Quindi al posto
        # di 36 mesi (3 anni) arrivavano 36 SEDUTE (7 settimane), rebasate a 100 su una data
        # diversa da quella del PIL, e il "gap" sottraeva una variazione di 7 settimane da una
        # di 3 anni. Misurato sui dati veri: gap pubblicato -3 pp, aritmeticamente privo di senso.
        sp = fred_series("SP500", 40, freq="m")   # ~3 anni MENSILI
        gd = fred_series("GDPC1", 14, freq="q")   # ~3 anni trimestrali
        al = _finestra_comune(sp, gd)
        if al:
            sp2, gd2 = al
            sp_base, gd_base = sp2[0][1], gd2[0][1]
            macro["decouple"] = {
                "sp500": [{"d": d, "v": round(v / sp_base * 100, 1)} for d, v in sp2],
                "gdp":   [{"d": d, "v": round(v / gd_base * 100, 1)} for d, v in gd2],
            }
        else:
            print("!! decouple: le due serie non hanno una finestra comune, gap non pubblicato",
                  file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"!! decouple: {e}", file=sys.stderr)

    # S&P 500 + Nasdaq 100 vs Profitti Aziendali Reali USA (Corporate Profits, FRED CP)
    try:
        # ⚠ v207 — stesso difetto del blocco decouple: senza `freq="m"` arrivavano 60 SEDUTE
        # (86 giorni) invece di 60 mesi, e il gap sottraeva +1,7% di S&P su 3 mesi da +32,4% di
        # profitti su 5 anni, pubblicando "S&P gap -30,7 pp". Il ramo NDX era invece corretto
        # (yfinance, interval="1mo"), ed è per quello che worst_gap dava un valore sensato: il
        # numero giusto copriva quello sbagliato.
        cp = fred_series("CP", 22, freq="q")       # ~5 anni trimestrali
        cp_raw = list(cp)                          # v248: copia PRIMA del ritaglio sull'S&P
        sp_cp = fred_series("SP500", 64, freq="m") # ~5 anni MENSILI
        al_cp = _finestra_comune(sp_cp, cp)
        if al_cp:
            sp_cp, cp = al_cp
            cp_base, sp_base = cp[0][1], sp_cp[0][1]
            cur_sp = round(sp_cp[-1][1] / sp_base * 100, 1)
            cur_cp = round(cp[-1][1] / cp_base * 100, 1)
            gap = round(cur_sp - cur_cp, 1)
            # Nasdaq 100 (^NDX) — mensile 5 anni via yfinance.
            # ⚠ v248 — IL RAMO NDX NON ERA ALLINEATO, e nessuno se n'era accorto perché il
            # commento qui sopra lo dichiarava "corretto": lo era sulla FREQUENZA (interval="1mo"),
            # non sulla FINESTRA. Il difetto misurato l'08/08/2026 sui dati veri:
            #   · ndx_hist ribasato sul PROPRIO primo punto (~2021-08), misurato al 2026-08-01
            #   · cur_cp ribasato sulla finestra comune con l'S&P, misurato al 2026-01-01
            # Basi diverse E date finali diverse: sette mesi di Nasdaq senza profitti a fronte.
            # E siccome worst_gap = max(gap, ndx_gap) prendeva proprio l'NDX (69,9 contro 34,9),
            # il numero SBAGLIATO era quello pubblicato in cima, con l'etichetta "(driver: NDX)".
            # È la classe v207 identica, sopravvissuta nel ramo che quel commit dichiarava sano.
            ndx_hist = None
            ndx_gap = None
            try:
                ndx_raw = yf.Ticker("^NDX").history(period="5y", interval="1mo",
                                                     auto_adjust=True)["Close"].dropna()
                if len(ndx_raw) > 10:
                    ndx_pairs = [(str(d.date()), float(v)) for d, v in ndx_raw.items()]
                    # si allinea l'NDX ai profitti GREZZI (cp_raw), non a `cp` già ritagliato
                    # sull'S&P: due ritagli in cascata darebbero una finestra più corta del vero.
                    al_ndx = _finestra_comune(ndx_pairs, cp_raw)
                    if al_ndx:
                        ndx_al, cp_al = al_ndx
                        nb, cb = ndx_al[0][1], cp_al[0][1]
                        if nb and cb:
                            ndx_gap = round(ndx_al[-1][1] / nb * 100 - cp_al[-1][1] / cb * 100, 1)
                    # la serie per il grafico resta a base propria: serve a disegnare l'andamento,
                    # non a calcolare il gap — e il gap ora NON la usa più.
                    ndx_base_v = float(ndx_raw.iloc[0])
                    ndx_hist = [{"d": str(d.date()), "v": round(float(v) / ndx_base_v * 100, 1)}
                                for d, v in ndx_raw.items()]
            except Exception:
                pass
            # score/label sul gap PEGGIORE, non sulla media: con S&P a -24 e NDX a +59 la
            # media (17.5) diceva "Allineati 88/100" mentre l'NDX — il benchmark del mandato —
            # bucava da solo la soglia "Asset Inflation" (>40). Un flag di rischio non si
            # diluisce col comparto messo meglio (v110).
            worst_gap = round(max(gap, ndx_gap), 1) if ndx_gap is not None else gap
            score = clamp(round(100 - max(0, worst_gap - 10) / 60 * 100))
            macro["corp_profit"] = {
                "sp500":   [{"d": d, "v": round(v / sp_base * 100, 1)} for d, v in sp_cp],
                "profits": [{"d": d, "v": round(v / cp_base * 100, 1)} for d, v in cp],
                "ndx":     ndx_hist,
                "gap":     gap,
                "ndx_gap": ndx_gap,
                "worst_gap": worst_gap,
                "score":   score,
                "label":   ("Asset Inflation estrema" if worst_gap > 70 else "Asset Inflation" if worst_gap > 40
                            else "Tensione moderata" if worst_gap > 20 else "Allineati")
                           + (" (driver: NDX)" if ndx_gap is not None and ndx_gap > gap and worst_gap > 20 else ""),
            }
    except Exception as e:
        print(f"!! corp_profit: {e}", file=sys.stderr)

    # Fed Funds Rate + S&P 500 (andamento storico tassi vs mercato)
    try:
        ff = fred_series("FEDFUNDS", 60)   # ~5 anni mensili
        sp_ff = fred_series("SP500", 60)   # ~5 anni mensili
        if ff and sp_ff:
            macro["fed_market"] = {
                "fedfunds": [{"d": d, "v": round(v, 2)} for d, v in ff],
                "sp500":    [{"d": d, "v": round(v)} for d, v in sp_ff],
                "current_rate": round(ff[-1][1], 2),
                "rate_date": ff[-1][0],
            }
    except Exception as e:
        print(f"!! fed_market: {e}", file=sys.stderr)

    # --- P/E di mercato: catena di fonti (post-incidente forward_pe/sp500_pe missing) ---
    # WSJ "P/Es & Yields on Major Indexes": tabella HTML aperta con trailing E forward
    # (verificato live lug 2026: S&P trailing 25.4, forward 21.7). Parser condiviso.
    def fetch_pe_wsj():
        """La pagina embedda JSON con campi nominati (verificato lug 2026):
        "S&P 500 Index","priceEarningsRatio":"25.37","priceEarningsRatioEstimate":"21.74"
        → parsing sul JSON, non sull'HTML delle celle (fragile)."""
        try:
            wsj_ua = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
            h = requests.get("https://www.wsj.com/market-data/stocks/peyields", headers=wsj_ua, timeout=25).text
            out = {}
            for label, key in (('"S&P 500 Index"', "sp"), ('"NASDAQ 100 Index"', "ndx"),
                               ('"Nasdaq 100 Index"', "ndx"), ('"NASDAQ 100"', "ndx")):
                i = h.find(label)
                if i < 0 or (key + "_trail") in out:
                    continue
                win = h[i:i + 500]
                mt = re.search(r'"priceEarningsRatio"\s*:\s*"([\d.]+)"', win)
                mf = re.search(r'"priceEarningsRatioEstimate"\s*:\s*"([\d.]+)"', win)
                if mt:
                    out[key + "_trail"] = float(mt.group(1))
                if mf:
                    out[key + "_fwd"] = float(mf.group(1))
            return out
        except Exception as e:  # noqa: BLE001
            print(f"!! WSJ peyields: {e}", file=sys.stderr)
            return {}
    wsj_pe = fetch_pe_wsj()

    # P/E Ratio corrente S&P 500: multpl → WSJ trailing (+ carry-forward più sotto).
    # NB: "SP500PE" NON è una serie FRED valida (FRED non pubblica il P/E dell'S&P 500): il
    # vecchio tentativo dava HTTP 400 a OGNI run senza mai restituire nulla → rimosso.
    try:
        pe_data = []
        pe_source = "FRED SP500PE"
        if not pe_data:
            cur_alt = None
            try:  # multpl: pagina semplice col valore corrente
                mh = requests.get("https://www.multpl.com/s-p-500-pe-ratio",
                                  headers={"User-Agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36"}, timeout=20).text
                mm = re.search(r'Current S&P 500 PE Ratio[^0-9]{0,80}?([\d.]+)', mh)
                cur_alt = float(mm.group(1)) if mm else None
            except Exception as e:  # noqa: BLE001
                print(f"!! multpl: {e}", file=sys.stderr)
            pe_source = "multpl"
            if cur_alt is None:
                cur_alt = wsj_pe.get("sp_trail")
                pe_source = "WSJ"
            if cur_alt is not None:
                # niente storia mensile dalla fonte alternativa: history vuota, media 10A n.d.
                pe_data = [(datetime.now(timezone.utc).strftime("%Y-%m-%d"), float(cur_alt))]
        if pe_data:
            pe_vals = [v for _, v in pe_data if v]
            cur_pe = pe_data[-1][1]
            # media/percentile SOLO con storia vera (>=24 mesi): mai statistiche su 1 punto
            has_hist = len(pe_vals) >= 24
            avg_pe = round(sum(pe_vals) / len(pe_vals), 1) if has_hist else None
            pct_rank = round(sum(1 for v in pe_vals if v < cur_pe) / len(pe_vals) * 100) if has_hist else None
            score = clamp(round(100 - (cur_pe - 10) / 40 * 100))
            ndx_pe = None
            try:
                qqq_info = yf.Ticker("QQQ").info
                raw_pe = qqq_info.get("trailingPE") or qqq_info.get("forwardPE")
                ndx_pe = round(float(raw_pe), 1) if raw_pe else None
            except Exception:
                pass
            if ndx_pe is None:
                ndx_pe = wsj_pe.get("ndx_trail")   # fallback WSJ per il Nasdaq 100
            macro["sp500_pe"] = {
                "current":  round(cur_pe, 1),
                "avg_10y":  avg_pe,
                "pct_rank": pct_rank,
                "score":    score,
                "history":  [{"d": d, "v": round(v, 1)} for d, v in pe_data if v],
                "label":    "Estrema sopravvalutazione" if cur_pe > 35
                            else "Sopravvalutazione" if cur_pe > 25
                            else "Valutazione elevata" if cur_pe > 20
                            else "Valutazione normale" if cur_pe > 14 else "Sottovalutazione",
                "nasdaq_pe": ndx_pe,
                # TRASPARENZA FONTE (anti-allucinazione LLM): trailing e forward vengono da fonti
                # e metodologie DIVERSE — etichettarle evita falsi tassi di crescita impliciti
                "source": pe_source, "kind": "trailing",
                "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            }
    except Exception as e:
        print(f"!! sp500_pe: {e}", file=sys.stderr)

    # Forward P/E S&P 500 (per il termometro di rischio sistemico).
    # FONTE PRIMARIA: WSJ forward estimate (Yahoo ha smesso di esporre forwardPE su SPY —
    # verificato lug 2026: None). Fallback: Yahoo SPY, se mai tornasse.
    # NESSUN fallback fittizio (GIGO): senza dato la metrica resta assente/n.d.
    try:
        raw_fpe = wsj_pe.get("sp_fwd")
        if raw_fpe is None:
            try:
                raw_fpe = (yf.Ticker("SPY").info or {}).get("forwardPE")
            except Exception:  # noqa: BLE001
                raw_fpe = None
        fpe = sane_val(raw_fpe, 5, 100, "S&P forward P/E")     # scarta valori assurdi
        if fpe is not None:
            fpe = round(float(fpe), 1)
            macro["forward_pe"] = {
                "value": fpe,
                "avg_hist": 16.5,                              # media storica forward P/E S&P 500
                "label": "Estremo" if fpe > 22 else "Elevato" if fpe > 18 else "Normale" if fpe > 14 else "Conveniente",
                "source": "WSJ (estimate)" if wsj_pe.get("sp_fwd") is not None else "Yahoo SPY",
                "kind": "forward",
                "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            }
    except Exception as e:  # noqa: BLE001
        print(f"!! forward_pe: {e}", file=sys.stderr)

    # Smart Money vs Retail: ora basato su Smart Money Concepts (SMC) di S&P 500 e Nasdaq 100
    # (struttura/BOS, FVG, liquidità, order block calcolati dall'OHLC) + proxy istituzionali
    # (struttura VIX, spread HY/IG, copertura put/call) come contesto secondario.
    try:
        smc_idx = {}
        for sym, key, label in (("^GSPC", "sp500", "S&P 500"), ("^NDX", "nasdaq", "Nasdaq 100")):
            try:
                ih = yf.Ticker(sym).history(period="1y", interval="1d", auto_adjust=True)
                s = smc_analysis(ih)
                if s:
                    s["label_idx"] = label
                    smc_idx[key] = s
            except Exception:  # noqa: BLE001
                pass
        smc_scores = [s["bias"] for s in smc_idx.values()]
        smc_avg = round(sum(smc_scores) / len(smc_scores)) if smc_scores else None

        vix3m_h = yf.Ticker("^VIX3M").history(period="5d")["Close"].dropna()
        vix3m = float(vix3m_h.iloc[-1]) if len(vix3m_h) else None
        ig_data = fred_series("BAMLC0A4CBBB", 1)
        ig_val = ig_data[-1][1] if ig_data else None
        vix_val = macro.get("vix", {}).get("value")
        hy_val = macro.get("credit", {}).get("spread_hy")
        fg_score = macro.get("fear_greed", {}).get("score")
        pc_ratio = macro.get("putcall", {}).get("ratio")
        sm_comps, vix_ts, hy_ig = [], None, None
        if smc_avg is not None:
            sm_comps.append(("Struttura SMC indici (S&P 500 + Nasdaq)", smc_avg))
        if vix_val and vix3m:
            vix_ts = round(vix_val / vix3m, 3)
            sm_comps.append(("Struttura VIX (contango/backw.)", round(clamp(100 - (vix_ts - 0.85) / 0.35 * 100))))
        if hy_val and ig_val and ig_val > 0:
            hy_ig = round(hy_val / ig_val, 2)
            sm_comps.append(("Spread HY/IG (fuga qualità)", round(clamp(100 - (hy_ig - 1.5) / 5 * 100))))
        if pc_ratio:
            sm_comps.append(("Copertura PUT (P/C ratio)", round(clamp(100 - (pc_ratio - 0.6) / 1.2 * 100))))
        if sm_comps:
            # peso: la struttura SMC degli indici conta 3x (è il driver richiesto)
            parts = ([smc_avg] * 3 if smc_avg is not None else []) + [s for l, s in sm_comps if not l.startswith("Struttura SMC")]
            sm_score = round(sum(parts) / len(parts))
            fg_div = round(fg_score - sm_score) if fg_score is not None else None
            macro["smart_money"] = {
                "score": sm_score,
                "label": "Ottimista" if sm_score >= 60 else "Cauto" if sm_score <= 40 else "Neutrale",
                "smc_indices": smc_idx,
                "smc_avg": smc_avg,
                "vix3m": round(vix3m, 1) if vix3m else None,
                "vix_term_ratio": vix_ts,
                "ig_spread": round(ig_val, 2) if ig_val else None,
                "hy_ig_ratio": hy_ig,
                "divergence": fg_div,
                "divergence_label": (
                    "Retail euforia / Smart money cauto" if fg_div and fg_div > 15
                    else "Smart money ottimista / Retail pessimista" if fg_div and fg_div < -15
                    else "Allineati"
                ) if fg_div is not None else None,
                "components": [{"label": l, "score": s} for l, s in sm_comps],
            }
    except Exception as e:  # noqa: BLE001
        print(f"!! smart_money: {e}", file=sys.stderr)

    # MacroQuant (riproduzione trasparente stile BCA): composito del ciclo/risk dai
    # fattori macro disponibili. NON è il dato proprietario BCA Research.
    mq = []
    for i in macro.get("indicators", []):
        if i.get("impact") is not None:
            mq.append((i["label"], i["impact"]))
    if macro.get("buffett"):
        mq.append(("Valutazione (Buffett)", macro["buffett"]["score"]))
    if macro.get("signposts"):
        mq.append(("Segnali ribassisti BofA", 100 - macro["signposts"]["pct"]))
    if macro.get("fear_greed"):
        mq.append(("Fear & Greed", macro["fear_greed"]["score"]))
    if macro.get("vix"):
        mq.append(("Volatilità (VIX)", round(clamp(100 - macro["vix"]["value"] / 50 * 100))))
    if macro.get("credit"):
        mq.append(("Rischio Credito (HY)", macro["credit"]["score"]))
    if macro.get("smart_money"):
        mq.append(("Smart Money (VIX+HY/IG+P/C)", macro["smart_money"]["score"]))
    if mq:
        score = round(sum(s for _, s in mq) / len(mq))
        macro["macroquant"] = {
            "score": score,
            "label": "Espansione" if score >= 60 else "Contrazione" if score <= 40 else "Rallentamento",
            "components": [{"label": l, "score": round(s)} for l, s in mq],
            "note": "Riproduzione trasparente stile BCA MacroQuant dai fattori macro pubblici "
                    "(il MacroQuant ufficiale di BCA Research è proprietario e a pagamento).",
        }

    try:
        macro["seasonality"] = fetch_seasonality()
        # v194 — narrazione temporale: serie lunghe FRED + episodi analoghi. Non blocca il run:
        # se FRED non risponde il payload semplicemente non stampa il blocco.
        try:
            pass          # v203: storia lunga e ciclo semi rimossi (FRED mai verificato da qui)
        except Exception:  # noqa: BLE001
            pass
    except Exception as e:  # noqa: BLE001
        print(f"!! stagionalità: {e}", file=sys.stderr)

    for key, fn in (("liquidity_split", fetch_liquidity_split),
                    ("dollar_ruler", fetch_dollar_ruler),
                    ("momentum", fetch_momentum),
                    ("futures", fetch_futures),          # v125: futures NQ/ES live (leading pre-apertura USA)
                    ("froth", fetch_speculative_froth),  # v126: schiuma speculativa ETF 3x (SOXL/TQQQ)
                    ("breadth", fetch_market_breadth)):  # v126: ampiezza SPY vs RSP (rally megacap-only)
        try:
            macro[key] = fn()
        except Exception as e:  # noqa: BLE001
            print(f"!! {key}: {e}", file=sys.stderr)

    try:
        # PREV_DATA (snapshot del run precedente, settato da main) alimenta il carry-forward
        macro["margin_debt"] = fetch_margin_debt((PREV_DATA.get("macro") or {}).get("margin_debt"))
    except Exception as e:  # noqa: BLE001
        print(f"!! margin debt: {e}", file=sys.stderr)

    # CARRY-FORWARD P/E di mercato: WSJ/multpl funzionano da IP residenziali ma sono bloccati
    # dagli IP datacenter (CI) come FINRA. Il P/E si muove lento: se la fonte è ko in questo
    # run, riporto avanti l'ultimo valore del run precedente (≤45 gg) marcato carried, invece
    # di lasciare un buco che acceca la lettura di leva/valutazioni.
    prev_macro = PREV_DATA.get("macro") or {}
    for key in ("sp500_pe", "forward_pe"):
        if macro.get(key):
            continue
        prev = prev_macro.get(key)
        if not prev:
            continue
        prev_at = prev.get("fetched_at") or prev.get("date")
        try:
            age = (datetime.now(timezone.utc).date() - datetime.fromisoformat(str(prev_at)[:10]).date()).days if prev_at else 999
        except Exception:  # noqa: BLE001
            age = 999
        if age <= 45:
            macro[key] = dict(prev, carried=True)
            print(f"·· {key}: fonte ko, carry-forward del run precedente (età {age}g)", file=sys.stderr)

    return macro


def fetch_liquidity_split():
    """Liquidità Istituzionali vs Retail — PROXY DICHIARATI (non misure dirette):
    - ISTITUZIONALI: quota AUM parcheggiata in T-Bill ETF (BIL+SHV) vs l'azionario core (SPY).
      È un rapporto REALE tra masse: sale quando gli istituzionali stanno liquidi.
    - RETAIL: FRED RMFNS (retail money market funds, $ mld, mensile): livello + YoY +
      percentile 5 anni. NIENTE percentuale inventata: non esiste un denominatore onesto
      per "il cash del retail è X% del suo portafoglio" — meglio livello e trend veri."""
    out = {}
    try:
        aums = {}
        for sym in ("BIL", "SHV", "SPY"):
            try:
                aums[sym] = float((yf.Ticker(sym).info or {}).get("totalAssets") or 0)
            except Exception:  # noqa: BLE001
                aums[sym] = 0.0
        mm = aums["BIL"] + aums["SHV"]
        if mm > 0 and aums["SPY"] > 0:
            out["inst_cash_pct"] = round(mm / (mm + aums["SPY"]) * 100, 1)
            out["inst_note"] = f"AUM BIL+SHV ${mm/1e9:.0f}B vs SPY ${aums['SPY']/1e9:.0f}B"
    except Exception as e:  # noqa: BLE001
        print(f"!! liquidity inst: {e}", file=sys.stderr)
    try:
        rm = fred_series("RMFNS", n=62)          # ~5 anni mensili
        if len(rm) >= 12:
            vals = [v for _, v in rm]
            cur = vals[-1]
            out["retail_mmf_bln"] = round(cur, 1)
            out["retail_yoy_pct"] = round((cur / vals[-13] - 1) * 100, 1) if len(vals) >= 13 and vals[-13] else None
            out["retail_pctile_5y"] = round(sum(1 for v in vals if v < cur) / len(vals) * 100)
            out["retail_date"] = rm[-1][0]
    except Exception as e:  # noqa: BLE001
        print(f"!! liquidity retail RMFNS: {e}", file=sys.stderr)
    out["proxy"] = True
    return out or None


def fetch_dollar_ruler():
    """Righello Dollaro: variazione 3 mesi del Dollar Index (DXY, fallback UUP).
    Dollaro forte = compressione utili esteri delle large cap USA (e viceversa).
    Flag algoritmico: >+5% nel trimestre → COMPRESSIONE; <-5% → BOOST; altrimenti neutro."""
    for sym, src in (("DX-Y.NYB", "DXY"), ("UUP", "UUP (proxy)")):
        try:
            h = yf.Ticker(sym).history(period="4mo", interval="1d", auto_adjust=True)["Close"].dropna()
            if len(h) >= 60:
                cur = float(h.iloc[-1])
                chg = (cur / float(h.iloc[-63]) - 1) * 100      # ~3 mesi di trading
                flag = ("[COMPRESSIONE UTILI VALUTARIA: RIGHELLO ESTESO]" if chg >= 5
                        else "[BOOST UTILI VALUTARIA: RIGHELLO ACCORCIATO]" if chg <= -5 else None)
                return {"value": round(cur, 2), "chg_3m_pct": round(chg, 2), "flag": flag, "src": src}
        except Exception as e:  # noqa: BLE001
            print(f"!! dollar ruler {sym}: {e}", file=sys.stderr)
    return None


def fetch_momentum():
    """Momentum strutturale S&P 500 e Nasdaq 100: distanza % del prezzo dalla SMA125
    (≈ media a 6 mesi). Sopra = trend primario integro; sotto = deterioramento."""
    out = {}
    for sym, key in (("^GSPC", "sp500"), ("^NDX", "ndx")):
        try:
            h = yf.Ticker(sym).history(period="1y", interval="1d", auto_adjust=True)["Close"].dropna()
            if len(h) >= 125:
                px = float(h.iloc[-1]); sma = float(h.rolling(125).mean().iloc[-1])
                out[key] = {"price": round(px, 2), "sma125": round(sma, 2),
                            "dist_pct": round((px / sma - 1) * 100, 2),
                            "asof": bar_asof(h)}          # v261
        except Exception as e:  # noqa: BLE001
            print(f"!! momentum {sym}: {e}", file=sys.stderr)
    return out or None


def fetch_futures():
    """Futures indici USA LIVE (v125) — leading indicator prima dell'apertura di Wall Street:
    Nasdaq 100 (NQ=F) e S&P 500 (ES=F). fast_info dà l'ultimo scambio real-time (i futures
    scambiano ~24/5); variazione vs chiusura precedente. Alimenta anche il MACRO SHOCK ALERT."""
    out = {}
    for sym, key, lab in (("NQ=F", "nasdaq", "Futures Nasdaq 100"), ("ES=F", "sp500", "Futures S&P 500")):
        try:
            fi = yf.Ticker(sym).fast_info
            lp, pc = float(fi.last_price), float(fi.previous_close)
            if _finite_pos(lp) and _finite_pos(pc):
                out[key] = {"symbol": sym, "label": lab, "price": round(lp, 2),
                            "change_pct": round((lp / pc - 1) * 100, 2)}
        except Exception as e:  # noqa: BLE001
            print(f"!! futures {sym}: {e}", file=sys.stderr)
    return out or None


def fetch_speculative_froth():
    """RADAR SCHIUMA SPECULATIVA (v126) — flussi sugli ETF a leva 3x (SOXL semis, TQQQ Nasdaq)
    come proxy dell'euforia retail terminale. Segnale = VOLUME RELATIVO estremo (RVol vs media
    30 sedute) DENTRO un movimento al rialzo a 5 sedute: ondata di volume mentre si sale =
    frenesia d'acquisto. NIENTE RSI: su un 3x è strutturalmente ipercomprato in ogni trend →
    solo falsi positivi. Alert se RVol ≥ 2.5 con prezzo su a 5 sedute su almeno un ETF."""
    out = {}
    for sym, key in (("SOXL", "soxl"), ("TQQQ", "tqqq")):
        try:
            h = drop_void_bars(yf.Ticker(sym).history(period="3mo", interval="1d", auto_adjust=True))
            if len(h) < 35:
                continue
            vols = h["Volume"].dropna()
            # ultima seduta COMPLETA (stessa regola RVol del resto del sistema: il bar di oggi
            # a sessione aperta è parziale e darebbe sempre <1)
            _now = datetime.now(timezone.utc)
            ri = -2 if (len(vols) and vols.index[-1].date() == _now.date() and _now.hour < 21) else -1
            v_last = float(vols.iloc[ri])
            v_avg = float(vols.iloc[ri - 30:ri].mean())
            closes = h["Close"].dropna()
            chg5 = (float(closes.iloc[-1]) / float(closes.iloc[-6]) - 1) * 100 if len(closes) >= 6 else None
            if v_avg > 0:
                out[key] = {"symbol": sym, "rvol": round(v_last / v_avg, 2),
                            "chg_5d_pct": round(chg5, 2) if chg5 is not None else None,
                            "asof": bar_asof(closes)}     # v261
        except Exception as e:  # noqa: BLE001
            print(f"!! froth {sym}: {e}", file=sys.stderr)
    if not out:
        return None
    hot = [v for v in out.values() if v["rvol"] >= 2.5 and (v["chg_5d_pct"] or 0) > 0]
    out["alert"] = bool(hot)
    if hot:
        out["note"] = ("Volume estremo in acquisto sugli ETF a leva 3x (" +
                       ", ".join(f"{v['symbol']} RVol {v['rvol']}× / +{v['chg_5d_pct']}% 5g" for v in hot) +
                       "): euforia retail terminale sul tech/semi.")
    return out


def fetch_market_breadth():
    """PROXY AMPIEZZA DI MERCATO (v126) — S&P 500 capitalizzato (SPY) vs equi-pesato (RSP) a
    21 sedute: se SPY sale mentre RSP arretra, il rally è retto da poche megacap — la fragilità
    a cui un portafoglio concentrato su NVDA/MU/AMD è più esposto. Alert su divergenza:
    SPY positivo con RSP negativo, oppure spread > 4pp."""
    try:
        rets = {}
        for sym in ("SPY", "RSP"):
            h = drop_void_bars(yf.Ticker(sym).history(period="3mo", interval="1d", auto_adjust=True))["Close"].dropna()
            if len(h) < 22:
                return None
            rets[sym] = (float(h.iloc[-1]) / float(h.iloc[-22]) - 1) * 100
            ultima_barra = bar_asof(h)                     # v261: stessa barra per entrambi i simboli
        spread = rets["SPY"] - rets["RSP"]
        alert = (rets["SPY"] > 0 and rets["RSP"] < 0) or spread > 4
        out = {"spy_1m_pct": round(rets["SPY"], 2), "rsp_1m_pct": round(rets["RSP"], 2),
               "divergence_pp": round(spread, 2), "alert": alert,
               "asof": ultima_barra}                       # v261
        if alert:
            out["note"] = (f"SPY {rets['SPY']:+.1f}% vs RSP {rets['RSP']:+.1f}% a 1M "
                           f"(spread {spread:+.1f}pp): il rally è retto dalle megacap, l'azione media non partecipa.")
        return out
    except Exception as e:  # noqa: BLE001
        print(f"!! breadth SPY/RSP: {e}", file=sys.stderr)
        return None


_SHOCK_FALLBACK_OFFSET = {"Asia/Seoul": 9, "America/New_York": -4}   # ore vs UTC se manca tzdata


def _market_date(tz_name, now_utc):
    """Data di CALENDARIO nel fuso del mercato. Con ZoneInfo gestisce la DST; senza tzdata
    (ambiente minimale) ricade su un offset fisso — per Asia/Seoul (UTC+9, niente DST) è
    esatto tutto l'anno, che è il caso che conta per il gate anti-fantasma del KOSPI."""
    if ZoneInfo is not None:
        try:
            return now_utc.astimezone(ZoneInfo(tz_name)).date()
        except Exception:  # noqa: BLE001 — nome fuso non risolvibile: offset fisso
            pass
    return (now_utc + timedelta(hours=_SHOCK_FALLBACK_OFFSET.get(tz_name, 0))).date()


def _seoul_in_session(now_utc=None):
    """Borsa di Seoul in contrattazione (09:00-15:30 KST, UTC+9 fisso, niente DST).

    Serve a distinguere un prezzo VERAMENTE live dal semplice ultimo scambio disponibile:
    fast_info restituisce sempre un valore, anche a mercato chiuso."""
    t = (now_utc or datetime.now(timezone.utc)) + timedelta(hours=9)
    if t.weekday() >= 5:
        return False
    return 540 <= t.hour * 60 + t.minute < 930


def compute_shock_alert(macro, watchlist, now_utc=None):
    """MACRO SHOCK ALERT (v127 session-aware) — riconosce le mattinate di panico: se l'Asia
    (KOSPI) o i futures Nasdaq cedono oltre il -2% mentre Wall Street è chiusa, alza un flag che
    testata/critic/dashboard leggono per SOSPENDERE gli acquisti aggressivi finché non si assesta
    la prima ora. Legge i dati LIVE già raccolti (nessuna chiamata extra).

    ⚠ FIX FANTASMA (v127): il -2% conta SOLO se il crollo appartiene alla SESSIONE CORRENTE del
    suo mercato. Il bug reale: un KOSPI -8,95% restava flaggato per giorni perché, a Asia
    RIAPERTA e prezzo live ~0%, la pipeline ricadeva sulla candela giornaliera STANTIA del giorno
    del crollo (Yahoo può voidare la barra odierna / non averla ancora formata) e ne rileggeva la
    variazione come se fosse di oggi. Discriminante:
      • KOSPI LIVE (`price_live`): il delta è ricalcolato in real-time vs la chiusura più recente
        → è per costruzione la sessione corrente → attendibile (a riapertura piatta dà ~0% da solo).
      • KOSPI a CANDELA (`price_live` falso): vale solo se `price_asof` == data di Seoul di OGGI;
        una candela di una sessione precedente è un FANTASMA → soppressa (loggata su stderr).
      • Futures NQ=F/ES=F: `fast_info.previous_close` rolla al settlement CME (America/New_York),
        quindi il delta è già ancorato alla sessione corrente → live per costruzione.
    """
    THR = -2.0
    now_utc = now_utc or datetime.now(timezone.utc)
    sources, suppressed = [], []
    fut = macro.get("futures") or {}
    for key, lab in (("nasdaq", "Futures Nasdaq 100"), ("sp500", "Futures S&P 500")):
        chg = (fut.get(key) or {}).get("change_pct")
        if chg is not None and chg <= THR:
            sources.append({"src": lab, "chg": chg, "basis": "live"})   # delta vs settlement corrente
    for r in watchlist:
        if r.get("ticker") != "^KS11":
            continue
        chg = r.get("change_pct")
        if chg is None or chg > THR:
            continue
        # v176 — `price_live` dice solo che il prezzo viene da fast_info, NON che la borsa sia
        # aperta: di domenica, con Seoul ferma da venerdì, restava vero e faceva scattare lo shock
        # su un movimento di due giorni prima, già dentro la chiusura USA di venerdì (contato due
        # volte). Il "live" ora vale solo se Seoul è DAVVERO in sessione.
        seoul_today = _market_date("Asia/Seoul", now_utc)
        if r.get("price_live") and _seoul_in_session(now_utc):
            sources.append({"src": "KOSPI (Asia)", "chg": chg, "basis": "live"})
        else:
            asof = r.get("price_asof")
            if asof is not None and str(asof) == seoul_today.isoformat():
                sources.append({"src": "KOSPI (Asia)", "chg": chg, "basis": "candle"})
            else:
                suppressed.append({"src": "KOSPI (Asia)", "chg": chg, "asof": asof, "today": seoul_today.isoformat()})
    for s in suppressed:
        print(f"·· shock alert: KOSPI {s['chg']}% SOPPRESSO (candela sessione precedente = fantasma; "
              f"asof={s['asof']}, oggi Seoul={s['today']})", file=sys.stderr)
    if not sources:
        return None
    worst = min(s["chg"] for s in sources)
    return {"active": True, "threshold": THR, "sources": sources, "worst_chg": worst,
            "note": "Asia/futures Nasdaq oltre -2% con Wall Street chiusa: sospendere gli acquisti "
                    "aggressivi, attendere l'assestamento della prima ora di scambi USA."}


def _margin_vs_gdp(md_millions):
    """Margin debt in % del PIL NOMINALE — la normalizzazione che pct_of_peak non da'.

    Perche' serve: "100% del picco storico" e' SATURO. Sulle 13 rilevazioni a disposizione il
    valore era il nuovo massimo in 11 casi: una metrica che dice 100% quasi sempre non distingue
    niente, e infatti l'etichetta di regime era gia' stata spostata sullo YoY (v-precedente).
    Rapportare la leva al PIL invece non satura e risponde alla domanda vera — quanto e' grande
    questa leva rispetto all'economia, non rispetto a se stessa. Giugno 2026: 4,71%, contro una
    mediana storica intorno al 2,4%. Verificato: FINRA 1.502.072 mln / PIL nominale FRED.

    Ritorna (pct, mediana_storica, percentile) oppure (None, None, None) se la serie manca.
    """
    try:
        gdp = fred_series("GDP", n=320)          # PIL nominale trimestrale, miliardi di $
    except Exception:  # noqa: BLE001
        return (None, None, None)
    if not gdp or not md_millions:
        return (None, None, None)
    cur_gdp = gdp[-1][1]
    if not cur_gdp:
        return (None, None, None)
    pct = round(md_millions / 1000.0 / cur_gdp * 100, 2)
    # mediana storica del rapporto: richiede la serie lunga del margin debt, che qui non c'e'.
    # Si usa il riferimento pubblicato (mediana ~2,38%) SOLO come contesto dichiarato, mai come
    # dato calcolato: e' un numero di fonte esterna e il payload deve dirlo.
    return (pct, 2.38, None)

def _finra_scrape(url):
    """Scrape della tabella FINRA (Mon-YY | debit balances $mln). Ritorna [(iso_date, val)] ordinati.
    HEADER DEDICATO (verificato sul campo, lug 2026): l'Akamai di finra.org risponde 403
    all'UA del modulo ("Chrome/124" + Accept:*/* = fingerprint browser incoerente) e 200
    a un UA generico SENZA Accept — era QUESTA la causa dei fallimenti, anche in CI."""
    MONTHS = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
              "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
    finra_ua = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    html = requests.get(url, headers=finra_ua, timeout=25).text
    rows = re.findall(r"<td[^>]*>\s*([A-Z][a-z]{2})-(\d{2})\s*</td>\s*<td[^>]*>\s*\$?([\d,]+)", html)
    fs = []
    for mon, yy, val in rows:
        mnum = MONTHS.get(mon)
        if mnum:
            fs.append((f"20{yy}-{mnum:02d}-01", float(val.replace(",", ""))))
    fs.sort()
    return fs


BANDE_HY_OAS = ((0, 4, 96, 72), (4, 5, 44, 36), (5, 20, 32, 4))


def _punteggio_da_bande(v, bande):
    """Punteggio 0-100 ricavato dalle BANDE DICHIARATE, non da un'ancora scelta a mano.
    Ogni banda e' (da, a, punteggio_minimo, punteggio_massimo): dentro la banda il valore si
    muove, ma non esce MAI dalla fascia che porta il suo nome — cosi' il numero non puo'
    contraddire l'etichetta che gli sta accanto.
    ⚠⚠ QUESTA FUNZIONE DEVE DARE LO STESSO NUMERO DI `punteggioDaZone` IN assets/app.js. La
    prima stesura interpolava in modo diverso e per HY 2,71% dava 69 contro 88: due
    implementazioni della stessa formula che divergono — cioe' il difetto che questa riscrittura
    esiste per chiudere, ricreato nell'atto di chiuderlo. Un gate confronta i due su una griglia
    di valori: se divergono, la CI si rompe."""
    if v is None:
        return 50
    for da, a, s0, s1 in bande:
        if da <= v <= a:
            q = max(0.0, min(1.0, (v - da) / ((a - da) or 1)))
            return clamp(s0 + q * (s1 - s0))
    if v < bande[0][0]:
        return clamp(bande[0][2])
    return clamp(bande[-1][3])


def fetch_margin_debt(prev_md=None):
    """Margin Debt: leva a credito reale sui conti titoli. CATENA DI FONTI (post-incidente
    "widget congelato a $622 mld Z.1 mentre FINRA stampava $1,42T"):
    1. scrape FINRA su DUE URL (pagina investors + canonical rules-guidance) — è la serie vera;
       NB: finra.org è dietro Akamai e da IP datacenter (GitHub Actions) può rispondere con
       challenge → per questo esiste il passo 2;
    2. CARRY-FORWARD: se lo scrape fallisce ma il run PRECEDENTE aveva un dato FINRA con
       reference date ≤ 90 giorni, quel dato è ANCORA VALIDO (serie mensile con ~1 mese di
       lag di pubblicazione): lo riporto avanti marcato carried=True. Un dato mensile vero
       di 2 mesi batte una serie sbagliata di oggi;
    3. Fed Z.1 (misura DIVERSA e più piccola: conti a margine broker-dealer) SOLO come ultima
       spiaggia, marcata unreliable=True: validate_macro e la UI la trattano come inaffidabile.
    Plausibilità 2026: un valore FINRA < $800 mld = spazzatura → scartato a monte."""
    for url in ("https://www.finra.org/investors/learn-to-invest/advanced-investing/margin-statistics",
                "https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics"):
        try:
            fs = _finra_scrape(url)
            if len(fs) >= 6 and fs[-1][1] >= 800_000:      # threshold plausibilità 2026 ($ mln)
                vals = [v for _, v in fs]
                cur = vals[-1]
                HIST_ATH_FLOOR = 935904.0                   # ATH pre-2026 documentato (ott 2021)
                peak = max(max(vals), HIST_ATH_FLOOR)
                peak_date = max(fs, key=lambda t: t[1])[0] if max(vals) >= HIST_ATH_FLOOR else "2021-10-01"
                yoy = round((cur / vals[-13] - 1) * 100, 1) if len(vals) >= 13 and vals[-13] else None
                mom = round((cur / vals[-2] - 1) * 100, 1) if len(vals) >= 2 and vals[-2] else None
                _md_gdp = _margin_vs_gdp(cur)     # una sola chiamata: la serie PIL si scarica una volta
                return {
                    "value": round(cur), "peak": round(peak),
                    "pct_of_peak": round(cur / peak * 100, 1),
                    # ⚠ la chiave si chiama "qoq" per ragioni storiche ma contiene la variazione
                    # MENSILE (mom): la UI la etichettava "trim." — corretto in v175. Non rinominata
                    # per non rompere i data.json già pubblicati che la CI usa in carry-forward.
                    "yoy": yoy, "qoq": mom, "date": fs[-1][0], "peak_date": peak_date,
                    # v188: leva rapportata al PIL — l'unica delle due che non sia satura
                    "pct_of_gdp": _md_gdp[0], "gdp_median_ref": _md_gdp[1],
                    "series": "FINRA debit balances (mensile)",
                    "history": [round(v) for v in vals[-24:]],
                    "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                }
        except Exception as e:  # noqa: BLE001
            print(f"!! margin debt FINRA scrape ({url.split('/')[-2]}): {e}", file=sys.stderr)

    # 2) carry-forward dell'ultimo FINRA valido (serie mensile: resta attuale ~90 giorni)
    if prev_md and "FINRA" in str(prev_md.get("series", "")) and prev_md.get("date") and prev_md.get("value", 0) >= 800_000:
        try:
            age = (datetime.now(timezone.utc).date() - datetime.fromisoformat(prev_md["date"]).date()).days
            if age <= 90:
                out = dict(prev_md)
                out["carried"] = True                      # dichiarato: riportato dal run precedente
                print(f"·· margin debt: scrape FINRA ko, carry-forward del dato {prev_md['date']} (età {age}g)", file=sys.stderr)
                return out
        except Exception:  # noqa: BLE001
            pass

    # 3) ultima spiaggia: Fed Z.1 — misura diversa, MARCATA inaffidabile per il risk management
    try:
        s = fred_series("BOGZ1FL663067003Q", n=1200)       # tutta la storia disponibile
    except Exception:  # noqa: BLE001
        s = []
    if len(s) < 20:
        return None
    vals = [v for _, v in s]
    cur, peak = vals[-1], max(vals)
    return {
        "value": round(cur), "peak": round(peak),
        "pct_of_peak": round(cur / peak * 100, 1) if peak else None,
        "yoy": round((cur / vals[-5] - 1) * 100, 1) if len(vals) >= 5 and vals[-5] else None,
        "qoq": round((cur / vals[-2] - 1) * 100, 1) if len(vals) >= 2 and vals[-2] else None,
        "date": s[-1][0], "peak_date": max(s, key=lambda t: t[1])[0],
        "series": "Fed Z.1 margin accounts (broker-dealer)",
        "unreliable": True,   # NON è la serie FINRA: misura diversa → la UI/prompt devono urlarlo
        "history": [round(v) for v in vals[-24:]],
    }


def validate_macro(macro):
    """DATA ASSERTIONS (post-incidente margin debt congelato): valida il macro PRIMA che
    finisca nel payload AI. Due famiglie di regole:
    - AGE CHECK: età del reference date vs la cadenza attesa della serie (un CPI di 65
      giorni è fisiologico, un margin debt FINRA di 6 mesi no);
    - THRESHOLD CHECK: range di plausibilità 2026 (margin debt FINRA < $800 mld, CPI 0%,
      VIX 0 = l'API sta restituendo spazzatura → il valore viene NULLATO, mai iniettato).
    Ritorna data_quality = {"checks": [...], "alerts": [...]} serializzato nel JSON:
    la UI (validateMacroData) e audit_data.py ci costruiscono sopra banner e gate CI."""
    today = datetime.now(timezone.utc).date()
    checks, alerts = [], []

    def age_of(ds):
        try:
            return (today - datetime.fromisoformat(str(ds)[:10]).date()).days
        except Exception:  # noqa: BLE001
            return None

    def add(key, date, max_age, status, note=""):
        checks.append({"key": key, "date": str(date)[:10] if date else None,
                       "age_days": age_of(date), "max_age": max_age, "status": status, "note": note})
        if status != "ok":
            alerts.append(f"{key}: {status}{' — ' + note if note else ''}")

    # --- margin debt: fonte giusta + fresco + plausibile ---
    md = macro.get("margin_debt")
    if not md:
        add("margin_debt", None, 90, "missing", "nessuna fonte disponibile")
    elif md.get("unreliable"):
        add("margin_debt", md.get("date"), 90, "unreliable",
            f"serie {md.get('series')} ≠ FINRA (misura diversa): NON usare per decisioni di leva")
    elif md.get("value", 0) < 800_000:
        md["unreliable"] = True
        add("margin_debt", md.get("date"), 90, "implausible",
            f"${md.get('value'):,}M < $800 mld nel 2026 = dato spazzatura")
    else:
        a = age_of(md.get("date"))
        add("margin_debt", md.get("date"), 90,
            "ok" if (a is not None and a <= 90) else "stale",
            "carry-forward dal run precedente (scrape FINRA ko)" if md.get("carried") else "")

    # --- indicatori mensili/trimestrali: età massima per cadenza (reference date) ---
    # SOGLIE CALIBRATE SUL CALENDARIO DI PUBBLICAZIONE REALE (v137 — fix "banner che grida al
    # lupo"): l'età è quella del REFERENCE date, e il dato più fresco AL MONDO può essere
    # legittimamente vecchio fino a: NFP/disocc. (ref M-01, esce il 1° venerdì di M+1, il
    # successivo ~35g dopo) → worst-case ~67g; CPI (esce metà M+1) → ~75g; retail (metà M+1)
    # → ~75g; PCE (esce FINE M+1: il ref M-01 resta il più recente fino a ~fine M+2) → ~91g;
    # UMich: FRED pubblica UMCSENT con 1-2 mesi di ritardo di licenza (il sito UMich è avanti
    # ma non abbiamo una fonte scrapabile stabile) → ~85g. Soglia = worst-case + margine:
    # così il flag scatta SOLO quando il dato è più vecchio di quanto il calendario permetta
    # (vera anomalia di fetch), non sull'attesa fisiologica della prossima release.
    MAX_AGE = {"cpi": 80, "pce": 95, "nfp": 70, "unemp": 70, "umich": 85, "retail": 80, "gdp": 210}
    for i in macro.get("indicators", []):
        k = i.get("key")
        if k not in MAX_AGE:
            continue
        a = age_of(i.get("date"))
        # threshold: un'inflazione a 0% o un PMI fuori [25,75] = spazzatura API → nullo
        num = None
        try:
            num = float(re.sub(r"[^\d.\-]", "", str(i.get("value"))))
        except Exception:  # noqa: BLE001
            pass
        if k in ("cpi", "pce") and num == 0:
            i["value"] = "n.d."
            add(k, i.get("date"), MAX_AGE[k], "implausible", "inflazione 0% = spazzatura API, valore nullato")
        elif k == "umich" and num is not None and not 30 <= num <= 120:
            i["value"] = "n.d."
            add(k, i.get("date"), MAX_AGE[k], "implausible", f"UMich {num} fuori range [30,120], nullato")
        else:
            add(k, i.get("date"), MAX_AGE[k], "ok" if (a is not None and a <= MAX_AGE[k]) else "stale")

    # --- VIX: alta frequenza, deve esserci ed essere plausibile a ogni run ---
    vix = macro.get("vix") or {}
    v = vix.get("value")
    if v is None:
        add("vix", None, 2, "missing")
    elif not 5 <= v <= 150:
        vix["value"] = None
        add("vix", None, 2, "implausible", f"VIX {v} fuori range [5,150], nullato")
    else:
        add("vix", today.isoformat(), 2, "ok")

    # --- Fed Funds: il tasso resta valido fino al prossimo FOMC, ma la rilevazione dev'esserci ---
    fm = macro.get("fed_market") or {}
    r = fm.get("current_rate")
    if r is None:
        add("fedfunds", fm.get("rate_date"), 60, "missing")
    elif not 0 < r < 10:
        fm["current_rate"] = None
        add("fedfunds", fm.get("rate_date"), 60, "implausible", f"tasso {r}% fuori range, nullato")
    else:
        add("fedfunds", fm.get("rate_date"), 60, "ok")

    # --- valutazione mercato (forward P/E, S&P P/E): se mancano il quadro leva è monco ---
    for k, obj in (("forward_pe", macro.get("forward_pe")), ("sp500_pe", macro.get("sp500_pe"))):
        val = (obj or {}).get("value") or (obj or {}).get("current")
        # v164: si timbrava today.isoformat() a prescindere → age_days sempre 0 e max_age=40 MAI
        # attivabile: un valore carry-forward fino a 45 giorni passava come "rilevato oggi, ok" e
        # guidava l'escalation "RISCHIO SISTEMICO ELEVATO". Ora si usa la data REALE del dato.
        _asof = (obj or {}).get("fetched_at") or (obj or {}).get("date") or today.isoformat()
        add(k, str(_asof)[:10], 40, "ok" if val is not None else "missing",
            "" if val is not None else "fonte ko in questo run: conferma leva/valutazioni impossibile")

    # --- news macro: LA FONTE CHE NESSUNO SORVEGLIAVA ---------------------------------
    # ⚠⚠ v389 — QUESTO CHECK NASCE DA UN GUASTO DURATO QUANTO LA FUNZIONALITA'. `import html`
    # mancava in questo file: tutte e tre le fonti RSS morivano con NameError dentro il loro
    # try/except per-fonte, `macro["news"]` non veniva MAI scritto, e il pacchetto per l'LLM —
    # che pubblica quel blocco solo se la chiave esiste — TACEVA. Non "nessuna notizia":
    # proprio nessuna riga sull'argomento.
    # Il CI lo stampava a ogni run ("!! news CNBC Economia: name 'html' is not defined") e
    # nessuno lo leggeva, perche' la pipeline usciva 0 e i dodici check di qualita' guardavano
    # tutti altrove. Dodici sorveglianti e una fonte scoperta: il guasto e' durato li'.
    # ⚠ La soglia e' sulle 48 ORE e non sulle 8 della finestra del pacchetto, ed e' deliberato:
    # la macro non esce di continuo e nel fine settimana non esce affatto, quindi zero notizie
    # in 8 ore e' un FATTO SUL MONDO. Zero in due giorni, invece, e' quasi sempre la fonte.
    nw = macro.get("news") or {}
    voci = nw.get("voci") or []
    if not voci:
        add("news_macro", None, 2, "missing",
            "nessuna voce raccolta in questo run: il pacchetto non potra' pubblicare titoli macro")
    else:
        piu_recente = None
        for v in voci:
            try:
                q = datetime.fromisoformat(str(v.get("quando")).replace("Z", "+00:00"))
                ore = (datetime.now(timezone.utc) - q).total_seconds() / 3600
                if piu_recente is None or ore < piu_recente:
                    piu_recente = ore
            except Exception:  # noqa: BLE001
                continue
        if piu_recente is None:
            add("news_macro", None, 2, "implausible", "nessuna voce con data leggibile")
        else:
            add("news_macro", str(today), 2,
                "ok" if piu_recente <= 48 else "stale",
                f"{len(voci)} voci, la piu' recente di {piu_recente:.0f} ore"
                + ("" if piu_recente <= 48 else " — oltre due giorni: sospetta una fonte caduta"))

    # --- fonti v390: ognuna nasce sorvegliata, non dopo il primo guasto -----------------
    # ⚠ La lezione delle news e' costata la vita intera della funzionalita': una fonte che
    # nessun check guarda puo' morire il giorno in cui nasce e nessuno se ne accorge. Queste
    # tre entrano nel gate insieme al codice che le scarica, non dopo.
    sc = macro.get("sec_calendario") or {}
    if not sc.get("per_titolo"):
        add("sec_calendario", None, 7, "missing",
            "EDGAR non ha risposto: le date delle trimestrali restano solo stime di yfinance")
    else:
        add("sec_calendario", str(today), 7, "ok",
            f"{len(sc['per_titolo'])} titoli con deposito reale"
            + (f", {len(sc.get('senza_8k') or [])} emittenti esteri senza 8-K" if sc.get("senza_8k") else ""))

    cb = macro.get("credito_banche") or {}
    for _k, _max in (("sloos", 200), ("nfci", 30)):   # SLOOS e' trimestrale, NFCI settimanale
        _v = cb.get(_k)
        if not _v:
            add(f"credito_{_k}", None, _max, "missing", "serie non disponibile in questo run")
        else:
            _a = age_of(_v.get("data"))
            add(f"credito_{_k}", _v.get("data"), _max,
                "ok" if (_a is not None and _a <= _max) else "stale")

    bce = macro.get("bce") or {}
    if not bce.get("tasso_rifinanziamento"):
        add("bce", None, 10, "missing", "BCE non raggiungibile: nessun tasso in euro in questo run")
    else:
        _a = age_of(bce.get("data"))
        # ⚠ il tasso BCE cambia solo alle riunioni, ma la serie e' GIORNALIERA: se smette di
        # aggiornarsi il valore resta plausibile e non si nota. L'eta' e' l'unico segnale.
        add("bce", bce.get("data"), 10, "ok" if (_a is not None and _a <= 10) else "stale")

    return {"checks": checks, "alerts": alerts,
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def seasonality_score(avg_pct, pos_pct):
    """Mappa rendimento medio mensile + % mesi positivi su 0-100 (alto = stagione favorevole)."""
    return round(clamp(50 + (pos_pct - 55) * 1.4 + avg_pct * 10))


def fetch_seasonality():
    """Stagionalità mensile storica di S&P 500 e Nasdaq 100: rendimento medio e % mesi positivi
    per ciascun mese del calendario. Alimenta il tachimetro del mese corrente e il grafico nel popup."""
    out = {}
    for key, sym in (("sp500", "^GSPC"), ("ndx", "^NDX")):
        try:
            h = yf.Ticker(sym).history(period="max", interval="1mo")["Close"].dropna()
            ret = h.pct_change().dropna()
            buckets = {m: [] for m in range(1, 13)}
            for dt, r in ret.items():
                buckets[dt.month].append(float(r) * 100)
            months = []
            for m in range(1, 13):
                vals = buckets[m]
                if vals:
                    avg = sum(vals) / len(vals)
                    pos = sum(1 for v in vals if v > 0) / len(vals) * 100
                    months.append({"m": m, "avg": round(avg, 2), "pos": round(pos, 1),
                                   "n": len(vals), "score": seasonality_score(avg, pos)})
                else:
                    months.append({"m": m, "avg": None, "pos": None, "n": 0, "score": 50})
            out[key] = months
        except Exception as e:  # noqa: BLE001
            print(f"!! stagionalità {sym}: {e}", file=sys.stderr)
    cur_m = datetime.now(timezone.utc).month
    sp_cur = next((x for x in out.get("sp500", []) if x["m"] == cur_m), None)
    ndx_cur = next((x for x in out.get("ndx", []) if x["m"] == cur_m), None)
    scores = [x["score"] for x in (sp_cur, ndx_cur) if x]
    blended = round(sum(scores) / len(scores)) if scores else 50
    label = "Favorevole" if blended >= 60 else "Sfavorevole" if blended <= 40 else "Neutrale"
    return {
        **out,
        "current_month": cur_m,
        "sp_score": sp_cur["score"] if sp_cur else None,
        "ndx_score": ndx_cur["score"] if ndx_cur else None,
        "score": blended,
        "label": label,
    }


# (ticker, nome, gruppo) — settori SPDR + principali ETF tematici per la heatmap
SECTOR_ETF = {
    "XLK": ("Tecnologia", "Settori"), "XLF": ("Finanziari", "Settori"),
    "XLE": ("Energia", "Settori"), "XLV": ("Salute", "Settori"),
    "XLY": ("Consumi discr.", "Settori"), "XLP": ("Consumi difens.", "Settori"),
    "XLI": ("Industriali", "Settori"), "XLU": ("Utilities", "Settori"),
    "XLB": ("Materiali", "Settori"), "XLRE": ("Immobiliare", "Settori"),
    "XLC": ("Comunicazioni", "Settori"),
    "SMH": ("Semiconduttori", "Tematici"), "IGV": ("Software", "Tematici"),
    "SKYY": ("Cloud", "Tematici"), "ARKK": ("Innovazione", "Tematici"),
    "TAN": ("Solare", "Tematici"), "XBI": ("Biotech", "Tematici"),
    "ITA": ("Difesa/Aerospazio", "Tematici"), "IBB": ("Pharma/Bio", "Tematici"),
    "GLD": ("Oro", "Materie prime"), "IYT": ("Trasporti", "Tematici"),
}


def _opt_rows(df, n_each, atm_idx):
    """Riduce un DataFrame di opzioni a una finestra di strike attorno all'ATM."""
    lo = max(0, atm_idx - n_each)
    hi = atm_idx + n_each + 1
    out = []
    for _, o in df.iloc[lo:hi].iterrows():
        out.append({
            "strike": round(float(o["strike"]), 2),
            "bid": None if pd.isna(o["bid"]) else round(float(o["bid"]), 2),
            "ask": None if pd.isna(o["ask"]) else round(float(o["ask"]), 2),
            # IV: 0.0 è un glitch del feed, non un dato — meglio n.d. che uno zero che distorce il pricing
            "iv": (round(float(o["impliedVolatility"]) * 100, 1)
                   if not pd.isna(o.get("impliedVolatility")) and float(o["impliedVolatility"]) > 0.001 else None),
            "vol": int(o["volume"]) if not pd.isna(o["volume"]) else 0,
            "oi": int(o["openInterest"]) if not pd.isna(o["openInterest"]) else 0,
        })
    return out


def fetch_options_chain(symbols, n_strikes=12, n_expiries=3):
    """Catena opzioni reale (Yahoo via yfinance, gestisce crumb/cookie lato server).
    Per ogni titolo: spot, volume medio, e per le prossime scadenze una finestra di
    strike attorno all'ATM con bid/ask/IV/volume/open interest, più Call/Put Wall e
    l'impatto delle opzioni (volume opzioni in azioni equivalenti vs volume medio)."""
    out = {}
    for raw in symbols:
        sym = TICKER_ALIAS.get(raw.strip().upper(), raw.strip())
        try:
            t = yf.Ticker(sym)
            exps = list(getattr(t, "options", []) or [])
            if not exps:
                continue
            hist = t.history(period="1mo", interval="1d", auto_adjust=True)
            spot = float(hist["Close"].dropna().iloc[-1]) if not hist.empty else None
            avg_vol = float(hist["Volume"].dropna().tail(20).mean()) if not hist.empty else None
            expiries = []
            today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            for ed in exps[:n_expiries + 1]:
                # 0DTE (scadenza odierna): chain instabile/degenere a ridosso della chiusura —
                # i "wall" che ne escono sono rumore (visto AMD spot $546 con wall $40). Salto.
                if ed <= today_iso:
                    continue
                if len(expiries) >= n_expiries:
                    break
                try:
                    ch = t.option_chain(ed)
                except Exception:  # noqa: BLE001
                    continue
                calls = ch.calls.sort_values("strike").reset_index(drop=True)
                puts = ch.puts.sort_values("strike").reset_index(drop=True)
                if calls.empty and puts.empty:
                    continue
                ref = spot if spot else float(calls["strike"].median())
                atm_c = int((calls["strike"] - ref).abs().idxmin()) if not calls.empty else 0
                atm_p = int((puts["strike"] - ref).abs().idxmin()) if not puts.empty else 0
                # WALL SANITY: il max-OI va cercato SOLO tra strike plausibili (0.5×–2× lo spot).
                # Gli strike-relitto (adjusted options post split/eventi) hanno OI residuo su
                # livelli assurdi e senza filtro "vincono" producendo muri fuori dal mondo.
                # finestra LATO-SPECIFICA: il CALL WALL è resistenza (strike ≳ spot), il PUT WALL
                # è supporto (strike ≲ spot). La vecchia banda simmetrica [0,5×–2×] lasciava
                # passare mostri come SNDK PW $2650 su spot $1411 (put wall SOPRA lo spot) o CW $930
                # SOTTO: relitti/adjusted options, non livelli di mercato. ±5% attorno allo spot
                # per tollerare i wall ATM.
                def _wall(df, above):
                    if df.empty or not df["openInterest"].notna().any():
                        return None
                    if ref:
                        win = df[(df["strike"] >= ref * 0.95) & (df["strike"] <= ref * 2.0)] if above \
                            else df[(df["strike"] >= ref * 0.5) & (df["strike"] <= ref * 1.05)]
                    else:
                        win = df
                    if win.empty or not win["openInterest"].notna().any():
                        return None
                    return float(win.loc[win["openInterest"].idxmax(), "strike"])
                call_wall = _wall(calls, True)
                put_wall = _wall(puts, False)
                # firma di chain artefatta: max-OI di call E put sullo STESSO strike lontano
                # dallo spot (>25%) = relitto/adjusted options, non un livello di mercato
                if (call_wall is not None and call_wall == put_wall and ref
                        and abs(call_wall / ref - 1) > 0.25):
                    call_wall = put_wall = None
                opt_vol = int(pd.concat([calls["volume"], puts["volume"]]).fillna(0).sum())
                expiries.append({
                    "date": ed,
                    "calls": _opt_rows(calls, n_strikes, atm_c),
                    "puts": _opt_rows(puts, n_strikes, atm_p),
                    "call_wall": round(call_wall, 2) if call_wall else None,
                    "put_wall": round(put_wall, 2) if put_wall else None,
                    "opt_volume": opt_vol,
                })
            if expiries:
                out[sym] = {"spot": round(spot, 2) if spot else None,
                            "avg_volume": int(avg_vol) if avg_vol else None,
                            "expiries": expiries}
        except Exception as e:  # noqa: BLE001
            print(f"!! opzioni {sym}: {e}", file=sys.stderr)
        time.sleep(0.3)
    return out


def fetch_sector_tilt():
    """Rotazione settoriale/tematica USA: momentum 1M e 3M degli ETF.
    I primi in classifica sono quelli su cui ruotare (overweight)."""
    rows = []
    try:
        # ⚠ v305 — TRE ANNI, NON SEI MESI. Con 126 barre non si calcola una media a 200
        # sedute ne' si misura un ciclo di settore: servono per l'"anatomia" — dove sta il
        # prezzo rispetto alle sue medie e se quelle medie salgono o scendono. Sei mesi
        # bastavano al momentum 1M/3M, non a dire se una corsa e' ancora viva.
        data = yf.download(list(SECTOR_ETF) + ["SPY", "QQQ"], period="6y", interval="1d",
                           auto_adjust=True, progress=False)["Close"]
        for sym, (name, group) in SECTOR_ETF.items():
            try:
                s = data[sym].dropna()
                last = float(s.iloc[-1])
                m1 = (last / float(s.iloc[-22]) - 1) * 100
                m3 = (last / float(s.iloc[-66]) - 1) * 100
                d1 = (last / float(s.iloc[-2]) - 1) * 100
                # ⚠ v298 — LE PRIME CINQUE DEL COMPARTO, richiesta del CEO: "quando passo il
                # mouse sopra ad una barra mostrami le prime 5 azioni di rilevanza del comparto".
                # Sono le PARTECIPAZIONI VERE dell'ETF col loro peso, non un elenco scritto a
                # mano: un registro di titoli compilato da me invecchierebbe da solo alla prima
                # ribilanciata del fondo — la classe C10 / red team I6, gia' pagata piu' volte.
                # Se il fornitore non le da', il campo resta assente e il tooltip tace: meglio
                # niente che cinque nomi vecchi presentati come attuali.
                prime = []
                try:
                    th = getattr(getattr(yf.Ticker(sym), "funds_data", None), "top_holdings", None)
                    if th is not None and len(th):
                        for tk_h, riga in th.head(5).iterrows():
                            peso = riga.get("Holding Percent")
                            prime.append({"tk": str(tk_h),
                                          "nome": str(riga.get("Name") or tk_h)[:38],
                                          "peso": round(float(peso) * 100, 1) if peso is not None else None})
                except Exception:  # noqa: BLE001
                    pass
                # ═══ v305 — L'ANATOMIA DEL CICLO DI SETTORE ═══════════════════════════
                # Dall'analisi che il CEO ha portato: per capire se una corsa di settore e'
                # finita servono DUE ingredienti, e uno solo e' misurabile con dati gratuiti.
                #   (a) chi possiede le azioni — istituzionali o retail. NON lo abbiamo: i
                #       flussi retail negli ETF non hanno una fonte gratuita affidabile e i
                #       13F sono trimestrali e in ritardo. Resta DICHIARATO come mancante.
                #   (b) il MOMENTUM — dove sta il prezzo rispetto alle sue medie e se quelle
                #       medie salgono. Questo si calcola esattamente, ed e' cio' che
                #       distingue il 1998 (scossone del 20% con le medie ancora in salita,
                #       poi +300%) dal 2000 (medie girate, e li' e' finita).
                # ⚠ SI CALCOLA SOLO CIO' CHE LE BARRE PERMETTONO: con meno barre di quante
                # ne chiede una media, la media NON si pubblica. Una MA200 su 150 barre e'
                # un numero che sembra piu' solido di quanto e'.
                medie = {}
                for n_ma in (20, 50, 100, 200):
                    if len(s) >= n_ma + 21:
                        m_ora = float(s.iloc[-n_ma:].mean())
                        m_prima = float(s.iloc[-n_ma - 21:-21].mean())   # ~un mese fa
                        medie[f"ma{n_ma}"] = {
                            "valore": round(m_ora, 2),
                            "dist_pct": round((last / m_ora - 1) * 100, 1),
                            # la PENDENZA e' il segnale del video: media che sale = musica che suona
                            "pendenza_pct": round((m_ora / m_prima - 1) * 100, 2),
                        }
                # forza relativa contro il mercato e contro il Nasdaq, sugli orizzonti che
                # contano per un ciclo di settore (il video confronta +200% contro +35%)
                rel = {}
                for et, n_g in (("m6", 126), ("a1", 252), ("a2", 504), ("a5", 1260)):
                    if len(s) > n_g:
                        r_et = (last / float(s.iloc[-n_g]) - 1) * 100
                        voci = {"settore": round(r_et, 1)}
                        for bench, chiave in (("SPY", "spy"), ("QQQ", "qqq")):
                            try:
                                b = data[bench].dropna()
                                if len(b) > n_g:
                                    voci[chiave] = round((float(b.iloc[-1]) / float(b.iloc[-n_g]) - 1) * 100, 1)
                            except Exception:  # noqa: BLE001
                                pass
                        rel[et] = voci
                # ⚠ le azioni in circolazione di un ETF cambiano con creazioni e riscatti:
                # la loro VARIAZIONE e' il flusso netto. Il livello assoluto qui NON e'
                # affidabile (yfinance dava 11,7M azioni x 584 NAV = 6,8 mld contro
                # `totalAssets` 68 mld: dieci volte di scarto), quindi si registra e basta.
                # Diventera' un flusso quando ci sara' abbastanza storia per misurarlo — non
                # si pubblica un numero prima di poterlo verificare.
                azioni = None
                try:
                    azioni = (yf.Ticker(sym).get_info() or {}).get("sharesOutstanding")
                except Exception:  # noqa: BLE001
                    pass
                rows.append({"ticker": sym, "name": name, "group": group,
                             "medie": medie or None, "relativa": rel or None,
                             "azioni_in_circolazione": azioni,
                             "asof": bar_asof(s),         # v261: la barra della rotazione
                             "price": round(last, 2), "d1": round(d1, 2),
                             "m1": round(m1, 1), "m3": round(m3, 1),
                             "prime": prime,
                             "score": round(clamp(50 + (m1 * 0.6 + m3 * 0.4) * 2.5))})
            except Exception:  # noqa: BLE001
                continue
        rows.sort(key=lambda x: x["m1"] + x["m3"], reverse=True)
    except Exception as e:  # noqa: BLE001
        print(f"!! sector tilt: {e}", file=sys.stderr)
    return rows


def quadruple_witching():
    """Le 'quattro streghe': 3° venerdì di mar/giu/set/dic (scadenza simultanea di
    opzioni e futures su indici e su singole azioni)."""
    def third_friday(y, m):
        d = datetime(y, m, 1)
        # primo venerdì
        d += timedelta(days=(4 - d.weekday()) % 7)
        return d + timedelta(days=14)
    today = datetime.now(timezone.utc).replace(tzinfo=None)
    dates = []
    for y in (today.year, today.year + 1):
        for m in (3, 6, 9, 12):
            tf = third_friday(y, m)
            if tf >= today:
                dates.append(tf.strftime("%Y-%m-%d"))
    nxt = dates[0] if dates else None
    days = (datetime.strptime(nxt, "%Y-%m-%d") - today).days if nxt else None
    return {
        "next": nxt, "days": days, "upcoming": dates[:4],
        "contracts": ["Opzioni su indici azionari", "Futures su indici azionari",
                      "Opzioni su singole azioni", "Futures su singole azioni"],
    }


# BofA "Bear Market Signposts" — baseline maggio 2026; i derivabili si aggiornano da FRED
SIGNPOSTS_BASE = [
    ("Fiducia consumatori > 100", "Sentiment", False, "Consumer confidence >100", "FRED UMCSENT"),
    ("Aspettative sui prezzi azionari", "Sentiment", True, "Stock price expectations", "BofA Sentiment"),
    ("Sell-Side Indicator BofA", "Sentiment", False, "Indicatore contrarian BofA", "BofA SSI"),
    ("Aspettative crescita utili LT", "Sentiment", True, "Long-term growth expectations", "S&P 500 Growth"),
    ("Volume operazioni M&A", "Sentiment", True, "Number of M&A deals", "TradingEconomics"),
    ("Regola del 20 (P/E + CPI)", "Valutazione", True, "P/E + inflazione", "Current Mkt Valuation"),
    ("Divario titoli costosi/economici", "Valutazione", True, "Cheap vs expensive stocks", "Growth vs Value"),
    ("Curva dei rendimenti invertita", "Macro", False, "Inverted yield curve", "FRED T10Y2Y"),
    ("Stress sul credito", "Macro", True, "Credit stress indicator", "FRED STLFSI3"),
    ("Inasprimento criteri di prestito", "Macro", True, "Tightening lending standards", "FRED SLOOS"),
]


def fetch_signposts():
    """10 segnali BofA: aggiorna da FRED quelli calcolabili, mantiene la baseline per gli altri."""
    items = [{"name": n, "category": c, "status": s, "desc": d, "source": src}
             for n, c, s, d, src in SIGNPOSTS_BASE]
    def setstatus(name, val):
        """Marca la voce come CALCOLATA: e' l'unico modo per distinguerla da una costante."""
        for it in items:
            if it["name"] == name:
                it["status"] = bool(val)
                it["calcolato"] = True
    try:  # fiducia consumatori > 100
        setstatus("Fiducia consumatori > 100", fred_series("UMCSENT", 1)[-1][1] > 100)
    except Exception:  # noqa: BLE001
        pass
    try:  # curva invertita (10A-2A < 0)
        setstatus("Curva dei rendimenti invertita", fred_series("T10Y2Y", 1)[-1][1] < 0)
    except Exception:  # noqa: BLE001
        pass
    try:  # stress sul credito (St. Louis Fed Financial Stress > 0)
        setstatus("Stress sul credito", fred_series("STLFSI4", 1)[-1][1] > 0)
    except Exception:  # noqa: BLE001
        try:
            setstatus("Stress sul credito", fred_series("STLFSI3", 1)[-1][1] > 0)
        except Exception:  # noqa: BLE001
            pass
    try:  # banche che inaspriscono i criteri (SLOOS > 0)
        setstatus("Inasprimento criteri di prestito", fred_series("DRTSCILM", 1)[-1][1] > 0)
    except Exception:  # noqa: BLE001
        pass
    # ⚠⚠ v329 — "5/10 ACCESI" NON ERA UN CONTEGGIO, ERA UN PAVIMENTO. Solo QUATTRO voci si
    # calcolano da FRED (fiducia, curva, stress credito, criteri di prestito) e oggi sono tutte
    # e quattro SPENTE; le altre sei sono costanti di baseline, di cui cinque accese. Il numero
    # pubblicato non poteva scendere sotto cinque qualunque cosa facesse il mercato, e veniva
    # presentato come una misura. Ora ogni voce dichiara se e' calcolata, e il conteggio che
    # conta e' quello sulle calcolabili.
    calcolabili = sum(1 for it in items if it.get("calcolato"))
    accesi_calc = sum(1 for it in items if it.get("calcolato") and it["status"])
    active = sum(1 for it in items if it["status"])
    return {"items": items, "active": active, "total": len(items),
            "calcolabili": calcolabili, "accesi_calcolabili": accesi_calc,
            "pct": round(accesi_calc / calcolabili * 100) if calcolabili else None}


def translate_it(text):
    """Traduzione gratuita via endpoint pubblico di Google Translate."""
    try:
        url = ("https://translate.googleapis.com/translate_a/single"
               "?client=gtx&sl=auto&tl=it&dt=t&q=" + urllib.parse.quote(text))
        seg = http_get(url, tries=1, timeout=10).json()[0]
        out = "".join(s[0] for s in seg if s and s[0]).strip()
        return out or None
    except Exception:  # noqa: BLE001
        return None


def fetch_portfolio_history(btp_value_eur):
    """Valore del portafoglio (EUR) nel tempo, a composizione attuale, con benchmark
    Nasdaq sovrapponibile. Serie: 1S / 1M / 3M / 12M / 5A / Max."""
    tickers = [p["ticker"] for p in PORTFOLIO]
    qty = {p["ticker"]: p["qty"] for p in PORTFOLIO}
    benches = {"nasdaq": "^IXIC", "ndx": "^NDX", "sp500": "^GSPC", "russell": "^RUT"}
    try:
        data = yf.download(tickers + list(benches.values()), period="5y", interval="1d",
                           auto_adjust=True, progress=False)["Close"]
        if isinstance(data, pd.Series):
            data = data.to_frame()
        fx = yf.Ticker("EURUSD=X").history(period="5y")["Close"]
        fx.index = fx.index.tz_localize(None)
        data.index = pd.to_datetime(data.index).tz_localize(None)
        bench_series = {k: data[sym] for k, sym in benches.items() if sym in data.columns}
        df = data[tickers].dropna()              # parte da quando tutti i titoli esistono
        if df.empty:
            return None
        eur = fx.reindex(df.index, method="ffill").bfill()
        usd_val = sum(df[t] * qty[t] for t in tickers if t in df.columns)
        total = (usd_val / eur + btp_value_eur).dropna()

        def series(window):
            s = total if window is None else total.tail(window)
            step = max(1, len(s) // 120)
            s = s.iloc[::step]
            out = {"dates": [d.strftime("%Y-%m-%d") for d in s.index],
                   "values": [round(float(v)) for v in s.values]}
            base_p = float(s.iloc[0])
            for k, ser in bench_series.items():   # indici riscalati al valore iniziale del periodo
                n = ser.reindex(s.index, method="ffill")
                if len(n) and n.iloc[0]:
                    out[k] = [round(float(x) / float(n.iloc[0]) * base_p) for x in n.values]
            return out

        out = {"w1": series(5), "m1": series(22), "m3": series(66),
               "y1": series(252), "y5": series(None), "all": series(None)}
        # àncora la curva al controvalore reale degli investimenti (l'ultimo punto = valore reale, liquidità esclusa)
        if BROKER and (BROKER.get("controvalore_investimenti") or BROKER.get("controvalore_totale")):
            real = float(BROKER.get("controvalore_investimenti") or BROKER["controvalore_totale"])
            for s in out.values():
                if s["values"]:
                    k = real / s["values"][-1]
                    s["values"] = [round(v * k) for v in s["values"]]
                    for bk in ("nasdaq", "ndx", "sp500", "russell"):
                        if bk in s:
                            s[bk] = [round(v * k) for v in s[bk]]
        # benchmark ALLINEATO alla curva reale del broker (vista Max stitchata lato frontend):
        # i titoli di nuova quotazione (es. IPO recenti) accorciano la storia del portafoglio,
        # ma gli indici esistono da anni → li riscaliamo sulle date reali del broker.
        if BROKER and BROKER.get("equity_curve"):
            ec = BROKER["equity_curve"]
            ec_dates = pd.to_datetime([p["d"] for p in ec])
            base_v = float(ec[0]["v"])
            bb = {"dates": [p["d"] for p in ec]}
            for k, ser in bench_series.items():
                n = ser.reindex(ec_dates, method="ffill").ffill().bfill()
                if len(n) and float(n.iloc[0]):
                    bb[k] = [round(float(x) / float(n.iloc[0]) * base_v) for x in n.values]
            out["broker_bench"] = bb
        return out
    except Exception as e:  # noqa: BLE001
        print(f"!! storico portafoglio: {e}", file=sys.stderr)
        return None








def fetch_predictions(limit=6):
    """Mercati di previsione Polymarket su temi macro/finanza (sezione separata)."""
    ms = []
    for order in ("volume24hr", "volumeNum"):   # i più attivi oggi sono i macro reali
        try:
            ms += http_get("https://gamma-api.polymarket.com/markets"
                           f"?closed=false&active=true&order={order}&ascending=false&limit=150").json()
        except Exception as e:  # noqa: BLE001
            print(f"!! polymarket ({order}): {e}", file=sys.stderr)
    # macro/finanza puri (Fed, inflazione, recessione, mercati, crypto)
    pat = re.compile(r"\bfed\b|rate cut|interest rate|\binflation\b|recession|s&p|nasdaq|"
                     r"\bbitcoin\b|ethereum|\bgdp\b|tariff|powell|shutdown|\bcpi\b|jobs report|"
                     r"debt ceiling|stock market|\bnvidia\b|\btesla\b|\beconomy\b|jerome", re.I)
    skip = re.compile(r"world cup|fifa|super bowl|oscar|grammy|nba|nfl|soccer|jesus|"
                      r"oprah|taylor swift|champions league|lebron|movie|album|"
                      r"\bufc\b|tennis|olympic|nobel|miss universe|grand slam", re.I)
    out, seen = [], set()
    for m in ms:
        q = (m.get("question") or "").strip()
        if not q or q in seen or not pat.search(q) or skip.search(q):
            continue
        try:
            pr = m.get("outcomePrices")
            pr = json.loads(pr) if isinstance(pr, str) else pr
            yes = round(float(pr[0]) * 100)
        except Exception:  # noqa: BLE001
            continue
        if yes < 2:                             # scarta solo i mercati quasi impossibili
            continue
        seen.add(q)
        slug = m.get("slug", "")
        out.append({"question": q, "yes": yes,
                    "link": f"https://polymarket.com/event/{slug}" if slug else "https://polymarket.com"})
        if len(out) >= limit:
            break
    return out


# lessico per il sentiment rule-based delle news (mercato)
BULL_WORDS = re.compile(r"\b(surge|soar|rally|jump|beat|beats|record|高|gain|gains|upgrade|"
                        r"bullish|outperform|tops|wins|approval|breakthrough|strong|boost|"
                        r"rises?|climb|optimis|profit|growth|cut rates?)\b", re.I)
BEAR_WORDS = re.compile(r"\b(plunge|slump|crash|fall|falls|drop|drops|miss|misses|downgrade|"
                        r"bearish|underperform|warning|warns|lawsuit|probe|recall|cut[s]? guidance|"
                        r"layoff|tariff|sanction|war|conflict|fear|selloff|loss|losses|weak|slowdown|ban)\b", re.I)








STOPWORDS = set("the a an of to in on for and or with at by from is are be as has have new "
                "il lo la i gli le di a da in con su per tra fra e o un una che è ha "
                "after before says will would could after amid over into out up down "
                "us usa dopo prima oltre verso più meno come".split())


def topic_key(title):
    """Parole significative del titolo, per riconoscere notizie sullo stesso argomento."""
    words = re.findall(r"[a-zàèéìòù0-9]{4,}", title.lower())
    return {w for w in words if w not in STOPWORDS}


def is_duplicate_topic(key, kept_keys):
    for k in kept_keys:
        union = key | k
        if union and len(key & k) / len(union) >= 0.5:   # >=50% di parole in comune
            return True
    return False




def clean_nan(obj):
    """Converte ricorsivamente NaN/Infinity in None (JSON valido per il browser)."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: clean_nan(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_nan(v) for v in obj]
    return obj


def _macro_scores(macro):
    """Punteggi 0-100 di ogni indicatore macro, per accumularne lo storico (v224).

    Le chiavi coincidono con quelle usate dalla dashboard (`in:<key>` per gli indicatori USA,
    `mk:<key>` per i mercati, il nome nudo per i compositi), cosi' la UI li ritrova senza una
    seconda tabella di corrispondenze da tenere allineata — il tipo di registro che in questo
    progetto e' gia' costato caro (C10).
    """
    out = {}
    for k in ("fear_greed", "risk_sentiment", "credit", "systemic_risk", "corp_profit",
              "sp500_pe", "smart_money", "macroquant", "seasonality", "thermometer"):
        v = (macro.get(k) or {}).get("score")
        if isinstance(v, (int, float)):
            out[k] = round(float(v))
    for i in macro.get("indicators") or []:
        if isinstance(i.get("impact"), (int, float)):
            out["in:" + i["key"]] = round(float(i["impact"]))
    sp = macro.get("signposts") or {}
    if isinstance(sp.get("pct"), (int, float)):
        out["signposts"] = round(100 - float(sp["pct"]))
    return out


def compute_risk_metrics(rows, watch_rows=None):
    """Motore di rischio istituzionale sul pannello dei LOG-rendimenti giornalieri allineati (12M).
    Pesi = controvalore ATTUALE mark-to-market (mai il costo storico). Calcola e annota:
    - Sharpe di portafoglio (media/covarianza dei log-return, Rf in spazio log);
    - beta vs Nasdaq 100 per titolo via regressione OLS (cov/var sui log-return), NON il
      beta 5A-mensile-vs-S&P ereditato dalle API Yahoo;
    - beta di portafoglio = Σ w_i·beta_i (pesi MTM);
    - matrice di correlazione: per ogni titolo correlazione MEDIA e MASSIMA vs il resto
      del portafoglio (per la watchlist: vs le posizioni possedute → filtro d'ingresso);
    - MCR: contributo marginale al rischio, quota % della varianza totale di portafoglio
      attribuibile a ogni posizione (w_i·(Σw)_i / wᵀΣw).
    Ritorna {"sharpe", "portfolio_beta_ndx", "avg_pairwise_corr"} e annota le row in place."""
    series, weights = {}, {}
    for r in rows:
        rs, ds = r.get("_ret_series"), r.get("_ret_dates")
        val = r.get("value") if r.get("value") is not None else r.get("controvalore")
        if rs and ds and val and len(rs) == len(ds) and len(rs) >= 60:
            series[r["ticker"]] = pd.Series(rs, index=pd.to_datetime(ds))
            weights[r["ticker"]] = float(val)
    if not series:
        return None
    df = pd.DataFrame(series).dropna()
    if df.shape[0] < 60 or df.shape[1] < 1:
        return None
    tickers = list(df.columns)
    w = np.array([weights[t] for t in tickers], dtype=float)
    if w.sum() <= 0:
        return None
    w = w / w.sum()

    def _naive(ix):
        """DatetimeIndex normalizzato e senza timezone (yfinance è tz-aware, le serie interne no)."""
        ix = pd.to_datetime(ix)
        if getattr(ix, "tz", None) is not None:
            ix = ix.tz_localize(None)
        return ix.normalize()

    # --- benchmark NDX: log-rendimenti giornalieri 12 mesi per il beta di regressione ---
    ndx_ret = None
    try:
        nh = yf.Ticker("^NDX").history(period="1y", interval="1d", auto_adjust=True)["Close"].dropna()
        ndx_ret = np.log(nh / nh.shift(1)).replace([np.inf, -np.inf], np.nan).dropna()
        ndx_ret.index = _naive(ndx_ret.index)
    except Exception as e:  # noqa: BLE001
        print(f"!! NDX per beta: {e}", file=sys.stderr)

    def beta_vs_ndx(s):
        if ndx_ret is None or len(ndx_ret) < 60:
            return None
        si = s.copy()
        si.index = _naive(si.index)
        pair = pd.concat([si, ndx_ret], axis=1, join="inner").dropna()
        if pair.shape[0] < 60:
            return None
        var_b = float(pair.iloc[:, 1].var(ddof=1))
        if var_b <= 0:
            return None
        return round(float(pair.iloc[:, 0].cov(pair.iloc[:, 1])) / var_b, 2)

    # --- beta NDX per titolo del portafoglio + beta pesato MTM ---
    betas = {}
    for t in tickers:
        betas[t] = beta_vs_ndx(df[t])
    port_beta = None
    known = [(w[i], betas[t]) for i, t in enumerate(tickers) if betas[t] is not None]
    if known:
        wk = sum(x[0] for x in known)
        if wk > 0:
            port_beta = round(sum(x[0] * x[1] for x in known) / wk, 2)

    # --- correlazioni: media e massima di ogni titolo vs il RESTO del portafoglio ---
    corr = df.corr()
    avg_pairwise = None
    if len(tickers) >= 2:
        off = corr.values[np.triu_indices(len(tickers), k=1)]
        avg_pairwise = round(float(np.nanmean(off)), 2) if off.size else None
    corr_notes = {}
    for t in tickers:
        others = [o for o in tickers if o != t]
        if not others:
            continue
        vals = corr.loc[t, others]
        corr_notes[t] = {"avg_corr": round(float(vals.mean()), 2),
                         "max_corr": round(float(vals.max()), 2),
                         "max_corr_with": str(vals.idxmax())}

    # --- MCR: quota % della varianza di portafoglio attribuibile a ogni posizione ---
    cov_d = df.cov().values
    port_var_d = float(w @ cov_d @ w)
    mcr = {}
    if port_var_d > 0:
        contrib = w * (cov_d @ w) / port_var_d * 100          # somma = 100%
        mcr = {t: round(float(c), 1) for t, c in zip(tickers, contrib)}

    # --- Sharpe di portafoglio sui log-return (Rf coerente in spazio log) ---
    mean_d = df.mean().values
    port_mean_annual = float(np.dot(w, mean_d)) * TRADING_DAYS
    port_sigma = (port_var_d * TRADING_DAYS) ** 0.5
    rf_log = math.log1p(RISK_FREE_RATE)
    sharpe = round((port_mean_annual - rf_log) / port_sigma, 2) if port_sigma > 0 else None

    # --- Sortino: come lo Sharpe ma col solo rischio NEGATIVO (downside deviation).
    # Su un portafoglio growth lo Sharpe punisce anche i rally; il Sortino separa la
    # varianza "cattiva" (perdite sotto Rf) da quella buona. Stesso pannello, stessa Rf. ---
    sortino = None
    port_ret_d = df.values @ w                                 # serie giornaliera del portafoglio
    downside = np.minimum(port_ret_d - rf_log / TRADING_DAYS, 0.0)
    dd_annual = float(np.sqrt(np.mean(downside ** 2)) * (TRADING_DAYS ** 0.5))
    if dd_annual > 0:
        sortino = round((port_mean_annual - rf_log) / dd_annual, 2)

    # --- VaR/ES 1 giorno al 95%: % del controvalore azionario a rischio nel 5% dei
    # giorni peggiori; l'Expected Shortfall è la perdita MEDIA quando il VaR viene
    # superato. Due stime: STORICA (percentile empirico della serie di portafoglio —
    # onesta sulle code grasse dei titoli volatili, è quella primaria) e parametrica
    # normale (media 0 per prudenza — sottostima le code by design, resta come confronto).
    # In € li converte main(). ---
    sigma_1d = port_var_d ** 0.5
    var95_1d_pct = round(1.645 * sigma_1d * 100, 2)
    es95_1d_pct = round(2.063 * sigma_1d * 100, 2)
    var95_hist_pct = es95_hist_pct = None
    if len(port_ret_d) >= 100:
        q05 = float(np.quantile(port_ret_d, 0.05))
        tail = port_ret_d[port_ret_d <= q05]
        if q05 < 0:
            var95_hist_pct = round(-q05 * 100, 2)
            if len(tail):
                es95_hist_pct = round(-float(np.mean(tail)) * 100, 2)

    # --- annota le row del portafoglio ---
    for r in rows:
        t = r["ticker"]
        if t in betas and betas[t] is not None:
            r["beta_ndx"] = betas[t]
        if t in corr_notes:
            r.update(corr_notes[t])
        if t in mcr:
            r["risk_contrib_pct"] = mcr[t]

    # --- watchlist: correlazione e beta NDX vs le posizioni POSSEDUTE (filtro d'ingresso) ---
    for r in (watch_rows or []):
        rs, ds = r.get("_ret_series"), r.get("_ret_dates")
        if not (rs and ds and len(rs) == len(ds) and len(rs) >= 60):
            continue
        s = pd.Series(rs, index=pd.to_datetime(ds))
        b = beta_vs_ndx(s)
        if b is not None:
            r["beta_ndx"] = b
        joined = pd.concat([s.rename("_wl"), df], axis=1, join="inner").dropna()
        if joined.shape[0] >= 60 and len(tickers) >= 1:
            cvals = joined.corr().loc["_wl", tickers]
            r["avg_corr"] = round(float(cvals.mean()), 2)
            r["max_corr"] = round(float(cvals.max()), 2)
            r["max_corr_with"] = str(cvals.idxmax())

    return {"sharpe": sharpe, "sortino": sortino, "portfolio_beta_ndx": port_beta,
            "avg_pairwise_corr": avg_pairwise,
            "var95_1d_pct": var95_1d_pct, "es95_1d_pct": es95_1d_pct,
            "var95_hist_pct": var95_hist_pct, "es95_hist_pct": es95_hist_pct}


def ratchet_stops(rows, prev_by_ticker):
    """Trailing stop 2×ATR(14) con RATCHET: sale col prezzo, NON ridiscende quando il
    titolo scende — uno stop che si riabbassa da solo non è uno stop. Ancoraggio:
    stop = max(stop del run precedente, prezzo − 2×ATR). Se il prezzo chiude sotto lo
    stop ancorato → stop_violated=True e il livello resta congelato finché il prezzo
    non risale sopra o la posizione cambia. Il ratchet si RESETTA se qty/PMC cambiano
    (nuovo trade → nuovo trailing). Solo posizioni possedute con ATR disponibile."""
    for r in rows:
        price, atr = r.get("price"), r.get("atr_14")
        # BLINDATURA v115: NaN è truthy in Python — il vecchio guard lo lasciava passare e
        # max(prev, nan) propagava nan sullo stop. Prezzo finito e >0 obbligatorio.
        if not (r.get("qty") and _finite_pos(price)):
            continue
        prev = prev_by_ticker.get(r["ticker"]) or {}
        prev_stop = prev.get("stop_atr")
        # prev plausibile: finito, >0, non oltre 3× il prezzo (uno stop ancorato può stare
        # LEGITTIMAMENTE sopra il prezzo dopo un crollo — violato e congelato — ma 3× è
        # solo il residuo di un run avvelenato: si riparte dal calcolo pulito)
        prev_ok = _finite_pos(prev_stop) and prev_stop <= price * 3
        same_pos = prev.get("qty") == r.get("qty") and prev.get("pmc") == r.get("pmc")
        raw = price - 2 * atr if _finite_pos(atr) else None
        # ATR assente/NaN in QUESTO run: lo stop ANCORATO di una posizione aperta non si
        # perde per un buco dati — carry del precedente (la protezione sopravvive all'outage)
        if raw is None:
            if prev_ok and same_pos:
                r["stop_atr"] = round(prev_stop, 2)
                r["stop_violated"] = bool(price < prev_stop)
            continue
        # INVARIANTE RATCHET: con posizione invariata e prev valido, lo stop esportato è
        # max(prev, nuovo) → NON può MAI scendere sotto lo stop del run precedente.
        stop = max(prev_stop, raw) if (prev_ok and same_pos) else raw
        # SCUDO SOTTO-ZERO: mai esportare uno stop ≤ 0 (2×ATR ≥ prezzo = dato malato):
        # meglio n.d. (il client lo dichiara) che uno stop matematicamente impossibile.
        if stop <= 0:
            r.pop("stop_atr", None)
            r.pop("stop_violated", None)
            continue
        r["stop_atr"] = round(stop, 2)
        r["stop_violated"] = bool(price < stop)


def strip_private(rows):
    """Rimuove le chiavi interne (prefisso _) prima della serializzazione JSON."""
    for r in rows:
        for k in [k for k in list(r.keys()) if k.startswith("_")]:
            r.pop(k, None)


# ═══ SCREENER IDEE DI ROTAZIONE (v144) ═══
# Universo curato di compounder di QUALITÀ ESTERNI alla concentrazione tech/semi del fondo:
# è la "materia prima positiva" che mancava all'analisi — senza, l'LLM può solo difendere il
# libro esistente. Ogni nome è mappato al suo ETF settoriale per correlarlo alla rotazione reale.
SCREENER_UNIVERSE = {
    "LLY": "XLV", "UNH": "XLV", "ABBV": "XLV", "ISRG": "XLV", "MRK": "XLV",
    "AMGN": "IBB", "VRTX": "XBI",
    "JPM": "XLF", "V": "XLF", "MA": "XLF", "BRK-B": "XLF",
    "XOM": "XLE", "CVX": "XLE",
    "CAT": "XLI", "GE": "XLI", "HON": "XLI",
    "COST": "XLP", "WMT": "XLP",
}




def main():
    # snapshot del run PRECEDENTE (ratchet stop, carry-forward margin debt, metrics_history)
    global PREV_DATA
    prev_data = {}
    try:
        if OUT.exists():
            prev_data = json.loads(OUT.read_text())
    except Exception:  # noqa: BLE001
        prev_data = {}
    PREV_DATA = prev_data

    equities = fetch_equities()
    btp = fetch_btp()
    watchlist = fetch_watchlist()
    macro = fetch_macro()
    # ═══ v307 — LE POSIZIONI DEL CEO, COME SOVRAPPOSIZIONE ═══════════════════════════════
    # Il CEO ha dato il suo estratto e ha chiesto di inserirlo. NON si resuscita
    # `holdings.json`: v274 lo cancello' di proposito perche' "un ripiego verso un file morto
    # non e' una rete di sicurezza, e' una strada che riporta indietro" — quel file portava con
    # se' 37 simboli e un universo diverso.
    # ⚠ QUI E' UNA SOVRAPPOSIZIONE: `config/posizioni.json` non contiene simboli propri, dice
    # solo quante quote e a che prezzo medio per titoli che la watchlist GIA' segue. Una
    # posizione su un titolo non seguito viene IGNORATA e il fatto stampato: senza prezzo non
    # se ne puo' dire niente, e inventarlo sarebbe peggio che ometterlo.
    # ⚠⚠ NIENTE TOTALI IN EURO. Il progetto ha gia' pagato `eur_value` con un break di
    # definizione, e il gate valuta esiste per quello. Qui si pubblicano il controvalore nella
    # valuta NATIVA e il guadagno in PERCENTUALE, che e' invariante al cambio: cosi' non c'e'
    # nessun importo in euro da tenere allineato.
    # ⚠ STA QUI E NON PIU' SU, e la prima stesura era sbagliata: l'avevo messo dove `watchlist`
    # non esiste ancora, quindi sarebbe fallito dentro il `try` senza dire niente. Un blocco che
    # non gira e non protesta e' la classe di difetto peggiore.
    try:
        pos_file = ROOT / "config" / "posizioni.json"
        if pos_file.exists():
            pos_raw = json.loads(pos_file.read_text())
            per_tk = {}
            for p in (pos_raw.get("posizioni") or []):
                tk = str(p.get("ticker") or "").strip().upper()
                if tk and p.get("qta") and p.get("pmc"):
                    per_tk[tk] = p
            attaccate = 0
            senza_prezzo = []
            for r in watchlist:
                p = per_tk.pop(str(r.get("ticker") or "").upper(), None)
                if not p:
                    continue
                r["qta"] = p["qta"]
                r["pmc"] = round(float(p["pmc"]), 4)
                prezzo = r.get("price")
                if not prezzo:
                    # seguita ma non quotabile: quasi sempre un simbolo inesistente (refuso)
                    senza_prezzo.append(str(r.get("ticker") or ""))
                    continue
                r["controvalore"] = round(float(prezzo) * float(p["qta"]), 2)
                r["gain_pct_pos"] = round((float(prezzo) / float(p["pmc"]) - 1) * 100, 2)
                attaccate += 1
            # ⚠ il BTP non e' nella watchlist (ha la sua funzione, fetch_btp): si aggancia li'
            btp_pos = per_tk.pop("BTP-V28", None)
            if btp_pos and isinstance(btp, dict):
                btp["qta"] = btp_pos["qta"]
                btp["pmc"] = round(float(btp_pos["pmc"]), 4)
                pz = btp.get("price") or btp.get("prezzo")
                if pz:
                    btp["gain_pct_pos"] = round((float(pz) / float(btp_pos["pmc"]) - 1) * 100, 2)
                attaccate += 1
            orfane = sorted(per_tk.keys())
            macro["posizioni"] = {
                "quante": attaccate,
                "aggiornato": pos_raw.get("aggiornato"),
                "fonte": pos_raw.get("_fonte"),
                "non_seguite": orfane,
                # ⚠ v350 — seguite ma senza prezzo: il caso del simbolo inesistente. Vanno
                # dichiarate a valle o la posizione sparisce senza che nulla protesti.
                "senza_prezzo": sorted(senza_prezzo),
            }
            print(f"   posizioni: {attaccate} attaccate"
                  + (f", {len(orfane)} su titoli NON seguiti (ignorate): {orfane}" if orfane else "")
                  + (f", {len(senza_prezzo)} SEGUITE MA SENZA PREZZO (simbolo inesistente?): "
                     f"{sorted(senza_prezzo)}" if senza_prezzo else ""))
    except Exception as e:  # noqa: BLE001
        print(f"!! posizioni: {e}", file=sys.stderr)

    # MACRO SHOCK ALERT v125: incrocia futures Nasdaq (macro) e KOSPI live (watchlist) → flag panico
    shock = compute_shock_alert(macro, watchlist)
    if shock:
        macro["shock_alert"] = shock
        print(f"!! [MACRO SHOCK ALERT] {shock['worst_chg']}% — {[s['src'] for s in shock['sources']]}", file=sys.stderr)

    # Metriche di rischio (Sharpe, beta NDX, correlazioni, MCR) PRIMA di rimuovere le serie interne
    # ⚠ v355 — il portafoglio ai fini del rischio e' CHI HA UNA POSIZIONE, non chi sta
    # nell'array PORTFOLIO: dopo la migrazione delle azioni in watchlist quell'array ha il solo
    # BTP, e il motore restituiva None (tutti i campi di rischio a null in data.json).
    con_posizione = [r for r in (equities + watchlist)
                     if (r.get("qta") or r.get("qty")) and (r.get("value") or r.get("controvalore"))]
    senza_posizione = [r for r in watchlist if r not in con_posizione]
    print(f"   rischio di portafoglio: {len(con_posizione)} posizioni nel calcolo, "
          f"{len(senza_posizione)} titoli seguiti fuori", file=sys.stderr)
    risk = compute_risk_metrics(con_posizione, senza_posizione) or {}
    portfolio_sharpe = risk.get("sharpe")
    strip_private(equities)
    strip_private(watchlist)

    # trailing stop 2×ATR con ratchet (ancorato allo stop del run precedente)
    prev_by_ticker = {r.get("ticker"): r for r in (prev_data.get("portfolio") or [])}
    ratchet_stops(equities, prev_by_ticker)

    # termometro: media della salute tecnica dei titoli in portafoglio
    healths = [r["health"] for r in equities if r.get("health") is not None]
    if healths:
        score = round(sum(healths) / len(healths))
        macro["thermometer"] = {
            "score": score,
            "label": "Forte" if score >= 60 else "Debole" if score <= 40 else "Neutro",
        }

    try:
        eurusd = float(yf.Ticker("EURUSD=X").fast_info.last_price)
    except Exception:  # noqa: BLE001
        eurusd = 1.08

    usd_value = sum(r["value"] for r in equities)
    usd_cost = sum(r["pmc"] * r["qty"] for r in equities)
    total_eur = usd_value / eurusd + btp["value"]
    cost_eur = usd_cost / eurusd + BTP["nominal"] * BTP["pmc"] / 100

    # stima tasse sul capital gain (solo plusvalenze)
    stock_gain_eur = (usd_value - usd_cost) / eurusd
    tax = TAX_STOCK * max(0, stock_gain_eur) + TAX_BTP * max(0, btp["gain"])
    eur_gain = total_eur - cost_eur

    # asset allocation dettagliata (valore in EUR per posizione, con settore)
    allocation = []
    for r in equities:
        allocation.append({"ticker": r["ticker"], "name": r["name"],
                           "value_eur": round(r["value"] / eurusd, 2),
                           "sector": r.get("sector") or "Altro"})
    allocation.append({"ticker": btp["ticker"], "name": btp["name"],
                       "value_eur": round(btp["value"], 2), "sector": "Obbligazioni"})
    allocation.sort(key=lambda x: x["value_eur"], reverse=True)

    # opzioni: solo azioni/ETF USA (no indici PTS, no cripto/futures con '-','=','^')
    opt_syms = [r["ticker"] for r in equities
                if r.get("currency") == "USD" and not re.search(r"[\^=]|-", r["ticker"])]
    opt_syms += [r["ticker"] for r in watchlist
                 if r.get("currency") == "USD" and not re.search(r"[\^=]|-", r["ticker"])]
    options = fetch_options_chain(sorted(set(opt_syms)))

    # storico metriche (1 punto per giorno): Sharpe e performance per i mini-trend in dashboard
    # + CINEMATICA v113: RS vs NDX e MCR per titolo, VIX e term structure — servono al blocco
    # "DELTA" del prompt (velocità dei segnali vs 7/30 giorni fa, non solo la fotografia).
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    prev_hist = prev_data.get("metrics_history") or []
    point = {
        "date": today,
        "sharpe": portfolio_sharpe,
        # v279 — stessa protezione del blocco totals: costo nullo → il rendimento non esiste
        "gain_pct": round((total_eur / cost_eur - 1) * 100, 2) if cost_eur else None,
        "eur_value": round(total_eur, 2),
        "vix": (macro.get("vix") or {}).get("value"),
        "vix_term": (macro.get("smart_money") or {}).get("vix_term_ratio"),
        "titles": {r["ticker"]: {"rs": r.get("rs_ndx_1m"), "mcr": r.get("risk_contrib_pct")}
                   for r in equities
                   if r.get("qty") and (r.get("rs_ndx_1m") is not None or r.get("risk_contrib_pct") is not None)},
        # v224 — STORICO DEGLI INDICATORI MACRO. La dashboard mostra ogni indicatore come una
        # tessera con la sua linea nel tempo, ma per la maggior parte (CPI, PCE, NFP, UMich,
        # i mercati, i compositi) data.json porta SOLO il valore di oggi: una linea da un punto
        # non si disegna, e fingerla sarebbe peggio che non averla. Da qui in avanti il punteggio
        # di ogni indicatore viene salvato giorno per giorno insieme al resto: appena ci sono due
        # rilevazioni la linea compare da sola, senza toccare la UI.
        "macro_scores": _macro_scores(macro),
    }
    metrics_history = [p for p in prev_hist if p.get("date") != today]
    metrics_history.append(point)
    metrics_history = metrics_history[-180:]   # ~6 mesi di storico giornaliero

    data = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "eurusd": round(eurusd, 4),
        "totals": {
            "usd_value": round(usd_value, 2),
            "usd_gain": round(usd_value - usd_cost, 2),
            # ⚠ v279 — DIVISIONE PER ZERO SU PORTAFOGLIO VUOTO. Da v272 la pipeline non
            # calcola piu' posizioni (il CEO ha chiuso il portafoglio in v256), quindi
            # `usd_cost` e `cost_eur` valgono ZERO e queste due righe facevano morire il run
            # con ZeroDivisionError. Sarebbe morto il primo cron dopo la push — la stessa
            # famiglia del KeyError che fermo' la pipeline per un giorno.
            # ⚠ Nessun gate l'ha presa: nessuno ESEGUE la pipeline (serve la rete). L'ho
            # trovata solo lanciandola a mano prima di lasciarla andare in produzione.
            # Un rendimento percentuale su un costo nullo non e' zero: NON ESISTE, e si scrive
            # None — che la pagina disegna come trattino invece che come "0,00%".
            "usd_gain_pct": round((usd_value / usd_cost - 1) * 100, 2) if usd_cost else None,
            "eur_value": round(total_eur, 2),
            "eur_gain": round(eur_gain, 2),
            "eur_gain_pct": round((total_eur / cost_eur - 1) * 100, 2) if cost_eur else None,
            "tax_est": round(tax, 2),
            "eur_gain_net": round(eur_gain - tax, 2),
            "portfolio_sharpe_ratio": portfolio_sharpe,
            # Sortino = Sharpe con la sola downside deviation (rischio "vero")
            "portfolio_sortino_ratio": risk.get("sortino"),
            "risk_free_rate": RISK_FREE_RATE,
            # beta di portafoglio da regressione log-return vs ^NDX, pesi mark-to-market
            "portfolio_beta_ndx": risk.get("portfolio_beta_ndx"),
            # correlazione media tra le coppie di posizioni (diversificazione interna)
            "avg_pairwise_corr": risk.get("avg_pairwise_corr"),
            # VaR/ES parametrici 1g 95% sul comparto azionario (il BTP non ha serie):
            # % del controvalore azionario + conversione in € ai pesi MTM correnti
            "var95_1d_pct": risk.get("var95_1d_pct"),
            "es95_1d_pct": risk.get("es95_1d_pct"),
            "var95_1d_eur": round(usd_value / eurusd * risk["var95_1d_pct"] / 100) if (risk.get("var95_1d_pct") and usd_value) else None,
            "es95_1d_eur": round(usd_value / eurusd * risk["es95_1d_pct"] / 100) if (risk.get("es95_1d_pct") and usd_value) else None,
            # variante STORICA (percentili empirici — primaria: onesta sulle code grasse)
            "var95_hist_pct": risk.get("var95_hist_pct"),
            "es95_hist_pct": risk.get("es95_hist_pct"),
            "var95_hist_eur": round(usd_value / eurusd * risk["var95_hist_pct"] / 100) if (risk.get("var95_hist_pct") and usd_value) else None,
            "es95_hist_eur": round(usd_value / eurusd * risk["es95_hist_pct"] / 100) if (risk.get("es95_hist_pct") and usd_value) else None,
        },
        "portfolio": equities + [btp],
        "watchlist": watchlist,
        "allocation": allocation,
        "history": fetch_portfolio_history(btp["value"]),
        "macro": macro,
        "broker": BROKER,
        # ═══ v269 — QUATTRO BLOCCHI CHE NESSUNO LEGGEVA PIU' ═══════════════════════════
        # Il CEO ha chiesto di alleggerire la pipeline. Misurato su data.json (1,33 MB, che
        # gzippato fa 168 KB e il browser scarica a ogni apertura):
        #   top_etfs  121.518 caratteri (9,1%)   news  28.983 (2,2%)
        #   screener    1.677                    top_caps  861
        # In assets/app.js i riferimenti VERI a questi blocchi sono ZERO: quelli che restavano
        # erano commenti ed etichette rimasti dopo v256, quando il CEO ha chiuso portafoglio,
        # watchlist e news. Nessun gate li legge — verificato su test_app, redteam,
        # coherence_check, audit_data, test_update_data e fx_check.
        # ⚠ IL RISPARMIO VERO NON E' IL PESO, E' IL TEMPO. build_feeds() metteva insieme una
        # VENTINA di feed fissi PIU' uno per ogni titolo in portafoglio e watchlist: circa 57
        # richieste RSS a ogni run, per riempire un blocco che nessuno apriva.
        # `predictions` RESTA: e' Polymarket, e le sue righe finiscono davvero nel pacchetto
        # macro (buildPrompt legge DATA.predictions per le probabilita' sulla Fed).
        "predictions": fetch_predictions(),
        "options": options,
        "metrics_history": metrics_history,
        "sanity_filtered": SANITY_FILTERED,   # anomalie API scartate dal sanity check in questo run
        # DATA ASSERTIONS: esito della validazione age+threshold sul macro (per UI e gate CI)
        "data_quality": validate_macro(macro),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # NaN/Infinity non sono JSON validi per il browser → li converto in null prima di scrivere
    OUT.write_text(json.dumps(clean_nan(data), ensure_ascii=False, indent=1))
    # ⚠ IL RIASSUNTO VA IN FONDO, dove il log del CI lo mostra senza scorrere, e va stampato
    #   ANCHE quando il run è riuscito: un run che scrive data.json dopo 200 rifiuti di Yahoo
    #   è riuscito a metà, e prima non c'era modo di saperlo.
    if _RUMORE_YF.righe:
        print(f"⚠ yfinance ha protestato {len(_RUMORE_YF.righe)} volte in questo run:")
        for _r in _RUMORE_YF.riassunto():
            print(f"   causa: {_r}")
    print(f"OK -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
