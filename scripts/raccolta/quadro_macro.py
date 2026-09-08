#!/usr/bin/env python3
"""Quadro macro dalle serie FRED in cache: valore, percentili su finestre DICHIARATE, direzione.

⚠⚠ LA PROFONDITA' STORICA E' IL GUADAGNO VERO su quanto arrivava dal vecchio sistema, che
pubblicava percentili su uno o cinque anni. Qui `DFF` parte dal 1954, `CPIAUCNS` dal 1913: il
percentile "storico" e' su TUTTA la serie e la riga dichiara da quando.
⚠ Due serie fanno eccezione e va scritto: gli spread ICE BofA (`BAMLH0A0HYM2`, `BAMLC0A0CM`)
FRED li ridistribuisce pubblicamente solo per TRE ANNI. Il loro "storico" e' tre anni, e
chiamarlo storico senza dirlo sarebbe la classe dei denominatori non dichiarati.
⚠ Le variazioni si prendono PER DATA, mai per posizione: una serie con un buco (CPIAUCNS non ha
ottobre 2025) darebbe un "anno su anno" di tredici mesi (lezione v393).
"""
import json, os, sys
from datetime import date, timedelta
from fred_cache import punti

CACHE = "/home/user/Trading/memoria/dati"

SERIE = [
 ("DGS10", "Treasury 10 anni", "%", "tassi"),
 ("DGS2", "Treasury 2 anni", "%", "tassi"),
 ("DGS30", "Treasury 30 anni", "%", "tassi"),
 ("DGS3MO", "Treasury 3 mesi", "%", "tassi"),
 ("DFF", "Tasso Fed effettivo", "%", "tassi"),
 ("T10Y2Y", "Curva 10A-2A", "pp", "curva"),
 ("T10Y3M", "Curva 10A-3M", "pp", "curva"),
 ("DFII10", "Tasso reale 10A (TIPS)", "%", "tassi"),
 ("T10YIE", "Inflazione attesa a 10 anni", "%", "inflazione"),
 ("CPIAUCNS", "CPI, indice non destagionalizzato", "indice", "inflazione"),
 ("PCEPI", "PCE, indice dei prezzi", "indice", "inflazione"),
 ("BAMLH0A0HYM2", "Spread high yield (OAS)", "pp", "credito"),
 ("BAMLC0A0CM", "Spread investment grade (OAS)", "pp", "credito"),
 ("NFCI", "Condizioni finanziarie (Chicago Fed)", "indice", "credito"),
 ("DRTSCILM", "Standard di credito banche (SLOOS)", "% netto", "credito"),
 ("VIXCLS", "VIX", "punti", "rischio"),
 ("UNRATE", "Disoccupazione", "%", "lavoro"),
 ("UMCSENT", "Fiducia consumatori UMich", "indice", "attivita"),
 ("GACDFSA066MSFRBPHI", "Manifattura Philly Fed", "diffusione", "attivita"),
 ("DCOILWTICO", "Petrolio WTI", "$/bbl", "materie prime"),
 ("RMFNS", "Fondi monetari retail", "mld $", "liquidita"),
]

# ⚠ Licenza della FONTE, non buco della raccolta: si dichiara accanto al percentile.
FINESTRA_LICENZA = {"BAMLH0A0HYM2": "ICE BofA: FRED ne ridistribuisce pubblicamente 3 anni",
                    "BAMLC0A0CM": "ICE BofA: FRED ne ridistribuisce pubblicamente 3 anni"}
# ⚠⚠ SU UN INDICE CUMULATIVO IL PERCENTILE DEL LIVELLO NON E' UN'INFORMAZIONE. CPIAUCNS e
# PCEPI escono al 100esimo percentile della propria storia, ed e' vero PER COSTRUZIONE: un
# indice che sale sta sempre al proprio massimo. Chi legge conclude "inflazione da record",
# che e' falso — a essere da record e' il livello dell'indice, non l'inflazione. E' la classe
# v316 (il percentile che era una variazione) e v392 (la forma del numero che suggerisce la
# grandezza sbagliata), qui col verso rovesciato.
# Per queste serie il percentile si calcola sulla VARIAZIONE A 12 MESI, e la riga lo dichiara.
SU_VARIAZIONE = {"CPIAUCNS": "l'indice dei prezzi sale sempre: il percentile del livello sarebbe "
                             "100 per costruzione, quindi si misura la variazione a 12 mesi",
                 "PCEPI":    "l'indice dei prezzi sale sempre: il percentile del livello sarebbe "
                             "100 per costruzione, quindi si misura la variazione a 12 mesi",
                 "RMFNS":    "le masse dei fondi monetari crescono col risparmio: il livello e' "
                             "quasi sempre al massimo, quindi si misura la variazione a 12 mesi"}

# ⚠ Il SEGNO non e' intuitivo e va scritto ogni volta (lezione v390).
LETTURA = {"DRTSCILM": "negativo = banche che ALLENTANO, cioe' la lettura favorevole",
           "NFCI": "negativo = condizioni finanziarie PIU' LARGHE della media storica",
           "T10Y2Y": "negativo = curva invertita",
           "T10Y3M": "negativo = curva invertita"}

