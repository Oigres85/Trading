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

# ⚠⚠ v430 — LA FINESTRA E' PARTE DEL NUMERO. Sharpe, Sortino, VaR, ES, beta e correlazione media
# escono TUTTI dallo stesso pannello, e quante sedute fosse non usciva da nessuna parte: nel
# pacchetto stavano accanto a un drawdown che dichiara le proprie ~125 sedute, cioe' due misure
# di rischio dello stesso libro su due basi e una sola dichiarata. Il check verifica il FATTO
# (la finestra e' quella davvero usata, non un numero qualunque) invece della presenza.
check("v430 risk: la finestra del calcolo esce col numero", risk.get("finestra_sedute") == 252)
check("v430 risk: la finestra porta i propri estremi",
      risk.get("finestra_da") == dates[0].strftime("%Y-%m-%d")
      and risk.get("finestra_a") == dates[-1].strftime("%Y-%m-%d"))
# ⚠ e deve seguire l'INTERSEZIONE, non il pannello: una serie piu' corta accorcia la finestra di
# tutti, ed e' precisamente il caso in cui dichiararla serve.
_corto = [dict(r) for r in panel]
_corto[0] = dict(_corto[0], _ret_series=_corto[0]["_ret_series"][60:],
                 _ret_dates=_corto[0]["_ret_dates"][60:])
_r2 = compute_risk_metrics(_corto, []) or {}
check("v430 risk: la finestra e' l'INTERSEZIONE delle serie, non la piu' lunga",
      _r2.get("finestra_sedute") == 192 and _r2.get("finestra_da") == dates[60].strftime("%Y-%m-%d"))

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
_orig_storico = ud._finra_storico      # v496: i canali FINRA sono due, e cadono insieme qui
ud._finra_scrape = lambda url: (_ for _ in ()).throw(RuntimeError("403 simulato"))
ud._finra_storico = lambda url: (_ for _ in ()).throw(RuntimeError("403 simulato"))
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
ud._finra_storico = _orig_storico


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
# v476: il pavimento era fermo a 112 su 223 check eseguiti — META' suite poteva sparire restando
# verde, il guasto per cui esiste (v277, v400). Alzato con margine, mai incollato al conteggio.
N_CHECKS_MINIMO = 288  # +8 con le news per titolo v398, +8 con la liquidita' v476, v492: 249 eseguiti, v496: 263, v497: 282, v498: 288, v500: 291 (sale, mai scende)

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
# il gate di qualita' dati: serve a provare che una regola non e' stata allentata (v208)
_SRC_AUDIT = (Path(__file__).resolve().parent / "audit_data.py").read_text(encoding="utf-8")
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
    # ⚠ i due canali hanno parametri diversi: Nasdaq usa `symbol=`, Yahoo `s=`. Leggere sempre
    # `s=` faceva estrarre il ticker sbagliato dall'URL di Nasdaq — un check che misura un'altra
    # cosa perche' l'indice e' preso dal posto sbagliato (stessa svista del find/rfind di v398).
    tk = (url.split("symbol=")[1].split("&")[0] if "symbol=" in url
          else url.split("s=")[1].split("&")[0])
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
    # ⚠ v399 — L'INVARIANTE E' CAMBIATO COL CONTRATTO, non e' stato indebolito. Con DUE canali
    # un 429 sul primario non e' un fallimento: e' il segnale di passare alla riserva, quindi
    # per quel titolo le chiamate sono due, una per canale. Cio' che non deve MAI accadere e'
    # ritentare LO STESSO canale, cioe' martellare una fonte che sta dicendo "rallenta".
    _per_canale = {}
    for _u in _CHIAMATE_NEWS:
        if "STROZZATO" in _u:
            _per_canale.setdefault("nasdaq" if "nasdaq" in _u else "yahoo", []).append(_u)
    check("v399 nessun canale viene ritentato: un 429 passa alla riserva, non si martella",
          bool(_per_canale) and all(len(v) == 1 for v in _per_canale.values())
          and "http_get(" not in _SRC_UD_CODICE.split("def news_titoli")[1].split(chr(10) + "def ")[0])

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

# ═══ v401 — LA SOGLIA DEL RUMORE, E LE DUE FINESTRE ════════════════════════════════════════
# Il pavimento "R2 >= 0,05" era una CONVENZIONE che reggeva finche' la finestra era una sola.
# Con due finestre diventa falsa in direzioni opposte, e il check lo misura invece di crederci.
_r2r = ud.r2_rumore

# valori tabulati di Student al 97,5%: l'approssimazione va verificata contro di loro, non
# contro se stessa — un check che conferma la propria formula non e' un check (v326).
for _n, _t_tab in ((60, 2.00172), (90, 1.98729), (251, 1.96959)):
    _df = _n - 2
    _atteso = _t_tab * _t_tab / (_t_tab * _t_tab + _df)
    check("v401 il pavimento del rumore a n=%d coincide col valore tabulato" % _n,
          _r2r(_n) is not None and abs(_r2r(_n) - _atteso) < 1e-4)

check("v401 il pavimento e' PIU' ALTO sulla finestra corta che su quella lunga",
      _r2r(60) > _r2r(251) and _r2r(60) > 0.06 and _r2r(251) < 0.02)

# ⚠ E' IL PUNTO DELLA MODIFICA: con la vecchia soglia fissa la finestra corta avrebbe acceso
# canali dal nulla, cioe' avrebbe fabbricato proprio il segnale che deve rilevare.
check("v401 la vecchia soglia fissa 0,05 sarebbe PERMISSIVA sulla finestra corta",
      0.05 < _r2r(60))

check("v401 sotto df 30 non si restituisce un numero peggiore del silenzio",
      _r2r(31) is None and _r2r(32) is not None)

# ── le due finestre, su serie costruite perche' il fenomeno ci sia ──
# ⚠⚠ COSTRUIRE QUESTO CASO HA INSEGNATO QUALCOSA SUL METODO, e va scritto: con 259
# osservazioni il pavimento del rumore vale 0,015, cioe' e' BASSISSIMO — una relazione recente
# e forte si vede quasi sempre anche sull'anno, perche' il pooled R2 la raccoglie. La finestra
# corta non serve a trovare un canale forte: serve a trovarne uno che l'anno DILUISCE, cioe'
# quando il titolo ha avuto una storia propria molto rumorosa e solo di recente e' passato a
# muoversi col canale. La prima stesura del check ne costruiva uno troppo forte e l'anno lo
# vedeva lo stesso: il check era rosso e aveva ragione. Qui il titolo ha volatilita' propria al
# 3% per l'anno e nell'ultimo trimestre segue il canale con rumore allo 0,3%.
_idx = pd.bdate_range("2025-01-01", periods=260)
_rng = np.random.default_rng(11)
_rb = _rng.normal(0, 0.01, 260)
_b = pd.Series(100 * np.cumprod(1 + _rb), index=_idx)
_r_titolo = _rng.normal(0, 0.03, 260)                                # storia propria, rumorosa
_r_titolo[-60:] = 1.0 * _rb[-60:] + _rng.normal(0, 0.003, 60)        # poi comanda il canale
_c = pd.Series(100 * np.cumprod(1 + _r_titolo), index=_idx)
_sens = ud.sensibilita_macro(_c, {"tassi": ("TLT", "i tassi", _b)})

check("v401 sensibilita': la finestra corta viene pubblicata accanto a quella lunga",
      _sens is not None and _sens["tassi"].get("breve") is not None)

check("v401 sensibilita': la finestra corta misura DAVVERO le ultime 60 sedute",
      _sens["tassi"]["breve"]["campione"] == 60
      and _sens["tassi"]["breve"]["a"] == _sens["tassi"]["a"]
      and _sens["tassi"]["breve"]["da"] > _sens["tassi"]["da"])

# il fenomeno costruito: spento sull'anno, acceso sull'ultimo trimestre
check("v401 sensibilita': un canale acceso solo di recente risulta acceso SOLO sul breve",
      _sens["tassi"]["acceso"] is False and _sens["tassi"]["breve"]["acceso"] is True)

check("v401 sensibilita': ogni finestra porta la propria soglia, non una condivisa",
      _sens["tassi"]["r2_soglia"] < _sens["tassi"]["breve"]["r2_soglia"])

# ⚠ con meno di 90 osservazioni le due finestre coinciderebbero: stampare due volte lo stesso
# numero e' peggio che non stamparlo (v184, la ridondanza misurata e tolta).
_corta = ud.sensibilita_macro(_c.iloc[-80:], {"tassi": ("TLT", "i tassi", _b.iloc[-80:])})
check("v401 sensibilita': sotto 90 osservazioni la finestra corta NON si pubblica",
      _corta is not None and _corta["tassi"].get("breve") is None)

# ═══ v403 — LA SENSIBILITA' NELLE SEDUTE DI FORTE ESCURSIONE ═══════════════════════════════
# Serie costruita perche' il fenomeno ci sia: la relazione col canale vale SOLO nelle sedute in
# cui il canale si muove molto. E' il caso che il libro teme (il giorno che i tassi saltano) e
# che una regressione sulla giornata media descrive male.
_idxE = pd.bdate_range("2025-01-01", periods=260)
_rngE = np.random.default_rng(5)
_rbE = _rngE.normal(0, 0.01, 260)
_bE = pd.Series(100 * np.cumprod(1 + _rbE), index=_idxE)
_grandi = np.abs(_rbE) >= np.quantile(np.abs(_rbE), 0.8)
_rtE = _rngE.normal(0, 0.02, 260)
_rtE[_grandi] = 2.5 * _rbE[_grandi] + _rngE.normal(0, 0.004, int(_grandi.sum()))
_cE = pd.Series(100 * np.cumprod(1 + _rtE), index=_idxE)
_sE = ud.sensibilita_macro(_cE, {"tassi": ("TLT", "i tassi", _bE)})["tassi"]

check("v403 il terzo sguardo esiste e porta il proprio campione e la propria soglia",
      _sE.get("evento") is not None
      and _sE["evento"]["campione"] >= 32
      and _sE["evento"]["r2_soglia"] > _sE["r2_soglia"])

# ⚠ IL PUNTO DELLA MISURA, e la sua affermazione onesta: NON scopre un canale invisibile — una
# relazione di coda porta gran parte della varianza e si vede anche nella regressione piena.
# Quello che aggiunge e' il BETA delle giornate che contano, che la media sottostima.
check("v403 il beta delle sedute forti e' piu' ampio di quello pieno, che lo sottostima",
      abs(_sE["evento"]["beta"]) > abs(_sE["beta"]) * 1.2)

check("v403 il campione condizionato e' circa un quinto delle sedute, non un decimo",
      0.15 * _sE["campione"] <= _sE["evento"]["campione"] <= 0.25 * _sE["campione"])

# ⚠ la selezione e' sulla |escursione| del CANALE: la soglia pubblicata deve essere quella, e
# deve essere positiva — se fosse zero la selezione non selezionerebbe niente.
check("v403 la soglia di escursione e' pubblicata ed e' positiva",
      _sE["evento"].get("escursione_min") is not None and _sE["evento"]["escursione_min"] > 0)

# ⚠ sotto le 32 osservazioni selezionate non si pubblica: il pavimento del rumore non esiste
# sotto df 30, e un pavimento inventato sarebbe peggio del silenzio.
_corto = ud.sensibilita_macro(_cE.iloc[-100:], {"tassi": ("TLT", "i tassi", _bE.iloc[-100:])})["tassi"]
check("v403 su un campione troppo piccolo il terzo sguardo tace invece di inventare un pavimento",
      _corto.get("evento") is None)

# ═══ v421 — TRE ESITI PER OGNI FONTE MACRO, NON UNO ════════════════════════════════════════
# `fonti` elencava le fonti CONFIGURATE, quindi il pacchetto scriveva "(fonti: CNBC, Bloomberg,
# MarketWatch)" anche nel run in cui MarketWatch non aveva servito niente. "Letta e senza voci
# macro" e "NON letta" si leggono uguali e significano l'opposto: e' il guasto della v389, dove
# un try/except per-fonte ha tenuto le news morte un anno mentre l'elenco continuava a nominare
# le fonti morte. La v399 lo ha chiuso per le notizie PER TITOLO; il blocco macro era rimasto
# indietro (classe v412, correzione applicata a un ramo e non all'altro).
_dqf = ud.validate_macro({"news": {"voci": [{"quando": datetime.now(timezone.utc).isoformat()}],
                                   "fonti": ["Alfa"], "fonti_mute": ["Beta"],
                                   "fonti_non_lette": ["Gamma"]}})
