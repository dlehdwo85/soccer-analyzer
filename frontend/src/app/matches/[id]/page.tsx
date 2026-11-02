'use client'
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle, ArrowLeft, BarChart3, CheckCircle2, ChevronDown, Cpu, FlaskConical, Loader2, Pencil, Ruler, Trash2, Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { AnalysisStatus, Health, Match } from '@/lib/types'
import { cn, fmtClock, fmtDate, inkOn, SOURCE_LABEL } from '@/lib/utils'
import StatusBadge from '@/components/ui/StatusBadge'
import MatchForm from '@/components/match/MatchForm'
import CalibrationTool from '@/components/match/CalibrationTool'

export default function MatchDetailPage() {
  const { id } = useParams<{ id: string }>()
  const matchId = Number(id)
  const router = useRouter()
  const [match, setMatch] = useState<Match | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    try {
      setMatch(await api.getMatch(matchId))
    } catch {
      setMatch(null)
    } finally {
      setLoading(false)
    }
  }, [matchId])

  useEffect(() => {
    load()
    api.waitForBackend().then(setHealth).catch(() => setHealth(null))
  }, [load])

  const remove = async () => {
    if (!match || !confirm(`'${match.title}' 경기와 분석 결과를 삭제할까요? 되돌릴 수 없습니다.`)) return
    try {
      await api.deleteMatch(matchId)
      toast.success('삭제했습니다')
      router.push('/')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (loading) return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">{[1, 2, 3].map(i => <div key={i} className="card h-28 animate-pulse" />)}</div>
  )
  if (!match) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center text-ink-400">
      경기를 찾을 수 없습니다. <Link href="/" className="text-volt underline">목록으로</Link>
    </div>
  )

  const hasResult = match.analysis_version === 2

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Link href="/" className="btn-ghost !px-2.5" aria-label="목록"><ArrowLeft className="w-4 h-4" /></Link>
        <div className="flex-1 min-w-0">
          <p className="label">{match.date || fmtDate(match.created_at)}</p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink-100 truncate">{match.title}</h1>
        </div>
        {hasResult && match.status !== 'analyzing' && (
          <Link href={`/matches/${matchId}/results`} className="btn-primary"><BarChart3 className="w-4 h-4" />기록 보기</Link>
        )}
      </div>

      {editing ? (
        <div className="mb-5">
          <MatchForm initial={match} submitLabel="변경 저장" onCancel={() => setEditing(false)}
            onSubmit={async v => {
              try {
                setMatch(await api.updateMatch(matchId, v))
                setEditing(false)
                toast.success('저장했습니다. 유니폼 색을 바꿨다면 다시 분석하세요.')
              } catch (e) {
                toast.error((e as Error).message)
              }
            }} />
        </div>
      ) : (
        <section className="card p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-ink-100">경기 설정</h2>
            <div className="flex items-center gap-1">
              <StatusBadge status={match.status} />
              <button onClick={() => setEditing(true)} className="btn-ghost !p-2" aria-label="설정 수정"><Pencil className="w-4 h-4" /></button>
              <button onClick={remove} className="btn-ghost !p-2 hover:!text-red-300" aria-label="경기 삭제"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['home', 'away'] as const).map(side => {
              const name = side === 'home' ? match.home_team_name : match.away_team_name
              const color = side === 'home' ? match.home_team_color : match.away_team_color
              const gk = side === 'home' ? match.home_gk_color : match.away_gk_color
              return (
                <div key={side} className="flex items-center gap-3 rounded-lg bg-ink-850 border border-ink-800 p-3">
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center font-semibold ring-1 ring-white/15"
                    style={{ background: color, color: inkOn(color) }}>{name.slice(0, 1)}</span>
                  <div className="min-w-0">
                    <p className="font-bold text-ink-100 truncate">{name}</p>
                    <p className="text-[11px] text-ink-400 flex items-center gap-1">
                      {side === 'home' ? '홈' : '원정'} · GK {gk ? <span className="w-2.5 h-2.5 rounded-full inline-block ring-1 ring-white/20" style={{ background: gk }} /> : '자동'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-ink-400">
            <span>{match.field_type === 'soccer' ? '축구' : '풋살'}</span>
            <span className="flex items-center gap-1">심판
              {match.referee_color ? <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: match.referee_color }} /> : ' 없음'}
            </span>
            <span>전반 홈 공격: {match.home_attacks === 'auto' ? '자동' : match.home_attacks === 'right' ? '→ 오른쪽' : '← 왼쪽'}</span>
            <span>후반 시작: {match.halftime_s != null ? fmtClock(match.halftime_s) : '미지정'}</span>
          </div>
        </section>
      )}

      <AnalysisSteps match={match} health={health} onMatch={setMatch} reload={load} />
    </div>
  )
}

