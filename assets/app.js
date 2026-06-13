/* Trading Dashboard — rendering lato client di data/data.json */
const REPO = "Oigres85/Trading";
let DATA = null;
let sparkRange = "m1";   // 1G | 1M | 1A

/* ordinamento tabelle: click su intestazione → desc → asc → default */
const SORT_FIELDS = {
  "ptf-table": ["name", "qty", "pmc", "change_pct", "change_pct", "prepost_chg", "volume",
                "value", "gain", "gain_pct", "pe", "eps", "beta", "ath_dist_pct", "support",
                "resistance", "rsi", "vol_ratio", "health", "upside_pct", "upside_pct", null],
  "wl-table": ["name", "change_pct", "change_pct", "prepost_chg", "volume", "pe", "eps",
               "beta", "ath_dist_pct", "support", "resistance", "rsi", "vol_ratio",
               "health", "upside_pct", "upside_pct", null],
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
    DATA = await res.json();
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
    const cfg = JSON.parse(decodeURIComponent(escape(atob(file.content))));
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
    // 3) rigenera i dati
    await dispatchWorkflow(token);
    toast("Posizione aggiornata — rigenero i dati (~2-3 min)…");
    if (await waitForNewData(DATA?.updated_at)) toast("Fatto ✓");
    else toast("Modifica salvata, i dati si aggiornano a breve");
  } catch (e) {
    console.error(e);
    toast("Errore durante la modifica");
  }
}

function addPortfolio() {
  const ticker = (window.prompt("Ticker da aggiungere al portafoglio (es. AAPL):") || "").trim().toUpperCase();
  if (!ticker) return;
  const qty = parseFloat(window.prompt(`Quantità di ${ticker}:`) || "");
  const pmc = parseFloat(window.prompt(`Prezzo medio di carico (PMC) di ${ticker} in USD:`) || "");
  if (!(qty > 0) || !(pmc > 0)) { toast("Quantità/PMC non validi"); return; }
  editHoldings("portfolio", cfg => {
    cfg.portfolio = cfg.portfolio || [];
    if (cfg.portfolio.some(p => p.ticker === ticker)) { toast(`${ticker} è già in portafoglio`); return false; }
    cfg.portfolio.push({ ticker, name: ticker, qty, pmc });
    return true;
  });
}

function addWatchlist() {
  const ticker = (window.prompt("Ticker da aggiungere alla watchlist (es. AAPL, ^GSPC, BTC-USD):") || "").trim().toUpperCase();
  if (!ticker) return;
  editHoldings("watchlist", cfg => {
    cfg.watchlist = cfg.watchlist || [];
    if (cfg.watchlist.some(p => p.ticker === ticker)) { toast(`${ticker} è già in watchlist`); return false; }
    cfg.watchlist.push({ ticker, name: null, currency: ticker.startsWith("^") ? "PTS" : "USD" });
    return true;
  });
}

