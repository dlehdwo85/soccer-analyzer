'use client'
import { useEffect, useState } from 'react'
import { X, Activity, MapPin, Zap, TrendingDown } from 'lucide-react'
import { PlayerTrackSummary, PlayerDetail } from '@/lib/types'
import { api } from '@/lib/api'
import { fmtDist } from '@/lib/utils'
import HeatmapCanvas from './HeatmapCanvas'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface Props {
  matchId: number
  player: PlayerTrackSummary
  teamColor: string
  onClose: () => void
}

export default function PlayerDetailModal({ matchId, player, teamColor, onClose }: Props) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getPlayerDetail(matchId, player.track_id)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [matchId, player.track_id])

  const staminaRatio = player.first_half_distance_m > 0
    ? Math.round((player.second_half_distance_m / player.first_half_distance_m) * 100)
    : 100

  // 10분 단위 활동량 (타임라인)
  const timelineData = detail?.frames
    ? Array.from({ length: 9 }, (_, i) => {
        const from = i * 10 * 60 * 1000
        const to = (i + 1) * 10 * 60 * 1000
        const seg = detail.frames.filter(f => f.timestamp_ms >= from && f.timestamp_ms < to)
        let dist = 0
        for (let j = 1; j < seg.length; j++) {
          const dx = (seg[j].x - seg[j - 1].x) * 105
          const dy = (seg[j].y - seg[j - 1].y) * 68
          dist += Math.sqrt(dx * dx + dy * dy)
        }
        return { label: `${i * 10}분`, dist: Math.round(dist) }
      })
    : []

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold" style={{ background: teamColor }}>
              {player.track_id.replace('track_', 'T')}
            </div>
            <div>
              <h2 className="font-bold text-gray-900">선수 {player.track_id.replace('track_', '')}</h2>
              <p className="text-sm text-gray-500">{player.team_side === 'home' ? '홈팀' : '원정팀'} · {player.style_badge}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* 핵심 지표 */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { icon: Activity, label: '총 이동거리', value: fmtDist(player.total_distance_m), color: 'text-green-600' },
              { icon: Zap, label: '체력 유지율', value: `${staminaRatio}%`, color: staminaRatio >= 85 ? 'text-green-600' : staminaRatio >= 65 ? 'text-yellow-600' : 'text-red-500' },
              { icon: MapPin, label: '활동 범위', value: `${Math.round(player.active_area_score)}점`, color: 'text-blue-600' },
              { icon: TrendingDown, label: '후반 감소', value: `${100 - staminaRatio}%`, color: 100 - staminaRatio > 30 ? 'text-red-500' : 'text-gray-600' },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="bg-gray-50 rounded-xl p-3 text-center">
                <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
                <p className={`text-lg font-bold ${color}`}>{value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* 히트맵 */}
          {loading ? (
            <div className="h-40 bg-gray-100 rounded-xl animate-pulse flex items-center justify-center text-gray-400 text-sm">
              히트맵 로딩 중...
            </div>
          ) : detail ? (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">활동 범위 히트맵</p>
              <HeatmapCanvas frames={detail.frames} color={teamColor} />
            </div>
          ) : null}

          {/* 타임라인 */}
          {timelineData.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">10분 단위 이동거리</p>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={timelineData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => [`${v}m`, '이동거리']} />
                  <Bar dataKey="dist" fill={teamColor} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* AI 코멘트 */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-green-700 mb-1">AI 분석 코멘트</p>
            <p className="text-sm text-gray-700 leading-relaxed">{player.comment}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
