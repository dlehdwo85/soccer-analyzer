'use client'
import { useEffect, useRef } from 'react'
import { CentroidPoint } from '@/lib/types'

interface Props {
  homeData: CentroidPoint[]
  awayData: CentroidPoint[]
  homeColor: string
  awayColor: string
}

export default function CentroidTimeline({ homeData, awayData, homeColor, awayColor }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height

    // 경기장 배경
    ctx.fillStyle = '#166534'
    ctx.fillRect(0, 0, W, H)
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#15803d' : '#166534'
      ctx.fillRect(i * W / 8, 0, W / 8, H)
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = 1
    ctx.strokeRect(4, 4, W - 8, H - 8)
    ctx.beginPath(); ctx.moveTo(W / 2, 4); ctx.lineTo(W / 2, H - 4); ctx.stroke()

    const px = (x: number) => x * (W - 8) + 4
    const py = (y: number) => y * (H - 8) + 4

    const drawPath = (data: CentroidPoint[], color: string) => {
      if (data.length < 2) return
      // 경로 그리기 (투명도로 시간 순서 표현)
      for (let i = 1; i < data.length; i++) {
        const alpha = 0.2 + (i / data.length) * 0.8
        ctx.strokeStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0')
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(px(data[i-1].x), py(data[i-1].y))
        ctx.lineTo(px(data[i].x), py(data[i].y))
        ctx.stroke()
      }
      // 현재 위치 (마지막 점)
      const last = data[data.length - 1]
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(px(last.x), py(last.y), 7, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
    }

    drawPath(homeData, homeColor)
    drawPath(awayData, awayColor)

  }, [homeData, awayData, homeColor, awayColor])

  return (
    <div>
      <canvas ref={ref} width={360} height={200} className="w-full rounded-lg" />
      <p className="text-[10px] text-gray-400 text-center mt-1">밝을수록 최근 위치 · 경기 흐름 방향 표시</p>
    </div>
  )
}