check("v421 una fonte macro non raggiunta fa suonare il gate",
      any(a.startswith("news_fonti") and "Gamma" in a for a in _dqf["alerts"]))

# ⚠ una fonte MUTA non e' un allarme: puo' non aver avuto notizie macro in questo run, ed e' il
# caso normale di MarketWatch. Se suonasse anche li', il gate diventerebbe rumore e verrebbe
# ignorato proprio quando una fonte muore davvero.
_dqf2 = ud.validate_macro({"news": {"voci": [{"quando": datetime.now(timezone.utc).isoformat()}],
                                    "fonti": ["Alfa"], "fonti_mute": ["Beta"],
                                    "fonti_non_lette": []}})
check("v421 una fonte muta NON fa suonare il gate",
      not any(a.startswith("news_fonti") for a in _dqf2["alerts"]))

# ⚠⚠ E IL COLLEGAMENTO, non solo il controllo (lezione v399): i due check sopra passano un
# dizionario costruito a mano, quindi proverebbero il gate anche se la pipeline smettesse di
# distinguere i tre esiti. Qui si guarda il codice che li produce.
check("v421 la pipeline registra CHI HA SERVITO, non chi era configurato",
      '"fonti": serviti,' in _SRC_UD_CODICE
      and '"fonti_non_lette": non_letti,' in _SRC_UD_CODICE
      and "non_letti.append(fonte)" in _SRC_UD_CODICE
      and "[f for f, _, _ in NEWS_FONTI]" not in _SRC_UD_CODICE)

# ── v433 — l'arrotondamento non deve DISTRUGGERE il dato su uno strumento a prezzo basso ──
# ⚠⚠ La pipeline e' MORTA per questo. `round(atr_14, 2)` su EURUSD=X a 1,16 dava 0,0 e
# `audit_data` alzava una violazione HARD ("in borsa un valore nullo non esiste") — il gate
# aveva ragione, a sbagliare era la scrittura. E scattava PER CASO: l'ATR di quel cambio vale
# ~0,005, cioe' esattamente sul confine dei due decimali, quindi il 07/09 usciva 0,01 e l'08/09
# 0,00. E' la classe v233/v349 — dipendere dal caso invece che dalla proprieta' — sul DATO.
# ⚠ Lo stato si COSTRUISCE: nessun `data.json` di oggi contiene per forza il caso, e un check
# che aspetta il fenomeno vale finche' i dati lo concedono (v429).
for _nome, _px, _atr in (("EURUSD=X sul confine", 1.16, 0.0049912),
                         ("EURUSD=X piu' quieto", 1.16, 0.0031),
                         ("strumento sotto l'unita'", 0.42, 0.00042)):
    _r = ud.arrotonda_alla_scala(_atr, _px)
    check("v433 ATR di %s non annullato dall'arrotondamento" % _nome,
          _r is not None and _r > 0)
    check("v433 ATR di %s resta fedele entro il mezzo per cento" % _nome,
          abs(_r - _atr) <= abs(_atr) * 0.005)

# ⚠ E NESSUNA REGRESSIONE dove due decimali bastavano: una correzione si stringe a cio' che e'
# rotto. Sopra i 10 il valore pubblicato dev'essere IDENTICO a quello di prima.
for _nome, _px, _atr in (("MU", 1016.59, 54.8412), ("BTC-USD", 79170.52, 2235.2231),
                         ("^VIX", 15.3, 1.2134), ("^GSPC", 6800.0, 71.4)):
    check("v433 sopra i 10 l'arrotondamento di %s e' invariato" % _nome,
          ud.arrotonda_alla_scala(_atr, _px) == round(_atr, 2))

# ⚠⚠ E IL COLLEGAMENTO, non solo la funzione (lezione v399): togliendo la riga che la aggancia
# al payload i check sopra resterebbero tutti verdi e la pipeline tornerebbe a morire.
check("v433 il payload usa l'arrotondamento alla scala, non round(_, 2)",
      '"atr_14": arrotonda_alla_scala(atr_14, price)' in _SRC_UD_CODICE
      and '"atr_14": round(atr_14, 2)' not in _SRC_UD_CODICE)

# ⚠ La violazione che ha ucciso il run: `audit_data` rifiuta un valore nullo nel payload, ed e'
# la regola giusta. Il check prova che il gate MORDE ancora — se un domani lo allentassero per
# far passare questo caso, la protezione sparirebbe insieme al difetto (v208).
# ⚠ La sonda va verificata contro il TESTO VERO: la prima stesura cercava "<=" mentre il file
# scrive "≤". Un check rosso su codice giusto e' una sonda sbagliata, non un gate che morde.
check("v433 il gate di audit continua a rifiutare un atr_14 nullo",
      '"atr_14"' in _SRC_AUDIT and "\u2264 0 o non-finito nel payload" in _SRC_AUDIT)

# ═══ v441 — LA METODOLOGIA CME, e gli invarianti che la vecchia formula violava ═══════════
# ⚠ Si costruisce lo stato invece di leggerlo dai dati del giorno: `implied` cambia a ogni run
#   e un check che lo aspettasse andrebbe rosso a calendario (v429, v431, v435).
from datetime import date as _date
_MOV = ud.movimenti_impliciti_fomc

# --- 1. la ponderazione sui giorni: e' cio' che la formula vecchia ignorava ---
# Con un rialzo da 25bp EFFETTIVO da meta' mese, la media del mese sale solo di meta' passo.
# La formula vecchia leggeva quella media come il tasso di fine mese e sottostimava di 2x.
_r = _MOV(3.63 + 0.25 * (14 / 30), 3.63, "2026-09-16", _date(2026, 9, 1))
check(f"v441 un rialzo pieno da meta' mese si legge come UN movimento, non come mezzo "
      f"(misurato {_r['mosse_25bp'] if _r else 'None'})",
      _r is not None and abs(_r["mosse_25bp"] - 1.0) < 0.01)
check("v441 la ponderazione e' quella vera: 16 giorni prima, 14 dopo, su 30",
      _r is not None and (_r["giorni_vecchio"], _r["giorni_nuovo"], _r["giorni_mese"]) == (16, 14, 30))

# --- 2. la formula VECCHIA violava questo invariante, ed e' la prova che era sbagliata ---
_vecchia = (3.625 - (3.63 + 0.25 * (14 / 30))) / 0.25 * 100
check(f"v441 la formula vecchia, sullo stesso stato, dava {-_vecchia:.0f}% dove il movimento "
      f"e' pieno (100%): sbagliava di piu' del doppio",
      abs(-_vecchia - 100) > 40)

# --- 3. il segno: un taglio e' un movimento negativo, non uno zero ---
_t = _MOV(3.63 - 0.25 * (14 / 30), 3.63, "2026-09-16", _date(2026, 9, 1))
check(f"v441 un taglio pieno esce come -1 movimento (misurato "
      f"{_t['mosse_25bp'] if _t else 'None'}), col segno che il max(0,...) buttava via",
      _t is not None and abs(_t["mosse_25bp"] + 1.0) < 0.01)

# --- 4. fuori dal mese del contratto NON si pubblica: e' la v199 nella sua forma corretta ---
# ⚠ Il limite non e' "35 giorni" ma "lo stesso mese di calendario": un front-month di settembre
#   non prezza ottobre, e la rampa +i*12 fingeva di saperlo.
check("v441 una riunione fuori dal mese del contratto non produce nessun numero",
      _MOV(3.79, 3.63, "2026-10-28", _date(2026, 9, 1)) is None
      and _MOV(3.79, 3.63, "2026-12-09", _date(2026, 9, 1)) is None)

# --- 5. la guardia di plausibilita': oltre tre movimenti si dichiara invece di pubblicare ---
check("v441 un implied non attribuibile a questa riunione si dichiara, non si pubblica",
      _MOV(5.00, 3.63, "2026-09-16", _date(2026, 9, 1)) is None)

# --- 6. e gli ingressi mancanti non producono un numero ---
check("v441 senza EFFR o senza implied non si inventa niente",
      _MOV(None, 3.63, "2026-09-16", _date(2026, 9, 1)) is None
      and _MOV(3.79, None, "2026-09-16", _date(2026, 9, 1)) is None
      and _MOV(3.79, 3.63, None, _date(2026, 9, 1)) is None)

# --- 7. la rampa inventata non deve rientrare ---
# ⚠⚠ Era `cut_prob + i*12`: dodici punti a riunione scritti a mano, che pubblicavano 78% a
#   ottobre e 90% a dicembre — numeri che nessun mercato ha quotato (classe v240). Il check
#   guarda il CODICE senza commenti, perche' la nota che spiega la rimozione la cita per forza
#   (v213, v240, v393 — il gate che trova se' stesso).
_cod_fw = "\n".join(l for l in _src.splitlines() if not l.strip().startswith("#"))
# ⚠⚠ SETTIMA INCARNAZIONE DELL'ANCORAGGIO APERTO, e dentro un gate scritto contro un altro
#   numero inventato: la prima stesura cercava la sottostringa "* 12", che in update_data.py
#   compare QUATTRO volte legittimamente (annualizzazioni, aritmetica dei mesi, un punteggio).
#   Rosso su codice corretto. L'invariante non e' una stringa ma una PROPRIETA': il ciclo che
#   costruisce `meetings` non deve avere un indice, perche' senza indice non esiste rampa —
#   la vecchia usava `enumerate(fomc[:4])` proprio per averlo.
_blocco_meetings = _cod_fw.split("meetings = []")[1].split("macro[\"fedwatch\"]")[0] \
    if "meetings = []" in _cod_fw else ""
check("v441 il ciclo delle riunioni non ha un indice, quindi non puo' proiettare una rampa",
      bool(_blocco_meetings) and "enumerate" not in _blocco_meetings
      and "prezzata_dal_contratto" in _blocco_meetings)

# --- 8. il collegamento, non solo il controllo (v399) ---
# Togliendo la riga che aggancia la funzione al blocco FedWatch, i sette check qui sopra
# restano tutti verdi e la pipeline torna a pubblicare la formula vecchia.
# ⚠ v477 — il collegamento passa dalla CATENA: il blocco chiama catena_fedwatch con l'EFFR del
#   giorno, e la catena chiama movimenti_impliciti_fomc per le riunioni prezzate nel loro mese.
#   Riagganciato al fatto (la funzione e' raggiunta dalla produzione), non alla vecchia chiamata.
check("v441 il blocco FedWatch e' agganciato a movimenti_impliciti_fomc, non solo definita",
      "catena_fedwatch(effr_corrente" in _cod_fw
      and "movimenti_impliciti_fomc(tassi_mese[(a, m)], pre" in _cod_fw
      and "quarti = (mid - implied)" not in _cod_fw)

# ══ v443 — IL COLLEGAMENTO ERA ROTTO DALL'ORDINE DI SCRITTURA, e i sei gate della v441 non
#    potevano vederlo. `effr_corrente` veniva letto da `macro["fed_market"]["current_rate"]`,
#    ma quella chiave viene scritta MILLE RIGHE PIU' SOTTO nello stesso file: qui non esiste
#    ancora, quindi la lettura tornava SEMPRE None, `mov` era sempre None, e ogni riunione
#    usciva "non prezzata" con tutti i campi a null. Il pacchetto restava giusto solo perche'
#    `app.js` rifa' il conto da se' — cioe' il difetto era invisibile dove si guarda.
#    E' la lezione v399 nella sua forma piu' pura: i gate provavano il CONTROLLO (la funzione
#    chiamata a mano) e non il COLLEGAMENTO (da dove arriva il suo ingresso in produzione).
# ⚠ La proprieta' e' generale e non nomina il difetto: ogni chiave di `macro` che il blocco
#   FedWatch LEGGE dev'essere gia' stata scritta piu' sopra, oppure la lettura deve avere un
#   ripiego che non dipende da `macro`. Vale anche per le letture che verranno dopo.
_i_fw = _src.index('macro["fedwatch"] = {')
_pre_fw = _src[:_i_fw]
_blocco_effr = _pre_fw[_pre_fw.rindex("effr_corrente = None"):]
_letture = set(__import__("re").findall(r'macro\.get\("([a-z_]+)"\)', _blocco_effr))
_tardive = sorted(k for k in _letture
                  if ('macro["%s"] = ' % k) in _src and _src.index('macro["%s"] = ' % k) > _i_fw)
