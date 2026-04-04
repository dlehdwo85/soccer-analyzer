'use client'
import { useEffect, useRef } from 'react'

interface ZoneData { [zone: string]: number }

interface Props {
  homeZone: ZoneData
  awayZone: ZoneData
  homeColor: string
  awayColor: string
  homeName: string
  awayName: string
}

const ZONE_LABELS = [
  ['좌측 수비', '중앙 수비', '우측 수비'],
  ['좌측 미드', '중앙 미드', '우측 미드'],
  ['좌측 공격', '중앙 공격', '우측 공격'],
]

export default function ZoneMap({ homeZone, awayZone, homeColor, awayColor, homeName, awayName }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    const PAD = 8
    const cellW = (W - PAD*2) / 3
    const cellH = (H - PAD*2 - 40) / 3

    // 배경
    ctx.fillStyle = '#1a4a2a'
    ctx.fillRect(0, 0, W, H)

    // 헤더
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.fillRect(0, 0, W, 36)

    // 팀 범례
    ctx.font = 'bold 11px sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = homeColor
    ctx.fillRect(PAD, 12, 12, 12)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'left'
    ctx.fillText(homeName, PAD+16, 18)

    ctx.fillStyle = awayColor
    ctx.fillRect(W/2+PAD, 12, 12, 12)
    ctx.fillStyle = '#fff'
    ctx.fillText(awayName, W/2+PAD+16, 18)

    // 공격/수비 방향 화살표
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.font = '9px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('← 수비', PAD + cellW*0.5, H-6)
    ctx.fillText('공격 →', PAD + cellW*2.5, H-6)

    // 9구역 그리기
    ZONE_LABELS.forEach((row, ri) => {
      row.forEach((zone, ci) => {
        const x = PAD + ci * cellW
        const y = 36 + PAD + ri * cellH

        const hPct = homeZone[zone] ?? 0
        const aPct = awayZone[zone] ?? 0
        const total = hPct + aPct || 1

        // 우세 팀 배경색
        const dominance = hPct / total
        const hr = parseInt(homeColor.slice(1,3),16)
        const hg = parseInt(homeColor.slice(3,5),16)
        const hb = parseInt(homeColor.slice(5,7),16)
        const ar = parseInt(awayColor.slice(1,3),16)
        const ag = parseInt(awayColor.slice(3,5),16)
        const ab = parseInt(awayColor.slice(5,7),16)

        const mr = Math.round(hr*dominance + ar*(1-dominance))
        const mg = Math.round(hg*dominance + ag*(1-dominance))
        const mb = Math.round(hb*dominance + ab*(1-dominance))

        const intensity = Math.abs(dominance - 0.5) * 2  // 0=균등, 1=완전 지배
        ctx.fillStyle = `rgba(${mr},${mg},${mb},${0.15 + intensity*0.5})`
        ctx.fillRect(x+1, y+1, cellW-2, cellH-2)

        // 셀 테두리
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'
        ctx.lineWidth = 1
        ctx.strokeRect(x, y, cellW, cellH)

        // 구역 이름
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.font = '8px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(zone.replace(' ', '\n'), x + cellW/2, y+4)

        // 홈/어웨이 점유율 바
        const barY = y + cellH - 16
        const barW = cellW - 16
        const barX = x + 8

        ctx.fillStyle = 'rgba(0,0,0,0.4)'
        ctx.fillRect(barX, barY, barW, 8)

        const homeBarW = (hPct / total) * barW
        ctx.fillStyle = homeColor
        ctx.fillRect(barX, barY, homeBarW, 8)
        ctx.fillStyle = awayColor
        ctx.fillRect(barX + homeBarW, barY, barW - homeBarW, 8)

        // 수치
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 8px sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillText(`${hPct.toFixed(0)}%`, barX, barY-1)
        ctx.textAlign = 'right'
        ctx.fillText(`${aPct.toFixed(0)}%`, barX+barW, barY-1)

        // 우세 표시
        if (intensity > 0.3) {
          ctx.fillStyle = dominance > 0.5 ? homeColor : awayColor
          ctx.font = 'bold 9px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(dominance > 0.5 ? '▲' : '▼', x + cellW/2, y + cellH/2 - 4)
        }
      })
    })

  }, [homeZone, awayZone, homeColor, awayColor, homeName, awayName])

  return (
    <div>
      <canvas ref={ref} width={420} height={300} className="w-full rounded-lg"/>
      <p className="text-[10px] text-gray-400 text-center mt-1">
        ▲ 홈팀 우세 · ▼ 원정팀 우세 · 색상 진할수록 점유율 높음
      </p>
    </div>
  )
}
