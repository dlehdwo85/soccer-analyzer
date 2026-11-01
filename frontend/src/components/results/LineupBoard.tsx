'use client'
import { KeyboardEvent, MouseEvent, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Match, MatchResult, PlayerRow, PlayerStats, Team } from '@/lib/types'
import { cn, fmtClock, isGk, playerName, teamInfo } from '@/lib/utils'
import Pitch from '@/components/pitch/Pitch'
import PlayerAvatar from './PlayerAvatar'

/** 점 반지름(경기장 m): 추적 시간이 길수록 크다 */
const R_MIN = 1.4
const R_MAX = 3.2

type Placed = PlayerRow & { stats: PlayerStats & { avg_x: number; avg_y: number } }
const hasPos = (p: PlayerRow): p is Placed => p.stats.avg_x != null && p.stats.avg_y != null

/** 점 옆 라벨: 이름 → 등번호 → 트랙 ID */
function dotLabel(p: PlayerRow): string {
  const s = p.display_name || (p.jersey_number != null ? String(p.jersey_number) : p.track_id)
  return s.length > 10 ? `${s.slice(0, 9)}…` : s
}

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<void>

/**
 * 라인업 보드: 선수를 썸네일이 아니라 "경기장 어디에 서 있었는지"로 알아보고 이름을 붙인다.
 * 점 위치 = 평균 위치, 점 크기 = 추적 시간. 같은 선수가 여러 트랙으로 나뉘면 가까운 자리에 점이 여러 개 생기므로
 * 편집 중인 선수를 기준으로 나머지 조각을 골라 합칠 수 있다.
 */
