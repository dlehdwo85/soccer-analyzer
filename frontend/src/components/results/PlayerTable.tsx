'use client'
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Match, PlayerRow, PlayerStats, Team } from '@/lib/types'
import { cn, isGk, playerName, teamInfo } from '@/lib/utils'
import PlayerAvatar from './PlayerAvatar'

type Col = {
  key: string
  label: string
  title?: string
  get: (s: PlayerStats) => number | null
  fmt?: (v: number, s: PlayerStats) => string
}

export const STAT_COLS: Col[] = [
  { key: 'min', label: '출전', title: '추적된 시간(분)', get: s => s.minutes_tracked, fmt: v => `${v.toFixed(0)}′` },
  { key: 'touches', label: '터치', title: '공을 잡은(점유를 시작한) 횟수', get: s => s.touches },
  { key: 'pass', label: '패스', title: '성공 / 시도', get: s => s.passes_completed,
    fmt: (_v, s) => `${s.passes_completed}/${s.passes_attempted}` },
  { key: 'acc', label: '성공률', get: s => s.pass_accuracy, fmt: v => `${v.toFixed(0)}%` },
  { key: 'fail', label: '패스 실패', get: s => s.passes_failed },
  { key: 'fwd', label: '전진', title: '전진 패스 성공', get: s => s.forward_passes },
  { key: 'recv', label: '받은 패스', get: s => s.passes_received },
  { key: 'shots', label: '슈팅', get: s => s.shots },
  { key: 'sot', label: '유효', title: '유효 슈팅(골문 안으로 향함)', get: s => s.shots_on_target },
  { key: 'xg', label: 'xG', title: '기대 득점 합', get: s => s.xg, fmt: v => v.toFixed(2) },
  { key: 'int', label: '가로채기', get: s => s.interceptions },
  { key: 'rec', label: '탈취', title: '상대 볼을 빼앗음', get: s => s.recoveries },
  { key: 'lost', label: '뺏김', get: s => s.dispossessed },
  { key: 'dist', label: '거리', title: '이동거리(m)', get: s => s.distance_m, fmt: v => `${Math.round(v).toLocaleString()}m` },
  { key: 'sprint', label: '스프린트', title: '19.8km/h 이상 1초 이상 지속', get: s => s.sprint_count },
  { key: 'top', label: '최고속도', get: s => s.top_speed_kmh, fmt: v => `${v.toFixed(1)}` },
]

interface Props {
  matchId: number
  match: Match
  players: PlayerRow[]
  onSelect: (p: PlayerRow) => void
  showBall?: boolean
}

export default function PlayerTable({ matchId, match, players, onSelect, showBall = true }: Props) {
  const [team, setTeam] = useState<Team | 'all'>('all')
  const [showMinor, setShowMinor] = useState(false)
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'touches', desc: true })

  const cols = showBall ? STAT_COLS : STAT_COLS.filter(c => ['min', 'dist', 'sprint', 'top'].includes(c.key))
  const rows = useMemo(() => {
    const col = STAT_COLS.find(c => c.key === sort.key) ?? STAT_COLS[1]
    return players
      .filter(p => !p.excluded && (showMinor || !p.minor) && (team === 'all' || p.team === team))
      .sort((a, b) => {
        const av = col.get(a.stats) ?? -1, bv = col.get(b.stats) ?? -1
        return sort.desc ? bv - av : av - bv
      })
  }, [players, team, showMinor, sort])
  const minorCount = players.filter(p => p.minor && !p.excluded).length

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 p-4 border-b border-gray-100">
        {(['all', 'home', 'away'] as const).map(t => (
          <button key={t} onClick={() => setTeam(t)}
            className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              team === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400')}>
            {t === 'all' ? '전체' : teamInfo(match, t).name}
          </button>
        ))}
        {minorCount > 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={showMinor} onChange={e => setShowMinor(e.target.checked)} />
            짧게 잡힌 트랙 {minorCount}개 표시
          </label>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 bg-gray-50">
              <th className="text-left font-medium px-4 py-2 sticky left-0 bg-gray-50 min-w-[160px]">선수</th>
              {cols.map(c => (
                <th key={c.key} title={c.title} className="font-medium px-2 py-2 text-right whitespace-nowrap">
                  <button className="inline-flex items-center gap-0.5 hover:text-gray-900"
                    onClick={() => setSort(s => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}>
                    {c.label}
                    {sort.key === c.key && (sort.desc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.track_id} onClick={() => onSelect(p)}
                className="border-t border-gray-100 hover:bg-green-50/60 cursor-pointer group">
                <td className="px-4 py-2 sticky left-0 bg-white group-hover:bg-green-50">
                  <div className="flex items-center gap-2">
                    <PlayerAvatar matchId={matchId} player={p} match={match} size={28} />
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate max-w-[140px]">{playerName(p)}</p>
                      <p className="text-[11px] text-gray-400">
                        {teamInfo(match, p.team).name}{isGk(p) && ' · GK'}{p.display_name || p.jersey_number != null ? ` · ${p.track_id}` : ''}
                      </p>
                    </div>
                  </div>
                </td>
                {cols.map(c => {
                  const v = c.get(p.stats)
                  return (
                    <td key={c.key} className="px-2 py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">
                      {v === null ? '–' : c.fmt ? c.fmt(v, p.stats) : v}
                    </td>
                  )
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="text-center text-gray-400 py-10">표시할 선수가 없습니다</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
