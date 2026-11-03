#!/usr/bin/env python3
"""v532 — IL LABORATORIO DEL PORTAFOGLIO: nove librerie open source, una domanda ciascuna.

Decisione del CEO del 03/11/2026, testuale: *"procedi su tutti"*, sui progetti GitHub proposti per l'analisi del
portafoglio e la statistica dei mercati. Ogni libreria risponde a UNA domanda che il sistema non si faceva, e non
ricalcola cio' che il sistema gia' misura (v161: una grandezza, una derivazione):

- rendimento        (QuantStats)      come si e' comportato il portafoglio di oggi contro QQQ e SMH: Sharpe, Sortino,
                                      calo massimo, Calmar, giorno peggiore, giorni positivi;
- rischio           (Riskfolio-Lib)   la perdita media nei giorni peggiori (CVaR al 95%), il calo massimo e quello medio
                                      nelle fasi peggiori (CDaR), chi porta quel rischio, e come la diversificazione
                                      gerarchica (HRP) distribuirebbe il rischio fra gli stessi titoli;
- robusta           (PyPortfolioOpt)  la volatilita' con una stima delle correlazioni che non si fida del rumore
                                      (Ledoit-Wolf), e il minimo che gli stessi titoli permetterebbero;
- fuori_campione    (skfolio)         un ottimizzatore avrebbe battuto DAVVERO i pesi di oggi, su dati che non aveva visto?
- diversificazione  (bt)              il portafoglio di oggi contro lo stesso con una quota nei settori che mancano
                                      (salute, beni di prima necessita', energia), ribilanciato ogni mese;
- salvavita         (vectorbt)        la regola del salvavita a soglie diverse sul passato di SMH e QQQ;
- volatilita        (arch)            la volatilita' di adesso secondo un modello GARCH, contro la sua media lunga;
- regimi            (hmmlearn)        calmo o in tensione: un riconoscimento dei regimi dai soli rendimenti, controllo
                                      indipendente delle sei luci della sintesi;
- costi             (cvxportfolio)    NON integrata, per scelta dichiarata: vedi COSTI qui sotto.

Le regole del CEO valgono anche qui:
- NESSUNA PROIEZIONE (CLAUDE.md, istruzione 1): solo misure sul passato e stime dello STATO di adesso dei modelli
  (volatilita', regime), dichiarate come stime di un modello, mai come previsioni di prezzo;
- NESSUNA «QUANTITA' GIUSTA» (v439): i pesi di un ottimizzatore sono un termometro della concentrazione, non un ordine;
- il PORTAFOGLIO DI OGGI (quantita' di LIBRO.md §1, prezzi dell'ultima chiusura) e' riportato sul passato coi pesi di
  oggi, ribilanciati ogni giorno: non e' il rendimento che il CEO ha avuto, e' come si sarebbe comportato questo
  portafoglio. ⚠ I nomi sono quelli scelti OGGI, cioe' anche sopravvissuti: il passato pende verso chi e' andato bene;
- le ASSENZE si dichiarano (v389, v406): una libreria non installata, un nome con la storia corta, una serie non letta
  si nominano col perche', non spariscono;
- le soglie sono CONVENZIONI dichiarate (v240), qui sotto, mai proposte.

Uso:
  python3 scripts/laboratorio.py                     tutte le sezioni
  python3 scripts/laboratorio.py rischio regimi      solo quelle nominate
  python3 scripts/laboratorio.py riassunto           le tre righe dell'analisi (v533): giorni peggiori, regime, volatilita'
Le librerie: pip install -r scripts/requirements_laboratorio.txt (fuori dalla pipeline dei dati: non la appesantiscono).
Non scrive memorie: legge le barre di statistica.py (memoria/dati, fuori da git).
"""
import importlib
import math
import os
import sys
import warnings
from datetime import datetime, timezone

QUI = os.path.dirname(os.path.abspath(__file__))
if QUI not in sys.path:
    sys.path.insert(0, QUI)

import statistica as SA  # noqa: E402

warnings.filterwarnings("ignore")

