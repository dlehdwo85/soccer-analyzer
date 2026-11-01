'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '@/lib/api'
import { PlayerProfileDetail } from '@/lib/types'
import { SOURCE_LABEL } from '@/lib/utils'

export default function PlayerProfilePage() {
  const { name: raw } = useParams<{ name: string }>()
  const name = decodeURIComponent(raw)
  const [prof, setProf] = useState<PlayerProfileDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getPlayerProfile(name).then(setProf).catch(e => setError((e as Error).message))
  }, [name])

  if (error) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center text-ink-400">
      {error} <Link href="/players" className="text-volt underline">선수 목록</Link>
    </div>
  )
  if (!prof) return <div className="max-w-3xl mx-auto px-4 py-8"><div className="card h-48 animate-pulse" /></div>

  const t = prof.totals
  const per90 = (v: number) => (t.minutes > 0 ? (v / t.minutes) * 90 : 0)
  const chart = [...prof.matches].reverse().map(m => ({
    label: m.date || m.title.slice(0, 8),
    touches: m.stats.touches ?? 0,
    passes: m.stats.passes_completed ?? 0,
  }))
  const tiles: [string, string, string?][] = [
    ['경기', `${prof.match_count}`, `${Math.round(t.minutes)}분`],
    ['볼 터치', `${t.touches}`, `90분당 ${per90(t.touches).toFixed(0)}`],
    ['패스', `${t.passes_completed}/${t.passes_attempted}`, t.pass_accuracy !== null ? `성공률 ${t.pass_accuracy.toFixed(0)}%` : undefined],
    ['키패스 · 전진 패스', `${t.key_passes} · ${t.forward_passes}`],
    ['슈팅 · 유효', `${t.shots} · ${t.shots_on_target}`, `xG ${t.xg.toFixed(2)}`],
    ['가로채기 · 탈취', `${t.interceptions} · ${t.recoveries}`, `볼 뺏김 ${t.dispossessed}`],
  ]

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/players" className="btn-ghost !px-2.5" aria-label="선수 목록"><ArrowLeft className="w-4 h-4" /></Link>
        <div className="w-14 h-14 rounded-2xl bg-volt flex items-center justify-center">
          <span className="text-ink-950 font-black text-xl">{prof.jersey_number ?? prof.name.slice(0, 1)}</span>
        </div>
        <div>
          <p className="label">선수 누적 기록</p>
          <h1 className="text-2xl font-black text-ink-100">{prof.name}</h1>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {tiles.map(([l, v, s]) => (
          <div key={l} className="card p-4">
            <p className="text-xs text-ink-400">{l}</p>
            <p className="text-2xl font-black text-ink-100 num">{v}</p>
            {s && <p className="text-[11px] text-ink-500">{s}</p>}
          </div>
        ))}
      </div>

      {chart.length > 1 && (
        <div className="card p-5">
          <h2 className="font-bold text-ink-100 mb-3">경기별 볼 터치 · 패스 성공</h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ left: -16, right: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#18223a" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#66749a' }} stroke="#243052" />
                <YAxis tick={{ fontSize: 11, fill: '#66749a' }} stroke="#243052" />
                <Tooltip contentStyle={{ background: '#0d1321', border: '1px solid #243052', borderRadius: 12, color: '#eef2fa' }}
                  cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                <Bar dataKey="touches" name="볼 터치" fill="#c8f031" radius={[4, 4, 0, 0]} />
                <Bar dataKey="passes" name="패스 성공" fill="#38bdf8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] text-ink-400">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5">경기</th>
              <th className="text-right font-semibold px-2 py-2.5">터치</th>
              <th className="text-right font-semibold px-2 py-2.5">패스</th>
              <th className="text-right font-semibold px-2 py-2.5">키패스</th>
              <th className="text-right font-semibold px-2 py-2.5">슈팅</th>
              <th className="text-right font-semibold px-4 py-2.5">수비</th>
            </tr>
          </thead>
          <tbody>
            {prof.matches.map(m => (
              <tr key={`${m.match_id}-${m.track_id}`} className="border-t border-ink-800">
                <td className="px-4 py-2.5">
                  <Link href={`/matches/${m.match_id}/results`} className="font-semibold text-ink-100 hover:text-volt">{m.title}</Link>
                  <p className="text-[11px] text-ink-500">{m.date} · {m.team_name} · {SOURCE_LABEL[m.data_source ?? ''] ?? ''}</p>
                </td>
                <td className="px-2 py-2.5 text-right num text-ink-200">{m.stats.touches ?? 0}</td>
                <td className="px-2 py-2.5 text-right num text-ink-200">{m.stats.passes_completed ?? 0}/{m.stats.passes_attempted ?? 0}</td>
                <td className="px-2 py-2.5 text-right num text-ink-200">{m.stats.key_passes ?? 0}</td>
                <td className="px-2 py-2.5 text-right num text-ink-200">{m.stats.shots ?? 0}/{m.stats.shots_on_target ?? 0}</td>
                <td className="px-4 py-2.5 text-right num text-ink-200">{(m.stats.interceptions ?? 0) + (m.stats.recoveries ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
