'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { Match } from '@/lib/types'
import MatchCard from '@/components/match/MatchCard'

/** 정렬 기준 날짜: 경기 날짜(YYYY-MM-DD)가 있으면 그것, 없으면 등록일 */
const sortKey = (m: Match) => (m.date && /^\d{4}-\d{2}-\d{2}/.test(m.date) ? m.date.slice(0, 10) : m.created_at.slice(0, 10))

export default function HomePage() {
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [waking, setWaking] = useState<number | null>(null)

  const load = async () => {
    setMatches(null)
    try {
      await api.waitForBackend(setWaking)
      setWaking(null)
      setBackendOk(true)
      setMatches(await api.getMatches())
    } catch {
      setWaking(null)
      setBackendOk(false)
      setMatches([])
    }
  }
  useEffect(() => { load() }, [])

  // 최근 경기가 위로
  const sorted = useMemo(() => matches
    ? [...matches].sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || b.created_at.localeCompare(a.created_at))
    : null, [matches])
  const done = matches?.filter(m => m.analysis_version === 2).length ?? 0
  const stale = matches?.filter(m => m.video_url && (m.analysis_version !== 2 || m.data_source !== 'video') && m.status !== 'analyzing') ?? []

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5 pb-4 border-b border-ink-800">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-ink-100">경기 기록</h1>
          <p className="text-sm text-ink-400 mt-1">경기 영상에서 유니폼 색으로 팀을 나누고 선수별 볼 터치·패스·슈팅·수비를 기록합니다.</p>
        </div>
        <Link href="/matches/new" className="btn-primary">새 경기 등록</Link>
      </div>

      {waking !== null && (
        <p className="note mb-3" role="status">
          서버에 연결하는 중입니다 (최대 1분) <span className="num text-ink-500 ml-1">{waking}초</span>
        </p>
      )}
      {backendOk === false && (
        <p className="note-warn mb-3" role="alert">
          서버에 연결할 수 없습니다. 서버 주소(NEXT_PUBLIC_API_URL)와 서버 상태를 확인하세요.
        </p>
      )}
      {stale.length > 0 && (
        <p className="note mb-3">
          예전에 올린 영상 <span className="num text-ink-100">{stale.length}</span>개는 새 분석 엔진으로 다시 분석할 수 있습니다.
          <Link href="/videos" className="ml-2 underline underline-offset-2 text-ink-200 hover:text-ink-100">영상 보관함</Link>
        </p>
      )}

      <div className="flex items-center justify-between mb-2 text-xs text-ink-500">
        <p className="num">{matches ? `${matches.length}경기 · 분석 완료 ${done}` : ' '}</p>
        <button type="button" onClick={load} className="hover:text-ink-100" aria-label="경기 목록 새로고침">새로고침</button>
      </div>

      {sorted === null ? (
        <div className="card divide-y divide-ink-800" aria-busy="true">
          {[1, 2, 3].map(i => <div key={i} className="h-[4.5rem] animate-pulse" />)}
        </div>
      ) : sorted.length === 0 ? (
        <div className="card px-4 py-12 text-center">
          <p className="text-ink-200 mb-1">등록된 경기가 없습니다.</p>
          <p className="text-sm text-ink-500 mb-5">경기를 등록하고 영상을 올리면 선수별 기록이 만들어집니다.</p>
          <Link href="/matches/new" className="btn-primary">새 경기 등록</Link>
        </div>
      ) : (
        <div className="card divide-y divide-ink-800">
          {sorted.map(m => <MatchCard key={m.id} match={m} />)}
        </div>
      )}
    </div>
  )
}
