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
import io
import json
import math
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path

import feedparser
import numpy as np
import pandas as pd
import requests
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "data.json"
CONFIG = ROOT / "config" / "holdings.json"

UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "*/*",
}

# posizioni di default (usate se config/holdings.json manca)
DEFAULT_PORTFOLIO = [
    {"ticker": "NVDA", "name": "NVIDIA",         "qty": 270,  "pmc": 87.17},
    {"ticker": "AMD",  "name": "AMD",            "qty": 125,  "pmc": 153.92},
    {"ticker": "MU",   "name": "Micron",         "qty": 90,   "pmc": 87.63},
    {"ticker": "INTC", "name": "Intel",          "qty": 380,  "pmc": 25.75},
    {"ticker": "TSLA", "name": "Tesla",          "qty": 60,   "pmc": 358.22},
    {"ticker": "MSTR", "name": "Strategy",       "qty": 123,  "pmc": 210.22},
    {"ticker": "RGTI", "name": "Rigetti",        "qty": 515,  "pmc": 27.30},
    {"ticker": "ARBE", "name": "Arbe Robotics",  "qty": 1150, "pmc": 3.35},
]
DEFAULT_WATCHLIST = [
    {"ticker": "OKLO", "name": None, "currency": "USD"},
    {"ticker": "SPCX", "name": None, "currency": "USD"},
    {"ticker": "CBRS", "name": None, "currency": "USD"},
    {"ticker": "^KS11", "name": "KOSPI", "currency": "PTS"},
    {"ticker": "^IXIC", "name": "Nasdaq Composite", "currency": "PTS"},
    {"ticker": "BTC-USD", "name": "Bitcoin", "currency": "USD"},
    {"ticker": "CL=F", "name": "Petrolio WTI", "currency": "USD"},
]


def load_holdings():
    """Legge le posizioni da config/holdings.json (modificabile da UI), con fallback ai default."""
    try:
        cfg = json.loads(CONFIG.read_text())
        pf = cfg.get("portfolio") or DEFAULT_PORTFOLIO
        wl = cfg.get("watchlist") or DEFAULT_WATCHLIST
        return pf, wl, cfg.get("broker")
    except Exception as e:  # noqa: BLE001
        print(f"!! config holdings non leggibile, uso default: {e}", file=sys.stderr)
        return DEFAULT_PORTFOLIO, DEFAULT_WATCHLIST, None


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

PUTCALL_SYMBOL = ("BSX", "Boston Scientific")

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
FOMC_2026 = ["2026-01-27", "2026-03-17", "2026-04-28", "2026-06-16",
             "2026-07-28", "2026-09-15", "2026-10-27", "2026-12-08"]


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

def gnews(query):
    return ("https://news.google.com/rss/search?q="
            + urllib.parse.quote(f"{query} when:1d") + "&hl=en-US&gl=US&ceid=US:en")


