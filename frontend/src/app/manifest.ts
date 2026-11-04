import type { MetadataRoute } from 'next'

/** 휴대폰 '홈 화면에 추가'로 앱처럼 쓰기 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '팬텀 · 경기 기록',
    short_name: '팬텀',
    description: '경기 영상 한 편으로 선수별 패스·슈팅·수비 기록과 하이라이트',
    start_url: '/',
    display: 'standalone',
    background_color: '#070b14',
    theme_color: '#070b14',
    lang: 'ko',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }
}
