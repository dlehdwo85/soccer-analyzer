'use client'
import { useEffect, useRef, useState } from 'react'
import { Download, Film, X } from 'lucide-react'
import { fmtClock } from '@/lib/utils'
import { Clip } from './VideoDock'

const PRE = 3
const POST = 4
const W = 1280
const H = 720
const ACCENT = '#3fa35b'

interface Segment { from: number; to: number; label: string; t: number }

/** 장면 앞뒤를 붙이고, 겹치는 장면은 하나로 합친다 (영상 시각 기준) */
function segments(clips: Clip[], offset: number): Segment[] {
  const out: Segment[] = []
  for (const c of [...clips].sort((a, b) => a.t - b.t)) {
    const from = Math.max(0, c.t + offset - PRE), to = c.t + offset + POST
    const last = out[out.length - 1]
    if (last && from <= last.to) { last.to = Math.max(last.to, to); last.label += ` · ${c.label}` }
    else out.push({ from, to, label: c.label, t: c.t })
  }
  return out
}

function pickMime(): { mime: string; ext: string } {
  const cands = [
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1.42E01E', 'mp4'], ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm'],
  ]
  for (const [mime, ext] of cands) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return { mime, ext }
  return { mime: '', ext: 'webm' }
}

/**
 * 하이라이트 장면들을 이어 붙여 영상 파일로 저장한다. 서버 없이 브라우저에서 원본 영상을 재생하며
 * 캔버스에 그리고(장면 자막 포함) 녹화하므로, 하이라이트 길이만큼 시간이 걸린다.
 */
