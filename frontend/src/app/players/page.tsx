'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, Route, Zap, Activity, ChevronRight } from 'lucide-react'
import { PlayerProfile } from '@/lib/types'
import { api } from '@/lib/api'
import PageHeader from '@/components/layout/PageHeader'
import { toast } from 'sonner'

export default function PlayersPage() {
  const [profiles, setProfiles] = useState<PlayerProfile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getPlayerProfiles()
      .then(setProfiles)
      .catch(() => toast.error('선수 목록을 불러올 수 없습니다'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-3">
      {[1,2,3,4].map(i => <div key={i} className="card h-20 animate-pulse bg-gray-100"/>)}
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <PageHeader
        title="선수 프로필"
        subtitle="GPS 분석 경기에서 등록된 선수 목록"
      />

      {profiles.length === 0 ? (
        <div className="card p-10 text-center">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3"/>
          <p className="text-gray-500 font-medium mb-1">등록된 선수가 없습니다</p>
          <p className="text-xs text-gray-400 mb-4">GPS 데이터로 경기를 분석하면 자동으로 선수 프로필이 생성됩니다.</p>
          <Link href="/" className="btn-primary text-sm">경기 분석 시작</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => (
            <Link
              key={p.id}
              href={`/players/${p.jersey_number}`}
              className="card flex items-center gap-4 p-4 hover:shadow-md transition-all"
            >
              {/* 등번호 뱃지 */}
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-green-700 flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-lg">{p.jersey_number}</span>
              </div>

              {/* 기본 정보 */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{p.player_name}</p>
                <p className="text-xs text-gray-400">{p.team_name || '팀 미지정'} · {p.total_matches}경기</p>
              </div>

              {/* 핵심 지표 */}
              <div className="flex items-center gap-4 text-right">
                <div className="hidden sm:block">
                  <div className="flex items-center gap-1 justify-end text-xs text-gray-400 mb-0.5">
                    <Route className="w-3 h-3"/>총 이동
                  </div>
                  <p className="text-sm font-bold text-gray-800">
                    {(p.total_distance_m / 1000).toFixed(1)}km
                  </p>
                </div>
                <div className="hidden sm:block">
                  <div className="flex items-center gap-1 justify-end text-xs text-gray-400 mb-0.5">
                    <Zap className="w-3 h-3"/>스프린트
                  </div>
                  <p className="text-sm font-bold text-gray-800">{p.total_sprints}회</p>
                </div>
                <div>
                  <div className="flex items-center gap-1 justify-end text-xs text-gray-400 mb-0.5">
                    <Activity className="w-3 h-3"/>피로도
                  </div>
                  <p className={`text-sm font-bold ${
                    p.avg_fatigue > 0.7 ? 'text-red-600' :
                    p.avg_fatigue > 0.4 ? 'text-yellow-600' : 'text-green-600'
                  }`}>
                    {Math.round(p.avg_fatigue * 100)}%
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300"/>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
