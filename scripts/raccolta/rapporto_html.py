#!/usr/bin/env python3
"""Rende il quadro raccolto in una pagina HTML. NIENTE GRAFICI (decisione del CEO 08/09/2026):
la lettura che un grafico darebbe e' il percentile, e quello e' un numero.

⚠ Ogni numero esce col proprio riferimento: data, finestra, campione, fonte. E' la convenzione
di questo progetto e qui diventa un elemento visivo invece di una nota a pie' di pagina.
"""
import json, os, sys, html as H
from datetime import datetime, timezone, date

CACHE = "/home/user/Trading/memoria/dati"
Q = json.load(open(os.path.join(CACHE, "quadro.json")))

# ── formattazione ────────────────────────────────────────────────────────────────────────
def n(v, dec=2, suff=""):
    if v is None: return '<span class="vuoto">—</span>'
    try: f = float(v)
    except (TypeError, ValueError): return H.escape(str(v))
    # convenzione italiana: punto per le migliaia, virgola per i decimali. Il passaggio per
    # un segnaposto serve perche' altrimenti la seconda replace tocca quello che ha scritto la prima.
    s = f"{f:,.{dec}f}".replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    return s + suff

def pc(v, dec=1, segno=True):
    if v is None: return '<span class="vuoto">—</span>'
    f = float(v)
    cls = "su" if f > 0 else ("giu" if f < 0 else "")
    s = ("+" if (segno and f > 0) else "") + (f"{f:,.{dec}f}"
         .replace(",", "\x00").replace(".", ",").replace("\x00", "."))
    return f'<span class="{cls}">{s}%</span>'

def ord_(v):
    return '<span class="vuoto">—</span>' if v is None else f"{int(v)}°"

def dt(s):
    if not s: return "—"
    s = str(s)[:10]
    try:
        a, m, g = s.split("-"); return f"{g}/{m}/{a}"
    except Exception: return s

def eta_gg(s):
    try: return (date.today() - date.fromisoformat(str(s)[:10])).days
    except Exception: return None

def e(s): return H.escape(str(s if s is not None else ""))

OUT = []
def w(s): OUT.append(s)

# ── dati di appoggio ─────────────────────────────────────────────────────────────────────
LIB = Q["libro"]["principale"]
CORTA = Q["libro"]["finestra_corta"]
POS = Q["libro"]["posizioni"]
TIT = Q["titoli"]
MACRO = {r["serie"]: r for r in Q["macro"]["righe"]}
ORDINE = sorted([t for t in TIT if TIT[t]["posseduto"]],
                key=lambda t: -(LIB["pesi"].get(t) or CORTA.get(t, {}).get("sedute", 0) * 0 or 0))
# le posizioni fuori dalla matrice non hanno peso li': si mettono in coda, dichiarate
ORDINE = [t for t in ORDINE if t in LIB["pesi"]] + [t for t in TIT if TIT[t]["posseduto"] and t not in LIB["pesi"]]
SEGUITI = [t for t in TIT if not TIT[t]["posseduto"]]

def chiusura(tk):
    t = (TIT[tk].get("tecnica") or {}).get("mercato") or {}
    return t.get("chiusura")

def val_pos(tk):
    c, p = chiusura(tk), POS.get(tk, {}).get("qta")
    return c * p if c and p else None

TOT_AZ = sum(v for v in (val_pos(t) for t in ORDINE) if v)
BARRA = (TIT[ORDINE[0]].get("tecnica") or {}).get("al")


# ── testa e stile ────────────────────────────────────────────────────────────────────────
w('''<title>Quadro del Libro</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
:root{
  --carta:#f2f3ef; --carta-2:#e9ebe5; --carta-3:#dfe2da;
  --inchiostro:#171c1a; --inchiostro-2:#4a534e; --inchiostro-3:#79837c;
  --riga:#cfd4ca; --riga-forte:#a9b1a7;
  --accento:#175f5c; --accento-tenue:#e0ebe9;
  --su:#186b45; --giu:#a32a21; --allerta:#8a5a06;
  --ombra:0 1px 2px rgba(23,28,26,.06);
  --mono:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;
  --testo:"Public Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  --titoli:"Newsreader",Georgia,"Times New Roman",serif;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --carta:#121614; --carta-2:#1a201d; --carta-3:#232a26;
  --inchiostro:#e4e8e4; --inchiostro-2:#a3aca6; --inchiostro-3:#767f79;
  --riga:#2b332e; --riga-forte:#3d4741;
  --accento:#6fbdb5; --accento-tenue:#17302e;
  --su:#4bbb82; --giu:#e0685c; --allerta:#d6a13c;
  --ombra:0 1px 2px rgba(0,0,0,.3);
}}
:root[data-theme="dark"]{
  --carta:#121614; --carta-2:#1a201d; --carta-3:#232a26;
  --inchiostro:#e4e8e4; --inchiostro-2:#a3aca6; --inchiostro-3:#767f79;
  --riga:#2b332e; --riga-forte:#3d4741;
  --accento:#6fbdb5; --accento-tenue:#17302e;
  --su:#4bbb82; --giu:#e0685c; --allerta:#d6a13c;
  --ombra:0 1px 2px rgba(0,0,0,.3);
}
*{box-sizing:border-box}
body{background:var(--carta);color:var(--inchiostro);font-family:var(--testo);
  font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
:where(a,button,summary){transition:color .12s ease,background-color .12s ease}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}

.guscio{display:grid;grid-template-columns:216px minmax(0,1fr);gap:0;min-height:100vh}
.rail{position:sticky;top:0;align-self:start;height:100vh;overflow-y:auto;
  border-right:1px solid var(--riga);padding:26px 18px 40px;background:var(--carta-2)}
.rail .marchio{font-family:var(--titoli);font-size:20px;font-weight:600;letter-spacing:-.01em;
  line-height:1.15;margin:0 0 4px}
.rail .sotto{font-size:11px;color:var(--inchiostro-3);font-family:var(--mono);margin-bottom:22px}
.rail nav{display:flex;flex-direction:column;gap:1px}
.rail a{color:var(--inchiostro-2);text-decoration:none;font-size:13px;padding:5px 8px;
  border-radius:3px;border-left:2px solid transparent}
.rail a:hover{color:var(--accento);background:var(--carta-3)}
.rail a:focus-visible{outline:2px solid var(--accento);outline-offset:1px}
.rail .gruppo{font-size:10px;text-transform:uppercase;letter-spacing:.09em;
  color:var(--inchiostro-3);margin:18px 0 5px;padding-left:8px;font-weight:600}

main{padding:34px 40px 90px;max-width:1180px}
section{scroll-margin-top:20px;margin-bottom:52px}
h1{font-family:var(--titoli);font-size:38px;font-weight:600;letter-spacing:-.02em;
  line-height:1.1;margin:0 0 6px;text-wrap:balance}
h2{font-family:var(--titoli);font-size:25px;font-weight:600;letter-spacing:-.015em;
  margin:0 0 3px;text-wrap:balance;padding-bottom:7px;border-bottom:2px solid var(--inchiostro)}
h3{font-family:var(--titoli);font-size:18px;font-weight:600;margin:26px 0 8px;text-wrap:balance}
h4{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--inchiostro-3);
  margin:18px 0 6px;font-weight:700}
p{margin:0 0 11px;max-width:68ch}
.occhiello{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.1em;
  color:var(--accento);margin:0 0 5px;font-weight:500}
.sommario{font-size:13px;color:var(--inchiostro-2);margin:8px 0 20px;max-width:72ch}

table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
.scorre{overflow-x:auto;margin:10px 0 6px;border-bottom:1px solid var(--riga)}
th{text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;
  color:var(--inchiostro-3);font-weight:700;padding:5px 9px;white-space:nowrap;
  border-bottom:1px solid var(--riga-forte);vertical-align:bottom}
th:first-child,td:first-child{text-align:left}
td{padding:5px 9px;text-align:right;border-bottom:1px solid var(--riga);white-space:nowrap}
tbody tr:hover td{background:var(--carta-2)}
td.testo,th.testo{text-align:left;white-space:normal;min-width:170px}
/* ⚠ Le tabelle etichetta/valore hanno valori lunghi (un indicatore col proprio
   percentile accanto): con nowrap la coda viene TAGLIATA e sparisce senza
   rompere niente — la classe dei difetti che non si rompono. Si va a capo,
   non si allarga la colonna (v394). */
.kv td:last-child{white-space:normal;line-height:1.4}
.kv td:first-child{width:42%}
.mono{font-family:var(--mono);font-size:12.5px}
.tk{font-family:var(--mono);font-weight:600;font-size:13px;letter-spacing:-.02em}
.su{color:var(--su)} .giu{color:var(--giu)} .vuoto{color:var(--inchiostro-3)}
/* ⚠ NIENTE nowrap qui: `.piccolo` finisce anche su paragrafi e su celle di testo lunghe,
   e nowrap non tronca — SPINGE. Con la regola precedente il documento usciva 1770px su un
   viewport da 1400: 370px di scorrimento orizzontale su tutta la pagina, che e' la classe
   gia' pagata due volte (chip a larghezza fissa, colonna del valore a 96px). Il nowrap
   resta solo dove serve davvero, cioe' sulle celle numeriche. */
.piccolo{font-size:11px;color:var(--inchiostro-3);font-family:var(--mono)}
td.testo,th.testo{overflow-wrap:anywhere}
p.piccolo{max-width:70ch;line-height:1.45}
tr.spicca td{background:var(--accento-tenue)}
tr.spicca td:first-child{box-shadow:inset 3px 0 0 var(--accento)}

.nota{border-left:2px solid var(--riga-forte);padding:2px 0 2px 13px;margin:12px 0;
  font-size:13px;color:var(--inchiostro-2);max-width:70ch}
.nota.attenzione{border-left-color:var(--allerta)}
.nota.forte{border-left-color:var(--giu)}
.nota b{color:var(--inchiostro);font-weight:600}
.finestra{font-family:var(--mono);font-size:10.5px;color:var(--inchiostro-3);
  display:inline-block;white-space:nowrap}

.griglia{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));margin:14px 0}
.dato{border-top:2px solid var(--inchiostro);padding:9px 0 0}
.dato .et{font-size:10px;text-transform:uppercase;letter-spacing:.07em;
  color:var(--inchiostro-3);font-weight:700;margin-bottom:3px}
.dato .vl{font-family:var(--mono);font-size:23px;font-weight:500;line-height:1.1;
  letter-spacing:-.02em}
.dato .rf{font-size:11px;color:var(--inchiostro-2);margin-top:4px;line-height:1.35}

.scheda{border:1px solid var(--riga);border-radius:2px;margin:0 0 12px;background:var(--carta)}
.scheda>summary{cursor:pointer;padding:11px 15px;display:flex;flex-wrap:wrap;gap:6px 16px;
  align-items:baseline;list-style:none}
.scheda>summary::-webkit-details-marker{display:none}
.scheda>summary:hover{background:var(--carta-2)}
.scheda>summary:focus-visible{outline:2px solid var(--accento);outline-offset:-2px}
.scheda[open]>summary{border-bottom:1px solid var(--riga);background:var(--carta-2)}
.scheda .nome{font-family:var(--mono);font-weight:600;font-size:15px;letter-spacing:-.02em}
.scheda .soc{font-size:12.5px;color:var(--inchiostro-2);flex:1 1 190px;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.scheda .cifre{font-family:var(--mono);font-size:12.5px;display:flex;gap:14px;flex-wrap:wrap}
.corpo{padding:4px 15px 18px}
.due{display:grid;gap:8px 30px;grid-template-columns:repeat(auto-fit,minmax(310px,1fr))}
.chip{display:inline-block;font-family:var(--mono);font-size:10.5px;padding:1px 6px;
  border:1px solid var(--riga-forte);border-radius:2px;color:var(--inchiostro-2);
  text-transform:uppercase;letter-spacing:.04em}
.chip.att{border-color:var(--allerta);color:var(--allerta)}
.chip.neg{border-color:var(--giu);color:var(--giu)}
.chip.pos{border-color:var(--su);color:var(--su)}
ul{margin:0 0 12px;padding-left:19px;max-width:70ch}
li{margin-bottom:5px}
a{color:var(--accento)}
a:focus-visible{outline:2px solid var(--accento);outline-offset:2px}
hr{border:0;border-top:1px solid var(--riga);margin:26px 0}
@media (max-width:900px){
  .guscio{grid-template-columns:1fr}
  .rail{position:static;height:auto;border-right:0;border-bottom:1px solid var(--riga);
    padding:16px 18px}
  .rail nav{flex-direction:row;flex-wrap:wrap;gap:2px 4px}
  .rail .gruppo{width:100%;margin:9px 0 2px}
  main{padding:22px 16px 60px}
  h1{font-size:29px} h2{font-size:21px}
}
</style>''')

