'use client'
import { useEffect, useRef } from 'react'

interface Props {
  homeColor: string
  awayColor: string
  homeAvgX: number
  homeAvgY: number
  awayAvgX: number
  awayAvgY: number
  players?: Array<{ team_side: string; avg_position_x: number; avg_position_y: number; track_id: string }>
}

export default function MiniFieldMap({ homeColor, awayColor, homeAvgX, homeAvgY, awayAvgX, awayAvgY, players = [] }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height

    // 잔디 배경
    ctx.fillStyle = '#166534'
    ctx.fillRect(0, 0, W, H)

    // 줄무늬
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#15803d' : '#166534'
      ctx.fillRect(i * W / 8, 0, W / 8, H)
    }

    // 경기장 라인
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(8, 8, W - 16, H - 16)
    ctx.beginPath(); ctx.moveTo(W / 2, 8); ctx.lineTo(W / 2, H - 8); ctx.stroke()
    ctx.beginPath(); ctx.arc(W / 2, H / 2, H * 0.18, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(W / 2, H / 2, 3, 0, Math.PI * 2); ctx.fill()

    // 페널티 박스
    const pb = { w: W * 0.14, h: H * 0.48 }
    ctx.strokeRect(8, (H - pb.h) / 2, pb.w, pb.h)
    ctx.strokeRect(W - 8 - pb.w, (H - pb.h) / 2, pb.w, pb.h)

    // 개별 선수 점
    players.forEach(p => {
      const x = p.avg_position_x * (W - 16) + 8
      const y = p.avg_position_y * (H - 16) + 8
      const color = p.team_side === 'home' ? homeColor : awayColor
      ctx.fillStyle = color + 'aa'
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill()
    })

    // 팀 평균 위치 (큰 점)
    const drawAvg = (x: number, y: number, color: string, label: string) => {
      const cx = x * (W - 16) + 8
      const cy = y * (H - 16) + 8
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
      ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(label, cx, cy)
    }
    drawAvg(homeAvgX, homeAvgY, homeColor, '홈')
    drawAvg(awayAvgX, awayAvgY, awayColor, '원')
  }, [homeColor, awayColor, homeAvgX, homeAvgY, awayAvgX, awayAvgY, players])

  return (
    <canvas
      ref={ref}
      width={320}
      height={200}
      className="w-full rounded-lg"
    />
  )
}
