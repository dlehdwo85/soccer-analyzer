import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'
import Navbar, { MobileTabBar } from '@/components/layout/Navbar'

export const metadata: Metadata = {
  title: '팬텀 · 경기 기록',
  description: '경기 영상에서 유니폼 색으로 팀을 나누고 선수별 볼 터치·패스·키패스·슈팅·수비 기록을 만듭니다',
  // 휴대폰 '홈 화면에 추가'로 열면 주소창 없이 앱처럼 뜬다
  appleWebApp: { capable: true, title: '팬텀', statusBarStyle: 'black' },
}

// viewportFit cover: 아이폰 아래 홈 막대 영역(safe-area)까지 그려야 아래 메뉴 막대가 바닥에 붙는다
export const viewport: Viewport = { themeColor: '#070b14', viewportFit: 'cover' }

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
        <footer className="hidden sm:block border-t border-ink-800">
          <div className="max-w-6xl mx-auto px-4 py-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-500">
            <span className="text-ink-400">팬텀 PHANTOM</span>
            <span>경기 영상에서 만든 기록</span>
          </div>
        </footer>
        <MobileTabBar />
        <Providers />
      </body>
    </html>
  )
}
