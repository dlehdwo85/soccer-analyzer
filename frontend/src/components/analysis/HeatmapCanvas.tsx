'use client'
import { useEffect, useRef } from 'react'
import { FramePoint } from '@/lib/types'

interface Props {
  frames: FramePoint[]
  color: string
  width?: number
  height?: number
  playerName?: string
}

export default function HeatmapCanvas({ frames, color, width = 420, height = 260, playerName }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || frames.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    const PAD = 10

    // ── 배경 ──────────────────────────────────────────
    ctx.fillStyle = '#1a4a2a'
    ctx.fillRect(0, 0, W, H)
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#1e5530' : '#1a4a2a'
      ctx.fillRect(i * W / 12, 0, W / 12, H)
    }

    // ── 경기장 라인 ───────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(PAD, PAD, W-PAD*2, H-PAD*2)
    ctx.beginPath(); ctx.moveTo(W/2, PAD); ctx.lineTo(W/2, H-PAD); ctx.stroke()
    ctx.beginPath(); ctx.arc(W/2, H/2, H*0.18, 0, Math.PI*2); ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.beginPath(); ctx.arc(W/2, H/2, 3, 0, Math.PI*2); ctx.fill()
    // 페널티박스
    const pbW = W*0.15, pbH = H*0.5
    ctx.strokeRect(PAD, (H-pbH)/2, pbW, pbH)
    ctx.strokeRect(W-PAD-pbW, (H-pbH)/2, pbW, pbH)
    // 골대
    const gW = W*0.02, gH = H*0.2
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.fillRect(PAD-gW, (H-gH)/2, gW, gH)
    ctx.fillRect(W-PAD, (H-gH)/2, gW, gH)

    const toX = (x: number) => x * (W - PAD*2) + PAD
    const toY = (y: number) => y * (H - PAD*2) + PAD

    // ── 히트맵 그리드 (고해상도 24x16) ───────────────
    const COLS = 24, ROWS = 16
    const grid: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0))

    frames.forEach(f => {
      const col = Math.min(Math.floor(f.x * COLS), COLS-1)
      const row = Math.min(Math.floor(f.y * ROWS), ROWS-1)
      if (col >= 0 && row >= 0) {
        // 가우시안 퍼짐 (주변 셀도 영향)
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const nr = row+dr, nc = col+dc
            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
              const dist = Math.sqrt(dr*dr + dc*dc)
              grid[nr][nc] += Math.exp(-dist * 0.8)
            }
          }
        }
      }
    })

    const maxVal = Math.max(...grid.flat(), 1)
    const r = parseInt(color.slice(1,3), 16)
    const g = parseInt(color.slice(3,5), 16)
    const b = parseInt(color.slice(5,7), 16)

    // 히트맵 렌더링 (낮은 강도는 파랑→높은 강도는 팀 컬러)
    grid.forEach((row, ri) => {
      row.forEach((val, ci) => {
        if (val < 0.1) return
        const intensity = val / maxVal
        const cellX = (ci / COLS) * (W - PAD*2) + PAD
        const cellY = (ri / ROWS) * (H - PAD*2) + PAD
        const cellW = (W - PAD*2) / COLS + 0.5
        const cellH = (H - PAD*2) / ROWS + 0.5

        // 강도별 색상 변화 (파랑 → 팀컬러 → 흰색)
        let fr: number, fg: number, fb: number, alpha: number
        if (intensity < 0.4) {
          // 낮은 구역: 파란색 계열
          fr = 50; fg = 100; fb = 200
          alpha = intensity * 0.5
        } else if (intensity < 0.7) {
          // 중간 구역: 팀 컬러
          fr = r; fg = g; fb = b
          alpha = intensity * 0.7
        } else {
          // 핫존: 팀 컬러 + 흰색 혼합
          const mix = (intensity - 0.7) / 0.3
          fr = Math.round(r + (255-r)*mix)
          fg = Math.round(g + (255-g)*mix)
          fb = Math.round(b + (255-b)*mix)
          alpha = 0.85
        }
        ctx.fillStyle = `rgba(${fr},${fg},${fb},${alpha})`
        ctx.fillRect(cellX, cellY, cellW, cellH)
      })
    })

    // ── 이동 궤적 (시간 순서대로 희미→진하게) ─────────
    if (frames.length > 1) {
      const sample = frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length/80)) === 0)
      for (let i = 1; i < sample.length; i++) {
        const alpha = 0.1 + (i / sample.length) * 0.4
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(toX(sample[i-1].x), toY(sample[i-1].y))
        ctx.lineTo(toX(sample[i].x), toY(sample[i].y))
        ctx.stroke()
      }
    }

    // ── 핫존 테두리 강조 ─────────────────────────────
    let hotRow = 0, hotCol = 0, hotVal = 0
    grid.forEach((row, ri) => row.forEach((val, ci) => {
      if (val > hotVal) { hotVal = val; hotRow = ri; hotCol = ci }
    }))
    if (hotVal > 0) {
      const hx = (hotCol / COLS) * (W-PAD*2) + PAD
      const hy = (hotRow / ROWS) * (H-PAD*2) + PAD
      const hw = (W-PAD*2) / COLS * 2.5
      const hh = (H-PAD*2) / ROWS * 2.5
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.setLineDash([3, 3])
      ctx.strokeRect(hx - hw/4, hy - hh/4, hw, hh)
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.font = 'bold 9px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('HOT', hx + hw/2, hy - 3)
    }

    // ── 평균 위치 마커 ────────────────────────────────
    const avgX = frames.reduce((s,f)=>s+f.x, 0) / frames.length
    const avgY = frames.reduce((s,f)=>s+f.y, 0) / frames.length
    const mx = toX(avgX), my = toY(avgY)

    // 십자선
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(mx, PAD); ctx.lineTo(mx, H-PAD); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(PAD, my); ctx.lineTo(W-PAD, my); ctx.stroke()
    ctx.setLineDash([])

    // 평균 위치 원
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(mx, my, 7, 0, Math.PI*2); ctx.fill()
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke()
    ctx.fillStyle = color
    ctx.font = 'bold 8px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('★', mx, my)

    // ── 구역별 점유율 텍스트 ──────────────────────────
    const leftPct = Math.round(frames.filter(f=>f.x<0.33).length / frames.length * 100)
    const ctrPct = Math.round(frames.filter(f=>f.x>=0.33&&f.x<0.67).length / frames.length * 100)
    const rightPct = Math.round(frames.filter(f=>f.x>=0.67).length / frames.length * 100)

    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(PAD, H-PAD-18, W-PAD*2, 18)
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.font = '9px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(`좌 ${leftPct}%`, W*0.17, H-PAD-9)
    ctx.fillText(`중앙 ${ctrPct}%`, W*0.50, H-PAD-9)
    ctx.fillText(`우 ${rightPct}%`, W*0.83, H-PAD-9)

  }, [frames, color])

  return (
    <div className="relative">
      <canvas ref={ref} width={width} height={height} className="w-full rounded-lg"/>
      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 justify-center">
        <span className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{background:'rgba(50,100,200,0.6)'}}/>낮은 활동
        </span>
        <span className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{background: color}}/>중간 활동
        </span>
        <span className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-white"/>핫존
        </span>
        <span className="flex items-center gap-1">
          <span>★</span>평균 위치
        </span>
      </div>
    </div>
  )
}
