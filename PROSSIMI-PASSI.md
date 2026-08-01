# Da dove ripartire — handoff del 01/08/2026 (dopo v207)

> Leggi anche `CLAUDE.md`, che contiene le regole d'ingaggio e i difetti già vissuti.

## Come lavora davvero il CEO (accertato, non supposto)

- Guarda **investing.com più volte al giorno**: premarket, orario esteso, volumi, massimi/minimi.
  Quella è la sua dashboard vera, ed è migliore della nostra per il suo processo.
- Macro e notizie da **YouTube** (FX Evolution, Finvid, Bloomberg) — di cui si fida più dei nostri dati.
- **TradingView** quando ha tempo, con indicatori Pine.
- **Cambia posizione più volte al giorno oppure sta fermo per mesi.** Non c'è una cadenza:
  serve qualcosa di disponibile *quando decide*, non un report periodico.
- Ha guadagnato con questo metodo. Il sistema deve stargli **ai bordi**, non al centro.

## Stato del sistema (v207)

Tutti i gate verdi: **177 test JS** · red team 32 campagne · **pipeline 67 test** · coerenza 18
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

## ✅ FATTO in v207: i cinque difetti mappati

- **I grafici doppi confrontavano serie senza un giorno in comune.** L'ascissa era l'indice del
  punto, non il tempo: "Fed Funds vs S&P — ultimi 5 anni" sovrapponeva 5 anni di tassi a 3 mesi
  di borsa; "Disaccoppiamento" e "Profitti reali" mettevano insieme serie con **zero** giorni
  condivisi. La causa stava nella pipeline (`freq="m"` dimenticato: FRED restituiva giorni al
  posto di mesi) e il numero sbagliato **finiva nel prompt** — "disaccoppiamento −3 pp" era
  +3,1% di S&P su 7 settimane meno +6,3% di PIL su 3 anni. Ora la pipeline chiede la frequenza
  giusta, il confronto si fa solo sulla finestra comune, e quando non c'è il payload lo dichiara
  invece di pubblicare un numero senza significato.
- **FedWatch nel popup mostrava solo "Taglio".** I dati portavano un rialzo al 2% e al 26% e la
  dashboard taceva: era il difetto già corretto nel payload in v187, mai arrivato alla UI. Ora la
  derivazione dei tre rami è una sola funzione, usata da entrambi.
- **Due riquadri erano calcolati e mai mostrati**: "Direzione mercato" e "Tracking Error vs S&P"
  non avevano un contenitore in pagina. Aggiunti.
- **Quattro segnali finivano solo nel prompt** (ampiezza, momentum, schiuma sugli ETF a leva,
  futures): li leggevi nel report dell'AI senza poterli vedere. Ora sono una card.
- **Il popup P/E prometteva "storico 10 anni"** con una sola rilevazione. Ora dice quante ne ha.

## Da dove ripartire

- **Il disaccoppiamento tornerà calcolabile al primo run del CI** con la pipeline v207: fino ad
  allora il payload dichiara "NON CALCOLABILE in questo snapshot" ed è corretto così. Se dopo un
  run la riga resta, vuol dire che FRED non risponde alla richiesta mensile e va guardato.
- **`macro.sp500_pe.history` ha un solo punto** perché multpl è bloccato dagli IP del CI (stesso
  problema noto di WSJ). Finché resta così, media a 10 anni e percentile storico non esistono.
- Idee non ancora affrontate: la watchlist ha 27 titoli e resta la sezione più densa della
  dashboard; il grafico della deriva mostra solo i primi quattro per contributo al rischio.

## Osservazione utile emersa dalle sue schermate

Sulla pagina titolo di investing.com convivono, adiacenti e con la stessa autorità,
**"Analisi tecnica: VENDI ADESSO"** e **"Previsioni: COMPRA ADESSO — target +83%"**. Nessuna riga
dichiara che sono metodologie diverse. È la stessa classe di difetto che i nostri detector C1/C4
intercettano: due letture della stessa cosa presentate come una sola. Vale la pena ricordarglielo
quando cita quei riquadri.