FINESTRA = 252                      # un anno di sedute per il portafoglio di oggi
STORIA_LUNGA = 1260                 # cinque anni per i riferimenti (regimi, volatilita', salvavita)
RIFERIMENTI = ("QQQ", "SMH")
DIVERSIFICANTI = ("XLV", "XLP", "XLE")      # salute, beni di prima necessita', energia: i settori che mancano al libro
QUOTE_DIVERSIFICATE = (0, 20, 40)           # % del portafoglio nei diversificanti: varianti di convenzione, non proposte
SOGLIE_SALVAVITA = (-20, -25, -30, -35, -40)  # % dal massimo; il salvavita del libro e' a -30% (LIBRO.md §1ter)
MEDIA_RIENTRO = 200                 # dopo l'uscita si rientra con la chiusura sopra la media a 200: convenzione del test
ALFA = 0.05                         # CVaR e CDaR al 95%: la media del 5% dei giorni (o dei cali) peggiori
ALLENAMENTO = 126                   # fuori campione: sei mesi per stimare, un mese per provare, poi si scorre
PROVA = 21
STATI_REGIME = 2                    # calmo e in tensione
SEMENTE = 0                         # i modelli con una partenza casuale partono sempre dallo stesso punto

SEZIONI = ("rendimento", "rischio", "robusta", "fuori_campione", "diversificazione", "salvavita", "volatilita",
           "regimi", "costi")
LIBRERIE = {"rendimento": "quantstats", "rischio": "riskfolio", "robusta": "pypfopt", "fuori_campione": "skfolio",
            "diversificazione": "bt", "salvavita": "vectorbt", "volatilita": "arch", "regimi": "hmmlearn",
            "costi": "cvxportfolio"}
TITOLI = {"rendimento": "RENDIMENTO E CALI DEL PORTAFOGLIO DI OGGI (QuantStats)",
          "rischio": "IL RISCHIO NEI GIORNI PEGGIORI E CHI LO PORTA (Riskfolio-Lib)",
          "robusta": "LA VOLATILITA' CON UNA STIMA ROBUSTA (PyPortfolioOpt)",
          "fuori_campione": "UN OTTIMIZZATORE AVREBBE BATTUTO I PESI DI OGGI? (skfolio, fuori campione)",
          "diversificazione": "IL PORTAFOGLIO DI OGGI CONTRO LO STESSO CON UNA QUOTA DIVERSIFICATA (bt)",
          "salvavita": "IL SALVAVITA A SOGLIE DIVERSE, SUL PASSATO (vectorbt)",
          "volatilita": "LA VOLATILITA' DI ADESSO SECONDO UN MODELLO (arch, GARCH)",
          "regimi": "CALMO O IN TENSIONE: I REGIMI DAI RENDIMENTI (hmmlearn)",
          "costi": "COSTI E TASSE DEL RIBILANCIAMENTO (cvxportfolio)"}
NON_INTEGRATA = {"costi": "non integrata, per scelta dichiarata (v161): l'imposta in euro di una vendita, col cambio "
                          "d'acquisto e di vendita, la calcola gia' numeri_libro.py (LIBRO.md §1decies, blocco «CAMBIO "
                          "EURO/DOLLARO») secondo le regole italiane, che cvxportfolio non conosce; i suoi modelli di "
                          "costo sono per l'impatto di mercato di ordini istituzionali (con 15 $ a operazione il costo "
                          "del CEO e' la commissione) e chiedono un proprio archivio di dati. Integrarla darebbe una "
                          "seconda imposta, sbagliata, accanto a quella giusta"}


def _n(x, d=1, segno=False):
    return SA._n(x, d, segno)


def _p(x, d=1, segno=False):
    """Una frazione in punti percentuali, col formattatore unico (virgola decimale)."""
    return "n.d." if x is None or (isinstance(x, float) and math.isnan(x)) else _n(100 * x, d, segno) + "%"


def _usd(x):
    return "n.d." if x is None else f"{x:,.0f}".replace(",", ".") + " $"


def _lib(nome):
    """(modulo, None) oppure (None, il perche'): una libreria assente si dichiara, non spegne il resto (v389)."""
    try:
        return importlib.import_module(nome), None
    except Exception as e:  # noqa: BLE001
        return None, (f"libreria {nome} non installata ({type(e).__name__}): "
                      "pip install -r scripts/requirements_laboratorio.txt")


# ───────────────────────── i dati: le barre di statistica.py, una lettura sola ─────────────────────────

def chiusure(barre):
    """{data: chiusura} della serie della societa' di oggi (statistica.serie, v492): la rettificata quando c'e'
    (dividendi e frazionamenti), altrimenti la chiusura."""
    out = {}
    for x in SA.serie(barre or []):
        v = x.get("a") or x.get("c")
        if v:
            out[x["t"]] = float(v)
    return out


