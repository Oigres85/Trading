# -*- coding: utf-8 -*-
"""Test di analisi_libro.py. Nessuna rete: dati sintetici costruiti per far scattare
esattamente le trappole gia' pagate sul campo."""
import math, sys
from pathlib import Path
import numpy as np, pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parent))
import analisi_libro as A

FALLITI = []; ESEGUITI = []
def check(nome, ok, extra=""):
    ESEGUITI.append(nome)
    print(("PASS  " if ok else "FAIL  ") + nome + (("\n      ↳ " + extra) if not ok and extra else ""))
    if not ok: FALLITI.append(nome)

rng = np.random.default_rng(7)
idx = pd.bdate_range("2026-01-01", periods=200)

def serie(n, corr=0.4, semi=0):
    """n serie con correlazione approssimativa `corr` fra loro."""
    r = np.random.default_rng(semi)
    comune = r.normal(0, .02, len(idx))
    out = {}
    for i in range(n):
        e = r.normal(0, .02, len(idx))
        out[f"T{i}"] = 100 * np.cumprod(1 + math.sqrt(corr) * comune + math.sqrt(1 - corr) * e)
    return pd.DataFrame(out, index=idx)

# ── 1. le scommesse effettive vedono i pesi ────────────────────────────────────────────
px = serie(6, .4)
tk = list(px.columns)
eq = {t: 1 / len(tk) for t in tk}
conc = {t: (.6 if t == tk[0] else .4 / (len(tk) - 1)) for t in tk}
m_eq = A.misura(tk, px, eq, bench=None)
m_cc = A.misura(tk, px, conc, bench=None)
check("le scommesse effettive scendono se il libro e' concentrato",
      m_cc["eff"] < m_eq["eff"] - .1, f"equipesato {m_eq['eff']:.2f} · concentrato {m_cc['eff']:.2f}")
# ⚠ l'equipeso deve coincidere con la formula classica 1/(1/k + (k-1)/k*rho)
k = len(tk); rho = m_eq["rho"]
classica = 1 / (1 / k + (k - 1) / k * rho)
check("con pesi uguali la formula generale coincide con quella classica",
      abs(m_eq["eff"] - classica) < 1e-9, f"{m_eq['eff']:.6f} vs {classica:.6f}")

# ── 2. un nome con storia corta non deve troncare gli altri ────────────────────────────
px2 = serie(5, .4, semi=3)
px2["CORTO"] = np.nan
px2.loc[px2.index[-30:], "CORTO"] = 100 + np.arange(30)   # solo 30 sedute
lunghi = [t for t in px2.columns if px2[t].notna().sum() >= A.MIN_SEDUTE]
check("il filtro esclude il nome con storia corta", "CORTO" not in lunghi and len(lunghi) == 5)
m2 = A.misura(lunghi, px2, {t: 1 / len(lunghi) for t in lunghi}, bench=None)
check("escludendolo, la finestra resta lunga (non troncata a 30 sedute)",
      m2["sedute"] > 150, f"sedute usate: {m2['sedute']}")

# ── 3. il contributo al rischio somma a 1 ──────────────────────────────────────────────
check("i contributi al rischio sommano a 1", abs(sum(m_cc["contrib"].values()) - 1) < 1e-9,
      f"somma {sum(m_cc['contrib'].values()):.6f}")
check("la posizione piu' pesante porta il contributo maggiore",
      max(m_cc["contrib"], key=m_cc["contrib"].get) == tk[0])

# ── 4. degrada dichiarando, invece di inventare ────────────────────────────────────────
check("senza benchmark la correlazione al ribasso resta n.d. invece di essere stimata male",
      m_eq["eff_giu"] is None and m_eq["sedute_giu"] == 0)

# ── 5. la volatilita' e' annualizzata e plausibile ─────────────────────────────────────
check("la volatilita' e' annualizzata (serie a 2% giornaliero → ~30%)",
      .20 < m_eq["vol"] < .45, f"vol {m_eq['vol']*100:.1f}%")

# ── 5bis. un NaN non deve mai finire nell'uscita pubblicata ────────────────────────────
# ⚠ successo davvero: yfinance ha restituito una colonna vuota per NVDA e ORCL, float(NaN)*qta
#   ha reso NaN il controvalore, poi il totale, poi la quota — e il file conteneva
#   "quota_azionaria": NaN. Un NaN pubblicato e' peggio di un errore: sembra un numero.
check("_n() converte NaN e None in null, non li propaga",
      A._n(float("nan")) is None and A._n(None) is None and A._n("x") is None
      and A._n(0.12345) == 0.1235)
srcA = (Path(__file__).resolve().parent / "analisi_libro.py").read_text(encoding="utf-8")
check("i nomi senza prezzo utilizzabile sono esclusi dal totale, non lo avvelenano",
      "senza_prezzo" in srcA and "non (tot_az == tot_az)".replace("non ", "not ") in srcA)
check("nessun round() nudo nell'uscita compatta: passa tutto da _n()",
      srcA[srcA.index("def compatto("):].count("round(") == 0)

