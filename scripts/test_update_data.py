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
check("notify: collect_alerts (stop violato, squeeze setup, data quality, shock vuoto)",
      _cur == {"stops": ["TSTV"], "dq": ["umich: stale"], "squeeze": ["SQZ"], "shock": []})
_new = na.diff_alerts(_cur, {"stops": [], "dq": ["umich: stale"], "squeeze": [], "shock": []})
check("notify: diff_alerts segnala solo le novità (dq già notificato → fuori)",
      _new == {"stops": ["TSTV"], "dq": [], "squeeze": ["SQZ"], "shock": []})
check("notify: build_message compone i blocchi e torna None senza novità",
      "STOP VIOLATO" in na.build_message(_new, _nd) and "SQZ" in na.build_message(_new, _nd)
      and na.build_message({"stops": [], "dq": [], "squeeze": [], "shock": []}, _nd) is None)
# MACRO SHOCK ALERT v125: collect + build
_shockd = {"portfolio": [], "watchlist": [], "data_quality": {},
           "macro": {"shock_alert": {"active": True, "threshold": -2.0,
                                     "sources": [{"src": "KOSPI (Asia)", "chg": -8.9}, {"src": "Futures Nasdaq 100", "chg": -2.4}]}}}
_sc = na.collect_alerts(_shockd)
check("notify shock v125: collect_alerts raccoglie le fonti oltre -2%",
      "KOSPI (Asia) -8.9%" in _sc["shock"] and "Futures Nasdaq 100 -2.4%" in _sc["shock"])
check("notify shock v125: build_message emette il blocco MACRO SHOCK ALERT",
      "MACRO SHOCK ALERT" in na.build_message(_sc, _shockd) and "SOSPENDI" in na.build_message(_sc, _shockd))
# v130: WhatsApp/CallMeBot ed email SMTP RIMOSSI — canale UNICO = GitHub Issue
check("notify v130: solo GitHub Issue (niente WhatsApp né email)",
      not hasattr(na, "send_whatsapp") and not hasattr(na, "send_email") and hasattr(na, "send_github_issue"))

# v137: falso-live — fast_info congelato sulla chiusura (mercato estero chiuso) NON è informativo
check("v137 _live_is_informative: scambio ≠ chiusura → live vero; identico alla chiusura → falso live (KOSPI congelato)",
      ud._live_is_informative(6820.0, 6825.5) and not ud._live_is_informative(6820.6, 6820.6)
      and not ud._live_is_informative(None, 6820.6))

# ---------- live-market + shock alert (v125): funzioni pure della pipeline ----------
check("v125 is_live_market: cripto/futures/indici esteri sì, azioni USA e indici USA no",
      ud.is_live_market("^KS11") and ud.is_live_market("BTC-USD") and ud.is_live_market("NQ=F")
      and not ud.is_live_market("AAPL") and not ud.is_live_market("^IXIC") and not ud.is_live_market("^GSPC"))
check("v125 compute_shock_alert: KOSPI -8,9% LIVE + futures -2,4% → alert attivo, worst -8,9%",
      (lambda s: s and s["active"] and s["worst_chg"] == -8.9 and len(s["sources"]) == 2)(
          ud.compute_shock_alert({"futures": {"nasdaq": {"change_pct": -2.4}, "sp500": {"change_pct": -0.5}}},
                                 [{"ticker": "^KS11", "change_pct": -8.9, "price_live": True}])))
check("v125 compute_shock_alert: cali sotto soglia (-1,5%) → nessun alert (None)",
      ud.compute_shock_alert({"futures": {"nasdaq": {"change_pct": -1.5}}}, [{"ticker": "^KS11", "change_pct": -1.0}]) is None)

# ---------- FIX FANTASMA v127: gate di sessione timezone-aware sul KOSPI a candela ----------
from datetime import datetime as _dt, timezone as _tz
_now_reopen = _dt(2026, 7, 17, 3, 0, tzinfo=_tz.utc)     # Seoul 2026-07-17 12:00 (sessione riaperta)
# 1) FANTASMA: crollo di IERI (candela 2026-07-16) letto oggi (Seoul 2026-07-17) con Asia riaperta
#    e live non disponibile → la candela stantia NON deve più attivare l'alert
check("v127 shock fantasma: KOSPI -8,95% da candela di IERI (asof<oggi Seoul), no live → alert None",
      ud.compute_shock_alert({}, [{"ticker": "^KS11", "change_pct": -8.95, "price_live": False,
                                   "price_asof": "2026-07-16"}], now_utc=_now_reopen) is None)