def dati(adesso=None, rete=True):
    """(barre, posizioni) — l'universo di statistica.py piu' i riferimenti e i diversificanti: la cache resta un
    sovrainsieme, e statistica.py la ritrova (una lettura sola)."""
    nomi, posiz = SA.universo()
    extra = [t for t in RIFERIMENTI + DIVERSIFICANTI if t not in nomi]
    return SA.leggi_barre(nomi + extra, adesso=adesso, rete=rete), posiz


def portafoglio(B, posiz, finestra=FINESTRA):
    """Il portafoglio di oggi riportato sul passato. I pesi: quantita' di LIBRO.md × ultima chiusura. Le date si
    allineano per DATA (v207, v393): contano solo i giorni in cui TUTTI i nomi dentro hanno una chiusura. Un nome con
    meno di finestra+1 chiusure esce dal calcolo storico e si nomina col suo peso (v389). None se non resta nessuno."""
    import pandas as pd
    valori, esclusi = {}, {}
    for tk, p in sorted(posiz.items()):
        b = B.get(tk)
        if not b:
            esclusi[tk] = "barre non lette"
            continue
        valori[tk] = float(p["qta"]) * float(b[-1]["c"])
    tot = sum(valori.values())
    serie = {tk: chiusure(B[tk]) for tk in valori}
    dentro = {tk: s for tk, s in serie.items() if len(s) > finestra}
    for tk in valori:
        if tk not in dentro:
            esclusi[tk] = f"storia corta: {len(serie[tk])} sedute della societa' di oggi (ne servono {finestra + 1})"
    if not dentro:
        return None
    comuni = sorted(set.intersection(*(set(s) for s in dentro.values())))[-(finestra + 1):]
    prezzi = pd.DataFrame({tk: [dentro[tk][d] for d in comuni] for tk in dentro}, index=pd.to_datetime(comuni))
    rend = prezzi.pct_change().iloc[1:]
    v_dentro = sum(valori[tk] for tk in dentro)
    w = pd.Series({tk: valori[tk] / v_dentro for tk in dentro})
    return {"prezzi": prezzi, "rend": rend, "w": w, "rp": rend @ w, "valore": tot, "valore_dentro": v_dentro,
            "esclusi": esclusi, "peso": {tk: v / tot for tk, v in valori.items()} if tot else {},
            "dal": comuni[0], "al": comuni[-1]}


def riferimento(B, tk, date=None, lunga=None):
    """I rendimenti giornalieri di un riferimento: sulle date del portafoglio (date) o sulle ultime `lunga` sedute."""
    import pandas as pd
    s = chiusure(B.get(tk))
    if not s:
        return None
    px = pd.Series(s)
    px.index = pd.to_datetime(px.index)
    px = px.sort_index()
    if date is not None:
        px = px.reindex(date)
        if px.isna().any():
            return None
    elif lunga:
        px = px.iloc[-(lunga + 1):]
    return px


# ───────────────────────── le sezioni: una libreria, una domanda ─────────────────────────

def s_rendimento(P, B):
    qs, err = _lib("quantstats")
    if err:
        return None, err
    serie = [("portafoglio di oggi", P["rp"])]
    for tk in RIFERIMENTI:
        px = riferimento(B, tk, date=P["prezzi"].index)
        serie.append((tk, px.pct_change().iloc[1:] if px is not None else None))
    R = []
    for nome, s in serie:
        if s is None:
            R.append(f"{nome}: serie non letta sulle stesse date")
            continue
        R.append(f"{nome}: rendimento sulla finestra {_p(qs.stats.comp(s), 1, True)} · volatilita' annua "
                 f"{_p(qs.stats.volatility(s))} · Sharpe {_n(qs.stats.sharpe(s), 2)} · Sortino {_n(qs.stats.sortino(s), 2)}"
                 f" · calo massimo {_p(qs.stats.max_drawdown(s))} · Calmar {_n(qs.stats.calmar(s), 2)} · giorno peggiore "
                 f"{_p(qs.stats.worst(s))} · giorni positivi {_p(qs.stats.win_rate(s), 0)}")
    R.append("Sharpe e Sortino a tasso zero (convenzione della libreria): misurano il rendimento per unita' di "
             "oscillazione, non contro il BTP")
    return R, None


