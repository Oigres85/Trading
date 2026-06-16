import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        terminal: {
          bg: '#0a0e1a',
          surface: '#0f1629',
          border: '#1e2d4a',
          muted: '#4a5a7a',
          text: '#c8d6f0',
          accent: '#3b7dd8',
        },
        bull: '#00c875',
        bear: '#ff4d4d',
      },
    },
  },
  plugins: [],
}

export default config
