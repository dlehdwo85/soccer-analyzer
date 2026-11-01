'use client'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { isPlaced, MatchResult, PlayerRow, TeamStats } from '@/lib/types'
import { cn, fmtClock, playerName, teamInfo } from '@/lib/utils'
import Pitch from '@/components/pitch/Pitch'
import PlayerAvatar from './PlayerAvatar'

type Row = { label: string; get: (t: TeamStats) => number | null; fmt?: (v: number) => string; hint?: string }

const ROWS: Row[] = [
  { label: '점유율', get: t => t.possession_pct, fmt: v => `${v.toFixed(0)}%` },
  { label: '슈팅', get: t => t.shots },
  { label: '유효 슈팅', get: t => t.shots_on_target },
  { label: 'xG 기대 득점', get: t => t.xg, fmt: v => v.toFixed(2), hint: '슈팅 위치의 거리·각도로 추정한 득점 확률 합' },
  { label: '패스 시도', get: t => t.passes_attempted },
  { label: '패스 성공', get: t => t.passes_completed },
  { label: '패스 성공률', get: t => t.pass_accuracy, fmt: v => `${v.toFixed(0)}%` },
  { label: '전진 패스', get: t => t.forward_passes, hint: '상대 골 방향으로 10m 이상 전진한 성공 패스' },
  { label: '키패스', get: t => t.key_passes, hint: '받은 선수가 8초 안에 슈팅한 패스' },
  { label: '가로채기', get: t => t.interceptions },
  { label: '볼 탈취', get: t => t.recoveries },
]

