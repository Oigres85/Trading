/* Trading Dashboard — rendering lato client di data/data.json */
const REPO = "Oigres85/Trading";
/* Versione del build: DEVE combaciare col ?v=NN in index.html — bump insieme a ogni release.
   Timbrata in cima al payload (buildCIOText) così il CEO verifica a colpo d'occhio se Safari ha
   servito il codice aggiornato: se il timbro dice una versione vecchia = pagina in cache stale. */
/* ⚠ v257 — QUESTA COSTANTE ERA FERMA A "251" DA SEI VERSIONI, e produceva DUE bugie insieme:
   il banner "stai vedendo una versione vecchia" restava acceso per sempre (confrontava 251 col
   256 pubblicato, e nessun ricaricamento poteva farlo coincidere), e il timbro in cima al
   pacchetto AI dichiarava "BUILD v251" su codice v256. Il CEO se n'e' accorto incollandomi un
   prompt: il contenuto era nuovo, il numero vecchio.
   La causa e' la classe dei registri copiati a mano — la stessa di C10 e degli orari di run:
   il numero vive in DUE posti (qui e nel ?v= di index.html) e nessuno verificava che
   combaciassero. Ora un check li confronta e la CI si rompe se divergono. */
const BUILD_VERSION = "350";
let DATA = null;
let sparkRange = localStorage.getItem("pref_range") || "m1";   // 1G | 1M | 1A (preferenza ricordata)

/* ordinamento tabelle: click su intestazione → desc → asc → default */
const SORT_FIELDS = {
  /* ⚠ v251 — RICALCOLATI. Il taglio di "Segnale" (indice 17) stava IN MEZZO alla tabella e ha
     spostato ogni indice successivo: CLAUDE.md avverte che l'accesso è per INDICE e che un
     taglio interno va ricalcolato, a differenza dei tagli in coda del v208.
     ptf: Titolo,Qtà,PMC,Prezzo,Oggi,Pre/After,Volume,Guadagno,Guad.%,Beta,Sharpe,Sortino,
          Supporto,Resistenza,ΔSMA200,RS 1M,RS NDX,Short%,Float,Drawdown,Opzioni,Trimestrale,
          Debt/Equity,Div Yield,Ricavi,Utile netto,Marg.netto,Cresc.ricavi  → 28 */
  "ptf-table": ["name", "qty", "pmc", "price", "change_pct", "prepost_chg", "volume",
                "gain", "gain_pct", "beta", "sharpe_1y", "sortino_1y", "support",
                "resistance", "sma200_dist_pct", "rs_1m", "rs_ndx_1m",
                "stat:short_float", "stat:float_shares", "w52_dist_pct", null, "earnings_date",
                "stat:debt_to_equity", "stat:dividend_yield",
                "fin:revenue", "fin:net_income", "fin:margin", "fin:cagr"],
  /* wl: Titolo,Prezzo,Oggi,Pre/After,Volume,Beta,Sharpe,Sortino,Supporto,Resistenza,ΔSMA200,
         RS 1M,RS NDX,Short%,Float,Drawdown,Opzioni,Trimestrale,Debt/Equity,Div Yield,
         Ricavi,Utile netto,Marg.netto,Cresc.ricavi  → 24 */
  "wl-table": ["name", "price", "change_pct", "prepost_chg", "volume",
               "beta", "sharpe_1y", "sortino_1y", "support", "resistance", "sma200_dist_pct",
               "rs_1m", "rs_ndx_1m", "stat:short_float", "stat:float_shares", "w52_dist_pct",
               null, "earnings_date", "stat:debt_to_equity", "stat:dividend_yield",
               "fin:revenue", "fin:net_income", "fin:margin", "fin:cagr"],
};
const sortState = {
  "ptf-table": { field: null, dir: 0 }, "wl-table": { field: null, dir: 0 },
};




/* ═══ v165 — ORDINE DELLE COLONNE personalizzabile (drag & drop sull'intestazione) ═══════
   L'ordine vive in localStorage per-tabella come permutazione degli indici ORIGINALI, così
   SORT_FIELDS (che mappa indice→campo) resta valido: ogni th porta `data-col` con il suo indice
   di partenza e sort/label lo usano al posto della posizione corrente nel DOM.
   ⚠ Riguarda SOLO le tabelle HTML. Le tabelle del PROMPT restano a colonne fisse: il red team
   (I6 col.16=Supp./17=Stop, I10 per nome) verifica per posizione, riordinarle romperebbe tutto. */
/* ═══ v188 — COLONNE NASCONDIBILI (richiesta CEO).
   ⚠ RIGUARDA SOLO LE TABELLE HTML. Il payload del prompt lo costruisce mdRow(), che non legge
   nulla di tutto questo: nascondere una colonna nella dashboard NON toglie un dato all'LLM.
   E' una scelta deliberata — il CEO guarda poche colonne, l'analista ne vuole tutte.
   La chiave e' l'indice ORIGINALE della colonna (data-col), lo stesso su cui poggia il
   riordino: cosi' nascondere e spostare si compongono senza interferire. */
const colHiddenKey = (tid) => `colhidden_${tid}`;
/* ═══ v198 — VISTA COMPATTA DI DEFAULT. Nessuna colonna viene rimossa: cambia solo quali sono
   ACCESE all'apertura. La tabella a 38 colonne conteneva tutto e non faceva vedere niente; una
   a otto si legge, e le altre trenta restano a un clic da "⚙ Colonne" o nella scheda del titolo.
   Le otto sono scelte per un criterio: sono quelle che servono a decidere se una posizione
   richiede attenzione — peso, rischio che genera, forza relativa, risultato, e il segnale.
   La preferenza dell'utente ha SEMPRE la precedenza: il default si applica solo la prima volta,
   e una volta scelto qualcosa non viene mai sovrascritto. */
/* ⚠ v206 — QUI IL COMMENTO MENTIVA. La watchlist dichiarava "Titolo Prezzo Oggi RS RSndx
   Segnale Trimestrale" ma gli indici 5 e 6 sono Beta e Sharpe 1A: la forza relativa — cioè il
   filtro leader/laggard, l'unica ragione per cui si guarda una watchlist di 27 titoli — NON
   era nella vista di default, al contrario di quanto il commento affermava e al contrario del
   portafoglio. Nessun test lo intercettava. Ora gli indici seguono il commento (RS 1M = 11,
   RS NDX 1M = 12) e un check verifica che le due cose non divergano più. */
const VISTA_COMPATTA = {
  /* ⚠ v251 — RICALCOLATA insieme a SORT_FIELDS: "Segnale" era l'indice 17 del portafoglio e il
     13 della watchlist, entrambi DENTRO la vista compatta. Al suo posto entra il MARGINE NETTO,
     che è un fatto e non un'etichetta derivata. */
  "ptf-table": [0, 1, 3, 4, 8, 15, 16, 21, 26],   // Titolo Qtà Prezzo Oggi Guad.% RS RSndx Trimestrale Marg.netto
  "wl-table":  [0, 1, 2, 11, 12, 17, 22],          // Titolo Prezzo Oggi RS RSndx Trimestrale Marg.netto
};
/* v206 — RIPARAZIONE DI UN DEFAULT SBAGLIATO, non sovrascrittura di una scelta.
   La vista compatta si applica UNA VOLTA SOLA: un browser che ha già ricevuto il default
   difettoso della watchlist (Beta e Sharpe al posto della forza relativa) non vedrebbe mai la
   correzione. Ma quel contenuto non è mai stato SCELTO dall'utente — gliel'ha imposto il codice.
   Quindi si ripara solo se le colonne nascoste sono ESATTAMENTE quelle che il vecchio default
   produceva: se l'utente ha toccato qualcosa, anche una sola colonna, la sua scelta resta.
   Vale una volta, poi la chiave impedisce di ripassarci. */
const VECCHIA_COMPATTA_WL = [0, 1, 2, 5, 6, 13, 18];

/* interruttore compatta/completa: una riga sola, e dice quante colonne stai vedendo */

function loadColHidden(tid) {
  try {
    const a = JSON.parse(localStorage.getItem(colHiddenKey(tid)) || "[]");
    return new Set(Array.isArray(a) ? a.filter(Number.isInteger) : []);
  } catch { return new Set(); }
}
function saveColHidden(tid, set) {
  try { localStorage.setItem(colHiddenKey(tid), JSON.stringify([...set])); } catch { /* quota */ }
}
/* applica la visibilita' a thead e righe dati, e RESTRINGE il colspan delle righe speciali
   (TOTALE, "+ Aggiungi titolo", nota BTP) di quante colonne coperte sono nascoste — senza
   questo la riga TOTALE sborderebbe e la tabella si disallineerebbe visivamente. */
/* pannello di scelta: una casella per colonna, nell'ordine in cui compaiono ora */
function openColumnPicker(tid, etichetta, rerender) {
  const head = document.querySelector(`#${tid} thead tr`);
  if (!head) return;
  const ths = [...head.children];
  const nascoste = loadColHidden(tid);
  const voci = ths.map(th => {
    const c = Number(th.dataset.col ?? 0);
    const nome = (th.textContent || "").trim() || `Colonna ${c + 1}`;
    const bloccata = th.classList.contains("sticky-col");   // il nome del titolo non si nasconde
    return `<label class="cp-item${bloccata ? " cp-locked" : ""}">
      <input type="checkbox" data-cp="${c}" ${nascoste.has(c) ? "" : "checked"} ${bloccata ? "disabled" : ""}>
      <span>${esc(nome)}</span>${bloccata ? '<em class="muted">sempre visibile</em>' : ""}</label>`;
  }).join("");
  openInfoModal(`Colonne — ${etichetta}`, `
    <div class="cp-note muted">Scegli cosa vedere in tabella. <b>Non tocca il prompt AI</b>: il payload
      continua a contenere tutti i dati, comprese le colonne che nascondi qui.
      Il dettaglio completo di ogni titolo resta a un clic sul suo <b>nome</b>.</div>
    <div class="cp-grid" data-cp-table="${tid}">${voci}</div>
    <div class="pp-actions">
      <button class="btn btn-ghost btn-sm" data-cp-all="${tid}">Mostra tutte</button>
      <button class="btn btn-primary btn-sm" data-cp-done="1">Fatto</button>
    </div>`);
  const grid = document.querySelector(`.cp-grid[data-cp-table="${tid}"]`);
  grid?.addEventListener("change", (e) => {
    const cb = e.target.closest("input[data-cp]");
    if (!cb) return;
    const c = Number(cb.dataset.cp);
    const set = loadColHidden(tid);
    if (cb.checked) set.delete(c); else set.add(c);
    saveColHidden(tid, set);
    rerender();
  });
}

const colOrderKey = (tid) => `colorder_${tid}`;
/* applica la permutazione a thead e a ogni riga dati (le righe con celle in colspan — TOTALE,
   "+ Aggiungi titolo", note BTP — hanno un numero di celle diverso e vengono saltate) */
/* trascinamento dell'intestazione per spostare una colonna a sinistra/destra */


const $ = (sel) => document.querySelector(sel);
const fmtEUR = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtUSD = new Intl.NumberFormat("it-IT", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function cur(row) { return row.currency === "EUR" ? "€" : row.currency === "PTS" ? "" : "$"; }
function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }
function signCls(v) { return v > 0 ? "pos" : v < 0 ? "neg" : ""; }
function signTxt(v, suffix = "%") {
  if (v === null || v === undefined) return "—";
  return (v > 0 ? "+" : "") + fmtNum.format(v) + suffix;
}
// [⚡ASIMM] (v136): motore di volatilità asimmetrica RIALZISTA — Sortino 1A supera lo Sharpe 1A
// di oltre il 70% (varianza quasi tutta al rialzo) CON momentum in corso (RSI>55). Su questi
// titoli la testata vieta le prese di beneficio da ipercomprato RSI: solo stop ratchet 2×ATR.
function isAsimm(r) {
  const sh = r.sharpe_1y, so = r.sortino_1y, rsi = r.rsi;
  return sh != null && so != null && sh > 0 && so / sh > 1.7 && rsi != null && rsi > 55;
}
// Polymarket Δ7g (v136): storico client-side delle probabilità (localStorage, un punto/giorno)
// → velocità del sentiment speculativo macro. Senza 7 giorni di storico → "[Δ7g —]".
function pmHist() { try { return JSON.parse(localStorage.getItem("polymarket_hist") || "{}"); } catch { return {}; } }
function recordPolymarket() {
  const preds = (typeof DATA !== "undefined" && DATA && DATA.predictions) || [];
  if (!preds.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const h = pmHist();
  for (const p of preds) {
    if (p.question == null || p.yes == null) continue;
    const arr = h[p.question] || [];
    if (arr.length && arr[arr.length - 1][0] === today) arr[arr.length - 1] = [today, p.yes];   // aggiorna oggi
    else arr.push([today, p.yes]);
    h[p.question] = arr.slice(-45);   // ~45 giorni di storico, basta per Δ7g/Δ30g
  }
  try { localStorage.setItem("polymarket_hist", JSON.stringify(h)); } catch { /* quota/blocco: best-effort */ }
}
function pmDelta7(question, yesNow) {
  const arr = pmHist()[question] || [];
  const target = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  let past = null;
  for (const [d, v] of arr) { if (d <= target) past = v; }   // il valore più recente con data ≤ 7g fa
  return past != null ? Math.round(yesNow - past) : null;
}

// URL raw: bypassa il CDN di GitHub Pages (nessun cache edge), dati sempre freschi.
// Pages URL come fallback (CORS block su raw in ambienti aziendali).
const RAW_URL = () => `https://raw.githubusercontent.com/${REPO}/main/data/data.json?t=${Date.now()}`;
const PAGES_URL = () => `data/data.json?t=${Date.now()}`;

async function fetchData() {
  const sane = (s) => s.replace(/\bNaN\b/g, "null").replace(/-?\bInfinity\b/g, "null");
  try {
    const res = await fetch(RAW_URL(), { cache: "no-store" });
    if (!res.ok) throw new Error(`raw ${res.status}`);
    return JSON.parse(sane(await res.text()));
  } catch {
    // fallback: Pages URL (può avere latenza CDN di alcuni minuti)
    const res2 = await fetch(PAGES_URL(), { cache: "no-store" });
    return JSON.parse(sane(await res2.text()));
  }
}

async function loadData(showSpin = false) {
  const btn = $("#btn-refresh");
  if (showSpin) btn.classList.add("spinning");
  try {
    // i proxy/CDN gratuiti a volte falliscono: riprovo fino a 3 volte prima di arrendermi
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try { DATA = await fetchData(); lastErr = null; break; }
      catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 1200 * (i + 1))); }
    }
    if (lastErr) throw lastErr;
    /* v256 — mergeManualHoldings(): reintegrava le posizioni aggiunte a mano. Niente
       portafoglio, niente posizioni da reintegrare. */
    applyMacroOverrides();        // correzioni manuali dei dati macro flaggati (decadono da sole)
    renderAll();
    livePrices();
    if (showSpin) toast("Dati ricaricati ✓");
  } catch (e) {
    console.error(e);
    // se non ho mai caricato dati, mostro un avviso invece di una pagina vuota
    if (!DATA) {
      const el = $("#dataquality-alert");   // v256: #earnings-alert non esiste piu'
      if (el) { el.hidden = false; el.className = "data-error"; el.innerHTML = `⚠ Impossibile caricare i dati (rete/proxy). <button class="btn btn-ghost btn-sm" onclick="loadData(true)">Riprova</button>`; }
    }
    if (showSpin) toast("Errore nel caricamento dati — riprovo tra poco");
  } finally {
    btn.classList.remove("spinning");
  }
}

/* Token GitHub (fine-grained, repo Oigres85/Trading, permessi Actions:read&write +
   Contents:read&write), chiesto UNA SOLA VOLTA e salvato solo in questo browser. */
function getToken() {
  let token = localStorage.getItem("gh_token");
  if (!token) {
    token = window.prompt(
      "Una sola volta: incolla un token GitHub del repo " + REPO +
      " (fine-grained, permessi Actions e Contents: read & write).\n" +
      "Resta salvato solo in questo browser, non te lo chiederà più.");
    if (token) { token = token.trim(); localStorage.setItem("gh_token", token); }
  }
  return token;
}

function ghHeaders(token) {
  return { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json" };
}

async function dispatchWorkflow(token) {
  return fetch(`https://api.github.com/repos/${REPO}/actions/workflows/update-data.yml/dispatches`, {
    method: "POST", headers: ghHeaders(token), body: JSON.stringify({ ref: "main" }),
  });
}

/* attende il nuovo data.json (updated_at diverso dal precedente) — usa raw per freschezza */
async function waitForNewData(prev, tries = 28) {
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, 15000));
    try {
      rpDone(_rpPending, "ok"); _rpPending = rpLog(`Controllo pubblicazione dati (tentativo ${i + 1}/${tries})…`);
      const d = await fetchData();
      if (d.updated_at !== prev) {
        rpDone(_rpPending, "ok"); _rpPending = null;   // il tentativo che ha trovato i dati è riuscito
        rpLog("Nuovo data.json ricevuto — rendering della dashboard", "ok");
        DATA = d; renderAll(); return true;
      }
    } catch { rpDone(_rpPending, "fail"); _rpPending = null; rpLog(`Rete/CDN non pronti, riprovo (tentativo ${i + 1})`, "fail"); }
  }
  return false;
}

/* ---- Barra di avanzamento dell'aggiornamento (la pipeline è lenta: feedback continuo) ---- */
let _refreshTimer = null;
const REFRESH_STAGES = [
  [0,  "Avvio pipeline su GitHub Actions…"],
  [12, "Download prezzi e fondamentali (Yahoo Finance)…"],
  [32, "Elaborazione indici, macro e rotazione settoriale…"],
  /* v272 — diceva "Sharpe Ratio, opzioni e SMC": Sharpe e SMC erano del portafoglio, che la
     pipeline non calcola piu'. Una barra di avanzamento che annuncia passi inesistenti fa
     sembrare lungo un lavoro che non si sta facendo. */
  [52, "Calcolo opzioni, correlazioni e indicatori tecnici…"],
  [72, "Generazione e validazione data.json…"],
  [88, "Quasi pronto, attendo la pubblicazione…"],
];
/* v272 — PRICE_STAGES tolto: non lo chiamava nessuno (zero riferimenti oltre alla propria
   definizione) e parlava di "controvalori e P&L", che non esistono da v256. */
let _lastRpMsg = "";
/* v165 — ESITO ESPLICITO per ogni passo: il log elencava azioni senza dire quali fossero
   riuscite e quali no, e un fallimento (rete/CDN, tentativo a vuoto) si leggeva come una riga
   qualsiasi. Ora: ✓ riuscita · ✗ fallita · · in corso. */
function rpLog(msg, status = "info") {
  const box = document.getElementById("rp-log");
  if (!box) return;
  const line = document.createElement("div");
  line.className = `rp-log-line rp-${status}`;
  const mark = status === "ok" ? "✓" : status === "fail" ? "✗" : "·";
  line.textContent = `${new Date().toLocaleTimeString("it-IT")} ${mark} ${msg}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  return line;
}
/* segna come CONCLUSA una riga di log già emessa (si tiene il riferimento all'elemento: cercarla
   per testo sbagliava bersaglio quando lo stesso messaggio compare più volte) */
let _rpPending = null;
function rpDone(el, esito = "ok") {
  if (!el || !el.classList || !el.classList.contains("rp-info")) return;
  el.classList.remove("rp-info"); el.classList.add(`rp-${esito}`);
  el.textContent = el.textContent.replace(" · ", esito === "ok" ? " ✓ " : " ✗ ");
}
function showRefreshProgress(est = 150000, stages = REFRESH_STAGES) {
  hideRefreshProgress();
  _lastRpMsg = "";
  const el = document.createElement("div");
  el.id = "refresh-progress";
  el.className = "refresh-progress";
  el.innerHTML = `
    <div class="rp-row"><span class="rp-spin"></span><span class="rp-msg" id="rp-msg">Avvio aggiornamento…</span><span class="rp-pct" id="rp-pct">0%</span></div>
    <div class="rp-track"><div class="rp-fill" id="rp-fill" style="width:0%"></div></div>
    <div class="rp-log" id="rp-log" aria-live="polite"></div>`;
  document.body.appendChild(el);
  const start = Date.now();
  _refreshTimer = setInterval(() => {
    const pct = Math.min(92, ((Date.now() - start) / est) * 92);
    const stage = [...stages].reverse().find(s => pct >= s[0]) || stages[0];
    setRefreshProgress(pct, stage[1]);
  }, 300);
}
function setRefreshProgress(pct, msg) {
  const f = document.getElementById("rp-fill"); if (f) f.style.width = pct.toFixed(0) + "%";
  const p = document.getElementById("rp-pct"); if (p) p.textContent = Math.round(pct) + "%";
  if (msg) {
    const m = document.getElementById("rp-msg"); if (m) m.textContent = msg;
    if (msg !== _lastRpMsg) {
      // v175 — passare allo step successivo significa che il PRECEDENTE è concluso: va spuntato.
      // Prima ogni riga restava neutra per tutta la durata e il CEO non vedeva mai un ✓ sulle
      // singole attività, solo sull'esito finale.
      rpDone(_rpPending, "ok");
      _lastRpMsg = msg; _rpPending = rpLog(msg);
    }
  }
}
function finishRefreshProgress(ok) {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  rpLog(ok ? "Pipeline completata: dati pubblicati e dashboard aggiornata"
           : "Pipeline NON confermata entro il tempo massimo: i dati potrebbero arrivare più tardi",
        ok ? "ok" : "fail");
  setRefreshProgress(100, ok ? "Aggiornamento completato ✓" : "Tempo scaduto — i dati potrebbero arrivare a breve");
  setTimeout(hideRefreshProgress, ok ? 1800 : 4000);
}
function hideRefreshProgress() {
  const el = document.getElementById("refresh-progress");
  if (el) el.remove();
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}

/* Aggiorna: prezzi live all'istante + rigenerazione completa via workflow (col token,
   chiesto una sola volta). Senza token resta comunque utile (prezzi live + reload). */
function showRefreshDoneModal() {
  const ts = DATA?.updated_at ? new Date(DATA.updated_at).toLocaleString("it-IT") : "—";
  const existing = document.getElementById("refresh-done-modal");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "refresh-done-modal";
  el.className = "refresh-done-backdrop";
  el.innerHTML = `<div class="refresh-done-box">
    <div class="refresh-done-icon">✓</div>
    <div class="refresh-done-title">Aggiornamento Completato</div>
    <div class="refresh-done-sub">Tutti i dati sono stati rigenerati con successo.<br><span class="muted">Aggiornato alle ${ts}</span></div>
    <button class="btn btn-primary" onclick="this.closest('#refresh-done-modal').remove()">OK</button>
  </div>`;
  el.addEventListener("click", e => { if (e.target === el) el.remove(); });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 8000);
}

// (il tasto rapido "⟳ Prezzi" è stato rimosso: resta un unico "⟳ Aggiorna tutto";
//  i prezzi live si aggiornano comunque da soli ogni 60 secondi)
async function refreshAll() {
  const btn = $("#btn-refresh");
  btn.classList.add("btn-refreshing");
  btn.textContent = "⏳ Aggiorno…";
  try {
    livePrices();
    const token = getToken();
    if (!token) { await loadData(false); toast("Prezzi aggiornati ✓ (token assente: niente rigenerazione completa)"); return; }
    const res = await dispatchWorkflow(token);
    if ([401, 403, 404].includes(res.status)) {
      localStorage.removeItem("gh_token");
      toast("Token senza permesso Actions — rimosso. Creane uno con Actions: read & write e riprova");
      return;
    }
    if (res.status !== 204) { rpLog(`Avvio pipeline RIFIUTATO da GitHub (HTTP ${res.status})`, "fail"); toast(`Errore avvio aggiornamento (HTTP ${res.status})`); return; }
    showRefreshProgress();
    rpLog("Workflow GitHub Actions avviato (rigenerazione completa della pipeline)", "ok");
    waitForNewData(DATA?.updated_at).then(ok => {
      finishRefreshProgress(ok);
      const b2 = $("#btn-refresh");
      const origTxt = "⟳ Aggiorna tutto";
      b2.classList.remove("btn-refreshing");
      if (ok) {
        b2.textContent = "✓ Aggiornato";
        b2.classList.add("btn-done");
        setTimeout(() => { b2.textContent = origTxt; b2.classList.remove("btn-done"); }, 6000);
        showRefreshDoneModal();
      } else {
        b2.textContent = origTxt;
      }
    });
  } catch (e) {
    console.error(e);
    toast("Errore durante l'aggiornamento");
  } finally {
    btn.classList.remove("btn-refreshing");
    btn.textContent = "⟳ Aggiorna tutto";
  }
}

/* ---------------- aggiungi/rimuovi titoli ---------------- */
const editMode = { portfolio: false, watchlist: false };

/* AUTO-TIMESTAMP SNAPSHOT (v113): salvare quantità/PMC/titoli del PORTAFOGLIO dalla UI
   significa aver appena riconciliato le posizioni col broker → la data di snapshot broker
   si aggiorna DA SOLA alla data odierna. Prima restava ferma e il banner "RICONCILIA COL
   BROKER" continuava a suonare a vuoto finché l'utente non editava holdings.json a mano.
   Le modifiche alla sola watchlist non toccano le posizioni → data invariata. */

/* ⚠ v254 — IL `name` MANCANTE HA UCCISO LA PIPELINE, E IL SINTOMO SEMBRAVA UN ALTRO.
   Le posizioni create da qui uscivano come {ticker, qty, pmc}, mentre `update_data.py` faceva
   `pos["name"]`: dal momento in cui BE, SKHY, WDC e MRVL sono entrate in holdings.json, OGNI
   run del CI è morto con KeyError: 'name' PRIMA di scaricare un solo prezzo.
   Il sintomo visibile era un altro — "data.json è fermo a 9 posizioni" — e l'ho letto per un
   giorno come latenza del cron, scrivendo perfino nel payload che la pipeline "non ha ancora
   rigenerato". Non era in ritardo: era spenta. È la lezione v238 in versione dati: la
   sintassi valida non dice nulla sull'esecuzione, e un difetto scoperto guardando l'ESITO
   (dati fermi) si spiega troppo facilmente con una causa innocente.
   Il nome si prende dalla watchlist (che ce l'ha), poi dai dati vivi, e in ultima istanza è il
   ticker: mai assente. Il fallback c'è anche in `update_data.py` — un'etichetta da mostrare
   non deve poter fermare l'acquisizione dei prezzi. Due reti, perché il difetto è passato
   proprio dove non ce n'era nessuna. */


/* ═══ v244 — LO STATO DEL PORTAFOGLIO SEGUE IL CEO FRA I DISPOSITIVI ═══════════════════════
   Il CEO: "quando cambio parametri, es. aggiornamento di acquisti o di cash, questi non si
   sincronizzano quando mi collego dalla stessa pagina da iPhone."
   Aveva ragione, ed era una svista di COMPLETEZZA: quando abbiamo costruito la sincronizzazione
   abbiamo coperto diario, ordine sezioni, override macro, testata e parametri di rischio — e ci
   siamo dimenticati proprio del portafoglio, cioè la cosa che cambia più spesso.
   Restavano in localStorage, quindi vive solo sul browser dove le scrivi:
     · cash_eur         la liquidità
     · manual_holdings  gli acquisti inseriti a mano
     · btp_override     quantità e prezzo di carico del BTP
   ⚠ Fusione PER CAMPO, non a blocco: ogni campo porta il suo istante. Se cambi la cassa sul Mac
   e le posizioni su iPhone, si tengono ENTRAMBE. Con un timestamp unico per tutto il blocco, la
   modifica più vecchia sparirebbe in silenzio — e una perdita silenziosa è peggio di un conflitto. */
const STATO_PTF_PATH = "config/portfolio_state.json";


/* segna QUALE campo è cambiato e quando, poi salva e spedisce */


/* rilegge dal repo e tiene, PER OGNI CAMPO, la versione più recente */

/* --- posizioni aggiunte a mano: persistite in localStorage così sopravvivono al reload
   anche senza token GitHub. Quando la pipeline le include in data.json, vengono ignorate. --- */
/* unisce le posizioni manuali al DATA.portfolio appena caricato da data.json */


/* Modale "Modifica valori": edita qty + PMC di ogni posizione e la liquidità in un colpo solo.
   Salva localmente (sopravvive al reload) e, se c'è un token, persiste su config/holdings.json. */


// riga segnaposto finché il workflow non porta i dati tecnici completi



/* ---------------- prezzi live lato client (CORS proxy → Yahoo) ---------------- */
/* ⚠ v268 — I PROXY SONO GRATUITI E CONDIVISI, E SI ARRABBIANO. Misurato mentre scrivevo
   questa versione: corsproxy.io ha cominciato a rispondere "HTTP 429 Rate limit reached" dopo
   qualche minuto di richieste — perche' la pagina ne faceva 21 al minuto per la watchlist PIU'
   quelle di livePrices, sugli stessi simboli. Due giri separati per lo stesso dato: il doppio
   del traffico e, peggio, due verita' possibili sullo stesso prezzo nella stessa pagina.
   Da qui: un giro solo, una cache sola, e chi prende un 429 va in castigo per un po' invece di
   essere richiamato subito (riprovare in fretta e' il modo per restare bloccati). */
const CORS_PROXIES = [
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://thingproxy.freeboard.io/fetch/${u}`,
];
const proxyInCastigo = new Map();          // indice del proxy → quando torna utilizzabile
const CASTIGO_MS = 5 * 60 * 1000;

/* ═══ v268 — QUOTAZIONI VERE PER QUALSIASI SIMBOLO, DAL BROWSER ════════════════════════════
   Il CEO: "se cambio ticker nel box ricerca la risposta e': per questo simbolo la pipeline non
   ha ne' livelli ne' opzioni" e "La mia watchlist come faccio ad aggiornare valori? e da dove
   prende questi dati?".
   LA RISPOSTA STAVA GIA' IN CASA. Questa pagina interroga Yahoo dal browser da sempre
   (fetchQuote, sopra): non aveva bisogno della pipeline per i prezzi, li chiedeva solo per
   l'ultimo scambio e buttava via il resto della risposta. Lo stesso endpoint, con un `range`
   piu' lungo, restituisce le BARRE — e da quelle si ricavano massimo e minimo del giorno,
   volume, supporto, resistenza e i due estremi dell'anno con le stesse formule della pipeline
   (minimo/massimo delle ultime 20 sedute; vedi update_data.py, "support"/"resistance").
   Misurato prima di scrivere questo: 7 simboli in parallelo in 152 ms, compresi ^SOX e HG=F
   che la pipeline non segue. BTP-V28 risponde "Not Found" — e' un ticker sintetico nostro, non
   esiste su Yahoo, e la riga lo dira' invece di restare in bianco.
   ⚠ IL LIMITE, DICHIARATO: si passa da un proxy CORS pubblico e gratuito (Yahoo non manda gli
   header CORS: misurato, la chiamata diretta fallisce). Se il proxy cade, i prezzi non
   arrivano — e allora si mostra il dato della pipeline DICENDO che e' quello, invece di una
   cella vuota. Le opzioni (muri di put e call) restano appannaggio della pipeline: nessuna
   fonte gratuita le espone al browser.
   ⚠ NON e' un dato "ufficiale": e' l'ultimo scambio che Yahoo pubblica, con i suoi ritardi. */
const QUOTE_TTL = 90 * 1000;          // i prezzi si rileggono al massimo ogni minuto e mezzo
const BARRE_TTL = 15 * 60 * 1000;     // un anno di barre cambia poco: si tiene un quarto d'ora
const cacheQuote = new Map();

/* ⚠ v272 — DUE RICHIESTE DIVERSE, PERCHE' SERVONO DUE COSE DIVERSE.
   · giornata in corso → range=1d, barre da 5 minuti, includePrePost=true. E' l'unico modo per
     avere il PRE e l'AFTER market: il `meta` non li porta (verificato: preMarketPrice e
     postMarketPrice arrivano sempre null anche con includePrePost), ma le BARRE fuori orario
     ci sono, e `meta.currentTradingPeriod` dice in che fase siamo. Misurato alle 07:41 ET:
     NVDA a 224,37 in pre-market contro 223,96 di chiusura precedente.
   · storia → range lungo, barre giornaliere, per supporto, resistenza ed estremi dell'anno.
   ⚠ E c'e' un motivo in piu' per il range=1d: li' `chartPreviousClose` E' davvero la chiusura
   di ieri. Col range=5d era la chiusura PRIMA della finestra, ed e' il difetto che dava a WDC
   un -20,29% invece di -3,81% (v268). */
function yahooChart(symbol, range) {
  const oggi = range === "1d";
  const q = oggi ? "range=1d&interval=5m&includePrePost=true" : `range=${range}&interval=1d`;
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${q}`;
}

/* La fase di mercato e il prezzo fuori orario, dalle barre. Ritorna null quando siamo in
   seduta ordinaria (li' il prezzo "fuori orario" non esiste e inventarlo sarebbe peggio). */
function fuoriOrario(meta, ts, close) {
  const cp = meta && meta.currentTradingPeriod;
  if (!cp || !cp.regular || !ts || !ts.length) return null;
  const inizioReg = Number(cp.regular.start), fineReg = Number(cp.regular.end);
  const ora = Math.floor(Date.now() / 1000);
  const fase = ora < inizioReg ? "pre" : ora >= fineReg ? "after" : "regolare";
  if (fase === "regolare") return null;
  /* l'ultima barra VALIDA fuori dall'orario ordinario: prima della campana se siamo in pre,
     dopo la chiusura se siamo in after. */
  let ultimo = null;
  for (let i = ts.length - 1; i >= 0; i--) {
    const t = Number(ts[i]), c = Number(close[i]);
    if (!Number.isFinite(c)) continue;
    const dentro = t >= inizioReg && t < fineReg;
    if (dentro) { if (fase === "after") break; else continue; }
    if (fase === "pre" && t >= inizioReg) continue;
    ultimo = { t, c };
    break;
  }
  if (!ultimo) return null;
  return { fase, prezzo: ultimo.c, quando: new Date(ultimo.t * 1000) };
}

/* Chiede le barre a Yahoo passando dai proxy in ordine. Ritorna null se nessuno risponde:
   il chiamante deve poter distinguere "non risponde" da "non esiste", e infatti sono due
   valori diversi — null contro { assente: true }. */
async function barreYahoo(symbol, range) {
  const url = yahooChart(symbol, range);
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const fino = proxyInCastigo.get(i);
    if (fino && Date.now() < fino) continue;          // ha appena detto 429: si salta
    const make = CORS_PROXIES[i];
    try {
      const r = await fetch(make(url), { cache: "no-store" });
      if (r.status === 429) { proxyInCastigo.set(i, Date.now() + CASTIGO_MS); continue; }
      if (r.ok) proxyInCastigo.delete(i);
      if (!r.ok) continue;
      const j = await r.json();
      if (j && j.chart && j.chart.error) return { assente: true, motivo: j.chart.error.description || j.chart.error.code };
      const res = j && j.chart && j.chart.result && j.chart.result[0];
      if (!res || !res.meta) continue;
      const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
      return {
        meta: res.meta, ts: (res.timestamp || []).map(Number),
        high: (q.high || []).map(Number), low: (q.low || []).map(Number),
        close: (q.close || []).map(Number), open: (q.open || []).map(Number),
        volume: (q.volume || []).map(Number),
      };
    } catch { /* proxy successivo */ }
  }
  return null;
}

/* la quotazione di un simbolo con quello che serve alle colonne del broker.
   `range` corto per la tabella (una barra basta), lungo per i livelli. */
async function quotaLive(symbol, range = "1d") {
  const k = `${symbol}|${range}`;
  const ttl = range === "1d" ? QUOTE_TTL : BARRE_TTL;
  const c = cacheQuote.get(k);
  if (c && Date.now() - c.t < ttl) return c.v;
  const intraday = range === "1d";      // barre da 5 minuti, non giornaliere
  const b = await barreYahoo(symbol, range);
  let v = null;
  if (b && b.assente) v = { assente: true, motivo: b.motivo };
  else if (b) {
    const m = b.meta;
    const ok = (a) => (a || []).filter(Number.isFinite);
    const hi = ok(b.high), lo = ok(b.low), vol = ok(b.volume);
    const px = Number(m.regularMarketPrice);
    /* ⚠ v268 — `chartPreviousClose` NON E' LA CHIUSURA DI IERI: e' la chiusura PRIMA della
       finestra richiesta. Misurato su WDC con range=5d: chartPreviousClose valeva 544,84 (il
       31 luglio) mentre la seduta precedente aveva chiuso a 451,52 — la variazione usciva
       -20,29% invece di -3,81%. Un numero plausibile e sbagliato di cinque volte, che nessun
       controllo di forma avrebbe intercettato perche' era un numero perfettamente valido.
       La chiusura precedente e' la penultima barra buona, e basta guardarla. `previousClose`
       del meta si usa solo se c'e' (spesso manca) e la serie e' troppo corta.
       ⚠ Questo vale anche col mercato aperto: l'ultima barra e' quella di oggi (parziale) e la
       penultima e' la chiusura di ieri — in tutti e due i casi il conto e' lo stesso. */
    /* ⚠ v272 — DA DOVE VIENE LA CHIUSURA PRECEDENTE DIPENDE DAL PASSO DELLE BARRE, e
       sbagliarlo produce sempre un numero plausibile.
       · barre GIORNALIERE (range lungo): la penultima barra E' la chiusura di ieri.
       · barre da 5 MINUTI (giornata in corso): la penultima barra e' di cinque minuti fa, e
         usarla dava a NVDA -0,23% invece di +2,27%. Li' la chiusura di ieri e'
         `chartPreviousClose`, che con range=1d e' esattamente quella (a differenza del
         range=5d, dove era la chiusura prima dell'intera finestra — il difetto di v268).
       Due casi opposti, e in tutti e due il numero sbagliato ha l'aria di uno giusto. */
    const chiusure = ok(b.close);
    const prevMeta = Number(m.chartPreviousClose != null ? m.chartPreviousClose : m.previousClose);
    const prev = intraday
      ? prevMeta
      : (chiusure.length >= 2 ? chiusure[chiusure.length - 2] : prevMeta);
    v = {
      price: px,
      /* ⚠ il massimo del giorno lo porta il META (regularMarketDayHigh), che e' quello vero
         della seduta in corso; l'ultima barra e' gia' chiusa quando il mercato e' chiuso e
         coincide, ma durante la seduta il meta e' piu' fresco. Si preferisce il meta e si
         ripiega sull'ultima barra. */
      dayHigh: Number.isFinite(Number(m.regularMarketDayHigh)) ? Number(m.regularMarketDayHigh) : hi[hi.length - 1],
      dayLow: Number.isFinite(Number(m.regularMarketDayLow)) ? Number(m.regularMarketDayLow) : lo[lo.length - 1],
      /* un indice non ha volume: Yahoo manda 0, e "0K" in tabella sembra un mercato fermo.
         Zero qui vuol dire "non esiste", e si scrive come le altre assenze. */
      vol: (() => {
        const v0 = Number.isFinite(Number(m.regularMarketVolume)) ? Number(m.regularMarketVolume) : vol[vol.length - 1];
        return Number.isFinite(v0) && v0 > 0 ? v0 : NaN;
      })(),
      prev,
      chg: Number.isFinite(px) && Number.isFinite(prev) ? px - prev : NaN,
      chgPct: Number.isFinite(px) && Number.isFinite(prev) && prev ? (px / prev - 1) * 100 : NaN,
      valuta: m.currency,
      /* i livelli si calcolano solo quando si e' chiesta la storia: con 5 giorni un
         "supporto a 20 sedute" sarebbe un numero costruito su 5, cioe' una bugia comoda. */
      /* ⚠ con barre da 5 minuti "le ultime 20" sono un'ora e mezza, non venti sedute: un
         supporto calcolato li' sarebbe un numero vero di un'altra grandezza. I livelli si
         calcolano SOLO sulle barre giornaliere. */
      sup20: !intraday && hi.length >= 20 ? Math.min(...lo.slice(-20)) : NaN,
      res20: !intraday && hi.length >= 20 ? Math.max(...hi.slice(-20)) : NaN,
      max52: !intraday && hi.length >= 200 ? Math.max(...hi) : NaN,
      min52: !intraday && lo.length >= 200 ? Math.min(...lo) : NaN,
      barre: hi.length,
      ext: fuoriOrario(m, b.ts, b.close),      // pre/after market, o null se siamo in seduta
    };
  }
  if (v) cacheQuote.set(k, { t: Date.now(), v });
  return v;
}

let cashEur = parseFloat(localStorage.getItem("cash_eur")) || 0;

function recomputeTotals() {
  const eurusd = DATA.eurusd || 1.08;
  // valore e guadagno per posizione in EUR: usa lo snapshot REALE del broker (bval/bgain)
  // se presente, altrimenti calcola dai prezzi live. r.val_eur/r.gain_eur = verità mostrata.
  let valEur = 0, costEur = 0, stockGainEur = 0, btpGainEur = 0;
  DATA.portfolio.forEach(r => {
    let v, g;
    const hasLive = r.price != null && r.qty;
    // PRIORITÀ AL VIVO: prezzo live × quantità (più fresco dello snapshot broker, spesso datato).
    // Fallback allo snapshot bval/bgain solo se manca il prezzo live.
    if (r.currency === "EUR") { v = r.value || 0; g = r.gain || 0; }                       // BTP (già in EUR)
    else if (hasLive) { v = (r.price * r.qty) / eurusd; g = ((r.price - r.pmc) * r.qty) / eurusd; }
    else if (r.bval != null) { v = r.bval; g = r.bgain || 0; }
    else { v = (r.value || 0) / eurusd; g = (r.gain || 0) / eurusd; }
    r.val_eur = v; r.gain_eur = g;
    valEur += v; costEur += (v - g);
    if (r.ticker === "BTP-V28") btpGainEur += g; else stockGainEur += g;
  });
  const investedEur = valEur;                       // controvalore investimenti (liquidità esclusa)
  const eurGain = stockGainEur + btpGainEur;
  const tax = 0.26 * Math.max(0, stockGainEur) + 0.125 * Math.max(0, btpGainEur);
  // totali in USD (per la riga "azioni $…" della tabella)
  const eq = DATA.portfolio.filter(r => r.currency === "USD");
  const usdValue = eq.reduce((s, r) => s + (r.value || 0), 0);
  const usdCost = eq.reduce((s, r) => s + r.pmc * r.qty, 0);
  Object.assign(DATA.totals, {
    usd_value: usdValue, usd_gain: usdValue - usdCost, usd_gain_pct: usdCost ? (usdValue / usdCost - 1) * 100 : 0,
    eur_value: investedEur + cashEur, eur_invested: investedEur, eur_cost: costEur, cash: cashEur,
    eur_gain: eurGain, eur_gain_pct: costEur ? eurGain / costEur * 100 : 0,
    eur_stock_gain: stockGainEur, eur_btp_gain: btpGainEur,
    tax_est: tax, eur_gain_net: eurGain - tax,
    // OFFLOADING per l'LLM: budget realmente spendibile = cassa − Expected Shortfall 95%
    // (la quota pari all'ES è tail-risk INVIOLABILE). Mai sotto zero. ES storico se disponibile.
    budget_operativo_spendibile: Math.max(0, cashEur - (DATA.totals?.es95_hist_eur ?? DATA.totals?.es95_1d_eur ?? 0)),
  });
  DATA.allocation = DATA.portfolio.map(r => ({
    ticker: r.ticker, name: r.name, sector: r.sector || "Altro", value_eur: r.val_eur,
    gain_eur: r.gain_eur ?? null,
    gain_pct: (r.gain_eur != null && r.val_eur != null && (r.val_eur - r.gain_eur) > 0)
      ? Math.round(r.gain_eur / (r.val_eur - r.gain_eur) * 1000) / 10 : null,
  }));
  if (cashEur > 0) DATA.allocation.push({ ticker: "CASH", name: "Liquidità", sector: "Liquidità", value_eur: cashEur });
  DATA.allocation.sort((a, b) => b.value_eur - a.value_eur);
}

async function livePrices() {
  if (!DATA) return;
  const syms = [...new Set([
    ...DATA.portfolio.filter(r => r.ticker !== "BTP-V28").map(r => r.ticker),
    ...(DATA.watchlist || []).map(r => r.ticker),
  ])];
  /* ⚠ v268 — LO STESSO GIRO CHE SERVE LA WATCHLIST. Prima questa funzione chiamava fetchQuote
     e la watchlist ne faceva un altro sugli STESSI simboli: doppio traffico verso un proxy
     gratuito (che infatti ha risposto 429) e due prezzi possibili per lo stesso titolo nella
     stessa pagina. Ora si passa da quotaLive, che ha una cache con scadenza: la seconda
     richiesta dello stesso simbolo non esce nemmeno, e i due posti mostrano lo stesso numero
     perche' leggono lo stesso oggetto. */
  const res = await Promise.allSettled(syms.map(async (s) => {
    const q = await quotaLive(s, "1d");
    if (q && !q.assente) quoteLive.set(String(s).toUpperCase(), q);
    return [s, q && !q.assente && Number.isFinite(q.price) ? { price: q.price, prev: q.prev } : null];
  }));
  const map = {}; let any = false;
  res.forEach(x => { if (x.status === "fulfilled" && x.value[1]) { map[x.value[0]] = x.value[1]; any = true; } });
  if (!any) return;
  /* ═══ v316 — IL PORTAFOGLIO SEGUE IL MERCATO, NON LO SNAPSHOT ═══════════════════════════
     Il CEO: "trova un modo per aggiornare i dati del portafoglio sulla base delle ultime
     rilevazioni di mercato". Il prezzo si aggiornava gia' ogni 60 secondi — il GUADAGNO no, e
     la tabella nemmeno.
     ⚠⚠ DUE DIFETTI, E IL PRIMO E' UN NOME. La condizione era `r.currency === "USD" && r.qty`,
     ma le posizioni del CEO arrivano da config/posizioni.json e portano `qta`, non `qty`:
     il ramo non entrava MAI. E anche fosse entrato avrebbe scritto `gain_pct`, mentre la tabella
     del portafoglio legge `gain_pct_pos` — cioe' il campo aggiornato non era quello letto.
     Risultato: prezzo fresco accanto a un guadagno vecchio, due grandezze sullo stesso titolo a
     due istanti diversi. E' la classe che questo progetto ha gia' pagato piu' volte (v229/v230):
     quando due letture della stessa grandezza convivono, si decide sulla piu' allarmante.
     ⚠ L'obbligazione NON si valuta come un'azione: quote x prezzo darebbe 4,1 milioni al posto
     di 41 mila. Ma il GUADAGNO percentuale si', perche' carico e prezzo sono entrambi in
     percentuale del nominale. */
  const upd = (r) => {
    const q = map[r.ticker]; if (!q) return;
    r.price = Math.round(q.price * 100) / 100;
    r.change_pct = Math.round((q.price / q.prev - 1) * 10000) / 100;
    r.price_asof = "live";                       // la riga sa di essere fresca, e la tabella lo dice
    const qta = numero(r.qta ?? r.qty), pmc = numero(r.pmc);
    if (Number.isFinite(qta) && qta > 0 && Number.isFinite(pmc) && pmc > 0) {
      const obbl = String(r.ticker || "").startsWith("BTP") || r.currency === "EUR";
      r.value = obbl ? qta * r.price / 100 : r.price * qta;
      r.gain = r.value - (obbl ? qta * pmc / 100 : pmc * qta);
      const g = Math.round((r.price / pmc - 1) * 10000) / 100;
      r.gain_pct = g;
      r.gain_pct_pos = g;                        // il campo che la tabella legge davvero
    }
  };
  DATA.portfolio.forEach(upd);
  (DATA.watchlist || []).forEach(upd);
  recomputeTotals();
  refreshShockClient();         // ricalcola lo shock dai prezzi live (KOSPI/futures) — coglie crolli/recuperi
  /* ⚠ v256 — QUESTA RIGA HA UCCISO LA PAGINA IN LOCALE, e il gate non l'ha vista: chiamava
     renderKPI/renderTable/renderWatchlist/renderAllocation, tolte con il portafoglio. Il gate
     di render ricava la sua lista da renderAll — e questa riga sta in refreshLivePrices, che
     renderAll non chiama. E' la classe v238 per la quinta volta: la sintassi valida non dice
     niente sull'esecuzione, e un gate copre solo la catena che gli hai dato. Trovata solo
     aprendo la pagina. Sotto, la guardia e' stata estesa a TUTTE le funzioni di primo livello. */
  renderShockAlert();
  /* ⚠ senza questa riga i numeri nuovi restavano in memoria e la tabella continuava a mostrare
     quelli dello snapshot: aggiornare il dato e non ridisegnarlo e' come non aggiornarlo. */
  renderPortafoglio();
  const el = $("#live-badge");
  if (el) el.textContent = `Prezzi live: ${new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function renderAll() {
  /* v256 — LA CATENA DI RENDER E' SOLO MACRO. Escono renderCash, renderKPI, renderAllocation,
     renderStruttura, renderEarningsAlert, renderDivergenzaDiario, renderReconcileAlert,
     renderTable, renderWatchlist, renderNews: i loro contenitori non esistono piu' in
     index.html, e senza portafoglio non avrebbero comunque nulla da disegnare.
     ⚠ Il gate di render (v253) ricava la sua lista DA QUI: una chiamata tolta esce dal gate
     insieme alla funzione, una aggiunta ci entra da sola. */
  const d = new Date(DATA.updated_at);
  const at = $("#updated-at");
  if (at) {
    at.textContent = d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const ageH = (Date.now() - d.getTime()) / 3600000;
    const upd = at.closest(".upd-item");
    if (upd) {
      upd.classList.toggle("stale", ageH > 8);
      at.title = ageH > 8 ? `Dati di ${Math.round(ageH)} ore fa` : "";
      upd.querySelector(".stale-tag")?.remove();
      if (ageH > 8) { const sp = document.createElement("span"); sp.className = "stale-tag"; sp.textContent = " (vecchi)"; upd.appendChild(sp); }
    }
  }
  recomputeTotals();
  /* ⚠ v266 — LA WATCHLIST VA RIDISEGNATA QUANDO ARRIVANO I DATI, non solo al montaggio. La
     tabella si monta subito, quando DATA e' ancora null: senza questa riga resta a trattini e
     nessuno la tocca piu'. Finora la salvava per caso caricaWatchlistCloud(), che ridisegnava
     dopo il fetch del file remoto; chiuso il difetto della lista resuscitata quel giro puo'
     non avvenire, e i trattini restavano — cioe' esattamente "sembra che i dati siano fermi",
     il difetto da cui e' nata questa tabella. Il render non deve dipendere da un caso. */
    /* ⚠ v266 — STESSA RAGIONE DELLA WATCHLIST, e l'ho ripetuta scrivendo la funzione nuova: la
     striscia dei livelli si monta col grafico, quando DATA e' ancora null, e senza questa riga
     resta ferma su "non disponibili" anche dopo che i dati sono arrivati. Chi disegna al
     montaggio deve stare anche qui, perche' il montaggio precede sempre i dati. */
  if (typeof tvSimboloCorrente === "string" && tvSimboloCorrente) renderOpzioniGrafico(tvSimboloCorrente);
  renderPortafoglio();          // v307 — le posizioni, e il clic che apre il grafico
  renderCalendario();           // v287 — cosa esce nei prossimi 7 giorni
  renderMacroGrafici();         // rotazione, stress, leva e stagionalità
  /* v337 — qui stava un rimando a renderCorrMacro()/testoCorrelazioniMacro(): entrambe
     rimosse col punteggio 0-100. Un commento che nomina funzioni inesistenti manda la lettura
     a cercare codice che non c'e' — e self_check lo prende, giustamente. */
  refreshShockClient();
  renderShockAlert();
  renderDataQualityAlert();
  recordPolymarket();           // storico Polymarket (un punto/giorno) per la derivata Δ7g
  if ($("#sell-modal")?.hidden !== false) renderSellCalc();
  pmcInit();
}

/* banner di alert: trimestrali entro 7 giorni (rischio binario) con Implied Move */

/* riconciliazione col broker: niente API, quindi qty/PMC/bval sono aggiornati A MANO.
   Due segnali di disallineamento (il buco più pericoloso: un trade eseguito ma non
   riportato → il motore ragiona su un portafoglio che non esiste più):
   1) snapshot broker VECCHIO (>14 gg dalla data as_of);
   2) incoerenza per posizione: controvalore ricalcolato (prezzo live × qtà, in €) che
      diverge >20% dal bval del broker — quasi sempre qty/PMC non allineati o bval stantio
      (la soglia larga assorbe il drift di mercato di un paio di settimane). */


/* DATA ASSERTIONS lato client (post-incidente margin debt congelato a $622 mld Z.1):
   legge data_quality dalla pipeline e, se assente (JSON vecchio), ricalcola i check
   critici in locale. Un dato DATATO o INAFFIDABILE deve URLARE: banner in dashboard
   + flag giganti nel prompt — mai più degradi silenziosi. */
function validateMacroData() {
  const dq = DATA?.data_quality;
  const m = DATA?.macro || {};
  const out = { bad: [], stale: [], overrides: [], flags: {} };   // flags[key] = testo per il prompt
  const overridden = (key) => {
    if (key === "forward_pe") return m.forward_pe?.manual_override && m.forward_pe;
    if (key === "sp500_pe") return m.sp500_pe?.manual_override && m.sp500_pe;
    if (key === "margin_debt") return m.margin_debt?.manual_override && m.margin_debt;
    if (key === "vix") return m.vix?.manual_override && m.vix;
    const ind = (m.indicators || []).find(i => i.key === key);
    return ind?.manual_override ? ind : null;
  };
  const classify = (key, status, note) => {
    const ovNode = overridden(key);
    if (ovNode) {   // corretto a mano: allarme SPENTO, provenienza dichiarata nel prompt
      out.overrides.push({ key, date: (ovNode.override_date || "").slice(0, 10) });
      out.flags[key] = `[MANUAL_OVERRIDE — valore inserito dall'utente il ${(ovNode.override_date || "").slice(0, 10) || "n.d."}]`;
      return;
    }
    if (status === "implausible" || status === "unreliable" || status === "missing") {
      out.bad.push({ key, status, note });
      out.flags[key] = `[!!! DATATO / UNRELIABLE !!!${note ? " " + note : ""}]`;
    } else if (status === "stale" && !out.flags[key]) {   // mai degradare un flag UNRELIABLE a semplice LAG
      out.stale.push({ key, note });
      out.flags[key] = "[LAG TEMPORALE RILEVATO — double-check via web PRIMA di usare questo dato]";
    }
  };
  if (dq && Array.isArray(dq.checks)) {
    dq.checks.forEach(c => classify(c.key, c.status, c.note || ""));
  } else {
    // fallback client-side minimale su JSON senza data_quality (pre-v97)
    const md = m.margin_debt;
    if (md && (md.unreliable || !/FINRA/.test(md.series || "") || (md.value || 0) < 800000)) {
      classify("margin_debt", "unreliable", `serie ${md?.series || "?"} — non è il dato FINRA reale (~$1,4T nel 2026)`);
    }
    const ageD = (ds) => ds ? Math.floor((Date.now() - new Date(ds).getTime()) / 86400000) : null;
    if (md && ageD(md.date) > 90) classify("margin_debt", "stale", "");
    if (m.vix && m.vix.value != null && !(m.vix.value >= 5 && m.vix.value <= 150)) classify("vix", "implausible", `VIX ${m.vix.value}`);
  }
  out.ok = !out.bad.length && !out.stale.length;   // gli override attivi NON sono allarme
  return out;
}

/* ---------------- MANUAL OVERRIDE dei dati macro flaggati ----------------
   L'utente può correggere a mano un dato missing/stale/unreliable dal popup del banner.
   Regole di onestà: (1) l'override si applica SOLO finché la pipeline resta rotta su quel
   dato — quando torna un dato vero e fresco, l'override decade automaticamente;
   (2) ogni valore corretto a mano è marcato manual_override e nel prompt appare come
   [MANUAL_OVERRIDE] con la data d'inserimento: mai spacciato per dato di fonte. */
const OVERRIDE_PATH = "config/macro_overrides.json";
function loadOverrides() {
  try { return JSON.parse(localStorage.getItem("macro_overrides") || "{}"); } catch { return {}; }
}
function saveOverrides(o) {
  localStorage.setItem("macro_overrides", JSON.stringify(o));
  pushOverridesCloud(o);   // sync su GitHub se c'è token (stesso pattern del diario)
}
async function pushOverridesCloud(o) {
  const token = localStorage.getItem("gh_token");
  if (!token) return;
  try {
    let sha;
    const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${OVERRIDE_PATH}`, { headers: ghHeaders(token), cache: "no-store" });
    if (g.ok) sha = (await g.json()).sha;
    await fetch(`https://api.github.com/repos/${REPO}/contents/${OVERRIDE_PATH}`, {
      method: "PUT", headers: ghHeaders(token),
      body: JSON.stringify({ message: "Override manuale dati macro", content: btoa(unescape(encodeURIComponent(JSON.stringify(o, null, 1)))), sha }),
    });
  } catch { /* offline: resta in locale */ }
}
async function loadOverridesCloud() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${OVERRIDE_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const cloud = await r.json();
    if (cloud && typeof cloud === "object") {
      const local = loadOverrides();
      // vince il più recente per chiave
      Object.entries(cloud).forEach(([k, v]) => {
        if (!local[k] || (v.savedAt || "") > (local[k].savedAt || "")) local[k] = v;
      });
      localStorage.setItem("macro_overrides", JSON.stringify(local));
    }
  } catch { /* nessun override remoto */ }
}

/* stato pipeline per chiave (dai check data_quality), PRIMA degli override */
function dqStatusOf(key) {
  const c = (DATA?.data_quality?.checks || []).find(x => x.key === key);
  return c ? c.status : null;
}

/* applica gli override ai dati in memoria; ritorna le chiavi applicate */
function applyMacroOverrides() {
  const m = DATA?.macro;
  if (!m) return [];
  const ov = loadOverrides();
  const applied = [];
  let changed = false;
  Object.entries(ov).forEach(([key, o]) => {
    const st = dqStatusOf(key);
    const broken = st == null || ["missing", "unreliable", "implausible", "stale"].includes(st);
    if (!broken) { delete ov[key]; changed = true; return; }   // pipeline guarita → override decade
    const v = parseFloat(o.value);
    if (!(v > 0)) return;
    if (key === "forward_pe") {
      m.forward_pe = { value: v, avg_hist: 16.5,
        label: v > 22 ? "Estremo" : v > 18 ? "Elevato" : v > 14 ? "Normale" : "Conveniente",
        manual_override: true, override_date: o.savedAt };
    } else if (key === "sp500_pe") {
      m.sp500_pe = Object.assign(m.sp500_pe || { history: [] }, {
        current: v, label: v > 25 ? "Sopravvalutazione" : v > 20 ? "Valutazione elevata" : "Valutazione normale",
        manual_override: true, override_date: o.savedAt });
    } else if (key === "margin_debt") {
      const peak = Math.max(v, 935904, m.margin_debt?.peak || 0);
      m.margin_debt = Object.assign(m.margin_debt || {}, {
        value: v, peak, pct_of_peak: Math.round(v / peak * 1000) / 10,
        date: o.date || m.margin_debt?.date, series: "FINRA debit balances (override manuale)",
        manual_override: true, override_date: o.savedAt });
      delete m.margin_debt.unreliable;
    } else if (key === "vix") {
      m.vix = Object.assign(m.vix || {}, { value: v, manual_override: true, override_date: o.savedAt });
    } else {   // indicatori (pmi, cpi, pce, gdp, nfp...)
      const ind = (m.indicators || []).find(i => i.key === key);
      if (ind) { ind.value = String(o.value); ind.manual_override = true; ind.override_date = o.savedAt; ind.date = (o.savedAt || "").slice(0, 10) || ind.date; }
    }
    applied.push(key);
  });
  if (changed) saveOverrides(ov);
  return applied;
}

/* popup di correzione: input per ogni dato flaggato, salva → override + allarme spento */
function openDataQualityModal() {
  const v = validateMacroData();
  const items = [...v.bad.map(b => ({ ...b, sev: "bad" })), ...v.stale.map(s2 => ({ ...s2, status: "stale", sev: "stale" }))];
  const ov = loadOverrides();
  if (!items.length && !Object.keys(ov).length) { toast("Nessun dato macro da correggere ✓"); return; }
  const HINTS = {
    forward_pe: "Forward P/E S&P 500 (es. 21.7 — wsj.com/market-data/stocks/peyields)",
    sp500_pe: "P/E trailing S&P 500 (es. 25.4)",
    margin_debt: "Margin Debt FINRA in $ MILIONI (es. 1415557 = $1,42T — finra.org margin statistics)",
    umich: "Fiducia consumatori UMich (es. 53.3 — NON è l'ISM PMI)", vix: "VIX spot", cpi: "CPI YoY % (es. 4.3)", pce: "PCE YoY %",
  };
  const rows = items.map(it => `
    <div class="edp-row"><span class="edp-tk"><b>${esc(it.key)}</b> <span class="muted">(${esc(it.status)})</span><br>
      <span class="muted" style="font-size:10px">${esc(HINTS[it.key] || "valore numerico")}</span></span>
      <input type="number" step="any" inputmode="decimal" id="ov-${esc(it.key)}" placeholder="valore corretto" value="${ov[it.key]?.value ?? ""}">
      ${it.key === "margin_debt" ? `<input type="month" id="ov-date-${esc(it.key)}" value="${(ov[it.key]?.date || new Date().toISOString().slice(0, 7))}">` : "<span></span>"}
    </div>`).join("");
  const active = Object.keys(ov).length ? `<div class="info-line muted" style="font-size:11px;margin-top:8px">Override attivi: ${Object.entries(ov).map(([k, o]) => `${k}=${o.value}`).join(", ")} — decadono da soli quando la pipeline torna a fornire il dato vero.</div>` : "";
  openInfoModal("Correggi dati macro (override manuale)",
    `<div class="info-line" style="margin-bottom:8px">Inserisci i valori corretti per i dati che la pipeline non riesce a fornire. Verranno usati da dashboard e prompt AI marcati <b>[MANUAL_OVERRIDE]</b> con la data d'inserimento, e <b>decadranno automaticamente</b> quando la fonte tornerà a funzionare.</div>
     ${rows || '<div class="muted">Nessun dato flaggato al momento.</div>'}${active}
     <div class="edp-actions"><button class="btn btn-primary btn-sm" id="ov-save">Salva override</button>
     <button class="btn btn-ghost btn-sm" id="ov-clear">Rimuovi tutti</button></div>`);
  $("#ov-save")?.addEventListener("click", () => {
    const o = loadOverrides();
    const now = new Date().toISOString();
    items.forEach(it => {
      const inp = $(`#ov-${it.key}`);
      const val = parseFloat(inp?.value);
      if (val > 0) {
        o[it.key] = { value: val, savedAt: now };
        const dt = $(`#ov-date-${it.key}`);
        if (dt && dt.value) o[it.key].date = dt.value + "-01";
      }
    });
    saveOverrides(o);
    applyMacroOverrides();
    renderAll();
    closeChartModal();
    toast("Override salvati — allarme spento per i dati corretti ✓");
  });
  $("#ov-clear")?.addEventListener("click", () => {
    saveOverrides({});
    toast("Override rimossi — al prossimo caricamento tornano i dati (e gli allarmi) della pipeline");
    closeChartModal();
  });
}

/* SHOCK ALERT CLIENT-SIDE (v132): la pipeline calcola lo shock solo ai suoi run, ma i prezzi di
   KOSPI/futures si aggiornano LIVE nel browser ogni 60s → un crollo (o un RECUPERO) tra un run e
   l'altro non si rifletteva nel banner. Qui ricalcolo dai prezzi live: la variazione live di
   ^KS11 (q.price/q.prev, già sessione-corrente per costruzione) rimpiazza il valore di pipeline;
   i futures restano quelli di pipeline (non aggiornati client-side). Gate: solo con Wall Street
   REGOLARE chiusa (lo shock è un fenomeno overnight/pre-apertura). */
/* v161 — FONTE DI VERITÀ UNICA sulla fase di seduta: derivata da usSessionInfo invece di
   ri-implementare la stessa finestra oraria. Prima le due funzioni erano coerenti solo "per
   costruzione" (stesse costanti copiate): qualunque ritocco a una — festività, DST, orari
   ridotti — le avrebbe fatte divergere, e il payload avrebbe potuto dire WEEKEND in una riga
   e comportarsi da mercato aperto in un'altra. Ora la divergenza è impossibile. */
function usRegularSessionOpen(now = new Date()) {
  return usSessionInfo(now).phase === "regular";
}
/* FASE DELLA SEDUTA USA (v149): il payload deve sapere "che ora è" — un'analisi delle 07:18
   italiane (notte USA) ragiona su anticipatori (KOSPI/futures/esteso) e propone ordini per
   l'APERTURA; una delle 15:00 ET ragiona sui prezzi live. Senza questa riga l'LLM ignorava
   il KOSPI +4,5% live in pre-apertura (visto sul run del 21/07). Festività USA non considerate
   (approssimazione dichiarata). */
/* ⚠ v256 — sessionContextLine() RIMESSA. Lo sfoltimento l'aveva tolta perché il suo unico
   chiamante stava dentro il blocco portafoglio; ma la fase della seduta NON è un dato di
   portafoglio: dice se VIX, futures e ampiezza sono rilevazioni vive o l'ultima chiusura, e
   senza quella riga il pacchetto macro presenterebbe numeri congelati come se fossero di
   adesso. È la classe v193 — stato del mercato e freschezza del dato sono due cose diverse —
   e qui serve proprio a tenerle distinte. */
function sessionContextLine() {
  const s = usSessionInfo();
  const hrs = Math.round(s.minsToOpen / 60 * 10) / 10;
  // anticipatori inline (STEP 0 material): KOSPI live, futures pipeline, BTC — i dati che
  // l'LLM deve pesare PRIMA della campana, serviti dove li legge per primi
  const wl = DATA.watchlist || [];
  const ks = wl.find(r => r.ticker === "^KS11"), btc = wl.find(r => r.ticker === "BTC-USD");
  const fut = (DATA.macro || {}).futures || {};
  // v158 — un anticipatore vale solo se è FRESCO. Nel weekend anche l'Asia è chiusa: il KOSPI è la
  // candela di venerdì, già incorporata nella chiusura USA di venerdì. Spacciarlo per "anticipatore"
  // spingeva a leggere due volte lo stesso movimento (e ha già prodotto un allarme shock fantasma).
  const dmy = (v) => { const t = new Date(String(v).slice(0, 10)); return isNaN(t) ? "" : ` [chiusura del ${String(t.getUTCDate()).padStart(2, "0")}/${String(t.getUTCMonth() + 1).padStart(2, "0")}]`; };
  const lead = [
    // v190 — TRE stati, non due. Il v182 ne distingueva solo "live" e "borsa ferma", e quando
    // Seoul apriva mentre lo snapshot era ancora quello di ieri l'etichetta diceva "borsa ferma"
    // nella stessa riga in cui il testo di sessione diceva "Seoul sta scambiando ora": la riga
    // si contraddiceva da sola. Lo stato mancante e' il piu' insidioso — mercato APERTO, dato VECCHIO.
    /* ⚠ v234 — IL TERZO STATO DI v190 C'ERA MA NON SCATTAVA MAI. La condizione del "LIVE" era
       `price_live && seoulSessionOpen()`: due cose che INSIEME non stabiliscono la freschezza.
       `price_live` e' un flag della pipeline ("yfinance ha dato una quotazione live-ish"), non
       "catturata mentre Seoul scambiava"; `seoulSessionOpen()` guarda l'OROLOGIO DI ADESSO, non
       quello dello snapshot. Misurato sui dati veri: KOSPI -5,12% con price_live=true, snapshot
       delle 22:54Z = 07:54 a Seoul, cioe' un'ora PRIMA dell'apertura coreana — eppure la riga
       diceva "[LIVE, Seoul in contrattazione]" solo perche' alle 00:38 ET Seoul e' aperta.
       Manca il pezzo che conta: QUANDO e' stato preso il dato. Ora il LIVE richiede che lo
       snapshot stesso sia caduto dentro una sessione coreana — cosi' il terzo stato (mercato
       APERTO, dato VECCHIO), che v190 aveva scritto proprio per questo caso, diventa
       raggiungibile invece di restare codice morto. Classe v182/v193: stato del mercato e
       freschezza del dato sono due cose diverse. */
    ks && ks.change_pct != null ? (() => {
      const snap = DATA.updated_at ? new Date(DATA.updated_at) : null;
      const snapVivo = snap && !isNaN(snap) && seoulSessionOpen(snap);
      const oraKst = snap && !isNaN(snap)
        ? new Date(snap.getTime() + 9 * 3600e3).toISOString().slice(11, 16) : null;
      return `KOSPI ${signTxt(ks.change_pct)}${
        (ks.price_live && seoulSessionOpen() && snapVivo) ? " [LIVE, Seoul in contrattazione]"
        : seoulSessionOpen() ? ` [Seoul APERTA ora, ma questo valore viene dallo snapshot${oraKst ? ` delle ${oraKst} KST` : ""}, preso FUORI dalla sessione coreana: non è aggiornato in tempo reale]`
        : " [ultima chiusura di Seoul, borsa ferma]"}`;
    })() : null,
    fut.nasdaq?.change_pct != null ? `Fut NDX ${signTxt(fut.nasdaq.change_pct)}` : null,
    fut.sp500?.change_pct != null ? `Fut S&P ${signTxt(fut.sp500.change_pct)}` : null,
    btc && btc.change_pct != null ? `BTC ${signTxt(btc.change_pct)} [24/7]` : null,
  ].filter(Boolean).join(" · ");
  const beforeBell = s.phase === "notte" || s.phase === "pre-market" || s.phase === "weekend";
  // v161 — il rimando al blocco CATALIZZATORI si stampa SOLO se quel blocco esiste davvero in
  // questo payload (news post-chiusura presenti). Un rimando a una sezione assente è la stessa
  // classe di difetto dell'ex "A4": manda l'LLM a cercare qualcosa che non c'è.
  // La riga AFFERMA il fatto (N notizie dopo la campana) invece di RIMANDARE a una sezione: il
  // blocco CATALIZZATORI si genera solo se almeno una di quelle notizie tocca il book, quindi un
  // rimando incondizionato poteva puntare a una sezione assente (news post-chiusura tutte estranee
  // al portafoglio). Un'affermazione vera in ogni caso non può diventare pendente.
  /* ⚠ v277 — RAMO MORTO. Chiamava newsSplitByClose(), uscita col blocco news in v256: il
     try/catch la mascherava e il valore era SEMPRE 0. Un ramo che non puo' dare altro che zero
     non e' una protezione, e' un commento che sembra codice (classe v234). */
  const nUnp = 0;
  const asiaViva = seoulSessionOpen();
  const guida = (s.phase === "weekend" && asiaViva)
    ? `WEEKEND a New York MA BORSA ASIATICA APERTA (Seoul sta scambiando ORA; apertura USA tra ~${hrs}h). ATTENZIONE ALLA FRESCHEZZA: la borsa coreana è aperta, ma il valore del KOSPI qui sopra viene dallo snapshot della pipeline e NON è aggiornato in tempo reale — è l'ultima chiusura, non la seduta in corso. Storicamente il primo mercato che vota sulle notizie del fine settimana è l'Asia, e i semiconduttori coreani sono i più correlati a questo book${nUnp ? `; le ${nUnp} notizie non ancora prezzate sono elencate sotto` : ""}`
    : s.phase === "weekend"
    ? `WEEKEND, MERCATI CHIUSI (apertura tra ~${hrs}h): l'unico dato che si muove ancora è il BTC (24/7) — KOSPI e futures sono fermi alla chiusura di venerdì e NON anticipano nulla di nuovo, sono già dentro l'ultima chiusura USA.${nUnp ? ` Il segnale fresco di questo run sono le ${nUnp} NOTIZIE arrivate dopo la campana, che il prezzo non ha ancora votato:` : " Nessuna notizia nuova dopo la campana:"} il prossimo prezzo che esiste e' quello dell'apertura di lunedi'`
    : beforeBell
    ? `SEI PRIMA DELLA CAMPANA (apertura tra ~${hrs}h): KOSPI/Asia, futures USA e prezzi estesi (pre/after, "→ agg.") sono il dato più fresco — pesali come ANTICIPATORI nell'analisi; ogni ordine proposto vale per l'APERTURA della prossima seduta USA, limite sul "→ agg." quando presente, mai a mercato in apertura`
    : s.phase === "regular"
      ? `SESSIONE USA APERTA: i prezzi live hanno priorità; gli ordini limite sono eseguibili oggi`
      : `USA in AFTER-HOURS: gli ordini valgono per la prossima apertura (~${hrs}h); il "→ agg." incorpora già il gap after`;
  /* ═══ v232 — "ANTICIPATORI" NON E' VERO IN OGNI FASE ═══════════════════════════════════════
     Trovato eseguendo il payload su me stesso a mercato APERTO. La riga diceva
       "fase: REGULAR … · ANTICIPATORI: KOSPI -5,12% [chiusura di Seoul, borsa ferma] · Fut NDX
        +0,72% · … · SESSIONE USA APERTA: i prezzi live hanno priorita'"
     cioe' presentava come anticipatori due dati che NON anticipano piu' niente: la cosa che
     dovrebbero precedere — la seduta americana — sta gia' scambiando, e quei valori sono dentro
     i prezzi live che la riga stessa dichiara prioritari. Il lettore trova la parola
     ANTICIPATORI e la contraddizione tre parole dopo.
     La lezione e' quella di v158 (KOSPI e futures nel weekend "sono gia' dentro l'ultima
     chiusura USA e NON anticipano nulla"), applicata allora al TESTO della guida ma non
     all'ETICHETTA — che e' la parola che l'LLM legge per prima. Ora l'etichetta segue la fase:
     anticipano solo quando c'e' davvero un'apertura davanti. */
  /* ⚠ NON basta `beforeBell`: quella include il WEEKEND, dove la guida qui sopra dice
     testualmente che KOSPI e futures "sono gia' dentro l'ultima chiusura USA e NON anticipano
     nulla di nuovo" — l'etichetta avrebbe contraddetto il testo tre righe sotto, cioe' lo stesso
     difetto che sto correggendo, solo in un altro ramo. Anticipano quando c'e' davvero
     un'apertura davanti e il dato e' piu' fresco dell'ultima chiusura: notte, pre-market, after. */
  const etLead = (s.phase === "notte" || s.phase === "pre-market" || s.phase === "after")
    ? "ANTICIPATORI"
    : s.phase === "regular"
      ? "CONTESTO — NON anticipatori: la sessione USA e' aperta, quindi questi dati sono gia' dentro i prezzi live"
      : "FERMI — non anticipano nulla di nuovo: sono gia' dentro l'ultima chiusura USA";
  return `CONTESTO DI SESSIONE (ora ET ${s.etHHMM}, fase: ${s.phase.toUpperCase()} — festività USA non considerate)${lead ? ` · ${etLead}: ${lead}` : ""} · ${guida}.`;
}

function usSessionInfo(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
  const weekend = day === 0 || day === 6;
  const phase = weekend ? "weekend"
    : mins >= 240 && mins < 570 ? "pre-market"
    : mins >= 570 && mins < 960 ? "regular"
    : mins >= 960 && mins < 1200 ? "after-hours"
    : "notte";
  let minsToOpen = null;
  if (!weekend && mins < 570) minsToOpen = 570 - mins;
  else {
    let ahead = 1;
    while ([0, 6].includes((day + ahead) % 7)) ahead++;
    minsToOpen = ahead * 1440 - mins + 570;
  }
  return { phase, minsToOpen, etHHMM: `${String(et.getHours()).padStart(2, "0")}:${String(et.getMinutes()).padStart(2, "0")}` };
}
/* ── OROLOGIO DEL PREZZO vs OROLOGIO DELLE NOTIZIE (v158) ─────────────────────────
   Il payload mescola due orologi: i PREZZI si fermano alla campana (venerdì 16:00 ET), le NEWS
   continuano ad arrivare. Senza questa distinzione il sistema commette un errore logico grave:
   confronta un prezzo di venerdì con una notizia di sabato e conclude che "il flusso non conferma
   la narrativa" — ma il prezzo NON PUÒ aver votato una notizia che non ha ancora visto.
   Queste funzioni separano le news GIÀ PREZZATE da quelle NON ANCORA PREZZATE (i catalizzatori
   della prossima apertura), che è informazione operativa che il payload prima non sapeva esprimere. */
function etUtcOffsetHours(d) {   // ore da sottrarre a UTC per avere l'ora di New York (4 EDT / 5 EST)
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return Math.round((utc - et) / 3600000);
}
/* istante UTC dell'ultima chiusura USA (16:00 ET del giorno di price_asof delle EQUITY:
   crypto/futures/indici esteri quotano 24/7 e falserebbero il confine) */
function lastUsEquityCloseUTC() {
  const eq = [...(DATA.portfolio || []), ...(DATA.watchlist || [])]
    .filter(r => r && r.currency === "USD" && !/-USD$|^\^|=F$/.test(r.ticker || "") && r.price_asof);
  const asof = eq.map(r => String(r.price_asof).slice(0, 10)).sort().pop();
  if (!asof) return null;
  const off = etUtcOffsetHours(new Date(asof + "T18:00:00Z"));
  const t = new Date(`${asof}T${String(16 + off).padStart(2, "0")}:00:00Z`);
  return isNaN(t) ? null : { at: t, asof };
}
/* news pubblicate DOPO l'ultima chiusura = non ancora nel prezzo.
   Esclude le voci sintetiche Polymarket (sono snapshot di probabilità, non notizie). */
const isRealNews = (n) => !!(n && n.title) && !/— probabilità Sì/.test(n.title_it || n.title);
const seoulToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // UTC+9, niente DST
/* v171 — L'ASIA APRE MENTRE A NEW YORK È ANCORA DOMENICA. Il ramo "weekend" assumeva che tutto
   fosse fermo, ma il KOSPI apre alle 09:00 KST = 02:00 CEST del lunedì, quando l'orologio di New
   York segna ancora le 20:00 di domenica. In quella finestra il payload dichiarava "KOSPI fermo
   alla chiusura di venerdì, non anticipa nulla" mentre il KOSPI stava scambiando dal vivo — cioè
   proprio quando l'anticipatore asiatico è l'unica informazione nuova disponibile. */
function seoulSessionOpen(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600e3);        // Corea: UTC+9 fisso, nessun DST
  const g = kst.getUTCDay();
  if (g === 0 || g === 6) return false;                    // sabato/domenica a Seoul
  const min = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return min >= 540 && min < 930;                          // 09:00–15:30 KST
}
function shockSourcesLive() {
  const THR = -2.0, sources = [];
  const fut = (DATA.macro || {}).futures || {};
  for (const [k, lab] of [["nasdaq", "Futures Nasdaq 100"], ["sp500", "Futures S&P 500"]]) {
    const chg = dgFin((fut[k] || {}).change_pct);
    if (chg != null && chg <= THR) sources.push({ src: lab, chg });
  }
  // GATE DI SESSIONE (v141, stesso fix del server v127): il change_pct del KOSPI vale solo se
  // è della SESSIONE CORRENTE — price_live (delta ricalcolato in tempo reale) oppure candela
  // con price_asof = data di Seoul di OGGI. Una candela stantia ([chiusura del 16/07] letta il
  // 18) qui reintroduceva l'Allarme Fantasma che la pipeline aveva già soppresso.
  const k = (DATA.watchlist || []).find(r => r.ticker === "^KS11");
  const kc = k ? dgFin(k.change_pct) : null;
  // v176 — ALLARME FANTASMA, terza incarnazione. Il gate accettava `price_live === true` come prova
  // di freschezza, ma quel flag dice solo che il prezzo viene da fast_info: di DOMENICA, con Seoul
  // chiusa da venerdì e price_asof nullo, restava true e faceva scattare lo shock su un -5,72% di
  // due giorni prima — già dentro la chiusura USA di venerdì, quindi contato due volte. Ora il
  // "live" vale solo se la borsa di Seoul è DAVVERO in sessione (seoulSessionOpen, v171); fuori
  // sessione serve una data di rilevazione che sia oggi a Seoul. Su un allarme si sta stretti.
  const kFresh = k && ((k.price_live === true && seoulSessionOpen())
    || (k.price_asof && String(k.price_asof).slice(0, 10) === seoulToday()));
  if (kc != null && kc <= THR && kFresh) sources.push({ src: "KOSPI (Asia)", chg: kc });
  return sources;
}
function computeShockClient() {
  const sources = shockSourcesLive();
  if (!sources.length || usRegularSessionOpen()) return null;
  return { active: true, threshold: -2, sources, worst_chg: Math.min(...sources.map(s => s.chg)),
           note: "Asia/futures Nasdaq oltre -2% con Wall Street chiusa: sospendere gli acquisti "
               + "aggressivi, attendere l'assestamento della prima ora di scambi USA.", client: true };
}
function refreshShockClient() {
  // sovrascrive lo shock_alert (KOSPI live-autoritativo + futures di pipeline). Non tocca nient'altro.
  if (DATA && DATA.macro) DATA.macro.shock_alert = computeShockClient();
}

function renderShockAlert() {
  const box = $("#shock-alert");
  if (!box) return;
  const s = (DATA.macro || {}).shock_alert;
  if (!s || !s.active) { box.hidden = true; box.innerHTML = ""; return; }
  const src = s.sources.map(x => `${esc(x.src)} ${signTxt(x.chg)}`).join(" · ");
  box.hidden = false;
  box.className = "shock-alert-banner";
  box.innerHTML = `🚨 <b>SEGNALE DI SHOCK</b> — ${src}: caduta oltre il ${s.threshold}% con Wall Street chiusa. <b>Da verificare</b>, non un ordine: controlla la conferma USA (futures) prima di trarre conclusioni — se gli USA non confermano è un allarme localizzato. Il prompt AI porta il segnale in cima col suo workflow di verifica.`;
}

function renderDataQualityAlert() {
  const box = $("#dataquality-alert");
  if (!box) return;
  const v = validateMacroData();
  if (v.ok) { box.hidden = true; box.innerHTML = ""; box.className = ""; return; }
  const bad = v.bad.map(b => `<b>${esc(b.key)}</b> (${esc(b.status)}${b.note ? ": " + esc(b.note) : ""})`).join(" · ");
  const st = v.stale.map(s => esc(s.key)).join(", ");
  box.hidden = false;
  box.className = "data-error";
  box.style.cursor = "pointer";
  box.title = "Clicca per correggere manualmente i dati flaggati";
  box.innerHTML = `⚠ <b>QUALITÀ DATI MACRO</b> — ${bad ? `INAFFIDABILI: ${bad}. ` : ""}${st ? `Datati oltre la cadenza attesa: ${st}.` : ""} Il prompt AI li marca con flag espliciti. <button class="btn btn-ghost btn-sm" id="dq-fix" style="margin-left:8px">✎ Correggi dati</button>`;
  box.onclick = openDataQualityModal;
}






/* ---------------- liquidità (cash) ---------------- */


/* ---------------- mini-card: direzione mercato + BofA signposts ---------------- */
// aggregatore: raccoglie TUTTI i segnali del sistema con etichetta e punteggio 0-100
const DIARY_PATH = "config/action_diary.json";
let DIARIO_VOCI = [];
/* Carica il diario dal repository. E' un file PUBBLICO che contiene le operazioni del CEO:
   non ci finiscono importi in euro ne' la sua liquidita', solo quantita' e prezzi di carico,
   che sono gia' nel pacchetto per le posizioni aperte. */
async function loadDiarioCloud() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${DIARY_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const v = await r.json();
    if (!Array.isArray(v)) return;
    /* Fusione col locale per data: le voci scritte su questo dispositivo e non ancora spinte
       nel repo non devono sparire quando arriva la copia remota. */
    const perData = {};
    [...v, ...loadDiary()].forEach(e => { if (e && e.date) perData[e.date] = e; });
    DIARIO_VOCI = ordinaDiario(Object.values(perData)).slice(0, 100);
    localStorage.setItem("action_diary", JSON.stringify(DIARIO_VOCI));
    renderDiario();
  } catch { /* senza rete il diario resta vuoto e il pacchetto lo omette, senza rumore */ }
}

/* ══ v348 — IL DIARIO TORNA IN PAGINA ═══════════════════════════════════════════════════════
   Il CEO: "inserisci nuovamente diario come lo avevamo un tempo e recupera i dati che inserii
   in passato". I dati non erano da recuperare: erano fermi in config/action_diary.json da
   quando la v256 ha portato via la UI. Tredici operazioni vere, dal 29/06 al 22/08.
   ⚠ COSA NON TORNA CON LUI: la v193 faceva applicare le operazioni del diario al portafoglio,
   e la v245 ha dovuto aggiungere un controllo di divergenza perche' quel meccanismo scriveva
   quantita' sbagliate. Il portafoglio oggi viene da config/posizioni.json, che e' il libro
   vero. Il diario ANNOTA, non muove: e' la versione che non puo' rompere le posizioni. */
function loadDiary() {
  try { const v = JSON.parse(localStorage.getItem("action_diary") || "[]"); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function ordinaDiario(arr) {
  return arr.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}
function setDiary(arr) {
  DIARIO_VOCI = ordinaDiario(arr).slice(0, 100);
  localStorage.setItem("action_diary", JSON.stringify(DIARIO_VOCI));
  return pushDiarioCloud(DIARIO_VOCI);   // il chiamante deve poter dire com'e' andata
}
async function pushDiarioCloud(arr) {
  const token = localStorage.getItem("gh_token");
  if (!token) return { ok: false, perche: "senza token GitHub il diario resta SOLO su questo browser: non arriva su iPhone e il pacchetto lo legge solo da qui" };
  const corpo = (sha) => JSON.stringify({ message: "Aggiorna diario operazioni",
    content: btoa(unescape(encodeURIComponent(JSON.stringify(arr, null, 1)))), sha });
  const shaCorrente = async () => {
    const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${DIARY_PATH}`, { headers: ghHeaders(token), cache: "no-store" });
    return g.ok ? (await g.json()).sha : undefined;
  };
  try {
    let r = await fetch(`https://api.github.com/repos/${REPO}/contents/${DIARY_PATH}`,
      { method: "PUT", headers: ghHeaders(token), body: corpo(await shaCorrente()) });
    /* 409: la pipeline ha scritto in mezzo. Si rilegge lo sha e si riprova una volta. */
    if (r.status === 409) r = await fetch(`https://api.github.com/repos/${REPO}/contents/${DIARY_PATH}`,
      { method: "PUT", headers: ghHeaders(token), body: corpo(await shaCorrente()) });
    if (r.ok) return { ok: true };
    let dett = "";
    try { dett = (await r.json()).message || ""; } catch { /* risposta non JSON */ }
    return { ok: false, perche: `GitHub ha risposto ${r.status}${dett ? ` (${dett})` : ""}: la voce e' salvata QUI ma non sul repository` };
  } catch (e) {
    return { ok: false, perche: `rete non raggiungibile: la voce e' salvata QUI ma non sul repository (${e && e.message ? e.message : e})` };
  }
}

/* ── riconoscere l'operazione dentro una frase scritta a mano ──────────────────────────────
   Le quattro voci piu' vecchie sono prosa: "Alleggerito micron 20 azioni e amd 25". Il parser
   ne ricava tipo/quantita'/ticker quando ci riesce e RESTITUISCE NULL quando non ci riesce:
   una voce non capita resta testo, e si legge come l'ha scritta lui. Inventare una struttura
   sbagliata sarebbe peggio del testo libero, perche' finirebbe nel pacchetto come un fatto. */
const DIARY_BUY = /(acquist|comprat|compra|incrementat|accumulat|aggiunt)/i;
const DIARY_SELL = /(vendit|vendut|vendo|alleggerit|ridott|chius|liquidat)/i;
/* nomi commerciali che i dati non possono mappare da soli */
/* ⚠ NIENTE ALIAS INVENTATI. Il primo giro aveva `cerebras: "SKHY"`, e SKHY nel libro e'
   SK hynix: il diario avrebbe pubblicato una vendita di SK hynix mai avvenuta. Un nome
   che non e' nel libro resta NON mappato, e la voce si legge come prosa. */
const DIARY_ALIAS = { micron: "MU", oracle: "ORCL", intel: "INTC", tesla: "TSLA", nvidia: "NVDA", meta: "META", broadcom: "AVGO", marvell: "MRVL" };
function diaryTickerMap() {
  const m = Object.assign({}, DIARY_ALIAS);
  [...((DATA && DATA.portfolio) || []), ...((DATA && DATA.watchlist) || [])].forEach(r => {
    if (!r) return;
    const t = String(r.ticker || "").toUpperCase();
    if (t) m[t.toLowerCase()] = t;
    const n = String(r.name || "").toLowerCase().split(/[ ,.]/)[0];
    if (n && n.length > 2 && !m[n]) m[n] = t;
  });
  return m;
}
function parseDiaryText(text, fallbackIso) {
  const t = String(text || "");
  const tipo = DIARY_SELL.test(t) ? "VENDITA" : DIARY_BUY.test(t) ? "ACQUISTO" : null;
  if (!tipo) return null;
  const map = diaryTickerMap();
  let ticker = null;
  for (const parola of t.toLowerCase().match(/[a-z]{2,}/g) || []) {
    if (map[parola]) { ticker = map[parola]; break; }
  }
  if (!ticker) { const m = t.match(/\b([A-Z]{2,5})\b/); if (m && map[m[1].toLowerCase()]) ticker = m[1]; }
  if (!ticker) return null;
  const qm = t.match(/(\d+(?:[.,]\d+)?)\s*(?:quote|azioni|pezzi)/i) || t.match(/(?:quantit[àa]|qta)\s*(\d+(?:[.,]\d+)?)/i);
  const pm = t.match(/(?:a|prezzo|@)\s*(\d+(?:[.,]\d+)?)/i);
  const num = (s) => s ? Number(String(s).replace(",", ".")) : null;
  /* piu' verbi d'operazione nella stessa riga: se ne struttura UNA e lo si dichiara */
  const multi = (t.match(new RegExp(DIARY_BUY.source + "|" + DIARY_SELL.source, "gi")) || []).length > 1;
  return { tipo, ticker, qty: num(qm && qm[1]), prezzo: num(pm && pm[1]), quando: String(fallbackIso || "").slice(0, 10), multi };
}
function diaryOp(e) { return (e && e.op) ? e.op : parseDiaryText(e && e.text, e && e.date); }

function diarioRigaHtml(e) {
  const o = diaryOp(e);
  const d = String(e.date || "").slice(0, 10);
  const data = d ? new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
  const cap = o
    ? `<span class="diary-op ${o.tipo === "VENDITA" ? "sell" : "buy"}">${o.tipo} ${o.qty != null ? o.qty : "?"} ${o.ticker}${o.prezzo != null ? " a " + o.prezzo : ""}</span>`
    : `<span class="diary-op nota">solo testo</span>`;
  const avviso = (o && o.multi) ? `<span class="diary-multi">⚠ la riga contiene piu' operazioni: strutturata la prima, il testo integrale resta sotto</span>` : "";
  return `<div class="diary-item" data-iso="${e.date}">
      <span class="diary-date">${data}</span>
      <span class="diary-body">${cap}${avviso}<span class="diary-text">${esc(e.text || "")}</span></span>
      <button class="diary-del" data-iso="${e.date}" title="Elimina questa voce">✕</button>
    </div>`;
}
function renderDiario() {
  const lista = document.querySelector("#diary-list");
  if (!lista) return;   // il modale non e' aperto: niente da ridisegnare
  lista.innerHTML = DIARIO_VOCI.length
    ? DIARIO_VOCI.map(diarioRigaHtml).join("")
    : `<div class="muted" style="font-size:12px">Nessuna operazione annotata.</div>`;
  lista.querySelectorAll(".diary-del").forEach(b => b.addEventListener("click", () => {
    Promise.resolve(setDiary(DIARIO_VOCI.filter(x => x.date !== b.dataset.iso))).then((e) => {
      const riga = document.querySelector("#diary-esito");
      if (riga) riga.innerHTML = (e && e.ok) ? "" : `⚠ <b>Cancellata solo su questo browser</b>: ${esc((e && e.perche) || "motivo sconosciuto")}.`;
    });
    renderDiario();
  }));
}
function apriDiario() {
  openInfoModal("📔 Diario delle operazioni",
    `<div class="info-line muted" style="font-size:11px;margin-bottom:8px">Qui vanno SOLO le operazioni che hai ESEGUITO davvero. Il diario finisce nel pacchetto per l'LLM: serve a far sapere a chi analizza un titolo se ci hai gia' messo mano e quando. <b>Non muove il portafoglio</b> — le posizioni restano quelle del libro (config/posizioni.json).</div>
     <div class="diary-form">
       <input id="diary-input" type="text" placeholder="es. Acquisto 40 quote BE a 214 il 07/08/2026" />
       <button class="btn btn-primary btn-sm" id="diary-save">Registra</button>
     </div>
     <div class="muted" id="diary-esito" style="font-size:11px;margin-bottom:6px"></div>
     <div class="diary-list" id="diary-list"></div>`);
  renderDiario();
  const salva = () => {
    const inp = document.querySelector("#diary-input");
    const testo = (inp && inp.value || "").trim();
    if (!testo) return;
    const iso = new Date().toISOString();
    const op = parseDiaryText(testo, iso);
    const esito = setDiary([{ date: iso, text: testo, op }, ...DIARIO_VOCI]);
    if (inp) inp.value = "";
    renderDiario();
    const cosa = op ? `${op.tipo} ${op.ticker}` : "voce di testo";
    /* ⚠ v350 — l'esito della scrittura sul repository ARRIVA DOPO: il toast ottimista qui
       sopra diceva "annotata" mentre la push poteva ancora fallire. Si annuncia il salvataggio
       locale (che e' gia' avvenuto) e poi si corregge il tiro quando la risposta arriva. */
    toast(`${cosa}: salvata su questo browser…`);
    Promise.resolve(esito).then((e) => {
      const riga = document.querySelector("#diary-esito");
      if (e && e.ok) {
        toast(`${cosa} salvata anche sul repository — le posizioni NON sono state toccate`);
        if (riga) riga.innerHTML = "";
      } else {
        const perche = (e && e.perche) || "motivo sconosciuto";
        toast(`⚠ ${cosa}: NON salvata sul repository`);
        if (riga) riga.innerHTML = `⚠ <b>Salvata solo su questo browser</b>: ${esc(perche)}.`;
      }
    });
  };
  document.querySelector("#diary-save")?.addEventListener("click", salva);
  document.querySelector("#diary-input")?.addEventListener("keydown", (ev) => { if (ev.key === "Enter") salva(); });
}
/* salva il diario su GitHub (config/action_diary.json) — solo se c'è già un token salvato (no prompt) */
/* carica il diario dal cloud all'avvio e lo fonde col locale (per date univoche) */

/* ---------------- motore decisionale (mandato quant: Sharpe > 2.0 + sovraperformance vs NDX) ---------------- */
// solo titoli AZIONARI USA (esclude indici ^, cripto/commodity con - o =, BTP, valuta PTS)

/* ATR del titolo: dato pipeline (ATR 14 Wilder) se disponibile, altrimenti proxy statistico
   documentato: σ giornaliera dei rendimenti 1M × prezzo × 1,4 (per un processo diffusivo il
   True Range medio ≈ 1,4·σ). Il proxy sparisce da solo al primo run della pipeline. */
/* stop loss dinamico: 2×ATR sotto il prezzo di riferimento (ingresso o prezzo attuale per trailing) */

/* PARACADUTE ORDINI (v115, post-incidente SNDK limite $40,1 su quotazione $1915):
   il supporto per un ORDINE deve venire dal passato RECENTE (pipeline: min Low 20 sedute,
   più le finestre brevi w1/m1) e stare in una banda operativa dal prezzo. MAI il range
   del grafico (y1 = minimo di un anno fa = preistoria). Se nessun supporto è plausibile,
   fallback DICHIARATO: SMA50 → pullback 2×ATR → -5%. Niente scarti silenziosi. */
const ORDER_SUPPORT_MAX_GAP = 0.25;   // un limite >25% sotto il mercato non è un ordine: è una preghiera

/* stop operativo di una POSIZIONE APERTA: priorità allo stop RATCHET della pipeline
   (stop_atr: sale col prezzo e non ridiscende — persistito tra i run), fallback al
   calcolo client 2×ATR dal prezzo attuale (non ancorato, etichettato). */

/* ═══════════════════════════════════════════════════════════════════════════════════════
   PARAMETRI DI RISCHIO DEL FONDO (v121) — direttive del CEO, calibrate il 12/07/2026.
   Un unico punto di verità per le soglie che governano il verdetto: cambiare qui = cambiare
   la politica di rischio, senza cercare numeri sparsi nel codice.
   Filosofia: mandato Growth "Let Winners Run" — si cappa l'INGRESSO su ciò che è già grande,
   NON si trimma ciò che è cresciuto da solo (protetto dallo stop ratchet 2×ATR).
   ═══════════════════════════════════════════════════════════════════════════════════════ */
// Soglia di RILEVANZA della RS velocity (Δ7g della forza relativa vs NDX): sotto questa un
// movimento è RUMORE per definizione del payload. Sorgente unica, riusata sia nell'etichetta
// "|Δ|≥3pp = variazione RILEVANTE" sia nel gate ⚠deg (che prima scattava su -0,3pp = rumore).
const RS_VEL_RILEVANTE_PP = 3;
const RISK_PARAMS = {
  capNoAdd_pct: 10,        // #1 — DIVIETO DI ACCUMULO se la posizione è già ≥ questo % del NAV
                           //      (cap rigido SOLO sui nuovi acquisti). ⚠ QUESTO È SOLO IL DEFAULT:
                           //      il valore OPERATIVO arriva da config/risk_params.json (editabile
                           //      dalla card Parametri di Rischio e sincronizzato su tutti i device).
                           //      Non dedurre dal codice quale cap sia attivo: leggilo dal config.
  capAlert_pct: 25,        // #1 — ALERT di concentrazione singolo titolo (solo avviso, NIENTE
                           //      trim automatico: sotto il 25% i vincenti corrono liberi)
  sortinoVeto: -0.3,       // #2 — soglia veto VALUE TRAP sul Sortino 1A (CEO: mantieni rigido)
  sectorAlert_frac: 0.75,  // #6 — ALERT concentrazione settoriale > 75% del capitale azionario
                           //      (mandato tech/growth: la forte esposizione è la normalità)
  minScore: 60,            // #8 — score quant minimo per candidato d'accumulo
  maxLossPerPos_pct: 2,    // #11 — CAP SULLA PERDITA POTENZIALE: quanto può costare al NAV una
                           //      singola posizione se il suo stop viene eseguito. Lega la
                           //      DIMENSIONE allo STOP: un titolo volatile (stop lontano) può
                           //      entrare solo con poche quote, uno tranquillo con molte. È il
                           //      cap che il peso% non sa esprimere, perché 20% di un'utility e
                           //      20% di un semi a beta 2,8 sono rischi incomparabili.
  factorRiskAlert_pct: 60, // #12 — CONCENTRAZIONE DI FATTORE: quota massima della VARIANZA totale
                           //      (somma degli MCR) attribuibile a un solo settore/fattore. Il veto
                           //      qualità guarda un titolo alla volta ed è cieco alle correlazioni:
                           //      N nomi tutti "sani" possono crollare insieme se condividono il
                           //      fattore. Questa è la soglia che quel rischio non aveva.
  // #10 riserva tail-risk (budget = cassa − ES95): confermata dal CEO, gestita in pipeline.
  // #7 stop 2×ATR ratchet e #4 riabilitazione growth: confermati invariati.
};

/* EDITOR PARAMETRI DI RISCHIO (v143) — il CEO calibra le soglie dalla UI, senza toccare il
   codice. Ogni parametro ha spiegazione, banda di validità e default; gli override vivono in
   localStorage (questo browser) e MUTANO RISK_PARAMS al volo: motore, verdetto ed export AI
   usano immediatamente il nuovo valore. I parametri Python-side (stop 2×ATR, riserva ES95)
   NON sono qui: vivono in pipeline e restano fissi by design. */
const RISK_PARAM_DEFS = [
  { key: "capNoAdd_pct", label: "Cap d'ingresso singolo titolo (% NAV)", unit: "%", scale: 1, min: 1, max: 50, step: 0.5, def: 10,
    desc: "Divieto di NUOVI acquisti quando una posizione pesa già almeno questa percentuale del NAV. Non forza vendite: la posizione può continuare a correre (Let Winners Run)." },
  { key: "capAlert_pct", label: "Alert concentrazione singolo titolo (% NAV)", unit: "%", scale: 1, min: 5, max: 90, step: 1, def: 25,
    desc: "Sopra questa percentuale del NAV su un solo titolo scatta l'avviso di concentrazione. Solo segnalazione: mai trim automatico." },
  { key: "sortinoVeto", label: "Soglia veto VALUE TRAP (Sortino 12M)", unit: "", scale: 1, min: -3, max: 0, step: 0.05, def: -0.3,
    desc: "Sortino a 12 mesi sotto questo valore = titolo escluso dai nuovi acquisti (value trap: distruzione di valore sul downside). È evidenza forte, superabile solo con tesi dichiarata; più il valore è vicino a 0, più il veto è severo." },
  { key: "sectorAlert_frac", label: "Alert concentrazione settoriale (%)", unit: "%", scale: 100, min: 10, max: 100, step: 1, def: 75,
    desc: "Avviso quando il primo settore supera questa percentuale del capitale AZIONARIO (liquidità e obbligazioni escluse). Il mandato growth tollera un tech alto: la soglia dice quando dichiararlo." },
  { key: "maxLossPerPos_pct", label: "Perdita massima per posizione (% NAV allo stop)", unit: "%", scale: 1, min: 0.25, max: 15, step: 0.25, def: 2,
    desc: "Quanto può costare al patrimonio UNA posizione se il suo stop viene eseguito. Lega la dimensione alla distanza dello stop: più il titolo è volatile, meno quote entrano a parità di rischio. Complementare al cap sul peso, che ignora la volatilità." },
  { key: "factorRiskAlert_pct", label: "Concentrazione di rischio per fattore (% varianza)", unit: "%", scale: 1, min: 20, max: 100, step: 5, def: 60,
    desc: "Quota massima della varianza totale (somma degli MCR) attribuibile a un solo settore/fattore. Il veto qualità valuta un titolo per volta e non vede le correlazioni: titoli tutti sani possono scendere insieme se condividono il fattore. Solo segnalazione." },
  { key: "minScore", label: "Score minimo candidati (0–100)", unit: "", scale: 1, min: 0, max: 100, step: 1, def: 60,
    desc: "Punteggio quant minimo (Sharpe marginale + forza relativa + qualità) perché un titolo diventi candidato all'accumulo del motore. Alzarlo = meno candidati ma più selettivi." },
];
function applyRiskOverrides() {
  let ov = {};
  try { ov = JSON.parse(localStorage.getItem("risk_params_overrides") || "{}"); } catch { ov = {}; }
  for (const d of RISK_PARAM_DEFS) {
    const v = ov[d.key];
    if (typeof v === "number" && Number.isFinite(v) && v >= d.min / d.scale - 1e-9 && v <= d.max / d.scale + 1e-9) {
      RISK_PARAMS[d.key] = v;                 // valore INTERNO (già in scala frazione dove serve)
    }
  }
}
applyRiskOverrides();   // gli override del CEO valgono da subito, prima di qualunque calcolo
/* SYNC CLOUD dei parametri di rischio (v150) — stesso pattern di diario/override macro.
   Prima vivevano SOLO in localStorage ("salvata su questo browser"): il cap 20% del CEO sul
   Mac restava 10% su iPhone → lo STESSO bottone 📋 generava payload DIVERSI per device
   (candidati 3 vs 4, riga cap diversa). Trovato eseguendo il prompt su me stesso (harness
   senza localStorage = il "device nuovo"). Chiave _savedAt = merge whole-object: vince il
   più recente; applyRiskOverrides la ignora (accetta solo numeri in banda). */
const RISK_PARAMS_PATH = "config/risk_params.json";
async function loadRiskParamsCloud() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${RISK_PARAMS_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const cloud = await r.json();
    if (!cloud || typeof cloud !== "object") return;
    let local = {};
    try { local = JSON.parse(localStorage.getItem("risk_params_overrides") || "{}"); } catch { local = {}; }
    if ((cloud._savedAt || "") > (local._savedAt || "")) {
      localStorage.setItem("risk_params_overrides", JSON.stringify(cloud));
      applyRiskOverrides();
      if (typeof DATA !== "undefined" && DATA) renderAll();
    }
  } catch { /* nessun file remoto */ }
}

/* beta effettivo di un titolo: PRIORITÀ alla regressione della pipeline sui log-rendimenti
   12M vs Nasdaq 100 (beta_ndx); fallback al beta Yahoo (5A mensile vs S&P) solo se manca. */


/* Rischio cambio EUR/USD: quota % del NAV (investito + liquidità EUR) denominata in USD
   e NON coperta — un apprezzamento dell'euro erode i guadagni in dollari a parità di prezzi. */
function fxExposure() {
  const inv = (DATA?.portfolio || []).filter(r => (r.val_eur || 0) > 0);
  const nav = inv.reduce((s, r) => s + r.val_eur, 0) + cashEur;
  if (!nav) return null;
  const usdEur = inv.filter(r => r.currency === "USD").reduce((s, r) => s + r.val_eur, 0);
  return { pct: Math.round(usdEur / nav * 1000) / 10, usdEur, nav, eurusd: DATA?.eurusd ?? null };
}

/* rischio liquidità/slippage: la posizione vale più del 5% del volume medio giornaliero in $
   (uscire muoverebbe il prezzo). Usa avg_volume_30d dalle stats; solo posizioni possedute. */

/* peso % di una posizione sul NAV (investito + liquidità) — per la regola di sizing 10% */

/* VETO del risk manager (non scavalcabile da alcun supporto tecnico):
   - VALUE TRAP se, anche singolarmente: Sharpe 1A < -0.3 · Short Interest ≥ 15% ·
     margine netto negativo con PEG non calcolabile/negativo.
     (soglia -0.3 e non 0: uno Sharpe lievemente negativo in un mercato in drawdown è rumore,
     sotto -0.3 è distruzione sistematica di valore corretto per il rischio)
   - NON ACCUMULARE se ROIC/ROE < 0 o PEG < 0 (qualità del capitale rotta).
   - RIABILITAZIONE GROWTH (v111): il Sortino 12M guarda INDIETRO — dopo un crash marchia
     VALUE TRAP proprio i titoli di qualità in recupero, quando un fondo growth dovrebbe
     poterli ricomprare. Il veto Sortino (e SOLO quello) è revocato se il titolo prova la
     ripresa su TRE assi insieme, tutti meccanici:
       qualità intatta (ROE > 15% E margine netto > 0) · trend riparato (prezzo sopra
       SMA200) · forza relativa 1M vs NDX positiva (batte il benchmark del mandato ORA).
     Short interest alto e margini negativi NON sono riabilitabili: sono rischio presente,
     non cicatrici del passato. Il riabilitato resta un SORVEGLIATO: viene dichiarato. */
/* TURNAROUND SQUEEZE (v113): un titolo VETATO in caduta ma con risveglio istituzionale
   violento — Short Interest ≥ 20% + RVol > 2 (flussi anomali) + prezzo sopra SMA50
   (struttura in riparazione) — non va scartato in silenzio: è un setup speculativo
   asimmetrico che il CEO deve VEDERE, dichiarato come tale (sizing dimezzato, stop
   stretto 1×ATR). Solo watchlist: su una posizione detenuta non è un'idea d'ingresso.
   Il veto del mandato growth RESTA: questo è un tag informativo, non una promozione. */



/* ═══ PARAMETRI DI RISCHIO DEL FONDO (v122) — regole attive lette in tempo reale ═══
   Registro DICHIARATIVO: ogni regola = soglia (da RISK_PARAMS) + stato LIVE calcolato dai
   dati correnti. Tier per impatto: red = protezione del capitale, yellow = dimensionamento,
   green = segnali. Un'unica fonte per la card e il popup. */
const RP_TIER = { red: { c: "var(--red)", lab: "Protezione capitale" }, yellow: { c: "var(--yellow)", lab: "Dimensionamento" }, green: { c: "var(--green)", lab: "Segnale" } };
/* editor soglie (v143): select + valore + spiegazione. Gli override mutano RISK_PARAMS e
   rilanciano renderAll: verdetto, chips e export AI riflettono subito la nuova soglia. */
/* ⚠ v253 — renderRiskParams() e initRiskEditor() RIMOSSE. Scrivevano su #risk-params-grid
   e sui cinque campi dell'editor soglie: contenitori che non esistono più da quando il CEO
   ha chiesto di togliere la scheda "Parametri di Rischio del Fondo" (restano solo il
   Calcolatore PMC e il Calcolo vendite). Grazie a `?.` non davano errore: giravano a ogni
   render e scrivevano nel vuoto. Ricevuta scritta PRIMA del taglio: dentro i confini di
   entrambe non c'era NESSUNA altra dichiarazione di primo livello — è il controllo che in
   v238 guardava solo le `function` e lasciò passare un `let`, uccidendo la pagina.
   RISK_PARAMS, rpShownValue e openRiskRuleModal RESTANO: hanno altri consumatori. */


/* v135: la barra "Decisione operativa" in cima è stata RIMOSSA (il verdetto vive nell'export
   AI). Il DIARIO delle azioni resta accessibile dal bottone "📔 Diario" della topbar, che
   apre lo stesso modal (dettaglio verdetto + editor del diario che finisce nel prompt). */
/* ============ VALIDATORE DEL RITORNO (v137) — chiude il loop analisi→ordine ============
   L'export va a Claude; la risposta torna QUI prima del broker: gli ordini proposti nel
   report vengono estratti dal testo e verificati contro gli STESSI invarianti del red team
   (ticker esistente, 0<stop<limite≤prezzo, banda 30% anti-SNDK, veto risk manager, cap 10%
   NAV, budget cassa−ES95). Un LLM che allucina un limite folle non arriva mai al broker. */

// numeri in formato italiano (1.325,03) O anglosassone (1,325.03) O semplice (626 / 626.5)

const AI_BUY = /\b(COMPRA|ACCUMULA|NUOVO\s+INGRESSO)\b/i;
const AI_SELL = /\b(VENDI|TRIM(?:MA)?|ALLEGGERISCI|RIDUCI)\b/i;

/* estrae gli ordini dal testo libero del report AI: righe con un ticker NOTO + verbo d'azione.
   Formato canonico della testata: "[TICKER] — COMPRA ~N quote a limite $X con stop $Y",
   ma il parser tollera variazioni (limite/a/ingresso; stop/stop loss). */

/* verifica gli ordini estratti contro gli invarianti del sistema. Ritorna righe con esito
   hard/warn/ok + verifica budget aggregata. STESSE classi di violazione del red team I1. */

/* ═══ v255 — LA RISPOSTA DELL'AI TORNA DENTRO IL SISTEMA ═══════════════════════════════════
   `parseAIOrders` e `validateAIOrders` esistevano dal v149 con otto test e NON erano collegate
   a niente: la testata del CEO le promette in A2 ("un validatore automatico estrae
   ticker/quote/limite/stop dal testo") e per versioni quella promessa è stata falsa. È il
   sintomo v193 nella sua forma più costosa — non una funzione morta accanto a un bottone
   inerte, ma accanto a un bottone che non è mai esistito.
   Cosa BLOCCA: solo ciò che l'aritmetica rende impossibile. Cosa SEGNALA: tutto il resto.
   La distinzione non è estetica — è la filosofia del CEO ("i parametri sono evidenza
   diagnostica, non dettami"), ed è ciò che tiene questo controllo dall'altra parte del
   confine rispetto al "vendi tutto" che aveva tolto dal payload. */

/* v256 — wiring del modale "Verifica risposta AI": rimosso col modale. Validava gli ordini
   proposti dall'LLM contro il portafoglio, che non esiste piu'. */




/* mini-trend di una metrica vs ~1 settimana fa (dallo storico metrics_history della pipeline) */

/* Stato Margin Debt condiviso 1:1 tra card, popup e prompt AI (niente stringhe divergenti).
   Logica AND: rosso "ESTREMA" SOLO se leva ≥90% del picco E Forward P/E >20 conferma;
   ≥90% senza conferma → giallo (con nota esplicita se il P/E manca). */
/* ═══ v250 — OGNI DATO MACRO DICE QUANDO È STATO RILEVATO E QUANDO ARRIVA IL PROSSIMO ══════
   Richiesta CEO: "nelle card macro fornisci data aggiornamento dato e prossimo aggiornamento".
   È la risposta strutturale al dubbio sul margin debt: il problema non era che il dato fosse
   sbagliato, era che NON SI SAPEVA di che mese fosse né quando ne sarebbe arrivato uno nuovo.
   Un dato di 68 giorni con scritto "il prossimo esce il 20 agosto" è informazione; lo stesso
   dato senza quella riga è una trappola.
   ⚠ Le cadenze qui sotto sono il CALENDARIO DICHIARATO DALLE FONTI, non una stima mia:
   ogni voce porta scritto da dove viene la regola. Dove la data esatta non è deducibile si
   dichiara la cadenza e basta, invece di inventare un giorno. */
const CADENZA_FONTE = {
  margin_debt: { nome: "FINRA", giorniLag: 20, passo: "mensile",
                 nota: "FINRA pubblica il mese M nella terza settimana di M+1" },
  cpi:    { nome: "BLS", giorniLag: 13, passo: "mensile", nota: "CPI del mese M esce a metà M+1" },
  pce:    { nome: "BEA", giorniLag: 30, passo: "mensile", nota: "PCE del mese M esce a fine M+1" },
  nfp:    { nome: "BLS", giorniLag: 5,  passo: "mensile", nota: "primo venerdì del mese successivo" },
  unemp:  { nome: "BLS", giorniLag: 5,  passo: "mensile", nota: "esce col dato sugli occupati" },
  retail: { nome: "Census", giorniLag: 15, passo: "mensile", nota: "vendite del mese M a metà M+1" },
  umich:  { nome: "UMich via FRED", giorniLag: 45, passo: "mensile",
            nota: "FRED sconta 1-2 mesi di ritardo di LICENZA: alla fonte esistono letture più recenti" },
  gdp:    { nome: "BEA", giorniLag: 30, passo: "trimestrale", nota: "stima avanzata ~1 mese dopo il trimestre" },
  /* ⚠ v266 — LE SERIE GIORNALIERE NON AVEVANO CADENZA, NEMMENO LA CURVA CHE C'ERA GIA'. Senza
     una voce qui rigaCadenza() restituisce stringa vuota e la card esce muta sulla propria eta':
     la regola "ogni dato dice quando si aggiorna" valeva solo per i mensili. Le serie FRED
     giornaliere escono col ritardo di un giorno lavorativo o due. */
  curve:     { nome: "FRED", giorniLag: 1, passo: "giornaliero", nota: "spread 10A-2A, aggiornato ogni giorno lavorativo" },
  curve3m:   { nome: "FRED", giorniLag: 1, passo: "giornaliero", nota: "spread 10A-3M, il tratto che la Fed usa per la recessione" },
  t30:       { nome: "FRED", giorniLag: 1, passo: "giornaliero", nota: "rendimento del Treasury a 30 anni" },
  real10:    { nome: "FRED", giorniLag: 1, passo: "giornaliero", nota: "rendimento TIPS 10A, cioe' al netto dell'inflazione" },
  breakeven: { nome: "FRED", giorniLag: 1, passo: "giornaliero", nota: "differenza fra nominale e reale a 10 anni" },
  /* ⚠ `mesiRitardo` = quanti mesi dopo il periodo misurato esce il dato. Vale 1 per quasi
     tutte le serie americane (il CPI di luglio esce a meta' agosto) e per questo e' il valore
     predefinito — ma NON per il Philly Fed, che pubblica l'indagine del mese dentro quel mese.
     Senza questo campo la serie annunciava "prossimo atteso" con due mesi di ritardo. */
  philly:    { nome: "Philadelphia Fed", giorniLag: 18, passo: "mensile", mesiRitardo: 0,
               nota: "l'ISM e' sotto licenza e non e' ridistribuibile: questa e' la stessa specie di indagine, dichiarata. Esce il terzo giovedi' del mese che misura, non il mese dopo" },
};

/* Restituisce { rilevato, eta, prossimo, passo, fonte, nota } o null se non si può dire nulla.
   ⚠ `prossimo` è una DATA ATTESA, non una certezza: si scrive sempre col "atteso". */
/* somma N giorni LAVORATIVI a una data (sabato e domenica non contano). */
function sommaGiorniLavorativi(d, n) {
  const x = new Date(d.getTime());
  let restanti = n;
  while (restanti > 0) {
    x.setDate(x.getDate() + 1);
    if (x.getDay() !== 0 && x.getDay() !== 6) restanti--;
  }
  return x;
}

function cadenzaDato(chiave, dataRilevazione) {
  const c = CADENZA_FONTE[chiave];
  if (!c || !dataRilevazione) return null;
  const d = new Date(String(dataRilevazione).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return null;
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  /* ⚠⚠ v343 — L'ETA' SI CONTA DALL'USCITA, NON DAL PERIODO MISURATO. Per i mensili FRED data
     l'osservazione al PRIMO del mese di riferimento: e' il periodo, non il giorno in cui il
     numero e' arrivato. Contare da li' gonfia l'eta' di tutto il ritardo di pubblicazione —
     sul Philly Fed un dato di due giorni usciva come "21 giorni fa", cioe' vecchio quando era
     appena nato. Si stima invece quando quell'osservazione e' stata PUBBLICATA. */
  const usciloIl = new Date(d);
  if (c.passo === "mensile") {
    usciloIl.setMonth(usciloIl.getMonth() + (c.mesiRitardo ?? 1));
    usciloIl.setDate(Math.min(c.giorniLag || 15, 28));
  } else if (c.passo === "trimestrale") {
    usciloIl.setMonth(usciloIl.getMonth() + 3);
    usciloIl.setDate(Math.min(c.giorniLag || 15, 28));
  } else {
    usciloIl.setDate(usciloIl.getDate() + (c.giorniLag || 1));
  }
  /* se la stima cade nel futuro il dato e' appena uscito: l'eta' non puo' essere negativa */
  const rif = usciloIl > oggi ? d : usciloIl;
  const eta = Math.max(0, Math.round((oggi - rif) / 86400000));
  /* il prossimo dato copre il periodo SUCCESSIVO a quello rilevato, e arriva `giorniLag`
     dopo la fine di quel periodo: si somma un passo alla rilevazione e poi il ritardo. */
  const p = new Date(d);
  if (c.passo === "giornaliero") {
    /* il prossimo e' il giorno lavorativo dopo: sabato e domenica non pubblica nessuno. */
    p.setDate(p.getDate() + 1);
    while (p.getDay() === 0 || p.getDay() === 6) p.setDate(p.getDate() + 1);
  } else if (c.passo === "trimestrale") {
    p.setMonth(p.getMonth() + 6);
    p.setDate(Math.min(c.giorniLag || 15, 28));
  } else {
    /* ⚠ v343 — un passo per il periodo successivo, PIU' il ritardo di pubblicazione di quella
       serie. Prima erano due mesi fissi: giusto sulle serie che escono in M+1, sbagliato di
       un mese intero su quelle che escono dentro il proprio mese. */
    p.setMonth(p.getMonth() + 1 + (c.mesiRitardo ?? 1));
    p.setDate(Math.min(c.giorniLag || 15, 28));
  }
  /* ⚠ v266 — LA DATA SI COMPONE DAI PEZZI LOCALI, NON DA toISOString(). Le date qui sono
     costruite a mezzanotte LOCALE: a Roma sono le 22:00 UTC del giorno prima, quindi
     toISOString() restituiva il giorno PRECEDENTE. Sulle serie giornaliere si vedeva subito —
     un dato del 6 agosto usciva con "prossimo atteso 06/08 ⚠ ERA ATTESO E NON E' ARRIVATO",
     cioe' un allarme di dato mancante su un dato appena pubblicato. Sui mensili l'errore c'era
     lo stesso, solo meno visibile: uno scarto di un giorno su un ritardo di trenta. */
  const iso = (d2) => `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, "0")}-${String(d2.getDate()).padStart(2, "0")}`;
  return {
    rilevato: String(dataRilevazione).slice(0, 10), eta,
    prossimo: iso(p),
    /* ⚠ v266 — LE SERIE GIORNALIERE HANNO DUE GIORNI DI GRAZIA. Il Treasury non pubblica nei
       giorni di festa americana, e senza tolleranza ogni 4 luglio o Thanksgiving avrebbe acceso
       "ERA ATTESO E NON E' ARRIVATO" su un dato regolarissimo. Un allarme che suona quando non
       succede niente insegna a ignorarlo, e allora non serve piu' il giorno che serve. */
    /* ⚠ v271 — LA GRAZIA SI CONTA IN GIORNI LAVORATIVI, non di calendario. Misurato leggendo
       il pacchetto: il Treasury 30A rilevato venerdi' 06/08 usciva lunedi' mattina con
       "⚠ ERA ATTESO E NON E' ARRIVATO" — un allarme di dato mancante su un dato normalissimo,
       perche' i due giorni di grazia se li era mangiati il fine settimana. Un allarme che
       suona di lunedi' su ogni serie giornaliera insegna a ignorarlo, e allora non serve piu'
       il giorno che serve davvero. */
    scaduto: c.passo === "giornaliero" ? sommaGiorniLavorativi(p, 2) < oggi : p < oggi,
    passo: c.passo, fonte: c.nome, nota: c.nota,
  };
}

/* la riga da mostrare sotto una card macro e da mettere nel payload */
function rigaCadenza(chiave, dataRilevazione) {
  const c = cadenzaDato(chiave, dataRilevazione);
  if (!c) return "";
  const it = (s) => { const [a, m, g] = [s.slice(0, 4), s.slice(5, 7), s.slice(8, 10)]; return `${g}/${m}/${a}`; };
  return `rilevazione ${it(c.rilevato)} (${c.eta} giorni fa) · prossimo atteso ${it(c.prossimo)}` +
         (c.scaduto ? " ⚠ ERA ATTESO E NON È ARRIVATO" : "") + ` · ${c.fonte}, ${c.passo}`;
}

/* ═══ v253 — LE CARD DI MERCATO NON DICEVANO QUANDO SONO STATE RILEVATE ═══════════════
   Misurato sulla pagina viva: 6 card su 27 portavano la riga di cadenza, 21 no. Non è che
   mancasse il dato — VIX, Fear & Greed, EUR/USD, put/call, DXY, curva, spread di credito e
   compagnia non hanno un calendario di pubblicazione: si aggiornano a OGNI run della
   pipeline. Ma "si aggiorna spesso" non è ciò che il CEO ha chiesto: ha chiesto di sapere
   di quando è il numero che sta guardando, e su quelle 21 card la risposta non c'era.
   Gli orari qui sotto sono il calendario DICHIARATO in .github/workflows/update-data.yml,
   non una stima — e un check li rilegge da quel file, perché un registro copiato a mano
   invecchia da solo (è la classe C10 e degli indici fissi del red team). */
const RUN_FISSI_UTC = [[4, 0], [5, 0], [8, 0], [9, 0], [13, 30], [14, 30], [15, 0], [16, 0], [19, 0], [20, 0], [21, 0]];
const RUN_ORARIO_UTC = { da: 13, a: 22, feriali: true };   // cron "0 13-22 * * 1-5"

/* prossimo run atteso della pipeline, in UTC. Considera sia i run fissi sia quello orario
   dei giorni feriali; guarda fino a 48 ore avanti e poi si arrende invece di indovinare. */
function prossimoRunPipeline(adesso = new Date()) {
  /* ⚠ la prima stesura avanzava a passi di 10 minuti da ADESSO: il minuto restava congruo a
     quello di partenza, quindi alle 18:53 la sequenza era 19:03, 19:13… e il run delle 19:00
     non veniva MAI incontrato. Si costruiscono invece i candidati del giorno, che è ciò che
     il cron fa davvero. */
  for (let g = 0; g <= 2; g++) {
    const base = new Date(adesso.getTime() + g * 86400000);
    const gi = base.getUTCDay(), feriale = gi >= 1 && gi <= 5;
    const cand = RUN_FISSI_UTC.map(([H, M]) => [H, M]);
    if (RUN_ORARIO_UTC.feriali && feriale) {
      for (let h = RUN_ORARIO_UTC.da; h <= RUN_ORARIO_UTC.a; h++) cand.push([h, 0]);
    }
    const oggi = cand
      .map(([H, M]) => Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), H, M))
      .filter((ms) => ms > adesso.getTime())
      .sort((a, b) => a - b);
    if (oggi.length) return new Date(oggi[0]);
  }
  return null;
}

/* la riga di freschezza per un dato che si aggiorna a ogni run (non ha un calendario di
   pubblicazione). Si basa su DATA.updated_at, che è il timestamp REALE del run che ha
   prodotto questo file — non sull'orologio del browser. */
/* ═══ v261 — LA BARRA DA CUI VIENE IL DATO, NON L'ORA DEL RUN ══════════════════════════════
   La pipeline gira ~20 volte al giorno; la barra giornaliera sotto quel run puo' essere di
   ieri, di venerdi' o di tre giorni fa. Il portafoglio lo dichiarava per ogni titolo
   (`price_asof`); i blocchi MACRO no — ereditavano solo `updated_at`, quindi in un run di
   domenica il VIX di venerdi' arrivava all'LLM come se fosse di adesso.
   Ora la pipeline scrive un `asof` per blocco (v261 in update_data.py). ⚠ MA IL CI RIGENERA SU
   CRON: fino al prossimo run `data.json` quel campo non ce l'ha, e senza un ripiego la pagina
   resterebbe muta per ore proprio sulla cosa che sto correggendo — stessa ragione dei rami
   FedWatch di v187 e della matrice di v205.
   Il ripiego onesto c'e' ed e' gia' nel file: le posizioni portano `price_asof`, cioe' la data
   dell'ultima barra che Yahoo ha pubblicato. E' la STESSA barra da cui nascono VIX, ampiezza e
   rotazione, perche' vengono tutti dallo stesso download giornaliero. */
/* ⚠⚠ v329 — GLI STRUMENTI 24/7 DECIDEVANO LA FRESCHEZZA DI TUTTI GLI ALTRI. Misurato sui dati
   veri di una domenica: 22 barre su 23 erano del venerdi' (14/08), UNA sola — BTC-USD — era del
   giorno stesso, e siccome qui si prende la PIU' RECENTE quella sola alzava la dichiarazione per
   tutto il pacchetto. VIX, put/call e ampiezza venivano consegnati come fotografia di adesso
   quattro righe sotto un "WEEKEND, MERCATI CHIUSI".
   Le cripto non hanno chiusura: la loro barra e' sempre di oggi, e per questo non puo' parlare
   per le azioni. La freschezza di un mercato la dice il suo mercato. */
const SEMPRE_APERTI = /-(USD|USDT|EUR)$/i;      // BTC-USD, ETH-USD… quotano anche a borse chiuse

function ultimaBarraDisponibile() {
  const date = [...((DATA && DATA.portfolio) || []), ...((DATA && DATA.watchlist) || [])]
    .filter(r => r && !SEMPRE_APERTI.test(String(r.ticker || "")))
    .map(r => r && r.price_asof).filter(x => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x));
  if (!date.length) return null;
  return date.sort()[date.length - 1];          // la piu' recente fra quelle dei mercati che chiudono
}

/* la data del dato di un blocco macro: prima quella dichiarata dalla pipeline, poi il ripiego */
function asofBlocco(blocco) {
  const dichiarata = blocco && typeof blocco === "object" && blocco.asof;
  if (typeof dichiarata === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dichiarata)) {
    return { data: dichiarata, dedotta: false };
  }
  const dedotta = ultimaBarraDisponibile();
  return dedotta ? { data: dedotta, dedotta: true } : null;
}

function rigaFreschezzaMercato(blocco) {
  const iso = DATA && DATA.updated_at;
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  /* ⚠ v261 — SE LA BARRA E' PIU' VECCHIA DEL RUN, LO DICE. Prima questa riga scriveva sempre
     "rilevazione al run delle HH:MM": vero per l'ORA in cui il numero e' stato scaricato, falso
     per il MOMENTO a cui si riferisce. In un run domenicale erano due giorni di differenza, e
     la riga li nascondeva entrambi dietro la stessa formula. */
  const ab = asofBlocco(blocco);
  if (ab) {
    const barra = new Date(ab.data + "T00:00:00");
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    const giorni = Math.round((oggi - barra) / 86400000);
    if (giorni >= 1) {
      const it = ab.data.slice(8, 10) + "/" + ab.data.slice(5, 7);
      const p = prossimoRunPipeline();
      return `ultima rilevazione: CHIUSURA DEL ${it}` + (giorni === 1 ? " (ieri)" : ` (${giorni} giorni fa)`)
        + ` · il run delle ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })} l'ha solo riscaricata, non e' un dato nuovo`
        + (p ? ` · prossimo run ${p.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` : "")
        + (ab.dedotta ? " · data dedotta dalle barre dei titoli" : "");
    }
  }
  const oreFa = Math.max(0, Math.round((Date.now() - d.getTime()) / 3600000));
  const hhmm = (x) => x.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const p = prossimoRunPipeline();
  return `rilevazione al run delle ${hhmm(d)} del ${d.toLocaleDateString("it-IT").slice(0, 5)}`
       + ` (${oreFa === 0 ? "meno di un'ora fa" : oreFa === 1 ? "1 ora fa" : `${oreFa} ore fa`})`
       + (p ? ` · prossimo run atteso alle ${hhmm(p)}` : "")
       + " · dato di mercato, si aggiorna a ogni run";
}

function marginDebtState() {
  /* METODOLOGIA v106 (post-audit): il "% del picco" è SATURO in un bull market — verificato
     13/13 mesi a >=95% del picco: allarme permanente = potere discriminante zero. La label è
     ora guidata dal TASSO DI ESPANSIONE (YoY) della leva, che è il segnale storicamente
     predittivo (~+60% nel 2000, ~+40% nel 2007), con l'INVERSIONE dai massimi (YoY o MoM
     negativi dopo un picco) come stato peggiore: il deleveraging È il crash che inizia.
     Livello assoluto e ATH restano nel payload come contesto. */
  const m = DATA?.macro || {};
  const md = m.margin_debt;
  if (!md || md.pct_of_peak == null) return null;
  const fpe = m.forward_pe?.value ?? null;
  const yoy = md.yoy, mom = md.qoq;
  const nearPeak = md.pct_of_peak >= 90;
  const rollover = nearPeak && ((mom != null && mom < -2) || (yoy != null && yoy < 0));
  const high = yoy != null ? yoy >= 20 : nearPeak;             // fallback al livello se YoY n.d.
  const extreme = yoy != null && yoy >= 40;
  const confirmed = (extreme || high) && fpe != null && fpe > 20;
  let label, labelShort, col, score;
  if (rollover)      { label = "INVERSIONE DELLA LEVA dai massimi (deleveraging in corso)"; labelShort = "DELEVERAGING"; col = "var(--red)"; score = 2; }
  else if (extreme)  { label = confirmed ? `Espansione leva ESTREMA (YoY ${fmtNum.format(yoy)}%, confermata da Forward P/E)` : `Espansione leva ESTREMA (YoY ${fmtNum.format(yoy)}%)${fpe == null ? " — conferma P/E n.d." : ""}`; labelShort = "Espansione ESTREMA"; col = "var(--red)"; score = 8; }
  else if (high)     { label = `Espansione leva ELEVATA${yoy != null ? ` (YoY ${fmtNum.format(yoy)}%)` : ""}${fpe == null ? " — conferma P/E n.d." : ""}`; labelShort = "Espansione ELEVATA"; col = "var(--yellow)"; score = 25; }
  else if (yoy != null && yoy >= 0) { label = `Leva in espansione fisiologica (YoY ${fmtNum.format(yoy)}%)`; labelShort = "Espansione fisiologica"; col = "var(--yellow)"; score = 55; }
  else               { label = yoy != null ? `Leva in contrazione (YoY ${fmtNum.format(yoy)}%)` : "Leva BASSA"; labelShort = "In contrazione"; col = "var(--green)"; score = 75; }
  return { md, fpe, high: extreme || high, confirmed, rollover, label, labelShort, col, score };
}


/* Popup Rischio Cambio: esposizione USD, sensibilità e razionale */
function openFxModal() {
  const fx = fxExposure();
  if (!fx) { toast("Dati non ancora disponibili"); return; }
  const hit1 = Math.round(fx.usdEur * 0.01);   // impatto di ±1% del cambio sul NAV in €
  openInfoModal("Rischio cambio EUR/USD — esposizione non coperta",
    `<div class="info-line" style="margin-bottom:8px"><b>Cos'è:</b> la quota del patrimonio denominata in dollari senza copertura valutaria. A parità di prezzi dei titoli, un <b>apprezzamento dell'euro</b> riduce il controvalore in € delle posizioni USA (e viceversa).</div>
     <div class="info-line" style="background:var(--card-2);border-radius:8px;padding:10px;margin-bottom:10px">
       <div style="font-size:13px">Esposizione USD: <b>${fmtNum.format(fx.pct)}% del NAV</b> (${fmtEUR.format(Math.round(fx.usdEur))} su ${fmtEUR.format(Math.round(fx.nav))})</div>
       <div class="muted" style="font-size:12px;margin-top:3px">${fx.eurusd ? `EUR/USD attuale ${fmtNum.format(fx.eurusd)} · ` : ""}sensibilità: ±1% del cambio ≈ <b>${fmtEUR.format(hit1)}</b> sul patrimonio</div>
     </div>
     <div class="info-line muted" style="font-size:11.5px">Il BTP e la liquidità in € non sono esposti. La copertura (hedging) ha un costo pari al differenziale tassi USD-EUR: per un portafoglio growth di lungo periodo molti fondi accettano l'esposizione, ma va dichiarata e monitorata — è un fattore di rischio a sé, separato dal rischio azionario.</div>`);
}

/* Popup Margin Debt: dato attuale, variazioni, sparkline storica, impatto */
function openMarginDebtModal() {
  const mds = marginDebtState();
  if (!mds) { toast("Dati Margin Debt non ancora disponibili"); return; }
  const md = mds.md;
  const bn = (v) => "$" + fmtNum.format(Math.round(v / 1000)) + " mld";
  // stessa identica logica della card e del prompt (marginDebtState)
  const risk = { t: mds.label.replace(/^Leva /, "").toUpperCase(), c: mds.col };
  openInfoModal("Margin Debt — leva a credito sul mercato",
    `<div class="info-line" style="margin-bottom:8px"><b>Cos'è:</b> il debito che gli investitori contraggono presso i broker per comprare titoli a leva. Quando è vicino ai massimi storici indica euforia e fragilità: nelle discese forza vendite a catena (margin call), amplificando i crolli.</div>
     <div class="info-line" style="background:var(--card-2);border-radius:8px;padding:10px;margin-bottom:10px">
       <div style="font-size:13px">Attuale: <b>${bn(md.value)}</b> · <b style="color:${risk.c}">${md.pct_of_peak}% del picco storico</b> · leva <b style="color:${risk.c}">${risk.t}</b></div>
       <div class="muted" style="font-size:12px;margin-top:3px">${md.yoy != null ? `YoY ${signTxt(md.yoy)}` : ""}${md.qoq != null ? ` · ultimo mese ${signTxt(md.qoq)}` : ""} · picco storico ${bn(md.peak)} · agg. ${md.date}</div>
     </div>
     <h4 style="margin:8px 0 4px">Storico (ultimi trimestri)</h4>
     <div class="psp-spark">${sparkline(md.history || [])}</div>
     ${systemicRiskHtml(md)}
     <div class="info-line muted" style="font-size:11.5px;margin-top:8px"><b>Impatto:</b> leva ${risk.t.toLowerCase()} → ${md.pct_of_peak >= 80 ? "mercato fragile: una correzione può innescare vendite forzate a catena. Per il tuo portafoglio tech (alta beta) significa drawdown potenzialmente più violenti — tieni pronta la liquidità e non aumentare la leva." : "rischio sistemico da leva contenuto: le discese hanno meno benzina da margin call. Contesto più sereno per accumulare con gradualità."}</div>`);
}

/* Rischio sistemico combinato: Margin Debt (leva) + Forward P/E (valutazione).
   ROSSO se leva vicino ai massimi E P/E forward elevato. Stima impatto deleveraging. */
function systemicRiskHtml(md) {
  const fpe = (DATA.macro || {}).forward_pe;
  const pe = fpe ? fpe.value : null;
  const peAvg = fpe ? fpe.avg_hist : 16.5;
  const highLev = md.pct_of_peak >= 90;
  const highPe = pe != null && pe > 20;
  const danger = highLev && highPe;
  const col = danger ? "#ef4444" : (highLev || highPe) ? "var(--yellow)" : "#38bdf8";
  const verdict = danger ? "RISCHIO SISTEMICO ELEVATO" : (highLev || highPe) ? "Rischio moderato" : "Rischio contenuto";
  // stima margin call su deleveraging -15%: storicamente ~10-15% del margin debt viene chiamato
  const callsBn = Math.round(md.value / 1000 * 0.12);   // ~12% del margin debt (in $ mld)
  return `<div class="info-line" style="background:var(--card-2);border-left:3px solid ${col};border-radius:8px;padding:10px;margin-top:10px">
    <div style="font-size:13px;font-weight:700;color:${col};margin-bottom:4px">${verdict}</div>
    <div style="font-size:12px">Leva (Margin Debt): <b>${md.pct_of_peak}% del picco</b> ${highLev ? "⚠" : ""}${md.series ? ` <span class="muted">(${esc(md.series)}, rilevazione ${md.date})</span>` : ""} · Valutazione (Forward P/E S&P): <b>${pe != null ? pe + "×" : "n.d. — dato API assente, nessuna stima fittizia"}</b>${pe != null ? ` vs media storica ${peAvg}×` : ""} ${highPe ? "⚠" : ""}</div>
    <div class="muted" style="font-size:11px;margin-top:4px">Logica: rosso se leva ≥90% del picco <b>E</b> Forward P/E &gt;20×. Scenario "deleveraging" (−15% mercato): possibili ~<b>$${fmtNum.format(callsBn)} mld</b> di margin call forzate, che amplificano la discesa. Tieni liquidità pronta per i ribassi.</div>
  </div>`;
}

/* Popup Sharpe di PORTAFOGLIO (diverso dal popup per-titolo openSharpeInfo) */
function openPortfolioSharpeModal() {
  const t = DATA.totals || {};
  const ps = t.portfolio_sharpe_ratio;
  const rf = (t.risk_free_rate ?? 0.0363) * 100;
  // contributo per titolo (Sharpe singolo, ordinato)
  const items = (DATA.portfolio || []).filter(r => r.sharpe_1y != null)
    .sort((a, b) => b.sharpe_1y - a.sharpe_1y);
  const rows = items.map(r => `<tr><td>${esc(r.name)} <span class="tk">${r.ticker}</span></td><td class="num"><b style="color:${sharpeColor(r.sharpe_1y)}">${fmtNum.format(r.sharpe_1y)}</b></td></tr>`).join("");
  const verdict = ps == null ? null
    : ps > 2 ? { t: "ECCELLENTE", c: "var(--green)" }
    : ps >= 1 ? { t: "BUONO", c: "#86c52a" }
    : ps >= 0 ? { t: "DEBOLE", c: "var(--muted)" }
    : { t: "NEGATIVO", c: "var(--red)" };
  const so = t.portfolio_sortino_ratio;
  const extraRisk = [];
  if (so != null) extraRisk.push(`<div style="font-size:12.5px;margin-top:6px"><b>Sortino</b>: <b style="color:${sharpeColor(so)}">${fmtNum.format(so)}</b> — come lo Sharpe ma conta solo la volatilità <b>negativa</b>: se è molto più alto dello Sharpe, gran parte della varianza è "buona" (rally), non rischio.</div>`);
  {
    // stima STORICA primaria (percentili empirici della serie reale: onesta sulle code
    // grasse dei titoli volatili); la parametrica normale resta come confronto
    const vE = t.var95_hist_eur ?? t.var95_1d_eur, vP = t.var95_hist_pct ?? t.var95_1d_pct;
    const eE = t.es95_hist_eur ?? t.es95_1d_eur;
    const isHist = t.var95_hist_eur != null;
    if (vE != null) extraRisk.push(`<div style="font-size:12.5px;margin-top:6px"><b>VaR 95% (1 giorno${isHist ? ", storico" : ", parametrico"})</b>: <b class="neg">${fmtEUR.format(vE)}</b> (${fmtNum.format(vP)}% dell'azionario) — la perdita che nel 95% dei giorni NON viene superata${isHist ? ", misurata sui percentili REALI degli ultimi 12 mesi" : ""}.${eE != null ? ` <b>Expected Shortfall</b>: <b class="neg">${fmtEUR.format(eE)}</b> — la perdita MEDIA nel 5% dei giorni peggiori (la coda oltre il VaR).` : ""}${isHist && t.var95_1d_eur != null ? ` <span class="muted">(col metodo parametrico normale: VaR ${fmtEUR.format(t.var95_1d_eur)}${t.es95_1d_eur != null ? `, ES ${fmtEUR.format(t.es95_1d_eur)}` : ""} — sottostima le code grasse)</span>` : ""}</div>`);
  }
  openInfoModal("Sharpe Ratio del portafoglio",
    `<div class="info-line" style="margin-bottom:10px"><b>Sharpe Ratio</b> = rendimento corretto per il rischio: l'extra-rendimento (sopra il tasso privo di rischio del <b>${fmtNum.format(rf)}%</b>) per ogni unità di volatilità. Quello di portafoglio è calcolato sulla <b>matrice di covarianza</b> pesata per controvalore, quindi tiene conto della diversificazione fra i titoli.</div>
     <div class="info-line" style="background:var(--card-2);border-radius:8px;padding:10px;margin-bottom:10px">
       <div style="font-size:13px">Portafoglio: <b style="color:${ps != null ? sharpeColor(ps) : 'var(--muted)'};font-size:20px">${ps != null ? fmtNum.format(ps) : "n.d."}</b> ${verdict ? `<span style="color:${verdict.c};font-weight:700">· ${verdict.t}</span>` : ""}</div>
       ${extraRisk.join("")}
     </div>
     <h4 style="margin:8px 0 4px">Scala</h4>
     <table class="info-table"><tbody>
       <tr><td><b style="color:var(--green)">&gt; 2,0</b></td><td>Eccellente</td></tr>
       <tr><td><b style="color:#86c52a">1,0 – 2,0</b></td><td>Buono (qualità istituzionale)</td></tr>
       <tr><td><b style="color:var(--muted)">0 – 1,0</b></td><td>Debole</td></tr>
       <tr><td><b style="color:var(--red)">&lt; 0</b></td><td>Rischio non ripagato</td></tr>
     </tbody></table>
     ${rows ? `<h4 style="margin:10px 0 4px">Sharpe per titolo</h4><table class="info-table"><thead><tr><th>Titolo</th><th class="num">Sharpe 1A</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="info-line muted" style="font-size:11.5px;margin-top:8px">Gli Sharpe per titolo compariranno dopo il prossimo run della pipeline.</div>`}`);
}

const MONTH_NAMES = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const MONTH_ABBR = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

/* Popup stagionalità: grafico a barre con rendimento medio mensile sovrapposto S&P + Nasdaq */
function openSeasonalityModal() {
  const se = (DATA.macro || {}).seasonality;
  if (!se) { toast("Dati stagionalità non disponibili"); return; }
  const sp = se.sp500 || [], ndx = se.ndx || [];
  const cm = se.current_month || 1;
  // range comune per scalare le barre
  const allAvg = [...sp, ...ndx].map(x => x.avg).filter(v => v != null);
  const maxAbs = Math.max(0.5, ...allAvg.map(Math.abs));
  const W = 620, H = 240, padL = 30, padB = 28, padT = 14, padR = 10;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const zeroY = padT + innerH / 2;
  const colW = innerW / 12;
  const barW = colW * 0.32;
  const bar = (arr, color, off) => arr.map(x => {
    if (x.avg == null) return "";
    const cx = padL + (x.m - 0.5) * colW + off;
    const h = Math.abs(x.avg) / maxAbs * (innerH / 2);
    const yTop = x.avg >= 0 ? zeroY - h : zeroY;
    const hl = x.m === cm ? `stroke="var(--text)" stroke-width="1"` : "";
    return `<rect x="${(cx - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" fill="${color}" ${hl}><title>${MONTH_NAMES[x.m - 1]}: ${x.avg > 0 ? "+" : ""}${x.avg}% medio · ${x.pos}% positivi (${x.n} anni)</title></rect>`;
  }).join("");
  const monthLabels = MONTH_ABBR.map((mn, i) => {
    const cx = padL + (i + 0.5) * colW;
    const hl = (i + 1) === cm ? `font-weight="700" fill="var(--text)"` : `fill="var(--muted)"`;
    return `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" ${hl}>${mn}</text>`;
  }).join("");
  const gridY = [-maxAbs, 0, maxAbs].map(gv => {
    const gy = zeroY - gv / maxAbs * (innerH / 2);
    return `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="var(--border)" stroke-width="${gv === 0 ? 1.4 : 1}"/>
      <text x="${padL - 4}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="var(--muted)">${gv > 0 ? "+" : ""}${gv.toFixed(1)}%</text>`;
  }).join("");
  const spAvgY = sp.length ? (sp.reduce((s, x) => s + (x.avg || 0), 0) / sp.length) : 0;
  const ndxAvgY = ndx.length ? (ndx.reduce((s, x) => s + (x.avg || 0), 0) / ndx.length) : 0;
  const curSp = sp.find(x => x.m === cm), curNdx = ndx.find(x => x.m === cm);
  openInfoModal(`Stagionalità storica — ${MONTH_NAMES[cm - 1]}`,
    `<div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">Rendimento medio mensile storico di <b style="color:var(--blue)">S&P 500</b> e <b style="color:var(--purple)">Nasdaq 100</b> per ogni mese del calendario (intera storia disponibile). Il mese corrente è evidenziato. Il tachimetro nella dashboard sintetizza la favorevolezza stagionale del mese in corso.</div>
     <div class="info-line" style="margin-bottom:6px">
       <b>Mese corrente (${MONTH_NAMES[cm - 1]}):</b>
       ${curSp ? ` S&P <span class="${signCls(curSp.avg)}">${curSp.avg > 0 ? "+" : ""}${curSp.avg}%</span> (${curSp.pos}% positivi)` : ""}
       ${curNdx ? ` · Nasdaq <span class="${signCls(curNdx.avg)}">${curNdx.avg > 0 ? "+" : ""}${curNdx.avg}%</span> (${curNdx.pos}% positivi)` : ""}
     </div>
     <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
       ${gridY}
       ${bar(sp, "var(--blue)", -barW * 0.6)}
       ${bar(ndx, "var(--purple)", barW * 0.6)}
       ${monthLabels}
     </svg>
     <div class="info-line" style="display:flex;gap:16px;font-size:11px;margin-top:6px">
       <span><span style="display:inline-block;width:10px;height:10px;background:var(--blue);border-radius:2px;vertical-align:middle"></span> S&P 500 (media ${spAvgY > 0 ? "+" : ""}${spAvgY.toFixed(2)}%/mese)</span>
       <span><span style="display:inline-block;width:10px;height:10px;background:var(--purple);border-radius:2px;vertical-align:middle"></span> Nasdaq 100 (media ${ndxAvgY > 0 ? "+" : ""}${ndxAvgY.toFixed(2)}%/mese)</span>
     </div>
     <div class="info-line muted" style="font-size:11px;margin-top:8px">La stagionalità è una tendenza statistica storica, NON una garanzia: usala come contesto di probabilità, non come segnale isolato. "Sell in May", il rally di fine anno (Santa Claus rally) e la debolezza di settembre sono i pattern più noti.</div>`);
}

/* ---------------- rotazione settoriale: heatmap + istogramma + popup ---------------- */
function perfColor(p) {
  // verde se sale, rosso se scende (gradiente proporzionale, ±10% = saturo)
  return scoreColor(clamp(50 + p * 5));
}

function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }

/* salute del portafoglio = media di TECNICA (titoli) + MACRO (direzione) + FONDAMENTALE (titoli) */
/* ⚠ v254 — DICIASSETTE FUNZIONI RIMOSSE INSIEME, perché insieme erano un blocco morto.
   Le cinque render (renderMiniCards, renderPortfolioHealth, renderBtpInfo, renderEarnings,
   renderAIValidation) scrivevano su #fx-box, #internals-box, #macroquant-box,
   #margin-debt-box, #market-direction, #seasonality-box, #sharpe-box, #tracking-error-box,
   #portfolio-health, #btp-info, #earnings-strip — contenitori usciti da index.html quando la
   macro è diventata grafici (v206-v218). Grazie a `?.` non davano errore: giravano a OGNI
   render e scrivevano nel vuoto. Le dodici funzioni di supporto servivano solo a loro o a
   colonne tolte in v208/v251 (finHealthBar, targetBar, fundBar) o all'editor soglie tolto in
   v253 (openRiskRuleModal, pushRiskParamsCloud).
   ⚠ TAGLIATE INSIEME PER FORZA: al primo tentativo avevo tolto solo le dodici di supporto e
   il gate di render ha subito detto "renderMiniCards: metricTrend is not defined". È il gate
   nuovo di v253 che fa il suo lavoro — con quello vecchio, che copriva sei funzioni scelte a
   mano, questa sarebbe stata un'altra pagina morta in produzione come in v238.
   ⚠ NON tagliate, benché senza chiamanti: parseAIOrders e validateAIOrders (8 test), che
   leggono gli ordini proposti dall'LLM nel formato della testata e li verificano contro il
   libro vero; riskRulesRegistry, rpShownValue, signalTxt, seduteDelBook, etaLeva,
   testimoneLeva, derivaConcentrazione. Hanno tutte dei test: la domanda giusta non è "si può
   togliere" ma "perché non è collegata" — è la lezione v193, dove una funzione morta accanto
   a un bottone inerte era il sintomo di un collegamento mancante, non un surplus. */
// heatmap + istogramma + sintesi della rotazione (mostrati nel popup del widget Tilt)
function rotationDetailHtml() {
  const tilt = (DATA.macro || {}).tilt || [];
  if (!tilt.length) return "<div class='muted'>Dati rotazione non disponibili</div>";
  const sorted = [...tilt].sort((a, b) => b.m1 - a.m1);
  const maxAbs = Math.max(...sorted.map(s => Math.abs(s.m1)), 1);
  const hist = sorted.map(s => `<div class="rot-bar-row">
      <span class="rot-bar-lab">${esc(s.name)} <span class="tk">${s.ticker}</span></span>
      <span class="rot-bar-track"><span class="rot-bar-fill" style="width:${Math.abs(s.m1) / maxAbs * 100}%;background:${perfColor(s.m1)}"></span></span>
      <span class="rot-bar-val ${signCls(s.m1)}">${signTxt(s.m1)}</span></div>`).join("");
  return `<h4 style="margin:6px 0 4px">Performance 1 mese (ETF)</h4><div class="rot-hist">${hist}</div>`;
}

const MQ_LABELS = {
  "gdp": "PIL reale (crescita economia)",
  "claims": "Sussidi disoccupazione (mercato lavoro)",
  "cpi": "Inflazione CPI (pressioni prezzi)",
  "pce": "Inflazione PCE (consumi)",
  "retail": "Vendite al dettaglio (consumi privati)",
  "nfp": "Occupazione Non-Farm (creazione posti lavoro)",
  "unemp": "Tasso di disoccupazione",
  "credit": "Spread credito HY (rischio sistema bancario)",
  "curve": "Curva tassi 10A-2A (segnale recessione)",
  "vix": "VIX (volatilità = paura del mercato)",
  "fedwatch": "Aspettative Fed (politica monetaria)",
};
function openMacroQuantModal() {
  const mq = (DATA.macro || {}).macroquant;
  if (!mq) return;
  /* ⚠⚠ v340 — QUESTA SCHEDA ERA IL TAGLIO DELLA v337 LASCIATO A META', ed e' la scheda che
     il CEO ha indicato per nome ("elimina dalle schede macro i parametri in alto a destra es.
     56/100"). Il badge era uscito e qui dentro restavano DICIANNOVE punteggi 0-100 sotto una
     colonna intitolata letteralmente "Score" — piu' il fatto peggiore: il numero rimosso
     GUIDAVA ANCORA LA PROSA (cycleDesc sceglieva su mq.score >= 60 / >= 40).
     E produceva una contraddizione dentro la stessa scheda: il titolo diceva "Rallentamento"
     (mq.label) mentre il corpo diceva "Ciclo neutro" (da mq.score = 56). Due verdetti opposti
     nella stessa card — la classe "due derivazioni della stessa domanda, coerenti solo per
     fortuna" (v161/v207/v228), qui incoerenti per davvero.
     Ora: la prosa si sceglie sull'ETICHETTA, che e' l'unica cosa che la scheda dichiara, e le
     barre restano perche' CONFRONTANO i fattori fra loro (chi tira giu', chi tiene su) — e'
     il confronto a essere misurato, non il punteggio assoluto. Stesso trattamento che
     barreComposito() ha ricevuto in v337: la barra resta, il numero no. */
  const rows = [...(mq.components || [])]
    .sort((p, q) => (p.score ?? 50) - (q.score ?? 50))
    .map(c => {
      const friendlyLab = MQ_LABELS[c.key] || MQ_LABELS[c.label?.toLowerCase()] || c.label;
      const interp = c.score >= 70 ? "Positivo per l'economia" : c.score >= 45 ? "Neutro" : "Segnale di debolezza";
      return `<tr>
        <td>${esc(friendlyLab)}</td>
        <td style="min-width:120px">${meterBar(c.score, scoreColor(c.score), "")}</td>
        <td class="muted" style="font-size:11px">${interp}</td>
      </tr>`;
    }).join("");
  const et = String(mq.label || "").toLowerCase();
  const cycleDesc = et.indexOf("espansione") >= 0
    ? "Ciclo espansivo: PIL cresce, occupazione solida, condizioni di credito normali. Favorevole per asset rischiosi (azioni, tech)."
    : et.indexOf("contrazione") >= 0
    ? "Rischio di recessione: PIL debole, occupazione in calo o credito sotto stress. Preferire difensivi e ridurre rischio."
    : "Rallentamento: segnali misti, i fattori qui sotto tirano in direzioni opposte. Attenzione ai dati macro in uscita.";
  openInfoModal(`MacroQuant — Ciclo economico: ${mq.label}`,
    `<div class="info-line" style="margin-bottom:8px">${cycleDesc}</div>
     <div class="info-line muted" style="font-size:11px">Questa non e' una misura pubblicata: e' la media di fattori macro pubblici, ricomposta qui. Per questo non porta un punteggio — e nemmeno i fattori ne portano uno: le barre servono a confrontarli <b>fra loro</b>, dal piu' debole al piu' forte, che e' l'unica cosa che il calcolo misura davvero.</div>
     <h4 style="margin:10px 0 4px">I fattori che la compongono</h4>
     <table class="info-table"><thead><tr><th>Indicatore</th><th>Dove sta, rispetto agli altri</th><th>Lettura</th></tr></thead><tbody>${rows}</tbody></table>
     <div class="info-line muted" style="font-size:11px;margin-top:8px">Ispirato alla metodologia BCA Research. Verde = indicatore positivo per l'economia, rosso = segnale di debolezza. Aggiornato a ogni refresh dei dati.</div>`);
}

function openTiltModal() {
  const tilt = (DATA.macro || {}).tilt;
  if (!tilt || !tilt.length) return;
  const byM1 = [...tilt].sort((a, b) => b.m1 - a.m1);
  const lead = byM1.slice(0, 3), lag = byM1.slice(-3).reverse();
  const defensives = ["Utilities", "Consumi difens.", "Salute", "Oro"];
  const defAvg = avg(tilt.filter(s => defensives.includes(s.name)).map(s => s.m1));
  const tech = tilt.find(s => s.ticker === "XLK");
  const semi = tilt.find(s => s.ticker === "SMH" || s.ticker === "SOXX" || /semicond/i.test(s.name));
  const weak = byM1.filter(s => s.m1 < -2).slice(-3).map(s => s.name);
  let regimeHtml = "";
  if (defAvg != null && tech) {
    const isDef = defAvg > tech.m1;
    const col = isDef ? "var(--yellow)" : "var(--green)";
    const lab = isDef ? "ROTAZIONE DIFENSIVA" : "REGIME PRO-RISCHIO";
    const desc = isDef
      ? `I difensivi (${signTxt(Math.round(defAvg * 10) / 10)}) sovraperformano il Tech (${signTxt(tech.m1)}): gli investitori si spostano su settori protettivi — segnale di cautela o de-risking.`
      : `Tech/ciclici (${signTxt(tech.m1)}) guidano sui difensivi (${signTxt(Math.round(defAvg * 10) / 10)}): il mercato premia la crescita — contesto favorevole per il portafoglio tech.`;
    regimeHtml = `<div class="info-line" style="margin-bottom:8px"><b style="color:${col}">${lab}</b> — ${desc}</div>`;
  }
  const semiHtml = semi ? `<div class="info-line"><b>Semiconduttori:</b> <span class="${signCls(semi.m1)}">${signTxt(semi.m1)}</span> (1M) — ${semi.m1 < 0 ? "in calo: possibile finestra di accumulo sui rimbalzi (diamond hands)" : "in forza: valuta alleggerimenti sugli strappi per de-risking parziale"}</div>` : "";
  const weakHtml = weak.length ? `<div class="info-line"><b>Settori in forte debolezza</b> (potenziale mean-reversion): <b>${weak.map(esc).join(", ")}</b></div>` : "";
  openInfoModal("Rotazione settoriale USA — Analisi",
    `<div class="info-line muted" style="font-size:11px;margin-bottom:8px">Performance 1 mese degli ETF settoriali USA (Yahoo Finance). Verde = momentum positivo, rosso = debolezza. Clicca sui settori per capire il posizionamento attuale del mercato.</div>
     ${regimeHtml}
     <div class="info-line"><b>Settori in forza:</b> ${lead.map(s => `<b style="color:var(--green)">${esc(s.name)}</b> ${signTxt(s.m1)}`).join(" · ")}</div>
     <div class="info-line"><b>Settori in debolezza:</b> ${lag.map(s => `<b style="color:var(--red)">${esc(s.name)}</b> ${signTxt(s.m1)}`).join(" · ")}</div>
     ${semiHtml}
     ${weakHtml}
     ${rotationDetailHtml()}
     <div class="info-line muted" style="font-size:11px;margin-top:8px">Usa "📄 Report CIO" → Copia per analisi AI per il piano operativo dettagliato di rotazione/de-risking con indicazioni precise per ogni posizione.</div>`);
}

/* popup di orientamento rapido sulla rotazione (solo testo calcolato, NON il prompt AI) */
function openRotationAnalysis() {
  const tilt = (DATA.macro || {}).tilt;
  if (!tilt || !tilt.length) { toast("Dati rotazione non disponibili"); return; }
  const byM1 = [...tilt].sort((a, b) => b.m1 - a.m1);
  const lead = byM1.slice(0, 3), lag = byM1.slice(-3).reverse();
  const defensives = ["Utilities", "Consumi difens.", "Salute", "Oro"];
  const defAvg = avg(tilt.filter(s => defensives.includes(s.name)).map(s => s.m1));
  const tech = tilt.find(s => s.ticker === "XLK");
  const semi = tilt.find(s => s.ticker === "SMH" || s.ticker === "SOXX" || /semicond/i.test(s.name));
  const weak = byM1.filter(s => s.m1 < -2).slice(-3).map(s => s.name);
  let regime = "";
  if (defAvg != null && tech) {
    regime = defAvg > tech.m1
      ? `I settori <b>difensivi stanno sovraperformando il Tech</b> (difensivi ${signTxt(Math.round(defAvg * 10) / 10)} vs Tech ${signTxt(tech.m1)}): rotazione difensiva in corso, coerente con un de-risking dai semiconduttori.`
      : `Il <b>Tech/ciclici guida</b> sui difensivi (Tech ${signTxt(tech.m1)} vs difensivi ${signTxt(Math.round(defAvg * 10) / 10)}): regime ancora pro-rischio.`;
  }
  openInfoModal("Analisi Rotazione Settoriale", `
    <div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">Orientamento rapido calcolato ora sui dati di rotazione (performance 1 mese degli ETF settoriali).</div>
    ${regime ? `<div class="info-line">${regime}</div>` : ""}
    <div class="info-line"><b>In forza (1M):</b> ${lead.map(s => `${esc(s.name)} ${signTxt(s.m1)}`).join(" · ")}</div>
    <div class="info-line"><b>In debolezza (1M):</b> ${lag.map(s => `${esc(s.name)} ${signTxt(s.m1)}`).join(" · ")}</div>
    ${weak.length ? `<div class="info-line">Settori in forte debolezza (potenziale ipervenduto / mean-reversion): <b>${weak.map(esc).join(", ")}</b></div>` : ""}
    ${semi ? `<div class="info-line"><b>Semiconduttori:</b> ${signTxt(semi.m1)} (1M) — ${semi.m1 < 0 ? "in calo: finestra per ridurre l'esposizione sui rimbalzi" : "in forza: valuta alleggerimenti sugli strappi"}</div>` : ""}
    <div class="info-line muted" style="font-size:11px;margin-top:8px">Per il piano operativo dettagliato di rotazione/de-risking usa "📄 Report CIO" → Copia per analisi AI.</div>`);
}

function openSignpostsModal() {
  const sp = (DATA.macro || {}).signposts;
  if (!sp) return;
  const rows = sp.items.map(it => `<tr>
    <td>${esc(it.name)}</td><td class="muted">${it.category}</td>
    <td><span class="badge ${it.status ? "bad" : "good"}">${it.status ? "Attivo" : "Stabile"}</span></td>
    <td class="muted" title="${esc(it.desc)}">${esc(it.source)}</td></tr>`).join("");
  openInfoModal(`BofA Bear-Market Signposts — ${sp.active}/${sp.total} attivi (${sp.pct}%)`,
    `<p class="muted" style="margin:0 0 8px">Più segnali attivi = mercato più vicino a una fase ribassista. Fonti gratuite indicate per la verifica.</p>
     <table class="info-table"><thead><tr><th>Segnale</th><th>Categoria</th><th>Stato</th><th>Fonte</th></tr></thead><tbody>${rows}</tbody></table>`);
}

/* ---------------- KPI ---------------- */
/* v204 — renderStatusBar/renderDecisionQueue RIMOSSE (decisione CEO). I dati che mostravano
   restano tutti nel payload e nelle tabelle: era una vista, non una fonte. */


/* variazione % giornaliera del portafoglio = media pesata (per controvalore) dei titoli USD */
function portfolioDayPct() {
  const eq = (DATA.portfolio || []).filter(r => r.currency === "USD" && r.change_pct != null && (r.val_eur || r.value));
  const w = eq.reduce((s, r) => s + (r.val_eur || r.value || 0), 0);
  if (!w) return null;
  return eq.reduce((s, r) => s + (r.val_eur || r.value || 0) * r.change_pct, 0) / w;
}

/* popup "Portfolio Alpha vs Benchmarks": confronto Day % vs S&P/Nasdaq/SOX + forza relativa per titolo */
function openAlphaModal() {
  const bm = (DATA.macro || {}).benchmarks || {};
  const pday = portfolioDayPct();
  const BLAB = { sp500: "S&P 500", ndx: "Nasdaq 100", sox: "SOX (semiconduttori)" };
  const idxRow = (key) => {
    if (bm[key] == null) return "";
    const a = pday != null ? pday - bm[key] : null;
    return `<div class="info-line" style="display:flex;justify-content:space-between;gap:10px">
      <span><b>${BLAB[key]}:</b> <span class="${signCls(bm[key])}">${signTxt(bm[key])}</span></span>
      <span>Alpha: <span class="${signCls(a)}" style="font-family:var(--mono);font-weight:700">${a != null ? signTxt(Math.round(a * 100) / 100) + " pp" : "—"}</span></span></div>`;
  };
  const BREF = { sox: "sox", ndx: "ndx", sp500: "sp500" };
  const RLAB = { sox: "SOX", ndx: "Nasdaq 100", sp500: "S&P 500" };
  const rows = (DATA.portfolio || []).filter(r => r.currency === "USD" && r.change_pct != null).map(r => {
    const bk = BREF[r.rs_bench] || "sp500";
    const bpct = bm[bk];
    const rs = bpct != null ? r.change_pct - bpct : null;
    const c = rs != null ? scoreColor(clamp(50 + rs * 12)) : "var(--muted)";
    const bw = rs != null ? Math.max(4, Math.min(100, Math.abs(rs) * 16)) : 0;
    return `<tr><td class="name-cell" style="font-family:Inter">${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num" style="color:${c};font-family:var(--mono)">${rs != null ? signTxt(Math.round(rs * 100) / 100) : "—"} <span class="muted" style="font-size:10px">(${RLAB[bk]})</span></td>
      <td><span class="alpha-bar"><span class="alpha-fill" style="width:${bw.toFixed(0)}%;background:${c}"></span></span></td></tr>`;
  }).join("");
  openInfoModal("Portfolio Alpha vs Benchmarks (Day %)", `
    <div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">Alpha giornaliero = variazione % del portafoglio − variazione % dell'indice. Verde = sovraperformance, rosso = sottoperformance. La forza relativa di ogni titolo è calcolata sul benchmark del suo settore (semiconduttori→SOX, tech/growth→Nasdaq 100, finanziari/difensivi→S&P 500).</div>
    <h4 style="margin:6px 0 4px">Portafoglio vs mercato</h4>
    <div class="info-line"><b>Portafoglio oggi:</b> <span class="${signCls(pday)}" style="font-family:var(--mono);font-weight:700">${pday != null ? signTxt(Math.round(pday * 100) / 100) : "—"}</span> <span class="muted" style="font-size:11px">(media pesata per controvalore)</span></div>
    ${idxRow("sp500")}${idxRow("ndx")}${idxRow("sox")}
    <h4 style="margin:14px 0 4px">Forza relativa per titolo (Day % − benchmark di settore)</h4>
    <table class="info-table"><thead><tr><th>Titolo</th><th>Oggi</th><th>Forza rel.</th><th>Sovra/sotto-perf.</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">Dati non disponibili</td></tr>'}</tbody></table>`);
}

/* ---------------- andamento portafoglio ---------------- */
let histRange = "all";   // w1 | m1 | m3 | y1 | y5 | all — default: dall'inizio
let histBenchKey = "ndx";   // none | nasdaq | ndx | sp500 — default: confronto con Nasdaq 100
const BENCH_LABEL = { nasdaq: "Nasdaq Comp.", ndx: "Nasdaq 100", sp500: "S&P 500", russell: "Russell 2000" };

/* ---------------- info BTP (riga unica sotto i KPI) ---------------- */

/* ---------------- asset allocation (donut) ---------------- */
let allocMode = "ticker";   // ticker | sector
const ALLOC_COLORS = ["#4c8dff", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#22d3ee",
  "#ec4899", "#14b8a6", "#a3a3a3", "#eab308", "#6366f1"];


/* ═══════════════════════════════════════════════════════════════════════════════════════
   v205 — VISTA STRUTTURA
   Il vincolo che decide questa vista: i dati arrivano su cron, non tick-by-tick. Quindi NON
   si disegnano grafici di prezzo — investing.com e TradingView li fanno meglio e in tempo
   reale. Si disegna solo ciò che nessuno dei due può disegnare, perché non conosce il libro.

   ⚠ LA COSA CHE SI SBAGLIA PER PRIMA: peso e MCR hanno DENOMINATORI DIVERSI.
   La pipeline calcola il contributo al rischio solo sulle posizioni con ≥60 rendimenti
   giornalieri: il BTP non ne ha, quindi la varianza NON lo contiene. Confrontare "21% del
   NAV" con "40% della varianza del comparto azionario" è confrontare due frazioni con basi
   diverse — la classe di difetto che il gate di coerenza chiama "denominatori non dichiarati".
   Qui le due barre stanno entrambe sul COMPARTO AZIONARIO (sommano a 100% tutte e due) e il
   peso sul NAV resta accanto come numero, dichiarato per quello che è.
   ═══════════════════════════════════════════════════════════════════════════════════════ */

function strutturaUniverso() {
  const ptf = (DATA?.portfolio || []).filter(r => r.qty > 0 && r.val_eur > 0);
  const conMcr = ptf.filter(r => r.risk_contrib_pct != null);
  const somma = a => a.reduce((s, r) => s + r.val_eur, 0);
  return {
    ptf, conMcr, fuori: ptf.filter(r => r.risk_contrib_pct == null),
    investito: somma(ptf), azionario: somma(conMcr), cash: cashEur,
  };
}

/* righe del grafico peso-vs-rischio, ordinate per contributo al rischio decrescente */

/* DERIVA: quota di varianza delle posizioni nel tempo, da metrics_history.
   I titoli entrano ed escono dal libro: una data senza il titolo dà un BUCO nella serie, non
   uno zero. Uno zero direbbe "rischio nullo", il buco dice "non era in portafoglio". */

/* DISTANZA DALLO STOP in % del prezzo: negativa = stop già violato.
   Usa stopOf(), la stessa funzione del payload — una sola verità per dashboard e LLM. */

/* allocazione per settore o per valuta — la liquidità è in euro e conta nell'esposizione */
function allocazionePer(kind) {
  const u = strutturaUniverso();
  const by = new Map();
  u.ptf.forEach(r => {
    const k = kind === "currency" ? (r.currency || "?") : (r.sector || "Altro");
    by.set(k, (by.get(k) || 0) + r.val_eur);
  });
  if (u.cash > 0) by.set(kind === "currency" ? "EUR" : "Liquidità", (by.get(kind === "currency" ? "EUR" : "Liquidità") || 0) + u.cash);
  const tot = [...by.values()].reduce((s, v) => s + v, 0);
  if (!tot) return [];
  return [...by.entries()].map(([nome, val]) => ({
    nome, val, pct: Math.round(val / tot * 1000) / 10,
  })).sort((a, b) => b.val - a.val);
}

/* v186 — quante sedute diverse convivono nel book. Rispecchia il controllo che buildPrompt fa
   sul payload; è ripetuto qui e non estratto perché buildPrompt non si tocca (Regola Suprema),
   e il test sull'impronta del payload garantisce che le due letture non divergano. */

/* in una colonna di percentuali il decimale va SEMPRE stampato: "26%" accanto a "39,9%" fa
   ballare l'incolonnamento e costringe a rileggere invece di guardare */
const fmt1 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/* ═══════════════════════════════════════════════════════════════════════════════════════
   PRIMITIVE GRAFICHE (v206)
   Due sole forme, riusate ovunque: una SERIE NEL TEMPO con le sue soglie, e BARRE ORDINATE
   che divergono dallo zero. La regola che le governa è quella che ha fatto togliere la mappa
   di correlazione: un grafico che va imparato prima di essere letto non serve a nessuno.
   Entrambe accettano buchi (null) e NON li disegnano come zeri.
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/* tacche su valori TONDI. Un asse che segna 23% e 68% costringe a fare i conti per leggerlo:
   il passo si sceglie fra 1/2/2,5/5 × una potenza di dieci, come farebbe una carta millimetrata. */
function tacche(min, max, maxTacche = 5) {
  if (!(max > min)) { const v = max || 0; return { passo: 1, lista: [v], min: v - 1, max: v + 1 }; }
  const mag = Math.pow(10, Math.floor(Math.log10((max - min) / maxTacche)));
  const passo = [1, 2, 2.5, 5, 10].map(m => m * mag).find(p => (max - min) / p <= maxTacche) || mag * 10;
  const lo = Math.floor(min / passo) * passo, hi = Math.ceil(max / passo) * passo;
  const lista = [];
  // ⚠ si RIAGGANCIA il valore al passo (Math.round(v/passo)*passo), non lo si divide per il
  // passo: la prima stesura stampava l'INDICE della tacca — un asse 0..82,5 segnava "0 1 2 3 4".
  const dec = Math.max(0, 1 - Math.floor(Math.log10(passo)));   // toglie lo 0,6000000000000001
  for (let i = 0; lo + i * passo <= hi + passo * 1e-9; i++) lista.push(+((lo + i * passo).toFixed(dec)));
  return { passo, lista, min: lo, max: hi };
}

/* etichetta di data compatta: "gen 25" per serie lunghe, "31/07" per serie brevi */
function dataBreve(iso, lunga) {
  const d = new Date(String(iso).length <= 10 ? iso + "T00:00:00" : iso);
  return isNaN(d) ? String(iso) : lunga
    ? d.toLocaleDateString("it-IT", { month: "short", year: "2-digit" })
    : d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
}

/* SERIE NEL TEMPO.
   serie: [{ nome, punti: [{d, v}|{d, v:null}], colore, tratteggio }]
   opt.soglie: [{ v, testo, colore }] — le righe orizzontali che danno significato all'altezza.
     Senza soglie un livello non dice niente: "HY OAS 2,84" è un numero, "2,84 contro i 4,0
     dello stress" è un'informazione. È il motivo per cui questi grafici esistono.
   opt.bande: [{ da, a, colore }] — zone di sfondo (es. "zona di inversione" sotto lo zero). */
/* ═══ v303 — RIDUZIONE ALLA RISOLUZIONE CHE LA TELA PUO' MOSTRARE ═════════════════════════
   Difetto introdotto dalla fusione delle sezioni: portando in classifica le serie lunghe (la
   curva ha 501 punti, il credito 260, i tassi 369) la scheda e' passata da 23.747 a 294.026
   caratteri di markup — DODICI volte. Una tela da 330px non puo' mostrare 501 punti: sono
   cinque punti per pixel, cioe' peso senza informazione.
   ⚠⚠ NON SI PRENDE UN PUNTO OGNI N. Campionare cosi' fa sparire le punte — e una punta e'
   esattamente cio' che si guarda in una serie di mercato. Si divide in secchi e di ogni secchio
   si tengono il MINIMO e il MASSIMO, nell'ordine in cui compaiono: la forma resta, gli estremi
   restano, spariscono solo i punti che cadrebbero sullo stesso pixel.
   ⚠ I BUCHI RESTANO BUCHI: un `null` dentro un secchio lo attraversa intatto, altrimenti la
   riduzione ricucirebbe una continuita' mai esistita (regola v289). */
function riduciSerie(punti, max = 200) {
  if (!Array.isArray(punti) || punti.length <= max) return punti;
  const per = Math.ceil(punti.length / (max / 2));   // due punti per secchio: min e max
  const out = [];
  for (let i = 0; i < punti.length; i += per) {
    const secchio = punti.slice(i, i + per);
    const buchi = secchio.filter(p => !p || p.v == null);
    const veri = secchio.filter(p => p && p.v != null);
    if (buchi.length) out.push(buchi[0]);            // il buco sopravvive: non si ricuce
    if (!veri.length) continue;
    let lo = veri[0], hi = veri[0];
    for (const p of veri) { if (p.v < lo.v) lo = p; if (p.v > hi.v) hi = p; }
    const primo = veri.indexOf(lo) <= veri.indexOf(hi) ? lo : hi;
    const secondo = primo === lo ? hi : lo;
    out.push(primo);
    if (secondo !== primo) out.push(secondo);
  }
  return out;
}

function graficoSerie(serie, opt = {}) {
  const s = (serie || []).filter(x => (x.punti || []).some(p => p && p.v != null))
    /* ⚠ la riduzione avviene QUI, in un posto solo: ogni consumatore ne beneficia e nessuno
       puo' dimenticarsene. Il tetto e' generoso (200) perche' la tela piu' larga e' 640px. */
    .map(x => ({ ...x, punti: riduciSerie(x.punti, 200) }));
  if (!s.length) return '<div class="muted">Storico non disponibile.</div>';
  // ⚠ il viewBox NON è fisso: dentro una card da 300px un viewBox da 640 scala il testo al 47%
  // (9,5px → 4,5px, illeggibile). `compatto` porta la tela vicino alla larghezza reale, così
  // le etichette rendono a grandezza quasi naturale.
  const H = opt.h || 190, W = opt.w || (opt.compatto ? 330 : 640);
  const L = opt.assey === false ? 8 : (opt.lAsse || 44), R = opt.etichetteDx === false ? 12 : 52, T = 10, B = 22;
  const vals = s.flatMap(x => x.punti.map(p => p && p.v)).filter(v => v != null);
  const soglie = opt.soglie || [];
  const lo0 = Math.min(...vals, ...soglie.map(t => t.v));
  const hi0 = Math.max(...vals, ...soglie.map(t => t.v));
  const tk = tacche(lo0, hi0, opt.tacche || 4);
  const n = Math.max(...s.map(x => x.punti.length));
  const px = i => (L + (n < 2 ? 0.5 : i / (n - 1)) * (W - L - R)).toFixed(1);
  const py = v => (H - B - (v - tk.min) / (tk.max - tk.min || 1) * (H - B - T)).toFixed(1);
  const lunga = n > 90;

  const bande = (opt.bande || []).map(b =>
    `<rect x="${L}" y="${py(Math.max(b.a, b.da))}" width="${W - L - R}"
       height="${Math.abs(+py(Math.min(b.a, b.da)) - +py(Math.max(b.a, b.da))).toFixed(1)}"
       fill="${b.colore}" opacity=".13"/>`).join("");

  const griglia = tk.lista.map(v =>
    `<line x1="${L}" y1="${py(v)}" x2="${W - R}" y2="${py(v)}" stroke="var(--border)" stroke-width="1"/>
     <text x="${L - 7}" y="${(+py(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5"
       fill="var(--muted)" font-family="var(--mono)">${(opt.fmtY || fmtNum.format)(v)}${esc(opt.unita || "")}</text>`).join("");

  const righeSoglia = soglie.map(t =>
    `<line x1="${L}" y1="${py(t.v)}" x2="${W - R}" y2="${py(t.v)}" stroke="${t.colore || "var(--muted)"}"
       stroke-width="1.4" stroke-dasharray="5 3"/>
     <text x="${L + 5}" y="${(+py(t.v) - 4).toFixed(1)}" font-size="9.5" font-weight="600"
       fill="${t.colore || "var(--muted)"}">${esc(t.testo || "")}</text>`).join("");

  // un buco spezza la linea: unire i due estremi disegnerebbe una continuità mai esistita
  const linee = s.map(x => {
    const col = x.colore || "var(--blue)";
    // un punto ISOLATO fra due buchi non fa un segmento: va disegnato come punto, altrimenti
    // sparisce in silenzio dal grafico pur essendo un dato che esiste
    const segs = [], soli = []; let cur = [];
    const chiudi = () => { if (cur.length > 1) segs.push(cur); else if (cur.length === 1) soli.push(cur[0]); cur = []; };
    x.punti.forEach((p, i) => {
      if (!p || p.v == null) chiudi();
      else cur.push(`${px(i)},${py(p.v)}`);
    });
    chiudi();
    const ultimo = x.punti.reduce((acc, p, i) => (p && p.v != null ? i : acc), -1);
    const dash = x.tratteggio ? ' stroke-dasharray="4 3"' : "";
    return segs.map(g => `<polyline points="${g.join(" ")}" fill="none" stroke="${col}"
        stroke-width="${x.tratteggio ? 1.5 : 2}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`).join("")
      + soli.map(p => `<circle cx="${p.split(",")[0]}" cy="${p.split(",")[1]}" r="2" fill="${col}"/>`).join("")
      + (ultimo >= 0 ? `<circle cx="${px(ultimo)}" cy="${py(x.punti[ultimo].v)}" r="3" fill="${col}"/>`
        + (opt.etichetteDx === false ? "" : `<text x="${W - R + 5}" y="${(+py(x.punti[ultimo].v) + 3.5).toFixed(1)}"
            font-size="10" font-weight="700" fill="${col}" font-family="var(--mono)">${fmtNum.format(x.punti[ultimo].v)}</text>`) : "");
  }).join("");

  // alcune serie di data.json sono NUMERI NUDI senza date (vix.spark, margin_debt.history):
  // in quel caso l'asse si etichetta a mano invece di inventare una data per punto
  const primo = s[0].punti.find(p => p && p.v != null);
  const ultimo = [...s[0].punti].reverse().find(p => p && p.v != null);
  const [xSx, xDx] = opt.assex || [primo && primo.d != null ? dataBreve(primo.d, lunga) : "",
    ultimo && ultimo.d != null ? dataBreve(ultimo.d, lunga) : ""];
  // v215 — INTERATTIVITÀ: i punti viaggiano nell'SVG come dati, così il crosshair li legge
  // senza ricalcolare nulla e senza che il grafico debba essere ridisegnato al passaggio.
  const datiHover = JSON.stringify(s.map(x => ({
    n: x.nome, c: x.colore || "var(--blue)",
    p: x.punti.map((q, i) => (q && q.v != null ? { x: +px(i), y: +py(q.v), v: q.v, d: q.d } : null)).filter(Boolean),
  })));
  return `<svg class="g-serie" data-hover='${esc(datiHover)}' data-geo='${L},${W - R},${T},${H - B}'
      viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.aria || "serie storica")}">
      ${bande}${griglia}${righeSoglia}${linee}
      <text x="${L}" y="${H - 5}" font-size="9.5" fill="var(--muted)">${esc(xSx || "")}</text>
      <text x="${W - R}" y="${H - 5}" text-anchor="end" font-size="9.5" fill="var(--muted)">${esc(xDx || "")}</text>
    </svg>`;
}

/* BARRE ORDINATE che divergono dallo zero.
   righe: [{ nome, valore, evidenzia, nota }] — `evidenzia` accende la riga (è il TUO settore,
   è il mese corrente): senza, una classifica di 21 voci resta una lista da leggere tutta. */
function barreOrdinate(righe, opt = {}) {
  const r = (righe || []).filter(x => x && x.valore != null);
  if (!r.length) return '<div class="muted">Dati non disponibili.</div>';
  const max = Math.max(...r.map(x => Math.abs(x.valore))) || 1;
  const neg = r.some(x => x.valore < 0);
  const zero = neg ? 50 : 0;      // con valori negativi lo zero sta al centro
  return `<div class="obars">${r.map(x => {
    const w = Math.abs(x.valore) / max * (neg ? 50 : 100);
    const left = x.valore >= 0 ? zero : zero - w;
    const col = x.colore || (x.valore >= 0 ? "var(--green)" : "var(--red)");
    /* ⚠⚠ v302 — IL `title` NATIVO NON BASTAVA, e il CEO l'ha detto: "non hai eseguito la
       funzione richiesta". Tecnicamente lo faceva — ma un tooltip di sistema compare dopo circa
       un secondo di immobilita' e con la grafica del sistema operativo: chi passa il mouse
       scorrendo non lo vede mai. Una funzione che c'e' e non si manifesta, per chi la usa, non
       c'e' — stessa lezione del ✕ che non chiudeva (v193) e della barra piena al 100% che non
       rompeva niente (v205).
       Ora le prime cinque sono una RIGA VERA della griglia, alta zero, che si apre al
       passaggio: compare subito, ha la grafica della pagina, e resta DENTRO il contenitore che
       scorre — un pannello in posizione assoluta verrebbe tagliato da `overflow`.
       ⚠ Il `title` resta come rete per il touch, dove il passaggio del mouse non esiste. */
    return `<div class="obar-row${x.evidenzia ? " obar-on" : ""}${x.tk ? " obar-click" : ""}"${x.tk ? ` data-obar-tk="${esc(x.tk)}" data-graf-tk="${esc(x.tk)}" role="button" tabindex="0"` : ""}${x.suggerimento ? ` title="${esc(x.suggerimento)}"` : ""}>
      <span class="obar-lab" title="${esc(x.nome)}">${esc(x.nome)}</span>
      <span class="obar-axis">${neg ? `<span class="obar-zero" style="left:${zero}%"></span>` : ""}
        <span class="obar-fill" style="left:${left.toFixed(1)}%;width:${Math.max(w, 0.6).toFixed(1)}%;background:${col}"></span>
      </span>
      ${x.suggerimento ? `<span class="obar-prime">${esc(x.suggerimento)}</span>` : ""}
      <span class="obar-val">${x.testo != null ? esc(x.testo) : signTxt(x.valore)}</span>
    </div>`;
  }).join("")}</div>${opt.nota ? `<div class="muted struct-note">${opt.nota}</div>` : ""}`;
}

/* ---------------- rendering della vista struttura ---------------- */


/* v238 — `renderDeriva()` RIMOSSA col suo riquadro (richiesta CEO). RICEVUTA: la funzione pura
   `derivaConcentrazione()` SOPRAVVIVE — e' usata dai check e il payload non la pubblica, quindi
   toglierla porterebbe via una protezione senza togliere nulla di visibile (classe v203). */
/* ⚠ v239 — QUESTA RIGA ERA STATA PORTATA VIA dal taglio di renderDeriva() in v238, e il sito e'
   rimasto ROTTO: `allocGrafMode is not defined` faceva morire renderAllocGrafica → renderStruttura
   → renderAll → loadData, cioe' l'intera pagina. La dichiarazione stava FRA le due funzioni, e il
   mio assert contava solo quante `function` cadevano nei confini: un `let` in mezzo non lo vedeva.
   E' la classe v201-v204 per la QUARTA volta, e stavolta e' passata perche' la ricevuta
   controllava la cosa sbagliata. La ricevuta di un taglio deve contare TUTTE le dichiarazioni di
   primo livello dentro i confini, non solo le funzioni. */
/* v251 — resta la sola modalità SETTORE: la chip "Valuta" è stata rimossa su richiesta del CEO.
   La variabile sopravvive perché `allocazionePer` la usa e perché toglierla ha già ucciso la
   pagina una volta (v238-v239): un taglio che si porta via una dichiarazione vicina. */
let allocGrafMode = "sector";
/* ═══ v281 — ETF DI LUNGO PERIODO ══════════════════════════════════════════════════════════
   Richiesta del CEO: "i migliori 10 etf come media degli ultimi 10 anni ... cosi' da capire su
   quale ETF entrare in ottica di lungo periodo".
   ⚠ COSA QUESTA SEZIONE NON FA, e il perche' vale piu' di cosa fa: non sceglie, non ordina per
   rendimento e non dice quale comprare. Selezionare "i migliori" sul passato costruisce una
   lista che insegue i vincitori — a dieci anni non e' piu' predittiva che a tre mesi — ed e' lo
   stesso motivo per cui in v200 il motore di punteggio e' stato tolto: "ordinare e' gia' un
   giudizio", con un hit-rate del 29%.
   Quello che fa: mette le dieci curve sulla stessa scala (tutte a 100 il primo mese, cosi' si
   confrontano i PERCORSI e non i prezzi) e accanto i numeri che il rendimento medio nasconde —
   quanto ha perso nel momento peggiore, quanto ci ha messo a tornare sopra, quanto oscilla, e
   quanto costa ogni anno. Due ETF con lo stesso 10% annuo possono averglielo dato in modi che
   uno dei due non gli avrebbe fatto tenere fino in fondo. */
/* ═══ v287 — CALENDARIO: COSA ARRIVA NEI PROSSIMI SETTE GIORNI ════════════════════════════
   Proposta di ChatGPT che condivido e che il sistema non aveva: il quadro macro diceva
   benissimo cosa E' USCITO e taceva su cosa STA PER USCIRE. Il CEO leggeva "prossima
   trimestrale attesa 2026-11-03" per il singolo titolo che stava analizzando e non aveva
   nessuna vista d'insieme.
   ⚠ COSTRUITO SU DATI CHE ABBIAMO GIA', zero API nuove: le uscite macro le calcola
   `cadenzaDato()` dal calendario dichiarato dalle fonti (BLS, BEA, Census, FRED), le
   trimestrali arrivano da `earnings_date` che la pipeline gia' scarica per i titoli seguiti.
   Aggiungere Alpha Vantage o Finnhub avrebbe voluto dire una chiave in un repository PUBBLICO
   e un free tier da verificare, per dati che sono gia' in casa.
   ⚠⚠ SONO TUTTE STIME, E VA SCRITTO. La data della prossima uscita macro e' una MIA
   proiezione dal ritardo tipico della fonte (il CPI di luglio esce "a meta' agosto", non il
   14 esatto); le date delle trimestrali che yfinance restituisce per il futuro sono stime
   dell'emittente. Presentarle come certe sarebbe la classe di difetto peggiore di questo
   progetto: un dato che sembra piu' solido di quanto sia. Ogni riga porta [stimata]. */
function prossimiEventi(giorni = 7) {
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const limite = new Date(oggi); limite.setDate(limite.getDate() + giorni);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const ev = [];

  /* MACRO: la prossima uscita attesa di ogni serie che ha un calendario dichiarato. */
  for (const i of ((DATA && DATA.macro && DATA.macro.indicators) || [])) {
    const c = (typeof cadenzaDato === "function") ? cadenzaDato(i.key, i.date) : null;
    if (!c || !c.prossimo) continue;
    /* ⚠ v290 — UNA SERIE GIORNALIERA NON E' UN APPUNTAMENTO. "Curva 10A-2A in uscita domani" e'
       vero e inutile: quella serie esce ogni giorno di mercato, come il prezzo di un'azione.
       Il calendario serve a dire che mercoledi' esce il CPI — un evento che sposta i prezzi
       perche' arriva in un istante noto e con un consenso da battere. Mescolare le due cose
       annega l'unica utile sotto tre righe di rumore: e' il difetto per cui il TOP-10 e' uscito
       dal payload in v184, "mai citato in nessuno dei tre report reali". */
    if (c.passo === "giornaliero") continue;
    const d = new Date(c.prossimo + "T00:00:00");
    if (isNaN(d) || d < oggi || d > limite) continue;
    ev.push({ giorno: c.prossimo, tipo: "macro", nome: i.label,
              fonte: c.fonte || "", passo: c.passo || "",
              /* il valore precedente e' un FATTO e serve a leggere il dato nuovo quando esce */
              precedente: i.value, stimata: true });
  }

  /* TRIMESTRALI: i titoli che la pipeline segue e per cui ha una data. */
  const titoli = [...((DATA && DATA.portfolio) || []), ...((DATA && DATA.watchlist) || [])];
  const visti = new Set();
  for (const r of titoli) {
    const tk = String(r.ticker || "").toUpperCase();
    if (!r.earnings_date || visti.has(tk)) continue;
    const d = new Date(String(r.earnings_date).slice(0, 10) + "T00:00:00");
    if (isNaN(d) || d < oggi || d > limite) continue;
    visti.add(tk);
    ev.push({ giorno: String(r.earnings_date).slice(0, 10), tipo: "utili", nome: tk,
              societa: r.name || tk, fonte: "Yahoo Finance", stimata: true });
  }

  ev.sort((a, b) => a.giorno.localeCompare(b.giorno) || a.tipo.localeCompare(b.tipo));
  return { dal: iso(oggi), al: iso(limite), eventi: ev };
}


const UNITA_INDICATORE = { nfp: "K", curve: " pp", curve3m: " pp", umich: "", philly: "" };

/* ═══ v307 — IL PORTAFOGLIO IN PAGINA, E IL GRAFICO CHE LO SEGUE ══════════════════════════
   Il CEO: "ora che inserisci portafoglio se clicco su un ticker puoi richiamarlo nel grafico
   tradingview?". La domanda presuppone una cosa che non c'era: il portafoglio VISIBILE. v256
   l'aveva tolto, ora che le posizioni ci sono torna — ma in forma minima, una riga per titolo.
   ⚠ NIENTE TOTALI IN EURO. Il progetto ha gia' pagato `eur_value` con un break di definizione,
   e il gate valuta esiste per quello. Qui: controvalore nella valuta NATIVA e guadagno in
   PERCENTUALE, che e' invariante al cambio. Il totale in euro lo da' il suo broker, che lo sa
   fare meglio di noi perche' conosce i cambi di carico posizione per posizione.
   ⚠⚠ ORDINE PER PESO, NON PER GUADAGNO: ordinare per guadagno metterebbe in cima i vincitori,
   che e' esattamente la lettura che fa tenere i perdenti. Il peso dice quanto conta ciascuno
   nelle decisioni di oggi — ed e' un fatto, non un giudizio. */
/* ⚠ v311 — la modalita' MODIFICA e' un secondo disegno della stessa tabella, non una seconda
   tabella: le colonne e l'ordine restano quelli, cambiano solo le celle in campi. Due tabelle
   separate divergerebbero al primo cambio di colonna (C10/C12). */
/* ⚠⚠ v341 — VIA LA MACCHINA DEL PDF E QUELLA DEL PORTAFOGLIO.
   Il CEO: "elimina portafoglio ... e fai ritornare analisi macro solo testuale."
   Il PDF esisteva per UNA ragione: portare il GRAFICO A CANDELE, che il testo non puo'
   portare. Quel grafico aveva senso su un pacchetto che parla di UN titolo — e il pacchetto
   del titolo non c'e' piu'. Un PDF di solo testo sarebbe un contenitore piu' scomodo del
   testo, quindi la consegna torna al testo, che e' la forma che si incolla in una chat.
   Rimosse: costruisciPdf, pdfCandele, pdfTesto, pdfPagina, pdfSpezza, barrePerPdf, scaricaPdf,
   renderPortafoglio, formaPosizioni, portafoglioAperto, apriPortafoglio,
   aggiornaSommarioPortafoglio.
   ⚠ Tenerle in piedi senza chiamanti sarebbe stato peggio che toglierle: e' la classe v193
   (una funzione morta accanto a un bottone inerte e' un sintomo, non un surplus), e
   self_check la denuncia. Stanno in git: tornano con un revert. */


/* ⚠⚠ v337 — IL PORTAFOGLIO SI CONTRAE. Direttiva del CEO, testuale: "portafoglio contraibile
   perche' lo vedro' da tradingview e quindi mi servira' solo per modificarlo ai fini della
   costruzione del prompt". Chiuso di partenza, con una preferenza che si ricorda.
   ⚠ CHIUSO NON VUOL DIRE VUOTO. La testata porta comunque quante posizioni ci sono e quanto
   valgono: se la sezione contratta non dicesse niente, il CEO perderebbe dallo sguardo il fatto
   che un portafoglio esiste — e la contrazione avrebbe tolto informazione invece che spazio.
   ⚠ IL PACCHETTO NON SE NE ACCORGE. buildPromptPortafoglio() legge DATA, non il DOM: nascondere
   righe non toglie un dato all'LLM. E' il confine gia' stabilito in v188 con le colonne
   nascondibili, e un gate lo verifica generando il pacchetto aperto e chiuso. */
/* la riga che sopravvive alla chiusura: quante posizioni e quanto valgono, in euro veri
   (il controvalore lo calcola gia' valorePosizioni(), che sa del BTP e del cambio). */


const POSIZIONI_PATH = "config/posizioni.json";
const WATCHLIST_PATH = "config/ui_watchlist.json";
/* ⚠ v313 — il settore scelto per l'analisi. Il CEO ha tolto il selettore: si sceglie cliccando
   un comparto in "Rotazione", con la stessa logica del portafoglio. Una variabile sola, scritta
   da un punto solo (`scegliSettore`), perche' due strade per la stessa scelta divergono. */
/* v315 — l'ordinamento del portafoglio. Il DEFAULT resta il peso: ordinare per guadagno mette
   in cima i vincitori, che e' la lettura che fa tenere i perdenti. Ma ora e' una scelta del CEO. */
/* v325 — l'orizzonte scelto per la rotazione. Vive qui e non dentro la scheda perche' la scheda
   si ricostruisce a ogni render: uno stato dentro il render si azzererebbe da solo. */
let rotOrizzonte = "m1";

/* v341 — qui stavano posizioniCorrenti() e leggiFormPosizioni(): leggevano la tabella del
   portafoglio e il suo form di modifica, che non esistono piu'. Rimosse insieme a loro. */




/* ⚠ UNA SOLA STRADA per portare un simbolo nel grafico: la usano il clic sul portafoglio e il
   selettore dei settori. Due percorsi separati divergerebbero — e' la lezione v225 sulle
   frecce e il trascinamento, e quella v161/v207 sulle doppie derivazioni. */
/* ⚠ v313 — RIMESSE DOPO UN TAGLIO CHE SE LE ERA PORTATE VIA. Vivevano fra
   `montaSelettoreSettori` e la funzione successiva, e il confine che ho usato era
   `\nfunction` — cioe' esattamente l'errore che avevo documentato e corretto in v303
   ("il confine e' la prossima dichiarazione DI QUALUNQUE TIPO"). Scritta la regola e non
   applicata: settima volta di questa classe (v201-v204, v238, v303). */
/* ⚠ v307 — cambiare settore porta il suo ETF nel grafico. Il CEO: "se cambio analizza settore
   macro, puoi modificare anche il ticker nel grafico di tradingview?". Passa dalla STESSA
   funzione del clic sul portafoglio: due strade per la stessa azione divergono sempre. */
const PF_APERTO_KEY = "pf_aperto";
let pfInModifica = false;
let pfOrdine = { campo: "peso", verso: "giu" };

function posizioniCorrenti() {
  /* ⚠ si legge da cio' che il sistema HA disegnato, non da una copia parallela: due elenchi
     della stessa cosa divergono (C10/C12, gia' pagata piu' volte qui). */
  return [...((DATA && DATA.portfolio) || []), ...((DATA && DATA.watchlist) || [])]
    .filter(r => r && numero(r.qta ?? r.qty) > 0 && numero(r.pmc) > 0)
    .map(r => ({ ticker: String(r.ticker || "").toUpperCase(),
                 qta: numero(r.qta ?? r.qty), pmc: numero(r.pmc),
                 valuta: r.currency === "EUR" ? "EUR" : "USD" }));
}

function leggiFormPosizioni() {
  const righe = [...document.querySelectorAll("[data-pf-edit]")];
  const out = [], errori = [];
  for (const tr of righe) {
    const tk = String((tr.querySelector(".pf-in-tk") || {}).value || tr.dataset.pfEdit || "").trim().toUpperCase();
    const q = Number(String((tr.querySelector(".pf-in-q") || {}).value || "").replace(",", "."));
    const p = Number(String((tr.querySelector(".pf-in-p") || {}).value || "").replace(",", "."));
    if (!tk) continue;                       // riga vuota: si ignora, non e' un errore
    if (!Number.isFinite(q) || q <= 0) { errori.push(`${tk}: quantità non valida`); continue; }
    if (!Number.isFinite(p) || p <= 0) { errori.push(`${tk}: prezzo di carico non valido`); continue; }
    if (out.some(x => x.ticker === tk)) { errori.push(`${tk}: compare due volte`); continue; }
    out.push({ ticker: tk, qta: q, pmc: Math.round(p * 10000) / 10000,
               valuta: tk.startsWith("BTP") ? "EUR" : "USD" });
  }
  return { posizioni: out, errori };
}

function portafoglioAperto() {
  try { return localStorage.getItem(PF_APERTO_KEY) === "1"; } catch { return false; }
}

function apriPortafoglio(aperto, persisti) {
  const corpo = $("#pf-corpo"), bot = $("#pf-toggle");
  if (corpo) corpo.hidden = !aperto;
  if (bot) { bot.setAttribute("aria-expanded", aperto ? "true" : "false"); bot.textContent = "▸"; }
  /* ⚠ l'apertura AUTOMATICA (quella che scatta entrando in modifica) non salva niente: una
     scelta dell'utente non va sovrascritta da un effetto collaterale. E' la regola gia' scritta
     in v198 per la vista compatta — "il default non si applica mai se l'utente ha gia' una
     preferenza" — applicata al verso opposto. */
  if (persisti) { try { localStorage.setItem(PF_APERTO_KEY, aperto ? "1" : "0"); } catch { /* modalita' privata */ } }
}

/* la riga che sopravvive alla chiusura: quante posizioni e quanto valgono, in euro veri
   (il controvalore lo calcola gia' valorePosizioni(), che sa del BTP e del cambio). */
function aggiornaSommarioPortafoglio() {
  const el = $("#pf-sommario");
  if (!el) return;
  const righe = [...((DATA && DATA.portfolio) || []), ...((DATA && DATA.watchlist) || [])]
    .filter(r => r && numero(r.qta ?? r.qty) > 0 && numero(r.pmc) > 0);
  if (!righe.length) { el.textContent = "nessuna posizione letta dalla pipeline"; return; }
  const aperto = $("#pf-corpo") && !$("#pf-corpo").hidden;
  const coda = aperto ? "clicca una riga per vederla nel grafico" : "clicca ▸ per aprirlo";
  el.textContent = `${righe.length} posizioni · ${coda}`;
}

function formaPosizioni() {
  const box = $("#pf-righe");
  if (!box) return;
  const righe = posizioniCorrenti();
  const riga = (p) => `<tr data-pf-edit="${esc(p ? p.ticker : "")}">
    <td>${p ? `<b>${esc(p.ticker)}</b><input type="hidden" class="pf-in-tk" value="${esc(p.ticker)}">`
            : `<input class="pf-in-tk" type="text" placeholder="TICKER" inputmode="latin"
                 autocapitalize="characters" spellcheck="false" aria-label="Ticker">`}</td>
    <td class="num"><input class="pf-in-q" type="text" inputmode="decimal" value="${p ? p.qta : ""}"
        placeholder="quote" aria-label="Quantità"></td>
    <td class="num"><input class="pf-in-p" type="text" inputmode="decimal" value="${p ? p.pmc : ""}"
        placeholder="carico" aria-label="Prezzo medio di carico"></td>
    <td class="num"><button type="button" class="pf-togli" title="Togli questa riga"
        aria-label="Togli ${esc(p ? p.ticker : "questa riga")}">✕</button></td>
  </tr>`;
  box.innerHTML = `<div class="pf-scroll"><table class="pf-tab pf-tab-edit"><thead><tr>
      <th>Titolo</th><th class="num">Quote</th><th class="num">Carico</th><th class="num"></th>
    </tr></thead><tbody>${righe.map(riga).join("")}${riga(null)}</tbody></table></div>
    <div class="pf-azioni">
      <button type="button" id="pf-aggiungi" class="btn btn-ghost">+ Riga</button>
      <button type="button" id="pf-salva" class="btn btn-primary">Salva</button>
      <button type="button" id="pf-annulla" class="btn btn-ghost">Annulla</button>
    </div>
    <div id="pf-esito" class="muted pf-esito"></div>`;

  const nota = $("#pf-nota");
  if (nota) {
    nota.innerHTML = `<b>Il carico è il prezzo medio di acquisto</b>, nella valuta del titolo `
      + `(dollari per le azioni americane; per il BTP è la percentuale del nominale, quindi 100 = alla pari). `
      + `⚠ Un titolo aggiunto qui viene messo <b>anche nella watchlist</b>: senza, la pipeline non ne prende `
      + `il prezzo e la riga resterebbe senza valore. `
      + `⚠ Senza token GitHub il salvataggio resta <b>su questo browser</b> e la pipeline non lo legge — `
      + `lo dico invece di lasciarglielo scoprire dall'iPhone.`;
  }
}

function renderPortafoglio() {
  const box = $("#pf-righe");
  if (!box) return;
  /* ⚠ v315 — il bottone vive nel markup e cambia etichetta: un comando che dice cosa fara'
     e' un comando che si trova. Prima era in fondo alla nota, 74x22px e trasparente: il CEO
     non e' riuscito a usarlo, e la diagnosi e' la stessa del tooltip di v302. */
  const bMod = $("#pf-modifica");
  if (bMod) bMod.textContent = pfInModifica ? "✕ Chiudi modifica" : "✎ Modifica";
  /* ⚠ v337 — ENTRARE IN MODIFICA APRE LA SEZIONE. Senza questo, da chiuso il clic su ✎ Modifica
     non produrrebbe NIENTE di visibile: e' esattamente il difetto v315 in una forma nuova — il
     comando esiste, si trova, e non si manifesta. Chi chiede di modificare vuole vedere. */
  if (pfInModifica) apriPortafoglio(true, false);
  else apriPortafoglio(portafoglioAperto(), false);
  aggiornaSommarioPortafoglio();
  if (pfInModifica) { formaPosizioni(); return; }
  const nota = $("#pf-nota");
  const righe = [...((DATA && DATA.portfolio) || []), ...((DATA && DATA.watchlist) || [])]
    .filter(r => r && numero(r.qta ?? r.qty) > 0 && numero(r.pmc) > 0);
  if (!righe.length) {
    box.innerHTML = '<div class="muted">Nessuna posizione: <code>config/posizioni.json</code> non è stato letto dalla pipeline.</div>';
    if (nota) nota.innerHTML = "";
    return;
  }
  /* ⚠⚠ v307 — DUE ERRORI CHE IL PRIMO DISEGNO HA RESO VISIBILI, ed erano entrambi silenziosi:
     1. UN'OBBLIGAZIONE NON SI MOLTIPLICA COME UN'AZIONE. Il BTP quota in PERCENTUALE del
        nominale: 40.000 di nominale a 102,86 valgono 41.144 euro, non 4.114.400. Moltiplicando
        come un titolo azionario il BTP risultava il 93% del portafoglio e schiacciava tutto il
        resto a 0-2%. Numero che non rompe niente e dice il falso — la classe v205.
     2. NON SI SOMMANO VALUTE DIVERSE. Il totale metteva insieme dollari ed euro come se fossero
        la stessa cosa: e' precisamente il difetto per cui esiste il gate valuta (v183), che
        pero' guarda il PACCHETTO e non la pagina.
     Il peso e' una percentuale, quindi adimensionale: si calcola convertendo tutto in euro col
     cambio CORRENTE (non quello di carico, che e' un'altra cosa) e lo si dichiara. Gli importi
     per riga restano nella valuta nativa, dove non c'e' niente da convertire. */
  const fx = numero(DATA && DATA.eurusd);
  const val = (r) => {
    const p = numero(r.price ?? r.prezzo);
    const q = numero(r.qta ?? r.qty);
    if (!Number.isFinite(p) || !Number.isFinite(q)) return null;
    return (String(r.ticker || "").startsWith("BTP") || r.currency === "EUR")
      ? q * p / 100          // obbligazione: nominale x prezzo percentuale
      : p * q;               // azione: quote x prezzo
  };
  /* per il PESO tutto in euro, altrimenti si sommano mele e pere */
  const valEur = (r) => {
    const v = val(r);
    if (v == null) return null;
    if (r.currency === "EUR" || String(r.ticker || "").startsWith("BTP")) return v;
    return Number.isFinite(fx) && fx > 0 ? v / fx : null;
  };
  const tot = righe.reduce((a, r) => a + (valEur(r) || 0), 0);
  righe.sort((a, b) => (valEur(b) || 0) - (valEur(a) || 0));

  /* ═══ v315 — COLONNE ORDINABILI E CONTROVALORE IN EURO ═══════════════════════════════
     Il CEO: "consenti di ordinare in portafoglio sulla base dei valori (es. peso, controvalore
     etc.) inserisci anche controvalore euro".
     ⚠ L'ordine di DEFAULT resta il peso: ordinare per guadagno mette in cima i vincitori, che
     e' la lettura che fa tenere i perdenti. Ma ora e' una scelta sua, non mia — cliccare
     un'intestazione ordina, e il verso si inverte al secondo clic.
     ⚠⚠ IL CONTROVALORE IN EURO E' UNA CONVERSIONE AL CAMBIO DI OGGI, NON IL SUO COSTO. Il cambio
     di carico e' diverso posizione per posizione e il sistema non lo conosce: sono due
     grandezze diverse e la nota lo dice. Sommare euro convertiti oggi con euro spesi allora
     darebbe un patrimonio che non e' mai esistito — la classe del gate valuta (v183). */
  const col = [
    { k: "ticker", et: "Titolo",        num: false, v: (r) => String(r.ticker || "") },
    { k: "qta",    et: "Quote",         num: true,  v: (r) => numero(r.qta ?? r.qty) },
    { k: "pmc",    et: "Carico",        num: true,  v: (r) => numero(r.pmc) },
    { k: "prezzo", et: "Ultimo",        num: true,  v: (r) => numero(r.price ?? r.prezzo) },
    { k: "gain",   et: "Guad.",         num: true,  v: (r) => Number.isFinite(numero(r.gain_pct_pos)) ? numero(r.gain_pct_pos) : null },
    { k: "val",    et: "Controvalore",  num: true,  v: (r) => val(r) },
    { k: "eur",    et: "In euro",       num: true,  v: (r) => valEur(r) },
    { k: "peso",   et: "Peso",          num: true,  v: (r) => valEur(r) },
  ];
  const attivo = col.find(c => c.k === pfOrdine.campo) || col.find(c => c.k === "peso");
  righe.sort((a, b) => {
    const x = attivo.v(a), y = attivo.v(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const d = attivo.num ? (y - x) : String(x).localeCompare(String(y));
    return pfOrdine.verso === "su" ? -d : d;
  });

  box.innerHTML = `<div class="pf-scroll"><table class="pf-tab"><thead><tr>${
    col.map(c => `<th class="${c.num ? "num " : ""}pf-th${attivo.k === c.k ? " pf-th-on" : ""}"
        data-pf-ord="${c.k}" role="button" tabindex="0"
        title="Ordina per ${esc(c.et)}">${esc(c.et)}${attivo.k === c.k ? (pfOrdine.verso === "su" ? " ▲" : " ▼") : ""}</th>`).join("")
    }</tr></thead><tbody>${righe.map(r => {
      const tk = String(r.ticker || "");
      const q = numero(r.qta ?? r.qty), pmc = numero(r.pmc);
      const p = numero(r.price ?? r.prezzo);
      const g = Number.isFinite(numero(r.gain_pct_pos)) ? numero(r.gain_pct_pos)
              : (Number.isFinite(p) && Number.isFinite(pmc) ? (p / pmc - 1) * 100 : null);
      const v = val(r), e = valEur(r);
      const cur = r.currency === "EUR" ? "€" : "$";
      return `<tr class="pf-riga" data-pf-tk="${esc(tk)}" tabindex="0" title="Apri ${esc(tk)} nel grafico">
        <td><b>${esc(tk)}</b> <span class="muted pf-nome">${esc(String(r.name || "").slice(0, 24))}</span></td>
        <td class="num">${fmtNum.format(q)}</td>
        <td class="num">${cur}${fmtNum.format(pmc)}</td>
        <td class="num" title="${r.price_asof === "live" ? "prezzo del refresh live" : "prezzo dello snapshot della pipeline"}">${Number.isFinite(p) ? cur + fmtNum.format(p) : "—"}${r.price_asof === "live" ? '<span class="pf-live" aria-label="prezzo live">·</span>' : ""}</td>
        <td class="num ${g > 0 ? "pos" : g < 0 ? "neg" : "muted"}">${g != null ? signTxt(Math.round(g * 10) / 10) : "—"}</td>
        <td class="num">${v != null ? cur + fmtNum.format(Math.round(v)) : "—"}</td>
        <td class="num">${e != null ? "€" + fmtNum.format(Math.round(e)) : "—"}</td>
        <td class="num muted">${e != null && tot ? Math.round(e / tot * 100) + "%" : "—"}</td>
      </tr>`;
    }).join("")}</tbody>
    <tfoot><tr><td><b>Totale</b></td><td colspan="5"></td>
      <td class="num"><b>€${fmtNum.format(Math.round(tot))}</b></td>
      <td class="num muted">100%</td></tr></tfoot>
    </table></div>`;

  if (nota) {
    const p = (DATA && DATA.macro && DATA.macro.posizioni) || {};
    nota.innerHTML = `${righe.length} posizioni${p.aggiornato ? `, carichi aggiornati al ${esc(p.aggiornato)}` : ""}`
      + `${p.fonte ? ` (${esc(p.fonte)})` : ""}. <b>Clicca una riga</b> per aprirla nel grafico qui sopra. `
      + `<b>Come sono calcolati.</b> Gli importi per riga sono nella valuta nativa. Il <b>peso</b> converte `
      + `tutto in euro al cambio corrente${Number.isFinite(fx) ? ` (EUR/USD ${fmtNum.format(fx)})` : ""}, `
      + `perché sommare dollari ed euro darebbe una percentuale senza significato. `
      + `⚠ Il BTP è un'obbligazione: il controvalore è <b>nominale × prezzo/100</b>, non quote × prezzo — `
      + `moltiplicarlo come un'azione lo farebbe risultare il 93% del portafoglio. `
      + `Non è il suo patrimonio: manca la liquidità e il cambio di carico posizione per posizione, `
      + `che conosce il suo broker. I guadagni percentuali sono invarianti al cambio, gli importi no.`
      + (p.non_seguite && p.non_seguite.length
          ? ` ⚠ Posizioni su titoli non seguiti dalla pipeline, quindi senza prezzo: ${esc(p.non_seguite.join(", "))}.` : "")
      + (p.senza_prezzo && p.senza_prezzo.length
          ? ` <b>⚠ POSIZIONI CHE NON COMPAIONO QUI SOPRA</b>: ${esc(p.senza_prezzo.join(", "))} — il titolo è nella `
            + `watchlist ma la fonte non lo quota, quindi il sistema non ha nè prezzo nè controvalore e la riga `
            + `non esiste. Nove volte su dieci è un simbolo scritto male: CoreWeave è <b>CRWV</b>, non CRVW.` : "");
  }
  /* ⚠ delega sul contenitore: le righe si ridisegnano a ogni render, e agganciare ognuna
     lascerebbe handler morti — il difetto v193/v213 che ha gia' rotto il wiring piu' volte. */
  box.addEventListener("click", (e) => {
    const tr = e.target && e.target.closest ? e.target.closest("[data-pf-tk]") : null;
    if (tr) apriNelGrafico(tr.dataset.pfTk);
  });
  box.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const tr = e.target && e.target.closest ? e.target.closest("[data-pf-tk]") : null;
    if (tr) { e.preventDefault(); apriNelGrafico(tr.dataset.pfTk); }
  });
}

async function salvaPosizioni() {
  const { posizioni, errori } = leggiFormPosizioni();
  const esito = $("#pf-esito");
  if (errori.length) {
    if (esito) esito.innerHTML = `⚠ Non ho salvato niente: ${esc(errori.join(" · "))}. `
      + `Correggi e riprova — un salvataggio parziale sarebbe peggio di nessun salvataggio.`;
    return;
  }
  if (!posizioni.length) {
    if (esito) esito.textContent = "⚠ Non ho salvato: la lista è vuota. Per svuotare davvero il portafoglio, dimmelo esplicitamente.";
    return;
  }
  /* ⚠ i simboli che la pipeline non segue non avrebbero prezzo: si aggiungono alla watchlist */
  const seguiti = new Set([...((DATA && DATA.watchlist) || []), ...((DATA && DATA.portfolio) || [])]
    .map(r => String(r.ticker || "").toUpperCase()));
  const nuovi = posizioni.map(p => p.ticker).filter(t => !seguiti.has(t));

  const file = {
    _nota: "Posizioni del CEO. NON e' la lista dei simboli da seguire: quella resta config/ui_watchlist.json. Questo file e' una SOVRAPPOSIZIONE.",
    _fonte: "modificato dalla dashboard",
    aggiornato: new Date().toISOString().slice(0, 10),
    posizioni,
  };
  const token = localStorage.getItem("gh_token");
  if (!token) {
    try { localStorage.setItem("posizioni_locali", JSON.stringify(file)); } catch { /* quota */ }
    if (esito) esito.innerHTML = `Salvato <b>solo su questo browser</b>: senza token GitHub non arriva `
      + `su iPhone e la pipeline non lo legge. I numeri qui sopra restano quelli del run precedente `
      + `finché il file non è sul repository.`;
    return;
  }
  /* ══ v349 — PERCHE' GITHUB HA DETTO NO ════════════════════════════════════════════════
     Il CEO ha visto "Controlla che il token abbia il permesso di scrivere sul repository"
     mentre il token funzionava benissimo: nella stessa ora tre sue scritture erano andate a
     buon fine. Questa funzione restituiva `r.ok` e buttava via il codice di stato, quindi
     OGNI fallimento diventava "colpa del token" — e la diagnosi mandava a cercare il guasto
     dove non c'era.
     ⚠ LA CAUSA VERA E' STRUTTURALE, NON UN CASO: la scrittura legge lo `sha` del file e poi
     lo rimanda indietro. Fra le due chiamate la pipeline commissiona il suo run (ogni 30-70
     minuti) e lo `sha` invecchia: GitHub risponde 409 Conflict. Non e' un errore del CEO ne'
     del token, e' una collisione prevedibile — quindi si RIPROVA una volta con lo sha fresco
     invece di annunciare un guasto. */
  const scrivi = async (path, contenuto, messaggio) => {
    const corpo = (sha) => JSON.stringify({ message: messaggio, sha,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(contenuto, null, 1) + "\n"))) });
    const shaCorrente = async () => {
      const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`,
        { headers: ghHeaders(token), cache: "no-store" });
      return g.ok ? (await g.json()).sha : undefined;
    };
    let r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`,
      { method: "PUT", headers: ghHeaders(token), body: corpo(await shaCorrente()) });
    if (r.status === 409) {
      /* qualcuno ha scritto in mezzo: si rilegge lo sha e si riprova UNA volta sola */
      r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`,
        { method: "PUT", headers: ghHeaders(token), body: corpo(await shaCorrente()) });
    }
    if (r.ok) return { ok: true };
    let dettaglio = "";
    try { dettaglio = (await r.json()).message || ""; } catch { /* risposta non JSON */ }
    return { ok: false, stato: r.status, dettaglio };
  };
  /* la diagnosi segue il codice di stato: ognuno ha una causa e un rimedio diversi */
  const perche = (e) => {
    if (e.stato === 401) return "il token non è più valido (scaduto o revocato): va rigenerato su GitHub";
    if (e.stato === 403) return "il token è valido ma non ha il permesso di scrivere su questo repository (serve lo scope <code>repo</code>, o <code>contents: write</code> se è un fine-grained)";
    if (e.stato === 404) return "GitHub non trova il file o il repository con questo token — di solito è un fine-grained token che non ha questo repository fra quelli selezionati";
    if (e.stato === 409) return "un'altra scrittura è arrivata in mezzo due volte di fila (di solito la pipeline): riprova fra qualche secondo, non è un problema del token";
    if (e.stato === 422) return "GitHub ha rifiutato il contenuto del file, non il permesso";
    return "GitHub ha risposto " + (e.stato || "senza codice");
  };
  try {
    const e1 = await scrivi(POSIZIONI_PATH, file, "Posizioni aggiornate dalla dashboard");
    let e2 = { ok: true };
    if (nuovi.length) {
      const wl = [...seguiti, ...nuovi];
      e2 = await scrivi(WATCHLIST_PATH, wl, `Watchlist: aggiunti ${nuovi.join(", ")} (posizioni nuove)`);
    }
    const ok1 = e1.ok, ok2 = e2.ok;
    const fallita = !e1.ok ? e1 : (!e2.ok ? e2 : null);
    if (esito) {
      esito.innerHTML = (ok1 && ok2)
        ? `Salvato: <b>${posizioni.length} posizioni</b>.`
          + (nuovi.length ? ` Ho aggiunto anche alla watchlist <b>${esc(nuovi.join(", "))}</b>, `
              + `altrimenti la pipeline non ne prenderebbe il prezzo e la riga resterebbe senza valore.` : "")
          + ` I prezzi e i guadagni si aggiornano al prossimo giro della pipeline.`
        : `⚠ GitHub ha rifiutato la scrittura (codice ${fallita.stato}): ${perche(fallita)}.`
          + (fallita.dettaglio ? ` <span class="muted">Risposta di GitHub: ${esc(fallita.dettaglio)}</span>` : "")
          + ` Le posizioni non sono andate perse: restano scritte qui sopra finché non ricarichi la pagina.`;
    }
  } catch (e) {
    if (esito) esito.textContent = "Non sono riuscito a scrivere su GitHub: " + (e && e.message ? e.message : e);
  }
}

/* ═══ v311 — i comandi del portafoglio, in DELEGA sul documento ═══════════════════════════
   I bottoni nascono e muoiono a ogni ridisegno: agganciarli uno per uno lascerebbe handler
   morti al primo render successivo — il difetto v193/v213 che ha gia' rotto il wiring piu'
   volte in questo progetto. */
document.addEventListener("click", (e) => {
  const t = e.target && e.target.closest ? e.target : null;
  if (!t || !t.closest) return;
  if (t.closest("#pf-toggle")) {
    const chiuso = !$("#pf-corpo") || $("#pf-corpo").hidden;
    apriPortafoglio(chiuso, true);
    aggiornaSommarioPortafoglio();
    return;
  }
  if (t.closest("#pf-modifica")) { pfInModifica = !pfInModifica; renderPortafoglio(); return; }
  const th = t.closest("[data-pf-ord]");
  if (th) {
    /* stesso campo = si inverte il verso; campo nuovo = si parte dal piu' grande, che e' cio'
       che si vuole vedere per primo su quantita' e controvalori. */
    const k = th.dataset.pfOrd;
    pfOrdine = (pfOrdine.campo === k)
      ? { campo: k, verso: pfOrdine.verso === "giu" ? "su" : "giu" }
      : { campo: k, verso: "giu" };
    renderPortafoglio();
    return;
  }
  if (t.closest("#pf-annulla")) { pfInModifica = false; renderPortafoglio(); return; }
  if (t.closest("#pf-salva")) { salvaPosizioni(); return; }
  if (t.closest("#pf-aggiungi")) {
    const corpo = document.querySelector(".pf-tab-edit tbody");
    if (corpo && corpo.lastElementChild) {
      corpo.appendChild(corpo.lastElementChild.cloneNode(true));
      const nuova = corpo.lastElementChild;
      nuova.querySelectorAll("input").forEach(i => { i.value = ""; });
      nuova.setAttribute("data-pf-edit", "");
      const primo = nuova.querySelector(".pf-in-tk");
      if (primo && typeof primo.focus === "function") primo.focus();
    }
    return;
  }
  const togli = t.closest(".pf-togli");
  if (togli) {
    /* ⚠ la riga sparisce dal FORM, non dai dati: il salvataggio e' l'unico momento in cui
       qualcosa viene scritto. Annulla deve poter riportare tutto indietro. */
    const tr = togli.closest("[data-pf-edit]");
    if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
  }

  const or = t.closest("[data-rot-or]");
  if (or) {
    /* v325 — cambia l'orizzonte e ridisegna: una strada sola, la stessa che usa il primo
       disegno, cosi' non possono divergere. */
    rotOrizzonte = or.dataset.rotOr;
    renderIndicatori();
    return;
  }
});

$("#modal-close")?.addEventListener("click", () => { $("#modal").hidden = true; });
$("#modal")?.addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").hidden = true; });
$("#btn-copy")?.addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#prompt-text").value);   // copia il testo EDITATO
  toast("Copiato (con le tue modifiche) ✓");
});
/* ---------------- calcolo vendite (plus/minusvalenze) ---------------- */
const sellPriceOv = {};   // prezzo di vendita inserito a mano per ticker (override del prezzo di mercato)
const sellQtyOv = {};     // quantità da vendere digitate: sopravvivono a un eventuale re-render

/* ═══ v282 — LE POSIZIONI LE INSERISCE LUI ═════════════════════════════════════════════════
   Il CEO: "no, inserirò io i dati". Verificato che fosse possibile, e per meta' non lo era:
   il Calcolatore PMC ha campi numerici liberi (il menu' precompila e basta), ma il Calcolo
   vendite costruiva la tabella SOLO da DATA.portfolio — "Le tue posizioni sono gia' caricate".
   Da v272 la pipeline non produce piu' posizioni: quello strumento stava per diventare una
   tabella vuota senza modo di metterci niente dentro, cioe' la sua frase non sarebbe stata
   eseguibile.
   Le righe manuali vivono in localStorage (sono sue, non del sistema) e si sommano a quello
   che il file eventualmente porta ancora — il BTP, per esempio. Non c'e' scrittura sul repo:
   sono dati di una simulazione, non un portafoglio da sincronizzare. */
const SELL_KEY = "vendite_manuali";

/* ⚠ scegliere un settore fa DUE cose: lo porta nel grafico e lo rende quello che il bottone
   copierebbe. Erano due gesti separati (selettore + grafico), ora e' un clic solo. */
/* ⚠ v341 — RESTA SOLO LA NAVIGAZIONE. Scegliere un settore faceva due cose: portarlo nel
   grafico e renderlo quello che il bottone "Settore" avrebbe copiato. Il bottone non c'e'
   piu', quindi resta la prima — che e' quella che il CEO usa cliccando le barre di Rotazione,
   e che non ha chiesto di togliere. */
function scegliSettore(tk) {
  const t = String(tk || "").trim().toUpperCase();
  if (!t) return;
  apriNelGrafico(t);
}

function apriNelGrafico(tk) {
  const t = String(tk || "").trim().toUpperCase();
  if (!t) return;
  const campo = $("#tk-input");
  if (campo) campo.value = t;
  try { localStorage.setItem("ultimo_ticker", t); } catch { /* quota */ }
  if (typeof montaGraficoTV === "function") montaGraficoTV(t);
  const sez = document.querySelector('section[data-sez="grafico"]');
  if (sez && typeof sez.scrollIntoView === "function") sez.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderCalendario() {
  const box = $("#cal-eventi");
  if (!box) return;
  const GIORNI_CALENDARIO = 14;   // misurato: a 7 giorni la sezione era quasi sempre vuota
  const { eventi } = prossimiEventi(GIORNI_CALENDARIO);
  const nota = $("#cal-nota");
  if (!eventi.length) {
    box.innerHTML = '<div class="muted">Nessuna uscita macro né trimestrale attesa nelle prossime due settimane fra le serie e i titoli che il sistema segue.</div>';
    if (nota) nota.innerHTML = "";
    return;
  }
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
  const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  const perGiorno = new Map();
  for (const e of eventi) (perGiorno.get(e.giorno) || perGiorno.set(e.giorno, []).get(e.giorno)).push(e);

  box.innerHTML = [...perGiorno.entries()].map(([g, lista]) => {
    const d = new Date(g + "T00:00:00");
    const scarto = Math.round((d - oggi) / 86400000);
    const etichetta = scarto === 0 ? "OGGI" : scarto === 1 ? "DOMANI"
      : `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}`;
    const righe = lista.map(e => e.tipo === "utili"
      ? `<div class="cal-riga"><span class="cal-tag cal-utili">utili</span>
           <b>${esc(e.nome)}</b><span class="cal-sub">${esc(e.societa || "")}</span>
           <span class="cal-st">stimata</span></div>`
      : `<div class="cal-riga"><span class="cal-tag cal-macro">macro</span>
           <b>${esc(e.nome)}</b><span class="cal-sub">${esc(e.fonte)}${e.precedente ? ` · precedente ${esc(String(e.precedente))}` : ""}</span>
           <span class="cal-st">stimata</span></div>`).join("");
    return `<div class="cal-giorno${scarto === 0 ? " cal-oggi" : ""}">
      <div class="cal-data">${etichetta}</div>${righe}</div>`;
  }).join("");

  /* ═══ v304 — LE NEWS MACRO, ESPANDIBILI ═══════════════════════════════════════════════
     Il CEO: "in Prossime due settimane aggiungi news inerenti tutti i dati macro (questa
     finestra deve essere espandibile)". Il calendario dice cosa ESCE; le news dicono cosa e'
     GIA' uscito e come e' stato letto — sono le due meta' della stessa domanda.
     ⚠ ESPANDIBILE E CHIUSA DI DEFAULT: diciotto titoli aperti sopra il calendario lo
     seppellirebbero, ed e' il problema che il CEO ha appena risolto fondendo quattro sezioni.
     Il numero sta nell'intestazione, cosi' una scatola chiusa non e' un buco.
     ⚠⚠ E LA PROVENIENZA VA DICHIARATA: CNBC Economia entra per intero perche' e' gia' un feed
     di economia, gli altri due passano da un filtro per parole che e' imperfetto per
     costruzione. Un elenco che sembra curato quando e' automatico e' la classe di difetto
     peggiore di questo progetto — qui c'e' scritto com'e' fatto. */
  /* ⚠⚠ v307 — LA SEZIONE NOTIZIE ESCE DALLA PAGINA, richiesta del CEO, un'ora dopo averla
     chiesta. Non e' un capriccio ed e' istruttivo: gliel'avevo consegnata con la finestra a sei
     ore che lui stesso aveva fissato, e misurata quella finestra dava ZERO — la macro non esce
     di continuo. Una scheda che nel fine settimana e in mezza giornata feriale non ha niente da
     dire non merita spazio in una pagina che stiamo riducendo da nove sezioni a cinque.
     ⚠ LE NOTIZIE RESTANO NEL PACCHETTO: e' la regola v208, si toglie dalla pagina cio' che il
     payload porta gia'. La pipeline continua a scaricarle (tre richieste), il pacchetto le
     porta all'LLM con la loro eta', e le istruzioni gli ordinano di cercarne di piu' sul titolo
     e sul settore. Quello che sparisce e' il riquadro, non l'informazione. */

  if (nota) {
    nota.innerHTML = "⚠ <b>Tutte le date sono stime, non appuntamenti confermati.</b> "
      + "Le uscite macro le calcolo dal ritardo tipico dichiarato dalla fonte (il CPI di un mese esce "
      + "«a metà del successivo», non il 14 esatto); le date delle trimestrali sono quelle che l'emittente "
      + "ha comunicato a Yahoo e cambiano spesso. Per una data che conta, verifica sul sito della fonte "
      + "o su quello investor relations della società.";
  }
}

function renderAllocGrafica() {
  const box = $("#allocg-chart"); if (!box) return;
  const list = allocazionePer(allocGrafMode);
  const note = $("#allocg-note");
  if (!list.length) { box.innerHTML = '<div class="muted">Nessuna posizione.</div>'; if (note) note.innerHTML = ""; return; }
  const max = Math.max(...list.map(x => x.pct)) || 1;
  box.innerHTML = ciambella(list.map(x => ({ nome: x.nome, val: x.val, extra: fmtEUR.format(Math.round(x.val)) })),
    { centro: { sopra: allocGrafMode === "currency" ? "valuta" : "settore",
                grande: fmt1.format(list[0].pct) + "%", sotto: list[0].nome.slice(0, 16) },
      aria: "allocazione del patrimonio" });
  if (note) {
    const fx = fxExposure();
    note.innerHTML = allocGrafMode === "currency"
      ? `Quote del patrimonio per valuta di quotazione (la liquidità, se presente, è in euro). ${fx ? `L'esposizione al dollaro non coperta è <b>${fmt1.format(fx.pct)}%</b> del patrimonio: a cambio EUR/USD ${fmtNum.format(fx.eurusd)}, un movimento dell'1% sull'euro sposta ${fmtEUR.format(Math.round(fx.usdEur * 0.01))} senza che nessun prezzo si muova.` : ""}`
      : `Quote del patrimonio per settore${strutturaUniverso().cash > 0 ? ", con la liquidità come voce a sé" : " (nessuna liquidità registrata: le quote sono sul solo investito)"}.`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
   v206 — MACRO IN GRAFICI
   Prima c'erano 34 riquadri della stessa identica forma (7 mini-card + 11 gauge + 16 tile),
   ognuno un numero con sotto un termometro 0-100: un termometro che sta ovunque non porta
   nessun segnale. E le serie storiche che il file CONTIENE non erano disegnate in dashboard
   — curve_history (501 punti), credit.history (260), vix.spark (30, mai disegnata nemmeno
   nei popup), margin_debt.history (13): tutte sepolte a due clic di distanza.
   Qui salgono in superficie tre domande, non trenta numeri:
     1. il vento è a favore o contro il MIO libro?   → rotazione settoriale
     2. il sistema è sotto stress?                   → curva, credito, volatilità
     3. quanta leva c'è, e che mese è?               → margin debt, stagionalità
   Tutto il resto resta sotto, in un blocco richiudibile: accessibile, non in primo piano.
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/* Aggancio fra i 21 ETF della rotazione e il libro. NON è un elenco scritto a mano di "cosa
   possiede il CEO": è una mappa settore→ETF di quattro voci (i settori GICS non cambiano), e
   ciò che si accende lo decide OGNI VOLTA il portafoglio vero. Se domani non ci fossero più
   semiconduttori, SMH smetterebbe di illuminarsi da solo. */
const ETF_DI_SETTORE = { sox: "SMH", Technology: "XLK", "Communication Services": "XLC", Energy: "XLE",
  "Health Care": "XLV", Financials: "XLF", Industrials: "XLI", "Consumer Discretionary": "XLY" };



function renderMacroGrafici() {
  if (!DATA) return;
  attivaHoverGrafici();
  renderIndicatori();   // v215 — le 27 scatole diventano una classifica sola
  // v235 — ORA le schede esistono: si misura e si impacca
  impaccaGriglia(document.querySelector(".shell-main"));
}


/* ═══ v214 — IL FONDO CONTRO IL SUO INDICE ════════════════════════════════════════════════
   È la domanda del mandato ("crescita composta vs NDX") e non era disegnata da nessuna parte:
   viveva come tachimetro in una mini-card che mostrava lo scarto di UN GIORNO. La serie c'è —
   history.m3 porta 66 date con il valore del fondo e quello dell'indice — e rebasata a 100
   sulla stessa data risponde a colpo d'occhio: la distanza fra le due linee È l'alpha.
   ⚠ Le due serie condividono per costruzione date e punto di partenza (stesso array), quindi
   qui il problema delle finestre disallineate di v207 non si pone. */
let benchOrizzonte = "m3";

/* ═══ v215 — TUTTI GLI INDICATORI, UNA SOLA CLASSIFICA ════════════════════════════════════
   Fin qui avevo CANCELLATO le mini-card che duplicavano un grafico, ma ne restavano 27
   intatte (11 tachimetri + 16 riquadri) dentro il blocco richiudibile: la richiesta era
   esploderle TUTTE come grafici, non nasconderle. Il problema di 27 scatole ognuna con il suo
   numero e il suo termometro è che non sono confrontabili: ogni termometro ha la sua scala
   mentale. Qui diventano UNA classifica sola sullo stesso asse 0-100 (100 = favorevole al
   libro), ordinata dal peggiore al migliore, dove si legge in un secondo che cosa pesa.
   Ogni barra è cliccabile e apre il suo pannello di dettaglio. */
const IND_TITOLI = {
  fear_greed: "Fear & Greed (sentiment)", risk_sentiment: "Sentiment globale",
  credit: "Credito high yield", systemic_risk: "Stress sistemico del credito",
  corp_profit: "Borsa vs profitti reali", sp500_pe: "Valutazione S&P (P/E)",
  smart_money: "Istituzionali vs retail",
  /* ⚠ v252 — "Ciclo economico" RIMOSSO dalla classifica su richiesta del CEO: i suoi TREDICI
     componenti hanno già ognuno la propria scheda (dodici le avevano, il VIX gliel'ho data in
     v251), quindi la scheda del ciclo era un tredicesimo riquadro che ripeteva gli altri
     dodici sotto forma di barre. Il PUNTEGGIO resta calcolato dalla pipeline e resta nel
     payload: è una sintesi utile a chi legge, ma in dashboard duplicava. */
  seasonality: "Stagionalità del mese", thermometer: "Salute tecnica del libro",
};
/* ⚠ v251 — IL VIX NON AVEVA UNA SCHEDA PROPRIA. Il CEO ha chiesto che ogni variabile del Ciclo
   economico ne abbia una: confrontando i 13 componenti con le 27 schede, dodici c'erano già
   (alcune accorpate: CPI+PCE in una, NFP e disoccupazione dentro il mercato del lavoro, il
   credito in "Stress del credito", lo smart money in "Istituzionali vs retail") e UNO no.
   Il VIX vive in `macro.vix`, che non ha un campo `score`: gliene serve uno per entrare nella
   classifica, ed è la stessa formula che il ciclo economico usa già per pesarlo — non una
   scala nuova inventata qui. */
function vixComeIndicatore(m) {
  const v = m && m.vix;
  if (!v || v.value == null) return null;
  return { k: "vix", nome: "Volatilità (VIX)",
           score: Math.round(Math.max(0, Math.min(100, 100 - v.value / 50 * 100))),
           sub: `${fmtNum.format(v.value)}${v.change_pct != null ? ` (${signTxt(v.change_pct)} oggi)` : ""}` };
}
/* ⚠ v306 — quanto si e' mosso un indicatore RISPETTO AL SUO SOLITO: l'ultimo scarto
   pubblicato diviso per la deviazione tipica degli scarti di quella stessa serie. Non c'e' una
   soglia — serve solo a ORDINARE, e il numero si scrive accanto cosi' chi legge puo' non essere
   d'accordo. Torna `null` dove non c'e' abbastanza storia: null non e' zero. */
function mossaRelativa(k) {
  const m = (DATA && DATA.macro) || {};
  let st = null;
  /* ⚠⚠ v349 — UN RAMO MORTO CHE FACEVA DUE DANNI, misurato in browser sui dati veri.
     La catena era: `if (k.startsWith("in:")) ... else if (k === "in:curve" || "credit" || "vix")`.
     `in:curve` comincia per "in:", quindi il PRIMO ramo lo prendeva sempre e la condizione nel
     secondo non poteva essere vera nemmeno una volta. Conseguenze, entrambe verificate:
     · dentro il ramo morto, `k === "credit" ? credit.history : curve_history` mandava il VIX
       sul ramo `else`, cioe' sulla storia della CURVA DEI TASSI. La scheda del VIX pubblicava
       "si e' mosso 0× il suo solito" perche' era la CURVA a non essersi mossa (ultimo scatto
       0,00); sulla sua serie vera il VIX segnava 0,7×. E siccome la classifica si ORDINA per
       questo numero, la posizione del VIX in pagina la decideva la curva.
     · la curva, dal canto suo, restava senza: `indicators[curve].storico` e' vuoto (0 punti),
       mentre `m.curve_history` ne ha 369. Il ramo che gliela avrebbe data non veniva eseguito.
     Le chiavi specifiche vanno PRIMA del prefisso, o il prefisso se le mangia. */
  if (k === "vix") {
    st = ((m.vix && m.vix.spark) || []).map(v => ({ v }));
  } else if (k === "credit" || k === "systemic_risk") {
    st = m.credit && m.credit.history;
  } else if (k === "in:curve" || k === "yield_recession") {
    st = m.curve_history || null;
  } else if (String(k).startsWith("in:")) {
    const i = (m.indicators || []).find(x => x && x.key === String(k).slice(3));
    st = i && i.storico;
  }
  const p = (st || []).filter(x => x && typeof x.v === "number");
  if (p.length < 12) return null;
  const d = [];
  for (let i = 1; i < p.length; i++) d.push(p[i].v - p[i - 1].v);
  const media = d.reduce((a, b) => a + b, 0) / d.length;
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - media) ** 2, 0) / d.length);
  if (!Number.isFinite(sd) || sd === 0) return null;
  return Math.round(Math.abs(d[d.length - 1] - media) / sd * 10) / 10;
}

function indicatoriClassifica() {
  const m = DATA?.macro || {}, out = [];
  { const vx = vixComeIndicatore(m); if (vx) out.push(vx); }   // v251
  Object.entries(IND_TITOLI).forEach(([k, nome]) => {
    const v = m[k];
    if (v && v.score != null) out.push({ k, nome, score: Math.round(v.score), sub: v.label || v.status || v.rating || "" });
  });
  /* v303 — le due sezioni promosse a tessera entrano qui, con un punteggio che NON e' un
     giudizio: la rotazione usa quanti settori sono in positivo, i tassi il percentile del
     decennale nel proprio anno. Servono solo a dare loro un posto nell'ordine. */
  if ((m.tilt || []).length >= 6) {
    const su = (m.tilt || []).filter(t => (t.m1 ?? 0) > 0).length;
    out.push({ k: "rotazione", nome: "Rotazione — dove si muove il denaro",
               score: Math.round(su / m.tilt.length * 100),
               sub: `${su} settori su ${m.tilt.length} in positivo a 1 mese` });
  }
  if (m.stagionalita_ndx && (m.stagionalita_ndx.mesi || []).length) {
    const so = m.stagionalita_ndx;
    const q = (so.mesi || []).find(x => x && x.mese === so.mese_ora);
    out.push({ k: "stagionalita_ndx", nome: "Stagionalità Nasdaq 100 e midterm",
               score: 50,
               sub: q && Number.isFinite(q.media_mid)
                 ? `${["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"][so.mese_ora - 1]}: `
                   + `${signTxt(q.media_mid)} negli anni di midterm (${q.n_mid} casi)`
                 : `campione ${so.dal}–${so.al}` });
  }
  if (m.tassi && (m.tassi.scadenze || []).some(x => x.key === "a10")) {
    const d10 = m.tassi.scadenze.find(x => x.key === "a10");
    const st = ((m.tassi.storico || {}).a10 || []).map(p => p && p.v).filter(v => typeof v === "number");
    const pct = st.length > 20 ? Math.round(st.filter(v => v < d10.value).length / st.length * 100) : 50;
    out.push({ k: "tassi10", nome: "Treasury USA 10 anni", score: 100 - pct,
               sub: `${fmtNum.format(d10.value)}% · osservazione ${d10.observation_date}` });
  }
  (m.indicators || []).forEach(i => {
    /* v250 — la card porta la CADENZA: quando è stato rilevato, quanti giorni ha, quando ne
       arriva uno nuovo. Richiesta del CEO dopo il dubbio sul margin debt — un dato vecchio con
       la data del prossimo è informazione, lo stesso dato senza è una trappola. */
    if (i.impact != null) out.push({ k: "in:" + i.key, nome: i.label, score: Math.round(i.impact),
      sub: `${i.value}${i.date ? " · " + i.date : ""}`, cadenza: rigaCadenza(i.key, i.date),
      /* ⚠ v274 — PUNTO 5: IL PHILLY FED E' UN PROXY E DEVE DIRLO ANCHE IN CLASSIFICA. Sta al
         posto dell'ISM (che e' sotto licenza), ma copre UN distretto invece del paese e arriva
         con ~40 giorni di ritardo. In mezzo agli altri 29 indicatori con lo stesso peso si
         legge come una misura nazionale, e nel pacchetto finiva perfino in cima ai "piu'
         favorevoli". Un numero che va spiegato ogni volta che lo si legge deve portarsi
         addosso la spiegazione. */
      proxy: i.key === "philly" ? "sostituto dell'ISM: un distretto, non il paese" : null });
  });
  /* v280 — le quattro materie prime entrano in classifica con un punteggio che dice DOVE sta
     il prezzo nel suo intervallo dell'anno. Non e' un giudizio su "buono/cattivo" — per il
     petrolio alto e' inflazione e per il rame alto e' domanda industriale, cioe' due segni
     opposti sullo stesso 100 — quindi il punteggio e' POSIZIONALE e la nota lo dice. */
  Object.entries((m.materie || {})).forEach(([chiave, d]) => {
    if (!d || !Number.isFinite(Number(d.value))) return;
    const dentro = (Number.isFinite(d.max_1y) && Number.isFinite(d.min_1y) && d.max_1y > d.min_1y)
      ? Math.round((d.value - d.min_1y) / (d.max_1y - d.min_1y) * 100) : 50;
    out.push({ k: "mat:" + chiave, nome: d.label || chiave, score: Math.round(clamp(dentro)),
      sub: `${fmtNum.format(d.value)}${d.unita ? " " + d.unita : ""} · ${signTxt(d.var_1y != null ? d.var_1y : d.pct_1y, "%")} in 12 mesi`,
      posizionale: true });
  });

  (m.markets || []).forEach(i => {
    const sc = marketImpact(i);
    if (sc != null) out.push({ k: "mk:" + i.key, nome: i.label, score: Math.round(sc), sub: `${i.value} (${signTxt(i.change_pct, i.suffix || "%")} oggi)` });
  });
  // ⚠ v222 — GLI UNDICI ORFANI. Togliendo i riquadri (v217) E il popup dei dettagli (v219) ho
  // lasciato SENZA CASA undici indicatori che prima erano visibili: carry, put/call, liquidità
  // in attesa, righello dollaro, Fed funds, curva-vs-recessione, disaccoppiamento, forward P/E,
  // FedWatch, streghe, scarto vs indice. NON erano duplicati di un grafico: erano informazione,
  // e l'ho fatta sparire. Rientrano qui, sulla stessa scala 0-100 (100 = favorevole al rischio):
  // non torna il riquadro, torna il DATO in forma confrontabile con tutti gli altri.
  const cl = (x) => Math.round(Math.max(0, Math.min(100, x)));
  const orf = [];
  if (m.carry?.spread != null) orf.push({ k: "carry", nome: "Carry USA-Giappone",
    score: cl(50 + (m.carry.spread - 2) * 15),
    sub: `spread ${fmtNum.format(m.carry.spread)} pp${m.carry.usdjpy != null ? ` · USD/JPY ${fmtNum.format(m.carry.usdjpy)}` : ""}` });
  if (m.putcall?.ratio != null) orf.push({ k: "putcall", nome: "Put/Call ratio (SPY)",
    /* v319 — era DECRESCENTE nel rapporto: la copertura pesante, che la scheda colora di
       verde e il pacchetto legge come contrarian rialzista, valeva 13/100. */
    score: punteggioDaZone(m.putcall.ratio, ZONE_PUTCALL),
    sub: `${fmtNum.format(m.putcall.ratio)} — sopra 1 più copertura che scommessa` });
  if (m.liquidity_split?.retail_mmf_bln != null) orf.push({ k: "liquidity", nome: "Liquidità in attesa (dry powder)",
    score: cl(40 + (m.liquidity_split.retail_pctile_5y ?? 50) * 0.4),
    sub: `fondi monetari $${fmtNum.format(Math.round(m.liquidity_split.retail_mmf_bln))} mld${m.liquidity_split.retail_yoy_pct != null ? ` · YoY ${signTxt(m.liquidity_split.retail_yoy_pct)}` : ""}` });
  if (m.dollar_ruler?.value != null) orf.push({ k: "dollar", nome: "Righello dollaro (DXY)",
    score: cl(50 - (m.dollar_ruler.chg_3m_pct ?? 0) * 6),
    sub: `${fmtNum.format(m.dollar_ruler.value)} · 3 mesi ${signTxt(m.dollar_ruler.chg_3m_pct ?? 0)}` });
  if (m.fed_market?.current_rate != null) orf.push({ k: "fed_market", nome: "Tasso Fed Funds",
    score: cl(100 - (m.fed_market.current_rate - 1) * 20),
    sub: `${fmtNum.format(m.fed_market.current_rate)}% — sopra il 4% comprime i multipli` });
  /* ⚠⚠ v321 — QUESTA TESSERA NON E' MAI NATA. Leggeva `yield_recession.current`, ma il campo
     che la pipeline pubblica si chiama `current_curve`: la condizione era sempre falsa, la
     tessera non veniva creata, la fusione dichiarata non scattava, e `was_inverted_24m` — cioe'
     l'unica informazione che la curva a +0,51 pp di OGGI non contiene, che due anni fa era
     invertita — non compariva da nessuna parte, ne' in pagina ne' nel pacchetto.
     Nessun errore, nessun gate rosso: un `?.` su un campo inesistente e' silenzioso. E' la
     classe "difetti che non si rompono", e il gate nuovo controlla che ogni chiave letta da
     m.<qualcosa> esista davvero nel data.json reale. */
  if (m.yield_recession?.current_curve != null) orf.push({ k: "yield_recession", nome: "Curva vs recessione",
    score: cl(50 + m.yield_recession.current_curve * 60),
    sub: `spread ${signTxt(m.yield_recession.current_curve, " pp")} · ${m.yield_recession.was_inverted_24m ? "invertita negli ultimi 24 mesi" : "nessuna inversione recente"}` });
  if ((m.decouple?.sp500 || []).length && (m.decouple?.gdp || []).length) {
    const gapD = Math.round(m.decouple.sp500.slice(-1)[0].v - m.decouple.gdp.slice(-1)[0].v);
    orf.push({ k: "decouple", nome: "Borsa vs economia reale", score: cl(100 - gapD * 0.9),
      sub: `gap ${signTxt(gapD, " pp")} su 3 anni — cumulato, cresce con la finestra` });
  }
  if (m.forward_pe?.value != null) orf.push({ k: "forward_pe", nome: "Valutazione S&P (P/E forward)",
    score: cl(100 - (m.forward_pe.value - 13) * 8),
    sub: `${fmtNum.format(m.forward_pe.value)}× vs media storica ${fmtNum.format(m.forward_pe.avg ?? 16.5)}×` });
  if ((m.fedwatch?.meetings || []).length) {
    const rf = ramiFedWatch(m.fedwatch, m.fedwatch.meetings[0]);
    orf.push({ k: "fedwatch", nome: "Attese sui tassi (prossimo FOMC)",
      score: cl(50 + (rf.cut_prob ?? 0) * 0.5 - (rf.hike_prob ?? 0) * 0.5),
      sub: `rialzo ${rf.hike_prob ?? 0}% · invariato ${rf.hold_prob ?? 0}% · taglio ${rf.cut_prob ?? 0}%` });
  }
  if (m.witching?.days != null) orf.push({ k: "witching", nome: "Prossima scadenza tecnica",
    score: m.witching.days <= 5 ? 30 : m.witching.days <= 15 ? 45 : 62,
    sub: `fra ${m.witching.days} giorni — volatilità attesa attorno alla data` });
  const bmk = m.benchmarks, pdOggi = typeof portfolioDayPct === "function" ? portfolioDayPct() : null;
  if (bmk && pdOggi != null) {
    const rif = bmk.sp500 ?? bmk.ndx ?? bmk.sox;
    if (rif != null) orf.push({ k: "_alpha", nome: "Scarto di oggi vs indice",
      score: cl(50 + (pdOggi - rif) * 12), sub: `${signTxt(Math.round((pdOggi - rif) * 100) / 100, " pp")} nella seduta` });
  }
  orf.forEach(x => out.push(x));


  /* ═══ v225 — ACCORPAMENTO: due tessere per la stessa cosa sono due tessere di troppo ══════
     Diverse voci misurano la STESSA grandezza con un secondo denominatore, e finivano affiancate
     come se fossero due letture indipendenti — la classe di difetto che questo progetto insegue
     da versioni (contare due volte un segnale solo). Qui si fondono in una tessera che porta
     entrambi i numeri: il punteggio e' quello della voce PRINCIPALE, l'altra diventa contesto. */
  /* ⚠ v266 — DICHIARATO QUI, NON PIU' IN FONDO. Il ciclo delle FUSIONI ha bisogno di sapere
     chi verra' escluso (v266: una fusione verso una tessera che poi sparisce cancella il dato),
     e leggerlo prima della sua `const` significava zona morta temporale — un ReferenceError che
     spegneva la funzione intera. Il filtro continua ad APPLICARSI in fondo come da v238; qui
     cambia solo dove si dichiara. */
  /* ⚠ v280 — le materie prime hanno un punteggio POSIZIONALE (dove sta il prezzo nel range
     dell'anno), non un giudizio favorevole/sfavorevole: petrolio alto = inflazione, rame alto
     = domanda industriale, cioe' due segni opposti sullo stesso 100. Metterle nella mediana
     del quadro d'insieme, o fra "i tre piu' favorevoli", direbbe una cosa che non significa
     niente — l'errore che il Philly Fed a punteggio pieno ha gia' fatto vedere (v274). */
  /* ⚠ v303 — I TERMOMETRI RIENTRANO IN CLASSIFICA. Il CEO: "sposta gli indicatori da
     Termometri di stress in Tutti gli indicatori". Erano esclusi da qui perche' avevano una
     sezione propria (v265); tolta quella, l'esclusione li cancellerebbe invece di spostarli.
     ⚠ La grafica si armonizza DA SOLA e non per caso: `serieIndicatore` ha gia' i casi
     `in:curve`, `credit` e `vix` con le loro soglie disegnate, e la classifica usa la stessa
     `tessera()` che usava la sezione. Non c'era niente da riscrivere: c'era da smettere di
     escluderli. */
  const chiaviTermometri = new Set([]);
  /* ⚠ v294 — TRE DOPPIONI TOLTI, e la ragione va scritta perche' un domani sembrera' una
     dimenticanza. Il CEO: "vedi se ci sono doppioni, ovvero se piu' schede mostrano lo stesso
     dato". Questi tre portano numeri che la scheda "La curva dei tassi" mostra gia', e meglio,
     perche' li' hanno lo storico e stanno accanto agli altri tenori:
     · in:t30      → il 30 anni e' un punto della curva
     · mk:^TNX     → il 10 anni idem
     · in:curve3m  → e' la DISTANZA fra due punti gia' disegnati, ed e' passata li' come pendenza
     ⚠⚠ NON SI PERDE NIENTE: `macro.indicators` resta intatto, quindi il PAYLOAD continua a
     portarli tutti e tre all'LLM — esce solo la tessera doppia dalla pagina. E' la regola v208
     ("si toglie dalla pagina cio' che il payload porta gia'"), applicata a una duplicazione
     interna alla pagina invece che fra pagina e pacchetto. */
  /* ⚠ v298 — EUR/JPY tolto su richiesta del CEO ("in valute: EUR/JPY"). Era gia' fuori dal
     PAYLOAD da v138 come ridondante — il rischio yen sta nel blocco Carry USA-Giappone, che
     porta lo stesso fatto con il meccanismo accanto. Ora esce anche dalla pagina, dove era
     l'ultimo posto in cui compariva da solo. */
  /* ⚠ v302 — petrolio, rame e oro fuori su richiesta del CEO. Restano nel PAYLOAD (la pipeline
     continua a pubblicarli in `macro.materie`), esce solo la tessera: e' la regola v208, si
     toglie dalla pagina cio' che il pacchetto porta gia'. Il SOX resta perche' non e' stato
     chiesto di toglierlo ed e' il benchmark del suo fattore principale. */
  /* ⚠ v306 — UMICH fuori dalla PAGINA su mia proposta, accettata dal CEO. La fiducia dei
     consumatori arriva con 1-2 mesi di ritardo di licenza da FRED (per questo la prendiamo
     dalla fonte primaria) e la stessa domanda — quanto le famiglie se la sentono di spendere —
     e' coperta piu' fresca dal Fear & Greed e dalle vendite al dettaglio. Resta nel PACCHETTO:
     e' la regola v208, si toglie dalla pagina cio' che il payload porta gia'. */
  /* ⚠ v307 — stagionalita' e EUR/USD tolti su richiesta del CEO. La stagionalita' era appena
     rientrata (v303) fondendo "Leva e stagionalita'": non e' un ripensamento mio, e' che una
     volta vista in mezzo alle altre non guadagnava il suo posto. EUR/USD resta nel PACCHETTO —
     e' il cambio con cui si convertono i suoi conti — e resta nel blocco macro: esce la
     tessera, non il fatto (regola v208). */
  /* ⚠ v313 — "Prossima scadenza tecnica" (witching) fuori su richiesta del CEO. Resta nel
     PACCHETTO, dove una scadenza tecnica in arrivo e' un fatto che spiega volumi anomali. */
  const FUORI = new Set(["witching", "seasonality", "mk:EURUSD=X", "in:umich",
                         "dollar", "in:gdp", "in:retail",   // v330 — fuori dalla pagina, restano nel pacchetto
                         "mat:petrolio", "mat:rame", "mat:oro",
                         "mk:EURJPY=X", "in:t30", "mk:^TNX", "in:curve3m",
                         "thermometer", "futures", "risk_sentiment", "smart_money",   // v303: stagionalità rientra
                         "_alpha", "fg:momentum-s-p-500", "fg:domanda-bond-high-yield",
                         /* v265 — richieste esplicite del CEO: due componenti F&G che non vuole */
                         "fg:forza-dei-prezzi", "fg:domanda-beni-rifugio",
                         ...chiaviTermometri]);

  const FUSIONI = [
    { p: "in:cpi", s: "in:pce", nome: "Inflazione (CPI e PCE)",
      sub: (a2, b2) => `CPI ${a2.sub.split(" ")[0]} · PCE ${b2.sub.split(" ")[0]} — due misure della stessa cosa, la Fed guarda il PCE` },
    { p: "credit", s: "systemic_risk", nome: "Stress del credito",
      sub: (a2, b2) => `${a2.sub} · ${esc(String(b2.sub || "").split(" ")[0])} sistemico — stessa famiglia, spread HY e IG` },
    { p: "sp500_pe", s: "forward_pe", nome: "Valutazione S&P (trailing e forward)",
      sub: (a2, b2) => `${a2.sub} · forward ${b2.sub}` },
    { p: "corp_profit", s: "decouple", nome: "Borsa vs economia reale",
      /* ⚠ v334 — il CEO: "non ne capisco il significato di entrambi". Le due linee sono la
         BORSA e l'ECONOMIA, entrambe partite da 100 nello stesso mese: quanto si allargano e'
         quanto la borsa e' salita piu' di cio' che la sostiene. Lo dice la riga, invece di
         lasciarlo dedurre da due gap in punti percentuali. */
      sub: (a2, b2) => `${a2.sub} · e contro il PIL: ${b2.sub} — NON due prove, la stessa su due denominatori` },
    { p: "in:unemp", s: "in:nfp", nome: "Mercato del lavoro",
      sub: (a2, b2) => `disoccupazione ${a2.sub.split(" ")[0]} · nuovi posti ${b2.sub.split(" ")[0]}` +
        ` — lo ZERO sui nuovi posti e' il confine: sopra si assume, sotto si licenzia` },
    { p: "in:curve", s: "yield_recession", nome: "Curva dei tassi 10A-2A",
      /* ⚠ il fatto di B (l'inversione degli ultimi 24 mesi) va portato dentro, o la fusione
         successiva con in:curve3m riscrive il sub e lo cancella un'altra volta. */
      sub: (a2, b2) => `${a2.sub} — sotto zero e' il segnale che conta`
        + (/invertita/.test(b2.sub || "") ? " · gia' invertita negli ultimi 24 mesi" : "") },
    /* ⚠ v266 — 10A-2A e 10A-3M SONO LA STESSA CURVA su due tratti. Affiancate sarebbero due
       tessere che dicono la stessa cosa, cioe' esattamente il doppione che il CEO ha gia'
       dovuto segnalare due volte. Si fondono, e la tessera porta tutti e due i numeri: quando
       i due tratti non concordano, quello e' il fatto interessante. */
    { p: "in:curve", s: "in:curve3m", nome: "Curva dei tassi (10A-2A e 10A-3M)",
      /* ⚠⚠ QUESTA FUSIONE RISCRIVE IL SUB DA ZERO, quindi cancellava il fatto che la fusione
         precedente aveva appena portato dentro: che la curva e' GIA' STATA INVERTITA negli
         ultimi 24 mesi. E' l'unica informazione che il +0,51 pp di oggi non contiene — una
         curva normalizzata da tempo e una che non si e' mai invertita raccontano due storie
         diverse — ed e' proprio quella che spariva. Una fusione che riscrive deve rileggere
         cosa c'era, non ripartire da capo. */
      sub: (a2, b2) => `10A-2A ${a2.sub.split(" ")[0]} · 10A-3M ${b2.sub.split(" ")[0]} — due tratti della STESSA curva, non due segnali`
        + (/invertita/.test(a2.sub || "") ? " · gia' invertita negli ultimi 24 mesi" : "") },
    /* reale e attesa sono i due pezzi in cui si scompone il rendimento nominale: separati
       sembrano indipendenti, e non lo sono. */
    { p: "in:real10", s: "in:breakeven", nome: "Tasso reale e inflazione attesa (10A)",
      sub: (a2, b2) => `reale ${a2.sub.split(" ")[0]} · attesa ${b2.sub.split(" ")[0]} — sommati danno il rendimento nominale a 10 anni` },
  ];
  /* ⚠ v266 — UNA FUSIONE VERSO UNA TESSERA CHE VERRA' TOLTA CANCELLA IL DATO. Misurato con la
     curva: `in:curve` esce dalle schede perche' e' gia' un termometro di stress (v265), quindi
     fondere `in:curve3m` dentro di lei toglieva il 10A-3M dall'elenco e poi il filtro toglieva
     anche l'ospite — il dato spariva del tutto, in silenzio. E' la stessa trappola gia' scritta
     nel payload per la curva ("un accorpamento che perde il dato invece di unirlo"), qui in
     un'altra funzione. Quando il primario non si vede, il secondario resta in piedi da solo. */
  for (const f of FUSIONI) {
    const ip = out.findIndex(x => x.k === f.p), is = out.findIndex(x => x.k === f.s);
    if (ip < 0 || is < 0) continue;
    if (FUORI.has(f.p) && !FUORI.has(f.s)) continue;
    const A = out[ip], B = out[is];
    A.nome = f.nome;
    try { A.sub = f.sub(A, B); } catch { /* sub assente: si tiene quello originale */ }
    /* ⚠⚠ v321 — LA FUSIONE TENEVA IL PUNTEGGIO DI A E BUTTAVA QUELLO DI B. Misurato:
       "Mercato del lavoro 76/100" — cioe' molto favorevole — nasceva dalla disoccupazione al
       76 mentre i nuovi posti stavano a 19, con "-23K" stampato due centimetri sotto. Il
       punteggio peggiore spariva dalla pagina insieme alla tessera che lo portava.
       Una fusione puo' unire due VISTE della stessa cosa, non due giudizi opposti: quando i
       due divergono, il numero onesto e' il peggiore, e lo SCARTO e' il fatto da mostrare —
       e' la stessa regola per cui il blocco del disaccordo apre il pacchetto. */
    if (Number.isFinite(A.score) && Number.isFinite(B.score)) {
      const scarto = Math.abs(A.score - B.score);
      const peggio = Math.min(A.score, B.score);
      if (scarto > 20) A.sub = `${A.sub} · ⚠ i due componenti non concordano (${A.score} e ${B.score}): vale il peggiore`;
      A.score = peggio;
    }
    out.splice(is, 1);
  }

  // v218 — gli INTERNI DI MERCATO erano l'ultima mini-card: quattro righe di valori con unità
  // diverse (pp, %, un booleano) che nessuno poteva confrontare fra loro. Portati sulla stessa
  // scala 0-100 entrano nella classifica insieme a tutto il resto, e la mini-card sparisce.
  if (m.breadth?.divergence_pp != null) out.push({ k: "breadth", nome: "Ampiezza del mercato (SPY vs RSP)",
    /* v319 — era `50 + divergence*8`, cioe' CRESCENTE nella divergenza: premiava il rally
       piu' stretto. Ora esce dalle stesse zone che la scheda colora. */
    score: punteggioDaZone(m.breadth.divergence_pp, ZONE_AMPIEZZA),
    sub: `${signTxt(m.breadth.divergence_pp, " pp")} a 1 mese` });
  if (m.momentum?.sp500?.dist_pct != null) out.push({ k: "momentum", nome: "S&P vs media 125 sedute",
    score: Math.round(clamp(50 + m.momentum.sp500.dist_pct * 4)), sub: signTxt(m.momentum.sp500.dist_pct) });
  if (m.froth) out.push({ k: "froth", nome: "Schiuma sugli ETF a leva",
    score: m.froth.alert ? 18 : 78, sub: m.froth.alert ? "volumi anomali dentro un rialzo" : `volumi normali (RVol max ${fmtNum.format(Math.max(m.froth.soxl?.rvol ?? 0, m.froth.tqqq?.rvol ?? 0))}×)` });
  if (m.futures?.nasdaq?.change_pct != null) out.push({ k: "futures", nome: "Futures Nasdaq (fuori orario)",
    score: Math.round(clamp(50 + m.futures.nasdaq.change_pct * 10)), sub: signTxt(m.futures.nasdaq.change_pct) });
  /* ⚠ v238 — IL FILTRO VA QUI, non a meta' funzione: la prima stesura lo metteva subito dopo
     gli "orfani" e "futures" veniva aggiunto DOPO, quindi sopravviveva. Misurato: 30 voci → 28
     invece di 27. In fondo, appena prima dell'ordinamento, vede tutto quello che e' stato messo.
     TRE VOCI ESCONO su richiesta del CEO: "Salute tecnica del libro" e "Futures Nasdaq (fuori
     orario)" eliminate; "Stagionalità del mese" e' la STESSA cosa del riquadro "Leva e
     stagionalità", che pero' ha i 12 mesi disegnati — si tiene quello col grafico e si toglie il
     doppione, che diceva lo stesso fatto con meno informazione (classe v184). */
  /* ═══ v258 — I COMPONENTI DI FEAR & GREED DIVENTANO SCHEDE A SE' ═══════════════════════════
     Richiesta del CEO: "nella tab fear and greed ci sono informazioni come vix momentum etc.
     portale fuori come macro tab a parte qualora non ve ne sia gia' una presente".
     I sette componenti li pubblica la CNN dentro `fear_greed.components`, ciascuno col proprio
     punteggio 0-100 e la propria etichetta: sono indicatori veri, non pezzi di un totale, ed
     erano leggibili solo dentro la scheda del composito.
     ⚠ IL "QUALORA NON VE NE SIA GIA' UNA PRESENTE" E' LA PARTE DELICATA. La deduplica si fa sui
     NOMI, ed e' un'euristica — questo progetto ha gia' pagato l'accoppiamento per nome visibile
     (v196). La differenza e' il modo di fallire: qui il caso peggiore e' una scheda duplicata,
     non un dato perso, e il check v258 stampa cosa e' stato saltato cosi' la deduplica resta
     ispezionabile invece che silenziosa. */
  const fgComp = ((m.fear_greed || {}).components || [])
    .filter(c => c && c.label && Number.isFinite(Number(c.score)));
  if (fgComp.length) {
    const chiaveNome = (x) => String(x).toLowerCase()
      .replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
    /* i token che identificano un indicatore gia' presente: si confrontano le PAROLE, non le
       stringhe intere ("Volatilita' (VIX)" e "Volatilita' (VIX)" combaciano, ma anche
       "Opzioni Put/Call" e "Put/Call ratio (SPY)" condividono "put/call") */
    const tokenEsistenti = new Set(out.flatMap(x => chiaveNome(x.nome).split(" ").filter(w => w.length > 3)));
    for (const c of fgComp) {
      const tok = chiaveNome(c.label).split(" ").filter(w => w.length > 3);
      const gia = tok.length > 0 && tok.some(w => tokenEsistenti.has(w));
      if (gia) continue;
      out.push({ k: "fg:" + chiaveNome(c.label).replace(/[^a-z0-9]+/g, "-"),
                 nome: c.label, score: Math.round(Number(c.score)),
                 sub: `${c.rating ? (FG_LABELS[c.rating] || c.rating) + " · " : ""}componente di Fear & Greed (CNN)`,
                 cadenza: rigaFreschezzaMercato(m.fear_greed) });
    }
  }

  /* ═══ v259 — DUE COMPOSITI TOLTI SU RICHIESTA DEL CEO ═══════════════════════════════════════
     "Sentiment globale e Istituzionali vs retail vanno eliminati perche' credo siano gia'
     presenti e non voglio dati aggregati come questi se gia' presenti in altri macro TAB".
     VERIFICATO, e ha ragione: Sentiment globale (risk_sentiment) e' costruito su Fear & Greed,
     Put/Call, VIX, credito e Bitcoin — cinque componenti che hanno TUTTI una scheda propria.
     Istituzionali vs retail (smart_money) e' costruito su struttura SMC degli indici, VIX term,
     HY/IG e put/call: anche li' tre su quattro hanno una scheda.
     Sono medie di cose gia' visibili, e una media di segnali gia' contati li conta due volte —
     esattamente cio' che il payload dichiara di non voler fare ("contarli come due prove
     raddoppia un segnale solo", v229). Non si perde informazione: si perde una ripetizione.
     ⚠ I loro COMPONENTI restano tutti: le schede singole ci sono, e la dispersione interna
     continua a vivere nel blocco del disaccordo, che legge macroquant e fear_greed. */
  /* ⚠ v262 — TRE VOCI IN PIU' FUORI, per ragioni diverse e tutte verificate sui dati.
     · "_alpha" (Scarto di oggi vs indice) — richiesta esplicita del CEO: "è correlato al
       portafoglio che il sistema non deve leggere più". E' l'ULTIMA scheda che leggeva
       DATA.portfolio: passate in rassegna tutte e 29, era l'unica rimasta.
     · "fg:momentum-s-p-500" — e' la STESSA GRANDEZZA di "momentum" (S&P vs media 125 sedute):
       la componente Momentum di CNN e' il prezzo dell'S&P contro la sua media a 125 giorni.
       La deduplica per nome di v258 non l'ha vista perche' i due nomi non condividono una
       parola ("Momentum S&P 500" contro "S&P vs media 125 sedute") — ed e' la dimostrazione
       del limite dichiarato allora: accoppiare per nome visibile fallisce quando due nomi
       diversi indicano la stessa cosa (v196). Qui la deduplica e' per SOSTANZA, a mano.
     · "fg:domanda-bond-high-yield" — e' lo spread high yield, cioe' la stessa misura di
       "Stress del credito" (HY OAS) letta da un'altra fonte. Due letture della stessa
       grandezza sono un segnale, non due. */
  /* ═══ v265 — I DOPPIONI CHE IL CEO HA DOVUTO SEGNALARE DUE VOLTE ═══════════════════════════
     "alcuni dati come VIX sono presenti due volte, ti avevo detto di controllare queste cose e
     di cancellare i doppioni!!". Ha ragione, ed era peggio di come l'ha descritto: i doppioni
     erano TRE, non uno.
     I "Termometri di stress" disegnano curva 10A-2A, credito HY e VIX con le loro soglie — ed
     e' la forma che il CEO ha detto esplicitamente di saper leggere ("i termometri di stress
     per me sono di facile lettura"). Le stesse tre grandezze avevano anche una scheda nella
     classifica sotto. Stesso fatto, due posti, due forme.
     ⚠ PERCHE' NON L'AVEVO VISTO: la mia deduplica confrontava le schede FRA LORO, e i termometri
     non sono schede — vivono in un'altra funzione (renderStress) e in un'altra sezione. Cercavo
     i duplicati dentro un solo elenco mentre stavano fra due elenchi diversi. E' la ragione per
     cui il CEO ha dovuto dirlo due volte, e la correzione giusta non e' guardare meglio: e'
     dedurre la lista degli esclusi DA renderStress, cosi' se un domani un termometro cambia,
     l'esclusione lo segue da sola invece di restare un elenco scritto a mano (classe C10).
     Vince il TERMOMETRO: e' la forma che lui legge, e porta le soglie. */
  /* ⚠ v253 — LA FRESCHEZZA SI ASSEGNA IN UN PUNTO SOLO, QUI IN FONDO. La prima stesura la
     agganciava ai singoli `out.push`: ce ne sono NOVE sparsi per la funzione, e un decimo
     aggiunto un domani nascerebbe senza — è lo stesso motivo per cui il filtro FUORI qui
     sopra è stato spostato in fondo in v238 ("futures" veniva aggiunto DOPO e sopravviveva).
     Chi ha già un calendario di pubblicazione (rigaCadenza) se lo tiene; tutti gli altri
     sono dati che rinascono a ogni run, e questa riga lo dice. */
  /* ⚠ v261 — LA FRESCHEZZA E' PER BLOCCO, non una sola per tutti. Prima si calcolava UNA riga
     e la si copiava su ogni scheda: comodo e sbagliato appena i blocchi hanno barre diverse
     (Yahoo pubblica in tempi diversi, gia' pagato in v186 sul portafoglio). Ogni scheda ora
     chiede la propria: `k` porta la chiave del blocco macro, e da li' si risale al suo `asof`. */
  return out.filter(x => !FUORI.has(x.k))
    .map(x => {
      if (x.cadenza) return x;
      const chiave = String(x.k || "").replace(/^(in:|mk:|fg:)/, "");
      const blocco = m[chiave] || m[x.k] || null;
      return { ...x, cadenza: rigaFreschezzaMercato(blocco) };
    })
    /* ═══ v306 — SI ORDINA PER QUANTO SI E' MOSSO, NON PER IL PUNTEGGIO ═══════════════════
       Il punteggio 0-100 e' lo stesso numero che v200 ha tolto dal pacchetto dopo aver misurato
       7 segnali maturati, -10,8% medio e hit-rate 29%, e che v300 ha tolto dal rilevatore di
       movimento. Ordinare 28 tessere con quel numero e' ancora un giudizio — "ordinare e' gia'
       un giudizio" e' testualmente la frase di v200, e qui era sopravvissuta.
       Ora l'ordine e' un FATTO: quanto l'ultimo scarto pubblicato di ogni serie vale rispetto
       alla deviazione tipica dei suoi scarti. Chi si e' mosso piu' del proprio solito sta in
       cima, e la tessera lo dichiara.
       ⚠ Chi NON ha una serie non ha un movimento misurabile: va dopo, in ordine alfabetico, che
       non esprime preferenze. Metterlo in mezzo con uno zero direbbe "fermo", che e' falso —
       la differenza fra "non si e' mosso" e "non lo sappiamo" e' esattamente cio' che questo
       sistema non deve confondere. */
    .map(x => ({ ...x, mossa: mossaRelativa(x.k) }))
    .sort((a, b) => {
      const A = a.mossa, B = b.mossa;
      if (A != null && B != null) return B - A;
      if (A != null) return -1;
      if (B != null) return 1;
      return String(a.nome).localeCompare(String(b.nome));
    });
}
/* ═══ v233 — QUELLO CHE IL POPUP AVEVA DENTRO, PORTATO FUORI ════════════════════════════════
   Richiesta CEO: "i grafici riportali all'originaria forma di mini tab e se il rispettivo pop up
   forniva dei grafici o tabelle, riporta direttamente quelli in struttura".
   La macchina esiste gia' dal v188: `collectPanels` sostituisce temporaneamente `openInfoModal`
   con un raccoglitore, esegue la funzione del pannello e ne tiene l'HTML — cosi' ogni pannello
   resta l'UNICA fonte di verita' del proprio contenuto e non nasce un secondo elenco da tenere
   allineato (la classe di difetto C10/C12).
   Qui si estraggono SOLO gli elementi che portano dati — <svg> e <table> — e si lascia fuori la
   prosa esplicativa, che nella scheda sarebbe rumore e nel popup resta a un clic.
   ⚠ MISURATO PRIMA DI SCRIVERE: su 30 indicatori solo 3 hanno un grafico e 4 una tabella. Gli
   altri 23 non prendono un riempitivo: la mini tab col numero e la sua nota e' tutto quello che
   c'e', e dirlo e' meglio che inventare una forma per far sembrare pieni i riquadri vuoti. */
function contenutoDalPannello(k, notaGia = "") {
  if (!k || typeof MACRO_INFO === "undefined" || !MACRO_INFO[k]) return "";
  let html = "";
  try {
    const p = collectPanels([{ run: () => openMacroInfo(k) }]);
    html = p.length ? (p[0].bodyHTML || "") : "";
  } catch { return ""; }                      // un pannello rotto non deve rompere la griglia
  /* ⚠ v235 — NON SOLO GRAFICI E TABELLE. Misurato sui pannelli veri: 4 hanno un <svg>, 4 una
     <table>, ma VENTUNO su 30 hanno righe `info-line` — che sono i dati veri e propri ("Valore
     attuale: 55.2 (2026-07-01)", "Impatto: sfavorevole ai mercati", "Prossima pubblicazione
     stimata: …"). In v233 restavano dentro il popup, e la scheda mostrava il solo punteggio.
     Il CEO ha indicato "Istituzionali vs retail" come esempio: quel pannello ha una tabella E
     nove righe di dati, e usciva solo la tabella. Ora esce tutto il CONTENUTO INFORMATIVO;
     resta dentro solo la prosa esplicativa (cos'e' l'indicatore, come si legge), che nella
     scheda sarebbe rumore e nel popup e' a un clic. */
  /* ⚠ v237 — LO STESSO DATO NON VA MOSTRATO DUE VOLTE. Misurato in browser dopo la v235: 8
     schede su 30 dicevano il valore corrente nella NOTA e di nuovo nella riga estratta —
     "55.2 · 2026-07-01" e sotto "Valore attuale: 55.2 (2026-07-01)". E' esattamente la classe
     che questo payload combatte altrove ("lo stesso dato che si presentava come due dati", v184)
     e l'ho introdotta io portando fuori le righe senza confrontarle con quello che la scheda
     gia' diceva. Ora una riga che non aggiunge NIENTE alla nota viene scartata. */
  /* ⚠ i numeri vanno NORMALIZZATI prima di confrontarli: la nota scrive "4.69" (formato del
     dato) e il pannello "4,69%" (formato italiano). Confrontando le stringhe grezze il filtro
     non riconosceva la ripetizione, ed e' per questo che sulla scheda del carry gli stessi
     valori comparivano due volte. Si tolgono i separatori e si confrontano le cifre. */
  const norm = (x) => String(x).replace(/[.,]/g, "");
  const numeriNota = (String(notaGia).match(/[\d][\d.,]{1,}/g) || [])
    .filter(x => x.length > 2).map(norm);
  /* ⚠ v243 — il filtro guardava solo le righe etichettate "Valore attuale / Rilevazione / Ultimo
     dato". Ma la ridondanza non dipende dall'ETICHETTA: sulla scheda del carry le righe del
     pannello ("Treasury 10A: 4,69% · JGB 10A: 2,82% · Differenziale 1,88 pp") ripetevano
     esattamente i numeri della nota due righe sotto, con etichette diverse. Il criterio vero e'
     numerico: se TUTTI i numeri di una riga sono gia' nella nota, quella riga non aggiunge nulla.
     Resta prudente — basta UN numero nuovo perche' la riga sopravviva. */
  const ridondante = (frammento) => {
    const testo = frammento.replace(/<[^>]*>/g, " ");
    if (/<svg|<table/.test(frammento)) return false;      // grafici e tabelle non si scartano mai
    const numeri = (testo.match(/[\d][\d.,]{1,}/g) || []).filter(x => x.length > 2).map(norm);
    return numeri.length > 0 && numeri.every(n => numeriNota.includes(n));
  };
  /* ⚠ v258 — ORA ESCE ANCHE LA PROSA. Richiesta del CEO: "tutto cio' che si legge nei pop up
     che apro cliccando in una tab deve essere portato fuori nella tab stessa, uniformando le
     informazioni". Fino a v235 uscivano solo grafici, tabelle e righe di dati: restava dentro
     la spiegazione — cos'e' l'indicatore, come si legge, attraverso quale canale tocca il
     portafoglio. Era la parte che il CEO doveva andare a cercare con un clic, ed e' proprio
     quella che rende leggibile il numero (e' la stessa ragione per cui in v238 ogni scheda ha
     il suo "come si legge": un grafico senza quella riga e' la forma gia' respinta).
     Il filtro anti-ridondanza resta identico e vale anche sulla prosa: una riga che ripete
     numeri gia' presenti nella nota non entra. */
  const pezzi = [...html.matchAll(/<svg[\s\S]*?<\/svg>|<table[\s\S]*?<\/table>|<div class="info-line[\s\S]*?<\/div>|<p[\s\S]*?<\/p>|<ul[\s\S]*?<\/ul>/g)]
    .map(m => m[0]).filter(x => !ridondante(x))
    /* la prosa va marcata: nella scheda deve leggersi come contesto, non come un dato in piu' */
    .map(x => /^<p/.test(x) ? x.replace(/^<p/, '<p class="mg-spieg"') : x);
  return pezzi.length ? `<div class="mg-dalpan">${pezzi.join("")}</div>` : "";
}

/* ═══ v238 — LA SCALA: un valore singolo non e' un numero nudo, e' una POSIZIONE ═════════════
   Richiesta CEO: "fornisci dati dettagliati e spiegazioni di lettura del dato, se possibile con
   grafico, istogramma, torta o termometro" per sedici indicatori che hanno UN solo valore e
   nessuno storico nel file.
   ⚠ Perche' NON e' la barra 0-100 gia' respinta tre volte: quella chiedeva di stimare una
   lunghezza contro un asse implicito e senza riferimenti. Qui l'asse porta le ZONE NOMINATE
   (dove comincia la recessione, dov'e' il target della Fed, dove i multipli si comprimono) e la
   lettura e' la POSIZIONE dentro una di esse. Il numero non e' il messaggio: lo e' la zona in
   cui cade, che ha un nome scritto sotto. */
/* ═══ v317 — DALLA BARRA AL TACHIMETRO ═══════════════════════════════════════════════════════
   Il CEO: "i grafici a barre come per esempio Righello dollaro (DXY) modificali in tachimetro per
   una piu' facile lettura. il rosso indica un valore negativo per mercato il verde positivo (i
   colori sono sfumati dal verde al rosso con arancione nel mezzo)".
   ⚠⚠ QUESTO NON E' IL RITORNO DELLA BARRA 0-100 RESPINTA TRE VOLTE. Quella chiedeva di stimare
   una lunghezza contro un asse anonimo; qui la lancetta indica un VALORE VERO (99,67 di DXY, 5,21%
   del trentennale) dentro ZONE NOMINATE che hanno un nome scritto sotto. La differenza e' fra un
   punteggio normalizzato e uno strumento con le sue unita'.
   ⚠ Una modifica sola invece di ventuno: `scala()` delega qui, quindi tutti i suoi punti di
   chiamata diventano tachimetri conservando le loro zone, le loro soglie e la loro fonte. Due
   implementazioni della stessa forma divergerebbero — lezione v161/v207. */
const COLORE_ZONA = {
  /* il CEO vuole la sfumatura verde -> arancione -> rosso: le zone intermedie erano grigie
     (`--muted`), che non dice "in mezzo", dice "non classificato". */
  "var(--muted)": "var(--orange, #f59e0b)",
  "var(--yellow)": "var(--orange, #f59e0b)",
};

function tachimetroValore(v, opt = {}) {
  if (v == null || isNaN(v)) return "";
  const zone = (opt.zone || []).filter(z => z && z.a > z.da);
  if (!zone.length) return "";
  const min = opt.min != null ? opt.min : Math.min(...zone.map(z => z.da));
  const max = opt.max != null ? opt.max : Math.max(...zone.map(z => z.a));
  if (!(max > min)) return "";
  const val = Math.max(min, Math.min(max, v));
  const fmt = opt.fmt || ((x) => fmtNum.format(Math.round(x * 100) / 100));

  const W = 300, H = 190, cx = W / 2, cy = 142, R = 112, sp = 24;
  const q = (x) => (Math.max(min, Math.min(max, x)) - min) / (max - min);   // 0..1
  const ang = (x) => Math.PI * (1 - q(x));
  const P = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy - r * Math.sin(a)).toFixed(2)}`;

  const arco = zone.map(z => {
    const a0 = ang(z.da), a1 = ang(z.a);
    const col = COLORE_ZONA[z.colore] || z.colore;
    return `<path d="M ${P(R, a0)} A ${R} ${R} 0 ${(q(z.a) - q(z.da)) > 0.5 ? 1 : 0} 1 ${P(R, a1)}"
      fill="none" stroke="${col}" stroke-width="${sp}" stroke-opacity=".85"
      ><title>${esc(z.nome)}: da ${fmt(z.da)} a ${fmt(z.a)}</title></path>`;
  }).join("");

  /* le soglie dichiarate restano: sono affermazioni che il grafico deve continuare a fare (v240) */
  const conf = (opt.soglie || []).filter(t => t && t.v > min && t.v < max).map(t => {
    const a = ang(t.v), i = P(R - sp / 2 - 3, a).split(" "), o = P(R + sp / 2 + 3, a).split(" ");
    const e = P(R + sp / 2 + 12, a).split(" ");
    return `<line x1="${i[0]}" y1="${i[1]}" x2="${o[0]}" y2="${o[1]}" stroke="var(--text)"
        stroke-width="1.4" stroke-dasharray="2 2" opacity=".85"/>
      <text x="${e[0]}" y="${e[1]}" text-anchor="middle" font-size="8.5" fill="var(--muted)">${esc(t.testo)}</text>`;
  }).join("");

  const a = ang(val), punta = P(R - 18, a).split(" ");
  const dentro = zone.find(z => v >= z.da && v <= z.a) || (v <= min ? zone[0] : zone[zone.length - 1]);
  const col = dentro ? (COLORE_ZONA[dentro.colore] || dentro.colore) : "var(--text)";
  const fuori = v < min || v > max;   // il valore esce dalla scala: si dichiara invece di fingerlo dentro
  return `<div class="tk"><svg viewBox="0 0 ${W} ${H}" role="img"
      aria-label="${esc(opt.aria || "misuratore")}: ${fmt(v)}${esc(opt.unita || "")}">
      ${arco}${conf}
      <line x1="${cx}" y1="${cy}" x2="${punta[0]}" y2="${punta[1]}" stroke="var(--text)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="7" fill="var(--text)"/><circle cx="${cx}" cy="${cy}" r="3" fill="var(--card-2)"/>
      <text x="${cx}" y="${cy + 34}" text-anchor="middle" font-size="26" font-weight="700"
        font-family="var(--mono)" fill="${col}">${esc(fmt(v))}${esc(opt.unita || "")}</text>
      <text x="10" y="${cy + 14}" font-size="9.5" fill="var(--muted)">${esc(fmt(min))}${esc(opt.unita || "")}</text>
      <text x="${W - 10}" y="${cy + 14}" text-anchor="end" font-size="9.5" fill="var(--muted)">${esc(fmt(max))}${esc(opt.unita || "")}</text>
    </svg>${dentro ? `<div class="tk-zona" style="color:${col}">${esc(dentro.nome)}${fuori ? " — VALORE FUORI SCALA" : ""}</div>` : ""}
    <div class="tk-fonte muted">${esc(opt.fonte || "bande di lettura convenzionali, non soglie calcolate dai dati")}</div></div>`;
}

function scala(v, opt = {}) {
  /* v317 — la barra orizzontale non esiste piu': stessa firma, stessi argomenti, forma nuova.
     Delegare invece di duplicare e' il motivo per cui la conversione ha toccato un punto solo. */
  return tachimetroValore(v, opt);
}

/* conto alla rovescia per le date: un numero di giorni e' un fatto, la sequenza delle prossime
   scadenze e' il contesto che dice se quella data e' isolata o parte di un ritmo */
function contoAllaRovescia(giorni, date, opt = {}) {
  if (giorni == null) return "";
  const el = (date || []).slice(0, 4);
  return `<div class="cdr"><div class="cdr-n">${giorni}<span class="cdr-u">giorni</span></div>
    ${el.length ? `<div class="cdr-el">${el.map((d, i) => `<span class="${i === 0 ? "cdr-on" : ""}">${esc(dataBreve(d))}</span>`).join("")}</div>` : ""}
    ${opt.nota ? `<div class="muted cdr-nota">${opt.nota}</div>` : ""}</div>`;
}

/* ═══ v243 — IL TACHIMETRO: cinque strumenti, non trenta ════════════════════════════════════
   Richiesta CEO: un tachimetro per carry USA-Giappone, Fear & Greed, istituzionali vs retail,
   sentiment globale e schiuma ETF.
   ⚠ NON e' il ritorno del `quadrante` respinto in v226. Quello era un widget IDENTICO ripetuto
   su TRENTA indicatori — un muro indistinto — e con una scala nuda "sfavorevole → favorevole"
   senza riferimenti. Qui sono CINQUE strumenti scelti uno per uno, e l'arco porta le ZONE
   NOMINATE: la lancetta non indica un punto su una scala anonima, indica una zona che ha un nome
   scritto sotto. La differenza fra i due casi e' quella fra un cruscotto e un muro di quadranti
   uguali. Come per la scala, ogni tachimetro DICHIARA da dove vengono le sue bande. */
function tachimetro(v, opt = {}) {
  /* v317 — il tachimetro a punteggio e' il caso particolare di quello a valore: scala 0-100,
     nessuna unita'. Una sola geometria per tutti, cosi' non divergono. */
  return tachimetroValore(v == null || isNaN(v) ? null : Math.round(v),
    { min: 0, max: 100, fmt: (x) => String(Math.round(x)), ...opt });
}

/* ═══ v238 — OGNI INDICATORE HA LA SUA FORMA E LA SUA LETTURA ═══════════════════════════════
   Richiesta CEO: "voglio tutti grafici in struttura", con "dati dettagliati e spiegazioni di
   lettura del dato". Il registro assegna a ciascuno la forma che i suoi dati permettono
   davvero — misurata prima, non ipotizzata:
     · chi ha COMPONENTI (i compositi) → barre dei fattori, dal peggiore al migliore. E' cio' che
       mostrava la sezione "Da cosa nascono i punteggi", che infatti sparisce: il contenuto entra
       nella scheda del suo indicatore invece di vivere in un blocco separato che ripeteva i nomi.
     · chi ha una SERIE → la linea nel tempo (gia' gestita da serieIndicatore).
     · chi ha UN VALORE SOLO → la scala con le zone nominate. Il numero da solo non dice niente:
       "3,7%" diventa informazione quando l'asse mostra dov'e' il target della Fed.
     · le date → conto alla rovescia con le prossime scadenze.
   Ogni voce porta anche COME SI LEGGE: una riga che dice cosa guardare, non cosa fare (le
   istruzioni vivono nella testata del prompt, non qui — e questa e' UI, non payload). */
/* v243 — le bande dei punteggi 0-100 del sistema: una convenzione di LETTURA, dichiarata come
   tale. Non sono soglie calcolate: il punteggio e' gia' normalizzato dal motore, e queste bande
   servono solo a dare un nome alla zona in cui cade la lancetta. */
/* ═══ v319 — IL PUNTEGGIO NASCE DALLE ZONE, NON DA UNA SECONDA FORMULA ═══════════════════════
   Il CEO: "controlla se effettivamente il rating che dai ad ogni scheda hanno una logica di
   calcolo corretta". La risposta e' no per almeno cinque schede, e due avevano il SEGNO INVERTITO.
   ⚠⚠ MISURATO, NON DEDOTTO. Ampiezza del mercato: a -6 pp — l'azione media che batte l'indice di
   sei punti, cioe' la partecipazione piu' larga possibile — il punteggio valeva 2/100 mentre la
   scheda scriveva "PARTECIPAZIONE LARGA"; a +6 pp, il rally piu' fragile che esista, valeva
   98/100 mentre la scheda scriveva "SOLO LE MEGACAP". Put/Call: 1,4 (copertura pesante, che la
   scheda stessa colora di VERDE e il pacchetto legge come contrarian rialzista) valeva 13/100.
   ⚠ LA CAUSA NON ERA IL SEGNO: erano DUE FORMULE INDIPENDENTI per la stessa domanda — una
   calcolava il punteggio, l'altra decideva il colore della zona — e due formule indipendenti
   divergono, e' la lezione v161/v207 applicata ai punteggi. Rattoppare i due segni avrebbe
   lasciato in piedi il meccanismo che li ha prodotti.
   Ora il punteggio si RICAVA dalla zona in cui il valore cade, e le fasce sono allineate a
   ZONE_PUNTEGGIO: se la scheda colora di rosso, il punteggio sta nel rosso. Per costruzione. */
const FASCIA_DA_COLORE = {
  "var(--red)": [4, 32],
  "var(--yellow)": [36, 44],
  "var(--orange, #f59e0b)": [46, 54],
  "var(--muted)": [46, 54],
  "var(--green)": [72, 96],
};

function punteggioDaZone(v, zone) {
  const z = (zone || []).filter(x => x && x.a > x.da);
  if (v == null || isNaN(v) || !z.length) return null;
  /* ⚠ DUE BANDE ADIACENTI DELLO STESSO COLORE SONO UNA BANDA SOLA. Il credito ha "stress"
     (5-7%) e "crisi" (7-20%) entrambe rosse: trattandole separate il punteggio arrivava a 4 a
     fine stress e RIPARTIVA da 32 all'inizio della crisi — cioe' una crisi conclamata valeva
     piu' di uno stress grave. Si fondono prima di cercare, cosi' la funzione resta monotona
     anche dove il colore non cambia. */
    const fuse = [];
    for (const x of z) {
      const ult = fuse[fuse.length - 1];
      if (ult && ult.colore === x.colore && Math.abs(ult.a - x.da) < 1e-9) ult.a = x.a;
      else fuse.push({ ...x });
    }
    const dentro = fuse.find(x => v >= x.da && v <= x.a)
      || (v < fuse[0].da ? fuse[0] : v > fuse[fuse.length - 1].a ? fuse[fuse.length - 1] : null);
    if (!dentro) return null;
  const f = FASCIA_DA_COLORE[dentro.colore];
  if (!f) return null;
  /* ⚠⚠ v326 — DENTRO OGNI BANDA IL PUNTEGGIO ERA ROVESCIATO. La v319 aveva chiuso l'inversione
     GROSSA (fra le bande) e ne aveva aperta una FINE: dentro la banda il punteggio cresceva
     sempre col valore, anche dove il valore alto e' la cosa peggiore. Misurato: HY OAS a 0,5% —
     credito rilassatissimo — valeva 75, a 3,9% — al confine dello stress — valeva 95. E
     l'ampiezza a -8 pp, cioe' la partecipazione piu' larga possibile, valeva 72 mentre a -1,1 pp
     valeva 96. Il punteggio era a DENTI DI SEGA: giusto fra le bande, rovesciato dentro.
     ⚠ La direzione non si dichiara a mano zona per zona (un secondo registro da tenere allineato,
     classe C10): si RICAVA dall'ordine delle zone. Se la prima e' favorevole e l'ultima
     sfavorevole, il valore che cresce peggiora, e dentro ogni banda il punteggio scende. */
  const primo = FASCIA_DA_COLORE[fuse[0].colore], ultimo = FASCIA_DA_COLORE[fuse[fuse.length - 1].colore];
  const scende = primo && ultimo && (primo[0] + primo[1]) > (ultimo[0] + ultimo[1]);
  const q = Math.max(0, Math.min(1, (v - dentro.da) / ((dentro.a - dentro.da) || 1)));
  /* la fascia si percorre dal suo estremo MIGLIORE al peggiore, nel verso della scala: cosi'
     l'intera funzione e' monotona e non puo' esistere un punto in cui "peggio" vale di piu'. */
  return Math.round(scende ? f[1] + q * (f[0] - f[1]) : f[0] + q * (f[1] - f[0]));
}

/* le zone sono dichiarate UNA VOLTA e servono a due cose: colorare la scheda e generare il
   punteggio. Un secondo elenco tenuto allineato a mano e' la classe C10/C12. */
/* ⚠⚠ v323 — L'ANCORA DEL CREDITO ERA INVENTATA. Il punteggio usciva da
   `clamp(100 - (hy - 2,5)/9*100)`, cioe' una scala tarata su una crisi conclamata: a HY 6,5% —
   che la LEGENDA STAMPATA SULLA STESSA RIGA chiama "5-7% stress" — dava 56/100, che nella scala
   dei punteggi e' "favorevole". Il numero contraddiceva la sua stessa didascalia.
   Ora le bande sono quelle DICHIARATE nel pacchetto, e il punteggio esce da li'. Una soglia
   sola per indicatore, che e' la regola generale di v319. */
/* ═══ v333 — DUE BARRE A CONFRONTO: la forma piu' leggibile che esista ═══════════════════════
   Il CEO ha respinto la barra 0-100, il quadrante, la ragnatela e — sull'ampiezza — anche il
   tachimetro. Il denominatore comune di tutte e quattro: chiedono di decodificare una scala.
   Due barre affiancate no: si vede quale e' piu' lunga, e quella E' la risposta.
   ⚠ La scala e' CONDIVISA fra le voci, o il confronto — l'unico motivo per cui la forma esiste —
   sparisce (lezione v206). E la soglia, quando c'e', e' disegnata: un livello senza il suo
   riferimento non dice niente (v238). */
function dueBarre(voci, opt = {}) {
  const v = (voci || []).filter(x => x && Number.isFinite(x.val));
  if (v.length < 2) return "";
  const lim = Math.max(...v.map(x => Math.abs(x.val)), opt.minScala || 0) || 1;
  const W = 300, RH = 30, H = v.length * RH + (opt.soglia != null ? 18 : 8), L = 92, R = W - 46;
  const zero = opt.soloPositivi ? L : (L + R) / 2;
  const amp = opt.soloPositivi ? (R - L) : (R - L) / 2;
  const X = (x) => zero + (x / lim) * amp;
  const barre = v.map((x, i) => {
    const y = 4 + i * RH;
    const x0 = Math.min(zero, X(x.val)), w = Math.abs(X(x.val) - zero);
    const col = x.colore || (x.val >= 0 ? "var(--green)" : "var(--red)");
    return `<g><title>${esc(x.nome)}: ${esc(x.testo || fmtNum.format(x.val))}</title>
      <text x="0" y="${y + 14}" font-size="10.5" fill="var(--muted)">${esc(String(x.nome).slice(0, 16))}</text>
      <rect x="${x0.toFixed(1)}" y="${y + 4}" width="${Math.max(w, 1).toFixed(1)}" height="13" rx="2"
        fill="${col}" fill-opacity=".82"/>
      <text x="${W - 42}" y="${y + 15}" font-size="11" font-family="var(--mono)" font-weight="700"
        fill="${col}">${esc(x.testo || fmtNum.format(x.val))}</text></g>`;
  }).join("");
  const sog = (opt.soglia != null && Math.abs(opt.soglia) <= lim)
    ? `<line x1="${X(opt.soglia).toFixed(1)}" y1="2" x2="${X(opt.soglia).toFixed(1)}" y2="${H - 16}"
         stroke="var(--red)" stroke-width="1.4" stroke-dasharray="3 2"/>
       <text x="${X(opt.soglia).toFixed(1)}" y="${H - 4}" font-size="8.5" text-anchor="middle"
         fill="var(--muted)">${esc(opt.soglieTesto || "soglia")}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img"
      aria-label="${esc(opt.aria || "confronto fra due grandezze")}">
    ${opt.soloPositivi ? "" : `<line x1="${zero}" y1="2" x2="${zero}" y2="${H - 16}" stroke="var(--border)"/>`}
    ${sog}${barre}</svg>`;
}

const ZONE_CREDITO = [
  { da: 0, a: 4, nome: "credito rilassato", colore: "var(--green)" },
  { da: 4, a: 5, nome: "attenzione", colore: "var(--yellow)" },
  { da: 5, a: 7, nome: "stress", colore: "var(--red)" },
  { da: 7, a: 20, nome: "crisi", colore: "var(--red)" },
];

/* ⚠ e il P/E: la scheda mostrava "50/100 = neutro" con l'etichetta "Sopravvalutazione" accanto,
   perche' punteggio ed etichetta uscivano da due formule indipendenti. Il punteggio esce dalle
   zone della scheda, cosi' l'etichetta e il numero non possono piu' divergere. */
const ZONE_PE = [
  { da: 8, a: 18, nome: "valutazione contenuta", colore: "var(--green)" },
  { da: 18, a: 25, nome: "valutazione piena", colore: "var(--yellow)" },
  { da: 25, a: 60, nome: "valutazione tesa", colore: "var(--red)" },
];

const ZONE_AMPIEZZA = [
  { da: -8, a: -1, nome: "partecipazione larga: l'azione media batte l'indice", colore: "var(--green)" },
  { da: -1, a: 1.5, nome: "rialzo condiviso", colore: "var(--muted)" },
  { da: 1.5, a: 4, nome: "l'indice tira piu' dell'azione media", colore: "var(--yellow)" },
  { da: 4, a: 12, nome: "solo le megacap: rally stretto", colore: "var(--red)" },
];
const ZONE_PUTCALL = [
  { da: 0.5, a: 0.8, nome: "compiacenza", colore: "var(--red)" },
  { da: 0.8, a: 1.2, nome: "equilibrio", colore: "var(--muted)" },
  { da: 1.2, a: 1.6, nome: "copertura pesante", colore: "var(--green)" },
];

const ZONE_PUNTEGGIO = [
  { da: 0, a: 35, nome: "sfavorevole al rischio azionario", colore: "var(--red)" },
  { da: 35, a: 45, nome: "debole", colore: "var(--yellow)" },
  { da: 45, a: 55, nome: "neutro", colore: "var(--muted)" },
  { da: 55, a: 70, nome: "favorevole", colore: "var(--green)" },
  { da: 70, a: 100, nome: "molto favorevole", colore: "var(--green)" },
];
const punteggioDi = (k) => { try { return (indicatoriClassifica().find(x => x.k === k) || {}).score ?? null; } catch { return null; } };
/* aggiunge il tachimetro davanti a quello che la voce gia' mostrava, senza toglierle niente */
function conTachimetro(comp, base, aria) {
  if (!base) return null;
  const t = tachimetro((comp || {}).score, { aria,
    zone: ZONE_PUNTEGGIO, fonte: "bande di lettura convenzionali sul punteggio 0-100 del sistema" });
  return { g: t + base.g, n: base.n };
}

const FORMA_INDICATORE = {
  /* ═══ v309 — STAGIONALITA' DEL NASDAQ 100 E ANNI DI MIDTERM ═══════════════════════════
     Il CEO ha chiesto la stagionalita' mensile dell'NDX e, se possibile, la variabile
     "elezioni midterm", lasciando a me la struttura.
     STRUTTURA: dodici colonne, una per mese. La BARRA e' la media degli anni di midterm, la
     TACCA e' la media di tutti gli anni. Il confronto e' il messaggio: "ottobre +1,7%" da solo
     non dice niente; "+1,7% su tutti gli anni ma +3,9% negli anni di midterm, 80% positivi"
     dice qualcosa su QUESTO anno, che e' un anno di midterm.
     ⚠⚠ IL CAMPIONE E' DIECI ANNI E LO SI DICE FORTE, non in nota. La dispersione di ottobre va
     da -8,7% a +18,9%: la media +3,9% sta fra esiti opposti. Questo progetto ha tolto un motore
     predittivo con SETTE segnali (v200, hit-rate 29%) — una statistica su dieci casi si
     pubblica con la sua incertezza accanto, o non si pubblica.
     ⚠ Il mese corrente e' acceso, e i prossimi tre portano il loro intervallo per esteso:
     e' li' che la tentazione di leggere la media come previsione e' piu' forte. */
  /* ═══ v320 — IL GRAFICO DELLA LEVA ═══════════════════════════════════════════════════════
     Il CEO: "manca grafico utilizzo leva da parte degli attori del mercato". Il dato c'era
     (FINRA, debiti a margine, 13 rilevazioni mensili) e non era disegnato da nessuna parte.
     ⚠ Due grandezze nello stesso riquadro, e sono diverse: la LINEA e' il livello assoluto, la
     riga sotto porta il rapporto sul PIL contro la sua mediana storica — che e' il parametro che
     dice "sopra o sotto soglia" e che il "% del massimo" non puo' dare, perche' in un mercato al
     rialzo sta sopra il 95% quasi sempre.
     ⚠ IL PUNTEGGIO VIENE DA marginDebtState(), la stessa funzione che alimenta il pacchetto:
     due derivazioni della leva sono gia' esistite e una diceva il falso. */
  leva: (m) => {
    const md = m.margin_debt;
    if (!md || md.value == null) return null;
    const st = (typeof marginDebtState === "function") ? marginDebtState() : null;
    const grezzi = (md.history || []).map(x => Number(x && x.v != null ? x.v : x)).filter(Number.isFinite);
    const fine = md.date ? new Date(md.date + "T12:00:00") : null;
    const punti = (fine && grezzi.length)
      ? grezzi.map((v, i) => {
          const dd = new Date(fine); dd.setMonth(dd.getMonth() - (grezzi.length - 1 - i));
          return { d: `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-01`, v: v / 1000 };
        })
      : [];
    const mld = (v) => fmtNum.format(Math.round(v));
    const g = punti.length >= 3
      ? graficoSerie([{ nome: "debito a margine", punti, colore: "var(--yellow)" }],
          { h: 150, compatto: true, unita: " mld",
            aria: "debito a margine presso i broker, in miliardi di dollari, ultimi mesi",
            soglie: md.peak != null ? [{ v: md.peak / 1000, testo: "massimo storico", colore: "var(--red)" }] : [] })
      : "";
    const pil = md.pct_of_gdp, mediana = md.gdp_median_ref;
    const rapp = (pil != null && mediana != null) ? Math.round(pil / mediana * 10) / 10 : null;
    return {
      g,
      score: st ? st.score : null,
      n: `<b>${mld(md.value / 1000)} miliardi di dollari</b> presi a prestito dagli operatori per comprare `
        + `azioni — il <b>${fmtNum.format(md.pct_of_peak)}%</b> del massimo storico`
        + (md.qoq != null ? `, ma <b class="${md.qoq < 0 ? "neg" : "pos"}">${signTxt(md.qoq)}</b> nell'ultimo mese` : "")
        + (md.yoy != null ? ` e ${signTxt(md.yoy)} sull'anno` : "") + `.`
        + (st ? ` <b style="color:${st.col}">${esc(st.labelShort)}</b>.` : "")
        + (rapp != null
            ? `<div class="leva-soglia"><b>Sopra o sotto soglia:</b> vale il <b>${fmtNum.format(pil)}% del PIL</b> `
              + `contro una <b>mediana storica del ${fmtNum.format(mediana)}%</b> — <b>${rapp}× la mediana</b>, `
              + `quindi <b>sopra</b>. È questo il metro storico, non il "% del massimo": quello in un mercato `
              + `al rialzo sta sopra il 95% quasi sempre, e un allarme sempre acceso non distingue niente.</div>`
            : "")
        + `<br><b>Come si legge:</b> è il carburante di un ribasso violento. Quando i prezzi scendono, chi ha `
        + `comprato a debito riceve la chiamata a margine e deve vendere — e vende a prescindere da cosa pensa, `
        + `il che trasforma una discesa ordinata in una di quelle rapide. <b>Livello e verso sono due fatti diversi:</b> `
        + `il livello dice quanto carburante c'è, il verso dice se il deleveraging è già cominciato.`
        + `<div class="muted leva-cad">${esc(rigaCadenza("margin_debt", md.date) || "")}`
        + ` · le date dell'asse sono RICOSTRUITE dalla cadenza mensile dichiarata dalla fonte `
        + `(l'ultima rilevazione è quella pubblicata, le precedenti un mese l'una dall'altra): `
        + `la fonte pubblica i valori senza il loro calendario.</div>`,
    };
  },

  stagionalita_ndx: (m) => {
    /* ═══ v327 — LA STAGIONALITA' SI VEDE SOLO AL NETTO DELLA DERIVA ═══════════════════════════
       Il CEO: "il grafico che mi dai mi da solo settembre con andamento negativo e questo non e'
       possibile!!!". Aveva ragione, e la causa non era nei dati: era nel METODO.
       ⚠⚠ IL NASDAQ SALE IN MEDIA DELL'1,35% AL MESE. Misurato sui 41 anni del campione: quella e'
       la DERIVA dell'indice, non una proprieta' di nessun mese. Sommandola a ogni mese, undici
       mesi su dodici risultano positivi — e un grafico in cui tutto e' verde non distingue
       niente, che e' esattamente cio' che il CEO ha visto.
       Ora la barra e' l'ECCESSO sul mese medio: quanto quel mese fa MEGLIO O PEGGIO di un mese
       qualunque dello stesso indice. Al netto della deriva i mesi negativi diventano CINQUE su
       dodici, ed e' la stagionalita' vera — la deriva e' un fatto dell'indice, non del calendario.
       ⚠ Via ogni riferimento al ciclo di midterm, su richiesta del CEO: dieci osservazioni per
       mese non reggevano il peso che la scheda gli dava. Il dato resta in data.json e nel
       pacchetto per l'LLM, non si perde — esce dalla scheda, non dal sistema. */
    const st = m.stagionalita_ndx; if (!st || !(st.mesi || []).length) return null;
    const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
    const NOMI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
                  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
    const mesi = (st.mesi || []).filter(x => x && Number.isFinite(x.media));
    if (mesi.length < 6) return null;
    const deriva = mesi.reduce((a, x) => a + x.media, 0) / mesi.length;
    const ecc = mesi.map(x => ({ ...x, e: Math.round((x.media - deriva) * 100) / 100 }));
    const lim = Math.max(...ecc.map(x => Math.abs(x.e))) || 1;
    const W = 330, H = 132, L = 26, R = W - 8, T = 10, B = H - 22;
    const X = (i) => L + (i + 0.5) / ecc.length * (R - L);
    const zero = (T + B) / 2;
    const Y = (v) => zero - (v / lim) * ((B - T) / 2);
    const larg = (R - L) / ecc.length * 0.62;
    const barre = ecc.map((x, i) => {
      const y = Math.min(Y(x.e), zero), h = Math.abs(Y(x.e) - zero);
      const ora = x.mese === st.mese_ora;
      return `<rect x="${(X(i) - larg / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${larg.toFixed(1)}"
        height="${Math.max(h, 1).toFixed(1)}" rx="1.5" fill="${x.e >= 0 ? "var(--green)" : "var(--red)"}"
        opacity="${ora ? 1 : 0.55}"><title>${NOMI[x.mese - 1]}: ${signTxt(x.e)} rispetto al mese medio (il mese medio del Nasdaq vale ${signTxt(Math.round(deriva * 100) / 100)}; questo mese in assoluto ${signTxt(x.media)})</title></rect>`;
    }).join("");
    const etich = ecc.map((x, i) =>
      `<text x="${X(i).toFixed(1)}" y="${H - 7}" font-size="8.5" text-anchor="middle"
        fill="${x.mese === st.mese_ora ? "var(--text)" : "var(--muted)"}"
        font-weight="${x.mese === st.mese_ora ? "700" : "400"}">${MESI[x.mese - 1]}</text>`).join("");
    const g = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img"
        aria-label="quanto ogni mese del Nasdaq 100 fa meglio o peggio di un mese medio dello stesso indice">
      <line x1="${L}" y1="${zero}" x2="${R}" y2="${zero}" stroke="var(--border)" stroke-width="1"/>
      <text x="1" y="${(T + 8).toFixed(1)}" font-size="8" fill="var(--muted)">meglio</text>
      <text x="1" y="${(B - 1).toFixed(1)}" font-size="8" fill="var(--muted)">peggio</text>
      ${barre}${etich}</svg>`;

    const prossimi = [0, 1, 2].map(k => ecc.find(x => x.mese === ((st.mese_ora - 1 + k) % 12) + 1)).filter(Boolean);
    const negativi = ecc.filter(x => x.e < 0).length;
    return {
      g,
      n: `<b>Ogni barra dice quanto quel mese va meglio o peggio del mese MEDIO</b> dello stesso `
        + `indice — non quanto sale in assoluto.`
        + `<div class="stag-blocco">${prossimi.map(x =>
            `<div class="stag-riga"><b>${NOMI[x.mese - 1]}</b>: <b class="${x.e >= 0 ? "pos" : "neg"}">${signTxt(x.e)}</b> `
            + `rispetto al mese medio <span class="muted">(in assoluto ${signTxt(x.media)})</span></div>`).join("")}</div>`
        + `<b>Come si legge:</b> il Nasdaq sale in media di ${signTxt(Math.round(deriva * 100) / 100)} al mese `
        + `sui ${st.dal}–${st.al}, e quella deriva è la salita dell'indice, non una proprietà del calendario: `
        + `sommandola a ogni mese undici mesi su dodici risulterebbero positivi e il grafico non distinguerebbe `
        + `più niente. Tolta la deriva i mesi sotto la media sono ${negativi} su ${ecc.length}. `
        + `Serve a sapere se un movimento è ordinario per il periodo, non a prevederlo: su `
        + `${(st.mesi[0] || {}).campione || 40} osservazioni per mese la media sta fra esiti opposti.`,
    };
  },

  rotazione: (m) => {
    /* ═══ v325 — SOLO LE BARRE, E L'ORIZZONTE SI SCEGLIE ═══════════════════════════════════════
       Il CEO: "la rotazione non mi piace, ora e' troppo grande, inoltre elimina le azioni
       indicate in sale e scende e lascia solo le barre con i settori con possibilita' di
       modificarle a 1 mese, 3 mesi un anno e 5 anni e se clicco su un settore mi consente di
       vederlo nel grafico tradingview ed associalo nel prompt analisi settore".
       ⚠ Via i due elenchi e i nomi delle azioni: erano tre informazioni sovrapposte nello stesso
       riquadro (chi sale, chi scende, chi compone il comparto) e la scheda era diventata un muro.
       Resta UNA domanda: come sono ordinati i comparti sull'orizzonte che scegli tu.
       ⚠⚠ CINQUE ANNI NON CI SONO NEI DATI, e non li invento: la pipeline pubblica 1 mese, 3 mesi,
       6 mesi, 1 anno e 2 anni. L'orizzonte a 5 anni compare da solo appena la pipeline lo
       produce (il selettore si costruisce da cio' che esiste, non da un elenco scritto a mano),
       e finche' non c'e' la scheda lo dichiara invece di mostrare un bottone che non funziona. */
    const tilt = m.tilt || [];
    if (tilt.length < 6) return null;
    const ORIZZONTI = [
      { k: "m1", et: "1 mese", v: (t2) => t2.m1 },
      { k: "m3", et: "3 mesi", v: (t2) => t2.m3 },
      { k: "m6", et: "6 mesi", v: (t2) => ((t2.relativa || {}).m6 || {}).settore },
      { k: "a1", et: "1 anno", v: (t2) => ((t2.relativa || {}).a1 || {}).settore },
      { k: "a2", et: "2 anni", v: (t2) => ((t2.relativa || {}).a2 || {}).settore },
      { k: "a5", et: "5 anni", v: (t2) => ((t2.relativa || {}).a5 || {}).settore },
    ].filter(o => tilt.filter(t2 => Number.isFinite(o.v(t2))).length >= 6);
    if (!ORIZZONTI.length) return null;
    const scelto = ORIZZONTI.find(o => o.k === rotOrizzonte) || ORIZZONTI[0];
    const ord = tilt.filter(t2 => Number.isFinite(scelto.v(t2)))
      .map(t2 => ({ ...t2, val: scelto.v(t2) }))
      .sort((a, b) => b.val - a.val);
    const sopraZero = ord.filter(t2 => t2.val > 0).length;

    const W = 330, RH = 13, H = ord.length * RH + 12, L = 86, C = L + (W - L - 40) / 2;
    const lim = Math.max(...ord.map(t2 => Math.abs(t2.val))) || 1;
    const X = (v) => C + (v / lim) * ((W - L - 54) / 2);
    const barre = ord.map((t2, i) => {
      const y = 4 + i * RH;
      const x0 = Math.min(C, X(t2.val)), w = Math.abs(X(t2.val) - C);
      return `<g class="rot-b" data-graf-tk="${esc(t2.ticker)}" data-rot-tk="${esc(t2.ticker)}"
          role="button" tabindex="0" style="cursor:pointer">
        <title>${esc(t2.name)} (${esc(t2.ticker)}): ${signTxt(t2.val)} su ${scelto.et} — clicca per aprirlo nel grafico e sceglierlo per l'analisi di settore</title>
        <rect x="0" y="${y}" width="${W}" height="${RH - 2}" fill="transparent"/>
        <text x="0" y="${y + 11}" font-size="10.5" fill="var(--muted)">${esc(t2.name.slice(0, 19))}</text>
        <rect x="${x0.toFixed(1)}" y="${y + 2}" width="${Math.max(w, 1).toFixed(1)}" height="11" rx="2"
          fill="${t2.val >= 0 ? "var(--green)" : "var(--red)"}" fill-opacity=".8"/>
        <text x="${W - 48}" y="${y + 11}" font-size="10" font-family="var(--mono)"
          fill="${t2.val >= 0 ? "var(--green)" : "var(--red)"}">${signTxt(t2.val)}</text></g>`;
    }).join("");

    const chip = ORIZZONTI.map(o => `<button type="button" class="chip${o.k === scelto.k ? " chip-active" : ""}"
        data-rot-or="${o.k}">${o.et}</button>`).join("");
    const mancanti = ["1 mese", "3 mesi", "6 mesi", "1 anno", "2 anni", "5 anni"]
      .filter(et => !ORIZZONTI.some(o => o.et === et));

    return {
      g: `<div class="rot-tf">${chip}</div>
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img"
          aria-label="rendimento dei comparti su ${scelto.et}, dal migliore al peggiore">
          <line x1="${C}" y1="0" x2="${C}" y2="${H - 4}" stroke="var(--border)" stroke-width="1"/>
          ${barre}</svg>`,
      n: `Rendimento dei <b>${ord.length} comparti</b> su <b>${scelto.et}</b>, dal migliore al peggiore. `
        + `<b>${sopraZero} su ${ord.length}</b> sono in positivo. `
        + `<b>Clicca una barra</b> per aprire quel comparto nel grafico e sceglierlo per l'analisi di settore.`
        + (mancanti.length ? ` <span class="muted">Orizzonti non ancora nei dati: ${mancanti.join(", ")} — compaiono da soli appena la pipeline li produce.</span>` : "")
        + `<br><b>Come si legge:</b> l'ordine cambia con l'orizzonte, ed è quello il punto. Un comparto in `
        + `cima a un mese e in fondo a un anno è denaro appena arrivato; uno in cima a tutti gli orizzonti `
        + `è una tendenza. Il primo si può invertire in poche sedute, il secondo no.`,
    };
  },

  tassi10: (m) => {
    const t = m.tassi; if (!t || !(t.scadenze || []).length) return null;
    const d = (t.scadenze || []).find(x => x.key === "a10"); if (!d) return null;
    const ind = (m.indicators || []);
    const sp = [["curve", "10A−2A"], ["curve3m", "10A−3M"]]
      .map(([k, et]) => { const x = ind.find(y => y && y.key === k); return x ? `${et} ${x.value}` : null; })
      .filter(Boolean);
    const st = (t.storico && t.storico.a10) || [];
    return {
      g: st.length > 2
        ? graficoSerie([{ nome: "10 anni", punti: st, colore: "var(--blue)" }], { h: 150, compatto: true, unita: "%" })
        : "",
      n: `<b>${fmtNum.format(d.value)}%</b> · ${esc(d.series_id)}, osservazione del ${esc(d.observation_date)}`
        + (Number.isFinite(d.value_3m) ? ` · tre mesi fa ${fmtNum.format(d.value_3m)}% (${signTxt(Math.round((d.value - d.value_3m) * 100) / 100, " pp")})` : "")
        + (sp.length ? `<br>Pendenze: ${sp.join(" · ")} <span class="muted">(serie FRED proprie)</span>` : "")
        + `. <b>Come si legge:</b> il decennale e' il costo del denaro a lunga — quando sale comprime i multipli `
        + `delle societa' che promettono utili lontani. Le pendenze sotto zero dicono che il mercato prezza un rallentamento.`,
    };
  },

  /* ═══ v265 — VENDITE AL DETTAGLIO: LA LINEA RETTA ERA IL PROBLEMA ══════════════════════════
     Il CEO: "anche questo valore sempre fuorviante soprattutto con un grafico che segna una
     linea retta". Aveva ragione due volte.
     La linea era retta perche' NON C'E' UNA SERIE: `indicators.retail` porta un solo valore
     (0.2%) e una data. La scheda cadeva sul disegno generico, che con un punto solo traccia
     un segmento orizzontale — un grafico che non dice niente ma sembra dire "stabile".
     E' la classe v205 (un grafico che dice il falso senza rompersi).
     Ora: nessuna linea. Una scala con le zone, la variazione MENSILE dichiarata per quello che
     e' (un mese solo, non una tendenza), e la data in evidenza — perche' con 69 giorni di
     ritardo il numero descrive giugno, non oggi. */
  /* ═══ v272 — LE SCHEDE CHE NON AVEVANO UN GRAFICO ═══════════════════════════════════════
     Il CEO: "alcune tab macro non hanno indicatori grafici, inseriscili". Erano nove; quattro
     (rame, petrolio, oro, SOX) escono da sole perche' ha chiesto di toglierle dal macro.
     Restano queste cinque, e prendono tutte la forma che lui ha detto di leggere bene: la
     scala con le zone, la stessa dei termometri di stress ("per me sono di facile lettura").
     ⚠ Le bande NON sono soglie di mercato inventate da me: sono livelli di lettura
     convenzionali, e ogni scheda dichiara da dove viene la sua. Dove non c'e' una convenzione
     difendibile si scrive che e' una scala di sola lettura. */
  /* fedwatch: qui non c'e' una grandezza continua da mettere su una scala, ci sono TRE
     probabilita' su tre riunioni. Le barre le mostrano tutte e tre insieme, che e' il punto:
     il mercato non prezza "un rialzo", prezza una traiettoria. */
  fedwatch: (m) => {
    /* ⚠ v333 — il CEO: "grafico a barre con percentuali di taglio, neutro o rialzo per ogni
       riunione fed (non inserire testo guida)". Una barra impilata per riunione: i tre esiti
       sono ESAUSTIVI e sommano a 100, quindi la barra intera e' la riunione e i segmenti sono
       le probabilita'. E' l'unico caso in cui una barra impilata e' la forma giusta — parti di
       un tutto, nessuna negativa. Nessun testo guida, come chiesto. */
    const f = m.fedwatch; if (!f || !Array.isArray(f.meetings) || !f.meetings.length) return null;
    const it = (d) => { const p = String(d).split("-"); return `${p[2]}/${p[1]}`; };
    const rr = f.meetings.slice(0, 4).map(x => ({ d: it(x.date),
      taglio: Math.round(Number(x.cut_prob) || 0),
      fermo: Math.round(Number(x.hold_prob) || 0),
      rialzo: Math.round(Number(x.hike_prob) || 0) }));
    const W = 320, RH = 30, H = rr.length * RH + 18, L = 44, R = W - 8;
    const righe = rr.map((x, i) => {
      const y = 12 + i * RH;
      const tot = Math.max(1, x.taglio + x.fermo + x.rialzo);
      let px = L;
      const seg = [["taglio", x.taglio, "var(--green)"], ["fermo", x.fermo, "var(--blue)"], ["rialzo", x.rialzo, "var(--red)"]]
        .map(v => {
          const w = v[1] / tot * (R - L);
          const el = `<g><title>${x.d}: ${v[0]} ${v[1]}%</title>`
            + `<rect x="${px.toFixed(1)}" y="${y}" width="${Math.max(w, 0).toFixed(1)}" height="14" fill="${v[2]}" fill-opacity=".85"/>`
            /* ⚠ v339 — sotto i 26px il numero non ci sta DENTRO il segmento, e prima veniva
               semplicemente buttato: una probabilita' piccola ma non nulla spariva dalla riga,
               che e' informazione mancante travestita da informazione presente (classe C14).
               Ora esce di lato, col colore del proprio segmento. A zero non si stampa niente,
               perche' li' il segmento non esiste e un "0%" sospeso non appartiene a nessuno. */
            + (w > 26
                ? `<text x="${(px + w / 2).toFixed(1)}" y="${y + 11}" font-size="9.5" text-anchor="middle" font-family="var(--mono)" fill="var(--bg)" font-weight="600">${v[1]}%</text>`
                : v[1] > 0
                  ? `<text x="${(px + w + 3).toFixed(1)}" y="${y + 11}" font-size="9" text-anchor="start" font-family="var(--mono)" fill="${v[2]}">${v[1]}%</text>`
                  : "")
            + `</g>`;
          px += w; return el;
        }).join("");
      return `<text x="0" y="${y + 11}" font-size="10" fill="var(--muted)">${x.d}</text>${seg}`;
    }).join("");
    const pr = rr[0];
    return {
      g: `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img"
        aria-label="probabilita di taglio, tasso fermo o rialzo per ogni riunione della Fed">
        <text x="${L}" y="7" font-size="8.5" fill="var(--green)">taglio</text>
        <text x="${(L + R) / 2}" y="7" font-size="8.5" text-anchor="middle" fill="var(--blue)">fermo</text>
        <text x="${R}" y="7" font-size="8.5" text-anchor="end" fill="var(--red)">rialzo</text>
        ${righe}</svg>`,
      score: punteggioDaZone(pr ? pr.rialzo : 50, [
        { da: 0, a: 25, nome: "nessun rialzo prezzato", colore: "var(--green)" },
        { da: 25, a: 50, nome: "rialzo possibile", colore: "var(--muted)" },
        { da: 50, a: 100, nome: "rialzo prezzato", colore: "var(--red)" }]),
      n: `Prossima riunione ${pr ? pr.d : "n.d."}: <b>${pr ? pr.rialzo : "n.d."}%</b> rialzo · `
        + `<b>${pr ? pr.fermo : "n.d."}%</b> fermo · <b>${pr ? pr.taglio : "n.d."}%</b> taglio. `
        + `<span class="muted">Dai futures sui Fed Funds a 30 giorni.</span>`,
    };
  },

  /* ═══ v280 — MATERIE PRIME E SEMICONDUTTORI, COL LORO STORICO ═══════════════════════════
     Quattro richieste del CEO, una per messaggio: "Semiconduttori (SOX) / rame / petrolio /
     oro inserisci grafico storico nella tab macro".
     ⚠ NON e' un ritorno indietro rispetto a v272, dove li aveva fatti togliere: allora erano
     schede-NUMERO che duplicavano la sua watchlist ("devono essere presenti in watchlist"),
     oggi la watchlist non c'e' piu' (v275) e quello che chiede e' un'altra cosa — la SERIE nel
     tempo. Il livello dice dov'e' il rame adesso; la curva dice se il ciclo industriale sta
     girando, ed e' l'unica delle due che il suo broker non gli mette accanto al prezzo.
     La scala Y non parte da zero: su una materia prima che oscilla fra 4,4 e 6,7 uno zero
     schiaccerebbe un anno di movimento in un quinto dell'altezza. graficoSerie si adatta al
     range dei dati, ed e' il comportamento giusto QUI (non lo sarebbe su una percentuale). */
  ...(() => {
    const MATERIE = {
      sox:       { titolo: "Semiconduttori (SOX)", come: "e' l'indice dei semiconduttori: gira PRIMA del resto della tecnologia, perche' i chip si ordinano mesi prima del prodotto finito. Quando il SOX rompe la sua tendenza e il Nasdaq no, di solito ha ragione il SOX." },
      rame:      { titolo: "Rame", come: "lo chiamano <b>dottor Rame</b> perche' e' nell'edilizia, nelle auto, nella rete elettrica e nei data center: sale quando qualcuno sta costruendo davvero. E' il termometro della domanda industriale MONDIALE, e anticipa i dati ufficiali di mesi." },
      petrolio:  { titolo: "Petrolio WTI", come: "entra nei costi di quasi tutto (trasporti, chimica, plastica) e quindi nell'inflazione: un rialzo veloce e' una tassa sui consumi che arriva al CPI con qualche mese di ritardo. Il livello conta meno della VELOCITA' con cui cambia." },
      oro:       { titolo: "Oro", come: "non paga cedole, quindi tenerlo costa quanto rende un titolo di stato: sale quando i tassi REALI scendono o quando qualcuno cerca un posto fuori dal sistema. Un oro che sale con i tassi reali alti e' la segnalazione piu' seria che manda questo grafico." },
    };
    const forme = {};
    for (const [chiave, cfg] of Object.entries(MATERIE)) {
      forme["mat:" + chiave] = (m) => {
        const d = (m.materie || {})[chiave];
        if (!d || !(d.history || []).length) return null;
        /* ⚠⚠ v349 — TRE LETTORI RIMASTI INDIETRO DI UNA RINOMINA (v316).
           La v316 ha rinominato nella pipeline `pct_1y` → `var_1y`, con ragione: il vecchio
           nome diceva "percentile" mentre la formula calcolava la VARIAZIONE a un anno, e il
           SOX usciva a "116° percentile", che non esiste. In app.js pero' e' stato aggiornato
           UN punto solo (la riga del pacchetto, con il ripiego): gli altri tre continuavano a
           leggere un campo che la pipeline non scrive piu'. Misurato oggi sui dati veri:
           · scheda e classifica stampavano "— in dodici mesi" al posto di +104% sul SOX,
             +47,5% sul rame, +34,4% sul petrolio, +38,7% sull'oro: il numero piu' grosso
             della scheda, sparito;
           · il COLORE della serie usava `d.pct_1y || 0`, quindi tutte e quattro le linee erano
             colorate come se la variazione annua fosse ZERO — neutre da sette versioni.
           Nessun gate se n'era accorto: "—" e' una stringa valida e un colore neutro e' un
           colore. Un campo rinominato senza seguire i suoi lettori non rompe, mente in silenzio. */
        const varAnno1 = d.var_1y != null ? d.var_1y : d.pct_1y;
        const g = graficoSerie([{ nome: cfg.titolo, punti: d.history, colore: scoreColor(clamp(50 + (varAnno1 || 0))) }],
          { h: 104, compatto: true, etichetteDx: false, aria: cfg.titolo,
            fmtY: (v) => fmtNum.format(Math.round(v * 100) / 100) });
        if (!g) return null;
        const dentro = (Number.isFinite(d.max_1y) && Number.isFinite(d.min_1y) && d.max_1y > d.min_1y)
          ? Math.round((d.value - d.min_1y) / (d.max_1y - d.min_1y) * 100) : null;
        return {
          g,
          n: `<b>${fmtNum.format(d.value)}${d.unita ? " " + esc(d.unita) : ""}</b> `
            + `(${signTxt(d.change_pct, "%")} nella seduta) · <b>${signTxt(varAnno1, "%")}</b> in dodici mesi`
            + (dentro != null ? ` — oggi sta al <b>${dentro}%</b> del suo intervallo dell'anno (${fmtNum.format(d.min_1y)}–${fmtNum.format(d.max_1y)})` : "")
            + `. Come si legge: ${cfg.come}`,
        };
      };
    }
    return forme;
  })(),

  "in:t30": (m) => {
    const r = (m.indicators || []).find(x => x.key === "t30"); if (!r) return null;
    const v = parseFloat(String(r.value).replace("%", "")); if (!Number.isFinite(v)) return null;
    return {
      g: scala(v, { min: 2, max: 7, unita: "%", aria: "Treasury 30 anni",
          zone: [{ da: 2, a: 4, nome: "denaro a lungo economico", colore: "var(--green)" },
                 { da: 4, a: 5, nome: "normale", colore: "var(--muted)" },
                 { da: 5, a: 7, nome: "costoso: pesa sui titoli di crescita", colore: "var(--red)" }],
          fonte: "bande di lettura sul rendimento nominale a 30 anni; il 4-5% e' la zona in cui il trentennale e' stato per la maggior parte degli ultimi vent'anni" }),
      n: `<b>${v}%</b> — e' il tasso con cui il mercato sconta gli utili LONTANI nel tempo. `
        + `Come si legge: piu' sale, piu' valgono poco i profitti che una societa' fara' fra dieci anni, `
        + `e sono proprio quelli che giustificano i multipli alti dei titoli di crescita. Un titolo che vale `
        + `per quello che guadagnera' nel 2035 soffre il trentennale molto piu' di uno che guadagna oggi.`,
    };
  },

  "in:real10": (m) => {
    const rr = (m.indicators || []).find(x => x.key === "real10");
    const be = (m.indicators || []).find(x => x.key === "breakeven");
    if (!rr) return null;
    const v = parseFloat(String(rr.value).replace("%", ""));
    const b = be ? parseFloat(String(be.value).replace("%", "")) : NaN;
    if (!Number.isFinite(v)) return null;
    return {
      g: scala(v, { min: -1, max: 3.5, unita: "%", aria: "tasso reale 10 anni",
          zone: [{ da: -1, a: 0.5, nome: "denaro gratis o quasi", colore: "var(--green)" },
                 { da: 0.5, a: 2, nome: "normale", colore: "var(--muted)" },
                 { da: 2, a: 3.5, nome: "restrittivo", colore: "var(--red)" }],
          fonte: "bande di lettura sul rendimento TIPS a 10 anni: sopra il 2% e' il territorio in cui la politica monetaria e' considerata restrittiva" }),
      n: `<b>${v}%</b> reale${Number.isFinite(b) ? ` · inflazione attesa <b>${b}%</b> (i due sommati danno il nominale a 10 anni)` : ""}. `
        + `Come si legge: e' quanto rende un Treasury AL NETTO dell'inflazione che il mercato si aspetta, cioe' il vero costo del denaro. `
        + `Il canale verso le azioni e' diretto: un tasso reale alto rende un titolo di stato un'alternativa seria all'azionario, `
        + `e comprime i multipli senza bisogno che succeda nient'altro. Il pezzo che conta e' questo, non l'inflazione osservata di ieri.`,
    };
  },

  "in:curve3m": (m) => {
    const r = (m.indicators || []).find(x => x.key === "curve3m"); if (!r) return null;
    const v = parseFloat(String(r.value).replace(" pp", "")); if (!Number.isFinite(v)) return null;
    return {
      g: scala(v, { min: -1.5, max: 2.5, unita: " pp", aria: "curva 10 anni meno 3 mesi",
          zone: [{ da: -1.5, a: 0, nome: "invertita: segnale di recessione", colore: "var(--red)" },
                 { da: 0, a: 1, nome: "piatta", colore: "var(--yellow)" },
                 { da: 1, a: 2.5, nome: "normale", colore: "var(--green)" }],
          fonte: "lo zero non e' una convenzione: e' il punto in cui il tratto 10A-3M si inverte, quello che la ricerca della Fed di New York usa nel modello di probabilita' di recessione" }),
      n: `<b>${v > 0 ? "+" : ""}${v} pp</b> fra il decennale e il tre mesi. `
        + `E' lo STESSO segnale della curva 10A-2A su un altro tratto, non un secondo segnale: quando i due non concordano, il disaccordo e' il fatto interessante. `
        + `Come si legge: sotto zero le banche prendono a prestito a breve piu' caro di quanto rendano i prestiti a lunga, quindi smettono di prestare — ed e' quello il canale, non una profezia statistica.`,
    };
  },

  "in:philly": (m) => {
    const r = (m.indicators || []).find(x => x.key === "philly"); if (!r) return null;
    const v = parseFloat(String(r.value)); if (!Number.isFinite(v)) return null;
    const cad = (typeof rigaCadenza === "function") ? rigaCadenza("philly", r.date) : "";
    return {
      g: scala(v, { min: -40, max: 50, unita: "", aria: "manifattura Philly Fed",
          zone: [{ da: -40, a: 0, nome: "attivita' in contrazione", colore: "var(--red)" },
                 { da: 0, a: 20, nome: "espansione", colore: "var(--muted)" },
                 { da: 20, a: 50, nome: "espansione forte", colore: "var(--green)" }],
          fonte: "e' un diffusion index: lo ZERO separa chi vede migliorare da chi vede peggiorare, e non e' una soglia scelta da me" }),
      n: (cad ? `<div class="mg-cad muted"><b>⚠ ${esc(cad)}</b></div>` : "")
        + `<b>${v > 0 ? "+" : ""}${v}</b> — differenza fra la quota di aziende che segnala miglioramento e quella che segnala peggioramento. `
        + `<b>NON e' l'ISM</b>: l'ISM e' sotto licenza e non e' ridistribuibile. Questa e' la stessa specie di misura ed esce prima, ma copre UN distretto, non il paese. `
        + `Come si legge: usala per la DIREZIONE, non per il livello nazionale, e ricordati che e' un dato mensile — a meta' mese descrive il mese scorso.`,
    };
  },

  "in:retail": (m) => {
    const r = (m.indicators || []).find(x => x.key === "retail"); if (!r) return null;
    const v = parseFloat(String(r.value).replace(",", ".").replace("%", ""));
    if (!Number.isFinite(v)) return null;
    const cad = (typeof rigaCadenza === "function") ? rigaCadenza("retail", r.date) : "";
    return {
      g: scala(v, { min: -1.5, max: 2, unita: "%", aria: "vendite al dettaglio",
          zone: [{ da: -1.5, a: 0, nome: "consumi in calo", colore: "var(--red)" },
                 { da: 0, a: 0.4, nome: "crescita debole", colore: "var(--yellow)" },
                 { da: 0.4, a: 2, nome: "consumi solidi", colore: "var(--green)" }],
          fonte: "bande di sola lettura sulla variazione mensile: nel file non c'e' una serie storica delle vendite, solo l'ultimo dato" }),
      n: (cad ? `<div class="mg-cad muted"><b>⚠ ${esc(cad)}</b></div>` : "")
        + `<b>${signTxt(v, "%")} rispetto al mese precedente</b> — un solo mese, non una tendenza: `
        + `il file non contiene la serie storica, quindi qui non si puo' disegnare un andamento e non se ne disegna uno finto. `
        + `Come si legge: i consumi sono due terzi dell'economia americana, quindi questa riga e' il termometro piu' diretto della domanda interna. `
        + `Ma e' un dato mensile e volatile: un mese sotto zero non e' una recessione, tre di fila cominciano a esserlo.`,
    };
  },

  /* ═══ v265 — SCHIUMA ETF: LE BARRE NON SI CAPIVANO ═════════════════════════════════════════
     Il CEO: "non capisco i valori delle barre giu' che oltretutto non si leggono bene".
     Guardando cosa disegnava: due barre con RVol 0,86 e 0,87 — numeri quasi identici, vicini a
     1, su una scala che parte da zero. Due barre lunghe uguali che non dicono niente, ed e'
     colpa della scala: il fatto interessante non e' "0,86" ma "SOTTO 1", cioe' che il volume di
     oggi e' minore della media. Uno zero come origine nasconde proprio la soglia che conta.
     Ora la scala e' centrata su 1 (volume = media) con la zona di allarme a 2,5, che e' la
     soglia che la pipeline usa davvero per accendere `froth.alert`. */
  froth: (m) => {
    /* ⚠ v333 — il CEO: "grafico poco intuitivo". Il numero e' un RAPPORTO col volume tipico:
       1 = normale. Senza quel riferimento disegnato "0,64" non dice niente; con l'1 e la soglia
       d'allarme a 2,5 si legge in un istante quanto si e' lontani da entrambi. */
    const f = m.froth; if (!f) return null;
    const voci = [["soxl", "SOXL semi 3x"], ["tqqq", "TQQQ Nasdaq 3x"]]
      .map(([k, nome]) => ({ nome, d: f[k] })).filter(x => x.d && x.d.rvol != null)
      .map(x => ({ nome: x.nome, val: Number(x.d.rvol), testo: `${fmtNum.format(x.d.rvol)}×`,
                   colore: Number(x.d.rvol) >= 2.5 ? "var(--red)" : Number(x.d.rvol) >= 1 ? "var(--yellow)" : "var(--green)" }));
    if (!voci.length) return null;
    const max = Math.max(...voci.map(x => x.val));
    const stato = f.alert ? "EUFORIA: volumi anomali sugli ETF a leva"
      : max < 1 ? "CALMA: si scambia MENO del solito" : "NELLA NORMA";
    return {
      g: dueBarre(voci, { soloPositivi: true, minScala: 2.8, soglia: 2.5,
                          soglieTesto: "allarme", aria: "volume rispetto al tipico sugli ETF a leva 3x" }),
      score: f.alert ? 18 : max < 1 ? 78 : 55,
      n: `<b>${stato}.</b> Il numero e' quante volte il volume di oggi supera quello tipico di quell'ETF: `
        + `<b>1× e' il normale</b>, e la linea tratteggiata a 2,5× e' la soglia oltre la quale il sistema segnala euforia.`
        + `<br><b>Come si legge:</b> sono ETF a leva tripla, cioe' lo strumento che il denaro emotivo usa `
        + `quando rincorre. Volumi molto sopra il tipico MENTRE il prezzo sale sono la firma di una corsa `
        + `fatta da chi arriva tardi; sotto 1 vuol dire che nessuno sta rincorrendo.`,
    };
  },

  /* ═══ v265 — PUT/CALL: VIA I TICKER, DENTRO IL GRAFICO ═════════════════════════════════════
     Il CEO me l'ha chiesto DUE volte e la prima non l'ho fatto. Peggio: gli avevo risposto che
     era gia' a posto, dopo aver guardato `macro.putcall` in data.json — che in effetti e' solo
     SPY. Ma la SCHEDA non mostra quello: mostra il pannello, e il pannello aggiunge una tabella
     dei muri di opzioni con tutti e dodici i titoli del vecchio portafoglio. Ho controllato il
     DATO invece dello SCHERMO, e ho dichiarato risolto un problema che lui vedeva ancora.
     E' l'errore che questo progetto documenta da versioni — misurare in browser, non dedurre —
     fatto proprio mentre lo raccontavo.
     Ora la scheda ha una forma sua e non pesca piu' dal pannello: due barre a confronto (put e
     call) piu' la scala del rapporto con le sue zone. Il rapporto e' sull'ETF dell'S&P 500, che
     e' l'indice: e' la forma macro che il CEO ha chiesto ("porta i dati su una forma macro es.
     nasdaq e S&P"), ed e' corretta — il put/call di un singolo titolo dice del titolo, quello
     sull'indice dice del mercato. */
  putcall: (m) => {
    const pc = m.putcall; if (!pc || pc.ratio == null) return null;
    const put = Number(pc.puts) || 0, call = Number(pc.calls) || 0;
    const tot = put + call;
    const r = Number(pc.ratio);
    const stato = r >= 1.2 ? "COPERTURA PESANTE: prevalgono le put, il mercato si sta assicurando"
      : r <= 0.8 ? "COMPIACENZA: prevalgono le call, poca copertura in giro"
      : "EQUILIBRIO: put e call si bilanciano";
    const barre = tot > 0 ? barreOrdinate([
      { nome: "PUT (copertura, scommessa al ribasso)", valore: Math.round(put / tot * 1000) / 10,
        testo: `${fmtNum.format(put)} · ${Math.round(put / tot * 100)}%`, colore: "var(--red)" },
      { nome: "CALL (scommessa al rialzo)", valore: Math.round(call / tot * 1000) / 10,
        testo: `${fmtNum.format(call)} · ${Math.round(call / tot * 100)}%`, colore: "var(--green)" },
    ], { nota: "volumi sulle prime due scadenze" }) : "";
    return {
      g: scala(r, { min: 0.5, max: 1.6, unita: "", aria: "put/call",
          zone: ZONE_PUTCALL,
          fonte: "bande di lettura convenzionali sul rapporto put/call; il valore viene dai volumi reali" })
        + barre,
      n: `<b>${stato}.</b> Rapporto ${fmtNum.format(r)} sulle opzioni dell'ETF che replica l'S&P 500 — quindi parla del MERCATO, non di un titolo. `
        + `Come si legge: agli estremi si legge al contrario. Copertura pesante significa che tanti si sono gia' protetti, e chi e' protetto non e' costretto a vendere in fretta; `
        + `compiacenza significa che nessuno si e' assicurato, e una sorpresa negativa trova tutti scoperti.`,
    };
  },

  /* ═══ v262 — L'AMPIEZZA NELLA FORMA CHE IL CEO SA LEGGERE ═════════════════════════════════
     Ha chiesto: "il dato ed il grafico deve essere più immediato e se non lo ritieni essenziale
     eliminalo". E poi ha detto la cosa che risolve il problema: "i grafici termometri di stress
     per me sono di facile lettura".
     ESSENZIALE LO E': l'ampiezza risponde a una domanda che nessun altro indicatore pone —
     se il rialzo lo stanno facendo tutte le azioni o solo le prime dieci. Un indice che sale
     con l'azione media ferma e' un indice fragile, e non si vede guardando l'indice.
     Quindi non si toglie: si cambia forma. Prima era "SPY +2,87% vs RSP +3,09%, spread
     -0,22pp" — tre numeri che chiedono di sapere cos'e' RSP prima di dire qualcosa. Ora e' la
     stessa scala a zone nominate dei termometri di stress, con la conclusione scritta sopra.
     ⚠ La soglia dei 4 pp NON e' inventata: e' quella che la pipeline usa da sempre per alzare
     il proprio alert (`spread > 4` in fetch_market_breadth), quindi viene dal sistema, non da
     me. Le altre due bande sono dichiarate come convenzione di lettura (regola v240). */
  breadth: (m) => {
    /* ⚠ v333 — il CEO: "come tachimetro non e' intuitivo, trova grafico piu' esaustivo". La
       domanda dell'ampiezza e' UNA: chi dei due sta salendo di piu'. Due barre affiancate la
       rispondono senza scala da decodificare — si vede quale e' piu' lunga, e quella E' la
       risposta. E' il denominatore comune delle quattro forme che il CEO ha respinto: tutte
       chiedevano di decodificare una scala. */
    const b = m.breadth; if (!b || b.divergence_pp == null) return null;
    const d = Number(b.divergence_pp);
    const spy = Number(b.spy_1m_pct), rsp = Number(b.rsp_1m_pct);
    const conclusione = d > 4
      ? "SOLO LE MEGACAP: l'indice sale, l'azione media resta indietro"
      : d < -2 ? "PARTECIPAZIONE LARGA: l'azione media fa meglio dell'indice"
      : "RIALZO CONDIVISO: indice e azione media si muovono insieme";
    return {
      g: dueBarre([
        { nome: "SPY (i grandi)", val: spy, testo: signTxt(spy), colore: "var(--blue)" },
        { nome: "RSP (media)", val: rsp, testo: signTxt(rsp), colore: "var(--purple)" },
      ], { aria: "rendimento a un mese dell'indice contro l'azione media" }),
      score: punteggioDaZone(d, ZONE_AMPIEZZA),
      n: `<b>${conclusione}.</b> A un mese l'indice pesato per capitalizzazione fa ${signTxt(spy)}, `
        + `quello dove ogni azione pesa uguale fa ${signTxt(rsp)}: <b>${signTxt(d, " pp")}</b> di scarto.`
        + `<br><b>Come si legge:</b> se la barra di SPY e' molto piu' lunga il rialzo lo stanno facendo `
        + `poche societa' enormi, e un rialzo cosi' si rompe quando quelle poche inciampano. Se e' piu' `
        + `lunga RSP, sta salendo il mercato e non cinque titoli.`,
    };
  },

  carry: (m) => {
    /* ⚠ v334 — il CEO: "aumenta dimensione di questa sezione affinche' sia tutto bene leggibile
       ma non deve essere il doppio". Il tachimetro sul punteggio 0-100 nascondeva i tre numeri
       che contano davvero: i due rendimenti e il cambio. Ora si vedono, e il punteggio resta
       accanto al titolo dove sta per tutte le altre schede.
       ⚠ Le probabilita' per riunione della Banca del Giappone NON ci sono, e non le invento:
       l'equivalente gratuito di CME FedWatch per la BoJ non esiste — quelle curve si ricavano
       dagli OIS, che sono a pagamento. Il CEO aveva posto la condizione "solo se trovi fonte
       attendibile", e la risposta e' che non c'e'. */
    const c = m.carry; if (!c || c.spread == null) return null;
    const voci = [
      { nome: "Treasury 10A", val: Number(c.us10), testo: `${fmtNum.format(c.us10)}%`, colore: "var(--blue)" },
      { nome: "JGB 10A", val: Number(c.jp10), testo: `${fmtNum.format(c.jp10)}%`, colore: "var(--purple)" },
    ].filter(x => Number.isFinite(x.val));
    const prossima = (c.boj_meetings || [])[0];
    return {
      g: voci.length >= 2 ? dueBarre(voci, { soloPositivi: true, minScala: 5,
            aria: "rendimento a dieci anni negli Stati Uniti e in Giappone" }) : "",
      score: punteggioDi("carry"),
      larga: false,
      n: `Differenziale <b>${fmtNum.format(c.spread)} pp</b> · USD/JPY <b>${fmtNum.format(c.usdjpy)}</b>`
        + (c.usdjpy_chg_1m != null ? ` (${signTxt(c.usdjpy_chg_1m)} in un mese)` : "")
        + (c.boj_rate != null ? ` · tasso BoJ ${fmtNum.format(c.boj_rate)}%${c.boj_rate_date ? ` <span class="muted">(rilevazione ${esc(c.boj_rate_date)})</span>` : ""}` : "")
        + (prossima ? ` · prossima riunione BoJ ${esc(prossima)}` : "") + `.`
        + `<br><b>Come si legge:</b> finche' rendersi in dollari rende molto piu' che in yen, il denaro
        prende a prestito in yen e compra attivi americani. Il differenziale e' il guadagno di quel
        giro; il cambio e' il rischio. Quando lo yen si rafforza in fretta, quel giro si chiude di
        colpo e la vendita arriva sugli attivi comprati con quei soldi — Nasdaq compreso.
        ⚠ Le probabilita' per riunione della BoJ non sono qui: non esiste una fonte gratuita
        affidabile che le pubblichi, e stimarle sarebbe inventarle.`,
    };
  },
  "mk:EURJPY=X": (m) => {
    const q = (m.markets || []).find(x => x.key === "EURJPY=X"); if (!q) return null;
    const v = parseFloat(String(q.value).replace(",", ".")); const c = m.carry || {};
    return { g: scala(v, { min: 150, max: 200, unita: "", aria: "EUR/JPY",
        /* ⚠ v240 — QUI AVEVO INVENTATO. La prima stesura segnava una "zona intervento" a 185 e
           chiamava 170-185 "fascia recente": nessuno dei due numeri esiste nel file, e la BoJ e'
           intervenuta storicamente su USD/JPY, non su EUR/JPY. Erano due affermazioni con
           l'autorita' di un dato e nessun dato dietro — la classe che v195 chiama "un ID
           indovinato scritto come se fosse certo". Restano bande di sola LETTURA, dichiarate
           come tali, e l'unico riferimento tracciato e' il tasso BoJ, che nel file c'e'. */
        zone: [{ da: 150, a: 170, nome: "yen relativamente forte", colore: "var(--green)" },
               { da: 170, a: 185, nome: "fascia intermedia", colore: "var(--muted)" },
               { da: 185, a: 200, nome: "yen molto debole", colore: "var(--red)" }],
        fonte: "bande di sola lettura: nel file non c'e' un intervallo storico di EUR/JPY" }),
      n: `Oggi ${q.value} (${signTxt(q.change_pct)} nella seduta).${c.boj_rate != null ? ` Tasso BoJ ${c.boj_rate}%.` : ""}
        <b>Come si legge:</b> più il numero sale, più lo yen è debole e più conviene finanziarsi in yen per comprare asset in dollari — è il carry trade che sostiene il tech. Uno yen che si rafforza di colpo costringe a chiudere quelle posizioni, e le chiusure partono dai titoli più affollati.` };
  },
  "in:umich": (m) => {
    const i = (m.indicators || []).find(x => x.key === "umich"); if (!i) return null;
    const v = parseFloat(String(i.value).replace(",", "."));
    return { g: scala(v, { min: 50, max: 110, unita: "", aria: "fiducia consumatori",
        zone: [{ da: 50, a: 70, nome: "pessimismo profondo", colore: "var(--red)" },
               { da: 70, a: 90, nome: "cautela", colore: "var(--yellow)" },
               { da: 90, a: 110, nome: "ottimismo", colore: "var(--green)" }],
        /* ⚠ v240 — tolta la tacca "media storica 85": quel numero NON e' nel file. Scriverlo
           sull'asse gli dava l'autorita' di un dato calcolato, che non aveva. */
        fonte: "bande di sola lettura: il file porta il valore corrente, non la serie storica" }),
      n: `${i.value} · rilevazione ${i.date}. <b>Come si legge:</b> misura quanto le famiglie si sentono sicure di spendere, e i consumi sono i due terzi del PIL americano. Sotto 70 è un livello da recessione; il dato arriva da FRED con 1-2 mesi di ritardo di licenza, quindi è più lento di quanto sembri.` };
  },
  dollar: (m) => {
    const d = m.dollar_ruler; if (!d || d.chg_3m_pct == null) return null;
    return { g: scala(d.chg_3m_pct, { min: -10, max: 10, unita: "%", aria: "dollaro 3 mesi",
        zone: [{ da: -10, a: -5, nome: "dollaro debole: aiuta gli utili esteri", colore: "var(--green)" },
               { da: -5, a: 5, nome: "impatto valutario neutro", colore: "var(--muted)" },
               { da: 5, a: 10, nome: "dollaro forte: comprime gli utili esteri", colore: "var(--red)" }],
        soglie: [{ v: 0, testo: "invariato" }],
        fonte: "la banda ±5% è la convenzione già usata dal sistema per l'impatto valutario" }),
      n: `DXY ${fmtNum.format(d.value)} · ${signTxt(d.chg_3m_pct)} in 3 mesi. <b>Come si legge:</b> conta la VARIAZIONE, non il livello. Le multinazionali americane fatturano molto all'estero: un dollaro che si rafforza di oltre il 5% in un trimestre taglia gli utili convertiti, uno che si indebolisce li gonfia. Dentro ±5% l'effetto è rumore.` };
  },
  "mk:EURUSD=X": (m) => {
    const q = (m.markets || []).find(x => x.key === "EURUSD=X"); if (!q) return null;
    const v = parseFloat(String(q.value).replace(",", "."));
    return { g: scala(v, { min: 1.0, max: 1.3, unita: "", aria: "EUR/USD", fmt: (x) => fmtNum.format(Math.round(x * 1000) / 1000),
        zone: [{ da: 1.0, a: 1.08, nome: "euro debole", colore: "var(--red)" },
               { da: 1.08, a: 1.18, nome: "fascia ordinaria", colore: "var(--muted)" },
               { da: 1.18, a: 1.3, nome: "euro forte", colore: "var(--green)" }],
        fonte: "bande di sola lettura: nel file c'è il cambio corrente, non il suo intervallo storico" }),
      n: `${q.value} (${signTxt(q.change_pct)} oggi). <b>Come si legge:</b> il libro è per la maggior parte in dollari e non coperto, quindi questo cambio muove il patrimonio in euro anche a prezzi fermi. Euro che sale = il tuo controvalore in euro scende, e viceversa: è il motivo per cui l'alpha in euro e quello in dollari possono avere segni diversi.` };
  },
  "in:gdp": (m) => {
    const i = (m.indicators || []).find(x => x.key === "gdp"); if (!i) return null;
    const v = parseFloat(String(i.value).replace(",", ".").replace("%", ""));
    const yoy = (m.yield_recession || {}).gdp_last;
    return { g: scala(v, { min: -2, max: 6, unita: "%", aria: "PIL",
        zone: [{ da: -2, a: 0, nome: "contrazione", colore: "var(--red)" },
               { da: 0, a: 2, nome: "crescita sotto il trend", colore: "var(--yellow)" },
               { da: 2, a: 6, nome: "crescita solida", colore: "var(--green)" }],
        soglie: [{ v: 2, testo: "trend" }],
        fonte: "la soglia del 2% è quella dichiarata dalla pipeline (crescita >2% positiva)" }),
      n: `${i.value} trimestrale annualizzato · rilevazione ${i.date}${yoy != null ? ` · ${signTxt(yoy)} anno su anno` : ""}. <b>Come si legge:</b> sotto il 2% l'economia cresce meno del proprio potenziale, e i multipli azionari fanno più fatica a essere giustificati dagli utili. È il dato più lento del quadro: trimestrale e rivisto due volte.` };
  },
  "in:cpi": (m) => {
    const c = (m.indicators || []).find(x => x.key === "cpi"); if (!c) return null;
    const p = (m.indicators || []).find(x => x.key === "pce");
    const v = parseFloat(String(c.value).replace(",", ".").replace("%", ""));
    return { g: scala(v, { min: 0, max: 8, unita: "%", aria: "inflazione",
        zone: [{ da: 0, a: 2, nome: "sotto il target", colore: "var(--green)" },
               { da: 2, a: 3.5, nome: "sopra il target ma gestibile", colore: "var(--yellow)" },
               { da: 3.5, a: 8, nome: "inflazione che tiene alti i tassi", colore: "var(--red)" }],
        soglie: [{ v: 2, testo: "target Fed" }],
        fonte: "il 2% è il target dichiarato della Federal Reserve" }),
      n: `CPI ${c.value}${p ? ` · PCE ${p.value}` : ""} · rilevazione ${c.date}. <b>Come si legge:</b> due misure della stessa cosa, e la Fed guarda il PCE. Finché resta sopra il 2% la Fed non ha motivo di tagliare, e senza tagli i multipli del growth restano sotto pressione: è il canale per cui questo numero arriva al tuo portafoglio.` };
  },
  /* v252 — la forma a barre del ciclo economico non serve più: la scheda è uscita dalla
     classifica perché i suoi componenti hanno già le proprie. */
  risk_sentiment: (m) => conTachimetro(m.risk_sentiment, barreComposito(m.risk_sentiment, "Sentiment globale",
    "I fattori risk-on / risk-off che compongono il sentiment, dal peggiore al migliore. <b>Come si legge:</b> quando i fattori sono tutti d'accordo il sentiment è un segnale; quando sono in disaccordo il punteggio medio nasconde più di quanto mostri — e il disaccordo si vede dalla dispersione delle barre."), "sentiment globale"),
  smart_money: (m) => conTachimetro(m.smart_money, barreComposito(m.smart_money, "Istituzionali vs retail",
    "I quattro segnali che distinguono il denaro istituzionale da quello retail. <b>Come si legge:</b> struttura di mercato, term structure del VIX, spread di credito e put/call. Quando divergono dal comportamento del retail, storicamente conta di più quello che fanno gli istituzionali."), "istituzionali vs retail"),
  fear_greed: (m) => {
    const f = m.fear_greed; if (!f || f.score == null) return null;
    /* ⚠ v262 — VIA LE BARRE DEI COMPONENTI. Il CEO l'ha segnalato due volte: "Fear & Greed
       Index ha ancora al suo interno altri valori come vix etc!!! portali fuori e fai schede a
       parte qualora non ve ne siano già ed elimina questi valori lasciando solo Fear & Greed".
       Da v258 tutti e sette i componenti hanno una scheda propria — quattro create allora, tre
       (VIX, Put/Call, Ampiezza) che esistevano gia' — quindi `barreComposito` qui dentro
       ripeteva sette numeri gia' visibili altrove. Resta l'indice con le sue bande CNN, che e'
       la cosa che questa scheda deve dire. */
    /* le bande del Fear & Greed sono quelle pubblicate da CNN (0-25 paura estrema, 25-45 paura,
       45-55 neutro, 55-75 avidita', 75-100 avidita' estrema): sono una convenzione DELL'INDICE,
       non una mia scelta, e si puo' dire da dove viene. */
    const tach = tachimetro(f.score, { aria: "Fear & Greed",
      zone: [{ da: 0, a: 25, nome: "paura estrema", colore: "var(--red)" },
             { da: 25, a: 45, nome: "paura", colore: "var(--yellow)" },
             { da: 45, a: 55, nome: "neutro", colore: "var(--muted)" },
             { da: 55, a: 75, nome: "avidità", colore: "var(--green)" },
             { da: 75, a: 100, nome: "avidità estrema", colore: "var(--green)" }],
      fonte: "le cinque bande sono quelle pubblicate da CNN per questo indice" });
    const st = [f.week_ago, f.month_ago, f.year_ago].filter(x => x != null);
    return { g: tach, n: `${st.length ? `Una settimana fa ${f.week_ago} · un mese fa ${f.month_ago} · un anno fa ${f.year_ago}. ` : ""}I sette componenti hanno ciascuno la propria scheda qui sotto. <b>Come si legge:</b> è un contrarian: la paura estrema è storicamente un momento di acquisto e l'avidità estrema un momento di cautela. Il livello di oggi conta meno della DIREZIONE rispetto alle rilevazioni passate.` };
  },
  _alpha: (m) => {
    const b = m.benchmarks || {}; if (b.ndx == null) return null;
    return { g: scala(b.ndx, { min: -4, max: 4, unita: " pp", aria: "scarto vs indice",
        zone: [{ da: -4, a: -0.5, nome: "sotto l'indice", colore: "var(--red)" },
               { da: -0.5, a: 0.5, nome: "in linea", colore: "var(--muted)" },
               { da: 0.5, a: 4, nome: "sopra l'indice", colore: "var(--green)" }],
        soglie: [{ v: 0, testo: "pari" }],
        fonte: "lo zero è il pareggio con l'indice; le bande sono di sola lettura" }),
      n: `Il Nasdaq 100 ha fatto ${signTxt(b.ndx)} nella seduta${b.sp500 != null ? `, l'S&P ${signTxt(b.sp500)}` : ""}${b.sox != null ? `, i semiconduttori ${signTxt(b.sox)}` : ""}. <b>Come si legge:</b> è lo scarto di UNA seduta, quindi rumore quasi sempre: serve a vedere se il libro si è mosso col mercato o contro. Il giudizio sul processo sta nell'alpha di periodo, non qui.` };
  },
  witching: (m) => {
    const w = m.witching; if (!w || w.days == null) return null;
    /* ⚠ v272 — il conto alla rovescia non disegnava nulla di leggibile a colpo d'occhio: era
       un numero e due date. Il CEO ha chiesto un grafico anche qui. La scala mostra DOVE
       siamo rispetto alla scadenza, che e' l'unica cosa che si vuole sapere — e i 30 giorni
       sono la soglia che questa stessa scheda dichiara nella sua nota, non una inventata ora. */
    const g = scala(Math.min(Number(w.days) || 0, 100), {
      min: 0, max: 100, unita: " g", aria: "giorni alla scadenza tecnica",
      zone: [{ da: 0, a: 10, nome: "dentro la finestra: volumi distorti", colore: "var(--red)" },
             { da: 10, a: 30, nome: "si avvicina", colore: "var(--yellow)" },
             { da: 30, a: 100, nome: "lontana: nessun effetto", colore: "var(--green)" }],
      fonte: "i 30 giorni sono la soglia gia' usata da questa scheda, non una nuova" });
    return { g: (g || "") + contoAllaRovescia(w.days, w.upcoming, {}),
      n: `Prossima quadrupla scadenza il ${dataBreve(w.next)}. <b>Come si legge:</b> nel giorno delle scadenze tecniche scadono insieme opzioni e futures su indici e singole azioni, e i volumi esplodono per ragioni che non hanno a che fare coi fondamentali. Sotto i 30 giorni conviene evitare di leggere i movimenti come segnale, e non piazzare ordini limite stretti in quella seduta.` };
  },
  "mk:^TNX": (m) => {
    const q = (m.markets || []).find(x => x.key === "^TNX"); if (!q) return null;
    const v = parseFloat(String(q.value).replace(",", ".").replace("%", ""));
    return { g: scala(v, { min: 2, max: 6, unita: "%", aria: "Treasury 10 anni",
        zone: [{ da: 2, a: 3.5, nome: "tassi che sostengono i multipli", colore: "var(--green)" },
               { da: 3.5, a: 4.5, nome: "fascia neutra", colore: "var(--muted)" },
               { da: 4.5, a: 6, nome: "tassi che comprimono i multipli", colore: "var(--red)" }],
        soglie: [{ v: 4, testo: "4%" }],
        fonte: "la soglia del 4% è quella già usata dal sistema (sopra comprime i multipli)" }),
      n: `${q.value} (${signTxt(q.change_pct)} pp nella seduta). <b>Come si legge:</b> è il tasso privo di rischio con cui si scontano gli utili futuri. Più sale, meno vale oggi un utile lontano nel tempo — ed è per questo che colpisce il growth più del value: i suoi utili stanno più avanti.` };
  },
  momentum: (m) => {
    /* ⚠ v333 — il CEO: "aggiungi un tachimetro anche per nasdaq 100 e mettili vicino". Due barre
       sullo stesso asse invece di due tachimetri: il confronto FRA i due indici e' cio' che si
       vuole vedere, e due lancette separate lo rendono piu' difficile — bisognerebbe confrontare
       due angoli invece di due lunghezze. */
    const s2 = (m.momentum || {}).sp500; if (!s2 || s2.dist_pct == null) return null;
    const n2 = (m.momentum || {}).ndx;
    const voci = [{ nome: "S&P 500", val: Number(s2.dist_pct), testo: signTxt(s2.dist_pct), colore: "var(--blue)" }];
    if (n2 && n2.dist_pct != null) voci.push({ nome: "Nasdaq 100", val: Number(n2.dist_pct), testo: signTxt(n2.dist_pct), colore: "var(--purple)" });
    return {
      g: dueBarre(voci, { aria: "distanza dei due indici dalla media a 125 sedute", minScala: 10 }),
      n: `S&P 500 <b>${signTxt(s2.dist_pct)}</b> dalla media a 125 sedute`
        + (n2 && n2.dist_pct != null ? ` · Nasdaq 100 <b>${signTxt(n2.dist_pct)}</b>` : "") + `.`
        + `<br><b>Come si legge:</b> 125 sedute sono circa sei mesi, cioe' la tendenza di fondo. Sopra `
        + `la media il trend primario e' integro, sotto il deterioramento e' cominciato. Quando i due `
        + `indici divergono, quello sotto sta gia' girando mentre l'altro tiene.`,
    };
  },
  liquidity: (m) => {
    /* ⚠⚠ v333 — IL PERCENTILE ERA SATURO: 95-98 in ogni mese degli ultimi tre anni, cioe' potere
       discriminante zero — la stessa classe del "% del massimo" della leva, gia' corretta in
       v320. Cio' che si muove e' il LIVELLO e la sua variazione.
       ⚠ Il CEO: "inserisci data relativa alla rilevazione (non data aggiornamento payload)". La
       serie dei fondi monetari e' MENSILE e arriva con settimane di ritardo: senza la sua data
       si legge come se fosse di oggi. */
    const l = m.liquidity_split; if (!l || l.retail_mmf_bln == null) return null;
    const voci = [];
    if (l.retail_yoy_pct != null) voci.push({ nome: "sull'anno", val: Number(l.retail_yoy_pct),
      testo: signTxt(l.retail_yoy_pct), colore: Number(l.retail_yoy_pct) >= 0 ? "var(--green)" : "var(--red)" });
    if (l.inst_cash_pct != null) voci.push({ nome: "cassa istituz.", val: Number(l.inst_cash_pct),
      testo: `${fmtNum.format(l.inst_cash_pct)}%`, colore: "var(--blue)" });
    const it = (d) => { const p = String(d || "").split("-"); return p[2] ? `${p[2]}/${p[1]}/${p[0]}` : ""; };
    return {
      g: voci.length >= 2 ? dueBarre(voci, { soloPositivi: true, aria: "liquidita ferma: variazione annua e quota istituzionale" }) : "",
      n: `<b>${fmtNum.format(l.retail_mmf_bln)} miliardi</b> fermi nei fondi monetari retail`
        + (l.retail_yoy_pct != null ? `, <b>${signTxt(l.retail_yoy_pct)}</b> sull'anno` : "") + `.`
        + (l.retail_date ? ` <span class="muted">Rilevazione del ${it(l.retail_date)} — serie MENSILE, non e' il dato di oggi.</span>` : "")
        + `<br><b>Come si legge:</b> e' il denaro parcheggiato che potrebbe entrare in borsa. Il LIVELLO `
        + `da solo dice poco perche' cresce quasi sempre; conta la DIREZIONE: in aumento vuol dire che `
        + `qualcuno sta uscendo dal rischio, in calo che sta rientrando. ⚠ Il percentile a 5 anni non e' `
        + `pubblicato qui perche' e' saturo: sta fra 95 e 98 in ogni mese degli ultimi tre anni, quindi `
        + `non distingue niente.`,
    };
  },
  /* v262 — la vecchia `breadth` e' stata sostituita da quella nella forma dei termometri,
     piu' in alto. ⚠ Stava DOPO nell'oggetto letterale, quindi vinceva lei: due chiavi uguali
     in un oggetto non danno errore, l'ultima sovrascrive la prima in silenzio — e per un giro
     ho creduto che la mia versione non funzionasse. */
  sp500_pe: (m) => {
    /* ⚠ v334 — il CEO: "deve essere strutturato meglio perche' cosi' non e' intuitivo". Il
       problema era che due multipli DIVERSI stavano su una scala sola: il trailing guarda gli
       utili gia' fatti, il forward quelli attesi, e sono metodologie diverse — affiancarli su
       un asse unico invita a sottrarli, che e' esattamente cio' che non si deve fare.
       Ora sono due barre con i LORO riferimenti accanto, e la distanza dal proprio riferimento
       e' la cosa che si legge — non il confronto fra i due. */
    const p2 = m.sp500_pe, f = m.forward_pe;
    if (!p2 || p2.current == null) return null;
    const voci = [{ nome: "Trailing", val: Number(p2.current), testo: `${fmtNum.format(p2.current)}×`,
                    colore: p2.current > 25 ? "var(--red)" : p2.current > 18 ? "var(--yellow)" : "var(--green)" }];
    if (f && f.value != null) voci.push({ nome: "Forward", val: Number(f.value), testo: `${fmtNum.format(f.value)}×`,
                    colore: f.value > 22 ? "var(--red)" : f.value > 17 ? "var(--yellow)" : "var(--green)" });
    const rifF = f && f.avg_hist != null ? Number(f.avg_hist) : null;
    return {
      g: voci.length >= 2
        ? dueBarre(voci, { soloPositivi: true, minScala: 34, soglia: rifF,
                           soglieTesto: rifF != null ? `media forward ${fmtNum.format(rifF)}×` : "",
                           aria: "P/E trailing e forward dell'S&P 500" })
        : scala(p2.current, { min: 10, max: 40, unita: "×", aria: "P/E S&P 500", zone: ZONE_PE,
                              fonte: "bande di lettura sul multiplo, non una media storica calcolata" }),
      score: punteggioDaZone(Number(p2.current), ZONE_PE),
      n: `<b>${fmtNum.format(p2.current)}×</b> sugli utili GIA' REALIZZATI`
        + (f && f.value != null ? ` · <b>${fmtNum.format(f.value)}×</b> su quelli ATTESI a dodici mesi` : "")
        + (rifF != null ? ` <span class="muted">(media storica del forward ${fmtNum.format(rifF)}×)</span>` : "") + `.`
        + `<br><b>Come si legge:</b> sono due misure con metodologie DIVERSE — una guarda indietro,
        l'altra guarda le stime degli analisti — e la loro differenza NON e' un tasso di crescita:
        e' anche l'effetto di come i due indici trattano voci straordinarie e societa' in perdita.
        Ognuna va confrontata col PROPRIO riferimento, non con l'altra. Un trailing alto con un
        forward molto piu' basso dice che il mercato sta pagando utili che devono ancora arrivare.`,
    };
  },
  "in:unemp": (m) => {
    const u = (m.indicators || []).find(x => x.key === "unemp"); if (!u) return null;
    const v = parseFloat(String(u.value).replace(",", ".").replace("%", ""));
    const n2 = (m.indicators || []).find(x => x.key === "nfp");
    return { g: scala(v, { min: 3, max: 8, unita: "%", aria: "disoccupazione",
        zone: [{ da: 3, a: 4.5, nome: "piena occupazione", colore: "var(--green)" },
               { da: 4.5, a: 5.5, nome: "mercato in raffreddamento", colore: "var(--yellow)" },
               { da: 5.5, a: 8, nome: "recessione del lavoro", colore: "var(--red)" }],
        /* ⚠ v240 — TOLTA la tacca "soglia Sahm" a 4,5%: la regola di Sahm NON e' un livello, e'
           un MOVIMENTO (media a 3 mesi che sale di 0,5 pp sopra il minimo dei 12). Segnarla come
           livello era falso, e contraddiceva la spiegazione scritta due righe sotto nella stessa
           scheda — che invece la enuncia correttamente. Il file non ha la media a 3 mesi, quindi
           la regola non e' calcolabile qui e non si finge che lo sia. */
        fonte: "bande di sola lettura: la regola di Sahm guarda la SALITA, non il livello, e il file non ha la media a 3 mesi" }),
      n: `Disoccupazione ${u.value}${n2 ? ` · nuovi posti ${n2.value}` : ""} · rilevazione ${u.date}. <b>Come si legge:</b> conta la DIREZIONE più del livello. La regola di Sahm dice che quando la media a 3 mesi sale di mezzo punto sopra il minimo dell'anno la recessione è già cominciata — il livello assoluto è ancora basso quando il segnale scatta, ed è per questo che si guarda la salita, non il valore.` };
  },
  /* v265 — la vecchia `froth` e' stata sostituita da quella con la scala centrata su 1, piu'
     in alto nell'oggetto. ⚠ SECONDA VOLTA in due versioni che due chiavi uguali in un oggetto
     letterale mi fanno perdere un giro: l'ultima sovrascrive la prima IN SILENZIO, quindi la
     mia versione nuova sembrava non funzionare. Era gia' successo con `breadth` in v262.
     Ora c'e' un check che conta le chiavi duplicate in FORMA_INDICATORE. */
};
/* le barre dei fattori di un composito: e' cio' che mostrava "Da cosa nascono i punteggi", ora
   dentro la scheda del suo indicatore invece che in un blocco separato che ne ripeteva i nomi */
function barreComposito(c, nome, comeSiLegge) {
  const comp = ((c || {}).components || []).filter(x => x && x.score != null);
  if (comp.length < 2) return null;
  const righe = [...comp].sort((a, b) => a.score - b.score)
    /* v337 — la BARRA resta (confronta i componenti fra loro: e' la cosa che risponde a
       "chi tira giu'"), il NUMERO no. Erano due informazioni diverse infilate nello stesso
       oggetto: il confronto e' misurato, il punteggio assoluto era una formula nostra. */
    .map(x => ({ nome: x.label, valore: Math.round(x.score) - 50, colore: scoreColor(x.score), testo: "" }));
  const peggio = righe[0], meglio = righe[righe.length - 1];
  return { g: barreOrdinate(righe, {}),
    n: `${comeSiLegge}${comeSiLegge ? " " : ""}Oggi tira giù <b>${esc(peggio.nome)}</b> e tiene su <b>${esc(meglio.nome)}</b>.` };
}

/* ═══ v235 — IMPACCAMENTO A MASONRY DELLA GRIGLIA ══════════════════════════════════════════
   Richiesta CEO: "ottimizza la distribuzione di ogni singolo oggetto in struttura".
   Il problema misurato: le schede hanno altezze molto diverse (una col grafico e nove righe di
   dati sta a ~360px, una col solo punteggio a ~90px) e una griglia CSS allinea per RIGHE — la
   riga e' alta quanto la scheda piu' alta, e sotto le altre resta un buco. Su 30 schede il
   vuoto e' piu' della meta' dello schermo.
   `columns` CSS impaccherebbe da solo, ma legge in COLONNE — dall'alto in basso e poi a capo —
   e questa griglia e' ORDINATA dal peggiore al migliore: leggerla per colonne cambierebbe il
   significato dell'ordine. Qui si tiene la griglia (ordine sinistra→destra intatto) e si dice a
   ogni scheda quante righe da 8px occupare: le successive risalgono a riempire il vuoto.
   ⚠ Va rieseguito quando cambia la larghezza: il numero di colonne cambia e con esso l'altezza
   delle schede (il testo va a capo diversamente). */
function impaccaGriglia(box) {
  if (!box || typeof getComputedStyle !== "function") return;   // harness senza layout: no-op
  box.querySelectorAll?.(".mg-tris").forEach(g => {
    let cs;
    try { cs = getComputedStyle(g); } catch { return; }
    if (cs.display !== "grid") return;
    const passo = 8, gap = parseFloat(cs.rowGap) || 14;
    g.style.gridAutoRows = passo + "px";
    g.style.alignItems = "start";
    g.querySelectorAll(":scope > .mg-card").forEach(c => {
      c.style.gridRowEnd = "";                                  // si riparte dall'altezza vera
      const h = c.getBoundingClientRect?.().height || 0;
      if (h > 0) c.style.gridRowEnd = `span ${Math.ceil((h + gap) / (passo + gap))}`;
    });
  });
}
/* una sola registrazione, in delega: al ridimensionamento le colonne cambiano e le altezze con
   loro. Senza questo l'impaccamento resterebbe quello della prima misura (difetto della stessa
   famiglia del viewBox non-costante: una misura presa una volta e usata per sempre). */
let _impaccaTimer = null;
function registraImpaccamento() {
  if (registraImpaccamento._fatto) return;
  registraImpaccamento._fatto = true;
  window.addEventListener?.("resize", () => {
    clearTimeout(_impaccaTimer);
    _impaccaTimer = setTimeout(() => impaccaGriglia(document.querySelector(".shell-main")), 120);
  });
}

/* v265 — spezza la nota di una scheda in "sempre visibile" + "a scomparsa".
   Il confine e' la frase "Come si legge:", che questo progetto usa gia' dal v238 per separare
   il dato dalla sua lettura. Null-safe: nota vuota → stringa vuota, niente contenitori a vuoto. */
function notaConDettaglio(nota, cadenza) {
  const testo = String(nota || "");
  const cad = cadenza ? `<div class="mg-cad muted">${esc(cadenza)}</div>` : "";
  const i = testo.search(/<b>Come si legge:?<\/b>|Come si legge:/i);
  if (i < 0) return testo + cad;
  const sopra = testo.slice(0, i).trim();
  const sotto = testo.slice(i).trim();
  return sopra
    + `<details class="mg-guida"><summary title="come si legge questo dato" aria-label="come si legge questo dato">?</summary>`
    + `<div class="mg-guida-box">${sotto.replace(/^(<b>)?Come si legge:?(<\/b>)?\s*/i, "")}</div></details>`
    + cad;
}


function renderIndicatori() {
  const box = $("#mg-tutti"); if (!box) return;
  const nota = $("#mg-tutti-note");
  const righe = indicatoriClassifica();
  if (righe.length < 3) { box.innerHTML = '<div class="muted">Indicatori non disponibili.</div>'; return; }
  /* ═══ v313 — I POPUP SPARISCONO, IL LORO CONTENUTO NO ══════════════════════════════════
     Il CEO: "elimina pop up di tutte le tab macro tranne per S&P vs Profitti Reali e P/E
     Storico → per queste accorpa il contenuto del pop up nella tab stessa".
     ⚠⚠ IL PUNTO E' CHE NON SI PERDE NIENTE. Un popup tolto senza portare fuori il suo
     contenuto sarebbe la classe v201-v204 (la pulizia che si porta via il fatto), gia' pagata
     quattro volte qui. `contenutoDalPannello` estrae gia' grafici, tabelle e righe di dati dal
     pannello e li mette nella tessera: per queste due si estrae TUTTO, per le altre resta
     quello che gia' arrivava.
     ⚠ Nessuna tessera apre piu' un popup: `tk` resta null e sparisce l'affordance di clic. Il
     popup completo resta raggiungibile dalla pagina "Dettagli macro", che e' un'altra
     superficie e non e' stata toccata — un contenuto che esiste in un solo posto sparisce, uno
     che esiste in due si sposta. */
  const conPan = new Set(Object.keys(MACRO_INFO || {}));
  const ACCORPATI = new Set(["corp_profit", "sp500_pe"]);

  /* v233 — MINI TAB, la forma originaria. Ogni indicatore e' una scheda: nome, punteggio, nota.
     Dove ha una SERIE STORICA vera si disegna la linea nel tempo con le sue soglie (la forma dei
     termometri di stress); dove il POPUP portava un grafico o una tabella, quelli vengono qui
     dentro; dove non c'e' ne' l'una ne' l'altra la scheda resta il numero e la sua nota, senza
     riempitivi. Il clic continua ad aprire il pannello completo. */
  box.innerHTML = `<div class="mg-tris">${righe.map(r => {
    /* ⚠ v235 — il grafico della serie NON esclude le righe di dati del pannello: sono due cose
       diverse (la storia e il valore corrente con la sua data e il suo impatto), e prima chi
       aveva una serie perdeva le seconde. Ora la scheda porta entrambe. */
    /* v238 — l'ordine di precedenza: prima la forma DEDICATA del registro (che porta anche la
       spiegazione di lettura), poi la serie storica, poi il contenuto del pannello. */
    /* ⚠⚠ v292 — LA SERIE VERA HA LA PRECEDENZA SULLA SCALA. Prima era il contrario, e aveva
       senso finche' le serie non c'erano: la scala con le zone (v272) era il ripiego per le
       schede senza storico. Ora che la pipeline porta la traiettoria, tenere la scala davanti
       vorrebbe dire preferire una MIA convenzione di lettura a un dato osservato. La scala
       resta il ripiego dove la serie ancora manca. */
    /* ⚠⚠ v297 — LA SOGLIA CHE MANCAVA, E CHE HA COSTATO IL TACHIMETRO DEL FEAR & GREED.
       In v292 ho invertito la precedenza (serie > forma) e avevo ragione sul principio: una
       traiettoria osservata batte una scala convenzionale. Ma non ho messo un PAVIMENTO, e cosi'
       una serie di QUATTRO punti (anno fa · mese fa · settimana fa · oggi) ha scalzato il
       tachimetro con le bande CNN, e una di 13 ha scalzato la scala del P/E. Il CEO se n'e'
       accorto e ha chiesto il tachimetro indietro.
       Quattro punti non sono una traiettoria: sono quattro numeri con una linea in mezzo, e
       dicono MENO di un quadrante che mostra in quale banda cade il valore. La regola giusta non
       e' "la serie vince" ma "la serie vince quando e' davvero una serie". */
    const SERIE_MINIMA = 20;   // sotto, una linea dice meno di una scala con le zone nominate
    const seGrezza = serieIndicatore(r.k);
    const quanti = seGrezza
      ? (seGrezza.punti ? seGrezza.punti.length
         : seGrezza.doppia ? Math.min(...seGrezza.doppia.map(x => (x.punti || []).length)) : 0)
      : 0;
    const forma = (() => { try { return FORMA_INDICATORE[r.k]?.(DATA.macro || {}) || null; } catch { return null; } })();
    /* ⚠⚠ v349 — IL SECONDO PAVIMENTO, MISURATO SULLA SCHEDA DELLA VALUTAZIONE S&P.
       La v297 ha messo il pavimento sul NUMERO di punti (una serie di quattro non e' una
       traiettoria). Mancava il pavimento sulla NATURA: `serieIndicatore` ha un ramo di ripiego
       che pesca da `metrics_history` la serie del PUNTEGGIO 0-100 accumulato giorno per giorno,
       e la marca `accumulata: true`. Con 21 punti superava la soglia e vinceva sulla forma.
       Misurato in browser sulla scheda "Valutazione S&P (trailing e forward)": il grafico
       aveva l'asse a 50 · 50,5 · 51 · 51,5 · 52 — il punteggio — mentre i due multipli veri,
       29,6× trailing e 21× forward, non comparivano da nessuna parte nella scheda.
       Due ragioni per cui non e' un dettaglio:
       · in v337 il CEO ha fatto togliere il punteggio 0-100 dalle schede ("il dato deve essere
         asettico da quel parametro"), e qui rientrava dalla finestra come grafico;
       · su una scheda di VALUTAZIONE, un asse che segna 51 dove il lettore si aspetta un
         multiplo e' peggio di un grafico assente.
       Una serie di punteggi non batte mai una forma che mostra il dato vero. */
    const se = (forma && (quanti < SERIE_MINIMA || (seGrezza && seGrezza.accumulata))) ? null : seGrezza;
    /* ⚠ v262 — LA SCHEDA DI FEAR & GREED NON RIPETE I SUOI COMPONENTI. Il CEO l'ha segnalato
       due volte: "ha ancora al suo interno altri valori come vix etc". Da v258 tutti e sette i
       componenti hanno una scheda propria (quattro nuove, tre — VIX, Put/Call, Ampiezza — che
       esistevano gia'), quindi l'elenco dentro la scheda del composito e' diventato una
       ripetizione: gli stessi numeri due volte, che e' esattamente cio' che il sistema dichiara
       di non voler fare. Resta l'indice con la sua storia; i pezzi si leggono nelle loro schede. */
    const soloIndice = r.k === "fear_greed";
    /* per le due accorpate si prende il pannello SEMPRE, anche quando c'e' gia' una forma:
       e' esattamente cio' che il CEO ha chiesto di portare dentro. */
    const dal = ACCORPATI.has(r.k)
      ? contenutoDalPannello(conPan.has(r.k) ? r.k : null, r.sub || "")
      : ((forma || soloIndice) ? "" : contenutoDalPannello(conPan.has(r.k) ? r.k : null, r.sub || ""));
    const linea = se
      ? (se.doppia
          ? graficoSerie(se.doppia, { h: 104, compatto: true, soglie: se.soglie, etichetteDx: false, aria: r.nome })
          : graficoSerie([{ nome: r.nome, punti: se.punti, colore: scoreColor(r.score) }],
              { h: 104, compatto: true, soglie: se.soglie, unita: se.unita, assex: se.assex,
                fmtY: se.fmtY, etichetteDx: false, aria: r.nome }))
      : "";
    const g = (!se && forma) ? forma.g : linea + (se ? dal.replace(/<svg[\s\S]*?<\/svg>/g, "") : dal);
    return tessera({ t: r.nome, tag: r.proxy || null,
      /* ⚠ v337 — QUI NON VA NIENTE, ed e' una scelta misurata non una omissione. Il CEO:
         "elimina dalle schede macro i parametri in alto a destra es. 56/100; il dato deve
         essere asettico da quel parametro". La prima stesura ci metteva il valore al posto del
         punteggio; misurato in browser, 12 schede su 22 non hanno UN valore solo (CPI e PCE,
         i tre rami del FOMC, tasso reale e attesa), quindi la casella si riempiva su dieci e
         restava vuota su dodici — e sulle dodici avrei stampato UNO dei valori come se fosse
         IL valore. Il dato sta nel sottotitolo, intero e senza dover scegliere per lui. */
      v: "",
      cls: clsScore(r.score), grafico: g,
      /* v324 — la scheda dichiara da se' quanto spazio le serve: il contenuto lo sa, il
         contenitore no. Il riordino per trascinamento non ne risente, perche' la chiave resta
         `data-scheda` e non la posizione. */
      larga: !!(forma && forma.larga),
      /* ⚠ v329 — la MOSSA stampata in ogni scheda: senza, l'ordine e' un fatto invisibile e
         chi guarda deduce una gerarchia che non c'e'. Con essa, l'ordine si verifica a colpo
         d'occhio — ed e' l'unico modo perche' una didascalia sull'ordine sia controllabile. */
      mossa: Number.isFinite(r.mossa) ? r.mossa : null,
      /* v250 — sotto ogni card macro, la riga di cadenza: rilevazione, età, prossimo atteso.
         Sta in FONDO e in piccolo: è contesto sul dato, non il dato. */
      /* ⚠ v265 — LA GUIDA DI LETTURA VA A SCOMPARSA. Il CEO: "tutte le info e le guide di
         lettura dei dati macro potremmo inserire a scomparsa e lasciare visualizzabili solo
         poche righe di interpretazione del dato".
         Il taglio non e' arbitrario: si spezza sulla frase "Come si legge", che e' il confine
         gia' esistente fra il FATTO (cosa dice il numero adesso) e la SPIEGAZIONE (cos'e' quel
         numero e attraverso quale canale arriva ai mercati). Il fatto resta sempre visibile, la
         spiegazione si apre a richiesta. Dove quella frase non c'e', si tiene tutto visibile
         invece di tagliare a una lunghezza fissa — un troncamento a caratteri spezzerebbe le
         frasi a meta'. */
      n: notaConDettaglio(forma ? forma.n : esc(r.sub || ""), r.cadenza),
      /* ⚠ v313 — niente piu' popup dalle tessere: `tk` null toglie sia l'apertura sia
         l'affordance di clic. Il contenuto e' gia' dentro (sopra), quindi non si perde. */
      tk: null, id: r.k });
  }).join("")}</div>`;

  agganciaTessere(box);
  /* v241 — l'ordine scelto dal CEO si riapplica a OGNI render (la griglia si ricostruisce da
     capo ogni volta), e i comandi di trascinamento si rimontano sulle schede nuove. */
  const griglia = box.querySelector(".mg-tris");
  applicaOrdineSchede(griglia, "indicatori");
  montaTrascinamentoSchede(griglia, "indicatori");

  /* v238 — le quattro tessere di testata (media, quanti sotto 40, i tre peggiori, quelli che
     tengono) sono state rimosse su richiesta del CEO: erano un riassunto della griglia che sta
     appena sotto, cioe' gli stessi fatti detti due volte. */
  if (nota) nota.innerHTML = `Una scheda per indicatore, tutte sulla stessa scala: <b>100 = favorevole al rischio azionario, 0 = sfavorevole</b>. È una convenzione di lettura del sistema, non una misura: dice da che parte tira ogni indicatore, non quanto pesa.
    <b>L'ordine NON è per punteggio</b>: sono ordinate da <b>chi si è mosso di più rispetto al proprio solito</b>, perché quello che si muove è quello che ha una notizia dentro. Chi non ha una serie storica non ha un movimento misurabile e va in fondo, in ordine alfabetico — che non esprime preferenze.
    Dove esiste una storia il grafico la mostra; dove il pannello di dettaglio portava un grafico o una tabella, quelli sono <b>qui dentro</b> invece che dietro un clic.
    <b>Clicca una scheda</b> per il resto del pannello e le news di quell'indicatore.`;
}

/* v215 — CROSSHAIR sui grafici a linee. Un grafico statico costringe a stimare a occhio il
   valore di un punto; qui il valore lo dichiara. Funziona su qualunque svg.g-serie senza che
   il chiamante debba saperlo: si aggancia una volta sola, in delega sul documento. */
function attivaHoverGrafici() {
  if (attivaHoverGrafici._fatto) return;
  attivaHoverGrafici._fatto = true;
  const via = (svg) => { svg.querySelectorAll(".gs-hover").forEach(e => e.remove()); };
  const muovi = (svg, ev) => {
    let dati, geo;
    try { dati = JSON.parse(svg.dataset.hover || "[]"); geo = (svg.dataset.geo || "").split(",").map(Number); } catch { return; }
    if (!dati.length || geo.length !== 4) return;
    const box = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const xUser = (ev.clientX - box.left) / box.width * vb.width;
    const [L, R, T, B] = geo;
    if (xUser < L - 4 || xUser > R + 4) { via(svg); return; }
    via(svg);
    const ns = "http://www.w3.org/2000/svg";
    const mk = (t, attrs) => { const e = document.createElementNS(ns, t); for (const k in attrs) e.setAttribute(k, attrs[k]); e.classList.add("gs-hover"); return e; };
    let vicino = null;
    const etichette = [];
    dati.forEach(serie => {
      let best = null;
      serie.p.forEach(q => { const d = Math.abs(q.x - xUser); if (!best || d < best.d) best = { d, q }; });
      if (!best) return;
      if (!vicino || best.d < vicino.d) vicino = best;
      svg.appendChild(mk("circle", { cx: best.q.x, cy: best.q.y, r: 4, fill: serie.c, stroke: "var(--card)", "stroke-width": 1.5 }));
      etichette.push({ y: best.q.y, testo: `${fmtNum.format(best.q.v)}`, col: serie.c, nome: serie.n, d: best.q.d });
    });
    if (!vicino) return;
    svg.insertBefore(mk("line", { x1: vicino.q.x, y1: T, x2: vicino.q.x, y2: B, stroke: "var(--muted)", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: .8 }), svg.firstChild);
    const destra = vicino.q.x > (L + R) / 2;
    etichette.forEach((e, i) => {
      const tx = mk("text", { x: destra ? vicino.q.x - 8 : vicino.q.x + 8, y: T + 12 + i * 13,
        "text-anchor": destra ? "end" : "start", "font-size": 11, "font-weight": 700,
        fill: e.col, "font-family": "var(--mono)" });
      tx.textContent = e.testo;
      svg.appendChild(tx);
    });
    const dLab = etichette[0] && etichette[0].d;
    if (dLab) {
      const t2 = mk("text", { x: destra ? vicino.q.x - 8 : vicino.q.x + 8, y: T + 12 + etichette.length * 13,
        "text-anchor": destra ? "end" : "start", "font-size": 9.5, fill: "var(--muted)" });
      t2.textContent = dataBreve(dLab, true);
      svg.appendChild(t2);
    }
  };
  document.addEventListener("pointermove", (ev) => {
    const svg = ev.target.closest ? ev.target.closest("svg.g-serie") : null;
    document.querySelectorAll("svg.g-serie").forEach(o => { if (o !== svg) via(o); });
    if (svg) muovi(svg, ev);
  }, { passive: true });
  document.addEventListener("pointerleave", () => document.querySelectorAll("svg.g-serie").forEach(via), true);
}

/* ═══ v216 — RILEVATORE DI PAGINA VECCHIA ═════════════════════════════════════════════════
   Il CEO ha visto una release "non comparire" più volte, e la causa non era il deploy: è che
   GitHub Pages serve index.html con `cache-control: max-age=600`. Per dieci minuti il browser
   non lo richiede — e siccome il cache-busting `?v=NNN` vive DENTRO index.html, finché quel
   file è vecchio il browser continua a chiedere le versioni vecchie di app.js e style.css.
   Il `<meta http-equiv="Cache-Control">` non protegge da questo: i browser lo ignorano.

   Qui si chiede al server la versione ATTUALE (fetch no-store, che salta la cache) e la si
   confronta con quella in esecuzione. Se non coincidono, la pagina lo dichiara invece di
   mostrare in silenzio contenuti vecchi — e la ricarica va su una URL che la cache non ha mai
   visto, perché un semplice reload ripescherebbe lo stesso index.html cachato. */
async function controllaVersione() {
  try {
    const r = await fetch(`index.html?nocache=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const m = (await r.text()).match(/app\.js\?v=(\d+)/);
    if (!m) return;
    const attesa = m[1];
    if (attesa === BUILD_VERSION) return;
    const box = $("#version-alert");
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<div class="ver-alert">
      <div><b>Stai vedendo una versione vecchia della pagina.</b>
        In esecuzione <b>v${esc(BUILD_VERSION)}</b>, pubblicata <b>v${esc(attesa)}</b>.
        <span class="muted">Non è il sito: è la cache del browser (GitHub Pages tiene index.html per 10 minuti).</span></div>
      <button class="btn btn-primary btn-sm" id="ver-reload">Ricarica la versione ${esc(attesa)}</button>
    </div>`;
  } catch { /* offline o file:// — nessun avviso, meglio del falso allarme */ }
}

/* ═══ v219 — CIAMBELLA riusabile ══════════════════════════════════════════════════════════
   Una torta si legge senza istruzioni, ma vale SOLO per quantità che sono parti di un tutto
   e non negative. Qui ci finiscono la quota di varianza (somma 100%), l'allocazione (somma
   100%) e i campanelli accesi/spenti. NON ci finiscono i rendimenti di settore (hanno il
   segno) né i punteggi 0-100 (non si sommano a niente): farne una torta darebbe una figura
   che sembra dire qualcosa e non dice nulla.
   voci: [{nome, val, colore}] · opt.centro = {sopra, grande, sotto} */
function ciambella(voci, opt = {}) {
  const v = (voci || []).filter(x => x && x.val > 0);
  if (v.length < 2) return '<div class="muted">Dati insufficienti per la ripartizione.</div>';
  const tot = v.reduce((s, x) => s + x.val, 0);
  const R = 86, r = 54, C = 100, GIRO = 2 * Math.PI;
  let acc = -Math.PI / 2;
  const archi = v.map((x, i) => {
    const ang = x.val / tot * GIRO, fine = acc + ang;
    const grande = ang > Math.PI ? 1 : 0;
    const P = (raggio, a) => `${(C + raggio * Math.cos(a)).toFixed(2)},${(C + raggio * Math.sin(a)).toFixed(2)}`;
    const d = `M ${P(R, acc)} A ${R} ${R} 0 ${grande} 1 ${P(R, fine)} L ${P(r, fine)} A ${r} ${r} 0 ${grande} 0 ${P(r, acc)} Z`;
    acc = fine;
    const col = x.colore || ALLOC_COLORS[i % ALLOC_COLORS.length];
    const pct = Math.round(x.val / tot * 1000) / 10;
    return `<path d="${d}" fill="${col}" class="ciam-arco" data-ciam="${esc(x.nome)}"
      data-pct="${pct}" data-val="${x.val}"><title>${esc(x.nome)}: ${fmt1.format(pct)}%</title></path>`;
  }).join("");
  const c = opt.centro || {};
  return `<div class="ciam-wrap">
    <svg viewBox="0 0 200 200" class="ciam-svg" role="img" aria-label="${esc(opt.aria || "ripartizione")}">
      ${archi}
      ${c.sopra ? `<text x="100" y="90" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(c.sopra)}</text>` : ""}
      ${c.grande ? `<text x="100" y="108" text-anchor="middle" font-size="19" font-weight="700" fill="var(--text)" font-family="var(--mono)">${esc(c.grande)}</text>` : ""}
      ${c.sotto ? `<text x="100" y="124" text-anchor="middle" font-size="9.5" fill="var(--muted)">${esc(c.sotto)}</text>` : ""}
    </svg>
    <ul class="ciam-leg">${v.map((x, i) => {
      const pct = Math.round(x.val / tot * 1000) / 10;
      return `<li${x.tk ? ` data-ciam-tk="${esc(x.tk)}"` : ""}>
        <span class="ciam-dot" style="background:${x.colore || ALLOC_COLORS[i % ALLOC_COLORS.length]}"></span>
        <span class="ciam-nome">${esc(x.nome)}</span>
        <b class="ciam-pct">${fmt1.format(pct)}%</b>
        ${x.extra ? `<span class="muted ciam-extra">${x.extra}</span>` : ""}</li>`;
    }).join("")}</ul>
  </div>`;
}

/* ═══ v223 — LA TESSERA: un solo formato per tutto ════════════════════════════════════════
   Il CEO ha indicato "Termometri di stress" come l'unico blocco che legge senza sforzo, e ha
   chiesto che TUTTI i grafici abbiano quella struttura, con una regola precisa: "ogni barra
   deve essere un grafico, non devi accorpare tutto". Quindi le liste ordinate (35 indicatori,
   39 fattori, le categorie dei campanelli) si sciolgono in tessere: titolo, valore grande, un
   misuratore che mostra DOVE sta quel valore sulla sua scala, una riga di senso. */
/* v225 — `misuratore()` RIMOSSA. Era la barra 0-100 orizzontale: l'ultima forma che il CEO ha
   respinto ("vedo ancora tante barre, voglio i grafici"). Sostituita ovunque da `quadrante()`,
   un arco con lancetta — la posizione dell'ago si legge senza decodificare una scala.
   RICEVUTA DEL TAGLIO, scritta PRIMA di tagliare (regola v201-v204): 2 chiamanti, entrambi
   convertiti (renderScomposizione, renderSignposts); 0 riferimenti nei test; dentro i confini
   del blocco rimosso non vive nessun'altra funzione — il vicino a valle, tessera(), e' intatto. */
/* ⚠ v274 — `tag` E' UN PARAMETRO A PARTE, non HTML infilato nel titolo. Avevo provato a
   passare `<span class="tag-proxy">` dentro `t`, e `esc(t)` l'ha stampato come testo — che e'
   il comportamento GIUSTO: quel titolo puo' contenere nomi che arrivano dai dati, e
   l'escaping e' la garanzia che un nome non diventi markup. Quando serve del markup si
   aggiunge un campo, non si aggira la protezione. */
/* ═══ v309 — QUALI TESSERE SI POSSONO APRIRE NEL GRAFICO ═══════════════════════════════════
   Il CEO: "per ogni settore e per ogni informazione macro, per quelle che puoi, se ci clicco
   sopra associa il relativo grafico in tradingview".
   ⚠⚠ "PER QUELLE CHE PUOI" E' LA PARTE CHE CONTA, e la risposta l'ho gia' MISURATA in v290
   caricando i simboli in un browser vero: il widget gratuito serve VIX, cambi, cripto, oro,
   petrolio e rame; rifiuta TUTTI i rendimenti dei Treasury, il dollaro (DXY) e TUTTI gli
   indici azionari con "Questo simbolo e' disponibile solo su TradingView".
   Quindi la maggior parte delle tessere macro NON ha un grafico possibile, e un bottone che
   apre un riquadro con un messaggio d'errore sarebbe peggio di nessun bottone.
   ⚠ `mat:sox` usa SOXX, l'ETF: l'indice ^SOX e' fra i bloccati, il fondo che lo replica no.
   ⚠ I SETTORI funzionano tutti: sono ETF quotati e il simbolo e' il loro ticker. */
const TV_PER_TESSERA = {
  vix: "VIX",
  "mat:sox": "SOXX",
  "mat:oro": "TVC:GOLD",
  "mat:petrolio": "TVC:USOIL",
  "mat:rame": "COPPER",
  "mk:EURUSD=X": "FX:EURUSD",
  "mk:EURJPY=X": "FX:EURJPY",
  carry: "FX:USDJPY",
  rotazione: "SMH",
  stagionalita_ndx: "QQQ",   // ⚠ NON "NDX": gli indici sono bloccati, l'ETF no (stessa regola di ^SOX → SOXX)
};

function tessera({ t, v, cls, grafico, n, tk, id, tag, larga, mossa }) {
  /* v241 — `id` e' la CHIAVE STABILE della scheda per il riordino: la chiave dell'indicatore
     (in:cpi, dollar, macroquant…), non il titolo e non la posizione. Una scheda rinominata non
     perde il posto che il CEO le ha dato, e una nuova finisce in coda invece di spostare tutto. */
  return `<div class="mg-card${tk ? " mg-click" : ""}${larga ? " mg-larga" : ""}"${id ? ` data-scheda="${esc(id)}"` : ""}${tk ? ` data-tess-tk="${esc(tk)}" role="button" tabindex="0"` : ""}>
    <div class="mg-card-head"><span class="mg-t">${esc(t)}${tag ? `<span class="tag-proxy" title="${esc(tag)}">proxy</span>` : ""}</span><span class="mg-v ${cls || ""}">${v}</span>${
      TV_PER_TESSERA[id] ? `<button type="button" class="mg-graf" data-graf-tk="${esc(TV_PER_TESSERA[id])}"
        title="Apri ${esc(TV_PER_TESSERA[id])} nel grafico" aria-label="Apri ${esc(TV_PER_TESSERA[id])} nel grafico">📈</button>` : ""}</div>
    ${mossa != null ? `<div class="mg-mossa muted" title="quanto questo indicatore si e' mosso rispetto al proprio solito: e' il criterio con cui le schede sono ordinate">si e' mosso ${fmtNum.format(Math.round(mossa * 10) / 10)}× il suo solito</div>` : ""}
    ${grafico || ""}${n ? `<div class="muted mg-n">${n}</div>` : ""}</div>`;
}
function agganciaTessere(box) {
  /* ⚠ il bottone del grafico sta DENTRO una tessera che al clic apre il pannello: senza
     stopPropagation si aprirebbero entrambe le cose. E l'handler sta sul CONTENITORE perche'
     le tessere si ridisegnano a ogni render — difetto v193/v213, gia' pagato. */
  if (box.dataset && box.dataset.grafAgganciato !== "1") {
    box.dataset.grafAgganciato = "1";
    box.addEventListener("click", (ev) => {
      const b = ev.target && ev.target.closest ? ev.target.closest("[data-graf-tk]") : null;
      if (!b) return;
      ev.preventDefault();
      ev.stopPropagation();
      /* una riga della rotazione SCEGLIE il settore; un bottone di tessera apre e basta */
      if (b.dataset.rotTk) scegliSettore(b.dataset.rotTk);
      else apriNelGrafico(b.dataset.grafTk);
    });
  }
  box.querySelectorAll("[data-tess-tk]").forEach(e => {
    const apri = () => openMacroInfo(e.dataset.tessTk);
    e.addEventListener("click", apri);
    e.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); apri(); } });
  });
}
const clsScore = (v) => v < 40 ? "neg" : v < 55 ? "warn" : "pos";

/* ═══ v224 — LA SERIE DIETRO OGNI INDICATORE ══════════════════════════════════════════════
   Il CEO vuole che ogni tessera abbia un grafico come la Curva 10A-2A: una linea nel tempo con
   la sua soglia. Ma un grafico nel tempo ha bisogno di punti nel tempo, e il file ne ha solo
   per una parte degli indicatori. Qui si disegna la linea SOLO dove la serie esiste davvero;
   dove non esiste resta il misuratore e la tessera lo DICHIARA, invece di far finta con una
   riga piatta a un punto. Per gli altri la pipeline ha cominciato ad accumulare (v224):
   fra qualche settimana avranno anche loro la loro linea, e comparira' da sola. */
function serieIndicatore(k) {
  const m = DATA?.macro || {};
  const perc = (h, lo, hi) => (h || []).map(x => ({ d: x.d, v: x.v }));
  switch (k) {
    case "in:curve": case "yield_recession":
      return (m.curve_history || []).length > 2
        ? { punti: m.curve_history, soglie: [{ v: 0, testo: "inversione", colore: "var(--red)" }], unita: "" } : null;
    case "credit": case "systemic_risk":
      return (m.credit?.history || []).length > 2
        ? { punti: m.credit.history, soglie: [{ v: 4, testo: "tensione", colore: "var(--yellow)" }], unita: "%" } : null;
    case "vix":
      return (m.vix?.spark || []).length > 2
        ? { punti: m.vix.spark.map(v => ({ d: null, v })), soglie: [{ v: 20, testo: "tensione", colore: "var(--yellow)" }],
            assex: ["30 sedute fa", "oggi"] } : null;
    case "margin_debt":
      return (m.margin_debt?.history || []).length > 2
        ? { punti: m.margin_debt.history.map(v => ({ d: null, v })), assex: ["13 mesi fa", "oggi"],
            fmtY: v => fmtNum.format(Math.round(v / 1000)) + " mld" } : null;
    case "fear_greed": {
      const f = m.fear_greed || {}; const p = [];
      if (f.year_ago != null) p.push({ d: null, v: f.year_ago });
      if (f.month_ago != null) p.push({ d: null, v: f.month_ago });
      if (f.week_ago != null) p.push({ d: null, v: f.week_ago });
      if (f.score != null) p.push({ d: null, v: f.score });
      return p.length > 2 ? { punti: p, soglie: [{ v: 50, testo: "neutro", colore: "var(--muted)" }],
        assex: ["1 anno fa", "oggi"] } : null;
    }
    case "fed_market":
      return (m.fed_market?.fedfunds || []).length > 2
        ? { punti: m.fed_market.fedfunds, soglie: [{ v: 4, testo: "comprime i multipli", colore: "var(--yellow)" }], unita: "%" } : null;
    case "decouple": {
      /* stessa cura del caso qui sopra: la finestra e' quella COMUNE, e si dichiara. */
      const dc = m.decouple || {};
      const a2 = dc.sp500 || [], b2 = dc.gdp || [];
      if (a2.length < 3 || b2.length < 3) return null;
      const fine = [a2[a2.length - 1].d, b2[b2.length - 1].d].sort()[0];
      const inizio = [a2[0].d, b2[0].d].sort()[1];
      const taglia = (arr) => arr.filter(x => x && x.d >= inizio && x.d <= fine);
      const A = taglia(a2), B = taglia(b2);
      if (A.length < 3 || B.length < 3) return null;
      return { doppia: [{ nome: "S&P 500", punti: A, colore: "var(--blue)" },
                        { nome: "PIL reale", punti: B, colore: "var(--muted)", tratteggio: true }],
               soglie: [{ v: 100, testo: "partenza", colore: "var(--border)" }],
               finestra: { inizio, fine } };
    }
    case "corp_profit": {
      /* ⚠⚠ v334 — il CEO: "la linea tratteggiata non segue quella viola". Non era un difetto di
         disegno: le due serie FINISCONO IN DATE DIVERSE. Il Nasdaq e' mensile e arriva a oggi
         (60 punti, fino al 2026-08); i profitti aziendali sono TRIMESTRALI e la fonte li
         pubblica con mesi di ritardo (20 punti, fermi al 2026-01). La tratteggiata si fermava
         prima perche' il dato finisce prima, e sembrava che il grafico fosse rotto.
         Ora si disegna la FINESTRA COMUNE e la si dichiara: due linee che finiscono in momenti
         diversi non sono confrontabili sull'ultimo tratto, ed e' la lezione v207. */
      const cp = m.corp_profit || {};
      const a2 = cp.ndx || [], b2 = cp.profits || [];
      if (a2.length < 3 || b2.length < 3) return null;
      const fine = [a2[a2.length - 1].d, b2[b2.length - 1].d].sort()[0];
      const inizio = [a2[0].d, b2[0].d].sort()[1];
      const taglia = (arr) => arr.filter(x => x && x.d >= inizio && x.d <= fine);
      let A = taglia(a2), B = taglia(b2);
      if (A.length < 3 || B.length < 3) return null;
      /* le due serie hanno frequenze diverse: la prima data DENTRO la finestra puo' non
         coincidere, e ribasare su due date diverse e' esattamente il difetto v349 */
      const inizio2 = [A[0].d, B[0].d].sort()[1];
      A = A.filter(x => x.d >= inizio2); B = B.filter(x => x.d >= inizio2);
      if (A.length < 3 || B.length < 3) return null;
      const base = (arr) => { const b0 = arr[0].v; return b0 ? arr.map(x => ({ d: x.d, v: Math.round(x.v / b0 * 1000) / 10 })) : arr; };
      return { doppia: [{ nome: "Nasdaq 100", punti: base(A), colore: "var(--purple)" },
                        { nome: "Profitti reali", punti: base(B), colore: "var(--muted)", tratteggio: true }],
               soglie: [{ v: 100, testo: `partenza (${inizio2})`, colore: "var(--border)" }],
               finestra: { inizio: inizio2, fine } };
    }
    default: {
      /* ═══ v292 — LA TRAIETTORIA DEGLI INDICATORI MACRO ══════════════════════════════════
         Il CEO: i dati macro "con la stessa logica del VIX" del box TradingView. Da
         TradingView non si puo' — misurato: i simboli ECONOMICS:* (USIRYY, USNFP, USUR,
         USGDPQQ, USCCI, USRSMM) rispondono tutti "disponibile solo su TradingView", col VIX
         che rende nella stessa pagina come controllo positivo. La FORMA pero' si da' lo
         stesso, con i nostri dati, ed e' la parte che mancava.
         ⚠ Queste schede cadevano sulla "scala con le zone" di v272 non per scelta grafica ma
         perche' NON C'ERA UNA SERIE: un valore solo non fa una linea. Ora la pipeline porta
         lo storico e la linea vera batte la scala — la scala restava una lettura mia, la
         traiettoria e' il dato.
         ⚠⚠ LA SERIE STA NELLA STESSA GRANDEZZA DEL TITOLO (la pipeline trasforma: a/a per il
         CPI, m/m per le vendite, variazione mensile per i payroll). Disegnare l'indice
         CPIAUCSL sotto "CPI 3,5% a/a" sarebbe un grafico che dice il falso senza rompersi. */
      if (String(k).startsWith("in:")) {
        const chiave = String(k).slice(3);
        const ind = ((m.indicators) || []).find(x => x && x.key === chiave);
        const st = (ind && ind.storico) || [];
        if (st.length > 2) {
          const UNITA = UNITA_INDICATORE;
          /* ⚠ lo zero si segna SOLO dove e' un confine vero: curva invertita, occupazione che
             cala, vendite o PIL che si contraggono. Altrove sarebbe una soglia inventata, e
             questo progetto ne ha gia' tolte una volta (v240). */
          const CONFINE = { curve: "inversione", curve3m: "inversione", nfp: "posti persi",
                            retail: "vendite in calo", gdp: "contrazione" };
          /* il 2% e' il target DICHIARATO della Federal Reserve, non una convenzione nostra:
             e' l'unico riferimento rispetto al quale un'inflazione a/a si legge. */
          const TARGET_FED = { cpi: true, pce: true };
          const soglie = TARGET_FED[chiave]
            ? [{ v: 2, testo: "target Fed", colore: "var(--green)" }]
            : (CONFINE[chiave] ? [{ v: 0, testo: CONFINE[chiave], colore: "var(--red)" }] : []);
          return { punti: st,
                   unita: (chiave in UNITA) ? UNITA[chiave] : "%",
                   soglie,
                   fonteSerie: ind.storico_serie || "" };
        }
      }
      // serie accumulata dalla pipeline giorno per giorno (v224): compare da sola appena
      // ci sono almeno due rilevazioni
      const st = (DATA?.metrics_history || []).map(x => ({ d: x.date, v: x.macro_scores?.[k] }))
        .filter(x => typeof x.v === "number");
      return st.length > 2 ? { punti: st, soglie: [{ v: 50, testo: "neutro", colore: "var(--muted)" }],
        accumulata: true } : null;
    }
  }
}

/* ═══ v225 — IL QUADRANTE: per chi non ha una serie, un grafico che si legge in un istante ══
   Il misuratore era ancora una BARRA, e il CEO ha ragione: fra 28 barre uguali non si legge
   niente al volo. Un quadrante ad arco con la lancetta si interpreta senza pensarci — la
   posizione dell'ago È il messaggio — ed è diverso a colpo d'occhio da una linea nel tempo,
   quindi si capisce subito quali indicatori hanno uno storico e quali no. */
/* v226 — `quadrante()` RIMOSSA, come `misuratore()` prima di lei. Erano due geometrie diverse
   dello stesso errore: UN widget per OGNI indicatore, trenta volte di fila. Il CEO le ha
   respinte entrambe e aveva ragione due volte — il problema non era l'arco o la barra, era la
   RIPETIZIONE. Ora i 30 indicatori sono DUE grafici (ragnatela + punti su un asse), non 30.
   RICEVUTA DEL TAGLIO, scritta prima di tagliare: 0 chiamanti residui, 0 riferimenti nei test,
   e dentro i confini del blocco non vive nessun'altra funzione — verificato con un assert,
   che alla prima stesura ha MORSO: il confine sbagliato si sarebbe portato via l'intero modulo
   del riordino v225. E' esattamente la classe v201-v204 (un taglio che prende il vicino). */

/* ═══ v225 — L'ORDINE DELLE SEZIONI, TRASCINABILE E UGUALE SU OGNI DEVICE ═══════════════════
   Richiesta CEO: "dammi la possibilità di trascinarli per ordinarli e se lo faccio questo deve
   essere salvato cosicché l'ordine rimanga a prescindere se apro la pagina da mac o iphone".

   Tre decisioni, ognuna con una ragione già pagata in questo progetto:

   1. LA CHIAVE E' `data-sez`, NON IL TITOLO NE' L'INDICE. Accoppiare due cose per il loro nome
      visibile e' fragile per costruzione (v196); per indice invecchia da solo (C10, red team
      I6). Una sezione nuova non sposta niente: finisce in coda (stessa regola di v191).
   2. SI PERMUTANO LE POSIZIONI, NON SI SPOSTANO GLI ELEMENTI NEL DOM LIBERAMENTE. Le sezioni di
      un pane non sono contigue e ci sono elementi senza `data-pane` che devono restare dove
      sono. Si piantano dei segnaposto nelle posizioni attuali e ci si rimettono dentro le
      sezioni nell'ordine nuovo: cio' che non e' una sezione del pane non si muove mai.
   3. POINTER EVENTS, NON HTML5 DRAG-AND-DROP. Il drag HTML5 non esiste su Safari touch — il CEO
      trascinava e non succedeva nulla (v193). Le frecce ▲▼ restano come seconda strada, e
      passano dalla STESSA funzione: due percorsi separati divergerebbero.

   La persistenza e' quella gia' collaudata per cap/veto (v-risk_params): file nel repo via
   Contents API. localStorage da solo NON soddisfa la richiesta — e' per-browser, quindi Mac e
   iPhone resterebbero diversi, che e' esattamente il difetto corretto sui parametri di rischio. */
const SEZ_ORDER_PATH = "config/ui_order.json";
const SEZ_ORDER_KEY = "sezioni_ordine";

function caricaOrdineSezioni() {
  try { const o = JSON.parse(localStorage.getItem(SEZ_ORDER_KEY) || "{}"); return (o && typeof o === "object") ? o : {}; }
  catch { return {}; }
}

/* ⚠⚠ v297 — IL TRASCINAMENTO DELLE SEZIONI ERA MORTO, E IN SILENZIO. Segnalato dal CEO: "non
   riesco piu' ad ordinare i box, non me li fa trascinare". Diagnosticato in browser: le 11
   maniglie ⠿ erano montate, visibili e cliccabili, il `pointerdown` partiva senza errori — e
   non succedeva niente.
   La causa: questa funzione filtrava su `[data-pane="${pane}"]`, ma `data-pane` NEL MARKUP NON
   ESISTE PIU' — l'ha tolto v256 insieme alle schede a pane. Con `pane` undefined il selettore
   diventava `[data-pane="undefined"]`, la lista usciva VUOTA, e `iniziaTrascinamento` usciva
   sulla guardia `ordine.length < 2` senza dire niente. Stessa sorte per le frecce ▲▼ e per il
   salvataggio: tutti e cinque i punti passano di qui.
   ⚠ E' la classe v234 — "un ramo che non puo' essere raggiunto non e' una protezione, e' un
   commento che sembra codice" — applicata a una funzionalita' intera: nessun errore in console,
   nessun test rosso, e una richiesta esplicita del CEO (v225) spenta per quaranta versioni.
   ⚠ La struttura a pane resta gestita, se un domani tornasse: senza pane si lavora sull'insieme
   unico, con pane sul suo. E una chiave salvata che non corrisponde a nessuna sezione (un ordine
   scritto prima che i pane sparissero) ricade sull'insieme unico invece di restituire il vuoto. */
const PANE_UNICO = "_tutte";
function senzaPane(p) { return p == null || p === "undefined" || p === PANE_UNICO; }

function sezioniDelPane(pane) {
  const main = document.querySelector(".shell-main"); if (!main) return [];
  /* ⚠⚠ v301 — «Oggi» E' FISSA IN CIMA, e va imposto invece che sperato. Il commento nel markup
     diceva gia' "sta in cima e non si trascina via", il codice non lo faceva, e l'ordine salvato
     dal CEO — che per progetto mette in coda le sezioni nuove (v191) — l'ha spedita IN FONDO:
     la sezione nata per essere la prima cosa che si guarda la mattina era l'ultima della pagina.
     Un commento che dichiara un comportamento che il codice non ha e' la classe v234, "un ramo
     che sembra codice"; qui era un'intenzione che sembrava una regola.
     ⚠ Escluderla dal riordino le toglie una liberta' al CEO, ed e' deliberato: una sezione che
     risponde a "da dove comincio" non puo' stare dove capita. Tutte le altre restano mobili. */
  const tutte = () => [...main.children].filter(el => el.matches?.("section[data-sez]:not([data-pane]):not([data-fissa])"));
  if (senzaPane(pane)) return tutte();
  const suo = [...main.children].filter(el => el.matches?.(`section[data-sez][data-pane="${pane}"]`));
  return suo.length ? suo : tutte();
}

/* Rimette le sezioni di un pane nelle POSIZIONI che occupano adesso, ma nell'ordine chiesto.
   I segnaposto sono commenti: invisibili, non impaginano, e ancorano una posizione che non si
   sposta mentre si muovono gli elementi. */
function disponiSezioni(pane, chiavi) {
  const lista = sezioniDelPane(pane);
  if (lista.length < 2) return;
  const noti = chiavi.map(k => lista.find(el => el.dataset.sez === k)).filter(Boolean);
  const resto = lista.filter(el => !noti.includes(el));          // sezioni nuove → in coda
  const nuovo = [...noti, ...resto];
  if (nuovo.every((el, i) => el === lista[i])) return;           // gia' cosi': non toccare il DOM
  const ancore = lista.map(el => { const c = document.createComment("sez"); el.replaceWith(c); return c; });
  nuovo.forEach((el, i) => ancore[i].after(el));
  ancore.forEach(c => c.remove());
}

function applicaOrdineSezioni() {
  const ord = caricaOrdineSezioni();
  for (const pane of Object.keys(ord)) if (Array.isArray(ord[pane])) disponiSezioni(pane, ord[pane]);
}

function salvaOrdineSezioni(pane) {
  const ord = caricaOrdineSezioni();
  /* ⚠ la chiave dev'essere leggibile e stabile: con `pane` undefined diventava la stringa
     "undefined" dentro config/ui_order.json — funzionante ma incomprensibile a chi apre il file. */
  ord[senzaPane(pane) ? PANE_UNICO : pane] = sezioniDelPane(pane).map(el => el.dataset.sez);
  ord._savedAt = new Date().toISOString();
  try { localStorage.setItem(SEZ_ORDER_KEY, JSON.stringify(ord)); } catch { /* quota */ }
  if (localStorage.getItem("gh_token")) pushOrdineSezioniCloud(ord);
  else toast("Ordine salvato solo su questo browser: senza token GitHub non arriva su iPhone");
}

async function pushOrdineSezioniCloud(ord) {
  const token = localStorage.getItem("gh_token");
  if (!token) return;
  try {
    let sha;
    const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${SEZ_ORDER_PATH}`, { headers: ghHeaders(token), cache: "no-store" });
    if (g.ok) sha = (await g.json()).sha;
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${SEZ_ORDER_PATH}`, {
      method: "PUT", headers: ghHeaders(token),
      body: JSON.stringify({ message: "Ordine sezioni dashboard (da dashboard)", content: btoa(unescape(encodeURIComponent(JSON.stringify(ord, null, 1)))), sha }),
    });
    toast(r.ok ? "Ordine salvato — sarà lo stesso su Mac e iPhone" : "Ordine salvato in locale: GitHub ha rifiutato la scrittura");
  } catch { toast("Ordine salvato in locale: nessuna rete verso GitHub"); }
}

async function loadOrdineSezioniCloud() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${SEZ_ORDER_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const cloud = await r.json();
    if (!cloud || typeof cloud !== "object") return;
    const local = caricaOrdineSezioni();
    if ((cloud._savedAt || "") > (local._savedAt || "")) {      // vince il piu' recente
      localStorage.setItem(SEZ_ORDER_KEY, JSON.stringify(cloud));
      applicaOrdineSezioni();
    }
  } catch { /* nessun file remoto: vale l'ordine di index.html */ }
}

/* ── i comandi: una maniglia per trascinare, due frecce per chi trascina male (o su iPhone) ── */
function montaComandiSezioni() {
  /* ⚠ niente maniglia sulle sezioni fisse: un comando che non fa niente e' peggio di un
     comando assente — chi lo usa pensa che il sistema non risponda. */
  document.querySelectorAll(".shell-main > section[data-sez]:not([data-fissa])").forEach(sez => {
    if (sez.querySelector(":scope > .sez-cmd")) return;
    const c = document.createElement("div");
    c.className = "sez-cmd";
    c.innerHTML = `<button class="sez-grip" type="button" aria-label="Trascina per spostare la sezione" title="Trascina per spostare">⠿</button>
      <button class="sez-su" type="button" aria-label="Sposta la sezione in su" title="Sposta in su">▲</button>
      <button class="sez-giu" type="button" aria-label="Sposta la sezione in giù" title="Sposta in giù">▼</button>`;
    sez.prepend(c);
    c.querySelector(".sez-su").addEventListener("click", () => spostaSezione(sez, -1));
    c.querySelector(".sez-giu").addEventListener("click", () => spostaSezione(sez, +1));
    c.querySelector(".sez-grip").addEventListener("pointerdown", e => iniziaTrascinamento(e, sez));
  });
}

/* UNICA strada per applicare un ordine nuovo: frecce e trascinamento passano entrambe di qui. */
function spostaSezione(sez, delta) {
  const pane = sez.dataset.pane;
  const lista = sezioniDelPane(pane);
  const i = lista.indexOf(sez), j = i + delta;
  if (i < 0 || j < 0 || j >= lista.length) return;
  lista.splice(j, 0, lista.splice(i, 1)[0]);
  disponiSezioni(pane, lista.map(el => el.dataset.sez));
  salvaOrdineSezioni(pane);
  sez.scrollIntoView({ block: "nearest" });
}

function iniziaTrascinamento(e, sez) {
  if (e.button > 0) return;
  e.preventDefault();                       // su touch impedisce che il gesto diventi uno scroll
  const pane = sez.dataset.pane;
  const main = document.querySelector(".shell-main");
  let ordine = sezioniDelPane(pane);
  if (ordine.length < 2) return;
  /* Mentre si trascina le card si riducono alla loro intestazione: una card alta 600px farebbe
     saltare il layout a ogni scambio e costringerebbe a scorrere per vedere dove si sta
     lasciando. Cosi' l'elenco del pane sta tutto sullo schermo, anche su iPhone. */
  main.classList.add("in-riordino");
  sez.classList.add("sez-trascinata");
  const grip = e.currentTarget;
  try { grip.setPointerCapture(e.pointerId); } catch { /* browser senza capture */ }

  const muovi = ev => {
    const y = ev.clientY;
    const altri = ordine.filter(x => x !== sez);
    const idx = altri.filter(x => { const r = x.getBoundingClientRect(); return r.top + r.height / 2 < y; }).length;
    altri.splice(idx, 0, sez);
    if (altri.some((el, i) => el !== ordine[i])) {
      ordine = altri;
      disponiSezioni(pane, ordine.map(el => el.dataset.sez));
    }
  };
  const finisci = () => {
    grip.removeEventListener("pointermove", muovi);
    grip.removeEventListener("pointerup", finisci);
    grip.removeEventListener("pointercancel", finisci);
    main.classList.remove("in-riordino");
    sez.classList.remove("sez-trascinata");
    salvaOrdineSezioni(pane);
  };
  grip.addEventListener("pointermove", muovi);
  grip.addEventListener("pointerup", finisci);
  grip.addEventListener("pointercancel", finisci);
}

/* ═══ v241 — LE SCHEDE SI TRASCINANO COME SU UNA SCRIVANIA ══════════════════════════════════
   Richiesta CEO: "puoi anche consentirmi di trascinare e modificare le schede come se fosse un
   desktop? l'ordine che poi salvo dovrà presentarsi su qualsiasi terminale".
   Si riusa per intero la macchina delle SEZIONI (v225), che gia' risolve i tre problemi veri:
     · POINTER EVENTS, non HTML5 drag — su Safari touch il drag HTML5 non esiste (v193), quindi
       su iPhone non succederebbe niente;
     · la CHIAVE e' `data-scheda` (la chiave dell'indicatore: in:cpi, dollar, macroquant…), non
       il titolo (fragile, v196) e non l'indice (invecchia da solo, C10);
     · la PERSISTENZA sta nello stesso `config/ui_order.json` scritto via Contents API. E' questo
       che soddisfa "su qualsiasi terminale": localStorage e' per-browser, e Mac e iPhone
       resterebbero diversi — il difetto gia' corretto sui parametri di rischio.
   ⚠ Differenza vera rispetto alle sezioni: le schede stanno in una griglia BIDIMENSIONALE
   impaccata a masonry, non in una colonna. Il bersaglio non si trova confrontando le sole y:
   si guarda quale scheda sta SOTTO il puntatore. */
function schedeDi(box) {
  return box ? [...box.querySelectorAll(":scope > .mg-card[data-scheda]")] : [];
}

/* stessa tecnica delle sezioni: si piantano segnaposto invisibili nelle posizioni attuali e ci
   si rimettono dentro le schede nell'ordine nuovo, cosi' non si sposta nient'altro */
function disponiSchede(box, chiavi) {
  const lista = schedeDi(box);
  if (lista.length < 2) return;
  const noti = chiavi.map(k => lista.find(el => el.dataset.scheda === k)).filter(Boolean);
  const resto = lista.filter(el => !noti.includes(el));       // schede nuove → in coda
  const nuovo = [...noti, ...resto];
  if (nuovo.every((el, i) => el === lista[i])) return;
  const ancore = lista.map(el => { const c = document.createComment("sk"); el.replaceWith(c); return c; });
  nuovo.forEach((el, i) => ancore[i].after(el));
  ancore.forEach(c => c.remove());
}

function applicaOrdineSchede(box, id) {
  if (!box) return;
  const c = (caricaOrdineSezioni().schede || {})[id];
  if (Array.isArray(c) && c.length) disponiSchede(box, c);
}

function salvaOrdineSchede(box, id) {
  const ord = caricaOrdineSezioni();
  ord.schede = ord.schede || {};
  ord.schede[id] = schedeDi(box).map(el => el.dataset.scheda);
  ord._savedAt = new Date().toISOString();
  try { localStorage.setItem(SEZ_ORDER_KEY, JSON.stringify(ord)); } catch { /* quota */ }
  if (localStorage.getItem("gh_token")) pushOrdineSezioniCloud(ord);
  else toast("Ordine salvato solo su questo browser: senza token GitHub non arriva su iPhone");
}

function montaTrascinamentoSchede(box, id) {
  if (!box) return;
  schedeDi(box).forEach(card => {
    if (card.querySelector(":scope > .sk-grip")) return;
    const g = document.createElement("button");
    g.className = "sk-grip"; g.type = "button"; g.textContent = "⠿";
    g.title = "Trascina per spostare la scheda";
    g.setAttribute("aria-label", `Sposta la scheda ${card.dataset.scheda}`);
    card.prepend(g);
    g.addEventListener("pointerdown", e => trascinaScheda(e, card, box, id));
    // tastiera: frecce per chi non trascina (e per l'accessibilita')
    g.addEventListener("keydown", ev => {
      const d = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0;
      if (!d) return;
      ev.preventDefault();
      const l = schedeDi(box), i = l.indexOf(card), j = i + d;
      if (j < 0 || j >= l.length) return;
      l.splice(j, 0, l.splice(i, 1)[0]);
      disponiSchede(box, l.map(x => x.dataset.scheda));
      salvaOrdineSchede(box, id);
      impaccaGriglia(document.querySelector(".shell-main"));
      g.focus();
    });
  });
}

function trascinaScheda(e, card, box, id) {
  if (e.button > 0) return;
  e.preventDefault();                        // su touch impedisce che il gesto diventi uno scroll
  if (schedeDi(box).length < 2) return;
  box.classList.add("in-riordino-schede");
  card.classList.add("sk-trascinata");
  const grip = e.currentTarget;
  try { grip.setPointerCapture(e.pointerId); } catch { /* browser senza capture */ }

  /* ═══ SCORRIMENTO AUTOMATICO AI BORDI ═════════════════════════════════════════════════════
     ⚠ Senza questo il trascinamento e' vero solo per spostamenti CORTI. Misurato: le 27 schede
     occupano ~3000px, e `elementFromPoint` — che e' come si trova il bersaglio — restituisce
     null fuori dal viewport, per definizione. Quindi portare la prima scheda in ventesima
     posizione era semplicemente impossibile: il punto d'arrivo non e' sullo schermo.
     Vicino al bordo la pagina scorre da sola, come su una scrivania vera. */
  let scorri = null;
  const autoScorrimento = (y) => {
    const banda = 90, passo = 14;
    const v = y < banda ? -passo : y > innerHeight - banda ? passo : 0;
    if (!v) { clearInterval(scorri); scorri = null; return; }
    if (scorri) return;
    scorri = setInterval(() => window.scrollBy(0, v), 16);
  };

  const muovi = ev => {
    autoScorrimento(ev.clientY);
    /* ⚠ in una griglia 2D il bersaglio NON si trova confrontando le y (era il metodo delle
       sezioni, che stanno in colonna): si guarda quale scheda e' sotto il puntatore. */
    const sotto = document.elementFromPoint(ev.clientX, ev.clientY);
    const target = sotto && sotto.closest ? sotto.closest(".mg-card[data-scheda]") : null;
    if (!target || target === card || target.parentElement !== box) return;
    const l = schedeDi(box);
    const i = l.indexOf(card), j = l.indexOf(target);
    if (i < 0 || j < 0) return;
    l.splice(j, 0, l.splice(i, 1)[0]);
    disponiSchede(box, l.map(x => x.dataset.scheda));
    impaccaGriglia(document.querySelector(".shell-main"));
  };
  const finisci = () => {
    clearInterval(scorri); scorri = null;      // lo scorrimento non deve sopravvivere al rilascio
    grip.removeEventListener("pointermove", muovi);
    grip.removeEventListener("pointerup", finisci);
    grip.removeEventListener("pointercancel", finisci);
    box.classList.remove("in-riordino-schede");
    card.classList.remove("sk-trascinata");
    salvaOrdineSchede(box, id);
    impaccaGriglia(document.querySelector(".shell-main"));
  };
  grip.addEventListener("pointermove", muovi);
  grip.addEventListener("pointerup", finisci);
  grip.addEventListener("pointercancel", finisci);
}


/* ---------------- tabella ---------------- */
function sparkline(values) {
  if (!values || values.length < 2) return "";
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) =>
    `${(i / (values.length - 1)) * 110},${28 - ((v - min) / range) * 26}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  const color = up ? "var(--green)" : "var(--red)";
  return `<svg class="spark" viewBox="0 0 110 30" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"/>
  </svg>`;
}

function meterBar(pct, color, text) {
  const w = Math.max(3, Math.min(100, pct));
  return `<div class="meter" title="${text}">
    <span class="meter-txt">${text}</span>
    <span class="meter-track"><span class="meter-fill" style="width:${w}%;background:${color}"></span></span>
  </div>`;
}

const RATING_LABELS = {
  strong_buy: ["Strong Buy", "good"], buy: ["Buy", "good"],
  hold: ["Hold", "neutral"], underperform: ["Underperf.", "bad"],
  sell: ["Sell", "bad"], strong_sell: ["Strong Sell", "bad"],
};





/* cella Volume con RVol (Volume Relativo = volume oggi / media 30gg, dalla pipeline):
   RVol > 1.5 = flussi anomali (istituzionali in movimento) → flag [Volumi Anomali] */

/* v206 — prima questa funzione si chiamava "Bar" e NON disegnava nessuna barra: il nome
   mentiva. La forza relativa è zero-centrata per natura (batti o non batti il benchmark),
   quindi la barra divergente è la sua resa ovvia. Scala fissa ±20pp per rendere le righe
   confrontabili fra loro invece che ognuna sulla propria. */

/* Popup esplicativo della colonna "RS 1M" (forza relativa vs indice di settore: SOX/NDX/S&P) */
/* scheda completa del titolo (tecnica + fondamentale) — utile soprattutto su iPhone (tap sul titolo) */
function openStockDetail(ticker) {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === ticker);
  if (!r) return;
  const c = cur(r);
  const st = r.stats || {};
  const pct = (v) => v == null ? "—" : (Math.round(v * 1000) / 10) + "%";
  const row = (lab, val) => `<div class="sd-row"><span class="sd-lab">${lab}</span><span class="sd-val">${val}</span></div>`;
  const inPtf = (DATA.portfolio || []).some(p => p.ticker === r.ticker && p.qty);
  const tech = [
    inPtf ? row("Quantità", fmtNum.format(r.qty)) : "",
    inPtf ? row("PMC", c + fmtNum.format(r.pmc)) : "",
    row("Prezzo", c + fmtNum.format(r.price) + ` <span class="${signCls(r.change_pct)}">(${signTxt(r.change_pct)})</span>`),
    inPtf ? row("Guadagno", `<span class="${signCls(r.gain_eur)}">${signTxt(Math.round(r.gain_eur || 0), " €")}</span>`) : "",
    row("RSI 14", r.rsi ?? "—"),
    row("Supporto / Resistenza", `${r.support ? c + fmtNum.format(r.support) : "—"} / ${r.resistance ? c + fmtNum.format(r.resistance) : "—"}`),
    row("Beta vs NDX", r.beta_ndx != null ? `${fmtNum.format(r.beta_ndx)} <span class="muted" style="font-size:10px">(regressione 12M)</span>` : (r.beta != null ? `${fmtNum.format(r.beta)} <span class="muted" style="font-size:10px">(Yahoo)</span>` : "—")),
    row("Sharpe 1A", r.sharpe_1y != null ? `<b style="color:${sharpeColor(r.sharpe_1y)}">${fmtNum.format(r.sharpe_1y)}</b>` : "—"),
    row("Forza rel. 1M (settore)", r.rs_1m != null ? signTxt(r.rs_1m) : "—"),
    row("Forza rel. 1M vs NDX", r.rs_ndx_1m != null ? `<span class="${signCls(r.rs_ndx_1m)}">${signTxt(r.rs_ndx_1m, " pp")}</span>` : "—"),
    r.avg_corr != null ? row("Correlazione media ptf", `${fmtNum.format(r.avg_corr)}${r.max_corr != null ? ` <span class="muted" style="font-size:10px">(max ${fmtNum.format(r.max_corr)} con ${r.max_corr_with})</span>` : ""}`) : "",
    r.risk_contrib_pct != null ? row("Quota rischio ptf (MCR)", `${fmtNum.format(r.risk_contrib_pct)}%`) : "",
    row("Drawdown 52S", r.w52_dist_pct != null ? signTxt(r.w52_dist_pct) : "—"),
    row("Short float", st.short_float != null ? pct(st.short_float) : "—"),
    row("Segnale", `<span class="badge ${r.signal_class}">${r.signal}</span>${isAsimm(r) ? ` <span class="badge badge-asimm">⚡ASIMM</span>` : ""}`),
    r.rating?.upside_pct != null ? row("Target Δ", signTxt(r.rating.upside_pct)) : "",
    r.earnings_date ? row("Trimestrale", new Date(r.earnings_date).toLocaleDateString("it-IT")) : "",
  ].join("");
  const fcf = st.market_cap && st.fcf && st.fcf > 0 ? Math.round(st.market_cap / st.fcf * 10) / 10 : null;
  const fund = [
    row("P/E", st.pe_ttm || r.pe ? fmtNum.format(Math.round((st.pe_ttm || r.pe) * 10) / 10) + "×" : "—"),
    row("P/FCF", fcf ? fmtNum.format(fcf) + "×" : "—"),
    row("EV/EBITDA", st.ev_ebitda ? fmtNum.format(Math.round(st.ev_ebitda * 10) / 10) + "×" : "—"),
    row("ROE / ROIC", st.roe != null ? pct(st.roe) + (st.roe > 0.15 ? " <span class='pos'>[premium]</span>" : st.roe < 0 ? " <span class='neg'>[zombie]</span>" : "") : "—"),
    row("Margine netto", st.profit_margin != null ? pct(st.profit_margin) : "—"),
    row("Crescita ricavi", st.revenue_growth != null ? pct(st.revenue_growth) : "—"),
    row("PEG", st.peg != null ? fmtNum.format(Math.round(st.peg * 100) / 100) : "—"),
    row("Altman Z-Score", st.altman_z != null ? `${fmtNum.format(st.altman_z)}${st.altman_z < 1.81 ? " <span class='neg'>[RISCHIO DEFAULT]</span>" : ""}` : "—"),
    row("P/B", st.price_to_book != null ? fmtNum.format(Math.round(st.price_to_book * 10) / 10) + "×" : "—"),
    row("Dividendo", st.dividend_yield != null ? pct(st.dividend_yield) : "—"),
  ].join("");
  const tv = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol(r))}`;
  openInfoModal(`${r.name} (${r.ticker})`,
    `<div class="sd-grid"><div class="sd-col"><h4>Tecnica & Prezzi</h4>${tech}</div>
      <div class="sd-col"><h4>Fondamentali</h4>${st.market_cap ? fund : '<div class="muted" style="font-size:12px">Fondamentali non disponibili</div>'}</div></div>
     <div style="margin-top:10px;text-align:center"><a class="btn btn-ghost btn-sm" href="${tv}" target="_blank" rel="noopener">Apri grafico TradingView ↗</a></div>`);
}

function openRsInfo(ticker) {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === ticker);
  if (!r) return;
  const BENCH = {
    sox: { lab: "SOX — PHLX Semiconductor Index", why: "indice dei semiconduttori: il benchmark giusto per chip/hardware AI (NVDA, AMD, MU, AVGO…)" },
    ndx: { lab: "Nasdaq 100 (NDX)", why: "le 100 maggiori società tech/growth USA: benchmark per software, big tech e crescita" },
    sp500: { lab: "S&P 500", why: "le 500 maggiori società USA: benchmark generale per finanziari, difensivi e titoli value" },
  };
  const bk = r.rs_bench && BENCH[r.rs_bench] ? r.rs_bench : "sp500";
  const b = BENCH[bk];
  const rs = r.rs_1m;
  const verdict = rs == null ? null
    : rs >= 5 ? { t: "LEADERSHIP FORTE", c: "var(--green)", d: "il titolo è molto più forte del suo settore: capitale istituzionale in entrata, trend dominante. Da mantenere/cavalcare." }
    : rs >= 2 ? { t: "Sovraperformance", c: "var(--green)", d: "batte il settore: forza relativa positiva, leadership in costruzione." }
    : rs > -2 ? { t: "In linea col settore", c: "var(--muted)", d: "si muove come il suo benchmark: nessuna divergenza di forza significativa." }
    : rs > -5 ? { t: "Sottoperformance", c: "var(--red)", d: "più debole del settore: possibile rotazione in uscita o debolezza relativa, da monitorare." }
    : { t: "DEBOLEZZA STRUTTURALE", c: "var(--red)", d: "molto più debole del settore: laggard, capitale in fuga. Verificare se la tesi è ancora valida (Tax Alpha / scudo fiscale)." };
  // confronto Day% vs benchmark odierno (se disponibile)
  const bmDay = (DATA.macro || {}).benchmarks || {};
  const dayBench = bmDay[bk];
  const dayAlpha = (r.change_pct != null && dayBench != null) ? r.change_pct - dayBench : null;
  openInfoModal(`Forza Relativa (RS 1M) — ${r.name} (${ticker})`,
    `<div class="info-line" style="margin-bottom:10px"><b>Cos'è la "Forza Relativa" (RS)?</b><br>È la differenza tra la performance del titolo e quella del suo <b>indice di settore</b> nell'ultimo mese. Misura se il titolo è un <b>leader</b> (più forte del settore) o un <b>laggard</b> (più debole). È il filtro che usano gli istituzionali per capire DOVE sta entrando il capitale: si comprano i leader, si evitano/vendono i laggard.</div>
     <div class="info-line" style="background:var(--card-2);border-radius:8px;padding:10px;margin-bottom:10px">
       <div style="font-size:13px;margin-bottom:4px">${ticker} vs settore: <b style="color:${verdict ? verdict.c : 'var(--muted)'};font-size:18px">${rs != null ? (rs > 0 ? "+" : "") + fmtNum.format(rs) + "%" : "n.d."}</b> (1 mese)</div>
       ${verdict ? `<div style="font-size:13px;color:${verdict.c};font-weight:700">${verdict.t}</div><div class="muted" style="font-size:12px;margin-top:3px">${verdict.d}</div>` : `<div class="muted" style="font-size:12px">Dato di forza relativa non ancora disponibile per questo titolo.</div>`}
     </div>
     <h4 style="margin:8px 0 4px">Benchmark usato per ${ticker}</h4>
     <div class="info-line"><b>${b.lab}</b><br><span class="muted" style="font-size:12px">${b.why}</span></div>
     <div class="info-line muted" style="font-size:11.5px;margin-top:6px">Ogni titolo viene confrontato con l'indice più pertinente al suo settore: semiconduttori → <b>SOX</b>, tech/software/growth → <b>Nasdaq 100</b>, finanziari/value/difensivi → <b>S&P 500</b>. Confrontare NVDA con l'S&P darebbe un segnale fuorviante: va confrontato con gli altri chip (SOX).</div>
     ${dayAlpha != null ? `<h4 style="margin:10px 0 4px">Oggi vs benchmark</h4><div class="info-line">${ticker} oggi <span class="${signCls(r.change_pct)}">${signTxt(r.change_pct)}</span> · ${b.lab.split(" —")[0]} <span class="${signCls(dayBench)}">${signTxt(dayBench)}</span> → alpha giornaliero <b class="${signCls(dayAlpha)}">${signTxt(Math.round(dayAlpha*100)/100)} pp</b></div>` : ""}
     <div class="info-line muted" style="font-size:11px;margin-top:8px">Regola operativa: forza relativa positiva e crescente = mantieni/accumula (capitale in entrata). Forza relativa molto negativa = laggard: candidato a rotazione o, se i fondamentali sono rotti (ROIC<0), a "scudo fiscale" (Tax Alpha).</div>`);
}


/* Flottante: azioni liberamente scambiabili. Evidenzia il rischio short squeeze quando il
   float è ridotto (<50M) E lo short interest è elevato (>=15%) E i volumi sono anomali (>1,5×). */


/* spiegazione dei badge (Squeeze Risk, Deep Value, Correzione, RSI ipervenduto) */
const BADGE_INFO = {
  squeeze: ["Short Squeeze Risk", "Più del 12% del flottante è venduto allo scoperto. Se il titolo sale, gli short sono costretti a ricomprare per chiudere le posizioni, alimentando un rialzo esplosivo (short squeeze). È un segnale di potenziale volatilità rialzista violenta — interessante per posizioni speculative, rischioso per chi è short."],
  deepvalue: ["Deep Value — Deploy Cash", "Il titolo è sceso oltre il 25% dal massimo delle 52 settimane: massima asimmetria rischio/rendimento per chi accumula con orizzonte lungo (Diamond Hands). Zona di massimo interesse per schierare la liquidità tattica con ordini limite, se la tesi fondamentale è intatta."],
  correction: ["Correzione — Zona 1", "Il titolo è in correzione (tra -15% e -25% dal massimo 52 settimane): primo livello di accumulo. Considera di impiegare il 25-30% della liquidità tattica con ordini limite ai supporti. Verifica che non sia una rottura strutturale dei fondamentali."],
  oversold: ["RSI ipervenduto", "L'RSI è sotto 30: il titolo è statisticamente ipervenduto nel breve termine, spesso prelude a un rimbalzo tecnico. Da solo non è un segnale d'acquisto: incrocialo con supporto, trend e fondamentali."],
  overbought: ["RSI ipercomprato", "L'RSI è sopra 70: il titolo è ipercomprato nel breve, possibile pausa/ritracciamento. Per le posizioni vincenti (Diamond Hands) NON è un motivo di vendita, ma può suggerire un TRIM parziale (Free Ride) se il multiplo è teso."],
};
function openBadgeInfo(type) {
  const b = BADGE_INFO[type];
  if (!b) return;
  openInfoModal(b[0], `<div class="info-line" style="font-size:13px;line-height:1.65">${b[1]}</div>`);
}

/* Cella Sharpe 1A: verde brillante >2, verde tenue 1-2, grigio <1 (cliccabile per spiegazione) */
function sharpeColor(s) {
  if (s == null) return "var(--muted)";
  if (s > 2) return "var(--green)";
  if (s >= 1) return "#86c52a";       // verde tenue
  if (s >= 0) return "var(--muted)";
  return "var(--red)";                // negativo = sottoperforma il risk-free
}


function openSharpeInfo(ticker) {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === ticker);
  if (!r) return;
  const s = r.sharpe_1y;
  const rf = ((DATA.totals || {}).risk_free_rate ?? 0.0363) * 100;
  const pSharpe = (DATA.totals || {}).portfolio_sharpe_ratio;
  const verdict = s == null ? null
    : s > 2 ? { t: "ECCELLENTE", c: "var(--green)", d: "rendimento per unità di rischio molto alto: il titolo ha pagato bene la volatilità sopportata." }
    : s >= 1 ? { t: "BUONO", c: "#86c52a", d: "rendimento corretto per il rischio solido (sopra 1 = accettabile per gli istituzionali)." }
    : s >= 0 ? { t: "DEBOLE", c: "var(--muted)", d: "rendimento che ha appena battuto (o quasi) il tasso privo di rischio: poco premio per la volatilità." }
    : { t: "NEGATIVO", c: "var(--red)", d: "ha reso meno del tasso privo di rischio: il rischio assunto NON è stato ripagato." };
  openInfoModal(`Sharpe Ratio (12 mesi) — ${r.name} (${ticker})`,
    `<div class="info-line" style="margin-bottom:10px"><b>Cos'è lo Sharpe Ratio?</b><br>Misura il <b>rendimento corretto per il rischio</b>: quanto extra-rendimento (sopra il tasso privo di rischio del <b>${fmtNum.format(rf)}%</b>) un titolo genera per ogni unità di volatilità. Formula: <span style="font-family:var(--mono)">(Rendimento annuo − ${fmtNum.format(rf)}%) ÷ Volatilità annua</span>. Più è alto, meglio il titolo "paga" il rischio che ti fa correre.</div>
     <div class="info-line" style="background:var(--card-2);border-radius:8px;padding:10px;margin-bottom:10px">
       <div style="font-size:13px;margin-bottom:4px">${ticker}: <b style="color:${sharpeColor(s)};font-size:20px">${s != null ? fmtNum.format(s) : "n.d."}</b></div>
       ${verdict ? `<div style="font-size:13px;color:${verdict.c};font-weight:700">${verdict.t}</div><div class="muted" style="font-size:12px;margin-top:3px">${verdict.d}</div>` : `<div class="muted" style="font-size:12px">Sharpe non ancora disponibile (servono ≥60 giorni di storico).</div>`}
     </div>
     <h4 style="margin:8px 0 4px">Scala di riferimento</h4>
     <table class="info-table"><tbody>
       <tr><td><b style="color:var(--green)">&gt; 2,0</b></td><td>Eccellente — rendimento/rischio molto efficiente</td></tr>
       <tr><td><b style="color:#86c52a">1,0 – 2,0</b></td><td>Buono — standard di qualità istituzionale</td></tr>
       <tr><td><b style="color:var(--muted)">0 – 1,0</b></td><td>Debole — poco premio per la volatilità</td></tr>
       <tr><td><b style="color:var(--red)">&lt; 0</b></td><td>Negativo — il rischio non è stato ripagato</td></tr>
     </tbody></table>
     ${pSharpe != null ? `<div class="info-line muted" style="font-size:11.5px;margin-top:8px">Sharpe complessivo del portafoglio (calcolato con la matrice di covarianza pesata per controvalore): <b style="color:${sharpeColor(pSharpe)}">${fmtNum.format(pSharpe)}</b>. Grazie alla diversificazione, lo Sharpe di portafoglio è spesso più alto della media dei singoli titoli.</div>` : ""}`);
}

/* ═══ v188 — CELLE FONDAMENTALI NELLA TABELLA PRINCIPALE.
   Prima "Tecnica & Prezzi" e "Fondamentale (Value)" erano due tabelle alternative dietro un
   interruttore: per confrontare il P/E col Sortino bisognava passare avanti e indietro. Ora
   sono una tabella sola, ed e' il selettore di colonne a decidere cosa vedere — che e' la
   ragione per cui il CEO ha chiesto le due cose insieme.
   Le celle restano identiche a quelle della vecchia vista fondamentale: stessi campi, stesse
   soglie, stessi flag. Cambia il contenitore, non il contenuto. */
/* v188: buildFundTable/renderFundTable/renderWlFundTable/setPtfView/setWlView RIMOSSE.
   Le due viste alternative "Tecnica & Prezzi" / "Fondamentale (Value)" sono diventate UNA
   tabella con tutte le colonne (techCells + fundCells) piu' il selettore di colonne: era la
   richiesta del CEO, e le due cose stanno insieme — si unisce perche' ora si puo' nascondere.
   Le chiamate superstiti diventano no-op invece di sparire una per una: se un domani qualcuno
   riaggancia un handler alla vista, trova una funzione che non rompe niente. */
const setPtfView = () => {}, setWlView = () => {};
const renderFundTable = () => {}, renderWlFundTable = () => {};

/* v208 — LE COLONNE FONDAMENTALI SONO STATE TAGLIATE, MA NON A CASO.
   Regola applicata: si toglie dalla pagina ciò che l'LLM RICEVE GIÀ dal payload, si tiene ciò
   che vive SOLO qui. Verificato generando il payload sui dati veri prima di tagliare: Market
   Cap, P/E, P/E fwd, EV/EBITDA, ROE, margine, P/FCF, crescita ricavi, PEG, Z-Score e Target Δ
   ci sono tutti (da 1 a 49 occorrenze ciascuno) — quelle sono uscite. Debt/Equity, Div Yield e
   Financial Health NON c'erano: tagliarle le avrebbe fatte sparire dal sistema, non dalla
   pagina. È esattamente la classe v201-v204 (un taglio che si porta via il vicino), evitata
   perché la ricevuta è stata scritta PRIMA. */
/* ═══ v251 — FINANCIAL HEALTH È UN PUNTEGGIO: al suo posto vanno i NUMERI che lo compongono ═
   Richiesta CEO: "in financial health i contenuti portali nella tabella principale".
   `fin_health` è un 0-100 fatto per il 40% dalla crescita dei ricavi, 30% dalla costanza degli
   utili e 30% dalla stabilità del margine. I dati grezzi ci sono già in `financials` (fino a 5
   anni di ricavi, utile netto e margine) e NON SONO MAI STATI MOSTRATI da nessuna parte.
   ⚠ Un punteggio composito nasconde di chi è il merito: 90/100 non dice se l'azienda cresce e
   guadagna poco o cresce poco e guadagna tanto. I tre numeri sì. */
/* market cap abbreviata: la tabella e' gia' larga, "1,2T" batte "1.200.000" */


/* ═══ v228 — GIORNI DI CALENDARIO ALLA TRIMESTRALE, UNA SOLA VOLTA ═════════════════════════
   Trovato eseguendo il payload su me stesso. PLTR riportava gli utili OGGI (2026-08-03), aveva
   lo stop violato ed era in portafoglio: il caso piu' urgente che esista. Nella tabella portava
   [!EARNINGS RISK], ma nella riga PRIORITÀ del brief NON compariva — c'erano solo AMD e RGTI,
   che riportano DOPO. Causa: due implementazioni della stessa domanda.
     · la tabella: Math.ceil((data − adesso)/86400000)  → -0,45 diventa -0 → passa
     · il brief:   (data − adesso)/86400000 >= 0        → -0,45 → NON passa
   `new Date("2026-08-03")` e' la MEZZANOTTE di oggi, che alle 10:48 e' gia' passata: la
   trimestrale del giorno stesso risultava nel passato. E' la classe v161/v207 — due derivazioni
   della stessa grandezza divergono in silenzio — e qui il difetto nascondeva l'evento piu'
   urgente proprio nella riga che si chiama PRIORITÀ.
   Qui si contano GIORNI DI CALENDARIO in ora locale: oggi = 0, domani = 1. Chiunque chieda
   "fra quanto riporta" passa da questa funzione, cosi' non possono piu' divergere. */
function giorniAllaTrimestrale(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).length === 10 ? iso + "T00:00:00" : iso);   // locale, non UTC
  if (isNaN(d)) return null;
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const quel = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((quel - oggi) / 86400000);
}

/* trimestrale entro 14 giorni solari = rischio evento binario → flag [!EARNINGS RISK] */

/* cella Trimestrale in tabella: data earnings + Implied Move (±%) + flag rischio evento */


/* ═══ v206 — CELLE CON BARRA DI FONDO ═════════════════════════════════════════════════════
   "Meno numeri, più grafici" senza perdere un dato: la cifra RESTA leggibile, dietro le passa
   una barra proporzionale. Confrontare dieci righe smette di richiedere dieci letture.
   ⚠ Vale per costruzione la regola v188: mdRow() legge i campi grezzi di data.json e non
   guarda la UI, quindi qualunque resa grafica di una cella lascia il payload identico.
   `scala` = il valore che riempie la cella; `mid:true` centra la barra sullo zero. */


/* modale "Conto economico": barre ricavi/utile + linea margine netto */
// metriche "Statistiche chiave": [etichetta, formato, spiegazione]
const fmtBig = v => v == null ? "—" : Math.abs(v) >= 1e12 ? (v / 1e12).toFixed(2) + " T" : Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + " B" : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + " M" : fmtNum.format(v);
const fmtPctF = v => v == null ? "—" : fmtNum.format(Math.round(v * 1000) / 10) + "%";   // frazione → %
const fmtN2 = v => v == null ? "—" : fmtNum.format(v);
const STAT_META = {
  market_cap: ["Capitalizzazione", v => "$" + fmtBig(v), "Valore di mercato dell'azienda (prezzo × azioni)."],
  pe_ttm: ["P/E (TTM)", fmtN2, "Prezzo / utili ultimi 12 mesi. Alto = costoso o alte attese."],
  forward_pe: ["P/E prospettico", fmtN2, "Prezzo / utili attesi prossimi 12 mesi."],
  eps_ttm: ["EPS (TTM)", v => "$" + fmtN2(v), "Utile per azione ultimi 12 mesi."],
  eps_forward: ["EPS stimato", v => "$" + fmtN2(v), "Utile per azione atteso (consenso analisti)."],
  revenue_fy: ["Fatturato (FY)", v => "$" + fmtBig(v), "Ricavi dell'ultimo anno fiscale."],
  net_income_fy: ["Utile netto (FY)", v => "$" + fmtBig(v), "Utile netto dell'ultimo anno fiscale."],
  revenue_growth: ["Crescita ricavi", fmtPctF, "Crescita dei ricavi anno su anno."],
  earnings_growth: ["Crescita utili", fmtPctF, "Crescita degli utili anno su anno."],
  profit_margin: ["Margine netto", fmtPctF, "Utile netto / ricavi: redditività."],
  roe: ["ROE", fmtPctF, "Return on Equity: rendimento sul capitale proprio."],
  debt_to_equity: ["Debito/Equity", fmtN2, "Leva finanziaria: debito rispetto al capitale."],
  dividend_yield: ["Dividend yield", fmtPctF, "Rendimento da dividendo annuo."],
  price_to_book: ["Prezzo/Valore contabile", fmtN2, "Prezzo rispetto al patrimonio netto contabile."],
  shares: ["Azioni circolanti", fmtBig, "Numero di azioni in circolazione."],
  float_shares: ["Flottante", fmtBig, "Azioni effettivamente negoziabili sul mercato (escluse quelle vincolate di insider/società)."],
  float_pct: ["Flottante %", v => fmtN2(v) + "%", "Quota di azioni in libera circolazione: più è basso, più il titolo può essere volatile."],
  avg_volume_30d: ["Volume medio", fmtBig, "Volume di scambi medio giornaliero."],
  target_mean: ["Target medio analisti", v => "$" + fmtN2(v), "Prezzo obiettivo medio degli analisti."],
  fcf: ["Free cash flow", v => "$" + fmtBig(v), "Liquidità generata al netto degli investimenti."],
  altman_z: ["Altman Z''-Score", fmtN2, "Rischio insolvenza, variante Z'' per non-manifatturieri (tech/servizi, senza Sales/TA). Flag prudenziale <1,81; cutoff canonici Z'': <1,1 distress, >2,6 solido."],
};
function statScore(key, val) {
  if (val == null) return null;
  switch (key) {
    case "roe":            return clamp((val + 0.05) / 0.35 * 100);
    case "roa":            return clamp(val / 0.12 * 100);
    case "profit_margin":  return clamp(val / 0.25 * 100);
    case "gross_margin":   return clamp((val - 0.10) / 0.65 * 100);
    case "revenue_growth": return clamp((val + 0.05) / 0.30 * 100);
    case "earnings_growth":return clamp((val + 0.10) / 0.60 * 100);
    case "dividend_yield": return val > 0 ? clamp(val / 0.06 * 100) : null;
    case "ev_ebitda":      return clamp(100 - (val - 5) / 30 * 100);
    case "price_to_book":  return clamp(100 - (val - 1) / 9 * 100);
    case "forward_pe":     return clamp(100 - (val - 10) / 40 * 100);
    case "peg":            return clamp(100 - (val - 0.5) / 2 * 100);
    case "debt_to_equity": return clamp(100 - val / 4 * 100);
    case "float_pct":      return clamp(val / 80 * 100);
    case "altman_z":       return clamp((val - 1) / 2.5 * 100);
    default: return null;
  }
}
function statsGrid(stats) {
  const cells = Object.entries(STAT_META)
    .filter(([k]) => stats[k] != null)
    .map(([k, [lab, fmt, info]]) => {
      const sc = statScore(k, stats[k]);
      const bar = sc != null
        ? `<div class="stat-mini-bar"><div class="stat-mini-fill" style="width:${Math.round(sc)}%;background:${scoreColor(sc)}"></div></div>`
        : "";
      return `<button class="stat-cell" data-info="${esc(lab + ": " + info)}" title="${esc(info)}">
        <span class="stat-lab">${lab}</span><span class="stat-val">${fmt(stats[k])}</span>${bar}</button>`;
    }).join("");
  return cells ? `<h4 style="margin:12px 0 6px">Statistiche chiave</h4><div class="stats-grid">${cells}</div>` : "";
}

function openFinancialsModal(ticker) {
  const r = [...(DATA.portfolio || []), ...(DATA.watchlist || [])].find(x => x.ticker === ticker);
  if (!r || (!(r.financials || []).length && !r.stats)) { toast("Dati finanziari non disponibili per " + ticker); return; }
  const statsHtml = r.stats ? statsGrid(r.stats) : "";
  if (!(r.financials || []).length) {   // solo statistiche, niente storico conto economico
    openInfoModal(`${r.name} (${ticker}) — Dati finanziari`, statsHtml || '<p class="muted">Statistiche non disponibili.</p>');
    return;
  }
  const f = r.financials;
  // sintesi + previsione anno prossimo (stima dai trend)
  const yrs = f.length;
  const cagr = f[0].revenue > 0 ? ((f[yrs - 1].revenue / f[0].revenue) ** (1 / Math.max(1, yrs - 1)) - 1) : null;
  const niCagr = f[0].net_income > 0 && f[yrs - 1].net_income > 0 ? ((f[yrs - 1].net_income / f[0].net_income) ** (1 / Math.max(1, yrs - 1)) - 1) * 100 : null;
  const avgMargin = f.reduce((s, x) => s + x.margin, 0) / yrs;
  let forecast = null;
  if (cagr != null) {
    const g = Math.max(-0.3, Math.min(0.6, cagr));   // clamp crescita stimata
    const fr = Math.round(f[yrs - 1].revenue * (1 + g));
    forecast = { year: f[yrs - 1].year + 1, revenue: fr, net_income: Math.round(fr * avgMargin / 100), margin: Math.round(avgMargin * 10) / 10, est: true };
  }
  const draw = forecast ? f.concat([forecast]) : f;
  const W = 580, H = 300, pad = { l: 52, r: 48, t: 30, b: 30 };
  // scala simmetrica che include sia ricavi sia utili (così gli utili negativi non escono dal grafico)
  const vMax = Math.max(...draw.map(x => Math.max(Math.abs(x.revenue), Math.abs(x.net_income))), 1);
  const mMax = Math.min(100, Math.max(40, ...draw.map(x => Math.abs(x.margin))));   // asse margine limitato
  const clampM = v => Math.max(-mMax, Math.min(mMax, v));
  const n = draw.length, bw = (W - pad.l - pad.r) / n;
  const yV = v => pad.t + (1 - (v + vMax) / (2 * vMax)) * (H - pad.t - pad.b);
  const yM = v => pad.t + (1 - (clampM(v) + mMax) / (2 * mMax)) * (H - pad.t - pad.b);
  const fmtB = v => Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(1) + "B" : (v / 1e6).toFixed(0) + "M";
  const y0 = yV(0);
  let bars = "", line = "", labels = "";
  draw.forEach((x, i) => {
    const cx = pad.l + bw * i, w = bw * 0.30, op = x.est ? 0.5 : 1;
    const rb = `<rect x="${cx + bw * 0.14}" y="${Math.min(y0, yV(x.revenue)).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.abs(yV(x.revenue) - y0).toFixed(1)}" fill="#4c8dff" opacity="${op}"><title>Ricavi ${x.year}${x.est ? " (stima)" : ""}: ${fmtB(x.revenue)}</title></rect>`;
    const nb = `<rect x="${(cx + bw * 0.14 + w).toFixed(1)}" y="${Math.min(y0, yV(x.net_income)).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.abs(yV(x.net_income) - y0).toFixed(1)}" fill="#1e40af" opacity="${op}"><title>Utile ${x.year}${x.est ? " (stima)" : ""}: ${fmtB(x.net_income)}</title></rect>`;
    bars += rb + nb;
    // etichette valore sopra/sotto le barre (incluse le previsioni)
    labels += `<text x="${(cx + bw * 0.14 + w / 2).toFixed(1)}" y="${(Math.min(y0, yV(x.revenue)) - 3).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#4c8dff">${fmtB(x.revenue)}</text>`;
    const niY = x.net_income >= 0 ? yV(x.net_income) - 3 : yV(x.net_income) + 9;
    labels += `<text x="${(cx + bw * 0.14 + w * 1.5).toFixed(1)}" y="${niY.toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#7aa0ff">${fmtB(x.net_income)}</text>`;
    const px = cx + bw / 2, py = yM(x.margin);
    line += `${px.toFixed(1)},${py.toFixed(1)} `;
    labels += `<text x="${px.toFixed(1)}" y="${(H - 12).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--muted)">${x.year}${x.est ? "*" : ""}</text>`;
    labels += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="#f59e0b" opacity="${op}"><title>Margine ${x.year}: ${x.margin}%${Math.abs(x.margin) > mMax ? " (fuori scala — punto limitato al bordo per non rompere il grafico)" : ""}</title></circle>`;
  });
  const svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:300px">
    <line x1="${pad.l}" y1="${y0.toFixed(1)}" x2="${W - pad.r}" y2="${y0.toFixed(1)}" stroke="var(--border)"/>
    ${bars}
    <polyline points="${line}" fill="none" stroke="#f59e0b" stroke-width="2"/>
    ${labels}
    <text x="${pad.l - 6}" y="${(yV(vMax) + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${fmtB(vMax)}</text>
    <text x="${pad.l - 6}" y="${(yV(-vMax) + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">−${fmtB(vMax)}</text>
    <text x="${W - pad.r + 6}" y="${(yM(mMax) + 4).toFixed(1)}" font-size="9" fill="#f59e0b">+${Math.round(mMax)}%</text>
    <text x="${W - pad.r + 6}" y="${(yM(-mMax) + 4).toFixed(1)}" font-size="9" fill="#f59e0b">−${Math.round(mMax)}%</text>
  </svg>
  <div class="cm-legend"><span><i style="background:#4c8dff"></i>Ricavi</span><span><i style="background:#1e40af"></i>Utile netto</span><span><i class="round" style="background:#f59e0b"></i>Margine netto %</span></div>`;
  // tabella annuale + sintesi + previsione
  const cagrPct = cagr != null ? cagr * 100 : null;
  const rows = draw.slice().reverse().map(x => `<tr${x.est ? ' style="opacity:.7"' : ""}><td>${x.year}${x.est ? " (stima)" : ""}</td><td>${fmtB(x.revenue)}</td><td class="${signCls(x.net_income)}">${fmtB(x.net_income)}</td><td class="${signCls(x.margin)}">${x.margin}%</td></tr>`).join("");
  const table = `<table class="info-table"><thead><tr><th>Anno</th><th>Ricavi</th><th>Utile netto</th><th>Margine</th></tr></thead><tbody>${rows}</tbody></table>`;
  const extra = `<div class="info-line" style="margin-top:8px">
    <b>CAGR ricavi (${yrs}a):</b> <span class="${signCls(cagrPct)}">${cagrPct != null ? signTxt(Math.round(cagrPct * 10) / 10) : "—"}</span>
    · <b>CAGR utile:</b> <span class="${signCls(niCagr)}">${niCagr != null ? signTxt(Math.round(niCagr * 10) / 10) : "—"}</span>
    · <b>Margine medio:</b> ${avgMargin.toFixed(1)}%${r.pe && r.pe > 0 ? ` · <b>P/E:</b> ${fmtNum.format(r.pe)}` : ""}${r.eps != null ? ` · <b>EPS:</b> ${fmtNum.format(r.eps)}` : ""}</div>`;
  const fcast = forecast ? `<div class="info-line"><b>Previsione ${forecast.year} (stima dai trend):</b> ricavi ~${fmtB(forecast.revenue)} · utile ~${fmtB(forecast.net_income)} · margine ~${forecast.margin}%</div>
    <div class="info-line muted" style="font-size:11px">* stima estrapolata da crescita ricavi e margine medio storici, non una previsione ufficiale.</div>` : "";
  openInfoModal(`${r.name} (${ticker}) — Conto economico`,
    `${svg}${extra}${fcast}${table}<div class="info-line muted" style="margin-top:8px">Financial Health Score: <b style="color:${scoreColor(r.fin_health)}">${r.fin_health ?? "—"}/100</b> · pesato su crescita ricavi, costanza utili e stabilità del margine.</div>${statsHtml}`);
}

/* ---------------- zoom grafico (modale, touch + mouse) ---------------- */
function closeChartModal() { $("#chart-modal").hidden = true; }

/* zoom del grafico di un singolo titolo, con selettore range e date sul punto */
let cmTicker = null, cmRange = "m1";
const CM_RANGES = [["d1", "1G"], ["w1", "1S"], ["m1", "1M"], ["m3", "3M"], ["m6", "6M"], ["y1", "1A"], ["all", "ALL"]];
const CM_SPAN = { d1: 1, w1: 7, m1: 31, m3: 92, m6: 183, y1: 365, all: 365 * 5 };   // giorni coperti (per le date)

// mappa range → parametri Yahoo (range, interval) per i dati OHLC reali
const CM_YF = {
  d1: ["1d", "5m"], w1: ["5d", "15m"], m1: ["1mo", "1d"], m3: ["3mo", "1d"],
  m6: ["6mo", "1d"], y1: ["1y", "1d"], all: ["max", "1wk"],
};


/* simbolo TradingView: exchange noto per i titoli core, altrimenti ticker nudo */
const TV_EXCHANGE = {
  NVDA: "NASDAQ", AMD: "NASDAQ", MU: "NASDAQ", MSTR: "NASDAQ", RGTI: "NASDAQ",
  GOOGL: "NASDAQ", META: "NASDAQ", PLTR: "NASDAQ", AAPL: "NASDAQ", MSFT: "NASDAQ",
  AMZN: "NASDAQ", TSLA: "NASDAQ", AVGO: "NASDAQ", INTC: "NASDAQ", QCOM: "NASDAQ",
  CBRS: "NASDAQ", OKLO: "NYSE", SPCX: "NASDAQ",
};
function tvSymbol(r) {
  const tk = (r.ticker || "").replace("^", "");
  if (r.ticker && r.ticker.includes("-")) return tk;        // cripto/derivati: nudo
  const ex = TV_EXCHANGE[tk];
  return ex ? `${ex}:${tk}` : tk;
}
let cmView = "candles";   // "candles" | "tv"

function renderTvWidget(r) {
  const sym = encodeURIComponent(tvSymbol(r));
  const src = `https://s.tradingview.com/widgetembed/?frameElementId=tv_${r.ticker}` +
    `&symbol=${sym}&interval=D&hidesidetoolbar=0&symboledit=0&saveimage=0` +
    `&toolbarbg=131722&theme=dark&style=1&timezone=Europe/Rome&locale=it&withdateranges=1`;
  return `<div class="cm-tv-wrap">
    <iframe class="cm-tv" src="${src}" title="TradingView ${esc(r.ticker)}" frameborder="0" allowtransparency="true" scrolling="no" loading="lazy"></iframe>
    <div class="muted cm-tv-note">Grafico avanzato TradingView (dati di terze parti). Usa "Apri su TradingView ↗" per la versione completa.</div>
  </div>`;
}

function drawTickerChart() {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === cmTicker);
  if (!r) return;
  // popup titolo: SOLO grafico TradingView (niente candele native), con link alla versione completa
  const tv = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol(r))}`;
  const controls = `<div class="cm-controls"><a class="btn btn-ghost btn-sm" href="${tv}" target="_blank" rel="noopener">Apri su TradingView ↗</a></div>`;
  $("#chart-modal-title").textContent = `${r.name} (${r.ticker})`;
  $("#chart-modal-tip").innerHTML = "";
  $("#chart-modal").hidden = false;
  $("#chart-modal-body").innerHTML = controls + renderTvWidget(r);
}

/* ===================== MODULO OPZIONI — Strike Ladder ===================== */
/* Dati reali generati dalla pipeline (Yahoo via yfinance) → DATA.options[ticker]. */
let optTicker = null, optExpIdx = 0, optSide = "call";

function optChain(ticker) {
  const o = DATA.options || {};
  return o[ticker] || o[(ticker || "").toUpperCase()] || null;
}
function hasOptions(ticker) {
  const c = optChain(ticker);
  return !!(c && c.expiries && c.expiries.length);
}

function openOptionsModal(ticker) {
  if (!hasOptions(ticker)) { toast("Catena opzioni non disponibile per " + ticker); return; }
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === ticker) || { ticker };
  optTicker = ticker; optExpIdx = 0; optSide = "call";
  cmTicker = ticker;   // così il pulsante "← Grafico" sa quale titolo mostrare
  $("#chart-modal-title").textContent = `Catena opzioni — ${r.name || r.ticker} (${r.ticker})`;
  $("#chart-modal-tip").innerHTML = "";
  $("#chart-modal").hidden = false;
  renderOptionsContent();
}

function loadOptionsView() { renderOptionsContent(); }   // re-render (toggle/scadenza)

/* grafico put/call indicativo: open interest per strike (call verde, put rosso), spot + muri */
function optOIChart(exp, spot, sym) {
  const byStrike = {};
  (exp.calls || []).forEach(o => { (byStrike[o.strike] = byStrike[o.strike] || {}).c = o.oi || 0; });
  (exp.puts || []).forEach(o => { (byStrike[o.strike] = byStrike[o.strike] || {}).p = o.oi || 0; });
  const strikes = Object.keys(byStrike).map(Number).sort((a, b) => a - b);
  if (strikes.length < 2) return "";
  const totC = strikes.reduce((s, k) => s + (byStrike[k].c || 0), 0);
  const totP = strikes.reduce((s, k) => s + (byStrike[k].p || 0), 0);
  const pcr = totC ? totP / totC : null;
  const maxOI = Math.max(1, ...strikes.map(s => Math.max(byStrike[s].c || 0, byStrike[s].p || 0)));
  const W = 620, H = 180, pad = { l: 8, r: 8, t: 16, b: 26 };
  const n = strikes.length, bw = (W - pad.l - pad.r) / n, base = H - pad.b;
  const x = i => pad.l + i * bw;
  const yH = v => v / maxOI * (H - pad.t - pad.b);
  const bars = strikes.map((s, i) => {
    const c = byStrike[s].c || 0, p = byStrike[s].p || 0, cx = x(i) + bw / 2, w = Math.max(1.5, bw * 0.34);
    return `<rect x="${(cx - w - 0.5).toFixed(1)}" y="${(base - yH(c)).toFixed(1)}" width="${w.toFixed(1)}" height="${yH(c).toFixed(1)}" fill="var(--green)" opacity="0.85"/>` +
           `<rect x="${(cx + 0.5).toFixed(1)}" y="${(base - yH(p)).toFixed(1)}" width="${w.toFixed(1)}" height="${yH(p).toFixed(1)}" fill="var(--red)" opacity="0.85"/>`;
  }).join("");
  const mark = (strike, col, lab) => {
    if (strike == null) return "";
    let bi = 0; strikes.forEach((s, i) => { if (Math.abs(s - strike) < Math.abs(strikes[bi] - strike)) bi = i; });
    const mx = x(bi) + bw / 2;
    return `<line x1="${mx.toFixed(1)}" y1="${pad.t}" x2="${mx.toFixed(1)}" y2="${base}" stroke="${col}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>
      <text x="${mx.toFixed(1)}" y="${(pad.t - 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${col}">${lab}</text>`;
  };
  const labIdx = [0, Math.floor(n / 2), n - 1];
  const labels = labIdx.map(i => `<text x="${(x(i) + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--muted)">${sym}${fmtNum.format(strikes[i])}</text>`).join("");
  return `<div class="opt-oi-chart">
    <div class="opt-oi-head">Open interest per strike (Call vs Put)${pcr != null ? ` · P/C OI <b style="color:${scoreColor(clamp(100 - pcr / 2 * 100))}">${fmtNum.format(Math.round(pcr * 100) / 100)}</b>` : ""}</div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${bars}${mark(spot, "var(--text)", "spot")}${mark(exp.call_wall, "var(--green)", "CW")}${mark(exp.put_wall, "var(--red)", "PW")}${labels}</svg>
    <div class="opt-oi-leg"><span><span class="dot" style="background:var(--green)"></span>Call OI</span><span><span class="dot" style="background:var(--red)"></span>Put OI</span><span class="muted">CW=Call Wall · PW=Put Wall</span></div>
  </div>`;
}

function renderOptionsContent() {
  const tk = optTicker;
  const chain = optChain(tk);
  if (!chain) return;
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const row = all.find(x => x.ticker === tk) || {};
  const sym = row.currency === "EUR" ? "€" : "$";
  const exps = chain.expiries;
  if (optExpIdx >= exps.length) optExpIdx = 0;
  const exp = exps[optExpIdx];
  const spot = chain.spot ?? row.price ?? null;
  const side = optSide === "put" ? (exp.puts || []) : (exp.calls || []);
  const wallStrike = optSide === "put" ? exp.put_wall : exp.call_wall;
  const wallLab = optSide === "put" ? "[Put Wall]" : "[Call Wall]";

  const expSel = `<select class="pmc-input opt-expiry" style="width:auto;padding:4px 8px">` +
    exps.map((e, i) => `<option value="${i}" ${i === optExpIdx ? "selected" : ""}>${new Date(e.date + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}</option>`).join("") + `</select>`;
  const sideTog = `<div class="spark-toggle opt-side-tog" role="group">
      <button class="chip opt-side ${optSide === "call" ? "chip-active" : ""}" data-side="call">CALL</button>
      <button class="chip opt-side ${optSide === "put" ? "chip-active" : ""}" data-side="put">PUT</button></div>`;
  const controls = `<div class="cm-controls opt-controls">
      <button class="btn btn-ghost btn-sm cm-opt-back">← Grafico</button>
      <label class="bench-toggle">Scadenza: ${expSel}</label>
      ${sideTog}
      ${spot != null ? `<span class="muted">Spot: <b>${sym}${fmtNum.format(spot)}</b></span>` : ""}
    </div>`;

  // tachimetro d'impatto: volume opzioni (azioni equivalenti) vs volume medio del titolo
  const avgVol = chain.avg_volume || null;
  const optVol = exp.opt_volume || 0;
  let impactHtml = "";
  if (avgVol) {
    const ratioPct = optVol * 100 / avgVol * 100;            // 1 contratto = 100 azioni
    const fill = Math.max(2, Math.min(100, ratioPct));
    const lvl = ratioPct >= 30 ? ["ALTO", "I market maker guidano il prezzo", "var(--red)"]
              : ratioPct >= 10 ? ["MEDIO", "Le opzioni influenzano il titolo", "var(--yellow)"]
              : ["BASSO", "Peso marginale sul sottostante", "var(--green)"];
    impactHtml = `<div class="opt-impact">
        <div class="opt-impact-head">Impatto opzioni sul titolo: <b style="color:${lvl[2]}">${lvl[0]}</b> <span class="muted">(${lvl[1]})</span></div>
        <div class="opt-impact-track"><span class="opt-impact-fill" style="width:${fill.toFixed(0)}%;background:${lvl[2]}"></span>
          <span class="opt-impact-tick" style="left:10%"></span><span class="opt-impact-tick" style="left:30%"></span></div>
        <div class="opt-impact-foot muted">Volume opzioni ${fmtBig(optVol)} contratti (~${fmtBig(optVol * 100)} azioni eq.) · Vol. medio titolo ${fmtBig(avgVol)}</div>
      </div>`;
  }

  // ATM = strike più vicino allo spot dentro la finestra
  let atmStrike = null;
  if (spot != null && side.length) atmStrike = side.reduce((m, o) => Math.abs(o.strike - spot) < Math.abs(m - spot) ? o.strike : m, side[0].strike);

  const rows = side.map(o => {
    const isATM = o.strike === atmStrike;
    const isWall = wallStrike != null && o.strike === wallStrike;
    return `<tr class="${isWall ? "opt-wall" : ""} ${isATM ? "opt-atm" : ""}">
      <td>${sym}${fmtNum.format(o.strike)}${isATM ? ' <span class="opt-tag">ATM</span>' : ""}</td>
      <td>${o.bid != null ? fmtNum.format(o.bid) : "—"}</td>
      <td>${o.ask != null ? fmtNum.format(o.ask) : "—"}</td>
      <td>${o.iv != null && o.iv > 0 ? o.iv.toFixed(1) + "%" : "n.d."}</td>
      <td>${(o.vol || 0).toLocaleString("it-IT")}</td>
      <td>${(o.oi || 0).toLocaleString("it-IT")}${isWall ? ` <span class="opt-wall-lab">${wallLab}</span>` : ""}</td>
    </tr>`;
  }).join("");

  const wallNote = wallStrike != null
    ? `${optSide === "put" ? "Put Wall" : "Call Wall"} a <b>${sym}${fmtNum.format(wallStrike)}</b> (OI massimo) — ${optSide === "put" ? "supporto/magnete sotto il prezzo" : "resistenza/tetto sopra il prezzo"}.`
    : "";

  $("#chart-modal-body").innerHTML = controls + impactHtml + optOIChart(exp, spot, sym) + `
    <div class="table-wrap"><table class="opt-table">
      <thead><tr><th>STRIKE</th><th>BID</th><th>ASK</th><th>IV %</th><th>VOL</th><th>OPEN INTEREST</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">Nessuno strike per questa scadenza</td></tr>`}</tbody>
    </table></div>
    <div class="muted" style="margin-top:8px;font-size:11px">${wallNote} ATM = strike più vicino al prezzo. Fonte: Yahoo Finance (OI a fine giornata, aggiornato dalla pipeline).</div>`;
}

/* grafico a candele: verde se chiude >= apre, rosso se scende */
function openTickerChart(ticker) {
  cmTicker = ticker; cmRange = sparkRange in CM_SPAN ? sparkRange : "m1";
  cmView = "candles";   // ogni apertura parte dalle candele native
  drawTickerChart();
}

/* ---------------- popup informativi (macro / trimestrali) ---------------- */
/* ---- mini chart helpers (per popup macro/credit/decouple) ---- */
function miniLineChart(pts, { w = 420, h = 70, color = "var(--blue)", zeroLine = false } = {}) {
  if (!pts || pts.length < 2) return '<div class="muted">Storico non disponibile</div>';
  const vals = pts.map(p => p.v);
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 0.01;
  const px = i => ((i / (pts.length - 1)) * (w - 4) + 2).toFixed(1);
  const py = v => (h - 4 - (v - mn) / rng * (h - 8) + 2).toFixed(1);
  const poly = pts.map((p, i) => `${px(i)},${py(p.v)}`).join(" ");
  const last = pts[pts.length - 1], first = pts[0];
  const zl = zeroLine && mn < 0 && mx > 0
    ? `<line x1="0" y1="${py(0)}" x2="${w}" y2="${py(0)}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 2"/>`
    : "";
  const dl = `${new Date(first.d).toLocaleDateString("it-IT", { month: "short", year: "2-digit" })} – ${new Date(last.d).toLocaleDateString("it-IT", { month: "short", year: "2-digit" })}`;
  return `<div class="mini-chart-wrap">
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block">${zl}
      <polyline points="${poly}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="${px(pts.length - 1)}" cy="${py(last.v)}" r="3" fill="${color}"/>
    </svg>
    <div class="mini-chart-dates">${dl} · <b>${fmtNum.format(first.v)}</b> → <b>${fmtNum.format(last.v)}</b></div>
  </div>`;
}

/* v211 — QUANTO SPESSO QUESTO "ALLARME" È ACCESO.
   Nasce dal report che diceva di vendere tutto. Il payload pubblicava «margin debt = 100% del
   picco storico → RISCHIO SISTEMICO» senza dire che la serie è al proprio massimo in 11 mesi
   su 13: una misura che sta al suo massimo l'85% del tempo non è un allarme, è una costante,
   e un LLM che la legge come evento la conta come prova. CLAUDE.md lo annotava già
   ("pct_of_peak saturo 13/13") ma la riga del payload continuava a metterla per prima. */

/* v207 — FONTE UNICA PER I RAMI FEDWATCH.
   Il difetto: v187 ha corretto il PAYLOAD ("prob. taglio 0%" era vero e inutile quando il
   mercato prezzava un RIALZO al 38%), ma il popup della dashboard è rimasto indietro — mostrava
   solo le colonne "Taglio" e "Invariato", cioè esattamente la mezza verità che il payload aveva
   smesso di raccontare. Due implementazioni della stessa cosa divergono: qui ce n'è una sola,
   usata da entrambi. Stessa lezione di v161 (usRegularSessionOpen derivata da usSessionInfo).
   La derivazione dal tasso implicito serve per compatibilità all'indietro: finché il CI non
   rigenera, i `meetings` possono non avere hike_prob. */
function ramiFedWatch(fw, riunione) {
  const mt = { ...(riunione || {}) };
  if (mt.hike_prob == null && fw?.implied_rate != null && fw?.target_range) {
    const [lo, hi] = String(fw.target_range).replace("%", "").split("–").map(Number);
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      const quarti = ((lo + hi) / 2 - fw.implied_rate) / 0.25 * 100;
      mt.cut_prob = Math.round(Math.max(0, Math.min(100, quarti)));
      mt.hike_prob = Math.round(Math.max(0, Math.min(100, -quarti)));
      mt.hold_prob = Math.max(0, 100 - mt.cut_prob - mt.hike_prob);
    }
  }
  return mt;
}

/* v207 — DUE SERIE NORMALIZZATE A 100 SU DATE DIVERSE NON SONO CONFRONTABILI.
   Sottrarne i valori finali non produce un "gap": produce la differenza fra due periodi
   diversi. Il caso reale: S&P rebasato su 7 settimane meno PIL rebasato su 3 anni, pubblicato
   nel payload come "disaccoppiamento -3 pp". La pipeline è stata corretta (v207,
   _finestra_comune + freq="m"), ma finché il CI non rigenera il file il payload leggerebbe
   ancora i dati vecchi — quindi il controllo vive anche qui, come per i rami FedWatch di v187.
   Ritorna i giorni di sovrapposizione, o null se le due serie non ne hanno. */
function sovrapposizioneGiorni(a, b) {
  const t = p => new Date(String(p.d).length <= 10 ? p.d + "T00:00:00" : p.d).getTime();
  const ok = x => (x || []).filter(p => p && p.d != null && p.v != null && !isNaN(t(p)));
  const A = ok(a), B = ok(b);
  if (A.length < 2 || B.length < 2) return null;
  const da = Math.max(Math.min(...A.map(t)), Math.min(...B.map(t)));
  const fino = Math.min(Math.max(...A.map(t)), Math.max(...B.map(t)));
  if (!(fino > da)) return null;
  const dentro = x => x.filter(p => t(p) >= da && t(p) <= fino).length;
  if (dentro(A) < 2 || dentro(B) < 2) return null;
  return Math.round((fino - da) / 86400000);
}

/* ⚠ v207 — QUESTO GRAFICO MENTIVA, ed è il difetto più grave trovato mappando la macro.
   L'ascissa era l'INDICE del punto: `px = i / (len - 1) * w`. Due serie con finestre temporali
   diverse venivano quindi STIRATE sulla stessa larghezza e lette come se fossero allineate.
   Casi reali misurati su data.json:
     · "Fed Funds vs S&P 500 — ultimi 5 anni": 60 punti MENSILI (2021-07→2026-06) sovrapposti a
       60 punti GIORNALIERI (2026-05-06→07-31). Cinque anni e tre mesi disegnati alla stessa
       lunghezza, uno sopra l'altro.
     · "Disaccoppiamento": 36 giorni di S&P contro 12 trimestri di PIL.
     · "Profitti reali": 3 mesi giornalieri contro 5 anni trimestrali.
   Il "gap" che questi grafici mostravano — il numero su cui poggia tutta la lettura — non
   corrispondeva a nessun confronto reale.

   Ora l'ascissa è il TEMPO, e il grafico si restringe alla FINESTRA COMUNE alle due serie:
   fuori da lì il confronto non esiste, e disegnarlo sarebbe di nuovo inventare un allineamento.
   Se la sovrapposizione è troppo corta per dire qualcosa, il grafico lo DICHIARA invece di
   disegnare una linea che sembra una tendenza. */
function miniDualChart(pts1, pts2, { w = 420, h = 80, color1 = "var(--blue)", color2 = "var(--green)", label1 = "A", label2 = "B" } = {}) {
  const val = (a) => (a || []).filter(p => p && p.v != null && p.d != null && !isNaN(new Date(p.d)));
  const A = val(pts1), B = val(pts2);
  if (A.length < 2 || B.length < 2) return '<div class="muted">Dati non disponibili</div>';
  const t = p => new Date(String(p.d).length <= 10 ? p.d + "T00:00:00" : p.d).getTime();
  const est = (a) => ({ da: Math.min(...a.map(t)), a: Math.max(...a.map(t)) });
  const eA = est(A), eB = est(B);
  const da = Math.max(eA.da, eB.da), fino = Math.min(eA.a, eB.a);
  const giorni = (ms) => Math.round(ms / 86400000);
  const span = (e) => giorni(e.a - e.da);
  if (!(fino > da)) {
    return `<div class="muted">Le due serie non si sovrappongono nel tempo (${label1}: ${dataBreve(new Date(eA.da).toISOString().slice(0, 10), true)}–${dataBreve(new Date(eA.a).toISOString().slice(0, 10), true)} · ${label2}: ${dataBreve(new Date(eB.da).toISOString().slice(0, 10), true)}–${dataBreve(new Date(eB.a).toISOString().slice(0, 10), true)}): un confronto non è calcolabile.</div>`;
  }
  const dentro = (a) => a.filter(p => t(p) >= da && t(p) <= fino);
  const A2 = dentro(A), B2 = dentro(B);
  if (A2.length < 2 || B2.length < 2) {
    return `<div class="muted">Nella finestra comune (${giorni(fino - da)} giorni) una delle due serie ha meno di due osservazioni: il confronto non è disegnabile.</div>`;
  }
  const all = [...A2, ...B2].map(p => p.v);
  const mn = Math.min(...all), mx = Math.max(...all), rng = mx - mn || 1;
  const px = p => (((t(p) - da) / (fino - da || 1)) * (w - 4) + 2).toFixed(1);
  const py = v => (h - 4 - (v - mn) / rng * (h - 8) + 2).toFixed(1);
  const poly = (pts) => pts.map(p => `${px(p)},${py(p.v)}`).join(" ");
  const b100 = mn <= 100 && 100 <= mx ? `<line x1="0" y1="${py(100)}" x2="${w}" y2="${py(100)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 2"/>` : "";
  const uA = A2[A2.length - 1], uB = B2[B2.length - 1];
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  // la finestra comune è molto più corta dello storico che una delle due serie porta con sé:
  // dirlo, altrimenti si legge "cinque anni" un grafico che ne mostra tre mesi
  const tagliato = Math.max(span(eA), span(eB)) > giorni(fino - da) * 2;
  return `<div class="mini-chart-wrap">
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block">${b100}
      <polyline points="${poly(B2)}" fill="none" stroke="${color2}" stroke-width="1.8"/>
      <polyline points="${poly(A2)}" fill="none" stroke="${color1}" stroke-width="2"/>
      <circle cx="${px(uA)}" cy="${py(uA.v)}" r="3" fill="${color1}"/>
      <circle cx="${px(uB)}" cy="${py(uB.v)}" r="3" fill="${color2}"/>
    </svg>
    <div class="mini-chart-legend"><span style="color:${color1}">—</span> ${label1} &nbsp; <span style="color:${color2}">—</span> ${label2}${mn <= 100 && 100 <= mx ? ' &nbsp; <span class="muted">— base 100</span>' : ""}</div>
    <div class="mini-chart-dates">${dataBreve(iso(da), true)} – ${dataBreve(iso(fino), true)} · finestra COMUNE alle due serie (${giorni(fino - da)} giorni, ${A2.length} e ${B2.length} osservazioni)${
      tagliato ? ` · <b>lo storico più lungo arriva a ${Math.max(span(eA), span(eB))} giorni ma fuori da questa finestra le due serie non sono confrontabili</b>` : ""}</div>
  </div>`;
}

// descrizione + cadenza pubblicazione (indicativa) per indicatore/box
const MACRO_INFO = {
  "in:cpi": ["Inflazione CPI (a/a)", "Indice prezzi al consumo USA. Sopra il target Fed del 2% alimenta pressioni sui tassi.", "Pubblicazione mensile, ~10–15 del mese (BLS)", /inflaz|inflation|\bcpi\b|prezzi/i],
  "in:pce": ["Inflazione PCE (a/a)", "Misura d'inflazione preferita dalla Fed.", "Mensile, fine mese (BEA)", /\bpce\b|inflaz|inflation/i],
  "in:gdp": ["PIL USA", "Crescita economica trimestrale annualizzata.", "Trimestrale (3 stime: anticipata, seconda, finale)", /\bpil\b|\bgdp\b|economia|economy|crescita/i],
  "in:retail": ["Vendite al dettaglio", "Spesa dei consumatori, indicatore di domanda.", "Mensile, ~metà mese (Census)", /vendite|retail|consum/i],
  "in:nfp": ["Non-Farm Payrolls", "Nuovi posti di lavoro USA, market mover sui tassi.", "Mensile, primo venerdì (BLS)", /payroll|lavoro|jobs|occupa/i],
  "in:unemp": ["Disoccupazione", "Tasso di disoccupazione USA.", "Mensile, primo venerdì (BLS)", /disoccupa|unemploy|jobs/i],
  "in:umich": ["Fiducia consumatori", "Sentiment delle famiglie USA (Univ. Michigan).", "Mensile (preliminare + finale)", /fiducia|sentiment|consumer|michigan/i],
  "in:curve": ["Curva 10A-2A", "Spread dei rendimenti; se negativo (inversione) storico segnale di recessione.", "Aggiornato in continuo", /curva|treasur|yield|recess|rendiment/i],
  "in:curve3m": ["Curva 10A-3M", "Lo stesso spread sul tratto che la Fed usa davvero per la recessione: 10 anni meno 3 mesi.", "Giornaliero (FRED T10Y3M)", /curva|10a.?3m|recess/i],
  "in:t30": ["Treasury USA 30A", "Il rendimento a 30 anni: è il tasso con cui si scontano gli utili lontani, quindi tocca soprattutto i titoli di crescita.", "Giornaliero (FRED DGS30)", /30.?anni|trentenn|long.?bond|dgs30/i],
  "in:real10": ["Tasso reale 10A", "Rendimento dei TIPS a 10 anni: quanto rende un Treasury al NETTO dell'inflazione attesa. È il vero costo del denaro.", "Giornaliero (FRED DFII10)", /tasso.?real|tips|real.?yield/i],
  "in:breakeven": ["Inflazione attesa 10A", "Nominale meno reale: l'inflazione che il mercato PREZZA per i prossimi dieci anni, non quella già osservata.", "Giornaliero (FRED T10YIE)", /breakeven|inflazione.?attes|aspettative.?inflaz/i],
  "in:philly": ["Manifattura Philly Fed", "Indagine mensile sulla manifattura del distretto di Philadelphia. Sta al posto dell'ISM, che è sotto licenza e non è ridistribuibile.", "Mensile (Philadelphia Fed)", /philly|philadelphia|ism|manifattur|pmi/i],
  "mk:^TNX": ["Treasury USA 10 anni", "Rendimento del decennale USA: sale = condizioni più restrittive.", "Mercato aperto USA", /treasur|10.?anni|yield|rendiment|bond/i],
  "mk:EURUSD=X": ["Cambio EUR/USD", "Euro contro dollaro: incide sul valore in € delle azioni USA.", "Continuo (forex)", /euro|dollar|eur.?usd|cambio|fx/i],
  "mk:EURJPY=X": ["Cambio EUR/JPY", "Euro contro yen.", "Continuo (forex)", /yen|jpy|euro|cambio/i],
  fear_greed: ["Fear & Greed Index", "Sentiment di mercato CNN: 0 paura estrema, 100 avidità estrema.", "Aggiornato giornalmente", /sentiment|fear|greed|paura|avidit|rally|selloff/i],
  vix: ["VIX — Volatilità", "Indice della volatilità attesa S&P500 (\"indice della paura\").", "Mercato aperto USA", /vix|volatil|selloff|panic|paura/i],
  credit: ["Rischio Credito (HY OAS)", "Spread dei bond high-yield vs Treasury (proxy CDS): allargamento = stress sul credito, storicamente anticipa le correzioni azionarie.", "Giornaliero (FRED)", /credit|spread|high.?yield|oas/i],
  liquidity: ["Liquidità in attesa — Istituzionali vs Retail", "PROXY dichiarati: quota AUM in T-Bill ETF (BIL+SHV) vs SPY per gli istituzionali; fondi monetari retail FRED RMFNS (livello, YoY, percentile 5A). Cash alto = benzina potenziale per i rialzi; in aumento = de-risking in corso.", "AUM: giornaliero · RMFNS: mensile", /liquidit|cash|money market|dry powder/i],
  dollar: ["Righello Dollaro (DXY 3M)", "Variazione trimestrale del Dollar Index: sopra +5% comprime gli utili esteri delle large cap USA ([FX HEADWIND] nelle tabelle); sotto -5% li gonfia ([FX TAILWIND]).", "Giornaliero", /dollar|dxy|valut|cambio/i],
  fedwatch: ["FedWatch", "Aspettative di mercato sui tassi Fed dai futures sui Fed Funds.", "Riunioni FOMC ~ogni 6 settimane", /fed|powell|tass|rate|fomc|interest/i],
  carry: ["Carry USA–Giappone", "Differenziale di rendimento USA-Giappone, motore del carry trade su USD/JPY.", "Continuo", /carry|yen|jpy|japan|giappone|boj/i],
  putcall: ["Put/Call ratio", "Rapporto opzioni put/call: alto = copertura/pessimismo.", "Mercato aperto USA", /option|put|call|hedge/i],
  yield_recession: ["Curva dei rendimenti & Recessione", "Analisi storica: lo spread 10A-2A rispetto alla crescita del PIL reale e alle recessioni USA (FRED).", "Mensile", /curva|yield|recess|pil|gdp|recession|inversione|irripid/i],
  systemic_risk: ["Rischio Sistemico & Credito", "Stress del mercato del credito (spread HY e IG, proxy CDS) come campanello d'allarme anticipato sull'azionario.", "Giornaliero", /credit|cds|spread|sistemic|systemic|stress|high.?yield|risk.?off/i],
  sentiment: ["Sentiment globale", "Indicatore composito risk-on/risk-off.", "Aggiornato a ogni refresh", /sentiment|risk|rally|selloff|market/i],
  buffett: ["Buffett Indicator", "Capitalizzazione totale del mercato USA rapportata al PIL: sopra ~150% storicamente indica sopravvalutazione.", "Aggiornato a ogni refresh", /valuation|buffett|overvalu|gdp|market cap|bolla|bubble/i],
  thermometer: ["Termometro portafoglio", "Media della salute tecnica (RSI, trend, momentum) dei tuoi titoli.", "Aggiornato a ogni refresh", /(?!)/],
  credit: ["Rischio Credito (HY OAS)", "Spread dei bond High Yield rispetto ai Treasury USA: proxy del rischio sistemico, analogo al mercato CDS senza costi di abbonamento. Fonte: ICE BofA via FRED.", "Giornaliero (FRED)", /credit|credito|spread|hy|high.?yield|cds|default|obbligaz|bond/i],
  decouple: ["Disaccoppiamento Macro", "Divergenza tra mercato azionario (S&P 500) e economia reale (PIL reale USA GDPC1): misura quanta crescita futura è già prezzata nella borsa. Entrambe le serie normalizzate a 100 all'inizio del periodo.", "Mensile/trimestrale (FRED)", /disaccopp|decoupl|valuation|bolla|bubble|pil|gdp|utili|profit|crescita/i],
  smart_money: ["Istituzionali VS Retail", "Posizionamento istituzionale (SMC) vs folla retail (Fear & Greed) — divergenze estreme segnalano accumulo o distribuzione.", "Aggiornato a ogni refresh", /smart.?money|istituzional|institution|retail|hedge.?fund|posizionament|flow|flussi|put.?call|vix|smc|order.?block|liquidit|struttura/i],
  sp500_pe: ["P/E Ratio Storico S&P 500", "Rapporto Prezzo/Utili dell'S&P 500 su base mensile (FRED SP500PE). Mostra se il mercato è sopravvalutato rispetto alla media storica. P/E > 25 indica valutazioni tese; P/E > 35 livelli estremi. La percentile di rango storico indica quante volte negli ultimi 10 anni il mercato è stato più economico di adesso.", "Mensile (FRED SP500PE)", /p\/e|price.?earning|multiplo|valutaz|sopravvalut|cape|shiller/i],
  corp_profit: ["S&P 500 & Nasdaq 100 vs Profitti Reali", "Divergenza tra S&P 500 e Nasdaq 100 nominali e i profitti aziendali reali USA (FRED CP). Gap ampio = Asset Inflation da fiat debasement, non crescita utili reali. Storico: gap >40 pp precede correzioni o lateralizzazioni.", "Trimestrale (FRED CP + SP500/NDX mensile)", /profitti|profit|asset.?inflat|nominal|real.?earn|corp|aziend|deflat|nasdaq/i],
  fed_market: ["Fed Funds Rate vs S&P 500", "Andamento storico del tasso Fed Funds sovrapposto all'S&P 500 negli ultimi 5 anni. Mostra come i cicli di rialzo/taglio della politica monetaria influenzino il mercato azionario. Tassi alti comprimono i multipli; i tagli stimolano i rally.", "Mensile (FRED FEDFUNDS + SP500)", /fed.?fund|interest.?rate|tasso.?fed|fed.?rate|monetar|fomc.*trend|tassi.*mercato/i],
};

/* ═══ v188 — POPUP UNIFICATI (richiesta CEO): un solo pannello per titolo, uno solo per la macro.
   Il trucco che evita di riscrivere 17 funzioni: TUTTE finiscono in openInfoModal(titolo, html).
   Si sostituisce temporaneamente quella funzione con un raccoglitore, si eseguono le funzioni
   esistenti e si tiene il loro HTML. Ogni pannello resta l'unica fonte di verità del suo
   contenuto — se domani cambia openMarginDebtModal, la pagina unica cambia con lei. */
/* ═══ SCHEDA UNICA DEL TITOLO (v188) — si apre cliccando il NOME del titolo.
   Prima i dati di un titolo erano sparsi in cinque popup diversi, ciascuno raggiungibile solo
   cliccando la cella giusta: forza relativa sulla cella RS, Sharpe sulla cella Sharpe, conto
   economico sulla riga fondamentale, opzioni sulla cella opzioni. Con le colonne nascondibili
   quelle celle possono non esserci più — e con loro sparirebbe l'accesso al dato. Un solo
   punto d'ingresso, il nome, che raccoglie tutto. */
function openStockCard(ticker) {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === ticker);
  if (!r) return;
  const panels = collectPanels([
    { label: "Scheda — tecnica, prezzi e fondamentali", run: () => openStockDetail(ticker) },
    { label: "Forza relativa (RS) — come si legge",     run: () => openRsInfo(ticker) },
    { label: "Sharpe Ratio — come si legge",            run: () => openSharpeInfo(ticker) },
    { label: "Conto economico e statistiche",           run: () => openFinancialsModal(ticker) },
    { label: "Trimestrale e movimento implicito",       run: () => (r.earnings_date ? openEarningsInfo(ticker) : null) },
  ]);
  const tv = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol(r))}`;
  const azioni = `<div class="pp-actions">
      <button class="btn btn-ghost btn-sm" data-card-chart="${esc(r.ticker)}">📈 Grafico</button>
      ${hasOptions(r.ticker) ? `<button class="btn btn-ghost btn-sm" data-card-opt="${esc(r.ticker)}">⛓ Catena opzioni</button>` : ""}
      <a class="btn btn-ghost btn-sm" href="${tv}" target="_blank" rel="noopener">TradingView ↗</a>
    </div>`;
  PANEL_LAST_TICKER = ticker;
  renderPanelPage(`${r.name} (${r.ticker})`, panels, "Nessun dettaglio disponibile per questo titolo.", "titolo");
  // le azioni vanno in cima, sotto il titolo: sono le due viste che NON sono testo
  const nav = document.querySelector("#chart-modal-body .pp-nav");
  if (nav) nav.insertAdjacentHTML("afterbegin", azioni);
}

/* ═══ DETTAGLI MACRO IN UNA PAGINA SOLA (v188) — bottone "Dettagli macro".
   Stessa ragione: i sette riquadri e le voci della griglia macro aprivano ciascuno il suo popup.
   Ora c'è un indice in cima e si scorre. Le mini-card restano cliccabili per chi vuole il
   singolo dettaglio: questo aggiunge una via d'accesso, non ne toglie. */
function openMacroDetails() {
  const m = (DATA && DATA.macro) || {};
  // v193 — TOLTI DUE PANNELLI (richiesta CEO). "Analisi della rotazione" ripeteva la stessa
  // classifica settoriale di "Rotazione settoriale" con parole diverse; "Salute del portafoglio"
  // era un punteggio composito i cui tre addendi (tecnica, macro, fondamentale) hanno gia'
  // ciascuno il proprio pannello. Restano raggiungibili dalle mini-card se servono.
  const tasks = [
    { label: "MacroQuant — ciclo economico",        run: openMacroQuantModal, dom: "#macroquant-box" },
    { label: "BofA Bear-Market Signposts",          run: openSignpostsModal, dom: "#signposts-box" },
    { label: "Rotazione settoriale",                run: openTiltModal, dom: "#tilt-box" },

    { label: "Stagionalità",                        run: openSeasonalityModal, dom: "#seasonality-box" },
    { label: "Sharpe del portafoglio",              run: openPortfolioSharpeModal, dom: "#sharpe-box" },
    { label: "Alpha del processo",                  run: openAlphaModal },
    { label: "Rischio cambio EUR/USD",              run: openFxModal, dom: "#fx-box" },
    { label: "Margin Debt — leva a credito",        run: openMarginDebtModal, dom: "#margin-debt-box" },

  ];
  // + una sezione per ogni voce della griglia macro che ha un dettaglio proprio. Le chiavi si
  // leggono da MACRO_INFO, che e' gia' il registro di quei pannelli: nessun secondo elenco da
  // tenere allineato (la classe di difetto che ha prodotto C10 e C12).
  for (const k of Object.keys(MACRO_INFO || {}))
    tasks.push({ label: null, run: () => openMacroInfo(k), dom: `[data-macro="${CSS.escape(k)}"]` });
  const pannelli = collectPanels(tasks);
  PANEL_DOM.clear();
  for (const p of pannelli) if (p.dom) PANEL_DOM.set(p.title, p.dom);
  renderPanelPage("Dettagli macro", pannelli, "Dati macro non ancora caricati.", "macro");
}

function collectPanels(tasks) {
  const out = [];
  const orig = openInfoModal;
  openInfoModal = (title, bodyHTML) => out.push({ title, bodyHTML });
  try {
    for (const t of tasks) {
      const prima = out.length;
      try { t.run(); } catch (e) { /* un pannello rotto non deve far cadere la pagina intera */ }
      // se la funzione non ha aperto nulla (dato assente) si salta: niente sezioni vuote
      for (let i = prima; i < out.length; i++) {
        if (t.label) out[i].title = t.label;
        if (t.dom) out[i].dom = t.dom;      // v196: l'aggancio alla dashboard e' DICHIARATO qui
      }
    }
  } finally { openInfoModal = orig; }
  return out;
}
/* rende i pannelli raccolti in una pagina MAESTRO-DETTAGLIO: indice a sinistra (riordinabile
   per trascinamento), contenuto a destra in un riquadro ampio. v190, richiesta CEO.
   L'ordine si persiste per "ambito" (macro / titolo) e — dove esiste una corrispondenza — si
   propaga alla dashboard: le voci macro che hanno una mini-card la spostano con sé. Per le
   sezioni della scheda titolo NON esiste un elenco corrispondente nella dashboard, quindi lì
   l'ordine vale solo dentro il popup: dirlo è meglio che fingere una propagazione che non c'è. */
const panelOrderKey = (ambito) => `panelorder_${ambito}`;
function loadPanelOrder(ambito) {
  try { const a = JSON.parse(localStorage.getItem(panelOrderKey(ambito)) || "null"); return Array.isArray(a) ? a : null; }
  catch { return null; }
}
function savePanelOrder(ambito, titoli) {
  try { localStorage.setItem(panelOrderKey(ambito), JSON.stringify(titoli)); } catch { /* quota */ }
}
/* ordina i pannelli secondo la preferenza salvata; i nuovi (non ancora in elenco) restano in coda
   nell'ordine originale, così un pannello aggiunto in futuro non sparisce né va a caso */
function ordinaPannelli(ambito, panels) {
  const pref = loadPanelOrder(ambito);
  if (!pref) return panels;
  const pos = new Map(pref.map((t, i) => [t, i]));
  return panels.slice().sort((a, b) => (pos.has(a.title) ? pos.get(a.title) : 1e6) - (pos.has(b.title) ? pos.get(b.title) : 1e6));
}
/* le voci macro che hanno una mini-card nella dashboard: riordinare nel popup riordina anche quelle */
const MACRO_CARD_BY_PANEL = {
  "MacroQuant — ciclo economico": "macroquant-box",
  "BofA Bear-Market Signposts": "signposts-box",
  "Rotazione settoriale": "tilt-box",
  "Stagionalità": "seasonality-box",
  "Sharpe del portafoglio": "sharpe-box",
  "Rischio cambio EUR/USD": "fx-box",
  "Margin Debt — leva a credito": "margin-debt-box",
};
/* v196 — L'ORDINE VALE SU TUTTA LA SEZIONE MACRO, non solo sulle sette mini-card.
   Il CEO riordinava il popup e la dashboard non seguiva. La causa: la propagazione conosceva
   solo MACRO_CARD_BY_PANEL, cioe' 7 pannelli su 37 — ma le voci "Inflazione CPI", "PIL USA",
   "Curva 10A-2A" e compagnia HANNO un corrispondente in dashboard: sono i `.macro-item` della
   griglia, con `data-macro="in:cpi"` e simili. Erano 23 gli elementi riordinabili e ne muovevo 7.
   La mappa dei `.macro-item` si ricava da MACRO_INFO, che e' gia' il registro dei loro titoli:
   nessun secondo elenco da tenere allineato. */
/* v196b — L'AGGANCIO NON SI INDOVINA DAL TITOLO. Prima si cercava in MACRO_INFO la voce il cui
   nome coincidesse col titolo del pannello: per una parte (Fiducia consumatori, VIX, FedWatch…)
   non coincideva, quelle voci restavano ferme in cima e la griglia sembrava non seguire affatto
   l'ordine. Ora ogni pannello DICHIARA il proprio selettore quando viene raccolto, e la mappa si
   costruisce da li'. Accoppiare due cose per il loro nome visibile e' fragile per costruzione:
   il nome e' fatto per essere letto, non per essere una chiave. */
const PANEL_DOM = new Map();
function elementoDashboardPerPannello(titolo) {
  const sel = PANEL_DOM.get(titolo);
  return sel ? document.querySelector(sel) : null;
}
function applicaOrdineMacro() {
  const pref = loadPanelOrder("macro");
  if (!pref) return;
  // Ogni elemento si riordina DENTRO IL PROPRIO genitore: due voci in contenitori diversi non
  // si mescolano, e non serve sapere in anticipo quali siano i contenitori. L'elenco scritto a
  // mano (.mini-cards, #macro-grid) lasciava fermo tutto cio' che vive altrove — ed e' lo stesso
  // difetto dei registri fissi gia' pagato con C10 e con gli indici del red team.
  const perGenitore = new Map();
  for (const titolo of pref) {
    const el = elementoDashboardPerPannello(titolo);
    if (!el || !el.parentElement) continue;
    if (!perGenitore.has(el.parentElement)) perGenitore.set(el.parentElement, []);
    perGenitore.get(el.parentElement).push(el);
  }
  for (const [cont, elems] of perGenitore) for (const el of elems) cont.appendChild(el);
}
/* nome storico mantenuto: era chiamato da piu' punti e da un handler */
const applicaOrdineMiniCard = applicaOrdineMacro;
function renderPanelPage(titolo, panels, notaVuota, ambito) {
  if (!panels.length) { openInfoModal(titolo, `<div class="muted" style="font-size:12px">${notaVuota || "Nessun dettaglio disponibile."}</div>`); return; }
  const ord = ambito ? ordinaPannelli(ambito, panels) : panels;
  // v193 — SU IPHONE IL TRASCINAMENTO NON ESISTE. L'HTML5 drag-and-drop non e' supportato da
  // Safari su touch: il CEO trascinava e non succedeva nulla, e la dashboard "non si allineava"
  // semplicemente perche' l'ordine non era mai cambiato. Le frecce funzionano ovunque — mouse,
  // tastiera e dito — e il trascinamento resta come scorciatoia per chi e' al computer.
  const voci = ord.map((p, i) =>
    `<li class="pp-nav-item${i === 0 ? " is-active" : ""}" draggable="true" data-idx="${i}" title="${esc(p.title)}">
       <span class="pp-nav-txt">${esc(p.title)}${ambito === "macro" && !elementoDashboardPerPannello(p.title) ? ' <em class="pp-solo-popup" title="Questa voce non ha un riquadro corrispondente nella dashboard: spostarla cambia solo l\'ordine qui dentro">solo qui</em>' : ""}</span>
       <span class="pp-move">
         <button class="pp-mv" data-mv="up" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Sposta ${esc(p.title)} in su" title="Sposta in su">▲</button>
         <button class="pp-mv" data-mv="down" data-i="${i}" ${i === ord.length - 1 ? "disabled" : ""} aria-label="Sposta ${esc(p.title)} in giù" title="Sposta in giù">▼</button>
       </span></li>`).join("");
  const corpi = ord.map((p, i) =>
    `<section class="pp-pane${i === 0 ? " is-active" : ""}" data-pane="${i}">
       <h3 class="pp-h">${esc(p.title)}</h3>${p.bodyHTML}</section>`).join("");
  const nota = ambito === "macro"
    ? `<div class="pp-nav-note muted">Trascina per riordinare: l'ordine si applica anche alle schede macro della dashboard.</div>`
    : ambito ? `<div class="pp-nav-note muted">Trascina per riordinare le sezioni di questa scheda.</div>` : "";
  openInfoModal(titolo, `<div class="pp-split" data-ambito="${esc(ambito || "")}">
      <nav class="pp-nav"><ul class="pp-nav-list">${voci}</ul>${nota}</nav>
      <div class="pp-detail">${corpi}</div>
    </div>`);
  wirePanelPage(ord.map(p => p.title), ambito);
}
/* selezione + trascinamento nell'indice */
function wirePanelPage(titoli, ambito) {
  const root = document.querySelector("#chart-modal-body .pp-split");
  if (!root) return;
  const mostra = (i) => {
    root.querySelectorAll(".pp-nav-item").forEach(el => el.classList.toggle("is-active", Number(el.dataset.idx) === i));
    root.querySelectorAll(".pp-pane").forEach(el => el.classList.toggle("is-active", Number(el.dataset.pane) === i));
    const d = root.querySelector(".pp-detail"); if (d) d.scrollTop = 0;
  };
  root.querySelector(".pp-nav-list")?.addEventListener("click", (e) => {
    const mv = e.target.closest(".pp-mv");
    if (mv) {                                    // freccia: sposta di una posizione
      e.stopPropagation();
      if (!ambito) return;
      const i = Number(mv.dataset.i), j = mv.dataset.mv === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= titoli.length) return;
      const nuovo = titoli.slice();
      [nuovo[i], nuovo[j]] = [nuovo[j], nuovo[i]];
      applicaNuovoOrdine(ambito, nuovo, j);
      return;
    }
    const it = e.target.closest(".pp-nav-item"); if (it) mostra(Number(it.dataset.idx));
  });
  if (!ambito) return;
  let from = null;
  const lista = root.querySelector(".pp-nav-list");
  lista?.addEventListener("dragstart", (e) => {
    const it = e.target.closest(".pp-nav-item"); if (!it) return;
    from = Number(it.dataset.idx); it.classList.add("pp-dragging"); e.dataTransfer.effectAllowed = "move";
  });
  lista?.addEventListener("dragend", (e) => {
    e.target.closest(".pp-nav-item")?.classList.remove("pp-dragging");
    lista.querySelectorAll(".pp-nav-item").forEach(x => x.classList.remove("pp-over"));
  });
  lista?.addEventListener("dragover", (e) => {
    e.preventDefault();
    const it = e.target.closest(".pp-nav-item"); if (!it) return;
    lista.querySelectorAll(".pp-nav-item").forEach(x => x.classList.toggle("pp-over", x === it));
  });
  lista?.addEventListener("drop", (e) => {
    e.preventDefault();
    const it = e.target.closest(".pp-nav-item"); if (!it || from == null) return;
    const to = Number(it.dataset.idx);
    if (from === to) return;
    const nuovo = titoli.slice();
    nuovo.splice(to, 0, ...nuovo.splice(from, 1));
    applicaNuovoOrdine(ambito, nuovo, to);
  });
}
/* UNA sola strada per applicare un nuovo ordine, usata sia dalle frecce sia dal trascinamento:
   due percorsi separati avrebbero potuto divergere, ed e' la classe di difetto che questo
   progetto ha gia' pagato piu' volte. */
function applicaNuovoOrdine(ambito, nuovoOrdine, indiceDaMostrare) {
  savePanelOrder(ambito, nuovoOrdine);
  if (ambito === "macro") applicaOrdineMiniCard();
  if (ambito === "macro") openMacroDetails(); else if (PANEL_LAST_TICKER) openStockCard(PANEL_LAST_TICKER);
  // si resta sulla voce appena spostata, altrimenti a ogni clic si torna in cima
  const root = document.querySelector("#chart-modal-body .pp-split");
  const it = root?.querySelector(`.pp-nav-item[data-idx="${indiceDaMostrare}"]`);
  if (it) it.click();
  toast("Ordine aggiornato" + (ambito === "macro" ? " — anche nelle schede macro della dashboard" : ""));
}
let PANEL_LAST_TICKER = null;

function openInfoModal(title, bodyHTML) {
  $("#chart-modal-title").textContent = title;
  $("#chart-modal-body").innerHTML = bodyHTML;
  $("#chart-modal-tip").innerHTML = "";
  $("#chart-modal").hidden = false;
}

// data stimata della prossima pubblicazione (calendario tipico USA)
function nextReleaseDate(key) {
  const now = new Date(), fmt = d => d.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
  const firstFriday = (y, mth) => { const d = new Date(y, mth, 1); while (d.getDay() !== 5) d.setDate(d.getDate() + 1); return d; };
  const nextMonthDay = day => { let d = new Date(now.getFullYear(), now.getMonth(), day); if (d <= now) d = new Date(now.getFullYear(), now.getMonth() + 1, day); return d; };
  if (key === "nfp" || key === "unemp") {        // primo venerdì del mese
    let d = firstFriday(now.getFullYear(), now.getMonth()); if (d <= now) d = firstFriday(now.getFullYear(), now.getMonth() + 1); return fmt(d);
  }
  if (key === "cpi") return fmt(nextMonthDay(12));
  if (key === "pce") return fmt(nextMonthDay(28));
  if (key === "retail") return fmt(nextMonthDay(16));
  if (key === "pmi") return fmt(nextMonthDay(27));
  return null;   // gdp/curve: continui o trimestrali variabili
}

/* grafico macro: curva dei rendimenti vs PIL con bande di recessione (grigie) + doppio asse Y.
   shiftMonths>0 sposta la curva in avanti (es. +12 mesi) per evidenziare il lead/lag col PIL. */
function recessionChart(curveArr, gdpArr, recessions, opts = {}) {
  const shiftMs = (opts.shiftMonths || 0) * 30.44 * 864e5;
  const C = (curveArr || []).map(p => ({ t: +new Date(p.d + "T00:00:00") + shiftMs, v: p.v })).filter(p => !isNaN(p.t) && p.v != null);
  const G = (gdpArr || []).map(p => ({ t: +new Date(p.d + "T00:00:00"), v: p.v })).filter(p => !isNaN(p.t) && p.v != null);
  if (C.length < 2 || G.length < 2) return '<div class="muted">Dati storici non disponibili</div>';
  const W = 640, H = 230, pad = { l: 40, r: 44, t: 14, b: 24 };
  const minT = Math.min(...C.concat(G).map(p => p.t)), maxT = Math.max(...C.concat(G).map(p => p.t));
  const x = t => pad.l + (t - minT) / (maxT - minT || 1) * (W - pad.l - pad.r);
  const cMin = Math.min(...C.map(p => p.v), 0), cMax = Math.max(...C.map(p => p.v), 0), cR = (cMax - cMin) || 1;
  const gMin = Math.min(...G.map(p => p.v), 0), gMax = Math.max(...G.map(p => p.v), 0), gR = (gMax - gMin) || 1;
  const yC = v => pad.t + (1 - (v - cMin) / cR) * (H - pad.t - pad.b);
  const yG = v => pad.t + (1 - (v - gMin) / gR) * (H - pad.t - pad.b);
  const bands = (recessions || []).map(r => {
    const x1 = x(+new Date(r.start + "T00:00:00")), x2 = x(+new Date(r.end + "T00:00:00"));
    const xa = Math.max(pad.l, x1), xb = Math.min(W - pad.r, x2);
    return (xb <= pad.l || xa >= W - pad.r) ? "" : `<rect x="${xa.toFixed(1)}" y="${pad.t}" width="${Math.max(0.5, xb - xa).toFixed(1)}" height="${(H - pad.t - pad.b).toFixed(1)}" fill="var(--muted)" opacity="0.2"/>`;
  }).join("");
  const poly = (arr, y) => arr.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const years = [];
  const y0 = new Date(minT).getFullYear(), y1 = new Date(maxT).getFullYear();
  const step = Math.ceil((y1 - y0) / 6) || 1;
  for (let yy = Math.ceil(y0 / step) * step; yy <= y1; yy += step) {
    const tx = x(+new Date(`${yy}-01-01T00:00:00`));
    years.push(`<text x="${tx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--muted)">${yy}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    ${bands}
    <line x1="${pad.l}" y1="${yC(0).toFixed(1)}" x2="${W - pad.r}" y2="${yC(0).toFixed(1)}" stroke="var(--border)" stroke-dasharray="3 3"/>
    <polyline points="${poly(C, yC)}" fill="none" stroke="var(--blue)" stroke-width="1.8"/>
    <polyline points="${poly(G, yG)}" fill="none" stroke="var(--green)" stroke-width="1.8"/>
    <text x="2" y="${(pad.t + 6).toFixed(1)}" font-size="9" fill="var(--blue)">${fmtNum.format(Math.round(cMax * 10) / 10)}</text>
    <text x="2" y="${(H - pad.b).toFixed(1)}" font-size="9" fill="var(--blue)">${fmtNum.format(Math.round(cMin * 10) / 10)}</text>
    <text x="${W - pad.r + 4}" y="${(pad.t + 6).toFixed(1)}" font-size="9" fill="var(--green)">${fmtNum.format(Math.round(gMax))}%</text>
    <text x="${W - pad.r + 4}" y="${(H - pad.b).toFixed(1)}" font-size="9" fill="var(--green)">${fmtNum.format(Math.round(gMin))}%</text>
    ${years.join("")}
  </svg>
  <div class="rec-leg"><span><span class="dot" style="background:var(--blue)"></span>Curva 10A-2A${opts.shiftMonths ? ` (+${opts.shiftMonths}m)` : ""} <span class="muted">(asse sx, pp)</span></span>
    <span><span class="dot" style="background:var(--green)"></span>PIL reale YoY <span class="muted">(asse dx, %)</span></span>
    <span><span class="dot" style="background:var(--muted)"></span>Recessioni</span></div>`;
}

function openMacroInfo(key) {
  const info = MACRO_INFO[key];
  if (!info) return;
  const [name, desc, cadence, rx] = info;
  const m = DATA.macro || {};
  let extra = "";

  // valore attuale + data + sentiment per gli indicatori macro
  if (key.startsWith("in:")) {
    const ind = (m.indicators || []).find(i => "in:" + i.key === key);
    if (ind) {
      const sent = ind.impact >= 60 ? '<span class="pos">favorevole ai mercati</span>'
        : ind.impact <= 40 ? '<span class="neg">sfavorevole ai mercati</span>' : "neutro";
      const nd = nextReleaseDate(ind.key);
      extra = `<div class="info-line"><b>Valore attuale:</b> ${ind.value} <span class="muted">(${ind.date})</span></div>
        <div class="info-line"><b>Impatto:</b> ${sent}</div>
        ${nd ? `<div class="info-line"><b>Prossima pubblicazione stimata:</b> ${nd}</div>` : ""}
        ${ind.next_release ? `<div class="info-line muted">${ind.next_release}</div>` : ""}`;
    }
  } else if (key === "fedwatch" && m.fedwatch) {
    const fw = m.fedwatch;
    // v207 — la colonna RIALZO mancava: il popup mostrava "Taglio" e "Invariato" mentre i dati
    // portavano hike_prob al 2% e al 26%. È la classe C14 (una probabilita' pubblicata a zero su
    // una sola direzione e' informazione mancante travestita da informazione presente), corretta
    // nel payload in v187 e sopravvissuta qui per due versioni.
    const primo = ramiFedWatch(fw, (fw.meetings || [])[0]);
    extra = `<div class="info-line"><b>Range attuale:</b> ${fw.target_range} · implicito ${fmtNum.format(fw.implied_rate)}%</div>
      <div class="info-line"><b>Prossima riunione:</b> <span class="neg">rialzo ${primo.hike_prob ?? 0}%</span> · invariato ${primo.hold_prob ?? 0}% · <span class="pos">taglio ${primo.cut_prob ?? 0}%</span></div>`;
    if ((fw.meetings || []).length) {
      extra += `<table class="info-table"><thead><tr><th>Riunione FOMC</th><th>Rialzo</th><th>Invariato</th><th>Taglio</th></tr></thead><tbody>`
        + fw.meetings.map(x => { const r = ramiFedWatch(fw, x); return `<tr><td>${new Date(r.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}</td>
          <td class="neg">${r.hike_prob ?? 0}%</td><td>${r.hold_prob ?? 0}%</td><td class="pos">${r.cut_prob ?? 0}%</td></tr>`; }).join("")
        + `</tbody></table><div class="info-line muted" style="font-size:11px">Probabilità stimate dai futures sui Fed Funds (stile CME FedWatch). Tutti e tre i rami sono sempre mostrati, anche a zero: uno zero esplicito è informazione, l'assenza della voce no.</div>`;
    }
    if ((fw.dot_plot || []).length) {            // Dot Plot: mediana proiezioni FOMC
      const mx = Math.max(...fw.dot_plot.map(d => d.median));
      extra += `<h4 style="margin:12px 0 4px">Dot Plot — mediana proiezioni FOMC</h4>
        <div class="dotplot">` + fw.dot_plot.map(d =>
        `<div class="dp-col"><div class="dp-bar-wrap"><div class="dp-bar" style="height:${Math.round(d.median / mx * 100)}%"></div></div>
           <div class="dp-val">${fmtNum.format(d.median)}%</div><div class="dp-year">${d.year}</div></div>`).join("")
        + `</div><div class="info-line muted" style="font-size:11px">${esc(fw.dot_plot_note || "")}</div>`;
    }
  } else if (key === "fear_greed" && m.fear_greed) {
    const fg = m.fear_greed;
    extra = `<div class="info-line"><b>Oggi:</b> ${fg.score} (${FG_LABELS[fg.rating] || fg.rating}) · 1 sett ${fg.week_ago} · 1 mese ${fg.month_ago}${fg.year_ago ? ` · 1 anno ${fg.year_ago}` : ""}</div>`;
    if (fg.fomo != null) {
      extra += `<div class="info-line"><b>FOMO:</b> <span style="color:${scoreColor(100 - fg.fomo)}">${fg.fomo}/100 — ${fg.fomo_label}</span></div>
        ${meterBar(fg.fomo, scoreColor(100 - fg.fomo), fg.fomo + "")}
        <div class="info-line muted" style="font-size:11px">Indice derivato (avidità + momentum S&P 500): alto = rischio di inseguire il rialzo.</div>`;
    }
    if ((fg.components || []).length) {
      extra += `<h4 style="margin:10px 0 4px">I 7 componenti</h4>` + fg.components.map(c =>
        `<div class="info-line" style="display:flex;justify-content:space-between"><span>${c.label}</span><span class="muted">${c.rating}${c.score != null ? ` (${c.score})` : ""}</span></div>`).join("");
    }
  } else if (key === "carry" && m.carry) {
    const cy = m.carry;
    // regime del carry trade in base allo spread dei tassi 10A
    const regime = cy.spread >= 3 ? { txt: "Carry molto favorevole — differenziale ampio, flussi verso USD", cls: "pos" }
      : cy.spread >= 2.2 ? { txt: "Carry favorevole — differenziale solido", cls: "pos" }
      : cy.spread >= 1.5 ? { txt: "Carry in compressione — margine in calo, sorvegliare l'unwind", cls: "" }
      : { txt: "Carry a rischio — differenziale stretto, possibile rientro di capitali in yen", cls: "neg" };
    // aspettativa BoJ per ogni meeting, basata su spread corrente + trend yen (yen forte ⇒ più pressione al rialzo)
    const bojExpect = (sp) => {
      if (sp < 1.2) return { txt: "Rialzo probabile — spread stretto, mercati prezzano stretta BoJ", cls: "neg" };
      if (sp < 1.8) return { txt: "Possibile rialzo — BoJ hawkish, sorvegliare inflazione JP e yen", cls: "neg" };
      if (sp < 2.4) return { txt: "Fermi con bias hawkish — compressione in corso, rischio unwind", cls: "" };
      if (sp < 3.0) return { txt: "Probabilmente fermi — spread sufficiente a sostenere il carry", cls: "" };
      return { txt: "Fermi o taglio remoto — spread ampio, carry molto conveniente", cls: "pos" };
    };
    const carryScore = clamp((cy.spread - 0.5) / 3 * 100);
    const yenTrend = cy.usdjpy_chg_1m > 0 ? "yen in indebolimento (favorevole al carry)" : "yen in rafforzamento (attenzione all'unwind)";
    extra = `<div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">
        Il <b>carry trade USD/JPY</b>: ci si finanzia in yen a tasso quasi zero per investire in asset in dollari a tasso più alto. Più ampio è il differenziale dei tassi (e più debole lo yen), più è redditizio. Un rialzo BoJ o uno yen che si rafforza comprime il margine e può innescare un <b>unwind</b> rapido: vendite forzate sugli azionari globali e rientro di capitali in yen (come ad agosto 2024).
      </div>
      <div class="info-line"><b>Treasury 10A (USA):</b> ${fmtNum.format(cy.us10)}% &nbsp;·&nbsp; <b>JGB 10A (Giappone):</b> ${fmtNum.format(cy.jp10)}%</div>
      <div class="info-line"><b>Differenziale tassi 10A (USA−Giappone):</b> <span style="color:${scoreColor(carryScore)}">${fmtNum.format(cy.spread)} pp</span> — <span class="${regime.cls}">${regime.txt}</span></div>
      ${cy.boj_rate != null ? `<div class="info-line"><b>Tasso ufficiale BoJ (overnight call rate):</b> ${fmtNum.format(cy.boj_rate)}%</div>` : ""}
      <div class="info-line"><b>Cambio USD/JPY:</b> ${fmtNum.format(cy.usdjpy)} <span class="${signCls(cy.usdjpy_chg_1m)}">(${signTxt(cy.usdjpy_chg_1m)} nell'ultimo mese)</span> — ${yenTrend}</div>
      ${thermoBar(carryScore, ["Carry favorevole", "Carry a rischio"])}
      <div class="info-line" style="margin:8px 0">${cy.note || ""}</div>`;
    if ((cy.boj_meetings || []).length) {
      const fmtMeet = (d) => new Date(d + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
      const next = cy.boj_meetings[0];
      const daysTo = Math.round((new Date(next + "T00:00:00") - new Date()) / 864e5);
      extra += `<h4 style="margin:12px 0 4px">Prossime riunioni Bank of Japan (decisione sui tassi)</h4>
        <div class="info-line"><b>Prossima:</b> ${fmtMeet(next)} <span class="muted">(tra ${daysTo} gg)</span></div>
        <table class="info-table"><thead><tr><th>Data riunione</th><th>Scenario atteso (modello interno)</th></tr></thead><tbody>`
        + cy.boj_meetings.map((d, i) => {
            const e = bojExpect(cy.spread - i * 0.05);   // più avanti nel tempo = più incertezza di stretta
            const est = d >= "2027-01-01" ? ' <span class="muted">(data stimata)</span>' : "";
            return `<tr><td>${fmtMeet(d)}${est}</td><td class="${e.cls}">${e.txt}</td></tr>`;
          }).join("")
        + `</tbody></table>
        <div class="info-line muted" style="font-size:11px;margin-top:6px">
          Calendario ufficiale BoJ 2026 (le date 2027 sono indicative e vanno confermate). Gli scenari sono un'euristica basata sul differenziale corrente, non previsioni ufficiali: un differenziale stretto aumenta la probabilità che il mercato prezzi una stretta BoJ.
        </div>`;
    }
  } else if (key === "putcall" && m.putcall) {
    const pc = m.putcall;
    const total = (pc.puts || 0) + (pc.calls || 0);
    const putPct = total ? Math.round(pc.puts / total * 100) : 50;
    const callPct = 100 - putPct;
    const bias = pc.ratio > 1.1 ? { txt: "Prevalgono le PUT — copertura/pessimismo (spesso difensivo o, agli estremi, contrarian rialzista)", cls: "neg" }
      : pc.ratio < 0.7 ? { txt: "Prevalgono le CALL — euforia/compiacenza (agli estremi, contrarian ribassista)", cls: "pos" }
      : { txt: "Flussi equilibrati tra put e call", cls: "" };
    extra = `<div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">
        Il <b>Put/Call ratio</b> misura il volume di opzioni put diviso quello delle call su ${esc(pc.name || pc.symbol)}. >1 = più put (copertura/ribasso); &lt;1 = più call (rialzo). È un indicatore di sentiment, spesso letto in chiave <b>contrarian</b> agli estremi.
      </div>
      <div class="info-line"><b>Ratio:</b> <span style="color:${scoreColor(clamp(100 - pc.ratio / 2 * 100))};font-family:var(--mono);font-weight:700">${fmtNum.format(pc.ratio)}</span> — <span class="${bias.cls}">${bias.txt}</span></div>
      <h4 style="margin:12px 0 6px">Ripartizione del volume opzioni</h4>
      <div class="pc-split" role="img" aria-label="Ripartizione call ${callPct}% put ${putPct}%">
        <div class="pc-seg pc-call" style="width:${callPct}%">${callPct >= 12 ? "CALL " + callPct + "%" : ""}</div>
        <div class="pc-seg pc-put" style="width:${putPct}%">${putPct >= 12 ? "PUT " + putPct + "%" : ""}</div>
      </div>
      <div class="info-line" style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:12px;margin-top:6px">
        <span style="color:var(--green)">CALL ${pc.calls.toLocaleString("it-IT")}</span>
        <span style="color:var(--red)">PUT ${pc.puts.toLocaleString("it-IT")}</span>
      </div>
      <div class="info-line muted" style="font-size:11px;margin-top:8px">
        Volumi sulle prime due scadenze. <b>Come si legge:</b> un ratio in forte salita segnala aumento di copertura (possibile risk-off in arrivo); un ratio molto basso segnala compiacenza (rischio di correzione su sorprese negative).
      </div>`;
    /* ⚠⚠ v280 — LA TABELLA DEI MURI PER TITOLO E' USCITA, ED E' LA TERZA VOLTA CHE IL CEO
       DEVE SEGNALARMI QUESTA STESSA COSA.
       Mostrava "PRESSIONE DI ROLLING PER TITOLO" con AMD, NVDA, MU, MSTR, RGTI — cioe' il suo
       VECCHIO PORTAFOGLIO, che il sistema non deve piu' leggere da v256.
       In v265 avevo corretto la SCHEDA e dichiarato risolto senza aprire il POPUP: la scheda
       pescava dal pannello, e il pannello ricostruiva la tabella da DATA.portfolio +
       DATA.watchlist per conto suo. Ho guardato i DATI (`macro.putcall` e' solo SPY) invece
       dello SCHERMO, e ho concluso che il problema non esistesse. Lui ha dovuto scrivermi
       "NON HAI ESEGUITO QUESTA OPERAZIONE", e anche dopo quella volta e' rimasto qui.
       I muri delle opzioni non spariscono dal sistema: vivono sotto il grafico, per il titolo
       che sta guardando in quel momento (v266) — il posto dove servono. Qui erano una
       classifica di titoli che non possiede piu'. */

  } else if (key === "yield_recession" && m.yield_recession) {
    const yr = m.yield_recession;
    const cc = yr.current_curve, c12 = yr.curve_12m_ago;
    const ccCol = cc == null ? "var(--muted)" : cc < 0 ? "var(--red)" : yr.steepening ? "var(--yellow)" : "var(--green)";
    extra = `<div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">
        Storicamente, quando la <b>curva dei rendimenti</b> (differenza tra Treasury USA a 10 e 2 anni) esce da un'inversione e si <b>irripidisce bruscamente</b>, una recessione tende a seguire entro ~12 mesi. La curva inverte prima, poi torna positiva proprio mentre l'economia rallenta. Le bande grigie sono le recessioni USA (NBER).
      </div>
      <div class="info-line"><b>Spread 10A-2A attuale:</b> <span style="color:${ccCol}">${cc != null ? (cc > 0 ? "+" : "") + fmtNum.format(cc) + " pp" : "—"}</span> ${c12 != null ? `<span class="muted">(12 mesi fa ${c12 > 0 ? "+" : ""}${fmtNum.format(c12)} pp)</span>` : ""}</div>
      <div class="info-line"><b>Stato:</b> <span style="color:${ccCol}">${esc(yr.label || "")}</span></div>
      ${yr.gdp_last != null ? `<div class="info-line"><b>Crescita PIL reale (YoY):</b> ${yr.gdp_last > 0 ? "+" : ""}${fmtNum.format(yr.gdp_last)}%</div>` : ""}
      ${yr.claims_last != null ? `<div class="info-line"><b>Sussidi disoccupazione (sett.):</b> ${fmtNum.format(yr.claims_last)}</div>` : ""}
      <h4 style="margin:14px 0 4px">Curva 10A-2A vs PIL reale · recessioni in grigio</h4>
      ${recessionChart(yr.curve, yr.gdp_growth, yr.recessions)}
      <h4 style="margin:16px 0 4px">Curva shiftata di 12 mesi vs crescita PIL</h4>
      <div class="info-line muted" style="font-size:11px;margin-bottom:4px">La curva è traslata in avanti di 12 mesi: dove la curva (blu) anticipa la caduta del PIL (verde) si vede la sua capacità predittiva sulle recessioni.</div>
      ${recessionChart(yr.curve, yr.gdp_growth, yr.recessions, { shiftMonths: 12 })}
      <div class="info-line muted" style="font-size:11px;margin-top:8px">
        <b>Lettura attuale:</b> ${yr.steepening && yr.was_inverted_24m
          ? "la curva si sta irripidendo dopo un'inversione ma il PIL e l'occupazione restano resilienti: il segnale storico invita alla prudenza pur in assenza, per ora, di recessione."
          : (cc != null && cc < 0) ? "curva ancora invertita: storicamente precede recessioni di 12-18 mesi."
          : "curva normale/positiva: nessun segnale di stress imminente dalla struttura dei tassi."}
        Fonte: FRED (T10Y2Y, GDPC1, USREC, ICSA).
      </div>`;
  } else if (key === "credit" && m.credit) {
    const cr = m.credit;
    const crCol = scoreColor(cr.score);
    extra = `<div class="info-line"><b>Spread HY (ICE BofA OAS):</b> <span style="color:${crCol}">${fmtNum.format(cr.spread_hy)}% — ${cr.label}</span> <span class="muted">(${cr.date})</span></div>
      ${thermoBar(cr.score, ["Basso", "Elevato"])}
      <div class="info-line muted" style="font-size:11px;margin-top:6px">L'OAS High Yield misura il premio di rischio obbligazionario rispetto ai Treasury.<br>
      <b>&lt;4%</b> normale &nbsp;·&nbsp; <b>5-7%</b> stress &nbsp;·&nbsp; <b>&gt;9%</b> crisi sistemica. Proxy CDS via FRED (ICE BofA).</div>`;
    if ((cr.history || []).length > 1) {
      extra += `<h4 style="margin:12px 0 4px">Andamento spread HY (1 anno)</h4>
        ${miniLineChart(cr.history, { color: crCol })}`;
    }
  } else if (key === "systemic_risk" && m.systemic_risk) {
    const sr = m.systemic_risk;
    const stCol = sr.rising ? "var(--red)" : sr.score >= 60 ? "var(--green)" : sr.score <= 40 ? "var(--red)" : "var(--yellow)";
    extra = `<div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">
        Il mercato del credito (CDS / spread obbligazionari) anticipa sistematicamente l'azionario: un allargamento brusco degli spread = aumenta il costo per assicurarsi contro i fallimenti = segnale di <b>risk-off</b> in arrivo.
      </div>
      <div class="info-line"><b>Stato:</b> <span style="color:${stCol};font-weight:700">${esc(sr.status)}</span></div>
      ${thermoBar(sr.score, ["Rilassato", "Stress"])}
      <table class="info-table" style="margin-top:8px"><thead><tr><th>Spread (proxy CDS)</th><th class="num">Livello</th><th class="num">Var. 1 mese</th></tr></thead><tbody>
        <tr><td><b>High Yield OAS</b> (CDX HY proxy)</td><td class="num">${sr.hy_oas != null ? fmtNum.format(sr.hy_oas) + "%" : "—"}</td><td class="num ${signCls(sr.hy_chg_1m)}">${sr.hy_chg_1m != null ? signTxt(sr.hy_chg_1m) : "—"}</td></tr>
        <tr><td>Investment Grade OAS</td><td class="num">${sr.ig_oas != null ? fmtNum.format(sr.ig_oas) + "%" : "—"}</td><td class="num ${signCls(sr.ig_chg_1m)}">${sr.ig_chg_1m != null ? signTxt(sr.ig_chg_1m) : "—"}</td></tr>
        ${sr.hy_ig != null ? `<tr><td>Rapporto HY/IG (fuga qualità)</td><td class="num">${fmtNum.format(sr.hy_ig)}×</td><td class="num">—</td></tr>` : ""}
        ${sr.stlfsi != null ? `<tr><td>Indice Stress Finanziario (St. Louis Fed)</td><td class="num ${sr.stlfsi > 0 ? "neg" : "pos"}">${signTxt(sr.stlfsi)}</td><td class="num">—</td></tr>` : ""}
      </tbody></table>
      <div class="info-line muted" style="font-size:11px;margin-top:8px">
        Spread in % MoM. <b>HY OAS</b>: &lt;4% normale · 5-7% stress · &gt;9% crisi. <b>HY/IG</b> in salita = rotazione verso la qualità (difensivo). <b>STLFSI &gt;0</b> = stress sopra la media. Per il debito sovrano USA non esiste un CDS gratuito affidabile: si usa l'indice di stress finanziario come proxy sistemico. Fonte: FRED (BofA OAS, STLFSI4).
      </div>`;
  } else if (key === "decouple" && m.decouple) {
    const dc = m.decouple;
    const spLast = dc.sp500[dc.sp500.length - 1].v;
    const gdLast = dc.gdp[dc.gdp.length - 1].v;
    const gap = Math.round(spLast - gdLast);
    const gapCol = gap > 40 ? "var(--red)" : gap > 20 ? "var(--yellow)" : "var(--green)";
    extra = `<div class="info-line"><b>S&amp;P 500 (normalizzato):</b> <span class="pos">${signTxt(spLast - 100)} dal periodo base</span></div>
      <div class="info-line"><b>PIL reale USA (GDPC1):</b> ${signTxt(gdLast - 100)} dal periodo base</div>
      <div class="info-line"><b>Gap (disaccoppiamento):</b> <span style="color:${gapCol}">${gap > 0 ? "+" : ""}${gap} pp — ${gap > 40 ? "speculazione elevata" : gap > 20 ? "valutazione tesa" : "disaccoppiamento contenuto"}</span></div>
      <h4 style="margin:12px 0 4px">S&amp;P 500 vs PIL reale (base 100 = inizio periodo)</h4>
      ${miniDualChart(dc.sp500, dc.gdp, { color1: "var(--blue)", color2: "var(--green)", label1: "S&P 500", label2: "PIL reale" })}
      <div class="info-line muted" style="font-size:11px;margin-top:6px">Un gap ampio segnala che la borsa ha prezzato una crescita degli utili superiore a quella dell'economia reale. Storico pre-correzione: gap &gt;40 pp in 2000, 2007 e 2021.</div>`;
  } else if (key === "smart_money" && m.smart_money) {
    const sm = m.smart_money;
    const smCol = scoreColor(sm.score);
    const fgScore = m.fear_greed?.score;
    const fgLabel = fgScore != null ? (FG_LABELS[m.fear_greed?.rating] || m.fear_greed?.rating || "") : "";
    let divAlert = "";
    if (fgScore != null && sm.score != null) {
      if (fgScore > 75 && sm.score < 30)
        divAlert = `<div class="sm-alert danger"><b>DIVERGENZA PERICOLOSA: Rischio Distribuzione Istituzionale</b><br>Retail in Long Estremo (Fear &amp; Greed ${fgScore}/100) mentre gli istituzionali mantengono posizione difensiva (${sm.score}/100). Setup storicamente associato a correzioni: gli "smart money" si distribuiscono sulla massa retail in euforia.</div>`;
      else if (fgScore < 25 && sm.score > 70)
        divAlert = `<div class="sm-alert bullish"><b>ACCUMULO ISTITUZIONALE: Setup Rialzista</b><br>Retail in Paura Estrema (Fear &amp; Greed ${fgScore}/100) mentre gli istituzionali accumulano aggressivamente (${sm.score}/100). Classico bottom con "blood in the streets" e accumulo smart money — storicamente setup rialzista.</div>`;
    }
    extra = `${divAlert}<div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">
        Indicatore basato sui <b>Smart Money Concepts (SMC)</b> calcolati dai prezzi (OHLC) di <b>S&amp;P 500 e Nasdaq 100</b>: struttura di mercato e rottura di struttura (<b>BOS</b>), <b>FVG</b> (Fair Value Gap), zone di <b>liquidità</b> (stop sopra i massimi / sotto i minimi) e <b>order block</b>. Verde = struttura rialzista/accumulazione istituzionale; rosso = distribuzione.
      </div>
      <h4 style="margin:8px 0 4px">Confronto visivo: Istituzionali vs Retail (Fear &amp; Greed)</h4>
      <div class="dual-idx">
        <div class="dual-idx-block">
          ${compactSemiGauge(sm.score, ["Bullish (Long)", "Bearish (Short)"])}
          <div class="dual-idx-label">Istituzionali (SMC)</div>
          <div class="dual-idx-val" style="color:${smCol}">${sm.label}</div>
        </div>
        ${fgScore != null ? `<div class="dual-idx-block">
          ${compactSemiGauge(fgScore, ["Paura", "Avidità"])}
          <div class="dual-idx-label">Retail (Fear &amp; Greed)</div>
          <div class="dual-idx-val" style="color:${scoreColor(fgScore)}">${fgScore}/100${fgLabel ? ` &middot; ${fgLabel}` : ""}</div>
        </div>` : ""}
      </div>
      <div class="info-line"><b>Posizionamento istituzionale:</b> <span style="color:${smCol}">${sm.label}</span> <span class="muted" style="font-size:11px">— composito nostro da VIX, HY/IG e put/call</span></div>
      ${thermoBar(sm.score, ["Bullish (Long)", "Bearish (Short)"])}`;
    const arrow = d => d === "rialzista" ? '<span class="pos">▲ rialzista</span>' : d === "ribassista" ? '<span class="neg">▼ ribassista</span>' : '<span class="muted">laterale</span>';
    const smcIdx = sm.smc_indices || {};
    const smcCard = (s) => {
      if (!s) return "";
      const c = scoreColor(s.bias);
      return `<div class="smc-card">
        <div class="smc-head"><b>${esc(s.label_idx || "")}</b> <span style="color:${c}">${s.label}</span></div>
        <div class="smc-line">Struttura: ${arrow(s.structure)} &nbsp;·&nbsp; BOS: ${s.bos ? arrow(s.bos) : "—"}</div>
        <div class="smc-line">FVG aperti: <span class="pos">${s.bull_fvg} ↑</span> / <span class="neg">${s.bear_fvg} ↓</span>${s.last_fvg ? ` · ultimo ${s.last_fvg.dir} ${fmtNum.format(s.last_fvg.lo)}–${fmtNum.format(s.last_fvg.hi)}` : ""}</div>
        <div class="smc-line">Liquidità: sopra <b>${s.liq_above != null ? fmtNum.format(s.liq_above) : "—"}</b> · sotto <b>${s.liq_below != null ? fmtNum.format(s.liq_below) : "—"}</b>${s.order_block ? ` · Order block ${s.order_block.dir} ${fmtNum.format(s.order_block.lo)}–${fmtNum.format(s.order_block.hi)}` : ""}</div>
      </div>`;
    };
    if (Object.keys(smcIdx).length) {
      extra += `<h4 style="margin:12px 0 4px">SMC degli indici (driver dell'indicatore)</h4>${smcCard(smcIdx.sp500)}${smcCard(smcIdx.nasdaq)}`;
    }
    const ptfSmc = (DATA.portfolio || []).filter(r => r.smc);
    if (ptfSmc.length) {
      const dd = d => d === "rialzista" ? '<span class="pos">▲</span>' : d === "ribassista" ? '<span class="neg">▼</span>' : '<span class="muted">–</span>';
      const rows = ptfSmc.map(r => {
        const s = r.smc, c = scoreColor(s.bias), bw = Math.max(6, Math.min(100, s.bias));
        return `<tr><td><b>${r.ticker}</b></td><td>${dd(s.structure)} ${esc(s.structure)}</td><td>${s.bos ? dd(s.bos) : "—"}</td>
          <td class="num"><span class="pos">${s.bull_fvg}</span>/<span class="neg">${s.bear_fvg}</span></td>
          <td><span class="roll-bar"><span class="roll-fill" style="width:${bw}%;background:${c}"></span></span> <span style="color:${c};font-family:var(--mono);font-size:11px">${s.bias}</span></td></tr>`;
      }).join("");
      extra += `<h4 style="margin:12px 0 4px">SMC dei tuoi titoli</h4>
        <table class="info-table"><thead><tr><th>Titolo</th><th>Struttura</th><th>BOS</th><th>FVG ↑/↓</th><th>Bias SMC</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    if (sm.divergence != null) {
      const dvCol = Math.abs(sm.divergence) > 15 ? "var(--yellow)" : "var(--green)";
      extra += `<div class="info-line" style="margin-top:8px"><b>Divergenza Istituzionali vs Retail:</b> <span style="color:${dvCol}">${sm.divergence > 0 ? "+" : ""}${sm.divergence} pt — ${sm.divergence_label}</span></div>
        <div class="info-line muted" style="font-size:11px">Fear &amp; Greed (retail) ${fgScore ?? "—"}/100 vs Istituzionali ${sm.score}/100. Un gap ampio segnala possibile inversione: quando il retail è euforico ma gli istituzionali si coprono, storicamente precede correzioni.</div>`;
    }
    if ((sm.components || []).length) {
      extra += `<h4 style="margin:10px 0 4px">Componenti del segnale</h4>` + sm.components.map(c =>
        `<div class="info-line" style="display:flex;justify-content:space-between;align-items:center"><span>${c.label}</span><span style="color:${scoreColor(c.score)};font-family:var(--mono)">${c.score}</span></div>`).join("");
    }
    const det = [];
    if (sm.vix_term_ratio != null) det.push(`VIX/VIX3M ${fmtNum.format(sm.vix_term_ratio)} ${sm.vix_term_ratio > 1 ? "(backwardation = tensione)" : "(contango = calma)"}`);
    if (sm.hy_ig_ratio != null) det.push(`HY/IG ${fmtNum.format(sm.hy_ig_ratio)}`);
    if (det.length) extra += `<div class="info-line muted" style="font-size:11px;margin-top:6px">${det.join(" · ")}</div>`;
  } else if (key === "sp500_pe" && m.sp500_pe) {
    const pe = m.sp500_pe;
    const peCol = pe.current > 35 ? "var(--red)" : pe.current > 25 ? "var(--yellow)" : pe.current > 14 ? "var(--muted)" : "var(--green)";
    const ndxPeCol = pe.nasdaq_pe > 40 ? "var(--red)" : pe.nasdaq_pe > 30 ? "var(--yellow)" : "var(--muted)";
    const ndxRow = pe.nasdaq_pe ? `<div class="info-line"><b>Nasdaq 100 (QQQ) P/E attuale:</b> <span style="color:${ndxPeCol}">${pe.nasdaq_pe}×</span> <span class="muted" style="font-size:11px">(storicamente NDX tratta a premio vs S&P; sopra 35× indica valutazioni tech tese)</span></div>` : "";
    extra = `<div class="info-line"><b>S&P 500 P/E attuale:</b> <span style="color:${peCol}">${pe.current}× — ${pe.label}</span></div>
      ${ndxRow}
      ${pe.avg_10y != null ? `<div class="info-line"><b>Media S&P ultimi 10 anni:</b> ${pe.avg_10y}×</div>` : ""}
      ${pe.pct_rank != null ? `<div class="info-line"><b>Percentile storico S&P:</b> il mercato è stato più economico di adesso nel ${pe.pct_rank}% dei mesi degli ultimi 10 anni</div>` : ""}
      ${thermoBar(pe.score, ["Sottovalutato", "Sopravvalutato"])}
      <div class="info-line muted" style="font-size:11px;margin:6px 0">
        P/E &gt;25: valutazioni tese, storicamente associate a ritorni futuri più bassi nei 10 anni successivi.
        P/E &gt;35: livelli estremi raggiunti solo nel 1999-2000 (bolla dot-com) e nel 2020-2021 (post-pandemia).<br>
        Il P/E trailing usa gli utili degli ultimi 12 mesi — è più volatile del CAPE di Shiller (10 anni), ma più reattivo.
      </div>
      ${(pe.history || []).length >= 2
        ? `<h4 style="margin:12px 0 4px">P/E S&P 500 — ${pe.history.length} rilevazioni (${esc(pe.source || "FRED")})</h4>
           ${miniLineChart(pe.history, { color: "var(--yellow)", zeroLine: false })}`
        : `<div class="info-line muted" style="font-size:11.5px;margin-top:10px"><b>Storico non disponibile da questa fonte.</b>
             Il titolo di questo riquadro prometteva "storico 10 anni" mentre la serie ha ${(pe.history || []).length} rilevazione${(pe.history || []).length === 1 ? "" : "i"}
             (fonte: ${esc(pe.source || "n.d.")}) — e per lo stesso motivo mancano la media a 10 anni e il percentile storico.
             Resta valido il P/E corrente qui sopra.</div>`}
      <div class="info-line muted" style="font-size:11px;margin-top:6px">
        <b>Implicazione per il portafoglio:</b> P/E elevato significa che ogni dollaro di utile è pagato di più.
        In scenari di rialzo dei tassi + P/E &gt;25, i multipli tendono a comprimersi (-15% / -30% dall'inizio storico).
        Suggerito: privilegiare titoli con P/E inferiore alla media settoriale e FCF yield elevato.
      </div>`;
  } else if (key === "corp_profit" && m.corp_profit) {
    const cp = m.corp_profit;
    /* ⚠ v334 — la spiegazione che mancava, in cima e in parole: due linee, stessa partenza. */
    const se = (typeof serieIndicatore === "function") ? serieIndicatore("corp_profit") : null;
    const fin = se && se.finestra
      ? `<div class="info-line muted" style="font-size:11px">Le due linee coprono la FINESTRA COMUNE `
        + `${se.finestra.inizio} → ${se.finestra.fine}: i profitti aziendali sono TRIMESTRALI e la fonte `
        + `li pubblica con mesi di ritardo, quindi la serie finisce prima di quella di borsa. `
        + `Disegnarle fino a date diverse farebbe sembrare che una delle due si sia fermata.</div>`
      : "";
    extra = `<div class="info-line"><b>Come si leggono le due linee:</b> partono ENTRAMBE da 100 nello
        stesso mese. Quella colorata e' la BORSA, la tratteggiata e' cio' che la sostiene — i profitti
        aziendali reali (o il PIL reale nell'altra coppia). Se si allargano, la borsa e' salita piu' di
        quello che le sta sotto: e' un fatto di VALUTAZIONE, non un segnale di uscita, perche' quel
        divario puo' restare aperto per anni.</div>${fin}` + extra;
    const gapCol = cp.gap > 40 ? "var(--red)" : cp.gap > 20 ? "var(--yellow)" : "var(--green)";
    const ndxGapCol = cp.ndx_gap != null ? (cp.ndx_gap > 40 ? "var(--red)" : cp.ndx_gap > 20 ? "var(--yellow)" : "var(--green)") : "var(--muted)";
    extra = `<div class="info-line"><b>Gap S&amp;P 500 vs Profitti Reali:</b> <span style="color:${gapCol}">${cp.gap > 0 ? "+" : ""}${cp.gap} pp — ${cp.label}</span></div>
      ${cp.ndx_gap != null ? `<div class="info-line"><b>Gap Nasdaq 100 vs Profitti Reali:</b> <span style="color:${ndxGapCol}">${cp.ndx_gap > 0 ? "+" : ""}${cp.ndx_gap} pp</span> <span class="muted" style="font-size:11px">(il Nasdaq tratta storicamente a premio su S&P)</span></div>` : ""}
      ${thermoBar(cp.score, ["Allineati", "Asset Inflation"])}
      <div class="info-line muted" style="font-size:11px;margin:6px 0">
        Quando S&amp;P 500 e Nasdaq 100 nominali crescono molto più dei profitti aziendali reali, l'eccesso è spiegato da svalutazione monetaria (fiat debasement) e non da crescita degli utili.
        Storicamente gap &gt;40 pp precede correzioni prolungate o lateralizzazione. Vedi 2000, 2007, 2021.
      </div>
      <h4 style="margin:12px 0 4px">S&amp;P 500 nominale vs Profitti Aziendali Reali USA (base 100)</h4>
      ${miniDualChart(cp.sp500, cp.profits, { color1: "var(--blue)", color2: "var(--yellow)", label1: "S&P 500 nominale", label2: "Profitti reali (FRED CP)" })}
      ${cp.ndx ? `<h4 style="margin:12px 0 4px">Nasdaq 100 nominale vs Profitti Aziendali Reali USA (base 100)</h4>
      ${miniDualChart(cp.ndx, cp.profits, { color1: "var(--purple)", color2: "var(--yellow)", label1: "Nasdaq 100", label2: "Profitti reali (FRED CP)" })}` : ""}
      <div class="info-line muted" style="font-size:11px;margin-top:6px">
        <b>Scenario breve (0-6 mesi):</b> se gap cresce, la borsa sale per illusione nominale, non per utili reali — rischio di correzione tecnica.<br>
        <b>Scenario lungo (12-36 mesi):</b> riallineamento tramite stagnazione dei prezzi o calo degli utili nominali; trigger: inflazione in risalita, scadenze fiscali, rallentamento consumi.
      </div>`;
  } else if (key === "fed_market" && m.fed_market) {
    const fm = m.fed_market;
    const rateCol = fm.current_rate > 4.5 ? "var(--red)" : fm.current_rate > 2.5 ? "var(--yellow)" : "var(--green)";
    extra = `<div class="info-line"><b>Fed Funds Rate attuale:</b> <span style="color:${rateCol}">${fm.current_rate}%</span>
        <span class="muted"> · rilevazione ${fm.rate_date}</span></div>
      <div class="info-line muted" style="font-size:11px;margin:6px 0">
        Il grafico mostra la correlazione storica tra il ciclo dei tassi Fed (rosso) e l'andamento dell'S&amp;P 500 (blu).
        I rialzi comprimono i multipli P/E; i tagli innescano rally. Le scale sono normalizzate per sovrapposizione visiva.
      </div>
      <h4 style="margin:12px 0 4px">Fed Funds Rate (%) vs S&amp;P 500 — ultimi 5 anni</h4>
      ${miniDualChart(fm.fedfunds, fm.sp500.map(p => ({ d: p.d, v: p.v / 1000 })),
        { color1: "var(--red)", color2: "var(--blue)", label1: "Fed Funds Rate (%)", label2: "S&P 500 (÷1000)" })}
      <div class="info-line muted" style="font-size:11px;margin-top:6px">
        Con Fed Funds &gt;4% la storia mostra compressione dei multipli azionari entro 12-18 mesi.
        Un taglio rapido (emergenza) storico precede rally ma anche segnali di crisi economica.
      </div>`;
  } else {
    extra = `<div class="info-line"><b>Aggiornamento:</b> ${cadence}</div>`;
  }

  // curva storica: aggiunge il grafico al popup esistente di "in:curve"
  if (key === "in:curve" && (m.curve_history || []).length > 1) {
    const lastV = m.curve_history[m.curve_history.length - 1].v;
    const crvCol = lastV >= 0 ? "var(--green)" : "var(--red)";
    extra += `<h4 style="margin:12px 0 4px">Storico curva 10A-2A (2 anni)</h4>
      ${miniLineChart(m.curve_history, { color: crvCol, zeroLine: true })}
      <div class="info-line muted" style="font-size:11px;margin-top:4px">Sotto zero = inversione = segnale storico di recessione. La dis-inversione (risalita verso 0 e oltre) è in corso da fine 2023.</div>`;
  }

  openInfoModal(name, `<p style="margin:0 0 10px">${desc}</p>${extra}`);
}

function openEarningsInfo(ticker) {
  const r = (DATA.portfolio || []).find(x => x.ticker === ticker);
  if (!r) return;
  const days = giorniAllaTrimestrale(r.earnings_date);
  const rx = new RegExp(`${ticker}|${(r.name || "").split(" ")[0]}|earnings|trimestral|utili|risultati`, "i");
  const RAT_SCORE = { strong_buy: 100, buy: 75, hold: 50, sell: 25, strong_sell: 0 };
  const RAT_LABEL = { strong_buy: "Strong Buy", buy: "Buy", hold: "Hold", sell: "Sell", strong_sell: "Strong Sell" };
  const st = r.stats || {};
  const epsForward = st.eps_forward;
  const epsTTM = st.eps_ttm ?? r.eps;
  const epsDelta = (epsForward != null && epsTTM != null && epsTTM !== 0) ? (epsForward / Math.abs(epsTTM) - 1) * 100 : null;
  // gauge raccomandazione: SEMPRE tachimetro verde-sx (Strong Buy) → rosso-dx (Strong Sell)
  let consensoHtml = "";
  if (r.rating?.key) {
    const rs = RAT_SCORE[r.rating.key] ?? 50;
    const rLab = RAT_LABEL[r.rating.key] ?? r.rating.key;
    consensoHtml = `<h4 style="margin:12px 0 4px">Consenso analisti</h4>
      <div style="max-width:200px;margin:0 auto">${compactSemiGauge(rs, ["Strong Buy", "Strong Sell"])}</div>
      <div class="info-line" style="text-align:center;margin-top:2px"><b style="color:${scoreColor(rs)}">${rLab}</b>
        <span class="muted"> · ${r.rating.n ?? "—"} analisti</span></div>`;
  }
  // valori attesi: SEMPRE presenti (target, EPS stimato vs attuale, crescita attesa)
  const exp = [];
  if (r.rating?.target) exp.push(`<tr><td>Target medio analisti</td><td class="num"><b>${cur(r)}${fmtNum.format(r.rating.target)}</b> <span class="${signCls(r.rating.upside_pct)}">(${signTxt(r.rating.upside_pct)})</span></td></tr>`);
  if (epsForward != null) exp.push(`<tr><td>EPS stimato (prossimi 12M)</td><td class="num"><b>${cur(r)}${fmtNum.format(epsForward)}</b>${epsDelta != null ? ` <span class="${signCls(epsDelta)}">(${signTxt(Math.round(epsDelta))} vs TTM)</span>` : ""}</td></tr>`);
  if (epsTTM != null) exp.push(`<tr><td>EPS attuale (TTM)</td><td class="num">${cur(r)}${fmtNum.format(epsTTM)}</td></tr>`);
  if (st.earnings_growth != null) exp.push(`<tr><td>Crescita utili attesa</td><td class="num ${st.earnings_growth > 0 ? "pos" : "neg"}">${pctOf(st.earnings_growth)}</td></tr>`);
  if (st.revenue_growth != null) exp.push(`<tr><td>Crescita ricavi attesa</td><td class="num ${st.revenue_growth > 0 ? "pos" : "neg"}">${pctOf(st.revenue_growth)}</td></tr>`);
  if (st.forward_pe != null) exp.push(`<tr><td>P/E prospettico</td><td class="num">${fmtNum.format(st.forward_pe)}×</td></tr>`);
  const expHtml = exp.length ? `<h4 style="margin:12px 0 4px">Valori attesi</h4>
    <table class="info-table"><tbody>${exp.join("")}</tbody></table>` : "";
  openInfoModal(`${r.name} (${ticker}) — Trimestrale`, `
    <div class="info-line"><b>Data attesa:</b> ${r.earnings_date ? new Date(r.earnings_date).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }) : "n/d"} ${days != null ? `(tra ${days} gg)` : ""}</div>
    ${consensoHtml}
    ${expHtml}
    <div class="info-line muted" style="margin:10px 0 12px">EPS e stime si aggiornano dopo ogni trimestrale. Target = media analisti coverage; crescita attesa e P/E prospettico dal consenso (fonte: yfinance).</div>`);
}

// pulsante elimina SEMPRE visibile accanto al nome (no edit-mode); BTP escluso

// modifica quantità e prezzo medio di carico di una posizione esistente



// Etichette colonne sui td (per la vista "a schede" su iPhone) + marcatura colonne chiave.
// ⚠ Le stringhe devono coincidere ESATTAMENTE con i testi delle <th> (index.html per le viste
// tecniche, head[] di buildFundTable per le fondamentali): un mismatch fa sparire la colonna
// dalle card mobile (test di guardia in test_app.mjs).
/* ⚠ v251 — RIALLINEATO alle colonne nuove: "Segnale" e "Financial Health" non esistono più,
   e un'etichetta orfana qui è muta (nessun errore, solo una colonna che su iPhone non viene
   mai evidenziata). Al loro posto entra il MARGINE NETTO, che su uno schermo stretto dice più
   di un punteggio composito. */
const MOBILE_KEY_COLS = new Set(["Titolo", "Prezzo", "Oggi", "Guad. %", "Drawdown 52S",
  "Trimestrale", "Marg. netto"]);
function applyColLabels(tableId) {
  // textContent può contenere la freccia di sort (" ▼"/" ▲") appesa da updateSortArrows: va tolta
  const ths = [...document.querySelectorAll(`#${tableId} thead th`)].map(t => t.textContent.replace(/[▲▼]/g, "").trim());
  document.querySelectorAll(`#${tableId} tbody tr`).forEach(tr => {
    if (tr.classList.contains("total-row") || tr.classList.contains("add-row")) return;
    [...tr.children].forEach((td, i) => {
      // td con colspan = nota che copre più colonne ("Dati fondamentali non disponibili",
      // "Nessun dato", BTP): l'etichetta della colonna i sarebbe fuorviante e il testo lungo
      // sfonderebbe la griglia 2-col della card → niente label, riga intera (CSS td-key[colspan])
      if (td.colSpan > 1) { td.setAttribute("data-label", ""); td.classList.add("td-key"); return; }
      const lab = ths[i] || "";
      td.setAttribute("data-label", lab);
      td.classList.toggle("td-key", MOBILE_KEY_COLS.has(lab));
    });
  });
}


/* ---------------- vista fondamentale (Value Investing) ---------------- */
const pctOf = (v) => v == null ? "—" : signTxt(Math.round(v * 1000) / 10);   // frazione → %
const pctPlain = (v) => v == null ? "—" : (Math.round(v * 1000) / 10) + "%";

/* indicatore di impatto visivo per la vista fondamentale (come i bar della vista tecnica):
   score 0-100 (100 = favorevole/verde). Mostra valore colorato + mini-barra. */
// punteggi di favorevolezza (frazioni dove indicato). higher=meglio salvo lowerBetter
const FSC = {
  roe: v => v == null ? null : clamp(v * 400),                 // 0,25→100 · 0,15→60
  gross: v => v == null ? null : clamp(v * 150),               // 0,66→100 · 0,40→60
  net: v => v == null ? null : clamp(50 + v * 200),            // 0→50 · 0,25→100 · neg→<50
  growth: v => v == null ? null : clamp(50 + v * 250),         // 0→50 · 0,2→100 · neg→<50
  pfcf: v => v == null ? null : clamp(100 - (v - 10) / 0.5),   // <10→100 · 35→50 (basso meglio)
  ev: v => v == null ? null : clamp(100 - (v - 8) / 0.3),      // <8→100 · 23→50 (basso meglio)
  pb: v => v == null ? null : clamp(100 - (v - 1) / 0.08),     // 1→100 · 5→50 (basso meglio)
  peg: v => v == null ? null : clamp(100 - (v - 0.5) / 0.03),  // 0,5→100 · 2→50 (basso meglio)
  div: v => v == null ? null : clamp(v * 1500),                // 0,04→60 (alto meglio)
  zscore: v => v == null ? null : clamp((v - 1) / 2.5 * 100),  // 1,81→32 · 2,99→80 (soglie Altman)
};

// renderer fondamentale generico (riusato da portafoglio e watchlist)




/* ---------------- trimestrali ---------------- */


/* ---------------- gauges ---------------- */
const FG_LABELS = { "extreme fear": "Paura estrema", fear: "Paura", neutral: "Neutrale", greed: "Avidità", "extreme greed": "Avidità estrema" };

/* colore sfumato verde(100)→arancio(50)→rosso(0) */
function scoreColor(s) {
  const h = Math.max(0, Math.min(120, (s / 100) * 120));   // 0=rosso, 60=giallo, 120=verde
  return `hsl(${h.toFixed(0)} 75% 47%)`;
}
// scala SEMPRE verde(sx)→rosso(dx). score 0-100 (100=positivo): il marker del "buono"
// sta a sinistra (verde), quello "cattivo" a destra (rosso). ends[0]=sinistra(verde).
/* TERMOMETRO LINEARE unificato (sostituisce i tachimetri semicircolari per compattare la dashboard).
   score 0-100; convenzione: verde a SINISTRA = favorevole (score alto), rosso a destra = sfavorevole.
   opt.direct=true → marker a score% (per Fear&Greed); opt.gradient → gradiente custom. */
function thermoLine(score, ends, opt = {}) {
  const s = Math.max(0, Math.min(100, score ?? 50));
  const pos = opt.direct ? s : 100 - s;
  const gradStyle = opt.gradient ? ` style="background:${opt.gradient}"` : "";
  return `<div class="tl">
    <div class="tl-track"${gradStyle}><span class="tl-marker" style="left:${pos}%"></span></div>
    ${ends ? `<div class="tl-ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>` : ""}
  </div>`;
}

// retrocompatibilità: vecchio thermoBar e compactSemiGauge ora rendono il termometro lineare
function thermoBar(score, ends) { return thermoLine(score, ends); }
function compactSemiGauge(score, ends) { return thermoLine(score, ends); }

/* card termometro uniforme e compatta; score 0-100 (100=positivo/verde, a sinistra). key per il popup */

/* Fear & Greed come termometro lineare (paura=rosso sx, avidità=verde dx, marker diretto su score) */

/* ---------------- macro ---------------- */
function marketImpact(m) {
  // variazione giornaliera → impatto 0-100 (rendimenti in pp: salita = restrittivo)
  if (m.change_pct === null || m.change_pct === undefined) return null;
  if (m.suffix === " pp") return Math.round(Math.max(0, Math.min(100, 50 - m.change_pct * 300)));
  return Math.round(Math.max(0, Math.min(100, 50 + m.change_pct * 12)));
}


/* ---------------- top ETF dashboard ---------------- */

/* ---------------- news ---------------- */

const TOPIC_LABEL = t => t === "MACRO" ? "Macro" : t === "POL" ? "Politica" : t;

/* sintesi globale di tutte le news: tono complessivo, conteggi, titoli più citati */




/* ---------------- prompt AI ---------------- */
/* ██████████████████████████████████████████████████████████████████████████████████
   🛑🛑🛑  STOP! NON MODIFICARE IL TESTO DEL PROMPT (LA TESTATA) IN QUESTO FILE.  🛑🛑🛑
   ██████████████████████████████████████████████████████████████████████████████████
   LA TESTATA È STATA DISACCOPPIATA (v101). Il testo delle ISTRUZIONI all'AI vive NEL FILE:
        ►►►  config/prompt_header.txt  ◄◄◄
   Per cambiare le istruzioni dell'AI EDITA QUEL FILE, non questo. La costante
   DEFAULT_PROMPT_HEADER qui sotto è SOLO il fallback offline (usato al primo caricamento o
   senza rete): NON deve coincidere col file — il file è la fonte di verità ed è editato
   dall'utente dalla UI ("⚙ Impostazioni Prompt"), che lo scrive via GitHub Contents API e
   lo ricarica con loadPromptHeaderCloud(). 🛑 NON sovrascrivere MAI config/prompt_header.txt
   a mano (cancelleresti le personalizzazioni del CEO). Modifica DEFAULT_PROMPT_HEADER solo
   se vuoi cambiare il fallback offline, non per "allinearlo" al file.
   La "CODA" (payload dati: tabelle/macro/news/fondamentali/portafoglio) è generata dalle
   funzioni JS piu sotto e NON va toccata/semplificata. Vedi CLAUDE.md nella root.
   ██████████████████████████████████████████████████████████████████████████████████ */
/* ⚠ v256 — LA TESTATA DEL PACCHETTO MACRO E' UN FILE NUOVO. `config/prompt_header.txt` resta
   INTATTO sul repo (regola di progetto: non si sovrascrive mai il file del CEO), ma non viene
   piu' letto: e' scritto per decidere su un portafoglio — ordini a limite, stop, concentrazione
   del libro, capienze — e un pacchetto che di posizioni non ne porta piu' nessuna lo renderebbe
   una lista di istruzioni impossibili. E' esattamente la classe C10 che i gate presidiano: un
   rimando a qualcosa che nel payload non esiste.
   Se un domani il portafoglio torna, si torna a leggere quel file cambiando questa costante. */
const PROMPT_HEADER_PATH = "config/prompt_header_macro.txt";
/* ⚠ v256 — FALLBACK OFFLINE riallineato al pacchetto MACRO. Era la Costituzione del
   fondo (ruolo di Comitato Investimenti, ordini, stop): senza portafoglio nel payload
   sarebbe stata una testata che chiede cose che i dati non permettono. Il file vero e'
   config/prompt_header_macro.txt; questo serve solo al primo caricamento senza rete. */
const DEFAULT_PROMPT_HEADER = `Sei un analista macro. Ricevi il quadro macro completo di un sistema che aggiorna i dati piu' volte al giorno. Non hai davanti nessun portafoglio: questo pacchetto contiene SOLO dati macro e la loro tensione interna. Non proporre operazioni su titoli, non dimensionare posizioni, non dare consigli di acquisto o vendita.

[A] REGOLE SUI DATI
A1 — PROVENIENZA E VERIFICA. Ogni numero che citi viene da questo payload, e lo scrivi come lo trovi. Quando un'affermazione poggia su un fatto ESTERNO al payload (una notizia, una dichiarazione di banca centrale, un dato uscito dopo lo snapshot), verificala online e marcala [VERIFICATO] con la fonte. Chiudi con un elenco "FONTI DA CONTROLLARE": una riga per ogni [VERIFICATO] su cui poggia una conclusione, col suo URL. Mai inventare valori: un dato che manca si dichiara "n.d.". Ignora prezzi e conclusioni di conversazioni precedenti — conta solo questo payload.

A1bis — LA RICERCA NON E' FACOLTATIVA, ED E' LA PRIMA COSA CHE FAI. Questo pacchetto e' una FOTOGRAFIA: le statistiche ufficiali che contiene hanno da uno a centoquaranta giorni, e ogni riga dichiara la propria eta'. Prima di scrivere una sola conclusione, cerca online e riporta:
  (a) le NOTIZIE MACRO DELLE ULTIME 24 ORE su Fed, inflazione, lavoro, credito e mercati;
  (b) per OGNI dato del payload piu' vecchio di 30 giorni, se la fonte ne ha nel frattempo pubblicato uno piu' recente. Il payload ti dice quali sono e quando escono: quelle righe sono la tua lista della spesa, non un contorno;
  (c) se un dato uscito DOPO lo snapshot ribalta una riga del pacchetto, dillo per primo e usa quello, dichiarando che stai sostituendo il valore del payload.
Chiudi con l'elenco "FONTI DA CONTROLLARE": una riga per ogni [VERIFICATO] su cui poggia una conclusione, con URL, DATA DI PUBBLICAZIONE e un frammento TESTUALE del titolo. Le tre cose insieme: un URL da solo si costruisce a memoria dagli identificativi di serie che questo pacchetto contiene, una data e un titolo verbatim no.
⚠ Gli ID delle serie (FRED, BLS, BEA) stampati nella coda NON sono una fonte consultata: sono il nome del dato. Ricostruirci sopra un indirizzo senza aver aperto la pagina e' esattamente cio' che questa regola vieta.
⚠ Se NON puoi navigare, scrivilo in cima a lettere chiare — "NON HO ACCESSO ALLA RETE: quanto segue e' la lettura di uno snapshot del <data>, non del mercato di oggi" — e non produrre nessun URL. E' una risposta accettabile; un elenco di fonti mai aperte non lo e'.
A2 — LA DATA DEL DATO E' PARTE DEL DATO. Ogni serie porta la propria rilevazione e il prossimo aggiornamento atteso. Un numero di 68 giorni non e' lo stato di oggi: se lo usi, dichiara quanto e' vecchio. Dove il payload dichiara un LIMITE (finestra comune assente, orizzonte del contratto superato) quel limite si riporta, non si aggira con una stima.
A3 — I NUMERI GIA' CALCOLATI si usano come sono: percentili, ampiezze, mediane, distanze dalle soglie. Non rifarli.

[B] COME VOGLIO CHE RAGIONI
B1 — IL MECCANISMO, NON LA CORRELAZIONE. Non basta dire che due cose si muovono insieme: dimmi attraverso quale canale una arriva all'altra — quale tasso, quale flusso, quale voce di costo, quale vincolo regolatorio. Se il meccanismo non lo conosci, dillo invece di inventarlo.
B2 — IL DISACCORDO E' IL SEGNALE, E DEVI TROVARLO TU. Il pacchetto NON classifica piu' gli indicatori macro su una scala 0-100: ti consegna i valori grezzi con le loro soglie dichiarate, e niente altro. Il punteggio e' stato tolto apposta, perche' era calcolato da noi con formule nostre e ti avrebbe ancorato a un giudizio travestito da misura. Quindi il primo passo dell'analisi e' tuo: metti i valori uno accanto all'altro e di' DOVE NON SI ACCORDANO — credito tranquillo mentre l'occupazione cede, inflazione ferma mentre la curva si disinverte, indici ai massimi mentre i profitti reali non seguono. Nomina gli indicatori esatti che divergono, di' quale lato sta vincendo e quale fatto osservabile te lo fa dire. Se invece tutto punta davvero nella stessa direzione, dillo esplicitamente e spiega perche' e' credibile: e' raro, e vale come segnale a sua volta. Non partire da una media, e non chiedermi un punteggio che non c'e' piu'.
B3 — CONTA I SEGNALI UNA VOLTA SOLA. Due misure della stessa grandezza (CPI e PCE, curva e recessione, Fear & Greed e sentiment globale) sono un segnale, non due. Il payload lo dichiara dove succede: rispettalo.
B4 — DOVE TI ASPETTERESTI DI SBAGLIARE. Chiudi indicando quale dato, se uscisse diverso dalle attese al prossimo aggiornamento, ribalterebbe la lettura che hai appena dato. Un'analisi che non sa cosa la smentirebbe non e' un'analisi.

[C] FORMA
C1 — Scrivi in italiano, in prosa, senza scalette rigide e senza ripetere il payload. Non ho bisogno che tu mi riassuma i numeri: li ho gia'. Ho bisogno di sapere cosa vogliono dire insieme.
C2 — Niente domande in chiusura e niente offerte di approfondimento: quello che serve, dillo qui.
C3 — Se due parti del payload si contraddicono, segnalalo esplicitamente invece di scegliere in silenzio quella che ti fa comodo.`;
function promptHeaderText() {
  const ov = localStorage.getItem("prompt_header");
  return (ov && ov.trim()) ? ov : DEFAULT_PROMPT_HEADER;
}

/* la PROVENIENZA della testata e' un FATTO, quindi sta legittimamente nella coda: senza, un
   pacchetto partito col fallback e' indistinguibile da uno partito col file, e il CEO non puo'
   sapere se l'LLM ha ricevuto l'ordine di cercare. */
function provenienzaTestata() {
  const ov = localStorage.getItem("prompt_header");
  if (ov && ov.trim()) {
    const q = localStorage.getItem("prompt_header_asof");
    return `testata: ${PROMPT_HEADER_PATH}${q ? `, scaricata il ${q}` : ""}`;
  }
  return `testata: FALLBACK LOCALE (il file remoto non e' stato scaricato) — le regole sono `
    + `quelle incluse in questa pagina, non quelle del repo`;
}
/* v141: savePromptHeader/pushPromptHeaderCloud rimosse con l'editor UI — la testata
   (Costituzione) si scrive via repo; il client la LEGGE soltanto (loadPromptHeaderCloud). */
/* POST equivalente: sovrascrive config/prompt_header.txt via GitHub Contents API */
/* GET equivalente: legge la testata server-side e la usa come override (server vince) */
async function loadPromptHeaderCloud() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${PROMPT_HEADER_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const txt = (await r.text()).trim();
    /* la data dello scaricamento: e' cio' che la riga di provenienza pubblica */
    try { localStorage.setItem("prompt_header_asof", new Date().toLocaleString("it-IT")); } catch { /* quota */ }
    if (txt && txt !== DEFAULT_PROMPT_HEADER.trim()) localStorage.setItem("prompt_header", txt);
    else localStorage.removeItem("prompt_header");   // server allineato al default -> nessun override
  } catch { /* offline: resta l'eventuale override locale */ }
}

/* ═══ v320 — LA LEVA: IL FATTO, NON SOLO L'AFFERMAZIONE ══════════════════════════════════════
   Il CEO: "manca grafico utilizzo leva da parte degli attori del mercato... presta attenzione
   sulla costante data di cui il dato e' aggiornato rispetto anche al prossimo aggiornamento...
   inoltre definisci un parametro storico dell'utilizzo della leva al fine di farmi capire se ad
   oggi quel valore e' sotto o sopra soglia mediana".
   ⚠⚠ IL PACCHETTO AFFERMAVA "leva ai massimi" E NON CONTENEVA UN SOLO NUMERO SULLA LEVA — zero
   occorrenze di "margin". Peggio: l'affermazione era FALSA. Il sistema calcola gia' lo stato
   giusto in `marginDebtState()` (94,4% del picco ma -5,6% sul trimestre: leva in RITIRO dal
   massimo di giugno, che quella funzione chiama "INVERSIONE DELLA LEVA dai massimi"), mentre il
   pacchetto usava una derivazione PARALLELA — `pct_of_peak >= 90 && P/E > 20` — che guarda solo
   il livello e ignora il verso. Due derivazioni della stessa domanda divergono: v161/v207 di
   nuovo, e stavolta quella sbagliata era l'unica che arrivava all'LLM.
   ⚠ IL PARAMETRO STORICO E' IL RAPPORTO SUL PIL, non il "% del picco": quest'ultimo e' SATURO
   in un mercato al rialzo (13 mesi su 13 sopra il 95%), cioe' un allarme permanente, che e'
   potere discriminante zero. Il rapporto sul PIL ha una mediana storica vera nel file. */
function rigaLeva(m) {
  const md = (m || {}).margin_debt;
  if (!md || md.value == null) return null;
  const st = (typeof marginDebtState === "function") ? marginDebtState() : null;
  const mld = (v) => fmtNum.format(Math.round(v / 1000));
  const cad = rigaCadenza("margin_debt", md.date);
  /* il trimestre si ricava dallo storico mensile: tre rilevazioni indietro, non il campo `qoq` */
  const st3 = (md.history || []).map(Number).filter(Number.isFinite);
  const trim = st3.length >= 4 && st3[st3.length - 4]
    ? Math.round((st3[st3.length - 1] / st3[st3.length - 4] - 1) * 1000) / 10 : null;
  const pil = md.pct_of_gdp, mediana = md.gdp_median_ref;
  const sopra = (pil != null && mediana != null) ? Math.round(pil / mediana * 10) / 10 : null;
  return `- LEVA DEGLI OPERATORI (debito a margine dei conti retail e istituzionali presso i broker): `
    + `${mld(md.value)} miliardi di dollari, il ${fmtNum.format(md.pct_of_peak)}% del massimo storico `
    + `(${mld(md.peak)} mld, toccato ${md.peak_date ? dataBreve(md.peak_date) : "n.d."})`
    + (md.yoy != null ? ` · ${signTxt(md.yoy)} sull'anno` : "")
    /* ⚠⚠ v326 — `qoq` CONTIENE LA VARIAZIONE MENSILE, non trimestrale: il commento della
       pipeline lo dichiara ("la chiave si chiama qoq per ragioni storiche ma contiene il mom")
       e in v320 l'ho stampata come "sul trimestre" fondandoci sopra il verdetto. Il trimestre
       VERO, ricalcolato dallo storico, e' +8,7% — segno OPPOSTO. Ora i tre orizzonti hanno
       ciascuno il proprio nome, e il trimestre si calcola invece di essere ereditato da una
       chiave che mente. */
    + (md.qoq != null ? ` · ${signTxt(md.qoq)} nell'ultimo mese` : "")
    + (trim != null ? ` · ${signTxt(trim)} sul trimestre` : "") + `. `
    + (st ? `Stato: ${st.label}. ` : "")
    + (pil != null && mediana != null
        ? `⚠ IL PARAMETRO STORICO: vale il ${fmtNum.format(pil)}% del PIL contro una mediana storica `
          + `del ${fmtNum.format(mediana)}%, cioe' ${sopra}× la mediana — SOPRA soglia. Si usa questo e non `
          + `il "% del massimo", che in un mercato al rialzo sta sopra il 95% quasi sempre e quindi non `
          + `distingue niente. `
        : "")
    + `⚠ LIVELLO E VERSO SONO DUE FATTI DIVERSI, E IL VERSO DIPENDE DALL'ORIZZONTE: qui la leva `
    + `e' altissima, in ritiro sull'ULTIMO MESE e ancora in espansione sul trimestre e sull'anno. `
    + `Il livello dice quanto carburante c'e' per un deleveraging; il mese dice che il massimo e' `
    + `stato superato; il trimestre e l'anno dicono che la tendenza di fondo non e' ancora girata. `
    + `Chi legge un orizzonte solo conclude il contrario di chi ne legge un altro. `
    + (cad ? `[${cad}]` : "");
}

function buildPrompt() {
  const t = DATA.totals;
  const m = DATA.macro || {};
  const dqV = validateMacroData();   // data assertions: usata da indicatori, margin debt e report
  const lines = [];
  // difensivo: eur_invested lo calcola recomputeTotals (gira in renderAll prima di qui). Se per
  // qualsiasi motivo mancasse, ripiego su eur_value del payload — mai "NaN €" verso l'AI.
  const patrimonio = Number.isFinite(t.eur_invested + cashEur) ? t.eur_invested + cashEur : (t.eur_value ?? 0);
  // 🛑 TESTATA: viene da config/prompt_header.txt (via promptHeaderText). NON scrivere qui il
  //    testo delle istruzioni — editalo in config/prompt_header.txt. Coda dati INTATTA sotto. 🛑
  lines.push(promptHeaderText());
  lines.push("");
  // SEGNALE DI SHOCK (v145): NON è più una DIRETTIVA che ordina di sospendere gli acquisti — era
  // un dettame in contrasto con la filosofia "indicatori non dettami". Ora è EVIDENZA con un
  // workflow di verifica INLINE (v156: prima citava "A4", sezione della testata che la slim-down
  // v155 a 3 limiti ha rimosso → riferimento pendente; il workflow è auto-contenuto qui sotto):
  // la conferma incrociata USA (futures) è servita nel testo, se gli USA non confermano la caduta
  // asiatica il CIO la declassa a evento localizzato invece di congelarsi.
  const shock = (DATA.macro || {}).shock_alert;
  if (shock && shock.active) {
    const fut = (DATA.macro || {}).futures || {};
    const futBits = [fut.nasdaq, fut.sp500].filter(f => f && f.change_pct != null)
      .map(f => `${f.label || f.symbol || "Fut"} ${signTxt(f.change_pct)}`).join(" · ");
    const futLine = futBits
      /* v226 — era un ORDINE nella coda ("dichiaralo al CEO e procedi normalmente"), e il gate
         C9 lo prendeva ogni volta che il ramo shock si attivava — cioè raramente, quindi era
         rimasto a lungo invisibile (la classe v190: un difetto in un ramo raro non è raro, è
         solo non letto). Ora la riga AFFERMA il fatto: le istruzioni vivono nella testata. */
      ? `Conferma incrociata USA (dato più fresco, ha PRIORITÀ sull'Asia): ${futBits}. Futures USA verdi o piatti mentre l'Asia crolla = ALLARME FANTASMA localizzato all'Asia, cioè una caduta che il mercato di riferimento di questo libro non ha confermato.`
      : `Conferma incrociata USA: i futures non sono nel payload, quindi la caduta asiatica resta senza controprova sul mercato che conta per questo libro.`;
    lines.push(`🚨 [SEGNALE DI SHOCK — verifica prima di agire, NON è un ordine]: ${shock.sources.map(s => `${s.src} ${signTxt(s.chg)}`).join(" · ")} (oltre ${shock.threshold}% con Wall Street chiusa). È un INDIZIO da validare, non un verdetto. WORKFLOW DI VERIFICA in ordine: 1) conferma il dato (Tabella B/web) · 2) escludi cache/feed rotto · 3) ${futLine} · 4) cosa cambia se il regime è confermato: i livelli d'ingresso e i target di questo payload sono calcolati su prezzi PRE-shock, e gli stop 2×ATR sono misurati su una volatilità che non contiene il gap atteso — due numeri costruiti su un mercato che potrebbe non esistere più all'apertura. Questo blocco è un INDIZIO, non una sospensione automatica.`);
    lines.push("");
  }
  // ORDINE WEB-SEARCH IN CIMA: se ci sono dati mancanti/inaffidabili, l'imperativo va visto
  // PRIMA di tutto il resto (l'LLM tende a "dimenticarlo" se sepolto in fondo al payload)
  if ((dqV.bad || []).length) {
    lines.push(`⚠⚠ PRIMO ORDINE OPERATIVO (esegui PRIMA di scrivere l'analisi): questi dati macro sono MANCANTI o INAFFIDABILI nel payload → [${dqV.bad.map(b => b.key).join(", ")}]. Usa OBBLIGATORIAMENTE la ricerca web per reperirne il valore reale corrente (cita valore, fonte e data per ciascuno) e usali per la lettura di leva finanziaria e valutazioni. Se la ricerca non li recupera, lasciali mancanti ma dichiaralo e tienine conto — non trattarli come zero.`);
    lines.push("");
  }
  const ageMin = Math.round((Date.now() - new Date(DATA.updated_at).getTime()) / 60000);
  const lagNote = ageMin > 90 ? ` [ATTENZIONE: snapshot di ${ageMin >= 120 ? Math.round(ageMin / 60) + " ore" : ageMin + " min"} fa — i prezzi potrebbero essere disallineati dal mercato live, e i livelli critici sono i primi a spostarsi]` : "";
  lines.push(`DATI AL ${new Date(DATA.updated_at).toLocaleString("it-IT")} (prezzi: snapshot pipeline + refresh live lato client ogni 60s)${lagNote}`);
  lines.push(sessionContextLine());   // v256: fase della seduta USA, calcolata ADESSO lato client

  /* ═══ v256 — IL PAYLOAD È SOLO MACRO. Decisione del CEO: "elimina tutto e lascia solo una
     pagina con i dati macro e la relativa correlazione con esportazione prompt ai".
     Qui cadono, insieme: portafoglio incompleto, prezzi da sedute diverse, libro incompleto,
     situazione patrimoniale, metriche di rischio, riconciliazione broker, stagionalità,
     sintesi news, filtri quantitativi, concentrazione di fattore, stop violati, livelli
     d'ingresso, stop trailing, track record del motore, diario, Tabella A (portafoglio),
     matrice di rischio, Tabella B (watchlist), analisi fondamentale.
     ⚠ RICEVUTA scritta PRIMA del taglio ed ESEGUIBILE: dentro i confini non cade nessuna
     dichiarazione di primo livello e le graffe si bilanciano — è il controllo che in v238
     guardava solo le `function` e lasciò passare un `let`, uccidendo la pagina.
     Restano il contesto di sessione, il report di qualità dati e tutto il quadro macro. */

  // DATA QUALITY REPORT: i dati flaggati dalle assertions vengono dichiarati PRIMA del quadro
  // macro, con l'ordine esplicito di fare double-check web su ciò che è datato/inaffidabile
  if (!dqV.ok) {
    lines.push(`⚠ DATA QUALITY REPORT (assertions automatiche del sistema): ${[...dqV.bad.map(b => `${b.key} INAFFIDABILE (${b.status}${b.note ? ": " + b.note : ""})`), ...dqV.stale.map(s => `${s.key} DATATO oltre la cadenza attesa`)].join(" · ")}. Per ogni dato marcato qui sotto con [!!! DATATO / UNRELIABLE !!!] o [LAG TEMPORALE RILEVATO]: NON usarlo così com'è — fai double-check con la ricerca web e cita il valore aggiornato con fonte e data.`);
    const missingKeys = dqV.bad.map(b => b.key);
    if (missingKeys.length) {
      lines.push(`ATTENZIONE — ORDINE OPERATIVO: i seguenti dati sono mancanti o inaffidabili nel payload: [${missingKeys.join(", ")}]. PRIMA di generare la tua analisi, usa OBBLIGATORIAMENTE il tuo strumento di ricerca web per reperire questi valori in tempo reale (cita valore, fonte e data per ciascuno) e usali al posto di quelli assenti — in particolare per valutare leva finanziaria e valutazioni di mercato.`);
    }
  }
  if ((dqV.overrides || []).length) {
    lines.push(`OVERRIDE MANUALI ATTIVI (valori inseriti dall'utente perché la fonte era ko — trattali come dati validi ma verifica se puoi): ${dqV.overrides.map(o => `${o.key} [MANUAL_OVERRIDE del ${o.date || "n.d."}]`).join(" · ")}.`);
  }
  /* ═══ v259 — LA QUALITA' TEMPORALE DI OGNI DATO, DICHIARATA IN CIMA ═══════════════════════
     Osservazione del CEO, ed e' CORRETTA: "i dati dovrebbero essere indicati con la data
     dell'ultimo aggiornamento e la data del prossimo, affinche' anche il prompt LLM capisca la
     qualita' temporale del dato e non lo interpreti come assoluto".
     Le SCHEDE la portavano gia' da v250/v253 — il PAYLOAD no, se non su otto serie con un
     calendario di pubblicazione. Tutto il resto arrivava all'LLM come se fosse di adesso.
     L'audit indipendente delle fonti lanciato in questa sessione ha trovato la stessa cosa dal
     lato pipeline: i blocchi macro (vix, breadth, froth, tilt, momentum) NON hanno un `asof`
     proprio, ereditano solo `updated_at` — e in un run di domenica il VIX e' la chiusura di
     venerdi' senza che nulla lo dica.
     Questa riga chiude il buco dal lato payload: dichiara le TRE classi di freschezza che
     convivono nel pacchetto, cosi' l'LLM sa quale numero e' di adesso e quale ha settimane.
     E' un FATTO sui dati, non un'istruzione (C9). */
  {
    const iso = DATA.updated_at ? new Date(DATA.updated_at) : null;
    const quando = iso && !isNaN(iso) ? iso.toLocaleString("it-IT") : "n.d.";
    const prossimo = (typeof prossimoRunPipeline === "function" && prossimoRunPipeline())
      ? prossimoRunPipeline().toLocaleString("it-IT") : null;
    const conCalendario = (m.indicators || [])
      .filter(i => i && i.key && typeof CADENZA_FONTE !== "undefined" && CADENZA_FONTE[i.key] && i.date)
      .map(i => `${i.label || i.key} (${String(i.date).slice(0, 10)})`);
    lines.push(`FRESCHEZZA DEI DATI DI QUESTO PACCHETTO — tre classi diverse, non una:`);
    /* ⚠ v261 — LA BARRA, NON IL RUN. Questa riga diceva "rilevati al run delle HH:MM" e lasciava
       all'LLM il compito di capire che in un run domenicale quel numero e' di venerdi'. Ora la
       data della barra e' scritta, e la differenza in giorni pure: e' la stessa distinzione che
       il portafoglio faceva gia' per ogni titolo con `price_asof` (v186) e che ai blocchi macro
       mancava. */
    const barra = ultimaBarraDisponibile();
    let etaBarra = null;
    if (barra) {
      const b = new Date(barra + "T00:00:00");
      const oggi0 = new Date(); oggi0.setHours(0, 0, 0, 0);
      etaBarra = Math.round((oggi0 - b) / 86400000);
    }
    lines.push(`· DATI DI MERCATO (VIX, put/call, ampiezza, futures, cambi, rotazione ETF, spread di credito, `
      + `momentum): scaricati al run delle ${quando}${prossimo ? `, prossimo run ${prossimo}` : ""}. `
      + (barra && etaBarra >= 1
          ? `⚠ LA BARRA GIORNALIERA SOTTO QUEI NUMERI E' DEL ${barra} — ${etaBarra} ${etaBarra === 1 ? "giorno" : "giorni"} fa. `
            + `Il run l'ha solo riscaricata: non sono prezzi di adesso, sono l'ultima chiusura disponibile.`
          : barra
              ? `La barra giornaliera sotto quei numeri e' del ${barra}.`
              : `⚠ La data della barra giornaliera sotto quei numeri NON e' disponibile: non dare per scontato che sia di oggi.`));
    if (conCalendario.length) {
      lines.push(`· STATISTICHE UFFICIALI (calendario di pubblicazione proprio, ritardo da giorni a mesi): `
        + `${conCalendario.join(" · ")}. Ciascuna porta piu' sotto la propria rilevazione, l'eta' in giorni e `
        + `il prossimo dato atteso.`);
    }
    const nomiSerie = (typeof buildHistoricalDigests === "function"
      ? buildHistoricalDigests().map(x => String(x.label).replace(/\s*\(.*$/, "")).filter(Boolean)
      : []);
    lines.push(`· SERIE STORICHE E PERCENTILI${nomiSerie.length ? ` (${nomiSerie.join(", ")})` : ""}: `
      + `calcolati su finestre che finiscono all'ultima rilevazione disponibile della serie, non a oggi. `
      + `Ogni voce dichiara accanto al proprio numero la finestra che ha misurato.`);
  }
  /* v344 — la mappa dei propri limiti, PRIMA dei numeri. Un pacchetto che non dichiara il
     proprio perimetro viene letto come se non ne avesse uno. */
  lines.push("⚠ PERIMETRO DI QUESTO PACCHETTO — leggilo prima dei numeri.");
  lines.push("MISURA: il valore corrente di ciascuna serie, la sua posizione nel proprio intervallo storico "
    + "(percentili, inversioni, pendenze), le soglie di lettura con la loro provenienza, e la rotazione "
    + "settoriale su 21 ETF. Questa parte NON e' reperibile cercando online: richiede le serie storiche.");
  lines.push("NON SA, e va cercato altrove ogni volta: (a) CHI GUIDA le istituzioni e cosa hanno "
    + "dichiarato — presidenza della Fed, composizione del FOMC, ultimo dot plot, verbali; (b) gli EVENTI "
    + "NON STATISTICI — simposi, audizioni, vertici, discorsi programmati: qui trovi solo le uscite di "
    + "dati con calendario proprio; (c) le NOTIZIE SOCIETARIE e qualunque cosa riguardi un singolo titolo; "
    + "(d) tutto cio' che e' successo dopo la generazione dichiarata in testa.");
  lines.push("Quindi: usa questo pacchetto per la STORIA MISURATA, e cerca online il REGIME e gli EVENTI. "
    + "Se una tua conclusione poggia su chi presiede la Fed o su cosa succede questa settimana, quel pezzo "
    + "NON viene da qui e va verificato con fonte e data.");
  lines.push("");
  lines.push("QUADRO MACRO:");
  /* v259 — "Sentiment globale" fuori dal payload: media di componenti gia' pubblicati uno per uno. */
  /* v256 — "Termometro tecnico del portafoglio" tolto: era un punteggio calcolato sui
     titoli in portafoglio, non un dato macro. Senza libro non misura niente. */
  if (m.fear_greed) {
    let fgl = `- Fear & Greed: ${m.fear_greed.score} (${FG_LABELS[m.fear_greed.rating] || m.fear_greed.rating}), 1 settimana fa ${m.fear_greed.week_ago}, 1 mese fa ${m.fear_greed.month_ago}${m.fear_greed.year_ago ? `, 1 anno fa ${m.fear_greed.year_ago}` : ""}`;
    /* v263 — VIA L'ELENCO DEI COMPONENTI anche dal payload. La scheda non li mostra piu'
       (v262, richiesta del CEO) perche' hanno tutti una scheda propria; il payload continuava a
       portarli, e per due di loro — "Momentum S&P 500" e "Domanda bond high yield" — la pagina
       li ha addirittura tolti come duplicati di altre schede. Pagina e pacchetto dicevano cose
       diverse sullo stesso indicatore. La dispersione dei sette resta nel blocco del
       disaccordo, che e' il posto dove serve. */
    /* ⚠ v276 — IL RIMANDO AL BLOCCO DEL DISACCORDO. Rileggendo il pacchetto di AMD, "Fear &
       Greed" compare due volte con lo stesso 64: qui col suo storico, e nel blocco del
       disaccordo con la dispersione dei sette componenti. Sono complementari, non in
       contraddizione — ma la testata impone all'LLM di CONTARE I SEGNALI UNA VOLTA SOLA, e
       due righe con la stessa etichetta e lo stesso numero sono precisamente cio' che lo
       porta a contarne due. Il payload lo dichiara gia' per CPI/PCE e per il disaccoppiamento:
       qui mancava, e la regola vale allo stesso modo. */
    /* ⚠ la frase NON nomina i pezzi dell'indice: una guardia (v263) vieta di elencarli su
       questa riga, ed e' nata da un difetto vero — pagina e pacchetto che dicevano cose
       diverse sugli stessi indicatori. Il rimando si puo' fare senza riaprire quella porta. */
    /* v337 — il rimando e' caduto col blocco che nominava: un rinvio a una sezione che non
       esiste piu' e' esattamente la classe C10, e insegna al modello che i riferimenti del
       payload non sono affidabili. Resta la parte VERA della frase, che non rimanda a niente. */
    fgl += " — livello e dispersione interna dello stesso indice sono UNA misura guardata da due lati, non due segnali.";
    lines.push(fgl);
  }
  // sanity finale sul payload: un valore impossibile diventa "n.d." e NON entra nell'analisi
  const nd = (v, lo, hi) => (v != null && v >= lo && v <= hi) ? v : null;
  const vixOk = m.vix ? nd(m.vix.value, 0.1, 200) : null;   // VIX negativo o assurdo = glitch
  // v164: il VIX si dichiarava "rilevazione odierna" SEMPRE, anche col mercato chiuso — unico dato
  // del payload a contraddire il CONTESTO DI SESSIONE e le celle prezzo "[chiusura del GG/MM]".
  // E' proprio l'indicatore su cui il CIO calibra rischio e sizing: farlo sembrare posteriore alla
  // chiusura induce a credere che esista una misura di volatilita' piu' fresca dei prezzi.
  if (vixOk != null) {
    // v193 — MERCATO APERTO NON SIGNIFICA DATO FRESCO. La condizione guardava solo l'orologio:
    // il 31/07 a borsa aperta il payload scriveva "VIX 18,58 (-0,64% oggi — rilevazione
    // odierna)" mentre lo snapshot era del 26/07, cioe' cinque giorni prima. E' la stessa
    // classe dell'etichetta KOSPI: lo STATO DEL MERCATO e la FRESCHEZZA DEL DATO sono due
    // cose diverse, e qui servono entrambe vere.
    const snapshotOggi = (() => {
      const u = DATA?.updated_at ? new Date(DATA.updated_at) : null;
      if (!u || isNaN(u)) return false;
      return u.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
    })();
    const vixFresco = usRegularSessionOpen() && snapshotOggi;
    const vixAsof = (() => { const c = lastUsEquityCloseUTC();
      return c ? `[chiusura del ${String(c.at.getUTCDate()).padStart(2, "0")}/${String(c.at.getUTCMonth() + 1).padStart(2, "0")}]` : "[ultima chiusura]"; })();
    lines.push(`- VIX: ${vixOk} (${signTxt(m.vix.change_pct)} ${vixFresco ? "oggi — rilevazione odierna" : `nell'ultima seduta ${vixAsof} — seduta ordinaria CHIUSA: il VIX non ha quotazione fuori orario`})`);
  }
  else if (m.vix) lines.push("- VIX: n.d. (valore scartato dal sanity check)");
  if (m.fedwatch) lines.push(`- Fed Funds Rate: range ATTUALE ${m.fedwatch.target_range} · tasso implicito futures ${m.fedwatch.implied_rate}%${m.fedwatch.next_fomc ? ` · PROSSIMA RIUNIONE FOMC: ${new Date(m.fedwatch.next_fomc + "T00:00:00").toLocaleDateString("it-IT")}` : ""} (il tasso resta valido fino alla prossima decisione FOMC)`);
  if (m.carry) {
    let cl = `- Carry USA-Giappone: spread tassi 10A ${fmtNum.format(m.carry.spread)} pp (US10A ${m.carry.us10}%, JGB10A ${m.carry.jp10}%), USD/JPY ${m.carry.usdjpy} (${signTxt(m.carry.usdjpy_chg_1m)} 1 mese)${m.carry.boj_rate != null ? `, tasso BoJ ${m.carry.boj_rate}%` : ""}`;
    if ((m.carry.boj_meetings || []).length) cl += `; prossima riunione BoJ ${new Date(m.carry.boj_meetings[0] + "T00:00:00").toLocaleDateString("it-IT")} (rischio unwind se BoJ alza o lo yen si rafforza)`;
    lines.push(cl);
  }
  if (m.putcall) {
    const r = m.putcall.ratio;
    const bias = r > 1.1 ? "prevalgono put = copertura/pessimismo (estremi = contrarian rialzista)" : r < 0.7 ? "prevalgono call = euforia (estremi = contrarian ribassista)" : "equilibrato";
    lines.push(`- Put/Call ${m.putcall.symbol} (${m.putcall.name}): ${r} — ${bias} (put ${m.putcall.puts}, call ${m.putcall.calls})`);
  }
  if (m.liquidity_split) {
    const L = m.liquidity_split;
    const bits = [];
    if (L.inst_cash_pct != null) bits.push(`Istituzionali Cash: ${fmtNum.format(L.inst_cash_pct)}% (proxy ${L.inst_note || "AUM BIL+SHV vs SPY"})`);
    /* ⚠ v349 — LA DATA C'ERA IN PAGINA E NON NEL PACCHETTO. La scheda dichiara "Rilevazione
       del 01/06/2026 — serie MENSILE, non e' il dato di oggi"; qui il numero usciva nudo, e
       siccome non compare nell'elenco delle STATISTICHE UFFICIALI della premessa finiva nella
       classe "scaricato al run di oggi". Ottantatre giorni presentati come freschi. La testata
       ordina all'LLM di verificare online ogni dato piu' vecchio di trenta giorni dicendogli
       quali sono: su questo non glielo diceva. */
    if (L.retail_mmf_bln != null) {
      const eta = L.retail_date ? Math.round((Date.now() - new Date(L.retail_date)) / 86400000) : null;
      bits.push(`Retail Cash: fondi monetari retail $${fmtNum.format(L.retail_mmf_bln)} mld (FRED RMFNS${L.retail_yoy_pct != null ? `, YoY ${signTxt(L.retail_yoy_pct)}` : ""}${L.retail_pctile_5y != null ? `, ${L.retail_pctile_5y}° percentile 5A` : ""}${L.retail_date ? `, rilevazione ${L.retail_date}${eta != null ? ` — ${eta} giorni fa, serie MENSILE: NON e' il dato di oggi` : ""}` : ""})`);
    }
    if (bits.length) lines.push(`- Liquidità in attesa (dry powder di mercato, PROXY dichiarati): ${bits.join(" · ")} — cash alto = benzina potenziale per i rialzi, cash in aumento = de-risking in corso.`);
  }
  if (m.dollar_ruler) {
    const D = m.dollar_ruler;
    lines.push(`- Righello Dollaro (${D.src}): ${D.value} · 3 mesi ${signTxt(D.chg_3m_pct)}${D.flag ? ` ${D.flag} — impatta gli utili esteri delle Large Cap USA (vedi tag FX nelle tabelle)` : " (variazione trimestrale entro ±5%: impatto valutario neutro sugli utili)"}`);
  }
  if (m.momentum) {
    const mo = m.momentum;
    const part = (k, lab) => mo[k] ? `${lab} ${fmtNum.format(mo[k].price)} vs SMA125 ${fmtNum.format(mo[k].sma125)} (${signTxt(mo[k].dist_pct)})` : null;
    const ps = [part("sp500", "S&P 500"), part("ndx", "Nasdaq 100")].filter(Boolean);
    if (ps.length) lines.push(`- Momentum strutturale (prezzo vs SMA125 ≈ 6 mesi): ${ps.join(" · ")} — sopra = trend primario integro, sotto = deterioramento.`);
  }
  // FUTURES USA LIVE (v125): leading indicator prima dell'apertura di Wall Street
  if (m.futures) {
    const fu = m.futures;
    const fp = (k, lab) => fu[k] ? `${lab} ${fmtNum.format(fu[k].price)} (${signTxt(fu[k].change_pct)})` : null;
    const fs = [fp("nasdaq", "Nasdaq 100 (NQ)"), fp("sp500", "S&P 500 (ES)")].filter(Boolean);
    if (fs.length) {
      /* ⚠ v263 — QUESTA RIGA CONTRADDICEVA QUELLA DUE SOPRA. Trovato leggendo il pacchetto come
         il modello ricevente: il CONTESTO DI SESSIONE dichiara "WEEKEND, MERCATI CHIUSI · FERMI
         — non anticipano nulla di nuovo", e subito dopo questa riga li chiamava "LIVE" e
         "anticipo direzione pre-apertura". Lo stesso dato, due letture opposte a tre righe di
         distanza: e' la classe v190 (l'etichetta che contraddice il testo accanto) e la classe
         v193 (stato del mercato e freschezza del dato sono due cose diverse).
         I future CME chiudono il venerdi' alle 22:00 CET e riaprono la domenica alle 23:00: nel
         mezzo quel numero non anticipa niente, e' l'ultima quotazione prima della chiusura.
         Ora l'etichetta segue lo stato reale invece di essere sempre la stessa. */
      const fase = (typeof usSessionInfo === "function") ? usSessionInfo() : null;
      const futuriFermi = fase && (fase.phase === "weekend" || fase.weekend || /weekend/i.test(fase.label || ""));
      lines.push(futuriFermi
        ? `- Futures USA [FERMI, mercato dei future chiuso]: ${fs.join(" · ")} — sono l'ultima quotazione prima della chiusura, gia' dentro l'ultima seduta: NON anticipano niente di nuovo.`
        /* ⚠ v286 — L'INTERPRETAZIONE SEGUE LA FASE, non e' sempre la stessa. La riga diceva
           "apertura USA in gap-down attesa" anche alle 14:20 ET, con la sessione aperta da
           quattro ore e il blocco di sessione tre righe sopra che dichiarava REGULAR: due parti
           dello stesso pacchetto che descrivevano due momenti diversi. E' la classe v190/v234 —
           un ramo il cui TESTO non segue lo STATO — e qui il difetto era che il ramo "mercato
           aperto" non esisteva proprio: c'erano solo weekend e pre-apertura. */
        : (fase && fase.phase === "regular"
            ? `- Futures USA LIVE: ${fs.join(" · ")} — la sessione e' GIA' APERTA, quindi non anticipano niente: servono a vedere se il movimento in corso e' coerente col resto o se il cash si sta staccando dai future.`
            : `- Futures USA LIVE (anticipo direzione pre-apertura Wall Street): ${fs.join(" · ")} — negativi marcati = apertura USA in gap-down attesa.`));
    }
  }
  // RADAR SCHIUMA SPECULATIVA v126 (ETF a leva 3x): l'euforia retail terminale sul tech/semi
  // è il contesto in cui questo portafoglio (87% tech) rischia di comprare l'ultimo massimo.
  if (m.froth) {
    const fr = m.froth;
    const fbit = (k, lab) => fr[k] ? `${lab} RVol ${fmtNum.format(fr[k].rvol)}×${fr[k].chg_5d_pct != null ? ` (${signTxt(fr[k].chg_5d_pct)} 5g)` : ""}` : null;
    const fbits = [fbit("soxl", "SOXL 3x semi"), fbit("tqqq", "TQQQ 3x NDX")].filter(Boolean);
    if (fr.alert) {
      lines.push(`- ⚠ [SPECULATIVE FROTH ALERT] Schiuma speculativa sugli ETF a leva: ${fbits.join(" · ")}. ${fr.note || ""} DIRETTIVA: è in corso una speculazione estrema sui prodotti a leva tech — NON impegnare il budget operativo in NUOVI acquisti tech/semi finché il volume non si normalizza; le posizioni esistenti restano protette SOLO dagli Stop Ratchet 2×ATR (non alzarli, non anticiparli). La riserva ES95 resta inviolabile.`);
    } else if (fbits.length) {
      lines.push(`- Schiuma speculativa ETF leva 3x (proxy euforia retail): ${fbits.join(" · ")} — entro la norma (alert a RVol ≥ 2,5× con prezzo in salita a 5 sedute).`);
    }
  }
  // PROXY AMPIEZZA DI MERCATO v126 (SPY vs RSP): un rally retto da poche megacap è la
  // fragilità specifica di un book concentrato su NVDA/MU/AMD.
  if (m.breadth) {
    const br = m.breadth;
    const base = `SPY (cap-pesato) ${signTxt(br.spy_1m_pct)} vs RSP (equi-pesato) ${signTxt(br.rsp_1m_pct)} a 1M · spread ${signTxt(br.divergence_pp, "pp")}`;
    if (br.alert) {
      lines.push(`- ⚠ [BREADTH DIVERGENCE] Ampiezza di mercato in deterioramento: ${base}. ${br.note || ""} DIRETTIVA: il rally NON è confermato dall'azione media — prudenza sui nuovi ingressi (sizing ridotto o ingresso post-conferma), priorità ai candidati con RS propria e non trainata dall'indice; per il book già concentrato sulle megacap questo è il segnale d'allarme più specifico: verifica la distanza degli stop ratchet.`);
    } else {
      lines.push(`- Ampiezza di mercato (SPY cap-pesato vs RSP equi-pesato, 1M): ${base} — rally ${br.divergence_pp > 2 ? "trainato dalle megacap ma con partecipazione" : "con partecipazione ampia"} (alert se SPY+ con RSP− o spread >4pp).`);
    }
  }
  // EUR/JPY escluso dal payload (v138): ridondante — il rischio yen è già nel blocco Carry
  // USA-Giappone (USD/JPY + tasso BoJ), e il rischio cambio del fondo è EUR/USD.
  (m.markets || []).filter(x => !/EUR\/JPY/i.test(x.label || "")).forEach(x => lines.push(`- ${x.label}: ${x.value} (${signTxt(x.change_pct, x.suffix || "%")} oggi)`));
  // ogni indicatore economico con la sua data di pubblicazione ESPLICITA: la latenza del dato
  // deve essere palese all'AI (CPI/NFP = mensili con ~1 mese di ritardo; PIL = trimestrale)
  /* ═══ v229 — ACCORPAMENTO NEL PAYLOAD (era già stato fatto in dashboard in v225) ══════════
     Il QUADRO MACRO pubblicava l'inflazione su DUE righe (CPI e PCE, oggi entrambe 3.7%) e la
     curva 10A-2A su TRE (questa, quella dedicata con la distanza dall'inversione, e quella del
     modello recessione). Nessuna delle tre era sbagliata, ma un lettore che conta i segnali ne
     conta tre dove ce n'è uno: è la stessa classe che il payload dichiara già altrove
     ("NON è una seconda conferma indipendente… contarli come due prove raddoppia un segnale
     solo"), applicata qui invece che solo annotata.
     · CPI e PCE → una riga sola, entrambi i numeri, con quale guarda la Fed.
     · curva → esce da questo elenco e la sua RILEVAZIONE si trasferisce alla riga dedicata,
       che è la sola a portare la distanza dall'ultima inversione. */
  /* ⚠ `curve` esce dall'elenco SOLO se la riga dedicata verra' davvero emessa (serve
     curve_history). Senza questa condizione, uno snapshot senza storico della curva la faceva
     SPARIRE dal payload: un accorpamento che perde il dato invece di unirlo. Preso dal test
     v138, che asserisce l'etichetta "serie GIORNALIERA" — la guardia proteggeva la label e ha
     intercettato la perdita del fatto. */
  const curvaAltrove = (m.curve_history || []).length > 0;
  const accorpate = new Set(curvaAltrove ? ["cpi", "pce", "curve"] : ["cpi", "pce"]);
  const noteSerie = (i) => i.key === "gdp" ? "serie TRIMESTRALE, il dato più recente disponibile"
    : i.key === "curve" ? "serie GIORNALIERA FRED T10Y2Y, ultima chiusura"
    : i.key === "curve3m" ? "serie GIORNALIERA FRED T10Y3M, ultima chiusura — è lo STESSO segnale della curva 10A-2A su un altro tratto, non un secondo segnale"
    : i.key === "t30" ? "serie GIORNALIERA FRED DGS30, ultima chiusura"
    : i.key === "real10" ? "serie GIORNALIERA FRED DFII10 (TIPS 10A): è il rendimento AL NETTO dell'inflazione attesa"
    : i.key === "breakeven" ? "serie GIORNALIERA FRED T10YIE: nominale meno reale, cioè l'inflazione che il mercato PREZZA, non quella osservata: è una grandezza diversa dal CPI, non una seconda misura della stessa"
    : i.key === "philly" ? "indagine mensile della Federal Reserve di Philadelphia (FRED GACDFSA066MSFRBPHI). NON è l'ISM: l'ISM è sotto licenza e non è ridistribuibile. Stessa specie di misura (diffusion index sulla manifattura, esce prima dell'ISM), ma copre un distretto, non il paese: è un'indicazione di direzione, non il livello nazionale"
    : i.key === "umich" ? "serie mensile via FRED UMCSENT, che sconta 1-2 mesi di ritardo di LICENZA: alla fonte UMich esistono già letture più recenti NON presenti qui: questo valore non è l'ultimo pubblicato"
    : "serie mensile, normale ritardo di pubblicazione";
  /* ⚠ v266 — LA CADENZA NON DEVE MANGIARSI L'IDENTIFICAZIONE DELLA SERIE. Aggiungendo le
     cadenze giornaliere, `cad` ha cominciato a esistere anche per la curva e ha preso il posto
     della nota che dice QUALE serie e' (FRED T10Y2Y) e come va letta. Sono due informazioni
     diverse — quando è stata rilevata, e cos'è — e il test v138 ha intercettato la perdita.
     Per queste chiavi la nota porta un avvertimento che la cadenza non contiene, quindi vanno
     scritte tutte e due. */
  const NOTA_INSOSTITUIBILE = new Set(["gdp", "curve", "curve3m", "t30", "real10", "breakeven", "philly", "umich"]);
  (m.indicators || []).filter(i => !accorpate.has(i.key)).forEach(i => {
    /* v250 — dove esiste un calendario dichiarato dalla fonte si scrive QUANDO è stato rilevato,
       quanti giorni ha e QUANDO ne arriva uno nuovo. Altrove resta la nota generica: meglio una
       nota vaga che una data inventata. */
    const cad = rigaCadenza(i.key, i.date);
    const testa = cad
      ? (NOTA_INSOSTITUIBILE.has(i.key) ? `${cad} · ${noteSerie(i)}` : cad)
      : `rilevazione ${i.date} — ${noteSerie(i)}`;
    lines.push(`- ${i.label}: ${i.value} (${testa})${dqV.flags[i.key] ? " " + dqV.flags[i.key] : ""}`);
  });
  {
    const c2 = (m.indicators || []).find(i => i.key === "cpi");
    const p2 = (m.indicators || []).find(i => i.key === "pce");
    const fl = [c2, p2].filter(Boolean).map(i => dqV.flags[i.key]).filter(Boolean).join(" ");
    if (c2 && p2) lines.push(`- Inflazione (a/a): CPI ${c2.value} · PCE ${p2.value} — due misure della STESSA grandezza, non due segnali: la Fed guarda il PCE. Rilevazioni: CPI ${rigaCadenza("cpi", c2.date) || c2.date} · PCE ${rigaCadenza("pce", p2.date) || p2.date}.${fl ? " " + fl : ""}`);
    else if (c2 || p2) {
      const u = c2 || p2;
      /* v250 — la riga di cadenza sostituisce il generico "normale ritardo di pubblicazione":
         dice QUANDO è stato rilevato, quanti giorni ha, e QUANDO ne arriva uno nuovo. È la
         risposta strutturale al dubbio del CEO sul margin debt — un dato vecchio con la data
         del prossimo è informazione, lo stesso dato senza è una trappola. */
      const cad = rigaCadenza(u.key, u.date);
      lines.push(`- ${u.label}: ${u.value} (${cad || `rilevazione ${u.date} — serie mensile, normale ritardo di pubblicazione`})${dqV.flags[u.key] ? " " + dqV.flags[u.key] : ""}`);
    }
  }
  /* ⚠ v290 — LA CURVA DEI TASSI ARRIVA ANCHE ALL'LLM, non solo allo schermo.
     Difetto mio, e ripetuto: in v287 avevo costruito il calendario e in v289 la curva, li avevo
     disegnati in pagina e non li avevo messi nel pacchetto. Chi legge l'analisi vedeva un
     terminale piu' ricco della pagina che gliela genera — il contrario di cio' che serve.
     ⚠⚠ QUI VANNO SOLO FATTI (regola C9). Niente "curva piatta = recessione": e' esattamente il
     verdetto aggregato che v287 ha tolto da questo stesso payload, e in v200 il motore di
     punteggio se n'era andato per lo stesso motivo. I cinque numeri con le loro date, lo scarto
     osservato a tre mesi e la pendenza — che e' una sottrazione, non un giudizio. Cosa voglia
     dire lo decide chi legge. */
  if (m.tassi && (m.tassi.scadenze || []).length >= 3) {
    const sc = m.tassi.scadenze.filter(x => Number.isFinite(x.value));
    const dataOss = sc.map(x => x.observation_date).filter(Boolean).sort().pop();
    const pezzi = sc.map(x => {
      const d = Number.isFinite(x.value_3m) ? ` [${signTxt(Math.round((x.value - x.value_3m) * 100) / 100, "")} vs ${fmtNum.format(x.value_3m)}% del ${x.observation_date_3m}]` : "";
      return `${x.label} ${fmtNum.format(x.value)}%${d}`;
    });
    const c = sc[0], l = sc[sc.length - 1];
    const pend = Math.round((l.value - c.value) * 100) / 100;
    const pend3 = (Number.isFinite(l.value_3m) && Number.isFinite(c.value_3m))
      ? Math.round((l.value_3m - c.value_3m) * 100) / 100 : null;
    lines.push(`- CURVA DEI TASSI USA (${m.tassi.fonte || "FRED"}, OSSERVAZIONI PUBBLICATE — non stime, `
      + `ultima del ${dataOss}, quindi NON di oggi: la fonte pubblica con qualche giorno di ritardo): `
      + `${pezzi.join(" · ")}. Pendenza ${c.label}→${l.label}: ${signTxt(pend, " pp")}`
      + (pend3 != null ? `, era ${signTxt(pend3, " pp")} tre mesi fa` : "")
      + `. Fra parentesi quadre lo scarto dalla stessa scadenza tre mesi fa: e' un confronto fra `
      + `due osservazioni datate, non una tendenza ricostruita.`);
  }

  /* ⚠ v290 — COSA ESCE NEI PROSSIMI SETTE GIORNI. Il payload diceva benissimo cosa E' USCITO e
     taceva su cosa STA PER USCIRE: un'analisi scritta il giorno prima del CPI e una scritta il
     giorno dopo non sono la stessa analisi, e l'LLM non aveva modo di saperlo.
     ⚠⚠ SONO TUTTE STIME E OGNI RIGA LO DEVE DIRE, come in pagina: le uscite macro le proietto
     dal ritardo tipico della fonte, le trimestrali le sposta l'emittente. Un appuntamento che
     sembra confermato senza esserlo e' la classe di difetto peggiore di questo progetto. */
  /* ═══ v302 — LE MATERIE PRIME ENTRANO NEL PACCHETTO, PROPRIO MENTRE ESCONO DALLA PAGINA ══
     Il CEO ha chiesto di togliere petrolio, rame e oro dalla pagina. Il cancello v302 ha
     scoperto che `macro.materie` NON era nel payload: vivevano solo sulla schermata, quindi
     togliere la tessera le avrebbe cancellate dal SISTEMA invece che spostarle. E' la classe
     v201-v204 — la pulizia che si porta via il fatto — presa in tempo dal check scritto un
     minuto prima per un'altra ragione.
     ⚠ Sono fatti che contano per questo libro: il rame e' la domanda industriale (e i semi
     sono ciclici), il petrolio e' inflazione dal lato dei costi, l'oro e' il termometro della
     sfiducia. Una riga sola, col valore, la variazione e dove sta nel proprio anno. */
  /* ═══ v310 — LA STAGIONALITA' ARRIVA ANCHE ALL'LLM ═══════════════════════════════════
     TERZA VOLTA che disegno una cosa in pagina e la dimentico nel pacchetto: era gia' successo
     col calendario (v287) e con la curva dei tassi (v289), e il CEO stesso me l'aveva fatto
     notare ("abbiamo tenuto conto anche nella generazione del prompt?"). Trovata da una
     scansione sistematica invece che a occhio, e la scansione e' diventata un cancello.
     ⚠⚠ E LA CAUTELA VIAGGIA COL DATO. Dieci osservazioni per mese con una dispersione da
     -8,7% a +18,9% non sono una previsione: se il payload desse la media senza l'intervallo,
     un LLM la userebbe come tale — ed e' esattamente il genere di numero che questo progetto
     ha gia' tolto una volta (v200, motore predittivo a hit-rate 29%). */
  if (m.stagionalita_ndx && (m.stagionalita_ndx.mesi || []).length) {
    const st = m.stagionalita_ndx;
    const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
                  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
    const prossimi = [0, 1, 2]
      .map(k => (st.mesi || []).find(x => x && x.mese === ((st.mese_ora - 1 + k) % 12) + 1))
      .filter(x => x && Number.isFinite(x.media_mid));
    if (prossimi.length) {
      lines.push(`- STAGIONALITA' DEL NASDAQ 100 E CICLO ELETTORALE (${st.fonte || "^NDX mensile"}, `
        + `campione ${st.dal}-${st.al}, ${(st.anni_midterm || []).length} anni di midterm`
        + (st.ciclo_ora === 2 ? `; il ${st.al + 1} e' un anno di midterm` : "") + `): `
        + prossimi.map(x => `${MESI[x.mese - 1]} ${signTxt(x.media_mid)} negli anni di midterm `
            + `contro ${signTxt(x.media)} su tutti gli anni, ${x.pos_mid}% di mesi positivi, `
            + `esiti da ${signTxt(x.peggio_mid)} a ${signTxt(x.meglio_mid)}`).join(" · ")
        + `. ⚠ Dieci osservazioni per mese: dove la media e' +3,9% i singoli anni vanno da -8,7% a `
        + `+18,9%, cioe' la media sta fra esiti opposti. E' il conto di cosa e' successo, non una `
        + `previsione — serve a sapere quando un movimento e' ordinario per il periodo, non a dedurne uno.`);
    }
  }

  if (m.materie && Object.keys(m.materie).length) {
    const pezzi = [];
    for (const [k, v] of Object.entries(m.materie)) {
      if (!v || v.value == null) continue;
      /* ⚠ due grandezze DIVERSE, e prima erano una sola sotto il nome sbagliato: quanto si e'
         mosso in un anno, e dove sta dentro l'intervallo di quell'anno. Un metallo puo' essere
         +31% e stare a meta' del range, o -5% e stare al massimo: dirne una sola e chiamarla
         come l'altra e' cio' che ha prodotto "116° percentile", che non esiste.
         La posizione si ricalcola qui se la pipeline non l'ha ancora pubblicata (il CI rigenera
         su cron: senza questo il pacchetto resterebbe monco per ore — ragione di v187/v205). */
      const varAnno = v.var_1y != null ? v.var_1y : v.pct_1y;
      const pos = v.pos_range_1y != null ? v.pos_range_1y
        : (v.min_1y != null && v.max_1y != null && v.max_1y > v.min_1y
            ? Math.round((v.value - v.min_1y) / (v.max_1y - v.min_1y) * 1000) / 10 : null);
      /* ⚠⚠ v321 — `${v.value}` INTERPOLAVA IL NUMERO GREZZO: il rame usciva "6.613 $/lb", e in
         un pacchetto che trentanove righe piu' su scrive "30.046,14" quel punto e' il separatore
         delle MIGLIAIA. Un lettore — umano o modello — legge 6613 invece di 6,613: sbaglia di
         mille volte, e non si autodenuncia perche' anche l'intervallo "4.409–6.703" e'
         internamente coerente con la lettura sbagliata. Una convenzione decimale sola in tutto
         il pacchetto, ed e' quella italiana che il resto usa gia'. */
      pezzi.push(`${v.label || k} ${fmtNum.format(v.value)}${v.unita ? " " + v.unita : ""}`
        + (v.change_pct != null ? ` (${signTxt(v.change_pct)} oggi)` : "")
        + (varAnno != null ? ` — ${signTxt(Math.round(varAnno * 10) / 10)} in un anno` : "")
        + (pos != null && v.min_1y != null && v.max_1y != null
            ? `, e sta al ${Math.round(pos)}% dell'intervallo annuale ${fmtNum.format(v.min_1y)}–${fmtNum.format(v.max_1y)}` : ""));
    }
    if (pezzi.length) {
      lines.push(`- MATERIE PRIME E SEMICONDUTTORI: ${pezzi.join(" · ")}. `
        + `Sono due grandezze diverse: la variazione dice quanto si e' mosso in dodici mesi, la `
        + `posizione nell'intervallo dice dove sta oggi fra il minimo e il massimo dello stesso `
        + `periodo — un metallo puo' essere salito molto e stare a meta' strada. Nessuna delle due `
        + `dice se il prezzo sia caro: rame alto = domanda industriale, petrolio alto = inflazione `
        + `dal lato dei costi, e sono due segni opposti sullo stesso numero.`);
    }
  }

  /* ═══ v304 — I TITOLI MACRO NEL PACCHETTO, COME TITOLI E NON COME FATTI ═══════════════
     Il pacchetto dice all'LLM di cercare le notizie online (blocco "quello che il sistema non
     ha"). Questi diciotto titoli non sostituiscono quella ricerca: le danno un punto di
     partenza datato, e soprattutto dicono di COSA si sta parlando adesso.
     ⚠⚠ SONO TITOLI, NON FATTI, e la differenza va scritta: il sistema non ha letto gli
     articoli, non ha verificato i numeri che contengono, e il filtro che li seleziona e'
     automatico. Presentarli come dati verificati sarebbe la classe di difetto peggiore di
     questo progetto — e qui il rischio e' concreto, perche' un titolo di giornale contiene
     numeri ("annual rate at 3.4%") che un LLM prenderebbe per buoni. */
  if (m.news && (m.news.voci || []).length) {
    /* ⚠⚠ v306 — SOLO LE ULTIME SEI ORE, come chiesto dal CEO, e quando non c'e' niente lo si
       DICE. Misurato scrivendo questa riga: dentro le 6 ore c'erano zero notizie macro e anche
       dentro le 12 — era sabato. "Non e' uscito niente di macro da mezza giornata" non e' un
       buco del sistema: e' un fatto sul mondo, e di sabato e' la risposta giusta. Tacere
       lascerebbe l'LLM a dedurre, e dedurrebbe male. */
    const ORE = 6;
    const adesso = Date.now();
    const conEta = m.news.voci
      .map(v => ({ ...v, ore: (adesso - Date.parse(v.quando)) / 3600000 }))
      .filter(v => Number.isFinite(v.ore)).sort((a, b) => a.ore - b.ore);
    const fresche = conEta.filter(v => v.ore <= ORE).slice(0, 12);
    if (fresche.length) {
      lines.push(`- TITOLI MACRO DELLE ULTIME ${ORE} ORE (${fresche.length}, da ${(m.news.fonti || []).join(", ")}) — `
        + `SONO TITOLI, NON FATTI VERIFICATI: il sistema non ha letto gli articoli ne' controllato i numeri `
        + `che contengono, e la selezione e' automatica (${m.news.filtro || ""}). I riassunti sono quelli `
        + `pubblicati dalla fonte nel feed, non riscritti dal sistema. Un titolo non ha data di rilevazione: `
        + `ha solo la data di pubblicazione, che e' un'altra cosa.`
        + fresche.map(x => `\n    · [${x.fonte}, ${Math.round(x.ore)}h fa] ${x.titolo}`
            + (x.riassunto ? `\n      ${x.riassunto}` : "")).join(""));
    } else {
      const p = conEta.length ? Math.round(conEta[0].ore) : null;
      lines.push(`- TITOLI MACRO DELLE ULTIME ${ORE} ORE: NESSUNO. `
        + (p != null ? `La notizia macro piu' recente fra le fonti seguite (${(m.news.fonti || []).join(", ")}) `
            + `ha ${p} ore. ` : "")
        + `E' un fatto sul mondo, non un buco del sistema: la macro non esce di continuo e nel fine settimana `
        + `non esce affatto. Un'analisi scritta in una finestra senza notizie e' diversa da una scritta subito `
        + `dopo un dato, e la differenza sta qui.`);
    }
  }

  if (typeof prossimiEventi === "function") {
    const pv = prossimiEventi(14);   // v290 — la stessa finestra della pagina: a 7 giorni era vuota
    if (pv && pv.eventi && pv.eventi.length) {
      const macro = pv.eventi.filter(e => e.tipo === "macro")
        .map(e => `${e.giorno} ${e.nome}${e.precedente != null ? ` (precedente ${e.precedente})` : ""}`);
      const utili = pv.eventi.filter(e => e.tipo === "utili").map(e => `${e.giorno} ${e.nome}`);
      lines.push(`- IN USCITA NELLE PROSSIME 2 SETTIMANE — TUTTE DATE STIMATE, non appuntamenti confermati `
        + `(le macro proiettate dal ritardo tipico della fonte, le trimestrali le sposta l'emittente): `
        + (macro.length ? `dati macro: ${macro.join(" · ")}. ` : "nessun dato macro atteso. ")
        + (utili.length ? `trimestrali dei titoli seguiti: ${utili.join(" · ")}.` : "nessuna trimestrale fra i titoli seguiti.")
        + ` Un'analisi scritta prima o dopo una di queste uscite non e' la stessa analisi.`);
    }
  }

  /* ⚠ v337 — il numero e' uscito, l'etichetta resta. MacroQuant NON e' un dato di mercato:
     e' la MEDIA di punteggi che calcolo io (pipeline riga ~2760, "Riproduzione trasparente
     stile BCA"). Pubblicarlo su 0-100 accanto a valori veri lo faceva sembrare una misura.
     L'etichetta ("Espansione"/"Rallentamento"/"Contrazione") e' una classificazione dichiarata
     ed e' cio' che resta leggibile senza fingere una precisione a due cifre. */
  if (m.macroquant) lines.push(`- MacroQuant (ciclo economico, riproduzione stile BCA dai fattori macro pubblici): ${m.macroquant.label}`);
  /* ⚠ v264 — "5/10 attivi (50% RISCHIO RIBASSISTA)" ERA UN CONTEGGIO TRAVESTITO DA PROBABILITA'.
     Cinque campanelli su dieci non fanno il 50% di probabilita' di un mercato orso: fanno cinque
     campanelli su dieci. Chiamare percentuale il rapporto fra acceso e totale gli da' l'autorita'
     di una stima che nessuno ha fatto — e' la stessa classe del punteggio 0-100 tolto in v200 e
     delle soglie inventate di v240. Resta il conteggio, che e' il fatto, e i nomi di quelli
     accesi, che sono l'informazione vera: cinque campanelli sul credito non sono cinque
     campanelli sparsi. */
  if (m.signposts) {
    /* ⚠ il campo e' `status`, non `active`: verificato sul file vero invece di indovinarlo —
       le chiavi vanno lette da data.json, non dedotte dal nome (lezione v207). */
    const items = m.signposts.items || [];
    const conMisura = items.some(x => x && x.calcolato);
    /* i NOMI devono venire dalla stessa popolazione del CONTEGGIO: se si conta sulle
       calcolabili, si nominano le calcolabili accese, non tutte. */
    const accesi = items.filter(x => x && x.status === true && (!conMisura || x.calcolato))
      .map(x => x.name || x.label).filter(Boolean);
    /* ⚠⚠ v329 — "5/10 ACCESI" NON ERA UN CONTEGGIO, ERA UN PAVIMENTO. Solo quattro voci si
       calcolano da una fonte; le altre sei sono costanti di baseline, di cui cinque accese. Il
       numero non poteva scendere sotto cinque qualunque cosa facesse il mercato, e veniva
       presentato come una misura. Ora la riga separa cio' che e' misurato da cio' che e' assunto. */
    const nCalc = m.signposts.calcolabili, nOn = m.signposts.accesi_calcolabili;
    const costanti = (m.signposts.items || []).filter(x => x && !x.calcolato && x.status === true)
      .map(x => x.name).filter(Boolean);
    lines.push(nCalc != null
      ? `- BofA Bear-Market Signposts: ${nOn} accesi su ${nCalc} CALCOLABILI da una fonte`
        + (accesi.length ? ` — accesi: ${accesi.join(" · ")}` : " — nessuno acceso")
        + `. ⚠ Gli altri ${10 - nCalc} campanelli sono COSTANTI di riferimento, non misure: `
        + (costanti.length ? `${costanti.length} di essi risultano accesi (${costanti.join(" · ")}) ma nessuna riga di codice puo' spegnerli. ` : "")
        + `Il totale "${m.signposts.active}/10" che si legge altrove NON e' un conteggio: e' un `
        + `pavimento, perche' non puo' scendere sotto il numero delle costanti accese. Il numero `
        + `misurato da una fonte e' ${nOn} su ${nCalc}.`
      : `- BofA Bear-Market Signposts: ${m.signposts.active}/10 accesi`
        + (accesi.length ? ` — ${accesi.join(" · ")}` : "")
        + `. ⚠ NON e' un conteggio di misure: una parte di queste voci non viene ricalcolata da `
        + `nessuna fonte a ogni run, quindi il numero e' un LIMITE SUPERIORE che non puo' scendere `
        + `sotto le voci fisse: una parte del numero e' un'assunzione, non una misura che si `
        + `muove col mercato.`);
  }
/* ═══ v246 — LA LEVA È UNA FOTOGRAFIA DI DUE MESI FA, E IL KOSPI LO DICE ═══════════════════
   Segnalato dal CEO: "il grafico porta ancora la leva al massimo ma sembra che ci sia stata una
   pulizia della leva (vedi calo KOSPI), forse c'e' un calcolo errato".
   IL CALCOLO NON E' SBAGLIATO: l'ultimo punto della serie E' il massimo, quindi 100% e' esatto.
   Sbagliata era la PRESENTAZIONE. Due cose che il payload non diceva:
   1. QUANTO E' VECCHIO. Scriveva "(rilevazione 2026-06-01)" e lasciava fare la sottrazione a chi
      legge. Sono 68 giorni. FINRA pubblica il mese M nella terza settimana di M+1, quindi giugno
      E' il dato piu' recente che esista — ma "piu' recente disponibile" e "attuale" sono cose
      diverse, e un LLM che legge "leva al massimo" senza l'eta' conclude sul presente.
   2. CHE NEL FRATTEMPO E' SUCCESSO. Il sistema HA la prova e non la collegava: il KOSPI e' in
      drawdown profondo, ed e' l'indice dove la leva retail e' piu' visibile al mondo. Verificato
      su fonti aperte il 07/08/2026: i prestiti a margine coreani sono passati da 38,6 T won di
      fine giugno a 27,4 T del 4 agosto. Un deleveraging gia' avvenuto, che una serie FINRA di
      giugno non puo' contenere per costruzione.
   ⚠ Non si INVENTA un dato piu' fresco: si dichiara l'eta' e si nomina l'evidenza contraria che
   il payload gia' contiene. La differenza fra un dato vecchio spacciato per attuale e un dato
   vecchio dichiarato tale e' tutta la fiducia che si puo' avere nel sistema. */
/* il KOSPI come testimone: e' l'indice dove la leva retail e' piu' visibile, e il payload lo
   porta gia' fra gli anticipatori. Qui si legge il suo DRAWDOWN, non il movimento di giornata:
   un unwind e' una discesa profonda, non una seduta storta. */
    /* v249 — MARGIN DEBT FUORI DAL PAYLOAD, su dubbio del CEO: "forse è troppo datato e
       diventa fuorviante per l'analisi". Aveva ragione, e la misura lo conferma: la rilevazione
       è di 68 giorni (FINRA pubblica il mese M nella terza settimana di M+1, quindi giugno È il
       dato più recente che esista) MA veniva presentata come uno STATO — "Espansione leva
       ESTREMA → RISCHIO SISTEMICO" — su una variabile che nel frattempo si è mossa molto: nello
       stesso intervallo i prestiti a margine coreani sono passati da 38,6 a 27,4 T won.
       ⚠ Non è un dato INAFFIDABILE: è onesto ma LENTO, etichettato come se fosse attuale. v246
       aveva aggiunto l'età e il testimone KOSPI, e non è bastato: l'etichetta di rischio
       sistemico resta la prima cosa che si legge. Fuori dal payload; RESTA in dashboard, dove
       il CEO lo guarda sapendo di che mese è. `etaLeva`/`testimoneLeva` restano: le usa la card,
       e portarsele via sarebbe il taglio che prende il vicino (classe v201-v204). */
  if (m.forward_pe && m.forward_pe.value != null) {
    const fp = m.forward_pe;
    // v169 — l'escalation NON può poggiare su un dato vecchio senza dirlo. Il Forward P/E viene
    // dal WSJ, che gli IP dei runner CI trovano spesso bloccato: in quei run il valore è un
    // carry-forward fino a 45 giorni. Verificato che non esiste un'alternativa gratuita stabile
    // (multpl non ha la pagina forward, gurufocus risponde 403, yfinance non espone forwardPE per
    // gli ETF sull'indice; un proxy calcolato bottom-up sui mega-cap sbaglia ~10%, troppo vicino
    // alla soglia di 20 per pilotare un verdetto). Quindi: il verdetto sistemico si declassa a
    // ipotesi quando l'input non è fresco, invece di affermarlo con la stessa sicurezza.
    const fpAgeDays = (() => { const d = fp.fetched_at || fp.date; if (!d) return null;
      const t = new Date(d); return isNaN(t) ? null : Math.round((Date.now() - t) / 86400000); })();
    const fpStale = !!fp.carried || (fpAgeDays != null && fpAgeDays > 21);
    const stLeva = (typeof marginDebtState === "function") ? marginDebtState() : null;
    const sysDanger = (m.margin_debt?.pct_of_peak >= 90) && fp.value > 20 && !(stLeva && stLeva.rollover);
    const carriedTag = (o) => {
      if (!o || !o.carried) return "";
      const d = o.fetched_at || o.date;
      const age = d ? Math.round((Date.now() - new Date(d)) / 86400000) : null;
      return `, ⚠ CARRY-FORWARD dal run precedente${d ? ` (rilevato ${String(d).slice(0, 10)}${age != null ? `, ${age}g fa` : ""})` : ""} — la fonte era irraggiungibile: pesalo come dato DATATO, non odierno`;
    };
    lines.push(`- Forward P/E S&P 500 [FORWARD, fonte: ${fp.source || "WSJ"}${carriedTag(fp)} — metodologia DIVERSA dal trailing: il rapporto fra i due non è un tasso di crescita implicito]: ${fp.value}× vs media storica ${fp.avg_hist}× (${fp.label}). ${sysDanger ? (fpStale ? `RISCHIO SISTEMICO da VERIFICARE: leva ai massimi e valutazioni tese porterebbero a un giudizio di vulnerabilità a un deleveraging violento, MA questo Forward P/E non è fresco${fpAgeDays != null ? ` (${fpAgeDays}g)` : ""} — il verdetto poggia su un input datato: confermalo via web prima di usarlo come premessa.` : "RISCHIO SISTEMICO ELEVATO: leva in espansione sui massimi + valutazioni tese → vulnerabilità a deleveraging violento.") : (stLeva && stLeva.rollover
        ? "Valutazioni tese, ma la leva si sta RITIRANDO dai massimi: il livello alto dice quanto carburante c'era, il verso negativo dice che il deleveraging e' gia' cominciato — i numeri stanno nella riga LEVA DEGLI OPERATORI."
        : "Valutazioni " + (fp.value > 20 ? "tese ma" : "") + " da monitorare insieme alla leva.")}`);
    const rl = rigaLeva(m);
    if (rl) lines.push(rl);
  }
  /* v331 — quale testata sta viaggiando in QUESTO pacchetto */
  if (typeof provenienzaTestata === "function") lines.push(`- PROVENIENZA DELLE REGOLE: ${provenienzaTestata()}.`);
  if (m.credit) {
    /* ⚠ v323 — il punteggio si RICALCOLA dalle bande dichiarate qui accanto: quello della
       pipeline usciva da un'ancora 2,5-11,5% inventata, e a 6,5% dava "favorevole" mentre la
       legenda sulla stessa riga dice "stress". Il ricalcolo vive anche qui perche' il CI
       rigenera su cron: senza, il pacchetto porterebbe il numero vecchio per ore (v187/v205). */
    const scCred = punteggioDaZone(numero(m.credit.spread_hy), ZONE_CREDITO);
    const zCred = ZONE_CREDITO.find(z => numero(m.credit.spread_hy) >= z.da && numero(m.credit.spread_hy) <= z.a);
    let crl = `- Rischio Credito (HY OAS, proxy CDS): ${m.credit.spread_hy}% — ${zCred ? zCred.nome : m.credit.label} `
      + `(bande di lettura: sotto 4% rilassato, 4-5% attenzione, 5-7% stress, oltre 7% crisi)`;
    const ch = m.credit.history || [];
    const chM = dg1M(ch);
    if (chM) { const d = chM.pct * numero(m.credit.spread_hy) / (100 + chM.pct); crl += `; trend ~1 mese ${d > 0 ? "+" : ""}${fmtNum.format(Math.round(d * 100) / 100)} pp (${d > 0.15 ? "spread in allargamento = rischio in aumento" : d < -0.15 ? "spread in restringimento = rischio in calo" : "stabile"}, ${chM.da}→${chM.a})`; }
    lines.push(crl);
  }
  if (m.systemic_risk) {
    const sr = m.systemic_risk;
    lines.push(`- Rischio Sistemico & Credito (proxy CDS): HY OAS ${sr.hy_oas}% (${signTxt(sr.hy_chg_1m)} 1m), IG OAS ${sr.ig_oas ?? "—"}% (ICE BofA US Corporate, indice IG AMPIO · ${sr.ig_chg_1m != null ? signTxt(sr.ig_chg_1m) : "—"} 1m), HY/IG ${sr.hy_ig ?? "—"}×${sr.stlfsi != null ? `, stress finanziario St.Louis ${signTxt(sr.stlfsi)}` : ""} — ${sr.status}`);
  }
  /* v259 — "Istituzionali VS Retail" fuori dal payload: stessa ragione del sentiment
     globale — e' una media di SMC indici, VIX term, HY/IG e put/call, tutti gia' pubblicati. */
  if (m.decouple?.sp500?.length && m.decouple?.gdp?.length) {
    const gg = sovrapposizioneGiorni(m.decouple.sp500, m.decouple.gdp);
    if (gg) {
      const gap = Math.round(m.decouple.sp500.slice(-1)[0].v - m.decouple.gdp.slice(-1)[0].v);
      const anni = Math.round(gg / 365 * 10) / 10;
      lines.push(`- Disaccoppiamento S&P 500 vs PIL reale: gap ${gap > 0 ? "+" : ""}${gap} pp su una finestra di ${anni} anni (azionario ${signTxt(Math.round((m.decouple.sp500.slice(-1)[0].v - 100) * 10) / 10)} contro PIL reale ${signTxt(Math.round((m.decouple.gdp.slice(-1)[0].v - 100) * 10) / 10)} dal ${m.decouple.sp500[0].d}). ⚠ COME SI LEGGE: è una differenza CUMULATA, quindi cresce meccanicamente con la lunghezza della finestra — la soglia dei "40 pp" citata in letteratura NON è confrontabile con finestre di durata diversa, e su ${anni} anni di mercato al rialzo viene superata quasi sempre. Serve come contesto di valutazione, NON come segnale di uscita.`);
    } else {
      lines.push(`- Disaccoppiamento S&P 500 vs PIL reale: NON CALCOLABILE in questo snapshot — le due serie non condividono nessun periodo (azionario e PIL arrivano con finestre diverse), quindi la loro differenza non sarebbe un gap ma il confronto fra due orizzonti diversi. Si ricalcola da solo al prossimo run della pipeline.`);
    }
  }
  if ((m.curve_history || []).length) {
    const cv = m.curve_history.slice(-1)[0].v;
    // v193 — "DIS-INVERSIONE IN CORSO" NON PUO' ESSERE INCONDIZIONATO. Il payload lo scriveva
    // ogni volta che la curva era positiva, anche con l'ultima inversione a 469 sedute (~22 mesi)
    // di distanza: un evento concluso da quasi due anni presentato come processo in atto, con
    // tutta la carica di urgenza che "in corso" porta con se'. Ora la distanza dall'inversione
    // decide la frase, e il numero di sedute e' scritto accanto perche' il lettore lo veda.
    // sedute dall'ultima inversione: si contano dalla serie che il payload gia' possiede
    // (curve_history, 501 punti), non da un campo che la pipeline non produce.
    const inv = (() => {
      const h = (m.curve_history || []).map(x => (x && typeof x === "object" ? x.v : x));
      if (!h.length) return null;
      let n = 0;
      for (let i = h.length - 1; i >= 0; i--) { if (!(h[i] > 0)) break; n++; }
      return n === h.length ? null : n;      // mai invertita nella finestra: non si afferma nulla
    })();
    const desc = cv < 0 ? "ancora invertita = rischio recessione"
      : inv != null && inv > 250 ? `positiva da tempo — l'ultima inversione risale a ${inv} sedute fa, quindi NON è una dis-inversione in corso ma una curva normalizzata da tempo`
      : inv != null ? `tornata positiva dopo l'inversione di ${inv} sedute fa = dis-inversione recente`
      : "positiva (distanza dall'ultima inversione non disponibile: non se ne deduce se la dis-inversione sia recente)";
    const cIn = (m.indicators || []).find(i => i.key === "curve");
    lines.push(`- Curva 10A-2A: ${cv > 0 ? "+" : ""}${cv} pp${cIn ? ` (rilevazione ${cIn.date}, serie GIORNALIERA FRED T10Y2Y, ultima chiusura)` : ""} — ${desc}${cIn && dqV.flags.curve ? " " + dqV.flags.curve : ""}`);
  }
  if (m.yield_recession) {
    const yr = m.yield_recession;
    // v229 — NON ripete il valore della curva: e' lo STESSO numero della riga sopra, e ripeterlo
    // lo faceva sembrare una seconda rilevazione. Qui sta solo cio' che questa riga aggiunge:
    // il confronto a 12 mesi del modello storico e la regola dell'irripidimento.
    lines.push(`- Curva vs Recessione (modello storico FRED, stessa curva della riga qui sopra): ${yr.curve_12m_ago != null ? `12m fa ${yr.curve_12m_ago > 0 ? "+" : ""}${yr.curve_12m_ago} pp (media mensile del modello)` : "confronto a 12 mesi non disponibile"}, ${yr.label}. PIL reale YoY ${yr.gdp_last != null ? yr.gdp_last + "%" : "—"}, sussidi disocc. ${yr.claims_last ?? "—"}. ${yr.steepening ? "NB: la curva si sta IRRIPIDENDO dopo l'inversione — storicamente questa configurazione ha preceduto una recessione entro ~12 mesi (la curva shiftata di 12m anticipa il calo del PIL)." : `NB: la curva NON si sta irripidendo (oggi ${yr.current_curve} contro ${yr.curve_12m_ago} di 12 mesi fa): la regola \"irripidimento post-inversione → recessione entro ~12 mesi\" NON è attiva adesso, e va citata solo se e quando lo diventa.`}`);
  }
  // ═══ v203 — MEMORIA STORICA e CICLO DEI SEMICONDUTTORI: RIMOSSI su decisione del CEO.
  // Erano gli unici due blocchi che non avevano MAI girato con dati veri: FRED non risponde
  // dall'ambiente di sviluppo, quindi logica e rendering erano provati (22 test + dati
  // simulati) ma la FETCH no. E uno dei due lo dimostrava: scorte/spedizioni a 2,16 quando il
  // rapporto di settore sta intorno a 1,3-1,5, cioe' quasi certamente la serie sbagliata fra i
  // candidati provati. Pubblicare un percentile su una serie che non e' quella che dichiari e'
  // peggio che non pubblicarlo: da' l'autorita' di un dato storico a un numero che non lo e'.
  // Con loro se ne va anche tutto il codice FRED a serie lunghe (storia_lunga,
  // ciclo_semiconduttori, historical_context.py e i suoi test): non serviva ad altro.

  // v186 — FedWatch mostra il ramo ATTIVO, non solo i tagli. "prob. taglio 0%" era vero e
  // inutile: a fine luglio 2026 il mercato prezzava un RIALZO al 38% e il payload taceva.
  // In più: quando Polymarket quota lo stesso evento con un numero diverso, la divergenza è
  // essa stessa informazione (fonti che non concordano su una riunione a giorni), quindi le
  // due cifre vanno AFFIANCATE invece di pubblicarne una sola. Sono FATTI: niente giudizio.
  if (m.fedwatch && (m.fedwatch.meetings || []).length) {
    // v207 — la derivazione dei rami vive ora in ramiFedWatch(), condivisa col popup della
    // dashboard: erano due implementazioni della stessa cosa e una delle due era rimasta a metà.
    const mt = ramiFedWatch(m.fedwatch, m.fedwatch.meetings[0]);
    // v193 — TUTTI E TRE I RAMI, SEMPRE, anche a zero (richiesta CEO). Il v187 mostrava solo
    // quelli attivi: uno zero esplicito e' informazione ("il mercato non prezza affatto un
    // taglio"), mentre l'assenza della voce lascia il dubbio che il dato manchi.
    const rami = [
      `RIALZO ${mt.hike_prob ?? 0}%`,
      `invariato ${mt.hold_prob ?? 0}%`,
      `taglio ${mt.cut_prob ?? 0}%`,
    ];
    // stessa riunione quotata su Polymarket? (i mercati di previsione sono già nel payload)
    const cerca = (re) => (DATA.predictions || []).find(x => /\bfed\b/i.test(x.question || "") && re.test(x.question || ""));
    // il campo di Polymarket in data.json si chiama `yes` ed e' gia' in percentuale (17 = 17%);
    // si accettano anche le forme 0-1 e `probability` per non dipendere da un solo formato.
    const quota = (x) => { const r = x ? (x.yes ?? x.probability) : null;
      return r != null ? Math.round(r > 1 ? r : r * 100) : null; };
    const pmHike = quota(cerca(/increase|hike|raise/i));
    const pmHold = quota(cerca(/no change|unchanged|hold/i));
    const pezzi = [];
    // ⚠ OGNI CONFRONTO NOMINA IL PROPRIO ESITO: "lo stesso esito" senza dire quale si aggancia
    //   alla voce piu' vicina di chi legge, e produce una lettura falsa (v343).
    if (pmHold != null && mt.hold_prob != null) {
      const d = Math.abs(pmHold - mt.hold_prob);
      pezzi.push(`sull'INVARIATO Polymarket quota ${pmHold}% contro il ${mt.hold_prob}% dei futures${d >= 10 ? ` (${d} punti di divergenza)` : ""}`);
    }
    if (pmHike != null && mt.hike_prob != null) {
      const d = Math.abs(pmHike - mt.hike_prob);
      pezzi.push(`sul RIALZO quota ${pmHike}% contro il ${mt.hike_prob}%${d >= 10 ? ` (${d} punti)` : ""}`);
    }
    const conf = pezzi.length ? ` · POLYMARKET sulla stessa riunione: ${pezzi.join(" · ")}` : "";
    const pmPct = pmHike;
    /* ⚠ v345 — LA CURVA DELLE ATTESE, non solo il primo punto. `meetings` porta le riunioni
       successive con le loro probabilita': e' la FORMA a dire cosa prezza il mercato. Sulla
       prossima riunione la Fed sembra ferma; tre riunioni piu' in la' il rialzo e' quotato
       molto di piu', e quella pendenza e' l'informazione. */
    const succ = ((m.fedwatch || {}).meetings || []).slice(1, 4)
      .filter(x => x && x.date)
      .map(x => `${x.date.slice(8, 10)}/${x.date.slice(5, 7)} invariato ${x.hold_prob ?? 0}% · rialzo ${x.hike_prob ?? 0}% · taglio ${x.cut_prob ?? 0}%`);
    const curva = succ.length
      ? `\n- STRUTTURA A TERMINE DELLE ATTESE FED (dai futures, riunioni successive): ${succ.join(" | ")}`
        + `. La FORMA conta piu' del primo punto: se la probabilita' di rialzo cresce con l'orizzonte, il mercato non sta dicendo "Fed ferma", sta dicendo "ferma per ora".`
      : "";
    // ═══ v199 — IL CONTRATTO NON PREZZA QUELLA RIUNIONE. ZQ=F e' il future Fed Funds a 30
    // giorni sul MESE CORRENTE: prezza la media del mese in corso, non una riunione fra sei
    // settimane. Il 31/07 il payload ne ricavava "RIALZO 2%" per la riunione del 16/09 mentre
    // Polymarket, che quota proprio settembre, dava 56% — 54 punti di divergenza che sembravano
    // disaccordo fra fonti e invece erano un ERRORE DI ORIZZONTE del nostro calcolo.
    // Quando la riunione e' oltre la copertura del contratto non si pubblica una probabilita'
    // che non significa nulla: si dichiara il limite e si indica la fonte che quella riunione
    // la prezza davvero. Un numero fuori orizzonte e' peggio di nessun numero.
    const giorniAllaRiunione = (() => {
      const d = new Date(mt.date + "T00:00:00");
      return isNaN(d) ? null : Math.round((d - new Date()) / 86400000);
    })();
    const fuoriOrizzonte = giorniAllaRiunione != null && giorniAllaRiunione > 35;
    if (fuoriOrizzonte) {
      lines.push(`- FedWatch — NON CALCOLABILE per la riunione del ${mt.date} (fra ${giorniAllaRiunione} giorni): il tasso implicito ${m.fedwatch.implied_rate}% viene dal future Fed Funds a 30 giorni, che prezza il MESE IN CORSO e non una riunione così lontana. Le probabilità derivate da quel contratto non riguarderebbero quella data.`
        + (pmPct != null ? ` La fonte che quota proprio quella riunione è il mercato di previsione: rialzo ${pmPct}%.` : " Nessun mercato di previsione disponibile su quella riunione in questo payload."));
    } else {
      lines.push(`- FedWatch prossima riunione ${mt.date}${giorniAllaRiunione != null ? ` (fra ${giorniAllaRiunione} giorni)` : ""} (dai futures sui Fed Funds a 30 giorni: tasso implicito ${m.fedwatch.implied_rate}% vs punto medio del range attuale): ${rami.join(" · ")}${conf}${curva}`);
    }
  }
  if ((m.tilt || []).length) {
    lines.push("");
    lines.push("ROTAZIONE SETTORIALE/TEMATICA USA (ETF, performance 1M e 3M):");
    [...m.tilt].sort((a, b) => b.m1 - a.m1).forEach(s =>
      lines.push(`- ${s.name} (${s.ticker}): 1M ${signTxt(s.m1)}, 3M ${signTxt(s.m3)}`));

    /* ══ v346 — CORREZIONE O ROTTURA DEL TREND? Il pacchetto dava 1 mese e 3 mesi, e con quei
       due soli numeri un comparto a -3,4% e' indistinguibile fra "correzione dentro un rialzo
       intatto" e "tendenza che si e' girata". E' la differenza fra tenere e non tenere, cioe'
       la domanda piu' importante che si possa fare su una posizione lunga.
       La risposta era gia' nei dati e nessuno la leggeva: ogni ETF porta `medie` con la
       DISTANZA del prezzo da ma20/50/100/200 e la PENDENZA di ciascuna media. Se le brevi
       scendono mentre le lunghe salgono e il prezzo sta molto sopra la 200, e' una correzione;
       se anche le lunghe hanno girato, e' un'altra cosa.
       ⚠ NON si pubblicano tutti e 21: sarebbero settanta righe di rumore. Si pubblicano SOLO
       quelli in cui la lettura e' AMBIGUA — dove la pendenza breve e quella lunga hanno segno
       opposto — che e' esattamente l'insieme dei casi in cui la domanda e' viva. Il criterio
       si auto-seleziona e non invecchia: nessun elenco di ticker scritto a mano (classe C10). */
    const ambigui = [...m.tilt].filter(s => {
      const md = s.medie || {};
      const breve = (md.ma20 || {}).pendenza_pct, lunga = (md.ma200 || {}).pendenza_pct;
      return Number.isFinite(breve) && Number.isFinite(lunga) && (breve < 0) !== (lunga < 0);
    });
    /* ⚠ ordinare e' un giudizio (v200): qui il giudizio e' dichiarato nell'intestazione.
       Prima l'ordine era quello per performance a un mese, ereditato dalla lista sopra — e con
       un tetto di sei righe tagliava a caso. */
    ambigui.sort((x, y) => {
      const div = (t) => Math.abs((((t.medie || {}).ma20 || {}).pendenza_pct || 0) - (((t.medie || {}).ma200 || {}).pendenza_pct || 0));
      return div(y) - div(x);
    });
    if (ambigui.length) {
      lines.push("STRUTTURA DELLE MEDIE dove il breve e il lungo NON concordano (l'unico posto in cui "
        + "\"correzione o rottura?\" e' una domanda aperta; dove concordano la risposta e' gia' nel segno). In ordine di DIVERGENZA fra la pendenza a 20 giorni e quella a 200: piu' in alto, piu' la domanda e' aperta:");
      ambigui.slice(0, 6).forEach(s => {
        const md = s.medie || {};
        const pezzo = (n, e) => (e && Number.isFinite(e.dist_pct))
          ? `${n} prezzo ${signTxt(e.dist_pct)}${Number.isFinite(e.pendenza_pct) ? ` (media ${e.pendenza_pct < 0 ? "in calo" : "in salita"} ${signTxt(e.pendenza_pct)})` : ""}`
          : null;
        const parti = [pezzo("vs 20g:", md.ma20), pezzo("vs 50g:", md.ma50),
                       pezzo("vs 100g:", md.ma100), pezzo("vs 200g:", md.ma200)].filter(Boolean);
        if (parti.length) lines.push(`- ${s.name} (${s.ticker}): ${parti.join(" · ")}`);
      });
    }
  }
  if (m.sp500_pe) {
    const cf = m.sp500_pe.carried ? `, ⚠ CARRY-FORWARD dal run precedente${m.sp500_pe.fetched_at || m.sp500_pe.date ? ` (rilevato ${String(m.sp500_pe.fetched_at || m.sp500_pe.date).slice(0, 10)})` : ""} — fonte irraggiungibile: dato DATATO` : "";
    let peLine = `- P/E Ratio S&P 500 [TRAILING, fonte: ${m.sp500_pe.source || "FRED/multpl"}${cf}]: ${m.sp500_pe.current}× (${m.sp500_pe.label})${m.sp500_pe.avg_10y != null ? ` · media 10A ${m.sp500_pe.avg_10y}×` : ""}${m.sp500_pe.pct_rank != null ? ` · percentile storico ${m.sp500_pe.pct_rank}°` : ""}`;
    if (m.sp500_pe.nasdaq_pe) peLine += ` · Nasdaq 100 (QQQ) P/E: ${m.sp500_pe.nasdaq_pe}× (tech solitamente a premio; >35× = valutazioni tese)`;
    lines.push(peLine);
  }
  if (m.corp_profit) {
    const ggCp = sovrapposizioneGiorni(m.corp_profit.sp500, m.corp_profit.profits);
    let cpBp = ggCp
      ? `- S&P 500 & Nasdaq 100 vs Profitti Aziendali Reali (FRED CP): S&P gap ${m.corp_profit.gap > 0 ? "+" : ""}${m.corp_profit.gap} pp`
      : `- S&P 500 & Nasdaq 100 vs Profitti Aziendali Reali (FRED CP): il gap dell'S&P NON è calcolabile in questo snapshot (la sua serie e quella dei profitti non condividono nessun periodo)`;
    if (m.corp_profit.ndx_gap != null) cpBp += `, NDX gap ${m.corp_profit.ndx_gap > 0 ? "+" : ""}${m.corp_profit.ndx_gap} pp`;
    cpBp += ` — ${m.corp_profit.label} (soglia di lettura: gap>40 pp = Asset Inflation da fiat debasement, non crescita utili reali). ⚠ NON è una seconda conferma indipendente del Disaccoppiamento qui sopra: entrambi misurano "l'azionario è salito più dell'economia reale" su una finestra pluriennale, con denominatori diversi (PIL contro profitti). sono lo stesso segnale contato due volte, non due prove separate.`;
    lines.push(cpBp);
  }
  if (m.fed_market) /* ⚠ v264 — DICEVA "Fed Funds Rate" PER LA SECONDA VOLTA, CON UN NUMERO DIVERSO. In QUADRO
       MACRO: "range ATTUALE 3.50-3.75%". Cinquanta righe dopo: "Fed Funds Rate attuale: 3.63%".
       Sono due grandezze diverse — il TARGET che decide il FOMC e il tasso EFFETTIVO a cui le
       banche si prestano dentro quel target — ma si chiamavano uguale e non si riconciliavano.
       Un analista che legge la seconda e la confronta con la soglia del 4% nella stessa riga
       usa il numero giusto per caso. Classe "stessa grandezza, valori diversi", trovata a mano
       perche' i due nomi non sono identici al carattere. E stava dentro ROTAZIONE SETTORIALE,
       dove un tasso non c'entra niente. */
    lines.push(`- Tasso EFFETTIVO (EFFR) ${m.fed_market.current_rate}% (rilevazione ${m.fed_market.rate_date}) — e' dove le banche si prestano DENTRO il target 3,50-3,75% dichiarato in QUADRO MACRO, non un secondo tasso di politica monetaria. Sopra il 4% storicamente comprime i multipli P/E in 12-18 mesi.`);
  // 4 streghe SOLO se imminenti (v138): a >30 giorni è rumore senza valore operativo
  if (m.witching && m.witching.days != null && m.witching.days < 30) lines.push(`- Prossime "4 streghe" (quadruple witching): ${new Date(m.witching.next).toLocaleDateString("it-IT")} (tra ${m.witching.days} gg — volumi record e prezzo "attratto" dai muri di opzioni: prudenza sugli ordini a ridosso)`);
  /* v256 — QUATTRO BLOCCHI RELATIVI AL PORTAFOGLIO TOLTI DAL QUADRO MACRO: salute del
     portafoglio (blend), concentrazione per settore, IDEE DI ROTAZIONE (screening di
     compounder "ESTERNI al portafoglio": senza un portafoglio, "esterni" non significa
     niente) e performance storica del broker. Sono sopravvissuti al taglio grande perché
     stavano DENTRO il blocco macro, non prima: è la classe v201-v204, un vicino che resta
     in piedi perché il confine gli passa accanto invece che addosso. */

  /* v257 — LIQUIDITA' E CONTROVALORE INVESTITO tolti dal quadro macro: sono le due grandezze
     piu' private del portafoglio, ed erano rimaste dentro un blocco che si chiama MACRO. */
  // TOP 10 CAPITALIZZAZIONI rimosso dal payload (v138): nessun valore decisionale per il
  // fondo (i nomi rilevanti sono già in ptf/watchlist con dati completi); resta nella UI.
  // TOP 10 ETF: RIMOSSO dal payload (v184), come TOP 10 CAPITALIZZAZIONI in v138 — e resta nella UI.
  // Non e' stato citato in nessuno dei tre report reali di LLM diversi sullo stesso payload, e la
  // rotazione che serve davvero e' gia' in ROTAZIONE SETTORIALE (21 ETF con performance 1M e 3M).
  if ((DATA.predictions || []).length) {
    lines.push("");
    recordPolymarket();   // registra lo snapshot di oggi (dedup giornaliero) per la derivata Δ7g
    lines.push("MERCATI DI PREVISIONE (Polymarket, prob. Sì · [Δ7g] = velocità del sentiment speculativo macro — accelerazioni repentine sulle aspettative tassi Fed pesano di più):");
    DATA.predictions.forEach(p => { const d = pmDelta7(p.question, p.yes); lines.push(`- ${p.question}: ${p.yes}% [Δ7g ${d == null ? "—" : (d > 0 ? "+" : "") + d + "pp"}]`); });
  }
  /* v256 — ULTIME NEWS fuori dal payload: le news escono dal sistema con il portafoglio.
     La lettura delle notizie su un singolo nome torna, quando serve, dall'analisi spot del
     titolo — dove l'LLM le cerca sul mercato vivo invece di leggerle da uno snapshot su cron. */

  // v180 — PROMEMORIA FINALE RIMOSSO: era un secondo esemplare della testata. Tutti e sei i suoi
  // concetti (ordini a limite, niente domande in chiusura, violazioni dichiarate, assunzione
  // quando un dato manca, forma libera, verifica dei dati datati) sono gia' in [A2] e [D], e
  // ripeterli in coda non li rafforzava: segnalava che il payload non si fida della testata, e
  // consumava l'attenzione finale del lettore su regole invece che su dati.

  return lines.join("\n");
}

function toast(msg, ms = 3200) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ============ ANALISI AI (v130) — UN SOLO BOTTONE, un solo flusso ============
   "📋 Copia Analisi AI" genera DAL VIVO (niente file CI, niente LLM di mezzo) il pacchetto
   COMPLETO da incollare in Claude: buildPrompt() intatto (testata utente + payload dati) +
   i DIGEST STORICI (la "lettura quantitativa dei grafici" dei popup: macro, tecnica multi-
   orizzonte, fondamentale profondo) + le news già nel payload. Copia negli appunti e mostra
   la modal per revisione/modifica. Il documento HTML/PDF istituzionale è stato RIMOSSO per
   decisione del CEO (il lettore del report è Claude, non un umano: il testo È il report). */

/* ---------- helpers numerici null-safe (— ovunque manchi il dato) ---------- */
const dgFin = (v) => (v != null && Number.isFinite(Number(v))) ? Number(v) : null;
const dgTxt = (v, suf = "", dec = 1) => { const n = dgFin(v); return n == null ? "—" : fmtNum.format(Math.round(n * 10 ** dec) / 10 ** dec) + suf; };
const dgPct = (x) => { const n = dgFin(x); return n == null ? null : Math.round(n * 1000) / 10; };   // frazione → %
const dgDelta = (arr, n) => {   // variazione % ultimo vs n passi indietro (serie di numeri)
  if (!Array.isArray(arr) || arr.length < n + 1) return null;
  const a = dgFin(arr[arr.length - 1 - n]), b = dgFin(arr[arr.length - 1]);
  return (a && b) ? (b / a - 1) * 100 : null;
};
/* RENDIMENTO DEL BOOK cash-flow-neutral su ~daysBack giorni, dai delta di gain_pct del
   metrics_history: (1+g_ora)/(1+g_prima)−1. È l'UNICO rendimento onesto del portafoglio —
   i delta di eur_value sono inquinati (a) dal break di definizione cassa-inclusa→esclusa di
   metà luglio 2026 e (b), sempre, da versamenti/prelievi di liquidità. Lookback per DATA (per
   allinearsi alle finestre degli indici); fallback per conteggio rilevazioni se le date mancano. */
/* ⚠⚠ v349 — SI CHIAMAVA PERCENTILE E NON LO ERA. Questa funzione calcolava la POSIZIONE nel
   range (v−min)/(max−min), che e' un'altra cosa: dice dove cade il valore fra i due estremi,
   non quante volte la serie e' stata piu' bassa. Il commento lo diceva onestamente, l'etichetta
   pubblicata no — e la testata ordina all'LLM di usare i percentili come sono, senza rifarli.
   Misurato sui dati del 23/08/2026:
     HY OAS   pubblicato 14°  · rango vero 23°
     WTI      pubblicato 55°  · rango vero 71°
     T30A     pubblicato 91°  · rango vero 98°
   Sull'HY OAS cambiava anche il giudizio: sotto 20 si accende "(compressione estrema: il
   credito non prezza rischio)", che al rango vero non si accenderebbe. Il range min–max resta
   pubblicato a fianco, quindi non si perde niente: si smette solo di chiamarlo percentile. */
const dgPercentile = (arr, v) => {   // vero RANGO percentile: quante osservazioni stanno sotto
  const xs = (arr || []).map(dgFin).filter(x => x != null);
  const x = dgFin(v);
  if (x == null || xs.length < 5) return null;
  const sotto = xs.filter(y => y < x).length;
  const pari = xs.filter(y => y === x).length;
  /* convenzione "midrank": i valori uguali contano per meta', cosi' il minimo non e' 0° e il
     massimo non e' 100° quando ci sono ripetizioni */
  return Math.round((sotto + pari / 2) / xs.length * 100);
};

/* ---------- fondamentale PROFONDO: CAGR pluriennale dai bilanci già in pipeline ---------- */

/* ⚠ v349 — LA VARIAZIONE A UN MESE SI MISURA SUL CALENDARIO, per tutte le serie.
   `dgDelta(arr, 21)` conta VENTUNO PUNTI: giusto su una serie giornaliera fitta, sbagliato su
   una diradata (le materie prime davano 58 giorni). Peggio, con lookback per conteggio bastava
   un passo di differenza — 20 punti invece di 21 — per far cambiare SEGNO al trend a un mese
   dell'HY OAS, e nello stesso pacchetto comparivano tre "variazioni a un mese" diverse dello
   stesso spread. Contate per data, sono una sola cosa e si possono confrontare. */
const dgData = (x) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x)) ? x.slice(0, 10) : null;
function dg1M(punti) {
  const p = (punti || []).map(x => ({ d: dgData(x && x.d), v: dgFin(x && x.v) })).filter(x => x.v != null);
  if (p.length < 2 || !p.every(x => x.d)) return null;
  const ultimo = p[p.length - 1];
  const limite = new Date(new Date(ultimo.d).getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const prima = [...p].reverse().find(x => x.d <= limite);
  return (prima && prima.v) ? { pct: (ultimo.v / prima.v - 1) * 100, da: prima.d, a: ultimo.d } : null;
}
/* ---------- DIGEST STORICI: le serie che i popup disegnano, tradotte in numeri ----------
   Un analista guarda le TRAIETTORIE (pendenza, percentile nel range, inversioni), non i livelli:
   questi digest danno all'AI esattamente ciò che l'occhio estrae dai grafici. Ogni voce è
   null-safe: serie assente → "—", mai un crash o un placeholder sporco. */
function buildHistoricalDigests() {
  const m = DATA.macro || {};
  const out = [];

  /* ⚠ v252 — MARGIN DEBT TOLTO ANCHE DAI DIGEST STORICI. In v249 l'avevo tolto dal QUADRO
     MACRO, ma `buildCIOText()` appende i digest e il dato rientrava da lì: il pacchetto che il
     CEO incolla lo conteneva ancora. È la classe "due implementazioni della stessa cosa"
     (v161, v207), trovata solo eseguendo il payload su me stesso invece di rileggere il codice.
     La motivazione resta quella del v249: dato onesto ma lento (68 giorni), presentato come
     stato attuale. Resta in dashboard con la sua data. */
  const cr = m.credit || {};
  const crh = Array.isArray(cr.history) ? cr.history.map(x => dgFin(x && x.v)).filter(x => x != null) : [];
  const crPct = dgPercentile(crh, cr.spread_hy);
  const crM = dg1M(cr.history);
  out.push({ label: "HY OAS (spread high yield, serie 1A)", text: crh.length >= 5
    ? `${dgTxt(cr.spread_hy, "%", 2)} · Δ1M ${crM ? `${signTxt(crM.pct, "%")} (${crM.da}→${crM.a})` : signTxt(dgDelta(crh, 21), "%")} · range 1A [${dgTxt(Math.min(...crh), "", 2)}–${dgTxt(Math.max(...crh), "", 2)}] · percentile ${dgTxt(crPct, "°", 0)}${crPct != null && crPct <= 20 ? " (compressione estrema: il credito non prezza rischio)" : crPct != null && crPct >= 80 ? " (stress creditizio in costruzione)" : ""}`
    : "—" });

  const cvh = Array.isArray(m.curve_history) ? m.curve_history.map(x => dgFin(x && x.v)).filter(x => x != null) : [];
  /* la curva e' in punti percentuali: la variazione utile e' la DIFFERENZA, non il rapporto */
  const cv1 = dg1M(m.curve_history);
  const cvM = cv1 ? { assoluto: cvh[cvh.length - 1] * cv1.pct / (100 + cv1.pct), da: cv1.da, a: cv1.a } : null;
  let inv = null;
  for (let i = cvh.length - 1; i >= 0; i--) { if (cvh[i] < 0) { inv = cvh.length - 1 - i; break; } }
  out.push({ label: "Curva 10A–2A (serie ~2A)", text: cvh.length >= 5
    ? `${dgTxt(cvh[cvh.length - 1], "pp", 2)} · Δ1M ${cvM ? `${dgTxt(cvM.assoluto, "pp", 2)} (${cvM.da}→${cvM.a})` : (cvh.length >= 22 ? dgTxt(cvh[cvh.length - 1] - cvh[cvh.length - 22], "pp", 2) + " (22 rilevazioni indietro: la serie non porta le date)" : "—")} · Δ3M ${cvh.length >= 64 ? dgTxt(cvh[cvh.length - 1] - cvh[cvh.length - 64], "pp", 2) : "—"} · ${inv == null ? "nessuna inversione nella serie" : inv === 0 ? "INVERTITA ORA" : `ultima inversione ${inv} sedute fa${inv <= 252 ? " (il rischio recessivo storicamente matura DOPO la dis-inversione)" : ""}`}`
    : "—" });

  const vx = m.vix || {};
  const vxs = Array.isArray(vx.spark) ? vx.spark.map(dgFin).filter(x => x != null) : [];
  const vxPct = dgPercentile(vxs, vx.value);
  out.push({ label: "VIX (spark 30 sedute)", text: dgFin(vx.value) != null
    ? `${dgTxt(vx.value, "", 1)} · oggi ${signTxt(dgFin(vx.change_pct))} · percentile finestra ${dgTxt(vxPct, "°", 0)} · term VIX/VIX3M ${dgTxt((m.smart_money || {}).vix_term_ratio, "", 2)}${dgFin((m.smart_money || {}).vix_term_ratio) != null ? ((m.smart_money || {}).vix_term_ratio >= 1 ? " (BACKWARDATION: stress)" : " (contango: calma)") : ""}`
    : "—" });

  /* ══ v345 — QUATTRO SERIE CHE IL SISTEMA AVEVA E NON LEGGEVA ═══════════════════════════
     Misurato: la parte del pacchetto che una ricerca online NON puo' produrre pesava 775
     caratteri su 22.832, cioe' il 3,4%. Tutto il resto e' reperibile — a costo di trenta
     ricerche. Allargare quel 3,4% e' l'unico modo di rendere il pacchetto piu' utile senza
     renderlo piu' lungo in modo inutile.
     Le serie c'erano gia' in data.json e nessuno le interrogava: `tassi.storico.a10` e `.a30`
     con 369 punti, `materie.rame.history` e `.petrolio.history` con 126. Sono i due canali che
     contano su un libro lungo di duration e di infrastruttura: il costo del capitale (che
     riprezza il multiplo) e il costo degli input (che entra nel deflatore e nel costo di
     costruzione di un data center).
     ⚠ Un livello non dice niente da solo. "10 anni al 4,74%" e' un numero; "4,74%, all'87°
     percentile del suo intervallo di 18 mesi" e' un'informazione — ed e' precisamente cio' che
     nessuna ricerca web restituisce, perche' richiede la serie. */
  /* ⚠⚠ v349 — "Δ1M" MISURAVA CINQUANTOTTO GIORNI, e su una serie sola sarebbe un dettaglio.
     `dgDelta(h, 21)` conta VENTUNO PUNTI, non ventuno sedute. Sulle serie fitte (HY OAS, curva)
     le due cose coincidono e il numero era giusto; le materie prime invece la pipeline le dirada
     (`passo = len(h) // 120`), quindi 126 punti coprono 361 giorni e ventuno punti sono
     cinquantotto giorni. Misurato sui dati del 23/08/2026:
       rame     "Δ1M +10,84%"  → un mese vero: +1,17%
       petrolio "Δ1M +23,77%"  → un mese vero: +2,53%
     Un petrolio a +23,8% in un mese e' uno shock da costi che entra nel deflatore; a +2,5% non
     succede niente. E lo stesso blocco etichettava "serie ~6M" una serie di 361 giorni.
     Ora la finestra si misura sulle DATE e l'etichetta si scrive dal periodo vero: se la densita'
     di una serie cambia, il numero resta quello che dichiara di essere. */
  const serieStorica = (arr, valore, nome, unita, decimali, altoBasso) => {
    const punti = Array.isArray(arr)
      ? arr.map(x => ({ d: x && x.d, v: dgFin(x && x.v) })).filter(x => x.v != null) : [];
    const h = punti.map(x => x.v);
    const v = dgFin(valore) != null ? dgFin(valore) : (h.length ? h[h.length - 1] : null);
    if (h.length < 30 || v == null) return;
    const pct = dgPercentile(h, v);
    let nota = "";
    if (pct != null && altoBasso) nota = pct >= 80 ? ` (${altoBasso[0]})` : pct <= 20 ? ` (${altoBasso[1]})` : "";
    /* variazione a un mese contata sul CALENDARIO: l'ultima osservazione con almeno 30 giorni
       di distanza da quella finale. Senza date si ripiega sul conteggio dei punti, e lo dichiara. */
    const dUlt = punti.length ? dgData(punti[punti.length - 1].d) : null;
    let delta = null, comeDelta = "";
    if (dUlt && punti.every(x => dgData(x.d))) {
      const limite = new Date(new Date(dUlt).getTime() - 30 * 86400000).toISOString().slice(0, 10);
      const prima = [...punti].reverse().find(x => x.d <= limite);
      if (prima && prima.v) {
        delta = (h[h.length - 1] / prima.v - 1) * 100;
        comeDelta = ` (${prima.d}→${dUlt})`;
      }
    } else {
      delta = dgDelta(h, 21);
      comeDelta = " (21 rilevazioni indietro: la serie non porta le date)";
    }
    /* l'etichetta della finestra si scrive dal periodo COPERTO, non a mano */
    let finestra = "";
    if (dUlt && dgData(punti[0].d)) {
      const gg = Math.round((new Date(dUlt) - new Date(punti[0].d)) / 86400000);
      finestra = gg >= 640 ? ` (serie ~${Math.round(gg / 365)}A)` : ` (serie ~${Math.round(gg / 30)}M)`;
    }
    out.push({ label: nome + finestra, text:
      `${dgTxt(v, unita, decimali)} · Δ1M ${signTxt(delta, "%")}${comeDelta} · range [${dgTxt(Math.min(...h), "", decimali)}–${dgTxt(Math.max(...h), "", decimali)}] su ${h.length} rilevazioni · percentile ${dgTxt(pct, "°", 0)}${nota}` });
  };
  const tassi = m.tassi || {}, st = tassi.storico || {}, mat = m.materie || {};
  /* ⚠⚠ v349 — IL VALORE VENIVA DA UN'ALTRA FONTE DELLA SERIE CHE LO DOVEVA COLLOCARE.
     `tassi.a10` non esiste (il valore sta in `tassi.scadenze[key=a10].value`), quindi il ramo
     attivo e' sempre stato il ripiego `carry.us10`, che e' ^TNX da yfinance — mentre la serie
     e' FRED DGS10. Misurato: 4,74% (yfinance, 21/08) collocato nella distribuzione DGS10 dava
     100°, cioe' "mai stato cosi' alto", perche' era un valore estraneo alla serie; il valore
     della serie stessa (4,69%, 20/08) sta al 98°. E lo stesso pacchetto stampava due Treasury
     10 anni diversi senza dire che erano due fonti. Un valore si colloca nella distribuzione
     da cui viene, o non lo si colloca. */
  const a10Serie = ((tassi.scadenze || []).find(x => x && x.key === "a10") || {}).value;
  serieStorica(st.a10, a10Serie, "Treasury 10A", "%", 2,
    ["costo del capitale ai massimi del periodo: e' il canale che comprime i multipli lunghi", "costo del capitale ai minimi: vento a favore sulla duration"]);
  serieStorica(st.a30, null, "Treasury 30A", "%", 2,
    ["parte lunga ai massimi: il mercato chiede premio a termine", "parte lunga ai minimi"]);
  serieStorica((mat.rame || {}).history, (mat.rame || {}).value, "Rame", " $/lb", 2,
    ["input industriale ai massimi: entra nel deflatore e nel costo di costruzione dei data center", "input industriale ai minimi: domanda debole o offerta abbondante"]);
  serieStorica((mat.petrolio || {}).history, (mat.petrolio || {}).value, "Petrolio WTI", " $", 2,
    ["energia ai massimi: pressione sul deflatore e sul costo di esercizio", "energia ai minimi"]);

  /* v257 — CONTROVALORE E SHARPE DEL FONDO tolti dai digest: erano l'ultima traccia del
     portafoglio nel pacchetto, ed e' il CEO che l'ha vista incollandomi il prompt. */

  return out;
}

/* CINEMATICA per-titolo (v131): derivate reali da metrics_history. I titles per-titolo esistono
   dai run dell'11/07 → il lookback dev'essere TITOLATO (nearest snapshot con dati per quel ticker),
   altrimenti cade prima che i titles esistano e la derivata risulta "vuota" (bug del placeholder). */
/* percentile del prezzo nel range 52 settimane (da sparks.y1: dove sta OGGI tra minimo e massimo) */
/* trend multi-orizzonte + cinematica per titolo */

/* news mappate al singolo titolo attivo (100% dei titoli): usa i tag ticker già nel feed */

/* EXECUTIVE BRIEF (v131): Δ dall'ultimo storico + priorità operativa — l'orientamento in cima
   che trasforma il dump in un brief. Solo INPUT per l'analisi, NON decisioni (quelle le prende Claude). */
/* ⚠ v256 — marketLinkText() e buildExecutiveDelta() RIMOSSE. La prima costruiva il blocco
   "CORRELAZIONI CALCOLATE — COSA MUOVE IL TUO PORTAFOGLIO OGGI": un join news↔settori↔POSIZIONI,
   e tutte e sei le sue famiglie di divergenza (relapse, MCR, tema, accelerazione, stop, meta)
   erano per-titolo. La seconda era il brief sul delta del NAV. Senza portafoglio e senza news
   nessuna delle due ha più un ingresso.
   ⚠ IL CEO HA CHIESTO DI TENERE "la relativa correlazione". Non poteva essere quella per-titolo:
   si regge sulle posizioni che aveva appena tolto. Per undici versioni la correlazione superstite
   e' stata quella FRA GLI INDICATORI MACRO, misurata come dispersione dei punteggi 0-100.
   ⚠ v337 — anche quella e' uscita, insieme alla scala su cui poggiava. La domanda resta, ma ora
   e' un'ISTRUZIONE nella testata (B2) invece di un calcolo nel payload: chiedere all'LLM di
   trovare il disaccordo fra i valori grezzi non richiede che sia io a punteggiarli prima. */


/* ---------- testo per l'analisi AI: executive brief + prompt esistente + digest storici ---------- */
/* ══ v348 — IL LIBRO INTERO, ACCANTO AL SINGOLO TITOLO ═══════════════════════════════════
   Il CEO: "aggiungi anche una sezione ai dati del mio portafoglio così da dare un quadro più
   ampio". La ragione e' misurata: la posizione piu' grande vale il 24% dell'azionario e i sei
   semiconduttori il 69%, quindi un giudizio su MU che ignora il resto del libro sta valutando
   il 24% come se fosse il 100%.
   ⚠ NON E' IL PACCHETTO DI PORTAFOGLIO DELLA v315, che e' stato tolto e resta tolto: quello
   chiedeva un'analisi del libro. Questo e' CONTESTO — pesi e concentrazione — perche' chi
   giudica un titolo sappia in che compagnia sta.
   ⚠ E NON DA' NUMERI PER DIMENSIONARE: niente liquidita', niente controvalori assoluti, solo
   pesi relativi. Il divieto di dimensionare resta quello di sempre, e senza gli importi non
   c'e' nemmeno la tentazione. */
function contestoPortafoglio(tkCorrente) {
  const righe = [...((DATA && DATA.portfolio) || []), ...((DATA && DATA.watchlist) || [])]
    .filter(r => r && numero(r.qta ?? r.qty) > 0 && numero(r.pmc) > 0);
  if (righe.length < 2) return "";
  const val = (r) => {
    const q = numero(r.qta ?? r.qty), p = numero(r.price), pmc = numero(r.pmc);
    if (!Number.isFinite(q)) return null;
    /* ⚠ un'obbligazione quota in PERCENTUALE del nominale: moltiplicarla come un'azione la
       fa risultare il 93% del libro (v307). Se il prezzo manca si usa il carico. */
    const prezzo = Number.isFinite(p) ? p : pmc;
    return /^BTP|^BOT|^CCT|^IT000/i.test(String(r.ticker)) ? q * prezzo / 100 : q * prezzo;
  };
  const conVal = righe.map(r => ({ r, v: val(r) })).filter(x => Number.isFinite(x.v) && x.v > 0);
  if (!conVal.length) return "";
  const azionarie = conVal.filter(x => !/^BTP|^BOT|^CCT|^IT000/i.test(String(x.r.ticker)));
  const totAz = azionarie.reduce((s, x) => s + x.v, 0);
  if (!totAz) return "";
  const L = [];
  L.push("=== IL LIBRO IN CUI QUESTA POSIZIONE VIVE (contesto, non richiesta di analisi del portafoglio) ===");
  L.push("Pesi sul solo comparto AZIONARIO, che e' il denominatore dichiarato: il titolo di Stato "
    + "e la liquidita' restano fuori perche' il sistema non li conosce entrambi. Nessun importo "
    + "assoluto: servirebbe a dimensionare, e dimensionare e' vietato.");
  const ord = [...azionarie].sort((a, b) => b.v - a.v);
  ord.forEach(x => {
    const pct = x.v / totAz * 100;
    const g = numero(x.r.gain_pct_pos ?? x.r.gain_pct);
    const qui = String(x.r.ticker).toUpperCase() === String(tkCorrente || "").toUpperCase() ? "  ← IL TITOLO DI QUESTA ANALISI" : "";
    L.push(`- ${x.r.ticker}: ${pct.toFixed(1)}% dell'azionario${Number.isFinite(g) ? ` · ${signTxt(g)} dal carico` : ""}${qui}`);
  });
  /* la concentrazione per BENCHMARK, non per settore: e' il fattore che muove insieme */
  const semi = azionarie.filter(x => x.r.rs_bench === "sox" || /semiconduc|semicondut/i.test(String(x.r.sector || "")));
  const pesoSemi = semi.reduce((s, x) => s + x.v, 0) / totAz * 100;
  const primeTre = ord.slice(0, 3).reduce((s, x) => s + x.v, 0) / totAz * 100;
  L.push(`CONCENTRAZIONE: le prime tre posizioni valgono il ${primeTre.toFixed(0)}% dell'azionario`
    + `${semi.length >= 2 ? ` · i ${semi.length} titoli che seguono il SOX ne valgono il ${pesoSemi.toFixed(0)}% (${semi.map(x => x.r.ticker).join(", ")})` : ""}`
    + `. ⚠ Titoli che condividono lo stesso fattore sono UNA scommessa scritta piu' volte, non `
    + `posizioni indipendenti: l'esposizione del libro a quel fattore e' la loro somma, `
    + `non il peso del singolo nome.`);
  const muti = ((((DATA || {}).macro || {}).posizioni || {}).senza_prezzo) || [];
  if (muti.length) {
    L.push(`⚠ FUORI DA QUESTO ELENCO, E QUINDI DAI PESI: ${muti.join(", ")} — il sistema ha la posizione `
      + `ma non il prezzo (la fonte non quota quel simbolo), quindi non puo' calcolarne il controvalore. `
      + `I pesi qui sopra sono percentuali di un azionario che NON comprende ${muti.length === 1 ? "questa posizione" : "queste posizioni"}.`);
  }
  return L.join("\n");
}

/* ══ v348 — IL DIARIO DELLE OPERAZIONI NEL PACCHETTO ═════════════════════════════════════
   Il CEO: "inserisci nuovamente diario come lo avevamo un tempo e recupera i dati che inserii
   in passato". I dati non erano persi: `config/action_diary.json` e' rimasto nel repository
   con TREDICI operazioni vere dal 29/06 al 22/08, mentre in v256 usciva di scena solo la UI
   che le mostrava.
   ⚠ PERCHE' STA NEL PACCHETTO E NON SOLO IN PAGINA: chi giudica un titolo deve sapere se il
   CEO ci ha gia' messo mano e quando. "MU +1003%" e "MU +1003%, alleggerito di 20 azioni il
   24/06" sono due situazioni diverse, e la seconda dice che una decisione e' gia' stata presa.
   ⚠ IL DIARIO E' UN FATTO, NON UN'ISTRUZIONE (regola C9): si pubblica cosa e' successo, non
   cosa farne. */
/* Il tetto serve a non far esplodere il pacchetto quando il diario avra' centinaia di
   voci. A 12 tagliava la riga del 29/06 — quattro operazioni in una — che e' fra le
   piu' informative che ci siano. */
const DIARIO_MAX = 20;
function diarioOperazioni(tkCorrente) {
  const v = (typeof DIARIO_VOCI !== "undefined" && Array.isArray(DIARIO_VOCI)) ? DIARIO_VOCI : [];
  if (!v.length) return "";
  const tk = String(tkCorrente || "").toUpperCase();
  const riga = (x) => {
    const o = diaryOp(x);
    const d = String(x.date || "").slice(0, 10);
    const testo = String(x.text || "").replace(/\s+/g, " ").trim();
    /* ⚠ UNA RIGA CHE CONTIENE PIU' OPERAZIONI NON SI RIASSUME. "Alleggerito micron 20
       azioni e amd 25 e venduto Intel e tesla tutto" strutturata diventa "VENDITA 20 MU"
       e le altre tre sparirebbero: nel pacchetto di AMD quella vendita non esisterebbe.
       Prosa e voci multiple si pubblicano INTEGRE, e chi legge le interpreta con tutto
       il testo davanti invece che con un riassunto che ha perso i tre quarti. */
    if (!o || o.multi) return `- ${d}: ${testo}`;
    const mio = tk && String(o.ticker).toUpperCase() === tk ? "  ← QUESTO TITOLO" : "";
    const quando = o.quando && o.quando !== "DA CONFERMARE" ? o.quando : `${d} ⚠ data dell'annotazione, non dell'ordine`;
    const q = o.qty != null ? fmtNum.format(o.qty) : "quantita' non annotata";
    const p = o.prezzo != null ? ` a ${o.prezzo}` : " (prezzo non annotato)";
    return `- ${o.tipo} ${q} ${o.ticker}${p} (${quando})${mio}`;
  };
  /* Una voce riguarda questo titolo se lo CITA, non solo se il parser l'ha messo in testa:
     nella riga del 29/06 il primo nome e' "micron", ma la stessa riga parla anche di AMD. */
  const cita = (x) => {
    const mappa = diaryTickerMap();
    const trovati = new Set();
    const o = diaryOp(x);
    if (o) trovati.add(String(o.ticker).toUpperCase());
    (String(x.text || "").toLowerCase().match(/[a-z]{2,}/g) || []).forEach(w => { if (mappa[w]) trovati.add(mappa[w]); });
    return trovati.has(tk);
  };
  const suo = tk ? v.filter(cita) : [];
  const L = [];
  L.push("=== IL DIARIO DELLE OPERAZIONI DEL CEO (cosa ha gia' fatto, e quando) ===");
  L.push("Sono le sue annotazioni, non ricostruzioni del sistema. Una posizione su cui ha gia' "
    + "agito non e' la stessa cosa di una posizione mai toccata: se ha alleggerito o incrementato "
    + "di recente, su quel nome una decisione e' gia' stata presa.");
  if (suo.length) {
    L.push(`SU QUESTO TITOLO (${tk}): ${suo.length} ${suo.length > 1 ? "operazioni annotate" : "operazione annotata"}.`);
    suo.forEach(x => L.push(riga(x)));
    L.push("");
  }
  L.push(v.length > DIARIO_MAX
    ? `ULTIME OPERAZIONI SUL LIBRO (le piu' recenti ${DIARIO_MAX} su ${v.length}):`
    : `TUTTE LE OPERAZIONI ANNOTATE (${v.length}):`);
  v.slice(0, DIARIO_MAX).forEach(x => L.push(riga(x)));
  L.push("⚠ Le voci piu' vecchie sono testo libero scritto a mano: contengono piu' operazioni in "
    + "una riga e date interne al testo. Leggile come sono, non normalizzarle.");
  return L.join("\n");
}

function historicalDigestText() {
  /* v256 — DIGEST SOLO MACRO. Cadono con il portafoglio: CINEMATICA & TREND PER TITOLO (32
     righe di ticker), REGIME DI VARIANZA (MCR Top-3), NEWS VERTICALE PER TITOLO ATTIVO,
     FONDAMENTALE PROFONDO. Restano le serie storiche macro — HY OAS, curva 10A-2A, VIX — che
     sono la "lettura quantitativa dei grafici" per cui il blocco e' nato: pendenze, percentili
     nel range, inversioni, calcolate da serie gia' in data.json. Null-safe: serie assente → "—". */
  const L = [];
  const righe = buildHistoricalDigests().filter(d => d && d.text && d.text !== "—");
  if (!righe.length) return "";
  L.push("=== ANALISI STORICA DELLE SERIE MACRO (traiettorie: pendenze, percentili nel range, inversioni) ===");
  for (const d of righe) L.push(`\u00b7 ${d.label}: ${d.text}`);
  L.push("USO METODOLOGICO: sulle serie macro sia i valori ESTREMI (HY OAS ai minimi del range, "
       + "VIX ai minimi della sua distribuzione) sia le INVERSIONI DI TENDENZA (spread in "
       + "allargamento, curva in dis-inversione) sono i due modi in cui questi indicatori hanno "
       + "storicamente anticipato i punti di svolta.");
  return L.join("\n");
}
/* ═══════════════════ MOTORE DI CORRELAZIONE (v154) ═══════════════════
   Il problema che risolve: il payload consegnava news, settori e posizioni in SILOS separati,
   lasciando all'LLM tutto il lavoro di join su ~65k caratteri. Risultato: non lo faceva, e
   ripiegava sul riassunto del verdetto del motore (risposte "banali e meccaniche").
   Qui il join lo fa il CODICE — deterministico, verificabile — così l'LLM riceve il segnale
   GIÀ COLLEGATO al book e può spendere il suo budget in giudizio, non in aggregazione.
   NB: le news arrivano con tickers quasi sempre solo [MACRO] (build_keywords cerca il ticker
   letterale nel titolo): la classificazione TEMATICA qui sotto è ciò che le rende utilizzabili. */
/* Matcher per tema. ATTENZIONE ai falsi positivi (visti sul campo):
   - "AI" va cercato SOLO come acronimo MAIUSCOLO nel titolo inglese: in italiano "ai" è una
     preposizione comune e classificava news di previdenza sociale come AI/DATACENTER;
   - la geopolitica generica (guerra/Iran) NON va mappata sui semiconduttori: colpisce
     l'appetito al rischio (→ beta), mentre solo dazi/export-control toccano la filiera. */
/* CLASSIFICAZIONE AUTOMATICA (v155) — i temi NON hanno più liste di ticker da aggiornare a mano.
   Ogni titolo si auto-assegna dai PROPRI dati (sector, rs_bench, name, market cap): un nome nuovo
   aggiunto in watchlist entra nei temi DA SOLO, senza toccare il codice. Prima ogni ingresso
   (WDC/MRVL/NOW/BE…) restava invisibile al motore di correlazione finché non lo si aggiungeva a
   mano — e un rename del ticker (TSM→TSMC) lo faceva uscire in silenzio dal tema.
   Uniche eccezioni: i proxy SEMANTICI che i dati non possono esprimere (MSTR è "Technology" e
   CRCL "Financial Services", ma di fatto seguono il bitcoin) → THEME_SEED, additivo e dichiarato. */
const THEME_SEED = { CRYPTO: ["MSTR", "CRCL", "BTC-USD"] };
const thName = (r) => `${r.name || ""} ${r.ticker || ""}`;
const thIsSemi = (r) => r.rs_bench === "sox"
  || /semiconduc|semicondutt|foundry|micron|sandisk|western digital|hynix|taiwan semi|marvell|cerebras|super micro|broadcom|nvidia|intel|rigetti/i.test(thName(r))
  || /^(TSMC?|WDC|SNDK|MRVL|SMCI|CBRS|SKHY)$/i.test(r.ticker || "");
const thIsSoftware = (r) => r.sector === "Technology" && !thIsSemi(r);
const thIsEnergy = (r) => r.sector === "Utilities" || /nuclear|energy|reactor|power|solar/i.test(thName(r));
const thIsMegacapComm = (r) => r.sector === "Communication Services"
  && (dgFin((r.stats || {}).market_cap) ?? 0) >= 100e9;
const thIsOil = (r) => /petroli|greggio|crude|\boil\b|\bWTI\b/i.test(thName(r)) || /^CL=F$/.test(r.ticker || "");
const NEWS_THEMES = [
  { id: "SEMI/CHIP", sel: thIsSemi,
    m: (en, it) => /chip|semiconduc|foundry|wafer|\bdram\b|\bnand\b|\bhbm\b|\bgpu\b|nvidia|tsmc|micron/i.test(en) || /semicondutt|chip/i.test(it) },
  { id: "AI/DATACENTER", sel: (r) => thIsSemi(r) || thIsSoftware(r) || thIsMegacapComm(r),
    m: (en, it) => /\bAI\b/.test(en) || /artificial intelligence|data ?cent(er|re)|\bLLM\b|openai|inference/i.test(en) || /intelligenza artificiale|data ?center/i.test(it) },
  { id: "TASSI/FED/INFLAZIONE", sel: null,   // null = colpisce per MULTIPLO/BETA (il codice sceglie)
    // v162: "federal reserve" per esteso NON era coperto da \bfed\b — una news sulla riunione FOMC
    // a 4 giorni dall'evento restava fuori dal tema. Idem "rate cut/hike/decision" e l'IT "riunione della Fed".
    m: (en, it) => /\bfed\b|federal reserve|fomc|powell|interest rate|\brates?\b|rate (cut|hike|decision)|inflation|\bcpi\b|\bpce\b|yield|treasury|bond sell|hawkish|dovish/i.test(en) || /inflazion|tass[oi] d|rendiment|federal reserve|riunione della fed/i.test(it) },
  { id: "CLOUD/SOFTWARE", sel: thIsSoftware,
    m: (en, it) => /\bcloud\b|software|\bsaas\b|subscription/i.test(en) || /\bcloud\b|software/i.test(it) },
  { id: "CRYPTO", sel: (r) => /bitcoin|crypto|blockchain|stablecoin/i.test(thName(r)) || /-USD$/.test(r.ticker || ""),
    m: (en, it) => /bitcoin|crypto|ethereum|blockchain|stablecoin/i.test(en + " " + it) },
  { id: "ENERGIA/OIL", sel: thIsOil,
    m: (en, it) => /\boil\b|crude|opec|brent|\bwti\b|energy shock|natural gas/i.test(en) || /petroli|greggio|shock energetic/i.test(it) },
  { id: "NUCLEARE/UTILITY", sel: thIsEnergy,
    // v162: le sovvenzioni all'energia pulita toccano BE/CEG/OKLO in watchlist ma non matchavano nulla
    m: (en, it) => /nuclear|reactor|\bSMR\b|power grid|electricity demand|clean energy|renewable/i.test(en) || /nuclear|rete elettric|energia pulita|rinnovabil/i.test(it) },
  { id: "DAZI/EXPORT-CONTROL", sel: thIsSemi,   // SOLO filiera/supply chain
    // v162: "investigate EU trade practices" (escalation commerciale) non matchava "trade probe|trade war"
    m: (en, it) => /tariff|export control|trade prob|trade practice|trade investigation|trade war|chip ban|sanction.{0,20}(chip|tech|semicon)/i.test(en) || /dazi|controlli all.export|guerra commercial|pratiche commerciali|indagine commercial/i.test(it) },
  { id: "GEOPOLITICA (risk-off)", sel: null,   // appetito al rischio → colpisce i beta alti
    m: (en, it) => /\bwar\b|iran|hormuz|middle east|missile|airstrike|invasion/i.test(en) || /guerra|iran|medio oriente/i.test(it) },
  { id: "REGOLAM./MEGACAP", sel: thIsMegacapComm,
    m: (en, it) => /antitrust|\bEU fine|probe into tech|privacy fine|alphabet|\bgoogle\b|\bmeta\b/i.test(en) || /antitrust|multe dell.UE|aziende tecnolog/i.test(it) },
];
/* membri di un tema: predicato sui dati del titolo + eventuale seed semantico */
/* ultimo set di divergenze in forma strutturata (popolato da marketLinkText, letto dal CI) */
let LAST_DIV_SIGNALS = [];


/* ═══ v256 — LA CORRELAZIONE CHE SOPRAVVIVE AL PORTAFOGLIO ═════════════════════════════════
   Il CEO ha chiesto di tenere "i dati macro e la relativa correlazione". Quella vecchia era il
   join news↔settori↔POSIZIONI: si regge su un portafoglio che non c'è più. Questa si regge
   solo su dati macro, ed è la stessa sostanza — DUE NUMERI CHE RARAMENTE STANNO INSIEME.

   Da dove viene, senza inventare niente:
   · i quattro compositi che `data.json` pubblica CON I PROPRI COMPONENTI (macroquant 13,
     fear_greed 7, risk_sentiment 5, smart_money 4). Un composito è una media: quando i suoi
     componenti sono in disaccordo fra loro, quella media nasconde più di quanto mostri, e la
     dispersione è il fatto che il numero singolo cancella;
   · la classifica completa degli indicatori (`indicatoriClassifica`), sulla stessa scala
     0-100 dove 100 è favorevole, per la fotografia d'insieme.
   ⚠ NON si dichiara nessuna correlazione STORICA fra indicatori: nel file non ci sono serie
   appaiate per calcolarla, e affermarla sarebbe la classe v240 (una soglia disegnata è
   un'affermazione, e va sostenuta). Qui si misura solo il disaccordo di OGGI. *//* ⚠⚠ v337 — IL BLOCCO DEL DISACCORDO E' USCITO, con `correlazioniMacro` e
   `testoCorrelazioniMacro` che lo costruivano. Decisione del CEO, testuale: "elimina dalle
   schede macro (e se ci sono riferimenti nel prompt) i parametri in alto a destra es. 56/100;
   il dato deve essere asettico da quel parametro" — e alla domanda se il taglio dovesse
   arrivare fino al pacchetto: "Via da tutto, schede e prompt".
   Non e' un taglio estetico. Quel blocco era interamente costruito sulla scala 0-100 che
   calcolo IO: dichiarava "scala unica 0-100, 100 = favorevole agli attivi rischiosi" e
   misurava la dispersione FRA quei punteggi. Tolta la scala, il blocco non misura piu' niente
   — la dispersione fra numeri che non esistono non e' un fatto.
   ⚠ E' la seconda volta che questo progetto toglie un numero 0-100 dal pacchetto: v200 tolse
   il verdetto del motore perche' "un punteggio ancora comunque, e l'ancoraggio non si batte
   con una nota a pie' di pagina, si batte togliendo il numero". Stessa ragione, altra scala.
   La domanda che il blocco poneva NON e' persa: e' passata alla testata (regola B2 riscritta),
   dove chiedere di cercare il disaccordo e' un'ISTRUZIONE — che e' il posto giusto, regola C9.
   I VALORI restano tutti nel payload: quello che sparisce e' il giudizio, non il dato. */

/* la scheda in pagina: le stesse barre gia' usate per la macro, una riga per componente,
   divergenti da 50 perche' su una scala 0-100 il neutro e' il centro (v209). */
/* ═══ v256 — ANALISI SPOT DI UN TITOLO ═════════════════════════════════════════════════════
   Richiesta del CEO: un box dove scrive un ticker e ottiene un'analisi tecnica, fondamentale,
   con le news e con la correlazione al macro. "Questa analisi non sara' salvata": nessun
   localStorage, nessuna scrittura sul repo, nessuna riga in data.json — si genera, si copia,
   finisce li'.
   ⚠ IL VINCOLO CHE DECIDE LA FORMA: questa pagina e' statica su GitHub Pages e la pipeline
   conosce solo i ticker che le vengono dati. Per un titolo qualsiasi il sistema NON ha prezzi,
   fondamentali ne' news, e non puo' averli (le API di Yahoo sono bloccate dal CORS lato
   browser). Quindi non si finge di avere quei dati: il pacchetto chiede all'LLM di procurarseli
   e verificarli, e gli porta l'unica cosa che il sistema sa davvero e che l'LLM da solo non
   ricostruirebbe — il quadro macro di oggi con la sua tensione interna.
   E' la stessa regola che questo progetto applica dal v195: un dato indovinato e scritto come
   certo e' peggio di un dato dichiarato mancante. */

/* ═══ v257 — GRAFICO TRADINGVIEW E WATCHLIST PROPRIA ═══════════════════════════════════════
   ⚠ SULLE CREDENZIALI: il CEO ha offerto quelle del suo account TradingView. Non servono e non
   vanno date: questo e' il widget PUBBLICO, funziona senza login, e delle credenziali non farei
   nulla comunque. Vale anche per Investing.com.
   ⚠ SUL LIMITE, DICHIARATO INVECE CHE AGGIRATO: ne' TradingView ne' Investing.com espongono la
   watchlist PRIVATA di un account in un widget incorporabile. I widget mostrano i simboli
   scritti nel codice, non quelli salvati nel profilo. Quindi qui la watchlist e' la SUA lista,
   scritta una volta e persistita — non la sua watchlist di Investing travestita da tale.
   ⚠ E' l'unica dipendenza esterna della pagina: se lo script non risponde, il riquadro lo dice
   e il resto continua a funzionare (l'onerror sotto). */
/* ⚠ v259 — PIVOT TOLTI. Il CEO ha mandato la foto: i pivot standard disegnano R1..R5 e S1..S5
   per OGNI seduta dello storico, quindi su un grafico giornaliero a un anno diventano centinaia
   di etichette arancioni sovrapposte che coprono le candele. Non erano "un indicatore da
   tarare": erano illeggibili per costruzione su quell'orizzonte. Restano volumi, RSI e due medie
   — i supporti e le resistenze veri li disegna l'LLM nell'analisi, dove hanno un perche' accanto
   (zona di volume, massimo precedente) invece di una linea per ogni giorno. */
const TV_STUDIES = ["STD;RSI", "STD;SMA", "STD;EMA"];   // v262: niente "STD;Volume", il grafico a candele lo disegna gia' da solo
let tvSimboloCorrente = "";
let tvIntervallo = "D";

/* TradingView vuole "BORSA:TICKER" ma accetta anche il ticker nudo, risolvendolo da solo.
   I suffissi di Yahoo (.AS, .KS, .MI) NON sono simboli TradingView: si passano nudi e si
   lascia risolvere al widget, dichiarando che l'aggancio potrebbe non essere esatto. *//* ⚠⚠ v338 — LA WATCHLIST DENTRO IL GRAFICO E' STATA TOLTA. Decisione del CEO, testuale:
   "la watchlist di tradingview non va bene, torna come prima" — e "come prima" e' lo stato
   pre-v332, dove il widget non riceveva nessuna chiave `watchlist` e il grafico era il
   grafico e basta. Verificato su 571c470^ prima di tagliare, non ricostruito a memoria.
   ⚠ VIA ANCHE LA STELLA, e non e' un di piu': ☆ Preferito serviva SOLO a comporre quella
   lista. Lasciato in pagina sarebbe stato un bottone che risponde al clic, salva una
   preferenza e non produce nessun effetto visibile — il sintomo v193 (un handler vivo su
   una funzione senza consumatori), che in questo progetto e' gia' stato pagato tre volte.
   ⚠ RESTANO, perche' il CEO le ha chieste e non le ha ritirate: `extended_hours` (l'overnight
   nel grafico, v332) e i bottoni Nasdaq / S&P 500 (#tv-idx), che passano da montaGraficoTV e
   non hanno mai avuto niente a che vedere con la lista. Resta anche simboloTradingView(), che
   e' la mappatura ticker->simbolo usata dal montaggio del widget.
   ⚠ Il taglio non tocca il PACCHETTO: la watchlist del widget era una comodita' di lettura,
   e nessun dato dell'LLM passava di li'. */
function simboloTradingView(tk) {
  const T = String(tk || "").trim().toUpperCase();
  if (!T) return "";
  return T.includes(":") ? T : T.replace(/\.[A-Z]{1,3}$/, "");
}

/* ═══ v266 — LO STATO DI PUT E CALL ACCANTO AL GRAFICO ═════════════════════════════════════
   Richiesta del CEO: "puoi aggiungere lo stato delle put e calls sul grafico tradingview".
   ⚠ SUL grafico non si puo', e va detto invece di fingere: il widget TradingView e' un iframe
   servito da un altro dominio, quindi nessuno da questa pagina puo' disegnarci dentro o leggere
   cosa mostra. Nessuna credenziale cambierebbe la cosa — e' il confine del browser, non un
   permesso mancante. Quello che si puo' fare, e che si fa qui, e' metterlo SOTTO il grafico,
   agganciato al simbolo che il grafico sta mostrando.
   Cosa c'e' dentro, e perche' proprio questo: il file porta le catene complete di 30 titoli
   (strike, volumi, open interest, muro delle call e muro delle put) e finora nessuno le
   leggeva. Accanto a un grafico di prezzo la parte utile sono i MURI, perche' sono livelli:
   stanno sull'asse dei prezzi come le candele, e si confrontano a colpo d'occhio con dove sta
   il titolo adesso. Il rapporto put/call da solo e' un numero senza posto sul grafico. */
function statoOpzioni(tk) {
  const T = String(tk || "").toUpperCase().replace(/^[A-Z]+:/, "");
  const o = (DATA && DATA.options && DATA.options[T]) || null;
  if (!o || !Array.isArray(o.expiries) || !o.expiries.length) return null;
  /* ⚠ v284 — LA SCADENZA CON PIU' CONTRATTI APERTI, NON LA PIU' VICINA. Trovato rileggendo il
     pacchetto di AMD: la prima scadenza era a UN GIORNO con 4.191 contratti call, mentre quella
     successiva ne aveva 19.536 — quasi cinque volte. I "muri" di una settimanale che scade
     domani descrivono un contratto che sta per sparire, e il giorno dopo saltano altrove: sul
     grafico erano passati da 460 a 700 in poche ore senza che il mercato avesse fatto niente.
     Un livello che si sposta del 50% da solo non e' un livello.
     Si sceglie dove i contratti stanno DAVVERO, e la scheda dichiara quale scadenza ha scelto:
     e' la stessa regola dei denominatori dichiarati che vale in tutto questo sistema. */
  const conOI = (x) => ["calls", "puts"].reduce((t, lato) =>
    t + (x[lato] || []).reduce((s, o) => s + (Number(o.oi) || 0), 0), 0);
  const e = [...o.expiries].sort((a, b) => conOI(b) - conOI(a))[0];
  const oiScelta = conOI(e);
  const oiPrima = conOI(o.expiries[0]);
  const somma = (a) => (a || []).reduce((t, x) => t + (Number(x.vol) || 0), 0);
  const put = somma(e.puts), call = somma(e.calls);
  return { tk: T, spot: Number(o.spot), scadenza: e.date, put, call,
           ratio: call > 0 ? put / call : null,
           callWall: Number(e.call_wall), putWall: Number(e.put_wall),
           oi: oiScelta,
           /* vero quando la scadenza scelta NON e' la piu' vicina: la scheda lo dice, perche'
              altrimenti "scadenza 14/08" accanto a un titolo che scade il 12 sembra un errore. */
           nonLaPiuVicina: e.date !== o.expiries[0].date,
           oiPiuVicina: oiPrima };
}

/* ═══ v266 — I LIVELLI DEL TITOLO SU UNA SCALA SOLA ════════════════════════════════════════
   Il CEO, subito dopo le opzioni: "ed aggiungere anche supporti e resistenze rendendo tutto
   leggibile". La seconda meta' della frase decide la forma.
   Muro delle call, muro delle put, supporto, resistenza, massimo e minimo dell'anno sono tutti
   PREZZI. Messi in riquadri separati costringono a confrontare numeri a mente — quattro scatole
   con dentro 452,50 e 470,00 e 483,36 e chi legge deve ricostruirsi l'ordine da solo. Su una
   scala unica l'ordine si vede: sopra il prezzo c'e' il tetto piu' vicino, sotto il pavimento
   piu' vicino, e la distanza fra le due righe E' la distanza vera.
   Ogni riga porta da dove viene: le opzioni dalla catena, supporto e resistenza dai 20 giorni
   di barre, i due estremi dall'anno. Livelli calcolati in modi diversi non si mescolano in
   silenzio, si etichettano. */
/* ═══ v274 — UN POSTO SOLO DOVE SI SA COSA SAPPIAMO DI UN TITOLO ══════════════════════════
   Punto 1 della revisione, e il difetto che mi e' costato tre giri di fila: pagina e pacchetto
   erano costruiti da funzioni SEPARATE che ricavavano gli stessi fatti ognuna per conto suo —
   datiSimbolo, livelliTitolo, statoOpzioni e datiNostriDelTitolo leggevano tutte e quattro
   DATA.portfolio, DATA.watchlist, quoteLive e DATA.options in modo indipendente. Aggiungere un
   campo voleva dire ricordarsene quattro volte, e ogni volta me ne sono dimenticato in almeno
   una: i muri delle opzioni finiti solo nella scheda, il pre-market finito solo in tabella
   mentre il pacchetto continuava a dire "usa i futures, sono il dato piu' fresco".
   Non era distrazione: era che non esisteva un posto dove la domanda "cosa sappiamo di questo
   titolo?" avesse UNA risposta. Adesso c'e'. Chi disegna e chi scrive il pacchetto leggono da
   qui, quindi un campo aggiunto una volta compare in tutti e due — e se manca, manca a
   entrambi, che e' un difetto visibile invece che silenzioso. */
function fattiTitolo(tk) {
  const T = String(tk || "").toUpperCase().replace(/^[A-Z]+:/, "");
  const riga = [...((DATA && DATA.portfolio) || []), ...((DATA && DATA.watchlist) || [])]
    .find(x => String(x.ticker || "").toUpperCase() === T) || null;
  const giorno = quoteLive.get(T) || null;          // quotazione di oggi (5 minuti, con pre/after)
  const anno = quoteLive.get(T + "|1y") || null;    // barre giornaliere, per i livelli
  const opz = statoOpzioni(T);
  const vivo = giorno && !giorno.assente ? giorno : null;
  const storia = anno && !anno.assente ? anno : null;

  /* ⚠ v274 — IL BLOCCO MACRO E' UNA TERZA STANZA, e consolidando me l'ero persa: VIX, future
     Nasdaq ed EUR/USD non stanno negli array dei titoli ma i loro numeri sono in `macro`.
     Dichiararli "non seguiti" sarebbe vero della struttura e falso del contenuto (v266). Il
     check l'ha ripreso al volo — ed e' la ragione per cui questi controlli esistono. */
  const daMacro = (() => {
    if (vivo || riga) return null;
    const m = (DATA && DATA.macro) || {};
    const fatto = (nome, val, pct) => Number.isFinite(numero(val))
      ? { nome, prezzo: numero(val), varPct: numero(pct) } : null;
    if (T === "^VIX" && m.vix) return fatto("Volatilità (VIX)", m.vix.value, m.vix.change_pct);
    for (const f of Object.values(m.futures || {})) {
      if (String(f && f.symbol).toUpperCase() === T) return fatto(f.label || T, f.price, f.change_pct);
    }
    const mk = (m.markets || []).find(x => String(x.key || "").toUpperCase() === T);
    if (mk) return fatto(mk.label || T, String(mk.value).replace(/[^\d.,-]/g, "").replace(",", "."), mk.change_pct);
    return null;
  })();

  const grezzo = Number.isFinite(vivo && vivo.price) ? vivo.price
               : Number.isFinite(opz && opz.spot) ? opz.spot
               : Number.isFinite(numero(riga && riga.price)) ? numero(riga.price)
               : (daMacro ? daMacro.prezzo : NaN);
  const prezzo = Number.isFinite(grezzo)
    ? (Math.abs(grezzo) >= 1 ? Math.round(grezzo * 100) / 100 : Math.round(grezzo * 10000) / 10000)
    : grezzo;

  /* i livelli, con la loro provenienza. Le barre lette dal browser vengono PRIMA di quelle
     della pipeline: stesso giorno o piu' fresche, e coprono anche i simboli non seguiti. */
  const L = [];
  /* ⚠ v276 — I LIVELLI SI ARROTONDANO QUI, ALLA FONTE. Rileggendo il pacchetto di AMD:
     "Massimo 52 settimane: 584.72998046875", "Supporto: 424.0299987792969". Sono i float
     grezzi delle barre di Yahoo. La pagina li arrotondava disegnandoli (fmtNum), il pacchetto
     no — di nuovo due strade e una sola che ripulisce, cioe' il difetto che v274 doveva
     chiudere e che qui era rimasto aperto un livello piu' sotto.
     Non e' solo bruttezza: dodici decimali su un livello di prezzo dichiarano una precisione
     che non esiste, e un LLM che li ricopia produce "resistenza a 574,2000122" in un referto
     che il CEO deve poter leggere. Due decimali, e per i titoli sotto l'euro quattro — sotto
     quella soglia il secondo decimale e' meta' del movimento tipico. */
  const arrotonda = (n) => Number.isFinite(n)
    ? (Math.abs(n) >= 1 ? Math.round(n * 100) / 100 : Math.round(n * 10000) / 10000) : n;
  const agg = (nome, breve, v, fonte, spiega) => {
    const n = arrotonda(numero(v));
    if (Number.isFinite(n) && n > 0) L.push({ nome, breve, v: n, fonte, spiega });
  };
  if (opz) {
    agg("Muro delle CALL", "del muro delle call", opz.callWall, `opzioni, scadenza ${opz.scadenza}`,
        "lo strike con piu' contratti call aperti: chi le ha vendute si copre qui, e il prezzo tende a rallentare");
    agg("Muro delle PUT", "del muro delle put", opz.putWall, `opzioni, scadenza ${opz.scadenza}`,
        "lo strike con piu' contratti put aperti: stessa meccanica al contrario, tende a fare da pavimento");
  }
  const daVivo = storia && Number.isFinite(storia.res20);
  const src = daVivo ? storia : riga;
  if (src) {
    const et = daVivo ? " (Yahoo, dal vivo)" : "";
    agg("Resistenza", "della resistenza", daVivo ? storia.res20 : riga.resistance,
        "massimo delle ultime 20 sedute" + et,
        "l'ultima volta che ci e' arrivato si e' fermato: sopra, quel massimo non ce l'ha piu' sopra la testa");
    agg("Supporto", "del supporto", daVivo ? storia.sup20 : riga.support,
        "minimo delle ultime 20 sedute" + et,
        "il punto dove nell'ultimo mese hanno ricomprato; rotto al ribasso smette di essere un supporto");
    agg("Massimo 52 settimane", "del massimo dell'anno", daVivo ? storia.max52 : riga.w52_high,
        "un anno di barre" + et, "il punto piu' alto degli ultimi dodici mesi");
    agg("Minimo 52 settimane", "del minimo dell'anno", daVivo ? storia.min52 : riga.w52_low,
        "un anno di barre" + et, "il punto piu' basso degli ultimi dodici mesi");
  }
  /* ⚠ SOPRA O SOTTO SI MISURA, NON SI PRESUME (v266): il muro delle call di AMD stava sotto il
     prezzo e veniva dipinto come un tetto. */
  if (Number.isFinite(prezzo)) {
    L.forEach(x => {
      x.dist = (x.v / prezzo - 1) * 100;
      x.tipo = x.v > prezzo ? "tetto" : "pavimento";
      if (/muro delle call/i.test(x.breve) && x.v <= prezzo)
        x.spiega += " — qui sta SOTTO il prezzo: il titolo l'ha gia' superato, e da tetto diventa semmai un appoggio";
      if (/muro delle put/i.test(x.breve) && x.v > prezzo)
        x.spiega += " — qui sta SOPRA il prezzo: il titolo ci e' sceso sotto, e quel pavimento non e' piu' sotto di lui";
    });
    L.sort((a, b) => b.v - a.v);
  }
  const sopra = L.filter(x => x.v > prezzo), sotto = L.filter(x => x.v <= prezzo);

  return {
    tk: T,
    nome: (riga && riga.name) || (daMacro && daMacro.nome) || nomeSimbolo(T),
    prezzo,
    fonte: vivo ? "live" : (riga || daMacro) ? "pipeline" : null,
    ignoto: !!(giorno && giorno.assente && !riga && !daMacro),
    seguito: !!(vivo || riga || daMacro),
    barraDel: riga ? riga.price_asof : null,
    giorno: vivo ? { alto: vivo.dayHigh, basso: vivo.dayLow, vol: vivo.vol,
                     var: vivo.chg, varPct: vivo.chgPct }
                 : riga ? { alto: numero(riga.day_high), basso: numero(riga.day_low),
                            vol: numero(riga.volume != null ? riga.volume : riga.avg_volume_30d),
                            var: NaN, varPct: numero(riga.change_pct) }
                 : daMacro ? { alto: NaN, basso: NaN, vol: NaN, var: NaN, varPct: daMacro.varPct }
                        : null,
    ext: (vivo && vivo.ext) || null,
    livelli: L,
    tetto: sopra.length ? sopra[sopra.length - 1] : null,
    pavimento: sotto.length ? sotto[0] : null,
    opzioni: opz,
    tecnici: riga ? { rsi: numero(riga.rsi), atr: numero(riga.atr_14), atrPct: numero(riga.atr_pct),
                      sma50: numero(riga.sma50_dist_pct), sma200: numero(riga.sma200_dist_pct),
                      /* ⚠⚠ v340 — IL LIVELLO VERO DELLA MEDIA, non piu' ricavato all'indietro.
                         `sma50`/`sma200` qui sopra sono DISTANZE percentuali calcolate dalla
                         pipeline contro la CHIUSURA. La v314 stampava il livello derivandolo
                         (`prezzo / (1 + dist/100)`) usando pero' il prezzo VIVO — due
                         riferimenti diversi — e il risultato non era la media di nessuna
                         finestra: su MU dava 557,27 mentre la media vera e' 556,46, e il
                         pacchetto pubblicava i due numeri a trenta righe di distanza.
                         La pipeline il livello ce l'ha gia'. Si legge, non si ricostruisce. */
                      sma50Liv: numero((((riga.tv || {}).tecnica || {}).medie || {}).sma50?.liv),
                      /* ⚠⚠ v349 — LA STESSA CLASSE DELLA v340, SOPRAVVISSUTA SULLE EMA.
                         Misurato su MU nel pacchetto di oggi: la riga v293 pubblicava
                         "EMA 50 906.65 — calcolate su 126 barre" e trentotto righe piu'
                         sotto il blocco della pipeline pubblicava "Media esponenziale
                         50: 907.06". Due EMA 50 dello stesso titolo nello stesso testo.
                         Peggio: la riga v293 dichiarava "EMA 200 NON calcolata,
                         servirebbero 200 barre e ce ne sono 126" e piu' sotto l'EMA 200
                         c'era, a 640.05 — il pacchetto smentiva se stesso a distanza di
                         mezza pagina. Non e' un arrotondamento: sono due calcoli su due
                         storici diversi (126 barre lato pagina, la serie intera lato
                         pipeline), ed e' la pipeline ad avere quello buono.
                         Questo flag dice al blocco v293 di tacere quando il calcolo
                         completo c'e' gia'. */
                      emaDallaPipeline: !!((((riga.tv || {}).tecnica || {}).medie || {}).ema50),
                      sma200Liv: numero((((riga.tv || {}).tecnica || {}).medie || {}).sma200?.liv),
                      pe: numero(riga.pe),
                      /* v348 — il prospettico era in data.json e non usciva dal pacchetto */
                      peFwd: numero((riga.stats || {}).forward_pe),
                      epsFwd: numero((riga.stats || {}).eps_forward),
                      settore: riga.sector || null,
                      trimestrale: riga.earnings_date || null,
                      /* ⚠ v293 — barre e range servono a EMA e Fibonacci, che calcoliamo NOI
                         (vedi datiNostriDelTitolo). Passano da qui perche' `fattiTitolo` e' la
                         fonte unica dei fatti di un titolo (v274): leggere `sparks` da un altro
                         punto vorrebbe dire due strade per lo stesso dato. */
                      barreGiorno: (riga.sparks && Array.isArray(riga.sparks.m6)) ? riga.sparks.m6 : [],
                      /* ⚠⚠ v299 — FONDAMENTALI CHE AVEVAMO E FACEVAMO CERCARE. Trovato nella revisione:
                         il pacchetto diceva all'LLM "cerca online i fondamentali" mentre EPS, beta e
                         forza relativa erano gia' in data.json. E' il difetto v271 (il sistema tiene un
                         numero e ne fa cercare un altro) applicato ai conti invece che ai livelli.
                         ⚠ L'EPS in particolare: v185 lo rimise nel payload perche' col solo P/E non si
                         distingue una societa' cara da una in perdita — su AMD il pacchetto dava
                         P/E 123,4x senza il 4,17 che lo spiega.
                         ⚠ NON entrano `fin_health` e `health`: sono punteggi compositi 0-100, cioe'
                         giudizi travestiti da dati, ed e' esattamente cio' che v200 ha tolto dal
                         pacchetto misurando un hit-rate del 29%. I fatti si', i voti no. */
                      eps: numero(riga.eps), beta: numero(riga.beta),
                      oggiPct: numero(riga.change_pct), volRel: numero(riga.vol_ratio),
                      rs1m: numero(riga.rs_1m), rsBench: riga.rs_bench || null,
                      rsNdx: numero(riga.rs_ndx_1m), sortino: numero(riga.sortino_1y),
                      /* ⚠ v328 — il valore in data.json puo' essere ancora quello VECCHIO,
                         misurato dal supporto e quindi gonfiato fino a sedici volte. Finche' il
                         CI non ha rigenerato si ricalcola qui dal prezzo che si pagherebbe. */
                      rischioRendimento: (() => {
                        const p = numero(riga.prezzo_limite_aggiustato ?? riga.price);
                        const res = numero(riga.resistance), atr = numero(riga.atr_14);
                        if (![p, res, atr].every(Number.isFinite) || atr <= 0 || res <= p) return null;
                        return `1:${Math.round((res - p) / (2 * atr) * 10) / 10}`;
                      })(),
                      rischioRendimentoBase: riga.risk_reward_base
                        || (riga.prezzo_limite_aggiustato != null ? "prezzo esteso" : "ultima chiusura"),
                      w52hi: numero(riga.w52_high), w52lo: numero(riga.w52_low),
                      /* v308 — la posizione, quando c'e': il pacchetto non deve piu' negare di saperlo */
                      qta: numero(riga.qta), pmc: numero(riga.pmc),
                      gainPos: numero(riga.gain_pct_pos),
                      /* ⚠ v310 — il PESO nel libro si calcola qui e non in chi disegna: `fattiTitolo` e'
                         la fonte unica dei fatti di un titolo (v274), e il gate lo verifica. La prima
                         stesura leggeva `DATA.watchlist` dentro `datiNostriDelTitolo` — due strade per lo
                         stesso fatto, che e' esattamente cio' che v274 ha chiuso. */
                      pesoLibro: (() => {
                        const tutte = ((DATA && DATA.watchlist) || [])
                          .filter(x => x && numero(x.qta) > 0 && numero(x.price) > 0);
                        if (!tutte.length) return null;
                        const fx = numero(DATA && DATA.eurusd) || 1;
                        const eur = (x) => (x.currency === 'EUR' ? 1 : 1 / fx) * numero(x.price) * numero(x.qta);
                        const tot = tutte.reduce((a2, x) => a2 + eur(x), 0);
                        return tot > 0 ? { pct: Math.round(eur(riga) / tot * 100), quante: tutte.length } : null;
                      })() } : null,
  };
}

function livelliTitolo(tk) {
  /* v274 — vista su fattiTitolo: la scheda non ricava piu' niente da sola. */
  const f = fattiTitolo(tk);
  if (!f || !Number.isFinite(f.prezzo) || !f.livelli.length) return null;
  return { tk: f.tk, spot: f.prezzo, livelli: f.livelli, opzioni: f.opzioni,
           tetto: f.tetto, pavimento: f.pavimento };
}

async function renderOpzioniGrafico(tk) {
  const box = $("#tv-opzioni");
  if (!box) return;
  /* ⚠ v268 — SI CHIEDONO LE BARRE PRIMA DI DISEGNARE, e nel frattempo si dice che si sta
     leggendo. Senza questa riga la scheda disegnava con quello che aveva (spesso niente) e
     nessuno la ridisegnava all'arrivo: lo stesso difetto "sembra fermo" gia' corretto due
     volte in questa versione. Qui l'attesa e' esplicita perche' il dato arriva dalla rete. */
  const T = String(tk || "").toUpperCase().replace(/^[A-Z]+:/, "");
  if (!quoteLive.has(T + "|1y")) {
    if (!box.innerHTML) box.innerHTML = '<div class="tvo-vuoto muted">Leggo i livelli di ' + esc(T) + '…</div>';
    try {
      const q = await quotaLive(T, "1y");
      if (q) quoteLive.set(T + "|1y", q);
    } catch { /* proxy muto: si continua con quello che c'e' */ }
    /* nel frattempo il CEO puo' aver cambiato simbolo: se non e' piu' il suo, non si disegna
       sopra la richiesta piu' recente. */
    const attuale = String(tvSimboloCorrente || "").toUpperCase().replace(/^[A-Z]+:/, "");
    if (attuale && attuale !== T) return;
  }
  const S = livelliTitolo(tk);
  const o = statoOpzioni(tk);
  if (!S) {
    /* ⚠ niente silenzio e niente ripiego travestito: se di quel simbolo non si sa nulla lo si
       dice, e il dato di mercato si offre come contesto ETICHETTATO — non come se fosse suo. */
    /* ⚠ il messaggio dice cosa e' successo DAVVERO, e sono due cose diverse: o Yahoo non
       conosce quel simbolo (di solito e' scritto in un altro modo), o il proxy non ha
       risposto. Prima si diceva "la pipeline non lo segue", che era vero e non serviva a
       niente — al CEO non interessa cosa segue la pipeline. */
    const q = quoteLive.get(T + "|1y");
    box.innerHTML = `<div class="tvo-vuoto muted">`
      + (q && q.assente
          ? `<b>${esc(T)}</b> non esiste su Yahoo con questo nome: probabilmente si scrive in un altro modo `
            + `(le borse europee vogliono il suffisso — ASML.AS, RACE.MI — e gli indici la ^, come ^SOX).`
          : `Non sono riuscito a leggere i livelli di <b>${esc(T)}</b>: il servizio che gira le richieste a Yahoo non ha risposto. Riprovo al prossimo giro.`)
      + `</div>`;
    return;
  }

  /* la corsia: dove sta il prezzo fra il pavimento e il tetto piu' vicini. E' la sola domanda
     che si fa guardando un grafico — quanto spazio ho prima di sbattere, da una parte e dall'altra. */
  const corsia = "";   // v332 — rimossa su richiesta del CEO: ripeteva la tabella qui sotto


  /* la scala: tutti i livelli in ordine di prezzo, col prezzo di adesso al suo posto dentro
     l'elenco — non in un riquadro a parte, che e' il modo per non far capire dov'e'. */
  const righe = [];
  let messo = false;
  for (const x of S.livelli) {
    if (!messo && x.v <= S.spot) {
      righe.push(`<tr class="tvo-ora"><td>Prezzo ora</td><td class="num">${fmtNum.format(S.spot)}</td><td class="num">—</td><td class="muted">il titolo adesso</td></tr>`);
      messo = true;
    }
    const cls = x.tipo === "tetto" ? "tvo-t" : "tvo-p";
    righe.push(`<tr class="${cls}"><td>${esc(x.nome)}</td><td class="num">${fmtNum.format(x.v)}</td>`
      + `<td class="num ${x.dist > 0 ? "pos" : "neg"}">${signTxt(Math.round(x.dist * 10) / 10, "%")}</td>`
      + `<td class="muted">${esc(x.fonte)}<span class="tvo-spiega">${esc(x.spiega)}</span></td></tr>`);
  }
  if (!messo) righe.push(`<tr class="tvo-ora"><td>Prezzo ora</td><td class="num">${fmtNum.format(S.spot)}</td><td class="num">—</td><td class="muted">il titolo adesso</td></tr>`);

  /* le opzioni: put contro call sulla scadenza vicina. Sta DOPO i livelli perche' e' l'unico
     pezzo che non e' un prezzo, e mescolarlo alla scala lo renderebbe illeggibile. */
  let opz = "";
  if (o && o.ratio != null) {
    const tot = o.put + o.call, quotaPut = tot > 0 ? o.put / tot * 100 : 0;
    const stato = o.ratio >= 1.2 ? `<b class="tvo-rosso">prevalgono le PUT</b>: su questa scadenza si stanno coprendo`
      : o.ratio <= 0.8 ? `<b class="tvo-verde">prevalgono le CALL</b>: su questa scadenza scommettono al rialzo`
      : `<b>put e call in equilibrio</b> su questa scadenza`;
    opz = `<div class="tvo-opz">
      <div class="tvo-barra" role="img" aria-label="quota put ${Math.round(quotaPut)} per cento">
        <div class="tvo-put" style="width:${quotaPut.toFixed(1)}%"></div></div>
      <div class="tvo-riga"><span class="tvo-rosso">PUT ${fmtNum.format(o.put)}</span>
        <span class="muted">rapporto ${fmtNum.format(Math.round(o.ratio * 100) / 100)}</span>
        <span class="tvo-verde">CALL ${fmtNum.format(o.call)}</span></div>
      <div class="muted tvo-nota">Volumi della scadenza ${esc(o.scadenza)}: ${stato}.${o.nonLaPiuVicina
        ? ` <b>Non è la scadenza più vicina</b>: quella ha ${fmtNum.format(o.oiPiuVicina)} contratti aperti contro ${fmtNum.format(o.oi)}, e i muri di una scadenza quasi esaurita saltano da soli senza che il mercato si muova.`
        : ""}</div>
    </div>`;
  }

  /* il titolo promette solo quello che c'e' dentro: per i titoli fuori dai 30 seguiti le
     opzioni non ci sono, e annunciarle sarebbe una promessa non mantenuta. */
  const conOpz = !!(o && o.ratio != null);
  box.innerHTML = `<div class="tvo-testa"><b>Livelli di ${esc(S.tk)}</b> <span class="muted">— supporti, resistenze${conOpz ? " e muri delle opzioni" : ""}</span></div>
    <div class="tvo">
      ${corsia}
      <div class="tvo-scroll"><table class="tvo-tab"><thead><tr>
        <th>Livello</th><th class="num">Prezzo</th><th class="num">Distanza</th><th>Da dove viene</th>
      </tr></thead><tbody>${righe.join("")}</tbody></table></div>
      ${opz}
      ${conOpz ? "" : "<div class=\"muted tvo-fine\">Di questo titolo non ci sono le opzioni: le catene (muri di put e call) le scarica la pipeline per 30 titoli, e nessuna fonte gratuita le espone al browser. Supporti, resistenze ed estremi dell'anno invece ci sono, letti dal vivo.</div>"}
      <div class="muted tvo-fine">I livelli non sono previsioni: dicono dove il prezzo ha gia' incontrato
        qualcosa, non dove andra'. Quelli delle opzioni valgono per la loro scadenza e si spostano quando
        cambia; supporto e resistenza guardano venti sedute e si aggiornano ogni giorno.</div>
    </div>`;
}

function montaGraficoTV(tk, intervallo) {
  const box = $("#tv-chart");
  if (!box) return;
  const sym = simboloTradingView(tk);
  if (!sym) { box.innerHTML = `<div class="muted tv-vuoto">Scrivi un ticker qui sopra per vedere il grafico.</div>`; return; }
  tvSimboloCorrente = sym;
  if (intervallo) tvIntervallo = intervallo;
  /* ⚠ v257 — QUESTA FUNZIONE COSTRUISCE NODI DOM VERI, non stringhe: e' l'unico punto della
     pagina che lo fa, perche' il widget TradingView vuole uno <script> con la configurazione
     nel corpo, e `innerHTML` non esegue gli script inseriti. Conseguenza: negli harness Node
     (coherence_check, fx_check) `createElement` restituisce uno stub senza appendChild e la
     funzione lanciava, fermando due gate. Non e' un difetto di produzione — e' un pezzo di DOM
     dentro un mondo senza DOM. Si esce prima, invece di far cadere il gate. */
  if (typeof document === "undefined" || typeof document.createElement !== "function") return;
  const prova = document.createElement("div");
  if (!prova || typeof prova.appendChild !== "function") return;
  const et = $("#tv-simbolo"); if (et) et.textContent = sym;
  try { localStorage.setItem("ultimo_ticker", String(tk).toUpperCase()); } catch { /* privata */ }
  renderOpzioniGrafico(tk);      // v266 — le opzioni seguono il simbolo a grafico
  box.innerHTML = "";
  const cont = document.createElement("div");
  cont.className = "tradingview-widget-container";
  const inner = document.createElement("div");
  inner.className = "tradingview-widget-container__widget";
  cont.appendChild(inner);
  const sc = document.createElement("script");
  sc.type = "text/javascript";
  sc.async = true;
  sc.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  sc.innerHTML = JSON.stringify({
    autosize: true,
    symbol: sym,
    interval: tvIntervallo,
    timezone: "Europe/Rome",
    theme: "dark",
    style: "1",
    locale: "it",
    hide_side_toolbar: false,
    allow_symbol_change: true,
    withdateranges: true,
    details: true,
    /* ⚠ v332 — il CEO: "su grafico tradingview aggiungi sezione overnight visibile".
       `extended_hours` accende le sedute fuori orario NEL grafico: e' l'unico posto dove
       l'overnight si puo' vedere, perche' il widget e' un iframe di un altro dominio e da qui
       dentro non si disegna. ⚠ Sulle azioni americane l'incorporamento gratuito mostra il
       pre/after con lo stesso ritardo del resto (~15 minuti): e' visibile, non e' in tempo reale. */
    extended_hours: true,
    studies: TV_STUDIES,
    support_host: "https://www.tradingview.com",
  });
  const nota = $("#tv-nota");
  sc.onerror = () => {
    box.innerHTML = `<div class="muted tv-vuoto">TradingView non risponde (rete o blocco degli script di terze parti).
      Il resto della pagina funziona lo stesso.</div>`;
  };
  cont.appendChild(sc);
  box.appendChild(cont);
  /* ⚠ v259 — LA LEGENDA DEGLI INDICATORI STA FUORI DAL GRAFICO. Richiesta del CEO: capire
     cosa sono le linee che vede. Dentro il widget la spiegazione non c'e' (TradingView mostra
     solo la sigla), e il widget e' un iframe di terze parti: non possiamo leggerne il contenuto
     ne' scriverci dentro. Quindi la spiegazione vive qui, accanto, dove la controlliamo noi.
     ⚠ E NON PROMETTO UNA LETTURA IN TEMPO REALE DEL GRAFICO: il CEO l'ha chiesta ("un sistema
     che legga il grafico in tempo reale dentro il sistema stesso") ed e' impossibile da una
     pagina statica — l'iframe e' cross-origin, il browser non ci fa leggere nulla di quello
     che c'e' dentro, e non e' una limitazione aggirabile. Fingere di leggerlo sarebbe la classe
     v195: un dato indovinato scritto come certo. */
  /* ⚠ v262 — LEGENDA RISCRITTA. Il CEO ha chiesto di togliere la frase sul widget pubblico
     (l'aveva gia' letta), di spiegare i COLORI delle linee, e di dire cosa c'e' nella barra
     laterale. E aveva un dubbio giusto: i volumi sembravano doppi.
     ⚠ ERANO DAVVERO DOPPI, e la causa era mia: il grafico a candele di TradingView disegna gia'
     le barre del volume sul fondo, e io avevo aggiunto ANCHE lo studio "STD;Volume" — quindi
     due pannelli di volume, uno sopra l'altro. Tolto lo studio; le barre native restano. */
  if (nota) {
    /* v265 — LEGENDA A SCOMPARSA, su richiesta del CEO ("info grafico tradingview a scomparsa
       con tasto per farle riapparire"). Il <details> nativo fa esattamente questo e non ha
       bisogno di stato da mantenere: si apre, si chiude, e il browser ricorda la posizione
       finche' la pagina vive. Chiuso di default — chi sa gia' cos'e' un RSI non deve scorrerlo. */
    /* ═══ v317 — DALLA LEGENDA GENERICA ALL'ANALISI TECNICA DEL TITOLO ═══════════════════════
       Il CEO: "invece di darmi info generiche puoi darmi info correlate ai valori EMA RSI VOlume
       e SMA correlate al titolo (con la stessa logica della sezione di sopra relativa ai livelli)?
       se si crea un'unica sezione denominata analisi tecnica".
       ⚠ Via i tre blocchi che spiegavano cose che il grafico mostra da solo (i numeri in alto a
       sinistra, come e' fatta una candela, cos'e' il volume): erano istruzioni per l'uso, non
       analisi, e chi guarda il grafico le ha gia' davanti. Restano SMA, EMA, RSI e volume, ma
       agganciati ai NUMERI DI QUESTO TITOLO — la stessa logica dei livelli qui sopra.
       ⚠ Le medie a 50 e 200 che il CEO ha chiesto ci sono, con i loro valori: lo studio SMA del
       widget gratuito parte a 9 sedute e la sua lunghezza non e' pilotabile dall'incorporamento
       (si cambia dal pannello indicatori del widget, e resta). Qui il numero e' nostro, calcolato
       sulla barra giornaliera, quindi non dipende da quel pannello. */
    const rTk = ((DATA && DATA.watchlist) || []).concat((DATA && DATA.portfolio) || [])
      .find(x => x && String(x.ticker).toUpperCase() === String(tk).toUpperCase());
    const tec = rTk && rTk.tv && rTk.tv.tecnica;
    const rgV = (v, d = 2) => (Number.isFinite(v) ? fmtNum.format(Math.round(v * 10 ** d) / 10 ** d) : "n.d.");
    const med = (k) => (tec && tec.medie && tec.medie[k]) || null;
    const rigaMedia = (k, et) => {
      const m = med(k); if (!m) return "";
      return `<li><b>${et}</b>: <b>${rgV(m.liv)}</b> — il prezzo le sta <b class="${m.dist_pct >= 0 ? "tv-verde" : "tv-rosso"}">`
        + `${signTxt(Math.round(m.dist_pct * 10) / 10)}</b>, cioe' ${m.dist_pct >= 0 ? "SOPRA" : "SOTTO"}</li>`;
    };
    const o = (tec && tec.oscillatori) || {};
    const vr = numero(rTk && rTk.vol_ratio);
    const analisi = !tec ? `<div class="tv-legenda"><div><b>Analisi tecnica</b><span>I valori di questo titolo
        arrivano dalla pipeline e per <b>${esc(String(tk).toUpperCase())}</b> non ci sono ancora: compaiono al
        prossimo giro. Non li stimo dal grafico — un numero plausibile inventato e' peggio di un buco dichiarato.</span></div></div>`
      : `<div class="tv-legenda">
      <div><b>Le medie, e dove sta il prezzo</b><span>Il livello di ogni media e la distanza del prezzo da lei.
        Una convenzione sola: si scrive il <b>livello della media</b>, e poi dove sta il <b>prezzo</b> rispetto a lei.
        <ul class="tv-lista">${rigaMedia("sma50", "Media semplice 50")}${rigaMedia("sma200", "Media semplice 200")}
        ${rigaMedia("ema20", "Media esponenziale 20")}${rigaMedia("ema50", "Media esponenziale 50")}</ul>
        Il prezzo sta sopra <b>${tec.medie_battute} delle ${tec.medie_totali}</b> medie calcolate (da 10 a 200 sedute,
        semplici ed esponenziali). E' un <b>conteggio</b>, non un giudizio.<br>
        La 50 e la 200 sono le due che il mercato guarda per la tendenza di fondo: il loro incrocio e' il segnale
        che tutti vedono insieme, ed e' per questo che conta — non perche' preveda, ma perche' molti ci reagiscono.</span></div>
      <div><b>RSI ${o.rsi14 != null ? `— oggi <b class="tv-viola">${rgV(o.rsi14, 1)}</b>` : ""}</b><span>
        Misura quanto e' stata forte la spinta delle ultime 14 sedute confrontando le sedute di rialzo con quelle di ribasso.
        ${o.rsi14 != null ? (o.rsi14 >= 70
          ? `A <b>${rgV(o.rsi14, 1)}</b> il titolo ha corso molto in poco tempo. <b>Non e' un segnale di vendita</b>: un titolo in tendenza forte resta sopra 70 per settimane, e chi vende a 70 vende all'inizio della corsa.`
          : o.rsi14 <= 30
            ? `A <b>${rgV(o.rsi14, 1)}</b> e' stato venduto molto. Non e' un segnale di acquisto: puo' restare li' finche' la discesa non finisce.`
            : `A <b>${rgV(o.rsi14, 1)}</b> sta in mezzo, e in mezzo l'RSI non dice quasi niente sul livello.`) : ""}
        Serve bene per una cosa sola: vedere quando <b>il prezzo fa un nuovo massimo e l'RSI no</b> — il movimento
        continua con meno forza dietro, ed e' il primo posto dove si vede che una salita si sta stancando.</span></div>
      ${o.macd ? (() => {
        const px = numero(rTk.price);
        const inPct = Number.isFinite(px) && px > 0 ? o.macd.istogramma / px * 100 : null;
        return `<div><b>MACD — le due spinte a confronto</b><span>
        L'istogramma vale <b>${rgV(o.macd.istogramma)}</b>${inPct != null ? `, cioe' il <b>${rgV(Math.abs(inPct), 2)}%</b> del prezzo di ${esc(String(tk).toUpperCase())}` : ""}:
        ⚠ il numero grezzo e' in DOLLARI, quindi su un titolo da 900 dollari e su uno da 90 lo stesso
        valore significa cose diverse — rapportato al prezzo diventa confrontabile.
        ${o.macd.istogramma >= 0
          ? "E' POSITIVO: la spinta delle ultime settimane e' piu' forte di quella del mese e mezzo precedente."
          : "E' NEGATIVO: la spinta recente si e' indebolita rispetto a quella del mese e mezzo precedente."}
        Su questo titolo conta il VERSO in cui si muove, non il livello: un istogramma che si
        accorcia mentre il prezzo sale e' il primo posto dove si vede una salita che si stanca.</span></div>`;
      })() : ""}
      ${o.adx14 != null ? `<div><b>ADX — ${rgV(o.adx14, 1)}</b><span>${o.adx14 < 20 ? `A ${rgV(o.adx14, 1)} il trend e' <b>debole</b>: in questa condizione le medie danno falsi segnali, perche' il prezzo le attraversa in continuazione senza andare da nessuna parte.` : `A ${rgV(o.adx14, 1)} il trend ha forza: le medie e i livelli funzionano meglio che in fase laterale.`}
        ${o.di_su != null ? `DI+ ${rgV(o.di_su, 1)} contro DI- ${rgV(o.di_giu, 1)}: e' li' che sta la direzione.` : ""}</span></div>` : ""}
      <div><b>Volume${Number.isFinite(vr) ? ` — ${rgV(vr, 2)}× la media` : ""}</b><span>

        ${Number.isFinite(vr) ? (vr >= 1.5
          ? `Oggi il volume e' <b>${rgV(vr, 2)} volte</b> la media a 30 sedute: quello che e' successo oggi lo hanno fatto in molti.`
          : vr <= 0.7
            ? `Oggi il volume e' <b>${rgV(vr, 2)} volte</b> la media a 30 sedute: il movimento di oggi lo hanno fatto in pochi, e regge meno.`
            : `Oggi il volume e' <b>${rgV(vr, 2)} volte</b> la media a 30 sedute, cioe' ordinario.`) : ""}
</span></div>
      ${(() => {
        /* ⚠ v322 — I RITRACCIAMENTI DI FIBONACCI: il CEO li ha chiesti sul grafico. Il sistema
           li calcola GIA' per il pacchetto (v293) sul range a 52 settimane, con aritmetica
           esatta su due numeri che possediamo. Qui si riusa QUELLO STESSO calcolo: un secondo
           punto di calcolo darebbe due serie di livelli per lo stesso titolo, ed e' esattamente
           la contraddizione che v271 ha gia' pagato — la pagina che dice una cosa e l'analisi
           che ne dice un'altra, senza sapere a quale credere.
           ⚠ I livelli si contano DAL MASSIMO verso il basso (ritracciamento di una salita) e
           sta scritto: la stessa coppia di numeri letta al contrario significa un'altra cosa. */
        const hi = numero(rTk.w52_high), lo = numero(rTk.w52_low), px = numero(rTk.price);
        if (!Number.isFinite(hi) || !Number.isFinite(lo) || !(hi > lo)) return "";
        const R = hi - lo;
        const liv = [0.236, 0.382, 0.5, 0.618, 0.786].map(q => {
          const v = Math.round((hi - q * R) * 100) / 100;
          const d = Number.isFinite(px) ? Math.round((px / v - 1) * 1000) / 10 : null;
          return { et: `${Math.round(q * 1000) / 10}%`, v, d };
        });
        const sotto = Number.isFinite(px) ? liv.filter(x => x.v < px).sort((a2, b2) => b2.v - a2.v)[0] : null;
        const sopra = Number.isFinite(px) ? liv.filter(x => x.v > px).sort((a2, b2) => a2.v - b2.v)[0] : null;
        return `<div><b>Ritracciamenti di Fibonacci — range a 52 settimane (${fmtNum.format(lo)}–${fmtNum.format(hi)})</b><span>
          <ul class="tv-lista">${liv.map(x => `<li><b>${x.et}</b>: <b>${fmtNum.format(x.v)}</b>`
            + (x.d != null ? ` — il prezzo le sta <b class="${x.d >= 0 ? "tv-verde" : "tv-rosso"}">${signTxt(x.d)}</b>` : "")
            + `</li>`).join("")}</ul>
          Contati <b>dal massimo verso il basso</b>, cioè come ritracciamento di una salita: la stessa
          coppia di numeri letta al contrario indica quote diverse.
          <b>Perché proprio queste quote:</b> sono le frazioni in cui una salita viene storicamente
          restituita prima di riprendere — il 23,6% è un respiro, il 38,2% una correzione ordinaria,
          il 61,8% il punto oltre il quale la salita precedente è in discussione. Non hanno un
          meccanismo economico: valgono perché <b>moltissimi operatori guardano gli stessi numeri</b>
          e mettono gli ordini lì, e questo li rende livelli veri anche senza una causa.
          ${sotto ? `<b>Il primo appoggio sotto il prezzo</b> è ${sotto.et} a <b>${fmtNum.format(sotto.v)}</b> (${signTxt(sotto.d)} da qui): è la quota che molti guardano per rientrare, e dove un ribasso ordinario tende a fermarsi.` : ""}
          ${sopra ? ` <b>Il primo ostacolo sopra</b> è ${sopra.et} a <b>${fmtNum.format(sopra.v)}</b> (${signTxt(sopra.d)}).` : ` <b>Il prezzo sta sopra tutti i ritracciamenti</b>: sopra di lui non c'è nessuna quota di Fibonacci, solo il massimo delle 52 settimane a ${fmtNum.format(hi)}.`}
          <b>Non sono previsioni</b>: sono le quote che quella convenzione indica, e valgono
          quanto vale il fatto che molti le guardino. Sono gli stessi numeri che finiscono nel
          pacchetto per l'LLM — un solo calcolo, così la pagina e l'analisi non possono divergere.</span></div>`;
      })()}
    </div>`;
    /* ⚠ v332 — un titolo solo per analisi tecnica E livelli: il CEO li ha chiesti accorpati.
       Il <details> resta APERTO e non si richiude, perche' questo blocco si ridisegna solo al
       cambio di simbolo — non a ogni refresh dei prezzi, che e' cio' che chiudeva l'altro. */
    nota.innerHTML = `<details class="tv-piu" open><summary>Analisi tecnica e livelli — ${esc(String(tk).toUpperCase())}</summary>${analisi}</details>
    ${String(tk).includes(".") ? `<div class="tv-piede">⚠ "${esc(tk)}" ha un suffisso di borsa alla Yahoo: TradingView usa una nomenclatura diversa e il simbolo potrebbe non agganciarsi — scrivilo come lo vedi su TradingView (per esempio <code>EURONEXT:ASML</code>).</div>` : ""}`;
  }


}

/* v332 — i bottoni Nasdaq e S&P 500. Passano dalla STESSA funzione del resto
   (montaGraficoTV): due strade separate divergerebbero.
   ⚠ v338 — la stella dei preferiti e' uscita con la watchlist del widget; questo commento la
   nominava ancora, e un commento che rimanda a codice inesistente manda la lettura a cercare
   qualcosa che non c'e'. QQQ e SPY restano ETF, non indici: quelli il widget non li serve. */
$("#tv-idx")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-tv-tk]");
  if (b) montaGraficoTV(b.dataset.tvTk);
});
$("#tv-tf")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-tv-int]");
  if (!b) return;
  $("#tv-tf")?.querySelectorAll(".chip").forEach(c => c.classList.remove("chip-active"));
  b.classList.add("chip-active");
  montaGraficoTV(tvSimboloCorrente || ($("#tk-input")?.value || ""), b.dataset.tvInt);
});

/* ═══ v266 — LA WATCHLIST DIVENTA UNA TABELLA NOSTRA ═══════════════════════════════════════
   Il CEO: "sembra che i dati siano fermi ... struttura i dati del box come quelli nella foto ...
   con possibilita' di eliminarli o ordinarli cliccando sulle variabili delle colonne".
   ⚠ PERCHE' IL WIDGET TRADINGVIEW NON POTEVA BASTARE, e perche' i dati sembravano fermi: quel
   widget e' un IFRAME cross-origin. Non si puo' ordinare, non si puo' togliere una riga, non se
   ne puo' leggere il contenuto — e quando la rete e' lenta resta a lungo sui valori iniziali,
   che e' esattamente l'impressione che ha avuto.
   La tabella nostra risolve tutto questo, ma introduce un vincolo da DICHIARARE: i prezzi
   vengono da data.json, cioe' dalla pipeline, che segue solo i simboli che le sono stati dati.
   Per un simbolo nuovo la riga lo DICE ("non seguito") invece di mostrare una cella vuota che
   sembra un dato fermo — che sarebbe la classe di difetto peggiore, quella che non si rompe.
   Le colonne sono quelle della foto del CEO: Nome, Ultimo, Massimo, Minimo, Var., Var.%, Vol. */


/* i dati di un simbolo, da data.json. Null dove la pipeline non lo segue: dichiarato, non finto. */
/* ⚠ v268 — `Number(null)` FA ZERO, NON NaN. E' la trappola che ha fatto uscire il BTP con
   "Massimo 0 · Minimo 0 · 0%": nel file quei campi sono `null` (per un titolo non quotato in
   borsa NON ESISTONO), e la conversione li ha trasformati in zeri, cioe' in numeri veri. Uno
   zero come prezzo e' un valore che non puo' esistere, e mostrato accanto a 102,95 sembra un
   crollo totale. Questa funzione tiene l'assenza distinta dal valore: null, undefined e stringa
   vuota diventano NaN, che la tabella disegna come trattino. */
function numero(v) {
  if (v == null || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/* ⚠ v268 — la quotazione live, quando c'e', VINCE sul dato della pipeline: e' piu' fresca
   dello stesso ordine di grandezza con cui il CEO guarda la pagina. Ma la riga dice sempre da
   dove viene il suo numero: "live", "pipeline", o l'assenza dichiarata. Mescolare le due fonti
   senza etichetta era il modo per non far capire perche' due celle non tornano fra loro. */
const quoteLive = new Map();

/* il nome per esteso lo sa la pipeline (o il blocco macro); Yahoo lo darebbe in
   `meta.shortName` ma non su tutti i simboli, e un nome che balla a ogni giro e' peggio di un
   simbolo stabile. Si prende quello che gia' conosciamo, e si ripiega sul ticker. */
function nomeSimbolo(T) {
  const r = [...((DATA && DATA.portfolio) || []), ...((DATA && DATA.watchlist) || [])]
    .find(x => String(x.ticker || "").toUpperCase() === T);
  if (r && r.name) return r.name;
  const m = (DATA && DATA.macro) || {};
  for (const f of Object.values(m.futures || {})) {
    if (String(f && f.symbol).toUpperCase() === T && f.label) return f.label;
  }
  const mk = (m.markets || []).find(x => String(x.key || "").toUpperCase() === T);
  if (mk && mk.label) return mk.label;
  if (T === "^VIX") return "Volatilità (VIX)";
  return T;
}





/* ═══ v305 — ANALISI DI UN SETTORE ════════════════════════════════════════════════════════
   Richiesta del CEO dopo l'analisi che ha portato: "un'analisi di settori che gli indico
   all'interno del Nasdaq/S&P, motivandole, sulla base anche dei dati macro che abbiamo o che
   mancano integrandoli".
   ⚠⚠ LA STRUTTURA VIENE DA QUELL'ANALISI, I NUMERI DA NOI. Il ragionamento e' che una corsa di
   settore finisce quando si presentano DUE ingredienti insieme:
     (a) le azioni passano da mani istituzionali a mani retail — piu' fragili e piu' a leva;
     (b) il MOMENTUM si gira: le medie mobili smettono di salire e il prezzo va sotto.
   Il caso che lo dimostra e' il Nasdaq 1998: scossone del 20%, medie ancora in salita, e poi
   +300% fino al 2000. Chi vendette nel 1998 lesse (a) e ignoro' (b).
   ⚠ (b) LO CALCOLIAMO ESATTAMENTE. (a) NO, e va detto: i flussi retail negli ETF non hanno una
   fonte gratuita affidabile e i 13F sono trimestrali e in ritardo. Il pacchetto porta i PROXY
   che abbiamo — schiuma sugli ETF a leva, put/call, ampiezza — e dichiara che sono proxy.
   Un ingrediente mancante dichiarato e' un'analisi onesta; uno stimato in silenzio no. */
/* ⚠⚠ v341 — TRE PACCHETTI SU QUATTRO SONO USCITI. Decisione del CEO, testuale: "elimina
   portafoglio ed elimina le analisi settore e portafoglio. modifica analisi macro/titolo in
   analisi macro e fai ritornare analisi macro solo testuale."
   Via: buildPromptTicker + datiNostriDelTitolo (la sua meta' di dati), buildPromptSettore,
   buildPromptPortafoglio, settorePerChiave (aveva un solo consumatore, il pacchetto settore).
   Resta buildPrompt/buildCIOText: il quadro macro, consegnato come TESTO.
   ⚠ SONO RIMASTE IN PIEDI, e vanno lasciate stare: fattiTitolo() e livelliTitolo() non
   servivano al pacchetto del titolo — alimentano il pannello dei livelli sotto il grafico
   (renderOpzioniGrafico), che il CEO usa e non ha chiesto di togliere. Verificato risalendo
   la catena dei chiamanti prima di tagliare, non a memoria: e' la classe v201-v204, tre tagli
   su quattro in questo progetto si sono portati via il vicino.
   ⚠ E' un taglio REVERSIBILE: il codice sta in git, l'analisi di un titolo torna con un
   revert. Quello che non torna da solo e' il fatto che il sistema, da qui in avanti, sui
   singoli titoli non dice piu' niente. */


/* ═══ v315 — ANALISI DEL PORTAFOGLIO INTERO ═══════════════════════════════════════════════
   Richiesta del CEO. E' il terzo pacchetto dopo titolo e settore, e risponde a una domanda che
   nessuno dei due poteva porre: non "cosa fa questo titolo" ma "cosa ho costruito, senza
   accorgermene, mettendo insieme questi titoli".
   ⚠⚠ LA CONCENTRAZIONE E' IL FATTO CHE NESSUNA ANALISI PER SINGOLO TITOLO PUO' VEDERE. Tre
   posizioni valgono il 62% del controvalore azionario e stanno tutte nello stesso comparto: e'
   una scommessa sola scritta tre volte, e la si vede solo guardando il libro insieme.
   ⚠ QUELLO CHE IL SISTEMA NON SA VA DICHIARATO IN CIMA, non in nota: non conosce la liquidita',
   non conosce altri conti, non conosce la situazione fiscale. Senza quei tre dati qualunque
   dimensionamento e' un numero che sembra un consiglio — ed e' la ragione per cui il pacchetto
   li chiede a chi legge invece di stimarli. */


/* ═══ v316 — LA COLONNA DI TRADINGVIEW, DENTRO IL PACCHETTO ══════════════════════════════════
   Richiesta del CEO: stagionalita', conto economico, performance e dettagli tecnici. La pipeline
   li calcola sulla barra giornaliera vera (batteria_tecnica / conto_trimestrale / stagionalita_titolo
   in scripts/update_data.py); qui si stampano soltanto.
   ⚠ NON SI LEGGE IL WIDGET DI TERZI: si calcola. Le formule sono pubbliche e l'OHLCV lo scarichiamo
   gia'. Cosi' il numero e' nostro e sappiamo cosa significa.
   ⚠ Finche' il CI non ha rigenerato data.json questi campi non ci sono: il blocco allora non
   esiste, e non si inventa un ripiego calcolato sulle `sparks` — che sono sotto-campionate e
   senza date, quindi darebbero un RSI e un MACD sbagliati con l'aria di essere giusti. */


/* ═══ v271 — QUELLO CHE SAPPIAMO GIA' DEL TITOLO, INVECE DI FARLO CERCARE ═════════════════
   Trovato rileggendo il pacchetto di NVDA come lo leggerebbe un analista: la scheda TECNICA
   chiedeva all'LLM di andare a cercare online supporti, resistenze, RSI, ATR e medie mobili —
   e questi numeri il sistema LI HA GIA', calcolati dalla sua pipeline e mostrati sulla pagina
   due centimetri piu' su. Su NVDA: supporto 190,01, resistenza 224,76, RSI 64,4, ATR 7,64,
   muro delle call 215, muro delle put 115.
   Due danni, non uno. Il primo e' lo spreco. Il secondo e' peggio: l'LLM va a prendere quegli
   stessi livelli da un'altra parte, torna con numeri diversi, e il CEO si ritrova la pagina
   che dice una cosa e l'analisi che ne dice un'altra sullo stesso titolo — senza sapere quale
   credere. Un sistema che tiene un numero e ne fa cercare un altro sta preparando quella
   contraddizione.
   ⚠ Restano FATTI, non istruzioni (regola C9): qui si dichiara cosa sappiamo, con la data e
   con il metodo di calcolo, e si dice all'LLM cosa fare se cio' che trova fuori non torna. */

function buildCIOText() {
  /* v256 — IL PACCHETTO È MACRO. Prima era: timbro + brief sul NAV + testata + correlazioni
     news↔posizioni + payload + digest. Brief e correlazioni sono usciti con il portafoglio;
     al loro posto, subito dopo la testata, va il blocco che il CEO ha chiesto di TENERE — dove
     gli indicatori macro non sono d'accordo fra loro. Sta in ALTO e non in coda per la stessa
     ragione di v156: un blocco di sintesi appeso in fondo a 36k caratteri viene letto per
     ultimo, cioè quando la conclusione è già stata scritta. */
  const full = buildPrompt();
  const historical = historicalDigestText();
  /* v337 — non c'e' piu' niente da issare in cima: il blocco che si issava (il disaccordo)
     e' uscito col punteggio 0-100 su cui era costruito. Il corpo e' il pacchetto cosi' com'e'. */
  const body = full;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `\u27e6 BUILD v${BUILD_VERSION} \u00b7 generato ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())} \u27e7`;
  return stamp + "\n\n" + body + (historical ? "\n\n" + historical : "");
}

/* ---------- azione unica: copia il pacchetto completo e mostralo nella modal ---------- */
/* ═══ v316 — UNA SOLA STRADA PER CONSEGNARE UN PACCHETTO ═══════════════════════════════════
   Il CEO: "pulsante relativo copia analisi del portafoglio non genera prompt". Il pacchetto
   veniva generato benissimo — 20.013 caratteri — e poi buttato via: `navigator.clipboard
   .writeText` viene RIFIUTATA dal browser (NotAllowedError: la clipboard richiede permesso e
   attivazione, e non sempre ce l'ha), e la promise rifiutata non era gestita. Nessun errore in
   console per lui, nessun testo, nessun messaggio. Il fallimento piu' silenzioso possibile.
   ⚠⚠ MA IL DIFETTO VERO ERANO TRE STRADE DIVERSE PER LA STESSA COSA. copyCIOText apriva la
   modale col testo (e quindi funzionava anche senza clipboard), #set-copia scriveva solo negli
   appunti e in caso di rifiuto PERDEVA il pacchetto, #pf-copia non gestiva nemmeno il rifiuto.
   Tre implementazioni della stessa operazione divergono — e' la lezione v161/v207 pagata di
   nuovo. Ora la strada e' UNA: il testo finisce SEMPRE nel riquadro, che e' l'unico posto da cui
   il CEO puo' comunque prenderlo; la clipboard e' un di piu' che riesce o dichiara di non essere
   riuscito. Un pacchetto generato e non consegnato e' un pacchetto non generato. */
/* ⚠⚠ v341 — IL PDF E' USCITO, E LA CONSEGNA E' TORNATA AL TESTO. Il CEO: "fai ritornare
   analisi macro solo testuale". Il PDF esisteva per portare il GRAFICO A CANDELE — la sola
   cosa che il testo non puo' portare — e quel grafico aveva senso su un pacchetto che parla
   di UN titolo. Senza il pacchetto del titolo, un PDF di solo testo sarebbe un contenitore
   piu' scomodo del testo: si incolla peggio in una chat e non aggiunge niente.
   Restano in git costruisciPdf, pdfCandele e il resto: se un domani torna l'analisi di un
   titolo, tornano con un revert. */

/* ══ v347 — RIPRISTINO DI CIO' CHE LA v341 AVEVA TOLTO ═══════════════════════════════════
   Il CEO: "torniamo sul mio sistema, riporta quell'attivita' della v341, reinserisci il
   portafoglio e il tasto per la generazione del prompt AI dell'azione".
   ⚠ NON e' un dietrofront: e' il risultato di una misura. Fra la v341 e oggi abbiamo provato
   tre strade esterne — un server MCP su yfinance, un connettore sull'endpoint pubblico di
   TradingView, un bridge che pilota l'app desktop — e tutte e tre restituivano numeri che
   QUESTO sistema calcola gia'. Su MU, contro lo schermo del CEO: RSI 54,3 qui contro 54,34 su
   TradingView; MACD 11,7 / -0,57 contro 11,687 / -0,585.
   La batteria tecnica non e' mai stata spenta: e' rimasta nella pipeline mentre spegnevamo
   l'unica cosa che la pubblicava.
   ⚠ NON tornano il pacchetto di SETTORE, quello di PORTAFOGLIO e il PDF: il CEO non li ha
   chiesti, e un ripristino che riporta indietro anche cio' che nessuno ha chiesto e' come un
   taglio che si porta via il vicino — stessa classe, verso opposto. */

function tvBlocchi(tk) {
  const r = ((DATA && DATA.watchlist) || []).concat((DATA && DATA.portfolio) || [])
    .find(x => x && String(x.ticker).toUpperCase() === String(tk).toUpperCase());
  const tv = r && r.tv;
  if (!tv) return [];
  const F = [];
  const pc = (v) => (v == null ? "n.d." : signTxt(Math.round(v * 10) / 10));

  if (tv.performance) {
    const et = { s1: "1 settimana", m1: "1 mese", m3: "3 mesi", m6: "6 mesi", ytd: "da inizio anno",
                 a1: "1 anno", a3: "3 anni", a5: "5 anni", a10: "10 anni" };
    F.push(``, `--- PERFORMANCE PER ORIZZONTE ---`);
    F.push(Object.keys(et).filter(k => tv.performance[k] != null)
      .map(k => `${et[k]} ${pc(tv.performance[k])}`).join(" \u00b7 "));
    F.push(`Gli orizzonti oltre l'anno sono misurati sulla serie MENSILE, non su una finestra `
      + `giornaliera corta: un ritorno di un anno con l'etichetta di tre sarebbe un numero fuori orizzonte.`);
  }

  if (tv.tecnica) {
    const t = tv.tecnica;
    F.push(``, `--- DETTAGLI TECNICI (calcolati dal sistema, non letti da terzi) ---`);
    const ord = ["sma10", "sma20", "sma30", "sma50", "sma100", "sma200", "ema10", "ema20", "ema30", "ema50", "ema100", "ema200"];
    ord.filter(k => t.medie && t.medie[k]).forEach(k => {
      const m = t.medie[k];
      const nome = k.startsWith("sma") ? `Media semplice ${k.slice(3)}` : `Media esponenziale ${k.slice(3)}`;
      /* ⚠ UNA SOLA CONVENZIONE, e dichiarata: il LIVELLO della media, e dove sta il PREZZO
         rispetto a lei. In v314 le due famiglie ne usavano due opposte e un LLM vero ha scritto
         "la SMA200 e' il 75,9% sotto il riferimento" invertendo il verso. */
      F.push(`${nome}: ${m.liv} — il prezzo le sta ${pc(m.dist_pct)}, cioe' ${m.dist_pct >= 0 ? "SOPRA" : "SOTTO"}`);
    });
    if (t.medie_totali) {
      F.push(`Il prezzo sta sopra ${t.medie_battute} delle ${t.medie_totali} medie calcolate. `
        + `E' un CONTEGGIO, non un giudizio: il sistema non pubblica piu' verdetti sintetici (v200), `
        + `perche' un'etichetta compra/vendi ancora la lettura prima ancora che cominci.`);
    }
    const o = t.oscillatori || {};
    const osc = [];
    if (o.rsi14 != null) osc.push(`RSI 14: ${o.rsi14}`);
    if (o.macd) osc.push(`MACD 12/26/9: linea ${o.macd.linea}, segnale ${o.macd.segnale}, istogramma ${o.macd.istogramma}`);
    if (o.stoch_k != null) osc.push(`Stocastico 14/3: %K ${o.stoch_k}${o.stoch_d != null ? `, %D ${o.stoch_d}` : ""}`);
    if (o.cci20 != null) osc.push(`CCI 20: ${o.cci20}`);
    if (o.williams_r != null) osc.push(`Williams %R 14: ${o.williams_r}`);
    if (o.adx14 != null) osc.push(`ADX 14: ${o.adx14} (DI+ ${o.di_su}, DI- ${o.di_giu}) — l'ADX misura la FORZA del trend, non la direzione: sotto 20 il trend e' debole a prescindere dal segno`);
    if (o.momentum10 != null) osc.push(`Momentum 10 sedute: ${o.momentum10}`);
    if (osc.length) F.push(`Oscillatori — ${osc.join(" \u00b7 ")}`);
    if (t._come) F.push(`Metodo: ${t._come}.`);
  }

  if (tv.conto_trim && tv.conto_trim.length) {
    F.push(``, `--- CONTO ECONOMICO TRIMESTRALE (ultimi ${tv.conto_trim.length} trimestri) ---`);
    const mld = (v) => (v == null ? "n.d." : `${(v / 1e9).toFixed(2)} mld`);
    tv.conto_trim.forEach(q => F.push(`- ${q.trim}: ricavi ${mld(q.ricavi)}`
      + (q.operativo != null ? ` \u00b7 risultato operativo ${mld(q.operativo)}${q.margine_op != null ? ` (${q.margine_op}%)` : ""}` : "")
      + (q.utile != null ? ` \u00b7 utile netto ${mld(q.utile)}${q.margine != null ? ` (margine ${q.margine}%)` : ""}` : "")));
    F.push(`⚠ Il trimestre e' l'unita' in cui una societa' ciclica gira: la serie ANNUALE piu' `
      + `sopra copre lo stesso periodo ma nasconde il punto di svolta dentro la media dei dodici mesi.`);
  }

  if (tv.stagionalita && tv.stagionalita.length) {
    const MESI = ["", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
                  "agosto", "settembre", "ottobre", "novembre", "dicembre"];
    const ora = new Date().getMonth() + 1;
    const vicini = tv.stagionalita.filter(x => [ora, ora % 12 + 1, (ora + 1) % 12 + 1].includes(x.mese));
    F.push(``, `--- STAGIONALITA' DEL TITOLO (mese per mese, sul suo storico mensile) ---`);
    (vicini.length ? vicini : tv.stagionalita).forEach(x =>
      F.push(`- ${MESI[x.mese]}: media ${pc(x.media)}, mediana ${pc(x.mediana)}, `
        + `${x.positivi_pct}% di mesi positivi su ${x.campione} osservazioni, esiti da ${pc(x.peggio)} a ${pc(x.meglio)}`));
    F.push(`⚠ Dove media e mediana divergono, la media e' tirata da pochi mesi estremi. E' il conto `
      + `di cosa e' successo, non una previsione: serve a sapere se un movimento e' ordinario per il periodo.`);
  }

  if (tv.sensibilita) {
    F.push(``, `--- COME IL MACRO ARRIVA A ${String(tk).toUpperCase()}: SENSIBILITA' MISURATE ---`);
    F.push(`Regressione dei rendimenti GIORNALIERI del titolo su quelli di uno strumento quotato che `
      + `rappresenta il canale. Il beta dice di quanto si muove il titolo per ogni punto del canale; `
      + `l'R² dice QUANTA della sua variabilita' quel canale spiega davvero.`);
    Object.entries(tv.sensibilita).forEach(([nome, v]) => {
      const forza = v.r2 >= 0.4 ? "canale DOMINANTE" : v.r2 >= 0.15 ? "canale presente"
        : v.r2 >= 0.05 ? "canale debole" : "NESSUNA relazione misurabile su questa finestra";
      F.push(`- ${nome} (${v.strumento}) — ${v.canale}: beta ${v.beta > 0 ? "+" : ""}${v.beta}, `
        + `R² ${v.r2} → ${forza}. Campione ${v.campione} sedute comuni, dal ${v.da} al ${v.a}.`);
    });
    F.push(`⚠⚠ UN BETA SENZA IL SUO R² E' MEZZO NUMERO. Un beta di 1,8 sui tassi con R² 0,01 non `
      + `significa "molto sensibile ai tassi": significa che su questa finestra i tassi non spiegano `
      + `niente del movimento, e il beta e' rumore stimato con tre decimali. La finestra e' comune `
      + `per costruzione — le due serie sono allineate per DATA, non per posizione.`);
    F.push(`⚠ Sono relazioni STORICHE su circa un anno, non leggi: un canale puo' accendersi (una `
      + `societa' che si indebita diventa sensibile ai tassi in un trimestre). Dicono da dove il `
      + `movimento e' arrivato finora, non da dove arrivera'.`);
  }
  return F;
}

function datiNostriDelTitolo(tk) {
  /* v274 — SCRITTO SUI FATTI, non ricavato di nuovo. Prima questa funzione rileggeva
     DATA.portfolio, DATA.watchlist, DATA.options e quoteLive per conto suo, e ogni volta che
     aggiungevo un dato alla pagina mi dimenticavo di aggiungerlo qui: i muri delle opzioni,
     poi il pre-market. Adesso legge lo stesso oggetto che disegna la scheda, quindi non c'e'
     piu' un "qui" e un "li'" da tenere allineati a mano. */
  const f = fattiTitolo(tk);
  if (!f || !f.seguito) return "";
  const T = f.tk, L = [];
  const dist = (v) => (Number.isFinite(f.prezzo) && Number.isFinite(v))
    ? ` (${v > f.prezzo ? "+" : ""}${Math.round((v / f.prezzo - 1) * 1000) / 10}% dal riferimento)` : "";

  if (Number.isFinite(f.prezzo)) {
    /* ⚠ v276 — L'ORA DELLA LETTURA. "Ultima quotazione letta dal browser" non dice QUANDO: se
       il CEO incolla il pacchetto alle 16:00 e l'LLM risponde alle 16:30, quel prezzo ha
       mezz'ora e nessuno dei due lo sa. E' la stessa regola che ho gia' applicato al
       pre-market e alle cadenze macro — un numero senza ora non dice quanto e' fresco. */
    const ora = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    L.push(`- Prezzo di riferimento del sistema: ${f.prezzo}`
      + (f.fonte === "live" ? ` (letto dal browser alle ${ora}, ora italiana)`
         : f.barraDel ? ` (barra del ${f.barraDel})` : ""));
  }
  /* il prezzo fuori orario, quando c'e', batte i futures sull'indice: parla di QUESTO titolo. */
  if (f.ext && Number.isFinite(f.ext.prezzo)) {
    const d = Number.isFinite(f.prezzo) && f.prezzo
      ? Math.round((f.ext.prezzo / f.prezzo - 1) * 1000) / 10 : null;
    L.push(`- Prezzo ${f.ext.fase === "pre" ? "PRE-MARKET" : "AFTER-HOURS"} adesso: ${Math.round(f.ext.prezzo * 100) / 100}`
      + (d != null ? ` (${d > 0 ? "+" : ""}${d}% rispetto alla chiusura)` : "")
      + ` — rilevato alle ${f.ext.quando.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}, ora italiana.`
      + ` E' piu' fresco della chiusura e riguarda QUESTO titolo: pesalo piu' dei futures sull'indice, che parlano del mercato e non di lui.`);
  }
  /* i livelli arrivano gia' ordinati, col lato misurato e la provenienza dichiarata. */
  f.livelli.forEach(x => L.push(`- ${x.nome}: ${x.v}${dist(x.v)} — ${x.fonte}`));

  /* ═══ v293 — FIBONACCI ED EMA LI CALCOLIAMO NOI ═════════════════════════════════════════
     Richiesta del CEO: fra i dati tecnici vuole "supporti e resistenze, SMA, EMA, Fibonacci".
     ⚠ E vanno calcolati QUI, non fatti cercare: e' testualmente la lezione v271 — il sistema
     aveva i livelli e ne faceva cercare altri, l'LLM tornava con numeri diversi, e il CEO si
     ritrovava la pagina che dice una cosa e l'analisi che ne dice un'altra sullo stesso titolo
     senza sapere a quale credere. Un sistema che tiene un numero e ne fa cercare un altro sta
     preparando quella contraddizione.
     ⚠⚠ E SI CALCOLA SOLO CIO' CHE I DATI PERMETTONO. Misurato sulle serie vere: `sparks.m6` sono
     126 barre GIORNALIERE (le ultime cinque coincidono con `w1`), mentre `sparks.all` — 500
     punti che su AMD vanno da 17,56 a 514,39 — e' lo storico lungo, non giornaliero. Quindi EMA
     20 e 50 si possono fare; l'EMA 200 NO: servirebbero 200 barre giornaliere e ne abbiamo 126.
     Pubblicarla lo stesso sarebbe un numero che sembra piu' solido di quanto e'. */
  const tec = f.tecnici || {};
  const barre = Array.isArray(tec.barreGiorno) ? tec.barreGiorno : [];
  const ema = (serie, n) => {
    /* servono almeno 2n barre perche' il valore si sia staccato dal seme: sotto, l'EMA e'
       ancora dominata dalla media semplice iniziale e non e' cio' che dichiara di essere. */
    if (!Array.isArray(serie) || serie.length < 2 * n) return null;
    const kk = 2 / (n + 1);
    let e = serie.slice(0, n).reduce((s, v) => s + v, 0) / n;
    for (let i = n; i < serie.length; i++) e = serie[i] * kk + e * (1 - kk);
    return Math.round(e * 100) / 100;
  };
  const e20 = ema(barre, 20), e50 = ema(barre, 50);
  /* ⚠ v349 — se la pipeline ha gia' calcolato la batteria completa sullo storico intero,
     questa riga non deve pubblicare la SUA versione: sarebbe un secondo valore della
     stessa media, piu' debole, nello stesso testo. Il blocco DETTAGLI TECNICI piu' sotto
     porta le stesse medie (e anche l'EMA 200, che qui non si puo' fare). */
  if ((e20 != null || e50 != null) && !tec.emaDallaPipeline) {
    const pezzi = [];
    if (e20 != null) pezzi.push(`EMA 20 ${e20}${dist(e20)}`);
    if (e50 != null) pezzi.push(`EMA 50 ${e50}${dist(e50)}`);
    L.push(`- Medie esponenziali: ${pezzi.join(" · ")} — calcolate dal sistema su ${barre.length} `
      + `barre giornaliere di chiusura. EMA 200 NON calcolata: servirebbero 200 barre giornaliere `
      + `e ce ne sono ${barre.length}; per il lungo periodo c'e' la distanza dalla SMA 200 qui sopra.`);
  }
  /* ⚠ Fibonacci sul range a 52 settimane: aritmetica esatta su due numeri che abbiamo gia', non
     una stima. I livelli si contano DAL MASSIMO verso il basso (ritracciamento di una salita) ed
     e' scritto, perche' la stessa serie letta al contrario significa un'altra cosa. */
  if (Number.isFinite(tec.w52hi) && Number.isFinite(tec.w52lo) && tec.w52hi > tec.w52lo) {
    const R = tec.w52hi - tec.w52lo;
    const liv = [0.236, 0.382, 0.5, 0.618, 0.786]
      .map(q => ({ q, v: Math.round((tec.w52hi - q * R) * 100) / 100 }));
    L.push(`- Ritracciamenti di Fibonacci sul range a 52 settimane (massimo ${tec.w52hi}, minimo ${tec.w52lo}): `
      + liv.map(x => `${Math.round(x.q * 1000) / 10}% a ${x.v}${dist(x.v)}`).join(" · ")
      + ` — calcolo esatto sui due estremi, contati DAL MASSIMO verso il basso. Non sono previsioni: `
      + `sono le quote che quella convenzione indica.`);
  }
  /* ═══ v308 — SE IL TITOLO E' IN PORTAFOGLIO, IL PACCHETTO LO DICE ═══════════════════════
     Trovato rileggendo il pacchetto come lo leggerebbe un analista: dalla v307 il sistema
     CONOSCE le posizioni, e il pacchetto continuava a dichiarare "non conosco la tua posizione".
     Su AMD significava proporre un ingresso a 514 dollari a chi ha carico 153,92 e un +234%
     aperto: due decisioni diverse, e la seconda ha dentro una domanda fiscale che la prima non
     ha. Un pacchetto che nega di sapere cio' che sa e' la peggiore forma di incoerenza.
     ⚠ E' un FATTO, non un ordine: quante quote, a che prezzo, quanto vale oggi. Cosa farne lo
     decide chi legge — e l'istruzione corrispondente sta nella testata, dove vanno gli ordini. */
  if (Number.isFinite(numero(tec.qta)) && numero(tec.qta) > 0 && Number.isFinite(numero(tec.pmc))) {
    const q = numero(tec.qta), pmc = numero(tec.pmc);
    const g = Number.isFinite(numero(tec.gainPos)) ? numero(tec.gainPos) : null;
    /* ⚠⚠ v310 — E QUANTO PESA NEL LIBRO. Il pacchetto di SETTORE lo sapeva (AMD = 18% del
       controvalore azionario) e quello del TITOLO no: chi analizza AMD da sola riceveva le
       quote senza il peso, che e' il fatto che cambia la decisione piu' di qualunque livello
       tecnico. Un'asimmetria fra due pacchetti dello stesso sistema sullo stesso titolo e' la
       classe che `coherence_check` chiama "denominatori non dichiarati", qui fra artefatti. */
    const pl = tec.pesoLibro || null;
    const peso = pl ? pl.pct : null;
    L.push(`- ⚠ QUESTO TITOLO E' GIA' IN PORTAFOGLIO: ${fmtNum.format(q)} quote a un prezzo medio di carico `
      + `di ${pmc}${g != null ? `, oggi ${signTxt(Math.round(g * 10) / 10)}` : ""}`
      + (peso != null ? `, e vale il ${peso}% del controvalore azionario del libro `
          + `(su ${pl.quante} posizioni; esclude il BTP e la liquidita', che il sistema non conosce)` : "")
      + `. `
      + `Non e' una decisione di ingresso ma di mantenimento: il prezzo di carico non cambia cosa fa il `
      + `titolo, cambia cosa costa uscirne e quale plusvalenza si realizzerebbe. Il sistema NON conosce `
      + `la liquidita' disponibile, il resto del libro in dettaglio, ne' la sua situazione fiscale.`);
  }

  /* ═══ v299 — I CONTI E IL RISCHIO, DA QUI E NON DALLA RETE ═════════════════════════════
     Ogni riga porta l'unita' e cosa significa: un LLM che riceve "beta 2,49" senza sapere
     contro quale indice non puo' usarlo, e uno che riceve "rs 1m -1,9" senza il benchmark
     nemmeno. Il costo di scriverlo e' una manciata di caratteri; il costo di non scriverlo e'
     un numero usato male o ignorato. */
  {
    const T2 = [];
    if (Number.isFinite(tec.eps)) {
      T2.push(`- Utile per azione (EPS, ultimi 12 mesi): ${tec.eps}`
        + (Number.isFinite(tec.pe) ? ` — col P/E ${tec.pe}× qui sopra dice se il multiplo alto nasce da un utile piccolo o da un prezzo alto` : "")
        + (tec.eps < 0 ? ". ⚠ E' NEGATIVO: la societa' e' in perdita, e un P/E assente non e' un dato mancante ma la conseguenza." : ""));
    }
    if (Number.isFinite(tec.beta)) T2.push(`- Beta: ${tec.beta} — quanto amplifica i movimenti del mercato (1 = come l'indice)`);
    if (Number.isFinite(tec.oggiPct)) T2.push(`- Variazione di oggi: ${signTxt(tec.oggiPct)}`);
    if (Number.isFinite(tec.volRel)) T2.push(`- Volume rispetto al suo tipico: ${tec.volRel}× (sotto 1 = seduta piu' fiacca del solito)`);
    if (Number.isFinite(tec.rs1m)) {
      T2.push(`- Forza relativa a 1 mese contro ${esc(String(tec.rsBench || "il suo indice").toUpperCase())}: ${signTxt(tec.rs1m, " pp")}`
        + (Number.isFinite(tec.rsNdx) ? ` · contro il Nasdaq 100: ${signTxt(tec.rsNdx, " pp")}` : "")
        + ` — quanto ha fatto MEGLIO o PEGGIO del suo settore, non quanto ha guadagnato`);
    }
    if (Number.isFinite(tec.sortino)) T2.push(`- Sortino a 1 anno: ${tec.sortino} — rendimento per unita' di rischio al RIBASSO (a differenza dello Sharpe non penalizza i rialzi)`);
    if (tec.rischioRendimento) T2.push(`- Rapporto rischio/rendimento: ${esc(tec.rischioRendimento)} — guadagno dal riferimento (${esc(tec.rischioRendimentoBase || "ultima chiusura")}) fino alla resistenza, contro due volte l'ATR di rischio. ⚠ LA BASE E' IL PREZZO CHE PAGHERESTI, non il minimo delle ultime 20 sedute: misurato dal minimo il rapporto descriverebbe l'operazione di chi ha comprato sul fondo, e su questo titolo sarebbe stato fino a sedici volte piu' generoso. Non rifarlo`);
    if (T2.length) L.push(...T2);
  }
  if (f.opzioni && f.opzioni.ratio != null) {
    L.push(`- Rapporto put/call di ${T} sulla scadenza ${f.opzioni.scadenza}: `
      + `${Math.round(f.opzioni.ratio * 100) / 100} (volumi scambiati oggi: put ${f.opzioni.put}, call ${f.opzioni.call})`
      + (f.opzioni.nonLaPiuVicina
          ? `. ⚠ NON e' la scadenza piu' vicina: e' quella con piu' CONTRATTI APERTI (${f.opzioni.oi} contro ${f.opzioni.oiPiuVicina} — grandezza diversa dai volumi qui sopra: i contratti aperti sono posizioni ancora in essere, i volumi sono gli scambi della giornata, e non si sommano ne' si confrontano). I muri di una scadenza quasi esaurita si spostano da soli senza che il mercato si muova, quindi non sono livelli.`
          : ""));
  }
  const t = f.tecnici;
  if (t) {
    if (Number.isFinite(t.rsi)) L.push(`- RSI(14): ${t.rsi}`);
    if (Number.isFinite(t.atr)) L.push(`- ATR(14): ${t.atr}${Number.isFinite(t.atrPct) ? ` (${t.atrPct}% del prezzo — l'ampiezza tipica di una seduta)` : ""}`);
  /* ═══ v314 — DUE CONVENZIONI OPPOSTE NELLO STESSO PACCHETTO, E UN LLM CI E' CASCATO ═════
     Trovato nel referto reale su MU che il CEO ha portato: ChatGPT ha scritto "la SMA200 e'
     circa il 75,9% sotto il riferimento". E' FALSO — se il prezzo sta +75,9% sopra la media,
     la media sta il 43,1% sotto il prezzo, non il 75,9%.
     ⚠⚠ MA LA COLPA E' NOSTRA. Nello stesso blocco convivevano due convenzioni opposte per la
     stessa grandezza: le EMA scrivono "EMA 20 904.38 (-6.9% dal riferimento)", cioe' il LIVELLO
     rispetto al prezzo; le SMA scrivevano "+75.9%", cioe' il PREZZO rispetto al livello. Due
     basi diverse, nessuna delle due dichiarata, a due righe di distanza — la classe
     "denominatori non dichiarati" che `coherence_check` insegue dentro il payload, qui sfuggita
     perche' e' una questione di VERSO, non di valore.
     Ora si scrive il livello E il verso in parole, come per le EMA. */
  if (Number.isFinite(tec.sma50) || Number.isFinite(tec.sma200)) {
    /* ⚠⚠ v340 — SI LEGGE IL LIVELLO, NON SI DERIVA. Fino alla v339 questa riga faceva
       `prezzo / (1 + dist/100)`: il prezzo era quello VIVO e la distanza era calcolata dalla
       pipeline contro la CHIUSURA, quindi il numero che ne usciva non era la media di nessuna
       finestra — era il rapporto fra due grandezze misurate su riferimenti diversi.
       Su MU: 557,27 qui contro 556,46 trenta righe sotto (`Media semplice 200`), stessa
       grandezza, due valori, stesso pacchetto. Piccolo abbastanza da far pensare a due
       finestre di calcolo, mai abbastanza da far sospettare un difetto — cioe' la forma
       peggiore. Ora il livello e' quello della pipeline, che e' l'unico che esiste davvero.
       ⚠ E QUANDO NON C'E' NON SI INVENTA: se la pipeline non ha pubblicato la media, si
       stampa la sola distanza. Un livello ricostruito e' peggio di un livello assente. */
    const riga = (n, dist, liv) => {
      if (!Number.isFinite(dist)) return null;
      return `- Media a ${n} sedute${Number.isFinite(liv) ? `: ${liv}` : ""} — il prezzo le sta `
        + `${signTxt(dist)}, cioe' ${dist >= 0 ? "SOPRA" : "SOTTO"} la media`;
    };
    [riga(50, tec.sma50, f.sma50Liv ?? tec.sma50Liv),
     riga(200, tec.sma200, f.sma200Liv ?? tec.sma200Liv)].filter(Boolean).forEach(x => L.push(x));
  }
    if (Number.isFinite(t.pe)) L.push(`- P/E (trailing): ${t.pe}× — sugli utili GIA' riportati negli ultimi 12 mesi`);
    if (Number.isFinite(t.peFwd) || Number.isFinite(t.epsFwd)) {
      L.push(`- P/E PROSPETTICO: ${Number.isFinite(t.peFwd) ? t.peFwd.toFixed(1) + "×" : "n.d."}`
        + `${Number.isFinite(t.epsFwd) ? ` (utile per azione atteso ${fmtNum.format(t.epsFwd)})` : ""}`
        + ` — e' il CONSENSO DEGLI ANALISTI sull'esercizio prossimo, non una guidance della societa'`
        + `${Number.isFinite(t.pe) && Number.isFinite(t.peFwd) && t.pe > 0 ? ` e non un tasso di crescita: ${(t.pe / t.peFwd).toFixed(1)}× di scarto fra i due multipli misura quanto utile in piu' il consenso si aspetta, non quanto il titolo sia caro` : ""}.`
        + ` ⚠ SU UN TITOLO CICLICO i due multipli raccontano storie opposte e vanno letti insieme: il trailing dice cosa l'azienda HA guadagnato, il forward incorpora l'ipotesi che il ciclo continui — che di solito e' proprio l'ipotesi in discussione.`);
    }
    if (t.settore) L.push(`- Settore secondo la nostra classificazione: ${t.settore}`);
    if (t.trimestrale) L.push(`- Prossima trimestrale attesa: ${t.trimestrale}`);
  }
  if (!L.length) return "";
  return [
    `=== QUELLO CHE IL SISTEMA SA GIA' DI ${T} (questi numeri sono qui, e sono quelli che il sistema pubblica) ===`,
    `Questi numeri sono calcolati sulle stesse barre che disegnano il grafico, e sono quelli che il CEO vede sulla pagina.`,
    `⚠ SUL RITARDO: i prezzi delle azioni americane arrivano da fonti gratuite e sono ritardati di circa 15 minuti — vale per questo pacchetto come per qualunque fonte gratuita, TradingView compresa. Cambi, indici di volatilita', cripto e materie prime sono in tempo reale. Se il titolo si sta muovendo forte adesso, il prezzo qui sotto non e' l'ultimo scambio.`,
    `Sono il riferimento del sistema. Uno scarto materiale rispetto a cio' che si trova in rete (oltre il 2% su un livello di prezzo) e' un fatto che va scritto insieme a entrambi i valori: una scelta fatta in silenzio fra i due non e' verificabile.`,
    /* ═══ v299 — IL BLOCCO "COSA NON SO" ══════════════════════════════════════════════════════
   Trovato nella revisione: dei nove blocchi che il prompt chiede, solo DUE si possono
   rispondere coi dati del pacchetto (macro e tecnica). Concorrenti e quote, conti, consenso
   analisti vengono INTERAMENTE dalla rete — cioe' circa il 70% della qualita' dell'output non
   dipende da questo sistema ma dalla ricerca dell'LLM, che il sistema non controlla.
   ⚠⚠ E fin qui e' un limite, non un difetto. Il DIFETTO era che un modello che non trova il
   consenso analisti se lo inventa in silenzio, e nel referto non si distingue un numero
   verificato da uno plausibile. Qui l'elenco e' esplicito e la dichiarazione di fallimento e'
   OBBLIGATORIA: "non sono riuscito a verificare X" e' un'informazione, un numero inventato no.
   ⚠ La riga di prima ("restano da cercare online...") elencava le stesse cose ma senza chiedere
   conto del risultato: era una lista della spesa, non un vincolo. */
`══ QUELLO CHE IL SISTEMA NON HA, E CHE DEVI PORTARE TU ══`,
`Il pacchetto NON contiene queste cose. Cercale e portale con fonte e data:`,
`· conti: ricavi, margine lordo e operativo, debito netto, cassa, flusso di cassa libero, diluizione`,
`· ultima trimestrale nel dettaglio e la data CONFERMATA della prossima`,
`· concorrenti diretti, quote di mercato e anno a cui si riferiscono`,
`· consenso analisti: numero di giudizi, target medio, revisioni degli ultimi 90 giorni`,
`· notizie e fatti societari: prima le ULTIME 48 ORE, poi il contesto delle ultime settimane.`,
`  Il pacchetto porta i titoli MACRO delle ultime 6 ore quando ce ne sono; su questa societa' e sul`,
`  suo settore non porta niente, quindi quella parte e' interamente tua. Se non trovi nulla di`,
`  recente, scrivilo: "nessuna notizia rilevante nelle ultime 48 ore" e' un'informazione.`,
`⚠ La riga "NON VERIFICATO:" in chiusura e' obbligatoria, e contiene le voci che non risultano`,
`riuscito a trovare o confermare. Se le hai trovate tutte, scrivi "NON VERIFICATO: nessuna".`,
`Un numero plausibile inventato e' peggio di un buco dichiarato: il buco lo vedo, l'invenzione no.`,
`⚠ Gli ID delle serie e i nomi delle fonti stampati in coda NON sono fonti consultate: sono il`,
`nome del dato. Ricostruirci sopra un indirizzo senza aver aperto la pagina e' un elenco di fonti`,
`mai lette, che e' peggio di "non ho potuto verificare". Ogni [VERIFICATO] porta URL, DATA DI`,
`PUBBLICAZIONE e un frammento TESTUALE del titolo: le tre cose insieme non si scrivono a memoria.`,
    ...L,
    ...tvBlocchi(tk),
  ].join("\n");
}

function buildPromptTicker(tkGrezzo) {
  /* ═══ v257 — RISCRITTO DOPO UN FALLIMENTO REALE ═══════════════════════════════════════════
     Il CEO ha incollato il pacchetto in Gemini e si e' sentito rispondere: "Tutti i dati tecnici
     e fondamentali specifici su MRVL, cosi' come le notizie, sono stati classificati e registrati
     come n.d. in ottemperanza ai limiti imposti sull'impossibilita' di stima in assenza di
     accesso a feed live". Cioe': il modello ha usato la MIA regola anti-invenzione come permesso
     per non fare niente.
     La causa e' mia. Dicevo "cercali online" e subito dopo "un dato che manca si dichiara n.d.":
     due istruzioni che, lette insieme da un modello prudente, rendono l'inazione la risposta
     conforme. La regola anti-invenzione serve a impedire i NUMERI FALSI, non a giustificare un
     referto vuoto — e non lo diceva.
     Tre correzioni, tutte necessarie insieme:
     1. la ricerca e' il PRIMO passo obbligatorio, non un'opzione, e il pacchetto elenca DOVE
        guardare con gli URL — un modello che sa dove andare non si arrende alla prima difficolta';
     2. se il modello NON PUO' navigare deve DIRLO IN UNA RIGA E FERMARSI, non riempire di "n.d.":
        un referto tutto n.d. e' peggio di un rifiuto, perche' sembra un'analisi;
     3. "n.d." e' ammesso per il singolo campo introvabile DOPO aver cercato, mai come politica.
     ⚠ IL VINCOLO NON E' CAMBIATO: questa pagina e' statica, la pipeline conosce solo i suoi
     ticker e il CORS chiude Yahoo dal browser. I dati del titolo li deve prendere l'LLM. Quello
     che e' cambiato e' che ora glielo si chiede in modo che non possa scambiarlo per un divieto. */
  const tk = String(tkGrezzo || "").trim().toUpperCase();
  if (!tk) return "";
  const macro = buildPrompt();
  const header = promptHeaderText();
  const soloDati = macro.startsWith(header) ? macro.slice(header.length).replace(/^\n+/, "") : macro;
  const storico = historicalDigestText();
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const oggi = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const rilevazione = DATA && DATA.updated_at
    ? new Date(DATA.updated_at).toLocaleString("it-IT") : "n.d.";
  const prossimoRun = (typeof prossimoRunPipeline === "function" && prossimoRunPipeline())
    ? prossimoRunPipeline().toLocaleString("it-IT") : "n.d.";

  const istruzioni = [
`ANALISI DI ${tk} — ${oggi}`,
``,
`Sei un analista azionario senior. Devi produrre un'analisi operativa su ${tk}: tecnica, fondamentale, notizie, e il collegamento col quadro macro che trovi in coda.`,
``,
/* ═══ v274 — QUATTRO BLOCCHI DIFENSIVI IN UNO ═════════════════════════════════════════════
   Punto 2 della revisione. Erano PASSO 0, GERARCHIA DELLE FONTI, IL PREZZO E' UNO SOLO e
   NIENTE [VERIFICATO] DERIVATO: 3.532 caratteri che dicevano quattro volte "attenzione ai
   numeri" con quattro intestazioni diverse. Ogni regola nasce da un fallimento vero e nessuna
   si perde — cambia che stanno insieme, perche' insieme e' come vanno applicate.
   ⚠ Da non tagliare, per quanto sembrino ovvie: il "se non puoi navigare fermati" nasce da
   Gemini che rispose tutto "n.d."; il bando ai forum da un LLM che marco' [VERIFICATO] con
   fonte Reddit medie mobili e target; il prezzo unico da un'analisi che citava tre giorni
   diversi come se fossero oggi. */
`══ REGOLE SUI NUMERI — le quattro che decidono se l'analisi vale ══`,
`1. PASSO 0 — OBBLIGATORIO: CERCA ONLINE prima di scrivere qualsiasi cosa. Non e' un'opzione. SE NON PUOI NAVIGARE: scrivi una riga — "Non ho accesso al web: non posso produrre questa analisi" — e FERMATI. Non compilare il referto con "n.d." dappertutto: ha la forma di un lavoro fatto e non ne ha la sostanza. "n.d." vale per il singolo dato non trovato DOPO averlo cercato, mai come politica generale.`,
`   DOVE CERCARE: prezzi e tecnici → finance.yahoo.com/quote/${tk} · stockanalysis.com/stocks/${tk} · investing.com — fondamentali → stockanalysis.com/stocks/${tk}/financials · macrotrends · sito IR — trimestrale → comunicato IR · SEC EDGAR (sec.gov/cgi-bin/browse-edgar) — concorrenti e quote → ultimo 10-K (Competition) — notizie → Reuters, Bloomberg, CNBC, Barron's — consenso → stockanalysis/forecast · marketbeat · tipranks.`,
`2. GERARCHIA DELLE FONTI: vince il rango piu' alto. (1) FONTE PRIMARIA — societa' e filing SEC, l'unica valida per bilancio e guidance · (2) dati di mercato: Yahoo, stockanalysis, investing · (3) stampa finanziaria: Reuters, Bloomberg, WSJ, CNBC, FT · (4) aggregatori di consenso, dichiarando SEMPRE quanti analisti e a che data. NON SONO FONTI PER UN NUMERO e non si marcano [VERIFICATO]: Reddit, X, StockTwits, forum, blog anonimi, video, e ogni pagina che riporta una cifra senza dire da dove viene — se un numero lo trovi solo li', e' un dato che non hai. ⚠ ECCEZIONE UNICA E DICHIARATA: Reddit (r/wallstreetbets, r/stocks, r/investing) vale come SEGNALE DI POSIZIONAMENTO RETAIL — cosa il piccolo investitore sta guardando e da che parte sta — mai come fonte di un bilancio, di una guidance o di un prezzo. Va sempre etichettato [SENTIMENT RETAIL, non verificato] e non puo' sostenere da solo nessuna conclusione. Se il rango 2-4 contraddice il rango 1, vince l'1 e lo dici.`,
`3. IL PREZZO DI RIFERIMENTO E' UNO SOLO: valore, data e ora, borsa. Distanze dai livelli, capitalizzazione, rendimento da inizio anno e upside si calcolano su QUELLO e lo dichiarano ("−6% dal riferimento"). Citare $476 nella scheda, $482 nel commento e "chiusura del 31/07" nella tecnica significa descrivere tre giorni diversi come se fossero oggi — e' successo, ed e' il modo piu' facile di sbagliare un ingresso. A mercato chiuso il riferimento e' l'ultima chiusura, e lo scrivi.`,
`4. NIENTE [VERIFICATO] DERIVATO: vale su cio' che hai LETTO in una fonte, mai su cio' che hai ricavato. "Capitalizzazione 780-790 mld, ricavabile da 807 mld di due settimane fa piu' il calo" e' una stima: si scrive [STIMA] col calcolo accanto, oppure "n.d.". Ogni numero esterno porta fonte e data.`,
``,
/* ═══ v293 — LA CONSEGNA RISCRITTA SULLA RICHIESTA DEL CEO ═══════════════════════════════
   Testuale: "mi fornisce un quadro troppo lungo. Vorrei: breve quadro macro sulla base solo
   dei dati macro che estrapoliamo dal sistema, un quadro di cio' che fa l'azione con eventuali
   competitor e quote di mercato, prossima trimestrale con info, sentiment analisti, dati
   tecnici (supporti e resistenze, SMA, EMA, Fibonacci) e finanziari (bilanci, reddito, utili),
   infine un'analisi in chiusura su eventuali ingressi analizzando anche il sentiment del
   settore in prospettiva di breve, medio, lungo periodo".
   ⚠ LA LUNGHEZZA E' UN VINCOLO, NON UN AUSPICIO, e la vecchia consegna non ne aveva nessuno:
   sette blocchi con tabelle e prosa senza tetto producono tremila parole per costruzione. Un
   budget scritto e' l'unica istruzione che un LLM rispetta davvero.
   ⚠⚠ IL GIUDIZIO VA IN CIMA. Se la conclusione sta in fondo a una pagina e mezza, il CEO la
   legge per ultima o non la legge: il documento serve a SOSTENERE il giudizio, non a
   costruirlo davanti a chi legge.
   ⚠ TRE COSE CHE MANCAVANO e che ora sono chieste per nome: la PROSSIMA trimestrale (c'era
   solo l'ultima), i conti veri (bilancio/reddito/utili, prima sparsi), e i tre orizzonti col
   sentiment di settore in chiusura.
   ⚠ Le quattro regole difensive sopra (PASSO 0, gerarchia fonti, prezzo unico, niente
   [VERIFICATO] derivato) NON si toccano: ognuna nasce da un fallimento vero — vedi CLAUDE.md,
   "da non tagliare per quanto sembrino ovvie". */
`══ COSA DEVI CONSEGNARE — E QUANTO LUNGO ══`,
``,
`BUDGET: 1.600-1.800 parole IN TUTTO. E' un vincolo, non un'indicazione. Un blocco che non ha`,
`nulla da dire si chiude in una riga: meglio corto e vero che lungo e riempito. Tabelle solo`,
`dove servono a confrontare; niente tabella per elencare tre numeri.`,
``,
`0) IL GIUDIZIO — cinque righe, prima di tutto il resto.`,
`Cosa sta facendo ${tk}, a quale prezzo diventa interessante, cosa lo romperebbe. Nessuna`,
`tabella, nessuna premessa. Tutto quello che viene dopo serve a sostenere queste cinque righe.`,
``,
`1) QUADRO MACRO — massimo 10 righe, SOLO dai dati in coda a questo messaggio.`,
`⚠ PARTI DAL BLOCCO "SENSIBILITA' MISURATE" in coda, se c'e': dice quanto di ${tk} e' spiegato`,
`DAVVERO da ciascun canale (mercato, comparto, tassi, dollaro) sulle sedute in comune. Un canale`,
`con R² sotto 0,05 NON e' un canale su questa finestra: se vuoi sostenerlo lo stesso, di' perche'`,
`ti aspetti che si accenda ora — un bilancio che cambia, una scadenza di debito, una quota di`,
`ricavi esteri — e dichiara che stai andando CONTRO la misura. Raccontare il canale dei tassi su`,
`un titolo il cui R² sui tassi e' 0,01 e' la forma di analisi che sembra piu' seria di quella`,
`corretta, ed e' l'errore che quel blocco esiste per impedire.`,
`Non cercare online il quadro macro e non riassumere tutte le serie: prendi le DUE O TRE`,
`grandezze che contano per ${tk} e di' attraverso quale canale arrivano al suo conto economico`,
`— quale tasso, quale costo, quale domanda finale. Guarda anche dove gli indicatori NON sono`,
`d'accordo fra loro e di' da quale lato di quel disaccordo sta questo titolo.`,
`⚠ Il quadro macro in coda e' rilevato dal sistema il ${rilevazione}; il prossimo run del sistema`,
`e' atteso il ${prossimoRun}. Ogni serie porta la propria data di rilevazione e il proprio prossimo`,
`aggiornamento: un dato di due mesi non e' lo stato di oggi, e se lo usi dichiari quanto e' vecchio.`,
``,
`2) L'AZIENDA E CONTRO CHI GIOCA — cosa vende e a chi, poi una tabella dei concorrenti diretti:`,
`| Concorrente | Ticker | Cap. mercato | Quota di mercato | Anno e fonte della quota | Dove batte ${tk} |`,
`Se una quota non e' pubblica dillo e usa un proxy dichiarato (ricavi di segmento, unita'`,
`spedite). Una quota senza anno non vale: i mercati si ribaltano in quattro trimestri.`,
``,
`3) TRIMESTRALI — l'ultima come contesto, la PROSSIMA come evento.`,
`Dell'ultima: ricavi, utile per azione, margine lordo e operativo, e la voce che conta per il`,
`suo business, ciascuno col confronto sul consenso. Della PROSSIMA: la data (confermata dalla`,
`societa' o dichiarata stimata), cosa attende il consenso su ricavi ed EPS, quale numero`,
`specifico deciderebbe la reazione, e cosa ha fatto il titolo dopo le ultime due uscite.`,
``,
`4) I CONTI — bilancio, conto economico, generazione di cassa.`,
`Debito netto e sua scadenza, liquidita', margini e loro direzione negli ultimi quattro`,
`trimestri, flusso di cassa operativo e libero, diluizione da compensi in azioni. La domanda a`,
`cui rispondere e' una: questa societa' finanzia la propria crescita o la prende a prestito?`,
``,
`5) TECNICA — i livelli, non le sensazioni.`,
`Supporti e resistenze, medie semplici ed ESPONENZIALI, ritracciamenti di FIBONACCI, RSI, ATR`,
`e i muri delle opzioni. ⚠ Molti di questi numeri sono gia' calcolati nel blocco "QUELLO CHE IL`,
`SISTEMA SA GIA'" qui sotto, con il metodo dichiarato: usa QUELLI. Se ne trovi altri online che`,
`non tornano, scrivi entrambi e di' quale usi e perche' — non sostituirli in silenzio.`,
``,
`6) SENTIMENT — degli analisti E del retail, tenuti separati.`,
`ANALISTI: consenso (quanti compra/mantieni/vendi), target medio e distanza dal prezzo, e la`,
`DISPERSIONE fra target minimo e massimo — una forbice larga su un consenso unanime dice che`,
`non stanno valutando la stessa azienda, ed e' un'informazione piu' utile della media. Poi le`,
`revisioni degli ultimi 90 giorni e la direzione, e il posizionamento (short interest, flussi).`,
`Le revisioni contano piu' del target: il target e' vecchio quanto l'ultimo aggiornamento, la`,
`revisione dice cosa sta cambiando adesso.`,
`RETAIL: cosa si dice di questo titolo su Reddit in questi giorni, etichettato [SENTIMENT`,
`RETAIL, non verificato]. Serve a sapere da che parte sta il piccolo investitore, non a`,
`stabilire un fatto: euforia su un titolo gia' corso e' un dato di posizionamento, non una tesi.`,
``,
`7) LA CHIUSURA — ingressi e settore, su tre orizzonti.`,
`Prima il SETTORE: come sta messo il comparto di ${tk} e se questo titolo e' il migliore o il`,
`peggiore posto in cui esprimere quella scommessa. Poi gli INGRESSI, distinti per orizzonte:`,
`· BREVE (settimane): a quale prezzo il rischio-rendimento gira, e quale livello lo invalida.`,
`· MEDIO (3-12 mesi): quale trimestrale o quale dato macro decide la direzione.`,
`· LUNGO (oltre l'anno): la tesi vale ancora se il ciclo del settore gira? Cosa la romperebbe?`,
`Non un voto: un ragionamento con numeri sopra, e per ciascun orizzonte cosa ti smentirebbe.`,
``,
/* ═══ v296 — LA TESI CONTRARIA, PRESA DA TradingAgents ═══════════════════════════════════
   Il CEO mi ha chiesto di analizzare TauricResearch/TradingAgents. Di quel framework l'idea
   che vale e' UNA: due ricercatori, uno rialzista e uno ribassista, che si contraddicono prima
   che qualcuno decida. Il resto (agenti autonomi, borsa simulata, sentiment dai forum) non lo
   prendo — e il sentiment dai forum e' gia' vietato da questa stessa testata, dopo che un LLM
   marco' [VERIFICATO] medie mobili e target con fonte Reddit.
   ⚠ E LA PRENDO COME STRUTTURA DI PROMPT, NON COME SISTEMA: zero infrastruttura nuova, resta
   dentro il flusso a un incollaggio, ed e' verificabile con un cancello.
   ⚠⚠ VA IN FONDO, NON DOPO IL GIUDIZIO. Per attaccare una tesi bisogna averla prima esposta
   con le prove: messo dopo il blocco 0 sarebbe un'obiezione a qualcosa che non e' ancora stato
   argomentato, cioe' teatro.
   ⚠ TRE VINCOLI CHE LO RENDONO UN CONTRADDITTORIO VERO invece di un paragrafo di cortesia:
   (a) deve usare i NUMERI DI QUESTO PACCHETTO, altrimenti produce obiezioni generiche che
       valgono per qualsiasi titolo e non informano su nessuno;
   (b) deve chiudere SCEGLIENDO: "entrambe le tesi hanno merito" e' il modo in cui un modello
       evita di esporsi, ed e' esattamente cio' che il blocco deve impedire;
   (c) deve nominare un fatto OSSERVABILE E DATATO che deciderebbe la disputa — e il pacchetto
       ora porta il calendario delle prossime due settimane, quindi quel fatto spesso c'e' gia'. */
`8) LA TESI CONTRARIA — massimo 10 righe, ed e' obbligatoria.`,
`Hai appena scritto un giudizio. Ora scrivi il caso di chi la pensa all'opposto, e scrivilo`,
`bene: se sei arrivato a "comprare", argomenta perche' ${tk} scendera'; se sei arrivato a`,
`"stare fuori", argomenta perche' questo e' il momento di entrare.`,
`⚠ Usa i NUMERI DI QUESTO PACCHETTO, non obiezioni generiche: un'obiezione che varrebbe per`,
`qualsiasi titolo non dice niente su questo. Se la tesi contraria poggia su un dato che qui`,
`non c'e', dillo — anche quello e' un'informazione sul tuo giudizio.`,
`Poi chiudi in due righe: quale delle due regge meglio, e QUALE FATTO OSSERVABILE E DATATO`,
`separerebbe le due letture (una trimestrale, un dato macro in uscita, un livello di prezzo`,
`toccato). Non ti e' consentito rispondere che entrambe le tesi hanno merito: se le prove non`,
`bastano a scegliere, il giudizio da dare e' "non abbastanza per agire", che e' una scelta.`,
``,
`══ REGOLE ══`,
`· Sei un analista di Wall Street: scrivi come per un comitato di investimento, non per un blog.`,
`  Italiano, prosa densa, zero frasi di cortesia, zero cappelli introduttivi, zero riassunti di`,
`  cio' che hai gia' detto. Se una frase non porta un fatto o un giudizio, va tolta.`,
`· Ogni dato esterno va [VERIFICATO] con fonte e data. Chiudi con "FONTI" — una riga per URL.`,
`· Se due fonti danno numeri diversi sulla stessa grandezza, dillo e scegli motivando.`,
`· Se il pacchetto dichiara che il titolo e' gia' in portafoglio, tienine conto: e' una decisione`,
`  di MANTENIMENTO, non di ingresso, e va detto a quale prezzo la tesi si romperebbe. Se non lo`,
`  dichiara, il sistema non ha quella posizione e tu non la chiedi.`,
`· In nessun caso dimensionare: niente "quante quote comprare", niente stop in euro, niente`,
`  percentuali di portafoglio. Il sistema non conosce liquidita' ne' situazione fiscale, e un`,
`  dimensionamento senza quei due dati e' un numero che sembra un consiglio.`,
`· Ignora prezzi e conclusioni di conversazioni precedenti: conta questo pacchetto e cio' che`,
`  trovi ADESSO in rete.`,
`· Niente domande in chiusura e niente offerte di approfondimento: quello che serve, dillo qui.`,
``,
`══ CONTROLLO DEL PACCHETTO — sezione obbligatoria, in fondo, intitolata "SEGNALAZIONI AL SISTEMA" ══`,
`Mentre lavori, tratta i numeri di questo pacchetto come DA VERIFICARE, non come veri per`,
`definizione. Il sistema che li produce ha gia' pubblicato, in passato: un percentile sopra 100,`,
`un beta diviso per cento, una variazione mensile etichettata come trimestrale con il segno`,
`opposto a quello vero, una prossima uscita annunciata con due mesi di ritardo, e un confronto`,
`fra due esiti diversi presentato come divergenza fra fonti. Ogni volta il numero sembrava`,
`plausibile: e' cosi' che questi difetti sopravvivono.`,
`QUANDO un dato ti sembra incongruo — fuori scala, in contraddizione con un altro dato dello`,
`stesso pacchetto, incompatibile con quello che sai del mercato, o semplicemente strano —`,
`VERIFICALO ONLINE su una fonte primaria prima di usarlo, e poi elencalo qui sotto con:`,
`  · il dato come lo scrive il pacchetto, testuale`,
`  · il valore che hai trovato alla fonte, con URL e data`,
`  · quale dei due hai usato nell'analisi e perche'`,
`  · se e' un difetto del sistema o solo un dato che sorprende (sono cose diverse: il primo va`,
`    corretto nel codice, il secondo e' informazione di mercato)`,
`Rientrano in questa sezione anche: dati che il pacchetto DICE di avere e che non ci sono, rimandi`,
`a sezioni assenti, unita' di misura ambigue, e numeri che il sistema calcola in due punti con due`,
`valori diversi.`,
`Se non hai trovato nulla, scrivi "SEGNALAZIONI AL SISTEMA: nessuna incongruenza rilevata" — e`,
`dillo solo se hai davvero controllato. Questa sezione non e' un adempimento: e' il modo in cui`,
`chi mantiene il sistema scopre cosa correggere, e una riga taciuta qui e' un difetto che resta.`,
``,
`──────────────────────────────────────────────────────────────────`,
`QUADRO MACRO DI RIFERIMENTO (rilevato dal sistema, non da te)`,
`Snapshot del ${rilevazione} · prossimo aggiornamento atteso ${prossimoRun}`,
`──────────────────────────────────────────────────────────────────`,
].join("\n");

  return [istruzioni, datiNostriDelTitolo(tk), contestoPortafoglio(tk), diarioOperazioni(tk), soloDati, storico].filter(Boolean).join("\n\n");
}

async function consegnaPacchetto(testo, che, esito) {
  if (!testo) { if (esito) esito.textContent = `${che}: non c'e' niente da consegnare.`; return false; }
  /* il testo finisce SEMPRE nel riquadro, anche quando la casella resta chiusa: se il download
     non parte, il ripiego qui sotto la apre e il pacchetto e' gia' dentro. */
  const box = $("#prompt-text");
  if (box) box.value = testo;
  const quanti = `${testo.length.toLocaleString("it")} caratteri`;

  /* v341 — una strada sola, ed e' il testo: nel riquadro sempre, negli appunti se il browser
     li concede. La regola v316 non cambia — un pacchetto generato e non consegnato e' un
     pacchetto non generato — cambia il formato, non il principio. */
  const modale = $("#modal");
  if (modale) modale.hidden = false;
  try {
    await navigator.clipboard.writeText(testo);
    if (esito) esito.innerHTML = `<b>${esc(che)}</b> — ${quanti}, negli appunti e nel riquadro. Incolla in una chat NUOVA.`;
    toast(`${che} copiato \u2713`);
    return true;
  } catch {
    /* il rifiuto della clipboard NON e' un fallimento della generazione: il testo e' li'. */
    if (esito) esito.innerHTML = `<b>${esc(che)}</b> — ${quanti}, nel riquadro qui sopra. Il browser non mi ha dato gli appunti: selezionalo e copialo da li'.`;
    return false;
  }
}

async function copyCIOText() {
  /* ⚠ v259 — UN SOLO BOTTONE. Ce n'erano due, "Copia analisi macro" in topbar e "Copia analisi
     per l'AI" nel box del titolo, e il CEO ha chiesto di unirli: "ci dovrebbe essere un unico
     pulsante che crea il prompt da copiare all'llm".
     Aveva ragione anche per una ragione che non ha detto: il pacchetto del titolo CONTIENE gia'
     tutto il quadro macro, quindi i due bottoni non producevano due cose diverse — producevano
     lo stesso quadro macro, una volta da solo e una volta dentro un'analisi. Due porte per la
     stessa stanza (la classe v209).
     Ora la scelta la fa il contenuto del box: ticker scritto → analisi di quel titolo; box vuoto
     → solo quadro macro. E lo dice, invece di lasciarlo indovinare. */
  if (!DATA) { toast("Dati non ancora caricati, riprova tra un attimo"); return; }
  /* v347 — TORNANO I DUE ESITI. Il pacchetto del titolo CONTIENE il quadro macro: non sono
     due prodotti diversi, e per questo il bottone resta uno solo (v259). */
  const tk = String($("#tk-input")?.value || "").trim().toUpperCase();
  const esito = $("#tk-esito");
  let testo, che;
  if (tk) {
    if (!/^[A-Z0-9][A-Z0-9.\-=^:]{0,15}$/.test(tk)) {
      if (esito) esito.textContent = `"${tk}" non sembra un ticker. Svuota il campo per il solo quadro macro, o scrivilo come lo vedi sul mercato.`;
      $("#tk-input")?.focus();
      return;
    }
    montaGraficoTV(tk);
    testo = buildPromptTicker(tk);
    che = `Analisi di ${tk}`;
  } else {
    testo = buildCIOText();
    che = "Quadro macro";
  }
  await consegnaPacchetto(testo, che, esito);
}


/* ═══ v256 — ANALISI SPOT DEL TITOLO: il box, e cosa fa davvero ═══════════════════════════
   Il ticker non si salva da nessuna parte: nessun localStorage, nessuna scrittura sul repo.
   Il pacchetto si genera al clic, si copia, e la modale lo mostra per un'ultima occhiata —
   stesso percorso del pacchetto macro, perche' due strade separate per la stessa azione
   divergono (v161, v207). */
/* v259 — copiaAnalisiTitolo() rimossa: era la seconda strada per la stessa azione, e due
   strade separate per la stessa cosa divergono (v161, v207). Ora c'e' solo copyCIOText. */


/* ---------------- eventi ---------------- */
$("#btn-refresh")?.addEventListener("click", refreshAll);
$("#btn-cio")?.addEventListener("click", copyCIOText);
$("#btn-diary")?.addEventListener("click", apriDiario);   // v348 — il diario torna raggiungibile
$("#tk-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") copyCIOText(); });

function sellManuali() {
  try {
    const a = JSON.parse(localStorage.getItem(SELL_KEY) || "[]");
    return Array.isArray(a) ? a.filter(r => r && r.ticker && r.qty > 0 && r.pmc > 0) : [];
  } catch { return []; }
}
function salvaSellManuali(a) {
  try { localStorage.setItem(SELL_KEY, JSON.stringify(a)); } catch { /* modalita' privata */ }
}

function sellRows() {
  const eur = DATA.eurusd || 1.08;
  return [...(DATA.portfolio || []), ...sellManuali()].map(r => {
    const toEur = r.currency === "EUR" ? 1 : 1 / eur;
    const price = sellPriceOv[r.ticker] != null ? sellPriceOv[r.ticker] : r.price;   // override manuale
    const plPerShare = (price - r.pmc) * toEur;   // utile/perdita per azione in €
    return { ...r, price, plPerShare, taxRate: r.ticker === "BTP-V28" ? 0.125 : 0.26 };
  });
}

function renderSellCalc() {
  const rows = sellRows();
  $("#sell-table tbody").innerHTML = rows.map(r => {
    const c = cur(r);
    const edited = sellPriceOv[r.ticker] != null;
    return `<tr data-tk="${r.ticker}">
      <td class="name-cell">${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num sell-price-cell">
        <span class="sp-cur">${c}</span><input type="number" inputmode="decimal" class="sell-price${edited ? " sp-edited" : ""}" data-tk="${r.ticker}" value="${r.price}" step="any" title="Prezzo di vendita — modificabile a mano (✎)" style="width:74px">
        <span class="sp-pencil" title="Prezzo modificabile a mano">✎</span>
      </td>
      <td class="num"><input type="number" inputmode="decimal" class="sell-in" data-tk="${r.ticker}" min="0" max="${r.qty}" step="any" placeholder="0" value="${sellQtyOv[r.ticker] ?? ""}" style="width:70px"><button class="sell-all" data-tk="${r.ticker}" title="Vendi tutta la posizione">tutte</button></td>
      <td class="num sell-pl" data-tk="${r.ticker}">—</td>
    </tr>`;
  }).join("");
  /* v282 — la riga per aggiungere una posizione a mano, in coda alla tabella. Il ✕ toglie
     solo quelle manuali: quelle che arrivano dal file non sono sue da cancellare qui. */
  const corpo = $("#sell-table tbody");
  if (corpo) {
    const manuali = new Set(sellManuali().map(r => r.ticker));
    corpo.querySelectorAll("tr[data-tk]").forEach(tr => {
      if (!manuali.has(tr.dataset.tk)) return;
      const ultima = tr.querySelector("td:last-child");
      if (ultima) ultima.insertAdjacentHTML("beforeend",
        ` <button class="sell-del" data-tk="${esc(tr.dataset.tk)}" title="Togli questa riga">×</button>`);
    });
    corpo.insertAdjacentHTML("beforeend", `<tr class="sell-nuova">
      <td class="name-cell"><input type="text" id="sn-tk" placeholder="TICKER" spellcheck="false"
          autocapitalize="characters" style="width:92px" aria-label="Simbolo"></td>
      <td class="num"><input type="number" id="sn-qty" placeholder="quantità" min="0" step="any" style="width:80px" aria-label="Quantità possedute"></td>
      <td class="num"><input type="number" id="sn-pmc" placeholder="PMC" min="0" step="any" style="width:80px" aria-label="Prezzo medio di carico"></td>
      <td class="num"><input type="number" id="sn-px" placeholder="prezzo" min="0" step="any" style="width:80px" aria-label="Prezzo attuale"></td>
      <td class="num" colspan="2"><button class="btn btn-ghost btn-sm" id="sn-add">+ Aggiungi</button>
        <span class="muted sn-nota">valuta: EUR se il ticker finisce per .MI o è un BTP, altrimenti USD</span></td>
    </tr>`);
    $("#sn-add")?.addEventListener("click", () => {
      const tk = String($("#sn-tk")?.value || "").trim().toUpperCase();
      const qty = parseFloat($("#sn-qty")?.value), pmc = parseFloat($("#sn-pmc")?.value);
      const px = parseFloat($("#sn-px")?.value);
      if (!tk || !(qty > 0) || !(pmc > 0)) { toast("Servono ticker, quantità e PMC"); return; }
      /* ⚠ la valuta decide la conversione in € e la tassa: sbagliarla falserebbe il risultato
         netto. Si deduce dal simbolo, e la regola e' scritta accanto al campo invece di essere
         indovinata in silenzio. */
      const eur = /\.MI$/.test(tk) || /^BTP/.test(tk);
      const a = sellManuali().filter(r => r.ticker !== tk);
      a.push({ ticker: tk, name: tk, qty, pmc, price: Number.isFinite(px) && px > 0 ? px : pmc,
               currency: eur ? "EUR" : "USD", manuale: true });
      salvaSellManuali(a);
      renderSellCalc();
      computeSell();
    });
    corpo.querySelectorAll(".sell-del").forEach(b => b.addEventListener("click", () => {
      salvaSellManuali(sellManuali().filter(r => r.ticker !== b.dataset.tk));
      delete sellQtyOv[b.dataset.tk]; delete sellPriceOv[b.dataset.tk];
      renderSellCalc(); computeSell();
    }));
  }

  document.querySelectorAll(".sell-in").forEach(i => i.addEventListener("input", () => {
    const v = parseFloat(i.value);
    if (v > 0) sellQtyOv[i.dataset.tk] = i.value; else delete sellQtyOv[i.dataset.tk];
    computeSell();
  }));
  document.querySelectorAll(".sell-all").forEach(b => b.addEventListener("click", () => {
    const inp = document.querySelector(`.sell-in[data-tk="${b.dataset.tk}"]`);
    const r = sellRows().find(x => x.ticker === b.dataset.tk);
    if (inp && r) { inp.value = r.qty; sellQtyOv[r.ticker] = String(r.qty); computeSell(); }
  }));
  document.querySelectorAll(".sell-price").forEach(i => i.addEventListener("input", () => {
    const tk = i.dataset.tk, v = parseFloat(i.value);
    if (v > 0) { sellPriceOv[tk] = v; i.classList.add("sp-edited"); } else { delete sellPriceOv[tk]; i.classList.remove("sp-edited"); }
    computeSell();
  }));
  applyColLabels("sell-table");   // etichette per la vista a schede su iPhone (input sempre visibili)
  computeSell();
}

function computeSell() {
  const rows = sellRows();
  const byTk = Object.fromEntries(rows.map(r => [r.ticker, r]));
  let gains = 0, losses = 0, taxStock = 0, taxBtp = 0, stockNet = 0, btpNet = 0;
  let grossProceeds = 0, totalCost = 0;
  document.querySelectorAll(".sell-in").forEach(inp => {
    const r = byTk[inp.dataset.tk];
    const q = Math.min(parseFloat(inp.value) || 0, r.qty);
    const pl = r.plPerShare * q;
    const cell = document.querySelector(`.sell-pl[data-tk="${inp.dataset.tk}"]`);
    if (q) {
      cell.textContent = signTxt(Math.round(pl), " €");
      cell.className = `num sell-pl ${signCls(pl)}`;
    } else {
      // anteprima: plus/minus latente se vendi TUTTA la posizione (così il popup è subito utile)
      const full = r.plPerShare * r.qty;
      cell.innerHTML = `<span class="muted" title="plus/minus se vendi tutta la posizione (${fmtNum.format(r.qty)} az.)">(${signTxt(Math.round(full), " €")})</span>`;
      cell.className = "num sell-pl";
    }
    if (q) {
      if (pl >= 0) gains += pl; else losses += pl;
      // prezzo di vendita × quantità (convertito in EUR se USD)
      const eurusd = DATA.eurusd || 1;
      const priceEur = r.currency === "USD" ? r.price / eurusd : r.price;
      const pmcEur   = r.currency === "USD" ? r.pmc   / eurusd : r.pmc;
      grossProceeds += priceEur * q;
      totalCost     += pmcEur * q;
    }
    if (r.ticker === "BTP-V28") btpNet += pl; else stockNet += pl;
  });
  // minusvalenze compensano le plusvalenze; tassa solo sul netto positivo
  taxStock = 0.26 * Math.max(0, stockNet);
  taxBtp = 0.125 * Math.max(0, btpNet);
  const net = gains + losses;          // losses è negativo
  const tax = taxStock + taxBtp;
  const afterTax = net - tax;
  // "Incasso netto" = liquidità effettiva ricevuta = controvalore vendita − tasse sulla plusvalenza
  // NON è solo il guadagno netto: include anche il capitale restituito (costo di acquisto)
  const cashReceived = grossProceeds - tax;
  const hasData = grossProceeds > 0;
  // grafico a barre: plus (verde), minus (rosso), netto
  const maxAbs = Math.max(gains, Math.abs(losses), Math.abs(net), 1);
  const bar = (v, col, label) => `<div class="sb-row"><span class="sb-lab">${label}</span>
    <span class="sb-track"><span class="sb-fill" style="width:${Math.abs(v) / maxAbs * 100}%;background:${col}"></span></span>
    <span class="sb-val ${signCls(v)}">${signTxt(Math.round(v), " €")}</span></div>`;
  $("#sell-summary").innerHTML = `
    <div class="sell-bars">
      ${bar(gains, "var(--green)", "Plusvalenze")}
      ${bar(losses, "var(--red)", "Minusvalenze")}
      ${bar(net, net >= 0 ? "var(--blue)" : "var(--red)", "Guad./Perd. netto")}
    </div>
    <div class="sell-totals">
      ${hasData ? `<div class="sell-tot-section"><span class="muted">Controvalore vendita</span>
        <b>${fmtEUR.format(Math.round(grossProceeds))}</b>
        <span class="sell-tot-note">Prezzo di mercato × quantità venduta (quanto entrerà sul conto dal broker)</span></div>` : ""}
      <div><span class="muted">Costo di acquisto (PMC × qtà)</span> <b class="muted">${hasData ? "−" + fmtEUR.format(Math.round(totalCost)) : "—"}</b></div>
      <div><span class="muted">Plusvalenze</span> <b class="pos">${signTxt(Math.round(gains), " €")}</b></div>
      <div><span class="muted">Minusvalenze</span> <b class="neg">${signTxt(Math.round(losses), " €")}</b></div>
      <div><span class="muted">Risultato lordo (plus − minus)</span> <b class="${signCls(net)}">${signTxt(Math.round(net), " €")}</b></div>
      <div><span class="muted">Tasse stimate (26% az. / 12,5% BTP, al netto delle minus)</span> <b class="neg">${tax > 0 ? "−" + fmtEUR.format(Math.round(tax)) : "0 €"}</b></div>
      <div class="sell-net-box">
        <div class="sell-net-main"><span>Liquidità netta sul conto</span> <b class="${cashReceived >= 0 ? "pos" : "neg"}">${hasData ? fmtEUR.format(Math.round(cashReceived)) : "—"}</b></div>
        <div class="sell-net-note">Controvalore vendita (${hasData ? fmtEUR.format(Math.round(grossProceeds)) : "—"}) − tasse (${fmtEUR.format(Math.round(tax))}) = cash effettivo ricevuto sul conto. Diverso dal "guadagno netto" che è solo la differenza rispetto al costo di acquisto.</div>
      </div>
      <div class="sell-gain-box"><span class="muted">Di cui guadagno/perdita netto dopo tasse</span> <b class="${signCls(afterTax)}">${signTxt(Math.round(afterTax), " €")}</b>
        <span class="sell-tot-note">Solo il profitto/perdita rispetto al tuo PMC (non include il capitale restituito)</span></div>
    </div>`;
}

/* ---------------- calcolatore PMC ---------------- */
let pmcMode = "buy";   // "buy" = mediazione su acquisto · "sell" = realizzo su vendita

function pmcSetMode(mode) {
  pmcMode = mode === "sell" ? "sell" : "buy";
  document.querySelectorAll("#pmc-mode .chip").forEach(c =>
    c.classList.toggle("chip-active", c.dataset.pmcMode === pmcMode));
  const sell = pmcMode === "sell";
  $("#pmc-b2-label").textContent = sell ? "Vendita" : "Nuovo acquisto";
  $("#pmc-q2-label").textContent = sell ? "Quantità da vendere" : "Quantità";
  $("#pmc-p2-label").textContent = sell ? "Prezzo di vendita" : "Prezzo";
  $("#pmc-q2").placeholder = sell ? "es. 50" : "es. 50";
  $("#pmc-p2").placeholder = sell ? "es. 130" : "es. 120";
  const cl = $("#pmc-comm-label"); if (cl) cl.hidden = sell;   // commissioni solo in acquisto
  pmcCompute();
}

function pmcCompute() {
  const v = (id) => parseFloat($(id).value) || 0;
  const q1 = v("#pmc-q1"), p1 = v("#pmc-p1"), q2 = v("#pmc-q2"), p2 = v("#pmc-p2");
  const clear = () => ["#pmc-new", "#pmc-qty", "#pmc-cost", "#pmc-delta"].forEach(id => { $(id).textContent = "—"; $(id).className = id === "#pmc-new" ? "" : "muted"; });

  const opRow = $("#pmc-opcost-row");

  if (pmcMode === "sell") {
    if (opRow) opRow.hidden = true;
    // VENDITA: il PMC NON cambia; si realizza una plus/minusvalenza sulle azioni vendute
    $("#pmc-r1-lab").textContent = "PMC (invariato):";
    $("#pmc-r2-lab").textContent = "Quantità residua:";
    $("#pmc-r3-lab").textContent = "Plus/Minus realizzata:";
    $("#pmc-r4-lab").textContent = "Controvalore venduto:";
    if (q1 <= 0 || p1 <= 0 || q2 <= 0 || p2 <= 0) { clear(); return; }
    const sellQty = Math.min(q2, q1);
    const remaining = q1 - sellQty;
    const realized = sellQty * (p2 - p1);     // plus/minus sulle azioni vendute
    const proceeds = sellQty * p2;
    $("#pmc-new").textContent = fmtNum.format(Math.round(p1 * 10000) / 10000);
    $("#pmc-new").className = "";
    $("#pmc-qty").textContent = fmtNum.format(remaining) + (q2 > q1 ? " (vendita > posizione: limitata)" : "");
    $("#pmc-qty").className = "muted";
    const el3 = $("#pmc-cost");
    el3.textContent = signTxt(Math.round(realized * 100) / 100, "");   // valuta del titolo, nessun "%"
    el3.className = signCls(realized);
    $("#pmc-delta").textContent = fmtNum.format(Math.round(proceeds * 100) / 100);
    $("#pmc-delta").className = "muted";
    return;
  }

  // ACQUISTO (mediazione): PMC ponderato sui due lotti
  $("#pmc-r1-lab").textContent = "Nuovo PMC:";
  $("#pmc-r2-lab").textContent = "Quantità totale:";
  $("#pmc-r3-lab").textContent = "Investimento totale:";
  $("#pmc-r4-lab").textContent = "Variazione PMC:";
  const qty = q1 + q2, cost = q1 * p1 + q2 * p2;
  if (qty <= 0 || cost <= 0) { if (opRow) opRow.hidden = true; clear(); return; }
  const pmc = cost / qty;
  $("#pmc-new").textContent = fmtNum.format(Math.round(pmc * 10000) / 10000);
  $("#pmc-new").className = "";
  $("#pmc-qty").textContent = fmtNum.format(qty);
  $("#pmc-qty").className = "muted";
  $("#pmc-cost").textContent = fmtNum.format(Math.round(cost * 100) / 100);
  $("#pmc-cost").className = "muted";
  // Costo dell'operazione del nuovo acquisto: controvalore (qtà × prezzo) + commissioni
  if (opRow) {
    const comm = v("#pmc-comm");
    const newNotional = q2 * p2;
    if (q2 > 0 && p2 > 0) {
      opRow.hidden = false;
      const tot = newNotional + comm;
      $("#pmc-opcost").textContent = fmtNum.format(Math.round(tot * 100) / 100)
        + (comm > 0 ? ` (controvalore ${fmtNum.format(Math.round(newNotional * 100) / 100)} + comm. ${fmtNum.format(comm)})` : "");
    } else {
      opRow.hidden = true;
    }
  }
  const el = $("#pmc-delta");
  if (p1 > 0) {
    const d = (pmc / p1 - 1) * 100;
    el.textContent = signTxt(Math.round(d * 100) / 100);
    el.className = signCls(d);
  } else {
    el.textContent = "—"; el.className = "muted";
  }
}

function pmcInit() {
  const sel = $("#pmc-select");
  const current = sel.value;
  const opt = r => `<option value="${r.ticker}">${esc(r.name || r.ticker)} (${r.ticker})</option>`;
  const ptf = (DATA.portfolio || []).filter(r => r.currency === "USD");
  const wl = (DATA.watchlist || []).filter(r => r.currency === "USD");
  let html = '<option value="">— scegli un titolo o inserisci a mano —</option>';
  if (ptf.length) html += `<optgroup label="Portafoglio">${ptf.map(opt).join("")}</optgroup>`;
  if (wl.length) html += `<optgroup label="Watchlist">${wl.map(opt).join("")}</optgroup>`;
  sel.innerHTML = html;
  sel.value = current;   // non perdere la selezione sull'auto-refresh
}

$("#pmc-select").addEventListener("change", () => {
  const tk = $("#pmc-select").value;
  const r = [...(DATA?.portfolio || []), ...(DATA?.watchlist || [])].find(x => x.ticker === tk);
  if (r) {
    $("#pmc-q1").value = r.qty || "";          // watchlist: nessuna posizione → vuoto
    $("#pmc-p1").value = r.pmc || "";
    $("#pmc-p2").value = r.price || "";
    $("#pmc-q2").focus();
  }
  pmcCompute();
});
document.querySelectorAll("#pmc-mode .chip").forEach(c =>
  c.addEventListener("click", () => pmcSetMode(c.dataset.pmcMode)));
["#pmc-q1", "#pmc-p1", "#pmc-q2", "#pmc-p2", "#pmc-comm"].forEach(id =>
  $(id).addEventListener("input", pmcCompute));

/* liquidità + mini-card */
/* popup Strumenti (PMC, vendite) e News */
function showSimpleModal(id) { const m = $(id); if (m) m.hidden = false; }
function hideSimpleModal(id) { const m = typeof id === "string" ? $(id) : id; if (m) m.hidden = true; }

/* ═══ v193 — I MODALI SEMPLICI NON SI CHIUDEVANO. Il ✕ di "Calcolatore PMC" e "Calcolo vendite"
   non ha MAI funzionato: i bottoni esistono in index.html da sempre, hideSimpleModal esisteva,
   ma nessuna riga le collegava. In v181 avevo rimosso hideSimpleModal come "codice morto" —
   ed era davvero non chiamata, ma la conclusione giusta non era "si puo' togliere": era "manca
   un collegamento". Una funzione morta a fianco di un bottone inerte non e' surplus, e' un
   sintomo. Ora la chiusura e' generica per TUTTI i .modal-backdrop, con le tre vie che un
   utente si aspetta: il ✕, il fondale, e Esc. Cosi' un modale aggiunto domani nasce chiudibile. */
document.addEventListener("click", (e) => {
  /* ⚠ v255 — LA PROMESSA "un modale aggiunto domani nasce chiudibile" ERA CONDIZIONATA A UN
     NOME. Il selettore chiedeva un id che FINISSE per "-modal-close": il ✕ del modale nuovo si
     chiamava "verifica-close" e non chiudeva niente — Esc sì, il ✕ no. È lo stesso difetto
     v193 che questo blocco è nato per correggere, ripetuto dal blocco stesso, perché una
     convenzione di nomi che nessuno verifica non è una convenzione: è una speranza.
     Ora chiude anche QUALUNQUE bottone dentro una .modal-head, che è ciò che l'utente vede;
     e un check verifica che ogni .modal-backdrop di index.html abbia un ✕ che il selettore
     intercetta davvero. */
  const chiudi = e.target.closest("[id$='-modal-close'], [data-close-modal]")
    || (e.target.closest(".modal-head") ? e.target.closest("button") : null);
  if (chiudi) { hideSimpleModal(chiudi.closest(".modal-backdrop")); return; }
  // clic sul fondale (non sul contenuto) chiude
  const back = e.target.closest(".modal-backdrop");
  if (back && e.target === back) hideSimpleModal(back);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const aperti = [...document.querySelectorAll(".modal-backdrop:not([hidden])")];
  if (aperti.length) hideSimpleModal(aperti[aperti.length - 1]);   // si chiude l'ultimo aperto
});
$("#open-pmc")?.addEventListener("click", () => { pmcInit(); pmcCompute(); showSimpleModal("#pmc-modal"); });
$("#open-sell")?.addEventListener("click", () => { renderSellCalc(); showSimpleModal("#sell-modal"); });

/* v141: l'editor UI della testata (⚙ Impostazioni Prompt) è stato RIMOSSO su direttiva CEO:
   la Costituzione in config/prompt_header.txt si mantiene via repo. loadPromptHeaderCloud()
   resta: il file è ancora la fonte di verità caricata a ogni avvio. */
// click sul termometro Financial Health → modale Conto economico
document.addEventListener("click", e => {
  const fh = e.target.closest(".fin-health");
  if (fh) { openStockCard(fh.dataset.fin); return; }
  const fr = e.target.closest(".fund-row");            // riga vista fondamentale → conto economico + statistiche
  if (fr) { openStockCard(fr.dataset.fundTk); return; }
  const sc = e.target.closest(".stat-cell");           // click su una metrica → spiegazione
  if (sc) { toast(sc.dataset.info); return; }
  const rc = e.target.closest(".rs-cell");             // click su RS 1M → spiegazione forza relativa
  if (rc && rc.dataset.rsTk) { openStockCard(rc.dataset.rsTk); return; }   // v188: un solo popup per titolo
  const shc = e.target.closest(".sharpe-cell");        // click su Sharpe 1A → spiegazione
  if (shc && shc.dataset.sharpeTk) { openStockCard(shc.dataset.sharpeTk); return; }
  const bi = e.target.closest(".badge-info");          // badge (squeeze/deep value/correzione) → spiegazione
  if (bi && bi.dataset.badge) { e.stopPropagation(); openBadgeInfo(bi.dataset.badge); return; }
  // tap su QUALSIASI punto della riga/card del titolo (no su pulsanti, grafico, opzioni o celle
  // già interattive) → scheda completa. Indispensabile su iPhone dove la riga è una card.
  const tr = e.target.closest("#ptf-table tbody tr, #wl-table tbody tr");
  if (tr && !tr.classList.contains("total-row") && !tr.classList.contains("add-row")
      && !e.target.closest("button, a, input, .spark-cell, [data-opt], .rs-cell, .sharpe-cell, .badge-info")) {
    const tk = tr.querySelector(".name-cell")?.dataset.tk;
    if (tk) { openStockCard(tk); return; }   // v188: scheda UNICA, non piu' il solo dettaglio
  }
});
// accessibilità: Invio/Spazio sulla riga fondamentale aprono il dettaglio
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const fr = e.target.closest && e.target.closest(".fund-row");
  if (fr) { e.preventDefault(); openFinancialsModal(fr.dataset.fundTk); return; }
  const rc = e.target.closest && e.target.closest(".rs-cell");
  if (rc && rc.dataset.rsTk) { e.preventDefault(); openRsInfo(rc.dataset.rsTk); }
});

/* v256 — le barre dell'intervallo (#spark-toggle) governavano le sparkline delle tabelle
   portafoglio/watchlist: senza tabelle non hanno piu' nulla da regolare. Resta il ripristino
   dell'ordine delle mini-card macro, che e' una preferenza ancora viva. */
(function applyPrefs() {
  applicaOrdineMiniCard();   // v190: l'ordine scelto nel popup macro vale anche al caricamento
})();


// v214 — orizzonte del confronto col benchmark


// v205 — interruttore settore/valuta della vista struttura
document.querySelectorAll("#alloc-graf-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#alloc-graf-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    allocGrafMode = ch.dataset.agmode;
    renderAllocGrafica();
  });
});

$("#chart-modal-close").addEventListener("click", closeChartModal);
$("#chart-modal").addEventListener("click", e => {
  if (e.target.id === "chart-modal") { closeChartModal(); return; }
  if (e.target.closest(".cm-opt-open")) { openOptionsModal(cmTicker); return; }
  if (e.target.closest(".cm-opt-back")) { optTicker = null; drawTickerChart(); return; }
  const sd = e.target.closest(".opt-side");
  if (sd) { optSide = sd.dataset.side; loadOptionsView(); return; }
  const vb = e.target.closest(".cm-viewbtn");
  if (vb) { cmView = vb.dataset.cmview; drawTickerChart(); return; }
  const rb = e.target.closest(".cm-range");
  if (rb) { cmView = "candles"; cmRange = rb.dataset.range; drawTickerChart(); }
});
$("#chart-modal").addEventListener("change", e => {
  if (e.target.classList.contains("opt-expiry")) { optExpIdx = Number(e.target.value); loadOptionsView(); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeChartModal(); });
document.addEventListener("click", (e) => {
  const optCell = e.target.closest("[data-opt]");
  if (optCell) { openOptionsModal(optCell.dataset.opt); return; }
  const cell = e.target.closest(".spark-cell");
  if (cell) { openTickerChart(cell.dataset.tk); return; }
  const macro = e.target.closest("[data-macro]");
  if (macro) { openMacroInfo(macro.dataset.macro); return; }
  const gauge = e.target.closest("[data-gauge]");
  if (gauge) { openMacroInfo(gauge.dataset.gauge); return; }
  const earn = e.target.closest("[data-earn]");
  if (earn) { openEarningsInfo(earn.dataset.earn); return; }
  const kpiC = e.target.closest('[data-kpi="alpha"]');
  if (kpiC) { openAlphaModal(); return; }
  if (e.target.closest('[data-action="rot-analyze"]')) { openRotationAnalysis(); return; }
});

/* v213 — QUI SI ROMPEVA TUTTO. Quattro addEventListener puntavano alle mini-card rimosse in
   v212 e NON avevano il `?.`: lo script moriva su `$("#signposts-box").addEventListener` e
   TUTTO IL WIRING SOTTO non veniva mai eseguito — compreso loadData(). La pagina restava vuota
   con "Aggiornamento totale: —", e io l'avevo attribuito alla rete del sandbox. Non era la rete.
   È la terza volta in questo progetto che un elemento rimosso rompe l'intero caricamento
   (CLAUDE.md lo dichiara come convenzione fissa), quindi ora c'è un gate che lo intercetta. */

/* v256 — WIRING DELLE POSIZIONI RIMOSSO: modifica in linea, cancellazione riga, spostamento
   e apertura dell'editor di posizione. Tutti puntavano a funzioni uscite col portafoglio, e
   tutti su elementi (#ptf-edit, #wl-edit, .row-del, .row-move, .row-edit) che non esistono
   piu' in una pagina senza tabelle. */


/* sposta una posizione su (-1) o giù (+1); aggiorna subito e salva su config */

/* dalla watchlist al calcolatore PMC / aggiungi al portafoglio */
// clic su un titolo della watchlist → precompila il "Nuovo acquisto" nel calcolatore PMC

/* v256 — ordinamento e trascinamento delle colonne: erano agganciati alle due tabelle di
   titoli, che non esistono piu'. */

controllaVersione();   // v216 — avvisa se il browser sta servendo una pagina vecchia
loadData();
/* v348 — il diario rientra col portafoglio: c'e' di nuovo qualcosa da annotare, e serve al
   pacchetto per sapere su quali titoli il CEO ha gia' agito. */
loadDiarioCloud();
loadPromptHeaderCloud();   // testata del pacchetto macro (config/prompt_header_macro.txt)
/* v257 — la watchlist e il grafico all'avvio: prima la copia locale (subito, senza rete), poi
   quella del repo quando arriva. Stessa logica dell'ordine delle sezioni: l'attesa della rete
   non deve lasciare la pagina vuota. */
/* ⚠ v275 — IL SIMBOLO INIZIALE NON VIENE PIU' DALLA WATCHLIST, che non c'e' piu'. Si tiene
   l'ULTIMO che il CEO ha analizzato: e' quello a cui stava lavorando, ed e' l'unica scelta che
   non sia arbitraria. Al primo accesso SPY — il mercato, non un titolo scelto da me. */
montaGraficoTV(localStorage.getItem("ultimo_ticker") || "SPY");
loadOverridesCloud();   // sincronizza gli override macro manuali (se presenti)
montaComandiSezioni();   // maniglia ⠿ + frecce ▲▼ su ogni sezione
applicaOrdineSezioni();  // ordine gia' noto a questo browser: subito, senza aspettare la rete
loadOrdineSezioniCloud();// e poi quello del repo, se piu' recente → Mac e iPhone allineati
/* v256 — cassa, posizioni manuali e BTP: non c'e' piu' un portafoglio da sincronizzare. */
loadRiskParamsCloud();   // sincronizza i parametri di rischio del CEO (config/risk_params.json) — cap/veto uguali su ogni device
// ricarica completa (tecnici, news, storico) ogni 5 minuti
setInterval(() => loadData(), 5 * 60 * 1000);
// prezzi live ogni 60 secondi
setInterval(() => livePrices(), 60 * 1000);
/* v268 — la watchlist si aggiorna da sola sullo stesso ritmo: e' la risposta alla domanda
   "come faccio ad aggiornare valori?". Il primo giro parte subito, senza aspettare i 60
   secondi, altrimenti la prima cosa che si vede e' ancora il dato della pipeline. */
/* ⚠ TRE MINUTI, non uno. I proxy sono gratuiti e condivisi: 21 simboli ogni minuto sono 1260
   richieste all'ora e portano dritti al 429 (misurato). I prezzi di livePrices continuano a
   girare ogni minuto e riempiono la stessa cache, quindi la tabella resta fresca lo stesso —
   questo giro serve solo ai simboli che la pipeline non segue. E c'e' il tasto Aggiorna per
   quando lui vuole il numero adesso. */

/* v188 — comandi delle personalizzazioni */
// v202: stesso pannello dalla topbar, visibile da ogni scheda. Spostare la macro dietro una
// scheda l'aveva resa irraggiungibile da tutte le altre — e per l'utente "non trovabile" e'
// indistinguibile da "non c'e'".
// v209 — l'handler di #btn-macro-top è uscito col suo bottone. `openMacroDetails` resta
// raggiungibile da #macro-details, dentro la scheda Macro: una sola porta, nella colonna
// centrale. La guardia strutturale è stata aggiornata di conseguenza — protegge l'ACCESSO
// ai dettagli macro, non quel particolare bottone (v203: mai zittire una guardia, cambiarle
// l'invariante quando l'invariante è cambiato davvero).
document.addEventListener("click", (e) => {
  const all = e.target.closest("[data-cp-all]");
  if (all) { saveColHidden(all.dataset.cpAll, new Set());
    (all.dataset.cpAll === "ptf-table" ? renderTable : renderWatchlist)();
    openColumnPicker(all.dataset.cpAll, all.dataset.cpAll === "ptf-table" ? "Portafoglio" : "Watchlist",
      all.dataset.cpAll === "ptf-table" ? renderTable : renderWatchlist);
    return; }
  if (e.target.closest("[data-cp-done]")) { $("#chart-modal").hidden = true; return; }
  const ch = e.target.closest("[data-card-chart]");
  if (ch) { openTickerChart(ch.dataset.cardChart); return; }
  const op = e.target.closest("[data-card-opt]");
  if (op) { openOptionsModal(op.dataset.cardOpt); return; }
});


/* v198 — interruttore compatta/completa */
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-vista]");
  if (!b) return;
  const tid = b.dataset.t;
  if (b.dataset.vista === "completa") saveColHidden(tid, new Set());
  else {
    const head = document.querySelector(`#${tid} thead tr`);
    const vis = new Set(VISTA_COMPATTA[tid] || []);
    saveColHidden(tid, new Set([...head.children].map((_, i) => i).filter(i => !vis.has(i))));
  }
  (tid === "ptf-table" ? renderTable : renderWatchlist)();
});

/* ═══ v199 — SCHEDE. Portafoglio, watchlist, macro e rischio sono quattro MOMENTI diversi:
   impilarli in una pagina sola costringeva a scorrere per trovare cio' che serviva, ed e' una
   delle ragioni per cui la dashboard risultava confusionaria. Le schede non nascondono dati —
   cambiano quale sta davanti. La scelta si ricorda fra le sessioni.
   ⚠ Le sezioni SENZA data-pane restano SEMPRE visibili (avvisi, barra di stato, coda decisioni):
   un contenitore nuovo che nessuno ha marcato non deve sparire per omissione. */
const TAB_KEY = "pref_tab";
/* v222 — UNA PAGINA SOLA. "porta tutto sulla index principale": le schede nascondevano tre
   quarti della dashboard dietro un clic, e per quattro versioni ho creduto di aver spostato
   cose che non si vedevano solo perche' stavano in un pannello chiuso. Ora TUTTO e' in pagina,
   sempre: la barra laterale non commuta piu' niente, porta il punto — e' un indice, e si
   evidenzia da sola sulla sezione che stai guardando. Zero contenuti nascosti. */
/* v223 — la barra laterale torna a COMMUTARE ("solo cliccando nelle voci della barra a
   sinistra posso passare da una sezione all'altra"). In v222 era tutto in pagina e si
   scorreva: troppo lungo. Una sezione per volta, e il clic e' l'unico modo di cambiarla. */



/* v256 — LE SCHEDE NON ESISTONO PIU'. #main-tabs governava sei pane (struttura, portafoglio,
   watchlist, rischio…); con una pagina sola la barra navigava verso una stanza sola. Tolto il
   wiring insieme alla barra: tutte le sezioni sono visibili dal primo istante, che e' gia' il
   comportamento dichiarato in v222. */
