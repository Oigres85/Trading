#!/usr/bin/env python3
"""Test del motore di narrazione temporale (v194).

Le date sono VERE (AAAA-MM-GG) di proposito: la prima stesura usava etichette sintetiche
("d000", "b012") e passava, ma il motore su dati reali produceva una mediana "+50,7% a 63
giorni" perche' allineava per data una serie datata con una spark senza date. La guardia
_dominio_compatibile ora rifiuta quel caso — e i test devono esercitare la stessa forma dei
dati veri, altrimenti sono verdi su una configurazione che in produzione non esiste.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
from historical_context import (percentile, durata_regime, episodi_regime,
                                rendimento_dopo, analoghi, racconto)

OK, KO = [], []
def check(nome, cond):
    (OK if cond else KO).append(nome)
    print(("  ok   " if cond else "  FAIL ") + nome)

def giorni(n, start=(2020, 1, 1)):
    """n date giornaliere consecutive reali."""
    import datetime as dt
    d0 = dt.date(*start)
    return [(d0 + dt.timedelta(days=i)).isoformat() for i in range(n)]

D = giorni(400)

# ── percentile ────────────────────────────────────────────────────────────────────────
s = list(zip(D[:100], range(1, 101)))
check("percentile: l'ultimo valore e' il massimo → ~100", percentile(s) >= 99)
check("percentile: valore mediano ~50", percentile(s, 50) == 50)
check("percentile: sotto il minimo → 0", percentile(s, 0) == 0)
check("percentile: serie di un punto → None", percentile([(D[0], 1)]) is None)
check("percentile: dieci valori uguali → 50 (midrank), non 100",
      percentile(list(zip(D[:10], [5] * 10))) == 50)
check("percentile: accetta liste di numeri nudi", percentile([1, 2, 3, 4, 100]) is not None)
check("percentile: accetta liste di dizionari {d,v}",
      percentile([{"d": D[i], "v": i} for i in range(50)]) is not None)

# ── durata del regime ─────────────────────────────────────────────────────────────────
d = list(zip(D[:5], [-1, -1, 1, 1, 1]))
n, da = durata_regime(d, lambda v: v > 0)
check("durata: 3 osservazioni consecutive, inizio corretto", n == 3 and da == D[2])
check("durata: stato non attuale → 0", durata_regime(d, lambda v: v < 0)[0] == 0)

# ── episodi ───────────────────────────────────────────────────────────────────────────
e = list(zip(D[:16], [1] * 6 + [-1] * 3 + [1] * 7))
eps = episodi_regime(e, lambda v: v > 0, min_len=5)
check("episodi: conta solo i CONCLUSI (l'ultimo e' in corso)", len(eps) == 1 and eps[0][2] == 6)
check("episodi: sotto min_len scartati",
      episodi_regime(list(zip(D[:4], [1, 1, 1, -1])), lambda v: v > 0, min_len=5) == [])

# ── rendimento successivo ─────────────────────────────────────────────────────────────
idx = list(zip(D, [100 + i for i in range(len(D))]))
check("rendimento: +10 su 100 dopo 10 osservazioni = +10%", rendimento_dopo(idx, D[0], 10) == 10.0)
check("rendimento: finestra non matura → None", rendimento_dopo(idx, D[-5], 10) is None)

# ── analoghi + guardia di allineamento ────────────────────────────────────────────────
serie = [(D[i], 1 if (i // 20) % 2 == 0 else -1) for i in range(len(D))]
an = analoghi(serie, idx, lambda v: v > 0, orizzonti=(10,))
check("analoghi: il campione e' SEMPRE dichiarato", "n" in an)
check("analoghi: con abbastanza episodi calcola la mediana", an["sufficiente"] and "mediana_10" in an)
poco = analoghi(list(zip(D[:9], [1] * 6 + [-1] * 3)), idx, lambda v: v > 0)
check("analoghi: 1 episodio → nessuna mediana e lo dichiara",
      poco["n"] == 1 and not poco["sufficiente"] and "mediana_63" not in poco)

# LA GUARDIA: e' il test che conta, perche' senza di essa il motore ha prodotto su dati veri
# una mediana plausibile e priva di senso.
sint = [("b%03d" % i, 100 + i) for i in range(len(D))]
g = analoghi(serie, sint, lambda v: v > 0)
check("GUARDIA: indice con etichette sintetiche → niente numeri, ma il motivo scritto",
      not g["sufficiente"] and g.get("non_calcolabile"))
check("GUARDIA: indice assente → dichiarato, non uno zero silenzioso",
      analoghi(serie, [], lambda v: v > 0).get("non_calcolabile"))
disgiunte = [(x, 100) for x in giorni(50, (2010, 1, 1))]
check("GUARDIA: nessuna sovrapposizione temporale → non calcolabile",
      analoghi(serie, disgiunte, lambda v: v > 0).get("non_calcolabile"))

# ── racconto ──────────────────────────────────────────────────────────────────────────
# NB: nella serie di prova l'ultimo blocco e' NEGATIVO, quindi lo stato "positivo" NON e' in
# corso e durata_stato vale 0 — che e' la risposta giusta. Si verifica lo stato che c'e' davvero.
rc = racconto("prova", serie, idx, lambda v: v > 0, "positiva", "pp", orizzonti=(10,))
check("racconto: percentile e analoghi insieme, durata 0 se lo stato NON e' quello attuale",
      rc and rc["percentile"] is not None and rc["durata_stato"] == 0 and rc["analoghi"]["n"] > 0)
rc2 = racconto("prova", serie, idx, lambda v: v < 0, "negativa", "pp", orizzonti=(10,))
check("racconto: sullo stato ATTUALE la durata e' positiva", rc2 and rc2["durata_stato"] > 0)
check("racconto: serie corta → None", racconto("x", list(zip(D[:10], [1] * 10)), idx, lambda v: v > 0, "s") is None)

print(f"\n{'TUTTI I ' + str(len(OK)) + '/' + str(len(OK)+len(KO)) + ' CHECK OK' if not KO else str(len(KO)) + ' FALLITI'}")
sys.exit(1 if KO else 0)
