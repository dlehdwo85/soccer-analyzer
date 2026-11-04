'use client'
import { KeyboardEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { MatchEvent, MatchResult, Overlay, PlayerRow, Team } from '@/lib/types'
import { cn, eventLabel, eventTone, fmtClock, inkOn, isDark, playerName, teamInfo } from '@/lib/utils'
import ReelExporter from './ReelExporter'

/** 이벤트 표시가 영상 위에 남는 시간(초) */
const FLASH_S = 1.5
/** 사라지기 시작하는 시점(끝나기 몇 초 전) */
const FADE_S = 0.4
/** 오른쪽 기록 갱신 간격(ms) — 매 프레임 React를 다시 그리지 않는다 */
const PANEL_MS = 250
/** 이벤트를 눌렀을 때 몇 초 앞부터 보여 줄지 */
const LEAD_S = 2
/** 목록에 남겨 둘 지난 이벤트 / 미리 보여 줄 다음 이벤트 수 */
const PAST_N = 8
const ROWS_N = 15
const NEXT_N = 40

const FONT = '600 11px "Pretendard Variable", Pretendard, system-ui, sans-serif'
const BIG_FONT = '700 13px "Pretendard Variable", Pretendard, system-ui, sans-serif'
const TAG_H = 16
const PAD = 4

/** 이벤트 종류별 색 — eventTone()과 같은 계열 */
function eventHex(e: MatchEvent): string {
  if (e.kind === 'shot') return e.detail.outcome === 'on_target' ? '#3fa35b' : '#fcd34d'
  if (e.kind === 'recovery') return '#c4b5fd'
  if (e.kind === 'set_piece') return '#b4bed6'
  return e.success ? '#6ee7b7' : '#fca5a5'
}

const LEGEND: [string, string][] = [
  ['패스 성공', '#6ee7b7'], ['패스 실패', '#fca5a5'], ['유효 슈팅', '#3fa35b'], ['슈팅', '#fcd34d'],
  ['볼 탈취', '#c4b5fd'], ['세트피스', '#b4bed6'],
]

// ── 오버레이 준비 ───────────────────────────────────────────────────────────

interface Track { tid: string; ks: Int32Array; bx: Float32Array }
export interface Prepared {
  w: number; h: number; start: number; step: number
  tracks: Track[]
  ballK: Int32Array; ballXY: Float32Array; ballDet: Uint8Array
}

/** 서버 JSON → 트랙별 형식 배열. 한 번만 만들고 그릴 때는 이진 탐색으로 행을 찾는다 */
export function prepare(ov: Overlay): Prepared {
  const tracks: Track[] = []
  for (const [tid, raw] of Object.entries(ov.tracks ?? {})) {
    if (!raw?.length) continue
    const rows = isSorted(raw) ? raw : [...raw].sort((a, b) => a[0] - b[0])
    const ks = new Int32Array(rows.length)
    const bx = new Float32Array(rows.length * 4)
    rows.forEach((r, i) => {
      ks[i] = r[0]
      bx[i * 4] = r[1]; bx[i * 4 + 1] = r[2]; bx[i * 4 + 2] = r[3]; bx[i * 4 + 3] = r[4]
    })
    tracks.push({ tid, ks, bx })
  }
  const balls = isSorted(ov.ball ?? []) ? (ov.ball ?? []) : [...ov.ball].sort((a, b) => a[0] - b[0])
  const ballK = new Int32Array(balls.length)
  const ballXY = new Float32Array(balls.length * 2)
  const ballDet = new Uint8Array(balls.length)
  balls.forEach((b, i) => {
    ballK[i] = b[0]; ballXY[i * 2] = b[1]; ballXY[i * 2 + 1] = b[2]; ballDet[i] = b[3] ? 1 : 0
  })
  return { w: ov.w, h: ov.h, start: ov.start_s, step: ov.step, tracks, ballK, ballXY, ballDet }
}

function isSorted(rows: readonly (readonly number[])[]): boolean {
  for (let i = 1; i < rows.length; i++) if (rows[i][0] < rows[i - 1][0]) return false
  return true
}

/** 정렬된 배열에서 x 이상인 첫 위치 */
function lowerBound(a: ArrayLike<number>, x: number): number {
  let lo = 0, hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 정렬된 배열에서 x보다 큰 첫 위치 */
function upperBound(a: ArrayLike<number>, x: number): number {
  let lo = 0, hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid] <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}

interface Sample { i: number; j: number; a: number }
const SAMPLE: Sample = { i: 0, j: 0, a: 0 }

/**
 * 프레임 kf(소수)에 쓸 행. 앞뒤 행이 2프레임 안에 모두 있으면 둘을 a 비율로 섞고,
 * 아니면 ±1프레임 안의 가장 가까운 행 하나만 쓴다. 없으면 false.
 */
function sampleAt(ks: Int32Array, kf: number, out: Sample): boolean {
  const n = ks.length
  if (!n) return false
  const hi = lowerBound(ks, kf)
  const lo = hi - 1
  if (hi < n && lo >= 0 && ks[hi] - ks[lo] <= 2) {
    const span = ks[hi] - ks[lo]
    out.i = lo; out.j = hi; out.a = span > 0 ? (kf - ks[lo]) / span : 0
    return true
  }
  let best = -1, bd = Infinity
  if (hi < n && ks[hi] - kf <= 1) { best = hi; bd = ks[hi] - kf }
  if (lo >= 0 && kf - ks[lo] <= 1 && kf - ks[lo] < bd) best = lo
  if (best < 0) return false
  out.i = best; out.j = best; out.a = 0
  return true
}

// ── 캔버스 그리기 ───────────────────────────────────────────────────────────

export interface DrawCfg {
  prep: Prepared | null
  /** 원시 track_id → 합쳐진 대표 선수 */
  headOf: Map<string, PlayerRow>
  labels: Map<string, string>
  names: Map<string, string>
  color: Record<Team, string>
  halo: Record<Team, string>
  ink: Record<Team, string>
  /** 시각 순 이벤트 (선수 따라가기 중이면 그 선수 것만) */
  events: MatchEvent[]
  times: Float64Array
  /** 이벤트 시각 0초의 영상 위치(초) */
  evStart: number
  showBoxes: boolean
  showBall: boolean
  showEvents: boolean
  follow: string
  /** 따라가는 선수 머리 위에 크게 띄울 글 (하이라이트: "P10 · 슈팅") — 선수를 따라 움직인다 */
  followTag?: string
}

interface Placed { head: PlayerRow | null; x1: number; y1: number; x2: number; y2: number }
interface Area { l: number; t: number; r: number; b: number }

const widthCache = new Map<string, number>()
function textW(ctx: CanvasRenderingContext2D, s: string): number {
  let w = widthCache.get(s)
  if (w === undefined) {
    w = ctx.measureText(s).width
    widthCache.set(s, w)
  }
  return w
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function drawBox(ctx: CanvasRenderingContext2D, it: Placed, c: DrawCfg, area: Area,
                 alpha: number, lw: number, withLabel: boolean) {
  const team = it.head?.team
  const color = team ? c.color[team] : '#8a97ba'
  const w = it.x2 - it.x1, h = it.y2 - it.y1
  ctx.globalAlpha = alpha
  // 어떤 배경에서도 보이도록 팀 색 선 밑에 대비되는 테두리를 깐다
  ctx.lineWidth = lw + 2
  ctx.strokeStyle = team ? c.halo[team] : 'rgba(7,11,20,0.5)'
  ctx.strokeRect(it.x1, it.y1, w, h)
  ctx.lineWidth = lw
  ctx.strokeStyle = color
  ctx.strokeRect(it.x1, it.y1, w, h)
  if (withLabel && it.head && team) {
    const text = c.labels.get(it.head.track_id) ?? it.head.track_id
    const tw = textW(ctx, text) + PAD * 2
    const x = clamp(it.x1, area.l, area.r - tw)
    let y = it.y1 - TAG_H - 2
    if (y < area.t) y = it.y1 + 2
    ctx.fillStyle = color
    roundRect(ctx, x, y, tw, TAG_H, 3)
    ctx.fill()
    ctx.fillStyle = c.ink[team]
    ctx.fillText(text, x + PAD, y + TAG_H / 2 + 0.5)
  }
  ctx.globalAlpha = 1
}

/** 선수 머리 위 큰 이름표와 아래를 가리키는 꼭지 (하이라이트 주인공) */
function bigTag(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, area: Area, bg: string, ink: string) {
  ctx.save()
  ctx.font = BIG_FONT
  const h = 22, w = ctx.measureText(text).width + 14
  const x = clamp(cx - w / 2, area.l + 2, area.r - w - 2)
  let y = top - h - 9
  if (y < area.t + 2) y = area.t + 2
  ctx.fillStyle = 'rgba(7,11,20,0.55)'
  roundRect(ctx, x - 1, y - 1, w + 2, h + 2, 6)
  ctx.fill()
  ctx.fillStyle = bg
  roundRect(ctx, x, y, w, h, 5)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx - 6, y + h); ctx.lineTo(cx + 6, y + h); ctx.lineTo(cx, y + h + 7); ctx.closePath()
  ctx.fill()
  ctx.fillStyle = ink
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 7, y + h / 2 + 0.5)
  ctx.restore()
}

