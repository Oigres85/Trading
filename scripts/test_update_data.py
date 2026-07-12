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

# ---------- risk_ratios (v112): stessa metrica su finestre 12M e 6M ----------
_ret = pd.Series(([0.01, -0.002] * 100))          # drift positivo con downside reale
_sh, _so = ud.risk_ratios(_ret)
check("risk_ratios: drift positivo → Sharpe e Sortino positivi, Sortino ≥ Sharpe (downside dev ≤ std)",
      _sh is not None and _so is not None and _sh > 0 and _so >= _sh)
check("risk_ratios: <60 osservazioni → (None, None) — la finestra 6M di un'IPO resta n.d.",
      ud.risk_ratios(pd.Series([0.01] * 30)) == (None, None))

# ---------- notify_alerts (v113): raccolta, dedup e composizione — funzioni pure ----------
import notify_alerts as na
_nd = {"portfolio": [{"ticker": "TSTV", "qty": 10, "stop_violated": True, "price": 90, "stop_atr": 100},
                     {"ticker": "OKAY", "qty": 5, "stop_violated": False}],
       "watchlist": [{"ticker": "SQZ", "stats": {"short_float": 0.25}, "vol_ratio": 2.5, "sma50_dist_pct": 3.0},
                     {"ticker": "NOP", "stats": {"short_float": 0.25}, "vol_ratio": 1.0, "sma50_dist_pct": 3.0}],
       "data_quality": {"alerts": ["umich: stale"]}, "updated_at": "2026-07-11T10:00:00Z"}
_cur = na.collect_alerts(_nd)
check("notify: collect_alerts (stop violato, squeeze setup, data quality)",
      _cur == {"stops": ["TSTV"], "dq": ["umich: stale"], "squeeze": ["SQZ"]})
_new = na.diff_alerts(_cur, {"stops": [], "dq": ["umich: stale"], "squeeze": []})
check("notify: diff_alerts segnala solo le novità (dq già notificato → fuori)",
      _new == {"stops": ["TSTV"], "dq": [], "squeeze": ["SQZ"]})
check("notify: build_message compone i blocchi e torna None senza novità",
      "STOP VIOLATO" in na.build_message(_new, _nd) and "SQZ" in na.build_message(_new, _nd)
      and na.build_message({"stops": [], "dq": [], "squeeze": []}, _nd) is None)

# ---------- BLINDATURA RATCHET + SCUDO SOTTO-ZERO (v115, post-incidente SNDK) ----------
_nanf = float("nan")
# 1) ATR NaN nel run corrente: lo stop ancorato NON si perde (carry del prev), niente nan propagato
_rows = [dict(ticker="TSTX", qty=10, pmc=50, price=100.0, atr_14=_nanf)]
ud.ratchet_stops(_rows, {"TSTX": {"stop_atr": 80.0, "qty": 10, "pmc": 50}})
check("ratchet blindato: ATR NaN → carry dello stop precedente (80), mai nan",
      _rows[0].get("stop_atr") == 80.0 and _rows[0].get("stop_violated") is False)
# 2) 2×ATR ≥ prezzo senza prev → NIENTE stop esportato (mai negativo nel payload)
_rows = [dict(ticker="TSTX", qty=10, pmc=50, price=100.0, atr_14=60.0)]
ud.ratchet_stops(_rows, {})
check("scudo sotto-zero: raw negativo senza prev → nessuno stop nel payload",
      "stop_atr" not in _rows[0] and "stop_violated" not in _rows[0])
# 3) prev spazzatura (5× il prezzo, run avvelenato) → si riparte dal calcolo pulito
_rows = [dict(ticker="TSTX", qty=10, pmc=50, price=100.0, atr_14=5.0)]
ud.ratchet_stops(_rows, {"TSTX": {"stop_atr": 500.0, "qty": 10, "pmc": 50}})
check("ratchet blindato: prev implausibile (5× prezzo) scartato → stop = ricalcolo pulito 90",
      _rows[0].get("stop_atr") == 90.0 and _rows[0].get("stop_violated") is False)
# 4) monotonia certificata: mai al ribasso su posizione invariata, in NESSUNA sequenza
_prev = {}
_stops = []
for _px in [100.0, 130.0, 90.0, 85.0, 140.0, 60.0]:
    _rows = [dict(ticker="TSTX", qty=10, pmc=50, price=_px, atr_14=5.0)]
    ud.ratchet_stops(_rows, _prev)
    _stops.append(_rows[0]["stop_atr"])
    _prev = {"TSTX": {"stop_atr": _rows[0]["stop_atr"], "qty": 10, "pmc": 50}}
