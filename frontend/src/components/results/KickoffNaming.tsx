'use client'
import { RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, SkipForward } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { MatchResult, Overlay, PlayerRow, RosterEntry } from '@/lib/types'
import { cn, fmtClock, isGk, mainRoster, ourTeam, playerName, teamInfo } from '@/lib/utils'

type Box = [number, number, number, number]
type Seen = { p: PlayerRow; box: Box }

/** 선수 위치 데이터(수 MB)는 경기당 한 번만 받는다 */
const overlayCache = new Map<number, Promise<Overlay | null>>()
function loadOverlay(matchId: number) {
  let p = overlayCache.get(matchId)
  if (!p) {
    p = api.getOverlay(matchId).catch(() => null)
    overlayCache.set(matchId, p)
  }
  return p
}

interface Props {
  matchId: number
  result: MatchResult
  src: string
  rosters: Partial<Record<'home' | 'away', RosterEntry[]>>
  onChanged: () => Promise<void>
}

/**
 * 경기 영상의 한 장면(처음엔 경기 시작 무렵, 선수가 가장 많이 보이는 장면)을 멈춰 놓고
 * 그 화면에 잡힌 선수마다 상자를 그린다. 상자나 아래 확대 사진 옆 칸에 번호·이름을 넣는다.
 * 같은 이름을 넣은 트랙은 서버가 한 선수로 합친다.
 */
