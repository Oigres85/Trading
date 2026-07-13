#!/usr/bin/env node
/* LLM-CRITIC in CI (v122) — QA SEMANTICO automatico del prompt via Gemini.
   La mossa finale per azzerare il QA manuale del CEO: a ogni run genera il prompt REALE
   (stessa pipeline di buildPrompt) e chiede a Gemini di auditarlo come farebbe un revisore
   umano — incongruenze fra celle, valori impossibili, campi mal-etichettati, dati mancanti.
   Fa ciò che il red team deterministico NON può fare: l'audit semantico APERTO. Se trova
   problemi → alert WhatsApp (CallMeBot, stesso canale) + log storico in config/.

   ANTI-FRAGILE: exit 0 SEMPRE. Senza GEMINI_API_KEY fa no-op (si attiva quando il CEO
   aggiunge il secret). Nessuna dipendenza esterna: solo Node ≥18 (fetch globale).
   Uso: GEMINI_API_KEY=... node scripts/llm_critic.mjs  (--dry stampa il verdetto, non invia) */
import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = join(ROOT, "config", "llm_critic_log.jsonl");
const DRY = process.argv.includes("--dry");
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

/* ---------- 1) genera il prompt reale (stesso harness di redteam/test) ---------- */
function buildLivePrompt() {
  const src = readFileSync(join(ROOT, "assets", "app.js"), "utf8");
  const el = () => ({
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, dataset: {}, hidden: true, className: "", innerHTML: "", textContent: "", value: "",
    appendChild() {}, remove() {}, after() {}, focus() {}, click() {}, scrollIntoView() {},
    querySelector: () => el(), querySelectorAll: () => [], dispatchEvent() {}, closest: () => null, setAttribute() {},
  });
  let header = null, diary = null;
  try { header = readFileSync(join(ROOT, "config", "prompt_header.txt"), "utf8"); } catch { /* fallback */ }
  try { diary = readFileSync(join(ROOT, "config", "action_diary.json"), "utf8"); } catch { /* vuoto */ }
  const store = {}; if (header) store.prompt_header = header; if (diary) store.action_diary = diary;
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    document: { querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(), createElement: () => el(), addEventListener() {}, body: el() },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem() {}, removeItem() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    navigator: { clipboard: {} }, fetch: () => Promise.reject(new Error("offline")),
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
    Event: class {}, MutationObserver: class { observe() {} },
  });
  vm.runInContext(src, ctx, { filename: "app.js" });
  const d = JSON.parse(readFileSync(join(ROOT, "data", "data.json"), "utf8").replace(/\bNaN\b/g, "null"));
  const cash = (d.totals && d.totals.cash) ? d.totals.cash : 21000;
  vm.runInContext(`DATA=${JSON.stringify(d)}; cashEur=${cash}; recomputeTotals();`, ctx);
  return { prompt: vm.runInContext("buildPrompt()", ctx), updated: d.updated_at };
}

