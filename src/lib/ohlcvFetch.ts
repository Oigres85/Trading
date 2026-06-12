// OHLCV data fetching from Yahoo Finance via CORS proxy chain + RSI/MACD indicators

export type TimeRange = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y'

export interface OHLCVBar {
  time: number   // unix seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface RSIPoint {
  time: number
  value: number
}

export interface MACDPoint {
  time: number
  macd: number
  signal: number
  histogram: number
}

// ─── Interval mapping ─────────────────────────────────────────────────────────

const INTERVAL_MAP: Record<TimeRange, string> = {
  '1d':  '2m',
  '5d':  '30m',
  '1mo': '1d',
  '3mo': '1d',
  '6mo': '1d',
  '1y':  '1wk',
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function tryFetch(url: string, timeout: number): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res
}

// ─── Public: fetchOHLCV ───────────────────────────────────────────────────────

export async function fetchOHLCV(symbol: string, range: TimeRange): Promise<OHLCVBar[]> {
  const interval = INTERVAL_MAP[range]
  const base = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`

  const attempts: Array<() => Promise<Response>> = [
    () => tryFetch(base, 5000),
    () => tryFetch(`https://corsproxy.io/?${encodeURIComponent(base)}`, 8000),
    () => tryFetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(base)}`, 8000),
  ]

  let json: unknown = null

  for (const attempt of attempts) {
    try {
      const res = await attempt()
      json = await res.json()
      break
    } catch {
      // try next proxy
    }
  }

  if (!json) return []

  try {
    const j = json as Record<string, unknown>
    const chart = j.chart as Record<string, unknown>
    const result = (chart.result as unknown[])[0] as Record<string, unknown>
    const timestamps = result.timestamp as number[]
    const quote = (result.indicators as Record<string, unknown>).quote as Record<string, number[]>[]
    const q = quote[0]

    const bars: OHLCVBar[] = []
    for (let i = 0; i < timestamps.length; i++) {
      const o = q.open[i]
      const h = q.high[i]
      const l = q.low[i]
      const c = q.close[i]
      const v = q.volume[i]
      if (o == null || c == null || isNaN(o) || isNaN(c)) continue
      bars.push({
        time:   timestamps[i],
        open:   o,
        high:   h ?? o,
        low:    l ?? o,
        close:  c,
        volume: v ?? 0,
      })
    }
    return bars
  } catch {
    return []
  }
}

// ─── RSI (Wilder's smoothing, period=14) ─────────────────────────────────────

export function calcRSI(bars: OHLCVBar[], period = 14): RSIPoint[] {
  if (bars.length < period + 1) return []

  const closes = bars.map(b => b.close)
  const points: RSIPoint[] = []

  // Initial average gain/loss over first `period` changes
  let avgGain = 0
  let avgLoss = 0

  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1]
    if (delta > 0) avgGain += delta
    else avgLoss += Math.abs(delta)
  }

  avgGain /= period
  avgLoss /= period

  const rsi0 = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  points.push({ time: bars[period].time, value: rsi0 })

  // Wilder's smoothing for subsequent bars
  for (let i = period + 1; i < bars.length; i++) {
    const delta = closes[i] - closes[i - 1]
    const gain  = delta > 0 ? delta : 0
    const loss  = delta < 0 ? Math.abs(delta) : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    const rs  = avgLoss === 0 ? Infinity : avgGain / avgLoss
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs)
    points.push({ time: bars[i].time, value: rsi })
  }

  return points
}

// ─── EMA helper ───────────────────────────────────────────────────────────────

function calcEMA(values: number[], period: number): number[] {
  if (values.length < period) return []
  const k = 2 / (period + 1)
  const result: number[] = new Array(values.length - period).fill(0)

  // Seed with simple moving average
  let seed = 0
  for (let i = 0; i < period; i++) seed += values[i]
  seed /= period

  result[0] = seed
  for (let i = 1; i < result.length; i++) {
    result[i] = values[period + i - 1] * k + result[i - 1] * (1 - k)
  }
  return result
}

// ─── MACD (12, 26, 9) ────────────────────────────────────────────────────────

export function calcMACD(
  bars: OHLCVBar[],
  fast   = 12,
  slow   = 26,
  signal = 9,
): MACDPoint[] {
  if (bars.length < slow + signal) return []

  const closes = bars.map(b => b.close)

  const ema12 = calcEMA(closes, fast)
  const ema26 = calcEMA(closes, slow)

  // ema12 has closes.length - fast  entries, starting at index fast-1
  // ema26 has closes.length - slow  entries, starting at index slow-1
  // We need to align them: ema26[i] aligns with bar index slow-1+i
  // ema12[i] aligns with bar index fast-1+i
  // offset: ema26[i] == ema12[i + (slow - fast)]

  const offset = slow - fast
  const macdLine: number[] = []
  const macdTimes: number[] = []

  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + offset] - ema26[i])
    macdTimes.push(bars[slow - 1 + i].time)
  }

  const signalLine = calcEMA(macdLine, signal)

  // signalLine[i] aligns with macdLine[signal-1+i]
  const points: MACDPoint[] = []
  for (let i = 0; i < signalLine.length; i++) {
    const macdVal = macdLine[signal - 1 + i]
    const sigVal  = signalLine[i]
    points.push({
      time:      macdTimes[signal - 1 + i],
      macd:      macdVal,
      signal:    sigVal,
      histogram: macdVal - sigVal,
    })
  }

  return points
}