function removeHolding(section, ticker) {
  if (!window.confirm(`Rimuovere ${ticker} da ${section === "portfolio" ? "portafoglio" : "watchlist"}?`)) return;
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

function recomputeTotals() {
  const eq = DATA.portfolio.filter(r => r.currency === "USD");
  const btp = DATA.portfolio.find(r => r.ticker === "BTP-V28");
  const usdValue = eq.reduce((s, r) => s + r.value, 0);
  const usdCost = eq.reduce((s, r) => s + r.pmc * r.qty, 0);
  const eurusd = DATA.eurusd || 1.08;
  const btpVal = btp ? btp.value : 0, btpGain = btp ? btp.gain : 0;
  const totalEur = usdValue / eurusd + btpVal;
  const costEur = usdCost / eurusd + (btp ? btp.pmc * btp.qty / 100 : 0);
  const eurGain = totalEur - costEur;
  const tax = 0.26 * Math.max(0, (usdValue - usdCost) / eurusd) + 0.125 * Math.max(0, btpGain);
  Object.assign(DATA.totals, {
    usd_value: usdValue, usd_gain: usdValue - usdCost, usd_gain_pct: (usdValue / usdCost - 1) * 100,
    eur_value: totalEur, eur_gain: eurGain, eur_gain_pct: (totalEur / costEur - 1) * 100,
    tax_est: tax, eur_gain_net: eurGain - tax,
  });
  DATA.allocation = DATA.portfolio.map(r => ({
    ticker: r.ticker, name: r.name, sector: r.sector || "Altro",
    value_eur: r.currency === "EUR" ? r.value : r.value / eurusd,
  })).sort((a, b) => b.value_eur - a.value_eur);
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
  if (el) el.innerHTML = `<span class="live-dot"></span> prezzi live · ${new Date().toLocaleTimeString("it-IT")}`;
}

function renderAll() {
  const d = new Date(DATA.updated_at);
  $("#updated-at").textContent = d.toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
  renderKPI();
  renderHistory();
  renderAllocation();
  renderEarnings();
  renderTable();
  renderWatchlist();
  renderGauges();
  renderMacro();
  renderTopCaps();
  renderNews();
  renderBroker();
  renderSellCalc();
  pmcInit();
}

/* ---------------- KPI ---------------- */
function renderKPI() {
  const t = DATA.totals;
  const net = t.eur_gain_net ?? t.eur_gain;
  const kpis = [
    { label: "Guadagno totale lordo (€)", value: signTxt(Math.round(t.eur_gain), " €"),
      sub: `${signTxt(t.eur_gain_pct)} dal carico — valore ${fmtEUR.format(t.eur_value)}`,
      subCls: signCls(t.eur_gain), accent: "var(--blue)", valueCls: signCls(t.eur_gain) },
    { label: "Guadagno netto tasse (€)", value: signTxt(Math.round(net), " €"),
      sub: t.tax_est ? `tasse stimate −${fmtEUR.format(Math.round(t.tax_est))} (26% azioni, 12,5% BTP)` : "",
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
let histRange = "y1";   // w1 | m1 | m3 | y1 | y5 | all
let histBench = false;  // sovrapponi Nasdaq

function renderHistory() {
  const h = DATA.history && DATA.history[histRange];
  const box = $("#hist-chart");
  if (!h || h.values.length < 2) { box.innerHTML = '<div class="muted" style="padding:40px 0;text-align:center">Storico non disponibile</div>'; $("#hist-summary").textContent = ""; return; }
  const vals = h.values, dates = h.dates;
  const bench = histBench && h.nasdaq && h.nasdaq.length === vals.length ? h.nasdaq : null;
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
  </svg>${bench ? '<div class="bench-leg"><span class="leg-dash"></span> Nasdaq (riscalato)</div>' : ""}`;
  const first = vals[0], last = vals[vals.length - 1], chg = (last / first - 1) * 100;
  let benchTxt = "";
  if (bench) { const bchg = (bench[bench.length - 1] / bench[0] - 1) * 100; benchTxt = ` · Nasdaq ${signTxt(Math.round(bchg * 10) / 10)} (${chg >= bchg ? "sovra" : "sotto"}performance ${signTxt(Math.round((chg - bchg) * 10) / 10)})`; }
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

/* ---------------- rendimenti reali (broker) ---------------- */
function renderBroker() {
  const b = DATA.broker;
  const box = $("#broker-row");
  if (!box) return;
  if (!b) { box.innerHTML = ""; return; }
  const cell = (lab, val, cls = "") => `<div class="bk-cell"><div class="bk-lab">${lab}</div><div class="bk-val ${cls}">${val}</div></div>`;
  box.innerHTML = `<div class="bk-title">📒 Rendimenti reali (broker, ${new Date(b.as_of).toLocaleDateString("it-IT")})</div>
    <div class="bk-grid">
      ${cell("Controvalore", fmtEUR.format(b.controvalore_totale))}
      ${cell("Profitto totale", `${signTxt(b.profitto_totale_pct)} · ${signTxt(Math.round(b.profitto_totale_eur), " €")}`, "pos")}
      ${cell("YTD", signTxt(b.ytd_pct), "pos")}
      ${cell("12 mesi", signTxt(b.y1_pct), "pos")}
      ${cell("Dall'inizio", signTxt(b.inception_pct), "pos")}
      ${cell("Profitto $ (azioni)", `${signTxt(b.profitto_usd_pct)} · ${signTxt(Math.round(b.profitto_usd), " $")}`, "pos")}
      ${cell("Cedole BTP incassate", fmtEUR.format(b.cedole_btp))}
    </div>`;
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
    return `<path d="${d}" fill="${ALLOC_COLORS[i % ALLOC_COLORS.length]}"><title>${esc(x.name)}: ${fmtEUR.format(x.value_eur)} (${(frac * 100).toFixed(1)}%)</title></path>`;
  }).join("");
  $("#alloc-donut").innerHTML = `<svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Ripartizione del portafoglio">
    ${arcs}
    <text x="80" y="76" text-anchor="middle" font-size="11" fill="var(--muted)">Totale</text>
    <text x="80" y="92" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)">${fmtEUR.format(Math.round(total))}</text>
  </svg>`;
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
  // verde nella zona neutrale, giallo verso 30/70, rosso agli estremi
  const dist = Math.abs(rsi - 50);
  const color = dist <= 10 ? "var(--green)" : dist <= 20 ? "var(--yellow)" : "var(--red)";
  return meterBar(rsi, color, fmtNum.format(rsi));
}

function volBar(ratio) {
  if (!ratio) return "—";
  // volume vs media 30gg: verde = normale, rosso = anomalo
  const color = ratio < 1.2 ? "var(--green)" : ratio < 2 ? "var(--yellow)" : "var(--red)";
  return meterBar((ratio / 3) * 100, color, `${fmtNum.format(ratio)}×`);
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
  const u = r.upside_pct;
  const color = u >= 15 ? "var(--green)" : u >= 0 ? "var(--yellow)" : "var(--red)";
  return meterBar(Math.abs(u) * 2, color, signTxt(u));
}

function peBar(pe) {
  if (!pe || pe <= 0) return "—";
  const color = pe <= 18 ? "var(--green)" : pe <= 35 ? "var(--yellow)" : "var(--red)";
  return meterBar(Math.min(pe, 60) / 60 * 100, color, fmtNum.format(pe));
}

function epsBar(eps) {
  if (eps === null || eps === undefined) return "—";
  const color = eps > 0 ? "var(--green)" : "var(--red)";
  return meterBar(Math.min(Math.abs(eps), 15) / 15 * 100, color, fmtNum.format(eps));
}

function betaBar(beta) {
  if (beta === null || beta === undefined) return "—";
  const color = beta <= 1 ? "var(--green)" : beta <= 1.6 ? "var(--yellow)" : "var(--red)";
  return meterBar(Math.min(beta, 3) / 3 * 100, color, fmtNum.format(beta));
}

function athBar(r) {
  if (!r.ath) return "—";
  const closeness = Math.max(0, 100 + r.ath_dist_pct);   // 100 = sul massimo storico
  const color = closeness >= 90 ? "var(--green)" : closeness >= 70 ? "var(--yellow)" : "var(--red)";
  return `<div class="meter" title="Max storico ${fmtNum.format(r.ath)}">
    <span class="meter-txt">${signTxt(r.ath_dist_pct)}</span>
    <span class="meter-track"><span class="meter-fill" style="width:${Math.max(3, closeness)}%;background:${color}"></span></span>
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
      <td class="num">${athBar(r)}</td>
      <td class="num">${support ? c + fmtNum.format(support) : "—"}</td>
      <td class="num">${resistance ? c + fmtNum.format(resistance) : "—"}</td>
      <td class="num">${rsiBar(r.rsi)}</td>
      <td class="num">${volBar(r.vol_ratio)}</td>
      <td><span class="badge ${r.signal_class}">${r.signal}</span></td>
      <td>${ratingBadge(r.rating)}</td>
      <td class="num">${targetBar(r.rating)}</td>
      <td class="spark-cell" data-tk="${r.ticker}" title="Clicca per ingrandire">${sparkline((r.sparks || {})[sparkRange])}</td>`;
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
const CM_RANGES = [["d1", "1G"], ["w1", "1S"], ["m1", "1M"], ["m3", "3M"], ["y1", "1A"]];
const CM_SPAN = { d1: 1, w1: 7, m1: 31, m3: 92, y1: 365 };   // giorni coperti (per le date)

function synthDates(range, n) {
  const span = CM_SPAN[range] || 30, today = Date.now(), out = [];
  for (let i = 0; i < n; i++) out.push(new Date(today - (n - 1 - i) * (span / (n - 1 || 1)) * 86400000).toISOString().slice(0, 10));
  return out;
}

function drawTickerChart() {
  const all = [...(DATA.portfolio || []), ...(DATA.watchlist || [])];
  const r = all.find(x => x.ticker === cmTicker);
  if (!r) return;
  const vals = (r.sparks || {})[cmRange];
  const sym = r.currency === "PTS" ? "" : r.currency === "EUR" ? "€" : "$";
  const controls = `<div class="spark-toggle cm-ranges">` +
    CM_RANGES.map(([k, lab]) => `<button class="chip cm-range ${k === cmRange ? "chip-active" : ""}" data-range="${k}">${lab}</button>`).join("") + `</div>`;
  openChartModal(`${r.name} (${r.ticker})`, vals, synthDates(cmRange, (vals || []).length),
    v => sym + fmtNum.format(v), controls);
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
  thermometer: ["Termometro portafoglio", "Media della salute tecnica (RSI, trend, momentum) dei tuoi titoli.", "Aggiornato a ogni refresh", /(?!)/],
};

function openInfoModal(title, bodyHTML) {
  $("#chart-modal-title").textContent = title;
  $("#chart-modal-body").innerHTML = bodyHTML;
  $("#chart-modal-tip").innerHTML = "";
  $("#chart-modal").hidden = false;
}

function openMacroInfo(key) {
  const info = MACRO_INFO[key];
  if (!info) return;
  const [name, desc, cadence, rx] = info;
  openInfoModal(name, `<p style="margin:0 0 10px">${desc}</p>
    <div class="info-line">📅 <b>Prossima pubblicazione:</b> ${cadence}</div>
    <div class="info-line muted" style="margin-bottom:12px">Le date esatte possono variare; consulta un calendario economico per la conferma.</div>
    <h4 style="margin:6px 0">Notizie correlate</h4>${relatedNews(rx)}`);
}

function openEarningsInfo(ticker) {
  const r = (DATA.portfolio || []).find(x => x.ticker === ticker);
  if (!r) return;
  const days = r.earnings_date ? Math.ceil((new Date(r.earnings_date) - Date.now()) / 86400000) : null;
  const rx = new RegExp(`${ticker}|${(r.name || "").split(" ")[0]}|earnings|trimestral|utili|risultati`, "i");
  openInfoModal(`${r.name} (${ticker}) — Trimestrale`, `
    <div class="info-line">📅 <b>Data attesa:</b> ${r.earnings_date ? new Date(r.earnings_date).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }) : "n/d"} ${days != null ? `(tra ${days} gg)` : ""}</div>
    ${r.eps != null ? `<div class="info-line"><b>EPS (ultimo):</b> ${fmtNum.format(r.eps)}</div>` : ""}
    ${r.rating?.target ? `<div class="info-line"><b>Target analisti:</b> ${cur(r)}${fmtNum.format(r.rating.target)} (${signTxt(r.rating.upside_pct)})</div>` : ""}
    <div class="info-line muted" style="margin-bottom:12px">Confronta i risultati con le attese degli analisti per valutare beat/miss.</div>
    <h4 style="margin:6px 0">Notizie correlate</h4>${relatedNews(rx)}`);
}

function delBtn(section, ticker) {
  return editMode[section] && ticker !== "BTP-V28"
    ? `<button class="row-del" data-sec="${section}" data-tk="${ticker}" title="Rimuovi ${ticker}">×</button>` : "";
}


function renderTable() {
  const rows = sortRows(DATA.portfolio, "ptf-table").map(r => {
    const c = cur(r);
    return `<tr>
      <td class="name-cell">${delBtn("portfolio", r.ticker)}${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num"><b>${c}${fmtNum.format(r.price)}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num">${prepostCell(r.prepost)}</td>
      <td class="num">${fmtVolume(r.volume)}</td>
      <td class="num"><b>${c}${fmtNum.format(Math.round(r.value))}</b></td>
      <td class="num ${signCls(r.gain)}">${signTxt(Math.round(r.gain), ` ${c}`)}</td>
      <td class="num ${signCls(r.gain_pct)}"><b>${signTxt(r.gain_pct)}</b></td>
      ${techCells(r)}
    </tr>`;
  }).join("");

  const t = DATA.totals;
  const usdValue = DATA.portfolio.filter(r => r.currency === "USD").reduce((s, r) => s + r.value, 0);
  const totalRow = `<tr class="total-row">
    <td class="name-cell" colspan="7">TOTALE — ${fmtEUR.format(t.eur_value)} · azioni $${fmtNum.format(Math.round(usdValue))}</td>
    <td class="num">${fmtEUR.format(t.eur_value)}</td>
    <td class="num ${signCls(t.eur_gain)}">${signTxt(Math.round(t.eur_gain), " €")}</td>
    <td class="num ${signCls(t.eur_gain_pct)}"><b>${signTxt(t.eur_gain_pct)}</b></td>
    <td colspan="12" class="muted" style="font-family:Inter,sans-serif">netto tasse stimato: <b class="${signCls(t.eur_gain_net)}">${signTxt(Math.round(t.eur_gain_net ?? t.eur_gain), " €")}</b></td>
  </tr>`;
  const addRow = editMode.portfolio
    ? `<tr class="add-row"><td colspan="22"><button class="btn btn-ghost btn-sm" id="ptf-add">+ Aggiungi titolo</button></td></tr>` : "";
  $("#ptf-table tbody").innerHTML = rows + totalRow + addRow;
}

function renderWatchlist() {
  const list = sortRows(DATA.watchlist || [], "wl-table");
  const c = (r) => r.currency === "PTS" ? "" : "$";
  const rows = list.length ? list.map(r => `<tr>
      <td class="name-cell">${delBtn("watchlist", r.ticker)}<button class="row-add" data-tk="${r.ticker}" data-price="${r.price}" title="Aggiungi ${r.ticker} al portafoglio">➕</button>${esc(r.name)}<span class="tk">${r.ticker}</span></td>
      <td class="num"><b>${c(r)}${fmtNum.format(r.price)}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num">${prepostCell(r.prepost)}</td>
      <td class="num">${fmtVolume(r.volume)}</td>
      ${techCells(r)}
    </tr>`).join("") : '<tr><td colspan="17" class="muted">Nessun dato</td></tr>';
  const addRow = editMode.watchlist
    ? `<tr class="add-row"><td colspan="17"><button class="btn btn-ghost btn-sm" id="wl-add">+ Aggiungi titolo</button></td></tr>` : "";
  $("#wl-table tbody").innerHTML = rows + addRow;
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
function thermoBar(score, ends) {
  const s = Math.max(0, Math.min(100, score));
  return `<div class="thermo"><div class="thermo-scale"></div>
    <div class="thermo-marker" style="left:${s}%"></div></div>
    ${ends ? `<div class="thermo-ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>` : ""}`;
}
/* card termometro uniforme; score 0-100 (100=positivo/verde). key per il popup */
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
      `<b>${rs.label}</b><br>composito F&amp;G · VIX · P/C · BTC · 10A`, ["Risk-off", "Risk-on"]));
  }
  if (m.fear_greed) {
    const fg = m.fear_greed;
    cards.push(thermoCard("fear_greed", "Fear &amp; Greed", fg.score, fg.score,
      `<b>${FG_LABELS[fg.rating] || fg.rating}</b><br>1 sett: ${fg.week_ago} · 1 mese: ${fg.month_ago}`, ["Paura", "Avidità"]));
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
      `implicito <b>${fmtNum.format(fw.implied_rate)}%</b> · ${dir}`, ["Restrittivo", "Accomodante"]));
  }
  if (m.carry) {
    const cy = m.carry;
    const score = Math.max(0, Math.min(100, cy.spread / 5 * 100));
    cards.push(thermoCard("carry", "Carry USA–Giappone", score, `${fmtNum.format(cy.spread)} pp`,
      `US10A ${fmtNum.format(cy.us10)}% − JGB ${fmtNum.format(cy.jp10)}%<br>USD/JPY ${fmtNum.format(cy.usdjpy)} (${signTxt(cy.usdjpy_chg_1m)} 1m)`, ["Basso", "Alto"]));
  }
  if (m.putcall) {
    const pc = m.putcall;
    const score = Math.max(0, Math.min(100, 100 - pc.ratio / 2 * 100));   // più call = verde
    cards.push(thermoCard("putcall", `Put/Call ${pc.symbol}`, score, fmtNum.format(pc.ratio),
      `<b>${pc.ratio > 1 ? "Prevalgono PUT" : "Prevalgono CALL"}</b><br>put ${pc.puts.toLocaleString("it-IT")} · call ${pc.calls.toLocaleString("it-IT")}`, ["Call", "Put"]));
  }
  if (m.thermometer) {
    const th = m.thermometer;
    cards.push(thermoCard("thermometer", "Termometro portafoglio", th.score, th.score,
      `<b>${th.label}</b><br>media RSI + trend + momentum`, ["Debole", "Forte"]));
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

let newsFilter = null;   // ticker/argomento selezionato dai chip Trending

function renderTrending() {
  const list = DATA.news || [];
  const counts = {};
  list.forEach(n => (n.tickers || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  const top = Object.entries(counts).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const label = t => t === "MACRO" ? "Macro" : t;
  const chips = top.map(([t, c]) =>
    `<button class="trend-chip ${newsFilter === t ? "active" : ""}" data-topic="${t}">${label(t)} <span>${c}</span></button>`).join("");
  $("#news-trending").innerHTML = top.length
    ? `<span class="trend-label">Trending:</span>${chips}${newsFilter ? '<button class="trend-chip clear" data-topic="">✕</button>' : ""}` : "";
}

function renderNews() {
  renderTrending();
  let list = DATA.news || [];
  if (newsFilter) list = list.filter(n => (n.tickers || []).includes(newsFilter));
  $("#news-list").innerHTML = list.length ? list.map(n => `
    <li class="news-item">
      <a href="${esc(n.link)}" target="_blank" rel="noopener" title="${esc(n.title)}">${esc(n.title_it || n.title)}</a>
      <div class="news-meta">
        <span class="news-src ${n.source === "Polymarket" ? "src-poly" : ""}">${esc(n.source)}</span>
        <span class="news-time">${timeAgo(n.published)}</span>
        ${n.tickers.map(t => `<span class="news-tk">${t === "MACRO" ? "Macro" : t}</span>`).join("")}
      </div>
    </li>`).join("") : '<li class="muted">Nessuna news per il filtro selezionato</li>';
}


/* ---------------- prompt AI ---------------- */
function buildPrompt() {
  const t = DATA.totals;
  const m = DATA.macro || {};
  const lines = [];
  lines.push("Sei un analista finanziario esperto. PRIMA di analizzare, usa la RICERCA WEB per verificare i prezzi di oggi dei titoli elencati e le ultime notizie macro/societarie (i dati qui sotto potrebbero avere qualche minuto di ritardo). Poi analizza il mio portafoglio e fornisci: 1) valutazione sintetica della situazione, 2) titoli a rischio o con segnali tecnici rilevanti (RSI, supporti/resistenze), 3) impatto del quadro macro e dei mercati di previsione, 4) eventuali azioni da considerare (non è una richiesta di consulenza, voglio un'analisi ragionata).");
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

document.querySelectorAll("#spark-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#spark-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    sparkRange = ch.dataset.range;
    renderTable();
    renderWatchlist();
  });
});
document.querySelectorAll("#hist-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#hist-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    histRange = ch.dataset.range;
    renderHistory();
  });
});
$("#bench-nasdaq").addEventListener("change", (e) => { histBench = e.target.checked; renderHistory(); });
document.querySelectorAll("#alloc-toggle .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#alloc-toggle .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    allocMode = ch.dataset.mode;
    renderAllocation();
  });
});
$("#news-trending").addEventListener("click", (e) => {
  const chip = e.target.closest(".trend-chip");
  if (!chip) return;
  newsFilter = chip.dataset.topic || null;
  renderNews();
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
  const add = e.target.closest(".row-add");
  if (add) { quickAddFromWatchlist(add.dataset.tk, parseFloat(add.dataset.price)); return; }
  if (e.target.id === "ptf-add") addPortfolio();
  if (e.target.id === "wl-add") addWatchlist();
});

/* dalla watchlist al calcolatore PMC / aggiungi al portafoglio */
function quickAddFromWatchlist(ticker, price) {
  const pmc = $("#pmc-calc");
  pmc.scrollIntoView({ behavior: "smooth" });
  $("#pmc-q1").value = "";
  $("#pmc-p1").value = price || "";
  $("#pmc-p2").value = price || "";
  $("#pmc-q2").value = "";
  pmcCompute();
  toast(`${ticker} caricato nel calcolatore PMC — inserisci la quantità`);
  if (confirm(`Vuoi aggiungere ${ticker} direttamente al portafoglio?`)) {
    const qty = parseFloat(window.prompt(`Quantità di ${ticker}:`) || "");
    const p = parseFloat(window.prompt(`Prezzo medio di carico (PMC) di ${ticker} in USD:`, price || "") || "");
    if (qty > 0 && p > 0) {
      editHoldings("portfolio", cfg => {
        cfg.portfolio = cfg.portfolio || [];
        if (cfg.portfolio.some(x => x.ticker === ticker)) { toast(`${ticker} è già in portafoglio`); return false; }
        cfg.portfolio.push({ ticker, name: ticker, qty, pmc: p });
        return true;
      });
    }
  }
}

initSorting("ptf-table", renderTable);
initSorting("wl-table", renderWatchlist);

loadData();
// ricarica completa (tecnici, news, storico) ogni 5 minuti
setInterval(() => loadData(), 5 * 60 * 1000);
// prezzi live ogni 60 secondi
setInterval(() => livePrices(), 60 * 1000);
