# -*- coding: utf-8 -*-
"""SCENARI A FATTORE — "se X si muove di Y, il libro quanto fa?"

E' la misura che manca a libro.json e che una chat non puo' calcolare: richiede di rieseguire
le regressioni sui rendimenti giornalieri. E' anche la domanda che un gestore fa davvero,
perche' converte "ecco il tuo rischio" in "ecco cosa succede se".

⚠ UN BETA SENZA IL SUO R² E' MEZZO NUMERO. Se un canale spiega il 2% della varianza di un nome,
   il suo beta non e' una sensibilita': e' rumore stimato con tre decimali. Qui ogni riga porta
   l'R², e i nomi sotto la soglia entrano nello scenario con il loro beta DICHIARATO INAFFIDABILE.

⚠ E' una relazione STORICA su una finestra, non una legge: dice come il libro si e' mosso
   finora quando quel fattore si muoveva, non come si muovera'.

uso:  python3 scripts/scenari.py                    → i tre scenari standard
      python3 scripts/scenari.py SOXX -20 NDX -10   → scenari su misura
"""
import json, math, sys
from pathlib import Path

R2_MIN = 0.05          # sotto questa soglia il canale non e' un canale su questa finestra
FINESTRA = "9mo"
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

CANALI = {
    "SOXX": "semiconduttori", "QQQ": "Nasdaq 100", "TLT": "tassi a lunga (TLT sale se i tassi scendono)",
    "UUP": "dollaro", "SPY": "S&P 500", "GLD": "oro",
}
STANDARD = [("SOXX", -20), ("QQQ", -10), ("TLT", -5)]


def beta_r2(y, x):
    """Beta e R² di y su x, sulle sedute IN COMUNE (allineate per data, non per posizione)."""
    d = y.to_frame("y").join(x.to_frame("x"), how="inner").dropna()
    if len(d) < 60:
        return None, None, len(d)
    vx = d["x"].var()
    if not vx:
        return None, None, len(d)
    b = d["y"].cov(d["x"]) / vx
    r = d["y"].corr(d["x"])
    return b, r * r, len(d)


def non_si_puo(e):
    """Perche' NON esiste un fallback su libro.json per gli scenari, e fingerlo sarebbe peggio.

    ⚠⚠ rapporto.py degrada su data/libro.json perche' quello che stampa — misure e prezzi — sta
    dentro quel file. Qui no: libro.json pubblica PESI, CORRELAZIONI FRA I NOMI DEL LIBRO e
    volatilita', non i RENDIMENTI GIORNALIERI, e senza quelli un beta non si stima. Le
    correlazioni che contiene sono interne al libro, non verso SOXX/QQQ/TLT: non c'e' niente da
    cui ricavare questi scenari. Stampare comunque dei numeri sarebbe la classe di difetto che
    questo progetto rifiuta da sempre — un numero nostro travestito da misura.
    Quello che si puo' fare, e che prima non si faceva, e' non morire con un traceback: dire
    quale fonte e' mancata, cosa servirebbe, e che cosa resta disponibile al suo posto."""
    print("SCENARI A FATTORE — NON CALCOLABILI IN QUESTO RUN")
    print(f"   causa: {type(e).__name__}: {str(e)[:120]}")
    print("   servono i rendimenti giornalieri dei titoli E dei fattori (SOXX/QQQ/TLT…) sulla")
    print("   stessa finestra: si scaricano al momento, e la rete non ha risposto.")
    print("   ⚠ NON c'e' un ripiego su data/libro.json: quel file porta misure gia' calcolate")
    print("     (pesi, volatilita', correlazioni FRA I NOMI DEL LIBRO), non le serie da cui si")
    print("     stimano i beta verso un fattore esterno. Inventarli sarebbe peggio del guasto.")
    try:
        c = json.loads((ROOT / "data" / "libro.json").read_text(encoding="utf-8"))
        print(f"   resta disponibile libro.json (seduta {c.get('al')}, generato "
              f"{str(c.get('generato'))[:16]}): pesi, contributo al rischio, correlazioni,")
        print("   volatilita' per nome — cioe' DOVE sta il rischio, non COSA SUCCEDE SE.")
    except Exception:
        print("   ⚠ e data/libro.json non e' leggibile: non resta nessuna misura del libro.")


