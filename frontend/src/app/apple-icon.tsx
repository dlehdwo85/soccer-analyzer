import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

/** 아이폰 '홈 화면에 추가' 아이콘 — icon.svg와 같은 그림(공 + 초록 잔상)을 PNG로 만든다 (아이폰은 SVG 아이콘을 쓰지 않는다) */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#0d1321' }}>
        <svg viewBox="0 0 64 64" width="180" height="180">
          <path d="M7 51 C 17 51, 23 46, 27 41" fill="none" stroke="#3fa35b" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
          <circle cx="19" cy="39" r="8.5" fill="#3fa35b" opacity="0.2" />
          <circle cx="28.5" cy="33.5" r="10" fill="#3fa35b" opacity="0.42" />
          <circle cx="40" cy="27" r="12.5" fill="#eef2fa" />
          <path d="M40 22.5 L40 14.5 M44.3 25.6 L51.9 23.1 M42.6 30.6 L47.3 37.1 M37.4 30.6 L32.7 37.1 M35.7 25.6 L28.1 23.1"
            stroke="#0d1321" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          <path d="M40 22.5 L44.3 25.6 L42.6 30.6 L37.4 30.6 L35.7 25.6 Z" fill="#0d1321" />
        </svg>
      </div>
    ),
    size,
  )
}
