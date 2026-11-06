#!/usr/bin/env python3
"""v536 — IL SISTEMA PREVISIONALE: le probabilita' del giorno, coi metodi affiancati e l'affidabilita' misurata.

Decisione del CEO del 03/11/2026: un sistema previsionale «stile Polymarket» — per ogni evento la probabilita' e la % di
affidabilita' — con l'ECCEZIONE MISURATA alla sua istruzione permanente n.1 («nessuna proiezione»): le previsioni entrano
SOLO come probabilita', in un blocco separato dai fatti, ognuna col suo metodo, la sua base, il suo intervallo e
l'affidabilita' misurata prima sul passato senza futuro e poi dal vivo. Metodi affiancati, MAI mediati (v200).

Qui si uniscono i moduli dello sciame (03-06/11/2026), ognuno una domanda e un metodo:
- previsioni_titoli.py      casi simili, con la soglia in unita' di volatilita' (titoli, QQQ e SMH, carico dei rami secchi)
- previsioni_opzioni.py     lognormale con la volatilita' realizzata (calibrato) e opzioni CBOE (solo dal vivo)
- previsioni_portafoglio.py simulazione a blocchi dei rendimenti del portafoglio (salvavita, massimo, rami secchi insieme)
- previsioni_macro.py       serie storiche FRED (VIX, credito, decennale: gli eventi del semaforo)
- mercati_previsione.py     quanto pagano Polymarket, Kalshi e FedWatch, e quanto ci hanno preso storicamente
- registro_previsioni.py    il registro dal vivo (memoria/previsioni.jsonl): registra, risolve, misura
La misura e' una sola, per tutti: affidabilita.py (v161).

Un modulo che manca o va in errore si DICHIARA e non spegne gli altri (v389). Le calibrazioni sul passato stanno in
cache in memoria/dati (fuori da git) e si rifanno quando scadono.

Uso:
  python3 scripts/previsioni.py pagina      il blocco dell'analisi: previsioni di oggi, registro, bilancio (comando unico)
  python3 scripts/previsioni.py bilancio    l'affidabilita' dal vivo dal registro
  python3 scripts/previsioni.py aperte      le previsioni aperte del registro
"""
import importlib
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

QUI = os.path.dirname(os.path.abspath(__file__))
if QUI not in sys.path:
    sys.path.insert(0, QUI)

import affidabilita as A  # noqa: E402

ROMA = ZoneInfo("Europe/Rome")
# v536 — la cadenza del registro dal vivo: i metodi PROPRI registrano una fotografia ogni CADENZA sedute (due previsioni a
#   pochi giorni di distanza sullo stesso evento sono quasi la stessa previsione, e il registro crescerebbe di un mega al
#   giorno); un mercato ESTERNO si registra una volta sola, alla prima lettura (la sua affidabilita' storica la misura gia'
#   mercati_previsione sui mercati chiusi). Convenzione dichiarata (v240), riletta da un gate da LIBRO.md §1septdecies.
CADENZA = 20
ESTERNI = ("polymarket", "kalshi", "fedwatch")
RIFERIMENTO_SEDUTE = "QQQ"
MODULI = ("previsioni_titoli", "previsioni_opzioni", "previsioni_portafoglio", "previsioni_macro", "mercati_previsione")
TITOLI_MODULI = {"previsioni_titoli": "TITOLI E MERCATO — casi simili, soglia in unita' di volatilita'",
                 "previsioni_opzioni": "TITOLI — modello lognormale (volatilita' realizzata) e opzioni CBOE",
                 "previsioni_portafoglio": "PORTAFOGLIO — simulazione a blocchi dei rendimenti",
                 "previsioni_macro": "MACRO E SEMAFORO — serie storiche FRED",
                 "mercati_previsione": "MERCATI DI PREVISIONE — Polymarket, Kalshi, FedWatch"}


def _lista(x):
    return list(x or [])