# ── guscio e indice ──────────────────────────────────────────────────────────────────────
VOCI = [("apertura", "In apertura"), ("libro", "Il libro"), ("rischio", "Rischio e correlazioni"),
        ("macro", "Quadro macro"), ("canali", "I canali macro→titolo"),
        ("giunzioni", "Le giunzioni"), ("schede", "Schede per titolo"),
        ("notizie", "Notizie"), ("confronto", "Questo contro GitHub"), ("manca", "Cosa manca")]
gen = datetime.fromisoformat(Q["generato_il"]).astimezone(timezone.utc)
w('<div class="guscio"><aside class="rail">')
w('<p class="marchio">Quadro del Libro</p>')
w(f'<p class="sotto">{gen.strftime("%d/%m/%Y · %H:%M")} UTC</p>')
w('<nav>')
w('<p class="gruppo">Documento</p>')
for a, t in VOCI[:6]: w(f'<a href="#{a}">{t}</a>')
w('<p class="gruppo">Posizioni</p>')
for tk in ORDINE + SEGUITI:
    marchio = "" if TIT[tk]["posseduto"] else " ·seguito"
    w(f'<a href="#t-{tk}"><span class="tk">{tk}</span>{marchio}</a>')
w('<p class="gruppo">Coda</p>')
for a, t in VOCI[6:]: w(f'<a href="#{a}">{t}</a>')
w('</nav></aside><main>')

# ── 1. IN APERTURA ───────────────────────────────────────────────────────────────────────
eta_barra = eta_gg(BARRA)
w('<section id="apertura">')
w('<p class="occhiello">Rapporto del ' + gen.strftime("%d/%m/%Y") + ' · dati raccolti fuori dal sistema</p>')
w('<h1>Quadro del Libro</h1>')
w('<p class="sommario">Tredici posizioni, ventuno serie macro con la loro profondità storica vera, '
  'quattordici schede tecniche su 1.255 barre giornaliere, i bilanci depositati e le notizie per titolo. '
  'Ogni numero esce con la propria finestra, il proprio campione e la propria fonte. '
  '<b>Nessun grafico</b>: la lettura che un grafico darebbe è il percentile, e quello è un numero.</p>')

w('<div class="griglia">')
w(f'<div class="dato"><div class="et">Comparto azionario</div><div class="vl">{n(TOT_AZ,0)} $</div>'
  f'<div class="rf">{len(ORDINE)} posizioni · valorizzate sulla chiusura del {dt(BARRA)}</div></div>')
w(f'<div class="dato"><div class="et">Scommesse effettive</div><div class="vl">{n(LIB["scommesse_effettive"],1)}</div>'
  f'<div class="rf">su {len(LIB["pesi"])} nomi · correlazione media {n(LIB["corr_media"],3)}</div></div>')
w(f'<div class="dato"><div class="et">Volatilità annua</div><div class="vl">{n(LIB["volatilita_annua_pct"],1)}%</div>'
  f'<div class="rf">VaR 95% giornaliero {n(LIB["var95_1g_pct"],2)}% · ES {n(LIB["es95_1g_pct"],2)}%</div></div>')
w(f'<div class="dato"><div class="et">Ultima barra</div><div class="vl">{dt(BARRA)}</div>'
  f'<div class="rf">{eta_barra} giorni fa · lunedì 7/09 era Labor Day, borse USA chiuse</div></div>')
w('</div>')

w('<h3>La domanda di oggi</h3>')
w('<p>Il libro è una scommessa sola scritta dodici volte — <b>2,2 scommesse effettive su 12 nomi</b> — '
  'e la scommessa è il ciclo della memoria dentro l\'infrastruttura AI. Tre misure indipendenti, '
  'raccolte stamattina, dicono che il prezzo di quella scommessa sta cambiando dal lato dei tassi:</p>')
w('<ul>')
r_tips = MACRO["DFII10"]; r_wti = MACRO["DCOILWTICO"]; r_10 = MACRO["DGS10"]
w(f'<li><b>Il tasso reale a 10 anni è al {ord_(r_tips["perc_storico"])} percentile di tutta la serie</b> '
  f'({n(r_tips["valore"],2)}%, rilevazione del {dt(r_tips["data"])}) — '
  f'<span class="finestra">{r_tips["n_storico"]} osservazioni dal {dt(r_tips["dal"])}</span>. '
  'Il costo reale del capitale non è mai stato più alto da quando i TIPS esistono. È il canale che '
  'colpisce per primo chi finanzia la crescita a debito.</li>')
w(f'<li><b>I mercati di previsione e i futures non sono d\'accordo sul FOMC del 16/09.</b> Polymarket '
  'prezza ~52-53% di rialzo, i futures ~32%: venti punti di divergenza sullo stesso evento, che è '
  'informazione a sua volta. Il CPI di agosto esce l\'11/09, fra tre giorni.</li>')
w(f'<li><b>Il petrolio è al {ord_(r_wti["perc_storico"])} percentile dal {dt(r_wti["dal"])}</b> '
  f'({n(r_wti["valore"],2)} $/bbl, {pc(r_wti["varpct_12m"])} in dodici mesi) dopo gli scambi di colpi '
  'fra Stati Uniti e Iran nel fine settimana. È la via per cui un rialzo dei tassi diventa probabile.</li>')
w('</ul>')
# ⚠ IL CONTEGGIO SI CONTA, NON SI SCRIVE. Una frase in prosa con un numero dentro invecchia
# da sola e in silenzio (v410, v411, v415, v424) — e qui la frase riguarda la copertura del libro
# sul canale che la sezione stessa dichiara essere il rischio del giorno.
def _mis(tk, canale, finestra):
    """⚠ `or {}` a OGNI livello: `corta` puo' essere None (serie troppo corta), e `.get(k, {})`
    restituisce il None memorizzato, non il default — il default vale solo se la chiave manca."""
    c = ((TIT.get(tk, {}).get("canali") or {}).get("canali") or {}).get(canale) or {}
    return bool((c.get(finestra) or {}).get("misurabile"))

_tassi_visti = [tk for tk in ORDINE if _mis(tk, "tassi", "lunga") or _mis(tk, "tassi", "corta")]
_su = len(_tassi_visti)
if _su == 0:
    _frase = ("<b>nessuna delle %d posizioni</b> supera il pavimento del rumore" % len(ORDINE))
elif _su == 1:
    _frase = ("<b>una sola posizione su %d</b> lo supera (%s), e di due millesimi"
              % (len(ORDINE), _tassi_visti[0]))
else:
    _frase = ("<b>%d posizioni su %d</b> lo superano (%s)"
              % (_su, len(ORDINE), ", ".join(_tassi_visti)))
w('<div class="nota attenzione"><b>E dal lato dei tassi la misura non trova quasi niente, il che '
  'non è la stessa cosa di «il libro è protetto».</b> La sezione «I canali macro→titolo» misura ogni '
  'posizione contro il Treasury lungo su due finestre: ' + _frase + ' — e su una posizione fra le meno '
  'indebitate del libro, cioè l\'ultima da cui ci si aspetterebbe. Significa che nella giornata media '
  'il legame non si vede, non che non esista: se i tassi contano, contano come <b>evento</b>, e la '
  'regressione sulle sedute di massima escursione del canale è lì per misurare proprio quello.</div>')
w('</section>')

# ── 2. IL LIBRO ──────────────────────────────────────────────────────────────────────────
w('<section id="libro"><h2>Il libro</h2>')
w(f'<p class="sommario">Quantità e prezzi medi di carico confermati dal CEO l\'08/09/2026. '
  f'I controvalori sono sulla <b>chiusura del {dt(BARRA)}</b> — un\'unica base per tutte le righe. '
  f'Il prezzo dichiarato dalla fonte in pre-mercato compare a parte nelle schede: due prezzi presi in '
  f'due momenti non si mescolano dentro lo stesso conto.</p>')
