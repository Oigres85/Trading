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
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import feedparser
import pandas as pd
import requests
import yfinance as yf

OUT = Path(__file__).resolve().parent.parent / "data" / "data.json"

UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "*/*",
}

PORTFOLIO = [
    {"ticker": "NVDA", "name": "NVIDIA",         "qty": 270,  "pmc": 87.17},
    {"ticker": "AMD",  "name": "AMD",            "qty": 125,  "pmc": 153.92},
    {"ticker": "MU",   "name": "Micron",         "qty": 90,   "pmc": 87.63},
    {"ticker": "INTC", "name": "Intel",          "qty": 380,  "pmc": 25.75},
    {"ticker": "TSLA", "name": "Tesla",          "qty": 60,   "pmc": 358.22},
    {"ticker": "MSTR", "name": "Strategy",       "qty": 123,  "pmc": 210.22},
    {"ticker": "RGTI", "name": "Rigetti",        "qty": 515,  "pmc": 27.30},
    {"ticker": "OKLO", "name": "Oklo",           "qty": 120,  "pmc": 72.43},
    {"ticker": "ARBE", "name": "Arbe Robotics",  "qty": 1150, "pmc": 3.35},
]

WATCHLIST = ["OKLO", "SPCX", "CBRS"]

BTP = {
    "ticker": "BTP-V28", "name": "BTP Valore Ott 2028", "isin": "IT0005565400",
    "nominal": 40000, "pmc": 100.0, "fallback_price": 103.25,
}

PUTCALL_SYMBOL = ("BSX", "Boston Scientific")

