# Da dove ripartire — handoff del 01/08/2026 (dopo v206)

> Leggi anche `CLAUDE.md`, che contiene le regole d'ingaggio e i difetti già vissuti.

## Come lavora davvero il CEO (accertato, non supposto)

- Guarda **investing.com più volte al giorno**: premarket, orario esteso, volumi, massimi/minimi.
  Quella è la sua dashboard vera, ed è migliore della nostra per il suo processo.
- Macro e notizie da **YouTube** (FX Evolution, Finvid, Bloomberg) — di cui si fida più dei nostri dati.
- **TradingView** quando ha tempo, con indicatori Pine.
- **Cambia posizione più volte al giorno oppure sta fermo per mesi.** Non c'è una cadenza:
  serve qualcosa di disponibile *quando decide*, non un report periodico.
- Ha guadagnato con questo metodo. Il sistema deve stargli **ai bordi**, non al centro.

## Stato del sistema (v206)

Tutti i gate verdi: **177 test JS** · red team 32 campagne · **pipeline 63 test** · coerenza 18
controlli su 15 classi · gate valuta · audit dati.

**Rimossi di recente e da NON reintrodurre senza misurare:**
- motore predittivo (verdetto, punteggi 0-100, classifica) — track record misurato: 7 segnali,
  −11% medio, −7,5pp vs Nasdaq, hit-rate 29%
- memoria storica e ciclo semiconduttori — mai girati con dati veri
- barra di stato e coda decisioni

## ✅ FATTO in v205 + v206: la rimodulazione grafica

**v205 — struttura del libro.** Barra laterale con le macro-sezioni, centro con i grafici. La
scheda **Struttura** è quella d'ingresso. Niente grafici di prezzo (li fanno meglio investing.com
e TradingView in tempo reale): ci sono i grafici che solo noi possiamo fare perché solo noi
conosciamo il libro — concentrazione peso-vs-rischio, deriva, allocazione, distanza dagli stop.

**v206 — macro, tabelle e restyling.**
- **Mappa di correlazione RIMOSSA** su tua richiesta, insieme a `corr_matrix` nella pipeline che
  esisteva solo per lei. La correlazione media e la coppia più legata restano nel payload e nelle
  colonne delle tabelle: non hai perso il dato, hai perso la matrice.
- **Macro in grafici.** Erano 34 riquadri identici (un numero + un termometro 0-100 ciascuno).
  Ora in cima: *Rotazione* (21 ETF, accesi i settori in cui hai i soldi — oggi Semiconduttori
  −12,9% a un mese col 75% del capitale sopra, mentre guida Energia +12,8% dove non sei),
  *Termometri di stress* (curva 10A-2A, credito HY, VIX, ognuno con le sue soglie disegnate),
  *Leva e stagionalità* (margin debt sul massimo storico, +49% in un anno). I 34 riquadri restano
  tutti sotto, in un blocco richiudibile.
- **Tabelle: meno numeri, più grafici.** Oggi, Guad. %, Target Δ e Drawdown hanno una barra di
  fondo su scala condivisa fra le righe; RS 1M e RS NDX una barra divergente dallo zero; Financial
  Health una barra 0-100. Le cifre restano tutte.
- **Restyling.** Cinque variabili CSS erano usate 27 volte e mai definite (quattro dichiarazioni
  cadevano in silenzio); `.btn-ghost` usata 28 volte e mai definita; NAV e P&L si leggevano a 15px
  contro i 21px di altri titoli. Sistemati, insieme a transizioni, focus visibile, scrollbar,
  `prefers-reduced-motion` e l'unificazione dei colori scritti a mano.

Il payload è rimasto **identico**: le viste leggono, non scrivono, e c'è un check che lo prova.

## Flusso d'uso previsto

Colpo d'occhio sulla struttura → copia il prompt → incolla in un LLM con accesso web la mattina o
all'apertura del cash → prosegue su TradingView.

## Le tre cose per cui il CEO usa Claude

1. **Struttura del libro** dopo un'operazione o quando serve
2. **Verifica** di ciò che sente su YouTube o legge su investing.com, prima di agire
3. **Script Pine**

## Da dove ripartire

- **Difetti trovati mappando e NON ancora sistemati** (nessuno è urgente, tutti reali):
  - `miniDualChart` disegna **per indice, non per data**: nel popup "Fed Funds vs S&P" si
    sovrappongono 60 punti *mensili* e 60 punti *giornalieri* sotto il titolo "ultimi 5 anni".
    Stesso problema in "Disaccoppiamento" e "Profitti reali". Sono grafici che oggi ingannano.
  - `macro.sp500_pe.history` ha **un solo punto**: il popup promette "storico 10 anni" e mostra
    "Storico non disponibile".
  - Il popup FedWatch mostra solo la colonna **Taglio** mentre i dati portano anche `hike_prob`
    (2% e 26%): è la classe C14 già corretta nel payload in v187, sopravvissuta nella UI.
  - `#market-direction` e `#tracking-error-box` **non esistono in index.html**: `renderMiniCards`
    produce contenuto valido che nessuno vede.
  - `macro.momentum`, `macro.froth`, `macro.breadth`, `macro.futures` finiscono nel prompt per
    l'LLM e **non sono mai mostrati** in dashboard.
- **Il gate dei test era spento fino a v205** (i check dopo il blocco `report` erano contati ma
  non facevano fallire la CI). Se aggiungi un gruppo di check in fondo a `test_app.mjs`, il
  blocco `report` deve restare l'ultima cosa del file.

## Osservazione utile emersa dalle sue schermate

Sulla pagina titolo di investing.com convivono, adiacenti e con la stessa autorità,
**"Analisi tecnica: VENDI ADESSO"** e **"Previsioni: COMPRA ADESSO — target +83%"**. Nessuna riga
dichiara che sono metodologie diverse. È la stessa classe di difetto che i nostri detector C1/C4
intercettano: due letture della stessa cosa presentate come una sola. Vale la pena ricordarglielo
quando cita quei riquadri.
