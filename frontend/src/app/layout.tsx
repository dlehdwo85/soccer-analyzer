import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'
import Navbar from '@/components/layout/Navbar'

export const metadata: Metadata = {
  title: '풋볼 애널라이저 — 조기축구 경기 영상 분석',
  description: '경기 영상에서 유니폼 색으로 팀을 나누고 선수별 볼 터치·패스·키패스·슈팅·수비 기록을 만듭니다',
}

export const viewport: Viewport = { themeColor: '#070b14' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="stylesheet" crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      </head>
      <body>
        <Navbar />
        <main className="min-h-[calc(100vh-56px)]">{children}</main>
        <footer className="border-t border-ink-800 py-6 text-center text-xs text-ink-500">
          풋볼 애널라이저 · 영상 속 선수를 유니폼 색으로 구분해 볼 기록을 만듭니다
        </footer>
        <Providers />
      </body>
    </html>
  )
}
