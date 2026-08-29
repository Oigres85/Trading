# -*- coding: utf-8 -*-
"""GRAFICI DEL LIBRO — una pagina HTML autonoma, da pubblicare come artefatto.

⚠ Nessuna libreria di disegno e nessuna risorsa esterna: SVG scritto a mano, tutto dentro il
   file. Un grafico che dipende da una CDN non si vede dove serve.
⚠ Ogni grafico porta la propria data e la propria unita'. Un grafico senza data e' un'opinione.

uso:  python3 scripts/grafici.py            → scrive /tmp/grafici_libro.html
      python3 scripts/grafici.py PERCORSO   → lo scrive dove dici
"""
import json, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
W, BAR = 760, 26


def esc(x):
    return str(x).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def barre_doppie(dati, t1, t2, titolo, nota):
    """Due barre per riga: serve a far vedere QUANDO DIVERGONO, che e' l'informazione."""
    h = len(dati) * (BAR + 8) + 54
    mx = max(max(a, b) for _, a, b in dati) or 1
    s = [f'<h3>{esc(titolo)}</h3><p class="n">{esc(nota)}</p>',
         f'<svg viewBox="0 0 {W} {h}" role="img">']
    s.append(f'<rect x="120" y="8" width="10" height="10" fill="var(--a)"/>'
             f'<text x="136" y="17" class="lg">{esc(t1)}</text>'
             f'<rect x="240" y="8" width="10" height="10" fill="var(--b)"/>'
             f'<text x="256" y="17" class="lg">{esc(t2)}</text>')
    for i, (nome, a, b) in enumerate(dati):
        y = 34 + i * (BAR + 8)
        la, lb = a / mx * (W - 260), b / mx * (W - 260)
        s.append(f'<text x="0" y="{y + 13}" class="tk">{esc(nome)}</text>')
        s.append(f'<rect x="70" y="{y}" width="{la:.1f}" height="10" fill="var(--a)" rx="2"/>')
        s.append(f'<rect x="70" y="{y + 12}" width="{lb:.1f}" height="10" fill="var(--b)" rx="2"/>')
        d = b - a
        col = "var(--w)" if d > 3 else "var(--m)"
        s.append(f'<text x="{70 + max(la, lb) + 8}" y="{y + 15}" class="v" fill="{col}">'
                 f'{a:.1f}% / {b:.1f}%{f"  ({d:+.1f})" if abs(d) >= 1 else ""}</text>')
    s.append("</svg>")
    return "".join(s)


def barre(dati, titolo, nota, neg=False):
    h = len(dati) * (BAR - 4) + 30
    mx = max(abs(v) for _, v in dati) or 1
    s = [f'<h3>{esc(titolo)}</h3><p class="n">{esc(nota)}</p>',
         f'<svg viewBox="0 0 {W} {h}" role="img">']
    for i, (nome, v) in enumerate(dati):
        y = 6 + i * (BAR - 4)
        l = abs(v) / mx * (W - 240)
        col = "var(--w)" if (neg and v < -20) else "var(--a)"
        s.append(f'<text x="0" y="{y + 11}" class="tk">{esc(nome)}</text>')
        s.append(f'<rect x="70" y="{y + 2}" width="{l:.1f}" height="11" fill="{col}" rx="2"/>')
        s.append(f'<text x="{70 + l + 8}" y="{y + 12}" class="v">{v:+.1f}%</text>')
    s.append("</svg>")
    return "".join(s)


def mappa(tk, corr):
    n = len(tk)
    c = min(30, int((W - 90) / n))
    h = n * c + 92
    s = ['<h3>Chi si muove con chi</h3>'
         '<p class="n">Correlazione dei rendimenti giornalieri. Piu\' scuro = piu\' insieme. '
         'Un libro di scommesse indipendenti sarebbe quasi tutto chiaro.</p>',
         f'<svg viewBox="0 0 {W} {h}" role="img">']
    for i, a in enumerate(tk):
        s.append(f'<text x="0" y="{78 + i * c + c * 0.7:.0f}" class="tk">{esc(a)}</text>')
        s.append(f'<text x="{74 + i * c + c / 2:.0f}" y="70" class="tk" '
                 f'transform="rotate(-60 {74 + i * c + c / 2:.0f} 70)">{esc(a)}</text>')
        for j, b in enumerate(tk):
            v = float(corr.get(a, {}).get(b, 0) or 0)
            op = max(0.0, min(1.0, (v - .1) / .8))
            s.append(f'<rect x="{74 + j * c}" y="{74 + i * c}" width="{c - 1}" height="{c - 1}" '
                     f'fill="var(--a)" opacity="{op:.2f}"/>')
    s.append("</svg>")
    return "".join(s)


