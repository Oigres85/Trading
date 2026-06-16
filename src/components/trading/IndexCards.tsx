import type { MarketIndex } from '@/types/trading'

interface Props {
  indices: MarketIndex[]
}

function fmt(v: number, decimals = 2) {
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function sign(v: number) {
  return v >= 0 ? '+' : ''
}

function changeClass(v: number) {
  return v > 0 ? 'text-[#00c875]' : v < 0 ? 'text-[#ff4d4d]' : 'text-[#4a5a7a]'
}

export function IndexCards({ indices }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#1e2d4a]">
      {indices.map((idx) => (
        <div key={idx.symbol} className="bg-[#0f1629] px-5 py-4">
          <div className="text-[10px] font-semibold text-[#4a5a7a] tracking-widest uppercase mb-1">
            {idx.name}
          </div>
          <div className="text-xl font-bold text-[#c8d6f0] tabular-nums">
            {fmt(idx.value, idx.symbol === '^VIX' ? 2 : 2)}
          </div>
          <div className={`flex items-center gap-2 mt-1 text-xs tabular-nums font-semibold ${changeClass(idx.changePercent)}`}>
            <span>{sign(idx.change)}{fmt(idx.change)}</span>
            <span className="text-[10px] opacity-80">({sign(idx.changePercent)}{fmt(idx.changePercent)}%)</span>
          </div>
        </div>
      ))}
    </div>
  )
}
