import { NextResponse } from 'next/server'
import type { MarketDataResponse, StockQuote, MarketIndex, SectorETF, MarketStatus } from '@/types/trading'

export const dynamic = 'force-dynamic'

const INDICES = ['^GSPC', '^NDX', '^SOX', '^VIX']
const INDEX_NAMES: Record<string, string> = {
  '^GSPC': 'S&P 500',
  '^NDX': 'Nasdaq 100',
  '^SOX': 'SOX Index',
  '^VIX': 'VIX',
}

const STOCKS = [
  'NVDA', 'AMD', 'AVGO', 'TSM', 'ASML',
  'QCOM', 'INTC', 'MU', 'ARM', 'AMAT',
  'LRCX', 'KLAC', 'MRVL', 'ON', 'TXN',
  'MCHP', 'AAPL', 'MSFT', 'GOOGL', 'META',
]

const SECTOR_ETFS = [
  { symbol: 'SMH',  name: 'VanEck Semiconductors', category: 'semi' as const },
  { symbol: 'SOXX', name: 'iShares Semiconductors', category: 'semi' as const },
  { symbol: 'XLK',  name: 'SPDR Technology',        category: 'tech' as const },
  { symbol: 'IGV',  name: 'iShares SW & Services',  category: 'software' as const },
  { symbol: 'ARKK', name: 'ARK Innovation',          category: 'tech' as const },
  { symbol: 'QQQ',  name: 'Invesco QQQ',             category: 'tech' as const },
]

const ALL_SYMBOLS = [...INDICES, ...STOCKS, ...SECTOR_ETFS.map(e => e.symbol)]

function getMarketStatus(): MarketStatus {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  const hours = et.getHours()
  const minutes = et.getMinutes()
  const timeDecimal = hours + minutes / 60

  if (day === 0 || day === 6) return 'closed'
  if (timeDecimal >= 4 && timeDecimal < 9.5) return 'pre-market'
  if (timeDecimal >= 9.5 && timeDecimal < 16) return 'open'
  if (timeDecimal >= 16 && timeDecimal < 20) return 'after-hours'
  return 'closed'
}

async function fetchYahooQuotes(symbols: string[]): Promise<Record<string, unknown>[]> {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}&formatted=false&lang=en-US&region=US`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://finance.yahoo.com/',
      'Origin': 'https://finance.yahoo.com',
    },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`)
  const json = await res.json()
  return (json?.quoteResponse?.result ?? []) as Record<string, unknown>[]
}