w('<div class="scorre"><table><thead><tr>'
  '<th>Titolo</th><th class="testo">Società</th><th>Qtà</th><th>PMC</th><th>Chiusura</th>'
  '<th>Controvalore</th><th>Peso</th><th>Guadagno</th><th>Dal max 52s</th><th>Vol. 1a</th>'
  '</tr></thead><tbody>')
for tk in ORDINE + SEGUITI:
    T = TIT[tk]; tec = T.get("tecnica") or {}; mer = tec.get("mercato") or {}
    fo = (T.get("fondamentali") or {}).get("anagrafica") or {}
    p = POS.get(tk, {}); c = mer.get("chiusura"); v = val_pos(tk)
    peso = LIB["pesi"].get(tk)
    gua = ((c / p["pmc"] - 1) * 100) if (c and p.get("pmc")) else None
    st = (tec.get("storico") or {})
    cls = ' class="spicca"' if peso and peso >= 15 else ""
    nome = (fo.get("nome") or "").replace(" Common Stock", "").replace(" Class A", " (A)")
    w(f'<tr{cls}><td><span class="tk">{tk}</span></td><td class="testo">{e(nome)}</td>'
      f'<td class="mono">{n(p.get("qta"),0) if p.get("qta") else "<span class=vuoto>seguito</span>"}</td>'
      f'<td class="mono">{n(p.get("pmc"),2) if p.get("pmc") else "<span class=vuoto>—</span>"}</td>'
      f'<td class="mono">{n(c,2)}</td>'
      f'<td class="mono">{n(v,0) if v else "<span class=vuoto>—</span>"}</td>'
      f'<td class="mono">{n(peso,1,"%") if peso else "<span class=vuoto>fuori</span>"}</td>'
      f'<td class="mono">{pc(gua) if gua is not None else "<span class=vuoto>—</span>"}</td>'
      f'<td class="mono">{pc(mer.get("dal_max_52s_pct"))}</td>'
      f'<td class="mono">{n(st.get("volatilita_annua_1a_pct"),1,"%")}</td></tr>')
w(f'<tr><td colspan="5"><b>Totale azionario</b></td><td class="mono"><b>{n(TOT_AZ,0)}</b></td>'
  f'<td class="mono"><b>100%</b></td><td colspan="3"></td></tr>')
w('</tbody></table></div>')
w('<div class="nota"><b>SKHY sta nella tabella e fuori dalla matrice di rischio</b>, ed è una cosa '
  'sola detta due volte: la sua ADS è quotata dal 13/07/2026, quindi ha 40 sedute contro le 124 delle '
  'altre. Il peso c\'è; il contributo al rischio si legge sotto, sulla sua finestra, dichiarata.</div>')
w('<div class="nota"><b>Fuori dall\'azionario:</b> BTP Valore Ott 2028 per 40.000 € nominali '
  '(valorizzato nominale × prezzo/100) e 10.000 € di liquidità, confermati dal CEO. '
  'Le misure di rischio qui sotto descrivono <b>il comparto azionario</b>, non il patrimonio: '
  'per riportarle al patrimonio serve il cambio del giorno, e il rapporto non lo pubblica finché '
  'non lo ha — un moltiplicatore sbagliato è peggio di un moltiplicatore assente.</div>')
w('</section>')

# ── 3. RISCHIO ───────────────────────────────────────────────────────────────────────────
w('<section id="rischio"><h2>Rischio e correlazioni</h2>')
w(f'<p class="sommario">Matrice di covarianza sulle serie complete, finestra di '
  f'<b>{LIB["finestra_sedute"]} sedute</b> ({dt(LIB["dal"])} → {dt(LIB["al"])}), ancora {LIB["ancora"]}. '
  f'Il contributo al rischio è la quota della varianza del libro attribuibile a ciascuna posizione: '
  f'somma 100%.</p>')
w('<div class="scorre"><table><thead><tr><th>Titolo</th><th>Peso</th><th>Contributo al rischio</th>'
  '<th>Divergenza</th><th>Corr. con ' + LIB["ancora"] + '</th><th class="testo">Lettura</th>'
  '</tr></thead><tbody>')
for tk in LIB["pesi"]:
    pe, ri = LIB["pesi"][tk], LIB["contributo_rischio"][tk]
    dv = ri - pe
    co = LIB["corr_ancora"].get(tk)
    if dv >= 5: let = "porta molta più varianza del suo peso"
    elif dv <= -3: let = "porta meno varianza del suo peso"
    else: let = "peso e rischio allineati"
    if co is not None and co >= 0.35 and tk != LIB["ancora"]: let += " · dentro il gruppo correlato"
    elif co is not None and tk != LIB["ancora"]: let += " · fuori dal gruppo correlato"
    cls = ' class="spicca"' if abs(dv) >= 5 else ""
    w(f'<tr{cls}><td><span class="tk">{tk}</span></td><td class="mono">{n(pe,1,"%")}</td>'
      f'<td class="mono">{n(ri,1,"%")}</td><td class="mono">{pc(dv,1)} pp</td>'
      f'<td class="mono">{n(co,2)}</td><td class="testo">{let}</td></tr>')
w('</tbody></table></div>')

for tk, c in CORTA.items():
    if c.get("stato", "").startswith("misurata"):
        pm = c["piu_correlato"]
        w(f'<div class="nota attenzione"><b>{tk}, misurata sulla propria finestra corta.</b> '
          f'{c["sedute"]} sedute ({dt(c["dal"])} → {dt(c["al"])}) contro le {LIB["finestra_sedute"]} '
          f'della matrice: <b>questi numeri non si confrontano con quelli sopra</b>, hanno un altro '
          f'denominatore. Correlazione con {LIB["ancora"]} <b>{n(c["corr_ancora"],2)}</b>, '
          f'con <b>{pm[0]} {n(pm[1],2)}</b> — il legame più forte del libro. '
          f'Volatilità annua {n(c["volatilita_annua_pct"],1)}%.<br><br>'
          f'La lettura operativa: {tk} <b>non diversifica</b> rispetto a {pm[0]}, aggiunge alla stessa '
          f'scommessa. Il vecchio sistema la dichiarava «non misurabile» e la lasciava fuori dal conto: '
          f'era prudente e non era vero.</div>')
w('<h3>Perché la serie lunga era la serie sbagliata</h3>')
sot = (TIT.get("SKHY") or {}).get("sottostante")
if sot:
    w(f'<p>SK hynix è quotata anche a {sot["borsa"]} come {e(sot["nota"])}, con '
      f'<b>{sot["barre"]} barre</b> dal {dt(sot["dal"])} — trenta volte la storia dell\'ADS. '
      f'Sostituirla sembrava il rimedio ovvio. Misurato:</p>')
w('<div class="scorre"><table><thead><tr><th class="testo">Serie usata</th><th>Sedute</th>'
  '<th>Corr. con NVDA</th><th>Corr. con MU</th></tr></thead><tbody>'
  '<tr class="spicca"><td class="testo">ADS SKHY — <b>lo strumento posseduto</b></td>'
  '<td class="mono">40</td><td class="mono">0,45</td><td class="mono">0,83</td></tr>'
  '<tr><td class="testo">Azione di Seoul in won, stessa data</td><td class="mono">250</td>'
  '<td class="mono">0,20</td><td class="vuoto">—</td></tr>'
  '<tr><td class="testo">Azione di Seoul, sfasata di una seduta</td><td class="mono">250</td>'
  '<td class="mono">0,22</td><td class="vuoto">—</td></tr></tbody></table></div>')
w('<div class="nota forte">Il won e la seduta coreana, che chiude prima di New York, spezzano una '
  'giornata di informazione americana su due barre: la correlazione scende sotto la metà. Con il '
  'sostituto, SKHY sarebbe finita <b>fuori</b> dal gruppo correlato (0,20 &lt; 0,35) mentre lo '
  'strumento vero ci sta <b>dentro</b> a 0,45. Una serie lunga che inverte la conclusione è peggio '
  'di una serie corta dichiarata.</div>')

w('<h3>Le misure di libro</h3>')
w('<div class="griglia">')
for et, vl, rf in (
    ("Correlazione media a coppie", n(LIB["corr_media"],3),
     f'su {LIB["finestra_sedute"]} sedute · {len(LIB["pesi"])} nomi'),
    ("Scommesse effettive", n(LIB["scommesse_effettive"],1),
     "1/((1−ρ)·H + ρ), con H l'Herfindahl dei pesi veri"),
    ("Volatilità annua", n(LIB["volatilita_annua_pct"],1)+"%", "del comparto azionario"),
    ("VaR 95% a un giorno", n(LIB["var95_1g_pct"],2)+"%", "storico, non parametrico"),
    ("Expected shortfall 95%", n(LIB["es95_1g_pct"],2)+"%", "media della coda oltre il VaR"),
    ("Drawdown della curva", n(LIB["drawdown_max_pct"],1)+"%", "sulla finestra misurata"),
):
    w(f'<div class="dato"><div class="et">{et}</div><div class="vl">{vl}</div><div class="rf">{rf}</div></div>')
w('</div>')
w(f'<div class="nota"><b>2,2 scommesse effettive su {len(LIB["pesi"])} nomi.</b> Il libro si comporta '
  'come se avesse poco più di due posizioni indipendenti: la diversificazione per numero di righe non '
  'è diversificazione. Non è un giudizio — un fondo growth concentrato sta così per costruzione. '
  'La domanda utile è se questa concentrazione sia stata <b>decisa</b> o sia <b>successa da sola</b> '
  'mentre i prezzi si muovevano.</div>')
w('</section>')

# ── 4. MACRO ─────────────────────────────────────────────────────────────────────────────
FAM = {}
for r in Q["macro"]["righe"]: FAM.setdefault(r["famiglia"], []).append(r)
NOMI_FAM = {"tassi":"Tassi", "curva":"Curva dei rendimenti", "inflazione":"Inflazione",
            "credito":"Credito", "rischio":"Rischio", "lavoro":"Lavoro",
            "attivita":"Attività economica", "materie prime":"Materie prime",
            "liquidita":"Liquidità"}
w('<section id="macro"><h2>Quadro macro</h2>')
w('<p class="sommario">Ventuno serie ufficiali, lette direttamente dalla fonte in CSV, senza chiave. '
  '<b>Il guadagno vero è la profondità</b>: il percentile «storico» è su tutta la serie — dal 1913 per '
  'il CPI, dal 1954 per il tasso Fed, dal 1948 per la disoccupazione — non su uno o cinque anni. '
  'Ogni riga dichiara il proprio campione e la propria data di inizio.</p>')
