'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Download, Settings2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { MatchResult, Team, TeamStats } from '@/lib/types'
import { cn, fmtClock, fmtDateShort, isDark, playerName, SOURCE_LABEL, teamInfo } from '@/lib/utils'
import { Leaders, PossessionChart, ShotMap, TeamComparison } from '@/components/results/Overview'
import PlayerTable from '@/components/results/PlayerTable'
import PlayerModal from '@/components/results/PlayerModal'
import PassNetwork from '@/components/results/PassNetwork'
import EventReview from '@/components/results/EventReview'
import Highlights from '@/components/results/Highlights'
import MatchSummaryCard from '@/components/results/MatchSummaryCard'
import Compare from '@/components/results/Compare'
import TrackEditor from '@/components/results/TrackEditor'
import LineupBoard from '@/components/results/LineupBoard'
import VideoDock, { VideoDockHandle } from '@/components/results/VideoDock'
import VideoReview from '@/components/results/VideoReview'

type Tab = 'overview' | 'review' | 'players' | 'highlights' | 'events' | 'network' | 'compare' | 'lineup' | 'edit'
type Period = 1 | 2 | null

const TABS: [Tab, string][] = [
  ['overview', '개요'], ['review', '영상 검수'], ['players', '선수 기록'], ['highlights', '하이라이트'], ['events', '이벤트 검수'],
  ['network', '패스 네트워크'], ['compare', '선수 비교'], ['lineup', '라인업'], ['edit', '선수 정리'],
]

/** 박스 스코어의 팀 합계 열 */
const BOX_COLS: { label: string; get: (t: TeamStats) => string }[] = [
  { label: '선수', get: t => String(t.players) },
  { label: '점유율', get: t => pct(t.possession_pct) },
  { label: '패스 성공/시도', get: t => `${t.passes_completed}/${t.passes_attempted}` },
  { label: '성공률', get: t => pct(t.pass_accuracy) },
  { label: '키패스', get: t => String(t.key_passes) },
  { label: '슈팅/유효', get: t => `${t.shots}/${t.shots_on_target}` },
  { label: 'xG', get: t => t.xg.toFixed(2) },
  { label: '가로채기', get: t => String(t.interceptions) },
  { label: '볼 탈취', get: t => String(t.recoveries) },
]