check("v443 il blocco FedWatch non dipende da una chiave che il file scrive dopo di lui"
      + (" (tardive: %s)" % ", ".join(_tardive) if _tardive else ""),
      not _tardive or "fred_series(\"FEDFUNDS\"" in _blocco_effr)

# ═══ v477 — IL CONTRATTO CONTINUO ROTOLA A META' MESE, E LA BASE ERA UNA MEDIA MENSILE ═══════
# Verificato il 13/10/2026: `ZQ=F` serviva ZQX26 (novembre) mentre la riunione era il 28/10, e
# la base era FEDFUNDS di settembre (3,75, meta' prima e meta' dopo il rialzo del 16/09) contro
# un EFFR di 3,88. Lo stato si COSTRUISCE (v425, v429): i prezzi dei contratti cambiano a ogni
# run, e un check che li aspettasse sarebbe verde per il caso.
check("v477 il contratto si nomina PER ESTESO: ZQ + codice del mese + anno",
      ud.simbolo_fed_funds(2026, 10) == "ZQV26.CBT" and ud.simbolo_fed_funds(2026, 11) == "ZQX26.CBT"
      and ud.simbolo_fed_funds(2026, 12) == "ZQZ26.CBT" and ud.simbolo_fed_funds(2027, 1) == "ZQF27.CBT")
check("v477 i mesi da leggere: il mese DOPO se e' noto e senza riunioni, sempre quello della riunione",
      ud.mesi_contratti_fomc(["2026-10-28", "2026-12-09"]) == [(2026, 11), (2026, 10), (2026, 12)])

_cat = ud.catena_fedwatch(3.88, ["2026-10-28", "2026-12-09"],
                          {(2026, 10): 3.885, (2026, 11): 3.94, (2026, 12): 4.085})
check("v477 riunione di fine mese col mese dopo senza riunioni: il tasso medio di quel mese E' il tasso deciso",
      _cat[0].get("prezzata_dal_contratto") and _cat[0].get("metodo") == "mese_dopo"
      and _cat[0].get("contratto") == "ZQX26.CBT" and _cat[0].get("mosse_25bp") == 0.24
      and _cat[0].get("base_effr") == 3.88 and _cat[0].get("tasso_atteso_fine_mese") == 3.94)
_post_dic = (31 * 4.085 - 9 * 3.94) / 22
check("v477 la riunione dopo parte dall'esito della precedente, nel proprio mese, coi giorni ponderati",
      _cat[1].get("metodo") == "mese_riunione" and _cat[1].get("base_effr") == 3.94
      and (_cat[1].get("giorni_vecchio"), _cat[1].get("giorni_nuovo"), _cat[1].get("giorni_mese")) == (9, 22, 31)
      and _cat[1].get("mosse_25bp") == round((_post_dic - 3.94) / 0.25, 2)
      and _cat[1].get("mosse_cumulate") == round((_post_dic - 3.88) / 0.25, 2))
# ⚠⚠ IL DIFETTO DELLA v450, in miniatura: un rialzo pieno il 16/09 (ottobre tutto al tasso nuovo)
#   letto con il contratto di OTTOBRE al posto di quello di settembre dava ~2 movimenti. Con la
#   chiave del mese la riunione di settembre si prezza col SUO contratto, e il numero torna 1.
_sett = ud.catena_fedwatch(3.63, ["2026-09-16", "2026-10-28"],
                           {(2026, 9): 3.63 + 0.25 * 14 / 30, (2026, 10): 3.88, (2026, 11): 3.88})
_letto_male = ud.movimenti_impliciti_fomc(3.88, 3.63, "2026-09-16", ud.datetime(2026, 9, 1).date())
check("v477 settembre si prezza col contratto di SETTEMBRE (1 movimento), non con quello del mese dopo (~2)",
      _sett[0].get("mosse_25bp") == 1.0 and _sett[0].get("contratto") == "ZQU26.CBT"
      and _letto_male is not None and _letto_male["mosse_25bp"] > 1.9
      and _sett[1].get("mosse_25bp") == 0.0 and _sett[1].get("mosse_cumulate") == 1.0)
_buco = ud.catena_fedwatch(3.88, ["2026-10-28", "2026-12-09"], {(2026, 12): 4.085})
check("v477 un contratto non letto si DICHIARA col suo simbolo, e la riunione dopo non si calcola su una base mancante",
      # ⚠ .get, non l'indice: l'iniezione che lascia proseguire la catena faceva MORIRE la suite
      #   con un KeyError invece di farla fallire su questo check — mordeva, ma raccontava male (v407)
      _buco[0].get("prezzata_dal_contratto") is False and _buco[0].get("motivo") == "contratto"
      and _buco[0].get("contratto") == "ZQX26.CBT" and _buco[1].get("motivo") == "catena"
      and "mosse_25bp" not in _buco[1])
_fuori = ud.catena_fedwatch(3.88, ["2026-10-28"], {(2026, 11): 4.95})
check("v477 oltre tre movimenti su una riunione sola si dichiara fuori scala, col numero grezzo",
      _fuori[0].get("motivo") == "plausibilita" and _fuori[0].get("mosse_grezze") == 4.28
      and "mosse_25bp" not in _fuori[0])
check("v477 senza EFFR del giorno nessuna riunione si calcola, e si dice perche'",
      all(v.get("motivo") == "dati" for v in ud.catena_fedwatch(None, ["2026-10-28", "2026-12-09"],
                                                             {(2026, 11): 3.94, (2026, 12): 4.085})))
_gen = ud.catena_fedwatch(3.88, ["2026-12-09"], {(2026, 12): 4.085, (2027, 1): 4.16})
check("v477 un mese fuori dal calendario noto (gennaio 2027) non si assume senza riunioni",
      _gen[0].get("metodo") == "mese_riunione" and _gen[0].get("contratto") == "ZQZ26.CBT")

# l'EFFR del giorno: NY Fed, poi FRED EFFR — MAI FEDFUNDS, la media mensile
class _RispNYF:
    def json(self):
        return {"refRates": [{"effectiveDate": "2026-10-09", "percentRate": 3.88}]}
_vg477, _vf477 = ud.http_get, ud.fred_series
try:
    ud.http_get = lambda *a, **k: _RispNYF()
    _e1 = ud.effr_giornaliero()
    def _no_rete(*a, **k):
        raise RuntimeError("rete")
    ud.http_get = _no_rete
    ud.fred_series = lambda sid, n=1, *a, **k: [("2026-10-08", 3.87)] if sid == "EFFR" else [("2026-09-01", 3.75)]
    _e2 = ud.effr_giornaliero()
    ud.fred_series = _no_rete
    _e3 = ud.effr_giornaliero()
finally:
    ud.http_get, ud.fred_series = _vg477, _vf477
check("v477 l'EFFR viene dalla NY Fed col suo giorno, poi da FRED EFFR, e senza entrambi e' un buco",
      _e1 == {"valore": 3.88, "data": "2026-10-09", "fonte": "NY Fed"}
      and _e2 == {"valore": 3.87, "data": "2026-10-08", "fonte": "FRED EFFR"} and _e3 is None)
# ⚠ _SRC_UD_CODICE non ha commenti: l'ancora del blocco e' una riga di CODICE, non il titolo
_i477 = _SRC_UD_CODICE.index("def effr_giornaliero(")
_fn_effr = _SRC_UD_CODICE[_i477:_SRC_UD_CODICE.index("\ndef ", _i477 + 10)]
_i477b = _SRC_UD_CODICE.index('macro["fedwatch"] = {')
_blocco477 = _SRC_UD_CODICE[_SRC_UD_CODICE.rindex("_mesi_fw = ", 0, _i477b):_i477b]
check("v477 collegamento: il blocco legge i contratti PER ESTESO e l'EFFR del giorno, mai il continuo ne' FEDFUNDS",
      "simbolo_fed_funds(" in _blocco477 and "effr_giornaliero()" in _blocco477
      and "catena_fedwatch(effr_corrente" in _blocco477
      # ⚠ la sonda e' la CHIAMATA, non la parola: la docstring di effr_giornaliero nomina FEDFUNDS
      #   per spiegare perche' non si usa, e la prima stesura la contava (il gate che trova se' stesso)
      and '"ZQ=F"' not in _blocco477 and 'fred_series("FEDFUNDS"' not in _blocco477
      and 'fred_series("FEDFUNDS"' not in _fn_effr and 'fred_series("EFFR"' in _fn_effr)
# la fonte nuova nasce sorvegliata (v390)
_dq477 = ud.validate_macro({})
_dq477b = ud.validate_macro({"fedwatch": {"effr": {"valore": 3.88, "data": "2026-01-02"}, "contratti": []}})
_dq477c = ud.validate_macro({"fedwatch": {"effr": {"valore": 3.88, "data": ud.datetime.now(ud.timezone.utc).date().isoformat()},
                                          "contratti": [{"simbolo": "ZQX26.CBT", "prezzo": None}]}})
_dq477d = ud.validate_macro({"fedwatch": {"effr": {"valore": 3.88, "data": ud.datetime.now(ud.timezone.utc).date().isoformat()},
                                          "contratti": [{"simbolo": "ZQX26.CBT", "prezzo": 96.06}]}})
_st = lambda dq: [c["status"] for c in dq["checks"] if c["key"] == "fedwatch"]
check("v477 FedWatch sorvegliato: assente -> missing, EFFR vecchio o contratto non letto -> stale, sano -> ok",
      _st(_dq477) == ["missing"] and _st(_dq477b) == ["stale"] and _st(_dq477c) == ["stale"]
      and any("ZQX26.CBT" in a for a in _dq477c["alerts"]) and _st(_dq477d) == ["ok"])

# ============================ v465 — SPREAD CCC ============================
# Lo stato si COSTRUISCE (v425): una serie con un minimo noto 60 sedute indietro.
_ser = [("2026-%03d" % i, 10.0) for i in range(80)]
_ser[30] = (_ser[30][0], 9.5)
_ser.append(("2026-999", 12.0))
_c = ud.credito_ccc(_ser)
check("v465 la salita CCC e' misurata dal minimo delle 60 sedute precedenti",
      _c["valore"] == 12.0 and _c["min_60"] == 9.5 and _c["salita_60_pp"] == 2.5)
_c2 = ud.credito_ccc([("a", 10.0)] * 30 + [("b", None), ("c", 11.0)])
check("v465 con meno di 60 sedute la salita e' un buco, non uno zero (v205)",
      _c2["salita_60_pp"] is None and _c2["min_60"] is None and _c2["valore"] == 11.0)
_c3 = ud.credito_ccc([("d%d" % i, 10.0) for i in range(70)] + [("ult", 8.0)])
check("v465 il minimo esclude il valore di oggi: uno spread che scende da' salita NEGATIVA",
      _c3["salita_60_pp"] == -2.0 and _c3["min_60"] == 10.0)
check("v465 serie vuota: nessun blocco, non un blocco finto", ud.credito_ccc([]) is None)
_dqc = ud.validate_macro({})
check("v465 senza spread CCC validate_macro alza 'missing' (la fonte nasce sorvegliata, v390)",
      any(isinstance(x, dict) and x.get("key") == "credito_ccc" and x.get("status") == "missing"
          for x in (_dqc.get("checks") or _dqc.get("items") or [])) or "credito_ccc" in str(_dqc))
check("v465 collegamento: la pipeline scrive macro['credit_ccc'] da BAMLH0A3HYC (v399)",
      'macro["credit_ccc"] = _ccc' in _SRC_UD_CODICE and 'fred_series("BAMLH0A3HYC"' in _SRC_UD_CODICE)

