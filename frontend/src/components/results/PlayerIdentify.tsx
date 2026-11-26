'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, X, ZoomIn, ZoomOut } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { MatchResult, Overlay, PlayerRow, RosterEntry } from '@/lib/types'
import { fmtClock, isGk, ourTeam, playerName, teamInfo } from '@/lib/utils'
import PlayerAvatar from './PlayerAvatar'

/** 선수 위치 데이터는 크다(수 MB) → 경기당 한 번만 받는다 */
const overlayCache = new Map<number, Promise<Overlay | null>>()
function loadOverlay(matchId: number): Promise<Overlay | null> {
  let p = overlayCache.get(matchId)
  if (!p) {
    p = api.getOverlay(matchId).catch(() => null)
    overlayCache.set(matchId, p)
  }
  return p
}

type Box = [number, number, number, number]
const PRE = 1.5   // 장면 시작 전 여유(초)
const POST = 3    // 장면 뒤 여유(초) — 지나면 같은 장면을 되풀이한다

interface Props {
  matchId: number
  result: MatchResult
  player: PlayerRow
  /** 경기 영상 주소 — 없으면 작은 사진만 크게 보여 준다 */
  src?: string | null
  roster?: RosterEntry[]
  /** 이름·번호를 넣을 수 있는지 — 선수 정리에서 고른 팀이면 true. 없으면 우리 팀만 */
  nameable?: boolean
  onClose: () => void
  /** 이름·번호를 저장한 뒤 (결과 다시 불러오기) */
  onSaved: () => Promise<void>
}

/**
 * '이 선수가 누구인지' 확인하는 창: 경기 영상에서 그 선수만 크게 따라가며 보여 주고, 바로 아래에서 번호·이름을 넣는다.
 * 선수가 화면에 가장 크게 잡힌 장면 몇 개를 골라 짧게 되풀이한다.
 */
