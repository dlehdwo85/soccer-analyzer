'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Download, Pencil, Settings2, Share2 } from 'lucide-react'
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
import VideoDock, { Clip, VideoDockHandle } from '@/components/results/VideoDock'
import ReelExporter from '@/components/results/ReelExporter'
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
  { label: '점유율', get: t => pct(t.possession_pct, 1) },
  { label: '패스 성공/시도', get: t => `${t.passes_completed}/${t.passes_attempted}` },
  { label: '성공률', get: t => pct(t.pass_accuracy) },
  { label: '키패스', get: t => String(t.key_passes) },
  { label: '슈팅/유효', get: t => `${t.shots}/${t.shots_on_target}` },
  { label: 'xG', get: t => t.xg.toFixed(2) },
  { label: '가로채기', get: t => String(t.interceptions) },
  { label: '볼 탈취', get: t => String(t.recoveries) },
]

/** 휴대폰에서는 옆으로 미는 표 대신 홈 | 항목 | 원정 세 칸으로 보여 준다 */
const BOX_ROWS: { label: string; get: (t: TeamStats) => string }[] = [
  { label: '패스 성공/시도', get: t => `${t.passes_completed}/${t.passes_attempted}` },
  { label: '패스 성공률', get: t => pct(t.pass_accuracy) },
  { label: '슈팅/유효', get: t => `${t.shots}/${t.shots_on_target}` },
  { label: '가로채기', get: t => String(t.interceptions) },
  { label: '볼 탈취', get: t => String(t.recoveries) },
]

