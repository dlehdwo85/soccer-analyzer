'use client'
import { useEffect, useRef, useState } from 'react'
import { Crosshair, RotateCcw, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { CalibrationInput, Match } from '@/lib/types'
import { fmtClock } from '@/lib/utils'

type Preset = CalibrationInput['preset']

const PRESETS: { key: Preset; label: string; steps: string[] }[] = [
  { key: 'full', label: '경기장 전체', steps: ['먼 쪽 왼쪽 코너', '먼 쪽 오른쪽 코너', '가까운 쪽 오른쪽 코너', '가까운 쪽 왼쪽 코너'] },
  { key: 'left_half', label: '왼쪽 절반', steps: ['먼 쪽 왼쪽 코너', '먼 쪽 하프라인 끝', '가까운 쪽 하프라인 끝', '가까운 쪽 왼쪽 코너'] },
  { key: 'right_half', label: '오른쪽 절반', steps: ['먼 쪽 하프라인 끝', '먼 쪽 오른쪽 코너', '가까운 쪽 오른쪽 코너', '가까운 쪽 하프라인 끝'] },
]

const DIMS = { soccer: [105, 68], futsal: [40, 20] } as const

/**
 * 고정 카메라 영상에서 경기장 네 점을 찍어 화면 좌표 → 실제 경기장(m) 변환을 만든다.
 * 보정하면 경기장 밖 사람(벤치·관중)이 자동 제외되고, 패스 길이·전진 패스·슈팅 위치(xG)가 실제 미터 기준으로 정확해진다.
 */
export default function CalibrationTool({ match, src, onSaved }: { match: Match; src: string; onSaved: (m: Match) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [preset, setPreset] = useState<Preset>('full')
  const [points, setPoints] = useState<[number, number][]>([])
  const [dur, setDur] = useState(0)
  const [time, setTime] = useState(0)
  const [aspect, setAspect] = useState(16 / 9)
  const [dims, setDims] = useState<[string, string]>(DIMS[match.field_type].map(String) as [string, string])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!match.calibrated) return
    api.getCalibration(match.id).then(c => {
      if (!c) return
      if (c.preset !== 'full' && c.preset !== 'left_half' && c.preset !== 'right_half') return
      setPreset(c.preset)
      setPoints(c.image_points)
      setDims([String(c.length), String(c.width)])
    }).catch(() => { /* 보정 정보를 못 읽어도 새로 찍을 수 있다 */ })
  }, [match.id, match.calibrated])

  const steps = PRESETS.find(p => p.key === preset)!.steps
  const click = (e: React.MouseEvent<HTMLDivElement>) => {
    if (points.length >= 4) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
    setPoints(p => [...p, [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]])
  }

  const save = async () => {
    setSaving(true)
    try {
      const length = Number(dims[0]) || undefined, width = Number(dims[1]) || undefined
      const m = await api.setCalibration(match.id, { preset, image_points: points, length, width })
      toast.success('경기장 보정을 저장했습니다. 다음 분석부터 적용됩니다.')
      onSaved(m)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    try {
      onSaved(await api.clearCalibration(match.id))
      setPoints([])
      toast.success('보정을 삭제했습니다')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(p => (
          <button key={p.key} type="button" onClick={() => { setPreset(p.key); setPoints([]) }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${preset === p.key ? 'bg-volt text-ink-950' : 'bg-ink-800 text-ink-300'}`}>
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-400">
        영상에서 네 점이 모두 보이는 장면으로 이동한 뒤 순서대로 누르세요. 카메라가 고정된 영상일 때 정확합니다.
      </p>

      {error ? (
        <p className="text-sm text-red-300 bg-red-500/10 rounded-lg p-3">영상을 불러올 수 없어 보정할 수 없습니다.</p>
      ) : (
        <div className="relative w-full bg-black rounded-lg overflow-hidden select-none" style={{ aspectRatio: aspect }}>
          <video ref={video} src={src} preload="metadata" muted playsInline className="absolute inset-0 w-full h-full"
            onLoadedMetadata={e => {
              const v = e.currentTarget
              setDur(v.duration || 0)
              if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight)
              v.currentTime = Math.min(5, (v.duration || 0) / 2)
            }}
            onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
            onError={() => setError(true)} />
          <div className="absolute inset-0 cursor-crosshair" onClick={click}>
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="w-full h-full">
              {points.length >= 2 && (
                <polygon points={points.map(p => p.join(',')).join(' ')} fill="rgba(200,240,49,.18)"
                  stroke="#c8f031" strokeWidth={0.004} vectorEffect="non-scaling-stroke" />
              )}
            </svg>
            {points.map((p, i) => (
              <span key={i} className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-volt border-2 border-ink-950 text-ink-950 text-xs font-bold flex items-center justify-center shadow"
                style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}>{i + 1}</span>
            ))}
          </div>
          {points.length < 4 && (
            <div className="absolute top-2 left-2 right-2 flex justify-center pointer-events-none">
              <span className="bg-black/70 text-white text-xs rounded-full px-3 py-1 flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5" />{points.length + 1}. {steps[points.length]}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs tabular-nums text-ink-400 w-12">{fmtClock(time)}</span>
        <input type="range" min={0} max={dur || 0} step={0.5} value={time} className="flex-1 accent-[#c8f031]"
          onChange={e => { const t = Number(e.target.value); setTime(t); if (video.current) video.current.currentTime = t }}
          aria-label="영상 위치" />
        <span className="text-xs tabular-nums text-ink-500 w-12 text-right">{fmtClock(dur)}</span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label block mb-1">경기장 길이(m)</label>
          <input className="input !w-24" inputMode="decimal" value={dims[0]} onChange={e => setDims([e.target.value, dims[1]])} />
        </div>
        <div>
          <label className="label block mb-1">폭(m)</label>
          <input className="input !w-24" inputMode="decimal" value={dims[1]} onChange={e => setDims([dims[0], e.target.value])} />
        </div>
        <p className="text-[11px] text-ink-500 flex-1 min-w-[160px]">실제 구장 크기를 알면 입력하세요. 동네 구장은 규격보다 작은 경우가 많습니다.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => setPoints([])} disabled={!points.length}>
          <RotateCcw className="w-4 h-4" />다시 찍기
        </button>
        <button type="button" className="btn-primary" onClick={save} disabled={points.length !== 4 || saving}>
          <Save className="w-4 h-4" />{saving ? '저장 중...' : '보정 저장'}
        </button>
        {match.calibrated && (
          <button type="button" className="btn-secondary ml-auto text-red-300" onClick={clear}>
            <Trash2 className="w-4 h-4" />보정 삭제
          </button>
        )}
      </div>
    </div>
  )
}
