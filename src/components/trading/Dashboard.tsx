'use client'

import { useState, useEffect, useCallback } from 'react'
import type { MarketDataResponse, NewsResponse } from '@/types/trading'
import { MarketStatusBar } from './MarketStatusBar'
import { IndexCards } from './IndexCards'
import { WatchlistTable } from './WatchlistTable'
import { NewsPanel } from './NewsPanel'
import { SectorBars } from './SectorBars'

const REFRESH_INTERVAL = 30_000

export function Dashboard() {
  const [market, setMarket] = useState<MarketDataResponse | null>(null)
  const [news, setNews] = useState<NewsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [newsLoading, setNewsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchMarket = useCallback(async () => {
    try {
      const res = await fetch('/api/market-data', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: MarketDataResponse = await res.json()
      setMarket(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load market data')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/market-data/news', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: NewsResponse = await res.json()
      setNews(data)
    } catch {
      // news failure is non-critical
    } finally {
      setNewsLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([fetchMarket(), fetchNews()])
    setRefreshing(false)
  }, [fetchMarket, fetchNews])

  // Initial load
  useEffect(() => {
    fetchMarket()
    fetchNews()
  }, [fetchMarket, fetchNews])

  // Polling
  useEffect(() => {
    const id = setInterval(() => {
      fetchMarket()
    }, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [fetchMarket])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0e1a]">
        <div className="text-center">
          <div className="text-3xl text-[#3b7dd8] font-bold tracking-widest mb-2">TECH/SEMI</div>
          <div className="text-xs text-[#4a5a7a] tracking-widest">LOADING MARKET DATA…</div>
          <div className="mt-4 flex justify-center gap-1">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="w-1 h-4 bg-[#3b7dd8] rounded-full opacity-0 animate-[pulse_1.2s_ease-in-out_infinite]"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error && !market) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0e1a]">
        <div className="text-center">
          <div className="text-[#ff4d4d] text-sm mb-2">⚠ {error}</div>
          <button
            onClick={fetchMarket}
            className="text-xs text-[#3b7dd8] hover:text-blue-300 underline"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!market) return null

  return (
    <div className="flex flex-col h-screen bg-[#0a0e1a] overflow-hidden">
      {/* Top status bar */}
      <MarketStatusBar
        status={market.marketStatus}
        lastUpdated={market.lastUpdated}
        isLive={market.isLive}
        onRefresh={refresh}
        refreshing={refreshing}
      />

      {/* Index cards row */}
      <IndexCards indices={market.indices} />

      {/* Main content: watchlist + news */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 overflow-hidden">
          <WatchlistTable stocks={market.stocks} />
          <SectorBars sectors={market.sectors} />
        </div>
        <NewsPanel items={news?.items ?? []} loading={newsLoading} />
      </div>
    </div>
  )
}
