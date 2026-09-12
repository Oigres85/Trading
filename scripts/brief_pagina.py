#!/usr/bin/env python3
"""Rende il brief come PAGINA — una sola, aggiornata due volte al giorno (v451).

Legge il JSON prodotto da brief.py e scrive un file HTML.
    python3 scripts/brief.py --mattina --json /tmp/b.json
    python3 scripts/brief_pagina.py /tmp/b.json /tmp/brief.html

⚠ NON riassume e non aggiunge nulla: rende gli stessi numeri del testo. Due rese della stessa
grandezza divergono al primo ritocco (v161, v207, v421, v443), quindi tutto viene dal JSON.
"""
import json, sys, html
from datetime import datetime

def n2(x, d=2):
    if x is None: return "n.d."
    return f"{x:,.{d}f}".replace(",", "@").replace(".", ",").replace("@", ".")

def sg(x, d=2, s="%"):
    if x is None: return "n.d."
    return f"{'+' if x >= 0 else '−'}{n2(abs(x), d)}{s}"

def cls(x):
    if x is None: return "flat"
    return "up" if x > 0 else ("down" if x < 0 else "flat")

def e(s): return html.escape(str(s if s is not None else ""))


def riga_posizione(r):
    if r.get("errore"):
        return (f'<div class="pos pos-ko"><div class="tk">{e(r["tk"])}</div>'
                f'<div class="ko">NON LETTO — {e(r["errore"])}</div></div>')
    sup, res, px = r.get("supporto20"), r.get("resistenza20"), r.get("px")
    # Il righello: la banda delle ultime 20 sedute, col prezzo dove sta davvero.
    pos = None
    if sup and res and px and res > sup:
        pos = max(0.0, min(1.0, (px - sup) / (res - sup))) * 100
    tacche = ""
    for n, etichetta in ((20, "20"), (50, "50"), (200, "200")):
        m = r.get(f"sma{n}")
        if m and sup and res and res > sup and sup <= m <= res:
            p = (m - sup) / (res - sup) * 100
            tacche += f'<span class="tick" style="left:{p:.1f}%" title="media {n} sedute: {n2(m)}"></span>'
    righello = ""
    if pos is not None:
        righello = (f'<div class="rul" role="img" aria-label="prezzo {n2(px)} fra supporto '
                    f'{n2(sup)} e resistenza {n2(res)}">{tacche}'
                    f'<span class="mark" style="left:{pos:.1f}%"></span></div>'
                    f'<div class="rul-ends"><span>{n2(sup)}</span><span>{n2(res)}</span></div>')
    med = []
    for n in (20, 50, 200):
        v = r.get(f"d{n}_atr")
        if v is not None:
            med.append(f'<span class="chip {cls(v)}">SMA{n} {sg(v,1,"")}</span>')
    if not med:
        med.append('<span class="chip flat">storia corta: solo la 20</span>' if r.get("barre", 0) < 60 else "")
    extra = []
    if r.get("supp_atr") is not None:
        extra.append(f'supporto a {n2(r["supp_atr"],1)} ATR sotto')
    if r.get("res_atr") is not None:
        extra.append(f'resistenza a {n2(r["res_atr"],1)} ATR sopra')
    if r.get("dmax52_pct") is not None:
        extra.append(f'{sg(r["dmax52_pct"],1)} dal massimo 52s')
    return f'''<div class="pos">
  <div class="pos-head">
    <div class="tk">{e(r["tk"])}</div>
    <div class="px mono">{n2(px)}</div>
    <div class="var mono {cls(r.get("var_pct"))}">{sg(r.get("var_pct"))}</div>
    <div class="amp mono">ampiezza {n2(r.get("atr_pct"))}%</div>
  </div>
  {righello}
  <div class="chips">{"".join(med)}</div>
  <div class="note">{e(" · ".join(extra))}</div>
</div>'''


