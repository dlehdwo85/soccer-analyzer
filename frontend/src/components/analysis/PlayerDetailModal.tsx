'use client'
import { useEffect, useState } from 'react'
import { X, Activity, MapPin, Zap, TrendingDown, Shield, Target, Wind } from 'lucide-react'
import { PlayerTrackSummary, PlayerDetail } from '@/lib/types'
import { api } from '@/lib/api'
import { fmtDist } from '@/lib/utils'
import HeatmapCanvas from './HeatmapCanvas'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, ReferenceLine } from 'recharts'

interface Props {
  matchId: number
  player: PlayerTrackSummary
  teamColor: string
  onClose: () => void
}

export default function PlayerDetailModal({ matchId, player, teamColor, onClose }: Props) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'heatmap' | 'timeline' | 'stats'>('heatmap')

  useEffect(() => {
    api.getPlayerDetail(matchId, player.track_id)
      .then(setDetail).catch(console.error).finally(() => setLoading(false))
  }, [matchId, player.track_id])

  const stamina = player.first_half_distance_m > 0
    ? Math.round((player.second_half_distance_m / player.first_half_distance_m) * 100)
    : 100

  const fatigueColor = player.fatigue_index > 40 ? 'text-red-500' : player.fatigue_index > 20 ? 'text-yellow-600' : 'text-green-600'
  const staminaColor = stamina >= 85 ? 'text-green-600' : stamina >= 65 ? 'text-yellow-600' : 'text-red-500'

  // 10분 단위 타임라인
  const timelineData = detail?.frames
    ? Array.from({ length: 9 }, (_, i) => {
        const from = i * 10 * 60 * 1000
        const to = (i + 1) * 10 * 60 * 1000
        const seg = detail.frames.filter(f => f.timestamp_ms >= from && f.timestamp_ms < to)
        let dist = 0
        for (let j = 1; j < seg.length; j++) {
          const dx = (seg[j].x - seg[j-1].x) * 105
          const dy = (seg[j].y - seg[j-1].y) * 68
          dist += Math.sqrt(dx*dx + dy*dy)
        }
        // 속도 계산
        const duration = (to - from) / 1000
        const speed = dist / duration * 3.6  // km/h
        return { label: `${i*10}분`, dist: Math.round(dist), speed: Math.round(speed * 10) / 10 }
      })
    : []

  // 평균 속도
  const avgSpeed = timelineData.length > 0
    ? (timelineData.reduce((s, d) => s + d.speed, 0) / timelineData.length).toFixed(1)
    : '0'

  // 구역 분포
  const zoneData = [
    { name: '좌측', value: player.zone_left_pct, color: '#60a5fa' },
    { name: '중앙', value: player.zone_center_pct, color: teamColor },
    { name: '우측', value: player.zone_right_pct, color: '#f472b6' },
  ]

  const statItems = [
    { icon: Activity, label: '총 이동거리', value: fmtDist(player.total_distance_m), color: 'text-green-600', bg: 'bg-green-50' },
    { icon: Zap, label: '체력 유지율', value: `${stamina}%`, color: staminaColor, bg: 'bg-yellow-50' },
    { icon: Wind, label: '스프린트', value: `${player.sprint_count}회`, color: 'text-purple-600', bg: 'bg-purple-50' },
    { icon: Shield, label: '압박 횟수', value: `${player.press_count}회`, color: 'text-blue-600', bg: 'bg-blue-50' },
    { icon: Target, label: '활동 범위', value: `${Math.round(player.active_area_score)}점`, color: 'text-orange-600', bg: 'bg-orange-50' },
    { icon: TrendingDown, label: '피로도', value: `${Math.round(player.fatigue_index)}%`, color: fatigueColor, bg: 'bg-red-50' },
  ]

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>

        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm"
              style={{ background: teamColor }}>
              {player.style_badge}
            </div>
            <div>
              <h2 className="font-bold text-gray-900">
                선수 {player.track_id.replace('track_','')}
                <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {player.role_type}
                </span>
              </h2>
              <p className="text-sm text-gray-500">
                {player.team_side === 'home' ? '홈팀' : '원정팀'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5"/>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* 핵심 지표 6개 */}
          <div className="grid grid-cols-3 gap-2">
            {statItems.map(({ icon: Icon, label, value, color, bg }) => (
              <div key={label} className={`${bg} rounded-xl p-3 text-center`}>
                <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`}/>
                <p className={`text-base font-bold ${color}`}>{value}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* 전반/후반 비교 바 */}
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-600 mb-3">전반 / 후반 이동거리 비교</p>
            <div className="space-y-2">
              {[
                { label: '전반', dist: player.first_half_distance_m, max: Math.max(player.first_half_distance_m, player.second_half_distance_m) },
                { label: '후반', dist: player.second_half_distance_m, max: Math.max(player.first_half_distance_m, player.second_half_distance_m) },
              ].map(({ label, dist, max }) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-6">{label}</span>
                  <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${(dist/max)*100}%`, background: teamColor }}/>
                  </div>
                  <span className="text-xs font-mono text-gray-700 w-16 text-right">{fmtDist(dist)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-[10px] text-gray-400">체력 유지율: {stamina}%</span>
              <span className="text-[10px] text-gray-400">평균 속도: {avgSpeed} km/h</span>
            </div>
          </div>

          {/* 탭 */}
          <div>
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-4">
              {([['heatmap','활동 히트맵'],['timeline','시간대 분석'],['stats','구역 분포']] as const).map(([tab, label]) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-all ${activeTab===tab?'bg-white shadow font-medium':'text-gray-500'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* 히트맵 탭 */}
            {activeTab === 'heatmap' && (
              loading ? (
                <div className="h-52 bg-gray-100 rounded-xl animate-pulse flex items-center justify-center text-gray-400 text-sm">
                  히트맵 생성 중...
                </div>
              ) : detail ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-600">활동 범위 히트맵</p>
                    <p className="text-[10px] text-gray-400">★ 평균 위치 · HOT 핵심 구역</p>
                  </div>
                  <HeatmapCanvas frames={detail.frames} color={teamColor}/>
                </div>
              ) : null
            )}

            {/* 타임라인 탭 */}
            {activeTab === 'timeline' && timelineData.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-600">10분 단위 이동거리 & 속도</p>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={timelineData} margin={{top:0,right:0,left:-25,bottom:0}}>
                    <XAxis dataKey="label" tick={{fontSize:9}}/>
                    <YAxis tick={{fontSize:9}}/>
                    <Tooltip formatter={(v:number) => [`${v}m`, '이동거리']}
                      contentStyle={{fontSize:10, borderRadius:8}}/>
                    <ReferenceLine y={player.total_distance_m/9} stroke="#94a3b8" strokeDasharray="3 3"/>
                    <Bar dataKey="dist" fill={teamColor} radius={[3,3,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs font-semibold text-gray-600">10분 단위 평균 속도 (km/h)</p>
                <ResponsiveContainer width="100%" height={100}>
                  <LineChart data={timelineData} margin={{top:0,right:0,left:-25,bottom:0}}>
                    <XAxis dataKey="label" tick={{fontSize:9}}/>
                    <YAxis tick={{fontSize:9}}/>
                    <Tooltip formatter={(v:number) => [`${v} km/h`, '속도']}
                      contentStyle={{fontSize:10, borderRadius:8}}/>
                    <Line type="monotone" dataKey="speed" stroke={teamColor} strokeWidth={2} dot={{r:3}}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* 구역 분포 탭 */}
            {activeTab === 'stats' && (
              <div className="space-y-4">
                <p className="text-xs font-semibold text-gray-600">좌/중앙/우 구역 활동 분포</p>
                <div className="space-y-2">
                  {zoneData.map(z => (
                    <div key={z.name} className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-8">{z.name}</span>
                      <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full flex items-center pl-2 text-white text-[10px] font-bold transition-all"
                          style={{ width: `${z.value}%`, background: z.color, minWidth: '30px' }}>
                          {z.value}%
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 포지션 스타일 분석 */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs font-semibold text-gray-600 mb-3">포지션 스타일 분석</p>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-white rounded-lg p-3">
                      <p className="text-gray-400 mb-1">주 활동 구역</p>
                      <p className="font-bold" style={{color: teamColor}}>
                        {player.zone_left_pct > player.zone_right_pct && player.zone_left_pct > player.zone_center_pct ? '좌측 편향' :
                         player.zone_right_pct > player.zone_left_pct && player.zone_right_pct > player.zone_center_pct ? '우측 편향' : '중앙 집중'}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <p className="text-gray-400 mb-1">활동 스타일</p>
                      <p className="font-bold" style={{color: teamColor}}>
                        {player.active_area_score > 65 ? '광역 커버형' :
                         player.active_area_score > 40 ? '균형형' : '집중형'}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <p className="text-gray-400 mb-1">체력 타입</p>
                      <p className="font-bold" style={{color: teamColor}}>
                        {stamina >= 90 ? '지구력형' : stamina >= 75 ? '일반형' : '폭발력형'}
                      </p>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <p className="text-gray-400 mb-1">압박 성향</p>
                      <p className="font-bold" style={{color: teamColor}}>
                        {player.press_count > 20 ? '고강도 압박' : player.press_count > 10 ? '적극적' : '수동적'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* AI 코멘트 */}
          <div className="bg-gradient-to-r from-green-50 to-white border border-green-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-green-700 mb-1.5">🤖 AI 분석 코멘트</p>
            <p className="text-sm text-gray-700 leading-relaxed">{player.comment}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
