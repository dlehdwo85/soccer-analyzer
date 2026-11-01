'use client'
import { useMemo, useState } from 'react'
import { MatchResult, PlayerRow, PlayerStats, Team } from '@/lib/types'
import { cn, playerName, teamInfo } from '@/lib/utils'
import PlayerAvatar from './PlayerAvatar'

const METRICS: { label: string; get: (s: PlayerStats) => number; fmt?: (v: number) => string }[] = [
  { label: '볼 터치', get: s => s.touches },
  { label: '점유 시간(초)', get: s => s.possession_s, fmt: v => v.toFixed(0) },
  { label: '패스 성공', get: s => s.passes_completed },
  { label: '패스 성공률', get: s => s.pass_accuracy ?? 0, fmt: v => `${v.toFixed(0)}%` },
  { label: '패스 실패', get: s => s.passes_failed },
  { label: '전진 패스', get: s => s.forward_passes },
  { label: '키패스', get: s => s.key_passes },
  { label: '받은 패스', get: s => s.passes_received },
  { label: '슈팅', get: s => s.shots },
  { label: '유효 슈팅', get: s => s.shots_on_target },
  { label: 'xG', get: s => s.xg, fmt: v => v.toFixed(2) },
  { label: '가로채기', get: s => s.interceptions },
  { label: '볼 탈취', get: s => s.recoveries },
  { label: '볼 뺏김', get: s => s.dispossessed },
]

export default function Compare({ matchId, result }: { matchId: number; result: MatchResult }) {
  const pool = useMemo(() => result.players.filter(p => !p.excluded && !p.minor), [result.players])
  const top = (t: Team) => [...pool].filter(p => p.team === t).sort((a, b) => b.stats.touches - a.stats.touches)[0]
  const [a, setA] = useState(top('home')?.track_id ?? pool[0]?.track_id ?? '')
  const [b, setB] = useState(top('away')?.track_id ?? pool[1]?.track_id ?? '')
  const pa = pool.find(p => p.track_id === a), pb = pool.find(p => p.track_id === b)

  const pick = (value: string, set: (v: string) => void) => (
    <select className="input !py-1.5 text-sm" value={value} onChange={e => set(e.target.value)} aria-label="비교할 선수">
      {(['home', 'away'] as Team[]).map(t => (
        <optgroup key={t} label={teamInfo(result.match, t).name}>
          {pool.filter(p => p.team === t).map(p => <option key={p.track_id} value={p.track_id}>{playerName(p)}</option>)}
        </optgroup>
      ))}
    </select>
  )

  const head = (p: PlayerRow | undefined, right?: boolean) => p && (
    <div className={cn('flex items-center gap-3 mb-3', right && 'flex-row-reverse text-right')}>
      <PlayerAvatar matchId={matchId} match={result.match} player={p} size={52} />
      <div className="min-w-0">
        <p className="font-extrabold text-ink-100 truncate">{playerName(p)}</p>
        <p className="text-xs text-ink-400">{teamInfo(result.match, p.team).name} · {p.stats.minutes_tracked.toFixed(0)}분</p>
      </div>
    </div>
  )

  return (
    <section className="card p-5">
      <div className="grid grid-cols-2 gap-4 mb-2">
        <div>{pick(a, setA)}</div>
        <div>{pick(b, setB)}</div>
      </div>
      <div className="grid grid-cols-2 gap-4 mt-4">
        <div>{head(pa)}</div>
        <div>{head(pb, true)}</div>
      </div>
      {pa && pb && (
        <div className="space-y-3 mt-2">
          {METRICS.map(m => {
            const va = m.get(pa.stats), vb = m.get(pb.stats)
            const max = Math.max(va, vb, 1e-9)
            const f = m.fmt ?? ((v: number) => String(v))
            return (
              <div key={m.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span className={cn('num font-bold', va > vb ? 'text-volt' : 'text-ink-300')}>{f(va)}</span>
                  <span className="text-xs text-ink-400">{m.label}</span>
                  <span className={cn('num font-bold', vb > va ? 'text-volt' : 'text-ink-300')}>{f(vb)}</span>
                </div>
                <div className="flex gap-1 h-1.5">
                  <div className="flex-1 flex justify-end bg-ink-800 rounded-full overflow-hidden">
                    <div className="rounded-full" style={{ width: `${(va / max) * 100}%`, background: teamInfo(result.match, pa.team).color }} />
                  </div>
                  <div className="flex-1 bg-ink-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(vb / max) * 100}%`, background: teamInfo(result.match, pb.team).color }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
