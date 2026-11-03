'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Clapperboard, Contact, Film, Play, Share2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { isPlaced, MatchEvent, MatchResult, PlayerReport, PlayerRow } from '@/lib/types'
import { cn, eventLabel, eventTone, fmtClock, fmtDateTime, isGk, playerName, teamInfo } from '@/lib/utils'
import Pitch, { Arrow } from '@/components/pitch/Pitch'
import PlayerAvatar from './PlayerAvatar'
import PlayerCard from './PlayerCard'
import { Clip } from './VideoDock'

type View = 'pass' | 'shot'

interface Props {
  matchId: number
  result: MatchResult
  player: PlayerRow
  players: Map<string, PlayerRow>
  onClose: () => void
  onSeek?: (t: number) => void
  /** 장면 여러 개 이어 보기 — 영상이 연결된 경기에서만 */
  onPlayClips?: (clips: Clip[]) => void
  /** 장면들을 영상 파일로 저장 (영상이 연결된 경기만) */
  onExportClips?: (clips: Clip[], title: string) => void
}

const KEY_PASS_WINDOW_S = 8

export default function PlayerModal({ matchId, result, player, players, onClose, onSeek, onPlayClips, onExportClips }: Props) {
  const [view, setView] = useState<View>('pass')
  const [cardOpen, setCardOpen] = useState(false)
  const [rating, setRating] = useState<number | null>(null)
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
  // 받은 선수가 8초 안에 슈팅한 패스 (서버의 키패스 기준과 같다)
  const keyPasses = useMemo(() => {
    const shotsAll = result.events.filter(e => e.kind === 'shot')
    return passes.filter(p => p.success && p.target && shotsAll.some(sh =>
      sh.player === p.target && sh.t >= p.t && sh.t - (p.t_end ?? p.t) <= KEY_PASS_WINDOW_S))
  }, [passes, result.events])

  const clipsOf = (evs: MatchEvent[], label: (e: MatchEvent) => string): Clip[] =>
    [...evs].sort((a, b) => a.t - b.t).map(e => ({ t: e.t, label: label(e) }))
  const name = playerName(player)
  // 하이라이트 = 슈팅 · 키패스 · 성공한 전진 패스 · 가로채기 · 볼 탈취
  const reel = useMemo(() => {
    const keyIds = new Set(keyPasses.map(e => e.id))
    const picked = mine.filter(e => (e.kind === 'shot' && e.player === player.track_id) || keyIds.has(e.id)
      || (e.kind === 'pass' && e.player === player.track_id && e.success && e.detail.forward)
      || (e.kind === 'recovery' && e.player === player.track_id)
      || (e.kind === 'pass' && e.target === player.track_id && !e.success))
    return [...picked].sort((a, b) => a.t - b.t).map(e => ({
      t: e.t,
      label: `${name} · ${keyIds.has(e.id) ? '키패스' : e.target === player.track_id && e.player !== player.track_id ? '가로채기' : eventLabel(e)}`,
    }))
  }, [mine, keyPasses, player.track_id, name])

  const tiles: { label: string; value: string; sub?: string; clips?: Clip[] }[] = [
    { label: '볼 터치', value: `${s.touches}`, sub: `점유 ${Math.round(s.possession_s)}초` },
    { label: '패스', value: `${s.passes_completed}/${s.passes_attempted}`,
      sub: s.pass_accuracy !== null ? `성공률 ${s.pass_accuracy.toFixed(0)}%` : '시도 없음',
      clips: clipsOf(passes, e => `${name} · ${eventLabel(e)}`) },
    { label: '패스 실패', value: `${s.passes_failed}`, sub: `전진 패스 ${s.forward_passes}`,
      clips: clipsOf(passes.filter(e => !e.success), e => `${name} · ${eventLabel(e)}`) },
    { label: '키패스', value: `${s.key_passes}`, sub: `받은 패스 ${s.passes_received}`,
      clips: clipsOf(keyPasses, () => `${name} · 키패스`) },
    { label: '슈팅 · 유효', value: `${s.shots} · ${s.shots_on_target}`, sub: `xG ${s.xg.toFixed(2)}`,
      clips: clipsOf(shots, e => `${name} · ${eventLabel(e)}`) },
    { label: '가로채기 · 탈취', value: `${s.interceptions} · ${s.recoveries}`, sub: `볼 뺏김 ${s.dispossessed}`,
      clips: clipsOf([...inter, ...recov], e => `${name} · ${e.kind === 'recovery' ? '볼 탈취' : '가로채기'}`) },
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
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={!onPlayClips || reel.length === 0}
              onClick={() => onPlayClips?.(reel)}>
              <Clapperboard className="w-4 h-4" />내 하이라이트 {reel.length}장면 이어보기
            </button>
            {onExportClips && reel.length > 0 && (
              <button type="button" className="btn-secondary" onClick={() => onExportClips(reel, `${name} 하이라이트`)}>
                <Film className="w-4 h-4" />영상으로 저장
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={() => setCardOpen(true)}>
              <Contact className="w-4 h-4" />선수 카드 만들기
            </button>
            <button type="button" className="btn-secondary" onClick={() => sharePlayerLink(matchId, player.track_id, name)}>
              <Share2 className="w-4 h-4" />링크 공유
            </button>
          </div>
          {!onPlayClips && <p className="text-[11px] text-ink-500 -mt-3">영상이 연결된 경기에서 장면을 재생할 수 있습니다.</p>}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {tiles.map(t => {
              const playable = !!onPlayClips && !!t.clips?.length
              return (
                <button key={t.label} type="button" disabled={!playable} onClick={() => t.clips && onPlayClips?.(t.clips)}
                  title={playable ? `${t.label} 장면 ${t.clips!.length}개 이어보기` : undefined}
                  className="rounded-lg bg-ink-850 border border-ink-800 px-3.5 py-3 text-left group enabled:hover:border-volt/50 disabled:cursor-default">
                  <p className="text-[11px] text-ink-400 flex items-center gap-1">
                    {t.label}
                    {playable && <Play className="w-3 h-3 ml-auto text-ink-600 group-hover:text-volt" aria-hidden />}
                  </p>
                  <p className="text-xl font-semibold text-ink-100 num">{t.value}</p>
                  {t.sub && <p className="text-[11px] text-ink-500">{t.sub}</p>}
                </button>
              )
            })}
          </div>
          {onPlayClips && <p className="text-[11px] text-ink-500 -mt-3">기록 칸을 누르면 해당 장면을 차례로 보여 줍니다.</p>}

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

          <AIReportSection key={player.track_id} matchId={matchId} trackId={player.track_id} onRating={setRating} />
        </div>
      </div>
      {cardOpen && <PlayerCard matchId={matchId} result={result} player={player} rating={rating} onClose={() => setCardOpen(false)} />}
    </div>
  )
}

/** 이 선수를 바로 열어 주는 결과 페이지 링크 — 휴대폰이면 공유 창(카카오톡 등), 아니면 복사 */
async function sharePlayerLink(matchId: number, trackId: string, name: string) {
  const url = `${window.location.origin}/matches/${matchId}/results?player=${encodeURIComponent(trackId)}`
  try {
    if (navigator.share) {
      await navigator.share({ title: `${name} 경기 기록`, url })
      return
    }
    await navigator.clipboard.writeText(url)
    toast.success('링크를 복사했습니다')
  } catch (e) {
    if ((e as Error).name !== 'AbortError') toast.error('링크를 공유하지 못했습니다')
  }
}

/** AI 분석 — 저장된 분석을 보여 주고, 없거나 기록이 바뀌었으면 새로 받는다 (항상 전체 경기 기록 기준) */
function AIReportSection({ matchId, trackId, onRating }: { matchId: number; trackId: string; onRating?: (r: number | null) => void }) {
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
  useEffect(() => { onRating?.(r?.rating ?? null) }, [r?.rating, onRating])
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
