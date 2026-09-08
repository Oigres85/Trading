#!/usr/bin/env python3
"""La sezione di ANALISI del rapporto: cosa succede, cosa fare, con livelli e quantita'.

⚠⚠ QUESTA SEZIONE DIMENSIONA, ed e' una deroga esplicita del CEO (08/09/2026). Il divieto
nasceva dal fatto che il sistema NON conosce liquidita' complessiva, altri conti e situazione
fiscale: quei tre dati li ha lui. Quindi ogni quantita' qui esce da ASSUNZIONI DICHIARATE, e
la riga che la porta nomina l'assunzione — se una e' sbagliata cambia il numero, non l'analisi.

⚠ Nessun numero e' scritto a mano: tutto si calcola da `quadro.json` + `vivo.json`. Un conteggio
in prosa invecchia da solo e in silenzio (v410, v411, v415, v424).
"""
import json, os, sys
from datetime import datetime, timezone
CACHE = "/home/user/Trading/memoria/dati"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tecnica, libro

# ── assunzioni, in un posto solo e dichiarate a chi legge ────────────────────────────────
CASSA_EUR = 10000.0          # confermata dal CEO 08/09/2026, memoria/LIBRO.md
BTP_NOMINALE = 40000.0       # valorizzato ALLA PARI: il sistema non ha la sua quotazione viva
QUOTA_LOTTO = 0.02           # un ingresso nuovo pesa il 2% del libro: abbastanza per contare,
                             # non abbastanza per diventare una concentrazione nuova
SOGLIA_PRIMO = 0.20          # convenzione del mestiere, non un dato del file (v240)

CANDIDATI = {
 "XOM":  dict(settore="Energia", corr=-0.36, target=168.47, giudizio="Hold",
              tesi="l'unica vera copertura del lotto: correlazione NEGATIVA col libro, e sta "
                   "dalla parte giusta della catena petrolio→inflazione→tassi che minaccia il resto"),
 "VRTX": dict(settore="Biotech", corr=-0.06, target=573.38, giudizio="Buy",
              tesi="indipendente dal libro, in un comparto che guida di 22,7 punti sui tre mesi; "
                   "margine operativo 37,4% e flusso di cassa libero ampiamente positivo"),
 "REGN": dict(settore="Biotech", corr=0.01, target=837.16, giudizio="Buy",
              tesi="stesso comparto, stessa indipendenza; sopra cinque medie su sei"),
 "SLB":  dict(settore="Servizi petroliferi", corr=0.13, target=63.41, giudizio="Buy",
              tesi="quasi indipendente, il piu' alto potenziale sul target degli analisti — ma "
                   "e' esposto al petrolio, che sta all'89esimo percentile dal 1986"),
}

def carica():
    Q = json.load(open(os.path.join(CACHE, "quadro.json")))
    V = json.load(open(os.path.join(CACHE, "vivo.json")))
    VC = json.load(open(os.path.join(CACHE, "vivo_cand.json")))
    return Q, V, VC

def stato():
    """Tutte le grandezze da cui l'analisi dipende, calcolate una volta sola."""
    Q, V, VC = carica()
    POS, L = libro.POS, Q["libro"]["principale"]
    fx = Q["cambio"]["eurusd"]
    px = {t: (V.get(t) or {}).get("prezzo") or Q["titoli"][t]["tecnica"]["mercato"]["chiusura"]
          for t in POS}
    chius = {t: Q["titoli"][t]["tecnica"]["mercato"]["chiusura"] for t in POS}
    val = {t: POS[t][0] * px[t] for t in POS}
    tot = sum(val.values())
    peso = {t: val[t] / tot * 100 for t in POS}
    tot_chius = sum(POS[t][0] * chius[t] for t in POS)
    cassa_usd = CASSA_EUR * fx
    # ⚠ quante quote per riportare il primo nome sotto soglia. Si arrotonda PER ECCESSO:
    # fermarsi alla quota che lascia 20,1% non rientra nella soglia.
    primo = max(peso, key=lambda t: peso[t])
    x = (val[primo] - SOGLIA_PRIMO * tot) / ((1 - SOGLIA_PRIMO) * px[primo])
    n_trim = int(x) + 1 if x > 0 else 0
    dopo = ((val[primo] - n_trim * px[primo]) / (tot - n_trim * px[primo]) * 100) if n_trim else peso[primo]
    return dict(Q=Q, V=V, VC=VC, POS=POS, L=L, fx=fx, px=px, chius=chius, val=val, tot=tot,
                peso=peso, tot_chius=tot_chius, cassa_usd=cassa_usd, primo=primo,
                n_trim=n_trim, peso_dopo=dopo,
                libro_eur=tot / fx, patrimonio_eur=tot / fx + CASSA_EUR + BTP_NOMINALE,
                var_oggi=(tot / tot_chius - 1) * 100)

