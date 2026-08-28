# -*- coding: utf-8 -*-
"""IL PACCHETTO DEL VERDETTO — una pagina, non diciassettemila token.

Il vecchio pacchetto titolo pesava ~17.000 token perche' doveva insegnare a un modello cieco
tutto quello che non poteva vedere: com'e' calcolato ogni numero, cosa non e', quale errore il
sistema ha gia' fatto su quella riga. Se l'ANALISI e' gia' stata fatta e verificata a monte,
quel lavoro non serve piu': al modello resta UNA domanda, quella che io non rispondo.

Qui dentro va solo cio' che serve a rispondere a quella domanda:
 · i fatti gia' verificati (con la loro fonte e data)
 · le misure sul libro, gia' calcolate
 · la domanda, posta in modo che la risposta sia utilizzabile

uso:  python3 scripts/analisi_libro.py --json > /tmp/libro.json
      python3 scripts/pacchetto_verdetto.py MRVL /tmp/libro.json analisi.md
"""
import json, sys
from datetime import datetime, timezone
from pathlib import Path

TESTATA = """Sei un gestore senior con mandato growth su un fondo privato. Ricevi un'analisi GIA'
FATTA e GIA' VERIFICATA su un titolo che l'investitore ha in portafoglio, piu' le misure di
rischio del suo libro. NON devi rifare l'analisi e non devi cercare online: i numeri qui sono
verificati alla fonte e datati, e rifarli introdurrebbe solo divergenze.

Ti viene chiesta UNA cosa: il giudizio operativo che l'analisi si ferma prima di dare.

REGOLE
· Rispondi in italiano, in prosa densa, meno di 400 parole. Niente riassunti di cio' che leggi.
· Distingui TRE ORIZZONTI — settimane, 3-12 mesi, oltre l'anno — e per ciascuno di': tenere,
  alleggerire o aggiungere, e a quale LIVELLO DI PREZZO o QUALE FATTO la risposta cambia.
· MAI dimensionare: niente quote, niente percentuali di portafoglio, niente stop in euro.
  Chi legge conosce la propria liquidita' e la propria situazione fiscale, tu no.
· Chiudi con la TESI CONTRARIA in tre righe e con IL FATTO OSSERVABILE E DATATO che separerebbe
  le due letture. Non e' ammesso rispondere che entrambe hanno merito: se le prove non bastano,
  il giudizio e' "non abbastanza per agire", che e' una scelta.
· Se un numero che ti serve non c'e', dillo: "manca X" e' un'informazione, un numero inventato no.
"""


def blocco_libro(a, tk):
    m = a["m"]
    q = a.get("quota_az")
    L = [f"MISURE DEL LIBRO (calcolate al {a['al']} su {a['sedute']} sedute, prezzi del giorno)"]
    if q:
        art = "l'" if str(round(q * 100)).startswith(("8", "11")) else "il "
        L.append(f"· l'azionario e' {art}{q*100:.1f}% del patrimonio: ogni misura qui sotto, "
                 f"riportata al patrimonio intero, va moltiplicata per {q:.2f}")
    if a.get("esclusi"):
        L.append("· ESCLUSI dalla matrice per storia corta (meno di 60 sedute): "
                 + ", ".join(f"{t} ({p*100:.1f}% dell'azionario)" for t, p in a["esclusi"].items())
                 + " — il loro peso NON e' dentro questi numeri")
    L.append(f"· volatilita' annua {m['vol']*100:.1f}% · drawdown massimo {m['dd_max']*100:.1f}% "
             f"· oggi {m['dd_oggi']*100:.1f}% sotto il massimo")
    L.append(f"· scommesse effettive {m['eff']:.2f} su {len(a['pesi'])} nomi "
             f"(correlazione media {m['rho']:.2f}): quante decisioni indipendenti ci sono davvero")
    if m.get("eff_giu"):
        L.append(f"· nelle {m['sedute_giu']} sedute peggiori del Nasdaq diventano {m['eff_giu']:.2f} "
                 f"(correlazione {m['rho_giu']:.2f})")
    ordinati = sorted(a["pesi"], key=lambda x: -m["contrib"][x])[:5]
    L.append("· contributo al rischio (peso → quota della varianza), primi cinque: "
             + " · ".join(f"{t} {a['pesi'][t]*100:.1f}%→{m['contrib'][t]*100:.1f}%" for t in ordinati))
    if tk in a["pesi"]:
        vic = sorted(((u, c) for u, c in m["corr"][tk].items() if u != tk),
                     key=lambda x: -x[1])[:3]
        pmc = (a.get("carico") or {}).get(tk)
        px = a["prezzi"][tk]
        L.append(f"· {tk}: peso {a['pesi'][tk]*100:.1f}% → varianza {m['contrib'][tk]*100:.1f}%"
                 f" · volatilita' {m['vol_nome'][tk]*100:.0f}%"
                 + (f" · prezzo {px:.2f} contro carico {pmc} ({(px/pmc-1)*100:+.1f}%)" if pmc else "")
                 + " · piu' correlati nel libro: "
                 + ", ".join(f"{u} {c:.2f}" for u, c in vic))
    return "\n".join(L)


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    tk = sys.argv[1].upper()
    a = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    analisi = Path(sys.argv[3]).read_text(encoding="utf-8").strip()
    oggi = datetime.now(timezone.utc).astimezone().strftime("%d/%m/%Y %H:%M")
    print(f"RICHIESTA DI GIUDIZIO SU {tk} — {oggi}\n")
    print(TESTATA)
    print("─" * 70)
    print(f"\nL'ANALISI GIA' FATTA E VERIFICATA\n\n{analisi}\n")
    print("─" * 70 + "\n")
    print(blocco_libro(a, tk))
    print("\n" + "─" * 70)
    print(f"\nLA DOMANDA: su {tk}, che l'investitore ha gia' in portafoglio, qual e' il giudizio "
          f"operativo sui tre orizzonti, e a quale livello di prezzo o quale fatto lo cambia?")


if __name__ == "__main__":
    main()