export default function KickoffNaming({ matchId, result, src, rosters, onChanged }: Props) {
  const [overlay, setOverlay] = useState<Overlay | null | undefined>(undefined)
  useEffect(() => { loadOverlay(matchId).then(setOverlay) }, [matchId])

  // 합쳐진 조각 id → 지금 기록상의 선수
  const head = useMemo(() => {
    const m = new Map<string, PlayerRow>()
    for (const p of result.players) {
      m.set(p.track_id, p)
      for (const id of p.merged_from) m.set(id, p)
    }
    return m
  }, [result.players])
  const main = useMemo(() => mainRoster(result.players), [result.players])
  // 상대 선수 이름은 모르므로 우리 팀 선수에만 상자를 그린다
  const us = ourTeam(result.match)
  const usName = teamInfo(result.match, us).name

  // 프레임 번호 → 그 프레임에 잡힌 [트랙, 박스]
  const byK = useMemo(() => {
    const m = new Map<number, [string, Box][]>()
    if (!overlay) return m
    for (const [tid, rows] of Object.entries(overlay.tracks ?? {})) {
      for (const r of rows) {
        let a = m.get(r[0])
        if (!a) m.set(r[0], (a = []))
        a.push([tid, [r[1], r[2], r[3], r[4]]])
      }
    }
    return m
  }, [overlay])

  /** 프레임 k에 보이는 선수 (같은 선수 조각이 둘이면 큰 박스 하나), 왼쪽부터 */
  const seenAt = (k: number): Seen[] => {
    const out = new Map<string, Seen>()
    for (const [tid, box] of byK.get(k) ?? []) {
      const p = head.get(tid)
      if (!p || p.excluded || p.team !== us) continue
      const prev = out.get(p.track_id)
      if (!prev || box[3] - box[1] > prev.box[3] - prev.box[1]) out.set(p.track_id, { p, box })
    }
    return [...out.values()].sort((a, b) => a.box[0] - b.box[0])
  }

  /** from~to 사이에서 (점수가 가장 높은) 장면 — 주전 선수가 많이, 이름 없는 선수가 많이 보일수록 높다 */
  const bestFrame = (from: number, to: number, unnamedOnly: boolean): number | null => {
    let best: number | null = null, bestScore = 0
    for (let k = Math.max(0, from); k <= to; k++) {
      const s = seenAt(k)
      if (!s.length) continue
      let score = 0
      for (const { p } of s) {
        if (unnamedOnly && p.display_name) continue
        score += main.has(p.track_id) ? 1 : 0.2
      }
      if (score > bestScore + 0.01) { best = k; bestScore = score }
    }
    return best
  }

  const [k, setK] = useState<number | null>(null)
  const startK = useMemo(() => {
    if (!overlay || !byK.size) return null
    const first = Math.min(...byK.keys())
    return bestFrame(first, first + Math.round(30 / overlay.step), false) ?? first
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, byK])

  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [frameTick, setFrameTick] = useState(0)
  const [videoError, setVideoError] = useState(false)
  const timeOf = (kk: number) => (overlay ? overlay.start_s + kk * overlay.step : 0)
  const kOf = (t: number) => (overlay ? Math.round((t - overlay.start_s) / overlay.step) : 0)

  const seekK = (kk: number) => {
    const v = video.current
    if (!v || !overlay) return
    v.pause()
    setK(kk)
    v.currentTime = Math.max(0, timeOf(kk))
  }
  // 영상 정보와 위치 데이터가 둘 다 준비되면 시작 장면으로
  const [meta, setMeta] = useState(false)
  useEffect(() => {
    if (meta && startK != null && k == null) seekK(startK)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, startK])

  // 재생 중에는 상자를 숨기고, 멈추면 그 장면의 프레임으로 맞춘다
  const onPause = () => {
    setPlaying(false)
    const v = video.current
    if (v && overlay) {
      // 가장 가까운, 선수 위치가 기록된 프레임
      const at = kOf(v.currentTime)
      for (let d = 0; d < 10; d++) {
        if (byK.has(at - d)) { setK(at - d); break }
        if (byK.has(at + d)) { setK(at + d); break }
      }
    }
  }

  const seen = useMemo(() => (k == null ? [] : seenAt(k)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k, byK, head])
  const [active, setActive] = useState<string | null>(null)
  const cards = useRef(new Map<string, HTMLInputElement>())

  const pickBox = (id: string) => {
    setActive(id)
    const el = cards.current.get(id)
    if (el) {
      // 넓은 화면에서는 오른쪽 목록 안에서만 움직여 경기 화면이 계속 보이게
      el.scrollIntoView({ behavior: 'smooth', block: window.matchMedia('(min-width: 1024px)').matches ? 'nearest' : 'center' })
      el.focus({ preventScroll: true })
    }
  }

  const step = (sec: number) => {
    if (k == null || !overlay) return
    const target = k + Math.round(sec / overlay.step)
    for (let d = 0; d < 30; d++) if (byK.has(target + d)) return seekK(target + d)
    seekK(target)
  }
  const nextUnnamed = () => {
    if (k == null || !overlay) return
    const gap = Math.round(3 / overlay.step)
    const win = Math.round(90 / overlay.step)
    const last = Math.max(...byK.keys())
    for (let from = k + gap; from <= last; from += win) {
      const hit = bestFrame(from, Math.min(last, from + win), true)
      if (hit != null) return seekK(hit)
    }
    toast.message('뒤쪽에는 이름 없는 선수가 보이는 장면이 없습니다')
  }

  if (overlay === null || videoError) {
    return <p className="note">이 분석에는 영상 위 선수 위치 데이터가 없어, 아래 카드에서 이름을 넣어 주세요.</p>
  }

  const W = overlay?.w ?? 1920, H = overlay?.h ?? 1080
  const named = seen.filter(s => s.p.display_name).length
  const unnamedMain = result.players.filter(p => p.team === us && !p.excluded && main.has(p.track_id) && !p.display_name).length

  return (
    <section className="card p-3 sm:p-4 space-y-3" aria-label="경기 화면에서 선수 이름 넣기">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-semibold text-ink-100">경기 화면에서 {usName} 선수 이름 넣기</p>
        <p className="text-xs text-ink-400">
          {k != null && <>이 장면 <span className="num text-ink-200">{fmtClock(timeOf(k) - (result.meta.start_s ?? 0))}</span> · </>}
          보이는 {usName} 선수 <span className="num text-ink-200">{seen.length}</span>명 중 이름 <span className="num text-ink-200">{named}</span>명
          · 주전 중 이름 없는 선수 <span className="num text-ink-200">{unnamedMain}</span>명
        </p>
      </div>
      <p className="text-xs text-ink-500">
        경기 시작 무렵 선수가 가장 많이 보이는 장면입니다. 우리 팀({usName}) 선수에만 상자가 그려지고, 상대 팀은 이름을 넣지 않습니다.
        상자를 누르거나 아래 확대 사진 옆에 번호·이름을 넣으세요.
        같은 이름을 넣은 선수는 자동으로 한 사람으로 합쳐집니다. 안 보이는 선수는 &lsquo;이름 없는 선수 장면&rsquo;으로 넘어가 찾으세요.
      </p>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-3 space-y-3 lg:space-y-0">
      <div className="space-y-3 min-w-0">
      <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: `${W} / ${H}` }}>
        <video ref={video} src={src} muted playsInline preload="auto" className="absolute inset-0 w-full h-full"
          onLoadedMetadata={() => setMeta(true)}
          onSeeked={() => setFrameTick(t => t + 1)}
          onPlay={() => setPlaying(true)} onPause={onPause}
          onError={() => setVideoError(true)} />
        {!playing && seen.map(({ p, box }) => {
          const color = teamInfo(result.match, p.team).color
          const on = active === p.track_id
          const label = p.jersey_number != null && p.display_name ? `${p.jersey_number} ${p.display_name}`
            : p.display_name ?? (p.jersey_number != null ? `${p.jersey_number}번` : '?')
          return (
            <button key={p.track_id} type="button" onClick={() => pickBox(p.track_id)}
              aria-label={`${playerName(p)} 이름 넣기`}
              className="absolute group"
              style={{
                left: `${(box[0] / W) * 100}%`, top: `${(box[1] / H) * 100}%`,
                width: `${((box[2] - box[0]) / W) * 100}%`, height: `${((box[3] - box[1]) / H) * 100}%`,
                minWidth: 14, minHeight: 22,
              }}>
              <span className={cn('absolute inset-0 rounded-sm', on ? 'border-2 border-volt' : 'border')}
                style={on ? undefined : { borderColor: color, boxShadow: '0 0 0 1px rgba(0,0,0,.55)' }} />
              <span className={cn('absolute left-1/2 -translate-x-1/2 bottom-full mb-0.5 whitespace-nowrap rounded px-1 text-[10px] leading-[14px] font-semibold',
                p.display_name ? 'bg-black/70 text-white' : 'bg-amber-400 text-ink-950', on && '!bg-volt !text-ink-950')}>
                {label}
              </span>
            </button>
          )
        })}
        {(overlay === undefined || k == null) && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-300">경기 장면을 불러오는 중…</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => step(-5)} disabled={k == null}>
          <ChevronLeft className="w-4 h-4" />5초
        </button>
        <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" disabled={k == null}
          onClick={() => { const v = video.current; if (v) (v.paused ? v.play().catch(() => undefined) : v.pause()) }}>
          {playing ? <><Pause className="w-4 h-4" />멈추고 상자 보기</> : <><Play className="w-4 h-4" />재생</>}
        </button>
        <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => step(5)} disabled={k == null}>
          5초<ChevronRight className="w-4 h-4" />
        </button>
        <button type="button" className="btn-primary !px-2.5 !py-1.5 text-xs" onClick={nextUnnamed} disabled={k == null}>
          <SkipForward className="w-4 h-4" />이름 없는 선수 장면
        </button>
        {startK != null && k !== startK && (
          <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => seekK(startK)}>시작 장면으로</button>
        )}
      </div>

      </div>

      {!playing && seen.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2 lg:max-h-[560px] lg:overflow-y-auto lg:pr-1 content-start" aria-label="이 장면의 선수">
          {seen.map(({ p, box }) => (
            <NameRow key={`${p.track_id}:${p.display_name ?? ''}:${p.jersey_number ?? ''}`} matchId={matchId} result={result}
              p={p} box={box} video={video} frameTick={frameTick} W={W} H={H} roster={rosters[p.team]}
              active={active === p.track_id} onFocus={() => setActive(p.track_id)}
              inputRef={el => { if (el) cards.current.set(p.track_id, el); else cards.current.delete(p.track_id) }}
              onChanged={onChanged} />
          ))}
        </ul>
      )}
      </div>
    </section>
  )
}

