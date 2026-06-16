'use client'
import { useEffect, useRef } from 'react'

const EXCHANGE_MAP: Record<string, string> = {
  NVDA:  'NASDAQ',
  AMD:   'NASDAQ',
  MU:    'NASDAQ',
  INTC:  'NASDAQ',
  TSLA:  'NASDAQ',
  MSTR:  'NASDAQ',
  RGTI:  'NASDAQ',
  OKLO:  'NYSE',
  ARBE:  'NASDAQ',
  AAPL:  'NASDAQ',
  MSFT:  'NASDAQ',
  GOOGL: 'NASDAQ',
  META:  'NASDAQ',
  AVGO:  'NASDAQ',
  TSM:   'NYSE',
  ASML:  'NASDAQ',
  QCOM:  'NASDAQ',
  ARM:   'NASDAQ',
  AMAT:  'NASDAQ',
  LRCX:  'NASDAQ',
  KLAC:  'NASDAQ',
  MRVL:  'NASDAQ',
  ON:    'NASDAQ',
  TXN:   'NASDAQ',
  MCHP:  'NASDAQ',
}

interface Props {
  symbol: string
}

export function TradingViewChart({ symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Clear previous widget
    container.innerHTML = ''

    const exchange = EXCHANGE_MAP[symbol] ?? 'NASDAQ'
    const tvSymbol = `${exchange}:${symbol}`

    const widgetDiv = document.createElement('div')
    widgetDiv.className = 'tradingview-widget-container__widget'
    widgetDiv.style.height = '100%'
    widgetDiv.style.width = '100%'
    container.appendChild(widgetDiv)

    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.async = true
    script.textContent = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: 'D',
      timezone: 'Europe/Rome',
      theme: 'dark',
      style: '1',
      locale: 'it',
      backgroundColor: '#0a0e1a',
      gridColor: 'rgba(30,45,74,0.6)',
      withdateranges: true,
      hide_side_toolbar: false,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      studies: ['RSI@tv-basicstudies', 'MACD@tv-basicstudies'],
      show_popup_button: false,
    })
    container.appendChild(script)

    return () => {
      if (container) container.innerHTML = ''
    }
  }, [symbol])

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container h-full w-full"
    />
  )
}
