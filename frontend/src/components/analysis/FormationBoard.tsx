'use client'
import { useEffect, useRef } from 'react'

interface Props {
  homeFormation: string
  awayFormation: string
  homeColor: string
  awayColor: string
  homeName: string
  awayName: string
}

export default function FormationBoard({ homeFormation, awayFormation, homeColor, awayColor, homeName, awayName }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height

    ctx.fillStyle = '#166534'
    ctx.fillRect(0, 0, W, H)
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#15803d' : '#166534'
      ctx.fillRect(i * W / 8, 0, W / 8, H)
    }

    // 라인
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(8, 8, W - 16, H - 16)
    ctx.beginPath(); ctx.moveTo(W / 2, 8); ctx.lineTo(W / 2, H - 8); ctx.stroke()
    ctx.beginPath(); ctx.arc(W / 2, H / 2, H * 0.18, 0, Math.PI * 2); ctx.stroke()

    // 포메이션 파싱 → 선수 위치 계산
    const parseFormation = (formation: string) => {
      return formation.split('-').map(Number).filter(n => !isNaN(n))
    }

    const drawTeam = (formation: string, color: string, side: 'home' | 'away') => {
      const lines = parseFormation(formation)
      const isHome = side === 'home'

      // GK
      const gkX = isHome ? W * 0.92 : W * 0.08
      const gkY = H / 2
      drawDot(ctx, gkX, gkY, color, '1')

      // 필드 선수
      let playerNum = 2
      lines.forEach((count, lineIdx) => {
        const totalLines = lines.length
        const lineX = isHome
          ? W * 0.85 - ((lineIdx + 1) / (totalLines + 1)) * W * 0.7
          : W * 0.15 + ((lineIdx + 1) / (totalLines + 1)) * W * 0.7
        for (let i = 0; i < count; i++) {
          const lineY = H * 0.15 + (i + 1) * (H * 0.7) / (count + 1)
          drawDot(ctx, lineX, lineY, color, String(playerNum))
          playerNum++
        }
      })
    }

    drawTeam(homeFormation, homeColor, 'home')
    drawTeam(awayFormation, awayColor, 'away')

    // 팀 이름
    ctx.font = 'bold 11px sans-serif'
    ctx.fillStyle = homeColor
    ctx.textAlign = 'right'
    ctx.fillText(`${homeName} (${homeFormation})`, W - 12, H - 8)
    ctx.fillStyle = awayColor
    ctx.textAlign = 'left'
    ctx.fillText(`${awayName} (${awayFormation})`, 12, H - 8)
  }, [homeFormation, awayFormation, homeColor, awayColor, homeName, awayName])

  return <canvas ref={ref} width={360} height={220} className="w-full rounded-lg" />
}

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, label: string) {
  ctx.fillStyle = color
  ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 8px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x, y)
}
