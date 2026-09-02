#!/usr/bin/env python3
"""Test delle funzioni PURE di update_data.py (niente rete: il fetch NDX dentro
compute_risk_metrics fallisce offline ed è gestito — i beta restano n.d., il resto
dei calcoli deve comunque uscire). Uso: python3 scripts/test_update_data.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
import pandas as pd

from update_data import _finestra_comune, _macro_scores, compute_risk_metrics, ratchet_stops

FAILED = []


ESEGUITI = []


def check(name, cond):
    # ⚠ v254 — IL TOTALE SI CONTA, NON SI DICHIARA. `N_CHECKS` era una costante scritta a mano
    # (75) e il report la stampava a prescindere: due check aggiunti in fondo giravano davvero
    # ma l'annuncio continuava a dire "75/75". Un conteggio che non misura niente e' peggio di
    # nessun conteggio, perche' sembra una verifica. Stessa famiglia del registro fisso di C10
    # e del report messo prima dei check in v205.
    ESEGUITI.append(name)
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

# ---------- v207: finestra comune fra due serie (disaccoppiamento / profitti) ----------
# Il difetto: fred_series senza freq="m" restituiva la frequenza NATIVA, e SP500 su FRED e'
# GIORNALIERA -> 36 "mesi" erano 36 sedute (7 settimane). Le due serie venivano poi rebasate a
# 100 su date di partenza DIVERSE e i valori finali sottratti: il "gap" pubblicato nel payload
# (-3 pp) era la differenza fra una variazione di 7 settimane e una di 3 anni.
sp_corta = [("2026-06-10", 100.0), ("2026-07-01", 101.0), ("2026-07-31", 103.0)]
pil_lungo = [("2023-07-01", 100.0), ("2025-01-01", 104.0), ("2026-04-01", 106.0)]
check("v207 finestra comune: serie che non si sovrappongono -> nessun confronto (era il caso reale)",
      _finestra_comune(sp_corta, pil_lungo) is None)

sp_lunga = [("2023-07-01", 90.0), ("2024-07-01", 100.0), ("2025-07-01", 115.0),
            ("2026-04-01", 130.0), ("2026-07-01", 134.0)]
ris = _finestra_comune(sp_lunga, pil_lungo)
check("v207 finestra comune: due serie a 3 anni si tagliano sull'intervallo condiviso",
      ris is not None and ris[0][0][0] == "2023-07-01" and ris[0][-1][0] == "2026-04-01"
      and ris[1][0][0] == "2023-07-01" and ris[1][-1][0] == "2026-04-01")

check("v207 finestra comune: serie vuota -> None", _finestra_comune([], pil_lungo) is None)
check("v207 finestra comune: meno di due osservazioni dentro la finestra -> None",
      _finestra_comune([("2026-04-01", 1.0), ("2026-05-01", 2.0)],
                       [("2026-04-01", 1.0), ("2026-04-02", 2.0)]) is None)

# ---------- v224: storico dei punteggi macro (le linee che oggi mancano) ----------
_mk = {"fear_greed": {"score": 42}, "credit": {"score": 96}, "macroquant": {"score": 55},
       "indicators": [{"key": "cpi", "impact": 49}, {"key": "nfp", "impact": 39}],
       "signposts": {"pct": 60}, "vix": {"value": 16}}
_sc = _macro_scores(_mk)
check("v224 macro_scores: i compositi con score entrano con la loro chiave nuda",
      _sc.get("fear_greed") == 42 and _sc.get("credit") == 96 and _sc.get("macroquant") == 55)
check("v224 macro_scores: gli indicatori USA entrano come in:<key>, come li cerca la dashboard",
      _sc.get("in:cpi") == 49 and _sc.get("in:nfp") == 39)
check("v224 macro_scores: i signposts sono INVERTITI (60% acceso -> 40 favorevole)",
      _sc.get("signposts") == 40)
check("v224 macro_scores: chi non ha un punteggio non entra (niente chiavi vuote)",
      "vix" not in _sc and all(isinstance(v, int) for v in _sc.values()))

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
from datetime import datetime as _dt, timezone as _tz
check("v125 is_live_market: cripto/futures/indici esteri sì, azioni USA e indici USA no",
      ud.is_live_market("^KS11") and ud.is_live_market("BTC-USD") and ud.is_live_market("NQ=F")
      and not ud.is_live_market("AAPL") and not ud.is_live_market("^IXIC") and not ud.is_live_market("^GSPC"))
# v176: il "live" del KOSPI vale SOLO dentro l'orario di Seoul — l'istante va quindi iniettato,
# altrimenti l'esito del test dipende da quando lo si esegue (di domenica falliva).
_SEOUL_APERTA = _dt(2026, 7, 27, 1, 0, tzinfo=_tz.utc)    # lunedì 10:00 KST
_SEOUL_CHIUSA = _dt(2026, 7, 26, 6, 0, tzinfo=_tz.utc)    # domenica: borsa ferma
check("v125→v176 compute_shock_alert: KOSPI -8,9% live DENTRO la sessione di Seoul → alert, worst -8,9%",
      (lambda s: s and s["active"] and s["worst_chg"] == -8.9 and len(s["sources"]) == 2)(
          ud.compute_shock_alert({"futures": {"nasdaq": {"change_pct": -2.4}, "sp500": {"change_pct": -0.5}}},
                                 [{"ticker": "^KS11", "change_pct": -8.9, "price_live": True}],
                                 now_utc=_SEOUL_APERTA)))
check("v176 allarme fantasma: lo stesso KOSPI 'live' a Seoul CHIUSA non entra fra le fonti",
      (lambda s: s and len(s["sources"]) == 1 and all(x["src"] != "KOSPI (Asia)" for x in s["sources"]))(
          ud.compute_shock_alert({"futures": {"nasdaq": {"change_pct": -2.4}, "sp500": {"change_pct": -0.5}}},
                                 [{"ticker": "^KS11", "change_pct": -8.9, "price_live": True}],
                                 now_utc=_SEOUL_CHIUSA)))
check("v176 _seoul_in_session: lunedì 10:00 KST aperta · domenica e sabato chiuse · lunedì 17:00 KST chiusa",
      ud._seoul_in_session(_SEOUL_APERTA) and not ud._seoul_in_session(_SEOUL_CHIUSA)
      and not ud._seoul_in_session(_dt(2026, 7, 27, 8, 0, tzinfo=_tz.utc))
      and not ud._seoul_in_session(_dt(2026, 7, 25, 3, 0, tzinfo=_tz.utc)))
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

# --- UMich: parsing della fonte PRIMARIA (offline: si testa il PARSER, non la rete) ---
_UMICH_CSV = """Month,YYYY,ICS_ALL
April,2026,49.8
May,2026,44.8
June,2026,49.5
July,2026,
"""
_rows = []
for _r in ud.csv.DictReader(ud.io.StringIO(_UMICH_CSV)):
    _raw = (_r.get("ICS_ALL") or "").strip()
    _m = (_r.get("Month") or "").strip()
    _y = (_r.get("YYYY") or "").strip()
    if not _raw or _m not in ud.UMICH_MONTHS or not _y.isdigit():
        continue
    _rows.append((f"{int(_y):04d}-{ud.UMICH_MONTHS[_m]:02d}-01", float(_raw)))
_rows.sort(key=lambda x: x[0])
check("umich: il CSV primario si parsa in (data ISO, valore) ordinati, righe vuote scartate",
      _rows == [("2026-04-01", 49.8), ("2026-05-01", 44.8), ("2026-06-01", 49.5)])
check("umich: i mesi inglesi mappano al numero giusto (June=6, dicembre=12)",
      ud.UMICH_MONTHS["June"] == 6 and ud.UMICH_MONTHS["December"] == 12)
check("umich: la fonte primaria è più fresca di FRED (il ritardo di licenza è il motivo del fetcher)",
      _rows[-1][0] > "2026-05-01")

# v254 — la soglia minima resta come rete anti-regressione (se qualcuno cancella meta' suite
# il numero crolla e si vede), ma il totale annunciato e' quello VERO, contato a runtime.
N_CHECKS_MINIMO = 112  # +8 con le news per titolo v398 (sale, mai scende)

# ── v186: FedWatch, il ramo del RIALZO non deve essere schiacciato a zero ──────────────
# Il difetto reale: cut_prob = max(0, (mid-implied)/0.25*100). Con implied SOPRA il punto medio
# il valore grezzo e' NEGATIVO — significa rialzo atteso — e il max(0,...) lo azzerava. Il
# 26/07/2026 valeva -38,0, cioe' il 38% di probabilita' di rialzo pubblicato da CME FedWatch
# quel giorno: il sistema aveva la cifra esatta e stampava "prob. taglio 0%" a tre giorni dal FOMC.
def _fedwatch_rami(target_low, target_high, implied):
    mid = (target_low + target_high) / 2
    quarti = (mid - implied) / 0.25 * 100
    return (round(max(0, min(100, quarti))), round(max(0, min(100, -quarti))))

# caso reale del 26/07/2026: futures a 3.72 con range 3.50-3.75
cut, hike = _fedwatch_rami(3.50, 3.75, 3.72)
check("fedwatch: futures SOPRA il punto medio → probabilita' di RIALZO, non taglio a zero",
      cut == 0 and hike == 38)
# caso simmetrico: futures sotto il punto medio → taglio
cut, hike = _fedwatch_rami(3.50, 3.75, 3.53)
check("fedwatch: futures SOTTO il punto medio → probabilita' di TAGLIO", hike == 0 and cut == 38)
# nessuna aspettativa: entrambi i rami a zero
cut, hike = _fedwatch_rami(3.50, 3.75, 3.625)
check("fedwatch: futures AL punto medio → nessun ramo attivo", cut == 0 and hike == 0)
# i due rami non possono essere entrambi positivi: si escludono per costruzione
check("fedwatch: rami mutuamente esclusivi su tutto il range",
      all(not (_fedwatch_rami(3.50, 3.75, x / 100)[0] and _fedwatch_rami(3.50, 3.75, x / 100)[1])
          for x in range(300, 400)))

# ══ v248 — IL RAMO NDX CONFRONTAVA DATE DIVERSE ═══════════════════════════════════════════
# Emerso controllando le date delle serie: corp_profit.ndx arrivava al 2026-08 mentre i profitti
# si fermavano al 2026-01. Il gap NDX nasceva fra l'ultimo punto Nasdaq (ribasato sul PROPRIO
# primo punto, 5 anni fa) e i profitti ribasati sulla finestra comune con l'S&P: BASI DIVERSE e
# DATE FINALI DIVERSE. MISURATO sui dati veri l'08/08/2026: pubblicato 69,9 pp, corretto 40,0 pp,
# 29,9 pp di scarto — e worst_gap = max(gap, ndx_gap) prendeva proprio l'NDX, quindi il numero
# sbagliato era il TITOLO, con la soglia "Asset Inflation" fissata a 40.
# ⚠ Il commento nel codice dichiarava quel ramo "corretto" dal v207: lo era sulla FREQUENZA, non
#    sulla FINESTRA. Una dichiarazione di correttezza non è una verifica.
_prof248 = ([(f"{a}-{m}-01", 100.0 + i * 1.7) for i, (a, m) in enumerate(
    [(y, mm) for y in range(2021, 2027) for mm in ("01", "04", "07", "10")])
    if f"{a}-{m}-01" >= "2021-04-01" and f"{a}-{m}-01" <= "2026-01-01"])
_ndx248 = ([(f"{y}-{mm:02d}-01", 100.0 + i * 2.6) for i, (y, mm) in enumerate(
    [(y, mm) for y in range(2021, 2027) for mm in range(1, 13)])
    if f"{y}-{mm:02d}-01" >= "2021-09-01" and f"{y}-{mm:02d}-01" <= "2026-08-01"])
_al248 = _finestra_comune(_ndx248, _prof248)

check("v248 NDX: esiste una finestra comune fra Nasdaq e profitti", _al248 is not None)
check("v248 NDX: le due serie finiscono alla STESSA data",
      bool(_al248) and _al248[0][-1][0] == _al248[1][-1][0])
check("v248 NDX: il punto senza controparte (2026-08) resta FUORI dal confronto",
      bool(_al248) and _al248[0][-1][0] != "2026-08-01")
check("v248 NDX: allineare RIDUCE il gap gonfiato dai mesi scoperti", bool(_al248) and
      round(_al248[0][-1][1] / _al248[0][0][1] * 100 - _al248[1][-1][1] / _al248[1][0][1] * 100, 1)
      < round(220.0 - 132.4, 1))

# ═══ v349 — LA FINESTRA ERA ALLINEATA, LA PARTENZA NO ═══════════════════════════════════
# I check v248 qui sopra verificano che le due serie FINISCANO insieme, e passavano: la loro
# stessa fixture ha le partenze disallineate (2021-09 contro 2021-04) e nessuno se n'era
# accorto. Sui dati veri del 23/08/2026 il ramo NDX ribasava il Nasdaq sul 2021-09-01 e i
# profitti sul 2021-10-01 — un mese di borsa in piu' senza controparte — e pubblicava
# ndx_gap 40,1 pp invece di 27,3. Sopra la soglia dichiarata di 40, quindi worst_gap prendeva
# l'NDX e l'etichetta diventava "Asset Inflation (driver: NDX)" al posto di "Tensione
# moderata". Il difetto stava nella riga che il commento v248 dichiarava sanata.
check("v349 finestra: le due serie PARTONO dalla stessa data, non solo dallo stesso intervallo",
      bool(_al248) and _al248[0][0][0] == _al248[1][0][0])
_mens = [("2021-09-01", 100.0), ("2021-10-01", 107.9), ("2022-01-01", 110.0), ("2026-01-01", 173.9)]
_trim = [("2021-10-01", 98.9), ("2022-01-01", 100.0), ("2026-01-01", 132.4)]
_alMix = _finestra_comune(_mens, _trim)
check("v349 finestra: due frequenze diverse partono comunque insieme",
      bool(_alMix) and _alMix[0][0][0] == _alMix[1][0][0] == "2021-10-01")
check("v349 finestra: il punto scoperto in testa resta FUORI dal ribasamento",
      bool(_alMix) and all(d != "2021-09-01" for d, _ in _alMix[0]))


# ═══ v358 — LO Z'' USAVA LA CAPITALIZZAZIONE DOVE VUOLE IL PATRIMONIO NETTO ═══════════════
# Il modello Z'' per non-manifatturieri e' 6,56·X1 + 3,26·X2 + 6,72·X3 + 1,05·X4, dove X4 e'
# PATRIMONIO NETTO CONTABILE / passivita' totali. Il codice usava `market_cap` al numeratore —
# che appartiene allo Z-score ORIGINALE, dove pero' il coefficiente e' 0,6 e non 1,05.
# Misurato sui dati veri: PLTR 326,52 · NVDA 120,18 · AMD 60,40, contro uno Z'' che vive fra
# circa -10 e +15 e ha i cutoff a 1,1 e 2,6. Su una societa' molto capitalizzata e poco
# indebitata il quarto termine schiacciava gli altri tre, e il punteggio misurava quanto il
# mercato ama il titolo invece della solidita' del bilancio.
# ⚠ E il campo NON era inerte: la pagina lo stampa col flag [RISCHIO DEFAULT] sotto 1,81.
_SRC_Z = (Path(__file__).resolve().parent / "update_data.py").read_text(encoding="utf-8")

def _z2(wc_ta, re_ta, ebit_ta, book_tl):
    return round(6.56 * wc_ta + 3.26 * re_ta + 6.72 * ebit_ta + 1.05 * book_tl, 2)

# societa' solida e poco indebitata: con la formula giusta resta dentro la banda
check("v358 Altman: il quarto termine usa il PATRIMONIO NETTO, non la capitalizzazione",
      _z2(0.30, 0.25, 0.12, 2.0) < 15)
# lo stesso caso col numeratore sbagliato (capitalizzazione 40x le passivita') esplode
check("v358 Altman: col numeratore sbagliato il punteggio esce dalla scala dei suoi cutoff",
      _z2(0.30, 0.25, 0.12, 40.0) > 20)
check("v358 Altman: il codice legge book = attivo - passivo",
      "book = ta_ - tl_" in _SRC_Z and "(1.05, book / tl_)" in _SRC_Z)
check("v358 Altman: fuori dalla banda plausibile non si pubblica e si dichiara",
      "altman_fuori_scala" in _SRC_Z and "-15 <= z_ <= 20" in _SRC_Z)

# ═══ v254 — UNA POSIZIONE SENZA `name` NON DEVE FERMARE L'ACQUISIZIONE ═══════════════════
# `pos["name"]` sollevava KeyError e uccideva l'INTERO run prima di scaricare un solo prezzo:
# quattro posizioni scritte dal diario senza quel campo hanno tenuto data.json fermo a 9
# posizioni per un giorno, mentre il portafoglio vero ne aveva 13. Il nome e' un'etichetta da
# mostrare; che la sua assenza abbatta la pipeline dei prezzi e' una fragilita' a se' stante.
# ⚠ Il check va PRIMA del blocco report, o e' contato e non puo' far fallire la CI (v205).
import json as _json
_RADICE = Path(__file__).resolve().parent.parent
_riga_ptf = None
for _l in (_RADICE / "scripts" / "update_data.py").read_text(encoding="utf-8").splitlines():
    if "row = fetch_symbol(pos[" in _l:
        _riga_ptf = _l.strip()
check("v254 il ramo portafoglio non fa pos['name'] secco (un nome mancante ucciderebbe il run)",
      _riga_ptf is not None and 'pos["name"]' not in _riga_ptf and '.get("name")' in _riga_ptf)

# ⚠ v274 — config/holdings.json E' STATO CANCELLATO (punto 4 della revisione: finche' esisteva
# qualcuno poteva ricollegarlo per sbaglio e riportarsi dentro 37 simboli e un portafoglio
# chiuso in v256). Il check v254 nasceva da un guasto vero — una posizione senza `name` mandava
# la pipeline in KeyError e la fermava per un giorno — quindi NON si cancella: si sposta sulla
# lista che comanda adesso. La proprieta' e' la stessa: nessuna voce malformata deve poter
# entrare nella pipeline.
_ui = _json.loads((_RADICE / "config" / "ui_watchlist.json").read_text(encoding="utf-8"))
check("v274 ui_watchlist.json e' una lista di stringhe non vuote",
      isinstance(_ui, list) and len(_ui) > 0
      and all(isinstance(t, str) and t.strip() for t in _ui))
check("v274 nessun simbolo duplicato nella watchlist",
      len({t.strip().upper() for t in _ui}) == len(_ui))
check("v274 config/holdings.json non esiste piu'",
      not (_RADICE / "config" / "holdings.json").exists())

# ═══ v269 — LO SFOLTIMENTO NON DEVE TORNARE INDIETRO ═══════════════════════════════════════
# Il CEO: "alleggerire la pipeline". Tolti quattro blocchi che nessuno leggeva piu' dopo v256
# (top_etfs, news, screener, top_caps) e con loro le ~57 richieste RSS per run di build_feeds.
# Questi check esistono perche' un blocco morto si riaggiunge senza accorgersene: basta una
# riga nel dizionario finale, e nessuno se ne accorge finche' il file non e' di nuovo grosso.
_src = (Path(__file__).resolve().parent / "update_data.py").read_text(encoding="utf-8")

for _morto in ("fetch_news", "fetch_top_etfs", "fetch_top_caps", "fetch_screener",
               "build_feeds", "parse_feed_entries"):
    check(f"v269 pipeline: {_morto} non e' tornata", f"def {_morto}(" not in _src)

check("v269 pipeline: il dizionario finale non riscrive i blocchi morti",
      not any(f'"{k}":' in _src for k in ("top_etfs", "news", "screener", "top_caps")))

# ⚠ predictions RESTA: e' Polymarket, e le sue righe finiscono nel pacchetto macro. Un taglio
# che si porta via anche i vivi e' peggio di nessun taglio.
check("v269 pipeline: predictions (Polymarket) e' rimasta, la usa il pacchetto macro",
      '"predictions": fetch_predictions()' in _src)

# ═══ v272 — UNA SOLA LISTA DI SIMBOLI ═══════════════════════════════════════════════════
# Il CEO: "ci sono punti morti del precedente sistema che rallentano il workflow?". Si': la
# pipeline scaricava 37 simboli e 21 non erano nella watchlist che lui guarda.
check("v272 pipeline: la lista dei simboli viene da config/ui_watchlist.json",
      "UI_WATCHLIST" in _src and "ui_watchlist.json" in _src)

check("v272 pipeline: il portafoglio non si calcola piu' (era uscito dal prodotto in v256)",
      "return [], wl, None" in _src)

# ⚠ il BTP ha la sua funzione: chiederlo a Yahoo e' una chiamata sprecata che finisce in errore.
check("v272 pipeline: il BTP non entra nella lista da scaricare da Yahoo",
      'if t == "BTP-V28":' in _src)

# ⚠ rame, petrolio, oro e SOX fuori dai mercati macro: ora stanno in watchlist, e tenerli in
# tutti e due i posti significava scaricarli DUE VOLTE e mostrarli due volte.
# ═══ v279 — LA PIPELINE DEVE REGGERE UN PORTAFOGLIO VUOTO ═══════════════════════════════
# Trovata ESEGUENDOLA, non leggendola: da v272 non ci sono piu' posizioni, quindi `usd_cost` e
# `cost_eur` valgono ZERO e tre righe morivano con ZeroDivisionError. Sarebbe morto il primo
# cron dopo la push — la stessa famiglia del KeyError che fermo' la pipeline per un giorno.
# ⚠ NESSUN GATE L'AVEVA PRESA, e non poteva: nessuno esegue la pipeline (servono le chiamate di
# rete). Questi check guardano il CODICE, che e' il massimo che si possa fare senza rete.
check("v279 pipeline: nessuna divisione per il costo senza proteggersi dal costo nullo",
      all(f"if {d}" in _src for d in ("usd_cost", "cost_eur"))
      and "/ usd_cost - 1) * 100, 2) if usd_cost" in _src
      and _src.count("/ cost_eur - 1) * 100, 2) if cost_eur") == 2)

# ⚠ un rendimento percentuale su un costo nullo non e' ZERO: NON ESISTE. Scriverlo 0,00%
# direbbe "non hai guadagnato niente" invece di "non c'e' niente da misurare".
check("v279 pipeline: senza costo il rendimento e' None, non zero",
      "if usd_cost else None" in _src and "if cost_eur else None" in _src)

# ⚠ v280 — L'INVARIANTE E' IL DOPPIONE, NON IL NOME. Il check cercava i simboli nel sorgente
# e vietava che comparissero: cosi' scritto ha punito la richiesta successiva del CEO
# ("rame/petrolio/oro/SOX inserisci grafico storico nella tab macro"), che li rimette — ma in
# un blocco DIVERSO e con la loro serie, che e' informazione nuova, non una ripetizione.
# Quello che non deve tornare e' che lo stesso simbolo stia in DUE posti: era quello il
# doppione che il CEO mi ha fatto notare per il VIX. Ora si controlla proprio quello.
_righe_markets = _src[_src.index("markets = []"):_src.index('macro["markets"] = markets')]
check("v280 pipeline: rame, petrolio, oro e SOX non sono nei MERCATI (stanno in materie)",
      not any(s in _righe_markets for s in ('"HG=F"', '"GC=F"', '"CL=F"', '"^SOX"')))
check("v280 pipeline: le materie prime hanno il loro blocco con lo storico",
      'macro["materie"] = materie' in _src and '"history": storia' in _src)
# ⚠ e nessuno dei quattro deve finire in TUTTI E DUE i blocchi: e' il doppione vero.
check("v280 pipeline: nessun simbolo sta sia nei mercati sia nelle materie",
      not set(s for s in ('"HG=F"', '"GC=F"', '"CL=F"', '"^SOX"') if s in _righe_markets))

# ═══ v316 — LA COLONNA DI TRADINGVIEW, CALCOLATA DA NOI ═══════════════════════════════════
# Si provano su serie SINTETICHE con esito noto: una funzione che calcola un RSI si verifica
# dandole una salita monotona (RSI deve saturare verso 100), non guardando se "sembra giusto".
import pandas as _pd
import numpy as _np

_idx = _pd.date_range("2024-01-01", periods=260, freq="B")
_su = _pd.DataFrame({"Open": _np.linspace(100, 200, 260), "High": _np.linspace(101, 202, 260),
                     "Low": _np.linspace(99, 198, 260), "Close": _np.linspace(100, 200, 260),
                     "Volume": [1e6] * 260}, index=_idx)
_bt = ud.batteria_tecnica(_su)
check("v316 tecnica: su una salita monotona l'RSI satura in alto e il prezzo batte ogni media",
      _bt["oscillatori"]["rsi14"] > 95 and _bt["medie_battute"] == _bt["medie_totali"])
check("v316 tecnica: la distanza dalla media e' il PREZZO rispetto al LIVELLO, non il contrario",
      abs(_bt["medie"]["sma200"]["dist_pct"]
          - (_bt["prezzo"] / _bt["medie"]["sma200"]["liv"] - 1) * 100) < 0.05)
check("v316 tecnica: l'ADX misura la forza, e su un trend pulito e' alto",
      _bt["oscillatori"].get("adx14", 0) > 40)
check("v316 tecnica: sotto 30 barre non si pubblica niente invece di pubblicare rumore",
      ud.batteria_tecnica(_su.head(20)) is None)

# ⚠ IL BETA SENZA R² E' MEZZO NUMERO: due serie identiche danno beta 1 e R² 1; due indipendenti
#   danno un R² vicino a zero, ed e' quello che deve arrivare al pacchetto.
_r = _pd.Series(_np.random.RandomState(7).normal(0, 1, 260), index=_idx)
_uguale = (1 + _r / 100).cumprod() * 100
_altro = (1 + _pd.Series(_np.random.RandomState(99).normal(0, 1, 260), index=_idx) / 100).cumprod() * 100
_sens = ud.sensibilita_macro(_uguale, {"stessa": ("X", "canale", _uguale), "altra": ("Y", "canale", _altro)})
check("v316 sensibilita': serie identica -> beta ~1 e R² ~1",
      abs(_sens["stessa"]["beta"] - 1) < 0.05 and _sens["stessa"]["r2"] > 0.99)
check("v316 sensibilita': serie indipendente -> R² prossimo a zero, non un beta spacciato per segnale",
      _sens["altra"]["r2"] < 0.05)
check("v316 sensibilita': la finestra e' comune e dichiarata (date, non posizioni)",
      _sens["stessa"]["campione"] >= 60 and _sens["stessa"]["da"] < _sens["stessa"]["a"])
# ⚠ e su una sovrapposizione corta NON si pubblica: e' la lezione v207 (due serie senza giorni in comune)
check("v316 sensibilita': sotto 60 sedute comuni non si pubblica un beta",
      ud.sensibilita_macro(_uguale.head(40), {"x": ("X", "c", _uguale)}) is None)

_mens = _pd.Series(_np.tile([1.0, -1.0, 2.0, -2.0, 1.5, -1.5, 3.0, -3.0, 0.5, -0.5, 2.5, -2.5], 12).cumsum() + 100,
                   index=_pd.date_range("2014-01-31", periods=144, freq="ME"))
_st = ud.stagionalita_titolo(_mens)
check("v316 stagionalita': un mese per riga, col proprio campione e i propri estremi",
      _st and len(_st) == 12 and all(x["campione"] >= 8 and x["peggio"] <= x["meglio"] for x in _st))
check("v316 stagionalita': sotto otto anni di storia non si pubblica una media fra esiti opposti",
      ud.stagionalita_titolo(_mens.head(48)) is None)

# ══ v323 — IL CONTRATTO FRA LE DUE LINGUE ═══════════════════════════════════════════════════
# Il punteggio del credito si calcola qui e in assets/app.js. Le due implementazioni sono gia'
# divergute una volta (HY 2,71% -> 69 contro 88) nell'atto stesso di correggere il difetto che
# nasceva da due formule indipendenti. La tabella e' la STESSA che sta in scripts/test_app.mjs:
# se una delle due lingue deriva, una delle due suite si rompe.
_BANDE_HY = ud.BANDE_HY_OAS
_CONTRATTO_CREDITO = ((0.5, 93), (2.71, 80), (3.9, 73), (4.5, 40), (6.5, 29), (8, 26), (10, 23))
check("v323 credito: il punteggio rispetta il contratto condiviso con la dashboard",
      all(round(ud._punteggio_da_bande(v, _BANDE_HY)) == atteso for v, atteso in _CONTRATTO_CREDITO))
# ⚠ e il numero non puo' contraddire la didascalia: a 6,5% la legenda stampata accanto dice
#   "stress", e il punteggio prima valeva 56, cioe' "favorevole" nella scala dei punteggi.
check("v323 credito: a spread da 'stress' il punteggio sta nel rosso",
      round(ud._punteggio_da_bande(6.5, _BANDE_HY)) < 35 and round(ud._punteggio_da_bande(2.71, _BANDE_HY)) > 70)
check("v326 credito: la scala e' monotona su tutto il dominio, non solo sui punti del contratto",
      all(round(ud._punteggio_da_bande(v, _BANDE_HY)) <= round(ud._punteggio_da_bande(v - 0.1, _BANDE_HY))
          for v in [x / 10 for x in range(3, 150)]))

check("v323 credito: l'ancora inventata 2,5-11,5% non e' piu' nel codice",
      "(hy_val - 2.5) / 9" not in _src and "(hy_now - 2.5) / 9" not in _src)

# ══ v325 — UN BETA DEVE ESSERE COMPATIBILE CON LA PROPRIA CORRELAZIONE ═══════════════════════
# Il beta usciva diviso per CENTO: la pipeline passava log-rendimenti in frazione a una funzione
# che convertiva il benchmark in percentuale. Su MU contro il proprio settore: beta 0,01 con
# correlazione 0,82, che e' impossibile.
# ⚠⚠ E il test di v316 non lo prese perche' PASSAVA LE PERCENTUALI A MANO: provava una strada che
# la produzione non percorre. Ora la funzione prende le CHIUSURE e decide lei l'unita', e questo
# check verifica l'INVARIANTE STATISTICO, che nessuna scelta di unita' puo' soddisfare per caso:
# beta = corr x (sigma_titolo / sigma_benchmark), quindi con una correlazione alta il beta non
# puo' essere microscopico — servirebbe un rapporto fra volatilita' di 1 a 100.
import numpy as _np
import pandas as _pd
_idx2 = _pd.date_range("2024-01-01", periods=300, freq="B")
_rng = _np.random.RandomState(11)
_b = _pd.Series((1 + _rng.normal(0, 0.01, 300)).cumprod() * 100, index=_idx2)
_t = _pd.Series((1 + (_b.pct_change().fillna(0) * 1.5 + _rng.normal(0, 0.002, 300))).cumprod() * 50, index=_idx2)
_sens = ud.sensibilita_macro(_t, {"bench": ("B", "canale", _b)})
check("v325 sensibilita': su un titolo costruito con beta 1,5 la funzione lo ritrova",
      _sens and abs(_sens["bench"]["beta"] - 1.5) < 0.15 and _sens["bench"]["r2"] > 0.9)
# ⚠ l'invariante che non si puo' soddisfare per caso: con correlazione alta, beta non microscopico
check("v325 sensibilita': un beta microscopico con correlazione alta e' impossibile",
      all(abs(v["beta"]) > 0.1 for v in (_sens or {}).values() if abs(v["corr"]) > 0.5))
# ⚠ e la scala non deve dipendere dall'unita' in cui arrivano le chiusure: prezzi in centesimi
#   devono dare lo STESSO beta, perche' il beta e' un rapporto fra rendimenti
_sens100 = ud.sensibilita_macro(_t * 100, {"bench": ("B", "canale", _b)})
check("v325 sensibilita': il beta non cambia se le chiusure arrivano in un'altra scala",
      _sens100 and abs(_sens100["bench"]["beta"] - _sens["bench"]["beta"]) < 0.01)

# ⚠⚠ v373 — NESSUNA CHIAMATA A UNA FUNZIONE CHE NON ESISTE.
# La pipeline e' morta per giorni per questo: i quattro `except` scritti in v365 e v367
# chiamavano log(), che in questo file NON ESISTE. Sul percorso normale non si vede — i gestori
# non girano mai — ma appena FINRA o yfinance sollevano qualcosa (da un runner GitHub succede:
# limiti di frequenza, IP di datacenter bloccati) il GESTORE solleva NameError, che nessuno
# cattura, e il run muore.
# E' il difetto piu' insidioso della famiglia: il codice scritto per impedire i crash li causa.
# ast.parse passa, i test passano, il percorso felice passa. Solo il percorso infelice muore —
# ed e' quello che esiste apposta per non morire.
import builtins as _bi
import ast as _ast

_UD_SRC = (Path(__file__).resolve().parent / "update_data.py").read_text(encoding="utf-8")
_NOTI = set(dir(_bi))
for _n in _ast.walk(_ast.parse(_UD_SRC)):
    if isinstance(_n, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
        _NOTI.add(_n.name)
    elif isinstance(_n, _ast.Import):
        _NOTI.update((a.asname or a.name).split(".")[0] for a in _n.names)
    elif isinstance(_n, _ast.ImportFrom):
        _NOTI.update((a.asname or a.name) for a in _n.names)
    elif isinstance(_n, _ast.Assign):
        for _t in _n.targets:
            _NOTI.update(x.id for x in _ast.walk(_t) if isinstance(x, _ast.Name))
    elif isinstance(_n, (_ast.For, _ast.comprehension)):
        _tg = _n.target
        _NOTI.update(x.id for x in _ast.walk(_tg) if isinstance(x, _ast.Name))
    elif isinstance(_n, _ast.arguments):
        _NOTI.update(a.arg for a in list(_n.args) + list(_n.kwonlyargs) + list(_n.posonlyargs))
        for _a in (_n.vararg, _n.kwarg):
            if _a: _NOTI.add(_a.arg)
    elif isinstance(_n, _ast.ExceptHandler) and _n.name:
        _NOTI.add(_n.name)
    elif isinstance(_n, _ast.withitem) and _n.optional_vars is not None:
        _NOTI.update(x.id for x in _ast.walk(_n.optional_vars) if isinstance(x, _ast.Name))

# ⚠ solo le chiamate a un NOME NUDO (f(...)), mai quelle a un attributo (x.f(...)): il nome
#   nudo deve esistere in questo file, l'attributo appartiene a un oggetto e non e' verificabile.
_FANTASMI = sorted({c.func.id for c in _ast.walk(_ast.parse(_UD_SRC))
                    if isinstance(c, _ast.Call) and isinstance(c.func, _ast.Name)
                    and c.func.id not in _NOTI})
check("v373 nessuna chiamata a una funzione inesistente (il gestore d'errore che esplode)",
      not _FANTASMI)
if _FANTASMI:
    print(f"      ↳ chiamate a nomi che non esistono: {', '.join(_FANTASMI)} — "
          f"se stanno dentro un except, il run muore proprio quando doveva essere salvato")
# e il controllo deve aver visto qualcosa, altrimenti passa a vuoto
check("v373 l'analisi delle chiamate sta davvero leggendo la pipeline", len(_NOTI) > 200)

# ⚠⚠ v369 — NESSUNA VARIABILE DEL RECORD PUO' ESSERE ASSEGNATA SOLO DENTRO UN RAMO.
# La pipeline e' rimasta rotta da v365 a v369 per questo: _comb, _cred, _fuori e _short erano
# assegnati dentro `if has_fundamentals(ticker, currency):` e usati nel record COSTRUITO ANCHE
# per i simboli senza fondamentali — indici (^GSPC), futures (CL=F), ETF. NameError, run morto.
# ⚠ ast.parse e node --check passano: la sintassi e' valida, lo scope no. Terza volta che questa
# classe morde (la prima fu `prezzo` in datiNostriDelTitolo). Un controllo a occhio non regge
# tre volte: qui e' meccanico, sull'albero sintattico.
#
# ⚠⚠ E LA PRIMA STESURA DI QUESTO GATE ERA RUMOROSA: segnalava anche ath, c0, c1, h, price_asof
# e v. Verificati a mano, erano SEI FALSI POSITIVI su sei — c0/c1/h/v vivono solo dentro scope
# annidati (il rilevatore confondeva DUE return-dict diversi dentro la stessa funzione), e
# ath/price_asof sono assegnati sia nel try sia nell'except, quindi esistono sempre.
# Un gate che grida su codice giusto si impara a ignorare: e' la lezione di C9, gia' pagata.
# Ora l'analisi e' quella vera: il record e' il return-dict piu' esterno, si contano solo i Name
# letti DIRETTAMENTE (non dentro lambda/comprehension/def), e "assegnata sempre" segue i rami —
# if/else conta solo se entrambi assegnano, try/except solo se assegnano corpo E tutti i gestori.
import ast as _ast

_UD_SRC = (Path(__file__).resolve().parent / "update_data.py").read_text(encoding="utf-8")
_FN = next(n for n in _ast.walk(_ast.parse(_UD_SRC))
           if isinstance(n, _ast.FunctionDef) and n.name == "fetch_symbol")
_SCOPE_ANNIDATI = (_ast.Lambda, _ast.ListComp, _ast.SetComp, _ast.DictComp,
                   _ast.GeneratorExp, _ast.FunctionDef, _ast.AsyncFunctionDef)


def _sicure(corpo):
    """Variabili assegnate SU OGNI CAMMINO che attraversa questa lista di istruzioni."""
    out = set()
    for st in corpo:
        if isinstance(st, (_ast.Assign, _ast.AnnAssign, _ast.AugAssign)):
            tgt = st.targets if isinstance(st, _ast.Assign) else [st.target]
            for t_ in tgt:
                out |= {n.id for n in _ast.walk(t_) if isinstance(n, _ast.Name)}
        elif isinstance(st, _ast.If):
            # conta solo se ENTRAMBI i rami assegnano: un if senza else non garantisce niente
            if st.orelse:
                out |= _sicure(st.body) & _sicure(st.orelse)
        elif isinstance(st, _ast.Try):
            # il try puo' fallire a meta': garantito solo cio' che assegnano corpo E ogni gestore
            if st.handlers:
                g = _sicure(st.body)
                for h in st.handlers:
                    g &= _sicure(h.body)
                out |= g
            out |= _sicure(st.finalbody)
        # for/while non garantiscono: possono iterare zero volte
    return out


def _letti_dal_record(fn):
    """I Name letti DIRETTAMENTE nel return-dict piu' grande (il record), scope annidati esclusi."""
    dicts = [st.value for st in _ast.walk(fn)
             if isinstance(st, _ast.Return) and isinstance(st.value, _ast.Dict)]
    if not dicts:
        return set()
    record = max(dicts, key=lambda d: len(d.keys))
    letti = set()

    def visita(n, annidato):
        for c in _ast.iter_child_nodes(n):
            if isinstance(c, _SCOPE_ANNIDATI):
                visita(c, True)
            else:
                if not annidato and isinstance(c, _ast.Name) and isinstance(c.ctx, _ast.Load):
                    letti.add(c.id)
                visita(c, annidato)

    visita(record, False)
    return letti


