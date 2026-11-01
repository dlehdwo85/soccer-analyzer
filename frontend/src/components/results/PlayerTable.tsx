'use client'
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Match, PlayerRow, PlayerStats, Team } from '@/lib/types'
import { cn, isGk, playerName, teamInfo } from '@/lib/utils'
import PlayerAvatar from './PlayerAvatar'

export type Col = {
  key: string
  label: string
  title?: string
  get: (s: PlayerStats) => number | null
  fmt?: (v: number, s: PlayerStats) => string
  group: '볼' | '패스' | '슈팅' | '수비'
}

export const STAT_COLS: Col[] = [
  { key: 'touches', label: '터치', title: '공을 잡은(점유를 시작한) 횟수', get: s => s.touches, group: '볼' },
  { key: 'poss', label: '점유(초)', get: s => s.possession_s, fmt: v => v.toFixed(0), group: '볼' },
  { key: 'pass', label: '패스', title: '성공 / 시도', get: s => s.passes_completed,
    fmt: (_v, s) => `${s.passes_completed}/${s.passes_attempted}`, group: '패스' },
  { key: 'acc', label: '성공률', get: s => s.pass_accuracy, fmt: v => `${v.toFixed(0)}%`, group: '패스' },
  { key: 'fail', label: '실패', title: '패스 실패(차단·아웃)', get: s => s.passes_failed, group: '패스' },
  { key: 'fwd', label: '전진', title: '전진 패스 성공', get: s => s.forward_passes, group: '패스' },
  { key: 'key', label: '키패스', title: '받은 선수가 8초 안에 슈팅한 패스', get: s => s.key_passes, group: '패스' },
  { key: 'recv', label: '받음', title: '받은 패스', get: s => s.passes_received, group: '패스' },
  { key: 'shots', label: '슈팅', get: s => s.shots, group: '슈팅' },
  { key: 'sot', label: '유효', title: '유효 슈팅(골문 안으로 향함)', get: s => s.shots_on_target, group: '슈팅' },
  { key: 'xg', label: 'xG', title: '기대 득점 합', get: s => s.xg, fmt: v => v.toFixed(2), group: '슈팅' },
  { key: 'int', label: '가로채기', get: s => s.interceptions, group: '수비' },
  { key: 'rec', label: '탈취', title: '상대 볼을 빼앗음', get: s => s.recoveries, group: '수비' },
  { key: 'lost', label: '뺏김', get: s => s.dispossessed, group: '수비' },
]

interface Props {
  matchId: number
  match: Match
  players: PlayerRow[]
  onSelect: (p: PlayerRow) => void
}

export default function PlayerTable({ matchId, match, players, onSelect }: Props) {
  const [team, setTeam] = useState<Team | 'all'>('all')
  const [showMinor, setShowMinor] = useState(false)
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'touches', desc: true })

  const rows = useMemo(() => {
    const col = STAT_COLS.find(c => c.key === sort.key) ?? STAT_COLS[0]
    return players
      .filter(p => !p.excluded && (showMinor || !p.minor) && (team === 'all' || p.team === team))
      .sort((a, b) => {
        const av = col.get(a.stats) ?? -1, bv = col.get(b.stats) ?? -1
        return sort.desc ? bv - av : av - bv
      })
  }, [players, team, showMinor, sort])
  const minorCount = players.filter(p => p.minor && !p.excluded).length
  const best = useMemo(() => Object.fromEntries(STAT_COLS.map(c => [c.key, Math.max(...rows.map(r => c.get(r.stats) ?? -Infinity))])), [rows])

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 p-4 border-b border-ink-800">
        {(['all', 'home', 'away'] as const).map(t => (
          <button key={t} onClick={() => setTeam(t)} className={cn('chip', team === t && 'chip-on')}>
            {t !== 'all' && <span className="w-2.5 h-2.5 rounded-full" style={{ background: teamInfo(match, t).color }} />}
            {t === 'all' ? '전체' : teamInfo(match, t).name}
          </button>
        ))}
        {minorCount > 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-400 cursor-pointer">
            <input type="checkbox" checked={showMinor} onChange={e => setShowMinor(e.target.checked)} />
            짧게 잡힌 트랙 {minorCount}개 포함
          </label>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-ink-400">
              <th className="text-left font-semibold px-4 py-2.5 sticky left-0 bg-ink-900 min-w-[170px] z-10">선수</th>
              {STAT_COLS.map((c, i) => (
                <th key={c.key} title={c.title}
                  className={cn('font-semibold px-2 py-2.5 text-right whitespace-nowrap', i > 0 && STAT_COLS[i - 1].group !== c.group && 'border-l border-ink-800')}>
                  <button className={cn('inline-flex items-center gap-0.5 hover:text-ink-100', sort.key === c.key && 'text-volt')}
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
                className="border-t border-ink-800 hover:bg-ink-850 cursor-pointer group">
                <td className="px-4 py-2 sticky left-0 bg-ink-900 group-hover:bg-ink-850 z-10">
                  <div className="flex items-center gap-2.5">
                    <PlayerAvatar matchId={matchId} player={p} match={match} size={30} />
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-100 truncate max-w-[130px]">{playerName(p)}</p>
                      <p className="text-[11px] text-ink-500 truncate max-w-[130px]">
                        {teamInfo(match, p.team).name}{isGk(p) && ' · GK'} · {p.stats.minutes_tracked.toFixed(0)}분
                      </p>
                    </div>
                  </div>
                </td>
                {STAT_COLS.map((c, i) => {
                  const v = c.get(p.stats)
                  const top = v !== null && v > 0 && v === best[c.key]
                  return (
                    <td key={c.key} className={cn('px-2 py-2 text-right num whitespace-nowrap',
                      top ? 'text-volt font-bold' : v ? 'text-ink-200' : 'text-ink-600',
                      i > 0 && STAT_COLS[i - 1].group !== c.group && 'border-l border-ink-800')}>
                      {v === null ? '–' : c.fmt ? c.fmt(v, p.stats) : v}
                    </td>
                  )
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={STAT_COLS.length + 1} className="text-center text-ink-500 py-10">표시할 선수가 없습니다</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
