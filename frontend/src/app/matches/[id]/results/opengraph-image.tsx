import { ImageResponse } from 'next/og'
import { fetchShareInfo } from './share'

export const alt = '경기 기록'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 300

/** 한글 글리프가 필요한 글자만 구글 폰트에서 받아 온다 (OG 이미지 기본 글꼴에는 한글이 없다) */
async function koreanFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(
      `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&text=${encodeURIComponent(text)}`,
    )).text()
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1]
    if (!url) return null
    const res = await fetch(url)
    return res.ok ? res.arrayBuffer() : null
  } catch {
    return null
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const info = await fetchShareInfo(id)
  const home = info?.home ?? '홈팀', away = info?.away ?? '원정팀'
  const rows: [string, string, string][] = info ? [
    ['점유율', info.possession[0] != null ? `${info.possession[0]}%` : '–', info.possession[1] != null ? `${info.possession[1]}%` : '–'],
    ['패스 성공/시도', info.passes[0], info.passes[1]],
    ['슈팅(유효)', info.shots[0], info.shots[1]],
  ] : []
  const line = info?.line ?? '영상 AI로 만든 선수별 패스·슈팅·수비 기록'
  const text = ['팬텀 경기 기록', home, away, 'vs', line, ...rows.flat()].join('')
  const font = await koreanFont(text)

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0b0f0d',
        color: '#fff', padding: '56px 72px', fontFamily: font ? 'NotoKR' : 'sans-serif',
      }}>
        <div style={{ display: 'flex', fontSize: 30, color: '#3fa35b', fontWeight: 700 }}>팬텀 · 경기 기록</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, marginTop: 36, fontSize: 64, fontWeight: 700 }}>
          <div style={{ display: 'flex', width: 28, height: 28, borderRadius: 6, background: info?.homeColor ?? '#56b4d3' }} />
          <div style={{ display: 'flex' }}>{home}</div>
          <div style={{ display: 'flex', color: 'rgba(255,255,255,0.4)', fontSize: 44 }}>vs</div>
          <div style={{ display: 'flex' }}>{away}</div>
          <div style={{ display: 'flex', width: 28, height: 28, borderRadius: 6, background: info?.awayColor ?? '#ef4444' }} />
        </div>
        <div style={{ display: 'flex', marginTop: 22, fontSize: 30, color: 'rgba(255,255,255,0.75)', lineHeight: 1.4 }}>{line}</div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto', gap: 14 }}>
          {rows.map(([label, a, b]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', fontSize: 36, borderTop: '2px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
              <div style={{ display: 'flex', width: 300, justifyContent: 'flex-end', fontWeight: 700 }}>{a}</div>
              <div style={{ display: 'flex', flex: 1, justifyContent: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 28 }}>{label}</div>
              <div style={{ display: 'flex', width: 300, fontWeight: 700 }}>{b}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size, fonts: font ? [{ name: 'NotoKR', data: font, weight: 700, style: 'normal' }] : undefined },
  )
}
