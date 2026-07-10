/* Trading Dashboard — rendering lato client di data/data.json */
const REPO = "Oigres85/Trading";
let DATA = null;
let sparkRange = localStorage.getItem("pref_range") || "m1";   // 1G | 1M | 1A (preferenza ricordata)

/* ordinamento tabelle: click su intestazione → desc → asc → default */
const SORT_FIELDS = {
  // allineato 1:1 alle <th>: Titolo,Qtà,PMC,Prezzo,Oggi,Pre/After,Volume,Guadagno,Guad.%,
  // Beta,Sharpe 1A,Sortino 1A,Supporto,Resistenza,Δ SMA200,RS 1M,RS NDX 1M,Segnale,Short %,
  // Drawdown 52S,Opzioni,Trimestrale,Grafico
  "ptf-table": ["name", "qty", "pmc", "price", "change_pct", "prepost_chg", "volume",
                "gain", "gain_pct", "beta", "sharpe_1y", "sortino_1y", "support",
                "resistance", "sma200_dist_pct", "rs_1m", "rs_ndx_1m", null,
                "stat:short_float", "stat:float_shares", "w52_dist_pct", null, "earnings_date", null],
  // Titolo,Prezzo,Oggi,Pre/After,Volume,Beta,Sharpe 1A,Sortino 1A,Supporto,Resistenza,Δ SMA200,
  // RS 1M,RS NDX 1M,Segnale,Short %,Drawdown 52S,Opzioni,Trimestrale,Grafico
  "wl-table": ["name", "price", "change_pct", "prepost_chg", "volume",
               "beta", "sharpe_1y", "sortino_1y", "support", "resistance", "sma200_dist_pct",
               "rs_1m", "rs_ndx_1m", null,
               "stat:short_float", "stat:float_shares", "w52_dist_pct", null, "earnings_date", null],
  // tabelle fondamentali (vista Value); allineate 1:1 alle colonne:
  // MarketCap, P/E, EV/EBITDA, ROE, Margine, P/FCF, Crescita, D/E, Div, PEG, Z-Score, FinHealth, TargetΔ
  "ptf-fund-table": ["name", "qty", "pmc", "price", "stat:market_cap", "pe", "stat:ev_ebitda",
                     "stat:roe", "stat:profit_margin", "pfcf", "stat:revenue_growth",
                     "stat:debt_to_equity", "stat:dividend_yield", "stat:peg", "stat:altman_z", "fin_health", "upside_pct"],
  "wl-fund-table": ["name", "price", "stat:market_cap", "pe", "stat:ev_ebitda",
                    "stat:roe", "stat:profit_margin", "pfcf", "stat:revenue_growth",
                    "stat:debt_to_equity", "stat:dividend_yield", "stat:peg", "stat:altman_z", "fin_health", "upside_pct"],
};
const sortState = {
  "ptf-table": { field: null, dir: 0 }, "wl-table": { field: null, dir: 0 },
  "ptf-fund-table": { field: null, dir: 0 }, "wl-fund-table": { field: null, dir: 0 },
};

function sortVal(r, field) {
  if (field === "prepost_chg") return r.prepost?.change_pct ?? null;
  if (field === "upside_pct") return r.rating?.upside_pct ?? null;
  if (field === "pfcf") {                    // P/FCF calcolato al volo
    const st = r.stats || {};
    return (st.market_cap && st.fcf) ? st.market_cap / st.fcf : null;
  }
  if (field && field.startsWith("stat:")) return r.stats?.[field.slice(5)] ?? null;
  return r[field] ?? null;
}

function sortRows(rows, tableId) {
  const { field, dir } = sortState[tableId];
  if (!field || !dir) return rows;
  return [...rows].sort((a, b) => {
    const va = sortVal(a, field), vb = sortVal(b, field);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;          // i valori mancanti sempre in fondo
    if (vb === null) return -1;
    if (typeof va === "string") return dir === 1 ? vb.localeCompare(va) : va.localeCompare(vb);
    return dir === 1 ? vb - va : va - vb;
  });
}

function updateSortArrows(tableId) {
  const { field, dir } = sortState[tableId];
  document.querySelectorAll(`#${tableId} thead th`).forEach((th, i) => {
    th.querySelector(".sort-arrow")?.remove();
    const f = SORT_FIELDS[tableId][i];
    if (f && f === field && dir) {
      const s = document.createElement("span");
      s.className = "sort-arrow";
      s.textContent = dir === 1 ? " ▼" : " ▲";
      th.appendChild(s);
    }
  });
}

function initSorting(tableId, rerender) {
  document.querySelectorAll(`#${tableId} thead th`).forEach((th, i) => {
    const f = SORT_FIELDS[tableId][i];
    if (!f) return;
    th.classList.add("sortable");
    th.addEventListener("click", () => {
      const st = sortState[tableId];
      if (st.field !== f) { st.field = f; st.dir = 1; }
      else st.dir = (st.dir + 1) % 3;     // desc → asc → default
      if (!st.dir) st.field = null;
      rerender();
      updateSortArrows(tableId);
    });
  });
}

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
function priceTxt(r, c) { return r.price == null ? "…" : (c ?? cur(r)) + fmtNum.format(r.price); }
function signCls(v) { return v > 0 ? "pos" : v < 0 ? "neg" : ""; }
function signTxt(v, suffix = "%") {
  if (v === null || v === undefined) return "—";
  return (v > 0 ? "+" : "") + fmtNum.format(v) + suffix;
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
    mergeManualHoldings();        // reintegra le posizioni aggiunte a mano (localStorage)
    applyMacroOverrides();        // correzioni manuali dei dati macro flaggati (decadono da sole)
    renderAll();
    livePrices();
    if (showSpin) toast("Dati ricaricati ✓");
  } catch (e) {
    console.error(e);
    // se non ho mai caricato dati, mostro un avviso invece di una pagina vuota
    if (!DATA) {
      const el = $("#earnings-alert");
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
      const d = await fetchData();
      if (d.updated_at !== prev) { DATA = d; renderAll(); return true; }
    } catch { /* riprova */ }
  }
  return false;
}

/* ---- Barra di avanzamento dell'aggiornamento (la pipeline è lenta: feedback continuo) ---- */
let _refreshTimer = null;
const REFRESH_STAGES = [
  [0,  "Avvio pipeline su GitHub Actions…"],
  [12, "Download prezzi e fondamentali (Yahoo Finance)…"],
  [32, "Elaborazione indici, macro e rotazione settoriale…"],
  [52, "Calcolo Sharpe Ratio, opzioni e SMC…"],
  [72, "Generazione e validazione data.json…"],
  [88, "Quasi pronto, attendo la pubblicazione…"],
];
const PRICE_STAGES = [
  [0,  "Scarico i prezzi live (Yahoo)…"],
  [45, "Aggiorno controvalori e P&L…"],
  [75, "Quasi pronto…"],
];
function showRefreshProgress(est = 150000, stages = REFRESH_STAGES) {
  hideRefreshProgress();
  const el = document.createElement("div");
  el.id = "refresh-progress";
  el.className = "refresh-progress";
  el.innerHTML = `
    <div class="rp-row"><span class="rp-spin"></span><span class="rp-msg" id="rp-msg">Avvio aggiornamento…</span><span class="rp-pct" id="rp-pct">0%</span></div>
    <div class="rp-track"><div class="rp-fill" id="rp-fill" style="width:0%"></div></div>`;
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
  if (msg) { const m = document.getElementById("rp-msg"); if (m) m.textContent = msg; }
}
function finishRefreshProgress(ok) {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  setRefreshProgress(100, ok ? "Aggiornamento completato ✓" : "Tempo scaduto — i dati potrebbero arrivare a breve");
  setTimeout(hideRefreshProgress, ok ? 1200 : 2500);
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
    if (res.status !== 204) { toast(`Errore avvio aggiornamento (HTTP ${res.status})`); return; }
    showRefreshProgress();
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

async function editHoldings(section, mutate) {
  const token = getToken();
  if (!token) { toast("Serve un token GitHub (permessi Actions + Contents) per modificare le posizioni"); return; }
  toast("Salvo la modifica…");
  try {
    // 1) leggi config/holdings.json con il suo SHA
    const path = "config/holdings.json";
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: ghHeaders(token), cache: "no-store" });
    if (!r.ok) {
      if ([401, 403].includes(r.status)) { localStorage.removeItem("gh_token"); toast("Token senza permesso Contents/Actions — rimosso. Creane uno con quei permessi e riprova"); }
      else if (r.status === 404) { toast("config/holdings.json non trovato sul repo"); }
      else toast(`Errore lettura config (HTTP ${r.status})`);
      return;
    }
    const file = await r.json();
    const cfg = JSON.parse(decodeURIComponent(escape(atob((file.content || "").replace(/\s/g, "")))));
    if (!mutate(cfg)) return;                 // mutate ritorna false se annullato/invalido
    // 2) scrivi il nuovo config
    const body = {
      message: `Aggiorna posizioni (${section})`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(cfg, null, 1)))),
      sha: file.sha,
    };
    const put = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      method: "PUT", headers: ghHeaders(token), body: JSON.stringify(body),
    });
    if (!put.ok) { toast(`Errore salvataggio (HTTP ${put.status})`); return; }
    // 3) rigenera i dati in background (NON blocca la UI: la modifica è già visibile)
    dispatchWorkflow(token).catch(() => {});
    toast("Salvato ✓ — dati completi tra ~2-3 min");
    waitForNewData(DATA?.updated_at).then(ok => { if (ok) toast("Dati aggiornati ✓"); });
  } catch (e) {
    console.error(e);
    toast("Errore durante il salvataggio della modifica");
  }
}

/* --- posizioni aggiunte a mano: persistite in localStorage così sopravvivono al reload
   anche senza token GitHub. Quando la pipeline le include in data.json, vengono ignorate. --- */
function loadManualHoldings() {
  try { return JSON.parse(localStorage.getItem("manual_holdings") || "[]"); }
  catch { return []; }
}
function saveManualHolding(h) {
  const arr = loadManualHoldings().filter(x => x.ticker !== h.ticker);
  arr.push(h);
  localStorage.setItem("manual_holdings", JSON.stringify(arr));
}
function removeManualHolding(ticker) {
  localStorage.setItem("manual_holdings",
    JSON.stringify(loadManualHoldings().filter(x => x.ticker !== ticker)));
}
/* unisce le posizioni manuali al DATA.portfolio appena caricato da data.json */
function mergeManualHoldings() {
  try {
    if (!DATA || !Array.isArray(DATA.portfolio)) return;
    // override BTP salvato a mano (qty/PMC) — persiste tra i reload senza toccare la pipeline
    try {
      const bo = JSON.parse(localStorage.getItem("btp_override") || "null");
      const btp = bo && DATA.portfolio.find(p => p.ticker === "BTP-V28");
      if (btp) {
        if (bo.qty > 0) btp.qty = bo.qty;
        if (bo.pmc > 0) btp.pmc = bo.pmc;
        btp.bval = null; btp.bgain = null;
        if (btp.price) { btp.value = btp.qty * btp.price / 100; btp.gain = btp.value - btp.qty * btp.pmc / 100; }
      }
    } catch { /* nessun override BTP */ }
    const manual = loadManualHoldings();
    if (!manual.length) return;
    let added = false;
    manual.forEach(h => {
      const ex = DATA.portfolio.find(p => p.ticker === h.ticker);
      if (ex) {
        // le mie correzioni manuali PREVALGONO sullo snapshot (a volte stale) del broker:
        // applico qty/PMC e azzero bval/bgain così il valore si calcola dal prezzo live reale.
        if (h.qty > 0) ex.qty = h.qty;
        if (h.pmc > 0) ex.pmc = h.pmc;
        ex.bval = null; ex.bgain = null;
        if (ex.price && ex.currency === "USD") {
          ex.value = ex.price * ex.qty;
          ex.gain = ex.value - ex.pmc * ex.qty;
          ex.gain_pct = Math.round((ex.value / (ex.pmc * ex.qty) - 1) * 10000) / 100;
        }
        added = true;
        return;
      }
      const row = placeholderRow(h.ticker, h.currency || "USD", { qty: h.qty, pmc: h.pmc, name: h.name || h.ticker });
      const btpIdx = DATA.portfolio.findIndex(p => p.ticker === "BTP-V28");
      if (btpIdx >= 0) DATA.portfolio.splice(btpIdx, 0, row); else DATA.portfolio.push(row);
      fillLivePrice(row, () => { recomputeTotals(); renderKPI(); renderTable(); renderAllocation(); });
      added = true;
    });
    if (added) recomputeTotals();
  } catch (e) { console.error("mergeManualHoldings", e); }
}

function addPortfolio() {
  const ticker = (window.prompt("Ticker da aggiungere al portafoglio (es. AAPL):") || "").trim().toUpperCase();
  if (!ticker) return;
  if ((DATA.portfolio || []).some(p => p.ticker === ticker)) { toast(`${ticker} è già in portafoglio`); return; }
  const qty = parseFloat(window.prompt(`Quantità di ${ticker}:`) || "");
  const pmc = parseFloat(window.prompt(`Prezzo medio di carico (PMC) di ${ticker} in USD:`) || "");
  if (!(qty > 0) || !(pmc > 0)) { toast("Quantità/PMC non validi"); return; }
  // aggiunta ottimistica: la riga compare subito, i dati completi arrivano col workflow
  const row = placeholderRow(ticker, "USD", { qty, pmc });
  DATA.portfolio.splice(DATA.portfolio.length - 1, 0, row);   // prima del BTP
  renderTable(); recomputeTotals(); renderKPI(); renderAllocation();
  fillLivePrice(row, () => { recomputeTotals(); renderKPI(); renderTable(); renderAllocation(); });
  // persistenza locale (sopravvive al reload anche senza token)
  saveManualHolding({ ticker, name: ticker, qty, pmc, currency: "USD" });
  toast(`${ticker} aggiunto al portafoglio ✓`);
  // persistenza sul repo (se c'è un token): la pipeline rigenera i dati completi
  editHoldings("portfolio", cfg => {
    cfg.portfolio = cfg.portfolio || [];
    if (cfg.portfolio.some(p => p.ticker === ticker)) return false;
    cfg.portfolio.push({ ticker, name: ticker, qty, pmc });
    return true;
  });
}

/* Modale "Modifica valori": edita qty + PMC di ogni posizione e la liquidità in un colpo solo.
   Salva localmente (sopravvive al reload) e, se c'è un token, persiste su config/holdings.json. */
function openEditPortfolio() {
  const rows = (DATA.portfolio || []);   // include anche il BTP (modificabile)
  const body = `
    <div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">Modifica quantità e PMC di ogni posizione (BTP incluso) e la liquidità disponibile. Patrimonio, allocazione e KPI si aggiornano al salvataggio.</div>
    <div class="edp-row edp-head"><span>Titolo</span><span>Quantità</span><span>PMC</span></div>
    ${rows.map(r => `<div class="edp-row" data-edp="${r.ticker}">
      <span class="edp-tk">${esc(r.name)} <span class="tk">${r.ticker}</span></span>
      <input type="number" class="edp-qty" data-tk="${r.ticker}" value="${r.qty ?? ""}" step="any" min="0">
      <input type="number" class="edp-pmc" data-tk="${r.ticker}" value="${r.pmc ?? ""}" step="any" min="0">
    </div>`).join("")}
    <div class="edp-row edp-cash"><span>Liquidità disponibile (€)</span><input type="number" id="edp-cash" value="${cashEur || ""}" step="any" min="0"><span></span></div>
    <div class="edp-actions"><button class="btn btn-primary" id="edp-save">Salva modifiche</button>
      <span class="muted" style="font-size:11px">le variazioni sono immediate; con token GitHub vengono anche salvate sul repo</span></div>`;
  openInfoModal("Modifica valori portafoglio", body);
  $("#edp-save")?.addEventListener("click", () => {
    let changed = false;
    document.querySelectorAll(".edp-row[data-edp]").forEach(div => {
      const tk = div.dataset.edp;
      const r = DATA.portfolio.find(x => x.ticker === tk);
      if (!r) return;
      const nq = parseFloat(div.querySelector(".edp-qty").value);
      const np = parseFloat(div.querySelector(".edp-pmc").value);
      if (nq > 0 && nq !== r.qty) { r.qty = nq; changed = true; }
      if (np > 0 && np !== r.pmc) { r.pmc = np; changed = true; }
      // ricalcola valore/guadagno dal prezzo corrente (no bval snapshot: ora è una posizione editata a mano)
      if (r.price && r.currency === "USD") {
        r.bval = null; r.bgain = null;
        r.value = r.price * r.qty;
        r.gain = r.value - r.pmc * r.qty;
        r.gain_pct = Math.round((r.value / (r.pmc * r.qty) - 1) * 10000) / 100;
      } else if (r.ticker === "BTP-V28") {                   // BTP: valore = nominale × prezzo/100
        r.bval = null; r.bgain = null;
        if (r.price) {
          r.value = r.qty * r.price / 100;
          r.gain = r.value - r.qty * r.pmc / 100;
          r.gain_pct = r.pmc ? Math.round((r.price / r.pmc - 1) * 10000) / 100 : 0;
        }
        localStorage.setItem("btp_override", JSON.stringify({ qty: r.qty, pmc: r.pmc }));   // persiste tra i reload
      }
      if (r.ticker !== "BTP-V28") saveManualHolding({ ticker: tk, name: r.name, qty: r.qty, pmc: r.pmc, currency: r.currency || "USD" });
    });
    const nc = parseFloat($("#edp-cash").value) || 0;
    if (nc !== cashEur) { cashEur = nc; localStorage.setItem("cash_eur", cashEur); changed = true; }
    recomputeTotals(); renderKPI(); renderTable(); renderAllocation(); renderCash();
    closeChartModal();
    toast(changed ? "Portafoglio aggiornato ✓" : "Nessuna modifica");
    if (changed) {
      // persistenza sul repo (best-effort, se c'è un token)
      editHoldings("portfolio", cfg => {
        cfg.portfolio = (cfg.portfolio || []).map(p => {
          const r = DATA.portfolio.find(x => x.ticker === p.ticker);
          return r ? { ...p, qty: r.qty, pmc: r.pmc } : p;
        });
        return true;
      });
    }
  });
}

function addWatchlist() {
  const ticker = (window.prompt("Ticker da aggiungere alla watchlist (es. AAPL, ^GSPC, BTC-USD):") || "").trim().toUpperCase();
  if (!ticker) return;
  if ((DATA.watchlist || []).some(p => p.ticker === ticker)) { toast(`${ticker} è già in watchlist`); return; }
  const currency = ticker.startsWith("^") ? "PTS" : "USD";
  const row = placeholderRow(ticker, currency, {});
  (DATA.watchlist = DATA.watchlist || []).push(row);
  renderWatchlist(); fillLivePrice(row, renderWatchlist);
  toast(`${ticker} aggiunto ✓`);
  editHoldings("watchlist", cfg => {
    cfg.watchlist = cfg.watchlist || [];
    if (cfg.watchlist.some(p => p.ticker === ticker)) return false;
    cfg.watchlist.push({ ticker, name: null, currency });
    return true;
  });
}

// riga segnaposto finché il workflow non porta i dati tecnici completi
function placeholderRow(ticker, currency, extra) {
  // valore provvisorio = costo (PMC × qtà): rende l'allocazione subito congrua,
  // poi fillLivePrice lo raffina col prezzo reale. Evita posizioni "a 0" se il quote fallisce.
  const provValue = (currency === "USD" && extra && extra.qty && extra.pmc) ? extra.qty * extra.pmc : 0;
  return {
    ticker, name: ticker, currency, price: extra && extra.pmc || null, change_pct: null,
    value: provValue, gain: 0, gain_pct: null, pe: null, eps: null, beta: null,
    ath: null, ath_dist_pct: null, support: null, resistance: null, rsi: null,
    volume: null, vol_ratio: null, signal: "in caricamento…", signal_class: "neutral",
    sparks: {}, tech_by_range: {}, rating: null, prepost: null, stats: null,
    earnings_date: null, fin_health: null, sector: "—", _loading: true, ...extra,
  };
}

function fillLivePrice(row, after) {
  fetchQuote(row.ticker).then(q => {
    if (q) {
      row.price = Math.round(q.price * 100) / 100;
      row.change_pct = Math.round((q.price / q.prev - 1) * 10000) / 100;
      if (row.currency === "USD" && row.qty) {
        row.value = row.price * row.qty;
        row.gain = row.value - row.pmc * row.qty;
        row.gain_pct = Math.round((row.value / (row.pmc * row.qty) - 1) * 10000) / 100;
      }
    }
    row._loading = false;
    if (after) after();   // anche se il quote fallisce: l'allocazione resta congrua col valore provvisorio
  }).catch(() => { row._loading = false; if (after) after(); });
}

function removeHolding(section, ticker) {
  if (!window.confirm(`Rimuovere ${ticker} da ${section === "portfolio" ? "portafoglio" : "watchlist"}?`)) return;
  // rimozione ottimistica immediata
  DATA[section] = (DATA[section] || []).filter(p => p.ticker !== ticker);
  if (section === "portfolio") { removeManualHolding(ticker); recomputeTotals(); renderKPI(); renderTable(); renderAllocation(); }
  else renderWatchlist();
  toast(`${ticker} rimosso ✓`);
  editHoldings(section, cfg => {
    const arr = cfg[section] || [];
    const n = arr.length;
    cfg[section] = arr.filter(p => p.ticker !== ticker);
    return cfg[section].length < n;
  });
}

/* ---------------- prezzi live lato client (CORS proxy → Yahoo) ---------------- */
const CORS_PROXIES = [
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://thingproxy.freeboard.io/fetch/${u}`,
];

async function fetchQuote(symbol) {
  const yurl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  for (const make of CORS_PROXIES) {
    try {
      const r = await fetch(make(yurl), { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
      if (m && m.regularMarketPrice) {
        return { price: +m.regularMarketPrice, prev: +(m.chartPreviousClose ?? m.previousClose ?? m.regularMarketPrice) };
      }
    } catch { /* prova il proxy successivo */ }
  }
  return null;
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
  const res = await Promise.allSettled(syms.map(s => fetchQuote(s).then(q => [s, q])));
  const map = {}; let any = false;
  res.forEach(x => { if (x.status === "fulfilled" && x.value[1]) { map[x.value[0]] = x.value[1]; any = true; } });
  if (!any) return;
  const upd = (r) => {
    const q = map[r.ticker]; if (!q) return;
    r.price = Math.round(q.price * 100) / 100;
    r.change_pct = Math.round((q.price / q.prev - 1) * 10000) / 100;
    if (r.currency === "USD" && r.qty) {
      r.value = r.price * r.qty;
      r.gain = r.value - r.pmc * r.qty;
      r.gain_pct = Math.round((r.value / (r.pmc * r.qty) - 1) * 10000) / 100;
    }
  };
  DATA.portfolio.forEach(upd);
  (DATA.watchlist || []).forEach(upd);
  recomputeTotals();
  renderKPI(); renderTable(); renderWatchlist(); renderAllocation();
  const el = $("#live-badge");
  if (el) el.textContent = `Prezzi live: ${new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function renderAll() {
  const d = new Date(DATA.updated_at);
  const at = $("#updated-at");
  at.textContent = d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  // badge "dati vecchi": se il workflow non rigenera da >8 ore, avviso (la pipeline gira più volte al dì)
  const ageH = (Date.now() - d.getTime()) / 3600000;
  const upd = at.closest(".upd-item");
  if (upd) {
    upd.classList.toggle("stale", ageH > 8);
    at.title = ageH > 8 ? `Dati di ${Math.round(ageH)} ore fa — premi "↻ Rigenera tutto" per aggiornarli` : "";
    upd.querySelector(".stale-tag")?.remove();
    if (ageH > 8) { const s = document.createElement("span"); s.className = "stale-tag"; s.textContent = ` ⚠ ${Math.round(ageH)}h fa`; at.after(s); }
  }
  recomputeTotals();            // include la liquidità nei totali/allocazione
  renderCash();
  renderKPI();
  renderAllocation();
  renderEarnings();
  renderEarningsAlert();
  renderReconcileAlert();
  renderDataQualityAlert();
  renderTable();
  if (ptfView === "fund") renderFundTable();
  renderWatchlist();
  if (wlView === "fund") renderWlFundTable();
  renderGauges();
  renderMacro();
  renderPortfolioHealth();
  renderMiniCards();
  renderDecisionBar();
  renderNews();
  renderBtpInfo();
  // NON ricostruire la tabella vendite mentre il popup è aperto: l'auto-refresh (ogni 5 min)
  // azzerava gli input e chiudeva la tastiera mentre l'utente stava scrivendo
  if ($("#sell-modal")?.hidden !== false) renderSellCalc();
  pmcInit();
}

/* banner di alert: trimestrali entro 7 giorni (rischio binario) con Implied Move */
function renderEarningsAlert() {
  const box = $("#earnings-alert");
  if (!box) return;
  const all = [...DATA.portfolio, ...(DATA.watchlist || [])];
  const items = all.filter(r => r.earnings_date)
    .map(r => ({ ...r, days: Math.ceil((new Date(r.earnings_date) - Date.now()) / 86400000) }))
    .filter(r => r.days >= 0 && r.days <= 7)
    .sort((a, b) => a.days - b.days);
  if (!items.length) { box.hidden = true; box.innerHTML = ""; box.className = ""; return; }
  const ptf = new Set(DATA.portfolio.map(x => x.ticker));
  box.hidden = false;
  box.className = "earnings-alert";
  box.innerHTML = `<span class="ea-lab">⚠ Trimestrali entro 7 giorni</span>` + items.map(r => {
    const im = typeof impliedMoveForEarnings === "function" ? impliedMoveForEarnings(r) : null;
    const when = r.days <= 0 ? "oggi" : r.days === 1 ? "domani" : `tra ${r.days}gg`;
    return `<span class="ea-chip${ptf.has(r.ticker) ? "" : " ea-wl"}" title="${esc(r.name)}${ptf.has(r.ticker) ? "" : " (watchlist)"}">${r.ticker} · ${when}${im != null ? ` · ±${im}%` : ""}</span>`;
  }).join("");
}

/* riconciliazione col broker: niente API, quindi qty/PMC/bval sono aggiornati A MANO.
   Due segnali di disallineamento (il buco più pericoloso: un trade eseguito ma non
   riportato → il motore ragiona su un portafoglio che non esiste più):
   1) snapshot broker VECCHIO (>14 gg dalla data as_of);
   2) incoerenza per posizione: controvalore ricalcolato (prezzo live × qtà, in €) che
      diverge >20% dal bval del broker — quasi sempre qty/PMC non allineati o bval stantio
      (la soglia larga assorbe il drift di mercato di un paio di settimane). */
function reconcileState() {
  const b = DATA?.broker || {};
  const out = { staleDays: null, mismatches: [] };
  if (b.as_of) {
    const d = Math.floor((Date.now() - new Date(b.as_of + "T00:00:00")) / 86400000);
    if (d >= 0) out.staleDays = d;
  }
  (DATA?.portfolio || []).forEach(r => {
    if (r.val_eur == null || r.bval == null || r.bval <= 0) return;
    const dev = r.val_eur / r.bval - 1;
    // soglia volatility-aware: banda ~2σ del titolo sull'età dello snapshot (σ_d ≈ ATR%/1,4),
    // col floor al 20%. Senza: i nomi ultra-volatili (MSTR, IPO) sforerebbero per puro
    // drift di mercato e il banner griderebbe al lupo.
    const days = Math.max(out.staleDays ?? 7, 1);
    const sigmaD = r.atr_pct != null ? r.atr_pct / 100 / 1.4 : 0.025;
    const thr = Math.max(0.20, 2 * sigmaD * Math.sqrt(days));
    if (Math.abs(dev) > thr) out.mismatches.push({ tk: r.ticker, dev: Math.round(dev * 100) });
  });
  out.needed = (out.staleDays != null && out.staleDays > 14) || out.mismatches.length > 0;
  return out;
}


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

function renderReconcileAlert() {
  const box = $("#reconcile-alert");
  if (!box) return;
  const rec = reconcileState();
  if (!rec.needed) { box.hidden = true; box.innerHTML = ""; box.className = ""; return; }
  const bits = [];
  if (rec.staleDays != null && rec.staleDays > 14) bits.push(`snapshot broker di <b>${rec.staleDays} giorni</b> fa (${esc((DATA.broker || {}).as_of || "")})`);
  if (rec.mismatches.length) bits.push(`posizioni incoerenti col broker: <b>${rec.mismatches.map(m => `${m.tk} ${m.dev > 0 ? "+" : ""}${m.dev}%`).join(", ")}</b>`);
  box.hidden = false;
  box.className = "data-error";
  box.innerHTML = `⚠ <b>RICONCILIA COL BROKER</b> — ${bits.join(" · ")}. Se hai operato senza aggiornare quantità/PMC, il motore sta ragionando su un portafoglio che non esiste più: usa "✎ Modifica valori" e aggiorna lo snapshot in holdings.json.`;
}

/* ---------------- liquidità (cash) ---------------- */
function renderCash() {
  const inp = $("#cash-input");
  if (inp && document.activeElement !== inp) inp.value = cashEur || "";
  const note = $("#cash-note");
  if (note) note.textContent = cashEur > 0 ? `inclusa nel totale e nell'allocazione (${fmtEUR.format(cashEur)})` : "";
}

function saveCash() {
  cashEur = parseFloat($("#cash-input").value) || 0;
  localStorage.setItem("cash_eur", cashEur);
  recomputeTotals();
  renderCash(); renderKPI(); renderAllocation();
  toast("Liquidità salvata ✓");
}

/* ---------------- mini-card: direzione mercato + BofA signposts ---------------- */
// aggregatore: raccoglie TUTTI i segnali del sistema con etichetta e punteggio 0-100
function directionComponents() {
  const m = DATA.macro || {};
  const c = [];
  if (m.risk_sentiment) c.push(["Sentiment globale", m.risk_sentiment.score]);
  if (m.thermometer) c.push(["Termometro portafoglio", m.thermometer.score]);
  if (m.fear_greed) c.push(["Fear & Greed", m.fear_greed.score]);
  if (m.vix) c.push(["Volatilità (VIX)", clamp(100 - m.vix.value / 50 * 100)]);
  if (m.signposts) c.push(["Segnali ribassisti BofA", 100 - m.signposts.pct]);
  if (m.macroquant) c.push(["MacroQuant (ciclo)", m.macroquant.score]);
  if (m.fedwatch && m.fedwatch.next_cut_prob != null) c.push(["Politica Fed (tagli attesi)", clamp(40 + m.fedwatch.next_cut_prob * 0.6)]);
  if (m.carry) c.push(["Carry USA-Giappone", clamp(50 + (m.carry.spread - 2) * 15)]);
  // media impatto degli indicatori macro (CPI, NFP, curva, ecc.)
  const imp = (m.indicators || []).filter(i => i.impact != null).map(i => i.impact);
  if (imp.length) c.push(["Dati macro USA (media)", Math.round(imp.reduce((a, b) => a + b, 0) / imp.length)]);
  // rotazione settoriale: settori ciclici forti = pro-rischio
  if ((m.tilt || []).length) c.push(["Rotazione settoriale", Math.round(m.tilt.reduce((a, s) => a + s.score, 0) / m.tilt.length)]);
  return c.map(([label, score]) => ({ label, score: Math.round(score) }));
}
function marketDirectionScore() {
  const c = directionComponents();
  if (!c.length) return null;
  return Math.round(c.reduce((a, b) => a + b.score, 0) / c.length);
}

/* ---------------- Top bar "Decisione" + diario delle azioni ---------------- */
function loadDiary() {
  try { return JSON.parse(localStorage.getItem("action_diary") || "[]"); } catch { return []; }
}
function setDiary(arr) {
  localStorage.setItem("action_diary", JSON.stringify(arr.slice(0, 100)));
  pushDiaryCloud(arr);   // sync su GitHub se c'è un token (così è uguale su Mac e iPhone)
}
function saveDiaryEntry(text) {
  const arr = loadDiary();
  arr.unshift({ date: new Date().toISOString(), text });
  setDiary(arr);
}
function deleteDiaryEntry(iso) {
  setDiary(loadDiary().filter(e => e.date !== iso));
}
const DIARY_PATH = "config/action_diary.json";
/* salva il diario su GitHub (config/action_diary.json) — solo se c'è già un token salvato (no prompt) */
async function pushDiaryCloud(arr) {
  const token = localStorage.getItem("gh_token");
  if (!token) return;
  try {
    let sha;
    const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${DIARY_PATH}`, { headers: ghHeaders(token), cache: "no-store" });
    if (g.ok) sha = (await g.json()).sha;
    await fetch(`https://api.github.com/repos/${REPO}/contents/${DIARY_PATH}`, {
      method: "PUT", headers: ghHeaders(token),
      body: JSON.stringify({ message: "Aggiorna diario azioni", content: btoa(unescape(encodeURIComponent(JSON.stringify(arr, null, 1)))), sha }),
    });
  } catch { /* offline o senza permessi: resta comunque in locale */ }
}
/* carica il diario dal cloud all'avvio e lo fonde col locale (per date univoche) */
async function loadDiaryCloud() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${DIARY_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const cloud = await r.json();
    if (!Array.isArray(cloud)) return;
    const byDate = {};
    [...cloud, ...loadDiary()].forEach(e => { if (e && e.date) byDate[e.date] = e; });
    const merged = Object.values(byDate).sort((a, b) => (a.date < b.date ? 1 : -1));
    localStorage.setItem("action_diary", JSON.stringify(merged.slice(0, 100)));
  } catch { /* nessun diario remoto ancora */ }
}

