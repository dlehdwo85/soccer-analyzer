'use client'
import { useMemo, useState } from 'react'
import { Clock, Pencil, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { EventKind, EventResult, MatchEvent, MatchResult, PlayerRow, Team } from '@/lib/types'
import { cn, eventLabel, eventTone, fmtClock, KIND_LABEL, parseClock, playerName, teamInfo } from '@/lib/utils'
import Badge from '@/components/ui/Badge'

type Filter = EventKind | 'fail' | 'all' | 'edited'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'shot', label: '슈팅' },
  { key: 'pass', label: '패스' },
  { key: 'fail', label: '패스 실패' },
  { key: 'recovery', label: '볼 탈취' },
  { key: 'edited', label: '수정한 것' },
]

const RESULTS: Record<EventKind, { value: EventResult; label: string }[]> = {
  pass: [{ value: 'completed', label: '성공 (받은 선수)' }, { value: 'intercepted', label: '차단 (가로챈 선수)' }, { value: 'out', label: '아웃' }],
  shot: [{ value: 'on_target', label: '유효 슈팅' }, { value: 'off_target', label: '빗나감' }, { value: 'blocked', label: '블록' }],
  recovery: [],
}

function currentResult(e: MatchEvent): EventResult | undefined {
  if (e.kind === 'pass') return e.detail.reason === 'out' ? 'out' : e.success ? 'completed' : 'intercepted'
  if (e.kind === 'shot') return e.detail.outcome ?? 'off_target'
  return undefined
}

interface Props {
  matchId: number
  result: MatchResult
  players: Map<string, PlayerRow>
  onSeek?: (t: number, label?: string) => void
  getVideoTime?: () => number | null
  onChanged: () => Promise<void>
}

