#!/usr/bin/env python3
"""Fondamentali, target degli analisti e storico utili — le tre sezioni del PDF del CEO che NON
escono dalle barre giornaliere.

Fonte unica: `api.nasdaq.com`, senza chiave. ⚠ Richiede l'UA "browser completo" (vedi
`preleva._get`: sulla stessa rete FRED lo rifiuta e Nasdaq lo pretende).

⚠⚠ NIENTE E' RICALCOLATO E NIENTE E' STIMATO. Ogni riga esce dal bilancio depositato con la
propria DATA DI CHIUSURA PERIODO accanto: e' la regola v400 — la cassa copriva "1,6 mesi" su un
bilancio gia' superato da un deposito piu' recente, e la data c'era ma non viaggiava col numero.
Un TTM non si compone qui: sommare quattro trimestri presi da tabelle diverse produce un numero
che sembra un dato e non lo e'.
"""
import json, sys, time
from datetime import datetime, timezone
from preleva import _get, salva

def _j(url):
    return json.loads(_get(url, timeout=30, tentativi=2))

def _num(s):
    """'$2,023,994' -> 2023994.0 ; '29.02183%' -> 29.02183 ; '--' / '' -> None."""
    if s is None: return None
    t = str(s).strip().replace("$", "").replace(",", "").replace("%", "")
    neg = t.startswith("(") and t.endswith(")")
    if neg: t = t[1:-1]
    if t in ("", "--", "N/A", "NA", "null"): return None
    try:
        v = float(t)
        return -v if neg else v
    except ValueError:
        return None

def _tabella(t):
    """Da una tabella Nasdaq a {periodo: {voce: valore}}, saltando le righe-intestazione
    (quelle con tutte le celle vuote: sono titoli di sezione, non dati)."""
    if not t: return {}
    h = t.get("headers") or {}
    periodi = {k: v for k, v in h.items() if k != "value1"}
    out = {p: {} for p in periodi.values()}
    for r in (t.get("rows") or []):
        voce = r.get("value1")
        celle = {periodi[k]: r.get(k) for k in periodi if k in r}
        if not any(str(x or "").strip() for x in celle.values()):
            continue                       # riga di sezione, non un dato
        for per, val in celle.items():
            out[per][voce] = _num(val)
    return out

def bilanci(tk, frequenza=1):
    """frequenza 1 = annuale, 2 = trimestrale. Ritorna i quattro prospetti per periodo."""
    d = (_j(f"https://api.nasdaq.com/api/company/{tk.upper()}/financials?frequency={frequenza}")
         or {}).get("data") or {}
    return {"conto_economico": _tabella(d.get("incomeStatementTable")),
            "stato_patrimoniale": _tabella(d.get("balanceSheetTable")),
            "flussi_di_cassa": _tabella(d.get("cashFlowTable")),
            "indici": _tabella(d.get("financialRatiosTable"))}

def anagrafica(tk):
    info = (_j(f"https://api.nasdaq.com/api/quote/{tk.upper()}/info?assetclass=stocks") or {}).get("data") or {}
    som = (_j(f"https://api.nasdaq.com/api/quote/{tk.upper()}/summary?assetclass=stocks") or {}).get("data") or {}
    sd = som.get("summaryData") or {}
    pd_ = info.get("primaryData") or {}
    return {"nome": info.get("companyName"), "tipo": info.get("stockType"),
            "borsa": info.get("exchange"),
            "ultimo_prezzo": _num(pd_.get("lastSalePrice")),
            "var_pct_dichiarata": pd_.get("percentageChange"),
            "prezzo_riferito_a": pd_.get("lastTradeTimestamp"),
            "campi": {k: (v or {}).get("value") for k, v in sd.items()}}

def analisti(tk):
    t = (_j(f"https://api.nasdaq.com/api/analyst/{tk.upper()}/targetprice") or {}).get("data") or {}
    r = (_j(f"https://api.nasdaq.com/api/analyst/{tk.upper()}/ratings") or {}).get("data") or {}
    co = t.get("consensusOverview") or {}
    return {"target_medio": co.get("priceTarget"), "target_min": co.get("lowPriceTarget"),
            "target_max": co.get("highPriceTarget"),
            "compra": co.get("buy"), "mantieni": co.get("hold"), "vendi": co.get("sell"),
            "giudizio_medio": r.get("meanRatingType"), "base": r.get("ratingsSummary")}

def utili(tk):
    s = (_j(f"https://api.nasdaq.com/api/company/{tk.upper()}/earnings-surprise") or {}).get("data") or {}
    f = (_j(f"https://api.nasdaq.com/api/analyst/{tk.upper()}/earnings-forecast") or {}).get("data") or {}
    def righe(blocco):
        b = f.get(blocco) or {}
        return [{k: r.get(k) for k in r} for r in (b.get("rows") or [])]
    return {"sorprese": (s.get("earningsSurpriseTable") or {}).get("rows") or [],
            "previsioni_trimestrali": righe("quarterlyForecast"),
            "previsioni_annuali": righe("yearlyForecast")}

def scheda(tk):
    out = {"ticker": tk.upper(), "letto_il": datetime.now(timezone.utc).isoformat(),
           "fonte": "api.nasdaq.com", "errori": {}}
    for nome, fn in (("anagrafica", anagrafica), ("analisti", analisti), ("utili", utili)):
        try: out[nome] = fn(tk)
        except Exception as e: out["errori"][nome] = str(e)[:120]   # v389: il buco si DICHIARA
    for nome, fr in (("annuale", 1), ("trimestrale", 2)):
        try: out["bilanci_" + nome] = bilanci(tk, fr)
        except Exception as e: out["errori"]["bilanci_" + nome] = str(e)[:120]
    return out

if __name__ == "__main__":
    for tk in sys.argv[1:]:
        s = scheda(tk)
        a = s.get("anagrafica") or {}
        an = s.get("analisti") or {}
        q = (s.get("bilanci_trimestrale") or {}).get("conto_economico") or {}
        print(f"{tk:<6} {str(a.get('nome'))[:40]:<40} {a.get('ultimo_prezzo')} · "
              f"target {an.get('target_medio')} ({an.get('giudizio_medio')}) · "
              f"trimestri {sorted(q)[-1] if q else '—'} · errori {list(s['errori']) or 'nessuno'}")
        salva(f"fond_{tk.upper()}.json", s)
        time.sleep(0.5)