/** 어두운 바탕 이름표 (이벤트 표시) */
function tagAt(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  const tw = textW(ctx, text) + PAD * 2
  ctx.fillStyle = 'rgba(7,11,20,0.88)'
  roundRect(ctx, x, y, tw, TAG_H, 3)
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = color
  ctx.stroke()
  ctx.fillStyle = color
  ctx.fillText(text, x + PAD, y + TAG_H / 2 + 0.5)
}

function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string) {
  const ang = Math.atan2(y2 - y1, x2 - x1)
  const head = () => {
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - 8 * Math.cos(ang - 0.45), y2 - 8 * Math.sin(ang - 0.45))
    ctx.lineTo(x2 - 8 * Math.cos(ang + 0.45), y2 - 8 * Math.sin(ang + 0.45))
    ctx.closePath()
  }
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(7,11,20,0.6)'
  ctx.lineWidth = 4
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
  head()
  ctx.fillStyle = color
  ctx.fill()
}

export function drawFrame(cv: HTMLCanvasElement, v: HTMLVideoElement, dpr: number, c: DrawCfg | null) {
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cv.width, cv.height)
  const vw = v.videoWidth, vh = v.videoHeight
  if (!c || !vw || !vh || !cv.width || !cv.height) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  // object-fit: contain — 영상이 실제로 그려진 사각형
  const cw = cv.width / dpr, ch = cv.height / dpr
  const s = Math.min(cw / vw, ch / vh)
  const dw = vw * s, dh = vh * s
  const area: Area = { l: (cw - dw) / 2, t: (ch - dh) / 2, r: (cw + dw) / 2, b: (ch + dh) / 2 }
  const vt = v.currentTime
  ctx.font = FONT
  ctx.textBaseline = 'middle'

  const pos = new Map<string, Placed>()
  const p = c.prep
  if (p && p.step > 0 && p.w > 0 && p.h > 0) {
    // 좌표는 원본 영상 픽셀 — 재생 중인 사본 크기와 달라도 화면 사각형 비율로 맞춘다
    const sx = dw / p.w, sy = dh / p.h
    const kf = (vt - p.start) / p.step
    const placed: Placed[] = []
    for (const tr of p.tracks) {
      if (!sampleAt(tr.ks, kf, SAMPLE)) continue
      const { i, j, a } = SAMPLE
      const b = tr.bx
      const q = (o: number) => b[i * 4 + o] + (b[j * 4 + o] - b[i * 4 + o]) * a
      const it: Placed = {
        head: c.headOf.get(tr.tid) ?? null,
        x1: area.l + q(0) * sx, y1: area.t + q(1) * sy, x2: area.l + q(2) * sx, y2: area.t + q(3) * sy,
      }
      placed.push(it)
      if (it.head && !it.head.excluded && !pos.has(it.head.track_id)) pos.set(it.head.track_id, it)
    }

    const follow = c.follow
    if (c.showBoxes) {
      for (const it of placed) {
        const live = !!it.head && !it.head.excluded
        if (follow && it.head?.track_id === follow) continue  // 따라가는 선수는 맨 위에 굵게
        if (!live) {
          // 제외했거나 명단에 없는 트랙은 아주 흐리게, 이름 없이
          if (!follow) drawBox(ctx, it, c, area, 0.2, 1, false)
          continue
        }
        if (follow) drawBox(ctx, it, c, area, 0.3, 1, false)
        else drawBox(ctx, it, c, area, 1, 1.5, true)
      }
    }
    if (follow) {
      for (const it of placed) {
        if (it.head?.track_id !== follow) continue
        drawBox(ctx, it, c, area, 1, 3, !c.followTag)
        if (c.followTag) bigTag(ctx, c.followTag, (it.x1 + it.x2) / 2, it.y1, area, c.color[it.head.team], c.ink[it.head.team])
        break
      }
    }

    if (c.showBall && sampleAt(p.ballK, kf, SAMPLE)) {
      const { i, j, a } = SAMPLE
      const xy = p.ballXY
      const x = area.l + (xy[i * 2] + (xy[j * 2] - xy[i * 2]) * a) * sx
      const y = area.t + (xy[i * 2 + 1] + (xy[j * 2 + 1] - xy[i * 2 + 1]) * a) * sy
      const detected = p.ballDet[a < 0.5 ? i : j] === 1
      ctx.beginPath()
      ctx.arc(x, y, 4.5, 0, Math.PI * 2)
      if (detected) {
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = 'rgba(7,11,20,0.85)'
        ctx.stroke()
      } else {
        // 검출되지 않고 앞뒤로 이어 붙인 위치
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(7,11,20,0.6)'
        ctx.stroke()
        ctx.setLineDash([2.5, 2.5])
        ctx.lineWidth = 1.5
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
  }

  if (c.showEvents) drawFlashes(ctx, c, vt - c.evStart, pos, area)
}

function drawFlashes(ctx: CanvasRenderingContext2D, c: DrawCfg, rel: number, pos: Map<string, Placed>, area: Area) {
  const { events, times } = c
  const stack = new Map<string, number>()
  let corner = 0
  for (let i = lowerBound(times, rel - FLASH_S); i < events.length && times[i] <= rel; i++) {
    const e = events[i]
    const age = rel - times[i]
    ctx.globalAlpha = age > FLASH_S - FADE_S ? clamp((FLASH_S - age) / FADE_S, 0, 1) : 1
    const color = eventHex(e)
    const from = pos.get(e.player)
    if (e.kind === 'pass' && e.success && e.target && from) {
      const to = pos.get(e.target)
      if (to) arrow(ctx, (from.x1 + from.x2) / 2, (from.y1 + from.y2) / 2, (to.x1 + to.x2) / 2, (to.y1 + to.y2) / 2, color)
    }
    const text = eventLabel(e)
    if (from) {
      const n = stack.get(e.player) ?? 0
      stack.set(e.player, n + 1)
      const tw = textW(ctx, text) + PAD * 2
      const x = clamp((from.x1 + from.x2) / 2 - tw / 2, area.l, area.r - tw)
      let y = from.y1 - TAG_H * 2 - 4 - n * (TAG_H + 2)
      if (y < area.t) y = from.y2 + 2 + n * (TAG_H + 2)  // 위에 자리가 없으면 박스 아래로
      tagAt(ctx, text, x, y, color)
    } else {
      // 박스가 없는 순간(가려짐·오버레이 없음)에는 왼쪽 위에 모아서
      tagAt(ctx, `${c.names.get(e.player) ?? e.player} · ${text}`, area.l + 8, area.t + 8 + corner * (TAG_H + 4), color)
      corner++
    }
  }
  ctx.globalAlpha = 1
}

// ── 기록 집계 ───────────────────────────────────────────────────────────────

interface Counts { touches: number; att: number; comp: number; fail: number; recv: number; shots: number; sot: number; rec: number }
type CountKey = keyof Counts

const COLS: { key: CountKey; short: string; full: string }[] = [
  { key: 'touches', short: '터치', full: '볼터치' },
  { key: 'att', short: '패스', full: '패스 시도' },
  { key: 'comp', short: '성공', full: '패스 성공' },
  { key: 'fail', short: '실패', full: '패스 실패' },
  { key: 'recv', short: '받음', full: '받은 패스' },
  { key: 'shots', short: '슈팅', full: '슈팅' },
  { key: 'sot', short: '유효', full: '유효 슈팅' },
  { key: 'rec', short: '탈취', full: '볼 탈취' },
]

/** 그 칸의 숫자를 만든 이벤트인가 (숫자를 누르면 이 이벤트들만 보여 준다) */
function countedBy(e: MatchEvent, player: string, key: CountKey): boolean {
  switch (key) {
    case 'att': return e.kind === 'pass' && e.player === player
    case 'comp': return e.kind === 'pass' && e.player === player && !!e.success
    case 'fail': return e.kind === 'pass' && e.player === player && !e.success
    case 'recv': return e.kind === 'pass' && e.target === player && !!e.success
    case 'shots': return e.kind === 'shot' && e.player === player
    case 'sot': return e.kind === 'shot' && e.player === player && e.detail.outcome === 'on_target'
    case 'rec': return e.kind === 'recovery' && e.player === player
    default: return false
  }
}

/** upto초(분석 기준)까지의 선수별 누적 — events·poss는 시각 순 */
function tally(events: MatchEvent[], poss: MatchResult['possessions'], upto: number): Map<string, Counts> {
  const m = new Map<string, Counts>()
  const g = (id: string) => {
    let c = m.get(id)
    if (!c) m.set(id, c = { touches: 0, att: 0, comp: 0, fail: 0, recv: 0, shots: 0, sot: 0, rec: 0 })
    return c
  }
  for (const e of events) {
    if (e.t > upto) break
    if (e.kind === 'pass') {
      const c = g(e.player)
      c.att++
      if (e.success) {
        c.comp++
        if (e.target) g(e.target).recv++
      } else c.fail++
    } else if (e.kind === 'shot') {
      const c = g(e.player)
      c.shots++
      if (e.detail.outcome === 'on_target') c.sot++
    } else if (e.kind === 'recovery') {
      g(e.player).rec++
    }
  }
  for (const sp of poss) {
    if (sp[0] > upto) break
    g(sp[3]).touches++
  }
  return m
}

/** 박스 위 이름표: 이름 → 등번호 → 트랙 ID */
export function shortLabel(p: PlayerRow): string {
  const s = p.display_name || (p.jersey_number != null ? String(p.jersey_number) : p.track_id)
  return s.length > 10 ? `${s.slice(0, 9)}…` : s
}

/** 선수 박스·이름표만 그리는 설정 (하이라이트 플레이어용). follow 선수는 굵게 강조 */
export function namesCfg(result: MatchResult, prep: Prepared | null, follow = '', showBoxes = true, followTag?: string): DrawCfg {
  const { match } = result
  const color = { home: match.home_team_color, away: match.away_team_color }
  const headOf = new Map<string, PlayerRow>()
  for (const p of result.players) {
    headOf.set(p.track_id, p)
    for (const t of p.merged_from) headOf.set(t, p)
  }
  return {
    prep, headOf,
    labels: new Map(result.players.map(p => [p.track_id, shortLabel(p)])),
    names: new Map(result.players.map(p => [p.track_id, playerName(p)])),
    color,
    halo: {
      home: isDark(color.home) ? 'rgba(255,255,255,0.55)' : 'rgba(7,11,20,0.55)',
      away: isDark(color.away) ? 'rgba(255,255,255,0.55)' : 'rgba(7,11,20,0.55)',
    },
    ink: { home: inkOn(color.home), away: inkOn(color.away) },
    events: [], times: new Float64Array(0), evStart: 0,
    showBoxes, showBall: false, showEvents: false, follow, followTag,
  }
}

// ── 컴포넌트 ────────────────────────────────────────────────────────────────

interface Props {
  matchId: number
  result: MatchResult
  players: Map<string, PlayerRow>
  src: string | null
}

/** 영상 검수: 분석이 잡은 선수 박스·공·이벤트를 영상 위에 겹쳐 보며, 그 시점까지의 선수별 기록을 확인한다 */
export default function VideoReview(props: Props) {
  if (!props.src) {
    return (
      <p className="note">
        {props.result.meta.source === 'sample'
          ? '샘플 분석에는 영상이 없어 영상 검수를 할 수 없습니다.'
          : '연결된 영상이 없습니다. 경기 페이지에서 영상을 연결하면 분석 결과를 영상 위에 겹쳐 확인할 수 있습니다.'}
      </p>
    )
  }
  return <Review {...props} src={props.src} />
}

type OverlayState = { state: 'loading' | 'ready' | 'missing' | 'error'; data: Overlay | null }

function Review({ matchId, result, players, src }: Props & { src: string }) {
  const { match, meta } = result
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const cfgRef = useRef<DrawCfg | null>(null)
  const drawRef = useRef<(() => void) | null>(null)

  const [ov, setOv] = useState<OverlayState>({ state: 'loading', data: null })
  const [videoError, setVideoError] = useState(false)
  const [showBoxes, setShowBoxes] = useState(true)
  const [showBall, setShowBall] = useState(true)
  const [showEvents, setShowEvents] = useState(true)
  const [followId, setFollowId] = useState('')
  /** 누른 숫자 칸 — 그 숫자를 만든 장면만 목록·영상에 보여 준다 */
  const [focusKey, setFocusKey] = useState<CountKey | null>(null)
  const [namedOnly, setNamedOnly] = useState(() => result.players.some(p => p.display_name && !p.excluded))
  const [now, setNow] = useState(0)
  const [fs, setFs] = useState(false)
  /** 분석 영상 저장 (영상 시각 초 구간) */
  const [rec, setRec] = useState<{ from: number; to: number } | null>(null)
  const [canFs, setCanFs] = useState(false)

  useEffect(() => {
    let alive = true
    setOv({ state: 'loading', data: null })
    api.getOverlay(matchId)
      .then(d => { if (alive) setOv(d ? { state: 'ready', data: d } : { state: 'missing', data: null }) })
      .catch(() => { if (alive) setOv({ state: 'error', data: null }) })
    return () => { alive = false }
  }, [matchId])

  const prep = useMemo(() => (ov.data ? prepare(ov.data) : null), [ov.data])
  const evStart = meta.start_s ?? ov.data?.start_s ?? 0

  // 새로고침 뒤 합쳐지거나 제외된 선수는 따라가기에서 뺀다
  const followRow = followId ? players.get(followId) : undefined
  const follow = followRow && !followRow.excluded ? followId : ''

  const events = useMemo(() => [...result.events].sort((a, b) => a.t - b.t), [result.events])
  const poss = useMemo(() => [...(result.possessions ?? [])].sort((a, b) => a[0] - b[0]), [result.possessions])
  const hasTouches = poss.length > 0
  const shown = useMemo(() => (follow && focusKey ? events.filter(e => countedBy(e, follow, focusKey))
    : follow ? events.filter(e => e.player === follow || e.target === follow) : events),
    [events, follow, focusKey])
  const shownTimes = useMemo(() => Float64Array.from(shown, e => e.t), [shown])

  const headOf = useMemo(() => {
    const m = new Map<string, PlayerRow>()
    for (const p of result.players) {
      m.set(p.track_id, p)
      for (const t of p.merged_from) m.set(t, p)
    }
    return m
  }, [result.players])

  const roster = useMemo(() => result.players.filter(p => !p.excluded)
    .sort((a, b) => a.team.localeCompare(b.team) || Number(a.minor) - Number(b.minor) || playerName(a).localeCompare(playerName(b), 'ko')),
  [result.players])

  const cfg = useMemo<DrawCfg>(() => {
    const color = { home: match.home_team_color, away: match.away_team_color }
    return {
      prep,
      headOf,
      labels: new Map(result.players.map(p => [p.track_id, shortLabel(p)])),
      names: new Map(result.players.map(p => [p.track_id, playerName(p)])),
      color,
      halo: {
        home: isDark(color.home) ? 'rgba(255,255,255,0.55)' : 'rgba(7,11,20,0.55)',
        away: isDark(color.away) ? 'rgba(255,255,255,0.55)' : 'rgba(7,11,20,0.55)',
      },
      ink: { home: inkOn(color.home), away: inkOn(color.away) },
      events: shown,
      times: shownTimes,
      evStart,
      showBoxes,
      showBall,
      showEvents,
      follow,
    }
  }, [prep, headOf, result.players, match.home_team_color, match.away_team_color, shown, shownTimes, evStart,
    showBoxes, showBall, showEvents, follow])

  // 설정이 바뀌면(멈춘 상태에서도) 다시 그린다 — 그리기 루프보다 먼저 선언해야 첫 그리기에 설정이 들어간다
  useEffect(() => {
    cfgRef.current = cfg
    drawRef.current?.()
  }, [cfg])

  // 그리기 루프: 재생 중에는 매 프레임, 멈춤·이동·크기 변경 때는 한 번
  useEffect(() => {
    const v = videoRef.current, cv = canvasRef.current
    if (!v || !cv) return
    let dpr = 1
    let raf = 0
    let lastPanel = -Infinity
    let started = false

    const draw = () => drawFrame(cv, v, dpr, cfgRef.current)
    const pushNow = (force: boolean) => {
      const t = performance.now()
      if (!force && t - lastPanel < PANEL_MS) return
      lastPanel = t
      const start = cfgRef.current?.evStart ?? 0
      setNow(Math.round((v.currentTime - start) * 10) / 10)
    }
    const loop = () => {
      draw()
      pushNow(false)
      raf = !v.paused && !v.ended ? requestAnimationFrame(loop) : 0
    }
    const onPlay = () => { if (!raf) raf = requestAnimationFrame(loop) }
    const onStill = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      draw()
      pushNow(true)
    }
    const onTime = () => { if (v.paused) onStill() }
    const onMeta = () => {
      // 처음 열 때 분석 시작 지점으로
      const start = cfgRef.current?.evStart ?? 0
      if (!started && start > 0 && v.currentTime < start) v.currentTime = start
      started = true
      resize()
    }
    const resize = () => {
      dpr = window.devicePixelRatio || 1
      const w = Math.round(v.clientWidth * dpr), h = Math.round(v.clientHeight * dpr)
      if (cv.width !== w || cv.height !== h) {
        cv.width = w
        cv.height = h
      }
      draw()
    }

    v.addEventListener('play', onPlay)
    v.addEventListener('playing', onPlay)
    v.addEventListener('pause', onStill)
    v.addEventListener('ended', onStill)
    v.addEventListener('seeked', onStill)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('loadeddata', onStill)
    const ro = new ResizeObserver(resize)
    ro.observe(v)
    drawRef.current = draw
    if (v.readyState >= 1) onMeta()
    else resize()

    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      v.removeEventListener('play', onPlay)
      v.removeEventListener('playing', onPlay)
      v.removeEventListener('pause', onStill)
      v.removeEventListener('ended', onStill)
      v.removeEventListener('seeked', onStill)
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('loadeddata', onStill)
      drawRef.current = null
    }
  }, [src, videoError])

  useEffect(() => {
    setCanFs(!!document.fullscreenEnabled)
    const on = () => setFs(!!wrapRef.current && document.fullscreenElement === wrapRef.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* 무시 */ })
    else wrapRef.current?.requestFullscreen().catch(() => { /* 지원하지 않는 브라우저 */ })
  }

  const seekRel = useCallback((rel: number, play = false) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, evStart + rel)
    if (play) v.play().catch(() => { /* 자동재생 차단 시 사용자가 재생 */ })
  }, [evStart])
  const seekEvent = useCallback((e: MatchEvent) => seekRel(e.t - LEAD_S, true), [seekRel])

  const toggleFollow = (id: string) => { setFocusKey(null); setFollowId(f => (f === id ? '' : id)) }
  /** 숫자 칸을 누르면: 그 선수를 따라가며 그 숫자를 만든 장면만 보여 주고, 첫 장면부터 재생 */
  const openCount = (id: string, key: CountKey) => {
    if (follow === id && focusKey === key) { setFocusKey(null); return }
    setFollowId(id)
    setFocusKey(key === 'touches' ? null : key)
    const first = key === 'touches' ? null : events.find(e => countedBy(e, id, key))
    if (first) seekEvent(first)
  }
  const focusLabel = focusKey ? COLS.find(c => c.key === focusKey)?.full ?? null : null

  const dur = meta.duration_s || Math.max(1, ...events.map(e => e.t))
  const half = meta.halftime_rel_s != null && meta.halftime_rel_s > 0 ? meta.halftime_rel_s : null

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
      <div className="space-y-2 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Toggle on={showBoxes} disabled={!prep} onClick={() => setShowBoxes(b => !b)}>박스·이름</Toggle>
          <Toggle on={showBall} disabled={!prep} onClick={() => setShowBall(b => !b)}>공</Toggle>
          <Toggle on={showEvents} onClick={() => setShowEvents(b => !b)}>이벤트 표시</Toggle>
          <label className="flex items-center gap-1.5 text-xs text-ink-400 ml-1">
            선수 따라가기
            <select className="input !w-auto max-w-[180px] !py-1.5 text-xs" value={follow}
              onChange={e => setFollowId(e.target.value)}>
              <option value="">없음</option>
              {(['home', 'away'] as Team[]).map(t => (
                <optgroup key={t} label={teamInfo(match, t).name}>
                  {roster.filter(p => p.team === t).map(p => (
                    <option key={p.track_id} value={p.track_id}>{playerName(p)}{p.minor ? ' (짧은 트랙)' : ''}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {ov.state === 'loading' && <span className="text-xs text-ink-500">선수 박스 불러오는 중</span>}
          {!videoError && (
            <span className="ml-auto flex items-center gap-1">
              <select className="input !w-auto !py-1.5 text-xs" value="" aria-label="분석 영상 저장"
                onChange={e => {
                  const v = videoRef.current
                  const end = evStart + dur
                  const at = v ? v.currentTime : evStart
                  if (e.target.value === 'all') setRec({ from: evStart, to: end })
                  else if (e.target.value) setRec({ from: at, to: Math.min(end, at + Number(e.target.value) * 60) })
                }}>
                <option value="">분석 영상 저장</option>
                <option value="1">지금부터 1분</option>
                <option value="5">지금부터 5분</option>
                <option value="all">처음부터 끝까지</option>
              </select>
              {canFs && <button type="button" className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={toggleFs}>전체 화면</button>}
            </span>
          )}
        </div>

        {ov.state === 'missing' && (
          <p className="note">이 분석에는 영상 검수 데이터가 없습니다. 다시 분석하면 선수 박스가 표시됩니다.</p>
        )}
        {ov.state === 'error' && (
          <p className="note-warn">선수 박스 데이터를 불러오지 못했습니다. 영상과 기록은 그대로 볼 수 있습니다.</p>
        )}

        {videoError ? (
          <p className="note-warn">영상을 불러올 수 없습니다. 저장소 주소나 권한을 확인하세요.</p>
        ) : (
          <div ref={wrapRef} className={cn('relative bg-black overflow-hidden', fs ? 'w-full h-full' : 'rounded-lg border border-ink-800')}>
            <video ref={videoRef} src={src} controls playsInline preload="metadata" disablePictureInPicture
              controlsList={canFs ? 'nofullscreen' : undefined}
              className={cn('block w-full bg-black', fs ? 'h-full' : 'aspect-video')}
              onError={() => setVideoError(true)} />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden />
          </div>
        )}

        <Timeline events={shown} times={shownTimes} dur={dur} now={now} half={half}
          onSeek={t => seekRel(t)} onSeekEvent={seekEvent} />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-500">
          {LEGEND.map(([l, c]) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ background: c }} aria-hidden />{l}
            </span>
          ))}
          <span className="ml-auto">흰 점은 공, 점선 원은 공이 안 보여 앞뒤로 이어 붙인 위치</span>
        </div>
      </div>

      {rec && (
        <ReelExporter src={src} offset={evStart} clips={[]} range={rec} fullCfg={cfg}
          title={`${teamInfo(match, 'home').name} vs ${teamInfo(match, 'away').name} 분석 영상`}
          fileName={`${match.title}_분석영상_${fmtClock(Math.max(0, rec.from - evStart)).replace(':', '분')}초`.replace(/[\/:*?"<>|.\s]+/g, '_')}
          onClose={() => setRec(null)} />
      )}
      <aside className="card overflow-hidden min-w-0" aria-label="지금까지 기록">
        <Records result={result} events={events} poss={poss} hasTouches={hasTouches}
          now={now} follow={follow} focusKey={focusKey} onToggle={toggleFollow} onCount={openCount}
          namedOnly={namedOnly} onNamedOnly={setNamedOnly} />
        <EventList events={shown} times={shownTimes} players={players} result={result} now={now}
          followName={followRow && follow ? `${playerName(followRow)}${focusLabel ? ` · ${focusLabel} ${shown.length}개` : ''}` : null}
          onClearFollow={() => { setFollowId(''); setFocusKey(null) }}
          onSeek={seekEvent} />
      </aside>
    </div>
  )
}

function Toggle({ on, disabled, onClick, children }: { on: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on && !disabled} disabled={disabled} onClick={onClick}
      className={cn('chip disabled:opacity-40 disabled:cursor-not-allowed', on && !disabled && 'chip-on')}>
      {children}
    </button>
  )
}

function Timeline({ events, times, dur, now, half, onSeek, onSeekEvent }: {
  events: MatchEvent[]; times: Float64Array; dur: number; now: number; half: number | null
  onSeek: (t: number) => void; onSeekEvent: (e: MatchEvent) => void
}) {
  const ticks = useMemo(() => events.map(e => (
    <span key={e.id} className="absolute top-1 bottom-1 w-[2px] -ml-px rounded-sm pointer-events-none"
      style={{ left: `${clamp(e.t / dur, 0, 1) * 100}%`, background: eventHex(e) }} />
  )), [events, dur])

  /** 눈금 근처(5px)를 누르면 그 이벤트 앞부터, 아니면 누른 위치로 */
  const onClick = (ev: MouseEvent<HTMLDivElement>) => {
    const r = ev.currentTarget.getBoundingClientRect()
    if (!r.width) return
    const t = clamp((ev.clientX - r.left) / r.width, 0, 1) * dur
    const tol = (5 / r.width) * dur
    let best: MatchEvent | null = null, bd = tol
    for (let i = lowerBound(times, t - tol); i < events.length && times[i] <= t + tol; i++) {
      const d = Math.abs(times[i] - t)
      if (d <= bd) { bd = d; best = events[i] }
    }
    if (best) onSeekEvent(best)
    else onSeek(t)
  }
  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    const step = ev.key === 'ArrowRight' ? 5 : ev.key === 'ArrowLeft' ? -5 : 0
    if (!step) return
    ev.preventDefault()
    onSeek(clamp(now + step, 0, dur))
  }

  return (
    <div role="slider" tabIndex={0} aria-label="영상 위치" aria-valuemin={0} aria-valuemax={Math.round(dur)}
      aria-valuenow={Math.round(clamp(now, 0, dur))} aria-valuetext={fmtClock(now)}
      onClick={onClick} onKeyDown={onKey}
      className="relative h-6 rounded-md bg-ink-950 border border-ink-800 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-volt">
      {half != null && (
        <span className="absolute top-0 bottom-0 w-px bg-ink-500 pointer-events-none" style={{ left: `${(half / dur) * 100}%` }} title="후반 시작" />
      )}
      {ticks}
      <span className="absolute -top-0.5 -bottom-0.5 w-0.5 -ml-px bg-ink-100 rounded-sm pointer-events-none"
        style={{ left: `${clamp(now / dur, 0, 1) * 100}%` }} />
    </div>
  )
}

function Records({ result, events, poss, hasTouches, now, follow, focusKey, onToggle, onCount, namedOnly, onNamedOnly }: {
  result: MatchResult; events: MatchEvent[]; poss: MatchResult['possessions']
  hasTouches: boolean; now: number; follow: string; focusKey: CountKey | null; onToggle: (id: string) => void
  onCount: (id: string, key: CountKey) => void; namedOnly: boolean; onNamedOnly: (v: boolean) => void
}) {
  const cols = hasTouches ? COLS : COLS.filter(c => c.key !== 'touches')
  const totals = useMemo(() => tally(events, poss, Infinity), [events, poss])
  const counts = useMemo(() => tally(events, poss, now), [events, poss, now])
  // 방금 기록이 붙은 선수 (영상 위 이벤트 표시와 같은 시간 동안)
  const recent = useMemo(() => {
    const s = new Set<string>()
    for (const e of events) {
      if (e.t > now) break
      if (e.t > now - FLASH_S) s.add(e.player)
    }
    return s
  }, [events, now])
  // 방금 올라간 칸 (+1 표시) — 선수별로 어느 칸이 올랐는지
  const bumped = useMemo(() => {
    const m = new Map<string, Set<CountKey>>()
    const add = (id: string, k: CountKey) => { let x = m.get(id); if (!x) m.set(id, x = new Set()); x.add(k) }
    for (const e of events) {
      if (e.t > now) break
      if (e.t <= now - FLASH_S) continue
      for (const c of COLS) {
        if (countedBy(e, e.player, c.key)) add(e.player, c.key)
        if (e.target && countedBy(e, e.target, c.key)) add(e.target, c.key)
      }
    }
    return m
  }, [events, now])
  const hasNamed = result.players.some(p => p.display_name && !p.excluded)
  // 트랙이 수백 개인 영상에서 표가 무거워지지 않게 팀마다 기록이 많은 선수부터 ROWS_N명만 (더 보기로 전체)
  const [all, setAll] = useState(false)
  const busy = useMemo(() => {
    const m = new Map<string, number>()
    for (const [id, c] of totals) m.set(id, c.touches + c.att + c.recv + c.shots * 3 + c.rec)
    return m
  }, [totals])
  const zero: Counts = { touches: 0, att: 0, comp: 0, fail: 0, recv: 0, shots: 0, sot: 0, rec: 0 }

  return (
    <div className="border-b border-ink-800">
      <div className="flex items-baseline gap-2 px-3 pt-3 pb-2">
        <h3 className="font-semibold text-ink-100 text-sm">지금까지 기록</h3>
        <span className="text-xs text-ink-400 num ml-auto">분석 시각 {fmtClock(Math.max(0, now))}</span>
      </div>
      <p className="px-3 pb-2 text-[11px] text-ink-500">
        영상이 재생되면 그 순간까지의 기록으로 숫자가 올라갑니다. <b className="text-ink-300">숫자를 누르면</b> 그 숫자가 잡힌 장면을 차례로 볼 수 있습니다.
        {hasNamed && (
          <label className="flex items-center gap-1.5 mt-1 cursor-pointer text-ink-400">
            <input type="checkbox" checked={namedOnly} onChange={e => onNamedOnly(e.target.checked)} />이름 붙인 선수만
          </label>
        )}
      </p>
      <div className="max-h-[360px] overflow-y-auto">
        {(['home', 'away'] as Team[]).map(team => {
          const info = teamInfo(result.match, team)
          const rows = result.players
            .filter(p => p.team === team && !p.excluded && (totals.has(p.track_id) || p.track_id === follow)
              && (!namedOnly || !!p.display_name || p.track_id === follow))
            .map(p => ({ p, c: counts.get(p.track_id) ?? zero }))
            .sort((a, b) => b.c.att - a.c.att || b.c.comp - a.c.comp || b.c.touches - a.c.touches
              || playerName(a.p).localeCompare(playerName(b.p), 'ko'))
          const hidden = !all && !namedOnly ? Math.max(0, rows.length - ROWS_N) : 0
          const keep = hidden ? new Set([...rows].sort((a, b) => (busy.get(b.p.track_id) ?? 0) - (busy.get(a.p.track_id) ?? 0))
            .slice(0, ROWS_N).map(r => r.p.track_id).concat(follow ? [follow] : [])) : null
          const sum = rows.reduce((s, r) => ({ att: s.att + r.c.att, comp: s.comp + r.c.comp }), { att: 0, comp: 0 })
          return (
            <table key={team} className="w-full text-xs num table-fixed">
              <caption className="text-left px-3 py-1.5 bg-ink-850 border-y border-ink-800">
                <span className="flex items-center gap-2">
                  <span className={cn('w-2.5 h-2.5 rounded-sm shrink-0', isDark(info.color) && 'ring-1 ring-white/25')}
                    style={{ background: info.color }} aria-hidden />
                  <span className="font-semibold text-ink-100 truncate">{info.name}</span>
                  <span className="ml-auto text-ink-400 whitespace-nowrap">패스 {sum.comp}/{sum.att}</span>
                </span>
              </caption>
              <thead>
                <tr className="text-[11px] text-ink-500">
                  <th scope="col" className="text-left font-medium pl-3 py-1">선수</th>
                  {cols.map(c => (
                    <th key={c.key} scope="col" className="w-9 text-right font-medium py-1 last:pr-3 last:w-12" title={c.full}>
                      <abbr title={c.full} className="no-underline">{c.short}</abbr>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={cols.length + 1} className="px-3 py-3 text-ink-500">기록된 선수가 없습니다</td></tr>
                )}
                {rows.filter(r => !keep || keep.has(r.p.track_id)).map(({ p, c }) => {
                  const on = p.track_id === follow
                  return (
                    <tr key={p.track_id} onClick={() => onToggle(p.track_id)}
                      className={cn('border-t border-ink-800 cursor-pointer hover:bg-ink-850',
                        recent.has(p.track_id) && 'bg-ink-800/70', on && 'bg-ink-800 shadow-[inset_2px_0_0_#3fa35b]')}>
                      <td className="pl-3 py-1.5 min-w-0">
                        <button type="button" aria-pressed={on} title={on ? '따라가기 해제' : '이 선수 따라가기'}
                          className={cn('block w-full truncate text-left', on ? 'text-ink-100 font-semibold' : 'text-ink-200')}>
                          {playerName(p)}
                        </button>
                      </td>
                      {cols.map(col => {
                        const up = bumped.get(p.track_id)?.has(col.key)
                        const sel = on && focusKey === col.key
                        return (
                          <td key={col.key} className="text-right py-0.5 last:pr-2">
                            <button type="button" title={`${playerName(p)} ${col.full} 장면 보기`}
                              onClick={ev => { ev.stopPropagation(); onCount(p.track_id, col.key) }}
                              className={cn('num w-full text-right rounded px-1 py-1 transition-colors',
                                c[col.key] ? 'text-ink-100 hover:bg-ink-700' : 'text-ink-600',
                                col.key === 'fail' && c[col.key] ? 'text-red-300' : '',
                                up && 'bg-volt text-ink-950 font-semibold', sel && 'ring-1 ring-volt')}>
                              {c[col.key]}{up && <span className="text-[9px] align-top ml-px">+1</span>}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
              {hidden > 0 && (
                <tfoot>
                  <tr><td colSpan={cols.length + 1} className="px-3 py-1.5">
                    <button type="button" className="text-[11px] text-ink-400 hover:text-ink-100" onClick={() => setAll(true)}>
                      기록이 적은 트랙 {hidden}개 더 보기
                    </button>
                  </td></tr>
                </tfoot>
              )}
            </table>
          )
        })}
      </div>
    </div>
  )
}

function EventList({ events, times, players, result, now, followName, onClearFollow, onSeek }: {
  events: MatchEvent[]; times: Float64Array; players: Map<string, PlayerRow>; result: MatchResult; now: number
  followName: string | null; onClearFollow: () => void; onSeek: (e: MatchEvent) => void
}) {
  const idx = upperBound(times, now)
  const past = events.slice(Math.max(0, idx - PAST_N), idx)
  const next = events.slice(idx, idx + NEXT_N)

  const row = (e: MatchEvent, done: boolean) => (
    <li key={e.id}>
      <button type="button" onClick={() => onSeek(e)}
        className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-ink-850', done && 'opacity-60')}>
        <span className="num text-ink-500 w-10 shrink-0">{fmtClock(e.t)}</span>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: teamInfo(result.match, e.team).color }} aria-hidden />
        <span className="flex-1 min-w-0 truncate">
          <span className="font-medium text-ink-100">{playerName(players.get(e.player))}</span>{' '}
          <span className={eventTone(e)}>{eventLabel(e)}</span>
          {e.kind === 'pass' && e.target && (
            <span className="text-ink-400">{e.success ? ' → ' : ' · 차단 '}{playerName(players.get(e.target))}</span>
          )}
        </span>
      </button>
    </li>
  )

  return (
    <div>
      <div className="flex items-baseline gap-2 px-3 pt-3 pb-2">
        <h3 className="font-semibold text-ink-100 text-sm">이벤트</h3>
        {followName ? (
          <span className="text-xs text-ink-400 truncate min-w-0">
            {followName}
            <button type="button" onClick={onClearFollow} className="ml-1.5 text-ink-500 hover:text-ink-100">해제</button>
          </span>
        ) : (
          <span className="text-xs text-ink-500">누르면 2초 앞부터 재생</span>
        )}
        <span className="text-xs text-ink-500 num ml-auto whitespace-nowrap">{idx}/{events.length}</span>
      </div>
      <ul className="max-h-[280px] overflow-y-auto pb-1">
        {events.length === 0 && <li className="px-3 py-6 text-center text-xs text-ink-500">이벤트가 없습니다</li>}
        {past.map(e => row(e, true))}
        {events.length > 0 && (
          <li className="px-3 py-1 text-[11px] text-volt border-y border-ink-800 bg-ink-950 num" aria-current="time">
            지금 {fmtClock(Math.max(0, now))}
          </li>
        )}
        {next.map(e => row(e, false))}
      </ul>
    </div>
  )
}