_ASSEGNATE_OVUNQUE = {n.id for x in _ast.walk(_FN) if isinstance(x, (_ast.Assign, _ast.For))
                      for t_ in (x.targets if isinstance(x, _ast.Assign) else [x.target])
                      for n in _ast.walk(t_) if isinstance(n, _ast.Name)}
_ARG = {a.arg for a in _FN.args.args} | {a.arg for a in _FN.args.kwonlyargs}
_RECORD = _letti_dal_record(_FN)
_A_RISCHIO = sorted((_RECORD & _ASSEGNATE_OVUNQUE) - _sicure(_FN.body) - _ARG)
check("v369 nessuna variabile del record assegnata solo dentro un ramo (NameError su indici/futures/ETF)",
      not _A_RISCHIO)
if _A_RISCHIO:
    print(f"      ↳ a rischio NameError nel record: {', '.join(_A_RISCHIO)}")
# ⚠ e il controllo deve VEDERE qualcosa: un'analisi che non legge il record passa sempre
check("v369 l'analisi dello scope sta davvero leggendo il record di fetch_symbol",
      len(_RECORD) >= 15 and "stats" in _RECORD)

# ⚠⚠ v367 — IL P/S DEVE ESSERE CALCOLATO DOPO LA RIPULITURA CROSS-CURRENCY.
# Introdotto in v365 e gia' pubblicato con il difetto: lo calcolavo PRIMA, e su SK hynix
# (bilanci in KRW, ADR quotato in USD) usciva capitalizzazione in dollari diviso ricavi in won.
# E' la stessa classe che scrub_cross_currency_stats ferma sulle stats dal 2024, rientrata da
# una porta nuova — e' per questo che il controllo e' sull'ORDINE e non su una lista di campi:
# una lista da tenere allineata a mano si disallinea, l'ordine no.
_SRC_UD = (Path(__file__).resolve().parent / "update_data.py").read_text(encoding="utf-8")

