'use client'
import { useEffect, useState } from 'react'
import { fetchFearGreed, type FearGreed } from '@/lib/marketFetch'
import { calcPortfolioStats, PORTFOLIO } from '@/lib/portfolio'
import type { MarketIndex, StockQuote } from '@/types/trading'

interface Props {
  indices: MarketIndex[]
  stocks: StockQuote[]
}

function fmtUSD(n: number): string {
  return '$' + Math.round(Math.abs(n)).toLocaleString('en-US')
}

function fmtPnL(dollar: number, pct: number): string {
  const sign = dollar >= 0 ? '+' : '-'
  return `${sign}${fmtUSD(dollar)} (${sign}${Math.abs(pct).toFixed(2)}%)`
}

function fearGreedColor(value: number): string {
  if (value <= 24) return '#cc2222'
  if (value <= 44) return '#ff4d4d'
  if (value <= 55) return '#f5c518'
  if (value <= 74) return '#00c875'
  return '#00ff99'
}

function fearGreedLabel(value: number): string {
  if (value <= 24) return 'Extreme Fear'
  if (value <= 44) return 'Fear'
  if (value <= 55) return 'Neutral'
  if (value <= 74) return 'Greed'
  return 'Extreme Greed'
}

interface CardProps {
  label: string
  value: string
  sub?: string
  positive?: boolean | null
  subColor?: string
}

function KPICard({ label, value, sub, positive, subColor }: CardProps) {
  const accent =
    positive === true  ? '#00c875' :
    positive === false ? '#ff4d4d' : '#2a3d5a'

  return (
    <div
      className="rounded-xl border border-[#1e2d4a] px-4 py-3 flex-1 min-w-0 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #0d1829 0%, #0a1220 100%)',
        borderTop: `2px solid ${accent}`,
      }}
    >
      {/* subtle glow on the top accent line */}
      <div className="absolute top-0 left-0 right-0 h-px opacity-30" style={{ background: accent }} />
      <div className="text-[9px] font-semibold tracking-widest text-[#4a5a7a] uppercase mb-1">{label}</div>
      <div className="text-lg font-bold text-white tabular-nums truncate leading-tight">{value}</div>
      {sub && (
        <div
          className="text-[10px] font-medium mt-0.5 truncate"
          style={{ color: subColor ?? (positive === true ? '#00c875' : positive === false ? '#ff4d4d' : '#4a5a7a') }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

export function KPIBar({ indices, stocks }: Props) {
  const [fearGreed, setFearGreed] = useState<FearGreed | null>(null)

  useEffect(() => {
    fetchFearGreed().then(setFearGreed)
  }, [])

  // Build quotes map from stocks
  const quotesMap = new Map(
    stocks.map(s => [s.symbol, { price: s.price, change: s.change, changePercent: s.changePercent }])
  )
  // Also include portfolio positions with zero if not found
  for (const p of PORTFOLIO) {
    if (!quotesMap.has(p.symbol)) {
      quotesMap.set(p.symbol, { price: 0, change: 0, changePercent: 0 })
    }
  }

  const stats = calcPortfolioStats(quotesMap)

  const vix = indices.find(i => i.symbol === '^VIX')
  const usdjpy = indices.find(i => i.symbol === 'USDJPY=X')

  // P&L sign helpers
  const dayPositive = stats.dayPnL >= 0
  const totalPositive = stats.totalPnL >= 0

  return (
    <div className="flex gap-2 flex-wrap">
      {/* Portfolio Value */}
      <KPICard
        label="Portfolio Value"
        value={fmtUSD(stats.currentValue)}
        positive={null}
      />

      {/* Day P&L */}
      <KPICard
        label="Day P&L"
        value={fmtPnL(stats.dayPnL, stats.dayPnLPct)}
        positive={dayPositive}
        subColor={dayPositive ? '#00c875' : '#ff4d4d'}
      />

      {/* Total P&L */}
      <KPICard
        label="Total P&L"
        value={fmtPnL(stats.totalPnL, stats.totalPnLPct)}
        positive={totalPositive}
        subColor={totalPositive ? '#00c875' : '#ff4d4d'}
      />

      {/* VIX */}
      <KPICard
        label="VIX"
        value={vix ? vix.value.toFixed(2) : '—'}
        sub={vix ? `${vix.changePercent >= 0 ? '▲' : '▼'} ${Math.abs(vix.changePercent).toFixed(2)}%` : undefined}
        positive={vix ? vix.changePercent < 0 : null}
      />

      {/* Fear & Greed */}
      {fearGreed ? (
        <div
          className="rounded-xl border border-[#1e2d4a] px-4 py-3 flex-1 min-w-0 relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #0d1829 0%, #0a1220 100%)',
            borderTop: `2px solid ${fearGreedColor(fearGreed.value)}`,
          }}
        >
          <div className="text-[9px] font-semibold tracking-widest text-[#4a5a7a] uppercase mb-1">Fear &amp; Greed</div>
          <div className="text-lg font-bold tabular-nums leading-tight" style={{ color: fearGreedColor(fearGreed.value) }}>
            {fearGreed.value}
          </div>
          <div className="text-[10px] font-medium mt-0.5" style={{ color: fearGreedColor(fearGreed.value) }}>
            {fearGreedLabel(fearGreed.value)}
          </div>
        </div>
      ) : (
        <KPICard label="Fear & Greed" value="—" positive={null} />
      )}

      {/* USD/JPY */}
      <KPICard
        label="USD/JPY"
        value={usdjpy ? usdjpy.value.toFixed(3) : '—'}
        sub={
          usdjpy
            ? `${usdjpy.changePercent >= 0 ? '▲' : '▼'} ${Math.abs(usdjpy.changePercent).toFixed(3)}`
            : undefined
        }
        positive={usdjpy ? usdjpy.changePercent >= 0 : null}
      />
    </div>
  )
}