/* ---------------- motore decisionale (mandato quant: Sharpe > 2.0 + sovraperformance vs NDX) ---------------- */
// solo titoli AZIONARI USA (esclude indici ^, cripto/commodity con - o =, BTP, valuta PTS)
function isEquity(r) {
  return r && r.currency === "USD" && !/[\^=]/.test(r.ticker) && !r.ticker.includes("-") && r.ticker !== "BTP-V28";
}

/* ATR del titolo: dato pipeline (ATR 14 Wilder) se disponibile, altrimenti proxy statistico
   documentato: σ giornaliera dei rendimenti 1M × prezzo × 1,4 (per un processo diffusivo il
   True Range medio ≈ 1,4·σ). Il proxy sparisce da solo al primo run della pipeline. */
function atrOf(r) {
  if (r.atr_14 != null && r.price) {
    return { atr: r.atr_14, pct: r.atr_pct ?? Math.round(r.atr_14 / r.price * 10000) / 100, src: "ATR14" };
  }
  const m1 = (r.sparks || {}).m1 || [];
  if (m1.length >= 10 && r.price) {
    const rets = [];
    for (let i = 1; i < m1.length; i++) if (m1[i - 1]) rets.push(m1[i] / m1[i - 1] - 1);
    const mean = avg(rets);
    const sd = Math.sqrt(avg(rets.map(x => (x - mean) ** 2)));
    if (sd > 0) return { atr: r.price * sd * 1.4, pct: Math.round(sd * 1.4 * 10000) / 100, src: "proxy σ1M" };
  }
  return null;
}
/* stop loss dinamico: 2×ATR sotto il prezzo di riferimento (ingresso o prezzo attuale per trailing) */
function atrStop(refPrice, r) {
  const a = atrOf(r);
  if (!a || !refPrice) return null;
  return { stop: Math.round((refPrice - 2 * a.atr) * 100) / 100, atr: a.atr, pct: a.pct, src: a.src };
}

/* stop operativo di una POSIZIONE APERTA: priorità allo stop RATCHET della pipeline
   (stop_atr: sale col prezzo e non ridiscende — persistito tra i run), fallback al
   calcolo client 2×ATR dal prezzo attuale (non ancorato, etichettato). */
function stopOf(r) {
  if (r.stop_atr != null) {
    return { stop: r.stop_atr, violated: !!r.stop_violated, ratchet: true,
             pct: r.atr_pct ?? null, src: "ratchet 2×ATR" };
  }
  const st = atrStop(r.price, r);
  if (!st) return null;
  const inGain = r.qty && r.pmc != null && r.price > r.pmc;
  const stop = inGain ? Math.max(st.stop, r.pmc) : st.stop;
  return { stop: Math.round(stop * 100) / 100, violated: r.price < stop, ratchet: false, pct: st.pct, src: st.src };
}

/* beta effettivo di un titolo: PRIORITÀ alla regressione della pipeline sui log-rendimenti
   12M vs Nasdaq 100 (beta_ndx); fallback al beta Yahoo (5A mensile vs S&P) solo se manca. */
function betaOf(r) {
  if (r.beta_ndx != null) return r.beta_ndx;
  if (r.ticker === "BTP-V28") return 0;   // esposizione azionaria nulla
  return r.beta ?? null;
}

/* Beta di Portafoglio (weighted beta vs NDX): Σ beta_i × peso_i MARK-TO-MARKET sul capitale
   investito (liquidità esclusa). Il BTP conta con beta 0. "src" dice se il dato viene dalla
   regressione della pipeline o dal fallback Yahoo. */
function portfolioBeta() {
  const inv = (DATA?.portfolio || []).filter(r => (r.val_eur || 0) > 0);
  const tot = inv.reduce((s, r) => s + r.val_eur, 0);
  if (!tot) return null;
  let wb = 0, covered = 0, regEur = 0;
  inv.forEach(r => {
    const beta = betaOf(r);
    if (beta != null) {
      wb += beta * r.val_eur; covered += r.val_eur;
      if (r.beta_ndx != null || r.ticker === "BTP-V28") regEur += r.val_eur;
    }
  });
  if (!covered) return null;
  const allReg = regEur >= covered * 0.999;
  return { beta: Math.round(wb / tot * 100) / 100, total: tot,
           src: allReg ? "regressione log-return 12M vs NDX" : "misto: regressione NDX + fallback Yahoo",
           fromPipeline: DATA?.totals?.portfolio_beta_ndx ?? null };
}

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
function isIlliquid(r) {
  const st = r.stats || {};
  if (!r.qty || !r.price || !st.avg_volume_30d) return false;
  const posValueUsd = r.qty * r.price;               // controvalore posizione in $
  const advUsd = st.avg_volume_30d * r.price;         // dollar volume medio giornaliero
  return advUsd > 0 && posValueUsd / advUsd > 0.05;
}

/* peso % di una posizione sul NAV (investito + liquidità) — per la regola di sizing 10% */
function positionWeightPct(r) {
  const t = DATA?.totals || {};
  const nav = (t.eur_invested || 0) + cashEur;
  if (!nav || !(r.val_eur > 0)) return null;
  return Math.round(r.val_eur / nav * 1000) / 10;
}

/* VETO del risk manager (non scavalcabile da alcun supporto tecnico):
   - VALUE TRAP se, anche singolarmente: Sharpe 1A < -0.3 · Short Interest ≥ 15% ·
     margine netto negativo con PEG non calcolabile/negativo.
     (soglia -0.3 e non 0: uno Sharpe lievemente negativo in un mercato in drawdown è rumore,
     sotto -0.3 è distruzione sistematica di valore corretto per il rischio)
   - NON ACCUMULARE se ROIC/ROE < 0 o PEG < 0 (qualità del capitale rotta). */
function qualityVeto(r) {
  const st = r.stats || {};
  const why = [];
  // metro del veto: SORTINO (downside deviation) — punisce la distruzione di valore reale,
  // non i rally; un titolo volatile al rialzo non finisce in value trap per lo Sharpe basso.
  // Fallback etichettato allo Sharpe finché la pipeline non popola sortino_1y.
  if (r.sortino_1y != null) {
    if (r.sortino_1y < -0.3) why.push(`Sortino 1A ${fmtNum.format(r.sortino_1y)} < -0.3 (distruzione di valore sul downside)`);
  } else if (r.sharpe_1y != null && r.sharpe_1y < -0.3) {
    why.push(`Sharpe 1A ${fmtNum.format(r.sharpe_1y)} < -0.3 (proxy: Sortino n.d. fino al prossimo run pipeline)`);
  }
  if (st.short_float != null && st.short_float >= 0.15) why.push(`Short Interest ${Math.round(st.short_float * 1000) / 10}% ≥ 15%`);
  const pegBroken = st.peg == null || st.peg <= 0;   // la pipeline azzera già i PEG ≤ 0 → n.d.
  if (st.profit_margin != null && st.profit_margin < 0 && pegBroken) why.push("margine netto negativo con PEG non calcolabile");
  if (why.length) return { verdict: "SCARTATO - VALUE TRAP", why };
  if (st.roe != null && st.roe < 0) return { verdict: "NON ACCUMULARE", why: ["ROIC/ROE negativo"] };
  if (st.peg != null && st.peg < 0) return { verdict: "NON ACCUMULARE", why: ["PEG negativo"] };
  return null;
}

function decisionVerdict() {
  const t = DATA.totals || {};
  const dir = marketDirectionScore();
  const eurusd = DATA.eurusd || 1.08;
  const ps = t.portfolio_sharpe_ratio;
  const universe = [...(DATA.portfolio || []), ...(DATA.watchlist || [])].filter(isEquity);

  // 1) VETO fondamentale: value trap e qualità rotta escluse a prescindere dal drawdown
  const excluded = [];
  const eligible = [];
  universe.forEach(r => {
    const v = qualityVeto(r);
    if (v) excluded.push({ r, ...v }); else eligible.push(r);
  });

  // 2) score quant 0-100 sui soli eleggibili: impatto marginale sullo Sharpe (40%),
  //    forza relativa 1M vs benchmark/NDX (30%), qualità fondamentale (30%).
  const refSharpe = ps != null ? ps : 1;   // baseline: Sharpe attuale del portafoglio
  const quantScore = (r) => {
    const st = r.stats || {};
    const parts = [];
    if (r.sharpe_1y != null) parts.push([clamp(50 + (r.sharpe_1y - refSharpe) * 25), .40]);
    // forza relativa: metro diretto del mandato = RS vs NDX (fallback sul benchmark settoriale)
    const rsq = r.rs_ndx_1m ?? r.rs_1m;
    if (rsq != null) parts.push([clamp(50 + rsq * 4), .30]);
    let q = 50;
    if (st.roe != null) q += clamp(st.roe * 120, -30, 30);
    if (st.profit_margin != null) q += clamp(st.profit_margin * 60, -15, 15);
    if (st.revenue_growth != null) q += clamp(st.revenue_growth * 40, -10, 15);
    if (r.fin_health != null) q = (q + r.fin_health) / 2;
    parts.push([clamp(q), .30]);
    const wTot = parts.reduce((s, p) => s + p[1], 0) || 1;
    return Math.round(parts.reduce((s, p) => s + p[0] * p[1], 0) / wTot);
  };

  // candidati ACCUMULO: migliorano il profilo rischio/rendimento (score ≥ 60) e hanno
  // Sharpe noto. Il drawdown non è più la porta d'ingresso: è solo un tiebreaker di prezzo.
  const accumula = eligible
    .filter(r => r.price && r.sharpe_1y != null)
    .map(r => ({ ...r, _q: quantScore(r) }))
    .filter(r => r._q >= 60)
    .sort((a, b) => (b._q - a._q) || ((a.w52_dist_pct ?? 0) - (b.w52_dist_pct ?? 0)));

  // 3) SIZING istituzionale: posizioni oltre il 10% del NAV → trimming suggerito
  const overweight = (DATA.portfolio || []).filter(isEquity)
    .map(r => ({ r, w: positionWeightPct(r) }))
    .filter(x => x.w != null && x.w > 10)
    .sort((a, b) => b.w - a.w);
  // alleggerimenti tattici: multipli tossici o ipercomprato estremo (solo posizioni possedute)
  const trim = (DATA.portfolio || []).filter(isEquity)
    .filter(r => r.qty && ((r.pe && r.pe > 150) || (r.rsi && r.rsi > 78)))
    .sort((a, b) => (b.pe || 0) - (a.pe || 0));
  // TAX ALPHA: posizioni in perdita latente con veto qualità → minusvalenze come scudo fiscale
  const harvest = (DATA.portfolio || []).filter(isEquity)
    .filter(r => r.qty && r.gain_eur != null && r.gain_eur < 0 && qualityVeto(r))
    .sort((a, b) => a.gain_eur - b.gain_eur);

  // 4) piano operativo: ordini limite al supporto, stop a 2×ATR (volatilità, non % fissa)
  const cashUsd = cashEur * eurusd;
  // sizing regime-aware: i budget d'ingresso si riducono quando la volatilità di mercato
  // sale (VIX) — stessa logica degli stop ATR ma a livello di PORTAFOGLIO: in regime
  // nervoso si rischia meno per operazione, non si spegne il motore.
  const vixV = (DATA.macro || {}).vix?.value;
  const riskScale = vixV == null ? 1 : vixV > 30 ? 0.4 : vixV > 25 ? 0.5 : vixV > 20 ? 0.75 : 1;
  const withPlan = accumula.map((r, i) => {
    const support = (r.tech_by_range?.[sparkRange]?.support) || r.support || r.price;
    const limit = Math.min(support, r.price);                 // ordine limite al supporto/prezzo
    const budget = cashUsd * (i === 0 ? 0.35 : i === 1 ? 0.25 : 0.15) * riskScale;
    const qty = limit > 0 ? Math.floor(budget / limit) : 0;
    const st = atrStop(limit, r);
    return { r, limit, qty, dd: r.w52_dist_pct, q: r._q, stop: st ? st.stop : Math.round(limit * 0.92 * 100) / 100, atr: st };
  }).filter(x => x.qty > 0);
  // stop TRAILING sulle posizioni esistenti: ratchet pipeline (stopOf) — sale, non ridiscende
  const trailing = (DATA.portfolio || []).filter(isEquity).filter(r => r.qty && r.price)
    .map(r => {
      const st = stopOf(r);
      return st ? { r, stop: st.stop, violated: st.violated, ratchet: st.ratchet, atr: st } : null;
    }).filter(Boolean);
  const stopViolations = trailing.filter(x => x.violated);

  const reasons = [];
  let label, score, col;
  const vetoTk = excluded.map(x => `${x.r.ticker} (${x.verdict === "SCARTATO - VALUE TRAP" ? "VALUE TRAP" : x.why[0]})`);
  if (accumula.length >= 1 && cashUsd > 0) {
    label = "ACCUMULA"; col = "var(--green)"; score = 72;
    reasons.push(`${accumula.length} candidati migliorano il profilo Sharpe/RS del portafoglio (score quant ≥60): ${accumula.slice(0, 5).map(r => `${r.ticker} ${r._q}/100`).join(", ")}`);
    reasons.push(`criteri: impatto marginale sullo Sharpe (vs ${refSharpe != null ? fmtNum.format(refSharpe) : "n.d."} attuale, target 2.0) · forza relativa 1M vs benchmark · qualità fondamentale`);
    reasons.push(`ordini LIMITE ai supporti con stop a 2×ATR(14): il rischio per operazione si adatta alla volatilità del titolo`);
    if (riskScale < 1) reasons.push(`regime di volatilità: VIX ${fmtNum.format(vixV)} → budget d'ingresso ridotti al ${Math.round(riskScale * 100)}% (sizing regime-aware: in mercato nervoso si rischia meno per operazione)`);
  } else if (dir != null && dir < 40) {
    label = "PRUDENZA"; col = "var(--yellow)"; score = 32;
    reasons.push(`regime debole (segnali ${dir}/100) e nessun candidato con edge quant: nessun nuovo ingresso, disciplina sugli stop 2×ATR`);
  } else {
    label = "MANTIENI"; col = "var(--blue)"; score = dir != null ? dir : 55;
    reasons.push(`nessun candidato migliora abbastanza Sharpe/forza relativa (regime ${dir != null ? dir + "/100" : "neutro"}): conserva liquidità e posizioni vincenti`);
  }
  if (stopViolations.length) reasons.unshift(`⚠ STOP VIOLATO su ${stopViolations.map(x => `${x.r.ticker} (stop $${fmtNum.format(x.stop)}, prezzo $${fmtNum.format(x.r.price)})`).join(", ")} — il prezzo è sotto lo stop trailing ancorato: decidere uscita o ri-arm consapevole`);
  if (vetoTk.length) reasons.push(`VETO risk manager su ${vetoTk.join(", ")} — esclusi a prescindere dal supporto tecnico`);
  if (overweight.length) reasons.push(`sizing: ${overweight.map(x => `${x.r.ticker} ${x.w}%`).join(", ")} oltre il 10% del NAV → valuta trimming di rientro`);
  if (trim.length) reasons.push(`valuta TRIM parziale (25-50%) su ${trim.map(r => r.ticker).join(", ")} (multiplo/RSI estremo)`);
  return { label, col, score, reasons, dir, accumula, trim, withPlan, trailing, stopViolations, excluded, overweight, harvest };
}

// alert proattivi: condizioni rilevanti emerse oggi (deep value, correzione, squeeze, VIX)
function alertsSummary() {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const deep = all.filter(r => r.w52_dist_pct != null && r.w52_dist_pct <= -25);
  const corr = all.filter(r => r.w52_dist_pct != null && r.w52_dist_pct <= -15 && r.w52_dist_pct > -25);
  const sqz = all.filter(r => (r.stats?.short_float ?? 0) > 0.12);
  const vix = (DATA.macro || {}).vix?.value;
  const chips = [];
  if (deep.length) chips.push({ t: `${deep.length} DEEP VALUE`, c: "var(--green)", tip: deep.map(r => r.ticker).join(", ") });
  if (corr.length) chips.push({ t: `${corr.length} in correzione`, c: "var(--yellow)", tip: corr.map(r => r.ticker).join(", ") });
  if (sqz.length) chips.push({ t: `${sqz.length} squeeze risk`, c: "var(--red)", tip: sqz.map(r => r.ticker).join(", ") });
  if (vix != null && vix > 20) chips.push({ t: `VIX ${fmtNum.format(vix)}`, c: "var(--red)", tip: "Volatilità elevata" });
  return chips;
}

function renderDecisionBar() {
  const box = $("#decision-bar");
  if (!box || !DATA) return;
  const v = decisionVerdict();
  const t = DATA.totals || {};
  // obiettivo allineato al mandato del prompt AI: Sharpe > 2.0 e sovraperformance vs Nasdaq 100
  const ps = t.portfolio_sharpe_ratio;
  const bm = (DATA.macro || {}).benchmarks || {};
  const pday = typeof portfolioDayPct === "function" ? portfolioDayPct() : null;
  const alphaNdx = (pday != null && bm.ndx != null) ? Math.round((pday - bm.ndx) * 100) / 100 : null;
  const chips = alertsSummary();
  const chipsHtml = chips.length
    ? `<div class="dec-alerts">${chips.map(c => `<span class="dec-chip" style="color:${c.c};border-color:${c.c}" title="${esc(c.tip)}">${esc(c.t)}</span>`).join("")}</div>`
    : "";
  box.innerHTML = `
    <div class="dec-left">
      <div class="dec-lab">Decisione operativa</div>
      <div class="dec-verdict" style="color:${v.col}">${v.label}</div>
    </div>
    <div class="dec-mid">
      ${thermoLine(v.score, ["Accumula", "Alleggerisci"])}
      ${chipsHtml}
    </div>
    <div class="dec-right">
      <div class="dec-goal" title="Mandato: massimizzare il rendimento corretto per il rischio e battere il Nasdaq 100">${alphaNdx != null ? `vs NDX oggi ${signTxt(alphaNdx, " pp")}` : "Obiettivo: battere NDX"}${ps != null ? ` · Sharpe ${fmtNum.format(ps)}/2.0` : ""}</div>
      <div class="dec-cta muted">clicca per dettagli e diario azioni</div>
    </div>`;
}