def pct(serie, v):
    """midrank: due valori uguali non danno percentili diversi."""
    if not serie: return None
    sotto = sum(1 for x in serie if x < v); pari = sum(1 for x in serie if x == v)
    return round((sotto + pari / 2) / len(serie) * 100)

def _al(p, giorni):
    """il valore alla data piu' vicina indietro di N giorni, PER DATA e non per posizione."""
    if not p: return None, None
    bersaglio = (date.fromisoformat(p[-1][0]) - timedelta(days=giorni)).isoformat()
    prec = [x for x in p if x[0] <= bersaglio]
    return (prec[-1][1], prec[-1][0]) if prec else (None, None)

def riga(sid, nome, unita, famiglia):
    p, come = punti(sid)
    if not p: raise RuntimeError("serie vuota")
    v, d = p[-1][1], p[-1][0]
    # finestre per DATA (non per numero di punti: le serie hanno frequenze diverse)
    da1a = (date.fromisoformat(d) - timedelta(days=365)).isoformat()
    da5a = (date.fromisoformat(d) - timedelta(days=365 * 5)).isoformat()
    s1 = [x[1] for x in p if x[0] >= da1a]
    s5 = [x[1] for x in p if x[0] >= da5a]
    tutto = [x[1] for x in p]
    r = {"serie": sid, "nome": nome, "unita": unita, "famiglia": famiglia,
         "valore": v, "data": d, "punti": len(p), "dal": p[0][0], "letto": come,
         "misura": "livello", "perche_variazione": None,
         "perc_1a": pct(s1, v), "n_1a": len(s1),
         "perc_5a": pct(s5, v), "n_5a": len(s5),
         "perc_storico": pct(tutto, v), "n_storico": len(tutto),
         "min_1a": min(s1) if s1 else None, "max_1a": max(s1) if s1 else None,
         "min_storico": min(tutto), "max_storico": max(tutto),
         "nota_finestra": FINESTRA_LICENZA.get(sid), "lettura": LETTURA.get(sid)}
    for et, gg in (("1m", 30), ("3m", 91), ("12m", 365)):
        prima, quando = _al(p, gg)
        r["var_" + et] = round(v - prima, 3) if prima is not None else None
        r["base_" + et] = quando
        # la variazione RELATIVA ha senso solo su un indice o un livello positivo
        r["varpct_" + et] = (round((v / prima - 1) * 100, 2)
                             if prima not in (None, 0) and unita in ("indice", "$/bbl", "mld $", "punti")
                             else None)
    if sid in SU_VARIAZIONE:
        # la serie delle variazioni a 12 mesi, allineate PER DATA (v393): senza questo, una
        # serie con un buco confronta due mesi che non distano dodici.
        idx = {x[0]: x[1] for x in p}
        storia = []
        for data_, val in p:
            a_, m_, g_ = data_.split("-")
            base = idx.get(f"{int(a_)-1}-{m_}-{g_}")
            if base: storia.append((data_, (val / base - 1) * 100))
        if len(storia) >= 24:
            oggi_var = storia[-1][1]
            s1v = [x[1] for x in storia if x[0] >= da1a]
            s5v = [x[1] for x in storia if x[0] >= da5a]
            tv = [x[1] for x in storia]
            r.update({"misura": "variazione_12m", "perche_variazione": SU_VARIAZIONE[sid],
                      "variazione_12m_pct": round(oggi_var, 2),
                      "perc_1a": pct(s1v, oggi_var), "n_1a": len(s1v),
                      "perc_5a": pct(s5v, oggi_var), "n_5a": len(s5v),
                      "perc_storico": pct(tv, oggi_var), "n_storico": len(tv),
                      "min_1a": round(min(s1v), 2) if s1v else None,
                      "max_1a": round(max(s1v), 2) if s1v else None,
                      "min_storico": round(min(tv), 2), "max_storico": round(max(tv), 2),
                      "variazioni_dal": storia[0][0]})
    return r

def quadro():
    out, errori = [], {}
    for sid, nome, unita, fam in SERIE:
        try: out.append(riga(sid, nome, unita, fam))
        except Exception as e: errori[sid] = str(e)[:120]      # v389: il buco si DICHIARA
    return {"righe": out, "errori": errori}

if __name__ == "__main__":
    q = quadro()
    for r in q["righe"]:
        n = f"{r['nome']} ({r['serie']})"
        lic = " ⚠lic" if r["nota_finestra"] else ""
        mis = "var12m" if r["misura"] == "variazione_12m" else "livello"
        val = r.get("variazione_12m_pct") if r["misura"] == "variazione_12m" else r["valore"]
        print(f"{n:<44} {r['valore']:>12} {r['unita']:<9} {r['data']} · perc del {mis} "
              f"({val}) 1a {str(r['perc_1a']):>3}° 5a {str(r['perc_5a']):>3}° "
              f"storico {str(r['perc_storico']):>3}°{lic} su {r['n_storico']} dal "
              f"{r.get('variazioni_dal') or r['dal']} · Δ12m {r['var_12m']}")
    if q["errori"]: print("NON LETTE:", q["errori"])
