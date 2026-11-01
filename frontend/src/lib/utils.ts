import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { Match, MatchEvent, MatchStatus, PlayerRow, Team } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
}

/** 기록표용 짧은 날짜: "2025-10-12" 또는 ISO → "2025.10.12" */
export function fmtDateShort(v: string | null | undefined): string {
  if (!v) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (m) return `${m[1]}.${m[2]}.${m[3]}`
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

/** 초 → m:ss (1시간 이상이면 h:mm:ss) */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

/** "12:34" / "1:02:03" / "95" → 초 */
export function parseClock(v: string): number | null {
  const s = v.trim()
  if (!s) return null
  const parts = s.split(':').map(Number)
  if (parts.some(n => Number.isNaN(n) || n < 0)) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export const STATUS_LABEL: Record<MatchStatus, string> = {
  created:   '영상 대기',
  uploaded:  '분석 대기',
  analyzing: '분석 중',
  done:      '분석 완료',
  failed:    '분석 실패',
}

export const STATUS_COLOR: Record<MatchStatus, string> = {
  created:   'bg-ink-800 text-ink-300 border-ink-700',
  uploaded:  'bg-sky-500/10 text-sky-300 border-sky-500/30',
  analyzing: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  done:      'bg-volt-soft text-volt border-volt/30',
  failed:    'bg-red-500/10 text-red-300 border-red-500/30',
}

export const SOURCE_LABEL: Record<string, string> = { video: '영상', gps: 'GPS(이전)', sample: '샘플' }

/** 배경색 위에서 읽기 좋은 글자색 */
export function inkOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#070b14' : '#ffffff'
}

/** 어두운 바탕에서 너무 어두운 팀 색은 테두리로 보이게 */
export function isDark(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 < 60
}

export function teamInfo(match: Match, team: Team) {
  return team === 'home'
    ? { name: match.home_team_name, color: match.home_team_color }
    : { name: match.away_team_name, color: match.away_team_color }
}

export function playerName(p: Pick<PlayerRow, 'display_name' | 'jersey_number' | 'track_id'> | undefined | null): string {
  if (!p) return '알 수 없음'
  if (p.display_name) return p.jersey_number != null ? `${p.jersey_number}. ${p.display_name}` : p.display_name
  if (p.jersey_number != null) return `${p.jersey_number}번`
  return p.track_id
}

export function isGk(p: PlayerRow) {
  return p.label.endsWith('_gk')
}

export function eventLabel(e: MatchEvent): string {
  if (e.kind === 'pass') {
    if (e.success) return e.detail.forward ? '전진 패스' : '패스 성공'
    if (e.detail.reason === 'out') return '패스 실패 · 아웃'
    if (e.detail.reason === 'intercepted') return '패스 실패 · 차단'
    return '패스 실패'
  }
  if (e.kind === 'shot') {
    if (e.detail.outcome === 'on_target') return '유효 슈팅'
    if (e.detail.outcome === 'blocked') return '슈팅 · 블록'
    return '슈팅 · 빗나감'
  }
  return '볼 탈취'
}

export function eventTone(e: MatchEvent): string {
  if (e.kind === 'shot') return e.detail.outcome === 'on_target' ? 'text-volt' : 'text-amber-300'
  if (e.kind === 'recovery') return 'text-violet-300'
  return e.success ? 'text-emerald-300' : 'text-red-300'
}

export const KIND_LABEL: Record<string, string> = { pass: '패스', shot: '슈팅', recovery: '볼 탈취' }