# ============================ v476 — LA LIQUIDITA' NON E' SOLO LA CASSA ============================
# La cassa si leggeva da "Cash And Cash Equivalents" e la voce coi titoli a breve era il RIPIEGO:
# su RGTI l'autonomia usciva 5,5 mesi con 393,7 milioni di liquidita' (27,8 di cassa + 366 di
# titoli a breve). Lo stato si COSTRUISCE con bilanci finti dalla forma di yfinance (voci in riga,
# trimestri in colonna, il piu' recente per primo): i dati del giorno possono non contenere il
# caso, e un check che li aspetta e' verde per assenza del fenomeno (v425, v429).
_c476 = [pd.Timestamp("2026-06-30"), pd.Timestamp("2026-03-31"), pd.Timestamp("2025-12-31"), pd.Timestamp("2025-09-30")]


class _T476:
    def __init__(self, bs, cf):
        self.quarterly_balance_sheet = bs
        self.quarterly_cashflow = cf


def _bil476(voci):
    return pd.DataFrame([v for v in voci.values()], index=list(voci.keys()), columns=_c476)


_cf476 = _bil476({"Operating Cash Flow": [-15.2e6, -15.2e6, -15.2e6, -15.1e6],
                  "Capital Expenditure": [-6.7e6, -6.7e6, -6.7e6, -6.8e6]})
_agg = ud.combustione(_T476(_bil476({
    "Cash And Cash Equivalents": [27.763e6, 48.15e6, 44.85e6, 26.13e6],
    "Cash Cash Equivalents And Short Term Investments": [393.709e6, 418.25e6, 443.51e6, 446.98e6],
    "Other Short Term Investments": [365.946e6, 370.1e6, 398.66e6, 420.85e6],
    "Total Debt": [7.701e6, 6.78e6, 7.17e6, 7.6e6]}), _cf476), None, None)
check("v476 con l'aggregato la liquidita' e' cassa + titoli a breve, e la cassa resta la cassa",
      _agg["liquidita"] == 393.709e6 and _agg["cassa"] == 27.763e6
      and abs(_agg["titoli_breve"] - (393.709e6 - 27.763e6)) < 1 and _agg["liquidita_base"] == "aggregato")
check("v476 l'autonomia e il debito netto si calcolano sulla LIQUIDITA', non sulla cassa",
      _agg["mesi_operativi"] == round(393.709e6 / (60.7e6 / 12.0), 1)
      and _agg["mesi_capex"] == round(393.709e6 / (26.9e6 / 12.0), 1)
      and abs(_agg["debito_netto"] - (7.701e6 - 393.709e6)) < 1)
check("v476 il caso RGTI: l'autonomia operativa non e' piu' 5,5 mesi ma oltre sei anni",
      _agg["mesi_operativi"] > 70 and round(27.763e6 / (60.7e6 / 12.0), 1) == 5.5)
_som = ud.combustione(_T476(_bil476({
    "Cash And Cash Equivalents": [100e6, 1, 1, 1],
    "Other Short Term Investments": [50e6, 1, 1, 1]}), _cf476), None, None)
check("v476 senza l'aggregato, la liquidita' e' la SOMMA delle due voci, e lo dichiara",
      _som["liquidita"] == 150e6 and _som["titoli_breve"] == 50e6 and _som["liquidita_base"] == "somma")
_sol = ud.combustione(_T476(_bil476({"Cash And Cash Equivalents": [100e6, 1, 1, 1]}), _cf476), None, None)
check("v476 con la sola cassa la base e' dichiarata 'solo_cassa' e i titoli a breve sono un buco, non uno zero",
      _sol["liquidita"] == 100e6 and _sol["liquidita_base"] == "solo_cassa" and "titoli_breve" not in _sol)
_inc = ud.combustione(_T476(_bil476({
    "Cash And Cash Equivalents": [100e6, 1, 1, 1],
    "Cash Cash Equivalents And Short Term Investments": [80e6, 1, 1, 1],
    "Other Short Term Investments": [30e6, 1, 1, 1]}), _cf476), None, None)
check("v476 un aggregato MINORE della cassa e' un errore della fonte: si ripiega sulla somma",
      _inc["liquidita"] == 130e6 and _inc["liquidita_base"] == "somma")
_soloagg = ud.combustione(_T476(_bil476({
    "Cash Cash Equivalents And Short Term Investments": [70e6, 1, 1, 1]}), _cf476), None, None)
check("v476 con il solo aggregato la liquidita' c'e' e la cassa resta un buco",
      _soloagg["liquidita"] == 70e6 and "cassa" not in _soloagg and _soloagg["liquidita_base"] == "aggregato"
      and _soloagg["bilancio_al"] == "2026-06-30")
check("v476 l'ordine non torna indietro: la cassa NON ha piu' l'aggregato come ripiego",
      '_riga_bilancio(bs, "Cash And Cash Equivalents",\n' not in _SRC_UD
      and '_riga_bilancio(bs, "Cash And Cash Equivalents")' in _SRC_UD_CODICE)

# ============================ v477 — GLI INVESTIMENTI NON SONO SEMPRE COSTRUZIONE ============================
# Su MSTR il 99,9% del capex sono acquisti di ATTIVITA' IMMATERIALI (21,7 mld contro 21 milioni di
# impianti) e il pacchetto scriveva "la liquidita' copre 1,4 mesi di INVESTIMENTI"; i dividendi
# sulle privilegiate (952 milioni in 12 mesi) stavano fuori da ogni denominatore. Lo stato si
# COSTRUISCE coi numeri veri del rendiconto di MSTR al 30/06/2026 (v425, v429).
_bs477 = _bil476({"Cash Cash Equivalents And Short Term Investments": [2448e6, 2207e6, 2301e6, 54e6],
                  "Cash And Cash Equivalents": [1712e6, 2207e6, 2301e6, 54e6]})
_cf477 = _bil476({"Operating Cash Flow": [-4.1e6, 14.0e6, -21.6e6, -8.3e6],
                  "Capital Expenditure": [-6422.7e6, -7252.1e6, -3094.7e6, -4959.9e6],
                  "Purchase Of PPE": [-1.8e6, -1.0e6, -10.6e6, -7.8e6],
                  "Purchase Of Intangibles": [-6420.9e6, -7251.1e6, -3084.1e6, -4952.1e6],
                  "Preferred Stock Dividend Paid": [-399.6e6, -229.5e6, -183.4e6, -139.8e6]})
_m477 = ud.combustione(_T476(_bs477, _cf477), None, None)
_imp477, _imm477 = -21.2e6, -21708.2e6
check("v477 la scomposizione impianti/immateriali esce quando SOMMA al totale, con la quota dichiarata",
      abs(_m477.get("capex_impianti_ttm", 0) - _imp477) < 1 and abs(_m477.get("capex_immateriali_ttm", 0) - _imm477) < 1
      and _m477.get("quota_immateriali_pct") == 99.9 and _m477.get("investimenti_immateriali_prevalenti") is True)
check("v477 con gli immateriali prevalenti c'e' l'autonomia sui soli IMPIANTI, accanto a quella sul capex",
      _m477.get("mesi_impianti") == round(2448e6 / (21.2e6 / 12.0), 1)
      and _m477.get("mesi_capex") == round(2448e6 / (21729.4e6 / 12.0), 1))
check("v477 capex e flusso libero NON cambiano definizione: il segno decide chi dipende dal credito (v404)",
      abs(_m477["capex_ttm"] - (-21729.4e6)) < 1 and abs(_m477["fcf_ttm"] - (-20.0e6 - 21729.4e6)) < 1)
check("v477 i dividendi sulle privilegiate escono col loro ultimo trimestre, e l'autonomia sulle DUE uscite",
      abs(_m477.get("dividendi_privilegiate_ttm", 0) - (-952.3e6)) < 1
      and _m477.get("dividendi_privilegiate_ultimo_trim") == -399.6e6
      and _m477.get("dividendi_privilegiate_trimestri") == 4
      and _m477.get("mesi_obblighi") == round(2448e6 / ((952.3e6 + 20.0e6) / 12.0), 1))
_nt477 = ud.combustione(_T476(_bs477, _bil476({
    "Operating Cash Flow": [10e6] * 4, "Capital Expenditure": [-100e6] * 4,
    "Purchase Of PPE": [-10e6] * 4, "Purchase Of Intangibles": [-50e6] * 4})), None, None)
check("v477 una scomposizione che NON somma al totale si tace: due voci che non tornano si contraddicono",
      "capex_impianti_ttm" not in _nt477 and "quota_immateriali_pct" not in _nt477
      and "investimenti_immateriali_prevalenti" not in _nt477)
_mr477 = ud.combustione(_T476(_bs477, _bil476({
    "Operating Cash Flow": [550e6] * 4, "Capital Expenditure": [-119.375e6] * 4,
    "Purchase Of PPE": [-117.55e6] * 4, "Purchase Of Intangibles": [-1.825e6] * 4})), None, None)
check("v477 sotto la meta' gli immateriali si dichiarano ma la lettura non cambia (il caso MRVL, 1,5%)",
      _mr477.get("quota_immateriali_pct") == 1.5 and "investimenti_immateriali_prevalenti" not in _mr477
      and "mesi_impianti" not in _mr477)
_cr477 = ud.combustione(_T476(_bs477, _bil476({
    "Operating Cash Flow": [1.7e9] * 4, "Capital Expenditure": [-5e9] * 4, "Purchase Of PPE": [-5e9] * 4})), None, None)
check("v477 senza la voce degli immateriali (quasi tutto il libro) nessuna scomposizione e nessun campo nuovo",
      not any(k in _cr477 for k in ("capex_impianti_ttm", "capex_immateriali_ttm", "quota_immateriali_pct",
                                    "mesi_impianti", "dividendi_privilegiate_ttm", "mesi_obblighi")))
_wd477 = ud.combustione(_T476(_bs477, _bil476({
    "Operating Cash Flow": [1e9] * 4, "Capital Expenditure": [-100e6] * 4,
    "Preferred Stock Dividend Paid": [-2.5e6] * 4})), None, None)
check("v477 se la gestione copre i dividendi, i dividendi si pubblicano e l'autonomia sulle due uscite no",
      _wd477.get("dividendi_privilegiate_ttm") == -10e6 and "mesi_obblighi" not in _wd477)
_tr477 = ud.combustione(_T476(_bs477, _bil476({
    "Operating Cash Flow": [-5e6, -5e6, -5e6, -5e6], "Capital Expenditure": [-1e6] * 4,
    "Preferred Stock Dividend Paid": [-100e6, -80e6, None, None]})), None, None)
check("v477 con meno di quattro trimestri di dividendi il totale dichiara quanti sono e l'autonomia tace",
      _tr477.get("dividendi_privilegiate_trimestri") == 2 and "mesi_obblighi" not in _tr477)

# ═══ v492 — LA FINE DEL VEICOLO DI QUOTAZIONE (SPAC), DAL REGISTRO SEC ════════════════════════════════════════
# La lettura a 5 anni chiesta dal CEO taglia la serie dove il titolo ha smesso di essere un veicolo: su OKLO lo storico
# della fonte comincia con AltC Acquisition Corp. Il fatto viene dall'8-K con item 5.06 ("Change in Shell Company Status"),
# non da un'euristica sul prezzo. Gli stati si costruiscono: nessuna rete.
from datetime import date as _date492
_o492 = {"formerNames": [{"name": "AltC Acquisition Corp.", "to": "2024-05-08T00:00:00.000Z"}],
         "filings": {"recent": {"form": ["10-Q", "8-K", "8-K", "S-1"],
                                "filingDate": ["2026-08-10", "2024-05-13", "2023-07-11", "2021-03-15"],
                                "reportDate": ["2026-06-30", "2024-05-09", "2023-07-11", ""],
                                "items": ["", "1.01,2.01,3.03,5.06,9.01", "8.01", ""]}}}
check("v492 storia della quotazione: l'8-K con item 5.06 da' la fine del veicolo (la data del fatto) e la data del deposito",
      ud.storia_quotazione(_o492, oggi=_date492(2026, 10, 16)) == {"fine_veicolo": "2024-05-09", "deposito": "2024-05-13"})
_due492 = {"filings": {"recent": {"form": ["8-K", "8-K"], "filingDate": ["2025-02-03", "2022-03-07"],
                                  "reportDate": ["2025-02-01", "2022-03-01"], "items": ["5.06", "5.06"]}}}
check("v492 con due 8-K 5.06 vince il piu' recente: la pagina recente di EDGAR va dal piu' recente al piu' vecchio",
      ud.storia_quotazione(_due492, oggi=_date492(2026, 10, 16))["fine_veicolo"] == "2025-02-01")
