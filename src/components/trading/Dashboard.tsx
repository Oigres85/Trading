'use client'

import { useState, useEffect, useCallback } from 'react'
import type { MarketDataResponse, NewsResponse, StockQuote } from '@/types/trading'
import { fetchMarketData, fetchNews } from '@/lib/marketFetch'
import { MarketStatusBar } from './MarketStatusBar'
import { MacroBar } from './MacroBar'
import { WatchlistPanel } from './WatchlistPanel'
import { PriceChart } from './PriceChart'
import { SectorBars } from './SectorBars'
import { NewsPanel } from './NewsPanel'

// Re-export for convenience so consumers can import from one place
export { MarketStatusBar, MacroBar, WatchlistPanel, PriceChart, SectorBars, NewsPanel }

const REFRESH_INTERVAL = 30_000
const STORAGE_KEY      = 'td-watchlist'
const DEFAULT_WATCHLIST = [
  'NVDA','AMD','AVGO','TSM','ASML','QCOM','INTC','MU','ARM','AMAT',
  'LRCX','KLAC','MRVL','ON','TXN','MCHP','AAPL','MSFT','GOOGL','META',
]

function loadStoredWatchlist(): string[] {
  if (typeof window === 'undefined') return DEFAULT_WATCHLIST
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as string[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* ignore */ }
  return DEFAULT_WATCHLIST
}

// Placeholder quote for symbols not yet in the market response
const EMPTY_QUOTE: Omit<StockQuote, 'symbol' | 'name'> = {
  price: 0,
  change: 0,
  changePercent: 0,
  volume: 0,
  timestamp: 0,
}

export function Dashboard() {
  const [market,      setMarket]      = useState<MarketDataResponse | null>(null)
  const [news,        setNews]        = useState<NewsResponse | null>(null)
  const [watchlist,   setWatchlist]   = useState<string[]>(loadStoredWatchlist)
  const [selectedSymbol, setSelected] = useState<string>('NVDA')
  const [loading,     setLoading]     = useState(true)
  const [newsLoading, setNewsLoading] = useState(true)
  const [refreshing,  setRefreshing]  = useState(false)

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

  // Re-fetch market data when watchlist changes (user added a symbol)
  const [prevWatchlistLen, setPrevWatchlistLen] = useState(watchlist.length)
  useEffect(() => {
    if (watchlist.length !== prevWatchlistLen) {
      setPrevWatchlistLen(watchlist.length)
      loadMarket()
    }
  }, [watchlist, prevWatchlistLen, loadMarket])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleWatchlistChange(symbols: string[]) {
    setWatchlist(symbols)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols)) } catch { /* ignore */ }
  }

  // ── Derived data ──────────────────────────────────────────────────────────────

  // Build a combined quotes list: market.stocks + any watchlist symbols not yet fetched
  const stockMap = new Map<string, StockQuote>(
    (market?.stocks ?? []).map(s => [s.symbol, s])
  )

  // Ensure every watchlist symbol has at least a placeholder quote
  const combinedQuotes: StockQuote[] = watchlist.map(sym =>
    stockMap.get(sym) ?? { symbol: sym, name: sym, ...EMPTY_QUOTE }
  )

  // Selected stock quote for PriceChart props
  const selectedQuote: StockQuote = stockMap.get(selectedSymbol) ?? {
    symbol: selectedSymbol,
    name:   selectedSymbol,
    ...EMPTY_QUOTE,
  }

  // ── Loading screen ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0e1a]">
        <div className="text-center">
          <div className="text-3xl font-bold tracking-widest text-[#3b7dd8] mb-2">TECH/SEMI</div>
          <div className="text-xs text-[#4a5a7a] tracking-widest">LOADING MARKET DATA…</div>
        </div>
      </div>
    )
  }

  if (!market) return null

  return (
    <div className="flex flex-col h-screen bg-[#0a0e1a] overflow-hidden">
      {/* Top header bar */}
      <MarketStatusBar
        status={market.marketStatus}
        lastUpdated={market.lastUpdated}
        isLive={market.isLive}
        onRefresh={refresh}
        refreshing={refreshing}
      />

      {/* Macro indices bar */}
      <MacroBar indices={market.indices} />

      {/* Main body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: watchlist */}
        <div className="w-56 shrink-0 border-r border-[#1e2d4a] flex flex-col overflow-hidden">
          <WatchlistPanel
            quotes={combinedQuotes}
            selectedSymbol={selectedSymbol}
            onSelect={setSelected}
            onWatchlistChange={handleWatchlistChange}
          />
        </div>

        {/* Right: chart + bottom strip */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Price chart — takes available space */}
          <div className="flex-1 overflow-hidden">
            <PriceChart
              symbol={selectedSymbol}
              name={selectedQuote.name}
              price={selectedQuote.price}
              change={selectedQuote.change}
              changePercent={selectedQuote.changePercent}
            />
          </div>

          {/* Bottom strip: sectors + news */}
          <div className="h-48 flex border-t border-[#1e2d4a] overflow-hidden shrink-0">
            {/* Sector performance bars */}
            <div className="flex-1 overflow-hidden">
              <SectorBars sectors={market.sectors} />
            </div>

            {/* News panel */}
            <div className="w-80 border-l border-[#1e2d4a] overflow-y-auto bg-[#0c1120]">
              <div className="px-4 py-2 border-b border-[#1e2d4a] flex items-center justify-between shrink-0">
                <span className="text-[9px] font-bold tracking-[0.2em] text-[#3b7dd8] uppercase">
                  Tech / Semi News
                </span>
                {newsLoading && (
                  <span className="text-[9px] text-[#4a5a7a]">Loading…</span>
                )}
              </div>
              <div className="divide-y divide-[#1e2d4a]/60">
                {(news?.items ?? []).length === 0 && !newsLoading && (
                  <p className="px-4 py-4 text-xs text-[#4a5a7a] text-center">No news available</p>
                )}
                {(news?.items ?? []).map(item => {
                  const diff = Date.now() - new Date(item.publishedAt).getTime()
                  const mins = Math.floor(diff / 60000)
                  const ago  = mins < 1 ? 'just now'
                             : mins < 60 ? `${mins}m ago`
                             : mins < 1440 ? `${Math.floor(mins / 60)}h ago`
                             : `${Math.floor(mins / 1440)}d ago`
                  return (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-4 py-2.5 hover:bg-[#0f1629] transition-colors group"
                    >
                      <p className="text-[11px] text-[#c8d6f0] group-hover:text-white leading-4 line-clamp-2 mb-1 transition-colors">
                        {item.title}
                      </p>
                      <div className="flex items-center gap-2 text-[9px] text-[#4a5a7a]">
                        <span className="text-[#3b7dd8]">{item.source}</span>
                        <span>·</span>
                        <span>{ago}</span>
                      </div>
                    </a>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
