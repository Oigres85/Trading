'use client'

import { useState, useEffect, useCallback } from 'react'
import type { MarketDataResponse, NewsResponse } from '@/types/trading'
import { fetchMarketData, fetchNews } from '@/lib/marketFetch'
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

  const loadMarket = useCallback(async () => {
    try {
      const data = await fetchMarketData()
      setMarket(data)
    } catch { /* fallback already handled inside fetchMarketData */ } finally {
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

  useEffect(() => { loadMarket(); loadNews() }, [loadMarket, loadNews])

  useEffect(() => {
    const id = setInterval(loadMarket, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [loadMarket])

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
      <MarketStatusBar
        status={market.marketStatus}
        lastUpdated={market.lastUpdated}
        isLive={market.isLive}
        onRefresh={refresh}
        refreshing={refreshing}
      />
      <IndexCards indices={market.indices} />
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
