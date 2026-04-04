'use client'
import { PlayerTrackSummary } from '@/lib/types'
import { fmtDist } from '@/lib/utils'

interface Props {
  players: PlayerTrackSummary[]
  homeColor: string
  awayColor: string
  onSelect?: (p: PlayerTrackSummary) => void
}

export default function DistanceRanking({ players, homeColor, awayColor, onSelect }: Props) {
  const sorted = [...players].sort((a, b) => b.total_distance_m - a.total_distance_m).slice(0, 7)
  const max = sorted[0]?.total_distance_m ?? 1
  const RANK_ICONS = ['🥇', '🥈', '🥉']

  return (
    <div className="space-y-2">
      {sorted.map((p, i) => {
        const color = p.team_side === 'home' ? homeColor : awayColor
        const pct = (p.total_distance_m / max) * 100
        const stamina = p.first_half_distance_m > 0
          ? Math.round((p.second_half_distance_m / p.first_half_distance_m) * 100)
          : 100
        const staminaColor = stamina >= 85 ? '#22c55e' : stamina >= 65 ? '#eab308' : '#ef4444'

        return (
          <button key={p.track_id} onClick={() => onSelect?.(p)}
            className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-colors text-left group">

            {/* 순위 */}
            <div className="w-8 text-center shrink-0">
              {i < 3 ? <span className="text-lg">{RANK_ICONS[i]}</span>
                : <span className="text-xs text-gray-400 font-mono">#{i+1}</span>}
            </div>

            {/* 팀 컬러 + 배지 */}
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
              style={{ background: color }}>
              {p.style_badge}
            </div>

            {/* 이름 + 바 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-800 truncate group-hover:text-green-700">
                  선수 {p.track_id.replace('track_','')}
                  <span className="ml-1 text-[10px] text-gray-400">{p.role_type}</span>
                </span>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="text-[10px] font-mono" style={{ color: staminaColor }}>{stamina}%</span>
                  <span className="text-sm font-bold text-gray-900">{fmtDist(p.total_distance_m)}</span>
                </div>
              </div>
              {/* 이중 바: 전반(진)/후반(연) */}
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
                <div className="h-full rounded-l" style={{
                  width: `${(p.first_half_distance_m / max) * 100}%`,
                  background: color
                }}/>
                <div className="h-full" style={{
                  width: `${(p.second_half_distance_m / max) * 100}%`,
                  background: color + '66'
                }}/>
              </div>
              <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                <span>전반 {fmtDist(p.first_half_distance_m)}</span>
                <span>후반 {fmtDist(p.second_half_distance_m)}</span>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