_mu492 = {"formerNames": [], "filings": {"recent": {"form": ["8-K", "10-K"], "filingDate": ["2026-09-30", "2017-09-06"],
                                                    "reportDate": ["", ""], "items": ["2.02", ""]}}}
_jo492 = {"formerNames": [{"name": "Reinvent Technology Partners", "to": "2022-08-06T00:00:00.000Z"}],
          "filings": {"recent": {"form": ["8-K", "4"], "filingDate": ["2026-09-30", "2023-07-06"],
                                 "reportDate": ["", ""], "items": ["2.02", ""]}}}
_mr492 = {"formerNames": [{"name": "MICROSTRATEGY INC", "to": "2025-08-11T00:00:00.000Z"}],
          "filings": {"recent": {"form": ["8-K", "4"], "filingDate": ["2026-09-30", "2023-07-06"],
                                 "reportDate": ["", ""], "items": ["2.02", ""]}}}
check("v492 senza 5.06: verificato se i depositi letti coprono i cinque anni, o se nessun cambio di nome cade nella parte "
      "non coperta (un cambio dopo i depositi letti e' coperto); NON verificabile se un cambio di nome cade prima dei "
      "depositi letti — chi esce da un veicolo cambia nome, e li' un 5.06 non si escluderebbe",
      ud.storia_quotazione(_mu492, oggi=_date492(2026, 10, 16)) == {"fine_veicolo": None, "verificato_dal": "2017-09-06"}
      and "non_verificabile" in ud.storia_quotazione(_jo492, oggi=_date492(2026, 10, 16))
      and ud.storia_quotazione(_mr492, oggi=_date492(2026, 10, 16)) == {"fine_veicolo": None, "verificato_dal": "2023-07-06"})
check("v492 un emittente estero (6-K e 20-F, nessun 8-K) e una risposta vuota si dichiarano non verificabili, non "
      "'nessun veicolo'",
      "6-K e 20-F" in ud.storia_quotazione({"filings": {"recent": {"form": ["6-K", "20-F"],
                                                                     "filingDate": ["2026-09-30", "2026-03-24"]}}}
                                            , oggi=_date492(2026, 10, 16)).get("non_verificabile", "")
      and "non_verificabile" in ud.storia_quotazione({}, oggi=_date492(2026, 10, 16)))
_sec492 = _SRC_UD_CODICE[_SRC_UD_CODICE.find("sec_cal, senza_cik, esteri = {}, [], []"):]
_sec492 = _sec492[:_sec492.find("calendario_uscite_fred(STORICO_IND)")]
check("v492 collegamento: il giro del calendario EDGAR passa ogni risposta letta a storia_quotazione PRIMA del filtro degli "
      "esteri, e la pubblica in sec_calendario.storia_quotazione anche quando non ci sono trimestrali",
      "storia[_tk] = storia_quotazione(_sub)" in _sec492
      and _sec492.find("storia[_tk] = storia_quotazione(_sub)") < _sec492.find("esteri.append(_tk)")
      # v500 — RIAGGANCIATO all'argomento, non ai due punti: la condizione ora comprende anche le ore dei depositi
      and '"storia_quotazione": {"per_titolo": storia' in _sec492 and "if sec_cal or esteri or storia" in _sec492)

# ======================== v496 — LA VARIAZIONE ANNUA DELLA LEVA DAL FILE STORICO FINRA ========================
# Il CEO, 17/10/2026: «Recupera altrove dati variazione annua della leva». La tabella della pagina FINRA si e'
# accorciata a 12 mesi (v493) e il mese di un anno fa non c'era piu'. Il file storico che la pagina linka
# (xlsx, dal 1997) lo ha: la serie diventa DATATA e ogni confronto si fa per data (v207, v393).
import zipfile as _zf496, io as _io496
from datetime import date as _d496


def _xlsx496(righe, condivise=None):
    """Un xlsx minimale: righe = [[(colonna, valore, tipo)]], tipo 'is' in linea, 's' condivisa, 'n' numero."""
    buf = _io496.BytesIO()
    with _zf496.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        xr = []
        for i, celle in enumerate(righe, start=1):
            cs = []
            for col, v, t in celle:
                if t == "is":
                    cs.append(f'<c r="{col}{i}" s="2" t="inlineStr"><is><t>{v}</t></is></c>')
                elif t == "s":
                    cs.append(f'<c r="{col}{i}" t="s"><v>{v}</v></c>')
                else:
                    cs.append(f'<c r="{col}{i}" s="5"><v>{v}</v></c>')
            xr.append(f'<row outlineLevel="0" r="{i}">' + "".join(cs) + "</row>")
        z.writestr("xl/worksheets/sheet1.xml", "<worksheet><sheetData>" + "".join(xr) + "</sheetData></worksheet>")
        if condivise is not None:
            z.writestr("xl/sharedStrings.xml", "<sst>" + "".join(f"<si><t>{s}</t></si>" for s in condivise) + "</sst>")
    return buf.getvalue()


_hdr496 = [("A", "Free Credit Balances in Customers' Cash Accounts", "is"), ("B", "Year-Month", "is"),
           ("D", "Debit Balances in Customers' Securities Margin Accounts", "is")]
_x496 = _xlsx496([_hdr496, [("A", "215328", "n"), ("B", "2026-09", "is"), ("D", "1480054", "n")],
                  [("A", "207641", "n"), ("B", "2026-08", "is"), ("D", "1453832", "n")]])
check("v496 il file storico FINRA si legge per INTESTAZIONE: con le colonne riordinate (mese in B, debito in D) la "
      "serie e' quella del debito, in ordine di data, mai la colonna che sta in seconda posizione",
      ud._finra_xlsx_righe(_x496) == [("2026-08-01", 1453832.0), ("2026-09-01", 1480054.0)])
_ser496 = (_d496(2026, 9, 1) - _d496(1899, 12, 30)).days
_xs496 = _xlsx496([[("A", "0", "s"), ("B", "1", "s")], [("A", str(_ser496), "n"), ("B", "1480054", "n")]],
                  condivise=["Year-Month", "Debit Balances in Customers' Securities Margin Accounts"])
check("v496 il parser regge stringhe CONDIVISE e un mese scritto come data seriale Excel",
      ud._finra_xlsx_righe(_xs496) == [("2026-09-01", 1480054.0)])
_senza496 = _xlsx496([[("A", "Mese", "is"), ("B", "Valore", "is")], [("A", "2026-09", "is"), ("B", "1", "n")]])
try:
    ud._finra_xlsx_righe(_senza496)
    _err496 = None
except ValueError as _e496:
    _err496 = str(_e496)
check("v496 senza le intestazioni attese il parser si FERMA e lo dice: una colonna indovinata sarebbe un numero "
      "plausibile e falso", _err496 is not None and "intestazioni" in _err496)

# una serie con un BUCO a marzo 2026, FRA la base e il mese corrente: per posizione il «mese di un anno fa»
# sarebbe agosto 2025 (un buco prima della base non sposta niente, e il check non discriminerebbe)
_mesi496 = [ud._mese_spostato("2024-01-01", i) for i in range(33)]          # 2024-01 … 2026-09
_fs496 = [(m, 1_000_000.0 + 10_000 * i) for i, m in enumerate(_mesi496) if m != "2026-03-01"]
_gdp496 = ud._margin_vs_gdp
ud._margin_vs_gdp = lambda cur: (None, None, None)
_md496 = ud._margin_da_serie(_fs496, {"mesi_storico": len(_fs496)}, "file")
_dz496 = dict(_fs496)
check("v496 la variazione ANNUA si calcola per DATA: settembre 2026 contro settembre 2025, anche con un mese mancante "
      "nello storico (per posizione sarebbe agosto 2025: la classe v393 dell'inflazione su 13 mesi)",
      _md496["yoy"] == round((_dz496["2026-09-01"] / _dz496["2025-09-01"] - 1) * 100, 1)
      and _md496["yoy"] != round((_fs496[-1][1] / _fs496[-13][1] - 1) * 100, 1)
      and _md496["yoy_base"] == {"date": "2025-09-01", "value": round(_dz496["2025-09-01"])})
_fsb496 = [(m, v) for m, v in _fs496 if m != "2026-08-01"]
_mdb496 = ud._margin_da_serie(_fsb496, {}, "file")
check("v496 la variazione MENSILE per data: senza il mese prima e' un buco, non il confronto con due mesi fa",
      _mdb496["qoq"] is None and _md496["qoq"] == round((_dz496["2026-09-01"] / _dz496["2026-08-01"] - 1) * 100, 1))
_annue496 = [(v / _dz496[ud._mese_spostato(d, -12)] - 1) * 100 for d, v in _fs496 if ud._mese_spostato(d, -12) in _dz496]
check("v496 il percentile della variazione annua e' calcolato su TUTTE le variazioni annue dello storico (per data), e "
      "il campione e' dichiarato col suo inizio e la sua fine",
      _md496["yoy_rango"] == int(ud._rango_midrank(_annue496[-1], _annue496) + 0.5)
      and _md496["yoy_campione"] == {"n": len(_annue496), "dal": "2025-01-01", "al": "2026-09-01"}
      and _md496["yoy_max"]["date"] in _dz496)
import rotazione as _rot496
_griglia496 = [3.0, 1.0, 2.0, 2.0, 5.0, -1.0, 2.0]
check("v496 il percentile della pipeline usa la convenzione midrank di rotazione.percentile_midrank (e di dgPercentile): "
      "due implementazioni della stessa formula non possono divergere (v161)",
      all(abs(ud._rango_midrank(x, _griglia496) - _rot496.percentile_midrank(x, _griglia496)) < 1e-9
          for x in (-2.0, -1.0, 0.5, 2.0, 2.5, 5.0, 9.0)))
_lunga496 = [(ud._mese_spostato("2010-01-01", i), 500_000.0 + i) for i in range(131)]
_lunga496[60] = (_lunga496[60][0], 900_000.0)        # sotto il pavimento documentato: e' il caso che discrimina
_mdl496 = ud._margin_da_serie(_lunga496, {}, "file")
_corta496 = [(ud._mese_spostato("2025-10-01", i), 900_000.0 + i) for i in range(12)]
_mdc496 = ud._margin_da_serie(_corta496, {}, None)
check("v496 con lo storico lungo il massimo si LEGGE dallo storico (data e valore); con la sola tabella di 12 mesi resta "
      "il pavimento documentato di ottobre 2021",
      _mdl496["peak"] == 900_000 and _mdl496["peak_date"] == _lunga496[60][0]
      and _mdc496["peak"] == 935904 and _mdc496["peak_date"] == "2021-10-01" and _mdc496["storico_mesi"] == 12)
_un496, _info496 = ud._unisci_finra([("2026-07-01", 10.0), ("2026-08-01", 20.0)],
                                    [("2026-08-01", 21.0), ("2026-09-01", 30.0)])
check("v496 file e tabella si uniscono per data: la tabella (cio' che la pagina mostra adesso) vale sui mesi in comune e "
      "completa quelli che il file non ha ancora; un mese in cui discordano si CONTA",
      _un496 == [("2026-07-01", 10.0), ("2026-08-01", 21.0), ("2026-09-01", 30.0)]
      and _info496["discordi"] == ["2026-08-01"] and _info496["dalla_tabella"] == ["2026-09-01"])

# i tre esiti della catena, con le fonti finte (la rete non entra nei test)
_scr496, _sto496 = ud._finra_scrape, ud._finra_storico
_ko496 = lambda url: (_ for _ in ()).throw(RuntimeError("403 simulato"))
# una distribuzione che discrimina: vent'anni di crescita forte (+3% al mese), poi otto di crescita lenta, poi un anno
# a +1,5% al mese. Sull'intero storico l'ultima variazione annua sta a meta'; sugli ultimi dieci anni starebbe in cima.
_v496, _lungo496 = 1_000_000.0, []
for _i496 in range(357):
    _lungo496.append((ud._mese_spostato("1997-01-01", _i496), _v496))
    _v496 *= 1.03 if _i496 < 200 else (1.004 if _i496 < 344 else 1.015)