function pct(v: number | null | undefined) {
  return v == null ? '–' : `${v.toFixed(0)}%`
}

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>()
  const matchId = Number(id)
  const [result, setResult] = useState<MatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [period, setPeriod] = useState<Period>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const dock = useRef<VideoDockHandle>(null)

  const load = useCallback(async () => {
    try {
      setResult(await api.getResult(matchId, period))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [matchId, period])
  useEffect(() => { load() }, [load])

  const players = useMemo(() => new Map((result?.players ?? []).map(p => [p.track_id, p])), [result])

  // 공유 링크(?player=트랙)로 들어오면 그 선수 창을 바로 연다
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || !result) return
    opened.current = true
    const want = new URLSearchParams(window.location.search).get('player')
    if (want && players.has(want)) setSelected(want)
  }, [result, players])

  const shareMatch = async () => {
    const url = `${window.location.origin}/matches/${matchId}/results`
    try {
      if (navigator.share) await navigator.share({ title: result?.match.title ?? '경기 기록', url })
      else {
        await navigator.clipboard.writeText(url)
        toast.success('경기 기록 링크를 복사했습니다')
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('링크를 공유하지 못했습니다')
    }
  }

  if (error) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center">
      <p className="text-ink-200 mb-3">{error}</p>
      <Link href={`/matches/${matchId}#analyze`} className="btn-primary"><ArrowLeft className="w-4 h-4" />경기 페이지로</Link>
    </div>
  )
  if (!result) return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-4" aria-busy="true">{[1, 2, 3].map(i => <div key={i} className="card h-40 animate-pulse" />)}</div>
  )

  const { match, meta } = result
  const videoSrc = meta.source === 'video' ? api.videoSrc(match) : null
  const seek = videoSrc ? (t: number, label?: string) => dock.current?.seek(t, label) : undefined
  const home = teamInfo(match, 'home'), away = teamInfo(match, 'away')
  const sel = selected ? players.get(selected) ?? null : null
  const ts = result.team_stats
  const board = meta.scoreboard?.found ? meta.scoreboard : null
  const hasHalves = meta.halftime_rel_s != null && meta.halftime_rel_s > 0
  const warnings = meta.warnings?.filter(w => !w.includes('거리·속도')) ?? []
  const periodLabel = period === 1 ? ' · 전반' : period === 2 ? ' · 후반' : ''

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Link href={`/matches/${matchId}`} className="btn-ghost !px-2.5" aria-label="경기 페이지"><ArrowLeft className="w-4 h-4" /></Link>
        <p className="text-xs text-ink-400 flex-1 min-w-0 truncate num">
          {fmtDateShort(match.date) || fmtDateShort(match.created_at)} · {SOURCE_LABEL[meta.source] ?? meta.source} 분석 · {fmtClock(meta.duration_s)}{periodLabel}
        </p>
        <Link href={`/matches/${matchId}`} className="btn-ghost !px-2.5" aria-label="경기 설정"><Settings2 className="w-4 h-4" /></Link>
        {videoSrc && (
          <button type="button" className="btn-secondary !py-1.5" onClick={() => dock.current?.open()}>영상 보기</button>
        )}
        <button type="button" className="btn-secondary !py-1.5" onClick={shareMatch}>
          <Share2 className="w-4 h-4" /><span className="hidden sm:inline">공유</span>
        </button>
        <a href={api.exportCsvUrl(matchId, period)} className="btn-secondary !py-1.5" download>
          <Download className="w-4 h-4" /><span className="hidden sm:inline">CSV</span>
        </a>
      </div>

      {/* 박스 스코어 */}
      <section className="card mb-4" aria-label="경기 요약">
        <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-ink-800">
          <h1 className="font-semibold text-ink-100 truncate">{match.title}</h1>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-5 py-4">
          <TeamHead name={home.name} color={home.color} />
          <div className="text-center px-2">
            {board?.score ? (
              <>
                <p className="text-4xl sm:text-5xl font-semibold num text-ink-100 tracking-tight">
                  {board.score.home}<span className="text-ink-600 mx-2">:</span>{board.score.away}
                </p>
                <p className="label mt-1" title="영상에 박힌 점수 자막이 바뀐 횟수로 센 골입니다 (영상 시작 이후)">영상 중 골 · 점수 자막</p>
                <p className="text-[11px] text-ink-500 mt-0.5 num">유효 슈팅 {ts.home.shots_on_target} : {ts.away.shots_on_target}</p>
              </>
            ) : (
              <>
                <p className="text-4xl sm:text-5xl font-semibold num text-ink-100 tracking-tight">
                  {ts.home.shots_on_target}<span className="text-ink-600 mx-2">:</span>{ts.away.shots_on_target}
                </p>
                <p className="label mt-1">유효 슈팅</p>
              </>
            )}
          </div>
          <TeamHead name={away.name} color={away.color} right />
        </div>
        {board?.goals && board.goals.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 sm:px-5 pb-3 -mt-1">
            {board.goals.map((g, i) => {
              const info = teamInfo(match, g.team)
              const scorer = g.player ? result.players.find(p => p.track_id === g.player || p.merged_from.includes(g.player!)) : null
              return (
                <button key={i} type="button" disabled={!videoSrc}
                  onClick={() => dock.current?.seek(g.t, `${info.name} 골`)}
                  title={g.player ? '자막이 바뀌기 직전 이 팀의 슈팅 장면입니다' : '점수 자막이 바뀐 시각입니다'}
                  className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-ink-800 text-ink-300 hover:bg-ink-700 disabled:hover:bg-ink-800">
                  <span className="w-2 h-2 rounded-full" style={{ background: info.color }} />
                  <span className="num">{fmtClock(g.t)}</span> {info.name} 골{scorer && ` · ${playerName(scorer)}`}
                </button>
              )
            })}
          </div>
        )}
        <div className="overflow-x-auto border-t border-ink-800">
          <table className="w-full text-sm num">
            <thead>
              <tr className="text-[11px] text-ink-400">
                <th scope="col" className="text-left font-medium px-4 sm:px-5 py-2">팀</th>
                {BOX_COLS.map(c => (
                  <th key={c.label} scope="col" className="text-right font-medium px-2 py-2 whitespace-nowrap last:pr-4 sm:last:pr-5">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['home', 'away'] as Team[]).map(t => {
                const info = teamInfo(match, t)
                return (
                  <tr key={t} className="border-t border-ink-800">
                    <th scope="row" className="text-left font-medium text-ink-100 px-4 sm:px-5 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <Swatch color={info.color} />{info.name}
                      </span>
                    </th>
                    {BOX_COLS.map(c => (
                      <td key={c.label} className="text-right text-ink-200 px-2 py-2 whitespace-nowrap last:pr-4 sm:last:pr-5">{c.get(ts[t])}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 분석 신뢰도 · 주의 사항 */}
      {meta.source === 'video' && meta.ball_detected_pct != null && (
        <p className="note mb-2">
          분석 신뢰도 · 공 검출 비율 <span className="num text-ink-100">{meta.ball_detected_pct.toFixed(0)}%</span>
          <span className="text-ink-500"> — 영상에서 공이 잡힌 비율입니다. 낮을수록 볼 기록이 실제보다 적게 잡힙니다.</span>
        </p>
      )}
      {meta.sample && (
        <p className="note mb-2">샘플 분석입니다. 올린 영상이 아니라 가상 경기 데이터로 만든 결과이므로 화면 구성 확인용으로만 보세요.</p>
      )}
      {warnings.map(w => <p key={w} className="note-warn mb-2">{w}</p>)}

      {/* 탭 + 전/후반 */}
      <div className="sticky top-14 z-30 -mx-4 px-4 bg-ink-950 border-b border-ink-800 mb-4 mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
        <div role="tablist" aria-label="결과 보기" className="flex overflow-x-auto flex-1 min-w-0 basis-full sm:basis-0">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn('px-3 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors',
                tab === k ? 'border-volt text-ink-100 font-medium' : 'border-transparent text-ink-400 hover:text-ink-100')}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-md border border-ink-700 p-0.5 bg-ink-900 mb-1.5" role="group" aria-label="구간"
          title={hasHalves ? '' : '경기 설정에서 후반 시작 시각을 입력하면 전반/후반을 나눠 볼 수 있습니다'}>
          {([[null, '전체'], [1, '전반'], [2, '후반']] as [Period, string][]).map(([p, l]) => (
            <button key={l} type="button" disabled={p !== null && !hasHalves} onClick={() => setPeriod(p)} aria-pressed={period === p}
              className={cn('px-3 py-1 rounded text-xs disabled:opacity-30',
                period === p ? 'bg-ink-700 text-ink-100 font-medium' : 'text-ink-300 hover:text-ink-100')}>{l}</button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="lg:col-span-2">
            <MatchSummaryCard matchId={matchId} result={result} players={players} onSelect={p => setSelected(p.track_id)} />
          </div>
          <TeamComparison result={result} />
          <div className="space-y-4">
            <Leaders matchId={matchId} result={result} onSelect={p => setSelected(p.track_id)} />
            <PossessionChart result={result} />
          </div>
          <div className="lg:col-span-2"><ShotMap result={result} players={players} onSeek={seek ? t => seek(t, '슈팅') : undefined} /></div>
        </div>
      )}
      {tab === 'review' && <VideoReview matchId={matchId} result={result} players={players} src={videoSrc} />}
      {tab === 'players' && <PlayerTable matchId={matchId} match={match} players={result.players} onSelect={p => setSelected(p.track_id)} />}
      {tab === 'highlights' && (
        <Highlights result={result} players={players} canPlay={!!videoSrc} onPlay={clips => dock.current?.playClips(clips)} />
      )}
      {tab === 'events' && (
        <>
          {!videoSrc && <p className="note mb-3">영상이 연결된 분석에서는 이벤트를 눌러 장면을 보면서 고칠 수 있습니다.</p>}
          <EventReview matchId={matchId} result={result} players={players} onSeek={seek}
            getVideoTime={videoSrc ? () => dock.current?.currentTime() ?? null : undefined} onChanged={load} />
        </>
      )}
      {tab === 'network' && <PassNetwork result={result} players={players} onSelect={p => setSelected(p.track_id)} />}
      {tab === 'compare' && <Compare matchId={matchId} result={result} />}
      {tab === 'lineup' && <LineupBoard matchId={matchId} result={result} onChanged={load} />}
      {tab === 'edit' && <TrackEditor matchId={matchId} result={result} onChanged={load} />}

      {sel && (
        <PlayerModal matchId={matchId} result={result} player={sel} players={players}
          onClose={() => setSelected(null)} onSeek={seek}
          onPlayClips={videoSrc ? clips => dock.current?.playClips(clips) : undefined} />
      )}
      {videoSrc && <VideoDock ref={dock} src={videoSrc} offset={meta.start_s ?? 0} />}
    </div>
  )
}

function Swatch({ color }: { color: string }) {
  return <span className={cn('w-3 h-3 rounded-sm shrink-0', isDark(color) && 'ring-1 ring-white/25')} style={{ background: color }} aria-hidden />
}

function TeamHead({ name, color, right }: { name: string; color: string; right?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 min-w-0 justify-end', right && 'flex-row-reverse text-right')}>
      <Swatch color={color} />
      <span className="font-semibold text-ink-100 truncate text-sm sm:text-lg">{name}</span>
    </div>
  )
}