def build_feeds():
    """Feed costruiti dinamicamente: fonti dirette diverse + un feed per ogni titolo in
    portafoglio/watchlist (così le news si adattano e variano)."""
    feeds = [
        # Investing.com — fonte prioritaria (più sezioni)
        ("Investing.com", "https://www.investing.com/rss/news.rss"),
        ("Investing.com", "https://www.investing.com/rss/news_25.rss"),       # stock market
        ("Investing.com", "https://www.investing.com/rss/news_285.rss"),      # economy
        ("Investing.com", "https://www.investing.com/rss/news_1.rss"),        # forex
        ("Investing.com", "https://www.investing.com/rss/stock_Stocks.rss"),
        ("Investing.com", "https://www.investing.com/rss/news_301.rss"),      # cryptocurrency
        # altre testate dirette
        ("CNBC", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114"),
        ("CNBC Markets", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"),
        ("Yahoo Finance", "https://finance.yahoo.com/news/rssindex"),
        ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
        ("Bloomberg", "https://feeds.bloomberg.com/markets/news.rss"),
        ("Reddit", "https://www.reddit.com/r/stocks/.rss"),
        ("Reddit", "https://www.reddit.com/r/investing/.rss"),
        # macro / geopolitica (per fonte, via Google con site:)
        ("Reuters", gnews("site:reuters.com (markets OR economy OR Fed OR Iran OR stocks OR tariffs)")),
        ("AP", gnews("site:apnews.com (economy OR markets OR Iran OR Fed OR Trump OR China)")),
        ("CNBC", gnews("site:cnbc.com (Fed OR inflation OR market OR earnings)")),
        ("Google News", gnews("Federal Reserve OR US inflation OR White House economy OR tariffs OR jobs report")),
        ("Google News", gnews("Iran OR Israel OR Ukraine OR Russia OR China trade OR OPEC oil (markets OR economy OR war)")),
        ("Google News", gnews('"BCA Research" OR MacroQuant OR "recession probability" OR "business cycle" market outlook')),
    ]
    # un feed dedicato per ogni posizione e titolo in watchlist
    for p in PORTFOLIO + WATCHLIST:
        nm = (p.get("name") or p["ticker"])
        if p["ticker"] in ("BTC-USD",):
            q = "Bitcoin OR crypto"
        elif p["ticker"] == "BTP-V28":
            q = '"BTP Valore" OR "Italian bonds" OR BTP'
        elif p.get("currency") == "PTS":
            continue
        else:
            q = f'"{nm}" OR {p["ticker"]} stock'
        feeds.append(("Google News", gnews(q)))
    return feeds


# domini a pagamento: le loro notizie restano, ma il link punta a una ricerca Google
# (così trovi una versione leggibile gratis invece del paywall)
PAYWALL_DOMAINS = ("wsj.com", "ft.com", "barrons.com", "economist.com", "seekingalpha.com",
                   "bloomberg.com", "nytimes.com", "thetimes", "telegraph.co.uk",
                   "businessinsider.com", "theinformation.com")

# pattern regex (word boundary) per associare le news ai titoli
PORTFOLIO_KEYWORDS = {
    "NVDA": [r"\bnvidia\b", r"\bnvda\b"], "AMD": [r"\bamd\b", r"advanced micro"],
    "MU": [r"\bmicron\b"], "INTC": [r"\bintel\b"], "TSLA": [r"\btesla\b", r"\bmusk\b"],
    "MSTR": [r"\bmicrostrategy\b", r"\bstrategy inc\b", r"\bmstr\b", r"\bsaylor\b"],
    "RGTI": [r"\brigetti\b"], "OKLO": [r"\boklo\b"], "ARBE": [r"\barbe\b"],
    "BTP-V28": [r"\bbtp\b", r"italian bond", r"italy bond"],
    # macro, politica USA e geopolitica (notizie che muovono i mercati)
    "MACRO": [
        # politica monetaria / macro USA
        r"\bfed\b", r"federal reserve", r"\binflation\b", r"\bcpi\b", r"\bpce\b",
        r"\btariff", r"white house", r"\btrump\b", r"\bcongress\b", r"\btreasur",
        r"\bgdp\b", r"\bpowell\b", r"rate cut", r"rate hike", r"interest rate",
        r"\bjobs report\b", r"payrolls", r"unemployment", r"recession", r"debt ceiling",
        r"government shutdown", r"\bsenate\b", r"\bbiden\b", r"stimulus", r"\bopec\b",
        # geopolitica e mercati globali
        r"\biran\b", r"\bisrael\b", r"\bgaza\b", r"middle east", r"\bwar\b", r"conflict",
        r"\brussia\b", r"\bukraine\b", r"\bchina\b", r"sanction", r"geopolit",
        r"oil price", r"crude oil", r"\bnato\b", r"strait of hormuz", r"nuclear",
        r"stock market", r"wall street", r"\bs&p 500\b", r"\bdow\b", r"selloff", r"rally",
    ],
}


def http_get(url, tries=3, timeout=25):
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, headers=UA, timeout=timeout)
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


def fetch_symbol(ticker, name=None, currency="USD"):
    """Quote + dati tecnici + rating + trimestrale + sparkline per un titolo."""
    ticker = TICKER_ALIAS.get(ticker.strip().upper(), ticker.strip())
    t = yf.Ticker(ticker)
    price_src = "yahoo"
    hist = t.history(period="1y", interval="1d", auto_adjust=True)
    if hist.empty and currency == "USD" and not re.search(r"[\^=]|-", ticker):
        bk = backup_daily(ticker)
        if bk is not None and len(bk[0]) >= 30:
            hist, price_src = bk
            print(f"·· prezzi {ticker} da {price_src} (fallback: Yahoo senza storico)", file=sys.stderr)
    if hist.empty:
        print(f"!! nessuno storico per {ticker}", file=sys.stderr)
        return None
    closes = hist["Close"]
    price = float(closes.iloc[-1])
    prev = float(closes.iloc[-2]) if len(closes) > 1 else price

    monthly = None
    try:
        mh = t.history(period="max", interval="1mo")
        ath = float(mh["High"].max())
        monthly = mh["Close"].dropna()
    except Exception:  # noqa: BLE001
        ath = float(hist["High"].max())

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
    sharpe_1y, sortino_1y = None, None
    if len(daily_ret) >= 60:
        std_d = float(daily_ret.std(ddof=1))
        rf_log = math.log1p(RISK_FREE_RATE)                          # Rf coerente in spazio log
        rp = float(daily_ret.mean()) * TRADING_DAYS                  # log-rendimento annualizzato
        if std_d > 0:
            sigma = std_d * (TRADING_DAYS ** 0.5)                    # volatilità annualizzata
            sharpe_1y = round((rp - rf_log) / sigma, 2)
        # Sortino: stesso numeratore, ma al denominatore la sola downside deviation
        # (radice della media dei quadrati dei rendimenti sotto Rf giornaliero).
        # È il metro del VETO value trap: punisce le perdite, non i rally.
        downside = np.minimum(daily_ret.values - rf_log / TRADING_DAYS, 0.0)
        dd_ann = float(np.sqrt(np.mean(downside ** 2)) * (TRADING_DAYS ** 0.5))
        if dd_ann > 0:
            sortino_1y = round((rp - rf_log) / dd_ann, 2)

    vol = float(hist["Volume"].iloc[-1])
    vol_avg30 = float(hist["Volume"].tail(30).mean())

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

    # prossima trimestrale
    earnings_date = None
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
    if currency == "USD" and ticker not in ("BTC-USD", "CL=F"):
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

    # statistiche chiave (come scheda "Più dati finanziari") + stime
    stats = None
    if currency == "USD" and ticker not in ("BTC-USD", "CL=F"):
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
            "float_pct": round(float_sh / shares_out * 100, 1) if float_sh and shares_out else None,
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
            "dividend_yield": num("dividendYield"),
            "price_to_book": num("priceToBook"),
            "target_mean": num("targetMeanPrice"),
            "fcf": num("freeCashflow"),
            "gross_margin": num("grossMargins"),
            "enterprise_value": num("enterpriseValue"),
            "ev_ebitda": num("enterpriseToEbitda"),
            "peg": num("pegRatio", "trailingPegRatio"),
            "roa": num("returnOnAssets"),
            "short_float": num("shortPercentOfFloat"),
        }
        stats = {k: (round(v, 4) if v is not None else None) for k, v in stats.items()}
        # sanity: un PEG negativo (utili o crescita attesa negativi) non è usabile nei modelli → n.d.
        if stats.get("peg") is not None and stats["peg"] <= 0:
            stats["peg"] = None
        # IGIENE P/E anche nelle stats: EPS TTM < 0 → pe_ttm obbligatoriamente n.d.
        if stats.get("eps_ttm") is not None and stats["eps_ttm"] < 0:
            stats["pe_ttm"] = None

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
                comp = [
                    (6.56, wc / ta_ if wc is not None else None),
                    (3.26, re_ / ta_ if re_ is not None else None),
                    (6.72, ebit / ta_ if ebit is not None else None),
                    (1.05, stats["market_cap"] / tl_ if stats.get("market_cap") else None),
                ]
                missing = sum(1 for _, x in comp if x is None)
                if missing <= 1:
                    stats["altman_z"] = round(sum(w_ * (x or 0.0) for w_, x in comp), 2)
                    stats["altman_missing"] = missing
                    stats["altman_model"] = "Z''"
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
    # sanity: una variazione intraday >+150% / <-80% su una large cap (>$5 mld) è un glitch API
    chg = round((price / prev - 1) * 100, 2)
    mcap = info.get("marketCap") or 0
    if mcap > 5e9 and not (-80 <= chg <= 150):
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
        "change_pct": chg,
        "pe": round(float(pe), 1) if pe and pe > 0 else None,
        "ath": round(ath, 2),
        "ath_dist_pct": round((price / ath - 1) * 100, 1),
        "sma200_dist_pct": round((price / sma200 - 1) * 100, 1) if sma200 else None,   # distanza % da SMA200 (price action pura)
        "w52_high": round(float(hist["High"].max()), 2),
        "w52_dist_pct": round((price / float(hist["High"].max()) - 1) * 100, 1),
        "support": round(float(hist["Low"].tail(20).min()), 2),
        "resistance": round(float(hist["High"].tail(20).max()), 2),
        "rsi": rsi,
        "volume": int(vol),
        "vol_ratio": round(vol / vol_avg30, 2) if vol_avg30 else None,
        "atr_14": round(atr_14, 2) if atr_14 else None,
        "atr_pct": round(atr_14 / price * 100, 2) if atr_14 and price else None,
        "signal": sig,
        "signal_class": sig_class,
        "sparks": sparks,
        "earnings_date": earnings_date,
        "rating": rating,
        "health": health,
        "eps": round(float(eps), 2) if eps is not None else None,
        "beta": round(float(beta), 2) if beta is not None else None,
        "sharpe_1y": sharpe_1y,
        "sortino_1y": sortino_1y,
        "prepost": prepost,
        "sector": info.get("sector") or info.get("quoteType") or "Altro",
        "stats": stats,
        "tech_by_range": tech_by_range,
        "financials": financials,
        "fin_health": fin_health,
        "smc": smc_analysis(hist),
        # serie rendimenti giornalieri (uso interno per lo Sharpe di portafoglio; rimossa prima del dump)
        "_ret_series": [round(float(x), 6) for x in daily_ret.tail(252)],
        "_ret_dates": [d.strftime("%Y-%m-%d") for d in daily_ret.index[-252:]],
    }


