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

# ── 6. le posizioni si leggono dalla FONTE, non dallo snapshot della pipeline ──────────
src = (Path(__file__).resolve().parent / "analisi_libro.py").read_text(encoding="utf-8")
check("le posizioni vengono da config/posizioni.json, non da data/data.json",
      "config\" / \"posizioni.json" in src and "data.json" not in src)
check("la soglia di esclusione e' dichiarata come costante, non sparsa nel codice",
      "MIN_SEDUTE = " in src and src.count("MIN_SEDUTE") >= 3)

_T = len(ESEGUITI)
print(f"\n{'TUTTI I ' + str(_T - len(FALLITI)) + f'/{_T} CHECK OK' if not FALLITI else str(len(FALLITI)) + f'/{_T} FALLITI: ' + ', '.join(FALLITI)}")
sys.exit(1 if FALLITI else 0)
