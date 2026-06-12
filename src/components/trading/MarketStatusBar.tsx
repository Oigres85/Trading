import type { MarketStatus } from '@/types/trading'

interface Props {
  status: MarketStatus
  lastUpdated: string
  isLive: boolean
  onRefresh: () => void
  refreshing: boolean
}

const STATUS_CONFIG: Record<MarketStatus, { label: string; textColor: string; dotClass: string }> = {
  open: { label: 'NYSE OPEN', textColor: 'text-[#00c875]', dotClass: 'bg-[#00c875] pulse-live' },
  'pre-market': { label: 'PRE-MARKET', textColor: 'text-yellow-400', dotClass: 'bg-yellow-400' },
  'after-hours': { label: 'AFTER HOURS', textColor: 'text-blue-400', dotClass: 'bg-blue-400' },
  closed: { label: 'MARKET CLOSED', textColor: 'text-[#4a5a7a]', dotClass: 'bg-[#4a5a7a]' },
}

export function MarketStatusBar({ status, lastUpdated, isLive, onRefresh, refreshing }: Props) {
  const cfg = STATUS_CONFIG[status]

  return (
    <header className="flex items-center justify-between px-5 py-2 bg-[#0f1629] border-b border-[#1e2d4a] select-none">
      <div className="flex items-center gap-5">
        <span className="text-xs font-bold tracking-[0.2em] text-[#3b7dd8]">
          TECH/SEMI DASHBOARD
        </span>
        <div className="h-3 w-px bg-[#1e2d4a]" />
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full ${cfg.dotClass}`} />
          <span className={`text-xs font-semibold ${cfg.textColor}`}>{cfg.label}</span>
        </div>
      </div>

      <div className="flex items-center gap-5">
        {!isLive && (
          <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 px-2 py-0.5 rounded tracking-wider">
            SIMULATED DATA
          </span>
        )}
        <span className="text-[11px] text-[#4a5a7a]">
          {new Date(lastUpdated).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ET
        </span>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="text-[11px] text-[#3b7dd8] hover:text-blue-300 disabled:opacity-40 transition-colors cursor-pointer"
        >
          {refreshing ? '↺ Refreshing…' : '↺ Refresh'}
        </button>
      </div>
    </header>
  )
}