export default function EventReview({ matchId, result, players, onSeek, getVideoTime, onChanged }: Props) {
  const [filter, setFilter] = useState<Filter>('shot')
  const [team, setTeam] = useState<Team | 'all'>('all')
  const [who, setWho] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const roster = useMemo(() => [...players.values()].filter(p => !p.excluded)
    .sort((a, b) => a.team.localeCompare(b.team) || Number(a.minor) - Number(b.minor) || playerName(a).localeCompare(playerName(b), 'ko')),
  [players])

  const list = useMemo(() => result.events.filter(e => {
    if (team !== 'all' && e.team !== team) return false
    if (who && e.player !== who && e.target !== who) return false
    if (filter === 'all') return true
    if (filter === 'edited') return e.edited || e.manual
    if (filter === 'fail') return e.kind === 'pass' && !e.success
    return e.kind === filter
  }), [result.events, filter, team, who])

  const dur = result.meta.duration_s || Math.max(1, ...result.events.map(e => e.t))
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      await onChanged()
      toast.success(ok)
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="p-4 border-b border-ink-800 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={cn('chip', filter === f.key && 'chip-on')}>{f.label}</button>
          ))}
          <div className="ml-auto flex gap-1.5">
            <button className="btn-secondary !py-1.5 !px-3 text-xs" disabled={busy}
              onClick={() => confirm('직접 추가한 이벤트를 지우고, 지운 이벤트를 되살릴까요? (선수·결과 수정은 유지)') &&
                run(() => api.resetEvents(matchId), '이벤트를 되돌렸습니다')}>
              <RotateCcw className="w-3.5 h-3.5" />되돌리기
            </button>
            <button className="btn-primary !py-1.5 !px-3 text-xs" onClick={() => { setAdding(a => !a); setEditing(null) }}>
              <Plus className="w-3.5 h-3.5" />이벤트 추가
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input !w-auto !py-1.5 text-xs" value={team} onChange={e => setTeam(e.target.value as Team | 'all')} aria-label="팀">
            <option value="all">양 팀</option>
            <option value="home">{result.match.home_team_name}</option>
            <option value="away">{result.match.away_team_name}</option>
          </select>
          <PlayerSelect className="!w-auto max-w-[220px]" result={result} roster={roster} value={who} onChange={setWho} placeholder="모든 선수" />
          <span className="text-xs text-ink-500 self-center ml-auto num">{list.length}개</span>
        </div>
        {/* 경기 시간축 위 이벤트 분포 */}
        <div className="relative h-7 bg-ink-950 rounded-lg border border-ink-800">
          {result.meta.halftime_rel_s != null && result.meta.halftime_rel_s > 0 && (
            <span className="absolute top-0 bottom-0 w-px bg-ink-500" style={{ left: `${(result.meta.halftime_rel_s / dur) * 100}%` }} title="후반 시작" />
          )}
          {list.map(e => (
            <button key={e.id} onClick={() => onSeek?.(e.t, eventLabel(e))} title={`${fmtClock(e.t)} ${eventLabel(e)}`}
              className="absolute top-1.5 bottom-1.5 w-[3px] -ml-px rounded-sm"
              style={{ left: `${(e.t / dur) * 100}%`, background: teamInfo(result.match, e.team).color }} />
          ))}
        </div>
        {adding && (
          <EventForm result={result} roster={roster} busy={busy} getVideoTime={getVideoTime}
            onCancel={() => setAdding(false)}
            onSubmit={async v => { if (await run(() => api.createEvent(matchId, v), '이벤트를 추가했습니다')) setAdding(false) }} />
        )}
      </div>

      <div className="max-h-[620px] overflow-y-auto divide-y divide-ink-800">
        {list.length === 0 && <p className="text-sm text-ink-500 text-center py-12">조건에 맞는 이벤트가 없습니다</p>}
        {list.map(e => {
          const t = teamInfo(result.match, e.team)
          if (editing === e.id) {
            return (
              <div key={e.id} className="p-4 bg-ink-850">
                <EventForm initial={e} result={result} roster={roster} busy={busy}
                  onCancel={() => setEditing(null)}
                  onDelete={async () => { if (await run(() => api.updateEvent(matchId, e.id, { deleted: true }), '이벤트를 지웠습니다')) setEditing(null) }}
                  onSubmit={async v => {
                    const ok = await run(() => api.updateEvent(matchId, e.id, { player: v.player, target: v.target ?? null, result: v.result, t: v.t }),
                      '수정했습니다')
                    if (ok) setEditing(null)
                  }} />
              </div>
            )
          }
          return (
            <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink-850 group">
              <button onClick={() => onSeek?.(e.t, eventLabel(e))} disabled={!onSeek}
                className="flex items-center gap-3 flex-1 min-w-0 text-left disabled:cursor-default">
                <span className="num text-xs text-ink-500 w-12 shrink-0">{fmtClock(e.t)}</span>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />
                <span className="flex-1 min-w-0 text-sm truncate">
                  <span className="font-semibold text-ink-100">{playerName(players.get(e.player))}</span>{' '}
                  <span className={eventTone(e)}>{eventLabel(e)}</span>
                  {e.target && (e.kind !== 'shot' || e.detail.outcome === 'blocked') && (
                    <span className="text-ink-400">
                      {e.kind === 'pass' ? (e.success ? ' → ' : ' · 차단 ') : e.kind === 'recovery' ? ' ← ' : ' · 블록 '}
                      {playerName(players.get(e.target))}
                    </span>
                  )}
                  {e.kind === 'shot' && e.detail.xg != null && <span className="text-xs text-ink-500"> · xG {e.detail.xg.toFixed(2)}</span>}
                </span>
                {(e.manual || e.edited) && <Badge className="border-sky-500/30 text-sky-300 bg-sky-500/10">{e.manual ? '추가' : '수정'}</Badge>}
                {onSeek && <Play className="w-3.5 h-3.5 text-ink-600 group-hover:text-volt shrink-0" />}
              </button>
              <button onClick={() => { setEditing(e.id); setAdding(false) }} className="btn-ghost !p-1.5" aria-label="이벤트 고치기">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PlayerSelect({ result, roster, value, onChange, placeholder, className, only }: {
  result: MatchResult; roster: PlayerRow[]; value: string; onChange: (v: string) => void
  placeholder: string; className?: string; only?: Team
}) {
  return (
    <select className={cn('input !py-1.5 text-xs', className)} value={value} onChange={e => onChange(e.target.value)} aria-label={placeholder}>
      <option value="">{placeholder}</option>
      {(['home', 'away'] as Team[]).filter(t => !only || t === only).map(t => (
        <optgroup key={t} label={teamInfo(result.match, t).name}>
          {roster.filter(p => p.team === t).map(p => (
            <option key={p.track_id} value={p.track_id}>{playerName(p)}{p.minor ? ' (짧은 트랙)' : ''}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

type FormValue = { kind: EventKind; t: number; player: string; target?: string | null; result?: EventResult }

function EventForm({ initial, result, roster, busy, onSubmit, onCancel, onDelete, getVideoTime }: {
  initial?: MatchEvent; result: MatchResult; roster: PlayerRow[]; busy: boolean
  onSubmit: (v: FormValue) => void; onCancel: () => void; onDelete?: () => void; getVideoTime?: () => number | null
}) {
  const [kind, setKind] = useState<EventKind>(initial?.kind ?? 'shot')
  const [time, setTime] = useState(fmtClock(initial?.t ?? getVideoTime?.() ?? 0))
  const [player, setPlayer] = useState(initial?.player ?? '')
  const [res, setRes] = useState<EventResult | undefined>(initial ? currentResult(initial) : 'on_target')
  const [target, setTarget] = useState(initial?.target ?? '')
  const pTeam = roster.find(p => p.track_id === player)?.team
  const other: Team | undefined = pTeam ? (pTeam === 'home' ? 'away' : 'home') : undefined
  const needsTarget = (kind === 'pass' && res !== 'out') || kind === 'recovery'
  const targetTeam = kind === 'pass' ? (res === 'completed' ? pTeam : other) : kind === 'recovery' ? other : other
  const targetLabel = kind === 'pass' ? (res === 'completed' ? '받은 선수' : '가로챈 선수') : kind === 'recovery' ? '뺏긴 선수' : '막은 선수'

  const submit = () => {
    const t = parseClock(time)
    if (t === null) return toast.error('시간은 분:초 형식으로 입력하세요 (예: 12:34)')
    if (!player) return toast.error('선수를 고르세요')
    if (kind === 'pass' && res !== 'out' && !target) return toast.error(`${targetLabel}를 고르세요`)
    onSubmit({ kind, t, player, target: target || null, result: kind === 'recovery' ? undefined : res })
  }

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {!initial ? (
          (['shot', 'pass', 'recovery'] as EventKind[]).map(k => (
            <button key={k} type="button" className={cn('chip', kind === k && 'chip-on')}
              onClick={() => { setKind(k); setRes(k === 'pass' ? 'completed' : k === 'shot' ? 'on_target' : undefined); setTarget('') }}>
              {KIND_LABEL[k]}
            </button>
          ))
        ) : <span className="label">{KIND_LABEL[kind]} 고치기</span>}
        <div className="flex items-center gap-1 ml-auto">
          <input className="input !w-24 !py-1.5 text-xs num" value={time} onChange={e => setTime(e.target.value)} aria-label="시간" />
          {getVideoTime && (
            <button type="button" className="btn-ghost !p-1.5" title="영상 현재 위치" aria-label="영상 현재 위치"
              onClick={() => { const t = getVideoTime(); if (t === null) toast.info('먼저 이벤트를 눌러 영상을 여세요'); else setTime(fmtClock(t)) }}>
              <Clock className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        <PlayerSelect result={result} roster={roster} value={player} onChange={setPlayer}
          placeholder={kind === 'recovery' ? '뺏은 선수' : kind === 'pass' ? '패스한 선수' : '슈팅한 선수'} />
        {RESULTS[kind].length > 0 && (
          <select className="input !py-1.5 text-xs" value={res} onChange={e => setRes(e.target.value as EventResult)} aria-label="결과">
            {RESULTS[kind].map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        )}
        {(needsTarget || (kind === 'shot' && res === 'blocked')) && (
          <PlayerSelect result={result} roster={roster} value={target} onChange={setTarget} placeholder={targetLabel} only={targetTeam} />
        )}
      </div>
      <div className="flex gap-2">
        {onDelete && <button type="button" className="btn-danger !py-1.5 text-xs" disabled={busy} onClick={onDelete}><Trash2 className="w-3.5 h-3.5" />잘못 잡힌 이벤트 지우기</button>}
        <button type="button" className="btn-ghost !py-1.5 text-xs ml-auto" onClick={onCancel}>취소</button>
        <button type="button" className="btn-primary !py-1.5 text-xs" disabled={busy} onClick={submit}>{initial ? '저장' : '추가'}</button>
      </div>
    </div>
  )
}