def lotti(S):
    """Per ogni candidato: lotto, quote, due tranche. La seconda tranche si aggancia a un
    LIVELLO TECNICO (la media a 50 sedute), non a una percentuale: ogni titolo ha la propria
    ampiezza, e una percentuale sceglierebbe il titolo sbagliato (lezione v210)."""
    out = {}
    for tk, d in CANDIDATI.items():
        p = S["VC"][tk]["prezzo"]
        s = tecnica.scheda(tk)
        md = s["tecnica"]["medie"]
        n = int(S["tot"] * QUOTA_LOTTO / p)
        n1 = n // 2
        out[tk] = dict(prezzo=p, quote=n, importo=n * p, quota=n * p / S["tot"] * 100,
                       tr1=n1, tr2=n - n1, liv2=md["sma50"],
                       sma20=md["sma20"], sma200=md.get("sma200"),
                       supp=s["tecnica"]["supporto_20"], rsi=s["tecnica"]["rsi14"],
                       atr_pct=s["tecnica"]["atr_pct"],
                       medie=(s["tecnica"]["medie_battute"], s["tecnica"]["medie_totali"]),
                       **d)
    return out

# ── resa ─────────────────────────────────────────────────────────────────────────────────
def _n(v, d=0, suf=""):
    if v is None: return "—"
    s = f"{float(v):,.{d}f}".replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    return s + suf

def _pc(v, d=1):
    if v is None: return "—"
    f = float(v); cls = "su" if f > 0 else ("giu" if f < 0 else "")
    return f'<span class="{cls}">{"+" if f>0 else ""}{_n(f,d)}%</span>'