NEWS_FEEDS = [
    ("CNBC", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"),
    ("Bloomberg", "https://feeds.bloomberg.com/markets/news.rss"),
    ("Yahoo Finance", "https://finance.yahoo.com/news/rssindex"),
    ("Investing.com", "https://www.investing.com/rss/news_25.rss"),
    ("Google News", "https://news.google.com/rss/search?q=Nvidia+OR+AMD+OR+Micron+OR+Intel+OR+Tesla&hl=en-US&gl=US&ceid=US:en"),
    ("Google News", "https://news.google.com/rss/search?q=MicroStrategy+OR+%22Rigetti+Computing%22+OR+%22Oklo%22+OR+%22Arbe+Robotics%22+OR+%22BTP+Valore%22&hl=en-US&gl=US&ceid=US:en"),
]

# pattern regex (word boundary) per associare le news ai titoli
PORTFOLIO_KEYWORDS = {
    "NVDA": [r"\bnvidia\b", r"\bnvda\b"], "AMD": [r"\bamd\b", r"advanced micro"],
    "MU": [r"\bmicron\b"], "INTC": [r"\bintel\b"], "TSLA": [r"\btesla\b", r"\bmusk\b"],
    "MSTR": [r"\bmicrostrategy\b", r"\bstrategy inc\b", r"\bmstr\b", r"\bsaylor\b"],
    "RGTI": [r"\brigetti\b"], "OKLO": [r"\boklo\b"], "ARBE": [r"\barbe\b"],
    "BTP-V28": [r"\bbtp\b", r"italian bond", r"italy bond"],
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


def fetch_symbol(ticker, name=None):
    """Quote + dati tecnici + rating + trimestrale + sparkline per un titolo."""
    t = yf.Ticker(ticker)
    hist = t.history(period="1y", interval="1d", auto_adjust=True)
    if hist.empty:
        print(f"!! nessuno storico per {ticker}", file=sys.stderr)
        return None
    closes = hist["Close"]
    price = float(closes.iloc[-1])
    prev = float(closes.iloc[-2]) if len(closes) > 1 else price

    try:
        ath = float(t.history(period="max", interval="1mo")["High"].max())
    except Exception:  # noqa: BLE001
        ath = float(hist["High"].max())

    try:
        info = t.info or {}
    except Exception:  # noqa: BLE001
        info = {}
    pe = info.get("trailingPE") or info.get("forwardPE")

    sma50 = float(closes.rolling(50).mean().iloc[-1]) if len(closes) >= 50 else None
    sma200 = float(closes.rolling(200).mean().iloc[-1]) if len(closes) >= 200 else None
    rsi = rsi14(closes)
    sig, sig_class = signal_label(price, sma50, sma200, rsi)

    vol = float(hist["Volume"].iloc[-1])
    vol_avg30 = float(hist["Volume"].tail(30).mean())

    # sparkline su tre orizzonti: 1 giorno (5 min), 1 mese (giornaliero), 1 anno
    sparks = {
        "m1": [round(float(c), 2) for c in closes.tail(30)],
        "y1": [round(float(c), 2) for c in closes[::5]],
        "d1": [],
    }
    try:
        h1 = t.history(period="1d", interval="5m")["Close"].dropna()
        if len(h1) >= 2:
            sparks["d1"] = [round(float(c), 2) for c in h1[::2]]
    except Exception:  # noqa: BLE001
        pass

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
    return {
        "ticker": ticker,
        "name": name or auto_name,
        "currency": "USD",
        "price": round(price, 2),
        "change_pct": round((price / prev - 1) * 100, 2),
        "pe": round(float(pe), 1) if pe and pe > 0 else None,
        "ath": round(ath, 2),
        "ath_dist_pct": round((price / ath - 1) * 100, 1),
        "support": round(float(hist["Low"].tail(20).min()), 2),
        "resistance": round(float(hist["High"].tail(20).max()), 2),
        "rsi": rsi,
        "volume": int(vol),
        "vol_ratio": round(vol / vol_avg30, 2) if vol_avg30 else None,
        "signal": sig,
        "signal_class": sig_class,
        "sparks": sparks,
        "earnings_date": earnings_date,
        "rating": rating,
        "health": health,
    }


def fetch_equities():
    rows = []
    for pos in PORTFOLIO:
        row = fetch_symbol(pos["ticker"], pos["name"])
        if not row:
            continue
        value = row["price"] * pos["qty"]
        cost = pos["pmc"] * pos["qty"]
        row.update({
            "qty": pos["qty"], "pmc": pos["pmc"],
            "value": round(value, 2),
            "gain": round(value - cost, 2),
            "gain_pct": round((value / cost - 1) * 100, 2),
        })
        rows.append(row)
    return rows


def fetch_watchlist():
    rows = []
    for ticker in WATCHLIST:
        row = fetch_symbol(ticker)
        if row:
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
        "price": round(price, 2), "change_pct": None,
        "value": round(value, 2), "gain": round(value - cost, 2),
        "gain_pct": round((value / cost - 1) * 100, 2),
        "pe": None, "ath": None, "ath_dist_pct": None,
        "support": None, "resistance": None, "rsi": None,
        "volume": None, "vol_ratio": None,
        "signal": "Cedola 4,10/4,50%", "signal_class": "info",
        "sparks": {}, "earnings_date": None, "rating": None, "health": None,
    }


def fred_series(series_id, n=14):
    # con FRED_API_KEY (gratuita, https://fred.stlouisfed.org/docs/api/api_key.html)
    # usa l'API ufficiale, molto più affidabile del csv pubblico
    key = os.environ.get("FRED_API_KEY")
    if key:
        r = http_get("https://api.stlouisfed.org/fred/series/observations"
                     f"?series_id={series_id}&api_key={key}&file_type=json"
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

    # CNN Fear & Greed
    try:
        fg = http_get("https://production.dataviz.cnn.io/index/fearandgreed/graphdata").json()["fear_and_greed"]
        macro["fear_greed"] = {
            "score": round(fg["score"]), "rating": fg["rating"],
            "prev_close": round(fg.get("previous_close", 0)),
            "week_ago": round(fg.get("previous_1_week", 0)),
            "month_ago": round(fg.get("previous_1_month", 0)),
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
        try:
            target = fred_series("DFEDTARU", 1)[-1][1]
            target_low = fred_series("DFEDTARL", 1)[-1][1]
        except Exception:  # noqa: BLE001 — FRED bloccato: range obiettivo dalla NY Fed
            rr = http_get("https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json").json()["refRates"][0]
            target, target_low = float(rr["targetRateTo"]), float(rr["targetRateFrom"])
        zq = yf.Ticker("ZQ=F").fast_info.last_price
        implied = round(100 - float(zq), 2)
        mid = (target + target_low) / 2
        macro["fedwatch"] = {
            "target_range": f"{target_low:.2f}–{target:.2f}%",
            "implied_rate": implied,
            "delta_bp": round((implied - mid) * 100),
        }
    except Exception as e:  # noqa: BLE001
        print(f"!! fedwatch: {e}", file=sys.stderr)

    # Serie FRED
    def yoy(series):
        return round((series[-1][1] / series[-13][1] - 1) * 100, 1), series[-1][0]

    def mom(series):
        return round((series[-1][1] / series[-2][1] - 1) * 100, 1), series[-1][0]

    indicators = []
    try:
        v, d = yoy(series_fallback("cpi", lambda: fred_series("CPIAUCSL"),
                                   lambda: bls_series("CUSR0000SA0")))
        indicators.append({"key": "cpi", "label": "Inflazione CPI (a/a)", "value": f"{v}%", "date": d})
    except Exception as e:  # noqa: BLE001
        print(f"!! cpi: {e}", file=sys.stderr)
    try:
        v, d = yoy(series_fallback("pce", lambda: fred_series("PCEPI"),
                                   lambda: dbnomics_series("BEA/NIPA-T20804/DPCERG-M")))
        indicators.append({"key": "pce", "label": "Inflazione PCE (a/a)", "value": f"{v}%", "date": d})
    except Exception as e:  # noqa: BLE001
        print(f"!! pce: {e}", file=sys.stderr)
    try:
        s = series_fallback("gdp", lambda: fred_series("A191RL1Q225SBEA", 2),
                            lambda: dbnomics_series("BEA/NIPA-T10101/A191RL-Q", 2))
        indicators.append({"key": "gdp", "label": "PIL USA (t/t ann.)", "value": f"{s[-1][1]}%", "date": s[-1][0]})
    except Exception as e:  # noqa: BLE001
        print(f"!! gdp: {e}", file=sys.stderr)
    try:
        v, d = mom(fred_series("RSAFS"))
        indicators.append({"key": "retail", "label": "Vendite al dettaglio (m/m)", "value": f"{v}%", "date": d})
    except Exception as e:  # noqa: BLE001
        print(f"!! retail: {e}", file=sys.stderr)
    try:
        s = series_fallback("nfp", lambda: fred_series("PAYEMS", 3),
                            lambda: bls_series("CES0000000001", 3))
        delta = round((s[-1][1] - s[-2][1]))
        indicators.append({"key": "nfp", "label": "Non-Farm Payrolls", "value": f"{delta:+d}K", "date": s[-1][0]})
    except Exception as e:  # noqa: BLE001
        print(f"!! nfp: {e}", file=sys.stderr)
    try:
        s = series_fallback("unemp", lambda: fred_series("UNRATE", 2),
                            lambda: bls_series("LNS14000000", 2))
        indicators.append({"key": "unemp", "label": "Disoccupazione", "value": f"{s[-1][1]}%", "date": s[-1][0]})
    except Exception as e:  # noqa: BLE001
        print(f"!! unrate: {e}", file=sys.stderr)
    try:
        s = fred_series("UMCSENT", 2)
        indicators.append({"key": "pmi", "label": "Fiducia consumatori (UMich)",
                           "value": f"{s[-1][1]}", "date": s[-1][0]})
    except Exception as e:  # noqa: BLE001
        print(f"!! umcsent: {e}", file=sys.stderr)

    macro["indicators"] = indicators

    # Mercati di riferimento
    markets = []
    for sym, label, fmt, decimals, suffix in [
        ("BTC-USD", "Bitcoin", "${v:,.0f}", 2, "%"),
        ("CL=F", "Petrolio WTI", "${v:,.2f}", 2, "%"),
        ("^KS11", "KOSPI", "{v:,.0f}", 2, "%"),
        ("^IXIC", "Nasdaq Composite", "{v:,.0f}", 2, "%"),
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
        macro["carry"] = {
            "us10": round(us10, 2), "jp10": round(float(jp10), 2),
            "spread": round(us10 - float(jp10), 2),
            "usdjpy": round(usdjpy, 2), "usdjpy_chg_1m": usdjpy_chg_1m,
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
    btc = next((m for m in markets if m["key"] == "BTC-USD"), None)
    if btc:
        comps.append(("Bitcoin", clamp(50 + btc["change_pct"] * 10), .10))
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

    return macro


def fetch_news():
    """Solo news correlate ai titoli in portafoglio."""
    items, seen = [], set()
    for source, url in NEWS_FEEDS:
        try:
            r = http_get(url, timeout=20)
            feed = feedparser.parse(r.content)
            for e in feed.entries[:25]:
                title = e.get("title", "").strip()
                if not title or title.lower() in seen:
                    continue
                tickers = [tk for tk, kws in PORTFOLIO_KEYWORDS.items()
                           if any(re.search(kw, title.lower()) for kw in kws)]
                if not tickers:
                    continue
                seen.add(title.lower())
                ts = None
                for k in ("published_parsed", "updated_parsed"):
                    if e.get(k):
                        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", e[k])
                        break
                items.append({"source": source, "title": title,
                              "link": e.get("link", ""), "published": ts,
                              "tickers": tickers})
        except Exception as e:  # noqa: BLE001
            print(f"!! feed {source}: {e}", file=sys.stderr)
    items.sort(key=lambda x: x["published"] or "", reverse=True)
    return items[:40]


def main():
    equities = fetch_equities()
    btp = fetch_btp()
    watchlist = fetch_watchlist()
    macro = fetch_macro()

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

    data = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "eurusd": round(eurusd, 4),
        "totals": {
            "usd_value": round(usd_value, 2),
            "usd_gain": round(usd_value - usd_cost, 2),
            "usd_gain_pct": round((usd_value / usd_cost - 1) * 100, 2),
            "eur_value": round(total_eur, 2),
            "eur_gain": round(total_eur - cost_eur, 2),
            "eur_gain_pct": round((total_eur / cost_eur - 1) * 100, 2),
        },
        "portfolio": equities + [btp],
        "watchlist": watchlist,
        "macro": macro,
        "news": fetch_news(),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print(f"OK -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