function openDecisionModal() {
  const v = decisionVerdict();
  const diary = loadDiary();
  const diaryHtml = diary.length ? diary.map(e => `
    <div class="diary-item" data-iso="${e.date}">
      <span class="diary-date">${new Date(e.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })}</span>
      <span class="diary-text">${esc(e.text)}</span>
      <button class="diary-edit" data-iso="${e.date}" title="Modifica questa voce">✎</button>
      <button class="diary-del" data-iso="${e.date}" title="Elimina">✕</button>
    </div>`).join("") : `<div class="muted" style="font-size:12px">Nessuna voce ancora. Annota le tue operazioni e le motivazioni: il diario viene incluso nel prompt AI.</div>`;
  // tabella ACCUMULO (acquisto): prezzo limite d'ingresso, STOP 2×ATR, quantità, motivazione
  const accHtml = (v.withPlan || []).length ? `
    <h4 style="margin:10px 0 4px">Acquisti — ordini limite suggeriti</h4>
    <table class="info-table"><thead><tr><th>Titolo</th><th class="num">Prezzo</th><th class="num">Limite acq.</th><th class="num">Stop 2×ATR</th><th class="num">Qtà</th><th>Motivazione</th></tr></thead><tbody>
    ${v.withPlan.map(p => {
      const atrNote = p.atr ? `ATR ${p.atr.src === "ATR14" ? "14" : "proxy"} $${fmtNum.format(Math.round(p.atr.atr * 100) / 100)} (${fmtNum.format(p.atr.pct)}%)` : "ATR n.d. → -8%";
      return `<tr>
      <td>${esc(p.r.name)} <span class="tk">${p.r.ticker}</span></td>
      <td class="num">$${fmtNum.format(p.r.price)}</td>
      <td class="num"><b style="color:var(--green)">$${fmtNum.format(Math.round(p.limit * 100) / 100)}</b></td>
      <td class="num"><b style="color:var(--red)">$${fmtNum.format(p.stop)}</b></td>
      <td class="num"><b style="font-size:14px">${p.qty}</b></td>
      <td style="font-size:11px">score quant ${p.q}/100 · ${p.dd != null ? signTxt(p.dd) + " dal max 52S · " : ""}${atrNote}</td>
    </tr>`; }).join("")}</tbody></table>
    <div class="info-line muted" style="font-size:11px;margin-top:4px">Quantità ripartendo la liquidità (${fmtEUR.format(cashEur)}) sui candidati con lo score quant più alto (Sharpe marginale · RS 1M · qualità). Ordini LIMITE: se il prezzo non arriva, la cassa si conserva. Stop loss a <b>2×ATR(14)</b> sotto l'ingresso: assorbe la volatilità fisiologica del titolo invece di una % fissa.</div>` : "";
  // STOP TRAILING sulle posizioni esistenti: ratchet della pipeline (sale, non ridiscende)
  const trailHtml = (v.trailing || []).length ? `
    <h4 style="margin:12px 0 4px">Stop trailing posizioni aperte (ratchet 2×ATR)</h4>
    <table class="info-table"><thead><tr><th>Titolo</th><th class="num">Prezzo</th><th class="num">Stop</th><th class="num">Dist.</th><th>Stato</th></tr></thead><tbody>
    ${v.trailing.map(x => `<tr${x.violated ? ' style="background:rgba(239,68,68,.08)"' : ""}>
      <td>${esc(x.r.name)} <span class="tk">${x.r.ticker}</span></td>
      <td class="num">$${fmtNum.format(x.r.price)}</td>
      <td class="num"><b style="color:var(--red)">$${fmtNum.format(x.stop)}</b></td>
      <td class="num">${signTxt(Math.round((x.stop / x.r.price - 1) * 1000) / 10)}</td>
      <td style="font-size:11px">${x.violated ? '<b style="color:var(--red)">⚠ STOP VIOLATO</b> — prezzo sotto lo stop ancorato' : x.ratchet ? "ratchet attivo (ancorato, non ridiscende)" : esc(x.atr.src) + " (client, non ancorato)"}</td>
    </tr>`).join("")}</tbody></table>
    <div class="info-line muted" style="font-size:11px;margin-top:4px">Stop RATCHET: parte a 2×ATR(14) sotto il prezzo e da lì può solo salire coi massimi — non si riabbassa quando il titolo scende (uno stop che ridiscende non è uno stop). Persistito tra i run della pipeline; si resetta se quantità o PMC cambiano. Con "⚠ STOP VIOLATO" la disciplina prevede uscita o ri-arm consapevole.</div>` : "";
  // ESCLUSI dal veto del risk manager (value trap / qualità rotta)
  const vetoHtml = (v.excluded || []).length ? `
    <h4 style="margin:12px 0 4px">Esclusi dal motore (veto risk manager)</h4>
    ${v.excluded.map(x => `<div class="info-line" style="font-size:12px"><b style="color:var(--red)">${x.r.ticker}</b> — <b>${x.verdict}</b>: ${x.why.join(" · ")}</div>`).join("")}
    <div class="info-line muted" style="font-size:11px;margin-top:2px">Nessun supporto tecnico può scavalcare il veto fondamentale.</div>` : "";
  // tabella ALLEGGERIMENTO (vendita): prezzo limite di vendita, quantità, motivazione
  const trimHtml = (v.trim || []).length ? `
    <h4 style="margin:12px 0 4px">Vendite/alleggerimenti — TRIM parziale (Free Ride)</h4>
    <table class="info-table"><thead><tr><th>Titolo</th><th class="num">Prezzo</th><th class="num">Limite vend.</th><th class="num">Qtà (30%)</th><th>Motivazione</th></tr></thead><tbody>
    ${v.trim.map(r => { const lim = Math.round((r.resistance && r.resistance > r.price ? r.resistance : r.price) * 100) / 100; return `<tr>
      <td>${esc(r.name)} <span class="tk">${r.ticker}</span></td>
      <td class="num">$${fmtNum.format(r.price)}</td>
      <td class="num"><b style="color:var(--green)">$${fmtNum.format(lim)}</b></td>
      <td class="num"><b>${Math.round((r.qty || 0) * 0.3)}</b></td>
      <td style="font-size:11px">${r.pe > 150 ? `multiplo tossico (P/E ${fmtNum.format(r.pe)})` : `RSI estremo (${r.rsi})`} — recupera capitale di rischio, lascia correre il resto</td>
    </tr>`; }).join("")}</tbody></table>` : "";
  // TAX ALPHA: scudi fiscali (minusvalenze dei rami secchi) per compensare le plus delle vendite
  let taxHtml = "";
  if ((v.harvest || []).length) {
    const totMinus = v.harvest.reduce((s, r) => s + (r.gain_eur || 0), 0);   // negativo
    const totPlus = (v.trim || []).reduce((s, r) => s + Math.max(0, (r.gain_eur || 0)), 0);
    const offset = Math.min(Math.abs(totMinus), totPlus);
    const taxSaved = offset * 0.26;
    taxHtml = `
    <h4 style="margin:12px 0 4px">Scudi fiscali (Tax Alpha)</h4>
    <table class="info-table"><thead><tr><th>Titolo</th><th class="num">Minus latente</th><th class="num">Azioni</th><th>Nota</th></tr></thead><tbody>
    ${v.harvest.map(r => `<tr>
      <td>${esc(r.name)} <span class="tk">${r.ticker}</span></td>
      <td class="num"><b class="neg">${signTxt(Math.round(r.gain_eur), " €")}</b></td>
      <td class="num"><b>${r.qty}</b></td>
      <td style="font-size:11px">ramo secco (${r.stats?.roe != null && r.stats.roe < 0 ? "ROIC<0" : "Sharpe<0"}) — vendendolo realizzi una minusvalenza usabile come scudo</td>
    </tr>`).join("")}</tbody></table>
    <div class="info-line muted" style="font-size:11px;margin-top:4px">Vendendo i rami secchi realizzi <b class="neg">${fmtEUR.format(Math.round(totMinus))}</b> di minusvalenze. ${totPlus > 0 ? `Compensano fino a <b>${fmtEUR.format(Math.round(offset))}</b> di plusvalenze dalle vendite sopra, risparmiando ~<b class="pos">${fmtEUR.format(Math.round(taxSaved))}</b> di tasse (26%).` : `Le minus restano disponibili per compensare future plusvalenze (entro il quadriennio fiscale).`}</div>`;
  }
  openInfoModal(`Decisione operativa: ${v.label}`,
    `<div class="info-line" style="margin-bottom:8px"><b style="color:${v.col};font-size:16px">${v.label}</b></div>
     <ul style="margin:0 0 10px 18px;font-size:12.5px;line-height:1.6">${v.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>
     ${accHtml}${trailHtml}${vetoHtml}${trimHtml}${taxHtml}
     <div class="info-line muted" style="font-size:11px;margin:12px 0">Verdetto su soli titoli AZIONARI. Obiettivo del motore: massimizzare il rendimento corretto per il rischio (Sharpe > 2.0) e sovraperformare il Nasdaq 100 — stesso mandato del prompt AI. Per l'analisi completa usa "Copia prompt AI".</div>
     <h4 style="margin:10px 0 6px">Diario delle azioni</h4>
     <div class="diary-add"><textarea id="diary-input" rows="1" placeholder="Es: comprato 10 NVDA a 180 — accumulo su correzione" maxlength="400"></textarea><button class="btn btn-primary btn-sm" id="diary-save">Aggiungi</button></div>
     <div class="diary-list" id="diary-list">${diaryHtml}</div>`);
  const refresh = () => { closeChartModal(); openDecisionModal(); };
  $("#diary-save")?.addEventListener("click", () => {
    const inp = $("#diary-input"); const txt = (inp.value || "").trim();
    if (txt) { saveDiaryEntry(txt); refresh(); }
  });
  const di = $("#diary-input");
  if (di) {
    // si allarga man mano che scrivi; Invio = salva, Shift+Invio = a capo
    const grow = () => { di.style.height = "auto"; di.style.height = Math.min(160, di.scrollHeight) + "px"; };
    di.addEventListener("input", grow);
    di.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const txt = di.value.trim(); if (txt) { saveDiaryEntry(txt); refresh(); } }
    });
    di.focus();
  }
  document.querySelectorAll(".diary-del").forEach(b => b.addEventListener("click", () => { deleteDiaryEntry(b.dataset.iso); refresh(); }));
  // modifica voce: carica il testo nel campo, rimuove la voce originale (si ri-salva con Aggiungi/Invio)
  document.querySelectorAll(".diary-edit").forEach(b => b.addEventListener("click", () => {
    const entry = loadDiary().find(x => x.date === b.dataset.iso);
    if (!entry) return;
    deleteDiaryEntry(b.dataset.iso);
    const inp = $("#diary-input");
    if (inp) { inp.value = entry.text; inp.dispatchEvent(new Event("input")); inp.focus(); }
    document.querySelector(`.diary-item[data-iso="${b.dataset.iso}"]`)?.remove();
    toast("Voce caricata nel campo: modifica e premi Aggiungi");
  }));
}

/* mini-trend di una metrica vs ~1 settimana fa (dallo storico metrics_history della pipeline) */
function metricTrend(field) {
  const h = DATA.metrics_history || [];
  if (h.length < 2) return "";
  const cur = h[h.length - 1]?.[field];
  const past = h[Math.max(0, h.length - 8)]?.[field];   // ~7 punti (giorni) fa
  if (cur == null || past == null) return "";
  const d = cur - past;
  const eps = field === "sharpe" ? 0.05 : 0.3;
  const dTxt = field === "sharpe" ? (d > 0 ? "+" : "") + fmtNum.format(Math.round(d * 100) / 100)
    : (d > 0 ? "+" : "") + fmtNum.format(Math.round(d * 10) / 10) + " pp";
  if (Math.abs(d) < eps) return `<span class="trend trend-flat" title="stabile vs ~1 settimana fa">→</span>`;
  return d > 0
    ? `<span class="trend trend-up" title="${dTxt} vs ~1 settimana fa">▲</span>`
    : `<span class="trend trend-down" title="${dTxt} vs ~1 settimana fa">▼</span>`;
}

/* Stato Margin Debt condiviso 1:1 tra card, popup e prompt AI (niente stringhe divergenti).
   Logica AND: rosso "ESTREMA" SOLO se leva ≥90% del picco E Forward P/E >20 conferma;
   ≥90% senza conferma → giallo (con nota esplicita se il P/E manca). */
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