def esegui_modulo(nome, B, posiz, adesso, rete=True, importa=importlib.import_module):
    """{'modulo', 'stato': letto | non eseguito, 'previsioni', 'righe', 'assenze', 'perche'} — tre esiti, mai un
    silenzio (v389). Ogni modulo con la sua firma: le chiamate stanno qui, in un posto solo."""
    out = {"modulo": nome, "titolo": TITOLI_MODULI.get(nome, nome), "previsioni": [], "righe": [], "assenze": [],
           "perche": None}
    try:
        m = importa(nome)
    except Exception as e:  # noqa: BLE001
        return dict(out, stato="non eseguito", perche=f"modulo non importabile ({type(e).__name__}: {str(e)[:120]})")
    # le posizioni: un dizionario {ticker: posizione} (statistica.universo, laboratorio); i moduli dei titoli le vogliono
    #   come elenco (brief.leggi_libro): la conversione sta qui, una volta sola
    elenco = list(posiz.values()) if isinstance(posiz, dict) else list(posiz or [])
    diz = posiz if isinstance(posiz, dict) else {p["tk"]: p for p in elenco}
    try:
        ass = []
        if nome == "previsioni_titoli":
            cal = m.calibrazione(B, adesso=adesso, veicoli="pipeline")
            prev = m.previsioni_oggi(B, elenco, adesso)
            ass = _lista(getattr(prev, "assenze", None))
            righe = m.resa(prev, cal)
        elif nome == "previsioni_opzioni":
            cal = m.calibrazione_lognormale(B, adesso=adesso)
            prev = m.previsioni_oggi(B, elenco, adesso, rete=rete, calibrazione=cal, assenze=ass)
            righe = m.resa(prev, cal, ass)
        elif nome == "previsioni_portafoglio":
            cal = m.calibrazione(B, adesso=adesso)
            prev = m.previsioni_oggi(B, diz, adesso, calib=cal)
            righe = m.resa(prev, cal)
        elif nome == "previsioni_macro":
            cal = m.calibrazione(rete=rete, adesso=adesso)
            prev = m.previsioni_oggi(adesso, rete=rete, assenze=ass)
            righe = m.resa(prev, cal, ass)
        elif nome == "mercati_previsione":
            cal = m.calibrazione(rete=rete, adesso=adesso)
            prev = m.previsioni_oggi(adesso, rete=rete)
            righe = m.resa(prev, cal, adesso=adesso)
        else:
            return dict(out, stato="non eseguito", perche="modulo sconosciuto all'orchestratore")
    except Exception as e:  # noqa: BLE001
        return dict(out, stato="non eseguito", perche=f"errore {type(e).__name__}: {str(e)[:160]}")
    righe = righe if isinstance(righe, list) else str(righe or "").splitlines()
    return dict(out, stato="letto", previsioni=list(prev or []), righe=righe, assenze=ass)


def da_registrare(previsioni, esistenti, B):
    """(da registrare, saltate per motivo) secondo la cadenza: un mercato esterno solo se la sua chiave non c'e' gia'; un
    metodo proprio solo se dalla sua ultima fotografia sono passate almeno CADENZA sedute (contate sulle barre del
    riferimento: sedute vere, non giorni di calendario)."""
    gia = {(r.get("chiave"), r.get("metodo")) for r in esistenti}
    ultima = {}
    for r in esistenti:
        m, g = r.get("metodo"), str(r.get("id", ""))[:10]
        if m and g and g > ultima.get(m, ""):
            ultima[m] = g
    giorni = [b["t"] for b in (B or {}).get(RIFERIMENTO_SEDUTE) or []]
    tieni, saltate = [], {}
    for p in previsioni:
        m = p.get("metodo")
        if m in ESTERNI:
            if (p.get("chiave"), m) in gia:
                saltate["mercato gia' registrato"] = saltate.get("mercato gia' registrato", 0) + 1
                continue
        elif m in ultima:
            dopo = sum(1 for t in giorni if t > ultima[m])
            if dopo < CADENZA and str(p.get("id", ""))[:10] != ultima[m]:
                k = f"{A.METODI.get(m, m)}: ultima fotografia del {ultima[m]}, {dopo} sedute fa (cadenza {CADENZA})"
                saltate[k] = saltate.get(k, 0) + 1
                continue
        tieni.append(p)
    return tieni, saltate


def pagina(B=None, posiz=None, adesso=None, rete=True, registra=True, moduli=MODULI, percorso=None,
           importa=importlib.import_module):
    """Le previsioni di oggi di tutti i moduli, il registro aggiornato (registra e risolve) e il bilancio dal vivo.
    {'adesso', 'esiti': [esegui_modulo], 'registro': {...} | None, 'perche_registro'}."""
    adesso = adesso or datetime.now(timezone.utc)
    if B is None or posiz is None:
        import laboratorio as LAB
        B, posiz = LAB.dati(adesso=adesso, rete=rete)
    esiti = [esegui_modulo(n, B, posiz, adesso, rete=rete, importa=importa) for n in moduli]
    tutte = [p for e in esiti for p in e["previsioni"]]
    reg, perche = None, None
    try:
        R = importa("registro_previsioni")
        kw = {"percorso": percorso} if percorso else {}
        if registra:
            esistenti = R.leggi(**kw).get("righe") or []
            nuove, saltate = da_registrare(tutte, esistenti, B)
            reg_esito = R.registra(nuove, adesso, B=B, **kw)
            if isinstance(reg_esito, dict):
                reg_esito["saltate_cadenza"] = saltate
            ris = R.risolvi_scadute(B, adesso, rete=rete, **kw)
        else:
            reg_esito, ris = None, None
        bil = R.bilancio(**kw)
        reg = {"registrate": reg_esito, "risolte": ris, "bilancio": bil, "n": R.n_previsioni(tutte),
               "righe": R.resa_bilancio(bil), "righe_risolvi": R.resa_risolvi(ris) if ris is not None else []}
    except Exception as e:  # noqa: BLE001
        perche = f"registro non eseguito: {type(e).__name__}: {str(e)[:160]}"
    return {"adesso": adesso, "esiti": esiti, "registro": reg, "perche_registro": perche, "n_oggi": len(tutte)}