def rischio_base(P):
    """(cvar, calo massimo, cdar, [(ticker, quota del CVaR, peso)] dal piu' grande), oppure (None, il perche')."""
    rp, err = _lib("riskfolio")
    if err:
        return None, err
    import numpy as np
    X, w, r = P["rend"], P["w"], P["rp"].values
    rc = np.asarray(rp.Risk_Contribution(w.values.reshape(-1, 1), returns=X, cov=X.cov(), rm="CVaR", alpha=ALFA)).ravel()
    quota = rc / rc.sum() if rc.sum() else rc
    chi = sorted(((w.index[i], float(quota[i]), float(w.iloc[i])) for i in range(len(w))), key=lambda x: -x[1])
    return (float(rp.RiskFunctions.CVaR_Hist(r, alpha=ALFA)), float(rp.RiskFunctions.MDD_Rel(r)),
            float(rp.RiskFunctions.CDaR_Rel(r, alpha=ALFA)), chi), None


def s_rischio(P, B):
    rb, err = rischio_base(P)
    if err:
        return None, err
    rp, _ = _lib("riskfolio")
    X, w = P["rend"], P["w"]
    cvar, mdd, cdar, chi = rb
    R = [f"nel 5% dei giorni peggiori della finestra la perdita media e' stata {_p(cvar)} al giorno (CVaR al 95%): "
         f"sul valore di oggi dei nomi dentro, circa {_usd(cvar * P['valore_dentro'])} · calo massimo {_p(mdd)} · "
         f"calo medio nel 5% delle fasi peggiori {_p(cdar)} (CDaR)"]
    R.append("chi porta il rischio dei giorni peggiori (quota del CVaR contro il peso): " + " · ".join(
        f"{tk} {_p(q, 0)} col {_p(p, 0)} del peso" for tk, q, p in chi[:6]))
    hrp = rp.HCPortfolio(returns=X).optimization(model="HRP", codependence="pearson", rm="MV", rf=0,
                                                 linkage="single", leaf_order=True)
    h = hrp.iloc[:, 0] if hasattr(hrp, "iloc") else hrp
    top = w.sort_values(ascending=False).index[:6]
    R.append("la diversificazione gerarchica (HRP), che usa solo come i titoli si muovono insieme, sugli stessi nomi: "
             + " · ".join(f"{tk} {_p(w[tk], 0)} → {_p(float(h[tk]), 0)}" for tk in top)
             + " — un termometro della concentrazione, non pesi da eseguire (v439)")
    return R, None


def s_robusta(P, B):
    pf, err = _lib("pypfopt")
    if err:
        return None, err
    import numpy as np
    from pypfopt import risk_models, EfficientFrontier
    w = P["w"].values
    camp = risk_models.sample_cov(P["prezzi"], frequency=SA.SEDUTE_ANNO)
    lw = risk_models.CovarianceShrinkage(P["prezzi"], frequency=SA.SEDUTE_ANNO).ledoit_wolf()
    v_camp = float(np.sqrt(w @ camp.values @ w))
    v_lw = float(np.sqrt(w @ lw.values @ w))
    ef = EfficientFrontier(None, lw, weight_bounds=(0, 1))
    pesi_min = ef.min_volatility()          # una volta sola: il problema risolto non si riapre
    wm = np.array([pesi_min[tk] for tk in P["w"].index])
    v_min = float(np.sqrt(wm @ lw.values @ wm))
    usati = int((wm > 0.01).sum())
    return [f"volatilita' annua del portafoglio di oggi sulla finestra: {_p(v_camp)} con la stima campionaria, "
            f"{_p(v_lw)} con quella robusta (Ledoit-Wolf, che toglie una parte del rumore alle correlazioni)",
            f"con gli STESSI titoli la volatilita' piu' bassa possibile sarebbe {_p(v_min)} (userebbe {usati} nomi su "
            f"{len(wm)}): la distanza da {_p(v_lw)} e' il prezzo della concentrazione di oggi, non un'indicazione di pesi",
            "la volatilita' del libro che vale per le decisioni resta quella di numeri_libro.py: questa e' sulla "
            "finestra del laboratorio e dice di quanto cambia con una stima robusta"], None


