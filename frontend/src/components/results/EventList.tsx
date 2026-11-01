'use client'
import { useMemo, useState } from 'react'
import { Play } from 'lucide-react'
import { EventKind, MatchResult, PlayerRow, Team } from '@/lib/types'
import { cn, eventLabel, eventTone, fmtClock, playerName, teamInfo } from '@/lib/utils'

const KINDS: { key: EventKind | 'fail' | 'all'; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'shot', label: '슈팅' },
  { key: 'pass', label: '패스' },
  { key: 'fail', label: '패스 실패' },
  { key: 'recovery', label: '볼 탈취' },
]

export default function EventList({ result, players, onSeek, canSeek }:
  { result: MatchResult; players: Map<string, PlayerRow>; onSeek: (t: number) => void; canSeek: boolean }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]['key']>('shot')
  const [team, setTeam] = useState<Team | 'all'>('all')
  const [who, setWho] = useState('')

  const list = useMemo(() => result.events.filter(e => {
    if (team !== 'all' && e.team !== team) return false
    if (who && e.player !== who && e.target !== who) return false
    if (kind === 'all') return true
    if (kind === 'fail') return e.kind === 'pass' && !e.success
    return e.kind === kind
  }), [result.events, kind, team, who])

  const named = [...players.values()].filter(p => !p.excluded && !p.minor)
    .sort((a, b) => a.team.localeCompare(b.team) || playerName(a).localeCompare(playerName(b), 'ko'))
  const dur = result.meta.duration_s || Math.max(1, ...result.events.map(e => e.t))

  return (
    <div className="card">
      <div className="p-4 border-b border-gray-100 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map(k => (
            <button key={k.key} onClick={() => setKind(k.key)}
              className={cn('px-3 py-1 rounded-full text-xs font-medium', kind === k.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600')}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input !w-auto !py-1.5 text-xs" value={team} onChange={e => setTeam(e.target.value as Team | 'all')}>
            <option value="all">양 팀</option>
            <option value="home">{result.match.home_team_name}</option>
            <option value="away">{result.match.away_team_name}</option>
          </select>
          <select className="input !w-auto !py-1.5 text-xs max-w-[200px]" value={who} onChange={e => setWho(e.target.value)}>
            <option value="">모든 선수</option>
            {named.map(p => (
              <option key={p.track_id} value={p.track_id}>
                {teamInfo(result.match, p.team).name} · {playerName(p)}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-400 self-center ml-auto">{list.length}개</span>
        </div>
        {/* 경기 시간축 위 이벤트 분포 */}
        <div className="relative h-6 bg-gray-50 rounded">
          {list.map(e => (
            <button key={e.id} onClick={() => canSeek && onSeek(e.t)} title={`${fmtClock(e.t)} ${eventLabel(e)}`}
              className="absolute top-1 bottom-1 w-[3px] -ml-px rounded-sm"
              style={{ left: `${(e.t / dur) * 100}%`, background: teamInfo(result.match, e.team).color, outline: '1px solid rgba(0,0,0,.15)' }} />
          ))}
        </div>
      </div>
      <div className="max-h-[560px] overflow-y-auto divide-y divide-gray-100">
        {list.length === 0 && <p className="text-sm text-gray-400 text-center py-10">조건에 맞는 이벤트가 없습니다</p>}
        {list.map(e => {
          const t = teamInfo(result.match, e.team)
          return (
            <button key={e.id} onClick={() => onSeek(e.t)} disabled={!canSeek}
              className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 disabled:cursor-default">
              <span className="tabular-nums text-xs text-gray-400 w-12 shrink-0">{fmtClock(e.t)}</span>
              <span className="w-2.5 h-2.5 rounded-full border border-gray-300 shrink-0" style={{ background: t.color }} />
              <span className="flex-1 min-w-0 text-sm">
                <span className="font-medium text-gray-900">{playerName(players.get(e.player))}</span>{' '}
                <span className={eventTone(e)}>{eventLabel(e)}</span>
                {e.target && (e.kind !== 'shot' || e.detail.outcome === 'blocked') && (
                  <span className="text-gray-500">
                    {e.kind === 'pass' ? (e.success ? ' → ' : ' · 차단: ') : e.kind === 'recovery' ? ' ← ' : ' · 블록: '}
                    {playerName(players.get(e.target))}
                  </span>
                )}
                {e.kind === 'shot' && <span className="text-xs text-gray-400"> · xG {(e.detail.xg ?? 0).toFixed(2)}</span>}
                {e.kind === 'pass' && e.success && e.detail.length_m && (
                  <span className="text-xs text-gray-400"> · {Math.round(e.detail.length_m)}m</span>
                )}
              </span>
              {canSeek && <Play className="w-3.5 h-3.5 text-gray-300 shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
