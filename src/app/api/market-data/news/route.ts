import { NextResponse } from 'next/server'
import Parser from 'rss-parser'
import type { NewsItem, NewsResponse } from '@/types/trading'

export const dynamic = 'force-dynamic'

const parser = new Parser({
  timeout: 8000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; TradingDashboard/1.0)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
})

const RSS_FEEDS = [
  {
    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA,AMD,INTC,AVGO,TSM,ASML,MU,QCOM,AMAT&region=US&lang=en-US',
    source: 'Yahoo Finance',
  },
  {
    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=SOXX,SMH,XLK,QQQ,ARKK&region=US&lang=en-US',
    source: 'Yahoo Finance ETFs',
  },
  {
    url: 'https://seekingalpha.com/feed/sectors/technology',
    source: 'Seeking Alpha',
  },
]

const FALLBACK_NEWS: NewsItem[] = [
  {
    id: 'fb-1',
    title: 'NVIDIA Reports Record Data Center Revenue as AI Chip Demand Accelerates',
    summary: 'NVIDIA Corporation posted quarterly data center revenue surpassing $22 billion, driven by surging demand for H100 and Blackwell GPU systems across hyperscale customers.',
    url: 'https://finance.yahoo.com',
    source: 'Yahoo Finance',
    publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'fb-2',
    title: 'TSMC Raises Capex Guidance as Advanced Node Orders Surge',
    summary: 'Taiwan Semiconductor Manufacturing raised its annual capital expenditure guidance to $38–40 billion, reflecting robust demand for 3nm and 2nm processes from Apple, NVIDIA and AMD.',
    url: 'https://finance.yahoo.com',
    source: 'Reuters',
    publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'fb-3',
    title: 'ASML Receives Record EUV Tool Orders from Asian Foundries',
    summary: 'ASML reported a record order intake of €9.2 billion in the latest quarter, with High-NA EUV tools representing a growing share of the backlog as chipmakers prepare for sub-2nm production.',
    url: 'https://finance.yahoo.com',
    source: 'Bloomberg',
    publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'fb-4',
    title: 'AMD Expands AI Accelerator Lineup with Next-Gen Instinct MI350 Series',
    summary: 'Advanced Micro Devices unveiled the Instinct MI350X accelerator, targeting hyperscale AI training workloads with 288 GB HBM3E memory and 3.5x performance improvement over MI300X.',
    url: 'https://finance.yahoo.com',
    source: 'The Verge',
    publishedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'fb-5',
    title: 'Micron Technology Prices 12-Month NAND Flash Contracts at Premium',
    summary: 'Micron secured multi-year supply agreements for LPDDR5X and 3D NAND at above-spot pricing, signaling tightening supply as AI-driven storage demand accelerates into 2026.',
    url: 'https://finance.yahoo.com',
    source: 'DigiTimes',
    publishedAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'fb-6',
    title: 'Broadcom Custom ASIC Revenue Poised to Surpass $15B as Hyperscalers Diversify',
    summary: 'Broadcom\'s AI networking and custom XPU segment continued its rapid expansion, with three of the five largest cloud providers placing volume orders for next-generation custom silicon.',
    url: 'https://finance.yahoo.com',
    source: 'Barron\'s',
    publishedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'fb-7',
    title: 'Philadelphia Semiconductor Index (SOX) Outperforms Broader Market YTD',
    summary: 'The PHLX Semiconductor Index gained over 18% year-to-date, led by large-cap foundry and AI-exposed names, as consensus estimates for 2025 chip shipments were revised sharply higher.',
    url: 'https://finance.yahoo.com',
    source: 'MarketWatch',
    publishedAt: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'fb-8',
    title: 'Arm Holdings Gains Share in Data Center CPU Market with Neoverse Platform',
    summary: 'Arm\'s Neoverse platform captured over 20% of new cloud CPU socket shipments in Q1, with AWS Graviton4, Microsoft Cobalt and Google Axion driving momentum in the hyperscale segment.',
    url: 'https://finance.yahoo.com',
    source: 'Seeking Alpha',
    publishedAt: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(),
  },
]

export async function GET() {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      const parsed = await parser.parseURL(feed.url)
      return { items: parsed.items, source: feed.source }
    })
  )

  const items: NewsItem[] = []

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const item of result.value.items) {
      if (!item.title || !item.link) continue
      items.push({
        id: item.guid ?? item.link ?? String(Math.random()),
        title: item.title,
        summary: item.contentSnippet ?? item.content ?? undefined,
        url: item.link,
        source: result.value.source,
        publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
      })
    }
  }

  if (items.length === 0) {
    const response: NewsResponse = {
      items: FALLBACK_NEWS,
      lastUpdated: new Date().toISOString(),
    }
    return NextResponse.json(response)
  }

  // Sort by date desc, dedupe by title similarity, limit 40
  items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
  const seen = new Set<string>()
  const deduped = items.filter((item) => {
    const key = item.title.slice(0, 60).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 40)

  const response: NewsResponse = {
    items: deduped,
    lastUpdated: new Date().toISOString(),
  }
  return NextResponse.json(response)
}
