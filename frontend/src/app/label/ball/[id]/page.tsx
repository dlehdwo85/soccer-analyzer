'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, EyeOff } from 'lucide-react'
import { api } from '@/lib/api'
import { BallLabel, BallLabelSetData } from '@/lib/types'
import { cn } from '@/lib/utils'

const LOUPE = 220      // 돋보기 크기(px)
const ZOOM = 4         // 돋보기 배율

/**
 * 공 위치 표시 — 공 모델 추가 학습용.
 * 마우스를 올리면 돋보기, 공을 누르면 저장되고 다음 장면으로 넘어간다. ←/→로 앞뒤 장면(연속 4장면 묶음)을 넘겨 보면
 * 움직이는 공을 찾기 쉽다.
 */
export default function BallLabelPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<BallLabelSetData | null>(null)
  const [labels, setLabels] = useState<Record<string, BallLabel>>({})
  const [i, setI] = useState(0)
  const [hover, setHover] = useState<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const loupeRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    api.ballLabelSet(id).then(d => {
      setData(d)
      setLabels(d.labels)
      const first = d.frames.findIndex(f => !d.labels[f.name])
      setI(first < 0 ? 0 : first)
    }).catch(e => toast.error((e as Error).message))
  }, [id])

  const frames = data?.frames ?? []
  const frame = frames[i]
  const done = useMemo(() => frames.filter(f => labels[f.name]).length, [frames, labels])
  const go = useCallback((d: number) => setI(k => Math.max(0, Math.min(frames.length - 1, k + d))), [frames.length])

  // 다음 몇 장면을 미리 받아 둔다
  useEffect(() => {
    if (!data) return
    for (let k = i + 1; k <= i + 4 && k < frames.length; k++) new Image().src = data.base + frames[k].name + '.jpg'
  }, [data, frames, i])

  const save = useCallback(async (lbl: BallLabel) => {
    if (!frame) return
    setLabels(l => ({ ...l, [frame.name]: lbl }))
    go(1)
    try {
      await api.putBallLabel(id, frame.name, lbl)
    } catch (e) {
      toast.error((e as Error).message)
      setLabels(l => { const n = { ...l }; delete n[frame.name]; return n })
    }
  }, [frame, go, id])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'n' || e.key === 'N' || e.key === ' ') { e.preventDefault(); save({ visible: false }) }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [go, save])

  const toNative = (e: React.MouseEvent) => {
    const img = imgRef.current!
    const r = img.getBoundingClientRect()
    return { x: (e.clientX - r.left) * img.naturalWidth / r.width, y: (e.clientY - r.top) * img.naturalHeight / r.height,
      cx: e.clientX - r.left, cy: e.clientY - r.top }
  }

  // 돋보기
  useEffect(() => {
    const cv = loupeRef.current, img = imgRef.current
    if (!cv || !img || !hover) return
    const ctx = cv.getContext('2d')!
    const src = LOUPE / ZOOM
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, LOUPE, LOUPE)
    ctx.drawImage(img, hover.x - src / 2, hover.y - src / 2, src, src, 0, 0, LOUPE, LOUPE)
    ctx.strokeStyle = '#ff3b30'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(LOUPE / 2 - 14, LOUPE / 2); ctx.lineTo(LOUPE / 2 - 5, LOUPE / 2)
    ctx.moveTo(LOUPE / 2 + 5, LOUPE / 2); ctx.lineTo(LOUPE / 2 + 14, LOUPE / 2)
    ctx.moveTo(LOUPE / 2, LOUPE / 2 - 14); ctx.lineTo(LOUPE / 2, LOUPE / 2 - 5)
    ctx.moveTo(LOUPE / 2, LOUPE / 2 + 5); ctx.lineTo(LOUPE / 2, LOUPE / 2 + 14)
    ctx.stroke()
  }, [hover])

  if (!data) return <p className="max-w-3xl mx-auto px-4 py-16 text-center text-ink-400">불러오는 중…</p>
  const lbl = frame ? labels[frame.name] : undefined
  const sameBurst = frames.filter(f => f.burst === frame?.burst)
  const posInBurst = sameBurst.findIndex(f => f.name === frame?.name)

  return (
    <div className="max-w-[1500px] mx-auto px-4 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-ink-100">공 위치 표시</h1>
        <span className="text-sm text-ink-400 num">{done} / {frames.length} 장면 완료</span>
        <div className="h-1.5 flex-1 min-w-[120px] bg-ink-800 rounded-full overflow-hidden">
          <div className="h-full bg-volt" style={{ width: `${(done / Math.max(1, frames.length)) * 100}%` }} />
        </div>
      </div>
      <p className="text-xs text-ink-400">
        화면에서 <b className="text-ink-200">경기 중인 공</b>을 눌러 주세요. 마우스를 올리면 확대됩니다.
        ← → 키로 앞뒤 장면을 넘겨 보면 움직이는 공을 찾기 쉽습니다. 공이 안 보이면(가려짐·화면 밖) <b className="text-ink-200">스페이스</b> 또는 아래 버튼.
        라인 밖에 놓인 여분 공은 누르지 마세요.
      </p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button className="btn-secondary !py-1.5" onClick={() => go(-1)} disabled={i === 0}><ChevronLeft className="w-4 h-4" />이전</button>
        <span className="text-ink-300 num">{i + 1}번 장면 · 묶음 안 {posInBurst + 1}/{sameBurst.length}</span>
        <button className="btn-secondary !py-1.5" onClick={() => go(1)} disabled={i >= frames.length - 1}>다음<ChevronRight className="w-4 h-4" /></button>
        <button className="btn-secondary !py-1.5 ml-auto" onClick={() => save({ visible: false })}><EyeOff className="w-4 h-4" />공 안 보임</button>
        {lbl && (
          <span className={cn('text-xs px-2 py-1 rounded', lbl.visible ? 'bg-emerald-900/50 text-emerald-300' : 'bg-ink-800 text-ink-300')}>
            {lbl.visible ? '표시함' : '공 안 보임으로 표시함'}
          </span>
        )}
      </div>

      {frame && (
        <div className="flex justify-center"><div className="relative select-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} src={data.base + frame.name + '.jpg'} alt={`장면 ${i + 1}`} draggable={false}
            className="block max-w-full max-h-[calc(100vh-190px)] w-auto h-auto rounded cursor-crosshair"
            onMouseMove={e => setHover(toNative(e))} onMouseLeave={() => setHover(null)}
            onClick={e => { const p = toNative(e); save({ visible: true, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }) }} />
          {lbl?.visible && lbl.x != null && lbl.y != null && (
            <span className="pointer-events-none absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-2 border-[#ff3b30]"
              style={{ left: `${(lbl.x / frame.w) * 100}%`, top: `${(lbl.y / frame.h) * 100}%` }} />
          )}
          {hover && (
            <canvas ref={loupeRef} width={LOUPE} height={LOUPE}
              className="pointer-events-none absolute rounded-full border-2 border-white/70 shadow-xl"
              style={{ left: hover.cx + 24, top: hover.cy - LOUPE - 12 < 0 ? hover.cy + 24 : hover.cy - LOUPE - 12 }} />
          )}
        </div></div>
      )}
    </div>
  )
}
