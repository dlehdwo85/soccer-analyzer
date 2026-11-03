'use client'
import { useState } from 'react'
import { Ban, Check, Combine, RotateCcw, Undo2, Users } from 'lucide-react'
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

  const suggestions = sameplayerSuggestions(result)

  const sections: { title: string; rows: PlayerRow[] }[] = (['home', 'away'] as Team[]).map(team => ({
    title: teamInfo(match, team).name,
    rows: result.players.filter(p => p.team === team && !p.excluded && (showMinor || !p.minor)),
  }))
  const excluded = result.players.filter(p => p.excluded)

  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-ink-300 space-y-1">
        <p className="font-semibold text-ink-100">선수 정리</p>
        <p>영상 추적은 한 선수를 여러 트랙으로 나누거나 벤치·관중을 잡을 수 있습니다. 이름과 등번호를 붙이고,
          같은 선수의 트랙을 선택해 <b>합치기</b>, 선수가 아닌 트랙은 <b>제외</b>하세요.
          카드 아래 <b>같은 선수 후보</b>는 카메라가 돌아간 사이 화면 밖에 있다 돌아와 따로 잡혔을 수 있는 선수입니다. 모든 수치에 바로 반영되고 언제든 되돌릴 수 있습니다.</p>
        <p className="text-xs text-ink-500">이름을 붙인 선수는 &lsquo;선수 프로필&rsquo;에서 여러 경기 기록이 합산됩니다.</p>
      </div>

      <div className="sticky top-14 z-20 card p-3 flex flex-wrap items-center gap-2 shadow-lg shadow-black/30">
        <span className="text-sm text-ink-300">{selected.length ? `${selected.length}개 선택` : '합칠 트랙을 선택하세요'}</span>
        {selected.length >= 2 && !sameTeam && <span className="text-xs text-red-300">같은 팀 트랙만 합칠 수 있습니다</span>}
        {selected.length >= 2 && sameTeam && mergeTarget && (
          <span className="text-xs text-ink-500">→ {playerName(mergeTarget)} 기준으로 합침</span>
        )}
        <div className="ml-auto flex gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-400 cursor-pointer mr-2">
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
          <h3 className="text-sm font-semibold text-ink-200 mb-2">{sec.title} · {sec.rows.length}</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {sec.rows.map(p => (
              <TrackCard key={p.track_id} matchId={matchId} result={result} p={p} busy={busy}
                candidates={suggestions.get(p.track_id) ?? []}
                selected={selected.includes(p.track_id)} onToggle={() => toggle(p.track_id)} run={run} />
            ))}
          </div>
        </div>
      ))}

      {excluded.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-ink-200 mb-2">제외된 트랙 · {excluded.length}</h3>
          <div className="flex flex-wrap gap-2">
            {excluded.map(p => (
              <button key={p.track_id} disabled={busy}
                onClick={() => run(() => api.updatePlayer(matchId, p.track_id, { excluded: false }), '제외를 취소했습니다')}
                className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-ink-800 text-xs text-ink-300 hover:bg-ink-700">
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

/** 분석이 남긴 '같은 선수 후보'를 지금의 합치기·제외 상태에 맞춰 선수별로 (최대 3명) */
function sameplayerSuggestions(result: MatchResult): Map<string, PlayerRow[]> {
  const hints = result.meta.merge_hints ?? {}
  const byId = new Map(result.players.map(p => [p.track_id, p]))
  const head = new Map<string, string>()
  for (const p of result.players) {
    head.set(p.track_id, p.track_id)
    for (const m of p.merged_from) head.set(m, p.track_id)
  }
  const out = new Map<string, PlayerRow[]>()
  for (const p of result.players) {
    if (p.excluded) continue
    const seen = new Set<string>([p.track_id])
    const list: PlayerRow[] = []
    for (const id of [p.track_id, ...p.merged_from]) {
      for (const h of hints[id] ?? []) {
        const c = byId.get(head.get(h) ?? '')
        if (!c || seen.has(c.track_id) || c.excluded || c.team !== p.team) continue
        seen.add(c.track_id)
        list.push(c)
      }
    }
    if (list.length) out.set(p.track_id, list.slice(0, 3))
  }
  return out
}

function TrackCard({ matchId, result, p, candidates, selected, onToggle, busy, run }: {
  matchId: number; result: MatchResult; p: PlayerRow; candidates: PlayerRow[]; selected: boolean; busy: boolean
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
    <div className={cn('card p-3 transition-colors', selected && 'ring-2 ring-volt border-volt')}>
      <div className="flex items-start gap-3">
        <button onClick={onToggle} className="relative shrink-0" aria-label="합치기 선택">
          <PlayerAvatar matchId={matchId} match={result.match} player={p} size={52} />
          <span className={cn('absolute -top-1 -left-1 w-5 h-5 rounded-full border-2 border-ink-950 flex items-center justify-center',
            selected ? 'bg-volt' : 'bg-ink-600')}>
            {selected && <Check className="w-3 h-3 text-ink-950" />}
          </span>
        </button>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex gap-1.5">
            <input className="input !py-1 !px-2 text-xs w-12 shrink-0" placeholder="번호" inputMode="numeric" value={num}
              onChange={e => setNum(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="등번호" />
            <input className="input !py-1 !px-2 text-xs" placeholder="이름" value={name} maxLength={100}
              onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && dirty && save()} aria-label="이름" />
          </div>
          <p className="text-[11px] text-ink-500 truncate">
            {p.track_id}{isGk(p) && ' · GK'} · {fmtClock(s.first_seen_s ?? 0)}~{fmtClock(s.last_seen_s ?? 0)} · {s.minutes_tracked.toFixed(0)}분 · 터치 {s.touches}
            {p.minor && ' · 짧은 트랙'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {dirty && <button className="btn-primary !py-1 !px-2 text-xs" disabled={busy} onClick={save}>저장</button>}
        <button className="btn-secondary !py-1 !px-2 text-xs" disabled={busy}
          onClick={() => run(() => api.updatePlayer(matchId, p.track_id, { team: other }), '팀을 바꿨습니다')}>
          <span className="w-2.5 h-2.5 rounded-full border border-ink-600" style={{ background: teamInfo(result.match, other).color }} />
          {teamInfo(result.match, other).name}(으)로
        </button>
        <button className="btn-secondary !py-1 !px-2 text-xs" disabled={busy}
          onClick={() => run(() => api.updatePlayer(matchId, p.track_id, { excluded: true }), '제외했습니다')}>
          <Ban className="w-3 h-3" />제외
        </button>
      </div>
      {candidates.length > 0 && (
        <div className="mt-2 pt-2 border-t border-ink-800">
          <p className="text-[11px] text-ink-500 mb-1 flex items-center gap-1"
            title="카메라가 돌아간 사이 화면 밖에 있다 돌아와 따로 잡혔을 수 있는 같은 팀 선수입니다. 썸네일을 보고 같으면 눌러서 합치세요.">
            <Users className="w-3 h-3" />같은 선수 후보 · 눌러서 합치기
          </p>
          <div className="flex flex-wrap gap-1.5">
            {candidates.map(c => {
              const [target, source] = c.stats.seconds_tracked > s.seconds_tracked ? [c, p] : [p, c]
              return (
                <button key={c.track_id} disabled={busy}
                  title={`${playerName(c)} 트랙과 합치기`}
                  onClick={() => run(() => api.mergePlayers(matchId, target.track_id, [source.track_id]),
                    `${playerName(source)} → ${playerName(target)} 합쳤습니다`)}
                  className="flex items-center gap-1.5 pl-0.5 pr-2 py-0.5 rounded-full bg-ink-800 text-[11px] text-ink-300 hover:bg-volt/15 hover:text-volt">
                  <PlayerAvatar matchId={matchId} match={result.match} player={c} size={26} />
                  {playerName(c)} · {fmtClock(c.stats.first_seen_s ?? 0)}~{fmtClock(c.stats.last_seen_s ?? 0)}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {p.merged_from.length > 0 && (
        <div className="mt-2 pt-2 border-t border-ink-800 flex flex-wrap gap-1">
          <span className="text-[11px] text-ink-500 mr-1">합쳐진 트랙:</span>
          {p.merged_from.map(id => (
            <button key={id} disabled={busy} title="분리"
              onClick={() => run(() => api.unmergePlayer(matchId, id), `${id} 트랙을 분리했습니다`)}
              className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-ink-800 text-ink-300 hover:bg-red-500/15 hover:text-red-300">
              {id}<Undo2 className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