function renderMiniCards() {
  const m = DATA.macro || {};
  const dir = marketDirectionScore();
  const dBox = $("#market-direction");
  if (dBox && dir != null) {
    const lab = dir >= 60 ? "Rialzista" : dir <= 40 ? "Ribassista" : "Laterale";
    dBox.innerHTML = `<div class="mc-title">Direzione mercato</div>
      ${compactSemiGauge(dir, ["Ribasso", "Rialzo"])}
      <div class="mc-value" style="color:${scoreColor(dir)}">${dir}% · ${lab}</div>
      <div class="mc-sub muted">media di tutti i segnali tecnici e macro</div>`;
  }
  const sp = m.signposts, sBox = $("#signposts-box");
  if (sBox && sp) {
    const risk = sp.pct >= 70 ? "Rischio alto" : sp.pct >= 40 ? "Rischio medio" : "Rischio basso";
    sBox.innerHTML = `<div class="mc-title">BofA Bear-Market Signposts</div>
      ${compactSemiGauge(100 - sp.pct, ["Solido", "Ribassista"])}
      <div class="mc-value" style="color:${scoreColor(100 - sp.pct)}">${sp.active}/${sp.total} attivi · ${risk}</div>
      <div class="mc-sub muted">clicca per il dettaglio dei 10 segnali</div>`;
  }
  // Rotazione settoriale (Tilt): settore leader (overweight) e fanalino
  const tilt = m.tilt, tBox = $("#tilt-box");
  if (tBox && tilt && tilt.length) {
    const sorted = [...tilt].sort((a, b) => b.m1 - a.m1);
    const defensives = ["Utilities", "Consumi difens.", "Salute", "Oro"];
    const defAvg = avg(tilt.filter(s => defensives.includes(s.name)).map(s => s.m1));
    const tech = tilt.find(s => s.ticker === "XLK");
    const isDef = (defAvg != null && tech) ? defAvg > tech.m1 : null;
    const regime = isDef == null ? "—" : isDef ? "Difensiva" : "Pro-rischio";
    const regimeCol = isDef == null ? "var(--muted)" : isDef ? "var(--yellow)" : "var(--green)";
    // score termometro: pro-rischio (tech>difensivi) = favorevole (alto)
    const score = (defAvg != null && tech) ? clamp(50 + (tech.m1 - defAvg) * 8) : 50;
    const lead = sorted[0], lag = sorted[sorted.length - 1];
    tBox.innerHTML = `<div class="mc-title">Rotazione settoriale</div>
      <div class="mc-value" style="color:${regimeCol}">${regime}</div>
      ${thermoLine(score, ["Pro-rischio", "Difensivo"])}
      <div class="mc-sub muted">↑ ${esc(lead.name.split(" ")[0])} ${signTxt(lead.m1)} · ↓ ${esc(lag.name.split(" ")[0])} ${signTxt(lag.m1)}</div>`;
  }
  // Quadruple Witching (4 streghe): ora mostrata nel popup del box Put/Call (vedi openMacroInfo "putcall")
  // MacroQuant (stile BCA)
  const mq = m.macroquant, mqBox = $("#macroquant-box");
  if (mqBox && mq) {
    const mqLab = mq.score >= 60 ? "Ciclo espansivo" : mq.score >= 40 ? "Ciclo neutro" : "Rischio recessione";
    mqBox.innerHTML = `<div class="mc-title">MacroQuant (Ciclo)</div>
      ${compactSemiGauge(mq.score, ["Crescita", "Recessione"])}
      <div class="mc-value" style="color:${scoreColor(mq.score)}">${mq.score}% · ${mqLab}</div>
      <div class="mc-sub muted">salute ciclo: PIL · lavoro · inflazione · credito</div>`;
  }
  // Stagionalità (S&P 500 / Nasdaq): tachimetro del mese corrente
  const se = m.seasonality, seBox = $("#seasonality-box");
  if (seBox && se && se.score != null) {
    const cm = MONTH_NAMES[(se.current_month || 1) - 1];
    const both = se.sp_score != null && se.ndx_score != null;
    const sub = both
      ? `${cm}: S&P ${se.sp_score}% · NDX ${se.ndx_score}%`
      : `${cm} · ${se.sp_score != null ? "S&P" : "Nasdaq"}`;
    seBox.innerHTML = `<div class="mc-title">Stagionalità (${cm})</div>
      ${compactSemiGauge(se.score, ["Favorevole", "Sfavorevole"])}
      <div class="mc-value" style="color:${scoreColor(se.score)}">${se.score}% · ${se.label}</div>
      <div class="mc-sub muted">${sub}</div>`;
  }
  // Daily Tracking Error vs benchmark (oggi): portafoglio Day% − indice, come tachimetro
  const bm = m.benchmarks, teBox = $("#tracking-error-box");
  if (teBox && bm) {
    const pday = portfolioDayPct();
    const ref = bm.sp500 != null ? "sp500" : bm.ndx != null ? "ndx" : "sox";
    const refLab = { sp500: "S&P 500", ndx: "Nasdaq 100", sox: "SOX" }[ref];
    const alpha = (pday != null && bm[ref] != null) ? pday - bm[ref] : null;
    if (alpha != null) {
      const score = clamp(50 + alpha * 12);   // sovraperformance → verde
      const lab = alpha >= 0.3 ? "Sovraperforma" : alpha <= -0.3 ? "Sottoperforma" : "In linea";
      teBox.innerHTML = `<div class="mc-title">Tracking Error vs ${refLab}</div>
        ${compactSemiGauge(score, ["Sottoperf.", "Sovraperf."])}
        <div class="mc-value" style="color:${scoreColor(score)}">${signTxt(Math.round(alpha * 100) / 100)} pp · ${lab}</div>
        <div class="mc-sub muted">portaf. oggi ${pday != null ? signTxt(Math.round(pday * 100) / 100) : "—"} · clicca per dettaglio</div>`;
    } else {
      teBox.innerHTML = `<div class="mc-title">Tracking Error vs ${refLab}</div>
        ${compactSemiGauge(50, ["Sottoperf.", "Sovraperf."])}
        <div class="mc-value muted">—</div><div class="mc-sub muted">dati intraday non disponibili</div>`;
    }
  }
  // Sharpe Ratio del portafoglio (rendimento corretto per il rischio)
  const shBox = $("#sharpe-box");
  if (shBox) {
    const ps = (DATA.totals || {}).portfolio_sharpe_ratio;
    if (ps != null) {
      const score = clamp(33 + ps * 22);   // ~0=33, 1=55, 2=77, 3=99
      const lab = ps > 2 ? "Eccellente" : ps >= 1 ? "Buono" : ps >= 0 ? "Debole" : "Negativo";
      const so = (DATA.totals || {}).portfolio_sortino_ratio;
      // VaR: preferisci la stima STORICA (percentili empirici — onesta sulle code grasse)
      const varE = (DATA.totals || {}).var95_hist_eur ?? (DATA.totals || {}).var95_1d_eur;
      const subBits = [];
      if (so != null) subBits.push(`Sortino ${fmtNum.format(so)}`);
      if (varE != null) subBits.push(`VaR95 1g ${fmtEUR.format(varE)}`);
      shBox.innerHTML = `<div class="mc-title">Sharpe Ratio portafoglio</div>
        <div class="mc-value" style="color:${sharpeColor(ps)}">${fmtNum.format(ps)} · ${lab} ${metricTrend("sharpe")}</div>
        ${thermoLine(score, ["Efficiente", "Rischioso"])}
        <div class="mc-sub muted">${subBits.length ? subBits.join(" · ") : "rendimento corretto per il rischio"}</div>`;
    } else {
      shBox.innerHTML = `<div class="mc-title">Sharpe Ratio portafoglio</div>
        <div class="mc-value muted">—</div>
        ${thermoLine(50, ["Efficiente", "Rischioso"])}
        <div class="mc-sub muted">disponibile dopo la pipeline</div>`;
    }
  }
  // Margin Debt: stato condiviso 1:1 con popup e prompt (marginDebtState)
  const mdBox = $("#margin-debt-box");
  if (mdBox) {
    const mds = marginDebtState();
    if (mds) {
      const md = mds.md;
      // label qualitativa nella card (il "100% del picco" nudo era inutilmente ansiogeno):
      // i numeri esatti restano nel popup di dettaglio. Solo rendering, zero impatti sui calcoli.
      const pctLab = md.pct_of_peak >= 95 ? "Sui massimi storici"
        : md.pct_of_peak >= 80 ? "Vicino ai massimi"
        : md.pct_of_peak >= 60 ? "Zona intermedia" : "Lontano dai massimi";
      mdBox.innerHTML = `<div class="mc-title">Margin Debt (leva mercato)</div>
        <div class="mc-value" style="color:${mds.col}">${pctLab} · ${mds.labelShort}</div>
        ${thermoLine(mds.score, ["Bassa", "Estrema"])}
        <div class="mc-sub muted">${md.yoy != null ? `YoY ${signTxt(md.yoy)}` : ""} · ${md.series || "FINRA/FRED"} · ${md.date || ""}</div>`;
    } else {
      mdBox.innerHTML = `<div class="mc-title">Margin Debt (leva mercato)</div>
        <div class="mc-value muted">—</div>${thermoLine(50, ["Bassa", "Estrema"])}
        <div class="mc-sub muted">disponibile dopo la pipeline</div>`;
    }
  }
  // Beta di Portafoglio vs NDX (rischio sistematico aggregato): weighted beta MTM
  const betaBox = $("#beta-box");
  if (betaBox) {
    const pb = portfolioBeta();
    if (pb) {
      // beta 1.0 = NDX; >1.3 aggressivo (giallo/rosso), <0.8 difensivo
      const score = clamp(100 - (pb.beta - 0.5) * 55);
      const lab = pb.beta >= 1.5 ? "Molto aggressivo" : pb.beta >= 1.2 ? "Aggressivo" : pb.beta >= 0.8 ? "In linea col mercato" : "Difensivo";
      betaBox.innerHTML = `<div class="mc-title">Beta Portafoglio (vs NDX)</div>
        <div class="mc-value" style="color:${scoreColor(score)}">${fmtNum.format(pb.beta)} · ${lab}</div>
        ${thermoLine(score, ["Difensivo", "Aggressivo"])}
        <div class="mc-sub muted">${esc(pb.src)} · clicca per stress test</div>`;
    } else {
      betaBox.innerHTML = `<div class="mc-title">Beta Portafoglio (vs NDX)</div>
        <div class="mc-value muted">—</div>${thermoLine(50, ["Difensivo", "Aggressivo"])}
        <div class="mc-sub muted">disponibile dopo la pipeline</div>`;
    }
  }
  // Rischio Cambio EUR/USD: quota del NAV in USD non coperta
  const fxBox = $("#fx-box");
  if (fxBox) {
    const fx = fxExposure();
    if (fx) {
      // esposizione valutaria: oltre ~70% del NAV in USD = rischio cambio strutturale
      const score = clamp(100 - fx.pct);
      const lab = fx.pct >= 70 ? "Strutturale" : fx.pct >= 40 ? "Rilevante" : "Contenuto";
      fxBox.innerHTML = `<div class="mc-title">Rischio Cambio EUR/USD</div>
        <div class="mc-value" style="color:${scoreColor(score)}">${fmtNum.format(fx.pct)}% NAV in USD</div>
        ${thermoLine(score, ["Coperto", "Esposto"])}
        <div class="mc-sub muted">non coperto · ${lab}${fx.eurusd ? ` · EUR/USD ${fmtNum.format(fx.eurusd)}` : ""}</div>`;
    } else {
      fxBox.innerHTML = `<div class="mc-title">Rischio Cambio EUR/USD</div>
        <div class="mc-value muted">—</div>${thermoLine(50, ["Coperto", "Esposto"])}
        <div class="mc-sub muted">in attesa dei dati</div>`;
    }
  }
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
       <div class="muted" style="font-size:12px;margin-top:3px">${md.yoy != null ? `YoY ${signTxt(md.yoy)}` : ""}${md.qoq != null ? ` · trim. ${signTxt(md.qoq)}` : ""} · picco storico ${bn(md.peak)} · agg. ${md.date}</div>
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
    if (vE != null) extraRisk.push(`<div style="font-size:12.5px;margin-top:6px"><b>VaR 95% (1 giorno${isHist ? ", storico" : ", parametrico"})</b>: <b class="neg">${fmtEUR.format(vE)}</b> (${fmtNum.format(vP)}% dell'azionario) — la perdita che nel 95% dei giorni NON viene superata${isHist ? ", misurata sui percentili REALI degli ultimi 12 mesi" : ""}.${eE != null ? ` <b>Expected Shortfall</b>: <b class="neg">${fmtEUR.format(eE)}</b> — la perdita MEDIA nel 5% dei giorni peggiori (la coda oltre il VaR).` : ""}${isHist && t.var95_1d_eur != null ? ` <span class="muted">(parametrico normale: ${fmtEUR.format(t.var95_1d_eur)} — sottostima le code grasse)</span>` : ""}</div>`);
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
function portfolioHealthParts() {
  const m = DATA.macro || {};
  const parts = [];
  if (m.thermometer) parts.push(["Tecnica titoli", m.thermometer.score]);
  const dir = (typeof marketDirectionScore === "function") ? marketDirectionScore() : null;
  if (dir != null) parts.push(["Macro & mercato", dir]);
  const fin = (DATA.portfolio || []).map(r => r.fin_health).filter(v => v != null);
  if (fin.length) parts.push(["Fondamentale titoli", Math.round(avg(fin))]);
  return parts;
}
function portfolioHealthScore() {
  const p = portfolioHealthParts();
  return p.length ? Math.round(avg(p.map(x => x[1]))) : null;
}
function renderPortfolioHealth() {
  const box = $("#portfolio-health");
  if (!box) return;
  const score = portfolioHealthScore();
  if (score == null) { box.innerHTML = ""; return; }
  const lab = score >= 60 ? "Solido" : score <= 40 ? "Da monitorare" : "Equilibrato";
  box.innerHTML = `<div class="mc-title">Salute del portafoglio</div>
    <div class="mc-value" style="color:${scoreColor(score)}">${score}/100 · ${lab}</div>
    ${thermoLine(score, ["Solido", "Fragile"])}
    <div class="mc-sub muted">tecnica + macro + fondamentale</div>`;
}
function openHealthModal() {
  const score = portfolioHealthScore();
  if (score == null) return;
  const parts = portfolioHealthParts();
  openInfoModal("Salute del portafoglio",
    `<div class="info-line"><b>Punteggio complessivo:</b> <span style="color:${scoreColor(score)}">${score}/100</span> — media dei tre pilastri.</div>
     <table class="info-table"><tbody>${parts.map(p =>
      `<tr><td>${esc(p[0])}</td><td style="min-width:140px">${meterBar(p[1], scoreColor(p[1]), String(p[1]))}</td></tr>`).join("")}</tbody></table>
     <div class="info-line muted" style="margin-top:8px">Tecnica = RSI/trend/momentum medi dei titoli · Macro = direzione mercato aggregata · Fondamentale = Financial Health medio dei titoli. Verde = favorevole, rosso = rischio.</div>`);
}

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
  const rows = (mq.components || []).map(c => {
    const friendlyLab = MQ_LABELS[c.key] || MQ_LABELS[c.label?.toLowerCase()] || c.label;
    const interp = c.score >= 70 ? "Positivo per l'economia" : c.score >= 45 ? "Neutro" : "Segnale di debolezza";
    return `<tr>
      <td>${esc(friendlyLab)}</td>
      <td style="min-width:120px">${meterBar(c.score, scoreColor(c.score), String(c.score))}</td>
      <td class="muted" style="font-size:11px">${interp}</td>
    </tr>`;
  }).join("");
  const cycleDesc = mq.score >= 60
    ? "Ciclo espansivo: PIL cresce, occupazione solida, condizioni di credito normali. Favorevole per asset rischiosi (azioni, tech)."
    : mq.score >= 40
    ? "Ciclo neutro: segnali misti. Attenzione a dati macro in uscita."
    : "Rischio di recessione: PIL debole, occupazione in calo o credito sotto stress. Preferire difensivi e ridurre rischio.";
  openInfoModal(`MacroQuant — Ciclo economico: ${mq.score}%`,
    `<div class="info-line" style="margin-bottom:8px">${cycleDesc}</div>
     <div class="info-line"><b>Punteggio composito:</b> <b style="color:${scoreColor(mq.score)}">${mq.score}/100</b> — <span class="muted">100 = ciclo perfetto di crescita, 0 = recessione in atto</span></div>
     <h4 style="margin:10px 0 4px">Cosa compone il punteggio</h4>
     <table class="info-table"><thead><tr><th>Indicatore</th><th>Score</th><th>Interpretazione</th></tr></thead><tbody>${rows}</tbody></table>
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
     <div class="info-line muted" style="font-size:11px;margin-top:8px">Usa "Copia prompt AI" per il piano operativo dettagliato di rotazione/de-risking con indicazioni precise per ogni posizione.</div>`);
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
    <div class="info-line muted" style="font-size:11px;margin-top:8px">Per il piano operativo dettagliato di rotazione/de-risking usa "Copia prompt AI".</div>`);
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
function renderKPI() {
  const t = DATA.totals;
  const b = DATA.broker;
  // i totali sono calcolati da recomputeTotals usando lo snapshot reale del broker (bval/bgain)
  const controvalore = t.eur_invested;               // controvalore investimenti (no liquidità)
  const invested = t.eur_cost;                        // capitale investito (costo)
  const gain = t.eur_gain;
  const gainPct = t.eur_gain_pct;
  const net = t.eur_gain_net ?? t.eur_gain;
  const src = (b && b.as_of) ? `dati broker · agg. ${new Date(b.as_of).toLocaleDateString("it-IT")}` : "stima dai prezzi";
  // la liquidità la inserisce l'utente: patrimonio = investimenti + liquidità
  const patrimonio = controvalore + cashEur;
  const kpis = [
    { label: "Patrimonio totale (€)", value: fmtEUR.format(patrimonio),
      sub: `investimenti ${fmtEUR.format(controvalore)}${cashEur > 0 ? ` + liquidità ${fmtEUR.format(cashEur)}` : " · liquidità da inserire"}`,
      accent: "var(--blue)" },
    { label: "Capitale investito (€)", value: fmtEUR.format(invested),
      sub: src, accent: "var(--purple)" },
    { label: "Guadagno totale (€)", value: signTxt(Math.round(gain), " €"),
      sub: `${signTxt(Math.round(gainPct * 100) / 100)} sul capitale investito`,
      subCls: signCls(gain), accent: gain >= 0 ? "var(--green)" : "var(--red)", valueCls: signCls(gain) },
    { label: "Guadagno netto tasse (€)", value: signTxt(Math.round(net), " €"),
      sub: `dopo tasse stimate (26% azioni · 12,5% BTP)${b && b.cedole_btp ? ` · cedole BTP ${fmtEUR.format(b.cedole_btp)}` : ""}`,
      subCls: signCls(net), accent: net >= 0 ? "var(--green)" : "var(--red)", valueCls: signCls(net) },
  ];
  // Daily Tracking Error e Sharpe Ratio: ora mini-card con termometro tra i tab macro
  // (renderMiniCards → #tracking-error-box, #sharpe-box). Niente più KPI dedicate.

  $("#kpi-grid").innerHTML = kpis.map(k => `
    <div class="kpi${k.kpiKey ? " kpi-click" : ""}" style="--accent:${k.accent}"${k.kpiKey ? ` data-kpi="${k.kpiKey}" role="button" tabindex="0" title="Clicca per il dettaglio"` : ""}>
      <div class="label">${k.label}</div>
      <div class="value ${k.valueCls || ""}"${k.valueStyle ? ` style="${k.valueStyle}"` : ""}>${k.value}</div>
      <div class="sub ${k.subCls || ""}">${k.sub || ""}</div>
    </div>`).join("");

  // DETTAGLIO PROFITTO PER VALUTA (stile broker): azioni USD + obbligazioni EUR
  const pbc = $("#profit-by-currency");
  if (pbc) {
    const usdG = t.usd_gain, usdGp = t.usd_gain_pct;
    const btp = (DATA.portfolio || []).find(r => r.ticker === "BTP-V28");
    const btpGp = btp?.gain_pct, btpG = t.eur_btp_gain;
    const row = (lab, pct, abs, cur) => pct == null ? "" :
      `<div class="pbc-row"><span class="pbc-lab">${lab}</span>
        <span class="pbc-val ${signCls(pct)}">${signTxt(Math.round(pct * 100) / 100)} <span class="muted">(${signTxt(Math.round(abs), " " + cur)})</span></span></div>`;
    pbc.innerHTML = `<div class="pbc-head muted">Dettaglio profitto per valuta</div>
      ${row("EUR (BTP)", btpGp, btpG, "€")}
      ${row("USD (azioni)", usdGp, usdG, "$")}`;
  }

}

/* Popup "Beta di Portafoglio": weighted beta, contributi per titolo e stress test vs Nasdaq */
function openBetaSimulator() {
  const t = DATA.totals;
  const patrimonio = t.eur_invested + cashEur;
  const pb = portfolioBeta();
  if (!pb) { toast("Beta non disponibile per il portafoglio"); return; }
  const scenarios = [-10, -15, -20, -30, -40];
  const rows = scenarios.map(ndxChg => {
    const ptfChg = ndxChg * pb.beta;
    const lossEur = t.eur_invested * ptfChg / 100;
    return `<tr>
      <td class="num neg">Nasdaq ${ndxChg}%</td>
      <td class="num neg">${signTxt(Math.round(ptfChg * 10) / 10)}</td>
      <td class="num neg">${signTxt(Math.round(lossEur), " €")}</td>
      <td class="num">${fmtEUR.format(Math.round(patrimonio + lossEur))}</td>
    </tr>`;
  }).join("");
  const holdings = (DATA.portfolio || []).filter(r => betaOf(r) != null && (r.val_eur || 0) > 0);
  const tkBetas = holdings.slice().sort((a, b) => betaOf(b) - betaOf(a)).map(r => {
    const b = betaOf(r);
    const w = positionWeightPct(r);
    const srcTag = r.beta_ndx != null ? "" : (r.ticker === "BTP-V28" ? "" : "*");
    return `<span>${r.ticker} <b style="color:${scoreColor(clamp(100 - (b - 0.5) * 55))}">${fmtNum.format(b)}${srcTag}</b>${w != null ? ` <span class="muted">(${fmtNum.format(w)}%)</span>` : ""}</span>`;
  }).join(" · ");
  const anyFallback = holdings.some(r => r.beta_ndx == null && r.ticker !== "BTP-V28");
  openInfoModal("Beta di Portafoglio vs Nasdaq 100 — rischio sistematico", `
    <div class="info-line muted" style="font-size:11.5px;margin-bottom:8px">Beta di Portafoglio = Σ (beta del titolo × peso % <b>mark-to-market</b> sul capitale investito, liquidità esclusa). Il beta di ogni titolo è la <b>regressione dei log-rendimenti giornalieri 12M vs Nasdaq 100</b> (il benchmark del mandato), non il beta 5A di Yahoo. Beta 1,4 → una discesa del NDX del 10% pesa ~14% sul portafoglio. Il BTP conta con beta 0.</div>
    <div class="info-line"><b>Beta di Portafoglio:</b> <b style="font-family:var(--mono);font-size:18px">${fmtNum.format(pb.beta)}</b> <span class="muted">(vs NDX 1.0 · ${esc(pb.src)})</span></div>
    <div class="info-line"><b>Capitale investito:</b> ${fmtEUR.format(Math.round(t.eur_invested))} · liquidità ${fmtEUR.format(cashEur)}</div>
    <div class="info-line muted" style="font-size:11px;margin-bottom:10px">Beta × peso per titolo: ${tkBetas}${anyFallback ? ` <span class="muted">(* = fallback Yahoo, in attesa del run pipeline)</span>` : ""}</div>
    <table class="info-table"><thead><tr><th>Scenario Nasdaq 100</th><th>Impatto stim.</th><th>P&amp;L stimato</th><th>Patrimonio risultante</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="info-line muted" style="font-size:11px;margin-top:8px">Formula: impatto = Δ% NDX × Beta di Portafoglio, applicato al solo capitale investito. Non considera ribilanciamento, stop 2×ATR o coperture: è lo scenario passivo peggiore.</div>`);
}

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
function renderBtpInfo() {
  const box = $("#btp-info");
  if (!box) return;
  const cedoleInc = DATA.broker?.cedole_btp;
  // BTP Valore Ott 2028: cedola trimestrale (10 gen/apr/lug/ott), 4,10% fino a ott 2026 poi 4,50%
  const nominal = 40000, now = new Date();
  let next = null;
  for (let y = now.getFullYear(); y <= now.getFullYear() + 1 && !next; y++)
    for (const mth of [0, 3, 6, 9]) {
      const d = new Date(y, mth, 10);
      if (d > now) { next = d; break; }
    }
  const rate = next && next < new Date(2026, 9, 11) ? 0.041 : 0.045;
  const grossQ = Math.round(nominal * rate / 4), netQ = Math.round(grossQ * (1 - 0.125));
  const nextStr = next ? next.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }) : "—";
  // niente più blocco capitale/patrimonio qui (era duplicato e in conflitto con i KPI broker in alto)
  box.innerHTML =
    `<div class="btp-line">BTP Valore Ott 2028 — ${cedoleInc != null ? `cedole incassate ${fmtEUR.format(cedoleInc)} lorde · ` : ""}prossima cedola ${nextStr}: ${fmtEUR.format(grossQ)} lordi (${fmtEUR.format(netQ)} netti, tassazione 12,5%).</div>`;
}

/* ---------------- asset allocation (donut) ---------------- */
let allocMode = "ticker";   // ticker | sector
const ALLOC_COLORS = ["#4c8dff", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#22d3ee",
  "#ec4899", "#14b8a6", "#a3a3a3", "#eab308", "#6366f1"];

function renderAllocation() {
  const src = DATA.allocation || [];
  if (!src.length) { $("#alloc-donut").innerHTML = ""; $("#alloc-legend").innerHTML = ""; return; }
  let list;
  if (allocMode === "sector") {
    const by = {};
    src.forEach(x => {
      const s = x.sector || "Altro";
      (by[s] = by[s] || { value_eur: 0, gain_eur: 0, hasGain: false }).value_eur += x.value_eur;
      if (x.gain_eur != null) { by[s].gain_eur += x.gain_eur; by[s].hasGain = true; }
    });
    list = Object.entries(by).map(([name, o]) => ({
      name, ticker: "", value_eur: o.value_eur,
      gain_eur: o.hasGain ? o.gain_eur : null,
      gain_pct: (o.hasGain && (o.value_eur - o.gain_eur) > 0) ? Math.round(o.gain_eur / (o.value_eur - o.gain_eur) * 1000) / 10 : null,
    })).sort((a, b) => b.value_eur - a.value_eur);
  } else {
    list = src;
  }
  const total = list.reduce((s, x) => s + x.value_eur, 0);
  const R = 70, r = 44, cx = 80, cy = 80;
  let a0 = -Math.PI / 2;
  const arcs = list.map((x, i) => {
    const frac = x.value_eur / total;
    const a1 = a0 + frac * 2 * Math.PI;
    const large = frac > 0.5 ? 1 : 0;
    const p = (ang, rad) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    const d = `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`;
    a0 = a1;
    return `<path d="${d}" fill="${ALLOC_COLORS[i % ALLOC_COLORS.length]}" class="alloc-arc" style="cursor:pointer"
      data-name="${esc(x.name)}" data-pct="${(frac * 100).toFixed(1)}" data-val="${Math.round(x.value_eur)}">
      <title>${esc(x.name)}: ${fmtEUR.format(x.value_eur)} (${(frac * 100).toFixed(1)}%)</title></path>`;
  }).join("");
  const totalTxt = fmtEUR.format(Math.round(total));
  $("#alloc-donut").innerHTML = `<svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Ripartizione del portafoglio">
    ${arcs}
    <circle cx="80" cy="80" r="44" fill="transparent" id="alloc-center" style="cursor:pointer"><title>Clicca al centro per tornare al totale</title></circle>
    <text x="80" y="74" text-anchor="middle" font-size="10" fill="var(--muted)" id="alloc-c1" pointer-events="none">Totale</text>
    <text x="80" y="90" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)" id="alloc-c2" pointer-events="none">${totalTxt}</text>
    <text x="80" y="104" text-anchor="middle" font-size="9" fill="var(--muted)" id="alloc-c3" pointer-events="none"></text>
  </svg>`;
  const resetCenter = () => {
    $("#alloc-c1").textContent = "Totale";
    $("#alloc-c2").textContent = totalTxt;
    $("#alloc-c3").textContent = "";
  };
  $("#alloc-donut").querySelectorAll(".alloc-arc").forEach(pth => {
    pth.addEventListener("click", () => {
      $("#alloc-c1").textContent = pth.dataset.name;
      $("#alloc-c2").textContent = pth.dataset.pct + "%";
      $("#alloc-c3").textContent = fmtEUR.format(+pth.dataset.val);
      toast(`${pth.dataset.name}: ${pth.dataset.pct}% · ${fmtEUR.format(+pth.dataset.val)}`);
    });
  });
  $("#alloc-center").addEventListener("click", resetCenter);
  $("#alloc-legend").innerHTML = list.map((x, i) => {
    const pct = (x.value_eur / total * 100).toFixed(1);
    // guadagno/perdita della posizione: freccia verde ↑ se in gain, rossa ↓ se in perdita
    const g = x.gain_pct, ge = x.gain_eur;
    const gainHtml = (g != null && ge != null)
      ? `<span class="alloc-gain ${g >= 0 ? "pos" : "neg"}" title="P&L della posizione: ${signTxt(Math.round(ge), " €")}">${g >= 0 ? "▲" : "▼"} ${signTxt(g)} <span class="alloc-gain-eur">(${signTxt(Math.round(ge), " €")})</span></span>`
      : "";
    return `<li class="alloc-item">
      <span class="alloc-dot" style="background:${ALLOC_COLORS[i % ALLOC_COLORS.length]}"></span>
      <span class="alloc-name">${esc(x.name)} ${x.ticker ? `<span class="tk">${x.ticker}</span>` : ""}${x.ticker && x.sector ? ` <span class="muted" style="font-size:10px">(${esc(x.sector)})</span>` : ""} ${gainHtml}</span>
      <span class="alloc-pct">${pct}%</span>
      <span class="alloc-val muted">${fmtEUR.format(Math.round(x.value_eur))}</span>
    </li>`;
  }).join("");
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

function targetBar(r) {
  if (!r || r.upside_pct === null || r.upside_pct === undefined) return "—";
  const u = r.upside_pct;   // upside alto = verde, negativo = rosso
  return meterBar(Math.abs(u) * 2, scoreColor(clamp(50 + u * 2.5)), signTxt(u));
}

function betaBar(r) {
  // beta vs NDX dalla regressione pipeline (betaOf), fallback Yahoo se non ancora disponibile
  const beta = typeof r === "object" ? betaOf(r) : r;
  const tk = typeof r === "object" ? r.ticker : null;
  const src = typeof r === "object" && r.beta_ndx != null ? "regressione 12M vs NDX" : "Yahoo (5A vs S&P)";
  if (beta === null || beta === undefined) return "—";
  const bar = meterBar(Math.min(beta, 3) / 3 * 100, scoreColor(clamp(100 - (beta - 0.5) * 55)), fmtNum.format(beta));
  if (!tk) return bar;
  return `<button class="beta-btn" data-beta-tk="${tk}" title="Beta ${src} — clicca per lo stress test di portafoglio">${bar}</button>`;
}

function prepostCell(pp) {
  if (!pp || !pp.price) return '<span class="muted">—</span>';
  return `<span class="muted" style="font-size:10px">${pp.label}</span> ${fmtNum.format(pp.price)}
    <span class="${signCls(pp.change_pct)}">${signTxt(pp.change_pct)}</span>`;
}

function fmtVolume(v) {
  if (!v) return "—";
  if (v >= 1e9) return fmtNum.format(v / 1e9) + "B";
  if (v >= 1e6) return fmtNum.format(v / 1e6) + "M";
  if (v >= 1e3) return fmtNum.format(v / 1e3) + "K";
  return String(v);
}

/* cella Volume con RVol (Volume Relativo = volume oggi / media 30gg, dalla pipeline):
   RVol > 1.5 = flussi anomali (istituzionali in movimento) → flag [Volumi Anomali] */
function volumeCell(r) {
  const rv = r.vol_ratio;
  const rvHtml = rv != null
    ? `<br><span style="font-size:9.5px;color:${rv > 1.5 ? "var(--yellow)" : "var(--muted)"};font-family:var(--mono)">RVol ${fmtNum.format(rv)}×</span>${rv > 1.5 ? `<br><span class="badge badge-anom" title="Volume Relativo ${fmtNum.format(rv)}× la media 30gg: flussi anomali in corso (accumulo/distribuzione istituzionale o evento). Incrociare con news e price action.">[Volumi Anomali]</span>` : ""}`
    : "";
  return `<td class="num">${fmtVolume(r.volume)}${rvHtml}</td>`;
}

function rsBar(rs, bench) {
  if (rs == null) return "—";
  const color = rs >= 2 ? "var(--green)" : rs <= -2 ? "var(--red)" : "var(--muted)";
  const bl = bench === "sox" ? "SOX" : bench === "ndx" ? "NDX" : "S&P";
  const blHtml = bench ? ` <span class="muted" style="font-size:9px;vertical-align:middle">${bl}</span>` : "";
  return `<span class="${rs > 0 ? "pos" : rs < 0 ? "neg" : ""}" style="font-family:var(--mono);font-size:12px;color:${color}">${rs > 0 ? "+" : ""}${fmtNum.format(rs)}%</span>${blHtml}`;
}

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
    row("Segnale", `<span class="badge ${r.signal_class}">${r.signal}</span>`),
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

function shortFloatCell(r) {
  const sf = (r.stats || {}).short_float;
  if (sf == null) return `<td class="num muted">—</td>`;
  const pct = Math.round(sf * 1000) / 10;
  const squeeze = pct > 12;
  return `<td class="num">${pct}%${squeeze ? `<br><span class="badge badge-squeeze badge-info" data-badge="squeeze" role="button" tabindex="0" title="Clicca per la spiegazione">[Squeeze Risk]</span>` : ""}</td>`;
}

/* Flottante: azioni liberamente scambiabili. Evidenzia il rischio short squeeze quando il
   float è ridotto (<50M) E lo short interest è elevato (>=15%) E i volumi sono anomali (>1,5×). */
function floatCell(r) {
  const st = r.stats || {};
  const fs = st.float_shares;
  if (fs == null) return `<td class="num muted">—</td>`;
  const txt = fs >= 1e9 ? (fs / 1e9).toFixed(1) + "B" : Math.round(fs / 1e6) + "M";
  const pct = st.float_pct != null ? `<br><span class="muted" style="font-size:9px">${fmtNum.format(st.float_pct)}%</span>` : "";
  const squeeze = fs < 50e6 && (st.short_float ?? 0) >= 0.15 && (r.vol_ratio ?? 0) > 1.5;
  return `<td class="num" title="Flottante ${fmtNum.format(Math.round(fs / 1e6))}M azioni${st.float_pct != null ? ` (${fmtNum.format(st.float_pct)}% del totale)` : ""}${squeeze ? " — LOW FLOAT + Short≥15% + RVol>1,5: rischio short squeeze" : ""}">${squeeze ? `<b class="neg">${txt}</b>` : txt}${pct}${squeeze ? `<br><span class="badge badge-squeeze">[LOW FLOAT]</span>` : ""}</td>`;
}

function drawdownCell(r) {
  const d = r.w52_dist_pct;
  if (d == null) return `<td class="num muted">—</td>`;
  if (d <= -25) {
    return `<td class="num"><span class="neg">${signTxt(d)}</span><br><span class="badge badge-deep-value badge-info" data-badge="deepvalue" role="button" tabindex="0" title="Clicca per la spiegazione">[DEEP VALUE]</span></td>`;
  }
  if (d <= -15) {
    return `<td class="num"><span class="neg">${signTxt(d)}</span><br><span class="badge badge-correction badge-info" data-badge="correction" role="button" tabindex="0" title="Clicca per la spiegazione">[CORRECTION: Z1]</span></td>`;
  }
  return `<td class="num"><span class="${d < 0 ? "neg" : "pos"}">${signTxt(d)}</span></td>`;
}

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
function sharpeCell(r) {
  const s = r.sharpe_1y;
  if (s == null) return `<td class="num muted">—</td>`;
  return `<td class="num sharpe-cell" data-sharpe-tk="${r.ticker}" role="button" tabindex="0" title="Sharpe Ratio 12 mesi — clicca per la spiegazione"><b style="color:${sharpeColor(s)};font-family:var(--mono)">${fmtNum.format(s)}</b></td>`;
}

function sortinoCell(r) {
  const s = r.sortino_1y;
  if (s == null) return `<td class="num muted" title="Sortino n.d. — arriva col prossimo run della pipeline">—</td>`;
  const veto = s < -0.3;
  return `<td class="num" title="Sortino 12 mesi (solo volatilità negativa) — metro del veto value trap${veto ? ": SOTTO la soglia -0.3" : ""}"><b style="color:${veto ? "var(--red)" : sharpeColor(s)};font-family:var(--mono)">${fmtNum.format(s)}</b>${veto ? '<br><span class="badge badge-squeeze">[VETO]</span>' : ""}</td>`;
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

function techCells(r) {
  const c = cur(r);
  // supporto/resistenza cambiano con il range selezionato (1S/1M/3M/1A)
  const tw = (r.tech_by_range || {})[sparkRange];
  const support = tw ? tw.support : r.support;
  const resistance = tw ? tw.resistance : r.resistance;
  // Δ SMA200: sopra la media di lungo = trend sano; sotto = trend compromesso (price action pura)
  const sma = r.sma200_dist_pct;
  const smaCell = sma != null
    ? `<td class="num"><span class="${sma >= 0 ? "pos" : "neg"}">${signTxt(sma)}</span></td>`
    : `<td class="num muted">n.d.</td>`;
  return `
      <td class="num">${betaBar(r)}</td>
      ${sharpeCell(r)}
      ${sortinoCell(r)}
      <td class="num">${support ? c + fmtNum.format(support) : "—"}</td>
      <td class="num">${resistance ? c + fmtNum.format(resistance) : "—"}</td>
      ${smaCell}
      <td class="num rs-cell" data-rs-tk="${r.ticker}" role="button" tabindex="0" title="Clicca per la spiegazione della forza relativa (RS)">${rsBar(r.rs_1m, r.rs_bench)}</td>
      ${r.rs_ndx_1m != null
        ? `<td class="num" title="Sovra/sotto-performance a 1 mese vs Nasdaq 100 (metro del mandato)"><span class="${signCls(r.rs_ndx_1m)}">${signTxt(r.rs_ndx_1m, " pp")}</span></td>`
        : `<td class="num muted" title="Disponibile dopo il prossimo run della pipeline">n.d.</td>`}
      <td title="Logica del segnale: prezzo vs SMA50/SMA200 (trend) + RSI(14), calcolati su base giornaliera (daily). Golden setup = prezzo > SMA50 > SMA200 con RSI non estremo."><span class="badge ${r.signal_class}">${r.signal}</span>${r.qty && r.stop_violated ? `<br><span class="badge badge-earnrisk" title="Il prezzo è SOTTO lo stop trailing ancorato ($${fmtNum.format(r.stop_atr)}): la disciplina prevede uscita o ri-arm consapevole. Lo stop ratchet non si riabbassa da solo.">[STOP VIOLATO]</span>` : ""}</td>
      ${shortFloatCell(r)}
      ${floatCell(r)}
      ${drawdownCell(r)}
      ${optImpactCell(r.ticker)}
      ${earningsCell(r)}
      <td class="spark-cell" data-tk="${r.ticker}" title="Clicca per ingrandire">${sparkline((r.sparks || {})[sparkRange])}</td>`;
}

/* trimestrale entro 14 giorni solari = rischio evento binario → flag [!EARNINGS RISK] */
function earningsRiskDays(r) {
  if (!r.earnings_date) return null;
  const days = Math.ceil((new Date(r.earnings_date) - Date.now()) / 86400000);
  return (days >= 0 && days < 14) ? days : null;
}

/* cella Trimestrale in tabella: data earnings + Implied Move (±%) + flag rischio evento */
function earningsCell(r) {
  if (!r.earnings_date) return `<td class="num muted">—</td>`;
  const days = Math.ceil((new Date(r.earnings_date) - Date.now()) / 86400000);
  if (days < -1) return `<td class="num muted">—</td>`;
  const d = new Date(r.earnings_date).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
  const col = days <= 7 ? "var(--red)" : days <= 21 ? "var(--yellow)" : "var(--muted)";
  const im = typeof impliedMoveForEarnings === "function" ? impliedMoveForEarnings(r) : null;
  const imHtml = im != null ? `<br><span style="font-size:9px;color:${im >= 10 ? "var(--yellow)" : "var(--muted)"}">±${im}%</span>` : "";
  const riskHtml = earningsRiskDays(r) != null
    ? `<br><span class="badge badge-earnrisk" title="Trimestrale tra ${days} giorni (<14): rischio evento binario — il gap post-earnings può scavalcare stop e supporti. Dimensiona/copri di conseguenza.">[!EARNINGS RISK]</span>` : "";
  return `<td class="num" style="white-space:nowrap"><span style="color:${col}">${d}</span>${imHtml}${riskHtml}</td>`;
}

function optImpactCell(ticker) {
  const chain = optChain(ticker);
  if (!chain || !(chain.expiries || []).length) return `<td class="num opt-col">—</td>`;
  const exp = chain.expiries[0];
  const avgVol = chain.avg_volume || 0;
  const optVol = exp.opt_volume || 0;
  const cw = exp.call_wall, pw = exp.put_wall;
  if (!avgVol) return `<td class="opt-col" style="cursor:pointer" data-opt="${ticker}">
    <span class="opt-col-walls muted">${cw ? "CW " + fmtNum.format(cw) : ""}${cw && pw ? " · " : ""}${pw ? "PW " + fmtNum.format(pw) : ""}</span>
  </td>`;
  const ratioPct = optVol * 100 / avgVol * 100;
  const fill = Math.max(2, Math.min(100, ratioPct));
  const [lab, , col] = ratioPct >= 30 ? ["ALTO", "", "var(--red)"]
                     : ratioPct >= 10 ? ["MEDIO", "", "var(--yellow)"]
                     : ["BASSO", "", "var(--green)"];
  return `<td class="opt-col" style="cursor:pointer" data-opt="${ticker}">
    <div class="opt-col-bar-wrap">
      <div class="opt-col-bar-track"><div class="opt-col-bar-fill" style="width:${fill.toFixed(0)}%;background:${col}"></div></div>
      <span class="opt-col-lab" style="color:${col}">${lab}</span>
    </div>
    ${(cw || pw) ? `<div class="opt-col-walls muted">${cw ? "CW " + fmtNum.format(cw) : ""}${cw && pw ? " · " : ""}${pw ? "PW " + fmtNum.format(pw) : ""}</div>` : ""}
  </td>`;
}

function finHealthBar(r) {
  if (r.fin_health === null || r.fin_health === undefined) return "—";
  const m3 = (r.financials || []).slice(-3).map(f => f.margin);
  const avgM = m3.length ? (m3.reduce((a, b) => a + b, 0) / m3.length).toFixed(1) : "—";
  const lab = r.fin_health >= 71 ? "Eccellente" : r.fin_health > 40 ? "Solido" : "Debole";
  return `<button class="fin-health" data-fin="${r.ticker}" title="${lab} — margine netto medio 3 anni: ${avgM}%">
    <span class="meter-txt">${r.fin_health}</span>
    <span class="meter-track"><span class="meter-fill" style="width:${Math.max(4, r.fin_health)}%;background:${scoreColor(r.fin_health)}"></span></span>
  </button>`;
}

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

async function fetchOHLC(symbol, range, interval) {
  const yurl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  for (const make of CORS_PROXIES) {
    try {
      const r = await fetch(make(yurl), { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      const q = res?.indicators?.quote?.[0];
      if (!res?.timestamp || !q) continue;
      const out = [];
      for (let i = 0; i < res.timestamp.length; i++) {
        if (q.open[i] == null || q.close[i] == null) continue;
        out.push({ t: res.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      }
      if (out.length > 1) return out;
    } catch { /* prossimo proxy */ }
  }
  return null;
}

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

function miniDualChart(pts1, pts2, { w = 420, h = 80, color1 = "var(--blue)", color2 = "var(--green)", label1 = "A", label2 = "B" } = {}) {
  if (!pts1?.length || !pts2?.length) return '<div class="muted">Dati non disponibili</div>';
  const all = [...pts1.map(p => p.v), ...pts2.map(p => p.v)];
  const mn = Math.min(...all), mx = Math.max(...all), rng = mx - mn || 1;
  const px = (i, len) => ((i / (len - 1)) * (w - 4) + 2).toFixed(1);
  const py = v => (h - 4 - (v - mn) / rng * (h - 8) + 2).toFixed(1);
  const poly = (pts) => pts.map((p, i) => `${px(i, pts.length)},${py(p.v)}`).join(" ");
  const b100 = mn <= 100 && 100 <= mx ? `<line x1="0" y1="${py(100)}" x2="${w}" y2="${py(100)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 2"/>` : "";
  return `<div class="mini-chart-wrap">
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block">${b100}
      <polyline points="${poly(pts2)}" fill="none" stroke="${color2}" stroke-width="1.8"/>
      <polyline points="${poly(pts1)}" fill="none" stroke="${color1}" stroke-width="2"/>
      <circle cx="${px(pts1.length-1,pts1.length)}" cy="${py(pts1[pts1.length-1].v)}" r="3" fill="${color1}"/>
      <circle cx="${px(pts2.length-1,pts2.length)}" cy="${py(pts2[pts2.length-1].v)}" r="3" fill="${color2}"/>
    </svg>
    <div class="mini-chart-legend"><span style="color:${color1}">—</span> ${label1} &nbsp; <span style="color:${color2}">—</span> ${label2} &nbsp; <span class="muted">— base 100</span></div>
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
  "in:pmi": ["Fiducia consumatori", "Sentiment delle famiglie USA (Univ. Michigan).", "Mensile (preliminare + finale)", /fiducia|sentiment|consumer|michigan/i],
  "in:curve": ["Curva 10A-2A", "Spread dei rendimenti; se negativo (inversione) storico segnale di recessione.", "Aggiornato in continuo", /curva|treasur|yield|recess|rendiment/i],
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
    extra = `<div class="info-line"><b>Range attuale:</b> ${fw.target_range} · implicito ${fmtNum.format(fw.implied_rate)}%</div>
      <div class="info-line"><b>Probabilità taglio prossima riunione:</b> ${fw.next_cut_prob}%</div>`;
    if ((fw.meetings || []).length) {
      extra += `<table class="info-table"><thead><tr><th>Riunione FOMC</th><th>Taglio</th><th>Invariato</th></tr></thead><tbody>`
        + fw.meetings.map(mt => `<tr><td>${new Date(mt.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}</td>
          <td class="pos">${mt.cut_prob}%</td><td>${mt.hold_prob}%</td></tr>`).join("")
        + `</tbody></table><div class="info-line muted" style="font-size:11px">Probabilità stimate dai futures sui Fed Funds (stile CME FedWatch).</div>`;
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
        Volumi sulle prime due scadenze. <b>Per il portafoglio:</b> un ratio in forte salita segnala aumento di copertura (possibile risk-off in arrivo); un ratio molto basso segnala compiacenza (rischio di correzione su sorprese negative).
      </div>`;
    // QUADRUPLE WITCHING (4 streghe): per ogni titolo (portafoglio + watchlist) la barra indica
    // la PRESSIONE DI ROLLING/CHIUSURA dei contratti (volume opzioni vs volume medio del titolo +
    // open interest in scadenza), NON il tempo che manca.
    const w = m.witching;
    const seen = new Set();
    const optTk = [...(DATA.portfolio || []), ...(DATA.watchlist || [])]
      .filter(r => { if (seen.has(r.ticker) || !DATA.options?.[r.ticker]?.expiries?.length) return false; seen.add(r.ticker); return true; });
    if (optTk.length) {
      const rows = optTk.map(r => {
        const ch = DATA.options[r.ticker], ex = ch.expiries[0];
        const callOI = (ex.calls || []).reduce((s, o) => s + (o.oi || 0), 0);
        const putOI = (ex.puts || []).reduce((s, o) => s + (o.oi || 0), 0);
        const totOI = callOI + putOI;
        const pcr = callOI ? putOI / callOI : null;
        const ratio = ch.avg_volume ? (ex.opt_volume || 0) * 100 / ch.avg_volume * 100 : 0;
        const lvl = ratio >= 30 ? ["ALTO", "var(--red)"] : ratio >= 10 ? ["MEDIO", "var(--yellow)"] : ["BASSO", "var(--green)"];
        const bw = Math.max(4, Math.min(100, ratio));
        return `<tr><td><b>${r.ticker}</b></td>
          <td class="num pos">${ex.call_wall ? cur(r) + fmtNum.format(ex.call_wall) : "—"}</td>
          <td class="num neg">${ex.put_wall ? cur(r) + fmtNum.format(ex.put_wall) : "—"}</td>
          <td class="num">${totOI ? fmtBig(totOI) : "—"}</td>
          <td class="num">${pcr != null ? fmtNum.format(Math.round(pcr * 100) / 100) : "—"}</td>
          <td><span class="roll-bar"><span class="roll-fill" style="width:${bw.toFixed(0)}%;background:${lvl[1]}"></span></span> <span style="color:${lvl[1]};font-size:11px;font-family:var(--mono)">${lvl[0]}</span></td></tr>`;
      }).join("");
      extra += `<h4 style="margin:14px 0 4px">Quadruple Witching (4 streghe) — pressione di rolling per titolo</h4>
        <div class="info-line muted" style="font-size:11px;margin-bottom:4px">Alle "4 streghe" (3° venerdì di mar/giu/set/dic) gli operatori devono <b>chiudere o rinnovare (rolling)</b> i contratti in scadenza: si generano volumi record e alta volatilità, con il prezzo "attratto" verso i muri di opzioni (Call/Put Wall). La <b>barra</b> misura la pressione di rolling del titolo = volume opzioni rispetto al volume medio (ALTO = forte attività derivati).${w?.next ? ` Prossima scadenza: <b>${new Date(w.next).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })}</b>.` : ""}</div>
        <table class="info-table"><thead><tr><th>Titolo</th><th>Call Wall</th><th>Put Wall</th><th>OI tot.</th><th>P/C OI</th><th>Pressione rolling</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="info-line muted" style="font-size:11px;margin-top:6px">OI tot. = open interest totale (call+put) sulla scadenza più vicina · P/C OI = rapporto put/call OI. Strategia: nei giorni di scadenza attenzione agli spike intraday; valuta di chiudere/rollare le tue opzioni 1-2 giorni prima.</div>`;
    }
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
          <div class="dual-idx-val" style="color:${smCol}">${sm.score}/100 &middot; ${sm.label}</div>
        </div>
        ${fgScore != null ? `<div class="dual-idx-block">
          ${compactSemiGauge(fgScore, ["Paura", "Avidità"])}
          <div class="dual-idx-label">Retail (Fear &amp; Greed)</div>
          <div class="dual-idx-val" style="color:${scoreColor(fgScore)}">${fgScore}/100${fgLabel ? ` &middot; ${fgLabel}` : ""}</div>
        </div>` : ""}
      </div>
      <div class="info-line"><b>Posizionamento istituzionale:</b> <span style="color:${smCol}">${sm.score}/100 — ${sm.label}</span></div>
      ${thermoBar(sm.score, ["Bullish (Long)", "Bearish (Short)"])}`;
    const arrow = d => d === "rialzista" ? '<span class="pos">▲ rialzista</span>' : d === "ribassista" ? '<span class="neg">▼ ribassista</span>' : '<span class="muted">laterale</span>';
    const smcIdx = sm.smc_indices || {};
    const smcCard = (s) => {
      if (!s) return "";
      const c = scoreColor(s.bias);
      return `<div class="smc-card">
        <div class="smc-head"><b>${esc(s.label_idx || "")}</b> <span style="color:${c}">${s.bias}/100 · ${s.label}</span></div>
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
      <h4 style="margin:12px 0 4px">P/E S&amp;P 500 — storico 10 anni (mensile, FRED)</h4>
      ${miniLineChart(pe.history, { color: "var(--yellow)", zeroLine: false })}
      <div class="info-line muted" style="font-size:11px;margin-top:6px">
        <b>Implicazione per il portafoglio:</b> P/E elevato significa che ogni dollaro di utile è pagato di più.
        In scenari di rialzo dei tassi + P/E &gt;25, i multipli tendono a comprimersi (-15% / -30% dall'inizio storico).
        Suggerito: privilegiare titoli con P/E inferiore alla media settoriale e FCF yield elevato.
      </div>`;
  } else if (key === "corp_profit" && m.corp_profit) {
    const cp = m.corp_profit;
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
  const days = r.earnings_date ? Math.ceil((new Date(r.earnings_date) - Date.now()) / 86400000) : null;
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
function nameDelBtn(section, ticker) {
  if (ticker === "BTP-V28") return "";
  return `<button class="row-del row-del-inline" data-sec="${section}" data-tk="${ticker}" title="Rimuovi ${ticker}" aria-label="Rimuovi ${ticker}">×</button>`;
}

// modifica quantità e prezzo medio di carico di una posizione esistente
function editPosition(ticker) {
  const r = (DATA.portfolio || []).find(x => x.ticker === ticker);
  if (!r) return;
  const qty = parseFloat(window.prompt(`Nuova quantità di ${ticker}:`, r.qty) || "");
  if (!(qty >= 0)) { toast("Quantità non valida"); return; }
  const pmc = parseFloat(window.prompt(`Nuovo prezzo medio di carico (PMC) di ${ticker}:`, r.pmc) || "");
  if (!(pmc > 0)) { toast("PMC non valido"); return; }
  // aggiornamento IMMEDIATO su dashboard e riga (poi salva su config in background)
  r.qty = qty; r.pmc = pmc;
  if (r.currency === "USD" && r.price != null) {
    r.value = r.price * qty; r.gain = r.value - pmc * qty;
    r.gain_pct = Math.round((r.value / (pmc * qty) - 1) * 10000) / 100;
  }
  recomputeTotals(); renderKPI(); renderTable(); if (ptfView === "fund") renderFundTable(); renderAllocation();
  toast(`${ticker} aggiornato — salvo nel repo…`);
  editHoldings("portfolio", cfg => {
    const p = (cfg.portfolio || []).find(x => x.ticker === ticker);
    if (!p) return false;
    p.qty = qty; p.pmc = pmc;
    return true;
  });
}


function renderTable() {
  const eurusd = DATA.eurusd || 1.08;
  const rows = sortRows(DATA.portfolio, "ptf-table").map(r => {
    const c = cur(r);
    // guadagno EUR = verità broker (bgain) se presente, altrimenti dai prezzi live
    const gEur = r.gain_eur != null ? r.gain_eur : (r.currency === "EUR" ? (r.gain || 0) : (r.gain || 0) / eurusd);
    const gPct = (r.bval != null && (r.bval - r.bgain)) ? r.bgain / (r.bval - r.bgain) * 100 : r.gain_pct;
    return `<tr>
      <td class="name-cell" data-tk="${r.ticker}" title="Clicca per la scheda completa">${nameDelBtn("portfolio", r.ticker)}${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num"><b>${priceTxt(r, c)}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num">${prepostCell(r.prepost)}</td>
      ${volumeCell(r)}
      <td class="num ${signCls(gEur)}">${signTxt(Math.round(gEur), " €")}${r.currency === "USD" && r.gain != null ? `<br><span class="sub-eur muted">${signTxt(Math.round(r.gain), " $")} live</span>` : ""}</td>
      <td class="num ${signCls(gPct)}"><b>${signTxt(Math.round(gPct * 100) / 100)}</b></td>
      ${techCells(r)}
    </tr>`;
  }).join("");

  const t = DATA.totals;
  const usdValue = DATA.portfolio.filter(r => r.currency === "USD").reduce((s, r) => s + r.value, 0);
  const totalRow = `<tr class="total-row">
    <td class="name-cell" colspan="7">TOTALE — ${fmtEUR.format(t.eur_value)} · azioni $${fmtNum.format(Math.round(usdValue))}</td>
    <td class="num ${signCls(t.eur_gain)}">${signTxt(Math.round(t.eur_gain), " €")}</td>
    <td class="num ${signCls(t.eur_gain_pct)}"><b>${signTxt(t.eur_gain_pct)}</b></td>
    <td colspan="15" class="muted" style="font-family:Inter,sans-serif">netto tasse stimato: <b class="${signCls(t.eur_gain_net)}">${signTxt(Math.round(t.eur_gain_net ?? t.eur_gain), " €")}</b></td>
  </tr>`;
  const addRow = editMode.portfolio
    ? `<tr class="add-row"><td colspan="24"><button class="btn btn-ghost btn-sm" id="ptf-add">+ Aggiungi titolo</button></td></tr>` : "";
  $("#ptf-table tbody").innerHTML = rows + totalRow + addRow;
  applyColLabels("ptf-table");
}

// Etichette colonne sui td (per la vista "a schede" su iPhone) + marcatura colonne chiave.
const MOBILE_KEY_COLS = new Set(["Titolo", "Prezzo", "Oggi", "Guad. %", "Segnale", "Drawdown 52S", "Trimestrale",
  "P/E TTM", "ROE", "Marg.netto", "Cresc.ricavi"]);   // + chiavi vista fondamentale su iPhone
function applyColLabels(tableId) {
  const ths = [...document.querySelectorAll(`#${tableId} thead th`)].map(t => t.textContent.trim());
  document.querySelectorAll(`#${tableId} tbody tr`).forEach(tr => {
    if (tr.classList.contains("total-row") || tr.classList.contains("add-row")) return;
    [...tr.children].forEach((td, i) => {
      const lab = ths[i] || "";
      td.setAttribute("data-label", lab);
      td.classList.toggle("td-key", MOBILE_KEY_COLS.has(lab));
    });
  });
}

function renderWatchlist() {
  const list = sortRows(DATA.watchlist || [], "wl-table");
  const c = (r) => r.currency === "PTS" ? "" : "$";
  const rows = list.length ? list.map(r => `<tr>
      <td class="name-cell" data-tk="${r.ticker}" title="Clicca per la scheda completa">${nameDelBtn("watchlist", r.ticker)}${esc(r.name)}<span class="tk">${r.ticker}</span></td>
      <td class="num"><b>${priceTxt(r, c(r))}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num">${prepostCell(r.prepost)}</td>
      ${volumeCell(r)}
      ${techCells(r)}
    </tr>`).join("") : '<tr><td colspan="20" class="muted">Nessun dato</td></tr>';
  const addRow = editMode.watchlist
    ? `<tr class="add-row"><td colspan="20"><button class="btn btn-ghost btn-sm" id="wl-add">+ Aggiungi titolo</button></td></tr>` : "";
  $("#wl-table tbody").innerHTML = rows + addRow;
  applyColLabels("wl-table");
}

/* ---------------- vista fondamentale (Value Investing) ---------------- */
let ptfView = localStorage.getItem("pref_ptf_view") || "tech";   // tech | fund (preferenza ricordata)
const pctOf = (v) => v == null ? "—" : signTxt(Math.round(v * 1000) / 10);   // frazione → %
const pctPlain = (v) => v == null ? "—" : (Math.round(v * 1000) / 10) + "%";
function bigUsd(v) { if (v == null) return "—"; const a = Math.abs(v);
  if (a >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(0) + "M"; return "$" + fmtNum.format(v); }

/* indicatore di impatto visivo per la vista fondamentale (come i bar della vista tecnica):
   score 0-100 (100 = favorevole/verde). Mostra valore colorato + mini-barra. */
function fundBar(val, fmt, score) {
  if (val == null || val === "" ) return "—";
  const txt = fmt(val);
  if (score == null) return txt;
  const s = Math.max(0, Math.min(100, score));
  return `<span class="fund-metric"><span style="color:${scoreColor(s)}">${txt}</span>
    <span class="fmeter"><span class="fmeter-fill" style="width:${Math.max(6, s)}%;background:${scoreColor(s)}"></span></span></span>`;
}
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
function buildFundTable(list, tableSel, withQtyPmc) {
  const tableId = tableSel.replace("#", "");
  const head = (withQtyPmc ? ["Titolo", "Qtà", "PMC", "Prezzo"] : ["Titolo", "Prezzo"])
    .concat(["Market Cap", "P/E", "EV/EBITDA", "ROE", "Margine netto", "P/FCF", "Cresc. ricavi", "Debt/Equity", "Div Yield", "PEG", "Z-Score", "Financial Health", "Target Δ"]);
  const fundColspan = 13;
  $(`${tableSel} thead`).innerHTML = "<tr>" +
    head.map((h, i) => `<th class="${i === 0 ? "sticky-col" : "num"}">${h}</th>`).join("") + "</tr>";
  const orig = list;                          // ordine originale (per il ripristino "default")
  const sorted = sortRows(list, tableId);
  const rows = sorted.map(r => {
    const c = cur(r), st = r.stats || {};
    const lead = withQtyPmc
      ? `<td class="name-cell">${esc(r.name)}<span class="tk">${r.ticker}</span></td>
         <td class="num">${fmtNum.format(r.qty)}</td><td class="num">${c}${fmtNum.format(r.pmc)}</td>
         <td class="num"><b>${r.price == null ? "…" : c + fmtNum.format(r.price)}</b></td>`
      : `<td class="name-cell">${esc(r.name)}<span class="tk">${r.ticker}</span></td>
         <td class="num"><b>${r.price == null ? "…" : c + fmtNum.format(r.price)}</b></td>`;
    if (r.ticker === "BTP-V28" || !st.market_cap) {
      return `<tr>${lead}<td colspan="${fundColspan}" class="muted">${r.ticker === "BTP-V28" ? "Titolo di Stato — cedola 4,10/4,50%" : "Dati fondamentali non disponibili"}</td></tr>`;
    }
    const pfcf = (st.market_cap && st.fcf) ? st.market_cap / st.fcf : null;
    const peTtm = st.pe_ttm || r.pe;
    const roePrem = st.roe != null && st.roe > 0.15;
    const roeHtml = st.roe != null
      ? (roePrem
          ? `<span class="text-premium-green" title="ROIC/ROE > 15% — ritorno eccellente sul capitale investito">${fundBar(st.roe, pctOf, FSC.roe(st.roe))}</span>`
          : fundBar(st.roe, pctOf, FSC.roe(st.roe)))
      : "—";
    const pfcfWarn = pfcf != null && pfcf > 0 && peTtm > 0 && pfcf > peTtm * 2
      ? `<span class="fcf-warn" title="Warning: Controllare divergenza FCF/Utile — P/FCF ${fmtNum.format(Math.round(pfcf))}× >> P/E ${fmtNum.format(Math.round(peTtm))}×: il Free Cash Flow è significativamente inferiore al Net Income (possibili accrual contabili)"> !</span>` : "";
    const pfcfHtml = pfcf == null ? "—" : pfcf < 0 ? `<span class="neg">neg.</span>` : `${fundBar(pfcf, fmtNum.format, FSC.pfcf(pfcf))}${pfcfWarn}`;
    const revGrowthFlag = st.revenue_growth != null && st.revenue_growth < 0.05 && (st.ev_ebitda || 0) > 18
      ? `<span style="color:var(--yellow);cursor:help;font-size:11px" title="Crescita ricavi bassa (<5%) con EV/EBITDA elevato: possibile crescita non organica da acquisizioni"> ?</span>` : "";
    // sanity di rendering: PEG negativo e D/E fuori scala non entrano nei modelli → "n.d."
    const pegOk = st.peg != null && st.peg > 0;
    const deOk = st.debt_to_equity != null && st.debt_to_equity >= 0 && st.debt_to_equity < 1000;
    return `<tr class="fund-row" data-fund-tk="${r.ticker}" tabindex="0" role="button" title="${esc(r.name)} — clicca per conto economico e statistiche">${lead}
      <td class="num">${bigUsd(st.market_cap)}</td>
      <td class="num">${peTtm > 0 ? fmtNum.format(Math.round(peTtm * 10) / 10) + "×" : "n.d."}</td>
      <td class="num">${fundBar(st.ev_ebitda, fmtNum.format, FSC.ev(st.ev_ebitda))}</td>
      <td class="num">${roeHtml}</td>
      <td class="num">${fundBar(st.profit_margin, pctPlain, FSC.net(st.profit_margin))}</td>
      <td class="num">${pfcfHtml}</td>
      <td class="num">${fundBar(st.revenue_growth, pctOf, FSC.growth(st.revenue_growth))}${revGrowthFlag}</td>
      <td class="num" title="Debito totale / patrimonio netto (leva finanziaria, fonte yfinance)">${deOk ? fmtNum.format(Math.round(st.debt_to_equity)) + "%" : "n.d."}</td>
      <td class="num">${st.dividend_yield ? fundBar(st.dividend_yield, pctPlain, FSC.div(st.dividend_yield)) : "—"}</td>
      <td class="num">${pegOk ? fundBar(st.peg, fmtNum.format, FSC.peg(st.peg)) : "n.d."}</td>
      <td class="num" title="Altman Z''-Score non-manifatturieri (rischio insolvenza): flag prudenziale <1,81 · cutoff canonici Z'': <1,1 distress, >2,6 solido${st.altman_missing ? " — proxy con 1 componente di bilancio mancante" : ""}">${st.altman_z != null ? `${fundBar(st.altman_z, fmtNum.format, FSC.zscore(st.altman_z))}${st.altman_z < 1.81 ? `<br><span class="badge badge-default-risk">[RISCHIO DEFAULT]</span>` : ""}` : "n.d."}</td>
      <td class="num">${finHealthBar(r)}</td>
      <td class="num">${targetBar(r.rating)}</td>
    </tr>`;
  }).join("");
  $(`${tableSel} tbody`).innerHTML = rows;
  applyColLabels(tableId);     // vista a schede su iPhone anche per i fondamentali
  // ordinamento cliccabile sugli header (la thead è ricostruita ogni volta)
  initSorting(tableId, () => buildFundTable(orig, tableSel, withQtyPmc));
  updateSortArrows(tableId);
}

function renderFundTable() {
  if (!DATA || !DATA.portfolio) return;
  buildFundTable(DATA.portfolio, "#ptf-fund-table", true);
}
function renderWlFundTable() {
  if (!DATA || !DATA.watchlist) return;
  buildFundTable(DATA.watchlist.filter(r => r.currency !== "PTS"), "#wl-fund-table", false);
}

function setPtfView(v) {
  ptfView = v;
  localStorage.setItem("pref_ptf_view", v);
  document.querySelectorAll("#view-toggle .chip").forEach(c => c.classList.toggle("chip-active", c.dataset.view === v));
  $("#ptf-tech-wrap").hidden = v !== "tech";
  $("#ptf-fund-wrap").hidden = v !== "fund";
  $("#spark-toggle").style.display = v === "tech" ? "" : "none";
  $("#range-lab-tech").style.display = v === "tech" ? "" : "none";
  if (v === "fund") renderFundTable();
}

let wlView = localStorage.getItem("pref_wl_view") || "tech";
function setWlView(v) {
  wlView = v;
  localStorage.setItem("pref_wl_view", v);
  document.querySelectorAll("#wl-view-toggle .chip").forEach(c => c.classList.toggle("chip-active", c.dataset.view === v));
  $("#wl-tech-wrap").hidden = v !== "tech";
  $("#wl-fund-wrap").hidden = v !== "fund";
  $("#spark-toggle-wl").style.display = v === "tech" ? "" : "none";
  $("#wl-range-lab").style.display = v === "tech" ? "" : "none";
  if (v === "fund") renderWlFundTable();
}

/* ---------------- trimestrali ---------------- */
function impliedMoveForEarnings(r) {
  const chain = optChain(r.ticker);
  if (!chain || !chain.expiries?.length || !r.earnings_date || !r.price) return null;
  const eDate = r.earnings_date;
  // trova la prima scadenza uguale o successiva alla data trimestrale
  const exp = chain.expiries.find(e => e.date >= eDate) || chain.expiries[0];
  if (!exp) return null;
  const spot = r.price;
  // trova call e put ATM (strike più vicino al prezzo corrente)
  const bestCall = (exp.calls || []).reduce((best, o) => {
    if (!o.price || o.price <= 0) return best;
    return !best || Math.abs(o.strike - spot) < Math.abs(best.strike - spot) ? o : best;
  }, null);
  const bestPut = (exp.puts || []).reduce((best, o) => {
    if (!o.price || o.price <= 0) return best;
    return !best || Math.abs(o.strike - spot) < Math.abs(best.strike - spot) ? o : best;
  }, null);
  if (!bestCall || !bestPut || spot <= 0) return null;
  return Math.round(((bestCall.price + bestPut.price) / spot) * 1000) / 10;
}

function renderEarnings() {
  const strip = $("#earnings-strip");
  if (!strip) return;   // strip rimossa: le trimestrali sono ora nella colonna di tabella
  const all = [...DATA.portfolio, ...(DATA.watchlist || [])];
  const items = all
    .filter(r => r.earnings_date)
    .map(r => ({ ...r, days: Math.ceil((new Date(r.earnings_date) - Date.now()) / 86400000) }))
    .filter(r => r.days >= -1)
    .sort((a, b) => a.days - b.days);
  const ptfTickers = new Set(DATA.portfolio.map(x => x.ticker));
  strip.innerHTML = items.length ? items.map(r => {
    const d = new Date(r.earnings_date).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
    const when = r.days <= 0 ? "oggi" : r.days === 1 ? "domani" : `tra ${r.days} gg`;
    const pct = Math.max(6, Math.min(100, 100 - r.days * 1.1));
    const color = r.days <= 7 ? "var(--red)" : r.days <= 21 ? "var(--yellow)" : "var(--green)";
    const im = impliedMoveForEarnings(r);
    const imHtml = im != null
      ? `<div class="earn-im" style="color:${im >= 10 ? "var(--yellow)" : "var(--muted)"}" title="Implied Move (straddle ATM)">[+/- ${im}%]</div>`
      : "";
    const isWl = !ptfTickers.has(r.ticker);
    const wlMark = isWl ? `<span class="earn-wl" title="Watchlist">WL</span>` : "";
    return `<div class="earn-card${isWl ? " earn-card-wl" : ""}" data-earn="${r.ticker}" tabindex="0" role="button" title="${esc(r.name)}${isWl ? " (watchlist)" : ""} — clicca per dettagli">
      <div class="earn-top"><span class="earn-tk">${r.ticker}${wlMark}</span><span class="earn-date">${d}</span></div>
      <div class="earn-when" style="color:${color}">${when}</div>
      ${imHtml}
      <div class="impact"><span class="impact-fill" style="width:${pct}%;background:${color}"></span></div>
    </div>`;
  }).join("") : "";
}

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
function thermoCard(key, title, score, valueText, subText, ends) {
  const s = Math.max(0, Math.min(100, score ?? 50));
  const col = scoreColor(s);
  return `<div class="gauge-card" data-gauge="${key}" tabindex="0" role="button" title="Clicca per dettagli e news">
    <span class="popup-dot"></span>
    <div class="g-title">${title}</div>
    <div class="gauge-value" style="color:${col}">${valueText}</div>
    ${thermoLine(s, ends)}
    <div class="gauge-sub">${subText}</div>
  </div>`;
}

/* Fear & Greed come termometro lineare (paura=rosso sx, avidità=verde dx, marker diretto su score) */
function fgGaugeCNN(score) {
  const s = Math.max(0, Math.min(100, score));
  const col = s >= 55 ? "var(--green)" : s >= 45 ? "var(--yellow)" : "var(--red)";
  return `<div class="gauge-value" style="color:${col}">${Math.round(s)}</div>
    ${thermoLine(s, ["Paura", "Avidità"], { direct: true, gradient: "linear-gradient(90deg,#d23b30,#eab308,#16a34a)" })}`;
}

function renderGauges() {
  const m = DATA.macro || {};
  const cards = [];

  if (m.risk_sentiment) {
    const rs = m.risk_sentiment;
    cards.push(thermoCard("sentiment", "Sentiment globale", rs.score, rs.score,
      `<b>${rs.label}</b><br>composito F&amp;G · VIX · P/C · BTC · 10A`, ["Risk-on", "Risk-off"]));
  }
  if (m.fear_greed) {
    const fg = m.fear_greed;
    cards.push(`<div class="gauge-card" data-gauge="fear_greed" tabindex="0" role="button" title="Clicca per dettagli e news">
      <span class="popup-dot"></span>
      <div class="g-title">Fear &amp; Greed</div>
      ${fgGaugeCNN(fg.score)}
      <div class="gauge-sub"><b>${FG_LABELS[fg.rating] || fg.rating}</b> · 1 sett: ${fg.week_ago} · 1 mese: ${fg.month_ago}</div>
    </div>`);
  }
  // VIX e FedWatch rimossi dai gauge: i loro valori sono già nel box MacroQuant (ciclo).
  if (m.carry) {
    const cy = m.carry;
    const score = Math.max(0, Math.min(100, cy.spread / 5 * 100));
    cards.push(thermoCard("carry", "Carry USD/JPY — Rischio", score, `${fmtNum.format(cy.spread)} pp spread`,
      `US10A ${fmtNum.format(cy.us10)}% − JGB ${fmtNum.format(cy.jp10)}%<br>USD/JPY ${fmtNum.format(cy.usdjpy)} (${signTxt(cy.usdjpy_chg_1m)} 1m)`, ["Rischio Basso", "Rischio Elevato"]));
  }
  if (m.vix && m.vix.value != null) {
    const v = m.vix.value;
    const score = clamp(100 - (v - 10) / 30 * 100);            // 10=calmo(verde) → 40+=panico(rosso)
    const lab = v < 15 ? "Calma" : v < 20 ? "Normale" : v < 28 ? "Tensione" : "Panico";
    cards.push(thermoCard("vix", "VIX — Volatilità attesa", score, fmtNum.format(v),
      `<b>${lab}</b>${m.vix.change_pct != null ? `<br>${signTxt(m.vix.change_pct)} oggi` : ""}`, ["Calma", "Panico"]));
  }
  if (m.credit && m.credit.spread_hy != null) {
    cards.push(thermoCard("credit", "Rischio Credito (HY OAS)", m.credit.score ?? 50,
      `${fmtNum.format(m.credit.spread_hy)}%`,
      `<b>${esc(m.credit.label || "")}</b><br>&lt;4% normale · 5-7% stress · &gt;9% crisi`, ["Rilassato", "Crisi"]));
  }
  if (m.liquidity_split && m.liquidity_split.inst_cash_pct != null) {
    const L = m.liquidity_split;
    const score = clamp(L.inst_cash_pct / 20 * 100);           // più cash parcheggiato = più benzina
    cards.push(thermoCard("liquidity", "Liquidità in attesa (Ist. vs Retail)", score,
      `${fmtNum.format(L.inst_cash_pct)}%`,
      `Istituzionali (proxy AUM BIL+SHV/SPY)${L.retail_mmf_bln != null ? `<br>Retail MMF $${fmtNum.format(L.retail_mmf_bln)} mld${L.retail_pctile_5y != null ? ` · ${L.retail_pctile_5y}° pct 5A` : ""}` : ""}`,
      ["Poca benzina", "Molta benzina"], ));
  }
  if (m.dollar_ruler && m.dollar_ruler.chg_3m_pct != null) {
    const D = m.dollar_ruler;
    const score = clamp(50 - D.chg_3m_pct * 8);                // dollaro su = compressione utili = rosso
    cards.push(thermoCard("dollar", "Righello Dollaro (3M)", score,
      `${signTxt(D.chg_3m_pct)}`,
      `${D.src} ${fmtNum.format(D.value)}<br><b>${D.flag ? (D.chg_3m_pct >= 5 ? "COMPRESSIONE utili esteri" : "BOOST utili esteri") : "Impatto FX neutro (±5%)"}</b>`,
      ["Boost utili", "Compressione"]));
  }
  if (m.putcall) {
    const pc = m.putcall;
    const score = Math.max(0, Math.min(100, 100 - pc.ratio / 2 * 100));   // più call = verde
    cards.push(thermoCard("putcall", `Put/Call ${pc.symbol}`, score, fmtNum.format(pc.ratio),
      `<b>${pc.ratio > 1 ? "Prevalgono PUT" : "Prevalgono CALL"}</b><br>put ${pc.puts.toLocaleString("it-IT")} · call ${pc.calls.toLocaleString("it-IT")}`, ["Call", "Put"]));
  }
  // Rischio Credito (HY) rimosso dai gauge: già incluso nel box MacroQuant (ciclo).
  if (m.smart_money) {
    const sm = m.smart_money;
    const fgGauge = m.fear_greed?.score;
    let divTxt = "";
    if (fgGauge != null && sm.score != null) {
      if (fgGauge > 75 && sm.score < 30)
        divTxt = `<br><b style="color:var(--red)">DIVERGENZA PERICOLOSA</b>`;
      else if (fgGauge < 25 && sm.score > 70)
        divTxt = `<br><b style="color:var(--green)">ACCUMULO ISTITUZIONALE</b>`;
      else if (sm.divergence != null && Math.abs(sm.divergence) > 15)
        divTxt = `<br><b style="color:var(--yellow)">${sm.divergence_label}</b>`;
    } else if (sm.divergence != null) {
      divTxt = `<br><b style="color:${Math.abs(sm.divergence) > 15 ? "var(--yellow)" : "var(--muted)"}">${sm.divergence_label}</b>`;
    }
    cards.push(thermoCard("smart_money", "Istituzionali VS Retail", sm.score,
      `<b>${sm.label}</b>`,
      `flussi istituzionali${divTxt}`, ["Bullish", "Bearish"]));
  }
  if (m.sp500_pe) {
    const pe = m.sp500_pe;
    const peCol = pe.current > 35 ? "var(--red)" : pe.current > 25 ? "var(--yellow)" : pe.current > 14 ? "var(--muted)" : "var(--green)";
    const ndxStr = pe.nasdaq_pe ? ` · NDX ${pe.nasdaq_pe}×` : "";
    cards.push(thermoCard("sp500_pe", "P/E S&P 500 / Nasdaq", pe.score,
      `<span style="color:${peCol}">S&P ${pe.current}×</span>${ndxStr ? `<span class="muted" style="font-size:12px">${ndxStr}</span>` : ""}`,
      `${pe.label}${pe.avg_10y != null ? ` · media 10A ${pe.avg_10y}×` : ""}${pe.pct_rank != null ? ` · percentile ${pe.pct_rank}°` : ""}`, ["Sottovalutato", "Sopravvalutato"]));
  }
  if (m.corp_profit) {
    const cp = m.corp_profit;
    const gapCol = cp.gap > 40 ? "var(--red)" : cp.gap > 20 ? "var(--yellow)" : "var(--green)";
    const ndxGapStr = cp.ndx_gap != null ? ` · NDX ${cp.ndx_gap > 0 ? "+" : ""}${cp.ndx_gap} pp` : "";
    cards.push(thermoCard("corp_profit", "S&P+NDX vs Profitti Reali", cp.score,
      `<span style="color:${gapCol}">S&P ${cp.gap > 0 ? "+" : ""}${cp.gap} pp${ndxGapStr}</span>`,
      `<b style="color:${gapCol}">${cp.label}</b>`, ["Allineati", "Asset Inflation"]));
  }
  $("#gauges").innerHTML = cards.join("") || '<span class="muted">Dati non disponibili</span>';
}

/* ---------------- macro ---------------- */
const MACRO_ACCENTS = { cpi: "var(--red)", pce: "var(--yellow)", gdp: "var(--blue)", retail: "var(--purple)", nfp: "var(--green)", unemp: "var(--cyan)", pmi: "var(--blue)", "BTC-USD": "var(--yellow)", "CL=F": "var(--purple)", "^KS11": "var(--cyan)", "^IXIC": "var(--blue)" };

function marketImpact(m) {
  // variazione giornaliera → impatto 0-100 (rendimenti in pp: salita = restrittivo)
  if (m.change_pct === null || m.change_pct === undefined) return null;
  if (m.suffix === " pp") return Math.round(Math.max(0, Math.min(100, 50 - m.change_pct * 300)));
  return Math.round(Math.max(0, Math.min(100, 50 + m.change_pct * 12)));
}

function renderMacro() {
  const m = DATA.macro || {};
  // termometro coerente: verde a sx (favorevole per il portafoglio) → rosso a dx (sfavorevole)
  const macroThermo = (score) => score == null ? "" :
    compactSemiGauge(score, ["favorevole", "sfavorevole"]);
  const markets = (DATA.macro?.markets || []).map(m => `
    <div class="macro-item" data-macro="mk:${m.key}" tabindex="0" role="button" title="Clicca per dettagli e news" style="--accent:${MACRO_ACCENTS[m.key] || "var(--blue)"}">
      <span class="popup-dot"></span>
      <div class="m-label">${m.label}</div>
      <div class="m-value">${m.value}</div>
      <div class="m-sub ${signCls(m.change_pct)}">${signTxt(m.change_pct, m.suffix || "%")} oggi</div>
      ${macroThermo(marketImpact(m))}
    </div>`);
  const indicators = (DATA.macro?.indicators || []).map(i => `
    <div class="macro-item" data-macro="in:${i.key}" tabindex="0" role="button" title="Clicca per dettagli e news" style="--accent:${MACRO_ACCENTS[i.key] || "var(--purple)"}">
      <span class="popup-dot"></span>
      <div class="m-label">${i.label}</div>
      <div class="m-value">${i.value}</div>
      <div class="m-date">${i.date}</div>
      ${macroThermo(i.impact)}
    </div>`);
  const cells = markets.concat(indicators);

  // Disaccoppiamento macro: S&P 500 vs PIL reale
  const dc = DATA.macro?.decouple;
  if (dc?.sp500?.length && dc?.gdp?.length) {
    const spLast = dc.sp500[dc.sp500.length - 1].v;
    const gdLast = dc.gdp[dc.gdp.length - 1].v;
    const gap = Math.round(spLast - gdLast);
    const gapCol = gap > 40 ? "var(--red)" : gap > 20 ? "var(--yellow)" : "var(--green)";
    const gapScore = Math.max(0, Math.min(100, 100 - gap / 1.2));
    cells.push(`<div class="macro-item" data-macro="decouple" tabindex="0" role="button" title="Clicca per grafico S&P vs PIL" style="--accent:var(--blue)">
      <span class="popup-dot"></span>
      <div class="m-label">Disaccoppiamento Macro</div>
      <div class="m-value" style="color:${gapCol}">${gap > 0 ? "+" : ""}${gap} pp</div>
      <div class="m-date">S&amp;P ${signTxt(Math.round(spLast - 100))} · PIL ${signTxt(Math.round(gdLast - 100))}</div>
      ${macroThermo(gapScore)}
    </div>`);
  }
  if (m.sp500_pe) {
    const pe = m.sp500_pe;
    const peCol = pe.current > 35 ? "var(--red)" : pe.current > 25 ? "var(--yellow)" : pe.current > 14 ? "var(--muted)" : "var(--green)";
    const ndxLine = pe.nasdaq_pe ? `<div class="m-date" style="margin-top:2px">NDX (QQQ): <b>${pe.nasdaq_pe}×</b></div>` : "";
    cells.push(`<div class="macro-item" data-macro="sp500_pe" tabindex="0" role="button" title="Clicca per storico P/E" style="--accent:var(--yellow)">
      <span class="popup-dot"></span>
      <div class="m-label">P/E S&amp;P 500 / Nasdaq</div>
      <div class="m-value" style="color:${peCol}">${pe.current}×</div>
      <div class="m-date">S&amp;P · ${pe.label}${pe.avg_10y != null ? ` · media 10A ${pe.avg_10y}×` : ""}</div>
      ${ndxLine}
      ${macroThermo(pe.score)}
    </div>`);
  }
  if (m.fed_market) {
    const fm = m.fed_market;
    const rateCol = fm.current_rate > 4.5 ? "var(--red)" : fm.current_rate > 2.5 ? "var(--yellow)" : "var(--green)";
    const rateScore = clamp(100 - (fm.current_rate - 0) / 6 * 100);
    cells.push(`<div class="macro-item" data-macro="fed_market" tabindex="0" role="button" title="Clicca per grafico Fed Funds vs S&P" style="--accent:var(--red)">
      <span class="popup-dot"></span>
      <div class="m-label">Fed Funds vs Mercato</div>
      <div class="m-value" style="color:${rateCol}">${fm.current_rate}%</div>
      <div class="m-date">tasso Fed attuale · clicca per storico</div>
      ${macroThermo(rateScore)}
    </div>`);
  }
  if (m.yield_recession) {
    const yr = m.yield_recession;
    const cc = yr.current_curve;
    const col = cc == null ? "var(--muted)" : cc < 0 ? "var(--red)" : yr.steepening ? "var(--yellow)" : "var(--green)";
    // score favorevolezza: invertita o irripidimento post-inversione = sfavorevole
    const score = cc == null ? 50 : (yr.steepening && yr.was_inverted_24m) ? 25 : cc < 0 ? 15 : clamp(50 + cc * 25);
    cells.push(`<div class="macro-item" data-macro="yield_recession" tabindex="0" role="button" title="Clicca per l'analisi curva vs recessioni" style="--accent:var(--blue)">
      <span class="popup-dot"></span>
      <div class="m-label">Curva &amp; Recessione</div>
      <div class="m-value" style="color:${col}">${cc != null ? (cc > 0 ? "+" : "") + fmtNum.format(cc) + " pp" : "—"}</div>
      <div class="m-date">${esc((yr.label || "").split(" — ")[0])}</div>
      ${macroThermo(score)}
    </div>`);
  }
  if (m.systemic_risk) {
    const sr = m.systemic_risk;
    const col = sr.rising ? "var(--red)" : sr.score >= 60 ? "var(--green)" : sr.score <= 40 ? "var(--red)" : "var(--yellow)";
    cells.push(`<div class="macro-item" data-macro="systemic_risk" tabindex="0" role="button" title="Clicca per il dettaglio rischio sistemico e credito" style="--accent:var(--red)">
      <span class="popup-dot"></span>
      <div class="m-label">Rischio Sistemico (CDS)</div>
      <div class="m-value" style="color:${col}">${sr.hy_oas != null ? fmtNum.format(sr.hy_oas) + "%" : "—"}${sr.hy_chg_1m != null ? ` <span style="font-size:11px" class="${signCls(sr.hy_chg_1m)}">${signTxt(sr.hy_chg_1m)} 1m</span>` : ""}</div>
      <div class="m-date">${esc((sr.status || "").split(" — ")[0])}</div>
      ${macroThermo(sr.score)}
    </div>`);
  }

  $("#macro-grid").innerHTML = cells.length ? cells.join("") : '<span class="muted">Dati non disponibili</span>';
}

/* ---------------- top capitalizzazioni ---------------- */
function fmtMcap(v) {
  if (v >= 1e12) return "$" + fmtNum.format(Math.round(v / 1e10) / 100) + "T";
  return "$" + fmtNum.format(Math.round(v / 1e9)) + "B";
}

/* ---------------- top ETF dashboard ---------------- */
function etfOpportunity(rsi) {
  if (rsi == null) return { label: "—", color: "var(--muted)" };
  if (rsi < 35) return { label: "Ipervenduto — possibile ingresso", color: "var(--green)" };
  if (rsi < 48) return { label: "Zona neutro-bassa — da monitorare", color: "var(--yellow)" };
  if (rsi < 65) return { label: "Momentum positivo", color: "var(--muted)" };
  return { label: "Ipercomprato — attendere ritracciamento", color: "var(--red)" };
}

/* ---------------- news ---------------- */
function timeAgo(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins} min fa`;
  if (mins < 1440) return `${Math.round(mins / 60)} h fa`;
  return `${Math.round(mins / 1440)} gg fa`;
}

const TOPIC_LABEL = t => t === "MACRO" ? "Macro" : t === "POL" ? "Politica" : t;

/* sintesi globale di tutte le news: tono complessivo, conteggi, titoli più citati */
function newsSummary(list) {
  const ptf = new Set([...(DATA.portfolio || []), ...(DATA.watchlist || [])].map(r => r.ticker));
  let bull = 0, bear = 0, neu = 0;
  const tkCount = {}, tkTone = {};
  list.forEach(n => {
    const s = n.sentiment;
    if (s === "bull") bull++; else if (s === "bear") bear++; else neu++;
    (n.tickers || []).forEach(tk => {
      tkCount[tk] = (tkCount[tk] || 0) + 1;
      tkTone[tk] = (tkTone[tk] || 0) + (s === "bull" ? 1 : s === "bear" ? -1 : 0);
    });
  });
  const tot = list.length || 1;
  const net = bull - bear;
  const tone = net >= 3 ? { t: "COSTRUTTIVO", c: "var(--green)" }
    : net <= -3 ? { t: "CAUTO / RISK-OFF", c: "var(--red)" }
    : { t: "MISTO / NEUTRO", c: "var(--yellow)" };
  // titoli del portafoglio più citati, con tono
  const top = Object.entries(tkCount)
    .filter(([tk]) => ptf.has(tk))
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([tk, c]) => {
      const tone = tkTone[tk] > 0 ? "pos" : tkTone[tk] < 0 ? "neg" : "muted";
      return `<span class="ns-chip ${tone}">${tk} <b>${c}</b>${tkTone[tk] > 0 ? " ▲" : tkTone[tk] < 0 ? " ▼" : ""}</span>`;
    }).join("");
  return { bull, bear, neu, tot, tone, top };
}

function renderNewsSummary(list) {
  const box = $("#news-summary");
  if (!box) return;
  if (!list.length) { box.innerHTML = ""; return; }
  const s = newsSummary(list);
  const pct = v => Math.round(v / s.tot * 100);
  // riga unica e compatta: tono + barra + conteggi (dettaglio completo nel popup)
  box.innerHTML = `
    <div class="ns-line">
      <b style="color:${s.tone.c}">${s.tone.t}</b>
      <span class="ns-bar" title="positive ${s.bull} · neutre ${s.neu} · negative ${s.bear}">
        <span class="ns-seg ns-bull" style="width:${pct(s.bull)}%"></span>
        <span class="ns-seg ns-neu" style="width:${pct(s.neu)}%"></span>
        <span class="ns-seg ns-bear" style="width:${pct(s.bear)}%"></span>
      </span>
      <span class="ns-counts muted"><span class="pos">▲${s.bull}</span> <span class="neg">▼${s.bear}</span> · ${s.tot} news ›</span>
    </div>`;
}

function renderNews() {
  // solo notizie delle ultime 24 ore (oltre a quanto già filtrato dalla pipeline)
  const cutoff = Date.now() - 26 * 3600 * 1000;
  let list = (DATA.news || []).filter(n => !n.published || new Date(n.published).getTime() >= cutoff);
  if (!list.length) list = DATA.news || [];   // fallback: se tutte vecchie, mostra comunque
  renderNewsSummary(list);
  $("#news-list").innerHTML = list.length ? list.map(n => `
    <li class="news-item">
      <a href="${esc(n.link)}" target="_blank" rel="noopener" title="${esc(n.title)}">${esc(n.title_it || n.title)}</a>
      <div class="news-meta">
        <span class="news-src ${n.source === "Polymarket" ? "src-poly" : ""}">${esc(n.source)}</span>
        <span class="news-time">${timeAgo(n.published)}</span>
        ${n.tickers.map(t => `<span class="news-tk">${TOPIC_LABEL(t)}</span>`).join("")}
      </div>
    </li>`).join("") : '<li class="muted">Nessuna news recente</li>';
}


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
const PROMPT_HEADER_PATH = "config/prompt_header.txt";
const DEFAULT_PROMPT_HEADER = `RUOLO: Sei il Comitato di Investimento Senior (analisti quantitativi, fondamentali e macro) di un fondo Growth. Riporti all'Amministratore Delegato (l'utente). Non sei un esecutore di format: sei un comitato di Wall Street che pensa. Esponi i fatti, i conflitti tra matematica e mercato, e le tue raccomandazioni — l'ultima parola spetta al CEO.

DELEGA PIENA SULLA FORMA: decidi TU come strutturare il report — numero di sezioni, ordine, formato e lunghezza — in base a ciò che i dati di oggi meritano: un giorno denso di news e violazioni merita un report ricco; una domenica piatta merita poche righe oneste, non riempitivi. Se qualcosa non ti torna — una strategia ambigua, un dato contraddittorio, un'intenzione del CEO che non conosci — FAI DOMANDE invece di assumere.

MANDATO DI CONSEGNA MINIMA (NON è una gabbia sulla forma, è il contenuto che il report DEVE contenere, comunque tu decida di organizzarlo — non "dimenticarlo" per fare narrativa macro):
A. INDICI LEADING: leggi SEMPRE, anche in poche righe, lo stato di KOSPI (^KS11), Nasdaq Composite (^IXIC) e Bitcoin (BTC-USD) come anticipatori — il KOSPI chiude prima dell'apertura USA (proxy del sentiment tech/semiconduttori), Bitcoin è il termometro dell'appetito al rischio globale e ha correlazione diretta con MSTR/nomi ad alta beta. Se sono nel payload, NON ignorarli.
B. ESECUZIONE COMPLETA: per OGNI operazione suggerita (COMPRA o VENDI) fornisci SEMPRE il calcolo MATEMATICO ESATTO della quantità di quote. Regola di sizing: dimensiona sul budget disponibile mantenendo SEMPRE una quota di liquidità di sicurezza strategica (Dry Powder). Dimensiona la liquidità di sicurezza (Dry Powder) calcolandola autonomamente in base ai dati di Expected Shortfall e VaR presenti nel payload, spiegando al CEO la logica matematica della tua copertura. Mostra il conto (es. "budget allocato 5.000$ ÷ prezzo 180$ = 27 quote. Liquidità residua preservata").
Per gli ORDINI di VENDITA o TRIM: rispetta le proporzioni matematiche fornite dal payload (quote possedute, MCR, stop, pesi) — NON inventare liquidazioni totali della posizione se non sono supportate dalla gestione del rischio.
C. INCROCIO CON LE NEWS SPECIFICHE: il payload contiene NEWS PER SINGOLO TITOLO (catalizzatori micro). Incrociale con la tecnica e i fondamentali di QUEL titolo — non liquidarle con un riassunto macro generico. Se una raccomandazione poggia su una notizia, cita quale. MAI inventare un catalizzatore che non è nel payload.
D. GAP PRE/AFTER-MARKET: la colonna Pre/After mostra dove scambia il titolo FUORI dalla sessione ufficiale. Quando il dato esiste, usalo per calibrare il limite ed EVITA esplicitamente i gap in apertura; quando manca, dichiaralo come incognita.

BRIEFING SUI PROBLEMI NOTI DEL SISTEMA (osservazioni strategiche, NON divieti assoluti):
1. LATENZA MACRO: usa la ricerca web per fare double-check sui dati flaggati come datati o inaffidabili.
2. GESTIONE LIQUIDITÀ (DRY POWDER) E RISCHIO CAMBIO: Non azzerare mai la liquidità. Mantenere cassa per i ribassi è una scelta strategica vitale. Valuta anche che impiegare liquidità su asset USA aumenta il rischio FX non coperto se l'Euro è forte.
3. LET WINNERS RUN E MCR: Non siamo un fondo regolamentato: non c'è NESSUN obbligo di vendere se un titolo supera il 10% del NAV. Lascia correre i profitti sulle aziende eccellenti. Usa il 10% e l'MCR solo per far riflettere il CEO sulla volatilità, non come divieti imperativi.
4. CONCENTRAZIONE SETTORIALE (IL PARADOSSO DIVERSIFICAZIONE): Se suggerisci un acquisto forte (es. SNDK) ma il fondo ha già posizioni enormi nello stesso settore (es. MU), NON omettere il suggerimento, ma fai NOTARE esplicitamente al CEO che l'operazione aumenterebbe la concentrazione settoriale e annullerebbe la diversificazione. Il trade va esposto, la scelta resta al CEO.
5. IGIENE DEI DATI E ISTRUZIONI: "n.d." = dato non disponibile, non inventarlo. Preferisci ordini LIMITE.

Sii proattivo e spietato sui rischi: se vedi un problema che il CEO non ti ha chiesto di guardare, sollevalo tu.`;
function promptHeaderText() {
  const ov = localStorage.getItem("prompt_header");
  return (ov && ov.trim()) ? ov : DEFAULT_PROMPT_HEADER;
}
function savePromptHeader(text) {
  const t = (text || "").trim();
  const isDefault = !t || t === DEFAULT_PROMPT_HEADER.trim();
  if (isDefault) localStorage.removeItem("prompt_header");
  else localStorage.setItem("prompt_header", t);
  // sul server scrivo SEMPRE testo valido: la testata effettiva (default reale se si ripristina)
  pushPromptHeaderCloud(isDefault ? DEFAULT_PROMPT_HEADER : t);
}
/* POST equivalente: sovrascrive config/prompt_header.txt via GitHub Contents API */
async function pushPromptHeaderCloud(text) {
  const token = localStorage.getItem("gh_token");
  if (!token) return false;
  try {
    let sha;
    const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${PROMPT_HEADER_PATH}`, { headers: ghHeaders(token), cache: "no-store" });
    if (g.ok) sha = (await g.json()).sha;
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${PROMPT_HEADER_PATH}`, {
      method: "PUT", headers: ghHeaders(token),
      body: JSON.stringify({ message: "Aggiorna testata prompt AI (da dashboard)", content: btoa(unescape(encodeURIComponent(text))), sha }),
    });
    return r.ok;
  } catch { return false; }
}
/* GET equivalente: legge la testata server-side e la usa come override (server vince) */
async function loadPromptHeaderCloud() {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${PROMPT_HEADER_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const txt = (await r.text()).trim();
    if (txt && txt !== DEFAULT_PROMPT_HEADER.trim()) localStorage.setItem("prompt_header", txt);
    else localStorage.removeItem("prompt_header");   // server allineato al default -> nessun override
  } catch { /* offline: resta l'eventuale override locale */ }
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
  // ORDINE WEB-SEARCH IN CIMA: se ci sono dati mancanti/inaffidabili, l'imperativo va visto
  // PRIMA di tutto il resto (l'LLM tende a "dimenticarlo" se sepolto in fondo al payload)
  if ((dqV.bad || []).length) {
    lines.push(`⚠⚠ PRIMO ORDINE OPERATIVO (esegui PRIMA di scrivere l'analisi): questi dati macro sono MANCANTI o INAFFIDABILI nel payload → [${dqV.bad.map(b => b.key).join(", ")}]. Usa OBBLIGATORIAMENTE la ricerca web per reperirne il valore reale corrente (cita valore, fonte e data per ciascuno) e usali per la lettura di leva finanziaria e valutazioni. Se la ricerca non li recupera, lasciali mancanti ma dichiaralo e tienine conto — non trattarli come zero.`);
    lines.push("");
  }
  const ageMin = Math.round((Date.now() - new Date(DATA.updated_at).getTime()) / 60000);
  const lagNote = ageMin > 90 ? ` [ATTENZIONE: snapshot di ${ageMin >= 120 ? Math.round(ageMin / 60) + " ore" : ageMin + " min"} fa — i prezzi potrebbero essere disallineati dal mercato live; verifica online i livelli critici prima di ragionarci sopra]` : "";
  lines.push(`DATI AL ${new Date(DATA.updated_at).toLocaleString("it-IT")} (prezzi: snapshot pipeline + refresh live lato client ogni 60s)${lagNote}`);
  const cashLine = t.cash ? ` · liquidità ${fmtEUR.format(t.cash)}` : "";
  lines.push(`SITUAZIONE PATRIMONIALE: patrimonio totale ${fmtEUR.format(Math.round(patrimonio))}${cashLine} · capitale investito (costo) ${fmtEUR.format(t.eur_cost ?? t.eur_invested)} · guadagno lordo ${signTxt(Math.round(t.eur_gain), " €")} (${signTxt(Math.round(t.eur_gain_pct * 100) / 100)})${t.eur_gain_net != null ? ` · netto tasse stimato ${signTxt(Math.round(t.eur_gain_net), " €")}` : ""}.`);
  // METRICHE DI RISCHIO/PORTAFOGLIO (dai popup della dashboard)
  const riskBits = [];
  if (t.portfolio_sharpe_ratio != null) riskBits.push(`Sharpe Ratio portafoglio ${fmtNum.format(t.portfolio_sharpe_ratio)} vs target istituzionale 2.0 (log-rendimenti giornalieri 12M, matrice di covarianza, pesi mark-to-market, Rf ${fmtNum.format((t.risk_free_rate ?? 0.0363) * 100)}%)`);
  if (t.portfolio_sortino_ratio != null) riskBits.push(`Sortino Ratio ${fmtNum.format(t.portfolio_sortino_ratio)} (come lo Sharpe ma con la sola volatilità NEGATIVA: se Sortino >> Sharpe, gran parte della varianza è al rialzo — rischio "vero" più basso di quanto lo Sharpe suggerisca)`);
  {
    const vE = t.var95_hist_eur ?? t.var95_1d_eur, vP = t.var95_hist_pct ?? t.var95_1d_pct;
    const eE = t.es95_hist_eur ?? t.es95_1d_eur;
    const isHist = t.var95_hist_eur != null;
    if (vE != null) riskBits.push(`VaR 95% a 1 giorno${isHist ? " (STORICO, percentili empirici 12M — onesto sulle code grasse)" : " (parametrico normale — sottostima le code)"}: ${fmtEUR.format(vE)} (${fmtNum.format(vP)}% del comparto azionario)${eE != null ? `, Expected Shortfall 95%: ${fmtEUR.format(eE)} (perdita MEDIA nel 5% dei giorni peggiori)` : ""}${isHist && t.var95_1d_eur != null ? ` [parametrico: ${fmtEUR.format(t.var95_1d_eur)}]` : ""}`);
  }
  const pbP = portfolioBeta();
  if (pbP) riskBits.push(`Beta di Portafoglio: ${fmtNum.format(pbP.beta)} vs Nasdaq 100 (=1.0) — ${pbP.src}, pesi mark-to-market sul capitale investito, liquidità esclusa, BTP a beta 0`);
  if (t.avg_pairwise_corr != null) riskBits.push(`correlazione media tra le posizioni: ${fmtNum.format(t.avg_pairwise_corr)} (log-rendimenti giornalieri 12M — più è alta, minore la diversificazione reale)`);
  const fxP = fxExposure();
  if (fxP) riskBits.push(`Rischio cambio EUR/USD: ${fmtNum.format(fxP.pct)}% del NAV denominato in USD NON coperto${fxP.eurusd ? ` (EUR/USD ${fmtNum.format(fxP.eurusd)})` : ""} — un apprezzamento dell'euro dell'1% costa ~${fmtEUR.format(Math.round(fxP.usdEur * 0.01))} a parità di prezzi`);
  // concentrazione: posizione più pesante e primo settore (per le regole di sizing/correlazione)
  const wPos = (DATA.portfolio || []).map(r => ({ tk: r.ticker, w: positionWeightPct(r) })).filter(x => x.w != null).sort((a, b) => b.w - a.w);
  if (wPos.length) {
    const over10 = wPos.filter(x => x.w > 10);
    riskBits.push(`posizione più pesante: ${wPos[0].tk} ${fmtNum.format(wPos[0].w)}% del NAV${over10.length ? ` — SOPRA il limite del 10%: ${over10.map(x => `${x.tk} ${fmtNum.format(x.w)}%`).join(", ")}` : " (entro il limite del 10%)"}`);
  }
  const allocR = DATA.allocation || [];
  if (allocR.length) {
    const totA = allocR.reduce((s, a) => s + (a.value_eur || 0), 0) || 1;
    const bySecR = {};
    allocR.filter(a => a.sector !== "Liquidità").forEach(a => { const k = a.sector || a.ticker; bySecR[k] = (bySecR[k] || 0) + (a.value_eur || 0); });
    const invTot = Object.values(bySecR).reduce((s, v) => s + v, 0) || 1;
    const topSec = Object.entries(bySecR).sort((a, b) => b[1] - a[1])[0];
    if (topSec) riskBits.push(`primo settore: ${topSec[0]} ${Math.round(topSec[1] / invTot * 100)}% dell'investito${topSec[1] / invTot > 0.25 ? " — SOPRA la soglia del 25% (regola correlazione attiva)" : ""}`);
    void totA;
  }
  if (cashEur > 0 && patrimonio > 0) {
    const cFrac = cashEur / patrimonio;
    riskBits.push(`Liquidità infruttifera: ${(cFrac * 100).toFixed(1)}% del patrimonio a rendimento 0 (drag strutturale sul rendimento composto e sullo Sharpe complessivo)`);
  }
  if (t.budget_operativo_spendibile != null && (t.es95_hist_eur ?? t.es95_1d_eur) != null) {
    const esAbs = t.es95_hist_eur ?? t.es95_1d_eur;
    riskBits.push(`BUDGET OPERATIVO SPENDIBILE (già calcolato, USA QUESTO — non rifare il conto): ${fmtEUR.format(Math.round(t.budget_operativo_spendibile))} = liquidità ${fmtEUR.format(cashEur)} − Expected Shortfall 95% ${fmtEUR.format(esAbs)} (quota tail-risk inviolabile)`);
  }
  if (riskBits.length) lines.push("METRICHE DI RISCHIO: " + riskBits.join(" · ") + ".");
  // riconciliazione broker: se i dati manuali sono stantii/incoerenti l'AI deve saperlo
  try {
    const rec = reconcileState();
    if (rec.needed) {
      const bits = [];
      if (rec.staleDays != null && rec.staleDays > 14) bits.push(`snapshot broker vecchio di ${rec.staleDays} giorni (${(DATA.broker || {}).as_of})`);
      if (rec.mismatches.length) bits.push(`controvalore ricalcolato che diverge >20% dal bval broker su: ${rec.mismatches.map(m => `${m.tk} ${m.dev > 0 ? "+" : ""}${m.dev}%`).join(", ")}`);
      lines.push(`⚠ RICONCILIAZIONE BROKER NECESSARIA (${bits.join("; ")}): i campi statici del broker potrebbero non riflettere trade recenti. Fidati dei valori RICALCOLATI (prezzo live × quantità) e segnala l'incoerenza IN APERTURA del report chiedendo conferma delle posizioni.`);
    }
  } catch { /* no-op */ }
  // STAGIONALITÀ del mese corrente
  if (m.seasonality && m.seasonality.score != null) {
    const se = m.seasonality;
    const cm = MONTH_NAMES[(se.current_month || 1) - 1];
    lines.push(`STAGIONALITÀ (${cm}): score ${se.score}/100 (${se.label})${se.sp_score != null ? ` · S&P ${se.sp_score}` : ""}${se.ndx_score != null ? ` · Nasdaq ${se.ndx_score}` : ""} — tendenza statistica storica del mese, da usare come contesto di probabilità.`);
  }
  // SINTESI NEWS (tono complessivo)
  if ((DATA.news || []).length) {
    const ns = newsSummary(DATA.news);
    lines.push(`SINTESI NEWS: tono ${ns.tone.t} su ${ns.tot} notizie (${ns.bull} positive, ${ns.neu} neutre, ${ns.bear} negative).`);
  }
  // OUTPUT DEL MOTORE DELLA DASHBOARD — solo DATI di contesto sul posizionamento interno.
  // In modalità standby l'AI NON deve commentarli operativamente né trasformarli in raccomandazioni.
  try {
    const dv = decisionVerdict();
    lines.push(`OUTPUT DEL MOTORE DELLA DASHBOARD (posizionamento interno calcolato dalla dashboard — usalo come base quantitativa per le tue raccomandazioni, validandolo criticamente invece di ripeterlo a pappagallo; se il tuo giudizio diverge dal motore, dichiaralo e motiva): verdetto interno ${dv.label} — ${dv.reasons.join("; ")}.`);
    lines.push(`INDIPENDENZA SUL VERDETTO: NON limitarti a ripetere i candidati ad accumulo della dashboard. Controlla l'intera Watchlist e la tabella della ROTAZIONE SETTORIALE. Se vedi settori in forte crescita mensile (es. Biotech) contrapposti a settori in contrazione (es. Semiconduttori), sfida il verdetto della dashboard e proponi una rotazione strategica alternativa se migliora l'MCR globale del portafoglio.`);
    lines.push(`ANALISI PER-TITOLO: per i titoli rilevanti di PORTAFOGLIO e WATCHLIST — tenendo conto delle ultime operazioni del DIARIO DELLE AZIONI — fai un'analisi tecnica E fondamentale specifica su quel titolo, incrociando le sue news e il contesto macro. NON generalizzare e NON inventare dati non presenti nel payload (anti-allucinazione): se un dato manca, dichiaralo.`);
    lines.push("· NOTA METODOLOGICA: gli Stop Loss sulle posizioni sono TRAILING RATCHET su base 2×ATR(14 Wilder): partono 2×ATR sotto il prezzo e da lì possono solo SALIRE coi massimi — non si riabbassano nei ribassi (persistiti tra i run, reset solo se il trade cambia). NON sono percentuali fisse. Il verdetto di accumulo è ritarato sul mandato quant: impatto marginale sullo Sharpe, forza relativa 1M vs benchmark, qualità fondamentale; gli asset in veto (value trap / ROIC<0 / PEG<0) sono esclusi a prescindere dal supporto tecnico.");
    if ((dv.stopViolations || []).length) {
      lines.push("· ⚠ STOP VIOLATI (il prezzo è SOTTO lo stop trailing ancorato — dedica a ciascuno una raccomandazione esplicita (uscire o ri-armare), con motivazione): " +
        dv.stopViolations.map(x => `${x.r.ticker} stop $${fmtNum.format(x.stop)} vs prezzo $${fmtNum.format(x.r.price)} (${signTxt(Math.round((x.r.price / x.stop - 1) * 1000) / 10)})`).join(" · ") + ".");
    }
    if ((dv.withPlan || []).length) {
      lines.push("· Livelli calcolati dal motore (contesto, ordini limite + stop 2×ATR): " +
        dv.withPlan.map(p => {
          const atrTag = p.atr ? ` [stop = ingresso − 2×ATR ${p.atr.src}, ATR ${fmtNum.format(p.atr.pct)}%]` : " [stop fallback −8%: ATR n.d.]";
          return `${p.r.ticker} limite $${fmtNum.format(Math.round(p.limit * 100) / 100)} / stop $${fmtNum.format(p.stop)} (score quant ${p.q}/100)${atrTag}`;
        }).join(" · ") + ".");
    }
    if ((dv.trailing || []).length) {
      lines.push("· Stop trailing posizioni aperte (ratchet 2×ATR, ancorati — non ridiscendono): " +
        dv.trailing.map(x => `${x.r.ticker} stop $${fmtNum.format(x.stop)} (${signTxt(Math.round((x.stop / x.r.price - 1) * 1000) / 10)}${x.violated ? " ⚠VIOLATO" : ""})`).join(" · ") + ".");
    }
    if ((dv.excluded || []).length) lines.push("· ESCLUSI dal veto risk manager (contesto): " + dv.excluded.map(x => `${x.r.ticker} → ${x.verdict} (${x.why.join(", ")})`).join(" · ") + ".");
    if ((dv.overweight || []).length) lines.push("· Sizing oltre il 10% del NAV (candidati a trimming di rientro): " + dv.overweight.map(x => `${x.r.ticker} ${fmtNum.format(x.w)}%`).join(" · ") + ".");
    if ((dv.trim || []).length) lines.push("· Posizioni segnalate dal motore come tese (contesto): " + dv.trim.map(r => `${r.ticker} (${r.pe > 150 ? "P/E " + fmtNum.format(r.pe) : "RSI " + r.rsi})`).join(" · ") + ".");
    if ((dv.harvest || []).length) lines.push("· Minusvalenze latenti utilizzabili fiscalmente (contesto): " + dv.harvest.map(r => `${r.ticker} (${signTxt(Math.round(r.gain_eur), " €")})`).join(" · ") + ".");
  } catch { /* no-op */ }
  // DIARIO DELLE AZIONI (storico operazioni e motivazioni dell'utente)
  const diary = loadDiary();
  if (diary.length) {
    lines.push("");
    lines.push("DIARIO DELLE AZIONI (mie operazioni passate e motivazioni — usalo per capire la mia strategia e dare continuità ai consigli):");
    diary.slice(0, 30).forEach(e => lines.push(`- ${new Date(e.date).toLocaleDateString("it-IT")}: ${e.text}`));
  }
  lines.push("");
  lines.push(`PORTAFOGLIO — ${DATA.portfolio.length} POSIZIONI: la tua Tabella A deve avere ESATTAMENTE ${DATA.portfolio.length} righe (controvalore e P&L reali per posizione; Sharpe 1A = rendimento/rischio; Drawdown 52S = distanza dal max; ±ImpMove = movimento implicito earnings; RVol = volume oggi/media 30gg; Stop 2×ATR = stop dinamico su volatilità):`);
  const f = (v, d = 2) => v === null || v === undefined ? "—" : fmtNum.format(v);
  const mdRow = (r) => {
    const c = cur(r);
    const optC = (DATA.options || {})[r.ticker];
    // wall sanity: un muro fuori da 0.4×–2.5× lo spot è un relitto di chain degenere → n.d.
    const wallOk = (w) => (w != null && r.price != null && w >= r.price * 0.4 && w <= r.price * 2.5) ? w : null;
    let cw = wallOk(optC?.expiries?.[0]?.call_wall), pw = wallOk(optC?.expiries?.[0]?.put_wall);
    if (cw != null && cw === pw && r.price && Math.abs(cw / r.price - 1) > 0.25) { cw = pw = null; }   // firma chain artefatta
    const optNote = (cw != null || pw != null) ? `CW:${cw != null ? c + f(cw) : "n.d."} PW:${pw != null ? c + f(pw) : "n.d."}` : "—";
    const rsBench = r.rs_bench === "sox" ? "SOX" : r.rs_bench === "ndx" ? "NDX" : "S&P";
    const rsCell = r.rs_1m != null ? `${r.rs_1m > 0 ? "+" : ""}${r.rs_1m}% (vs ${rsBench})` : "—";
    const rsNdxCell = r.rs_ndx_1m != null ? `${r.rs_ndx_1m > 0 ? "+" : ""}${r.rs_ndx_1m}pp` : "—";
    const sh = r.sharpe_1y != null ? fmtNum.format(r.sharpe_1y) : "—";
    const so = r.sortino_1y != null ? fmtNum.format(r.sortino_1y) : "—";
    const dd = r.w52_dist_pct != null ? signTxt(r.w52_dist_pct) : "—";
    const im = impliedMoveForEarnings ? impliedMoveForEarnings(r) : null;
    const imTxt = im != null ? `±${im}%` : "—";
    const shortF = r.stats?.short_float != null ? fmtNum.format(Math.round(r.stats.short_float * 1000) / 10) + "%" : "—";
    // Flottante (azioni liberamente scambiabili): milioni/miliardi + % sul totale se disponibile.
    // Rischio short squeeze / volatilità asimmetrica: low float + short alto + RVol alto = polveriera.
    const fsh = r.stats?.float_shares;
    const floatCell = fsh != null
      ? (fsh >= 1e9 ? (fsh / 1e9).toFixed(1) + "B" : Math.round(fsh / 1e6) + "M") + (r.stats?.float_pct != null ? ` (${fmtNum.format(r.stats.float_pct)}%)` : "")
      : "—";
    // RVol (Volume Relativo) + flag Volumi Anomali (>1,5×)
    const rv = r.vol_ratio;
    const rvCell = rv != null ? `${fmtNum.format(rv)}×${rv > 1.5 ? " [Volumi Anomali]" : ""}` : "—";
    // Stop trailing: ratchet della pipeline sulle posizioni, 2×ATR client su watchlist
    const st = r.qty ? stopOf(r) : atrStop(r.price, r);
    let stopCell = "—";
    if (st) {
      const tag = r.qty ? (st.ratchet ? "ratchet" : "client") : "teorico";
      stopCell = `${c}${f(st.stop)} (${tag})`;
    }
    // flag di rischio inline nel nome: stop violato, earnings imminenti, illiquidità, FX
    const flags = [];
    const dr = (DATA.macro || {}).dollar_ruler;
    if (dr && dr.flag && (r.stats?.market_cap ?? 0) >= 100e9) {
      flags.push(dr.chg_3m_pct >= 5 ? "[FX HEADWIND]" : "[FX TAILWIND]");   // large cap: utili esteri sensibili al dollaro
    }
    if (r.qty && st && st.violated) flags.push("[STOP VIOLATO]");
    if (earningsRiskDays(r) != null) flags.push("[!EARNINGS RISK]");
    if (isIlliquid(r)) flags.push("[ILLIQUIDO]");
    const nameCell = `${r.name} (${r.ticker})${flags.length ? " " + flags.join(" ") : ""}`;
    // R/R teorico per la Tabella B: pipeline (risk_reward) o fallback client stessa formula
    let rrCell = r.risk_reward ?? null;
    if (rrCell == null && r.support && r.resistance && r.support > 0) {
      const aObj = atrOf(r);
      if (aObj && aObj.atr > 0) {
        const reward = r.resistance - r.support, risk = 2 * aObj.atr;
        rrCell = (reward > 0 && risk > 0) ? `1:${(reward / risk).toFixed(1)}` : null;
      }
    }
    rrCell = rrCell ?? "n.d.";
    const adjL = r.prezzo_limite_aggiustato;
    const priceCell = `${c}${f(r.price)}${(adjL != null && r.price != null && Math.abs(adjL - r.price) / r.price > 0.001) ? ` → agg. ${c}${f(adjL)} (${r.prepost?.label || "ext"})` : ""}`;
    return `| ${nameCell} | ${r.qty ? fmtNum.format(r.qty) : "—"} | ${r.qty ? c + f(r.pmc) : "—"} | ${priceCell} | ${signTxt(r.change_pct)} | ${r.qty ? signTxt(r.gain_pct) : "—"} | ${r.rsi ?? "—"} | ${rvCell} | ${rsCell} | ${rsNdxCell} | ${sh} | ${so} | ${dd} | ${shortF} | ${floatCell} | ${r.support ? c + f(r.support) : "—"} | ${stopCell} | ${rrCell} | ${r.pe && r.pe > 0 ? f(r.pe) : "—"} | ${f(r.eps)} | ${f(betaOf(r))} | ${r.rating?.upside_pct != null ? signTxt(r.rating.upside_pct) : "—"} | ${r.earnings_date || "—"}${im != null ? ` ${imTxt}` : ""} | ${r.signal} | ${optNote} |`;
  };
  const head = "| Titolo | Qtà | PMC | Prezzo | Oggi | Guad.% | RSI | RVol | RS 1M (vs bench) | RS 1M vs NDX | Sharpe 1A | Sortino 1A | Drawdown 52S | Short% | Float | Supp. | Stop 2×ATR | R/R teorico | P/E | EPS | Beta NDX | Target Δ | Trimestrale (±ImpMove) | Segnale | Opzioni (CW/PW) |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  lines.push(head); lines.push(sep);
  DATA.portfolio.forEach(r => lines.push(mdRow(r)));
  lines.push("(Stop = TRAILING RATCHET: parte a 2×ATR(14 Wilder) sotto il prezzo e da lì può solo SALIRE coi massimi — non si riabbassa nei ribassi; persistito tra i run, si resetta se il trade cambia. \"client\"=ricalcolato ora senza ancoraggio, \"teorico\"=watchlist. [STOP VIOLATO] = prezzo sotto lo stop ancorato → disciplina: uscita o ri-arm dichiarato. Sortino 1A = Sharpe con la sola volatilità NEGATIVA: è il metro del veto value trap (< -0.3 = distruzione di valore sul downside). Beta NDX = regressione log-rendimenti 12M vs Nasdaq 100 (non il beta 5A Yahoo). [Volumi Anomali] = RVol>1,5. [!EARNINGS RISK] = trimestrale <14gg. [ILLIQUIDO] = posizione >5% del volume medio giornaliero → slippage rilevante. Float = azioni fluttuanti liberamente scambiabili (milioni/miliardi, e % sul totale). R/R teorico = GIÀ CALCOLATO dal sistema (reward = resistenza − supporto; risk = 2×ATR): usalo in Tabella B senza rifare l'algebra; n.d. = non calcolabile. \"→ agg. $X\" = PREZZO LIMITE AGGIUSTATO già calcolato dal sistema sul gap pre/after: USA QUELLO per gli ordini limite, non ricalcolare il gap a mano. [FX HEADWIND/TAILWIND] = large cap (mcap≥$100B) esposta al Righello Dollaro attivo.)");
  lines.push("· [LOW FLOAT RISK]: Un titolo con flottante ridotto (Low Float < 50M azioni) unito a uno Short Interest ≥ 15% e Volumi Anomali (RVol > 1.5) indica un rischio imminente di Short Squeeze o volatilità asimmetrica estrema. L'AI deve evidenziarlo come un'opportunità o un pericolo immediato di liquidità.");
  // MATRICE DI RISCHIO PER POSIZIONE: pesi MTM, MCR, beta NDX, correlazioni reali
  const riskRows = (DATA.portfolio || []).filter(r => r.qty && (r.risk_contrib_pct != null || r.avg_corr != null || r.beta_ndx != null));
  if (riskRows.length) {
    lines.push("");
    lines.push("MATRICE DI RISCHIO PER POSIZIONE (log-rendimenti giornalieri 12M, pesi mark-to-market — usa QUESTI numeri per correlazione e concentrazione del rischio, non stime a memoria):");
    lines.push("| Titolo | Peso % NAV (MTM) | Beta NDX | Quota rischio ptf (MCR) | Corr. media vs ptf | Corr. max (con) |");
    lines.push("|---|---|---|---|---|---|");
    riskRows.slice().sort((a, b) => (b.risk_contrib_pct ?? -1) - (a.risk_contrib_pct ?? -1)).forEach(r => {
      const w = positionWeightPct(r);
      lines.push(`| ${r.ticker} | ${w != null ? fmtNum.format(w) + "%" : "—"} | ${r.beta_ndx != null ? fmtNum.format(r.beta_ndx) : "—"} | ${r.risk_contrib_pct != null ? fmtNum.format(r.risk_contrib_pct) + "%" : "—"} | ${r.avg_corr != null ? fmtNum.format(r.avg_corr) : "—"} | ${r.max_corr != null ? `${fmtNum.format(r.max_corr)} (${r.max_corr_with})` : "—"} |`);
    });
    lines.push("(MCR = contributo marginale al rischio: quota % della varianza totale del portafoglio attribuibile alla posizione — la somma fa 100%. Una posizione con MCR molto sopra il suo peso concentra il rischio.)");
  }
  if ((DATA.watchlist || []).length) {
    lines.push("");
    lines.push(`WATCHLIST — ${DATA.watchlist.length} TITOLI (nessuna posizione): la tua Tabella B deve avere ESATTAMENTE ${DATA.watchlist.length} righe, nessun titolo omesso:`);
    lines.push(head); lines.push(sep);
    DATA.watchlist.forEach(r => lines.push(mdRow(r)));
    // correlazione dei candidati watchlist vs il portafoglio ESISTENTE (per la regola n.2)
    const wlCorr = (DATA.watchlist || []).filter(r => r.avg_corr != null || r.max_corr != null);
    if (wlCorr.length) {
      lines.push("· Correlazione dei candidati watchlist vs il portafoglio attuale (per la regola CORRELAZIONE E SOVRAESPOSIZIONE): " +
        wlCorr.map(r => `${r.ticker} media ${fmtNum.format(r.avg_corr)}${r.max_corr != null ? `, max ${fmtNum.format(r.max_corr)} con ${r.max_corr_with}` : ""}`).join(" · ") + ".");
    }
  }
  lines.push("");
  // ANALISI FONDAMENTALE DETTAGLIATA per ticker
  const fundItems = [...DATA.portfolio, ...(DATA.watchlist || [])].filter(r => r.stats?.market_cap);
  if (fundItems.length) {
    lines.push("ANALISI FONDAMENTALE DETTAGLIATA (valutazione e qualità per le tue raccomandazioni):");
    lines.push("| Titolo | P/E TTM | P/FCF | EV/EBITDA | ROE | Marg.netto | Cresc.ricavi | P/B | PEG | Altman Z'' | Div% | Note |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
    fundItems.forEach(r => {
      const st = r.stats || {};
      const pfcf = st.market_cap && st.fcf && st.fcf > 0 ? Math.round(st.market_cap / st.fcf * 10) / 10 : null;
      const peTtm2 = st.pe_ttm || r.pe;
      const fcfWarn = pfcf != null && peTtm2 > 0 && pfcf > peTtm2 * 2 ? " [!FCF]" : "";
      const roeTag = st.roe != null && st.roe > 0.15 ? " [ROIC>15%]" : "";
      const wlTag = DATA.portfolio.find(p => p.ticker === r.ticker) ? "" : " [WL]";
      // Altman Z-Score + flag [RISCHIO DEFAULT] se <1,81
      const zTag = st.altman_z != null && st.altman_z < 1.81 ? " [RISCHIO DEFAULT]" : "";
      const zCell = st.altman_z != null ? fmtNum.format(st.altman_z) + zTag + (st.altman_missing ? " (proxy)" : "") : "n.d.";
      const noteTags = [roeTag.trim(), fcfWarn.trim(), zTag.trim()].filter(Boolean).join(" ");
      lines.push(`| ${r.ticker}${wlTag} | ${peTtm2 > 0 ? fmtNum.format(Math.round(peTtm2 * 10) / 10) + "×" : "—"} | ${pfcf ? fmtNum.format(pfcf) + "×" + fcfWarn : "—"} | ${st.ev_ebitda ? fmtNum.format(Math.round(st.ev_ebitda * 10) / 10) + "×" : "—"} | ${st.roe ? pctOf(st.roe) + roeTag : "—"} | ${st.profit_margin ? pctPlain(st.profit_margin) : "—"} | ${st.revenue_growth ? pctOf(st.revenue_growth) : "—"} | ${st.price_to_book ? fmtNum.format(Math.round(st.price_to_book * 10) / 10) + "×" : "—"} | ${st.peg > 0 ? fmtNum.format(Math.round(st.peg * 100) / 100) : "n.d."} | ${zCell} | ${st.dividend_yield ? pctPlain(st.dividend_yield) : "—"} | ${noteTags} |`);
    });
    lines.push("([ROIC>15%]=qualità eccellente del capitale; [!FCF]=P/FCF >> P/E → controllare accrual/earnings quality; [RISCHIO DEFAULT]=Altman Z''<1,81, flag prudenziale del mandato — Z'' è la variante non-manifatturieri (6.56·WC/TA+3.26·RE/TA+6.72·EBIT/TA+1.05·MVE/TL, senza Sales/TA), cutoff canonici <1,1 distress / >2,6 solido; P/E TTM='—' con EPS<0 per igiene matematica; [WL]=watchlist)");
    if (DATA.sanity_filtered > 0) lines.push(`[!ANOMALIE FILTRATE DAL SANITY CHECK: ${DATA.sanity_filtered} — valori palesemente errati delle API (P/E assurdi, variazioni impossibili) sono stati rimossi a monte: i dati qui presenti sono già puliti]`);
    lines.push("");
  }
  // contesto economia USA (stile Macrotrends): P/E mercato, tassi Fed, inflazione, PIL, curva
  const usEco = [];
  if (m.sp500_pe) usEco.push(`P/E S&P 500 ${m.sp500_pe.current}×${m.sp500_pe.avg_10y != null ? ` (media 10A ${m.sp500_pe.avg_10y}×)` : ""}${m.sp500_pe.nasdaq_pe ? `, P/E Nasdaq 100 ${m.sp500_pe.nasdaq_pe}×` : ""}`);
  if (m.fed_market) usEco.push(`tasso Fed ${m.fed_market.current_rate}%`);
  const cpiI = (m.indicators || []).find(i => i.key === "cpi");
  const pceI = (m.indicators || []).find(i => i.key === "pce");
  if (cpiI) usEco.push(`inflazione CPI ${cpiI.value}`);
  if (pceI) usEco.push(`PCE ${pceI.value}`);
  if (m.yield_recession?.gdp_last != null) usEco.push(`PIL reale YoY ${signTxt(m.yield_recession.gdp_last)}`);
  if (m.yield_recession?.current_curve != null) usEco.push(`curva 10A-2A ${signTxt(m.yield_recession.current_curve)} pp`);
  if (usEco.length) {
    lines.push("CONTESTO ECONOMIA USA (riferimento Macrotrends — usalo per calibrare rotazione settoriale e rischio del portafoglio):");
    lines.push("- " + usEco.join(" · "));
    lines.push("");
  }
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
  lines.push("QUADRO MACRO:");
  if (m.risk_sentiment) lines.push(`- Sentiment globale: ${m.risk_sentiment.label} (${m.risk_sentiment.score}/100)`);
  if (m.thermometer) lines.push(`- Termometro tecnico del portafoglio: ${m.thermometer.label} (${m.thermometer.score}/100)`);
  if (m.fear_greed) {
    let fgl = `- Fear & Greed: ${m.fear_greed.score} (${FG_LABELS[m.fear_greed.rating] || m.fear_greed.rating}), 1 settimana fa ${m.fear_greed.week_ago}, 1 mese fa ${m.fear_greed.month_ago}${m.fear_greed.year_ago ? `, 1 anno fa ${m.fear_greed.year_ago}` : ""}`;
    if ((m.fear_greed.components || []).length) fgl += ` [componenti: ${m.fear_greed.components.map(c => `${c.label} ${c.rating}${c.score != null ? ` ${c.score}` : ""}`).join("; ")}]`;
    lines.push(fgl);
  }
  // sanity finale sul payload: un valore impossibile diventa "n.d." e NON entra nell'analisi
  const nd = (v, lo, hi) => (v != null && v >= lo && v <= hi) ? v : null;
  const vixOk = m.vix ? nd(m.vix.value, 0.1, 200) : null;   // VIX negativo o assurdo = glitch
  if (vixOk != null) lines.push(`- VIX: ${vixOk} (${signTxt(m.vix.change_pct)} oggi — rilevazione odierna)`);
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
    if (L.retail_mmf_bln != null) bits.push(`Retail Cash: fondi monetari retail $${fmtNum.format(L.retail_mmf_bln)} mld (FRED RMFNS${L.retail_yoy_pct != null ? `, YoY ${signTxt(L.retail_yoy_pct)}` : ""}${L.retail_pctile_5y != null ? `, ${L.retail_pctile_5y}° percentile 5A` : ""})`);
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
  (m.markets || []).forEach(x => lines.push(`- ${x.label}: ${x.value} (${signTxt(x.change_pct, x.suffix || "%")} oggi)`));
  // ogni indicatore economico con la sua data di pubblicazione ESPLICITA: la latenza del dato
  // deve essere palese all'AI (CPI/NFP = mensili con ~1 mese di ritardo; PIL = trimestrale)
  (m.indicators || []).forEach(i => lines.push(`- ${i.label}: ${i.value} (rilevazione ${i.date} — ${i.key === "gdp" ? "serie TRIMESTRALE, il dato più recente disponibile" : "serie mensile, normale ritardo di pubblicazione"})${dqV.flags[i.key] ? " " + dqV.flags[i.key] : ""}`));
  if (m.macroquant) lines.push(`- MacroQuant (ciclo economico, stile BCA): ${m.macroquant.label} (${m.macroquant.score}/100)`);
  if (m.signposts) lines.push(`- BofA Bear-Market Signposts: ${m.signposts.active}/10 attivi (${m.signposts.pct}% rischio ribassista)`);
  const mds = marginDebtState();
  if (mds) {
    const md = mds.md;
    // etichetta 1:1 con la card e il popup della dashboard (marginDebtState) — niente hardcode.
    // La label già esprime lo stato; conf aggiunge solo la sfumatura di conferma senza duplicare.
    const conf = mds.confirmed ? " → RISCHIO SISTEMICO (Forward P/E >20)"
      : (mds.high && mds.fpe != null) ? " (il Forward P/E attuale non conferma il livello estremo)" : "";
    const mdFlag = dqV.flags.margin_debt ? ` ${dqV.flags.margin_debt}` : "";
    lines.push(`- Margin Debt (leva a credito, serie ${md.series || "FRED"}${md.carried ? ", carry-forward dal run precedente" : ""}): $${fmtNum.format(Math.round((md.value || 0) / 1000))} mld = ${md.pct_of_peak}% del picco storico${md.peak_date ? ` (ATH ${md.peak_date})` : ""} — ${mds.label}${conf}${md.yoy != null ? `, YoY ${signTxt(md.yoy)}` : ""} (rilevazione ${md.date}).${mdFlag} Leva alta/estrema = mercato fragile, le discese possono innescare margin call a catena (drawdown più violenti sul tech ad alta beta).`);
  }
  if (m.forward_pe && m.forward_pe.value != null) {
    const fp = m.forward_pe;
    const sysDanger = (m.margin_debt?.pct_of_peak >= 90) && fp.value > 20;
    lines.push(`- Forward P/E S&P 500 [FORWARD, fonte: ${fp.source || "WSJ"} — metodologia DIVERSA dal trailing: NON derivarne tassi di crescita impliciti]: ${fp.value}× vs media storica ${fp.avg_hist}× (${fp.label}). ${sysDanger ? "RISCHIO SISTEMICO ELEVATO: leva ai massimi + valutazioni tese → vulnerabilità a deleveraging violento." : "Valutazioni " + (fp.value > 20 ? "tese ma" : "") + " da monitorare insieme alla leva."}`);
  }
  if (m.credit) {
    let crl = `- Rischio Credito (HY OAS, proxy CDS): ${m.credit.spread_hy}% — ${m.credit.label} (score ${m.credit.score}/100; <4% normale, 5-7% stress, >9% crisi)`;
    const ch = m.credit.history || [];
    if (ch.length > 20) { const d = ch[ch.length - 1].v - ch[ch.length - 21].v; crl += `; trend ~1 mese ${d > 0 ? "+" : ""}${fmtNum.format(Math.round(d * 100) / 100)} pp (${d > 0.15 ? "spread in allargamento = rischio in aumento" : d < -0.15 ? "spread in restringimento = rischio in calo" : "stabile"})`; }
    lines.push(crl);
  }
  if (m.systemic_risk) {
    const sr = m.systemic_risk;
    lines.push(`- Rischio Sistemico & Credito (proxy CDS): HY OAS ${sr.hy_oas}% (${signTxt(sr.hy_chg_1m)} 1m), IG OAS ${sr.ig_oas ?? "—"}% (${sr.ig_chg_1m != null ? signTxt(sr.ig_chg_1m) : "—"} 1m), HY/IG ${sr.hy_ig ?? "—"}×${sr.stlfsi != null ? `, stress finanziario St.Louis ${signTxt(sr.stlfsi)}` : ""} — ${sr.status}`);
  }
  if (m.smart_money) {
    const sm = m.smart_money;
    let l = `- Istituzionali VS Retail: ${sm.label} (${sm.score}/100, basato su SMC di S&P 500 e Nasdaq + VIX term + HY/IG + put/call)`;
    const si = sm.smc_indices || {};
    const idxTxt = Object.values(si).map(s => `${s.label_idx}: struttura ${s.structure}, BOS ${s.bos || "n/d"}, FVG ${s.bull_fvg}↑/${s.bear_fvg}↓, bias ${s.bias}/100`).join(" · ");
    if (idxTxt) l += `. SMC indici → ${idxTxt}`;
    if (sm.vix_term_ratio != null) l += `. VIX/VIX3M ${fmtNum.format(sm.vix_term_ratio)} ${sm.vix_term_ratio > 1 ? "(backwardation=tensione)" : "(contango=calma)"}`;
    if (sm.hy_ig_ratio != null) l += `, HY/IG ${fmtNum.format(sm.hy_ig_ratio)}`;
    const fgBp = m.fear_greed?.score;
    if (fgBp != null) {
      if (fgBp > 75 && sm.score < 30)
        l += ` — *** ALERT DIVERGENZA PERICOLOSA: retail F&G ${fgBp}/100 (LONG ESTREMO) vs istituzionali ${sm.score}/100 (SHORT) — rischio distribuzione imminente, storicamente precede correzioni ***`;
      else if (fgBp < 25 && sm.score > 70)
        l += ` — *** ALERT ACCUMULO ISTITUZIONALE: retail F&G ${fgBp}/100 (PAURA ESTREMA) vs istituzionali ${sm.score}/100 (AGGRESSIVI) — possibile bottom, setup rialzista ***`;
      else if (sm.divergence != null) l += ` — divergenza col retail: ${sm.divergence_label}`;
    } else if (sm.divergence != null) {
      l += ` — divergenza col retail: ${sm.divergence_label}`;
    }
    lines.push(l);
    // SMC per titolo del portafoglio
    const ptfSmc = (DATA.portfolio || []).filter(r => r.smc);
    if (ptfSmc.length) {
      lines.push("- SMC per titolo (struttura/BOS/FVG/bias): " + ptfSmc.map(r => `${r.ticker} ${r.smc.structure}${r.smc.bos ? "/BOS " + r.smc.bos : ""} FVG ${r.smc.bull_fvg}↑${r.smc.bear_fvg}↓ bias ${r.smc.bias}`).join(" · "));
    }
  }
  if (m.decouple?.sp500?.length && m.decouple?.gdp?.length) {
    const gap = Math.round(m.decouple.sp500.slice(-1)[0].v - m.decouple.gdp.slice(-1)[0].v);
    lines.push(`- Disaccoppiamento S&P 500 vs PIL reale: gap ${gap > 0 ? "+" : ""}${gap} pp (>40 pp storicamente precede correzioni; quanta crescita è già prezzata)`);
  }
  if ((m.curve_history || []).length) {
    const cv = m.curve_history.slice(-1)[0].v;
    lines.push(`- Curva 10A-2A: ${cv > 0 ? "+" : ""}${cv} pp (${cv < 0 ? "ancora invertita = rischio recessione" : "tornata positiva dopo l'inversione = dis-inversione in corso"})`);
  }
  if (m.yield_recession) {
    const yr = m.yield_recession;
    lines.push(`- Curva vs Recessione (storico FRED): spread 10A-2A ${yr.current_curve != null ? (yr.current_curve > 0 ? "+" : "") + yr.current_curve + " pp" : "—"}${yr.curve_12m_ago != null ? ` (12m fa ${yr.curve_12m_ago > 0 ? "+" : ""}${yr.curve_12m_ago})` : ""}, ${yr.label}. PIL reale YoY ${yr.gdp_last != null ? yr.gdp_last + "%" : "—"}, sussidi disocc. ${yr.claims_last ?? "—"}. NB: irripidimento post-inversione → storicamente recessione entro ~12 mesi (curva shiftata di 12m anticipa il calo del PIL).`);
  }
  if (m.fedwatch && (m.fedwatch.meetings || []).length) lines.push(`- FedWatch prossima riunione ${m.fedwatch.meetings[0].date}: prob. taglio ${m.fedwatch.meetings[0].cut_prob}%`);
  if ((m.tilt || []).length) {
    lines.push("");
    lines.push("ROTAZIONE SETTORIALE/TEMATICA USA (ETF, performance 1M e 3M):");
    [...m.tilt].sort((a, b) => b.m1 - a.m1).forEach(s =>
      lines.push(`- ${s.name} (${s.ticker}): 1M ${signTxt(s.m1)}, 3M ${signTxt(s.m3)}`));
  }
  if (m.sp500_pe) {
    let peLine = `- P/E Ratio S&P 500 [TRAILING, fonte: ${m.sp500_pe.source || "FRED/multpl"}]: ${m.sp500_pe.current}× (${m.sp500_pe.label})${m.sp500_pe.avg_10y != null ? ` · media 10A ${m.sp500_pe.avg_10y}×` : ""}${m.sp500_pe.pct_rank != null ? ` · percentile storico ${m.sp500_pe.pct_rank}°` : ""}`;
    if (m.sp500_pe.nasdaq_pe) peLine += ` · Nasdaq 100 (QQQ) P/E: ${m.sp500_pe.nasdaq_pe}× (tech solitamente a premio; >35× = valutazioni tese)`;
    lines.push(peLine);
  }
  if (m.corp_profit) {
    let cpBp = `- S&P 500 & Nasdaq 100 vs Profitti Aziendali Reali (FRED CP): S&P gap ${m.corp_profit.gap > 0 ? "+" : ""}${m.corp_profit.gap} pp`;
    if (m.corp_profit.ndx_gap != null) cpBp += `, NDX gap ${m.corp_profit.ndx_gap > 0 ? "+" : ""}${m.corp_profit.ndx_gap} pp`;
    cpBp += ` — ${m.corp_profit.label} (score ${m.corp_profit.score}/100; gap>40 = Asset Inflation da fiat debasement, non crescita utili reali)`;
    lines.push(cpBp);
  }
  if (m.fed_market) lines.push(`- Fed Funds Rate attuale: ${m.fed_market.current_rate}% (rilevazione ${m.fed_market.rate_date}); tasso>4% storicamente comprime i multipli P/E in 12-18 mesi`);
  if (m.witching) lines.push(`- Prossime "4 streghe" (quadruple witching): ${new Date(m.witching.next).toLocaleDateString("it-IT")} (tra ${m.witching.days} gg)`);
  // salute del portafoglio (blend tecnica + macro + fondamentale)
  if (typeof portfolioHealthScore === "function") {
    const ph = portfolioHealthScore();
    if (ph != null) {
      const parts = (typeof portfolioHealthParts === "function") ? portfolioHealthParts() : [];
      lines.push(`- Salute del portafoglio (blend): ${ph}/100${parts.length ? ` [${parts.map(p => `${p[0]} ${p[1]}`).join("; ")}]` : ""}`);
    }
  }
  // concentrazione per settore (utile per il de-risking)
  const alloc = DATA.allocation || [];
  if (alloc.length) {
    const tot = alloc.reduce((s, a) => s + (a.value_eur || 0), 0) || 1;
    const bySec = {};
    alloc.forEach(a => { const k = a.sector || a.ticker; bySec[k] = (bySec[k] || 0) + (a.value_eur || 0); });
    const secs = Object.entries(bySec).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v / tot * 100)}%`);
    lines.push(`- Concentrazione per settore: ${secs.join(" · ")} (portafoglio fortemente sbilanciato sul tech/semi → priorità al de-risking)`);
  }
  // statistiche di performance dal broker
  if (DATA.broker) {
    const b = DATA.broker;
    const pf = [];
    if (b.ytd_pct != null) pf.push(`YTD ${signTxt(b.ytd_pct)}`);
    if (b.y1_pct != null) pf.push(`1 anno ${signTxt(b.y1_pct)}`);
    if (b.inception_pct != null) pf.push(`dall'inizio ${signTxt(b.inception_pct)}`);
    if (pf.length) lines.push(`- Performance storica (broker): ${pf.join(" · ")}`);
  }
  // liquidità e capitale
  if (t.cash) lines.push(`- Liquidità disponibile: ${fmtEUR.format(t.cash)} · capitale investito: ${fmtEUR.format(t.eur_invested)}`);
  if ((DATA.top_caps || []).length) {
    lines.push("");
    lines.push("TOP 10 CAPITALIZZAZIONI MONDIALI:");
    DATA.top_caps.forEach((x, i) => lines.push(`${i + 1}. ${x.name} (${x.ticker}): ${fmtMcap(x.mcap_usd)} (${signTxt(x.change_pct)} oggi)`));
  }
  if ((DATA.top_etfs || []).length) {
    lines.push("");
    lines.push("TOP 10 ETF (metriche di valutazione e segnali di ingresso):");
    lines.push("| ETF | Nome | Prezzo | Oggi | 1M | RSI | P/E | Div% | AUM | Segnale |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|");
    DATA.top_etfs.forEach(r => {
      const m1 = r.sparks?.m1;
      const m1v = m1?.length >= 2 && m1[0] ? ((m1[m1.length-1]/m1[0]-1)*100).toFixed(1) : "—";
      const opp = etfOpportunity(r.rsi);
      lines.push(`| ${r.ticker} | ${r.name} | $${fmtNum.format(r.price || 0)} | ${signTxt(r.change_pct)} | ${m1v !== "—" ? signTxt(+m1v) : "—"} | ${r.rsi ?? "—"} | ${r.pe ?? "—"} | ${r.div_yield ? r.div_yield+"%" : "—"} | ${r.aum ? "$"+r.aum+"B" : "—"} | ${opp.label} |`);
    });
    lines.push("(RSI<35=ipervenduto/possibile ingresso; RSI>70=ipercomprato/attendere; valuta rotazione settoriale e de-risking tech con questi ETF)");
  }
  if ((DATA.predictions || []).length) {
    lines.push("");
    lines.push("MERCATI DI PREVISIONE (Polymarket, prob. Sì):");
    DATA.predictions.forEach(p => lines.push(`- ${p.question}: ${p.yes}%`));
  }
  lines.push("");
  lines.push("ULTIME NEWS (sentiment | titolo | fonte):");
  (DATA.news || []).slice(0, 18).forEach(n => {
    const s = n.sentiment === "bull" ? "[POS]" : n.sentiment === "bear" ? "[NEG]" : "[NEU]";
    lines.push(`- ${s} [${n.tickers.join(",")}] ${n.title} (${n.source})`);
  });
  lines.push("");
  // news per singolo ticker (incrocio)
  const allTickers2 = [...DATA.portfolio.map(r => r.ticker), ...(DATA.watchlist || []).map(r => r.ticker)];
  const tkNews = {};
  (DATA.news || []).forEach(n => {
    (n.tickers || []).forEach(tk => {
      if (allTickers2.includes(tk)) {
        if (!tkNews[tk]) tkNews[tk] = [];
        if (tkNews[tk].length < 3) tkNews[tk].push(n);
      }
    });
  });
  const tkNewsKeys = Object.keys(tkNews);
  if (tkNewsKeys.length) {
    lines.push("");
    lines.push("NEWS RILEVANTI PER SINGOLO TITOLO (catalizzatori e rischi specifici — incrociale con tecnica e fondamentali):");
    tkNewsKeys.forEach(tk => {
      tkNews[tk].forEach(n => {
        const s2 = n.sentiment === "bull" ? "[+]" : n.sentiment === "bear" ? "[-]" : "[~]";
        lines.push(`  ${tk}: ${s2} ${n.title} (${n.source})`);
      });
    });
  }
  lines.push("");
  lines.push(`PROMEMORIA FINALE:
- La forma del report la scegli tu; la sostanza no: cifre decisive integrate nel discorso, ogni dato pesato per la sua data di rilevazione, violazioni matematiche (sizing, Sortino, correlazione) SEMPRE dichiarate anche quando le difendi.
- Raccomandazioni operative inequivocabili (quantità, prezzi, stop coerenti con stop ratchet/supporti/MCR del payload) e disciplina: ordini limite, mai a mercato in apertura.
- Se un dato è flaggato [!!! DATATO / UNRELIABLE !!!] o [LAG TEMPORALE RILEVATO], il double-check web è obbligatorio prima di usarlo.
- Domande al CEO benvenute quando servono. L'ultima parola è sua.`);
  return lines.join("\n");
}