export default function LineupBoard({ matchId, result, onChanged }:
  { matchId: number; result: MatchResult; onChanged: () => Promise<void> }) {
  const [active, setActive] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [showMinor, setShowMinor] = useState(true)
  const [busy, setBusy] = useState(false)
  const { match } = result
  const { length: L, width: W } = result.meta.field

  const byId = useMemo(() => new Map(result.players.map(p => [p.track_id, p])), [result.players])
  const visible = useMemo(() => result.players.filter(p => !p.excluded && (showMinor || !p.minor)),
    [result.players, showMinor])
  const maxMin = Math.max(1, ...visible.map(p => p.stats.minutes_tracked))
  const fs = L * 0.025  // 라벨 글자 크기(경기장 단위) — 풋살장도 화면에서는 비슷한 크기로 보이게

  const activeRow = active ? byId.get(active) ?? null : null
  // 새로고침 뒤 사라진(합쳐진·제외된) 트랙과 기준 선수 자신은 선택에서 뺀다
  const sel = selected.filter(id => id !== active && byId.has(id) && !byId.get(id)!.excluded)

  const run: Run = async (fn, ok) => {
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

  const open = (id: string) => {
    setActive(id)
    setSelected(s => s.filter(x => x !== id))
  }
  /** 합치기 선택. 다른 팀 트랙이 섞이지 않도록 같은 팀 것만 남긴다 */
  const toggleSelect = (p: PlayerRow) => setSelected(s => s.includes(p.track_id)
    ? s.filter(x => x !== p.track_id)
    : [...s.filter(id => byId.get(id)?.team === p.team), p.track_id])
  const unselect = (id: string) => setSelected(s => s.filter(x => x !== id))

  const pick = (p: PlayerRow, shift: boolean) => (shift ? toggleSelect(p) : open(p.track_id))

  const merge = (target: PlayerRow, sources: PlayerRow[]) => run(async () => {
    await api.mergePlayers(matchId, target.track_id, sources.map(s => s.track_id))
    setSelected([])
  }, `${sources.length}개 트랙을 ${playerName(target)}(으)로 합쳤습니다`)

  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-ink-300 space-y-1">
        <p className="font-semibold text-ink-100">라인업 보드</p>
        <p>점 위치는 경기 중 평균 위치, 점 크기는 추적된 시간입니다. 점이나 아래 목록을 누르면 이름과 등번호를 붙일 수 있습니다.</p>
        <p className="text-xs text-ink-500">같은 선수가 가려지거나 화면 밖으로 나가 여러 트랙으로 나뉘면 가까운 자리에 점이 여러 개 보입니다.
          기준 선수를 연 뒤 조각을 Shift+클릭(또는 목록에서 체크)해 합치세요.</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-400">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showMinor} onChange={e => setShowMinor(e.target.checked)} />짧은 트랙 표시
        </label>
        {sel.length > 0 && (
          <>
            <span>합칠 트랙 <span className="num text-ink-100">{sel.length}</span>개 선택</span>
            <button type="button" className="btn-secondary !py-1 !px-2 text-xs" onClick={() => setSelected([])}>선택 해제</button>
          </>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {(['home', 'away'] as Team[]).map(team => {
          const t = teamInfo(match, team)
          const rows = visible.filter(p => p.team === team).sort((a, b) => b.stats.minutes_tracked - a.stats.minutes_tracked)
          const placed = rows.filter(hasPos)
          const unplaced = rows.filter(p => !hasPos(p))
          const editing = activeRow && activeRow.team === team && !activeRow.excluded ? activeRow : null
          const teamSel = sel.filter(id => byId.get(id)?.team === team)
          const candidates = editing ? teamSel.map(id => byId.get(id)!) : []
          return (
            <section key={team} className="card p-4" aria-label={`${t.name} 라인업`}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-3 h-3 rounded-sm ring-1 ring-white/20 shrink-0" style={{ background: t.color }} aria-hidden />
                <h3 className="font-semibold text-ink-100 truncate">{t.name}</h3>
                <span className="text-xs text-ink-400 ml-auto num whitespace-nowrap">
                  {rows.length}명{unplaced.length > 0 && ` · 위치 없음 ${unplaced.length}`}
                </span>
              </div>

              {placed.length === 0 ? (
                <p className="text-sm text-ink-500 py-10 text-center">위치가 잡힌 선수가 없습니다</p>
              ) : (
                <Pitch length={L} width={W} className="w-full rounded-lg">
                  {/* 큰 점을 먼저 그려 작은 조각이 위에 오게(눌리게) 한다 */}
                  {placed.map(p => (
                    <Dot key={p.track_id} p={p} L={L} W={W} fs={fs} color={t.color} teamName={t.name}
                      r={R_MIN + (R_MAX - R_MIN) * Math.min(1, p.stats.minutes_tracked / maxMin)}
                      active={active === p.track_id} selected={sel.includes(p.track_id)}
                      onPick={shift => pick(p, shift)} />
                  ))}
                </Pitch>
              )}

              {teamSel.length > 0 && !editing && (
                <p className="mt-2 text-xs text-ink-400"><span className="num text-ink-100">{teamSel.length}</span>개 선택됨 · 합칠 기준이 될 선수를 누르세요</p>
              )}

              {editing && (
                <Editor key={editing.track_id} matchId={matchId} match={match} p={editing} candidates={candidates}
                  busy={busy} run={run} onClose={() => setActive(null)} onUnselect={unselect}
                  onMerge={() => merge(editing, candidates)} />
              )}

              <ul className="mt-3 divide-y divide-ink-800" aria-label={`${t.name} 선수 목록`}>
                {placed.map(p => (
                  <Row key={p.track_id} matchId={matchId} match={match} p={p} active={active === p.track_id}
                    selected={sel.includes(p.track_id)} onOpen={() => open(p.track_id)} onToggle={() => toggleSelect(p)} />
                ))}
              </ul>
              {unplaced.length > 0 && (
                <div className="mt-3">
                  <p className="label mb-1">위치 없음</p>
                  <ul className="divide-y divide-ink-800">
                    {unplaced.map(p => (
                      <Row key={p.track_id} matchId={matchId} match={match} p={p} active={active === p.track_id}
                        selected={sel.includes(p.track_id)} onOpen={() => open(p.track_id)} onToggle={() => toggleSelect(p)} />
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Dot({ p, L, W, r, fs, color, teamName, active, selected, onPick }: {
  p: Placed; L: number; W: number; r: number; fs: number; color: string; teamName: string
  active: boolean; selected: boolean; onPick: (shift: boolean) => void
}) {
  const cx = p.stats.avg_x * L, cy = p.stats.avg_y * W
  const right = cx < L * 0.85  // 오른쪽 골라인 근처면 라벨을 왼쪽에
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onPick(e.shiftKey)
  }
  const onClick = (e: MouseEvent<SVGGElement>) => onPick(e.shiftKey)
  return (
    <g role="button" tabIndex={0} aria-label={`${playerName(p)} · ${teamName}`} aria-pressed={selected}
      className="cursor-pointer" onClick={onClick} onKeyDown={onKey}>
      <title>{`${playerName(p)} · ${p.stats.minutes_tracked.toFixed(0)}분 · 터치 ${p.stats.touches}`}</title>
      <circle cx={cx} cy={cy} r={r + 1.5} fill="transparent" />
      {(active || selected) && (
        <circle cx={cx} cy={cy} r={r + 0.9} fill="none" stroke={active ? '#eef2fa' : '#3fa35b'} strokeWidth={0.5} />
      )}
      <circle cx={cx} cy={cy} r={r} fill={color} stroke="#070b14" strokeWidth={0.35} />
      <text x={right ? cx + r + 0.9 : cx - r - 0.9} y={cy + fs * 0.36} textAnchor={right ? 'start' : 'end'}
        fontSize={fs} fontWeight={600} fill="#fff" stroke="#070b14" strokeWidth={fs * 0.22} strokeLinejoin="round"
        paintOrder="stroke">
        {dotLabel(p)}
      </text>
    </g>
  )
}

function Row({ matchId, match, p, active, selected, onOpen, onToggle }: {
  matchId: number; match: Match; p: PlayerRow; active: boolean; selected: boolean
  onOpen: () => void; onToggle: () => void
}) {
  return (
    <li className={cn('flex items-center gap-2 px-1 py-1 -mx-1 rounded-md', active && 'bg-ink-800')}>
      <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`합치기 선택: ${playerName(p)}`} />
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 flex items-center gap-2 text-left text-sm hover:text-ink-100">
        <PlayerAvatar matchId={matchId} match={match} player={p} size={22} />
        <span className={cn('truncate', active ? 'text-ink-100 font-medium' : 'text-ink-200')}>{playerName(p)}</span>
        {isGk(p) && <span className="text-[11px] text-ink-500 shrink-0">GK</span>}
        {p.minor && <span className="text-[11px] text-ink-500 shrink-0">짧은 트랙</span>}
        <span className="ml-auto num text-xs text-ink-400 whitespace-nowrap">
          {p.stats.minutes_tracked.toFixed(0)}분 · 터치 {p.stats.touches}
        </span>
      </button>
    </li>
  )
}

function Editor({ matchId, match, p, candidates, busy, run, onClose, onUnselect, onMerge }: {
  matchId: number; match: Match; p: PlayerRow; candidates: PlayerRow[]; busy: boolean; run: Run
  onClose: () => void; onUnselect: (id: string) => void; onMerge: () => void
}) {
  const [name, setName] = useState(p.display_name ?? '')
  const [num, setNum] = useState(p.jersey_number?.toString() ?? '')
  const dirty = name !== (p.display_name ?? '') || num !== (p.jersey_number?.toString() ?? '')
  const s = p.stats

  const save = () => run(() => api.updatePlayer(matchId, p.track_id, {
    display_name: name.trim() || null,
    jersey_number: num.trim() === '' ? null : Number(num),
  }), '저장했습니다')

  return (
    <section className="mt-3 rounded-lg border border-ink-700 bg-ink-850 p-3 space-y-3" aria-label={`${playerName(p)} 편집`}>
      <div className="flex items-start gap-3">
        <PlayerAvatar matchId={matchId} match={match} player={p} size={52} />
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-[11px] text-ink-500 truncate">
            {p.track_id}{isGk(p) && ' · GK'} · {fmtClock(s.first_seen_s ?? 0)}~{fmtClock(s.last_seen_s ?? 0)} · {s.minutes_tracked.toFixed(0)}분 · 터치 {s.touches}
            {p.minor && ' · 짧은 트랙'}
          </p>
          <div className="flex gap-1.5">
            <input className="input !py-1 !px-2 text-xs w-14 shrink-0" placeholder="번호" inputMode="numeric" value={num}
              onChange={e => setNum(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="등번호" />
            <input className="input !py-1 !px-2 text-xs" placeholder="이름" value={name} maxLength={100} autoFocus
              onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && dirty && save()} aria-label="이름" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn-primary !py-1 !px-2.5 text-xs" disabled={busy || !dirty} onClick={save}>저장</button>
        <button type="button" className="btn-secondary !py-1 !px-2.5 text-xs" onClick={onClose}>닫기</button>
      </div>

      <div className="pt-3 border-t border-ink-800 space-y-2">
        <p className="text-xs font-semibold text-ink-200">같은 선수로 합치기</p>
        <p className="text-[11px] text-ink-500">
          이 선수의 조각으로 보이는 점을 Shift+클릭하거나 목록에서 체크하세요. 합치면 그 트랙들의 기록이 이 선수에게 합산됩니다.
        </p>
        {candidates.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {candidates.map(c => (
              <button key={c.track_id} type="button" onClick={() => onUnselect(c.track_id)} disabled={busy}
                aria-label={`${playerName(c)} 선택 해제`}
                className="inline-flex items-center gap-1.5 text-[11px] pl-2 pr-1.5 py-0.5 rounded-md bg-ink-800 text-ink-200 hover:bg-ink-700">
                {playerName(c)} <span className="text-ink-500">×</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-ink-500">선택한 트랙이 없습니다</p>
        )}
        <button type="button" className="btn-primary !py-1 !px-2.5 text-xs" disabled={busy || candidates.length === 0} onClick={onMerge}>
          합치기{candidates.length > 0 && <span className="num"> · {candidates.length}개</span>}
        </button>
      </div>

      {p.merged_from.length > 0 && (
        <div className="pt-3 border-t border-ink-800 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-ink-500 mr-1">합쳐진 트랙:</span>
          {p.merged_from.map(id => (
            <button key={id} type="button" disabled={busy} title="분리"
              onClick={() => run(() => api.unmergePlayer(matchId, id), `${id} 트랙을 분리했습니다`)}
              className="text-[11px] px-1.5 py-0.5 rounded-md bg-ink-800 text-ink-300 hover:bg-red-500/15 hover:text-red-300">
              {id} · 분리
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
