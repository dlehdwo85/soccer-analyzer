'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Save } from 'lucide-react'
import { api } from '@/lib/api'
import { Club, MatchInput } from '@/lib/types'
import ColorPicker from './ColorPicker'

export const DEFAULT_MATCH: MatchInput = {
  title: '',
  date: new Date().toISOString().split('T')[0],
  field_type: 'soccer',
  home_team_name: '홈팀',
  away_team_name: '원정팀',
  home_team_color: '#2563eb',
  away_team_color: '#dc2626',
  referee_color: '#facc15',
  home_gk_color: null,
  away_gk_color: null,
  home_attacks: 'auto',
  halftime_s: null,
  home_team_id: null,
  away_team_id: null,
}

function parseClock(v: string): number | null {
  const s = v.trim()
  if (!s) return null
  const parts = s.split(':').map(Number)
  if (parts.some(n => Number.isNaN(n))) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

function clock(sec: number | null): string {
  if (sec === null) return ''
  const m = Math.floor(sec / 60), s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

interface Props {
  initial: MatchInput
  submitLabel: string
  onSubmit: (v: MatchInput) => Promise<void>
  onCancel?: () => void
}

export default function MatchForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState<MatchInput>(initial)
  const [half, setHalf] = useState(clock(initial.halftime_s))
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof MatchInput>(k: K, v: MatchInput[K]) => setForm(f => ({ ...f, [k]: v }))
  const [clubs, setClubs] = useState<Club[]>([])
  useEffect(() => { api.getClubs().then(setClubs).catch(() => setClubs([])) }, [])
  const pickClub = (side: 'home' | 'away', id: string) => {
    const c = clubs.find(x => String(x.id) === id)
    setForm(f => side === 'home'
      ? { ...f, home_team_id: c?.id ?? null, ...(c ? { home_team_name: c.name, home_team_color: c.color } : {}) }
      : { ...f, away_team_id: c?.id ?? null, ...(c ? { away_team_name: c.name, away_team_color: c.color } : {}) })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSubmit({ ...form, title: form.title.trim(), halftime_s: parseClock(half) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-ink-100">경기 정보</h2>
        <div>
          <label className="label mb-1 block" htmlFor="title">경기 제목 *</label>
          <input id="title" className="input" placeholder="예) 2026 가을리그 3라운드" value={form.title}
            onChange={e => set('title', e.target.value)} required maxLength={255} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label mb-1 block" htmlFor="date">경기 날짜</label>
            <input id="date" type="date" className="input" value={form.date ?? ''} onChange={e => set('date', e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block" htmlFor="ft">경기 종류</label>
            <select id="ft" className="input" value={form.field_type} onChange={e => set('field_type', e.target.value as MatchInput['field_type'])}>
              <option value="soccer">축구 (11인제, 105×68m)</option>
              <option value="futsal">풋살 (5인제, 40×20m)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-5">
        <div>
          <h2 className="font-semibold text-ink-100">유니폼 색상</h2>
          <p className="text-xs text-ink-400 mt-1">
            영상 속 사람을 이 색으로 홈·원정·골키퍼·심판으로 나눕니다. 대략 맞으면 분석 초반에 실제 영상의 색으로 자동 보정됩니다.
            상의 색 기준이며, 줄무늬 유니폼은 더 넓게 보이는 색을 고르세요.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-6">
          {(['home', 'away'] as const).map(side => (
            <div key={side} className="space-y-3">
              <div>
                <label className="label mb-1 block" htmlFor={`club-${side}`}>등록된 팀 (명단·시즌 기록)</label>
                <select id={`club-${side}`} className="input"
                  value={String((side === 'home' ? form.home_team_id : form.away_team_id) ?? '')}
                  onChange={e => pickClub(side, e.target.value)}>
                  <option value="">연결 안 함</option>
                  {clubs.map(c => <option key={c.id} value={c.id}>{c.name} · 명단 {c.roster.length}명</option>)}
                </select>
                {clubs.length === 0 && side === 'home' && (
                  <p className="text-[11px] text-ink-500 mt-1">
                    <Link href="/teams" className="text-volt hover:underline">팀</Link>을 등록하면 명단으로 선수를 정리하고 시즌 기록이 쌓입니다.
                  </p>
                )}
              </div>
              <div>
                <label className="label mb-1 block">{side === 'home' ? '홈팀' : '원정팀'} 이름</label>
                <input className="input" value={side === 'home' ? form.home_team_name : form.away_team_name}
                  onChange={e => set(side === 'home' ? 'home_team_name' : 'away_team_name', e.target.value)} />
              </div>
              <ColorPicker label={`${side === 'home' ? '홈팀' : '원정팀'} 유니폼`}
                value={side === 'home' ? form.home_team_color : form.away_team_color}
                onChange={v => set(side === 'home' ? 'home_team_color' : 'away_team_color', v)} />
              <OptionalColor label={`${side === 'home' ? '홈' : '원정'} 골키퍼 유니폼`}
                value={side === 'home' ? form.home_gk_color : form.away_gk_color}
                onChange={v => set(side === 'home' ? 'home_gk_color' : 'away_gk_color', v)} />
            </div>
          ))}
        </div>
        <OptionalColor label="심판 유니폼 (분석에서 제외)" value={form.referee_color} onChange={v => set('referee_color', v)}
          defaultColor="#facc15" />
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-ink-100">공격 방향</h2>
          <p className="text-xs text-ink-400 mt-1">슈팅·전진 패스 판정에 씁니다. 자동이면 골키퍼와 선수 위치로 추정합니다.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label mb-1 block" htmlFor="atk">전반 {form.home_team_name || '홈팀'} 공격 방향 (화면 기준)</label>
            <select id="atk" className="input" value={form.home_attacks} onChange={e => set('home_attacks', e.target.value as MatchInput['home_attacks'])}>
              <option value="auto">자동 추정</option>
              <option value="right">오른쪽 골대 쪽으로 →</option>
              <option value="left">← 왼쪽 골대 쪽으로</option>
            </select>
          </div>
          <div>
            <label className="label mb-1 block" htmlFor="half">후반 시작 시각 (영상 기준, 선택)</label>
            <input id="half" className="input" placeholder="예) 47:30" value={half} onChange={e => setHalf(e.target.value)}
              inputMode="numeric" />
            <p className="text-[11px] text-ink-500 mt-1">입력하면 후반에 공격 방향을 바꿔서 판정합니다. 비우면 한 방향으로 봅니다.</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        {onCancel && <button type="button" onClick={onCancel} className="btn-secondary flex-1 justify-center">취소</button>}
        <button type="submit" disabled={saving || !form.title.trim()} className="btn-primary flex-1 justify-center">
          <Save className="w-4 h-4" />{saving ? '저장 중...' : submitLabel}
        </button>
      </div>
    </form>
  )
}

function OptionalColor({ label, value, onChange, defaultColor = '#f59e0b' }:
  { label: string; value: string | null; onChange: (v: string | null) => void; defaultColor?: string }) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-ink-200 mb-2 cursor-pointer">
        <input type="checkbox" checked={value !== null} onChange={e => onChange(e.target.checked ? defaultColor : null)} />
        {label}
      </label>
      {value !== null && <ColorPicker label="" value={value} onChange={onChange} />}
    </div>
  )
}
