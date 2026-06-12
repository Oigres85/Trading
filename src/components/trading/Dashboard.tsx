'use client'

import { useState, useEffect, useCallback } from 'react'
import type { MarketDataResponse, NewsResponse, StockQuote } from '@/types/trading'
import { fetchMarketData, fetchNews } from '@/lib/marketFetch'
import { PORTFOLIO_SYMBOLS } from '@/lib/portfolio'
import { MarketStatusBar } from './MarketStatusBar'
import { KPIBar } from './KPIBar'
import { PortfolioTable } from './PortfolioTable'
import { TradingViewChart } from './TradingViewChart'
import { SectorBars } from './SectorBars'
import { NewsPanel } from './NewsPanel'

// Re-export for convenience so consumers can import from one place
export { MarketStatusBar, KPIBar, PortfolioTable, TradingViewChart, SectorBars, NewsPanel }

const REFRESH_INTERVAL = 30_000

export function Dashboard() {
  const [market,         setMarket]         = useState<MarketDataResponse | null>(null)
  const [news,           setNews]           = useState<NewsResponse | null>(null)
  const [selectedSymbol, setSelected]       = useState<string>('NVDA')
  const [loading,        setLoading]        = useState(true)
  const [newsLoading,    setNewsLoading]    = useState(true)
  const [refreshing,     setRefreshing]     = useState(false)

  // ── Data loaders ─────────────────────────────────────────────────────────────

  const loadMarket = useCallback(async () => {
    try {
      const data = await fetchMarketData()
      setMarket(data)
    } catch { /* fetchMarketData handles its own fallback */ } finally {
      setLoading(false)
    }
  }, [])

  const loadNews = useCallback(async () => {
    try {
      const data = await fetchNews()
      setNews(data)
    } finally {
      setNewsLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([loadMarket(), loadNews()])
    setRefreshing(false)
  }, [loadMarket, loadNews])

  // Initial fetch
  useEffect(() => {
    loadMarket()
    loadNews()
  }, [loadMarket, loadNews])

  // Auto-refresh market data every 30 s
  useEffect(() => {
    const id = setInterval(loadMarket, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [loadMarket])

  // ── Derived data ──────────────────────────────────────────────────────────────

  const stockMap = new Map<string, StockQuote>(
    (market?.stocks ?? []).map(s => [s.symbol, s])
  )

  const portfolioStocks: StockQuote[] = PORTFOLIO_SYMBOLS.map(sym =>
    stockMap.get(sym) ?? {
      symbol:        sym,
      name:          sym,
      price:         0,
      change:        0,
      changePercent: 0,
      volume:        0,
      timestamp:     0,
    } as StockQuote
  )

  // ── Loading screen ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#080c14]">
        <div className="text-center">
          <div className="text-3xl font-bold tracking-widest text-[#3b7dd8] mb-2">TECH/SEMI</div>
          <div className="text-xs text-[#4a5a7a] tracking-widest">LOADING MARKET DATA…</div>
          <div className="mt-4 flex justify-center">
            <div className="w-6 h-6 border-2 border-[#3b7dd8] border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    )
  }

  if (!market) return null

  return (
    <div className="flex flex-col h-screen bg-[#080c14] overflow-hidden">
      {/* 1. Header */}
      <MarketStatusBar
        status={market.marketStatus}
        lastUpdated={market.lastUpdated}
        isLive={market.isLive}
        onRefresh={refresh}
        refreshing={refreshing}
      />

      {/* 2. KPI Bar */}
      <div className="shrink-0 px-3 py-2 bg-[#0a0e1a] border-b border-[#1e2d4a]">
        <KPIBar indices={market.indices} stocks={market.stocks} />
      </div>

      {/* 3. Main body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Portfolio table (fixed width) */}
        <div className="w-[420px] shrink-0 border-r border-[#1e2d4a] flex flex-col overflow-hidden bg-[#0a0e1a]">
          <div className="px-3 py-2 border-b border-[#1e2d4a] shrink-0">
            <span className="text-[9px] font-bold tracking-[0.2em] text-[#3b7dd8] uppercase">
              Portafoglio
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <PortfolioTable
              stocks={portfolioStocks}
              selectedSymbol={selectedSymbol}
              onSelect={setSelected}
            />
          </div>
        </div>

        {/* Right: Chart + bottom strip */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* TradingView chart (flex-1) */}
          <div className="flex-1 overflow-hidden">
            <TradingViewChart symbol={selectedSymbol} />
          </div>

          {/* Bottom strip: sectors + news */}
          <div className="h-44 flex shrink-0 border-t border-[#1e2d4a] overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <SectorBars sectors={market.sectors} />
            </div>
            <div className="w-80 border-l border-[#1e2d4a] overflow-y-auto bg-[#0c1120]">
              <NewsPanel items={news?.items ?? []} loading={newsLoading} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