def genera(d):
    t = d["tecnica"]
    vivi = [r for r in t if not r.get("errore")]
    SOGLIA = 1.5
    mossi = [r for r in vivi if (r.get("var_atr") or 0) >= SOGLIA or (r.get("escursione_atr") or 0) >= SOGLIA]
    mossi.sort(key=lambda r: max(r.get("var_atr") or 0, r.get("escursione_atr") or 0), reverse=True)
    ordinati = sorted(vivi, key=lambda x: -(x.get("peso") or 0)) + [r for r in t if r.get("errore")]
    nw = d["news"]
    ora = datetime.fromisoformat(d["ora"])
    ora_utc = datetime.fromisoformat(d["ora_utc"])
    modo = "Mattina" if d["modo"] == "mattina" else "Pomeriggio"

    cal = d.get("trimestrali") or {"attesi": [], "giorni_non_letti": [], "finestra": 21}
    if cal["attesi"]:
        tr = ""
        for x in cal["attesi"]:
            q = {"time-pre-market": "prima della campana",
                 "time-after-hours": "dopo la campana"}.get(x["quando"], x["quando"] or "orario n.d.")
            eps = f' · consenso <span class="mono">{e(x["eps_atteso"])}</span>' if x.get("eps_atteso") else ""
            tr += (f'<li><span class="tk">{e(x["tk"])}</span>'
                   f'<span class="mono quando">{e(x["data"])} · fra {x["giorni"]}g</span>'
                   f'<span class="dett">{e(q)}{eps}</span></li>')
        blocco_trim = f'<ul class="trim">{tr}</ul>'
    else:
        blocco_trim = ('<p class="quiete">Nessuna trimestrale dichiarata dalla fonte nei prossimi '
                       f'{cal["finestra"]} giorni. Non è «nessuna trimestrale mai»: oltre quella '
                       'finestra il sistema non guarda.</p>')

    if mossi:
        allerta = ""
        for r in mossi:
            q = []
            if (r.get("var_atr") or 0) >= SOGLIA:
                q.append(f'chiusura {sg(r["var_pct"])} = <b>{n2(r["var_atr"],1)}×</b> la propria ampiezza')
            if (r.get("escursione_atr") or 0) >= SOGLIA:
                q.append(f'escursione {n2(r["escursione_pct"])}% = <b>{n2(r["escursione_atr"],1)}×</b>')
            allerta += (f'<li><span class="tk">{e(r["tk"])}</span>'
                        f'<span class="seduta">seduta del {e(r.get("seduta"))}</span>'
                        f'<span class="dett">{" · ".join(q)}</span></li>')
        blocco_allerta = f'<ul class="allerta">{allerta}</ul>'
    else:
        blocco_allerta = (f'<p class="quiete">Nessuno dei {len(vivi)} nomi si è mosso oltre '
                          f'1,5× la propria ampiezza. Qui il silenzio è l’esito normale.</p>')

    voci = ""
    for v in nw["per_titolo"][:30]:
        eta = (ora_utc - datetime.fromisoformat(v["quando"])).total_seconds() / 3600
        tks = "".join(f'<span class="t">{e(x)}</span>' for x in v["tks"])
        molti = (f'<span class="cronaca">in {v["in_feed"]} feed</span>' if v["in_feed"] >= 3 else "")
        voci += (f'<li><div class="meta">{tks}<span class="eta mono">{eta:.1f}h</span>{molti}</div>'
                 f'<a href="{e(v["link"])}" target="_blank" rel="noopener">{e(v["titolo"])}</a></li>')

    macro = ""
    for v in nw["macro"][:15]:
        eta = (ora_utc - datetime.fromisoformat(v["quando"])).total_seconds() / 3600
        macro += (f'<li><div class="meta"><span class="t src">{e(v["fonte"])}</span>'
                  f'<span class="eta mono">{eta:.1f}h</span></div>'
                  f'<a href="{e(v["link"])}" target="_blank" rel="noopener">{e(v["titolo"])}</a></li>')

    mf = d["macro_fred"]
    if mf["stato"] != "ok":
        serie = (f'<p class="mancante"><b>Serie macro assenti — {e(mf["stato"])}.</b> '
                 'Inflazione, curva 10A-2A, HY OAS, NFCI e Fed Funds non sono in questa lettura. '
                 'Non e\u0300 «nessun movimento»: e\u0300 il dato che manca.</p>')
    else:
        eta = mf.get("eta_ore")
        # L'eta del run si dichiara SEMPRE: se la pipeline si ferma, la macro si ferma con lei.
        if eta is None:
            cap = ('<p class="mancante">Le serie vengono dalla pipeline, che non dichiara quando '
                   'ha girato: la loro freschezza non &egrave; verificabile.</p>')
        elif eta > 24:
            cap = (f'<p class="mancante"><b>Pipeline ferma da {n2(eta,1)} ore.</b> '
                   'Queste serie non si aggiornano da allora: ogni riga porta comunque la '
                   'propria rilevazione, che &egrave; pi&ugrave; vecchia del run.</p>')
        else:
            cap = (f'<p class="note-fonti">Dalla pipeline, run di <b>{n2(eta,1)} ore</b> fa. '
                   'Ogni riga porta la <b>propria</b> rilevazione, che &egrave; un&rsquo;altra data.</p>')
        righe = ""
        for s in mf["serie"]:
            quando = (f'<td class="data mono">{e(s["data"])}</td>' if s.get("data")
                      else '<td class="data ko">non dichiarata</td>')
            prec = (f'<td class="mono num">{n2(s["prec"])}</td>'
                    if isinstance(s.get("prec"), (int, float)) else '<td class="num data">&mdash;</td>')
            nota = f'<div class="note">{e(s["nota"])}</div>' if s.get("nota") else ""
            righe += (f'<tr><td>{e(s["nome"])}{nota}</td>'
                      f'<td class="mono num"><b>{e(s["valore"])}</b></td>{prec}{quando}</tr>')
        serie = (cap + '<table class="fred"><thead><tr><th>serie</th><th class="num">valore</th>'
                 '<th class="num">prima</th><th>rilevazione</th></tr></thead>'
                 f'<tbody>{righe}</tbody></table>')

    fonti_ko = ""
    if nw["titoli_non_letti"]:
        fonti_ko += (f'<p class="mancante"><b>Feed NON letti</b> (diverso da «nessuna notizia»): '
                     f'{e(", ".join(nw["titoli_non_letti"]))}</p>')
    if nw["macro_non_lette"]:
        fonti_ko += f'<p class="mancante"><b>Fonti macro NON lette:</b> {e(", ".join(nw["macro_non_lette"]))}</p>'

    return TEMPLATE.format(
        modo=modo, data=ora.strftime("%d/%m/%Y"), oraora=ora.strftime("%H:%M"),
        seduta=e(d["seduta_base"]), finestra=n2(d["finestra_h"], 0),
        nmossi=len(mossi), nvivi=len(vivi),
        allerta=blocco_allerta, trimestrali=blocco_trim, fintrim=cal["finestra"],
        posizioni="".join(riga_posizione(r) for r in ordinati),
        nvoci=len(nw["per_titolo"]), voci=voci or '<li class="quiete">Nessuna voce in finestra.</li>',
        muti=(f'<p class="note-fonti">Letti e senza voci in finestra: {e(", ".join(nw["titoli_muti"]))}.</p>'
              if nw["titoli_muti"] else ""),
        nmacro=len(nw["macro"]), macro=macro or '<li class="quiete">Nessuna voce in finestra.</li>',
        scartate=(f'{nw.get("macro_scartate",0)} voci generaliste scartate da un filtro <b>a parole</b>, '
                  f'fallibile nei due versi. CNBC Economia entra per intero, senza filtro.'
                  if nw.get("macro_scartate") else ""),
        serie=serie, fonti_ko=fonti_ko, secondi=n2(d["secondi"], 1))