function pct(v: number | null | undefined, digits = 0) {
  return v == null ? '–' : `${v.toFixed(digits)}%`
}

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>()
  const matchId = Number(id)
  const [result, setResult] = useState<MatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [reviewFollow, setReviewFollow] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const dock = useRef<VideoDockHandle>(null)
  const [reel, setReel] = useState<{ clips: Clip[]; title: string } | null>(null)
  const [naming, setNaming] = useState(false)

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

  // 휴대폰: 탭 줄이 화면보다 길다 → 고른 탭이 가운데 오도록 줄만 옆으로 민다 (페이지는 움직이지 않는다)
  const tabList = useRef<HTMLDivElement>(null)
  const loaded = !!result
  useEffect(() => {
    const list = tabList.current
    const on = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (list && on) list.scrollTo({ left: on.offsetLeft - (list.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' })
  }, [tab, loaded])

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
  // 모든 골 뒤에 킥오프(가운데 재개)가 영상에서 확인됐는가
  const goalsByVideo = !!board?.goals?.length && board.goals.every(g => g.video_confirmed)
  const hasHalves = meta.halftime_rel_s != null && meta.halftime_rel_s > 0
  const warnings = meta.warnings?.filter(w => !w.includes('거리·속도')) ?? []
  const periodLabel = period === 1 ? ' · 전반' : period === 2 ? ' · 후반' : ''
  // 팀 이름을 아직 안 넣은 경기(기본값 그대로)는 입력 단추를 눈에 띄게 보여 준다
  const namesUnset = match.home_team_name === '홈팀' && match.away_team_name === '원정팀'

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Link href={`/matches/${matchId}`} className="btn-ghost !px-2.5" aria-label="경기 페이지"><ArrowLeft className="w-4 h-4" /></Link>
        <p className="order-last basis-full sm:order-none sm:basis-0 text-xs text-ink-400 flex-1 min-w-0 truncate num">
          {fmtDateShort(match.date) || fmtDateShort(match.created_at)} · {SOURCE_LABEL[meta.source] ?? meta.source} 분석 · {fmtClock(meta.duration_s)}{periodLabel}
        </p>
        <span className="flex-1 sm:hidden" aria-hidden />
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
          <div className="flex items-center gap-2">
            <h1 className="font-semibold text-ink-100 truncate flex-1 min-w-0">{match.title}</h1>
            <button type="button" onClick={() => setNaming(true)}
              className={cn('btn !px-2.5 !py-1 text-xs shrink-0', namesUnset ? 'bg-volt text-ink-950 hover:bg-volt-600' : 'text-ink-300 border border-ink-700 hover:bg-ink-800')}>
              <Pencil className="w-3.5 h-3.5" />{namesUnset ? '팀 이름 입력' : '팀 이름'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-5 py-4">
          <TeamHead name={home.name} color={home.color} />
          <div className="text-center px-2">
            {board?.score ? (
              <>
                <p className="text-4xl sm:text-5xl font-semibold num text-ink-100 tracking-tight">
                  {board.score.home}<span className="text-ink-600 mx-2">:</span>{board.score.away}
                </p>
                <p className="label mt-1" title={goalsByVideo
                  ? '점수 자막이 바뀐 뒤, 영상에서 양 팀이 자기 진영으로 갈라서 가운데에서 다시 시작한 것(킥오프)까지 확인한 골입니다'
                  : '영상에 박힌 점수 자막이 바뀐 횟수로 센 골입니다 (영상 시작 이후). 킥오프 재개가 확인되지 않은 골이 있습니다'}>
                  {goalsByVideo ? '골 · 영상에서 킥오프 확인' : '영상 중 골 · 점수 자막'}
                </p>
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
                  onClick={() => dock.current?.seek(g.t, `${info.name} 골`, g.player ?? undefined)}
                  title={(g.player ? '자막이 바뀌기 직전 이 팀의 슈팅 장면입니다' : '점수 자막이 바뀐 시각입니다')
                    + (g.video_confirmed && g.kickoff_t != null ? ` · ${fmtClock(g.kickoff_t)}에 킥오프 재개 확인` : ' · 킥오프 재개는 확인되지 않았습니다')}
                  className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-ink-800 text-ink-300 hover:bg-ink-700 disabled:hover:bg-ink-800">
                  <span className="w-2 h-2 rounded-full" style={{ background: info.color }} />
                  <span className="num">{fmtClock(g.t)}</span> {info.name} 골{scorer && ` · ${playerName(scorer)}`}
                  {g.video_confirmed ? <span className="text-volt" aria-label="영상에서 킥오프 확인">✓</span> : <span className="text-amber-300">자막만</span>}
                </button>
              )
            })}
          </div>
        )}
        <div className="sm:hidden border-t border-ink-800 px-4 py-3 space-y-2.5">
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold num text-ink-100">{pct(ts.home.possession_pct, 1)}</span>
              <span className="text-xs text-ink-400">점유율</span>
              <span className="font-semibold num text-ink-100">{pct(ts.away.possession_pct, 1)}</span>
            </div>
            <div className="flex h-2 gap-0.5 mt-1.5" aria-hidden>
              <div className={cn('rounded-sm', isDark(home.color) && 'ring-1 ring-inset ring-white/30')}
                style={{ width: `${ts.home.possession_pct ?? 50}%`, background: home.color }} />
              <div className={cn('rounded-sm flex-1', isDark(away.color) && 'ring-1 ring-inset ring-white/30')}
                style={{ background: away.color }} />
            </div>
          </div>
          {BOX_ROWS.map(r => (
            <div key={r.label} className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 text-sm">
              <span className="num text-ink-100">{r.get(ts.home)}</span>
              <span className="text-xs text-ink-400">{r.label}</span>
              <span className="num text-ink-100 text-right">{r.get(ts.away)}</span>
            </div>
          ))}
        </div>
        <div className="hidden sm:block overflow-x-auto border-t border-ink-800">
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
        <details className="note mb-2 group">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            분석 신뢰도 · 공 위치 추정 <span className="num text-ink-100">{meta.ball_detected_pct.toFixed(0)}%</span>
            {meta.ball_direct_pct != null && (
              <> · 직접 검출 <span className="num text-ink-100">{meta.ball_direct_pct.toFixed(0)}%</span></>
            )}
            {meta.ball_verified && (
              <> · 표시 장면 대조 정확도 <span className="num text-ink-100">{meta.ball_verified.pct.toFixed(0)}%</span>
                <span className="text-ink-500"> ({meta.ball_verified.frames}장면)</span></>
            )}
            <span className="ml-2 text-xs text-ink-400 underline underline-offset-2 group-open:hidden">설명 보기</span>
            <span className="ml-2 text-xs text-ink-400 underline underline-offset-2 hidden group-open:inline">접기</span>
          </summary>
          <p className="text-ink-500 mt-1">
            위치 추정은 공 모델이 직접 잡은 장면에 앞뒤 장면을 이어 붙인 추정까지 더한 비율입니다.
            잡힌 위치가 진짜 공이 아닐 수도 있어서, 실제로 맞는 비율은 대조 정확도로 봐 주세요. 낮을수록 볼 기록이 부정확합니다.
          </p>
          {meta.possession_basis === 'touches' && (
            <p className="text-ink-500 mt-1">
              점유율은 경기가 멈춘 시간(호루라기~재개, 골~킥오프)을 빼고 <b className="text-ink-300 font-medium">공을 잡은 횟수</b>의 비율로 냅니다
              (<span className="num text-ink-300">{ts.home.possession_touches ?? '–'}</span>회 : <span className="num text-ink-300">{ts.away.possession_touches ?? '–'}</span>회).
              밝은 유니폼은 발밑의 공이 덜 잡혀 실제보다 조금 낮게 나올 수 있습니다.
            </p>
          )}
          {meta.duration_s > 0 && meta.possession_basis !== 'touches' && (
            <p className="text-ink-500 mt-1">
              점유율은 공 주인이 확인된 <span className="num text-ink-300">{fmtClock(ts.home.possession_s + ts.away.possession_s)}</span>
              (경기의 <span className="num text-ink-300">{Math.round(((ts.home.possession_s + ts.away.possession_s) / meta.duration_s) * 100)}%</span>) 동안만 셉니다.
              나머지는 공 다툼·공이 안 보인 시간입니다.
            </p>
          )}
        </details>
      )}
      {meta.sample && (
        <p className="note mb-2">샘플 분석입니다. 올린 영상이 아니라 가상 경기 데이터로 만든 결과이므로 화면 구성 확인용으로만 보세요.</p>
      )}
      {warnings.map(w => <p key={w} className="note-warn mb-2">{w}</p>)}

      {/* 탭 + 전/후반 */}
      <div className="sticky top-14 z-30 -mx-4 px-4 bg-ink-950 border-b border-ink-800 mb-4 mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
        <div className="relative flex-1 min-w-0 basis-full sm:basis-0">
        <div ref={tabList} role="tablist" aria-label="결과 보기" className="flex overflow-x-auto no-scrollbar pr-6 sm:pr-0">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn('px-3 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors',
                tab === k ? 'border-volt text-ink-100 font-medium' : 'border-transparent text-ink-400 hover:text-ink-100')}>
              {label}
            </button>
          ))}
        </div>
        <div className="pointer-events-none absolute right-0 top-0 bottom-px w-8 bg-gradient-to-l from-ink-950 to-transparent sm:hidden" aria-hidden />
        </div>
        <div className={cn('rounded-md border border-ink-700 p-0.5 bg-ink-900 mb-1.5', hasHalves ? 'flex' : 'hidden sm:flex')} role="group" aria-label="구간"
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
      {tab === 'review' && <VideoReview matchId={matchId} result={result} players={players} src={videoSrc} initialFollow={reviewFollow} />}
      {tab === 'players' && <PlayerTable matchId={matchId} match={match} players={result.players} onSelect={p => setSelected(p.track_id)} />}
      {tab === 'highlights' && (
        <Highlights result={result} players={players} canPlay={!!videoSrc} onPlay={clips => dock.current?.playClips(clips)}
          onExport={(clips, title) => setReel({ clips, title })} />
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
      {tab === 'edit' && <TrackEditor matchId={matchId} result={result} onChanged={load} videoSrc={videoSrc} />}

      {naming && (
        <TeamNames matchId={matchId} home={home} away={away} onClose={() => setNaming(false)}
          onSaved={async () => { await load(); setNaming(false) }} />
      )}

      {sel && (
        <PlayerModal matchId={matchId} result={result} player={sel} players={players}
          onClose={() => setSelected(null)} onSeek={seek}
          onReview={videoSrc ? () => { setReviewFollow(sel.track_id); setTab('review'); setSelected(null); window.scrollTo({ top: 0 }) } : undefined}
          onPlayClips={videoSrc ? clips => dock.current?.playClips(clips) : undefined}
          onExportClips={videoSrc ? (clips, title) => setReel({ clips, title }) : undefined} />
      )}
      {videoSrc && <VideoDock ref={dock} src={videoSrc} offset={meta.start_s ?? 0} matchId={matchId} result={result} />}
      {videoSrc && reel && (
        <ReelExporter src={videoSrc} offset={meta.start_s ?? 0} clips={reel.clips} title={reel.title} matchId={matchId} result={result}
          fileName={reel.title.replace(/[\/:*?"<>|.\s]+/g, '_')} onClose={() => setReel(null)} />
      )}
    </div>
  )
}

/** 팀 이름 입력 창 — 결과 화면에서 바로 고친다 (경기 설정까지 가지 않아도 된다) */
function TeamNames({ matchId, home, away, onClose, onSaved }: {
  matchId: number; home: { name: string; color: string }; away: { name: string; color: string }
  onClose: () => void; onSaved: () => Promise<void>
}) {
  const [h, setH] = useState(home.name === '홈팀' ? '' : home.name)
  const [a, setA] = useState(away.name === '원정팀' ? '' : away.name)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try {
      await api.updateMatch(matchId, { home_team_name: h.trim() || '홈팀', away_team_name: a.trim() || '원정팀' })
      await onSaved()
      toast.success('팀 이름을 저장했습니다')
    } catch (e) {
      toast.error((e as Error).message)
      setSaving(false)
    }
  }
  return (
    <div className="fixed inset-0 z-[65] bg-black/75 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <form role="dialog" aria-modal="true" aria-label="팀 이름 입력"
        className="bg-ink-900 border border-ink-700 w-full sm:max-w-sm rounded-t-lg sm:rounded-lg p-4 space-y-3"
        onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); save() }}>
        <p className="font-semibold text-ink-100">팀 이름</p>
        {([['홈', home.color, h, setH, '예: 월넛FC'], ['원정', away.color, a, setA, '예: 바모스']] as const).map(([side, color, v, set, ph]) => (
          <label key={side} className="block">
            <span className="flex items-center gap-1.5 text-xs text-ink-400 mb-1"><Swatch color={color} />{side} 팀 (유니폼 색)</span>
            <input className="input text-base" value={v} maxLength={40} placeholder={ph} onChange={e => set(e.target.value)} />
          </label>
        ))}
        <div className="flex gap-2 pt-1">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>취소</button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>저장</button>
        </div>
      </form>
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
