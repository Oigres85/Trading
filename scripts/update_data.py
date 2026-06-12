#!/usr/bin/env python3
"""Aggiorna data/data.json con quotazioni, dati tecnici, macro e news.

Fonti (tutte gratuite):
- Yahoo Finance (yfinance): quotazioni, storico, fondamentali, VIX, futures Fed Funds, EURUSD
- CNN: Fear & Greed Index
- FRED (csv pubblico, senza API key): CPI, PCE, PIL, vendite al dettaglio, NFP, disoccupazione, tasso Fed
- DBnomics: ISM Manufacturing PMI
- Borsa Italiana (scrape): prezzo BTP Valore Ott 2028
- RSS: CNBC, Bloomberg, Yahoo Finance, Investing.com, Google News
"""
import json
import math
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

BTP = {
    "ticker": "BTP-V28", "name": "BTP Valore Ott 2028", "isin": "IT0005565400",
    "nominal": 40000, "pmc": 100.0, "fallback_price": 103.25,
}

NEWS_FEEDS = [
    ("CNBC", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"),
    ("Bloomberg", "https://feeds.bloomberg.com/markets/news.rss"),
    ("Yahoo Finance", "https://finance.yahoo.com/news/rssindex"),
    ("Investing.com", "https://www.investing.com/rss/news_25.rss"),
    ("Google News", "https://news.google.com/rss/search?q=stock+market+OR+federal+reserve&hl=en-US&gl=US&ceid=US:en"),
    ("Google News", "https://news.google.com/rss/search?q=Nvidia+OR+AMD+OR+Micron+OR+Intel+OR+Tesla+OR+MicroStrategy+OR+Rigetti+OR+Oklo+OR+%22Arbe+Robotics%22&hl=en-US&gl=US&ceid=US:en"),
]

PORTFOLIO_KEYWORDS = {
    "NVDA": ["nvidia", "nvda"], "AMD": ["amd ", "advanced micro"],
    "MU": ["micron"], "INTC": ["intel"], "TSLA": ["tesla", "musk"],
    "MSTR": ["microstrategy", "strategy inc", "mstr", "saylor"],
    "RGTI": ["rigetti"], "OKLO": ["oklo"], "ARBE": ["arbe"],
    "BTP-V28": ["btp", "italian bond", "italy bond"],
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


def fetch_equities():
    rows = []
    for pos in PORTFOLIO:
        t = yf.Ticker(pos["ticker"])
        hist = t.history(period="1y", interval="1d", auto_adjust=True)
        if hist.empty:
            print(f"!! nessuno storico per {pos['ticker']}", file=sys.stderr)
            continue
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

        value = price * pos["qty"]
        cost = pos["pmc"] * pos["qty"]
        rows.append({
            **pos,
            "currency": "USD",
            "price": round(price, 2),
            "change_pct": round((price / prev - 1) * 100, 2),
            "value": round(value, 2),
            "gain": round(value - cost, 2),
            "gain_pct": round((value / cost - 1) * 100, 2),
            "pe": round(float(pe), 1) if pe else None,
            "ath": round(ath, 2),
            "ath_dist_pct": round((price / ath - 1) * 100, 1),
            "support": round(float(hist["Low"].tail(20).min()), 2),
            "resistance": round(float(hist["High"].tail(20).max()), 2),
            "rsi": rsi,
            "volume": int(vol),
            "vol_ratio": round(vol / vol_avg30, 2) if vol_avg30 else None,
            "signal": sig,
            "signal_class": sig_class,
            "spark": [round(float(c), 2) for c in closes.tail(30)],
        })
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
        "spark": [],
    }


def fred_series(series_id, n=14):
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
        if not x["period"].startswith("M"):
            continue
        try:
            out.append((f"{x['year']}-{x['period'][1:]}-01", float(x["value"].replace(",", ""))))
        except ValueError:
            continue
    out.reverse()
    return out[-n:]


def dbnomics_series(code, n=14):
    """Fallback per le serie BEA (PIL, PCE) via DBnomics."""
    r = http_get(f"https://api.db.nomics.world/v22/series/{code}?observations=1&format=json")
    doc = r.json()["series"]["docs"][0]
    pairs = [(p, v) for p, v in zip(doc["period"], doc["value"]) if isinstance(v, (int, float))]
    return pairs[-n:]


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
        target = fred_series("DFEDTARU", 1)[-1][1]
        target_low = fred_series("DFEDTARL", 1)[-1][1]
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
    return macro


def fetch_news():
    items, seen = [], set()
    for source, url in NEWS_FEEDS:
        try:
            r = http_get(url, timeout=20)
            feed = feedparser.parse(r.content)
            for e in feed.entries[:15]:
                title = e.get("title", "").strip()
                if not title or title.lower() in seen:
                    continue
                seen.add(title.lower())
                ts = None
                for k in ("published_parsed", "updated_parsed"):
                    if e.get(k):
                        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", e[k])
                        break
                tickers = [tk for tk, kws in PORTFOLIO_KEYWORDS.items()
                           if any(kw in title.lower() for kw in kws)]
                items.append({"source": source, "title": title,
                              "link": e.get("link", ""), "published": ts,
                              "tickers": tickers})
        except Exception as e:  # noqa: BLE001
            print(f"!! feed {source}: {e}", file=sys.stderr)
    items.sort(key=lambda x: x["published"] or "", reverse=True)
    return items[:60]


def main():
    equities = fetch_equities()
    btp = fetch_btp()

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
        "macro": fetch_macro(),
        "news": fetch_news(),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print(f"OK -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
