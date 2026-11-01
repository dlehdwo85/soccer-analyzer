'use client'
import { useState } from 'react'
import { Ban, Check, Combine, RotateCcw, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { MatchResult, PlayerRow, Team } from '@/lib/types'
import { cn, fmtClock, isGk, playerName, teamInfo } from '@/lib/utils'
import PlayerAvatar from './PlayerAvatar'

/**
 * 영상 추적은 같은 선수를 여러 트랙으로 나누거나(가려짐·화면 밖), 코치·관중을 잡기도 한다.
 * 여기서 이름·등번호를 붙이고, 같은 사람 트랙을 합치고, 잘못 잡힌 트랙을 제외한다.
 * 모든 수정은 결과 수치에 즉시 반영되고 되돌릴 수 있다.
 */
export default function TrackEditor({ matchId, result, onChanged }:
  { matchId: number; result: MatchResult; onChanged: () => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [showMinor, setShowMinor] = useState(true)
  const { match } = result

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      await onChanged()
      if (ok) toast.success(ok)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))
  const selRows = result.players.filter(p => selected.includes(p.track_id))
  const mergeTarget = [...selRows].sort((a, b) => b.stats.seconds_tracked - a.stats.seconds_tracked)[0]
  const sameTeam = new Set(selRows.map(p => p.team)).size <= 1

  const merge = () => run(async () => {
    await api.mergePlayers(matchId, mergeTarget.track_id, selected.filter(id => id !== mergeTarget.track_id))
    setSelected([])
  }, `${selRows.length}개 트랙을 하나로 합쳤습니다`)

  const sections: { title: string; rows: PlayerRow[] }[] = (['home', 'away'] as Team[]).map(team => ({
    title: teamInfo(match, team).name,
    rows: result.players.filter(p => p.team === team && !p.excluded && (showMinor || !p.minor)),
  }))
  const excluded = result.players.filter(p => p.excluded)

  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-gray-600 space-y-1">
        <p className="font-semibold text-gray-900">선수 정리</p>
        <p>영상 추적은 한 선수를 여러 트랙으로 나누거나 벤치·관중을 잡을 수 있습니다. 이름과 등번호를 붙이고,
          같은 선수의 트랙을 선택해 <b>합치기</b>, 선수가 아닌 트랙은 <b>제외</b>하세요. 모든 수치에 바로 반영되고 언제든 되돌릴 수 있습니다.</p>
        <p className="text-xs text-gray-400">이름을 붙인 선수는 &lsquo;선수 프로필&rsquo;에서 여러 경기 기록이 합산됩니다.</p>
      </div>

      <div className="sticky top-14 z-20 card p-3 flex flex-wrap items-center gap-2 shadow-sm">
        <span className="text-sm text-gray-600">{selected.length ? `${selected.length}개 선택` : '합칠 트랙을 선택하세요'}</span>
        {selected.length >= 2 && !sameTeam && <span className="text-xs text-red-500">같은 팀 트랙만 합칠 수 있습니다</span>}
        {selected.length >= 2 && sameTeam && mergeTarget && (
          <span className="text-xs text-gray-400">→ {playerName(mergeTarget)} 기준으로 합침</span>
        )}
        <div className="ml-auto flex gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer mr-2">
            <input type="checkbox" checked={showMinor} onChange={e => setShowMinor(e.target.checked)} />짧은 트랙 표시
          </label>
          {selected.length > 0 && (
            <button className="btn-secondary !py-1.5 text-xs" onClick={() => setSelected([])}>선택 해제</button>
          )}
          <button className="btn-primary !py-1.5 text-xs" disabled={busy || selected.length < 2 || !sameTeam} onClick={merge}>
            <Combine className="w-3.5 h-3.5" />합치기
          </button>
        </div>
      </div>

      {sections.map(sec => (
        <div key={sec.title}>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">{sec.title} · {sec.rows.length}</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {sec.rows.map(p => (
              <TrackCard key={p.track_id} matchId={matchId} result={result} p={p} busy={busy}
                selected={selected.includes(p.track_id)} onToggle={() => toggle(p.track_id)} run={run} />
            ))}
          </div>
        </div>
      ))}

      {excluded.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">제외된 트랙 · {excluded.length}</h3>
          <div className="flex flex-wrap gap-2">
            {excluded.map(p => (
              <button key={p.track_id} disabled={busy}
                onClick={() => run(() => api.updatePlayer(matchId, p.track_id, { excluded: false }), '제외를 취소했습니다')}
                className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-gray-100 text-xs text-gray-600 hover:bg-gray-200">
                <PlayerAvatar matchId={matchId} match={match} player={p} size={22} />
                {playerName(p)} <RotateCcw className="w-3 h-3" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TrackCard({ matchId, result, p, selected, onToggle, busy, run }: {
  matchId: number; result: MatchResult; p: PlayerRow; selected: boolean; busy: boolean
  onToggle: () => void; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>
}) {
  const [name, setName] = useState(p.display_name ?? '')
  const [num, setNum] = useState(p.jersey_number?.toString() ?? '')
  const dirty = name !== (p.display_name ?? '') || num !== (p.jersey_number?.toString() ?? '')
  const other: Team = p.team === 'home' ? 'away' : 'home'
  const s = p.stats

  const save = () => run(() => api.updatePlayer(matchId, p.track_id, {
    display_name: name.trim() || null,
    jersey_number: num.trim() === '' ? null : Number(num),
  }), '저장했습니다')

  return (
    <div className={cn('card p-3 transition-colors', selected && 'ring-2 ring-green-500 border-green-500')}>
      <div className="flex items-start gap-3">
        <button onClick={onToggle} className="relative shrink-0" aria-label="합치기 선택">
          <PlayerAvatar matchId={matchId} match={result.match} player={p} size={52} />
          <span className={cn('absolute -top-1 -left-1 w-5 h-5 rounded-full border-2 border-white flex items-center justify-center',
            selected ? 'bg-green-600' : 'bg-gray-300')}>
            {selected && <Check className="w-3 h-3 text-white" />}
          </span>
        </button>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex gap-1.5">
            <input className="input !py-1 !px-2 text-xs w-12 shrink-0" placeholder="번호" inputMode="numeric" value={num}
              onChange={e => setNum(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="등번호" />
            <input className="input !py-1 !px-2 text-xs" placeholder="이름" value={name} maxLength={100}
              onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && dirty && save()} aria-label="이름" />
          </div>
          <p className="text-[11px] text-gray-400 truncate">
            {p.track_id}{isGk(p) && ' · GK'} · {fmtClock(s.first_seen_s ?? 0)}~{fmtClock(s.last_seen_s ?? 0)} · {s.minutes_tracked.toFixed(0)}분 · 터치 {s.touches}
            {p.minor && ' · 짧은 트랙'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {dirty && <button className="btn-primary !py-1 !px-2 text-xs" disabled={busy} onClick={save}>저장</button>}
        <button className="btn-secondary !py-1 !px-2 text-xs" disabled={busy}
          onClick={() => run(() => api.updatePlayer(matchId, p.track_id, { team: other }), '팀을 바꿨습니다')}>
          <span className="w-2.5 h-2.5 rounded-full border border-gray-300" style={{ background: teamInfo(result.match, other).color }} />
          {teamInfo(result.match, other).name}(으)로
        </button>
        <button className="btn-secondary !py-1 !px-2 text-xs" disabled={busy}
          onClick={() => run(() => api.updatePlayer(matchId, p.track_id, { excluded: true }), '제외했습니다')}>
          <Ban className="w-3 h-3" />제외
        </button>
      </div>
      {p.merged_from.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap gap-1">
          <span className="text-[11px] text-gray-400 mr-1">합쳐진 트랙:</span>
          {p.merged_from.map(id => (
            <button key={id} disabled={busy} title="분리"
              onClick={() => run(() => api.unmergePlayer(matchId, id), `${id} 트랙을 분리했습니다`)}
              className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600">
              {id}<Undo2 className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