# QUARTA VOLTA CHE UN GATE TROVA SE STESSO (v213, v240, v389, e ora qui). Il check
# "nessun accesso posizionale nello storico" e' fallito su codice CORRETTO, perche' il
# commento che spiega il difetto rimosso contiene per forza la costruzione rimossa.
# Regola: chi cerca l'ASSENZA di una costruzione deve guardare il CODICE, non la prosa
# che lo circonda. Chi ne cerca la PRESENZA puo' continuare a usare _SRC_UD.
_SRC_UD_CODICE = "\n".join(r.split("#")[0] for r in _SRC_UD.splitlines())
_i_scrub = _SRC_UD.find("stats = scrub_cross_currency_stats(")
_i_ps = _SRC_UD.find('stats["ps"] =')
check("v367 P/S ed EV/S calcolati DOPO la ripulitura cross-currency (SK hynix: KRW vs USD)",
      _i_scrub > 0 and _i_ps > 0 and _i_ps > _i_scrub)
# e la valuta dei bilanci deve finire nei blocchi nuovi, altrimenti la pagina confronta won e dollari
check("v367 credito e combustione portano la valuta del BILANCIO, non quella del prezzo",
      '_cred["valuta"] = g("financialCurrency")' in _SRC_UD
      and '_comb["valuta"] = g("financialCurrency")' in _SRC_UD)