w('<div class="nota attenzione"><b>Su tre serie il percentile è calcolato sulla variazione a dodici '
  'mesi, non sul livello, e la riga lo dice.</b> Un indice dei prezzi sale sempre: il percentile del suo '
  'livello sarebbe 100 per costruzione, e chi legge concluderebbe «inflazione da record» — falso, a '
  'essere da record è il livello dell\'indice. Vale per CPI, PCE e le masse dei fondi monetari.</div>')
for fam, righe in FAM.items():
    w(f'<h3>{NOMI_FAM.get(fam,fam.title())}</h3>')
    w('<div class="scorre"><table><thead><tr><th class="testo">Indicatore</th><th>Valore</th>'
      '<th>Rilevazione</th><th>Δ 1m</th><th>Δ 12m</th><th>Perc. 1a</th><th>Perc. 5a</th>'
      '<th>Perc. storico</th><th class="testo">Campione</th></tr></thead><tbody>')
    for r in righe:
        variaz = r["misura"] == "variazione_12m"
        val = r.get("variazione_12m_pct") if variaz else r["valore"]
        dec = 2 if abs(float(val or 0)) < 100 else 1
        et = f'{e(r["nome"])} <span class="piccolo">{r["serie"]}</span>'
        if variaz: et += ' <span class="chip att">var 12m</span>'
        if r.get("nota_finestra"): et += ' <span class="chip att">licenza 3a</span>'
        ps = r["perc_storico"]
        cls = ' class="spicca"' if ps is not None and (ps >= 90 or ps <= 10) else ""
        camp = (f'{r["n_storico"]} dal {dt(r.get("variazioni_dal") or r["dal"])}')
        w(f'<tr{cls}><td class="testo">{et}</td>'
          f'<td class="mono">{n(val,dec)}{" %" if variaz else ""}</td>'
          f'<td class="mono">{dt(r["data"])}</td>'
          f'<td class="mono">{n(r["var_1m"],2)}</td><td class="mono">{n(r["var_12m"],2)}</td>'
          f'<td class="mono">{ord_(r["perc_1a"])}</td><td class="mono">{ord_(r["perc_5a"])}</td>'
          f'<td class="mono"><b>{ord_(ps)}</b></td>'
          f'<td class="testo piccolo">{camp}</td></tr>')
        if r.get("lettura") or r.get("perche_variazione") or r.get("nota_finestra"):
            note = " · ".join(x for x in (r.get("lettura"), r.get("perche_variazione"),
                                          r.get("nota_finestra")) if x)
            w(f'<tr><td colspan="9" class="testo piccolo" style="padding-top:0;'
              f'border-bottom:1px solid var(--riga);color:var(--inchiostro-2)">⚠ {e(note)}</td></tr>')
    w('</tbody></table></div>')

w('<h3>Le tre letture che una finestra a cinque anni non dà</h3>')
w('<div class="scorre"><table><thead><tr><th class="testo">Serie</th><th>1 anno</th><th>5 anni</th>'
  '<th>Tutta la storia</th><th class="testo">Cosa cambia</th></tr></thead><tbody>')
for sid, spiega in (
    ("VIXCLS", "sul solo anno il VIX sembra a un minimo estremo; sulla serie dal 1990 è in un terzo "
               "basso ordinario. Le due letture portano a due conclusioni diverse sulla compiacenza."),
    ("UMCSENT", "la fiducia dei consumatori sta al secondo percentile dal 1952 mentre la disoccupazione "
                "sta al diciannovesimo: due misure dello stesso mondo che dicono l'opposto."),
    ("DFII10", "sull'anno è alto; su tutta la serie dei TIPS è quasi al massimo mai visto. "
               "È la differenza fra «tassi alti» e «costo reale del capitale da record»."),
):
    r = MACRO[sid]
    w(f'<tr><td class="testo">{e(r["nome"])} <span class="piccolo">{sid}</span></td>'
      f'<td class="mono">{ord_(r["perc_1a"])}</td><td class="mono">{ord_(r["perc_5a"])}</td>'
      f'<td class="mono"><b>{ord_(r["perc_storico"])}</b> <span class="piccolo">n={r["n_storico"]}</span></td>'
      f'<td class="testo">{spiega}</td></tr>')
w('</tbody></table></div>')
w('</section>')

# ── 5. CANALI MACRO→TITOLO ───────────────────────────────────────────────────────────────
def riga_canale(c):
    """una riga per finestra: beta, R2, campione, pavimento. Sotto il pavimento si DICHIARA."""
    fuori = []
    for et, k in (("lunga", "lunga"), ("corta", "corta"), ("coda", "coda")):
        m = c.get(k)
        if not m: continue
        if m.get("beta") is None:
            fuori.append(f'<tr><td class="testo">{et}</td><td colspan="4" class="testo piccolo">'
                         f'{e(m.get("stato"))}</td></tr>')
            continue
        ok = m.get("misurabile")
        stato = ('<span class="chip pos">misurabile</span>' if ok
                 else '<span class="chip">sotto il rumore</span>')
        nota = ' <span class="piccolo">altro denominatore</span>' if k == "coda" else ""
        w_beta = f'<b>{n(m["beta"],2)}</b>' if ok else f'<span class="vuoto">{n(m["beta"],2)}</span>'
        fuori.append(f'<tr><td class="testo">{et}{nota}</td><td class="mono">{w_beta}</td>'
                     f'<td class="mono">{n(m["r2"],3)}</td>'
                     f'<td class="mono piccolo">pav. {n(m.get("pavimento_rumore"),3)}</td>'
                     f'<td class="mono piccolo">n={m["n"]}</td></tr>')
    return "".join(fuori)

def tabella_canali(tk):
    d = (TIT[tk].get("canali") or {}).get("canali") or {}
    if not d: return '<p class="piccolo">Nessun canale misurato.</p>'
    out = ['<div class="scorre"><table><thead><tr><th class="testo">Canale / finestra</th><th>Beta</th>'
           '<th>R²</th><th>Pavimento</th><th>Campione</th></tr></thead><tbody>']
    for nome, c in d.items():
        tr = c.get("transizione") or c.get("stato") or ""
        out.append(f'<tr class="spicca"><td class="testo"><b>{nome}</b> '
                   f'<span class="piccolo">{e(c.get("strumento"))} · {e(c.get("spiegazione"))}</span></td>'
                   f'<td colspan="4" class="testo piccolo">{e(tr)}</td></tr>')
        out.append(riga_canale(c))
    out.append('</tbody></table></div>')
    return "".join(out)

w('<section id="canali"><h2>I canali macro→titolo</h2>')
w('<p class="sommario">Regressione dei rendimenti giornalieri di ogni titolo su uno strumento '
  '<b>quotato</b> che rappresenta il canale — QQQ per il mercato, SMH per il comparto, TLT per i tassi, '
  'UUP per il dollaro. Quotato perché ha la stessa barra giornaliera: la finestra comune esiste per '
  'costruzione e le serie si allineano per data, mai per posizione.</p>')
w('<div class="nota"><b>Un beta senza il suo R² è mezzo numero.</b> Beta, R², campione e finestra '
  'viaggiano insieme, e sotto il pavimento del rumore la riga dichiara che il canale non è misurabile '
  'invece di pubblicare un numero. Il pavimento <b>si calcola dal campione</b>: con 250 osservazioni il '
  'puro caso supera R² 0,015 nel 5% dei campioni, con 60 osservazioni supera 0,065. Una soglia fissa a '
  '0,05 sarebbe prudente sulla finestra lunga e permissiva su quella corta — accenderebbe canali dal '
  'nulla, cioè fabbricherebbe proprio il segnale che deve rilevare.</div>')
w('<div class="nota"><b>Il terzo sguardo non è una terza finestra.</b> È la regressione sul quinto di '
  'sedute in cui <b>il canale</b> ha l\'escursione maggiore: risponde a «il giorno che il canale salta, '
  'quanto perdo», che è la domanda che pone un libro concentrato. Si seleziona sulla causa e non '
  'sull\'effetto — selezionare sul movimento del titolo distorcerebbe il beta. Il suo R² è calcolato su '
  'un sottoinsieme scelto: ha un denominatore diverso e <b>non si confronta</b> con gli altri due. '
  'Quello che si confronta è il beta.</div>')

w('<h3>Sintesi: dove ogni posizione è agganciata</h3>')
w('<div class="scorre"><table><thead><tr><th>Titolo</th>'
  '<th>Mercato β</th><th>R²</th><th>Comparto β</th><th>R²</th>'
  '<th>Tassi</th><th>Dollaro</th></tr></thead><tbody>')
for tk in ORDINE + SEGUITI:
    d = (TIT[tk].get("canali") or {}).get("canali") or {}
    def cella(k):
        c = d.get(k) or {}; L = c.get("lunga") or {}
        if L.get("beta") is None: return '<span class="vuoto">—</span>', '<span class="vuoto">—</span>'
        b = f'<b>{n(L["beta"],2)}</b>' if L.get("misurabile") else f'<span class="vuoto">{n(L["beta"],2)}</span>'
        return b, n(L.get("r2"), 3)
    mb, mr = cella("mercato"); cb, cr = cella("comparto")
    def breve(k):
        c = d.get(k) or {}; L = c.get("lunga") or {}; C = c.get("corta") or {}
        if L.get("misurabile") or C.get("misurabile"):
            q = L if L.get("misurabile") else C
            return f'<b>{n(q["beta"],2)}</b>'
        return '<span class="vuoto">non misurabile</span>'
    w(f'<tr><td><span class="tk">{tk}</span></td><td class="mono">{mb}</td><td class="mono">{mr}</td>'
      f'<td class="mono">{cb}</td><td class="mono">{cr}</td>'
      f'<td class="mono">{breve("tassi")}</td><td class="mono">{breve("dollaro")}</td></tr>')
w('</tbody></table></div>')
w('<p class="piccolo">Un beta in grigio è sotto il pavimento del rumore: il numero esiste, la relazione '
  'no. Il dettaglio delle tre finestre sta dentro la scheda di ciascun titolo.</p>')
w('</section>')

# ── 6. LE GIUNZIONI ──────────────────────────────────────────────────────────────────────
w('<section id="giunzioni"><h2>Le giunzioni</h2>')
w('<p class="sommario">Nove elenchi accanto non fanno un\'analisi. Qui ogni riga unisce '
  '<b>almeno due fonti</b>: una riga che ne usa una sola è un blocco precedente riscritto.</p>')

