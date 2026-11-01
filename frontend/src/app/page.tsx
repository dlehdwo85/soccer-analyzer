'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Film, Plus, RefreshCw, ScanSearch, Shirt, Target } from 'lucide-react'
import { api } from '@/lib/api'
import { Match } from '@/lib/types'
import MatchCard from '@/components/match/MatchCard'

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

  const done = matches?.filter(m => m.analysis_version === 2).length ?? 0
  const stale = matches?.filter(m => m.video_url && (m.analysis_version !== 2 || m.data_source !== 'video') && m.status !== 'analyzing') ?? []

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <section className="relative overflow-hidden rounded-3xl border border-ink-800 bg-gradient-to-br from-ink-900 via-ink-900 to-[#12230f] p-6 sm:p-8 mb-8">
        <div className="absolute -right-16 -top-16 w-72 h-72 rounded-full bg-volt/10 blur-3xl" aria-hidden />
        <p className="label !text-volt mb-2">조기축구 경기 영상 분석</p>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-ink-100 leading-tight">
          영상 한 편으로<br className="sm:hidden" /> 선수별 기록을.
        </h1>
        <p className="text-ink-300 mt-3 max-w-xl text-sm sm:text-base">
          유니폼 색으로 팀을 나누고, 공의 움직임을 따라 볼 터치·패스 성공/실패·키패스·유효 슈팅·가로채기를 선수마다 기록합니다.
          잘못 잡힌 장면은 영상을 보며 바로 고칠 수 있습니다.
        </p>
        <div className="flex flex-wrap gap-2 mt-5">
          <Link href="/matches/new" className="btn-primary"><Plus className="w-4 h-4" />새 경기 분석</Link>
          <Link href="/videos" className="btn-secondary"><Film className="w-4 h-4" />올려 둔 영상 보기</Link>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-7 max-w-lg">
          {[
            [Shirt, '유니폼 색 팀 구분', '골키퍼·심판까지'],
            [Target, '선수별 볼 기록', '패스·슈팅·수비'],
            [ScanSearch, '장면 검수', '영상 보며 수정'],
          ].map(([Icon, t, s]) => {
            const I = Icon as typeof Shirt
            return (
              <div key={t as string} className="rounded-2xl bg-ink-950/60 border border-ink-800 p-3">
                <I className="w-4 h-4 text-volt mb-1.5" />
                <p className="text-xs font-bold text-ink-100">{t as string}</p>
                <p className="text-[11px] text-ink-500">{s as string}</p>
              </div>
            )
          })}
        </div>
      </section>

      {waking !== null && (
        <div className="card p-4 mb-6 flex items-center gap-3 border-sky-500/30 bg-sky-500/5 text-sm text-sky-200">
          <span className="w-4 h-4 rounded-full border-2 border-sky-300 border-t-transparent animate-spin shrink-0" />
          무료 서버를 깨우는 중입니다. 오래 쉬었다면 1분 정도 걸릴 수 있어요. <span className="num text-sky-400">{waking}초</span>
        </div>
      )}

      {backendOk === false && (
        <div className="card p-4 mb-6 border-amber-500/30 bg-amber-500/5 text-sm text-amber-200">
          백엔드 서버에 연결할 수 없습니다. 서버 주소(NEXT_PUBLIC_API_URL)와 서버 상태를 확인하세요.
        </div>
      )}

      {stale.length > 0 && (
        <Link href="/videos" className="card-hover p-4 mb-6 flex items-center gap-3 border-sky-500/30 bg-sky-500/5">
          <Film className="w-5 h-5 text-sky-300 shrink-0" />
          <p className="flex-1 text-sm text-ink-200">
            예전에 올린 영상 <b className="text-sky-300">{stale.length}개</b>를 새 분석 엔진으로 다시 분석할 수 있습니다.
          </p>
          <ArrowRight className="w-4 h-4 text-sky-300" />
        </Link>
      )}

      <div className="flex items-end justify-between mb-4">
        <div>
          <h2 className="text-xl font-extrabold text-ink-100">경기</h2>
          {matches && <p className="text-xs text-ink-500 mt-0.5">{matches.length}경기 · 분석 완료 {done}</p>}
        </div>
        <button onClick={load} className="btn-ghost !px-2.5" aria-label="새로고침"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {matches === null ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map(i => <div key={i} className="card h-44 animate-pulse" />)}
        </div>
      ) : matches.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-ink-200 font-bold mb-1">아직 등록된 경기가 없습니다</p>
          <p className="text-sm text-ink-500 mb-5">경기를 등록하고 영상을 올리면 선수별 기록이 만들어집니다.</p>
          <Link href="/matches/new" className="btn-primary"><Plus className="w-4 h-4" />첫 경기 등록</Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {matches.map(m => <MatchCard key={m.id} match={m} />)}
        </div>
      )}
    </div>
  )
}