# ⚠ uno zero mentre l'altra meta' e' piena non e' una misura: e' una riga che FINRA non ha pubblicato
check("v367 le settimane FINRA pubblicate a meta' sono marcate incomplete, non usate",
      '(ats > 0) != (otc > 0)' in _SRC_UD and '"incompleta"' in _SRC_UD)

# ── v387: la pipeline CONTA le proteste di Yahoo, non le butta ─────────────────────────
# ⚠⚠ Prima nel sorgente c'era `logging.getLogger("yfinance").setLevel(logging.CRITICAL)`, che
#   le SCARTAVA. Conseguenza vera e non teorica: quando Yahoo blocca il CI la pipeline non
#   lasciava nessuna traccia del perche' — un run degradato che si presenta come riuscito,
#   la stessa classe della seduta persa (v383/v384).
import io as _io, contextlib as _cl, logging as _lo
_srcU = (Path(__file__).resolve().parent / "update_data.py").read_text(encoding="utf-8")
check("il silenziamento a CRITICAL non c'e' piu': le proteste si raccolgono",
      "setLevel(logging.CRITICAL)" not in _srcU and "_RUMORE_YF" in _srcU)
check("la raccolta viene dalla fonte unica, non reimplementata nella pipeline",
      "from rumore_yf import" in _srcU and "class RaccoltaYF" not in _srcU)