export function TeamComparison({ result }: { result: MatchResult }) {
  const { match, team_stats: ts } = result
  const home = teamInfo(match, 'home'), away = teamInfo(match, 'away')
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-5 gap-2">
        <TeamTag name={home.name} color={home.color} />
        <h2 className="label shrink-0">팀 비교</h2>
        <TeamTag name={away.name} color={away.color} right />
      </div>
      <div className="space-y-3.5">
        {ROWS.map(r => {
          const h = r.get(ts.home), a = r.get(ts.away)
          if (h === null && a === null) return null
          const hv = h ?? 0, av = a ?? 0
          const total = hv + av
          const hp = total ? (hv / total) * 100 : 50
          const f = r.fmt ?? ((v: number) => String(v))
          return (
            <div key={r.label} title={r.hint}>
              <div className="flex justify-between items-baseline text-sm mb-1.5">
                <span className={cn('font-bold num', hv >= av ? 'text-ink-100' : 'text-ink-500')}>{f(hv)}</span>
                <span className="text-xs text-ink-400">{r.label}</span>
                <span className={cn('font-bold num', av >= hv ? 'text-ink-100' : 'text-ink-500')}>{f(av)}</span>
              </div>
              <div className="flex h-1.5 gap-1">
                <div className="flex-1 flex justify-end bg-ink-800 rounded-full overflow-hidden">
                  <div style={{ width: `${hp}%`, background: home.color }} className="rounded-full" />
                </div>
                <div className="flex-1 bg-ink-800 rounded-full overflow-hidden">
                  <div style={{ width: `${100 - hp}%`, background: away.color }} className="h-full rounded-full" />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function TeamTag({ name, color, right }: { name: string; color: string; right?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 min-w-0', right && 'flex-row-reverse text-right')}>
      <span className="w-3.5 h-3.5 rounded-full ring-1 ring-white/20 shrink-0" style={{ background: color }} />
      <span className="font-bold text-ink-100 truncate">{name}</span>
    </div>
  )
}

export function PossessionChart({ result }: { result: MatchResult }) {
  const { match } = result
  const data = result.possession_timeline.map(b => ({
    label: fmtClock(b.start_s),
    home: b.home_pct === null ? 0 : Math.round(b.home_pct - 50),
    raw: b.home_pct,
  }))
  if (!data.length) return null
  return (
    <section className="card p-5">
      <h2 className="font-bold text-ink-100">점유 흐름</h2>
      <p className="text-xs text-ink-400 mb-3">
        구간별 점유율 — 위는 {match.home_team_name}, 아래는 {match.away_team_name} 우세
      </p>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#18223a" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#66749a' }} stroke="#243052" />
            <YAxis domain={[-50, 50]} ticks={[-50, -25, 0, 25, 50]} tick={{ fontSize: 11, fill: '#66749a' }}
              tickFormatter={v => `${50 + Math.abs(v)}`} stroke="#243052" />
            <ReferenceLine y={0} stroke="#34416a" />
            <Tooltip cursor={{ fill: 'rgba(255,255,255,.04)' }}
              contentStyle={{ background: '#0d1321', border: '1px solid #243052', borderRadius: 12, color: '#eef2fa' }}
              formatter={(_v, _n, item) => {
                const raw = (item.payload as { raw: number | null }).raw
                return raw === null ? ['기록 없음', ''] : [`${match.home_team_name} ${raw.toFixed(0)}% · ${match.away_team_name} ${(100 - raw).toFixed(0)}%`, '']
              }}
              labelFormatter={l => `${l}부터`} />
            <Bar dataKey="home" radius={3} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.home >= 0 ? match.home_team_color : match.away_team_color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

export function ShotMap({ result, players, onSeek }:
  { result: MatchResult; players: Map<string, PlayerRow>; onSeek?: (t: number) => void }) {
  const { length, width } = result.meta.field
  const shots = result.events.filter(isPlaced).filter(e => e.kind === 'shot')
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="font-bold text-ink-100">슈팅 지도</h2>
        <p className="text-xs text-ink-400">원 크기 = xG · 채운 원 = 유효 슈팅 {onSeek && '· 누르면 장면 재생'}</p>
      </div>
      {shots.length === 0 ? (
        <p className="text-sm text-ink-500 py-10 text-center">기록된 슈팅이 없습니다</p>
      ) : (
        <Pitch length={length} width={width} className="w-full rounded-xl">
          {shots.map(s => {
            const c = teamInfo(result.match, s.team).color
            const r = 0.9 + Math.sqrt(s.detail.xg ?? 0.05) * 3
            const on = s.detail.outcome === 'on_target'
            return (
              <g key={s.id} className={onSeek ? 'cursor-pointer' : ''} onClick={() => onSeek?.(s.t)}>
                <title>{`${fmtClock(s.t)} ${playerName(players.get(s.player))} · xG ${(s.detail.xg ?? 0).toFixed(2)}`}</title>
                {s.x2 !== null && s.y2 !== null && (
                  <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} stroke={c} strokeOpacity={0.55} strokeWidth={0.35} />
                )}
                <circle cx={s.x} cy={s.y} r={r} fill={on ? c : 'rgba(0,0,0,.25)'} stroke={c} strokeWidth={0.5} />
                <circle cx={s.x} cy={s.y} r={r + 0.25} fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={0.15} />
              </g>
            )
          })}
        </Pitch>
      )}
    </section>
  )
}

export function Leaders({ matchId, result, onSelect }: { matchId: number; result: MatchResult; onSelect: (p: PlayerRow) => void }) {
  const pool = result.players.filter(p => !p.excluded && !p.minor)
  const pick = (score: (p: PlayerRow) => number, filter: (p: PlayerRow) => boolean = () => true) => {
    const c = pool.filter(filter).sort((a, b) => score(b) - score(a))[0]
    return c && score(c) > 0 ? c : undefined
  }
  const items: [string, PlayerRow | undefined, (p: PlayerRow) => string][] = [
    ['볼 터치', pick(p => p.stats.touches), p => `${p.stats.touches}회`],
    ['패스 성공', pick(p => p.stats.passes_completed), p => `${p.stats.passes_completed}회 · ${p.stats.pass_accuracy?.toFixed(0) ?? '-'}%`],
    ['패스 성공률', pick(p => p.stats.pass_accuracy ?? 0, p => p.stats.passes_attempted >= 10),
      p => `${p.stats.pass_accuracy?.toFixed(0)}% (${p.stats.passes_completed}/${p.stats.passes_attempted})`],
    ['키패스', pick(p => p.stats.key_passes), p => `${p.stats.key_passes}회`],
    ['xG', pick(p => p.stats.xg), p => `${p.stats.xg.toFixed(2)} · 슈팅 ${p.stats.shots}`],
    ['수비 (가로채기+탈취)', pick(p => p.stats.interceptions + p.stats.recoveries),
      p => `${p.stats.interceptions + p.stats.recoveries}회`],
  ]
  return (
    <section className="card p-5">
      <h2 className="font-bold text-ink-100 mb-3">부문별 1위</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map(([label, p, fmt]) => (
          <button key={label} disabled={!p} onClick={() => p && onSelect(p)}
            className="flex items-center gap-3 rounded-xl bg-ink-850 border border-ink-800 hover:border-volt/40 p-2.5 text-left disabled:opacity-50 transition-colors">
            {p ? <PlayerAvatar matchId={matchId} match={result.match} player={p} size={38} />
              : <span className="w-[38px] h-[38px] rounded-xl bg-ink-800" />}
            <span className="min-w-0">
              <span className="block text-[11px] text-ink-400">{label}</span>
              <span className="block text-sm font-bold text-ink-100 truncate">{p ? playerName(p) : '–'}</span>
              <span className="block text-xs text-volt num">{p ? fmt(p) : ''}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
