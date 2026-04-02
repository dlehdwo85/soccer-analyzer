'use client'
import { PlayerTrackSummary } from '@/lib/types'
import { fmtDist } from '@/lib/utils'
import { Trophy } from 'lucide-react'

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
        return (
          <button
            key={p.track_id}
            onClick={() => onSelect?.(p)}
            className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
          >
            {/* 순위 */}
            <div className="w-8 text-center text-sm shrink-0">
              {i < 3 ? RANK_ICONS[i] : <span className="text-gray-400 font-mono">#{i + 1}</span>}
            </div>

            {/* 팀 색상 */}
            <div className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />

            {/* 이름 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-800 truncate">
                  선수 {p.track_id.replace('track_', '')}
                  <span className="ml-2 text-xs text-gray-400">
                    {p.team_side === 'home' ? '홈' : '원정'}
                  </span>
                </span>
                <span className="text-sm font-semibold text-gray-900 shrink-0 ml-2">
                  {fmtDist(p.total_distance_m)}
                </span>
              </div>
              {/* 바 */}
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: color }}
                />
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