def fetch_equities():
    # benchmark 1 mese per RS relativa (SP500, SOX, NDX)
    bench_m1 = {}
    for sym, key in (("^GSPC", "sp500"), ("^SOX", "sox"), ("^NDX", "ndx")):
        try:
            h = yf.Ticker(sym).history(period="2mo", interval="1d", auto_adjust=True)["Close"].dropna()
            bench_m1[key] = (float(h.iloc[-1]) / float(h.iloc[-22]) - 1) * 100 if len(h) >= 22 else None
        except Exception:  # noqa: BLE001
            bench_m1[key] = None

    rows = []
    for pos in PORTFOLIO:
        row = fetch_symbol(pos["ticker"], pos["name"])
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
    for sym, key in (("^GSPC", "sp500"), ("^SOX", "sox"), ("^NDX", "ndx")):
        try:
            h = yf.Ticker(sym).history(period="2mo", interval="1d", auto_adjust=True)["Close"].dropna()
            bench_m1[key] = (float(h.iloc[-1]) / float(h.iloc[-22]) - 1) * 100 if len(h) >= 22 else None
        except Exception:  # noqa: BLE001
            bench_m1[key] = None

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
        "pe": None, "ath": None, "ath_dist_pct": None, "w52_high": None, "w52_dist_pct": None,
        "support": None, "resistance": None, "rsi": None,
        "volume": None, "vol_ratio": None,
        "signal": "Cedola 4,10/4,50%", "signal_class": "info",
        "sparks": {}, "earnings_date": None, "rating": None, "health": None,
        "eps": None, "beta": None, "prepost": None,
        "sector": "Obbligazioni", "tech_by_range": {}, "stats": None,
        "financials": [], "fin_health": None,
    }


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


