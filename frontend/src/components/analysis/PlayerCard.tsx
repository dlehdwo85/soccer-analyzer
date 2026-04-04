'use client'
import { PlayerTrackSummary } from '@/lib/types'
import { fmtDist } from '@/lib/utils'
import { Activity, Zap, Wind, Shield } from 'lucide-react'

interface Props {
  player: PlayerTrackSummary
  teamColor: string
  onClick?: () => void
  rank?: number
}

export default function PlayerCard({ player, teamColor, onClick, rank }: Props) {
  const stamina = player.first_half_distance_m > 0
    ? Math.round((player.second_half_distance_m / player.first_half_distance_m) * 100)
    : 100

  const staminaColor = stamina >= 85 ? '#22c55e' : stamina >= 65 ? '#eab308' : '#ef4444'
  const fatigueColor = player.fatigue_index > 40 ? '#ef4444' : player.fatigue_index > 20 ? '#eab308' : '#22c55e'

  // 이동거리 기준 퍼포먼스 등급
  const grade = player.total_distance_m > 10500 ? 'A+' :
    player.total_distance_m > 9000 ? 'A' :
    player.total_distance_m > 7500 ? 'B' :
    player.total_distance_m > 6000 ? 'C' : 'D'
  const gradeColor = grade === 'A+' ? '#7c3aed' : grade === 'A' ? '#2563eb' :
    grade === 'B' ? '#16a34a' : grade === 'C' ? '#d97706' : '#dc2626'

  return (
    <button onClick={onClick}
      className="card p-4 text-left hover:shadow-lg hover:border-green-300 transition-all w-full group relative overflow-hidden">

      {/* 배경 컬러 스트라이프 */}
      <div className="absolute top-0 left-0 w-1 h-full rounded-l" style={{ background: teamColor }}/>

      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-3 pl-1">
        <div className="relative shrink-0">
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ background: teamColor }}>
            {player.style_badge}
          </div>
          {/* 등급 배지 */}
          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
            style={{ background: gradeColor }}>
            {grade}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm group-hover:text-green-700">
            선수 {player.track_id.replace('track_','')}
            {rank && rank <= 3 && <span className="ml-1">{['🥇','🥈','🥉'][rank-1]}</span>}
          </p>
          <p className="text-[11px] text-gray-500">{player.role_type} · {player.team_side === 'home' ? '홈팀' : '원정팀'}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-gray-900">{fmtDist(player.total_distance_m)}</p>
          <p className="text-[10px] text-gray-400">이동거리</p>
        </div>
      </div>

      {/* 4개 핵심 지표 */}
      <div className="grid grid-cols-4 gap-1.5 mb-3 pl-1">
        {[
          { icon: Zap, label: '체력', value: `${stamina}%`, color: staminaColor },
          { icon: Wind, label: '스프린트', value: `${player.sprint_count}회`, color: teamColor },
          { icon: Shield, label: '압박', value: `${player.press_count}회`, color: '#3b82f6' },
          { icon: Activity, label: '범위', value: `${Math.round(player.active_area_score)}`, color: '#f59e0b' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-gray-50 rounded-lg p-1.5 text-center">
            <Icon className="w-3 h-3 mx-auto mb-0.5" style={{ color }}/>
            <p className="text-xs font-bold text-gray-800">{value}</p>
            <p className="text-[9px] text-gray-400">{label}</p>
          </div>
        ))}
      </div>

      {/* 전/후반 이동거리 바 */}
      <div className="space-y-1 mb-3 pl-1">
        {[
          { label: '전반', dist: player.first_half_distance_m },
          { label: '후반', dist: player.second_half_distance_m, color: staminaColor },
        ].map(({ label, dist, color }) => {
          const max = Math.max(player.first_half_distance_m, player.second_half_distance_m, 1)
          return (
            <div key={label} className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 w-6">{label}</span>
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${(dist/max)*100}%`, background: color || teamColor }}/>
              </div>
              <span className="text-[10px] text-gray-500 w-12 text-right font-mono">{fmtDist(dist)}</span>
            </div>
          )
        })}
      </div>

      {/* 구역 분포 미니바 */}
      <div className="flex rounded-full overflow-hidden h-1.5 mb-3 ml-1">
        <div style={{ width: `${player.zone_left_pct}%`, background: '#60a5fa' }}/>
        <div style={{ width: `${player.zone_center_pct}%`, background: teamColor }}/>
        <div style={{ width: `${player.zone_right_pct}%`, background: '#f472b6' }}/>
      </div>

      {/* AI 코멘트 */}
      {player.comment && (
        <p className="text-[11px] text-gray-500 bg-gray-50 rounded-lg px-2.5 py-1.5 leading-relaxed line-clamp-2 ml-1">
          💬 {player.comment}
        </p>
      )}

      {/* 클릭 힌트 */}
      <p className="text-[9px] text-gray-300 text-right mt-1 group-hover:text-green-400 transition-colors">
        클릭하여 상세 히트맵 보기 →
      </p>
    </button>
  )
}
