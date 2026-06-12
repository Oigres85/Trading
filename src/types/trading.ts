export interface StockQuote {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
  volume: number
  avgVolume?: number
  marketCap?: number
  pe?: number
  eps?: number
  high52w?: number
  low52w?: number
  open?: number
  previousClose?: number
  dayHigh?: number
  dayLow?: number
  timestamp: number
}

export interface MarketIndex {
  name: string
  symbol: string
  value: number
  change: number
  changePercent: number
}

export interface SectorETF {
  name: string
  symbol: string
  price: number
  change: number
  changePercent: number
  category: 'tech' | 'semi' | 'software' | 'hardware'
}

export interface NewsItem {
  id: string
  title: string
  summary?: string
  url: string
  source: string
  publishedAt: string
  portfolioMention?: boolean
}

export type MarketStatus = 'open' | 'closed' | 'pre-market' | 'after-hours'

export interface MarketDataResponse {
  indices: MarketIndex[]
  stocks: StockQuote[]
  sectors: SectorETF[]
  lastUpdated: string
  marketStatus: MarketStatus
  isLive: boolean
}

export interface NewsResponse {
  items: NewsItem[]
  lastUpdated: string
}
