import type {
  MarketDataResponse,
  NewsResponse,
  StockQuote,
  MarketIndex,
  SectorETF,
  NewsItem,
  MarketStatus,
} from '@/types/trading'

// ─── Config ──────────────────────────────────────────────────────────────────

const INDICES = ['^GSPC', '^NDX', '^SOX', '^VIX', 'USDJPY=X']
const INDEX_NAMES: Record<string, string> = {
  '^GSPC': 'S&P 500',
  '^NDX': 'Nasdaq 100',
  '^SOX': 'SOX Index',
  '^VIX': 'VIX',
  'USDJPY=X': 'USD/JPY',
}
const STOCKS = [
  'NVDA','AMD','AVGO','TSM','ASML','QCOM','INTC','MU','ARM','AMAT',
  'LRCX','KLAC','MRVL','ON','TXN','MCHP','AAPL','MSFT','GOOGL','META',
  'TSLA','MSTR','RGTI','OKLO','ARBE',
]
const SECTOR_ETFS = [
  { symbol: 'SMH',  name: 'VanEck Semiconductors',   category: 'semi' as const },
  { symbol: 'SOXX', name: 'iShares Semiconductors',   category: 'semi' as const },
  { symbol: 'XLK',  name: 'SPDR Technology',          category: 'tech' as const },
  { symbol: 'IGV',  name: 'iShares SW & Services',    category: 'software' as const },
  { symbol: 'ARKK', name: 'ARK Innovation',            category: 'tech' as const },
  { symbol: 'QQQ',  name: 'Invesco QQQ',               category: 'tech' as const },
]
const ALL_SYMBOLS = [...INDICES, ...STOCKS, ...SECTOR_ETFS.map(e => e.symbol)]

// ─── Market status ────────────────────────────────────────────────────────────

function getMarketStatus(): MarketStatus {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  const t = et.getHours() + et.getMinutes() / 60
  if (day === 0 || day === 6) return 'closed'
  if (t >= 4 && t < 9.5)  return 'pre-market'
  if (t >= 9.5 && t < 16) return 'open'
  if (t >= 16 && t < 20)  return 'after-hours'
  return 'closed'
}

// ─── Yahoo Finance fetch (CORS proxy chain) ───────────────────────────────────

