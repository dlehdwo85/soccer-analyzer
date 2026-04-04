'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Trophy, Zap, Activity, Route, TrendingUp, TrendingDown } from 'lucide-react'
import { PlayerProfile, PlayerMatchHistory } from '@/lib/types'
import { api } from '@/lib/api'
import PageHeader from '@/components/layout/PageHeader'
import { toast } from 'sonner'

function StatCard({ label, value, unit, icon: Icon, color = 'blue' }: {
  label: string; value: string | number; unit?: string
  icon: React.ElementType; color?: string
}) {
  return (
    <div className={`p-4 rounded-xl bg-${color}-50 border border-${color}-100`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 text-${color}-600`}/>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
      <p className={`text-2xl font-bold text-${color}-700`}>
        {value}<span className="text-sm font-normal ml-1 text-gray-400">{unit}</span>
      </p>
    </div>
  )
}

function GradeBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100)
  const color = pct > 70 ? 'red' : pct > 40 ? 'yellow' : 'green'
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500">{label}</span>
        <span className={`font-medium text-${color}-600`}>{pct}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full bg-${color}-400 transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function DataSourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    gps:    { label: 'GPS',    cls: 'bg-green-100 text-green-700' },
    video:  { label: '영상',   cls: 'bg-purple-100 text-purple-700' },
    sample: { label: '샘플',   cls: 'bg-gray-100 text-gray-500' },
  }
  const { label, cls } = map[source] ?? map.sample
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
}

export default function PlayerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const jersey = Number(id)

  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [history, setHistory] = useState<PlayerMatchHistory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.getPlayerProfile(jersey),
      api.getPlayerHistory(jersey),
    ])
      .then(([p, h]) => { setProfile(p); setHistory(h) })
      .catch(() => toast.error('선수 정보를 불러올 수 없습니다'))
      .finally(() => setLoading(false))
  }, [jersey])

  if (loading) return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
      {[1,2,3].map(i => <div key={i} className="card h-24 animate-pulse bg-gray-100"/>)}
    </div>
  )

  if (!profile) return (
    <div className="max-w-3xl mx-auto px-4 py-8 text-center">
      <p className="text-gray-500 mb-2">등번호 {jersey}번 선수 프로필이 없습니다.</p>
      <p className="text-xs text-gray-400 mb-4">GPS 데이터 분석을 완료하면 자동으로 생성됩니다.</p>
      <Link href="/" className="btn-secondary text-sm">홈으로</Link>
    </div>
  )

  const avgDistPerMatch = profile.total_matches > 0
    ? (profile.total_distance_m / profile.total_matches / 1000).toFixed(2)
    : '0'

  // 성장 추이: 이전 절반 경기 vs 최근 절반 경기 평균 거리
  const mid = Math.floor(history.length / 2)
  const earlyAvg = mid > 0
    ? history.slice(mid).reduce((s, h) => s + h.total_distance_m, 0) / (history.length - mid)
    : 0
  const recentAvg = mid > 0
    ? history.slice(0, mid).reduce((s, h) => s + h.total_distance_m, 0) / mid
    : 0
  const improving = recentAvg >= earlyAvg

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <PageHeader
        title={`#${profile.jersey_number} ${profile.player_name}`}
        subtitle={profile.team_name || '팀 미지정'}
        actions={
          <Link href="/" className="btn-secondary"><ArrowLeft className="w-4 h-4"/>목록</Link>
        }
      />

      {/* 누적 통계 */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard label="총 경기" value={profile.total_matches} unit="경기" icon={Trophy} color="blue"/>
        <StatCard
          label="경기당 평균 거리"
          value={avgDistPerMatch}
          unit="km"
          icon={Route}
          color="green"
        />
        <StatCard
          label="총 스프린트"
          value={profile.total_sprints.toLocaleString()}
          unit="회"
          icon={Zap}
          color="orange"
        />
        <StatCard
          label="총 이동거리"
          value={(profile.total_distance_m / 1000).toFixed(1)}
          unit="km"
          icon={Activity}
          color="purple"
        />
      </div>

      {/* 피로도 + 성장 추이 */}
      <div className="card p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-4">컨디션 지표</h2>
        <GradeBar value={profile.avg_fatigue} label="평균 피로도"/>
        {history.length >= 2 && (
          <div className="mt-4 flex items-center gap-2 p-3 rounded-xl bg-gray-50">
            {improving
              ? <TrendingUp className="w-5 h-5 text-green-600 shrink-0"/>
              : <TrendingDown className="w-5 h-5 text-red-500 shrink-0"/>
            }
            <div>
              <p className={`text-sm font-medium ${improving ? 'text-green-700' : 'text-red-600'}`}>
                {improving ? '체력 향상 중' : '체력 하락 추세'}
              </p>
              <p className="text-xs text-gray-400">
                초반 {(earlyAvg / 1000).toFixed(2)}km → 최근 {(recentAvg / 1000).toFixed(2)}km (경기당 이동거리)
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 경기 히스토리 */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-3">경기 이력</h2>
        {history.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">분석된 경기가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <Link
                key={h.match_id}
                href={`/matches/${h.match_id}/results`}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 border border-gray-100 transition-colors"
              >
                <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                  <Activity className="w-5 h-5 text-gray-500"/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{h.match_title}</p>
                  <p className="text-xs text-gray-400">
                    {h.match_date ?? '날짜 미지정'} · 이동거리 {(h.total_distance_m / 1000).toFixed(2)}km
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <DataSourceBadge source={h.data_source}/>
                  <p className="text-xs text-gray-400">
                    스프린트 {h.sprint_count}회
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