w('<h3>Notizia → canale → libro</h3>')
w('<p>La stampa di stamattina dà tre fatti macro, e ciascuno arriva al libro attraverso un canale '
  'che questo rapporto ha misurato.</p>')
w('<div class="scorre"><table><thead><tr><th class="testo">Fatto</th><th class="testo">Canale misurato</th>'
  '<th class="testo">Su quali posizioni, e quanto</th></tr></thead><tbody>')
# ⚠ I NUMERI DI QUESTE TRE RIGHE SI CONTANO. Una frase in prosa con dentro un conteggio
# invecchia da sola (v410/v411/v415/v424), e la prima stesura ne aveva gia' due sbagliate:
# «1 posizioni su 13» e «13 posizioni valgono il 100% dell'azionario» — quest'ultima sommava
# DODICI pesi e ne annunciava TREDICI, ed era comunque vuota: se il canale vale per tutti, la
# quota e' 100 per costruzione. Un conteggio che non puo' essere falso non e' un'informazione.
def _visti(canale, finestra="lunga"):
    return [tk for tk in ORDINE if _mis(tk, canale, finestra)]

def _beta_pesato(canale):
    """beta medio pesato sui pesi della matrice, e i due estremi. ⚠ Solo sulle posizioni che
    HANNO un peso li' dentro: sommare tredici nomi su dodici pesi e' il difetto appena corretto."""
    co = []
    for tk, pe in LIB["pesi"].items():
        c = ((TIT.get(tk, {}).get("canali") or {}).get("canali") or {}).get(canale) or {}
        b = (c.get("lunga") or {}).get("beta")
        if b is not None: co.append((tk, pe, b))
    if not co: return None
    peso = sum(p for _, p, _ in co)
    med = sum(p * b for _, p, b in co) / peso
    ordinati = sorted(co, key=lambda x: -x[2])
    return {"beta": med, "peso": peso, "n": len(co),
            "alto": ordinati[0], "basso": ordinati[-1]}

_sm = _beta_pesato("comparto")
_semi = _visti("comparto")
w(f'<tr class="spicca"><td class="testo">Il ciclo della memoria: DRAM +51% di ricavi attesi nel 2026, '
  f'HBM in carenza del 50-60%, prezzi +20-40% a/a</td>'
  f'<td class="testo">comparto (SMH) — misurabile su <b>{len(_semi)} posizioni su {len(ORDINE)}</b>, '
  f'cioè su tutte</td>'
  f'<td class="testo">il beta di comparto medio pesato del libro è <b>{n(_sm["beta"],2)}</b> '
  f'<span class="piccolo">su {n(_sm["peso"],0)}% di peso, {_sm["n"]} posizioni con peso in matrice</span>, '
  f'dal <b>{_sm["alto"][0]} {n(_sm["alto"][2],2)}</b> al <b>{_sm["basso"][0]} {n(_sm["basso"][2],2)}</b>. '
  f'Il libro <b>è</b> l\'indice dei semiconduttori, con sopra la leva del mercato. '
  f'MU è il 24% del capitale e il 38% della varianza; SKHY si muove con MU a 0,83 — '
  f'non sono due esposizioni, è una scritta due volte.</td></tr>')

_ts_l = _visti("tassi", "lunga"); _ts_c = _visti("tassi", "corta")
if not _ts_l and not _ts_c:
    _frase_t = f"<b>nessuna delle {len(ORDINE)} posizioni</b> supera il pavimento del rumore"
else:
    _n = sorted(set(_ts_l) | set(_ts_c))
    _frase_t = ("<b>una posizione su %d</b> lo supera (%s)" % (len(ORDINE), ", ".join(_n))
                if len(_n) == 1 else
                "<b>%d posizioni su %d</b> lo superano (%s)" % (len(_n), len(ORDINE), ", ".join(_n)))
_g = ((TIT.get(_ts_l[0], {}).get("canali") or {}).get("canali") or {}).get("tassi", {}) if _ts_l else {}
_gl = (_g.get("lunga") or {})
_dett = ("" if not _ts_l else
         f' — e di quanto conta: R² {n(_gl.get("r2"),3)} contro un pavimento di '
         f'{n(_gl.get("pavimento_rumore"),3)}, cioè appena sopra, sulla posizione del libro con meno '
         f'debito.')
# le beta della finestra corta sono cresciute su piu' nomi pur restando sotto il pavimento:
# e' un fatto, e va detto come tale invece di essere trasformato in una conclusione.
_cresciuti = []
for tk in ORDINE:
    c = ((TIT.get(tk, {}).get("canali") or {}).get("canali") or {}).get("tassi") or {}
    bl = (c.get("lunga") or {}).get("beta"); bc = (c.get("corta") or {}).get("beta")
    if bl is not None and bc is not None and bc > bl + 0.5: _cresciuti.append(tk)
w(f'<tr><td class="testo">FOMC del 16/09: Polymarket ~52% di rialzo, futures ~32%. '
  f'CPI di agosto l\'11/09</td>'
  f'<td class="testo">tassi (TLT) — {_frase_t}{_dett}</td>'
  f'<td class="testo">nella giornata media il legame non c\'è. Ma sulla finestra corta il beta è '
  f'<b>cresciuto di oltre mezzo punto su {len(_cresciuti)} posizioni</b> '
  f'<span class="piccolo">{", ".join(_cresciuti)}</span> pur restando sotto il proprio pavimento: '
  f'è un fatto, non una conclusione — con sessanta sedute il pavimento è quattro volte più alto e '
  f'un evento non basta a fare un regime. Se i tassi contano, contano come <b>evento</b>: '
  f'la regressione sulle sedute di massima escursione del canale è la misura da leggere.</td></tr>')

_dl = _beta_pesato("dollaro"); _dollaro = _visti("dollaro")
w(f'<tr><td class="testo">Petrolio al {ord_(MACRO["DCOILWTICO"]["perc_storico"])} percentile dal 1986 '
  f'dopo gli scambi di colpi USA-Iran; tariffe canadesi in vigore da oggi</td>'
  f'<td class="testo">dollaro (UUP) — misurabile su <b>{len(_dollaro)} posizioni su {len(ORDINE)}</b>'
  + (f' ({", ".join(_dollaro)})' if 0 < len(_dollaro) <= 5 else '') + '</td>'
  f'<td class="testo">il beta medio pesato è <b>{n(_dl["beta"],2)}</b>: dollaro forte, libro debole. '
  f'Un rialzo dei tassi passa di qui prima che dai multipli, e questo è il canale su cui la misura '
  f'trova qualcosa.</td></tr>')
w('</tbody></table></div>')

w('<h3>Tecnica ↔ fondamentale: dove le due letture non concordano</h3>')
w('<p>Il caso che conta è il disaccordo. Sotto, le posizioni in cui il prezzo e il bilancio '
  'raccontano cose diverse.</p>')
w('<div class="scorre"><table><thead><tr><th>Titolo</th><th>Prezzo vs 52s</th><th>RSI</th>'
  '<th>Medie battute</th><th>Ultimo bilancio</th><th>Età</th><th class="testo">Il disaccordo</th>'
  '</tr></thead><tbody>')
def ultimo_trimestre(tk):
    b = ((TIT[tk].get("fondamentali") or {}).get("bilanci_trimestrale") or {}).get("conto_economico") or {}
    return list(b)[0] if b else None
def eta_bilancio(p):
    if not p: return None
    try:
        m, g, a = p.split("/")
        return (date.today() - date(int(a), int(m), int(g))).days
    except Exception: return None
for tk in ORDINE + SEGUITI:
    T = TIT[tk]; tec = T.get("tecnica") or {}
    mer = tec.get("mercato") or {}; tc = tec.get("tecnica") or {}
    q = ultimo_trimestre(tk); eb = eta_bilancio(q)
    rsi = tc.get("rsi14"); mb = tc.get("medie_battute"); mt = tc.get("medie_totali")
    dmax = mer.get("dal_max_52s_pct")
    diss = []
    if rsi and rsi >= 70: diss.append("RSI in ipercomprato")
    if rsi and rsi <= 30: diss.append("RSI in ipervenduto")
    if mb is not None and mt and mb == 0: diss.append("<b>sotto tutte le proprie medie</b>")
    if mb is not None and mt and mb == mt: diss.append("sopra tutte le proprie medie")
    if eb and eb > 100: diss.append(f"<b>bilancio di {eb} giorni fa</b>: le conclusioni sulla cassa "
                                    "non sono affermabili su questo dato")
    if not q: diss.append("nessun bilancio trimestrale da questa fonte (emittente estero: deposita 20-F/6-K)")
    cls = ' class="spicca"' if (eb and eb > 100) or (mb == 0) else ""
    w(f'<tr{cls}><td><span class="tk">{tk}</span></td><td class="mono">{pc(dmax)}</td>'
      f'<td class="mono">{n(rsi,1)}</td>'
      f'<td class="mono">{mb}/{mt}</td><td class="mono">{e(q) if q else "<span class=vuoto>—</span>"}</td>'
      f'<td class="mono">{str(eb)+" gg" if eb else "<span class=vuoto>—</span>"}</td>'
      f'<td class="testo">{" · ".join(diss) if diss else "<span class=vuoto>niente da segnalare</span>"}</td></tr>')
w('</tbody></table></div>')
w('<div class="nota attenzione"><b>Un bilancio vecchio non dichiara di esserlo, e le conclusioni sì.</b> '
  'Dove l\'ultimo trimestre depositato ha più di cento giorni, ogni frase su cassa, autonomia e '
  'copertura degli oneri poggia su un numero superato: la data viaggia col numero, non nella nota.</div>')
w('</section>')

# ── 7. SCHEDE PER TITOLO ─────────────────────────────────────────────────────────────────
VOCI_CE = ["Total Revenue", "Gross Profit", "Operating Income", "Earnings Before Interest and Tax",
           "Interest Expense", "Net Income", "Net Income Applicable to Common Shareholders"]
VOCI_SP = ["Cash and Cash Equivalents", "Total Current Assets", "Total Assets",
           "Total Current Liabilities", "Long-Term Debt", "Total Liabilities", "Total Equity"]
VOCI_FC = ["Net Income", "Net Cash Flow-Operating", "Capital Expenditures",
           "Net Cash Flows-Investing", "Net Cash Flows-Financing", "Net Cash Flow"]