# ⚠ COMPORTAMENTALE: si emette sul logger vero e si guarda dove finisce, invece di rileggere
#   il sorgente. La sintassi valida non dice niente sull'esecuzione (v238).
_lg_yf = _lo.getLogger("yfinance")
_err_yf = _io.StringIO()
_n_prima = len(ud._RUMORE_YF.righe)
with _cl.redirect_stderr(_err_yf):
    _lg_yf.error("$MU: possibly delisted; no price data found")
    _lg_yf.error("curl: (7) CONNECT tunnel failed, response 403")
check("un messaggio di yfinance finisce nella raccolta della pipeline, non su stderr",
      len(ud._RUMORE_YF.righe) == _n_prima + 2 and _err_yf.getvalue() == "")
_riass = ud._RUMORE_YF.riassunto()
check("e la pipeline sa dire la CAUSA: il blocco di rete, e il delisting come conseguenza",
      any("403" in x for x in _riass) and any("conseguenza del blocco" in x for x in _riass))
# ⚠ il riassunto va stampato ANCHE quando il run riesce: un run che scrive data.json dopo 200
#   rifiuti di Yahoo e' riuscito a meta', e prima non c'era modo di saperlo.
_coda = _srcU[_srcU.rindex("OUT.write_text"):]
check("il riassunto si stampa in fondo al run, non solo in caso di fallimento",
      "_RUMORE_YF.righe" in _coda and "_RUMORE_YF.riassunto()" in _coda)