export default function ReelExporter({ src, offset = 0, clips, title, fileName, onClose }: {
  src: string; offset?: number; clips: Clip[]; title: string; fileName: string; onClose: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const stop = useRef(false)
  const [state, setState] = useState<'ready' | 'recording' | 'done' | 'error'>('ready')
  const [pct, setPct] = useState(0)
  const [msg, setMsg] = useState('')
  const [file, setFile] = useState<{ url: string; name: string; size: number } | null>(null)
  const segs = segments(clips, offset)
  const total = segs.reduce((s, g) => s + (g.to - g.from), 0)
  const { ext } = pickMime()

  useEffect(() => () => { stop.current = true; if (file) URL.revokeObjectURL(file.url) }, [file])

  const record = async () => {
    const cv = canvas.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    setState('recording'); setPct(0); stop.current = false
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.src = src
    v.playsInline = true
    v.preload = 'auto'
    try {
      await new Promise<void>((ok, bad) => { v.onloadedmetadata = () => ok(); v.onerror = () => bad(new Error('영상을 불러올 수 없습니다')) })
      const stream = cv.captureStream(30)
      // 소리도 담는다 (스피커로는 내보내지 않음)
      let audioCtx: AudioContext | null = null
      try {
        audioCtx = new AudioContext()
        const dest = audioCtx.createMediaStreamDestination()
        audioCtx.createMediaElementSource(v).connect(dest)
        dest.stream.getAudioTracks().forEach(t => stream.addTrack(t))
      } catch { /* 소리 없이 진행 */ }
      const { mime } = pickMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined)
      const chunks: Blob[] = []
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      const finished = new Promise<void>(ok => { rec.onstop = () => ok() })

      let done = 0
      let cur: Segment | null = null
      const draw = () => {
        if (!cur) return
        const vw = v.videoWidth || W, vh = v.videoHeight || H
        const s = Math.min(W / vw, H / vh)
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, W, H)
        ctx.drawImage(v, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s)
        // 아래 자막: 장면 이름과 경기 시각
        const label = `${fmtClock(Math.max(0, v.currentTime - offset))}  ${cur.label}`
        ctx.font = '600 30px Pretendard, "Noto Sans KR", sans-serif'
        const tw = Math.min(W - 80, ctx.measureText(label).width)
        ctx.fillStyle = 'rgba(0,0,0,0.6)'
        ctx.fillRect(30, H - 86, tw + 40, 54)
        ctx.fillStyle = '#fff'
        ctx.fillText(label, 50, H - 48, W - 100)
        ctx.font = '700 22px Pretendard, sans-serif'
        ctx.fillStyle = ACCENT
        ctx.fillText(title, 40, 44, W - 80)
      }
      let running = true
      const tick = () => {   // 녹화가 끝날 때까지 화면 갱신마다 한 번씩 그린다 (한 번만 시작)
        draw()
        if (running && !stop.current) requestAnimationFrame(tick)
      }

      rec.start(1000)
      requestAnimationFrame(tick)
      for (let i = 0; i < segs.length && !stop.current; i++) {
        cur = segs[i]
        setMsg(`${i + 1}/${segs.length} 장면 · ${cur.label}`)
        v.currentTime = cur.from
        await new Promise<void>(ok => { v.onseeked = () => ok() })
        if (audioCtx?.state === 'suspended') await audioCtx.resume()
        await v.play()
        const end = cur.to
        await new Promise<void>(ok => {
          const iv = setInterval(() => {
            setPct(Math.min(99, ((done + Math.max(0, v.currentTime - cur!.from)) / total) * 100))
            if (v.currentTime >= end || v.ended || stop.current) { clearInterval(iv); ok() }
          }, 100)
        })
        v.pause()
        done += cur.to - cur.from
      }
      running = false
      rec.stop()
      await finished
      audioCtx?.close()
      if (stop.current) return
      const blob = new Blob(chunks, { type: mime || 'video/webm' })
      setFile({ url: URL.createObjectURL(blob), name: `${fileName}.${ext}`, size: blob.size })
      setPct(100)
      setState('done')
    } catch (e) {
      setMsg((e as Error).message || '녹화하지 못했습니다')
      setState('error')
    } finally {
      v.removeAttribute('src')
      v.load()
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="하이라이트 영상 저장"
        className="bg-ink-900 border border-ink-700 rounded-lg p-4 w-full max-w-xl max-h-[95vh] overflow-y-auto">
        <div className="flex items-center mb-3">
          <p className="font-semibold text-ink-100 flex-1 flex items-center gap-2"><Film className="w-4 h-4 text-volt" />하이라이트 영상 저장</p>
          <button onClick={() => { stop.current = true; onClose() }} className="btn-ghost !p-1.5" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <canvas ref={canvas} width={W} height={H} className="w-full rounded-md bg-black aspect-video" aria-label="녹화 미리보기" />
        <p className="text-xs text-ink-400 mt-2">
          {segs.length}개 장면 · 약 {Math.round(total)}초. 브라우저에서 영상을 재생하며 녹화하므로 그 시간만큼 걸립니다.
          녹화 중에는 이 창을 열어 두세요{ext === 'webm' ? ' (이 브라우저는 MP4 녹화를 지원하지 않아 WebM으로 저장됩니다 — 카톡·인스타 업로드는 크롬 최신판을 권장)' : ''}.
        </p>
        {state !== 'ready' && (
          <div className="mt-3">
            <div className="h-2 rounded-full bg-ink-800 overflow-hidden">
              <div className="h-full bg-volt transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[11px] text-ink-400 mt-1 truncate">{state === 'error' ? `실패: ${msg}` : state === 'done' ? '완료' : msg}</p>
          </div>
        )}
        <div className="flex gap-2 mt-3">
          {state === 'done' && file ? (
            <a href={file.url} download={file.name} className="btn-primary flex-1">
              <Download className="w-4 h-4" />{file.name.endsWith('.mp4') ? 'MP4' : 'WebM'} 저장 ({(file.size / 1e6).toFixed(1)}MB)
            </a>
          ) : (
            <button className="btn-primary flex-1" disabled={state === 'recording' || !segs.length} onClick={record}>
              <Film className="w-4 h-4" />{state === 'recording' ? '녹화 중…' : state === 'error' ? '다시 시도' : '녹화 시작'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
