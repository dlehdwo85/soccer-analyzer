'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Upload, Play, FlaskConical, CheckCircle, Loader2,
  MapPin, FileText, Eye, Zap, Clock, Users,
} from 'lucide-react'
import { Match, GpsPreview } from '@/lib/types'
import { api } from '@/lib/api'
import StatusBadge from '@/components/ui/StatusBadge'
import PageHeader from '@/components/layout/PageHeader'
import { fmtDate } from '@/lib/utils'
import { toast } from 'sonner'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

type AnalysisTab = 'video' | 'gps'

export default function MatchDetailPage() {
  const { id } = useParams<{ id: string }>()
  const matchId = Number(id)
  const router = useRouter()

  const [match, setMatch] = useState<Match | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<AnalysisTab>('video')

  // 영상 업로드 상태
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [analyzing, setAnalyzing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // GPS 상태
  const [gpsFile, setGpsFile] = useState<File | null>(null)
  const [gpsPreview, setGpsPreview] = useState<GpsPreview | null>(null)
  const [gpsPreviewing, setGpsPreviewing] = useState(false)
  const [gpsUploading, setGpsUploading] = useState(false)
  const gpsDragRef = useRef<HTMLDivElement>(null)
  const gpsFileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const m = await api.getMatch(matchId)
      setMatch(m)
    } catch {
      toast.error('경기 정보를 불러올 수 없습니다')
    } finally {
      setLoading(false)
    }
  }, [matchId])

  useEffect(() => { load() }, [load])

  // 분석 중 폴링
  useEffect(() => {
    if (match?.status !== 'analyzing') return
    const timer = setInterval(async () => {
      try {
        const m = await api.getMatch(matchId)
        setMatch(m)
        if (m.status === 'done') {
          clearInterval(timer)
          toast.success('분석 완료!')
          router.push(`/matches/${matchId}/results`)
        } else if (m.status === 'failed') {
          clearInterval(timer)
          toast.error('분석 실패')
        }
      } catch { clearInterval(timer) }
    }, 3000)
    return () => clearInterval(timer)
  }, [match?.status, matchId, router])

  // ── 영상 업로드 ────────────────────────────────────────────────
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['mp4', 'mov'].includes(ext ?? '')) {
      toast.error('MP4, MOV 파일만 지원합니다')
      return
    }

    setUploading(true)
    setUploadProgress(0)

    try {
      toast.info('업로드 준비 중...')
      const res = await fetch(
        `${BASE}/api/matches/${matchId}/upload-url?filename=${encodeURIComponent(file.name)}`
      )
      if (!res.ok) throw new Error('업로드 URL 발급 실패')
      const { upload_url, public_url } = await res.json()

      toast.info(`업로드 중... (${(file.size / 1024 / 1024).toFixed(0)}MB)`)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100))
        })
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`업로드 실패: ${xhr.status}`))
        })
        xhr.addEventListener('error', () => reject(new Error('네트워크 오류')))
        xhr.open('PUT', upload_url)
        xhr.setRequestHeader('Content-Type', 'video/mp4')
        xhr.send(file)
      })

      await fetch(`${BASE}/api/matches/${matchId}/set-video-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_url: public_url, filename: file.name }),
      })

      toast.success('영상 업로드 완료!')
      await load()
    } catch (err: any) {
      toast.error('업로드 실패: ' + (err.message ?? '다시 시도해주세요'))
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const handleAnalyze = async (useSample: boolean) => {
    setAnalyzing(true)
    try {
      const res = await api.analyze(matchId, useSample)
      toast.success(
        !useSample && (res as any).runpod_enabled
          ? 'GPU 분석 서버 시작 중... (약 10~20분)'
          : '샘플 분석 시작!'
      )
      await load()
    } catch (err: any) {
      toast.error(err.message ?? '분석 시작 실패')
    } finally {
      setAnalyzing(false)
    }
  }

  // ── GPS 파일 처리 ──────────────────────────────────────────────
  const handleGpsFileSelect = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['csv', 'json', 'gpx'].includes(ext ?? '')) {
      toast.error('CSV, JSON, GPX 파일만 지원합니다')
      return
    }
    setGpsFile(file)
    setGpsPreview(null)
    setGpsPreviewing(true)
    try {
      const preview = await api.gpsPreview(matchId, file)
      setGpsPreview(preview)
    } catch (err: any) {
      toast.error('파일 파싱 실패: ' + (err.message ?? '형식을 확인해주세요'))
      setGpsFile(null)
    } finally {
      setGpsPreviewing(false)
    }
  }

  const handleGpsInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleGpsFileSelect(file)
  }

  const handleGpsDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    gpsDragRef.current?.classList.remove('border-green-400', 'bg-green-50')
    const file = e.dataTransfer.files?.[0]
    if (file) handleGpsFileSelect(file)
  }

  const handleGpsDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    gpsDragRef.current?.classList.add('border-green-400', 'bg-green-50')
  }

  const handleGpsDragLeave = () => {
    gpsDragRef.current?.classList.remove('border-green-400', 'bg-green-50')
  }

  const handleGpsAnalyze = async () => {
    if (!gpsFile) return
    setGpsUploading(true)
    try {
      const result = await api.uploadGps(matchId, gpsFile)
      toast.success(`GPS 분석 완료! ${result.total_players}명 · ${(result.total_points).toLocaleString()}포인트`)
      await load()
      router.push(`/matches/${matchId}/results`)
    } catch (err: any) {
      toast.error('GPS 분석 실패: ' + (err.message ?? '다시 시도해주세요'))
    } finally {
      setGpsUploading(false)
    }
  }

  // ── 렌더링 ────────────────────────────────────────────────────
  if (loading) return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {[1,2,3].map(i => <div key={i} className="card h-24 animate-pulse bg-gray-100 mb-4"/>)}
    </div>
  )

  if (!match) return (
    <div className="max-w-3xl mx-auto px-4 py-8 text-center text-gray-500">
      경기를 찾을 수 없습니다. <Link href="/" className="text-green-600 underline">목록으로</Link>
    </div>
  )

  const isDone      = match.status === 'done'
  const isAnalyzing = match.status === 'analyzing'

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <PageHeader
        title={match.title}
        subtitle={fmtDate(match.created_at)}
        actions={
          <div className="flex gap-2">
            <Link href="/" className="btn-secondary"><ArrowLeft className="w-4 h-4"/>목록</Link>
            {isDone && (
              <Link href={`/matches/${matchId}/results`} className="btn-primary">
                <CheckCircle className="w-4 h-4"/>결과 보기
              </Link>
            )}
          </div>
        }
      />

      {/* 경기 정보 */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">경기 정보</h2>
          <StatusBadge status={match.status}/>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div><p className="text-gray-400 text-xs mb-1">종목</p>
            <p className="font-medium">{match.field_type === 'soccer' ? '⚽ 축구' : '🏟 풋살'}</p></div>
          <div><p className="text-gray-400 text-xs mb-1">날짜</p>
            <p className="font-medium">{match.date}</p></div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full border" style={{background: match.home_team_color}}/>
            <span className="font-medium text-sm">{match.home_team_name}</span>
          </div>
          <span className="text-gray-400 font-bold text-xs">VS</span>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full border" style={{background: match.away_team_color}}/>
            <span className="font-medium text-sm">{match.away_team_name}</span>
          </div>
        </div>
      </div>

      {/* 분석 방식 탭 */}
      <div className="card p-1 mb-4 flex gap-1 bg-gray-100">
        <button
          onClick={() => setTab('video')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all
            ${tab === 'video' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Play className="w-4 h-4"/>영상 분석
        </button>
        <button
          onClick={() => setTab('gps')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all
            ${tab === 'gps' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <MapPin className="w-4 h-4"/>GPS 데이터
          <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">NEW</span>
        </button>
      </div>

      {/* ── 영상 분석 탭 ── */}
      {tab === 'video' && (
        <>
          {/* 영상 업로드 */}
          <div className="card p-5 mb-4">
            <h2 className="font-semibold text-gray-900 mb-1">영상 업로드</h2>
            <p className="text-xs text-gray-500 mb-3">
              MP4, MOV 지원 · <span className="text-green-600 font-medium">파일 크기 제한 없음</span> (Cloudflare R2 직접 업로드)
            </p>

            {match.video_filename ? (
              <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
                <CheckCircle className="w-5 h-5 text-green-600 shrink-0"/>
                <div>
                  <p className="text-sm font-medium text-green-800">업로드 완료</p>
                  <p className="text-xs text-green-600">{match.video_filename}</p>
                </div>
              </div>
            ) : (
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors
                  ${uploading ? 'border-blue-300 bg-blue-50 cursor-wait' : 'border-gray-300 hover:border-green-400 cursor-pointer'}`}
                onClick={() => !uploading && fileRef.current?.click()}
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-10 h-10 text-blue-500 mx-auto mb-3 animate-spin"/>
                    <p className="font-medium text-blue-700 mb-2">업로드 중...</p>
                    {uploadProgress > 0 && (
                      <>
                        <div className="w-full bg-blue-100 rounded-full h-2 mb-2">
                          <div className="bg-blue-500 h-2 rounded-full transition-all" style={{width: `${uploadProgress}%`}}/>
                        </div>
                        <p className="text-sm font-bold text-blue-700">{uploadProgress}%</p>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3"/>
                    <p className="font-medium text-gray-700 mb-1">영상 파일을 클릭해서 선택</p>
                    <p className="text-xs text-gray-400">MP4, MOV · 1GB 이상도 가능</p>
                  </>
                )}
                <input ref={fileRef} type="file" accept=".mp4,.mov" className="hidden" onChange={handleUpload} disabled={uploading}/>
              </div>
            )}
          </div>

          {/* 분석 시작 */}
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900 mb-1">분석 시작</h2>
            <p className="text-xs text-gray-500 mb-4">영상 없이도 샘플 데이터로 즉시 분석 결과를 확인할 수 있습니다.</p>

            {isAnalyzing ? (
              <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0"/>
                <div>
                  <p className="font-medium text-blue-800 text-sm">분석 진행 중...</p>
                  <p className="text-xs text-blue-600">GPU 서버 분석 중 · 완료 시 자동 이동</p>
                </div>
              </div>
            ) : isDone ? (
              <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                <CheckCircle className="w-5 h-5 text-green-600 shrink-0"/>
                <div className="flex-1">
                  <p className="font-medium text-green-800 text-sm">분석 완료!</p>
                </div>
                <Link href={`/matches/${matchId}/results`} className="btn-primary text-xs">결과 보기</Link>
              </div>
            ) : (
              <div className="space-y-3">
                <button onClick={() => handleAnalyze(true)} disabled={analyzing}
                  className="w-full flex items-center gap-3 p-4 border-2 border-green-500 rounded-xl hover:bg-green-50 transition-colors text-left disabled:opacity-50">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center shrink-0">
                    <FlaskConical className="w-5 h-5 text-green-600"/>
                  </div>
                  <div>
                    <p className="font-semibold text-green-700">샘플 경기 데이터로 분석</p>
                    <p className="text-xs text-gray-500">영상 없이 즉시 실행 · 약 5초</p>
                  </div>
                  <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">추천</span>
                </button>

                <button onClick={() => handleAnalyze(false)} disabled={analyzing || !match.video_filename}
                  className="w-full flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors text-left disabled:opacity-50">
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                    <Play className="w-5 h-5 text-gray-600"/>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-700">실제 영상으로 GPU 분석</p>
                    <p className="text-xs text-gray-500">
                      {match.video_filename ? 'YOLO AI 선수 감지 · 약 10~20분' : '먼저 영상을 업로드해주세요'}
                    </p>
                  </div>
                  {match.video_filename && (
                    <span className="ml-auto text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full shrink-0">GPU</span>
                  )}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── GPS 데이터 탭 ── */}
      {tab === 'gps' && (
        <div className="space-y-4">
          {/* 지원 포맷 안내 */}
          <div className="card p-4">
            <h2 className="font-semibold text-gray-900 mb-2">GPS 파일 업로드</h2>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { label: 'CSV', desc: '커스텀 트래킹', color: 'blue' },
                { label: 'JSON', desc: '앱 데이터', color: 'purple' },
                { label: 'GPX', desc: '가민·폴라·수토', color: 'orange' },
              ].map(({ label, desc, color }) => (
                <div key={label} className={`text-center p-2 rounded-lg bg-${color}-50 border border-${color}-100`}>
                  <p className={`font-bold text-${color}-700 text-sm`}>{label}</p>
                  <p className="text-xs text-gray-500">{desc}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400">
              CSV 필수 컬럼: <code className="bg-gray-100 px-1 rounded">timestamp_ms, player_id, lat, lng, team</code>
            </p>
          </div>

          {/* 드래그앤드롭 영역 */}
          {!gpsFile ? (
            <div
              ref={gpsDragRef}
              onDrop={handleGpsDrop}
              onDragOver={handleGpsDragOver}
              onDragLeave={handleGpsDragLeave}
              onClick={() => gpsFileRef.current?.click()}
              className="card border-2 border-dashed border-gray-300 p-10 text-center cursor-pointer hover:border-green-400 hover:bg-green-50 transition-all"
            >
              {gpsPreviewing ? (
                <>
                  <Loader2 className="w-10 h-10 text-green-500 mx-auto mb-3 animate-spin"/>
                  <p className="font-medium text-green-700">파일 분석 중...</p>
                </>
              ) : (
                <>
                  <MapPin className="w-10 h-10 text-gray-400 mx-auto mb-3"/>
                  <p className="font-medium text-gray-700 mb-1">GPS 파일을 드래그하거나 클릭해서 선택</p>
                  <p className="text-xs text-gray-400">CSV · JSON · GPX · 최대 50MB</p>
                </>
              )}
              <input
                ref={gpsFileRef}
                type="file"
                accept=".csv,.json,.gpx"
                className="hidden"
                onChange={handleGpsInputChange}
              />
            </div>
          ) : (
            <>
              {/* 파일 미리보기 */}
              {gpsPreview && (
                <div className="card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-green-600"/>
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{gpsFile.name}</p>
                        <p className="text-xs text-gray-500">{(gpsFile.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setGpsFile(null); setGpsPreview(null) }}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                    >
                      파일 변경
                    </button>
                  </div>

                  {/* 통계 요약 */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="text-center p-3 bg-blue-50 rounded-xl">
                      <Users className="w-4 h-4 text-blue-600 mx-auto mb-1"/>
                      <p className="text-lg font-bold text-blue-700">{gpsPreview.total_players}</p>
                      <p className="text-xs text-gray-500">선수</p>
                    </div>
                    <div className="text-center p-3 bg-green-50 rounded-xl">
                      <Zap className="w-4 h-4 text-green-600 mx-auto mb-1"/>
                      <p className="text-lg font-bold text-green-700">{gpsPreview.total_points.toLocaleString()}</p>
                      <p className="text-xs text-gray-500">포인트</p>
                    </div>
                    <div className="text-center p-3 bg-orange-50 rounded-xl">
                      <Clock className="w-4 h-4 text-orange-600 mx-auto mb-1"/>
                      <p className="text-lg font-bold text-orange-700">
                        {Math.floor(gpsPreview.duration_sec / 60)}분
                      </p>
                      <p className="text-xs text-gray-500">경기시간</p>
                    </div>
                  </div>

                  {/* 선수 목록 */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">선수 목록</p>
                    <div className="max-h-48 overflow-y-auto space-y-1.5">
                      {gpsPreview.players.map((p) => (
                        <div key={p.player_id} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0
                            ${p.team === 'home' ? 'bg-blue-500' : 'bg-red-500'}`}>
                            {p.jersey_number || '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{p.player_name}</p>
                            <p className="text-xs text-gray-400">
                              {p.team === 'home' ? '홈팀' : '원정팀'} · {p.point_count.toLocaleString()}포인트
                            </p>
                          </div>
                          <span className="text-xs text-gray-400">{Math.floor(p.time_range_sec / 60)}분</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 분석 실행 버튼 */}
              {isDone ? (
                <div className="card p-4 flex items-center gap-3 bg-green-50 border border-green-200">
                  <CheckCircle className="w-5 h-5 text-green-600 shrink-0"/>
                  <div className="flex-1">
                    <p className="font-medium text-green-800 text-sm">분석 완료!</p>
                    <p className="text-xs text-green-600">데이터 소스: {match.data_source?.toUpperCase()}</p>
                  </div>
                  <Link href={`/matches/${matchId}/results`} className="btn-primary text-xs">결과 보기</Link>
                </div>
              ) : (
                <button
                  onClick={handleGpsAnalyze}
                  disabled={gpsUploading || !gpsPreview}
                  className="w-full flex items-center justify-center gap-3 p-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold transition-colors disabled:opacity-50"
                >
                  {gpsUploading ? (
                    <><Loader2 className="w-5 h-5 animate-spin"/>GPS 분석 중...</>
                  ) : (
                    <><Eye className="w-5 h-5"/>GPS 데이터로 분석 시작</>
                  )}
                </button>
              )}
            </>
          )}

          {/* CSV 포맷 예시 */}
          <div className="card p-4">
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">CSV 포맷 예시</p>
            <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-x-auto text-gray-600 leading-relaxed">{`timestamp_ms,player_id,player_name,jersey_number,lat,lng,speed_mps,team
0,1,김민준,10,37.5665,126.9780,0.0,home
500,1,김민준,10,37.5666,126.9781,2.3,home
1000,2,이현우,7,37.5668,126.9785,3.1,away`}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