# ══ v390 — LE TRE FONTI NUOVE, E IL GATE CHE LE SORVEGLIA ═══════════════════════════════
# ⚠ La lezione delle news di v389 e' costata la vita intera della funzionalita': una fonte che
# nessun check guarda puo' morire il giorno in cui nasce. Questi check nascono insieme al codice.

# l'import mancante che ha tenuto morte le news: non deve poter tornare
check("v390 ogni modulo usato da update_data.py e' importato",
      all(f"\nimport {m}\n" in _SRC_UD or f"\nfrom {m} " in _SRC_UD
          for m in ("html", "csv", "json", "re", "sys", "time")))

check("v390 SEC EDGAR: si cercano gli 8-K con item 2.02, non un form qualsiasi",
      '"2.02" in (it or "")' in _SRC_UD and 'f == "8-K"' in _SRC_UD)

# ⚠ misurato su MSTR: deposita 8-K/2.02 fuori dal ciclo e la mediana crolla a 67 giorni,
# producendo un'attesa sbagliata di 24. Fuori banda non si pubblica nulla.
check("v390 SEC EDGAR: la cadenza si pubblica solo se e' plausibilmente trimestrale",
      "if 80 <= _cad <= 100:" in _SRC_UD
      and '"cadenza_irregolare_gg"' in _SRC_UD)

check("v390 SEC EDGAR: gli emittenti esteri finiscono in un elenco dichiarato, non nel nulla",
      '"senza_8k": esteri' in _SRC_UD and "esteri.append(_tk)" in _SRC_UD)

# SEC chiede uno User-Agent identificabile e meno di 10 richieste al secondo
check("v390 SEC EDGAR: User-Agent identificabile e passo rispettato",
      "SEC_UA" in _SRC_UD and "time.sleep(0.12)" in _SRC_UD)

# ⚠ la prima stesura tagliava su "SEC EDGAR", che compare gia' nel commento di testa: la
# finestra finiva prima del codice e il check falliva su codice corretto. Si ancora al CODICE.
check("v390 la lista dei titoli per EDGAR viene da load_holdings, non da un elenco scritto a mano",
      "_, _wl_sec, _ = load_holdings()" in _SRC_UD
      and "for _tk in sorted(_seguiti):" in _SRC_UD)

check("v390 credito banche: SLOOS e NFCI arrivano con la loro data e la loro serie",
      '"serie": "DRTSCILM"' in _SRC_UD and '"serie": "NFCI"' in _SRC_UD
      and 'macro["credito_banche"]' in _SRC_UD)

check("v390 BCE: la serie e' dichiarata nel campo fonte, non solo nel codice",
      "MRR_FR" in _SRC_UD and '"fonte": "BCE Data Portal' in _SRC_UD)

# ⚠ le tre fonti entrano nel gate di qualita' INSIEME al codice che le scarica
check("v390 le tre fonti nuove sono sorvegliate da validate_macro",
      all(k in _SRC_UD for k in ('add("sec_calendario"', 'add(f"credito_{_k}"', 'add("bce"')))

# ═══ v393 — L'ANNO SU ANNO SI AGGANCIA ALLA DATA, NON ALLA POSIZIONE ═══════════════════
# Il difetto vero: `series[-1] / series[-13]` conta TREDICI POSIZIONI e le chiama dodici mesi.
# CPIAUCSL ha un buco a ottobre 2025 (il BLS non ha pubblicato quel mese), quindi la base
# cadeva su giugno 2025 invece che su luglio e il pacchetto stampava "CPI 3,5%" dove l'anno su
# anno vero e' 3,3%. Nove punti consecutivi dello storico, tutti gonfiati.
#
# ⚠ IL CHECK NON VERIFICA UN NUMERO ATTESO, VERIFICA UNA PROPRIETA' CHE IL DIFETTO VIOLA PER
# COSTRUZIONE: su una serie con un buco, il risultato deve coincidere col rapporto fra le due
# osservazioni giuste PER DATA. Nessuna implementazione posizionale la soddisfa per caso.
# (E' la lezione v326: i valori attesi si possono sbagliare insieme al codice.)
_SERIE_CON_BUCO = ([(f"2025-{m:02d}-01", 100.0 + m) for m in range(1, 10)]      # gen-set 2025
                   + [(f"2025-{m:02d}-01", 100.0 + m) for m in (11, 12)]        # ottobre MANCA
                   + [(f"2026-{m:02d}-01", 120.0 + m) for m in range(1, 8)])    # gen-lug 2026