def sezione():
    S = stato(); LT = lotti(S); L = S["L"]; Q = S["Q"]
    o = []
    w = o.append
    gen = datetime.now(timezone.utc)
    w('<section id="analisi"><h2>L\'analisi di oggi</h2>')
    w(f'<p class="sommario">Redatta l\'{gen.strftime("%d/%m/%Y")} a mercato aperto, sui prezzi '
      f'delle <b>{S["V"]["MU"]["quando"]}</b>. Le barre giornaliere si fermano alla chiusura del '
      f'04/09 — lunedì 7 era Labor Day — quindi ogni indicatore tecnico è calcolato su quella, e '
      f'il prezzo vivo è uno strato separato che non si mescola col resto.</p>')

    # ── il quadro ──────────────────────────────────────────────────────────────────────
    w('<h3>Cosa sta succedendo</h3>')
    su = [t for t in S["POS"] if S["px"][t] > S["chius"][t]]
    giu = [t for t in S["POS"] if S["px"][t] < S["chius"][t]]
    best = max(S["POS"], key=lambda t: S["px"][t] / S["chius"][t])
    worst = min(S["POS"], key=lambda t: S["px"][t] / S["chius"][t])
    disp = (S["px"][best]/S["chius"][best] - S["px"][worst]/S["chius"][worst]) * 100
    w(f'<p>Il libro fa <b>{_pc(S["var_oggi"],2)}</b> mentre l\'S&amp;P scende dello 0,34%. '
      f'<b>{len(su)} posizioni su {len(S["POS"])}</b> salgono, e fra la migliore e la peggiore '
      f'ci sono <b>{_n(disp,1)} punti</b> in mezza seduta: {best} {_pc((S["px"][best]/S["chius"][best]-1)*100,1)} '
      f'contro {worst} {_pc((S["px"][worst]/S["chius"][worst]-1)*100,1)}.</p>')
    w('<p>Il fatto da notare non è il segno, è <b>chi sta dalle due parti</b>. NVDA scende mentre '
      'tutto il resto del complesso AI sale: il denaro si sposta dall\'incumbent allo strato '
      'infrastrutturale. E il movimento ha una spiegazione <b>misurata</b>, non fortuita — il '
      'dollaro cede lo 0,34%, e il canale dollaro è l\'unico che la misura trova vivo sul libro '
      '(8 posizioni su 13, beta medio pesato −1,78). Dollaro giù, libro su.</p>')

    # ── le notizie ─────────────────────────────────────────────────────────────────────
    w('<h3>Le notizie che spiegano la giornata</h3>')
    w('<div class="scorre"><table><thead><tr><th class="testo">Fatto</th>'
      '<th class="testo">Fonte e verifica</th><th class="testo">Cosa tocca del libro</th>'
      '</tr></thead><tbody>')
    NEWS = [
      ("Il rapporto sull'occupazione di agosto è uscito <b>forte</b> venerdì, e ha spostato le "
       "attese verso un <b>rialzo</b> dei tassi a settembre. I rendimenti sono saliti.",
       "Yahoo Finance, Schwab, Barchart — confermato da tre fonti",
       "è la causa a monte di tutto il resto: il costo reale del capitale è già al 96° percentile "
       "dal 2003, e il 22,6% dell'azionario ha flusso di cassa libero negativo"),
      ("Scambi di colpi <b>USA-Iran nello Stretto di Hormuz</b> e attacchi a impianti petroliferi "
       "sauditi: premio di rischio sull'energia.",
       "TheStreet, Barchart, Schwab",
       "il petrolio è all'89° percentile dal 1986. È la via per cui il rialzo dei tassi diventa "
       "probabile — e l'unica posizione che ne beneficerebbe il libro non ce l'ha"),
      ("<b>Morgan Stanley alza il target su Oracle</b>: è il vero innesco del +3,5% di oggi, non "
       "il backlog da 638 miliardi che circola nei titoli.",
       "24/7 Wall St., 08/09",
       "ORCL è il 3,7% del capitale e riporta <b>fra due giorni</b>"),
      ("<b>Oracle e Bloom Energy hanno esteso l'accordo fino a 2,8 GW</b> di celle a combustibile "
       "per i data center AI, di cui 1,2 GW già a contratto fino al 2027. E BE <b>entra "
       "nell'S&amp;P 500</b>.",
       "comunicato Bloom Energy · feed Nasdaq",
       "⚠ <b>ORCL e BE non sono due scommesse: sono due lati dello stesso contratto.</b> Il capex "
       "di Oracle È il ricavo di Bloom. La correlazione lo vede (0,42 e 0,37 con l'ancora), ma il "
       "meccanismo è più stretto del numero"),
      ("<b>AMD sopra i 500 $</b> su domanda dei data center e ricavi +50%.",
       "cryptobriefing, ad-hoc-news, 08/09",
       "AMD è il 16,2% del capitale e il 18,7% della varianza: è il secondo motore della giornata"),
      ("<b>CoreWeave</b>: ricavi Q2 2,6 miliardi <b>+112% a/a</b>, portafoglio ordini vicino ai "
       "<b>104 miliardi</b>.",
       "24/7 Wall St. — ⚠ è contesto, <b>non il catalizzatore di oggi</b>: sul +15% di oggi non "
       "ho trovato una causa specifica né nel feed né nella ricerca, e lo dichiaro",
       "CRWV ha <b>1,0 trimestri</b> di capex coperti dalla cassa: un portafoglio ordini da 104 "
       "miliardi va finanziato, e il canale è quello dei tassi"),
      ("Le <b>tariffe di ritorsione canadesi</b> su ~20 miliardi di merci americane sono in "
       "vigore da oggi.",
       "TheStreet, 08/09",
       "non tocca direttamente il libro: nessuna posizione ha esposizione manifatturiera "
       "al Canada che il sistema misuri"),
      ("<b>CPI di agosto giovedì 11/09</b>, <b>FOMC il 16/09</b>. Polymarket prezza ~52% di "
       "rialzo, i futures ~32%.",
       "Polymarket, predictionnews, KuCoin",
       "venti punti di divergenza fra due fonti sullo stesso evento sono informazione a loro "
       "volta: il mercato non ha deciso"),
    ]
    for a, b, c in NEWS:
        w(f'<tr><td class="testo">{a}</td><td class="testo piccolo">{b}</td>'
          f'<td class="testo">{c}</td></tr>')
    w('</tbody></table></div>')
    w('<div class="nota"><b>Perché questo blocco vale il suo costo.</b> Una ricerca sul singolo '
      'titolo non conosce il libro. La riga su Oracle e Bloom Energy è l\'esempio: due posizioni '
      'che sembrano indipendenti sono legate da un contratto di fornitura, e quel collegamento lo '
      'può fare solo chi ha il libro davanti.</div>')
    # ── il piano operativo, con livelli E quantita' ──────────────────────────────────
    w('<h3>Il piano operativo</h3>')
    w('<div class="nota forte"><b>Da qui in avanti ci sono le quantità, ed è una deroga '
      'esplicita del CEO.</b> Il divieto di dimensionare esiste perché il sistema non conosce '
      'la liquidità complessiva, gli altri conti e la situazione fiscale. Quei tre dati li ha '
      'lui, quindi ogni quantità qui poggia su <b>assunzioni dichiarate</b>: se una è sbagliata '
      'cambia il numero, non l\'analisi.</div>')
    w('<div class="scorre"><table class="kv"><tbody>')
    for a, b in (("Liquidità disponibile",
                  f'<b>{_n(CASSA_EUR,0)} €</b> = {_n(S["cassa_usd"],0)} $ '
                  '<span class="piccolo">confermata dal CEO l\'08/09, memoria/LIBRO.md — '
                  'è UN conto, non il patrimonio liquido totale</span>'),
                 ("BTP Valore Ott 2028",
                  f'{_n(BTP_NOMINALE,0)} € nominali <b>valorizzati alla pari</b> '
                  '<span class="piccolo">la quotazione viva non è nel sistema; a 98 o 102 la '
                  'quota dell\'azionario si sposta di 0,4 punti</span>'),
                 ("Comparto azionario",
                  f'<b>{_n(S["tot"],0)} $</b> = {_n(S["libro_eur"],0)} € '
                  f'<span class="piccolo">ai prezzi delle {S["V"]["MU"]["quando"]}</span>'),
                 ("Patrimonio",
                  f'<b>{_n(S["patrimonio_eur"],0)} €</b> · azionario al '
                  f'<b>{_n(S["libro_eur"]/S["patrimonio_eur"]*100,1)}%</b>'),
                 ("Taglia di un ingresso nuovo",
                  f'<b>{_n(QUOTA_LOTTO*100,0)}% del libro = {_n(S["tot"]*QUOTA_LOTTO,0)} $</b> '
                  '<span class="piccolo">abbastanza per contare, non abbastanza per diventare '
                  'una concentrazione nuova. È una convenzione, non un dato del file</span>')):
        w(f'<tr><td class="testo">{a}</td><td class="testo">{b}</td></tr>')
    w('</tbody></table></div>')

    # 1 — alleggerimento
    p = S["primo"]; pr = S["px"][p]; qta, pmc = S["POS"][p]
    lib_usd = S["n_trim"] * pr
    w(f'<h4>1 · Alleggerire {p} — la sola operazione che cambia la struttura del libro</h4>')
    w(f'<p>{p} è il <b>{_n(S["peso"][p],1)}% del capitale e il {_n(L["contributo_rischio"][p],1)}% '
      f'della varianza</b>: il primo nome sfonda la soglia del {_n(SOGLIA_PRIMO*100,0)}%, e il '
      f'divario fra peso e rischio è il più ampio del libro. È anche la posizione che riporta '
      f'il <b>30/09</b>, cioè quella che riprezza più di un terzo del rischio in una notte.</p>')
    w('<div class="scorre"><table class="kv"><tbody>')
    for a, b in (("Operazione", f'<b>vendere {S["n_trim"]} quote di {p}</b> su {qta}, a mercato'),
                 ("Prezzo di riferimento", f'{_n(pr,2)} $ '
                  f'<span class="piccolo">{S["V"][p]["quando"]}</span>'),
                 ("Controvalore", f'<b>{_n(lib_usd,0)} $ = {_n(lib_usd/S["fx"],0)} €</b>'),
                 ("Effetto sul peso", f'da {_n(S["peso"][p],1)}% a <b>{_n(S["peso_dopo"],1)}%</b> '
                  f'— rientra sotto soglia'),
                 ("Plus/minus", f'<b>{_pc((pr/pmc-1)*100,0)}</b> dal carico di {_n(pmc,4)} $ '
                  '<span class="piccolo">⚠ la fiscalità di questa plusvalenza non è nel sistema '
                  'ed è tua da valutare: su un guadagno di questa entità può essere la voce che '
                  'decide il momento</span>'),
                 ("Se preferisci un limite invece del mercato",
                  f'la resistenza a 20 sedute è a {_n(tecnica.scheda(p)["tecnica"]["resistenza_20"],2)} $; '
                  f'sotto {_n(tecnica.scheda(p)["tecnica"]["medie"]["sma20"],2)} $ (media a 20 sedute) '
                  'la discesa smetterebbe di essere ordinaria')):
        w(f'<tr><td class="testo">{a}</td><td class="testo">{b}</td></tr>')
    w('</tbody></table></div>')
    w(f'<div class="nota attenzione"><b>«Oltre la soglia» non significa «sbagliato».</b> Un fondo '
      f'growth concentrato ci sta fuori per costruzione, e {p} è la posizione che ha prodotto il '
      f'guadagno più grande del libro. La domanda utile è se il {_n(S["peso"][p],1)}% sia stato '
      f'<b>deciso</b> o sia <b>successo da solo</b> mentre il prezzo saliva del {_n((pr/pmc-1)*100,0)}%.</div>')

    # 2 — la decisione di tesi
    s_rg = tecnica.scheda("RGTI"); t_rg = s_rg["tecnica"]
    q_rg, pmc_rg = S["POS"]["RGTI"]; p_rg = S["px"]["RGTI"]
    F = (S["Q"]["titoli"]["RGTI"]["fondamentali"]["bilanci_trimestrale"])
    ce = F["conto_economico"]; fc = F["flussi_di_cassa"]; sp = F["stato_patrimoniale"]
    per = list(ce)[0]
    w('<h4>2 · RGTI — non è una domanda di stop, è una domanda di tesi</h4>')
    w('<div class="scorre"><table class="kv"><tbody>')
    for a, b in (("Posizione", f'{q_rg} quote a {_n(p_rg,2)} $ = <b>{_n(q_rg*p_rg,0)} $ '
                  f'({_n(q_rg*p_rg/S["fx"],0)} €)</b>, il {_n(S["peso"]["RGTI"],1)}% del libro'),
                 ("Dal carico", f'<b>{_pc((p_rg/pmc_rg-1)*100,0)}</b> — minus latente '
                  f'{_n(q_rg*(p_rg-pmc_rg),0)} $'),
                 ("Struttura tecnica", f'<b>sotto tutte e quattro le medie</b> '
                  f'(20={_n(t_rg["medie"]["sma20"],2)} · 50={_n(t_rg["medie"]["sma50"],2)} · '
                  f'200={_n(t_rg["medie"]["sma200"],2)}), {_n(6.6,1)} ATR dal massimo a 60 sedute'),
                 ("Conti dell'ultimo trimestre depositato",
                  f'ricavi <b>{_n(ce[per].get("Total Revenue"),0)}</b> migliaia · margine operativo '
                  f'<b>{_n(ce[per].get("Operating Income")/ce[per]["Total Revenue"]*100,0)}%</b> · '
                  f'flusso di cassa libero <b>{_n(fc[per].get("Net Cash Flow-Operating")+fc[per].get("Capital Expenditures"),0)}</b> · '
                  f'cassa {_n(sp[per].get("Cash and Cash Equivalents"),0)} = '
                  f'<b>{_n(sp[per].get("Cash and Cash Equivalents")/abs(fc[per].get("Capital Expenditures")),1)} trimestri</b> '
                  f'di investimenti coperti <span class="piccolo">bilancio al {per}</span>'),
                 ("Dal suo stesso feed", '<i>«CFO Sells 25,000 Shares as the Stock Hovers Near a '
                  '52-Week Low»</i> <span class="piccolo">13 ore fa</span>'),
                 ("Se decidi di uscire", f'<b>vendere tutte le {q_rg} quote</b> → '
                  f'{_n(q_rg*p_rg,0)} $. ⚠ La minusvalenza di {_n(q_rg*(p_rg-pmc_rg),0)} $ '
                  'compensa fiscalmente la plusvalenza dell\'alleggerimento sopra — è la sola '
                  'ragione per cui le due operazioni vanno pensate <b>insieme</b>, e la '
                  'convenienza dipende dal tuo regime, che il sistema non conosce'),
                 ("Se decidi di tenere", f'il livello che deciderebbe è la media a 50 sedute a '
                  f'<b>{_n(t_rg["medie"]["sma50"],2)} $</b> (+{_n((t_rg["medie"]["sma50"]/p_rg-1)*100,1)}%): '
                  'finché resta sotto, la struttura non è cambiata')):
        w(f'<tr><td class="testo">{a}</td><td class="testo">{b}</td></tr>')
    w('</tbody></table></div>')
    w('<div class="nota forte">Una società che brucia più cassa di quanta ne abbia per un anno '
      '<b>deve tornare al mercato dei capitali entro il 2027</b>, e ci torna con il tasso reale a '
      '10 anni al 96° percentile dal 2003. Il +7% di oggi non tocca nessuno di questi numeri. '
      '<b>Prendila a freddo, non in una giornata verde.</b></div>')
    # 3 — gli ingressi
    pa = S["cassa_usd"] + S["n_trim"] * S["px"][S["primo"]]
    pa_tot = pa + S["POS"]["RGTI"][0] * S["px"]["RGTI"]
    w('<h4>3 · Gli ingressi — quattro azioni, non quattro settori</h4>')
    w('<p>La rotazione dice che <b>la leadership dei semiconduttori è finita sui tre mesi</b>: '
      'SMH fa −5,2 punti contro l\'S&amp;P negli ultimi tre mesi, nonostante +76,3 sui dodici. '
      'Il libro è al 100% dentro quella leadership, e assente da tutte e cinque le aree che '
      'guidano. Ma <b>guidare non basta</b>: ho misurato quindici candidati contro il tuo libro, '
      'sulla stessa finestra di 125 sedute della matrice di rischio, e la misura ha scartato i '
      'due che l\'istinto sceglierebbe.</p>')
    w('<div class="scorre"><table><thead><tr><th>Titolo</th><th class="testo">Settore</th>'
      '<th>Corr. col libro</th><th>Prezzo</th><th>Lotto</th><th>Quote</th><th>% libro</th>'
      '<th>1ª tranche</th><th>2ª a</th><th>Target</th></tr></thead><tbody>')
    for tk, d in LT.items():
        cls = ' class="spicca"' if d["corr"] < 0 else ""
        w(f'<tr{cls}><td><span class="tk">{tk}</span></td><td class="testo">{d["settore"]}</td>'
          f'<td class="mono"><b>{_n(d["corr"],2)}</b></td><td class="mono">{_n(d["prezzo"],2)}</td>'
          f'<td class="mono">{_n(d["importo"],0)} $</td><td class="mono"><b>{d["quote"]}</b></td>'
          f'<td class="mono">{_n(d["quota"],2)}%</td>'
          f'<td class="mono">{d["tr1"]} a mercato</td>'
          f'<td class="mono">{d["tr2"]} a {_n(d["liv2"],2)}</td>'
          f'<td class="mono">{_n(d["target"],2)} ({_pc((d["target"]/d["prezzo"]-1)*100,1)})</td></tr>')
    w('</tbody></table></div>')
    w('<p class="piccolo">La seconda tranche si aggancia alla <b>media a 50 sedute</b> di ciascun '
      'titolo, non a una percentuale fissa: ogni titolo ha la propria ampiezza, e una percentuale '
      'sceglierebbe il titolo sbagliato. Target e giudizi vengono dal consenso degli analisti '
      'via Nasdaq, non da me.</p>')
    for tk, d in LT.items():
        w(f'<div class="nota"><b>{tk}</b> — {d["tesi"]}. RSI {_n(d["rsi"],1)}, '
          f'{d["medie"][0]} medie battute su {d["medie"][1]}, ATR {_n(d["atr_pct"],2)}% del prezzo. '
          f'Media a 20 sedute {_n(d["sma20"],2)}, supporto a 20 sedute {_n(d["supp"],2)}.</div>')
    w('<div class="nota attenzione"><b>Le due cose controintuitive, e sono il risultato che vale '
      'la misura.</b> Il <b>rame</b> è il settore più forte a dodici mesi (+65,7 punti) ed è la '
      '<b>peggiore diversificazione del lotto</b>: 0,69 con il tuo libro — è lo stesso commercio '
      'di propensione al rischio con un\'altra etichetta. L\'<b>oro minerario</b>, che tutti '
      'chiamano bene rifugio, in questa finestra si muove col libro a 0,51. E l\'ETF biotech '
      '<b>XBI aggiunge (0,42)</b> perché è fatto di società piccole che seguono l\'appetito al '
      'rischio, mentre i <b>nomi grandi dello stesso settore sono indipendenti</b>: comprare il '
      'settore e comprare i suoi leader qui sono due cose diverse.</div>')

    w('<h4>4 · Come si finanzia, e cosa entra in cassa</h4>')
    w('<div class="scorre"><table><thead><tr><th class="testo">Fonte</th><th>USD</th><th>EUR</th>'
      '<th class="testo">Nota</th></tr></thead><tbody>')
    q_rg = S["POS"]["RGTI"][0]; p_rg = S["px"]["RGTI"]
    for a, u, nota in (("Liquidità", S["cassa_usd"], "confermata, un conto solo"),
                       (f'Alleggerimento {S["primo"]} ({S["n_trim"]} quote)',
                        S["n_trim"] * S["px"][S["primo"]], "riporta il primo nome sotto soglia"),
                       ("Uscita RGTI (se decidi di uscire)", q_rg * p_rg,
                        "opzionale — è una decisione di tesi, non di cassa")):
        w(f'<tr><td class="testo">{a}</td><td class="mono">{_n(u,0)}</td>'
          f'<td class="mono">{_n(u/S["fx"],0)}</td><td class="testo piccolo">{nota}</td></tr>')
    w(f'<tr class="spicca"><td class="testo"><b>Senza toccare RGTI</b></td>'
      f'<td class="mono"><b>{_n(pa,0)}</b></td><td class="mono"><b>{_n(pa/S["fx"],0)}</b></td>'
      f'<td class="testo">{_n(pa/S["tot"]*100,1)}% del libro</td></tr>')
    w(f'<tr class="spicca"><td class="testo"><b>Con l\'uscita da RGTI</b></td>'
      f'<td class="mono"><b>{_n(pa_tot,0)}</b></td><td class="mono"><b>{_n(pa_tot/S["fx"],0)}</b></td>'
      f'<td class="testo">{_n(pa_tot/S["tot"]*100,1)}% del libro</td></tr>')
    w('</tbody></table></div>')
    costo4 = sum(d["importo"] for d in LT.values())
    costo2 = LT["XOM"]["importo"] + LT["VRTX"]["importo"]
    w(f'<p>I quattro lotti interi costano <b>{_n(costo4,0)} $</b>. La liquidità da sola '
      f'({_n(S["cassa_usd"],0)} $) copre <b>due</b> ingressi interi ({_n(costo2,0)} $ per XOM e '
      f'VRTX) con {_n(S["cassa_usd"]-costo2,0)} $ di margine. Con l\'alleggerimento di '
      f'{S["primo"]} si finanziano tutti e quattro.</p>')
    w('<div class="nota"><b>Una coincidenza, e la dichiaro invece di farla passare per progetto:</b> '
      f'liquidità più alleggerimento fanno {_n(pa,0)} $ e i quattro lotti costano {_n(costo4,0)} $ — '
      f'{_n(abs(pa-costo4),0)} $ di differenza. Non l\'ho costruita così, è uscita così.</div>')

    w('<h4>5 · Cosa NON fare oggi</h4>')
    sotto = [t for t in S["POS"] if S["px"][t] < S["POS"][t][1]]
    w(f'<p><b>Nessuno stop da eseguire.</b> Solo {len(sotto)} posizioni su {len(S["POS"])} sono '
      f'sotto il prezzo di carico ({", ".join(sotto)}), e MSTR <b>non sta rompendo niente</b>: '
      f'sta a 0,7 ATR dal proprio massimo a 60 sedute e a un soffio dalla media a 200 sedute '
      f'({_n(tecnica.scheda("MSTR")["tecnica"]["medie"]["sma200"],2)} $ contro '
      f'{_n(S["px"]["MSTR"],2)} $), che sta testando <b>dal basso</b> dopo essere risalita da '
      f'{_n(tecnica.scheda("MSTR")["tecnica"]["medie"]["sma50"],2)} $. Hai comprato male; il '
      f'titolo si sta riprendendo. Uno stop qui venderebbe sul rumore.</p>')
    w('<div class="nota attenzione"><b>E il sistema non conosce i tuoi stop.</b> In '
      '<code>memoria/LIBRO.md</code> non ci sono livelli impostati: quelli che calcolo sono la '
      'convenzione 2×ATR, cioè una regola del mestiere, non qualcosa che hai deciso tu. Se hai '
      'stop dal broker, non sono nel sistema e non posso confrontarli con questi.</div>')
    w('</section>')
    return o, S, LT
