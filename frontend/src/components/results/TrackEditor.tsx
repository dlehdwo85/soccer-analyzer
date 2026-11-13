'use client'
import { useEffect, useState } from 'react'
import { Ban, Check, Combine, RotateCcw, ScanSearch, Undo2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { MatchResult, PlayerRow, RosterEntry, Team } from '@/lib/types'
import { cn, fmtClock, isGk, playerName, teamInfo } from '@/lib/utils'
import PlayerAvatar from './PlayerAvatar'
import PlayerIdentify from './PlayerIdentify'

/** 합치기 전 최종 확인에 올리는 묶음 — target 쪽으로 sources를 합친다 */
type MergePlan = { target: PlayerRow; sources: PlayerRow[] }

/**
 * 영상 추적은 같은 선수를 여러 트랙으로 나누거나(가려짐·화면 밖), 코치·관중을 잡기도 한다.
 * 여기서 이름·등번호를 붙이고, 같은 사람 트랙을 합치고, 잘못 잡힌 트랙을 제외한다.
 * 모든 수정은 결과 수치에 즉시 반영되고 되돌릴 수 있다.
 */
export default function TrackEditor({ matchId, result, onChanged, videoSrc }:
  { matchId: number; result: MatchResult; onChanged: () => Promise<void>; videoSrc?: string | null }) {
  const [selected, setSelected] = useState<string[]>([])
  // 합치기는 바로 실행하지 않는다: 사진을 나란히 보여 주고 '합치기'를 한 번 더 눌러야 한다
  const [plan, setPlan] = useState<MergePlan | null>(null)
  const [identify, setIdentify] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showMinor, setShowMinor] = useState(true)
  const { match } = result
  // 경기에 연결된 팀의 명단 — 이름 칸에서 고르면 등번호가 채워지고, 같은 이름끼리는 서버가 자동으로 합친다
  const [rosters, setRosters] = useState<Partial<Record<Team, RosterEntry[]>>>({})
  useEffect(() => {
    const sides = (['home', 'away'] as Team[]).filter(t => match[`${t}_team_id`])
    Promise.all(sides.map(t => api.getClub(match[`${t}_team_id`] as number).then(c => [t, c.roster] as const).catch(() => null)))
      .then(rs => setRosters(Object.fromEntries(rs.filter(Boolean) as (readonly [Team, RosterEntry[]])[])))
  }, [match])

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

  const merge = () => setPlan({ target: mergeTarget, sources: selRows.filter(p => p.track_id !== mergeTarget.track_id) })

  /** 확인을 거친 합치기. 끝나면 '되돌리기'가 달린 알림을 띄운다 — 합치기 전 묶음 그대로 복원한다 */
  const doMerge = async (m: MergePlan) => {
    const before = m.sources.map(s => ({ id: s.track_id, kids: [...s.merged_from] }))
    setPlan(null)
    setBusy(true)
    try {
      await api.mergePlayers(matchId, m.target.track_id, m.sources.map(s => s.track_id))
      setSelected([])
      await onChanged()
      toast.success(`${m.sources.length + 1}명을 ${playerName(m.target)}(으)로 합쳤습니다`, {
        duration: 12000,
        action: {
          label: '되돌리기',
          onClick: () => run(async () => {
            for (const b of before) {
              await api.unmergePlayer(matchId, b.id)
              if (b.kids.length) await api.mergePlayers(matchId, b.id, b.kids)
            }
          }, '합치기를 되돌렸습니다'),
        },
      })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const identifyRow = identify ? result.players.find(p => p.track_id === identify) ?? null : null

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
        <p>선수 사진이나 <b>확대·영상</b>을 누르면 그 선수만 크게 따라가는 영상을 보면서 번호와 이름을 넣을 수 있습니다.
          합치기는 사진을 나란히 보여 주는 <b>확인 창</b>에서 한 번 더 눌러야 실행됩니다.</p>
        <p className="text-xs text-ink-500">이름을 붙인 선수는 &lsquo;선수 프로필&rsquo;에서 여러 경기 기록이 합산됩니다.</p>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button className="btn-secondary !py-1.5 text-xs" disabled={busy}
            onClick={() => run(() => api.autoRoster(matchId),
              '팀당 필드 10명 + 골키퍼 1명 칸에 맞춰 조각을 합쳤습니다. 틀린 묶음은 선수 카드에서 풀 수 있습니다')}>
            <Users className="w-3.5 h-3.5" />팀당 11명으로 자동 정리
          </button>
          <button className="btn-ghost !py-1.5 text-xs" disabled={busy}
            onClick={() => run(() => api.undoAutoRoster(matchId), '자동 정리를 되돌렸습니다')}>
            자동 정리 되돌리기
          </button>
          <span className="text-[11px] text-ink-500">
            화면 밖에 나갔다 돌아와 새 번호가 붙은 선수를 &lsquo;그때 화면 밖에 있던 같은 팀 선수&rsquo; 중 색·자리가 가장 비슷한 사람으로 묶습니다.
            같은 유니폼이라 오래 나가 있던 선수는 틀릴 수 있으니 썸네일로 확인해 주세요. 이름을 붙인 선수는 건드리지 않습니다.
          </span>
        </div>
      </div>

      <div className="sticky top-14 z-20 card p-3 flex flex-wrap items-center gap-2 shadow-lg shadow-black/30">
        <span className="text-sm text-ink-300">{selected.length ? `${selected.length}개 선택` : '합칠 트랙을 선택하세요'}</span>
        {selected.length >= 2 && !sameTeam && <span className="text-xs text-red-300">같은 팀 트랙만 합칠 수 있습니다</span>}
        {selected.length >= 2 && sameTeam && mergeTarget && (
          <span className="text-xs text-ink-500">→ {playerName(mergeTarget)} 기준 · 확인 창이 뜹니다</span>
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

      {(['home', 'away'] as Team[]).filter(t => rosters[t]?.length).map(t => {
        const named = new Set(result.players.filter(p => p.team === t && !p.excluded && p.display_name).map(p => p.display_name!.trim()))
        const list = rosters[t]!
        return (
          <div key={t} className="card p-3">
            <p className="text-xs text-ink-400 mb-2">
              <b className="text-ink-200">{teamInfo(match, t).name}</b> 명단 {list.filter(r => named.has(r.name)).length}/{list.length}명 정리됨 —
              카드의 이름 칸에서 명단 이름을 고르세요. 같은 이름을 고른 트랙은 자동으로 합쳐집니다.
            </p>
            <div className="flex flex-wrap gap-1">
              {list.map(r => (
                <span key={r.name} className={cn('text-[11px] px-2 py-0.5 rounded-full',
                  named.has(r.name) ? 'bg-volt/15 text-volt' : 'bg-ink-800 text-ink-400')}>
                  {r.number != null && `${r.number} `}{r.name}
                </span>
              ))}
            </div>
            <datalist id={`roster-${t}`}>
              {list.map(r => <option key={r.name} value={r.name}>{r.number != null ? `${r.number}번` : ''}</option>)}
            </datalist>
          </div>
        )
      })}

      {sections.map(sec => (
        <div key={sec.title}>
          <h3 className="text-sm font-semibold text-ink-200 mb-2">{sec.title} · {sec.rows.length}</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {sec.rows.map(p => (
              <TrackCard key={p.track_id} matchId={matchId} result={result} p={p} busy={busy}
                candidates={suggestions.get(p.track_id) ?? []} roster={rosters[p.team]}
                selected={selected.includes(p.track_id)} onToggle={() => toggle(p.track_id)} run={run}
                onIdentify={() => setIdentify(p.track_id)} onMerge={setPlan} />
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
                onClick={() => run(() => api.updatePlayer(matchId, p.track_id, p.label === 'referee' ? { role: 'player' } : { excluded: false }), '제외를 취소했습니다')}
                className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-ink-800 text-xs text-ink-300 hover:bg-ink-700">
                <PlayerAvatar matchId={matchId} match={match} player={p} size={22} />
                {p.label === 'referee' ? '심판' : playerName(p)} <RotateCcw className="w-3 h-3" />
              </button>
            ))}
          </div>
        </div>
      )}

      {plan && (
        <MergeConfirm matchId={matchId} result={result} plan={plan} busy={busy}
          onCancel={() => setPlan(null)} onConfirm={() => doMerge(plan)} onIdentify={id => setIdentify(id)} />
      )}
      {identifyRow && (
        <PlayerIdentify matchId={matchId} result={result} player={identifyRow} src={videoSrc} roster={rosters[identifyRow.team]}
          onClose={() => setIdentify(null)} onSaved={onChanged} />
      )}
    </div>
  )
}

/** 합치기 전 최종 확인: 합칠 선수들의 사진·시간을 나란히 보여 주고, '합치기'를 눌러야 실행한다 */
function MergeConfirm({ matchId, result, plan, busy, onCancel, onConfirm, onIdentify }: {
  matchId: number; result: MatchResult; plan: MergePlan; busy: boolean
  onCancel: () => void; onConfirm: () => void; onIdentify: (trackId: string) => void
}) {
  const rows = [plan.target, ...plan.sources]
  return (
    <div className="fixed inset-0 z-[65] bg-black/75 flex items-end sm:items-center justify-center sm:p-4" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-label="합치기 확인"
        className="bg-ink-900 border border-ink-700 w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-lg sm:rounded-lg p-4"
        onClick={e => e.stopPropagation()}>
        <p className="font-semibold text-ink-100">이 {rows.length}명을 같은 선수로 합칠까요?</p>
        <p className="text-xs text-ink-400 mt-1">
          기록이 <b className="text-ink-200">{playerName(plan.target)}</b> 하나로 합쳐집니다. 사진을 누르면 영상으로 확인할 수 있습니다.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
          {rows.map((p, i) => (
            <button key={p.track_id} type="button" onClick={() => onIdentify(p.track_id)}
              className="rounded-lg border border-ink-700 bg-ink-850 p-2 text-left hover:border-ink-500">
              {p.has_thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={api.thumbnailUrl(matchId, p.track_id)} alt={`${playerName(p)} 사진`}
                  className="w-full h-40 object-contain rounded bg-ink-950" />
              ) : (
                <span className="flex h-40 items-center justify-center rounded bg-ink-950">
                  <PlayerAvatar matchId={matchId} match={result.match} player={p} size={64} />
                </span>
              )}
              <span className="block mt-1.5 text-sm font-medium text-ink-100 truncate">
                {playerName(p)}{i === 0 && <span className="ml-1 text-[11px] text-volt">기준</span>}
              </span>
              <span className="block text-[11px] text-ink-500 num">
                {fmtClock(p.stats.first_seen_s ?? 0)}~{fmtClock(p.stats.last_seen_s ?? 0)} · {p.stats.minutes_tracked.toFixed(0)}분 · 터치 {p.stats.touches}
              </span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-500 mt-2">합친 뒤에도 알림의 &lsquo;되돌리기&rsquo;나 카드의 &lsquo;합쳐진 트랙&rsquo;에서 다시 나눌 수 있습니다.</p>
        <div className="flex gap-2 mt-3">
          <button type="button" className="btn-secondary flex-1" onClick={onCancel}>취소</button>
          <button type="button" className="btn-primary flex-1" disabled={busy} onClick={onConfirm}>
            <Combine className="w-4 h-4" />합치기
          </button>
        </div>
      </div>
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

function TrackCard({ matchId, result, p, candidates, roster, selected, onToggle, busy, run, onIdentify, onMerge }: {
  matchId: number; result: MatchResult; p: PlayerRow; candidates: PlayerRow[]; roster?: RosterEntry[]; selected: boolean; busy: boolean
  onToggle: () => void; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>
  onIdentify: () => void; onMerge: (m: MergePlan) => void
}) {
  const [name, setName] = useState(p.display_name ?? '')
  const [num, setNum] = useState(p.jersey_number?.toString() ?? '')
  const dirty = name !== (p.display_name ?? '') || num !== (p.jersey_number?.toString() ?? '')
  const other: Team = p.team === 'home' ? 'away' : 'home'
  const s = p.stats

  const save = async () => {
    let saved = false, merged: string | null | undefined
    await run(async () => {
      const r = await api.updatePlayer(matchId, p.track_id, {
        display_name: name.trim() || null,
        jersey_number: num.trim() === '' ? null : Number(num),
      })
      saved = true
      merged = r.merged_into
    })
    if (saved) toast.success(merged ? `같은 이름의 트랙과 합쳤습니다 (${name.trim()})` : '저장했습니다')
  }
  const onName = (v: string) => {
    setName(v)
    const hit = roster?.find(r => r.name === v.trim())
    if (hit && hit.number != null) setNum(String(hit.number))
  }

  return (
    <div className={cn('card p-3 transition-colors', selected && 'ring-2 ring-volt border-volt')}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={onIdentify} className="relative shrink-0" aria-label={`${playerName(p)} 사진·영상 크게 보기`}>
          <PlayerAvatar matchId={matchId} match={result.match} player={p} size={52} />
          <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-ink-700 border-2 border-ink-950 flex items-center justify-center">
            <ScanSearch className="w-3 h-3 text-ink-100" aria-hidden />
          </span>
        </button>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex gap-1.5">
            <input className="input !py-1 !px-2 text-xs w-12 shrink-0" placeholder="번호" inputMode="numeric" value={num}
              onChange={e => setNum(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="등번호" />
            <input className="input !py-1 !px-2 text-xs" placeholder={roster?.length ? '이름 (명단에서 고르기)' : '이름'} value={name} maxLength={100}
              list={roster?.length ? `roster-${p.team}` : undefined}
              onChange={e => onName(e.target.value)} onKeyDown={e => e.key === 'Enter' && dirty && save()} aria-label="이름" />
          </div>
          <p className="text-[11px] text-ink-500 truncate">
            {p.track_id}{isGk(p) && ' · GK'} · {fmtClock(s.first_seen_s ?? 0)}~{fmtClock(s.last_seen_s ?? 0)} · {s.minutes_tracked.toFixed(0)}분 · 터치 {s.touches}
            {p.minor && ' · 짧은 트랙'}
          </p>
        </div>
        <button type="button" onClick={onToggle} aria-pressed={selected} aria-label="합칠 선수로 선택"
          className={cn('shrink-0 w-7 h-7 rounded-md border flex items-center justify-center',
            selected ? 'bg-volt border-volt' : 'bg-ink-950 border-ink-600')}>
          {selected && <Check className="w-4 h-4 text-ink-950" />}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {dirty && <button className="btn-primary !py-1 !px-2 text-xs" disabled={busy} onClick={save}>저장</button>}
        <button type="button" className="btn-secondary !py-1 !px-2 text-xs" onClick={onIdentify}>
          <ScanSearch className="w-3 h-3" />확대·영상
        </button>
        <button className="btn-secondary !py-1 !px-2 text-xs" disabled={busy}
          onClick={() => run(() => api.updatePlayer(matchId, p.track_id, { team: other }), '팀을 바꿨습니다')}>
          <span className="w-2.5 h-2.5 rounded-full border border-ink-600" style={{ background: teamInfo(result.match, other).color }} />
          {teamInfo(result.match, other).name}(으)로
        </button>
        <button className="btn-secondary !py-1 !px-2 text-xs" disabled={busy}
          onClick={() => run(() => api.updatePlayer(matchId, p.track_id, { excluded: true }), '제외했습니다')}>
          <Ban className="w-3 h-3" />제외
        </button>
        <button className={cn('btn-secondary !py-1 !px-2 text-xs', isGk(p) && '!border-volt !text-volt')} disabled={busy}
          title="골키퍼로 지정하면 GK 기록(선방·실점)으로 따로 봅니다"
          onClick={() => run(() => api.updatePlayer(matchId, p.track_id, { role: isGk(p) ? 'player' : 'gk' }),
            isGk(p) ? '필드 선수로 바꿨습니다' : '골키퍼로 지정했습니다')}>
          {isGk(p) ? 'GK 해제' : 'GK 지정'}
        </button>
        <button className="btn-secondary !py-1 !px-2 text-xs" disabled={busy}
          title="심판은 선수 기록에서 빠지고, 아래 '제외된 트랙'에 심판으로 남습니다"
          onClick={() => run(() => api.updatePlayer(matchId, p.track_id, { role: 'referee' }), '심판으로 지정했습니다')}>
          심판
        </button>
      </div>
      {candidates.length > 0 && (
        <div className="mt-2 pt-2 border-t border-ink-800">
          <p className="text-[11px] text-ink-500 mb-1 flex items-center gap-1"
            title="카메라가 돌아간 사이 화면 밖에 있다 돌아와 따로 잡혔을 수 있는 같은 팀 선수입니다. 누르면 사진을 나란히 보여 주고, 확인 창에서 합칩니다.">
            <Users className="w-3 h-3" />같은 선수 후보 · 눌러서 비교
          </p>
          <div className="flex flex-wrap gap-1.5">
            {candidates.map(c => {
              const [target, source] = c.stats.seconds_tracked > s.seconds_tracked ? [c, p] : [p, c]
              return (
                <button key={c.track_id} disabled={busy}
                  title={`${playerName(c)}와 사진을 나란히 놓고 비교 (바로 합쳐지지 않습니다)`}
                  onClick={() => onMerge({ target, sources: [source] })}
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