_ATTESO = round((127.0 / 107.0 - 1) * 100, 1)      # lug 2026 su lug 2025, per DATA

check("v393 l'a/a su una serie BUCATA usa la base giusta per data (non la 13a posizione)",
      ud._var_per_data(_SERIE_CON_BUCO, 12)[0] == _ATTESO)

check("v393 e dichiara che sono dodici mesi veri quando la base esatta c'e'",
      ud._var_per_data(_SERIE_CON_BUCO, 12)[2] == 12)

# ⚠ il caso in cui la base esatta NON esiste: non si tace e non si approssima in silenzio,
# si dichiara la distanza vera cosi' chi stampa puo' scrivere "su 13 mesi" invece di "a/a".
_SENZA_BASE = [(d, v) for d, v in _SERIE_CON_BUCO if d != "2025-07-01"]
check("v393 base assente: ritorna la distanza REALE invece di spacciarla per un anno",
      ud._var_per_data(_SENZA_BASE, 12)[2] == 13)

# una serie senza buchi deve dare esattamente quello che dava prima: la correzione non
# muove i numeri gia' giusti (verificato sui dati veri: PCE resta 3,7%).
_SERIE_PIENA = [(f"{a}-{m:02d}-01", 100.0 + (a - 2025) * 12 + m)
                for a in (2025, 2026) for m in range(1, 13)][:19]
check("v393 su una serie SENZA buchi il risultato non cambia",
      ud._var_per_data(_SERIE_PIENA, 12)[0]
      == round((_SERIE_PIENA[-1][1] / _SERIE_PIENA[-13][1] - 1) * 100, 1))

check("v393 anche lo STORICO si aggancia alla data, non all'indice",
      "per_data.get(_mese_meno(d, indietro))" in _SRC_UD
      and "s[i - 12]" not in _SRC_UD_CODICE)

# ⚠ seconda causa, indipendente dalla prima: il BLS titola l'a/a sulla serie GREZZA.
check("v393 il CPI a/a esce dalla serie NON destagionalizzata, come il titolo del BLS",
      'fred_series("CPIAUCNS")' in _SRC_UD and 'bls_series("CUUR0000SA0")' in _SRC_UD
      and 'fred_series("CPIAUCSL")' not in _SRC_UD)

check("v393 lo storico del CPI segue la stessa serie del valore",
      '("cpi",      "CPIAUCNS",' in _SRC_UD)

# ══ v395 — IL CALENDARIO UFFICIALE DELLE USCITE ═══════════════════════════════════════════
import os                              # v395: la chiave API si legge dall'ambiente
from datetime import date              # v395: le date del calendario sono giorni, non istanti
# ⚠⚠ COSA SI PUO' PROVARE DA QUI E COSA NO, DETTO PRIMA. La FETCH verso FRED richiede la
# chiave API, che vive nei secret di GitHub Actions: da qui non e' esercitabile, ed e'
# esattamente la trappola v203 (logica provata, fetch mai provata) che e' costata la rimozione
# di due blocchi interi. Quindi: qui si prova TUTTA la logica con una http_get finta —
# raggruppamento per release, scarto delle date passate, salto delle serie non-FRED, rifiuto
# senza chiave — e la fetch vera si esercita nel run del CI, leggendone il log e il data.json
# prodotto. Cio' che non e' osservabile da qui non viene affermato.
class _RispostaFinta:
    def __init__(self, payload):
        self._p = payload

    def json(self):
        return self._p


_URL_VISTI = []


def _fred_finta(url, **kw):
    _URL_VISTI.append(url)
    if "/fred/series/release" in url:
        sid = url.split("series_id=")[1].split("&")[0]
        # NFP e disoccupazione escono dallo STESSO comunicato: e' il caso che prova il
        # raggruppamento. Se si perdesse, la pipeline farebbe il doppio delle chiamate.
        # ⚠ v397 — QUI C'ERA `abs(hash(sid))`, e hash() in Python e' RANDOMIZZATO per processo
        # (PYTHONHASHSEED): un'altra serie poteva collidere con 50 e far cadere il check sul
        # raggruppamento senza che nulla fosse rotto. E' la classe gia' pagata in v233 e v349 —
        # un check che dipende dal caso invece che dalla proprieta' va rosso da solo. Ora l'id
        # e' una funzione DETERMINISTICA del nome della serie.
        rid = 50 if sid in ("PAYEMS", "UNRATE") else 100 + sum(ord(c) for c in sid) % 800
        return _RispostaFinta({"releases": [{"id": rid, "name": f"Comunicato {rid}"}]})
    if "/fred/release/dates" in url:
        _ieri = (date.today() - timedelta(days=1)).isoformat()
        _domani = (date.today() + timedelta(days=1)).isoformat()
        _poi = (date.today() + timedelta(days=30)).isoformat()
        return _RispostaFinta({"release_dates": [
            {"release_id": 1, "date": "1999-01-01"},   # vecchia: va scartata
            {"release_id": 1, "date": _ieri},          # ieri: va scartata
            {"release_id": 1, "date": _domani},
            {"release_id": 1, "date": _poi}]})
    raise AssertionError("url inatteso: " + url)


_vero_get, _vero_sleep = ud.http_get, ud.time.sleep
_vecchia_chiave = os.environ.get("FRED_API_KEY")
try:
    ud.http_get = _fred_finta
    ud.time.sleep = lambda *_a, **_k: None

    # senza chiave non si indovina: si alza. Un ripiego silenzioso qui vorrebbe dire
    # pubblicare "confermata" una data che nessuno ha confermato.
    os.environ.pop("FRED_API_KEY", None)
    _alzata = False
    try:
        ud.calendario_uscite_fred([("cpi", "CPIAUCNS")])
    except RuntimeError:
        _alzata = True
    check("v395 senza FRED_API_KEY il calendario si rifiuta invece di indovinare", _alzata)

    os.environ["FRED_API_KEY"] = "a" * 32
    _URL_VISTI.clear()
    _cal = ud.calendario_uscite_fred(ud.STORICO_IND)

    check("v395 il calendario esce dalla stessa tabella dello storico, non da una seconda copia",
          "STORICO_IND" in _SRC_UD_CODICE
          and _SRC_UD_CODICE.count("STORICO_IND = [") == 1
          and "calendario_uscite_fred(STORICO_IND)" in _SRC_UD_CODICE)

    # ⚠ la classe v393: descrivere il calendario del RIPIEGO sotto un dato che viene dalla
    # fonte primaria. UMich e' marcata PRIMARIA: e non deve comparire.
    check("v395 le serie non-FRED (PRIMARIA:) restano fuori dal calendario FRED",
          "umich" not in _cal
          and any(k == "umich" for k, s, _m, _q in ud.STORICO_IND if s.startswith("PRIMARIA:")))

    check("v395 gli indicatori FRED prendono la data dal calendario",
          "cpi" in _cal and "nfp" in _cal and _cal["cpi"]["release_id"]
          and _cal["cpi"]["serie"] == "CPIAUCNS")

    _domani = (date.today() + timedelta(days=1)).isoformat()
    check("v395 le date gia' passate sono scartate: 'prossima' vuol dire prossima",
          all(v["prossime"] and v["prossime"][0] == _domani
              and all(d >= date.today().isoformat() for d in v["prossime"])
              for v in _cal.values()))

    # NFP e UNRATE condividono la release 50: una sola chiamata alle date, non due.
    _n_date = len([u for u in _URL_VISTI if "/fred/release/dates" in u and "release_id=50" in u])
    check("v395 gli indicatori dello stesso comunicato costano UNA chiamata, non una per serie",
          _n_date == 1 and _cal["nfp"]["release_id"] == 50 and _cal["unemp"]["release_id"] == 50)

    # una fonte che nessun check guarda muore il giorno in cui nasce (v389): qui si verifica
    # che l'ASSENZA sia rumorosa, perche' e' l'unico modo in cui questa fonte puo' guastarsi.
    # ⚠ la prima stesura chiedeva solo "esiste un allarme che comincia per calendario_uscite":
    # troppo debole. Iniettando la perdita del ramo `missing` scattava comunque il ramo `stale`
    # dell'else, l'allarme c'era lo stesso e IL CHECK NON MORDEVA. Ora si verifica lo STATO,
    # che e' la cosa che distingue "non e' arrivato" da "e' arrivato vecchio".
    _dq = ud.validate_macro({"calendario_uscite": {"per_chiave": {}}})
    _voci = [c for c in _dq["checks"] if c["key"] == "calendario_uscite"]
    check("v395 il calendario assente diventa un allarme ESPLICITO, non un silenzio",
          len(_voci) == 1 and _voci[0]["status"] == "missing"
          and any(a.startswith("calendario_uscite: missing") for a in _dq["alerts"]))
    _dq2 = ud.validate_macro({"calendario_uscite": {
        "per_chiave": {"cpi": {"prossime": [_domani]}}, "letto_il": date.today().isoformat()}})
    check("v395 col calendario presente e futuro il check non suona",
          not any(a.startswith("calendario_uscite:") for a in _dq2["alerts"]))
