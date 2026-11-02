'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, X } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { isPlaced, MatchEvent, MatchResult, PlayerReport, PlayerRow } from '@/lib/types'
import { cn, eventLabel, eventTone, fmtClock, fmtDateTime, isGk, playerName, teamInfo } from '@/lib/utils'
import Pitch, { Arrow } from '@/components/pitch/Pitch'
import PlayerAvatar from './PlayerAvatar'

type View = 'pass' | 'shot'

interface Props {
  matchId: number
  result: MatchResult
  player: PlayerRow
  players: Map<string, PlayerRow>
  onClose: () => void
  onSeek?: (t: number) => void
}

export default function PlayerModal({ matchId, result, player, players, onClose, onSeek }: Props) {
  const [view, setView] = useState<View>('pass')
  const { length, width } = result.meta.field
  const s = player.stats
  const team = teamInfo(result.match, player.team)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const mine = useMemo(() => result.events.filter(e => e.player === player.track_id ||
    (e.target === player.track_id && (e.kind === 'pass' || e.kind === 'recovery'))), [result.events, player.track_id])
  const passes = mine.filter(e => e.kind === 'pass' && e.player === player.track_id)
  const shots = mine.filter(e => e.kind === 'shot' && e.player === player.track_id)
  const recov = mine.filter(e => e.kind === 'recovery' && e.player === player.track_id)
  const inter = mine.filter(e => e.kind === 'pass' && e.target === player.track_id && !e.success)

  const tiles: [string, string, string?][] = [
    ['볼 터치', `${s.touches}`, `점유 ${Math.round(s.possession_s)}초`],
    ['패스', `${s.passes_completed}/${s.passes_attempted}`, s.pass_accuracy !== null ? `성공률 ${s.pass_accuracy.toFixed(0)}%` : '시도 없음'],
    ['패스 실패', `${s.passes_failed}`, `전진 패스 ${s.forward_passes}`],
    ['키패스', `${s.key_passes}`, `받은 패스 ${s.passes_received}`],
    ['슈팅 · 유효', `${s.shots} · ${s.shots_on_target}`, `xG ${s.xg.toFixed(2)}`],
    ['가로채기 · 탈취', `${s.interceptions} · ${s.recoveries}`, `볼 뺏김 ${s.dispossessed}`],
  ]

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${playerName(player)} 상세 기록`}
        className="bg-ink-900 border border-ink-700 w-full sm:max-w-4xl max-h-[92vh] overflow-y-auto rounded-t-lg sm:rounded-lg"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-ink-900 border-b border-ink-800 px-5 py-3.5 flex items-center gap-3 z-10">
          <PlayerAvatar matchId={matchId} match={result.match} player={player} size={46} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-lg text-ink-100 truncate">{playerName(player)}</p>
            <p className="text-xs text-ink-400 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: team.color }} />
              {team.name}{isGk(player) && ' · 골키퍼'} · {s.minutes_tracked.toFixed(0)}분 · 트랙 {player.track_id}
              {player.merged_from.length > 0 && ` +${player.merged_from.length}`}
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost !p-2" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {tiles.map(([label, value, sub]) => (
              <div key={label} className="rounded-lg bg-ink-850 border border-ink-800 px-3.5 py-3">
                <p className="text-[11px] text-ink-400">{label}</p>
                <p className="text-xl font-semibold text-ink-100 num">{value}</p>
                {sub && <p className="text-[11px] text-ink-500">{sub}</p>}
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-5 gap-5">
            <div className="md:col-span-3">
              <div className="flex gap-1.5 mb-2">
                {([['pass', `패스 ${passes.length}`], ['shot', `슈팅·수비 ${shots.length + recov.length + inter.length}`]] as [View, string][]).map(([v, l]) => (
                  <button key={v} onClick={() => setView(v)} className={cn('chip', view === v && 'chip-on')}>{l}</button>
                ))}
              </div>
              <Pitch length={length} width={width} className="w-full rounded-xl">
                {view === 'pass' && passes.filter(isPlaced).map(e => e.x2 !== null && e.y2 !== null && (
                  <g key={e.id} className="cursor-pointer" onClick={() => onSeek?.(e.t)}>
                    <title>{`${fmtClock(e.t)} ${eventLabel(e)}${e.target ? ` → ${playerName(players.get(e.target))}` : ''}`}</title>
                    <Arrow x1={e.x} y1={e.y} x2={e.x2} y2={e.y2} color={e.success ? '#3fa35b' : '#f87171'} width={0.45}
                      dashed={!e.success} />
                  </g>
                ))}
                {view === 'shot' && (
                  <>
                    {shots.filter(isPlaced).map(e => (
                      <g key={e.id} className="cursor-pointer" onClick={() => onSeek?.(e.t)}>
                        <title>{`${fmtClock(e.t)} ${eventLabel(e)} · xG ${(e.detail.xg ?? 0).toFixed(2)}`}</title>
                        {e.x2 !== null && e.y2 !== null && <Arrow x1={e.x} y1={e.y} x2={e.x2} y2={e.y2} color="#fbbf24" width={0.4} />}
                        <circle cx={e.x} cy={e.y} r={0.9 + Math.sqrt(e.detail.xg ?? 0.05) * 3}
                          fill={e.detail.outcome === 'on_target' ? '#fbbf24' : 'rgba(0,0,0,.3)'} stroke="#fbbf24" strokeWidth={0.5} />
                      </g>
                    ))}
                    {[...recov, ...inter].map(e => {
                      const x = e.kind === 'recovery' ? e.x : (e.x2 ?? e.x), y = e.kind === 'recovery' ? e.y : (e.y2 ?? e.y)
                      if (x === null || y === null) return null
                      return (
                        <g key={`d${e.id}`} className="cursor-pointer" onClick={() => onSeek?.(e.t)}>
                          <title>{`${fmtClock(e.t)} ${e.kind === 'recovery' ? '볼 탈취' : '가로채기'}`}</title>
                          <rect x={x - 1} y={y - 1} width={2} height={2} fill={e.kind === 'recovery' ? '#a78bfa' : '#38bdf8'}
                            stroke="#fff" strokeWidth={0.2} transform={`rotate(45 ${x} ${y})`} />
                        </g>
                      )
                    })}
                  </>
                )}
              </Pitch>
              <p className="text-[11px] text-ink-500 mt-2">
                {view === 'pass' && '라임 실선 = 성공, 빨강 점선 = 실패 · 화살표를 누르면 해당 장면 재생'}
                {view === 'shot' && '노랑 원 = 슈팅(채움 = 유효, 크기 = xG) · 보라 = 볼 탈취 · 하늘 = 가로채기'}
              </p>
            </div>

            <div className="md:col-span-2">
              <p className="label mb-2">이벤트 {mine.length}</p>
              <div className="max-h-[360px] overflow-y-auto divide-y divide-ink-800 border border-ink-800 rounded-xl">
                {mine.length === 0 && <p className="text-xs text-ink-500 p-3">기록된 이벤트가 없습니다</p>}
                {mine.map(e => <EventLine key={e.id} e={e} me={player.track_id} players={players} onSeek={onSeek} />)}
              </div>
            </div>
          </div>

          <AIReportSection key={player.track_id} matchId={matchId} trackId={player.track_id} />
        </div>
      </div>
    </div>
  )
}

/** AI 분석 — 저장된 분석을 보여 주고, 없거나 기록이 바뀌었으면 새로 받는다 (항상 전체 경기 기록 기준) */
function AIReportSection({ matchId, trackId }: { matchId: number; trackId: string }) {
  const [report, setReport] = useState<PlayerReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)  // 서버에 키가 없음 (503)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.getPlayerReport(matchId, trackId)
      .then(r => { if (!cancelled) setReport(r) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [matchId, trackId])

  const generate = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const r = await api.createPlayerReport(matchId, trackId)
      if (alive.current) setReport(r)
    } catch (e) {
      if (!alive.current) return
      if (e instanceof ApiError && e.status === 503) setNotice(e.message)
      else setError((e as Error).message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const r = report?.report
  return (
    <section className="border-t border-ink-800 pt-5" aria-labelledby={`ai-report-${trackId}`} aria-busy={busy || loading}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p id={`ai-report-${trackId}`} className="label">AI 분석</p>
          <p className="text-[11px] text-ink-500 mt-1">
            전체 경기 기록의 수치와 이벤트만으로 정리한 분석입니다
            {report && <> · <span className="num">{fmtDateTime(report.generated_at)}</span> 분석</>}
          </p>
        </div>
        <button type="button" onClick={generate} disabled={busy || loading}
          className={report ? 'btn-secondary' : 'btn-primary'}>
          {busy ? '분석 중… 최대 1분' : report ? '다시 분석' : 'AI 분석 받기'}
        </button>
      </div>

      <div className="space-y-3">
        {notice && <p className="note">{notice}</p>}
        {error && <p className="note-warn">{error}</p>}
        {report?.stale && !busy && <p className="note-warn">기록이 바뀌어 다시 분석이 필요합니다</p>}
        {loading && <p className="text-xs text-ink-500">불러오는 중…</p>}
        {!loading && !report && (
          <p className="text-xs text-ink-500">
            {busy ? '분석하는 동안 창을 닫아도 됩니다. 끝난 뒤 다시 열면 결과가 보입니다.'
              : '아직 분석이 없습니다. 기록을 바탕으로 강점, 개선점, 다음 경기 제안을 정리합니다.'}
          </p>
        )}

        {r && (
          <div className={cn('space-y-4 transition-opacity', busy && 'opacity-50')}>
            <div className="flex gap-3">
              <div className="rounded-lg bg-ink-850 border border-ink-800 px-3.5 py-3 w-28 shrink-0">
                <p className="text-[11px] text-ink-400">평점</p>
                {r.rating != null
                  ? <p className="text-xl font-semibold text-ink-100 num">{r.rating}<span className="text-sm text-ink-400">/10</span></p>
                  : <p className="text-base font-semibold text-ink-200 mt-0.5">판단 보류</p>}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-ink-400 mb-1">요약</p>
                <p className="text-sm text-ink-200 leading-relaxed">{r.summary}</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
              <ReportList title="강점" items={r.strengths} />
              <ReportList title="개선점" items={r.improvements} />
              <ReportList title="다음 경기 제안" items={r.next_match_tips} />
              <ReportList title="데이터 주의사항" items={r.data_caveats} empty="특별한 주의사항이 없습니다" />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function ReportList({ title, items, empty = '해당 없음' }: { title: string; items: string[]; empty?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-ink-400 mb-1.5">{title}</p>
      {items.length === 0
        ? <p className="text-xs text-ink-500">{empty}</p>
        : (
          <ul className="list-disc pl-4 space-y-1.5 text-sm text-ink-200 leading-relaxed marker:text-ink-600">
            {items.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        )}
    </div>
  )
}

function EventLine({ e, me, players, onSeek }:
  { e: MatchEvent; me: string; players: Map<string, PlayerRow>; onSeek?: (t: number) => void }) {
  let text = eventLabel(e)
  let tone = eventTone(e)
  if (e.target === me && e.player !== me) {
    tone = 'text-sky-300'
    text = e.kind === 'recovery' ? `볼 뺏김 ← ${playerName(players.get(e.player))}`
      : e.success ? `패스 받음 ← ${playerName(players.get(e.player))}` : `가로채기 (${playerName(players.get(e.player))}의 패스)`
  } else if (e.target && e.kind === 'pass') {
    text += ` → ${playerName(players.get(e.target))}`
  }
  return (
    <button onClick={() => onSeek?.(e.t)} disabled={!onSeek}
      className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-ink-850 disabled:cursor-default">
      <span className="num text-ink-500 w-10 shrink-0">{fmtClock(e.t)}</span>
      <span className={cn('flex-1 truncate', tone)}>{text}</span>
      {onSeek && <Play className="w-3 h-3 text-ink-600 shrink-0" />}
    </button>
  )
}
