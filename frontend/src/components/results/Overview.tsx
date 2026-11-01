'use client'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MatchResult, PlayerRow, TeamStats } from '@/lib/types'
import { fmtClock, fmtDist, playerName, teamInfo } from '@/lib/utils'
import Pitch from '@/components/pitch/Pitch'

type Row = { label: string; get: (t: TeamStats) => number | null; fmt?: (v: number) => string; hint?: string }

const ROWS: Row[] = [
  { label: '점유율', get: t => t.possession_pct, fmt: v => `${v.toFixed(0)}%` },
  { label: '패스 시도', get: t => t.passes_attempted },
  { label: '패스 성공', get: t => t.passes_completed },
  { label: '패스 성공률', get: t => t.pass_accuracy, fmt: v => `${v.toFixed(0)}%` },
  { label: '전진 패스', get: t => t.forward_passes, hint: '상대 골 방향으로 10m 이상 전진한 성공 패스' },
  { label: '슈팅', get: t => t.shots },
  { label: '유효 슈팅', get: t => t.shots_on_target },
  { label: 'xG (기대 득점)', get: t => t.xg, fmt: v => v.toFixed(2), hint: '슈팅 위치의 거리·각도로 추정한 득점 확률 합' },
  { label: '가로채기', get: t => t.interceptions },
  { label: '볼 탈취', get: t => t.recoveries },
  { label: '총 이동거리', get: t => t.distance_m, fmt: v => fmtDist(v) },
  { label: '스프린트', get: t => t.sprint_count, fmt: v => `${v}회` },
]

export function TeamComparison({ result }: { result: MatchResult }) {
  const { match, team_stats: ts } = result
  const home = teamInfo(match, 'home'), away = teamInfo(match, 'away')
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 gap-2">
        <TeamTag name={home.name} color={home.color} />
        <h2 className="text-sm font-semibold text-gray-500 shrink-0">팀 비교</h2>
        <TeamTag name={away.name} color={away.color} right />
      </div>
      <div className="space-y-3">
        {ROWS.map(r => {
          const h = r.get(ts.home), a = r.get(ts.away)
          if (h === null && a === null) return null
          const hv = h ?? 0, av = a ?? 0
          const total = hv + av
          const hp = total ? (hv / total) * 100 : 50
          const f = r.fmt ?? ((v: number) => String(v))
          return (
            <div key={r.label} title={r.hint}>
              <div className="flex justify-between text-sm mb-1">
                <span className={`font-semibold tabular-nums ${hv > av ? 'text-gray-900' : 'text-gray-500'}`}>{f(hv)}</span>
                <span className="text-xs text-gray-500">{r.label}</span>
                <span className={`font-semibold tabular-nums ${av > hv ? 'text-gray-900' : 'text-gray-500'}`}>{f(av)}</span>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 gap-0.5">
                <div style={{ width: `${hp}%`, background: home.color }} className="rounded-l-full border border-black/5" />
                <div style={{ width: `${100 - hp}%`, background: away.color }} className="rounded-r-full border border-black/5" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TeamTag({ name, color, right }: { name: string; color: string; right?: boolean }) {
  return (
    <div className={`flex items-center gap-2 min-w-0 ${right ? 'flex-row-reverse text-right' : ''}`}>
      <span className="w-4 h-4 rounded-full border border-gray-300 shrink-0" style={{ background: color }} />
      <span className="font-semibold text-gray-900 truncate">{name}</span>
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
    <div className="card p-5">
      <h2 className="font-semibold text-gray-900">점유 흐름</h2>
      <p className="text-xs text-gray-500 mb-3">
        구간별 점유율. 위쪽은 {match.home_team_name}, 아래쪽은 {match.away_team_name} 우세
      </p>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
            <YAxis domain={[-50, 50]} ticks={[-50, -25, 0, 25, 50]} tick={{ fontSize: 11, fill: '#6b7280' }}
              tickFormatter={v => `${50 + Math.abs(v)}`} />
            <ReferenceLine y={0} stroke="#9ca3af" />
            <Tooltip
              formatter={(_v, _n, item) => {
                const raw = (item.payload as { raw: number | null }).raw
                return raw === null ? ['기록 없음', ''] : [`${match.home_team_name} ${raw.toFixed(0)}% · ${match.away_team_name} ${(100 - raw).toFixed(0)}%`, '']
              }}
              labelFormatter={l => `${l}부터`} />
            <Bar dataKey="home" radius={2} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.home >= 0 ? match.home_team_color : match.away_team_color} stroke="#0000001a" />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function ShotMap({ result, players, onSeek }:
  { result: MatchResult; players: Map<string, PlayerRow>; onSeek?: (t: number) => void }) {
  const { length, width } = result.meta.field
  const shots = result.events.filter(e => e.kind === 'shot')
  return (
    <div className="card p-5">
      <h2 className="font-semibold text-gray-900">슈팅 지도</h2>
      <p className="text-xs text-gray-500 mb-3">
        원 크기 = xG · 채운 원 = 유효 슈팅 · 선은 공이 향한 곳 {shots.length === 0 && '· 슈팅 기록 없음'}
      </p>
      <Pitch length={length} width={width} className="w-full">
        {shots.map(s => {
          const c = teamInfo(result.match, s.team).color
          const r = 0.9 + Math.sqrt(s.detail.xg ?? 0.05) * 3
          const on = s.detail.outcome === 'on_target'
          return (
            <g key={s.id} className={onSeek ? 'cursor-pointer' : ''} onClick={() => onSeek?.(s.t)}>
              <title>{`${fmtClock(s.t)} ${playerName(players.get(s.player))} · xG ${(s.detail.xg ?? 0).toFixed(2)}`}</title>
              {s.x2 !== null && s.y2 !== null && (
                <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} stroke={c} strokeOpacity={0.6} strokeWidth={0.35} />
              )}
              <circle cx={s.x} cy={s.y} r={r} fill={on ? c : 'transparent'} stroke={c === '#ffffff' ? '#111' : c}
                strokeWidth={0.5} fillOpacity={0.85} />
              <circle cx={s.x} cy={s.y} r={r} fill="none" stroke="#fff" strokeWidth={0.15} />
            </g>
          )
        })}
      </Pitch>
    </div>
  )
}