// Realistic fallback mock data (values as of mid-2025 approximate)
function getMockData(): Record<string, Record<string, unknown>> {
  return {
    '^GSPC': { regularMarketPrice: 5800.12, regularMarketChange: 18.34, regularMarketChangePercent: 0.32, regularMarketVolume: 2100000000, shortName: 'S&P 500', regularMarketTime: Date.now() / 1000 },
    '^NDX':  { regularMarketPrice: 20850.45, regularMarketChange: 102.76, regularMarketChangePercent: 0.50, regularMarketVolume: 890000000, shortName: 'Nasdaq 100', regularMarketTime: Date.now() / 1000 },
    '^SOX':  { regularMarketPrice: 5210.38, regularMarketChange: 87.22, regularMarketChangePercent: 1.70, regularMarketVolume: 320000000, shortName: 'PHLX Semiconductor', regularMarketTime: Date.now() / 1000 },
    '^VIX':  { regularMarketPrice: 13.82, regularMarketChange: -0.45, regularMarketChangePercent: -3.15, regularMarketVolume: 0, shortName: 'CBOE Volatility Index', regularMarketTime: Date.now() / 1000 },
    'NVDA':  { regularMarketPrice: 1087.45, regularMarketChange: 23.12, regularMarketChangePercent: 2.17, regularMarketVolume: 42800000, shortName: 'NVIDIA Corporation', marketCap: 2680000000000, trailingPE: 72.4, fiftyTwoWeekHigh: 1241.00, fiftyTwoWeekLow: 462.00, regularMarketTime: Date.now() / 1000 },
    'AMD':   { regularMarketPrice: 163.78, regularMarketChange: 2.45, regularMarketChangePercent: 1.52, regularMarketVolume: 38200000, shortName: 'Advanced Micro Devices', marketCap: 265000000000, trailingPE: 145.2, fiftyTwoWeekHigh: 227.30, fiftyTwoWeekLow: 122.70, regularMarketTime: Date.now() / 1000 },
    'AVGO':  { regularMarketPrice: 1892.34, regularMarketChange: -12.56, regularMarketChangePercent: -0.66, regularMarketVolume: 5900000, shortName: 'Broadcom Inc.', marketCap: 880000000000, trailingPE: 58.3, fiftyTwoWeekHigh: 2415.00, fiftyTwoWeekLow: 1252.00, regularMarketTime: Date.now() / 1000 },
    'TSM':   { regularMarketPrice: 178.42, regularMarketChange: 3.67, regularMarketChangePercent: 2.10, regularMarketVolume: 18500000, shortName: 'Taiwan Semiconductor', marketCap: 925000000000, trailingPE: 25.8, fiftyTwoWeekHigh: 226.40, fiftyTwoWeekLow: 139.00, regularMarketTime: Date.now() / 1000 },
    'ASML':  { regularMarketPrice: 842.15, regularMarketChange: 18.92, regularMarketChangePercent: 2.30, regularMarketVolume: 1450000, shortName: 'ASML Holding N.V.', marketCap: 332000000000, trailingPE: 38.7, fiftyTwoWeekHigh: 1110.00, fiftyTwoWeekLow: 632.00, regularMarketTime: Date.now() / 1000 },
    'QCOM':  { regularMarketPrice: 187.62, regularMarketChange: 1.23, regularMarketChangePercent: 0.66, regularMarketVolume: 9800000, shortName: 'Qualcomm Inc.', marketCap: 210000000000, trailingPE: 18.4, fiftyTwoWeekHigh: 230.63, fiftyTwoWeekLow: 146.42, regularMarketTime: Date.now() / 1000 },
    'INTC':  { regularMarketPrice: 22.14, regularMarketChange: -0.38, regularMarketChangePercent: -1.69, regularMarketVolume: 56300000, shortName: 'Intel Corporation', marketCap: 94000000000, trailingPE: null, fiftyTwoWeekHigh: 37.55, fiftyTwoWeekLow: 17.67, regularMarketTime: Date.now() / 1000 },
    'MU':    { regularMarketPrice: 117.84, regularMarketChange: 4.21, regularMarketChangePercent: 3.70, regularMarketVolume: 21500000, shortName: 'Micron Technology', marketCap: 130000000000, trailingPE: 31.2, fiftyTwoWeekHigh: 157.54, fiftyTwoWeekLow: 78.64, regularMarketTime: Date.now() / 1000 },
    'ARM':   { regularMarketPrice: 152.37, regularMarketChange: 3.44, regularMarketChangePercent: 2.31, regularMarketVolume: 8700000, shortName: 'Arm Holdings plc', marketCap: 163000000000, trailingPE: 248.0, fiftyTwoWeekHigh: 188.75, fiftyTwoWeekLow: 85.00, regularMarketTime: Date.now() / 1000 },
    'AMAT':  { regularMarketPrice: 213.56, regularMarketChange: 5.12, regularMarketChangePercent: 2.46, regularMarketVolume: 7600000, shortName: 'Applied Materials', marketCap: 182000000000, trailingPE: 26.1, fiftyTwoWeekHigh: 265.09, fiftyTwoWeekLow: 166.49, regularMarketTime: Date.now() / 1000 },
    'LRCX':  { regularMarketPrice: 875.43, regularMarketChange: 12.67, regularMarketChangePercent: 1.47, regularMarketVolume: 1800000, shortName: 'Lam Research Corp.', marketCap: 116000000000, trailingPE: 29.4, fiftyTwoWeekHigh: 1134.45, fiftyTwoWeekLow: 696.45, regularMarketTime: Date.now() / 1000 },
    'KLAC':  { regularMarketPrice: 832.19, regularMarketChange: -5.44, regularMarketChangePercent: -0.65, regularMarketVolume: 1350000, shortName: 'KLA Corporation', marketCap: 113000000000, trailingPE: 27.8, fiftyTwoWeekHigh: 938.53, fiftyTwoWeekLow: 591.05, regularMarketTime: Date.now() / 1000 },
    'MRVL':  { regularMarketPrice: 87.34, regularMarketChange: 2.18, regularMarketChangePercent: 2.56, regularMarketVolume: 22400000, shortName: 'Marvell Technology', marketCap: 75000000000, trailingPE: null, fiftyTwoWeekHigh: 119.68, fiftyTwoWeekLow: 47.51, regularMarketTime: Date.now() / 1000 },
    'ON':    { regularMarketPrice: 63.42, regularMarketChange: -0.87, regularMarketChangePercent: -1.35, regularMarketVolume: 12800000, shortName: 'ON Semiconductor', marketCap: 27700000000, trailingPE: 22.1, fiftyTwoWeekHigh: 82.73, fiftyTwoWeekLow: 56.33, regularMarketTime: Date.now() / 1000 },
    'TXN':   { regularMarketPrice: 194.87, regularMarketChange: -1.23, regularMarketChangePercent: -0.63, regularMarketVolume: 5600000, shortName: 'Texas Instruments', marketCap: 178000000000, trailingPE: 34.5, fiftyTwoWeekHigh: 220.39, fiftyTwoWeekLow: 156.21, regularMarketTime: Date.now() / 1000 },
    'MCHP':  { regularMarketPrice: 77.65, regularMarketChange: 0.45, regularMarketChangePercent: 0.58, regularMarketVolume: 8200000, shortName: 'Microchip Technology', marketCap: 42000000000, trailingPE: 28.3, fiftyTwoWeekHigh: 102.47, fiftyTwoWeekLow: 59.07, regularMarketTime: Date.now() / 1000 },
    'AAPL':  { regularMarketPrice: 215.32, regularMarketChange: -0.68, regularMarketChangePercent: -0.31, regularMarketVolume: 52300000, shortName: 'Apple Inc.', marketCap: 3310000000000, trailingPE: 35.2, fiftyTwoWeekHigh: 260.10, fiftyTwoWeekLow: 164.08, regularMarketTime: Date.now() / 1000 },
    'MSFT':  { regularMarketPrice: 442.57, regularMarketChange: 3.21, regularMarketChangePercent: 0.73, regularMarketVolume: 18700000, shortName: 'Microsoft Corporation', marketCap: 3290000000000, trailingPE: 37.8, fiftyTwoWeekHigh: 468.35, fiftyTwoWeekLow: 344.79, regularMarketTime: Date.now() / 1000 },
    'GOOGL': { regularMarketPrice: 198.47, regularMarketChange: 1.87, regularMarketChangePercent: 0.95, regularMarketVolume: 25100000, shortName: 'Alphabet Inc.', marketCap: 2480000000000, trailingPE: 22.4, fiftyTwoWeekHigh: 207.05, fiftyTwoWeekLow: 142.66, regularMarketTime: Date.now() / 1000 },
    'META':  { regularMarketPrice: 598.34, regularMarketChange: 8.92, regularMarketChangePercent: 1.51, regularMarketVolume: 12600000, shortName: 'Meta Platforms Inc.', marketCap: 1520000000000, trailingPE: 27.9, fiftyTwoWeekHigh: 740.91, fiftyTwoWeekLow: 373.95, regularMarketTime: Date.now() / 1000 },
    'SMH':   { regularMarketPrice: 258.43, regularMarketChange: 5.12, regularMarketChangePercent: 2.02, regularMarketVolume: 5800000, shortName: 'VanEck Semiconductor ETF', regularMarketTime: Date.now() / 1000 },
    'SOXX':  { regularMarketPrice: 224.17, regularMarketChange: 4.23, regularMarketChangePercent: 1.92, regularMarketVolume: 2300000, shortName: 'iShares Semiconductor ETF', regularMarketTime: Date.now() / 1000 },
    'XLK':   { regularMarketPrice: 223.56, regularMarketChange: 1.34, regularMarketChangePercent: 0.60, regularMarketVolume: 7100000, shortName: 'Technology Select Sector SPDR', regularMarketTime: Date.now() / 1000 },
    'IGV':   { regularMarketPrice: 96.82, regularMarketChange: 0.67, regularMarketChangePercent: 0.70, regularMarketVolume: 1900000, shortName: 'iShares Expanded Tech-Software', regularMarketTime: Date.now() / 1000 },
    'ARKK':  { regularMarketPrice: 48.23, regularMarketChange: 0.89, regularMarketChangePercent: 1.88, regularMarketVolume: 14200000, shortName: 'ARK Innovation ETF', regularMarketTime: Date.now() / 1000 },
    'QQQ':   { regularMarketPrice: 490.12, regularMarketChange: 2.78, regularMarketChangePercent: 0.57, regularMarketVolume: 32500000, shortName: 'Invesco QQQ Trust', regularMarketTime: Date.now() / 1000 },
  }
}

