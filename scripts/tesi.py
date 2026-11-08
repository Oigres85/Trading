#!/usr/bin/env python3
"""v540 — LE TESI: per ogni posizione tre condizioni che devono restare vere e tre segnali che la romperebbero.

Decisione del CEO dell'08/11/2026 (*"Ok procedi come dici tu"*): il metodo del comitato d'investimento entra nel
sistema. Le tesi stanno in memoria/LIBRO.md §1novodecies, scritte dall'analista e da confermare col CEO; questo
strumento le rilegge e controlla a ogni analisi le condizioni MISURABILI — quelle con un'etichetta fra graffe — sulle
PROVE della tenuta di numeri_libro (una derivazione sola, v161). Le condizioni senza etichetta si dicono «da leggere ai
conti»: il sistema non ha il dato, e lo dice (v406).

Etichette:
  {ricavi>=X}    crescita dei ricavi a un anno, in %, almeno X
  {stime>=X}     variazione delle stime d'utile a 90 giorni, in %, almeno X (X negativo = «non in calo oltre»)
  {revisioni}    revisioni degli analisti in su almeno quante in giu'
  {cassa>=X}     si autofinanzia, oppure cassa per almeno X mesi
  {autofinanzia} si autofinanzia
  {tendenza}     prezzo non in tendenza rotta (chiusura sotto la media a 200 con la 50 sotto la 200)

Uso: python3 scripts/tesi.py   (il blocco dell'analisi; esce 0 anche con tesi mancanti, che si DICHIARANO)
"""
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

QUI = Path(__file__).resolve().parent
RADICE = QUI.parent
if str(QUI) not in sys.path:
    sys.path.insert(0, str(QUI))

LIBRO = RADICE / "memoria" / "LIBRO.md"
SEZIONE = "## 1novodecies"
ETICHETTA = re.compile(r"\{(ricavi|stime|cassa)>=(-?\d+(?:,\d+)?)\}|\{(revisioni|autofinanzia|tendenza)\}")
VOCI = {"perché": "perche", "perche": "perche", "deve essere vero": "condizioni", "romperebbe": "segnali",
        "verdetto": "verdetto"}


def _it(x, d=1):
    return f"{x:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def sezione(testo):
    i = testo.find(SEZIONE)
    if i < 0:
        return ""
    j = testo.find("\n## ", i + 1)
    return testo[i:j if j > 0 else len(testo)]


def _voci(riga):
    """«(1) ... ; (2) ... ; (3) ...» -> le voci, senza il numero."""
    parti = re.split(r"\(\d\)\s*", riga)
    return [p.strip().rstrip(";").strip() for p in parti[1:] if p.strip()]


def leggi_tesi(testo):
    """{TK: {'perche', 'condizioni': [testo], 'segnali': [testo], 'verdetto'}} dalla sezione delle tesi."""
    out = {}
    for blocco in re.split(r"\n### ", "\n" + sezione(testo))[1:]:
        righe = blocco.splitlines()
        tk = (re.match(r"([A-Z][A-Z0-9.\-]{0,9})(?=\s|$)", righe[0].strip()) or [None, None])[1] if righe else None
        if not tk:
            continue
        t = {"perche": None, "condizioni": [], "segnali": [], "verdetto": None}
        for r in righe[1:]:
            m = re.match(r"\s*-\s*([^:]+?)\s*(?:\([^)]*\))?\s*:\s*(.*)", r)
            if not m:
                continue
            k = VOCI.get(m.group(1).strip().lower())
            if k in ("condizioni", "segnali"):
                t[k] = _voci(m.group(2))
            elif k:
                t[k] = m.group(2).strip()
        out[tk] = t
    return out


def valuta(condizione, prove):
    """(esito, valore): esito 'rispettata' | 'violata' | 'non misurata' | 'da leggere ai conti'."""
    m = ETICHETTA.search(condizione)
    if not m:
        return "da leggere ai conti", None
    pr = prove or {}
    nome = m.group(1) or m.group(3)
    soglia = float(m.group(2).replace(",", ".")) if m.group(2) else None
    if nome == "ricavi":
        y = (pr.get("ricavi") or {}).get("yoy")
        return ("non misurata", None) if y is None else ("rispettata" if y >= soglia else "violata",
                                                         f"ricavi {'+' if y >= 0 else ''}{_it(y)}%")
    if nome == "stime":
        v = (pr.get("stime") or {}).get("var")
        return ("non misurata", None) if v is None else ("rispettata" if v >= soglia else "violata",
                                                         f"stime {'+' if v >= 0 else ''}{_it(v)}% a 90 giorni")
    if nome in ("cassa", "autofinanzia"):
        b = pr.get("bilancio") or {}
        if b.get("autofinanzia") is True:
            return "rispettata", "si autofinanzia"
        if b.get("autofinanzia") is None:
            return "non misurata", None
        if nome == "autofinanzia":
            return "violata", "non si autofinanzia"
        mesi = b.get("mesi")
        return ("non misurata", "non si autofinanzia") if mesi is None else (
            "rispettata" if mesi >= soglia else "violata", f"cassa per {_it(mesi)} mesi")
    if nome == "revisioni":
        r = pr.get("revisioni") or {}
        if r.get("su") is None and r.get("giu") is None:
            return "non misurata", None
        su, giu = r.get("su") or 0, r.get("giu") or 0
        return ("rispettata" if su >= giu else "violata"), f"revisioni {su} in su, {giu} in giu'"
    if nome == "tendenza":
        t = pr.get("tendenza") or {}
        if t.get("verso") is None:
            return "non misurata", None
        return ("violata" if t["verso"] == "contro" else "rispettata"), f"tendenza {t.get('stato') or t['verso']}"
    return "non misurata", None


