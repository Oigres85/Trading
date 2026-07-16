# MASTER REFACTORING — Piano d'azione (handoff per nuova sessione)

> Preparato il 16/07/2026 a fine sessione v126. La nuova sessione DEVE leggere prima
> `CLAUDE.md` (convenzioni inviolabili) e la memoria di progetto. Ordine di esecuzione:
> STEP 1 → 3 → 4 (ingloba il 2) → 5. Ogni step = commit separato + batteria completa
> (`node scripts/test_app.mjs` · `python3 scripts/test_update_data.py` · `node scripts/redteam.mjs`
> · `python3 scripts/audit_data.py data/data.json`) + bump `?v=NN` + push.

## Architettura reale (correzioni alle premesse del task — NON ignorare)
- **NON esiste React/Next né build system**: GitHub Pages statico, `index.html` + `assets/app.js`
  vanilla (decisione di progetto ferma). STEP 5: niente `@react-pdf/renderer`; opzioni sotto.
- **NON esiste un backend con history LLM**: l'unico LLM di sistema è il critic Gemini in CI
  (`scripts/llm_critic.mjs`), già stateless a chiamata singola. Il "context carryover" avviene
  nella CHAT MANUALE dell'utente → si risolve con la generazione automatica (STEP 4), che è
  stateless by construction. STEP 2 = requisiti del servizio API di STEP 4 (2 messaggi
  system+user, `temperature: 0.1`), non un modulo da riparare.
- **WhatsApp = CallMeBot** (non Twilio/Meta): `scripts/notify_alerts.py` (`send_whatsapp`),
  secrets `CALLMEBOT_APIKEY` + `CALLMEBOT_PHONE`. Niente template Meta.
- **Repo PUBBLICO**: ogni output committato (report JSON/PDF) espone posizioni e controvalori
  — già vero per data.json; dichiararlo, non è un blocker nuovo.
- File chiave: `scripts/update_data.py` (pipeline dati), `assets/app.js` (motore+UI+buildPrompt),
  `config/prompt_header.txt` (testata UTENTE — mai sovrascrivere senza autorizzazione esplicita),
  workflow in `.github/workflows/` (update-data, tests, morning-brief), harness QA
  (`redteam.mjs`, `llm_critic.mjs`, `log_verdict.mjs`). Soglie rischio in `RISK_PARAMS` (app.js).

## STEP 1 — Fix Macro Shock Alert fantasma + timezone (PRIORITÀ MASSIMA, bug reale)
Sintomo osservato: `[MACRO SHOCK ALERT]` (KOSPI −8,95%) resta attivo quando l'Asia ha RIAPERTO
e il prezzo `[LIVE]` segna ~0%. L'utente ha tamponato nella TESTATA ("Allarme Fantasma") — il
fix vero va nel backend.
1. `compute_shock_alert()` in `update_data.py`: oggi legge `change_pct` di ^KS11 e dei futures.
   Causa probabile del fantasma: `previous_close`/candela di riferimento stantia (cache Yahoo
   a cavallo del rollover di sessione). Fix: **finestra di sessione timezone-aware** —
   lo shock su una fonte vale SOLO se il drop appartiene alla sessione CORRENTE del suo mercato
   (`ZoneInfo("Asia/Seoul")` per KOSPI, `America/New_York` per i futures/duo NQ-ES); al
   rollover (nuova candela daily / mezzanotte locale) l'alert si azzera. Mai cumulare col
   giorno precedente.
2. Priorità al delta LIVE ricalcolato: se `price_live`, delta = `(last_price/previous_close−1)`
   con previous_close della SESSIONE corrente; invalidare chiusure antecedenti.
3. Audit generale `datetime.now()` nudi in update_data.py → espliciti con `timezone.utc` o
   `ZoneInfo` di mercato dove la semantica è di mercato (RVol full-day, ecc. — solo dove serve,
   niente refactoring cosmetico). Il flag `[LAG TEMPORALE RILEVATO]` esiste già (data_quality):
   estenderlo al confronto updated_at vs orario mercato SOLO se a costo basso.
4. Test: simulare (funzioni pure) shock ieri + riapertura oggi a 0% → alert None; shock in
   sessione corrente → alert attivo. Aggiungere caso red-team se toccabile senza rete.

## STEP 3 — Debug WhatsApp mai arrivato (prima del 4: serve per le notifiche del report)
1. **CallMeBot risponde HTTP 200 anche su errore** (apikey invalida/telefono non attivato):
   il nostro `r.ok` crede di aver inviato. Fix: leggere il BODY e cercare i marker di successo
   ("Message queued") / errore ("APIKey is invalid", "blocked"); loggare il body in Actions.
