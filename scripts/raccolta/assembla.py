#!/usr/bin/env python3
"""Mette insieme tutto quello che i raccoglitori hanno letto in un solo quadro.

⚠ NON CALCOLA NULLA DI NUOVO: chiama i moduli che gia' esistono. Una seconda derivazione della
stessa grandezza diverge al primo ritocco — e' costato v161, v207, v316, v409.
⚠ Ogni blocco porta la propria FRESCHEZZA e la propria FONTE. Un blocco che non c'e' si dichiara
assente con la sua ragione: "il sistema non ha il dato" e "ce l'ha e non te lo passa" si leggono
uguali (v406).
"""
import json, os, sys
from datetime import datetime, timezone
CACHE = "/home/user/Trading/memoria/dati"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import tecnica, libro, quadro_macro, canali

TITOLI = ["MU", "NVDA", "AMD", "MSTR", "PLTR", "GOOGL", "WDC", "ORCL",
          "BE", "MRVL", "CRWV", "RGTI", "SKHY"]
SEGUITI_NON_POSSEDUTI = ["TSM"]

def _leggi(nome):
    p = os.path.join(CACHE, nome)
    return json.load(open(p)) if os.path.exists(p) else None

def _periodo(s):
    """'6/30/2026' -> (2026, 6, 30) per ordinare i trimestri CRONOLOGICAMENTE.
    ⚠ Ordinarli come stringhe mette 9/30/2025 dopo 6/30/2026: l'ultimo trimestre sarebbe
    quello sbagliato, e sarebbe il numero su cui si decide."""
    try:
        m, g, a = str(s).split("/")
        return (int(a), int(m), int(g))
    except Exception:
        return (0, 0, 0)

def periodi_ordinati(tab):
    return sorted(tab, key=_periodo, reverse=True)

def quadro():
    ora = datetime.now(timezone.utc)
    out = {"generato_il": ora.isoformat(), "assente": {}}

    # ── macro ──────────────────────────────────────────────────────────────────
    m = quadro_macro.quadro()
    out["macro"] = m
    if m["errori"]: out["assente"]["serie macro"] = m["errori"]

    # ── libro ──────────────────────────────────────────────────────────────────
    out["libro"] = {"principale": libro.analizza(125), "finestra_corta": libro.corte(125),
                    "posizioni": {t: {"qta": q, "pmc": p} for t, (q, p) in libro.POS.items()}}

    # ── per titolo ─────────────────────────────────────────────────────────────
    notizie = _leggi("notizie_titoli.json") or {"per_titolo": {}}
    out["notizie_lette_il"] = notizie.get("letto_il")
    out["titoli"] = {}
    for tk in TITOLI + SEGUITI_NON_POSSEDUTI:
        s = {"posseduto": tk in TITOLI}
        try:
            s["tecnica"] = tecnica.scheda(tk)
        except Exception as e:
            s["tecnica"] = None; s["assente_tecnica"] = str(e)[:120]
        f = _leggi(f"fond_{tk}.json")
        if f:
            s["fondamentali"] = f
            for chiave in ("bilanci_trimestrale", "bilanci_annuale"):
                b = f.get(chiave) or {}
                for prospetto, tab in b.items():
                    b[prospetto] = {p: tab[p] for p in periodi_ordinati(tab)}
        else:
            s["fondamentali"] = None; s["assente_fondamentali"] = "scheda non raccolta"
        s["notizie"] = (notizie.get("per_titolo") or {}).get(tk)
        try:
            s["canali"] = canali.per_titolo(tk)
        except Exception as e:
            s["canali"] = None; s["assente_canali"] = str(e)[:120]
        # il sottostante estero, se esiste: NON e' lo strumento posseduto e lo dichiara
        sot = _leggi(f"ohlc_{tk}.KRX.json")
        if sot:
            s["sottostante"] = {"ticker": sot["ticker"], "valuta": sot["valuta"],
                                "borsa": sot["borsa"], "nome": sot["nome"],
                                "nota": sot["nota_simbolo"], "barre": len(sot["barre"]),
                                "dal": sot["barre"][0]["d"], "al": sot["barre"][-1]["d"],
                                "ultima_chiusura": sot["barre"][-1]["c"]}
        out["titoli"][tk] = s
    return out

if __name__ == "__main__":
    q = quadro()
    p = os.path.join(CACHE, "quadro.json")
    json.dump(q, open(p, "w"), separators=(",", ":"), default=str)
    t = q["titoli"]
    print(f"macro: {len(q['macro']['righe'])} serie, errori {q['macro']['errori'] or 'nessuno'}")
    pr = q["libro"]["principale"]
    print(f"libro: {len(pr['pesi'])} posizioni su {pr['finestra_sedute']} sedute "
          f"({pr['dal']} → {pr['al']}), fuori finestra {pr['fuori_finestra']}")
    print(f"titoli: {len(t)} — tecnica {sum(1 for x in t.values() if x['tecnica'])}, "
          f"fondamentali {sum(1 for x in t.values() if x['fondamentali'])}, "
          f"notizie {sum(1 for x in t.values() if (x['notizie'] or {}).get('voci'))}")
    print("scritto", p, os.path.getsize(p), "byte")