def controlla(tesi, righe):
    """Per ogni tesi: le condizioni con esito e valore, e i conteggi."""
    prove = {r["tk"]: r.get("prove") for r in righe or []}
    out = {}
    for tk, t in tesi.items():
        c = [(x, *valuta(x, prove.get(tk))) for x in t["condizioni"]]
        out[tk] = {"condizioni": c, "rispettate": sum(1 for x in c if x[1] == "rispettata"),
                   "violate": [i + 1 for i, x in enumerate(c) if x[1] == "violata"],
                   "misurabili": sum(1 for x in c if x[1] in ("rispettata", "violata")),
                   "da_leggere": sum(1 for x in c if x[1] == "da leggere ai conti"),
                   "tenuta": tk in prove}
    return out


def resa(tesi, ctrl, posizioni, scadenze=None, seduta=None):
    sc = {s["tk"]: s for s in (scadenze or [])}
    L = [f"TESI (v540) — tre condizioni e tre segnali per posizione (LIBRO.md §1novodecies), misurate sulle prove della "
         f"tenuta alla seduta del {seduta or '?'}: «da leggere ai conti» = il sistema non ha il dato"]
    senza = [tk for tk in posizioni if tk not in tesi]
    for tk in posizioni:
        if tk not in ctrl:
            continue
        c, t = ctrl[tk], tesi[tk]
        s = sc.get(tk)
        conti = f" · conti {s['data']}" if s and s.get("data") else ""
        testa = ((f"  {tk}: {c['rispettate']} su {c['misurabili']} misurabili rispettate"
                  + (f" · {c['da_leggere']} da leggere ai conti" if c["da_leggere"] else "")) if c["misurabili"]
                 else f"  {tk}: nessuna condizione misurabile dal sistema · {c['da_leggere']} da leggere") + conti
        if c["violate"]:
            testa = "  ⚠ " + testa.strip() + " · VIOLATA " + ", ".join(
                f"la {i} ({c['condizioni'][i - 1][2] or 'non misurata'})" for i in c["violate"])
        if not c["tenuta"] and any(ETICHETTA.search(x) for x in t["condizioni"]):
            testa += " · ⚠ nessuna prova della tenuta per questo nome in questo giro"
        L.append(testa + (f" → {t['verdetto']}" if t.get("verdetto") else ""))
    fuori = [tk for tk in tesi if tk not in posizioni]
    if senza:
        L.append(f"  ⚠ posizioni SENZA tesi: {', '.join(senza)} — vanno scritte in LIBRO.md §1novodecies")
    if fuori:
        L.append(f"  tesi di nomi non piu' in posizione (si tolgono): {', '.join(fuori)}")
    L.append("  una condizione violata non vende (CEO, 07/11: le regole sono guide): dice che la tesi va riletta, e "
             "l'avvocato del diavolo parla per primo")
    return "\n".join(L)


def main(argv):
    adesso = datetime.now(timezone.utc)
    import brief
    import sintesi as S
    try:
        testo = LIBRO.read_text(encoding="utf-8")
    except OSError as e:
        print(f"TESI (v540) — ⚠ libro non letto: {e}")
        return 1
    tesi = leggi_tesi(testo)
    posizioni = [p["tk"] for p in brief.leggi_libro()[0]]
    libro, motivo = S.leggi_giro("libro", S.GIRO, adesso, massimo=10 ** 9)
    righe = ((libro or {}).get("tenuta") or {}).get("righe") or []
    print(resa(tesi, controlla(tesi, righe), posizioni, ((libro or {}).get("attesa") or {}).get("scadenze"),
               (libro or {}).get("fine")))
    if motivo:
        print(f"  ⚠ {motivo}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
