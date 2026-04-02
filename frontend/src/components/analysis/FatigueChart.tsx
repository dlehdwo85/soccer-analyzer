'use client'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import { FatiguePoint } from '@/lib/types'

interface Props {
  homeData: FatiguePoint[]
  awayData: FatiguePoint[]
  homeColor: string
  awayColor: string
  homeName: string
  awayName: string
}

export default function FatigueChart({ homeData, awayData, homeColor, awayColor, homeName, awayName }: Props) {
  // 시간축 병합
  const timeSet = new Set([...homeData.map(d => d.time), ...awayData.map(d => d.time)])
  const times = Array.from(timeSet).sort((a, b) => a - b)

  const chartData = times.map(t => {
    const h = homeData.find(d => d.time === t)
    const a = awayData.find(d => d.time === t)
    return {
      time: `${Math.round(t / 60)}분`,
      [homeName]: h?.fatigue ?? null,
      [awayName]: a?.fatigue ?? null,
    }
  })

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
        <XAxis dataKey="time" tick={{ fontSize: 10 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
        <Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8 }}
          formatter={(v: number) => [`${v.toFixed(1)}%`, '피로도']}
        />
        <ReferenceLine y={30} stroke="#ef4444" strokeDasharray="3 3" label={{ value: '피로 경고', fontSize: 9, fill: '#ef4444' }} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey={homeName} stroke={homeColor} strokeWidth={2} dot={false} connectNulls />
        <Line type="monotone" dataKey={awayName} stroke={awayColor} strokeWidth={2} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  )
}
