'use client'
import { useEffect, useRef, useState } from 'react'
import { Award } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { MatchResult, MatchSummary, PlayerRow } from '@/lib/types'
import { cn, fmtDateTime, playerName, teamInfo } from '@/lib/utils'
import PlayerAvatar from './PlayerAvatar'

/** AI 경기 요약 — 무엇이 승부를 갈랐나 + 경기 최우수 선수(MOM) 후보. 저장된 요약을 보여 주고, 없으면 새로 받는다. */
export default function MatchSummaryCard({ matchId, result, players, onSelect }: {
  matchId: number; result: MatchResult; players: Map<string, PlayerRow>; onSelect: (p: PlayerRow) => void
}) {
  const [data, setData] = useState<MatchSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.getMatchSummary(matchId)
      .then(r => { if (!cancelled) setData(r) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [matchId])

  const generate = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const r = await api.createMatchSummary(matchId)
      if (alive.current) setData(r)
    } catch (e) {
      if (!alive.current) return
      if (e instanceof ApiError && e.status === 503) setNotice(e.message)
      else setError((e as Error).message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const s = data?.summary
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="ai-summary-title" aria-busy={busy || loading}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 id="ai-summary-title" className="font-semibold text-ink-100">AI 경기 요약</h2>
          <p className="text-[11px] text-ink-500 mt-0.5">
            두 팀 기록만으로 정리한 요약과 MOM 후보입니다
            {data && <> · <span className="num">{fmtDateTime(data.generated_at)}</span></>}
          </p>
        </div>
        <button type="button" onClick={generate} disabled={busy || loading} className={data ? 'btn-secondary' : 'btn-primary'}>
          {busy ? '요약 중… 최대 1분' : data ? '다시 요약' : 'AI 요약 받기'}
        </button>
      </div>

      {notice && <p className="note">{notice}</p>}
      {error && <p className="note-warn">{error}</p>}
      {data?.stale && !busy && <p className="note-warn mb-2">기록이 바뀌어 다시 요약이 필요합니다</p>}
      {loading && <p className="text-xs text-ink-500">불러오는 중…</p>}
      {!loading && !data && !busy && (
        <p className="text-xs text-ink-500">경기를 가른 기록 몇 가지와 MOM 후보를 정리합니다. 단톡방에 공유하기 좋은 길이입니다.</p>
      )}

      {s && (
        <div className={cn('grid md:grid-cols-5 gap-5 transition-opacity', busy && 'opacity-50')}>
          <div className="md:col-span-3 min-w-0">
            <p className="text-ink-100 leading-relaxed">{s.headline}</p>
            {s.key_points.length > 0 && (
              <ul className="list-disc pl-4 mt-3 space-y-1.5 text-sm text-ink-200 leading-relaxed marker:text-ink-600">
                {s.key_points.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            )}
            {s.data_caveats.length > 0 && (
              <p className="text-[11px] text-ink-500 mt-3">주의 · {s.data_caveats.join(' ')}</p>
            )}
          </div>
          <div className="md:col-span-2">
            <p className="label mb-2 flex items-center gap-1.5"><Award className="w-3.5 h-3.5 text-volt" />MOM 후보</p>
            <ol className="space-y-1.5">
              {s.mom.map((m, i) => {
                const p = players.get(m.track_id)
                if (!p) return null
                return (
                  <li key={m.track_id}>
                    <button type="button" onClick={() => onSelect(p)}
                      className={cn('w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left hover:bg-ink-850',
                        i === 0 ? 'border-volt/40 bg-volt/5' : 'border-ink-800')}>
                      <span className={cn('num text-xs font-bold w-4', i === 0 ? 'text-volt' : 'text-ink-500')}>{i + 1}</span>
                      <PlayerAvatar matchId={matchId} match={result.match} player={p} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink-100 truncate">
                          {playerName(p)} <span className="text-[11px] text-ink-500 font-normal">{teamInfo(result.match, p.team).name}</span>
                        </span>
                        <span className="block text-[11px] text-ink-400 truncate">{m.reason}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
              {s.mom.length === 0 && <li className="text-xs text-ink-500">추천할 만한 기록이 없습니다</li>}
            </ol>
          </div>
        </div>
      )}
    </section>
  )
}
