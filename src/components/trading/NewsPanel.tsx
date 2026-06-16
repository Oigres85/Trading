import type { NewsItem } from '@/types/trading'

interface Props {
  items: NewsItem[]
  loading: boolean
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function NewsPanel({ items, loading }: Props) {
  return (
    <aside className="w-80 xl:w-96 shrink-0 bg-[#0c1120] border-l border-[#1e2d4a] flex flex-col">
      <div className="px-4 py-3 border-b border-[#1e2d4a] flex items-center justify-between shrink-0">
        <span className="text-[9px] font-bold tracking-[0.2em] text-[#3b7dd8] uppercase">
          Tech / Semi News
        </span>
        {loading && (
          <span className="text-[9px] text-[#4a5a7a]">Loading…</span>
        )}
      </div>

      <div className="overflow-y-auto flex-1 divide-y divide-[#1e2d4a]/60">
        {items.length === 0 && !loading && (
          <p className="px-4 py-6 text-xs text-[#4a5a7a] text-center">No news available</p>
        )}
        {items.map((item) => (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`block px-4 py-3 hover:bg-[#0f1629] transition-colors group ${item.portfolioMention ? 'border-l-2 border-l-amber-400' : ''}`}
          >
            <p className="text-xs text-[#c8d6f0] group-hover:text-white leading-4 line-clamp-3 mb-1.5 transition-colors">
              {item.title}
            </p>
            {item.summary && (
              <p className="text-[10px] text-[#4a5a7a] leading-3.5 line-clamp-2 mb-1.5">
                {item.summary}
              </p>
            )}
            <div className="flex items-center gap-2 text-[9px] text-[#4a5a7a]">
              <span className="text-[#3b7dd8]">{item.source}</span>
              {item.portfolioMention && (
                <span className="text-amber-400 text-[10px] leading-none" title="Portfolio mention">●</span>
              )}
              <span>·</span>
              <span>{timeAgo(item.publishedAt)}</span>
            </div>
          </a>
        ))}
      </div>
    </aside>
  )
}
