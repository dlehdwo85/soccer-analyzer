'use client'
import { PlayerTrackSummary } from '@/lib/types'
import { fmtDist } from '@/lib/utils'
import { Activity, MapPin, Zap } from 'lucide-react'

interface Props {
  player: PlayerTrackSummary
  teamColor: string
  onClick?: () => void
}

export default function PlayerCard({ player, teamColor, onClick }: Props) {
  const staminaRatio = player.first_half_distance_m > 0
    ? Math.round((player.second_half_distance_m / player.first_half_distance_m) * 100)
    : 100

  const staminaColor =
    staminaRatio >= 85 ? 'text-green-600' :
    staminaRatio >= 65 ? 'text-yellow-600' : 'text-red-500'

  return (
    <button
      onClick={onClick}
      className="card p-4 text-left hover:shadow-md hover:border-green-300 transition-all w-full group"
    >
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ background: teamColor }}
        >
          {player.track_id.replace('track_', 'T')}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm group-hover:text-green-700">
            선수 {player.track_id.replace('track_', '')}
          </p>
          <p className="text-xs text-gray-500">
            {player.team_side === 'home' ? '홈팀' : '원정팀'}
          </p>
        </div>
        {player.style_badge && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">
            {player.style_badge}
          </span>
        )}
      </div>

      {/* 핵심 스탯 */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center">
          <p className="text-xs text-gray-400 flex items-center justify-center gap-1 mb-0.5">
            <Activity className="w-3 h-3" />이동
          </p>
          <p className="text-sm font-bold text-gray-900">{fmtDist(player.total_distance_m)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-400 flex items-center justify-center gap-1 mb-0.5">
            <Zap className="w-3 h-3" />체력
          </p>
          <p className={`text-sm font-bold ${staminaColor}`}>{staminaRatio}%</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-400 flex items-center justify-center gap-1 mb-0.5">
            <MapPin className="w-3 h-3" />범위
          </p>
          <p className="text-sm font-bold text-gray-900">{Math.round(player.active_area_score)}</p>
        </div>
      </div>

      {/* 전반/후반 바 */}
      <div className="space-y-1 mb-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400 w-6">전반</span>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.min((player.first_half_distance_m / 7000) * 100, 100)}%`, background: teamColor }} />
          </div>
          <span className="text-gray-600 w-12 text-right">{fmtDist(player.first_half_distance_m)}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400 w-6">후반</span>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.min((player.second_half_distance_m / 7000) * 100, 100)}%`, background: teamColor + '99' }} />
          </div>
          <span className="text-gray-600 w-12 text-right">{fmtDist(player.second_half_distance_m)}</span>
        </div>
      </div>

      {/* AI 코멘트 */}
      {player.comment && (
        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 leading-relaxed">
          💬 {player.comment}
        </p>
      )}
    </button>
  )
}
