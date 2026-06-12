'use client'

import { useRef, useEffect, useState } from 'react'
import { fetchOHLCV, calcRSI, calcMACD } from '@/lib/ohlcvFetch'
import type { TimeRange } from '@/lib/ohlcvFetch'

interface Props {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
}

const TIMEFRAMES: TimeRange[] = ['1d', '5d', '1mo', '3mo', '6mo', '1y']
const TF_LABEL: Record<TimeRange, string> = {
  '1d': '1D', '5d': '5D', '1mo': '1M', '3mo': '3M', '6mo': '6M', '1y': '1Y',
}

const CHART_THEME = {
  textColor: '#6b7fa3',
  grid: {
    vertLines: { color: '#141d2e' },
    horzLines: { color: '#141d2e' },
  },
  priceScale: {
    borderColor: '#1e2d4a',
  },
  timeScale: {
    borderColor: '#1e2d4a',
    timeVisible: true,
    secondsVisible: false,
  },
}

function fmt2(n: number): string {
  return n.toFixed(2)
}

function sign(n: number): string {
  return n >= 0 ? '+' : ''
}

export function PriceChart({ symbol, name, price, change, changePercent }: Props) {
  const [timeframe, setTimeframe] = useState<TimeRange>('1mo')
  const [dataLoading, setDataLoading] = useState(false)

  // Container refs
  const wrapRef  = useRef<HTMLDivElement>(null)
  const mainRef  = useRef<HTMLDivElement>(null)
  const rsiRef   = useRef<HTMLDivElement>(null)
  const macdRef  = useRef<HTMLDivElement>(null)

  // Chart + series refs typed as unknown to avoid importing types at module level
  const mainChartRef   = useRef<unknown>(null)
  const rsiChartRef    = useRef<unknown>(null)
  const macdChartRef   = useRef<unknown>(null)

  // Series refs
  const candleSeriesRef    = useRef<unknown>(null)
  const volSeriesRef       = useRef<unknown>(null)
  const rsiSeriesRef       = useRef<unknown>(null)
  const macdLineRef        = useRef<unknown>(null)
  const macdSignalRef      = useRef<unknown>(null)
  const macdHistRef        = useRef<unknown>(null)

  // Track whether charts are initialized
  const chartsReadyRef = useRef(false)

  // ── Initialize charts once on mount ──────────────────────────────────────────
  useEffect(() => {
    let destroyed = false
    let resizeObs: ResizeObserver | null = null

    ;(async () => {
      const lc = await import('lightweight-charts')
      const { createChart, CandlestickSeries, LineSeries, HistogramSeries, CrosshairMode, ColorType } = lc

      if (destroyed || !mainRef.current || !rsiRef.current || !macdRef.current) return

      const commonLayout = { background: { type: ColorType.Solid, color: '#0a0e1a' }, textColor: '#6b7fa3' }
      const commonOpts = {
        layout: commonLayout,
        grid: CHART_THEME.grid,
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#1e2d4a' },
        timeScale: CHART_THEME.timeScale,
        handleScroll: true,
        handleScale: true,
      }

      // Main chart
      const main = createChart(mainRef.current, {
        ...commonOpts,
        height: mainRef.current.clientHeight || 300,
        width:  mainRef.current.clientWidth  || 600,
      })

      const candle = main.addSeries(CandlestickSeries, {
        upColor:          '#00c875',
        downColor:        '#ff4d4d',
        borderUpColor:    '#00c875',
        borderDownColor:  '#ff4d4d',
        wickUpColor:      '#00c875',
        wickDownColor:    '#ff4d4d',
      })

      const vol = main.addSeries(HistogramSeries, {
        priceScaleId: 'vol',
        priceFormat: { type: 'volume' },
        color: '#3b7dd840',
      })
      main.priceScale('vol').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      })

      // RSI chart
      const rsiChart = createChart(rsiRef.current, {
        ...commonOpts,
        layout: { background: { type: ColorType.Solid, color: '#0a0e1a' }, textColor: '#6b7fa3' },
        height: rsiRef.current.clientHeight || 80,
        width:  rsiRef.current.clientWidth  || 600,
        rightPriceScale: { borderColor: '#1e2d4a', scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { ...CHART_THEME.timeScale, visible: false },
      })

      const rsiSeries = rsiChart.addSeries(LineSeries, {
        color:       '#a78bfa',
        lineWidth:   1,
        priceLineVisible: false,
      })

      rsiSeries.createPriceLine({ price: 70, color: '#ff4d4d', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '70' })
      rsiSeries.createPriceLine({ price: 30, color: '#00c875', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '30' })

      // MACD chart
      const macdChart = createChart(macdRef.current, {
        ...commonOpts,
        layout: { background: { type: ColorType.Solid, color: '#0a0e1a' }, textColor: '#6b7fa3' },
        height: macdRef.current.clientHeight || 80,
        width:  macdRef.current.clientWidth  || 600,
        rightPriceScale: { borderColor: '#1e2d4a', scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { ...CHART_THEME.timeScale, visible: false },
      })

      const macdLine   = macdChart.addSeries(LineSeries, { color: '#3b7dd8', lineWidth: 1, priceLineVisible: false })
      const macdSignal = macdChart.addSeries(LineSeries, { color: '#f97316', lineWidth: 1, priceLineVisible: false })
      const macdHist   = macdChart.addSeries(HistogramSeries, { priceLineVisible: false })

      // Sync time scales: main → rsi and macd
      main.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range) return
        ;(rsiChart.timeScale() as { setVisibleLogicalRange: (r: unknown) => void }).setVisibleLogicalRange(range)
        ;(macdChart.timeScale() as { setVisibleLogicalRange: (r: unknown) => void }).setVisibleLogicalRange(range)
      })

      // Store refs
      mainChartRef.current  = main
      rsiChartRef.current   = rsiChart
      macdChartRef.current  = macdChart
      candleSeriesRef.current  = candle
      volSeriesRef.current     = vol
      rsiSeriesRef.current     = rsiSeries
      macdLineRef.current      = macdLine
      macdSignalRef.current    = macdSignal
      macdHistRef.current      = macdHist
      chartsReadyRef.current   = true

      // ResizeObserver on outer wrapper
      if (wrapRef.current) {
        resizeObs = new ResizeObserver(() => {
          if (!mainRef.current || !rsiRef.current || !macdRef.current) return
          const w = mainRef.current.clientWidth
          ;(main    as { resize: (w: number, h: number) => void }).resize(w, mainRef.current.clientHeight)
          ;(rsiChart  as { resize: (w: number, h: number) => void }).resize(w, rsiRef.current.clientHeight)
          ;(macdChart as { resize: (w: number, h: number) => void }).resize(w, macdRef.current.clientHeight)
        })
        resizeObs.observe(wrapRef.current)
      }
    })()

    return () => {
      destroyed = true
      resizeObs?.disconnect()
      if (mainChartRef.current)  (mainChartRef.current  as { remove: () => void }).remove()
      if (rsiChartRef.current)   (rsiChartRef.current   as { remove: () => void }).remove()
      if (macdChartRef.current)  (macdChartRef.current  as { remove: () => void }).remove()
      mainChartRef.current  = null
      rsiChartRef.current   = null
      macdChartRef.current  = null
      chartsReadyRef.current = false
    }
  }, []) // runs once

  // ── Load data when symbol or timeframe changes ────────────────────────────────
  useEffect(() => {
    if (!chartsReadyRef.current) {
      // Charts may not be ready yet; wait a tick and retry via a small timeout.
      // The retry is handled by the fact that chart init also triggers a re-render
      // indirectly — for safety we poll once.
      const timer = setTimeout(() => {
        if (chartsReadyRef.current) loadData()
      }, 500)
      return () => clearTimeout(timer)
    }

    loadData()

    async function loadData() {
      setDataLoading(true)
      try {
        const bars = await fetchOHLCV(symbol, timeframe)
        if (bars.length === 0) { setDataLoading(false); return }

        const rsiPoints  = calcRSI(bars)
        const macdPoints = calcMACD(bars)

        // Set candlestick data
        if (candleSeriesRef.current) {
          const candleData = bars.map(b => ({
            time: b.time as unknown as import('lightweight-charts').UTCTimestamp,
            open: b.open, high: b.high, low: b.low, close: b.close,
          }))
          ;(candleSeriesRef.current as { setData: (d: unknown) => void }).setData(candleData)
        }

        // Set volume data
        if (volSeriesRef.current) {
          const volData = bars.map(b => ({
            time:  b.time as unknown as import('lightweight-charts').UTCTimestamp,
            value: b.volume,
            color: b.close >= b.open ? '#00c87540' : '#ff4d4d40',
          }))
          ;(volSeriesRef.current as { setData: (d: unknown) => void }).setData(volData)
        }

        // Set RSI data
        if (rsiSeriesRef.current) {
          const rsiData = rsiPoints.map(p => ({
            time:  p.time as unknown as import('lightweight-charts').UTCTimestamp,
            value: p.value,
          }))
          ;(rsiSeriesRef.current as { setData: (d: unknown) => void }).setData(rsiData)
        }

        // Set MACD data
        if (macdLineRef.current) {
          ;(macdLineRef.current as { setData: (d: unknown) => void }).setData(
            macdPoints.map(p => ({ time: p.time as unknown as import('lightweight-charts').UTCTimestamp, value: p.macd }))
          )
        }
        if (macdSignalRef.current) {
          ;(macdSignalRef.current as { setData: (d: unknown) => void }).setData(
            macdPoints.map(p => ({ time: p.time as unknown as import('lightweight-charts').UTCTimestamp, value: p.signal }))
          )
        }
        if (macdHistRef.current) {
          ;(macdHistRef.current as { setData: (d: unknown) => void }).setData(
            macdPoints.map(p => ({
              time:  p.time as unknown as import('lightweight-charts').UTCTimestamp,
              value: p.histogram,
              color: p.histogram >= 0 ? '#00c87570' : '#ff4d4d70',
            }))
          )
        }

        // Fit content on main chart
        if (mainChartRef.current) {
          ;(mainChartRef.current as { timeScale: () => { fitContent: () => void } })
            .timeScale().fitContent()
        }
      } finally {
        setDataLoading(false)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe])

  const isPos = changePercent >= 0

  return (
    <div ref={wrapRef} className="flex flex-col h-full bg-[#0a0e1a] select-none">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-[#1e2d4a] shrink-0 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-[#c8d6f0] tracking-wide">{symbol}</span>
          <span className="text-[11px] text-[#4a5a7a] truncate max-w-[180px]">{name}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-[#c8d6f0] tabular-nums">{fmt2(price)}</span>
          <span className={`text-[11px] font-semibold tabular-nums ${isPos ? 'text-[#00c875]' : 'text-[#ff4d4d]'}`}>
            {sign(change)}{fmt2(change)} ({sign(changePercent)}{fmt2(changePercent)}%)
          </span>
        </div>
        <div className="flex-1" />
        {/* Timeframe buttons */}
        <div className="flex items-center gap-0.5">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-0.5 text-[10px] font-bold rounded transition-colors cursor-pointer ${
                tf === timeframe
                  ? 'bg-[#3b7dd8] text-white'
                  : 'text-[#4a5a7a] hover:text-[#c8d6f0] hover:bg-[#1e2d4a]'
              }`}
            >
              {TF_LABEL[tf]}
            </button>
          ))}
        </div>
      </div>

      {/* Label bar */}
      <div className="flex items-center gap-3 px-4 py-1 bg-[#0a0e1a] border-b border-[#141d2e] shrink-0">
        <span className="text-[9px] text-[#4a5a7a] tracking-wider font-semibold">
          CANDLE · VOL
        </span>
        <span className="text-[#1e2d4a]">|</span>
        <span className="text-[9px] text-[#4a5a7a] tracking-wider font-semibold">RSI(14)</span>
        <span className="text-[#1e2d4a]">|</span>
        <span className="text-[9px] text-[#4a5a7a] tracking-wider font-semibold">MACD(12,26,9)</span>
        <div className="flex-1" />
        {dataLoading && (
          <span className="text-[9px] text-[#3b7dd8] animate-pulse">Loading…</span>
        )}
      </div>

      {/* Charts */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Main candlestick + volume */}
        <div ref={mainRef} className="flex-[5] min-h-0" />
        {/* RSI */}
        <div className="shrink-0 border-t border-[#141d2e]">
          <div className="px-4 py-0.5 text-[8px] text-[#3b7dd8] font-bold tracking-wider">RSI(14)</div>
          <div ref={rsiRef} style={{ minHeight: 80, height: 80 }} />
        </div>
        {/* MACD */}
        <div className="shrink-0 border-t border-[#141d2e]">
          <div className="px-4 py-0.5 text-[8px] text-[#3b7dd8] font-bold tracking-wider">MACD(12,26,9)</div>
          <div ref={macdRef} style={{ minHeight: 80, height: 80 }} />
        </div>
      </div>
    </div>
  )
}
