#!/usr/bin/env python3
"""Test delle funzioni PURE di update_data.py (niente rete: il fetch NDX dentro
compute_risk_metrics fallisce offline ed è gestito — i beta restano n.d., il resto
dei calcoli deve comunque uscire). Uso: python3 scripts/test_update_data.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
import pandas as pd

from update_data import compute_risk_metrics, ratchet_stops

FAILED = []


def check(name, cond):
    print(f"{'PASS' if cond else 'FAIL'}  {name}")
    if not cond:
        FAILED.append(name)


def mk(tk, qty, pmc, price, atr):
    return {"ticker": tk, "qty": qty, "pmc": pmc, "price": price, "atr_14": atr}


# ---------- ratchet_stops: 6 scenari ----------
rows = [mk("AAA", 10, 100, 200, 10)]
ratchet_stops(rows, {})
check("ratchet: primo run → stop = prezzo − 2×ATR", rows[0]["stop_atr"] == 180 and rows[0]["stop_violated"] is False)

rows = [mk("AAA", 10, 100, 250, 10)]
ratchet_stops(rows, {"AAA": {"stop_atr": 180, "qty": 10, "pmc": 100}})
check("ratchet: prezzo sale → stop sale", rows[0]["stop_atr"] == 230)

rows = [mk("AAA", 10, 100, 240, 10)]
ratchet_stops(rows, {"AAA": {"stop_atr": 230, "qty": 10, "pmc": 100}})
check("ratchet: prezzo scende sopra lo stop → stop NON ridiscende", rows[0]["stop_atr"] == 230 and rows[0]["stop_violated"] is False)

rows = [mk("AAA", 10, 100, 210, 10)]
ratchet_stops(rows, {"AAA": {"stop_atr": 230, "qty": 10, "pmc": 100}})
check("ratchet: prezzo sotto lo stop → VIOLATO, stop congelato", rows[0]["stop_atr"] == 230 and rows[0]["stop_violated"] is True)

rows = [mk("AAA", 20, 150, 210, 10)]
ratchet_stops(rows, {"AAA": {"stop_atr": 230, "qty": 10, "pmc": 100}})
check("ratchet: trade cambiato (qty/pmc) → reset", rows[0]["stop_atr"] == 190 and rows[0]["stop_violated"] is False)

rows = [mk("BBB", 0, None, 100, 5), mk("CCC", 10, 50, 100, None)]
ratchet_stops(rows, {})
check("ratchet: watchlist/senza ATR → nessun campo", "stop_atr" not in rows[0] and "stop_atr" not in rows[1])

# ---------- compute_risk_metrics su pannello sintetico ----------
rng = np.random.default_rng(42)
dates = pd.bdate_range("2025-07-01", periods=252)
panel = []
for tk, mu, sig in (("XX", 0.001, 0.02), ("YY", 0.0005, 0.03), ("ZZ", -0.001, 0.04)):
    ret = rng.normal(mu, sig, 252)
    panel.append({"ticker": tk, "qty": 10, "pmc": 50, "value": 10000,
                  "_ret_series": [float(x) for x in ret],
                  "_ret_dates": [d.strftime("%Y-%m-%d") for d in dates]})
risk = compute_risk_metrics(panel, []) or {}

check("risk: sharpe e sortino calcolati", risk.get("sharpe") is not None and risk.get("sortino") is not None)
check("risk: VaR parametrico e storico presenti", risk.get("var95_1d_pct") and risk.get("var95_hist_pct"))
check("risk: ES > VaR (parametrico)", risk["es95_1d_pct"] > risk["var95_1d_pct"])
check("risk: ES storico > VaR storico", risk["es95_hist_pct"] > risk["var95_hist_pct"])
check("risk: VaR storico plausibile vs parametrico (0.5×–2×)",
      0.5 < risk["var95_hist_pct"] / risk["var95_1d_pct"] < 2.0)

mcr_sum = sum(r.get("risk_contrib_pct", 0) for r in panel)
check("risk: MCR somma ≈ 100%", 95 <= mcr_sum <= 105)
check("risk: correlazioni annotate su ogni riga",
      all(r.get("avg_corr") is not None and r.get("max_corr_with") for r in panel))
check("risk: avg_pairwise_corr in [-1,1]", risk.get("avg_pairwise_corr") is not None and -1 <= risk["avg_pairwise_corr"] <= 1)


# ---------- margin debt: carry-forward quando lo scrape FINRA fallisce ----------
import update_data as ud
from datetime import datetime, timezone, timedelta
_orig_scrape = ud._finra_scrape
ud._finra_scrape = lambda url: (_ for _ in ()).throw(RuntimeError("403 simulato"))
recent = (datetime.now(timezone.utc) - timedelta(days=40)).strftime("%Y-%m-01")
prev_ok = {"series": "FINRA debit balances (mensile)", "date": recent, "value": 1415557,
           "peak": 1415557, "pct_of_peak": 100.0, "history": []}
md_cf = ud.fetch_margin_debt(prev_ok)
check("margin debt: carry-forward FINRA recente quando scrape ko",
      md_cf is not None and md_cf.get("carried") is True and md_cf["value"] == 1415557)
old = dict(prev_ok, date=(datetime.now(timezone.utc) - timedelta(days=120)).strftime("%Y-%m-01"))
md_old = ud.fetch_margin_debt(old)
check("margin debt: prev troppo vecchio (120g) NON riportato avanti (Z.1 flaggato o None)",
      md_old is None or md_old.get("unreliable") is True)
ud._finra_scrape = _orig_scrape


# ---------- Fix estrazione dati (v104.2): has_fundamentals ----------
check("has_fundamentals: True per azioni USA incluse multi-classe (AAPL, NVDA, BRK-B, BF-B)",
      all(ud.has_fundamentals(t,"USD") for t in ("AAPL","NVDA","BRK-B","BF-B","BRK-A")))
check("has_fundamentals: cripto -USD escluse (BTC-USD, ETH-USD)",
      not ud.has_fundamentals("BTC-USD","USD") and not ud.has_fundamentals("ETH-USD","USD"))
check("has_fundamentals: False per indici/cripto/commodity/ETF/EUR",
      not any([ud.has_fundamentals("^KS11","USD"), ud.has_fundamentals("^IXIC","USD"),
               ud.has_fundamentals("BTC-USD","USD"), ud.has_fundamentals("CL=F","USD"),
               ud.has_fundamentals("SPY","USD"), ud.has_fundamentals("QQQ","USD"),
               ud.has_fundamentals("SOXX","USD"), ud.has_fundamentals("BTP-V28","EUR")]))

# ---------- drop_void_bars (v110): barra Yahoo con Close=NaN (^KS11 post-chiusura) ----------
import pandas as pd
_df = pd.DataFrame({"Close": [100.0, 101.0, float("nan")], "Volume": [10, 11, 12]})
_trim = ud.drop_void_bars(_df)
check("drop_void_bars: barra finale senza Close scartata (prezzo = ultima chiusura valida)",
      len(_trim) == 2 and float(_trim["Close"].iloc[-1]) == 101.0)
check("drop_void_bars: storico tutto-NaN diventa vuoto (scatta il fallback/skip)",
      ud.drop_void_bars(pd.DataFrame({"Close": [float("nan")], "Volume": [1]})).empty
      and ud.drop_void_bars(pd.DataFrame()).empty)

# ---------- norm_div_yield (v110): yfinance dividendYield in % o frazione ----------
check("norm_div_yield: percento yfinance nuovo → frazione (ORCL 1.39 → 0.0139, TLT 4.53 → 0.0453)",
      abs(ud.norm_div_yield(1.39) - 0.0139) < 1e-9 and abs(ud.norm_div_yield(4.53) - 0.0453) < 1e-9)
check("norm_div_yield: frazione legacy e None passano intatti",
      ud.norm_div_yield(0.0142) == 0.0142 and ud.norm_div_yield(None) is None and ud.norm_div_yield(0.0) == 0.0)

# ---------- scrub_cross_currency_stats (v110): ADR con bilanci in valuta locale ----------
_s = {"price_to_book": 99.2, "ev_ebitda": 5.6, "fcf": 4e12, "enterprise_value": 2e12,
      "revenue_fy": 3e12, "net_income_fy": 1e12, "roe": 0.36, "pe_ttm": 38.2}
_out = ud.scrub_cross_currency_stats(dict(_s), "TWD", "USD")
check("scrub_cross_currency: TSM-like (TWD vs USD) → rapporti prezzo/bilancio nullati, ratio interni salvi",
      all(_out[k] is None for k in ("price_to_book", "ev_ebitda", "fcf", "enterprise_value", "revenue_fy", "net_income_fy"))
      and _out["roe"] == 0.36 and _out["pe_ttm"] == 38.2 and _out.get("cross_currency") is True)
_same = ud.scrub_cross_currency_stats(dict(_s), "USD", "USD")
check("scrub_cross_currency: valute uguali (o mancanti) → no-op",
      _same["price_to_book"] == 99.2 and "cross_currency" not in _same
      and ud.scrub_cross_currency_stats(dict(_s), None, "USD")["fcf"] == 4e12)

N_CHECKS = 25
print(f"\n{('TUTTI I ' + str(N_CHECKS - len(FAILED)) + f'/{N_CHECKS} CHECK OK') if not FAILED else str(len(FAILED)) + ' FALLITI: ' + ', '.join(FAILED)}")
sys.exit(1 if FAILED else 0)
