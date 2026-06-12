import type { MarketIndex } from '@/types/trading'

interface Props {
  indices: MarketIndex[]
}

const NICKNAME_MAP: Record<string, string> = {
  '^GSPC':    'S&P 500',
  '^NDX':     'NDX100',
  '^SOX':     'SOX',
  '^VIX':     'VIX',
  '^TNX':     '10Y Yield',
  'DX-Y.NYB': 'DXY',
  'GC=F':     'Gold',
  'CL=F':     'WTI Oil',
}

function sign(v: number): string {
  return v >= 0 ? '+' : ''
}

export function MacroBar({ indices }: Props) {
  return (
    <div className="bg-[#0f1629] border-b border-[#1e2d4a] overflow-x-auto">
      <div className="flex items-stretch min-w-max px-3 py-0">
        {indices.map((idx, i) => {
          const isPos = idx.changePercent >= 0
          const nickname = NICKNAME_MAP[idx.symbol] ?? idx.symbol

          return (
            <div key={idx.symbol} className="flex items-center">
              {i > 0 && (
                <div className="w-px h-6 bg-[#1e2d4a] mx-1 self-center" />
              )}
              <div className="flex flex-col justify-center px-3 py-1.5 min-w-[90px]">
                <div className="text-[9px] font-bold tracking-wider text-[#4a5a7a] uppercase truncate">
                  {nickname}
                </div>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-[12px] font-semibold text-[#c8d6f0] tabular-nums">
                    {idx.value.toFixed(2)}
                  </span>
                  <span className={`text-[10px] font-semibold tabular-nums ${isPos ? 'text-[#00c875]' : 'text-[#ff4d4d]'}`}>
                    {sign(idx.changePercent)}{idx.changePercent.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
