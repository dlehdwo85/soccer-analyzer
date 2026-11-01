'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle, ArrowLeft, BarChart3, CheckCircle, ChevronDown, Clock, Cpu, FileText, FlaskConical, Loader2,
  MapPin, Pencil, Play, Ruler, Trash2, Upload, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { AnalysisStatus, GpsPreview, Health, Match } from '@/lib/types'
import { cn, fmtDate, SOURCE_LABEL } from '@/lib/utils'
import StatusBadge from '@/components/ui/StatusBadge'
import MatchForm from '@/components/match/MatchForm'
import CalibrationTool from '@/components/match/CalibrationTool'

type Tab = 'video' | 'gps'

export default function MatchDetailPage() {
  const { id } = useParams<{ id: string }>()
  const matchId = Number(id)
  const router = useRouter()
  const [match, setMatch] = useState<Match | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState<Tab>('video')

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
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [load])

  useEffect(() => {
    if (match?.data_source === 'gps' && match.analysis_version) setTab('gps')
  }, [match?.data_source, match?.analysis_version])

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
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="card h-24 animate-pulse bg-gray-100" />)}
    </div>
  )
  if (!match) return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-500">
      경기를 찾을 수 없습니다. <Link href="/" className="text-green-600 underline">목록으로</Link>
    </div>
  )

  const hasResult = match.analysis_version === 2

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-start gap-3 mb-6">
        <Link href="/" className="btn-secondary !px-2.5" aria-label="목록"><ArrowLeft className="w-4 h-4" /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 truncate">{match.title}</h1>
          <p className="text-sm text-gray-500">{match.date || fmtDate(match.created_at)}</p>
        </div>
        {hasResult && match.status !== 'analyzing' && (
          <Link href={`/matches/${matchId}/results`} className="btn-primary"><BarChart3 className="w-4 h-4" />결과 보기</Link>
        )}
      </div>

      {editing ? (
        <div className="mb-4">
          <MatchForm initial={match} submitLabel="변경 저장" onCancel={() => setEditing(false)}
            onSubmit={async v => {
              try {
                setMatch(await api.updateMatch(matchId, v))
                setEditing(false)
                toast.success('저장했습니다. 다시 분석하면 반영됩니다.')
              } catch (e) {
                toast.error((e as Error).message)
              }
            }} />
        </div>
      ) : (
        <div className="card p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">경기 설정</h2>
            <div className="flex items-center gap-2">
              <StatusBadge status={match.status} />
              <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" aria-label="설정 수정">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={remove} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="경기 삭제">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {(['home', 'away'] as const).map(side => {
              const name = side === 'home' ? match.home_team_name : match.away_team_name
              const color = side === 'home' ? match.home_team_color : match.away_team_color
              const gk = side === 'home' ? match.home_gk_color : match.away_gk_color
              return (
                <div key={side} className="flex items-center gap-3 rounded-xl bg-gray-50 p-3">
                  <span className="w-8 h-8 rounded-full border-2 border-white shadow" style={{ background: color }} />
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{name}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      GK {gk ? <span className="w-3 h-3 rounded-full border border-gray-300 inline-block" style={{ background: gk }} /> : '자동'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-gray-500">
            <span>{match.field_type === 'soccer' ? '축구' : '풋살'}</span>
            <span className="flex items-center gap-1">심판
              {match.referee_color ? <span className="w-3 h-3 rounded-full border border-gray-300 inline-block" style={{ background: match.referee_color }} /> : ' 없음'}
            </span>
            <span>전반 홈 공격: {match.home_attacks === 'auto' ? '자동' : match.home_attacks === 'right' ? '→ 오른쪽' : '← 왼쪽'}</span>
            <span>경기장 보정: {match.calibrated ? '있음' : '없음'}</span>
          </div>
        </div>
      )}

      <div className="card p-1 mb-4 flex gap-1 bg-gray-100">
        {([['video', '영상 분석', Play], ['gps', 'GPS 데이터', MapPin]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn('flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all',
              tab === k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700')}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'video' ? (
        <VideoTab match={match} health={health} onMatch={setMatch} reload={load} />
      ) : (
        <GpsTab match={match} reload={load} />
      )}
    </div>
  )
}

// ── 영상 분석 ──────────────────────────────────────────────────────────────

function VideoTab({ match, health, onMatch, reload }:
  { match: Match; health: Health | null; onMatch: (m: Match) => void; reload: () => Promise<void> }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [calOpen, setCalOpen] = useState(false)
  const [partial, setPartial] = useState(false)
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
        ? { mode, start_seconds: Math.max(0, Number(startMin) || 0) * 60, max_seconds: Math.max(1, Number(lenMin) || 10) * 60 }
        : { mode }
      await api.analyze(match.id, body)
      await reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 1. 영상 */}
      <section className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-1">1. 경기 영상</h2>
        <p className="text-xs text-gray-500 mb-3">
          경기장 전체가 보이는 높은 곳에서 고정 카메라로 찍은 영상이 가장 정확합니다. 카메라가 움직이면 거리·위치 정확도가 떨어집니다.
        </p>
        {uploadPct !== null ? (
          <div className="p-5 rounded-xl bg-blue-50 border border-blue-200">
            <p className="text-sm font-medium text-blue-800 mb-2 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />업로드 중 {uploadPct}%</p>
            <div className="w-full bg-blue-100 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${uploadPct}%` }} /></div>
          </div>
        ) : match.video_url ? (
          <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
            <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-green-800">영상 준비됨</p>
              <p className="text-xs text-green-700 truncate">{match.video_filename}</p>
            </div>
            <button className="btn-secondary !py-1.5 text-xs" onClick={() => fileRef.current?.click()} disabled={analyzing}>교체</button>
          </div>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-300 hover:border-green-400 hover:bg-green-50/50 rounded-xl p-8 text-center transition-colors">
            <Upload className="w-9 h-9 text-gray-400 mx-auto mb-2" />
            <p className="font-medium text-gray-700">영상 파일 선택</p>
            <p className="text-xs text-gray-400 mt-1">MP4 · MOV · M4V · MKV · AVI {health?.r2 ? '· 대용량은 저장소로 바로 올라갑니다' : ''}</p>
          </button>
        )}
        <input ref={fileRef} type="file" accept="video/*,.mp4,.mov,.m4v,.mkv,.avi" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
      </section>

      {/* 2. 경기장 보정 */}
      <section className="card">
        <button type="button" onClick={() => setCalOpen(o => !o)} disabled={!src}
          className="w-full flex items-center gap-3 p-5 text-left disabled:opacity-60">
          <Ruler className="w-5 h-5 text-gray-500" />
          <div className="flex-1">
            <h2 className="font-semibold text-gray-900">2. 경기장 보정 <span className="text-xs font-normal text-gray-400">(선택 · 권장)</span></h2>
            <p className="text-xs text-gray-500">
              {match.calibrated ? '보정됨 — 거리·속도가 실제 미터로 계산됩니다.' : '네 점을 찍으면 거리·속도를 실제 미터로 재고, 경기장 밖 사람을 자동 제외합니다.'}
            </p>
          </div>
          {match.calibrated && <CheckCircle className="w-5 h-5 text-green-600" />}
          <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform', calOpen && 'rotate-180')} />
        </button>
        {calOpen && src && (
          <div className="px-5 pb-5"><CalibrationTool match={match} src={src} onSaved={onMatch} /></div>
        )}
      </section>

      {/* 3. 분석 */}
      <section className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-1">3. 분석</h2>
        <p className="text-xs text-gray-500 mb-4">
          유니폼 색으로 선수를 팀별로 나누고, 공의 움직임으로 볼 터치·패스 성공/실패·슈팅·가로채기를 선수별로 기록합니다.
        </p>

        {analyzing ? (
          <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
              <p className="text-sm font-medium text-blue-800 flex-1">{status?.message || '분석 중'}</p>
              <span className="text-sm font-bold text-blue-700 tabular-nums">{Math.round(status?.progress ?? match.analysis_progress)}%</span>
            </div>
            <div className="w-full bg-blue-100 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full transition-all duration-700" style={{ width: `${status?.progress ?? match.analysis_progress}%` }} />
            </div>
            <p className="text-xs text-blue-600 mt-2">이 페이지를 닫아도 분석은 계속됩니다. 끝나면 결과 화면으로 이동합니다.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {match.status === 'failed' && match.analysis_error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{match.analysis_error}</span>
              </div>
            )}
            {match.analysis_version === 2 && (
              <p className="text-xs text-gray-500">
                현재 결과: {SOURCE_LABEL[match.data_source ?? ''] ?? ''} 분석 · 다시 분석하면 선수 이름·병합 정보가 초기화됩니다.
              </p>
            )}

            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={partial} onChange={e => setPartial(e.target.checked)} />
              일부 구간만 분석 (빠른 확인용)
            </label>
            {partial && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 pl-6">
                <input className="input !w-20" inputMode="numeric" value={startMin} onChange={e => setStartMin(e.target.value)} aria-label="시작(분)" />
                분부터
                <input className="input !w-20" inputMode="numeric" value={lenMin} onChange={e => setLenMin(e.target.value)} aria-label="길이(분)" />
                분 동안
              </div>
            )}

            <button onClick={() => start('video')} disabled={starting || !match.video_url || !engineReady}
              className="w-full flex items-center gap-3 p-4 border-2 border-green-500 rounded-xl hover:bg-green-50 transition-colors text-left disabled:opacity-50 disabled:border-gray-200 disabled:hover:bg-transparent">
              <span className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center shrink-0"><Cpu className="w-5 h-5 text-green-700" /></span>
              <span className="flex-1">
                <span className="block font-semibold text-green-800">영상 분석 시작</span>
                <span className="block text-xs text-gray-500">
                  {!match.video_url ? '먼저 영상을 올려 주세요'
                    : !health ? '서버 상태 확인 중...'
                    : health.engines.runpod ? 'GPU 서버(RunPod)에서 분석 · 90분 경기 약 15~30분'
                    : health.engines.local ? '이 서버에서 분석 · CPU면 오래 걸릴 수 있습니다'
                    : '분석 엔진이 설정되지 않았습니다 (README의 RunPod 설정 참고)'}
                </span>
              </span>
            </button>
            <button onClick={() => start('sample')} disabled={starting}
              className="w-full flex items-center gap-3 p-3 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-left disabled:opacity-50">
              <span className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0"><FlaskConical className="w-5 h-5 text-gray-600" /></span>
              <span>
                <span className="block font-medium text-gray-700">샘플 분석으로 화면 미리보기</span>
                <span className="block text-xs text-gray-500">가상 경기 데이터로 결과 화면을 체험합니다 · 영상과 무관</span>
              </span>
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

// ── GPS ───────────────────────────────────────────────────────────────────

function GpsTab({ match, reload }: { match: Match; reload: () => Promise<void> }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<GpsPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)

  const pick = async (f: File) => {
    if (!['csv', 'json', 'gpx'].includes(f.name.split('.').pop()?.toLowerCase() ?? '')) {
      toast.error('CSV, JSON, GPX 파일만 지원합니다')
      return
    }
    setFile(f)
    setPreview(null)
    setBusy(true)
    try {
      setPreview(await api.gpsPreview(match.id, f))
    } catch (e) {
      toast.error(`파일을 읽지 못했습니다: ${(e as Error).message}`)
      setFile(null)
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    if (!file) return
    setBusy(true)
    try {
      const r = await api.uploadGps(match.id, file)
      toast.success(`GPS 분석 완료 · ${r.players}명`)
      await reload()
      router.push(`/matches/${match.id}/results`)
    } catch (e) {
      toast.error(`GPS 분석 실패: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-1">GPS 파일로 활동량 분석</h2>
        <p className="text-xs text-gray-500">
          GPS 조끼·스마트워치 기록(CSV · JSON · GPX)으로 이동거리, 속도 구간, 스프린트, 히트맵을 계산합니다.
          GPS에는 공 정보가 없어 패스·슈팅 기록은 영상 분석에서만 나옵니다.
        </p>
      </div>
      {!file ? (
        <div onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) pick(f) }}
          className={cn('card border-2 border-dashed p-10 text-center cursor-pointer transition-all',
            drag ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-green-400')}>
          {busy ? <Loader2 className="w-9 h-9 text-green-500 mx-auto mb-2 animate-spin" /> : <MapPin className="w-9 h-9 text-gray-400 mx-auto mb-2" />}
          <p className="font-medium text-gray-700">GPS 파일을 끌어 놓거나 눌러서 선택</p>
          <p className="text-xs text-gray-400 mt-1">CSV · JSON · GPX · 최대 50MB</p>
          <input ref={inputRef} type="file" accept=".csv,.json,.gpx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) pick(f) }} />
        </div>
      ) : (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-green-600" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-gray-900 truncate">{file.name}</p>
              <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <button onClick={() => { setFile(null); setPreview(null) }} className="text-xs text-gray-400 hover:text-red-500">파일 변경</button>
          </div>
          {preview && (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4 text-center">
                <Stat icon={<Users className="w-4 h-4" />} value={preview.total_players} label="선수" />
                <Stat icon={<MapPin className="w-4 h-4" />} value={preview.total_points.toLocaleString()} label="포인트" />
                <Stat icon={<Clock className="w-4 h-4" />} value={`${Math.floor(preview.duration_sec / 60)}분`} label="기록 시간" />
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1 mb-4">
                {preview.players.map(p => (
                  <div key={p.player_id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg text-sm">
                    <span className="w-7 h-7 rounded-full text-xs font-bold text-white flex items-center justify-center"
                      style={{ background: p.team === 'away' ? match.away_team_color : match.home_team_color }}>{p.jersey_number || '?'}</span>
                    <span className="flex-1 truncate">{p.player_name}</span>
                    <span className="text-xs text-gray-400">{p.point_count.toLocaleString()}개</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <button onClick={run} disabled={busy || !preview} className="btn-primary w-full justify-center !py-3">
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" />분석 중...</> : 'GPS 데이터로 분석'}
          </button>
        </div>
      )}
      <div className="card p-4">
        <p className="text-xs font-semibold text-gray-500 mb-2">CSV 형식 예시</p>
        <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-x-auto text-gray-600">{`timestamp_ms,player_id,player_name,jersey_number,lat,lng,speed_mps,team
0,1,김민준,10,37.5665,126.9780,0.0,home
1000,1,김민준,10,37.5666,126.9781,2.3,home
0,2,이현우,7,37.5668,126.9785,3.1,away`}</pre>
      </div>
    </div>
  )
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: React.ReactNode; label: string }) {
  return (
    <div className="p-3 bg-gray-50 rounded-xl">
      <span className="text-gray-500 flex justify-center mb-1">{icon}</span>
      <p className="text-lg font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  )
}