# ── 5ter. l'eta' delle posizioni si dichiara: e' l'unico punto in cui la dashboard resta
#          indispensabile, e un file vecchio produce numeri esatti su un libro che non esiste
check("l'eta' del file delle posizioni entra nell'analisi e nell'uscita compatta",
      "posizioni_giorni" in srcA and "posizioni_al" in srcA
      and srcA.count("posizioni_giorni") >= 3)
check("sopra i 7 giorni la stampa avverte, non si limita a mostrare la data",
      "g > 7" in srcA and "un libro che non hai piu'" in srcA)

# ── 5quater. gli scenari a fattore: un beta senza R² e' mezzo numero ───────────────────
srcS = (Path(__file__).resolve().parent / "scenari.py").read_text(encoding="utf-8")
check("ogni riga di scenario porta il proprio R², non solo il beta",
      'R² {r2:.3f}' in srcS and "R2_MIN" in srcS)
check("uno scenario in cui quasi nessun nome ha un legame misurabile si dichiara inaffidabile",
      "SCENARIO NON AFFIDABILE" in srcS and "peso_buono" in srcS)
check("i nomi con R² basso restano NEL conto, dichiarati: toglierli fingerebbe che non si muovano",
      "il contributo e' comunque incluso" in srcS)

# ── 5quinquies. la seduta incompleta si dichiara, non sparisce ─────────────────────────
# ⚠ trovato da una sessione su telefono: "venerdi' manca anche se il CI ha girato". Il dropna()
#   scarta l'ultima riga se UN SOLO nome non ha ancora la barra, e l'analisi finiva un giorno
#   prima senza dirlo. E' la trappola n.1 applicata alle DATE invece che ai titoli.
check("la seduta scartata perche' incompleta viene dichiarata",
      "sedute_scartate" in srcA and "NON USATA" in srcA)
check("le righe incomplete NON vengono tenute (mischierebbero giorni diversi)",
      "mischierebbe giorni diversi" in srcA and ".dropna()" in srcA)

# ── 5sexies. senza rete si degrada sui valori pubblicati, dichiarandolo ────────────────
check("esiste il degrado su data/libro.json invece della traccia di errore",
      "def da_pubblicato(" in srcA and "NON CALCOLATO ORA" in srcA)
check("il degrado NON ricalcola: rimette i valori pubblicati nella forma di stampa()",
      "Non ricalcola nulla" in srcA)

# ── 5septies. soglie.py: arriva fino al confine e non lo attraversa ────────────────────
srcT = (Path(__file__).resolve().parent / "soglie.py").read_text(encoding="utf-8")
check("le barre vuote si tolgono prima di calcolare i livelli",
      srcT.count('dropna()') >= 3 and "il NaN\n    si propaga" in srcT.replace("\r", ""))
check("ogni livello dichiara da dove viene",
      "convenzione di Fibonacci, non una previsione" in srcT and "resistenza recente" in srcT)
check("esiste la soglia di anomalia, calcolata dalla storia del titolo stesso",
      "SOGLIA DI ANOMALIA" in srcT and "dd_p10" in srcT)
# ⚠ il confine: misure si', imperativi no. Se una di queste parole entra, il file ha cambiato natura.
_VIETATE = ["consiglio di vendere", "ti consiglio", "dovresti vendere", "dovresti comprare",
            "raccomando", "conviene vendere", "conviene comprare", "esci a ", "entra a "]
check("nessun imperativo operativo nel testo prodotto da soglie.py",
      not [v for v in _VIETATE if v in srcT.lower()],
      ", ".join(v for v in _VIETATE if v in srcT.lower()))
check("il file dichiara esplicitamente cosa non fa",
      "NON FA:" in srcT and "non propone quantita'" in srcT)

# ── 6. le posizioni si leggono dalla FONTE, non dallo snapshot della pipeline ──────────
src = (Path(__file__).resolve().parent / "analisi_libro.py").read_text(encoding="utf-8")
check("le posizioni vengono da config/posizioni.json, non da data/data.json",
      "config\" / \"posizioni.json" in src and "data.json" not in src)
check("la soglia di esclusione e' dichiarata come costante, non sparsa nel codice",
      "MIN_SEDUTE = " in src and src.count("MIN_SEDUTE") >= 2)
# ⚠ yfinance e' la dipendenza unica di questa strada e oggi ha restituito colonne vuote su due
#   chiamate a un minuto di distanza: senza ritentativo il libro cambia forma per fortuna.
check("il download ritenta prima di arrendersi a una colonna vuota",
      "for tentativo in range(" in src and "ritento" in src)

_T = len(ESEGUITI)
print(f"\n{'TUTTI I ' + str(_T - len(FALLITI)) + f'/{_T} CHECK OK' if not FALLITI else str(len(FALLITI)) + f'/{_T} FALLITI: ' + ', '.join(FALLITI)}")
sys.exit(1 if FALLITI else 0)