# 2) SESSIONE CORRENTE a candela: asof == oggi Seoul → alert legittimo attivo
check("v127 shock sessione corrente: KOSPI -8,95% da candela di OGGI (asof==oggi Seoul) → alert attivo",
      (lambda s: s and s["active"] and s["sources"][0]["basis"] == "candle")(
          ud.compute_shock_alert({}, [{"ticker": "^KS11", "change_pct": -8.95, "price_live": False,
                                       "price_asof": "2026-07-17"}], now_utc=_now_reopen)))
# 3) LIVE è sempre corrente per costruzione (delta ricalcolato vs chiusura recente)
check("v127 shock live: KOSPI -8,95% price_live=True → attivo a prescindere dalla data candela",
      (lambda s: s and s["active"] and s["sources"][0]["basis"] == "live")(
          ud.compute_shock_alert({}, [{"ticker": "^KS11", "change_pct": -8.95, "price_live": True}],
                                 now_utc=_now_reopen)))
# 4) i FUTURES restano live per costruzione (previous_close rolla al settlement) anche con KOSPI fantasma
check("v127 shock: futures -3% live restano attivi mentre il KOSPI fantasma è soppresso",
      (lambda s: s and len(s["sources"]) == 1 and s["sources"][0]["basis"] == "live")(
          ud.compute_shock_alert({"futures": {"nasdaq": {"change_pct": -3.0}}},
                                 [{"ticker": "^KS11", "change_pct": -8.95, "price_live": False,
                                   "price_asof": "2026-07-16"}], now_utc=_now_reopen)))
# 5) _market_date: offset Asia/Seoul (UTC+9) — 20:00 UTC del 16/07 è già 17/07 a Seoul
check("v127 _market_date: 2026-07-16 20:00 UTC → 2026-07-17 a Seoul (UTC+9)",
      ud._market_date("Asia/Seoul", _dt(2026, 7, 16, 20, 0, tzinfo=_tz.utc)).isoformat() == "2026-07-17")

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

# ---------- buyback_yield_frac (v138): riacquisti netti / mcap dal cashflow ----------
check("buyback: riacquisti $10B (negativi nel cashflow) − emissioni $2B su mcap $200B = +4%",
      ud.buyback_yield_frac(-10e9, 2e9, 200e9) == 0.04)
check("buyback: solo emissioni (SBC-heavy) → yield NEGATIVO = diluizione",
      ud.buyback_yield_frac(None, 4e9, 100e9) == -0.04)
check("buyback: senza mcap o senza flussi → None; |yield|>25% (unità sporche) → None",
      ud.buyback_yield_frac(-10e9, None, 0) is None and ud.buyback_yield_frac(None, None, 1e9) is None
      and ud.buyback_yield_frac(-50e9, None, 100e9) is None)

# ---------- div_yield_frac (v118): dividendo assoluto/prezzo, non ambiguo + cap ----------
check("div_yield_frac: rate/price esatto (GOOGL $0,84 su $357 = 0,24%, non il 25% del bug)",
      abs(ud.div_yield_frac(0.84, 357.0, 0.25) - 0.84 / 357.0) < 1e-9)
check("div_yield_frac: MU $0,46 su $979 ≈ 0,047% (non il 5% del bug boundary)",
      ud.div_yield_frac(0.46, 979.0, 0.05) < 0.001)
check("div_yield_frac: senza tasso → fallback al campo % di Yahoo (ORCL 1.39 → 0,0139)",
      abs(ud.div_yield_frac(None, 140.0, 1.39) - 0.0139) < 1e-9)
check("div_yield_frac: cap 30% — un 453% (TLT-like) è errore di unità → None",
      ud.div_yield_frac(None, 84.0, 453.0) is None and ud.div_yield_frac(300.0, 84.0, None) is None)

N_CHECKS = 54
print(f"\n{('TUTTI I ' + str(N_CHECKS - len(FAILED)) + f'/{N_CHECKS} CHECK OK') if not FAILED else str(len(FAILED)) + ' FALLITI: ' + ', '.join(FAILED)}")
sys.exit(1 if FAILED else 0)
