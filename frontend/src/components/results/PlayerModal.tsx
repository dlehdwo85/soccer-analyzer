'use client'
import { useEffect, useMemo, useState } from 'react'
import { Play, X } from 'lucide-react'
import { MatchEvent, MatchResult, PlayerRow } from '@/lib/types'
import { cn, eventLabel, eventTone, fmtClock, fmtDist, isGk, playerName, teamInfo } from '@/lib/utils'
import Pitch, { Arrow, HeatLayer } from '@/components/pitch/Pitch'
import PlayerAvatar from './PlayerAvatar'
import SpeedZones from './SpeedZones'

type View = 'heat' | 'pass' | 'shot'

interface Props {
  matchId: number
  result: MatchResult
  player: PlayerRow
  players: Map<string, PlayerRow>
  onClose: () => void
  onSeek?: (t: number) => void
}

export default function PlayerModal({ matchId, result, player, players, onClose, onSeek }: Props) {
  const [view, setView] = useState<View>('heat')
  const { length, width } = result.meta.field
  const s = player.stats
  const team = teamInfo(result.match, player.team)
  const hasBall = result.meta.source !== 'gps'

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

  const tiles: [string, string, string?][] = hasBall ? [
    ['볼 터치', `${s.touches}`, `점유 ${Math.round(s.possession_s)}초`],
    ['패스 성공', `${s.passes_completed}/${s.passes_attempted}`, s.pass_accuracy !== null ? `성공률 ${s.pass_accuracy.toFixed(0)}%` : '시도 없음'],
    ['패스 실패', `${s.passes_failed}`, `전진 패스 ${s.forward_passes}`],
    ['받은 패스', `${s.passes_received}`, s.avg_pass_length_m ? `평균 패스 ${s.avg_pass_length_m}m` : undefined],
    ['슈팅 / 유효', `${s.shots} / ${s.shots_on_target}`, `xG ${s.xg.toFixed(2)}`],
    ['가로채기', `${s.interceptions}`, `볼 탈취 ${s.recoveries}`],
    ['볼 뺏김', `${s.dispossessed}`],
    ['이동거리', fmtDist(s.distance_m), `${s.minutes_tracked.toFixed(0)}분 추적`],
    ['최고 속도', `${s.top_speed_kmh.toFixed(1)} km/h`, `스프린트 ${s.sprint_count}회`],
  ] : [
    ['이동거리', fmtDist(s.distance_m), `${s.minutes_tracked.toFixed(0)}분`],
    ['스프린트', `${s.sprint_count}회`, fmtDist(s.sprint_m)],
    ['최고 속도', `${s.top_speed_kmh.toFixed(1)} km/h`],
  ]
  const perMin = s.minutes_tracked > 1 ? s.distance_m / s.minutes_tracked : null

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${playerName(player)} 상세 기록`}
        className="bg-white w-full sm:max-w-4xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-gray-100 px-5 py-3 flex items-center gap-3 z-10">
          <PlayerAvatar matchId={matchId} match={result.match} player={player} size={44} />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-gray-900 truncate">{playerName(player)}</p>
            <p className="text-xs text-gray-500 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full border border-gray-300" style={{ background: team.color }} />
              {team.name}{isGk(player) && ' · 골키퍼'} · 트랙 {player.track_id}
              {player.merged_from.length > 0 && ` (+${player.merged_from.length}개 병합)`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {tiles.map(([label, value, sub]) => (
              <div key={label} className="rounded-xl bg-gray-50 px-3 py-2.5">
                <p className="text-[11px] text-gray-500">{label}</p>
                <p className="text-lg font-bold text-gray-900 tabular-nums">{value}</p>
                {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-5 gap-5">
            <div className="md:col-span-3">
              <div className="flex gap-1 mb-2">
                {([['heat', '히트맵'], ...(hasBall ? [['pass', `패스 ${passes.length}`], ['shot', `슈팅·수비 ${shots.length + recov.length + inter.length}`]] : [])] as [View, string][]).map(([v, l]) => (
                  <button key={v} onClick={() => setView(v)}
                    className={cn('px-3 py-1 rounded-full text-xs font-medium', view === v ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600')}>
                    {l}
                  </button>
                ))}
              </div>
              <Pitch length={length} width={width} className="w-full rounded-lg">
                {view === 'heat' && <HeatLayer heat={s.heat} length={length} width={width} color="#facc15" />}
                {view === 'heat' && s.avg_x !== null && s.avg_y !== null && (
                  <circle cx={s.avg_x * length} cy={s.avg_y * width} r={1.6} fill={team.color} stroke="#111" strokeWidth={0.3}>
                    <title>평균 위치</title>
                  </circle>
                )}
                {view === 'pass' && passes.map(e => e.x2 !== null && e.y2 !== null && (
                  <g key={e.id} className="cursor-pointer" onClick={() => onSeek?.(e.t)}>
                    <title>{`${fmtClock(e.t)} ${eventLabel(e)}${e.target ? ` → ${playerName(players.get(e.target))}` : ''}`}</title>
                    <Arrow x1={e.x} y1={e.y} x2={e.x2} y2={e.y2} color={e.success ? '#4ade80' : '#f87171'} width={0.45}
                      dashed={!e.success} />
                  </g>
                ))}
                {view === 'shot' && (
                  <>
                    {shots.map(e => (
                      <g key={e.id} className="cursor-pointer" onClick={() => onSeek?.(e.t)}>
                        <title>{`${fmtClock(e.t)} ${eventLabel(e)} · xG ${(e.detail.xg ?? 0).toFixed(2)}`}</title>
                        {e.x2 !== null && e.y2 !== null && <Arrow x1={e.x} y1={e.y} x2={e.x2} y2={e.y2} color="#fbbf24" width={0.4} />}
                        <circle cx={e.x} cy={e.y} r={0.9 + Math.sqrt(e.detail.xg ?? 0.05) * 3}
                          fill={e.detail.outcome === 'on_target' ? '#fbbf24' : 'transparent'} stroke="#fbbf24" strokeWidth={0.5} />
                      </g>
                    ))}
                    {[...recov, ...inter].map(e => {
                      const x = e.kind === 'recovery' ? e.x : (e.x2 ?? e.x), y = e.kind === 'recovery' ? e.y : (e.y2 ?? e.y)
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
              <p className="text-[11px] text-gray-400 mt-1.5">
                {view === 'heat' && '노란색이 진할수록 오래 머문 구역 · 원은 평균 위치'}
                {view === 'pass' && '초록 실선 = 성공, 빨강 점선 = 실패 · 화살표를 누르면 해당 장면으로 이동'}
                {view === 'shot' && '노랑 원 = 슈팅(채움 = 유효, 크기 = xG) · 보라 = 볼 탈취 · 하늘 = 가로채기'}
              </p>
            </div>

            <div className="md:col-span-2 space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2">속도 구간별 이동거리</p>
                <SpeedZones stats={s} />
                {perMin !== null && <p className="text-[11px] text-gray-400 mt-1.5">분당 {Math.round(perMin)}m</p>}
              </div>
              {hasBall && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">이벤트 {mine.length}개</p>
                  <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
                    {mine.length === 0 && <p className="text-xs text-gray-400 p-3">기록된 이벤트가 없습니다</p>}
                    {mine.map(e => <EventLine key={e.id} e={e} me={player.track_id} players={players} onSeek={onSeek} />)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EventLine({ e, me, players, onSeek }:
  { e: MatchEvent; me: string; players: Map<string, PlayerRow>; onSeek?: (t: number) => void }) {
  let text = eventLabel(e)
  if (e.target === me && e.player !== me) {
    text = e.kind === 'recovery' ? `볼 뺏김 ← ${playerName(players.get(e.player))}`
      : e.success ? `패스 받음 ← ${playerName(players.get(e.player))}` : `가로채기 (${playerName(players.get(e.player))}의 패스)`
  } else if (e.target && e.kind === 'pass') {
    text += ` → ${playerName(players.get(e.target))}`
  }
  return (
    <button onClick={() => onSeek?.(e.t)} disabled={!onSeek}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-50 disabled:cursor-default">
      <span className="tabular-nums text-gray-400 w-10 shrink-0">{fmtClock(e.t)}</span>
      <span className={cn('flex-1 truncate', e.target === me && e.player !== me ? 'text-sky-600' : eventTone(e))}>{text}</span>
      {onSeek && <Play className="w-3 h-3 text-gray-300 shrink-0" />}
    </button>
  )
}