VOCI_IND = ["Gross Margin", "Operating Margin", "Profit Margin", "After Tax ROE",
            "Current Ratio", "Quick Ratio", "Long-term Debt / Capital", "Debt/Equity Ratio"]

def prospetto(tab, voci, titolo, unita="migliaia $"):
    if not tab: return ""
    periodi = list(tab)[:4]
    presenti = [v for v in voci if any(tab[p].get(v) is not None for p in periodi)]
    if not presenti: return ""
    o = [f'<h4>{titolo} <span class="piccolo">{unita}</span></h4>',
         '<div class="scorre"><table><thead><tr><th class="testo">Voce</th>']
    for p in periodi: o.append(f'<th>{e(p)}</th>')
    o.append('</tr></thead><tbody>')
    for v in presenti:
        o.append(f'<tr><td class="testo">{e(v)}</td>')
        for p in periodi:
            x = tab[p].get(v)
            dec = 2 if (x is not None and abs(x) < 100) else 0
            o.append(f'<td class="mono">{n(x,dec)}</td>')
        o.append('</tr>')
    o.append('</tbody></table></div>')
    return "".join(o)

w('<section id="schede"><h2>Schede per titolo</h2>')
w('<p class="sommario">Le cinque sezioni dello schema che il CEO ha fornito, su <b>barre '
  'giornaliere</b>, più le statistiche storiche che una singola fotografia non dà. Ogni scheda apre '
  'con i due prezzi che il rapporto conosce — la chiusura dell\'ultima seduta e l\'ultimo prezzo '
  'dichiarato dalla fonte — con i loro due momenti, che non si mescolano.</p>')

for tk in ORDINE + SEGUITI:
    T = TIT[tk]; tec = T.get("tecnica") or {}
    mer = tec.get("mercato") or {}; tc = tec.get("tecnica") or {}; st = tec.get("storico") or {}
    F = T.get("fondamentali") or {}; an = F.get("anagrafica") or {}
    al = F.get("analisti") or {}; ut = F.get("utili") or {}
    camp = an.get("campi") or {}
    p = POS.get(tk, {}); c = mer.get("chiusura")
    gua = ((c / p["pmc"] - 1) * 100) if (c and p.get("pmc")) else None
    peso = LIB["pesi"].get(tk)
    nome = an.get("nome") or tk
    aperta = " open" if tk in ORDINE[:2] else ""
    w(f'<details class="scheda" id="t-{tk}"{aperta}><summary>')
    w(f'<span class="nome">{tk}</span><span class="soc">{e(nome)}</span><span class="cifre">')
    w(f'<span>{n(c,2)} $</span>')
    if peso: w(f'<span>{n(peso,1,"%")} del libro</span>')
    if gua is not None: w(f'<span>{pc(gua)} dal carico</span>')
    if not T["posseduto"]: w('<span class="chip">seguito, non posseduto</span>')
    w('</span></summary><div class="corpo">')

    # 1 — mercato
    w('<h4>1 · Dati di mercato e prezzi</h4>')
    w('<div class="scorre"><table class="kv"><tbody>')
    righe1 = [
        ("Chiusura ultima seduta", f'{n(mer.get("chiusura"),2)} $ <span class="piccolo">{dt(tec.get("al"))}</span>'),
        ("Apertura / min / max della seduta", f'{n(mer.get("apertura"),2)} · {n(mer.get("min_gg"),2)} · {n(mer.get("max_gg"),2)}'),
        ("Ultimo prezzo dichiarato dalla fonte", f'{n(an.get("ultimo_prezzo"),2)} $ <span class="piccolo">{e(an.get("prezzo_riferito_a"))}</span>'),
        ("52 settimane", f'{n(mer.get("min_52s"),2)} – {n(mer.get("max_52s"),2)} · posizione nel range {n(mer.get("pos_range_52s_pct"),0)}%'),
        ("Distanza dal massimo a 52 settimane", pc(mer.get("dal_max_52s_pct"))),
        ("Massimo storico su 5 anni", f'{n(mer.get("max_storico"),2)} · {pc(mer.get("dal_max_storico_pct"))}'),
        ("Variazione a un anno", pc(mer.get("var_1a_pct"))),
        ("Volume / media 3 mesi", f'{n(mer.get("volume"),0)} / {n(mer.get("volume_medio_3m"),0)}'),
        ("Capitalizzazione", e(camp.get("MarketCap") or "—")),
        ("Comparto / industria", f'{e(camp.get("Sector") or "—")} · {e(camp.get("Industry") or "—")}'),
    ]
    for a, b in righe1:
        w(f'<tr><td class="testo">{a}</td><td class="mono">{b}</td></tr>')
    w('</tbody></table></div>')

    # 2 — fondamentali
    w('<h4>2 · Dati finanziari e rapporti chiave</h4>')
    bq = F.get("bilanci_trimestrale") or {}; ba = F.get("bilanci_annuale") or {}
    if bq.get("conto_economico"):
        ult = list(bq["conto_economico"])[0]; eb = eta_bilancio(ult)
        if eb and eb > 100:
            w(f'<div class="nota attenzione">L\'ultimo trimestre depositato chiude il <b>{e(ult)}</b>, '
              f'<b>{eb} giorni fa</b>. Ogni conclusione su cassa, autonomia e copertura degli oneri '
              f'poggia su questo bilancio e non è affermabile senza un deposito più recente.</div>')
        w(prospetto(bq["conto_economico"], VOCI_CE, "Conto economico, ultimi quattro trimestri"))
        w(prospetto(bq.get("stato_patrimoniale"), VOCI_SP, "Stato patrimoniale, ultimi quattro trimestri"))
        w(prospetto(bq.get("flussi_di_cassa"), VOCI_FC, "Flussi di cassa, ultimi quattro trimestri"))
        w(prospetto(ba.get("indici"), VOCI_IND, "Indici, ultimi quattro esercizi", "% dove indicato"))
    else:
        w('<div class="nota">Nessun bilancio da questa fonte. È un <b>emittente estero</b>: non deposita '
          '10-Q/10-K ma 20-F e 6-K, che questa raccolta non legge. Non è un dato mancante per errore — '
          'è una classe di documenti diversa, e va cercata altrove.</div>')

    # 3 — tecnica
    w('<h4>3 · Analisi tecnica e indicatori <span class="piccolo">su barre giornaliere</span></h4>')
    md = tc.get("medie") or {}; ds = tc.get("dist_medie_pct") or {}
    em = tc.get("ema") or {}; mc = tc.get("macd") or {}; sh = tc.get("stoch_9_6") or {}
    w('<div class="due">')
    w('<div><div class="scorre"><table class="kv"><tbody>')
    for a, b in [
        ("RSI 14", f'{n(tc.get("rsi14"),1)} <span class="piccolo">{ord_(st.get("percentile_rsi_1a"))} percentile del proprio anno</span>'),
        ("MACD 12/26/9", f'{n(mc.get("linea"),3)} · segnale {n(mc.get("segnale"),3)} · istogramma {n(mc.get("istogramma"),3)}'),
        ("Stocastico 9/6", f'K {n(sh.get("K"),1)} · D {n(sh.get("D"),1)}'),
        ("Stocastico RSI 14", n(tc.get("stochrsi14"),1)),
        ("CCI 14", n(tc.get("cci14"),1)),
        ("ADX 14", n(tc.get("adx14"),1)),
        ("ATR 14", f'{n(tc.get("atr14"),3)} <span class="piccolo">= {n(tc.get("atr_pct"),2)}% del prezzo · '
                   f'{ord_(st.get("percentile_atr_1a"))} percentile del proprio anno</span>'),
        ("Supporto / resistenza a 20 sedute", f'{n(tc.get("supporto_20"),2)} – {n(tc.get("resistenza_20"),2)}'),
        ("Pivot Fibonacci", n((tc.get("pivot_fib") or {}).get("P"), 2)),
    ]:
        w(f'<tr><td class="testo">{a}</td><td class="mono">{b}</td></tr>')
    w('</tbody></table></div></div>')
    w('<div><div class="scorre"><table><thead><tr><th class="testo">Media</th><th>Livello</th>'
      '<th>Distanza</th></tr></thead><tbody>')
    for k in ("sma5", "sma10", "sma20", "sma50", "sma100", "sma200"):
        if md.get(k) is None: continue
        w(f'<tr><td class="testo">semplice a {k[3:]} sedute</td><td class="mono">{n(md[k],2)}</td>'
          f'<td class="mono">{pc(ds.get(k),2)}</td></tr>')
    for k in ("ema9", "ema21", "ema50"):
        if em.get(k) is None: continue
        w(f'<tr><td class="testo">esponenziale a {k[3:]}</td><td class="mono">{n(em[k],2)}</td>'
          f'<td class="vuoto">—</td></tr>')
    w(f'<tr><td class="testo"><b>Medie battute</b></td><td class="mono" colspan="2">'
      f'<b>{tc.get("medie_battute")} su {tc.get("medie_totali")}</b></td></tr>')
    w('</tbody></table></div></div></div>')

    # storico
    dd5 = st.get("drawdown_max_5a") or {}; dd1 = st.get("drawdown_max_1a") or {}
    w('<h4>Statistiche storiche <span class="piccolo">che una fotografia non dà</span></h4>')
    w('<div class="scorre"><table><thead><tr><th class="testo">Misura</th><th>Valore</th>'
      '<th class="testo">Finestra</th></tr></thead><tbody>')
    for a, b, cc in [
        ("Discesa massima già avvenuta", f'{n(dd5.get("pct"),1,"%")} · {dd5.get("sedute")} sedute sott\'acqua'
            + ("" if dd5.get("recuperato") else " · <b>non recuperata</b>"),
         f'{tec.get("barre")} barre dal {dt(tec.get("dal"))}'),
        ("Discesa massima dell'ultimo anno", f'{n(dd1.get("pct"),1,"%")} · {dd1.get("sedute")} sedute'
            + ("" if dd1.get("recuperato") else " · <b>non recuperata</b>"), "252 sedute"),
        ("Volatilità annualizzata", f'{n(st.get("volatilita_annua_1a_pct"),1,"%")} sull\'anno · '
                                    f'{n(st.get("volatilita_annua_5a_pct"),1,"%")} sui cinque anni', "—"),
        ("Prezzo nella propria distribuzione", f'{ord_(st.get("percentile_prezzo_1a"))} sull\'anno · '
                                               f'{ord_(st.get("percentile_prezzo_5a"))} sui cinque anni',
         "convenzione midrank"),
    ]:
        w(f'<tr><td class="testo">{a}</td><td class="mono">{b}</td><td class="testo piccolo">{cc}</td></tr>')
    w('</tbody></table></div>')
    w('<p class="piccolo">La discesa massima già avvenuta è il numero contro cui si legge la discesa in '
      'corso: senza, «−19% dal massimo» non dice se sia ordinario o una rottura.</p>')

    # canali
    w('<h4>Canali macro</h4>')
    w(tabella_canali(tk))

    # 4 — analisti
    w('<h4>4 · Target price e giudizi degli analisti</h4>')
    if al.get("target_medio") or al.get("giudizio_medio"):
        upside = ((al["target_medio"] / c - 1) * 100) if (al.get("target_medio") and c) else None
        w('<div class="scorre"><table class="kv"><tbody>')
        for a, b in [
            ("Giudizio medio", e(al.get("giudizio_medio") or "—")),
            ("Base", e(al.get("base") or "—")),
            ("Target medio a 12 mesi", (f'{n(al.get("target_medio"),2)} $ · {pc(upside)} sulla chiusura'
                                        if al.get("target_medio") else '<span class="vuoto">non pubblicato dalla fonte</span>')),
            ("Target minimo / massimo", f'{n(al.get("target_min"),2)} – {n(al.get("target_max"),2)}'
                                        if al.get("target_min") else '<span class="vuoto">—</span>'),
            ("Ripartizione", f'{al.get("compra")} compra · {al.get("mantieni")} mantieni · {al.get("vendi")} vendi'
                             if al.get("compra") is not None else '<span class="vuoto">—</span>'),
        ]:
            w(f'<tr><td class="testo">{a}</td><td class="mono">{b}</td></tr>')
        w('</tbody></table></div>')
        if al.get("target_medio") is None and al.get("giudizio_medio"):
            w('<div class="nota attenzione">La fonte pubblica un <b>giudizio</b> senza un <b>target</b>. '
              'Un giudizio senza il prezzo a cui si riferisce non è azionabile: non si deduce il secondo '
              'dal primo.</div>')
    else:
        w('<p class="piccolo">Nessun dato dalla fonte.</p>')

    # 5 — utili
    w('<h4>5 · Storico utili e previsioni</h4>')
    sor = ut.get("sorprese") or []
    if sor:
        w('<div class="scorre"><table><thead><tr><th class="testo">Trimestre fiscale</th>'
          '<th>Comunicato il</th><th>EPS</th><th>Atteso</th><th>Sorpresa</th></tr></thead><tbody>')
        for r in sor[:5]:
            ps = r.get("percentageSurprise")
            w(f'<tr><td class="testo">{e(r.get("fiscalQtrEnd"))}</td>'
              f'<td class="mono">{e(r.get("dateReported"))}</td>'
              f'<td class="mono">{n(r.get("eps"),2)}</td><td class="mono">{n(r.get("consensusForecast"),2)}</td>'
              f'<td class="mono">{pc(ps) if ps not in (None,"") else "<span class=vuoto>—</span>"}</td></tr>')
        w('</tbody></table></div>')
    prev = ut.get("previsioni_trimestrali") or []
    if prev:
        w('<div class="scorre"><table><thead><tr><th class="testo">Trimestre atteso</th>'
          '<th>EPS consenso</th><th>Minimo</th><th>Massimo</th><th>Stime</th>'
          '<th>Riviste su / giù</th></tr></thead><tbody>')
        for r in prev[:4]:
            w(f'<tr><td class="testo">{e(r.get("fiscalEnd"))}</td>'
              f'<td class="mono">{n(r.get("consensusEPSForecast"),2)}</td>'
              f'<td class="mono">{n(r.get("lowEPSForecast"),2)}</td>'
              f'<td class="mono">{n(r.get("highEPSForecast"),2)}</td>'
              f'<td class="mono">{e(r.get("noOfEstimates"))}</td>'
              f'<td class="mono">{e(r.get("up"))} / {e(r.get("down"))}</td></tr>')
        w('</tbody></table></div>')
    if not sor and not prev:
        w('<p class="piccolo">Nessun dato dalla fonte.</p>')

    # sottostante estero
    so = T.get("sottostante")
    if so:
        w('<h4>Il listino di casa <span class="piccolo">non è lo strumento posseduto</span></h4>')
        w(f'<div class="nota"><b>{e(so["nome"])}</b> — {e(so["borsa"])}, {so["barre"]} barre dal '
          f'{dt(so["dal"])} al {dt(so["al"])}, ultima chiusura <b>{n(so["ultima_chiusura"],0)} '
          f'{so["valuta"]}</b>. È la stessa società ma un\'altra quotazione: altra valuta, altra seduta, '
          f'un rapporto di conversione proprio. Serve a leggere la società, <b>non</b> a sostituire la '
          f'serie corta dello strumento nel calcolo del rischio.</div>')

    # notizie del titolo
    nz = T.get("notizie") or {}
    voci = [v for v in (nz.get("voci") or []) if v.get("ore_fa") is not None and v["ore_fa"] <= 72]
    w('<h4>Notizie dal feed di ' + tk + f' <span class="piccolo">ultime 72 ore · {len(voci)} voci</span></h4>')
    if nz.get("stato") == "NON letto":
        w(f'<div class="nota forte">La fonte <b>non ha risposto</b>: {e(nz.get("errori"))}. '
          '«Nessuna notizia» e «la fonte non ha risposto» si leggono uguali e significano l\'opposto.</div>')
    elif not voci:
        w(f'<p class="piccolo">Il feed ha risposto e non porta voci nelle ultime 72 ore '
          f'({len(nz.get("voci") or [])} voci in tutto, la più recente '
          f'{n((nz.get("voci") or [{}])[0].get("ore_fa"),0)} ore fa).</p>')
    else:
        w('<ul>')
        for v in voci[:6]:
            fnt = f' <span class="piccolo">{e(v["fonte_voce"])}</span>' if v.get("fonte_voce") else ""
            w(f'<li><a href="{e(v["link"])}" target="_blank" rel="noopener">{e(v["titolo"])}</a>'
              f'{fnt} <span class="piccolo">{n(v["ore_fa"],0)} ore fa</span></li>')
        w('</ul>')
        w(f'<p class="piccolo">⚠ «[{tk}]» significa <b>trovata nel feed di {tk}</b>, non «notizia su '
          f'{tk}»: i feed dei fornitori includono regolarmente pezzi sui concorrenti e sul comparto. '
          f'Non si filtra — filtrare vorrebbe dire indovinare di chi parla un titolo.</p>')
    w('</div></details>')
