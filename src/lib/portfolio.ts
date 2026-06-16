export interface Position {
  symbol: string
  shares: number
  avgCost: number  // USD
  exchange: 'NASDAQ' | 'NYSE'
}

export const PORTFOLIO: Position[] = [
  { symbol: 'NVDA',  shares: 270,  avgCost: 87.17,  exchange: 'NASDAQ' },
  { symbol: 'AMD',   shares: 125,  avgCost: 153.92, exchange: 'NASDAQ' },
  { symbol: 'MU',    shares: 90,   avgCost: 87.63,  exchange: 'NASDAQ' },
  { symbol: 'INTC',  shares: 380,  avgCost: 25.75,  exchange: 'NASDAQ' },
  { symbol: 'TSLA',  shares: 60,   avgCost: 358.22, exchange: 'NASDAQ' },
  { symbol: 'MSTR',  shares: 123,  avgCost: 210.22, exchange: 'NASDAQ' },
  { symbol: 'RGTI',  shares: 515,  avgCost: 27.30,  exchange: 'NASDAQ' },
  { symbol: 'OKLO',  shares: 120,  avgCost: 72.43,  exchange: 'NYSE'   },
  { symbol: 'ARBE',  shares: 1150, avgCost: 3.35,   exchange: 'NASDAQ' },
]

export const PORTFOLIO_SYMBOLS = PORTFOLIO.map(p => p.symbol)
// usato per evidenziare notizie correlate
export const PORTFOLIO_TICKERS_SET = new Set(PORTFOLIO_SYMBOLS)

export function calcPortfolioStats(quotes: Map<string, { price: number; change: number; changePercent: number }>) {
  let costBasis = 0, currentValue = 0, dayPnL = 0
  for (const p of PORTFOLIO) {
    const q = quotes.get(p.symbol)
    const cur = q?.price ?? p.avgCost
    costBasis     += p.shares * p.avgCost
    currentValue  += p.shares * cur
    dayPnL        += p.shares * (q?.change ?? 0)
  }
  return {
    costBasis,
    currentValue,
    totalPnL: currentValue - costBasis,
    totalPnLPct: ((currentValue - costBasis) / costBasis) * 100,
    dayPnL,
    dayPnLPct: (dayPnL / (currentValue - dayPnL)) * 100,
  }
}