def main():
    import analisi_libro as A
    try:
        a = A.analizza()
        vivo = True
    except (Exception, SystemExit):
        a, vivo = A.da_pubblicato(), False
    m, q = a["m"], a.get("quota_az")
    ordine = sorted(a["pesi"], key=lambda t: -m["contrib"][t])

    pezzi = [barre_doppie([(t, a["pesi"][t] * 100, m["contrib"][t] * 100) for t in ordine],
                          "peso nel libro", "quota del rischio",
                          "Dove sta il capitale, e dove sta il rischio",
                          "Dove le due barre divergono, la posizione porta piu' (o meno) varianza "
                          "di quanto il suo peso suggerisca. E' l'effetto delle correlazioni.")]
    pezzi.append(barre([(t, m["vol_nome"][t] * 100) for t in ordine],
                       "Quanto oscilla ciascun nome",
                       "Volatilita' annualizzata sulla finestra misurata."))
    pezzi.append(mappa(ordine, m["corr"]))

    riga = (f"{m['eff']:.2f} scommesse effettive su {len(ordine)} nomi"
            + (f" · {m['eff_giu']:.2f} nelle sedute peggiori" if m.get("eff_giu") else ""))
    testa = (f"seduta {a['al']} · {a['sedute']} sedute"
             + (f" · azionario {q*100:.0f}% del patrimonio" if q else "")
             + ("" if vivo else " · ⚠ valori pubblicati, non ricalcolati"))
    avvisi = []
    if a.get("esclusi"):
        avvisi.append("fuori dalla matrice: " + ", ".join(
            f"{t} ({a.get('perche_esclusi', {}).get(t, '?')})" for t in a["esclusi"]))
    g = a.get("posizioni_giorni")
    if g is not None and g > 7:
        avvisi.append(f"posizioni di {g} giorni fa: se hai operato dopo, i pesi non sono questi")

    html = f"""<title>Il libro in tre grafici</title>
<style>
 :root {{ --bg:#fff; --fg:#111; --m:#666; --a:#2563eb; --b:#f59e0b; --w:#dc2626; --li:#e5e7eb; }}
 @media (prefers-color-scheme: dark) {{ :root:not([data-theme=light]) {{
   --bg:#0f1115; --fg:#e8eaed; --m:#9aa0a6; --a:#60a5fa; --b:#fbbf24; --w:#f87171; --li:#2a2f3a; }} }}
 :root[data-theme=dark] {{ --bg:#0f1115; --fg:#e8eaed; --m:#9aa0a6; --a:#60a5fa; --b:#fbbf24; --w:#f87171; --li:#2a2f3a; }}
 body {{ background:var(--bg); color:var(--fg); font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        margin:0; padding:22px; max-width:840px; }}
 h1 {{ font-size:21px; margin:0 0 4px; }} h3 {{ font-size:16px; margin:26px 0 2px; }}
 p.n {{ color:var(--m); margin:0 0 10px; font-size:13.5px; }}
 .capo {{ color:var(--m); font-size:13px; border-bottom:1px solid var(--li); padding-bottom:12px; }}
 .av {{ color:var(--w); font-size:13px; margin-top:6px; }}
 svg {{ width:100%; height:auto; overflow:visible; }}
 text {{ fill:var(--fg); font:12px -apple-system,sans-serif; }}
 .tk {{ font-weight:600; font-size:11.5px; }} .v {{ fill:var(--m); font-size:11px; }}
 .lg {{ fill:var(--m); font-size:11.5px; }}
 .key {{ margin:16px 0 0; padding:12px 14px; background:color-mix(in srgb, var(--a) 8%, transparent);
         border-left:3px solid var(--a); border-radius:0 6px 6px 0; }}
</style>
<h1>Il libro in tre grafici</h1>
<div class="capo">{esc(testa)}{''.join(f'<div class="av">⚠ {esc(x)}</div>' for x in avvisi)}</div>
<div class="key"><b>{esc(riga)}</b><br><span style="color:var(--m)">Quante decisioni indipendenti
ci sono davvero dentro {len(ordine)} posizioni: se si muovono insieme, il rischio del singolo
nome non e' il rischio del libro.</span></div>
{''.join(pezzi)}
<p class="n" style="margin-top:26px">Misure su una finestra passata, non previsioni.
Generato {datetime.now(timezone.utc).astimezone().strftime('%d/%m/%Y %H:%M')}.</p>"""
    dove = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/grafici_libro.html")
    dove.write_text(html, encoding="utf-8")
    print(f"scritto {dove} ({len(html):,} byte)")


if __name__ == "__main__":
    main()
