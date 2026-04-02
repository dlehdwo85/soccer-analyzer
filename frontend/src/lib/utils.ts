import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { MatchStatus } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
}

export const STATUS_LABEL: Record<MatchStatus, string> = {
  created:   '생성됨',
  uploaded:  '업로드 완료',
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

export function teamColor(hex: string, alpha = 1) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
