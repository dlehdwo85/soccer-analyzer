'use client'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Maximize2, Minimize2, SkipForward, Tag, X } from 'lucide-react'
import { api } from '@/lib/api'
import { MatchResult, Overlay } from '@/lib/types'
import { fmtClock, playerName, teamInfo } from '@/lib/utils'
import { drawFrame, namesCfg, prepare } from './VideoReview'

/** player: 이 장면의 주인공 (영상 위에 이름과 굵은 테두리로 표시) */
export interface Clip { t: number; label: string; player?: string }

export interface VideoDockHandle {
  /** 분석 기준 시각(초)으로 이동 — 3초 앞부터 재생 */
  seek: (t: number, label?: string, player?: string) => void
  /** 장면 여러 개를 이어서 재생 (하이라이트) */
  playClips: (clips: Clip[]) => void
  /** 지금 영상 위치를 분석 기준 시각으로 (영상이 열려 있지 않으면 null) */
  currentTime: () => number | null
  /** 장면 이동 없이 플레이어만 연다 — 처음 열 때는 분석 시작 지점에서 */
  open: () => void
}

const PRE = 3
const POST = 4

/**
 * 이벤트를 누르면 화면 구석에서 해당 장면을 재생하는 플레이어.
 * 영상 위에 선수 머리 위 이름표(영상 검수와 같은 그림)와 '누구의 장면인지' 자막을 겹친다.
 */