w('</section>')

# ── 8. NOTIZIE ───────────────────────────────────────────────────────────────────────────
w('<section id="notizie"><h2>Notizie</h2>')
tot_voci = sum(len((TIT[t].get("notizie") or {}).get("voci") or []) for t in TIT)
rec = []
for tk in TIT:
    for v in ((TIT[tk].get("notizie") or {}).get("voci") or []):
        if v.get("ore_fa") is not None and v["ore_fa"] <= 48: rec.append((tk, v))
rec.sort(key=lambda x: x[1]["ore_fa"])
w(f'<p class="sommario"><b>{tot_voci} voci</b> raccolte dai feed dei fornitori, una richiesta per '
  f'titolo, <b>{len(rec)} nelle ultime 48 ore</b>. L\'attribuzione viene dalla fonte, non da '
  f'un\'euristica nostra.</p>')
w('<div class="nota"><b>Perché questo blocco esiste, dato che chi legge può cercare online.</b> '
  'Una ricerca sul singolo titolo non conosce il libro. Una notizia su un altro nome del gruppo '
  'correlato riguarda anche la posizione in esame, e quel collegamento lo può fare solo chi ha il '
  'libro davanti. È l\'unica ragione per cui vale il suo costo.</div>')
w('<h3>Le ultime 48 ore, in ordine di freschezza</h3>')
w('<div class="scorre"><table><thead><tr><th>Feed</th><th>Ore fa</th><th class="testo">Titolo</th>'
  '<th class="testo">Fonte della voce</th></tr></thead><tbody>')
for tk, v in rec[:40]:
    peso = LIB["pesi"].get(tk)
    cls = ' class="spicca"' if peso and peso >= 15 else ""
    w(f'<tr{cls}><td><span class="tk">{tk}</span></td><td class="mono">{n(v["ore_fa"],0)}</td>'
      f'<td class="testo"><a href="{e(v["link"])}" target="_blank" rel="noopener">{e(v["titolo"])}</a></td>'
      f'<td class="testo piccolo">{e(v.get("fonte_voce") or "—")}</td></tr>')
w('</tbody></table></div>')
if len(rec) > 40:
    w(f'<p class="piccolo">Elencate le 40 più fresche delle {len(rec)}; le altre stanno dentro la '
      f'scheda del proprio titolo. Il taglio è dichiarato perché un conteggio senza gli elementi che '
      f'lo compongono è peggio del silenzio.</p>')
w('<h3>Il quadro dai canali generalisti</h3>')
w('<p>Raccolto stamattina via ricerca web su Bloomberg, CNBC, Investing, Schwab, Barchart, '
  'Polymarket, Kalshi e la stampa di settore. Sono <b>affermazioni della stampa</b>, non dati del '
  'sistema, e vanno verificate prima di poggiarci una decisione.</p>')
w('<ul>')
w('<li><b>Fed.</b> Il mercato prezza un <b>rialzo</b> di 25 punti base al FOMC del 16/09. Le fonti '
  'non concordano sulla probabilità: Polymarket ~52-53%, i futures ~32%, alcune cronache ~60%. '
  'UBS, BofA e Deutsche Bank hanno spostato le previsioni verso rialzi a settembre e dicembre.</li>')
w('<li><b>Il dato che decide.</b> Il CPI di agosto esce l\'<b>11/09</b>, cinque giorni prima della '
  'riunione. È l\'input su cui la divergenza fra le due fonti si chiuderà.</li>')
w('<li><b>Petrolio e geopolitica.</b> Prezzi in salita dopo scambi di colpi fra Stati Uniti e Iran '
  'nel fine settimana; le tariffe di ritorsione canadesi su ~20 miliardi di dollari di merci '
  'americane entrano in vigore oggi.</li>')
