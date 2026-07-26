#!/usr/bin/env node
/* MISURA DELLE DECISIONI DEL CEO (v173) — le TUE operazioni, non i report dell'LLM.

   Perché esiste: il CEO ha escluso di inserire a mano dati sulla qualità dei report, ed è una
   scelta legittima. Ma il DIARIO lo riempie già, e dal v165 è strutturato {tipo, qty, ticker,
   prezzo, data}. Quel materiale basta per chiudere il cerchio senza chiedergli nulla di nuovo.

   Le due domande a cui risponde:
     1. Quell'operazione, col senno di poi, ha creato o distrutto valore? (vs tenere fermo, e
        vs l'indice: vendere in un mercato che scende non è bravura, è il mercato)
     2. Che cosa diceva il SISTEMA quel giorno su quel titolo? Era d'accordo o lo contraddiceva?
   La seconda è quella che conta: dice se il sistema stava aiutando o se il CEO faceva meglio
   da solo. È l'unica misura onesta del valore di questo strumento, e non costa nulla in più.

   PREZZO DI ESECUZIONE: si usa quello REALE scritto nel diario, non una ricostruzione — è il
   dato migliore che esista e nessuna stima può batterlo.

   Uso:  node scripts/backtest_diary.mjs [--verbose]                                          */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERBOSE = process.argv.includes("--verbose");
const leggi = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return null; } };

const data = JSON.parse(readFileSync(join(ROOT, "data", "data.json"), "utf8").replace(/\bNaN\b/g, "null"));
const universo = new Map([...(data.portfolio || []), ...(data.watchlist || [])]
  .filter(r => r && r.ticker).map(r => [r.ticker, r]));
const diario = JSON.parse(leggi("config/action_diary.json") || "[]");
const verdetti = (leggi("config/verdict_history.jsonl") || "").trim().split("\n")
  .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const isoDa = (gg) => {                       // "15/07/2026" → "2026-07-15"
  const m = String(gg || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const eurusd = data.eurusd || 1.08;

/* variazione dell'indice fra due date, dai verdetti loggati (che portano l'NDX del giorno) */
function indiceTra(isoDa_, isoA) {
  const a = verdetti.find(v => v.date === isoDa_) || verdetti.filter(v => v.date <= isoDa_).pop();
  const b = verdetti.filter(v => v.date <= isoA).pop();
  if (!a?.ndx || !b?.ndx) return null;
  return (b.ndx / a.ndx - 1) * 100;
}

/* che cosa diceva il sistema su quel titolo quel giorno */
function sistemaDiceva(tk, iso) {
  const v = verdetti.find(x => x.date === iso) || verdetti.filter(x => x.date <= iso).pop();
  if (!v || v.date > iso) return { stato: "non ancora loggato" };
  const cand = (v.candidates || []).find(c => c.tk === tk);
  return {
    stato: "disponibile", data: v.date, label: v.label,
    candidato: cand ? `SÌ (score ${cand.q}/100)` : "no",
    riabilitato: (v.rehab || []).includes(tk) ? "sì" : "no",
    squeeze: (v.squeeze || []).includes(tk) ? "sì" : "no",
  };
}

const OGGI = String(data.updated_at || new Date().toISOString()).slice(0, 10);
const righe = [];
for (const e of diario) {
  const o = e.op || {};
  if (!o.ticker || !o.tipo) continue;
  const iso = isoDa(o.quando) || String(e.date).slice(0, 10);
  const r = universo.get(o.ticker);
  const pxOra = r && r.price > 0 ? r.price : null;
  const pxOp = Number(o.prezzo);
  const mossaTitolo = (Number.isFinite(pxOp) && pxOp > 0 && pxOra) ? (pxOra / pxOp - 1) * 100 : null;
  const mossaIndice = indiceTra(iso, OGGI);
  // per una VENDITA il valore creato è il movimento EVITATO (segno opposto); per un ACQUISTO è il P&L
  const esito = mossaTitolo == null ? null : (o.tipo === "VENDITA" ? -mossaTitolo : mossaTitolo);
  const esitoRel = (esito == null || mossaIndice == null) ? null
    : (o.tipo === "VENDITA" ? esito + mossaIndice : esito - mossaIndice);
  righe.push({ ...o, iso, pxOra, mossaTitolo, mossaIndice, esito, esitoRel,
               quote: Number(o.qty), sistema: sistemaDiceva(o.ticker, iso) });
}

/* ---------------------------------- rapporto ---------------------------------- */
console.log(`\nMISURA DELLE DECISIONI DEL CEO — ${righe.length} operazioni nel diario · prezzi al ${OGGI}`);
console.log(`Prezzo di esecuzione: quello REALE annotato nel diario. "Esito" = valore creato dalla mossa`);
console.log(`(per una VENDITA: il movimento evitato · per un ACQUISTO: il P&L). "vs indice" toglie il mercato.\n`);

for (const x of righe) {
  const seg = x.esito == null ? "n.d."
    : `${x.esito >= 0 ? "+" : ""}${x.esito.toFixed(1)}%${x.esitoRel != null ? ` · vs indice ${x.esitoRel >= 0 ? "+" : ""}${x.esitoRel.toFixed(1)}pp` : ""}`;
  const giudizio = x.esitoRel == null ? "" : x.esitoRel > 1 ? "  ✓ ha creato valore" : x.esitoRel < -1 ? "  ✗ ha distrutto valore" : "  ≈ neutra";
  const euro = (Number.isFinite(x.quote) && Number.isFinite(Number(x.prezzo)) && x.esito != null)
    ? `  (~${Math.round(x.quote * Number(x.prezzo) * (x.esito / 100) / eurusd).toLocaleString("it-IT")} € sulla posizione)` : "";
  console.log(`  ${x.quando || x.iso}  ${x.tipo.padEnd(9)} ${String(x.quote ?? "?").padStart(4)} ${x.ticker.padEnd(6)} @ ${String(x.prezzo ?? "?").padStart(7)}`);
  console.log(`     prezzo oggi ${x.pxOra ?? "n.d."} → esito ${seg}${giudizio}${euro}`);
  const s = x.sistema;
  console.log(`     il sistema quel giorno: ${s.stato === "disponibile"
    ? `verdetto ${s.label}${s.data !== x.iso ? ` (rilevazione più vicina: ${s.data})` : ""} · candidato all'acquisto: ${s.candidato}${s.riabilitato === "sì" ? " · RIABILITATO" : ""}${s.squeeze === "sì" ? " · setup squeeze" : ""}`
    : "non ancora loggato (il registro dei verdetti parte dall'11/07/2026)"}`);
  console.log("");
}

const misurate = righe.filter(x => x.esitoRel != null);
if (misurate.length) {
  const med = misurate.reduce((s, x) => s + x.esitoRel, 0) / misurate.length;
  const buone = misurate.filter(x => x.esitoRel > 1).length;
  console.log(`SINTESI: ${misurate.length} operazioni misurabili · valore medio creato vs indice ${med >= 0 ? "+" : ""}${med.toFixed(1)}pp · a valore positivo ${buone}/${misurate.length}`);
  const conSistema = righe.filter(x => x.sistema.stato === "disponibile").length;
  console.log(`CONFRONTO COL SISTEMA: possibile su ${conSistema}/${righe.length} operazioni — per le altre il registro dei verdetti non era ancora attivo.`);
}
console.log(`\n⚠ CAMPIONE: ${righe.length} operazioni. È un diario, non un track record: serve per vedere la DIREZIONE`);
console.log(`  delle proprie scelte, non per trarne statistiche. Il valore cresce con le operazioni annotate.\n`);