export default function PlayerIdentify({ matchId, result, player, src, roster, nameable, onClose, onSaved }: Props) {
  const [overlay, setOverlay] = useState<Overlay | null | undefined>(undefined)
  useEffect(() => { loadOverlay(matchId).then(setOverlay) }, [matchId])

  // 이 선수(합쳐진 조각 포함)의 프레임별 위치
  const boxes = useMemo(() => {
    const m = new Map<number, Box>()
    if (!overlay) return m
    for (const id of [player.track_id, ...player.merged_from]) {
      for (const r of overlay.tracks?.[id] ?? []) m.set(r[0], [r[1], r[2], r[3], r[4]])
    }
    return m
  }, [overlay, player])

  // 가장 크게(그리고 화면 안에 온전히) 잡힌 장면을 서로 떨어진 시각에서 최대 6개
  const moments = useMemo(() => {
    if (!overlay || !boxes.size) return [] as number[]
    const gap = Math.max(1, Math.round(15 / overlay.step))
    const cand = [...boxes.entries()]
      .filter(([, b]) => b[0] > 6 && b[2] < overlay.w - 6 && b[3] < overlay.h - 6 && b[1] > 6)
      .sort((a, b) => (b[1][3] - b[1][1]) - (a[1][3] - a[1][1]))
    const picked: number[] = []
    for (const [k] of cand) {
      if (picked.every(q => Math.abs(q - k) >= gap)) picked.push(k)
      if (picked.length >= 6) break
    }
    if (!picked.length) picked.push([...boxes.keys()][0])
    return picked.sort((a, b) => a - b)
  }, [overlay, boxes])

  const [mi, setMi] = useState(0)
  const [zoom, setZoom] = useState(true)
  const [playing, setPlaying] = useState(true)
  const [videoError, setVideoError] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const marker = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const miRef = useRef(mi)
  miRef.current = mi

  const timeOf = (k: number) => (overlay ? overlay.start_s + k * overlay.step : 0)
  const goMoment = (i: number) => {
    const v = video.current
    if (!v || !moments.length) return
    const n = (i + moments.length) % moments.length
    setMi(n)
    v.currentTime = Math.max(0, timeOf(moments[n]) - PRE)
    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  // 선수 위치가 영상 정보보다 늦게 오면 그때 첫 장면으로 간다
  useEffect(() => {
    const v = video.current
    if (v && v.readyState >= 1 && moments.length) goMoment(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moments])

  // 영상 위에서 선수를 따라가며 확대 — 매 프레임 영상의 위치·배율만 바꾼다 (다시 그리기 없음)
  useEffect(() => {
    const v = video.current, f = frame.current
    if (!v || !f || !overlay || !moments.length) return
    let raf = 0
    let cur: { tx: number; ty: number; z: number } | null = null
    // 화면에 실제로 그려진 영상 프레임의 시각 — currentTime은 그보다 앞서 가서 재생 중 테두리가 밀린다
    type FrameVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, md: { mediaTime: number }) => void) => number
      cancelVideoFrameCallback?: (id: number) => void
    }
    const fv = v as FrameVideo
    let shown: number | null = null
    let vfc = 0
    const onFrame = (_now: number, md: { mediaTime: number }) => {
      shown = md.mediaTime
      vfc = fv.requestVideoFrameCallback!(onFrame)
    }
    if (fv.requestVideoFrameCallback) vfc = fv.requestVideoFrameCallback(onFrame)
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const cw = f.clientWidth, ch = f.clientHeight
      if (!cw || !ch) return
      // 장면이 끝나면 같은 장면 처음으로
      const m = moments[miRef.current]
      if (m !== undefined && !v.paused && v.currentTime > timeOf(m) + POST) v.currentTime = Math.max(0, timeOf(m) - PRE)
      const s0 = cw / overlay.w
      const vt = shown !== null && Math.abs(shown - v.currentTime) < 0.5 ? shown : v.currentTime
      const k = Math.round((vt - overlay.start_s) / overlay.step)
      let box: Box | undefined
      for (let d = 0; d <= 4 && !box; d++) box = boxes.get(k - d) ?? boxes.get(k + d)
      const vh = overlay.h * s0
      let target = { tx: 0, ty: (ch - vh) / 2, z: 1 }
      if (box && zoomRef.current) {
        const bh = Math.max(20, box[3] - box[1])
        const z = Math.min(8, Math.max(1, (0.55 * ch) / (bh * s0)))
        const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2
        const clamp = (t: number, size: number, view: number) => (size <= view ? (view - size) / 2 : Math.min(0, Math.max(view - size, t)))
        target = { z, tx: clamp(cw / 2 - cx * s0 * z, cw * z, cw), ty: clamp(ch / 2 - cy * s0 * z, vh * z, ch) }
      } else if (zoomRef.current && cur) {
        target = cur   // 잠깐 놓친 프레임에서는 화면을 그대로 둔다
      }
      cur = cur ? { tx: cur.tx + (target.tx - cur.tx) * 0.25, ty: cur.ty + (target.ty - cur.ty) * 0.25, z: cur.z + (target.z - cur.z) * 0.25 } : target
      v.style.width = `${cw}px`
      v.style.transform = `translate(${cur.tx}px, ${cur.ty}px) scale(${cur.z})`
      const mk = marker.current
      if (mk) {
        if (box) {
          const pad = 4
          mk.style.display = 'block'
          mk.style.left = `${box[0] * s0 * cur.z + cur.tx - pad}px`
          mk.style.top = `${box[1] * s0 * cur.z + cur.ty - pad}px`
          mk.style.width = `${(box[2] - box[0]) * s0 * cur.z + pad * 2}px`
          mk.style.height = `${(box[3] - box[1]) * s0 * cur.z + pad * 2}px`
        } else mk.style.display = 'none'
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      if (vfc && fv.cancelVideoFrameCallback) fv.cancelVideoFrameCallback(vfc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, boxes, moments])

  // 이름·번호
  const [name, setName] = useState(player.display_name ?? '')
  const [num, setNum] = useState(player.jersey_number?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = name !== (player.display_name ?? '') || num !== (player.jersey_number?.toString() ?? '')
  const onName = (v: string) => {
    setName(v)
    const hit = roster?.find(r => r.name === v.trim())
    if (hit && hit.number != null) setNum(String(hit.number))
  }
  const save = async () => {
    setSaving(true)
    try {
      const r = await api.updatePlayer(matchId, player.track_id, {
        display_name: name.trim() || null,
        jersey_number: num.trim() === '' ? null : Number(num),
      })
      await onSaved()
      toast.success(r.merged_into ? `같은 이름의 선수와 합쳤습니다 (${name.trim()})` : '저장했습니다')
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const team = teamInfo(result.match, player.team)
  const canVideo = !!src && !videoError && overlay !== null && (overlay === undefined || moments.length > 0)
  const s = player.stats

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${playerName(player)} 확인`}
        className="bg-ink-900 border border-ink-700 w-full sm:max-w-lg max-h-[96vh] overflow-y-auto rounded-t-lg sm:rounded-lg"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-ink-900 border-b border-ink-800 px-4 py-3 flex items-center gap-3">
          <PlayerAvatar matchId={matchId} match={result.match} player={player} size={40} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink-100 truncate">{playerName(player)}</p>
            <p className="text-xs text-ink-400 truncate">
              <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle ring-1 ring-white/20" style={{ background: team.color }} />
              {team.name}{isGk(player) && ' · GK'} · {s.minutes_tracked.toFixed(0)}분 · 터치 {s.touches}
              {player.merged_from.length > 0 && ` · 조각 ${player.merged_from.length + 1}개`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost !p-2" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-3">
          {canVideo ? (
            <>
              <div ref={frame} className="relative w-full aspect-[4/3] overflow-hidden bg-black rounded-lg">
                <video ref={video} src={src!} muted playsInline preload="auto"
                  className="absolute left-0 top-0 max-w-none origin-top-left"
                  onLoadedMetadata={() => goMoment(0)}
                  onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
                  onError={() => setVideoError(true)} />
                <div ref={marker} className="absolute hidden rounded-md border-2 border-volt pointer-events-none"
                  style={{ boxShadow: '0 0 0 1px rgba(0,0,0,.6)' }} aria-hidden />
                {overlay === undefined && <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-300">선수 위치를 불러오는 중…</p>}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-secondary !px-3" onClick={() => goMoment(mi - 1)} aria-label="이전 장면"><ChevronLeft className="w-4 h-4" /></button>
                <button type="button" className="btn-secondary flex-1"
                  onClick={() => { const v = video.current; if (v) (v.paused ? v.play().catch(() => undefined) : v.pause()) }}>
                  {playing ? <><Pause className="w-4 h-4" />멈춤</> : <><Play className="w-4 h-4" />재생</>}
                </button>
                <button type="button" className="btn-secondary !px-3" onClick={() => goMoment(mi + 1)} aria-label="다음 장면"><ChevronRight className="w-4 h-4" /></button>
                <button type="button" className="btn-secondary !px-3" onClick={() => setZoom(z => !z)} aria-pressed={zoom}
                  aria-label={zoom ? '전체 화면으로 보기' : '선수만 크게 보기'}>
                  {zoom ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
                </button>
              </div>
              {moments.length > 1 && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="장면 선택">
                  {moments.map((k, i) => (
                    <button key={k} type="button" onClick={() => goMoment(i)} aria-pressed={i === mi}
                      className={i === mi ? 'chip chip-on num' : 'chip num'}>{fmtClock(timeOf(k))}</button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-ink-500">
                초록 테두리가 이 선수입니다. 가장 크게 잡힌 장면을 되풀이해서 보여 줍니다. 장면마다 다른 사람으로 보이면 잘못 합쳐진 것입니다.
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-2">
              {player.has_thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={api.thumbnailUrl(matchId, player.track_id)} alt={`${playerName(player)} 사진`}
                  className="h-64 w-auto rounded-lg bg-ink-800" style={{ imageRendering: 'auto' }} />
              ) : <PlayerAvatar matchId={matchId} match={result.match} player={player} size={120} />}
              <p className="text-[11px] text-ink-500 text-center">
                {src ? '이 선수의 영상 위치를 찾지 못해 사진만 보여 줍니다.' : '영상이 연결된 경기에서는 선수를 크게 따라가는 영상을 볼 수 있습니다.'}
              </p>
            </div>
          )}

          {!(nameable ?? player.team === ourTeam(result.match)) ? (
            <div className="border-t border-ink-800 pt-3 flex items-center gap-2">
              <p className="flex-1 text-xs text-ink-500">상대 팀 선수는 이름을 넣지 않습니다.</p>
              <button type="button" className="btn-secondary" onClick={onClose}>닫기</button>
            </div>
          ) : (
          <div className="border-t border-ink-800 pt-3">
            <p className="label mb-1.5">이 선수는 누구인가요</p>
            <div className="flex gap-2">
              <input className="input !w-20 shrink-0 text-base" placeholder="번호" inputMode="numeric" value={num}
                onChange={e => setNum(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="등번호" />
              <input className="input text-base" placeholder={roster?.length ? '이름 (명단에서 고르기)' : '이름'} value={name} maxLength={100}
                list={`roster-${player.team}`}
                onChange={e => onName(e.target.value)} onKeyDown={e => e.key === 'Enter' && dirty && save()} aria-label="이름" />
            </div>
            <div className="flex gap-2 mt-3">
              <button type="button" className="btn-secondary flex-1" onClick={onClose}>닫기</button>
              <button type="button" className="btn-primary flex-1" disabled={!dirty || saving} onClick={save}>저장</button>
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
