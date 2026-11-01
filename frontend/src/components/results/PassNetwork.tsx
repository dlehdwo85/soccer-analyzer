'use client'
import { useState } from 'react'
import { MatchResult, PlayerRow, Team } from '@/lib/types'
import { inkOn, playerName, teamInfo } from '@/lib/utils'
import Pitch from '@/components/pitch/Pitch'

/** 팀별 패스 네트워크: 점 = 평균 위치(크기 = 터치), 선 = 두 선수 간 성공 패스 수 */
export default function PassNetwork({ result, players, onSelect }:
  { result: MatchResult; players: Map<string, PlayerRow>; onSelect: (p: PlayerRow) => void }) {
  const [minPasses, setMinPasses] = useState(2)
  const { length: L, width: W } = result.meta.field
  return (
    <div className="space-y-3">
      <div className="card p-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-gray-600">선을 그릴 최소 패스 수</span>
        {[1, 2, 3, 5].map(n => (
          <button key={n} onClick={() => setMinPasses(n)}
            className={`px-3 py-1 rounded-full text-xs font-medium ${minPasses === n ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {n}회+
          </button>
        ))}
        <span className="text-xs text-gray-400 w-full sm:w-auto sm:ml-auto">점 위치 = 평균 위치 · 점 크기 = 볼 터치 · 선 굵기 = 주고받은 패스</span>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        {(['home', 'away'] as Team[]).map(team => {
          const net = result.pass_network[team]
          const t = teamInfo(result.match, team)
          const edges = net.edges.filter(e => e.count >= minPasses)
          const maxC = Math.max(1, ...edges.map(e => e.count))
          const maxT = Math.max(1, ...net.nodes.map(n => n.touches))
          const pos = new Map(net.nodes.map(n => [n.id, n]))
          const top = [...net.edges].sort((a, b) => b.count - a.count).slice(0, 3)
          return (
            <div key={team} className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-3.5 h-3.5 rounded-full border border-gray-300" style={{ background: t.color }} />
                <h3 className="font-semibold text-gray-900">{t.name}</h3>
                <span className="text-xs text-gray-400 ml-auto">성공 패스 {result.team_stats[team].passes_completed}회</span>
              </div>
              {net.nodes.length === 0 ? (
                <p className="text-sm text-gray-400 py-10 text-center">성공한 패스가 없습니다</p>
              ) : (
                <Pitch length={L} width={W} className="w-full rounded-lg">
                  {edges.map(e => {
                    const a = pos.get(e.a), b = pos.get(e.b)
                    if (!a || !b) return null
                    return (
                      <line key={`${e.a}-${e.b}`} x1={a.x * L} y1={a.y * W} x2={b.x * L} y2={b.y * W}
                        stroke="#fff" strokeOpacity={0.35 + 0.6 * (e.count / maxC)} strokeWidth={0.3 + 1.6 * (e.count / maxC)}
                        strokeLinecap="round">
                        <title>{`${playerName(players.get(e.a))} ↔ ${playerName(players.get(e.b))}: ${e.count}회`}</title>
                      </line>
                    )
                  })}
                  {net.nodes.map(n => {
                    const p = players.get(n.id)
                    const r = 1.6 + 2.2 * Math.sqrt(n.touches / maxT)
                    return (
                      <g key={n.id} className="cursor-pointer" onClick={() => p && onSelect(p)}>
                        <title>{`${playerName(p)} · 터치 ${n.touches}`}</title>
                        <circle cx={n.x * L} cy={n.y * W} r={r} fill={t.color} stroke="#111827" strokeWidth={0.3} />
                        <text x={n.x * L} y={n.y * W + 0.9} textAnchor="middle" fontSize={2.4} fontWeight={700}
                          fill={inkOn(t.color)}>
                          {p?.jersey_number ?? ''}
                        </text>
                        <text x={n.x * L} y={n.y * W + r + 2.6} textAnchor="middle" fontSize={2} fill="#fff">
                          {p?.display_name ?? (p?.jersey_number != null ? '' : n.id)}
                        </text>
                      </g>
                    )
                  })}
                </Pitch>
              )}
              {top.length > 0 && (
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-semibold text-gray-500">가장 많이 주고받은 조합</p>
                  {top.map(e => (
                    <p key={`${e.a}-${e.b}`} className="text-xs text-gray-700 flex justify-between">
                      <span>{playerName(players.get(e.a))} ↔ {playerName(players.get(e.b))}</span>
                      <span className="tabular-nums text-gray-500">{e.count}회</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