ud._finra_scrape, ud._finra_storico = _ko496, (lambda url: (_lungo496, "https://www.finra.org/x.xlsx"))
_solo_file496 = ud.fetch_margin_debt(None)
ud._finra_scrape, ud._finra_storico = (lambda url: _lungo496[-12:]), _ko496
_solo_tab496 = ud._margin_da_serie(*ud._unisci_finra([], _lungo496[-12:]), None)
_solo_tab496b = ud.fetch_margin_debt(None)
ud._finra_scrape, ud._finra_storico = _scr496, _sto496
ud._margin_vs_gdp = _gdp496
check("v496 se la tabella della pagina non risponde ma il file storico si', la leva e' quella del file — FINRA, non un "
      "dato riportato dal run precedente — e la variazione annua c'e'",
      _solo_file496 is not None and not _solo_file496.get("carried") and _solo_file496.get("yoy") is not None
      and _solo_file496.get("fonte_storico") == "https://www.finra.org/x.xlsx" and _solo_file496["storico_mesi"] == 357)
_dzl496 = dict(_lungo496)
_annl496 = [(v / _dzl496[ud._mese_spostato(d, -12)] - 1) * 100 for d, v in _lungo496 if ud._mese_spostato(d, -12) in _dzl496]
check("v496 il percentile della variazione annua sta sull'INTERO storico del file (345 variazioni dal 1998), non su "
      "una finestra recente: sugli ultimi dieci anni la stessa lettura starebbe in cima alla distribuzione",
      _solo_file496["yoy_campione"]["n"] == 345 == len(_annl496)
      and _solo_file496["yoy_rango"] == int(ud._rango_midrank(_annl496[-1], _annl496) + 0.5)
      and abs(_solo_file496["yoy_rango"] - ud._rango_midrank(_annl496[-1], _annl496[-120:])) > 20)
_vm496 = ud.validate_macro({"margin_debt": _solo_tab496b})
_vmok496 = ud.validate_macro({"margin_debt": _solo_file496})
_c496 = lambda v: next((c for c in v["checks"] if c["key"] == "margin_debt_storico"), {})
check("v496 senza il file storico (la sola tabella di 12 mesi) la variazione annua e' un buco e il gate SUONA "
      "(margin_debt_storico missing → avviso nel CI): un canale che muore in silenzio e' la classe v389",
      _solo_tab496b is not None and _solo_tab496b.get("yoy") is None and _c496(_vm496).get("status") == "missing"
      and any(a.startswith("margin_debt_storico") for a in _vm496["alerts"])
      and _c496(_vmok496).get("status") == "ok")

# il link al file si legge DALLA PAGINA: e' la fonte a dire dove sta (il percorso noto e' la riserva)
_get496 = ud.requests.get
class _R496:
    def __init__(self, testo=None, contenuto=b""):
        self.text, self.content = testo, contenuto
    def raise_for_status(self):
        return None
_chieste496 = []
def _fake496(url, headers=None, timeout=None):
    _chieste496.append(url)
    if url.endswith(".xlsx"):
        return _R496(contenuto=_x496)
    return _R496(testo='<a class="download-margin-statistics" href="/sites/default/files/2027-01/margin-statistics.xlsx">x</a>')
ud.requests.get = _fake496
try:
    _st496, _u496 = ud._finra_storico("https://www.finra.org/pagina")
    ud.requests.get = lambda url, headers=None, timeout=None: (_chieste496.append(url) or
                                                               (_R496(contenuto=_x496) if url.endswith(".xlsx")
                                                                else _R496(testo="<p>nessun link</p>")))
    _st496b, _u496b = ud._finra_storico("https://www.finra.org/pagina")
finally:
    ud.requests.get = _get496
check("v496 il file si scarica dal link che la PAGINA dichiara; senza link, dal percorso noto dichiarato come riserva; "
      "lo stesso UA della tabella (l'Akamai di finra.org)",
      _u496 == "https://www.finra.org/sites/default/files/2027-01/margin-statistics.xlsx"
      and _u496b == ud.FINRA_XLSX_RISERVA and len(_st496) == 2 and _st496b == _st496)
_corpo496 = _SRC_UD_CODICE[_SRC_UD_CODICE.find("def _finra_storico("):]
_corpo496 = _corpo496[:_corpo496.find("\ndef ", 10)]
check("v496 il file storico usa lo stesso UA della tabella (FINRA_UA): un UA da browser con Accept prende 403 dall'Akamai",
      _corpo496.count("headers=FINRA_UA") == 2 and '"Accept"' not in _corpo496)


# ======================== v497 — CDS A 5 ANNI DA ICE CLEAR CREDIT ========================
# La conversione prezzo → spread si prova sulla PROPRIETA' che una formula o un tasso sbagliati non
# soddisfano per caso (v326): la stessa societa' quotata con due cedole diverse deve uscire allo stesso
# spread. I prezzi sono quelli VERI pubblicati da ICE il 16/10/2026: non una fixture costruita dal
# modello stesso, che sarebbe circolare.
from datetime import datetime as _dt497, timedelta as _td497
import json as _json497
import tempfile as _tmp497
_t0_497, _m497 = _dt497(2026, 10, 16).date(), _dt497(2031, 12, 20).date()
_veri497 = {"TESLINC": (96.2354, 113.7985), "AMD": (99.7893, 117.8253), "NFLX": (102.0701, 120.3902),
            "CONSENAG": (100.9804, 119.1786)}
_scarti497 = {k: abs(ud.spread_cds(a, 100, _t0_497, _m497, 0.0388) - ud.spread_cds(b, 500, _t0_497, _m497, 0.0388))
              for k, (a, b) in _veri497.items()}
check("v497 la stessa societa' con due cedole esce allo stesso spread (prezzi veri ICE del 16/10, entro 5 pb): "
      "se modello o tasso fossero sbagliati, le due cedole darebbero due spread " + str({k: round(v, 1) for k, v in _scarti497.items()}),
      all(v <= 5 for v in _scarti497.values()))
check("v497 a prezzo 100 lo spread E' la cedola (cedola 100 e 500): il prezzo pubblicato e' pulito",
      abs(ud.spread_cds(100, 100, _t0_497, _m497, 0.0388) - 100) < 0.01
      and abs(ud.spread_cds(100, 500, _t0_497, _m497, 0.0388) - 500) < 0.01)
_mono497 = [ud.spread_cds(p, 100, _t0_497, _m497, 0.0388) for p in (104, 102, 100, 97, 92, 85)]
check("v497 piu' basso il prezzo, piu' alto lo spread (monotono): " + str([round(x) for x in _mono497]),
      all(a < b for a, b in zip(_mono497, _mono497[1:])))
check("v497 fuori dal dominio del modello lo spread e' None, non un numero: un prezzo che nessuna intensita' di default "
      "riproduce, un tasso mancante, una scadenza passata",
      ud.spread_cds(20, 500, _t0_497, _m497, 0.0388) is None and ud.spread_cds(99, 100, _t0_497, _m497, None) is None
      and ud.spread_cds(99, 100, _t0_497, _t0_497, 0.0388) is None and ud.spread_cds("x", 100, _t0_497, _m497, 0.0388) is None)

# --- il contratto standard: una scelta dichiarata, verificata sui casi che la distinguono
def _c497(cod, liv, val, cl, ced, pz):
    return {"codice": cod, "livello": liv, "valuta": val, "clausola": cl, "cedola": ced, "prezzo": pz, "scadenza": _m497}
_sc497 = ud.contratto_standard([_c497("X", "SNRFOR", "USD", "CR14", 100, 99.0), _c497("X", "SNRFOR", "USD", "XR14", 100, 98.0),
                                _c497("X", "SNRFOR", "EUR", "MM14", 100, 100.0), _c497("X", "SUBLT2", "USD", "XR14", 100, 100.0)])
_it497 = ud.contratto_standard([_c497("I", "SNRFOR", "USD", "CR", 100, 103.18), _c497("I", "SNRFOR", "USD", "CR", 25, 99.72),
                                _c497("I", "SNRFOR", "USD", "CR14", 100, 101.67), _c497("I", "SNRFOR", "USD", "CR14", 25, 98.25)])
_te497 = ud.contratto_standard([_c497("T", "SNRFOR", "USD", "XR14", 100, 96.2354), _c497("T", "SNRFOR", "USD", "XR14", 500, 113.7985)])
check("v497 contratto standard: senior in dollari, XR14 prima di CR14, definizioni 2014 prima delle 2003, e la cedola "
      "col prezzo piu' vicino a 100 — mai l'euro, mai il subordinato",
      _sc497["clausola"] == "XR14" and _sc497["valuta"] == "USD" and _sc497["livello"] == "SNRFOR"
      and _it497["clausola"] == "CR14" and _it497["cedola"] == 100 and _te497["cedola"] == 100
      and ud.contratto_standard([_c497("E", "SNRFOR", "EUR", "MM14", 100, 100.0)]) is None)
_s497 = ud._cds_strumento("ORCLE.SNRFOR.USD.XR14.100.2031-12-20")
check("v497 il nome dello strumento si legge dalla FORMA: codice, livello, valuta, clausola, cedola, scadenza; una forma "
      "diversa e' None, non un contratto inventato",
      _s497 == {"codice": "ORCLE", "livello": "SNRFOR", "valuta": "USD", "clausola": "XR14", "cedola": 100, "scadenza": _m497}
      and ud._cds_strumento("CDX-NAIGS47V1-5Y") is None and ud._cds_strumento("A.B.C.D.cento.2031-12-20") is None)

# --- la lettura di ICE con una get finta: un giorno solo, gli indici in corso dalla forma del nome
class _R497:
    def __init__(self, dati):
        self._d = dati
    def json(self):
        return self._d
_nomi497 = [
    {"clearingDate": "2026-10-16", "eodPrice": "91.7580", "instrumentName": "ORCLE.SNRFOR.USD.XR14.100.2031-12-20", "name": "Oracle Cop"},
    {"clearingDate": "2026-10-16", "eodPrice": "80.9439", "instrumentName": "COREWEI.SNRFOR.USD.XR14.500.2031-12-20", "name": "COREWEAVE INC"},
    {"clearingDate": "2026-10-16", "eodPrice": "101.6710", "instrumentName": "ITALY.SNRFOR.USD.CR14.100.2031-12-20", "name": "Rep Italy"},
    {"clearingDate": "2026-10-16", "eodPrice": "99.1000", "instrumentName": "MICRONT.SNRFOR.USD.XR14.100.2031-12-20", "name": "Micron Technology Inc"},
    {"clearingDate": "2026-10-16", "eodPrice": "98.0000", "instrumentName": "BDK.SNRFOR.USD.XR14.100.2031-12-20", "name": "Black & Decker Corp"},
    {"clearingDate": "2026-10-15", "eodPrice": "50.0000", "instrumentName": "VECCHIO.SNRFOR.USD.XR14.100.2031-12-20", "name": "Giorno prima"},
]
_idx497 = [
    {"clearingDate": "2026-10-16", "eodPrice": "101.6004", "instrumentName": "CDX-NAIGS46V1-5Y"},
    {"clearingDate": "2026-10-16", "eodPrice": "101.7081", "instrumentName": "CDX-NAIGS47V1-5Y"},
    {"clearingDate": "2026-10-16", "eodPrice": "101.7335", "instrumentName": "CDX-NAIGS47V1-3Y"},
    {"clearingDate": "2026-10-16", "eodPrice": "105.8411", "instrumentName": "CDX-NAHYS47V1-5Y"},
    {"clearingDate": "2026-10-16", "eodPrice": "105.0000", "instrumentName": "CDX-NAHYS46V3-5Y"},
    {"clearingDate": "2026-10-16", "eodPrice": "99.0000", "instrumentName": "CDX-EMHYS46V1-5Y"},
]
_get497 = lambda u: _R497(_nomi497 if u == ud.ICE_CDS_NOMI else _idx497)
_l497 = ud.leggi_cds_ice(_get497)
check("v497 la lettura tiene UN giorno solo (il piu' recente): un contratto di un altro giorno non entra nella "
      "fotografia, e si conta come scartato",
      _l497["data"] == "2026-10-16" and "VECCHIO" not in _l497["entita"] and _l497["scartati"] == 1
      and _l497["scadenza"] == _m497 and _l497["entita"]["ORCLE"]["nome"] == "Oracle Cop")