function mapQuote(raw: Record<string, unknown>): StockQuote {
  return {
    symbol: String(raw.symbol ?? ''),
    name: String(raw.shortName ?? raw.longName ?? raw.symbol ?? ''),
    price: Number(raw.regularMarketPrice ?? 0),
    change: Number(raw.regularMarketChange ?? 0),
    changePercent: Number(raw.regularMarketChangePercent ?? 0),
    volume: Number(raw.regularMarketVolume ?? 0),
    avgVolume: raw.averageDailyVolume3Month ? Number(raw.averageDailyVolume3Month) : undefined,
    marketCap: raw.marketCap ? Number(raw.marketCap) : undefined,
    pe: raw.trailingPE ? Number(raw.trailingPE) : undefined,
    eps: raw.epsTrailingTwelveMonths ? Number(raw.epsTrailingTwelveMonths) : undefined,
    high52w: raw.fiftyTwoWeekHigh ? Number(raw.fiftyTwoWeekHigh) : undefined,
    low52w: raw.fiftyTwoWeekLow ? Number(raw.fiftyTwoWeekLow) : undefined,
    open: raw.regularMarketOpen ? Number(raw.regularMarketOpen) : undefined,
    previousClose: raw.regularMarketPreviousClose ? Number(raw.regularMarketPreviousClose) : undefined,
    dayHigh: raw.regularMarketDayHigh ? Number(raw.regularMarketDayHigh) : undefined,
    dayLow: raw.regularMarketDayLow ? Number(raw.regularMarketDayLow) : undefined,
    timestamp: Number(raw.regularMarketTime ?? Date.now() / 1000),
  }
}

