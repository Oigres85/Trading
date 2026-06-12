'use client'
import { PORTFOLIO } from '@/lib/portfolio'
import type { StockQuote } from '@/types/trading'

interface Props {
  stocks: StockQuote[]
  selectedSymbol: string
  onSelect: (symbol: string) => void
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtUSD(n: number, decimals = 2): string {
  return '$' + fmt(Math.abs(n), decimals)
}

function sign(n: number): string {
  return n >= 0 ? '+' : '-'
}

export function PortfolioTable({ stocks, selectedSymbol, onSelect }: Props) {
  // Compute total portfolio value for weight calculation
  const totalPortfolioValue = stocks.reduce((acc, s) => {
    const pos = PORTFOLIO.find(p => p.symbol === s.symbol)
    if (!pos) return acc
    return acc + pos.shares * (s.price || pos.avgCost)
  }, 0)

  // Totals for footer
  let totalCostBasis = 0
  let totalCurrentValue = 0
  let totalDayPnL = 0

  const rows = stocks
    .map(stock => {
      const pos = PORTFOLIO.find(p => p.symbol === stock.symbol)
      if (!pos) return null
      const price = stock.price || pos.avgCost
      const costBasis = pos.shares * pos.avgCost
      const currentValue = pos.shares * price
      const pnlDollar = currentValue - costBasis
      const pnlPct = ((price - pos.avgCost) / pos.avgCost) * 100
      const dayPnL = pos.shares * (stock.change || 0)
      const weight = totalPortfolioValue > 0 ? (currentValue / totalPortfolioValue) * 100 : 0

      totalCostBasis += costBasis
      totalCurrentValue += currentValue
      totalDayPnL += dayPnL

      return { stock, pos, price, costBasis, currentValue, pnlDollar, pnlPct, dayPnL, weight }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  const totalPnL = totalCurrentValue - totalCostBasis
  const totalPnLPct = totalCostBasis > 0 ? (totalPnL / totalCostBasis) * 100 : 0
  const totalDayPnLPct = (totalCurrentValue - totalDayPnL) > 0
    ? (totalDayPnL / (totalCurrentValue - totalDayPnL)) * 100
    : 0

  return (
    <table className="w-full text-right text-[10px] border-collapse">
      <thead>
        <tr className="border-b border-[#1e2d4a] bg-[#0a0e1a] sticky top-0 z-10">
          <th className="px-3 py-2 text-left text-[9px] font-bold tracking-widest text-[#4a5a7a] uppercase">SYMBOL</th>
          <th className="px-2 py-2 text-[9px] font-bold tracking-widest text-[#4a5a7a] uppercase">QTY</th>
          <th className="px-2 py-2 text-[9px] font-bold tracking-widest text-[#4a5a7a] uppercase">AVG COST</th>
          <th className="px-2 py-2 text-[9px] font-bold tracking-widest text-[#4a5a7a] uppercase">PRICE</th>
          <th className="px-2 py-2 text-[9px] font-bold tracking-widest text-[#4a5a7a] uppercase">DAY %</th>
          <th className="px-2 py-2 text-[9px] font-bold tracking-widest text-[#4a5a7a] uppercase">P&amp;L $</th>
          <th className="px-2 py-2 text-[9px] font-bold tracking-widest text-[#4a5a7a] uppercase">P&amp;L %</th>
          <th className="px-2 py-2 text-[9px] font-bold tracking-widest text-[#4a5a7a] uppercase">VALUE</th>
          <th className="px-3 py-2 text-[9px] font-bold tracking-widest text-[#4a5a7a] uppercase">WT%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ stock, pos, price, pnlDollar, pnlPct, dayPnL, weight }) => {
          const isSelected = stock.symbol === selectedSymbol
          const pnlPos = pnlDollar >= 0
          const dayPos = stock.changePercent >= 0

          return (
            <tr
              key={stock.symbol}
              onClick={() => onSelect(stock.symbol)}
              className={`
                border-b border-[#1e2d4a]/40 cursor-pointer hover:bg-[#0f1629] transition-colors
                ${isSelected ? 'border-l-2 border-l-[#3b7dd8] bg-[#0f1629]' : ''}
              `}
            >
              <td className="px-3 py-2 text-left font-bold text-[#c8d6f0]">
                {stock.symbol}
                <div className="text-[8px] text-[#4a5a7a] font-normal">{pos.exchange}</div>
              </td>
              <td className="px-2 py-2 text-[#8a9ab8] tabular-nums">{pos.shares.toLocaleString()}</td>
              <td className="px-2 py-2 text-[#8a9ab8] tabular-nums">${fmt(pos.avgCost)}</td>
              <td className="px-2 py-2 text-white tabular-nums font-semibold">${fmt(price)}</td>
              <td className={`px-2 py-2 tabular-nums font-semibold ${dayPos ? 'text-[#00c875]' : 'text-[#ff4d4d]'}`}>
                {sign(stock.changePercent)}{Math.abs(stock.changePercent).toFixed(2)}%
              </td>
              <td className={`px-2 py-2 tabular-nums font-semibold ${pnlPos ? 'text-[#00c875]' : 'text-[#ff4d4d]'}`}>
                {sign(pnlDollar)}{fmtUSD(pnlDollar)}
              </td>
              <td className="px-2 py-2">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${
                    pnlPos
                      ? 'bg-[#00c875]/15 text-[#00c875]'
                      : 'bg-[#ff4d4d]/15 text-[#ff4d4d]'
                  }`}
                >
                  {sign(pnlPct)}{Math.abs(pnlPct).toFixed(2)}%
                </span>
              </td>
              <td className="px-2 py-2 text-white tabular-nums">
                ${Math.round(pos.shares * price).toLocaleString()}
              </td>
              <td className="px-3 py-2 min-w-[80px]">
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 h-1.5 bg-[#1e2d4a] rounded-full overflow-hidden min-w-[36px]">
                    <div
                      className={`h-full rounded-full ${pnlDollar >= 0 ? 'bg-[#3b7dd8]/70' : 'bg-[#6b7fa3]/50'}`}
                      style={{ width: `${Math.min(weight, 100)}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-[#8a9ab8] tabular-nums w-7 text-right shrink-0">{weight.toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-[#1e2d4a] bg-[#0d1829]">
          <td className="px-3 py-2 text-left font-bold text-[#c8d6f0] uppercase text-[9px] tracking-widest">TOTAL</td>
          <td className="px-2 py-2 text-[#4a5a7a]">—</td>
          <td className="px-2 py-2 text-[#4a5a7a]">—</td>
          <td className="px-2 py-2 text-[#4a5a7a]">—</td>
          <td className={`px-2 py-2 tabular-nums font-semibold ${totalDayPnLPct >= 0 ? 'text-[#00c875]' : 'text-[#ff4d4d]'}`}>
            {sign(totalDayPnLPct)}{Math.abs(totalDayPnLPct).toFixed(2)}%
          </td>
          <td className={`px-2 py-2 tabular-nums font-bold ${totalPnL >= 0 ? 'text-[#00c875]' : 'text-[#ff4d4d]'}`}>
            {sign(totalPnL)}{fmtUSD(totalPnL)}
          </td>
          <td className="px-2 py-2">
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${
                totalPnLPct >= 0
                  ? 'bg-[#00c875]/15 text-[#00c875]'
                  : 'bg-[#ff4d4d]/15 text-[#ff4d4d]'
              }`}
            >
              {sign(totalPnLPct)}{Math.abs(totalPnLPct).toFixed(2)}%
            </span>
          </td>
          <td className="px-2 py-2 text-white tabular-nums font-bold">
            ${Math.round(totalCurrentValue).toLocaleString()}
          </td>
          <td className="px-3 py-2 text-[#8a9ab8] text-[9px]">100%</td>
        </tr>
      </tfoot>
    </table>
  )
}
