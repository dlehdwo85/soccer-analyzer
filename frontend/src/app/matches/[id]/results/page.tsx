'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Users, Activity, TrendingUp, Brain, Zap, Shield, Star, BarChart2 } from 'lucide-react'
import { MatchSummary, PlayerTrackSummary, MatchAnalytics, CentroidPoint, FatiguePoint } from '@/lib/types'
import { api } from '@/lib/api'
import { fmtDist } from '@/lib/utils'
import PageHeader from '@/components/layout/PageHeader'
import MiniFieldMap from '@/components/analysis/MiniFieldMap'
import DistanceRanking from '@/components/analysis/DistanceRanking'
import PlayerCard from '@/components/analysis/PlayerCard'
import PlayerDetailModal from '@/components/analysis/PlayerDetailModal'
import FormationBoard from '@/components/analysis/FormationBoard'
import ZoneMap from '@/components/analysis/ZoneMap'
import FatigueChart from '@/components/analysis/FatigueChart'
import CentroidTimeline from '@/components/analysis/CentroidTimeline'
import PressureGauge from '@/components/analysis/PressureGauge'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts'

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>()
  const matchId = Number(id)
  const [summary, setSummary] = useState<MatchSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerTrackSummary | null>(null)
  const [filter, setFilter] = useState<'all'|'home'|'away'>('all')
  const [activeTab, setActiveTab] = useState<'overview'|'tactics'|'players'|'radar'>('overview')

  useEffect(() => {
    api.getSummary(matchId).then(setSummary).catch(console.error).finally(()=>setLoading(false))
  }, [matchId])

  if (loading) return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="grid grid-cols-4 gap-4 mb-6">{[1,2,3,4].map(i=><div key={i} className="card h-24 animate-pulse bg-gray-100"/>)}</div>
      <div className="grid grid-cols-3 gap-4">{[1,2,3,4,5,6].map(i=><div key={i} className="card h-48 animate-pulse bg-gray-100"/>)}</div>
    </div>
  )

  if (!summary) return (
    <div className="max-w-6xl mx-auto px-4 py-8 text-center">
      <p className="text-gray-500 mb-4">분석 결과를 불러올 수 없습니다.</p>
      <Link href={`/matches/${matchId}`} className="btn-primary inline-flex">분석 페이지로</Link>
    </div>
  )

  const { match, players, analytics } = summary
  const homePlayers = players.filter(p=>p.team_side==='home')
  const awayPlayers = players.filter(p=>p.team_side==='away')
  const filteredPlayers = filter==='all' ? players : filter==='home' ? homePlayers : awayPlayers
  const sortedByDist = [...players].sort((a,b)=>b.total_distance_m-a.total_distance_m)
  const topPlayer = sortedByDist[0]

  const homeZone = analytics ? JSON.parse(analytics.home_zone_map||'{}') : {}
  const awayZone  = analytics ? JSON.parse(analytics.away_zone_map||'{}') : {}
  const homeCentroid: CentroidPoint[] = analytics ? JSON.parse(analytics.home_centroid_timeline||'[]') : []
  const awayCentroid: CentroidPoint[] = analytics ? JSON.parse(analytics.away_centroid_timeline||'[]') : []
  const homeFatigue: FatiguePoint[] = analytics ? JSON.parse(analytics.home_fatigue_timeline||'[]') : []
  const awayFatigue: FatiguePoint[] = analytics ? JSON.parse(analytics.away_fatigue_timeline||'[]') : []

  // 팀 레이더 차트 데이터
  const homeAvg = (key: keyof PlayerTrackSummary) =>
    homePlayers.length ? homePlayers.reduce((s,p)=>s+(p[key] as number),0)/homePlayers.length : 0
  const awayAvg = (key: keyof PlayerTrackSummary) =>
    awayPlayers.length ? awayPlayers.reduce((s,p)=>s+(p[key] as number),0)/awayPlayers.length : 0

  const radarData = [
    { subject: '이동거리', home: Math.min(homeAvg('total_distance_m')/120, 100), away: Math.min(awayAvg('total_distance_m')/120, 100) },
    { subject: '활동범위', home: homeAvg('active_area_score'), away: awayAvg('active_area_score') },
    { subject: '스프린트', home: Math.min(homeAvg('sprint_count')*4, 100), away: Math.min(awayAvg('sprint_count')*4, 100) },
    { subject: '압박', home: Math.min(homeAvg('press_count')*3, 100), away: Math.min(awayAvg('press_count')*3, 100) },
    { subject: '체력유지', home: homePlayers.length ? homePlayers.reduce((s,p)=>s+(p.first_half_distance_m>0?p.second_half_distance_m/p.first_half_distance_m*100:100),0)/homePlayers.length : 0,
      away: awayPlayers.length ? awayPlayers.reduce((s,p)=>s+(p.first_half_distance_m>0?p.second_half_distance_m/p.first_half_distance_m*100:100),0)/awayPlayers.length : 0 },
    { subject: '피로저항', home: 100-homeAvg('fatigue_index'), away: 100-awayAvg('fatigue_index') },
  ]

  // MVP 선수 (이동거리 + 스프린트 + 압박 종합)
  const mvpScore = (p: PlayerTrackSummary) =>
    p.total_distance_m/100 + p.sprint_count*30 + p.press_count*20 + p.active_area_score*5
  const mvp = [...players].sort((a,b)=>mvpScore(b)-mvpScore(a))[0]

  // 최다 스프린트
  const topSprinter = [...players].sort((a,b)=>b.sprint_count-a.sprint_count)[0]

  // 피로도 최저 (가장 꾸준한 선수)
  const ironPlayer = [...players].filter(p=>p.style_badge!=='GK').sort((a,b)=>a.fatigue_index-b.fatigue_index)[0]

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader
        title={`${match.title} — 분석 결과`}
        subtitle={`${match.home_team_name} vs ${match.away_team_name} · ${match.field_type==='soccer'?'축구':'풋살'}`}
        actions={<Link href={`/matches/${matchId}`} className="btn-secondary"><ArrowLeft className="w-4 h-4"/>경기로</Link>}
      />

      {/* 요약 카드 4개 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2"><Activity className="w-4 h-4 text-green-600"/><p className="text-xs text-gray-500 uppercase tracking-wide">총 이동거리</p></div>
          <p className="text-2xl font-bold">{(summary.total_distance_km/1000).toFixed(1)}</p>
          <p className="text-xs text-gray-400">km 합산</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2"><Users className="w-4 h-4 text-blue-600"/><p className="text-xs text-gray-500 uppercase tracking-wide">분석 선수</p></div>
          <p className="text-2xl font-bold">{players.length}</p>
          <p className="text-xs text-gray-400">홈 {homePlayers.length} · 원정 {awayPlayers.length}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2"><Star className="w-4 h-4 text-yellow-500"/><p className="text-xs text-gray-500 uppercase tracking-wide">경기 MVP</p></div>
          {mvp && <>
            <p className="text-lg font-bold" style={{color: mvp.team_side==='home'?match.home_team_color:match.away_team_color}}>
              선수 {mvp.track_id.replace('track_','')}
            </p>
            <p className="text-xs text-gray-400">{mvp.role_type} · {fmtDist(mvp.total_distance_m)}</p>
          </>}
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2"><Brain className="w-4 h-4 text-purple-600"/><p className="text-xs text-gray-500 uppercase tracking-wide">포메이션</p></div>
          <p className="text-base font-bold" style={{color:match.home_team_color}}>{analytics?.home_formation||'—'}</p>
          <p className="text-base font-bold" style={{color:match.away_team_color}}>{analytics?.away_formation||'—'}</p>
        </div>
      </div>

      {/* 특별 어워드 3개 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { emoji: '🏃', title: '최다 스프린트', player: topSprinter, stat: `${topSprinter?.sprint_count}회` },
          { emoji: '⚡', title: '경기 MVP', player: mvp, stat: fmtDist(mvp?.total_distance_m||0) },
          { emoji: '🛡️', title: '최고 체력', player: ironPlayer, stat: `피로도 ${Math.round(ironPlayer?.fatigue_index||0)}%` },
        ].map(({ emoji, title, player: p, stat }) => p && (
          <button key={title} onClick={() => p && setSelectedPlayer(p)}
            className="card p-3 text-center hover:border-green-300 transition-all">
            <div className="text-2xl mb-1">{emoji}</div>
            <p className="text-xs text-gray-500 mb-1">{title}</p>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold mx-auto mb-1"
              style={{background: p.team_side==='home'?match.home_team_color:match.away_team_color}}>
              {p.style_badge}
            </div>
            <p className="text-xs font-bold text-gray-800">선수 {p.track_id.replace('track_','')}</p>
            <p className="text-xs text-green-600 font-medium">{stat}</p>
          </button>
        ))}
      </div>

      {/* AI 총평 */}
      {analytics?.match_summary_text && (
        <div className="card p-5 mb-4 bg-gradient-to-r from-green-50 to-white border-green-200">
          <div className="flex items-center gap-2 mb-2">
            <Brain className="w-4 h-4 text-green-600"/>
            <h2 className="font-semibold text-green-800 text-sm">AI 경기 총평</h2>
          </div>
          <p className="text-gray-700 leading-relaxed text-sm">{analytics.match_summary_text}</p>
        </div>
      )}

      {/* 탭 */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-6 w-fit">
        {([['overview','경기 개요'],['tactics','전술 분석'],['radar','팀 레이더'],['players','선수 카드']] as const).map(([tab,label])=>(
          <button key={tab} onClick={()=>setActiveTab(tab)}
            className={`px-4 py-2 text-sm rounded-md transition-all ${activeTab===tab?'bg-white shadow font-medium text-gray-900':'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* 경기 개요 탭 */}
      {activeTab==='overview' && (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="card p-5">
              <h2 className="font-semibold text-gray-900 mb-3">팀 평균 포지션 맵</h2>
              <MiniFieldMap
                homeColor={match.home_team_color} awayColor={match.away_team_color}
                homeAvgX={summary.home_avg_x} homeAvgY={summary.home_avg_y}
                awayAvgX={summary.away_avg_x} awayAvgY={summary.away_avg_y}
                players={players}
              />
              <div className="flex gap-4 mt-3 text-xs text-gray-500">
                <span className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full" style={{background:match.home_team_color}}/>{match.home_team_name}</span>
                <span className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full" style={{background:match.away_team_color}}/>{match.away_team_name}</span>
              </div>
            </div>
            <div className="card p-5">
              <h2 className="font-semibold text-gray-900 mb-3">이동거리 TOP 7</h2>
              <DistanceRanking players={players} homeColor={match.home_team_color} awayColor={match.away_team_color} onSelect={setSelectedPlayer}/>
            </div>
          </div>

          {analytics && (
            <div className="card p-5">
              <h2 className="font-semibold text-gray-900 mb-4">팀 총 이동거리 비교</h2>
              <div className="space-y-3">
                {[
                  {name:match.home_team_name, dist:analytics.home_total_distance_m, color:match.home_team_color},
                  {name:match.away_team_name, dist:analytics.away_total_distance_m, color:match.away_team_color},
                ].map(team=>{
                  const max=Math.max(analytics.home_total_distance_m,analytics.away_total_distance_m)
                  return (
                    <div key={team.name}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium" style={{color:team.color}}>{team.name}</span>
                        <span className="font-bold">{fmtDist(team.dist)}</span>
                      </div>
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{width:`${(team.dist/max)*100}%`,background:team.color}}/>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 전술 분석 탭 */}
      {activeTab==='tactics' && analytics && (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="card p-5">
              <h2 className="font-semibold text-gray-900 mb-3">포메이션 분석</h2>
              <FormationBoard
                homeFormation={analytics.home_formation} awayFormation={analytics.away_formation}
                homeColor={match.home_team_color} awayColor={match.away_team_color}
                homeName={match.home_team_name} awayName={match.away_team_name}
              />
            </div>
            <div className="card p-5">
              <h2 className="font-semibold text-gray-900 mb-3">압박 강도</h2>
              <PressureGauge
                homePress={analytics.home_avg_press_dist} awayPress={analytics.away_avg_press_dist}
                homeColor={match.home_team_color} awayColor={match.away_team_color}
                homeName={match.home_team_name} awayName={match.away_team_name}
              />
            </div>
            <div className="card p-5 md:col-span-2">
              <h2 className="font-semibold text-gray-900 mb-3">9구역 공간 점유율</h2>
              <ZoneMap
                homeZone={homeZone} awayZone={awayZone}
                homeColor={match.home_team_color} awayColor={match.away_team_color}
                homeName={match.home_team_name} awayName={match.away_team_name}
              />
            </div>
            <div className="card p-5">
              <h2 className="font-semibold text-gray-900 mb-3">팀 무게중심 이동</h2>
              <CentroidTimeline homeData={homeCentroid} awayData={awayCentroid}
                homeColor={match.home_team_color} awayColor={match.away_team_color}/>
            </div>
            <div className="card p-5">
              <h2 className="font-semibold text-gray-900 mb-3">팀 피로도 추이</h2>
              <FatigueChart homeData={homeFatigue} awayData={awayFatigue}
                homeColor={match.home_team_color} awayColor={match.away_team_color}
                homeName={match.home_team_name} awayName={match.away_team_name}/>
            </div>
          </div>
        </div>
      )}

      {/* 팀 레이더 탭 */}
      {activeTab==='radar' && (
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-1">팀 종합 역량 레이더</h2>
          <p className="text-xs text-gray-500 mb-4">6가지 지표를 종합한 팀 역량 비교</p>
          <ResponsiveContainer width="100%" height={350}>
            <RadarChart data={radarData}>
              <PolarGrid/>
              <PolarAngleAxis dataKey="subject" tick={{fontSize:12}}/>
              <PolarRadiusAxis angle={30} domain={[0,100]} tick={{fontSize:9}}/>
              <Radar name={match.home_team_name} dataKey="home" stroke={match.home_team_color}
                fill={match.home_team_color} fillOpacity={0.3} strokeWidth={2}/>
              <Radar name={match.away_team_name} dataKey="away" stroke={match.away_team_color}
                fill={match.away_team_color} fillOpacity={0.3} strokeWidth={2}/>
              <Legend/>
              <Tooltip contentStyle={{fontSize:11, borderRadius:8}}
                formatter={(v:number) => [`${v.toFixed(1)}점`, '']}/>
            </RadarChart>
          </ResponsiveContainer>

          {/* 지표 설명 */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            {[
              {label:'이동거리', desc:'선수 1인 평균 이동거리'},
              {label:'활동범위', desc:'경기장 내 커버 범위'},
              {label:'스프린트', desc:'고속 이동 횟수'},
              {label:'압박', desc:'상대 선수 압박 횟수'},
              {label:'체력유지', desc:'전후반 활동량 유지율'},
              {label:'피로저항', desc:'피로도의 역수 (낮을수록 좋음)'},
            ].map(({label, desc}) => (
              <div key={label} className="flex gap-2 text-xs text-gray-500">
                <span className="font-medium text-gray-700">{label}</span>
                <span>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 선수 카드 탭 */}
      {activeTab==='players' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">선수별 상세 카드</h2>
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
              {(['all','home','away'] as const).map(f=>(
                <button key={f} onClick={()=>setFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-md transition-all ${filter===f?'bg-white shadow font-medium':'text-gray-500'}`}>
                  {f==='all'?'전체':f==='home'?`홈 (${homePlayers.length})`:`원정 (${awayPlayers.length})`}
                </button>
              ))}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPlayers.map((p, i) => (
              <PlayerCard key={p.track_id} player={p}
                teamColor={p.team_side==='home'?match.home_team_color:match.away_team_color}
                rank={sortedByDist.findIndex(s=>s.track_id===p.track_id)+1}
                onClick={()=>setSelectedPlayer(p)}/>
            ))}
          </div>
        </div>
      )}

      {selectedPlayer && (
        <PlayerDetailModal matchId={matchId} player={selectedPlayer}
          teamColor={selectedPlayer.team_side==='home'?match.home_team_color:match.away_team_color}
          onClose={()=>setSelectedPlayer(null)}/>
      )}
    </div>
  )
}