export async function GET() {
  const marketStatus = getMarketStatus()
  let rawMap: Record<string, Record<string, unknown>> = {}
  let isLive = false

  try {
    const results = await fetchYahooQuotes(ALL_SYMBOLS)
    if (results.length > 0) {
      results.forEach((r) => {
        rawMap[String(r.symbol)] = r
      })
      isLive = true
    } else {
      rawMap = getMockData()
    }
  } catch {
    rawMap = getMockData()
  }

  const indices: MarketIndex[] = INDICES.map((sym) => {
    const r = rawMap[sym] ?? {}
    return {
      name: INDEX_NAMES[sym] ?? sym,
      symbol: sym,
      value: Number(r.regularMarketPrice ?? 0),
      change: Number(r.regularMarketChange ?? 0),
      changePercent: Number(r.regularMarketChangePercent ?? 0),
    }
  })

  const stocks: StockQuote[] = STOCKS.map((sym) => mapQuote({ symbol: sym, ...(rawMap[sym] ?? {}) }))

  const sectors: SectorETF[] = SECTOR_ETFS.map((etf) => {
    const r = rawMap[etf.symbol] ?? {}
    return {
      ...etf,
      price: Number(r.regularMarketPrice ?? 0),
      change: Number(r.regularMarketChange ?? 0),
      changePercent: Number(r.regularMarketChangePercent ?? 0),
    }
  })

  const response: MarketDataResponse = {
    indices,
    stocks,
    sectors,
    lastUpdated: new Date().toISOString(),
    marketStatus,
    isLive,
  }

  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}