def s_fuori_campione(P, B):
    sk, err = _lib("skfolio")
    if err:
        return None, err
    from skfolio import Portfolio
    from skfolio.model_selection import WalkForward, cross_val_predict
    from skfolio.optimization import EqualWeighted, HierarchicalRiskParity, MeanRisk, ObjectiveFunction
    X = P["rend"]
    if len(X) < ALLENAMENTO + PROVA:
        return [f"finestra di {len(X)} sedute: ne servono {ALLENAMENTO + PROVA} per una prova fuori campione"], None
    coperte = ((len(X) - ALLENAMENTO) // PROVA) * PROVA
    oggi = Portfolio(X.iloc[ALLENAMENTO:ALLENAMENTO + coperte], weights=P["w"].values)
    cv = WalkForward(train_size=ALLENAMENTO, test_size=PROVA)
    modelli = (("pesi uguali", EqualWeighted()), ("diversificazione gerarchica", HierarchicalRiskParity()),
               ("minimo rischio", MeanRisk(objective_function=ObjectiveFunction.MINIMIZE_RISK)))
    R = [f"sulle stesse {coperte} sedute di prova, ogni modello stimato SOLO sulle {ALLENAMENTO} sedute prima di ogni "
         f"mese di prova e poi rifatto: chi avrebbe reso di piu' per unita' di rischio, su dati che non aveva visto"]

    def riga(nome, p):
        return (f"{nome}: rendimento annuo {_p(p.annualized_mean, 1, True)} · volatilita' {_p(p.annualized_standard_deviation)}"
                f" · Sharpe {_n(p.annualized_sharpe_ratio, 2)} · calo massimo {_p(p.max_drawdown)}")
    R.append(riga("i pesi di oggi, fermi", oggi))
    for nome, m in modelli:
        R.append(riga(nome, cross_val_predict(m, X, cv=cv)))
    R.append(f"⚠ {coperte // PROVA} mesi di prova: un indizio, non una legge; i nomi sono gli stessi per tutti (scelti "
             f"oggi), quindi il confronto e' alla pari, ma tutti pendono verso i sopravvissuti")
    return R, None


def s_diversificazione(P, B):
    bt, err = _lib("bt")
    if err:
        return None, err
    import pandas as pd
    date = P["prezzi"].index
    div = {}
    for tk in DIVERSIFICANTI:
        px = riferimento(B, tk, date=date)
        if px is None:
            return [f"{tk}: serie non letta sulle stesse date — il confronto non si fa senza tutti i diversificanti"], None
        div[tk] = px
    dati_bt = pd.concat([P["prezzi"], pd.DataFrame(div)], axis=1)
    prove = []
    for q in QUOTE_DIVERSIFICATE:
        pesi = {tk: float(v) * (1 - q / 100) for tk, v in P["w"].items()}
        pesi.update({tk: q / 100 / len(DIVERSIFICANTI) for tk in DIVERSIFICANTI})
        s = bt.Strategy(f"{q}%", [bt.algos.RunMonthly(run_on_first_date=True), bt.algos.SelectAll(),
                                  bt.algos.WeighSpecified(**pesi), bt.algos.Rebalance()])
        prove.append(bt.Backtest(s, dati_bt, integer_positions=False, progress_bar=False))
    st = bt.run(*prove).stats
    R = [f"stessa finestra, ribilanciamento mensile; la quota va in parti uguali su {', '.join(DIVERSIFICANTI)} "
         f"(salute, beni di prima necessita', energia) — varianti di convenzione, non una proposta di quantita' (v439)"]
    for q in QUOTE_DIVERSIFICATE:
        c = st[f"{q}%"]
        R.append(f"{q}% diversificato: rendimento {_p(float(c['total_return']), 1, True)} · calo massimo "
                 f"{_p(float(c['max_drawdown']))} · volatilita' annua {_p(float(c['daily_vol']))} · Sharpe "
                 f"{_n(float(c['daily_sharpe']), 2)}")
    return R, None


def salvavita_su(px, soglie=SOGLIE_SALVAVITA, media=MEDIA_RIENTRO):
    """La regola su una serie di prezzi: si esce quando il prezzo scende di |soglia|% dal massimo toccato DALL'INGRESSO
    (stop mobile), si rientra con la chiusura sopra la media a `media` sedute; il primo giorno si e' dentro. Una
    versione semplificata del salvavita del libro (che vende un terzo dei semiconduttori): esce tutto, rientra sopra
    la media — convenzione del test, dichiarata."""
    vbt, err = _lib("vectorbt")
    if err:
        return None, err
    entrate = px > px.rolling(media).mean()
    entrate.iloc[0] = True
    base = vbt.Portfolio.from_holding(px, init_cash=100, freq="1D")
    out = [{"soglia": None, "rend": float(base.total_return()), "mdd": float(base.max_drawdown()), "uscite": 0}]
    for s in soglie:
        pf = vbt.Portfolio.from_signals(px, entries=entrate, exits=False, sl_stop=abs(s) / 100, sl_trail=True,
                                        init_cash=100, freq="1D")
        out.append({"soglia": s, "rend": float(pf.total_return()), "mdd": float(pf.max_drawdown()),
                    "uscite": int(pf.trades.count())})
    return out, None


def _periodi(n):
    return f"{n} periodo investito" if n == 1 else f"{n} periodi investiti"


def s_salvavita(P, B):
    R = [f"si esce al -X% dal massimo toccato dall'ingresso, si rientra con la chiusura sopra la media a {MEDIA_RIENTRO}: "
         "una versione semplificata del salvavita (che vende un terzo dei semiconduttori), sui cinque anni dei "
         "riferimenti — SMH e' il cuore del libro (65-70% in semiconduttori)"]
    for tk in RIFERIMENTI:
        px = riferimento(B, tk, lunga=STORIA_LUNGA)
        if px is None or len(px) < MEDIA_RIENTRO + 2:
            R.append(f"{tk}: serie non letta o troppo corta")
            continue
        esiti, err = salvavita_su(px)
        if err:
            return None, err
        R.append(f"{tk} dal {px.index[0].date():%d/%m/%Y}: " + " · ".join(
            ("tenere sempre" if e["soglia"] is None else f"{e['soglia']}%") + f" {_p(e['rend'], 0, True)} (calo massimo "
            f"{_p(e['mdd'], 0)}" + ("" if e["soglia"] is None else f", {_periodi(e['uscite'])}") + ")" for e in esiti))
    R.append("periodi investiti = il primo ingresso piu' ogni rientro: ogni uscita e rientro e' una vendita con la "
             "sua imposta, che qui non e' contata")
    return R, None


def garch(r):
    """(volatilita' dell'ultima seduta, media lunga, persistenza) in % al giorno, da un GARCH(1,1) con code spesse."""
    am, err = _lib("arch")
    if err:
        return None, err
    from arch import arch_model
    res = arch_model(100 * r, mean="Constant", vol="GARCH", p=1, q=1, dist="t").fit(disp="off")
    om, a, b = (float(res.params[k]) for k in ("omega", "alpha[1]", "beta[1]"))
    lungo = math.sqrt(om / (1 - a - b)) if a + b < 1 else None
    return {"oggi": float(res.conditional_volatility.iloc[-1]), "lungo": lungo, "persistenza": a + b}, None


def s_volatilita(P, B):
    R = []
    g, err = garch(P["rp"])
    if err:
        return None, err
    R.append(f"portafoglio di oggi: volatilita' dell'ultima seduta secondo il modello {_n(g['oggi'], 2)}% al giorno, "
             f"circa ±{_usd(g['oggi'] / 100 * P['valore_dentro'])} sui nomi dentro · media lunga del modello "
             + (f"{_n(g['lungo'], 2)}%" if g["lungo"] else "n.d. (persistenza ≥ 1)") + f" · persistenza {_n(g['persistenza'], 2)}")
    for tk in RIFERIMENTI:
        px = riferimento(B, tk, lunga=STORIA_LUNGA)
        if px is None:
            R.append(f"{tk}: serie non letta")
            continue
        g, _ = garch(px.pct_change().iloc[1:])
        R.append(f"{tk} (cinque anni): {_n(g['oggi'], 2)}% al giorno adesso contro una media lunga di "
                 + (f"{_n(g['lungo'], 2)}%" if g["lungo"] else "n.d.") + f" · persistenza {_n(g['persistenza'], 2)}")
    R.append("una STIMA dello stato di adesso (quanto oscilla il mercato in questi giorni), non una previsione del "
             "prezzo; il costo dell'attesa ufficiale resta quello di numeri_libro.py")
    return R, None


def regimi(r, semente=SEMENTE):
    """Due regimi dai rendimenti: {'tensione_oggi', 'quota', 'durata', 'vol': (calmo, tensione), 'media': (...)}.
    Il regime di tensione e' quello con la varianza piu' alta."""
    hm, err = _lib("hmmlearn")
    if err:
        return None, err
    import numpy as np
    from hmmlearn.hmm import GaussianHMM
    X = np.asarray(r, dtype=float).reshape(-1, 1)
    m = GaussianHMM(n_components=STATI_REGIME, covariance_type="full", n_iter=200, random_state=semente).fit(X)
    var = np.asarray(m.covars_).reshape(STATI_REGIME, -1)[:, 0]
    t = int(np.argmax(var))
    c = 1 - t
    stati = m.predict(X)
    corse, n = [], 0
    for s in stati:
        if s == t:
            n += 1
        elif n:
            corse.append(n)
            n = 0
    if n:
        corse.append(n)
    mu = np.asarray(m.means_).reshape(STATI_REGIME, -1)[:, 0]
    return {"tensione_oggi": float(m.predict_proba(X)[-1][t]), "quota": float((stati == t).mean()),
            "durata": (sum(corse) / len(corse)) if corse else None, "periodi": len(corse),
            "vol": (math.sqrt(var[c] * SA.SEDUTE_ANNO), math.sqrt(var[t] * SA.SEDUTE_ANNO)),
            "media": (float(mu[c]), float(mu[t]))}, None


def s_regimi(P, B):
    R = []
    for tk in RIFERIMENTI:
        px = riferimento(B, tk, lunga=STORIA_LUNGA)
        if px is None:
            R.append(f"{tk}: serie non letta")
            continue
        g, err = regimi(px.pct_change().iloc[1:].values)
        if err:
            return None, err
        R.append(f"{tk} (cinque anni): oggi in TENSIONE con probabilita' {_p(g['tensione_oggi'], 0)} · giorni in tensione "
                 f"{_p(g['quota'], 0)} · {g['periodi']} periodi di tensione, in media di "
                 + (f"{_n(g['durata'], 0)} sedute" if g["durata"] else "n.d.")
                 + f" · volatilita' annua {_p(g['vol'][0], 0)} da calmo, {_p(g['vol'][1], 0)} in tensione")
    R.append("il modello riconosce i regimi dai soli rendimenti, senza sapere niente di macro: e' un controllo "
             "indipendente delle sei luci, non una settima luce — e una stima dello stato di adesso, non una previsione")
    return R, None


def riassunto(P, B):
    """v533 — il laboratorio in TRE righe per ogni analisi (CEO, 03/11/2026: «sì»): i giorni peggiori e chi li porta,
    il regime di SMH e QQQ, la volatilita' di adesso. Le stesse funzioni delle sezioni (v161); una riga che non si
    calcola si dichiara col perche' (v389). (righe, quante non calcolate)."""
    R, buchi = [], 0
    rb, err = rischio_base(P)
    if err:
        R.append(f"giorni peggiori: ⚠ non calcolati — {err}")
        buchi += 1
    else:
        tk, q, p = rb[3][0]
        R.append(f"giorni peggiori: nel 5% dei giorni peggiori dell'ultimo anno il portafoglio di oggi ha perso in media "
                 f"{_p(rb[0])} al giorno, circa {_usd(rb[0] * P['valore_dentro'])}; il primo a portare quel rischio e' {tk} "
                 f"({_p(q, 0)} del rischio col {_p(p, 0)} del peso)")
    parti = []
    for t in RIFERIMENTI:
        px = riferimento(B, t, lunga=STORIA_LUNGA)
        g, err = regimi(px.pct_change().iloc[1:].values) if px is not None else (None, "serie non letta")
        parti.append(f"{t} in tensione con probabilita' {_p(g['tensione_oggi'], 0)}" if g else f"{t} ⚠ {err}")
        buchi += 0 if g else 1
    R.append("regime (due stati dai soli rendimenti, cinque anni): " + " · ".join(parti))
    g, err = garch(P["rp"])
    if err:
        R.append(f"volatilita' di adesso: ⚠ non calcolata — {err}")
        buchi += 1
    else:
        R.append(f"volatilita' di adesso (GARCH, una stima, non una previsione): {_n(g['oggi'], 2)}% al giorno, circa "
                 f"±{_usd(g['oggi'] / 100 * P['valore_dentro'])}, contro una media lunga del modello di "
                 + (f"{_n(g['lungo'], 2)}%" if g["lungo"] else "n.d."))
    return R, buchi


def resa_riassunto(P, R, adesso):
    from zoneinfo import ZoneInfo
    testa = (f"LABORATORIO IN TRE RIGHE (v533) — {adesso.astimezone(ZoneInfo('Europe/Rome')):%d/%m/%Y %H:%M} ora "
             "italiana · il dettaglio: python3 scripts/laboratorio.py")
    if P is None:
        return testa + "\n  ⚠ nessuna posizione con la storia sufficiente: il laboratorio non ha un portafoglio"
    fuori = ", ".join(f"{tk} ({_p(P['peso'].get(tk), 1)})" for tk in sorted(P["esclusi"]))
    return "\n".join([testa] + [f"  {r}" for r in R] + [
        f"  il portafoglio di oggi sulle {len(P['rend'])} sedute dal {datetime.fromisoformat(P['dal']):%d/%m/%Y}"
        + (f"; fuori per la storia corta: {fuori}" if fuori else "") + " — non il rendimento avuto, nessuna proiezione"])


ESECUTORI = {"rendimento": s_rendimento, "rischio": s_rischio, "robusta": s_robusta,
             "fuori_campione": s_fuori_campione, "diversificazione": s_diversificazione, "salvavita": s_salvavita,
             "volatilita": s_volatilita, "regimi": s_regimi}


def esegui(nome, P, B):
    """{'nome', 'titolo', 'stato': letta | non integrata | non eseguita, 'righe', 'perche'} — tre esiti, mai un
    silenzio (v389)."""
    out = {"nome": nome, "titolo": TITOLI[nome], "righe": [], "perche": None}
    if nome in NON_INTEGRATA:
        return dict(out, stato="non integrata", perche=NON_INTEGRATA[nome])
    try:
        righe, err = ESECUTORI[nome](P, B)
    except Exception as e:  # noqa: BLE001
        return dict(out, stato="non eseguita", perche=f"errore {type(e).__name__}: {str(e)[:160]}")
    if err:
        return dict(out, stato="non eseguita", perche=err)
    return dict(out, stato="letta", righe=righe)


def laboratorio(sezioni=SEZIONI, B=None, posiz=None, adesso=None, rete=True):
    adesso = adesso or datetime.now(timezone.utc)
    if B is None or posiz is None:
        B, posiz = dati(adesso=adesso, rete=rete)
    P = portafoglio(B, posiz)
    if P is None:
        return {"adesso": adesso, "P": None, "esiti": []}
    return {"adesso": adesso, "P": P, "esiti": [esegui(s, P, B) for s in sezioni]}


def resa(L):
    from zoneinfo import ZoneInfo
    ora = L["adesso"].astimezone(ZoneInfo("Europe/Rome"))
    P = L["P"]
    righe = [f"LABORATORIO DEL PORTAFOGLIO (v532) — {ora:%d/%m/%Y %H:%M} ora italiana · nove librerie open source, una "
             "domanda ciascuna"]
    if P is None:
        return "\n".join(righe + ["  ⚠ nessuna posizione con la storia sufficiente: il laboratorio non ha un portafoglio"])
    dentro = sum(P["peso"].get(tk, 0) for tk in P["w"].index)
    righe.append(f"  il portafoglio di OGGI coi pesi di oggi, ribilanciato ogni giorno, sulle {len(P['rend'])} sedute dal "
                 f"{datetime.fromisoformat(P['dal']):%d/%m/%Y} al {datetime.fromisoformat(P['al']):%d/%m/%Y}: "
                 f"{len(P['w'])} nomi, {_p(dentro, 1)} dell'azionario in dollari")
    for tk, perche in sorted(P["esclusi"].items()):
        righe.append(f"  fuori dal calcolo storico: {tk} ({_p(P['peso'].get(tk), 1)} del peso) — {perche}")
    righe.append("  ⚠ non e' il rendimento che hai avuto: e' come si sarebbe comportato questo portafoglio · i nomi sono "
                 "scelti oggi, quindi sopravvissuti · nessuna proiezione: misure sul passato e stime dello stato di adesso "
                 "dei modelli · i pesi dei modelli sono un termometro, non un ordine (v439)")
    for e in L["esiti"]:
        righe.append("")
        righe.append(f"{e['titolo']} — {e['stato'].upper() if e['stato'] != 'letta' else 'letta'}")
        if e["perche"]:
            righe.append(f"  {'⚠ ' if e['stato'] == 'non eseguita' else ''}{e['perche']}")
        righe += [f"  {r}" for r in e["righe"]]
    return "\n".join(righe)


def main(argv):
    if argv[:1] == ["riassunto"]:
        adesso = datetime.now(timezone.utc)
        nomi, posiz = SA.universo()
        B = SA.leggi_barre(nomi + [t for t in RIFERIMENTI if t not in nomi], adesso=adesso)
        P = portafoglio(B, posiz)
        R, buchi = riassunto(P, B) if P is not None else ([], 1)
        print(resa_riassunto(P, R, adesso))
        return 1 if buchi else 0
    sezioni = [a for a in argv if a in SEZIONI] or list(SEZIONI)
    ignote = [a for a in argv if a not in SEZIONI]
    if ignote:
        print(f"sezioni sconosciute: {', '.join(ignote)} — quelle che esistono: {', '.join(SEZIONI)}")
        return 2
    L = laboratorio(sezioni)
    print(resa(L))
    return 1 if L["P"] is None or any(e["stato"] == "non eseguita" for e in L["esiti"]) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
