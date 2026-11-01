import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import Navbar from '@/components/layout/Navbar'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '풋볼 애널라이저 — 조기축구 경기 분석',
  description: '경기 영상에서 유니폼 색으로 팀을 나누고 선수별 볼 터치·패스·슈팅·활동량을 분석합니다',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={inter.className}>
        <Navbar />
        <main className="min-h-screen bg-gray-50">
          {children}
        </main>
        <Providers />
      </body>
    </html>
  )
}
