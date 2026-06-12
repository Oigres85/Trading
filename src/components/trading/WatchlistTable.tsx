import type { StockQuote } from '@/types/trading'

interface Props {
  stocks: StockQuote[]
}

function fmtPrice(v: number) {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtVol(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K'
  return String(v)
}

function fmtMktCap(v?: number): string {
  if (!v) return '—'
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T'
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B'
  return '$' + (v / 1e6).toFixed(0) + 'M'
}

function sign(v: number) {
  return v >= 0 ? '+' : ''
}

function changeClass(v: number) {
  return v > 0 ? 'text-[#00c875]' : v < 0 ? 'text-[#ff4d4d]' : 'text-[#4a5a7a]'
}

const SEMI_SYMBOLS = new Set(['NVDA','AMD','AVGO','TSM','ASML','QCOM','INTC','MU','ARM','AMAT','LRCX','KLAC','MRVL','ON','TXN','MCHP'])

export function WatchlistTable({ stocks }: Props) {
  const semis = stocks.filter((s) => SEMI_SYMBOLS.has(s.symbol))
  const largetech = stocks.filter((s) => !SEMI_SYMBOLS.has(s.symbol))

  function renderGroup(items: StockQuote[], label: string) {
    return (
      <>
        <tr>
          <td colSpan={9} className="px-3 pt-3 pb-1">
            <span className="text-[9px] font-bold tracking-[0.2em] text-[#3b7dd8] uppercase">{label}</span>
          </td>
        </tr>
        {items.map((s) => {
          const volRatio = s.avgVolume && s.volume ? s.volume / s.avgVolume : 1
          const volClass = volRatio > 1.5 ? 'text-yellow-400' : 'text-[#6b7fa3]'
          return (
            <tr key={s.symbol} className="border-b border-[#1e2d4a]/50 hover:bg-[#111827] transition-colors">
              <td className="px-3 py-2 font-bold text-[#c8d6f0] text-xs whitespace-nowrap">
                {s.symbol}
              </td>
              <td className="px-3 py-2 text-[11px] text-[#4a5a7a] max-w-[140px] truncate">
                {s.name}
              </td>
              <td className="px-3 py-2 text-xs text-right tabular-nums text-[#c8d6f0] font-semibold">
                ${fmtPrice(s.price)}
              </td>
              <td className={`px-3 py-2 text-xs text-right tabular-nums font-semibold ${changeClass(s.change)}`}>
                {sign(s.change)}{fmtPrice(s.change)}
              </td>
              <td className={`px-3 py-2 text-xs text-right tabular-nums font-bold ${changeClass(s.changePercent)}`}>
                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${s.changePercent > 0 ? 'bg-[#00c875]/10' : s.changePercent < 0 ? 'bg-[#ff4d4d]/10' : 'bg-transparent'}`}>
                  {sign(s.changePercent)}{s.changePercent.toFixed(2)}%
                </span>
              </td>
              <td className={`px-3 py-2 text-xs text-right tabular-nums ${volClass}`}>
                {fmtVol(s.volume)}
              </td>
              <td className="px-3 py-2 text-[11px] text-right tabular-nums text-[#4a5a7a]">
                {fmtMktCap(s.marketCap)}
              </td>
              <td className="px-3 py-2 text-[11px] text-right tabular-nums text-[#6b7fa3]">
                {s.pe ? s.pe.toFixed(1) + 'x' : '—'}
              </td>
              <td className="px-3 py-2 text-[11px] text-right tabular-nums text-[#4a5a7a]">
                {s.high52w ? `$${fmtPrice(s.high52w)}` : '—'}
              </td>
            </tr>
          )
        })}
      </>
    )
  }

  return (
    <div className="overflow-auto flex-1 min-w-0">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 bg-[#0a0e1a] z-10">
          <tr className="border-b border-[#1e2d4a]">
            {['SYMBOL','NAME','PRICE','CHG','CHG %','VOLUME','MKT CAP','P/E','52W HIGH'].map((h) => (
              <th key={h} className="px-3 py-2 text-[9px] font-bold tracking-widest text-[#4a5a7a] text-right first:text-left whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {renderGroup(semis, 'Semiconductors')}
          {renderGroup(largetech, 'Large-Cap Tech')}
        </tbody>
      </table>
    </div>
  )
}