def main():
    import yfinance as yf
    import analisi_libro as A
    try:
        a = A.analizza()
    except (Exception, SystemExit) as e:
        non_si_puo(e)
        return 1
    pesi = a["pesi"]
    tk = list(pesi)
    arg = [x for x in sys.argv[1:] if not x.startswith("-") or x.lstrip("-").replace(".", "").isdigit()]
    scen = STANDARD if len(arg) < 2 else [(arg[i].upper(), float(arg[i + 1])) for i in range(0, len(arg) - 1, 2)]
    fattori = sorted({s[0] for s in scen})
    px = yf.download(tk + fattori, period=FINESTRA, interval="1d", auto_adjust=True,
                     progress=False, group_by="column")["Close"]
    R = px.pct_change()

    print(f"SCENARI A FATTORE — libro al {a['al']}, {a['sedute']} sedute")
    if a.get("esclusi"):
        print("⚠ fuori dal conto: " + ", ".join(f"{t} ({a['perche_esclusi'].get(t, '?')})"
                                                for t in a["esclusi"]))
    q = a.get("quota_az")
    for f, shock in scen:
        if f not in R.columns:
            print(f"\n{f}: dati non disponibili, scenario non calcolabile")
            continue
        tot, deboli, righe = 0.0, [], []
        for t in tk:
            b, r2, n = beta_r2(R[t], R[f])
            if b is None:
                deboli.append(f"{t} (meno di 60 sedute in comune)")
                continue
            if r2 < R2_MIN:
                deboli.append(f"{t} (R² {r2:.3f})")
            tot += pesi[t] * b * shock
            righe.append((t, pesi[t], b, r2, pesi[t] * b * shock))
        nome = CANALI.get(f, f)
        peso_buono = sum(w for _, w, _, r2, _ in righe if r2 >= R2_MIN)
        r2_medio = sum(w * r2 for _, w, _, r2, _ in righe) / max(sum(w for _, w, _, _, _ in righe), 1e-9)
        affid = ("" if peso_buono >= .5 else
                 f"\n   ⚠⚠ SCENARIO NON AFFIDABILE: solo il {peso_buono*100:.0f}% del libro ha un legame "
                 f"misurabile con questo canale (R² medio pesato {r2_medio:.3f}). Il numero qui sopra e' "
                 f"la somma di beta stimati su rumore: NON e' una previsione, e' un'aritmetica su relazioni "
                 f"che su questa finestra non esistono.")
        print(f"\n═══ {nome} ({f}) {shock:+.0f}%  →  libro {tot:+.1f}% sull'azionario"
              + (f", {tot*q:+.1f}% sul patrimonio" if q else "") + " ═══" + affid)
        for t, w, b, r2, c in sorted(righe, key=lambda x: x[4]):
            seg = "  ⚠ R² basso: contributo non affidabile" if r2 < R2_MIN else ""
            print(f"   {t:6} peso {w*100:5.1f}%  beta {b:+5.2f}  R² {r2:.3f}  → {c:+6.2f}%{seg}")
        if deboli:
            print(f"   ⚠ canale NON misurabile su: {', '.join(deboli)} — il loro beta e' rumore, "
                  f"ma il contributo e' comunque incluso: toglierlo fingerebbe che quei nomi non si muovano")


if __name__ == "__main__":
    # ⚠ il codice d'uscita deve dire la verita': 1 quando gli scenari non sono stati prodotti.
    #   Un'uscita 0 senza scenari e' la classe "verde per assenza", gia' pagata su test_app.mjs.
    sys.exit(main() or 0)
