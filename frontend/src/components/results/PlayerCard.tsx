'use client'
import { useEffect, useRef, useState } from 'react'
import { Download, Share2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { MatchResult, PlayerRow } from '@/lib/types'
import { fmtDateShort, playerName, teamInfo } from '@/lib/utils'

const W = 1080
const H = 1920
const ACCENT = '#3fa35b'

/** 인스타 스토리·카톡에 올릴 선수 카드 (1080×1920 PNG) — 브라우저에서 바로 그린다 */
export default function PlayerCard({ matchId, result, player, rating, onClose }: {
  matchId: number; result: MatchResult; player: PlayerRow; rating: number | null; onClose: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const name = playerName(player)
  const fileName = `${name.replace(/[\\/:*?"<>|.\s]+/g, '_')}_선수카드.png`

  useEffect(() => {
    let cancelled = false
    const draw = async () => {
      const c = canvas.current
      if (!c) return
      const thumb = player.has_thumbnail ? await loadImage(`${api.thumbnailUrl(matchId, player.track_id)}?card=1`) : null
      if (cancelled) return
      drawCard(c, result, player, name, rating, thumb)
      c.toBlob(b => { if (!cancelled) setBlob(b) }, 'image/png')
    }
    draw()
    return () => { cancelled = true }
  }, [matchId, result, player, name, rating])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const download = () => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const file = blob ? new File([blob], fileName, { type: 'image/png' }) : null
  const canShareFile = !!file && typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [file] })
  const share = async () => {
    if (!file) return
    try {
      await navigator.share({ files: [file], title: `${name} 선수 카드` })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('공유하지 못했습니다. 저장한 뒤 올려 주세요')
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${name} 선수 카드`} onClick={e => e.stopPropagation()}
        className="bg-ink-900 border border-ink-700 rounded-lg p-4 w-full max-w-sm max-h-[95vh] overflow-y-auto">
        <div className="flex items-center mb-3">
          <p className="font-semibold text-ink-100 flex-1">선수 카드</p>
          <button onClick={onClose} className="btn-ghost !p-1.5" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <canvas ref={canvas} width={W} height={H} className="w-full rounded-md bg-black" aria-label="선수 카드 미리보기" />
        <p className="text-[11px] text-ink-500 mt-2">인스타 스토리 크기(1080×1920)입니다. 저장해서 단톡방·SNS에 올리세요.</p>
        <div className="flex gap-2 mt-3">
          <button type="button" className="btn-primary flex-1" disabled={!blob} onClick={download}>
            <Download className="w-4 h-4" />이미지 저장
          </button>
          {canShareFile && (
            <button type="button" className="btn-secondary flex-1" onClick={share}>
              <Share2 className="w-4 h-4" />바로 공유
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight: number, font: string) {
  let s = size
  do {
    ctx.font = `${weight} ${s}px ${font}`
    if (ctx.measureText(text).width <= maxW) break
    s -= 4
  } while (s > 24)
  return s
}

function drawCard(c: HTMLCanvasElement, result: MatchResult, player: PlayerRow, name: string,
                  rating: number | null, thumb: HTMLImageElement | null) {
  const ctx = c.getContext('2d')
  if (!ctx) return
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif'
  const team = teamInfo(result.match, player.team)
  const s = player.stats

  // 배경 — 어두운 바탕에 팀 색을 위쪽에 은은하게
  ctx.fillStyle = '#0b0f0d'
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 380, 40, W / 2, 380, 900)
  glow.addColorStop(0, hexA(team.color, 0.55))
  glow.addColorStop(1, hexA(team.color, 0))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
  // 경기장 선 장식
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 4
  ctx.beginPath(); ctx.arc(W / 2, H - 260, 220, Math.PI, 0); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, H - 260); ctx.lineTo(W, H - 260); ctx.stroke()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // 머리말
  ctx.fillStyle = ACCENT
  ctx.font = `700 34px ${font}`
  ctx.fillText('풋볼 애널라이저 · 경기 기록', W / 2, 130)
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  fitText(ctx, result.match.title, W - 160, 38, 500, font)
  ctx.fillText(result.match.title, W / 2, 190)
  const date = fmtDateShort(result.match.date) || fmtDateShort(result.match.created_at)
  if (date) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.font = `500 30px ${font}`
    ctx.fillText(date, W / 2, 238)
  }

  // 선수 사진(또는 등번호) — 팀 색 테두리
  const AV = 360, ax = (W - AV) / 2, ay = 300
  ctx.save()
  roundRect(ctx, ax, ay, AV, AV, 56)
  ctx.clip()
  if (thumb) {
    const r = Math.max(AV / thumb.width, AV / thumb.height)
    const tw = thumb.width * r, th = thumb.height * r
    ctx.fillStyle = '#1b2220'
    ctx.fillRect(ax, ay, AV, AV)
    ctx.drawImage(thumb, ax + (AV - tw) / 2, ay, tw, th)
  } else {
    ctx.fillStyle = team.color
    ctx.fillRect(ax, ay, AV, AV)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.font = `800 170px ${font}`
    ctx.textBaseline = 'middle'
    ctx.fillText(player.jersey_number != null ? String(player.jersey_number) : player.label.endsWith('_gk') ? 'GK' : '⚽', W / 2, ay + AV / 2 + 6)
    ctx.textBaseline = 'alphabetic'
  }
  ctx.restore()
  roundRect(ctx, ax, ay, AV, AV, 56)
  ctx.strokeStyle = team.color
  ctx.lineWidth = 10
  ctx.stroke()

  // 이름 · 팀
  ctx.fillStyle = '#ffffff'
  fitText(ctx, name, W - 140, 96, 800, font)
  ctx.fillText(name, W / 2, 790)
  ctx.font = `600 40px ${font}`
  const teamText = `${team.name}${player.label.endsWith('_gk') ? ' · 골키퍼' : ''}`
  const tw = ctx.measureText(teamText).width
  ctx.fillStyle = team.color
  roundRect(ctx, W / 2 - tw / 2 - 52, 828, 32, 32, 8); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.fillText(teamText, W / 2 + 22, 858)

  // AI 평점
  let y = 960
  if (rating != null) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.font = `600 34px ${font}`
    ctx.fillText('AI 평점', W / 2, y)
    ctx.fillStyle = ACCENT
    ctx.font = `800 170px ${font}`
    ctx.fillText(String(rating), W / 2 - 40, y + 170)
    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.font = `700 56px ${font}`
    ctx.textAlign = 'left'
    ctx.fillText('/10', W / 2 + (rating >= 10 ? 60 : 20), y + 170)
    ctx.textAlign = 'center'
    y += 230
  } else {
    y += 20
  }

  // 핵심 기록 2×3
  const stats: [string, string][] = [
    ['볼 터치', String(s.touches)],
    ['패스 성공률', s.pass_accuracy != null ? `${s.pass_accuracy.toFixed(0)}%` : '–'],
    ['키패스', String(s.key_passes)],
    ['슈팅 · 유효', `${s.shots} · ${s.shots_on_target}`],
    ['가로채기', String(s.interceptions)],
    ['볼 탈취', String(s.recoveries)],
  ]
  const gx = 90, gw = (W - gx * 2 - 30) / 2, gh = 170
  stats.forEach(([label, value], i) => {
    const x = gx + (i % 2) * (gw + 30), yy = y + Math.floor(i / 2) * (gh + 26)
    roundRect(ctx, x, yy, gw, gh, 24)
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.font = `600 32px ${font}`
    ctx.fillText(label, x + gw / 2, yy + 58)
    ctx.fillStyle = '#ffffff'
    ctx.font = `800 72px ${font}`
    ctx.fillText(value, x + gw / 2, yy + 136)
  })

  // 꼬리말
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.font = `500 30px ${font}`
  ctx.fillText(`출전 ${s.minutes_tracked.toFixed(0)}분 · 영상 AI 자동 분석 기록`, W / 2, H - 150)
  ctx.fillStyle = ACCENT
  ctx.font = `700 34px ${font}`
  ctx.fillText(window.location.host, W / 2, H - 92)
}

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}