2. Checklist diagnosi: secret `CALLMEBOT_PHONE` presente e con prefisso `+39`? Attivazione
   fatta (messaggio WhatsApp "I allow callmebot to send me messages" al numero CallMeBot)?
   `config/alert_state.json` ha una firma che DEDUPLICA da sempre (alert inghiottiti)?
   Log степ "Notifiche alert" nelle run Actions.
3. Aggiungere modalità test: `python scripts/notify_alerts.py --test` → invio incondizionato
   "test canale ok" + `workflow_dispatch` input sul workflow per lanciarlo dal telefono.
4. A fine STEP 4: notifica automatica "report CIO pronto + link" a ogni generazione riuscita.

## STEP 4 — Engine ibrido + Structured Output (ingloba STEP 2)
Decisione architetturale: la generazione VIVE IN CI (workflow dedicato `cio-report.yml`,
`workflow_dispatch` + cron post-run-dati mattutino), MAI client-side (chiave Gemini esposta).
1. `scripts/cio_report.mjs`:
   a. `buildHybridCIOContext()` = riuso del vm-harness (identico a llm_critic/redteam) per
      generare il payload testuale esistente (già contiene NAV, budget=cassa−ES95, R/R, MCR,
      stop ratchet, cinematica, track record) + ARRICCHIMENTO "deep data" best-effort da
      yfinance: stime EPS/ricavi forward (`eps_forward`, growth già in stats; CAGR 4Y da
      income_stmt storico — GIÀ scaricato dalla pipeline: preferire estenderla in
      update_data.py e leggere da data.json, NON rifetchare), pendenze macro (`slope_1m/6m`
      e %-da-ATH per Margin Debt e HY OAS calcolabili da `macro.margin_debt.series` e
      `metrics_history`).
   b. Chiamata Gemini STATELESS: 2 messaggi (system = testata file, user = payload),
      `temperature: 0.1`, **`responseSchema`** (structured output nativo Gemini) con
      `CIOReportSchema`: `briefing_e_sanity_check`, `macro_e_regime`, `analisi_portafoglio[]`
      (ticker, azione, qty, limite, stop, tracciabilità), `allocazione_liquidita`,
      `rotazione_strategica`, `allarmi_e_veto[]`.
   c. Validazione POST: gli ordini del JSON devono passare le stesse invarianti del red team
      (0<stop<limite≤prezzo, ticker esistente nel payload, budget rispettato) → report
      rifiutato e alert se violate. Output: `data/cio_report.json` committato + WhatsApp.
2. Il critic Gemini esistente resta separato (QA del payload ≠ generazione report).

## STEP 5 — Rendering PDF istituzionale (vanilla, zero build)
1. **MVP raccomandato**: pagina di stampa dedicata — `renderCIOReport()` in app.js legge
   `data/cio_report.json` → vista HTML istituzionale (header formale, griglia, tabelle, tag
   ACCUMULA verde tenue / VENDI-TRIM rosso tenue / MANTIENI grigio, box "Allarmi Rischio/Veto")
   + CSS `@media print` → bottone "Scarica Report PDF" = `window.print()` (PDF nativo browser,
   zero dipendenze, funziona su Pages/iPhone). Bottone "Anteprima a schermo intero" = la stessa
   vista in modal/nuova scheda.
2. Enhancement opzionale (solo se il CEO vuole il file .pdf programmatico): jsPDF UMD via CDN
   con fallback silenzioso alla stampa se il CDN è bloccato.
3. Il bottone "Copia prompt AI" NON si elimina (fallback collaudato + flusso manuale con
   web-search che l'API non ha): si AFFIANCA "Genera Report CIO (PDF)".
4. UI: nuovo bottone in topbar; stato "report del <timestamp>" se cio_report.json presente.

## Vincoli permanenti
- Invarianti red team I1–I11 e TUTTI i test verdi al 100% a ogni step; niente librerie a
  pagamento; convenzioni CLAUDE.md (SORT_FIELDS/colspan, `?.`, fallback RUMOROSI, testata=utente).
- Commit per step: `fix(data): session-aware macro shock alert & tz audit` ·
  `fix(notify): callmebot response validation & test mode` ·
  `feat(llm): hybrid CIO context + structured report via Gemini` ·
  `feat(ui): institutional CIO report PDF rendering`.