check("ratchet blindato: sequenza sali-scendi → stop MONOTONO non decrescente",
      all(b >= a for a, b in zip(_stops, _stops[1:])))

# ---------- drop_void_bars v115: barre-glitch (minimi fantasma) ----------
_g = pd.DataFrame({"Open": [1900.0, 1910.0, 1905.0, 200.0, -5.0],
                   "High": [1920.0, 1915.0, 1910.0, 210.0, 5.0],
                   "Low":  [1890.0, 40.1,   100.0,  95.0,  -10.0],
                   "Close":[1915.0, 1912.0, 1908.0, 100.0, 3.0]})
# riga 0: sana · riga 1: minimo fantasma 40.1 con corpo ~1910 (bad tick → VIA) ·
# riga 2: Low 100 su corpo 1905 (glitch → VIA) · riga 3: flash crash VERO (chiude 100,
# low 95 vicino al corpo → RESTA) · riga 4: prezzi negativi (→ VIA)
_clean = ud.drop_void_bars(_g)
check("barre-glitch: minimo fantasma (SNDK-like 40.1 su corpo 1910) e prezzi ≤0 scartati, flash crash vero conservato",
      len(_clean) == 2 and list(_clean["Low"]) == [1890.0, 95.0])

# ---------- morning brief (v117): digest deterministico, componibile e pulito ----------
import morning_brief as mb
_bdata = {
    "updated_at": "2026-07-12T06:01:00Z",
    "totals": {"eur_value": 297662.47, "eur_gain_pct": 59.78},
    "portfolio": [
        {"ticker": "AAA", "currency": "USD", "price": 100.0, "stop_atr": 95.0, "value": 10000,
         "change_pct": 1.2, "earnings_date": "2026-07-15"},
        {"ticker": "BBB", "currency": "USD", "price": 50.0, "stop_atr": 55.0, "stop_violated": True,
         "value": 5000, "change_pct": -2.0},
    ],
    "data_quality": {"alerts": ["umich: stale"]},
    "macro": {"vix": {"value": 15.03}, "smart_money": {"vix_term_ratio": 0.81}},
    "metrics_history": [{"date": "2026-07-04", "vix": 17.0}],
}
_bv = {"label": "ACCUMULA", "candidates": [{"tk": "SNDK", "q": 90, "limit": 1485.02}], "rehab": ["META"], "squeeze": []}
_brief = mb.build_brief(_bdata, _bv, now=datetime(2026, 7, 12, 7, 0, tzinfo=timezone.utc))
check("morning brief: verdetto, stop violati, earnings, delta VIX 7g e riabilitati tutti presenti",
      all(s in _brief for s in ("ACCUMULA", "SNDK 90/100", "STOP VIOLATO: BBB", "AAA 15/07",
                                "META", "umich: stale", "-2,0 vs 7g", "Stop vicini: AAA +5,3%")))
check("morning brief: niente 'None'/'nan' nel testo e lunghezza entro il limite CallMeBot",
      "None" not in _brief and "nan" not in _brief and len(_brief) <= 1400)

# ---------- div_yield_frac (v118): dividendo assoluto/prezzo, non ambiguo + cap ----------
check("div_yield_frac: rate/price esatto (GOOGL $0,84 su $357 = 0,24%, non il 25% del bug)",
      abs(ud.div_yield_frac(0.84, 357.0, 0.25) - 0.84 / 357.0) < 1e-9)
check("div_yield_frac: MU $0,46 su $979 ≈ 0,047% (non il 5% del bug boundary)",
      ud.div_yield_frac(0.46, 979.0, 0.05) < 0.001)
check("div_yield_frac: senza tasso → fallback al campo % di Yahoo (ORCL 1.39 → 0,0139)",
      abs(ud.div_yield_frac(None, 140.0, 1.39) - 0.0139) < 1e-9)
check("div_yield_frac: cap 30% — un 453% (TLT-like) è errore di unità → None",
      ud.div_yield_frac(None, 84.0, 453.0) is None and ud.div_yield_frac(300.0, 84.0, None) is None)

N_CHECKS = 41
print(f"\n{('TUTTI I ' + str(N_CHECKS - len(FAILED)) + f'/{N_CHECKS} CHECK OK') if not FAILED else str(len(FAILED)) + ' FALLITI: ' + ', '.join(FAILED)}")
sys.exit(1 if FAILED else 0)
