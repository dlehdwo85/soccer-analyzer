'use client'
import { useEffect, useRef } from 'react'
import { FramePoint } from '@/lib/types'

interface Props {
  frames: FramePoint[]
  color: string
  width?: number
  height?: number
}

export default function HeatmapCanvas({ frames, color, width = 320, height = 200 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || frames.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height

    ctx.fillStyle = '#1a3a2a'
    ctx.fillRect(0, 0, W, H)

    // 경기장 라인
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = 1
    ctx.strokeRect(6, 6, W - 12, H - 12)
    ctx.beginPath(); ctx.moveTo(W / 2, 6); ctx.lineTo(W / 2, H - 6); ctx.stroke()
    ctx.beginPath(); ctx.arc(W / 2, H / 2, H * 0.18, 0, Math.PI * 2); ctx.stroke()

    // 히트맵 셀 (16x10 그리드)
    const COLS = 16, ROWS = 10
    const grid: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0))

    frames.forEach(f => {
      const col = Math.min(Math.floor(f.x * COLS), COLS - 1)
      const row = Math.min(Math.floor(f.y * ROWS), ROWS - 1)
      if (col >= 0 && row >= 0) grid[row][col]++
    })

    const maxVal = Math.max(...grid.flat(), 1)
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)

    grid.forEach((row, ri) => {
      row.forEach((val, ci) => {
        if (val === 0) return
        const intensity = val / maxVal
        const cellX = (ci / COLS) * (W - 12) + 6
        const cellY = (ri / ROWS) * (H - 12) + 6
        const cellW = (W - 12) / COLS + 1
        const cellH = (H - 12) / ROWS + 1
        ctx.fillStyle = `rgba(${r},${g},${b},${intensity * 0.75})`
        ctx.fillRect(cellX, cellY, cellW, cellH)
      })
    })

    // 평균 위치 점
    const avgX = frames.reduce((s, f) => s + f.x, 0) / frames.length
    const avgY = frames.reduce((s, f) => s + f.y, 0) / frames.length
    const px = avgX * (W - 12) + 6
    const py = avgY * (H - 12) + 6
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke()
  }, [frames, color])

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className="w-full rounded-lg"
    />
  )
}
