'use client'
import { useEffect, useRef } from 'react'

interface Player {
  team_side: string
  avg_position_x: number
  avg_position_y: number
  track_id: string
  style_badge?: string
  role_type?: string
}

interface Props {
  homeColor: string
  awayColor: string
  homeAvgX: number
  homeAvgY: number
  awayAvgX: number
  awayAvgY: number
  players?: Player[]
}

export default function MiniFieldMap({ homeColor, awayColor, homeAvgX, homeAvgY, awayAvgX, awayAvgY, players = [] }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    const PAD = 10

    // ── 배경 ─────────────────────────────────────────
    ctx.fillStyle = '#1a4a2a'
    ctx.fillRect(0, 0, W, H)
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#1e5530' : '#1a4a2a'
      ctx.fillRect(i * W/10, 0, W/10, H)
    }

    // ── 경기장 라인 ───────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(PAD, PAD, W-PAD*2, H-PAD*2)
    ctx.beginPath(); ctx.moveTo(W/2, PAD); ctx.lineTo(W/2, H-PAD); ctx.stroke()
    ctx.beginPath(); ctx.arc(W/2, H/2, H*0.18, 0, Math.PI*2); ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.beginPath(); ctx.arc(W/2, H/2, 3, 0, Math.PI*2); ctx.fill()

    // 페널티박스
    const pbW = W*0.15, pbH = H*0.5
    ctx.strokeRect(PAD, (H-pbH)/2, pbW, pbH)
    ctx.strokeRect(W-PAD-pbW, (H-pbH)/2, pbW, pbH)
    // 골대
    const gH = H*0.2
    ctx.fillStyle = 'rgba(255,255,255,0.2)'
    ctx.fillRect(PAD-4, (H-gH)/2, 4, gH)
    ctx.fillRect(W-PAD, (H-gH)/2, 4, gH)

    const toX = (x: number) => x * (W-PAD*2) + PAD
    const toY = (y: number) => y * (H-PAD*2) + PAD

    // ── 팀 영역 그라데이션 ────────────────────────────
    if (homeAvgX > 0 && awayAvgX > 0) {
      const hr = parseInt(homeColor.slice(1,3),16)
      const hg = parseInt(homeColor.slice(3,5),16)
      const hb = parseInt(homeColor.slice(5,7),16)
      const ar = parseInt(awayColor.slice(1,3),16)
      const ag = parseInt(awayColor.slice(3,5),16)
      const ab = parseInt(awayColor.slice(5,7),16)

      const grad = ctx.createLinearGradient(PAD, 0, W-PAD, 0)
      grad.addColorStop(0, `rgba(${hr},${hg},${hb},0.08)`)
      grad.addColorStop(0.5, 'rgba(255,255,255,0.02)')
      grad.addColorStop(1, `rgba(${ar},${ag},${ab},0.08)`)
      ctx.fillStyle = grad
      ctx.fillRect(PAD, PAD, W-PAD*2, H-PAD*2)
    }

    // ── 개별 선수 위치 ────────────────────────────────
    players.forEach((p, idx) => {
      const x = toX(p.avg_position_x)
      const y = toY(p.avg_position_y)
      const color = p.team_side === 'home' ? homeColor : awayColor
      const badge = p.style_badge || String(idx+1)

      // 선수 원
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI*2); ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()

      // 배지 텍스트
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${badge.length > 2 ? '7' : '8'}px sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(badge, x, y)
    })

    // ── 팀 평균 위치 (큰 마커) ────────────────────────
    const drawTeamAvg = (x: number, y: number, color: string, label: string) => {
      const cx = toX(x), cy = toY(y)
      // 외부 링
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI*2); ctx.stroke()
      // 내부 원
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI*2); ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
      // 텍스트
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 10px sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(label, cx, cy)
    }

    if (homeAvgX > 0) drawTeamAvg(homeAvgX, homeAvgY, homeColor, '홈')
    if (awayAvgX > 0) drawTeamAvg(awayAvgX, awayAvgY, awayColor, '원')

    // ── 팀간 무게중심 연결선 ──────────────────────────
    if (homeAvgX > 0 && awayAvgX > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.lineWidth = 1
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(toX(homeAvgX), toY(homeAvgY))
      ctx.lineTo(toX(awayAvgX), toY(awayAvgY))
      ctx.stroke()
      ctx.setLineDash([])
    }

  }, [homeColor, awayColor, homeAvgX, homeAvgY, awayAvgX, awayAvgY, players])

  return (
    <canvas ref={ref} width={420} height={260} className="w-full rounded-lg"/>
  )
}
