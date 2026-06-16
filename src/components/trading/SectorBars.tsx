import type { SectorETF } from '@/types/trading'

interface Props {
  sectors: SectorETF[]
}

function sign(v: number) {
  return v >= 0 ? '+' : ''
}

export function SectorBars({ sectors }: Props) {
  const maxAbs = Math.max(...sectors.map((s) => Math.abs(s.changePercent)), 0.1)

  return (
    <div className="bg-[#0f1629] border-t border-[#1e2d4a] px-5 py-4">
      <div className="text-[9px] font-bold tracking-[0.2em] text-[#3b7dd8] uppercase mb-3">
        Sector / ETF Performance
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
        {sectors.map((s) => {
          const pct = s.changePercent
          const barWidth = Math.abs(pct) / maxAbs
          const isPos = pct >= 0

          return (
            <div key={s.symbol} className="flex items-center gap-3">
              <div className="w-12 text-[10px] font-bold text-[#c8d6f0] shrink-0">{s.symbol}</div>
              <div className="flex-1 relative h-3 bg-[#1e2d4a] rounded-sm overflow-hidden">
                <div
                  className={`absolute top-0 h-full rounded-sm transition-all ${isPos ? 'bg-[#00c875]/70 left-0' : 'bg-[#ff4d4d]/70 right-0'}`}
                  style={{ width: `${Math.min(barWidth * 100, 100)}%` }}
                />
              </div>
              <div className={`w-16 text-right text-[10px] font-bold tabular-nums shrink-0 ${isPos ? 'text-[#00c875]' : 'text-[#ff4d4d]'}`}>
                {sign(pct)}{pct.toFixed(2)}%
              </div>
              <div className="w-14 text-right text-[11px] tabular-nums text-[#4a5a7a] shrink-0">
                ${s.price.toFixed(2)}
              </div>
              <div className="hidden xl:block text-[10px] text-[#2a3a5a] max-w-[160px] truncate">{s.name}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