def _righe(x):
    return x if isinstance(x, list) else str(x or "").splitlines()


def resa(pg):
    ora = pg["adesso"].astimezone(ROMA)
    L = [f"PREVISIONI (v536) — {ora:%d/%m/%Y %H:%M} ora italiana · eccezione MISURATA alla regola 1 (CEO, 03/11/2026): "
         "probabilita', non fatti — ognuna col suo metodo, la base, l'intervallo e l'affidabilita' misurata; i metodi "
         "stanno affiancati, mai mediati (v200)",
         f"  {pg['n_oggi']} previsioni di oggi da {sum(1 for e in pg['esiti'] if e['stato'] == 'letto')} moduli su "
         f"{len(pg['esiti'])}"]
    for e in pg["esiti"]:
        L.append("")
        L.append(f"{e['titolo']} — " + ("letto" if e["stato"] == "letto" else "⚠ NON ESEGUITO"))
        if e["perche"]:
            L.append(f"  ⚠ {e['perche']}")
        L += [f"  {r}" if not str(r).startswith("  ") else str(r) for r in _righe(e["righe"])]
    L.append("")
    reg = pg["registro"]
    if reg is None:
        L.append(f"REGISTRO DAL VIVO — ⚠ {pg['perche_registro']}")
    else:
        r = reg["registrate"] or {}
        L.append("REGISTRO DAL VIVO — memoria/previsioni.jsonl: l'affidabilita' che si misura nel tempo, non sul passato")
        if r:
            L.append(f"  registrate oggi {r.get('nuove', 0)} nuove · gia' presenti {r.get('gia_presenti', 0)}"
                     + (f" · scartate {len(r.get('scartate') or [])}" if r.get("scartate") else ""))
            for motivo, n in sorted((r.get("saltate_cadenza") or {}).items()):
                L.append(f"  non registrate per la cadenza: {n} — {motivo}")
        L += [f"  {x}" if not str(x).startswith("  ") else str(x) for x in _righe(reg["righe_risolvi"])]
        L += [f"  {x}" if not str(x).startswith("  ") else str(x) for x in _righe(reg["righe"])]
        from statistica import _n
        q = reg.get("n") or {}
        gruppi = q.get("gruppi") or {}
        if gruppi:
            L.append("  «QUANTE SE NE AVVERANO» — sulle previsioni aperte di oggi, metodo per metodo (lo stesso evento detto "
                     "da due metodi non sono due eventi, v200):")
        for metodo, v in sorted(gruppi.items(), key=lambda x: str(x[0])):
            if v.get("n"):
                nome = str(metodo)
                for k_, n_ in A.METODI.items():
                    nome = nome.replace(k_, n_) if nome.split(" (")[0] == k_ else nome
                L.append(f"    {nome}: {v['n']} previsioni, se ne attendono {_n(v['attese'], 1)}; "
                         f"almeno {v['k50']} con probabilita' {A._p(v['p50'])}, almeno {v['k90']} con {A._p(v['p90'])}")
        if gruppi and q.get("nota"):
            L.append(f"    {q['nota']}")
    return "\n".join(L)


def main(argv):
    cmd = (argv or ["pagina"])[0]
    if cmd == "pagina":
        pg = pagina()
        print(resa(pg))
        return 1 if any(e["stato"] != "letto" for e in pg["esiti"]) or pg["registro"] is None else 0
    if cmd in ("bilancio", "aperte"):
        R = importlib.import_module("registro_previsioni")
        print("\n".join(_righe(R.resa_bilancio(R.bilancio()) if cmd == "bilancio" else R.resa_aperte())))
        return 0
    print(f"comando sconosciuto: {cmd} — pagina | bilancio | aperte")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
