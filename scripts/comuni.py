# -*- coding: utf-8 -*-
"""LIBRERIA COMUNE della pipeline e degli strumenti d'analisi (v510).

Esiste per una ragione sola: tre domande che pipeline e strumenti si fanno ALLO STESSO MODO, e che
due copie farebbero divergere al primo ritocco (v161, v207 — la classe di rumore_yf.py, v387):
  · r2_rumore    — sotto quale R² un beta e' rumore (la pipeline per i canali dei titoli,
                   numeri_libro per i beta del libro: la v510 ha trovato TLT 0,53 con R² 0,01
                   pubblicato come un numero da una parte e «non misurabile» dall'altra);
  · testo_feed   — il titolo di una notizia come lo legge una persona (Nasdaq scrive le
                   virgolette due volte codificate, «&amp;quot;», e una decodifica sola lasciava
                   «&quot;» nel brief, nelle notizie e nei pacchetti);
  · art          — l'articolo davanti a un numero in italiano («dello 0,4%», «l'11%»).
Niente rete, niente pandas: si importa da qualunque parte senza costo.
"""
import html
import re


def r2_rumore(n):
    """L'R2 che il PURO CASO supera nel 5% dei campioni, a questa numerosita'.

    ⚠⚠ NASCE DA UNA SOGLIA CHE NON REGGEVA IL CAMBIO DI FINESTRA. Il sistema dichiarava
    "canale presente" sopra R2 0,05 — una CONVENZIONE, non una misura, e nel v240 questo
    progetto ha gia' pagato che ogni soglia disegnata e' un'AFFERMAZIONE. Con una finestra sola
    la convenzione era innocua perche' conservativa; con due finestre diventa falsa, e in
    direzioni opposte:
      · su 251 osservazioni il caso supera R2 0,015 nel 5% dei campioni → 0,05 e' PRUDENTE
      · su  60 osservazioni la stessa cifra e' 0,065 → 0,05 accenderebbe canali dal NULLA
    Cioe' la finestra corta, con la vecchia soglia, avrebbe fabbricato esattamente il segnale
    che deve rilevare. Qui la soglia si CALCOLA dal campione invece di essere scelta.

    R2 critico = t2 / (t2 + df), con df = n - 2 e t il quantile 97,5% di Student — cioe' il
    punto in cui una regressione semplice diventa significativa al 5% bilaterale.
    L'approssimazione di Cornish-Fisher su t e' esatta a ~1e-5 per df >= 30 (verificata contro
    i valori tabulati: df=58 → 2,00171 contro 2,00172; df=249 → 1,96954 contro 1,96959), e
    sotto df 30 NON si restituisce niente invece di restituire un numero peggiore del silenzio.
    v510 — spostata qui da update_data.py, che la importa: una funzione, due consumatori.
    """
    df = int(n) - 2
    if df < 30:
        return None
    z = 1.959964                      # quantile 97,5% della normale
    t = z + 2.37243 / df + 2.82264 / (df * df)
    t2 = t * t
    return t2 / (t2 + df)


def testo_feed(s):
    """Il testo di una voce di feed come lo legge una persona: entita' HTML decodificate FINCHE' ce
    ne sono (al massimo tre giri), tag tolti, spazi compressi.
    ⚠ v510 — Nasdaq scrive «Is &amp;quot;Off the Charts.&amp;quot;»: il parser XML (o un
    html.unescape) toglie un livello solo e lascia «&quot;» nel titolo. Il 24/10/2026 usciva
    cosi' nel brief, nelle notizie di numeri_libro e nei pacchetti della pagina."""
    t = "" if s is None else str(s)
    for _ in range(3):
        u = html.unescape(t)
        if u == t:
            break
        t = u
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", t)).strip()


def _elisione(testo):
    """'lo' davanti a zero, "l'" davanti a uno, otto, undici (e ottanta, ottocento, ottomila,
    undicimila), None altrove. Si legge dalla parte intera del numero com'e' scritto («1.436,1»,
    «0,4», «11»); un segno davanti («+5%») si legge «piu'» e non elide."""
    m = re.match(r"(\d[\d.]*)", str(testo))
    if not m:
        return None
    try:
        n = int(m.group(1).replace(".", ""))
    except ValueError:
        return None
    if n == 0:
        return "lo"
    if n in (1, 11) or str(n)[0] == "8" or 11000 <= n < 12000:
        return "l'"
    return None


def art(prep, testo):
    """L'articolo (o la preposizione articolata) giusto davanti a un numero: art("del", "0,4%") →
    «dello 0,4%», art("il", "11%") → «l'11%», art("del", "27,8%") → «del 27,8%».
    ⚠ v510 — «stima in discesa del 0,1%» e «ne ha restituito il 11%» uscivano dagli strumenti
    tredici volte in un'analisi sola."""
    e = _elisione(testo)
    forme = {"il": ("il ", "lo ", "l'"), "del": ("del ", "dello ", "dell'")}[prep]
    return (forme[1] if e == "lo" else forme[2] if e == "l'" else forme[0]) + str(testo)