/* ---------- 2) meta-prompt di QA per Gemini (revisore, NON advisor) ---------- */
const QA_INSTRUCTION = `Sei un REVISORE QA di sistemi di trading istituzionali, non un analista. Ti do il PAYLOAD che un fondo invia a un LLM per generare raccomandazioni operative. NON generare raccomandazioni, NON commentare il mercato.

Il tuo UNICO compito: trovare DIFETTI OGGETTIVI del payload che porterebbero a decisioni sbagliate. Cerca esclusivamente:
1. VALORI IMPOSSIBILI: stop loss negativi o ≥ prezzo d'ingresso, prezzi/supporti ≤ 0, dividend yield > 20%, R/R oltre 1:60, ROE fuori da [-150%,+400%], P/E assurdi.
2. INCOERENZE FRA CELLE: due valori diversi per la STESSA grandezza; uno stop sopra il limite d'ingresso della stessa riga; un numero nel testo che contraddice la tabella.
3. CAMPI MAL-ETICHETTATI: un valore messo nella colonna/etichetta sbagliata; un "prezzo" che in realtà è un limite; unità incoerenti.
4. POSIZIONI DETENUTE (Qtà valorizzata) SENZA stop di protezione (colonna Stop = "—"), esclusi i titoli di stato (BTP).
5. CONTEGGI SBAGLIATI: "N POSIZIONI/TITOLI" che non corrisponde al numero di righe della tabella.

REGOLE ANTI-FALSO-POSITIVO (rispettale rigorosamente):
- "—", "n.d.", "n/a", "[chiusura del …]", "[LIVE]", "[MACRO SHOCK ALERT]", "[STOP A RISCHIO …]", "[BILANCI VALUTA LOCALE]", "provvisorio", "teorico", "storia <60 sedute" sono comportamenti/flag CORRETTI del sistema, NON difetti. Non segnalarli come errori. (Se presente [MACRO SHOCK ALERT], puoi però annotarlo a parte come [ALTA] contesto: "shock macro attivo — acquisti da sospendere".)
- Un Sortino/Sharpe/EPS NEGATIVO è legittimo. Un dato semplicemente MANCANTE (—) NON è un difetto.
- NON valutare la bontà delle scelte d'investimento: solo la coerenza matematica e strutturale dei DATI.

OUTPUT: se il payload è pulito, rispondi ESATTAMENTE con la sola parola: PULITO
Altrimenti elenca max 8 difetti REALI, uno per riga, formato: [ALTA|MEDIA|BASSA] Ticker/sezione — difetto conciso coi numeri. Niente preamboli.

=== PAYLOAD DA AUDITARE ===
`;

/* ---------- 3) chiamata Gemini ---------- */
async function askGemini(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(KEY)}`;
  const body = { contents: [{ parts: [{ text }] }], generationConfig: { temperature: 0, maxOutputTokens: 900 } };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const out = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
  if (!out) throw new Error("Gemini: risposta vuota");
  return out.trim();
}

/* ---------- 4) WhatsApp (stesso canale di notify_alerts, dedup giornaliero) ---------- */
async function whatsapp(msg) {
  const apikey = process.env.CALLMEBOT_APIKEY, phone = process.env.CALLMEBOT_PHONE;
  if (!apikey || !phone) { console.log("!! LLM-critic: CALLMEBOT non configurato, alert non inviato"); return false; }
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&apikey=${encodeURIComponent(apikey)}&text=${encodeURIComponent(msg)}`;
  const r = await fetch(url, { method: "GET" });
  console.log("LLM-critic: WhatsApp", r.ok ? "inviato" : `HTTP ${r.status}`);
  return r.ok;
}
function lastLoggedHash() {
  try { const lines = readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean); return JSON.parse(lines[lines.length - 1]).hash; }
  catch { return null; }
}

/* ---------- main ---------- */
async function main() {
  const { prompt, updated } = buildLivePrompt();
  if (!KEY && !DRY) { console.log("LLM-critic: GEMINI_API_KEY assente → no-op (aggiungi il secret per attivare)"); return; }

  let verdict;
  if (DRY && !KEY) { console.log("[--dry senza KEY] prompt generato:", prompt.length, "char. Verdetto simulato: PULITO"); return; }
  verdict = await askGemini(QA_INSTRUCTION + prompt);

  const clean = /^\s*PULITO\s*$/i.test(verdict) || verdict.toUpperCase().startsWith("PULITO");
  const day = new Date().toISOString().slice(0, 10);
  const hash = createHash("sha1").update(day + "|" + verdict).digest("hex").slice(0, 12);

  if (clean) { console.log("LLM-critic: PULITO — nessun difetto semantico rilevato da Gemini"); return; }

  console.log("LLM-critic: DIFETTI RILEVATI da Gemini:\n" + verdict);
  if (DRY) return;
  try { appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), updated, hash, verdict }) + "\n"); } catch { /* best-effort */ }
  if (lastLoggedHash() === hash) { /* già segnalato oggi con lo stesso esito: log ma niente doppio WhatsApp */ }
  const msg = "🔎 LLM-CRITIC — Gemini ha rilevato possibili difetti nel payload del " +
    `${(updated || "").slice(0, 16).replace("T", " ")}:\n${verdict.slice(0, 900)}\n\nVerifica prima di usare il report.`;
  await whatsapp(msg);
}

main().catch(e => console.error("!! LLM-critic (best-effort, pipeline NON bloccata):", e.message))
  .finally(() => process.exit(0));