check("v497 gli indici in corso si scelgono dalla FORMA del nome (serie e versione piu' alte, solo 5 anni, solo Nord "
      "America), con la cedola del contratto: 100 l'IG, 500 l'HY",
      _l497["indici"].get("IG", {}).get("serie") == 47 and _l497["indici"]["IG"]["prezzo"] == 101.7081
      and _l497["indici"].get("HY", {}).get("serie") == 47 and _l497["indici"]["HY"]["prezzo"] == 105.8411
      and _l497["indici"]["IG"]["cedola"] == 100 and _l497["indici"]["HY"]["cedola"] == 500 and set(_l497["indici"]) == {"IG", "HY"})

# --- lo storico: un giorno per riga, mai riscritto, mai all'indietro, con un tetto
def _riga497(d, p, r=3.88, i=None):
    return {"d": d, "m": "2031-12-20", "r": r, "p": p, "i": i or {}}
_st497, _n1 = ud.aggiungi_storia_cds([], _riga497("2026-10-15", {"ORCLE": [100, 92.5]}))
_st497, _n2 = ud.aggiungi_storia_cds(_st497, _riga497("2026-10-15", {"ORCLE": [100, 90.0]}))
_st497, _n3 = ud.aggiungi_storia_cds(_st497, _riga497("2026-10-14", {"ORCLE": [100, 93.0]}))
_st497, _n4 = ud.aggiungi_storia_cds(_st497, _riga497("2026-10-16", {"ORCLE": [100, 91.758]}))
_cap497 = []
for _g in range(10):
    _cap497, _ = ud.aggiungi_storia_cds(_cap497, _riga497(f"2026-09-{10 + _g:02d}", {}), massimo=4)
check("v497 storico: lo stesso giorno non si riscrive (e' la stessa pubblicazione), un giorno piu' vecchio "
      "dell'ultimo non entra, e il tetto tiene gli ultimi",
      _n1 and not _n2 and not _n3 and _n4 and [r["d"] for r in _st497] == ["2026-10-15", "2026-10-16"]
      and _st497[0]["p"]["ORCLE"][1] == 92.5 and len(_cap497) == 4 and _cap497[-1]["d"] == "2026-09-19")
with _tmp497.TemporaryDirectory() as _dir497:
    _f497 = Path(_dir497) / "cds.jsonl"
    ud.scrivi_storia_cds(_st497, _f497)
    _rl497 = ud.leggi_storia_cds(_f497)
    _f497.write_text(_f497.read_text() + "riga rotta\n")
    _rl497b = ud.leggi_storia_cds(_f497)
check("v497 storico su file: andata e ritorno identici, una riga illeggibile si salta senza perdere le altre, "
      "un file che non c'e' e' uno storico vuoto",
      _rl497 == _st497 and _rl497b == _st497 and ud.leggi_storia_cds(Path("/non/esiste.jsonl")) == [])

# --- le variazioni per DATA: la base e' un giorno, e un giorno senza il nome e' un buco (v205, v207)
_lin497 = [_riga497("2026-10-0" + str(g), {"ORCLE": [100, 95.0 - g * 0.5]} if g != 3 else {"ALTRO": [100, 100.0]})
           for g in range(1, 8)]
