'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Download, FlaskConical, Info, Settings2 } from 'lucide-react'
import { api } from '@/lib/api'
import { MatchResult } from '@/lib/types'
import { cn, fmtClock, inkOn, SOURCE_LABEL, teamInfo } from '@/lib/utils'
import { Leaders, PossessionChart, ShotMap, TeamComparison } from '@/components/results/Overview'
import PlayerTable from '@/components/results/PlayerTable'
import PlayerModal from '@/components/results/PlayerModal'
import PassNetwork from '@/components/results/PassNetwork'
import EventReview from '@/components/results/EventReview'
import Highlights from '@/components/results/Highlights'
import Compare from '@/components/results/Compare'
import TrackEditor from '@/components/results/TrackEditor'
import VideoDock, { VideoDockHandle } from '@/components/results/VideoDock'

type Tab = 'overview' | 'players' | 'highlights' | 'events' | 'network' | 'compare' | 'edit'
type Period = 1 | 2 | null

const TABS: [Tab, string][] = [
  ['overview', '개요'], ['players', '선수 기록'], ['highlights', '하이라이트'], ['events', '이벤트 검수'],
  ['network', '패스 네트워크'], ['compare', '선수 비교'], ['edit', '선수 정리'],
]

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

  if (error) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center">
      <p className="text-ink-200 font-semibold mb-3">{error}</p>
      <Link href={`/matches/${matchId}#analyze`} className="btn-primary"><ArrowLeft className="w-4 h-4" />경기 페이지로</Link>
    </div>
  )
  if (!result) return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-4">{[1, 2, 3].map(i => <div key={i} className="card h-40 animate-pulse" />)}</div>
  )

  const { match, meta } = result
  const videoSrc = meta.source === 'video' ? api.videoSrc(match) : null
  const seek = videoSrc ? (t: number, label?: string) => dock.current?.seek(t, label) : undefined
  const home = teamInfo(match, 'home'), away = teamInfo(match, 'away')
  const sel = selected ? players.get(selected) ?? null : null
  const ts = result.team_stats
  const hasHalves = meta.halftime_rel_s != null && meta.halftime_rel_s > 0

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Link href={`/matches/${matchId}`} className="btn-ghost !px-2.5" aria-label="경기 페이지"><ArrowLeft className="w-4 h-4" /></Link>
        <p className="text-xs text-ink-400 flex-1 min-w-0 truncate">
          {match.date ?? ''} · {SOURCE_LABEL[meta.source] ?? meta.source} 분석 · {fmtClock(meta.duration_s)}
          {meta.source === 'video' && meta.ball_detected_pct != null && ` · 공 검출 ${meta.ball_detected_pct.toFixed(0)}%`}
        </p>
        <Link href={`/matches/${matchId}`} className="btn-ghost !px-2.5" aria-label="경기 설정"><Settings2 className="w-4 h-4" /></Link>
        <a href={api.exportCsvUrl(matchId, period)} className="btn-secondary !py-1.5" download>
          <Download className="w-4 h-4" /><span className="hidden sm:inline">CSV</span>
        </a>
      </div>

      {/* 스코어보드 */}
      <section className="relative overflow-hidden rounded-3xl border border-ink-800 bg-gradient-to-b from-ink-900 to-ink-950 p-5 sm:p-7 mb-4">
        <div className="absolute inset-x-0 top-0 h-1 flex"><span className="flex-1" style={{ background: home.color }} /><span className="flex-1" style={{ background: away.color }} /></div>
        <h1 className="text-center text-sm font-semibold text-ink-300 mb-4 truncate">{match.title}</h1>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <TeamHead name={home.name} color={home.color} />
          <div className="text-center px-2">
            <p className="text-4xl sm:text-5xl font-black num text-ink-100 tracking-tight">
              {ts.home.shots_on_target}<span className="text-ink-600 mx-2">:</span>{ts.away.shots_on_target}
            </p>
            <p className="label mt-1">유효 슈팅</p>
          </div>
          <TeamHead name={away.name} color={away.color} right />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-5 max-w-md mx-auto text-center">
          {[['점유율', `${ts.home.possession_pct?.toFixed(0) ?? '-'}%`, `${ts.away.possession_pct?.toFixed(0) ?? '-'}%`],
            ['xG', ts.home.xg.toFixed(2), ts.away.xg.toFixed(2)],
            ['패스 성공률', `${ts.home.pass_accuracy?.toFixed(0) ?? '-'}%`, `${ts.away.pass_accuracy?.toFixed(0) ?? '-'}%`]].map(([l, a, b]) => (
            <div key={l} className="rounded-xl bg-ink-950/70 border border-ink-800 py-2">
              <p className="text-[10px] text-ink-500 font-semibold">{l}</p>
              <p className="text-sm font-bold num text-ink-100">{a} <span className="text-ink-600">·</span> {b}</p>
            </div>
          ))}
        </div>
      </section>

      {meta.sample && (
        <Banner tone="info" icon={<FlaskConical className="w-4 h-4" />}>
          샘플 분석입니다. 올린 영상이 아니라 가상 경기 데이터로 만든 결과이므로 화면 구성 확인용으로만 보세요.
        </Banner>
      )}
      {meta.warnings?.filter(w => !w.includes('거리·속도')).map(w => <Banner key={w} tone="warn" icon={<AlertTriangle className="w-4 h-4" />}>{w}</Banner>)}

      {/* 탭 + 전/후반 */}
      <div className="sticky top-14 z-30 -mx-4 px-4 py-2 bg-ink-950/90 backdrop-blur mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto flex-1 min-w-0 basis-full sm:basis-0">
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn('px-3.5 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-colors',
                tab === k ? 'bg-ink-100 text-ink-950' : 'text-ink-400 hover:text-ink-100 hover:bg-ink-850')}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl border border-ink-700 p-0.5 bg-ink-900" title={hasHalves ? '' : '경기 설정에서 후반 시작 시각을 입력하면 전반/후반을 나눠 볼 수 있습니다'}>
          {([[null, '전체'], [1, '전반'], [2, '후반']] as [Period, string][]).map(([p, l]) => (
            <button key={l} disabled={p !== null && !hasHalves} onClick={() => setPeriod(p)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-30',
                period === p ? 'bg-volt text-ink-950' : 'text-ink-300 hover:text-ink-100')}>{l}</button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <TeamComparison result={result} />
          <div className="space-y-4">
            <Leaders matchId={matchId} result={result} onSelect={p => setSelected(p.track_id)} />
            <PossessionChart result={result} />
          </div>
          <div className="lg:col-span-2"><ShotMap result={result} players={players} onSeek={seek ? t => seek(t, '슈팅') : undefined} /></div>
        </div>
      )}
      {tab === 'players' && <PlayerTable matchId={matchId} match={match} players={result.players} onSelect={p => setSelected(p.track_id)} />}
      {tab === 'highlights' && (
        <Highlights result={result} players={players} canPlay={!!videoSrc} onPlay={clips => dock.current?.playClips(clips)} />
      )}
      {tab === 'events' && (
        <>
          {!videoSrc && <Banner tone="info" icon={<Info className="w-4 h-4" />}>영상이 연결된 분석에서는 이벤트를 눌러 장면을 보면서 고칠 수 있습니다.</Banner>}
          <EventReview matchId={matchId} result={result} players={players} onSeek={seek}
            getVideoTime={videoSrc ? () => dock.current?.currentTime() ?? null : undefined} onChanged={load} />
        </>
      )}
      {tab === 'network' && <PassNetwork result={result} players={players} onSelect={p => setSelected(p.track_id)} />}
      {tab === 'compare' && <Compare matchId={matchId} result={result} />}
      {tab === 'edit' && <TrackEditor matchId={matchId} result={result} onChanged={load} />}

      {sel && (
        <PlayerModal matchId={matchId} result={result} player={sel} players={players}
          onClose={() => setSelected(null)} onSeek={seek} />
      )}
      {videoSrc && <VideoDock ref={dock} src={videoSrc} offset={meta.start_s ?? 0} />}
    </div>
  )
}

function Banner({ tone, icon, children }: { tone: 'info' | 'warn'; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-start gap-2 text-sm rounded-2xl px-4 py-3 mb-3 border',
      tone === 'warn' ? 'bg-amber-500/5 border-amber-500/30 text-amber-200' : 'bg-sky-500/5 border-sky-500/30 text-sky-200')}>
      <span className="mt-0.5 shrink-0">{icon}</span><span>{children}</span>
    </div>
  )
}

function TeamHead({ name, color, right }: { name: string; color: string; right?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center gap-2 min-w-0', right ? 'sm:flex-row-reverse sm:justify-end' : 'sm:flex-row sm:justify-end',
      right ? 'sm:text-right' : 'sm:text-left')}>
      <span className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center text-lg sm:text-xl font-black ring-1 ring-white/15 shrink-0"
        style={{ background: color, color: inkOn(color) }}>{name.slice(0, 1)}</span>
      <span className="font-extrabold text-ink-100 text-center sm:text-inherit truncate max-w-full text-sm sm:text-lg">{name}</span>
    </div>
  )
}
