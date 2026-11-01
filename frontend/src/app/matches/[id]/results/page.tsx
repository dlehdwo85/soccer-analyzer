'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Download, FlaskConical, Info } from 'lucide-react'
import { api } from '@/lib/api'
import { MatchResult, PlayerRow } from '@/lib/types'
import { cn, fmtClock, fmtDist, playerName, SOURCE_LABEL, teamInfo } from '@/lib/utils'
import { PossessionChart, ShotMap, TeamComparison } from '@/components/results/Overview'
import PlayerTable from '@/components/results/PlayerTable'
import PlayerModal from '@/components/results/PlayerModal'
import PassNetwork from '@/components/results/PassNetwork'
import EventList from '@/components/results/EventList'
import PhysicalPanel from '@/components/results/PhysicalPanel'
import TrackEditor from '@/components/results/TrackEditor'
import VideoDock, { VideoDockHandle } from '@/components/results/VideoDock'
import PlayerAvatar from '@/components/results/PlayerAvatar'

type Tab = 'overview' | 'players' | 'network' | 'events' | 'physical' | 'edit'

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>()
  const matchId = Number(id)
  const [result, setResult] = useState<MatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [selected, setSelected] = useState<string | null>(null)
  const dock = useRef<VideoDockHandle>(null)

  const load = useCallback(async () => {
    try {
      setResult(await api.getResult(matchId))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [matchId])
  useEffect(() => { load() }, [load])

  const players = useMemo(() => new Map((result?.players ?? []).map(p => [p.track_id, p])), [result])

  if (error) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center">
      <p className="text-gray-700 font-medium mb-2">{error}</p>
      <Link href={`/matches/${matchId}`} className="btn-primary inline-flex mt-2"><ArrowLeft className="w-4 h-4" />경기 페이지로</Link>
    </div>
  )
  if (!result) return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="card h-40 animate-pulse bg-gray-100" />)}
    </div>
  )

  const { match, meta } = result
  const videoSrc = meta.source === 'video' ? api.videoSrc(match) : null
  const seek = videoSrc ? (t: number) => dock.current?.seek(t) : undefined
  const hasBall = meta.source !== 'gps'
  const home = teamInfo(match, 'home'), away = teamInfo(match, 'away')
  const sel = selected ? players.get(selected) ?? null : null

  const TABS: [Tab, string][] = [
    ['overview', '개요'], ['players', '선수 기록'],
    ...(hasBall ? [['network', '패스 네트워크'], ['events', '이벤트']] as [Tab, string][] : []),
    ['physical', '활동량'], ['edit', '선수 정리'],
  ]

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start gap-3 mb-5">
        <Link href={`/matches/${matchId}`} className="btn-secondary !px-2.5" aria-label="경기 페이지"><ArrowLeft className="w-4 h-4" /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{match.title}</h1>
          <p className="text-sm text-gray-500 flex flex-wrap items-center gap-x-2">
            <span>{match.date ?? ''}</span>
            <span>· {SOURCE_LABEL[meta.source] ?? meta.source} 분석</span>
            <span>· {fmtClock(meta.duration_s)}</span>
            {meta.source === 'video' && meta.ball_detected_pct != null && <span>· 공 검출 {meta.ball_detected_pct.toFixed(0)}%</span>}
          </p>
        </div>
        <a href={api.exportCsvUrl(matchId)} className="btn-secondary" download>
          <Download className="w-4 h-4" /><span className="hidden sm:inline">선수 기록 CSV</span>
        </a>
      </div>

      {meta.sample && (
        <Banner tone="info" icon={<FlaskConical className="w-4 h-4" />}>
          샘플 분석입니다. 업로드한 영상이 아니라 가상 경기 데이터로 만든 결과이므로 화면 구성 확인용으로만 보세요.
        </Banner>
      )}
      {meta.warnings?.map(w => <Banner key={w} tone="warn" icon={<AlertTriangle className="w-4 h-4" />}>{w}</Banner>)}

      {/* 스코어보드 */}
      <div className="card p-4 sm:p-5 mb-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <TeamHead name={home.name} color={home.color} />
          <div className="text-center">
            {hasBall ? (
              <>
                <p className="text-2xl sm:text-3xl font-black tabular-nums text-gray-900">
                  {result.team_stats.home.shots_on_target} <span className="text-gray-300">:</span> {result.team_stats.away.shots_on_target}
                </p>
                <p className="text-[11px] text-gray-400">유효 슈팅</p>
              </>
            ) : <p className="text-sm text-gray-400">VS</p>}
          </div>
          <TeamHead name={away.name} color={away.color} right />
        </div>
        {hasBall && result.team_stats.home.possession_pct !== null && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>점유율 {result.team_stats.home.possession_pct?.toFixed(0)}%</span>
              <span>{result.team_stats.away.possession_pct?.toFixed(0)}%</span>
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden border border-black/5">
              <div style={{ width: `${result.team_stats.home.possession_pct}%`, background: home.color }} />
              <div className="flex-1" style={{ background: away.color }} />
            </div>
          </div>
        )}
      </div>

      {/* 탭 */}
      <div className="flex gap-1 overflow-x-auto mb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn('px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
              tab === k ? 'bg-green-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-4">
          {hasBall ? <TeamComparison result={result} /> : <PhysicalPanel result={result} onSelect={p => setSelected(p.track_id)} />}
          <div className="space-y-4">
            <Leaders matchId={matchId} result={result} onSelect={p => setSelected(p.track_id)} />
            {hasBall && <PossessionChart result={result} />}
          </div>
          {hasBall && <div className="lg:col-span-2"><ShotMap result={result} players={players} onSeek={seek} /></div>}
        </div>
      )}
      {tab === 'players' && (
        <PlayerTable matchId={matchId} match={match} players={result.players} onSelect={p => setSelected(p.track_id)} showBall={hasBall} />
      )}
      {tab === 'network' && <PassNetwork result={result} players={players} onSelect={p => setSelected(p.track_id)} />}
      {tab === 'events' && (
        <>
          {!videoSrc && (
            <Banner tone="info" icon={<Info className="w-4 h-4" />}>영상이 연결된 분석에서는 이벤트를 눌러 해당 장면을 바로 볼 수 있습니다.</Banner>
          )}
          <EventList result={result} players={players} onSeek={t => seek?.(t)} canSeek={!!videoSrc} />
        </>
      )}
      {tab === 'physical' && <PhysicalPanel result={result} onSelect={p => setSelected(p.track_id)} />}
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
    <div className={cn('flex items-start gap-2 text-sm rounded-xl px-4 py-3 mb-3 border',
      tone === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-sky-50 border-sky-200 text-sky-800')}>
      <span className="mt-0.5 shrink-0">{icon}</span><span>{children}</span>
    </div>
  )
}