_ser497 = ud.serie_cds(_lin497, "ORCLE")
_var497 = ud.variazioni_cds(_lin497, _ser497, sedute=(1, 4, 5))
check("v497 la variazione si misura per DATA: 1 giorno ha la sua base, 4 giorni cade sul giorno in cui il nome manca "
      "e resta un buco, non uno zero; la base viaggia col numero",
      [d for d, _ in _ser497] == ["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]
      and _var497["1"]["pb"] is not None and _var497["1"]["pb"] > 0 and _var497["1"]["da"] == "2026-10-06"
      and _var497["4"] == {"da": "2026-10-03", "pb": None} and _var497["5"]["da"] == "2026-10-02")
_ind497 = [_riga497("2026-09-1" + str(g), {}, i={"IG": [46 if g < 3 else 47, 1, 100, 101.0 + g * 0.1]}) for g in range(5)]
_vi497 = ud.variazioni_cds(_ind497, ud.serie_indice_cds(_ind497, "IG"), sedute=(1, 3))
check("v497 un indice a cavallo del cambio di serie non ha una variazione: il paniere e' cambiato",
      _vi497["1"]["pb"] is not None and _vi497["3"]["pb"] is None and "serie" in _vi497["3"].get("nota", ""))

# --- i quattro stati, ciascuno dichiarato (v406), e l'abbinamento SCRITTO
_mappa497 = {"verificato": "2026-10-17", "entita": {"ORCL": "ORCLE", "CRWV": "COREWEI", "MU": None, "BLK": None,
                                                    "SPCX": "SPACEXP", "BTP-V28": "ITALY"},
             "note": {"ORCL": "ICE scrive il nome 'Oracle Cop': e' Oracle Corporation"}}
_righe497 = [{"ticker": "ORCL", "name": "Oracle Corporation"}, {"ticker": "CRWV", "name": "CoreWeave, Inc."},
             {"ticker": "MU", "name": "Micron Technology, Inc."}, {"ticker": "BLK", "name": "BlackRock, Inc."},
             {"ticker": "SPCX", "name": "Space Exploration Technologies Corp."}, {"ticker": "NUOVO", "name": "Nuova Spa"},
             {"ticker": "BTP-V28", "name": "BTP Valore Ott 2028"}, {"ticker": "^VIX"}, {"ticker": "EURUSD=X"},
             {"ticker": "BTC-USD"}]
_storia497 = [ud.riga_storia_cds(_l497, 3.88)]
_stati497, _indici497 = ud.cds_dei_titoli(_righe497, _l497, _storia497, _mappa497)
_c497r = {r["ticker"]: r.get("cds") for r in _righe497}
check("v497 quattro stati: quotato (ORCL, CRWV, il BTP sulla Repubblica Italiana), assente (MU, BLK), non quotato "
      "oggi (SPCX abbinato ma assente dal giorno), NON CLASSIFICATO (un titolo che l'abbinamento non nomina); i "
      "riferimenti (indici, cambi, criptovalute) si saltano dalla forma del simbolo",
      _c497r["ORCL"]["stato"] == "quotato" and _c497r["CRWV"]["stato"] == "quotato" and _c497r["BTP-V28"]["stato"] == "quotato"
      and _c497r["MU"]["stato"] == "assente" and _c497r["BLK"]["stato"] == "assente"
      and _c497r["SPCX"]["stato"] == "non quotato oggi" and _c497r["NUOVO"]["stato"] == "non classificato"
      and _c497r["^VIX"] is None and _c497r["EURUSD=X"] is None and _c497r["BTC-USD"] is None
      and _stati497.get("non_classificati") == ["NUOVO"] and _stati497.get("assenti") == ["BLK", "MU"])
check("v497 un'assenza dichiarata non invecchia in silenzio: se ICE compensa un nome con lo stesso PRIMO nome esatto "
      "(almeno 4 lettere) lo segnala, SENZA abbinarlo — e BlackRock non diventa Black & Decker",
      _c497r["MU"].get("candidati") == ["Micron Technology Inc"] and "candidati" not in _c497r["BLK"])
_o497 = _c497r["ORCL"]
check("v497 il quotato porta il fatto (prezzo, cedola, punti, contratto, entita' di ICE) e la conversione, con la nota "
      "dell'abbinamento; CRWV sotto i 30 punti non e' indicativo",
      _o497["prezzo"] == 91.758 and _o497["cedola_pb"] == 100 and _o497["punti"] == 8.24
      and _o497["contratto"] == "SNRFOR.USD.XR14" and _o497["entita"] == "Oracle Cop" and 280 < _o497["pb"] < 320
      and _o497["nota"].startswith("ICE scrive") and _o497["indicativo"] is False and _c497r["CRWV"]["indicativo"] is False
      and _indici497["IG"]["pb"] is not None and _indici497["HY"]["pb"] > _indici497["IG"]["pb"])

# --- il tasso della conversione: l'EFFR, misurato; senza, il giorno prima dichiarato; senza nemmeno quello, niente
_t497a = ud.tasso_cds({"fedwatch": {"effr": {"valore": 3.88, "data": "2026-10-15", "fonte": "NY Fed"}},
                       "tassi": {"scadenze": [{"key": "a5", "value": 4.91}]}}, [])
_t497b = ud.tasso_cds({}, [_riga497("2026-10-15", {}, r=3.9)])
_t497c = ud.tasso_cds({}, [])
check("v497 il tasso e' l'EFFR (non il Treasury a 5 anni, che rendeva incoerenti le due cedole); senza, quello del "
      "giorno raccolto prima, dichiarato; senza nessuno dei due, nessuno spread",
      _t497a[0] == 3.88 and "EFFR" in _t497a[1] and _t497b[0] == 3.9 and "mancava" in _t497b[1] and _t497c[0] is None)

# --- il ripiego quando ICE non risponde, e la sorveglianza (v390)
with _tmp497.TemporaryDirectory() as _dir497:
    _fs497, _fm497 = Path(_dir497) / "s.jsonl", Path(_dir497) / "m.json"
    _fm497.write_text(_json497.dumps(_mappa497))
    _ok497 = ud.aggiorna_cds([dict(r) for r in _righe497], {"fedwatch": {"effr": {"valore": 3.88}}}, get=_get497,
                             percorso_storia=_fs497, percorso_mappa=_fm497)
    _righe_giu497 = [dict(r) for r in _righe497]
    def _giu497(u):
        raise RuntimeError("HTTP 503")
    _ko497 = ud.aggiorna_cds(_righe_giu497, {}, get=_giu497, percorso_storia=_fs497, percorso_mappa=_fm497)
    _righe_storia497 = len(_fs497.read_text().splitlines())
check("v497 ICE giu': i titoli si leggono dall'ULTIMO giorno raccolto, il riepilogo dice 'non letto' con l'errore, e lo "
      "storico non si sporca",
      _ok497["letto"] and not _ko497["letto"] and "503" in (_ko497["errore"] or "") and _ko497["data"] == "2026-10-16"
      and next(r for r in _righe_giu497 if r["ticker"] == "ORCL")["cds"]["stato"] == "quotato" and _righe_storia497 == 1)
_vq497 = lambda c: next((x for x in ud.validate_macro({"cds": c})["checks"] if x["key"] == "cds_ice"), {})
_oggi497 = _dt497.now().date().isoformat()
_vecchio497 = (_dt497.now().date() - _td497(days=9)).isoformat()
_vm497 = ud.validate_macro({"cds": {"data": _oggi497, "letto": True, "non_classificati": ["NUOVO"]}})
check("v497 sorveglianza: i CDS mancano → missing; vecchi di 9 giorni → stale; di oggi → ok; e un titolo non "
      "classificato alza il proprio allarme",
      _vq497({}).get("status") == "missing" and _vq497({"data": _vecchio497, "letto": False, "errore": "x"}).get("status") == "stale"
      and _vq497({"data": _oggi497, "letto": True}).get("status") == "ok"
      and any(a.startswith("cds_abbinamenti") and "NUOVO" in a for a in _vm497["alerts"]))
check("v497 il collegamento (v399, v443): main() passa a aggiorna_cds le righe seguite E il BTP, e il riepilogo finisce "
      "in macro['cds'] — che e' la chiave che la sorveglianza legge",
      'macro["cds"] = aggiorna_cds(watchlist + ([btp]' in _SRC_UD_CODICE and '_cds = macro.get("cds")' in _SRC_UD_CODICE)

# ======================== v498 — LA PROVA DEL CDS NELLA TENUTA: UN MESE, AL NETTO DELL'INDICE ========================
# Decisione del CEO del 17/10/2026. Lo storico vero ha UN giorno: una misura su un mese controllata sui dati del
# giorno sarebbe verde per assenza del fenomeno (v196, v229). Lo stato si COSTRUISCE (v425, v429): prezzi scelti
# per dare gli spread voluti, invertendo la conversione (monotona, v497) per bisezione.
def _prezzo498(pb, cedola, d):
    t0, lo, hi = _dt497.fromisoformat(d).date(), 1.0, 140.0
    for _ in range(90):
        mid = (lo + hi) / 2
        s = ud.spread_cds(mid, cedola, t0, _m497, 0.0388)
        if s is not None and s > pb:
            lo = mid          # spread troppo alto: il prezzo deve salire
        else:
            hi = mid          # troppo basso, o oltre il dominio (prezzo sopra il massimo): deve scendere
    return round((lo + hi) / 2, 6)
_giorni498 = [(_dt497(2026, 9, 1) + _td497(days=k)).date().isoformat() for k in range(30)]
def _storia498(nome, indice, n=30, cedola=100, fam="IG", serie_base=47, versione_base=1, m_base="2031-12-20",
               manca=None):
    """n righe; il nome e l'indice vanno in linea retta dal primo all'ultimo valore (in pb)."""
    out = []
    for k, d in enumerate(_giorni498[:n]):
        x = k / max(n - 1, 1)
        p = {} if d == manca else {"TESTCO": [cedola, _prezzo498(nome[0] + (nome[1] - nome[0]) * x, cedola, d)]}
        ic = 100 if fam == "IG" else 500
        i = {fam: [serie_base if k == 0 else 47, versione_base if k == 0 else 1, ic,
                   _prezzo498(indice[0] + (indice[1] - indice[0]) * x, ic, d)]}
        out.append({"d": d, "m": m_base if k == 0 else "2031-12-20", "r": 3.88, "p": p, "i": i})
    return out
# la base e' il giorno n posizioni indietro: con 30 righe e n=21 la finestra va dalla nona all'ultima
_s498a = _storia498((100, 130), (60, 60))
_f498a = ud.finestra_cds(_s498a, "TESTCO", 100)
_pb498 = lambda r, v: ud._cds_pb_riga(r, v)
_atteso498 = ((_pb498(_s498a[-1], _s498a[-1]["p"]["TESTCO"]) / _pb498(_s498a[-22], _s498a[-22]["p"]["TESTCO"]))
              / (_pb498(_s498a[-1], _s498a[-1]["i"]["IG"][2:]) / _pb498(_s498a[-22], _s498a[-22]["i"]["IG"][2:])) - 1) * 100
check("v498 finestra del CDS: la base e' il giorno 21 posizioni indietro nei giorni RACCOLTI (non il primo dello "
      "storico), e l'eccesso e' il rapporto fra le due crescite meno uno — la formula ricalcolata dagli spread del "
      "giorno: " + str(_f498a),
      _f498a["stato"] == "misurato" and _f498a["da"] == _s498a[-22]["d"] and _f498a["a"] == _s498a[-1]["d"]
      and _f498a["n"] == ud.CDS_SEDUTE_PROVA == 21 and _f498a["indice"] == "IG"
      and abs(_f498a["eccesso_pct"] - _atteso498) < 0.051 and _f498a["nome_pct"] > 15)
# ⚠ la proprieta' che una misura sbagliata non soddisfa per caso (v326): se il nome e il mercato si allargano INSIEME
#   e nella stessa proporzione, la parte del nome e' zero — e' il semaforo a parlare (B3). Una formula che ignorasse
#   l'indice qui darebbe +30%.
_f498b = ud.finestra_cds(_storia498((100, 130), (60, 78)), "TESTCO", 100)
_f498c = ud.finestra_cds(_storia498((100, 125), (60, 50)), "TESTCO", 100)
check("v498 finestra: nome e indice che si allargano insieme danno un eccesso vicino a zero; il nome che si allarga "
      "mentre l'indice si stringe lo da' piu' grande della propria variazione: " + str((_f498b.get("eccesso_pct"),
                                                                                     _f498c.get("eccesso_pct"))),
      abs(_f498b["eccesso_pct"]) < 1.5 and _f498b["nome_pct"] > 15 and _f498b["indice_pct"] > 15
      and _f498c["eccesso_pct"] > _f498c["nome_pct"] + 10 and _f498c["indice_pct"] < 0)
_f498d = ud.finestra_cds(_s498a[:21], "TESTCO", 100)
check("v498 finestra: con 21 giorni raccolti la prova NON E' ANCORA IN FUNZIONE, e lo dice coi giorni che ha e quelli "
      "che servono, e da quando raccoglie — nessuna data proiettata (v396)",
      _f498d == {"stato": "storico corto", "n": 21, "giorni": 21, "servono": 22, "dal": _giorni498[0]}
      and ud.finestra_cds([], "TESTCO", 100)["giorni"] == 0 and ud.finestra_cds([], "TESTCO", 100)["dal"] is None)
_f498e = ud.finestra_cds(_storia498((100, 130), (60, 60), n=22, manca=_giorni498[0]), "TESTCO", 100)
_f498e2 = ud.finestra_cds(_storia498((100, 130), (60, 60), n=22, manca=_giorni498[21]), "TESTCO", 100)
_f498f = ud.finestra_cds(_storia498((100, 130), (60, 60), n=22, m_base="2031-06-20"), "TESTCO", 100)
_f498g = ud.finestra_cds(_storia498((100, 130), (60, 60), n=22, serie_base=46), "TESTCO", 100)
_f498g2 = ud.finestra_cds(_storia498((100, 130), (60, 60), n=22, versione_base=2), "TESTCO", 100)
check("v498 finestra: un giorno senza il nome e' un BUCO (v205), la scadenza standard che rotola nella finestra e "
      "l'indice che cambia serie o versione rendono la misura non calcolabile, e ogni stato dice perche' — nessuno "
      "porta un eccesso",
      _f498e["stato"] == "buco" and _giorni498[0] in _f498e["perche"] and _f498e2["stato"] == "buco"
      and _giorni498[21] in _f498e2["perche"]
      and _f498f["stato"] == "cambio di scadenza" and "2031-06-20" in _f498f["perche"]
      and _f498g["stato"] == "cambio di serie" and "46" in _f498g["perche"]
      and _f498g2["stato"] == "cambio di serie"
      and all("eccesso_pct" not in f for f in (_f498e, _f498e2, _f498f, _f498g, _f498g2)))
_f498h = ud.finestra_cds(_storia498((1000, 1300), (350, 350), n=22, cedola=500, fam="HY"), "TESTCO", 500)
_f498i = ud.finestra_cds(_storia498((100, 130), (60, 60), n=22), "TESTCO", 250)
check("v498 finestra: la cedola sceglie l'indice — 500 pb contro il CDX high yield, 100 contro l'investment grade; "
      "una cedola senza indice della stessa cedola lo dichiara",
      _f498h["stato"] == "misurato" and _f498h["indice"] == "HY" and abs(_f498h["eccesso_pct"] - 30) < 2
      and _f498i["stato"] == "indice n.d." and "250" in _f498i["perche"]
      and ud.CDS_FAMIGLIA == {100: "IG", 500: "HY"})
# --- il collegamento (v399, v443): cds_dei_titoli attacca la finestra a ogni quotato, coi suoi argomenti
_prima498 = [{"d": d, "m": "2031-12-20", "r": 3.88, "p": {"ORCLE": [100, _prezzo498(150 + k, 100, d)]},
              "i": {"IG": [47, 1, 100, _prezzo498(60, 100, d)]}} for k, d in enumerate(_giorni498[:21])]
_storia498r = _prima498 + [ud.riga_storia_cds(_l497, 3.88)]
_righe498 = [dict(r) for r in _righe497]
ud.cds_dei_titoli(_righe498, _l497, _storia498r, _mappa497)
_c498 = {r["ticker"]: r.get("cds") for r in _righe498}
check("v498 collegamento: ogni titolo quotato porta la finestra calcolata sui SUOI argomenti (codice e cedola del "
      "contratto standard) e la famiglia dell'indice; l'assente e il non classificato no",
      _c498["ORCL"].get("finestra") == ud.finestra_cds(_storia498r, "ORCLE", _c498["ORCL"]["cedola_pb"])
      and _c498["ORCL"]["finestra"]["stato"] == "misurato" and _c498["ORCL"]["indice"] == "IG"
      and _c498["CRWV"]["finestra"]["stato"] == "buco" and _c498["CRWV"]["indice"] == "HY"
      and _c498["CRWV"]["finestra"].get("indice") == "HY"
      and "finestra" not in _c498["MU"] and "finestra" not in _c498["NUOVO"]
      and _c497r["ORCL"]["finestra"]["stato"] == "storico corto")

# ═══ v500 — L'ORA DEI DEPOSITI DEI RISULTATI (SEC EDGAR, acceptanceDateTime) ══════════════════════════════════
# Il VWAP ancorato ai conti (decisione del CEO del 18/10/2026) parte dalla prima seduta DOPO il comunicato, e quale sia
# lo dice l'ora: la pipeline la legge dalla stessa risposta di EDGAR del calendario. Gli stati si costruiscono.
from datetime import date as _date500
_sub500 = {"filings": {"recent": {
    "form": ["8-K", "8-K", "10-Q", "6-K", "8-K", "8-K", "8-K"],
    "filingDate": ["2026-10-02", "2026-09-30", "2026-09-29", "2026-09-15", "2026-06-25", "2026-06-20", "2026-03-01"],
    "items": ["8.01", "2.02,9.01", "", "", "2.02", "2.02", "2.02"],
    "acceptanceDateTime": ["2026-10-02T08:05:00.000Z", "2026-09-30T16:02:11.000Z", "2026-09-29T17:00:00.000Z",
                           "2026-09-15T06:30:00.000Z", "2026-06-25T16:05:00.000Z", "", "2026-03-01T16:05:00.000Z"]}}}
_od500 = ud.ore_depositi(_sub500, oggi=_date500(2026, 10, 18))
check("v500 ore dei depositi: solo gli 8-K con item 2.02 e i 6-K degli ultimi 130 giorni, con l'ora come EDGAR la "
      "scrive troncata ai secondi; un 8-K senza 2.02 (le consegne di Tesla del 02/10), un 10-Q, un deposito senza ora "
      "e uno oltre i 130 giorni restano fuori",
      _od500 == [{"forma": "8-K", "data": "2026-09-30", "accettato": "2026-09-30T16:02:11"},
                 {"forma": "6-K", "data": "2026-09-15", "accettato": "2026-09-15T06:30:00"},
                 {"forma": "8-K", "data": "2026-06-25", "accettato": "2026-06-25T16:05:00"}])
check("v500 ore dei depositi: il tetto di voci si rispetta (dal piu' recente), una risposta vuota e una senza 'items' "
      "danno un elenco vuoto — senza 'items' un 8-K non si puo' dire dei risultati",
      [x["data"] for x in ud.ore_depositi(_sub500, oggi=_date500(2026, 10, 18), massimo=2)] == ["2026-09-30", "2026-09-15"]
      and ud.ore_depositi({}, oggi=_date500(2026, 10, 18)) == []
      and ud.ore_depositi({"filings": {"recent": {"form": ["8-K"], "filingDate": ["2026-10-01"],
                                                    "acceptanceDateTime": ["2026-10-01T16:05:00.000Z"]}}},
                          oggi=_date500(2026, 10, 18)) == [])
_sec500 = _SRC_UD_CODICE[_SRC_UD_CODICE.find("sec_cal, senza_cik, esteri = {}, [], []"):]
_sec500 = _sec500[:_sec500.find("calendario_uscite_fred(STORICO_IND)")]
check("v500 collegamento: il giro del calendario EDGAR passa ogni risposta letta a ore_depositi PRIMA del filtro degli "
      "esteri (i 6-K servono a loro), e le pubblica in sec_calendario.ore_depositi con l'orologio dichiarato, anche "
      "quando non ci sono trimestrali",
      "ore[_tk] = ore_depositi(_sub)" in _sec500
      and _sec500.find("ore[_tk] = ore_depositi(_sub)") < _sec500.find("esteri.append(_tk)")
      and '"ore_depositi": {"per_titolo": ore' in _sec500 and '"orologio": "America/New_York"' in _sec500
      and "if sec_cal or esteri or storia or ore" in _sec500)

_TOT = len(ESEGUITI)
check("v254 la suite non ha perso check per strada (soglia minima %d)" % N_CHECKS_MINIMO,
      _TOT >= N_CHECKS_MINIMO)
_TOT = len(ESEGUITI)

print(f"\n{('TUTTI I ' + str(_TOT - len(FAILED)) + f'/{_TOT} CHECK OK') if not FAILED else str(len(FAILED)) + f'/{_TOT} CHECK FALLITI: ' + ', '.join(FAILED)}")
sys.exit(1 if FAILED else 0)