TEMPLATE = """<title>Brief del libro</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root {{
  --ground:#F5F7F6; --surface:#FFFFFF; --raise:#FBFCFB;
  --ink:#16202A; --muted:#5E6E76; --faint:#8B989E;
  --line:#DDE4E2; --line-soft:#EBF0EE;
  --accent:#8A6A2F; --accent-soft:#F0E6D2;
  --up:#1C7A5B; --down:#A8362B; --warn:#94660F; --warn-bg:#FBF2DE;
  --sans:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  --cond:"IBM Plex Sans Condensed",var(--sans);
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}}
@media (prefers-color-scheme:dark) {{
  :root:not([data-theme="light"]) {{
    --ground:#0E1418; --surface:#151D22; --raise:#1A242A;
    --ink:#E3EAE8; --muted:#8B9BA2; --faint:#6C7C84;
    --line:#232F37; --line-soft:#1C262C;
    --accent:#C9A25E; --accent-soft:#2A2418;
    --up:#45B98E; --down:#E07463; --warn:#D6A43D; --warn-bg:#2A2313;
  }}
}}
:root[data-theme="dark"] {{
  --ground:#0E1418; --surface:#151D22; --raise:#1A242A;
  --ink:#E3EAE8; --muted:#8B9BA2; --faint:#6C7C84;
  --line:#232F37; --line-soft:#1C262C;
  --accent:#C9A25E; --accent-soft:#2A2418;
  --up:#45B98E; --down:#E07463; --warn:#D6A43D; --warn-bg:#2A2313;
}}
* {{ box-sizing:border-box; }}
body {{ background:var(--ground); color:var(--ink); font-family:var(--sans);
  font-size:15px; line-height:1.5; margin:0; padding:0; }}
.wrap {{ max-width:940px; margin:0 auto; padding-inline:18px; padding-block:26px 60px; }}
.mono {{ font-family:var(--mono); font-variant-numeric:tabular-nums; }}
.up {{ color:var(--up); }} .down {{ color:var(--down); }} .flat {{ color:var(--muted); }}

header {{ border-bottom:2px solid var(--ink); padding-bottom:14px; margin-bottom:26px; }}
.eyebrow {{ font-family:var(--cond); font-weight:700; font-size:11px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--accent); margin:0 0 4px; }}
h1 {{ font-family:var(--cond); font-weight:700; font-size:clamp(27px,6vw,38px); line-height:1.05;
  margin:0 0 10px; text-wrap:balance; letter-spacing:-.01em; }}
.stato {{ display:flex; flex-wrap:wrap; gap:6px 18px; font-size:13px; color:var(--muted); }}
.stato b {{ color:var(--ink); font-weight:600; }}

section {{ margin-top:34px; }}
h2 {{ font-family:var(--cond); font-weight:700; font-size:13px; letter-spacing:.11em;
  text-transform:uppercase; color:var(--muted); margin:0 0 4px;
  padding-bottom:7px; border-bottom:1px solid var(--line); }}
.sub {{ font-size:13px; color:var(--faint); margin:9px 0 14px; max-width:62ch; }}

.allerta {{ list-style:none; margin:14px 0 0; padding:0; display:flex; flex-direction:column; gap:1px; }}
.allerta li {{ background:var(--warn-bg); border-left:3px solid var(--warn); padding:11px 14px;
  display:flex; flex-wrap:wrap; align-items:baseline; gap:5px 12px; }}
.allerta .tk {{ font-family:var(--cond); font-weight:700; font-size:17px; letter-spacing:.02em; }}
.allerta .seduta {{ font-family:var(--mono); font-size:11px; color:var(--muted); }}
.allerta .dett {{ font-size:13.5px; flex:1 1 100%; }}
.allerta b {{ font-family:var(--mono); font-weight:600; }}
.trim {{ list-style:none; margin:14px 0 0; padding:0; display:flex; flex-direction:column; gap:1px; }}
.trim li {{ background:var(--surface); border-left:3px solid var(--accent); padding:11px 14px;
  display:flex; flex-wrap:wrap; align-items:baseline; gap:5px 12px; }}
.trim .tk {{ font-family:var(--cond); font-weight:700; font-size:17px; letter-spacing:.02em; }}
.trim .quando {{ font-size:12px; color:var(--accent); }}
.trim .dett {{ font-size:13px; color:var(--muted); }}
.quiete {{ color:var(--muted); font-size:14px; background:var(--raise);
  border:1px solid var(--line-soft); padding:13px 15px; margin:14px 0 0; }}

.posizioni {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(285px,1fr)); gap:1px;
  background:var(--line-soft); border:1px solid var(--line-soft); }}
.pos {{ background:var(--surface); padding:13px 15px 15px; min-width:0; }}
.pos-head {{ display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; }}
.pos .tk {{ font-family:var(--cond); font-weight:700; font-size:17px; letter-spacing:.02em; }}
.pos .px {{ font-size:15px; font-weight:500; }}
.pos .var {{ font-size:13px; font-weight:500; }}
.pos .amp {{ font-size:11px; color:var(--faint); margin-left:auto; }}
.rul {{ position:relative; height:5px; background:var(--line); margin:13px 0 4px; }}
.rul .mark {{ position:absolute; top:-3px; width:3px; height:11px; background:var(--ink);
  transform:translateX(-1.5px); }}
.rul .tick {{ position:absolute; top:0; width:1px; height:5px; background:var(--accent); opacity:.75; }}
.rul-ends {{ display:flex; justify-content:space-between; font-family:var(--mono);
  font-size:10.5px; color:var(--faint); }}
.chips {{ display:flex; flex-wrap:wrap; gap:5px; margin-top:9px; }}
.chip {{ font-family:var(--mono); font-size:10.5px; padding:2px 6px; border:1px solid var(--line);
  background:var(--raise); }}
.note {{ font-size:11.5px; color:var(--faint); margin-top:8px; line-height:1.45; }}
.pos-ko {{ display:flex; gap:10px; align-items:baseline; }}
.ko {{ color:var(--down); font-size:12.5px; }}

.voci {{ list-style:none; margin:0; padding:0; }}
.voci li {{ padding:11px 0; border-bottom:1px solid var(--line-soft); }}
.voci .meta {{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:3px; }}
.voci .t {{ font-family:var(--mono); font-size:10.5px; font-weight:500; letter-spacing:.03em;
  color:var(--accent); border:1px solid var(--accent); padding:1px 5px; }}
.voci .t.src {{ color:var(--muted); border-color:var(--line); }}
.voci .eta {{ font-size:10.5px; color:var(--faint); }}
.cronaca {{ font-size:10.5px; color:var(--muted); background:var(--raise);
  border:1px solid var(--line); padding:1px 6px; }}
.voci a {{ color:var(--ink); text-decoration:none; font-size:14.5px; line-height:1.4;
  border-bottom:1px solid transparent; }}
.voci a:hover {{ border-bottom-color:var(--accent); }}
.voci a:focus-visible {{ outline:2px solid var(--accent); outline-offset:2px; }}
.note-fonti {{ font-size:12px; color:var(--faint); margin-top:12px; }}
.mancante {{ font-size:13px; color:var(--ink); background:var(--warn-bg);
  border-left:3px solid var(--warn); padding:11px 14px; margin:14px 0 0; }}

.fred {{ width:100%; border-collapse:collapse; margin-top:14px; font-size:13.5px; }}
.fred th {{ font-family:var(--cond); font-weight:600; font-size:11px; letter-spacing:.08em;
  text-transform:uppercase; color:var(--faint); text-align:left; padding:0 10px 7px 0;
  border-bottom:1px solid var(--line); }}
.fred td {{ padding:7px 10px 7px 0; border-bottom:1px solid var(--line-soft); }}
.fred .num, .fred th.num {{ text-align:right; }}
.fred .data {{ font-size:11.5px; color:var(--faint); }}

footer {{ margin-top:44px; padding-top:16px; border-top:1px solid var(--line);
  font-size:12px; color:var(--faint); line-height:1.6; }}
footer b {{ color:var(--muted); font-weight:600; }}
@media (max-width:560px) {{
  .posizioni {{ grid-template-columns:1fr; }}
  .pos .amp {{ margin-left:0; }}
}}
@media (prefers-reduced-motion:reduce) {{ * {{ transition:none !important; animation:none !important; }} }}
</style>

<div class="wrap">
<header>
  <p class="eyebrow">Lettura {modo}</p>
  <h1>Brief del libro</h1>
  <div class="stato">
    <span>{data} · <b>{oraora}</b> CEST</span>
    <span>ultima barra <b>{seduta}</b></span>
    <span>finestra notizie <b>{finestra}h</b></span>
    <span>{nmossi} su {nvivi} oltre soglia</span>
  </div>
</header>

<section>
  <h2>Oltre la propria ampiezza</h2>
  <p class="sub">Soglia 1,5× l’ATR <b>del singolo titolo</b>, non una percentuale uguale per tutti:
  a parità di percentuale si segnalerebbe il nome sbagliato. Si guarda la chiusura
  <em>e</em> l’escursione minimo-massimo, perché la sola chiusura è cieca alla seduta
  in cui il prezzo va lontano e torna.</p>
  {allerta}
</section>

<section>
  <h2>Trimestrali in arrivo — prossimi {fintrim} giorni</h2>
  <p class="sub">Date dichiarate dalla fonte, non proiettate da noi. Una trimestrale a ridosso
  cambia il senso di uno stop già piazzato: non è una protezione, è un biglietto della lotteria.</p>
  {trimestrali}
</section>

<section>
  <h2>Dove sta ogni posizione</h2>
  <p class="sub">Il righello va dal minimo al massimo delle ultime 20 sedute; il tratto scuro è
  il prezzo, i segni in ottone sono le medie a 20, 50 e 200 quando cadono dentro la banda.
  Livelli misurati: la decisione resta sul tuo grafico.</p>
  <div class="posizioni">{posizioni}</div>
</section>

<section>
  <h2>Notizie sui tuoi nomi — {nvoci} voci</h2>
  <p class="sub">L’etichetta dice <b>in quale feed</b> la voce è stata trovata, non di chi parla
  l’articolo: i feed dei fornitori includono regolarmente pezzi su concorrenti e sul comparto.
  Una voce che compare in tre o più feed è quasi sempre cronaca di mercato.</p>
  <ul class="voci">{voci}</ul>
  {muti}
  {fonti_ko}
</section>

<section>
  <h2>Macro — {nmacro} voci</h2>
  <p class="sub">Solo i canali che toccano questo libro: tassi e Fed, credito, semiconduttori
  ed export, cambio euro-dollaro.</p>
  <ul class="voci">{macro}</ul>
  <p class="note-fonti">{scartate}</p>
  {serie}
</section>

<footer>
  <p><b>Prezzi</b> stockanalysis.com, barre giornaliere. <b>Notizie</b> Nasdaq per simbolo,
  CNBC Economia, Bloomberg, MarketWatch. <b>Posizioni</b> memoria/LIBRO.md, non dalla pipeline:
  se la pipeline si ferma, questa lettura continua a dire la verità sul libro.
  Generata in {secondi}s.</p>
  <p>Il sistema <b>non conosce</b>: altri conti, altri strumenti, posizioni corte, coperture,
  situazione fiscale. Direzione e livelli sì, quantità no.</p>
</footer>
</div>"""


if __name__ == "__main__":
    dati = json.load(open(sys.argv[1], encoding="utf-8"))
    out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/brief.html"
    open(out, "w", encoding="utf-8").write(genera(dati))
    print(f"scritto {out} ({len(open(out).read()):,} caratteri)")
