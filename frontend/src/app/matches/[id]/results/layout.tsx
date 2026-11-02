import type { Metadata } from 'next'
import { fetchShareInfo } from './share'

/** 카카오톡·SNS에 링크를 붙였을 때 보이는 제목·설명 (이미지는 opengraph-image.tsx) */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const info = await fetchShareInfo(id)
  if (!info) return { title: '경기 기록 · 풋볼 애널라이저' }
  const title = `${info.home} vs ${info.away} · 경기 기록`
  const description = info.line ?? '영상 AI로 만든 선수별 패스·슈팅·수비 기록'
  return {
    title,
    description,
    openGraph: { title, description, type: 'article', siteName: '풋볼 애널라이저' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default function ResultsLayout({ children }: { children: React.ReactNode }) {
  return children
}
