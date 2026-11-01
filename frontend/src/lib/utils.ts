import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { Match, MatchEvent, MatchStatus, PlayerRow, Team } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
}

/** 초 → m:ss (1시간 이상이면 h:mm:ss) */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

export function pct(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined ? '–' : `${v.toFixed(digits)}%`
}

export const STATUS_LABEL: Record<MatchStatus, string> = {
  created:   '생성됨',
  uploaded:  '영상 업로드됨',
  analyzing: '분석 중',
  done:      '분석 완료',
  failed:    '실패',
}

export const STATUS_COLOR: Record<MatchStatus, string> = {
  created:   'bg-gray-100 text-gray-600',
  uploaded:  'bg-blue-100 text-blue-700',
  analyzing: 'bg-yellow-100 text-yellow-700',
  done:      'bg-green-100 text-green-700',
  failed:    'bg-red-100 text-red-700',
}

export const SOURCE_LABEL: Record<string, string> = { video: '영상', gps: 'GPS', sample: '샘플' }

export function teamColor(hex: string, alpha = 1) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** 배경색 위에서 읽기 좋은 글자색 */
export function inkOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111827' : '#ffffff'
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
    if (e.success) return e.detail.forward ? '전진 패스 성공' : '패스 성공'
    if (e.detail.reason === 'out') return '패스 실패 (아웃)'
    if (e.detail.reason === 'intercepted') return '패스 실패 (차단)'
    return '패스 실패'
  }
  if (e.kind === 'shot') {
    if (e.detail.outcome === 'on_target') return '유효 슈팅'
    if (e.detail.outcome === 'blocked') return '슈팅 (블록)'
    return '슈팅 (빗나감)'
  }
  return '볼 탈취'
}

export function eventTone(e: MatchEvent): string {
  if (e.kind === 'shot') return e.detail.outcome === 'on_target' ? 'text-amber-600' : 'text-amber-500'
  if (e.kind === 'recovery') return 'text-violet-600'
  return e.success ? 'text-green-600' : 'text-red-500'
}