const VideoDock = forwardRef<VideoDockHandle, { src: string; offset?: number; matchId?: number; result?: MatchResult }>(
  function VideoDock({ src, offset = 0, matchId, result }, ref) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [open, setOpen] = useState(false)
  const [big, setBig] = useState(false)
  const [clip, setClip] = useState<Clip | null>(null)
  const [error, setError] = useState(false)
  const [showNames, setShowNames] = useState(true)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const queue = useRef<Clip[]>([])
  const [qInfo, setQInfo] = useState<{ i: number; n: number } | null>(null)
  const clipEnd = useRef<number | null>(null)
  const startAtOffset = useRef(false)
  const pendingSeek = useRef<number | null>(null)

  // 이름표용 선수 위치 — 처음 열 때 한 번 받는다
  useEffect(() => {
    if (!open || overlay || !matchId) return
    api.getOverlay(matchId).then(d => setOverlay(d)).catch(() => setOverlay(null))
  }, [open, overlay, matchId])
  const prep = useMemo(() => (overlay ? prepare(overlay) : null), [overlay])

  /** 재생 시작. 자동재생이 막히면(휴대폰) 소리를 끄고 다시 시도한다 — 안 그러면 검은 화면으로 멈춰 있다 */
  const play = useCallback((v: HTMLVideoElement) => {
    v.play().catch(() => { v.muted = true; v.play().catch(() => { /* 사용자가 재생 버튼을 누른다 */ }) })
  }, [])

  const go = useCallback((t: number) => {
    startAtOffset.current = false
    const target = Math.max(0, t + offset - PRE)
    const v = video.current
    // 영상 정보가 오기 전에 위치를 바꾸면 무시되거나 첫 화면이 안 그려진다 → 정보가 오면 그때 이동한다
    if (!v || v.readyState < 1) { pendingSeek.current = target; return }
    v.currentTime = target
    play(v)
  }, [offset, play])

  const playIndex = useCallback((i: number) => {
    const c = queue.current[i]
    if (!c) { setQInfo(null); clipEnd.current = null; video.current?.pause(); return }
    setQInfo({ i, n: queue.current.length })
    setClip(c)
    clipEnd.current = c.t + offset + POST
    go(c.t)
  }, [go, offset])

  useImperativeHandle(ref, () => ({
    seek: (t, label, player) => {
      queue.current = []
      setQInfo(null)
      clipEnd.current = null
      setOpen(true)
      setClip({ t, label: label ?? '장면', player })
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
        setClip(null)
      }
      setOpen(true)
    },
  }), [go, playIndex, open, offset])

  // 이름표 그리기: 재생 중에는 매 프레임, 멈추면 한 번
  const cfg = useMemo(() => (result && prep ? namesCfg(result, prep, clip?.player ?? '', showNames) : null),
    [result, prep, clip?.player, showNames])
  useEffect(() => {
    const v = video.current, cv = canvas.current
    if (!open || !v || !cv) return
    let raf = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const resize = () => {
      const r = cv.getBoundingClientRect()
      cv.width = Math.round(r.width * dpr)
      cv.height = Math.round(r.height * dpr)
    }
    const draw = () => drawFrame(cv, v, dpr, cfg)
    const loop = () => { draw(); raf = !v.paused && !v.ended ? requestAnimationFrame(loop) : 0 }
    const onPlay = () => { if (!raf) raf = requestAnimationFrame(loop) }
    const onStill = () => { if (raf) cancelAnimationFrame(raf); raf = 0; draw() }
    resize()
    const ro = new ResizeObserver(() => { resize(); draw() })
    ro.observe(cv)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onStill)
    v.addEventListener('seeked', onStill)
    v.addEventListener('loadeddata', onStill)
    if (!v.paused) onPlay(); else draw()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onStill)
      v.removeEventListener('seeked', onStill)
      v.removeEventListener('loadeddata', onStill)
    }
  }, [open, cfg, big])

  if (!open) return null
  const star = clip?.player && result ? result.players.find(p => p.track_id === clip.player || p.merged_from.includes(clip.player!)) : null
  const starTeam = star && result ? teamInfo(result.match, star.team) : null
  return (
    <div className={`fixed z-50 bottom-4 right-4 bg-black rounded-lg shadow-2xl overflow-hidden border border-ink-700 transition-all
      ${big ? 'left-4 sm:left-auto sm:w-[760px]' : 'w-[min(380px,calc(100vw-2rem))]'}`}>
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-ink-200 bg-ink-900">
        <span className="flex-1 truncate font-semibold">{clip ? `${fmtClock(clip.t)} ${clip.label}` : '경기 영상'}</span>
        {qInfo && (
          <>
            <span className="text-volt num">{qInfo.i + 1}/{qInfo.n}</span>
            <button onClick={() => playIndex(qInfo.i + 1)} aria-label="다음 장면" className="hover:text-white"><SkipForward className="w-4 h-4" /></button>
          </>
        )}
        {prep && (
          <button onClick={() => setShowNames(s => !s)} aria-label="선수 이름표" aria-pressed={showNames}
            className={showNames ? 'text-volt' : 'hover:text-white'}>
            <Tag className="w-4 h-4" />
          </button>
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
        <div className="relative">
          <video ref={video} src={src} controls playsInline preload="auto" className="w-full aspect-video bg-black block"
            onError={() => setError(true)}
            onLoadedMetadata={e => {
              const v = e.currentTarget
              if (pendingSeek.current !== null) {
                v.currentTime = pendingSeek.current
                pendingSeek.current = null
                play(v)
                return
              }
              if (!startAtOffset.current) return
              startAtOffset.current = false
              if (v.currentTime < offset) v.currentTime = offset
            }}
            onTimeUpdate={e => {
              if (clipEnd.current !== null && qInfo && e.currentTarget.currentTime >= clipEnd.current) playIndex(qInfo.i + 1)
            }} />
          {/* 선수 머리 위 이름표 — 클릭은 영상 조작 막대로 그대로 통과한다 */}
          <canvas ref={canvas} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden />
          {clip && (
            <div className="absolute left-2 top-2 max-w-[80%] pointer-events-none flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-1 text-white">
              {starTeam && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: starTeam.color }} />}
              <span className="text-[13px] font-semibold truncate">{star ? playerName(star) : clip.label}</span>
              {star && <span className="text-[11px] text-white/70 truncate">{clip.label.replace(`${playerName(star)} · `, '').replace(playerName(star), '').trim()}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

export default VideoDock
