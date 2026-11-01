'use client'
import { useState } from 'react'
import { MatchResult, PlayerRow, Team } from '@/lib/types'
import { cn, fmtDist, playerName, teamInfo } from '@/lib/utils'
import Pitch, { HeatLayer } from '@/components/pitch/Pitch'
import SpeedZones, { ZONES } from './SpeedZones'

type Metric = 'distance' | 'per_min' | 'sprint' | 'top'

const METRICS: { key: Metric; label: string; get: (p: PlayerRow) => number; fmt: (v: number) => string }[] = [
  { key: 'distance', label: '이동거리', get: p => p.stats.distance_m, fmt: fmtDist },
  { key: 'per_min', label: '분당 거리', get: p => (p.stats.minutes_tracked > 1 ? p.stats.distance_m / p.stats.minutes_tracked : 0),
    fmt: v => `${Math.round(v)} m/분` },
  { key: 'sprint', label: '스프린트 거리', get: p => p.stats.sprint_m, fmt: v => `${Math.round(v)} m` },
  { key: 'top', label: '최고 속도', get: p => p.stats.top_speed_kmh, fmt: v => `${v.toFixed(1)} km/h` },
]

export default function PhysicalPanel({ result, onSelect }: { result: MatchResult; onSelect: (p: PlayerRow) => void }) {
  const [metric, setMetric] = useState<Metric>('distance')
  const { length: L, width: W } = result.meta.field
  const m = METRICS.find(x => x.key === metric)!
  const list = result.players.filter(p => !p.excluded && !p.minor).sort((a, b) => m.get(b) - m.get(a))
  const max = Math.max(1e-6, ...list.map(m.get))

  return (
    <div className="space-y-4">
      {!result.meta.calibrated && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          경기장 보정 없이 분석되어 거리·속도는 선수 키(약 1.75m)를 기준으로 한 추정치입니다.
          경기 페이지에서 경기장 네 점을 지정하고 다시 분석하면 실제 미터 단위로 계산됩니다.
        </p>
      )}
      <div className="grid lg:grid-cols-2 gap-4">
        {(['home', 'away'] as Team[]).map(team => {
          const t = teamInfo(result.match, team)
          const ts = result.team_stats[team]
          return (
            <div key={team} className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-3.5 h-3.5 rounded-full border border-gray-300" style={{ background: t.color }} />
                <h3 className="font-semibold text-gray-900">{t.name} 팀 활동 영역</h3>
              </div>
              <Pitch length={L} width={W} className="w-full rounded-lg">
                <HeatLayer heat={ts.heat} length={L} width={W} color="#facc15" />
              </Pitch>
              <div className="grid grid-cols-3 text-center mt-3">
                <div><p className="text-[11px] text-gray-500">총 이동거리</p><p className="font-bold tabular-nums">{fmtDist(ts.distance_m)}</p></div>
                <div><p className="text-[11px] text-gray-500">스프린트 거리</p><p className="font-bold tabular-nums">{fmtDist(ts.sprint_m)}</p></div>
                <div><p className="text-[11px] text-gray-500">스프린트</p><p className="font-bold tabular-nums">{ts.sprint_count}회</p></div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <h3 className="font-semibold text-gray-900 mr-2">선수별 활동량</h3>
          {METRICS.map(x => (
            <button key={x.key} onClick={() => setMetric(x.key)}
              className={cn('px-3 py-1 rounded-full text-xs font-medium', metric === x.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600')}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {list.map((p, i) => {
            const t = teamInfo(result.match, p.team)
            const v = m.get(p)
            return (
              <button key={p.track_id} onClick={() => onSelect(p)} className="w-full text-left group">
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-xs text-gray-400 tabular-nums">{i + 1}</span>
                  <span className="w-2.5 h-2.5 rounded-full border border-gray-300 shrink-0" style={{ background: t.color }} />
                  <span className="flex-1 truncate font-medium text-gray-800 group-hover:text-green-700">{playerName(p)}</span>
                  <span className="tabular-nums text-gray-700">{m.fmt(v)}</span>
                </div>
                <div className="ml-7 mt-1">
                  {metric === 'distance' ? (
                    <div style={{ width: `${(v / max) * 100}%` }}><SpeedZones stats={p.stats} compact /></div>
                  ) : (
                    <div className="h-2 rounded-full bg-gray-100">
                      <div className="h-2 rounded-full" style={{ width: `${(v / max) * 100}%`, background: t.color, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }} />
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        {metric === 'distance' && (
          <div className="flex flex-wrap gap-3 mt-4 text-[11px] text-gray-500">
            {ZONES.map(z => (
              <span key={z.key} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: z.color }} />{z.label} ({z.range} km/h)
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