def series_fallback(label, primary, fallback=None):
    try:
        return primary()
    except Exception as e:  # noqa: BLE001
        print(f"!! {label}: fonte primaria ko ({e}), provo fallback", file=sys.stderr)
        if fallback is None:
            raise
        return fallback()


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
        fomc = [d for d in ("2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
                            "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09")
                if d >= datetime.now(timezone.utc).strftime("%Y-%m-%d")]
        cut_prob = round(max(0, min(100, (mid - implied) / 0.25 * 100)))
        meetings = []
        for i, d in enumerate(fomc[:4]):
            p = min(100, cut_prob + i * 12)      # probabilità cumulativa crescente nel tempo
            meetings.append({"date": d, "cut_prob": p,
                             "hold_prob": 100 - p})
        macro["fedwatch"] = {
            "target_range": f"{target_low:.2f}–{target:.2f}%",
            "implied_rate": implied,
            "delta_bp": round((implied - mid) * 100),
            "next_cut_prob": cut_prob,
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
        return round((series[-1][1] / series[-13][1] - 1) * 100, 1), series[-1][0]

    def mom(series):
        return round((series[-1][1] / series[-2][1] - 1) * 100, 1), series[-1][0]

    # impact: 0 = molto negativo per i mercati, 100 = molto positivo
    indicators = []
    try:
        v, d = yoy(series_fallback("cpi", lambda: fred_series("CPIAUCSL"),
                                   lambda: bls_series("CUSR0000SA0")))
        indicators.append({"key": "cpi", "label": "Inflazione CPI (a/a)", "value": f"{v}%", "date": d,
                           "impact": round(clamp(100 - abs(v - 2) * 30))})
    except Exception as e:  # noqa: BLE001
        print(f"!! cpi: {e}", file=sys.stderr)
    try:
        v, d = yoy(series_fallback("pce", lambda: fred_series("PCEPI"),
                                   lambda: dbnomics_series("BEA/NIPA-T20804/DPCERG-M")))
        indicators.append({"key": "pce", "label": "Inflazione PCE (a/a)", "value": f"{v}%", "date": d,
                           "impact": round(clamp(100 - abs(v - 2) * 30))})
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
        v, d = mom(fred_series("RSAFS"))
        indicators.append({"key": "retail", "label": "Vendite al dettaglio (m/m)", "value": f"{v}%", "date": d,
                           "impact": round(clamp(50 + v * 40))})
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
        s = fred_series("UMCSENT", 2)
        v = s[-1][1]
        indicators.append({"key": "pmi", "label": "Fiducia consumatori (UMich)",
                           "value": f"{v}", "date": s[-1][0],
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
        cur_v = curve_m[-1][1] if curve_m else None
        v12 = curve_m[-13][1] if len(curve_m) > 13 else None       # 12 mesi fa
        steepening = (cur_v is not None and v12 is not None and cur_v - v12 > 0.2)
        was_inverted = any(v < 0 for _, v in curve_m[-24:])         # invertita negli ultimi 2 anni
        macro["yield_recession"] = {
            "curve": [{"d": d, "v": round(v, 2)} for d, v in curve_m if v is not None],
            "gdp_growth": gdp_growth,
            "claims": [{"d": d, "v": round(v)} for d, v in claims_m if v is not None],
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
        for sym, key in (("^GSPC", "sp500"), ("^NDX", "ndx"), ("^SOX", "sox")):
            try:
                hb = yf.Ticker(sym).history(period="5d")["Close"].dropna()
                if len(hb) >= 2:
                    bdays[key] = round((float(hb.iloc[-1]) / float(hb.iloc[-2]) - 1) * 100, 2)
            except Exception:  # noqa: BLE001
                pass
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
        "pmi": "Fine mese (UMich) · fiducia dei consumatori",
        "curve": "Giornaliero (FRED) · curva invertita = rischio recessione",
    }
    for ind in indicators:
        ind["next_release"] = NEXT_RELEASE.get(ind["key"], "")
    macro["indicators"] = indicators

    # Mercati di riferimento (BTC, WTI, KOSPI e Nasdaq sono in watchlist)
    markets = []
    for sym, label, fmt, decimals, suffix in [
        ("^TNX", "Treasury USA 10A", "{v:.2f}%", 2, " pp"),
        ("EURUSD=X", "EUR/USD", "{v:.4f}", 2, "%"),
        ("EURJPY=X", "EUR/JPY", "{v:.2f}", 2, "%"),
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
        try:
            boj_r = fred_series("IRSTCB01JPM156N", 1)
            boj_rate_val = round(boj_r[-1][1], 2) if boj_r else None
        except Exception:
            pass
        macro["carry"] = {
            "us10": round(us10, 2), "jp10": round(float(jp10), 2), "spread": spread,
            "usdjpy": round(usdjpy, 2), "usdjpy_chg_1m": usdjpy_chg_1m,
            "boj_rate": boj_rate_val,
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
        hy_score = round(clamp(100 - (hy_val - 2.5) / 9 * 100))
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
        sc = clamp(100 - (hy_now - 2.5) / 9 * 100) if hy_now else 50
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
        sp = fred_series("SP500", 36)    # ~3 anni mensili
        gd = fred_series("GDPC1", 12)   # ~3 anni trimestrali
        if sp and gd:
            sp_base, gd_base = sp[0][1], gd[0][1]
            macro["decouple"] = {
                "sp500": [{"d": d, "v": round(v / sp_base * 100, 1)} for d, v in sp],
                "gdp":   [{"d": d, "v": round(v / gd_base * 100, 1)} for d, v in gd],
            }
    except Exception as e:  # noqa: BLE001
        print(f"!! decouple: {e}", file=sys.stderr)

    # S&P 500 + Nasdaq 100 vs Profitti Aziendali Reali USA (Corporate Profits, FRED CP)
    try:
        cp = fred_series("CP", 20)       # ~5 anni trimestrali
        sp_cp = fred_series("SP500", 60) # ~5 anni mensili
        if cp and sp_cp:
            cp_base, sp_base = cp[0][1], sp_cp[0][1]
            cur_sp = round(sp_cp[-1][1] / sp_base * 100, 1)
            cur_cp = round(cp[-1][1] / cp_base * 100, 1)
            gap = round(cur_sp - cur_cp, 1)
            # Nasdaq 100 (^NDX) — mensile 5 anni via yfinance
            ndx_hist = None
            ndx_gap = None
            try:
                ndx_raw = yf.Ticker("^NDX").history(period="5y", interval="1mo",
                                                     auto_adjust=True)["Close"].dropna()
                if len(ndx_raw) > 10:
                    ndx_base_v = float(ndx_raw.iloc[0])
                    ndx_hist = [{"d": str(d.date()), "v": round(float(v) / ndx_base_v * 100, 1)}
                                for d, v in ndx_raw.items()]
                    ndx_gap = round(ndx_hist[-1]["v"] - cur_cp, 1)
            except Exception:
                pass
            # score sulla media dei due gap (o solo S&P se NDX non disponibile)
            avg_gap = round((gap + ndx_gap) / 2, 1) if ndx_gap is not None else gap
            score = clamp(round(100 - max(0, avg_gap - 10) / 60 * 100))
            macro["corp_profit"] = {
                "sp500":   [{"d": d, "v": round(v / sp_base * 100, 1)} for d, v in sp_cp],
                "profits": [{"d": d, "v": round(v / cp_base * 100, 1)} for d, v in cp],
                "ndx":     ndx_hist,
                "gap":     gap,
                "ndx_gap": ndx_gap,
                "score":   score,
                "label":   "Asset Inflation estrema" if avg_gap > 70 else "Asset Inflation" if avg_gap > 40
                           else "Tensione moderata" if avg_gap > 20 else "Allineati",
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

    # P/E Ratio storico S&P 500 (FRED SP500PE, mensile)
    try:
        pe_data = fred_series("SP500PE", 120)  # ~10 anni mensili
        if pe_data:
            pe_vals = [v for _, v in pe_data if v]
            cur_pe = pe_data[-1][1]
            avg_pe = round(sum(pe_vals) / len(pe_vals), 1)
            pct_rank = round(sum(1 for v in pe_vals if v < cur_pe) / len(pe_vals) * 100)
            score = clamp(round(100 - (cur_pe - 10) / 40 * 100))
            ndx_pe = None
            try:
                qqq_info = yf.Ticker("QQQ").info
                raw_pe = qqq_info.get("trailingPE") or qqq_info.get("forwardPE")
                ndx_pe = round(float(raw_pe), 1) if raw_pe else None
            except Exception:
                pass
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
            }
    except Exception as e:
        print(f"!! sp500_pe: {e}", file=sys.stderr)

    # Forward P/E S&P 500 (per il termometro di rischio sistemico).
    # NESSUN fallback fittizio (GIGO): se l'API non fornisce il dato, la metrica è
    # semplicemente assente e il frontend la mostra come n.d. — mai numeri inventati.
    try:
        raw_fpe = None
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
    except Exception as e:  # noqa: BLE001
        print(f"!! stagionalità: {e}", file=sys.stderr)

    try:
        macro["margin_debt"] = fetch_margin_debt()
    except Exception as e:  # noqa: BLE001
        print(f"!! margin debt: {e}", file=sys.stderr)

    return macro


def fetch_margin_debt():
    """Margin Debt FINRA (leva a credito sui conti titoli) via FRED.
    Provo prima la serie FINRA richiesta (più ampia, ~$1T+), poi il fallback flow-of-funds.
    Termometro: vicino ai massimi storici = leva estrema = rischio elevato."""
    # FONTE PRIMARIA: statistiche ufficiali FINRA (customer debit balances, $ mln) dalla pagina
    # pubblica — è la serie "vera" del margin debt (~$1,4T nel 2026, ATH pre-2026 ~$936 mld a ott 2021).
    # Verificato: la serie "FINRADBC" NON esiste su FRED; la Z.1 resta solo come fallback.
    MONTHS = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
              "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
    try:
        html = http_get("https://www.finra.org/investors/learn-to-invest/advanced-investing/margin-statistics").text
        rows = re.findall(r"([A-Z][a-z]{2})-(\d{2})</td>\s*<td>([\d,]+)</td>", html)
        fs = []
        for mon, yy, val in rows:
            mnum = MONTHS.get(mon)
            if mnum:
                fs.append((f"20{yy}-{mnum:02d}-01", float(val.replace(",", ""))))
        fs.sort()
        if len(fs) >= 6:
            vals = [v for _, v in fs]
            cur = vals[-1]
            # la pagina FINRA elenca solo i mesi recenti: uso l'ATH storico documentato (ott 2021,
            # $935,9 mld) come pavimento del picco, così il 100% è sempre l'All-Time High reale.
            HIST_ATH_FLOOR = 935904.0
            peak = max(max(vals), HIST_ATH_FLOOR)
            peak_date = max(fs, key=lambda t: t[1])[0] if max(vals) >= HIST_ATH_FLOOR else "2021-10-01"
            yoy = round((cur / vals[-13] - 1) * 100, 1) if len(vals) >= 13 and vals[-13] else None
            mom = round((cur / vals[-2] - 1) * 100, 1) if len(vals) >= 2 and vals[-2] else None
            return {
                "value": round(cur), "peak": round(peak),
                "pct_of_peak": round(cur / peak * 100, 1),
                "yoy": yoy, "qoq": mom, "date": fs[-1][0], "peak_date": peak_date,
                "series": "FINRA debit balances (mensile)",
                "history": [round(v) for v in vals[-24:]],
            }
    except Exception as e:  # noqa: BLE001
        print(f"!! margin debt FINRA (uso fallback FRED): {e}", file=sys.stderr)

    # FALLBACK: Fed Z.1 (conti a margine broker-dealer) — misura DIVERSA e più piccola della FINRA;
    # picco sull'INTERA serie disponibile (mai su finestre recenti).
    s, src = [], None
    for sid in ("BOGZ1FL663067003Q",):
        try:
            s = fred_series(sid, n=1200)            # tutta la storia disponibile
            if len(s) >= 20:
                src = sid
                break
        except Exception:  # noqa: BLE001
            s = []
    if len(s) < 20:
        return None
    vals = [v for _, v in s]
    cur, peak = vals[-1], max(vals)                 # ATH reale su tutto lo storico
    yoy = round((cur / vals[-5] - 1) * 100, 1) if len(vals) >= 5 and vals[-5] else None
    qoq = round((cur / vals[-2] - 1) * 100, 1) if len(vals) >= 2 and vals[-2] else None
    pct_peak = round(cur / peak * 100, 1) if peak else None
    peak_date = max(s, key=lambda t: t[1])[0]       # quando è stato toccato l'ATH
    return {
        "value": round(cur), "peak": round(peak), "pct_of_peak": pct_peak,
        "yoy": yoy, "qoq": qoq, "date": s[-1][0], "peak_date": peak_date,
        # etichetta onesta della fonte: FINRA (debit balances) o Fed Z.1 (conti a margine b/d)
        "series": "FINRA debit balances" if src == "FINRADBC" else "Fed Z.1 margin accounts (broker-dealer)",
        "history": [round(v) for v in vals[-24:]],
    }


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
            for ed in exps[:n_expiries]:
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
                call_wall = float(calls.loc[calls["openInterest"].idxmax(), "strike"]) if not calls.empty and calls["openInterest"].notna().any() else None
                put_wall = float(puts.loc[puts["openInterest"].idxmax(), "strike"]) if not puts.empty and puts["openInterest"].notna().any() else None
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
        data = yf.download(list(SECTOR_ETF), period="6mo", interval="1d",
                           auto_adjust=True, progress=False)["Close"]
        for sym, (name, group) in SECTOR_ETF.items():
            try:
                s = data[sym].dropna()
                last = float(s.iloc[-1])
                m1 = (last / float(s.iloc[-22]) - 1) * 100
                m3 = (last / float(s.iloc[-66]) - 1) * 100
                d1 = (last / float(s.iloc[-2]) - 1) * 100
                rows.append({"ticker": sym, "name": name, "group": group,
                             "price": round(last, 2), "d1": round(d1, 2),
                             "m1": round(m1, 1), "m3": round(m3, 1),
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
        for it in items:
            if it["name"] == name:
                it["status"] = bool(val)
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
    active = sum(1 for it in items if it["status"])
    return {"items": items, "active": active, "total": len(items),
            "pct": round(active / len(items) * 100)}


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


def fetch_top_caps(n=10):
    """Classifica delle aziende più capitalizzate (candidati noti, ordinati per market cap)."""
    rows, fx = [], {}
    for sym, name in TOP_CAP_CANDIDATES.items():
        try:
            fi = yf.Ticker(sym).fast_info
            mc = fi.market_cap
            if not mc:
                continue
            curr = (fi.currency or "USD").upper()
            if curr != "USD":
                if curr not in fx:
                    fx[curr] = float(yf.Ticker(f"{curr}USD=X").fast_info.last_price)
                mc *= fx[curr]
            chg = (float(fi.last_price) / float(fi.previous_close) - 1) * 100
            rows.append({"ticker": sym, "name": name,
                         "mcap_usd": round(mc), "change_pct": round(chg, 2)})
        except Exception as e:  # noqa: BLE001
            print(f"!! topcap {sym}: {e}", file=sys.stderr)
    rows.sort(key=lambda x: x["mcap_usd"], reverse=True)
    return rows[:n]


def fetch_top_etfs():
    """Dati live per i 10 ETF principali: prezzo, performance, RSI, PE, dividendo."""
    rows = []
    for ticker, name in TOP_ETF_LIST:
        row = fetch_symbol(ticker, name)
        if not row:
            continue
        try:
            info = yf.Ticker(ticker).info
            row["pe"]        = round(float(info["trailingPE"]), 1) if info.get("trailingPE") else None
            row["div_yield"] = round(float(info.get("dividendYield", 0) or 0) * 100, 2)
            aum = info.get("totalAssets")
            row["aum"] = round(aum / 1e9, 1) if aum else None
        except Exception:  # noqa: BLE001
            pass
        rows.append(row)
    return rows


def parse_feed_entries(url):
    """Restituisce [(title, link, ts)] da un feed RSS; se bloccato usa rss2json."""
    out = []
    try:
        r = http_get(url, timeout=20)
        feed = feedparser.parse(r.content)
        for e in feed.entries[:25]:
            ts = None
            for k in ("published_parsed", "updated_parsed"):
                if e.get(k):
                    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", e[k])
                    break
            out.append((e.get("title", "").strip(), e.get("link", ""), ts))
    except Exception as e:  # noqa: BLE001
        print(f"!! feed diretto ko ({url[:40]}): {e}", file=sys.stderr)
    if not out:  # fallback gratuito rss2json
        try:
            j = http_get("https://api.rss2json.com/v1/api.json?rss_url="
                         + urllib.parse.quote(url), timeout=20).json()
            for e in (j.get("items") or [])[:25]:
                ts = None
                if e.get("pubDate"):
                    try:
                        ts = datetime.strptime(e["pubDate"][:19], "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%dT%H:%M:%SZ")
                    except ValueError:
                        ts = None
                out.append((e.get("title", "").strip(), e.get("link", ""), ts))
        except Exception as e:  # noqa: BLE001
            print(f"!! rss2json ko ({url[:40]}): {e}", file=sys.stderr)
    return out


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


def news_sentiment(title):
    b = len(BULL_WORDS.findall(title))
    s = len(BEAR_WORDS.findall(title))
    if b > s:
        return "bull"
    if s > b:
        return "bear"
    return "neutral"


# gruppo Politica/geopolitica (distinto dal Macro economico)
POL_KEYWORDS = [r"\btrump\b", r"white house", r"\bcongress\b", r"\bsenate\b", r"\bbiden\b",
                r"election", r"\biran\b", r"\bisrael\b", r"\bgaza\b", r"\bwar\b", r"conflict",
                r"\brussia\b", r"\bukraine\b", r"sanction", r"tariff", r"geopolit",
                r"\bnato\b", r"\bopec\b", r"government shutdown", r"middle east", r"nuclear"]


def build_keywords():
    """Parole chiave news: macro + politica + ticker/nome di ogni posizione in
    portafoglio E watchlist (le news si adattano quando aggiungi/rimuovi titoli)."""
    kw = {"MACRO": PORTFOLIO_KEYWORDS["MACRO"], "POL": POL_KEYWORDS}
    for p in PORTFOLIO + [w for w in WATCHLIST if w.get("currency") != "PTS"]:
        tk = p["ticker"]
        if tk == "BTP-V28":
            kw[tk] = [r"\bbtp\b", r"italian bond", r"italy bond"]
            continue
        if tk in ("BTC-USD",):
            kw[tk] = [r"\bbitcoin\b", r"\bcrypto\b"]
            continue
        if tk in ("CL=F",):
            kw[tk] = [r"oil price", r"crude oil", r"\bopec\b"]
            continue
        terms = [re.escape(tk.lower())]
        nm = (p.get("name") or "").lower().split(" ")[0]
        if len(nm) >= 3 and nm not in ("the", "inc", "corp"):
            terms.append(re.escape(nm))
        kw[tk] = [rf"\b{t}\b" for t in terms]
    return kw


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


def fetch_news():
    """News sui titoli in portafoglio (dinamiche) + macro/politica/geopolitica, tradotte.
    Esclude articoli a pagamento e doppioni sullo stesso argomento. Include Polymarket."""
    keywords = build_keywords()
    # solo notizie delle ultime 30 ore (≈1 giorno)
    cutoff = datetime.now(timezone.utc).timestamp() - 30 * 3600
    def fresh(ts):
        if not ts:
            return True   # senza data: tenuta (molti feed sono comunque recenti)
        try:
            return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp() >= cutoff
        except ValueError:
            return True
    items, seen_titles, kept_keys, per_source = [], set(), [], {}
    for source, url in build_feeds():
        for title, link, ts in parse_feed_entries(url):
            if not title or title.lower() in seen_titles:
                continue
            if not fresh(ts):                      # niente notizie più vecchie di ~1 giorno
                continue
            # paywall: non scartare, ma punta a una ricerca Google (versione gratuita)
            if any(d in (link or "").lower() for d in PAYWALL_DOMAINS):
                link = "https://news.google.com/search?q=" + urllib.parse.quote(title)
            tickers = [tk for tk, kws in keywords.items()
                       if any(re.search(kw, title.lower()) for kw in kws)]
            if not tickers:
                continue
            key = topic_key(title)
            if is_duplicate_topic(key, kept_keys):     # niente doppioni di argomento
                continue
            cap = 16 if source == "Investing.com" else 6   # Investing prioritario
            if per_source.get(source, 0) >= cap:
                continue
            seen_titles.add(title.lower())
            kept_keys.append(key)
            per_source[source] = per_source.get(source, 0) + 1
            # priorità ARGOMENTO: macro/politica (0) > portafoglio (1) > watchlist (2) > resto (3)
            pf_tk = {p["ticker"] for p in PORTFOLIO}
            wl_tk = {w["ticker"] for w in WATCHLIST}
            if "MACRO" in tickers or "POL" in tickers:
                topic_pri = 0
            elif any(t in pf_tk for t in tickers):
                topic_pri = 1
            elif any(t in wl_tk for t in tickers):
                topic_pri = 2
            else:
                topic_pri = 3
            items.append({"source": source, "title": title, "link": link,
                          "published": ts, "tickers": tickers,
                          "topic_pri": topic_pri, "inv": source == "Investing.com",
                          "sentiment": news_sentiment(title)})
    # ordina: prima per argomento (macro/politica→portafoglio→watchlist→resto),
    # dentro ogni gruppo Investing.com in cima e poi per data
    items.sort(key=lambda x: x["published"] or "", reverse=True)
    items.sort(key=lambda x: (x["topic_pri"], 0 if x["inv"] else 1))
    items = items[:48]
    for it in items:
        it["title_it"] = translate_it(it["title"])
    # mercati di previsione Polymarket, integrati nelle news
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for p in fetch_predictions():
        items.append({"source": "Polymarket", "title": p["question"],
                      "title_it": f"{p['question']} — probabilità Sì {p['yes']}%",
                      "link": p["link"], "published": now,
                      "tickers": ["MACRO"], "sentiment": "neutral"})
    return items


def clean_nan(obj):
    """Converte ricorsivamente NaN/Infinity in None (JSON valido per il browser)."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: clean_nan(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_nan(v) for v in obj]
    return obj


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
        rs, ds, val = r.get("_ret_series"), r.get("_ret_dates"), r.get("value")
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
        if not (r.get("qty") and price and atr):
            continue
        raw = price - 2 * atr
        prev = prev_by_ticker.get(r["ticker"]) or {}
        prev_stop = prev.get("stop_atr")
        same_pos = prev.get("qty") == r.get("qty") and prev.get("pmc") == r.get("pmc")
        stop = max(prev_stop, raw) if (prev_stop is not None and same_pos) else raw
        r["stop_atr"] = round(stop, 2)
        r["stop_violated"] = bool(price < stop)


def strip_private(rows):
    """Rimuove le chiavi interne (prefisso _) prima della serializzazione JSON."""
    for r in rows:
        for k in [k for k in list(r.keys()) if k.startswith("_")]:
            r.pop(k, None)


def main():
    # snapshot del run PRECEDENTE (serve due volte: ratchet degli stop e metrics_history)
    prev_data = {}
    try:
        if OUT.exists():
            prev_data = json.loads(OUT.read_text())
    except Exception:  # noqa: BLE001
        prev_data = {}

    equities = fetch_equities()
    btp = fetch_btp()
    watchlist = fetch_watchlist()
    macro = fetch_macro()

    # Metriche di rischio (Sharpe, beta NDX, correlazioni, MCR) PRIMA di rimuovere le serie interne
    risk = compute_risk_metrics(equities, watchlist) or {}
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

    # storico metriche (1 punto per giorno): Sharpe e performance, per i mini-trend in dashboard
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    prev_hist = prev_data.get("metrics_history") or []
    point = {
        "date": today,
        "sharpe": portfolio_sharpe,
        "gain_pct": round((total_eur / cost_eur - 1) * 100, 2),
        "eur_value": round(total_eur, 2),
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
            "usd_gain_pct": round((usd_value / usd_cost - 1) * 100, 2),
            "eur_value": round(total_eur, 2),
            "eur_gain": round(eur_gain, 2),
            "eur_gain_pct": round((total_eur / cost_eur - 1) * 100, 2),
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
            "var95_1d_eur": round(usd_value / eurusd * risk["var95_1d_pct"] / 100) if risk.get("var95_1d_pct") else None,
            "es95_1d_eur": round(usd_value / eurusd * risk["es95_1d_pct"] / 100) if risk.get("es95_1d_pct") else None,
            # variante STORICA (percentili empirici — primaria: onesta sulle code grasse)
            "var95_hist_pct": risk.get("var95_hist_pct"),
            "es95_hist_pct": risk.get("es95_hist_pct"),
            "var95_hist_eur": round(usd_value / eurusd * risk["var95_hist_pct"] / 100) if risk.get("var95_hist_pct") else None,
            "es95_hist_eur": round(usd_value / eurusd * risk["es95_hist_pct"] / 100) if risk.get("es95_hist_pct") else None,
        },
        "portfolio": equities + [btp],
        "watchlist": watchlist,
        "allocation": allocation,
        "history": fetch_portfolio_history(btp["value"]),
        "macro": macro,
        "broker": BROKER,
        "top_caps": fetch_top_caps(),
        "top_etfs": fetch_top_etfs(),
        "predictions": fetch_predictions(),
        "news": fetch_news(),
        "options": options,
        "metrics_history": metrics_history,
        "sanity_filtered": SANITY_FILTERED,   # anomalie API scartate dal sanity check in questo run
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # NaN/Infinity non sono JSON validi per il browser → li converto in null prima di scrivere
    OUT.write_text(json.dumps(clean_nan(data), ensure_ascii=False, indent=1))
    print(f"OK -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
