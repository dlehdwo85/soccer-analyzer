'use client'
import { MatchSummary, PlayerTrackSummary } from '@/lib/types'
import { fmtDist } from '@/lib/utils'
import { Trophy, TrendingUp, TrendingDown, Minus, AlertTriangle, Star } from 'lucide-react'

interface Props {
  summary: MatchSummary
}

export default function MatchReport({ summary }: Props) {
  const { match, players, analytics } = summary
  const homePlayers = players.filter(p => p.team_side === 'home')
  const awayPlayers = players.filter(p => p.team_side === 'away')

  // 팀별 통계
  const teamStats = (ps: PlayerTrackSummary[]) => {
    if (!ps.length) return null
    const totalDist = ps.reduce((s,p) => s+p.total_distance_m, 0)
    const avgFatigue = ps.reduce((s,p) => s+(p.fatigue_index??0), 0) / ps.length
    const totalSprint = ps.reduce((s,p) => s+(p.sprint_count??0), 0)
    const totalPress = ps.reduce((s,p) => s+(p.press_count??0), 0)
    const avgStamina = ps.reduce((s,p) => {
      const r = p.first_half_distance_m > 0 ? p.second_half_distance_m/p.first_half_distance_m : 1
      return s + r
    }, 0) / ps.length
    return { totalDist, avgFatigue, totalSprint, totalPress, avgStamina }
  }

  const homeStats = teamStats(homePlayers)
  const awayStats = teamStats(awayPlayers)

  // MVP 선수
  const mvp = [...players].sort((a,b) => {
    const scoreA = a.total_distance_m/1000 + a.sprint_count*0.3 + a.press_count*0.2 + a.active_area_score*0.05
    const scoreB = b.total_distance_m/1000 + b.sprint_count*0.3 + b.press_count*0.2 + b.active_area_score*0.05
    return scoreB - scoreA
  })[0]

  // 경고 선수 (피로도 높음)
  const fatigued = players.filter(p => (p.fatigue_index??0) > 50).sort((a,b)=>(b.fatigue_index??0)-(a.fatigue_index??0))

  const compare = (a: number, b: number) => {
    if (Math.abs(a-b) < a*0.05) return <Minus className="w-3 h-3 text-gray-400"/>
    return a > b
      ? <TrendingUp className="w-3 h-3 text-green-500"/>
      : <TrendingDown className="w-3 h-3 text-red-400"/>
  }

  return (
    <div className="space-y-4">

      {/* MVP */}
      {mvp && (
        <div className="card p-4 border-yellow-200 bg-gradient-to-r from-yellow-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-400 rounded-full flex items-center justify-center">
              <Trophy className="w-5 h-5 text-white"/>
            </div>
            <div className="flex-1">
              <p className="text-xs text-yellow-700 font-semibold uppercase tracking-wide">경기 MVP</p>
              <p className="font-bold text-gray-900">
                선수 {mvp.track_id.replace('track_','')} · {mvp.team_side==='home'?match.home_team_name:match.away_team_name}
              </p>
              <p className="text-xs text-gray-500">
                {fmtDist(mvp.total_distance_m)} · 스프린트 {mvp.sprint_count}회 · 압박 {mvp.press_count}회
              </p>
            </div>
            <div className="w-10 h-10 bg-yellow-400 rounded-full flex items-center justify-center text-white font-black text-sm">
              MVP
            </div>
          </div>
        </div>
      )}

      {/* 팀 대결 지표 */}
      {homeStats && awayStats && (
        <div className="card p-4">
          <h3 className="font-semibold text-gray-900 mb-3 text-sm">팀 대결 지표</h3>
          <div className="space-y-2.5">
            {[
              { label: '총 이동거리', home: homeStats.totalDist/1000, away: awayStats.totalDist/1000, unit:'km', fmt:(v:number)=>v.toFixed(1) },
              { label: '스프린트 합계', home: homeStats.totalSprint, away: awayStats.totalSprint, unit:'회', fmt:(v:number)=>v.toString() },
              { label: '압박 횟수', home: homeStats.totalPress, away: awayStats.totalPress, unit:'회', fmt:(v:number)=>v.toString() },
              { label: '평균 체력유지', home: homeStats.avgStamina*100, away: awayStats.avgStamina*100, unit:'%', fmt:(v:number)=>Math.round(v).toString() },
              { label: '평균 피로도', home: homeStats.avgFatigue, away: awayStats.avgFatigue, unit:'%', fmt:(v:number)=>Math.round(v).toString(), reverse:true },
            ].map(({ label, home, away, unit, fmt, reverse }) => {
              const homeWin = reverse ? home < away : home > away
              const total = home + away || 1
              const homeW = Math.round((home/total)*100)
              return (
                <div key={label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium" style={{color:match.home_team_color}}>
                      {fmt(home)}{unit}
                    </span>
                    <span className="text-gray-500 flex items-center gap-1">
                      {!reverse ? compare(home, away) : compare(away, home)}
                      {label}
                      {reverse ? compare(away, home) : compare(home, away)}
                    </span>
                    <span className="font-medium" style={{color:match.away_team_color}}>
                      {fmt(away)}{unit}
                    </span>
                  </div>
                  <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
                    <div className="h-full rounded-l-full transition-all"
                      style={{width:`${homeW}%`, background:match.home_team_color}}/>
                    <div className="h-full rounded-r-full transition-all"
                      style={{width:`${100-homeW}%`, background:match.away_team_color}}/>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 피로도 경고 */}
      {fatigued.length > 0 && (
        <div className="card p-4 border-orange-200 bg-orange-50">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-orange-500"/>
            <h3 className="font-semibold text-orange-800 text-sm">피로도 주의 선수</h3>
          </div>
          <div className="space-y-2">
            {fatigued.slice(0,3).map(p => {
              const color = p.team_side==='home'?match.home_team_color:match.away_team_color
              const fatigue = p.fatigue_index??0
              return (
                <div key={p.track_id} className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{background:color}}>
                    {p.track_id.replace('track_','')}
                  </div>
                  <div className="flex-1">
                    <div className="h-2 bg-orange-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-orange-400 transition-all"
                        style={{width:`${Math.min(fatigue,100)}%`}}/>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-orange-700 w-10 text-right">{Math.round(fatigue)}%</span>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-orange-600 mt-2">* 해당 선수들의 교체 또는 훈련 강도 조절을 권장합니다.</p>
        </div>
      )}

      {/* 스타 플레이어 */}
      <div className="card p-4">
        <h3 className="font-semibold text-gray-900 mb-3 text-sm flex items-center gap-1">
          <Star className="w-4 h-4 text-yellow-400"/> 카테고리별 TOP
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: '최다 이동', icon: '🏃', player: [...players].sort((a,b)=>b.total_distance_m-a.total_distance_m)[0], val: (p:PlayerTrackSummary) => fmtDist(p.total_distance_m) },
            { label: '최다 스프린트', icon: '⚡', player: [...players].sort((a,b)=>(b.sprint_count??0)-(a.sprint_count??0))[0], val: (p:PlayerTrackSummary) => `${p.sprint_count}회` },
            { label: '최다 압박', icon: '🛡', player: [...players].sort((a,b)=>(b.press_count??0)-(a.press_count??0))[0], val: (p:PlayerTrackSummary) => `${p.press_count}회` },
            { label: '최고 체력', icon: '💪', player: [...players].sort((a,b)=>{
              const ra = a.first_half_distance_m>0?a.second_half_distance_m/a.first_half_distance_m:1
              const rb = b.first_half_distance_m>0?b.second_half_distance_m/b.first_half_distance_m:1
              return rb-ra
            })[0], val: (p:PlayerTrackSummary) => {
              const r = p.first_half_distance_m>0?Math.round(p.second_half_distance_m/p.first_half_distance_m*100):100
              return `${r}%`
            }},
          ].map(({ label, icon, player, val }) => {
            if (!player) return null
            const color = player.team_side==='home'?match.home_team_color:match.away_team_color
            return (
              <div key={label} className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500 mb-1">{icon} {label}</p>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{background:color}}>
                    {player.track_id.replace('track_','')}
                  </div>
                  <span className="text-xs font-bold text-gray-800">{val(player)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