async function yahooFetch(symbols: string[]): Promise<Record<string, unknown>[]> {
  const qs = symbols.join(',')
  const base = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${qs}&formatted=false&lang=en-US&region=US`

  const attempts = [
    () => fetch(base, { signal: AbortSignal.timeout(5000) }),
    () => fetch(`https://corsproxy.io/?${encodeURIComponent(base)}`, { signal: AbortSignal.timeout(8000) }),
    () => fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(base)}`, { signal: AbortSignal.timeout(8000) }),
  ]

  for (const attempt of attempts) {
    try {
      const res = await attempt()
      if (!res.ok) continue
      const json = await res.json()
      const results = json?.quoteResponse?.result
      if (Array.isArray(results) && results.length > 0) return results
    } catch { /* next proxy */ }
  }
  return []
}

// ─── Mock fallback ────────────────────────────────────────────────────────────

function getMock(): Record<string, Record<string, unknown>> {
  const ts = Date.now() / 1000
  return {
    '^GSPC': { regularMarketPrice:5800.12, regularMarketChange:18.34,  regularMarketChangePercent:0.32,  regularMarketVolume:2100000000, shortName:'S&P 500',              regularMarketTime:ts },
    '^NDX':  { regularMarketPrice:20850.4, regularMarketChange:102.76, regularMarketChangePercent:0.50,  regularMarketVolume:890000000,  shortName:'Nasdaq 100',            regularMarketTime:ts },
    '^SOX':  { regularMarketPrice:5210.38, regularMarketChange:87.22,  regularMarketChangePercent:1.70,  regularMarketVolume:320000000,  shortName:'PHLX Semiconductor',    regularMarketTime:ts },
    '^VIX':  { regularMarketPrice:13.82,   regularMarketChange:-0.45,  regularMarketChangePercent:-3.15, regularMarketVolume:0,          shortName:'CBOE Volatility Index', regularMarketTime:ts },
    'USDJPY=X': { regularMarketPrice:157.342, regularMarketChange:0.215, regularMarketChangePercent:0.137, regularMarketVolume:0, shortName:'USD/JPY', regularMarketTime:ts },
    'NVDA':  { regularMarketPrice:1087.45, regularMarketChange:23.12,  regularMarketChangePercent:2.17,  regularMarketVolume:42800000, shortName:'NVIDIA Corporation',      marketCap:2.68e12,  trailingPE:72.4,  fiftyTwoWeekHigh:1241, fiftyTwoWeekLow:462,  regularMarketTime:ts },
    'AMD':   { regularMarketPrice:163.78,  regularMarketChange:2.45,   regularMarketChangePercent:1.52,  regularMarketVolume:38200000, shortName:'Advanced Micro Devices',  marketCap:2.65e11,  trailingPE:145.2, fiftyTwoWeekHigh:227.3,fiftyTwoWeekLow:122.7,regularMarketTime:ts },
    'AVGO':  { regularMarketPrice:1892.34, regularMarketChange:-12.56, regularMarketChangePercent:-0.66, regularMarketVolume:5900000,  shortName:'Broadcom Inc.',           marketCap:8.8e11,   trailingPE:58.3,  fiftyTwoWeekHigh:2415, fiftyTwoWeekLow:1252, regularMarketTime:ts },
    'TSM':   { regularMarketPrice:178.42,  regularMarketChange:3.67,   regularMarketChangePercent:2.10,  regularMarketVolume:18500000, shortName:'Taiwan Semiconductor',    marketCap:9.25e11,  trailingPE:25.8,  fiftyTwoWeekHigh:226.4,fiftyTwoWeekLow:139,  regularMarketTime:ts },
    'ASML':  { regularMarketPrice:842.15,  regularMarketChange:18.92,  regularMarketChangePercent:2.30,  regularMarketVolume:1450000,  shortName:'ASML Holding N.V.',       marketCap:3.32e11,  trailingPE:38.7,  fiftyTwoWeekHigh:1110, fiftyTwoWeekLow:632,  regularMarketTime:ts },
    'QCOM':  { regularMarketPrice:187.62,  regularMarketChange:1.23,   regularMarketChangePercent:0.66,  regularMarketVolume:9800000,  shortName:'Qualcomm Inc.',           marketCap:2.1e11,   trailingPE:18.4,  fiftyTwoWeekHigh:230.6,fiftyTwoWeekLow:146.4,regularMarketTime:ts },
    'INTC':  { regularMarketPrice:22.14,   regularMarketChange:-0.38,  regularMarketChangePercent:-1.69, regularMarketVolume:56300000, shortName:'Intel Corporation',       marketCap:9.4e10,   trailingPE:null,  fiftyTwoWeekHigh:37.55,fiftyTwoWeekLow:17.67,regularMarketTime:ts },
    'MU':    { regularMarketPrice:117.84,  regularMarketChange:4.21,   regularMarketChangePercent:3.70,  regularMarketVolume:21500000, shortName:'Micron Technology',       marketCap:1.3e11,   trailingPE:31.2,  fiftyTwoWeekHigh:157.5,fiftyTwoWeekLow:78.64,regularMarketTime:ts },
    'ARM':   { regularMarketPrice:152.37,  regularMarketChange:3.44,   regularMarketChangePercent:2.31,  regularMarketVolume:8700000,  shortName:'Arm Holdings plc',        marketCap:1.63e11,  trailingPE:248,   fiftyTwoWeekHigh:188.7,fiftyTwoWeekLow:85,   regularMarketTime:ts },
    'AMAT':  { regularMarketPrice:213.56,  regularMarketChange:5.12,   regularMarketChangePercent:2.46,  regularMarketVolume:7600000,  shortName:'Applied Materials',       marketCap:1.82e11,  trailingPE:26.1,  fiftyTwoWeekHigh:265.1,fiftyTwoWeekLow:166.5,regularMarketTime:ts },
    'LRCX':  { regularMarketPrice:875.43,  regularMarketChange:12.67,  regularMarketChangePercent:1.47,  regularMarketVolume:1800000,  shortName:'Lam Research Corp.',      marketCap:1.16e11,  trailingPE:29.4,  fiftyTwoWeekHigh:1134, fiftyTwoWeekLow:696,  regularMarketTime:ts },
    'KLAC':  { regularMarketPrice:832.19,  regularMarketChange:-5.44,  regularMarketChangePercent:-0.65, regularMarketVolume:1350000,  shortName:'KLA Corporation',         marketCap:1.13e11,  trailingPE:27.8,  fiftyTwoWeekHigh:938.5,fiftyTwoWeekLow:591,  regularMarketTime:ts },
    'MRVL':  { regularMarketPrice:87.34,   regularMarketChange:2.18,   regularMarketChangePercent:2.56,  regularMarketVolume:22400000, shortName:'Marvell Technology',      marketCap:7.5e10,   trailingPE:null,  fiftyTwoWeekHigh:119.7,fiftyTwoWeekLow:47.51,regularMarketTime:ts },
    'ON':    { regularMarketPrice:63.42,   regularMarketChange:-0.87,  regularMarketChangePercent:-1.35, regularMarketVolume:12800000, shortName:'ON Semiconductor',        marketCap:2.77e10,  trailingPE:22.1,  fiftyTwoWeekHigh:82.73,fiftyTwoWeekLow:56.33,regularMarketTime:ts },
    'TXN':   { regularMarketPrice:194.87,  regularMarketChange:-1.23,  regularMarketChangePercent:-0.63, regularMarketVolume:5600000,  shortName:'Texas Instruments',       marketCap:1.78e11,  trailingPE:34.5,  fiftyTwoWeekHigh:220.4,fiftyTwoWeekLow:156.2,regularMarketTime:ts },
    'MCHP':  { regularMarketPrice:77.65,   regularMarketChange:0.45,   regularMarketChangePercent:0.58,  regularMarketVolume:8200000,  shortName:'Microchip Technology',    marketCap:4.2e10,   trailingPE:28.3,  fiftyTwoWeekHigh:102.5,fiftyTwoWeekLow:59.07,regularMarketTime:ts },
    'AAPL':  { regularMarketPrice:215.32,  regularMarketChange:-0.68,  regularMarketChangePercent:-0.31, regularMarketVolume:52300000, shortName:'Apple Inc.',              marketCap:3.31e12,  trailingPE:35.2,  fiftyTwoWeekHigh:260.1,fiftyTwoWeekLow:164.1,regularMarketTime:ts },
    'MSFT':  { regularMarketPrice:442.57,  regularMarketChange:3.21,   regularMarketChangePercent:0.73,  regularMarketVolume:18700000, shortName:'Microsoft Corporation',   marketCap:3.29e12,  trailingPE:37.8,  fiftyTwoWeekHigh:468.3,fiftyTwoWeekLow:344.8,regularMarketTime:ts },
    'GOOGL': { regularMarketPrice:198.47,  regularMarketChange:1.87,   regularMarketChangePercent:0.95,  regularMarketVolume:25100000, shortName:'Alphabet Inc.',           marketCap:2.48e12,  trailingPE:22.4,  fiftyTwoWeekHigh:207,  fiftyTwoWeekLow:142.7,regularMarketTime:ts },
    'META':  { regularMarketPrice:598.34,  regularMarketChange:8.92,   regularMarketChangePercent:1.51,  regularMarketVolume:12600000, shortName:'Meta Platforms Inc.',     marketCap:1.52e12,  trailingPE:27.9,  fiftyTwoWeekHigh:740.9,fiftyTwoWeekLow:373.9,regularMarketTime:ts },
    'TSLA':  { regularMarketPrice:248.50,  regularMarketChange:-3.72,  regularMarketChangePercent:-1.47, regularMarketVolume:87200000, shortName:'Tesla Inc.',              marketCap:7.93e11,  trailingPE:62.1,  fiftyTwoWeekHigh:488.5,fiftyTwoWeekLow:138.8,regularMarketTime:ts },
    'MSTR':  { regularMarketPrice:385.40,  regularMarketChange:12.45,  regularMarketChangePercent:3.34,  regularMarketVolume:9400000,  shortName:'MicroStrategy Inc.',      marketCap:7.8e10,   trailingPE:null,  fiftyTwoWeekHigh:473.8,fiftyTwoWeekLow:107.4,regularMarketTime:ts },
    'RGTI':  { regularMarketPrice:14.82,   regularMarketChange:-0.63,  regularMarketChangePercent:-4.08, regularMarketVolume:42100000, shortName:'Rigetti Computing Inc.',  marketCap:2.5e9,    trailingPE:null,  fiftyTwoWeekHigh:21.95,fiftyTwoWeekLow:0.925,regularMarketTime:ts },
    'OKLO':  { regularMarketPrice:55.12,   regularMarketChange:1.87,   regularMarketChangePercent:3.51,  regularMarketVolume:3600000,  shortName:'Oklo Inc.',               marketCap:5.1e9,    trailingPE:null,  fiftyTwoWeekHigh:56.80,fiftyTwoWeekLow:5.28, regularMarketTime:ts },
    'ARBE':  { regularMarketPrice:2.87,    regularMarketChange:-0.08,  regularMarketChangePercent:-2.71, regularMarketVolume:820000,   shortName:'Arbe Robotics Ltd.',      marketCap:2.8e8,    trailingPE:null,  fiftyTwoWeekHigh:5.79, fiftyTwoWeekLow:1.60, regularMarketTime:ts },
    'SMH':   { regularMarketPrice:258.43,  regularMarketChange:5.12,   regularMarketChangePercent:2.02,  regularMarketVolume:5800000,  shortName:'VanEck Semiconductor ETF',regularMarketTime:ts },
    'SOXX':  { regularMarketPrice:224.17,  regularMarketChange:4.23,   regularMarketChangePercent:1.92,  regularMarketVolume:2300000,  shortName:'iShares Semiconductor ETF',regularMarketTime:ts },
    'XLK':   { regularMarketPrice:223.56,  regularMarketChange:1.34,   regularMarketChangePercent:0.60,  regularMarketVolume:7100000,  shortName:'Technology Select Sector SPDR',regularMarketTime:ts },
    'IGV':   { regularMarketPrice:96.82,   regularMarketChange:0.67,   regularMarketChangePercent:0.70,  regularMarketVolume:1900000,  shortName:'iShares Expanded Tech-Software',regularMarketTime:ts },
    'ARKK':  { regularMarketPrice:48.23,   regularMarketChange:0.89,   regularMarketChangePercent:1.88,  regularMarketVolume:14200000, shortName:'ARK Innovation ETF',      regularMarketTime:ts },
    'QQQ':   { regularMarketPrice:490.12,  regularMarketChange:2.78,   regularMarketChangePercent:0.57,  regularMarketVolume:32500000, shortName:'Invesco QQQ Trust',       regularMarketTime:ts },
  }
}

// ─── Transform ────────────────────────────────────────────────────────────────

function mapQuote(raw: Record<string, unknown>): StockQuote {
  return {
    symbol:        String(raw.symbol ?? ''),
    name:          String(raw.shortName ?? raw.longName ?? raw.symbol ?? ''),
    price:         Number(raw.regularMarketPrice ?? 0),
    change:        Number(raw.regularMarketChange ?? 0),
    changePercent: Number(raw.regularMarketChangePercent ?? 0),
    volume:        Number(raw.regularMarketVolume ?? 0),
    avgVolume:     raw.averageDailyVolume3Month ? Number(raw.averageDailyVolume3Month) : undefined,
    marketCap:     raw.marketCap  ? Number(raw.marketCap)  : undefined,
    pe:            raw.trailingPE ? Number(raw.trailingPE) : undefined,
    high52w:       raw.fiftyTwoWeekHigh ? Number(raw.fiftyTwoWeekHigh) : undefined,
    low52w:        raw.fiftyTwoWeekLow  ? Number(raw.fiftyTwoWeekLow)  : undefined,
    timestamp:     Number(raw.regularMarketTime ?? Date.now() / 1000),
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchMarketData(): Promise<MarketDataResponse> {
  let rawArr: Record<string, unknown>[] = []
  let isLive = false

  rawArr = await yahooFetch(ALL_SYMBOLS)
  if (rawArr.length > 0) isLive = true

  const rawMap: Record<string, Record<string, unknown>> =
    rawArr.length > 0
      ? Object.fromEntries(rawArr.map(r => [String(r.symbol), r]))
      : getMock()

  const indices: MarketIndex[] = INDICES.map(sym => ({
    name:          INDEX_NAMES[sym] ?? sym,
    symbol:        sym,
    value:         Number(rawMap[sym]?.regularMarketPrice ?? 0),
    change:        Number(rawMap[sym]?.regularMarketChange ?? 0),
    changePercent: Number(rawMap[sym]?.regularMarketChangePercent ?? 0),
  }))

  const stocks: StockQuote[] = STOCKS.map(sym => mapQuote({ symbol: sym, ...(rawMap[sym] ?? {}) }))

  const sectors: SectorETF[] = SECTOR_ETFS.map(etf => ({
    ...etf,
    price:         Number(rawMap[etf.symbol]?.regularMarketPrice ?? 0),
    change:        Number(rawMap[etf.symbol]?.regularMarketChange ?? 0),
    changePercent: Number(rawMap[etf.symbol]?.regularMarketChangePercent ?? 0),
  }))

  return { indices, stocks, sectors, lastUpdated: new Date().toISOString(), marketStatus: getMarketStatus(), isLive }
}

// ─── Fear & Greed ─────────────────────────────────────────────────────────────

export interface FearGreed {
  value: number
  classification: string
}

export async function fetchFearGreed(): Promise<FearGreed | null> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const d = json?.data?.[0]
    if (!d) return null
    return { value: parseInt(d.value, 10), classification: String(d.value_classification) }
  } catch { return null }
}

// ─── News ─────────────────────────────────────────────────────────────────────

const FALLBACK_NEWS: NewsItem[] = [
  { id:'f1', title:'NVIDIA registra ricavi record nel data center con la domanda di chip AI in accelerazione', url:'https://it.finance.yahoo.com', source:'Il Sole 24 Ore', publishedAt: new Date(Date.now()-2*3600000).toISOString() },
  { id:'f2', title:'TSMC alza le stime di capex: ordini per nodi avanzati in forte crescita',                  url:'https://it.finance.yahoo.com', source:'MilanoFinanza',  publishedAt: new Date(Date.now()-4*3600000).toISOString() },
  { id:'f3', title:'ASML: ordini record per strumenti EUV dai produttori asiatici di chip',                   url:'https://it.finance.yahoo.com', source:'Corriere Economia', publishedAt: new Date(Date.now()-6*3600000).toISOString() },
  { id:'f4', title:'AMD espande la linea AI Accelerator con la nuova serie Instinct MI350',                    url:'https://it.finance.yahoo.com', source:'Il Sole 24 Ore', publishedAt: new Date(Date.now()-8*3600000).toISOString() },
  { id:'f5', title:'Micron Technology: contratti NAND flash a 12 mesi a prezzi premium',                      url:'https://it.finance.yahoo.com', source:'Reuters Italia',  publishedAt: new Date(Date.now()-10*3600000).toISOString() },
  { id:'f6', title:'Broadcom: ricavi ASIC personalizzati verso i 15 miliardi con la diversificazione hyperscaler', url:'https://it.finance.yahoo.com', source:'Bloomberg IT', publishedAt: new Date(Date.now()-12*3600000).toISOString() },
  { id:'f7', title:'Indice SOX dei semiconduttori supera il mercato più ampio da inizio anno',                 url:'https://it.finance.yahoo.com', source:'MilanoFinanza',  publishedAt: new Date(Date.now()-14*3600000).toISOString() },
  { id:'f8', title:'Arm Holdings guadagna quote nel mercato CPU data center con la piattaforma Neoverse',     url:'https://it.finance.yahoo.com', source:'Il Sole 24 Ore', publishedAt: new Date(Date.now()-18*3600000).toISOString() },
  { id:'f9', title:'Intelligenza artificiale: i chip grafici NVIDIA trainano la crescita del settore tech',    url:'https://it.finance.yahoo.com', source:'Corriere Economia', publishedAt: new Date(Date.now()-22*3600000).toISOString() },
  { id:'f10',title:'Semiconduttori: l\'indice SOXX segna nuovi massimi, AMAT e LRCX in primo piano',          url:'https://it.finance.yahoo.com', source:'Il Sole 24 Ore', publishedAt: new Date(Date.now()-26*3600000).toISOString() },
]

// Feed RSS italiani in ordine di priorità
const ITALIAN_FEEDS = [
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC Markets' },
  { url: 'https://it.investing.com/rss/news.rss',                 source: 'Investing.com IT' },
  { url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html',  source: 'CNBC Tech' },
  { url: 'https://www.ilsole24ore.com/rss/finanza.xml',         source: 'Il Sole 24 Ore' },
  { url: 'https://xml2.corriere.it/rss/economia.xml',           source: 'Corriere Economia' },
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA,AMD,INTC,AVGO,TSM,ASML,MU,QCOM,AMAT&region=IT&lang=it-IT', source: 'Yahoo Finance IT' },
  { url: 'https://www.borsaitaliana.it/borsa/notizie/wire/rss.xml', source: 'Borsa Italiana' },
]

function mapRssItem(item: Record<string, unknown>, source: string, i: number): NewsItem {
  return {
    id:          String(item.guid ?? item.link ?? i),
    title:       String(item.title ?? '').replace(/<[^>]+>/g, '').trim(),
    summary:     item.description
                   ? String(item.description).replace(/<[^>]+>/g, '').trim().slice(0, 200) || undefined
                   : undefined,
    url:         String(item.link ?? ''),
    source,
    publishedAt: String(item.pubDate ?? item.isoDate ?? new Date().toISOString()),
  }
}

export async function fetchNews(): Promise<NewsResponse> {
  const items: NewsItem[] = []

  for (const feed of ITALIAN_FEEDS) {
    try {
      const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}&count=20`
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) continue
      const data = await res.json()
      if (data.status !== 'ok' || !Array.isArray(data.items)) continue

      const rawMapped = (data.items as Record<string, unknown>[])
        .map((item, i) => mapRssItem(item, feed.source, i))
        .filter(n => n.title && n.url)

      // Dopo la .filter() dei news items, aggiungi campo portfolioMention
      const mapped = rawMapped.map(n => ({
        ...n,
        portfolioMention: ['NVDA','AMD','MU','INTC','TSLA','MSTR','RGTI','OKLO','ARBE']
          .some(t => n.title.toUpperCase().includes(t)),
      }))

      items.push(...mapped)
    } catch { /* prova il feed successivo */ }
  }

  if (items.length === 0) {
    return { items: FALLBACK_NEWS, lastUpdated: new Date().toISOString() }
  }

  // Ordina per data desc e deduplica
  items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
  const seen = new Set<string>()
  const deduped = items.filter(item => {
    const key = item.title.slice(0, 60).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 40)

  return { items: deduped, lastUpdated: new Date().toISOString() }
}