function toast(msg) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

async function showPrompt() {
  const text = buildPrompt();
  $("#prompt-text").value = text;
  $("#modal").hidden = false;
  try {
    await navigator.clipboard.writeText(text);
    toast("Prompt copiato negli appunti ✓ (modificabile nel box)");
  } catch { /* clipboard non disponibile: l'utente può copiare dal box */ }
}

/* ---------------- eventi ---------------- */
$("#btn-refresh").addEventListener("click", refreshAll);
$("#btn-prompt").addEventListener("click", showPrompt);
$("#modal-close").addEventListener("click", () => { $("#modal").hidden = true; });
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").hidden = true; });
$("#btn-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#prompt-text").value);   // copia il testo EDITATO
  toast("Copiato (con le tue modifiche) ✓");
});
/* ---------------- calcolo vendite (plus/minusvalenze) ---------------- */
const sellPriceOv = {};   // prezzo di vendita inserito a mano per ticker (override del prezzo di mercato)
const sellQtyOv = {};     // quantità da vendere digitate: sopravvivono a un eventuale re-render

function sellRows() {
  const eur = DATA.eurusd || 1.08;
  return DATA.portfolio.map(r => {
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
$("#cash-save").addEventListener("click", saveCash);
$("#cash-input").addEventListener("keydown", e => { if (e.key === "Enter") saveCash(); });
$("#signposts-box").addEventListener("click", openSignpostsModal);
$("#tilt-box").addEventListener("click", openTiltModal);
$("#portfolio-health")?.addEventListener("click", openHealthModal);
$("#macroquant-box").addEventListener("click", openMacroQuantModal);
$("#seasonality-box").addEventListener("click", openSeasonalityModal);
$("#tracking-error-box")?.addEventListener("click", openAlphaModal);
$("#ptf-edit-values")?.addEventListener("click", openEditPortfolio);
$("#alloc-edit")?.addEventListener("click", openEditPortfolio);
$("#kpi-edit")?.addEventListener("click", openEditPortfolio);
$("#decision-bar")?.addEventListener("click", openDecisionModal);
$("#sharpe-box")?.addEventListener("click", openPortfolioSharpeModal);
$("#beta-box")?.addEventListener("click", openBetaSimulator);
$("#fx-box")?.addEventListener("click", openFxModal);
$("#margin-debt-box")?.addEventListener("click", openMarginDebtModal);

/* popup Strumenti (PMC, vendite) e News */
function showSimpleModal(id) { const m = $(id); if (m) m.hidden = false; }
function hideSimpleModal(id) { const m = $(id); if (m) m.hidden = true; }
$("#open-pmc")?.addEventListener("click", () => { pmcInit(); pmcCompute(); showSimpleModal("#pmc-modal"); });
$("#open-sell")?.addEventListener("click", () => { renderSellCalc(); showSimpleModal("#sell-modal"); });

/* ---- Editor Testata Prompt (decoupling): apre, mostra, salva sul server ---- */
function openPromptSettings() {
  const ta = $("#prompt-header-editor");
  if (ta) ta.value = promptHeaderText();
  const st = $("#prompt-settings-status");
  if (st) st.textContent = localStorage.getItem("prompt_header") ? "testata personalizzata attiva" : "testata di default";
  showSimpleModal("#prompt-settings-modal");
}
$("#open-prompt-settings")?.addEventListener("click", openPromptSettings);
$("#prompt-settings-close")?.addEventListener("click", () => hideSimpleModal("#prompt-settings-modal"));
$("#prompt-settings-modal")?.addEventListener("click", e => { if (e.target.id === "prompt-settings-modal") hideSimpleModal("#prompt-settings-modal"); });
$("#prompt-settings-save")?.addEventListener("click", async () => {
  const txt = $("#prompt-header-editor")?.value || "";
  savePromptHeader(txt);
  const hasToken = !!localStorage.getItem("gh_token");
  toast(hasToken ? "Testata salvata sul server ✓" : "Testata salvata su questo browser (nessun token: no sync server)");
  hideSimpleModal("#prompt-settings-modal");
});
$("#prompt-settings-reset")?.addEventListener("click", () => {
  if (!window.confirm("Ripristinare la testata di default? Le modifiche salvate verranno perse.")) return;
  savePromptHeader("");                 // "" → rimuove l'override e riporta il file al default
  const ta = $("#prompt-header-editor"); if (ta) ta.value = DEFAULT_PROMPT_HEADER;
  toast("Testata ripristinata al default");
});
$("#news-summary")?.addEventListener("click", () => showSimpleModal("#news-modal"));
$("#pmc-modal-close")?.addEventListener("click", () => hideSimpleModal("#pmc-modal"));
$("#sell-modal-close")?.addEventListener("click", () => hideSimpleModal("#sell-modal"));
$("#news-modal-close")?.addEventListener("click", () => hideSimpleModal("#news-modal"));
["pmc-modal", "sell-modal", "news-modal"].forEach(id =>
  $("#" + id)?.addEventListener("click", e => { if (e.target.id === id) hideSimpleModal("#" + id); }));
document.addEventListener("keydown", e => {
  if (e.key === "Escape") ["#pmc-modal", "#sell-modal", "#news-modal", "#prompt-settings-modal"].forEach(hideSimpleModal);
});
$("#market-direction")?.addEventListener("click", () => {
  const d = marketDirectionScore();
  const comps = directionComponents();
  const lab = d >= 60 ? "Rialzista" : d <= 40 ? "Ribassista" : "Laterale";
  const rows = comps.map(c =>
    `<tr><td>${esc(c.label)}</td><td style="min-width:130px">${meterBar(c.score, scoreColor(c.score), String(c.score))}</td></tr>`).join("");
  openInfoModal("Direzione di mercato — sintesi di tutti i segnali",
    `<div class="info-line">Punteggio aggregato: <b style="color:${scoreColor(d)}">${d}% · ${lab}</b></div>
     <p class="muted" style="margin:4px 0 8px">Media di TUTTI gli indicatori del sistema (sentiment, F&amp;G, VIX, valutazione, BofA, MacroQuant, Fed, carry, dati macro, rotazione settoriale). >60% rialzista, <40% ribassista.</p>
     <table class="info-table"><thead><tr><th>Segnale</th><th>Punteggio (0–100)</th></tr></thead><tbody>${rows}</tbody></table>`);
});
// click sul termometro Financial Health → modale Conto economico
document.addEventListener("click", e => {
  const fh = e.target.closest(".fin-health");
  if (fh) { openFinancialsModal(fh.dataset.fin); return; }
  const fr = e.target.closest(".fund-row");            // riga vista fondamentale → conto economico + statistiche
  if (fr) { openFinancialsModal(fr.dataset.fundTk); return; }
  const sc = e.target.closest(".stat-cell");           // click su una metrica → spiegazione
  if (sc) { toast(sc.dataset.info); return; }
  const bb = e.target.closest(".beta-btn");            // click su Beta → simulatore drawdown
  if (bb) { openBetaSimulator(); return; }
  const rc = e.target.closest(".rs-cell");             // click su RS 1M → spiegazione forza relativa
  if (rc && rc.dataset.rsTk) { openRsInfo(rc.dataset.rsTk); return; }
  const shc = e.target.closest(".sharpe-cell");        // click su Sharpe 1A → spiegazione
  if (shc && shc.dataset.sharpeTk) { openSharpeInfo(shc.dataset.sharpeTk); return; }
  const bi = e.target.closest(".badge-info");          // badge (squeeze/deep value/correzione) → spiegazione
  if (bi && bi.dataset.badge) { e.stopPropagation(); openBadgeInfo(bi.dataset.badge); return; }
  // tap su QUALSIASI punto della riga/card del titolo (no su pulsanti, grafico, opzioni o celle
  // già interattive) → scheda completa. Indispensabile su iPhone dove la riga è una card.
  const tr = e.target.closest("#ptf-table tbody tr, #wl-table tbody tr");
  if (tr && !tr.classList.contains("total-row") && !tr.classList.contains("add-row")
      && !e.target.closest("button, a, input, .spark-cell, [data-opt], .rs-cell, .sharpe-cell, .badge-info")) {
    const tk = tr.querySelector(".name-cell")?.dataset.tk;
    if (tk) { openStockDetail(tk); return; }
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

// due barre range (sopra portafoglio e sopra watchlist) sincronizzate
function syncSparkToggles() {
  document.querySelectorAll("#spark-toggle .chip, #spark-toggle-wl .chip").forEach(c =>
    c.classList.toggle("chip-active", c.dataset.range === sparkRange));
}
document.querySelectorAll("#spark-toggle .chip, #spark-toggle-wl .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    sparkRange = ch.dataset.range;
    localStorage.setItem("pref_range", sparkRange);   // ricorda l'intervallo scelto
    syncSparkToggles();
    renderTable();
    renderWatchlist();
  });
});
// ripristina le preferenze salvate (vista tecnica/fondamentale + intervallo) all'avvio
(function applyPrefs() {
  document.querySelectorAll("#view-toggle .chip").forEach(c => c.classList.toggle("chip-active", c.dataset.view === ptfView));
  $("#ptf-tech-wrap").hidden = ptfView !== "tech"; $("#ptf-fund-wrap").hidden = ptfView !== "fund";
  if ($("#spark-toggle")) $("#spark-toggle").style.display = ptfView === "tech" ? "" : "none";
  document.querySelectorAll("#wl-view-toggle .chip").forEach(c => c.classList.toggle("chip-active", c.dataset.view === wlView));
  $("#wl-tech-wrap").hidden = wlView !== "tech"; $("#wl-fund-wrap").hidden = wlView !== "fund";
  if ($("#spark-toggle-wl")) $("#spark-toggle-wl").style.display = wlView === "tech" ? "" : "none";
  syncSparkToggles();
})();
$("#wl-add-top").addEventListener("click", addWatchlist);
$("#ptf-add-top")?.addEventListener("click", addPortfolio);
document.querySelectorAll("#view-toggle .chip").forEach(ch =>
  ch.addEventListener("click", () => setPtfView(ch.dataset.view)));
document.querySelectorAll("#wl-view-toggle .chip").forEach(ch =>
  ch.addEventListener("click", () => setWlView(ch.dataset.view)));
document.querySelectorAll("#alloc-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#alloc-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    allocMode = ch.dataset.mode;
    renderAllocation();
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

/* modifica posizioni */
$("#ptf-edit")?.addEventListener("click", () => {
  editMode.portfolio = !editMode.portfolio;
  $("#ptf-edit").classList.toggle("chip-active", editMode.portfolio);
  renderTable();
});
$("#wl-edit")?.addEventListener("click", () => {
  editMode.watchlist = !editMode.watchlist;
  $("#wl-edit").classList.toggle("chip-active", editMode.watchlist);
  renderWatchlist();
});
document.addEventListener("click", (e) => {
  const del = e.target.closest(".row-del");
  if (del) { removeHolding(del.dataset.sec, del.dataset.tk); return; }
  const mv = e.target.closest(".row-move");
  if (mv) { moveHolding(mv.dataset.sec, mv.dataset.tk, +mv.dataset.dir); return; }
  const ed = e.target.closest(".row-edit");
  if (ed) { editPosition(ed.dataset.tk); return; }
  const add = e.target.closest(".row-add");
  if (add) { quickAddFromWatchlist(add.dataset.tk, parseFloat(add.dataset.price)); return; }
  if (e.target.id === "ptf-add" || e.target.id === "wl-add") {
    (e.target.id === "ptf-add" ? addPortfolio : addWatchlist)(); return;
  }
  // clic su un nome in watchlist → calcolatore PMC
  const nameCell = e.target.closest("#wl-table .name-cell");
  if (nameCell && !e.target.closest("button")) {
    const tr = nameCell.closest("tr");
    const tk = tr.querySelector(".tk")?.textContent;
    const row = (DATA.watchlist || []).find(w => w.ticker === tk);
    if (row) quickAddFromWatchlist(tk, row.price);
  }
});

/* sposta una posizione su (-1) o giù (+1); aggiorna subito e salva su config */
function moveHolding(section, ticker, dir) {
  const arr = DATA[section];
  const i = arr.findIndex(r => r.ticker === ticker);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];          // riordina subito (feedback istantaneo)
  section === "portfolio" ? renderTable() : renderWatchlist();
  editHoldings(section, cfg => {                 // persiste l'ordine su config/holdings.json
    const a = cfg[section] || [];
    const x = a.findIndex(r => r.ticker === ticker);
    const y = x + dir;
    if (x < 0 || y < 0 || y >= a.length) return false;
    [a[x], a[y]] = [a[y], a[x]];
    return true;
  });
}

/* dalla watchlist al calcolatore PMC / aggiungi al portafoglio */
// clic su un titolo della watchlist → precompila il "Nuovo acquisto" nel calcolatore PMC
function quickAddFromWatchlist(ticker, price) {
  $("#pmc-q1").value = 0;        // posizione attuale: nessuna (è in watchlist)
  $("#pmc-p1").value = 0;
  $("#pmc-q2").value = "";
  $("#pmc-p2").value = price || "";   // prezzo del nuovo acquisto
  pmcCompute();
  $("#pmc-calc").scrollIntoView({ behavior: "smooth" });
  toast(`${ticker} caricato nel calcolatore PMC — inserisci la quantità da simulare`);
}

initSorting("ptf-table", renderTable);
initSorting("wl-table", renderWatchlist);

loadData();
loadDiaryCloud();   // sincronizza il diario azioni dal cloud (se presente)
loadPromptHeaderCloud();   // sincronizza la testata del prompt dal server (config/prompt_header.txt)
loadOverridesCloud();   // sincronizza gli override macro manuali (se presenti)
// ricarica completa (tecnici, news, storico) ogni 5 minuti
setInterval(() => loadData(), 5 * 60 * 1000);
// prezzi live ogni 60 secondi
setInterval(() => livePrices(), 60 * 1000);