function TeamHead({ name, color, right }: { name: string; color: string; right?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 sm:gap-3 min-w-0', right && 'flex-row-reverse text-right')}>
      <span className="w-8 h-8 sm:w-10 sm:h-10 rounded-full border-2 border-white shadow shrink-0" style={{ background: color }} />
      <span className="font-bold text-gray-900 truncate sm:text-lg">{name}</span>
    </div>
  )
}

function Leaders({ matchId, result, onSelect }: { matchId: number; result: MatchResult; onSelect: (p: PlayerRow) => void }) {
  const pool = result.players.filter(p => !p.excluded && !p.minor)
  const hasBall = result.meta.source !== 'gps'
  const pick = (score: (p: PlayerRow) => number, filter: (p: PlayerRow) => boolean = () => true) => {
    const c = pool.filter(filter).sort((a, b) => score(b) - score(a))[0]
    return c && score(c) > 0 ? c : undefined
  }
  const items: [string, PlayerRow | undefined, (p: PlayerRow) => string][] = [
    ...(hasBall ? [
      ['볼 터치', pick(p => p.stats.touches), p => `${p.stats.touches}회`],
      ['패스 성공률 (10회+)', pick(p => p.stats.pass_accuracy ?? 0, p => p.stats.passes_attempted >= 10),
        p => `${p.stats.pass_accuracy?.toFixed(0)}% (${p.stats.passes_completed}/${p.stats.passes_attempted})`],
      ['xG', pick(p => p.stats.xg), p => `${p.stats.xg.toFixed(2)} · 슈팅 ${p.stats.shots}`],
      ['수비 (가로채기+탈취)', pick(p => p.stats.interceptions + p.stats.recoveries),
        p => `${p.stats.interceptions + p.stats.recoveries}회`],
    ] as [string, PlayerRow | undefined, (p: PlayerRow) => string][] : []),
    ['이동거리', pick(p => p.stats.distance_m), p => fmtDist(p.stats.distance_m)],
    ['최고 속도', pick(p => p.stats.top_speed_kmh), p => `${p.stats.top_speed_kmh.toFixed(1)} km/h`],
  ]
  return (
    <div className="card p-5">
      <h2 className="font-semibold text-gray-900 mb-3">부문별 1위</h2>
      <div className="grid sm:grid-cols-2 gap-2">
        {items.map(([label, p, fmt]) => (
          <button key={label} disabled={!p} onClick={() => p && onSelect(p)}
            className="flex items-center gap-2.5 rounded-xl bg-gray-50 hover:bg-green-50 p-2.5 text-left disabled:opacity-50">
            {p ? <PlayerAvatar matchId={matchId} match={result.match} player={p} size={36} />
              : <span className="w-9 h-9 rounded-full bg-gray-200" />}
            <span className="min-w-0">
              <span className="block text-[11px] text-gray-500">{label}</span>
              <span className="block text-sm font-semibold text-gray-900 truncate">{p ? playerName(p) : '–'}</span>
              <span className="block text-xs text-gray-500 tabular-nums">{p ? fmt(p) : ''}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
