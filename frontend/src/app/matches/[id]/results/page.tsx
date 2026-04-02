'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Users, Activity, TrendingUp } from 'lucide-react'
import { MatchSummary, PlayerTrackSummary } from '@/lib/types'
import { api } from '@/lib/api'
import { fmtDist } from '@/lib/utils'
import PageHeader from '@/components/layout/PageHeader'
import MiniFieldMap from '@/components/analysis/MiniFieldMap'
import DistanceRanking from '@/components/analysis/DistanceRanking'
import PlayerCard from '@/components/analysis/PlayerCard'
import PlayerDetailModal from '@/components/analysis/PlayerDetailModal'

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>()
  const matchId = Number(id)

  const [summary, setSummary] = useState<MatchSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerTrackSummary | null>(null)
  const [filter, setFilter] = useState<'all' | 'home' | 'away'>('all')

  useEffect(() => {
    api.getSummary(matchId)
      .then(setSummary)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [matchId])

  if (loading) return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[1,2,3,4].map(i => <div key={i} className="card h-24 animate-pulse bg-gray-100"/>)}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[1,2,3,4,5,6].map(i => <div key={i} className="card h-48 animate-pulse bg-gray-100"/>)}
      </div>
    </div>
  )

  if (!summary) return (
    <div className="max-w-6xl mx-auto px-4 py-8 text-center">
      <p className="text-gray-500 mb-4">분석 결과를 불러올 수 없습니다.</p>
      <Link href={`/matches/${matchId}`} className="btn-primary inline-flex">분석 페이지로</Link>
    </div>
  )

  const { match, players } = summary
  const homePlayers = players.filter(p => p.team_side === 'home')
  const awayPlayers = players.filter(p => p.team_side === 'away')
  const filteredPlayers = filter === 'all' ? players : filter === 'home' ? homePlayers : awayPlayers

  const topPlayer = [...players].sort((a,b) => b.total_distance_m - a.total_distance_m)[0]

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader
        title={`${match.title} — 분석 결과`}
        subtitle={`${match.home_team_name} vs ${match.away_team_name} · ${match.field_type === 'soccer' ? '축구' : '풋살'}`}
        actions={
          <Link href={`/matches/${matchId}`} className="btn-secondary">
            <ArrowLeft className="w-4 h-4" />경기로
          </Link>
        }
      />

      {/* 요약 카드 4개 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-green-600" />
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">총 이동거리</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{(summary.total_distance_km / 1000).toFixed(1)}</p>
          <p className="text-xs text-gray-400">km (전체 선수 합산)</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-blue-600" />
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">분석 선수</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{players.length}</p>
          <p className="text-xs text-gray-400">홈 {homePlayers.length} · 원정 {awayPlayers.length}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-purple-600" />
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">최다 이동</p>
          </div>
          {topPlayer && (
            <>
              <p className="text-2xl font-bold text-gray-900">{fmtDist(topPlayer.total_distance_m)}</p>
              <p className="text-xs text-gray-400">선수 {topPlayer.track_id.replace('track_','')} · {topPlayer.team_side === 'home' ? '홈' : '원정'}</p>
            </>
          )}
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-orange-500" />
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">평균 이동거리</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {fmtDist(players.length > 0 ? summary.total_distance_km / players.length : 0)}
          </p>
          <p className="text-xs text-gray-400">선수 1인 평균</p>
        </div>
      </div>

      {/* 팀 포지션 맵 + 이동거리 랭킹 */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-3">팀 평균 포지션 맵</h2>
          <MiniFieldMap
            homeColor={match.home_team_color}
            awayColor={match.away_team_color}
            homeAvgX={summary.home_avg_x}
            homeAvgY={summary.home_avg_y}
            awayAvgX={summary.away_avg_x}
            awayAvgY={summary.away_avg_y}
            players={players}
          />
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ background: match.home_team_color }} />
              {match.home_team_name} (홈)
            </span>
            <span className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ background: match.away_team_color }} />
              {match.away_team_name} (원정)
            </span>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-3">이동거리 TOP 7</h2>
          <DistanceRanking
            players={players}
            homeColor={match.home_team_color}
            awayColor={match.away_team_color}
            onSelect={setSelectedPlayer}
          />
        </div>
      </div>

      {/* 선수 카드 그리드 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">선수별 상세 카드</h2>
          {/* 필터 */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {(['all','home','away'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-md transition-all ${filter === f ? 'bg-white shadow font-medium text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {f === 'all' ? '전체' : f === 'home' ? `홈 (${homePlayers.length})` : `원정 (${awayPlayers.length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPlayers.map(p => (
            <PlayerCard
              key={p.track_id}
              player={p}
              teamColor={p.team_side === 'home' ? match.home_team_color : match.away_team_color}
              onClick={() => setSelectedPlayer(p)}
            />
          ))}
        </div>
      </div>

      {/* 선수 상세 모달 */}
      {selectedPlayer && (
        <PlayerDetailModal
          matchId={matchId}
          player={selectedPlayer}
          teamColor={selectedPlayer.team_side === 'home' ? match.home_team_color : match.away_team_color}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  )
}
