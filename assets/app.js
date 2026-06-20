/* Trading Dashboard — rendering lato client di data/data.json */
const REPO = "Oigres85/Trading";
let DATA = null;
let sparkRange = "m1";   // 1G | 1M | 1A

/* ordinamento tabelle: click su intestazione → desc → asc → default */
const SORT_FIELDS = {
  // colonne attuali (senza "Valore" e "Max storico")
  "ptf-table": ["name", "qty", "pmc", "change_pct", "change_pct", "prepost_chg", "volume",
                "gain", "gain_pct", "pe", "eps", "beta", "support",
                "resistance", "rsi", "vol_ratio", "health", "upside_pct", "upside_pct", "fin_health", null],
  "wl-table": ["name", "change_pct", "change_pct", "prepost_chg", "volume", "pe", "eps",
               "beta", "support", "resistance", "rsi", "vol_ratio",
               "health", "upside_pct", "upside_pct", "fin_health", null],
};
const sortState = { "ptf-table": { field: null, dir: 0 }, "wl-table": { field: null, dir: 0 } };

function sortVal(r, field) {
  if (field === "prepost_chg") return r.prepost?.change_pct ?? null;
  if (field === "upside_pct") return r.rating?.upside_pct ?? null;
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

async function loadData(showSpin = false) {
  const btn = $("#btn-refresh");
  if (showSpin) btn.classList.add("spinning");
  try {
    const res = await fetch(`data/data.json?t=${Date.now()}`, { cache: "no-store" });
    const txt = await res.text();
    // resiliente: NaN/Infinity non sono JSON validi per il browser → li converto in null
    DATA = JSON.parse(txt.replace(/\bNaN\b/g, "null").replace(/-?\bInfinity\b/g, "null"));
    renderAll();
    livePrices();              // sovrappone i prezzi live ai dati del workflow
    if (showSpin) toast("Dati ricaricati ✓");
  } catch (e) {
    console.error(e);
    if (showSpin) toast("Errore nel caricamento dati");
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

/* attende il nuovo data.json (updated_at diverso dal precedente) */
async function waitForNewData(prev, tries = 28) {
  for (let i = 0; i < tries; i++) {
    await new Promise(r => setTimeout(r, 15000));
    try {
      const d = await (await fetch(`data/data.json?t=${Date.now()}`, { cache: "no-store" })).json();
      if (d.updated_at !== prev) { DATA = d; renderAll(); return true; }
    } catch { /* riprova */ }
  }
  return false;
}

/* Aggiorna: prezzi live all'istante + rigenerazione completa via workflow (col token,
   chiesto una sola volta). Senza token resta comunque utile (prezzi live + reload). */
async function refreshAll() {
  const btn = $("#btn-refresh");
  btn.classList.add("spinning");
  btn.textContent = "⏳ Aggiorno…";
  try {
    livePrices();              // prezzi correnti subito (non blocca)
    const token = getToken();
    if (!token) { await loadData(false); toast("Prezzi aggiornati ✓ (token assente: niente rigenerazione completa)"); return; }
    const res = await dispatchWorkflow(token);
    if ([401, 403, 404].includes(res.status)) {
      localStorage.removeItem("gh_token");
      toast("Token senza permesso Actions — rimosso. Creane uno con Actions: read & write e riprova");
      return;
    }
    if (res.status !== 204) { toast(`Errore avvio aggiornamento (HTTP ${res.status})`); return; }
    btn.textContent = "⏳ Rigenero…";
    toast("Rigenerazione avviata — nuovi dati tra ~2-3 minuti");
    if (await waitForNewData(DATA?.updated_at)) toast("Dati rigenerati ✓");
    else toast("Ancora in corso — i dati arriveranno a breve");
  } catch (e) {
    console.error(e);
    toast("Errore durante l'aggiornamento");
  } finally {
    btn.classList.remove("spinning");
    btn.textContent = "⟳ Aggiorna";
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
  renderTable(); fillLivePrice(row, () => { recomputeTotals(); renderKPI(); renderTable(); renderAllocation(); });
  editHoldings("portfolio", cfg => {
    cfg.portfolio = cfg.portfolio || [];
    if (cfg.portfolio.some(p => p.ticker === ticker)) return false;
    cfg.portfolio.push({ ticker, name: ticker, qty, pmc });
    return true;
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
  return {
    ticker, name: ticker, currency, price: null, change_pct: null,
    value: 0, gain: 0, gain_pct: null, pe: null, eps: null, beta: null,
    ath: null, ath_dist_pct: null, support: null, resistance: null, rsi: null,
    volume: null, vol_ratio: null, signal: "in caricamento…", signal_class: "neutral",
    sparks: {}, tech_by_range: {}, rating: null, prepost: null, stats: null,
    earnings_date: null, fin_health: null, sector: "—", _loading: true, ...extra,
  };
}

function fillLivePrice(row, after) {
  fetchQuote(row.ticker).then(q => {
    if (!q) return;
    row.price = Math.round(q.price * 100) / 100;
    row.change_pct = Math.round((q.price / q.prev - 1) * 10000) / 100;
    if (row.currency === "USD" && row.qty) {
      row.value = row.price * row.qty;
      row.gain = row.value - row.pmc * row.qty;
      row.gain_pct = Math.round((row.value / (row.pmc * row.qty) - 1) * 10000) / 100;
    }
    row._loading = false;
    if (after) after();
  });
}

function removeHolding(section, ticker) {
  if (!window.confirm(`Rimuovere ${ticker} da ${section === "portfolio" ? "portafoglio" : "watchlist"}?`)) return;
  // rimozione ottimistica immediata
  DATA[section] = (DATA[section] || []).filter(p => p.ticker !== ticker);
  if (section === "portfolio") { recomputeTotals(); renderKPI(); renderTable(); renderAllocation(); }
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
  const eq = DATA.portfolio.filter(r => r.currency === "USD");
  const btp = DATA.portfolio.find(r => r.ticker === "BTP-V28");
  const usdValue = eq.reduce((s, r) => s + r.value, 0);
  const usdCost = eq.reduce((s, r) => s + r.pmc * r.qty, 0);
  const eurusd = DATA.eurusd || 1.08;
  const btpVal = btp ? btp.value : 0, btpGain = btp ? btp.gain : 0;
  const investedEur = usdValue / eurusd + btpVal;
  const totalEur = investedEur + cashEur;          // include la liquidità
  const costEur = usdCost / eurusd + (btp ? btp.pmc * btp.qty / 100 : 0);
  const eurGain = investedEur - costEur;           // il guadagno è solo sull'investito
  const tax = 0.26 * Math.max(0, (usdValue - usdCost) / eurusd) + 0.125 * Math.max(0, btpGain);
  Object.assign(DATA.totals, {
    usd_value: usdValue, usd_gain: usdValue - usdCost, usd_gain_pct: (usdValue / usdCost - 1) * 100,
    eur_value: totalEur, eur_invested: investedEur, eur_cost: costEur, cash: cashEur,
    eur_gain: eurGain, eur_gain_pct: (investedEur / costEur - 1) * 100,
    tax_est: tax, eur_gain_net: eurGain - tax,
  });
  DATA.allocation = DATA.portfolio.map(r => ({
    ticker: r.ticker, name: r.name, sector: r.sector || "Altro",
    value_eur: r.currency === "EUR" ? r.value : r.value / eurusd,
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
  if (el) el.textContent = `prezzi aggiornati alle ${new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
}

function renderAll() {
  const d = new Date(DATA.updated_at);
  $("#updated-at").textContent = d.toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
  recomputeTotals();            // include la liquidità nei totali/allocazione
  renderCash();
  renderKPI();
  renderHistory();
  renderAllocation();
  renderEarnings();
  renderTable();
  if (ptfView === "fund") renderFundTable();
  renderWatchlist();
  renderGauges();
  renderMacro();
  renderMiniCards();
  renderSectorRotation();
  renderTopCaps();
  renderNews();
  renderBtpInfo();
  renderSellCalc();
  pmcInit();
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

function renderMiniCards() {
  const m = DATA.macro || {};
  const dir = marketDirectionScore();
  const dBox = $("#market-direction");
  if (dBox && dir != null) {
    const lab = dir >= 60 ? "Rialzista" : dir <= 40 ? "Ribassista" : "Laterale";
    dBox.innerHTML = `<div class="mc-title">Direzione mercato</div>
      ${thermoBar(dir, ["Ribasso", "Rialzo"])}
      <div class="mc-value" style="color:${scoreColor(dir)}">${dir}% · ${lab}</div>
      <div class="mc-sub muted">media di tutti i segnali tecnici e macro</div>`;
  }
  const sp = m.signposts, sBox = $("#signposts-box");
  if (sBox && sp) {
    const risk = sp.pct >= 70 ? "Rischio alto" : sp.pct >= 40 ? "Rischio medio" : "Rischio basso";
    sBox.innerHTML = `<div class="mc-title">BofA Bear-Market Signposts</div>
      ${thermoBar(100 - sp.pct, ["Ribassista", "Solido"])}
      <div class="mc-value" style="color:${scoreColor(100 - sp.pct)}">${sp.active}/${sp.total} attivi · ${risk}</div>
      <div class="mc-sub muted">clicca per il dettaglio dei 10 segnali</div>`;
  }
  // Rotazione settoriale (Tilt): settore leader (overweight) e fanalino
  const tilt = m.tilt, tBox = $("#tilt-box");
  if (tBox && tilt && tilt.length) {
    const top = tilt[0], bot = tilt[tilt.length - 1];
    tBox.innerHTML = `<div class="mc-title">Rotazione settoriale (Tilt)</div>
      ${thermoBar(top.score, ["Difensivo", "Aggressivo"])}
      <div class="mc-value">Sovrappeso: <b style="color:var(--green)">${esc(top.name)}</b> ${signTxt(top.m1)}</div>
      <div class="mc-sub muted">debole: ${esc(bot.name)} ${signTxt(bot.m1)} · clicca per il dettaglio</div>`;
  }
  // Quadruple Witching (4 streghe)
  const w = m.witching, wBox = $("#witching-box");
  if (wBox && w && w.next) {
    wBox.innerHTML = `<div class="mc-title">Quadruple Witching (4 streghe)</div>
      <div class="mc-value">${new Date(w.next).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })}</div>
      <div class="mc-sub muted">tra ${w.days} gg · scadenza simultanea di opzioni e futures · clicca</div>`;
  }
  // MacroQuant (stile BCA)
  const mq = m.macroquant, mqBox = $("#macroquant-box");
  if (mqBox && mq) {
    mqBox.innerHTML = `<div class="mc-title">MacroQuant (stile BCA)</div>
      ${thermoBar(mq.score, ["Contrazione", "Espansione"])}
      <div class="mc-value" style="color:${scoreColor(mq.score)}">${mq.score}% · ${mq.label}</div>
      <div class="mc-sub muted">composito ciclo economico · clicca per il dettaglio</div>`;
  }
}

/* ---------------- rotazione settoriale: heatmap + istogramma + popup ---------------- */
function perfColor(p) {
  // verde se sale, rosso se scende (gradiente proporzionale, ±10% = saturo)
  return scoreColor(clamp(50 + p * 5));
}

function renderSectorRotation() {
  const tilt = (DATA.macro || {}).tilt || [];
  const hm = $("#rotation-heatmap"), hi = $("#rotation-hist");
  if (!hm || !hi) return;
  if (!tilt.length) { hm.innerHTML = '<div class="muted">Dati rotazione non disponibili</div>'; hi.innerHTML = ""; return; }
  // heatmap raggruppata per gruppo (Settori / Tematici / Materie prime)
  const groups = {};
  tilt.forEach(s => { (groups[s.group || "Settori"] = groups[s.group || "Settori"] || []).push(s); });
  hm.innerHTML = Object.entries(groups).map(([g, arr]) => `
    <div class="rot-group">
      <div class="rot-group-title">${esc(g)}</div>
      <div class="rot-tiles">${arr.sort((a, b) => b.m1 - a.m1).map(s => `
        <div class="rot-tile" style="background:${perfColor(s.m1)}" title="${esc(s.name)} (${s.ticker}) · 1M ${signTxt(s.m1)} · 3M ${signTxt(s.m3)}">
          <span class="rt-name">${esc(s.name)}</span>
          <span class="rt-pct">${signTxt(s.m1)}</span>
        </div>`).join("")}</div>
    </div>`).join("");
  // istogramma performance 1M ordinato
  const sorted = [...tilt].sort((a, b) => b.m1 - a.m1);
  const maxAbs = Math.max(...sorted.map(s => Math.abs(s.m1)), 1);
  hi.innerHTML = `<div class="rot-hist-title muted">Performance 1 mese (ETF)</div>` + sorted.map(s => {
    const w = Math.abs(s.m1) / maxAbs * 100;
    return `<div class="rot-bar-row">
      <span class="rot-bar-lab">${esc(s.name)} <span class="tk">${s.ticker}</span></span>
      <span class="rot-bar-track"><span class="rot-bar-fill" style="width:${w}%;background:${perfColor(s.m1)}"></span></span>
      <span class="rot-bar-val ${signCls(s.m1)}">${signTxt(s.m1)}</span>
    </div>`;
  }).join("");
}

function openRotationModal() {
  const tilt = (DATA.macro || {}).tilt || [];
  if (!tilt.length) return;
  const byM1 = [...tilt].sort((a, b) => b.m1 - a.m1);
  const lead = byM1.slice(0, 3), lag = byM1.slice(-3).reverse();
  const defensives = ["Utilities", "Consumi difens.", "Salute", "Oro"];
  const defAvg = avg(tilt.filter(s => defensives.includes(s.name)).map(s => s.m1));
  const tech = tilt.find(s => s.ticker === "XLK");
  const cyc = tech ? tech.m1 : null;
  let regime = "—";
  if (defAvg != null && cyc != null) regime = defAvg > cyc ? "DIFENSIVO (i difensivi battono il Tech → cautela/de-risking)" : "PRO-RISCHIO (i ciclici/Tech guidano)";
  const oversold = byM1.filter(s => s.m1 <= -5).map(s => s.name);
  openInfoModal("Analisi rotazione settoriale", `
    <div class="info-line"><b>Regime attuale:</b> ${regime}</div>
    <div class="info-line"><b>In momentum (overweight):</b> ${lead.map(s => `${esc(s.name)} ${signTxt(s.m1)}`).join(" · ")}</div>
    <div class="info-line"><b>In affanno (underweight):</b> ${lag.map(s => `${esc(s.name)} ${signTxt(s.m1)}`).join(" · ")}</div>
    ${oversold.length ? `<div class="info-line"><b>Ipervenduti (-5% 1M):</b> ${oversold.map(esc).join(", ")}</div>` : ""}
    <div class="info-line muted" style="margin-top:8px">Orientamento calcolato sui momentum 1M/3M degli ETF. Non è consulenza; per un piano operativo usa "Copia prompt AI".</div>`);
}
function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }

function openMacroQuantModal() {
  const mq = (DATA.macro || {}).macroquant;
  if (!mq) return;
  const rows = (mq.components || []).map(c =>
    `<tr><td>${esc(c.label)}</td><td style="min-width:120px">${meterBar(c.score, scoreColor(c.score), String(c.score))}</td></tr>`).join("");
  openInfoModal(`MacroQuant (stile BCA) — ${mq.score}% · ${mq.label}`,
    `<p class="muted" style="margin:0 0 8px">${esc(mq.note || "")}</p>
     <div class="info-line">Punteggio: <b style="color:${scoreColor(mq.score)}">${mq.score}/100</b> (alto = ciclo espansivo/risk-on, basso = rischio recessione).</div>
     <h4 style="margin:10px 0 4px">Componenti</h4>
     <table class="info-table"><tbody>${rows}</tbody></table>`);
}

function openTiltModal() {
  const tilt = (DATA.macro || {}).tilt;
  if (!tilt || !tilt.length) return;
  const rows = tilt.map((s, i) => `<tr>
    <td>${i + 1}. ${esc(s.name)} <span class="muted">${s.ticker}</span></td>
    <td class="${signCls(s.m1)}">${signTxt(s.m1)}</td>
    <td class="${signCls(s.m3)}">${signTxt(s.m3)}</td>
    <td>${meterBar(s.score, scoreColor(s.score), String(s.score))}</td></tr>`).join("");
  openInfoModal("Rotazione settoriale USA (Tilt)",
    `<p class="muted" style="margin:0 0 8px">Momentum degli ETF settoriali SPDR. I settori in cima sono i più forti: indicano dove sta ruotando il mercato (overweight). Fonte: Yahoo Finance.</p>
     <table class="info-table"><thead><tr><th>Settore</th><th>1M</th><th>3M</th><th>Forza</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function openWitchingModal() {
  const w = (DATA.macro || {}).witching;
  if (!w) return;
  const dates = (w.upcoming || []).map(d => `<li>${new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })}</li>`).join("");
  const contracts = (w.contracts || []).map(c => `<li>${esc(c)}</li>`).join("");
  openInfoModal("Quadruple Witching — le quattro streghe",
    `<p class="muted" style="margin:0 0 8px">Quattro volte l'anno (3° venerdì di marzo, giugno, settembre, dicembre) scadono contemporaneamente quattro tipi di derivati: spesso aumentano volumi e volatilità.</p>
     <div class="info-line"><b>Prossima:</b> ${w.next ? new Date(w.next).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }) : "—"} (tra ${w.days} giorni)</div>
     <h4 style="margin:10px 0 4px">Prossime date</h4><ul style="margin:0 0 8px 18px">${dates}</ul>
     <h4 style="margin:10px 0 4px">Contratti che scadono</h4><ul style="margin:0 0 0 18px">${contracts}</ul>`);
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
  const eurusd = DATA.eurusd || 1.08;
  let invested, patrimonioInv, gain, gainPct, net, src;
  if (b && b.controvalore_totale) {
    // dati REALI del broker (autorevoli): coerenti con ciò che vedi sul tuo conto
    invested = b.investimenti;
    patrimonioInv = b.controvalore_totale;
    gain = b.profitto_totale_eur;
    gainPct = b.profitto_totale_pct;
    const equityGainEur = (b.profitto_usd || 0) / eurusd;
    const btpVal = (b.controvalore_totale || 0) - (b.controvalore_azioni || 0);
    const btpGain = Math.max(0, btpVal - 40000);
    const tax = 0.26 * Math.max(0, equityGainEur) + 0.125 * btpGain;
    net = gain - tax;
    src = `dati broker · agg. ${new Date(b.as_of).toLocaleDateString("it-IT")}`;
  } else {
    invested = t.eur_invested; patrimonioInv = t.eur_invested; gain = t.eur_gain;
    gainPct = t.eur_gain_pct; net = t.eur_gain_net ?? t.eur_gain; src = "stima dai prezzi";
  }
  const patrimonio = patrimonioInv + cashEur;   // posizioni + liquidità
  const kpis = [
    { label: "Patrimonio totale (€)", value: fmtEUR.format(patrimonio),
      sub: `posizioni ${fmtEUR.format(patrimonioInv)}${cashEur > 0 ? ` + liquidità ${fmtEUR.format(cashEur)}` : ""}`,
      accent: "var(--blue)" },
    { label: "Capitale investito (€)", value: fmtEUR.format(invested),
      sub: src, accent: "var(--purple)" },
    { label: "Guadagno totale (€)", value: signTxt(Math.round(gain), " €"),
      sub: `${signTxt(gainPct)} sul capitale investito`,
      subCls: signCls(gain), accent: gain >= 0 ? "var(--green)" : "var(--red)", valueCls: signCls(gain) },
    { label: "Guadagno netto tasse (€)", value: signTxt(Math.round(net), " €"),
      sub: `dopo tasse stimate (26% azioni · 12,5% BTP)${b && b.cedole_btp ? ` · cedole BTP ${fmtEUR.format(b.cedole_btp)}` : ""}`,
      subCls: signCls(net), accent: net >= 0 ? "var(--green)" : "var(--red)", valueCls: signCls(net) },
  ];

  $("#kpi-grid").innerHTML = kpis.map(k => `
    <div class="kpi" style="--accent:${k.accent}">
      <div class="label">${k.label}</div>
      <div class="value ${k.valueCls || ""}">${k.value}</div>
      <div class="sub ${k.subCls || ""}">${k.sub || ""}</div>
    </div>`).join("");
}

/* ---------------- andamento portafoglio ---------------- */
let histRange = "all";   // w1 | m1 | m3 | y1 | y5 | all — default: dall'inizio
let histBenchKey = "ndx";   // none | nasdaq | ndx | sp500 — default: confronto con Nasdaq 100
const BENCH_LABEL = { nasdaq: "Nasdaq Comp.", ndx: "Nasdaq 100", sp500: "S&P 500", russell: "Russell 2000" };

function renderHistory() {
  const h = DATA.history && DATA.history[histRange];
  const box = $("#hist-chart");
  if (!h || h.values.length < 2) { box.innerHTML = '<div class="muted" style="padding:40px 0;text-align:center">Storico non disponibile</div>'; $("#hist-summary").textContent = ""; return; }
  const vals = h.values, dates = h.dates;
  const bench = (histBenchKey !== "none" && h[histBenchKey] && h[histBenchKey].length === vals.length) ? h[histBenchKey] : null;
  const W = 560, H = 210, pad = { l: 56, r: 12, t: 12, b: 22 };
  const allv = bench ? vals.concat(bench) : vals;
  const min = Math.min(...allv), max = Math.max(...allv), range = max - min || 1;
  const x = i => pad.l + i / (vals.length - 1) * (W - pad.l - pad.r);
  const y = v => pad.t + (1 - (v - min) / range) * (H - pad.t - pad.b);
  const poly = arr => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${pad.l},${y(min)} ${poly(vals)} ${x(vals.length - 1)},${y(min)}`;
  const up = vals[vals.length - 1] >= vals[0];
  const col = up ? "var(--green)" : "var(--red)";
  const grid = [0, .25, .5, .75, 1].map(f => {
    const gv = min + range * f, gy = y(gv);
    return `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${W - pad.r}" y2="${gy.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
      <text x="${pad.l - 6}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${fmtNum.format(Math.round(gv / 1000))}k</text>`;
  }).join("");
  const xl = [0, Math.floor(vals.length / 2), vals.length - 1].map(i => {
    const dt = new Date(dates[i]).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" });
    return `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--muted)">${dt}</text>`;
  }).join("");
  const benchLine = bench ? `<polyline points="${poly(bench)}" fill="none" stroke="var(--cyan)" stroke-width="1.6" stroke-dasharray="4 3" opacity="0.85"/>` : "";
  box.innerHTML = `<svg id="hist-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:210px">
    <defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${col}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <polygon points="${area}" fill="url(#hg)"/>
    <polyline points="${poly(vals)}" fill="none" stroke="${col}" stroke-width="2"/>
    ${benchLine}
    <line id="hist-cursor" x1="0" y1="${pad.t}" x2="0" y2="${H - pad.b}" stroke="var(--text)" stroke-width="1" opacity="0"/>
    <circle id="hist-dot" r="3.5" fill="${col}" opacity="0"/>
    <rect id="hist-hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/>
  </svg>${bench ? `<div class="bench-leg"><span class="leg-dash"></span> ${BENCH_LABEL[histBenchKey]} (riscalato)</div>` : ""}`;
  const first = vals[0], last = vals[vals.length - 1], chg = (last / first - 1) * 100;
  let benchTxt = "";
  if (bench) { const bchg = (bench[bench.length - 1] / bench[0] - 1) * 100; benchTxt = ` · ${BENCH_LABEL[histBenchKey]} ${signTxt(Math.round(bchg * 10) / 10)} (${chg >= bchg ? "sovra" : "sotto"}performance ${signTxt(Math.round((chg - bchg) * 10) / 10)})`; }
  $("#hist-summary").innerHTML = `<span id="hist-tip">${fmtEUR.format(first)} → <b>${fmtEUR.format(last)}</b>
    <span class="${signCls(chg)}">${signTxt(Math.round(chg * 100) / 100)}</span> nel periodo${benchTxt}</span>`;

  // tooltip al passaggio del mouse
  const svg = $("#hist-svg"), hit = $("#hist-hit"), cursor = $("#hist-cursor"), dot = $("#hist-dot"), tip = $("#hist-tip");
  const baseTip = tip.innerHTML;
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const i = Math.max(0, Math.min(vals.length - 1, Math.round((px / r.width * W - pad.l) / (W - pad.l - pad.r) * (vals.length - 1))));
    const vx = x(i), vy = y(vals[i]);
    cursor.setAttribute("x1", vx); cursor.setAttribute("x2", vx); cursor.setAttribute("opacity", ".4");
    dot.setAttribute("cx", vx); dot.setAttribute("cy", vy); dot.setAttribute("opacity", "1");
    const dchg = (vals[i] / first - 1) * 100;
    tip.innerHTML = `${new Date(dates[i]).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}: <b>${fmtEUR.format(vals[i])}</b> <span class="${signCls(dchg)}">${signTxt(Math.round(dchg * 100) / 100)}</span> dal primo giorno`;
  };
  const leave = () => { cursor.setAttribute("opacity", "0"); dot.setAttribute("opacity", "0"); tip.innerHTML = baseTip; };
  hit.addEventListener("mousemove", move);
  hit.addEventListener("touchmove", move);
  hit.addEventListener("mouseleave", leave);
}

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
  const t = DATA.totals;
  const cap = `<div class="cap-line"><span><span class="cap-lab">Capitale investito</span> <b>${fmtEUR.format(Math.round(t.eur_cost))}</b></span>
    <span><span class="cap-lab">Plusvalenza sul capitale</span> <b class="${signCls(t.eur_gain)}">${signTxt(Math.round(t.eur_gain), " €")} (${signTxt(Math.round(t.eur_gain_pct * 10) / 10)})</b></span>
    ${t.cash ? `<span><span class="cap-lab">Liquidità</span> <b>${fmtEUR.format(Math.round(t.cash))}</b></span>` : ""}
    <span><span class="cap-lab">Patrimonio totale</span> <b>${fmtEUR.format(Math.round(t.eur_value))}</b></span></div>`;
  box.innerHTML = cap +
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
    src.forEach(x => { const s = x.sector || "Altro"; by[s] = (by[s] || 0) + x.value_eur; });
    list = Object.entries(by).map(([name, value_eur]) => ({ name, ticker: "", value_eur }))
      .sort((a, b) => b.value_eur - a.value_eur);
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
    return `<li class="alloc-item">
      <span class="alloc-dot" style="background:${ALLOC_COLORS[i % ALLOC_COLORS.length]}"></span>
      <span class="alloc-name">${esc(x.name)} ${x.ticker ? `<span class="tk">${x.ticker}</span>` : ""}</span>
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

function rsiBar(rsi) {
  if (rsi === null || rsi === undefined) return "—";
  // ipervenduto (<30) = verde (opportunità) · ipercomprato (>70) = rosso (rischio)
  const color = scoreColor(100 - rsi);
  return meterBar(rsi, color, fmtNum.format(rsi));
}

function volBar(ratio) {
  if (!ratio) return "—";
  // volume vs media 30gg: normale = verde, anomalo = rosso (gradiente)
  return meterBar((ratio / 3) * 100, scoreColor(clamp(100 - (ratio - 1) * 60)), `${fmtNum.format(ratio)}×`);
}

const RATING_LABELS = {
  strong_buy: ["Strong Buy", "good"], buy: ["Buy", "good"],
  hold: ["Hold", "neutral"], underperform: ["Underperf.", "bad"],
  sell: ["Sell", "bad"], strong_sell: ["Strong Sell", "bad"],
};

function ratingBadge(r) {
  if (!r || !r.key) return "—";
  const [label, cls] = RATING_LABELS[r.key] || [r.key, "neutral"];
  const n = r.n ? ` title="${r.n} analisti — target medio ${fmtNum.format(r.target)}"` : "";
  return `<span class="badge ${cls}"${n}>${label}</span>`;
}

function targetBar(r) {
  if (!r || r.upside_pct === null || r.upside_pct === undefined) return "—";
  const u = r.upside_pct;   // upside alto = verde, negativo = rosso
  return meterBar(Math.abs(u) * 2, scoreColor(clamp(50 + u * 2.5)), signTxt(u));
}

function peBar(pe) {
  if (!pe || pe <= 0) return "—";   // P/E basso = verde (economico), alto = rosso
  return meterBar(Math.min(pe, 60) / 60 * 100, scoreColor(clamp(100 - pe * 2.2)), fmtNum.format(pe));
}

function epsBar(eps) {
  if (eps === null || eps === undefined) return "—";   // utili positivi = verde
  return meterBar(Math.min(Math.abs(eps), 15) / 15 * 100, scoreColor(clamp(50 + eps * 6)), fmtNum.format(eps));
}

function betaBar(beta) {
  if (beta === null || beta === undefined) return "—";   // beta basso = verde (meno rischio)
  return meterBar(Math.min(beta, 3) / 3 * 100, scoreColor(clamp(100 - (beta - 0.5) * 55)), fmtNum.format(beta));
}

function athBar(r) {
  if (!r.ath) return "—";
  const closeness = Math.max(0, 100 + r.ath_dist_pct);   // 100 = sul massimo storico = verde
  return `<div class="meter" title="Max storico ${fmtNum.format(r.ath)}">
    <span class="meter-txt">${signTxt(r.ath_dist_pct)}</span>
    <span class="meter-track"><span class="meter-fill" style="width:${Math.max(3, closeness)}%;background:${scoreColor(closeness)}"></span></span>
  </div>`;
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

function techCells(r) {
  const c = cur(r);
  // supporto/resistenza cambiano con il range selezionato (1S/1M/3M/1A)
  const tw = (r.tech_by_range || {})[sparkRange];
  const support = tw ? tw.support : r.support;
  const resistance = tw ? tw.resistance : r.resistance;
  return `
      <td class="num">${peBar(r.pe)}</td>
      <td class="num">${epsBar(r.eps)}</td>
      <td class="num">${betaBar(r.beta)}</td>
      <td class="num">${support ? c + fmtNum.format(support) : "—"}</td>
      <td class="num">${resistance ? c + fmtNum.format(resistance) : "—"}</td>
      <td class="num">${rsiBar(r.rsi)}</td>
      <td class="num">${volBar(r.vol_ratio)}</td>
      <td><span class="badge ${r.signal_class}">${r.signal}</span></td>
      <td>${ratingBadge(r.rating)}</td>
      <td class="num">${targetBar(r.rating)}</td>
      <td class="num">${finHealthBar(r)}</td>
      <td class="spark-cell" data-tk="${r.ticker}" title="Clicca per ingrandire">${sparkline((r.sparks || {})[sparkRange])}</td>`;
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
};
function statsGrid(stats) {
  const cells = Object.entries(STAT_META)
    .filter(([k]) => stats[k] != null)
    .map(([k, [lab, fmt, info]]) =>
      `<button class="stat-cell" data-info="${esc(lab + ": " + info)}" title="${esc(info)}">
        <span class="stat-lab">${lab}</span><span class="stat-val">${fmt(stats[k])}</span></button>`).join("");
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
    labels += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="#f59e0b" opacity="${op}"><title>Margine ${x.year}: ${x.margin}%</title></circle>`;
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
function openChartModal(title, vals, dates, fmt, controlsHTML) {
  if (!vals || vals.length < 2) { toast("Grafico non disponibile per questo intervallo"); return; }
  fmt = fmt || (v => fmtNum.format(v));
  const W = 900, H = 380, pad = { l: 64, r: 16, t: 16, b: 28 };
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const x = i => pad.l + i / (vals.length - 1) * (W - pad.l - pad.r);
  const y = v => pad.t + (1 - (v - min) / range) * (H - pad.t - pad.b);
  const line = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= vals[0], col = up ? "var(--green)" : "var(--red)";
  const grid = [0, .25, .5, .75, 1].map(f => {
    const gv = min + range * f, gy = y(gv);
    return `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${W - pad.r}" y2="${gy.toFixed(1)}" stroke="var(--border)"/>
      <text x="${pad.l - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)">${fmt(gv)}</text>`;
  }).join("");
  $("#chart-modal-title").textContent = title;
  $("#chart-modal-body").innerHTML = (controlsHTML || "") + `<svg id="cm-svg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    <defs><linearGradient id="cmg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${col}" stop-opacity="0.25"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <polygon points="${pad.l},${y(min)} ${line} ${x(vals.length - 1)},${y(min)}" fill="url(#cmg)"/>
    <polyline points="${line}" fill="none" stroke="${col}" stroke-width="2.5"/>
    <line id="cm-cur" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--text)" opacity="0"/>
    <circle id="cm-dot" r="4.5" fill="${col}" opacity="0"/>
    <rect id="cm-hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/>
  </svg>`;
  const first = vals[0], last = vals[vals.length - 1], chg = (last / first - 1) * 100;
  const baseTip = `${fmt(first)} → ${fmt(last)} · <span class="${signCls(chg)}">${signTxt(Math.round(chg * 100) / 100)}</span> nel periodo`;
  const tip = $("#chart-modal-tip"); tip.innerHTML = baseTip;
  $("#chart-modal").hidden = false;
  const svg = $("#cm-svg"), hit = $("#cm-hit"), cur = $("#cm-cur"), dot = $("#cm-dot");
  const move = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const i = Math.max(0, Math.min(vals.length - 1, Math.round((px / r.width * W - pad.l) / (W - pad.l - pad.r) * (vals.length - 1))));
    cur.setAttribute("x1", x(i)); cur.setAttribute("x2", x(i)); cur.setAttribute("opacity", ".4");
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(vals[i])); dot.setAttribute("opacity", "1");
    const d = dates && dates[i] ? new Date(dates[i]).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) + ": " : "";
    const dchg = (vals[i] / first - 1) * 100;
    tip.innerHTML = `${d}<b>${fmt(vals[i])}</b> <span class="${signCls(dchg)}">${signTxt(Math.round(dchg * 100) / 100)}</span>`;
  };
  hit.addEventListener("mousemove", move);
  hit.addEventListener("touchmove", ev => { ev.preventDefault(); move(ev); }, { passive: false });
  hit.addEventListener("touchstart", move);
}
function closeChartModal() { $("#chart-modal").hidden = true; }

/* zoom del grafico di un singolo titolo, con selettore range e date sul punto */
let cmTicker = null, cmRange = "m1";
const CM_RANGES = [["d1", "1G"], ["w1", "1S"], ["m1", "1M"], ["m3", "3M"], ["m6", "6M"], ["y1", "1A"], ["all", "ALL"]];
const CM_SPAN = { d1: 1, w1: 7, m1: 31, m3: 92, m6: 183, y1: 365, all: 365 * 5 };   // giorni coperti (per le date)

function synthDates(range, n) {
  const span = CM_SPAN[range] || 30, today = Date.now(), out = [];
  for (let i = 0; i < n; i++) out.push(new Date(today - (n - 1 - i) * (span / (n - 1 || 1)) * 86400000).toISOString().slice(0, 10));
  return out;
}

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

async function drawTickerChart() {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === cmTicker);
  if (!r) return;
  const sym = r.currency === "PTS" ? "" : r.currency === "EUR" ? "€" : "$";
  const tv = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(r.ticker.replace("^", ""))}`;
  const controls = `<div class="cm-controls"><div class="spark-toggle cm-ranges">` +
    CM_RANGES.map(([k, lab]) => `<button class="chip cm-range ${k === cmRange ? "chip-active" : ""}" data-range="${k}">${lab}</button>`).join("") +
    `</div><a class="btn btn-ghost btn-sm" href="${tv}" target="_blank" rel="noopener">Apri su TradingView ↗</a></div>`;
  $("#chart-modal-title").textContent = `${r.name} (${r.ticker})`;
  $("#chart-modal-body").innerHTML = controls + `<div class="muted" style="padding:40px 0;text-align:center" id="cm-loading">Carico le candele…</div>`;
  $("#chart-modal-tip").innerHTML = "";
  $("#chart-modal").hidden = false;
  const [yr, yi] = CM_YF[cmRange] || ["1mo", "1d"];
  const ohlc = await fetchOHLC(r.ticker, yr, yi);
  if (cmTicker !== r.ticker) return;          // l'utente ha cambiato nel frattempo
  if (ohlc) {
    drawCandleChart(ohlc, v => sym + fmtNum.format(v), controls);
  } else {                                    // fallback: linea dai dati salvati
    const vals = (r.sparks || {})[cmRange];
    openChartModal(`${r.name} (${r.ticker})`, vals, synthDates(cmRange, (vals || []).length), v => sym + fmtNum.format(v), controls);
  }
}

/* grafico a candele: verde se chiude >= apre, rosso se scende */
function drawCandleChart(data, fmt, controlsHTML) {
  const W = 900, H = 380, pad = { l: 64, r: 16, t: 16, b: 28 };
  const lo = Math.min(...data.map(d => d.l)), hi = Math.max(...data.map(d => d.h));
  const range = hi - lo || 1;
  const x = i => pad.l + (i + 0.5) / data.length * (W - pad.l - pad.r);
  const y = v => pad.t + (1 - (v - lo) / range) * (H - pad.t - pad.b);
  const cw = Math.max(1.2, Math.min(14, (W - pad.l - pad.r) / data.length * 0.65));
  const grid = [0, .25, .5, .75, 1].map(f => {
    const gv = lo + range * f, gy = y(gv);
    return `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${W - pad.r}" y2="${gy.toFixed(1)}" stroke="var(--border)"/>
      <text x="${pad.l - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)">${fmt(gv)}</text>`;
  }).join("");
  const candles = data.map((d, i) => {
    const up = d.c >= d.o, col = up ? "var(--green)" : "var(--red)";
    const cx = x(i), yo = y(d.o), yc = y(d.c);
    const top = Math.min(yo, yc), bh = Math.max(1, Math.abs(yc - yo));
    return `<line x1="${cx.toFixed(1)}" y1="${y(d.h).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${y(d.l).toFixed(1)}" stroke="${col}" stroke-width="1"/>
      <rect x="${(cx - cw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${cw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}"/>`;
  }).join("");
  const xl = [0, Math.floor(data.length / 2), data.length - 1].map(i =>
    `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${new Date(data[i].t).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })}</text>`).join("");
  $("#chart-modal-body").innerHTML = (controlsHTML || "") + `<svg id="cm-svg" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    ${grid}${candles}${xl}
    <line id="cm-cur" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--text)" opacity="0"/>
    <rect id="cm-hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/>
  </svg>`;
  const first = data[0].c, last = data[data.length - 1].c, chg = (last / first - 1) * 100;
  const baseTip = `${fmt(first)} → ${fmt(last)} · <span class="${signCls(chg)}">${signTxt(Math.round(chg * 100) / 100)}</span> nel periodo`;
  const tip = $("#chart-modal-tip"); tip.innerHTML = baseTip;
  const svg = $("#cm-svg"), hit = $("#cm-hit"), cur = $("#cm-cur");
  const move = ev => {
    const rc = svg.getBoundingClientRect();
    const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rc.left;
    const i = Math.max(0, Math.min(data.length - 1, Math.floor((px / rc.width * W - pad.l) / (W - pad.l - pad.r) * data.length)));
    const d = data[i]; cur.setAttribute("x1", x(i)); cur.setAttribute("x2", x(i)); cur.setAttribute("opacity", ".4");
    const cls = d.c >= d.o ? "pos" : "neg";
    tip.innerHTML = `${new Date(d.t).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })} · A ${fmt(d.o)} · Max ${fmt(d.h)} · Min ${fmt(d.l)} · <b class="${cls}">C ${fmt(d.c)}</b>`;
  };
  hit.addEventListener("mousemove", move);
  hit.addEventListener("touchmove", ev => { ev.preventDefault(); move(ev); }, { passive: false });
  hit.addEventListener("touchstart", move);
}

function openTickerChart(ticker) {
  cmTicker = ticker; cmRange = sparkRange in CM_SPAN ? sparkRange : "m1";
  drawTickerChart();
}

/* ---------------- popup informativi (macro / trimestrali) ---------------- */
function relatedNews(rx, n = 6) {
  const list = (DATA.news || []).filter(x => rx.test(x.title_it || x.title)).slice(0, n);
  if (!list.length) return '<div class="muted">Nessuna notizia correlata recente.</div>';
  return '<ul class="news-list" style="columns:1">' + list.map(x =>
    `<li class="news-item"><a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title_it || x.title)}</a>
     <div class="news-meta"><span class="news-src">${esc(x.source)}</span><span class="news-time">${timeAgo(x.published)}</span></div></li>`).join("") + "</ul>";
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
  fedwatch: ["FedWatch", "Aspettative di mercato sui tassi Fed dai futures sui Fed Funds.", "Riunioni FOMC ~ogni 6 settimane", /fed|powell|tass|rate|fomc|interest/i],
  carry: ["Carry USA–Giappone", "Differenziale di rendimento USA-Giappone, motore del carry trade su USD/JPY.", "Continuo", /carry|yen|jpy|japan|giappone|boj/i],
  putcall: ["Put/Call ratio", "Rapporto opzioni put/call: alto = copertura/pessimismo.", "Mercato aperto USA", /option|put|call|hedge/i],
  sentiment: ["Sentiment globale", "Indicatore composito risk-on/risk-off.", "Aggiornato a ogni refresh", /sentiment|risk|rally|selloff|market/i],
  buffett: ["Buffett Indicator", "Capitalizzazione totale del mercato USA rapportata al PIL: sopra ~150% storicamente indica sopravvalutazione.", "Aggiornato a ogni refresh", /valuation|buffett|overvalu|gdp|market cap|bolla|bubble/i],
  thermometer: ["Termometro portafoglio", "Media della salute tecnica (RSI, trend, momentum) dei tuoi titoli.", "Aggiornato a ogni refresh", /(?!)/],
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
    extra = `<div class="info-line"><b>Spread USA−Giappone:</b> ${fmtNum.format(cy.spread)} punti (Treasury 10A ${fmtNum.format(cy.us10)}% − JGB 10A ${fmtNum.format(cy.jp10)}%)</div>
      <div class="info-line"><b>USD/JPY:</b> ${fmtNum.format(cy.usdjpy)} (${signTxt(cy.usdjpy_chg_1m)} nell'ultimo mese)</div>
      <div class="info-line" style="margin:8px 0">${cy.note || ""}</div>`;
    if ((cy.boj_meetings || []).length) {
      extra += `<h4 style="margin:10px 0 4px">Prossime riunioni Bank of Japan</h4>`
        + `<table class="info-table"><thead><tr><th>Data</th><th>Atteso</th></tr></thead><tbody>`
        + cy.boj_meetings.map(d => `<tr><td>${new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })}</td><td>tassi probabilmente fermi (sorvegliare svolte hawkish → rischio unwind carry)</td></tr>`).join("")
        + `</tbody></table>`;
    }
  } else {
    extra = `<div class="info-line"><b>Aggiornamento:</b> ${cadence}</div>`;
  }

  openInfoModal(name, `<p style="margin:0 0 10px">${desc}</p>${extra}
    <h4 style="margin:10px 0 4px">Notizie correlate</h4>${relatedNews(rx)}`);
}

function openEarningsInfo(ticker) {
  const r = (DATA.portfolio || []).find(x => x.ticker === ticker);
  if (!r) return;
  const days = r.earnings_date ? Math.ceil((new Date(r.earnings_date) - Date.now()) / 86400000) : null;
  const rx = new RegExp(`${ticker}|${(r.name || "").split(" ")[0]}|earnings|trimestral|utili|risultati`, "i");
  openInfoModal(`${r.name} (${ticker}) — Trimestrale`, `
    <div class="info-line"><b>Data attesa:</b> ${r.earnings_date ? new Date(r.earnings_date).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }) : "n/d"} ${days != null ? `(tra ${days} gg)` : ""}</div>
    ${r.eps != null ? `<div class="info-line"><b>EPS (ultimo):</b> ${fmtNum.format(r.eps)}</div>` : ""}
    ${r.rating?.target ? `<div class="info-line"><b>Target analisti:</b> ${cur(r)}${fmtNum.format(r.rating.target)} (${signTxt(r.rating.upside_pct)})</div>` : ""}
    <div class="info-line muted" style="margin-bottom:12px">Confronta i risultati con le attese degli analisti per valutare beat/miss.</div>
    <h4 style="margin:6px 0">Notizie correlate</h4>${relatedNews(rx)}`);
}

function delBtn(section, ticker) {
  if (!editMode[section]) return "";
  const mv = `<button class="row-move" data-sec="${section}" data-tk="${ticker}" data-dir="-1" title="Sposta su" aria-label="Sposta su">▲</button>
    <button class="row-move" data-sec="${section}" data-tk="${ticker}" data-dir="1" title="Sposta giù" aria-label="Sposta giù">▼</button>`;
  // solo in portafoglio: modifica quantità/PMC della posizione
  const ed = (section === "portfolio" && ticker !== "BTP-V28")
    ? `<button class="row-edit" data-tk="${ticker}" title="Modifica quantità/PMC di ${ticker}" aria-label="Modifica ${ticker}">✎</button>` : "";
  const del = ticker !== "BTP-V28"
    ? `<button class="row-del" data-sec="${section}" data-tk="${ticker}" title="Rimuovi ${ticker}">×</button>` : "";
  return mv + ed + del;
}

// modifica quantità e prezzo medio di carico di una posizione esistente
function editPosition(ticker) {
  const r = (DATA.portfolio || []).find(x => x.ticker === ticker);
  if (!r) return;
  const qty = parseFloat(window.prompt(`Nuova quantità di ${ticker}:`, r.qty) || "");
  if (!(qty >= 0)) { toast("Quantità non valida"); return; }
  const pmc = parseFloat(window.prompt(`Nuovo prezzo medio di carico (PMC) di ${ticker}:`, r.pmc) || "");
  if (!(pmc > 0)) { toast("PMC non valido"); return; }
  editHoldings("portfolio", cfg => {
    const p = (cfg.portfolio || []).find(x => x.ticker === ticker);
    if (!p) return false;
    p.qty = qty; p.pmc = pmc;
    return true;
  });
}


function renderTable() {
  const rows = sortRows(DATA.portfolio, "ptf-table").map(r => {
    const c = cur(r);
    return `<tr>
      <td class="name-cell">${delBtn("portfolio", r.ticker)}${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num"><b>${priceTxt(r, c)}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num">${prepostCell(r.prepost)}</td>
      <td class="num">${fmtVolume(r.volume)}</td>
      <td class="num ${signCls(r.gain)}">${signTxt(Math.round(r.gain), ` ${c}`)}${r.currency === "USD" ? `<br><span class="sub-eur">${signTxt(Math.round(r.gain / (DATA.eurusd || 1.08)), " €")}</span>` : ""}</td>
      <td class="num ${signCls(r.gain_pct)}"><b>${signTxt(r.gain_pct)}</b></td>
      ${techCells(r)}
    </tr>`;
  }).join("");

  const t = DATA.totals;
  const usdValue = DATA.portfolio.filter(r => r.currency === "USD").reduce((s, r) => s + r.value, 0);
  const totalRow = `<tr class="total-row">
    <td class="name-cell" colspan="7">TOTALE — ${fmtEUR.format(t.eur_value)} · azioni $${fmtNum.format(Math.round(usdValue))}</td>
    <td class="num ${signCls(t.eur_gain)}">${signTxt(Math.round(t.eur_gain), " €")}</td>
    <td class="num ${signCls(t.eur_gain_pct)}"><b>${signTxt(t.eur_gain_pct)}</b></td>
    <td colspan="12" class="muted" style="font-family:Inter,sans-serif">netto tasse stimato: <b class="${signCls(t.eur_gain_net)}">${signTxt(Math.round(t.eur_gain_net ?? t.eur_gain), " €")}</b></td>
  </tr>`;
  const addRow = editMode.portfolio
    ? `<tr class="add-row"><td colspan="21"><button class="btn btn-ghost btn-sm" id="ptf-add">+ Aggiungi titolo</button></td></tr>` : "";
  $("#ptf-table tbody").innerHTML = rows + totalRow + addRow;
}

function renderWatchlist() {
  const list = sortRows(DATA.watchlist || [], "wl-table");
  const c = (r) => r.currency === "PTS" ? "" : "$";
  const rows = list.length ? list.map(r => `<tr>
      <td class="name-cell">${delBtn("watchlist", r.ticker)}<button class="row-add" data-tk="${r.ticker}" data-price="${r.price}" title="Aggiungi ${r.ticker} al portafoglio">➕</button>${esc(r.name)}<span class="tk">${r.ticker}</span></td>
      <td class="num"><b>${priceTxt(r, c(r))}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num">${prepostCell(r.prepost)}</td>
      <td class="num">${fmtVolume(r.volume)}</td>
      ${techCells(r)}
    </tr>`).join("") : '<tr><td colspan="17" class="muted">Nessun dato</td></tr>';
  const addRow = editMode.watchlist
    ? `<tr class="add-row"><td colspan="17"><button class="btn btn-ghost btn-sm" id="wl-add">+ Aggiungi titolo</button></td></tr>` : "";
  $("#wl-table tbody").innerHTML = rows + addRow;
}

/* ---------------- vista fondamentale (Value Investing) ---------------- */
let ptfView = "tech";   // tech | fund
const pctOf = (v) => v == null ? "—" : signTxt(Math.round(v * 1000) / 10);   // frazione → %
const pctPlain = (v) => v == null ? "—" : (Math.round(v * 1000) / 10) + "%";
function bigUsd(v) { if (v == null) return "—"; const a = Math.abs(v);
  if (a >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(0) + "M"; return "$" + fmtNum.format(v); }
function colorCell(txt, cls) { return `<span class="${cls || ""}">${txt}</span>`; }

function renderFundTable() {
  if (!DATA || !DATA.portfolio) return;
  const head = ["Titolo", "Qtà", "PMC", "Prezzo", "Market Cap", "EV/EBITDA", "ROE", "Margine lordo",
                "Margine netto", "P/FCF", "Cresc. ricavi", "Div Yield", "P/B", "PEG"];
  $("#ptf-fund-table thead").innerHTML = "<tr>" +
    head.map((h, i) => `<th class="${i === 0 ? "sticky-col" : "num"}">${h}</th>`).join("") + "</tr>";
  const rows = DATA.portfolio.map(r => {
    const c = cur(r), st = r.stats || {};
    if (r.ticker === "BTP-V28") {
      return `<tr><td class="name-cell">${esc(r.name)}<span class="tk">${r.ticker}</span></td>
        <td class="num">${fmtNum.format(r.qty)}</td><td class="num">${c}${fmtNum.format(r.pmc)}</td>
        <td class="num"><b>${c}${fmtNum.format(r.price)}</b></td><td colspan="10" class="muted">Titolo di Stato — cedola 4,10/4,50%</td></tr>`;
    }
    const pfcf = (st.market_cap && st.fcf) ? st.market_cap / st.fcf : null;
    const fcfWarn = (st.fcf != null && st.net_income_fy != null && st.fcf < st.net_income_fy * 0.6)
      ? ` <span class="warn-flag" title="FCF molto inferiore all'utile: verifica la qualità degli utili">!</span>` : "";
    const roeCls = st.roe == null ? "" : st.roe >= 0.15 ? "text-premium" : st.roe < 0 ? "neg" : "";
    return `<tr>
      <td class="name-cell">${esc(r.name)}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num"><b>${c}${fmtNum.format(r.price)}</b></td>
      <td class="num">${bigUsd(st.market_cap)}</td>
      <td class="num">${st.ev_ebitda != null ? fmtNum.format(st.ev_ebitda) : "—"}</td>
      <td class="num">${colorCell(pctOf(st.roe), roeCls)}</td>
      <td class="num">${pctPlain(st.gross_margin)}</td>
      <td class="num ${st.profit_margin > 0 ? "pos" : st.profit_margin < 0 ? "neg" : ""}">${pctPlain(st.profit_margin)}</td>
      <td class="num">${pfcf != null ? (pfcf < 0 ? `<span class="neg">neg.</span>` : fmtNum.format(pfcf)) + fcfWarn : "—"}</td>
      <td class="num ${st.revenue_growth > 0 ? "pos" : st.revenue_growth < 0 ? "neg" : ""}">${pctOf(st.revenue_growth)}</td>
      <td class="num">${st.dividend_yield ? pctPlain(st.dividend_yield) : "—"}</td>
      <td class="num">${st.price_to_book != null ? fmtNum.format(st.price_to_book) : "—"}</td>
      <td class="num">${st.peg != null ? fmtNum.format(st.peg) : "—"}</td>
    </tr>`;
  }).join("");
  $("#ptf-fund-table tbody").innerHTML = rows;
}

function setPtfView(v) {
  ptfView = v;
  document.querySelectorAll("#view-toggle .chip").forEach(c => c.classList.toggle("chip-active", c.dataset.view === v));
  $("#ptf-tech-wrap").hidden = v !== "tech";
  $("#ptf-fund-wrap").hidden = v !== "fund";
  $("#spark-toggle").style.display = v === "tech" ? "" : "none";
  $("#range-lab-tech").style.display = v === "tech" ? "" : "none";
  if (v === "fund") renderFundTable();
}

/* ---------------- trimestrali ---------------- */
function renderEarnings() {
  const items = DATA.portfolio
    .filter(r => r.earnings_date)
    .map(r => ({ ...r, days: Math.ceil((new Date(r.earnings_date) - Date.now()) / 86400000) }))
    .sort((a, b) => a.days - b.days);
  $("#earnings-strip").innerHTML = items.length ? items.map(r => {
    const d = new Date(r.earnings_date).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
    const when = r.days <= 0 ? "oggi" : r.days === 1 ? "domani" : `tra ${r.days} gg`;
    // termometro: più vicina = barra più piena e più "calda"
    const pct = Math.max(6, Math.min(100, 100 - r.days * 1.1));
    const color = r.days <= 7 ? "var(--red)" : r.days <= 21 ? "var(--yellow)" : "var(--green)";
    return `<div class="earn-card" data-earn="${r.ticker}" tabindex="0" role="button" title="${esc(r.name)} — clicca per dettagli">
      <div class="earn-top"><span class="earn-tk">${r.ticker}</span><span class="earn-when">${when}</span></div>
      <div class="earn-date">${d}</div>
      <div class="impact"><span class="impact-fill" style="width:${pct}%;background:${color}"></span></div>
    </div>`;
  }).join("") : "";
}

/* ---------------- gauges ---------------- */
function gaugeSVG(pct, color) {
  // semicerchio 0–100
  const angle = Math.PI * (1 - pct / 100);
  const x = 60 + 48 * Math.cos(angle), y = 58 - 48 * Math.sin(angle);
  return `<svg viewBox="0 0 120 66">
    <path d="M 12 58 A 48 48 0 0 1 108 58" fill="none" stroke="var(--border)" stroke-width="9" stroke-linecap="round"/>
    <path d="M 12 58 A 48 48 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${color}"/>
  </svg>`;
}

function fgColor(score) {
  if (score <= 25) return "var(--red)";
  if (score <= 45) return "var(--yellow)";
  if (score <= 55) return "var(--muted)";
  if (score <= 75) return "var(--green)";
  return "var(--cyan)";
}

const FG_LABELS = { "extreme fear": "Paura estrema", fear: "Paura", neutral: "Neutrale", greed: "Avidità", "extreme greed": "Avidità estrema" };

/* colore sfumato verde(100)→arancio(50)→rosso(0) */
function scoreColor(s) {
  const h = Math.max(0, Math.min(120, (s / 100) * 120));   // 0=rosso, 60=giallo, 120=verde
  return `hsl(${h.toFixed(0)} 75% 47%)`;
}
// scala SEMPRE verde(sx)→rosso(dx). score 0-100 (100=positivo): il marker del "buono"
// sta a sinistra (verde), quello "cattivo" a destra (rosso). ends[0]=sinistra(verde).
function thermoBar(score, ends) {
  const s = Math.max(0, Math.min(100, score));
  const pos = 100 - s;
  return `<div class="thermo"><div class="thermo-scale"></div>
    <div class="thermo-marker" style="left:${pos}%"></div></div>
    ${ends ? `<div class="thermo-ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>` : ""}`;
}
/* card termometro uniforme; score 0-100 (100=positivo/verde, a sinistra). key per il popup */
function thermoCard(key, title, score, valueText, subText, ends) {
  return `<div class="gauge-card" data-gauge="${key}" tabindex="0" role="button" title="Clicca per dettagli e news">
    <div class="g-title">${title}</div>
    ${thermoBar(score, ends)}
    <div class="gauge-value" style="color:${scoreColor(score)}">${valueText}</div>
    <div class="gauge-sub">${subText}</div>
  </div>`;
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
    cards.push(thermoCard("fear_greed", "Fear &amp; Greed", fg.score, fg.score,
      `<b>${FG_LABELS[fg.rating] || fg.rating}</b><br>1 sett: ${fg.week_ago} · 1 mese: ${fg.month_ago}`, ["Avidità", "Paura"]));
  }
  if (m.vix) {
    const score = Math.max(0, Math.min(100, 100 - m.vix.value / 50 * 100));   // VIX basso = verde
    cards.push(thermoCard("vix", "VIX — Volatilità", score, fmtNum.format(m.vix.value),
      `${signTxt(m.vix.change_pct)} oggi<br>${m.vix.value < 17 ? "Mercato calmo" : m.vix.value < 25 ? "Tensione moderata" : "Alta volatilità"}`, ["Calmo", "Panico"]));
  }
  if (m.fedwatch) {
    const fw = m.fedwatch;
    const score = Math.max(0, Math.min(100, 50 - fw.delta_bp));   // tagli prezzati = verde
    const dir = fw.delta_bp <= -10 ? `tagli prezzati (~${Math.abs(fw.delta_bp)} bp)` :
                fw.delta_bp >= 10 ? `rialzi prezzati (~${fw.delta_bp} bp)` : "tassi fermi attesi";
    cards.push(thermoCard("fedwatch", "FedWatch (futures FF)", score, fw.target_range,
      `implicito <b>${fmtNum.format(fw.implied_rate)}%</b> · ${dir}`, ["Accomodante", "Restrittivo"]));
  }
  if (m.carry) {
    const cy = m.carry;
    const score = Math.max(0, Math.min(100, cy.spread / 5 * 100));
    cards.push(thermoCard("carry", "Carry USA–Giappone", score, `${fmtNum.format(cy.spread)} pp`,
      `US10A ${fmtNum.format(cy.us10)}% − JGB ${fmtNum.format(cy.jp10)}%<br>USD/JPY ${fmtNum.format(cy.usdjpy)} (${signTxt(cy.usdjpy_chg_1m)} 1m)`, ["Alto", "Basso"]));
  }
  if (m.putcall) {
    const pc = m.putcall;
    const score = Math.max(0, Math.min(100, 100 - pc.ratio / 2 * 100));   // più call = verde
    cards.push(thermoCard("putcall", `Put/Call ${pc.symbol}`, score, fmtNum.format(pc.ratio),
      `<b>${pc.ratio > 1 ? "Prevalgono PUT" : "Prevalgono CALL"}</b><br>put ${pc.puts.toLocaleString("it-IT")} · call ${pc.calls.toLocaleString("it-IT")}`, ["Call", "Put"]));
  }
  if (m.thermometer) {
    const th = m.thermometer;
    const lab = th.score >= 60 ? "Tranquillo" : th.score <= 40 ? "Da monitorare" : "Equilibrato";
    cards.push(thermoCard("thermometer", "Salute portafoglio", th.score, th.score,
      `<b>${lab}</b><br>salute tecnica media dei tuoi titoli`, ["Preoccupazione", "Serenità"]));
  }

  $("#gauges").innerHTML = cards.join("") || '<span class="muted">Dati non disponibili</span>';
}

/* ---------------- macro ---------------- */
const MACRO_ACCENTS = { cpi: "var(--red)", pce: "var(--yellow)", gdp: "var(--blue)", retail: "var(--purple)", nfp: "var(--green)", unemp: "var(--cyan)", pmi: "var(--blue)", "BTC-USD": "var(--yellow)", "CL=F": "var(--purple)", "^KS11": "var(--cyan)", "^IXIC": "var(--blue)" };

function impactBar(score, titleTxt) {
  if (score === null || score === undefined) return "";
  return `<div class="impact" title="${titleTxt || "impatto sul mercato"}: ${score}/100">
    <span class="impact-fill" style="width:${Math.max(4, score)}%;background:${scoreColor(score)}"></span>
  </div>`;
}

function marketImpact(m) {
  // variazione giornaliera → impatto 0-100 (rendimenti in pp: salita = restrittivo)
  if (m.change_pct === null || m.change_pct === undefined) return null;
  if (m.suffix === " pp") return Math.round(Math.max(0, Math.min(100, 50 - m.change_pct * 300)));
  return Math.round(Math.max(0, Math.min(100, 50 + m.change_pct * 12)));
}

function renderMacro() {
  const markets = (DATA.macro?.markets || []).map(m => `
    <div class="macro-item" data-macro="mk:${m.key}" tabindex="0" role="button" title="Clicca per dettagli e news" style="--accent:${MACRO_ACCENTS[m.key] || "var(--blue)"}">
      <div class="m-label">${m.label}</div>
      <div class="m-value">${m.value}</div>
      <div class="m-sub ${signCls(m.change_pct)}">${signTxt(m.change_pct, m.suffix || "%")} oggi</div>
      ${impactBar(marketImpact(m), "impatto della variazione odierna")}
    </div>`);
  const indicators = (DATA.macro?.indicators || []).map(i => `
    <div class="macro-item" data-macro="in:${i.key}" tabindex="0" role="button" title="Clicca per dettagli e news" style="--accent:${MACRO_ACCENTS[i.key] || "var(--purple)"}">
      <div class="m-label">${i.label}</div>
      <div class="m-value">${i.value}</div>
      <div class="m-date">${i.date}</div>
      ${impactBar(i.impact, "impatto sul mercato")}
    </div>`);
  const cells = markets.concat(indicators);
  $("#macro-grid").innerHTML = cells.length ? cells.join("") : '<span class="muted">Dati non disponibili</span>';
}

/* ---------------- top capitalizzazioni ---------------- */
function fmtMcap(v) {
  if (v >= 1e12) return "$" + fmtNum.format(Math.round(v / 1e10) / 100) + "T";
  return "$" + fmtNum.format(Math.round(v / 1e9)) + "B";
}

function renderTopCaps() {
  const list = DATA.top_caps || [];
  if (!list.length) { $("#topcaps").innerHTML = ""; return; }
  $("#topcaps").innerHTML = `<div class="m-label" style="margin:14px 0 8px">Top 10 capitalizzazioni mondiali</div>
    <ol class="topcap-list">` + list.map((x, i) => `
      <li class="topcap-item">
        <span class="topcap-rank">${i + 1}</span>
        <span class="topcap-name">${esc(x.name)} <span class="tk">${x.ticker}</span></span>
        <span class="topcap-mcap">${fmtMcap(x.mcap_usd)}</span>
        <span class="topcap-chg ${signCls(x.change_pct)}">${x.change_pct >= 0 ? "▲" : "▼"} ${signTxt(x.change_pct)}</span>
      </li>`).join("") + "</ol>";
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

function renderNews() {
  // solo notizie delle ultime 24 ore (oltre a quanto già filtrato dalla pipeline)
  const cutoff = Date.now() - 26 * 3600 * 1000;
  let list = (DATA.news || []).filter(n => !n.published || new Date(n.published).getTime() >= cutoff);
  if (!list.length) list = DATA.news || [];   // fallback: se tutte vecchie, mostra comunque
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
function buildPrompt() {
  const t = DATA.totals;
  const m = DATA.macro || {};
  const lines = [];
  lines.push("PRIMA di analizzare i dati come un team dei migliori 5 Senior Analyst al mondo, usa la RICERCA WEB per: (a) verificare i prezzi di oggi dei titoli elencati, (b) leggere le ultime notizie/risultati su questi titoli e sul quadro macro-politico, (c) trovare titoli alternativi NON in portafoglio interessanti per diversificare. I dati sotto sono il contesto completo della mia dashboard (portafoglio, watchlist, macro, news, mercati di previsione, rotazione settoriale).");
  lines.push("");
  lines.push("FORNISCI UN REPORT STRUTTURATO (solo a scopo informativo) con:");
  lines.push("1) Sintesi macro e sentiment di mercato (rischio rialzista/ribassista nel breve e nel lungo periodo).");
  lines.push("2) Analisi tecnica titolo per titolo: ipercomprato/ipervenduto (RSI), vicinanza a supporti/resistenze, volumi anomali, trend.");
  lines.push("3) INDICAZIONI OPERATIVE CONCRETE: per ogni titolo indica se mantenere/alleggerire/incrementare, con QUANTE azioni vendere/comprare e a CHE PREZZO (target/limite), stimando la plus/minusvalenza; suggerisci come COMPENSARE le minusvalenze con le plusvalenze (in Italia: azioni 26%, BTP 12,5%; le minus compensano le plus entro 4 anni).");
  lines.push("4) ROTAZIONE & DE-RISKING: il portafoglio è concentrato su TECH/semiconduttori — proponi come ridurre questa intensità usando la liquidità disponibile; indica 2-3 ticker alternativi specifici (value/difensivi) e 2-3 ETF, con prezzi limite d'ingresso, sfruttando la rotazione settoriale qui sotto.");
  lines.push("5) Ottica BREVE periodo (settimane), MEDIO periodo (mesi) e LUNGO periodo (anni), separate, con direzione e tempistiche.");
  lines.push("");
  lines.push(`DATI AL ${new Date(DATA.updated_at).toLocaleString("it-IT")}`);
  lines.push("");
  lines.push(`PORTAFOGLIO (totale ${fmtEUR.format(t.eur_value)}, guadagno lordo ${signTxt(Math.round(t.eur_gain), " €")} / ${signTxt(t.eur_gain_pct)}${t.eur_gain_net !== undefined ? `, netto tasse stimato ${signTxt(Math.round(t.eur_gain_net), " €")}` : ""}):`);
  const f = (v, d = 2) => v === null || v === undefined ? "—" : fmtNum.format(v);
  const mdRow = (r) => {
    const c = cur(r);
    return `| ${r.name} (${r.ticker}) | ${r.qty ? fmtNum.format(r.qty) : "—"} | ${r.qty ? c + f(r.pmc) : "—"} | ${c}${f(r.price)} | ${signTxt(r.change_pct)} | ${r.qty ? signTxt(r.gain_pct) : "—"} | ${r.rsi ?? "—"} | ${r.support ? c + f(r.support) : "—"} | ${r.resistance ? c + f(r.resistance) : "—"} | ${r.pe && r.pe > 0 ? f(r.pe) : "—"} | ${f(r.eps)} | ${f(r.beta)} | ${r.rating?.upside_pct != null ? signTxt(r.rating.upside_pct) : "—"} | ${r.earnings_date || "—"} | ${r.signal} |`;
  };
  const head = "| Titolo | Qtà | PMC | Prezzo | Oggi | Guad.% | RSI | Supp. | Resist. | P/E | EPS | Beta | Target Δ | Trimestrale | Segnale |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  lines.push(head); lines.push(sep);
  DATA.portfolio.forEach(r => lines.push(mdRow(r)));
  if ((DATA.watchlist || []).length) {
    lines.push("");
    lines.push("WATCHLIST (nessuna posizione):");
    lines.push(head); lines.push(sep);
    DATA.watchlist.forEach(r => lines.push(mdRow(r)));
  }
  lines.push("");
  lines.push("QUADRO MACRO:");
  if (m.risk_sentiment) lines.push(`- Sentiment globale: ${m.risk_sentiment.label} (${m.risk_sentiment.score}/100)`);
  if (m.thermometer) lines.push(`- Termometro tecnico del portafoglio: ${m.thermometer.label} (${m.thermometer.score}/100)`);
  if (m.fear_greed) lines.push(`- Fear & Greed: ${m.fear_greed.score} (${FG_LABELS[m.fear_greed.rating] || m.fear_greed.rating}), 1 settimana fa ${m.fear_greed.week_ago}, 1 mese fa ${m.fear_greed.month_ago}`);
  if (m.vix) lines.push(`- VIX: ${m.vix.value} (${signTxt(m.vix.change_pct)} oggi)`);
  if (m.fedwatch) lines.push(`- Fed: range ${m.fedwatch.target_range}, tasso implicito futures ${m.fedwatch.implied_rate}%`);
  if (m.carry) lines.push(`- Carry USA-Giappone: spread ${fmtNum.format(m.carry.spread)} pp (US10A ${m.carry.us10}%, JGB10A ${m.carry.jp10}%), USD/JPY ${m.carry.usdjpy} (${signTxt(m.carry.usdjpy_chg_1m)} 1 mese)`);
  if (m.putcall) lines.push(`- Put/Call ${m.putcall.symbol} (${m.putcall.name}): ${m.putcall.ratio} (put ${m.putcall.puts}, call ${m.putcall.calls})`);
  (m.markets || []).forEach(x => lines.push(`- ${x.label}: ${x.value} (${signTxt(x.change_pct, x.suffix || "%")} oggi)`));
  (m.indicators || []).forEach(i => lines.push(`- ${i.label}: ${i.value} (${i.date})`));
  if (m.macroquant) lines.push(`- MacroQuant (ciclo economico, stile BCA): ${m.macroquant.label} (${m.macroquant.score}/100)`);
  if (m.signposts) lines.push(`- BofA Bear-Market Signposts: ${m.signposts.active}/10 attivi (${m.signposts.pct}% rischio ribassista)`);
  if (m.fedwatch && (m.fedwatch.meetings || []).length) lines.push(`- FedWatch prossima riunione ${m.fedwatch.meetings[0].date}: prob. taglio ${m.fedwatch.meetings[0].cut_prob}%`);
  if ((m.tilt || []).length) {
    lines.push("");
    lines.push("ROTAZIONE SETTORIALE/TEMATICA USA (ETF, performance 1M e 3M):");
    [...m.tilt].sort((a, b) => b.m1 - a.m1).forEach(s =>
      lines.push(`- ${s.name} (${s.ticker}): 1M ${signTxt(s.m1)}, 3M ${signTxt(s.m3)}`));
  }
  if (m.witching) lines.push(`- Prossime "4 streghe" (quadruple witching): ${m.witching}`);
  // liquidità e capitale
  if (t.cash) lines.push(`- Liquidità disponibile: ${fmtEUR.format(t.cash)} · capitale investito: ${fmtEUR.format(t.eur_invested)}`);
  if ((DATA.top_caps || []).length) {
    lines.push("");
    lines.push("TOP 10 CAPITALIZZAZIONI MONDIALI:");
    DATA.top_caps.forEach((x, i) => lines.push(`${i + 1}. ${x.name} (${x.ticker}): ${fmtMcap(x.mcap_usd)} (${signTxt(x.change_pct)} oggi)`));
  }
  if ((DATA.predictions || []).length) {
    lines.push("");
    lines.push("MERCATI DI PREVISIONE (Polymarket, prob. Sì):");
    DATA.predictions.forEach(p => lines.push(`- ${p.question}: ${p.yes}%`));
  }
  lines.push("");
  lines.push("ULTIME NEWS (sentiment | titolo | fonte):");
  (DATA.news || []).slice(0, 18).forEach(n => {
    const s = n.sentiment === "bull" ? "🟢" : n.sentiment === "bear" ? "🔴" : "⚪";
    lines.push(`- ${s} [${n.tickers.join(",")}] ${n.title} (${n.source})`);
  });
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
    toast("Prompt copiato negli appunti ✓");
  } catch { /* clipboard non disponibile: l'utente può copiare dal box */ }
}

/* ---------------- eventi ---------------- */
$("#btn-refresh").addEventListener("click", refreshAll);
$("#btn-prompt").addEventListener("click", showPrompt);
$("#modal-close").addEventListener("click", () => { $("#modal").hidden = true; });
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").hidden = true; });
$("#btn-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#prompt-text").value);
  toast("Copiato ✓");
});
/* ---------------- calcolo vendite (plus/minusvalenze) ---------------- */
function sellRows() {
  const eur = DATA.eurusd || 1.08;
  return DATA.portfolio.map(r => {
    const toEur = r.currency === "EUR" ? 1 : 1 / eur;
    const plPerShare = (r.price - r.pmc) * toEur;   // utile/perdita per azione in €
    return { ...r, plPerShare, taxRate: r.ticker === "BTP-V28" ? 0.125 : 0.26 };
  });
}

function renderSellCalc() {
  const rows = sellRows();
  $("#sell-table tbody").innerHTML = rows.map(r => {
    const c = cur(r);
    const qty = r.ticker === "BTP-V28" ? r.qty : r.qty;
    return `<tr data-tk="${r.ticker}">
      <td class="name-cell">${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num">${c}${fmtNum.format(r.price)}</td>
      <td class="num"><input type="number" class="sell-in" data-tk="${r.ticker}" min="0" max="${r.qty}" step="any" placeholder="0" style="width:90px"></td>
      <td class="num sell-pl" data-tk="${r.ticker}">—</td>
    </tr>`;
  }).join("");
  document.querySelectorAll(".sell-in").forEach(i => i.addEventListener("input", computeSell));
  computeSell();
}

function computeSell() {
  const rows = sellRows();
  const byTk = Object.fromEntries(rows.map(r => [r.ticker, r]));
  let gains = 0, losses = 0, taxStock = 0, taxBtp = 0, stockNet = 0, btpNet = 0;
  document.querySelectorAll(".sell-in").forEach(inp => {
    const r = byTk[inp.dataset.tk];
    const q = Math.min(parseFloat(inp.value) || 0, r.qty);
    const pl = r.plPerShare * q;
    const cell = document.querySelector(`.sell-pl[data-tk="${inp.dataset.tk}"]`);
    cell.textContent = q ? signTxt(Math.round(pl), " €") : "—";
    cell.className = `num sell-pl ${signCls(pl)}`;
    if (q) { if (pl >= 0) gains += pl; else losses += pl; }
    if (r.ticker === "BTP-V28") btpNet += pl; else stockNet += pl;
  });
  // minusvalenze compensano le plusvalenze; tassa solo sul netto positivo
  taxStock = 0.26 * Math.max(0, stockNet);
  taxBtp = 0.125 * Math.max(0, btpNet);
  const net = gains + losses;          // losses è negativo
  const tax = taxStock + taxBtp;
  const afterTax = net - tax;
  // grafico a barre: plus (verde), minus (rosso), netto
  const maxAbs = Math.max(gains, Math.abs(losses), Math.abs(net), 1);
  const bar = (v, col) => `<div class="sb-row"><span class="sb-lab">${v < 0 ? "Minusvalenze" : v === net ? "Netto" : "Plusvalenze"}</span>
    <span class="sb-track"><span class="sb-fill" style="width:${Math.abs(v) / maxAbs * 100}%;background:${col}"></span></span>
    <span class="sb-val ${signCls(v)}">${signTxt(Math.round(v), " €")}</span></div>`;
  $("#sell-summary").innerHTML = `
    <div class="sell-bars">
      ${bar(gains, "var(--green)")}
      ${bar(losses, "var(--red)")}
      ${bar(net, net >= 0 ? "var(--blue)" : "var(--red)")}
    </div>
    <div class="sell-totals">
      <div><span class="muted">Plusvalenze</span> <b class="pos">${signTxt(Math.round(gains), " €")}</b></div>
      <div><span class="muted">Minusvalenze</span> <b class="neg">${signTxt(Math.round(losses), " €")}</b></div>
      <div><span class="muted">Risultato lordo</span> <b class="${signCls(net)}">${signTxt(Math.round(net), " €")}</b></div>
      <div><span class="muted">Tasse stimate (26% az. / 12,5% BTP, al netto delle minus)</span> <b class="neg">−${fmtEUR.format(Math.round(tax))}</b></div>
      <div><span class="muted">Incasso netto stimato</span> <b class="${signCls(afterTax)}">${signTxt(Math.round(afterTax), " €")}</b></div>
    </div>`;
}

/* ---------------- calcolatore PMC ---------------- */
function pmcCompute() {
  const v = (id) => parseFloat($(id).value) || 0;
  const q1 = v("#pmc-q1"), p1 = v("#pmc-p1"), q2 = v("#pmc-q2"), p2 = v("#pmc-p2");
  const qty = q1 + q2, cost = q1 * p1 + q2 * p2;
  if (qty <= 0 || cost <= 0) {
    ["#pmc-new", "#pmc-qty", "#pmc-cost", "#pmc-delta"].forEach(id => { $(id).textContent = "—"; });
    return;
  }
  const pmc = cost / qty;
  $("#pmc-new").textContent = fmtNum.format(Math.round(pmc * 10000) / 10000);
  $("#pmc-qty").textContent = fmtNum.format(qty);
  $("#pmc-cost").textContent = fmtNum.format(Math.round(cost * 100) / 100);
  const el = $("#pmc-delta");
  if (p1 > 0) {
    const d = (pmc / p1 - 1) * 100;
    el.textContent = signTxt(Math.round(d * 100) / 100);
    el.className = signCls(d);
  } else {
    el.textContent = "—"; el.className = "";
  }
}

function pmcInit() {
  const sel = $("#pmc-select");
  const current = sel.value;
  sel.innerHTML = '<option value="">— scegli un titolo o inserisci a mano —</option>' +
    (DATA.portfolio || []).filter(r => r.currency === "USD").map(r =>
      `<option value="${r.ticker}">${esc(r.name)} (${r.ticker})</option>`).join("");
  sel.value = current;   // non perdere la selezione sull'auto-refresh
}

$("#pmc-select").addEventListener("change", () => {
  const r = (DATA?.portfolio || []).find(x => x.ticker === $("#pmc-select").value);
  if (r) {
    $("#pmc-q1").value = r.qty;
    $("#pmc-p1").value = r.pmc;
    $("#pmc-p2").value = r.price;
    $("#pmc-q2").focus();
  }
  pmcCompute();
});
["#pmc-q1", "#pmc-p1", "#pmc-q2", "#pmc-p2"].forEach(id =>
  $(id).addEventListener("input", pmcCompute));

/* liquidità + mini-card */
$("#cash-save").addEventListener("click", saveCash);
$("#cash-input").addEventListener("keydown", e => { if (e.key === "Enter") saveCash(); });
$("#signposts-box").addEventListener("click", openSignpostsModal);
$("#tilt-box").addEventListener("click", openTiltModal);
$("#rotation-analyze").addEventListener("click", openRotationModal);
$("#witching-box").addEventListener("click", openWitchingModal);
$("#macroquant-box").addEventListener("click", openMacroQuantModal);
$("#market-direction").addEventListener("click", () => {
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
  const sc = e.target.closest(".stat-cell");           // click su una metrica → spiegazione
  if (sc) { toast(sc.dataset.info); }
});

// due barre range (sopra portafoglio e sopra watchlist) sincronizzate
function syncSparkToggles() {
  document.querySelectorAll("#spark-toggle .chip, #spark-toggle-wl .chip").forEach(c =>
    c.classList.toggle("chip-active", c.dataset.range === sparkRange));
}
document.querySelectorAll("#spark-toggle .chip, #spark-toggle-wl .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    sparkRange = ch.dataset.range;
    syncSparkToggles();
    renderTable();
    renderWatchlist();
  });
});
$("#wl-add-top").addEventListener("click", addWatchlist);
document.querySelectorAll("#view-toggle .chip").forEach(ch =>
  ch.addEventListener("click", () => setPtfView(ch.dataset.view)));
document.querySelectorAll("#hist-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#hist-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    histRange = ch.dataset.range;
    renderHistory();
  });
});
$("#bench-select").addEventListener("change", (e) => { histBenchKey = e.target.value; renderHistory(); });
document.querySelectorAll("#alloc-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#alloc-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    allocMode = ch.dataset.mode;
    renderAllocation();
  });
});

/* zoom grafici */
$("#hist-zoom").addEventListener("click", () => {
  const h = DATA.history && DATA.history[histRange];
  if (h) openChartModal(`Andamento portafoglio — ${histRange.toUpperCase()}`, h.values, h.dates, v => fmtEUR.format(Math.round(v)));
});
$("#chart-modal-close").addEventListener("click", closeChartModal);
$("#chart-modal").addEventListener("click", e => {
  if (e.target.id === "chart-modal") { closeChartModal(); return; }
  const rb = e.target.closest(".cm-range");
  if (rb) { cmRange = rb.dataset.range; drawTickerChart(); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeChartModal(); });
document.addEventListener("click", (e) => {
  const cell = e.target.closest(".spark-cell");
  if (cell) { openTickerChart(cell.dataset.tk); return; }
  const macro = e.target.closest("[data-macro]");
  if (macro) { openMacroInfo(macro.dataset.macro); return; }
  const gauge = e.target.closest("[data-gauge]");
  if (gauge) { openMacroInfo(gauge.dataset.gauge); return; }
  const earn = e.target.closest("[data-earn]");
  if (earn) { openEarningsInfo(earn.dataset.earn); return; }
});

/* modifica posizioni */
$("#ptf-edit").addEventListener("click", () => {
  editMode.portfolio = !editMode.portfolio;
  $("#ptf-edit").classList.toggle("chip-active", editMode.portfolio);
  renderTable();
});
$("#wl-edit").addEventListener("click", () => {
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
// ricarica completa (tecnici, news, storico) ogni 5 minuti
setInterval(() => loadData(), 5 * 60 * 1000);
// prezzi live ogni 60 secondi
setInterval(() => livePrices(), 60 * 1000);
