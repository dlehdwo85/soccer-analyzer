'use client'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { fmtClock } from '@/lib/utils'

export interface VideoDockHandle {
  /** 분석 기준 시각(초)으로 이동 — 2초 앞부터 재생 */
  seek: (t: number) => void
}

/** 이벤트를 누르면 화면 구석에서 해당 장면을 재생하는 플레이어 */
const VideoDock = forwardRef<VideoDockHandle, { src: string; offset?: number }>(function VideoDock({ src, offset = 0 }, ref) {
  const video = useRef<HTMLVideoElement>(null)
  const [open, setOpen] = useState(false)
  const [big, setBig] = useState(false)
  const [at, setAt] = useState<number | null>(null)
  const [error, setError] = useState(false)

  useImperativeHandle(ref, () => ({
    seek: (t: number) => {
      setOpen(true)
      setAt(t)
      const go = () => {
        const v = video.current
        if (!v) return
        v.currentTime = Math.max(0, t + offset - 2)
        v.play().catch(() => { /* 자동재생 차단 시 사용자가 재생 */ })
      }
      if (video.current && video.current.readyState >= 1) go()
      else setTimeout(go, 300)
    },
  }), [offset])

  if (!open) return null
  return (
    <div className={`fixed z-50 bottom-4 right-4 bg-black rounded-xl shadow-2xl overflow-hidden transition-all
      ${big ? 'left-4 sm:left-auto sm:w-[720px]' : 'w-[min(360px,calc(100vw-2rem))]'}`}>
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 bg-gray-900">
        <span className="flex-1">{at !== null ? `${fmtClock(at)} 장면` : '경기 영상'}</span>
        <button onClick={() => setBig(b => !b)} aria-label="크기 전환" className="hover:text-white">
          {big ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
        <button onClick={() => { video.current?.pause(); setOpen(false) }} aria-label="닫기" className="hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
      {error ? (
        <p className="text-xs text-gray-300 p-4">영상을 불러올 수 없습니다. 저장소 주소나 권한을 확인하세요.</p>
      ) : (
        <video ref={video} src={src} controls playsInline preload="metadata" className="w-full aspect-video bg-black"
          onError={() => setError(true)} />
      )}
    </div>
  )
})

export default VideoDock