w('<li><b>Memoria.</b> BofA prevede ricavi DRAM <b>+51% a/a nel 2026</b> con prezzi medi +33%. '
  'Il divario domanda-offerta su HBM è stimato al 5,1%, il più alto dal 2011; i prezzi HBM sono '
  'su del 20-40% a/a. SK hynix guida con il 50-55% di quota, Micron sta espandendo.</li>')
w('<li><b>Semiconduttori.</b> Marvell ha alzato le previsioni di ricavo ma ha raffreddato '
  'l\'entusiasmo sull\'effetto a bilancio dell\'accordo AI con Google.</li>')
w('</ul>')
w('<p class="piccolo">Fonti: cnbc.com · schwab.com · barchart.com · polymarket.com · '
  'predictionnews.com · kucoin.com · investing.com · news.skhynix.com · eenewseurope.com</p>')
w('</section>')

# ── 9. CONFRONTO COL SISTEMA GITHUB ──────────────────────────────────────────────────────
w('<section id="confronto"><h2>Questo contro il sistema GitHub</h2>')
w('<p class="sommario">Il confronto che il CEO ha chiesto, riga per riga. La colonna «qui» descrive '
  'ciò che questo rapporto contiene <b>oggi</b>, non ciò che potrebbe contenere.</p>')
w('<div class="scorre"><table><thead><tr><th class="testo">Cosa</th><th class="testo">Sistema GitHub</th>'
  '<th class="testo">Qui</th><th class="testo">Chi vince, e perché</th></tr></thead><tbody>')
CONFRONTO = [
 ("Prezzi e barre", "Yahoo via pipeline; su IP di datacenter va spesso in 429 e il run si degrada",
  "1.255 barre giornaliere per titolo da stockanalysis, con chiusura rettificata; Nasdaq come riserva",
  "Qui. Due canali dichiarati e la rettificata, che è quella giusta per medie e rendimenti"),
 ("Storico dei titoli", "sparks sotto-campionate, 51 punti per un anno, senza date",
  "cinque anni di barre complete con le date",
  "Qui, e non è un dettaglio: senza date non esiste finestra comune con nessuna serie macro"),
 ("SMA 100 e 200", "presenti nella batteria tecnica dei soli titoli seguiti",
  "presenti per tutti, calcolate sulle barre vere",
  "Pari, ma qui valgono anche per un titolo nuovo"),
 ("Profondità macro", "percentili su 1-5 anni",
  "percentili su tutta la serie: CPI dal 1913, tasso Fed dal 1954, disoccupazione dal 1948",
  "Qui. Il VIX al 3° percentile dell'anno è al 27° di trentasei anni: due conclusioni diverse"),
 ("Rischio di libro", "matrice di covarianza dalla pipeline, aggiornata ogni ~30 minuti",
  "ricalcolata dalle mie serie: pesi identici, correlazione media 0,357 contro 0,35, "
  "2,2 scommesse effettive contro 2,3",
  "Pari nei numeri. Qui la finestra è dichiarata e SKHY è misurata invece di essere esclusa"),
 ("Fondamentali", "yfinance: P/E, EV/EBITDA, ROE, margini, e i trimestri da EDGAR",
  "bilanci depositati da Nasdaq: conto economico, stato patrimoniale, flussi di cassa e indici, "
  "quattro trimestri e quattro esercizi",
  "Qui per profondità, il sistema per i multipli già calcolati"),
 ("Target e giudizi analisti", "target medio e numero di analisti",
  "target medio, minimo, massimo, ripartizione compra/mantieni/vendi, giudizio medio",
  "Qui"),
 ("Storico utili e sorprese", "date da EDGAR e stime dell'emittente",
  "cinque trimestri di EPS effettivo contro atteso con la sorpresa, più quattro trimestri di "
  "previsioni con minimo, massimo e numero di stime",
  "Qui"),
 ("Notizie", "feed Nasdaq per titolo; su IP di CI Yahoo rispondeva 429 su 13 titoli su 13",
  "gli stessi feed, da un IP che risponde: 14 titoli su 14, più la ricerca web sui canali generalisti",
  "Qui, e per una ragione di rete, non di codice"),
 ("Canali macro→titolo", "beta e R² su una finestra, poi due, poi la coda (v401-v403)",
  "gli stessi tre sguardi, ricalcolati: pavimento del rumore dal campione, non una soglia fissa",
  "Pari. È la parte del sistema che ha retto meglio"),
 ("Grafici", "trenta e più riquadri, ragnatele, quadranti, barre — cinque forme respinte dal CEO",
  "nessuno: la lettura che un grafico darebbe è il percentile, e quello è un numero",
  "Qui, per decisione del CEO"),
 ("Aggiornamento", "ogni ~30 minuti da GitHub Actions, senza che nessuno lo chieda",
  "quando lo chiedi: ~90 secondi per rigenerare tutto",
  "Il sistema, sull'automatismo. Qui, sul fatto che il dato è di quando lo guardi"),
 ("Chi mantiene", "un anno di correzioni, 555 check, e i difetti che contano li ha trovati "
  "l'esecuzione del pacchetto, non i gate",
  "cinque script, ~800 righe, nessuna chiave, nessun workflow",
  "Qui, ed è la ragione della decisione del CEO"),
]
for a, b, cc, d in CONFRONTO:
    w(f'<tr><td class="testo"><b>{a}</b></td><td class="testo">{b}</td><td class="testo">{cc}</td>'
      f'<td class="testo">{d}</td></tr>')
w('</tbody></table></div>')
w('</section>')

# ── 10. COSA MANCA ───────────────────────────────────────────────────────────────────────
w('<section id="manca"><h2>Cosa manca, e perché</h2>')
w('<p class="sommario">«Il sistema non ha il dato» e «ce l\'ha e non te lo passa» si leggono uguali '
  'e sono cose diverse. Questo è l\'elenco della prima categoria.</p>')
w('<div class="scorre"><table><thead><tr><th class="testo">Cosa manca</th><th class="testo">Perché</th>'
  '<th class="testo">Si può avere?</th></tr></thead><tbody>')
MANCA = [
 ("Bilanci di TSM e SKHY", "sono emittenti esteri: depositano 20-F e 6-K, non 10-Q/10-K, e la fonte "
  "usata legge i secondi", "sì, leggendo EDGAR sui moduli esteri — non è fatto oggi"),
 ("Storia lunga dell'ADS SKHY", "l'ADS è quotata dal 13/07/2026: quaranta sedute è tutta la sua vita, "
  "non un buco della raccolta",
  "no, e il sostituto di Seoul è stato misurato e rifiutato: inverte la conclusione"),
 ("Percentile storico vero degli spread ICE BofA", "FRED ne ridistribuisce pubblicamente tre anni: "
  "è la licenza della fonte", "solo a pagamento"),
 ("Il cambio EUR/USD", "non è ancora raccolto, quindi la quota dell'azionario sul patrimonio non è "
  "calcolabile e il rapporto non la pubblica",
  "sì, una riga in più — è il prossimo passo"),
 ("Beta e opzioni", "il beta pubblicato dai fornitori usa finestre non dichiarate; le catene di "
  "opzioni non sono raccolte",
  "il beta sì, ed è già qui come beta vs QQQ con il suo R²; le opzioni no"),
 ("Dark pool, gamma positioning, flussi retail, volume profile, VWAP ancorato",
  "sono dati a pagamento o derivati da feed che questo progetto non ha",
  "no, e simularli sarebbe peggio che non averli"),
 ("Liquidità, altri conti, situazione fiscale del CEO", "il sistema non li conosce e non li ha mai "
  "conosciuti", "solo dal CEO. Finché mancano, <b>il divieto di dimensionare resta in piedi</b>"),
]
for a, b, cc in MANCA:
    w(f'<tr><td class="testo"><b>{a}</b></td><td class="testo">{b}</td><td class="testo">{cc}</td></tr>')
w('</tbody></table></div>')

w('<h3>Come è stato raccolto</h3>')
w('<div class="scorre"><table><thead><tr><th class="testo">Blocco</th><th class="testo">Fonte</th>'
  '<th>Letto</th></tr></thead><tbody>')
FONTI = [
 ("Barre giornaliere, 14 titoli + 5 benchmark", "stockanalysis.com (chiusura rettificata); "
  "api.nasdaq.com come riserva", gen.strftime("%d/%m/%Y %H:%M UTC")),
 ("21 serie macro", "FRED, CSV pubblico senza chiave", gen.strftime("%d/%m/%Y %H:%M UTC")),
 ("Bilanci, target, storico utili", "api.nasdaq.com", gen.strftime("%d/%m/%Y %H:%M UTC")),
 ("Notizie per titolo", "feed dei fornitori via Nasdaq", dt(Q.get("notizie_lette_il"))),
 ("Quadro dai canali generalisti", "ricerca web", gen.strftime("%d/%m/%Y")),
 ("Posizioni, quantità, PMC", "confermati dal CEO l'08/09/2026, in memoria/LIBRO.md", "08/09/2026"),
]
for a, b, cc in FONTI:
    w(f'<tr><td class="testo">{a}</td><td class="testo">{b}</td><td class="mono piccolo">{cc}</td></tr>')
w('</tbody></table></div>')
w('<div class="nota"><b>L\'user-agent va per fonte, e il verso è opposto fra le due.</b> Misurato: '
  'Nasdaq non risponde senza un user-agent da browser, FRED non risponde <b>con</b>. È la stessa '
  'trappola già scritta per FINRA e per il Wall Street Journal, qui con un sintomo diverso — FRED non '
  'rifiuta, <b>tace</b>: la connessione muore senza codice di stato, e un rifiuto muto si legge come '
  'un guasto di rete o come un limite di frequenza. È la diagnosi sbagliata che avevo dato prima di '
  'misurarlo.</div>')
w('<div class="nota forte"><b>Il divieto di dimensionare.</b> Questo rapporto porta direzione, '
  'priorità e livelli di prezzo. Non porta quantità: niente «quante quote», niente stop in euro, '
  'niente percentuali di portafoglio. Tre dati che deciderebbero qualunque quantità — liquidità '
  'complessiva, altri conti, situazione fiscale — non sono nel sistema, e senza di essi ogni numero '
  'sarebbe un consiglio travestito da calcolo.</div>')
w('</section>')

w('</main></div>')

# ── scrittura ────────────────────────────────────────────────────────────────────────────
dest = sys.argv[1] if len(sys.argv) > 1 else "/tmp/quadro.html"
open(dest, "w").write("\n".join(OUT))
print(f"scritto {dest} · {os.path.getsize(dest):,} byte · {len(OUT)} blocchi")
