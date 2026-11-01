'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '@/lib/api'
import { PlayerProfileDetail } from '@/lib/types'
import { fmtDist, SOURCE_LABEL } from '@/lib/utils'

export default function PlayerProfilePage() {
  const { name: raw } = useParams<{ name: string }>()
  const name = decodeURIComponent(raw)
  const [prof, setProf] = useState<PlayerProfileDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getPlayerProfile(name).then(setProf).catch(e => setError((e as Error).message))
  }, [name])

  if (error) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-500">
      {error} <Link href="/players" className="text-green-600 underline">선수 목록</Link>
    </div>
  )
  if (!prof) return <div className="max-w-3xl mx-auto px-4 py-8"><div className="card h-48 animate-pulse bg-gray-100" /></div>

  const t = prof.totals
  const per90 = (v: number) => (t.minutes > 0 ? (v / t.minutes) * 90 : 0)
  const chart = [...prof.matches].reverse().map(m => ({
    label: m.date || m.title.slice(0, 8),
    distance: Math.round(m.stats.distance_m ?? 0),
    touches: m.stats.touches ?? 0,
  }))
  const tiles: [string, string, string?][] = [
    ['경기', `${prof.match_count}`, `${Math.round(t.minutes)}분`],
    ['볼 터치', `${t.touches}`, `90분당 ${per90(t.touches).toFixed(0)}`],
    ['패스 성공', `${t.passes_completed}/${t.passes_attempted}`, t.pass_accuracy !== null ? `${t.pass_accuracy.toFixed(0)}%` : undefined],
    ['슈팅 / 유효', `${t.shots} / ${t.shots_on_target}`, `xG ${t.xg.toFixed(2)}`],
    ['가로채기 / 탈취', `${t.interceptions} / ${t.recoveries}`],
    ['이동거리', fmtDist(t.distance_m), `최고 ${t.top_speed_kmh.toFixed(1)} km/h · 스프린트 ${t.sprint_count}회`],
  ]

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/players" className="btn-secondary !px-2.5" aria-label="선수 목록"><ArrowLeft className="w-4 h-4" /></Link>
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-green-700 flex items-center justify-center">
          <span className="text-white font-bold text-lg">{prof.jersey_number ?? prof.name.slice(0, 1)}</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{prof.name}</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {tiles.map(([l, v, s]) => (
          <div key={l} className="card p-3">
            <p className="text-xs text-gray-500">{l}</p>
            <p className="text-xl font-bold text-gray-900 tabular-nums">{v}</p>
            {s && <p className="text-[11px] text-gray-400">{s}</p>}
          </div>
        ))}
      </div>

      {chart.length > 1 && (
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-3">경기별 이동거리</h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ left: -16, right: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
                <Tooltip formatter={v => [`${v} m`, '이동거리']} />
                <Bar dataKey="distance" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left font-medium px-4 py-2">경기</th>
              <th className="text-right font-medium px-2 py-2">터치</th>
              <th className="text-right font-medium px-2 py-2">패스</th>
              <th className="text-right font-medium px-2 py-2">슈팅</th>
              <th className="text-right font-medium px-2 py-2">거리</th>
              <th className="text-right font-medium px-4 py-2">최고속도</th>
            </tr>
          </thead>
          <tbody>
            {prof.matches.map(m => (
              <tr key={`${m.match_id}-${m.track_id}`} className="border-t border-gray-100">
                <td className="px-4 py-2">
                  <Link href={`/matches/${m.match_id}/results`} className="font-medium text-gray-900 hover:text-green-700">{m.title}</Link>
                  <p className="text-[11px] text-gray-400">{m.date} · {m.team_name} · {SOURCE_LABEL[m.data_source ?? ''] ?? ''}</p>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{m.stats.touches ?? 0}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {m.stats.passes_completed ?? 0}/{m.stats.passes_attempted ?? 0}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{m.stats.shots ?? 0}/{m.stats.shots_on_target ?? 0}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtDist(m.stats.distance_m ?? 0)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{(m.stats.top_speed_kmh ?? 0).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