function NameRow({ matchId, result, p, box, video, frameTick, W, H, roster, active, onFocus, inputRef, onChanged }: {
  matchId: number; result: MatchResult; p: PlayerRow; box: Box
  video: RefObject<HTMLVideoElement>; frameTick: number; W: number; H: number
  roster?: RosterEntry[]; active: boolean; onFocus: () => void
  inputRef: (el: HTMLInputElement | null) => void; onChanged: () => Promise<void>
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // 멈춘 영상 프레임에서 이 선수 부분만 잘라 크게 보여 준다
  useEffect(() => {
    const v = video.current, cv = canvas.current
    if (!v || !cv || !v.videoWidth) return
    const sx = v.videoWidth / W, sy = v.videoHeight / H
    const bw = box[2] - box[0], bh = box[3] - box[1]
    const side = Math.max(bh * 1.35, bw * 1.6, 40)
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2
    const x0 = Math.min(Math.max(cx - side / 2, 0), W - side), y0 = Math.min(Math.max(cy - side / 2, 0), H - side)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(v, x0 * sx, y0 * sy, side * sx, side * sy, 0, 0, cv.width, cv.height)
  }, [video, frameTick, box, W, H])

  const [name, setName] = useState(p.display_name ?? '')
  const [num, setNum] = useState(p.jersey_number?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  const dirty = name !== (p.display_name ?? '') || num !== (p.jersey_number?.toString() ?? '')
  const team = teamInfo(result.match, p.team)

  const onName = (v: string) => {
    setName(v)
    const hit = roster?.find(r => r.name === v.trim())
    if (hit && hit.number != null) setNum(String(hit.number))
  }
  const call = async (body: Parameters<typeof api.updatePlayer>[2], ok: (merged?: string | null) => string) => {
    setBusy(true)
    try {
      const r = await api.updatePlayer(matchId, p.track_id, body)
      await onChanged()
      toast.success(ok(r.merged_into))
    } catch (e) {
      toast.error((e as Error).message)
      setBusy(false)
    }
  }
  const save = () => call({ display_name: name.trim() || null, jersey_number: num.trim() === '' ? null : Number(num) },
    merged => (merged ? `같은 이름의 선수와 합쳤습니다 (${name.trim()})` : '저장했습니다'))

  return (
    <li className={cn('flex gap-2 rounded-lg border p-2', active ? 'border-volt bg-ink-850' : 'border-ink-800')}>
      <canvas ref={canvas} width={160} height={160} className="w-20 h-20 shrink-0 rounded bg-ink-950" aria-hidden />
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-[11px] text-ink-400 truncate">
          <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle ring-1 ring-white/20" style={{ background: team.color }} />
          {team.name}{isGk(p) && ' · GK'} · {p.stats.minutes_tracked.toFixed(0)}분 · 터치 {p.stats.touches}
        </p>
        <div className="flex gap-1.5">
          <input className="input !py-1 !px-2 text-sm w-14 shrink-0" placeholder="번호" inputMode="numeric" value={num}
            onFocus={onFocus} onChange={e => setNum(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="등번호"
            onKeyDown={e => e.key === 'Enter' && dirty && save()} />
          <input ref={inputRef} className="input !py-1 !px-2 text-sm" placeholder={roster?.length ? '이름 (명단에서 고르기)' : '이름'}
            value={name} maxLength={100} list={roster?.length ? `roster-${p.team}` : undefined}
            onFocus={onFocus} onChange={e => onName(e.target.value)} onKeyDown={e => e.key === 'Enter' && dirty && save()} aria-label="이름" />
        </div>
        <div className="flex gap-1.5">
          <button type="button" className="btn-primary !py-1 !px-2 text-xs" disabled={busy || !dirty} onClick={save}>저장</button>
          <button type="button" className="btn-ghost !py-1 !px-2 text-xs" disabled={busy}
            title="심판·관중·벤치처럼 선수가 아니면 기록에서 뺍니다"
            onClick={() => call({ excluded: true }, () => '선수가 아니어서 뺐습니다')}>선수 아님</button>
        </div>
      </div>
    </li>
  )
}
