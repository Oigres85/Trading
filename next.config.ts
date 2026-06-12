import type { NextConfig } from 'next'

const isGhPages = process.env.GITHUB_PAGES === 'true'

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: isGhPages ? '/Trading' : '',
  assetPrefix: isGhPages ? '/Trading/' : '',
  images: { unoptimized: true },
}

export default nextConfig
