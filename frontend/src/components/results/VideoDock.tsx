'use client'
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { Maximize2, Minimize2, SkipForward, X } from 'lucide-react'
import { fmtClock } from '@/lib/utils'

export interface Clip { t: number; label: string }

export interface VideoDockHandle {
  /** 분석 기준 시각(초)으로 이동 — 3초 앞부터 재생 */
  seek: (t: number, label?: string) => void
  /** 장면 여러 개를 이어서 재생 (하이라이트) */
  playClips: (clips: Clip[]) => void
  /** 지금 영상 위치를 분석 기준 시각으로 (영상이 열려 있지 않으면 null) */
  currentTime: () => number | null
  /** 장면 이동 없이 플레이어만 연다 — 처음 열 때는 분석 시작 지점에서 */
  open: () => void
}

const PRE = 3
const POST = 4

/** 이벤트를 누르면 화면 구석에서 해당 장면을 재생하는 플레이어 */
const VideoDock = forwardRef<VideoDockHandle, { src: string; offset?: number }>(function VideoDock({ src, offset = 0 }, ref) {
  const video = useRef<HTMLVideoElement>(null)
  const [open, setOpen] = useState(false)
  const [big, setBig] = useState(false)
  const [title, setTitle] = useState('')
  const [error, setError] = useState(false)
  const queue = useRef<Clip[]>([])
  const [qInfo, setQInfo] = useState<{ i: number; n: number } | null>(null)
  const clipEnd = useRef<number | null>(null)
  const startAtOffset = useRef(false)

  const go = useCallback((t: number) => {
    startAtOffset.current = false
    const run = () => {
      const v = video.current
      if (!v) return
      v.currentTime = Math.max(0, t + offset - PRE)
      v.play().catch(() => { /* 자동재생 차단 시 사용자가 재생 */ })
    }
    if (video.current && video.current.readyState >= 1) run()
    else setTimeout(run, 400)
  }, [offset])

  const playIndex = useCallback((i: number) => {
    const c = queue.current[i]
    if (!c) { setQInfo(null); clipEnd.current = null; video.current?.pause(); return }
    setQInfo({ i, n: queue.current.length })
    setTitle(`${fmtClock(c.t)} ${c.label}`)
    clipEnd.current = c.t + offset + POST
    go(c.t)
  }, [go, offset])

  useImperativeHandle(ref, () => ({
    seek: (t, label) => {
      queue.current = []
      setQInfo(null)
      clipEnd.current = null
      setOpen(true)
      setTitle(`${fmtClock(t)} ${label ?? '장면'}`)
      go(t)
    },
    playClips: clips => {
      if (!clips.length) return
      queue.current = clips
      setOpen(true)
      playIndex(0)
    },
    currentTime: () => (open && video.current ? Math.max(0, video.current.currentTime - offset) : null),
    open: () => {
      queue.current = []
      setQInfo(null)
      clipEnd.current = null
      if (!open) {
        startAtOffset.current = true
        setTitle('경기 영상')
      }
      setOpen(true)
    },
  }), [go, playIndex, open, offset])

  if (!open) return null
  return (
    <div className={`fixed z-50 bottom-4 right-4 bg-black rounded-lg shadow-2xl overflow-hidden border border-ink-700 transition-all
      ${big ? 'left-4 sm:left-auto sm:w-[760px]' : 'w-[min(380px,calc(100vw-2rem))]'}`}>
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-ink-200 bg-ink-900">
        <span className="flex-1 truncate font-semibold">{title}</span>
        {qInfo && (
          <>
            <span className="text-volt num">{qInfo.i + 1}/{qInfo.n}</span>
            <button onClick={() => playIndex(qInfo.i + 1)} aria-label="다음 장면" className="hover:text-white"><SkipForward className="w-4 h-4" /></button>
          </>
        )}
        <button onClick={() => setBig(b => !b)} aria-label="크기 전환" className="hover:text-white">
          {big ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
        <button onClick={() => { video.current?.pause(); queue.current = []; setQInfo(null); setOpen(false) }} aria-label="닫기" className="hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
      {error ? (
        <p className="text-xs text-ink-300 p-4">영상을 불러올 수 없습니다. 저장소 주소나 권한을 확인하세요.</p>
      ) : (
        <video ref={video} src={src} controls playsInline preload="metadata" className="w-full aspect-video bg-black"
          onError={() => setError(true)}
          onLoadedMetadata={e => {
            if (!startAtOffset.current) return
            startAtOffset.current = false
            if (e.currentTarget.currentTime < offset) e.currentTarget.currentTime = offset
          }}
          onTimeUpdate={e => {
            if (clipEnd.current !== null && qInfo && e.currentTarget.currentTime >= clipEnd.current) playIndex(qInfo.i + 1)
          }} />
      )}
    </div>
  )
})

export default VideoDock
