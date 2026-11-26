'use client'
import { RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, SkipForward } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { MatchResult, Overlay, PlayerRow, RosterEntry, Team } from '@/lib/types'
import { cn, fmtClock, isGk, mainRoster, playerName, teamInfo } from '@/lib/utils'

type Box = [number, number, number, number]
/** 한 장면의 한 사람 = 트랙 조각 하나. p는 그 조각이 지금 속한 선수, guessed는 자동 정리가 짐작으로 붙인 조각,
 *  dup은 같은 장면에 같은 선수(확인된 조각)가 둘 이상 — 한 명은 다른 사람이다 */
type Seen = { tid: string; p: PlayerRow; box: Box; guessed: boolean; dup: boolean }

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
  /** 이름을 넣을 팀 — 기본 우리 팀, 사용자가 고르면 상대 팀 */
  team: Team
  /** 이 경기 명단 — 이름 칸에서 누르기만 한다 */
  lineup: string[]
  /** 명단에 없는 이름을 직접 넣으면 명단에도 넣는다 */
  onAddName: (name: string) => Promise<void>
  onChanged: () => Promise<void>
}

/**
 * 경기 영상의 한 장면(처음엔 경기 시작 무렵, 선수가 가장 많이 보이는 장면)을 멈춰 놓고
 * 그 화면에 잡힌 선수마다 상자를 그린다. 상자나 아래 확대 사진 옆 칸에 번호·이름을 넣는다.
 * 같은 이름을 넣은 트랙은 서버가 한 선수로 합친다.
 */
