'use client'

import { useState, useEffect, useRef } from 'react'
import type { StockQuote } from '@/types/trading'

const DEFAULT_WATCHLIST = [
  'NVDA','AMD','AVGO','TSM','ASML','QCOM','INTC','MU','ARM','AMAT',
  'LRCX','KLAC','MRVL','ON','TXN','MCHP','AAPL','MSFT','GOOGL','META',
]
const STORAGE_KEY = 'td-watchlist'

interface Props {
  quotes: StockQuote[]
  selectedSymbol: string
  onSelect: (symbol: string) => void
  onWatchlistChange: (symbols: string[]) => void
}

function sign(v: number): string {
  return v >= 0 ? '+' : ''
}

export function WatchlistPanel({ quotes, selectedSymbol, onSelect, onWatchlistChange }: Props) {
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_WATCHLIST
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as string[]
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch { /* ignore */ }
    return DEFAULT_WATCHLIST
  })

  const [adding, setAdding]       = useState(false)
  const [inputVal, setInputVal]   = useState('')
  const [hoveredSym, setHoveredSym] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Persist watchlist to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist))
    } catch { /* ignore */ }
  }, [watchlist])

  // Focus input when adding mode starts
  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const quoteMap = new Map(quotes.map(q => [q.symbol, q]))

  function handleAdd() {
    const sym = inputVal.trim().toUpperCase()
    if (sym && !watchlist.includes(sym)) {
      const next = [...watchlist, sym]
      setWatchlist(next)
      onWatchlistChange(next)
    }
    setInputVal('')
    setAdding(false)
  }

  function handleRemove(sym: string) {
    const next = watchlist.filter(s => s !== sym)
    setWatchlist(next)
    onWatchlistChange(next)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleAdd()
    if (e.key === 'Escape') {
      setInputVal('')
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0e1a]">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[#1e2d4a] shrink-0">
        <span className="text-[9px] font-bold tracking-[0.2em] text-[#3b7dd8] uppercase">
          Watchlist
        </span>
      </div>

      {/* Stock rows */}
      <div className="flex-1 overflow-y-auto">
        {watchlist.map(sym => {
          const q = quoteMap.get(sym)
          const isSelected = sym === selectedSymbol
          const isPos = (q?.changePercent ?? 0) >= 0

          return (
            <div
              key={sym}
              onClick={() => onSelect(sym)}
              onMouseEnter={() => setHoveredSym(sym)}
              onMouseLeave={() => setHoveredSym(null)}
              className={`
                relative flex items-center px-3 py-2 cursor-pointer select-none
                hover:bg-[#0f1629] transition-colors
                ${isSelected ? 'bg-[#0f1629] border-l-2 border-[#3b7dd8]' : 'border-l-2 border-transparent'}
              `}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-bold text-[#c8d6f0] w-16 shrink-0 truncate">
                    {sym}
                  </span>
                  {q ? (
                    <span className="text-[11px] tabular-nums text-[#c8d6f0] font-medium">
                      {q.price.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-[11px] tabular-nums text-[#4a5a7a]">—</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1 mt-0.5">
                  <span className="text-[9px] text-[#4a5a7a] truncate max-w-[64px]">
                    {q?.name ? q.name.split(' ').slice(0, 2).join(' ') : ''}
                  </span>
                  {q ? (
                    <span className={`text-[10px] font-semibold tabular-nums ${isPos ? 'text-[#00c875]' : 'text-[#ff4d4d]'}`}>
                      {sign(q.changePercent)}{q.changePercent.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-[10px] tabular-nums text-[#4a5a7a]">—</span>
                  )}
                </div>
              </div>

              {/* Remove button — shown on hover */}
              {hoveredSym === sym && (
                <button
                  onClick={e => { e.stopPropagation(); handleRemove(sym) }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#4a5a7a] hover:text-[#ff4d4d] transition-colors px-1 py-0.5 leading-none"
                  title={`Remove ${sym}`}
                >
                  ✕
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Add symbol area */}
      <div className="shrink-0 border-t border-[#1e2d4a] p-2">
        {adding ? (
          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={e => setInputVal(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            onBlur={handleAdd}
            placeholder="TICKER"
            maxLength={10}
            className="w-full bg-[#141d2e] border border-[#3b7dd8] rounded px-2 py-1.5 text-[11px] text-[#c8d6f0] placeholder-[#4a5a7a] focus:outline-none tracking-wider font-bold"
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full text-[10px] text-[#4a5a7a] hover:text-[#3b7dd8] py-1.5 transition-colors text-left font-semibold tracking-wider"
          >
            + Add Symbol
          </button>
        )}
      </div>
    </div>
  )
}
