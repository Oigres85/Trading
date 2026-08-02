# Da dove ripartire — handoff del 02/08/2026 (dopo v210)

> Leggi anche `CLAUDE.md`, che contiene le regole d'ingaggio e i difetti già vissuti.

## Come lavora davvero il CEO (accertato, non supposto)

- Guarda **investing.com più volte al giorno**: premarket, orario esteso, volumi, massimi/minimi.
  Quella è la sua dashboard vera, ed è migliore della nostra per il suo processo.
- Macro e notizie da **YouTube** (FX Evolution, Finvid, Bloomberg) — di cui si fida più dei nostri dati.
- **TradingView** quando ha tempo, con indicatori Pine.
- **Cambia posizione più volte al giorno oppure sta fermo per mesi.** Non c'è una cadenza:
  serve qualcosa di disponibile *quando decide*, non un report periodico.
- Ha guadagnato con questo metodo. Il sistema deve stargli **ai bordi**, non al centro.

## Stato del sistema (v210)

Tutti i gate verdi: **179 test JS** · red team 32 campagne · **pipeline 67 test** · coerenza 18
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

## ✅ FATTO in v209-v210

- **La macro sta tutta nella colonna centrale.** Via il bottone "📖 Macro" dalla topbar:
  duplicava "📖 Dettagli macro" che vive dentro la scheda. Una porta sola, dalla barra laterale.
- **Le mini-card sono diventate grafici.** I punteggi compositi (ciclo economico, Fear & Greed,
  sentiment globale, istituzionali-vs-retail) ora mostrano i loro 13/7/5/4 fattori come barre
  ordinate dal peggiore al migliore: si vede *chi* tira giù il numero, non solo quanto vale.
  Anche i 10 campanelli BofA e lo Sharpe (36 rilevazioni mai disegnate) sono grafici.
- **Grafica più moderna**: profondità sulle card, raggi coerenti, barra laterale con accento,
  alone dietro i numeri che contano.
- **v210, dalla prova del prompt**: il payload ora avvisa quando un limite d'ingresso è
  irraggiungibile, misurato in ATR (non in percentuale: WDC a −22,5% è più vicino di MSFT a
  −16,5%, perché ha un ATR tre volte più grande).

## ⚠️ Da leggere prima del prossimo report AI

**Il fix v207 è atterrato e la lettura macro è cambiata.** Ora le due serie partono e finiscono
alla stessa data, quindi i gap sono finalmente calcolabili:

| | prima (sbagliato) | ora (corretto) |
|---|---|---|
| Disaccoppiamento S&P vs PIL reale | −3 pp | **+61 pp** |
| S&P vs profitti aziendali reali | −30,7 pp | **+34,9 pp** (NDX +49) |

Entrambe le righe dichiarano la soglia dei 40 pp. Prima il payload diceva in pratica "niente da
vedere"; ora due misuratori indipendenti la sfondano. **Non è il mercato che è peggiorato: è che
prima quel numero era una sottrazione fra periodi diversi.**

**Raccomandazione sulla TESTATA** (`config/prompt_header.txt` è tuo, io non lo tocco): la riga
dati dice "snapshot di 10 ore fa — verifica online i livelli critici" e la riga dopo dice
"WEEKEND, MERCATI CHIUSI". A mercati chiusi i prezzi non possono essere disallineati. Come
modello ricevente spenderei la ricerca obbligatoria a verificare prezzi congelati invece che
sulle 40 notizie non ancora prezzate. Vale la pena condizionare quell'avviso allo stato del
mercato.

## ✅ FATTO in v208: la sfoltita, con la macro intatta

Regola applicata: **si toglie dalla pagina ciò che l'LLM riceve già dal payload, si tiene ciò
che vive solo lì.** Verificato generando il payload sui dati veri PRIMA di tagliare.

- **Portafoglio 38 → 27 colonne, watchlist 34 → 23.** Via Market Cap, P/E, P/E fwd, EV/EBITDA,
  ROE, margine netto, P/FCF, crescita ricavi, PEG, Z-Score e Target Δ: le ricevi tutte
  nell'analisi che incolli nell'LLM, quindi sulla pagina erano solo inchiostro.
- **Tenute Debt/Equity, Div Yield e Financial Health**: sono le uniche tre che NON erano nel
  payload. Tagliarle le avrebbe fatte sparire dal sistema, non dalla pagina.
- **La macro è rimasta intera** come chiesto: rotazione, termometri di stress, leva e
  stagionalità, più tutti i 34 riquadri nel blocco richiudibile.
- **Payload identico al byte.**

⚠ È una sfoltita, non il quinto di codice di cui avevamo parlato: le tabelle restano perché
servono a modificare le posizioni e ad aprire la scheda di un titolo. La riduzione vera si
misura sulla pagina (11 colonne in meno per riga), non sulle righe di codice.

## ⏭️ Il passo che decide tutto

Usa la dashboard **un mese senza toccare il codice**, annota le operazioni nel diario, poi:

```bash
node scripts/backtest_diary.mjs
```

Oggi sono 4 operazioni, +0,2pp contro l'indice, 1 su 4 a valore positivo — troppo poco per
concludere. Con venti si sa. E se dice che il sistema non aiuta, si chiude **con una misura,
non per stanchezza**.

Già misurato e da non riaprire senza nuovi dati: i segnali per-titolo (RS, ΔRS, MCR) **non hanno
contenuto predittivo** (`backtest_signals.mjs`, tutti e cinque sotto il riferimento) — è la
seconda volta, dopo il motore predittivo tolto in v200.

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