finally:
    ud.http_get, ud.time.sleep = _vero_get, _vero_sleep
    if _vecchia_chiave is None:
        os.environ.pop("FRED_API_KEY", None)
    else:
        os.environ["FRED_API_KEY"] = _vecchia_chiave

# ══ v398 — LE NOTIZIE PER TITOLO ══════════════════════════════════════════════════════════
from email.utils import format_datetime as _eu_fmt   # RFC 2822: il formato dei feed
# ⚠ La fetch verso Yahoo non e' esercitabile in modo affidabile da qui (la quota per IP si
# esaurisce: misurato, dopo ~15 richieste risponde 429 anche a 1,5 secondi di distanza). Come
# per il calendario FRED: la LOGICA si prova tutta con una risposta finta, la fetch vera si
# esercita nel run del CI leggendone il log. Cio' che non e' osservabile da qui non si afferma.
_RSS_FINTO = (
    "<rss><channel>"
    "<item><title>Titolo recente sulla societa'</title>"
    "<description>Un riassunto che non ripete il titolo.</description>"
    "<link>http://x/1</link><pubDate>{recente}</pubDate></item>"
    "<item><title>Titolo vecchio fuori finestra</title><description></description>"
    "<link>http://x/2</link><pubDate>{vecchio}</pubDate></item>"
    "<item><title>Senza data non deve entrare</title><link>http://x/3</link></item>"
    "<item><title>corto</title><pubDate>{recente}</pubDate></item>"
    "</channel></rss>"
).format(recente=_eu_fmt(datetime.now(timezone.utc) - timedelta(hours=3)),
         vecchio=_eu_fmt(datetime.now(timezone.utc) - timedelta(days=40)))

_voci = ud.voci_rss(_RSS_FINTO, "prova")
check("v398 il parser RSS scarta cio' che non si puo' pesare o e' spazzatura",
      len(_voci) == 2                                   # senza data e titolo corto: fuori
      and _voci[0]["titolo"] == "Titolo recente sulla societa'"
      and _voci[0]["riassunto"].startswith("Un riassunto")
      and _voci[0]["fonte"] == "prova")

check("v398 un riassunto uguale al titolo non e' un riassunto",
      ud.voci_rss("<item><title>Uguale uguale uguale</title>"
                  "<description>uguale uguale uguale</description>"
                  f"<pubDate>{_eu_fmt(datetime.now(timezone.utc))}</pubDate></item>",
                  "p")[0]["riassunto"] == "")

# ⚠ IL PARSER DEVE ESSERE UNO SOLO: due copie divergono al primo ritocco (v161, v207, v316).
check("v398 il parser RSS non e' reimplementato una seconda volta nella pipeline",
      _SRC_UD_CODICE.count("def voci_rss") == 1
      and _SRC_UD_CODICE.count('re.findall(r"<item>(.*?)</item>"') == 1
      and "voci_rss(testo, fonte, NEWS_RE if filtra else None" in _SRC_UD_CODICE)

class _RispNews:
    def __init__(self, code, testo=""):
        self.status_code = code
        self.text = testo


_CHIAMATE_NEWS = []


def _fake_news(url, headers=None, timeout=None):
    _CHIAMATE_NEWS.append(url)
    tk = url.split("s=")[1].split("&")[0]
    if tk == "STROZZATO":
        return _RispNews(429)
    if tk == "MUTO":
        return _RispNews(200, "<rss></rss>")
    return _RispNews(200, _RSS_FINTO)


_vero_req = ud.requests.get
_vero_sl = ud.time.sleep
try:
    ud.requests.get = _fake_news
    ud.time.sleep = lambda *_a, **_k: None
    _CHIAMATE_NEWS.clear()
    _out = ud.news_titoli(["BUONO", "MUTO", "STROZZATO"])

    check("v398 i tre esiti restano DISTINTI: con voci, senza voci, non letto",
          list(_out["per_titolo"]) == ["BUONO"]
          and _out["senza_notizie"] == ["MUTO"]
          and _out["non_letti"] == ["STROZZATO"])

    # ⚠ un 429 NON e' un guasto da ritentare: e' la fonte che dice "rallenta". Ritentare tre
    # volte, come fa http_get, significa martellare proprio quando non si deve.
    check("v398 un 429 costa UNA chiamata, non tre: non si martella la fonte",
          len([u for u in _CHIAMATE_NEWS if "STROZZATO" in u]) == 1
          and "http_get(" not in _SRC_UD_CODICE.split("def news_titoli")[1].split("def ")[0])

    check("v398 fuori dalla finestra non entra: una notizia di 40 giorni non e' una notizia",
          len(_out["per_titolo"]["BUONO"]) == 1)
finally:
    ud.requests.get = _vero_req
    ud.time.sleep = _vero_sl

# la fonte nasce sorvegliata: e' l'unica difesa contro il guasto silenzioso (v389)
_dqn = ud.validate_macro({"_news_titoli": {"per_titolo": {}, "senza_notizie": [],
                                           "non_letti": ["A", "B"], "letto_il": "2026-09-02"}})
check("v398 se la fonte strozza meta' dei titoli, il gate lo dice",
      any(a.startswith("news_titoli: stale") for a in _dqn["alerts"]))
_dqn2 = ud.validate_macro({"_news_titoli": {"per_titolo": {"A": [1]}, "senza_notizie": [],
                                            "non_letti": [], "letto_il": "2026-09-02"}})
check("v398 con la raccolta riuscita il gate non suona",
      not any(a.startswith("news_titoli") for a in _dqn2["alerts"]))

# ⚠⚠ E IL COLLEGAMENTO, non solo il controllo. I due check qui sopra chiamano validate_macro
# con un dizionario costruito a mano: provano che il CHECK funziona, non che la fonte gli
# arrivi davvero. Togliendo la riga che l'aggancia restavano tutti verdi — cioe' la fonte
# poteva smettere di essere sorvegliata senza che nulla mordesse, che e' letteralmente il
# guasto per cui le news macro sono morte un anno (v389). Trovato iniettando, non rileggendo.
# ⚠ `validate_macro(macro)` compare DUE volte nel file e find() prendeva la prima, che sta
# molto piu' su: il check era rosso sul codice giusto. Conta quella dell'ASSEMBLAGGIO, cioe'
# l'ultima. Un indice preso dal posto sbagliato e' un check che misura un'altra cosa.
_i_agg = _SRC_UD_CODICE.find('macro["_news_titoli"]')
_i_val = _SRC_UD_CODICE.rfind("validate_macro(macro)")
check("v398 la raccolta e' AGGANCIATA al gate, e prima che il gate giri",
      _i_agg > 0 and _i_val > 0 and _i_agg < _i_val
      and "news_titoli(_tk_pos)" in _SRC_UD_CODICE)

_TOT = len(ESEGUITI)
check("v254 la suite non ha perso check per strada (soglia minima %d)" % N_CHECKS_MINIMO,
      _TOT >= N_CHECKS_MINIMO)
_TOT = len(ESEGUITI)

print(f"\n{('TUTTI I ' + str(_TOT - len(FAILED)) + f'/{_TOT} CHECK OK') if not FAILED else str(len(FAILED)) + f'/{_TOT} CHECK FALLITI: ' + ', '.join(FAILED)}")
sys.exit(1 if FAILED else 0)

