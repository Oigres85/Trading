/* Trading Dashboard — rendering lato client di data/data.json */
let DATA = null;
let newsFilter = "all";

const $ = (sel) => document.querySelector(sel);
const fmtEUR = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtUSD = new Intl.NumberFormat("it-IT", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

function cur(row) { return row.currency === "EUR" ? "€" : "$"; }
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
    if (showSpin) toast("Dati ricaricati ✓");
  } catch (e) {
    console.error(e);
    if (showSpin) toast("Errore nel caricamento dati");
  } finally {
    btn.classList.remove("spinning");
  }
}

function renderAll() {
  const d = new Date(DATA.updated_at);
  $("#updated-at").textContent = d.toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
  $("#fx-note").textContent = `EUR/USD ${fmtNum.format(DATA.eurusd)} — azioni in USD, BTP in EUR`;
  renderKPI();
  renderTable();
  renderGauges();
  renderMacro();
  renderNews();
}

/* ---------------- KPI ---------------- */
function renderKPI() {
  const t = DATA.totals;
  const kpis = [
    { label: "Valore totale (€)", value: fmtEUR.format(t.eur_value), sub: `${signTxt(t.eur_gain_pct)} dal carico`, subCls: signCls(t.eur_gain), accent: "var(--blue)" },
    { label: "Guadagno totale (€)", value: signTxt(Math.round(t.eur_gain), " €"), sub: `${signTxt(t.eur_gain_pct)}`, subCls: signCls(t.eur_gain), accent: t.eur_gain >= 0 ? "var(--green)" : "var(--red)", valueCls: signCls(t.eur_gain) },
    { label: "Azioni USA ($)", value: fmtUSD.format(t.usd_value), sub: `${signTxt(t.usd_gain_pct)} (${signTxt(t.usd_gain, " $")})`, subCls: signCls(t.usd_gain), accent: "var(--purple)" },
  ];
  const vix = DATA.macro?.vix;
  if (vix) kpis.push({ label: "VIX", value: fmtNum.format(vix.value), sub: signTxt(vix.change_pct), subCls: signCls(-vix.change_pct), accent: "var(--yellow)" });

  $("#kpi-grid").innerHTML = kpis.map(k => `
    <div class="kpi" style="--accent:${k.accent}">
      <div class="label">${k.label}</div>
      <div class="value ${k.valueCls || ""}">${k.value}</div>
      <div class="sub ${k.subCls || ""}">${k.sub || ""}</div>
    </div>`).join("");
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

function renderTable() {
  const rows = DATA.portfolio.map(r => {
    const c = cur(r);
    const pe = (r.pe && r.pe > 0) ? fmtNum.format(r.pe) : "—";
    const ath = r.ath ? `${fmtNum.format(r.ath)} <span class="muted">(${signTxt(r.ath_dist_pct)})</span>` : "—";
    return `<tr>
      <td class="name-cell">${r.name}<span class="tk">${r.ticker}</span></td>
      <td class="num">${fmtNum.format(r.qty)}</td>
      <td class="num">${c}${fmtNum.format(r.pmc)}</td>
      <td class="num"><b>${c}${fmtNum.format(r.price)}</b></td>
      <td class="num ${signCls(r.change_pct)}">${signTxt(r.change_pct)}</td>
      <td class="num">${c}${fmtNum.format(Math.round(r.value))}</td>
      <td class="num ${signCls(r.gain)}">${signTxt(Math.round(r.gain), ` ${c}`)}</td>
      <td class="num ${signCls(r.gain_pct)}"><b>${signTxt(r.gain_pct)}</b></td>
      <td class="num">${pe}</td>
      <td class="num">${ath}</td>
      <td class="num">${r.support ? c + fmtNum.format(r.support) : "—"}</td>
      <td class="num">${r.resistance ? c + fmtNum.format(r.resistance) : "—"}</td>
      <td class="num">${rsiBar(r.rsi)}</td>
      <td class="num">${volBar(r.vol_ratio)}</td>
      <td><span class="badge ${r.signal_class}">${r.signal}</span></td>
      <td>${sparkline(r.spark)}</td>
    </tr>`;
  }).join("");

  const t = DATA.totals;
  const totalRow = `<tr class="total-row">
    <td class="name-cell">TOTALE (€)</td><td></td><td></td><td></td><td></td>
    <td class="num">${fmtEUR.format(t.eur_value)}</td>
    <td class="num ${signCls(t.eur_gain)}">${signTxt(Math.round(t.eur_gain), " €")}</td>
    <td class="num ${signCls(t.eur_gain_pct)}"><b>${signTxt(t.eur_gain_pct)}</b></td>
    <td colspan="8"></td>
  </tr>`;
  $("#ptf-table tbody").innerHTML = rows + totalRow;
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

function renderGauges() {
  const m = DATA.macro || {};
  const cards = [];

  if (m.fear_greed) {
    const fg = m.fear_greed;
    cards.push(`<div class="gauge-card">
      <div class="g-title">Fear &amp; Greed</div>
      ${gaugeSVG(fg.score, fgColor(fg.score))}
      <div class="gauge-value">${fg.score}</div>
      <div class="gauge-sub"><b>${FG_LABELS[fg.rating] || fg.rating}</b><br>
      1 sett. fa: ${fg.week_ago} · 1 mese fa: ${fg.month_ago}</div>
    </div>`);
  }

  if (m.vix) {
    const vixPct = Math.min(100, (m.vix.value / 50) * 100);
    const vixColor = m.vix.value < 17 ? "var(--green)" : m.vix.value < 25 ? "var(--yellow)" : "var(--red)";
    cards.push(`<div class="gauge-card">
      <div class="g-title">VIX — Volatilità</div>
      ${gaugeSVG(vixPct, vixColor)}
      <div class="gauge-value">${fmtNum.format(m.vix.value)}</div>
      <div class="gauge-sub">${signTxt(m.vix.change_pct)} oggi<br>
      ${m.vix.value < 17 ? "Mercato calmo" : m.vix.value < 25 ? "Tensione moderata" : "Alta volatilità"}</div>
    </div>`);
  }

  if (m.fedwatch) {
    const fw = m.fedwatch;
    const dir = fw.delta_bp <= -10 ? `tagli prezzati (~${Math.abs(fw.delta_bp)} bp)` :
                fw.delta_bp >= 10 ? `rialzi prezzati (~${fw.delta_bp} bp)` : "tassi fermi attesi";
    cards.push(`<div class="gauge-card">
      <div class="g-title">FedWatch (futures FF)</div>
      <div style="padding:14px 0 6px"><div class="gauge-value">${fw.target_range}</div></div>
      <div class="gauge-sub">Range obiettivo Fed attuale<br>
      Tasso implicito: <b>${fmtNum.format(fw.implied_rate)}%</b><br>${dir}</div>
    </div>`);
  }

  $("#gauges").innerHTML = cards.join("") || '<span class="muted">Dati non disponibili</span>';
}

/* ---------------- macro ---------------- */
const MACRO_ACCENTS = { cpi: "var(--red)", pce: "var(--yellow)", gdp: "var(--blue)", retail: "var(--purple)", nfp: "var(--green)", unemp: "var(--cyan)", pmi: "var(--blue)" };

function renderMacro() {
  const list = DATA.macro?.indicators || [];
  $("#macro-grid").innerHTML = list.length ? list.map(i => `
    <div class="macro-item" style="--accent:${MACRO_ACCENTS[i.key] || "var(--purple)"}">
      <div class="m-label">${i.label}</div>
      <div class="m-value">${i.value}</div>
      <div class="m-date">${i.date}</div>
    </div>`).join("") : '<span class="muted">Dati non disponibili</span>';
}

/* ---------------- news ---------------- */
function timeAgo(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins} min fa`;
  if (mins < 1440) return `${Math.round(mins / 60)} h fa`;
  return `${Math.round(mins / 1440)} gg fa`;
}

function renderNews() {
  let list = DATA.news || [];
  if (newsFilter === "portfolio") list = list.filter(n => n.tickers.length);
  $("#news-list").innerHTML = list.length ? list.map(n => `
    <li class="news-item">
      <a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>
      <div class="news-meta">
        <span class="news-src">${n.source}</span>
        <span class="news-time">${timeAgo(n.published)}</span>
        ${n.tickers.map(t => `<span class="news-tk">${t}</span>`).join("")}
      </div>
    </li>`).join("") : '<li class="muted">Nessuna news per il filtro selezionato</li>';
}

/* ---------------- prompt AI ---------------- */
function buildPrompt() {
  const t = DATA.totals;
  const m = DATA.macro || {};
  const lines = [];
  lines.push("Sei un analista finanziario esperto. Analizza il mio portafoglio con i dati di mercato qui sotto e fornisci: 1) valutazione sintetica della situazione, 2) titoli a rischio o con segnali tecnici rilevanti (RSI, supporti/resistenze), 3) impatto del quadro macro, 4) eventuali azioni da considerare (non è una richiesta di consulenza, voglio un'analisi ragionata).");
  lines.push("");
  lines.push(`DATI AL ${new Date(DATA.updated_at).toLocaleString("it-IT")}`);
  lines.push("");
  lines.push(`PORTAFOGLIO (totale ${fmtEUR.format(t.eur_value)}, guadagno ${signTxt(Math.round(t.eur_gain), " €")} / ${signTxt(t.eur_gain_pct)}):`);
  DATA.portfolio.forEach(r => {
    const c = cur(r);
    let l = `- ${r.name} (${r.ticker}): ${fmtNum.format(r.qty)} @ PMC ${c}${fmtNum.format(r.pmc)} | prezzo ${c}${fmtNum.format(r.price)} | oggi ${signTxt(r.change_pct)} | guadagno ${signTxt(r.gain_pct)}`;
    if (r.rsi !== null) l += ` | RSI ${r.rsi}`;
    if (r.support) l += ` | supporto ${c}${fmtNum.format(r.support)} / resistenza ${c}${fmtNum.format(r.resistance)}`;
    if (r.pe && r.pe > 0) l += ` | P/E ${fmtNum.format(r.pe)}`;
    l += ` | segnale: ${r.signal}`;
    lines.push(l);
  });
  lines.push("");
  lines.push("QUADRO MACRO:");
  if (m.fear_greed) lines.push(`- Fear & Greed: ${m.fear_greed.score} (${FG_LABELS[m.fear_greed.rating] || m.fear_greed.rating}), 1 settimana fa ${m.fear_greed.week_ago}, 1 mese fa ${m.fear_greed.month_ago}`);
  if (m.vix) lines.push(`- VIX: ${m.vix.value} (${signTxt(m.vix.change_pct)} oggi)`);
  if (m.fedwatch) lines.push(`- Fed: range ${m.fedwatch.target_range}, tasso implicito futures ${m.fedwatch.implied_rate}%`);
  (m.indicators || []).forEach(i => lines.push(`- ${i.label}: ${i.value} (${i.date})`));
  lines.push("");
  lines.push("ULTIME NEWS RILEVANTI:");
  (DATA.news || []).filter(n => n.tickers.length).slice(0, 10).forEach(n => lines.push(`- [${n.tickers.join(",")}] ${n.title} (${n.source})`));
  (DATA.news || []).filter(n => !n.tickers.length).slice(0, 8).forEach(n => lines.push(`- ${n.title} (${n.source})`));
  return lines.join("\n");
}

function toast(msg) {
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
$("#btn-refresh").addEventListener("click", () => loadData(true));
$("#btn-prompt").addEventListener("click", showPrompt);
$("#modal-close").addEventListener("click", () => { $("#modal").hidden = true; });
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").hidden = true; });
$("#btn-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#prompt-text").value);
  toast("Copiato ✓");
});
document.querySelectorAll("#news-filters .chip").forEach(ch => {
  ch.addEventListener("click", () => {
    document.querySelectorAll("#news-filters .chip").forEach(c => c.classList.remove("chip-active"));
    ch.classList.add("chip-active");
    newsFilter = ch.dataset.filter;
    renderNews();
  });
});

loadData();
// auto-refresh ogni 5 minuti
setInterval(() => loadData(), 5 * 60 * 1000);
