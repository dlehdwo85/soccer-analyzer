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
  group: '출전' | '볼' | '패스' | '슈팅' | '수비'
  /** 기본으로 보이는 열. 나머지는 '모든 항목'을 켰을 때만 보인다 */
  core?: boolean
}

export const STAT_COLS: Col[] = [
  { key: 'min', label: '출전(분)', title: '영상에서 추적된 시간', get: s => s.minutes_tracked, fmt: v => v.toFixed(0), group: '출전', core: true },
  { key: 'touches', label: '볼터치', title: '공을 잡은(점유를 시작한) 횟수', get: s => s.touches, group: '볼', core: true },
  { key: 'poss', label: '점유(초)', get: s => s.possession_s, fmt: v => v.toFixed(0), group: '볼' },
  { key: 'att', label: '패스 시도', get: s => s.passes_attempted, group: '패스', core: true },
  { key: 'cmp', label: '패스 성공', get: s => s.passes_completed, group: '패스', core: true },
  { key: 'fail', label: '패스 실패', title: '차단·아웃 등 이어지지 않은 패스 (시도 − 성공)',
    get: s => s.passes_failed ?? Math.max(0, s.passes_attempted - s.passes_completed), group: '패스', core: true },
  { key: 'acc', label: '성공률', get: s => s.pass_accuracy, fmt: v => `${v.toFixed(0)}%`, group: '패스', core: true },
  { key: 'key', label: '키패스', title: '받은 선수가 8초 안에 슈팅한 패스', get: s => s.key_passes, group: '패스', core: true },
  { key: 'fwd', label: '전진 패스', title: '전진 패스 성공', get: s => s.forward_passes, group: '패스' },
  { key: 'recv', label: '받은 패스', get: s => s.passes_received, group: '패스' },
  { key: 'shots', label: '슈팅', get: s => s.shots, group: '슈팅', core: true },
  { key: 'sot', label: '유효 슈팅', title: '골문 안으로 향한 슈팅', get: s => s.shots_on_target, group: '슈팅', core: true },
  { key: 'xg', label: 'xG', title: '기대 득점 합', get: s => s.xg, fmt: v => v.toFixed(2), group: '슈팅' },
  { key: 'int', label: '가로채기', get: s => s.interceptions, group: '수비', core: true },
  { key: 'rec', label: '볼 탈취', title: '상대 볼을 빼앗음', get: s => s.recoveries, group: '수비', core: true },
  { key: 'lost', label: '볼 뺏김', get: s => s.dispossessed, group: '수비' },
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
  const [showAll, setShowAll] = useState(false)
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'touches', desc: true })

  const cols = useMemo(() => STAT_COLS.filter(c => showAll || c.core), [showAll])
  const sortCol = cols.find(c => c.key === sort.key) ?? cols.find(c => c.key === 'touches') ?? cols[0]

  const rows = useMemo(() => players
    .filter(p => !p.excluded && (showMinor || !p.minor) && (team === 'all' || p.team === team))
    .sort((a, b) => {
      const av = sortCol.get(a.stats) ?? -1, bv = sortCol.get(b.stats) ?? -1
      return sort.desc ? bv - av : av - bv
    }), [players, team, showMinor, sort.desc, sortCol])
  const minorCount = players.filter(p => p.minor && !p.excluded).length
  const best = useMemo(() => Object.fromEntries(cols.map(c => [c.key, Math.max(...rows.map(r => c.get(r.stats) ?? -Infinity))])), [cols, rows])

  const isGroupStart = (i: number) => i > 0 && cols[i - 1].group !== cols[i].group

  return (
    <section className="card overflow-hidden" aria-label="선수별 기록">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-ink-800">
        <div className="flex items-center gap-1.5" role="group" aria-label="팀 선택">
          {(['all', 'home', 'away'] as const).map(t => (
            <button key={t} type="button" onClick={() => setTeam(t)} className={cn('chip', team === t && 'chip-on')} aria-pressed={team === t}>
              {t !== 'all' && <span className="w-2 h-2 rounded-sm" style={{ background: teamInfo(match, t).color }} aria-hidden />}
              {t === 'all' ? '전체' : teamInfo(match, t).name}
            </button>
          ))}
        </div>
        <label className="sm:ml-auto flex items-center gap-1.5 text-xs text-ink-400 cursor-pointer">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          모든 항목
        </label>
        {minorCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-ink-400 cursor-pointer">
            <input type="checkbox" checked={showMinor} onChange={e => setShowMinor(e.target.checked)} />
            짧게 잡힌 트랙 <span className="num">{minorCount}</span>개 포함
          </label>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm num">
          <thead>
            <tr className="text-[11px] text-ink-400">
              <th scope="col" className="text-left font-medium px-4 py-2 sticky left-0 bg-ink-900 min-w-[160px] z-10">선수</th>
              {cols.map((c, i) => {
                const active = sortCol.key === c.key
                return (
                  <th key={c.key} scope="col" title={c.title}
                    aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                    className={cn('font-medium px-2 py-2 text-right whitespace-nowrap', isGroupStart(i) && 'border-l border-ink-800')}>
                    <button type="button" className={cn('inline-flex items-center gap-0.5 hover:text-ink-100', active && 'text-ink-100')}
                      onClick={() => setSort(s => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}>
                      {c.label}
                      {active && (sort.desc ? <ArrowDown className="w-3 h-3" aria-hidden /> : <ArrowUp className="w-3 h-3" aria-hidden />)}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.track_id} onClick={() => onSelect(p)}
                className="border-t border-ink-800 hover:bg-ink-850 cursor-pointer group">
                <td className="px-4 py-1.5 sticky left-0 bg-ink-900 group-hover:bg-ink-850 z-10">
                  <div className="flex items-center gap-2.5">
                    <PlayerAvatar matchId={matchId} player={p} match={match} size={28} />
                    <div className="min-w-0">
                      <p className="font-medium text-ink-100 truncate max-w-[130px]">{playerName(p)}</p>
                      <p className="text-[11px] text-ink-500 truncate max-w-[130px]">
                        {teamInfo(match, p.team).name}{isGk(p) && ' · GK'}
                      </p>
                    </div>
                  </div>
                </td>
                {cols.map((c, i) => {
                  const v = c.get(p.stats)
                  const top = v !== null && v > 0 && v === best[c.key]
                  return (
                    <td key={c.key} className={cn('px-2 py-1.5 text-right whitespace-nowrap',
                      top ? 'text-volt font-semibold' : v ? 'text-ink-200' : 'text-ink-600',
                      isGroupStart(i) && 'border-l border-ink-800')}>
                      {v === null ? '–' : c.fmt ? c.fmt(v, p.stats) : v}
                    </td>
                  )
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="text-center text-ink-500 py-10">표시할 선수가 없습니다</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 border-t border-ink-800 text-[11px] text-ink-500">
        줄을 누르면 선수별 패스·슈팅 위치를 볼 수 있습니다. 열 제목을 누르면 정렬됩니다. 녹색 숫자는 해당 항목 최고 기록입니다.
      </p>
    </section>
  )
}