export default function KickoffNaming({ matchId, result, src, rosters, team, lineup, onAddName, onChanged }: Props) {
  const [overlay, setOverlay] = useState<Overlay | null | undefined>(undefined)
  useEffect(() => { loadOverlay(matchId).then(setOverlay) }, [matchId])

  // 조각 id → 지금 기록상의 선수, 그리고 자동 정리가 짐작으로 붙인 조각인지
  const head = useMemo(() => {
    const m = new Map<string, { p: PlayerRow; guessed: boolean }>()
    for (const p of result.players) {
      m.set(p.track_id, { p, guessed: false })
      const g = new Set(p.guessed_from ?? [])
      for (const id of p.merged_from) m.set(id, { p, guessed: g.has(id) })
    }
    return m
  }, [result.players])
  const main = useMemo(() => mainRoster(result.players), [result.players])
  // 고른 팀(기본 우리 팀) 선수에만 상자를 그린다
  const us = team
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

  // 조각마다 처음·마지막으로 보인 시각(초)
  const spans = useMemo(() => {
    const m = new Map<string, [number, number]>()
    if (!overlay) return m
    for (const [tid, rows] of Object.entries(overlay.tracks ?? {})) {
      if (rows.length) m.set(tid, [overlay.start_s + rows[0][0] * overlay.step, overlay.start_s + rows[rows.length - 1][0] * overlay.step])
    }
    return m
  }, [overlay])

  /** 프레임 k에 보이는 우리 팀 사람마다 상자 하나 (같은 선수로 묶인 조각이 둘이어도 둘 다 보여 준다), 왼쪽부터 */
  const seenAt = (k: number): Seen[] => {
    const out: Seen[] = []
    for (const [tid, box] of byK.get(k) ?? []) {
      const h = head.get(tid)
      if (!h || h.p.excluded || h.p.team !== us) continue
      out.push({ tid, p: h.p, box, guessed: h.guessed, dup: false })
    }
    // 같은 장면에 같은 선수가 둘: 확인된 조각끼리면 이름이 잘못 들어간 것이고, 짐작 조각은 그 사람이 아니다
    const conf = new Map<string, number>()
    for (const x of out) if (!x.guessed) conf.set(x.p.track_id, (conf.get(x.p.track_id) ?? 0) + 1)
    for (const x of out) {
      const n = conf.get(x.p.track_id) ?? 0
      if (x.guessed && n > 0) {
        x.guessed = false
        x.p = { ...x.p, display_name: null, jersey_number: null }
      } else if (!x.guessed && n > 1 && x.p.display_name) {
        x.dup = true
      }
    }
    return out.sort((a, b) => a.box[0] - b.box[0])
  }
  /** 사람이 확인한 이름이 붙은 상자 */
  const isNamed = (x: Seen) => !!x.p.display_name && !x.guessed && !x.dup

  /** 이 팀 선수가 화면에 보인 시간 중 이름 확인 / 추정(물음표) / 이름 없음 비율, 그리고 이름 없는 조각 목록(오래 보인 것부터).
   *  장면으로 세면 대부분의 장면에 이름 없는 상자가 하나쯤 있어 끝이 안 보인다 — 조각으로 세어 남은 개수를 보여 준다.
   *  3초도 안 보인 아주 짧은 조각은 빼고 센다 */
  const { progress, todo } = useMemo(() => {
    let named = 0, guessed = 0, none = 0
    const frames = new Map<string, number[]>()
    for (const k of Array.from(byK.keys()).sort((a, b) => a - b)) {
      for (const x of seenAt(k)) {
        if (isNamed(x)) named++
        else if (x.guessed && x.p.display_name) guessed++
        else {
          none++
          let a = frames.get(x.tid)
          if (!a) frames.set(x.tid, (a = []))
          a.push(k)
        }
      }
    }
    const step = overlay?.step ?? 1
    const todo = Array.from(frames.entries())
      .filter(([, ks]) => ks.length * step >= 3)
      .map(([tid, ks]) => ({ tid, k: ks[Math.floor(ks.length / 2)], secs: ks.length * step }))
      .sort((a, b) => b.secs - a.secs)
    const t = named + guessed + none
    return {
      progress: t ? { named: Math.round((100 * named) / t), guessed: Math.round((100 * guessed) / t), none: Math.round((100 * none) / t) } : null,
      todo,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byK, head])

  /** from~to 사이에서 (점수가 가장 높은) 장면 — 주전 선수가 많이, 이름 없는 선수가 많이 보일수록 높다.
   *  이름 없는 장면을 찾을 때는 3초도 안 보인 아주 짧은 조각은 세지 않는다 */
  const bestFrame = (from: number, to: number, unnamedOnly: boolean): number | null => {
    let best: number | null = null, bestScore = 0
    for (let k = Math.max(0, from); k <= to; k++) {
      const s = seenAt(k)
      if (!s.length) continue
      let score = 0
      for (const x of s) {
        if (unnamedOnly && (isNamed(x) || (x.guessed && x.p.display_name) || x.p.stats.seconds_tracked < 3)) continue
        score += main.has(x.p.track_id) ? 1 : 0.2
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
  const cards = useRef(new Map<string, HTMLElement>())

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
  // 이름 없는 조각을 오래 보인 것부터 하나씩 보여 준다. 이름을 넣지 않고 넘긴 조각은 한 바퀴 돌 때까지 다시 고르지 않는다
  const [visited, setVisited] = useState<Set<string>>(new Set())
  const nextUnnamed = () => {
    if (!todo.length) return toast.message(`이름 없는 ${usName} 조각이 없습니다`)
    let pick = todo.find(x => !visited.has(x.tid))
    if (!pick) {
      pick = todo[0]
      setVisited(new Set([pick.tid]))
    } else {
      const id = pick.tid
      setVisited(v => new Set(v).add(id))
    }
    const target = pick
    seekK(target.k)
    setTimeout(() => pickBox(target.tid), 400)
  }
  /** 서버가 알려 준 시각(겹침 오류 등)의 장면으로 */
  const seekTime = (t: number) => {
    if (!overlay) return
    const at = kOf(t)
    for (let d = 0; d < 30; d++) {
      if (byK.has(at + d)) return seekK(at + d)
      if (byK.has(at - d)) return seekK(at - d)
    }
  }

  if (overlay === null || videoError) {
    return <p className="note">이 분석에는 영상 위 선수 위치 데이터가 없어, 아래 카드에서 이름을 넣어 주세요.</p>
  }

  const W = overlay?.w ?? 1920, H = overlay?.h ?? 1080
  const named = seen.filter(isNamed).length
  const unnamedMain = result.players.filter(p => p.team === us && !p.excluded && main.has(p.track_id) && !p.display_name).length

  return (
    <section className="card p-3 sm:p-4 space-y-3" aria-label="경기 화면에서 선수 이름 넣기">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-semibold text-ink-100">경기 화면에서 {usName} 선수 이름 넣기</p>
        <p className="text-xs text-ink-400">
          <span className="text-ink-200">이름 없는 조각 <span className="num text-amber-300">{todo.length}</span>개 남음</span>
          {todo.length > 0 && <> (1분 넘게 보인 큰 조각 <span className="num">{todo.filter(x => x.secs >= 60).length}</span>개)</>} ·{' '}
          {k != null && <>이 장면 <span className="num text-ink-200">{fmtClock(timeOf(k) - (result.meta.start_s ?? 0))}</span> · </>}
          보이는 {usName} 선수 <span className="num text-ink-200">{seen.length}</span>명 중 이름 <span className="num text-ink-200">{named}</span>명
          · 주전 중 이름 없는 선수 <span className="num text-ink-200">{unnamedMain}</span>명
        </p>
      </div>
      {progress && (
        <p className="text-xs text-ink-400">
          {usName} 선수가 화면에 보인 시간 중 이름 확인 <span className="num text-volt">{progress.named}%</span>
          {' '}· 추정(물음표) <span className="num text-amber-300">{progress.guessed}%</span>
          {' '}· 이름 없음 <span className="num text-ink-200">{progress.none}%</span>
          <span className="text-ink-500"> — 이름 없는 조각에 이름을 넣으면, 자동 정리가 같은 사람으로 묶어 둔 다른 장면에도 물음표로 따라 붙습니다.</span>
        </p>
      )}
      <p className="text-xs text-ink-500">
        경기 시작 무렵 선수가 가장 많이 보이는 장면입니다. {usName} 선수에만 상자가 그려집니다.
        다른 팀 선수가 {usName}(으)로 잘못 잡혀 있으면 오른쪽 칸에서 &lsquo;{teamInfo(result.match, us === 'home' ? 'away' : 'home').name} 선수&rsquo;를 눌러 옮기세요.
        상자를 누르고 오른쪽 칸에서 <b>명단의 이름을 누르면</b> 바로 저장됩니다. 이름은 <b>이 장면의 그 사람</b>에게 붙습니다.
        이름 뒤에 물음표가 붙은 상자는 카메라가 끊긴 뒤 자동으로 이어 붙여 본 추정이라, 맞으면 &lsquo;맞음&rsquo;, 틀리면 다른 이름을 누르세요.
        두 사람 이름이 서로 바뀌었으면 한쪽 칸에서 &lsquo;⇄ 이름&rsquo;(이 장면에 이미 있는 이름)을 누르면 맞바뀝니다.
        &lsquo;이름 없는 조각&rsquo; 버튼은 오래 보인 조각부터 하나씩 보여 줍니다.
      </p>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-3 space-y-3 lg:space-y-0">
      <div className="space-y-3 min-w-0">
      <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: `${W} / ${H}` }}>
        <video ref={video} src={src} muted playsInline preload="auto" className="absolute inset-0 w-full h-full"
          onLoadedMetadata={() => setMeta(true)}
          onSeeked={() => setFrameTick(t => t + 1)}
          onPlay={() => setPlaying(true)} onPause={onPause}
          onError={() => setVideoError(true)} />
        {!playing && seen.map(x => {
          const { p, box } = x
          const color = teamInfo(result.match, p.team).color
          const on = active === x.tid
          const base = p.jersey_number != null && p.display_name ? `${p.jersey_number} ${p.display_name}`
            : p.display_name ?? (p.jersey_number != null ? `${p.jersey_number}번` : '?')
          const label = x.guessed && p.display_name ? `${base}?` : x.dup ? `${base} 겹침` : base
          return (
            <button key={x.tid} type="button" onClick={() => pickBox(x.tid)}
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
                x.dup ? 'bg-red-500 text-white' : isNamed(x) ? 'bg-black/70 text-white'
                  : x.guessed && p.display_name ? 'bg-black/70 text-amber-300 ring-1 ring-amber-300' : 'bg-amber-400 text-ink-950',
                on && '!bg-volt !text-ink-950')}>
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
        <button type="button" className="btn-primary !px-2.5 !py-1.5 text-xs" onClick={nextUnnamed} disabled={k == null || !todo.length}
          title="이름 없는 조각을 오래 보인 것부터 하나씩 보여 줍니다">
          <SkipForward className="w-4 h-4" />{todo.length ? `이름 없는 조각 ${todo.length}개 · 다음` : '이름 없는 조각 없음'}
        </button>
        {startK != null && k !== startK && (
          <button type="button" className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => seekK(startK)}>시작 장면으로</button>
        )}
      </div>

      </div>

      {!playing && seen.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2 lg:max-h-[560px] lg:overflow-y-auto lg:pr-1 content-start" aria-label="이 장면의 선수">
          {seen.map(x => (
            <NameRow key={`${x.tid}:${x.p.track_id}:${x.p.display_name ?? ''}:${x.p.jersey_number ?? ''}:${x.guessed}:${x.dup}`}
              matchId={matchId} result={result} s={x} span={spans.get(x.tid)}
              video={video} frameTick={frameTick} W={W} H={H} roster={rosters[x.p.team]}
              lineup={lineup} takenHere={new Map(seen.filter(o => o.tid !== x.tid && isNamed(o)).map(o => [o.p.display_name!, o.tid]))}
              active={active === x.tid} onFocus={() => setActive(x.tid)}
              cardRef={el => { if (el) cards.current.set(x.tid, el); else cards.current.delete(x.tid) }}
              onSeekTime={seekTime} onAddName={onAddName} onChanged={onChanged} />
          ))}
        </ul>
      )}
      </div>
    </section>
  )
}

function NameRow({ matchId, result, s, span, video, frameTick, W, H, roster, lineup, takenHere, active, onFocus, cardRef,
  onSeekTime, onAddName, onChanged }: {
  matchId: number; result: MatchResult; s: Seen; span?: [number, number]
  video: RefObject<HTMLVideoElement>; frameTick: number; W: number; H: number
  roster?: RosterEntry[]; lineup: string[]; takenHere: Map<string, string>; active: boolean; onFocus: () => void
  cardRef: (el: HTMLElement | null) => void; onSeekTime: (t: number) => void
  onAddName: (name: string) => Promise<void>; onChanged: () => Promise<void>
}) {
  const { p, box, tid } = s
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

  const [typing, setTyping] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const team = teamInfo(result.match, p.team)
  const otherTeam: Team = p.team === 'home' ? 'away' : 'home'
  const other = teamInfo(result.match, otherTeam)
  const off = result.meta.start_s ?? 0
  const current = p.display_name && !s.dup ? p.display_name : null
  const names = current && !lineup.includes(current) ? [...lineup, current] : lineup

  const call = async (body: Parameters<typeof api.updatePlayer>[2], ok: (merged?: string | null) => string) => {
    setBusy(true)
    try {
      // 이 장면의 조각(tid)에 넣는다 — 다른 선수로 묶여 있었으면 서버가 떼어 내 따로 이름을 붙인다
      const r = await api.updatePlayer(matchId, tid, body)
      await onChanged()
      toast.success(ok(r.merged_into))
    } catch (e) {
      const msg = (e as Error).message
      // 같은 이름이 같은 장면 다른 자리에 있다는 오류: 그 장면으로 가서 둘을 같이 볼 수 있게
      const m = e instanceof ApiError && e.status === 409 ? msg.match(/(\d+):(\d{2})/) : null
      toast.error(msg, m ? {
        duration: 15000,
        action: { label: '그 장면 보기', onClick: () => onSeekTime(Number(m[1]) * 60 + Number(m[2]) + off + 0.5) },
      } : undefined)
      setBusy(false)
    }
  }
  const pick = (n: string) => {
    const hit = roster?.find(r => r.name === n)
    const jersey = hit?.number ?? (p.display_name === n ? p.jersey_number : null)
    return call({ display_name: n, jersey_number: jersey ?? null },
      merged => (merged ? `같은 이름의 선수와 합쳤습니다 (${n})` : `${n}(으)로 저장했습니다`))
  }
  /** 이 장면에 이미 그 이름이 붙은 다른 상자와 이름을 맞바꾼다 — 두 사람 이름이 서로 바뀌었을 때 */
  const swap = async (n: string, otherTid: string) => {
    setBusy(true)
    try {
      await api.swapPlayers(matchId, tid, otherTid)
      await onChanged()
      toast.success(`${n}와(과) 이름을 맞바꿨습니다`, {
        duration: 12000,
        action: {
          label: '되돌리기',
          onClick: () => { api.swapPlayers(matchId, tid, otherTid).then(onChanged).then(() => toast.success('되돌렸습니다'))
            .catch(e => toast.error((e as Error).message)) },
        },
      })
    } catch (e) {
      toast.error((e as Error).message)
      setBusy(false)
    }
  }
  const saveTyped = async () => {
    const n = name.trim()
    if (!n) return
    if (!lineup.includes(n)) await onAddName(n).catch(() => undefined)
    await pick(n)
  }

  return (
    <li ref={cardRef} tabIndex={-1} onFocus={onFocus} onClick={onFocus}
      className={cn('flex gap-2 rounded-lg border p-2 outline-none', active ? 'border-volt bg-ink-850' : 'border-ink-800')}>
      <canvas ref={canvas} width={160} height={160} className="w-20 h-20 shrink-0 rounded bg-ink-950" aria-hidden />
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-[11px] text-ink-400 truncate">
          <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle ring-1 ring-white/20" style={{ background: team.color }} />
          {team.name}{isGk(p) && ' · GK'}
          {span && <> · 이 조각 <span className="num">{fmtClock(span[0] - off)}~{fmtClock(span[1] - off)}</span></>}
        </p>
        {s.guessed && p.display_name && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-amber-300">추정: {p.display_name}</span>
            <button type="button" className="btn-primary !py-0.5 !px-2 text-xs" disabled={busy} onClick={() => pick(p.display_name!)}>
              맞음
            </button>
            <span className="text-[11px] text-ink-500">아니면 다른 이름을 누르세요</span>
          </div>
        )}
        {s.dup && (
          <p className="text-[11px] text-red-300">이 장면에 &lsquo;{p.display_name}&rsquo;이(가) 둘입니다. 다른 사람이면 다른 이름을 누르세요</p>
        )}
        <div className="flex flex-wrap gap-1" role="group" aria-label="명단에서 이름 고르기">
          {names.map(n => {
            const on = n === current && !s.guessed
            const other = on ? undefined : takenHere.get(n)
            return (
              <button key={n} type="button" disabled={busy || on}
                onClick={() => (other ? swap(n, other) : pick(n))}
                title={other ? `이 장면에 ${n} 상자가 따로 있습니다. 누르면 그 상자와 이름을 맞바꿉니다 (서로 바뀌었을 때)`
                  : on ? '지금 이름' : `${n}(으)로 저장`}
                className={cn('rounded-full border px-2 py-0.5 text-xs',
                  on ? 'border-volt bg-volt/15 text-volt'
                    : other ? 'border-dashed border-ink-600 text-ink-400 hover:border-amber-300 hover:text-amber-300'
                      : 'border-ink-700 text-ink-200 hover:border-volt hover:text-volt')}>
                {other && '⇄ '}{n}
              </button>
            )
          })}
          <button type="button" className="rounded-full border border-dashed border-ink-600 px-2 py-0.5 text-xs text-ink-400 hover:text-ink-200"
            onClick={() => setTyping(t => !t)}>{typing ? '닫기' : lineup.length ? '+ 다른 이름' : '+ 이름 넣기'}</button>
        </div>
        {typing && (
          <div className="flex gap-1.5">
            <input className="input !py-1 !px-2 text-sm" placeholder="명단에 없는 이름 (게스트 등)" autoFocus
              value={name} maxLength={100} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveTyped()} aria-label="이름 직접 넣기" />
            <button type="button" className="btn-primary !py-1 !px-2 text-xs shrink-0" disabled={busy || !name.trim()} onClick={saveTyped}>저장</button>
          </div>
        )}
        <div className="flex gap-1.5">
          <button type="button" className="btn-ghost !py-1 !px-2 text-xs" disabled={busy}
            title={`${other.name} 선수가 ${team.name}(으)로 잘못 잡혔으면 ${other.name} 쪽으로 옮깁니다`}
            onClick={() => call({ team: otherTeam }, () => `${other.name} 선수로 옮겼습니다`)}>
            <span className="inline-block w-2 h-2 rounded-full mr-1 ring-1 ring-white/20" style={{ background: other.color }} />
            {other.name} 선수
          </button>
          <button type="button" className="btn-ghost !py-1 !px-2 text-xs" disabled={busy}
            title="심판·관중·벤치처럼 선수가 아니면 기록에서 뺍니다"
            onClick={() => call({ excluded: true }, () => '선수가 아니어서 뺐습니다')}>선수 아님</button>
        </div>
      </div>
    </li>
  )
}