function Step({ n, title, done, children, id }: { n: number; title: React.ReactNode; done?: boolean; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="card p-5 scroll-mt-20">
      <div className="flex items-center gap-3 mb-3">
        <span className={cn('w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold',
          done ? 'bg-volt text-ink-950' : 'bg-ink-800 text-ink-300')}>{done ? <CheckCircle2 className="w-4 h-4" /> : n}</span>
        <h2 className="font-bold text-ink-100">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function AnalysisSteps({ match, health, onMatch, reload }:
  { match: Match; health: Health | null; onMatch: (m: Match) => void; reload: () => Promise<void> }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [calOpen, setCalOpen] = useState(false)
  const [partial, setPartial] = useState(false)
  const [quality, setQuality] = useState<'standard' | 'max'>('standard')
  const [startMin, setStartMin] = useState('0')
  const [lenMin, setLenMin] = useState('10')
  const [status, setStatus] = useState<AnalysisStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const src = api.videoSrc(match)
  const analyzing = match.status === 'analyzing'
  const engineReady = !!health && (health.engines.runpod || health.engines.local)

  useEffect(() => {
    if (!analyzing) { setStatus(null); return }
    let alive = true
    const tick = async () => {
      try {
        const st = await api.getStatus(match.id)
        if (!alive) return
        setStatus(st)
        if (st.status === 'done') {
          toast.success('분석이 끝났습니다')
          router.push(`/matches/${match.id}/results`)
        } else if (st.status !== 'analyzing') {
          await reload()
        }
      } catch { /* 일시적 네트워크 오류는 다음 주기에 재시도 */ }
    }
    tick()
    const timer = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [analyzing, match.id, reload, router])

  const upload = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!['mp4', 'mov', 'm4v', 'mkv', 'avi'].includes(ext)) {
      toast.error('MP4, MOV, M4V, MKV, AVI 영상만 올릴 수 있습니다')
      return
    }
    setUploadPct(0)
    try {
      await api.uploadVideo(match.id, file, setUploadPct)
      toast.success('영상을 올렸습니다')
      await reload()
    } catch (e) {
      toast.error(`업로드 실패: ${(e as Error).message}`)
    } finally {
      setUploadPct(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const start = async (mode: 'video' | 'sample') => {
    setStarting(true)
    try {
      const body = partial
        ? { mode, quality, start_seconds: Math.max(0, Number(startMin) || 0) * 60, max_seconds: Math.max(1, Number(lenMin) || 10) * 60 }
        : { mode, quality }
      await api.analyze(match.id, body)
      await reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const pct = status?.progress ?? match.analysis_progress

  // 탐색기에서 영상 파일을 끌어다 놓아도 올라가게 한다 (업로드·분석 중에는 받지 않는다)
  const canDrop = uploadPct === null && !analyzing
  // 놓을 곳을 조금 빗나가도 브라우저가 영상을 열며 사이트를 떠나지 않게 한다
  useEffect(() => {
    const block = (e: globalThis.DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => { window.removeEventListener('dragover', block); window.removeEventListener('drop', block) }
  }, [])
  const onDragOver = (e: DragEvent) => {
    if (!canDrop || !Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (!canDrop) return
    const f = e.dataTransfer.files?.[0]
    if (f) upload(f)
  }

  return (
    <div className="space-y-4">
      <Step n={1} title="경기 영상" done={!!match.video_url}>
        <div onDragOver={onDragOver} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
          onDrop={onDrop}
          className={cn('rounded-lg transition-colors', dragOver && 'ring-2 ring-volt bg-volt/5')}>
        <p className="text-xs text-ink-400 mb-3">
          <b className="text-ink-200">1080p 이상</b>, 높은 곳에서 경기장을 넓게 담은 영상이 가장 정확합니다.
          480p처럼 화질이 낮거나 멀리서 찍어 공이 몇 픽셀밖에 안 되면 공을 놓쳐 볼 기록이 크게 줄어듭니다 — 이때는 &lsquo;이벤트 검수&rsquo;에서 보완하세요.
        </p>
        {uploadPct !== null ? (
          <div className="p-4 rounded-lg bg-ink-850 border border-ink-700">
            <p className="text-sm font-semibold text-ink-100 mb-2 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-volt" />업로드 중 <span className="num">{uploadPct}%</span></p>
            <div className="w-full bg-ink-800 rounded-full h-2"><div className="bg-volt h-2 rounded-full transition-all" style={{ width: `${uploadPct}%` }} /></div>
          </div>
        ) : match.video_url ? (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-volt-soft border border-volt/25">
            <CheckCircle2 className="w-5 h-5 text-volt shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-ink-100">영상 준비됨</p>
              <p className="text-xs text-ink-400 truncate">{match.video_filename}</p>
              {dragOver && <p className="text-xs text-volt font-semibold mt-0.5">놓으면 이 영상으로 교체합니다</p>}
            </div>
            <button className="btn-secondary !py-1.5 text-xs" onClick={() => fileRef.current?.click()} disabled={analyzing}>교체</button>
          </div>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()}
            className={cn('w-full border-2 border-dashed hover:border-volt/60 hover:bg-volt/5 rounded-lg p-8 text-center transition-colors',
              dragOver ? 'border-volt' : 'border-ink-700')}>
            <Upload className={cn('w-8 h-8 mx-auto mb-2', dragOver ? 'text-volt' : 'text-ink-500')} />
            <p className="font-bold text-ink-200">{dragOver ? '여기에 놓으면 올라갑니다' : '영상 파일을 끌어다 놓거나 눌러서 선택'}</p>
            <p className="text-xs text-ink-500 mt-1">MP4 · MOV · M4V · MKV · AVI {health?.r2 ? '· 대용량은 저장소로 바로 올라갑니다' : ''}</p>
          </button>
        )}
        <input ref={fileRef} type="file" accept="video/*,.mp4,.mov,.m4v,.mkv,.avi" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
        </div>
      </Step>

      <section className="card">
        <button type="button" onClick={() => setCalOpen(o => !o)} disabled={!src}
          className="w-full flex items-center gap-3 p-5 text-left disabled:opacity-50">
          <span className={cn('w-7 h-7 rounded-full flex items-center justify-center', match.calibrated ? 'bg-volt text-ink-950' : 'bg-ink-800 text-ink-300')}>
            {match.calibrated ? <CheckCircle2 className="w-4 h-4" /> : <Ruler className="w-3.5 h-3.5" />}
          </span>
          <div className="flex-1">
            <h2 className="font-bold text-ink-100">2. 경기장 지정 <span className="text-xs font-normal text-ink-500">선택 · 권장</span></h2>
            <p className="text-xs text-ink-400">
              {match.calibrated ? '지정됨 — 경기장 밖 사람을 빼고, 패스 길이·슈팅 위치를 실제 미터로 계산합니다.'
                : '네 점을 찍으면 벤치·관중을 자동으로 빼고 전진 패스·슈팅 위치(xG) 판정이 정확해집니다.'}
            </p>
          </div>
          <ChevronDown className={cn('w-4 h-4 text-ink-500 transition-transform', calOpen && 'rotate-180')} />
        </button>
        {calOpen && src && <div className="px-5 pb-5"><CalibrationTool match={match} src={src} onSaved={onMatch} /></div>}
      </section>

      <Step n={3} id="analyze" title="분석" done={match.analysis_version === 2 && match.data_source === 'video'}>
        <p className="text-xs text-ink-400 mb-4">
          유니폼 색으로 선수를 팀별로 나누고, 공의 움직임으로 볼 터치·패스 성공/실패·키패스·슈팅·가로채기를 선수별로 기록합니다.
        </p>

        {analyzing ? (
          <div className="p-4 rounded-lg bg-ink-850 border border-ink-700">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="w-4 h-4 text-volt animate-spin" />
              <p className="text-sm font-semibold text-ink-100 flex-1">{status?.message || match.analysis_message || '분석 중'}</p>
              <span className="text-sm font-semibold text-volt num">{Math.round(pct)}%</span>
            </div>
            <div className="w-full bg-ink-800 rounded-full h-2">
              <div className="bg-volt h-2 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-ink-500 mt-2">이 페이지를 닫아도 분석은 계속됩니다. 끝나면 결과 화면으로 이동합니다.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {match.status === 'failed' && match.analysis_error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-200">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{match.analysis_error}</span>
              </div>
            )}
            {match.analysis_version === 2 && (
              <p className="text-xs text-ink-400">
                현재 결과: {SOURCE_LABEL[match.data_source ?? ''] ?? ''} 분석 · 다시 분석하면 선수 이름·병합·이벤트 수정이 초기화됩니다.
              </p>
            )}
            {match.video_url && match.analysis_version !== 2 && match.status === 'done' && (
              <p className="text-xs text-sky-300">예전 버전으로 만든 결과는 실제 영상 기반이 아니었습니다. 새 엔진으로 다시 분석하세요.</p>
            )}

            <fieldset className="space-y-1.5">
              <legend className="text-sm text-ink-200 mb-1">분석 품질</legend>
              <label className="flex items-start gap-2 text-sm text-ink-200 cursor-pointer">
                <input type="radio" name="quality" className="mt-1" checked={quality === 'standard'} onChange={() => setQuality('standard')} />
                <span>표준 <span className="text-xs text-ink-500">초당 6장면. 빠르고 저렴합니다.</span></span>
              </label>
              <label className="flex items-start gap-2 text-sm text-ink-200 cursor-pointer">
                <input type="radio" name="quality" className="mt-1" checked={quality === 'max'} onChange={() => setQuality('max')} />
                <span>고정밀 (GPU) <span className="text-xs text-ink-500">초당 15장면, 대형 선수 모델, 공 4분할 검출. GPU 서버가 연결되어 있어야 하며 90분 경기 약 1~1.5시간, 약 3,000원.</span></span>
              </label>
            </fieldset>

            <label className="flex items-center gap-2 text-sm text-ink-200 cursor-pointer">
              <input type="checkbox" checked={partial} onChange={e => setPartial(e.target.checked)} />
              일부 구간만 분석 (처음 확인용으로 추천)
            </label>
            {partial && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-300 pl-6">
                <input className="input !w-20 num" inputMode="numeric" value={startMin} onChange={e => setStartMin(e.target.value)} aria-label="시작(분)" />
                분부터
                <input className="input !w-20 num" inputMode="numeric" value={lenMin} onChange={e => setLenMin(e.target.value)} aria-label="길이(분)" />
                분 동안
              </div>
            )}

            <button onClick={() => start('video')} disabled={starting || !match.video_url || !engineReady}
              className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-volt bg-volt/5 hover:bg-volt/10 transition-colors text-left disabled:opacity-40 disabled:border-ink-700 disabled:bg-transparent">
              <span className="w-10 h-10 bg-volt rounded-xl flex items-center justify-center shrink-0"><Cpu className="w-5 h-5 text-ink-950" /></span>
              <span className="flex-1">
                <span className="block font-semibold text-ink-100">영상 분석 시작</span>
                <span className="block text-xs text-ink-400">
                  {!match.video_url ? '먼저 영상을 올려 주세요'
                    : !health ? '서버 상태 확인 중...'
                    : health.engines.runpod ? 'GPU 서버에서 분석 · 90분 경기 약 15~30분'
                    : health.engines.local ? '이 서버에서 분석 · CPU라 오래 걸립니다 (10분 영상 약 5~15분)'
                    : '분석 엔진이 설정되지 않았습니다 — README의 영상 분석 설정 참고'}
                </span>
              </span>
            </button>
            <button onClick={() => start('sample')} disabled={starting}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-ink-700 hover:bg-ink-850 transition-colors text-left disabled:opacity-40">
              <span className="w-10 h-10 bg-ink-800 rounded-xl flex items-center justify-center shrink-0"><FlaskConical className="w-5 h-5 text-ink-300" /></span>
              <span>
                <span className="block font-semibold text-ink-200">샘플로 결과 화면 미리보기</span>
                <span className="block text-xs text-ink-500">가상 경기 데이터 · 올린 영상과 무관</span>
              </span>
            </button>
          </div>
        )}
      </Step>
    </div>
  )
}
